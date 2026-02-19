-- ============================================================
-- ai_training_logs: 한줄로 AI 학습용 비식별 데이터 수집 테이블
-- ============================================================
-- 목적: 캠페인 발송 데이터를 비식별화하여 축적
--       → 향후 인비토AI (메시징 특화 모델) 학습 데이터셋으로 활용
-- 적재: (1) 캠페인 발송 완료 시 INSERT
--       (2) 결과 동기화 완료 시 성과 컬럼 UPDATE + metrics_updated_at 갱신
-- 원칙: 고객사/수신자 역추적 불가. 이용약관에 비식별 활용 조항 포함.
-- 주의: tenant_ref, source_ref는 학습 데이터 반출 시 제거
--       → ai_training_logs_export 뷰를 통해 반출할 것
-- 생성일: 2026-02-19
-- 설계: Claude + GPT + Gemini 3자 토론 → Harold 최종 확정
-- ============================================================

CREATE TABLE ai_training_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ▶ 중복 적재 방지: campaign_run_id 등을 HMAC 해시하여 저장
  --   리트라이/웹훅 중복 시 DB 레벨에서 차단 (NOT NULL 강제)
  source_ref            varchar(64) NOT NULL,

  -- ▶ 비식별 컨텍스트: 어떤 업종/톤에서 발송됐는지 (고객사 특정 불가)
  tenant_ref            varchar(64),          -- HMAC 해시된 고객사 식별자 (운영 디버깅용, 반출 시 제거)
  industry_code         varchar(50),          -- 업종코드 (beauty, fashion, food, medical 등)
  brand_tone            varchar(50),          -- 브랜드 톤 (friendly, formal, casual 등)

  -- ▶ 입력: 사용자가 뭘 요청했고, AI가 어떤 타겟을 잡았는지
  user_prompt           text,                 -- 사용자 자연어 입력 (브랜드명 마스킹 후)
  target_filter         jsonb,                -- AI가 생성한 타겟 조건 (그 시점의 스냅샷)
  target_count          integer,              -- 추출된 대상자 수
  segment_key           varchar(50),          -- 타겟 세그먼트 유형 (new/dormant/loyal/vip 등)

  -- ▶ 메시지 + 선호 데이터: DPO 학습의 핵심
  --   AI 제안 후보 전체 + 사용자 선택 → 혼입변수 없는 깨끗한 선호 신호
  message_type          varchar(10),          -- SMS / LMS / MMS / KAKAO
  is_ad                 boolean,              -- 광고성 메시지 여부
  candidates            jsonb,                -- AI 제안 전체 배열, 각 원소 구조:
                                              -- {
                                              --   "candidate_id": "c1",
                                              --   "text": "마스킹된 메시지 본문",
                                              --   "features": {
                                              --     "emoji_count": 2,        ← deterministic (코드 계산)
                                              --     "sentence_count": 3,     ← deterministic
                                              --     "char_length": 85,       ← deterministic
                                              --     "has_link": true,        ← deterministic
                                              --     "has_phone_cta": false,  ← deterministic
                                              --     "cta_type": "link",      ← deterministic (URL/전화/방문 패턴)
                                              --     "first_sentence_pattern": "benefit"  ← model label (혜택/공감/질문)
                                              --   }
                                              -- }
  selected_candidate_id varchar(32),          -- 사용자가 선택한 candidate_id (index 대신 안정키)
  final_message         text,                 -- 최종 발송 메시지 (마스킹 후, 사용자 편집 반영)
  final_source          varchar(20),          -- selected_as_is: AI 제안 그대로 발송
                                              -- edited: 사용자가 수정 후 발송
                                              -- manual: 사용자가 직접 작성 (AI 미사용)

  -- ▶ 메시지 구조 분석용 메타 (최종 발송 메시지 기준, deterministic + model label 이원화)
  message_features      jsonb,                -- deterministic: emoji_count, sentence_count, char_length,
                                              --                byte_length, has_link, has_phone_cta, cta_type
                                              -- model_label: first_sentence_pattern, tone_category

  -- ▶ 성과 데이터: 결과 동기화 완료 시 UPDATE
  --   success_rate는 저장하지 않음 → sent/success로 조회 시 계산 (파생값 불일치 방지)
  sent_count            integer,
  success_count         integer,
  fail_count            integer,
  spam_blocked          integer DEFAULT 0,    -- 스팸 차단 수 (통신사 필터링)

  -- ▶ 발송 시점: 원본 타임스탬프 저장 → day/hour/month는 조회 시 EXTRACT로 계산
  send_at               timestamptz,          -- 실제 발송 시각

  -- ▶ 버전 추적: 동일 데이터라도 버전이 다르면 결과가 다름 → 재현성 핵심
  prompt_version        varchar(20),          -- AI 프롬프트 버전 (예: v1, v2, v3)
  persona_version       varchar(20),          -- 브랜드 페르소나 설정 버전
  policy_version        varchar(20),          -- 가드레일/정책 룰셋 버전
  model_id              varchar(50),          -- AI 모델 (예: claude-sonnet-4-20250514)
  model_params          jsonb,                -- 모델 파라미터 {temperature, top_p, max_tokens 등}

  -- ▶ 가드레일 액션 로그: 어떤 자동 조치가 적용됐는지 (CS/감사/분석용)
  guardrail_actions     jsonb,                -- {
                                              --   "status": "passed",
                                              --   "actions": ["insert_ad_label", "append_optout_080"],
                                              --   "flags": []
                                              -- }

  -- ▶ 마스킹 추적: 마스킹 로직 변경 시 텍스트 분포 변화 → 학습 품질에 직접 영향
  redaction_version     varchar(20),          -- 마스킹 로직 버전 (예: v1_regex, v2_pii_model)

  -- ▶ 타임스탬프
  created_at            timestamptz DEFAULT NOW(),
  metrics_updated_at    timestamptz,          -- 성과 데이터 동기화 시각 (NULL이면 아직 미수신)

  -- ▶ 데이터 무결성 제약: 값이 정해진 컬럼은 DB에서 강제
  CONSTRAINT ck_training_final_source CHECK (
    final_source IN ('selected_as_is', 'edited', 'manual')
  ),
  CONSTRAINT ck_training_message_type CHECK (
    message_type IN ('SMS', 'LMS', 'MMS', 'KAKAO')
  ),
  CONSTRAINT ck_training_counts_nonneg CHECK (
    (sent_count    IS NULL OR sent_count    >= 0) AND
    (success_count IS NULL OR success_count >= 0) AND
    (fail_count    IS NULL OR fail_count    >= 0) AND
    (spam_blocked  IS NULL OR spam_blocked  >= 0)
  ),

  -- ▶ JSONB 타입 검증: 잘못된 형태의 JSON이 들어오는 것을 DB 레벨에서 차단
  CONSTRAINT ck_training_target_filter_is_object CHECK (
    target_filter IS NULL OR jsonb_typeof(target_filter) = 'object'
  ),
  CONSTRAINT ck_training_candidates_is_array CHECK (
    candidates IS NULL OR jsonb_typeof(candidates) = 'array'
  ),
  CONSTRAINT ck_training_message_features_is_object CHECK (
    message_features IS NULL OR jsonb_typeof(message_features) = 'object'
  ),
  CONSTRAINT ck_training_model_params_is_object CHECK (
    model_params IS NULL OR jsonb_typeof(model_params) = 'object'
  ),
  CONSTRAINT ck_training_guardrail_actions_is_object CHECK (
    guardrail_actions IS NULL OR jsonb_typeof(guardrail_actions) = 'object'
  )
);

-- ============================================================
-- 인덱스
-- ============================================================
CREATE UNIQUE INDEX ux_training_source_ref       ON ai_training_logs(source_ref);                                           -- 중복 적재 방지
CREATE INDEX idx_training_industry               ON ai_training_logs(industry_code);                                        -- 업종별 분석
CREATE INDEX idx_training_msg_type               ON ai_training_logs(message_type);                                         -- 채널별 분석
CREATE INDEX idx_training_send_at                ON ai_training_logs(send_at);                                              -- 시간대별 분석
CREATE INDEX idx_training_tenant                 ON ai_training_logs(tenant_ref);                                           -- 운영 디버깅용
CREATE INDEX idx_training_created                ON ai_training_logs(created_at);                                           -- 적재 순서
CREATE INDEX idx_training_metrics_pending        ON ai_training_logs(created_at) WHERE metrics_updated_at IS NULL;           -- 성과 미수신 건 빠른 조회

-- ============================================================
-- 학습 데이터 반출용 뷰: tenant_ref, source_ref 자동 제외
-- 학습 데이터를 외부로 내보낼 때는 반드시 이 뷰를 사용할 것
-- ============================================================
CREATE VIEW ai_training_logs_export AS
SELECT
  id,
  industry_code, brand_tone,
  user_prompt, target_filter, target_count, segment_key,
  message_type, is_ad, candidates, selected_candidate_id,
  final_message, final_source,
  message_features,
  sent_count, success_count, fail_count, spam_blocked,
  send_at,
  prompt_version, persona_version, policy_version,
  model_id, model_params,
  guardrail_actions,
  redaction_version,
  created_at, metrics_updated_at
FROM ai_training_logs;
