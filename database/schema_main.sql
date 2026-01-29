-- ============================================
-- INVITO 공통 DB (invito_main)
-- 고객사 관리, 요금제, 정산, 슈퍼관리자, 필드매핑
-- PostgreSQL 15+
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- 1. 슈퍼관리자 (INVITO 직원)
-- ============================================
CREATE TABLE super_admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    login_id VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(20) DEFAULT 'admin' CHECK (role IN ('admin', 'super')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMPTZ
);

-- ============================================
-- 2. 요금제
-- ============================================
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_code VARCHAR(20) NOT NULL UNIQUE,
    plan_name VARCHAR(50) NOT NULL,
    max_customers INTEGER NOT NULL,
    monthly_price DECIMAL(12,2) NOT NULL,
    features JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 기본 요금제 데이터
INSERT INTO plans (plan_code, plan_name, max_customers, monthly_price, features) VALUES
('free', '무료체험', 10000, 0, '{"trial_days": 30, "api_enabled": false, "ai_enabled": true, "file_upload_only": true}'),
('basic', '베이직', 1000000, 1500000, '{"api_enabled": true, "ai_enabled": true}'),
('pro', '프로', 3000000, 3000000, '{"api_enabled": true, "ai_enabled": true, "priority_support": true}'),
('enterprise', '엔터프라이즈', 999999999, 0, '{"api_enabled": true, "ai_enabled": true, "dedicated_server": true, "custom_price": true}');

-- ============================================
-- 3. 고객사 (회사)
-- ============================================
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 기본 정보
    company_code VARCHAR(20) NOT NULL UNIQUE,
    company_name VARCHAR(100) NOT NULL,
    business_number VARCHAR(20),
    ceo_name VARCHAR(50),
    
    -- 연락처
    contact_name VARCHAR(50),
    contact_email VARCHAR(100),
    contact_phone VARCHAR(20),
    address TEXT,
    
    -- 요금제
    plan_id UUID NOT NULL REFERENCES plans(id),
    plan_started_at TIMESTAMPTZ,
    plan_expires_at TIMESTAMPTZ,
    
    -- QTmsg 연동 (고객사별 Bind ID)
    qtmsg_bind_id VARCHAR(50),
    qtmsg_bind_password VARCHAR(255),
    
    -- DB 연결 정보 (고객사 전용 DB)
    db_host VARCHAR(100) DEFAULT 'localhost',
    db_port INTEGER DEFAULT 5432,
    db_name VARCHAR(50),
    db_status VARCHAR(20) DEFAULT 'pending' CHECK (db_status IN ('pending', 'creating', 'active', 'suspended', 'deleted')),
    
    -- 데이터 입력 방식
    data_input_method VARCHAR(20) DEFAULT 'file' CHECK (data_input_method IN ('file', 'api', 'both')),
    
    -- API 인증 (고객사가 API 호출할 때)
    api_key VARCHAR(100) UNIQUE,
    api_secret VARCHAR(255),
    api_enabled BOOLEAN DEFAULT FALSE,
    
    -- 상태
    status VARCHAR(20) DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'suspended', 'terminated')),
    suspended_reason TEXT,
    
    -- 통계 (캐시용, 배치로 업데이트)
    total_customers INTEGER DEFAULT 0,
    total_messages_sent INTEGER DEFAULT 0,
    last_message_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES super_admins(id)
);

-- ============================================
-- 4. 고객사 필드 매핑 설정
--    (고객사 DB 스키마 → 타겟업 표준 필드)
-- ============================================
CREATE TABLE company_field_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- 매핑 정보
    source_field VARCHAR(100) NOT NULL,      -- 고객사 필드명 (예: CUST_NM, HP_NO)
    target_field VARCHAR(100) NOT NULL,      -- 타겟업 필드명 (예: name, phone)
    
    -- 변환 규칙 (선택)
    transform_type VARCHAR(20),              -- code_map, date_format, number, etc
    transform_rule JSONB,                    -- {"1": "M", "2": "F"} 또는 {"format": "YYYYMMDD"}
    
    -- 메모
    description TEXT,
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(company_id, source_field)
);

-- 표준 필드 목록 (참조용)
COMMENT ON TABLE company_field_mappings IS '
타겟업 표준 필드 목록:
- phone (필수): 전화번호
- name: 고객명
- gender: 성별 (M/F)
- birth_date: 생년월일
- email: 이메일
- address: 주소
- grade: 등급
- points: 포인트
- store_code: 매장코드
- store_name: 매장명
- total_purchase_amount: 총구매금액
- recent_purchase_amount: 최근구매금액
- recent_purchase_date: 최근구매일
- sms_opt_in: 문자수신동의
- custom_1 ~ custom_20: 커스텀필드
';

-- ============================================
-- 5. 구독/결제 이력
-- ============================================
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    plan_id UUID NOT NULL REFERENCES plans(id),
    
    -- 구독 기간
    started_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    
    -- 결제 정보
    amount DECIMAL(12,2) NOT NULL,
    payment_method VARCHAR(20),
    payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
    paid_at TIMESTAMPTZ,
    
    -- 메모
    note TEXT,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES super_admins(id)
);

-- ============================================
-- 6. 정산 내역 (월별)
-- ============================================
CREATE TABLE billings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    
    -- 정산 기간
    billing_year INTEGER NOT NULL,
    billing_month INTEGER NOT NULL,
    
    -- 사용량
    customer_count INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    sms_count INTEGER DEFAULT 0,
    lms_count INTEGER DEFAULT 0,
    mms_count INTEGER DEFAULT 0,
    kakao_count INTEGER DEFAULT 0,
    
    -- 금액
    base_amount DECIMAL(12,2) DEFAULT 0,       -- 기본 요금
    message_amount DECIMAL(12,2) DEFAULT 0,    -- 발송 비용
    discount_amount DECIMAL(12,2) DEFAULT 0,   -- 할인
    tax_amount DECIMAL(12,2) DEFAULT 0,        -- 부가세
    total_amount DECIMAL(12,2) DEFAULT 0,      -- 총액
    
    -- 상태
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'invoiced', 'paid')),
    confirmed_at TIMESTAMPTZ,
    invoiced_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(company_id, billing_year, billing_month)
);

-- ============================================
-- 7. 슈퍼관리자 활동 로그
-- ============================================
CREATE TABLE admin_activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES super_admins(id),
    company_id UUID REFERENCES companies(id),
    
    action VARCHAR(50) NOT NULL,              -- create_company, update_plan, suspend, etc
    target_type VARCHAR(50),                  -- company, subscription, billing
    target_id UUID,
    
    details JSONB,                            -- 상세 정보
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 8. 시스템 설정
-- ============================================
CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES super_admins(id)
);

-- 기본 시스템 설정
INSERT INTO system_settings (key, value, description) VALUES
('sms_unit_price', '{"sms": 9.9, "lms": 27, "mms": 50, "kakao_alim": 7.5, "kakao_friend": 15}', '메시지 단가 (원)'),
('default_trial_days', '30', '무료체험 기본 일수'),
('max_file_upload_size', '52428800', '파일 업로드 최대 크기 (50MB)'),
('supported_file_types', '["xlsx", "xls", "csv", "txt"]', '지원 파일 형식');

-- ============================================
-- 인덱스
-- ============================================
CREATE INDEX idx_companies_status ON companies(status);
CREATE INDEX idx_companies_plan ON companies(plan_id);
CREATE INDEX idx_subscriptions_company ON subscriptions(company_id, started_at DESC);
CREATE INDEX idx_billings_company_period ON billings(company_id, billing_year, billing_month);
CREATE INDEX idx_admin_logs_company ON admin_activity_logs(company_id, created_at DESC);
CREATE INDEX idx_admin_logs_admin ON admin_activity_logs(admin_id, created_at DESC);
CREATE INDEX idx_field_mappings_company ON company_field_mappings(company_id);

-- ============================================
-- 트리거: updated_at 자동 갱신
-- ============================================
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_super_admins_updated BEFORE UPDATE ON super_admins FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_companies_updated BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_billings_updated BEFORE UPDATE ON billings FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_field_mappings_updated BEFORE UPDATE ON company_field_mappings FOR EACH ROW EXECUTE FUNCTION update_timestamp();
