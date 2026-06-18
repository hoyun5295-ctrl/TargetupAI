# 자체 자사몰 + 앱 데이터 수집 고도화 — 구현 계획 (2026-06-18)

> 실행: 인라인(이 세션). TDD(vitest 순수 매퍼 RED→GREEN) + tsc + grep. 설계 = specs/2026-06-18-selfhosted-mall-app-collection-design.md.

**목표:** 이커머스 행동 자동수집(웹+웹뷰앱) + 서버 연동 턴키·검증 + 순수 네이티브 REST 가이드.

**핵심 사실:** 전역 `hjl.track(event,props)`에 인앱 트리거 브리지(T2)·cart-estimate 이미 존재 → 이커머스 모듈이 `hjl.track`로 흘리면 인앱 트리거 자동 동작. 백엔드 ingest는 `{type:'track', event}` 그대로 적재(변경 0).

---

## 파일 구조
- Create `packages/sdk-js/src/auto-capture/ecommerce.ts` — GA4 dataLayer 매퍼(순수) + setupEcommerceTracking + 명시 헬퍼.
- Create `packages/sdk-js/src/auto-capture/__tests__/ecommerce.test.ts` — vitest TDD.
- Modify `packages/sdk-js/src/auto-capture/index.ts` — ecommerce 배선 + `hjl.ecommerce` + VERSION 0.3.6.
- Modify `packages/sdk-js/src/auto-capture/transport.ts` — SDK-Version 0.3.6-a.
- Create `packages/backend/src/routes/cdp.ts` 내 `GET /custom/deliveries`(최근 수신 로그) — 기존 라우터에 추가.
- Modify `packages/frontend/src/pages/CdpSettingsPage.tsx` — 자체 호스팅 모달에 Python 스니펫 + "최근 수신 확인" + 네이티브 앱(REST) 안내 카드.

---

## Track A — SDK 이커머스 자동수집

### Task A1: GA4 매퍼 (순수, TDD)
**Files:** Create `auto-capture/ecommerce.ts`(매퍼부) · Test `auto-capture/__tests__/ecommerce.test.ts`
- `mapGa4EcommerceEvent(push)` → `{event, properties} | null`.
  - GA4→표준: view_item→product_view, add_to_cart→cart_add, remove_from_cart→cart_remove, view_cart→cart_view, begin_checkout→checkout_start, add_to_wishlist→wishlist_add, purchase→purchase, search→search.
  - properties: currency, value(숫자), items[{product_id, product_name, price, quantity, category}] ← GA4 ecommerce.items[{item_id,item_name,price,quantity,item_category}], purchase는 order_id←transaction_id, search는 search_term.
  - 미지원 GA4 event = null.
- vitest 케이스: add_to_cart 매핑, purchase(items+value+transaction_id), 미지원 event=null, items 정규화, 콤마/문자 숫자 정규화.
- 실행 `npx vitest run src/auto-capture/__tests__/ecommerce.test.ts` (sdk-js).

### Task A2: setupEcommerceTracking + 헬퍼 + 배선 + 버전
**Files:** Modify `ecommerce.ts`(setup) · `auto-capture/index.ts` · `transport.ts`
- `setupEcommerceTracking(track)`: window.dataLayer.push 후킹(각 push를 mapGa4EcommerceEvent→track) + 기존 dataLayer 엔트리 replay + 명시 헬퍼 객체 반환(viewProduct/addToCart/removeFromCart/viewCart/checkout/purchase/addWishlist/search → 표준 track). cleanup으로 원복.
- index.ts init(): setupClickTracking 다음에 `const eco = setupEcommerceTracking((e,p)=>hjl.track(e,p)); hjl.ecommerce = eco.ecommerce;`. HjlGlobal에 `ecommerce` 추가. VERSION '0.3.5-a'→'0.3.6-a'. 스니펫 주석 v0.3.5→v0.3.6.
- transport.ts SDK-Version '0.3.5-a'→'0.3.6-a'.
- 검증: sdk-js tsc 0 + 전체 vitest pass.

## Track B — 서버 연동 턴키 + 검증

### Task B1: 최근 수신 로그 endpoint
**Files:** Modify `routes/cdp.ts` (custom 영역에 추가)
- `GET /api/cdp/custom/deliveries?limit=20` (authenticate + company_admin) → `cdp_webhook_deliveries`에서 source='custom' 최근 N건 (webhook_event, status, created_at, idempotency_key) 반환. 신규 컬럼 0.
- 검증: backend tsc 0 + 응답 형태 확인.

### Task B2: 프론트 스니펫 3종 + 검증 UI
**Files:** Modify `CdpSettingsPage.tsx` (webhook 개발 안내 영역)
- Node·PHP·Python 완성 스니펫(HMAC-SHA256 서명) — 복사 가능. 현재 Node·PHP → Python 추가.
- "최근 수신 확인" 버튼 → GET /custom/deliveries → 수신 시각·이벤트·status 표시(다크 톤, useToast).
- 검증: frontend tsc 0 + grep(모델명·native dialog·박단어) 0.

## Track C — 순수 네이티브 앱 REST 가이드

### Task C1: 네이티브 앱(REST) 안내
**Files:** Modify `CdpSettingsPage.tsx` (자체 호스팅 모달 하단)
- "네이티브 앱(REST 직접 호출)" 안내 카드: 공개키로 `/api/cdp/ingest`(이벤트)·`/api/cdp/inapp/active`(인앱) 호출 + identify/order는 고객사 서버(secret) 경유. curl + Swift(URLSession) + Kotlin(OkHttp) 예시. backend 0.
- 검증: frontend tsc 0 + grep 0.

---

## 검증 매트릭스
- sdk-js: vitest 전체 pass + tsc 0.
- backend: tsc 0.
- frontend: tsc 0 + grep(모델명·native dialog·박단어) 0.
- 운영 실측(웹/웹뷰앱 인앱 트리거)= Harold/직원.

## 배포
- sdk-js: 서버 `packages/sdk-js` `npm install --include=dev` → `npm run build:all` → `dist/iife/hanjul.min.js`를 `company-frontend/public/sdk/v0.3.6/` + `dist/sdk/v0.3.6/` 둘 다 cp(신규 버전 폴더 = 캐시 버스팅).
- frontend `build:safe` / backend `pm2 restart all`.
- 스니펫 안내의 SDK URL v0.3.5→v0.3.6 갱신(CdpSettingsPage).
