# 싱크에이전트 OS별 빌드 티어 + 슈퍼관리자 배포 위저드 — 설계서

> 작성 2026-06-16 · 담당 비토 · 승인 Harold
> 트리거: 인비토(Server 2008 R2) 원격 설치 2회 실패 — 단일 빌드(node 16.20.2)가 구형 OS에서 로드 불가(에러창도 없이 죽음)

---

## 1. 배경 / 결정

- 현 빌드는 사실상 단일 기준(node20-win / node16-legacy / node20-linux). 레거시 exe의 node 베이스 = **16.20.2**.
- **node16 공식 최소사양 = Windows 8.1 / Server 2012 R2.** 인비토(2008 R2)는 그 아래라 로드 실패 → 원격 2회 실패.
- **결정(Harold):** 지원 바닥을 명확히 긋고, 그 범위를 덮는 빌드를 **여러 개로 나눠** 적절한 것을 내보낸다. 바닥 미만은 "지원 범위 밖"으로 깔끔하게 둔다(과대설계 금지).

---

## 2. 지원 범위 (바닥 = 확정)

| 플랫폼 | 지원 바닥 | 근거 |
|---|---|---|
| Windows | **Server 2008 R2 SP1 / Windows 7 SP1 이상** | node14가 도는 최저선. 인비토가 여기. |
| Linux | **CentOS7 / RHEL7 / Ubuntu 14.04 이상 (glibc ≥ 2.17)** | node16이 도는 최저선. 2008 R2와 비슷한 노후도. |

- **바닥 미만(명시적 비지원):** Windows — 원조 Server 2008(non-R2, NT6.0)·2003 / Linux — CentOS6·RHEL6(glibc 2.12) 이하. (모던 mssql 드라이버 돌릴 node가 거기서 안 뜸. 실고객 거의 없어 표준 빌드를 만들지 않는다.)
- **모델:** 에이전트는 고객이 지정한 머신에 설치돼 그 회사 DB를 **읽기전용으로 직접 읽어온다.** 그 머신 OS가 지원 범위 안이면 해당 티어 빌드를 넣는다.

> (참고·옵션) mssql/mysql2/pg는 전부 TCP 드라이버(`source.host`=IP)라, 여분 모던 PC가 같은 망에 있으면 거기서 node20으로 구형 DB를 LAN 원격으로 읽을 수도 있다. **기본 가정 아님 — 매뉴얼 안내만.**

---

## 3. 빌드 티어 (5종)

> node 정확 minor·동봉 여부는 **빌드 시점에 각 OS 최소사양·glibc 실측으로 확정**(추측 신뢰 금지). 아래는 기준선.

### Windows (3종)
| 티어 | OS 범위 | node | 의존성 | 런타임 동봉 |
|---|---|---|---|---|
| `win-modern` | Win10/11 · Server 2016+ | 20 | express5 / mssql11 (현행) | 불필요 |
| `win-mid` | Win8.1 · Server 2012/2012R2 | 16 | express4 / mssql10 | UCRT app-local 동봉 |
| `win-legacy` | Win7 SP1 · Server 2008R2 SP1 | 14 | express4 / mssql10 | **UCRT app-local 동봉 (확인됨)** |

### Linux (2종)
| 티어 | OS 범위 (glibc) | node | 의존성 |
|---|---|---|---|
| `linux-modern` | Ubuntu20.04+ · RHEL8+ · Debian10+ (≥2.28) | 20 | 현행 |
| `linux-legacy` | CentOS7 · RHEL7 · Ubuntu14~18 (2.17~2.27) | 16 | express4 / mssql10 |

**한 티어 = (OS 범위 + node + 의존성 + 런타임 동봉) 한 세트.** node만 바뀌는 게 아니라 express/mssql도 같이 내려간다(라우트 호환은 이미 코드 반영).

### Windows 구형 런타임 동봉 (app-local) 표준
- UCRT 정식 redist(Windows SDK `Redist\10\ucrt\DLLs\x64` 46개) + `vcruntime140` `vcruntime140_1` `msvcp140`(System32) + `sql-wasm.wasm`를 exe 옆에 동봉.
- 효과: `0xC0000139`(entry point not found)·조용한 로드 실패 차단. vc_redist 설치·인터넷·재부팅 불필요.
- 검증 산출물: `sync-agent/SyncAgent-invito-node14-selfcontained.zip` (node14 + 49 DLL + 자가진단 bat).

---

## 4. 슈퍼관리자 "싱크에이전트 배포 위저드"

### 4-1. 형태 — 드롭다운 폼이 아니라 단계별 위저드
한 번에 하나씩 고르고 넘어간다. 끝에 시스템이 **"이 버전을 내보내세요"** 결론 한 장을 낸다.

- **Step 1 · 플랫폼:** Windows / Linux (카드 2개 클릭 → 다음)
- **Step 2 · OS 버전:** Step1에 따라 분기된 목록에서 선택 → 다음
  - Windows: Win10/11·2016+ / Win8.1·2012R2 / Win7·2008R2 / **(그 이하 = 지원 범위 밖 안내)**
  - Linux: Ubuntu20.04+·RHEL8+ / CentOS7·Ubuntu16~18·RHEL7 / **(CentOS6 이하 = 범위 밖 안내)**
- **Step 3 · 원본 DB:** MSSQL / MySQL·MariaDB / PostgreSQL + (MSSQL이면) 세대(2008·2012 / 2016+) → 다음
- **결과 카드:** 
  - **내보낼 빌드** (예: `win-legacy` node14)
  - **설치 방식 요약** (그 머신에 폴더 복사 + bat 실행 / DB는 읽기전용 계정)
  - **DB 연결 주의사항** (예: SQL Server 2008·2012 → `encrypt=false` + TLS1.0/1.1 점검)
  - **패키지 다운로드 링크**
  - 범위 밖 OS 선택 시 → "지원 범위 밖입니다(2008 R2/CentOS7 미만)" 안내 + 대안 한 줄

### 4-2. 디자인 (AI 여정 빌더 동급 — `design_quality_minimum_journey_level`)
- 상단 sticky 헤더 + BETA badge + 그라데이션 아이콘, 다크톤(`bg-slate-950` + violet 액센트 + `border-white/10`).
- 단계 진행 표시(Step 1/2/3 진행 바), 이전/다음.
- 결과 카드 = 1-click 액션 카드(다운로드/매뉴얼/복사) color-coded.
- **native dialog 0건** — ConfirmModal + useToast.
- 모바일 반응형(flex-wrap + md:/lg:).

### 4-3. 룰표 = 단일 진실원, AI 판단 0건
- 룰표는 코드 한 곳에 둔다 — 신규 컨트롤타워 `packages/backend/src/utils/agent-build-matrix.ts`.
- 형태: `{ platform, osTier } → { buildTier, node, depSet, runtimeBundle, supported: bool, dbNotes[] }`.
- 프론트(`packages/frontend/src/pages/AdminDashboard.tsx` 신규 메뉴)는 endpoint로 이 표를 받아 위저드·결과를 렌더 — **인라인 매핑 복제 금지**(`no_inline_duplication`).
- 백엔드 endpoint = `packages/backend/src/routes/admin.ts`(또는 `admin-sync.ts`)에 1건 추가.

### 4-4. 스코프 (YAGNI)
- 1차: **stateless 위저드** — 서팀장이 매번 고름 → 결과 출력. **신규 DB 테이블·컬럼 0건.**
- 후속(비범위): 고객사별 배포 상태 저장·이력, 자동 OS 감지.

---

## 5. 빌드 시스템 변경

- `sync-agent/package.json` 스크립트를 티어별 단일 진입점으로 정리:
  - `build:win-modern` (node20-win) / `build:win-mid` (node16-win + UCRT 동봉) / `build:win-legacy` (node14-win + UCRT 동봉)
  - `build:linux-modern` (node20-linux) / `build:linux-legacy` (node16-linux)
  - `build:tiers` = 위 5종 한 번에 + **산출물 매니페스트**(JSON: 티어→파일·해시·node·빌드시각) 생성
- 레거시 티어 공통: `npm i express@4 mssql@10 --no-save` → `esbuild --target=nodeXX` → `pkg@5.8.1 --targets nodeXX-(win|linux)-x64` → 빌드 후 `npm ci`로 의존성 원복. **메인(node20) 무손.**
- Windows 구형 티어 패키지엔 `INSTALL-run-as-admin.bat`(exit code → `diagnose.txt`) 동봉.
- 슈퍼관리자 다운로드는 매니페스트를 읽어 링크 제공(기존 산출물 서빙 방식 재사용 — 구현 때 `admin-sync.ts` 확인).

---

## 6. DB 축 (빌드 안 가름)

- 에이전트는 **mssql · mysql2 · pg 전부 내장**(코드 확인). 모든 빌드가 세 DB 지원 → **DB는 별도 빌드 X.**
- DB가 영향 주는 것 = 연결 설정뿐: 구형 SQL Server(2008/2012) → `encrypt=false`·TLS 점검 / 최신 SQL·MySQL·PG → 현행. → 위저드 결과 카드 "DB 주의사항"으로 출력.

---

## 7. 매뉴얼 갱신 (산출물 포함)

`sync-agent/installer/README.md` + 배포 매뉴얼에 반영:
1. 지원 범위(2008 R2 / CentOS7 이상) 명시.
2. 티어별 설치 절차(폴더 복사 + bat / 읽기전용 DB 계정).
3. 구형 Windows 런타임 동봉 설명(vc_redist 불필요).
4. `diagnose.txt` 회신 절차(안 뜰 때 EXIT_CODE 캡처).
5. (옵션) 여분 모던 PC LAN 원격 안내.
- 매뉴얼은 위저드 결과 카드의 "설치 방식 요약"과 1:1 일치.

---

## 8. 검증 / 에러 처리

- **티어별 스모크:** 각 빌드 직후 `--version` 자동 확인. node14 산출물은 통과.
- **구형 OS 실측:** `win-mid`/`win-legacy`/`linux-legacy`는 **고객 PC가 아니라 우리 측 Win7/구형 리눅스(실 PC 또는 VM)** 에서 `EXIT_CODE=0` + **실제 DB 동기화 1건**까지 확인 후에만 룰표 `supported=true`. 미검증은 위저드에서 "검증 대기"로 숨김.
  - 근거: Win7 SP1 ≡ Server 2008 R2 SP1 (동일 커널 6.1.7601) → Win7 통과 = 2008R2 보장.
- **DB 동기화 검증 의무:** 레거시 티어는 의존성이 내려가므로(express4/mssql10) `--version`만으로 끝내지 않고 실제 SELECT→전송 1건 확인. (현 node14 빌드의 미검증 항목)
- **자가진단 bat:** 로컬 실패 시 EXIT_CODE로 원인 자동 분류(0xC0000135 DLL 누락 / 0xC0000139 엔트리포인트).

---

## 9. 범위 / 비범위

**범위:** §3 빌드 5티어, §4 슈퍼관리자 배포 위저드(stateless·여정 동급 디자인·고정 룰표), §5 빌드 스크립트·매니페스트, §6 DB 주의 출력, §7 매뉴얼, §8 검증 게이트.

**비범위(후속):** 고객사별 배포 상태 저장·이력, 자동 OS 감지, 빌드 CI 자동화, 바닥 미만(2008 non-R2/2003/CentOS6) 전용 빌드(명시적 비지원), 여분 모던 PC 원격은 매뉴얼 안내만.

---

## 부록. 결정 로그
- 단일 node 폐기 → OS 범위별 5티어. (인비토 사고)
- 지원 바닥 확정 = Windows 2008 R2/Win7, Linux CentOS7/glibc2.17. 미만은 명시적 비지원. (Harold: "2008 이상까지만" + "win2008 쓰는 데가 얼마나 되냐" 과대설계 경계)
- node14 = Windows 실질 바닥(2008 R2). node16 = Linux 실질 바닥(CentOS7).
- 메뉴 = 드롭다운 폼 X, **단계별 위저드**로 "이 버전 내보내라" 결론. (Harold 명시)
- 버전 선택 = AI 아닌 고정 룰표(반복가능·감사가능).
- DB는 빌드 축 아님 = 드라이버 3종 내장, 연결 설정만 분기.
- 여분 모던 PC LAN 원격 = 기본 아님, 옵션 안내만. (Harold: "우리가 컴터 하나 돌리는 거 아니다, DB 읽기전용 직접 읽어와야")
