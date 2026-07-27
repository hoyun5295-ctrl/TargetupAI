# 싱크에이전트 빌드 산출물 20개 환경별 검증 — 다음 세션 실행 지시서

> **작성**: 2026-07-27 세션 종료 시 · **대상**: 다음 세션에서 이 문서만 보고 처음부터 진행
> **SoT**: 이 문서(실행 절차) + `status/SYNC-AGENT-TROUBLESHOOTING.md` §2-8(사고 경위)·§2-9(요약)
> **호출어**: "싱크에이전트 빌드 검증 이어가자"

---

## 0. 지금 상태 — 먼저 읽는다

**서버 `agent-builds/`에 올라간 1.6.4 zip 20개는 배포 가능한 물건이 아니다.**
웹 설치 마법사가 IE11에서 전면 무동작인 상태로 올라가 있다. Windows Server 2016·2019의 기본 브라우저가 IE11이므로, 그 고객이 받으면 **설치 화면에서 그대로 멈춘다.** 아난티 포함 어디에도 보내지 않는다.

**이번 세션에서 실제로 검증된 조합은 `win-modern × mysql` 하나뿐이다.** 나머지 19개는 빌드만 됐고 아무것도 확인되지 않았다. manifest는 전부 `candidate`로 표기돼 있으며 그것이 사실이다.

로컬 코드에는 마법사 라우팅 수정이 **이미 들어가 있다**(커밋 필요). 그 수정에는 아직 정정할 과교정이 하나 남아 있다(§1-1).

---

## 1. 코드 정정 — 착수 전 Harold 승인

### 1-1. Server 일괄 CLI = 과교정 (필수)

**현재**: `src/setup/setup-mode.ts`의 `resolveSetupMode`가 `os.version()`에 `Server`가 있으면 **무조건** CLI로 보낸다.
**문제**: Edge가 기본 탑재된 **Server 2022 이상 고객도 웹 마법사를 못 쓴다.** IE11 문제는 Server 2016(빌드 14393)·2019(17763)의 문제다.
**처방**: Server이면서 **커널 빌드 < 20348**(Server 2022)일 때만 CLI. 순수 함수라 유닛으로 고정한다.
현재 테스트(`setup-mode.test.ts`)에 `Server 2022 → cli` 케이스가 들어가 있으니 그것도 `web`으로 바꿔야 한다.

### 1-2. 탈출구 안내 (필수)

`--setup-web` / `--setup-cli` 플래그는 이미 있는데(`main.ts`) 고객이 알 방법이 없다.
CLI 마법사 시작 배너에 한 줄 추가 — "브라우저 화면으로 진행하려면 `sync-agent.exe --setup-web`".

### 1-3. 부수 findings (판단 후 처리)

| 항목 | 내용 |
|---|---|
| 구매 테이블 "없음" 선택지 부재 | 테이블이 1개면 고객·구매에 같은 테이블을 배정한다. 이번 VM에서 구매 0/20000 전건 실패로 나왔다(정규화가 걸러 오염은 없었음). 사용자에겐 실패로 보인다. |
| CLI 원본 DB 목록에 Excel/CSV 잔존 | 2026-06-22에 웹 마법사에서만 제거되고 CLI에 남았다(§2-5). |
| 브라우저 자동 열기 실패 | Server 2016에서 안 열렸다. Server는 CLI로 가므로 우선순위 낮음. |
| 한글 콘솔 네모 | **영문판 VM 한계일 수 있다. 한글 Windows에서도 그런지 미검증.** 확인 전에 레지스트리(글꼴)를 건드리지 않는다 — 이번 세션에 넣었다가 근거 부족으로 되돌렸다. |

---

## 2. 20개 조합 검증 매트릭스

5 티어 × 4 드라이버 = 20. **조합마다 아래 6단계를 실제로 실행**하고, 통과분만 백엔드 `VERIFIED_COMBOS`(`utils/agent-build-tiers.ts`)에 등재한다.

### 2-1. 조합별 6단계

1. `sync-agent.exe --version` → `v1.6.4`
2. INSTALL bat 실행 → `INSTALL_SERVICE_EXIT=0` + **마법사 자동 진입**
3. DB 접속 테스트 (TLS 끈 상태 / 켠 상태 각 1회)
4. 테이블·컬럼 목록 조회
5. AI 컬럼 매핑
6. 전체 동기화 1회 + **재부팅 후 자동시작**

### 2-2. 환경 확보

| 티어 | node | 검증 환경 | 현재 |
|---|---|---|---|
| win-modern | 20 | **Server 2016 VM 확보됨** (영문판 Evaluation, MySQL 8.0.46 + 가짜 DB `anantidb` 구축 완료) | mysql만 통과. pg·mssql·oracle 미검증 |
| win-mid | 16 | Server 2012 R2 VM 필요 | 전부 미검증 |
| win-legacy | 12 | Server 2008 R2 VM 필요 (§2-5에 Docker 재현 이력) | 전부 미검증 |
| linux-modern | 20 | Docker, glibc ≥ 2.28 | `--version`만 통과(2.28·2.39). **DB 연결 미검증** |
| linux-legacy | 16 | Docker, glibc 2.17 확인됨(`centos:7`) | `--version`만 통과(2.17·2.28·2.39). **DB 연결 미검증** |

**리눅스 tier는 exe가 뜬다는 것만 확인됐다.** MySQL·PostgreSQL·Oracle·MSSQL 커넥터가 실제로 붙는지는 하나도 안 봤다.

### 2-3. DB 컨테이너 (로컬 보유)

`mysql:8.0` · `mysql:5.7` · `postgres:15-alpine` · `postgres:16-alpine` · `mariadb:11.4` · `gvenzl/oracle-xe:11-slim`
**MSSQL만 확보 필요** — `mcr.microsoft.com/mssql/server`. 도커 허브 blob 다운로드가 EOF로 끊긴 사례가 있으니 실패하면 재시도한다.

### 2-4. 리눅스 검증 실행 예시 (이번 세션 실측 명령)

```bash
# Git Bash에서 경로 변환 방지 필수
export MSYS_NO_PATHCONV=1
SP="<zip 풀어둔 폴더 (Windows 경로 형식)>"
docker run --rm --user root --entrypoint sh -v "$SP":/agent:ro <이미지> \
  -c "cp /agent/<바이너리> /tmp/a && chmod +x /tmp/a && (ldd --version 2>&1 | head -1) && /tmp/a --version"
```

실측 결과: `centos:7`=glibc 2.17 / `gvenzl/oracle-xe:11-slim`=2.28 / `ubuntu:24.04`=2.39 / `node:12-slim`=2.24(여기서 linux-modern이 정확히 거부됨).

---

## 3. 테스트 데이터 규칙 (위반 시 실사고)

⛔ **전화번호를 `010`+랜덤 8자리로 만들지 않는다.** 실제 가입 번호와 겹친다.
이번 세션에 그렇게 만든 2만 건이 운영 PG의 테스트 회사 고객DB에 유입됐다(삭제 완료·잔존 0 확인). 그 회사로 발송이 돌았다면 모르는 사람에게 실제 문자가 나갔다.

- 형식 유효성(11자리)만 지키되 **도달 불가한 값**으로.
- 건수는 검증에 필요한 **최소**만. 키셋 페이지네이션 확인이 필요하면 그때만 늘린다.
- 동기화 대상 회사 = 테스트 계정(`hoyun`). 검증 후 화면에서 고객DB 삭제하고 **잔존 0을 SQL로 재확인**한다.

```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT COUNT(*) AS remain FROM customers WHERE source='sync' AND created_at >= NOW() - INTERVAL '3 hours';"
```

---

## 4. 매뉴얼 전면 수정 (`sync-agent/build-manual.js`)

설치 절차가 바뀌었다 — **INSTALL bat 실행 → 마법사 자동 진입**(별도 명령 불필요).
기존 매뉴얼의 "브라우저에서 `localhost:9876` 접속" 서술은 Windows Server에서 **틀린 안내**가 된다.

수정 범위
- 설치 절차를 자동 진입 기준으로 재작성
- 화면 캡처를 둘로 분리 — Windows Server = CLI 마법사 / Windows 클라이언트·Server 2022+ = 브라우저
- IE로는 진행 불가 명시 + `--setup-web`·`--setup-cli` 수동 실행 안내
- **docx는 §1 정정과 §2 검증이 끝난 뒤 1회만 생성.** 이번 세션에 1.6.4 docx를 먼저 만들었다가 마법사 결함으로 무의미해졌다.
- docx 빌더는 `C:/Users/ceo/AppData/Local/Temp/docx-build`에 `docx@7.8.2` 필요(8.x는 CJS export 없음)

---

## 5. 실행 순서 — 이 순서를 뒤집지 않는다

```
§1 코드 정정 → tsc 0 + 유닛 → Codex(증분 4단계)
  → §2 20조합 검증 → 통과분만 빌드 → zip 20개 서버 교체
  → §4 매뉴얼 docx 1회 → 아난티 발송
```

**이번 세션의 실패**: 빌드 → 업로드 → 매뉴얼을 먼저 하고 **그 뒤에** VM 검증을 해서, 마법사 결함이 나오는 바람에 전부 무의미해졌다. 검증이 앞이다.

**버전**: 1.6.4 라벨 유지(아직 어느 고객에게도 나가지 않았음이 전제). 나갔다면 1.6.5로 올린다 — 같은 라벨 다른 물건은 §2-4 사고 계열이다.

---

## 6. 명령 모음

```powershell
# 단일 티어 빌드 (전 티어 빌드는 15분+ 소요, 필요할 때만)
cd C:\Users\ceo\projects\targetup\sync-agent
node scripts/build-tier.js win-modern
node scripts/bundle-windows-runtime.js release/sync-agent-win-modern.exe dist-tiers/win-modern/SyncAgent --no-runtime
Compress-Archive -Path 'dist-tiers\win-modern\SyncAgent' -DestinationPath 'dist-tiers\downloads\sync-agent-win-modern-mysql.zip' -Force

# 전 티어 (검증 통과 후 1회)
npm run build:tiers
```

서버 업로드(`npm run upload:agents`)는 scp이므로 **Harold님이 직접 실행**한다.

**VM 재사용**: Server 2016 VM에 MySQL 8.0.46(서비스 `MySQL8`, 자동 시작)과 가짜 DB `anantidb`가 그대로 있다. root 비밀번호 `Ananti2026!`. 공유 폴더 `agentzip` → `sync-agent/dist-tiers/downloads`. VM 안 설치 경로는 공백 없는 `C:\SyncAgent` 고정.
