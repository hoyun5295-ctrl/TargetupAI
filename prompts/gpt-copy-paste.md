# DB 스키마 리뷰 요청

나는 타겟업(Target-UP)이라는 기업용 메시징 솔루션을 개발하려고 해.
아래는 PostgreSQL DB 스키마야. 리뷰해줘.

## 검토해줘야 할 것들

1. **테이블 설계가 적절한지** - 빠진 테이블이나 불필요한 테이블 있는지
2. **컬럼이 적절한지** - 빠진 컬럼, 데이터 타입 문제
3. **인덱스** - 추가로 필요한 인덱스
4. **보안** - 개인정보 관련 문제
5. **한국 법규** - 발신번호 사전등록제, 수신거부, 개인정보보호법 준수 여부

## 출력 형식

```
### ✅ 잘된 점
- ...

### ⚠️ 개선 필요
| 테이블 | 문제점 | 수정 방법 |
|--------|--------|----------|
| ... | ... | ... |

### 🔴 반드시 수정해야 함
- ...
```

---

## 스키마 (PostgreSQL)

```sql
-- ============================================
-- Target-UP Database Schema
-- PostgreSQL 15+
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 고객사 (타겟업을 사용하는 기업)
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    business_number VARCHAR(20),
    opt_out_080_number VARCHAR(20),
    sender_number_preregistered BOOLEAN DEFAULT FALSE,
    basic_analysis_url VARCHAR(400),
    premium_analysis_enabled BOOLEAN DEFAULT FALSE,
    premium_analysis_url VARCHAR(400),
    print_url VARCHAR(400),
    alarm_threshold INTEGER DEFAULT 30000,
    use_product_category_large BOOLEAN DEFAULT TRUE,
    use_product_category_medium BOOLEAN DEFAULT TRUE,
    use_product_category_small BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 관리자/사용자 계정
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    login_id VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('admin', 'user')),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    phone VARCHAR(20),
    department VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'locked', 'dormant')),
    password_changed_at TIMESTAMP,
    must_change_password BOOLEAN DEFAULT TRUE,
    allowed_ips TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP
);

-- 알람 수신 번호 (사용자별 최대 10개)
CREATE TABLE user_alarm_phones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, phone)
);

-- 고객정보
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    phone VARCHAR(20) NOT NULL,
    name VARCHAR(100),
    gender VARCHAR(10),
    birth_date DATE,
    age INTEGER,
    email VARCHAR(100),
    address TEXT,
    grade VARCHAR(50),
    points INTEGER DEFAULT 0,
    store_code VARCHAR(50),
    registered_store VARCHAR(100),
    registered_store_number VARCHAR(50),
    registration_type VARCHAR(50),
    recent_purchase_amount DECIMAL(15,2),
    recent_purchase_store VARCHAR(100),
    total_purchase_amount DECIMAL(15,2),
    wedding_anniversary DATE,
    is_married BOOLEAN,
    sms_opt_in BOOLEAN DEFAULT TRUE,
    custom_fields JSONB DEFAULT '{}',
    is_opt_out BOOLEAN DEFAULT FALSE,
    is_invalid BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, phone)
);

-- 고객정보 동적 필드 정의
CREATE TABLE customer_field_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    field_key VARCHAR(50) NOT NULL,
    field_label VARCHAR(100) NOT NULL,
    field_type VARCHAR(20) NOT NULL CHECK (field_type IN ('INT', 'VARCHAR', 'DATE', 'BOOLEAN')),
    field_size INTEGER,
    search_popup_type VARCHAR(30) CHECK (search_popup_type IN (
        'checkbox', 'checkbox_range', 'listbox_search', 'searchbox', 'product_info'
    )),
    is_key BOOLEAN DEFAULT FALSE,
    is_hidden BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, field_key)
);

-- 구매내역
CREATE TABLE purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    customer_id UUID REFERENCES customers(id),
    customer_phone VARCHAR(20) NOT NULL,
    purchase_date TIMESTAMP NOT NULL,
    store_code VARCHAR(50),
    store_name VARCHAR(100),
    product_id UUID,
    product_code VARCHAR(50),
    product_name VARCHAR(200),
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(15,2),
    total_amount DECIMAL(15,2),
    custom_fields JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 상품 마스터
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    product_code VARCHAR(50),
    product_name VARCHAR(200) NOT NULL,
    category_large VARCHAR(100),
    category_medium VARCHAR(100),
    category_small VARCHAR(100),
    price DECIMAL(15,2),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, product_code)
);

-- 발신번호 관리
CREATE TABLE sender_numbers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID REFERENCES users(id),
    phone_number VARCHAR(20) NOT NULL,
    description VARCHAR(200),
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, phone_number)
);

-- 카카오 발신프로필
CREATE TABLE kakao_sender_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    profile_key VARCHAR(100) NOT NULL,
    profile_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, profile_key)
);

-- 발신프로필-사용자 매핑
CREATE TABLE user_sender_profiles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES kakao_sender_profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, profile_id)
);

-- 프로젝트 (발송 묶음)
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL REFERENCES users(id),
    project_name VARCHAR(200) NOT NULL,
    analysis_start_date DATE,
    analysis_end_date DATE,
    total_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 메시지 발송
CREATE TABLE messages (
    id UUID DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL,
    project_id UUID NOT NULL,
    user_id UUID NOT NULL,
    message_type VARCHAR(10) NOT NULL CHECK (message_type IN ('SMS', 'LMS', 'MMS', 'KMS', 'FMS', 'GMS')),
    recipient_phone VARCHAR(20) NOT NULL,
    recipient_name VARCHAR(100),
    merge_data JSONB DEFAULT '{}',
    sender_number VARCHAR(20),
    reply_number VARCHAR(20),
    subject VARCHAR(200),
    content TEXT NOT NULL,
    content_merged TEXT,
    image_urls TEXT[],
    template_id UUID,
    kakao_profile_id UUID,
    kakao_buttons JSONB,
    fallback_enabled BOOLEAN DEFAULT FALSE,
    fallback_message_id UUID,
    scheduled_at TIMESTAMP,
    send_rate_per_minute INTEGER,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'delivered', 'failed', 'cancelled')),
    result_code VARCHAR(20),
    result_message TEXT,
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    charge_amount DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- 알림톡 템플릿
CREATE TABLE kakao_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    profile_id UUID NOT NULL REFERENCES kakao_sender_profiles(id),
    template_code VARCHAR(50),
    template_name VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    buttons JSONB DEFAULT '[]',
    variables TEXT[],
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'requested', 'approved', 'rejected', 'blocked')),
    reject_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP
);

-- 친구톡 이미지
CREATE TABLE kakao_friendtalk_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL REFERENCES users(id),
    image_name VARCHAR(200),
    image_url VARCHAR(500),
    original_filename VARCHAR(200),
    file_size INTEGER,
    width INTEGER,
    height INTEGER,
    status VARCHAR(20) DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);

-- 문자 템플릿 보관함
CREATE TABLE sms_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL REFERENCES users(id),
    template_name VARCHAR(100) NOT NULL,
    message_type VARCHAR(10) NOT NULL CHECK (message_type IN ('SMS', 'LMS', 'MMS')),
    subject VARCHAR(200),
    content TEXT NOT NULL,
    image_urls TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Mobile DM 요청
CREATE TABLE mobile_dm_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL REFERENCES users(id),
    dm_sample_id VARCHAR(50),
    request_images TEXT[],
    request_note TEXT,
    completed_url VARCHAR(500),
    status VARCHAR(20) DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'completed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- 080 수신거부
CREATE TABLE opt_outs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    opt_out_number VARCHAR(20) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    source VARCHAR(20) DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, opt_out_number, phone)
);

-- 인덱스
CREATE INDEX idx_customers_company_phone ON customers(company_id, phone);
CREATE INDEX idx_customers_company_name ON customers(company_id, name);
CREATE INDEX idx_customers_custom_fields ON customers USING GIN (custom_fields);
CREATE INDEX idx_messages_project ON messages(project_id, created_at);
CREATE INDEX idx_messages_user ON messages(user_id, created_at);
CREATE INDEX idx_messages_status ON messages(status, scheduled_at);
CREATE INDEX idx_messages_recipient ON messages(recipient_phone, created_at);
CREATE INDEX idx_kakao_templates_company ON kakao_templates(company_id, status);
CREATE INDEX idx_opt_outs_phone ON opt_outs(company_id, phone);
```
