-- ============================================
-- Target-UP Schema 추가분
-- Gemini 분석 피드백 반영 (2026-01-29)
-- ============================================

-- ============================================
-- 1. 메시지 타입에 RCS 추가
-- ============================================

-- 기존 messages 테이블의 CHECK 제약 수정
-- message_type: SMS, LMS, MMS, KMS, FMS, GMS + RCS 추가

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_message_type_check 
    CHECK (message_type IN ('SMS', 'LMS', 'MMS', 'KMS', 'FMS', 'GMS', 'RCS'));

-- ============================================
-- 2. 발신번호 서류 관리 (사전등록제 강화)
-- ============================================

-- 발신번호 등록 서류
CREATE TABLE sender_number_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_number_id UUID NOT NULL REFERENCES sender_numbers(id) ON DELETE CASCADE,
    
    -- 서류 종류
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN (
        'business_license',      -- 사업자등록증
        'telecom_certificate',   -- 통신서비스 가입증명원
        'power_of_attorney',     -- 위임장 (대리 등록 시)
        'id_card',               -- 신분증 사본
        'other'                  -- 기타
    )),
    
    -- 파일 정보
    file_name VARCHAR(200) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER,
    
    -- 검증 상태
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
        'pending',    -- 검토 대기
        'approved',   -- 승인
        'rejected'    -- 반려
    )),
    
    reject_reason TEXT,
    verified_at TIMESTAMP,
    verified_by UUID REFERENCES users(id),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP  -- 서류 유효기간
);

CREATE INDEX idx_sender_docs_number ON sender_number_documents(sender_number_id);

-- ============================================
-- 3. 실시간 수신거부 동기화 로그
-- ============================================

-- 080 수신거부 동기화 이력
CREATE TABLE opt_out_sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    
    sync_type VARCHAR(20) NOT NULL CHECK (sync_type IN (
        'full',       -- 전체 동기화
        'realtime'    -- 실시간 동기화
    )),
    
    -- 동기화 결과
    total_count INTEGER DEFAULT 0,
    added_count INTEGER DEFAULT 0,
    removed_count INTEGER DEFAULT 0,
    
    status VARCHAR(20) DEFAULT 'running' CHECK (status IN (
        'running',
        'completed',
        'failed'
    )),
    
    error_message TEXT,
    
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- 마지막 동기화 시간 빠르게 조회용
CREATE INDEX idx_opt_out_sync_company ON opt_out_sync_logs(company_id, started_at DESC);

-- ============================================
-- 4. 시스템 설정 (동적 설정값)
-- ============================================

-- 회사별 시스템 설정
CREATE TABLE company_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT NOT NULL,
    setting_type VARCHAR(20) DEFAULT 'string' CHECK (setting_type IN (
        'string', 'number', 'boolean', 'json'
    )),
    
    description VARCHAR(500),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(company_id, setting_key)
);

-- 기본 설정값 삽입 예시
-- INSERT INTO company_settings (company_id, setting_key, setting_value, setting_type, description)
-- VALUES 
--   ('{company_id}', 'reservation_cancel_minutes', '10', 'number', '예약 취소 가능 시간(분)'),
--   ('{company_id}', 'alarm_threshold', '30000', 'number', '발송 알람 기준 건수'),
--   ('{company_id}', 'max_concurrent_sessions', '5', 'number', '동시 접속 허용 수'),
--   ('{company_id}', 'opt_out_sync_interval', '60', 'number', '수신거부 동기화 주기(초)');

-- ============================================
-- 5. 사용자 세션 관리 (동시 접속 제어)
-- ============================================

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    session_token VARCHAR(500) NOT NULL UNIQUE,
    
    -- 접속 정보
    ip_address VARCHAR(50),
    user_agent TEXT,
    device_type VARCHAR(20),  -- web, mobile, api
    
    -- 상태
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id, is_active);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);

-- ============================================
-- 6. RCS 템플릿 관리
-- ============================================

CREATE TABLE rcs_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    
    -- RCS 브랜드 정보
    brand_id VARCHAR(100) NOT NULL,
    brand_name VARCHAR(100),
    
    -- 템플릿 정보
    template_id VARCHAR(100),  -- RCS 템플릿 ID
    template_name VARCHAR(100) NOT NULL,
    
    -- 메시지 유형
    message_type VARCHAR(20) NOT NULL CHECK (message_type IN (
        'SMS',           -- RCS SMS (단문)
        'LMS',           -- RCS LMS (장문)
        'MMS',           -- RCS MMS (이미지)
        'CAROUSEL',      -- 캐러셀
        'TEMPLATE'       -- 템플릿 메시지
    )),
    
    content TEXT NOT NULL,
    
    -- 리치 콘텐츠
    media_url VARCHAR(500),
    buttons JSONB DEFAULT '[]',
    
    -- 검수 상태
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN (
        'draft', 'requested', 'approved', 'rejected'
    )),
    
    reject_reason TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP
);

CREATE INDEX idx_rcs_templates_company ON rcs_templates(company_id, status);

-- ============================================
-- 7. 전송 자격 인증 정보 (KISA)
-- ============================================

CREATE TABLE transmission_certifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id),
    
    -- 인증 정보
    certification_number VARCHAR(100) NOT NULL,  -- 인증 번호
    certification_type VARCHAR(50) NOT NULL,     -- 인증 유형
    
    issued_by VARCHAR(100) DEFAULT 'KISA',
    issued_at DATE NOT NULL,
    expires_at DATE NOT NULL,
    
    -- 인증서 파일
    certificate_file_path VARCHAR(500),
    
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(company_id, certification_type)
);
