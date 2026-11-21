# C151 한 줄로 묻기(버전강화) — 설계서

> 카드 C151 · 2026-11-21 · 목업 = `docs/mockups/2026-11-21-ask-entry-flow-mockup.html`(Harold 확정 · 3단계 마법사 · 한 화면 맞춤)
> 접수 = Harold 1121 「우리 기능이 그렇게 쉽게 따라올 수 있는 기능인가? 그렇다면 더 강화」 · 「부족한 부분 메우는 목업부터 설계 · 그 설계를 기준으로 구현」 → 목업 확정 → 「아예 버전강화작업하던거 마무리하고 같이 커밋하자」 → 「설계 · 구현까지」 → 「정할 것」 열 가지 「추천대로」
> 함께 커밋 = C150 2차(경보 창 날짜 · C149 빈틈 문구) · 원장 C150-H2 + C151-H1
> 이력 = 1판 → 2판(Codex 설계 1R 지적 다섯 수용 = §2-1 대상 한 문장 · 과금 키 = 사람 입력만 · 넘기기 계정 · 10분 · 문안 = 입력 버전 결속 · 혜택 세 갈래) → 3판(2R = planned 에 5만 상한 · 혜택 자리표가 남은 문안 = 가져가기 잠김) → 4판(3R = 자리표 판정 = 발송 길목의 `findUneditedSendPlaceholder` 하나)

## §0 접수 · 결정

| # | 원문 · 결정 | 이 설계가 닫는 자리 |
|---|---|---|
| A | 스냅 대비 부족 = 대화 입구 하나 · 고객 격자 · 예산에 맞춘 대상 자르기(1121 재대조 · ROADMAP §W) | §2 S1 · S2 · F1 |
| D1 | 화면 틀 = 마법사 전용 틀(목업대로 · AI 존 남색 머리 띠 안 씀) — 디자인 하한 「AI 존 틀 정합」의 예외(Harold 1121 결정) | F1 |
| D2 | 메뉴 이름 = 「한 줄로 묻기」 | F2 |
| D3 | 크레딧 = 문안 만들 때만 2(묶음 · 인원 · 예산 계산 0) | S3 |
| D4 | 묶음 기준 = 고정 경계(마지막 구매 일수 × 구매 횟수) · SQL 한 번 · 새 계산 한 곳 | S1 |
| D5 | 묶음별 발송 성과 숫자 = 뺌 | - |
| D6 | 보내기가 아닌 질문 = 범위 밖 · 기존 AI 한줄로로 넘김 | F1 첫 화면 링크 |
| D7 | 도착 확인 = 문안이 뜨면 자동 시작 · 같은 글 = 이어 보기(재과금 0) · 문구 「검사 문자 요금이 들어요」 | F1 3단계 |
| D8 | 한 통신사 막힘 = 경고만 · 넘길 수 있음(보내기 판단 = 직접발송 창의 담당자) | F1 3단계 |
| D9 | 「고쳐서 다시 확인」 = 2크레딧(다시 만들기 1회) | S3 |
| D10 | 문안 = 한 안 | S3 |

## §0-1 미가입 · 직접발송 회사 변화 0

| 길 | 바뀐 코드 | 미가입 · 직접발송에서 왜 0 인가 | 증명 |
|---|---|---|---|
| 새 주소 `/api/ai-line/ask/*` | `routes/ai-line.ts` | 같은 라우터 관문(`aiZonePlanBlocked` = AI 존 요금제) · 미가입은 403 | 라우터 분류 계약(R2) |
| 새 화면 `/ai-ask` | 새 페이지 · AI 허브 탭 한 칸 | AI 허브 띠(유료 AI 존 화면)에서만 들어감 · 미가입 = 서버 403 | 계약 K5 |
| 직접발송 창 넘기기 | `Dashboard.tsx` `loadPendingAudience` · `utils/product-insight.ts` | 넘긴 값(메모리 · 한 번 쓰면 비움)이 있을 때만 · 없으면 종전 그대로(맡긴 것 없음 = 아무 일 0) | 계약 K6 |
| `runLineCompose` | 입력에 `ask` 칸(있을 때만 갈래) | AI 한줄로 기존 호출 = `ask` 없음 = 옛 문장 · 옛 키 · 옛 차감 그대로 | 계약 K4 · 기존 시험 |
| `product-signal.ts` | 함수 셋 `export` 만 | 동작 무변경 | 기존 시험 |

## §1 흐름 표 (소스에서 뽑은 이음매)

| # | 이음매 | 쓰는 쪽 | 읽는 쪽 | 값 범위 · 판정 | 그리는 화면 |
|---|---|---|---|---|---|
| F1 | 진입 | AI 허브 탭(`AiHubBand.tsx` TABS) | `/ai-ask` 라우트(`App.tsx` · `PrivateRoute` 회사 계정) | 요금제 밖 = 서버 403 → 화면 안내 | 허브 탭 셋 |
| F2 | 한 줄 읽기 | `POST /ask/read`(AI 0 · DB 0 · 무과금) | `readAskLine`(새 · 순수) | 묶음 낱말 · 예산 금액 · 혜택 낱말 유무 · 빈 줄 · 2000자 넘음 | 1단계 미리 고름 · 「한 줄에 적으신 대로」 |
| F3 | 묶음 세기 | `GET /ask/segments` | `countAskCells`(새 · SQL 한 번) · `sendableCustomerSql`(있음 · product-signal) · 회사 단가 `resolveChargeUnitPrice` | 칸 15 + 구매 기록 없음 · 칸마다 고른 범위 안 고객 · 보낼 수 있는 번호 수 · 단가 미설정 = 예산 칸 잠김 · 담당자 = 자기 범위(주인 범위 CT) · 매장 미배정 = 0 | 1단계 줄 · 격자 · 2단계 인원 |
| F4 | 대상 세기 · 예산 자르기 | `POST /ask/count`(2단계 · 고른 묶음이 바뀔 때마다) | `askAudienceSql`(새 · §2-1 대상 한 문장) · `askPlan`(순수) | 고른 묶음 전체에서 번호 하나 = 한 사람(칸끼리 같은 번호 = 한 번) · 모두 · 예산(원 → 인원 = floor(예산 / 장문 단가)) · 순서(최근 구매 · 구매 횟수) | 2단계 인원 · 「이렇게 보내요」 |
| F5 | 문안 만들기 | `POST /ask/compose` | `runLineCompose`(있음 · `ask` 칸) · `generateMessages`(목소리 · 혜택 감지 · 효능 거름) | 대상 0 = 400 · 크레딧 부족 = 402 · 같은 시도 = 같은 키 = 0 · 혜택 = 사람이 적은 글만(한 줄 + 혜택 칸) | 3단계 말풍선 |
| F6 | 도착 확인 | 화면이 `POST /api/ai-line/spam-test`(있음) | `startLineSpamTest`(있음 · 등록 발신번호 · 같은 글 이어 보기 · 선불 = 검사 문자 요금) | 기본 발신번호 없음 · 요금제 밖 · 잔액 부족 · 막힘 · 확인 중 | 3단계 통신사 셋 |
| F7 | 고쳐서 다시 | `POST /ask/compose`(`retryBlocked`) | 같은 문안 길 + 참고 글 한 줄 | 새 시도 = 2 | 3단계 막힘 줄 |
| F8 | 넘기기 | 화면 `stashAudience({kind:'ask', owner, …})` → `/dashboard?open=direct-send` | `Dashboard.loadPendingAudience` → `POST /ask/audience`(지금 다시 셈 · §2-1 같은 문장) | 0명 · 실패 · 5만 명 넘음(앞에서부터) · 다른 계정(회사 · 사용자) · 10분 지남 · 받는 사이 계정이 바뀜 = 버림 | 직접발송 창 명단 · 문안 · 제목 · 장문 · 광고 |
| F9 | 발송 | 직접발송 창(있음) | 그 길 그대로(수신거부 · 중복 · 회신번호 · 광고 표기 · 차감) | 변화 0 | 직접발송 창 |

빈칸 0.

## §2 서버

### S1 묶음 CT — `utils/ask-segments.ts`(새)
- 칸 = 마지막 구매(`customers.recent_purchase_date` · 한국 날짜 기준 지난 일수) 5줄 × 구매 횟수(`purchase_count`) 3칸 + 「구매 기록 없음」(`recent_purchase_date IS NULL`).
  - 줄 = 0: 0 ~ 30일 · 1: 31 ~ 90 · 2: 91 ~ 180 · 3: 181 ~ 365 · 4: 366일 넘음(미래 날짜 = 0줄).
  - 칸 = 0: 1번 이하(NULL · 0 포함 · 날짜는 있으니 한 번은 산 분) · 1: 2 ~ 3번 · 2: 4번 이상.
- 묶음 = 목업 그대로: new(0,0) · loyal(0,1 · 0,2 · 1,1 · 1,2) · next(1,0) · fade(2,*) · rest(3,0 · 3,1 · 4,0 · 4,1) · leave(3,2 · 4,2) · nobuy. 이름 = 첫 구매 직후 · 요즘 단골 · 다음 구매 차례 · 뜸해지는 중 · 오래 쉰 고객 · 떠나는 단골 · 구매 기록 없음.
- `askCellSql(alias)` = 칸 키 CASE 한 곳(세기 · 명단이 같은 식).
- `countAskCells(companyId, viewerUserId)` = 한 문장: 고른 범위(주인 범위) 안 활성 고객 수 · 그중 보낼 수 있는 번호 수(`sendableCustomerSql` = 활성 · 수신동의 · 수신거부 · 무효 · 수신거부 표 · 주인 범위 · product-signal 과 같은 CT) · 칸별. 시간 제한 = product-signal 과 같은 `boundedRead`.
- **§2-1 대상 한 문장 `askAudienceSql(sendable, order)`** (★ Codex 설계 1R #1) — 세기 · 명단이 같은 문장의 두 끝:
  ```sql
  WITH picked AS (
    SELECT DISTINCT ON (TRIM(c.phone)) c.id, TRIM(c.phone) AS phone, c.name, c.recent_purchase_date, c.purchase_count
      FROM customers c
     WHERE c.company_id = $1 AND <sendable> AND NULLIF(TRIM(c.phone), '') IS NOT NULL AND <askCellSql(c)> = ANY($2::text[])
     ORDER BY TRIM(c.phone), <순서 칸>, c.id      -- 번호마다 대표 행 = 요청 순서의 앞 행
  ) SELECT … FROM picked ORDER BY <순서 칸>, id
  ```
  세기 = `SELECT COUNT(*) FROM picked`(고른 묶음 전체 · 칸끼리 같은 번호 = 한 번) = `sendable` · **보낼 인원 `planned` = min(sendable, 예산 인원(모두면 무한), 5만)**(★ Codex 설계 2R) · 금액 = planned × 장문 단가 · 명단 = 같은 CTE + `LIMIT planned`. 2단계 인원 · 금액 · 넘긴 명단 수가 같은 값(planned)에서 나온다 · 5만에 걸리면 「한 번에 5만 명까지 가져가요」 한 줄(칸별 수를 더하지 않는다). 1단계 칸 · 묶음 숫자 = 칸마다 번호 수(안내용 · 「묶음을 겹쳐 고르면 같은 분은 한 번」 한 줄).
  순서 칸 = 최근 구매 `recent_purchase_date DESC NULLS LAST` · 구매 횟수 `purchase_count DESC NULLS LAST, recent_purchase_date DESC NULLS LAST`.
- `countAskPlan(companyId, viewerUserId, plan)` = 위 세기 + 고른 범위 안 활성 고객 수(빼는 고객 한 줄용) · `listAskAudience(…)` = 위 명단.
- `readAskPlan(raw)` = 입력 검사 한 곳(묶음 키 = 아는 것만 · 1개 이상 · 모드 all / budget · 예산 = 1,000 ~ 100,000,000원 정수 · 순서 recent / count).
- `askPlan(sendable, unitPrice, plan)` = (순수) planned = min(sendable, 모두면 무한 · 예산이면 floor(예산 / 단가), `ASK_AUDIENCE_MAX` 5만) · 금액 = planned × 단가 · capped(5만에 걸림) · 단가 미설정 = 예산 모드 불가. 세기 · 명단 주소가 이 함수 하나로 planned 를 정한다.
- `readAskLine(line)` = (순수) 낱말 규칙: 떠나 · 이탈 · 발길 = leave / 오래 · 안 온 · 쉰 = rest / 뜸 = fade / 첫 구매 = new / 단골(떠나 없이) = loyal / 다음 구매 = next / 구매 기록 없 · 안 산 적 · 가입만 = nobuy / 「N만 원 · N원」 = 예산 / 혜택 낱말(% · 쿠폰 · 할인 · 무료 · 증정 · 적립) 유무. 못 읽으면 기본(leave).
- 회사 단가 = `SELECT cost_per_sms, cost_per_lms, unit_price_basis FROM companies` + `resolveChargeUnitPriceDetailed(…, 'LMS')`(장문 기준 · `unset` = 예산 잠김).

### S2 주소 — `routes/ai-line.ts`(같은 라우터 · 같은 관문 `lineGate` = AI 존 요금제)
- `POST /ask/read` `{ line }` → `{ groups, budget, hasBenefit }`(AI 0 · DB 0 · 관문 = 로그인만 · `/read` 와 같은 꼴).
- `GET /ask/segments` → `{ cells: [{ key, row, col, group, total, sendable }], nobuy: { total, sendable }, unitPrice: { lms, unset } }`.
- `POST /ask/count` `{ plan }` → `{ inScope, sendable, planned, amount, unitPrice }`(§2-1 세기 · 2단계).
- `POST /ask/audience` `{ plan }` → `{ recipients: [{ phone, name }], total, truncated }`(지금 다시 셈 · §2-1 명단).
- `POST /ask/compose` `{ line?, plan, benefitMode: 'line' | 'custom' | 'none', benefit?, retryBlocked?, attemptToken }` → `{ card: { body, subject, byteCount }, channel, count, charged, benefitHole }` · `benefitHole` = 본문 · 제목에 채우지 않은 자리(혜택 · 링크)가 남음 = **`findUneditedSendPlaceholder(body, subject)` 가 null 이 아님** — 넘긴 문안이 나갈 직접발송 길목(`direct-send-core` · 캠페인 생성)이 막을 때 쓰는 그 판정 한 곳(★ Codex 설계 2R #5 · 3R = 가져가기 잠금 ⇔ 발송 길목이 막는 글). 혜택 감지의 자리표(`BENEFIT_PLACEHOLDER` = 「[혜택 안내: 직접 수정해주세요]」)는 `AI_FILL_DIRECT_PATTERN` 이 잡는다.
- 오류 꼴 = 그 라우터 `fail`(402 · `AiLineError` · `respondUserError`) · 표 · 칸 없음 = 해당 없음(새 표 0).

### S3 문안 — `runLineCompose` 에 `ask` 칸(있을 때만)
- `LineComposeInput.ask?: { count: number; audienceText: string; extraContext?: string }`.
- `ask` 가 있으면: 대상 = 받은 수 · 받은 글(`assertFiltersTranslated` · `compileHubAudience` · `describeLineFilters` 건너뜀 · 0 = `TARGET_ZERO`) · 기본료 = 없음(`basePaid = true` · D3) · 참고 글 = 목표의 참고 블록에만(근거 글 아님 · R33).
- **과금 키(★ Codex 설계 1R #2)** = `aiLineCopyKey` 지문 입력에 `ask.keyInput` = **사람 입력만**(정리한 한 줄 · 정렬한 묶음 키 · 혜택 갈래 · 혜택 글 · 다시 고침 여부). 다시 센 수 · 묶음 글 · 참고 글(서버 계산값)은 넣지 않는다 → 응답 유실 뒤 같은 시도 토큰 재요청 = 같은 키 = 0(그 사이 인원이 바뀌어도).
- **혜택 세 갈래(★ Codex 설계 1R #5)** — 근거 글(license)은 한 갈래만:
  - `line`(혜택 칸 비움 · 기본) = 근거 = 사람이 적은 한 줄(한 줄 속 혜택 허용) · 한 줄이 없으면 묶음 문장.
  - `custom`(혜택 칸에 적음) = 근거 = 묶음 문장 + 혜택 칸 글(`facts.benefit`) · 사람의 한 줄은 참고 글로만.
  - `none`(「혜택 없이」) = 근거 = 묶음 문장 · `facts.benefit = null` · 사람의 한 줄은 참고 글로만(「혜택은 쓰지 않는다」) → 한 줄 속 쿠폰이 근거에 없어 혜택 감지(R33)가 지어낸 혜택으로 걸러 낸다.
- 라우트가 정함: `types` = `['benefit']`(D10 한 안) · `vars` = [] · `channel` = `LMS`(예산 단가와 같은 기준) · `isAd` = true · `count` · `audienceText` = §2-1 세기 · 묶음 이름.
- `retryBlocked` = 참고 글 「앞 문안이 통신사 스팸 검사에서 막혔다 · 같은 사실로 광고 냄새가 강한 표현(과장 · 강한 권유 · 특수문자 남용)을 줄여 다시 쓴다」(근거 글 아님 · 새 시도 토큰 = 새 키 = 2 · D9).
- `ask` 없는 호출(AI 한줄로) = 한 글자도 안 바뀐 갈래(K4).

### S4 넘기기 — `utils/product-signal.ts` 함수 셋 `export`
- `sendableCustomerSql` · `boundedRead` · `toAudience` 를 `export` 만(본문 무변경) → S1 이 같은 CT 를 쓴다(R1).

## §3 화면

### F1 `pages/AiAskPage.tsx`(새 · `/ai-ask`) — 목업 그대로
- 처음 화면: 워드마크 + 한 줄 입력(Enter = 읽기 · 시작) · 시작 줄 셋(오래 안 온 단골에게 쿠폰 · 고객 묶음부터 보기 · 예산에 맞춰 보내기) · 아래 작은 링크 「다른 걸 물어보시려면 AI 한줄로」(D6 · 한 줄을 AI 한줄로 넘김 = 기존 `lib/hub-recommend.ts` `stashAiLineObjective`).
- 1단계 「누구에게 보낼까요?」 왼쪽 묶음 여섯 + 구매 기록 없음 · 오른쪽 격자(칸 = 묶음 토글) · 숫자 = F3 · 읽기 실패 = 다시 읽기 단추(지어낸 숫자 0).
- 2단계 「N명에게 보낼 수 있어요」 · 고른 수 중 보낼 수 없는 수(수신거부 · 광고 수신 미동의 · 번호 오류 · 한 줄) · 모두에게 / 예산에 맞춰(금액 칩 · 직접 입력 · 순서) · 오른쪽 「이렇게 보내요」(인원 · 금액 · 순서) · 단추 「문안 만들기 · 2크레딧」(이미 만든 문안이 있고 혜택이 같으면 「다음」).
- 3단계 「이 문안으로 보낼까요?」 말풍선(만드는 중 = 자리 칸 · 5초 넘으면 막음 표시) · 혜택 칸 + 「혜택 없이」 · **문안 = 입력 버전 결속(★ Codex 설계 1R #4)**: 만든 문안은 그때의 입력 지문(한 줄 · 묶음 키 · 혜택 갈래 · 혜택 글)을 들고, 지금 입력 지문과 다르면 「문안 다시 만들기 · 2크레딧」 줄 + 「가져가기」 잠김(문안이 지금 입력과 맞을 때만 넘긴다 · 2단계 「다음」도 같은 판정) · **혜택 자리표가 남은 문안(`benefitHole`) = 가져가기 잠김** + 줄 「문안에 혜택 자리가 남았어요. 혜택 칸에 적거나 다시 만들어 주세요」(혜택 없이에서 지어낸 혜택이 걸러진 경우 포함) · 세 통신사 도착 확인(문안이 뜨면 자동 · 대기 → 확인 중 → 도착 / 막힘 · 문구 「세 통신사에 잘 도착하는지 먼저 확인해요 · 검사 문자 요금이 들어요」) · 막힘 = 경고 줄 + 「고쳐서 다시 확인 · 2크레딧」(D8 · D9) · 단추 「직접발송 창으로 가져가기」.
- 넓은 화면 = 두 칸(왼쪽 고르기 · 오른쪽 요약) · 좁은 화면 = 한 칸 + 아래 고정 줄 · 가로 넘침 0(폭 320 ~ 1920).
- 고객 글 규칙 = 방식 낱말 0(R11) · 모델명 0 · native dialog 0 · 데이터 출처 줄 0 · 5초 넘는 일 = 막음 표시.

### F2 진입 = `AiHubBand.tsx` TABS 한 칸 `{ id: 'ask', to: '/ai-ask', title: '한 줄로 묻기', sub: '고객 골라 보내기' }`.

### F3 `utils/ai-ask.ts`(새 · 화면 호출 · 넘기기 값 만들기).

### F4 넘기기 — `utils/product-insight.ts` `PendingAudience` 에 `kind: 'ask'` + `ask: { plan, message: { body, subject, msgType: 'LMS' }, owner: { companyId, userId }, at }`(★ Codex 설계 1R #3 · C136 `takeProposalPick` 과 같은 꼴) · 꺼낼 때 지금 계정(회사 · 사용자) 같음 + 10분 안일 때만 · 명단 응답을 받은 뒤 채우기 직전에 계정을 한 번 더 본다(다르면 버림) · `fetchAudience('ask', …)` = `/api/ai-line/ask/audience` · `Dashboard.loadPendingAudience` = 명단 더하기(R31 그대로) + `ask` 면 문안 · 제목 · 장문(`setDirectMessage` · `setDirectSubject` · `setDirectMsgType`) · 광고 표기 켬(`setAdTextEnabled(true)` = 기본값과 같음) 채우기 · 안내 글 「고른 고객 N명과 문안을 불러왔어요」.

## §4 영향표

| 바뀌는 것 | 소비처 | 영향 |
|---|---|---|
| `runLineCompose` `ask` 칸 | `routes/ai-line.ts /compose`(AI 한줄로 · `ask` 없음) · 새 `/ask/compose` | AI 한줄로 = 무변경(계약 K4 = `ask` 없는 갈래의 문장 · 키 · 차감 고정) |
| `product-signal.ts` export 셋 | product-insight 라우트 · 새 ask-segments | 무변경 |
| `PendingAudience` 꼴 | `ProductSignalSection.tsx`(stash) · `Dashboard.tsx`(take) | 옛 kind 둘 = 그대로 · 새 kind 만 새 갈래 |
| `AiHubBand` TABS | `/ai-line` · `/ai-operator` 머리 | 탭 셋(폭 320 확인) |
| `App.tsx` 라우트 | 새 주소 하나 | 무변경 |
| 크레딧 | `ai-line-compose` 원천 그대로(2) · 이름표 「AI 한줄로 문안」 그대로 | 새 원천 0 |
| 스팸 검사 | `/api/ai-line/spam-test` 그대로 | 출처 auto_ai(C150 30분 칸 · 1분 확인 문자 그대로 적용) |

## §5 계약 시험 · 실 PG

- `c151-ask-entry-1121.test.ts`
  - K1 묶음 = 칸 15 + 없음 · 목업 묶음 표와 같음 · 칸 판정 경계(30 · 31 · 90 · 91 · 180 · 181 · 365 · 366 · 미래 · NULL · 횟수 NULL · 0 · 1 · 2 · 3 · 4).
  - K2 `askPlan` = 모두 / 예산 · 단가 0 · 미설정 · 예산 < 단가 = 0명.
  - K3 `readAskLine` 낱말 표 · 예산 금액 · 혜택 유무 · 못 읽음 = 기본.
  - K4 `runLineCompose` — `ask` 없는 갈래가 옛 문장(`assertFiltersTranslated` → `compileHubAudience` → … → `aiLineBasePaid`)을 그대로 부른다(구문 트리 · 순서) · `ask` 갈래 = 기본료 0 · 키 지문 = `ask.keyInput` 만(다시 센 수 · 묶음 글이 바뀌어도 같은 키) · 혜택 세 갈래의 근거 글(none · custom = 사람 한 줄이 근거에 없음).
  - K7 넘기기 값 = 계정 · 시각을 들고 · 다른 계정 · 10분 지남 = 꺼내지 않음 · 응답 뒤 계정 재확인 · 문안 입력 지문이 지금 입력과 다르면 · 혜택 자리표가 남으면 가져가기 잠김(순수 함수).
  - K2 넓힘 = planned 5만 상한(6만 명 · 모두 → 5만 · 금액 = 5만 × 단가 · capped) · 세기 · 명단 주소가 같은 함수.
  - K5 새 주소 넷이 `lineGate`(읽기 = `/ask/read` 는 로그인만) · 라우터 분류(R2) · 화면에 방식 낱말 · 모델명 0(R11 · 기존 계약이 자동으로 봄).
  - K6 넘기기 = 대시보드가 `ask` 일 때만 문안 칸을 채운다 · 옛 kind 갈래 그대로.
- 실 PG `c151-ask-entry-1121.pg.test.ts`
  - 칸 세기 = 경계 날짜 고객 · 수신거부 · 미동의 · 무효 · 다른 회사 · 담당자 범위 밖이 빠진다 · 세기 = 명단 수 · 예산 순서 · **칸끼리 같은 번호 = 한 번 · 예산 인원을 같은 번호가 깎지 않음**(중복 번호 뒤에 다른 번호가 있으면 채움).
- 변이 = 칸 경계 하나 옮김 · 안전 조건 뺌 · `ask` 기본료 · 순서 뒤집기 → 빨간불.

## §6 직원 지시문 (구현 전 · 엑셀 한 장)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 시험 계정으로 로그인 → 대시보드 「AI 한줄로」 → 위 탭 「한 줄로 묻기」 | 「누구에게 무엇을 보낼까요」 한 줄 입력과 시작 줄 셋 |
| 2 | 시작 줄 「오래 안 온 단골에게 쿠폰 보내기」를 누른다 | 1단계 · 「떠나는 단골」이 골라져 있고 오른쪽 표의 두 칸이 칠해짐 |
| 3 | 「다음」 | 2단계 「○명에게 보낼 수 있어요」 · 빼는 고객 줄 |
| 4 | 「예산에 맞춰」 → 「5만 원」 | 오른쪽 「이렇게 보내요」 인원이 5만 원 ÷ 장문 단가 이하로 줄어듦 |
| 5 | 「문안 만들기 · 2크레딧」 | 3단계 · 문안이 뜨고 세 통신사 줄이 「확인 중」 → 「도착」 |
| 6 | 혜택 칸에 「10% 쿠폰」을 적는다 | 「문안 다시 만들기 · 2크레딧」 줄이 뜨고 「직접발송 창으로 가져가기」가 눌리지 않음 |
| 6-1 | 「문안 다시 만들기 · 2크레딧」 | 새 문안에 「10% 쿠폰」이 들어가고 「가져가기」가 눌림 |
| 7 | 「직접발송 창으로 가져가기」 | 직접발송 창 · 받는 사람에 4번 인원 · 문안 칸에 6-1 문안 · 장문 |
| 8 | 직접발송 창을 닫고 대시보드에서 직접발송을 그냥 연다 | 받는 사람 · 문안이 비어 있음(넘긴 값은 한 번만) |

## §7 배포

DDL 0 · ENV 0 · 백엔드 + 프론트 빌드(원장 C150-H2 와 한 번에 = C151-H1) · 배포 뒤 S1 = 시험 계정 2 ~ 7 실측.

## §8 범위 밖

- 묶음별 성과(D5) · 보내기가 아닌 질문의 답 화면(D6) · 여러 안 고르기(D10) · 방문 · 상품 축(데이터 있는 실고객사 0곳 · 1121 실측).

## §9 구현 기록 (1121)

| 자리 | 설계서와 다른 점 · 더한 점 | 이유 |
|---|---|---|
| S4 | `toAudience` 는 export 하지 않음(`sendableCustomerSql` · `boundedRead` 둘만) | 명단은 §2-1 문장이 이미 번호 하나 = 한 사람이라 중복 빼기 함수가 필요 없음 |
| S2 `/ask/count` | 응답에 `capped` · `cells[{ key, n, taken }]`(칸마다 대상 수 · 이번에 들어가는 수) 더함 | 2단계 「이렇게 보내요」 내역(목업)을 서버 값으로만 그린다 · 같은 CTE 의 `ROW_NUMBER` ≤ askLimit |
| S2 `/ask/compose` | 혜택 세 갈래 = `askComposeLicense`(CT · 순수) | 라우트 파일 인라인 헬퍼 금지 |
| S1 | `askLimit`(LIMIT) · `askPlan`(planned · amount · capped · want) 둘로 나눔 · 단가 = 원 미만 둘째 자리까지 정수 셈 | SQL LIMIT 은 번호 수를 모르고 정해야 해서 · 29.7원 같은 소수 단가에서 인원이 하나 모자라지 않게 |
| F1 | 시작 줄 = 「오래 안 온 단골에게 쿠폰 보내기」(떠나는 단골 · 혜택은 3단계) · 「고객 묶음부터 보기」 · 「예산에 맞춰 보내기」 · 단가 미설정 회사 = 예산으로 시작하지 않음 · 한 줄 읽는 동안 다른 시작 잠김 · 문안 시도 토큰 = 같은 입력의 실패 재시도는 같은 토큰(성공 뒤 새 토큰) · 검사 번호를 받으면 한 번 읽음(같은 글 이어 보기의 통신사 결과) | Codex 구현 1R 셋 · 응답 유실 뒤 다시 눌러도 두 번 걷지 않게 |
| F2 | 허브 띠 탭 셋 = 640px 아래 아이콘 숨김 · 높이 = 글(폭 320 에서 글이 칸을 넘던 것) | 화면 실측(폭 320 넘침) |
| 카탈로그 | `content/feature-catalog.ts` `ask-entry`(보내기 묶음) | 기능 카탈로그 불변식(새 라우트 = 등재) |
| 옛 계약 | `c133-deploy-a.test.ts` 대시보드 꺼내기 글자 = 계정을 넘기는 꼴로 | 꺼내기가 계정을 받는다(옛 kind 둘은 보지 않음 = K7) |
| 안내 글 | 「LMS 1통 N원으로 계산했어요」 | 채널 이름 주인 표 규칙(R1 넓힘 · 「장문」 금지) |

- 구현 Codex = 1R 지적 셋(한 줄 읽는 중 다른 시작 받음 · 이어 본 막힘 검사의 통신사 결과를 안 읽음 · 단가 미설정인데 예산으로 시작) → 2R(#1 · #3 닫힘 · #2 = 단발 읽기 실패 뒤 멈춤 = 같은 뿌리 → 「검사 번호가 있고 진행 중이거나 결과가 없으면 같은 주기로 읽기」 한 갈래로 합침) → 3R approve.
- 시험 = 계약 27건(K1 ~ K7) · 실 PG 9건 · 변이 넷(경계 30 → 31 · 수신 가능 조건 뺌 · ask 기본료 · 최근 순 뒤집기) 전부 빨간불 · 단위 전체 · 실 PG 전체 초록(카드 C151).
- 화면 실측 = 개발 서버 + 시험 응답(브라우저 안 fetch 대역) · 처음 · 1 · 2 · 3단계(만드는 중 · 확인 중 · 도착 · 막힘 · 혜택 바뀜 · 다시 만들기) · 폭 320 · 375 · 768 · 1440 · 1920 가로 넘침 0. 대시보드 직접발송 창 채움은 시험 응답으로 대시보드 본체를 그리지 못해 계약 K6 + 배포 뒤 S1(§6 7번)이 근거.
