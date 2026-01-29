-- ============================================
-- Target-UP Database Schema
-- PostgreSQL 15+
-- Created: 2026-01-29
-- ============================================

-- 확장 기능 활성화
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- 1. 사용자 및 인증
-- ============================================

-- 고객사 (타겟업을 사용하는 기업)
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    business_number VARCHAR(20),  -- 사업자번호
    
    -- 080 수신거부 번호
    opt_out_080_number VARCHAR(20),
    
    -- 발신번호 사전등록 여부
    sender_number_preregistered BOOLEAN DEFAULT FALSE,
    
    -- 분석자료 설정
    basic_analysis_url VARCHAR(400),
    premium_analysis_enabled BOOLEAN DEFAULT FALSE,
    premium_analysis_url VARCHAR(400),
    print_url VARCHAR(400),
    
    -- 알람 설정 (30,000건 이상 발송 시)
    alarm_threshold INTEGER DEFAULT 30000,
    
    -- 상품정보 사용 설정
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
    
    -- 사용자 유형
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('admin', 'user')),
    
    -- 담당자 정보
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    phone VARCHAR(20),
    department VARCHAR(100),
    
    -- 계정 상태
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'locked', 'dormant')),
    password_changed_at TIMESTAMP,
    must_change_password BOOLEAN DEFAULT TRUE,
    
    -- 접속 제한
    allowed_ips TEXT[],  -- 허용 IP 목록 (유사IP 지원: '120.2.1.*')
    
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
    
    -- 사용자당 최대 10개 제한은 애플리케이션에서 처리
    UNIQUE(user_id, phone)
);

-- ============================================
-- 2. 고객 데이터 (동적 스키마 지원)
-- ============================================

-- 고객정보 기본 테이블
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    
    -- 필수 필드
    phone VARCHAR(20) NOT NULL,  -- 핸드폰번호 (key)
    name VARCHAR(100),
    
    -- 표준 필드 (기획서 기반)
    gender VARCHAR(10),  -- 성별
    birth_date DATE,  -- 생일
    age INTEGER,
    email VARCHAR(100),
    address TEXT,
    
    -- 등급/멤버십
    grade VARCHAR(50),  -- VIP, Gold 등
    points INTEGER DEFAULT 0,
    
    -- 매장 관련
    store_code VARCHAR(50),  -- 매장코드
    registered_store VARCHAR(100),  -- 등록매장
    registered_store_number VARCHAR(50),  -- 등록매장번호
    registration_type VARCHAR(50),  -- 등록구분
    
    -- 구매 관련 집계
    recent_purchase_amount DECIMAL(15,2),
    recent_purchase_store VARCHAR(100),
    total_purchase_amount DECIMAL(15,2),
    
    -- 기념일
    wedding_anniversary DATE,
    is_married BOOLEAN,
    
    -- 수신 동의
    sms_opt_in BOOLEAN DEFAULT TRUE,
    
    -- 동적 필드 (고객사별 커스텀)
    custom_fields JSONB DEFAULT '{}',
    
    -- 상태
    is_opt_out BOOLEAN DEFAULT FALSE,  -- 수신거부
    is_invalid BOOLEAN DEFAULT FALSE,  -- 오류번호
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(company_id, phone)
);

-- 고객정보 동적 필드 정의 (관리자가 설정)
CREATE TABLE customer_field_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    
    field_key VARCHAR(50) NOT NULL,  -- custom_fields의 키
    field_label VARCHAR(100) NOT NULL,  -- 화면 표시명
    field_type VARCHAR(20) NOT NULL CHECK (field_type IN ('INT', 'VARCHAR', 'DATE', 'BOOLEAN')),
    field_size INTEGER,  -- VARCHAR 사이즈
    
    -- 검색 조건 팝업 타입 (기획서 5가지)
    search_popup_type VARCHAR(30) CHECK (search_popup_type IN (
        'checkbox',           -- 체크박스
        'checkbox_range',     -- 체크박스+범위검색
        'listbox_search',     -- 리스트박스+검색
        'searchbox',          -- 검색박스
        'product_info'        -- 상품정보
    )),
    
    is_key BOOLEAN DEFAULT FALSE,  -- 키값 여부
    is_hidden BOOLEAN DEFAULT FALSE,  -- 숨김 여부
    display_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(company_id, field_key)
);

-- 구매내역
CREATE TABLE purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    customer_id UUID REFERENCES customers(id),
    customer_phone VARCHAR(20) NOT NULL,  -- 고객 연결 안 되어도 저장
    
    purchase_date TIMESTAMP NOT NULL,
    store_code VARCHAR(50),
    store_name VARCHAR(100),
    
    -- 상품 정보
    product_id UUID REFERENCES products(id),
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
    
    -- 대/중/소분류
    category_large VARCHAR(100),
    category_medium VARCHAR(100),
    category_small VARCHAR(100),
    
    price DECIMAL(15,2),
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(company_id, product_code)
);

-- ============================================
-- 3. 발송 관리
-- ============================================

-- 발신번호 관리
CREATE TABLE sender_numbers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID REFERENCES users(id),  -- NULL이면 전체 공용
    
    phone_number VARCHAR(20) NOT NULL,
    description VARCHAR(200),
    
    is_verified BOOLEAN DEFAULT FALSE,  -- 사전등록 검증 여부
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(company_id, phone_number)
);

-- 카카오 발신프로필 (알림톡용)
CREATE TABLE kakao_sender_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    
    profile_key VARCHAR(100) NOT NULL,  -- 카카오 발신프로필 키
    profile_name VARCHAR(100) NOT NULL,
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(company_id, profile_key)
);

-- 발신프로필-사용자 매핑 (여러 사용자에게 부여 가능)
CREATE TABLE user_sender_profiles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES kakao_sender_profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, profile_id)
);

-- 프로젝트 (발송 묶음 단위)
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    project_name VARCHAR(200) NOT NULL,
    
    -- 분석 설정
    analysis_start_date DATE,
    analysis_end_date DATE,
    
    -- 통계
    total_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 메시지 발송 테이블 (파티션 적용)
CREATE TABLE messages (
    id UUID DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL,
    project_id UUID NOT NULL,
    user_id UUID NOT NULL,
    
    -- 메시지 타입
    message_type VARCHAR(10) NOT NULL CHECK (message_type IN (
        'SMS', 'LMS', 'MMS',  -- 문자
        'KMS',  -- 알림톡
        'FMS',  -- 친구톡
        'GMS'   -- 친구톡 이미지
    )),
    
    -- 수신자 정보
    recipient_phone VARCHAR(20) NOT NULL,
    recipient_name VARCHAR(100),
    merge_data JSONB DEFAULT '{}',  -- 머지용 데이터 (기타1~6 등)
    
    -- 발신 정보
    sender_number VARCHAR(20),
    reply_number VARCHAR(20),  -- 개별 회신번호
    
    -- 메시지 내용
    subject VARCHAR(200),  -- LMS/MMS 제목
    content TEXT NOT NULL,
    content_merged TEXT,  -- 머지 적용된 최종 내용
    
    -- MMS/GMS 이미지
    image_urls TEXT[],  -- 최대 3개
    
    -- 카카오 관련
    template_id UUID,
    kakao_profile_id UUID,
    kakao_buttons JSONB,  -- 버튼 정보
    
    -- 대체 발송 설정
    fallback_enabled BOOLEAN DEFAULT FALSE,  -- 카톡 실패 시 문자 발송
    fallback_message_id UUID,  -- 대체 발송된 문자 ID
    
    -- 발송 스케줄
    scheduled_at TIMESTAMP,  -- 예약 시간 (NULL이면 즉시)
    send_rate_per_minute INTEGER,  -- 분할전송 (분당 건수)
    
    -- 상태
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
        'pending',      -- 전송대기
        'sending',      -- 전송중
        'sent',         -- 전송완료
        'delivered',    -- 수신확인
        'failed',       -- 실패
        'cancelled'     -- 취소
    )),
    
    -- 결과
    result_code VARCHAR(20),
    result_message TEXT,
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    
    -- 비용
    charge_amount DECIMAL(10,2),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- 월별 파티션 생성 (예시: 2026년)
CREATE TABLE messages_2026_01 PARTITION OF messages
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE messages_2026_02 PARTITION OF messages
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE messages_2026_03 PARTITION OF messages
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
-- ... 나머지 월도 동일하게 생성

-- ============================================
-- 4. 템플릿 관리
-- ============================================

-- 알림톡 템플릿
CREATE TABLE kakao_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    profile_id UUID NOT NULL REFERENCES kakao_sender_profiles(id),
    
    template_code VARCHAR(50),  -- 카카오 템플릿 코드
    template_name VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,  -- 최대 1000자
    
    -- 버튼 (최대 5개)
    buttons JSONB DEFAULT '[]',
    /*
    버튼 구조:
    [
        {
            "type": "WL",  -- DS:배송조회, WL:웹링크, AL:앱링크, BK:봇키워드, MD:메시지전달
            "name": "버튼명",
            "url_pc": "PC URL",
            "url_mobile": "모바일 URL"
        }
    ]
    */
    
    -- 가변값 정보
    variables TEXT[],  -- ['#{이름}', '#{주문번호}']
    
    -- 검수 상태
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN (
        'draft',        -- 작성중
        'requested',    -- 검수요청
        'approved',     -- 승인
        'rejected',     -- 반려
        'blocked'       -- 차단
    )),
    
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
    image_url VARCHAR(500),  -- 카카오 등록 후 URL
    
    -- 원본 이미지 정보
    original_filename VARCHAR(200),
    file_size INTEGER,  -- bytes
    width INTEGER,
    height INTEGER,
    
    status VARCHAR(20) DEFAULT 'requested' CHECK (status IN (
        'requested',  -- 등록요청
        'approved',   -- 승인
        'rejected'    -- 반려
    )),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);

-- 문자 템플릿 (보관함)
CREATE TABLE sms_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    template_name VARCHAR(100) NOT NULL,
    message_type VARCHAR(10) NOT NULL CHECK (message_type IN ('SMS', 'LMS', 'MMS')),
    
    subject VARCHAR(200),  -- LMS/MMS
    content TEXT NOT NULL,
    image_urls TEXT[],  -- MMS
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Mobile DM 요청
CREATE TABLE mobile_dm_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    dm_sample_id VARCHAR(50),  -- 선택한 샘플
    
    -- 요청 이미지 (최대 10개)
    request_images TEXT[],
    request_note TEXT,
    
    -- 완성된 DM
    completed_url VARCHAR(500),
    
    status VARCHAR(20) DEFAULT 'requested' CHECK (status IN (
        'requested',   -- 요청
        'processing',  -- 제작중
        'completed'    -- 완료
    )),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- ============================================
-- 5. 수신거부 관리
-- ============================================

-- 080 수신거부 목록
CREATE TABLE opt_outs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    opt_out_number VARCHAR(20) NOT NULL,  -- 080 번호
    
    phone VARCHAR(20) NOT NULL,
    
    -- 등록 방식
    source VARCHAR(20) DEFAULT 'auto' CHECK (source IN (
        'auto',    -- 자동 (080 전화)
        'manual'   -- 직접 입력
    )),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(company_id, opt_out_number, phone)
);

-- ============================================
-- 6. 인덱스
-- ============================================

-- 고객 검색
CREATE INDEX idx_customers_company_phone ON customers(company_id, phone);
CREATE INDEX idx_customers_company_name ON customers(company_id, name);
CREATE INDEX idx_customers_custom_fields ON customers USING GIN (custom_fields);

-- 메시지 검색
CREATE INDEX idx_messages_project ON messages(project_id, created_at);
CREATE INDEX idx_messages_user ON messages(user_id, created_at);
CREATE INDEX idx_messages_status ON messages(status, scheduled_at);
CREATE INDEX idx_messages_recipient ON messages(recipient_phone, created_at);

-- 템플릿
CREATE INDEX idx_kakao_templates_company ON kakao_templates(company_id, status);

-- 수신거부
CREATE INDEX idx_opt_outs_phone ON opt_outs(company_id, phone);

-- ============================================
-- 7. 트리거 (updated_at 자동 갱신)
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
