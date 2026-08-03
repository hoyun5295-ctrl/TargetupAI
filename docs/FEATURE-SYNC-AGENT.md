# 싱크에이전트(Sync Agent) — 기능 상설 SoT

> **호출어: "싱크에이전트"** — Harold님이 싱크에이전트를 언급하면 이 문서를 먼저 연다.
> 이 문서가 **구조·불변 원칙·커서 규약·배포 게이트·원격 릴리즈·이력**을 소유한다.
> 세부 절차만 위임한다 — 검증·빌드 절차 = [빌드 런북](2026-07-28-sync-agent-build-verification-runbook.md), 증상별 진단 = [SYNC-AGENT-TROUBLESHOOTING](../status/SYNC-AGENT-TROUBLESHOOTING.md).
> **상태·잔여는 STATUS §2 카드가 소유한다**(여기 쓰지 않는다 — doc_ownership).

---

## 1) 정의

고객사 내부 DB(Oracle·MSSQL·MySQL·PostgreSQL·엑셀/CSV)를 읽어 한줄로 원장(`customers`·`purchases`)으로 밀어 넣는 설치형 에이전트.

**싱크에이전트와 자사몰 연동은 한줄로 타겟팅의 데이터 기반이다 — 여기가 새면 여정·자동마케팅 전부가 조용히 0건이 된다.**
문은 회사마다 하나(여정 불변 원칙과 동일) — 같은 사실이 두 경로로 들어오면 중복 발송·중복 과금이 된다.

## 2) 불변 원칙 (어길 수 없는 것)

| 원칙 | 뜻 | 어겼을 때 |
|---|---|---|
| **커서에 우리 시계를 넣지 않는다** | 커서는 **가져온 행에서 읽은 값**이다. 동기화 완료 시각을 넣는 순간 소스 컬럼과 축이 어긋난다 | 2026-08-03 이새 — 판매일에 시각이 없어(전량 자정) 그날 첫 배치 뒤 하루치 영구 탈락, 한 달 유실 98% |
| **커서 시각은 DB 원문 문자열로 왕복** | 조회 때 DB가 만든 문자열(`TO_CHAR`·`::text`)을 저장하고 같은 형식으로 파싱시킨다. JS Date 왕복 금지 | 드라이버 변환이 프로세스 TZ 의존 — 재부팅·TZ 변경 사이에 벽시계가 밀린다 |
| **커서는 닫힌 경계까지만** | 아직 행이 추가될 수 있는 구간(열린 ts 버킷·미완 스캔) 안으로 커서를 밀지 않는다 | PK 단조는 아무도 보장 안 한다 — 같은 ts에 낮은 PK가 나중에 삽입되면 영구 유실 |
| **바인드는 컬럼 타입에 맞춘다** | 타입 변환은 항상 상수 쪽에서. Oracle `DATE` 컬럼에 `TIMESTAMP` 바인드 금지 | 컬럼 쪽 캐스트 = 인덱스 불가 = 수백만 행 30분마다 풀스캔 |
| **적재는 멱등** | `source_row_key`(원본 PK) + `ON CONFLICT DO UPDATE`. 같은 행이 몇 번 와도 한 줄 | 재싱크·재전송·커서 겹침이 전부 중복 행이 되고, 고객 구매요약 재계산까지 오염 |
| **키는 자르지 않는다 · 키 없이 보내지 않는다** | 상한 초과·비스칼라는 그 행만 거부+사유 보고 | 자르면 다른 원본 행이 같은 키 / 키 없이 보내면 재조회마다 중복이 쌓인다 |
| **`created_at`(도착 축)은 UPSERT가 갱신하지 않는다** | 여정 구매 원장 커서가 도착 축으로 읽는다 | 값이 올라가면 이미 발화한 구매가 커서 창에 재진입 — 재발송 |
| **판정 근거가 없으면 정직하게 잠근다** | PK 없음·비스칼라 PK·시각 전부 NULL·소스 식별 불가 = 증분 잠금+사유 보고. 자연키를 지어내지 않는다 | 지어낸 키 = 정답표. 같은 날 같은 상품 두 건이 한 건이 된다 |
| **커서 전진은 서버 성공 후** | API 실패(네트워크·5xx) = 미전진(재시도 몫). 행 검증 실패는 전진+`failures` 보고 | 실패 행에 걸려 멈추면 그 청크 영구 재조회 루프 |
| **메타 조회 실패는 fail-closed** | 컬럼 메타가 실패·0행이면 던지고 캐시하지 않는다 | 빈 결과를 성공 캐시하면 보정이 프로세스 수명 동안 꺼진다 |
| **검증된 조합만 출고** | `VERIFIED_COMBOS` fail-closed + **검증은 버전 세대에 귀속**(변경 = 버전 올림 = 재검증) | 런북 §8 — 2026-07-27 빌드 먼저 사고 / 옛 세대 검증 승계 = 다른 물건을 검증됐다고 내보냄 |
| **자동 업데이트는 올라가는 방향만** | 원격 릴리즈로 옛 버전이 내려가면 안 된다 | 고친 결함이 무선으로 되돌아온다(§6 잔존 위험) |

## 3) 구조 — 파일별 소유

| 층 | 파일 | 소유하는 것 |
|---|---|---|
| 엔진 | `sync-agent/src/sync/engine.ts` | 증분·전량 흐름 · 커서 전진 규칙 · fingerprint 조립 · 잠금 판정 |
| 커서 공통 | `sync-agent/src/db/keyset.ts` | 키셋 술어 전개형 · `source_row_key` 직렬화 · 행 커서 성분 추출 (순수 모듈) |
| 커서 저장 | `sync-agent/src/sync/state.ts` (`data/sync_state.json`) | 대상별 커서 · 증분 보류 · 명령 멱등 · ACK 보류함 · 원자 저장 |
| 어댑터 | `sync-agent/src/db/{oracle,mssql,mysql,postgresql,excel-csv,mock}.ts` | 조회 SQL · PK 해석·타입 검증 · **커서 원문 직렬화** · `getSourceId` |
| 전송 | `sync-agent/src/api/client.ts` | 서버 payload(`source_row_key` 포함) · 재시도 |
| 스케줄 | `sync-agent/src/scheduler/index.ts` | 주기 실행(고객·구매 개별 주기) · heartbeat 매 정각 |
| 자동 업데이트 | `sync-agent/src/updater/index.ts` | 버전 확인 · checksum 필수 검증 · 교체 스크립트 |
| 서버 수신 | `packages/backend/src/routes/sync.ts` | 인증 · 배치 상한 · `sync_logs` 기록 · `/version`·`/download` |
| 서버 적재 CT | `packages/backend/src/utils/sync-ingest.ts` | 키 정규화 · 배치 내 중복 제거(키 정렬 = 교착 방지) · 멱등 UPSERT SQL · 42703 강등 |
| 고객 적재 CT | `packages/backend/src/utils/customer-upsert.ts` | `(company_id, store_code, phone)` 멱등 — 처음부터 멱등이었다 |
| 티어·검증·게이트 | `packages/backend/src/utils/agent-build-tiers.ts` | OS 티어 판정 · `VERIFIED_COMBOS` · `CURRENT_AGENT_VERSION` · `isPackageKeyVerified` |
| 배포 화면 | `packages/frontend/src/components/admin/AgentDeployWizard.tsx` | OS→티어→드라이버 판정 표시 · 미검증 안내(게이트는 서버) |

**산출물 축** — 소스 하나, 바이너리는 OS 티어 5종(win-modern·win-2012·win-2008r2·linux-modern·linux-legacy). 드라이버 4종은 한 exe에 들어 있고 지연 로드. **회사별 빌드가 아니라 조합별 검증이다.**

## 4) 커서 규약 (2026-08-03 확정 — Codex 적대검증 5R approve)

대상(customers/purchases)별 `{ tsRaw, keys[], pkColumns[], fingerprint }`.

- `tsRaw` = 타임스탬프 **DB 원문 문자열**(어댑터가 SELECT에 원문 컬럼을 함께 실어 온다). 되돌릴 때는 컬럼 타입에 맞는 상수식으로만 — Oracle `TO_CHAR`/`TO_DATE`·`TO_TIMESTAMP` / MySQL `DATE_FORMAT`/`CAST` / MSSQL `CONVERT` style 121 / PG `::text`+상수 캐스트.
- **저장하는 것은 마지막 행이 아니라 "닫힌 버킷 경계"** — 더 큰 ts가 관측된 버킷의 마지막 행까지. 최대 ts 버킷(열린 버킷)은 저장하지 않고 매 주기 재조회하며, 겹침은 서버 멱등이 흡수한다. `keys=[]` = 열린 버킷 시작 커서(`ts >=` 재조회).
- **`fingerprint` = JSON 배열 직렬화**(dbType·sourceId·테이블·ts컬럼·PK구성). 구분자 결합은 값 안의 구분자로 서로 다른 소스가 같은 문자열이 될 수 있어 폐기했다. `sourceId`도 어댑터가 JSON으로 만든다(host·port·db·**계정**, PG는 스키마 포함 — 계정이 스키마 해석을 정한다). 하나라도 다르면 커서 폐기 → 전량 재기준(fail-closed). **키셋 경로는 `getSourceId` 필수** — 없으면 증분을 잠근다(같은 dbType 다른 소스가 같은 fingerprint가 된다).
- 조회 조건은 전 DB 공통 **전개형** `ts > :t OR (ts = :t AND (k1 > :k1 OR …))`, 정렬 `ts ASC, k1 ASC, …`. Oracle이 행값 튜플 비교를 지원하지 않아 전개형이 유일한 공통 길이다. 페이지 넘김은 런 안에서만 튜플 strict >.
- **키는 fail-closed** — `source_row_key`(PK 값 이스케이프 결합) 직렬화 불가 행(초과 길이·NULL·비스칼라)은 **보내지 않고** 행 실패로 보고한다. PK 타입은 어댑터가 검증한다: Oracle NUMBER는 문자열 fetch+`TO_NUMBER` 바인드(2^53 반올림 차단, 증분·전량 양쪽), MySQL 정수는 `DECIMAL(65,0)` 캐스트(문자열 근사 차단), MSSQL·PG는 정수·문자 계열 화이트리스트 — 밖이면 명시 오류로 잠근다.
- **전량 씨앗은 완전 스캔 + API 무실패일 때만.** 씨앗 = **시작 시점**의 닫힌 버킷 경계(2단 조회: 최대 튜플 → 그보다 이전 최대). 종료 후 재탐침은 씨앗으로 쓰지 않는다(마지막 페이지 이후 삽입분이 씨앗 아래로 들어가 유실). 카운트가 0인데 행을 받았으면 미완으로 취급한다.
- 커서 전진: API 실패 = 미전진 / 행 검증 실패 = 전진+보고 / 경계는 그 행이 포함된 페이지 전송 성공 후에만 저장(청크 단위 — 중간에 죽어도 이어받는다).
- 시각 NULL 행은 증분에 안 잡힌다(전량에서만 — 동작 보존). 전부 NULL이면 증분 보류 + 매 주기 1행 탐침으로 자동 복구. 옛 형식 커서(완료 시각)는 fingerprint가 없어 자동 폐기.
- **한계(기록)** — 과거 날짜로 소급 삽입(backdating)된 행은 어떤 HWM 커서로도 못 잡는다. 주기 재대조 워커가 별도 과제.

## 5) 배포 게이트 — 검증된 조합만 (2026-08-03)

**케이스바이케이스가 운영 절차가 아니라 구조다.**

- 등재 키 = `<osTierId>__<dbId>__<version>`. **검증은 버전 세대에 귀속** — `CURRENT_AGENT_VERSION`과 일치하는 등재만 verified다. 에이전트 버전을 올리면 이 상수도 함께 올리고, 그 순간 전 조합이 자연 폐쇄된다(조합별 재검증 후 개방).
- **실제 게이트는 서버 다운로드 길목**(`isPackageKeyVerified` → 403 `AGENT_BUILD_NOT_VERIFIED`). 화면 잠금만으로는 우회된다.
- 슈퍼관리자 "싱크에이전트 배포" 화면은 **없애지 않는다.** 그 화면의 값은 다운로드 버튼이 아니라 OS→티어→드라이버 판정이다(2008 R2에 node20 빌드를 보내는 실수를 막는 화면). 미검증 조합은 "확인되지 않음 — 담당자 확인 후 개별 전달"로 표시된다.
- packageKey 하나에 여러 (osTier×dbId)가 매핑되므로(oracle zip 하나 = 10g~21c), **그중 하나라도 현 세대 verified면** 그 zip이 열린다.
- 등재 근거는 `scripts/smoke-combos.sh` PASS. 절차·조합 현황 = [런북](2026-07-28-sync-agent-build-verification-runbook.md) §1~§3.

## 6) 원격 릴리즈 (자동 업데이트)

**경로** — 등재(`POST /api/admin/sync/releases`, 같은 티어 기존 활성 자동 비활성) → 에이전트가 매시간 `GET /version`(서버가 `os_info`로 티어 판별, 정확 티어 우선·전역 폴백, 판별 불가 = 대상 제외) → `download_url` 상대경로를 에이전트 baseURL에 결합해 다운로드 → **checksum 없으면 교체 거부** → sha256 검증 → OS별 교체 스크립트 → 재시작.

⛔ **잔존 위험 — 버전 판정이 "다르면"이지 "크면"이 아니다**(`updater/index.ts` — `latestVersion === currentVersion`만 스킵). 옛 버전 활성 행이 남아 있으면 새 버전 에이전트가 스스로 **다운그레이드**한다(고친 결함이 무선으로 복귀). 닫는 자리는 서버 `GET /version` 응답 단계 — 릴리즈가 에이전트 `current_version`보다 클 때만 내려준다(이미 나간 에이전트 전부 보호, zip 재빌드 불필요). **미착수.**

⚠ **이새 1.5.7은 자기교체 결함이 있어 원격 업데이트를 못 받는다** — 유지가 정상이고, 교체는 신규 설치로 한다(2026-07-10 v1.6.1 축 종결 판단). 타 ERP 전환·월말 재싱크 때 1.7.0 신규 설치.

## 7) 이력 색인

| 시점 | 무엇 | 근거 |
|---|---|---|
| 2026-08-03 | **구매 증분 유실 사고 — 발견부터 정정까지.** 이새 6월 하루 820건 → 7월 78 → 8월 3.7(실제의 1.5%). 원장 185만 중 99.98%가 7/3 전량 동기화 35분에 들어왔고 이후 한 달 증분 총합 382건. 오류 없이 매 회차 0건 정상 보고 — 커서=완료시각(시·분·초) × 판매일 컬럼 시각 없음(전량 자정)이 만나 그날 첫 배치 뒤 하루치 영구 탈락. 전 버전(1.5.7·1.6.4·1.6.5) 공통 | §2·§4 · SCHEMA `purchases` 절 |
| 2026-08-03 | **서버 멱등 적재 선행 배포** — `source_row_key` + 부분 유일 인덱스 + `ON CONFLICT DO UPDATE`. 커서를 먼저 고치면 유실이 중복으로 바뀌기만 한다(원장 유일성이 PK뿐이었다). `created_at`은 갱신 제외 | `utils/sync-ingest.ts` |
| 2026-08-03 | **에이전트 1.7.0 커서 재설계** — 키셋 커서·원문 문자열 왕복·복합 PK·fail-closed 키·fingerprint·전량 씨앗. Codex 적대검증 **5라운드 13건 전량 수용 후 approve**. 어댑터 4종+엔진+상태+payload, 테스트 102건 | §4 · `db/keyset.ts` |
| 2026-08-03 | **배포 게이트 신설** — 버전 세대 귀속 등재 + 서버 403 길목 + 화면 안내. 옛 세대 검증 2건 미승계 | §5 |
| 2026-08-03 | **win-modern×mysql 1.7.0 smoke PASS·등재** — exe 실행·MySQL 접속·테이블/컬럼 판독·PK 해석 76ms. 아난티 출고 세트(zip+매뉴얼 v1.7.0) | 런북 §3 |
| 2026-08-03 | **원격 릴리즈 경로 점검** — 사슬 정상·현재 DB 안전(활성 릴리즈는 1.5.7/win-legacy뿐이라 win-modern 무매칭). 다운그레이드 구멍 발견·미착수 | §6 |
| 2026-07-28 | 빌드 검증 런북·`--test-db`·smoke-combos | [런북](2026-07-28-sync-agent-build-verification-runbook.md) |
| 2026-07-27 | Server 2016 VM 검증(1.6.4 win-modern×mysql 전체 통과). **VM은 검증 후 삭제됨(2026-08-03)** | 런북 §0·§3 |
| 2026-06-30 | 이새 연동 시작(1.5.7 · Oracle · 2008 R2) · 전량 키셋 페이지네이션 | `memory/project_2026_0727_sync_agent_vm_verification.md` |
| 2026-06-11 | 인비토 첫 연동 3건(버전 단일 진입점 등) | TROUBLESHOOTING §2-4 |

### 7-1) Codex 적대검증 판정 이력 (2026-08-03 · 5라운드 13건 전량 수용 후 approve)

나중에 "왜 이렇게 짰나"를 되짚는 근거다. 각 항목은 실제로 유실·중복을 만들 수 있던 경로다.

| R | # | 지적 | 반영 |
|---|---|---|---|
| 1R | F1 | 불완전 전량 스캔에도 씨앗 저장 → 누락 행이 커서 아래로 들어가 영구 제외 | 씨앗 게이트 = 완전 스캔 + API 무실패일 때만 |
| 1R | F2 | 같은 ts에 낮은 PK 후행 삽입 시 "마지막 행" 커서가 영구 유실(PK 단조 미보장) | 커서 = 닫힌 버킷 경계, 열린 버킷은 매 주기 재조회 |
| 1R | F3 | 커서가 소스·테이블·ts컬럼 정체성을 안 가짐 → `--edit-config` 변경 후 옛 커서 재사용 | fingerprint 신설, 불일치 시 폐기 후 전량 재기준 |
| 1R | F4 | 직렬화 불가 PK 행을 키 없이 전송 → 재조회마다 중복 INSERT | 그 행은 전송 제외 + `SOURCE_KEY_UNSERIALIZABLE` 행 실패 보고 |
| 1R | F5 | MySQL BIGINT 커서를 문자열 그대로 비교 → 2^53 위 근사 비교로 건너뜀/재조회 | 정수 PK 바인드를 `CAST(? AS DECIMAL(65,0))` |
| 1R | F6 | Oracle NUMBER PK가 JS number로 반올림 → 인접 PK가 같은 멱등키 | NUMBER PK 문자열 fetch + `TO_NUMBER` 바인드 |
| 2R | F7 | 종료 후 재탐침으로 씨앗 생성 → 마지막 페이지 이후 삽입분이 씨앗 아래로 유실 | 씨앗은 **시작 탐침만**, 재탐침은 보류/재기준 판정 전용. 카운트 0인데 행 수신 = 미완 |
| 2R | F8 | Oracle **전량** 경로에 NUMBER 문자열 fetch 미적용 → 전량에서 멱등키 충돌 | `fetchAll`·`fetchAllKeyset`에도 `fetchInfo` 적용 |
| 2R | F9 | fingerprint에 username 없음 → Oracle 계정(=스키마) 변경에도 커서 유지 | 4종 전부 sourceId에 계정 포함(PG는 스키마도) |
| 3R | F10 | Oracle 메타 실패를 빈 결과로 캐시 → 반올림 경로가 프로세스 수명 동안 부활 | 실패는 throw, 성공 메타만 캐시 |
| 3R | F11 | fingerprint 구분자 결합이 비단사 → 다른 소스가 같은 지문 | JSON 배열 직렬화로 교체 |
| 4R | F12 | `getColumns` 0행을 성공으로 캐시(예외만 실패 취급) | 0행도 throw, 캐시 없음 |
| 4R | F13 | `getSourceId` 미구현 어댑터는 같은 dbType끼리 지문 충돌 | 키셋 경로에서 `getSourceId` 필수 계약, 없으면 증분 잠금 |

**불수용 1건** — `source_row_key`에 테이블명 접두(권고). 같은 테이블명으로 ERP를 갈아타면 접두가 있어도 의미 충돌은 그대로다. 그 축은 fingerprint가 강제하는 전량 재기준 + 재싱크 선삭제(§8)가 담당한다.

**검증 실행 기록** — 에이전트 tsc 0 · 테스트 102건(신규 43: 키셋 순수 24 + 엔진 계약 16 + 게이트 5 · 회귀 0). 서버 tsc 0 · 1,905건. Codex는 실행 환경에 Node가 없어 검사를 못 돌렸고 그 몫은 이쪽에서 실행했다.

### 7-2) 고객사 환경 실측

| 회사 | 구성 | 상태 |
|---|---|---|
| **이새에프앤씨** | Oracle · Windows Server 2008 R2(`win32 6.1.7601`) · 에이전트 1.5.7 · 주기 고객 60분/구매 30분 · `company_id 682956b7-37a3-46b5-9868-b63011bda47b` | 1.5.7 유지(자기교체 결함) · **월말 전량 재싱크 예정 = 선삭제 후 1.7.0 신규 설치**(§8) |
| **아난티** | Aurora MySQL `8.0.mysql_aurora.3.09.0` · Windows Server 2016 Datacenter x64 · TLS 비강제 | 1.7.0 출고 대기(zip+매뉴얼 세트 준비 완료) · **Aurora 실접속은 미검증** — VM 검증은 로컬 MySQL 8.0.46 기준이라 설치 당일 마법사 접속 테스트가 첫 확인 지점 |

**이새 유실 실측(2026-08-03)** — 월별 하루 평균: 2025-07~2026-06 486~886건 안정 → 2026-06 820.0 → **2026-07 77.8 → 2026-08 3.7**. 원장 1,855,088건 중 1,854,706건(99.98%)이 7/3 15:07~15:42 전량 동기화 566배치로 유입, 이후 한 달 증분 총합 **382건**. `sync_logs`는 매 회차 2.1초·0건·오류 없음(같은 시각 고객 동기화는 매시간 3건 정상 = 데이터가 없는 게 아니었다). 7/17만 18배치 161건 — 커서가 뒤로 밀린 날이라는 증거.

**서버 DB 시간축** — 세션 TimeZone `Etc/UTC`. `purchases.purchase_date`는 KST 날짜(전량 `00:00:00`), `created_at`은 `NOW()` 적재라 UTC 벽시계. **한 행에 축이 둘**이니 비교 시 변환을 명시한다(SCHEMA `purchases` 절).

### 7-3) 버전 이력

| 버전 | 내용 | 출고 |
|---|---|---|
| 1.5.7 | 이새 운영분. 자기교체 결함으로 원격 업데이트 불가 | 이새(유지) |
| 1.6.4 | TLS 일체 + BIGINT + MySQL 키셋 + 마법사 IE11 우회(Server→CLI 라우팅) | ~~아난티~~ → 1.7.0으로 대체(커서 결함 공통) |
| 1.6.5 | `--test-db` 신설(비대화형 DB 진단 — smoke 판정의 전제) | 미출고 |
| **1.7.0** | **커서 재설계**(§4 전량) · `source_row_key` payload · 증분 잠금 판정 · 전량 씨앗. **설치·마법사 경로 무변경**(1.6.4 검증 계보 유지) | 아난티(대기) |

**DDL 이력** — 2026-08-03 실행완료: `purchases.source_row_key varchar(200)` + `CREATE UNIQUE INDEX ux_purchases_company_source_row_key ON purchases (company_id, source_row_key) WHERE source_row_key IS NOT NULL`. 부분 인덱스라 기존 185만 행(키 NULL)은 걸리지 않는다.

**검증 등재 이력** — `win-modern__mysql__1.7.0`(2026-08-03 smoke PASS: exe 실행·MySQL 접속·테이블/컬럼 7개 판독·PK 해석 `member_id`, 76ms). 옛 세대 미승계 2건: `win-2008r2__oracle-10g`(2026-06-24, 1.5.x) · `win-modern__mysql`(2026-07-27, 1.6.4 · Server 2016 VM은 검증 후 삭제됨).

## 8) 운영 절차 — 재싱크·출고

**고객사 재싱크(전량 다시 받기)**
1. 그 회사 `purchases` **선삭제**. 기존 행은 `source_row_key`가 비어 부분 인덱스 밖이라 새 키 행과 충돌하지 않는다 — 안 지우면 그대로 두 배가 된다.
2. 에이전트 `data/sync_state.json` 커서 폐기(또는 fingerprint 변경으로 자동 폐기) → 전량이 기준을 다시 잡는다.
3. 전량 완료 후 씨앗이 심어졌는지 로그로 확인(미완이면 커서를 안 남기고 다음 주기에 다시 돈다).

**출고**
1. 조합 확정 → 그 티어 빌드 → 스테이징 → 해당 드라이버 zip만 재포장.
2. `smoke-combos.sh --only <조합>` PASS → `VERIFIED_COMBOS`에 `<조합>__<버전>` 등재 → 배포하면 그 조합 다운로드가 열린다.
3. **zip과 매뉴얼은 같은 버전끼리 세트로** 나간다.

## 9) 착수 전 필독

1. 이 문서 §2(불변 원칙) — 전부 사고 기원이다.
2. 커서를 만지면 §4 전문. 배포·출고면 §5 + [런북](2026-07-28-sync-agent-build-verification-runbook.md) §1·§8.
3. 증상 진단 = [TROUBLESHOOTING](../status/SYNC-AGENT-TROUBLESHOOTING.md) 해당 절.
4. 서버 적재를 만지면 여정 구매 원장 커서(`journey-purchase-ledger`·`journey-target-extractor`)와 도착 축 계약을 먼저 확인한다.
