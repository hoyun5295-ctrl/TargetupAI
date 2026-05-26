/**
 * ★ CT-95: Onboarding Wizard — D219+ Part 2 (2026-05-27 신설)
 *
 * 🎯 목적
 *   영업 미팅 후 AI 오퍼레이션 30일 무료체험 부여된 회사 admin이 30분 안 첫 발송 도달 + ROI 측정 활성.
 *   7 step 흐름 + 진행률 저장 + skip 자유 + 재진입 가능.
 *
 *   Harold 명시 본질 (2026-05-26): "강압 X + 사용자 자유 닫기 + 오늘 하루 보지 않기 옵션 (24h cooldown)".
 *
 * 📋 7 step
 *   1. 환영 + 회사 정보 확인
 *   2. 발신번호 + 서류 업로드 (Harold 즉시 검수 + 인증 라인 우선)
 *   3. customer 임포트 + AI 자동 매핑 (CT-96)
 *   4. 세그먼트 자연어 + 매칭 수 + saved_segments INSERT (CT-97)
 *   5. 본문 자연어 → 즉시 본문 생성 + 편집 모드
 *   6. 샘플 발송 (admin 본인 phone + 인증 라인 무료)
 *   7. 매일 9시 자동 인사이트 메일 기본 ON (CT-98)
 *
 * 🗄️ DB 매트릭스 (Harold 직접 PG 실행 의무)
 *   CREATE TABLE onboarding_wizard_state (
 *     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     company_id uuid NOT NULL,
 *     user_id uuid NOT NULL,
 *     current_step int NOT NULL DEFAULT 1,
 *     completed_steps int[] NOT NULL DEFAULT ARRAY[]::int[],
 *     sender_registration_id uuid,
 *     imported_customer_count int DEFAULT 0,
 *     import_column_mapping JSONB,
 *     saved_segment_id uuid,
 *     drafted_message_template text,
 *     drafted_message_subject text,
 *     sample_sent_at timestamptz,
 *     sample_sent_to_phone varchar(20),
 *     daily_insight_enabled BOOLEAN DEFAULT true,
 *     completed_at timestamptz,
 *     created_at timestamptz DEFAULT now(),
 *     updated_at timestamptz DEFAULT now()
 *   );
 *   CREATE INDEX idx_ows_company_user ON onboarding_wizard_state(company_id, user_id);
 *   CREATE INDEX idx_ows_current_step ON onboarding_wizard_state(current_step) WHERE completed_at IS NULL;
 */

import { query } from '../config/database';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface OnboardingState {
  id: string;
  companyId: string;
  userId: string;
  currentStep: number;
  completedSteps: number[];
  senderRegistrationId: string | null;
  importedCustomerCount: number;
  importColumnMapping: any;
  savedSegmentId: string | null;
  draftedMessageTemplate: string | null;
  draftedMessageSubject: string | null;
  sampleSentAt: string | null;
  sampleSentToPhone: string | null;
  dailyInsightEnabled: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveStepData {
  senderRegistrationId?: string;
  importedCustomerCount?: number;
  importColumnMapping?: any;
  savedSegmentId?: string;
  draftedMessageTemplate?: string;
  draftedMessageSubject?: string;
  sampleSentAt?: string;
  sampleSentToPhone?: string;
  dailyInsightEnabled?: boolean;
}

// ════════════════════════════════════════════════════════════════════
// state 관리
// ════════════════════════════════════════════════════════════════════

function rowToState(row: any): OnboardingState {
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    currentStep: Number(row.current_step),
    completedSteps: (row.completed_steps || []).map((n: any) => Number(n)),
    senderRegistrationId: row.sender_registration_id,
    importedCustomerCount: Number(row.imported_customer_count || 0),
    importColumnMapping: row.import_column_mapping,
    savedSegmentId: row.saved_segment_id,
    draftedMessageTemplate: row.drafted_message_template,
    draftedMessageSubject: row.drafted_message_subject,
    sampleSentAt: row.sample_sent_at,
    sampleSentToPhone: row.sample_sent_to_phone,
    dailyInsightEnabled: !!row.daily_insight_enabled,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 사용자 진행률 조회 (없으면 자동 INSERT — step 1 진입).
 */
export async function getOnboardingState(
  companyId: string,
  userId: string,
): Promise<OnboardingState> {
  const existing = await query(
    `SELECT * FROM onboarding_wizard_state WHERE company_id = $1 AND user_id = $2`,
    [companyId, userId],
  );
  if (existing.rows.length > 0) {
    return rowToState(existing.rows[0]);
  }
  // 신규 INSERT
  const created = await query(
    `INSERT INTO onboarding_wizard_state (company_id, user_id, current_step, completed_steps)
     VALUES ($1, $2, 1, ARRAY[]::int[])
     RETURNING *`,
    [companyId, userId],
  );
  return rowToState(created.rows[0]);
}

/**
 * step 데이터 저장 (특정 컬럼만 UPDATE).
 */
export async function saveOnboardingStep(
  companyId: string,
  userId: string,
  stepNum: number,
  data: SaveStepData,
): Promise<OnboardingState> {
  if (stepNum < 1 || stepNum > 7) {
    throw new Error(`잘못된 step 번호: ${stepNum}`);
  }
  await getOnboardingState(companyId, userId); // 행 보장

  const sets: string[] = ['updated_at = NOW()', 'current_step = GREATEST(current_step, $3)'];
  const params: any[] = [companyId, userId, stepNum];
  let idx = 4;

  if (data.senderRegistrationId !== undefined) { sets.push(`sender_registration_id = $${idx++}`); params.push(data.senderRegistrationId); }
  if (data.importedCustomerCount !== undefined) { sets.push(`imported_customer_count = $${idx++}`); params.push(data.importedCustomerCount); }
  if (data.importColumnMapping !== undefined) { sets.push(`import_column_mapping = $${idx++}::jsonb`); params.push(JSON.stringify(data.importColumnMapping)); }
  if (data.savedSegmentId !== undefined) { sets.push(`saved_segment_id = $${idx++}`); params.push(data.savedSegmentId); }
  if (data.draftedMessageTemplate !== undefined) { sets.push(`drafted_message_template = $${idx++}`); params.push(data.draftedMessageTemplate); }
  if (data.draftedMessageSubject !== undefined) { sets.push(`drafted_message_subject = $${idx++}`); params.push(data.draftedMessageSubject); }
  if (data.sampleSentAt !== undefined) { sets.push(`sample_sent_at = $${idx++}`); params.push(data.sampleSentAt); }
  if (data.sampleSentToPhone !== undefined) { sets.push(`sample_sent_to_phone = $${idx++}`); params.push(data.sampleSentToPhone); }
  if (data.dailyInsightEnabled !== undefined) { sets.push(`daily_insight_enabled = $${idx++}`); params.push(data.dailyInsightEnabled); }

  const updated = await query(
    `UPDATE onboarding_wizard_state
        SET ${sets.join(', ')}
      WHERE company_id = $1 AND user_id = $2
    RETURNING *`,
    params,
  );

  return rowToState(updated.rows[0]);
}

/**
 * step 완성 표시 (completed_steps 배열에 추가).
 */
export async function completeOnboardingStep(
  companyId: string,
  userId: string,
  stepNum: number,
): Promise<OnboardingState> {
  if (stepNum < 1 || stepNum > 7) {
    throw new Error(`잘못된 step 번호: ${stepNum}`);
  }
  await getOnboardingState(companyId, userId);

  // current_step 자동 진입 (현재 step보다 1 큰 값까지 자동 진입, 단 7 max)
  const nextStep = Math.min(7, stepNum + 1);
  const updated = await query(
    `UPDATE onboarding_wizard_state
        SET completed_steps = (
              SELECT ARRAY(SELECT DISTINCT unnest(completed_steps || ARRAY[$3]::int[]) ORDER BY 1)
            ),
            current_step = GREATEST(current_step, $4),
            updated_at = NOW()
      WHERE company_id = $1 AND user_id = $2
    RETURNING *`,
    [companyId, userId, stepNum, nextStep],
  );

  return rowToState(updated.rows[0]);
}

/**
 * Wizard 종결 (step 7 완성 + completed_at 기록).
 */
export async function completeOnboarding(
  companyId: string,
  userId: string,
): Promise<OnboardingState> {
  await completeOnboardingStep(companyId, userId, 7);
  const updated = await query(
    `UPDATE onboarding_wizard_state
        SET completed_at = NOW(),
            updated_at = NOW()
      WHERE company_id = $1 AND user_id = $2 AND completed_at IS NULL
    RETURNING *`,
    [companyId, userId],
  );
  return rowToState(updated.rows[0] || (await getOnboardingState(companyId, userId)));
}

// ════════════════════════════════════════════════════════════════════
// AI 오퍼레이션 무료체험 활성 여부
// ════════════════════════════════════════════════════════════════════

/**
 * 회사의 AI 오퍼레이션 30일 무료체험 활성 여부.
 * Phase 1 plan-guard.ts isAiOperatorTrialActive와 동일 매트릭스.
 */
export async function isAiOperatorTrialActive(companyId: string): Promise<{
  active: boolean;
  startedAt: string | null;
  until: string | null;
}> {
  try {
    const res = await query(
      `SELECT ai_operator_trial_started_at, ai_operator_trial_until
         FROM companies WHERE id = $1`,
      [companyId],
    );
    if (res.rows.length === 0) {
      return { active: false, startedAt: null, until: null };
    }
    const row = res.rows[0];
    const until = row.ai_operator_trial_until ? new Date(row.ai_operator_trial_until) : null;
    const active = !!(until && until.getTime() > Date.now());
    return {
      active,
      startedAt: row.ai_operator_trial_started_at,
      until: row.ai_operator_trial_until,
    };
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      // DB ALTER 미실행 = false 안전 default
      return { active: false, startedAt: null, until: null };
    }
    throw err;
  }
}
