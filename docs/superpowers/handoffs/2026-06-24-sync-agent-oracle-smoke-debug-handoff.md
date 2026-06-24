# 2026-06-24 핸드오프 — 싱크에이전트 OS×DB 빌드 매트릭스 + Oracle 10g 스모크 디버깅(진행 중)

## 0. 한 줄
싱크에이전트를 (OS시대 × DB버전) 전담 빌드로 재편(코드·빌드 완료) + win-legacy×Oracle 10g 실연결 스모크를 VM(2008 R2)에서 검증 중. **node12 사망 fix는 실하드웨어에서 증명 완료**, 그러나 **에이전트가 10g에 붙는 마지막 단계에서 막힘** — 에러가 `{}`로 가려져 있어, 에러를 노출하는 진단 exe를 빌드해 둔 상태. **다음 세션 1순위 = 그 진단 exe로 진짜 에러(DPI/ORA) 확인 → 원인 확정 → 수정.**

---

## 1. 이번 세션 완료분 (코드 완료 · 배포는 주인님 git)

### A. OS×DB 전담 빌드 매트릭스 (설계→구현→빌드)
- 설계서: `docs/superpowers/specs/2026-06-24-sync-agent-os-db-matrix-v2.md` (브레인스토밍 v1 + GPT 적대검토 반영). 적대검토 원문 = `...-adversarial-review.md`, v1 = `...-brainstorm.md`.
- 구현계획: `docs/superpowers/plans/2026-06-24-sync-agent-os-db-build-impl.md`.
- **핵심 구조**: 빌드(exe)=node티어×드라이버 / 다운로드(zip)=packageKey `<buildTier>-<driver>` / DB버전 커버는 zip 수가 아니라 resolveAgentBuild의 **state**(blocked/candidate/verified)로. verified(실스모크 통과 = `VERIFIED_COMBOS`)만 위저드 노출(fail-closed).
- **T1** `packages/backend/src/utils/agent-build-tiers.ts` + `agent-build-tiers.sanity.ts`: state 모델 + 버전 인지 DB_OPTIONS(mssql-2008/mssql-modern/oracle-10g/11g/12c/19c/mysql/postgres) + resolveAgentBuild(packageKey/state/mode/nativeClient). 검증: backend tsc 0, sanity **14/14**.
- **T2** `packages/backend/src/routes/admin-sync.ts`: `/build-tiers` 부트스트랩이 `verifiedCombos` 반환, `/download/:packageKey`. tsc 0.
- **T3** `packages/frontend/src/components/admin/AgentDeployWizard.tsx`: 버전 DB 선택 + state 게이팅(verified="검증됨" / candidate="검증 전(베타)" / blocked=숨김) + packageKey 다운로드. frontend tsc 0 + 금지어(박/모델명/dialog) 0.
- **T4** `sync-agent/scripts/build-tier.js`(드라이버 명시 핀 + node12 es-check 가드) + `build-tiers.js`(20 packageKey zip + manifest state). **빌드 실행 완료**: 5 exe + 20 zip(`dist-tiers/downloads/sync-agent-<tier>-<driver>.zip`) + `release/build-manifest.json`(전부 state=candidate). 단 **로컬 빌드까지만 — `upload:agents` 미실행(주인님 PowerShell)**.
- ★ **es-check 가드가 실제 사고를 잡음**: `mssql@8.1.4`만 핀하면 transitive **tedious가 18.6.2(node20용 `??`)로 남아** node12 사망 재발. 가드가 빌드 실패로 잡아냄 → win-legacy `tedious@14.7.0`, win-mid/linux-legacy `tedious@16.7.1` **명시 핀**으로 차단. tedious 14.7.0 자체는 `?.`/`??` 0(es-check 통과 확인).
- ★ GPT와 다르게 간 1건: Server 2012 비R2를 GPT는 node16 experimental 분리 권고했으나, **확실히 도는 node12(win-legacy)에 보수적으로 유지**(node16 동작 불확실, 스모크 후 승격).

### B. DM 담당자 테스트발송 미발송 fix
- `packages/backend/src/routes/dm.ts`: app_etc1을 옛 `dm-test-${UUID}-${Date.now()}`(58자) → **`'test'`**(캠페인과 통일). 근본 = `SMSQ_SEND_10.app_etc1`이 **varchar(50)** 이라 58자가 넘쳐 INSERT가 'Data too long'으로 던져졌고 per-phone catch에 삼켜져 화면만 "요청을 보냈어요"였음. + 전건 적재 실패(sent=0) 시 500+실패 반환(거짓 200 차단). 호출처 4곳 전수(DM만 overflow). backend tsc 0.

### C. 보류/별도
- spawn_task(task_9ae1ed34) 펜딩: 싱크에이전트 설치 마법사(cli.ts/server.ts/setup-html.ts)가 고객에게 **"Claude Opus 4.7" 모델명 노출** → 추상 명칭으로 정리. (no_model_name_ui_exposure 위반.)

### 이번 세션 변경 파일(git 푸시 대상)
backend: `utils/agent-build-tiers.ts`, `utils/agent-build-tiers.sanity.ts`, `routes/admin-sync.ts`, `routes/dm.ts`
frontend: `components/admin/AgentDeployWizard.tsx`
sync-agent: `scripts/build-tier.js`, `scripts/build-tiers.js`, `src/db/oracle.ts`
docs: specs/2026-06-24-sync-agent-os-db-matrix-{brainstorm,v2,adversarial-review}.md, plans/2026-06-24-sync-agent-os-db-build-impl.md, 이 핸드오프
(빌드 산출물 `dist-tiers/`, `release/build-manifest.json`은 로컬 — 커밋 X)

---

## 2. ★ Oracle 10g 스모크 (진행 중 · 막힌 지점) ★

### 목표
win-legacy(node12) 에이전트가 **동봉한 IC 11.2 클라**로 2008 R2 + Oracle 10g에 붙어 한글 5만건을 한줄로로 동기화 → `win-2008r2__oracle-10g`를 VERIFIED 승격.

### 증명 완료
- **node12 사망 fix 실증**: VM(2008 R2 **RTM 6.1.7600**, SP1도 아님)에서 `sync-agent.exe --version`=v1.5.6 EXIT 0, `--setup-cli` 5단계 마법사 정상 표시. **원래 죽던 `SyntaxError '?'` 안 남.** UCRT 동봉도 RTM에서 통함. (= 이번 세션 핵심 성과.)
- **동봉 IC 방식 호스트 검증**: `win-legacy-oracle.zip`에 `oracle-client/` 폴더(290M = 호스트 11g XE의 `server\bin` **전체** + nls + oracore + network + rdbms/mesg) 동봉. `oracle.ts`가 exe 옆 `oracle-client/`를 자동 감지 → `initOracleClient({libDir})` + `ORACLE_HOME` 지정. **호스트에서 oracledb 6.10으로 테스트: client 11.2.0.2.0 로드 + ORA-01017 도달 성공.** (단 **.dll만 복사한 서브셋은 DPI-1072 실패** → bin **전체** 필요. 이게 290M 이유.)

### VM 환경 (VirtualBox `isaetest`)
- 2008 R2 RTM(6.1.7600), NAT IP **10.0.2.15**.
- 11g XE는 **VM에서 삭제됨**(주인님, 백업 전 삭제 — 단 VC++ 2005 재배포는 남음: `WinSxS`에 `vc80.crt 8.0.50727.762/.4927` 존재 확인). **IC 11.2 원본은 호스트 PC `C:\oraclexe`에 11g XE 설치돼 있음**(거기서 추출함).
- **Oracle 10g 10.2.0.4 Enterprise** 설치됨: oraparam.ini의 `Windows=...`에 `6.1` 추가해 OS체크 우회 + 고급설치 + 홈이름 `OraDb10g_home1` + 홈 `C:\oracle\product\10.2.0\db_2` + system 비번 **`ghdbs0619!`**.
- 테스트 데이터: `test-data.sql`로 유저 **isae/isae1234** + `customers`·`purchases` 각 5만건(한글 `고객N번`/`상품N호`, timestamp `upd_dt`/`ord_dt`). cmd에서 한글 별칭이 `??????`로 보인 건 콘솔 표시 문제(데이터는 정상 적재).
- **리스너**: `10.0.2.15:1521`에 바인딩(localhost 아님 — 10g 설치기가 NAT IP를 잡음). 서비스 **`orcl.0.2.15`** READY.
- **sqlplus `isae/isae1234@//10.0.2.15:1521/orcl.0.2.15` = Connected** (= host/port/service/계정/비번 전부 유효).

### 막힌 지점 (THE BUG)
에이전트 Step 2(DB종류 3, host **10.0.2.15**, port 1521, DB이름 **orcl.0.2.15**, isae/isae1234) → **`error [db:oracle] Oracle 연결 실패 ("error":{})`** — **빈 `{}` 에러**. `testConnection()`이 진짜 에러를 삼키고 false만 반환 + `logger.error('...', {error})`가 `{}`로 직렬화돼 원인이 안 보임.

**배제 완료(추측 아님, 실측):**
- 입력값 X — 같은 값으로 sqlplus는 붙음.
- 리스너/서비스/isae/비번 X — sqlplus로 다 확인.
- VC++ 2005 누락 X — VM `WinSxS`에 vc80.crt 있음.
- 동봉 클라 자체 결함 X — 호스트에서 oracledb 6.10으로 같은 클라 로드+도달 성공.

**작동(host, oracledb 6.10) vs 실패(agent, oracledb 5.5.0/node12)의 차이:**
1. oracledb 버전: host=6.10 / agent=**5.5.0**(node12 thick 라인).
2. node 버전: host=node20 / agent=**node12**(pkg 바이너리).
3. DB 서버: host 테스트는 11g XE(11.2) / agent는 **10g(10.2)**.

### 진단 준비 완료 (다음 세션 시작점)
`sync-agent/src/db/oracle.ts`의 로깅을 **진짜 에러 노출**로 고침(`{error}` → `error.message`+`stack`, require/initOracleClient/connect/testConnection 4곳). **win-legacy 재빌드 완료**(es-check 통과, exe 98M). 새 exe 위치:
`C:\Users\ceo\projects\targetup\sync-agent\dist-tiers\win-legacy\SyncAgent\sync-agent.exe` (이름 맞춤, oracle-client 그대로).

이 exe는 **연결을 고치는 게 아니라 에러를 보여주는 진단용.** 적용 절차(주인님이 아직 실행 안 했을 수 있음):
1. (호스트) 위 exe를 공유폴더로.
2. (VM) `schtasks /End /TN SyncAgent` (실행 중 에이전트 정지 = exe 잠금 해제).
3. (VM) `C:\Users\Administrator\Desktop\sync-agent-win-legacy-oracle\SyncAgent\sync-agent.exe` 덮어쓰기.
4. (VM) `sync-agent.exe --setup-cli` → Step 2(3 / 10.0.2.15 / 엔터 / orcl.0.2.15 / isae / isae1234) → 이번엔 `"error":"진짜 메시지"`가 뜸.

---

## 3. 다음 세션 할 일 (순서)

1. **진짜 에러 확보** — 위 진단 exe로 VM에서 Step 2 재현 → `"error":` 뒤 메시지 확인.
2. **원인 분기**:
   - **DPI-xxxx**(클라 로드/초기화) → 동봉 클라 또는 oracledb 5.5.0 네이티브 문제. ★최우선 의심 = **oracledb 5.5.0이 node12 pkg에서 실제 로드되는가**(설계서 §9-A: 5.5.0은 Node18로 빌드된 N-API 플랫폼 바이너리 — node12 prebuilt ABI 실재 미검증). 안 되면 핀을 **5.3.0/5.0.x**(node12 stated 지원 마지막)로 내리고 재빌드. oracledb 5.x prebuilt의 node12(ABI/NAPI) 게시 여부를 npm/GitHub release로 확인.
   - **ORA-xxxx**(DB단) → 10g(10.2) + IC 11.2 + oracledb 5.5.0 조합. IC 11.2는 DB 9.2+ 도달이라 10.2 OK여야 함 — ORA 코드로 정확 판단.
   - 그 외(pkg .node 추출 경로, 동봉 oracle-client와 충돌 등).
3. **수정 → 재빌드 → VM 재검증 → `win-2008r2__oracle-10g` 를 `VERIFIED_COMBOS`에 추가** → 위저드 "검증됨" 노출.
4. **고객 패키징 보강**: VC++ 재배포를 zip+INSTALL bat에 동봉(이번 VM은 11g XE가 깔아놨던 게 남아 우연히 됐지만, 순수 10g 박스는 11.2 클라용 VC++ 2005가 없을 수 있음). 다른 티어(win-mid/modern·linux) oracle 패키지에도 동봉 클라 일괄 적용(스테이징 `/c/Users/ceo/oracle-client-11.2-stage` 재사용).
5. **배포 점검**: A(매트릭스)·B(DM fix) git 푸시 됐는지 + sync-agent zip `upload:agents` 여부.
6. spawn_task(모델명 노출) 처리.

---

## 4. 키 값 모음 (다음 세션 빠른 참조)
- VM 10g: host=`10.0.2.15`, port `1521`, service `orcl.0.2.15`, system `ghdbs0619!`, 테스트유저 `isae/isae1234`, 테이블 `customers`/`purchases`(5만), home `C:\oracle\product\10.2.0\db_2`, 홈이름 `OraDb10g_home1`.
- 호스트 11g XE(IC 11.2 원본): `C:\oraclexe\app\oracle\product\11.2.0\server\bin`.
- 동봉 클라 스테이징(호스트): `C:\Users\ceo\oracle-client-11.2-stage`(bin전체+nls+oracore+network+rdbms/mesg, 290M).
- 진단 exe: `sync-agent/dist-tiers/win-legacy/SyncAgent/sync-agent.exe`(98M, 에러 노출판).
- 에이전트 설정: `--setup-cli`(2008 R2는 IE8라 웹 `--setup` 빈화면 → CLI 필수). Step1 API키는 주인님 슈퍼관리자 발급분(검증 안 하고 저장). Step4 AI매핑 n.
- VM 로그: `...\SyncAgent\logs\sync-/error-YYYY-MM-DD.log`(현재 포맷은 nested error를 `{}`로 남김 — 그래서 진단 exe 필요).
