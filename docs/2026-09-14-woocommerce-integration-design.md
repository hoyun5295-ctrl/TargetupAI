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
| **4몰 직접 실측(0914 · Harold "고객사 직접 들어가서 봐라")**: 회원가입 폼 `/register/` 4몰 동일 플러그인(코드엠샵 M Shop · `mshop-my-account` · `mshop-mcommerce-premium-s2`) · 수신동의 필드 `mssms_agreement`(광고성 문자·알림톡 · **★1001 정정: 값이 든 키는 `mssms_agreement_label` — §6 실측 · 플러그인 1.0.1 기본값 교체**) · `email_agreement` · `agree_all` · `billing_phone` 있음 · 라벨 "광고성 문자 알림톡 수신에 동의합니다" | 4몰 `/register/` HTML grep |
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
- **★0922 안내 대상(렌즈고고 · 실측)**: 재가져오기 뒤 소속 94,849명 중 문자 동의 값 **모름 39,318명(41%)**. 원인 확정 = 우커머스 회원 ID 70,000 이전 가입자(약 4.8만 명)의 **81%가 `mssms_agreement_label` 키 자체가 없다**(ID 70,000 이후는 8%→1%→0%). 몰에 수신동의 항목이 생기기 전 가입자다. 키는 맞다(최근 가입 20명 전부 YES/NO 보유 · `diagnose-woo-headers.ts --consent`). **우리 쪽 수정 없음.** 몰 동의 읽기(D93 ENV)를 켜면 렌즈고고 발송 대상은 YES 24,833명이고 모름은 제외된다. 재동의 수집(로그인 시 동의 팝업 등)은 몰 몫이고, 값이 채워지면 웹훅·주기 수집으로 자동 반영된다. **이로이로도쿄(0923 확인)**: 모름 2,971명(1.0%)뿐이고 회원 계정 중 모름은 291명(ID 5만 이하 옛 계정 46 + 최근 구간 소량). 나머지 약 2,680은 회원 ID 없는 소속(비회원 주문자)이라 동의 메타가 원래 없다. 4몰 발송 가능(YES) 합 = 200,330명. 검증 SQL = 회원 ID 1만 단위 구간별 `customer_stores.sms_opt_in IS NULL` 비율(`cdp_identity_links.external_id ~ '^{mall}:[0-9]+$'` 조인).

## 8. 2026-10-01 운영 4몰 전수점검(이에스페이먼트 실측 · 경위 = `status/BUGS.md` B-1001-7 · B-1001-8 · B-1001-9)

> 원칙 하나: **고객사가 새로 설치·재연결할 것 없이 배포만으로 바로잡힌다.** 플러그인 재설치 0 · 화면 조작 0.

### 8-1. 불변(추가)

10. **몰 식별자는 처음 것 그대로다.** 도메인이 바뀌어도 `mall_id` 는 안 바뀐다 — 주문번호·회원번호 접두(`{mall}:{id}`)가 갈리면 같은 주문이 두 번 매출에 들어간다. 새 주소는 그 행의 **증명된 주소**(`meta.woo_seen_hosts`)로만 붙는다.
11. **몰의 다른 주소는 서명이 증명한다.** 증명된 주소 = 서명 검증을 통과한 웹훅 본문의 자기 주소(`_links.self` 의 https 호스트)뿐. 배우는 때는 둘이다 — 웹훅을 받는 순간, 그리고 인증 호출이 증명 안 된 호스트로 이동(3xx)을 받았을 때 그 호스트를 **이미 저장된 서명 검증 웹훅 기록**(그 회사 · 그 몰 · 최근 7일 · `cdp_webhook_deliveries` source woocommerce · 연결 승인용 임시 행 제외)에서 찾는 때(`learnWooHostFromSignedDeliveries`). 받는 순간에만 배우면 웹훅이 뜸하거나 꺼진 몰은 이동을 영영 못 따라간다. 입력값·리다이렉트 Location 만으로는 주소가 되지 않는다(옛 도메인이 남의 손에 넘어가면 REST 키가 그쪽으로 간다).
    **한 회사 안에서 호스트 하나는 한 행에만 속한다**(몰 식별자 또는 증명 주소) — 같은 회사의 다른 몰이 가진 호스트는 적지 않는다(자기 몰 서명으로 남의 몰 주소를 가져가면 SDK 분류코드·새 주소 저장이 엉뚱한 몰로 간다). 몰 주소 소유를 바꾸는 쓰기 2개(몰 저장 · 증명 주소 기록)는 회사 단위 잠금(`withWooIdentityLock`) 안에서 판정과 쓰기를 함께 한다.
    **해제된 행은 주소를 갖지 않는다** — 해제된 동안 그 주소를 다른 몰이 가져갈 수 있으므로, 되살릴 때(저장 upsert 하나뿐) 옛 증명 주소와 굳힌 기준 주소를 버리고 서명으로 다시 증명받는다. 연결 표시(`markWooConnected`)는 해제된 행을 되돌리지 않는다.
12. **인증 호출은 인정된 호스트로만 간다.** 3xx 는 이동 대상이 https + (몰 식별자 또는 증명된 주소)일 때만 한 번 따라가고, 성공한 origin 을 `meta.woo_rest_origin` 으로 굳힌다. 굳힌 주소가 인정 목록에서 빠지면 쓰지 않는다.
13. **서명이 맞은 뒤에는 그 행의 몰 식별자만 쓴다.** 요청 경로·발신 헤더의 주소는 그 몰의 다른 주소일 수 있다(이벤트·기록·멱등 키 전부 행의 `mall_id`).
14. **대상 행 결정 · 권한 게이트 · 쓰기는 저장 CT 가 한 잠금 안에서 한다**(`saveWooCredentials` 의 `decide`). 라우트가 먼저 행을 찾아 판정하면, 판정과 저장 사이에 그 주소가 다른 담당자 몰의 증명 주소가 됐을 때 소유 검사 없이 덮어쓴다. 화면에서 오는 저장은 반드시 게이트를 넘긴다 · 거부는 던지고 저장은 되돌린다.
15. **표에 없는 주문 상태를 매출로 올리려면 세 근거가 모두 맞아야 한다.** 결제 완료 시각(`date_paid_gmt` → `date_paid`) 있음 · 환불 기록(`refunds[]`) 없음 · 이름이 이행 중 낱말(허용 목록 ship·deliver·delay·pack·prepar·transit)이고 환불·취소·반품·교환·실패 계열이 아님. 하나라도 아니면 종전처럼 pending. 결제 시각 하나로 올리면 환불 끝난 몰 고유 상태가 새 매출로 붙는다. 운영 실측 4종 = `shipping` · `delayed` · `hold-shipping` → paid / `cancel-request` → pending. 지운 주문·임시 저장은 pending 고정.
16. **해석 규칙이 바뀌면 이미 읽은 주문을 한 번 다시 읽는다.** 판 = `WOO_ORDER_RULE_VERSION`(지금 2) · 가져오기 상태 `woo_backfill.order_rule`. 판이 낮은 **끝난 가져오기**만 주문 단계를 다시 줄 세운다 — 가져온 적 없는 몰·도는 중인 몰·키 없는 몰은 건드리지 않는다(0921: 워커가 새 몰을 스스로 가져오지 않는다).
17. **회차마다 도는 점검은 스스로 불어나면 안 되고, 해제 뒤에 흔적을 남기면 안 된다.** 웹훅 점검은 우리 웹훅을 수신 주소 또는 우리가 만든 id 로 알아보고, 목록 응답이 배열이 아니면 중단하고, 목록 끝을 확인 못 하면 만들지 않으며, 변화가 없으면 연동 행을 쓰지 않는다.
    **한 몰의 웹훅 실행(주기 워커 점검 · 앱 인증 뒤 점검 · 제거)과 저장(해제됐던 몰을 되살리는 자리)은 그 몰의 한 줄에 서서 들어온 순서대로만 일어난다**(`inflight-lock.ts runSerial` · 메모리 줄 · 프로세스 1개 전제). 점검·제거는 줄 안에서 행을 새로 읽는다 — 점검은 해제된 몰이면 아무것도 만들지 않고, 제거는 해제된 행이 아니면 아무것도 지우지 않는다. 저장은 저장이 쓸 몰의 줄에 서고(정리 도중 되살아난 몰의 웹훅을 그 정리가 지우지 않게), 줄을 기다리는 사이 대상이 바뀌면 쓰지 않고 그 몰의 줄에 다시 서며 계속 어긋나면 busy 로 끝낸다.
    **행 끊기는 줄에 세우지 않는다** — 요청 시점에 즉시 한다. 줄에서 기다렸다 끊으면 그 사이 다른 담당자가 되살린 연결을 권한 재확인 없이 끊는다. **해제의 권한 판정과 행 끊기는 한 호출이다**(`disconnectWoo` 의 `allow` — 저장과 같은 회사 단위 잠금 안에서 행을 잠가 읽고 판정한 뒤 끊는다). 라우트가 먼저 행을 읽어 판정하면 판정과 끊기 사이가 벌어진다. id 는 추적값이라 행 상태와 무관하게 적고, 만들다 실패하면 기존 id 와 합쳐 적는다. **교차 순서마다 보상(만든 것 지우기 등)을 덧대지 않는다** — 교차 자체를 없앤다.
    **우리 웹훅을 찾는 방법은 하나다** — 몰의 실제 목록에서 수신 주소 또는 우리가 만든 id 로 알아본다(`listWooWebhooks` · `isOurWooWebhook`). 점검도 제거도 이 방법을 쓴다. 제거가 우리 기록(id)만 믿으면 생성 응답이 유실된 웹훅이 영영 남는다. 제거는 해제된 행에만 한다. **정리 미완료(`meta.woo_webhook_cleanup` = 처음 남긴 시각)는 행을 끊는 같은 문장에서 적고**(정리 전에 프로세스가 죽거나 결과 저장이 실패해도 남는다), 정리가 끝난 것이 확인될 때만 비운다 — 몰 목록을 못 읽었거나 못 지운 것이 남으면 그대로 둬 주기 워커가 7일 동안 이어서 정리한다.
18. **읽지 못한 주문이 남았으면 커서를 전진시키지 않는다.** 주기 수집이 한 회차 상한에 닿았는데 주문 다시 읽기로 넘기지 못한 회차는 사유(`truncated`)를 남기고 같은 창을 다시 읽는다(적재는 멱등). 전진하면 남은 주문이 겹침 창 밖으로 밀려 영영 안 읽힌다.

### 8-2. 결함과 처방

| # | 실측 | 처방 | 자리 |
|---|---|---|---|
| W-1 | 두 몰 도메인 이전(`lensgogo.info` → `www.lensgogo.net` · `lens007.net` → `lens007.store`) · 주기 수집 9/22 부터 `redirect` 실패 · 수집 허용 도메인 옛 주소뿐 | 불변 10~14 | `woocommerce-core.ts wooSelfHost` · `woocommerce-client.ts wooHostAllowed · wooRestBase · wooRedirectOrigin · wooAuthedRequest · noteWooSeenHost · resolveWooMallIdForSave · listWooIntegrationsByMallId` · `routes/woocommerce.ts`(수신 · `decideStoreCode`) · `integration-scope.ts resolveStoreCodeByOriginHost` · 상품 조회 호출부 2곳 |
| W-2 | 원본 상태 `shipping`(729/172/29) · `delayed` · `hold-shipping` · `cancel-request` 를 결제 전으로 적재(적재 상태 분포 pending 4,933) | 불변 15(앞 셋 = paid · `cancel-request` = pending 유지) | `woocommerce-core.ts mapWooOrderStatus` |
| W-3 | 일본이모 주문 수정 웹훅 7일 0건(다른 3몰 수백~수천 · 꺼진 웹훅을 다시 안 켬) | 주기 워커가 수집 성공 뒤 쓰기 권한 키 몰의 웹훅 4개 점검(없으면 만듦 · `disabled` 다시 켬 · `paused` 그대로) · 불변 17 | `ensureWooWebhooks` · `woocommerce-sync-worker.ts` |
| W-4 | W-2 를 고쳐도 이미 결제 전으로 적재된 주문은 그대로 | 불변 16(최근 90일 주문 단계만 · 회원 단계 건너뜀 · 실패하면 다음 회차가 이어 감 · 매출은 `syncOrder` 표식으로 1회만) | `wooOrderRereadDue` · `startWooOrderReread` · 워커 |
| W-7 | 주기 수집 한 회차 상한(5,000건)에 닿으면 남은 주문을 버리고 커서 전진 | 닿음을 돌려주고 주문 다시 읽기로 넘김(끝난 가져오기가 있는 몰 · 24시간에 한 번) · 못 넘긴 회차는 커서 유지(불변 18) | `syncWooOrdersSince` · 워커 |
| B-1001-7 | 구매이력 화면이 원장만 읽음(자사몰 주문은 원장에 없음 · 원장 0행) | 읽는 화면만 두 원천 합침(원장에 쓰지 않는다 · 여정 이중 진입 방지) | `purchase-history-source.ts` · `routes/customers.ts` 2곳 |
| B-1001-8 | 플러그인 기본값·화면 안내가 고객사가 안 쓰는 키(`mssms_agreement`) | 기본값·안내 = `mssms_agreement_label`(서버 저장 키는 처음부터 이 값 · 재설치 불필요) | 플러그인 1.0.1 · `CdpConnectForms.tsx` |

### 8-3. 배포 뒤 흐름(자동)

1. 서명 검증된 웹훅이 한 번 오면 그 몰의 새 주소가 증명 주소로 적힌다(렌즈고고 · 렌즈007).
2. 주기 워커(부팅 4분 뒤 · 이후 30분): 끝난 가져오기의 판이 1 이면 주문 다시 읽기를 줄 세운다(4몰 순서대로 · 한 번에 한 몰). 새 주소가 아직 증명 전이면 그 회차는 `redirect` 로 실패하고 다음 회차가 이어 간다.
3. 다시 읽기가 끝난 몰은 주기 수집으로 돌아가고, 수집 성공 뒤 웹훅 4개를 점검한다.

### 8-4. 미검증(배포 뒤 확인)

- 실제 301 의 이동 대상이 증명 주소와 같은가(렌즈고고·렌즈007 `woo_sync_error` 소멸 · `woo_rest_origin` 기록).
- 4몰 키 권한에 쓰기가 있는가(없으면 웹훅 자동 복구는 건너뛴다 · 주기 수집이 안전망).
- 주문 다시 읽기 뒤 매출 반영 건수·구매이력 건수.
- 몰 서버가 `modified_after` 를 아는가(모르면 회차마다 상한에 닿는다 → 하루 한 번 주문 다시 읽기).
- 운영자 진단 = `scripts/diagnose-woo-headers.ts --health`(읽기 전용 · 이동 주소 · 원본 주문 상태 분포 · 웹훅 켜짐 여부).

### 8-4-0. 배포 뒤 실측(1001 21:30~ · Harold)

- 4몰 키 권한 = `read_write`(웹훅 자동 복구 대상) · 21:36 4몰 모두 주문 다시 읽기 시작(사유 = 상태 규칙 변경) · 일본이모 21:37 완료(주문 1,821 · 실패 0) · 이로이로도쿄 진행.
- **빈틈 발견**: 렌즈고고 · 렌즈007 은 배포 뒤 13분 동안 웹훅이 한 건도 안 들어와 증명 주소를 못 배웠다 → 주기 수집 · 주문 다시 읽기가 `redirect` 로 멈춤. 저장된 서명 검증 기록에는 새 주소가 최근 2시간에만 43건 · 14건 있었다(렌즈고고 = `www.lensgogo.net` · `xxyyzz1111.com` / 렌즈007 = `www.lens007.store`).
- **보완**: 불변 11 의 둘째 배움(저장 기록에서 배우기). 실행 증거 = PostgreSQL 16 + 가짜 몰 서버(기록 있으면 그 회차에 따라감 · 다른 회사·다른 몰·임시 행·8일 전·http·주소 없는 기록은 근거가 못 됨 · 다른 몰이 가진 주소는 유일성으로 거부) · 변이 10종 검출 · 교차 순서 실측 회귀 400가지 위반 0.
- **보완 Codex 적대 1R approve(지적 0)**. Codex 가 먼저 물은 것 = 「증명 주소로 후보를 찾는 것」과 「기록의 mall_id 에 요청 경로 값을 적는 것」이 동시에 운영된 배포본이 있었는가(있었다면 옛 기록이 다른 연동의 증명으로 쓰일 수 있다) → 두 배포 커밋의 실제 파일로 확인: 직전 배포본 `73e977ed` 는 증명 주소 기능 자체가 없고(후보 = 몰 식별자 정확 일치) · 현재 배포본 `7eb57675` 는 기록에 서명이 맞은 행의 몰 식별자를 적는다 = 동시 운영 없음. 저장된 기록의 (회사 · 몰)은 언제나 서명이 맞은 행이다.
- [범위 밖 · 기록만] `adoptWooRestOrigin` 의 기준 주소 저장이 해제·재연결과 겹치면 비워진 `woo_rest_origin` 을 다시 적을 수 있다 — 그 값은 인정 목록(몰 식별자 · 증명 주소) 안의 호스트일 때만 읽히므로 증명 주소가 비워진 동안에는 쓰이지 않는다.
- **보완 배포 뒤 운영 실측(1001 22:06~22:48 · Harold 실행 출력)**
  - 22:06 렌즈고고 이동 따라감(`www.lensgogo.info → www.lensgogo.net`) · 일본이모 「웹훅 복구 · 다시 켬 1」 · 22:11 렌즈007 = 저장된 서명 기록에서 `lens007.store` 를 배우고 다음 초에 따라감(새 웹훅을 기다리지 않음 = 보완이 운영에서 동작).
  - 주문 다시 읽기 4몰 완료: 일본이모 1,821 · 렌즈007 1,072 · 렌즈고고 6,244(셋 다 실패 0) · 이로이로도쿄 20,341(22:15 시점 19,104 에서 실패 0 · 완료 시점 실패 수는 조회하지 않음).
  - 22:48 상태: 4몰 모두 주기 수집 시각 22:34~22:37(렌즈고고·렌즈007 은 9월 22일 뒤 처음) · 오류 코드 없음 · 웹훅 4개씩 · 기준 주소 = `https://www.lensgogo.net` · `https://lens007.store`.
  - 몰 고유 상태(완료 3몰 · 최근 7일 원본 대조): `shipping`+결제시각 84건 → paid 39 · completed 44(전부 매출 반영) · 이벤트 없음 1 / `delayed` 2 · `hold-shipping` 1 → paid / `cancel-request` 2 → pending. 남은 pending 은 원본이 pending·failed·on-hold.
  - 구매이력 화면과 같은 조건 합계(22:15 · 이로이로도쿄 진행 중 시점): 배포 전 28,269건 → 28,625건 · 고객 23,785명 · 2,350,155,965원.
  - **4몰 완료 뒤 구매내역 화면 조회 그대로 DB 확인(1001 밤 · Harold 「DB 에서 조회해서 체크」)**: 전체 기간 28,640건 · 고객 23,798명 · 2,351,205,863원(올해 28,633건) · 이번 달(화면 첫 진입 기본) 526건 · 47,250,391원 · 고객 515명. 매장별 4줄 = 이로이로도쿄 19,566 · 렌즈고고 5,695 · 일본이모 2,456 · 렌즈007 923(합 = 28,640 · 금액 합 일치 · 미지정 매장 0). 전부 자사몰 주문 원천(구매 원장 0행). 목록 위 5줄에 날짜·고객·매장·상품명(「외 N건」)·수량·금액이 채워져 나옴. 고객별 창 표본 1명 = 36건 · 4,044,584원.
  - ⚠ 구매내역 화면은 처음 열면 「이번 달」이 기본이다 — 전체를 보려면 기간을 「연」·「전체 기간」으로 바꾼다.
  - [범위 밖 · 기록만] 원본 `failed` 인데 우리 쪽 paid + 매출 반영 1건 — 기존 규칙(`failed` 로 바뀌어도 반영을 되돌리지 않음)의 결과 · 착수 판단 = Harold님.

### 8-4-1. Codex 적대 리뷰(1001)

- **R1 needs-attention(high 4 · medium 2) → 뿌리 4개로 구조 정정**: ⓐ 몰 주소 소유의 유일성과 원자성(권한 확인 뒤 저장 대상이 바뀜 · 자기 몰 서명으로 다른 몰 주소를 가져감) → 불변 11·14 ⓑ 결제 시각 하나로 미지 상태를 매출 승격 → 불변 15 ⓒ 상한에 닿았는데 커서 전진 → 불변 18 ⓓ 웹훅 점검의 비정상 응답·해제 경합 → 불변 17.
- 실행 증거 = 일회용 PostgreSQL 16(다른 몰 주소 거부 양방향 · 동시 기록 한쪽만 · 상한 8 · 게이트 거부 시 행 무변경) · 정정분 변이 27종 전부 검출.
- **R2 needs-attention(high 1 · medium 1) = R1 과 같은 뿌리가 다른 입구로 다시 나옴 → 불변을 입구가 아니라 상태에 세움**: ⓐ 해제된 몰을 되살리면 옛 증명 주소가 살아나 다른 몰의 식별자와 겹침 → "해제된 행은 주소를 갖지 않는다"(불변 11) · 되살리는 자리를 저장 하나로 ⓑ 웹훅을 만들다 실패하면 보상 삭제를 건너뜀 → 구간 전체를 묶은 한 가지 뒷정리(불변 17). 실행 증거 = PostgreSQL 16(되살린 몰에 두 키 없음 · 그 호스트를 가진 살아 있는 행 하나 · 해제 행은 연결로 안 돌아감) · 변이 9종 검출.
- **R3 needs-attention(medium 3 · 전부 웹훅 점검·해제의 교차 순서) = 같은 부류 세 라운드째 → 덧댄 보상을 걷어내고 구조 변경**: R1·R2 에서 교차 순서마다 보상(해제 안 된 행에만 쓰기 · 만든 것 지우기 · 못 지운 id 남기기)을 붙였더니 보상끼리 새 교차를 만들었다(id 유실 · 재연결한 몰의 웹훅 오삭제). 원인은 같은 몰의 웹훅을 다루는 실행이 줄 서지 않는 것 → 몰 단위 한 줄(불변 17) · 보상 장치 삭제(코드 감소). 실행 증거 = 점검이 멈춘 사이 해제·제거를 넣은 실제 실행 계약(제거의 DELETE 는 점검의 POST 뒤에만 · 점검이 적은 id 전부 삭제) · 변이 14종 검출.
- **R4 needs-attention(medium 1) → 제거가 우리 기록만 믿던 것을 몰의 실제 목록 기준으로**: 생성 응답이 유실되면 id 를 못 적어 제거가 못 찾고 재해제도 빈 목록을 읽었다. 우리 웹훅 찾기를 점검과 제거가 함께 쓰는 한 방법으로 묶고, 확인하지 못한 정리는 미완료로 남겨 주기 워커가 이어 간다(불변 17). 실행 증거 = PostgreSQL 16(정리 대상 조회 = 해제 + 7일 이내 · 기록 정리 UPDATE · 살아 있는 몰 무변경 · 되살리면 표시 삭제) · 변이 17종 검출.
- **R5 needs-attention(medium 2) = 연결 상태를 바꾸는 실행이 웹훅 줄 밖에 있었다**: 정리가 목록을 읽는 사이 저장이 몰을 되살리면 되살아난 몰의 웹훅을 지움 · 미완료 표시를 정리 뒤에야 처음 적어 그 저장이 실패하면 이어 정리가 없음 → 해제·되살리기를 줄 안으로 · 행 끊기와 표시를 한 문장으로(불변 17). 실행 증거 = 목록 조회가 멈춘 사이 재연결을 넣은 실제 실행 계약(행 끊기 → DELETE → 정리 결과 기록 → 되살리기 순) · PostgreSQL 16 · 변이 7종 검출.
- **R6 needs-attention(high 2) = R5 에서 넣은 변경이 만든 경로 → 그 두 부분을 되돌림**: 행 끊기를 줄 안으로 옮기자 기다리던 중복 해제가 그 사이 되살아난 다른 담당자의 연결을 끊었고, 저장 재시도의 마지막 시도가 대상 확인 없이 써 다른 몰의 줄에 선 채 되살렸다 → 행 끊기는 즉시(줄 밖) · 저장의 대상 확인은 언제나(불변 17). 실행 증거 = 정리 도중 재연결 + 중복 해제를 넣은 실제 실행 계약(되살린 뒤 끊기·삭제·목록 조회 0) · 변이 8종 검출.
- **R7 needs-attention(high 1) → 해제의 권한 판정과 행 끊기를 한 잠금 안으로**: 라우트가 행을 읽어 소유를 판정한 뒤 따로 끊었다(이번 세션 전부터 있던 구조) → 그 사이 다른 담당자의 재연결이 커밋되면 판정 없이 끊음. 저장(불변 14)과 같은 방식으로 닫음. 실행 증거 = PostgreSQL 16(다른 담당자가 되살린 행은 게이트가 받아 거부 · 행 무변경 / 이미 끊긴 행은 게이트 미호출) · 변이 7종 검출.
- **자체 검토 정정 3건(W-1 이 만든 경로)**: 수신 라우트가 서명이 맞은 뒤에도 요청 주소로 이벤트를 만들어 접두가 갈림 → 그 행의 몰 식별자로 고정 · 권한 게이트(`decideStoreCode`)가 입력 주소로 행을 찾아 소유 검사를 건너뜀 → 저장과 같은 함수(`resolveWooMallIdForSave`)로 판정 · 상품 조회(Store API) 결과의 몰 표기를 저장 주소에서 뽑음 → 연동 행 몰 식별자.
- **검증**: tsc 0(백·프) · vitest 530파일 7,333 · 새 계약 `woocommerce-audit-1001.test.ts` 52건 + `woocommerce-sync-pass-1001.test.ts` 6건(워커 한 회차 실제 실행) + `inflight-serial-1001.test.ts` 6건 · 변이 135종 전부 검출 · 일회용 PostgreSQL 16 실행(증명 전 0건 → 증명 뒤 같은 행 · 다른 회사 미혼입 · 새 주소 재저장 행 1개·secret 유지 · 해제 행 제외 · 다른 몰 주소 거부 양방향 · 동시 기록 한쪽만 · 게이트 거부 시 행 무변경).
- **R8 approve(지적 0)**: 저장·해제의 잠금 순서 일치 · 최신 행 권한 판정과 갱신이 같은 트랜잭션 · 거부 시 롤백과 403 사유 응답 · 행 없음·이미 해제 시 false.
- **라운드별 범위**: 주소 이전 · 주문 상태 · 주문 다시 읽기 · 수집 상한은 R3 이후 지적 0. R4~R8 은 해제·재연결이 겹칠 때의 웹훅 정리와 권한 판정.
- **교차 순서 실측(증분 리뷰가 좁게 본 것을 전체로 확인)**: 실제 PostgreSQL 16 + 실제 코드 + 가짜 몰 서버(HTTP 만 가짜)로, 한 몰에 점검 · 해제(담당자 A/B · 중복 · 해제 직후 프로세스 죽음) · 재연결(담당자 A/B) · 주기 워커의 이어 정리를 무작위로 겹치고 몰 서버 호출이 끝나는 순서도 무작위로 골랐다(시작 상태 5가지 · 절반은 몰 서버 장애와 응답 유실 주입). 확인한 것 = 연결된 몰의 웹훅을 지우지 않는다 · 남의 웹훅을 지우지 않는다 · 해제된 몰에 우리 웹훅이 남지 않는다(정리 뒤 기록·미완료 표시도 비워진다) · 연결된 몰은 주제마다 웹훅이 정확히 1개이고 기록 id 와 같다 · 행을 끊은 사람 = 끊길 때의 담당자 · 끝나지 않는 실행이 없다. **3,000가지 순서에서 위반 0.** 도구 감도 = 앞 라운드 지적 결함 8종을 되살렸을 때 7종 검출(나머지 1종 = 끝 상태에 차이가 없는 중복 안전장치). 도구는 세션 스크래치(저장소 미편입).
- **프로세스 1개 전제**: 한 줄은 메모리 줄이다(`ecosystem.config.js` fork · instances 1). 백엔드를 여러 인스턴스로 돌리게 되면 이 줄과 기존 메모리 잠금(`inflight-lock`)을 함께 DB 잠금으로 옮겨야 한다.

### 8-7. 소스 위치 (「소스 읽어」 하면 여기부터 · ★1001)

| 축 | 파일 | 볼 곳 |
|---|---|---|
| 주문 상태 · 매핑 | `packages/backend/src/utils/woocommerce-core.ts` | `mapWooOrderStatus`(몰 고유 상태 = 결제시각 + 환불 없음 + 이행 이름) · `mapWooOrderToCdp` · `wooSelfHost` |
| 연동 저장·해제·잠금 | `packages/backend/src/utils/woocommerce-client.ts` | `withWooIdentityLock` · `resolveWooMallIdForSave` · `saveWooCredentials` · `markWooConnected` · `disconnectWoo` |
| 도메인 이전(증명 주소) | 같은 파일 | `wooAuthedRequest`(3xx 한 번 · 인정 목록) · `noteWooSeenHost` · `learnWooHostFromSignedDeliveries`(저장된 서명 기록에서 배움) · `listWooIntegrationsByMallId` |
| 주문 다시 읽기 · 수집 | 같은 파일 | `WOO_ORDER_RULE_VERSION` · `wooOrderRereadDue` · `startWooOrderReread` · `syncWooOrdersSince`(상한 `truncated`) |
| 웹훅 점검·정리 | 같은 파일 | `ensureWooWebhooks` · `removeWooWebhooks` · `listWooWebhookCleanupTargets` |
| 몰 단위 한 줄 | `packages/backend/src/utils/inflight-lock.ts` | `runSerial` |
| 주기 수집 워커 | `packages/backend/src/utils/woocommerce-sync-worker.ts` | 다시 읽기 판정 · 상한 처리 · 웹훅 점검 · 정리 훑기 |
| 라우트 | `packages/backend/src/routes/woocommerce.ts` | 웹훅 수신(서명 검증 뒤 기록) · `/credentials` · `/connect-url` · `/disconnect`(`WooSaveRejected`) |
| 매장 범위 | `packages/backend/src/utils/integration-scope.ts` | `resolveStoreCodeByOriginHost`(증명 주소 포함) |
| 구매이력 두 원천 | `packages/backend/src/utils/purchase-history-source.ts` · `routes/customers.ts` | `purchaseHistorySourceSql` · `GET /purchases/overview` · `GET /:id/purchases` · 화면 = `frontend/src/components/manage/ManagePurchasesTab.tsx`(기본 기간 = 이번 달) |
| 진단 도구 | `packages/backend/scripts/diagnose-woo-headers.ts`(`--health`) · `scripts/run-woo-backfill.ts` | |
| 계약 테스트 | `packages/backend/src/utils/__tests__/woocommerce-audit-1001.test.ts` · `woocommerce-sync-pass-1001.test.ts` · `inflight-serial-1001.test.ts` · `purchase-history-source-1001.test.ts` · `woocommerce-client.test.ts` · `woocommerce-routes.test.ts` · `woocommerce-store-code.test.ts` | |

### 8-5. 범위 밖(기록만 · 착수 판단은 Harold님)

ⓐ 휴대폰 없는 회원 미적재(렌즈고고 19,635 · 이로이로 4,074 · 설계상 제외) ⓑ 수신동의 「공란 = 동의」 이에스페이먼트 한정 적용 → **★1002 구현**(고객사 대표 확인 · 몰 단위 규칙 `meta.consent_missing_agree_key` · 회원 정보에 값이 없는 회원만) = [몰 동의 설계서 §12](2026-09-22-mall-consent-isolation-design.md) ⓒ 이메일 수신동의 미수집 ⓓ 부분 환불 미지원 ⓔ 가져오기 깊이 90일 ⓕ 구매 원장만 읽는 분석·전환 소비처(`analysis.ts:480·494·796` · `dm.ts:1617` · `recipient-conversion.ts:86` · `inapp-funnel-stats.ts:488` · `customer-timeline.ts:447·824` · `company-data-profile.ts:252·261`) = 자사몰 회사에서 0 으로 나옴(전 provider 공통 · 두 원천 통합 과제).

**고객사 쪽에만 있는 것(재설치와 무관)**: 행동 수집 스크립트가 4몰 페이지에 없음(행동 이벤트 전 기간 0) — 주문·회원·동의·구매이력과는 별개.

### 8-6. 수신동의 키 안내·기본값 ([B-1001-8](../status/BUGS.md) · 2026-10-01 박성용 전달 · BUGS 에서 옮김)

- **실측(Harold SQL)**: 서버에 저장된 수신동의 키는 4몰 모두 `mssms_agreement_label` — 수집 값은 처음부터 맞는 필드에서 왔다. 틀린 것은 우리 플러그인 기본값과 연동 화면 안내·예시(`mssms_agreement`).
- **처방**: 플러그인 기본값 `mssms_agreement_label,email_agreement_label` · 버전 1.0.1 · 연동 화면 안내·예시 · `INTEGRATIONS.md` · 설계서. 플러그인은 설정 키의 값이 REST 응답에 없을 때만 덧붙이므로 **재설치 불필요**.
- **★1002 「공란 = 동의」 구현**: 고객사 대표 확인 「no 만 수신거부 · 아무것도 없거나 YES 는 발송 가능」 → 몰 단위 규칙(회원 정보에 값이 없는 회원만 · 동의 키 이름에 묶임 · 주문·비회원 제외). 실측·규칙·소스 위치·반영 순서 = [몰 동의 설계서 §12](2026-09-22-mall-consent-isolation-design.md). ⚠ 대시보드 「수신동의 수」는 고객 행 값이라 이 규칙만으로는 안 바뀐다(읽기 전환 S6-b 가 남아 있다).
