-- ================================================================
-- 발신번호 자체 등록 허용 컬럼 추가
-- 실행: docker exec -it targetup-postgres psql -U targetup targetup
-- ================================================================

-- companies 테이블에 allow_callback_self_register 추가 (기본값 false)
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS allow_callback_self_register BOOLEAN DEFAULT false;

-- 확인
SELECT id, company_name, allow_callback_self_register 
FROM companies 
ORDER BY company_name;

-- 특정 고객사 허용 시:
-- UPDATE companies SET allow_callback_self_register = true WHERE id = '해당UUID';
