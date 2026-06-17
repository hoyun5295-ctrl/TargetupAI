# 고도몰(NHN커머스) 커넥터 구현 계획 — 2026-06-18

> **실행자 주의:** TDD(순수 함수 RED→GREEN) + `.verify.ts`(ts-node) 검증. 외부 키·IP 전엔 live 0 → 순수 함수만 검증, 실측 1건은 키 도착 시.

**목표:** 고도몰 주문조회(Order_Search) 응답을 파싱해 한줄로 CDP(`syncOrder`)로 백필하는 BYO-키 폴링 커넥터.

**구조:** 독립 폴링 커넥터(`utils/godo-client.ts` + `routes/godo.ts`). provider-registry(OAuth/Webhook 전용)엔 미등록. `partner_key`=한줄로 env, `key`=고객 몰(회사별 meta).

**스택:** axios(POST form) + fast-xml-parser(XML) + cdp-orders/cdp-identity CT + company_integrations.meta.

---

## 확정 스펙 (godo_spec_extract.txt)
- 도메인: real `https://openhub.godo.co.kr`, sandbox `http://sbopenhub.godo.co.kr`. 주문조회 `POST /godomall5/order/Order_Search.php`.
- 인증 body: `partner_key`(제휴사=한줄로) + `key`(쇼핑몰=고객). 둘 다 STRING 필수.
- 응답 XML: `<data><header><code/><msg/><lastOrder/></header><return><order_data/>…</return></data>`. UTF-8.
- RETURN: 000 성공 / 999 인증키X / 998 제휴사키X / 997 사용기간X / 996 허용IP X / 995 권한X / 201 30일초과 / 202 기간·주문번호 필수.
- 페이지네이션: Request `size`(페이지당) + `lastOrder`(직전 마지막 orderNo, `orderNo < lastOrder` 조회). Response header `lastOrder`(true/false=다음 페이지 유무). 즉 커서.
- 30일 초과 조회 불가(201) → 백필은 30일 윈도우로 분할.
- Rate limit: 1초 100회+ → 429. 응답헤더 `ratelimit-available-level=EXHAUSTED`면 중단.

## 주문 필드 매핑 (§4.1)
- orderId ← `orderNo`, externalId ← `memId`(없으면 `guest:{orderCellPhone}` → 없으면 `order:{orderNo}`)
- phone ← orderInfoData.`orderCellPhone`(없으면 `orderPhone`), name ← `orderName`, email ← `orderEmail`, smsOptIn ← orderInfoData.`smsFl`(parseConsentValue)
- totalAmount ← `settlePrice`(>0) 아니면 `totalGoodsPrice`+`totalDeliveryCharge`
- items ← orderGoodsData[] {productId:goodsNo, productName:goodsNm, price:goodsPrice, quantity:goodsCnt}
- orderedAt ← `orderDate`, status ← `orderStatus`(§7.1 매핑)

## 주문상태코드(§7.1) → syncOrder status
- paid: p1 g1 g2 g3 g4 e1 e2 e3 e4 e5 z2
- completed: s1 d2 z4 z5
- shipping: d1 z3
- pending: o1 f1 f2 f3 f4 z1 (+미지 코드)
- cancelled: c1 c2 c3 c4
- refunded: r1 r2 r3 b1 b2 b3 b4

---

## Task 1: 순수 함수 — 상태/날짜/숫자 + XML 파서 (TDD)
**Files:** Create `packages/backend/src/utils/godo-client.ts`(순수부) · Test `packages/backend/src/utils/godo-client.verify.ts`
- `mapGodoOrderStatus(code)` → enum (위 표). 미지 코드 = 'pending'.
- `parseGodoOrderResponse(xml)` → `{code,msg,hasNext,lastOrderNo,orders[]}` (fast-xml-parser, order_data/orderGoodsData/orderInfoData/claimData isArray).
- `mapGodoOrderToCdp(order)` → `{ order: OrderInput; smsOptIn?: boolean } | null`.
- verify: 합성 XML(단일/복수 order_data, 비회원, 취소, 금액 fallback)으로 RED→GREEN.

## Task 2: HTTP + 백필 순회 (thin)
**Files:** Modify `godo-client.ts`
- `fetchGodoOrderPage({key,startDate,endDate,size,lastOrder,sandbox})` → axios POST form, 429/`ratelimit-available-level`/RETURN code 분기.
- `backfillGodoOrders(companyId,{days,sandbox})` → 30일 윈도우 분할 + size+lastOrder 커서 순회 → consent 있으면 identifyCustomer, 그다음 syncOrder. dedup은 syncOrder 멱등(order_id)로 보장.
- `saveGodoCredentials(companyId,key)` / `getGodoCredentials(companyId)` (company_integrations.meta.godo_key, status).

## Task 3: routes/godo.ts + app 배선
**Files:** Create `routes/godo.ts` · Modify `app.ts`
- `router.use(authenticate)`; company_admin 게이팅 + isCdpEnabledForPlan.
- `POST /api/godo/credentials`(key 저장) · `POST /api/godo/connect`(백필 트리거) · `GET /api/godo/status` · `DELETE /api/godo/disconnect`.
- `app.use('/api/godo', godoRoutes)`.

## Task 4: 연동센터 UI — godo BYO 폼
**Files:** Modify `packages/frontend/src/pages/CdpSettingsPage.tsx`
- godo를 webhookProviderOpen에서 분리 → 전용 분기. 쇼핑몰 인증키(key) 입력 폼 + "저장하고 연동"(POST credentials → POST connect). 카페24 BYO와 동일 톤(다크+violet, useToast).

## 검증
- backend tsc 0 (`packages/backend/node_modules/typescript/bin/tsc --noEmit -p packages/backend/tsconfig.json`)
- frontend tsc 0
- `godo-client.verify.ts` 전건 PASS
- grep 0: 모델명 / native dialog / 박-단어
- 실측 1건 = partner_key·서버 IP 허용 등록 후 (Harold/직원)

## 배포 주의
- 신규 의존성 `fast-xml-parser` → 서버 `npm install` 후 build:safe.
- `GODO_PARTNER_KEY` env 설정(약 3일 후 발급).
- 한줄로 서버 IP를 NHN에 허용 등록(996 방지).
