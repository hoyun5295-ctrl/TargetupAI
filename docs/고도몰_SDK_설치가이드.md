# 고도몰 한줄로 SDK 설치 가이드 (업체 전달용)

> 대상: 고도몰(독립몰) 운영사 개발/담당자
> 목적: 한줄로 CDP SDK를 고도몰에 설치해 회원·페이지뷰·클릭·동의를 한줄로AI로 자동 수집 + 인앱 메시지 자동 표시
> 근거: `packages/sdk-js/src/auto-capture/index.ts` (IIFE 진입점), `identify.ts` (회원 식별), `inapp.ts` (인앱 메시지)

---

## 사전 (한줄로 측이 먼저 준비/전달)
- **CDP 설치 키**: `hjl_xxxxxxxxxxxx` (한줄로 관리자 → **자사몰 연동(CDP) → 고도몰 카드 → "CDP 키" 발급**)
- 설치할 **고도몰 도메인을 같은 화면의 "수집 허용 도메인"에 등록** 완료 — 미등록 도메인은 수집 차단됨
- **유료 요금제** (무료 플랜만 차단 — 전 유료 플랜 이용 가능)
- **CDN 배포 확인** — 스크립트 URL이 실제 서빙되는지 (인프라)

---

## 1단계 — SDK 스크립트 삽입
고도몰 관리자 → 디자인(스킨) → **공통 HTML `<head>`**에 아래 1줄을 넣습니다.

```html
<script src="https://app.hanjul.ai/sdk/v0.3.5/hanjul.min.js" data-hjl-key="hjl_xxxxxxxxxxxx" async></script>
```

- `data-hjl-key`에 발급받은 키를 넣으면 **자동으로 시작**됩니다 (별도 init 코드 불필요)
- 삽입 즉시 페이지뷰·클릭이 자동 수집됩니다

---

## 2단계 — 로그인 회원 식별 (회원 데이터 연결)
고도몰 스킨의 `<body>` 태그에 로그인 회원번호를 data 속성으로 넣습니다.

```html
<body data-hjl-user-id="{=gSess.memNo}" data-hjl-phone="(휴대폰 변수)">
```

- `{=gSess.memNo}` = 고도몰 로그인 회원번호 변수 (비로그인 시 빈 값 → 익명 수집)
- **`data-hjl-phone`(휴대폰)은 사실상 필수입니다.** 한줄로는 휴대폰 번호로 기존 고객(싱크에이전트·업로드로 들어온 고객)과 같은 사람인지 연결합니다. 휴대폰이 없으면 행동 데이터가 기존 고객과 합쳐지지 않아 장바구니 리커버리 같은 발송 대상이 되지 않습니다. (`data-hjl-email`로도 보조 매칭 가능)
- (선택) `data-hjl-email="..."` / `data-hjl-name="..."`
- SDK가 이 속성을 자동 감지(로그인·변경 시점 포함)해 회원과 행동을 연결합니다

---

## 3단계 — 장바구니·구매 이벤트 전송 (장바구니 리커버리용)

페이지뷰·클릭은 자동 수집되지만, **장바구니 담기와 구매 완료는 고도몰 스킨의 해당 동작 지점에 한 줄씩 넣어야** 합니다. 이 이벤트가 있어야 "담고 안 산 고객"에게 여정(장바구니 리커버리) 메시지를 보낼 수 있습니다.

장바구니 담기 버튼 동작 지점(스킨 JS):

```html
<script>
  window.hjl && window.hjl.track('cart_add', {
    product_name: '(상품명 변수)',
    price: 39000,
    product_url: 'https://(쇼핑몰)/goods/view?no=123',
    image_url: 'https://(쇼핑몰)/img/123.jpg',
    quantity: 1
  });
</script>
```

주문 완료 페이지(구매 확정 시점):

```html
<script>
  window.hjl && window.hjl.track('purchase', { order_id: '(주문번호 변수)' });
</script>
```

- 표준 이벤트명만 허용: `cart_add`(담기) / `cart_remove`(빼기) / `checkout_start`(결제 진입) / `purchase`(구매 완료)
- `checkout_start` 또는 `purchase`가 들어오면 그 고객은 리커버리 발송 대상에서 자동 제외됩니다 — 구매 완료 지점에 꼭 넣어주세요
- 메시지 본문에 `{{ cart.product_name }}` 변수를 쓰면 담은 상품명이 자동으로 들어갑니다

---

## 4단계 — 설치 확인
사이트 접속 후 한줄로 관리자 → **자사몰 연동(CDP) → 고도몰 카드** 화면의 **"설치 검증"**에서 pageview·click·identify 수신을 확인합니다 (보통 5~15분 내).

---

## 인앱 메시지 — 추가 코드 없이 자동 표시

1단계 스크립트만 설치돼 있으면, 한줄로 관리자(인앱 메시지 화면)에서 메시지를 **활성화하는 즉시 쇼핑몰 화면에 자동 표시**됩니다. 배너·중앙 모달·전면·토스트 등 표시 형태와 노출 시간대·빈도는 모두 한줄로 관리자에서 설정하며, **쇼핑몰 측 추가 작업은 없습니다.**

설치 단계와의 연결:
- **2단계(회원 식별)가 되어 있으면** 메시지 안 `{{ customer.name }}` 같은 변수가 실제 회원 이름·등급으로 치환되고, 특정 고객군(세그먼트) 대상 메시지가 동작합니다. 비로그인 방문자에게는 전체 대상 메시지만 표시됩니다.
- **3단계(이벤트 전송)가 되어 있으면** "장바구니 담는 순간" 같은 행동 시점 메시지도 자동 표시됩니다.
- 장바구니 **금액 조건** 메시지는 `cart_add`/`cart_remove` 전송 시 `price`(있으면 `quantity`)가 포함된 경우에만 동작합니다 — 금액 정보가 없으면 해당 메시지는 표시되지 않습니다.

고급 사용 (선택):
- **본문 중간 삽입형(inline_card) 위치 지정** — 1단계 스크립트 태그에 속성 1개 추가:
  ```html
  <script src="https://app.hanjul.ai/sdk/v0.3.5/hanjul.min.js" data-hjl-key="hjl_xxxxxxxxxxxx"
          data-hjl-inapp-container="#표시할-영역-선택자" async></script>
  ```
- **원하는 시점에 직접 띄우기** — 스킨 JS에서:
  ```html
  <script>
    window.hjl && window.hjl.inapp && window.hjl.inapp.trigger('cart_add');
  </script>
  ```

---

## 수집 범위 / 보안
- 자동 수집: **페이지뷰 / 클릭 / 회원 식별(identify) / 동의(consent)** — 개인정보는 SDK가 자동 마스킹
- 인앱 메시지는 표시/클릭/닫기 여부만 통계용으로 전송됩니다
- 키(`hjl_`)는 공개 키로, 등록 도메인 검증으로 보호되므로 노출돼도 안전
- secret(`sk_`)은 브라우저(스킨)에 넣지 마세요 — 서버 연동 전용

---

## 문의
- 설치 중 궁금한 점은 한줄로 담당자에게 문의해 주세요.
