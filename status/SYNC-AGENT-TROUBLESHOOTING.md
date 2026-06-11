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
