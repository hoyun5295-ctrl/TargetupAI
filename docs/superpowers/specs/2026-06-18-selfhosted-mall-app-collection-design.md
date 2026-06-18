# 자체 자사몰 + 앱 데이터 수집 고도화 — 설계 (2026-06-18)

## 목표
자체 자사몰(custom) + 웹뷰 하이브리드 앱 + 순수 네이티브 앱이 한줄로 CDP로 행동·주문을 빠짐없이 수집하고, 인앱 메시지가 장바구니·구매 같은 행동 트리거로 매끄럽게 작동하게 한다.

## 배경 (확정 사실)
- 어제(2026-06-17) **인앱 메시지 웹/앱 채널 분리 + 웹뷰 앱 지원** 배포완료. 웹뷰 앱은 JS SDK 한 벌(`data-hjl-platform="app"`)로 작동. 단 자동수집은 `page_view`·`click`·`identify`·`consent`까지 — **이커머스 행동(cart/purchase) 자동수집 미비**.
- 인앱 트리거 표준 이벤트 = `cart_add`·`cart_view`·`page_view`·`checkout_start`(cdp-events.ts). 즉 **이커머스 수집이 있어야 장바구니·구매 트리거 인앱이 작동**.
- 브라우저 ingest의 `normalizeBrowserEvent`는 `{type:'track', event:'<표준명>'}` 이벤트를 `validateEventName` 통과 시 그대로 적재 → **이커머스 이벤트를 track 타입으로 쏘면 백엔드 변경 0**.
- 표준 event_name(types.ts `StandardEventName`): page_view·cart_add·cart_remove·cart_view·checkout_start·checkout_complete·purchase·wishlist_add·wishlist_remove·product_view·search. 백엔드·SDK 타입 일치.

## Track A — SDK 이커머스 자동수집 (sdk-js만, 백엔드·DB 0)
- 신규 `packages/sdk-js/src/auto-capture/ecommerce.ts` = `setupEcommerceTracking(emit)`:
  - **GA4 dataLayer 자동수집**: `window.dataLayer.push` 후킹 → GA4 이커머스 이벤트(view_item→product_view, add_to_cart→cart_add, remove_from_cart→cart_remove, view_cart→cart_view, begin_checkout→checkout_start, add_to_wishlist→wishlist_add, purchase→purchase, search→search)를 표준명으로 매핑 → `{type:'track', event, properties:{value, currency, items:[{product_id, product_name, price, quantity, category}]}}` emit. GTM/GA4 쓰는 몰은 코딩 0.
  - **명시 헬퍼**: `window.hjl.ecommerce.{viewProduct, addToCart, removeFromCart, viewCart, checkout, purchase, addWishlist, search}` — dataLayer 없는 몰용 한 줄 호출.
- 순수 매퍼 `mapGa4EcommerceEvent(push)` → `{event, properties} | null` = vitest TDD(기존 `__tests__` 패턴).
- **platform 인지**: 전역 init `auto-capture/index.ts`(window.hjl)에 ecommerce 모듈 배선 → web + 웹뷰앱(`data-hjl-platform='app'`) 양쪽에서 동작 → 인앱 트리거를 양 채널에 공급.
- **백엔드·DB 무변경**. SDK 버전 bump(v0.3.5 → v0.3.6 — 캐시 버스팅, 메모리 다음세션 후보 #1) + 재빌드·min.js 서빙.

## Track B — 서버 연동 턴키 + 검증 (frontend 모달 + 작은 backend)
- `CdpSettingsPage` 자체 호스팅(custom) 모달:
  - **완성 스니펫 3종** — Node·PHP·**Python**(현재 Node·PHP), HMAC 서명 포함 복사 가능(SecretRow 스타일).
  - **연결 검증** — "최근 수신 확인" 버튼 → 우리가 받은 webhook 수신 로그(수신 시각·이벤트·서명 성공/실패) 표시 → 고객이 자기 webhook 도착을 즉시 확인.
- backend `GET /api/cdp/custom/deliveries`(최근 N건 수신 로그, company_admin) — `cdp_webhook_deliveries` 재사용(신규 컬럼 0, 기존 webhook 적재 로그 조회만).

## Track C — 순수 네이티브 앱 REST 연동 가이드 (frontend + 문서, backend 0)
- 네이티브 앱(웹뷰 아님) = **공개키로 `/api/cdp/ingest`(이벤트)·`/api/cdp/inapp/active`(인앱) 직접 호출** + 민감 작업(identify/order)은 **고객사 서버(secret) 경유**. (브라우저 모델과 동일 — secret을 앱에 넣지 않음.)
- `CdpSettingsPage`에 "네이티브 앱(REST)" 안내 카드 + curl/Swift/Kotlin 호출 예시. REST 엔드포인트는 이미 존재 → **신규 backend 0**.

## 검증
- sdk-js: vitest(mapGa4EcommerceEvent + setupEcommerceTracking) RED→GREEN + tsc 0.
- backend: tsc 0 + deliveries endpoint verify.
- frontend: tsc 0 + grep(모델명·native dialog·박단어) 0.
- 운영 실측(웹/웹뷰앱 인앱 트리거)= Harold/직원([[feedback_no_operation_verification_by_ai]]).

## 빌드 순서
A(SDK 이커머스 자동수집) → B(서버 턴키 + 검증) → C(네이티브 REST 가이드). 셋 다 독립.

## 배포 주의
- sdk-js: 버전 bump(v0.3.6) + 재빌드 + `public/sdk/v0.3.6/` + `dist/sdk/v0.3.6/` 둘 다 cp(캐시 버스팅 — v0.3.5 내용만 갱신 시 옛 SDK 캐시 잔존 위험). 서버 `npm install --include=dev`(rollup·vitest devDep) 후 `npm run build:all`.
- frontend: `build:safe`. backend: `pm2 restart all`(deliveries endpoint).

## 보류 (별도 트랙)
- 순수 네이티브 SDK(Swift/Kotlin) 풀개발 = 클라우드 빌드(GitHub Actions macOS 러너) 깔고 별도. 현재는 Track C REST 가이드로 대응.
