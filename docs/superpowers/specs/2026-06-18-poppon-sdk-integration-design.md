# 팝폰(Poppon) 한줄로 SDK 연동 검증 — 설계서

- 작성일: 2026-06-18
- 구현 대상: `C:\Users\ceo\projects\poppon-workspace\poppon` (Next.js 15 웹, 별개 프로젝트 — Harold님 소유)
- SDK: `@hanjullo/sdk v0.3.6` (`https://app.hanjul.ai/sdk/v0.3.6/hanjul.min.js`, 이미 배포됨 — 한줄로 쪽 코드 변경 없음)
- 연동 환경: 프로덕션 팝폰(www.poppon.co.kr) 직접, Harold님 계정 실측

---

## 1. 목표와 범위

자체 운영 서비스인 팝폰을 베드로 한줄로 SDK의 전 흐름을 실측한다. 고객사 의존 0이라 SDK 신뢰성 검증에 최적이다.

### 이번 범위 — 완벽 검증
- SDK 로딩·auto-init (`data-hjl-key`)
- 익명 수집: pageview · click · heartbeat · anonymousId · sessionId · consent
- identify: externalId(Supabase `user.id`) + email + name, SPA 늦은 로그인(MutationObserver)
- transport: batch · retry · `/ingest`
- 행동 이벤트(비이커머스):
  - `product_view` (딜 상세 조회)
  - `search` (검색)
  - `wishlist_add` / `wishlist_remove` (찜/저장)
  - `custom_copy_code` (쿠폰 코드 복사)
  - `custom_click_out` (외부 사이트 이동)
  - `custom_follow_merchant` (브랜드 구독)
- 인앱 메시지: 세그먼트 조건 기반 노출

### 이번 비범위 — 다음 단계(장바구니 있는 실제 자사몰 고객사 파일럿)에서
- 이커머스 퍼널: `cart_add` · `cart_view` · `checkout_start` · `checkout_complete` · `purchase`
- GA4 dataLayer 자동수집 (팝폰 미사용)
- 트리거 인앱 (장바구니 이탈 리커버리 등 커머스 이벤트 직후 인앱)
- 이커머스 RFM · 구매 세그먼트 · 매출/ROI
- 인공 주입 테스트 페이지

근거: 팝폰은 구매를 외부 브랜드로 넘기는 딜·쿠폰 중개 모델이라 장바구니·결제가 없다. 이커머스 퍼널은 다음 단계에서 장바구니 있는 실제 자사몰 고객사 1곳에 파일럿으로 붙이며 오류를 잡는다. 이번 단계는 그 직전까지의 SDK 신뢰도(토대)를 빈틈없이 확보하는 것이 목표다.

---

## 2. 현황 (정독 확인)

### 2.1 스택·라우팅·로그인
- Next.js 15 App Router(`src/app`), React 19, Supabase 인증, Tailwind
- 라우팅: `/`(홈) · `/d/[slug]`(딜 상세) · `/c/[categorySlug]` · `/m/[merchantSlug]` · `/me`(마이페이지) · `/search`. 외부 이동 = `/out/[dealId]` 서버 302 리다이렉트
- 로그인: Supabase Auth. `lib/auth/AuthProvider.tsx`가 `onAuthStateChange`로 로그인/로그아웃을 잡아 이미 `setTrackingUserId(user.id)`를 호출 중 — identify를 걸 단일 지점이 이미 존재한다. externalId = Supabase `user.id`(UUID)

### 2.2 기존 추적 (그대로 유지)
- `lib/tracking.ts` v3가 팝폰 자체 분석(Supabase `deal_actions`)을 이미 수집한다. 이번 작업은 한줄로 전송만 병행으로 얹는다(이중 추적, 회귀 0).
- 호출 지점 확인:
  - 딜 조회 = `components/deal/DealDetail.tsx:38` useEffect → `trackDealView(deal.id)` (이 컴포넌트의 `deal` 객체에 title·categories.name·merchants 존재 → product_view를 풍부하게 채울 수 있음)
  - 쿠폰 복사 = `components/deal/CopyCodeButton.tsx` → `trackCopyCode(dealId, code)`
  - 클릭아웃 = `app/out/[dealId]/route.ts` 서버 302 (클라 미경유 → CTA onClick에 별도 배선 필요)
  - 찜·구독 = `components/deal/DealActionBar.tsx` 직접 fetch (트래킹 함수 미경유 → 성공 분기에 별도 배선 필요)
  - 검색 = `lib/tracking.ts` `trackSearch` (정의는 있으나 호출처가 grep에 미확인 — 구현 시 `search/page.tsx`·`SearchBar` 확인하여 호출이 없으면 검색 실행 지점에 배선 추가)

### 2.3 SDK(v0.3.6) 적합성
- 삽입: `<script ... data-hjl-key="hjl_...">` 한 줄. `auto-init.ts`가 `script[data-hjl-key]`를 잡아 자동 기동(설치 코드 0)
- identify: `identify.ts`가 body의 `data-hjl-user-id`(+email/phone/name) 변화를 MutationObserver로 감지
- 행동: `hjl.track(표준명 | custom_…)`. 비표준 이름은 SDK가 사전 차단
- 인앱: init 시 자동 기동, externalId(로그인)/anonymousId(비로그인) 조회
- transport: POST `app.hanjul.ai/api/cdp/ingest`, batch 20 또는 5초, header `X-Hanjullo-Key`

---

## 3. 설계

### 3.1 수정 지점 (poppon)

| # | 파일 | 변경 | 목적 |
|---|---|---|---|
| 1 | `src/app/layout.tsx` | `next/script`로 SDK 한 줄 삽입 (`data-hjl-key={process.env.NEXT_PUBLIC_HANJUL_KEY}`) | 익명 수집 자동 시작 |
| 2 | `src/lib/auth/AuthProvider.tsx` | user+profile 확보 시 body에 `data-hjl-email` → `data-hjl-name` → `data-hjl-user-id` 순 세팅, 로그아웃 시 3개 제거 | identify (id+email+name) |
| 3 | `src/lib/tracking.ts` | `hanjulTrack(event, props)` 헬퍼 추가 + 기존 함수에서 매핑 호출 | 행동 이벤트 집약 |
| 3b | `src/components/deal/DealActionBar.tsx`, `src/components/deal/DealDetail.tsx`(CTA) | 찜·구독·클릭아웃 성공 지점에 `hanjulTrack` 추가 | 트래킹 함수 미경유 행동 보강 |

### 3.2 이벤트 매핑

| 팝폰 행동 | 위치 | 한줄로 이벤트 | properties |
|---|---|---|---|
| 딜 상세 조회 | `DealDetail.tsx:38` | `product_view` | product_id=deal.id, product_name=deal.title, category=deal.categories.name |
| 검색 | `trackSearch` | `search` | search_term=query |
| 찜 추가/해제 | `DealActionBar` handleSave | `wishlist_add` / `wishlist_remove` | product_id=dealId |
| 쿠폰 코드 복사 | `CopyCodeButton` | `custom_copy_code` | product_id=dealId |
| 외부 클릭아웃 | `DealDetail` CTA onClick | `custom_click_out` | product_id=dealId |
| 브랜드 구독 | `DealActionBar` handleFollow | `custom_follow_merchant` | merchant_id=merchantId |

### 3.3 identify 배선 디테일 (중요)

SDK `watchIdentifyChanges`는 `data-hjl-user-id` 값 변화가 있을 때만 콜백을 발화한다(email/name 변화는 observer를 깨우지만 콜백 내부는 user-id만 비교). 따라서:

- **세팅 순서: email → name → user-id** (user-id를 마지막에 세팅 → `detectIdentify()`가 셋 다 읽음)
- **세팅 시점:** AuthProvider에서 user(`user.id`, `user.email`) + profile(`name`)이 확보된 직후 일괄 세팅
- **값:** email = `user.email`(Supabase 즉시 가용), name = `profile.name || profile.nickname`
- **로그아웃:** `data-hjl-email`, `data-hjl-name`, `data-hjl-user-id` 3개 모두 `removeAttribute`
- SDK는 anonymousId로 init 후 user-id 등장 시 재조회하므로, profile 로드 지연이 있어도 늦은 로그인으로 자동 흡수됨

### 3.4 SDK 키

- `NEXT_PUBLIC_HANJUL_KEY` 환경변수로 주입 (`hjl_` 공개키 → 클라이언트 노출 정상, secret `sk_`는 사용 안 함)
- `layout.tsx`에서 `<Script src="https://app.hanjul.ai/sdk/v0.3.6/hanjul.min.js" data-hjl-key={process.env.NEXT_PUBLIC_HANJUL_KEY} strategy="afterInteractive" />`

### 3.5 행동 배선 집약

- `lib/tracking.ts`에 내부 헬퍼 `hanjulTrack(event, props)` 추가:
  - `window.hjl?.track`을 옵셔널 호출 (SDK 미로드 시 무해)
  - 이벤트명 검증은 SDK가 담당 (중복 검증 안 함)
- 기존 편의 함수(`trackDealView` 등)에서 매핑 호출. 라우트·컴포넌트 인라인 정의 금지(한 파일 집약)
- 트래킹 함수를 경유하지 않는 찜·구독·클릭아웃은 해당 컴포넌트 성공 분기에서 `hanjulTrack` 직접 호출

---

## 4. Harold님 관리자 작업 (2건)

1. app.hanjul.ai에서 팝폰용 회사 + 자사몰 연동(CDP) 키(`hjl_`) 발급 → 비토에게 키 전달 (`NEXT_PUBLIC_HANJUL_KEY`에 주입)
2. 인앱 테스트용 세그먼트 1건 + 인앱 메시지 1건 작성 (세그먼트 조건 기반 — 커머스 트리거 아님)

---

## 5. 검증 (프로덕션 직접, Harold님 계정 실측)

한줄로 CDP 대시보드에서 확인:
1. 익명 방문 수집 (비로그인 pageview·click)
2. 로그인 후 식별 고객 + email·name 표시
3. 행동 이벤트: 딜조회(product_view)·검색(search)·찜(wishlist_add)·쿠폰복사·클릭아웃·구독
4. 인앱 메시지 노출 (로그인 회원 세그먼트 매칭 시)

---

## 6. 단계 순서

1. CDP 키 발급 (Harold)
2. `layout.tsx` SDK 삽입 → 익명 수집 확인
3. `AuthProvider.tsx` identify 배선 → 식별 + email·name 확인
4. `lib/tracking.ts` + 컴포넌트 행동 배선 → 이벤트 6종 확인
5. 인앱 세그먼트·메시지 작성 (Harold) → 노출 확인

---

## 7. 리스크와 회귀 방어

- 기존 팝폰 자체 추적(Supabase)은 손대지 않음 — 한줄로 전송만 병행 추가(이중 추적). 기존 분석 회귀 0
- `window.hjl?.track` 옵셔널 체이닝 — SDK 로드 실패/지연이 팝폰 UI를 막지 않음(SDK transport도 fire-and-forget)
- SDK init 실패(키 오류 등)는 콘솔 경고만, 호스트 페이지 동작 무방해(auto-init.ts 설계)
- 환경변수 미설정 시 SDK 미삽입 — 팝폰 정상 동작(점진 배포 가능)
