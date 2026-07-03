# LESSONS — DB / SCHEMA / 돈 / 환불 / 마이그레이션 사고

> **참조**: DB 쿼리 작성 / SCHEMA 변경 / 환불 로직 / 결제 / 마이그레이션 작업 시 우선 정독.
> **원본**: 옛 `LESSONS_LEARNED.md` §3 안 DB 관련 사고 분할 (D215+ 도메인 분할 — 2026-05-24).

---

## 핵심 원칙

- **SCHEMA.md 의존 X** — 실 DB `pg_constraint` + `information_schema.columns` 검증 후 SQL 작성 (D134)
- **추측 컬럼명 X** — `\d 테이블명` 검증 SQL 먼저 (D162 42P08)
- **돈 관련 = 단순 fix X** — root cause + 영구 안전망 (reverse + cron + idempotent + 트랜잭션) 동시 (D182)
- **DB ALTER 새 컬럼 → endpoint catch 분기 처리** (D214+ 신규)
- **GREATEST vs COALESCE** — 양방향 sync 영역 (POS + 자사몰) = GREATEST 강제 (D214+ 신규)

---

## 사고 이력

### 2026-07-01 — 시스템 sync user INSERT 42P08 (동일 $1을 uuid 컬럼 + ::text 이중 사용) ★ 신규
- **현상**: `reconcileSyncUnsubscribes`(sync.ts) error.log "inconsistent types deduced for parameter $1, text versus uuid" 42P08 반복. `companies.ts` 회사생성 시스템 user INSERT도 동일(2곳).
- **근본**: `VALUES (..., $1 /*company_id uuid*/, 'system_sync_' || $1::text, ...)` — 같은 `$1`을 uuid 컬럼과 `::text`에 써서 PG가 $1 타입을 uuid·text 양쪽으로 추론 → 42P08(D162 계열, prepared statement 타입 추론).
- **fix**: `$1::uuid`(company_id) + 별도 `$2::text`(login_id 접미사) params 2개. 반복 INSERT 2곳은 `utils/system-sync-user.ts` CT(`ensureSystemSyncUser`)로 통합(controltower_first). 결과 데이터·downstream 동일, 42P08만 제거.
- **교훈**: 한 파라미터를 서로 다른 타입 문맥(uuid 컬럼 / `::text`)에 재사용하면 42P08 → 명시 cast + 문맥별 별도 param. **런타임 에러가 42P08(≠42703)이면 컬럼은 존재하는 것**(is_system 있음 — SCHEMA.md users 미기재라 갱신 대상). 비치명(수신거부 실차단은 admin·company_user 등록이 담당, 시스템 user 등록만 skip이었음)이나 로그 오염 + 시스템 user 미생성.

### 2026-06-29 — 선불 sweep 초과환불 재발 + 발송 근간 보강 (돈) ★ 신규
- **현상**: 6/25 산식 fix 이후에도 폴라초이스·라무르 초과환불 재발. 실측 51,722원/29건.
- **진단 함정**: 환불 진단 기준을 `실패 + (차감 − sent_count)`로 잡으면 버그 산식과 동일 → over 0으로 가려짐. **올바른 회계 기준 = `차감 − 성공`**(과금했는데 전달 안 된 전부). over = `환불 + 성공 − 차감`.
- **근본**: `calcRefundDue`의 미적재 = `차감 − sent_count`인데, 워커 기록 sent_count가 실제 처리수(성공+실패)보다 작게 남는 캠페인이 있음(폴라초이스 성공14790+실패610=15400=차감인데 sent_count 15271). 그 차이를 가짜 미적재로 환불 → prepaidRefund ratchet(올림만)이 영구 고착.
- **fix (양방향 수렴)**: ① 미적재 = `차감 − max(sent_count, 성공+실패+대기)` (refund-calc.ts) — MySQL 실측 처리수가 sent_count 과소를 덮음, max 하한이라 이동 중 race도 방어. ② reverse 안전망 `prepaidReverseOverRefund` (prepaid.ts) — 정산 캠페인(대기0·30분경과)에서 누적환불 > 정당한도(차감−성공)면 초과분 트랜잭션·idempotent 회수, 타임아웃 환불 캠페인은 skip(이중차감 차단). 14일 윈도우 자동 회수(46,569원 실회수).
- **발송 근간 보강**: ① sent_count = `GREATEST(sent_count, 성공+실패+대기)`로 실적재수 정정. ② 머니 불변식 `차감 = 성공 + 순환불(환불−회수)` 감시 — 정산 캠페인에서 깨지면 `sendSystemAlert`(쿨다운6h·미설정 시 PM2 로그만). gap>0=미환불(고객 손해)·gap<0=초과 잔존. **측정: 정산 1,480건 전부 불변식 성립 + 진짜 미적재 0** → 적재 신뢰성 OK라 적재 파이프라인 대공사 불필요.
- **교훈**:
  - 환불 회계 진단 기준은 항상 `차감 − 성공`. sent_count(워커 기록)는 진실 아님 — 미적재 단독 산정에 쓰면 과소 기록이 가짜 환불.
  - prepaidRefund는 한 방향(올림). 어떤 일시 변수가 튀어도 ratchet이 영구 고착 → 돈 영역은 reverse 양방향 수렴이 근본(D182 reverse 원칙 재확인). 입력 변수 하나씩 막으면 다음 변수에서 재발.
  - 위험한 코드(적재) 대공사 전 실측부터 — 진짜 미적재율을 SQL로 재서 0이면 대공사 불필요(데이터 없이 발송 근간 안 건드림).

### D214+ — customer-upsert.ts COALESCE 사고 (RFM GREATEST 강제 의무) ★ 신규
- **사례**: 옛 `customer-upsert.ts` ON CONFLICT UPDATE = recent_purchase_date / purchase_count / last_purchase_date = COALESCE 단순 덮어쓰기. 자사몰 (cdp-orders.ts) GREATEST 영역과 충돌.
- **시나리오**: 자사몰 5/24 매출 → cdp-orders → recent_purchase_date = 5/24 → 30분 후 싱크에이전트 POS 옛 5/23 sync → COALESCE(5/23, 5/24) = **5/23** = 5/24 사라짐 사고.
- **대책**: updateExclusions에 RFM 컬럼 추가 + 별도 GREATEST 강제 매트릭스 (`GREATEST(COALESCE(EXCLUDED.X, customers.X), COALESCE(customers.X, EXCLUDED.X))`). 양방향 sync 영역 = 항상 GREATEST 정합.

### D214+ — active_sources 컬럼 X 에러 (DB ALTER 안전망 부재) ★ 신규
- **사례**: DB ALTER 미실행 상태에서 endpoint 호출 시 = `column "active_sources" does not exist` 에러 = 사용자 친화 X.
- **대책**: 새 컬럼 활용 endpoint catch 영역에 `if (msg.includes('column') && msg.includes('does not exist')) return res.status(503).json({ code: 'DB_MIGRATION_PENDING' })` 분기 처리 의무. 운영자 안내 메시지 ("DB 마이그레이션 필요 — customers ALTER 10건 실행 요청") 포함.

### D188 (영업팀장 알림톡 14건 — admin_phone_number fallback)
- **사례**: `alimtalk-jobs.ts notifyTemplateInspectionResult` profile.admin_phone_number 빈 영역 시 return 0 → 영영 알림 X. 인비토 발신프로필 등록 시 admin_phone_number 누락된 회사 영구 사고.
- **대책**: callback fallback (admin_phone_number 빈 영역 → `sender_registrations` 첫 approved.phone). 회사 admin 의존성 데이터 = fallback 안전망 필수.

### D184 (이니시스 결제 ALTER — SCHEMA.md ≠ 실 DB 충돌)
- **사례**: SoT 문서 `legacy-payment-migration.md` §6-1 = `CREATE TABLE IF NOT EXISTS payments` 명시. 실 SCHEMA = payments 테이블 이미 존재 (12 컬럼 + row 0건).
- **대책**: SoT 문서 의존 X — 실 DB `pg_constraint` + `\d 테이블명` 검증 후 ALTER 진입. 9 컬럼 추가 + UNIQUE INDEX (pg_payment_key + pg_order_id) + 결제 영역 = 트랜잭션 + idempotent + 금액 위변조 검증 (approval.totPrice vs db.amount) 3중 안전망 필수.

### D182 (선불 타임아웃 환불 — 30분 임계값으로 회사 손해)
- **사례**: 디에스패션/태영 30~34분 시점에 통신사 응답 도착 → 30분 임계값으로 환불 처리 → 회사 손해 (디에스패션 26.4원 + 태영 60.5원).
- **Root cause**: `campaign-lifecycle.ts:427` directTimedOut 30분 = sync-worker가 pending 전체 fail 강제 + prepaidRefund 호출 → 직후 응답 도착 → success_count=1 갱신되지만 환불 reverse 없음.
- **5단 영구 안전망**:
  1. 임계값 30→**120분** 변경 (통신사 응답 99%ile + 안전 마진 2배)
  2. `mysql-refund-sweeper.ts reverseTimeoutRefundIfRecovered()` 30초 주기 + 24h 윈도우 + idempotent
  3. 트랜잭션 (BEGIN/COMMIT/ROLLBACK) 잔액 차감 + INSERT 원자성
  4. description 정규식 파싱으로 단가 추출 + min(currentSuccess, refundedFailCount) × unitPrice 차감
  5. `balance_transactions` admin_deduct + description='타임아웃 환불 reverse' INSERT
- **교훈**: 돈 영역 = 단순 fix X — root cause 분석 + 영구 안전망(reverse + cron + idempotent + 트랜잭션) 동시 구축.

### D162-3 (수신거부 사용자격리 4 분기 매트릭스)
- **신 설계**: `companies.user_isolation_enabled BOOLEAN DEFAULT false` 토글 + 4 분기:
  1. OFF + 누구든 = 회사 전체 broadcast
  2. ON + company_admin = 등록/삭제 차단 (IsolationBlockedError)
  3. ON + company_user = 본인 + 회사 admin 양쪽 INSERT (격리 + admin sync)
  4. ON + 그 외 = 차단

### D162 (수신거부 양방향 사고 — 42P08 PostgreSQL + 0 자동 보정 누락)
- **사례**: 토운/스킨큐어 수신거부 추가/엑셀 업로드 시 "서버 오류" + 0건 등록. PM2 로그 = `error 42P08: inconsistent types deduced for parameter $3`.
- **Root cause 2건 동시**:
  1. `unsubscribe-helper.ts:160` admin 분기 SQL `$2` placeholder 완전 미사용 → prepared statement cache가 미사용 placeholder type을 unknown 추론 → 운 나쁜 connection에서 42P08
  2. `routes/unsubscribes.ts:161/204` 수신거부 등록 경로 `replace(/\D/g, '')`만 박혀 카카오 CSV 앞 0 누락 10자리 (`1066133762`) 그대로 INSERT → customers.phone 11자리 (`01066133762`)와 매칭 X = **스팸 발송 사고 영구 위험**
- **대책**:
  1. SQL `$3→$2`, `$4→$3` 재번호 + `$1::uuid, $2::varchar, $3::varchar` 명시 cast (type inference 영구 고정)
  2. `normalizePhone(phone)` 적용 (CT-normalize.ts) — 0 자동 보정 + 한국 휴대폰 유효성
- **교훈**: prepared statement cache는 connection 단위 — 회사별 차이 가설 X. 미사용 placeholder 코드 결함 우선 점검. 수신거부 등록 경로 phone 정규화 누락 = 스팸 발송 사고 영구 위험.

### D151-2 (환불 워커 부재 1년 반복)
- **사례**: Dashboard 진입 의존 fire-and-forget sync(D144) 한계 — 사용자 화면 안 보면 sync 0회 → PG fail_count 미증가 → 환불 함수 호출 0건. 스킨큐어 547건 실패 중 251건만 환불, 293건 누락 8.5시간 영속.
- **대책**: `campaign-sync-worker.ts` 5분 cron 신설. 최근 24h pending>0 회사 자동 sync. idempotent 함수는 호출만 되면 자동 차액 환불.

### D145 P0+ (환불 idempotent)
- **사례**: delta 환불 패턴이 호출/함수 의미 충돌로 트렉스타 17,820원 누락 + 폴라초이스 113,559원 이상지급 양방향 사고.
- **대책**: count = 누적 fail 그대로 호출, 함수가 alreadyRefunded와 비교해 차액만 환불 (idempotency 함수 측 보장). delta 계산 폐기.

### D150-3 (직접발송 0 NULL — cellToString)
- **사례**: 엑셀 D2/E2/F2 = 0 값이 `row[col] || ''` falsy 처리로 빈 문자열 변환되어 발송 본문 NULL. 벤제프 113건 잘못 발송.
- **대책**: `cellToString` 컨트롤타워 신설 (frontend formatDate.ts + backend normalize.ts). `|| ''` 패턴 25곳+ 일괄 교체. 인라인 `safeStr` 정의 금지.

### D150-4 (발송결과 ORDER BY tie)
- **사례**: 폴라초이스 14df97e7 16,106건 모두 sendreq_time 단일 시각 → `ORDER BY sendreq_time ASC LIMIT 10000 OFFSET ?` tie-breaker 없음 → 청크 비결정적 분배. 화면 15,450/656 vs 엑셀 15,470/636.
- **대책**: `dest_no ASC` tie-breaker 추가. LIMIT/OFFSET 청크 패턴 = unique tie-breaker 필수.

### D150-2 (환불 description 행 단위 모순)
- **사례**: `prepaid.ts:130` description이 누적 fail × 단가 표시인데 amount는 차액 → 행 단위 모순.
- **대책**: `alreadyRefunded > 0`이면 신규 환불 건수 + 누적 정보 별도 표시.

### D145 P0 (환불 description 의미 불일치)
- 옛 사고 — `prepaid.ts` description / amount 의미 충돌. 행 단위 표시 일관성 영구 룰.

### D142 (호출부 의존성 파괴)
- **사례**: 포맷팅 안전 가드를 함수 호출부 파라미터에 의존 → 프론트 파라미터 누락 → 콤마 포맷팅 에러 1년 반복.
- **대책**: 호출부 의존 폐기. 컨트롤타워 내부에서 안전한 기본값 반환. `FIELD_DISPLAY_FORMAT_MAP` 22개 1:1 + `renderFieldValue/displayValue` 단일 진입점.

### D134 (DB 제약 조건 불일치)
- **사례**: SCHEMA.md 의존하다가 실 DB `CHECK` 제약 위반 → 마이그레이션 SQL 전건 실패.
- **대책**: DB 구조 = `pg_constraint` 쿼리로 실 값 확인 후 작성.

### D132 (보조 상태값 오염)
- **사례**: `subscription_status` 같이 여러 곳에서 덮어쓸 수 있는 보조 상태에 의존 → 평가 로직 꼬임.
- **대책**: 요금제 판정 = 단일 필드 (`plan_code`) 의존.

### D131 (SyncAgent 누적 합산)
- **사례**: Agent 상태를 DB 조회 카운트가 아닌 `+=` 누적 합산 → UI 수만 건 표시.
- **대책**: 통계와 실 스냅샷 카운트 의미 분리.

### D110 (하드코딩 테이블명)
- **사례**: `admin.ts` 상세 조회 `SMSQ_SEND` 하드코딩 → 완료 캠페인 데이터 누락.
- **대책**: `getCampaignSmsTables` 등 CT-04 함수 사용. 라우팅 단일 진입점.

### D106 (LEFT JOIN 모호성)
- **사례**: LEFT JOIN 추가 후 `WHERE status` 어느 테이블 컬럼인지 명시 X → SQL 500.
- **대책**: JOIN 추가 시 모든 컬럼에 alias (`c.`, `u.`) 명시 필수.

### D98 (MMS 절대경로)
- **사례**: 서버 절대경로 (`/home/admin/...`)를 웹브라우저 `img src`에 그대로 전달 → 이미지 깨짐.
- **대책**: `mmsServerPathToUrl` 컨트롤타워 활용.

### D70 (안전망의 역설)
- **사례**: 변수 치환 `replaceVariables`의 정규식 안전망이 주소록 변수를 빈 값 치환 삭제.
- **대책**: 방어 로직이 유효 데이터 지우지 않는지 데이터 흐름 끝까지 검증.

---

## 자가 검증 매트릭스 (DB 작업 시)

- [ ] SCHEMA.md 정독 + 컬럼명 정확 확인 (추측 X)
- [ ] `pg_constraint` 또는 `\d 테이블명` 실 DB 검증 SQL 안내 (Harold 실행)
- [ ] 양방향 sync 영역 (POS + 자사몰 + 파일 업로드) = GREATEST 강제
- [ ] DB ALTER 새 컬럼 활용 endpoint catch 영역 = `column does not exist` 분기 처리
- [ ] 돈 영역 (환불/결제) = root cause + 영구 안전망 동시 구축
- [ ] `42P08` 류 PostgreSQL 에러 = prepared statement cache 영역 = placeholder 영역 + 명시 cast
- [ ] 수신거부 등록 경로 = `normalizePhone` 의무 (스팸 발송 사고 차단)
- [ ] LIMIT/OFFSET 청크 = unique tie-breaker 필수
