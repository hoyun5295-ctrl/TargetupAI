/**
 * ★ CT-28: Continuous Agentic Operator 컨트롤타워 — D176 (2026-05-19)
 *
 * 🎯 목적
 *   한줄로 BEYOND BRAZE 비전 압축 로드맵 1순위 — "AI가 매일 회고 + 제안서 박음 / 실행은 사용자 동의 후".
 *   - 회사 admin이 자연어 한 줄로 영구 운영 목표 박음 ("VIP 재구매 영구 운영")
 *   - 매일 09:00 KST worker가 활성 Operator의 제안서 박음
 *   - 사용자가 받은 제안서 일괄 승인 / 개별 승인 / 거부 박음
 *   - ENT 자동 실행 옵션 활성 + 임계값 통과 시에만 AI가 자동 실행 (default OFF)
 *
 * ⛔ 영구 원칙 (Harold 명시 100% 정합)
 *   - AI는 의견을 박을 뿐, 실행은 항상 사용자 동의 후
 *   - 자동 실행은 default OFF (ENT 명시 ON + 1,000건/5만원/low risk 임계값 통과 시만)
 *   - 자동 실행 시에도 회사 admin에게 즉시 SMS/이메일 알림 (사후 통지)
 *   - 타겟 매칭 0건이면 제안서 박지 X (Zero-Count 영구 원칙)
 *   - 7일 후 미응답 제안서는 expired 박음 (방치 차단)
 *
 * 📊 사용 흐름
 *   1. 사용자: createOperator(companyId, name, objective) → DB INSERT
 *   2. Worker:매일 09:00 KST → listActiveOperators() → 각 Operator에 대해 generateProposal()
 *   3. AI: orchestrate() 호출하여 OrchestratorResult 생성 → operator_proposals INSERT
 *   4. Auto-Execute 임계값 체크 (ENT 옵션) → 통과 시 즉시 발송 + 사후 통지 / 미통과 시 status='pending'
 *   5. 사용자: GET /api/ai/operator/proposals → 대기 중인 제안서 목록 박음
 *   6. 사용자: POST /api/ai/operator/proposals/:id/approve → 승인 + 발송 → status='approved'
 *   7. 사용자: POST /api/ai/operator/proposals/:id/reject → 거부 → status='rejected'
 */

import { query } from '../config/database';
import { orchestrate } from '../services/ai-orchestrator';
import { getCompanyCosts } from '../config/defaults';
// ★ D177 (2026-05-19): Self-Optimizing Bandit — message variants 박음 + Thompson Sampling
import { insertProposalVariants } from './bandit-optimizer';
// ★ D212+ 정책 (2026-05-23 Harold 명시): CT-64 영역 통합 — 스팸필터테스트 + 검증 영역 + 담당자 학습
import { spamTestWithRetry, isAutoSendAllowed, recordAdminStopLearning } from './continuous-operator-policy';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type OperatorSchedule = 'daily' | 'weekly' | 'monthly';
export type OperatorStatus = 'active' | 'paused' | 'archived';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'auto_executed' | 'expired';

export interface CreateOperatorInput {
  companyId: string;
  createdBy: string;
  name: string;
  objective: string;
  schedule?: OperatorSchedule;
  scheduleTime?: string;  // HH:mm KST, default 09:00
}

export interface ContinuousOperator {
  id: string;
  companyId: string;
  createdBy: string | null;
  name: string;
  objective: string;
  schedule: OperatorSchedule;
  scheduleTime: string;
  status: OperatorStatus;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  totalProposals: number;
  totalApproved: number;
  totalRejected: number;
  totalAutoExecuted: number;
  createdAt: Date;
  // ★ D212+ 5번 (2026-05-23 Harold 명시): 비용 제어 강화 — 월 예산 + 일별 한도 + 알림 임계값
  budgetMonthly: number | null;       // 월 예산 (원) — null = 무제한
  budgetDaily: number | null;          // 일별 한도 (원) — null = 무제한
  budgetAlertThreshold: number;        // 알림 임계값 % (default 80)
  budgetSpentMonth: number;            // 이번 달 누적 사용 (원) — auto-computed
  budgetSpentToday: number;            // 오늘 누적 사용 (원) — auto-computed
  // ★ D212+ 정책 (2026-05-23 Harold 명시): 발송 정책 + 검증 + 담당자 옵트아웃 + 스팸 임계값
  deliveryPolicy: 'daily' | 'weekly' | 'monthly';   // default 'daily'
  verificationRequiredDays: number;                 // default 7 (daily 영역 검증 의무 일수)
  verificationPassedDays: number;                   // 검증 통과 누적 일수
  adminPhoneNumbers: string[];                      // 담당자 영역 (1~3명)
  backupAdminPhone: string | null;                  // 백업 담당자 (휴가 영역)
  adminAlertChannel: 'sms' | 'kakao' | 'email';     // default 'sms'
  optOutMinutes: number;                            // default 5 (담당자 옵트아웃)
  spamScoreThreshold: number;                       // default 30
  maxSpamRetries: number;                           // default 3
}

export interface OperatorProposal {
  id: string;
  operatorId: string;
  companyId: string;
  proposalJson: Record<string, unknown>;
  recipientCount: number;
  costEstimate: number;
  status: ProposalStatus;
  autoExecuted: boolean;
  autoExecuteReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  campaignId: string | null;
  expiresAt: Date;
  createdAt: Date;
  operatorName?: string;
  operatorObjective?: string;
}

// ════════════════════════════════════════════════════════════════════
// CRUD — Operator
// ════════════════════════════════════════════════════════════════════

export async function createOperator(input: CreateOperatorInput): Promise<ContinuousOperator> {
  if (!input.name || !input.objective) {
    throw new Error('name과 objective는 필수입니다.');
  }
  if (input.objective.trim().length < 5) {
    throw new Error('objective는 5자 이상 입력해주세요.');
  }
  const schedule: OperatorSchedule = ['daily', 'weekly', 'monthly'].includes(input.schedule || '') ? input.schedule! : 'daily';
  const scheduleTime = input.scheduleTime || '09:00';
  const nextRunAt = computeNextRun(schedule, scheduleTime);

  const result = await query(
    `INSERT INTO continuous_operators (
      id, company_id, created_by, name, objective,
      schedule, schedule_time, status, next_run_at,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3, $4,
      $5, $6, 'active', $7,
      NOW(), NOW()
    ) RETURNING *`,
    [input.companyId, input.createdBy, input.name, input.objective.trim(), schedule, scheduleTime, nextRunAt]
  );
  return mapRowToOperator(result.rows[0]);
}

export async function listOperators(companyId: string): Promise<ContinuousOperator[]> {
  // ★ D212+ 5번 (2026-05-23 Harold 명시): budget_spent_month + budget_spent_today 영역 sub-query
  const result = await query(
    `SELECT o.*,
       COALESCE((
         SELECT SUM(cost_estimate) FROM operator_proposals
         WHERE operator_id = o.id
           AND created_at >= date_trunc('month', NOW())
           AND status IN ('approved', 'auto_executed')
       ), 0) AS budget_spent_month,
       COALESCE((
         SELECT SUM(cost_estimate) FROM operator_proposals
         WHERE operator_id = o.id
           AND created_at >= CURRENT_DATE
           AND status IN ('approved', 'auto_executed')
       ), 0) AS budget_spent_today
     FROM continuous_operators o
     WHERE o.company_id = $1::uuid AND o.status != 'archived'
     ORDER BY o.status DESC, o.created_at DESC`,
    [companyId]
  );
  return result.rows.map(mapRowToOperator);
}

export async function updateOperator(
  companyId: string,
  operatorId: string,
  patch: {
    name?: string;
    objective?: string;
    schedule?: OperatorSchedule;
    scheduleTime?: string;
    status?: OperatorStatus;
    // ★ D212+ 5번 (2026-05-23 Harold 명시): 비용 제어 강화 patch
    budgetMonthly?: number | null;
    budgetDaily?: number | null;
    budgetAlertThreshold?: number;
    // ★ D212+ 정책 (2026-05-23 Harold 명시): 발송 정책 + 검증 + 담당자 영역 patch
    deliveryPolicy?: 'daily' | 'weekly' | 'monthly';
    verificationRequiredDays?: number;
    adminPhoneNumbers?: string[];
    backupAdminPhone?: string | null;
    adminAlertChannel?: 'sms' | 'kakao' | 'email';
    optOutMinutes?: number;
    spamScoreThreshold?: number;
    maxSpamRetries?: number;
  }
): Promise<ContinuousOperator | null> {
  // schedule/scheduleTime 변경 시 next_run_at 재계산
  let nextRunAt: Date | null = null;
  if (patch.schedule || patch.scheduleTime) {
    const current = await query(
      `SELECT schedule, schedule_time FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid`,
      [operatorId, companyId]
    );
    if (current.rows.length === 0) return null;
    const sched = (patch.schedule || current.rows[0].schedule) as OperatorSchedule;
    const time = patch.scheduleTime || current.rows[0].schedule_time;
    nextRunAt = computeNextRun(sched, time);
  }

  const result = await query(
    `UPDATE continuous_operators SET
      name = COALESCE($3, name),
      objective = COALESCE($4, objective),
      schedule = COALESCE($5, schedule),
      schedule_time = COALESCE($6, schedule_time),
      status = COALESCE($7, status),
      next_run_at = COALESCE($8, next_run_at),
      budget_monthly = $9,
      budget_daily = $10,
      budget_alert_threshold = COALESCE($11, budget_alert_threshold),
      delivery_policy = COALESCE($12, delivery_policy),
      verification_required_days = COALESCE($13, verification_required_days),
      admin_phone_numbers = COALESCE($14, admin_phone_numbers),
      backup_admin_phone = $15,
      admin_alert_channel = COALESCE($16, admin_alert_channel),
      opt_out_minutes = COALESCE($17, opt_out_minutes),
      spam_score_threshold = COALESCE($18, spam_score_threshold),
      max_spam_retries = COALESCE($19, max_spam_retries),
      updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
     RETURNING *`,
    [
      operatorId, companyId,
      patch.name ?? null,
      patch.objective ?? null,
      patch.schedule ?? null,
      patch.scheduleTime ?? null,
      patch.status ?? null,
      nextRunAt,
      patch.budgetMonthly === undefined ? null : patch.budgetMonthly,
      patch.budgetDaily === undefined ? null : patch.budgetDaily,
      patch.budgetAlertThreshold ?? null,
      patch.deliveryPolicy ?? null,
      patch.verificationRequiredDays ?? null,
      patch.adminPhoneNumbers ?? null,
      patch.backupAdminPhone === undefined ? null : patch.backupAdminPhone,
      patch.adminAlertChannel ?? null,
      patch.optOutMinutes ?? null,
      patch.spamScoreThreshold ?? null,
      patch.maxSpamRetries ?? null,
    ]
  );
  return result.rows.length > 0 ? mapRowToOperator(result.rows[0]) : null;
}

export async function archiveOperator(companyId: string, operatorId: string): Promise<boolean> {
  const result = await query(
    `UPDATE continuous_operators SET status = 'archived', updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid RETURNING id`,
    [operatorId, companyId]
  );
  return result.rows.length > 0;
}

// ════════════════════════════════════════════════════════════════════
// 제안서 — 매일 worker가 박는 영역
// ════════════════════════════════════════════════════════════════════

interface CompanyContextRow {
  company_name: string;
  business_type: string | null;
  brand_name: string | null;
  brand_slogan: string | null;
  brand_description: string | null;
  brand_tone: string | null;
  customer_schema: any;
  reject_number: string | null;
  cdp_auto_execute_enabled: boolean;
  cdp_auto_execute_max_recipients: number;
  cdp_auto_execute_max_cost_krw: number;
  // ★ D210+ Phase 3 B-1 (2026-05-23 Harold 명시): 회사별 risk 임계값 영역 (default 'low' — 옛 hardcoded 정합)
  cdp_auto_execute_max_risk: 'low' | 'medium' | 'high';
  plan_code: string;
}

export async function generateProposalForOperator(operatorId: string): Promise<OperatorProposal | null> {
  // 1. Operator 조회 — ★ D212+ 5번 (2026-05-23 Harold 명시): budget_spent 영역 sub-query 통합
  const operRes = await query(
    `SELECT o.*, c.id AS c_id,
       COALESCE((
         SELECT SUM(cost_estimate) FROM operator_proposals
         WHERE operator_id = o.id
           AND created_at >= date_trunc('month', NOW())
           AND status IN ('approved', 'auto_executed')
       ), 0) AS budget_spent_month,
       COALESCE((
         SELECT SUM(cost_estimate) FROM operator_proposals
         WHERE operator_id = o.id
           AND created_at >= CURRENT_DATE
           AND status IN ('approved', 'auto_executed')
       ), 0) AS budget_spent_today
     FROM continuous_operators o
     JOIN companies c ON o.company_id = c.id
     WHERE o.id = $1::uuid AND o.status = 'active'`,
    [operatorId]
  );
  if (operRes.rows.length === 0) return null;
  const operator = mapRowToOperator(operRes.rows[0]);

  // ★ D212+ 5번 (2026-05-23 Harold 명시): 예산 초과 영역 차단 — 회사 admin 신뢰 본질
  if (operator.budgetMonthly !== null && operator.budgetSpentMonth >= operator.budgetMonthly) {
    console.log(`[ContinuousOperator] ${operator.name} 월 예산 초과 (${operator.budgetSpentMonth.toLocaleString()}원 / ${operator.budgetMonthly.toLocaleString()}원) → 제안서 생성 차단`);
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }
  if (operator.budgetDaily !== null && operator.budgetSpentToday >= operator.budgetDaily) {
    console.log(`[ContinuousOperator] ${operator.name} 일별 예산 초과 (${operator.budgetSpentToday.toLocaleString()}원 / ${operator.budgetDaily.toLocaleString()}원) → 제안서 생성 차단`);
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }

  // 2. 회사 컨텍스트 + 자동 실행 옵션 조회
  const ctxRes = await query(
    `SELECT c.company_name, c.business_type, c.brand_name, c.brand_slogan,
            c.brand_description, c.brand_tone, c.customer_schema,
            COALESCE(c.reject_number, c.opt_out_080_number) AS reject_number,
            COALESCE(c.cdp_auto_execute_enabled, false) AS cdp_auto_execute_enabled,
            COALESCE(c.cdp_auto_execute_max_recipients, 1000) AS cdp_auto_execute_max_recipients,
            COALESCE(c.cdp_auto_execute_max_cost_krw, 50000) AS cdp_auto_execute_max_cost_krw,
            COALESCE(c.cdp_auto_execute_max_risk, 'low') AS cdp_auto_execute_max_risk,
            COALESCE(p.plan_code, 'FREE') AS plan_code
     FROM companies c
     LEFT JOIN plans p ON c.plan_id = p.id
     WHERE c.id = $1::uuid`,
    [operator.companyId]
  );
  if (ctxRes.rows.length === 0) return null;
  const ctx = ctxRes.rows[0] as CompanyContextRow;

  // 3. 고객 통계 조회
  const statsRes = await query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE sms_opt_in = true) AS sms_opt_in_count,
       AVG((custom_fields->>'purchase_count')::numeric) AS avg_purchase_count,
       AVG((custom_fields->>'total_spent')::numeric) AS avg_total_spent
     FROM customers
     WHERE company_id = $1::uuid AND is_active = true`,
    [operator.companyId]
  );
  const customerStats = statsRes.rows[0];

  // 4. AI Operator 호출 (orchestrate) — 제안서 박음
  const companyInfo: any = {
    company_name: ctx.company_name,
    business_type: ctx.business_type,
    brand_name: ctx.brand_name,
    brand_slogan: ctx.brand_slogan,
    brand_description: ctx.brand_description,
    brand_tone: ctx.brand_tone,
    customer_schema: ctx.customer_schema,
    reject_number: ctx.reject_number,
    ...getCompanyCosts({}),
  };

  console.log(`[ContinuousOperator] ${operator.name} 제안서 생성 시작 (objective: ${operator.objective.slice(0, 50)})`);

  let orchestratorResult: any;
  try {
    orchestratorResult = await orchestrate({
      companyId: operator.companyId,
      userId: operator.createdBy,
      objective: operator.objective,
      companyInfo,
      customerStats,
    });
  } catch (err: any) {
    console.error(`[ContinuousOperator] orchestrate 실패 ${operator.name}:`, err?.message || err);
    // Operator의 next_run_at만 갱신하고 제안서는 박지 X
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }

  // 5. Zero-Count 영구 원칙 — 0건 매칭 시 제안서 박지 X
  const recipientCount = orchestratorResult.target?.count || 0;
  if (recipientCount === 0) {
    console.log(`[ContinuousOperator] ${operator.name} 0건 매칭 → 제안서 박지 X (Zero-Count 영구 원칙)`);
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }

  // 6. 자동 실행 임계값 체크 (ENT 옵션)
  const costEstimate = orchestratorResult.cost?.estimated || 0;
  const compliance = orchestratorResult.compliance || { passed: true, riskLevel: 'low' };
  const isAd = orchestratorResult.channel?.isAd || false;

  // ★ D210+ Phase 3 B-1 (2026-05-23 Harold 명시): risk 영역 회사별 max_risk 비교 매트릭스
  //   매트릭스 순위 = low(1) < medium(2) < high(3) — 회사 max_risk 영역 이상 영역 차단
  const riskRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
  const proposalRiskRank = riskRank[compliance.riskLevel] || 1;
  const maxRiskRank = riskRank[ctx.cdp_auto_execute_max_risk] || 1;
  const riskWithinThreshold = proposalRiskRank <= maxRiskRank;

  const autoExecuteEligible =
    ctx.cdp_auto_execute_enabled &&
    (ctx.plan_code === 'ENTERPRISE' || ctx.plan_code === 'BUSINESS') &&
    recipientCount <= ctx.cdp_auto_execute_max_recipients &&
    costEstimate <= ctx.cdp_auto_execute_max_cost_krw &&
    riskWithinThreshold &&
    compliance.passed &&
    !isAd;

  const autoExecuteReason = autoExecuteEligible
    ? `자동 실행 임계값 통과: ${recipientCount}명 / ${costEstimate.toLocaleString()}원 / ${compliance.riskLevel} risk (회사 max ${ctx.cdp_auto_execute_max_risk}) / non-ad`
    : `자동 실행 미통과 — ${[
        !ctx.cdp_auto_execute_enabled && '옵션 OFF',
        !['ENTERPRISE', 'BUSINESS'].includes(ctx.plan_code) && '요금제',
        recipientCount > ctx.cdp_auto_execute_max_recipients && `${recipientCount}건 > ${ctx.cdp_auto_execute_max_recipients}`,
        costEstimate > ctx.cdp_auto_execute_max_cost_krw && `${costEstimate}원 > ${ctx.cdp_auto_execute_max_cost_krw}원`,
        !riskWithinThreshold && `compliance ${compliance.riskLevel} > 회사 max ${ctx.cdp_auto_execute_max_risk}`,
        !compliance.passed && 'compliance fail',
        isAd && '광고성 메시지',
      ].filter(Boolean).join(', ')}`;

  // 7. 제안서 INSERT
  const proposalRes = await query(
    `INSERT INTO operator_proposals (
      id, operator_id, company_id, proposal_json, recipient_count, cost_estimate,
      status, auto_executed, auto_execute_reason, expires_at, created_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3::jsonb, $4, $5,
      $6, $7, $8, NOW() + INTERVAL '7 days', NOW()
    ) RETURNING *`,
    [
      operator.id,
      operator.companyId,
      JSON.stringify(orchestratorResult),
      recipientCount,
      costEstimate,
      autoExecuteEligible ? 'auto_executed' : 'pending',
      autoExecuteEligible,
      autoExecuteReason,
    ]
  );

  // 8. D177 Self-Optimizing — message variants 박음 (Bandit 학습 기반)
  const messages: any[] = (orchestratorResult.messages as any[]) || [];
  if (messages.length > 0) {
    try {
      await insertProposalVariants(
        messages.slice(0, 3).map((m: any, idx: number) => ({
          proposalId: proposalRes.rows[0].id,
          variantIndex: idx,
          messageBody: String(m.body || m.message || ''),
          byteCount: Number(m.byteCount || m.byte_count || 0),
        }))
      );
    } catch (err: any) {
      console.warn(`[ContinuousOperator] variant 박음 실패 (proposal=${proposalRes.rows[0].id}):`, err?.message || err);
    }
  }

  // 9. ★ D212+ 정책 (2026-05-23 Harold 명시): 스팸필터테스트 자동 통합 본질
  //    - 통과 X 영역 = 발송 자동 차단 (status='spam_blocked')
  //    - 통과 영역 = 정책 분기 본질 (daily 검증 / weekly·monthly 옵트아웃)
  const bestMessage = messages[0] ? String(messages[0].body || messages[0].message || '') : '';
  if (bestMessage) {
    try {
      const spamResult = await spamTestWithRetry(
        proposalRes.rows[0].id,
        bestMessage,
        operator.maxSpamRetries || 3,
        operator.spamScoreThreshold || 30,
      );

      // 스팸테스트 결과 영역 저장
      await query(
        `UPDATE operator_proposals SET
           spam_test_status = $2,
           spam_test_score = $3,
           spam_test_retry_count = $4,
           spam_test_reasoning = $5,
           updated_at = NOW()
         WHERE id = $1::uuid`,
        [
          proposalRes.rows[0].id,
          spamResult.status,
          spamResult.score,
          spamResult.retryCount,
          spamResult.reasoning,
        ],
      );

      if (spamResult.status === 'failed') {
        // 스팸 통과 X = 발송 차단 + status='spam_blocked'
        await query(
          `UPDATE operator_proposals SET status = 'spam_blocked', auto_execute_reason = $2
           WHERE id = $1::uuid`,
          [proposalRes.rows[0].id, `스팸필터 통과 X — ${spamResult.reasoning}`],
        );
        console.warn(`[ContinuousOperator] ${operator.name} 스팸필터 통과 X — 발송 자동 차단`);
      }
    } catch (err: any) {
      console.warn(`[ContinuousOperator] 스팸테스트 영역 오류 (skip):`, err?.message);
    }
  }

  // 10. ★ D212+ 정책 (2026-05-23 Harold 명시): 검증 영역 안 확인 (daily 영역 안 처음 N일 = 회사 admin 명시 컨펌 의무)
  const verifyResult = isAutoSendAllowed({
    deliveryPolicy: operator.deliveryPolicy,
    verificationRequiredDays: operator.verificationRequiredDays,
    verificationPassedDays: operator.verificationPassedDays,
  });
  if (!verifyResult.allowed) {
    // 검증 영역 안 = 회사 admin 명시 컨펌 영역 (옛 영역 = autoExecute 영역 X)
    await query(
      `UPDATE operator_proposals SET auto_executed = false, auto_execute_reason = $2
       WHERE id = $1::uuid`,
      [proposalRes.rows[0].id, `검증 영역 안 — ${verifyResult.reason}`],
    );
  }

  // 11. Operator 통계 갱신
  await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 1, autoExecuteEligible);

  console.log(`[ContinuousOperator] ${operator.name} 제안서 박힘 (${recipientCount}명 / ${costEstimate}원 / ${autoExecuteEligible ? '자동 실행' : 'pending'} / variants ${messages.length}건 / 정책 ${operator.deliveryPolicy})`);

  return mapRowToProposal(proposalRes.rows[0]);
}

// ★ D212+ 정책 (2026-05-23 Harold 명시): 담당자 정지 영역 본질 — AI 학습 통합
export async function adminStopProposal(
  companyId: string,
  proposalId: string,
  stopReason: { reason: 'spam_suspicion' | 'content_correction' | 'no_send' | 'other'; detail?: string },
): Promise<boolean> {
  // 회사 격리 + proposal 조회
  const r = await query(
    `SELECT id, proposal_json FROM operator_proposals
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('pending', 'admin_review')`,
    [proposalId, companyId],
  );
  if (r.rows.length === 0) return false;

  const proposal = r.rows[0];
  const messageBody = proposal.proposal_json?.messages?.[0]?.body || proposal.proposal_json?.messages?.[0]?.message || '';

  // 정지 영역 처리
  await query(
    `UPDATE operator_proposals SET
       status = 'admin_stopped',
       admin_response = 'stopped',
       admin_stop_reason = $2,
       reviewed_at = NOW()
     WHERE id = $1::uuid`,
    [proposalId, JSON.stringify(stopReason)],
  );

  // AI 학습 영역 본질 (ai_company_memory 영역 안)
  await recordAdminStopLearning(companyId, proposalId, stopReason, messageBody);

  return true;
}

// ★ D212+ 정책 (2026-05-23 Harold 명시): 회사 admin 매일 컨펌 영역 본질 (검증 영역 안)
export async function adminConfirmProposal(
  companyId: string,
  proposalId: string,
): Promise<{ ok: boolean; verificationDays: number } | null> {
  // 회사 격리 + proposal 조회
  const r = await query(
    `SELECT p.id, p.operator_id, o.verification_passed_days, o.verification_required_days
     FROM operator_proposals p
     INNER JOIN continuous_operators o ON o.id = p.operator_id
     WHERE p.id = $1::uuid AND p.company_id = $2::uuid AND p.status = 'pending'`,
    [proposalId, companyId],
  );
  if (r.rows.length === 0) return null;

  const proposal = r.rows[0];

  // 승인 영역 처리
  await query(
    `UPDATE operator_proposals SET
       status = 'approved',
       admin_response = 'confirmed',
       reviewed_at = NOW()
     WHERE id = $1::uuid`,
    [proposalId],
  );

  // 검증 일수 누적
  const incRes = await query(
    `UPDATE continuous_operators SET
       verification_passed_days = COALESCE(verification_passed_days, 0) + 1,
       updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
     RETURNING verification_passed_days`,
    [proposal.operator_id, companyId],
  );

  return {
    ok: true,
    verificationDays: incRes.rows[0]?.verification_passed_days || 0,
  };
}

async function updateOperatorAfterRun(
  operatorId: string,
  schedule: OperatorSchedule,
  scheduleTime: string,
  proposalIncrement: number,
  autoExecuted: boolean = false
): Promise<void> {
  const nextRunAt = computeNextRun(schedule, scheduleTime);
  await query(
    `UPDATE continuous_operators SET
       last_run_at = NOW(),
       next_run_at = $2,
       total_proposals = total_proposals + $3,
       total_auto_executed = total_auto_executed + $4,
       updated_at = NOW()
     WHERE id = $1::uuid`,
    [operatorId, nextRunAt, proposalIncrement, autoExecuted ? 1 : 0]
  );
}

// ════════════════════════════════════════════════════════════════════
// 제안서 — 사용자 승인/거부
// ════════════════════════════════════════════════════════════════════

export async function listProposals(
  companyId: string,
  status: ProposalStatus | 'all' = 'pending',
  limit: number = 50
): Promise<OperatorProposal[]> {
  // 만료 자동 처리 (조회 시점에 한 번 박음)
  await query(
    `UPDATE operator_proposals SET status = 'expired'
     WHERE company_id = $1::uuid AND status = 'pending' AND expires_at < NOW()`,
    [companyId]
  );

  const statusFilter = status === 'all' ? '' : `AND p.status = '${status}'`;
  const result = await query(
    `SELECT p.*, o.name AS operator_name, o.objective AS operator_objective
     FROM operator_proposals p
     LEFT JOIN continuous_operators o ON p.operator_id = o.id
     WHERE p.company_id = $1::uuid ${statusFilter}
     ORDER BY p.created_at DESC
     LIMIT $2`,
    [companyId, Math.min(limit, 200)]
  );
  return result.rows.map(mapRowToProposal);
}

export async function approveProposal(
  companyId: string,
  proposalId: string,
  userId: string
): Promise<{ proposal: OperatorProposal; ok: boolean; reason?: string }> {
  const result = await query(
    `UPDATE operator_proposals SET
       status = 'approved',
       reviewed_by = $3::uuid,
       reviewed_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'pending'
     RETURNING *`,
    [proposalId, companyId, userId]
  );
  if (result.rows.length === 0) {
    return { proposal: null as any, ok: false, reason: 'pending 상태가 아니거나 권한이 없는 제안서입니다.' };
  }

  // 통계 갱신
  await query(
    `UPDATE continuous_operators SET total_approved = total_approved + 1, updated_at = NOW()
     WHERE id = (SELECT operator_id FROM operator_proposals WHERE id = $1::uuid)`,
    [proposalId]
  );

  // 실 발송은 routes/ai.ts에서 /direct-send 호출 (분리 정합)
  return { proposal: mapRowToProposal(result.rows[0]), ok: true };
}

export async function rejectProposal(
  companyId: string,
  proposalId: string,
  userId: string
): Promise<boolean> {
  const result = await query(
    `UPDATE operator_proposals SET
       status = 'rejected',
       reviewed_by = $3::uuid,
       reviewed_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'pending'
     RETURNING id, operator_id`,
    [proposalId, companyId, userId]
  );
  if (result.rows.length === 0) return false;

  await query(
    `UPDATE continuous_operators SET total_rejected = total_rejected + 1, updated_at = NOW()
     WHERE id = $1::uuid`,
    [result.rows[0].operator_id]
  );
  return true;
}

export async function markProposalExecuted(proposalId: string, campaignId: string): Promise<void> {
  await query(
    `UPDATE operator_proposals SET campaign_id = $2::uuid WHERE id = $1::uuid`,
    [proposalId, campaignId]
  );
}

// ════════════════════════════════════════════════════════════════════
// Worker — 매일 09:00 KST에 활성 Operator 처리
// ════════════════════════════════════════════════════════════════════

let workerRunning = false;

export async function runOperatorWorker(): Promise<{ processed: number; failed: number }> {
  if (workerRunning) {
    console.log('[ContinuousOperator Worker] 이미 실행 중 — skip');
    return { processed: 0, failed: 0 };
  }
  workerRunning = true;

  let processed = 0;
  let failed = 0;

  try {
    const dueRes = await query(
      `SELECT id FROM continuous_operators
       WHERE status = 'active'
         AND (next_run_at IS NULL OR next_run_at <= NOW())
       ORDER BY next_run_at NULLS FIRST
       LIMIT 100`
    );

    for (const row of dueRes.rows) {
      try {
        await generateProposalForOperator(row.id);
        processed++;
      } catch (err: any) {
        failed++;
        console.error(`[ContinuousOperator Worker] ${row.id} 처리 실패:`, err?.message || err);
      }
    }

    if (dueRes.rows.length > 0) {
      console.log(`[ContinuousOperator Worker] 처리 완료 — ${processed} 성공 / ${failed} 실패`);
    }
  } finally {
    workerRunning = false;
  }

  return { processed, failed };
}

export function startContinuousOperatorScheduler(): void {
  const intervalMs = 5 * 60 * 1000; // 5분마다 due Operator 체크
  setInterval(() => {
    runOperatorWorker().catch((err) => {
      console.error('[ContinuousOperator Worker] 예외:', err);
    });
  }, intervalMs);
  // boot 60초 후 1회 실행
  setTimeout(() => {
    runOperatorWorker().catch((err) => {
      console.error('[ContinuousOperator Worker] 초기 실행 예외:', err);
    });
  }, 60 * 1000);
  console.log('[ContinuousOperator Worker] 스케줄러 박힘 (5분 주기)');
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

function computeNextRun(schedule: OperatorSchedule, scheduleTime: string): Date {
  // KST 기준 schedule_time(HH:mm)에 다음 실행
  const [hStr, mStr] = scheduleTime.split(':');
  const h = parseInt(hStr) || 9;
  const m = parseInt(mStr) || 0;

  // 한국 시간 기준 — UTC = KST - 9h
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC → KST
  const target = new Date(kstNow);
  target.setUTCHours(h, m, 0, 0);
  if (target.getTime() <= kstNow.getTime()) {
    // 오늘 시간이 지났으면 다음 사이클
    if (schedule === 'daily') target.setUTCDate(target.getUTCDate() + 1);
    else if (schedule === 'weekly') target.setUTCDate(target.getUTCDate() + 7);
    else if (schedule === 'monthly') target.setUTCMonth(target.getUTCMonth() + 1);
  }
  // KST → UTC
  return new Date(target.getTime() - 9 * 60 * 60 * 1000);
}

function mapRowToOperator(row: any): ContinuousOperator {
  return {
    id: row.id,
    companyId: row.company_id,
    createdBy: row.created_by,
    name: row.name,
    objective: row.objective,
    schedule: row.schedule,
    scheduleTime: row.schedule_time,
    status: row.status,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
    nextRunAt: row.next_run_at ? new Date(row.next_run_at) : null,
    totalProposals: row.total_proposals || 0,
    totalApproved: row.total_approved || 0,
    totalRejected: row.total_rejected || 0,
    totalAutoExecuted: row.total_auto_executed || 0,
    createdAt: new Date(row.created_at),
    // ★ D212+ 5번 (2026-05-23 Harold 명시): 비용 제어 강화 영역 매핑
    budgetMonthly: row.budget_monthly !== null && row.budget_monthly !== undefined ? Number(row.budget_monthly) : null,
    budgetDaily: row.budget_daily !== null && row.budget_daily !== undefined ? Number(row.budget_daily) : null,
    budgetAlertThreshold: Number(row.budget_alert_threshold) || 80,
    budgetSpentMonth: Number(row.budget_spent_month) || 0,
    budgetSpentToday: Number(row.budget_spent_today) || 0,
    // ★ D212+ 정책 (2026-05-23 Harold 명시): 발송 정책 + 검증 + 담당자 영역 매핑
    deliveryPolicy: (row.delivery_policy || 'daily') as 'daily' | 'weekly' | 'monthly',
    verificationRequiredDays: Number(row.verification_required_days) || 7,
    verificationPassedDays: Number(row.verification_passed_days) || 0,
    adminPhoneNumbers: Array.isArray(row.admin_phone_numbers) ? row.admin_phone_numbers : [],
    backupAdminPhone: row.backup_admin_phone || null,
    adminAlertChannel: (row.admin_alert_channel || 'sms') as 'sms' | 'kakao' | 'email',
    optOutMinutes: Number(row.opt_out_minutes) || 5,
    spamScoreThreshold: Number(row.spam_score_threshold) || 30,
    maxSpamRetries: Number(row.max_spam_retries) || 3,
  };
}

function mapRowToProposal(row: any): OperatorProposal {
  return {
    id: row.id,
    operatorId: row.operator_id,
    companyId: row.company_id,
    proposalJson: row.proposal_json || {},
    recipientCount: row.recipient_count || 0,
    costEstimate: row.cost_estimate || 0,
    status: row.status,
    autoExecuted: !!row.auto_executed,
    autoExecuteReason: row.auto_execute_reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    campaignId: row.campaign_id,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
    operatorName: row.operator_name,
    operatorObjective: row.operator_objective,
  };
}
