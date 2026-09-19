# 자사몰 연동 × 사용자 분류코드 설계서 (2026-09-18)

> **이 문서가 소유하는 것** = "한 회사 안에서 사용자마다 자사몰이 따로 있는 경우"의 설계안 · 불변 원칙 · 영향표 · 단계 · 실측 시나리오 · 미검증. 구현 종결 뒤 [FEATURE-CDP-INTEGRATION.md](FEATURE-CDP-INTEGRATION.md) §2·§3에 흡수하고 이 문서는 시점 근거로 남긴다.
> **발동** = 2026-09-18 이에스페이먼트(몰 4 · 관리자 1 · 몰별 사용자 계정 4)가 몰별 계정으로 우커머스 연결을 시도 → 버튼 잠김 → Harold "각 몰은 자기 고객만 본다 · 우커머스를 떠나서 늘 얘기했던 것 = 고객사 관리자는 전부, 사용자는 분류코드로 자기 것만" → "그렇다면 사용자가 자사몰 연동을 할 수 있어야 한다" → "사용자마다 자사몰이 따로 있는 경우를 우리가 고민한 적이 없다 · 충분히 있을 구조" → "설계해보자".
> **상태** = ★0918 Harold 승인("설계해보자" → "지금 이제 진행") → **P1~P4 구현 완료 · 배포완료(0918 08:57 reload · 서버 실측) · 실측 대기**(§9 구현 기록). DDL 0. 이에스페이먼트 연결은 실측(§6) 뒤에.
> 관련 = [FEATURE-CDP-INTEGRATION.md](FEATURE-CDP-INTEGRATION.md) §7(접수 기록) · [2026-09-14 우커머스 설계서](2026-09-14-woocommerce-integration-design.md) · `status/SCHEMA.md` customers 절("폰당 고객 1행 · 다매장은 customer_stores가 소유") · [SNS 게시 설계서](2026-09-17-sns-publish-design.md)(같은 축을 만난다 · §8).

---

## 0. 한 줄

**상시 원칙(관리자는 전체 · 사용자는 분류코드로 자기 것만)을 자사몰 연동에도 그대로 건다.** 연동 행이 분류코드를 갖고, 자사몰 적재가 형제 적재 경로와 똑같이 `customer_stores`에 그 코드를 기록하며, 분류코드가 배정된 사용자는 자기 코드로 자기 몰을 연결·해제한다. 고객 합치기 기준(폰당 1행)은 바꾸지 않는다. DDL 0.

---

## 1. 출발점 (실측 · 2026-09-18)

### 1-1. 상시 원칙의 실물 — 이미 있는 것

| 사실 | 근거 |
|---|---|
| 사용자 범위 판정은 CT 하나. `users.store_codes`가 있으면 그 코드의 고객만(`filtered`), 분류 체계가 있는데 미배정이면 차단(`blocked` · 회사 옵션 `allow_user_full_access`면 전체), 분류 체계가 없으면 전체(`no_filter`). 관리자·슈퍼는 이 함수를 부르지 않는다 | `utils/store-scope.ts:20~71` |
| 필터의 실물은 고객 `store_code` 컬럼이 아니라 **`customer_stores`(고객↔분류코드 N:N)** 다: `id IN (SELECT customer_id FROM customer_stores WHERE company_id=$1 AND store_code = ANY(...))` | `routes/customers.ts:66` · `routes/campaigns.ts:282` · `utils/operator-audience.ts:174` |
| 고객은 **폰당 1행이 진실**이고 다매장 소속은 `customer_stores`가 소유한다. upsert 충돌 키 = `(company_id, phone)` | `status/SCHEMA.md` customers 절(2026-08-14 pg_indexes 실덤프·정정) · `utils/customer-upsert.ts:97·183` |
| 형제 적재 경로는 전부 `customer_stores`를 쓴다: 업로드 · 싱크에이전트 · 단건 등록 | `routes/upload.ts:789~808` · `routes/sync.ts:831·863` · `routes/customers.ts:543` |
| 분류코드 등록부 = `companies.store_code_list jsonb`. 쓰기 = 회사 설정(`companies.ts:2191`) · 슈퍼관리자(`admin.ts:1624`). 사용자 배정 화면이 이 목록을 받아 보여 준다 | `routes/manage-users.ts:35·55~58` · `AdminDashboard.tsx:8102` |
| 사용자 배정 = `users.store_codes`(배열). 관리자·슈퍼가 생성·수정 때 넣는다. **서버는 등록부와 대조하지 않는다**(자유 문자열) | `routes/manage-users.ts:127~141·169~191` · `routes/admin.ts:210` |
| `getStoreScope` 소비 = 8파일 28곳(ai 7 · auto-campaigns 3 · campaigns 3 · companies 2 · customers 10 · operator-audience 1 · unsubscribe-helper 1 · 자신 1). **이 CT의 테스트는 0개** | grep · `utils/__tests__`에 store-scope 파일 없음 |

### 1-2. 구멍 3개

**① 자사몰 적재만 분류코드를 안 쓴다.** 공용 적재 함수 `identifyCustomer`의 고객 INSERT에 분류코드가 없고(`utils/cdp-identity.ts:178~200`), 그 뒤에도 `customer_stores`를 쓰지 않는다. 호출처 12곳: `routes/cdp.ts:221` · `routes/short-url.ts:125` · `utils/cafe24-client.ts:642` · `utils/cdp-events.ts:431` · `utils/cdp-orders.ts:83·269` · `utils/custom-self-hosted-adapter.ts:94` · `utils/godo-client.ts:161` · `utils/imweb-client.ts:392` · `utils/naver-commerce-client.ts:535` · `utils/woocommerce-client.ts:510·517`. 전 어댑터에 분류 축 grep 0건. → 몰에서 들어온 고객은 어느 분류코드에도 속하지 않는다.

**② 연결이 관리자 한정이다.** 서버 = `godo.ts:38` · `imweb.ts:120·184` · `cafe24.ts:197·256·318` · `makeshop.ts:38·120` · `woocommerce.ts:278`(`gateAdmin` 하나가 6개 라우트를 지킨다) · `naver-commerce.ts:132·236`. 화면 = 6개 폼이 `isAdmin`(`userType === 'company_admin'`)으로 버튼을 잠근다(`CdpConnectForms.tsx:152·216·351·472·563·672·891·930` · `CdpSettingsPage.tsx:339`). 연동 행(`company_integrations`)에는 회사·provider·몰 주소만 있고 사용자·분류 축이 없다. 자사몰 연동은 처음부터 "회사 하나 = 관리자가 붙이는 몰"로 설계됐고, 0914에 몰 여러 개를 붙일 수 있게 하면서도 **몰의 주인이 사용자인 경우는 다루지 않았다.**

**③ 격리 CT의 "유령 배정" 폴백이 넓게 연다.** `store-scope.ts:26~44`: 사용자에게 배정된 코드 중 `customer_stores`에 실존하는 것이 **하나도 없으면** `no_filter`(회사 전체)를 돌려준다. 원래 목적 = 분류 체계가 없는 회사(인비토 · `customer_stores` 0건)에 수동 배정이 들어가 고객 조회가 0건이 되던 것을 막는 방어(D136). 그런데 판정이 "회사 전체 0건"이 아니라 "**내 코드** 매칭 0건"이라, 분류 체계가 있는 회사에서 아직 자기 고객이 없는 사용자에게도 전체가 열린다. 조회(`customers.ts`)뿐 아니라 직접 타겟 발송(`campaigns.ts:280·691·2967`)도 같은 함수 결과를 그대로 쓴다. 발송 중 `operator-audience.ts:179~186`만 이 경우를 따로 막아 두었다("읽기는 넓게, 보내기는 좁게"). → 몰 하나가 먼저 붙으면, 아직 자기 몰을 안 붙인 다른 사용자가 그 몰 고객 전체를 조회·발송할 수 있다.

### 1-3. 이에스페이먼트 실측 (Harold 실행 SQL · 0918)

| 항목 | 값 |
|---|---|
| 계정 | `espayment`(admin) · `espayment1` 이로이로도쿄 · `espayment2` 일본이모 · `espayment3` 렌즈고고 · `espayment4` 렌즈007 (전부 `user` · active) |
| `users.store_codes` | 전원 NULL |
| `customer_stores` | 0행 (분류 체계 없음 → 지금은 네 계정 모두 `no_filter`) |
| `company_integrations` | 0행 (붙은 몰 없음 = 기적재분 0 · 소급 불요) |
| 접수 화면 | 몰별 계정 → "연동은 회사 관리자만 가능합니다." → 두 버튼 비활성(설계된 잠금) |

### 1-4. 그 밖의 확인

- 우커머스 적재 흐름: 웹훅·주기 수집·연결 백필이 전부 `processWooResource(companyId, mallId, resource, raw, consentMetaKey)` 한 함수를 지난다(`woocommerce-client.ts:496~530` · `woocommerce-adapter.ts:93~107`). 몰 행은 `getWooIntegration`/`listWooIntegrations`가 잡고 `meta`에 `woo_*` 키를 둔다(`:286~318`).
- 브라우저 SDK 이벤트는 `requireCdpBrowserOrigin`이 요청 Origin을 회사의 허용 도메인과 대조한 뒤 `source:'sdk'`로 적재한다(`utils/cdp-auth.ts:267~314` · `utils/cdp-events.ts:431`). SDK 공개키는 회사당 하나라 4개 몰이 같은 키를 쓴다. **어느 몰인지는 Origin만 안다.** 지금은 그 Origin을 적재 함수에 넘기지 않는다.
- 주문 적재(`syncOrder`)는 `identifyCustomer`로 고객을 확정한 뒤 `cdp_events`의 `purchase` 이벤트와 고객 RFM을 갱신한다(`utils/cdp-orders.ts:64~100`). 별도 구매 표에 분류 축을 쓰는 자리는 없다. 사용자 범위는 고객을 거쳐 따라간다.
- 상품 피커의 몰 탭은 회사의 우커머스 몰 전부를 나열한다(`routes/mall-products.ts:39~40`).
- 여정 엔진은 회사 단위다. 진입 판정·대상 조회에 사용자 분류코드가 없다(`journey-*` 파일은 `customer_stores` 소비처 목록에 없음 · `journey-trigger-watcher.ts:93·235`). → §8 별건.

---

## 2. 불변 원칙

1. **상시 원칙을 그대로 건다.** 관리자는 회사 전체의 연동을 보고 다룬다. 사용자는 자기 분류코드의 연동과 고객만 본다. 이 질문을 고객사에 되묻지 않는다.
2. **합치기 기준을 바꾸지 않는다.** 고객은 폰당 1행. 두 몰의 회원인 사람은 고객 1행 + `customer_stores` 2행이고, 두 몰 담당자 모두에게 보인다(실제로 두 몰의 회원이다).
3. **분류코드는 요청 본문에서 받지 않는다.** 사용자 연결의 분류코드는 서버가 세션 사용자의 `users.store_codes`에서 정한다. 본문 값은 "자기 코드 중 어느 것인가"를 고르는 선택지일 뿐이고, 자기 코드 밖이면 거부한다. 관리자만 등록부(`companies.store_code_list`)에서 고른다.
4. **공용 적재 함수는 인자를 생략하면 지금과 1바이트도 다르지 않다.** 분류코드 인자는 선택이다. 단일몰·무분류 회사(현 고객사 전부)의 동작은 불변이고, 이를 "현재 동작 캡처" 테스트로 먼저 고정한 뒤에 고친다.
5. **`customer_stores` 쓰기는 형제 경로와 같은 줄이다**: `INSERT ... (company_id, customer_id, store_code) ... ON CONFLICT (customer_id, store_code) DO NOTHING`. 새 인라인을 네 번째로 만들지 않고 CT 함수 하나(`linkCustomerStore`)를 두고 자사몰 적재가 그것을 부른다. 기존 3곳을 그 함수로 옮기는 일은 별건이다.
6. **몰 1행 = 분류코드 1개.** 연결된 뒤 분류코드 변경은 1단계에서 지원하지 않는다(해제 후 재연결). 바꾸면 이미 쌓인 `customer_stores` 행의 주인이 모호해진다.
7. **격리 CT 폴백은 "회사에 분류 체계가 없을 때"만 연다.** 내 코드 매칭 0건이어도 회사에 `customer_stores` 행이 있으면 `filtered`(결과 0건)다. "아직 내 고객이 없다"는 0건이 정답이다. 인비토 사례(회사 전체 0행)는 그대로 `no_filter`.
8. **잠금은 사유를 그 자리에서 말한다.** 사용자 연결이 잠기는 경우는 셋이고 문구가 다르다: 분류코드 미배정 / 이 몰은 다른 분류코드 소유 / 요금제.
9. **연동 목록·상태·상품 탭·해제·비밀키 재발급도 같은 범위다.** 연결만 열고 목록을 회사 전체로 두면 사용자가 남의 몰 웹훅 주소와 상태를 본다.
10. **화면은 권한을 계산하지 않는다.** 서버가 "이 사용자가 연결할 수 있는가 · 어떤 분류코드로"를 내려 주고 화면은 그 값만 그린다(화면 게이트 = 서버 값 하나).

---

## 3. 설계

### 3-1. 분류코드의 자리

- 연동 행 `company_integrations.meta.store_code`(문자열 · 없으면 회사 공용). DDL 0. 우커머스는 몰 1개 = 행 1개라 그대로 맞는다. 조회 함수(`toIntegration`)가 `storeCode`를 돌려준다.
- 등록부 = 기존 `companies.store_code_list`. 새 표·새 컬럼 0.
- 웹훅 수신의 몰 역추적(`listWooIntegrationsByMallId`)은 그대로다(서명으로 회사를 가린다). 분류코드는 가려낸 행에서 읽는다.

### 3-2. 권한 CT (신설 · `utils/integration-scope.ts` · 순수 판정 + DB 1조회)

```
resolveIntegrationActor(user) →
  { kind: 'admin' }                                   // company_admin · super_admin
  { kind: 'user', storeCodes: string[] }              // users.store_codes 1개 이상
  { kind: 'blocked', reason: 'NO_STORE_CODE' }        // 일반 사용자 · 미배정
canTouchIntegration(actor, row) →
  admin = true / user = row.storeCode ∈ actor.storeCodes / 그 외 false
pickStoreCodeForConnect(actor, requested?) →
  admin  = requested 가 등록부에 있으면 그 값 · 비우면 null(회사 공용)
  user   = storeCodes 가 1개면 그 값 · 여러 개면 requested ∈ storeCodes 일 때만 · 아니면 거부
```

- 판정 어휘는 DB 값(`admin`/`user`)이 아니라 세션의 `company_admin`/`company_user`를 쓰되, **분류코드는 반드시 DB에서 다시 읽는다**(토큰에 없다 · 토큰 어휘로 권한을 넓힌 사고 기록 = SCHEMA users 절).
- 1단계 소비처 = `routes/woocommerce.ts`의 `gateAdmin` 자리 6개 라우트 + `routes/mall-products.ts` 몰 탭. 2단계 = 나머지 5 provider 라우트(같은 CT · 호출부만 교체).

### 3-3. 적재 — `identifyCustomer`에 선택 인자

- `IdentifyInput.storeCode?: string`. 고객이 확정된 직후(기존 연결 조기 반환 경로 포함) `storeCode`가 있으면 `linkCustomerStore(companyId, customerId, storeCode)` 1회. 실패는 적재를 막지 않고 로그로 남긴다(분류 기록 실패로 주문이 유실되면 안 된다 · 다음 이벤트에서 다시 기록된다).
- `syncOrder`의 `OrderInput.storeCode?`도 같은 값을 `identifyInput`으로 넘긴다(`cdp-orders.ts:77~83`).
- 인자를 생략한 호출처 10곳은 동작 불변(§2-4).

### 3-4. 어댑터가 분류코드를 아는 방법

| 경로 | 방법 |
|---|---|
| 우커머스 웹훅 · 주기 수집 · 연결 백필 | 몰 행(`getWooIntegration`)의 `storeCode`를 `processWooResource` 인자로 실어 `identify`·`syncOrder`에 전달. 세 경로가 한 함수라 자리는 하나 |
| 브라우저 SDK(`source:'sdk'`) | `requireCdpBrowserOrigin`이 검증한 Origin 호스트를 `req.cdpAuth.originHost`로 싣고, `ingestBrowserEvents`가 그 호스트로 회사의 연동 행을 찾아(`normalizeWooMallId(host)` = 몰 식별자와 같은 함수) 분류코드를 얻는다. 못 찾으면 분류코드 없이 적재(현행과 동일) |
| 서버 API(`/api/cdp/identify` · API 키) | 1단계 범위 밖. 키가 회사당 하나라 몰을 모른다. 필요해지면 요청 필드가 아니라 **키 단위 분류코드**로 푼다(§8) |
| 카페24·고도몰·아임웹·네이버·메이크샵 | 2단계. 연동 행에 같은 `meta.store_code`를 두고 각 클라이언트의 `identifyCustomer` 호출에 한 줄씩 |

### 3-5. 연결 · 해제 · 목록 · 상품 탭

- `POST /credentials`·`/connect-url`: `gateAdmin` → `resolveIntegrationActor` + `pickStoreCodeForConnect`. 결정된 분류코드를 행 `meta.store_code`에 저장(기존 행이면 덮지 않음). **이미 다른 분류코드로 붙은 몰 주소**를 다른 사용자가 붙이려 하면 409(`MALL_OWNED_BY_OTHER_STORE`) · 관리자가 다른 코드로 다시 저장하려 하면 409(`STORE_CODE_CHANGE_NOT_SUPPORTED`). **★구현 중 단순화**: 1클릭 연결은 `/connect-url`이 세션으로 몰 행을 먼저 만들고 승인 창으로 보내며, 콜백은 이미 있는 행에 키만 얹는다(`saveWooRestKeysFromAuth`) → 분류코드는 행을 만드는 시점에 정해지므로 **앱 인증 state 에 분류코드를 넣을 필요가 없다**(설계 초안의 그 항목은 폐기).
- `POST /connect`: 몰 행을 읽은 뒤 `canTouchIntegration` 통과 시에만 검증·백필.
- `GET /status`: 관리자 = 전체 · 사용자 = `canTouchIntegration` 통과 행만. 응답에 `canConnect` · `connectStoreCodes`(선택지) · `lockReason`을 실어 화면이 계산하지 않게 한다.
- `DELETE /disconnect`·`POST /rotate-secret`: 대상 행에 `canTouchIntegration`.
- `mall-products /providers`·`wooMallOf`: 사용자는 자기 분류코드의 몰만.
- 서버가 돌려주는 웹훅 주소·비밀키 1회 표시는 현행 그대로(연결한 사람에게만 보인다).

### 3-6. 격리 CT 폴백 정정 (`store-scope.ts:26~44`)

```
배정 코드 있음
  ├ 내 코드가 customer_stores 에 있음            → filtered            (현행)
  ├ 없음 + 회사에 customer_stores 행이 있음      → filtered(결과 0건)   ★변경(현행 no_filter)
  └ 없음 + 회사에 customer_stores 0행            → no_filter           (현행 · 인비토 사례)
```

- 순서: ①현재 동작 캡처 테스트 신설(이 CT는 테스트가 0개다 · 세 갈래 + 미배정 세 갈래 = 6케이스) ②운영 영향 측정 SQL(§7-1)로 "행동이 바뀌는 사용자" 목록 확보 ③그 목록을 Harold가 확인한 뒤 변경. 목록이 비어 있지 않으면 그 회사들은 변경 즉시 조회가 0건이 되므로, 배정 정정(코드 오타 등)이 먼저다.
- `operator-audience.ts:179~186`의 별도 방어는 이 변경으로 CT와 같은 판정이 된다. 지우지 않고 둔다(축 밖 · 중복 방어는 무해).

### 3-7. 화면 (`CdpSettingsPage` · `CdpWooConnectForm`)

- `isAdmin` 하나로 잠그던 것을 서버 값 `canConnect`로 바꾼다(우커머스 폼 1단계 · 나머지 5폼은 2단계까지 현행 `isAdmin`).
- 관리자: 몰 주소 옆에 **분류코드 선택**(등록부 목록 · 기본 "회사 공용"). 등록부가 비어 있으면 칸을 그리지 않는다.
- 사용자(배정 1개): 선택 칸 없이 `이 몰은 [분류코드] 고객으로 들어옵니다` 한 줄.
- 사용자(배정 여러 개): 자기 코드 중 선택.
- 잠금 문구 3종(버튼 바로 아래 · 지금처럼 작은 회색 글씨가 아니라 amber 안내 줄):
  - 미배정: `분류코드가 배정되지 않은 계정입니다. 회사 관리자에게 분류코드 배정을 요청해 주세요.`
  - 다른 분류코드 소유: `이 몰은 다른 담당자의 분류코드로 이미 연결되어 있습니다.`
  - 요금제: 기존 안내 창.
- 몰 목록 줄에 분류코드 배지(관리자 화면에서 어느 몰이 누구 것인지 보이게).
- 하한 = 다크 slate-950 · 커스텀 모달 · 모델명 0 · 내부 코드명 0. "store_code"라는 낱말은 화면에 쓰지 않는다(화면 낱말 = 분류코드).

### 3-8. 소급

- 이에스페이먼트 = 붙은 몰 0 · 소급 없음.
- 다른 회사 중 "우커머스 몰 2개 이상 + 사용자 분류 배정"인 곳이 있는지는 §7-2 SQL로 확인한다. 있으면 `cdp_identity_links.external_id`의 `{몰}:` 접두로 고객↔몰을 되짚어 `customer_stores`를 채울 수 있다(미검증 · 대상이 있을 때만 설계).

---

## 4. 영향표

| 대상 | 읽는 곳 / 쓰는 곳 | 1단계 영향 |
|---|---|---|
| `identifyCustomer`(공용 CT) | 호출처 12 | 선택 인자 추가. 생략 10곳 불변 · 우커머스 2곳만 값 전달 · SDK 1곳은 Origin에서 찾은 값 전달 |
| `syncOrder` | 우커머스·카페24·고도몰 등 주문 적재 | `OrderInput.storeCode?` 추가. 생략 시 불변 |
| `customer_stores` | 쓰기 3곳(업로드·싱크·단건) + 읽기(격리 필터 전 소비처) | 쓰기 1곳 추가(CT 함수). 읽기 쪽은 코드 0 변경 · 데이터가 늘 뿐 |
| `store-scope.ts`(공용 CT) | 8파일 28곳 | 한 갈래 판정 변경(§3-6). 영향 회사 = §7-1 측정 결과 |
| `company_integrations.meta` | 우커머스 client·routes·sync-worker·adapter · provider 조건 없는 조회 2곳(`inapp-display-eligibility`·`performance-data-availability`) | 키 1개 추가. 기존 키 무접촉. provider 조건 없는 2곳은 `provider`·`status`·`access_token`만 읽어 영향 0 |
| `routes/woocommerce.ts` | 인증 라우트 6 | `gateAdmin` → 권한 CT. 관리자 동작 불변 |
| `woocommerce-auth-state.ts` | state 발급·검증 | **변경 0**(구현 중 확인: 분류코드는 `/connect-url`이 행을 만들 때 세션으로 정한다 · 콜백은 키만 얹는다) |
| `routes/mall-products.ts` | AI 자동제작 상품 피커 · 재조회 | 사용자 범위 필터. 관리자 불변 |
| `cdp-auth.ts` · `cdp-events.ts` | 브라우저 수집 전 경로 | `originHost` 1필드 전달. 분류코드를 못 찾으면 현행과 동일 |
| 화면 `CdpWooConnectForm` · `CdpSettingsPage` | 우커머스 모달 | `isAdmin` → `canConnect` + 분류코드 칸·문구. 나머지 5폼 불변 |
| 돈·발송 | 크레딧·발송 큐 | 무접촉. 단 §3-6은 직접 타겟 발송의 대상 범위를 좁힌다(넓히는 방향 0) |

---

## 5. 단계

| 단계 | 범위 | 게이트 |
|---|---|---|
| **P0 측정** | §7-1·§7-2·§7-3 SQL 실행(Harold) | 결과 확인 전 §3-6 착수 0 |
| **P1 공용 최소** | `linkCustomerStore` CT · `identifyCustomer`·`syncOrder` 선택 인자 · **현재 동작 캡처 테스트**(인자 생략 = SQL·결과 불변) | 백엔드 전체 테스트 |
| **P2 우커머스** | 연동 행 `storeCode` · `processWooResource` 전달 · 권한 CT + 라우트 6 · `/status` 범위·권한 값 · 상품 탭 범위 · SDK Origin → 분류코드 (state payload 는 불필요로 폐기 · §3-5) | 계약 테스트: 사용자 A가 B 분류코드 몰을 볼 수 없다 · 본문 분류코드 위조 거부 |
| **P3 격리 CT** | `store-scope.ts` 6케이스 캡처 테스트 → 폴백 조건 변경 | §7-1 목록 Harold 확인 |
| **P4 화면** | 우커머스 폼 `canConnect` · 분류코드 칸 · 잠금 문구 3종 · 몰 목록 배지 | tsc 0 · 금칙어 grep |
| **배포·실측** | §6 | Codex = 대상 아님(돈·DDL 무접촉)이나 공용 CT 2개 변경이라 `/codex:review` 1R 권장 |
| **P5 나머지 provider** | 카페24·고도몰·아임웹·네이버·메이크샵: 권한 CT 호출부 교체 + `meta.store_code` + 폼 5개 | 별도 승인 |

---

## 6. 실측 시나리오 (이에스페이먼트 · 배포 후)

1. 관리자 `espayment`로 회사 설정에서 분류코드 등록부에 4개 등록 → 사용자 관리에서 `espayment1~4`에 1개씩 배정.
2. `espayment1` 로그인 → 자사몰 연동 → 우커머스: 분류코드 한 줄 안내가 보이고 버튼 활성 → 이로이로도쿄 승인 → 목록에 그 몰 1개만.
3. `espayment2` 로그인 → 목록에 이로이로도쿄가 **안 보인다** → 고객 목록 0건(전체가 열리지 않는다 = §3-6) → 같은 몰 주소로 연결 시도 → 409 문구.
4. 백필 뒤 `espayment1` 고객 목록 = 이로이로도쿄 회원만 · 관리자 = 전체 · 직접 타겟 발송 대상 수도 같은 범위.
5. 확인 SQL(서버) = 그 회사 `customer_stores`의 분류코드별 고객 수 · 연동 행 `meta->>'store_code'`.
6. 미배정 계정 1개로 접속 → 미배정 문구 · 버튼 비활성.

---

## 7. 미검증 · 확인 필요 (Harold 실행 · 하나씩)

**7-1. 격리 CT 변경으로 행동이 바뀌는 사용자(전 회사)** — 배정 코드가 하나도 안 맞는데 회사에는 분류 체계가 있는 사용자. 지금은 회사 전체를 보고, 변경 뒤에는 0건을 본다. 실행 위치 = 한줄로 서버(.62)
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT c.name AS company, u.login_id, u.store_codes FROM users u JOIN companies c ON c.id = u.company_id WHERE u.user_type = 'user' AND u.store_codes IS NOT NULL AND array_length(u.store_codes, 1) > 0 AND EXISTS (SELECT 1 FROM customer_stores cs WHERE cs.company_id = u.company_id) AND NOT EXISTS (SELECT 1 FROM customer_stores cs WHERE cs.company_id = u.company_id AND cs.store_code = ANY(u.store_codes)) ORDER BY 1, 2;"
```

> **7-1 실측 결과(0918 Harold 실행)** = 영향 사용자 **0명**. 표본 확인 = 분류코드가 배정된 일반 사용자 7명 · 자기 코드의 고객이 실재(`matched`) 0명 · 회사에 분류 체계 자체가 없음(`customer_stores` 0행) 7명 → 0 + 7 = 7이라 0건이 확정이다. §3-6 변경은 현 고객사의 조회·발송 범위를 1건도 바꾸지 않는다.
> **곁들여 드러난 사실**: 지금 운영에서 `filtered` 갈래로 실제 격리되고 있는 사용자는 **0명**이다. 배정된 7명은 전원 "분류 체계 없는 회사" 소속이라 배정이 아무 효과 없이 회사 전체를 본다(D136 폴백). 상시 원칙의 장치는 있으나 지금 그 장치로 나뉘어 있는 회사는 없다. 그 7명이 격리를 기대하고 배정된 것인지는 회사별로 Harold 확인이 필요하다(7-2 결과가 회사명을 보여 준다).

**7-2. 분류코드가 배정된 7명의 회사와 그 회사의 자사몰 연동 수**(유령 배정 상태인 회사 식별 + 소급 대상 유무). 실행 위치 = 한줄로 서버(.62)
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT c.name AS company, u.login_id, u.store_codes, (SELECT COUNT(*) FROM company_integrations ci WHERE ci.company_id = c.id AND ci.status <> 'revoked') AS integrations FROM users u JOIN companies c ON c.id = u.company_id WHERE u.user_type = 'user' AND u.store_codes IS NOT NULL AND array_length(u.store_codes, 1) > 0 ORDER BY 1, 2;"
```

> **7-2 실측 결과(0918 Harold 실행)** = 시세이도 5명(`sh_cpb` CPB · `sh_crm` CRM · `sh_de` DE · `sh_nars` NARS · `sh_sh` SH · 자사몰 0) · 디버깅테스트 1명(`hoyun123` ONLINE · 자사몰 6 = 우리 시험 회사) · 주식회사 인비토 1명(`gwchae` JIHYUN · 자사몰 0 · D136의 그 사례). **실고객 소급 대상 0.** §3-8은 시험 회사 외에 할 일이 없다.
> **별건(기록만)**: 시세이도는 브랜드별 계정 5개에 분류코드가 배정돼 있는데 회사에 `customer_stores`가 0행이라 다섯 계정 모두 회사 전체 고객을 본다. 고객 DB를 쓰지 않는 회사(직접발송·수신자 파일)라 무해한 것인지, 격리를 기대하는데 안 되고 있는 것인지는 고객 수 확인이 먼저다(§8에 등재).

**7-3. 이에스페이먼트 분류코드 등록부 현재 값.** 실행 위치 = 한줄로 서버(.62)
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT name, store_code_list FROM companies WHERE name = '(주)이에스페이먼트';"
```

**7-4. `users.store_codes` 배열 타입(SCHEMA 미등재였다 · 등재용).** 실행 위치 = 한줄로 서버(.62)
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'store_codes';"
```

**그 밖**
- `users.store_codes`가 등록부와 어긋난 값(오타·옛 코드)을 가진 회사가 있는지(서버가 대조하지 않는다 · 7-1이 간접 지표).
- 접수 화면의 수신동의 메타키 `mssms_agreement_label`: 0914 4몰 가입 폼 실측 필드명은 `mssms_agreement`. 실제 저장 키는 고객사 확인 필요(틀리면 수신동의가 전부 "기존값 유지 · 신규 미동의").
- 일본이모에서 받은 수신동의로 다른 몰 이름의 광고를 보낼 수 있는지는 법 판단이다. 이 설계는 몰별 사용자가 자기 몰 고객에게만 보내게 만들므로 그 질문이 생기는 경로 자체를 줄인다(관리자 전체 발송은 남는다).

---

## 8. 범위 밖 · 별건 — 무엇을 · 왜 이번 축에 넣지 않았나 · 지금 위험 · 재개 조건 · 소유 (착수 판단 = Harold)

> 규율 = `scope_discipline_one_ticket_axis`(한 세션 = 접수 축 하나 · 공용 컴포넌트는 호출부에서 막고 공용 수정은 별도 과제). 이번 축 = **"몰별 사용자가 자기 몰을 연결하고 그 몰 고객만 본다"**. 아래는 조사 중 드러났으나 그 축과 뿌리가 다르거나, 뿌리가 같아도 다른 소유 문서·다른 승인 단위인 것들이다. 각각 "이번에 안 한 이유"가 없으면 다음 세션이 임의로 착수하거나 잊는다.

### 8-1. 여정·자동 실행 계열이 사용자 분류코드를 보지 않는다 — **가장 큰 것**
- **무엇**: 여정 진입 판정·대상 조회가 회사 단위다(`journey-trigger-watcher.ts:93·235` · `journey_entry_ledger`의 `store_code`는 고객 행의 값을 기록만 하지 사용자 범위를 거르지 않는다 · `journey-*` 파일은 `customer_stores` 소비처 목록에 없다). 몰별 사용자가 만든 구매 트리거 여정에 다른 몰 고객이 진입해 그 사용자의 발신번호로 문자가 나간다.
- **왜 이번 축이 아닌가**: ①뿌리가 다르다. 이번 축은 "연동·적재에 분류코드가 없다"였고, 여정은 분류코드가 있어도 "누구의 여정인가"라는 **소유자 축이 데이터 모델에 없다**(여정 행에 만든 사람은 있어도 진입 판정이 그것을 읽지 않는다). ②소유 문서가 다르다 — [FEATURE-JOURNEY.md](FEATURE-JOURNEY.md) §2 불변 원칙을 바꾸는 일이라 그 문서의 승인 단위다. ③기존 다매장 회사 전부의 성질이지 이에스페이먼트만의 것이 아니다 — 고치면 여정을 쓰는 모든 회사의 진입 수가 바뀔 수 있어 측정이 먼저다. ④이에스페이먼트는 아직 몰 0·여정 사용 여부 미확인이라 지금 실물 피해가 0이다.
- **지금 위험**: 배포 뒤 이에스페이먼트가 몰별 계정으로 여정을 만들면 그 순간 발생한다. 그래서 **운영 가드 = 이에스페이먼트의 여정은 관리자 계정에서만**(안내 문장에 포함).
- **재개 조건·방향**: 이에스페이먼트가 여정을 쓰겠다고 하거나 다몰·다사용자 회사가 하나 더 생기면. 방향(미검증) = 여정 행에 분류코드 축(만든 사용자의 `store_codes`를 활성화 시점에 스냅샷) + 진입 판정에 `customer_stores` 필터 + 관리자 여정은 전체. 착수 전 측정 = 여정을 쓰는 회사 중 `users.store_codes` 배정이 있는 회사 수.

### 8-2. 나머지 5 provider(카페24·고도몰·아임웹·네이버·메이크샵)의 연결 권한 = P5
- **무엇**: 라우트 12곳·폼 5개가 아직 `company_admin` 한정(`cdp-provider-keys.contract.test.ts`가 그 상태를 고정). 연동 행 `meta.store_code`도 안 쓴다.
- **왜 이번 축이 아닌가**: ①실물 다몰 provider가 우커머스뿐이다 — 카페24·고도몰 등은 회사당 몰 1개 관례(`makeshop-client.ts:156`의 `LIMIT 1` 폴백 · 몰 다중 UI 없음)라 "사용자마다 몰이 따로"가 지금 생길 수 없다. ②같은 CT를 호출부만 바꿔 붙이는 일이지만 6폼·12라우트 동시 변경은 축 확대이고, 각 client의 `identifyCustomer` 호출에 분류코드를 싣는 자리(카페24 `:642` · 고도몰 `:161` · 아임웹 `:392` · 네이버 `:535`)를 provider마다 실측해야 한다. ③계약 테스트가 5종 관리자 전용을 못 박고 있어 한 번에 풀면 되돌림 지점이 흐려진다.
- **재개 조건·방향**: 다른 provider에서 같은 접수가 오거나, 우커머스 실측(§6)이 끝나 CT가 검증됐을 때. 방향 = 권한 CT 호출부 교체 + 각 client 적재 호출에 `storeCode` + 폼 5개에 같은 서버 값 배선 + 계약 테스트의 5종 문장을 CT 문장으로.

### 8-3. 서버 API 키 경로(`/api/cdp/identify` · `/orders` · 자체호스팅 웹훅)의 분류 축
- **무엇**: API 키가 회사당 하나라 어느 몰(분류코드)에서 온 회원인지 모른다. 이 경로로 들어온 고객은 계속 분류 없이 적재된다.
- **왜 이번 축이 아닌가**: ①이에스페이먼트는 우커머스 REST·웹훅·SDK 경로만 쓴다 — API 키 경로 사용자가 아니다. ②푸는 방법이 "키 단위 분류코드"(키 발급 구조 `cdp-auth.ts` 변경 · 회사가 몰마다 키를 따로 발급)라 인증 축 설계다. ③요청 필드로 받으면 §2-3(분류코드는 본문에서 받지 않는다)을 깨므로 그 길은 없다.
- **재개 조건·방향**: 자체구축 몰을 사용자별로 나눠 쓰는 회사가 생기면. 방향 = `cdp_api_keys`(또는 그에 해당하는 발급 원장)에 `store_code` + `requireCdpApiKey`가 `req.cdpAuth.storeCode`로 실어 `identify`·`syncOrder`에 전달.

### 8-4. `customer_stores` 인라인 쓰기 3곳을 CT-77로 통합
- **무엇**: `routes/upload.ts:789~808` · `routes/sync.ts:831·863` · `routes/customers.ts:543`이 같은 INSERT를 각자 들고 있다. 이번에 네 번째를 만들지 않으려고 CT(`customer-store-link.ts`)를 두고 자사몰 적재만 그것을 부른다.
- **왜 이번 축이 아닌가**: 동작이 같은 리팩터다. 업로드·싱크는 500건 청크 트랜잭션 안에서 배열 VALUES로 넣는 구조라(`sync.ts:822~836`) 단건 함수로 바꾸면 성능·트랜잭션 경계가 달라진다 — 이득(중복 제거)보다 회귀 위험이 크고, 이번 접수를 닫는 데 필요하지 않다(`no_patchwork`이 아니라 `scope` 규율).
- **재개 조건·방향**: 그 세 경로 중 하나를 다른 이유로 손댈 때 함께. 방향 = CT에 배열 버전(`linkCustomerStores(companyId, pairs[])`)을 추가하고 세 곳을 그것으로.

### 8-5. `manage-users`가 `users.store_codes`를 등록부(`companies.store_code_list`)와 대조하지 않는다
- **무엇**: 자유 문자열이라 오타·옛 코드가 들어갈 수 있다(`manage-users.ts:127~141·169~191` · `admin.ts:210`).
- **왜 이번 축이 아닌가**: ①사용자 관리 화면(고객사 관리자·슈퍼관리자 2경로)의 축이다. ②이번 변경으로 잘못된 코드의 결말이 안전해졌다 — 종전엔 회사 전체가 열렸지만 이제 0건으로 드러난다(§3-6). ③0918 측정에서 등록부와 어긋난 배정은 발견되지 않았다(7명 전원 분류 체계 없는 회사라 간접 지표).
- **재개 조건·방향**: 배정 화면을 손댈 때. 방향 = 저장 시 등록부 포함 검사 + 등록부에서 코드를 지울 때 배정된 사용자 수를 보여 주고 막기.

### 8-6. `company_integrations`를 provider 조건 없이 읽는 2곳의 fail-open
- **무엇**: `utils/inapp-display-eligibility.ts:71~83`(미지 provider = `manual` 보수적 허용 → 인앱 생성·게시 게이트 개방) · `utils/performance-data-availability.ts:65~68`(`access_token IS NOT NULL` 카운트 → "쇼핑몰 연동됨").
- **왜 이번 축이 아닌가**: 이번 설계는 `company_integrations`에 새 provider 행을 넣지 않고(우커머스 행은 이미 있던 provider) `meta` 키만 더했다 — 두 곳은 `provider`·`status`·`access_token`만 읽어 **영향 0**. 반대로 SNS 게시 설계(0917)는 이 두 곳 때문에 `company_integrations` 재사용을 폐기했다(SNS 설계서 §1-2). 즉 지뢰는 남아 있고 다음 provider가 밟는다. 인앱·성과 축 담당의 판단 사항.
- **재개 조건·방향**: 자사몰 밖의 provider를 이 표에 넣으려는 순간 반드시. 방향 = 두 조회에 `provider IN (자사몰 목록)`을 명시하고 그 목록을 CT 상수 하나가 소유 · `|| 'manual'`을 fail-closed로.

### 8-7. 고객 RFM(누적 구매액·구매 횟수)이 고객 1행에 합산된다
- **무엇**: 두 몰 회원의 구매액이 몰별로 갈리지 않는다(`cdp-orders.ts:110~125`가 `customers` 행 하나를 갱신).
- **왜 이번 축이 아닌가**: "폰당 고객 1행 · 다매장은 `customer_stores`"(SCHEMA customers 절 · 0814 결정)의 직접 귀결이고, 기존 다매장 회사 전부의 성질이다. 몰별 RFM은 구매를 매장 축으로 다시 세는 데이터 모델 변경(구매 원장 또는 `cdp_events`의 분류 축 집계)이라 별도 설계다.
- **재개 조건·방향**: 고객사가 "우리 몰 구매액만"을 요구하면. 방향 = `cdp_events` purchase 이벤트에 `store_code` 속성(적재 시점에 몰 행 값) + 화면·필터가 그것으로 집계.

### 8-8. SNS 게시 설계서(0917)에 같은 축 반영
- **무엇**: SNS 계정 연결도 회사 단위로 설계돼 있다(`sns_accounts` · 목록·게시물 범위 = 회사). 몰별 담당자가 자기 브랜드 계정만 써야 하는 회사(이에스페이먼트가 SNS를 쓰면 정확히 그렇다)에서 같은 구멍이 난다.
- **왜 이번 축이 아닌가**: 그 설계서가 Harold 검토 대기 중(결재 4건)이라 승인 전 개정은 두 문서를 동시에 흔든다. 코드 0인 문서라 위험도 0이다.
- **재개 조건·방향**: SNS 설계 승인 직후 §2 불변 원칙에 "분류코드 배정 사용자는 자기 SNS 계정만 연결·게시"를, §3-1 `sns_accounts`에 `store_code`를, §3-11 게이트에 CT-78 재사용을 넣는다.

### 8-9. 시세이도 브랜드 계정 5개 — 확인 결과 무해 · 종결
- **무엇**: `sh_cpb`·`sh_crm`·`sh_de`·`sh_nars`·`sh_sh`에 분류코드가 배정돼 있으나 `customer_stores` 0행이라 격리가 작동하지 않는 상태로 보였다.
- **확인**: 고객 0명(0918 SQL). 나눌 고객이 없어 무해. 고객 DB를 쓰기 시작하면 8-5·§3-6 규칙 그대로 작동한다. 별건에서 내린다.

### 8-10. 이에스페이먼트 수신동의 메타키 `mssms_agreement_label`
- **무엇**: 접수 화면에 입력돼 있던 값. 0914 4몰 가입 폼 실측 필드명은 `mssms_agreement`이고 폼 예시도 그 값이다. 실제 저장 키가 무엇인지는 고객사만 안다.
- **왜 이번 축이 아닌가**: 코드 문제가 아니라 고객사 확인 사항이다. 틀리면 수신동의가 전부 "기존값 유지 · 신규 미동의"로 들어간다(§7 미검증 항목 · 계약 소유 = [2026-09-14 우커머스 설계서](2026-09-14-woocommerce-integration-design.md) · 발송 대상에서 빠지는 방향이라 법 위험은 0 · 마케팅 손실만).
- **재개 조건**: 연결 안내 때 함께 확인 — "회원가입 폼의 수신동의 필드가 DB에 어떤 메타키로 저장되는가".

### 8-11. 코드 밖 · 다른 트랙
- 시댄스 홍보 영상 프롬프트 연구(SNS 1차의 재료) = Harold와 별도 세션 · 코드 무관.
- 이에스페이먼트 연결 안내 문구(관리자 등록부 4 → 배정 4 → 각자 연결 · 여정은 관리자만) = 배포·실측 뒤 Harold가 박성용 과장에게.

## 9. 구현 기록 (2026-09-18 · P1~P4 · TDD · 배포완료 0918 08:57 · 실측 대기)

| 층 | 파일 | 무엇 |
|---|---|---|
| CT 신설 | `utils/customer-store-link.ts` | `linkCustomerStore` — 형제 경로와 같은 `INSERT ... ON CONFLICT (customer_id, store_code) DO NOTHING` · 빈 코드 = 쿼리 0 · 실패는 false |
| CT 신설 | `utils/integration-scope.ts` | `resolveIntegrationActor`(세션 → admin/user/blocked · 사용자 코드는 DB 재조회) · `canTouchIntegration` · `pickStoreCodeForConnect`(사용자 1코드 자동 · 여러 코드 선택 · 관리자 등록부) · `listCompanyStoreCodes` · `resolveStoreCodeByOriginHost`(SDK Origin → 몰 행 분류코드) · `integrationLockMessage`(사유 문장 소유) |
| 공용 적재 | `utils/cdp-identity.ts` · `utils/cdp-orders.ts` | `IdentifyInput.storeCode?` · `OrderInput.storeCode?` · 고객 확정 뒤(조기 반환 경로 포함) `recordStoreMembership` · 생략 = 불변(캡처 테스트) |
| 우커머스 | `utils/woocommerce-client.ts` · `utils/woocommerce-adapter.ts` · `routes/woocommerce.ts` | `meta.store_code` ↔ `storeCode` · `saveWooCredentials.storeCode`(undefined = 덮지 않음) · `processWooResource(..., storeCode)` · 백필·웹훅 전달 · `gateActor`/`gateMall`/`decideStoreCode` · `/status`에 `can_connect`·`lock_reason`·`lock_message`·`connect_store_codes`·`store_code_options` · 몰 줄 `storeCode` |
| 상품 피커 | `routes/mall-products.ts` | `/providers`·`wooMallOf` 를 주체 범위로 |
| SDK | `routes/cdp.ts` · `utils/cdp-events.ts` | `/ingest`가 검증된 Origin 으로 분류코드 조회 → `BrowserIngestBatch.storeCode` → identify |
| 격리 CT | `utils/store-scope.ts` | 유령 배정 폴백 = 회사 전체 0행일 때만(§3-6) · 헤더 계약 갱신 |
| 화면 | `components/cdp/CdpConnectForms.tsx`(우커머스 폼) · `pages/CdpSettingsPage.tsx` | 잠금 = 서버 `can_connect` · 잠금 사유 = 서버 문장(amber 안내 줄) · 분류 코드 칸 3모양(관리자 선택 / 사용자 1코드 안내 / 여러 코드 선택) · 몰 줄 배지(`분류 코드 X` / `회사 공용`) · 요청 본문 `store_code` · 나머지 5폼 불변 |
| 테스트 | `customer-store-link` 8 · `cdp-identity-store-code` 7 · `cdp-orders-store-code` 2 · `integration-scope` 15 · `woocommerce-store-code` 8 · `woocommerce-adapter` +1 · `woocommerce-routes` 5 정정·신설 · `cdp-events-store-code` 2 · `mall-user-scope-routes` 4(프론트 소스 계약 포함) · `store-scope` 7(캡처 6 + 변경 1) · 옛 계약 2건 정정(`operator-audience` 보류→좁힘 · `cdp-provider-keys.contract` 5종 관리자 + 우커머스 CT) | 백엔드 전체 **330파일 5,032건 통과** · tsc 0(백·프) |

- 배포 순서 = 서버 먼저(`/status`가 `can_connect`를 내려야 새 화면이 열린다 · 옛 화면은 관리자 `isAdmin`으로 그대로 동작) → 프론트 빌드. 절차 = [OPS §2-2](../status/OPS.md).
- 남은 것 = **실측 §6**(자사 시험 회사 또는 이에스페이먼트 관리자 계정으로) → 이에스페이먼트 안내(분류 코드 등록 4 → 사용자 배정 4 → 각자 연결) → **P5**(나머지 5 provider 라우트·폼을 같은 CT로) → Codex `/codex:review` 1R(공용 CT 2개 변경 · 돈·DDL 무접촉이라 권장 수준 · Harold 실행).
- 실측 게이트 ③(`information_schema`)은 신규 컬럼·테이블이 0이라 해당 없음. `users.store_codes`의 정확한 배열 타입은 SCHEMA 미등재였다 → §7에 확인 SQL.

