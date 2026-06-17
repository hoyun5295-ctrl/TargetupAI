# BYO-Credentials CDP 커넥터 토대 + 카페24·네이버·고도몰 (2026-06-17)

## 결정 (Harold 승인 2026-06-17)
- 카페24·네이버 = **고객이 자기 인증정보를 직접 입력**(self-app client_id/secret 또는 키). 한줄로 앱스토어 출시·심사 0. 최초 1회 설정.
- 고도몰 = 전용 커넥터 신규 (현재 custom 웹훅 우회만 = 속빈 껍데기).
- 자체 호스팅(custom) = 기존 웹훅 유지.
- 싱크에이전트 = 로컬 DB 직결 (브레이즈·세일즈포스에 없는 차별점) 유지·강조.
- 원칙: "고객이 자기 정보 입력"으로도 **완벽하게 동작**해야 한다 (Harold 명시).
- 근거 조사: 세일즈포스 멀티테넌트 = 공유 앱 + 고객 OAuth(model A) / 브레이즈 = Shopify 앱스토어 발행 앱. 둘 다 출시·심사 전제. 한줄로는 출시 부담 없는 BYO 키(model B)로 먼저 가고, 대규모 확장 시 출시(model A)는 후순위.

## 토대 (공통)
- 회사별 자격 저장: `company_integrations` 기존 행 + `meta` jsonb 에 회사별 client_id/secret/api_key 보관 (DB ALTER 0 — meta는 이미 shop_no 등 저장 중). access_token/refresh_token 은 기존 컬럼.
- 클라이언트(`cafe24-client.ts` / `naver-commerce-client.ts`)가 env 단일 상수 대신 **그 회사 자격**으로 OAuth 교환·갱신·API 호출.
- 연동 센터(`CdpSettingsPage`) provider 카드 그대로 + 카드별 "내 인증정보 입력" 모달.
- env(`CAFE24_CLIENT_ID` 등)는 fallback 로만 보존 (회사값 우선, 없으면 env, 둘 다 없으면 친절 안내).

## 플랫폼별
### 카페24
- 입력: 고객 self-app의 client_id/secret + mall_id.
- 연결: 그 자격으로 OAuth authorize → callback → token 저장(`company_integrations`).
- 백필: 연결 즉시 `cafe24ApiCall`로 회원·주문 1회 적재 (현재 호출 0건 → 배선). 페이지네이션(hasNext/offset) 처리.
- 토큰: `ensureFreshCafe24Token` 주기/요청 시 갱신 (현재 호출 0건 → 보강).
- 웹훅: 기존 수신 엔드포인트 유지.
- 확인(추측 금지): self-app 자격이 외부 서버에서 도는지 = 첫 실키 1건 실측.

### 네이버 스마트스토어
- 카페24와 동형(회사별 자격 → OAuth → 백필 → 토큰). `naver-commerce-client.ts` 정독 후 동일 패턴 적용.

### 고도몰 (NHN커머스) — 속빈 껍데기 채움
- 인증(조사 확정 2026-06-17): 키 방식. partner_key(한줄로=NHN 공급사 등록 시 1회 발급) + key(각 고객 몰이 키발급 신청해 발급받아 한줄로 화면에 입력). OAuth·앱 출시·심사 없음 = BYO 모델에 가장 깔끔.
- 데이터: 상품/재고/주문/회원/게시판. 주문조회 파라미터 = dateType/startDate/endDate/orderNo/orderStatus/orderChannel.
- 커넥터 신규: 회원·주문·상품 백필 + 주기 동기화. `cdp-identity`/`cdp-orders`/`cdp-events` CT 재사용.
- 스펙 확정(공식 PDF v1.0 2025-06-16, 추출본 = Downloads/godo_spec_extract.txt 91p):
  - 연동 = POST 웹통신, **응답 = XML**(JSON 아님), 인코딩 UTF-8.
  - 도메인: real = https://openhub.godo.co.kr/ , sandbox = http://sbopenhub.godo.co.kr/
  - 인증: 요청 body에 `partner_key`(제휴사 인증키 = 한줄로, STRING Y) + `key`(쇼핑몰 인증키 = 고객 몰, STRING Y) 둘 다 필수.
  - 엔드포인트(POST): 주문조회 `/godomall5/order/Order_Search.php`, 상품조회 `/godomall5/goods/Goods_Search.php`, 게시판 `/godomall5/board/*`. 회원조회 endpoint는 추출본 '회원/member' 절에서 확인(구현 시).
  - 페이지네이션: `page`(INTEGER) + `size`(INTEGER).
  - RETURN code: 000 성공 / 999 인증키 유효X / 998 제휴사키 유효X / 997 사용기간X / **996 허용 안 된 IP** / 995 접속권한X.
  - **한줄로 서버 IP 허용 등록 필요**(996). Rate limit = Token Bucket(1초 100회+ → 429; 응답헤더 `ratelimit-available-level`=EXHAUSTED면 호출 중단).
  - 구현 시 주의: XML 파서 필요(cdp-orders/cdp-identity CT로 정규화), partner_key 발급 약 3일 대기 후.

## 완벽 동작 안전망
- 연결 즉시 백필(과거 데이터 0 방지) + 토큰 자동 갱신(만료 방치 0).
- 백필 dedup(재실행 중복 적재 0 — 멱등 키).
- 데이터 합류: 모든 소스 → 한 고객 GREATEST 병합(덮어쓰기 X — LESSONS_DB D214).
- 자격 미설정/오류 endpoint = 503 친절 안내(`DB_MIGRATION_PENDING` 패턴 정합).
- 연결 상태 가시화(들어오는 중 / 마지막 수신 시각).
- 검증: TDD(순수 로직 RED→GREEN) + 읽기 적재라 발송·돈 무관 + 실측 1건.

## 빌드 순서
1. 토대 (회사별 자격 모델 + UI 입력)
2. 카페24 (키 → 연결 → 백필 → 토큰)
3. 네이버 (동형)
4. 고도몰 (NHN 스펙 확정 후 커넥터)

## 확인 대기 (추측 금지 항목)
- 카페24·네이버 self-app 외부서버 사용 가부 = 첫 실키 실측.
- 고도몰 NHN API 스펙 = 문서/문의 확정.

## 보류 (별개 트랙)
- 카페24·네이버 공식 앱스토어 출시(model A) = 대규모 확장 시점.
- 팝폰(애플·구글 소비자 앱) = 앱 메시지 네이티브 채널 후보(본 작업과 무관).

---

## 구현 완료 (2026-06-17 세션 · tsc 0 · verify pass · 미배포)
- `provider-credentials.ts`(resolveProviderOAuthCredentials, verify 5/5) · `provider-oauth-url.ts`(cafe24·naver authorize URL 빌더, verify 11/11) — DB-free 순수.
- `cafe24-client.ts` · `naver-commerce-client.ts` — build/exchange/refresh + ensureFresh + apiCall 전부 `creds?`(회사별, 없으면 env). + `save/get{Cafe24|NaverCommerce}ByoCredentials`(meta.app_client_id/secret 저장·resolver 조회, redirect=우리 콜백 고정).
- `routes/cafe24.ts` · `routes/naver-commerce.ts` — `POST /byo-credentials`(client_id/secret/mall_id|store_id, company_admin) + authorize·callback이 BYO creds 사용. status `pending_oauth`→`active`.
- 고도몰 스펙 확정(위 § + Downloads/godo_spec_extract.txt).
- 검증 실행: tsc = `node packages/backend/node_modules/typescript/bin/tsc --noEmit -p packages/backend/tsconfig.json` (npx tsc는 동명 패키지 잡힘). verify = `npx ts-node --project packages/backend/tsconfig.json <파일>.verify.ts`.

## 다음 세션 할 일 (정확히 이어가기)
1. **연동센터 UI "내 인증정보 입력" 폼** — `CdpSettingsPage.tsx`(1595줄) 976~ 연결 모달 정독 후 확장. 여정급 디자인(design_quality_minimum_journey_level: 다크+violet, ConfirmModal/useToast, 단계 안내, native dialog 0).
   - cafe24 모달: mall_id + client_id + client_secret 입력 → `POST /api/cafe24/byo-credentials` → 성공 시 `GET /api/cafe24/oauth/authorize?mall_id=`(새 창). 안내: 고객이 카페24 개발자센터 자체앱 생성 + redirect_uri에 우리 콜백 등록.
   - naver 모달: store_id + client_id + client_secret → `POST /api/naver-commerce/byo-credentials` → authorize.
2. **백필** — callback 토큰 저장 직후 회사 creds로 `cafe24ApiCall`/`naverCommerceApiCall` 호출해 회원·주문 1회 import → `identifyCustomer`/`syncOrder` CT. **cafe24·naver Admin API 엔드포인트·응답 키는 첫 실호출 raw로 확인 후 작성(D217 룰 — 추측 금지).** 페이지네이션·dedup·회사 creds 전달.
3. **고도몰 커넥터**(partner_key 약 3일 후) — provider-registry 등록 + XML 파서 + `openhub.godo.co.kr` POST(body partner_key+key) + 회원/주문/상품 → CDP CT. IP 허용 등록, page/size, 429 주의. 스펙 = Downloads/godo_spec_extract.txt.

## 진행 (2026-06-18 — Task ① 연동센터 UI 완료 · 미배포)
- `CdpSettingsPage.tsx` 카페24·네이버 연결 모달의 "미연결" 분기를 BYO 입력 폼으로 확장. 안내 4단계(개발자센터 자체앱 생성 → 고정 Redirect URI 복사 등록 → scope 선택 → Client ID·Secret 입력) + mall_id/store_id + Client ID + Client Secret(보기 토글) 입력 + "저장하고 연결" 버튼 하나.
- 흐름: `POST /api/cafe24|naver-commerce/byo-credentials {mall_id|store_id, client_id, client_secret}` → 성공 시 `GET /oauth/authorize?...` → authorize_url 새 창. 실패 시 서버 메시지 toast.
- 고정 콜백 표기: 카페24 `https://app.hanjul.ai/api/cafe24/oauth/callback`, 네이버 `https://app.hanjul.ai/api/naver-commerce/oauth/callback`. scope 칩 = 백엔드 DEFAULT_SCOPE와 동일(추측 0).
- 신규: `GuideStep` 헬퍼, callback/scope 상수, BYO 입력 state 6개, 아이콘 Eye/EyeOff/ExternalLink. PROVIDER_META note를 self-app 키 입력 흐름으로 갱신.
- 검증: 프론트 tsc 0 · 자가 grep(모델명·native dialog·박-단어) 0건.
- 남음: ②백필(실키 raw 확인 후 — 현재 보류) · ③고도몰(partner_key 약 3일 후).
- 배포: 프론트 + 백엔드 df448eed 함께. 프론트·백엔드 각각 `npm run build:safe` → `pm2 restart all`. (df448eed 미배포 상태에서 프론트 단독 배포 시 byo-credentials 404.)

## 진행 (2026-06-18 — Task ③ 고도몰 커넥터 코드 완료 · 미배포)
- 발견: 고도몰 공식 API에 회원 조회 API 없음(상품·주문·게시판·공통코드뿐) → 고객 식별은 주문조회 응답(memId, 비회원=guest:{orderCellPhone}). 상품은 syncOrder의 주문 품목으로 함께 적재 → ③ v1 = 주문 백필 한 경로.
- `utils/godo-parse.ts`(순수, DB-free): mapGodoOrderStatus(§7.1 코드맵), parseGodoOrderResponse(fast-xml-parser, order_data/orderGoodsData/orderInfoData isArray), mapGodoOrderToCdp(OrderInput + smsRaw). `godo-parse.verify.ts` TDD 21건 PASS.
- `utils/godo-client.ts`(IO): fetchGodoOrderPage(POST partner_key+key+dateType=order+기간+size+lastOrder, 429/EXHAUSTED/RETURN code 분기), backfillGodoOrders(30일 윈도우 분할 + lastOrder 커서 순회 + consent→identify→syncOrder), verifyGodoConnection(1콜), save/get/status/disconnect(company_integrations.meta.godo_key — 카페24 BYO 동일 패턴).
- `routes/godo.ts` + `app.ts`: POST /credentials·/connect(연결확인 후 백그라운드 백필)·GET /status·DELETE /disconnect, company_admin+plan 게이팅, GodoApiError→친화 503/400.
- 연동센터 UI: godo를 webhookProviderOpen에서 분리 → 전용 키 입력 폼(2단계 안내 + key + 보기 토글 + 저장→연동, 카페24 BYO 톤).
- 의존성: `fast-xml-parser`(backend) 추가 — 서버 npm install 필요.
- 검증: backend tsc 0 · frontend tsc 0 · TDD 21건 · grep(모델명·native dialog·박단어) 0.
- 남음: ②카페24·네이버 백필(D217 실키 raw 확인 후 — 키 대기). 고도몰 live = GODO_PARTNER_KEY(약 3일)+서버 IP NHN 허용(996)+server npm install 후 실측 1건.
- 계획서: `docs/superpowers/plans/2026-06-18-godo-connector.md`.

## 배포 (Harold — 이번 세션, 백엔드만)
- 역호환(env 경로 보존, 신규 endpoint는 UI 전까지 미호출). 카페24·네이버 현재 dormant라 영향 0.
- `tp-push "BYO 자격 연동 토대 — cafe24·naver per-company creds + BYO 라우트 + 고도몰 스펙"` → 서버 backend `npm run build:safe` → `pm2 restart targetup-backend`.
