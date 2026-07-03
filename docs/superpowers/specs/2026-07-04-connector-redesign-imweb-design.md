# 커넥터 카드 재설계 + 아임웹 정식 연동 — 설계

- 작성일: 2026-07-04
- 상태: 설계 승인됨 (Harold 2026-07-04)
- 관련 파일: `packages/frontend/src/pages/CdpSettingsPage.tsx`, `packages/backend/src/utils/provider-registry.ts`, `register-providers.ts`, `naver-commerce-client.ts`(참고 미러), `godo-client.ts`(참고 미러)

## 배경 / 시장 판단
- 커넥터 카드 UI 재정비 + 아임웹 정식 연동.
- 시장 조사: Shopify·WooCommerce = 국내 미미(웹훅으로 흡수 가능), 식스샵 = 니치·개방 API 불확실, 아임웹 = 국내 성장 + 정식 API 존재 → 정식 연동 승격.
- 네이버 = Harold가 파트너센터/커머스 API 앱 등록 중(별도 트랙). 메이크샵 = 파트너 승인 대기(별도 트랙).

## 범위
### 이번 구현
1. 커넥터 카드 재배치 + 자체호스팅 강화 + 모달 탭 (frontend) — **막힘 없음, 우선 구현**
2. Shopify·WooCommerce·식스샵 skeleton 제거 (backend register-providers) — 막힘 없음
3. 아임웹 정식 어댑터 (backend) — **정확한 API 계약 확정 후 구현**(아래 미확정 참조)

### 이번 범위 아님 (기록만)
- 네이버 어댑터 재작성: `naver-commerce-client.ts`가 `authorization_code` grant로 짜여 있으나 실제 네이버 커머스 API = **client_credentials + bcrypt 서명** `Base64(bcrypt(client_id + "_" + ts_ms_utc, secret))`. Harold 앱 준비 후 인증부 전면 재작성.
- 컴플라이언스 2트랙(정보성 즉시 / 광고성 별도 수신동의) 발송 UI 분리 — 별도 과제.

## 1. 커넥터 UI (frontend — CdpSettingsPage.tsx)
- 레이아웃: Provider 매트릭스 영역 = **좌측 대형 "자체 호스팅" 카드 + 우측 2×3 그리드**(카페24·네이버·고도몰·가비아·아임웹·메이크샵).
- `PROVIDER_CARDS` / `PROVIDER_META` / `BACKEND_ID_TO_KEY` / `ProviderKey`에 `imweb` 추가(전용 모달). `providerBrand`는 imweb 분기 이미 존재.
- 자체호스팅 강화: desc = "Shopify·WooCommerce·식스샵 등 목록에 없는 모든 몰 — webhook으로 흡수". 대형 카드 + 강화 모달.
- 모달 탭: 기존 `custom` 모달 탭(connect/web/app/verify) 패턴을 표준화. 내용 긴 모달은 탭 분할. 아임웹 모달 = 연결 / 설정 안내 / 웹훅 / 검증.
- 네이버 모달 안내문 "phone/email 제한될 수 있어 매칭률 낮음" → "실명·실번호 제공(주문 데이터), 단 광고성 발송은 별도 수신동의 필요"로 정정.
- 규칙: native dialog 0(ConfirmModal + useToast), 보라 톤, Source caption, 모바일 반응형(2×3 → 모바일 1열), 모델명 0.

## 2. Shopify·WooCommerce·식스샵 제거 (backend)
- `register-providers.ts`(또는 provider-registry.ts 하단)에서 `SkeletonProviderAdapter('shopify'|'woocommerce'|'sixshop')` 등록 제거 → `/api/cdp/providers` 응답에서 빠짐 → 카드 자동 소멸.
- 메이크샵 skeleton은 유지(승인 진행 중).
- 프론트 폴백 하드코딩 배열에도 잔존 없는지 grep 확인.

## 3. 아임웹 어댑터 (backend — 계약 확정 후)
- 파일: `packages/backend/src/utils/imweb-client.ts` (신규, `IProviderAdapter` 구현).
- 확정된 사실: 회원(Member-Info)·주문(Order)·상품(Product)·웹훅 존재. 주문 조회 `GET https://api.imweb.me/v2/shop/orders`(orderer.name/call/email, order_no, order_time, status, payment.total_price; 기본 3개월; 상품명 별도 조회). 웹훅 이벤트: 회원 가입/탈퇴/정보수정/**동의정보수정**/등급변경/장바구니추가, 주문 생성/입금/배송/취소·반품·교환, 적립금.
- **미확정(구현 전 실측 필요)**:
  - 인증 모델: v2 API-Key(환경설정>외부서비스연동>API Key/Secret 발급, 고도몰 유사) vs v3 OAuth(개발자센터 앱, Client ID/Secret + Redirect + Scope). 두 모델 공존 → 어느 쪽으로 붙일지 확정 필요.
  - OAuth authorize/token 정확 URL, 또는 API-Key 인증 헤더 형식.
  - 웹훅 서명 검증 방식.
- 확정 경로: Harold가 아임웹 개발자센터 문서 HTML 저장(OAuth 2.0 가이드·웹훅 가이드·주문/회원 reference) 또는 아임웹 개발자 앱 발급 → 실측. 메이크샵 문서 수집과 동일 방식.
- 어댑터 구조: v2 API-Key면 godo-client.ts 미러(키 입력형), v3 OAuth면 naver/cafe24 미러(OAuth형). BYO 자격 저장 = 기존 패턴 재사용. processWebhookEvent → identifyCustomer/syncOrder/trackEvent 매핑. register-providers에서 skeleton('imweb') 제거 → 실 어댑터 등록.

## 검증
- tsc 0.
- 프론트: 카드 렌더/모달/모바일 반응형 육안 + grep(native dialog 0, 모델명 0).
- 아임웹 실 endpoint/서명 = Harold 실측(개발자센터 문서 or 앱) 후 확정 — 그 전까지 imweb 카드는 backend available=false(coming_soon) 유지 또는 계약 확정 후 available.

## 구현 순서 (no_parallel — 하나씩)
1. 프론트 커넥터 재설계(레이아웃·카드 컷·자체호스팅 강화·네이버 문구·아임웹 카드 shell) + backend skeleton 3종 제거.
2. (아임웹 계약 확정 후) imweb-client.ts 어댑터 + routes/imweb.ts + 프론트 아임웹 모달 실연결.
