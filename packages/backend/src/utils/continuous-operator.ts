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
// ★ D212+ 정책 (2026-05-23 Harold 명시): CT-64 영역 통합 — 검증 영역 + 담당자 학습
// ★ D227+ 스팸 안전망 격상 — decideSpamOutcome(실제 테스트 결과 → 상태) + buildSpamRegeneratePrompt(AI 재작성)
import { isAutoSendAllowed, recordAdminStopLearning, decideSpamOutcome, buildSpamRegeneratePrompt } from './continuous-operator-policy';
// ★ D227+ 검증된 스팸 자산 재사용 (auto-campaign-worker와 동일 패턴) — 실제 테스트폰 발송 + AI 재생성 + 재테스트
import { autoSpamTestWithRegenerate } from './spam-test-queue';
import { generateMessages } from '../services/ai';
// ★ D227+ 종량제: AI 사이클 크레딧 부족 감지 + 담당자 무과금 알림(인증 라인 재사용)
import { InsufficientCreditError } from './ai-credit';
import { runInCreditBundle } from './ai-credit-context';
import { getAuthSmsTable, bulkInsertSmsQueue } from './sms-queue';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type OperatorSchedule = 'daily' | 'weekly' | 'monthly';
export type OperatorStatus = 'active' | 'paused' | 'paused_no_credit' | 'archived';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'auto_executed' | 'expired' | 'admin_review';

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
    }, { source: 'continuous-operator' });  // 자동마케팅 = 풀분석 자동(200, 할인). source로 단가·이력 분리.
    // ★ D227+ 종량제: 크레딧 충분해 정상 실행 — paused_no_credit였으면 자동 재개
    await query(
      `UPDATE continuous_operators SET status = 'active', updated_at = NOW()
       WHERE id = $1::uuid AND status = 'paused_no_credit'`,
      [operator.id],
    );
  } catch (err: any) {
    // ★ D227+ 종량제: AI 크레딧 부족 → paused_no_credit(가시성) + 담당자 무과금 알림(전환 시 1회) + 다음 주기 재확인
    if (err instanceof InsufficientCreditError) {
      const transit = await query(
        `UPDATE continuous_operators SET status = 'paused_no_credit', updated_at = NOW()
         WHERE id = $1::uuid AND status <> 'paused_no_credit' RETURNING id`,
        [operator.id],
      );
      if (transit.rows.length > 0) {
        await notifyOperatorAdmins(
          operator,
          '[AI 오퍼레이션 일시 중지]',
          `AI 크레딧이 부족하여 '${operator.name}' 자동 운영이 일시 중지됐습니다. 크레딧 충전 시 다음 주기에 자동 재개됩니다.`,
        ).catch((e: any) => console.error('[ContinuousOperator] 크레딧 알림 발송 실패:', e?.message || e));
      }
      await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
      console.warn(`[ContinuousOperator] ${operator.name} 크레딧 부족 → paused_no_credit (다음 주기 재확인)`);
      return null;
    }
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

  // 9. ★ D227+ 스팸 안전망 격상 — 실제 테스트폰 발송 → 차단 시 AI 재생성(2회) → 재테스트 → 끝내 실패 시 담당자 검토.
  //    auto-campaign-worker와 동일한 검증된 자산(autoSpamTestWithRegenerate + generateMessages) 재사용.
  //    callbackNumber 없으면(SMS 발신번호 미설정) 테스트 불가 → 스킵(기존 pending 흐름 유지).
  const channelForSpam = (orchestratorResult.channel?.recommended || 'SMS').toUpperCase();
  const callbackForSpam = String(companyInfo.callback || companyInfo.callback_number || ctx.reject_number || '').trim();
  const bestMessage = messages[0] ? String(messages[0].body || messages[0].message || '') : '';
  const bestSubject = messages[0] ? String(messages[0].subject || '') : '';
  if (bestMessage && callbackForSpam && channelForSpam !== '카카오' && channelForSpam !== 'KAKAO') {
    try {
      const spamResult = await autoSpamTestWithRegenerate({
        companyId: operator.companyId,
        userId: operator.createdBy || operator.companyId,
        callbackNumber: callbackForSpam,
        messageType: (channelForSpam === 'LMS' || channelForSpam === 'MMS' ? channelForSpam : 'SMS') as 'SMS' | 'LMS' | 'MMS',
        subject: bestSubject || undefined,
        variants: [{ variantId: 'A', messageText: bestMessage, subject: bestSubject || undefined }],
        isAd: !!isAd,
        rejectNumber: ctx.reject_number || undefined,
        maxRetries: 2,  // ★ Harold 2026-05-31: AI 재생성 2회
        // 차단 시 AI 재작성 (Opus) — buildSpamRegeneratePrompt: 목표 유지 + 구체 혜택 생성 금지
        regenerateCallback: async () => {
          try {
            // 스팸 재생성은 자동마케팅 사이클 안전망(품질 보증) → 묶음으로 차감 0 (사이클 1회 200에 포함).
            const regen = await runInCreditBundle(() => generateMessages(
              buildSpamRegeneratePrompt(operator.objective),
              { count: recipientCount, segmentName: orchestratorResult.target?.suggestedName || operator.name, criteria: orchestratorResult.target?.criteria || '' } as any,
              { channel: channelForSpam, isAd: !!isAd, rejectNumber: ctx.reject_number || undefined, model: 'opus', companyId: operator.companyId },
            ));
            const nv = regen.variants?.[0] as any;
            if (nv) return { messageText: String(nv.message_text || nv.sms_text || nv.lms_text || nv.body || ''), subject: nv.subject };
            return null;
          } catch { return null; }
        },
      });

      const variantResult = spamResult.variants[0];
      const finalResult = (variantResult?.spamResult || 'failed') as 'pass' | 'blocked' | 'failed' | 'timeout';
      const regenCount = variantResult?.regenerateCount || 0;

      // 재생성된 문안이 통과했으면 proposal_json의 best 메시지를 교체 (실제 발송될 문안 = 통과 문안)
      if (variantResult?.regenerated && variantResult.messageText) {
        try {
          const pj = orchestratorResult;
          if (pj.messages?.[0]) {
            pj.messages[0].body = variantResult.messageText;
            if (variantResult.subject) pj.messages[0].subject = variantResult.subject;
          }
          await query(`UPDATE operator_proposals SET proposal_json = $2::jsonb WHERE id = $1::uuid`,
            [proposalRes.rows[0].id, JSON.stringify(pj)]);
        } catch (e: any) { console.warn('[ContinuousOperator] 재생성 문안 반영 skip:', e?.message); }
      }

      // 스팸 결과 저장 + 상태 결정 (decideSpamOutcome 순수 정책)
      const outcome = decideSpamOutcome(finalResult, regenCount);
      await query(
        `UPDATE operator_proposals SET
           spam_test_status = $2, spam_test_retry_count = $3, spam_test_reasoning = $4, updated_at = NOW()
         WHERE id = $1::uuid`,
        [proposalRes.rows[0].id, finalResult, regenCount, outcome.reason],
      );

      if (outcome.status === 'admin_review') {
        // 끝내 통과 X → 담당자 검토 대기 (자동 발송 차단, 자동 폐기 X)
        await query(
          `UPDATE operator_proposals SET status = 'admin_review', auto_executed = false, auto_execute_reason = $2
           WHERE id = $1::uuid`,
          [proposalRes.rows[0].id, outcome.reason],
        );
        console.warn(`[ContinuousOperator] ${operator.name} 스팸 미통과 (재생성 ${regenCount}회) → 담당자 검토 대기`);
      } else {
        console.log(`[ContinuousOperator] ${operator.name} 스팸 통과 (재생성 ${regenCount}회)`);
      }
    } catch (err: any) {
      console.warn(`[ContinuousOperator] 스팸테스트 오류 (skip):`, err?.message);
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

  // ★ D227+ pending 조회 시 admin_review(스팸 미통과 담당자 검토 대기)도 함께 노출 — 담당자가 한 탭에서 처리
  const statusFilter = status === 'all'
    ? ''
    : status === 'pending'
      ? `AND p.status IN ('pending', 'admin_review')`
      : `AND p.status = '${status}'`;
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
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('pending', 'admin_review')
     RETURNING *`,
    [proposalId, companyId, userId]
  );
  if (result.rows.length === 0) {
    return { proposal: null as any, ok: false, reason: '승인 가능한 상태가 아니거나 권한이 없는 제안서입니다.' };
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
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('pending', 'admin_review')
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
       WHERE status IN ('active', 'paused_no_credit')
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

/**
 * ★ D227+ 종량제: AI 오퍼레이션 담당자 알림 — 무과금(회사 발송비 차감 X, 인증 라인 사용 = 우리 서비스 부담).
 * 현재 = 문자(LMS). 알림톡 템플릿 등록 후 = 1순위 알림톡 → 2순위 문자 fallback으로 교체 예정(아래 TODO seam).
 */
async function notifyOperatorAdmins(
  operator: { adminPhoneNumbers: string[]; backupAdminPhone: string | null; companyId: string },
  title: string,
  body: string,
): Promise<void> {
  const phones = [...(operator.adminPhoneNumbers || []), operator.backupAdminPhone || '']
    .map((p) => String(p || '').replace(/\D/g, ''))
    .filter((p) => /^01\d{8,9}$/.test(p));
  const unique = Array.from(new Set(phones));
  if (unique.length === 0) return;

  // TODO(알림톡 템플릿 등록 후): 1순위 알림톡(insertAlimtalkQueue) → 실패 시 아래 문자(2순위)로 fallback.
  const authTable = await getAuthSmsTable();
  const rows = unique.map((phone) => [
    phone,                  // dest_no
    phone,                  // call_back
    body,                   // msg_contents
    'L',                    // msg_type (LMS)
    title.slice(0, 40),     // title_str
    null,                   // sendreq_time (useNow)
    '',                     // app_etc1
    operator.companyId,     // app_etc2
    '', '', '',             // file_name 1/2/3
  ]);
  await bulkInsertSmsQueue([authTable], rows as any, true);
}

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
