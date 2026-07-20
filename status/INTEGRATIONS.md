# 자사몰 연동 (CDP Integrations) — SoT

> **소유 문서.** 자사몰 커넥터·CDP 파이프라인의 인증 방식·엔드포인트·코드 위치·연동 흐름·실측 상태를 한 곳에 모은다.
> provider별 인증이 제각각(OAuth / client_credentials+bcrypt / Basic / 폴링키 / webhook)이라, 이 문서 없으면 매번 코드를 다시 뜯어야 한다.
> 코드가 진실 — 이 문서와 코드가 다르면 코드가 맞다. 변경 시 이 문서 갱신.
> 최종 갱신 2026-07-06 (네이버·메이크샵 신규 구현 + 전 provider 실측 확정).

---

## 1) 한눈에 — provider 매트릭스

| Provider | 인증 방식 | connectMethod | 토큰 수명 | IP 등록 | 데이터 수신 | 실측 상태(2026-07-06) |
|----------|-----------|---------------|-----------|---------|-------------|----------------------|
| 카페24 | OAuth authorization_code | oauth | 2h / refresh 14d | 불요 | webhook + admin API | ★ active (gyunoo83, 실주문 수신) |
| 네이버 스마트스토어 | client_credentials + **bcrypt 서명** | polling | 3h / refresh 없음 | **필수(화이트리스트)** | 주문 조회(polling) | ★ active (한줄로AI, 토큰 실측) |
| 메이크샵 | client_credentials + **Basic 헤더** | polling | **5분** / refresh 없음 | 불요(실측) | 회원·주문 조회(polling) | ★ active (gyunoo83, 토큰+회원 실측) |
| 고도몰 | 폴링 키 (partner_key + 몰별 key) | polling | 없음(키) | 불요 | 주문 조회(polling) | ★ active (godo, 키 검증) |
| 아임웹 | OAuth authorization_code | oauth | 2h / refresh 90d | 불요 | webhook + admin API | 코드완료 · **앱 승인(0719)** · 스토어 등록·실측 잔여 |
| 자체 호스팅(custom) | webhook (HMAC-SHA256) | webhook | 없음 | 불요 | webhook 수신 | ★ active (self, 2개 회사) |
| ~~가비아(퍼스트몰)~~ | — | — | — | — | — | **2026-07-06 제거 — 자체호스팅 흡수(§5)** |

> **인증 3계열**: ① OAuth 리다이렉트(카페24·아임웹) ② client_credentials 자격입력·polling(네이버·메이크샵·고도몰) ③ webhook 수신(custom). 같은 client_credentials여도 서명 방식(bcrypt vs Basic)·토큰 수명(3h vs 5분)·IP 정책이 provider마다 다르다 — 추측 금지, 이 표가 실측 확정값.

---

## 2) CDP 공통 파이프라인 (모든 provider 공유)

provider 어댑터는 수신·조회한 데이터를 아래 3개 CT 함수로만 CDP에 적재한다. provider별 필드명을 이 3함수 입력 스펙에 맞춰 매핑하는 게 연동의 핵심.

### identifyCustomer (`utils/cdp-identity.ts`)
- 입력: source, externalId, email, phone, name, birthDate, gender, grade, address, customFields, smsOptIn
- 매칭 우선순위: ① (company_id, source, external_id) 기존 link → ② (company_id, email) → ③ (company_id, phone 정규화) → ④ 모두 미매칭이면 신규 INSERT
- 쓰는 테이블: `customers` + `cdp_identity_links`(company_id, source, external_id, customer_id, last_seen_at)

### syncOrder (`utils/cdp-orders.ts`)
- 입력: source, orderId, externalId(+email/phone/name), status, totalAmount, itemCount, items[], orderedAt, currency
- 동작: identifyCustomer 위임(고객·link 보장) → customers.recent_purchase_date/total_purchase_amount/purchase_count 갱신 → cdp_events 'purchase' 기록
- 매출 멱등(CT-86): status completed/paid는 `revenue_applied` 마커로 1회만 RFM 반영 / cancelled/refunded는 `revenue_reversed`로 1회만 차감 (이중 반영 차단)
- 쓰는 테이블: `customers`, `cdp_identity_links`, `cdp_events`

### trackEvent (`utils/cdp-events.ts`)
- 입력: source, eventName(표준 or 'custom_*'), externalId/anonymousId, properties(max 10KB), occurredAt
- 표준 이벤트: page_view · cart_add/remove/view · checkout_start/complete · purchase · wishlist_add/remove · product_view · search · message_click
- 쓰는 테이블: `cdp_events`(customer_id 자동 연결, 비회원은 anonymous link)

### Webhook 멱등 (`utils/cdp-idempotency.ts`)
- 저장소 `cdp_webhook_deliveries`(company_id, source, idempotency_key UNIQUE). received → processed/failed/duplicate.
- INSERT CONFLICT DO NOTHING로 중복 수신 차단. (updated_at 컬럼 없음 — 포함 시 500, 2026-06-10 교훈)

### IProviderAdapter 인터페이스 (`utils/provider-registry.ts`)
필수 8 메서드: `buildAuthorizeUrl` · `exchangeCode` · `refreshToken` · `verifyWebhookSignature` · `processWebhookEvent`(identify/order/event 호출 지점) · `extractMallIdFromWebhook` · `extractEventFromWebhook` · `buildIdempotencyKey`.
polling/webhook 전용 provider는 OAuth 메서드를 throw, webhook 없는 provider는 verify/process를 no-op으로 구현.
등록: `register-providers.ts` registerAllProviders() → registry Map → listProvidersForUI().

---

## 3) Provider별 상세

### 카페24 (OAuth)
- **코드**: `utils/cafe24-client.ts`, `routes/cafe24.ts`(+ callbackRouter), `utils/cafe24-install-state.ts`
- **인증**: authorization_code. authorize `https://{mall_id}.cafe24api.com/api/v2/oauth/authorize` · token `.../oauth/token` · API base `.../api/v2/admin/...`. 토큰 2h / refresh 14d.
- **엔드포인트**: GET `/api/cafe24/oauth/authorize?mall_id=` → callback → status → disconnect / POST `/api/cafe24/webhook`
- **연동 흐름**: mall_id 입력 → 한줄로 공식 앱 OAuth(또는 BYO 자격) → 동의 → 토큰. 카페24 앱스토어 설치 랜딩 `hanjul.ai/cafe24/launch`.
- **CDP 매핑**(processWebhookEvent): customer.created/updated→identify / order.created/updated→syncOrder / order.cancelled/refunded→syncOrder+trackEvent(custom_order_cancelled) / cart.added→trackEvent(cart_add)
- **webhook 인증**: X-API-Key 헤더(실측) 또는 HMAC-SHA256(구형). 멱등 = event_no + 본문 해시.

### 네이버 스마트스토어 (client_credentials + bcrypt) — ★ 2026-07-06 신규
- **코드**: `utils/naver-commerce-client.ts`, `utils/naver-commerce-signature-core.ts`(서명 순수 CT + vitest), `routes/naver-commerce.ts`
- **인증**: client_credentials. token `POST https://api.commerce.naver.com/external/v1/oauth2/token` (form) — client_id·timestamp(ms,5분)·grant_type=client_credentials·`client_secret_sign=Base64(bcrypt(client_id+"_"+ts, client_secret))`·type=SELF. 응답 `{data:{access_token,expires_in:10800}}`. **refresh 없음** — 만료 30분 전 재발급(저장 자격). **IP 화이트리스트 필수**(서버 egress IP를 API센터 앱에 등록 — IP는 코드/화면 비노출, 담당자 개별 안내).
- **엔드포인트**: POST `/api/makeshop`... 아니라 → POST `/api/naver-commerce/connect`(자격+store_id 검증형) · GET status · GET `/orders/preview` · DELETE disconnect. **OAuth authorize/callback 없음(2026-07-06 폐기)**.
- **주문 조회**: `/pay-order/seller/product-orders/last-changed-statuses`(증분) → `/product-orders/query`(구매자 성명·휴대폰). API 그룹 "주문 판매자" 필요.
- **CDP 매핑**: preview는 raw 반환(스키마 실측 후 매핑 확정 — ⛔ 추측 금지). 컴플라이언스: 정보성 즉시/광고성 별도 수신동의.

### 메이크샵 (client_credentials + Basic) — ★ 2026-07-06 신규
- **코드**: `utils/makeshop-client.ts`, `routes/makeshop.ts`
- **인증**: client_credentials + Basic. token `POST https://connect.makeshop.co.kr/oauth/token` — `Authorization: Basic base64(client_id:client_secret)` + form `grant_type=client_credentials&shop_uid={상점ID}`. 응답 `{data:{access_token,expires_in:300}}`. **토큰 5분** — 재발급 마진 1분(저장 자격). **IP 화이트리스트 아님**(실측). 제한 shop_uid+IP 1분 5회.
- **엔드포인트**: POST `/api/makeshop/connect`(자격+shop_uid 검증형) · GET status · GET `/preview?days=` · DELETE disconnect. webhook 없음(polling).
- **데이터 API**(Bearer, base `connect.makeshop.co.kr/api/v1/:shopId`): 회원 `GET /user`(hname·mobile·**sms_receive**·grade·birth_day·email·order_count) · 주문 `GET /order/2`(sender·mobile·pay_price·product[]). 조회 30일·limit 5000.
- **강점**: 회원 조회에 sms_receive(SMS 수신동의)가 있어 광고 발송 대상을 원천에서 가려냄(네이버엔 없음).
- **CDP 매핑**: preview raw 반환 → 실데이터 스키마 확정 후 identify/syncOrder 후속(테스트몰 회원 0건이라 미확정).
- **레거시 주의**: openapi.makeshop.co.kr(Shopkey/Licensekey 헤더 방식)은 별개 구식 — 우리는 신규 파트너센터(connect.makeshop.co.kr) 방식.

### 고도몰 (폴링 키)
- **코드**: `utils/godo-client.ts`, `utils/godo-parse.ts`(XML 순수 파서), `utils/godo-adapter.ts`, `routes/godo.ts`
- **인증**: partner_key(env `GODO_PARTNER_KEY`, 제휴사=팝폰) + key(몰별 사용자키, 입력값 meta 저장). API `POST https://openhub.godo.co.kr/godomall5/order/Order_Search.php`(form). 토큰 개념 없음.
- **엔드포인트**: POST `/api/godo/credentials`(키 저장) · POST `/api/godo/connect`(1콜 검증 → 30일 백필) · status · disconnect. webhook 없음(polling).
- **CDP 매핑**(backfillGodoOrders): 각 주문 → identify(수신동의 시)+syncOrder. 멱등 = order_id.

### 아임웹 (OAuth)
- **★2026-07-19 앱 심사 승인 완료** (파트너센터 "한줄로AI" = 승인 됨). **승인 ≠ 앱스토어 출시** — 출시는 콘텐츠를 integration_squad@imweb.me로 제출하는 별도 단계(0719 제출 완료·회신 대기). 몰의 앱 추가 진입점 = **결제·앱스토어 페이지**(동의 시 서비스 URL로 `?siteCode=S...` 리다이렉트). 사이트 관리자 "외부 서비스 연동(API) = Rest API V2"는 사방넷·플레이오토용 **구형 별개 계열** — 우리 앱이 거기 없는 것이 정상.
- **사전 점검 통과(0719)**: env 4키 설정 확인 · redirect 등록값 일치 · authorize 401·callback 400(백엔드 도달 = app.hanjul.ai `/api/*` 라우팅 정상). **실측 미검증 3건(리허설로 확정)**: token 본문 JSON vs form-urlencoded · webhook 인증 토큰 헤더명 · integration-complete의 site-info scope 요구 여부. 제출물·문구 SoT = docs/imweb-appstore/.
- **코드**: `utils/imweb-client.ts`, `routes/imweb.ts`(+ callbackRouter)
- **인증**: authorization_code. authorize `https://openapi.imweb.me/oauth2/authorize`(camelCase 파라미터 + siteCode 필수) · token `.../oauth2/token`(JSON 본문) · API base `https://openapi.imweb.me`. 토큰 2h / refresh 90d. **integration-complete PATCH가 OAuth 직후 필수**(안 하면 다른 API 차단).
- **엔드포인트**: GET `/api/imweb/oauth/authorize?site_code=` → callback(+integration-complete) → status → disconnect(+integration-cancellation) / POST `/api/imweb/webhook`. webhook 인증 = 공유 토큰 헤더(env `IMWEB_WEBHOOK_SECRET`).
- **CDP 매핑**: END_USER_SIGN_UP/UPDATE/GRADE_UPDATE→identify / ORDER_CREATE/DEPOSIT_COMPLETE→syncOrder / CANCEL/RETURN/REFUND→trackEvent / CART_ADD→trackEvent / SHIPPING→trackEvent.

### 자체 호스팅(custom)
- **코드**: `utils/custom-self-hosted-adapter.ts`, `routes/cdp.ts`(custom webhook receiver)
- **인증**: webhook. secret 발급 POST `/api/cdp/custom/issue-secret`(인증). 수신 POST `/api/cdp/webhook/custom` — 헤더 `X-Hanjullo-Company-Id`·`X-Hanjullo-Event`·`X-Hanjullo-Signature`(HMAC-SHA256 hex/base64). Body `{event, resource}`.
- **CDP 매핑**: customer.created/updated→identify / order.created/updated→syncOrder / order.cancelled/refunded→syncOrder+trackEvent.

---

## 4) 프론트 연동 UI

- `packages/frontend/src/pages/CdpSettingsPage.tsx` — 좌측 대형 "자체 호스팅"(모든 목록 외 몰 흡수) + 우측 그리드(카페24·네이버·고도몰·아임웹·메이크샵).
- 카드 클릭 → 전용 모달(connectProvider). OAuth형=리다이렉트, client_credentials형(네이버·메이크샵·고도몰)=자격 입력 폼 → connect(검증형).
- 연동 상태 = 각 `/status` API의 connected. **네이버·메이크샵은 토큰 만료 시각 미노출("연동 유지 중·자동 갱신")** — 자동 갱신 값이라 불안 유발 차단(2026-07-06 교훈).

---

## 5) 가비아(퍼스트몰) — 2026-07-06 제거·자체호스팅 흡수 (조사 결론)

- **조사 결과**: "가비아 쇼핑몰"의 실체는 **가비아 퍼스트몰**(firstmall.kr, 운영=가비아씨엔에스). 외부 연동 API는 **존재**한다(사방넷·이지어드민·플레이오토가 퍼스트몰 주문을 API로 수집 — 증거). 인증 = 관리자에서 "API ID + 판매자 ID" 발급하는 API 키 방식.
- **문제**: 카페24·네이버·메이크샵과 달리 **공개 개발자센터·오픈API 문서가 없다**(폐쇄형). 서비스 가입자만 관리자 화면에서 API 스펙 확인 가능(공급사 확인). 문서·자격 없이 추측 구현 = 옛 네이버 코드처럼 틀림 → 정식 구현 불가.
- **결정(2026-07-06)**: 무리한 추측 구현 대신 자체호스팅으로 흡수. `gabia-adapter.ts` 삭제 + register-providers 등록 해제 + 프론트 카드/오표시 제거(Shopify·식스샵 2026-07-04 흡수와 동일 결정). 옛 화면 오표시(`가비아=customInfo.hasSecret`) 근원 제거.
- **재추가 조건**: 퍼스트몰 쓰는 실고객사가 생기거나 가비아씨엔에스와 정식 연동 파트너 제휴 → 그 관리자/문서로 API 스펙 확정 → 네이버·메이크샵처럼 실측→구현 후 카드 재추가.

---

## 6) 스키마 매핑 현황 (provider 응답 → CDP 입력)

| Provider | 회원/고객 매핑 | 주문 매핑 | 상태 |
|----------|----------------|-----------|------|
| 카페24·아임웹·custom·고도몰 | processWebhookEvent/backfill에서 완료 | 완료 | 운영 중 |
| 네이버 | preview raw만 — 매핑 미확정 | preview raw만 | ⛔ 실데이터 스키마 확정 후 후속 |
| 메이크샵 | 문서 스키마 확인(hname·mobile·sms_receive 등) — preview 매핑 후속 | 문서 스키마 확인 — 후속 | ⛔ 실고객사 데이터로 최종 검증 후 매핑 |

> 네이버·메이크샵은 인증·조회까지 실측 완료. CDP 적재(identify/syncOrder) 매핑은 실고객사 데이터(preview raw)로 스키마 확정 후 붙인다 — 응답 스키마 추측 금지 룰(테스트몰 비어 있으면 list 내부 필드 미확인).
