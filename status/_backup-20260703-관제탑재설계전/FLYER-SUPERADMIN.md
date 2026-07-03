# 전단AI — 슈퍼관리자 통합 설계 (서비스 스위처)

> **작성:** 2026-04-09 (D112)
> **결정:** 통합 슈퍼관리자 + 상단 서비스 스위처 (Harold님 의견 요청 시 제 추천 방향, 반대 시 조정)
> **도메인:** sys.hanjullo.com (기존 유지)

---

## 1. 설계 원칙

### 1-1. 통합의 이유
- Harold님 한 분이 양쪽 운영 → 계정 전환 피로 제거
- 통합 대시보드로 전체 매출/발송량 동시 조회
- 직원 권한 위임 시에는 플래그 분리 가능 (can_access_hanjullo / can_access_flyer)

### 1-2. 사고 방지 메커니즘
- **URL 분리:** `sys.hanjullo.com/hanjullo/*` vs `sys.hanjullo.com/flyer/*`
- **색상 강제 차별화:** 한줄로는 기존 색, 전단AI 모드는 주황 계열로 상단바/버튼 강조
- **전환 시 명시적 확인:** 토스트 + 상단 배너 "전단AI 모드"
- **API 경로 분리:** `/api/admin/hanjullo/*` vs `/api/admin/flyer/*`
- **JWT service 필드 강제:** `super_token.current_service = 'hanjullo' | 'flyer'`

### 1-3. 데이터 격리 원칙
- 전단AI 모드에서는 flyer_* 테이블만 조회/수정
- 한줄로 모드에서는 companies/users/customers 등 기존 테이블만
- **모드 전환 API 경유 강제** → 쿠키/localStorage 직접 변조로 우회 불가

---

## 2. UI 설계

### 2-1. 최상단 글로벌 스위처

```
┌───────────────────────────────────────────────────────────────┐
│  한줄로 AI 슈퍼관리자                         [Harold님] [로그아웃] │
│  ┌─────────────┐ ┌─────────────┐                              │
│  │ 🔵 한줄로AI │ │  🟠 전단AI  │   ← 클릭 시 서비스 전환        │
│  │    활성      │ │              │                              │
│  └─────────────┘ └─────────────┘                              │
├───────────────────────────────────────────────────────────────┤
│ [대시보드] [회사관리] [사용자] [캠페인] [결제] [설정]           │  ← 메뉴는 서비스별 다름
└───────────────────────────────────────────────────────────────┘
```

**상태 표시:**
- 활성 서비스: 배경 강조 + 그림자
- 비활성 서비스: 흐린 배경

**전환 클릭 시:**
1. 확인 모달: "전단AI 모드로 전환합니다" (중요한 편집 중이면 경고)
2. POST `/api/admin/switch-service?to=flyer`
3. 응답에 새 JWT (current_service='flyer')
4. 전체 UI 리로드 (메뉴/색상/데이터 전환)
5. URL: `sys.hanjullo.com/hanjullo/dashboard` → `sys.hanjullo.com/flyer/dashboard`

### 2-2. 전단AI 모드 색상 테마

```css
/* 한줄로 모드 */
--primary: #3B82F6;     /* blue-500 */
--primary-hover: #2563EB;
--accent-bg: #EFF6FF;

/* 전단AI 모드 */
--primary: #F97316;     /* orange-500 */
--primary-hover: #EA580C;
--accent-bg: #FFF7ED;
--top-banner-bg: #FED7AA;  /* 상단에 "전단AI 모드" 배너 */
```

**상단 고정 배너 (전단AI 모드만):**
```
┌───────────────────────────────────────────────────────────────┐
│ 🟠 전단AI 모드입니다 — 마트/로컬 매장 데이터를 관리합니다      │
└───────────────────────────────────────────────────────────────┘
```

### 2-3. 메뉴 구조 (모드별)

**한줄로AI 모드 메뉴:**
```
- 대시보드 (회사/발송/매출 통계)
- 회사관리 (companies)
- 사용자 (users)
- 브랜드/매장 (store_codes)
- 캠페인 내역 (campaigns)
- 결제/플랜 (plans, billing)
- 발신번호 (sender_numbers, callback_numbers)
- 수신거부 (unsubscribes)
- 시스템 설정
```

**전단AI 모드 메뉴:**
```
- 대시보드 (마트 수/발송/매출 통계)
- 회사관리 (flyer_companies)
- 사용자 (flyer_users)
- 전단지 내역 (flyers)
- 캠페인 내역 (flyer_campaigns)
- 결제/플랜 (flyer_plans, flyer_billing_history) — 월 15만원 정액
- POS Agent 모니터링 (flyer_pos_agents) ⭐ 신규
- POS 데이터 (flyer_pos_sales, flyer_pos_inventory)
- 수신거부 (flyer_unsubscribes)
- 상품 카탈로그 (flyer_catalog)
- 시스템 설정
```

---

## 3. 백엔드 구조

### 3-1. 라우트 분리

```
packages/backend/src/routes/
├── admin/
│   ├── hanjullo/                 ← 한줄로 슈퍼관리자 전용
│   │   ├── dashboard.ts
│   │   ├── companies.ts
│   │   ├── users.ts
│   │   ├── campaigns.ts
│   │   └── ...
│   ├── flyer/                    ← 전단AI 슈퍼관리자 전용 (신규)
│   │   ├── dashboard.ts          ← 마트 대시보드
│   │   ├── companies.ts          ← flyer_companies CRUD
│   │   ├── users.ts              ← flyer_users CRUD
│   │   ├── flyers.ts             ← 전단지 내역
│   │   ├── campaigns.ts          ← flyer_campaigns
│   │   ├── billing.ts            ← flyer_billing_history
│   │   ├── pos-agents.ts         ← POS Agent 모니터링
│   │   └── pos-data.ts           ← POS 판매/재고 조회
│   └── switch-service.ts         ← 서비스 전환 엔드포인트
```

### 3-2. 서비스 전환 엔드포인트

```typescript
// routes/admin/switch-service.ts
POST /api/admin/switch-service
Body: { to: 'hanjullo' | 'flyer' }
Headers: Authorization: Bearer <super_token>

1. 현재 토큰 검증 (super_users)
2. 권한 체크:
   - to='flyer' 시: super_users.can_access_flyer = true 확인
   - to='hanjullo' 시: super_users.can_access_hanjullo = true 확인
3. 새 JWT 발급 (current_service = to)
4. 감사 로그 기록 (super_audit_log)
5. 응답:
   {
     token: "new_jwt",
     current_service: "flyer",
     redirect_to: "/flyer/dashboard"
   }
```

### 3-3. 미들웨어 강제 체크

```typescript
// middleware/super-service-guard.ts
export function requireService(expectedService: 'hanjullo' | 'flyer') {
  return (req, res, next) => {
    const token = verifyJwt(req.headers.authorization);
    if (!token.is_super) return res.status(401).json({ error: 'Not super' });
    if (token.current_service !== expectedService) {
      return res.status(403).json({
        error: 'Wrong service mode',
        current: token.current_service,
        expected: expectedService
      });
    }
    req.super = token;
    next();
  };
}

// 사용 예시
app.use('/api/admin/flyer/*', requireService('flyer'));
app.use('/api/admin/hanjullo/*', requireService('hanjullo'));
```

**핵심:** 프론트에서 URL로 접근해도 미들웨어에서 현재 모드 확인 → 불일치 시 403.

### 3-4. 감사 로그

```sql
CREATE TABLE super_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  super_id    UUID REFERENCES super_users(id),
  action      VARCHAR(50),        -- 'switch_service', 'company_create', 'user_delete', ...
  service     VARCHAR(20),        -- 'hanjullo' | 'flyer'
  target_type VARCHAR(50),        -- 'company', 'user', ...
  target_id   UUID,
  details     JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

**기록 대상:**
- 서비스 전환 (언제 어느 서비스로)
- 회사 생성/삭제/플랜 변경
- 사용자 비밀번호 초기화
- POS Agent 등록/해제
- 수동 결제/환불

---

## 4. 전단AI 슈퍼관리자 특화 기능

### 4-1. 마트 대시보드

**상단 카드 (4개):**
- 활성 마트 수 (this month)
- 전단지 생성 건수 (this month)
- SMS 발송량 (this month)
- 월 매출 (정액제 합계 + 발송 초과 비용)

**차트:**
- 일별 전단지 생성 추이
- POS Agent 연결 상태 (정상/오류/연결끊김)
- 마트별 전단지 수 TOP 10

### 4-2. POS Agent 모니터링

```
┌──────────────────────────────────────────────────────────────┐
│ POS Agent 모니터링                               [새로고침]   │
├──────────────────────────────────────────────────────────────┤
│ 회사          │ POS      │ 상태    │ 마지막 싱크 │ 작업     │
│ ○○마트       │ 포스뱅크 │ ✅ 정상 │ 2분 전      │ [로그] [재발급] │
│ △△슈퍼       │ OKPOS    │ ⚠️ 지연 │ 45분 전     │ [로그] [재발급] │
│ ○○푸드       │ 유니포스 │ ❌ 오프 │ 3시간 전    │ [로그] [재발급] │
└──────────────────────────────────────────────────────────────┘
```

**기능:**
- 실시간 상태 (5초 폴링)
- Agent 로그 다운로드
- agent_key 재발급 (유출 시)
- 강제 싱크 명령 (서버 → Agent)

### 4-3. 회사 생성 (전단AI 전용)

**폼 필드:**
```
기본 정보:
- 마트명 (company_name)
- 업태 (mart/butcher/seafood/bakery/cafe)
- 사업자등록번호
- 사장님 이름 / 전화번호
- 매장 주소
- 영업시간

결제:
- 플랜: 전단AI 베이직 (월 15만원) — 고정
- 계약 시작일
- 계약 종료일 (연 단위 자동연장)

POS 연동:
- POS 종류 선택 (포스뱅크/OKPOS/유니포스/기타)
- Agent 키 발급 버튼 (클릭 시 FPA-XXXX-XXXX 생성)

발송 설정:
- SMS/LMS/MMS 단가 (기본값 제공)
- 발신번호 등록
- 080 수신거부번호 (opt_out_080_number)

사용자 계정:
- 사장님 로그인 이메일/비밀번호 (첫 사용자 자동 생성)
```

### 4-4. POS 데이터 조회

- 회사별 판매 데이터 (flyer_pos_sales) 조회/검색/엑셀 내보내기
- 회사별 재고 스냅샷 (flyer_pos_inventory) 최근 상태
- 회사별 회원 수 (flyer_customers)

### 4-5. 결제 관리

**월 과금 플로우:**
```
매월 1일 배치:
  ├─ 활성 flyer_companies 순회
  ├─ flyer_billing_history INSERT (월 15만원 + 지난달 초과 발송비)
  ├─ payment_status = 'pending'
  └─ 사장님에게 결제 안내

결제 완료 시:
  ├─ flyer_billing_history.paid_at UPDATE
  └─ flyer_companies.plan_expires_at +1개월

미납 15일 초과 시:
  └─ flyer_companies.payment_status = 'suspended' → 전단AI 로그인 차단
```

---

## 5. 권한 매트릭스

| 역할 | 한줄로 접근 | 전단AI 접근 | 서비스 전환 | 감사 로그 열람 |
|------|-------------|-------------|-------------|----------------|
| super (Harold) | ✅ | ✅ | ✅ | ✅ |
| super_hanjullo_staff | ✅ | ❌ | ❌ (한줄로 고정) | 자기 것만 |
| super_flyer_staff | ❌ | ✅ | ❌ (전단AI 고정) | 자기 것만 |

DB:
```sql
ALTER TABLE super_users
  ADD COLUMN can_access_hanjullo BOOLEAN DEFAULT true,
  ADD COLUMN can_access_flyer BOOLEAN DEFAULT true,
  ADD COLUMN default_service VARCHAR(20) DEFAULT 'hanjullo';
```

---

## 6. 프론트엔드 구현

### 6-1. 라우팅

```typescript
// App.tsx (super admin frontend)
<Routes>
  <Route path="/" element={<Navigate to="/hanjullo/dashboard" />} />

  {/* 한줄로 모드 */}
  <Route path="/hanjullo/*" element={<HanjulloLayout />}>
    <Route path="dashboard" element={<HanjulloDashboard />} />
    <Route path="companies" element={<HanjulloCompanies />} />
    ...
  </Route>

  {/* 전단AI 모드 */}
  <Route path="/flyer/*" element={<FlyerLayout />}>
    <Route path="dashboard" element={<FlyerDashboard />} />
    <Route path="companies" element={<FlyerCompanies />} />
    <Route path="pos-agents" element={<FlyerPosAgents />} />
    ...
  </Route>
</Routes>
```

### 6-2. 레이아웃 분리

```typescript
// HanjulloLayout.tsx
<div className="theme-hanjullo">
  <ServiceSwitcher current="hanjullo" />
  <HanjulloMenu />
  <Outlet />
</div>

// FlyerLayout.tsx
<div className="theme-flyer">
  <ServiceSwitcher current="flyer" />
  <FlyerModeBanner />  {/* 🟠 전단AI 모드 배너 */}
  <FlyerMenu />
  <Outlet />
</div>
```

### 6-3. 서비스 스위처 컴포넌트

```typescript
// ServiceSwitcher.tsx
const handleSwitch = async (to: 'hanjullo' | 'flyer') => {
  if (to === current) return;

  const confirmed = await confirmModal(`${to === 'flyer' ? '전단AI' : '한줄로AI'} 모드로 전환합니다`);
  if (!confirmed) return;

  const { token, redirect_to } = await api.post('/api/admin/switch-service', { to });
  localStorage.setItem('super_token', token);
  window.location.href = redirect_to;  // 전체 리로드
};
```

---

## 7. 체크리스트

### Phase 0 (인프라)
- [ ] super_users 테이블에 can_access_* 컬럼 추가
- [ ] super_audit_log 테이블 신설
- [ ] /api/admin/switch-service 엔드포인트
- [ ] requireService 미들웨어
- [ ] /api/admin/flyer/* 라우트 폴더 생성

### Phase 1 (전단AI 모드 UI)
- [ ] ServiceSwitcher 컴포넌트
- [ ] FlyerLayout + 주황 테마
- [ ] FlyerModeBanner (상단 고정)
- [ ] FlyerMenu (전단AI 전용 메뉴)
- [ ] FlyerDashboard (마트 대시보드)

### Phase 2 (전단AI CRUD)
- [ ] FlyerCompanies (마트 회사 관리)
- [ ] FlyerUsers (flyer_users 관리)
- [ ] FlyerBilling (15만원 정액제 결제 관리)

### Phase 3 (POS 모니터링)
- [ ] FlyerPosAgents (Agent 상태 실시간)
- [ ] FlyerPosData (판매/재고 조회)

### Phase 4 (검증)
- [ ] URL 직접 접근 시 403 확인
- [ ] 쿠키 변조로 우회 불가 확인
- [ ] 감사 로그 기록 확인
- [ ] Harold 계정으로 전환 테스트
