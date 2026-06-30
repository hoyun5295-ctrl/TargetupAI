# 싱크에이전트 원격 설치 + 장애 대응 가이드 (win-legacy × Oracle 10g 기준)

> 다른 세션에서 isae(또는 구형 Windows + Oracle) 고객사 원격 설치/장애를 갑자기 대응할 때 **이 문서 먼저 정독**.
> 2026-06-25 작성. VM(Windows Server 2008 R2 RTM + Oracle 10g) 실검증 기반. 상세 근거 = [[project_2026_0624_sync_agent_matrix_oracle_smoke]].

---

## 0. 한 줄 요약
- 검증된 조합 = **win-legacy(node12) × oracle-10g** (백엔드 `VERIFIED_COMBOS`에 `win-2008r2__oracle-10g` 등록). 빌드물에 oracledb 5.5.0 + sql.js 1.8.0 wasm + Oracle Instant Client 11.2 전부 동봉.
- 설치 = zip 압축 풀기 → `INSTALL-run-as-admin.bat` 관리자 실행(작업 스케줄러에 SYSTEM·부팅 자동 시작 등록) → `sync-agent.exe --setup-cli`(2008 R2는 IE8라 웹 마법사 안 됨) → 동기화.

## 1. 전제 확인 (먼저)
- 고객사 OS = Windows Server 2008 R2 / Win7(구형)? → win-legacy
- DB = Oracle 10g/11g(thick)? → oracle
- OS/DB가 다르면 위저드에서 그에 맞는 packageKey 선택(검증 안 된 조합은 "검증 전(베타)"로 직원 테스트용)
- ★ isae VM 검증 환경: 2008 R2 RTM(6.1.7600), Oracle 10g 10.2.0.4

## 2. 줄 파일 (한줄로 담당자가 준비)
1. 슈퍼관리자 → **싱크에이전트 배포** → Windows → Server 2008 R2 → Oracle 10g → "검증됨" 확인 → [이 버전 다운로드] = `sync-agent-win-legacy-oracle.zip` (약 137MB, Oracle Instant Client 포함)
2. 고객사 회사용 **API 키 / API 시크릿** 발급
3. (참고) `sync-agent/SyncAgent_설치매뉴얼.docx`
→ 서팀장(설치 담당)에게 전달

## 3. 설치 순서 (서팀장 원격)
1. zip 압축 풀기 → 나온 `SyncAgent` 폴더를 `C:\SyncAgent`에 복사
2. 폴더 안 `INSTALL-run-as-admin.bat` 우클릭 → **관리자 권한으로 실행** → "sync-agent v…" + 작업 스케줄러에 `SyncAgent` 작업(SYSTEM, 시스템 시작 시) 등록
3. cmd(관리자): `cd /d C:\SyncAgent` → `sync-agent.exe --setup-cli`
   - Step1: 서버 `https://hanjul.ai` / API 키 / API 시크릿
   - Step2: Oracle / host / port(1521) / 서비스명 / 계정 / 비번 — **읽기전용 계정 권장**
   - Step3: 고객 테이블 + 수정일시(timestamp) 컬럼 / 구매 테이블 + 주문일시 컬럼
   - Step4: AI 자동 매핑 (전화번호 매핑 필수)
   - Step5: Agent 이름 → 저장 → 동기화 시작
4. 동기화 결과(고객 N/N 성공) + 한줄로 관리자 화면 상태 녹색 확인
5. 자동 시작 검증: `sync-agent.exe --service-status` + `tasklist /FI "IMAGENAME eq sync-agent.exe" /V`에 **사용자명 SYSTEM** sync-agent.exe가 뜨면 정상

---

## 4. 혹시 모를 변수 / 장애 대응 (이 세션 실경험 전부)

### 4-1. Oracle 연결 단계
- **DPI-1047 / DPI-1072 (클라이언트 못 찾음/로드 실패)**: zip에 IC가 들어 있어도, 서버에 **VC++ 2005 재배포(redist)** 가 없으면 IC(11.2)가 로드 안 됨. → VC++ 2005 redist 설치. (Oracle 11g가 설치된 적 있는 서버면 보통 이미 있음. 이번 VM은 11g XE 잔재 덕에 우연히 됐음 = 순수 박스 주의.) ★ zip에 VC++ 동봉은 아직 미완(잔여).
- **NJS-045 (cannot load node-oracledb binary)**: oracledb 네이티브 모듈을 exe 스냅샷에서 못 읽음 = 외부 `oracledb` 폴더 누락. zip 안 `SyncAgent\oracledb\build\Release\oracledb-5.5.0-win32-x64.node` 존재 확인. (이미 fix — exe 옆 외부 폴더에서 로드. 안 떠야 정상.)
- **NJS-077 (Oracle Client library has already been initialized)**: 무해 경고(`initOracleClient`가 2회 호출). 연결은 정상이니 무시. (1회 가드는 잔여.)
- **ORA-xxxx**: DB단 문제(계정/리스너/서비스명). `sqlplus 계정/비번@//host:port/서비스명`으로 같은 정보 접속 테스트해 격리.
- 연결 문자열은 **서비스명 방식**(host:port/service). SID 아님.

### 4-2. 로컬 큐 / wasm
- **wasm function signature contains illegal type (QueueManager.init)**: sql.js wasm이 node12 엔진과 비호환. win-legacy zip의 `SyncAgent\sql-wasm.wasm` 크기가 **613426 bytes(=1.8.0)** 여야 함(659806=1.13.0이면 잘못된 것). (이미 fix. 안 떠야 정상.)

### 4-3. 동기화 데이터
- **NORMALIZE_FAILED (전화번호 정규화 실패) 경고**: 비정상/가짜 번호. 적재 자체는 됨(warn만). 실고객 정상번호면 안 뜸.
- **구매 0/N 성공 (구매 전건 실패)**: `purchases.cust_phone`이 `customers.phone`과 매칭 안 됨. 한줄로는 **전화번호로 고객-구매를 연결**하므로, 구매 테이블의 전화번호 컬럼이 고객 전화번호와 같은 값이어야 함. DB 데이터 확인.
- **고객명 ???? (한글 깨짐)**: DB 데이터 인코딩 또는 입력 SQL 파일 인코딩 문제.

### 4-4. 컬럼 매핑
- 한줄로 고객 식별 키 = **(company_id, store_code, phone)** = 전화번호. 전화번호를 바꾸면 새 고객으로 INSERT(중복). phone은 upsert에서 UPDATE 제외(키라서).
- 전화번호 매핑 필수(없으면 동기화 불가).
- 수신동의 컬럼을 매핑 안 하면 전체 고객이 수신동의로 등록됨.
- 매장/브랜드 구분 컬럼을 매핑 안 하면 단일 브랜드 처리.
- 표준필드 정의: `packages/backend/src/utils/standard-field-map.ts` (name/phone/gender/age/birth_date/email/address/region/구매4/store5/grade/points/sms_opt_in + custom_1~15).

### 4-5. 서비스 / 자동 시작
- INSTALL bat = **작업 스케줄러**(`SyncAgent` 작업, SYSTEM, 시스템 시작 시 자동) 등록. Windows 서비스(sc) 아님 → 그래서 정지가 `schtasks /End`.
- 자동 시작 검증: `schtasks /Run /TN SyncAgent` → 5~10초 후 `tasklist /FI "IMAGENAME eq sync-agent.exe" /V` → **SYSTEM 계정** sync-agent.exe(Services 세션 0)가 뜨면 진짜 작동.
- ★ **`--service-status`가 [RUNNING]이어도 실제 프로세스 0일 수 있음**(작업 등록 여부만 보고 표시). `tasklist`가 진실. (표시 개선은 잔여.)
- 정지: `schtasks /End /TN SyncAgent`. Ctrl+C 안 먹으면 창 X 또는 `taskkill /F /IM sync-agent.exe`.
- 제거: `sync-agent.exe --uninstall-service`.

### 4-6. 한줄로 측 (전체삭제 / 원격제어)
- 동기화 중 회사는 한줄로 UI에서 고객 수동변경(엑셀업로드/추가/수정/삭제/전체삭제) 차단 = `sync-active-check`(`use_db_sync=true AND sync_agents.status='active'`, `/api/customers/delete-all` 등에 적용).
- 전체삭제 등 필요 시: 에이전트 정지 + 서버 PG `UPDATE sync_agents SET status='inactive' WHERE company_id='회사id';` → 작업 후 에이전트 재시작하면 active 복원. (회사 id 식별: `SELECT company_id, COUNT(*) FROM customers WHERE company_id IN (...) GROUP BY company_id;` 로 대상 회사의 고객 수로 확인 — 운영 회사 잘못 건드리지 말 것.)
- 슈퍼관리자 원격 제어(heartbeat 명령): 일시정지/재개/전체동기화 트리거/Agent 삭제.
- **전체 재동기화**: `data\sync_state.json` 삭제 후 재시작(또는 슈퍼관리자 "전체 동기화" 버튼). 또는 소스 DB의 수정일시 컬럼을 현재로 갱신(`UPDATE ... SET upd_dt=SYSDATE`)하면 증분으로 다시 잡힘(증분 커서 이후라야 전송됨).

### 4-7. 설치 마법사 / 설정
- 2008 R2 = IE8라 웹 마법사(`--setup`) 빈화면 → **`--setup-cli` 필수**.
- pkg exe + Windows = stdin 파이프 주입 안 먹음(실키보드만). 자동화 입력 시도하지 말 것.
- 설정/매핑 변경: `sync-agent.exe --edit-config`(또는 `--setup-cli` 재실행, 기존 설정 불러옴).
- `config.enc` + `agent.key` = `data\`(AES-256-GCM 암호화). 유출 금지.

---

## 5. 키 명령어 모음 (설치 폴더 = `C:\SyncAgent`)
- 서비스 등록: `sync-agent.exe --install-service`(관리자) 또는 `INSTALL-run-as-admin.bat`
- 상태(등록): `sync-agent.exe --service-status`
- 실제 프로세스(진실): `tasklist /FI "IMAGENAME eq sync-agent.exe" /V`
- 작업 실행/정지: `schtasks /Run /TN SyncAgent` · `schtasks /End /TN SyncAgent`
- 강제 종료: `taskkill /F /IM sync-agent.exe`
- 설정: `sync-agent.exe --setup-cli` · `--edit-config` · `--show-config`
- 로그: `type logs\sync-YYYY-MM-DD.log`

## 6. VM 검증 환경 (참조용 — 실DB 아님)
- isae VM: 2008 R2 RTM, host 10.0.2.15:1521, service `orcl.0.2.15`, system `ghdbs0619!`, 테스트계정 `isae/isae1234`, customers/purchases 각 5만.
- 빌드 검증치: win-legacy-oracle.zip 137M(oracle-client 921항목 + oci.dll), `sql-wasm.wasm` 613426(1.8.0), `oracledb-5.5.0-win32-x64.node` 583680.
- VM 실검증 결과: 고객 5만 동기화 성공, 자동시작 SYSTEM 프로세스(PID Services 세션) 확인.

## 7. 관련 문서
- 상세 근거: `memory/project_2026_0624_sync_agent_matrix_oracle_smoke.md`
- 핸드오프: `docs/superpowers/handoffs/2026-06-24-sync-agent-oracle-smoke-debug-handoff.md`
- 고객 매뉴얼: `sync-agent/SyncAgent_설치매뉴얼.docx` (버전 무관 단일 파일)
- 빌드 룰표: `packages/backend/src/utils/agent-build-tiers.ts` (`VERIFIED_COMBOS`, OS_TIERS, DB_OPTIONS)
- 기존 진단: `status/SYNC-AGENT-TROUBLESHOOTING.md`
