# 우커머스(WooCommerce) 자사몰 연동 설계서 · 착수 원장 (2026-09-14)

> **이 문서가 소유하는 것** = 우커머스 전용 어댑터의 설계안(Harold 동의 2026-09-14) · 계약 · 미검증 목록 · 착수 원장 W1~W8. 구현 종결 뒤 [FEATURE-CDP-INTEGRATION.md](FEATURE-CDP-INTEGRATION.md) §4 provider 현황에 흡수하고 이 문서는 시점 근거로 남긴다.
> 발동 = 일본이모(이에스페이먼트 · 박성용 경유) 연동 문의 → 고객사 회신(7항 중 5항) → Harold "우커머스 부터 해야된다고" → 설계안 동의 → "W1 착수해라".
> 관련 상설 문서 = [FEATURE-CDP-INTEGRATION.md](FEATURE-CDP-INTEGRATION.md)(§2 불변 원칙 8개 · §4 provider 현황 · §7-0 문의 기록) · API 스펙 = `INTEGRATIONS.md`.

## 0. 한 줄

**고도몰 뼈대를 복제해 `woocommerce` provider를 신설한다.** REST 키로 백필·주기 수집 + 우커머스 기본 웹훅 수신 + SDK 스니펫 1줄 + Store API 상품 조회(AI 자동제작 접점). **DDL 0 · 기존 테이블만(`company_integrations` 행 = 몰 1개).**

## 1. 출발점(실측 · 2026-09-14)

| 사실 | 근거 |
|---|---|
| 우커머스 전용 어댑터 없음. 0704에 "자체호스팅 웹훅으로 흡수" | `utils/provider-registry.ts:12` · `register-providers.ts:4` |
| 자체호스팅 규격은 고객사 개발자가 우리 표준(`X-Hanjullo-*` 헤더 · `{event, resource}` 본문)으로 직접 쏘는 방식 | `utils/custom-self-hosted-adapter.ts` 머리 주석 |
| 복제할 뼈대: 고도몰(키 입력 → 검증 1콜 → 90일 백필 → 30분 워커 · 키는 `company_integrations.meta`) · 카페24 웹훅 수신(raw body 서명 · `cdp_webhook_deliveries` UNIQUE 멱등) · 적재 CT(`identifyCustomer` · `syncOrder` · `parseConsentValue`) | `utils/godo-client.ts` · `utils/godo-sync-worker.ts` · `routes/cafe24.ts` · `utils/cdp-identity.ts` · `utils/cdp-orders.ts` |
| 순수 매핑 선례 = `godo-parse.ts`(DB import 0 · 수신동의 raw만 반환 · IO 층이 `parseConsentValue`) | `utils/godo-parse.ts` 머리 주석 |
| source 문자열 `'woocommerce'`를 이미 아는 소비처 2곳 | `utils/unified-customer-profile.ts:22,36`(priority 2) · `utils/cdp-diagnostics.ts:106~114`(active_sources) |
| 고객사 4몰 전부 `/wp-json/` 200 · `/wp-json/wc/v3/orders` 401 `woocommerce_rest_cannot_view`(REST 살아 있음 · 인증 필요) · `/wp-json/wc/store/v1/products?per_page=1` 200(공개) | 외부망 curl(0914) |
| 고객사 회신 5/7: 몰 4개(일본이모 · 이로이로도쿄 · 렌즈007 · 렌즈고고) · 워드프레스 + AWS · REST 키 발급 가능 · 테마 스크립트 1줄 가능 · 수신동의 = 커스텀 필드 별도 있음. 미회신 = 관리자 담당자 · 규모 · 웹훅 생성 여부 | 박성용 전달(0914) |

## 2. 불변 원칙

1. **DDL 0.** `company_integrations` 행 = 몰 1개(`mall_id` = 몰 호스트 · UNIQUE(company_id, provider, mall_id)). REST 키·웹훅 secret은 행별 `meta`.
2. **몰 식별자는 한 함수(`normalizeWooMallId`)만 만든다.** 연결 폼 입력과 웹훅 발신 주소가 같은 함수를 지나 같은 행을 가리킨다.
3. **다몰 접두.** externalId·orderId = `{mallId}:{id}`. 워드프레스 user id·주문 id는 몰마다 1부터 겹친다(카페24·고도몰은 몰 1개라 접두 없음).
4. **매출 반영은 paid·completed 만**(CT-86). 미지의 상태 → `pending`(매출 미반영이 안전).
5. **식별 수단 없는 회원은 적재하지 않는다.** email·phone 둘 다 없으면 매핑 null(삭제 웹훅 `{id}`만 오는 경우 포함 · 빈 고객 생성 차단).
6. **수신동의는 고객사가 알려 준 메타키 하나로 읽는다.** 키 미설정 = undefined = 기존값 유지(신규는 false). 값 해석은 `parseConsentValue` 한 곳.
7. **저장 ≠ 연결.** 자격 저장 = `pending`, 검증 1콜 성공 시에만 `active` + `connected_at`(LESSONS_BACKEND 자사몰 연동 절).
8. **수집 실패로 연동 상태를 끊지 않는다.** 워커 실패 = `meta.*_sync_error` 기록만(고도몰 계약 테스트와 같은 규약).
9. **웹훅 헤더명·서명 인코딩·본문 형식은 게이트 ② 실측 전까지 "미검증"이다.** 그 전 코드는 관대하게(hex·base64 둘 다 · 본문 필드 없으면 skip) 두고 실측 뒤 한 줄로 조인다.

## 3. 구조(파일별 소유)

| 층 | 파일 | 몫 |
|---|---|---|
| 순수 코어 | `utils/woocommerce-core.ts` | `WOO_SOURCE` · `mapWooOrderStatus` · `normalizeWooMallId` · `wooFullName` · `wooMetaValue` · `wooDateToIso` · `wooTopicKind` · `mapWooCustomerToCdp` · `mapWooOrderToCdp` (DB·IO 0) |
| 클라이언트 | `utils/woocommerce-client.ts` | REST v3 Basic(consumer key/secret · 헤더만 · 리다이렉트 0) · 기준 주소 = 저장 몰 주소 origin(식별자 밖 호스트면 `https://{mall}`) · 검증 1콜(주문 1건) · 백필(회원 → 주문 90일 · `X-WP-TotalPages` 끝까지 · 회원 상한 50쪽) · 주기 수집 `syncWooOrdersSince`(modified_after + after 바닥 90일 + dates_are_gmt · 상한 50쪽) · 자격 저장(pending · secret 발급 · 수집 허용 도메인 자동 등록) · `processWooResource`(적재 한 함수) · Store API 상품(`fetchWooStoreProducts[Raw]`) |
| 어댑터 | `utils/woocommerce-adapter.ts` | `IProviderAdapter`(connectMethod `polling` · webhook·서명 true) · `verifyWebhookSignature`(base64·hex 둘 다 · timingSafe) · event = `{mall}:{topic}`(`parseWooEvent`) · `processWebhookEvent` → 행 meta 수신동의 키 → `processWooResource` · 멱등키 = CT-85(delivery_id 우선 · 자원 id 엔티티) |
| 라우트 | `routes/woocommerce.ts` | POST `/webhook/:mallId`(공개 · rawBody · 후보 행마다 서명 대조 · 미연동 200 무시 · 서명 실패 401 · 주제 없음(ping) 200 · 첫 통과 = active · `cdp_webhook_deliveries` 멱등) · POST `/credentials` · `/connect` · `/rotate-secret` · GET `/status` · DELETE `/disconnect?mall_id=` · 관리자 게이트 · companyId 세션에서만 |
| 워커 | `utils/woocommerce-sync-worker.ts` | 고도몰 규약(30분 · 몰별 격리 · 실패 = `meta.woo_sync_error` 만 · 커서 전진 1곳 · 상한 90일 = 백필 깊이 · 겹침 12시간 · REST 키 없는 몰 건너뜀) · `app.ts startWoocommerceSyncWorker` |
| 화면 | `frontend/utils/cdp-provider-keys.ts` 행 `woocommerce`(auto) · `CdpConnectForms.tsx CdpWooConnectForm` · `utils/woocommerce-guide.ts` · `CdpSettingsPage.tsx` 배선 | 몰 목록(연결·웹훅 대기·수집 실패) + 추가 폼(몰 주소 · key/secret · 수신동의 메타키) · 저장 직후 웹훅 URL·secret 1회 표시 · 개발자 안내 복사(secret 제외 · 주제 4종 · SDK 한 줄) · 비밀키 재발급 · 몰별 해제 · SDK head 스크립트 + 워드프레스 body 속성(선택) |
| 상품 | `routes/mall-products.ts` · `utils/mall-product-match.ts` · `utils/mall-product-normalize.ts normalizeWooStoreProduct` · `ai-auto-build-materials.ts isBuildMallProvider` · `campaign-quick.ts lookupMallProductsByNo` | provider 탭 = `woocommerce:{mall}`(몰별) · Store API 공개 검색·미리보기 · 이름 매칭 순회 · AI 자동제작 재조회(include=ids · 품절 = 제외 + 사유) · 회사 소속 몰만(`getWooIntegration`) |

## 4. 매핑 계약(W1 확정 · 테스트 `__tests__/woocommerce-core.test.ts` 33건)

| 항목 | 규칙 |
|---|---|
| 몰 식별자 | `https://www.ilbonimo.com/` → `ilbonimo.com`(호스트 · www 제거 · 소문자 · 경로/쿼리/포트 무시). 점 없는 호스트·허용 문자 밖 → null |
| 주문 상태 | processing → paid · completed → completed · cancelled → cancelled · refunded → refunded · pending/on-hold/failed/checkout-draft → pending · 그 밖(trash · 플러그인 커스텀) → pending · `wc-` 접두 제거 |
| 회원 → IdentifyInput | externalId `{mall}:{id}` · email = 회원 email → billing.email · phone = billing.phone → shipping.phone · name = 한글이면 성+이름 붙여쓰기('홍길동') 그 밖 'first last' · address = billing address_1 + address_2 · consentRaw = meta_data[consentMetaKey] |
| 주문 → OrderInput | orderId `{mall}:{id}` · externalId = `{mall}:{customer_id}`(회원) → `{mall}:guest:{normalizePhone}`(비회원 · 한국 휴대폰만 정규화됨) → `{mall}:order:{id}` · totalAmount = total 문자열 → 숫자(콤마 제거 · 불가 0) · items = line_items(productId · productName · price(unit → total/quantity) · quantity) · itemCount = 품목 수 · orderedAt = date_created_gmt + 'Z' → date_created · currency 기본 KRW |
| 웹훅 주제 | `order.*` · `customer.*`(created/updated/deleted/restored)만 인정 · product/coupon/action → null |
| 적재 불가(null) | id·mallId 누락 · 주문시각 누락(삭제 페이로드 `{id}`) · 회원 식별 수단 없음 |

## 5. 착수 원장

| T | 내용 | 상태 |
|---|---|---|
| W1 | 순수 매핑 코어 `utils/woocommerce-core.ts` + 테스트(35건 · IP·80자 거부 포함). RED(모듈 부재) → GREEN | **완료 0914** |
| W2 | `woocommerce-client.ts` · `woocommerce-adapter.ts` · `routes/woocommerce.ts` · `register-providers` · `app.ts`(리미터·rawBody 경로·마운트) · 테스트 = client 27 · adapter 13 · routes 소스 계약 12. RED(모듈 부재) → GREEN | **완료 0914** |
| W3 | `woocommerce-sync-worker.ts` + 테스트 10(창 계산 순수 + 소스 계약) · `app.ts` 기동 | **완료 0914** |
| W4 | provider 행 7종 · `CdpWooConnectForm` · `woocommerce-guide.ts` · `CdpSettingsPage` 배선 · `cdp-provider-keys.contract.test.ts` 갱신(7종 · 라우트 6종 · 폼 6종 · 우커머스 화면 계약 5) · frontend tsc 0 | **완료 0914** |
| W5 | Store API 실측(ilbonimo.com 상품 1건 raw · search 54 vs 21,648 vs 0) → `normalizeWooStoreProduct`(테스트 4) · `fetchWooStoreProducts[Raw]`(테스트 3) · mall-products 3 라우트 분기 · 이름 매칭 순회 · AI 자동제작 `woocommerce:{mall}` 인정(테스트 2) + 재조회 분기 | **완료 0914** |
| W6 | 내 적대 검토 → 정정 4: ①리다이렉트 0 + 기준 주소 = 저장 몰 주소(www) · 식별자 밖 호스트 차단(SSRF) ②`orderby=modified` 폐기(문서 밖) → `date` + `dates_are_gmt` ③주기 수집 상한 50쪽(modified_after 무시 시 90일치 폭주 차단) ④301 = `redirect` 코드로 주소 정정 안내. 그 밖 = §6 미검증 | **완료 0914** |
| W7 | backend tsc 0 · 전체 295 파일 / 4,633 통과 · frontend tsc 0 · build:safe 통과 · DDL 0 · Codex 대상 아님(돈·국세청·DDL 경로 없음). 커밋·배포 = Harold | **코드완료 · 배포 대기** |
| W8 | 고객사 키 도착 시 실측 게이트 ②(웹훅 1건 수신 → 헤더·서명·본문·수신동의 메타키 확정) · ③(SDK 삽입 리허설) | 대기 · 고객사 의존 |

### 5-0. W2~W6 설계 결정(브리핑 기록)

- **웹훅만 붙인 몰도 연결된다**: 저장 = pending · REST 키 없으면 `/connect` 는 `verified:false`(오류 아님) · 첫 웹훅 서명 통과가 연결 신호(active + connected_at). 고객사 회신 "REST 가능은 하나 쓸 일이 있는지"에 대한 답.
- **몰 식별은 URL 경로**(`/webhook/{mallId}`) 우선 · `X-WC-Webhook-Source` 헤더 보조. 같은 몰 주소를 두 회사가 적어도 secret 이 가른다(후보 행마다 서명 대조).
- **event 문자열 = `{mall}:{topic}`**: 재처리 워커가 (companyId, event, resource) 만 넘기므로 몰을 event 에 싣는다. 멱등키도 같은 접두 → 몰 간 delivery id 충돌 없음.
- **REST 요청 기준 주소 = 저장된 몰 주소(www 포함)** · 리다이렉트 0(Authorization 이 타 호스트로 흐르지 않게) · 저장 주소 호스트가 식별자 밖이면 `https://{mall}` 로 강제(SSRF).
- **주기 수집은 REST 키 있는 몰만** · 웹훅 전용 몰은 건너뛴다(매 회차 no_keys 실패를 남기면 "조치 필요"가 거짓 경보).
- **상품 provider = `woocommerce:{mall}`**(몰별 탭): AI 자동제작 `isBuildMallProvider` 가 이 형태를 몰 상품으로 인정 · 재조회는 Store API include(공개) · 회사 소속 몰만.
- **수집 허용 도메인 자동 등록**(`https://{mall}` · `https://www.{mall}`) · 실패는 저장을 막지 않는다.
- **범위 밖(기록만)**: `routes/*.ts` 의 `gateAdmin` 인라인 헬퍼는 고도몰·메이크샵 라우트와 같은 형태로 복제(공용 CT 로 올리는 것은 별도 과제) · 자격 평문 저장은 전 provider 공통 과제.

### 5-1. W1 설계 결정(브리핑 기록)

- 서명 검증 순수 함수는 W1에 넣지 않았다(웹훅 수신 = W2 몫 · 자체호스팅 어댑터처럼 어댑터 안에 둔다).
- 비회원 키의 휴대폰 정규화는 `normalizePhone` CT(한국 휴대폰만 통과 · 그 밖은 `order:{id}` 키로 떨어지고 phone은 원문 그대로 `identifyCustomer`에 넘어가 email·phone 매칭은 유지).
- 품목 productId는 몰 접두를 하지 않았다(`cdp_events.properties.items` 안 값 · 몰 간 충돌은 있으나 소비처가 표시용). 필요해지면 W5에서 함께 본다.
- 회원 `customFields`에 몰 이름을 넣지 않았다(어느 몰 고객인지 세그먼트가 필요하면 추가 과제).

## 6. 미검증(게이트 ②에서 확정)

- 웹훅 헤더명(`X-WC-Webhook-Topic` · `X-WC-Webhook-Signature` · `X-WC-Webhook-Source` · `X-WC-Webhook-Delivery-ID`) · 서명 인코딩(base64 HMAC-SHA256 추정 · hex 도 받음) · 최초 ping 본문(`webhook_id=` form 추정 · 주제 헤더 없으면 200 무시) · 본문 = REST v3 자원 JSON 그대로인지 · delivery id 가 재시도마다 새로 나는지(멱등키 재료).
- REST 목록 파라미터 `modified_after` · `dates_are_gmt` 지원 여부(서버가 모르면 무시 → after 바닥 90일 + 상한 50쪽 + 겹침 12시간이 덮는다) · 호스팅(AWS)이 Authorization 헤더를 지우는지(401 문구에 안내).
- Store API `include` 파라미터(상품번호 재조회) · 상품 응답 형태는 실측 확정(§5 W5) · 단 4몰 중 1몰만 봤다.
- 수신동의 커스텀 필드가 회원 meta인지 주문 meta인지 · 실제 키 이름 · 값 표기(Y/N · 1/0 · true/false).
- 한글 이름이 first_name/last_name 어느 칸에 어떻게 들어오는지(성·이름 분리 여부).
- `date_created_gmt` 형식(시간대 표기 없는 'YYYY-MM-DDTHH:MM:SS' 추정).
- 부분 환불(`refunds[]` · 상태는 그대로)은 v1 범위 밖.

## 7. 고객사 후속(박성용 경유)

- 재질문 3항: 수신동의 메타키(관리자 화면 캡처 1장) · 규모(회원·월 주문) · 관리자 담당자.
- 요청 2: 몰별 REST **읽기** 키(consumer key/secret · 사적 경로) · 웹훅은 우리가 URL·secret을 준 뒤 고객사가 관리자에서 생성(주제 = 주문 생성/수정 · 회원 생성/수정).
- 안내 1: 워드프레스 플러그인 설치는 없다(REST 키 + 웹훅 + 테마 스크립트 1줄).
