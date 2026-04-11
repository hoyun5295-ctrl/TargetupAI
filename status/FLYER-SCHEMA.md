# 전단AI — DB 스키마 (flyer_* 완전 분리)

> **한줄로 SCHEMA.md와 완전 분리.** 전단AI 전용 테이블(flyer_*)만 여기에 정의.
> **방식 B 확정 (D112):** 한줄로 companies/users/customers 테이블과 완전 분리.
> **최종 업데이트:** 2026-04-12 (D114 flyer_companies 사업자등록증/세금계산서 컬럼 + flyer_business_types + flyer_users 확장 반영)

---

## 0. 설계 원칙

1. **네이밍 규칙:** 모든 테이블은 `flyer_` prefix. 한줄로와 이름 충돌 0.
2. **외래키 격리:** flyer_* 테이블은 한줄로 companies/users/customers 참조 금지. flyer_companies/flyer_users/flyer_customers만 참조.
3. **공유 없음:** plans, sender_numbers, callback_numbers, unsubscribes 전부 전단AI 전용 별도 테이블.
4. **한줄로 기간계 무접촉:** 한줄로의 campaigns/customers/users 스키마 수정 시 flyer_*는 전혀 건드리지 않는다. 반대도 마찬가지.
5. **로그인:** login_id 기반 (한줄로 users.login_id와 동일 패턴). email은 보조 정보.

---

## 1. 핵심 테이블 (서버 생성 완료)

### 1-1. flyer_companies — 전단AI 회사 (마트/로컬 매장)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| company_name | VARCHAR(200) NOT NULL | 마트/매장명 |
| business_type | VARCHAR(50) | mart, butcher, seafood, bakery, cafe 등 |
| business_number | VARCHAR(20) | 사업자등록번호 |
| owner_name | VARCHAR(100) | 사장님 이름 |
| owner_phone | VARCHAR(20) | 사장님 전화 |
| address | TEXT | 매장 주소 |
| store_hours | VARCHAR(100) | 영업시간 (예: "09:00-22:00") |
| plan_type | VARCHAR(30) DEFAULT 'flyer_basic' | 요금제 코드 |
| monthly_fee | INTEGER DEFAULT 150000 | 월정액 |
| plan_started_at | DATE | 계약 시작일 |
| plan_expires_at | DATE | 계약 만료일 |
| payment_status | VARCHAR(20) DEFAULT 'active' | active/expired/suspended |
| opt_out_080_number | VARCHAR(20) | 080 수신거부번호 |
| opt_out_080_auto_sync | BOOLEAN DEFAULT true | 080 자동연동 |
| pos_type | VARCHAR(30) | posbank/okpos/unipos 등 |
| pos_agent_key | VARCHAR(100) UNIQUE | POS Agent 인증 키 |
| pos_last_sync_at | TIMESTAMPTZ | 마지막 POS 싱크 시각 |
| line_group_id | UUID | SMS 라인그룹 (sms_line_groups FK) |
| sms_unit_price | NUMERIC(8,2) DEFAULT 9.0 | SMS 단가 |
| lms_unit_price | NUMERIC(8,2) DEFAULT 29.0 | LMS 단가 |
| mms_unit_price | NUMERIC(8,2) DEFAULT 80.0 | MMS 단가 |
| **business_reg_name** | VARCHAR(200) | ★ D114 사업자등록증 상호 |
| **business_reg_owner** | VARCHAR(100) | ★ D114 대표자 |
| **business_category** | VARCHAR(100) | ★ D114 업태 |
| **business_item** | VARCHAR(100) | ★ D114 종목 |
| **business_address** | TEXT | ★ D114 사업장 주소 |
| **tax_email** | VARCHAR(200) | ★ D114 세금계산서 이메일 |
| **tax_manager_name** | VARCHAR(100) | ★ D114 세금계산서 담당자 |
| **tax_manager_phone** | VARCHAR(20) | ★ D114 세금계산서 담당자 연락처 |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | soft delete |

- INDEX: `idx_flyer_companies_payment (payment_status, plan_expires_at)`

### 1-2. flyer_users — 전단AI 사용자

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| company_id | UUID FK→flyer_companies ON DELETE CASCADE | |
| login_id | VARCHAR(100) UNIQUE | ★ 로그인 ID (한줄로 users.login_id와 동일 패턴) |
| email | VARCHAR(200) | 이메일 (보조 정보, UNIQUE 아님) |
| password_hash | VARCHAR(255) NOT NULL | bcrypt 해시 |
| name | VARCHAR(100) | |
| phone | VARCHAR(20) | |
| role | VARCHAR(20) DEFAULT 'flyer_admin' | flyer_admin(사장)/flyer_staff(직원) |
| **business_type** | VARCHAR(50) | ★ D113 매장 업종 (mart/butcher 등) |
| **store_name** | VARCHAR(200) | ★ D113 매장명 |
| **business_number** | VARCHAR(20) | ★ D113 사업자등록번호 |
| **business_reg_name** | VARCHAR(200) | ★ D113 상호 |
| **business_reg_owner** | VARCHAR(100) | ★ D113 대표자 |
| **business_category** | VARCHAR(100) | ★ D113 업태 |
| **business_item** | VARCHAR(100) | ★ D113 종목 |
| **business_address** | TEXT | ★ D113 사업장 주소 |
| **tax_email** | VARCHAR(200) | ★ D113 세금계산서 이메일 |
| **tax_manager_name** | VARCHAR(100) | ★ D113 세금계산서 담당자 |
| **tax_manager_phone** | VARCHAR(20) | ★ D113 세금계산서 담당자 연락처 |
| **contact_name** | VARCHAR(100) | ★ D113 담당자명 |
| **contact_phone** | VARCHAR(20) | ★ D113 담당자 연락처 |
| **contact_email** | VARCHAR(200) | ★ D113 담당자 이메일 |
| **monthly_fee** | INTEGER DEFAULT 150000 | ★ D113 월정액 |
| **payment_status** | VARCHAR(20) DEFAULT 'pending' | ★ D113 pending/active/suspended |
| **prepaid_balance** | INTEGER DEFAULT 0 | ★ D113 선불 잔액 |
| **plan_started_at** | DATE | ★ D113 계약 시작일 |
| **plan_expires_at** | DATE | ★ D113 계약 만료일 |
| **memo** | TEXT | ★ D113 관리 메모 |
| last_login_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | soft delete |

- UNIQUE: `flyer_users_login_id_key (login_id)`
- **⚠️ email은 UNIQUE가 아님** (D112 ALTER로 해제 완료). 같은 이메일로 한줄로+전단AI 양쪽 가입 가능.

### 1-3. flyer_customers — 마트 고객 (POS 회원)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| company_id | UUID FK→flyer_companies ON DELETE CASCADE | |
| name | VARCHAR(100) | |
| phone | VARCHAR(20) NOT NULL | |
| gender | VARCHAR(10) | ★ varchar(10) — 한줄로 customers.gender와 동일 |
| birth_date | DATE | |
| email | VARCHAR(200) | |
| address | TEXT | |
| pos_member_id | VARCHAR(100) | POS 회원번호 |
| pos_grade | VARCHAR(50) | POS 등급 |
| pos_points | INTEGER DEFAULT 0 | |
| last_purchase_at | TIMESTAMPTZ | |
| last_purchase_amount | INTEGER | |
| total_purchase_amount | NUMERIC(15,2) DEFAULT 0 | ★ numeric(15,2) — 한줄로와 동일 |
| purchase_count | INTEGER DEFAULT 0 | |
| avg_purchase_amount | INTEGER | |
| rfm_segment | VARCHAR(20) | champion/loyal/new/at_risk/lost/whale |
| sms_opt_in | BOOLEAN DEFAULT true | |
| sms_opt_in_at | TIMESTAMPTZ | |
| source | VARCHAR(20) DEFAULT 'manual' | manual/excel/pos_agent |
| last_synced_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | |

- UNIQUE: `(company_id, phone)`
- INDEX: `idx_flyer_customers_company`, `idx_flyer_customers_phone`, `idx_flyer_customers_rfm`, `idx_flyer_customers_last_purchase`

### 1-4. flyer_campaigns — 전단AI 캠페인/발송

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| company_id | UUID FK→flyer_companies ON DELETE CASCADE | |
| created_by | UUID FK→flyer_users | |
| flyer_id | UUID | 전단지 연결 |
| short_url_id | UUID | 단축URL 연결 |
| campaign_name | VARCHAR(200) | ★ D112 ALTER 추가 |
| message_type | VARCHAR(10) | SMS/LMS/MMS |
| message_content | TEXT | |
| is_ad | BOOLEAN DEFAULT true | |
| callback_number | VARCHAR(20) | |
| mms_image_path | TEXT | |
| total_recipients | INTEGER | |
| sent_count | INTEGER DEFAULT 0 | |
| success_count | INTEGER DEFAULT 0 | |
| fail_count | INTEGER DEFAULT 0 | |
| status | VARCHAR(20) DEFAULT 'draft' | draft/queued/sending/completed/cancelled |
| scheduled_at | TIMESTAMPTZ | |
| sent_at | TIMESTAMPTZ | |
| roi_start_date | DATE | Phase B ROI 측정 |
| roi_end_date | DATE | |
| roi_buyers | INTEGER | |
| roi_revenue | BIGINT | |
| roi_updated_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

---

## 2. 부속 테이블

### 2-1. flyer_unsubscribes — 수신거부

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| user_id | UUID NOT NULL | flyer_users.id |
| company_id | UUID NOT NULL | flyer_companies.id |
| phone | VARCHAR(20) | |
| source | VARCHAR(20) DEFAULT 'manual' | manual/reply/080_ars/admin |
| created_at | TIMESTAMPTZ | |

- UNIQUE: `(user_id, phone)`

### 2-2. flyer_callback_numbers — 회신번호

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| company_id | UUID FK→flyer_companies ON DELETE CASCADE | |
| phone | VARCHAR(20) | ★ 컬럼명 `phone` (D112 ALTER 완료. 한줄로 callback_numbers.phone과 동일) |
| label | VARCHAR(100) | |
| is_default | BOOLEAN DEFAULT false | |
| created_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | soft delete |

---

## 3. POS Agent 테이블 (Phase B)

### 3-1. flyer_pos_agents

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| company_id | UUID FK→flyer_companies ON DELETE CASCADE | |
| agent_key | VARCHAR(100) UNIQUE NOT NULL | Agent 인증 키 |
| pos_type | VARCHAR(30) | posbank/okpos/unipos |
| pos_version | VARCHAR(50) | |
| hostname | VARCHAR(200) | |
| ip_address | INET | |
| last_heartbeat | TIMESTAMPTZ | |
| last_sync_at | TIMESTAMPTZ | |
| sync_status | VARCHAR(20) DEFAULT 'disconnected' | connected/disconnected/error |
| error_message | TEXT | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### 3-2. flyer_pos_sales — POS 판매 원장

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGSERIAL PK | |
| company_id | UUID FK→flyer_companies ON DELETE CASCADE | |
| customer_id | UUID FK→flyer_customers ON DELETE SET NULL | |
| sold_at | TIMESTAMPTZ NOT NULL | |
| receipt_no | VARCHAR(50) | |
| product_code | VARCHAR(100) | |
| product_name | VARCHAR(200) | |
| category | VARCHAR(100) | |
| quantity | NUMERIC(10,2) | |
| unit_price | INTEGER | |
| sale_price | INTEGER | |
| total_amount | INTEGER | |
| cost_price | INTEGER | |
| pos_raw | JSONB | POS 원본 데이터 |
| pos_agent_id | VARCHAR(100) | |
| created_at | TIMESTAMPTZ | |

- UNIQUE: `(company_id, receipt_no, product_code, sold_at)`
- INDEX: `idx_flyer_pos_sales_company_date`, `idx_flyer_pos_sales_product`, `idx_flyer_pos_sales_customer`

### 3-3. flyer_pos_inventory — POS 재고 스냅샷

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGSERIAL PK | |
| company_id | UUID FK→flyer_companies ON DELETE CASCADE | |
| product_code | VARCHAR(100) NOT NULL | |
| product_name | VARCHAR(200) | |
| category | VARCHAR(100) | |
| current_stock | NUMERIC(10,2) | |
| unit | VARCHAR(20) | ea/kg/g/L/ml/박스/팩 |
| cost_price | INTEGER | |
| sale_price | INTEGER | |
| expiry_date | DATE | 유통기한 |
| is_low_stock | BOOLEAN DEFAULT false | |
| is_expiring_soon | BOOLEAN DEFAULT false | |
| snapshot_at | TIMESTAMPTZ NOT NULL | |
| pos_raw | JSONB | |
| created_at | TIMESTAMPTZ | |

- UNIQUE: `(company_id, product_code, snapshot_at)`
- INDEX: `idx_flyer_pos_inventory_company`

---

## 4. 카탈로그 / 요금제 / 과금

### 4-1. flyer_catalog — 재사용 상품 카탈로그

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| company_id | UUID FK→flyer_companies ON DELETE CASCADE | |
| product_name | VARCHAR(200) NOT NULL | |
| category | VARCHAR(100) | |
| default_price | INTEGER | |
| image_url | TEXT | |
| description | TEXT | |
| usage_count | INTEGER DEFAULT 0 | 전단에 사용된 횟수 |
| last_used_at | TIMESTAMPTZ | |
| pos_product_code | VARCHAR(100) | POS 연동 시 매핑 |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

- INDEX: `idx_flyer_catalog_company_usage`
- **⚠️ UNIQUE 제약 없음.** UPSERT 시 SELECT 존재 확인 → INSERT or UPDATE 패턴 사용 (CT-F11)

### 4-2. flyer_plans — 요금제

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| plan_code | VARCHAR(30) UNIQUE | flyer_basic |
| plan_name | VARCHAR(100) | 전단AI 베이직 |
| monthly_fee | INTEGER | 150000 |
| included_sms | INTEGER DEFAULT 0 | 포함 발송량 |
| features | JSONB | 기능 플래그 |
| is_active | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMPTZ | |

**초기 데이터:** `flyer_basic` / `전단AI 베이직` / 150000원

### 4-3. flyer_billing_history — 월 과금 이력

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| company_id | UUID FK→flyer_companies ON DELETE CASCADE | |
| billing_month | DATE NOT NULL | YYYY-MM-01 |
| monthly_fee | INTEGER | |
| sms_overage | INTEGER DEFAULT 0 | 초과 발송비 |
| total_amount | INTEGER | |
| paid_at | TIMESTAMPTZ | |
| payment_status | VARCHAR(20) | pending/paid/failed |
| created_at | TIMESTAMPTZ | |

- UNIQUE: `(company_id, billing_month)`

### 4-4. flyer_business_types — 업종 마스터 (D113)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| type_code | VARCHAR(30) UNIQUE NOT NULL | mart, butcher, seafood, bakery, cafe 등 |
| type_name | VARCHAR(50) NOT NULL | 마트, 정육점, 수산, 베이커리, 카페 |
| default_categories | JSONB | 업종별 기본 카테고리 (예: ["축산","수산","과일"]) |
| is_active | BOOLEAN DEFAULT true | |
| sort_order | INTEGER DEFAULT 0 | |
| created_at | TIMESTAMPTZ | |

**초기 데이터:** mart(마트), butcher(정육점)

---

## 5. 슈퍼관리자 확장 (D112)

### super_admins 테이블에 추가된 컬럼

| 컬럼 | 타입 | 설명 |
|------|------|------|
| can_access_hanjullo | BOOLEAN DEFAULT true | 한줄로 접근 권한 |
| can_access_flyer | BOOLEAN DEFAULT true | 전단AI 접근 권한 |

---

## 6. 기존 전단AI 테이블 (한줄로에서 유지)

### flyers / short_urls / url_clicks

이 3개 테이블은 기존 한줄로 DB에 존재하며, D112 이후 `flyers.company_id`는 `flyer_companies.id`를 참조하도록 외래키 교체 예정 (동일 UUID 사용).

상세 스키마는 한줄로 SCHEMA.md 참조.

---

## 7. 현재 서버 데이터 현황 (2026-04-09)

| 테이블 | 건수 | 비고 |
|--------|------|------|
| flyer_companies | 1 | 마트테스트 |
| flyer_users | 0 | 계정 생성 대기 |
| flyer_customers | 0 | 마트테스트에 고객 없음 |
| flyer_campaigns | 0 | |
| flyer_plans | 1 | flyer_basic (15만원) |
| 나머지 | 0 | |
