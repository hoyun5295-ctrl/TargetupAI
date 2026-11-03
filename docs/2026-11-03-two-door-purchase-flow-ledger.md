# C99 두 문 회사 구매 · 가입 근거 흐름 표 · 결함 장부 (2026-11-03)

> 절차 = `status/DEFECT-PLAYBOOK.md` 1단계(흐름 표) · 2단계(결함 장부). **Harold 「이번 범위 흐름이 빠짐없다」 확인 전에는 설계 · 처방 · 코드 0.**
> 범위(Harold 1103): 「둘 다 쓰긴 쓸거야 체크해봐야해」 · 「두문을 다 사용하는 회사 지금 없어 그래서 걱정인거고 이제 생길테니까」 · 「추천대로 정함」(⑨-1 ~ ⑨-3 · `docs/2026-11-02-journey-automarketing-core-fix-design.md` §11) · 「99는 따로 처방」 · 「C99 설계 시작」.
> 두 문 회사 = 자사몰 주문(`cdp_events` purchase)과 매장 · ERP 싱크 구매(`purchases` 원장)가 함께 들어오는 회사. 지금 0곳(Harold 1103) · 납품 고객사가 첫 회사.
> 0단계 판 대조: 서버 `deployed_head` = `3af58654`(원장 1103 · C98 배포) = 이 표를 뽑은 저장소 HEAD. 아래 파일:행 = 그 판.

## §0 칸을 뽑은 방법(손 목록 금지)

뽑기 = 백엔드 · 프론트 `src` 전체(테스트 · 주석 줄 제외) 정규식 일곱 개. 배정 = 칸마다 흐름 단계 하나(배정 못 한 칸이 있으면 실패하는 스크립트 · 결과 258/258).

| 패턴 | 뜻 | 정규식 | 칸 수 |
|---|---|---|---|
| P1 | 매장 원장 쓰기 | `INSERT\s+INTO\s+purchases\b` | 1 |
| P2 | 매장 원장 읽기 | `(FROM\|JOIN)\s+purchases\b` | 36 |
| P3 | 몰 구매 사건 읽기 | `netPurchaseSql\(\|cdpEventNameMatchSql\(\|event_name\s*=\s*'purchase'\|event_name\s+IN\s*\(\s*'purchase'` | 49 |
| P4 | 문 판정 | `isMallPurchaseDoorActive\|currentPurchaseDoor\(\|resolvePurchaseLedgerGate\|getPurchaseDoorStatus\|isMallPurchaseDoorForJourneyStats\|usesPurchaseLedger\(\|hasWebhookRevenueHistory` | 28 |
| P5 | 고객 구매 요약 칸 쓰기 | `\b(purchase_count\|total_purchase_amount\|recent_purchase_date\|recent_purchase_amount\|recent_purchase_store\|avg_order_value)\s*=\s*(?!=)` | 13 |
| P6 | 가입 근거 | `hasJoinedAtEvidence\|signupDateColumn\|NO_JOINED_AT_REASON\|resolveNewCustomerJudgement\|getCompanyIdentityCapability\|stampFirstSeenJoinedAt\|joinedAtUpsertSql\|newSignupSql\(\|journeySignupSinceSql\(` | 46 |
| P7 | 요약 칸 읽기(여정 · 자동마케팅 파일 = `journey-` · `automarketing-` · `operator-` · `continuous-operator` · `autosend-` 로 시작하는 파일 · P5 줄 제외) | `\b(purchase_count\|…\|recent_purchase_store)\b` | 85 |

## §1 흐름 단계 표(쓰는 쪽 · 읽는 쪽 · 두 문 회사에서 지금 · 판정)

| 단계 | 쓰는 쪽 | 읽는 쪽 | 두 문 회사에서 지금 | 판정 |
|---|---|---|---|---|
| S1 몰 주문 들어옴 | `cdp-orders.ts:212-310` 결제 주문 → `cdp_events` purchase(`revenue_applied` 표식) + 고객 요약 칸 증분(`:298-305`) | 결제 판정 한 곳 `cdp-order-revenue.ts:74-88`(`netPurchaseSql` · `cdpEventNameMatchSql`) | 몰 주문은 사건 · 요약 칸 둘 다에 들어간다 | 정상(쓰기 자체) · 요약 칸 뜻은 S4 |
| S2 몰 주문 취소 · 환불 | `cdp-orders.ts:311-400` 차감 · 최근 구매일 다시 셈(`:356-359` 몰 결제 + 원장 둘 다 · 날짜별) | 같음 | 최근 구매일을 두 문에서 다시 고른다 | 정상(이미 두 문) |
| S3 매장 구매 들어옴 | `sync-ingest.ts:185` 원장 INSERT(`source_row_key` 멱등 · `created_at` 안 바꿈) · 시연 `demo-data.ts:380-413` | `routes/sync.ts:1260` → 요약 재계산(S4) | 원장에는 들어간다 | 정상(쓰기 자체) |
| S4 고객 구매 요약 칸 쓰기(구매횟수 · 누적금액 · 최근 구매일 · 최근 구매 금액 · 매장) | 작성자 셋 ① 몰 증분 `cdp-orders.ts:298-305` ② 원장 재계산 `customer-purchase-aggregates.ts:95-134` ③ 고객 원본(싱크 고객 매핑 · 엑셀) `customer-upsert.ts:107-125` | S10 의 85 자리 | ② = 몰 매출 표식 회사면 통째로 건너뜀(`:38-61` · `:112`) → 매장 구매가 요약 칸에 안 들어감 · ③ = 구매횟수 · 최근일 큰 값 · 누적금액은 원본 값으로 덮음(몰 증분이 다음 고객 적재에 사라짐) | **결함 T1** |
| S5 문 판정 | `journey-purchase-ledger.ts:108-124`(자사몰 30일 안 구매 · 결제 전 주문 = 몰 문 현역) · `:176-191` 원장 문 관문 | S6 · S11 · S12 의 소비처 · 관측(`cdp-diagnostics.ts:253` · `mall-integration-monitor.ts:74` = 들어온 사건 수 · 정상) · 구매 데이터 유무 `company-data-profile.ts:270-300`(두 문 OR · 정상) | 「회사마다 문 하나」 · 몰이 살아 있으면 매장 문을 닫는다 | **결함 T2**(두 문 회사 = 매장 구매가 여정 · 상품 · 통계에서 빠짐의 뿌리) |
| S6 구매 여정 진입(구매 · 첫 구매 · 휴면 복귀 · 상품 재구매) | 몰 문 커서 `journey-target-extractor.ts:756-800`(`:762`) · 원장 문 `:801-850`(`:828`) · 감시 `journey-trigger-watcher.ts:300-312`(몰 다음 원장 · 같은 여정 차례) · `:640-760` 원장 문(관문 `:677`) · 두 문 트리거 목록 `journey-cdp-cursor.ts:149` | 진입 넣기(감시) | 원장 문 닫힘 → 매장 구매 진입 0 · 문을 열면 같은 주문이 두 문에서 두 번 진입(다른 문 같은 구매 거름 없음 · 몰 사건이 매장보다 늦게 와도) | **결함 T2 · T3** |
| S6-미리보기 | 사건 갈래 대상 `journey-target-extractor.ts:641-700`(`cdpEventTargetQuery` · 미리보기 = 최근 7일 · `:680`) | 「지금 몇 명인지 보기」 · 「켜면 어떻게 될지 미리 보기」 | 구매 시작 여정의 미리보기 인원 = 몰 사건만 · 매장 구매자 0(매장만 쓰는 회사도 같음) | **결함 T4** |
| S7 진입 뒤 취소 | 진입 사건 취소 판정 `journey-goal-purchase.ts:50-70`(몰 사건만) | 실행기 묶음 | 매장 원장에는 취소 칸이 없다(`status/SCHEMA.md` purchases 절) | 정상(근거 = 원장에 취소 없음 · 싱크가 취소를 싣게 되면 같은 자리) |
| S8 실행 중 판정 | 목표 · 「들어온 뒤 구매했나」 `journey-goal-purchase.ts:20-37`(요약 칸 · 몰 · 원장 OR) · 상품 재구매 `journey-product.ts:236-258`(두 문 OR) · 기다리기 칸 사건 `journey-executor.ts:1355-1361`(`:1360`) · 조건 칸 「구매 사건 있나」 `:1722-1735`(`:1729`) | 실행기 | 목표 · 상품 재구매 = 두 문(정상) · 기다리기 · 조건 칸 = 몰 사건만 → 매장에서 사도 「안 샀음」(매장만 쓰는 회사도 같음) | 목표 · 상품 = 정상 · 기다리기 · 조건 = **결함 T5** |
| S9 이력 판정 | 장바구니 · 조회 뒤 산 사람 빼기 `journey-target-extractor.ts:220-280`(두 문) · 이전 구매(첫 구매 · 휴면 복귀) `:851-900`(두 문) · 구매 주기 이력 `:290-310`(몰 + 원장 UNION · 분 단위 같은 줄 하나) · 주문 시도 `journey-purchase-ledger.ts:100-107` | 진입 자격 | 빼기 · 이전 구매 = 정상 · 구매 주기 = 같은 주문이 두 문에 있으면 원장(날짜 0시)과 몰(그 시각)이 다른 줄 → 하루 두 번 산 것으로 세어 주기가 줄어듦 | 빼기 · 이전 구매 = 정상 · 구매 주기 = **결함 T3**(같은 구매 판정 없음) |
| S10 요약 칸 판정(85 자리) | S4 | 휴면 `journey-target-extractor.ts:173-200` · 포인트 미사용 `:409` · 마지막 구매 N일 `:1055-1060` · 자동마케팅 대상 축 `automarketing-segment.ts`(16) · 운영자 스냅샷 · 추정 · 대상 수(`operator-*`) · 여정 추천(`journey-opportunities.ts` 17) · 조건 칸 고객 정보 · 문안 변수(`journey-message-render.ts`) · AI 지시문 | 읽는 자리는 값을 그대로 쓴다 → S4 값이 두 문 합이 아니면 어제 매장에서 산 고객이 휴면 · 「오래 안 산 고객」으로 잡힌다 | **결함 T1 이 원인**(읽는 자리 자체는 정상) |
| S11 상품 | 지금 문 `journey-product.ts:104-105` → 상품 목록 · 사용 주기 · 리듬 · 상품 주기(`:116-330`) · 상품 재구매 만들기 `journey-product-create.ts:73` · 화면 `routes/ai.ts:3095` · `:3110` · 플래너 `routes/marketing-planner.ts:273` · `planner-audience.ts:195-292` · 여정 추천 `journey-opportunities.ts:536` · 상품 구매자 미리보기 `journey-target-extractor.ts:600-640` | 상품 재구매 여정 감시 `journey-trigger-watcher.ts:280-298`(저장한 문 ≠ 지금 문 = 멈춤) | 문 하나 = 매장 상품을 고를 수 없다 · 자사몰 주문이 30일 끊기면 문이 바뀌어 상품 재구매 여정이 멈춘다 | **결함 T7** |
| S12 화면 · 통계 | 문 안내 `journey-purchase-ledger.ts:126-175` → `routes/ai.ts:4141`(「매장 구매는 하루 모아…」 · 마지막 도착) · 여정 통계 문 하나 `journey-stats.ts:656`(`:250-262` · `:351-356`) · 구매 이력 화면 `purchase-history-source.ts:40-80`(같은 고객 · 날 · 한 행 금액 = 원장 우선) · 자동마케팅 성과 `automarketing-roi.ts:50-53`(몰 사건만) · 캠페인 반응 귀속 `campaign-response-attribution.ts:114`(몰 사건 · 없으면 요약 칸) | 화면 | 문 안내 = 한 문만 말함 · 여정 통계 = 한 문만 셈 · 구매 이력 = 매장 원장이 상품 줄 단위면 같은 주문이 두 번 보임(시험 DB 1103) · 자동마케팅 성과 · 반응 = 매장 구매 빠짐 | **결함 T8**(문 안내 · 여정 통계) · **T3**(구매 이력 같은 구매) · **T9**(자동마케팅 성과 · 반응) |
| S13 가입 근거 쓰기 | 화면 추가 `routes/customers.ts:578` · `:685` · `:703` · 싱크 incremental `routes/sync.ts:850` · `:900` · 엑셀 [신규로] `routes/upload.ts:721` · `:748` · 몰 회원 `cdp-identity.ts:322` · `:665` · 다시 쓰기 이른 값 `customer-upsert.ts:125` · CT `customer-joined-at.ts:1-40` | S14 | 길마다 근거가 있을 때만 쓴다(C98) | 정상 |
| S14 가입 근거 판정 | 근거 있음 = 「`joined_at` 행이 하나라도 있나」 `customer-joined-at.ts:70-78` → `company-data-profile.ts:243-263` → `journey-identity-signals.ts:124-128` | 진입 감시 멈춤 `journey-trigger-watcher.ts:315-335` · 신규 가입 트리거 열림 `company-data-profile.ts:303` → `journey-trigger-capability.ts:102` · 자동마케팅 축 `operator-audience.ts:133` · `automarketing-segment.ts:330` · 신규 판정 SQL(`newSignupSql` · `journeySignupSinceSql` · 정상) | 설계 3-6 원문은 「joined_at 을 **쓰는 길**이 하나도 없으면」인데 구현은 「**행**이 있나」 → C98 DDL 직후 모든 회사 근거 없음 · 첫 full 싱크 고객사는 incremental 새 고객이 들어오기 전까지 신규 가입 여정을 켤 수 없다(1103 실측: 한줄 뷰티(시연) 신규 가입 환영 멈춤 · 켜진 신규 가입 여정 0) · 잠긴 트리거 문구 「기존 고객과 새 고객을 구분할 정보가 없어요. 구매이력을 연동하면 열립니다.」(`journey-trigger-capability.ts:104`) = 옛 판정 문구(구매이력으로는 이제 안 열림) | **결함 T10** |
| S15 고객 · 구매 지우기 | `routes/admin.ts:456` · `routes/customers.ts:1369` · `:1449` · `:1548` | — | 고객을 지우면 그 원장 행도 지운다 | 정상 |

## §2 결함 장부(사슬 · 고객이 겪는 일)

| 번호 | 결함 | 사슬(파일:행) | 고객사 · 고객이 겪는 일 | 정한 처방 방향 |
|---|---|---|---|---|
| T1 | 두 문 회사의 고객 구매 요약 칸이 두 채널 합이 아니다 | `customer-purchase-aggregates.ts:112`(몰 매출 표식 회사 = 원장 재계산 건너뜀) · `customer-upsert.ts:107-125`(원본 값 덮음 · 큰 값) · `cdp-orders.ts:298-305`(몰 증분) | 어제 매장에서 산 단골에게 휴면 · 「오래 안 산 고객」 문자 · 자동마케팅 첫 구매 · 금액 증가 축이 매장 구매를 모름 | ⑨-2 = 세 칸 두 문 합(같은 구매 한 번) · 원본 값보다 안 내려감 |
| T2 | 문 판정 「회사마다 문 하나」 | `journey-purchase-ledger.ts:108-124` · `:185-189` → `journey-trigger-watcher.ts:677` | 매장에서 산 고객은 구매 · 첫 구매 · 휴면 복귀 · 상품 재구매 여정에 안 들어간다 | 문 판정 없앰 · 두 문 다 엶 |
| T3 | 같은 구매 판정이 없다(진입 · 구매 주기 · 구매 이력) | 진입 `journey-target-extractor.ts:762` · `:828` · 주기 `:290-310` · 구매 이력 `purchase-history-source.ts:68-75`(한 행 금액만) | 문을 열면 같은 주문으로 문자 두 통 · 구매 주기가 짧게 잡힘 · 구매 이력에 같은 주문 두 줄 | ⑨-1 = 같은 고객 · 같은 날 · (한 행 금액 또는 그날 합계 같음) = CT 하나 · 진입은 양쪽 문에서 다른 문을 본다 |
| T4 | 구매 시작 여정 미리보기 인원이 몰 사건만 센다 | `journey-target-extractor.ts:641-700` | 매장(만 · 둘 다) 회사에서 「지금 몇 명」 · 「켜면 어떻게 될지」가 실제보다 적다(매장만 = 0) | 미리보기도 두 문(같은 구매 한 번) |
| T5 | 기다리기 · 조건 칸의 구매 = 몰 사건만 | `journey-executor.ts:1360` · `:1729` | 매장에서 산 고객도 「안 샀음」 갈래 문자를 받는다 | 매장 구매도 구매(원장은 날짜만 = 목표 판정과 같은 규칙 · 진입 다음 날부터) |
| T7 | 상품 = 지금 문 하나 | `journey-product.ts:104-105` 와 S11 소비처 · `journey-trigger-watcher.ts:293-296` | 매장 상품을 고를 수 없다 · 몰 주문이 30일 끊기면 상품 재구매 여정이 멈춘다 | ⑨-3 = 자사몰 상품 / 매장 상품 나눠 보여 주고 고른 상품은 그 문에서 재구매 · 문 바뀜 멈춤 없앰 |
| T8 | 문 안내 · 여정 통계가 한 문만 본다 | `journey-purchase-ledger.ts:156-172` → `routes/ai.ts:4141` · `journey-stats.ts:656` | 「매장 구매는 하루 모아…」 안내가 안 보이거나 몰 기준만 · 여정 전환이 한 채널만 | 문 안내 = 두 문 각각 · 통계 = 두 문 합(같은 구매 한 번) |
| T9 | 자동마케팅 성과 · 반응 귀속이 몰 사건만 | `automarketing-roi.ts:50-53` · `campaign-response-attribution.ts:107-135` | 두 문 회사의 자동마케팅 귀속 매출 · 반응에서 매장 구매가 빠진다 | 귀속 = 두 문(같은 구매 한 번) · 새로 정할 것(아래 §4) |
| T10 | 가입 근거 판정 = 행이 있나(설계 = 쓰는 길이 있나) · 잠금 문구가 옛 판정 | `customer-joined-at.ts:70-78` · `journey-trigger-capability.ts:102-104` · `journey-trigger-watcher.ts:325-330` | 첫 full 싱크 고객사는 신규 가입 여정을 켤 수 없다 · 켜진 여정이 멈춘다 · 「구매이력을 연동하면 열립니다」를 보고 따라 해도 안 열린다 | 새로 정할 것(아래 §4) |

> T6 번호는 비웠다(구매 주기 = T3 과 같은 뿌리로 합침).

## §3 범위 밖 기능(여정 · 자동마케팅 흐름 밖 · 한쪽 문만 읽음 · Harold 확인)

| 기능 | 자리 | 지금 | 두 문 회사에서 |
|---|---|---|---|
| DM 전환 | `routes/dm.ts:1615` | 원장만 | 몰 구매 전환 빠짐 |
| 고객 360 타임라인 | `customer-timeline.ts:436` · `:815` | 원장 구매(몰 주문은 사건 쪽 따로) | 같은 주문 두 번 보일 수 있음 |
| AI 분석 | `routes/analysis.ts:481` · `:495` · `:797` | 원장만 | 몰 구매 빠짐 |
| 캠페인 수신자 전환 | `recipient-conversion.ts:86` | 원장만 | 몰 구매 빠짐 |
| 인앱 전환 · 대상 | `inapp-funnel-stats.ts:488`(원장) · `inapp-segment-matcher.ts:121`(몰) | 한쪽 | 다른 쪽 빠짐 |
| 다음 수 · 캘린더 · 성과 축 · 예측 · 등급 전환 · 활성 고객 | `next-action-advisor.ts:100-170` · `marketing-calendar-store.ts:119` · `performance-customer-axis.ts:139` · `:235` · `predictive-suite.ts:145` · `:538` · `grade-conversion-stats.ts:84` · `cdp-active-customers.ts:70` | 몰 사건만 | 매장 구매 빠짐 |

## §4 정할 것(흐름 표 확정 뒤 설계서에서 추천과 함께)

- T9 자동마케팅 성과 · 반응 귀속에 매장 구매를 넣는 기준(매장 구매는 날짜만 · 발송 뒤 7일 창을 날짜로).
- T10 「쓰는 길」의 정의(몰 회원 연동 · 싱크 incremental 기록 · 화면 추가 중 무엇이 있으면 여나) · 잠금 문구.
- §3 범위 밖 기능을 C99 에 넣을지(추천 = 따로 · 여정 · 자동마케팅 발송 판정에 쓰이지 않는 화면 · 통계).

## §5 뽑은 칸 전수 → 단계 배정(258 · 배정 못 한 칸 0)

| 단계 | 패턴 | 파일:행 | 줄 |
|---|---|---|---|
| S1 | P3 | `utils/cdp-order-revenue.ts:74` | export function netPurchaseSql(alias: string): string { |
| S1 | P3 | `utils/cdp-order-revenue.ts:77` | return '(${alias}.event_name = 'purchase'' |
| S1 | P3 | `utils/cdp-order-revenue.ts:87` | export function cdpEventNameMatchSql(alias: string, paramRef: string): string { |
| S1 | P3 | `utils/cdp-order-revenue.ts:88` | return '(${alias}.event_name = ${paramRef}::text AND (${paramRef}::text <> 'purchase' OR ${netPurchaseSql(alia |
| S1 | P3 | `utils/cdp-orders.ts:212` | AND event_name IN ('purchase', 'order_placed') |
| S1 | P3 | `utils/cdp-orders.ts:256` | AND event_name = 'purchase' |
| S1 | P3 | `utils/cdp-orders.ts:266` | event_name = 'purchase', |
| S1 | P5 | `utils/cdp-orders.ts:298` | total_purchase_amount = COALESCE(total_purchase_amount, 0) + $2, |
| S1 | P5 | `utils/cdp-orders.ts:300` | purchase_count = COALESCE(purchase_count, 0) + 1, |
| S1 | P5 | `utils/cdp-orders.ts:301` | recent_purchase_date = GREATEST(COALESCE(recent_purchase_date, $3::date), $3::date), |
| S1 | P5 | `utils/cdp-orders.ts:302` | recent_purchase_amount = CASE WHEN recent_purchase_date IS NULL OR $3::date >= recent_purchase_date THEN $2 EL |
| S1 | P5 | `utils/cdp-orders.ts:305` | avg_order_value = (COALESCE(total_purchase_amount, 0) + $2) / GREATEST(COALESCE(purchase_count, 0) + 1, 1), |
| S2 | P5 | `utils/cdp-orders.ts:339` | total_purchase_amount = GREATEST(COALESCE(c.total_purchase_amount, 0) - $2, 0), |
| S2 | P5 | `utils/cdp-orders.ts:341` | purchase_count = GREATEST(COALESCE(c.purchase_count, 0) - 1, 0), |
| S2 | P5 | `utils/cdp-orders.ts:342` | avg_order_value = CASE |
| S2 | P5 | `utils/cdp-orders.ts:347` | recent_purchase_date = CASE WHEN c.recent_purchase_date = $3::date THEN nr.day ELSE c.recent_purchase_date END |
| S2 | P5 | `utils/cdp-orders.ts:348` | recent_purchase_amount = CASE WHEN c.recent_purchase_date = $3::date THEN nr.amount ELSE c.recent_purchase_amo |
| S2 | P3 | `utils/cdp-orders.ts:356` | WHERE e.company_id = $4::uuid AND e.customer_id = $1::uuid AND ${netPurchaseSql('e')} |
| S2 | P2 | `utils/cdp-orders.ts:359` | FROM purchases p |
| S3 | P2 | `utils/demo-data.ts:380` | const r = await query('SELECT 1 FROM purchases WHERE company_id = $1::uuid AND source_row_key LIKE 'demo-seed- |
| S3 | P2 | `utils/demo-data.ts:413` | FROM purchases |
| S3 | P1 | `utils/sync-ingest.ts:185` | 'INSERT INTO purchases (${columnList}) |
| S4 | P4 | `utils/customer-purchase-aggregates.ts:38` | async function hasWebhookRevenueHistory(companyId: string): Promise<boolean> { |
| S4 | P3 | `utils/customer-purchase-aggregates.ts:50` | WHERE company_id = $1::uuid AND event_name = 'purchase' |
| S4 | P4 | `utils/customer-purchase-aggregates.ts:112` | if (await hasWebhookRevenueHistory(companyId)) return 0; |
| S4 | P2 | `utils/customer-purchase-aggregates.ts:124` | FROM purchases p |
| S5 | P3 | `utils/cdp-diagnostics.ts:253` | COUNT(*) FILTER (WHERE event_name IN ('purchase', 'order'))::int AS purchase |
| S5 | P6 | `utils/company-data-profile.ts:278` | const identity = await getCompanyIdentityCapability(companyId); |
| S5 | P3 | `utils/company-data-profile.ts:284` | (EXISTS (SELECT 1 FROM cdp_events WHERE company_id = $1::uuid AND event_name = 'purchase') |
| S5 | P2 | `utils/company-data-profile.ts:285` | OR EXISTS (SELECT 1 FROM purchases WHERE company_id = $1::uuid |
| S5 | P3 | `utils/company-data-profile.ts:292` | (EXISTS (SELECT 1 FROM cdp_events WHERE company_id = $1::uuid AND event_name = 'purchase' |
| S5 | P2 | `utils/company-data-profile.ts:294` | OR EXISTS (SELECT 1 FROM purchases WHERE company_id = $1::uuid AND purchase_date IS NOT NULL AND customer_id I |
| S5 | P4 | `utils/journey-purchase-ledger.ts:108` | export async function isMallPurchaseDoorActive(companyId: string): Promise<boolean> { |
| S5 | P3 | `utils/journey-purchase-ledger.ts:116` | AND event_name IN ('purchase', 'order_placed') |
| S5 | P4 | `utils/journey-purchase-ledger.ts:185` | export async function resolvePurchaseLedgerGate(companyId: string): Promise<PurchaseLedgerGate> { |
| S5 | P4 | `utils/journey-purchase-ledger.ts:186` | if (await isMallPurchaseDoorActive(companyId)) { |
| S5 | P3 | `utils/mall-integration-monitor.ts:74` | WHERE company_id = ANY($1::uuid[]) AND event_name IN ('purchase', 'order_placed') |
| S6 | P4 | `utils/journey-cdp-cursor.ts:149` | export function usesPurchaseLedger(triggerEvent: string): boolean { |
| S6 | P3 | `utils/journey-target-extractor.ts:680` | AND ${cdpEventNameMatchSql('e', '$2')}   -- ★ 2026-11-02 구매 이름이면 결제된 구매(3-4 ① · CT-J3) |
| S6 | P3 | `utils/journey-target-extractor.ts:762` | AND ${cdpEventNameMatchSql('e', '$2')}   -- ★ 2026-11-02 진입 커서 = 결제된 구매(3-4 ① · CT-J3) |
| S6 | P2 | `utils/journey-target-extractor.ts:828` | FROM purchases p |
| S6 | P4 | `utils/journey-trigger-watcher.ts:38` | import { resolvePurchaseLedgerGate, isLedgerRunWindowHour, PURCHASE_TRIGGER_MAX_AGE_HOURS } from './journey-pu |
| S6 | P4 | `utils/journey-trigger-watcher.ts:308` | if (!usesPurchaseLedger(j.trigger_event) \|\| fromEvents.paused) return fromEvents; |
| S6 | P4 | `utils/journey-trigger-watcher.ts:677` | const gate = await resolvePurchaseLedgerGate(j.company_id); |
| S7 | P3 | `utils/journey-goal-purchase.ts:57` | AND ev.event_name = 'purchase' AND NOT ${netPurchaseSql('ev')}'; |
| S8 | P3 | `utils/journey-executor.ts:1360` | AND ${cdpEventNameMatchSql('c', '$4')} AND c.occurred_at >= a.at)',   // ★ 2026-11-02 기다리기 사건이 구매면 결제된 구매(3-4  |
| S8 | P3 | `utils/journey-executor.ts:1729` | WHERE customer_id = ANY($1::uuid[]) AND company_id = $2::uuid AND ${cdpEventNameMatchSql('cdp_events', '$3')} |
| S8 | P3 | `utils/journey-goal-purchase.ts:28` | AND ${netPurchaseSql('pe')} AND pe.occurred_at > ${e}.entered_at)   -- ★ 2026-11-02 목표 = 결제된 구매(3-4 ③ · CT-J3) |
| S8 | P2 | `utils/journey-goal-purchase.ts:29` | OR EXISTS (SELECT 1 FROM purchases pp |
| S8 | P2 | `utils/journey-goal-purchase.ts:33` | OR ((${signupExpr}) AND EXISTS (SELECT 1 FROM purchases pb |
| S8 | P3 | `utils/journey-product.ts:244` | AND ${netPurchaseSql('e')} AND e.occurred_at > $3::timestamptz   -- ★ 2026-11-02 CT-J3 |
| S8 | P2 | `utils/journey-product.ts:248` | SELECT 1 FROM purchases p |
| S9 | P3 | `utils/journey-purchase-ledger.ts:105` | return '${alias}.event_name IN ('purchase', 'order_placed')'; |
| S9 | P2 | `utils/journey-target-extractor.ts:235` | SELECT 1 FROM purchases p2 |
| S9 | P2 | `utils/journey-target-extractor.ts:274` | SELECT 1 FROM purchases p2 |
| S9 | P3 | `utils/journey-target-extractor.ts:303` | WHERE e.company_id = $1::uuid AND ${netPurchaseSql('e')} AND e.customer_id IS NOT NULL   -- ★ 2026-11-02 CT-J3 |
| S9 | P2 | `utils/journey-target-extractor.ts:305` | SELECT DISTINCT p.customer_id, date_trunc('minute', p.purchase_date AT TIME ZONE 'Asia/Seoul') FROM purchases  |
| S9 | P3 | `utils/journey-target-extractor.ts:878` | AND ${netPurchaseSql('e')} AND e.occurred_at < c.entered_at),   -- ★ 2026-11-02 이전 구매 = 결제된 구매(CT-J3) |
| S9 | P2 | `utils/journey-target-extractor.ts:879` | (SELECT MAX(p.purchase_date AT TIME ZONE 'Asia/Seoul') FROM purchases p |
| S10 | P7 | `utils/automarketing-segment.ts:218` | AND c.recent_purchase_date IS NOT NULL |
| S10 | P7 | `utils/automarketing-segment.ts:219` | AND c.recent_purchase_date >= ((s.observed_at AT TIME ZONE 'Asia/Seoul')::date)' |
| S10 | P7 | `utils/automarketing-segment.ts:261` | return 'AND c.recent_purchase_date IS NOT NULL AND c.recent_purchase_date <= $${params.length}'; |
| S10 | P7 | `utils/automarketing-segment.ts:274` | return 'AND c.recent_purchase_date >= $${params.length}'; |
| S10 | P7 | `utils/automarketing-segment.ts:377` | AND COALESCE(s.purchase_count, 0) = 0 |
| S10 | P7 | `utils/automarketing-segment.ts:378` | AND COALESCE(c.purchase_count, 0) >= 1', { requirePurchaseInWindow: true }), |
| S10 | P7 | `utils/automarketing-segment.ts:397` | AND s.recent_purchase_date IS NOT NULL |
| S10 | P7 | `utils/automarketing-segment.ts:398` | AND s.recent_purchase_date <= ((s.observed_at AT TIME ZONE 'Asia/Seoul')::date - $${d}::int) |
| S10 | P7 | `utils/automarketing-segment.ts:399` | AND c.recent_purchase_date > s.recent_purchase_date'; |
| S10 | P7 | `utils/automarketing-segment.ts:420` | AND c.recent_purchase_date IS NOT DISTINCT FROM s.recent_purchase_date |
| S10 | P7 | `utils/automarketing-segment.ts:421` | AND COALESCE(c.purchase_count, 0) = COALESCE(s.purchase_count, 0) |
| S10 | P7 | `utils/automarketing-segment.ts:422` | AND s.recent_purchase_date IS NOT NULL |
| S10 | P7 | `utils/automarketing-segment.ts:423` | AND s.recent_purchase_date > ((s.observed_at AT TIME ZONE 'Asia/Seoul')::date - $${d}::int) |
| S10 | P7 | `utils/automarketing-segment.ts:424` | AND c.recent_purchase_date <= $${cutoff}::date'; |
| S10 | P7 | `utils/automarketing-segment.ts:440` | AND COALESCE(c.total_purchase_amount, 0) - COALESCE(s.total_purchase_amount, 0) >= $${params.length}::numeric' |
| S10 | P7 | `utils/continuous-operator.ts:1045` | AVG(purchase_count) AS avg_purchase_count, |
| S10 | P7 | `utils/continuous-operator.ts:1046` | AVG(total_purchase_amount) AS avg_total_spent |
| S10 | P7 | `utils/journey-ai-generator.ts:448` | ✓ 조건 분기: {% if customer.grade == 'VIP' %} VIP 안내 {% elsif customer.purchase_count > 10 %} 오래 함께한 고객 안내 {% else |
| S10 | P7 | `utils/journey-ai-generator.ts:545` | {% elsif customer.purchase_count > 10 %} |
| S10 | P7 | `utils/journey-ai-generator.ts:546` | {{ customer.name \| default: '고객' }}님과 함께한 {{ customer.purchase_count }}번의 만남, |
| S10 | P7 | `utils/journey-builder.ts:600` | · 지원 컬럼: name / phone / email / birth_date / recent_purchase_date / recent_purchase_amount / total_purchase_am |
| S10 | P7 | `utils/journey-builder.ts:624` | { "stepOrder": 3, "stepType": "condition", "delayHours": 0, "conditionJsonb": {"type":"customer_field","field" |
| S10 | P7 | `utils/journey-condition-fields.ts:17` | { key: 'purchase_count', label: '구매 횟수', ai: '구매 횟수 (숫자)' }, |
| S10 | P7 | `utils/journey-condition-fields.ts:18` | { key: 'total_purchase_amount', label: '총 구매액', ai: '총 구매액 (원 · 숫자)' }, |
| S10 | P7 | `utils/journey-condition.ts:41` | const rp = calendarDayMs(customer.recent_purchase_date); |
| S10 | P7 | `utils/journey-executor.ts:196` | recent_purchase_date: Date \| null; |
| S10 | P7 | `utils/journey-goal-purchase.ts:24` | AND pc.recent_purchase_date IS NOT NULL |
| S10 | P7 | `utils/journey-goal-purchase.ts:25` | AND pc.recent_purchase_date > (${e}.entered_at AT TIME ZONE 'Asia/Seoul')::date) |
| S10 | P7 | `utils/journey-identity-signals.ts:32` | \| 'purchase_count' |
| S10 | P7 | `utils/journey-identity-signals.ts:33` | \| 'recent_purchase_date' |
| S10 | P7 | `utils/journey-identity-signals.ts:35` | \| 'total_purchase_amount' |
| S10 | P7 | `utils/journey-identity-signals.ts:43` | purchase_count: '구매 횟수', |
| S10 | P7 | `utils/journey-identity-signals.ts:44` | recent_purchase_date: '최근 구매일', |
| S10 | P7 | `utils/journey-identity-signals.ts:46` | total_purchase_amount: '총 구매액', |
| S10 | P7 | `utils/journey-identity-signals.ts:53` | purchase_count: 'strong', |
| S10 | P7 | `utils/journey-identity-signals.ts:54` | recent_purchase_date: 'strong', |
| S10 | P7 | `utils/journey-identity-signals.ts:56` | total_purchase_amount: 'strong', |
| S10 | P7 | `utils/journey-identity-signals.ts:100` | if (c.hasPurchaseCount) out.push('purchase_count'); |
| S10 | P7 | `utils/journey-identity-signals.ts:101` | if (c.hasRecentPurchaseDate) out.push('recent_purchase_date'); |
| S10 | P7 | `utils/journey-identity-signals.ts:103` | if (c.hasTotalPurchaseAmount) out.push('total_purchase_amount'); |
| S10 | P7 | `utils/journey-message-render.ts:113` | customer.recent_purchase_store \|\| customer.registered_store \|\| null, |
| S10 | P7 | `utils/journey-message-render.ts:166` | ORDER BY recent_purchase_amount DESC NULLS LAST, total_purchase_amount DESC NULLS LAST LIMIT 1', |
| S10 | P7 | `utils/journey-opportunities.ts:111` | PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY avg_order_value) FILTER (WHERE avg_order_value > 0) AS median_aov |
| S10 | P7 | `utils/journey-opportunities.ts:135` | AND (recent_purchase_date IS NULL OR recent_purchase_date < last_cart_add_at::date)) AS cart_cnt, |
| S10 | P7 | `utils/journey-opportunities.ts:136` | COALESCE(SUM(COALESCE(avg_order_value, recent_purchase_amount, $4::numeric)) |
| S10 | P7 | `utils/journey-opportunities.ts:138` | AND (recent_purchase_date IS NULL OR recent_purchase_date < last_cart_add_at::date)), 0) AS cart_val, |
| S10 | P7 | `utils/journey-opportunities.ts:142` | COUNT(*) FILTER (WHERE recent_purchase_date IS NOT NULL |
| S10 | P7 | `utils/journey-opportunities.ts:143` | AND (CURRENT_DATE - recent_purchase_date) > $2) AS dorm_cnt, |
| S10 | P7 | `utils/journey-opportunities.ts:144` | COALESCE(SUM(COALESCE(avg_order_value, recent_purchase_amount, $4::numeric)) |
| S10 | P7 | `utils/journey-opportunities.ts:145` | FILTER (WHERE recent_purchase_date IS NOT NULL |
| S10 | P7 | `utils/journey-opportunities.ts:146` | AND (CURRENT_DATE - recent_purchase_date) > $2), 0) AS dorm_val, |
| S10 | P7 | `utils/journey-opportunities.ts:147` | COALESCE(SUM(total_purchase_amount) |
| S10 | P7 | `utils/journey-opportunities.ts:148` | FILTER (WHERE recent_purchase_date IS NOT NULL |
| S10 | P7 | `utils/journey-opportunities.ts:149` | AND (CURRENT_DATE - recent_purchase_date) > $2), 0) AS dorm_total, |
| S10 | P7 | `utils/journey-opportunities.ts:154` | COUNT(*) FILTER (WHERE purchase_count >= 2 AND recent_purchase_date IS NOT NULL |
| S10 | P7 | `utils/journey-opportunities.ts:155` | AND (CURRENT_DATE - recent_purchase_date) BETWEEN $3 AND $2) AS repur_cnt, |
| S10 | P7 | `utils/journey-opportunities.ts:156` | COALESCE(SUM(COALESCE(avg_order_value, recent_purchase_amount, $4::numeric)) |
| S10 | P7 | `utils/journey-opportunities.ts:157` | FILTER (WHERE purchase_count >= 2 AND recent_purchase_date IS NOT NULL |
| S10 | P7 | `utils/journey-opportunities.ts:158` | AND (CURRENT_DATE - recent_purchase_date) BETWEEN $3 AND $2), 0) AS repur_val, |
| S10 | P7 | `utils/journey-opportunities.ts:161` | AND (recent_purchase_date IS NULL OR recent_purchase_date < last_wishlist_add_at::date)) AS wish_cnt |
| S10 | P7 | `utils/journey-opportunities.ts:346` | COALESCE(SUM(COALESCE(c.avg_order_value, 0)), 0) AS value_at_stake |
| S10 | P7 | `utils/journey-step-format.ts:41` | recent_purchase_amount: '최근구매금액', |
| S10 | P7 | `utils/journey-step-format.ts:42` | total_purchase_amount: '누적구매금액', |
| S10 | P7 | `utils/journey-step-format.ts:43` | purchase_count: '구매횟수', |
| S10 | P7 | `utils/journey-step-format.ts:50` | recent_purchase_date: '최근구매일', |
| S10 | P7 | `utils/journey-target-extractor.ts:184` | upperBound = 'AND c.recent_purchase_date > (${KST_TODAY_DATE_SQL} - ($${params.length} \|\| ' days')::interval |
| S10 | P7 | `utils/journey-target-extractor.ts:194` | AND c.recent_purchase_date IS NOT NULL |
| S10 | P7 | `utils/journey-target-extractor.ts:195` | AND c.recent_purchase_date < (${KST_TODAY_DATE_SQL} - ($2 \|\| ' days')::interval) |
| S10 | P7 | `utils/journey-target-extractor.ts:200` | ORDER BY c.recent_purchase_date DESC |
| S10 | P7 | `utils/journey-target-extractor.ts:409` | edgeClause = '(c.recent_purchase_date IS NULL OR c.recent_purchase_date < (${KST_TODAY_DATE_SQL} - ($3 \|\| '  |
| S10 | P7 | `utils/journey-target-extractor.ts:1011` | (from) => 'SELECT AVG(c.avg_order_value) AS aov, AVG(p.purchase_likelihood) AS conv, AVG(p.click_score) AS clk |
| S10 | P7 | `utils/journey-target-extractor.ts:1060` | const DAYS_SINCE_PURCHASE_SQL = '(${KST_TODAY_DATE_SQL} - c.recent_purchase_date)'; |
| S10 | P7 | `utils/operator-audience.ts:124` | COUNT(*) FILTER (WHERE recent_purchase_date IS NOT NULL)::int AS recent_purchase, |
| S10 | P7 | `utils/operator-audience.ts:127` | COUNT(*) FILTER (WHERE purchase_count IS NOT NULL AND purchase_count > 0)::int        AS purchase_count_filled |
| S10 | P7 | `utils/operator-audience.ts:128` | COUNT(*) FILTER (WHERE total_purchase_amount IS NOT NULL AND total_purchase_amount > 0)::int AS purchase_amoun |
| S10 | P7 | `utils/operator-cycle-snapshot.ts:98` | (operator_id, company_id, customer_id, grade, purchase_count, total_purchase_amount, recent_purchase_date, obs |
| S10 | P7 | `utils/operator-cycle-snapshot.ts:99` | SELECT $1::uuid, $2::uuid, c.id, c.grade, c.purchase_count, c.total_purchase_amount, c.recent_purchase_date, N |
| S10 | P7 | `utils/operator-cycle-snapshot.ts:136` | (operator_id, company_id, customer_id, grade, purchase_count, total_purchase_amount, recent_purchase_date, obs |
| S10 | P7 | `utils/operator-cycle-snapshot.ts:137` | SELECT $1::uuid, $2::uuid, c.id, c.grade, c.purchase_count, c.total_purchase_amount, c.recent_purchase_date, N |
| S10 | P5 | `utils/operator-cycle-snapshot.ts:143` | purchase_count        = EXCLUDED.purchase_count, |
| S10 | P5 | `utils/operator-cycle-snapshot.ts:144` | total_purchase_amount = EXCLUDED.total_purchase_amount, |
| S10 | P5 | `utils/operator-cycle-snapshot.ts:145` | recent_purchase_date  = EXCLUDED.recent_purchase_date, |
| S10 | P7 | `utils/operator-performance-estimator.ts:309` | AVG(NULLIF(c.avg_order_value, 0)), |
| S10 | P7 | `utils/operator-performance-estimator.ts:310` | AVG(CASE WHEN COALESCE(c.purchase_count, 0) > 0 |
| S10 | P7 | `utils/operator-performance-estimator.ts:311` | THEN c.total_purchase_amount / c.purchase_count END), |
| S10 | P7 | `utils/operator-performance-estimator.ts:314` | AVG(CASE WHEN COALESCE(c.purchase_count, 0) > 0 AND c.created_at IS NOT NULL |
| S10 | P7 | `utils/operator-performance-estimator.ts:315` | THEN GREATEST(1.0, EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 86400.0) / c.purchase_count |
| S10 | P7 | `utils/operator-performance-estimator.ts:317` | AVG(CASE WHEN c.recent_purchase_date >= CURRENT_DATE - INTERVAL '90 days' |
| S11 | P4 | `routes/ai.ts:3095` | const door = await currentPurchaseDoor(companyId); |
| S11 | P4 | `routes/ai.ts:3110` | const door = await currentPurchaseDoor(companyId); |
| S11 | P4 | `routes/marketing-planner.ts:273` | const door = await currentPurchaseDoor(companyId); |
| S11 | P4 | `utils/journey-opportunities.ts:536` | const door = await currentPurchaseDoor(companyId); |
| S11 | P4 | `utils/journey-product-create.ts:73` | const door = await currentPurchaseDoor(input.companyId); |
| S11 | P4 | `utils/journey-product.ts:15` | import { isMallPurchaseDoorActive } from './journey-purchase-ledger'; |
| S11 | P4 | `utils/journey-product.ts:104` | export async function currentPurchaseDoor(companyId: string): Promise<PurchaseDoor> { |
| S11 | P4 | `utils/journey-product.ts:105` | return (await isMallPurchaseDoorActive(companyId)) ? 'mall' : 'ledger'; |
| S11 | P3 | `utils/journey-product.ts:128` | WHERE e.company_id = $1::uuid AND ${netPurchaseSql('e')}   -- ★ 2026-11-02 CT-J3 |
| S11 | P3 | `utils/journey-product.ts:139` | WHERE company_id = $1::uuid AND event_name = 'purchase' |
| S11 | P2 | `utils/journey-product.ts:155` | FROM purchases p |
| S11 | P3 | `utils/journey-product.ts:184` | WHERE e.company_id = $1::uuid AND ${netPurchaseSql('e')} AND e.customer_id IS NOT NULL   -- ★ 2026-11-02 CT-J3 |
| S11 | P2 | `utils/journey-product.ts:188` | FROM purchases p |
| S11 | P3 | `utils/journey-product.ts:273` | WHERE e.company_id = $1::uuid AND ${netPurchaseSql('e')} AND e.customer_id IS NOT NULL   -- ★ 2026-11-02 CT-J3 |
| S11 | P2 | `utils/journey-product.ts:276` | FROM purchases p |
| S11 | P3 | `utils/journey-target-extractor.ts:625` | WHERE e.company_id = $1::uuid AND ${netPurchaseSql('e')} AND e.customer_id IS NOT NULL   -- ★ 2026-11-02 CT-J3 |
| S11 | P2 | `utils/journey-target-extractor.ts:628` | : 'SELECT DISTINCT p.customer_id FROM purchases p |
| S11 | P4 | `utils/journey-trigger-watcher.ts:293` | if (door !== await currentPurchaseDoor(j.company_id)) { |
| S11 | P3 | `utils/planner-audience.ts:201` | AND ${netPurchaseSql('pb')} |
| S11 | P2 | `utils/planner-audience.ts:207` | SELECT 1 FROM purchases pb |
| S11 | P4 | `utils/planner-audience.ts:227` | if ((await currentPurchaseDoor(companyId)) !== audience.door) return { ok: false, reason: PLANNER_REASON.purch |
| S11 | P4 | `utils/planner-audience.ts:238` | const door = await currentPurchaseDoor(companyId); |
| S11 | P4 | `utils/planner-audience.ts:292` | currentPurchaseDoor(companyId).then(async (door) => ({ |
| S12 | P4 | `routes/ai.ts:117` | import { getPurchaseDoorStatus } from '../utils/journey-purchase-ledger'; |
| S12 | P4 | `routes/ai.ts:4141` | const purchaseDoor = await getPurchaseDoorStatus(companyId).catch(() => null); |
| S12 | P3 | `utils/automarketing-roi.ts:50` | COALESCE(${netPurchaseSql('e')}, false) AS paid |
| S12 | P3 | `utils/automarketing-roi.ts:53` | AND e.event_name IN ('purchase', 'order') |
| S12 | P3 | `utils/campaign-response-attribution.ts:114` | AND ${netPurchaseSql('e')}   -- ★ 2026-11-02 결제된 구매 = CT(취소 · 환불 0 · 설계서 3-0 CT-J3) |
| S12 | P4 | `utils/journey-purchase-ledger.ts:132` | export async function isMallPurchaseDoorForJourneyStats(companyId: string, journeyId: string): Promise<boolean |
| S12 | P3 | `utils/journey-purchase-ledger.ts:135` | WHERE ce.company_id = $1::uuid AND ce.event_name = 'purchase' |
| S12 | P4 | `utils/journey-purchase-ledger.ts:156` | export async function getPurchaseDoorStatus(companyId: string): Promise<PurchaseDoorStatus> { |
| S12 | P4 | `utils/journey-purchase-ledger.ts:157` | const mallActive = await isMallPurchaseDoorActive(companyId); |
| S12 | P3 | `utils/journey-purchase-ledger.ts:162` | WHERE company_id = $1::uuid AND event_name IN ('purchase', 'order_placed')', |
| S12 | P2 | `utils/journey-purchase-ledger.ts:168` | 'SELECT MAX(created_at)::text AS last FROM purchases WHERE company_id = $1::uuid', |
| S12 | P4 | `utils/journey-stats.ts:19` | import { isMallPurchaseDoorForJourneyStats } from './journey-purchase-ledger'; |
| S12 | P3 | `utils/journey-stats.ts:250` | WHERE ${netPurchaseSql('ce')}   -- ★ 2026-11-02 전환 = 결제된 구매(CT-J3 · 옛 R1-43 이름 판정) |
| S12 | P2 | `utils/journey-stats.ts:262` | FROM purchases p |
| S12 | P3 | `utils/journey-stats.ts:351` | WHERE ${netPurchaseSql('ce')}   -- ★ 2026-11-02 CT-J3 |
| S12 | P2 | `utils/journey-stats.ts:356` | INNER JOIN purchases p ON p.customer_id = ex.customer_id |
| S12 | P4 | `utils/journey-stats.ts:656` | const mallDoor = await isMallPurchaseDoorForJourneyStats(companyId, journeyId);   // ★ 1019 B-1009-3 구매 문 하나(그 |
| S12 | P2 | `utils/purchase-history-source.ts:44` | FROM purchases p0 |
| S12 | P3 | `utils/purchase-history-source.ts:71` | AND ${netPurchaseSql('e')} |
| S12 | P2 | `utils/purchase-history-source.ts:73` | SELECT 1 FROM purchases px |
| S13 | P6 | `routes/customers.ts:34` | import { stampFirstSeenJoinedAt, insertedPhonesOf } from '../utils/customer-joined-at';   // ★ 2026-11-02 가입 근 |
| S13 | P6 | `routes/customers.ts:578` | await stampFirstSeenJoinedAt(run, companyId, insertedPhonesOf(r.rows)); |
| S13 | P6 | `routes/customers.ts:685` | await stampFirstSeenJoinedAt(run, companyId, insertedPhonesOf(bulkRes.rows)); |
| S13 | P6 | `routes/customers.ts:703` | await stampFirstSeenJoinedAt(run, companyId, insertedPhonesOf(rowRes.rows)); |
| S13 | P6 | `routes/sync.ts:23` | import { stampFirstSeenJoinedAt, insertedPhonesOf } from '../utils/customer-joined-at';   // ★ 2026-11-02 가입 근 |
| S13 | P6 | `routes/sync.ts:850` | if (mode === 'incremental') await stampFirstSeenJoinedAt(run, companyId, insertedPhonesOf(up.rows)); |
| S13 | P6 | `routes/sync.ts:900` | if (mode === 'incremental') await stampFirstSeenJoinedAt(run, companyId, insertedPhonesOf(rowResult.rows));    |
| S13 | P6 | `routes/upload.ts:16` | import { stampFirstSeenJoinedAt, insertedPhonesOf, uploadSignupQuestion } from '../utils/customer-joined-at';  |
| S13 | P6 | `routes/upload.ts:721` | if (asNewCustomers) await stampFirstSeenJoinedAt(run, companyId, insertedPhonesOf(r.rows));   // ★ 2026-11-02  |
| S13 | P6 | `routes/upload.ts:748` | if (asNewCustomers) await stampFirstSeenJoinedAt(run, companyId, insertedPhonesOf(r.rows));   // ★ 2026-11-02  |
| S13 | P6 | `utils/cdp-identity.ts:28` | import { joinedAtUpsertSql, joinedAtFromSource } from './customer-joined-at';   // ★ 2026-11-02 가입 근거(CT-J6) |
| S13 | P6 | `utils/cdp-identity.ts:322` | joined_at = ${joinedAtUpsertSql('customers.joined_at', 'EXCLUDED.joined_at')}, |
| S13 | P6 | `utils/cdp-identity.ts:665` | joined_at = ${joinedAtUpsertSql('customers.joined_at', '$11::timestamptz')}, |
| S13 | P6 | `utils/customer-joined-at.ts:20` | export function joinedAtUpsertSql(existing: string, incoming: string): string { |
| S13 | P6 | `utils/customer-joined-at.ts:30` | export async function stampFirstSeenJoinedAt(run: SqlRun, companyId: string, insertedPhones: string[]): Promis |
| S13 | P6 | `utils/customer-upsert.ts:25` | import { joinedAtUpsertSql } from './customer-joined-at';   // ★ 2026-11-02 가입 근거 칸(CT-J6) |
| S13 | P6 | `utils/customer-upsert.ts:125` | ['joined_at', joinedAtUpsertSql('customers.joined_at', 'EXCLUDED.joined_at')], |
| S14 | P6 | `utils/automarketing-segment.ts:36` | import { newSignupSql, NO_JOINED_AT_REASON } from './customer-joined-at';   // ★ 2026-11-02 가입 근거 CT(CT-J6) |
| S14 | P6 | `utils/automarketing-segment.ts:330` | : { available: false, reason: NO_JOINED_AT_REASON }), |
| S14 | P6 | `utils/automarketing-segment.ts:333` | return 'AND ${newSignupSql('c', '$${params.length}::timestamptz')}'; |
| S14 | P6 | `utils/company-data-profile.ts:34` | import { resolveNewCustomerJudgement, type CompanyIdentityCapability } from './journey-identity-signals'; |
| S14 | P6 | `utils/company-data-profile.ts:35` | import { hasJoinedAtEvidence } from './customer-joined-at';   // ★ 2026-11-02 가입 근거 CT(CT-J6) |
| S14 | P6 | `utils/company-data-profile.ts:243` | export async function getCompanyIdentityCapability(companyId: string): Promise<CompanyIdentityCapability> { |
| S14 | P6 | `utils/company-data-profile.ts:255` | const joined = await hasJoinedAtEvidence(companyId); |
| S14 | P6 | `utils/company-data-profile.ts:263` | signupDateColumn: joined ? 'joined_at' : null, |
| S14 | P6 | `utils/company-data-profile.ts:303` | canJudgeNewCustomer: resolveNewCustomerJudgement(identity).canJudge, |
| S14 | P6 | `utils/customer-joined-at.ts:47` | export function newSignupSql(alias: string, sinceRef: string): string { |
| S14 | P6 | `utils/customer-joined-at.ts:64` | export function journeySignupSinceSql(alias: string, baselineExpr: string): string { |
| S14 | P6 | `utils/customer-joined-at.ts:70` | export async function hasJoinedAtEvidence(companyId: string): Promise<boolean> { |
| S14 | P6 | `utils/customer-joined-at.ts:81` | export const NO_JOINED_AT_REASON = '가입한 때를 알 수 있는 정보가 아직 없어요. 자사몰 회원 연동이나 싱크 가입일이 들어오면 열립니다.'; |
| S14 | P6 | `utils/journey-identity-signals.ts:27` | import { NO_JOINED_AT_REASON } from './customer-joined-at';   // ★ 2026-11-02 가입 근거 CT(CT-J6) |
| S14 | P6 | `utils/journey-identity-signals.ts:73` | signupDateColumn?: string \| null; |
| S14 | P6 | `utils/journey-identity-signals.ts:98` | const signupCol = String(c.signupDateColumn \|\| '').trim(); |
| S14 | P6 | `utils/journey-identity-signals.ts:124` | export function resolveNewCustomerJudgement(cap: CompanyIdentityCapability): NewCustomerJudgement { |
| S14 | P6 | `utils/journey-identity-signals.ts:128` | return { canJudge: false, basis: [], strength: null, reason: NO_JOINED_AT_REASON }; |
| S14 | P6 | `utils/journey-opportunities.ts:140` | COUNT(*) FILTER (WHERE ${newSignupSql('c', 'NOW() - INTERVAL '7 days'')}) AS onb_cnt,   -- ★ 2026-11-02 지난 7일  |
| S14 | P6 | `utils/journey-target-extractor.ts:120` | const since = journeySignupSinceSql('c', '(SELECT entry_baseline_at FROM journeys WHERE id = ${jRef})'); |
| S14 | P6 | `utils/journey-target-extractor.ts:121` | entryClause = '${buildLedgerAntiJoin('c', params.length)} AND ${newSignupSql('c', since)}'; |
| S14 | P6 | `utils/journey-target-extractor.ts:124` | entryClause = newSignupSql('c', 'NOW() - ($${params.length} \|\| ' hours')::interval'); |
| S14 | P6 | `utils/journey-trigger-watcher.ts:40` | import { resolveNewCustomerJudgement } from './journey-identity-signals'; |
| S14 | P6 | `utils/journey-trigger-watcher.ts:41` | import { getCompanyIdentityCapability } from './company-data-profile'; |
| S14 | P6 | `utils/journey-trigger-watcher.ts:326` | const judgement = resolveNewCustomerJudgement(await getCompanyIdentityCapability(j.company_id)); |
| S14 | P6 | `utils/next-action-advisor.ts:180` | (SELECT COUNT(*)::int FROM customers WHERE company_id = $1::uuid AND ${newSignupSql('customers', 'NOW() - INTE |
| S14 | P6 | `utils/operator-audience.ts:24` | import { hasJoinedAtEvidence } from './customer-joined-at';   // ★ 2026-11-02 가입 근거 CT(CT-J6 · D20) |
| S14 | P6 | `utils/operator-audience.ts:133` | hasJoinedAtEvidence(companyId), |
| S15 | P2 | `routes/admin.ts:456` | 'DELETE FROM purchases WHERE customer_id IN (SELECT id FROM customers WHERE uploaded_by = $1)', |
| S15 | P2 | `routes/customers.ts:1369` | await client.query('DELETE FROM purchases WHERE customer_id = $1 AND company_id = $2', [id, companyId]); |
| S15 | P2 | `routes/customers.ts:1449` | await client.query('DELETE FROM purchases WHERE customer_id = ANY($1) AND company_id = $2', [validIds, company |
| S15 | P2 | `routes/customers.ts:1548` | purchaseResult = await client.query('DELETE FROM purchases WHERE company_id = $1', [deleteCompanyId]); |
| OUT-DM 전환 | P2 | `routes/dm.ts:1615` | JOIN purchases p ON p.company_id = t.company_id AND p.customer_id = t.customer_id |
| OUT-고객 360 | P2 | `utils/customer-timeline.ts:436` | FROM purchases |
| OUT-고객 360 | P2 | `utils/customer-timeline.ts:815` | 'SELECT COUNT(*)::int AS n FROM purchases |
| OUT-다음 수 | P3 | `utils/next-action-advisor.ts:100` | COUNT(*) FILTER (WHERE ${netPurchaseSql('cdp_events')})::int AS purchase_count   -- ★ 2026-11-02 구매 수 = 결제된 구매 |
| OUT-다음 수 | P3 | `utils/next-action-advisor.ts:170` | AND ${netPurchaseSql('cdp_events')}   -- ★ 2026-11-02 매출 = 결제된 구매(CT-J3) |
| OUT-다음 수 | P3 | `utils/next-action-advisor.ts:426` | AND ${netPurchaseSql('cdp_events')}   -- ★ 2026-11-02 CT-J3 |
| OUT-등급 전환 | P3 | `utils/grade-conversion-stats.ts:84` | AND ${netPurchaseSql('e')}   -- ★ 2026-11-02 전환 = 결제된 구매(CT-J3) |
| OUT-분석 | P2 | `routes/analysis.ts:481` | AND NOT EXISTS (SELECT 1 FROM purchases pu WHERE pu.customer_id = cu.id AND pu.purchase_date >= NOW() - INTERV |
| OUT-분석 | P2 | `routes/analysis.ts:495` | FROM purchases pu |
| OUT-분석 | P2 | `routes/analysis.ts:797` | LEFT JOIN purchases pu ON cu.id = pu.customer_id |
| OUT-성과 축 | P3 | `utils/performance-customer-axis.ts:139` | AND ${netPurchaseSql('e')}   -- ★ 2026-11-02 CT-J3 |
| OUT-성과 축 | P3 | `utils/performance-customer-axis.ts:235` | AND ${netPurchaseSql('e')}   -- ★ 2026-11-02 CT-J3 |
| OUT-예측 | P3 | `utils/predictive-suite.ts:145` | WHERE customer_id = c.id AND ${netPurchaseSql('cdp_events')}) AS total_orders,   -- ★ 2026-11-02 주문 수 = 결제된 구매 |
| OUT-예측 | P3 | `utils/predictive-suite.ts:538` | AND ${netPurchaseSql('cdp_events')}   -- ★ 2026-11-02 실제 구매 = 결제된 구매(CT-J3) |
| OUT-인앱 | P2 | `utils/inapp-funnel-stats.ts:488` | JOIN purchases p ON p.company_id = $1::uuid AND p.customer_id = f.customer_id |
| OUT-인앱 | P3 | `utils/inapp-segment-matcher.ts:121` | AND (${netPurchaseSql('e')} OR e.event_name IN ('order.completed', 'order.created'))   -- ★ 2026-11-02 purchas |
| OUT-캘린더 | P3 | `utils/marketing-calendar-store.ts:119` | AND ${netPurchaseSql('cdp_events')}   -- ★ 2026-11-02 월 구매 · 매출 = 결제된 구매(CT-J3) |
| OUT-캠페인 수신자 전환 | P2 | `utils/recipient-conversion.ts:86` | JOIN purchases pu ON pu.company_id = $1::uuid |
| OUT-활성 고객 | P3 | `utils/cdp-active-customers.ts:70` | CASE WHEN ${netPurchaseSql('e')}   -- ★ 2026-11-02 매출 = 결제된 구매(CT-J3) |

