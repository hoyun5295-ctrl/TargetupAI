# 전단AI — 계정/데이터 완전 분리 마이그레이션 계획 (방식 B)

> **작성:** 2026-04-09 (D112)
> **목표:** 전단AI가 한줄로 companies/users/customers/campaigns 테이블을 **0% 참조**하도록 분리
> **제약:** 다음주 월요일 한줄로 레거시 이관과 충돌 금지. 전단AI는 한줄로 기간계 절대 무접촉.

---

## 0. 이 계획이 필요한 이유

현재 전단AI는 한줄로 백엔드 코드(특히 campaigns.ts, customers.ts, companies.ts)를 재활용하고 있어 다음 리스크가 있습니다:

1. **한줄로 수정 시 전단AI에 영향** — campaigns.ts 5경로 수정하다 전단AI 발송 깨질 가능성
2. **한줄로 이관 시 전단AI 계정 섞임** — 다음주 월요일 레거시 이관 때 전단AI 회사가 한줄로 companies에 있으면 사고 위험
3. **POS 연동 시 한줄로 customers 스키마 오염** — pos_member_id, rfm_segment 같은 마트 전용 컬럼을 한줄로에 추가하면 안 됨
4. **계정 충돌** — 같은 이메일로 양쪽 가입 불가

→ **방식 B: flyer_* 테이블 완전 분리** 로 해결.

---

## 1. 전제 조건 (Harold님 확인 필요)

### 1-1. 서버 데이터 상태 확인 명령 (Harold님 실행)

```bash
# 1. 현재 전단AI를 사용 중인 회사가 몇 개인지
psql -U targetup -d targetup -c "
SELECT c.id, c.company_name, c.created_at,
       (SELECT COUNT(*) FROM flyers WHERE company_id = c.id) AS flyer_count
FROM companies c
WHERE EXISTS (SELECT 1 FROM flyers WHERE company_id = c.id)
ORDER BY c.created_at;
"

# 2. 전단AI 사용 중인 회사의 사용자 수
psql -U targetup -d targetup -c "
SELECT c.id, c.company_name, COUNT(u.id) AS user_count
FROM companies c
LEFT JOIN users u ON u.company_id = c.id
WHERE EXISTS (SELECT 1 FROM flyers WHERE company_id = c.id)
GROUP BY c.id, c.company_name;
"

# 3. 전단AI 사용 중인 회사의 고객 수
psql -U targetup -d targetup -c "
SELECT c.id, c.company_name,
       (SELECT COUNT(*) FROM customers WHERE company_id = c.id) AS customer_count
FROM companies c
WHERE EXISTS (SELECT 1 FROM flyers WHERE company_id = c.id);
"

# 4. 전단AI 사용 중인 회사의 발송 이력 (campaigns 재활용 현황)
psql -U targetup -d targetup -c "
SELECT c.id, c.company_name,
       (SELECT COUNT(*) FROM campaigns WHERE company_id = c.id) AS campaign_count
FROM companies c
WHERE EXISTS (SELECT 1 FROM flyers WHERE company_id = c.id);
"

# 5. 한줄로+전단AI 동시 사용 회사 식별 (분리 시 혼동 방지)
psql -U targetup -d targetup -c "
SELECT c.id, c.company_name,
  (SELECT COUNT(*) FROM flyers WHERE company_id = c.id) AS flyer_count,
  (SELECT COUNT(*) FROM campaigns WHERE company_id = c.id AND created_at > now() - interval '90 days') AS recent_campaigns
FROM companies c
WHERE EXISTS (SELECT 1 FROM flyers WHERE company_id = c.id)
   OR c.id IN (SELECT DISTINCT company_id FROM campaigns WHERE created_at > now() - interval '90 days');
"
```

Harold님 조회 결과 공유 → 이관 스크립트에 반영.

### 1-2. 한줄로 이관 일정과 충돌 회피

- **월요일(4/13):** 한줄로 레거시 이관 (최우선, AI 손 안 댐)
- **월요일 이전:** 본 문서 검토 + flyer_* 테이블 CREATE만 미리 준비 (빈 테이블)
- **월요일 당일:** 한줄로 이관에만 집중, 전단AI 이관 착수 금지
- **화요일 이후:** 전단AI 이관 본격 착수

---

## 2. 마이그레이션 단계

### **Step 1: flyer_* 테이블 생성 (DDL)** — 월요일 전 준비 가능

```sql
BEGIN;

-- 2-1. 회사
CREATE TABLE flyer_companies (...); -- FLYER-SCHEMA.md 참조

-- 2-2. 사용자
CREATE TABLE flyer_users (...);

-- 2-3. 고객
CREATE TABLE flyer_customers (...);

-- 2-4. POS
CREATE TABLE flyer_pos_sales (...);
CREATE TABLE flyer_pos_inventory (...);
CREATE TABLE flyer_pos_agents (...);

-- 2-5. 카탈로그
CREATE TABLE flyer_catalog (...);

-- 2-6. 캠페인/발송
CREATE TABLE flyer_campaigns (...);
CREATE TABLE flyer_unsubscribes (...);
CREATE TABLE flyer_sender_numbers (...);
CREATE TABLE flyer_callback_numbers (...);

-- 2-7. 요금제/과금
CREATE TABLE flyer_plans (...);
CREATE TABLE flyer_billing_history (...);

INSERT INTO flyer_plans (plan_code, plan_name, monthly_fee) VALUES
  ('flyer_basic', '전단AI 베이직', 150000);

-- 2-8. 슈퍼관리자 권한 확장
ALTER TABLE super_users
  ADD COLUMN can_access_hanjullo BOOLEAN DEFAULT true,
  ADD COLUMN can_access_flyer BOOLEAN DEFAULT true;

COMMIT;
```

**검증:**
```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'flyer_%';
```
→ 11개 테이블 확인.

### **Step 2: 기존 전단AI 데이터 이관 (화요일 이후)**

**2-1. 전단AI 사용 회사 식별**
```sql
CREATE TEMP TABLE flyer_migration_companies AS
SELECT DISTINCT c.id AS old_id, c.*
FROM companies c
WHERE EXISTS (SELECT 1 FROM flyers WHERE company_id = c.id);
```

**2-2. flyer_companies INSERT**
```sql
INSERT INTO flyer_companies (
  id, company_name, business_type, owner_name, owner_phone, address,
  plan_type, monthly_fee, plan_started_at, payment_status,
  opt_out_080_number, opt_out_080_auto_sync,
  sms_unit_price, lms_unit_price, mms_unit_price,
  created_at
)
SELECT
  id, company_name, 'mart', manager_name, manager_phone, address,
  'flyer_basic', 150000, created_at::date, 'active',
  opt_out_080_number, COALESCE(opt_out_080_auto_sync, true),
  sms_unit_price, lms_unit_price, mms_unit_price,
  created_at
FROM flyer_migration_companies;
```

**2-3. flyer_users INSERT**
```sql
INSERT INTO flyer_users (id, company_id, email, password_hash, name, phone, role, created_at)
SELECT u.id, u.company_id, u.email, u.password_hash, u.name, u.phone,
       'flyer_admin', u.created_at
FROM users u
WHERE u.company_id IN (SELECT old_id FROM flyer_migration_companies);
```

**2-4. flyer_customers INSERT**
```sql
INSERT INTO flyer_customers (
  id, company_id, name, phone, gender, birth_date, email, address,
  last_purchase_at, last_purchase_amount, total_purchase_amount, purchase_count,
  sms_opt_in, source, created_at
)
SELECT
  id, company_id, name, phone, gender, birth_date, email, address,
  recent_purchase_date, recent_purchase_amount, total_purchase_amount, purchase_count,
  sms_opt_in, 'excel', created_at
FROM customers
WHERE company_id IN (SELECT old_id FROM flyer_migration_companies);
```

**2-5. flyers 외래키 교체**
```sql
-- flyers.company_id는 id가 같으므로 외래키 제약만 교체
ALTER TABLE flyers DROP CONSTRAINT flyers_company_id_fkey;
ALTER TABLE flyers ADD CONSTRAINT flyers_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES flyer_companies(id) ON DELETE CASCADE;
```

**2-6. flyer_campaigns (기존 캠페인 이관)**

과거 발송 이력을 flyer_campaigns로 이관. ⚠️ **한줄로 campaigns는 건드리지 않음 — 그대로 두고 flyer_campaigns에 복사**.

```sql
INSERT INTO flyer_campaigns (
  id, company_id, created_by, flyer_id, short_url_id,
  message_type, message_content, is_ad, callback_number, mms_image_path,
  total_recipients, sent_count, success_count, fail_count,
  status, sent_at, created_at
)
SELECT
  gen_random_uuid(), c.company_id, c.created_by, c.flyer_id, c.short_url_id,
  c.message_type, c.message_content, c.is_ad, c.callback_number, c.mms_image_path,
  c.total_recipients, c.sent_count, c.success_count, c.fail_count,
  c.status, c.sent_at, c.created_at
FROM campaigns c
WHERE c.company_id IN (SELECT old_id FROM flyer_migration_companies)
  AND c.flyer_id IS NOT NULL;  -- 전단지 연결된 캠페인만
```

**2-7. flyer_unsubscribes / flyer_sender_numbers / flyer_callback_numbers 복사**

### **Step 3: 백엔드 코드 분기**

**3-1. 전단AI 전용 라우트 프리픽스 정리**

현재:
```
/api/flyer/auth/*
/api/flyer/flyers/*
```

추가 필요:
```
/api/flyer/companies/*     (신규 — flyer_companies CRUD)
/api/flyer/customers/*     (신규 — flyer_customers CRUD, 기존 /api/customers 미사용)
/api/flyer/campaigns/*     (신규 — flyer_campaigns, 기존 /api/campaigns 미사용)
/api/flyer/pos/*           (신규 — POS Agent 수신)
/api/flyer/billing/*       (신규 — flyer_billing_history)
```

**3-2. 전단AI 전용 미들웨어**

```typescript
// packages/backend/src/middleware/flyer-auth.ts
export function requireFlyerAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const payload = jwt.verify(token, FLYER_JWT_SECRET);
  if (payload.service !== 'flyer') {
    return res.status(401).json({ error: 'Not a flyer token' });
  }
  req.flyerUser = payload;
  next();
}
```

JWT payload에 `service: 'flyer'` 강제 주입. 한줄로 토큰으로 전단AI API 호출 차단.

**3-3. 전단AI 전용 유틸 폴더**

```
packages/backend/src/
├── routes/
│   ├── flyer/                    ← 전단AI 전용 라우트만
│   │   ├── auth.ts
│   │   ├── flyers.ts
│   │   ├── companies.ts
│   │   ├── customers.ts
│   │   ├── campaigns.ts
│   │   ├── pos.ts
│   │   └── billing.ts
│   ├── (기존 한줄로 라우트)
│
├── utils/flyer/                  ← 전단AI 전용 유틸
│   ├── flyer-sms-queue.ts        ← sms-queue.ts 전단AI 전용 래퍼
│   ├── flyer-unsubscribe.ts
│   ├── flyer-customer-filter.ts
│   └── flyer-prepaid.ts
```

**원칙:** 한줄로 utils/를 전단AI에서 import 가능하되, **한줄로 utils/ 수정 시 전단AI utils/에 영향 없도록 래퍼 분리**.

### **Step 4: 프론트엔드 분리 확인**

`packages/flyer-frontend/`는 이미 완전 분리되어 있으므로 API 엔드포인트만 `/api/flyer/*`로 전환.

### **Step 5: 검증 (이관 직후)**

```sql
-- 5-1. 테이블 row count 비교
SELECT 'flyer_companies' AS t, COUNT(*) FROM flyer_companies
UNION ALL SELECT 'flyer_users', COUNT(*) FROM flyer_users
UNION ALL SELECT 'flyer_customers', COUNT(*) FROM flyer_customers
UNION ALL SELECT 'flyers', COUNT(*) FROM flyers
UNION ALL SELECT 'flyer_campaigns', COUNT(*) FROM flyer_campaigns;

-- 5-2. 외래키 무결성
SELECT f.id, f.company_id
FROM flyers f
LEFT JOIN flyer_companies fc ON fc.id = f.company_id
WHERE fc.id IS NULL;  -- 0건이어야 함

-- 5-3. 전단AI 로그인 테스트 (flyer_users 계정)
-- 5-4. 전단지 발행/공개 페이지 정상 동작
-- 5-5. 한줄로 발송 기능 영향 없는지 확인 (smoke test)
```

### **Step 6: 한줄로 테이블 cleanup (2주 모니터링 후)**

```sql
-- 전단AI 전용 회사의 한줄로 레코드 soft delete
UPDATE companies SET deleted_at = now()
WHERE id IN (SELECT old_id FROM flyer_migration_companies)
  AND NOT EXISTS (SELECT 1 FROM campaigns WHERE company_id = companies.id AND flyer_id IS NULL);

-- users, customers도 동일하게 soft delete
```

**주의:** soft delete만. hard delete는 롤백 필요 시 대비해 1개월 이상 보관.

---

## 3. 롤백 계획

**Step 2 실패 시:**
```sql
BEGIN;
TRUNCATE flyer_companies, flyer_users, flyer_customers, flyer_campaigns CASCADE;
ALTER TABLE flyers DROP CONSTRAINT flyers_company_id_fkey;
ALTER TABLE flyers ADD CONSTRAINT flyers_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
COMMIT;
```

**Step 3 실패 시:**
- git revert → pm2 restart
- flyer 라우트를 기존 한줄로 라우트로 롤백

---

## 4. 체크리스트

### 월요일 전 (준비)
- [ ] Harold님 서버 데이터 조회 5건 공유
- [ ] flyer_* 테이블 CREATE 스크립트 최종 검토
- [ ] 이관 대상 회사 ID 목록 확정

### 월요일 (한줄로 이관, AI 개입 금지)
- [ ] 한줄로 이관 완료 대기
- [ ] 전단AI 작업 일시 중단

### 화요일 (전단AI 이관 착수)
- [ ] flyer_* 테이블 CREATE 실행
- [ ] 기존 전단AI 데이터 이관
- [ ] 외래키 교체
- [ ] 검증 쿼리 실행

### 수~목요일 (코드 분기)
- [ ] 전단AI 전용 라우트 `/api/flyer/*` 구축
- [ ] 전단AI 전용 미들웨어/JWT 분리
- [ ] 전단AI 전용 유틸 폴더
- [ ] flyer-frontend API 엔드포인트 교체
- [ ] 전 기능 smoke test

### 금요일 (모니터링)
- [ ] 실데이터 로그 확인
- [ ] 한줄로 영향 0건 확인
- [ ] 전단AI 사용자 피드백 수집

### 2주 후
- [ ] 한줄로 테이블에서 전단AI 회사 soft delete
- [ ] 1개월 후 hard delete

---

## 5. 위험 요소

| 위험 | 완화 |
|------|------|
| 한줄로 이관과 충돌 | 월요일 전단AI 작업 금지, 화요일부터 착수 |
| 외래키 실패로 flyers 고아 | Step 2-5에서 제약 재설정 전 검증 |
| 사용자 비밀번호 해시 호환 | bcrypt 동일 알고리즘 사용 중인지 확인 |
| 발송 이력 손실 | 한줄로 campaigns는 삭제 안 함, flyer_campaigns에 복사만 |
| JWT 토큰 혼용 | service 필드 강제 + 미들웨어 이중 체크 |
| POS Agent 연결 실패 | Phase B 인프라 단계에서 처리, 본 이관과 무관 |

---

## 6. ✅ Harold님 서버 실행 명령어 (D112 개발 완료 후)

> **⚠️ 순서대로 실행. 서버 SSH 접속 후 psql -U targetup -d targetup에서 실행.**
> 코드 배포(git pull + tsc + build + pm2 restart) 전에 DDL을 먼저 실행해야 함.

### 6-1. flyer_* 테이블 CREATE (psql에서 실행)

```sql
-- ======== 1. 핵심 테이블 ========

CREATE TABLE IF NOT EXISTS flyer_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(200) NOT NULL,
  business_type VARCHAR(50),
  business_number VARCHAR(20),
  owner_name VARCHAR(100),
  owner_phone VARCHAR(20),
  address TEXT,
  store_hours VARCHAR(100),
  plan_type VARCHAR(30) DEFAULT 'flyer_basic',
  monthly_fee INTEGER DEFAULT 150000,
  plan_started_at DATE,
  plan_expires_at DATE,
  payment_status VARCHAR(20) DEFAULT 'active',
  opt_out_080_number VARCHAR(20),
  opt_out_080_auto_sync BOOLEAN DEFAULT true,
  pos_type VARCHAR(30),
  pos_agent_key VARCHAR(100) UNIQUE,
  pos_last_sync_at TIMESTAMPTZ,
  line_group_id UUID,
  sms_unit_price NUMERIC(8,2) DEFAULT 9.0,
  lms_unit_price NUMERIC(8,2) DEFAULT 29.0,
  mms_unit_price NUMERIC(8,2) DEFAULT 80.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS flyer_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES flyer_companies(id) ON DELETE CASCADE,
  email VARCHAR(200) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100),
  phone VARCHAR(20),
  role VARCHAR(20) DEFAULT 'flyer_admin',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS flyer_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES flyer_companies(id) ON DELETE CASCADE,
  name VARCHAR(100),
  phone VARCHAR(20) NOT NULL,
  gender CHAR(1),
  birth_date DATE,
  email VARCHAR(200),
  address TEXT,
  pos_member_id VARCHAR(100),
  pos_grade VARCHAR(50),
  pos_points INTEGER DEFAULT 0,
  last_purchase_at TIMESTAMPTZ,
  last_purchase_amount INTEGER,
  total_purchase_amount BIGINT DEFAULT 0,
  purchase_count INTEGER DEFAULT 0,
  avg_purchase_amount INTEGER,
  rfm_segment VARCHAR(20),
  sms_opt_in BOOLEAN DEFAULT true,
  sms_opt_in_at TIMESTAMPTZ,
  source VARCHAR(20) DEFAULT 'manual',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(company_id, phone)
);

CREATE TABLE IF NOT EXISTS flyer_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES flyer_companies(id) ON DELETE CASCADE,
  created_by UUID REFERENCES flyer_users(id),
  flyer_id UUID,
  short_url_id UUID,
  message_type VARCHAR(10),
  message_content TEXT,
  is_ad BOOLEAN DEFAULT true,
  callback_number VARCHAR(20),
  mms_image_path TEXT,
  total_recipients INTEGER,
  sent_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  roi_start_date DATE,
  roi_end_date DATE,
  roi_buyers INTEGER,
  roi_revenue BIGINT,
  roi_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ======== 2. 수신거부/발신번호 ========

CREATE TABLE IF NOT EXISTS flyer_unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID NOT NULL,
  phone VARCHAR(20) NOT NULL,
  source VARCHAR(20) DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, phone)
);

CREATE TABLE IF NOT EXISTS flyer_callback_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES flyer_companies(id) ON DELETE CASCADE,
  number VARCHAR(20) NOT NULL,
  label VARCHAR(100),
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- ======== 3. POS Agent ========

CREATE TABLE IF NOT EXISTS flyer_pos_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES flyer_companies(id) ON DELETE CASCADE,
  agent_key VARCHAR(100) UNIQUE NOT NULL,
  pos_type VARCHAR(30),
  pos_version VARCHAR(50),
  hostname VARCHAR(200),
  ip_address INET,
  last_heartbeat TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  sync_status VARCHAR(20) DEFAULT 'disconnected',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flyer_pos_sales (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES flyer_companies(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES flyer_customers(id) ON DELETE SET NULL,
  sold_at TIMESTAMPTZ NOT NULL,
  receipt_no VARCHAR(50),
  product_code VARCHAR(100),
  product_name VARCHAR(200),
  category VARCHAR(100),
  quantity NUMERIC(10,2),
  unit_price INTEGER,
  sale_price INTEGER,
  total_amount INTEGER,
  cost_price INTEGER,
  pos_raw JSONB,
  pos_agent_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, receipt_no, product_code, sold_at)
);

CREATE TABLE IF NOT EXISTS flyer_pos_inventory (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES flyer_companies(id) ON DELETE CASCADE,
  product_code VARCHAR(100) NOT NULL,
  product_name VARCHAR(200),
  category VARCHAR(100),
  current_stock NUMERIC(10,2),
  unit VARCHAR(20),
  cost_price INTEGER,
  sale_price INTEGER,
  expiry_date DATE,
  is_low_stock BOOLEAN DEFAULT false,
  is_expiring_soon BOOLEAN DEFAULT false,
  snapshot_at TIMESTAMPTZ NOT NULL,
  pos_raw JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, product_code, snapshot_at)
);

-- ======== 4. 카탈로그 / 요금제 / 과금 ========

CREATE TABLE IF NOT EXISTS flyer_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES flyer_companies(id) ON DELETE CASCADE,
  product_name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  default_price INTEGER,
  image_url TEXT,
  description TEXT,
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  pos_product_code VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flyer_plans (
  id SERIAL PRIMARY KEY,
  plan_code VARCHAR(30) UNIQUE,
  plan_name VARCHAR(100),
  monthly_fee INTEGER,
  included_sms INTEGER DEFAULT 0,
  features JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO flyer_plans (plan_code, plan_name, monthly_fee, features) VALUES
  ('flyer_basic', '전단AI 베이직', 150000,
   '{"ai_generate": true, "pos_sync": true, "roi_tracking": true, "auto_send": true}')
ON CONFLICT (plan_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS flyer_billing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES flyer_companies(id) ON DELETE CASCADE,
  billing_month DATE NOT NULL,
  monthly_fee INTEGER,
  sms_overage INTEGER DEFAULT 0,
  total_amount INTEGER,
  paid_at TIMESTAMPTZ,
  payment_status VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, billing_month)
);

-- ======== 5. 인덱스 ========

CREATE INDEX IF NOT EXISTS idx_flyer_companies_payment ON flyer_companies(payment_status, plan_expires_at);
CREATE INDEX IF NOT EXISTS idx_flyer_customers_company ON flyer_customers(company_id);
CREATE INDEX IF NOT EXISTS idx_flyer_customers_phone ON flyer_customers(company_id, phone);
CREATE INDEX IF NOT EXISTS idx_flyer_customers_rfm ON flyer_customers(company_id, rfm_segment);
CREATE INDEX IF NOT EXISTS idx_flyer_customers_last_purchase ON flyer_customers(company_id, last_purchase_at DESC);
CREATE INDEX IF NOT EXISTS idx_flyer_pos_sales_company_date ON flyer_pos_sales(company_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_flyer_pos_sales_product ON flyer_pos_sales(company_id, product_code);
CREATE INDEX IF NOT EXISTS idx_flyer_pos_sales_customer ON flyer_pos_sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_flyer_pos_inventory_company ON flyer_pos_inventory(company_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_flyer_catalog_company_usage ON flyer_catalog(company_id, usage_count DESC);

-- ======== 6. 슈퍼관리자 권한 확장 ========

DO $$ BEGIN
  ALTER TABLE super_admins ADD COLUMN can_access_hanjullo BOOLEAN DEFAULT true;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE super_admins ADD COLUMN can_access_flyer BOOLEAN DEFAULT true;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
```

### 6-2. 테이블 생성 확인

```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'flyer_%' ORDER BY tablename;
-- 예상: 12개 (flyer_billing_history, flyer_callback_numbers, flyer_campaigns, flyer_catalog,
--        flyer_companies, flyer_customers, flyer_plans, flyer_pos_agents, flyer_pos_inventory,
--        flyer_pos_sales, flyer_unsubscribes, flyer_users)
```

### 6-3. 기존 전단AI 데이터 이관 (Harold님이 서버에서 직접 실행)

> ⚠️ Step 6-1 DDL 실행 후 실행. 이관 전 현재 전단AI 사용 회사 확인 먼저.

```sql
-- 현재 전단AI 사용 회사 확인
SELECT c.id, c.company_name,
  (SELECT COUNT(*) FROM flyers WHERE company_id = c.id) AS flyer_count,
  (SELECT COUNT(*) FROM users WHERE company_id = c.id) AS user_count,
  (SELECT COUNT(*) FROM customers WHERE company_id = c.id) AS customer_count
FROM companies c
WHERE EXISTS (SELECT 1 FROM flyers WHERE company_id = c.id);
```

**Harold님이 결과 확인 후, 이관 대상 회사 ID를 확인하고 아래 SQL 실행:**

```sql
-- (A) flyer_companies INSERT (전단AI 사용 회사만)
INSERT INTO flyer_companies (
  id, company_name, owner_name, owner_phone, address,
  opt_out_080_number, opt_out_080_auto_sync,
  sms_unit_price, lms_unit_price, mms_unit_price,
  line_group_id, plan_type, monthly_fee, payment_status, plan_started_at, created_at
)
SELECT
  c.id, c.company_name, c.manager_name, c.manager_phone, c.address,
  c.opt_out_080_number, COALESCE(c.opt_out_080_auto_sync, true),
  c.sms_unit_price, c.lms_unit_price, c.mms_unit_price,
  c.line_group_id, 'flyer_basic', 150000, 'active', CURRENT_DATE, c.created_at
FROM companies c
WHERE EXISTS (SELECT 1 FROM flyers WHERE company_id = c.id)
ON CONFLICT (id) DO NOTHING;

-- (B) flyer_users INSERT
INSERT INTO flyer_users (id, company_id, email, password_hash, name, phone, role, created_at)
SELECT u.id, u.company_id, u.login_id, u.password_hash, u.name, u.phone,
       'flyer_admin', u.created_at
FROM users u
WHERE u.company_id IN (SELECT id FROM flyer_companies)
ON CONFLICT (email) DO NOTHING;

-- (C) flyer_customers INSERT
INSERT INTO flyer_customers (
  id, company_id, name, phone, gender, birth_date, email, address,
  total_purchase_amount, purchase_count, sms_opt_in, source, created_at
)
SELECT
  id, company_id, name, phone, gender, birth_date, email, address,
  total_purchase_amount, purchase_count, sms_opt_in, 'excel', created_at
FROM customers
WHERE company_id IN (SELECT id FROM flyer_companies)
ON CONFLICT (company_id, phone) DO NOTHING;

-- (D) flyer_callback_numbers INSERT
INSERT INTO flyer_callback_numbers (id, company_id, number, label, is_default, created_at)
SELECT gen_random_uuid(), cn.company_id, cn.number, cn.label, cn.is_default, cn.created_at
FROM callback_numbers cn
WHERE cn.company_id IN (SELECT id FROM flyer_companies)
  AND cn.deleted_at IS NULL;

-- (E) flyer_unsubscribes INSERT
INSERT INTO flyer_unsubscribes (id, user_id, company_id, phone, source, created_at)
SELECT gen_random_uuid(), u.user_id, u.company_id, u.phone, u.source, u.created_at
FROM unsubscribes u
WHERE u.company_id IN (SELECT id FROM flyer_companies)
ON CONFLICT (user_id, phone) DO NOTHING;
```

### 6-4. flyers 외래키 교체

```sql
-- flyers 테이블이 flyer_companies를 참조하도록 변경
-- ⚠️ flyers.company_id 값이 flyer_companies.id에 존재해야 함 (6-3에서 이미 INSERT됨)

-- 기존 외래키 확인
SELECT conname FROM pg_constraint WHERE conrelid = 'flyers'::regclass AND contype = 'f';

-- 기존 외래키 제거 후 새로 추가
ALTER TABLE flyers DROP CONSTRAINT IF EXISTS flyers_company_id_fkey;
ALTER TABLE flyers ADD CONSTRAINT flyers_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES flyer_companies(id) ON DELETE CASCADE;
```

### 6-5. 이관 검증

```sql
-- row count 비교
SELECT 'flyer_companies' AS t, COUNT(*) FROM flyer_companies
UNION ALL SELECT 'flyer_users', COUNT(*) FROM flyer_users
UNION ALL SELECT 'flyer_customers', COUNT(*) FROM flyer_customers
UNION ALL SELECT 'flyer_campaigns', COUNT(*) FROM flyer_campaigns
UNION ALL SELECT 'flyers', COUNT(*) FROM flyers;

-- 외래키 무결성 확인 (0건이어야 함)
SELECT f.id, f.company_id
FROM flyers f
LEFT JOIN flyer_companies fc ON fc.id = f.company_id
WHERE fc.id IS NULL;
```

### 6-6. 코드 배포

```bash
cd /home/administrator/targetup-app
git pull
cd packages/backend && npx tsc
cd ../flyer-frontend && npm run build
cd ../frontend && npm run build
pm2 restart all
```

### 6-7. 배포 후 검증

- [ ] 전단AI 사이트 로그인 → 기존 계정으로 로그인 동작 확인
- [ ] 전단지 목록 → 기존 전단지 정상 표시
- [ ] 고객 목록 → 기존 고객 정상 표시
- [ ] 한줄로 사이트 → 기존 기능 정상 동작 (영향 0건 확인)
- [ ] 슈퍼관리자 → /admin/flyer 접근 시 전단AI 대시보드 표시
