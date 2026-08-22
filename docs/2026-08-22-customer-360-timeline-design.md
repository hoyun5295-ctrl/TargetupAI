# 고객 360 타임라인 (2026-08-22)

> 호출어 **"고객 360"**. 이 문서가 이 축의 확정 사실·불변 원칙·구조·이력을 소유한다.
> 상태·잔여는 STATUS §2 카드가 아니라 여기 §7이 소유한다(트랙 문서 규약).
> 경위: Harold "일반 CRM보다 부족한 게 뭐냐, AI CRM으로 가자" → 조사 결과 B2C 마케팅 AI CRM 기준으로 빠진 조각은 **고객 360 타임라인**과 **인바운드 대화** 둘. 타임라인을 먼저 만들고(이 문서), 인바운드 대화가 그 그릇에 들어온다(§9).

---

## 0) 한 줄 정의

고객 한 명을 누르면 **언제 무엇을 받았고 · 무엇을 보고 눌렀고 · 무엇을 샀고 · 어떤 동의·거부를 했고 · 어느 자동화에 들어가 있는지**가 시간순 한 화면에 나온다. 새로 수집하는 데이터는 없다. 이미 쌓인 10개 원천을 고객 기준으로 합쳐 읽는 뷰다.

---

## 1) 확정 사실 (재검증 불요)

| # | 사실 | 근거 |
|---|------|------|
| 1-1 | PG `messages` 테이블은 **죽은 테이블**이다. `INSERT INTO messages` 0건 · `FROM messages` 0건 | backend 전수 grep 2026-08-22 |
| 1-2 | 발송 건별 진실은 **MySQL `SMSQ_SEND_N`(live) + `SMSQ_SEND_N_YYYYMM`(log)** 하나뿐. 수신번호 `dest_no`, 캠페인 `app_etc1`, 회사 `app_etc2`, 상태 `status_code`, 요청 `sendreq_time`, 완료 `mobsend_time`, 유형 `msg_type`(S/L/M · K=알림톡 · F=브랜드), 대체 `k_oriseq` | `routes/results.ts` 건별 조회 · SCHEMA.md SMSQ 절(29컬럼 실측) |
| 1-3 | MySQL 인덱스 = PK(`seqno`) · (`app_etc1`,`status_code`) · (`app_etc1`,`sendreq_time`). **`dest_no` 인덱스 없음** | SCHEMA.md 2026-07-17 `SHOW CREATE TABLE` 실측 |
| 1-4 | 회사가 쓰는 MySQL 테이블 집합은 CT `getCompanyAllLiveSmsTables(companyId)`가 주고, log 테이블 목록은 `getExistingLogTables()`(정규식 `SMSQ_SEND_\d+_\d{6}`, 5분 캐시)가 준다. 결과 조회용 `getCompanySmsTablesWithLogs`는 **당월·전월 log만** 붙인다 | `utils/sms-queue.ts` |
| 1-5 | `app_etc1`에 들어가는 값은 현재 경로 전부 `campaigns.id`다(직접발송·AI·오퍼레이터·여정 스텝 묶음 전부 campaigns 행을 만든다). SCHEMA.md의 옛 주석 "campaign_run_id"는 자동마케팅 옛 경로 | `sms-queue.ts:885` · `INSERT INTO campaigns` 5곳 · `journey_step_campaigns` |
| 1-6 | 고객 행은 `customers` UNIQUE(`company_id`, COALESCE(`store_code`,'__NONE__'), `phone`). **같은 번호가 매장별로 여러 행일 수 있다** | SCHEMA.md:561 |
| 1-7 | 고객 기준 키를 가진 PG 원천: `purchases`(customer_id + customer_phone) · `consents`(customer_id) · `cdp_events`(customer_id NULL 가능, 인덱스 `idx_cdp_events_customer`) · `cdp_inapp_impressions`(customer_id) · `dm_event_responses`(customer_id) · `journey_executions`(customer_id) · `voice_inbound_calls`(customer_id + caller_phone) · `dm_recipient_tokens`(customer_id → token) | SCHEMA.md · INSERT문 grep |
| 1-8 | 번호 기준 키를 가진 PG 원천: `dm_views`(phone · recipient_token) · `unsubscribes`(company_id + user_id + phone) · `opt_outs`(company_id + phone) · `journey_entry_ledger`(journey_id + phone) | SCHEMA.md |
| 1-9 | `url_clicks`는 `short_urls.flyer_id`(한줄전단)에만 묶여 있어 **이 축에 들어오지 않는다** | SCHEMA.md short_urls |
| 1-10 | 여정 로그: `journey_step_logs`(execution_id, step_id, campaign_id, sent_at, status sent/skipped/failed, error_reason) · `journeys.name` · `journey_steps.step_order` | `journey-executor.ts` INSERT · SELECT grep |
| 1-11 | 발송 상태 라벨 CT = `utils/sms-result-map.ts`(`getStatusLabel` · `getQueueRowStatus` · `SUCCESS_CODES` · `PENDING_CODES`). 행동 이벤트 이름 CT = `utils/cdp-events.ts` `STANDARD_EVENT_NAMES`. 전화번호 정규화 CT = `utils/normalize.ts` `normalizePhone` | grep |
| 1-12 | 고객 상세 API는 `GET /api/customers/:id` 하나(행 1개 + 수신거부 여부)이고, 고객 기준 발송 이력 API는 **0건**. 화면은 `CustomerDBModal` 우측 35% 패널(필드 나열)뿐 | `routes/customers.ts:1695` · `CustomerDBModal.tsx:611` |
| 1-13 | 고객 API 게이트 = `authenticate` + 회사 범위. 타임라인은 읽기 전용이라 크레딧·요금제 게이트 없음(AI 요약만 §3-6) | `routes/customers.ts:30` |

### 1-A) 미검증 (착수 전 §5에서 확인)

| # | 항목 | 왜 중요한가 |
|---|------|-------------|
| U-1 | `dest_no`에 하이픈 포함 행이 있는가 | 있으면 `=` 비교가 빠지고 `REPLACE()`를 써야 해 인덱스가 무력하다 |
| U-2 | 큰 live 테이블 1개에서 `WHERE dest_no = ?`의 EXPLAIN(rows·type) | 인덱스 DDL이 필요한지는 측정이 정한다(성능은 측정 후 처방) |
| U-3 | 서버에 존재하는 `SMSQ_SEND_%` 테이블 전체 목록과 log 월 수 | 12개월 조회가 몇 테이블 UNION이 되는지 |
| U-4 | `customers_unified`의 정의(뷰인지 테이블인지, 컬럼) | SCHEMA.md에 없다. 상세 API가 이것을 읽는다 |
| U-5 | `journeys`·`journey_steps`·`journey_executions` 실제 컬럼 | SCHEMA.md에 절이 없다(코드 INSERT문으로만 확인) |
| U-6 | 이메일 발송 이력 테이블 존재 여부 | 101개 테이블 목록에 `email_*`이 없다. 있으면 원천 하나 추가 |
| U-7 | 월별 log 테이블(`SMSQ_SEND_N_YYYYMM`) 생성 주체·방식 | `CREATE TABLE ... LIKE`면 live 인덱스가 상속되고, 아니면 매달 인덱스 DDL이 운영 절차가 된다(5-3) |

> **2026-08-22 전부 해소.** 결과·판정은 §5-R 원장. 이 표는 "무엇을 왜 물었나"의 기록으로만 남긴다.

---

## 2) 불변 원칙

1. **⛔ 발송 사실은 MySQL에서만 읽는다.** PG `messages`·`campaigns.sent_count`로 고객별 발송을 만들어 내지 않는다(1-1). 캠페인 이름·출처는 PG `campaigns`가 **꾸밈**으로만 붙는다.
2. **⛔ 고객 식별 축은 `company_id + phone`이다.** `customer_id` 하나로 묶으면 매장별 중복 행(1-6)의 구매·동의가 빠진다. 진입 id → 그 행의 phone → `customer_ids[] = SELECT id FROM customers WHERE company_id = ? AND phone = ?`로 펼친 뒤, id 기반 원천은 `= ANY(ids)`, 번호 기반 원천은 `phone = ?`로 읽는다. 번호는 `normalizePhone` CT 한 곳에서만 정규화한다.
3. **⛔ 원천마다 상한을 걸고 잘렸음을 응답에 적는다.** 한 고객에게 10만 건을 보냈을 수도 있다. 원천별 `limit + 1`로 읽고 `sources.<kind>.truncated = true`를 돌려준다. 화면은 "더 보기"로 커서를 이어 간다. 조용히 잘라서 "전부입니다"처럼 보이게 하지 않는다.
4. **⛔ 커서는 (시각, 종류, id) 세 짝이다.** 같은 초에 여러 사건이 있으면 시각만으로는 페이지 경계에서 행이 빠지거나 겹친다(LESSONS_DB 118: tie-breaker 의무).
5. **사건의 제목·부제·상태 문구는 서버가 한국어로 완성해서 보낸다.** 화면이 `status_code`를 다시 해석하면 라벨 표가 두 벌이 된다. 서버는 기존 CT(`sms-result-map` · `cdp-events`)만 쓴다.
6. **⛔ 원천 하나가 죽어도 타임라인은 뜬다.** MySQL이 느리거나 log 테이블이 없으면 그 종류만 `sources.send.error`로 표시하고 나머지는 그린다. 전체 500 금지.
7. **인바운드 종류를 처음부터 비워 둔다.** `kind = 'inbound'`(음성 통화가 1호)가 카탈로그에 있어야 다음 축(문자 회신·상담톡)이 그릇을 새로 만들지 않는다(§9).
8. **⛔ 자매 화면을 먼저 본다.** 이 패널이 들어가는 `CustomerDBModal`은 옛 톤이다. 패널만 콘솔 톤으로 만들면 한 모달 안에 두 규격이 생긴다. 껍데기와 함께 올린다(§3-5, memory `feedback_mirror_sibling_screen_before_placing_controls`).

---

## 3) 구조

### 3-1) 사건 카탈로그 (kind → 원천 → 키 → 시각)

| kind | 뜻 | 원천 | 키 | 시각 | 제목 / 부제 예 |
|------|----|------|----|------|----------------|
| `send` | 메시지 발송 | MySQL live+log | `dest_no = phone` | `sendreq_time` | "LMS 발송 · 8월 정기세일 안내" / "성공 · SKT · 14:02 도달" |
| `dm_view` | 모바일 DM 열람 | `dm_views` | `phone` 또는 `recipient_token ∈ tokens(customer_ids)` | `viewed_at` | "DM 열람 · 여름 이벤트" / "3/5 페이지 · 42초 · 스크롤 80%" |
| `dm_response` | DM 이벤트 응답 | `dm_event_responses` | `customer_id = ANY` | `occurred_at` | "DM 응답 · 설문 제출" |
| `purchase` | 구매 | `purchases` | `customer_id = ANY` OR `customer_phone = phone` | `purchase_date` | "구매 · 립스틱 외 2건" / "강남점 · 86,000원" |
| `behavior` | 자사몰 행동 | `cdp_events` | `customer_id = ANY` | `occurred_at` | "장바구니 담기 · 니트 가디건" (이름 라벨 = `STANDARD_EVENT_NAMES`) |
| `inapp` | 인앱 노출·클릭 | `cdp_inapp_impressions` + `cdp_inapp_messages.title` | `customer_id = ANY` | `occurred_at` | "인앱 클릭 · 첫 구매 10% 쿠폰" |
| `consent` | 동의·철회 | `consents` | `customer_id = ANY` | `consented_at` / `revoked_at` | "SMS 마케팅 동의 · 회원가입 폼" |
| `unsubscribe` | 수신거부 | `unsubscribes` + `opt_outs` | `company_id + phone` | `created_at` | "080 수신거부 등록" |
| `journey` | 자동화 진입·스텝 | `journey_executions` + `journey_step_logs` + `journeys.name` | `customer_id = ANY` | `entered_at` / `sent_at` | "여정 진입 · 첫 구매 후 7일" / "2단계 건너뜀 · 야간 금지" |
| `inbound` | 고객이 보낸 것 | `voice_inbound_calls` (1호) | `customer_id = ANY` OR `caller_phone = phone` | `created_at` | "전화 문의 · 1분 12초" / 요약 한 줄 |
| `profile` | 고객 등록·갱신 | `customers` | 펼친 행 전부 | `created_at` | "고객 등록 · 엑셀 업로드 · 강남점" |
| `email` | 이메일 열람·클릭·반송 | `email_events` + `email_campaigns.name` | `email = customers.email`(펼친 행들의 email 집합) | `occurred_at` | "이메일 열람 · 9월 뉴스레터" / "클릭 · 상품 링크" (5-6에서 확정. 고객 키가 email 주소뿐이라 email이 비면 이 종류는 비어 있다) |

- `send`의 꾸밈: `app_etc1` 모음 → `SELECT id, campaign_name, send_type, send_channel FROM campaigns WHERE id = ANY(...)` 1회. 못 찾으면 제목은 본문 앞 30자.
- `send`의 상태: `getQueueRowStatus`로 성공·실패·대기·예약 4종. 실패면 `getStatusLabel` 사유를 부제에.
- 제외: `url_clicks`(한줄전단) · `audit_logs`(관리자 행위 원장, 고객 사건 아님).

### 3-2) 식별

```
입력 :id (customers.id)
 → row = customers WHERE id AND company_id        (없으면 404)
 → phone = normalizePhone(row.phone)
 → ids  = customers WHERE company_id AND phone     (매장별 중복 행 전부)
 → tokens = dm_recipient_tokens WHERE customer_id = ANY(ids)
```
헤더의 "등록 매장"은 ids 행들의 `store_name`을 나열한다. 수신거부 여부는 상세 API와 같은 식(`unsubscribes` EXISTS)을 쓴다.

### 3-3) API 계약

`GET /api/customers/:id/timeline`

| 쿼리 | 기본 | 뜻 |
|------|------|----|
| `before` | 없음 | 커서(base64 of `at|kind|id`). 없으면 최신부터 |
| `kinds` | 전부 | 쉼표 구분. 화면 필터 칩이 보낸다 |
| `limit` | 50 | 최대 100 |
| `months` | 12 | MySQL log 테이블을 몇 달치 붙일지(1-4의 당월·전월 제한을 넘는다) |

응답:
```json
{
  "success": true,
  "customer": { "id", "name", "phone", "grade", "stores": ["강남점","온라인"], "smsOptIn": true, "isUnsubscribed": false, "registeredAt": "..." },
  "summary": { "sends": 42, "engagements": 7, "purchases": 5, "lastActivityAt": "..." },
  "events": [ { "kind": "send", "at": "...", "title": "...", "subtitle": "...", "status": "success|fail|pending|scheduled|null", "detail": { "...": "원문 필드" }, "ref": { "type": "campaign", "id": "..." } } ],
  "nextBefore": "base64 | null",
  "sources": { "send": { "tables": 9, "truncated": false }, "purchase": { "truncated": false }, "behavior": { "error": "..." } }
}
```
- `summary`는 이 페이지가 아니라 **기간 전체**의 수다(원천별 COUNT 1회씩. MySQL은 U-2 결과에 따라 `months` 범위 안에서만).
- `events[].detail`은 종류별 원문(본문·상태코드·금액·속성 JSON)이고 화면은 펼쳤을 때만 보여준다.
- 조립 순서: 종류별로 `before`보다 앞선 것 `limit + 1`건 → 메모리 병합 정렬 → `limit`건 반환 → 마지막 행으로 `nextBefore` → 종류별 `limit + 1`건째가 있었으면 `truncated`.

### 3-4) 소유 파일

| 파일 | 역할 |
|------|------|
| `backend/src/utils/customer-timeline.ts` (신설 CT) | 카탈로그·식별·종류별 fetcher·병합·커서. **원천을 늘릴 때 여기만** |
| `backend/src/utils/sms-queue.ts` (함수 1개 추가) | `getCompanySmsTablesWithLogsRange(companyId, months)`: 1-4의 당월·전월 제한 대신 N개월 log를 붙인다. 기존 함수 무변경 |
| `backend/src/routes/customers.ts` | `GET /:id/timeline` 1개 추가 |
| `frontend/src/components/customer360/Customer360Panel.tsx` (신설) | 헤더·요약·필터 칩·일자 묶음 타임라인·더 보기 |
| `frontend/src/components/customer360/timeline-kinds.ts` (신설) | kind → lucide 아이콘·색 토큰 표(라벨은 서버가 준다) |
| `frontend/src/components/CustomerDBModal.tsx` | 우측 패널을 `Customer360Panel`로 교체 + 껍데기 콘솔 톤(§2-8) |

### 3-5) 화면

- **자리(★2026-08-22 Harold 확정 · 2차 정정)**: 대시보드 "DB 현황" 카드의 "상세보기"가 여는 `CustomerDBModal`을 **풀스크린 작업면(92vh, 인디고)** 으로 키우고, 목록은 **전체 폭**을 그대로 쓴다. 고객을 고르면 `Customer360Modal`이 **그 위에 자기 창으로** 뜬다(z-[60]).
  - **헤더 메뉴는 두지 않는다.** 처음엔 "고객" 메뉴를 넣었다가 뺐다(Harold: 헤더가 이미 길고, DB 현황 카드로 충분하다). 진입점 = 상세보기 · `?customer=<id>` 둘.
  - **버린 안 셋**: ①목록 옆에 패널 붙이기 → 표는 컬럼이 잘리고 패널은 칩이 가로 스크롤에 갇혔다 ②고객을 고르면 목록을 300px로 접기(마스터-디테일) → 목록을 다시 보려고 여닫는 동작이 늘었다 ③**조회 모달 자체를 콘솔 톤 풀스크린으로 재작성** → Harold "예전이 낫다, 지금 게 구려 보인다"로 **원본 롤백**(`git show b6c90c26`). 제목도 "고객"이 아니라 **"고객 DB 조회"**가 맞다.
  - **최종형**: 조회 모달은 **0821(14) 원본 그대로**(1100px · 옛 톤 · CUI 토큰 0)이고, 얹은 것은 **행 클릭 → `Customer360Modal`** 하나뿐이다. 옛 우측 35% 패널은 360 모달의 접이식 "기본 정보"가 같은 필드 표·같은 포맷터로 이어받아 사라진 정보가 없다. 순 변경 = 92줄 추가 · 63줄 삭제(그 63줄이 옛 패널).
  - ⛔ **교훈**: 옆 화면을 콘솔 톤으로 올렸다고 이 화면도 올려야 하는 것이 아니다. **쓰던 화면을 갈아엎을 때는 갈아엎기 전에 묻는다.** 이번엔 안 물었고 세 번 돌았다.
  - **요금제 게이트는 진입점 하나가 소유한다** — `Dashboard.openCustomerDb()`. 기준 = `customer_db_enabled`(STARTER+) + 구독 잠금. 진입점이 둘이라 각자 판정하면 한쪽이 빠진다.
  - **주소**: `/dashboard?customer=<id>`로 열면 그 고객의 360이 바로 뜬다. 기존 `?upload=1`(업로드 모달 자동 오픈·파라미터 제거) 패턴을 그대로 따른다. 타겟 발송 수신자 행·발송결과 번호·인바운드 알림이 이 주소로 점프한다(Phase 1·3의 진입점).
  - 모달을 올리면서 같이 정리: 수신동의 칸 `true`/`false` 원문 → "동의/거부" 칩, 에메랄드 옛 톤 → 콘솔 톤, 다운로드 옆 빨간 "전체 삭제" → 관리자 전용 `⋯` 메뉴 뒤로(파괴적 행동을 주 동선에서 뗀다. 기능은 그대로).
- **헤더**: 이름 · 번호 · 등급 칩 · 등록 매장 · 수신동의/수신거부 상태 칩(`CUI_PILL`). 아래 요약 4칸: 받은 메시지 · 반응(열람+클릭+응답) · 구매 · 마지막 활동.
- **기본 정보**: 지금의 필드 나열은 접이식 "기본 정보"로 들어간다(사라지지 않는다: `feedback_ui_simplify_not_empty`).
- **필터 칩**: 전체 · 발송 · 반응 · 구매 · 행동 · 동의/거부 · 자동화 · 문의. 칩 = `CUI_CHIP_ON/OFF`.
- **타임라인**: 날짜별 묶음(오늘 · 어제 · 8월 19일 …). 행 = 아이콘 타일(kind별 색) + 제목 + 부제 + 상태 점(`CUI_PILL_DOT`). 발송 행은 펼치면 본문 전문·발신번호·도달 시각, `ref.campaign`이 있으면 "발송 결과 보기" 링크(`ResultsModal` 상세로).
- **더 보기**: `nextBefore`가 있을 때만. 원천이 잘렸으면 "발송은 최근 12개월 중 일부만 보입니다" 안내(`CUI_INFO`).
- **빈 상태**: "아직 기록이 없습니다. 메시지를 보내면 여기에 쌓입니다"(`CUI_EMPTY`).
- **Source caption**: "Data source: 발송 큐 · 고객 DB · 자사몰 이벤트" 한 줄.
- 톤 = 콘솔 톤(`CUI_*`), 이모지 0, 줄표 0, native dialog 0, 모델명 0.

### 3-6) AI 한 줄 요약 (Phase 2)

헤더 밑에 "이 고객은 …" 한 줄. 입력 = 이 API의 `summary` + 최근 사건 30건 요약 텍스트, 출력 = 2문장. 크레딧 = 단일 호출 등급(꾸미기와 같은 **3**, `ai-credit-calc.ts`에 `customer-360-summary` 항목 추가). 버튼 1클릭 · 결과 캐시 24시간(같은 고객 재요청은 무료). Phase 0에서는 만들지 않는다.

---

## 4) 성능: 측정 후 처방

1. **먼저 U-2**: 가장 큰 live 테이블에서 `EXPLAIN SELECT seqno FROM SMSQ_SEND_N WHERE dest_no = '0100000xxxx' ORDER BY sendreq_time DESC LIMIT 51`. `type = ALL`이고 `rows`가 십만 단위면 2로 간다.
2. **인덱스 후보**(U-2가 요구할 때만): `ALTER TABLE SMSQ_SEND_N ADD INDEX idx_dest_sendreq (dest_no, sendreq_time), ALGORITHM=INPLACE, LOCK=NONE`. live 테이블은 Agent가 계속 쓰므로 **영업시간 밖 · 테이블 하나씩**. log 테이블은 읽기 전용이라 아무 때나. root 실행(smsuser는 ALTER 불가, SCHEMA.md 1545). **이 DDL이 확정되면 Codex adversarial 대상**(DB 마이그레이션).
3. U-1이 "하이픈 혼재"면 인덱스 전에 **데이터 정규화 UPDATE가 선행**돼야 한다(`REPLACE()` 비교는 인덱스를 못 탄다). 그것도 측정·백업 후.
4. PG 쪽(5-7 실측 완료): 고객 키 인덱스가 있는 원천 = purchases · consents · dm_event_responses · journey_executions · unsubscribes · opt_outs · cdp_events. **없는 원천 3** = `dm_views`(phone·token이 전부 `dm_id` 선행) · `cdp_inapp_impressions`(customer_id 없음) · `voice_inbound_calls`(customer_id·caller_phone 없음). 후보 = `dm_views(company_id, phone, viewed_at DESC)` · `cdp_inapp_impressions(customer_id, occurred_at DESC)` · `voice_inbound_calls(customer_id)`. 착수 시 각 테이블 행수 + EXPLAIN 1회로 결정(수만 행 이하면 안 건다).
5. 응답 목표: 고객 1명 첫 페이지 1초 안(원천 병렬 `Promise.allSettled`, MySQL은 UNION ALL 1쿼리).

---

## 5) 착수 전 확인 (Harold 실행 · 하나씩)

결과를 받은 뒤에만 코드를 쓴다(`db_column_verify_before_code` · `no_guess_strict`).

**5-1 (MySQL) 테이블 목록**
```sql
SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'SMSQ_SEND_%' ORDER BY TABLE_NAME;
```

**5-2 (MySQL) 하이픈 혼재** (5-1에서 TABLE_ROWS가 가장 큰 테이블 이름으로)
```sql
SELECT SUM(dest_no LIKE '%-%') AS with_hyphen, COUNT(*) AS total FROM SMSQ_SEND_N;
```

**5-3 (MySQL) EXPLAIN** (같은 테이블 · 실존 번호 말고 형식만 맞는 도달 불가 번호)
```sql
EXPLAIN SELECT seqno FROM SMSQ_SEND_N WHERE dest_no = '01000000000' ORDER BY sendreq_time DESC LIMIT 51;
```

**5-4 (PG) customers_unified**
```sql
SELECT table_type FROM information_schema.tables WHERE table_name = 'customers_unified';
SELECT pg_get_viewdef('customers_unified', true);
```

**5-5 (PG) 여정 3테이블 컬럼**
```sql
SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('journeys','journey_steps','journey_executions') ORDER BY table_name, ordinal_position;
```

**5-6 (PG) 이메일 이력 테이블 유무**
```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'email%';
```

**5-7 (PG) 인덱스 현황**
```sql
SELECT tablename, indexname, indexdef FROM pg_indexes WHERE tablename IN ('purchases','consents','dm_views','dm_event_responses','cdp_inapp_impressions','journey_executions','voice_inbound_calls','unsubscribes','opt_outs') ORDER BY tablename, indexname;
```

---

## 6) 단계

| 단계 | 내용 | DDL | 게이트 |
|------|------|-----|--------|
| **0** | CT `customer-timeline.ts` + API + `Customer360Panel` + `CustomerDBModal`을 풀스크린 작업면(좌 목록 · 우 360)으로 확장 + 헤더 "고객" 메뉴 + `?customer=<id>` 자동 오픈. kind 12종 전부(`inbound`는 음성만). MySQL `(dest_no, sendreq_time)` 인덱스 DDL(live 14 + 기존 log) | MySQL 인덱스 확정(5-3) · PG 후보 3은 EXPLAIN 후 | tsc 0 · 불변식(§8) · 실측 1건 · 인덱스 DDL은 Codex adversarial 1회 |
| 1 | 진입점 확장: 직접 타겟 발송 수신자 표 행 클릭 · 발송 결과 상세의 번호 클릭 → 같은 패널 | 0 | 호출부 2곳 |
| 2 | AI 한 줄 요약(§3-6) | 0 | 크레딧 항목 1 |
| 3 | **인바운드 대화**(§9) | 별도 설계 | 별도 |

---

### 5-R) 확인 결과 원장 (Harold 실행)

| # | 결과 | 설계에 미치는 것 |
|---|------|------------------|
| 5-1 (2026-08-22) | `SMSQ_SEND_%` **103개**. log = `_202602`~`_202609`(09는 0행 선생성). 실데이터 2026-03~08 6개월. 최대 = `SMSQ_SEND_8_202606` **846,873행**, 4~9번 라인 5~8월 각 30만~85만. live 최대 69,359(4·5·6번). 전체 약 1,400만 행 | 인덱스 없이 `dest_no` 조회 = 고객 1명당 1,400만 행 스캔. §4-2 인덱스 DDL이 필요할 가능성이 높다(5-3 EXPLAIN으로 확정). `months` 기본 12는 현재 데이터(6개월)를 전부 덮는다. 5-2·5-3의 대상 테이블 = `SMSQ_SEND_8_202606` |
| 5-2 (2026-08-22) | `with_hyphen = 0 / total = 839,349`. 실행 **19.92초** | U-1 해소: 등호 비교 성립, §4-3 정규화 UPDATE 불필요. 84만 행 1테이블 풀스캔이 20초 → 인덱스 없는 고객별 조회는 성립하지 않는다. §4-2 인덱스 DDL 사실상 확정(5-3은 형식 확인) |
| 5-3 (2026-08-22) | `type = ALL` · `possible_keys = NULL` · `rows = 846,873` · `Using where; Using filesort` | **§4-2 인덱스 DDL 확정.** `(dest_no, sendreq_time)` 복합이면 WHERE와 ORDER BY를 한 인덱스로 받아 filesort도 사라진다. 대상 = live 14개(1~11·13~15) + log 전부. **U-7 신설**: 월별 log 테이블을 누가 어떻게 만드는가(Agent가 `CREATE TABLE ... LIKE live`면 live에만 걸어도 다음 달부터 자동 상속, 아니면 매달 DDL이 필요하다). Harold 확인 |
| U-7 (2026-08-22) | Harold "월이 바뀌면 자동 생성되게 구현했다" → 코드 확인: `sms-queue.ts:824 ensureMonthlyLogTables()`가 프로세스 시작 시 당월·다음달을 `CREATE TABLE IF NOT EXISTS <log> LIKE <live>`로 만든다(`ALL_SMS_TABLES` = env `SMS_TABLES`, 13~15는 제외라 log 없음) | **live 14개에만 인덱스를 걸면 다음 달부터 자동 상속**(`LIKE`는 인덱스 복사). 기존 log(202602~202609, 약 90개)는 1회 명시 DDL. 매달 운영 절차 없음 |
| 5-4a (2026-08-22) | `customers_unified` = **VIEW** | 뷰 정의가 어느 행을 합치는지(매장별 중복 행을 이미 합친 뷰인지)가 §2-2 식별 규약과 직결. 5-4b 컬럼 + 정의 확인 |
| 5-5 (2026-08-22) | 여정 3테이블 84컬럼 실측 → **SCHEMA.md 절 신설**. `journeys.name` 있음 · `journey_steps`에 **이름 컬럼 없음**(step_order·step_type·channel만) · `journey_executions.customer_id` 있음 | U-5 해소. 스텝 제목은 "N단계 · 문자"처럼 order+channel로 만든다 |
| 5-6 (2026-08-22) | `email_campaigns`·`email_events` 존재. 컬럼은 코드 INSERT문 기준 SCHEMA.md 등재. `email_events` 키 = `campaign_id + email`(customer_id·phone 없음) | U-6 해소. kind `email` 추가(§3-1). 식별은 펼친 고객 행들의 `email` 집합. 착수 시 `information_schema` 1회로 컬럼 확정 |
| 5-7 (2026-08-22) | 9테이블 인덱스 41건 실측 → **SCHEMA.md 각 절에 등재**. 고객 키 인덱스 **있음** = purchases(customer_id, purchase_date DESC) · consents(customer_id) · dm_event_responses(customer_id) · journey_executions(customer_id) · unsubscribes(company_id, phone) · opt_outs(company_id, phone). **없음** = dm_views(phone·token 모두 dm_id 선행) · cdp_inapp_impressions(customer_id 없음) · voice_inbound_calls(customer_id·caller_phone 없음) | §4-4 확정: PG 인덱스 후보 3 = `dm_views(company_id, phone, viewed_at DESC)` · `cdp_inapp_impressions(customer_id, occurred_at DESC)` · `voice_inbound_calls(customer_id)`. 셋 다 EXPLAIN 후 결정(규모가 작으면 안 건다) |
| 5-4b (2026-08-22) | 뷰 = `PARTITION BY (company_id, phone, name)`에서 싱크 행 우선 rn=1만 + 이름 없는 행 전부. 컬럼 40개(원본의 일부). **SCHEMA.md `customers_unified` 절로 등재** | §2-2 확정: 매장별 중복 행은 이 뷰에서 **접히므로** 식별은 뷰가 아니라 `customers` 원본을 `company_id + phone`으로 읽는다. 접힌 행 id(rn≥2)는 GET /:id가 404 → 타임라인 진입은 뷰가 주는 id(rn=1)로만 들어오므로 문제없음. 헤더의 "등록 매장"은 원본 행들의 `store_name` |

## 6-R) Phase 0 구현 결과 (2026-08-22)

| 파일 | 상태 |
|---|---|
| `backend/src/utils/customer-timeline.ts` | **신설 CT**. 카탈로그 12종·식별·원천별 fetcher·병합·커서. 원천 하나가 죽어도 나머지가 뜬다 |
| `backend/src/utils/sms-queue.ts` | `getCompanySmsTablesWithLogsRange(companyId, months)` 추가. **기존 함수 무변경**(소비처 10곳이 2개월 전제로 돈다) |
| `backend/src/routes/customers.ts` | `GET /:id/timeline` 추가(`/:id`보다 위). `DB_MIGRATION_PENDING` 503 분기 포함 |
| `backend/src/utils/__tests__/customer-timeline.test.ts` | **신설** 11건 |
| `frontend/src/components/customer360/timeline-kinds.ts` | **신설**. 아이콘·색만 소유(라벨은 서버가 준다) |
| `frontend/src/components/customer360/Customer360Panel.tsx` | **신설**. 헤더·요약 4칸·접이식 기본 정보·필터 칩·날짜별 타임라인·더 보기 |
| `frontend/src/components/CustomerDBModal.tsx` | 렌더 재작성(로직 1~367줄 보존). 풀스크린 92vh·콘솔 톤·boolean 칩·전체삭제 `⋯` 뒤로·360 통합 |
| `frontend/src/components/DashboardHeader.tsx` | `onCustomers` prop + "고객" 메뉴(카카오&RCS와 직접발송 사이) |
| `frontend/src/pages/Dashboard.tsx` | `onCustomers` 배선 + `?customer=<id>` 자동 오픈 + `initialCustomerId` 전달 |

**자체 적대 검토에서 잡은 결함 3건**(전부 수정 완료):
1. **MySQL 시각 축이 9시간 어긋났다.** 커서(UTC ISO)를 `sendreq_time <= ?`에 그대로 넘기고 있었다. SMSQ는 KST naive이고 기존 경로는 전부 `'YYYY-MM-DD HH:mm:ss'`를 넘긴다. `isoToKstSql`·`kstSqlToIso`로 양방향 변환하고, 꺼낼 때는 `DATE_FORMAT`으로 문자열을 받아 `+09:00`을 붙인다(**드라이버 타임존 해석에 기대지 않는다**). 테스트 3건으로 잠갔다.
2. **`_future` 판정이 항상 false였다.** `!!r._future && num(r._future) === 1`은 드라이버가 boolean을 주면 `num(true) = NaN`이라 통과하지 못한다. 예약 발송이 "결과 대기"로 보였을 것. `r._future === true || num(r._future) === 1`로 정정.
3. **요약 집계가 화면을 붙잡을 수 있었다.** `countSends`가 테이블마다 `COUNT(*)`를 도는데 인덱스가 없으면 20초씩 걸린다. 4초 제한을 두고 못 세면 요약만 비운다.

**첫 화면 확인에서 잡은 결함 3건**(2026-08-22 Harold "너무 보기 힘들다" — 전부 수정 완료):
1. **`CUI_SELECT`·`CUI_INPUT`은 `w-full`을 갖는다.** 뒤에 `w-auto`·`w-40`을 붙여도 Tailwind 출력 순서상 `w-full`이 이겨 필터 select가 전폭을 먹었다. **폭은 래퍼 div로 잡는다**(토큰에 손대지 않는다 — 다른 소비처가 전폭을 전제한다).
2. **목록과 패널이 서로를 밀어냈다.** 컬럼 10개짜리 표 옆에 440px 패널을 붙이니 표는 잘리고 패널 안 칩은 가로 스크롤에 갇혀, 패널이 표 위에 얹힌 것처럼 보였다. → **마스터-디테일**: 고객을 고르면 목록이 **이름·번호·등급만 있는 300px 리스트로 접히고** 패널이 나머지를 전부 쓴다. 닫으면 표가 전체 폭으로 복귀.
3. **패널이 넓어지면 줄이 화면 끝까지 퍼진다.** 읽기 폭 `max-w-[880px]`(WRAP)을 헤더·기본 정보·칩·타임라인에 공통 적용. 칩은 가로 스크롤 대신 줄바꿈.

> ⛔ 일반화: **토큰이 이미 폭·정렬을 갖고 있으면 뒤에 붙이는 유틸리티로 못 이긴다.** 래퍼로 감싸거나 토큰을 고친다(고치면 전 소비처 확인).

**요금제 게이트 (2026-08-22 Harold "요금제를 안 쓰는 곳에 줄 이유가 없다")**
- 화면: `Dashboard.openCustomerDb()` 한 곳이 판정을 소유(`customer_db_enabled` STARTER+ · 구독 잠금). 진입점 2개(상세보기 · `?customer=`)가 이 함수를 통과한다.
- API: `GET /:id/timeline`에 `requirePlanFeature('customer_db_view')`. **화면만 막으면 API가 열린 채라 가림막이다.**
- ⛔ **적재 키 `customer_db`와 다른 키를 새로 만들었다.** 적재는 2026-08-14에 전 플랜 개방됐고 그대로 둔다 — 그 분기를 막으면 싱크·업로드가 403으로 끊긴다(아난티 최초 동기화 96,903건 유실, plan-guard 상단 "되살리지 말 것"). 두 키가 갈려 있음을 `plan-guard.verify.ts` 4건이 잠근다.
- **별건**: `/api/customers` 나머지 경로에는 게이트가 없다. 직접 타겟 발송 추출·대시보드 통계·여정이 함께 써서 통째로 막으면 FREE 사용자의 발송이 죽는다. 엔드포인트별 전수 확인 후 별도 축.

**게이트 결과**: 백엔드 tsc 0 · 프론트 tsc 0 · vitest **189파일 2,896건 전량 통과**(회귀 0) · 프론트 `build:safe` 성공(lazy 청크 38건·비literal 동적 import 0 게이트 통과) · 모델명·native dialog·화면 이모지·줄표 0 · 검출기 지적 3건은 삼항 두 갈래를 섞어 읽은 오탐(배경과 글자는 항상 같은 갈래).

**Codex**: 읽기 전용 조회 경로라 대상 제외(`feedback_codex_scope_write_path_or_ddl_only` — 쓰기 경로·DDL만). 아래 인덱스 DDL은 데이터를 바꾸지 않고 되돌리기가 자명해(`DROP INDEX`) 같은 기준으로 제외한다.

## 6-D) 배포 전 실행 DDL (Harold)

`(dest_no, sendreq_time)` 인덱스. **없으면 고객 1명 조회가 테이블마다 전행 스캔**이다(5-3 EXPLAIN).

> ⛔ **이건 MySQL(smsdb) DDL이다. PG(psql)가 아니다.** 그리고 **root로 접속해야 한다** — `smsuser`는 `smsdb.*` 스키마 권한을 갖지만 CREATE·ALTER는 없다(OPS.md §355 · 2026-08-22 실패로 재확인: `ERROR 1142 ALTER command denied`).
> ```
> docker exec -it targetup-mysql mysql -uroot -p smsdb
> ```

- `LIKE`로 만들어지는 다음 달 log는 live 인덱스를 **자동 상속**한다(U-7). 그래서 live 14개 + 기존 log가 대상.
- live는 발송 Agent가 계속 쓰므로 **영업시간 밖에 하나씩**. log는 읽기 전용이라 아무 때나.
- 순서 = 작은 live(수백 행)부터 → 큰 live(약 7만 행) → 기존 log(최대 84만 행).

### 6-D-R) 실행 결과 (2026-08-22, Harold 실행)

| 항목 | 결과 |
|---|---|
| 적용 범위 | **103개 전부**(live 15 + log 88). 누락 확인 = `information_schema.STATISTICS`에 `idx_dest_sendreq`가 없는 `SMSQ_SEND_%` BASE TABLE **0행** |
| 소요 | 대부분 1초 미만. 최장 `SMSQ_SEND_9_202606` 37.7초 · `SMSQ_SEND_7_202606` 30.6초 · `SMSQ_SEND_9_202605` 29.3초. `LOCK=NONE`이라 발송·조회 중단 0 |
| 효과(같은 EXPLAIN 재측정) | `type` **ALL → ref** · `key` **idx_dest_sendreq** · `rows` **846,873 → 1** · `Extra` = **Backward index scan; Using index** |
| 뜻 | 인덱스만 읽고 테이블 본체를 안 읽는다(covering). `ORDER BY sendreq_time DESC`도 인덱스 역방향 스캔으로 해결돼 **filesort가 사라졌다**. 5-3에서 `Using filesort`였던 것이 없어진 것이 이 인덱스를 `(dest_no, sendreq_time)` 복합으로 잡은 이유다 |

> 되돌리기 = `ALTER TABLE <t> DROP INDEX idx_dest_sendreq` (데이터 무변경).
> 다음 달 log는 `ensureMonthlyLogTables()`가 `LIKE`로 만들므로 이 인덱스를 **자동 상속**한다(U-7).

## 7) 상태·잔여

- 2026-08-22 **Phase 0 코드 완료**(6-R). 남은 것 = 6-D 인덱스 DDL 실행 → 배포 → §8 실측 1건. 다음 단계 = §6의 1(진입점 확장) · 2(AI 요약) · 3(인바운드 대화).
- 2026-08-22 설계서 작성 → **§5 확인 7건 + U-7 전부 완료**(5-R). 미검증 U-1~U-7 전부 해소. 실측 전부 SCHEMA.md 등재(customers_unified 뷰 · 여정 3테이블 · voice · email 2종 · 9테이블 인덱스 41건 · MySQL 103테이블·규모·인덱스 부재). 확정 DDL = MySQL `(dest_no, sendreq_time)` live 14 + 기존 log(1회). PG 인덱스 후보 3은 착수 시 EXPLAIN. 코드 변경 0. **⛔ Harold "구현해" 지시 전 구현 금지**(2026-08-22 명시).

---

## 8) 게이트·테스트

- `backend/src/utils/__tests__/customer-timeline.test.ts`: ①커서 tie-breaker(같은 `at` 3건이 두 페이지에 걸쳐도 누락·중복 0) ②원천 하나가 throw해도 나머지 종류가 돌아온다(§2-6) ③`truncated` 판정 ④번호 정규화가 `normalizePhone` 결과와 같다 ⑤카탈로그 kind 11종 전부가 제목 생성기를 갖는다.
- 프론트 불변식(기존 3종) 통과 · 모델명·native dialog·이모지·줄표 0 · 검출기 1회.
- 실측 1건: 테스트 계정 `hoyun` 고객 1명에서 발송 2건 이상 · 구매 1건 · 수신거부 1건이 한 타임라인에 시간순으로 보이고, "더 보기"가 같은 행을 두 번 내지 않는다.
- Codex: 읽기 전용 경로라 기본 대상 제외. **MySQL 인덱스 DDL이 확정되면 adversarial 1회**.

---

## 9) 다음 축: 인바운드 대화 (여기서 끝나는 지점)

이 문서가 남기는 접점 세 가지. 인바운드 설계는 이 셋을 **쓰기만** 하면 된다.
1. 카탈로그에 `kind = 'inbound'`가 있고 음성 통화가 이미 들어간다. 문자 회신(MO)·카카오 상담톡 수신은 같은 kind에 `channel`만 다르게 붙는다.
2. 식별은 `company_id + phone`이다. 수신 메시지의 발신 번호를 `normalizePhone`으로 맞추면 그대로 같은 타임라인에 꽂힌다.
3. 패널의 "문의" 필터 칩이 비어 있는 채로 먼저 나간다. 대화가 들어오면 그 칩이 차기 시작한다.

---

## 10) 뒤집힌 판단

| 처음 생각 | 실제 | 왜 |
|---|---|---|
| PG `messages`로 고객별 발송을 읽으면 된다 | MySQL 큐만이 진실 | `messages`에 쓰는 코드가 0건이었다(1-1) |
| `customer_id` 하나로 묶는다 | `company_id + phone`으로 펼친다 | 같은 번호가 매장별로 여러 행(1-6) |
| 타임라인 패널만 만든다 | 조회 모달 껍데기도 같이 올린다 | 한 모달에 두 톤이 생긴다(§2-8, 0821 "한 번에 제대로") |
| 헤더 "고객" 메뉴 + `/customers` 페이지 신설(AI가 추천) | **모달을 풀스크린으로 키우고 그 안에** + 헤더 메뉴는 같은 모달을 연다 + `?customer=<id>` 주소 | Harold 결정(2026-08-22). 페이지를 밀었던 이유(메뉴 발견성·주소)는 이 둘로 같이 해결되고, 직접발송·발송결과가 메뉴에서 모달을 여는 기존 규칙과 맞는다 |
