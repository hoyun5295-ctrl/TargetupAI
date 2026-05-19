# @hanjullo/sdk

한줄로 CDP (Customer Data Platform) JavaScript SDK — 자사몰 → 한줄로AI 회원/이벤트/주문 sync 표준 SDK.

브라우저 + Node.js 양쪽 호환. 한국 SMS/LMS/MMS/카카오 마케팅 자동화 SaaS 한줄로AI 진입점.

## 설치

```bash
npm install @hanjullo/sdk
```

## 빠른 시작

```typescript
import { HanjulloSDK } from '@hanjullo/sdk';

const hanjullo = new HanjulloSDK({
  apiKey: 'hjl_xxxxxxxxxxxx',   // CdpSettingsPage 발급
  secret: 'sk_xxxxxxxxxxxx',    // 발급 시 1회 노출
});

// 1. 회원 식별 / upsert (가입/로그인/회원정보 수정 시 호출)
await hanjullo.identify({
  externalId: 'user_123',
  email: 'user@example.com',
  phone: '01012345678',
  name: '홍길동',
  grade: 'VIP',
  customFields: { signup_channel: 'naver', referral_code: 'FRIEND2026' },
});

// 2. 행동 이벤트 박음
await hanjullo.track({
  eventName: 'cart_add',
  externalId: 'user_123',
  properties: {
    product_id: 'P001',
    product_name: '봄 신상 코트',
    price: 89000,
    quantity: 1,
  },
});

// 3. 주문 sync (상태가 'completed' / 'paid'일 때만 RFM 자동 갱신)
await hanjullo.order({
  orderId: 'O100023',
  externalId: 'user_123',
  status: 'completed',
  totalAmount: 89000,
  itemCount: 1,
  items: [{ productId: 'P001', productName: '봄 신상 코트', price: 89000, quantity: 1 }],
  orderedAt: new Date().toISOString(),
});

// 4. 초기 마이그레이션 (자사몰 기존 회원/주문 일괄 박음, 최대 1,000건/요청)
await hanjullo.bulkImport({
  customers: [
    { externalId: 'u1', email: 'a@x.com', phone: '01011111111', name: '김유저' },
    { externalId: 'u2', email: 'b@x.com', phone: '01022222222', name: '이유저' },
  ],
  orders: [
    { orderId: 'O100', externalId: 'u1', status: 'completed', totalAmount: 30000, orderedAt: '2026-04-15T10:30:00+09:00' },
  ],
});
```

## 표준 이벤트

| 이벤트명 | 호출 시점 |
|---------|----------|
| `page_view` | 페이지 진입 |
| `product_view` | 상품 상세 페이지 진입 |
| `cart_add` | 장바구니 담음 |
| `cart_remove` | 장바구니 제거 |
| `cart_view` | 장바구니 페이지 진입 |
| `checkout_start` | 결제 페이지 진입 |
| `checkout_complete` | 결제 완료 (`purchase`와 함께 박음) |
| `purchase` | 주문 완료 (`order()` 호출 시 자동 박힘) |
| `wishlist_add` | 위시리스트 담음 |
| `wishlist_remove` | 위시리스트 제거 |
| `search` | 검색 (query string 포함) |
| `custom_*` | 자사몰 자체 정의 (예: `custom_coupon_apply`) |

## 비회원 추적 (anonymousId)

```typescript
// 브라우저 cookie 또는 fingerprint를 anonymousId로 박음
await hanjullo.track({
  eventName: 'product_view',
  anonymousId: 'anon_abc123',
  properties: { product_id: 'P001' },
});

// 추후 회원 가입 시 identify 호출하면 한줄로 백엔드가 anonymous link를 회원과 자동 연결
await hanjullo.identify({
  externalId: 'user_456',
  email: 'new@example.com',
  phone: '01099998888',
});
```

## 회사 격리

- 모든 호출은 `X-Hanjullo-Key` + `X-Hanjullo-Secret` 헤더로 회사 식별 + 인증
- 자사몰별 회원/이벤트/주문은 회사 단위로 완전 격리됨
- 키 노출/유출 의심 시 한줄로AI CdpSettingsPage에서 즉시 재발급 — 기존 키는 폐기

## 에러 처리

```typescript
import { HanjulloSDK } from '@hanjullo/sdk';
import type { SDKError } from '@hanjullo/sdk';

try {
  await hanjullo.identify({ externalId: 'user_123' });
} catch (err) {
  const e = err as SDKError;
  console.error(`code=${e.code} status=${e.status} message=${e.message}`);
}
```

| 코드 | 의미 |
|------|------|
| `INVALID_API_KEY` / `INVALID_SECRET` | 키 포맷 오류 (생성자 검증) |
| `MISSING_EXTERNAL_ID` / `MISSING_EVENT_NAME` / `MISSING_IDENTITY` / `MISSING_REQUIRED` | 필수 파라미터 누락 |
| `HTTP_401` | 인증 실패 (키/시크릿 불일치) |
| `HTTP_403` | 요금제 잠금 (BUSINESS+ 필요) 또는 회사 비활성 |
| `HTTP_429` | 이번 달 호출 한도 초과 |
| `NETWORK_ERROR` | 네트워크 오류 (자동 재시도 후에도 실패) |

## 옵션

```typescript
new HanjulloSDK({
  apiKey: 'hjl_...',
  secret: 'sk_...',
  endpoint: 'https://app.hanjul.ai/api/cdp', // self-hosted 시 변경
  source: 'custom_sdk',                       // 자사몰 식별 (디버깅용)
  retries: 2,                                  // 5xx/네트워크 실패 시 재시도 (default 2)
  debug: false,                                // 콘솔 디버그 로그
});
```

## Web Push + In-app Message 채널 (v0.2.0)

### Web Push 구독

```typescript
// 1. 자사몰 루트에 service worker 파일 박음
//    `packages/sdk-js/src/service-worker.ts` 내용을 빌드하여 /hanjullo-sw.js로 박음
//    (또는 dist/ 결과의 service-worker.js 파일 자체를 박음)

// 2. SDK가 등록 + 구독 박음
const result = await hanjullo.push.subscribe({
  externalId: 'user_123',
  serviceWorkerPath: '/hanjullo-sw.js',  // 자사몰 루트 path
});
if (result.success) {
  console.log('구독 완료:', result.subscriptionId);
} else {
  console.warn('구독 실패:', result.error);
}
```

| 메서드 | 용도 |
|--------|------|
| `hanjullo.push.subscribe(input)` | 사용자 권한 요청 + Service Worker 등록 + 한줄로 백엔드에 구독 박음 |
| `hanjullo.push.unsubscribe()` | 구독 해제 |
| `hanjullo.push.permission()` | 현재 권한 상태 ('granted' / 'denied' / 'default' / 'unsupported') |

### In-app Message 자동 표시

```typescript
// 페이지 로드 시 1회 호출 — SDK가 활성 메시지 자동 fetch + 표시
hanjullo.inapp.init({
  externalId: 'user_123',         // 회원 식별 (선택)
  anonymousId: 'browser_abc123',  // 비회원 추적 (선택)
  trigger: 'page_load',            // 기본 page_load
});
```

표시 위치: `top_banner` / `bottom_banner` / `center_modal` — 회사 admin이 한줄로 InAppMessagesPage에서 박음.
빈도 제어: `once_per_session` (sessionStorage) / `once_per_day` (localStorage + 서버 검증) / `always`.
트래킹: SDK가 impression / click / dismiss를 자동으로 한줄로 백엔드에 박음.

## 영구 원칙

- 타겟 매칭 0건 시 자동완화 절대 금지 (한줄로AI Harold 영구 원칙) — Identity Resolution은 신규 회원 생성만, 임의 매칭 X
- 자사몰 phone은 자동 정규화 (한국 휴대폰 010 prefix 보정)
- API 키는 `localStorage` / 클라이언트 코드에 박지 X — server-side에서만 호출 (브라우저 직접 호출 시 키 노출 위험)

## 라이선스

MIT
