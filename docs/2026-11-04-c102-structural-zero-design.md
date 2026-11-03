# C102 여정 · 자동마케팅 구조 결함 0 (C99 뒤 · 1104)

> 접수 = Harold 1104 「끝까지 구현 · Codex 닫힐 때까지 · 구조체크 다시 · 결함 나오면 닫힐 때까지 · 반복해서 구조적 결함 0」 · 「내가 전부 승인하니 그렇게 마무리」.
> 절차 = `status/DEFECT-PLAYBOOK.md` · 앞 설계 = C98 `docs/2026-11-02-journey-automarketing-core-fix-design.md` · C99 `docs/2026-11-03-two-door-purchase-design.md`.
> 겹침 = C101(같은 번호 수신동의) 미커밋 파일과 코드 파일 0 겹침(1104 대조 · C101 확인 회신) · `routes/sync.ts` · `customers.ts` · `upload.ts` · `customer-upsert.ts` · `root-ledger.test.ts` · `sync-agent` 안 건드림.

## §0 왜 또 나왔나(구조체크 1회차 결론)

C98 · C99 흐름 표는 **판정 자리**를 다 덮었지만 두 축이 칸에 없었다. 그래서 넷이 「범위 밖」으로 흘렀다.

| 축 | 흐름 표에 없던 것 | 여기서 나온 결함 |
|---|---|---|
| 가 · 값 범위 | 구매를 읽는 자리마다 들어올 수 있는 값(음수 금액 · 표식 없는 옛 행) | G1 · G2 |
| 나 · 값이 그려지는 화면 | 생산자(서버 값 · 서버 문구)를 적고 그 값을 그리는 화면 문구를 안 적음 | G3 · G4 · G5 |

## §1 결함 장부(1회차)

| # | 결함 | 코드 사실 | 고객에게 닿는 것 | 뿌리 |
|---|---|---|---|---|
| G1 | 매장 원장 음수 금액 행(환불 · 반품) = 구매 | `normalizeAmount` 음수 통과(`normalize.ts:409`) · 원장을 구매로 읽는 자리 전부 금액 거름 0(사실 CT-D2 · 커서 · 상품 · 목표 · 조건 · 성과 · 요약) | 반품한 고객이 구매 감사 · 재구매 여정에 들어감 · 요약 횟수 +1 · 최근 구매일 = 반품 날 | R22 넓힘 |
| G2 | 표식 없는 옛 결제(0610 전)가 배송 중으로 바뀌면 구매에서 빠짐 | 상태만 바꾸는 갈래(`cdp-orders.ts` 3-C)가 status 를 덮음 · `netPurchaseSql` = 표식 또는 status 결제(paid · completed) | 그 주문이 진입 · 목표 · 성과 · 요약에서 사라짐 · 뒤 취소가 와도 차감 안 함 | R22 넓힘 |
| G3 | 자동마케팅 시작 창 「실행 중 화면의 [정지]로 그 회차만 멈출 수 있어요」 | 실행 중 카드에 정지 없음(승인 · 지금 실행 · 수정 · 중단) · 실제 = 「승인할 제안」 예약 회차 카드 [자동 발송 정지](`ProposalDecisionCard.tsx:339`) | 멈추려는 사람이 단추를 못 찾음 | R55 새로 |
| G4 | 자동마케팅 성과 문구가 자사몰만 말함 · 매장 당일 안내 없음(C99-F1) | 관문 = 몰 또는 원장(`automarketing-roi.ts:138`) · 화면(`ContinuousOperatorPage.tsx:736`) = 「자사몰 연동 후」 · 서버 `source` 의 당일 안내는 출처 줄 0 규칙으로 안 그림 | 매장만 쓰는 회사가 몰 연동이 필요한 줄 앎 · 귀속 숫자 해석 근거 빠짐 | R55 |
| G5 | 지도 응답 `notices` 를 어떤 화면도 안 그림 · 매장 구매 「하루 모아 다음 날 오전」 안내가 화면에 없음(C99 §12 T8) | `journeyNotices` → `MapJourney.notices` · 작업 화면 · 카드 소비 0 · `purchaseDoor` 는 `JourneysPage` 상태에 받아 두기만 | 매장 구매 여정이 「바로」라고 보이는데 다음 날 9 ~ 12시에 들어감 | R55 |

## §2 처방(정답 1개씩)

- **G1 — CT-D6 원장 구매 행**(`two-door-purchase.ts`): `ledgerPurchaseRowSql(p)` = 금액 없음 또는 0 이상(몰 0원 결제와 같은 뜻 = 0원도 구매) · `LEDGER_PURCHASES_SQL` = 구매 행만 고른 단순 부분 질의(FROM · JOIN 자리에 `purchases` 대신 · 플래너가 펼쳐 색인 그대로).
  - 원장을 구매로 읽는 자리 전부 = CT-D6 를 지난다(사실 CT-D2 · 같은 구매 CT-D1 의 그날 합계 · CT-D4 · 커서 · 장바구니 · 조회 뒤 산 사람 거름 · 상품 목록 · 상품 목표 · 플래너 상품 산 사람 · 성과 원장 주문 · 관문 · 데이터 판정).
  - 요약 칸: 횟수 · 최근 구매(날짜 · 금액 · 매장) = 구매 행만 · **누계 금액 = 순액**(환불 행 금액을 더함 · 0 아래로 안 내려감 · 몰 취소 차감과 같은 뜻). 매장만 회사 = `ledgerSummaryAggSql` · 두 문 회사 CT-D3 = 사실 합 + `ledgerRefundTotalsSql`.
  - 그대로 두는 원장 날것 읽기(이유): 회사 갈래 · 전환 패스 = 「원장 문에 행이 왔나」(환불 행도 순액에 쓰여 그 고객을 다시 세야 한다 · `companyLedgerExistsSql` 한 조각) · 문 도착 시각(`journey-purchase-ledger.ts` = 어느 행이든 도착) · 구매 이력 화면(`purchase-history-source.ts` = 원장 행 기록 그대로 · 고객 화면 = 범위 밖 기능).
  - 한계(데이터 · 숨기지 않음): 환불 행은 어느 구매를 무른 것인지 잇는 열이 없다 → 그 구매는 구매로 남는다(누계 금액만 순액) · 매장 시스템이 취소를 행 삭제 · 상태 칸으로 남기면 싱크가 싣지 않아 볼 수 없다.
- **G2** — 3-C 에서 옛 결제(표식 없음 · 기록 당시 결제)면 `revenue_applied: true` 를 같은 문장에서 박는다(그 순간의 판정 = `isRevenueApplied` 그대로 굳힘 · 쓰기 자리는 이 함수 하나 = `UPDATE cdp_events` 전수 grep 1104).
  - 이미 덮인 행 = 상태 이력이 없어 되살릴 수 없다 → 배포 앞 확인 SQL(C102-S0 ①) · 0 이 아니면 그 행을 Harold 보고 뒤 따로.
- **G3** — 문구 = 「예약된 회차는 「승인할 제안」의 회차 카드에서 [자동 발송 정지]로 그 회차만 멈출 수 있어요.」 · 계약 = 문구 속 단추 이름이 그 카드에 실제로 있다.
- **G4** — ROI 응답에 `purchaseDoors: { mall, ledger }`(이미 센 두 값) · 화면 = 들어온 문을 그대로(「자사몰 주문 · 매장 구매」) · 원장 문이 있으면 「매장 구매는 날짜로 세어 발송 당일 발송 전에 산 것이 섞일 수 있어요」 · 데이터 없음 = 「매출 귀속은 자사몰 주문이나 매장 구매 기록이 들어온 뒤 표시됩니다」.
- **G5** — `journeyNotices` 가 원장 문을 받는다: 구매 계열 여정(`usesPurchaseLedger` · 상품은 그 여정 문이 매장일 때) + 회사 원장 문에 도착 기록이 있으면 「매장 구매는 하루 모아 다음 날 오전 9시 ~ 12시에 이 여정에 들어와요」(시각 = `LEDGER_RUN_*_HOUR_KST` 상수) · 작업 화면 시작 칸에 `notices` 를 그린다.

## §3 계약 시험(기계 추출 · `c102-structural-contract-1104.test.ts`)

- K1 원장 날것 읽기: 백엔드 소스(시험 제외) 전수 `(FROM|JOIN) purchases` = CT 파일 밖은 이유 붙은 허용 목록(파일 · 개수 · 이유)뿐 · 새 자리가 생기면 빨간불.
- K2 성과 화면: 귀속 문구가 `purchaseDoors` 를 읽는다 · 「자사몰 연동(구매 데이터 수집)」 글자 0.
- K3 지도 `notices`: 작업 화면이 그린다 · 서버 `journeyNotices` 원장 문 줄(단위).
- K4 3-C 갈래: 옛 결제 표식 굳힘(소스) + 실 PG.
- K5 화면 문구 속 단추 이름 = 그 단추가 있는 파일에 실제로 있다(G3).

## §4 실 PG(`c102-structural-1104.pg.test.ts`)

음수 행 = 진입 0 · 사실 0 · 요약 횟수 그대로 · 누계 순액 · 상품 목록 0 · 성과 주문 0 / 옛 결제 → 배송 중 = 사실 1 그대로 · 뒤 취소 = 차감.

## §5 배포 앞 확인(C102-S0 · Harold 실행)

① 표식 없는 옛 결제가 결제 아닌 상태로 덮인 행 수 ② 음수 금액 원장 행 수(회사별 · 고객 있는 행 · 그 고객 수) — 0 이면 옛 계산이 반품을 구매로 센 요약이 없다(보정 없음). 0 이 아니면 그 회사가 요약 칸을 원본으로 주는지(고객 요약 원본 값 칸 summary_source · 에이전트 요약 매핑)를 함께 보고 보정 길을 그 데이터로 정한다(Codex 2R — 적재 맥락 없이 요약을 다시 쓰는 일괄 보정은 원본 소유 칸을 덮는다 · 정상 적재가 그 고객을 다시 셀 때는 원본 소유 칸 규칙 그대로 새 규칙이 들어간다).

확인 SQL(읽기만 · 서버 창에서 하나씩 · 원장 C102-S0):

- ① G2: `SELECT company_id, COUNT(*) FROM cdp_events WHERE event_name = 'purchase' AND NOT (properties ? 'revenue_applied') AND COALESCE(properties->>'status', '') NOT IN ('paid', 'completed', 'cancelled', 'refunded') AND COALESCE(properties->'revenue_reversed', 'false'::jsonb) <> 'true'::jsonb GROUP BY company_id;`
- ② G1: `SELECT company_id, COUNT(*) AS rows, COUNT(DISTINCT customer_id) AS customers FROM purchases WHERE total_amount < 0 GROUP BY company_id;`
- ③ G6: `SELECT company_id, COUNT(*) FROM purchases WHERE purchase_date > (NOW() AT TIME ZONE 'Asia/Seoul') GROUP BY company_id;`
- ④ G6 · G8: `SELECT company_id, COUNT(*) FROM customers WHERE recent_purchase_date > (NOW() AT TIME ZONE 'Asia/Seoul')::date GROUP BY company_id;`
- ⑤ G7: `SELECT company_id, COUNT(*) FROM purchases WHERE customer_id IS NULL AND created_at >= NOW() - INTERVAL '3 days' GROUP BY company_id ORDER BY 2 DESC;`
- ⑥ G7 (회사 id = ⑤ 첫 줄 · 읽기만): `EXPLAIN ANALYZE SELECT o.id FROM purchases o JOIN customers cu ON cu.company_id = o.company_id AND cu.phone = o.customer_phone WHERE o.company_id = '회사id'::uuid AND o.customer_id IS NULL AND o.created_at >= NOW() - INTERVAL '3 days' ORDER BY o.created_at, o.id LIMIT 1000;`

## §5-2 구조체크 2회차(1회차 처방 구현 뒤 · 같은 두 축을 다시 기계로)

| # | 결함 | 코드 사실 | 고객에게 닿는 것 | 처방 |
|---|---|---|---|---|
| G6 | 미래 날짜 원장 행 = 지금 구매 | 적재가 구매일을 거르지 않는다(`routes/sync.ts` 1100 ~ 1125 · 미래 거름 0) · CT-D4 「이 시각 뒤에 샀나」 = 구매일 > 진입(미래 = 늘 참) · 「지난 N일」 = 구매일 ≥ 오늘 − N(미래 = 늘 참) · 사실 · 요약 최근일 = 미래 날 · 진입 커서만 「오늘까지」 거름 | 매장 시스템 날짜 오타 한 줄이면 그 고객 구매 목표가 늘 「샀음」 = 여정이 첫 칸 전에 끝남 · 「안 산 고객」 조건 갈래를 못 탐 · 최근 구매일이 미래 | CT-D6 구매 행 = 구매일이 없거나 KST 지금 이전(진입 커서와 같은 경계) · 그 날이 오면 읽는 자리마다 저절로 구매가 된다 |
| G7 | 고객보다 먼저 온 매장 구매 = 영원히 고객 없음 | 적재 = 그 순간 번호로 고객 id 조회 · 없으면 customer_id NULL 로 저장(`routes/sync.ts` 1138 ~ 1150) · 그 행을 나중에 고객에 잇는 쓰기 0(`UPDATE purchases` 전수 grep 1104 = 0) · 몰 사건은 고객 연결 때 도착 시각을 지금으로(`cdp-events.ts:561` · `cdp-identity.ts:373`) | 매장에서 처음 산 새 고객(고객 동기화보다 구매가 먼저 오면) = 요약 0 · 첫 구매 · 구매 감사 여정 진입 0 | 안전망 패스(전환 패스와 같은 5분 주기 · 같은 파일): 고객 id 없는 최근 원장 행 = 같은 회사 · 같은 번호 고객에 잇고 도착 시각 = 지금(몰 사건 연결과 같은 규칙 · 진입 커서 창 = 구매일이 그 창 안일 때만 진입) · 이은 고객 요약 = 갈래대로 다시 셈(회사 잠금) · C101 파일(sync.ts · customer-upsert.ts) 안 건드림 |

| G8 | 원본(싱크 고객 · 엑셀)이 고객 최근 구매일을 미래로 주면 그대로 저장 | 고객 업서트 `customer-upsert.ts` 최근 구매일 = GREATEST(원본, 지금 값) · 미래 거름 0 · 한 번 들어가면 내려가지 않음 | 휴면 · 재구매 창 · 「최근 구매 N일」 조건 · 대상 추출이 그 고객을 늘 「최근에 산 고객」으로 본다 | 쓰는 자리 한 곳(업서트 행 정규화)에서 미래 최근 구매일 = 값 없음(CT-D6 의 kstNotFutureSql 와 같은 판정) · 이미 들어간 미래 값 = 배포 앞 확인 SQL 뒤 보정 · **C101 작업 파일이라 C101 커밋 뒤 이 세션이 고친다**(Codex 4R 에서 목표 판정 · CT-D3 원본 최근일 · 옮기기 세 자리는 먼저 막음) |

### 3회차(G6 · G7 처방 뒤)

| # | 결함 | 코드 사실 | 고객에게 닿는 것 | 처방 |
|---|---|---|---|---|
| G9 | 몰 결제 시각이 미래 = 지금 구매 | 사건 기록 경로는 미래 시각을 지금으로(`cdp-events.ts` clampOccurredAt · 5분 허용) · 주문 CT 의 승격 · 되살림 occurred_at · 요약 최근일(paidDay)은 날것(`cdp-orders.ts` paidAt) | 몰 시계 · 시간대 오류 한 건이면 그 고객이 진입 뒤 늘 「샀음」 · 요약 최근일 미래(G6 과 같은 축 · 몰 문) | 결제 시각 한 줄을 같은 규칙으로(clampOccurredAt(orderPaidAt(input))) · 네 자리가 같은 값 |

G8 넓힘(3회차): 원본 요약 값의 범위 = 미래 최근 구매일뿐 아니라 음수 구매 횟수 · 누계도 같은 자리(업서트 행 정규화)에서 막는다(C101 커밋 뒤).

2회차 기록(결함 아님 · 이유): 지도 응답 칸 중 화면이 안 읽는 것 = autoReentry · canNewVersion · lineageId · pendingGoalExit · 선의 fromTrigger · toLabel(설계상 「새 판」 단추 없음 · 표시 안 함) — 죽은 계산(pendingGoalExit = 지도 열 때마다 셈)은 정리 과제로 기록만. 성과 보고서 PDF(`performance-pdf-render.ts` 「CDP 구매 · 자사몰 연동(CDP) · Data source」) = AI 분석 기능(C99 §3 범위 밖) · [범위 밖] 기록.

## §6 진행

| 단계 | 상태 |
|---|---|
| 구조체크 1회차(두 축) | 끝 · G1 ~ G5 |
| 구현 · 계약 · 실 PG | 끝(계약 12 · 실 PG 8 · 변이 G1 · G2 · G4 빨간불 확인 · 전체 tsc 0 · 0 · vitest 757 / 11,465 · 실 PG 53 / 367) |
| Codex 1회차 묶음(G1 ~ G5) | 1R 1 · 2R 1(같은 뿌리 = 구조 수정) · 3R **approve** |
| 구조체크 2회차 · 처방(G6 · G7) | Codex 1R 3 · 2R **approve** |
| 구조체크 3회차 · 처방(G9) | Codex 1R **approve** |
| 계약 시험 K6 · K7 | Codex 1R 4 · 2R 3 · 3R 1(장치를 꺼도 통과 · 꼴 바꿈에 깨짐 = 주석 뺀 본문 · 선언 경계 · 가짜 run 동작 검사) · 4R **approve** · 시나리오 일곱 + RETURNING 삭제 = 기대대로 |
| 구조체크 4회차 | 새 코드 결함 0(두 축 다시 기계로) · 남은 = G8(C101 커밋 뒤) |
| 최종 수치 | tsc 0 · 0 · vitest 757 / 11,472 · 실 PG 53 / 374(스탬프) · 계약 c102 19 |

## §7 Codex 기록

| 라운드 | 지적 | 처리 |
|---|---|---|
| 2묶음 1R(G6 · G7) | 3 = medium · 전부 수용 | 미래 요약일 목표 우회 · legacy 보존 → 미래 판정 한 곳 kstNotFutureSql(목표 요약 항 · 원본 최근일 · 옮기기) · 매장 누계 미래 행 → FILTER · G7 재연결이 오래된 구매를 가입 묶음으로 → 구매일 ≥ 고객 생성 KST 날짜 |
| 2묶음 2R | 0 · **approve** | — |
| 3묶음 1R(G9) | 0 · **approve** | — |
| 계약 1R ~ 4R(K6 · K7) | 4 · 3 · 1 · 0 | 장치를 꺼도 통과(주석으로 끈 조건 · 소비 자리 미검사 · 요약 인자 미검사 · CTE 조건을 UPDATE 재확인이 대신 · 잠금 SELECT 로 통과 · RETURNING 누락) · 꼴 바꿈에 깨짐(고정 문자열 · 줄바꿈) → 주석 뺀 본문 · 선언 경계 · 공백 정규화(양쪽) · 가짜 run(잇기 상수 · 요약 UPDATE 인자) · **approve** |
| 2R(1104 · 증분) | 1 = medium · 수용 · **같은 뿌리 두 번째 = 구조 수정** | 일회 보정이 keepColumns 없이 매장 요약 5칸을 원장 집계로 덮는다(원본이 누계 · 횟수를 주는 회사) → **왜 반복되나**: 요약 칸을 쓰는 작성자를 적재 맥락(원본 소유 칸) 밖에 하나 더 만들었다(C99 2R 「작성자 여럿 · 규칙 다름」과 같은 뿌리) → 일회 보정을 지웠다(덧댄 장치 제거 · 코드 줄어듦) · 옛 데이터 = 배포 앞 C102-S0 ② 로 크기를 보고 그 데이터로 보정 길을 정한다 · 1R 의 반품 날 거름(옮기기 차단)은 그대로 |
| 1R(1104 · 전체) | 1 = medium · 수용 | 옛 계산(반품을 구매로 셈)이 남긴 칸 최근일이 두 문 전환 첫 CT-D3 옛 값 옮기기로 원본 값(recent legacy)에 굳는다 → 그 날이 원장 환불 행으로 설명되면 옮기지 않음(`ledgerRefundOnDaySql`) · 실 PG 회귀(거름을 꺼 보면 빨간불) · (일회 보정은 2R 에서 지움) |
