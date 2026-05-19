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
    throw new Error('objective는 5자 이상 박아주세요.');
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
  const result = await query(
    `SELECT * FROM continuous_operators
     WHERE company_id = $1::uuid AND status != 'archived'
     ORDER BY status DESC, created_at DESC`,
    [companyId]
  );
  return result.rows.map(mapRowToOperator);
}

export async function updateOperator(
  companyId: string,
  operatorId: string,
  patch: { name?: string; objective?: string; schedule?: OperatorSchedule; scheduleTime?: string; status?: OperatorStatus }
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
  plan_code: string;
}

export async function generateProposalForOperator(operatorId: string): Promise<OperatorProposal | null> {
  // 1. Operator 조회
  const operRes = await query(
    `SELECT o.*, c.id AS c_id FROM continuous_operators o
     JOIN companies c ON o.company_id = c.id
     WHERE o.id = $1::uuid AND o.status = 'active'`,
    [operatorId]
  );
  if (operRes.rows.length === 0) return null;
  const operator = mapRowToOperator(operRes.rows[0]);

  // 2. 회사 컨텍스트 + 자동 실행 옵션 조회
  const ctxRes = await query(
    `SELECT c.company_name, c.business_type, c.brand_name, c.brand_slogan,
            c.brand_description, c.brand_tone, c.customer_schema,
            COALESCE(c.reject_number, c.opt_out_080_number) AS reject_number,
            COALESCE(c.cdp_auto_execute_enabled, false) AS cdp_auto_execute_enabled,
            COALESCE(c.cdp_auto_execute_max_recipients, 1000) AS cdp_auto_execute_max_recipients,
            COALESCE(c.cdp_auto_execute_max_cost_krw, 50000) AS cdp_auto_execute_max_cost_krw,
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

  const autoExecuteEligible =
    ctx.cdp_auto_execute_enabled &&
    (ctx.plan_code === 'ENTERPRISE' || ctx.plan_code === 'BUSINESS') &&
    recipientCount <= ctx.cdp_auto_execute_max_recipients &&
    costEstimate <= ctx.cdp_auto_execute_max_cost_krw &&
    compliance.riskLevel === 'low' &&
    compliance.passed &&
    !isAd;

  const autoExecuteReason = autoExecuteEligible
    ? `자동 실행 임계값 통과: ${recipientCount}명 / ${costEstimate.toLocaleString()}원 / ${compliance.riskLevel} risk / non-ad`
    : `자동 실행 미통과 — ${[
        !ctx.cdp_auto_execute_enabled && '옵션 OFF',
        !['ENTERPRISE', 'BUSINESS'].includes(ctx.plan_code) && '요금제',
        recipientCount > ctx.cdp_auto_execute_max_recipients && `${recipientCount}건 > ${ctx.cdp_auto_execute_max_recipients}`,
        costEstimate > ctx.cdp_auto_execute_max_cost_krw && `${costEstimate}원 > ${ctx.cdp_auto_execute_max_cost_krw}원`,
        compliance.riskLevel !== 'low' && `compliance ${compliance.riskLevel}`,
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

  // 8. Operator 통계 갱신
  await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 1, autoExecuteEligible);

  console.log(`[ContinuousOperator] ${operator.name} 제안서 박힘 (${recipientCount}명 / ${costEstimate}원 / ${autoExecuteEligible ? '자동 실행' : 'pending'})`);

  return mapRowToProposal(proposalRes.rows[0]);
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
