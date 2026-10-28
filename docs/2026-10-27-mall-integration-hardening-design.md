# 자사몰 연동 · 첫 실고객 전 대비 설계서 (2026-10-27)

> 호출어 **"자사몰 대비 설계 / 자사몰 구조체크"**. 이 문서가 결정(K1~K15) · 불변 원칙 · DDL · 데이터 · 영향표 · 묶음 순서 · 시험 · 리허설 · 진행표를 소유한다.
> 출발 = 구조체크 원장 [2026-10-27-mall-integration-structure-check.md](2026-10-27-mall-integration-structure-check.md)(결함 M1~M38 · 특이요인 F1~F22 · 덮음표 · 리허설 표) · 회의 = 1027 브레인스토밍 1회(Harold 발동 · 요지 §10).
> 기능 상설 = [FEATURE-CDP-INTEGRATION.md](FEATURE-CDP-INTEGRATION.md) · 뿌리 = [ROOT-LEDGER.md](ROOT-LEDGER.md).
> 상태 = 설계 닫힘(Codex 적대 8R approve · 구조체크 10회차 결함 0 · 1027) · **Harold 승인(1027) · 묶음 0 · A 구현(1027) · Codex 적대 구현 리뷰 2R approve · 커밋 · DDL · 배포 전**. 닫는 순서(Harold 1027 「브레인스토밍 진행하고 나서 나온 설계안을 코덱스 적대리뷰 돌려서 닫힐때까지 체크하고 또 구조체크 돌려서 결함닫힐때까지 그건 네가 직접 설계안을 닫아」) = Codex 적대 리뷰 approve → 구조체크 결함 0 → Harold 승인 → 구현.

## §0 원래 안건 · 범위

- **원래 안건(첫 줄 고정)**: 「자사몰 연동을 첫 실고객 연동 전에 완벽하게 가다듬을 구조 1개」. 실연동 = 이에스페이먼츠(우커머스 4몰) 1곳 · 카페24 · 고도몰 · 아임웹 · 메이크샵 · 네이버 · 자체호스팅은 시험 몰로만 확인(Harold 1027).
- **범위** = 원장 결함 M1~M38 전부 + 회의 중 새로 나온 것(프론트 N1~N5 · 놓친 축) · 대상 = 백엔드 적재 CT · provider 어댑터 · 수신 라우트 · 워커 · 여정 구매 판정 · 연동 화면 · 슈퍼관리자 감시 · 워드프레스 플러그인.
- **범위 밖(기록 · 착수 = Harold)** = §9.

## §1 불변 원칙 (이 설계가 세우는 것)

| # | 불변 | 닫는 결함 |
|---|---|---|
| I1 | `purchase` = **결제된 적 있는 주문 한 행**. 결제 전 · 결제 실패 · 취소가 먼저 온 주문 = `order_placed`. 승격은 한 방향 | M1 · M26 |
| I2 | 사건 시각 = 원천 시각(결제 시각 · 주문 시각 · 삭제 시각). **NOW 로 메우지 않는다**(모르면 「시각 모름」 사유) | M1 · M2 |
| I3 | 값 쓰기(주문 상태 · 동의)는 그 자원에서 **본 것 중 가장 늦은 원천 시각 이상**일 때만. 같은 시각이면 위험이 적은 쪽만 반영(주문 = 취소 · 환불 · 동의 = NO · K1-6 · K2-2). 원천 시각이 없는 provider 는 취소 · 환불 상태를 한 번이라도 본 주문의 뒤 결제 스냅숏을 승격 · 매출 0 으로(종결 규칙이 시각 비교보다 먼저 · K1-6) | M2 · M22 |
| I4 | 동의 입력: 회원 경로가 있는 몰은 회원 정보만 진실 · 비회원 주문 동의는 그 고객에게 그 몰의 회원 연결이 없을 때만 · 뜻이 확인되지 않은 칸은 쓰지 않음 · 한 고객에 같은 몰 회원 연결이 둘 이상이면 YES 를 거절하고 NO 만 받음 | M2 · M16 |
| I5 | 식별 신뢰 등급: 서버 회원 정보(profile) > 서버 주문(order · 빈 칸만) > 브라우저(연결만 · 값 쓰기 0) | M5 · M6 |
| I6 | 카페24 · 아임웹 웹훅 수신 자격 = 연결됨 + 해제 아님 + 토큰 만료 유예 안. 토큰은 주기 워커가 살린다. 유예가 끝나도 상태를 해제로 바꾸지 않는다(수신만 0 · 알림) | M3 · M31 |
| I7 | 탈퇴 근거 = 삭제 웹훅 · 단건 조회 404 둘뿐(목록 부재 아님). 처리 = 그 몰 소속 동의 **명시 NO** · 원천 시각 = 삭제 시각 | M4 |
| I8 | 수집 문 = 사실(회원 · 주문) / 행동(브라우저 · 인앱) 분리. 요금제 판정은 `ACTIVE_PAID_PLAN_WHERE` 한 벌. 사실 = 활성에서 빠진 뒤 90일까지 · 월 한도 = 행동만 | M8 · M9 |
| I9 | 외부 회원 · 주문 번호의 몰 접두 = 연동 행을 만들 때 고정 · 재연결 · 재저장이 바꾸지 못함 | M38 |
| I10 | 몰 서버 호출 = 공용 SSRF 가드 · 몰 자격 = 암호화 저장 · 플러그인 키 = 몰 하나 · 회원 토큰 발급만 | M13 · M14 · M34 |
| I11 | 연동 화면 상태 = 서버 분류(`transient` · `action` + `cause`) · 화면은 그리기만 · 임계값 판정 0 · 데이터 문장은 사실(마지막 데이터 날짜) | M10 · M23 · M31 · N1 · N2 |
| I12 | 화면 · 영업 자료가 「자동 · 됩니다」라고 말하려면 준비도 표 그 단계가 `test` 이상(`live` 만 「검증됨」) | M16~M19 · 기획 지적 §2-8 위반 |
| I13 | 웹훅 = 서명 검증 → 기록 → **즉시 200** → 처리는 뒤. 넣을 수 없는 건(휴대폰 없음 · 형식)은 그 건만 건너뜀(장애 아님) | M27 · 놓친 축 9 |
| I14 | 백엔드 프로세스 1개 전제 = 시험으로 고정 · 메모리 잠금 목록을 이 문서가 소유(§9-2) | 놓친 축 10 |
| I15 | 한 회사의 몰 연동 행은 모두 분류코드가 있거나 모두 없다(만드는 순간 판정 · 해제 행 포함) | F16 · M7 · 구조체크 SC1 |

## §2 결정 (K1~K15 · 회의 수렴 + 최종 검증 수정 반영)

> 「검증 수정 n」 = 회의론자 최종 검증의 깨지는 지점 n 을 막은 형태(§10).

### K1 구매 사건 (M1 · M21 · M22 · M26)
1. **이름**: `cdp-orders.ts syncOrder` 4단계(매출 변화 없는 신규 기록)가 `purchase` 대신 `order_placed` 를 쓴다. 기존 행 조회(130~139)는 `event_name IN ('purchase','order_placed')`.
2. **승격**: 3-A 표식 선점 UPDATE(169~179) 한 문장이 `event_name = 'purchase'` · `occurred_at = 결제 시각` · `properties.first_arrived_at = 옛 created_at` · `created_at = NOW()` 를 함께 쓴다(표식을 실제로 선점한 행만 · 승격 = 처음 결제된 순간 = 도착).
   - **중복 진입은 이름 표식이 아니라 실제 진입 기록으로 막는다**(Codex R1 #4 · 검증 수정 1 을 대체): 여정 진입 행은 0929 부터 진입 사건 id 를 남긴다(`journey-trigger-watcher.ts:557-560` `entry_event_properties.__entry = { src: 'trigger', key: 사건 id }`). `src = 'trigger'` 표식을 쓰는 자리는 이 한 곳이다(1027 grep · 795~808 일괄 INSERT 는 다른 시작 경로라 대상 아님 · Codex R2 #2 정정). 거름은 두 겹이고 둘 다 이미 있는 「앞 여정(after) 표식」 거름의 꼴을 따른다(추출 `journey-target-extractor.ts:458-492` + 잠금 안 다시 보기 `journey-trigger-watcher.ts:797-805`).
     - ① **사건 행 단계**(Codex R2 #3): 커서가 사건 행을 읽는 `selectCdpEventRowsForCursor`(`journey-target-extractor.ts:683-696`)에 「그 사건 id 가 이 여정 계보에서 `__entry.src = 'trigger'` · `key` 로 이미 쓰였으면 그 행을 뺀다」를 더한다(`journey_executions` 의 customer_id 색인으로 찾음). 고객별 대표 사건(`planCdpCursorBatch` · 첫 행)은 빼고 남은 행에서 고른다 → 이미 들어간 A 가 먼저 오고 아직 안 들어간 결제 B 가 뒤에 와도 B 로 한 번 들어간다. 뺀 행도 커서는 지나간다(이미 쓰인 사건).
     - ② **잠금 안**(Codex R2 #2): 트리거 진입 반복문(`journey-trigger-watcher.ts:548-561`)에서 계보 잠금(`lockLineageEntry`) 뒤 · 교체 닫기(550)와 쿨다운 판정보다 **먼저** 그 고객의 대표 사건 key 가 계보에 이미 있으면 건너뛴다(skipped). 교체 모드가 옛 실행을 닫은 뒤 같은 사건으로 다시 넣는 순서를 막는다.
     - 결과: 승격으로 커서를 다시 지나는 사건은 이미 그 사건으로 들어간 고객을 다시 넣지 않고, 결제 전에는 들어간 적 없던 주문은 결제 순간 한 번 들어간다. `renamed_from` 은 되돌림 표식으로만 남고 승격 규칙이 읽지 않는다.
   - **결제 시각 계산 하나**(Codex R1 #5): `orderPaidAt(input) = input.paidAt ?? input.orderedAt`(cdp-orders.ts 안 한 함수)을 3-A 신규 기록(181~188 · 처음 본 주문이 이미 결제됨) · 승격 UPDATE · RFM 날짜 세 자리가 쓴다. 두 유입 순서(결제 전 → 결제 / 처음부터 결제)의 `occurred_at` 이 같아야 한다(§6 짝 시험).
   - **표식 · 사건 · 고객 요약 = 한 트랜잭션**(Codex R1 #1): 지금은 표식 선점 → 고객 요약 UPDATE 가 따로라 그 사이에 프로세스가 끝나면 표식만 남고(되돌림 catch 는 실행되지 않음) 재처리가 「이미 반영」으로 건너뛰어 매출이 영영 빠진다. 3-A · 3-B 를 `withTransaction`(`config/database.ts:65`)으로 묶고, 사건 INSERT 는 `trackOrderEvent(run, …)` 가 같은 연결로 쓴다. `releaseMarker` 는 지운다(롤백이 대신함). 트랜잭션 밖 = `fuseEventToCustomer` 같은 커밋 뒤 부수 작업. `withKeyedLock` 줄 · 조건부 선점 UPDATE(프로세스를 넘는 경합)는 그대로. `identifyCustomer`(106~116)는 트랜잭션 밖에서 지금처럼 먼저 돈다(고객 · 연결 생성은 그 함수의 문장 · 트랜잭션이 잡는 것은 주문 사건과 고객 매출뿐).
3. **결제 시각 통로**: `OrderInput.paidAt?` 신설 · 우커머스 = `date_paid_gmt`(이미 읽음 `woocommerce-core.ts:329`) · 그 밖 provider = 원문 확인 전 주문 시각(§7 리허설 · K13 「결제 확정 신호」 등급).
   - **시각 대체 자리 전수**(1027 grep `|| new Date().toISOString()` · 운영 소스): 주문 시각 = cafe24-client 729 · 748 · imweb-client 473 · 515 · custom-self-hosted-adapter 128 · 145 · naver-commerce-client 581 / 이벤트 시각 = cafe24-client 761 · 785 · imweb-client 438 · 454 · 492 · 527 · custom-self-hosted-adapter 158 · naver-commerce-client 597.
   - 대체 규칙 하나: 웹훅 처리 = 받은 시각(`ctx.observedAt` · 전달 행 created_at · 재처리 때도 같은 값) / 가져오기 · 주기 수집 = 그 건 건너뜀(「시각 모름」 · K11 skip). NOW 대체 0(I2).
   - 취소 · 환불 본문의 `orderedAt` 은 지금 취소 시각을 싣는다(cafe24-client 748 · custom-self-hosted-adapter 145). 그래서 아래 5 의 날짜 비교는 이 값을 쓰지 않는다.
4. **RFM 날짜**: 반영 UPDATE(192~210)의 날짜도 같은 결제 시각(KST 날짜 · R16)(검증 수정 2).
5. **M21 되돌림**: 차감 갈래 UPDATE 에서 최근 구매일 · 금액 · 마지막 구매일이 **기존 purchase 이벤트의 occurred_at(KST 날짜)** 과 같을 때만, 남은 순매출 purchase **와 `purchases` 원장**의 MAX 로 되돌린다(검증 수정 2 · 두 문 합산 = `journey-target-extractor.ts:799-808` 이전 구매 판정과 같은 규칙).
6. **늦게 온 옛 스냅숏(I3)**: 주문 이벤트 properties `src_at` + CT 의 provider 표 `srcKind: 'source' | 'received'`(검증 수정 3). source = 우커머스 `date_modified_gmt`(상태 변경 때 바뀌는지 원문 1건 확인 · §8 S11). received = 받은 시각(웹훅 = 전달 행 created_at · 재처리 = 그 행 created_at · 주기 수집 = 그 쪽을 읽은 시각 · `processWebhookEvent(…, ctx: { observedAt })` 배관). 비교 규칙(한 함수 `orderSnapshotVerdict(last, incoming) → 'apply' | 'stale'` · 3-A · 3-B · 3-C · 4단계 모든 갈래가 쓰기 전에 지난다 · received 종류의 본문 `src_at` = `ctx.observedAt`):
     - 본문 `src_at` < 마지막 `src_at` = stale(상태 갱신 · 승격 · 되살림 0).
     - 같을 때 = 취소 · 환불 본문만 apply · 그 밖은 stale(동률에서 취소가 이김 · Codex R1 #3 · 우커머스 `date_modified_gmt` 는 초 단위라 동률이 생김).
     - 더 늦을 때 = apply. 단 아래 종결 규칙이 먼저다.
     - 판정은 앱에서 하고, 쓰는 UPDATE 의 WHERE 에 같은 조건(그 행의 마지막 `src_at` · `cancel_seen_at`)을 다시 건다(구조체크 SC9 · R12 · 판정에 쓴 값이 저장 때까지 같음을 문장이 확인 · 0행이면 stale).
   - **종결 규칙(두 종류 공통)**: 취소 · 환불 상태를 한 번이라도 기록한 주문은 `properties.cancel_seen_at`(그 본문의 `src_at`)을 남긴다(3-B · 3-C · 4단계 어디서든 · 지우지 않음). 그 뒤 결제 본문의 승격 · 매출 · 되살림(M22) = source 종류는 `src_at` > `cancel_seen_at` 일 때만 · received 종류는 0. 결제 전 취소가 먼저 오고 옛 결제 본문이 늦게 오는 순서(지금은 `revenue_reversed` 가 없어 매출이 더해짐)를 두 종류 모두에서 막는다. received 종류 몰에서 같은 주문 번호로 진짜 재결제 = 매출 누락 쪽(안전 방향 · §9-1).
   - **결과 통로**: 옛 본문이라 쓰지 않은 호출 = `syncOrder` 결과 `stale: true` → `processWebhookEvent` 반환 `'stale'` → 수신 줄 · 재처리 워커가 그 전달을 `superseded` 로 닫음(K2-6).
7. **예약 이름**: 지금 브라우저 수집만 `purchase → checkout_complete` 로 바꾼다(`cdp-events.ts:335 BROWSER_EVENT_RENAME`). 이 표를 `RESERVED_EVENT_RENAME` 으로 이름만 바꿔 `trackEvent` 도 쓴다(서버 `/event` 구멍 · `routes/cdp.ts:299-315` · S1 = 최근 90일 우커머스 밖 0 = 기존 사용 0) · 바꿀 때 로그 1줄. 주문 CT 는 `trackOrderEvent(…, name: 'purchase' | 'order_placed')`(cdp-events.ts 안 · 이름 검사 · 바꾸기를 지나지 않는 내부 길)를 쓰고 이 함수 import = cdp-orders.ts 1(R22). `order_placed` 는 `STANDARD_EVENT_NAMES`(`cdp-events.ts:49` · SDK 사본 `sdk-js/src/auto-capture/events.ts:7` 과 1:1)에 넣지 않는다 → 밖에서 보내면 지금 검사가 거절한다(표준 목록 · SDK 불변).
8. **매출 조각 하나**: `cdp-order-revenue.ts netPurchaseSql(alias)` = purchase 이면서 표식 반영(옛 호환 `isRevenueApplied` 같은 규칙) · 차감 안 됨. 구매이력(`purchase-history-source.ts:30-32`) · 자동마케팅 성과(`automarketing-roi.ts:49-50` 「상태 없음 = 결제」 삭제) · 플래너 대상(`planner-audience.ts:197-204`)이 쓴다.
9. **`order_placed` 를 읽어도 되는 곳**: syncOrder · `journey-purchase-ledger.ts` 의 `isMallPurchaseDoorActive`(원장 문을 닫는 판정 · 결제 전 주문만 오는 동안 원장 문이 열려 같은 구매가 두 문으로 들어가는 것을 막음) · 같은 파일 `getPurchaseDoorStatus` 의 마지막 도착 시각 · 「주문 시도」 조각 `orderAttemptSql` = 장바구니 포기 · 둘러보고 안 삼 **제외 판정**(`journey-target-extractor.ts:188 · 234`) · 고객 360 타임라인 라벨. `isMallPurchaseDoorForJourneyStats`(전환 통계 문)은 purchase 그대로(통계 = 결제된 전환). 시작 · 목표 · 구매 문에는 넣지 않는다. 결제 전 이름은 `order` · `order.created` 금지(13파일이 `IN ('purchase','order')` 로 구매로 셈).
10. **화면 라벨**(같은 커밋): 고객 360 타임라인 「주문 · 결제 전」(`customer-timeline.ts:501` 원문 노출 방지) · 장바구니 여정 시작 설명 「결제 전 주문이 있어도 보내지 않아요」.
11. **기존 6,064건**: 코드 배포 **뒤** DML 1회(Harold 실행 · §3 DML-1) = 대상 술어 **P_unpaid** 에 맞는 purchase 행만 `order_placed` + `renamed_from: 'purchase'` · created_at 그대로 · 앞뒤 S1. 반영된 44 · 273 · 135행은 그대로.
   - **P_unpaid** = `event_name = 'purchase' AND NOT (properties ? 'revenue_applied') AND NOT (properties ? 'revenue_reversed') AND COALESCE(properties->>'status', '') NOT IN ('completed', 'paid') AND created_at >= '2026-06-10 00:00:00+09'`.
   - 날짜 조건 = 표식 도입(CT-86 · 2026-06-10) 전 행 격리(Codex R1 #8): 그 전 행은 표식 없이도 결제 상태였으면 반영된 것으로 인정되는데(`cdp-order-revenue.ts:49-55`), 뒤에 결제 전 상태 본문이 와서 상태 글자만 바뀌었으면(3-C) 결제 이력을 잃은 채 술어에 걸린다. 표식 도입 뒤 행은 결제를 지나면 반드시 `revenue_applied` 키가 생긴다(3-A 두 갈래 모두). 격리된 행 수 = §8 S13 · 0 이 아니면 그 행은 원천 주문 상태로 하나씩 판정한다(일괄 이름 변경 밖).
   - `revenue_applied = false` 행은 대상 밖: 결제 상태로 반영을 시도했다가 고객 요약 갱신이 실패해 표식을 되돌린 행이라(지금 cdp-orders.ts releaseMarker · K1-2 뒤로는 롤백이라 새로 생기지 않음) 결제된 주문이다(I1). 키 존재로 판정하는 `customer-purchase-aggregates.ts:45-51` 의 「CDP 가 요약을 쓰는 회사」 판정도 이 술어라야 바뀌지 않는다.
12. **완료 기준(묶음 A)** = P_unpaid 행 0(검증 수정 4 · 옛 호환 규칙 = `isRevenueApplied` 와 같은 뜻) + 주문당 purchase 1행(부분 유일 색인은 §3 S9 중복 0 확인 뒤).
13. **시험 · 수기 주문**: 우커머스 `created_via` 원문 확인 뒤 결정(§8 S12) · 그 전은 지금과 같다.
14. 계약 **R22 신설** = §6.

### K2 값의 시계 · 동의 (M2 · M12 · 재처리 순서)
1. **입력 규칙(I4)**: 우커머스 `applyWooResource` 주문 갈래의 별도 identify(1006~1020)와 고도몰 별도 identify(`godo-client.ts:159-169`)를 지운다. 동의는 `OrderInput.smsOptIn` · `consentAt` 으로 syncOrder 한 호출에 실려 CT 가 판정: 그 몰의 회원 연결이 있는 고객 = 주문 동의 무시 · 없는 고객 = 원천 시각 = min(주문 생성 시각, 받은 시각). 고도몰 `smsFl` · 아임웹 동의 변경 웹훅 = 원문으로 칸 뜻 확인 전 쓰기 0.
2. **쓰는 문장 하나**: `mall-consent.ts upsertStoreConsent(…, sourceAt)` 와 `applyMissingConsentRule(…, sourceAt)` 이 같은 조건을 쓴다: `COALESCE(기존.consent_source_at, '-infinity') < EXCLUDED.consent_source_at OR (기존.consent_source_at = EXCLUDED.consent_source_at AND EXCLUDED.sms_opt_in = false)`(검증 수정 5 · NULL 시계가 명시 NO 를 거절하지 않게 · 같은 시각의 YES · NO 는 NO 가 이김 = 구조체크 3회차 · 주문 동률 규칙 K1-6 과 같은 방향).
   - 값이 다를 때 = `sms_opt_in` · `consent_source` · `consent_at`(동의 일자 · 증빙) · `consent_source_at` 갱신.
   - 값이 같을 때 = **`consent_source_at` 한 칸만** 앞으로(검증 수정 6 · 색인 없는 칸 = HOT 갱신 · K3 의 「바뀐 것만」은 고객 칸 · 동의 값 · updated_at 에만 적용).
   - 공란 규칙(「값 없으면 동의」)도 같은 문장에서 `consent_source_at = 그 회원 정보를 받은 시각`(NOW 아님).
3. **가족 번호(검증 수정 7)**: 그 고객에게 그 몰의 **다른** 회원 연결이 있으면 YES 쓰기 거절 · NO 만 받음(공란 규칙 판정 ② `mall-consent.ts:533-538` NOT EXISTS 를 뒤집어 씀).
4. **고객 행(분류코드 없는 회사)**: `customers.consent_source_at`(DDL-3) 칸을 두고 위 2 와 **같은 비교 CT** 를 쓴다(`mall-consent.ts` 한 함수가 두 표의 조건 조각을 만든다). 몰 경로의 고객 행 동의 쓰기(`cdp-identity.ts syncCustomerFields` · 비회원 주문 동의)는 이 조각을 지나야 한다. 조각이 거는 칸은 동의(`sms_opt_in` · 그 출처 · 시각)뿐이다. 같은 함수가 쓰는 전화 · 이름 · 이메일은 K4 등급 규칙을 따른다. 비회원 주문 동의는 고객을 만들 때와 NO 로 내릴 때만(위 1 의 회원 연결 판정과 같이).
   - 옛 처방(링크 `last_seen_at` 비교 · 검증 수정 8)은 버린다(Codex R1 #2): `last_seen_at` 은 주문 · 행동 이벤트마다 갱신되는 칸이라(`cdp-events.ts:168-171`) 동의 관측 시각이 아니다. 재대조가 t1 에 읽은 NO 가, t2 에 같은 회원의 주문이 `last_seen_at` 만 올렸다는 이유로 버려진다.
   - 몰 경로가 아닌 쓰기(업로드 · 싱크 · 관리자 수정)는 이 칸을 읽지도 쓰지도 않는다(지금과 같음 · 080 수신거부는 별도 목록이 발송을 막음 · 범위 밖 §9-3).
5. **수신 즉시 200(I13)**: 공용 CT `cdp-webhook-delivery.ts deliverWebhookToCompanies` 가 서명 검증 뒤 전달 행 INSERT('received') → 200 → 같은 프로세스 자원별 직렬 줄(`withKeyedLock` · 동시 수 · 길이 상한)에서 처리. 우커머스(`routes/woocommerce.ts:116-151`) · 자체호스팅(`routes/cdp.ts:478-520`) 인라인 기록을 이 CT 로 합친다(R1). 넘치거나 프로세스가 죽으면 received 로 남아 재처리 워커가 줍는다. 줄이 행을 처리하기 직전에도 아래 6 의 선점 문장을 지난다(워커가 먼저 잡았으면 줄은 건너뜀).
   - 연동이 없는 몰에서 온 웹훅(구조체크 SC3 · F9): 카페24 는 200 으로 받고 기록하지 않는다(몰 쪽 자동 차단을 피함 · `routes/cafe24.ts` 주석). 아임웹은 모르는 사이트 코드에 404(`routes/imweb.ts:53-55`)라 시험 사이트를 지운 뒤 · 해제 뒤 실패가 쌓이면 몰 쪽 정책이 웹훅을 끌 수 있다(정책 원문 미확인) → 카페24 와 같은 꼴(200 · 기록 0 · 로그 1줄)로 맞춘다. 아임웹 인증(공유 토큰 · `verifyImwebWebhook` 58~61)은 지금 연동 조회 뒤에 있어 순서를 바꿔 **인증을 먼저** 본다(인증 실패 = 401 그대로 · 인증 통과 + 연동 없음 = 200). 몰 쪽에서 웹훅이 꺼졌을 때 다시 켜는 길 = K10 침묵 신호 → 운영 문서의 몰별 재활성 절차(카페24 개발자센터 · 아임웹 파트너센터).
6. **재처리(검증 수정 9 · Q6 · Codex R2 구조 수정)**: 지금 재처리 워커는 `failed` + 10분 넘은 `received` 를 줍는다(`cdp-webhook-retry-worker.ts:32-46` · `oauth_state` 제외).
   - **왜 두 라운드 연속 이 자리에서 결함이 나왔나**: 수신 줄과 재처리 워커가 「이 행을 지금 누가 잡고 있고 언제 다시 시도해도 되는가」를 행에 적지 않고 각자 기억(메모리 집합 · 고정 주기 · 생성 시각)으로 판단한다. 1라운드에 그 위로 「비어질 때까지 배출」 · 「메모리 건너뛰기 집합」을 덧대자 서로 다른 시계가 생겨 같은 행 연속 재시도(R2 #1) · 줄에 든 행이 선두를 막음(R2 #4) · 소진 경보가 생성 시각을 봄(R2 #5)이 나왔다.
   - **구조**: 행 하나를 처리하려는 쪽(수신 줄 · 재처리 워커)은 모두 공용 CT `claimDeliveries` 의 **한 선점 문장**을 지난다. `UPDATE cdp_webhook_deliveries SET processed_at = NOW() WHERE id IN (SELECT id … WHERE 처리 가능 ORDER BY created_at LIMIT n FOR UPDATE SKIP LOCKED) RETURNING …`. `processed_at` = 마지막으로 잡은(시도한) 시각(지금도 처리 · 실패 · 중복 때 NOW() 를 씀 · 화면 · 진단에서 받은 행의 이 칸을 읽는 곳 0 = 1027 grep `routes/cdp.ts:2133` 은 값만 내려주고 프론트 사용 0).
     - 처리 가능 = `received` 이고 `COALESCE(processed_at, created_at) < NOW() - 10분`(잡힌 적 없이 10분 · 또는 잡고 10분 지나도 끝나지 않음 = 프로세스가 죽은 것) / `failed` 이고 `retry_count < MAX_RETRY` 이고 `processed_at < NOW() - 5분`(지금의 5분 주기 회복 여유 그대로 · 새 상수 없음) / 수신 줄은 자기 행 id 하나를 `received AND processed_at IS NULL` 조건으로 잡는다.
     - 그래서 한 회차에서 실패한 행은 `processed_at = NOW()` 가 되어 같은 회차 반복 선점에 다시 걸리지 않고(R2 #1), 줄이 잡은 행은 SQL 이 LIMIT 전에 뺀다(R2 #4 · 메모리 건너뛰기 집합은 만들지 않음 · §9-2 목록에서도 뺌), 두 쪽이 같은 행을 동시에 처리하지 않는다.
     - 한 회차 배출 = 선점이 0 을 돌려줄 때까지 반복 · 회차 시간 상한 4분.
   - 소진 경보(92~103) = 생성 시각이 아니라 **소진으로 바뀐 시각**(`status = 'failed' AND retry_count >= MAX_RETRY AND processed_at > NOW() - 1일`)으로 센다(R2 #5 · 나이 제한을 지운 뒤 다시 집힌 옛 행의 소진도 잡힘).
   - K1-6 결과 통로가 `'stale'` 을 돌려준 전달 = `superseded` 로 닫음(status varchar(20) · CHECK 유무 §8 S10) · 보관 정리 쿼리(같은 파일 127 · `status IN ('processed', 'duplicate')`)에 `superseded` 를 넣는다(넣지 않으면 그 행이 영구히 남음).
   - `oauth_state` 행(cafe24.ts:169 · imweb.ts:115 · woocommerce.ts:451)은 같은 표를 쓰는 OAuth 상태 저장이라 수신 CT 로 옮기지 않는다(R1 계약은 `oauth_state` 문장을 대상 밖으로 · 사유 줄).
   - **받았는데 처리 못 한 행은 나이로 버리지 않는다**(Codex R1 #7 · 즉시 200 으로 몰의 재전송을 끊었으므로 이 표가 유일한 사본): 선택 조건의 `created_at > NOW() - 7 days`(43) 삭제(실패 행은 `retry_count < MAX_RETRY` 가 끝을 낸다) · 원문 비우기(132~138)는 끝난 행만(`processed` · `duplicate` · `superseded` · 재시도를 다 쓴 `failed`)이고 기준 시각 = `COALESCE(processed_at, created_at)` 30일(끝난 뒤 30일 · 다시 집혀 방금 소진된 옛 행의 원문이 같은 회차에 비워지지 않음) · 적체 경보 = 30분 넘은 `received` 가 있으면 `sendSystemAlert`(dedup 키 `cdp-webhook-backlog` · 소진 경보 옆 · 건수 · 가장 오래된 시각).
   - 진단 화면 신뢰성(`cdp-diagnostics.ts:158-170`)은 `superseded` 를 처리됨으로 센다(지금 식은 총수에만 들어가 성공률이 내려감).
7. 계약 = R18 넓힘(§6).
8. **공란 규칙의 범위(구조체크 SC5 · F6)**: 「회원 정보에 동의 값이 없으면 동의」는 연동 행마다 켜는 선택 설정(`meta.consent_missing_agree_key`)이고 분류코드 몰에서만 걸린다(`cdp-identity.ts:436-449` · 지금 「값 없음」을 싣는 어댑터 = 우커머스뿐). 우커머스 밖 몰은 동의 칸 뜻을 리허설로 확인해 K13 「동의」 단계가 `test` 이상이 된 뒤에만 어댑터가 `profileConsentAbsent` 를 싣는다. 그 전 = 모름(발송 제외 · 덜 보내는 방향).

### K3 우커머스 회원 재대조 (D3 · M12)
- 별도 상태 키 `woo_member_reread`(`woo_backfill` 과 따로 · 주문 주기 수집 계속) · 자기 줄(전역 `backfillChain` 밖 · `woocommerce-client.ts:1253-1271`) · 동시 1 · KST 02~06시 · 7일에 한 바퀴(못 끝내면 다음 밤에 이어 감) · 429 · 5xx 물러남 · 원천 시각 = 그 쪽을 읽은 시각 · 목록 부재 = 탈퇴 근거 아님.
- K2 배포 직후 이에스페이먼츠 4몰 1회(같은 줄 · 새벽 · 앞뒤 S6 · 고객사 사전 안내 = 숫자 변동).
- 화면: 서버 `history.reason: 'first' | 'reread'` · reread = 진행 칸 대신 회색 한 줄 「매주 새벽 회원 정보를 다시 맞춰요」.

### K4 식별 신뢰 등급 (M5 · M6)
- `IdentifyInput.tier: 'profile' | 'order'`(기본 profile) · syncOrder 안 호출 = order = 빈 칸만 채움 · 전화 자동 교체 0 · 동의 = K2.
- 브라우저 = 연결만: `ingestBrowserEvents`(`cdp-events.ts:442-460`)의 identifyCustomer 호출 삭제 · 회원 토큰이 증명한 회원 번호와 같은 서버 연결(source ≠ 'sdk')의 고객만 잇는다 · 서로 다른 고객 둘 이상 = 익명.
- **도메인 이전 몰(검증 수정 10)**: `/member-token` 은 K8 플러그인 키로 연동 행을 특정하고, 플러그인이 보낸 호스트가 그 행의 인정 목록(mall_id · 증명 주소)에 있을 때만 회원 번호를 `{행.mall_id}:{회원 번호}` 로 다시 만들어 서명한다(렌즈고고 · 렌즈007 = `home_url` 호스트 ≠ 고정 mall_id).
- 자체호스팅 2곳의 브라우저 identify 고객 생성 여부 실측(§8 S8) 뒤 서버 `/identify` 안내.
- 계약 **R23 신설** = §6.

### K5 탈퇴 (M4)
- 근거 둘 · 처리 = 그 몰 소속 행 명시 NO · 출처 `{provider}:deleted` · `consent_source_at` = 삭제 시각(K2 비교로 옛 비회원 주문이 못 되살림) · 연결 행은 지우지 않음 · DDL 0 · **K2 뒤**.
- 우커머스 `WOO_WEBHOOK_TOPICS` 에 `customer.deleted`(쓰기 권한 몰 = 30분 점검이 자동 생성 · 읽기 권한 몰 = 표에 기록) · 어댑터 삭제 무시 갈래(`woocommerce-adapter.ts:101-105`)를 회원 삭제에 한해 CT 호출로.
- 카페24 = 회원 권한 승인 뒤 · 고도몰 = 길 없음(K13 none) · 자체호스팅 = 규격에 `customer.deleted` 선택 칸.

### K6 수신 자격 · 토큰 유지 (M3 · M31)
- 수신 자격 조각 하나(카페24 · 아임웹 · 네이버) = `connected_at IS NOT NULL AND status <> 'revoked' AND (status <> 'token_expired' OR 유예 안)`. 유예 시계 = `token_expired` 를 쓰는 같은 UPDATE 가 `meta.token_expired_at` 을 쓴다(R18 · updated_at 아님). 카페24 = `meta.refresh_token_expires_at`(있으면 · `cafe24-client.ts:238`) 또는 만료 시각 + 14일 · 아임웹 = + 90일 · 상수 = CT 표.
- 카페24 BYO `pending_oauth` 행(`cafe24-client.ts:313-327`)은 connected_at NULL 이라 조각 밖(공용 키 인증으로 남의 몰 웹훅이 새는 길 차단).
- **승인 성공 = connected_at 채움**(Codex R1 #6): 카페24 승인 저장 upsert(`cafe24-client.ts:218-226`)의 DO UPDATE 에 connected_at 이 없어 BYO 행이 승인 뒤에도 NULL 로 남는다 → 조각이 그 몰 웹훅을 전부 뺀다. `connected_at = COALESCE(company_integrations.connected_at, NOW())` 를 더한다(아임웹 `imweb-client.ts:197` 과 같은 꼴). 다른 7곳 upsert 는 확인함(1027 grep `ON CONFLICT (company_id, provider, mall_id)` · 아임웹 COALESCE · 메이크샵 · 네이버 · 자체호스팅 NOW() · 고도몰 = pending 으로 두고 검증 성공 UPDATE(`godo-client.ts:182 · 201`)가 COALESCE 로 채움 · 우커머스 = 조각 밖). 계약(R7 넓힘) = `status = 'active'` 를 쓰는 upsert 는 connected_at 도 NULL 이 아니게 쓴다. 배포 전 S3 에 「active 인데 connected_at NULL 인 카페24 · 아임웹 · 네이버 행 수」를 넣고, 0 이 아니면 그 행은 DML-3(connected_at = updated_at)으로 채운 뒤 K6 을 켠다.
- 유예가 끝나도 상태 그대로 · 조각이 빼고 K10 이 알림 · 화면 「조치 필요 · ○월 ○일부터 데이터를 받지 못하고 있어요」 · 유예 중 = 「조치 필요 · 데이터는 계속 받는 중」.
- 토큰 유지 워커 = 카페24 6일 · 아임웹 29일 경과 행을 기존 CT(`ensureFreshCafe24Token` · `ensureFreshImwebToken`)로 갱신 · 갱신 성공 뒤 저장 실패 = 그 자리 재시도 · 끝내 실패 = 경보 · 같은 워커가 K12 도메인 갱신 · K10 신호를 함께.
  - 재시도 상한(구조체크 SC8 · R8): 대상 = `status = 'active'` 행만(SQL WHERE · LIMIT 앞). 제공자의 확정 거절은 지금 CT 가 `token_expired` 로 바꾸므로(`cafe24-client.ts:378-386` `isDefinitiveTokenRejection`) 다음 회차 대상에서 빠진다. 일시 실패는 다음 회차(1시간)에 다시 · 같은 행 연속 일시 실패 3회 = K10 경보.
  - **만료 표시는 그 요청에 쓴 토큰판일 때만(Codex R4 #2)**: 지금 만료 UPDATE 4곳(카페24 `cafe24-client.ts:382` · 아임웹 `imweb-client.ts:263` · 메이크샵 `makeshop-client.ts:192` · 네이버 `naver-commerce-client.ts:274`)은 id 만 본다. 옛 토큰으로 나간 갱신 요청의 확정 거절이 새 승인 · 다른 갱신의 저장(`cafe24-client.ts:219-225` 가 새 토큰과 active 를 씀)보다 늦게 오면 새 토큰 행을 `token_expired` 로 덮고, 유지 워커는 그 행을 다시 보지 않아 성공한 재승인이 만료로 굳는다. 처방 = 연동 행을 읽을 때 `token_expires_at::text` 원문을 함께 들고(여정 커서의 DB 원문 꼴 · `journey-cdp-cursor.ts`), 만료 UPDATE 의 WHERE 에 `token_expires_at = $읽은원문::timestamptz` 를 건다(성공한 갱신 · 재승인 저장은 늘 이 칸을 바꾼다 · 0행 = 그 사이 새 토큰이 들어옴 = 만료로 바꾸지 않음). 같은 UPDATE 가 `meta.token_expired_at` 도 쓴다(위 유예 시계). 네 곳을 한 CT `markTokenRejected(row)` 로 모은다(R1).
- 우커머스 = 행마다 서명이라 조각 밖(지금 규칙 유지).

### K7 수집 공통 문 · 상태 분류 (M8 · M9 · M10 · M23 · M31)
- 한도 분류표(`cdp-auth.ts`) = 사실(identify · order · bulk-import · member-token) / 행동(event · ingest · 인앱 표시 · 푸시) · 월 한도 = 행동만 · 사실 = 높은 경보선(한도 × 10 · 우리 쪽 경보만) · 기준 = 주소.
- 요금제 판정 = `plan-guard.ts ACTIVE_PAID_PLAN_WHERE` 한 벌(검증 수정 13 · `isCdpEnabledForPlan` 은 이 판정을 부른다) · 사실 경로 = 활성에서 빠진 사건 시각(요금제 변경 원장 `company_plan_changes` · 구독 상태 변경) + 90일까지 받고 멈춤 · 시각을 모르면 수집 계속 + K10 표에 띄움 · 행동 · 인앱 · 발송 · 화면 = 요금제 그대로 · 서버가 `collectUntil` 을 내려 화면이 읽기 전용 카드로 말함 · 90 = 법무 확인 전 기본값.
- 상태 분류 CT `integrationProblemOf(code) → { kind: 'transient' | 'action', cause }` · cause = 닫힌 목록(transient: rate_limited · network · upstream_5xx · cap_reached / action: key_rejected · permission · ip_not_allowed · address · header_overflow · token_rejected · app_removed · grace_over) · 훅 = cause → 문장 표 · 표에 없는 cause = 계약 실패 · transient = 카드 배지 불변 · 몰 줄 안내 한 줄 · 서버 원문은 접힌 개발자용 복사에만.
- 「처음부터 다시 가져오기」 화면 제거 · 재승인 · 연결 확인(`routes/woocommerce.ts:202 · 419`)의 restartIfDone = 키 · 주소가 바뀐 때만.
- 카드 데이터 문구 = 모든 연결 카드에 「마지막 데이터 10월 24일」(서버 몰별 `lastReceivedAt`) · 24시간 건수는 있을 때만 · 요약 숫자 이름 「수신 중」 → 「연결됨」 · 침묵 판정은 K10 만(0810 결정 유지).
- 우커머스 카드 = 「몰 4곳 중 1곳 확인 필요」(action 만 셈).

### K8 몰 서버 호출 보안 (M13 · M14 · M24 · M34)
- SSRF = `utils/outbound-guard.ts`(`isPrivateIp` · `resolvePublicAddress` · `pinnedLookup` 을 `dm/dm-brand-extractor.ts:291-351` 에서 옮김 · DM 은 재export) · `sales-outreach-produce.ts:215` 사본 삭제 · 두 사본의 사설 범위는 **합집합**으로(영업 사본에만 100.64/10 판정이 보임 · 옮길 때 두 함수를 나란히 놓고 범위 표 시험) · `geo-access.ts:149` 같은 이름 함수는 로그인 · 기계 출발지의 클라이언트 IP 분류라 손대지 않고 R1 계약 대상 밖(사유 줄) · `woocommerce-client.ts wooHttp` 한 곳이 지남(Store API 리다이렉트 포함 · 넓은 헤더 transport 가 lookup 을 따르는지 시험).
- 플러그인 키(D9) = 새 ENV 전용 비밀(JWT_SECRET 과 분리)에서 `연동 행 id | 판` 파생 · 그 행 접두로 시작하는 회원 번호만 발급 · 출발지 통제 = 전용 범위 `company_plugin` 기본 「기록만」(고객사가 출발지를 등록하면 차단) · 자체호스팅 전권 키 = 출발지 통제 그대로 + 사전 확인서 「서버 출발 IP」 · 플러그인 1.0.3(지금 설치 0).
- 자격 암호화 = `utils/secret-box.ts` AES-256-GCM · 접두 `enc:v1:` · **범위 = meta 비밀 값 + `access_token` · `refresh_token` · `webhook_secret`**(검증 수정 12) · `webhook_secret varchar(100)` 은 암호문(약 131자)이 안 들어가 **DDL-2(text 로 넓힘)** 를 먼저 · 읽기 이중 → 배포 뒤 다시 쓰기 1회(DML-2) → 평문 0 · 키 백업 · 교체 절차 = 운영 문서 먼저.
- 승인 묶기(M24) = 카페24 · 아임웹 OAuth 콜백 = 미확정 저장 · 로그인된 화면이 nonce 로 확정 · JWT 회사 = state 회사일 때만(콜백 요청에 로그인 정보가 실리는지 = 리허설).
  - 미확정을 닫는 자리(구조체크 SC7 · R6): 미확정 = 그 승인의 `oauth_state` 행(같은 표 · 이미 nonce 를 들고 있음) payload 에 토큰을 secret-box 암호문으로 담는다 · 확정 = 연동 행 저장 + 그 행 삭제(한 트랜잭션) · 확정되지 않으면 지금의 `oauth_state` 1시간 정리(`cdp-webhook-retry-worker.ts:114-118`)가 지운다(토큰이 연동 행에 들어가지 않은 채 사라짐 = 재승인).

### K9 다몰 접두 (M38)
- 연동 행 생성 CT 하나(`utils/integration-row.ts createIntegrationRow`)가 INSERT 와 `meta.id_prefix`(새 행 = `{mall_id}:`)를 쓴다 · 모든 provider 저장 함수의 `INSERT INTO company_integrations` 가 이 CT 를 지난다(카페24 save · BYO · 아임웹 · 고도몰 · 메이크샵 · 네이버 · 우커머스 · 자체호스팅)(검증 수정 11).
- 재연결 · 재저장 upsert 의 DO UPDATE = `meta = company_integrations.meta || (EXCLUDED.meta - 'id_prefix')`(빈 접두였던 옛 행이 재연결로 접두를 얻지 않게).
- 읽기 CT `mallScopedIds(row, member, phone, orderId)`(지금의 주문 외부 번호 CT `orderExternalId` · `cdp-order-identity.ts:7` 를 안으로 합침 · 구조체크 9회차) = 그 행 `id_prefix ?? (우커머스 ? '{mall_id}:' : '')` · 기존 행 = 빈 접두 그대로 → DML 0 · 우커머스 = 지금 출력과 바이트 같음 · 자체호스팅 규격 불변 · 고도몰 · 자체호스팅 둘째 몰 = 요청 올 때 몰 식별자 칸부터.
- 회원 토큰 회원 번호 = 같은 접두(K4 · K8).
- **분류코드 모드 하나(구조체크 SC1 · F16)**: 한 회사의 몰 연동 행은 모두 분류코드가 있거나 모두 없다.
  - 근거: 관리자 범위 동의 읽기(`mall-consent.ts consentSql` 238~241 `uploadOnly`)는 고객 행 값을 「몰 소속 행 없음 + 회원 연결 없음」인 고객에게만 쓴다. 분류코드 몰과 없는 몰이 섞인 회사에서 분류코드 없는 몰로만 들어온 고객은 연결은 있고 소속 행은 없어 관리자 발송 · 목록에서 동의 아님으로 빠진다. 관리자는 지금 분류코드 없이도 연결할 수 있어(`integration-scope.ts:85-86`) 우커머스만으로도 섞일 수 있고, ENV-3 이 몰 동의 읽기를 분류코드 회사 전부로 켜면 이 빈칸이 넓어진다.
  - 판정 CT `assertStoreCodeMode(companyId, storeCode)`(`integration-scope.ts`): 그 회사에 분류코드 몰이 있으면 새 몰도 분류코드 필수(관리자도 · `STORE_CODE_REQUIRED`) · 분류코드 없는 몰이 있으면 분류코드 몰을 새로 못 만듦(`STORE_CODE_MODE_MIXED` · 화면 문장 = 「이미 연결된 몰과 같은 방식으로 연결해야 해요」). 해제(revoked) 행도 센다(`getMallConsentStoreCodes` 와 같은 진실 · 해제한 분류코드 몰의 소속 행 동의가 계속 읽히므로). 그래서 분류코드 몰을 모두 해제한 회사도 분류코드 없는 몰은 못 붙인다 · 모드를 바꾸는 길 = 운영 절차(그 회사의 소속 행 동의를 고객 행으로 옮길지 정하는 일 · 고객사 확인 · 별건 §9-3).
  - **회사 단위 잠금(Codex R4 #1)**: 저장 함수 8곳은 저마다 다른 잠금을 쓰거나 잠금이 없다(카페24 `cafe24-client.ts:202-243` · `313-327` 직접 INSERT · 우커머스는 자기 저장 잠금만). 그래서 「같은 잠금」 으로는 빈 회사에 분류코드 몰과 분류코드 없는 몰 연결이 동시에 와 둘 다 통과한다. 판정 CT 옆에 `lockCompanyIntegrationMode(run, companyId)` = `pg_advisory_xact_lock(hashtext($1::uuid::text), hashtext('integration_mode'))`(정산 회사 잠금 `billing-lock.ts:35` 와 같은 꼴 · 다른 축 이름 · **키는 uuid 로 정규화한 표기**(Codex R5 · 원문 표기를 해시하면 같은 회사의 대문자 · 소문자 표기가 서로 다른 잠금을 잡아 둘 다 빈 회사로 판정됨 · 정산 잠금은 옛 코드와 같은 값을 잡으려고 원문을 쓰고 회사 행 잠금으로 그 구멍을 닫았으나(`billing-lock.ts:10-16 · 33-36`) 이 잠금은 새로 만드는 것이라 처음부터 정규화))를 두고, 8곳 모두 `withTransaction` 안에서 「잠금 → 모드 조회 → 저장」 을 한 묶음으로 한다. 우커머스는 지금 저장 잠금(메모리) 안에서 이 트랜잭션을 연다(잠그는 순서가 늘 같아 교착 없음).
  - 우커머스 라우트의 `decideStoreCode`(`routes/woocommerce.ts:322` · 라우트 안 함수)를 `integration-scope.ts` CT 로 옮겨 모든 provider 연결 라우트가 부른다(R1).
  - 어댑터는 연동 행의 분류코드를 identify · syncOrder 에 싣는다(우커머스 `processWooResource(…, integ.storeCode)` 꼴 · 수신 CT 가 행을 알고 있어 ctx 로 넘김).
  - 화면 = 연결 폼 공통 매장 고르기(K14 N6).
  - 순서: 판정 CT 는 생성 CT 리팩터보다 먼저 묶음 A 에서 8곳 저장 함수에 붙인다(§5) · ENV-3 은 그 뒤 · 배포 전 S5 에 「섞인 회사 수」를 넣고 0 이 아니면 ENV-3 전에 그 회사의 몰 코드를 정한다(고객사 확인 뒤 DML).

### K10 운영 감시 (D14 · M31 · M35 출발 IP · M36 카페24 API 버전)
- **1단(묶음 A)** = 슈퍼관리자 읽기 표(한 행 = 몰 하나 · 고객사 · 몰 · 상태(K7 cause) · 마지막 수신 · 평소 간격 대비 · 토큰 갱신(마지막 성공 · 실패) · 가져오기 진행 · action 먼저 정렬 · 행 → 상세 창 · 행 버튼 0 · `ADMIN_TABLE_ONELINE` · `AdminLongText` · `AdminDetailModal`). K7 의 분류 CT 를 묶음 A 로 당긴다(검증 수정 15).
- **2단(K6 워커 뒤)** = 경보 `sendSystemAlert`(dedup · 쿨다운) · 신호 = token_expired · 갱신 거절 · action cause(`ip_not_allowed` = 고도몰 996 · 네이버 출발 IP 거절 · M35) · 평소 간격 N배 침묵(지난 30일 실측에서 뽑음) · API 버전 거절(카페24 `cafe24-client.ts:420-426` 날짜 고정판이 400 으로 막힘 · M36) · 감지 워커 심장 박동 = R14 공용 입구 스크립트가 본다.
- M35 의 사람 쪽 = 0일 사전 확인서에 「우리 서버 출발 IP」 한 줄(고객사가 몰 쪽에 등록) · 서버 이전 · 출구 변경은 운영 문서의 배포 점검 줄에.
- **모르는 주문 상태(구조체크 SC2 · F7)**: 우커머스 밖 상태 변환은 표에 없는 글자를 결제 아님으로 둔다(`cafe24-client.ts:603-612` 원문 그대로 · `godo-parse.ts:38-39` pending). 안전한 방향이지만 몰 고유 상태로 결제된 주문이 조용히 구매 0 · 매출 0 이 된다(우커머스가 0918 에 겪은 F7). 상태 변환 함수가 `{ status, known }` 을 돌려주고 syncOrder 가 `properties.status_known = false` 를 남긴다 · 1단 표에 몰별 「모르는 상태 글자(최근 7일 · 글자 · 건수)」 칸 · 2단 신호에도 넣는다.
- 첫 고객 동행 14일 = 사람이 매일 표를 본다.

### K11 가져오기 표준 (M27 · M29 · M33)
- 공용 = `utils/mall-import.ts processImportItems(items, apply, guard)`(그 건만 건너뜀 · 연속 실패만 멈춤 · 23505 1회 재시도 · 번호 없음 셈 · `woocommerce-client.ts:1069-1090` 에서 올림) + `classifyIngestError(err) → 'skip' | 'retry'`(휴대폰 없음 · 형식 · 시각 모름 = skip · 웹훅 수신 · 재처리 워커도 같이 써서 넣을 수 없는 건이 소진 경보로 가지 않음 · skip 된 전달의 끝 상태 = `processed` + `error_message` 에 사유 한 줄(새 상태 없음 · 구조체크 2회차)) + 진행 상태 저장 계약(provider 가 `readPage(state) → { items, nextState | null }` · 상태 = 연동 행 meta 쪽마다) · 몰마다 한 줄 + 전역 동시 상한 + 우선순위(첫 연결 > 규칙 다시 읽기 > 회원 대조) · provider 별 속도 · Retry-After.
- **첫 구매 보호(검증 수정 14)** = 그 회사의 **어느 몰이든** 첫 가져오기가 도는 동안 「첫 구매」 · 「휴면 복귀」 · 「첫 구매 빼기」 세 여정의 커서를 전진시키지 않음(보류 = 기다림 · 상한 48시간 < 3일 창) · 가입일 = provider 원천 칸(없으면 K13 「첫 구매 판정 = none」).
- **주기 수집(구조체크 SC4 · F15)**: 카페24 · 아임웹은 웹훅만 받아 우리 재시작 · 몰 쪽 재전송 정책(미확인) 사이에 빠진 건을 되찾을 길이 없다. 가져오기와 같은 `readPage` 로 30분마다 「마지막 수집 이후 바뀐 주문 · 회원」(우커머스 주기 수집과 같은 꼴)을 읽는다. 바뀐 시각으로 거르는 조회가 있는지 = 리허설(§7) · 없으면 K13 「실시간」 단계 근거에 「웹훅만」 으로 적는다.
- **멈춘 가져오기 · 주기 수집의 재시도(구조체크 SC8 · R8)**: 진행 상태는 페이지마다 저장하고 주기 워커가 이어 간다(우커머스 `woocommerce-client.ts:195-217` 규칙 그대로). 이어 가는 것은 마지막 원인이 transient(K7)일 때만 · action 원인이면 사용자 조치(키 다시 넣기 · 재연결)가 상태를 풀 때까지 다시 부르지 않는다(같은 거절을 30분마다 다시 사지 않음).
- 순서 = 고도몰 → 카페24 → 아임웹 → 메이크샵 · 네이버(매핑 보류 풀 때 · 30일 · 24시간 창 걷기) · K1 · K2 · K4 · K9 **뒤**.

### K12 수집 허용 도메인 (M28 · M20)
- `registerMallAllowedOrigins(companyId, integrationId, hosts)` = 넣은 값을 그 행 meta `auto_origins` 에 적음 · 해제 = 그것만 뺌(손 등록 불변) · 카페24 = `{mall}.cafe24.com` · `m.{mall}.cafe24.com` · 몰 정보 대표 도메인(필드 = 리허설) · 우커머스 = `m.` 추가 · K6 워커가 주기 갱신 · 넣는 값 = provider 가 준 값 · mall_id 로 만든 플랫폼 도메인만.
- 화면 = 몰 창마다 읽기 전용 목록 + 예외 추가(자체 호스팅 창 블록 재사용 · `CdpSettingsPage.tsx:1547-1588`).

### K13 준비 됨 표 (G9 · M16 · M17 · M18 · 각 몰의 「됐다」 근거 없음 = 이 표의 `code` 등급 + §7 리허설로 올림)
- `provider-registry.ts ProviderCapabilities` 에 단계(과거 데이터 · 실시간 · 결제 확정 신호 · 동의 · 탈퇴 · 행동 · 첫 구매 판정) × 등급(`live | test | code | none`) + 근거(날짜 · 원문 위치 · 필수) · 이미 있는 `/api/cdp/providers`(`routes/cdp.ts:2046`)로 화면이 받음 · 훅 = (단계, 등급) → 문장 표 · `test` 이상만 「됩니다」 · `code` = 「준비 중」 · `/providers` 실패 = 능력 문장 0.
- 고정 문장 삭제 = `CdpSettingsPage.tsx:130-150` · `CdpConnectForms.tsx:137 · 548` · `Cafe24LaunchPage.tsx:193-195`.

### K14 화면 (프론트 N1~N5 · M11 · M30)
- N1 = `/install-status` 를 CDP 키 없이 세션 인증으로 · 화면은 loadAll 에서 읽고 기다리는 몰이 있을 때만 주기 조회(`serialRunner`).
- N2 = 스테퍼 ③ 판정을 훅으로 · 고도몰 연결됨 칸에 문제 칸 · 서버 원문 대신 cause 문장.
- N3 = 끊긴 연동도 서버가 몰 식별자를 줌 · 재연결 미리 채움 · 우커머스 action 문제 몰 줄 [다시 승인](빈 키가 기존 키를 지우는지 서버 확인 · `routes/woocommerce.ts:445`).
- N4 = 승인 창 닫힘 감지(1초 · 언마운트 정리 · 팝업 차단 폴백) · 「새로고침해주세요」 토스트 삭제.
- N5 = 카페24 앱 실행 화면 = 사실 문장 · token_expired 면 「연결이 끊겼어요 · 다시 연결」.
- M11 = 서버 `webhookOwner: 'auto' | 'manual'`(쓰기 권한 판정 = 워커와 같은 한 곳) · auto 몰 재발급 버튼 0 · manual = 개발자용 접힘 안.
- N6(구조체크 SC1) = 분류코드 회사의 연결 폼마다 매장 고르기(우커머스 연결 창 블록 재사용 · 분류코드 없는 회사 = 칸 없음 · 담당자 한 코드 = 자동) · 섞임 거절 문장.
- M30 = `App.tsx` 루트 분기 `siteCode` 한 줄 → `/cdp-settings?connect=imweb&site_code=…` · 로그인 복귀 허용 정규식 · 연동 화면이 값을 채움 · 승인 창은 사용자가 누름 · **파트너센터 서비스 주소 리허설이 먼저**.
- 묶음 순서 의존: M10 화면(transient 숨김) = K10 1단 뒤 · 도메인 화면 = K12 뒤 · 가져오는 중 배지 = K11 뒤 · 카페24 몰 목록 · 앱 실행 판정 = K9 뒤 · 타임라인 라벨 = K1 같은 커밋.

### K15 그 밖
- M19 = 네이버 웹훅 주소(`routes/naver-commerce.ts:43-90`) · 추측 이벤트 매핑 삭제(R15) · `register-providers.ts` 머리 주석 정정.
- M25 = `sdk-serve` 허용 판 목록 · v0.3.5 = 요청 로그로 쓰는 곳 0 확인 뒤 닫음.
- M15 = 플러그인 회원 토큰 호출이 페이지를 붙잡지 않게(캐시 있으면 즉시 · 없으면 비동기 발급 · 그 페이지는 익명).
- M32 멀티쇼핑몰 · M37 = K13 none + 사전 확인서.
- I14 = 시험이 `ecosystem.config.js` instances 1 · fork 를 고정.

## §3 DDL · 데이터 · ENV (전부 Harold 실행 · 실행 위치 = 서버 운영 PostgreSQL psql · 마이그레이션 = 코드 배포 뒤(원칙 그대로 · 코드가 칸 없음을 견딘다))

| # | 무엇 | 확인 먼저(information_schema) | 실행 | 코드가 칸 없을 때 |
|---|---|---|---|---|
| DDL-1 | `customer_stores.consent_source_at timestamptz NULL` | `SELECT column_name FROM information_schema.columns WHERE table_name='customer_stores' AND column_name='consent_source_at';` = 0행 | 원문 = [배포 원장](../status/DEPLOY-LEDGER.md) `ddl:C71-DDL-1` → 채우기 = 원장 C71-DDL-1-FILL(consent_at 에서 · 나머지 NULL = 비교에서 -infinity · ADD COLUMN 은 기본값 없는 NULL 칸이라 표 다시 쓰기 없음 · UPDATE 는 행 수를 먼저 세고 회사별로 나눠 `SET lock_timeout` 아래 실행 · SQL 원문은 실행 시점에 S6 결과와 함께) | 42703 = 지금 동작 + 경고 1회(쓰기 경로) · 읽기 endpoint 없음 |
| DDL-2 | `company_integrations.webhook_secret` varchar(100) → text | `SELECT data_type, character_maximum_length FROM information_schema.columns WHERE table_name='company_integrations' AND column_name='webhook_secret';` | `ALTER TABLE company_integrations ALTER COLUMN webhook_secret TYPE text;`(varchar → text = 다시 쓰기 없음) | 암호화 쓰기 전 판정 = 칸 길이 확인 · 짧으면 평문 유지 + 경고 |
| DDL-3 | `customers.consent_source_at timestamptz NULL`(K2-4 · Codex R1 #2) | `SELECT column_name FROM information_schema.columns WHERE table_name='customers' AND column_name='consent_source_at';` = 0행 | 원문 = [배포 원장](../status/DEPLOY-LEDGER.md) `ddl:C71-DDL-3`(lock_timeout 3초 · 기본값 없는 NULL 칸 = 표 다시 쓰기 없음 · 잠금은 순간이지만 고객 표는 쓰기가 잦아 대기 줄을 막지 않게 3초 상한 · 걸리면 다시) · 채우기 없음(NULL = -infinity = 지금 동작) | 42703 = 지금 동작 + 경고 1회 |
| DML-3 | active 인데 connected_at NULL 인 카페24 · 아임웹 · 네이버 행(K6 · Codex R1 #6) | S3 의 그 줄이 0 이 아닐 때만 | `connected_at = updated_at`(그 행만 · id 목록으로) · K6 배포 전 | 없음 |
| IDX-1 | 주문당 purchase 1행 부분 유일 색인 | S9 중복 0 | `CREATE UNIQUE INDEX CONCURRENTLY … ON cdp_events (company_id, source, (properties->>'order_id')) WHERE event_name='purchase';` | 없음 |
| DML-1 | 6,064건 이름 변경(K1-11) | S1 · 코드 배포 확인 | 대상 = K1-11 의 P_unpaid · `renamed_from` · SQL 원문은 묶음 A ③ 시점에 · 앞뒤 S1 | 없음 |
| DML-2 | 자격 다시 쓰기(K8) | 키 백업 확인 | 스크립트(읽기 이중 CT 로 읽어 암호로 씀 · 행별 · 실패 0 확인) | 없음 |
| ENV-1 | 플러그인 키 전용 비밀 | 없음 | `.env` 한 줄(값 = Harold 생성) · 재기동 `--update-env` | 없으면 플러그인 키 발급 503 |
| ENV-2 | secret-box 키(판 v1) | 없음 | `.env` 한 줄 · 백업 위치 운영 문서 | 없으면 평문 유지(읽기 이중) + 부팅 경고 |
| ENV-3 | `MALL_CONSENT_ENFORCE_COMPANY_IDS` 없앰(G6 · M7) | S5 | 미설정 = `*` 로 뜻 변경(코드 · `mall-consent.ts enforceList`) · 끄기 = `off`. 닫는 것 = 쓰기(`cdp-identity.ts:145-147` 분류코드 몰이면 고객 행 동의를 올리지 않음)와 읽기(`isMallConsentEnforced` · ENV 에 있는 회사만)가 다른 기준이라 ENV 에 없는 분류코드 몰 회사의 고객 행 동의가 멈춘 채로 읽히는 것. 뒤 = 두 쪽 모두 연동 행 `meta.store_code`(`getMallConsentStoreCodes`) 하나 | 없음 |

- 새 칸(DDL-1 · DDL-3)은 CT 안에서 42703 을 잡아 지금 동작으로 돈다(위 표 「코드가 칸 없을 때」). 그래도 그 칸을 쓰는 서버 API(`/api/cdp/identify` · `/order` · `/bulk-import` · 우커머스 · 자체호스팅 웹훅 라우트)의 catch 는 `column` · `does not exist` 오류가 밖으로 나오면 503 + `DB_MIGRATION_PENDING` + 「DB 마이그레이션 필요 · customer_stores(또는 customers) ALTER 실행 요청」 으로 답한다(규칙 db_alter_safety_net · 500 노출 0).

## §4 영향표 (바뀌는 자리 → 소비처 · 확인 방법)

| 바뀌는 것 | 소비처 | 영향 · 처리 |
|---|---|---|
| `purchase` 의 뜻(K1) | 운영 소스 23파일 41곳(`event_name = 'purchase'` · IN 목록 · 백엔드 1차 grep) · `journey-executor.ts:1475` 혼합 IN | 코드 불변 · 결제 전 주문이 빠진다(의도) · 계약 R22 가 「purchase 를 쓰는 파일 1」 고정 · 구현 전 grep 결과를 영향표 부록으로 |
| `order_placed`(K1) | K1-9 목록(syncOrder · 원장 문 판정 · 마지막 도착 시각 · 주문 시도 조각 · 고객 360 라벨) · `'order'` 를 구매로 세는 13파일(이름이 달라 불변) | R22 허용 목록 |
| 원장 문(K1) | `journey-purchase-ledger.ts` `isMallPurchaseDoorActive` · `getPurchaseDoorStatus`(두 이름) · `isMallPurchaseDoorForJourneyStats`(purchase 그대로) | 결제 전 주문만 오는 회사도 원장 문이 닫힌 채로(지금과 같음) |
| 예약 이름(K1-7) | 서버 `/event`(`routes/cdp.ts:299-315`) · 브라우저 수집(`cdp-events.ts:335`) | 서버 `/event` 의 `purchase` 가 `checkout_complete` 로 · S1 = 기존 사용 0 · `STANDARD_EVENT_NAMES` · SDK 사본 불변 |
| 여정 진입 중복(K1-2) | 사건 행 추출 `journey-target-extractor.ts:683-696` · 트리거 진입 반복문 `journey-trigger-watcher.ts:548-561`(표식 쓰기 557~560) | ① 이미 쓰인 사건 행 빼기 ② 잠금 안 교체 · 쿨다운보다 먼저 건너뛰기 · 표식 없는 0929 전 실행은 거르지 못함(§9-1 · S14) · 795~808 일괄 경로 불변 |
| 주문 쓰기 원자성(K1-2) | `syncOrder` 3-A · 3-B · `trackOrderEvent` | 한 트랜잭션 · `releaseMarker` 삭제 · 연결 하나를 잠깐 더 붙듦(주문 1건 = 짧은 문장 2~3개) |
| 전달 상태(K2-6) | 재처리 워커 선택(32~46) · 소진 경보(92) · 보관 정리(127) · 원문 비우기(137) · 진단 신뢰성(`cdp-diagnostics.ts:158-170`) · 자체호스팅 전달 목록(`routes/cdp.ts:2133`) | 선택 = 선점 문장 하나 · `superseded` = 선택 · 경보 밖 · 정리 안 · 진단에서 처리됨 · 목록은 값만 내려줌(프론트 사용 0) |
| 매출 조각(K1) | 구매이력 2 · 자동마케팅 성과 · 플래너 대상 · `customer-purchase-aggregates.ts:45-51` | 같은 규칙으로 · M26 44건 판정 일치 |
| 동의 쓰기(K2) | `upsertStoreConsent` · `applyMissingConsentRule` · `syncCustomerFields` · `withdrawMemberConsent` · 우커머스 · 고도몰 주문 갈래 | 시각 인자 필수(R18 계약) · 읽는 쪽(`consentSql` 등) 불변 |
| identify 등급(K4) | identifyCustomer 호출 약 13곳(provider 어댑터 · syncOrder · 브라우저 · 서버 API · 일괄 적재) | 등급 표(R23)와 기계 대조 |
| 수신 기록(K2-5) | 카페24 · 아임웹 · 네이버(공용 CT) · 우커머스 · 자체호스팅(인라인 → CT) · 재처리 워커 | 응답 시점이 처리 전으로(200) · 실패 응답 문구 사라짐 |
| 수신 자격(K6) | 카페24 · 아임웹 · 네이버 몰 조회 3곳 | 조각 하나 · `status = 'active'` 글자 0 |
| 연동 행 INSERT(K9) | provider 저장 함수 8곳 | 생성 CT 하나 · 계약 = 밖 INSERT 0 |
| 외부 번호(K9 `mallScopedIds`) | `orderExternalId` 부르는 곳 4(1027 grep = `cafe24-client.ts` · `godo-parse.ts` · `imweb-client.ts` · `naver-commerce-client.ts`) · 우커머스 매핑(`woocommerce-core.ts`) | 기존 행 = 빈 접두라 출력 바이트 불변 · 우커머스 = 지금 접두 그대로 · 새 행만 몰 접두 |
| 요금제 문(K7) | `cdp-auth.ts` 3 미들웨어 · 고도몰 · 우커머스 워커 · 웹훅 수신 | `ACTIVE_PAID_PLAN_WHERE` 한 벌 · 사실 = 90일 |
| 한도(K7) | `isOverMonthlyCdpLimit` · `/ingest` · 인앱 · 푸시 · `/order` · `/identify` | 분류표 |
| 화면 상태(K7 · K14) | 훅 · 페이지 · 스테퍼 · 현황판 · 연동 폼 · 앱 실행 화면 · 옛 계약 3건(`cdp-provider-keys.contract.test.ts:342 · 356 · 485`) | 의도 변경으로 고침(사유 줄) |
| 플러그인(K4 · K8) | PHP 1.0.3 · `/member-token` · 출발지 통제 | 설치 0 → 재설치 비용 0 |
| 분류코드 모드(K9 SC1) | 연동 행 저장 함수 8곳 · 연결 라우트(카페24 · 아임웹 · 고도몰 · 메이크샵 · 네이버 · 자체호스팅 · 우커머스) · 어댑터의 identify · syncOrder 호출 · 연결 폼 6개 | 분류코드 회사에서 분류코드 없는 연결 = 거절(지금 = 받음) · 우커머스 밖 몰 = 분류코드 소속 행에 동의가 쌓임 · 분류코드 없는 회사 = 불변 |
| 모르는 상태(K10 SC2) | 상태 변환 함수(카페24 `mapCafe24OrderStatus` · 고도몰 `mapGodoOrderStatus` · 아임웹 · 네이버 · 자체호스팅 상태 글자) · syncOrder properties | 반환에 `known` · 판정 결과 불변(모르는 글자 = 결제 아님 그대로) |
| 아임웹 수신 순서(K2-5 SC3) | `routes/imweb.ts` 50~62 | 인증 먼저 · 모르는 사이트 = 200 |
| 주기 수집(K11 SC4) | 카페24 · 아임웹 주기 워커 신설(우커머스 주기 수집 꼴) · K13 「실시간」 근거 | 30분 회차 · 가져오기와 같은 줄 · 우선순위 |
| 회사 단위 잠금(K9 R4 #1) | 연동 행 저장 함수 8곳 · `billing-lock.ts` 꼴 | 저장마다 짧은 트랜잭션 하나 · 같은 회사 연결끼리만 줄 섬 |
| 토큰 만료 표시(K6 R4 #2) | 만료 UPDATE 4곳(카페24 · 아임웹 · 메이크샵 · 네이버) · 연동 행 읽기(원문 칸 하나 더) | `markTokenRejected` 한 곳 · 새 토큰이 들어온 뒤 늦은 거절 = 0행 |
| 미확정 승인(K8 SC7) | 카페24 · 아임웹 OAuth 콜백 · `oauth_state` 행 payload · 1시간 정리 | 토큰이 확정 전까지 연동 행에 없음 |

## §5 묶음 · 배포 순서 · 되돌리기

- **0일(코드 아닌 일 · 동시)**: §8 실측 · 카페24 개인정보 권한 신청 + 권한 범위 최종본(바꾸면 기존 몰 재동의 · `cafe24-client.ts:59`) · 아임웹 출시 + 파트너센터 서비스 주소 · 고도몰 IP 실측(INTEGRATIONS.md:17 「불요」 vs `godo-client.ts:48` 996) · 법무(만료 90일 · 해지 뒤 파기 · **위탁 고지**) · 시험 몰 방치 시작 · 이에스페이먼츠 숫자 변동 사전 안내 준비.
- **묶음 0**: K8 SSRF(독립).
- **묶음 A(실고객 영향)**: ① K2 의 `processWebhookEvent(ctx)` 배관 + 수신 즉시 200 + 기록 합치기 + **K2-6 선점 문장 · 재처리 워커 고침(나이 제한 삭제 · 원문 비우기 · 적체 · 소진 경보)을 같은 배포에**(검증 수정 15 · K1 src_at 의 전제 · 즉시 200 으로 몰의 재전송이 끊기는 순간부터 이 표가 유일한 사본이라 따로 내보내면 7일 지난 미처리 행을 버리는 창이 생김 · 구조체크 3회차) → ② K1 코드 → ③ DML-1(Harold) → ④ K2 동의(입력 규칙 · DDL-1 · 시각 비교 · superseded) → ⑤ 분류코드 모드 판정(K9 SC1 · 저장 함수 8곳) → G6(S5 섞인 회사 0 확인 · ENV-3) → ⑥ K3 4몰 1회 → ⑦ K7 분류 CT + K10 1단 표. 완료 = P_unpaid 행 0 · S6 되돌림 0.
- 묶음 A ⑤ 와 묶음 B 의 K14 N6(연결 폼 매장 고르기) 사이 = 분류코드 회사에서 우커머스 밖 몰 연결은 거절된다(문장 = 「이미 연결된 몰과 같은 방식으로 연결해야 해요」 · 지금 그런 회사 = S5 · 분류코드 없는 회사는 그대로 연결됨).
- **묶음 B(개통 전 공통)**: K4 + K8 플러그인 키 → M22 · M21 → K6 → K9 → K11 → K5 → K7 나머지(한도 · 요금제 · 화면) → K12 → K8 암호화(DDL-2 → 코드 → DML-2) → K14(N1 · N2 · N4 는 언제든 먼저 가능).
- **묶음 C(관문)**: K10 2단 → K13 + 문장 계약 → provider 리허설(§7) → 개통(영업 파이프라인 순 · Harold 확인) → 첫 고객 동행 14일.
- **되돌리기**: 묶음마다 git 되돌림 + DML-1 되돌림(`renamed_from` 행을 purchase 로) · DDL-1 · DDL-2 · DDL-3 은 남겨도 무해(칸 추가 · 넓힘) · ENV-3 = `off`.
  - **암호화 뒤 되돌림 최저판**(Codex R1 #9): DML-2 로 자격이 `enc:v1:` 암호문이 된 뒤에는 읽기 이중(평문 · 암호문 둘 다 읽음) 코드가 든 판 아래로 코드를 되돌리지 않는다(옛 매퍼는 암호문을 평문 토큰 · 서명 비밀로 써서 몰 API 인증과 웹훅 서명이 깨짐). 그 아래로 가야 하면 먼저 역변환 스크립트(DML-2R · 같은 키로 복호해 평문으로 다시 씀 · 행별 · 실패 0 확인)를 돌린다. 키(ENV-2)는 되돌림 뒤에도 지우지 않는다. 읽기 이중 판 = 묶음 B 의 K8 암호화 첫 배포(DML-2 전).
- 배포는 업무시간 밖 · 묶음마다 한 번(memory `feedback_batch_all_bundles_one_deploy`).

## §6 시험 (seam · 계약은 소스에서 대상을 기계로 뽑는다)

- **R22 신설 구매 사건 = 결제 확정**: purchase · order_placed 를 쓰는 파일 = cdp-orders.ts 1(구문 트리 · 리터럴 · SQL SET · INSERT) · `trackOrderEvent` import = cdp-orders.ts 1 · 매출 표식 · 결제 상태 글자 SQL = cdp-order-revenue.ts · cdp-orders.ts 밖 0 · order_placed 읽는 자리 = K1-9 목록 · `RESERVED_EVENT_RENAME` 이 trackEvent · 브라우저 수집 둘 다에 걸림 · 어댑터 시각 칸 NOW 대체 0(K1-3 전수 목록 자리) · `cancel_seen_at` 을 지우는 SQL 0.
- **R23 신설 식별 신뢰 등급**: cdp-events.ts 안 identifyCustomer 0 · src 전체 identifyCustomer 호출 = 등급 표(파일 · 함수 · 이유) 기계 대조 · syncOrder 안 = order.
- **R18 넓힘**: 동의 쓰기 호출(`upsertStoreConsent(` · `applyMissingConsentRule(` · `withdrawMemberConsent(`)에 시각 인자 · `sms_opt_in` 을 쓰는 문장 = `consent_source_at` 도 씀(대상 = `customer_stores` 를 쓰는 문장 전부 + `customers` 를 쓰는 문장 중 몰 경로 파일 `cdp-identity.ts` · `mall-consent.ts` 안 · 업로드 · 싱크 · 관리자 수정은 K2-4 대로 대상 밖 · 사유 줄 · 구조체크 7회차) · `consent_at = NOW()` 0 · `processWebhookEvent(` 호출 전부 ctx.
- **R7 넓힘**: 웹훅 라우팅 SQL = 수신 자격 조각만(`status = 'active'` 글자 0) · OAuth 어댑터 = 유지 워커 표 · `status = 'token_expired'` 를 쓰는 SQL = `markTokenRejected` 1(그 문장은 `token_expires_at` 조건을 가짐) · 연동 행 저장 SQL 은 `lockCompanyIntegrationMode` 를 같은 트랜잭션에서 먼저 부름.
- **R1 넓힘**: `isCdpEnabledForPlan` = `ACTIVE_PAID_PLAN_WHERE` 를 부름 · `INSERT INTO company_integrations` = 생성 CT 밖 0 · 전달 기록 INSERT(`oauth_state` 문장 제외 · 사유 = OAuth 상태 저장) = 공용 CT 밖 0 · SSRF 판정 정의(`isPrivateIp` · `resolvePublicAddress` · `pinnedLookup`) = outbound-guard 1(`geo-access.ts` 클라이언트 IP 분류 제외 · 사유 줄) · 자격 키 이름 SQL · 객체 = secret-box · 매퍼 밖 0 · cause → 문장 표 = 서버 cause 목록과 같음 · 문장 표가 code 단계를 약속하면 실패 · `decideStoreCode` 정의 = `integration-scope.ts` 1(라우트 안 0) · 연동 행 INSERT 경로가 `assertStoreCodeMode` 를 지남(생성 CT 전까지는 저장 함수 8곳 각각 · 뒤에는 생성 CT 1) · `cdp_webhook_deliveries` 를 고르거나 잡는 SQL(`received` · `failed` 행을 처리 대상으로 읽는 문장) = `claimDeliveries` 1(구조체크 5회차) · 주문 사건의 상태 · 이름 · 표식을 바꾸는 UPDATE = `orderSnapshotVerdict` 판정 뒤에만(cdp-orders.ts 안 · 그 WHERE 에 `src_at` 조건) · 결제 시각 계산 = `orderPaidAt` 1(`paidAt ?? orderedAt` 글자가 그 함수 밖 0).
- **R1 넓힘 2(구조체크 6회차 · 새 CT 마다 「밖 0」 한 줄)**: 매출 반영 판정 SQL 조각 = `netPurchaseSql` 1(구매이력 · 자동마케팅 성과 · 플래너 대상이 부름 · R22 의 cdp-order-revenue.ts 줄과 같은 대상) · 연동 문제 분류 = `integrationProblemOf` 1(화면 · 감시 표 · 경보가 부름 · 원인 글자 판정 밖 0) · 연동 행 INSERT = `createIntegrationRow` 1(위 줄) · 외부 회원 · 주문 번호 = `mallScopedIds` 반환값만(Codex R7 · 「접두를 붙이는 글자 밖 0」 만으로는 원래 번호를 그대로 넘기는 어댑터를 못 잡음): 등록된 provider 어댑터 파일(`register-providers.ts` 에서 소스로 뽑음)과 그 파일이 import 하는 매핑 모듈(1027 grep = `godo-parse.ts` · `woocommerce-core.ts` 처럼 입력 객체를 만드는 파일) 안에서, `identifyCustomer` · `syncOrder` · `trackEvent` 입력 객체의 `externalId` · `orderId` 칸 값은 그 객체를 만드는 함수 안 `mallScopedIds(…)` 반환값에서 온다(구문 트리 · 빈 접두 행도 CT 를 지나 '' 가 붙은 값) · 지금의 주문 외부 번호 CT `orderExternalId`(`cdp-order-identity.ts`)는 `mallScopedIds` 안으로 들어감 · 접두를 붙이는 글자도 그 함수 밖 0 · 연동 행 `meta.auto_origins` 를 쓰는 SQL = `registerMallAllowedOrigins` 1 · 가져오기 · 주기 수집의 건별 반복 = `processImportItems` 를 지남(provider 파일 안 자체 반복 0) · 적재 오류의 건너뜀 · 재시도 판정 = `classifyIngestError` 1(웹훅 수신 CT · 재처리 워커 · 가져오기가 같은 함수) · 우커머스 웹훅 소유 판정(`webhookOwner` auto · manual · K14 M11) = 웹훅 점검 워커와 화면 응답이 같은 함수 1 · 연동 화면은 수집 마감(`collectUntil`) · 마지막 데이터 날짜(`lastReceivedAt`) · 문제 분류를 서버 값으로만 그린다(프론트 계약 = 그 화면 파일에 날짜 · 임계값 계산 0 · I11 · 구조체크 7회차).
- **I14**: `ecosystem.config.js` 두 앱(40 · 72행) instances 1 · fork 고정(지금 이 값을 지키는 시험 0 · 1027 grep).
- 짝 시험(구현 때 · 실행) = K1 승격 순서(결제 전 → 결제 · 취소 먼저 → 결제 · 옛 스냅숏 · **같은 src_at 의 취소 → 결제** · 처음부터 결제와 결제 전 → 결제의 occurred_at 같음) · **중간 종료**(표식 선점 뒤 고객 요약 전에 던짐 → 행 · 고객 요약 둘 다 그대로 · 재처리가 한 번 더함) · **이름 바꾼 옛 주문이 결제됨 → 진입 1회 · 같은 사건으로 이미 들어간 고객 → 0회 · 이미 들어간 A 가 먼저 · 안 들어간 결제 B 가 뒤(같은 묶음) → B 로 1회 · 교체 모드 여정에서 같은 사건 → 옛 실행 닫지 않고 0회** · K2 반례 순서(NO t1 → NO t2 → YES t1.5 · NULL 시계 · 가족 번호 · **같은 시각 YES 뒤 NO → NO · NO 뒤 YES → NO** · **고객 행: 재대조 NO t1 뒤 주문 이벤트 t2 → NO 반영**) · K2-6 **8일 묵은 received 행이 처리됨 · 그 원문이 30일에 비워지지 않음 · 한 회차 안에서 실패한 행이 다시 잡히지 않음 · 줄이 잡은 행 50개가 있어도 그 뒤 행이 처리됨 · 옛 행 소진이 소진 경보에 잡힘 · 줄과 워커가 같은 행을 동시에 처리하지 않음** · K6 유예 · **BYO 승인 왕복 → connected_at 채워짐 → 수신 자격 안** · K9 재연결 접두 · **K9 분류코드 모드(분류코드 회사에 분류코드 없는 연결 = 거절 · 분류코드 없는 몰이 있는 회사에 분류코드 몰 = 거절 · 해제 행도 셈 · 카페24 웹훅이 연동 행 분류코드로 소속 행을 씀 · 빈 회사에 분류코드 몰과 없는 몰을 동시에 연결 → 하나만 저장 · 같은 회사 uuid 를 대문자 · 소문자 표기로 동시에 연결해도 하나만 저장)** · **옛 토큰 갱신의 거절이 새 승인 저장 뒤에 도착 → active 유지(4곳 모두)** · K11 한 건 건너뜀(**끝 상태 processed + 사유**) · **K11 action 원인으로 멈춘 가져오기를 주기 워커가 다시 부르지 않음** · **K10 모르는 상태 글자 → status_known false · 판정 불변** · **아임웹 인증 실패 401 · 인증 통과 + 모르는 사이트 200 · 기록 0** · **미확정 승인이 1시간 뒤 지워지고 연동 행에 토큰 0** · **K1-6 판정 뒤 다른 쪽이 src_at 을 바꾸면 UPDATE 0행 = stale** · 변이(가드 끔 → 실패) 확인.

## §7 리허설 (행복 경로 + 변이 · 다섯 칸 = 행동 · 기대 원문 · 통과 판정 · 증거 위치 · 판정자)

| 몰 | 행복 경로 | 변이(의무) |
|---|---|---|
| 카페24(gyunoo83) | 시험 주문 1 → 본문 `order_status` 가 상태표에 있음 · 결제 시각 칸 · 바뀐 주문 조회(SC4) · 스크립트 삽입 뒤 방문 1 = 수집됨(K12) · 앱 삭제 → 알림 오는지 · 멀티쇼핑몰 1 추가 | 취소 먼저 · 결제 실패 · 우리 재시작 중 주문 · 옛 웹훅 재생 · 토큰 만료 상태로 바꿔도 수신 |
| 아임웹(시험 사이트) | 앱 추가 → siteCode 가 어디로 오나 · 토큰 본문 · 웹훅 헤더 · 주문 생성 상태 · 주문 시각 형식 · 시험 결제 입금 완료 · SDK 스크립트 넣는 자리(코드 삽입 메뉴 · 허용 도메인 · 첫 연동일 ④) · 바뀐 주문 조회(SC4) | 동의 변경 웹훅 칸 이름 · 회원 탈퇴 · 모르는 사이트 코드 200 |
| 고도몰(시험 몰) | 시험 주문 2(휴대폰 · 유선만) → `lastOrder` 뜻 · 시간대 · `smsFl` · 유선만 = 그 건만 건너뛰고 회차 성공 · 응답 크기 · XML 헤더 상한(F1) | IP 미등록 996 = cause 문장 |
| 메이크샵 | 시험 회원 · 주문 → 구조 로그 → 매핑 · 동의 칸(`sms_receive` 뜻 · F5) · 상태 글자 | 없음 |
| 우커머스(시험 워드프레스) | 플러그인 1.0.3 활성화 · 등급 역할 회원 웹훅 · 1클릭 | 몰 동의 철회 → NO · 회원 삭제 → NO · 가상계좌 늦은 입금 · 재발급 버튼 없음(auto) · 도메인 이전 회원 토큰 |
| 자체호스팅 | 서명 웹훅 6종 + `customer.deleted` | 옛 스냅숏 재전송 |
- 「실고객 받을 준비 됨」 = 원장 §8-4 첫 연동일 경로(10단계 × 몰) ✕ 0 · 리허설 항목마다 원문(구조 로그) + 판정 한 줄 · 화면 약속 = K13 표에서 · 사전 확인서 있음 · 해제 → 재연결 왕복 중복 0 · 「?」 칸 = 첫 고객 확인표 + K10 표.

## §8 실측 · 확인 (Harold 실행 · 하나씩)

| # | 무엇 | 왜 |
|---|---|---|
| S2 | 켜진 구매 시작 여정 수(회사별) | K1 영향(원장 §4-3 SQL) |
| S3 | 카페24 · 아임웹 · 네이버 연동 상태 · 토큰 만료 분포 · **active 인데 connected_at NULL 인 행 수** | K6 배포 순간 수신이 열리는 행 · 닫히는 행(DML-3) |
| S5 | 분류코드가 있는 자사몰 연동 회사 목록 · **분류코드 몰과 없는 몰이 섞인 회사 수** | ENV-3 · K9 분류코드 모드 |
| S6 | 몰별 동의 분포(앞뒤) | K2 · K3 |
| S7 | 체험 회사 `plan_code` · `subscription_status` | K7(체험이 연결부터 막히는가) |
| S8 | 자체호스팅 2곳 = source 'sdk' 연결로 만들어진 고객 수 | K4 뒤 신규 0 위험 |
| S9 | 주문당 purchase 중복 수 | IDX-1 |
| S10 | `cdp_webhook_deliveries` status CHECK 제약(`pg_constraint`) | superseded |
| S11 | 우커머스 주문 `date_modified_gmt` 가 상태 변경 때 바뀌는가(원문 1건 · `diagnose-woo-headers.ts` 읽기 전용) | K1 srcKind |
| S12 | 우커머스 주문 `created_via` 값 분포 | 시험 · 수기 주문 |
| S13 | 표식 도입(2026-06-10) 전 · 표식 없는 purchase 행 수(회사 · source 별) | K1-11 격리분 · 0 이면 격리 규칙만 남김 |
| S14 | P_unpaid 행 중 그 고객에게 0929 전(진입 표식 없음) 구매 여정 실행이 있는 수 | K1-2 중복 진입 거름이 못 막는 몫 |
| S15 | 7일 넘게 묵은 미처리 전달(`received` · 재시도가 남은 `failed` · `oauth_state` 제외) 수 · source · 가장 오래된 시각(구현 자가 검토 1027) | K2-6 이 나이 제한을 지우면 배포 순간 처음 재생된다. 원천 시각(src_at)이 없는 옛 주문 행에는 옛 본문이 상태를 되돌릴 수 있다 → 0 이 아니면 배포 전 그 행을 하나씩 판정(되돌림 위험이면 superseded 로 닫는 DML · Harold) |

## §9 알고 둔 한계 · 범위 밖

### §9-1 한계
- 결제 시각 원문은 우커머스만 → 우커머스 밖 가상계좌가 주문 3일 뒤 입금되면 여정 시작 0(K13 「결제 확정 신호」 등급으로 적음).
- 받은 시각 시계(received)는 우리 처리 순서에 흔들린다 → 종결 규칙(I3 · K1-6 `cancel_seen_at`)이 위험 방향(취소 뒤 승격)만 막는다. 그 대가로 received 종류 몰에서 같은 주문 번호로 취소 뒤 진짜 재결제하면 매출 · 구매 사건이 빠진다(안전 방향).
- 웹훅 본문에 시각 칸이 없으면 받은 시각을 쓴다(K1-3) → 몰이 웹훅을 늦게 다시 보내면 그만큼 늦은 시각이 된다.
- 여정 진입 사건 id 표식은 0929 부터다 → 그 전에 결제 전 주문으로 진입한 고객의 같은 주문이 지금 결제되면 한 번 더 들어갈 수 있다(몫 = S14 · 0 이 아니면 그 실행에 표식을 채우는 DML 을 그때 정한다).
- 카페24 · 고도몰은 삭제 신호가 없어 K5 효과 0.
- 「준비 됨」 = 시험 몰로 볼 수 있는 범위 안에서다(대량 · 고유 상태 · 실제 회원 웹훅은 첫 고객과 확인).

### §9-2 프로세스 1개 전제 위의 메모리 잠금(I14 · 인스턴스를 늘리는 날 DB 잠금으로 옮길 목록)
`inflight-lock` runSerial · joinInflight · singleFlight / `keyed-lock` withKeyedLock / 우커머스 backfillChain · backfillQueued / K2 수신 처리 줄(행 선점은 DB 문장이라 이 목록 밖) / K3 · K11 몰별 줄.

### §9-3 범위 밖(기록 · 착수 = Harold)
- F12 몰별 담당자 연결(담당자가 자기 매장 몰을 직접 연결 · 원장 §8-2 ✕): 첫 고객 연결은 관리자가 한다 · K9 SC1 의 매장 고르기가 담당자 한 코드 자동을 이미 따른다(`pickStoreCodeForConnect`) · 담당자 화면에 연결 입구를 여는 것은 기능 신설이라 별건.
- 분류코드 모드 바꾸기(K9 SC1 · 분류코드 몰을 모두 해제한 회사가 분류코드 없는 몰로 옮기는 운영 절차): 첫 고객 대비에 필요 없음 · 요청이 오면 그때.
- 부분 취소 · 교환 재주문 · 다통화 합산(`cdp-orders.ts:197-210`) · 야간 광고 동의 종류 · 해지 뒤 보관 · 파기(회사 공통 정책) · 이메일 매칭으로 다른 고객에 합쳐지는 2단계 · 백엔드 경보 16번 한 길(R14 별건) · 위탁 고지 문안(0일 법무에 넣음).

## §10 회의 기록 요지 (1027 · COLLAB §1)

- 소환 = 기획 · 백엔드 · 프론트엔드 · 회의론자(Explore 읽기 전용 · 디자이너 = 화면 신설 아님) · 1차 → 교차 토론 1라운드 → 주재자 수렴 → 회의론자 최종 검증.
- 2라운드에서 엇갈린 자리와 판정: 결제 전 이름(`order_placed` · 상태 담음) · 표식(`renamed_from`) · 동의 시각 칸(DDL 1 · DDL 0 형태의 과발송 순서 반례 = 회의론자 승복) · 유예 끝(해제로 안 바꿈 · 기획 근거) · 카드 침묵(임계값 0 · 회의론자 형태) · 준비도 표 자리(`provider-registry.ts`) · 플러그인 출발지(전용 범위 · 기록만 기본) · 상태 분류(`transient | action` + cause).
- 최종 검증 깨지는 지점 15 = 전부 수용 · 위 K 에 「검증 수정 n」으로 반영 · 못 덮은 4 = §9 · §5 0일(위탁 고지) · §8 S8.
- 「이대로 됩니다」 판정(검증 시점) = K5 · K6 · K10 · K12 · K13 · K14 · K15 · 수정 반영 조건부 = K1 · K2 · K3 · K4 · K7 · K8 · K9 · K11.

## §11 진행표

| 순서 | 무엇 | 상태 |
|---|---|---|
| 1 | 설계서 작성(회의 수렴 + 검증 수정 15) | 완료 1027 |
| 2 | 자가 검토(빈칸 · 모순 · 범위 · 중의성) | 완료 1027 · 코드 위치 대조 뒤 고친 것 10 = 시각 대체 자리 전수(네이버 · 이벤트 시각 9곳 빠짐) · 취소 먼저 온 주문의 종결 규칙(`cancel_seen_at`) · 되돌림 날짜 기준(취소 본문 orderedAt = 취소 시각) · 옛 본문 결과 통로(`stale` → `superseded`) · 보관 정리에 `superseded` · `oauth_state` 행 계약 대상 밖 · DML-1 술어 P_unpaid(`revenue_applied = false` = 결제됨) · 원장 문 두 함수 · `order_placed` 는 표준 이벤트 목록 밖(내부 길 `trackOrderEvent`) · SSRF 사본 합집합 + `geo-access` 손대지 않음 |
| 3 | Codex 적대 리뷰(설계서) · approve 까지 | 1R 9건(high 4) → 전부 수용 · 2R 5건(같은 부류 재발 = 재처리 구조 수정 · 여정 진입 실제 경로) → 전부 수용 · **3R approve(1027)** |
| 3-2 | Codex 적대 4R(구조체크 추가분) | 2건(high 1 회사 단위 잠금 · medium 1 늦은 토큰 거절이 새 승인을 덮음) → 전부 수용 · 5R 1건(high · 회사 잠금 키 uuid 표기 정규화) → 수용 · 6R approve · 7R(구조체크 6~7회차 계약 문장) 1건(medium · 접두 계약이 원래 번호를 그대로 넘기는 어댑터를 못 잡음) → 수용 · **8R approve(1027)** |
| 4 | 설계안 구조체크 · 결함 0 까지 | 1회차 11건(SC1 분류코드 모드 섞임 = 관리자 발송에서 빠짐 · SC2 모르는 상태 · SC3 아임웹 모르는 사이트 404 · SC4 주기 수집 · SC5 공란 규칙 범위 · SC6 리허설 칸 · SC7 미확정 승인 닫기 · SC8 재시도 상한 · SC9 판정 · 쓰기 같은 조건 · SC10 담당자 연결 범위 밖 · SC11 분류코드 결정 R1) · 2회차 보충 5(불변 I15 · 영향표 5행 · R1 계약 · 짝 시험 · 건너뛴 전달 끝 상태) · 3회차 전체 정독 6(동률 방향 I3 · 동의 · 묶음 A ① 재처리 같은 배포 · 503 규칙 · 거절 기간 · 표기) · 4회차 1(분류코드 모드를 모두 해제한 회사의 길) · 5회차(Codex 4R~6R 처방 뒤) 1(새 CT 세 개 계약 누락 → R1 에 넣음) · 6회차(새 CT 이름 × 시험 절 기계 대조) 4(`mallScopedIds` · `registerMallAllowedOrigins` · `processImportItems` · `classifyIngestError` 계약 없음 → R1 넓힘 2) · 7회차(새 판정 이름 · 화면 값 × 계약) 2(R18 대상 좁힘 · 웹훅 소유 · 화면 서버 값 계약) · 8회차 0 · 9회차(Codex 7R~8R 처방 뒤) 1(orderExternalId 합침이 K9 · 영향표에 없음 → 넣음) · **10회차 = 새 결함 0(1027 · 새 CT · 화면 값 19개 전부 시험 절에 걸림 · 줄표 0 · 원장 결함 M1~M38 · 특이요인 ✕ 칸 전부 K 로 덮임 · 첫 연동일 경로 ✕ 칸 전부 K 또는 리허설 · 뿌리 점검표 R1 · R6 · R8 · R12 반영)** |
| 5 | Harold 승인 | 완료 1027(「설계안 승인합니다. 묶음 0 · A부터 구현 시작해」) |
| 6 | 구현 묶음 0 · A | 완료 1027 · 코드만(DDL · DML · ENV · 배포 = Harold 실행 · 아래 7) · backend tsc 0 · frontend tsc 0 · backend vitest 701파일 10,311건 통과 · 계약 R22 신설 · R18 · R7 · R1 넓힘 · I14 · 변이 확인 2(모드 문 빠짐 · NOW 시각 대체 = 실패) |
| 6-1 | 묶음 0 | `utils/outbound-guard.ts`(DM 재export · 영업 사본 삭제 · 범위 합집합) · 우커머스 wooHttp(첫 주소 리터럴 · 연결마다 lookup 가드 · 리다이렉트 홉) · 시험 = axios 실물(넓은 헤더 transport · follow-redirects 가 lookup 을 따른다) |
| 6-2 | 묶음 A ① | 수신 CT 하나(다섯 라우트 · 즉시 200 · 회사별 직렬 줄 · 동시 4 · 상한 500) · 선점 문장 `claimDeliveries` 하나 · 재처리 워커(0 이 될 때까지 · 4분 · 7일 제한 삭제 · 소진 = processed_at · 적체 경보 · 끝난 행만 원문 비움 · superseded 정리) · ctx(받은 시각 · 연동 행 분류코드) · 아임웹 인증 먼저 · 시험 = pg-mem 실행(8일 묵은 행 · 한 회차 한 번 · 줄 50개 뒤 행 · 소진 · 적체 · 원문 비우기) |
| 6-3 | 묶음 A ② | K1-1 · 2 · 3 · 4 · 6 · 7 · 8 · 9 · 10(order_placed · 승격 한 문장 · 한 트랜잭션 · orderPaidAt · srcAt · 판정 CAS · 종결 규칙 · status_known · 예약 이름 · netPurchaseSql · 원장 문 · 주문 시도 · 라벨 · 여정 중복 진입 두 겹) · K1-5(M21) · M22 = 묶음 B(§5 그대로) |
| 6-4 | 묶음 A ③ | DML-1 = Harold(코드 배포 뒤 · SQL 원문은 배포 때) |
| 6-5 | 묶음 A ④ | K2-1 · 2 · 3 · 4(입력 규칙 · 시계 조각 두 표 · 동의 일자 = 원천 시각 · 가족 번호 · 주문 동의 판정 · 칸 없음 = 지금 동작 + 경고 1회) |
| 6-6 | 묶음 A ⑤ | K9 SC1(저장 8곳 = 모드 문 · 회사 잠금 uuid 표기 · 새 행 · 해제 행만 판정 · 409 문장) · decideStoreCode = integration-scope · 웹훅 어댑터가 연동 행 분류코드를 싣는다 · ENV-3(미설정 = * · off) |
| 6-7 | 묶음 A ⑥ | K3(자기 줄 · KST 02~06 · 7일 · 쪽마다 저장 · 화면 회색 한 줄) |
| 6-8 | 묶음 A ⑦ | K7 `integrationProblemOf`(닫힌 원인 · 표에 없는 코드 = null) · K10 1단 슈퍼관리자 표(연동 · 인프라 → 자사몰 연동 감시 · 읽기만 · 행 → 상세 창) · K10 SC2 상태 변환 known |
| 7 | 배포 때 Harold 실행(하나씩 · 「배포 시작하자」 때) | 사전 실측 S5 · S10 · S15 → 코드 배포 → DDL-1 · DDL-3(마이그레이션은 배포 뒤 · 칸 없어도 코드는 지금 동작으로 돈다) → DML-1(앞뒤 S1) → S9 → IDX-1 · ENV-3 = 미설정이면 * (S5 섞인 회사 0 확인 뒤 · 코드 배포와 함께 켜짐) |
| 8 | Codex 적대 리뷰(구현) · approve 까지 | 1R 4건(high 3 = IPv6 16진 매핑 표기 SSRF 우회 · 재대조가 처리 시각을 동의 시각으로 · 이미 NO 인 고객의 탈퇴가 시계를 안 올림 / medium 1 = 정상 상태로 바뀐 주문에 모르는 상태 표식 잔존) → 전부 수용(IPv6 = 16비트 8칸으로 풀어 안의 IPv4 까지 · 쪽 원천 시각 = 요청 보낸 시각 · 탈퇴 시계 판 = 값 조건 없이 시계 · 받아들인 쓰기마다 표식 다시 씀 + 원문 글자) · **2R approve(1027)** |
| 9 | 구현 묶음 B · C(1028 · Harold 「구조체크 닫힐때까지 돌리고 수정하고 코드 수정마무리하고 보고해」) | K4 · K8 플러그인 키 · M22 · M21 · K6 · K9 · M19(앞 차례) + K11(mall-import 가져오기 CT · 고도몰 M27 · 첫 구매 보호 · 넣을 수 없는 웹훅 = processed + 사유 · action 원인 = 다시 안 부름) · K5(분류코드 몰 소속 행 NO · 우커머스 customer.deleted · 자체호스팅 선택 칸) · K7(ACTIVE_PAID_PLAN_WHERE 한 벌 · 사실 경로 90일 · 행동만 월 한도 · 사실 10배 경보선 · 카드 「연결됨 · 마지막 데이터」 · 조치 필요 = action 만 · 화면 잠금 = 서버 값) · K12(mall-origins · 몰 창마다 읽기 전용 + 예외 추가) · K8 암호화(secret-box · 읽기 이중 · 복호 실패 = 던짐 · DML-2 스크립트 · DDL-2) · M24(승인 미확정 → /oauth-confirm 확정 · 요금제 문 밖) · K14(N1 · N2 · N3 · N4 · N5 · N6 · M11 · M30) · K10 2단(mall-watch 경보 · 카페24 API 버전 거절) · K13(provider-readiness 표 · test 이상만 「됩니다」) · M25(SDK 허용 판) |
| 9-1 | 넣지 않은 것(근거) | 카페24 · 아임웹 과거 데이터 · 주기 수집(SC4 · M29) = 몰 API 의 바뀐 시각 조회 칸 원문을 확인하지 못함(카페24 개발자 문서 = 동적 화면이라 요청 칸이 안 읽힘) → K13 표 none · 리허설(§7) 원문 뒤 / 카페24 대표 도메인 = 몰 정보 필드 리허설 뒤(예외 추가 칸으로 손 등록) / 감지 워커 심장 박동 = R14 서버 스크립트 설정(운영) |
| 9-2 | 구조체크(구현) | 1회차 결함 2 = 승인 확정 화면이 요금제 문 뒤(미가입 계정 카페24 동선 끊김 → 전용 /oauth-confirm) · 렌더 검사로 드러난 기존 결함 = useApproveToken 이 모듈을 읽는 순간 앱 전체 주소 쿼리 · 해시를 지움(JourneyPausePage 즉시 import · 카페24 앱 실행 ?mall_id · 확정 ?oauth_confirm · 아임웹 ?site_code 가 읽히기 전에 사라짐 → 그 화면이 그려질 때만 · 계약 추가) |
| 9-3 | Codex 적대 리뷰(묶음 B · C) | 1R 8건(high 4 = 복호 실패 → 플랫폼 공용 자격 · 갱신이 해제한 연동을 되살림 · 고도몰 첫 가져오기 실패가 보류를 풂 · 동시 취소가 취소된 주문 날로 되돌림 / medium 4 = 서버 /identify 연결도 sdk 라 브라우저 잇기 0 · 고도몰 분류코드 누락 · 확정이 저장 전 토큰 소모 · 늦은 해제 정리가 재연결 몰 도메인 삭제) → 전부 수용(DDL-4 신설) · 2R 3(high · 확정 원자성 = 1R #7 같은 뿌리 두 번째 → 저장 CT 가 바깥 트랜잭션 실행자를 받게 구조 수정 · 서버 확인 승격 근거 · 일부 실패를 성공으로 셈 → PostgreSQL 22 · 23 계열 = 넣을 수 없는 건) · 3R 1 · 4R 1(서버 확인 근거 = 같은 뿌리 세 번째 → 근거 비교를 없애고 이번 서버 호출이 처음 만든 연결만) · 5R 1(medium · 연결과 표시 한 문장) · **6R approve(1028)** |
