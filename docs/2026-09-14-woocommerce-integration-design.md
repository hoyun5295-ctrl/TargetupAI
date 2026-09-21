# 우커머스(WooCommerce) 자사몰 연동 설계서 · 착수 원장 (2026-09-14)

> **이 문서가 소유하는 것** = 우커머스 전용 어댑터의 설계안(Harold 동의 2026-09-14) · 계약 · 미검증 목록 · 착수 원장 W1~W8. 구현 종결 뒤 [FEATURE-CDP-INTEGRATION.md](FEATURE-CDP-INTEGRATION.md) §4 provider 현황에 흡수하고 이 문서는 시점 근거로 남긴다.
> 발동 = 일본이모(이에스페이먼트 · 박성용 경유) 연동 문의 → 고객사 회신(7항 중 5항) → Harold "우커머스 부터 해야된다고" → 설계안 동의 → "W1 착수해라".
> 관련 상설 문서 = [FEATURE-CDP-INTEGRATION.md](FEATURE-CDP-INTEGRATION.md)(§2 불변 원칙 8개 · §4 provider 현황 · §7-0 문의 기록) · API 스펙 = `INTEGRATIONS.md`.

## 0. 한 줄

**고도몰 뼈대를 복제해 `woocommerce` provider를 신설한다.** REST 키로 백필·주기 수집 + 우커머스 기본 웹훅 수신 + SDK 스니펫 1줄 + Store API 상품 조회(AI 자동제작 접점). **DDL 0 · 기존 테이블만(`company_integrations` 행 = 몰 1개).**

**★0914(2) 1클릭 연결 + 플러그인(Harold "아예 플러그인 될 수 있도록 · 끝까지")**: 우커머스 내장 앱 인증(`/wc-auth/v1/authorize` · 카페24 앱스토어 승인과 같은 흐름)으로 관리자 승인 1회 → 우커머스가 REST 키를 우리 콜백에 전달 → 우리가 REST 로 웹훅 4개 자동 생성 → 백필. 사람이 키를 발급·전달하는 단계 0. 별도로 한줄로 플러그인(zip · PHP)이 수집 스크립트 삽입·회원 식별·수신동의 REST 노출을 자동화한다.

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
| **4몰 직접 실측(0914 · Harold "고객사 직접 들어가서 봐라")**: 회원가입 폼 `/register/` 4몰 동일 플러그인(코드엠샵 M Shop · `mshop-my-account` · `mshop-mcommerce-premium-s2`) · 수신동의 필드 `mssms_agreement`(광고성 문자·알림톡) · `email_agreement` · `agree_all` · `billing_phone` 있음 · 라벨 "광고성 문자 알림톡 수신에 동의합니다" | 4몰 `/register/` HTML grep |
| **앱 인증 엔드포인트 살아 있음**: `GET /wc-auth/v1/authorize?...` → 302 `/wc-auth/v1/login/`(일본이모 · 렌즈007) | curl 0914 |
| Store API 상품 응답 형태 확정(`prices.price` 문자열 최소단위 · `currency_minor_unit` · `images[].src` · `is_in_stock` · `is_purchasable` · `permalink`) · `search` 동작(54 vs 21,648 vs 0) · `X-WP-Total(Pages)` 헤더 | ilbonimo.com Store API 실측 |
| 결제 폼(주문 메타 쪽 수신동의) 미확인: GET add-to-cart 403 · Store API add-item 201 이지만 브라우저 세션과 분리돼 `/checkout/` 이 `/cart/` 로 돌아감 | curl 0914 · 게이트 ② 실 주문으로 확인 |

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
10. **앱 인증 state 는 서명·1회용·TTL 셋 다.** 콜백 `user_id` 가 곧 state 라, 서명(HMAC · JWT 비밀 재사용) 없으면 누구나 남의 회사 행에 키를 꽂는다. 1회용은 `cdp_webhook_deliveries(oauth_state)` 행 삭제로, TTL 30분(잔존 행은 재처리 워커가 1시간 뒤 청소).
11. **콜백은 즉시 200, 무거운 일은 뒤에.** 우커머스가 200 을 못 받으면 승인 화면이 실패로 끝난다. 검증 1콜·웹훅 생성·백필은 응답 뒤 · 실패는 `meta.woo_sync_error`(화면 "조치 필요" 한 경로).
12. **플러그인은 비밀을 갖지 않는다.** SDK 공개키(몰 HTML 에 실리는 값)와 메타키만. 주문·회원 동기화 자격은 앱 인증이 서버로 직접 준다. 그래서 zip 은 공개 GET 으로 배포해도 된다.

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
| ① 1클릭 연결 | `utils/woocommerce-auth-state.ts`(순수 · 서명 state · authorize URL) · client `saveWooRestKeysFromAuth` · `ensureWooWebhooks` · `removeWooWebhooks` · `recordWooSetupError` · routes `POST /connect-url`(관리자) · `POST /auth-callback`(공개 · 우커머스 서버) · `GET /auth-return`(공개 · 브라우저 · postMessage) · 화면 `onAuthorize`(팝업 `woocommerce_auth` · `message` 수신 → 상태 재조회) | 몰 저장(pending) → 서명 state + 1회용 행 → `/wc-auth/v1/authorize?scope=read_write` → 승인 → 콜백 키 저장 → 검증 1콜 → 웹훅 4개 REST 생성(멱등 · id 를 `meta.woo_webhook_ids`) → 회원·주문 백필. 해제 시 웹훅 제거(최선) |
| ② 플러그인 | `wp-plugin/hanjullo-woocommerce/hanjullo-woocommerce.php` · `readme.txt` · `utils/zip-store.ts`(저장 zip 작성기 · 의존성 0) · `utils/woocommerce-plugin-zip.ts` · `GET /api/woocommerce/plugin.zip`(공개) · 화면 다운로드 링크 | WooCommerce → 한줄로 설정(SDK 공개키 · 수신동의 메타키 기본 `mssms_agreement,email_agreement`) · `wp_head` 스크립트 삽입 · `wp_footer` 로그인 회원 `hjl.identify` · REST 필터 2종(회원·주문 `meta_data` 에 수신동의 보장) · 연결 상태 = hanjul.ai 웹훅 개수 |

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
| W7 | backend tsc 0 · 전체 295 파일 / 4,633 통과 · frontend tsc 0 · build:safe 통과 · DDL 0 · Codex 대상 아님(돈·국세청·DDL 경로 없음). **배포완료 0914**(Harold · pm2 restart 688 · dist `api/woocommerce` 3 · `[Woo Sync] 워커 시작` 1 · 프론트 청크 `우커머스 연동` 1 · online) | **배포완료 0914** |
| W9 ① | 1클릭 연결: `woocommerce-auth-state.ts`(테스트 6) · client 키 저장·웹훅 생성·제거·설정 실패(테스트 6) · 라우트 3 + disconnect 웹훅 제거(소스 계약 6) · 화면(계약 2) · RED → GREEN · backend tsc 0 · frontend tsc 0 · 전체 297 파일 / 4,660 | **배포완료 0914(2)**(pm2 restart 690 · dist `auth-callback` 7 · 프론트 빌드 17:25) |
| W10 ② | 플러그인: PHP 1파일 + readme · `zip-store.ts`(테스트 4 · unzip -t 실물) · `woocommerce-plugin-zip.ts` · `GET /plugin.zip` · 소스 계약 3 · **PHP 문법 린트 미실행**(도커 이미지 다운로드 3회 실패 · 로컬 php 없음) → 배포 뒤 워드프레스 실환경 활성화가 첫 검증 | **배포완료 0914(2)**(`GET /api/woocommerce/plugin.zip` 200 · application/zip · 11,977 bytes = 로컬 산출물과 동일 · 오류 로그 0) · 워드프레스 실환경 검증 대기 |
| W8 | 실측 게이트 ②③. **①이 배포됐으니 순서가 바뀐다**: 관리 → 자사몰 연동 → 우커머스 → 몰 주소 입력 → "관리자 승인으로 연결" → 몰 워드프레스 관리자(고객사 담당자)가 승인 → `pm2 logs --nostream | grep "WooCommerce auth-callback"` 에서 키 수신·웹훅 +4·백필 건수 확인 → 첫 웹훅 도착 시 `grep "WooCommerce Webhook"` 로 헤더·본문 실측 → `cdp_webhook_deliveries` 행. 플러그인은 zip 을 고객사에 전달해 활성화 → WooCommerce → 한줄로 화면에 "연결됨 · 웹훅 4개" 가 뜨는지 | **대기 · 고객사 몰 관리자 승인 의존(다음 세션 첫 일)** |

### 5-0. W2~W6 설계 결정(브리핑 기록)

- **웹훅만 붙인 몰도 연결된다**: 저장 = pending · REST 키 없으면 `/connect` 는 `verified:false`(오류 아님) · 첫 웹훅 서명 통과가 연결 신호(active + connected_at). 고객사 회신 "REST 가능은 하나 쓸 일이 있는지"에 대한 답.
- **몰 식별은 URL 경로**(`/webhook/{mallId}`) 우선 · `X-WC-Webhook-Source` 헤더 보조. 같은 몰 주소를 두 회사가 적어도 secret 이 가른다(후보 행마다 서명 대조).
- **event 문자열 = `{mall}:{topic}`**: 재처리 워커가 (companyId, event, resource) 만 넘기므로 몰을 event 에 싣는다. 멱등키도 같은 접두 → 몰 간 delivery id 충돌 없음.
- **REST 요청 기준 주소 = 저장된 몰 주소(www 포함)** · 리다이렉트 0(Authorization 이 타 호스트로 흐르지 않게) · 저장 주소 호스트가 식별자 밖이면 `https://{mall}` 로 강제(SSRF).
- **주기 수집은 REST 키 있는 몰만** · 웹훅 전용 몰은 건너뛴다(매 회차 no_keys 실패를 남기면 "조치 필요"가 거짓 경보).
- **상품 provider = `woocommerce:{mall}`**(몰별 탭): AI 자동제작 `isBuildMallProvider` 가 이 형태를 몰 상품으로 인정 · 재조회는 Store API include(공개) · 회사 소속 몰만.
- **수집 허용 도메인 자동 등록**(`https://{mall}` · `https://www.{mall}`) · 실패는 저장을 막지 않는다.
- **① 은 플러그인 없이 완결**: 앱 인증(관리자 승인) → 키 자동 → 웹훅 자동 → 백필. 플러그인 ② 는 스크립트·회원 식별·수신동의 노출을 자동화하는 선택 층. 고객사 "플러그인 아니면 불가능한가" 질문의 답 = 둘 다 있다.
- **zip 은 직접 쓴다(`zip-store.ts` · 저장 방식)**: 라이브러리 추가 = 서버 npm install 단계 = 배포 함정(0826). 텍스트 몇 개라 압축 불필요.
- **범위 밖(기록만)**: `routes/*.ts` 의 `gateAdmin` 인라인 헬퍼는 고도몰·메이크샵 라우트와 같은 형태로 복제(공용 CT 로 올리는 것은 별도 과제) · 자격 평문 저장은 전 provider 공통 과제.

### 5-0-1. 운영 첫 몰 실측으로 바뀐 것(2026-09-21 · iroirotokyo.net · 경위 = `status/BUGS.md` B-0921-1·B-0921-2)

실측 도구 = `packages/backend/scripts/diagnose-woo-headers.ts`(읽기 전용 · `--timing` · `--consent` · 키·개인정보 출력 0).

- **인증 응답 헤더 상한 256KB**(`WOO_MAX_HEADER_BYTES` · `wooWideHeaderTransport`): 관리자 키로 인증된 응답에만 Query Monitor 가 `X-QM-php_errors-error-N` 을 싣는다(실측 23줄 · 21,494 bytes · Node 기본 16,384). 넘으면 `header_overflow` 문구.
- **페이지 20건**(`PAGE_SIZE`): 90일 주문 20,267건 · per_page=100 은 13.8초·1.3MB(제한 20초) · per_page=20 은 2.0초·192KB · 건당 시간도 20건 쪽이 짧다.
- **상한은 건수 · 폭주 방지선**(`MAX_BACKFILL_CUSTOMERS` 50만 · `MAX_BACKFILL_ORDERS` 20만 · `MAX_SYNC_ORDERS` 5천): 옛 회원 5,000명·주문 40,000건 상한 폐기(쇼핑몰 회원은 5,000명을 그냥 넘는다). 닿으면 `truncated` 를 상태에 남기고 화면에 말한다.
- **가져오기 = 단계(회원 → 주문) · 페이지마다 진행 저장(`meta.woo_backfill`) · 같은 페이지 재시도 3회 · 이어 가기**: 시작점은 `enqueueWooBackfill` 하나(승인 콜백 · 수동 연결 · 주기 워커) · 한 번에 한 몰 · 같은 몰은 도는 동안 한 번만. 워커는 가져오기가 안 끝난 몰(상태 없는 기존 연결 몰 포함)을 줄 세우고 그 회차 주기 수집은 건너뛴다. 주문 기준일(`orders_after`)은 시작할 때 한 번 정해 저장(회차마다 새로 계산하면 창이 밀려 페이지가 어긋난다). 정렬 = 회원 id 오름차순 · 주문 생성일 오름차순(도는 중 새 건이 뒤에 붙는다).
- **회원 조회 = `role=all` + 운영자 역할 제외**(`WOO_STAFF_ROLES` · core): 그 몰 회원 역할은 `bronze_member`(멤버십 등급) — 우커머스 기본값(`customer`)으로 부르면 0명. 등급 역할은 몰마다 달라 허용 목록을 만들 수 없다.
- **수신동의(코드엠샵)**: 값이 든 키는 `mssms_agreement_label` = `YES`/`NO`(회원 20/20 · 회원 주문 13/13 에 플러그인 도움 없이 온다). `mssms_agreement` 는 `on`/빈 값이라 해석 불가. 이메일 동의(`email_agreement_label`)는 읽는 자리가 아직 없다(추가 과제).
- **옛 실패 사유는 새 시도가 시작될 때 지운다**(`clearWooSetupError`): 연결이 성공한 뒤에도 옛 「수집 실패」가 남아 고객사가 "동일하다"고 회신했다.
- **미검증**: `bronze_member` 회원의 가입·수정에 우커머스가 회원 웹훅을 보내는지 · 전체 회원 수 · 가져오기 전 구간 완주 시간.

### 5-1. W1 설계 결정(브리핑 기록)

- 서명 검증 순수 함수는 W1에 넣지 않았다(웹훅 수신 = W2 몫 · 자체호스팅 어댑터처럼 어댑터 안에 둔다).
- 비회원 키의 휴대폰 정규화는 `normalizePhone` CT(한국 휴대폰만 통과 · 그 밖은 `order:{id}` 키로 떨어지고 phone은 원문 그대로 `identifyCustomer`에 넘어가 email·phone 매칭은 유지).
- 품목 productId는 몰 접두를 하지 않았다(`cdp_events.properties.items` 안 값 · 몰 간 충돌은 있으나 소비처가 표시용). 필요해지면 W5에서 함께 본다.
- 회원 `customFields`에 몰 이름을 넣지 않았다(어느 몰 고객인지 세그먼트가 필요하면 추가 과제).

## 6. 미검증(게이트 ②에서 확정)

- 웹훅 헤더명(`X-WC-Webhook-Topic` · `X-WC-Webhook-Signature` · `X-WC-Webhook-Source` · `X-WC-Webhook-Delivery-ID`) · 서명 인코딩(base64 HMAC-SHA256 추정 · hex 도 받음) · 최초 ping 본문(`webhook_id=` form 추정 · 주제 헤더 없으면 200 무시) · 본문 = REST v3 자원 JSON 그대로인지 · delivery id 가 재시도마다 새로 나는지(멱등키 재료).
- REST 목록 파라미터 `modified_after` · `dates_are_gmt` 지원 여부(서버가 모르면 무시 → after 바닥 90일 + 상한 50쪽 + 겹침 12시간이 덮는다) · 호스팅(AWS)이 Authorization 헤더를 지우는지(401 문구에 안내).
- Store API `include` 파라미터(상품번호 재조회) · 상품 응답 형태는 실측 확정(§5 W5) · 단 4몰 중 1몰만 봤다.
- **① 앱 인증**: 콜백 본문 필드(`consumer_key` · `consumer_secret` · `key_permissions` · `user_id`) · 우커머스가 200 을 기다리는 시간 · 승인 화면의 `app_name` 한글 표기 · 웹훅 REST 생성 본문/응답(`api_version: wp_api_v3` · 생성 직후 ping) · 몰 관리자 계정을 고객사 담당자가 갖는지. 로컬 검증 불가(콜백은 https 필수) → 운영 첫 승인 1건이 실측.
- **② 플러그인**: 워드프레스 실환경 활성화·설정 화면·`wp_head` 삽입·REST 필터 동작 · `mssms_agreement` 가 user meta 로 저장되는지(코드엠샵 내부) · SDK 버전 상수(v0.3.9)가 화면 안내와 같은지(두 곳 수동 동기). PHP 문법 린트 미실행(§5 W10).
- 수신동의 커스텀 필드가 회원 meta인지 주문 meta인지 · 실제 키 이름 · 값 표기(Y/N · 1/0 · true/false).
- 한글 이름이 first_name/last_name 어느 칸에 어떻게 들어오는지(성·이름 분리 여부).
- `date_created_gmt` 형식(시간대 표기 없는 'YYYY-MM-DDTHH:MM:SS' 추정).
- 부분 환불(`refunds[]` · 상태는 그대로)은 v1 범위 밖.

## 7. 고객사 후속(박성용 경유)

- 재질문 3항: 수신동의 메타키(관리자 화면 캡처 1장) · 규모(회원·월 주문) · 관리자 담당자.
- 요청 2: 몰별 REST **읽기** 키(consumer key/secret · 사적 경로) · 웹훅은 우리가 URL·secret을 준 뒤 고객사가 관리자에서 생성(주제 = 주문 생성/수정 · 회원 생성/수정).
- 안내 1: 워드프레스 플러그인 설치는 없다(REST 키 + 웹훅 + 테마 스크립트 1줄).
