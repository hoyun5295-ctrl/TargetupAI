# 전단AI 사업 확장 설계서 (2026-04-14)

> **목적:** 회의록(전단AI_회의록_20260414.docx) 기반 기술 설계.
> **원칙:** 기존 인프라 최대 활용, 최소 비용, 단계별 구현.

---

## Phase 1. 수신자별 단축URL 추적 시스템

### 1-1. 도메인 준비

| 항목 | 내용 |
|------|------|
| 현재 | hanjul-flyer.kr (15자) |
| 목표 | hjl.kr 등 짧은 .kr 도메인 (6자) |
| 비용 | 연 1~2만원 |
| 작업 | Nginx server_name 추가 + SSL(Let's Encrypt) |

### 1-2. URL 체계

```
미리보기 (사장님용):  hjl.kr/invitomartogum-20260415
                     └─ 마트 영문명 + 행사 시작일
                     └─ 가독성 좋고, 카톡/매장 게시용

발송용 (수신자별):    hjl.kr/Ab3kQ
                     └─ 5자리 랜덤 코드 (base62: a-zA-Z0-9)
                     └─ 62^5 = 약 9.1억 조합 (충분)
```

### 1-3. DB 스키마 변경

```sql
-- short_urls 테이블 확장 (기존 테이블에 컬럼 추가)
ALTER TABLE short_urls ADD COLUMN phone VARCHAR(20);           -- 수신자 전화번호
ALTER TABLE short_urls ADD COLUMN campaign_id UUID;            -- 발송 캠페인 ID
ALTER TABLE short_urls ADD COLUMN url_type VARCHAR(10)         -- 'preview' | 'tracking'
  DEFAULT 'preview';

-- 인덱스
CREATE INDEX idx_short_urls_phone ON short_urls(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_short_urls_campaign ON short_urls(campaign_id) WHERE campaign_id IS NOT NULL;
```

**기존 short_urls 레코드:** url_type='preview' (하위호환)
**신규 수신자별 레코드:** url_type='tracking', phone 포함

### 1-4. 발송 흐름

```
[전단 생성] → short_urls 1개 (url_type='preview', 사장님용)
     │
[발송 버튼 클릭]
     │
     ├─ 1. 수신자 목록 조회 (flyer_customers)
     ├─ 2. 수신자별 5자리 코드 벌크 생성 (crypto.randomBytes → base62)
     ├─ 3. short_urls 벌크 INSERT (flyer_id, code, phone, campaign_id, url_type='tracking')
     ├─ 4. SMS 메시지에 각 수신자별 URL 삽입
     └─ 5. SMS 발송 (기존 QTmsg 파이프라인)
```

### 1-5. 코드 생성 유틸

```typescript
// utils/flyer/short-code-generator.ts
import crypto from 'crypto';

const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateShortCode(length = 5): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes).map(b => BASE62[b % 62]).join('');
}

export async function generateBulkShortCodes(
  flyerId: string,
  campaignId: string,
  recipients: { phone: string }[],
): Promise<{ phone: string; code: string; url: string }[]> {
  const domain = process.env.SHORT_URL_DOMAIN || 'hanjul-flyer.kr';
  const codes = new Set<string>();
  const results = [];

  for (const r of recipients) {
    let code: string;
    do { code = generateShortCode(); } while (codes.has(code));
    codes.add(code);
    results.push({ phone: r.phone, code, url: `${domain}/${code}` });
  }

  // 벌크 INSERT (batch 5000건 단위)
  // ... (sms-queue.ts 패턴 참고)

  return results;
}
```

### 1-6. 클릭 추적 확장

```typescript
// short-urls.ts 뷰어 라우트 수정
// 기존: url_clicks에 IP, UA만 기록
// 변경: phone도 함께 기록

// GET /:code 핸들러
const shortUrl = await query('SELECT * FROM short_urls WHERE code = $1', [code]);
if (shortUrl.rows[0]?.phone) {
  // tracking URL → phone 포함 기록
  await query(
    'INSERT INTO url_clicks (short_url_id, phone, ip, user_agent) VALUES ($1, $2, $3, $4)',
    [shortUrl.rows[0].id, shortUrl.rows[0].phone, req.ip, req.headers['user-agent']]
  );
}
// → 동일 전단지 페이지 렌더링 (flyer_id로 조회)
```

### 1-7. 추적 통계 API

```
GET /api/flyer/stats/:flyerId/tracking
→ 응답:
{
  totalSent: 10000,        // 발송 수
  totalClicked: 3200,      // 클릭 수 (유니크)
  clickRate: 32.0,         // 클릭률 (%)
  clickedList: [           // 클릭한 사람
    { phone: '010-1234-5678', clickedAt: '2026-04-15 10:23', clickCount: 3 },
    ...
  ],
  notClickedList: [        // 안 본 사람 (리타겟팅용)
    { phone: '010-2345-6789' },
    ...
  ]
}
```

### 1-8. 수정 파일 목록

| 파일 | 변경 |
|------|------|
| `utils/flyer/short-code-generator.ts` | **신규** — 코드 생성 + 벌크 INSERT |
| `routes/flyer/short-urls.ts` | 뷰어에 phone 기록 추가 |
| `routes/flyer/campaigns.ts` | 발송 시 수신자별 URL 생성 호출 |
| `routes/flyer/stats.ts` | 추적 통계 API 추가 |
| `utils/flyer/flyer-send.ts` | SMS 메시지에 개별 URL 삽입 |
| DDL | short_urls 컬럼 추가 + url_clicks 컬럼 추가 |

---

## Phase 2. 인쇄용 전단 이미지 자동 생성

### 2-1. 전체 구조

```
CSV 업로드 (또는 POS 자동)
    │
    ├─ 1. 상품 파싱 (상품명, 가격, 이미지URL, 행사구분)
    ├─ 2. AI 카테고리 자동 분류 (Claude API, 기존 classifier 활용)
    │     └─ 메인행사 / 서브행사 / 카테고리별(정육/과일/채소/생활용품/가공식품)
    ├─ 3. 이미지 자동 매칭 (카탈로그 → Pixabay 폴백)
    ├─ 4. 누끼 자동 처리 (rembg)
    ├─ 5. AI 문구 생성 (캐치프라이즈, 서브 카피)
    ├─ 6. 템플릿 선택 (자동 추천 또는 사장님 선택)
    └─ 7. HTML 렌더링 → puppeteer → 300dpi PDF/이미지
```

### 2-2. 전단 레이아웃 계층

```
┌─────────────────────────────────────┐
│  마트 로고 | 매장 정보 | SNS 링크    │ ← 헤더 (매장별 고정)
├─────────────────────────────────────┤
│                                     │
│     ★ 메인 배너 (감성 이미지)        │ ← 디자이너 제작 템플릿
│     "봄세일의 특가전"                │    계절/행사별 20~30종
│                                     │
├─────────────────────────────────────┤
│  [양파]    [바나나]   [감자]   [빵]  │ ← 메인행사 상품 (큰 카드)
│  1,000원  1,000원   1,111원  1,000원│    최대 4~6개
├─────────────────────────────────────┤
│  ★ 중간 감성 배너                    │ ← 디자이너 제작
│  "자연에서의 신선함 그대로"           │
├─────────────────────────────────────┤
│ [서브1] [서브2] [서브3] [서브4]      │ ← 서브행사 (중간 카드)
│ [서브5] [서브6] [서브7] [서브8]      │    최대 8~12개
├─────────────────────────────────────┤
│ [일반] [일반] [일반] [일반] [일반]   │ ← 카테고리별 (작은 카드)
│ [일반] [일반] [일반] [일반] [일반]   │    개수 제한 없음
│ [일반] [일반] [일반] [일반] [일반]   │
├─────────────────────────────────────┤
│  매장 주소 | 전화번호 | 영업시간     │ ← 푸터
└─────────────────────────────────────┘
```

### 2-3. 템플릿 시스템

```
uploads/flyer-print-templates/
├── banners/                    ← 디자이너 제작 감성 이미지
│   ├── spring-sale.png
│   ├── summer-fresh.png
│   ├── autumn-harvest.png
│   ├── winter-warm.png
│   ├── meat-premium.png
│   └── ... (20~30종)
├── layouts/                    ← HTML 템플릿
│   ├── standard-a4.html       ← A4 기본
│   ├── standard-b4.html       ← B4 기본
│   ├── tabloid.html           ← 타블로이드
│   └── compact.html           ← 양면 축소
└── themes/                     ← 색상/폰트 테마
    ├── fresh-green.json
    ├── warm-orange.json
    └── cool-blue.json
```

### 2-4. rembg 설치 및 누끼 API

```bash
# 서버 설치
pip install rembg[gpu]  # GPU 있으면, 없으면 pip install rembg

# 또는 Docker
docker run -p 5100:5000 danielgatis/rembg
```

```typescript
// utils/flyer/rembg-client.ts
export async function removeBackground(imageBuffer: Buffer): Promise<Buffer> {
  const res = await fetch('http://localhost:5100/api/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: imageBuffer,
  });
  return Buffer.from(await res.arrayBuffer());
}
```

**처리 흐름:**
1. 상품 이미지 업로드 시 자동 누끼 처리
2. 누끼 완료 이미지를 카탈로그에 저장
3. 전단 생성 시 누끼 이미지 사용

### 2-5. CSV 포맷

```csv
행사구분,상품명,가격,원가,단위,카테고리
메인,양파,1000,,1kg,채소
메인,바나나,1000,,1송이,과일
서브,삼겹살,12900,15900,100g,정육
서브,계란,4990,,30구,축산
일반,식빵,2500,,1봉,가공식품
일반,우유,2980,,1L,유제품
```

**행사구분 없으면 AI 자동 분류:**
- 할인율 30% 이상 → 메인행사
- 할인율 10~29% → 서브행사
- 나머지 → 일반

### 2-6. 수정 파일 목록

| 파일 | 변경 |
|------|------|
| `utils/flyer/rembg-client.ts` | **신규** — 누끼 처리 클라이언트 |
| `utils/flyer/print-flyer-renderer.ts` | **신규** — 인쇄용 전단 HTML 렌더러 |
| `routes/flyer/flyers.ts` | 인쇄용 전단 생성/PDF 다운로드 엔드포인트 추가 |
| `flyer-frontend: PrintFlyerPage.tsx` | **신규** — 인쇄용 전단 생성 UI |
| 디자이너 | 감성 배너 20~30종 제작 (외주) |

### 2-7. 인쇄 사양

| 항목 | 값 |
|------|-----|
| 해상도 | 300dpi |
| 색상 모드 | CMYK (인쇄용) |
| 용지 | A4 / B4 / 타블로이드 선택 |
| 여백 | 재단선 3mm 포함 |
| 출력 포맷 | PDF (인쇄업체 입고용) |

---

## Phase 3. 장바구니 → 주문 시스템

### 3-1. 핵심 원칙

- **로그인 없음** — 수신자별 단축URL의 토큰으로 본인 식별
- **최소 정보** — 이름 + 전화번호 (이미 보유) + 수령 방법만
- **매장 수령 우선** — 마트 특성상 배달보다 방문 수령이 기본

### 3-2. DB 스키마

```sql
-- 장바구니
CREATE TABLE flyer_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  flyer_id UUID NOT NULL,
  phone VARCHAR(20) NOT NULL,            -- 수신자 전화번호 (단축URL에서 식별)
  items JSONB NOT NULL DEFAULT '[]',     -- [{productName, price, quantity, imageUrl}]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(flyer_id, phone)                -- 전단지+수신자당 장바구니 1개
);

-- 주문
CREATE TABLE flyer_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID,                          -- 매장 사용자 (주문 수신자)
  flyer_id UUID NOT NULL,
  phone VARCHAR(20) NOT NULL,
  customer_name VARCHAR(50),
  items JSONB NOT NULL,
  total_amount INTEGER NOT NULL,
  pickup_type VARCHAR(20) DEFAULT 'store_pickup',  -- 'store_pickup' | 'delivery'
  pickup_time TIMESTAMPTZ,               -- 희망 수령 시간
  status VARCHAR(20) DEFAULT 'pending',  -- pending → confirmed → ready → completed / cancelled
  note TEXT,                             -- 요청사항
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_flyer_orders_company ON flyer_orders(company_id);
CREATE INDEX idx_flyer_orders_user ON flyer_orders(user_id);
CREATE INDEX idx_flyer_orders_phone ON flyer_orders(phone);
```

### 3-3. 주문 흐름

```
고객 (모바일):
  전단지 열기 → 상품 터치 → "장바구니 담기"
       → 장바구니 확인 → "주문하기"
       → 수령 방법 선택 (매장 방문 / 배달)
       → 주문 완료 (알림톡으로 확인)

사장님 (관리자):
  주문 목록 실시간 확인
       → "확인" → "준비완료" → "완료" 상태 변경
       → 고객에게 알림톡 자동 발송
```

### 3-4. 전단지 뷰어 확장

```
현재 전단지 뷰어 (dm-viewer.ts):
  상품 표시 → 클릭 시 상세 → 끝

확장:
  상품 표시 → 클릭 시 "장바구니 담기" 버튼
           → 하단 플로팅 장바구니 바 (N개 상품, 총 N원)
           → 장바구니 → 주문서 → 완료
```

### 3-5. 수정 파일 목록

| 파일 | 변경 |
|------|------|
| `utils/dm/dm-viewer.ts` | 전단지 뷰어에 장바구니 UI 추가 |
| `routes/flyer/orders.ts` | **신규** — 주문 CRUD API |
| `routes/flyer/carts.ts` | **신규** — 장바구니 API (공개, 토큰 기반) |
| `flyer-frontend: OrdersPage.tsx` | **신규** — 사장님용 주문 관리 |
| DDL | flyer_carts, flyer_orders 테이블 생성 |

---

## Phase 4. POS 자동 전단 생성

### 4-1. 데이터 흐름

```
투게더스 POS (매장 PC)
    │
    ├─ MS-SQL DB
    │   ├─ 상품 마스터 (상품명, 바코드, 가격, 카테고리)
    │   ├─ 할인/행사 정보 (할인가, 기간, 행사구분)
    │   ├─ 고객 정보 (이름, 전화번호, 포인트)
    │   └─ 매출 이력 (구매일, 상품, 금액)
    │
    └─ POS Agent (exe, 이미 개발)
        │
        ├─ 주기적 sync (5분 간격)
        └─ 우리 서버 API로 전송
            │
            ├─ /api/flyer/pos/sync-products   → flyer_catalog
            ├─ /api/flyer/pos/sync-customers  → flyer_customers
            ├─ /api/flyer/pos/sync-promotions → 할인/행사 정보
            └─ /api/flyer/pos/sync-sales      → 매출 이력
```

### 4-2. 자동 전단 생성 트리거

```
POS에 할인 등록 (사장님)
    │
    └─ POS Agent가 할인 정보 sync
        │
        └─ 서버에서 감지
            │
            ├─ 1. 할인 상품 목록 추출
            ├─ 2. 카탈로그에서 이미지 매칭
            ├─ 3. AI 카테고리 분류 + 문구 생성
            ├─ 4. 템플릿 자동 선택
            ├─ 5. 전단 자동 생성 (모바일 + 인쇄용)
            ├─ 6. 사장님에게 알림 (카카오톡/SMS)
            │     "전단이 자동 생성되었습니다. 확인해주세요."
            └─ 7. 사장님 확인 → 발송
```

### 4-3. 선결 과제

1. **투게더스 데이터 샘플 수령** → MS-SQL 테이블 구조 파악
2. **테스트 아이디 확보** → POS Agent 연동 테스트
3. **전화번호 평문 확인** → DB 직접 조회로 확인
4. **POS Agent 테이블 매핑** → 투게더스 테이블명 ↔ 우리 스키마 매핑

### 4-4. 수정 파일 목록

| 파일 | 변경 |
|------|------|
| `routes/flyer/pos.ts` | sync API 확장 (promotions, sales) |
| `utils/flyer/pos-auto-flyer.ts` | **신규** — 할인 감지 → 전단 자동 생성 워커 |
| POS Agent (exe) | 투게더스 MS-SQL 테이블 매핑 |

---

## 구현 일정 (안)

| Phase | 내용 | 예상 기간 | 선행 조건 |
|-------|------|----------|----------|
| **1** | 수신자별 단축URL + 추적 | 3~5일 | 짧은 도메인 구매 |
| **2** | 인쇄용 전단 이미지 생성 | 5~7일 | 디자이너 배너 제작, rembg 설치 |
| **3** | 장바구니 → 주문 | 7~10일 | Phase 1 완료 |
| **4** | POS 자동 전단 생성 | 5~7일 | 투게더스 데이터/테스트ID 확보 |

**총 예상: 3~4주 (Phase 1~4 순차 진행)**

---

## 비용 요약

| 항목 | 초기 비용 | 월 운영 비용 |
|------|----------|-------------|
| 짧은 도메인 | 1~2만원/년 | - |
| 감성 배너 디자인 | 30~50만원 (20~30종) | - |
| rembg 서버 | 0원 (오픈소스) | 0원 |
| Claude API | - | ~5만원 (마트 100개) |
| 서버 추가 비용 | - | 0원 (기존 서버) |
| **합계** | **~50만원** | **~5만원** |

---

## 수익 모델

**목표: 마트 2,000개 이상**

| 마트 수 | 월 매출 | 총판 수수료 | AI 비용 | 우리 순수익 (월) | 연 순수익 |
|---------|--------|-----------|--------|---------------|----------|
| 100개 | 1,000만원 | 300만원 | 5만원 | **695만원** | 8,340만원 |
| 500개 | 5,000만원 | 1,500만원 | 25만원 | **3,475만원** | 4.2억원 |
| 1,000개 | 1억원 | 3,000만원 | 50만원 | **6,950만원** | 8.3억원 |
| **2,000개** | **2억원** | **6,000만원** | **100만원** | **1억 3,900만원** | **16.7억원** |
| 5,000개 | 5억원 | 1.5억원 | 250만원 | 3억 4,750만원 | 41.7억원 |

*(마트 월 이용료 10만원, 총판 수수료 3만원/마트, 문자발송료 별도)*
