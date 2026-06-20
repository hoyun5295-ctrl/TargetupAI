/**
 * ★ CT-28: Continuous Agentic Operator 컨트롤타워 — D176 (2026-05-19)
 *
 * 🎯 목적
 *   한줄로 BEYOND BRAZE 비전 압축 로드맵 1순위 — "AI가 매일 회고 + 제안서 생성 / 실행은 사용자 동의 후".
 *   - 회사 admin이 자연어 한 줄로 영구 운영 목표 등록 ("VIP 재구매 영구 운영")
 *   - 매일 09:00 KST worker가 활성 Operator의 제안서 생성
 *   - 사용자가 받은 제안서 일괄 승인 / 개별 승인 / 거부
 *   - ENT 자동 실행 옵션 활성 + 임계값 통과 시에만 AI가 자동 실행 (default OFF)
 *
 * ⛔ 영구 원칙 (Harold 명시 100% 정합)
 *   - AI는 의견을 낼 뿐, 실행은 항상 사용자 동의 후
 *   - 자동 실행은 default OFF (ENT 명시 ON + 1,000건/5만원/low risk 임계값 통과 시만)
 *   - 자동 실행 시에도 회사 admin에게 즉시 SMS/이메일 알림 (사후 통지)
 *   - 타겟 매칭 0건이면 제안서 생성 안 함 (Zero-Count 영구 원칙)
 *   - 7일 후 미응답 제안서는 expired 처리 (방치 차단)
 *
 * 📊 사용 흐름
 *   1. 사용자: createOperator(companyId, name, objective) → DB INSERT
 *   2. Worker: 매일 09:00 KST → listActiveOperators() → 각 Operator에 대해 generateProposal()
 *   3. AI: orchestrate() 호출하여 OrchestratorResult 생성 → operator_proposals INSERT
 *   4. Auto-eligible은 'scheduled'(준비+lead 뒤 자율 발송) / 그 외 status='pending'(수동 검토)
 *   5. 사용자: GET /api/ai/operator/proposals → 대기 중인 제안서 목록 조회
 *   6. 사용자: POST /api/ai/operator/proposals/:id/approve → 승인 + 즉시 발송 → status='sent'
 *   7. 사용자: POST /api/ai/operator/proposals/:id/reject → 거부 → status='rejected'
 */

import { query } from '../config/database';
import { orchestrate } from '../services/ai-orchestrator';
import { getCompanyCosts } from '../config/defaults';
// ★ D177 (2026-05-19): Self-Optimizing Bandit — message variants 생성 + Thompson Sampling
import { insertProposalVariants } from './bandit-optimizer';
// ★ D212+ 정책 (2026-05-23 Harold 명시): CT-64 영역 통합 — 검증 영역 + 담당자 학습
// ★ D227+ 스팸 안전망 격상 — decideSpamOutcome(실제 테스트 결과 → 상태) + buildSpamRegeneratePrompt(AI 재작성)
import { recordAdminStopLearning, decideSpamOutcome, buildSpamRegeneratePrompt } from './continuous-operator-policy';
import { resolveAutoSendLeadMinutes, computeScheduledSendAt, decideSendOutcome, decideStuckSendingRecovery } from './autosend-policy';
import { getOpt080Number } from './messageUtils';
// ★ D227+ 검증된 스팸 자산 재사용 (auto-campaign-worker와 동일 패턴) — 실제 테스트폰 발송 + AI 재생성 + 재테스트
import { autoSpamTestWithRegenerate } from './spam-test-queue';
import { generateMessages } from '../services/ai';
// ★ D227+ 종량제: AI 사이클 크레딧 부족 감지 + 담당자 무과금 알림(인증 라인 재사용)
import { InsufficientCreditError, checkCredit, deductCreditSafe } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { runInCreditBundle } from './ai-credit-context';
import { getAuthSmsTable, bulkInsertSmsQueue } from './sms-queue';
import { randomUUID } from 'crypto';
import { buildFilterWhereClauseCompat } from './customer-filter';
import { buildSendableRecipientsSql } from './operator-recipients';
import { createDirectSendCampaign } from './direct-send-core';
import { DirectSendError } from './direct-send-spec';
import { buildSeasonPromptBlock, getSeasonContext } from './season-context';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type OperatorSchedule = 'daily' | 'weekly' | 'monthly';
export type OperatorStatus = 'active' | 'paused' | 'paused_no_credit' | 'archived';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'auto_executed' | 'expired' | 'admin_review' | 'admin_stopped' | 'scheduled' | 'sending' | 'sent' | 'skipped';

export interface CreateOperatorInput {
  companyId: string;
  createdBy: string;
  name: string;
  objective: string;
  schedule?: OperatorSchedule;
  scheduleTime?: string;  // HH:mm KST, default 09:00
  scheduleDayOfWeek?: number | null;   // 0(일)~6(토) — weekly 전용 (미지정 시 생성일 요일)
  scheduleDayOfMonth?: number | null;  // 1~31 — monthly 전용 (말일 초과 시 그 달 말일로 클램프)
}

export interface ContinuousOperator {
  id: string;
  companyId: string;
  createdBy: string | null;
  name: string;
  objective: string;
  schedule: OperatorSchedule;
  scheduleTime: string;
  scheduleDayOfWeek: number | null;   // 0(일)~6(토) — weekly 전용
  scheduleDayOfMonth: number | null;  // 1~31 — monthly 전용
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
  autoSendLeadMinutes: number | null;               // 자율 발송 준비·정지 창(분) — null→120
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
  const scheduleDayOfWeek = (schedule === 'weekly' && input.scheduleDayOfWeek != null) ? input.scheduleDayOfWeek : null;
  const scheduleDayOfMonth = (schedule === 'monthly' && input.scheduleDayOfMonth != null) ? input.scheduleDayOfMonth : null;
  const nextRunAt = computeNextRun(schedule, scheduleTime, scheduleDayOfWeek, scheduleDayOfMonth);

  // ★ 2026-06-02 종량제: 자동마케팅 저장(활성화) = 200 1회. 사전 잔액 확인(선불 부족 차단) → INSERT → 성공 후 차감(멱등키 operatorId).
  const saveCost = getCreditCost('continuous-operator');
  await checkCredit(input.companyId, saveCost);
  const result = await query(
    `INSERT INTO continuous_operators (
      id, company_id, created_by, name, objective,
      schedule, schedule_time, schedule_day_of_week, schedule_day_of_month, status, next_run_at,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3, $4,
      $5, $6, $8, $9, 'active', $7,
      NOW(), NOW()
    ) RETURNING *`,
    [input.companyId, input.createdBy, input.name, input.objective.trim(), schedule, scheduleTime, nextRunAt, scheduleDayOfWeek, scheduleDayOfMonth]
  );
  const operator = mapRowToOperator(result.rows[0]);
  await deductCreditSafe({
    companyId: input.companyId,
    cost: saveCost,
    source: 'continuous-operator',
    createdBy: input.createdBy,
    idempotencyKey: `continuous-operator:${operator.id}`,
  });
  return operator;
}

export async function listOperators(companyId: string): Promise<ContinuousOperator[]> {
  // ★ D212+ 5번 (2026-05-23 Harold 명시): budget_spent_month + budget_spent_today 영역 sub-query
  const result = await query(
    `SELECT o.*,
       COALESCE((
         SELECT SUM(cost_estimate) FROM operator_proposals
         WHERE operator_id = o.id
           AND created_at >= date_trunc('month', NOW())
           AND status IN ('approved', 'auto_executed', 'sent')
       ), 0) AS budget_spent_month,
       COALESCE((
         SELECT SUM(cost_estimate) FROM operator_proposals
         WHERE operator_id = o.id
           AND created_at >= CURRENT_DATE
           AND status IN ('approved', 'auto_executed', 'sent')
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
    scheduleDayOfWeek?: number | null;
    scheduleDayOfMonth?: number | null;
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
    autoSendLeadMinutes?: number | null;
    spamScoreThreshold?: number;
    maxSpamRetries?: number;
  }
): Promise<ContinuousOperator | null> {
  // schedule/scheduleTime/요일/날짜 변경 시 next_run_at 재계산
  let nextRunAt: Date | null = null;
  let nextDow: number | null = null;
  let nextDom: number | null = null;
  if (patch.schedule || patch.scheduleTime || patch.scheduleDayOfWeek !== undefined || patch.scheduleDayOfMonth !== undefined) {
    const current = await query(
      `SELECT schedule, schedule_time, schedule_day_of_week, schedule_day_of_month FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid`,
      [operatorId, companyId]
    );
    if (current.rows.length === 0) return null;
    const sched = (patch.schedule || current.rows[0].schedule) as OperatorSchedule;
    const time = patch.scheduleTime || current.rows[0].schedule_time;
    nextDow = sched === 'weekly' ? (patch.scheduleDayOfWeek !== undefined ? patch.scheduleDayOfWeek : current.rows[0].schedule_day_of_week) : null;
    nextDom = sched === 'monthly' ? (patch.scheduleDayOfMonth !== undefined ? patch.scheduleDayOfMonth : current.rows[0].schedule_day_of_month) : null;
    nextRunAt = computeNextRun(sched, time, nextDow, nextDom);
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
      auto_send_lead_minutes = COALESCE($20, auto_send_lead_minutes),
      schedule_day_of_week = COALESCE($21, schedule_day_of_week),
      schedule_day_of_month = COALESCE($22, schedule_day_of_month),
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
      patch.autoSendLeadMinutes ?? null,
      nextDow,
      nextDom,
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
// 제안서 — 매일 worker가 생성
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
           AND status IN ('approved', 'auto_executed', 'sent')
       ), 0) AS budget_spent_month,
       COALESCE((
         SELECT SUM(cost_estimate) FROM operator_proposals
         WHERE operator_id = o.id
           AND created_at >= CURRENT_DATE
           AND status IN ('approved', 'auto_executed', 'sent')
       ), 0) AS budget_spent_today
     FROM continuous_operators o
     JOIN companies c ON o.company_id = c.id
     WHERE o.id = $1::uuid AND o.status = 'active'`,
    [operatorId]
  );
  if (operRes.rows.length === 0) return null;
  const operator = mapRowToOperator(operRes.rows[0]);

  // ★ D212+ 5번 (2026-05-23 Harold 명시): 예산 초과 차단 — 회사 admin 신뢰
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

  // 4. AI Operator 호출 (orchestrate) — 제안서 생성
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
      // ★ 계절 문안 주입 — objective는 불변, 그 달 시즌을 메시지 톤·소재로만(§6-8).
      seasonHint: buildSeasonPromptBlock(getSeasonContext(new Date()).month, ctx.business_type),
    }, { source: 'continuous-operator', cost: 0 });  // ★ 2026-06-02: 제안서 생성(매일)은 무과금 — 200은 저장 1회, 발송 시 문안 3로 재배치. source는 이력용 유지.
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
    // Operator의 next_run_at만 갱신하고 제안서는 생성 안 함
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }

  // 5. Zero-Count 영구 원칙 — 0건 매칭 시 제안서 생성 안 함
  const recipientCount = orchestratorResult.target?.count || 0;
  if (recipientCount === 0) {
    console.log(`[ContinuousOperator] ${operator.name} 0건 매칭 → 제안서 생성 안 함 (Zero-Count 영구 원칙)`);
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }

  // 6. 자동 발송 자격 체크 (ENT 옵션)
  const costEstimate = orchestratorResult.cost?.estimated || 0;
  const compliance = orchestratorResult.compliance || { passed: true, riskLevel: 'low' };
  const isAd = orchestratorResult.channel?.isAd || false;

  // 자율 발송 가능 조건(발신번호 + 문안 + SMS/LMS) — 스팸테스트·실발송에 필수. 미충족이면 수동 검토(pending)로.
  const channelForSpam = (orchestratorResult.channel?.recommended || 'SMS').toUpperCase();
  const callbackForSpam = String(companyInfo.callback || companyInfo.callback_number || ctx.reject_number || '').trim();
  const firstMsg = ((orchestratorResult.messages as any[]) || [])[0];
  const bestMessage = firstMsg ? String(firstMsg.body || firstMsg.message || '') : '';
  const bestSubject = firstMsg ? String(firstMsg.subject || '') : '';
  const canAutoSend = !!bestMessage && !!callbackForSpam && channelForSpam !== '카카오' && channelForSpam !== 'KAKAO';

  // ★ 2026-06-06 광고 가드: 광고면 무료거부 번호(080) 해석 결과가 있어야 자율 발송 자격(정보통신망법). 발송 직전 dispatchProposalSend에서도 재확인.
  const adOpt080 = isAd ? await getOpt080Number(operator.createdBy, operator.companyId) : '';
  const adRejectOk = !isAd || !!adOpt080;

  // ★ D210+ Phase 3 B-1: risk 회사별 max_risk 비교 (low<medium<high — 회사 max 초과 차단)
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
    canAutoSend &&
    adRejectOk;

  const autoExecuteReason = autoExecuteEligible
    ? `자동 실행 임계값 통과: ${recipientCount}명 / ${costEstimate.toLocaleString()}원 / ${compliance.riskLevel} risk (회사 max ${ctx.cdp_auto_execute_max_risk}) / non-ad`
    : `자동 실행 미통과 — ${[
        !ctx.cdp_auto_execute_enabled && '옵션 OFF',
        !['ENTERPRISE', 'BUSINESS'].includes(ctx.plan_code) && '요금제',
        recipientCount > ctx.cdp_auto_execute_max_recipients && `${recipientCount}건 > ${ctx.cdp_auto_execute_max_recipients}`,
        costEstimate > ctx.cdp_auto_execute_max_cost_krw && `${costEstimate}원 > ${ctx.cdp_auto_execute_max_cost_krw}원`,
        !riskWithinThreshold && `compliance ${compliance.riskLevel} > 회사 max ${ctx.cdp_auto_execute_max_risk}`,
        !compliance.passed && 'compliance fail',
        !canAutoSend && '발신번호·문안·채널(SMS/LMS) 미충족',
        !adRejectOk && '광고 무료거부 번호(080) 미설정',
      ].filter(Boolean).join(', ')}`;

  // 7. 제안서 INSERT — auto-eligible은 'scheduled'(T에 자율 발송) + scheduled_send_at, 아니면 'pending'(수동 검토)
  const leadMinutes = resolveAutoSendLeadMinutes(operator.autoSendLeadMinutes);
  const scheduledSendAt = computeScheduledSendAt(new Date(), leadMinutes);
  const proposalRes = await query(
    `INSERT INTO operator_proposals (
      id, operator_id, company_id, proposal_json, recipient_count, cost_estimate,
      status, auto_executed, auto_execute_reason, scheduled_send_at, expires_at, created_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3::jsonb, $4, $5,
      $6, $7, $8, $9, NOW() + INTERVAL '7 days', NOW()
    ) RETURNING *`,
    [
      operator.id,
      operator.companyId,
      JSON.stringify(orchestratorResult),
      recipientCount,
      costEstimate,
      autoExecuteEligible ? 'scheduled' : 'pending',
      autoExecuteEligible,
      autoExecuteReason,
      autoExecuteEligible ? scheduledSendAt : null,
    ]
  );

  // 8. D177 Self-Optimizing — message variants 생성 (Bandit 학습 기반)
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
      console.warn(`[ContinuousOperator] variant 생성 실패 (proposal=${proposalRes.rows[0].id}):`, err?.message || err);
    }
  }

  // 9. ★ D227+ 스팸 안전망 — 실제 테스트폰 발송 → 차단 시 AI 재생성(2회) → 재테스트 → 끝내 실패 시 담당자 검토.
  //    auto-campaign-worker와 동일한 검증된 자산(autoSpamTestWithRegenerate + generateMessages) 재사용.
  //    channelForSpam·callbackForSpam·bestMessage·bestSubject·canAutoSend는 위 자격 판정에서 계산됨.
  if (canAutoSend) {
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
           spam_test_status = $2, spam_test_retry_count = $3, spam_test_reasoning = $4
         WHERE id = $1::uuid`,
        [proposalRes.rows[0].id, finalResult, regenCount, outcome.reason],
      );

      if (outcome.status === 'admin_review') {
        // 끝내 통과 X → 담당자 검토 대기 (자동 발송 차단 + scheduled 해제, 자동 폐기 X)
        await query(
          `UPDATE operator_proposals SET status = 'admin_review', auto_executed = false, scheduled_send_at = NULL, auto_execute_reason = $2
           WHERE id = $1::uuid`,
          [proposalRes.rows[0].id, outcome.reason],
        );
        console.warn(`[ContinuousOperator] ${operator.name} 스팸 미통과 (재생성 ${regenCount}회) → 담당자 검토 대기`);
        // ★ 스팸 2회 재생성 후에도 실패 → 운영자 일시정지 + 담당자 사유 알림(설계 §1)
        await query(`UPDATE continuous_operators SET status = 'paused', updated_at = NOW() WHERE id = $1::uuid AND status = 'active'`, [operator.id]).catch(() => {});
        await notifyOperatorAdmins(operator, '[AI 자동마케팅] 일시정지', `'${operator.name}' 문안이 스팸필터를 통과하지 못해 자동마케팅을 일시정지했습니다. 문안 검토 후 재개해주세요.`).catch((e: any) => console.warn('[ContinuousOperator] 정지 알림 경고:', e?.message));
      } else {
        console.log(`[ContinuousOperator] ${operator.name} 스팸 통과 (재생성 ${regenCount}회)`);
        // 자율 발송 예정(scheduled) → 담당자에 실문안 + 정지 안내 (준비 시점 알림, 무과금 인증 라인)
        if (autoExecuteEligible) {
          await sendAutoSendPrepNotice(operator, proposalRes.rows[0].id, bestMessage, scheduledSendAt).catch((e: any) => console.warn('[ContinuousOperator] 준비 알림 경고:', e?.message));
        }
      }
    } catch (err: any) {
      console.warn(`[ContinuousOperator] 스팸테스트 오류:`, err?.message);
      // 스팸 검증 실패 = 자동 발송 금지. scheduled였으면 담당자 검토로 내림(미검증 발송 차단).
      if (autoExecuteEligible) {
        await query(
          `UPDATE operator_proposals SET status = 'admin_review', auto_executed = false, scheduled_send_at = NULL,
             auto_execute_reason = '스팸 검증 오류 — 담당자 검토 필요' WHERE id = $1::uuid`,
          [proposalRes.rows[0].id],
        ).catch(() => {});
      }
    }
  }

  // (검증 7일 게이팅 제거 — verification_* 컬럼은 보존하되 자율 발송 흐름에서 미사용. 스팸 통과만으로 'scheduled'.)

  // 11. Operator 통계 갱신
  await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 1, autoExecuteEligible);

  console.log(`[ContinuousOperator] ${operator.name} 제안서 생성 완료 (${recipientCount}명 / ${costEstimate}원 / ${autoExecuteEligible ? '자동 실행' : 'pending'} / variants ${messages.length}건 / 정책 ${operator.deliveryPolicy})`);

  // 자율 발송 크레딧(continuous-operator-send)은 실제 발송 성공 시점에 1회 차감(멱등키 proposalId) — runAutoSendPass에서 처리.
  return mapRowToProposal(proposalRes.rows[0]);
}

// ★ D212+ 정책 (2026-05-23 Harold 명시): 담당자 정지 — AI 학습 통합
export async function adminStopProposal(
  companyId: string,
  proposalId: string,
  stopReason: { reason: 'spam_suspicion' | 'content_correction' | 'no_send' | 'other'; detail?: string },
): Promise<boolean> {
  // 회사 격리 + proposal 조회 (scheduled = 자율 발송 대기분도 정지 가능 — 정지 창)
  const r = await query(
    `SELECT id, proposal_json FROM operator_proposals
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('pending', 'admin_review', 'scheduled')`,
    [proposalId, companyId],
  );
  if (r.rows.length === 0) return false;

  const proposal = r.rows[0];
  const messageBody = proposal.proposal_json?.messages?.[0]?.body || proposal.proposal_json?.messages?.[0]?.message || '';

  // 정지 처리 — scheduled_send_at 해제로 발송 패스에서 제외
  await query(
    `UPDATE operator_proposals SET
       status = 'admin_stopped',
       admin_response = 'stopped',
       admin_stop_reason = $2,
       scheduled_send_at = NULL,
       reviewed_at = NOW()
     WHERE id = $1::uuid`,
    [proposalId, JSON.stringify(stopReason)],
  );

  // 담당자 정지 사유 → ai_company_memory 학습 (다음 생성에 반영)
  await recordAdminStopLearning(companyId, proposalId, stopReason, messageBody);

  return true;
}

// ★ D212+ 정책 (2026-05-23 Harold 명시): 회사 admin 매일 컨펌
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
  // 지정 요일/날짜 반영 — 컬럼 미존재(ALTER 전) 환경에서도 안전하게 fallback
  let dow: number | null = null;
  let dom: number | null = null;
  try {
    const dayRes = await query(
      `SELECT schedule_day_of_week, schedule_day_of_month FROM continuous_operators WHERE id = $1::uuid`,
      [operatorId]
    );
    dow = dayRes.rows[0]?.schedule_day_of_week ?? null;
    dom = dayRes.rows[0]?.schedule_day_of_month ?? null;
  } catch { /* 컬럼 미존재 시 기존 동작 유지 */ }
  const nextRunAt = computeNextRun(schedule, scheduleTime, dow, dom);
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
  // 만료 자동 처리 (조회 시점에 한 번 실행)
  await query(
    `UPDATE operator_proposals SET status = 'expired'
     WHERE company_id = $1::uuid AND status = 'pending' AND expires_at < NOW()`,
    [companyId]
  );

  // ★ D227+ pending 조회 시 admin_review(스팸 미통과 담당자 검토 대기)도 함께 노출 — 담당자가 한 탭에서 처리
  const params: any[] = [companyId];
  let statusFilter = '';
  if (status !== 'all') {
    if (status === 'pending') {
      statusFilter = `AND p.status IN ('pending', 'admin_review', 'scheduled')`;
    } else {
      params.push(status);
      statusFilter = `AND p.status = $${params.length}`;
    }
  }
  params.push(Math.min(limit, 200));
  const result = await query(
    `SELECT p.*, o.name AS operator_name, o.objective AS operator_objective
     FROM operator_proposals p
     LEFT JOIN continuous_operators o ON p.operator_id = o.id
     WHERE p.company_id = $1::uuid ${statusFilter}
     ORDER BY p.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(mapRowToProposal);
}

export async function approveProposal(
  companyId: string,
  proposalId: string,
  userId: string
): Promise<{ ok: boolean; reason?: string; action?: 'sent' | 'skipped'; campaignId?: string; sentCount?: number }> {
  // claim: pending/admin_review → sending. 백엔드에서 바로 발송(자동 경로와 동일)해 크레딧↔발송 원자성 확보.
  const claim = await query(
    `UPDATE operator_proposals SET
       status = 'sending',
       reviewed_by = $3::uuid,
       reviewed_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('pending', 'admin_review')
     RETURNING *`,
    [proposalId, companyId, userId]
  );
  if (claim.rows.length === 0) {
    return { ok: false, reason: '승인 가능한 상태가 아니거나 권한이 없는 제안서입니다.' };
  }

  // 통계 갱신
  await query(
    `UPDATE continuous_operators SET total_approved = total_approved + 1, updated_at = NOW()
     WHERE id = $1::uuid`,
    [claim.rows[0].operator_id]
  );

  // 발송 — dispatchProposalSend 공유. 크레딧은 발송 성공 시점 1회(멱등키 proposalId).
  const r = await dispatchProposalSend(claim.rows[0]);
  return { ok: true, ...r };
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

    // 발송 패스 — scheduled_send_at(준비+lead) 도달한 자율 발송 제안서를 직접발송 파이프라인으로 처리.
    await runAutoSendPass().catch((e: any) => console.error('[ContinuousOperator AutoSend] 패스 예외:', e?.message || e));
  } finally {
    workerRunning = false;
  }

  return { processed, failed };
}

// ════════════════════════════════════════════════════════════════════
// 자율 발송 패스 — scheduled_send_at(준비+lead) 도달 제안서를 직접발송 파이프라인으로 발송
// ════════════════════════════════════════════════════════════════════

export async function runAutoSendPass(limit: number = 20): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;
  const due = await query(
    `SELECT id FROM operator_proposals
     WHERE status = 'scheduled' AND scheduled_send_at IS NOT NULL AND scheduled_send_at <= NOW()
     ORDER BY scheduled_send_at ASC
     LIMIT $1`,
    [limit],
  );
  for (const row of due.rows) {
    try {
      const r = await sendScheduledProposal(row.id);
      if (r === 'sent') sent++; else skipped++;
    } catch (err: any) {
      skipped++;
      console.error(`[ContinuousOperator AutoSend] ${row.id} 발송 실패:`, err?.message || err);
    }
  }
  // 'sending' 정지 복구 — 매 패스 점검: campaign_id 있으면 'sent' 마감, 없고 claim 후 노후면 'admin_review'(자동 재발송 X).
  await reconcileStuckSending().catch((e: any) => console.error('[ContinuousOperator AutoSend] 정지 복구 예외:', e?.message || e));

  if (due.rows.length > 0) {
    console.log(`[ContinuousOperator AutoSend] ${sent} 발송 / ${skipped} 스킵`);
  }
  return { sent, skipped };
}

/** 'sending'에 정지된 제안 복구(decideStuckSendingRecovery 순수 정책). campaign 'sending' 자동정리 패턴 미러. */
async function reconcileStuckSending(staleMinutes: number = 30): Promise<void> {
  const stuck = await query(
    `SELECT id, company_id, operator_id, campaign_id, reviewed_at
     FROM operator_proposals WHERE status = 'sending' LIMIT 100`,
  );
  for (const row of stuck.rows) {
    const action = decideStuckSendingRecovery(
      { campaignId: row.campaign_id || null, reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null },
      new Date(),
      staleMinutes,
    );
    if (action === 'mark_sent') {
      // 발송 커밋됨(마커 있음) → 최종 상태만 마감 + 크래시로 누락됐을 수 있는 크레딧 멱등 보강.
      const upd = await query(
        `UPDATE operator_proposals SET status = 'sent', auto_sent_at = COALESCE(auto_sent_at, NOW())
         WHERE id = $1::uuid AND status = 'sending' AND campaign_id IS NOT NULL RETURNING id`,
        [row.id],
      ).catch(() => ({ rows: [] as any[] }));
      if (upd.rows.length > 0) {
        // 발송 직후(campaign_id 마커)~차감 사이 중단으로 차감이 빠졌을 수 있어 1회 보강.
        // 멱등키 proposalId = dispatchProposalSend의 정상 차감과 동일 키 → 정상분은 skip(중복 0).
        const opRes = await query(
          `SELECT created_by FROM continuous_operators WHERE id = $1::uuid`,
          [row.operator_id],
        ).catch(() => ({ rows: [] as any[] }));
        const createdBy = opRes.rows[0]?.created_by || row.company_id;
        await deductCreditSafe({
          companyId: row.company_id,
          cost: getCreditCost('continuous-operator-send'),
          source: 'continuous-operator-send',
          createdBy,
          idempotencyKey: `continuous-operator-send:${row.id}`,
        }).catch((e: any) => console.warn('[ContinuousOperator AutoSend] 정지복구 크레딧 보강 경고:', e?.message));
      }
    } else if (action === 'demote_admin_review') {
      // 커밋 전 중단(마커 없음) + 노후 → 담당자 검토(절대 자동 재발송 X).
      const upd = await query(
        `UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL,
           auto_execute_reason = '발송 준비 중단 — 담당자 검토 (자동 복구)'
         WHERE id = $1::uuid AND status = 'sending' AND campaign_id IS NULL RETURNING id`,
        [row.id],
      ).catch(() => ({ rows: [] as any[] }));
      if (upd.rows.length > 0) {
        const opRes = await query(
          `SELECT name, admin_phone_numbers, backup_admin_phone FROM continuous_operators WHERE id = $1::uuid`,
          [row.operator_id],
        ).catch(() => ({ rows: [] as any[] }));
        const op = opRes.rows[0] || {};
        await notifyOperatorAdmins(
          { adminPhoneNumbers: Array.isArray(op.admin_phone_numbers) ? op.admin_phone_numbers : [], backupAdminPhone: op.backup_admin_phone || null, companyId: row.company_id },
          '[AI 자동마케팅] 발송 보류', `'${op.name || ''}' 발송 준비가 중단되어 담당자 검토로 전환했습니다.`,
        ).catch(() => {});
      }
    }
  }
}

async function sendScheduledProposal(proposalId: string): Promise<'sent' | 'skipped'> {
  // claim (scheduled → sending) — 동시 발송/중복 방지
  const claim = await query(
    `UPDATE operator_proposals SET status = 'sending', reviewed_at = NOW()
     WHERE id = $1::uuid AND status = 'scheduled' RETURNING *`,
    [proposalId],
  );
  if (claim.rows.length === 0) return 'skipped'; // 다른 패스가 선점했거나 담당자가 정지함
  const r = await dispatchProposalSend(claim.rows[0]);
  return r.action;
}

/**
 * claim된('sending') 제안을 직접발송 파이프라인으로 발송 — 자동(scheduled)·수동(승인) 공유.
 * 크레딧은 발송 성공 시점 1회(멱등). 0건/잔액/발신번호 미설정은 skip + 통지.
 */
async function dispatchProposalSend(p: any): Promise<{ action: 'sent' | 'skipped'; campaignId?: string; sentCount?: number; reason?: string }> {
  const proposalId: string = p.id;
  const companyId: string = p.company_id;
  const pj: any = p.proposal_json || {};

  // 통지/발신자 컨텍스트 — 커밋 전 예외는 아래 try가 'sending'을 admin_review로 내려 정지 방지.
  let op: any = {};
  let userId: string = companyId;
  const notify = (title: string, body: string) =>
    notifyOperatorAdmins(
      { adminPhoneNumbers: Array.isArray(op.admin_phone_numbers) ? op.admin_phone_numbers : [], backupAdminPhone: op.backup_admin_phone || null, companyId },
      title, body,
    ).catch((e: any) => console.warn('[ContinuousOperator AutoSend] 통지 경고:', e?.message));

  // 메시지/채널 (스팸 통과 본문) — 광고 가드에 isAd 필요해 먼저 계산.
  const msg = pj.messages?.[0] || {};
  const body = String(msg.body || msg.message || '');
  const subject = String(msg.subject || '');
  const channel = String(pj.channel?.recommended || 'SMS').toUpperCase();
  const msgType = (channel === 'LMS' || channel === 'MMS') ? channel : 'SMS';
  const isAd = !!(pj.channel?.isAd);  // 광고성이면 발송 시 (광고)·무료거부 080 자동 합성(direct-send-worker)

  let stagingId = '';
  let rows: any[] = [];
  let callback: string | null = null;
  try {
    // operator(통지 대상 · created_by)
    const opRes = await query(
      `SELECT created_by, name, admin_phone_numbers, backup_admin_phone FROM continuous_operators WHERE id = $1::uuid`,
      [p.operator_id],
    );
    op = opRes.rows[0] || {};
    userId = op.created_by || companyId;

    // 광고 가드 — 광고면 무료거부 번호(080) 해석 결과 필수(정보통신망법). 없으면 발송 보류(담당자 검토).
    if (isAd) {
      const opt080 = await getOpt080Number(op.created_by || null, companyId);
      if (!opt080) {
        await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '광고 무료거부 번호(080) 미설정 — 발송 보류' WHERE id = $1::uuid`, [proposalId]);
        await notify('[AI 자동마케팅] 발송 보류', `'${op.name || ''}' 광고 무료거부 번호(080)가 없어 발송을 보류했습니다. 080 등록 후 다시 진행해주세요.`);
        return { action: 'skipped', reason: '광고 무료거부 번호(080) 미설정' };
      }
    }

    // 발송 시점 타겟 재추출 (공통 안전필터 — 정지 창 동안 새 수신거부 반영)
    const filters = pj.target?.filters || {};
    const { sql: filterWhere, params: filterParams } = buildFilterWhereClauseCompat(filters, 2);
    const { sql: recSql, params: recParams } = buildSendableRecipientsSql(filterWhere, filterParams, [companyId], '');
    rows = (await query(recSql, recParams)).rows;

    // 0건 → 스킵 + 통지 (operator는 다음 주기 정상)
    const outcome = decideSendOutcome({ recipientCount: rows.length, balanceOk: true });
    if (outcome.action === 'skip') {
      await query(`UPDATE operator_proposals SET status = 'skipped', auto_execute_reason = $2 WHERE id = $1::uuid`, [proposalId, outcome.reason]);
      if (outcome.notify) await notify('[AI 자동마케팅] 발송 생략', `'${op.name || ''}' 이번 사이클은 ${outcome.reason}.`);
      return { action: 'skipped', reason: outcome.reason };
    }

    // 발송 발신번호 (회사 기본 등록 번호)
    const cbRes = await query(
      `SELECT REPLACE(phone, '-', '') AS phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1`,
      [companyId],
    );
    callback = cbRes.rows[0]?.phone || null;
    if (!callback) {
      await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '발신번호 미설정 — 발송 보류' WHERE id = $1::uuid`, [proposalId]);
      await notify('[AI 자동마케팅] 발송 보류', `'${op.name || ''}' 등록된 발신번호가 없어 발송을 보류했습니다.`);
      return { action: 'skipped', reason: '발신번호 미설정' };
    }

    // staging 적재 (phone + name — %고객명% 치환용; 그 외 변수는 발송기가 customers 재조회로 치환)
    stagingId = randomUUID();
    const phones = rows.map((r: any) => String(r.phone || '').replace(/\D/g, ''));
    const names = rows.map((r: any) => (r.name ?? null));
    await query(
      `INSERT INTO campaign_send_staging (staging_id, company_id, phone, name)
       SELECT $1::uuid, $2::uuid, u.phone, u.name FROM UNNEST($3::text[], $4::text[]) AS u(phone, name)`,
      [stagingId, companyId, phones, names],
    );
  } catch (preErr: any) {
    // 발송 커밋 전 예외 → 'sending' 정지 방지: 담당자 검토로 내리고(자동 재발송 X) 통지 후 재던짐.
    await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '발송 준비 오류 — 담당자 검토' WHERE id = $1::uuid AND status = 'sending'`, [proposalId]).catch(() => {});
    await notify('[AI 자동마케팅] 발송 보류', `'${op.name || ''}' 발송 준비 중 오류로 보류했습니다. 담당자 검토가 필요합니다.`);
    throw preErr;
  }

  // 발송 (직접발송 파이프라인 공유) — 잔액 부족이면 skip+통지
  let campaignId: string;
  try {
    const res = await createDirectSendCampaign(
      {
        stagingId,
        campaignName: `AI 자동마케팅 ${op.name || ''} ${new Date().toLocaleDateString('ko-KR')}`,
        msgType, message: body, subject: subject || null, callback, sendChannel: 'sms',
        adEnabled: isAd, total: rows.length, dedupEnabled: true, unsubFilterEnabled: true,
      },
      { companyId, userId },
      { finalSource: 'selected_as_is', aiMessages: [body] },
    );
    campaignId = res.campaignId;
  } catch (e: any) {
    if (e instanceof DirectSendError && e.code === 'INSUFFICIENT_BALANCE') {
      await query(`UPDATE operator_proposals SET status = 'skipped', auto_execute_reason = '잔액 부족 — 발송 생략' WHERE id = $1::uuid`, [proposalId]);
      await notify('[AI 자동마케팅] 발송 생략', `'${op.name || ''}' 잔액 부족으로 이번 사이클 발송을 생략했습니다.`);
      return { action: 'skipped', reason: '잔액 부족' };
    }
    await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '발송 오류 — 담당자 검토' WHERE id = $1::uuid`, [proposalId]).catch(() => {});
    throw e;
  }

  // 발송 커밋 마커 — campaign_id 즉시 기록. 이후 최종 UPDATE가 실패해도 정리 패스가 'sent'로 마감(정지 방지·재발송 X).
  await query(`UPDATE operator_proposals SET campaign_id = $2::uuid WHERE id = $1::uuid`, [proposalId, campaignId]).catch((e: any) => console.warn('[ContinuousOperator AutoSend] campaign_id 기록 경고:', e?.message));

  // 기능 크레딧 1회 차감 (멱등키 proposalId) — 발송 성공 시점에만
  await deductCreditSafe({
    companyId, cost: getCreditCost('continuous-operator-send'), source: 'continuous-operator-send',
    createdBy: userId, idempotencyKey: `continuous-operator-send:${proposalId}`,
  }).catch((e: any) => console.warn('[ContinuousOperator AutoSend] 크레딧 차감 경고:', e?.message));

  // 완료 표시 + 통지
  await query(
    `UPDATE operator_proposals SET status = 'sent', auto_sent_at = NOW() WHERE id = $1::uuid AND status = 'sending'`,
    [proposalId],
  );
  await notify('[AI 자동마케팅] 발송 완료', `'${op.name || ''}' ${rows.length}명에게 발송을 완료했습니다.`);
  return { action: 'sent', campaignId, sentCount: rows.length };
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
  console.log('[ContinuousOperator Worker] 스케줄러 시작 (5분 주기)');
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

/** 준비 시점 담당자 알림 — 실문안 1건 + 정지 안내 1건(무과금 인증 라인). admin_notified_at 기록. */
async function sendAutoSendPrepNotice(
  operator: { adminPhoneNumbers: string[]; backupAdminPhone: string | null; companyId: string; name: string },
  proposalId: string,
  messageBody: string,
  scheduledSendAt: Date,
): Promise<void> {
  const when = scheduledSendAt.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  // 1. 실문안 (고객이 받을 본문 그대로)
  await notifyOperatorAdmins(operator, '[AI 자동마케팅] 발송 예정 문안', messageBody);
  // 2. 정지 안내
  await notifyOperatorAdmins(
    operator,
    '[AI 자동마케팅] 발송 예정 안내',
    `${when}에 위 문안이 자동 발송됩니다. 원치 않으시면 그 전에 자동마케팅 메뉴에서 [정지]를 눌러주세요.`,
  );
  await query(`UPDATE operator_proposals SET admin_notified_at = NOW() WHERE id = $1::uuid`, [proposalId]);
}

function computeNextRun(
  schedule: OperatorSchedule,
  scheduleTime: string,
  dayOfWeek: number | null = null,
  dayOfMonth: number | null = null,
): Date {
  // KST 기준 schedule_time(HH:mm)에 다음 실행
  const [hStr, mStr] = scheduleTime.split(':');
  const h = parseInt(hStr) || 9;
  const m = parseInt(mStr) || 0;

  // 한국 시간 기준 — UTC = KST - 9h
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC → KST
  const target = new Date(kstNow);
  target.setUTCHours(h, m, 0, 0);

  if (schedule === 'weekly' && dayOfWeek != null) {
    // 지정 요일(0=일~6=토)로 — 같은 요일이고 시간이 지났으면 다음 주
    let diff = (dayOfWeek - target.getUTCDay() + 7) % 7;
    if (diff === 0 && target.getTime() <= kstNow.getTime()) diff = 7;
    target.setUTCDate(target.getUTCDate() + diff);
  } else if (schedule === 'monthly' && dayOfMonth != null) {
    // 지정 날짜로 — 말일 초과 시 그 달 말일로 클램프, 이번 달 지났으면 다음 달
    const clampToMonth = (t: Date) => {
      const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
      t.setUTCDate(Math.min(dayOfMonth, last));
    };
    target.setUTCDate(1);
    clampToMonth(target);
    if (target.getTime() <= kstNow.getTime()) {
      target.setUTCMonth(target.getUTCMonth() + 1, 1);
      clampToMonth(target);
    }
  } else if (target.getTime() <= kstNow.getTime()) {
    // 요일/날짜 미지정 — 기존 fallback(현재 요일/날짜 유지)
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
    scheduleDayOfWeek: row.schedule_day_of_week ?? null,
    scheduleDayOfMonth: row.schedule_day_of_month ?? null,
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
    autoSendLeadMinutes: row.auto_send_lead_minutes !== null && row.auto_send_lead_minutes !== undefined ? Number(row.auto_send_lead_minutes) : null,
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
