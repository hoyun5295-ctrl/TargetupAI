# 전단AI — QR 체크인 쿠폰 구현 설계서

> **작성:** 2026-04-12 (D114)
> **목표:** 전단 → QR 스캔 → 쿠폰 수령 → 매장 방문 → 사용 처리 → 효과 측정
> **다음 세션에서 이 문서 읽고 즉시 개발 착수**

---

## 1. 전체 흐름

```
[전단지 발행]
  ↓ 전단 하단에 QR 코드 자동 삽입
[고객 스캔]
  ↓ 스마트폰 카메라로 QR 스캔
[쿠폰 페이지] — https://hanjul-flyer.kr/q/:couponCode
  ↓ 매장 정보 + 할인 내용 + "쿠폰 받기" 버튼
[쿠폰 수령]
  ↓ 전화번호 입력 → 쿠폰 발급 (SMS로 코드 발송)
[매장 방문]
  ↓ 고객이 쿠폰 코드 보여줌 (또는 전화번호로 조회)
[사장님 확인]
  ↓ 전단AI 앱에서 "쿠폰 사용 처리" 버튼
[효과 측정]
  ↓ 발행 vs 수령 vs 사용 전환율 대시보드
```

---

## 2. DB 테이블

### 2-1. flyer_coupon_campaigns — 쿠폰 캠페인

```sql
CREATE TABLE flyer_coupon_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES flyer_companies(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES flyer_users(id),
  flyer_id UUID REFERENCES flyers(id),              -- 연결된 전단지 (NULL=독립 쿠폰)
  campaign_id UUID REFERENCES flyer_campaigns(id),   -- 연결된 발송 캠페인

  -- 쿠폰 정보
  coupon_name VARCHAR(200) NOT NULL,                 -- "5,000원 할인 쿠폰"
  coupon_type VARCHAR(20) NOT NULL DEFAULT 'fixed',  -- fixed(정액할인) / percent(%) / free_item(증정)
  discount_value INTEGER NOT NULL DEFAULT 0,          -- fixed: 5000, percent: 10, free_item: 0
  discount_description TEXT,                          -- "5,000원 할인" 또는 "10% 할인" 또는 "음료 1잔 증정"
  min_purchase INTEGER DEFAULT 0,                     -- 최소 구매금액 (0=없음)

  -- QR 코드
  qr_code VARCHAR(20) UNIQUE NOT NULL,               -- 짧은 코드 (예: "QC7K3M")
  qr_url TEXT,                                        -- 전체 URL

  -- 제한
  max_issues INTEGER,                                 -- 최대 발급 수 (NULL=무제한)
  issued_count INTEGER DEFAULT 0,                     -- 현재 발급 수
  expires_at TIMESTAMPTZ,                             -- 쿠폰 만료일

  -- 통계
  redeemed_count INTEGER DEFAULT 0,                   -- 사용 수
  total_redemption_amount INTEGER DEFAULT 0,           -- 총 할인 제공액

  status VARCHAR(20) DEFAULT 'active',                -- active / expired / disabled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX idx_flyer_coupon_campaigns_company ON flyer_coupon_campaigns(company_id);
CREATE INDEX idx_flyer_coupon_campaigns_qr ON flyer_coupon_campaigns(qr_code);
```

### 2-2. flyer_coupons — 개별 발급된 쿠폰

```sql
CREATE TABLE flyer_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES flyer_coupon_campaigns(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES flyer_companies(id),

  -- 수령자
  customer_phone VARCHAR(20) NOT NULL,                -- 쿠폰 수령 고객 전화번호
  customer_name VARCHAR(100),                         -- 이름 (선택)
  coupon_code VARCHAR(10) UNIQUE NOT NULL,            -- 개인 쿠폰 코드 (예: "A3K7")

  -- 상태
  status VARCHAR(20) DEFAULT 'issued',                -- issued(발급) / redeemed(사용) / expired(만료)
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  redeemed_at TIMESTAMPTZ,
  redeemed_by UUID REFERENCES flyer_users(id),        -- 사용 처리한 직원/사장님

  -- 사용 정보
  purchase_amount INTEGER,                            -- 실제 구매금액 (ROI 측정용)

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_flyer_coupons_campaign ON flyer_coupons(campaign_id);
CREATE INDEX idx_flyer_coupons_phone ON flyer_coupons(customer_phone);
CREATE INDEX idx_flyer_coupons_code ON flyer_coupons(coupon_code);
CREATE INDEX idx_flyer_coupons_status ON flyer_coupons(status) WHERE status = 'issued';
```

---

## 3. 백엔드 API

### 3-1. 쿠폰 캠페인 CRUD — `/api/flyer/coupons`

```
POST   /                — 쿠폰 캠페인 생성 (전단 연결 또는 독립)
GET    /                — 목록 조회 (company_id 스코프)
GET    /:id             — 상세 + 발급 목록
PUT    /:id             — 수정 (이름/할인/만료일/최대발급수)
DELETE /:id             — 삭제 (soft)
GET    /:id/stats       — 통계 (발급수/사용수/전환율/총할인액)
```

### 3-2. 공개 페이지 (인증 불필요) — `/api/flyer/q`

```
GET  /q/:qrCode         — QR 스캔 시 쿠폰 정보 반환 (매장명/할인내용/남은수량/만료일)
POST /q/:qrCode/claim   — 쿠폰 수령 (body: { phone, name? })
                          → 개인 coupon_code 생성 → SMS로 코드 발송
                          → 응답: { couponCode, expiresAt, message }
```

### 3-3. 사용 처리 — `/api/flyer/coupons`

```
POST /redeem             — 쿠폰 사용 처리 (body: { couponCode } 또는 { phone })
                          → status='redeemed', redeemed_at=NOW()
                          → 응답: { success, discount, customerName }
GET  /lookup?phone=010.. — 전화번호로 미사용 쿠폰 조회 (사장님이 카운터에서 확인)
```

### 3-4. 전단 연동

```
POST /from-flyer/:flyerId  — 전단지에서 쿠폰 캠페인 자동 생성
                             → 전단 정보(매장명/기간)에서 쿠폰명 자동 생성
                             → QR 코드 생성 → 전단 하단에 QR 이미지 삽입
```

---

## 4. QR 코드 생성

```typescript
// qrcode 라이브러리 사용 (npm install qrcode)
import QRCode from 'qrcode';

const qrUrl = `https://hanjul-flyer.kr/q/${qrCode}`;
const qrDataUrl = await QRCode.toDataURL(qrUrl, {
  width: 200,
  margin: 1,
  color: { dark: '#000000', light: '#ffffff' },
});
// → 전단 HTML 렌더링 시 <img src="${qrDataUrl}" /> 삽입
```

---

## 5. 공개 페이지 (모바일 최적화)

### `/q/:qrCode` 페이지 UI

```
┌────────────────────────────────┐
│  🎫 ○○마트 할인 쿠폰           │
│                                │
│  ┌──────────────────────────┐  │
│  │ 5,000원 할인              │  │
│  │ 30,000원 이상 구매 시     │  │
│  │ 2026년 4월 30일까지       │  │
│  └──────────────────────────┘  │
│                                │
│  남은 수량: 47 / 100            │
│                                │
│  ┌─────────────────────────┐   │
│  │ 전화번호 입력             │   │
│  │ [010-    -    ]          │   │
│  └─────────────────────────┘   │
│                                │
│  [ 🎁 쿠폰 받기 ]              │
│                                │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  📍 ○○마트 ○○점               │
│  📞 02-1234-5678              │
│  🕐 09:00 ~ 22:00             │
└────────────────────────────────┘
```

### 수령 완료 화면

```
┌────────────────────────────────┐
│  ✅ 쿠폰이 발급되었습니다!      │
│                                │
│  쿠폰 코드: A 3 K 7            │
│  (큰 글씨, 복사 가능)           │
│                                │
│  매장 방문 시 이 코드를          │
│  보여주세요.                    │
│                                │
│  SMS로도 코드가 발송되었습니다.  │
│                                │
│  [ 매장 위치 보기 ]             │
└────────────────────────────────┘
```

---

## 6. 프론트엔드

### 6-1. 매장 사장님 (flyer-frontend)

**CouponPage.tsx** (신규 페이지):
- 쿠폰 캠페인 목록 (발급수/사용수/전환율)
- 쿠폰 생성 모달 (할인 유형/금액/만료일/최대수량)
- 쿠폰 사용 처리 (코드 입력 또는 전화번호 검색)
- 효과 대시보드 (전환율 차트)

**FlyerPage.tsx 연동:**
- 전단 생성 시 "쿠폰 추가" 토글
- 활성화하면 쿠폰 설정 (할인/만료) → 전단 하단에 QR 자동 삽입

**App.tsx:**
- MAIN_MENUS에 `{ key: 'coupons', label: '쿠폰', icon: '🎫' }` 추가

### 6-2. 공개 페이지 (백엔드 렌더링)

**routes/flyer/short-urls.ts** 확장 또는 별도 라우트:
- `GET /q/:qrCode` → 모바일 최적화 HTML 렌더링
- `POST /q/:qrCode/claim` → 쿠폰 발급 API

---

## 7. 전단 연동 플로우 (FlyerPage에서)

```
1. 사장님이 전단 생성 중 "쿠폰 추가" 토글 ON
2. 할인 유형 선택: 정액 5,000원 / 10% / 증정품
3. 만료일, 최대 발급 수 설정
4. [전단 발행] 클릭 시:
   a. flyer_coupon_campaigns INSERT
   b. QR 코드 생성 (qrCode = 6자리 영숫자)
   c. 전단 HTML 하단에 QR 이미지 + "스캔하고 할인 받으세요!" 삽입
   d. flyers INSERT (coupon_campaign_id 연결)
5. SMS 발송 시 단축URL과 함께 QR 쿠폰 안내 문구 포함
```

---

## 8. SMS 쿠폰 발송

쿠폰 수령 시 고객에게 SMS 발송:

```
[○○마트] 쿠폰이 발급되었습니다!
코드: A3K7
할인: 5,000원 (30,000원 이상 구매 시)
유효기간: ~4/30
매장 방문 시 이 코드를 보여주세요.
```

→ CT-F08 flyer-send.ts 재활용 (1건 발송)

---

## 9. 효과 측정 대시보드

| 지표 | 계산 |
|------|------|
| QR 스캔 수 | `/q/:code` GET 요청 카운트 (url_clicks 재활용) |
| 쿠폰 발급 수 | flyer_coupons WHERE campaign_id = X |
| 쿠폰 사용 수 | flyer_coupons WHERE status = 'redeemed' |
| 전환율 | 사용수 / 발급수 × 100% |
| 총 할인 제공액 | SUM(discount_value) WHERE redeemed |
| 평균 구매 금액 | AVG(purchase_amount) WHERE redeemed |
| ROI | (총구매액 - 총할인액) / 발송비 |

---

## 10. 개발 순서

```
Step 1: DDL 실행 (flyer_coupon_campaigns + flyer_coupons)
Step 2: 백엔드 API (routes/flyer/coupons.ts 신설)
Step 3: 공개 페이지 (/q/:code 렌더링 + /claim API)
Step 4: 프론트 CouponPage.tsx (목록/생성/사용처리)
Step 5: FlyerPage.tsx 전단 연동 (QR 삽입)
Step 6: 전단 템플릿에 QR 영역 추가 (CT-F14)
Step 7: 효과 대시보드
```

---

## 11. 의존성 / 패키지

```
npm install qrcode        # QR 코드 생성 (백엔드)
npm install @types/qrcode  # 타입
```

프론트 QR 표시는 백엔드에서 Data URL로 생성하여 전달 (프론트 패키지 불필요)
