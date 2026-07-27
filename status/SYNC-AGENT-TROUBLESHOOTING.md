# 싱크에이전트 트러블슈팅 가이드

> **작성**: 2026-04-21 (D131) — 실점검 중 발견된 3개 이슈 해결 기록 + 향후 진단 프로토콜
> **참조 우선순위**: 싱크에이전트 관련 이슈 발생 시 **이 문서를 먼저** 읽고 § 3 진단 체크리스트부터 실행.
> **설계 문서**: `SYNC-AGENT-V1.5.0-DESIGN.md` (구조), `SYNC-AGENT-V1.5.0-QA-GUIDE.md` (QA)

---

## § 1. 시스템 구조 개요

```
[고객사 내부 Agent 서버]                  [한줄로AI 서버]
  sync-agent (Node.js)     ─── HTTPS ──▶  58.227.193.62
  ├─ cron 스케줄러                          ├─ /api/sync/* 엔드포인트
  │   ├─ heartbeat: 매 정각 (1시간)         ├─ sync_agents 테이블
  │   ├─ customers sync: config 주기        ├─ sync_logs 테이블
  │   └─ purchases sync: config 주기        └─ sync_releases 테이블 (버전 관리)
  ├─ MS-SQL/MySQL 등 로컬 DB 연결
  ├─ logs/sync-YYYY-MM-DD.log
  └─ logs/error-YYYY-MM-DD.log
```

### 요청 흐름
1. Agent `POST /api/sync/register` — 등록/인증
2. Agent `POST /api/sync/customers` — customers 벌크 UPSERT (FIELD_MAP 기반)
3. Agent `POST /api/sync/log` — 동기화 결과 기록 (sync_logs)
4. Agent `POST /api/sync/heartbeat` — 하트비트 + config.commands pull
5. Agent `GET /api/sync/version` — 버전 체크 (자동 업데이트 여부)

### 명령 전달 구조 (슈퍼관리자 → Agent)
- 슈퍼관리자 UI "전체동기화" 클릭 → `POST /api/admin/sync/agents/:id/command` →
  `sync_agents.config.commands` JSONB 배열에 **push**
- Agent가 다음 sync 요청 시 **응답 config로 commands를 받아 실행**
- ⚠️ **Agent가 죽어있으면 명령이 아무리 쌓여도 실행 안 됨** (주요 착각 지점)

---

## § 2. 2026-04-21 실점검 이슈 3건 — 해결 기록

### 2-1. 상태값 "지연" 오표시 (admin-sync.ts 판정 기준 vs Agent 주기 불일치)

**증상**: 정상 동작 중인 Agent가 하루의 1/3 시간 동안 노란색 "● 지연"으로 표시.

**원인**:
- Agent `heartbeat` 주기: 매 정각 1회 = **60분** (`sync-agent/src/scheduler/index.ts` L125: `cron.schedule('0 * * * *', ...)`)
- 한줄로AI `getOnlineStatus()` 판정: ≤10분 online / ≤30분 delayed / >30분 offline
- 60분 주기인데 30분이면 offline 판정 → 구조적 모순

**해결** ([admin-sync.ts:22-32](../packages/backend/src/routes/admin-sync.ts#L22-L32)):
```ts
if (diffMinutes <= 70)  return 'online';    // 1주기(60분) + 10분 여유
if (diffMinutes <= 130) return 'delayed';   // 2주기(120분) + 10분 여유
return 'offline';                            // 2주기 초과 = 확실한 이상
```

**교훈**: Agent 주기와 서버 판정 기준은 **항상 동기화**되어야 함. 하드코딩 값 있을 경우 관련 기능 변경 시 반드시 양쪽 동시 점검.

---

### 2-2. customers full sync 전건 실패 — `region` 컬럼 중복

**증상**: 슈퍼관리자 "전체동기화" 클릭 → sync_logs에 `total=1500, success=0, fail=1500, error_message=NULL` 기록 + customers 테이블 0건.

**원인** (근본 ─ `routes/sync.ts`):
- `insertCols = ['company_id', ...columnNames, 'birth_year', 'birth_month_day', 'region', 'custom_fields', ...]`
- `columnNames`는 FIELD_MAP의 `storageType='column'` 필드(21개)로, **region이 이미 포함**
- 추가로 L631에서 `'region'`을 다시 쓰면서 **INSERT 컬럼에 region 2번** → PostgreSQL 에러:
  ```
  ERROR: multiple assignments to same column "region"
  file: 'parse_target.c', line: '1075', routine: 'checkInsertTargets'
  ```
- `failures` JSONB가 비어있어서 sync_logs에서 사유 확인 불가능 (별개 로그 버그)

**해결** — **인라인 제거 + 컨트롤타워 추출**:
1. `utils/customer-upsert.ts` 신설 — FIELD_MAP 기반 동적 `insertCols`/`updateClauses`/`values` 단일 진입점
2. `routes/upload.ts` + `routes/sync.ts` + `routes/customers.ts`(단건/벌크) 모두 `createCustomerUpsertBuilder().buildBatch()` 호출로 교체
3. **region 같은 FIELD_MAP 컬럼은 `columnNames`에만 포함 → 중복 추가가 구조적으로 불가능**

**교훈**:
- 동일 로직이 2곳(upload.ts/sync.ts)에 인라인 존재 = 즉시 컨트롤타워 추출 (CLAUDE.md 7-1)
- 싱크에이전트 구현 시 기존 `upload.ts` 패턴 그대로 복제 원칙(`feedback_mirror_hanjul_standard.md`) 이번에 위반 → 재발 방지를 위해 컨트롤타워로 통합

---

### 2-3. Agent 크래시 — `sync_releases.checksum` 컬럼 누락

**증상**: nginx access 로그:
```
GET /api/sync/version?current_version=0.1.0... HTTP/1.1 500
```
이후 Agent가 heartbeat/sync 47분 이상 중단.

**원인** ([sync.ts:1113-1119](../packages/backend/src/routes/sync.ts#L1113-L1119)):
```ts
SELECT version, download_url, checksum, release_notes, force_update, released_at
  FROM sync_releases
 WHERE is_active = true
```
`checksum` 컬럼이 DB에 없음 → SELECT 파싱 단계에서 즉시 500 → Agent가 이 500을 받고 프로세스 크래시 또는 무한 대기.

**해결**:
```sql
ALTER TABLE sync_releases ADD COLUMN IF NOT EXISTS checksum VARCHAR(255);
```
+ Agent 서버에서 프로세스 재시작 (§ 5 참조).

**교훈**:
- "부차적"으로 분류된 에러도 **실사용 흐름의 critical path에 있으면 치명적**. 사이드 이펙트 반드시 따져볼 것.
- 배포 시 **sync 관련 테이블 스키마 변경이 한줄로AI와 Agent 양쪽 배포에 반영되었는지** 확인 필수.

---

### 2-4. 2026-06-11 인비토 첫 연동 3건 — 버전 불일치 / 정규화 제외 / 증분 매 주기 실패 (v1.5.5)

**증상 3건** (인비토 직원 캡처 실측):
1. 전달 파일 라벨 1.5.4인데 실행 배너 `Sync Agent v1.5.1` + 모니터링 버전 1.5.1 (재설치 2~3회 동일)
2. 전체 동기화 1502건 중 1건 `[NORMALIZE_FAILED]` (18008125000 — 1800 대표번호)
3. 60분 주기 증분 동기화가 매 주기 `Invalid column name 'updated_at'` (MSSQL 207) 실패 → 신규/수정 데이터 영구 미반영

**원인**:
1. (a) 배너/heartbeat/등록/업데이터가 전부 **config.enc 저장값(agent.version)** 을 보고 — 실행 파일 자신의 버전 출처가 없었음. (b) 버전 문자열 5곳 하드코딩(1.4.0/1.5.4 혼재). (c) 고객 로그의 raw EREQUEST JSON = D151-5(2026-05-11) 이전 빌드가 실행 중이라는 증거 — 로컬 release exe(5-11 빌드, D151-5 포함)와 다른 구버전이 현장에서 돌고 있었음 (전달물 구버전 또는 교체 미반영 — 현장 판별 수단 부재).
2. 정상 설계 동작 — 수신 불가 형식 행은 제외 + 로그 기록 (D151-5에서 정책 컨펌 완료).
3. 웹 설치 마법사가 timestamp 컬럼을 묻지 않고 `updated_at` 고정 기록 + 고객 테이블(SyncTest)에 해당 컬럼 없음 + **fallbackToFullSync가 config 전 경로에 선언만 있고 소비처 0건**이라 동작 안 함.

**해결 (v1.5.5)**:
1. **버전 단일 진입점** `src/version.ts` AGENT_VERSION 신설 — esbuild define으로 package.json version 주입(dev는 package.json 직접 읽기). 배너/heartbeat/등록/checkVersion/UpdateManager 전부 AGENT_VERSION 사용. 저장 4경로(saveConfigEncrypted/saveConfig/saveConfigJson/updateConfigEncrypted)에서 agent.version을 실행 파일 버전으로 강제. 하드코딩 5곳 제거(잔존 0 grep 확인). 배너에 설정 기록 버전 불일치 안내 1줄 추가.
2. `--version` 플래그 신설 — 설정 파일 없이 `sync-agent.exe --version` → `sync-agent v1.5.5`. 전달/교체 검증용.
3. **fallbackToFullSync 실구현** — 증분 직전 `getColumns`로 timestamp 컬럼 실재 검증(대소문자 무관, 전 DB 어댑터 공통): 없으면 true=전체 동기화로 대체(warn) / false=한국어 에러로 중단. 메타 조회 실패(권한 등)=기존처럼 증분 시도(비악화). + 기동 시 `validateTimestampColumnsAtStartup()` 즉시 경고(60분 뒤에야 드러나는 일 차단). vitest 9건.

**전달 패키지 (2026-06-11 v1.5.5 일괄 재생성 — 1.5.4 이하 산출물 전부 삭제)**:
- `sync-agent/installer/SyncAgent-Setup-1.5.5.zip` (전달용 — Setup exe + 설치매뉴얼 v1.5.5 PDF 동봉)
- `sync-agent/installer/SyncAgent-Setup-1.5.5.exe` (NSIS 설치 파일, FileVersion 1.5.5)
- `sync-agent/installer/SyncAgent-1.5.5-linux-x64.tar.gz`
- `sync-agent/SyncAgent_설치매뉴얼_v1_5_5.docx/.pdf` — v1.5.5 갱신본 (표지/머리글/Setup 파일명/tar 폴더명 1.5.5 + 웹 마법사 Step 3 실동작 정정(timestamp 입력 UI 없음 — updated_at 기본 기록) + 수정일시 컬럼 부재 시 전체 동기화 대체 동작 + --version 명령 + Q4 갱신). 이전 v1_5/v1_5_4 매뉴얼 삭제.
- 참고: 삭제된 옛 `SyncAgent-Setup-1.5.4.zip`은 4-28 빌드(D151-5 이전)였음 — Setup exe(5-11)와 달리 zip만 미갱신 상태였고, 이것이 인비토에 전달됐다면 구버전 증상과 시점이 일치.
- 빌드 절차: `npm run build:exe`(+`build:linux`) → makensis 직접 호출 `/DPRODUCT_VERSION=x.y.z /DHAS_ICON` (build-installer.bat은 LF 줄바꿈이라 cmd 파싱이 깨짐 — 직접 호출 필요) → `bash build-linux-package.sh x.y.z` → zip 압축.

**교훈**:
- 버전의 진실은 빌드 산출물 자신이어야 한다 — 설정 파일 저장값을 표시/보고에 쓰면 교체 검증이 불가능해진다.
- config 플래그는 선언+기본값만 있고 소비처가 없으면 "있는 척하는 설정"이 된다 — 신규 설정 추가 시 소비처 grep 확인.
- 현장 실행 파일과 로컬 최신 빌드가 같다는 가정 금지 — `--version`/SHA-256으로 전달물 검증.
- 산출물은 같은 버전 라벨이라도 생성 시점이 다르면 다른 물건 — 라벨 갱신 시 모든 패키지(exe/zip/tar.gz)를 한 번에 재생성하고 옛 것은 남기지 않는다.

---

### 2-5. 2026-06-22 인비토 2008 R2 + Oracle — node14 빌드 전제 오류(원격 3회 실패) 근본 해결

**증상**: Windows Server 2008 R2 SP1(6.1.7601)에 설치 → exe가 실행조차 안 됨. `EXIT_CODE=-1073741511`(= `0xC0000139` STATUS_ENTRYPOINT_NOT_FOUND). 관리자 권한·경로 변경 무관. 고객사 개발자 원격 3회 모두 실패.

**근본 원인 (두 겹)**:
1. 빌드 티어 설계(2026-06-16)가 "node14 = 2008 R2 최저선"이라는 **틀린 전제** 위에 섰다. 공식 확인(BUILDING.md): node14의 Windows 바닥은 **8.1 / 2012 R2**이고, node14+는 수명 끝난 Windows에서 실행을 막는다(nodejs/node PR #31954). 2008 R2가 도는 마지막 Node는 **node12**(13.6.0까지 테스트). 고객사엔 기본 빌드(node20)가 나가 `0xC0000139`로 죽었다.
2. 고객 DB = Oracle 11g. node12에서 Oracle은 **thick 전용**(thin은 oracledb 6.0+/node14.6+ 필요, 게다가 thin은 DB 12.1+만 지원). 11g엔 thick 필수.

**해결**:
- `win-legacy` 티어 node14 → **node12**(`build-tier.js`/`build-tiers.js`/`agent-build-tiers.ts`). oracledb는 **5.x thick**(napi 바이너리 1개가 node12~20 공통, pkg `assets`에 `.node` 동봉). mssql9·nodemailer6로 node12 호환.
- 에이전트 Oracle 조회의 `OFFSET … FETCH`(12c+ 전용)는 11g에서 `ORA-00933` → **ROWNUM 방식**(11g+12c 공통)으로 교체(`oracle.ts` fetchAll·fetchIncremental).
- thick 클라이언트는 PATH 의존이라 Windows 서비스에서 `DPI-1047` 위험 → `ORACLE_HOME` 있으면 `initOracleClient({libDir})` 명시(`oracle.ts`).
- 위저드 "원본 DB" 목록에서 엑셀/CSV 제거(싱크에이전트는 DB 커넥터 — 파일만 있으면 앱 직접 업로드).

**검증 (Docker로 고객 환경 재현)**: `gvenzl/oracle-xe:11-slim`(11g) + node12 컨테이너 + thick → 연결·테이블·컬럼·증분·한글·페이지네이션 정상, 11g `OFFSET/FETCH` 깨짐·`ROWNUM` 정상 실측. node12 Windows exe 빌드 + 단일 exe 안에서 oracledb 네이티브 로드 확인.

**교훈**:
- "node X = OS Y 지원"은 공식 BUILDING.md / 지원 표로 확정(추측 금지). node14는 2008 R2 미지원이다.
- 구형 OS 고객은 그 OS·DB를 **Docker로 재현해, 보내기 전에 우리 쪽에서 실측**한다(고객 장비를 시험대로 쓰지 않는다). Oracle 11g·MSSQL 등은 컨테이너로 띄울 수 있다.
- 단일 exe + 네이티브 드라이버(oracledb)는 napi 바이너리를 pkg `assets`로 동봉하면 로드된다.

**build:tiers 경고는 무해 (빌드 실패 아님)**: `Cannot resolve 'mod'`(어느 의존성의 런타임 변수 동적 require), `open`·`xdg-open`·`default-browser`·`is-wsl` bytecode 실패, `@azure/*`·`tedious` bytecode 실패, `import.meta` parse 실패 — 전부 경고일 뿐 `완료:`가 찍히면 그 티어 성공. `open`(브라우저 여는 유틸)은 mssql의 Azure 인증 경로로 딸려온 미사용 의존성이라 에이전트가 안 부른다(에이전트 src grep 0건). 빌드 성공 판정 = 5티어 `완료:` + `동봉 완료`(win-mid/legacy 각 UCRT DLL 49개) + `다운로드 zip 생성`(5개) + `manifest 생성`이 다 뜨면 정상. 경고를 지우려고 작동하는 빌드 설정(esbuild external·pkg config)을 건드리지 말 것 — `open` 잘못 제외 시 mssql 깨질 위험, 실익은 출력 청소뿐.

### 2-6. 2026-07-03 isae — 자동 업데이트 감지·다운로드는 무선 성공, 마지막 교체 단계 실패 (updater 자기교체 결함) ★해결(v1.6.0, 전 티어 게이트 통과)

> **해결 요약 (2026-07-03, v1.6.0)**: updater 자기교체를 서비스/작업 밖에서 원자적으로 수행하도록 근본수정. 코드 = `sync-agent/src/updater/scripts.ts`(순수 빌더) + `updater/index.ts`(가드·실행) + `updater/restart.ts` + `index.ts` self-heal.
> - **Windows**: 교체 bat을 SyncAgent 작업 job 밖(별도 일회성 작업 `SyncAgentUpdate`)에서 실행 → `schtasks /End /TN SyncAgent`에 생존. spike + 실 2008 R2 VM E2E 통과.
> - **Linux**: 교체 sh를 `systemd-run --unit=sync-agent-update`(transient **서비스**, `--scope` 아님)로 실행 → 서비스 cgroup·`ProtectSystem` 밖에서 실행(stop 생존 + exe 쓰기 가능). spike-2 + Docker systemd E2E 통과.
> - **원자 스왑**: `move /y`(NTFS)·`mv`(rename) = 동일 볼륨 원자 교체 → exe 부재 순간 제거(브릭 차단). 옛 `rename→copy` 공백 패턴 폐기.
> - **하드닝**: 빈 버전 가드, checksum 필수화(미제공 시 거부), self-heal 잔여물(.old/.new) 정리, 교체/재시작 트리거 성공 확인 후에만 `process.exit(0)`.
> - **restart 명령 동반 수정**: 예약작업/systemd 모델에서 `process.exit(0)`은 자동 재시작 안 됨(exit 0=정상종료) → 별도 작업(Win)·`systemctl restart` 위임(Linux)으로 실제 재기동.
> - **★ schtasks 함정(2008 R2 VM E2E가 잡음)**: `schtasks /TR "C:\...\x.bat"`(bat 경로만)은 2008 R2에서 작업이 bat을 **실행하지 않는다**. 반드시 `/TR "cmd /c <bat>"`. 설치 경로 공백 없음(C:\SyncAgent) 전제.
> - **버전 1.6.0**, 5티어 재빌드 완료, 티어별 sha256 = 릴리즈 `sync_releases.checksum`. isae 1.5.7은 동결(자동 안 밈), 필요 시 수동 1회 교체.
> - **설치 마법사 라우팅 동반 수정**: 2008 R2 IE8 웹 설치 마법사 미동작 → `resolveSetupMode`(`src/setup/setup-mode.ts`)로 old Windows(release major<10 = 2008 R2/7/8/8.1/2012/2012 R2) 감지 시 `--setup`·설정없음 진입을 CLI 마법사(`--setup-cli`)로 자동 라우팅. modern(10/11/2016+) 웹 유지. `src/main.ts` 2경로 적용, 유닛 6. 설계서 `docs/superpowers/specs/2026-07-03-sync-agent-updater-selfreplace-design.md`.
> - **★ 릴리즈 배포 안전(치명적)**: 5티어 무선용 서버 보완 = `POST /api/admin/sync/releases` download_url 티어 인코딩(`buildReleaseDownloadUrl` → `/api/sync/download/<version>-<tier>`) + `npm run upload:releases`(exe → `agent-releases/sync-agent-<version>-<tier>.exe`). **주의: 1.5.x→1.6.0 무선 교체는 불가**(교체를 1.5.x의 깨진 updater가 수행) → 기존 1.5.x 박스 있는 티어에 1.6.0 **active 등록 금지**(win-legacy=isae 1.5.7 가동 중 → 등록 시 감지→깨진 자가교체→정지 사고 재현). 등록은 다음 버전(1.6.1)부터(박스가 1.6.0 된 뒤). **파일 업로드(zip·exe)는 안전** — 자동교체 트리거는 파일이 아니라 sync_releases 테이블(`/version`)뿐. 2026-07-03 세션: upload 완료, sync_releases 등록은 의도적 보류, isae 무손.


**증상**: 서버에 새 exe 릴리즈 등록 후, 박스가 정각에 `GET /version`으로 새 버전 감지 → `/download` 200으로 exe 전량(103MB) 수신까지 무선으로 성공. 그런데 `current_version`이 새 버전으로 안 올라오고 박스가 멈춤(heartbeat 정지). tasklist 프로세스 없음, 예약작업 상태=준비(마지막 결과 0=정상종료).

**근본 원인 (확정)**: updater가 다운로드 후 `temp\update.bat`을 생성·실행하고 `process.exit(0)`로 자신을 종료하는 구조인데, **그 update.bat의 step 1이 `schtasks /End /TN SyncAgent`다. bat은 SyncAgent 작업(에이전트)이 spawn한 자식 = 같은 작업 job 소속**이라, 에이전트 exit(0) 또는 이 `/End`가 job을 닫는 순간 **bat도 rename(step 2) 전에 함께 종료**된다. 결과: exe 교체·재시작 미수행, 감지·다운로드까지만 되고 죽음. 증거 = `.old` 미생성 + `sync-agent.exe`가 옛 크기/날짜 그대로 + `temp\sync-agent-<버전>.exe`는 존재.

**부수 함정 2개(오늘 별개로 해소)**:
- 슈퍼관리자에서 옛날에 넣어둔 stale `restart` 명령이 큐에 남아 있으면, 재기동한 에이전트가 첫 heartbeat에 그 명령을 집어 스스로 재시작→죽음. (큐는 1회 전달 후 서버가 비우므로 자연 소비되나, 재기동 루프처럼 보인다. `SELECT jsonb_pretty(config) FROM sync_agents`로 확인, 필요 시 `jsonb_set(config,'{commands}','[]')`.)
- 릴리즈 `force_update=true`면 이미 최신 버전인 박스도 정각마다 자기 버전으로 재-업데이트를 시도해 위 결함으로 죽는다. **동일 버전 배포 완료 후에는 `UPDATE sync_releases SET force_update=false`.**

**임시 복구(서팀장 원격 1회 — 2008 R2 PowerShell 2.0 전제)**: 이미 `temp`에 받아둔 exe로 수동 교체. 절차·복붙 명령 = `docs/session-recovery/2026-0702-isae-remote-runbook.md` 교체 블록(B). certutil로 체크섬 대조(2008 R2는 `Get-FileHash` 없음), `.bak` 백업 후 copy, `schtasks /Run`.

**근본 수정(다음 exe 버전업 전 필수)**: update.bat을 **SyncAgent 작업 job 밖에서 실행**하도록 updater 변경 — `CREATE_BREAKAWAY_FROM_JOB`로 spawn / 또는 일회성 별도 예약작업(`schtasks /Create` transient)으로 bat 실행 / 또는 `wmic process call create`(부모 job 미상속). 이 수정본이 처음 깔리는 그 1회만 박스 개입이 남고, 그 뒤부터 완전 무선.

**교훈**: Windows 예약작업(또는 서비스)이 spawn한 자식 프로세스는 그 작업의 job에 속한다 — **자기 작업을 `/End`하거나 부모가 exit하면 그 자식(교체 bat)도 죽는다.** 자기 자신을 교체·재시작하는 스크립트는 반드시 부모 job에서 분리해서 띄운다.

---

### 2-7. 2026-07-27 아난티(2번째 설치 업체) 사전 검증 — 클라우드 DB TLS 미지원 + MySQL 키셋 부재 (v1.6.2)

**발단**: 아난티 서버 = Windows Server 2016 + **Aurora MySQL 8.0**(3.09.0). 발송 전에 "지금 빌드로 그대로 보내도 되는가"를 확인.

**사전 판정(코드·공식문서 근거)**: 이새가 원격 3회 실패한 두 뿌리(2008 R2 구형 커널 → node 티어 / Oracle 11g thick)는 **둘 다 무관**.
Node 20 공식 지원표가 `>= Windows 10/Server 2016` **Tier 1**이라 `win-modern`(node20) 그대로. 웹 설치 마법사도 major≥10이라 정상 경로.

**실측으로 드러난 진짜 결함 2건** (MySQL 8.0.45 컨테이너 · 200,000행 실테이블):
1. **TLS 강제 환경에서 연결 불가** — `require_secure_transport=ON`이면 `ER_SECURE_TRANSPORT_REQUIRED`(3159)로 거부된다.
   `mysql.ts`의 `createPool`에 `ssl` 항목이 아예 없었고 `DbConnectionConfig`에도 필드가 없었다(mssql은 `encrypt:false` 하드코딩, pg도 미지원).
   사내망 MySQL만 상대해 온 커넥터라 클라우드 DB 전제가 빠져 있었다. **`ssl` 옵션만 주면 TLS_AES_256_GCM_SHA384로 접속 성공**까지 같이 실측.
2. **MySQL에 키셋 페이지네이션 부재** — `fetchAllKeyset`가 `oracle.ts`에만 있어 MySQL 고객은 OFFSET 폴백.
   2026-06-30 이새 전체동기화 조기 종료(13만 중 ~10만에서 끊김)의 근본 정정이 키셋이었는데 **MySQL이 그 보호 밖**이었다.

**수정(v1.6.2)**:
- `DbConnectionConfig.ssl` / `sslCaPath` 신설 → zod 스키마·env(`DB_SSL`·`DB_SSL_CA`)·설치 마법사 3경로(웹·CLI·편집기)·접속테스트 3엔드포인트 전수 배선.
  **기본값 false = 기존 사내망 고객 동작 그대로.** CA 미지정 = 암호화만(검증 생략, VPC 전제), CA 지정 = 검증까지. **CA 읽기 실패는 평문 폴백 없이 throw**(암호화된 줄 아는 상태 차단).
- 순수 함수 `resolveMysqlSslOption` + 유닛 6건. mssql `encrypt`는 `config.ssl`로, pg도 동일 옵션.
- `MysqlConnector.fetchAllKeyset` 신설 — 단일 PK 커서. **PK 없으면 throw → 엔진이 OFFSET 폴백**(조용한 부분 결과 금지).
  실측: 중복 0·오름차순·깊은 구간(afterKey=199990) 즉시 응답·한글 정상.

**교훈**:
- **커넥터의 "연결 옵션"은 고객 DB가 온프렘일 때만 맞는 전제 위에 있다.** 클라우드 DB(Aurora·RDS·Azure)는 암호화 강제·인증 플러그인·엔드포인트가 다르다 — 새 고객 환경을 받으면 OS·DB 버전만이 아니라 **연결 정책(TLS 강제 여부·인증 플러그인)** 을 함께 묻는다.
- **한 어댑터에만 들어간 근본 수정은 반쪽이다.** 키셋은 이새 사고의 근본 fix였는데 oracle에만 들어가 MySQL 고객이 같은 사고에 노출돼 있었다. 어댑터 공통 계약(IDbConnector)에 추가되는 보호 장치는 **전 어댑터 이행표**를 만들어 닫는다.
- **영업이 전달한 사양은 기계 출력으로 재확인한다.** 이번에도 "Windows Server 2026"으로 왔다가 실제는 2016이었다(티어 판정이 바뀔 수 있는 값이었다). `systeminfo` · `SELECT VERSION()` · `SHOW VARIABLES LIKE 'require_secure_transport'` 출력을 받는다.

**★ 2026-07-27 진행 상태 (다음 세션 인계)**
- **코드 완료·빌드 대기**: TLS 일체(ssl.ts CT + mysql/pg/mssql + 마법사 3경로 + `sslCaPath`) · `supportBigNumbers` · MySQL 키셋(가드 포함). tsc 0 · vitest 67.
- **버전**: `package.json` = **1.6.4**(라벨만 올림). 서버 `agent-builds/`에는 **1.6.3 zip 20개**가 올라가 있다 — 다음 세션 빌드 후 교체 대상.
- **매뉴얼**: `build-manual.js` 갱신 완료(1.6.4 라벨·zip 설치 절차·TLS 항목 추가·버전 히스토리/.env/원격제어 절 삭제). docx는 빌드 후 1회 재생성.
- **아난티**: TLS 비강제 회신 받음(옵션 불필요·보험용). **테이블·컬럼은 받을 필요 없다 — 설치 마법사가 목록을 읽고 AI가 매핑한다.**
- **다음 세션 순서**: Codex 결과 반영 → **빌드 1회** → zip 20개 교체(`npm run upload:agents`) → 매뉴얼 docx 1회 → VM 2016 검증(가짜 DB·Aurora 세팅부터 Harold와 함께).

**키셋 정확성 — 2026-07-27 Codex 3R 지적과 처방**
소수 PK(`decimal`·`numeric`)를 `DECIMAL(65,0)`으로 캐스팅하면 소수부가 잘려 커서가 앞 행을 재조회하거나 건너뛴다.
커서 별칭(`__sync_keyset_cursor__`)과 같은 이름의 컬럼이 고객 테이블에 실재하면 반환 전 delete로 **원본 값이 조용히 사라진다**.
처방 = **키셋 사용 조건을 좁혔다** — 정수 PK(tinyint~bigint)이고 별칭 충돌이 없을 때만 사용, 그 외는 throw해 엔진이 OFFSET 폴백.
실측(0727): BIGINT PK=키셋(커서 9223372036854775806 정확) / DECIMAL(10,2) PK=폴백 / 동명 컬럼 테이블=폴백(OFFSET 조회 시 원본 보존) / 정수 20만 행=키셋.
**미해결(다음 트랙)**: 엔진 완전성 가드가 "받은 행 수"만 세어 **중복 1건 + 누락 1건이 상쇄되면 경고조차 못 한다**(`engine.ts:458`). PK 유일값 기준으로 세도록 고쳐야 닫힌다.

**아난티 발송 전 잔여**: ①빌드 1회 + zip 교체 ②VM 2016 실행 검증.
⛔ **`sync_releases`에 1.6.2 active 등록은 별도 판단** — 이새 박스는 1.5.7이라 등록 시 깨진 updater가 자가교체를 시도한다(§2-6).

---

## § 3. 진단 체크리스트 (문제 발생 시 순서대로 실행)

### STEP 1. 슈퍼관리자 UI에서 상태 확인
- 슈퍼관리자 대시보드 → 싱크에이전트 화면
- "마지막 HEARTBEAT" / "마지막 동기화" 시간 확인
- 상태 뱃지(정상/지연/오프라인)

### STEP 2. 한줄로AI 서버에서 sync_agents 상태 쿼리
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "
  SELECT sa.agent_name,
         sa.last_heartbeat_at AT TIME ZONE 'Asia/Seoul' AS 하트비트,
         sa.last_sync_at AT TIME ZONE 'Asia/Seoul' AS 마지막동기화,
         sa.updated_at AT TIME ZONE 'Asia/Seoul' AS config수정,
         jsonb_array_length(COALESCE(sa.config->'commands','[]'::jsonb)) AS 대기명령수,
         jsonb_pretty(sa.config->'commands') AS 명령목록
    FROM sync_agents sa
   WHERE sa.status='active'
   ORDER BY sa.updated_at DESC;"
```
- **대기명령수가 계속 쌓이고 하트비트 시간이 멈춰 있으면** → Agent가 요청을 안 보내는 중 (STEP 5로)

### STEP 3. sync_logs 최근 이력 + 실패 상세
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "
  SELECT sl.started_at AT TIME ZONE 'Asia/Seoul' AS 시작,
         sl.sync_type, sl.mode,
         sl.total_count AS 총건, sl.success_count AS 성공, sl.fail_count AS 실패,
         sl.duration_ms AS 소요ms,
         jsonb_pretty(sl.failures) AS 실패상세,
         sl.error_message
    FROM sync_logs sl
    JOIN sync_agents sa ON sa.id = sl.agent_id
   WHERE sa.agent_name = 'sync-agent-001'
     AND sl.started_at >= NOW() - INTERVAL '6 hours'
   ORDER BY sl.started_at DESC LIMIT 10;"
```
- **실패 상세에 메시지 없음 + error_message NULL** → pm2 로그로 추적 (STEP 4)

### STEP 4. pm2 로그에서 Sync 관련 에러 추적
```bash
# 기본 grep
pm2 logs --lines 500 --nostream 2>&1 | grep -iE 'Sync|/api/sync/|parse_target|customers.*error' | tail -50

# parse_target 에러 전체 스택 (INSERT 관련)
pm2 logs --lines 800 --nostream 2>&1 | grep -B 10 -A 3 'parse_target' | head -60

# version check 500
pm2 logs --lines 500 --nostream 2>&1 | grep -iE 'Sync Version Error|sync/version' | tail -20
```

### STEP 5. nginx access 로그 — Agent 요청이 서버 도달 여부
```bash
sudo grep "/api/sync/" /var/log/nginx/access.log | tail -30
```
- **기록 있음** → Agent는 살아있음. 응답 코드(500/400)로 에러 원인 확인 → sync.ts 해당 라우트 수정
- **기록 없음** → Agent 프로세스 죽음 (STEP 6)

### STEP 6. Agent 서버 측 진단 (인비토 내부 Agent 서버에서)
Agent 서버 IP는 nginx access 로그의 요청 IP로 확인 가능(예: `180.226.236.94`).

```cmd
REM 프로세스 확인 (Windows)
tasklist | findstr node.exe

REM 또는 Service 상태 확인
sc query | findstr -i sync
```

```bash
# Linux
ps aux | grep sync-agent
systemctl status sync-agent
```

**Agent 로그 위치**: `{Agent 설치 폴더}/logs/sync-YYYY-MM-DD.log` + `error-YYYY-MM-DD.log`
- `sync-agent/src/logger/index.ts` L16 `LOG_DIR = path.resolve(process.cwd(), 'logs')`

```powershell
# Windows 로그 tail
Get-Content logs\error-2026-04-21.log -Tail 80
Get-Content logs\sync-2026-04-21.log -Tail 100
```

### STEP 7. customers 실제 유입 확인
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "
  SELECT COUNT(*) AS 전체,
         COUNT(*) FILTER (WHERE source='sync') AS sync_소스,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour') AS 최근1시간유입,
         MAX(updated_at) AT TIME ZONE 'Asia/Seoul' AS 최종수정
    FROM customers
   WHERE company_id=(SELECT company_id FROM sync_agents WHERE agent_name='sync-agent-001');"
```

---

## § 4. 에러 유형별 1차 대응

| 에러 유형 | 전형 증상 | 1차 조치 |
|----------|---------|---------|
| Agent 프로세스 죽음 | nginx에 요청 0건 + 하트비트 멈춤 | Agent 서버에서 프로세스 재시작 (§ 5) |
| INSERT 실패 (parse_target.c) | sync_logs `fail=전건`, pm2에 `checkInsertTargets` | 컬럼 중복/누락 체크. **customer-upsert.ts 컨트롤타워 사용 여부 확인** |
| version check 500 | nginx에 `GET /api/sync/version ... 500` | sync_releases 스키마 확인 (§ 2-3) |
| `/heartbeat` 401/403 | API key 불일치 | sync_agents.api_key 확인 |
| heartbeat 시간 어긋남 | "지연" 잦음 | `getOnlineStatus()` 기준 vs Agent 주기 재확인 (§ 2-1) |
| ON CONFLICT 매칭 실패 | `no unique constraint matching ON CONFLICT` | customers UNIQUE 인덱스 확인 (`idx_customers_company_store_phone`) |

---

## § 5. Agent 재시작 방법 (설치 방식별)

| 설치 방식 | 재시작 |
|---------|------|
| **Windows Service (NSSM 등)** | `services.msc` → "SyncAgent" 우클릭 → 다시 시작 <br> 또는 관리자 cmd: `net stop SyncAgent && net start SyncAgent` |
| **수동 실행 (start.bat)** | 실행 창 닫고 `start.bat` 재실행 |
| **PM2** | `pm2 restart sync-agent` |
| **systemd (Linux)** | `sudo systemctl restart sync-agent` |

설치 방식 기록: `SyncAgent_설치매뉴얼_v1_5.docx` 참조.

---

## § 6. 자주 쓰는 SQL 쿼리 모음

### 6-1. Agent 기본 상태
```sql
SELECT agent_name, status, last_heartbeat_at, last_sync_at, total_customers_synced
  FROM sync_agents ORDER BY updated_at DESC;
```

### 6-2. pending 명령 비우기 (필요 시)
```sql
UPDATE sync_agents
   SET config = jsonb_set(config, '{commands}', '[]'::jsonb)
 WHERE id = '<agent_id>';
```

### 6-3. 특정 회사의 최근 sync 이력
```sql
SELECT started_at, sync_type, mode, total_count, success_count, fail_count, error_message
  FROM sync_logs
 WHERE company_id = '<company_id>'
 ORDER BY started_at DESC LIMIT 20;
```

### 6-4. 테이블/인덱스 검증
```sql
-- sync_releases 스키마
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name='sync_releases' ORDER BY ordinal_position;

-- customers 제약/인덱스
SELECT indexname, indexdef FROM pg_indexes
 WHERE tablename='customers' ORDER BY indexname;
```

---

## § 7. 미해결 / 오픈 후 정리 과제 (2026-04-21 기준)

| 과제 | 경로 | 비고 |
|------|------|------|
| 중복 인덱스 `customers_company_store_phone_unique_idx` DROP | DB | 2026-04-21 잘못 추가된 것. `idx_customers_company_store_phone`과 기능 동일 |
| 중복 UNIQUE 제약 `customers_company_phone_unique` DROP | DB | `customers_company_id_phone_key`와 중복 |
| sync.ts sync_logs `failures` JSONB 기록 누락 | routes/sync.ts | chunk catch에서 `failures.push`되지만 JSONB에 저장 안 되는 케이스 조사 |
| Agent 쪽 uncaughtException 핸들러 점검 | sync-agent/src | version check 500 같은 fatal 에러에서 프로세스 복구 로직 |
| heartbeat 주기 단축 검토 | sync-agent + admin-sync.ts | 60분 → 5분으로 단축 시 상태 정확도↑, 트래픽 12배 증가 |

---

## § 8. 변경 이력

| 날짜 | 변경 | 담당 |
|------|------|------|
| 2026-04-21 | 문서 신설. D131 실점검 이슈 3건 기록 + 진단 체크리스트 | Claude + Harold |
| 2026-06-11 | § 2-4 인비토 첫 연동 3건 (버전 단일화 v1.5.5 + --version + fallbackToFullSync 실구현) | 비토 + Harold |
