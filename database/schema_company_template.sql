-- ============================================
-- 고객사 전용 DB 템플릿 (company_XXXXX)
-- 고객사 추가 시 이 스키마로 DB 생성
-- PostgreSQL 15+
-- GPT 리뷰 반영: 수신동의이력, 발신번호검증, 감사로그, PII 분리
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- 1. 사용자 계정 (고객사 내 관리자/사용자)
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    login_id VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    
    -- 역할: admin(고객사 관리자), user(일반 사용자)
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    
    -- 기본 정보
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    phone VARCHAR(20),
    department VARCHAR(100),
    
    -- 상태
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'locked', 'dormant')),
    password_changed_at TIMESTAMPTZ,
    must_change_password BOOLEAN DEFAULT TRUE,
    login_fail_count INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,
    
    -- 접근 제한
    allowed_ips INET[],
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMPTZ
);

-- ============================================
-- 2. 고객 정보 (기본)
-- ============================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 필수
    phone VARCHAR(20) NOT NULL UNIQUE,
    
    -- 기본 정보
    name VARCHAR(100),
    gender VARCHAR(1) CHECK (gender IN ('M', 'F')),
    birth_date DATE,
    email VARCHAR(100),
    
    -- 주소
    address TEXT,
    address_detail TEXT,
    zipcode VARCHAR(10),
    
    -- 등급/포인트
    grade VARCHAR(50),
    points INTEGER DEFAULT 0,
    
    -- 매장 정보
    store_code VARCHAR(50),
    store_name VARCHAR(100),
    
    -- 구매 정보 (집계)
    total_purchase_amount DECIMAL(15,2) DEFAULT 0,
    total_purchase_count INTEGER DEFAULT 0,
    recent_purchase_amount DECIMAL(15,2),
    recent_purchase_date DATE,
    first_purchase_date DATE,
    
    -- 커스텀 필드 (고객사별 자유 사용)
    custom_1 VARCHAR(200),
    custom_2 VARCHAR(200),
    custom_3 VARCHAR(200),
    custom_4 VARCHAR(200),
    custom_5 VARCHAR(200),
    custom_6 VARCHAR(200),
    custom_7 VARCHAR(200),
    custom_8 VARCHAR(200),
    custom_9 VARCHAR(200),
    custom_10 VARCHAR(200),
    custom_11 VARCHAR(200),
    custom_12 VARCHAR(200),
    custom_13 VARCHAR(200),
    custom_14 VARCHAR(200),
    custom_15 VARCHAR(200),
    custom_16 VARCHAR(200),
    custom_17 VARCHAR(200),
    custom_18 VARCHAR(200),
    custom_19 VARCHAR(200),
    custom_20 VARCHAR(200),
    
    -- 추가 데이터 (JSONB)
    extra_data JSONB DEFAULT '{}',
    
    -- 상태
    is_active BOOLEAN DEFAULT TRUE,
    is_invalid_phone BOOLEAN DEFAULT FALSE,
    
    -- 데이터 출처
    source VARCHAR(20) DEFAULT 'file' CHECK (source IN ('file', 'api', 'manual')),
    source_detail VARCHAR(100),
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 3. 수신 동의 이력 (GPT 리뷰 필수)
--    언제/어떻게/누가/어떤 문구로 동의받았는지 증빙
-- ============================================
CREATE TABLE consents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    
    -- 동의 채널
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('sms', 'kakao', 'email', 'all')),
    
    -- 동의 유형
    consent_type VARCHAR(20) NOT NULL CHECK (consent_type IN ('marketing', 'info', 'night')),
    
    -- 상태
    status VARCHAR(20) NOT NULL CHECK (status IN ('opt_in', 'opt_out')),
    
    -- 동의 시점
    consented_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    
    -- 동의 경로
    source VARCHAR(30) CHECK (source IN ('web', 'app', 'offline', 'import', 'api', 'phone')),
    source_detail TEXT,
    
    -- 증빙
    consent_text TEXT,
    proof_ref VARCHAR(200),
    
    -- 처리자
    collected_by_user_id UUID REFERENCES users(id),
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 현재 유효한 동의 상태 뷰
CREATE VIEW current_consents AS
SELECT DISTINCT ON (customer_id, channel, consent_type)
    customer_id, channel, consent_type, status, consented_at, revoked_at
FROM consents
ORDER BY customer_id, channel, consent_type, created_at DESC;

-- ============================================
-- 4. 발신번호 관리 (GPT 리뷰 필수)
--    발신번호 사전등록제 증빙
-- ============================================
CREATE TABLE sender_numbers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    description VARCHAR(200),
    
    -- 검증 정보 (필수)
    is_verified BOOLEAN DEFAULT FALSE,
    verification_method VARCHAR(30),
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES users(id),
    evidence_ref VARCHAR(200),
    
    -- 상태
    is_active BOOLEAN DEFAULT TRUE,
    
    -- 사용 범위
    allowed_user_ids UUID[],
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 5. 카카오 발신프로필
-- ============================================
CREATE TABLE kakao_sender_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    profile_key VARCHAR(100) NOT NULL UNIQUE,
    profile_name VARCHAR(100) NOT NULL,
    sender_key VARCHAR(100),
    
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 6. 카카오 알림톡 템플릿
-- ============================================
CREATE TABLE kakao_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES kakao_sender_profiles(id),
    
    template_code VARCHAR(50),
    template_name VARCHAR(100) NOT NULL,
    
    -- 내용
    content TEXT NOT NULL,
    buttons JSONB DEFAULT '[]',
    variables TEXT[],
    
    -- 메시지 유형 (GPT 리뷰)
    message_purpose VARCHAR(10) CHECK (message_purpose IN ('info', 'ad', 'mixed')),
    
    -- 검수 상태
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'requested', 'approved', 'rejected', 'blocked')),
    reject_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMPTZ
);

-- ============================================
-- 7. 문자 템플릿 보관함
-- ============================================
CREATE TABLE sms_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    
    template_name VARCHAR(100) NOT NULL,
    message_type VARCHAR(10) NOT NULL CHECK (message_type IN ('SMS', 'LMS', 'MMS')),
    
    subject VARCHAR(200),
    content TEXT NOT NULL,
    image_urls TEXT[],
    
    -- 광고 여부
    is_ad BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 8. 캠페인 (발송 묶음)
-- ============================================
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- 캠페인 정보
    campaign_name VARCHAR(200) NOT NULL,
    description TEXT,
    
    -- AI 프롬프트 (타겟업AI 연동)
    user_prompt TEXT,
    ai_mode BOOLEAN DEFAULT FALSE,
    
    -- 타겟 조건 (JSON 저장)
    target_spec JSONB,
    
    -- 발송 정보
    message_type VARCHAR(10) CHECK (message_type IN ('SMS', 'LMS', 'MMS', 'KMS', 'FMS', 'GMS')),
    sender_number_id UUID REFERENCES sender_numbers(id),
    kakao_profile_id UUID REFERENCES kakao_sender_profiles(id),
    kakao_template_id UUID REFERENCES kakao_templates(id),
    
    -- 통계
    total_target_count INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    
    -- 예약
    scheduled_at TIMESTAMPTZ,
    send_rate_per_minute INTEGER,
    
    -- 상태
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
    
    -- 분석 연동
    analysis_start_date DATE,
    analysis_end_date DATE,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMPTZ
);

-- ============================================
-- 9. 메시지 발송 (QTmsg 연동)
--    SMSQ_SEND 테이블과 연동
-- ============================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES campaigns(id),
    customer_id UUID REFERENCES customers(id),
    
    -- 메시지 정보
    message_type VARCHAR(10) NOT NULL CHECK (message_type IN ('SMS', 'LMS', 'MMS', 'KMS', 'FMS', 'GMS')),
    recipient_phone VARCHAR(20) NOT NULL,
    recipient_name VARCHAR(100),
    
    -- 발신 정보
    sender_number VARCHAR(20),
    reply_number VARCHAR(20),
    
    -- 내용
    subject VARCHAR(200),
    content TEXT NOT NULL,
    content_merged TEXT,
    image_urls TEXT[],
    
    -- 카카오
    kakao_template_id UUID REFERENCES kakao_templates(id),
    kakao_buttons JSONB,
    kakao_fallback_type VARCHAR(1),
    kakao_fallback_content TEXT,
    
    -- 광고 준수 (GPT 리뷰)
    is_ad BOOLEAN DEFAULT FALSE,
    ad_sender_name VARCHAR(100),
    ad_opt_out_number VARCHAR(20),
    compliance_checked BOOLEAN DEFAULT FALSE,
    
    -- QTmsg 연동
    qtmsg_seqno BIGINT,
    
    -- 예약
    scheduled_at TIMESTAMPTZ,
    
    -- 상태
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'delivered', 'failed', 'cancelled')),
    
    -- 결과
    result_code VARCHAR(20),
    result_message TEXT,
    mob_company VARCHAR(10),
    
    -- 비용
    charge_amount DECIMAL(10,2),
    
    -- 시간
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (created_at);

-- 월별 파티션 생성 (2026년)
CREATE TABLE messages_2026_01 PARTITION OF messages FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE messages_2026_02 PARTITION OF messages FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE messages_2026_03 PARTITION OF messages FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE messages_2026_04 PARTITION OF messages FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE messages_2026_05 PARTITION OF messages FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE messages_2026_06 PARTITION OF messages FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE messages_2026_07 PARTITION OF messages FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE messages_2026_08 PARTITION OF messages FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE messages_2026_09 PARTITION OF messages FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE messages_2026_10 PARTITION OF messages FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE messages_2026_11 PARTITION OF messages FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE messages_2026_12 PARTITION OF messages FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- ============================================
-- 10. 080 수신거부
-- ============================================
CREATE TABLE opt_outs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    opt_out_number VARCHAR(20) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    
    source VARCHAR(20) DEFAULT 'auto' CHECK (source IN ('auto', 'manual', 'api')),
    
    -- 처리 이력 (GPT 리뷰)
    processed_at TIMESTAMPTZ,
    notified_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(opt_out_number, phone)
);

-- ============================================
-- 11. 구매 내역 (선택, 분석용)
-- ============================================
CREATE TABLE purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES customers(id),
    customer_phone VARCHAR(20) NOT NULL,
    
    purchase_date TIMESTAMPTZ NOT NULL,
    store_code VARCHAR(50),
    store_name VARCHAR(100),
    
    product_code VARCHAR(50),
    product_name VARCHAR(200),
    category_large VARCHAR(100),
    category_medium VARCHAR(100),
    category_small VARCHAR(100),
    
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(15,2),
    total_amount DECIMAL(15,2),
    
    extra_data JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 12. 상품 마스터 (선택, 분석용)
-- ============================================
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    product_code VARCHAR(50) UNIQUE,
    product_name VARCHAR(200) NOT NULL,
    
    category_large VARCHAR(100),
    category_medium VARCHAR(100),
    category_small VARCHAR(100),
    
    price DECIMAL(15,2),
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 13. 감사 로그 (GPT 리뷰)
--    고객 조회/다운로드/발송 실행 기록
-- ============================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    
    action VARCHAR(50) NOT NULL,
    target_type VARCHAR(50),
    target_id UUID,
    
    details JSONB,
    
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 14. 파일 업로드 이력
-- ============================================
CREATE TABLE file_uploads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    file_size INTEGER,
    file_type VARCHAR(20),
    
    -- 처리 결과
    total_rows INTEGER,
    success_rows INTEGER,
    fail_rows INTEGER,
    
    -- 매핑 정보
    column_mapping JSONB,
    
    -- 상태
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

-- ============================================
-- 인덱스
-- ============================================
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_grade ON customers(grade);
CREATE INDEX idx_customers_store ON customers(store_code);
CREATE INDEX idx_customers_recent_purchase ON customers(recent_purchase_date DESC);

CREATE INDEX idx_consents_customer ON consents(customer_id);
CREATE INDEX idx_consents_status ON consents(customer_id, channel, status);

CREATE INDEX idx_messages_campaign ON messages(campaign_id, created_at);
CREATE INDEX idx_messages_customer ON messages(customer_id, created_at);
CREATE INDEX idx_messages_status ON messages(status, scheduled_at);
CREATE INDEX idx_messages_recipient ON messages(recipient_phone, created_at);
CREATE INDEX idx_messages_qtmsg ON messages(qtmsg_seqno);

CREATE INDEX idx_purchases_customer ON purchases(customer_id, purchase_date DESC);
CREATE INDEX idx_purchases_date ON purchases(purchase_date DESC);
CREATE INDEX idx_purchases_product ON purchases(product_code);

CREATE INDEX idx_opt_outs_phone ON opt_outs(phone);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);

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

CREATE TRIGGER tr_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_consents_updated BEFORE UPDATE ON consents FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_sender_numbers_updated BEFORE UPDATE ON sender_numbers FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_kakao_profiles_updated BEFORE UPDATE ON kakao_sender_profiles FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_kakao_templates_updated BEFORE UPDATE ON kakao_templates FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_sms_templates_updated BEFORE UPDATE ON sms_templates FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_campaigns_updated BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_timestamp();
