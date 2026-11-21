# C152 스냅컴퍼니 대조 버전업 2차 — 설계서

> 카드 C152 · 2026-11-21 · 앞 = [C151 한 줄로 묻기](2026-11-21-c151-ask-entry-design.md)(대조표의 「메움」 셋 중 보내기 흐름 · 격자 · 예산)
> 접수 = Harold 1121 「한줄로 묻기 … 별도메뉴가 되어도 되지 않냐」 → 「미가입도 보이게 하고 클릭하면 메뉴 설명」 → 「버전업 개발은 다 끝났어? 아니잖아?」 → 「스냅컴퍼니랑 비교해서 우리가 약한것들은 제대로 업그레이드 하기로했잖아」 → 「전체 다 끝까지 진행 · 설계까지 네가 완벽하게 작성하고 설계도 닫힐때까지 코덱스 · 구현한 다음에도 코덱스리뷰 · 보고」
> 대조표 원문 = 1121 오전 대화(스냅푸시AI · 스냅애즈 · 공지 대조) · ROADMAP §W 1121 줄
> 이력 = 1판 → 2판(Codex 설계 1R 일곱 수용 = 답 전체를 한 번만(시도 표 + 질문 결속 · 낸 결과 재생) · 회사 전체 값 판정을 CT 안으로(옛 주소도 같이 닫힘) · 상품 식별 = 추천 상품과 같은 규칙(문 · 키 → 이름) · 사고 안 산 판정 = 번호 단위 · 답의 퍼널 구매 = 매출 반영 주문만 · 처음 화면에 「질문으로 물어보기」 상시 단추 · 방문 0 · 구매 있음 = 카드 보임) → 3판(2R 둘 = 같이 산 상품의 「산 것」 = 추천 상품의 인정 규칙 그대로(구매 당시 이름이 같거나 · 같은 문의 같은 키 · 한 줄이 두 상품에 맞을 수 있다 = 1R #3 과 같은 뿌리라 내 식별 식을 버리고 그 규칙으로 구조를 바꿈) · 유입 경로 줄 = 창 안 방문이 0 이어도 귀속된 경로에 구매 · 매출을 보인다 · 읽기와 답 요청의 겹침 규칙 · §8-1 근거 보강) → 4판(3R 하나 = 같은 뿌리 세 번째 → 상품 식별을 쓰임에 따라 둘로 나눔: **세는 쪽**(같이 산 쌍 · 산 사람 수) = 구매 줄마다 상품 하나(키의 지금 이름) · **빼는 쪽**(「B 를 산 적 있다」) = 추천 상품의 넓은 인정 규칙 + 전 기간. 한 줄이 두 상품에 맞는 것은 빼는 쪽에만 있어 가짜 쌍이 생기지 않는다) → 5판(4R 하나 = 신호 표에 아직 없는 키가 줄마다 다른 이름으로 쪼개짐 → **키 하나 = 상품 하나를 정하는 표 `keymap` 한 곳**(신호 표의 이름 · 없으면 그 키의 가장 최근 구매 줄 이름)을 세는 쪽 · 빼는 쪽이 같이 쓴다 · 줄 자신의 이름으로 상품을 정하는 길은 세는 쪽에서 없앴다 · 전 기간 읽기 = 창 안 a 구매자의 고객 id 로 먼저 좁힘) → 6판(5R 하나 = `keymap` 의 보완 대상을 「신호 표에서 쓸 수 있는 이름을 얻지 못한 키」로 넓힘 · 보완 이름 = 이름이 비지 않은 가장 최근 구매 줄)

## §0 접수 대조 — 대조표 줄마다 이 설계의 처리

| # | 약한 것(1121 대조표) | 처리 | 닫는 자리 |
|---|---|---|---|
| A | 한 줄로 묻기가 AI 한줄로 화면 탭 안에만 있다(Harold 「별도메뉴」) | 대시보드 상단 카드 넷째 칸 · 미가입도 보임 · 누르면 그 기능 안내 창 | §2-A · §3-A |
| B | 대화 하나로 진단부터(질문에 답하는 화면 · 답 안의 표) | 한 줄로 묻기 처음 화면이 질문을 읽으면 답 화면으로 · 답 글 + 근거 + 표(고객 묶음 · 채널 · 상품 · 퍼널 = 데이터 있는 것만) · 표에서 바로 보내기 | §2-B · §3-B |
| C | 격자 칸마다 성과 숫자 | 묶음마다 「1인 평균 구매액」(고객 원장 누적 구매액) · 칸별 ROAS 는 만들지 않는다(§8-1 근거) | §2-C · §3-C |
| D | 판매 상위 + 같이 산 상품으로 다음 캠페인 | 성과 「상품」 구역에 「같이 산 상품」 · 「A 사고 B 안 산 고객에게 보내기」 | §2-D · §3-D |
| E | 유입 채널별 매출 | 성과 화면 「유입 경로」 카드(방문 · 구매 · 매출) | §2-E · §3-E |
| F | 대조군 증분을 성과 첫 줄로 | 성과 화면에서 효과 증명 카드를 숫자 카드 바로 아래로 | §3-F |
| G | 통신사별 도착 숫자 | 통신사 띠가 업종 평균이 없어도 우리 값을 보인다 · 통신사별 **발송** 성공률은 서버 실측 뒤(§8-2) | §2-G · §3-G |
| H | 리뷰 요청 여정 | 이미 있음(`JourneysPage.tsx` 예시 줄 「재구매 후기 + 추천 캠페인」 = 「구매 직후 후기 요청 + 추천 상품 안내」) · 변경 0 | - |
| I | 추천 상품 · 나눠 보내기 · 답장 상담 켜기 | 코드 없음 · Harold 서버 단계(원장 C133-ENV-2 → P2 · M2 → 수신 배선 · 결정 둘 → ENV-3 → P3) | §8-3 |

대조표에서 「보류」 · 「맞붙지 않음」으로 둔 것(앱 푸시 · 쿠폰 사용률 · 광고 매체 분석 · 리뷰 위젯 · 진열 · 사이즈 솔루션)은 이 설계 범위가 아니다.

## §0-1 미가입 · 직접발송 회사 변화

| 길 | 바뀐 코드 | 미가입 · 직접발송에서 | 증명 |
|---|---|---|---|
| 대시보드 상단 카드 | `Dashboard.tsx` 카드 목록 한 줄 · `openAiLine` 인자 | **바뀜 1(Harold 1121 결정)** = 카드 3 → 4 · 넷째 카드를 누르면 「한 줄로 묻기」 안내 창. 나머지 카드 · 직접발송 · 업로드 동작 그대로(`openAiLine()` 기본값 = 옛 값) | 계약 K8 |
| 기능 안내 원장 | `plan-feature-intros.ts` 항목 하나 | 새 id 한 줄 · 다른 항목 무변경 | 계약 K8 · 원장 계약 시험 |
| 새 주소 `/api/ai-line/ask/answer` | `routes/ai-line.ts` | 같은 라우터 관문(AI 존 요금제) · 미가입 403 | 계약 K9 |
| `/api/ai/operator/explain` | 몸통을 CT 로 옮김(응답 · 차감 그대로) · CT 가 회사 전체 값 판정을 한다 | AI 존 관문 그대로 · 미가입 403. **가입 회사에서 바뀜 1** = 분류코드로 나뉜 담당자가 메뉴 없는 실험실 화면 `/ai-explain` 에서 회사 전체 숫자(전체 캠페인 · 전체 고객 통계)로 답을 받던 길이 403 으로 닫힌다(「사용자는 자기 것」 · Codex 설계 1R #2) | 계약 K9 |
| `/api/ai-line/ask/segments` 응답에 칸 하나 | `ask-segments.ts` | 같은 관문 · 미가입 403 | 실 PG |
| 상품 반응 주소 셋(`/pairs` · audience 갈래) | `routes/product-insight.ts` | 단계 개방 관문(`productInsightOpenFor`) · 닫힌 회사 403 | 계약 K11 |
| 유입 경로 주소 | `routes/ai.ts` | AI 존 관문 · 미가입 403 | 계약 K12 |
| 성과 화면 순서 · 통신사 띠 | `PerformancePage.tsx` · `benchmark.ts` · `performance-benchmark.ts` | 성과 화면 = AI 존(미가입은 화면에 못 들어감) | - |

직접발송 · 예약 · 차감 · 큐 · 결과 길은 한 줄도 고치지 않는다.

## §1 흐름 표 (소스에서 뽑은 이음매)

| # | 이음매 | 쓰는 쪽 | 읽는 쪽 | 값 범위 · 판정 | 그리는 화면 |
|---|---|---|---|---|---|
| A1 | 대시보드 카드 | `Dashboard.tsx` `dashboardActions`(AI 메뉴를 숨긴 회사 = 카드 없음 그대로) | `DashboardActionRow`(4개 = 넓은 화면 4열 · 640px 아래 2열 두 줄) | 구독 잠김 = 잠김 창 · `/api/ai/operator/access` false = 안내 창 `ask-entry` · 모름(null) · true = `/ai-ask` | 대시보드 맨 위 |
| A2 | 안내 창 글 | `plan-feature-intros.ts` `ask-entry` | `PlanFeatureModal`(`/api/plans/feature-intros`) | 영상 없음 = 한 단 창 · 크레딧 칩 = `getCreditCost('ai-line-compose')` | 안내 창 |
| B1 | 한 줄 읽기 | `POST /ask/read`(AI 0 · 무과금) | `readAskLine` 에 `intent` 칸(순수) | `ask` = 물음 꼴(§2-B-1) 이고 보내기 낱말이 없음 · 그 밖 = `send`(지금 흐름 그대로) · 어느 쪽으로 읽혀도 처음 화면의 상시 단추 「질문으로 물어보기」가 답 길을 연다 | 처음 화면 확인 줄 · 상시 단추 |
| B2 | 답 받기 | `POST /ask/answer`(질문 · 시도 표) | `answerAsk` → `paidOnce`(키 = 회사 · 시도 표 · 질문 지문) → `runCompanyExplain`(새 CT · 옛 `/operator/explain` 몸통) + `buildAskTables` | 질문 5 ~ 500자 · 근거 문서 0 = 400 · 크레딧 부족 = 402 · 분류코드로 나뉜 담당자 = 403(회사 전체 값 · CT 안 판정) · 같은 시도 표 + 같은 질문 = 낸 답 그대로(기억이 사라졌으면 잔액 확인 없이 다시 쓰고 걷지 않음) · 같은 시도 표 + 다른 질문 = 새 키(새로 걷음) | 답 화면 |
| B3 | 답 안의 표 | `buildAskTables` | 고객 묶음 = `countAskCells`(있음) · 채널 = `channelStats30d`(새 · `buildPerformanceSnapshot` 의 채널 조회를 옮김) · 상품 = `listProductSignals`(있음 · 단계 개방 회사만) · 퍼널 = `buildCdpFunnel`(있음) | 줄이 0인 표 = 싣지 않음 · 표마다 최대 8줄 | 답 화면 표 카드 |
| B4 | 답 → 보내기 | 고객 묶음 표의 줄 단추 | `AiAskPage` `begin` (그 묶음을 고른 1단계) | 묶음 키 = `ASK_GROUPS` 의 키만 | 1단계 |
| C1 | 묶음별 평균 구매액 | `countAskCells`(같은 한 문장에 합 · 수 칸) | `GET /ask/segments` 응답 `cells[].spendSum · spendN` → 화면 `askGroupSpend`(순수) | 누적 구매액이 0보다 큰 보낼 수 있는 고객만 · 묶음에 그런 고객이 5명 미만 = 표시 없음 · 구매 기록 없음 줄 = 표시 없음 | 1단계 묶음 줄 · 답 화면 고객 묶음 표 |
| D1 | 같이 산 상품 | `GET /api/product-insight/pairs` | `listBoughtTogether`(새 CT `product-pairs.ts`) | 최근 60일(상품 신호 보관 기간) · 구매한 사람이 많은 상품 위 10 · 상품마다 같이 산 상품 위 3 · 같이 산 사람 3명 미만 = 싣지 않음 · 시간 제한(`boundedRead`) | 성과 「상품」 구역 탭 |
| D2 | 사고 안 산 고객 수 · 명단 | `POST /audience-counts`(`pairs`) · `POST /audience`(`kind: 'pair'`) | `countBoughtNotBought` · `listBoughtNotBought`(수신 가능 조건 · 담당자 범위 = `sendableCustomerSql`) | 판정 단위 = 번호(같은 번호의 고객 행이 여럿이면 구매를 먼저 합친다) · 0명 = 단추 없음 · 5만 명 넘음 = 앞에서부터(`AUDIENCE_LIST_MAX`) · 세기 = 명단 수(같은 문장) | 줄 끝 단추 → 직접발송 창 |
| E1 | 유입 경로 | `GET /api/ai/operator/performance/inflow-channels` | `listInflowChannels`(새 CT `inflow-channel.ts`) | 최근 30일 · 방문도 구매도 0 = `rows: []`(화면은 그리지 않음) · 줄 = 방문이 있거나 귀속된 구매가 있는 경로(창 안 방문이 0 이어도 창 앞 7일 방문에 귀속된 구매는 그 경로 줄) · 귀속할 방문이 없는 구매 = 「방문 기록 없음」 줄 · 분류코드로 나뉜 담당자 = `rows: []` · 시간 제한 | 성과 화면 카드 |
| F1 | 성과 첫 줄 | `PerformancePage.tsx` 순서 | `EffectProofCard`(무변경) | 서버 칸 준비 전 = 카드 없음(지금 그대로) | 성과 화면 |
| G1 | 통신사 띠 | `benchCell`(평균이 모자라도 내 값은 싣는다) | `spamBenchCells` | 평균 있음 = 「내 값 · 업종 평균」 · 평균 없음 = 내 값만 · 내 값 없음 = 칸 없음 | 성과 화면 띠 |

빈칸 0.

## §2 서버

### 2-A 안내 창 원장
- `content/plan-feature-intros.ts` 에 `ask-entry`(제목 「한 줄로 묻기」 · 단계 넷 · 크레딧 줄 = `ai-line-compose` · `path` 없음 = 허브 카드가 아니다 · 영상 없음).
- `content/feature-catalog.ts` `ask-entry` 의 첫 단계 · 들어가는 길 = 대시보드 카드 기준.

### 2-B 질문에 답하기

**2-B-1 `readAskLine` 의 `intent`** (`utils/ask-segments.ts` · 순수)
- 물음 꼴 = 줄 끝이 `?` · `？` 이거나 낱말 `왜 · 얼마 · 몇 명 · 몇명 · 몇 건 · 어때 · 어떤 · 어느 · 알려 · 궁금 · 분석 · 비교 · 추이 · 현황` 중 하나가 있다.
- 보내기 낱말 = `보내 · 발송 · 문자 · 쿠폰 · 안내해 · 알림 · 홍보 · 메시지`.
- `intent = 물음 꼴 && !보내기 낱말 ? 'ask' : 'send'`. 묶음 · 예산 · 혜택 판정은 그대로(질문이어도 묶음 낱말이 있으면 `groups` 에 담긴다 = 답 화면에서 보내기로 넘길 때 쓴다).
- 틀리게 읽어도 길이 막히지 않는다(Codex 설계 1R #6): `ask` 로 읽힌 줄 = 확인 줄의 두 단추(답 받기 · 보낼 고객 고르기) · `send` 로 읽힌 줄(예: 「문자 발송 성공률이 왜 낮아?」 · 「쿠폰 얼마 줄까?」) = 처음 화면 입력 아래 상시 단추 「질문으로 물어보기」가 같은 줄로 답을 받는다(§3-B).

**2-B-2 CT `services/ask-answer.ts`(새)**
- `companyWideViewer(user)`(`utils/product-signal.ts` 로 옮긴 조각) = 회사 사용자이고 `resolveHubStoreScope` 가 막히지 않고 `storeFilter === ''`. `productInsightOpenFor` 는 이 조각 + 단계 개방으로 다시 쓴다(판정 같음).
- `runCompanyExplain({ companyId, user, question, extraDocs, idempotencyKey, alreadyPaid })` = 옛 `/operator/explain` 의 몸통을 옮긴다:
  1. `companyWideViewer(user)` 가 아니면 403 `ASK_ANSWER_SCOPED` — **회사 전체 값으로 답하는 길 전부의 관문이 CT 안 한 곳**(옛 주소도 이 함수를 부르므로 같이 닫힌다 · Codex 설계 1R #2).
  2. `buildCompanyDocuments` + `extraDocs` → 문서 0 = 400(옛 문장).
  3. `alreadyPaid` 가 아니면 `checkCredit(ai-operator-explain)`.
  4. `callAIWithCitations`(같은 시스템 글 · 모델 · 1500) → `recordAiCall`.
  5. `alreadyPaid` 가 아니면 `settleCreditAfterSuccess(idempotencyKey)`.
  6. `{ text, citations, document_titles }`.
  - 옛 라우트 = `idempotencyKey = ai-explain:<무작위>` · `alreadyPaid = false`(차감 차례 · 응답 꼴 · 상태 코드 · 문장 그대로 · 바뀌는 것은 1번 관문뿐).
- `paidOnce(companyId, key, work)`(`services/ai-line.ts` 에서 내보냄 · 그 파일의 `withKeyLock` · `paidAmountOf` · `recallPaid` · `rememberPaid` 를 묶은 한 함수 · AI 한줄로 문안이 쓰는 것과 같은 조각):
  - 같은 키의 요청을 한 줄로 세운다 → 원장에 그 키가 있으면 `alreadyPaid` · 기억한 결과가 있으면 그대로 돌려준다 → 없으면 `work(alreadyPaid)` → 결과를 기억한다.
- `askAnswerKey(companyId, attemptToken, question)` = `ask-ans:<회사>:<시도 표>:<질문 지문 16자>`(`aiLineInputFp` · 150자 안). **질문이 키에 묶인다** = 같은 시도 표로 질문을 바꾸면 새 키(새로 걷는다 · Codex 설계 1R #1).
- `buildAskTables(companyId, user)` → `AskTable[]`(`{ key, title, columns, rows, groupKeys? }` · 값은 전부 그려질 글자):
  - `groups` 「고객 묶음」 = `countAskCells` → 묶음 일곱 줄(이름 · 받을 수 있는 분 · 1인 평균 구매액) · `groupKeys` = 줄마다 묶음 키 · 받을 수 있는 분이 0인 줄은 뺀다.
  - `channels` 「최근 30일 채널별 발송」 = `channelStats30d`(채널 · 발송 · 성공률).
  - `products` 「최근 30일 많이 본 상품」 = `productInsightOpenFor(user)` 일 때 `listProductSignals(companyId, 8)`(이름 · 조회 · 장바구니 · 구매).
  - `funnel` 「최근 30일 자사몰 흐름」 = `buildCdpFunnel(companyId, 30, { netPurchase: true })` 의 방문이 0보다 클 때(방문 · 장바구니 · 결제 시작 · 구매). **구매 단계 = 매출 반영된 결제 주문만**(`netPurchaseSql` · 상품 표 · 유입 경로와 같은 구매 정의 · Codex 설계 1R #5). `buildCdpFunnel` 은 셋째 인자가 없으면 지금 그대로(있는 소비처 무변경 · 옛 값이 취소 · 미결제 주문을 세는 것은 §8-6 범위 밖 기록).
  - 표 하나가 실패하면 그 표만 뺀다(답을 막지 않는다 · 경고 로그).
- `askTablesAsDocs(tables)` = 표마다 문서 하나(제목 = 표 제목 · 본문 = 머리줄 + 줄).
- `answerAsk({ companyId, user, question, attemptToken })` = 회사 전체 값 판정(원장 · 기억을 읽기 전에 403) → `paidOnce(companyId, askAnswerKey(…), (alreadyPaid) => buildAskTables → runCompanyExplain({ extraDocs: askTablesAsDocs(tables), idempotencyKey: 그 키, alreadyPaid }) → { text, citations, documentTitles, tables })`.
  - 같은 시도 표 + 같은 질문으로 다시 오면: 기억이 있으면 AI 를 부르지 않고 낸 답 그대로 · 기억이 사라졌으면(재시작) 잔액 확인 없이 다시 쓰고 걷지 않는다(차감 뒤 응답만 잃은 고객이 잔액 0 이어도 답을 받는다).

**2-B-3 주소** `POST /api/ai-line/ask/answer`(`routes/ai-line.ts` · 라우터 관문 = AI 존 요금제)
- 입력 = `question`(다듬은 뒤 5 ~ 500자) · `attemptToken`(`isValidAttemptToken` = 문안 주소와 같은 판정).
- 회사 전체 값 판정 실패 = 403 `{ code: 'ASK_ANSWER_SCOPED', error: '담당 고객이 나뉜 계정에서는 회사 전체 숫자로 답하지 않아요.' }`(CT 가 던진다 · 두 주소 같은 문장).
- 402 = 크레딧 부족(옛 문장) · 400 = 근거 문서 없음(옛 문장) · 그 밖 = 공용 오류 꼴.

### 2-C 묶음별 평균 구매액 (`utils/ask-segments.ts` `countAskCells`)
- 같은 한 문장의 안쪽 줄에 `CASE WHEN <수신 가능> AND c.total_purchase_amount > 0 THEN c.total_purchase_amount END AS spend` · 바깥에 `COALESCE(SUM(x.spend), 0)::float8 AS spend_sum, COUNT(x.spend)::int AS spend_n`.
- 응답 `cells[]` · `nobuy` 에 `spendSum · spendN`(칸 단위 · 화면이 묶음으로 합친다).
- 평균 = 묶음의 `Σ spendSum / Σ spendN` · `Σ spendN < 5` = 없음(`ASK_SPEND_MIN_N = 5`). 고객 행 기준 평균이다(번호 중복 접기와 무관 · 화면 글 「1인 평균 구매」).
- 칸 확인 = 시험 DB `t_tpl_closed` information_schema: `customers.total_purchase_amount numeric`(1121 조회 출력 · §9).

### 2-D 같이 산 상품 (`utils/product-pairs.ts` 새 · 조각은 `product-signal.ts` · `product-reco.ts` · `journey-product.ts` · `two-door-purchase.ts` 의 것을 쓴다)
- 창 = `PAIR_WINDOW_DAYS = PRODUCT_SIGNAL_KEEP_DAYS`(60일 = 상품 이름을 풀 수 있는 보관 기간) · 상위 상품 = `PAIR_TOP = 10` · 상품마다 `PAIR_PER_TOP = 3` · 최소 겹침 = `PAIR_MIN_BOTH = 3`.
- **상품 식별 = 키 하나가 상품 하나**(Codex 설계 1R #3 · 2R #1 · 3R · 4R = 같은 뿌리 → 이름을 정하는 표를 한 곳에 둔다):
  - 상품 = 정리된 이름(`norm`) 하나. 구매 줄은 언제나 (문 · 키)를 든다(키 = 상품 번호 · 코드 · 없으면 이름 = `mallItemKeySql` · `ledgerProductKeySql` · 키가 없는 줄 = 이름도 없는 줄 = 어느 상품인지 모르는 줄 → 뺀다).
  - **`keymap`(문 · 키 → 이름 하나)** = ① 상품 신호 표에서 그 키의 보관 기간 안 가장 최근 이름(`product-reco.ts` 의 `namedProductsSql` 을 내보내 같이 쓴다) ② **신호 표에서 쓸 수 있는 이름(정리해도 비지 않는 이름)을 얻지 못한 키**(신호 표에 아직 없는 오늘 구매 · 신호 표에 키만 있고 이름이 전부 빈 키)는 창 안 그 키의 구매 줄 가운데 **이름이 비지 않은 가장 최근 줄**에 적힌 이름 ③ 둘 다 없으면 그 키는 이름 없는 상품(세는 쪽에서 뺀다). **같은 키의 줄은 전부 같은 상품이다**(줄마다 적힌 이름이 달라도 · 4R 반례 = 신호 표에 없는 k1 을 B 로 사고 C 로 다시 산 고객 → k1 의 줄은 전부 C).
  - **세는 쪽**(`one` = 사람 · 상품 · 같이 산 쌍과 산 사람 수의 근거): 구매 줄의 상품 = `keymap` 의 이름 하나. 줄 자신의 이름으로 상품을 정하지 않는다.
  - **빼는 쪽**(「B 를 산 적이 있다」 = 사고 안 산 명단에서 빼는 근거): 추천 상품의 인정 규칙 그대로 = 줄에 적힌 구매 당시 이름이 B 이거나 · 줄의 (문 · 키)가 `keymap` 에서 B(`RECO_PICK_SQL` 의 `hit` 두 갈래 · OR) · **기간 제한 없음**(추천 상품의 `buys` 와 같다 = 60일보다 전에 산 사람도 뺀다). 넓게 인정한다 = 산 사람에게 다시 권하지 않는 쪽. 세는 쪽과 같은 `keymap` 을 쓴다.
- 구매 줄 `pairLinesSql()`(창 안 · 미래 시각 제외):
  - 자사몰 = `cdp_events` 중 `netPurchaseSql`(매출 반영된 결제 주문 · 취소 · 환불 제외) · `customer_id IS NOT NULL` · 상품 줄 = `mallItemsSql` · 키 = `mallItemKeySql` · 이름 = `productName`(RECO_PICK_SQL 의 `buys` 와 같은 조각).
  - 매장 원장 = `LEDGER_PURCHASES_SQL`(환불 행 · 미래 행 제외) · 키 = `ledgerProductKeySql` · 이름 = `product_name`.
- **사람 = 번호**(Codex 설계 1R #4): 구매 줄을 고객 표에 붙여 `person = COALESCE(NULLIF(TRIM(c.phone), ''), c.id::text)` 로 먼저 합친다(`one` = 사람 · 상품 distinct · 세는 쪽). 같은 번호의 고객 행이 여럿이면 그 사람의 구매는 합집합이다(빼는 쪽도 그 번호의 고객 행 전부의 구매를 본다).
- `PAIRS_SQL($1 회사 · $2 창)` = `one` → `top`(상품을 산 사람 수 위 10 · 같은 수면 이름순) → `pair`(top 의 a 와 다른 b 를 같은 사람이 산 수) → a 마다 겹침 위 3 · 겹침 3명 이상. 줄 = `a · aBuyers · b · both`(a · b = 보이는 이름 = 그 정리된 이름으로 풀리는 가장 최근 이름 · 신호 표에 아직 없는 오늘 구매는 줄에 적힌 이름).
- `boughtNotBoughtSql(sendable)`($1 회사 · $2 창 · $3 a 들 · $4 b 들 = 쌍 배열) = 쌍마다 차례가 정해진 한 문장: ① `one` 에서 a 를 산 사람(창 안 · 세는 쪽) → ② 그 사람들의 번호를 가진 고객 행의 id 를 확정(`acust` · 같은 번호의 고객 행 전부) → ③ **전 기간 구매는 그 id 들로만 읽는다**(`cdp_events.customer_id` · `purchases.customer_id` 조건 · 회사 전체를 훑지 않는다) → ④ 빼는 쪽 규칙으로 b 를 산 적이 없는 사람 → ⑤ 그 번호의 수신 가능 고객 행 하나(`DISTINCT ON (쌍 · TRIM(c.phone))` · 대표 = 고객 id 순). `countBoughtNotBought`(쌍마다 수 = 그 줄 수) 와 `listBoughtNotBought`(쌍 하나의 명단)가 이 한 문장을 같이 쓴다(세기 = 명단 수). a · b 입력 = 보이는 이름 → `normName`.
- 읽기는 전부 `boundedRead`(25초 제한 · 넘으면 그 요청만 실패 · 화면은 그 탭을 그리지 않는다). 원장이 수백만 행인 회사 = 창(60일) · 회사 조건으로 먼저 좁히고, 자기 조인은 `top` 10 상품을 산 사람으로만 한다.
- 주소(`routes/product-insight.ts` · 관문 `guarded` 그대로): `GET /pairs` → `{ windowDays, pairs }` · `POST /audience-counts` 입력에 `pairs: [{a, b}]`(최대 30) → 응답 `pairs: number[]`(입력 순서 그대로) · `POST /audience` 에 `kind: 'pair'`(`value` = a · `other` = b).
- 칸 확인 = `purchases.product_name · product_code · customer_id · purchase_date · total_amount`(시험 DB 조회 출력 · §9).

### 2-E 유입 경로 (`utils/inflow-channel.ts` 새)
- 창 = 30일(`INFLOW_WINDOW_DAYS`) · 귀속 = 구매 앞 7일(`INFLOW_LOOKBACK_DAYS`) 안 그 고객의 마지막 방문 시작.
- 방문 시작 = 세션(`session_id` 가 있는 `page_view`)마다 가장 이른 한 줄. 경로 판정(SQL `CASE` 한 곳 `inflowChannelSql(url, referrer)`):
  1. 주소에 `utm_source=값` → 「링크 꼬리표 · 값」(소문자 · 40자까지)
  2. referrer 가 비었음 → 「직접 방문」
  3. referrer 호스트가 주소 호스트와 같음 → 「직접 방문」(사이트 안 이동으로 시작한 세션)
  4. referrer 호스트에 `naver · google · daum · bing · yahoo` → 「검색」
  5. `instagram · facebook · kakao · youtube · tiktok · twitter · x.com · t.co` → 「SNS」
  6. 그 밖 → 「다른 사이트」
- 구매 = `netPurchaseSql` · 창 안(세션 · 고객이 없어도 구매다). **구매 하나는 한 경로에만 센다**: ① 같은 `session_id` 의 방문 시작 ② 없으면 같은 `customer_id` 의 구매 시각 앞 7일 안 가장 늦은 방문 시작(방문 시작은 창 밖 7일까지 거슬러 읽는다 = 창 첫날 구매도 귀속) ③ 없으면 「방문 기록 없음」(웹훅 주문 · 비회원 · SDK 를 안 붙인 몰).
- 줄 = 경로 · 방문(창 안에 시작한 세션 수) · 구매 건수 · 매출(`mallAmountSql`) · 매출 큰 순 · 최대 12줄(넘는 줄은 「그 밖」 한 줄로 합친다). **줄이 서는 조건 = 그 경로의 방문이 있거나 귀속된 구매가 있다**(Codex 설계 2R #2): 창 전날 SNS 로 들어와 창 첫날 산 구매는 「SNS · 방문 0 · 구매 1」 줄이다. 「방문 기록 없음」 = 귀속할 방문 자체가 없는 구매만. **모든 경로의 방문 0 이고 구매 0 일 때만 빈 배열**(Codex 설계 1R #7).
- 꼬리표 값 = 주소에서 꺼낸 글자를 `%` 풀기 없이 소문자 · 영숫자 · `_ . -` 만 남기고 40자로 자른다(고객이 넣은 글자를 그대로 화면에 싣지 않는다 · 빈 값이 되면 2번부터).
- 주소 `GET /api/ai/operator/performance/inflow-channels`(`routes/ai.ts` · 효과 증명 주소와 같은 관문) → `{ success, windowDays, lookbackDays, rows }` · `companyWideViewer` 가 아니면 `rows: []`.
- 칸 확인 = `cdp_events.session_id · properties · customer_id`(시험 DB 조회 출력) · `properties` 의 `url · referrer` = SDK `auto-capture/pageview.ts` 가 싣고 `cdp-events.ts normalizeBrowserEvent` 가 남는 칸으로 저장.
- 알고 두는 한계 = 문자 링크로 들어온 방문은 referrer 가 비어 「직접 방문」으로 읽힌다(링크에 꼬리표를 붙이지 않는다) · 웹훅으로 들어온 주문은 세션이 없어 ② 길(고객 기준)만 탄다.

### 2-G 통신사 띠 (`utils/performance-benchmark.ts`)
- `benchCell` 의 `few_peers` 반환에 `mine` 을 싣는다: `{ available: false, reason: 'few_peers', mine }`. `no_own` 은 그대로.
- 성공률 한 줄(`successBenchLine`)은 지금도 내 값이 숫자 카드에 있으므로 무변경.

## §3 화면

- **A 대시보드**: `Dashboard.tsx` 카드 목록에 `{ key: 'ask', label: '한 줄로 묻기', desc: '고객 골라 보내기', tone: 'sky' }` · 순서 = AI 한줄로 · 한 줄로 묻기 · AI 오퍼레이터 · 고객 DB 업로드. 폭 320 ~ 1920 에서 넘침 0.
- **B 답 화면**(`AiAskPage.tsx` · `utils/ai-ask.ts`):
  - 처음 화면: 한 줄을 읽은 결과가 `ask` 면 입력 아래 확인 줄 「질문으로 읽었어요. 우리 회사 숫자를 근거로 답해 드릴까요?」 + 단추 둘 = 「답 받기 5크레딧」(값 = 화면 크레딧 표 `creditCost('ai-operator-explain')`) · 「보낼 고객 고르기」. `send` 면 지금 그대로 1단계.
  - 입력 아래 상시 단추 「질문으로 물어보기 5크레딧」(옛 「다른 걸 물어보시려면 AI 한줄로」 자리 · 한 줄이 5자 이상일 때 눌림) = 읽기 결과와 상관없이 그 줄로 답을 받는다.
  - 답 화면(마법사 틀 안 · 단계 띠 대신 「질문과 답」 머리): 질문 한 줄 · 답 글 · 근거 문서 이름 줄 · 표 카드(제목 + 표 · 좁은 화면 = 가로 넘침 없이 줄바꿈) · 고객 묶음 표는 줄마다 「이 묶음에게 보내기」 · 아래 줄 = 「다른 질문하기」 · 「보낼 고객 고르기」.
  - 쓰는 중 = 화면을 덮는 진행 표시(「답을 쓰는 중이에요」) · 요청 하나 = 시도 표 하나(실패하면 같은 표로 다시 · 성공하면 비움 · 진행 중 다시 누름 무시).
  - 읽기와 답 요청의 겹침(Codex 설계 2R · 구현 1R · 2R): 한 줄을 읽는 중에는 상시 단추 · 시작 줄 · Enter 가 전부 잠긴다(지금 `reading` 잠금 그대로) · 글을 고치거나 답 요청 · 다른 시작이 떠나면 흐름 번호를 올려, 그 앞에 떠난 **읽기 응답(무과금)**은 화면 상태를 바꾸지 못한다. **답 응답(과금)은 버리지 않는다** — 답을 쓰는 동안 입력 칸 · 뒤로 단추 · 시작 줄 · 확인 줄 단추 · 아래 단추를 전부 잠그고, 받은 답은 언제나 보여 준다.
  - 실패 문장 = 서버 문장 그대로(402 · 400 · 403) · 403 `ASK_ANSWER_SCOPED` 는 「보낼 고객 고르기」 단추를 함께.
- **C 평균 구매액**: 1단계 묶음 줄 설명 아래 「1인 평균 구매 12만 3천 원」 꼴(`askSpendText` 순수 · 만 원 미만 = 천 원 단위 · 없으면 줄 없음).
- **D 같이 산 상품**(`ProductSignalSection`): 탭 셋째 「같이 산 상품」 · 줄 = 「A 를 산 분이 같이 산 상품 · B · 겹친 고객 n명」 + 「A 사고 B 안 산 m명에게 보내기」(0명 = 잠김) → `stashAudience({ kind: 'pair', value: a, other: b })` → 직접발송 창(있는 길). 줄이 없으면 빈 상태 한 줄.
- **E 유입 경로**(`components/performance/InflowChannelCard.tsx` 새): 표 = 경로 · 방문 · 구매 · 매출 · 발치 「구매 앞 7일 안 마지막 방문 기준 · 최근 30일」. 줄 0(방문도 구매도 없음) = 아무것도 그리지 않는다 · 서버가 준 줄을 그대로 그린다(방문 0 인 경로 줄 · 「방문 기록 없음」 줄 포함).
- **F 성과 첫 줄**: `<EffectProofCard>` 를 숫자 카드 줄 바로 아래로(통신사 띠 위).
- **G 통신사 띠**: `spamBenchCells` = 평균 있으면 「3.2% · 업종 평균 4.1%」 · 없으면 「3.2%」(색 없음). 발치 = 평균이 하나라도 있으면 지금 문장 · 하나도 없으면 「우리 스팸 검사로 직접 잰 값 · 낮을수록 좋아요」. 띠를 그리는 조건 = 칸이 1개 이상.

모델명 0 · native dialog 0 · 고객 글에 검사 방식 낱말 0(R11) · 채널 표기 = SMS · LMS · MMS(R1).

## §4 영향표 (고치는 것을 읽는 소비처 전수 · 구현 때 grep 출력으로 §9 에 붙인다)

| 고치는 것 | 소비처 | 영향 |
|---|---|---|
| `openAiLine` 인자 | `Dashboard.tsx` 두 곳(카드 · 오늘의 추천 `onStartLine`) | 기본값 = 옛 동작 |
| `/operator/explain` 몸통 → CT | `/ai-explain` 화면 한 곳(메뉴 없음) | 응답 · 차감 그대로 · 분류코드로 나뉜 담당자만 403 |
| `buildCdpFunnel` 셋째 인자 | 그 함수의 소비처 전부 | 인자 없음 = 옛 값 그대로 |
| `services/ai-line.ts` 재생 조각을 `paidOnce` 로 묶어 내보냄 | `runLineCompose` | 그 함수는 안 고친다(조각을 그대로 쓴다) |
| `product-reco.ts` `namedProductsSql` 내보냄 | 그 파일 안 세 문장 | 무변경 |
| `countAskCells` 반환 칸 추가 | `routes/ai-line.ts` `/ask/segments` · `ask-answer.ts` | 칸 추가만(있는 칸 무변경) |
| `readAskLine` 반환 칸 추가 | `/ask/read` 한 곳 → `AiAskPage` | `send` = 옛 흐름 |
| `benchCell` few_peers 에 `mine` | `readBenchmark` → `PerformancePage`(`successBenchLine` · `spamBenchCells`) | 성공률 줄 무변경 · 띠만 바뀜 |
| `productInsightOpenFor` 가 `companyWideViewer` 조각을 씀 | 그 함수의 소비처 전부 | 판정 같음(조각 옮김) |
| `buildPerformanceSnapshot` 채널 조회 → `channelStats30d` | 그 함수 · `ask-answer.ts` | 결과 같음(조회 옮김) |
| `/audience-counts` · `/audience` 입력 갈래 추가 | `utils/product-insight.ts` · `Dashboard.loadPendingAudience` | 옛 kind 무변경 |
| `PendingAudience` 에 `pair` | `stashAudience` · `takeAudience` · `audienceLoadedText` · `fetchAudience` | 옛 kind 무변경 |

## §5 시험

- 계약(`c152-snap-gap-1121.test.ts` · C151 K8 은 그 파일에):
  - K9 `runCompanyExplain` = 옛 라우트가 그 함수를 부르고 라우트 안에 AI 호출 · 차감이 남지 않는다 · 회사 전체 값 판정이 CT 안 첫 줄 · 새 주소의 관문 · 입력 한도 · 403 문장 · 답 키에 질문 지문이 묶인다.
  - K10 `readAskLine` intent 표(질문 12 · 보내기 12 · 섞인 줄 = send) · 화면: `send` 로 읽히는 두 줄(「문자 발송 성공률이 왜 낮아?」 · 「쿠폰 얼마 줄까?」)도 상시 단추가 읽기 결과를 보지 않고 답 길을 부른다.
  - K11 같이 산 상품 주소 셋이 `guarded` 안 · audience kind 갈래.
  - K12 유입 경로 주소 관문 · `inflowChannelSql` 의 판정 차례.
  - K13 화면: 답 받기 단추의 크레딧 값이 화면 크레딧 표 값 · 시도 표 재사용 · 답 요청이 흐름 번호를 올리고 읽기 응답이 그 번호를 본다 · 입력 칸이 흐름 번호를 올린다 · 답 요청의 성공 · 실패 갈래에는 번호 대조가 없고 답을 쓰는 동안 흐름을 바꾸는 자리가 전부 잠긴다 · `spamBenchCells` 세 갈래 · `askSpendText` · 성과 화면에서 효과 증명 카드가 통신사 띠보다 앞.
- 실 PG(`c152-snap-gap-1121.pg.test.ts`):
  - 평균 구매액 = 수신 가능 · 0원 제외 · 담당자 범위 · 5명 미만 없음(화면 함수는 계약에서).
  - 같이 산 상품의 빼는 쪽 = 추천 상품과 같은 읽기: **옛 이름 B 로 산 키 k1 의 지금 이름이 C · 다른 키의 이름이 B 인 고객은 「A 사고 B 안 산」 명단에 없다**(2R 반례) · **B 를 61일 전에 산 고객도 명단에 없다**(전 기간) · 같은 고객 · 같은 후보로 `pickRecoIndex` 가 「산 것」으로 건너뛰는 상품은 쌍 판정에서도 「산 것」(두 경로 대조).
  - 세는 쪽 = **세 고객이 옛 이름 B 로 k1 하나만 샀고 k1 의 지금 이름이 C · k2 의 이름이 B 일 때 쌍 목록에 B 와 C 의 쌍이 없다**(3R 반례 · 가짜 쌍 0) · 그 세 고객은 C 를 산 사람 수에 든다.
  - 신호 표에 아직 없는 키 = **세 고객이 k9 를 이름 D 로 사고 같은 날 이름 E 로 다시 샀고 넷째 고객은 E 로만 샀을 때: k9 의 줄은 전부 E 한 상품 · D 와 E 의 쌍 없음 · 넷째 고객이 「E 를 안 산」 명단에 들지 않는다**(4R 반례) · **신호 표에 k8 이 이름 없이(키만) 있고 창 안 구매 줄이 k8 을 이름 F 로 적었으면 그 구매는 F 를 산 것으로 센다**(5R 반례).
  - 같이 산 상품 = 두 문(자사몰 상품 줄 · 매장 원장)을 합침 · 취소 주문 · 환불 행 제외 · 겹침 3명 미만 제외 · **이름 없는 결제 줄 · 옛 이름으로 산 줄도 같은 키면 「산 것」**(그 고객은 사고 안 산 명단에서 빠진다) · **같은 번호의 고객 행 둘이 A 와 B 를 나눠 샀으면 그 번호는 명단에 없다** · 수신거부 · 미동의 제외 · 세기 = 명단 수.
  - 유입 경로 = 여섯 갈래 판정 · 같은 세션 귀속 · 고객 기준 7일 귀속 · 8일 전 방문은 「방문 기록 없음」 · 취소 주문 제외 · 방문 0 + 세션 없는 주문 = 「방문 기록 없음」 한 줄(매출 보임) · 창 전날 SNS 방문 + 창 첫날 구매 = 「SNS · 방문 0 · 구매 1」 줄 · 구매 건수 합 = 창 안 매출 반영 주문 수(두 경로에 세지 않는다) · 꼬리표 값 정리.
  - `answerAsk` = AI 호출을 가짜로 바꾼 채: 같은 시도 표 + 같은 질문 두 번 = 원장 한 줄 · AI 한 번 · 같은 답 / 기억을 지운 뒤(재시작 흉내) 잔액 0 으로 다시 = 답이 오고 원장 그대로 / 같은 시도 표 + 다른 질문 = 원장 두 줄 / 분류코드로 나뉜 담당자 = 403 · 원장 0 · AI 0 · **회사 관리자 · 분류가 없는 회사의 담당자 = 통과**(옛 주소가 닫히지 않는다). 답의 퍼널 구매 = 취소 주문을 세지 않는다.
  - 사고 안 산 명단의 번호 규칙 = 번호가 빈 고객은 명단에 없다 · 같은 번호의 한 행이 수신거부면 `sendableCustomerSql` 이 내는 값 그대로(그 CT 의 기존 시험이 고정한 판정을 다시 정의하지 않는다 · 수신 가능한 행이 하나도 없으면 명단에 없다).
  - `channelStats30d` = 옮기기 전 `buildPerformanceSnapshot().byChannel` 과 같은 값.
- 변이 = 수신 가능 조건 뺌 · 겹침 하한 뺌 · 귀속 7일 → 무제한 · intent 보내기 낱말 뺌 · 시도 표 키를 무작위로 → 전부 빨간불.
- 전체 = backend · frontend tsc 0 · 단위 전체 · 실 PG 전체.

## §6 직원 지시문 (동작 · 볼 결과만)

1. 요금제를 쓰는 시험 계정으로 로그인합니다. 대시보드 맨 위 카드가 네 개이고 둘째가 「한 줄로 묻기」인지 봅니다. 누르면 한 줄로 묻기 화면이 열립니다.
2. 요금제를 쓰지 않는 시험 계정으로 로그인합니다. 대시보드 맨 위 카드가 네 개인지 보고 「한 줄로 묻기」를 누릅니다. 「한 줄로 묻기」 안내 창이 뜹니다.
3. 요금제 계정의 한 줄로 묻기에서 「요즘 어떤 고객이 제일 많아?」를 적고 Enter 를 누릅니다. 「질문으로 읽었어요」 줄과 단추 둘이 보입니다.
4. 「답 받기」를 누릅니다. 답 글과 「고객 묶음」 표가 보이고 크레딧이 단추에 적힌 만큼 줄어듭니다.
5. 표의 한 줄에서 「이 묶음에게 보내기」를 누릅니다. 그 묶음이 골라진 1단계가 열립니다.
6. 1단계 묶음 줄에 「1인 평균 구매 ○원」이 보이는 묶음이 있는지 봅니다(구매 금액이 있는 회사).
7. 성과리포트를 엽니다. 숫자 카드 바로 아래가 「효과 증명」 카드인지 봅니다(대조군을 켠 회사).
8. 성과리포트의 「상품」 구역에 「같이 산 상품」 탭이 있고(상품 반응이 열린 회사) 줄 끝 단추를 누르면 직접발송 창에 받는 사람이 채워집니다. 발송은 하지 않습니다.
9. 성과리포트에 「유입 경로」 카드가 보이는지 봅니다(자사몰 방문이나 주문 기록이 있는 회사 · 둘 다 없으면 카드가 없습니다).

## §7 배포

- DDL 0 · ENV 0 · 백엔드 + 프론트 build:safe · 적재 0건 한 줄 → 재시작.
- 확인(서버 셸 한 줄 · 원문 = 배포 원장 C152-H1) = `ask/answer`(ai-line.js) · `inflow-channels`(ai.js) · `/pairs`(product-insight.js) · `ask-answer.js`(dist/services) · `AiAskPage` 청크 = 다섯 다 1 이상.

## §8 범위 밖 · 막힌 것

1. **칸별 ROAS** = 만들지 않는다. 일반 발송(직접발송 · AI 한줄로)의 받은 사람별 기록이 PG 에 없다. 근거 = ① 시험 DB(운영 덤프 + 닫힌 DDL) 카탈로그에서 `campaign_id` 와 번호 · 고객 칸을 함께 가진 표 = `agency_send_requests`(담당자 번호) · `dm_event_responses` · `dm_recipient_tokens` · `dm_winners`(모바일 DM) · `flyer_coupons` · `journey_anchor_dispatch`(여정) · `message_short_urls`(추적 링크가 든 문자만) · `short_urls`(1121 조회 출력 · §9) ② 뒤에 생긴 `ad_send_marks` 의 받는 쪽 표식(`campaign_treated`)은 발송별 대조군을 뽑은 발송에만 쓰인다(`utils/ad-send-gate.ts` 345 ~ 373: `policy.ready && input.holdoutKey` 이고 대조군 비율이 0보다 클 때만 `treated` 에 담는다 · `reserved` 는 우선순위를 켠 회사만). 그래서 「이 칸 고객에게 보낸 문자」를 전 회사에 대해 셀 길이 없다. 대신 §2-C 평균 구매액.
2. **통신사별 발송 성공률** = V3 설계서 §4-3 · §13 「재고 나서 만든다」 그대로. 선행 = 원장 C133-M1 ①(실패 행의 통신사 칸이 채워지는 비율 · Harold 서버 실측). 값이 「남는다」면 그 설계(`carrier-rollup-worker` · C133-DDL-5)대로 만든다.
3. **켜기** = 원장 C133-ENV-2 → P2 · M2 → 수신 배선 · Harold 결정 둘 → ENV-3 → P3(전부 Harold 실행 · 「배포 시작하자」 때 하나씩).
4. 유입 경로의 문자 링크 식별(링크 꼬리표 붙이기) · 답 화면의 그래프 꼴(지금은 표) · 답 화면 대화 이어 가기(한 번 묻고 한 번 답) = 다음 과제 후보.
5. 영상 · 제안서 무게 옮기기 · 가운데 상품 구성 = 개발 아님.
6. `buildCdpFunnel` 의 옛 구매 단계(취소 · 미결제 주문 포함)를 쓰는 기존 화면(자사몰 진단 · 성과 퍼널) = 이 설계는 답의 표만 매출 반영 주문으로 맞춘다 · 기존 화면 값 바꾸기는 따로(추가 과제 기록).
7. 상품 구역의 「보고 안 산 고객」 명단(`viewedNotBoughtSql`)이 고객 행 단위로 판정한 뒤 번호를 접는 것(Codex 설계 1R 이 짚은 같은 부류) = 기존 길 · 추가 과제 기록.

## §9 구현 기록 (1121 ~ 1122)

| 설계 | 구현 | 파일 |
|---|---|---|
| A 대시보드 카드 | 카드 목록 한 줄 · `openAiLine(path, featureId)`(기본값 = 옛 값) · 4열은 1280px 부터(640 ~ 1279 에서 4열이면 이름이 잘렸다 = 폭 훑기 실측) · 설명은 두 줄까지 | `Dashboard.tsx` · `DashboardActionRow.tsx` · `plan-feature-intros.ts`(`ask-entry` · 크레딧 줄 둘) · `feature-catalog.ts` |
| B 질문에 답하기 | `runCompanyExplain` · `answerAsk` · `buildAskTables` · `askAnswerKey` · `paidOnce`(재생 조각 묶음) · `POST /ask/answer` · 옛 주소는 몸통을 부른다 · 화면 = 확인 줄 · 상시 단추 · 답 화면(좁은 화면의 고객 묶음 = 줄마다 카드) | `services/ask-answer.ts`(새) · `services/ai-line.ts` · `routes/ai.ts` · `routes/ai-line.ts` · `ask-segments.ts`(`askIntentOf`) · `AiAskPage.tsx` · `utils/ai-ask.ts` · `utils/ai-line.ts` · `constants/credit.ts`(`ai-operator-explain` 을 화면 단가 목록에) |
| C 평균 구매액 | `countAskCells` 한 문장에 `spend_sum · spend_n` · `askSpendAvg` · 화면 `askGroupSpend` · `askSpendText` | `ask-segments.ts` · `utils/ai-ask.ts` · `AiAskPage.tsx` |
| D 같이 산 상품 | `PAIR_HEAD_SQL`(named · wlines · kfill · keymap · one) · `PAIRS_SQL` · `boughtNotBoughtSql`(abuy → acust → ever → bbuy) · 주소 셋 · 넘기기 kind `pair` · 탭 | `product-pairs.ts`(새) · `product-reco.ts`(`namedProductsSql` 내보냄) · `routes/product-insight.ts` · `utils/product-insight.ts` · `ProductSignalSection.tsx` · `Dashboard.tsx` |
| E 유입 경로 | `inflowChannelSql` · `INFLOW_SQL` · `capInflowRows` · 주소 · 카드 | `inflow-channel.ts`(새) · `routes/ai.ts` · `InflowChannelCard.tsx`(새) · `PerformancePage.tsx` |
| F 성과 첫 줄 | `<EffectProofCard>` 를 숫자 카드 줄 바로 아래로 | `PerformancePage.tsx` |
| G 통신사 띠 | `benchCell` few_peers 에 `mine` · `spamBenchCells` 세 갈래 · `spamBenchFootnote` | `performance-benchmark.ts` · `utils/benchmark.ts` · `PerformancePage.tsx` |
| 공용 | `companyWideViewer`(`productInsightOpenFor` 가 이 조각을 쓴다) · `buildCdpFunnel` 셋째 인자 · `channelStats30d`(스냅숏의 채널 조회를 옮김) · 근거 문서 제목 「최근 30일 발송 이력」(옛 「캠페인 history」) | `product-signal.ts` · `cdp-diagnostics.ts` · `next-action-advisor.ts` · `citations.ts` |

- 설계와 달라진 것 = ① 옛 수치 질문 주소의 4xx 응답 본문에 `code` 칸이 더해진다(`EXPLAIN_NO_DATA` · `ASK_ANSWER_SCOPED` = 공용 오류 꼴 · 상태 코드 · 문장은 그대로) ② 대시보드 4열 기준 = 640px 이 아니라 1280px(폭 훑기에서 이름 잘림) ③ 답 화면의 고객 묶음 표 = 640px 아래에서 줄마다 카드(폭 375 에서 숫자가 중간에 잘려 접혔다).
- 칸 확인(시험 DB `t_tpl_closed` information_schema · 1121 조회 출력) = `customers.total_purchase_amount numeric` · `customers.purchase_count integer` · `customers.recent_purchase_date date` · `purchases.(company_id · customer_id · product_code · product_name · purchase_date timestamp · total_amount numeric)` · `cdp_events.(session_id varchar · customer_id uuid · properties jsonb · occurred_at timestamptz · event_name)`. 뒤 DDL 표 = `t_tpl_after`: `product_signal_daily(company_id, door, product_key, day, product_name, views, carts, orders, updated_at)` · `ad_send_marks(id, company_id, batch_id, campaign_id, branch, kind, phone, send_day, created_at)`.
- §8-1 카탈로그 조회(같은 시험 DB) = `campaign_id` 와 번호 · 고객 칸을 함께 가진 표: `agency_send_requests(manager_phone, manager_phones, phone_column)` · `dm_event_responses(customer_id)` · `dm_recipient_tokens(customer_id)` · `dm_winners(customer_id, winner_phone)` · `flyer_coupons(customer_phone)` · `journey_anchor_dispatch(customer_id)` · `message_short_urls(customer_id)` · `short_urls(phone)`.
- 영향표 실측(grep) = `openAiLine(` 호출 = `Dashboard.tsx` 둘(카드 · 오늘의 추천 `onStartLine` · 인자 없음 = 기본값) + 새 카드 하나 · `buildCdpFunnel(` 소비처 = `routes/cdp.ts` 한 곳(인자 둘 = 옛 값) + 답 표 · `benchCell(` 소비처 = `readBenchmark` 한 곳 · `byChannelResult` 잔존 0 · `callAIWithCitations` 를 부르는 곳 = `services/ask-answer.ts` 한 곳.
- 시험 = 계약 `c152-snap-gap-1121.test.ts` 20건(K9 ~ K13) + `c151-ask-entry-1121.test.ts` K8 3건 · 실 PG `c152-snap-gap-1121.pg.test.ts` 17건(설계 Codex 반례 다섯 · 유입 경로 여섯 갈래 · 답 한 번만 걷기 · 회사 전체 값 판정) · 옛 계약 시험 갱신 일곱(옮긴 자리 · 새 주소 · 새 AI 호출 자리 등재 = `root-ledger` R13 면제 키 · `two-door-purchase-contract` R54 ② 허용 목록 · `c133-deploy-a` 주소 목록 · 단추 숨김 수 · `dashboard-four-cards-1019` · `tier3-a` · `tier3-d` · `c133-benchmark.pg` 기대값).
- 화면 확인(미리보기 · 가짜 응답) = 대시보드 카드 4칸 폭 320 ~ 1920(이름 · 설명 잘림 0) · 한 줄로 묻기 확인 줄 · 답 쓰는 중 덮개 · 답 화면 폭 375 · 1280(넘침 0) · 1단계 평균 구매액 줄 · 같이 산 상품 탭 · 유입 경로 카드 폭 320 ~ 1280(구역 넘침 0) · 읽기 응답을 1.8초 늦춘 채 글을 고친 겹침(옛 응답 뒤 확인 줄 없음 · 답 받기가 보낸 질문 = 고친 글). 실제 계정 화면 = 배포 뒤 §6.
- Codex = 설계 6R approve(1R 7 · 2R 2 · 3R 1 · 4R 1 · 5R 1 · 3R 부터 전부 같이 산 상품의 상품 식별 = 같은 뿌리 → 이름을 정하는 표 한 곳으로 구조를 바꿈) · 구현 3R approve(1R 1 = 읽는 중 글을 고치면 옛 글의 읽기 응답이 확인 줄을 되살림 → 입력 칸이 흐름 번호를 올림 · 2R 1 = 그 수정의 부작용: 답을 쓰는 중 글을 고치면 낸 답이 버려짐 → 규칙을 둘로 나눔(읽기 응답 = 흐름 번호로 버림 · 답 응답 = 버리지 않음 + 답을 쓰는 동안 입력 칸 · 뒤로 · 시작 줄 · 단추 잠금) · 3R approve).
- 변이 아홉(수신 가능 조건 뺌 · 겹침 하한 뺌 · 귀속 7일 → 무제한 · 보내기 낱말 판정 뺌 · 답 키 무작위 · 세는 쪽이 줄 자신의 이름 · 빼는 쪽을 창 안으로 · 회사 전체 값 판정 뺌 · 구매액에 수신 불가 고객) = 전부 빨간불(파일 사본으로 바꾸고 원본 복구 확인).
- 마지막 전체 검증(1122 · Codex approve 뒤) = backend · frontend tsc 0 · 실 PG 전체 105파일 962건 통과(스탬프 기록) · 단위 전체 837파일 13,719건 통과 · harness-check 통과.
