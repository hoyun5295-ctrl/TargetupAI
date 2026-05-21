/**
 * CT-44: Journey Executor — D187 (2026-05-20)
 *
 * 목적
 *   활성 여정의 due execution을 5분 cron으로 처리하여 step별 메시지를 발송합니다.
 *
 * 핵심 흐름
 *   1. journey_executions.next_run_at <= NOW() AND status='active' 조회 (LIMIT 100)
 *   2. 각 execution: journey + step 로드, 정합성 검증
 *   3. 발송 시간 검증 (KST 08:00 ~ 21:00) — 광고 자동 검증 4건 중 1건 (Harold 명시 정합)
 *   4. 임계값 검증 (회사 자유 — NULL = 무제한 default)
 *      - budget_monthly: 월간 누적 비용 + 신규 비용 ≤ budget_monthly
 *      - threshold_cost_per_step: 단건 비용 ≤ threshold
 *   5. 잔액 검증 (prepaidDeduct atomic) — 부족 시 여정 paused
 *   6. prepareSendMessage(buildAdMessage + buildAdSubject) → 광고 자동 검증 4건 중 3건
 *   7. bulkInsertSmsQueue (1 row) — MySQL 발송 큐
 *   8. campaigns INSERT (source='journey') + journey_step_logs INSERT
 *   9. journey_executions advance: 다음 step 있으면 next_run_at = NOW() + delay_hours
 *      마지막 step이면 status='completed', completed_at=NOW(), 여정 stats 갱신
 *
 * 영구 원칙 정합
 *   - no_target_auto_relax: 0건 / 잔액 부족 / 임계값 초과 = 자동 완화 없음, 명시적 차단
 *   - ai_operator_model_isolation: executor는 AI 호출 영역 없음 (journey-builder만 Opus 4.7)
 *   - 회사 격리: 모든 SQL company_id 필수
 *   - no_humuson_keyword_exposure: 검수 단어 없음
 */

import { query } from '../config/database';
import {
  getCompanySmsTables,
  hasCompanyLineGroup,
  bulkInsertSmsQueue,
} from './sms-queue';
import {
  prepareSendMessage,
  prepareFieldMappings,
  getOpt080Number,
} from './messageUtils';
import { prepaidDeduct } from './prepaid';
import { normalizePhone } from './normalize-phone';
import { getCompanyCosts } from '../config/defaults';
import { sanitizeForSms } from './message-sanitizer';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

interface ExecutionRow {
  execution_id: string;
  journey_id: string;
  company_id: string;
  customer_id: string;
  current_step_order: number;
  status: string;
  next_run_at: Date | null;
  entered_at: Date;
  total_cost: number;
  // journey 컬럼
  journey_status: string;
  budget_monthly: number | null;
  threshold_cost_per_step: number | null;
  threshold_recipients_per_step: number | null;
  stats_total_completed: number;
  stats_total_cost: number;
  created_by: string | null;
  journey_callback_number: string | null;
}

interface StepRow {
  id: string;
  journey_id: string;
  step_order: number;
  step_type: string;
  delay_hours: number;
  channel: string | null;
  message_template: string | null;
  subject: string | null;
  is_ad: boolean;
}

interface CustomerRow {
  id: string;
  phone: string;
  name: string | null;
  is_active: boolean;
  sms_opt_in: boolean;
  callback: string | null;
  custom_fields: Record<string, any> | null;
  email: string | null;
  birth_date: Date | null;
  recent_purchase_date: Date | null;
}

type StepOutcome = 'sent' | 'skipped_hours' | 'skipped_opt_out' | 'skipped_no_customer' | 'paused_balance' | 'paused_budget' | 'paused_threshold' | 'failed' | 'completed';

// ════════════════════════════════════════════════════════════════════
// Worker — 5분 cron
// ════════════════════════════════════════════════════════════════════

let workerRunning = false;

export async function runJourneyExecutor(): Promise<{ processed: number; sent: number; skipped: number; paused: number; failed: number }> {
  if (workerRunning) {
    return { processed: 0, sent: 0, skipped: 0, paused: 0, failed: 0 };
  }
  workerRunning = true;

  const summary = { processed: 0, sent: 0, skipped: 0, paused: 0, failed: 0 };

  try {
    const dueRes = await query(
      `SELECT
         e.id AS execution_id,
         e.journey_id, e.customer_id,
         e.current_step_order, e.status, e.next_run_at, e.entered_at, e.total_cost,
         j.company_id, j.status AS journey_status,
         j.budget_monthly, j.threshold_cost_per_step, j.threshold_recipients_per_step,
         j.stats_total_completed, j.stats_total_cost, j.created_by,
         j.callback_number AS journey_callback_number
       FROM journey_executions e
       JOIN journeys j ON e.journey_id = j.id
       WHERE e.status = 'active'
         AND j.status = 'active'
         AND e.next_run_at IS NOT NULL
         AND e.next_run_at <= NOW()
       ORDER BY e.next_run_at ASC
       LIMIT 100`
    );

    for (const row of dueRes.rows as ExecutionRow[]) {
      summary.processed++;
      try {
        const outcome = await processExecution(row);
        if (outcome === 'sent') summary.sent++;
        else if (outcome === 'completed') summary.sent++;
        else if (outcome.startsWith('paused')) summary.paused++;
        else if (outcome.startsWith('skipped')) summary.skipped++;
        else if (outcome === 'failed') summary.failed++;
      } catch (err: any) {
        summary.failed++;
        console.error(`[JourneyExecutor] execution=${row.execution_id} 처리 실패:`, err?.message || err);
      }
    }

    if (dueRes.rows.length > 0) {
      console.log(`[JourneyExecutor] 처리 완료 — sent=${summary.sent} skipped=${summary.skipped} paused=${summary.paused} failed=${summary.failed}`);
    }
  } finally {
    workerRunning = false;
  }

  return summary;
}

export function startJourneyExecutor(): void {
  const intervalMs = 5 * 60 * 1000;
  setInterval(() => {
    runJourneyExecutor().catch((err) => console.error('[JourneyExecutor] 예외:', err));
  }, intervalMs);
  setTimeout(() => {
    runJourneyExecutor().catch((err) => console.error('[JourneyExecutor] 초기 실행 예외:', err));
  }, 60 * 1000);
  console.log('[JourneyExecutor] 스케줄러 시작 (5분 주기)');
}

// ════════════════════════════════════════════════════════════════════
// 단일 execution 처리
// ════════════════════════════════════════════════════════════════════

async function processExecution(exec: ExecutionRow): Promise<StepOutcome> {
  // 1. 다음 step 조회 (현재 current_step_order + 1)
  const nextStepOrder = exec.current_step_order + 1;
  const stepRes = await query(
    `SELECT id, journey_id, step_order, step_type, delay_hours, channel, message_template, subject, is_ad
     FROM journey_steps
     WHERE journey_id = $1::uuid AND step_order = $2`,
    [exec.journey_id, nextStepOrder]
  );

  if (stepRes.rows.length === 0) {
    await markExecutionCompleted(exec.execution_id, exec.journey_id);
    return 'completed';
  }

  const step = stepRes.rows[0] as StepRow;

  // 2. 발송 시간 검증 (KST 08:00 ~ 21:00)
  if (!isWithinSendHours()) {
    const nextWindow = computeNextSendWindow();
    await query(
      `UPDATE journey_executions SET next_run_at = $2 WHERE id = $1::uuid`,
      [exec.execution_id, nextWindow]
    );
    return 'skipped_hours';
  }

  // 3. 고객 조회 + opt-in 검증
  const custRes = await query(
    `SELECT id, phone, name, is_active, sms_opt_in, callback, custom_fields, email, birth_date, recent_purchase_date
     FROM customers WHERE id = $1::uuid AND company_id = $2::uuid`,
    [exec.customer_id, exec.company_id]
  );
  if (custRes.rows.length === 0) {
    await logSkippedStep(exec.execution_id, step.id, 'customer_not_found');
    await advanceOrComplete(exec, step, 0);
    return 'skipped_no_customer';
  }
  const customer = custRes.rows[0] as CustomerRow;

  if (!customer.is_active || !customer.sms_opt_in) {
    await logSkippedStep(exec.execution_id, step.id, 'opt_out_or_inactive');
    await advanceOrComplete(exec, step, 0);
    return 'skipped_opt_out';
  }

  // 4. 수신거부 별 검증 (user_id 기준)
  if (exec.created_by) {
    const unsubRes = await query(
      `SELECT 1 FROM unsubscribes WHERE user_id = $1::uuid AND phone = $2 LIMIT 1`,
      [exec.created_by, customer.phone]
    );
    if (unsubRes.rows.length > 0) {
      await logSkippedStep(exec.execution_id, step.id, 'unsubscribed');
      await advanceOrComplete(exec, step, 0);
      return 'skipped_opt_out';
    }
  }

  // 5. 라인그룹 검증
  if (!(await hasCompanyLineGroup(exec.company_id))) {
    await pauseJourney(exec.journey_id, '발송 라인그룹 미설정');
    await logFailedStep(exec.execution_id, step.id, 'line_group_not_set');
    return 'failed';
  }

  // 5-2. 회신번호 정합 — 회사 admin 선택(journey.callback_number) 우선, fallback customer.callback
  const callbackNumber = String(exec.journey_callback_number || customer.callback || '').trim();
  if (!callbackNumber) {
    await pauseJourney(exec.journey_id, '회신번호가 비어있어 발송 차단됨');
    await logFailedStep(exec.execution_id, step.id, 'callback_number_empty');
    return 'failed';
  }

  // 6. 메시지 + 비용 계산
  const channelType = (step.channel || 'lms').toUpperCase();
  const msgType = channelType === 'LMS' || channelType === 'MMS' ? channelType : 'SMS';
  const fieldMappings = await prepareFieldMappings(exec.company_id);
  const opt080Number = await getOpt080Number(exec.created_by, exec.company_id);

  // 광고 표기 — step.is_ad (DB default true) → buildAdMessage가 (광고)+080+KISA 제목 자동 합성
  const isAd = step.is_ad !== false;

  // ★ D187-fix5: 발송 직전 최후 안전망 — sanitize 자동 적용 (이모지/비표준 특수문자 제거)
  const sanTemplate = sanitizeForSms(step.message_template || '');
  const sanSubject = sanitizeForSms(step.subject || '');
  if (sanTemplate.hadChanges) {
    console.log(`[JourneyExecutor] step ${step.step_order} 본문 sanitize:`, sanTemplate.warnings.join(' / '));
  }
  if (sanSubject.hadChanges) {
    console.log(`[JourneyExecutor] step ${step.step_order} 제목 sanitize:`, sanSubject.warnings.join(' / '));
  }

  const { message, subject } = prepareSendMessage(
    sanTemplate.sanitized,
    customer as Record<string, any>,
    fieldMappings,
    { msgType, isAd, opt080Number, subject: sanSubject.sanitized }
  );

  // LMS/MMS인데 subject 비어있으면 발송 차단 (통신사 정책 위반 차단)
  if ((msgType === 'LMS' || msgType === 'MMS') && (!subject || subject.trim().length === 0)) {
    await pauseJourney(exec.journey_id, `step ${step.step_order} 제목이 비어있어 LMS/MMS 발송 차단`);
    await logFailedStep(exec.execution_id, step.id, 'subject_empty_for_lms_mms');
    return 'failed';
  }

  if (!message || message.trim().length < 2) {
    await logFailedStep(exec.execution_id, step.id, 'empty_message_after_prepare');
    await advanceOrComplete(exec, step, 0);
    return 'failed';
  }

  // 비용 산정 (회사별 단가)
  const compRes = await query(
    `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1::uuid`,
    [exec.company_id]
  );
  const costs = getCompanyCosts(compRes.rows[0] || {});
  const unitCost = msgType === 'LMS' ? Number(costs.lms) : msgType === 'MMS' ? Number(costs.mms) : Number(costs.sms);
  const sendCost = Math.round(unitCost);

  // 7. 임계값 검증 (회사 자유 — NULL = 무제한)
  if (exec.threshold_cost_per_step != null && sendCost > Number(exec.threshold_cost_per_step)) {
    await pauseJourney(exec.journey_id, `step 비용 ${sendCost.toLocaleString()}원 > 임계값 ${Number(exec.threshold_cost_per_step).toLocaleString()}원`);
    await logFailedStep(exec.execution_id, step.id, 'threshold_cost_exceeded');
    return 'paused_threshold';
  }

  if (exec.budget_monthly != null) {
    const monthCostRes = await query(
      `SELECT COALESCE(SUM(stats_total_cost), 0) AS month_cost
       FROM journeys WHERE id = $1::uuid AND DATE_TRUNC('month', updated_at) = DATE_TRUNC('month', NOW())`,
      [exec.journey_id]
    );
    const monthCost = Number(monthCostRes.rows[0]?.month_cost || 0);
    if (monthCost + sendCost > Number(exec.budget_monthly)) {
      await pauseJourney(exec.journey_id, `월간 누적 ${(monthCost + sendCost).toLocaleString()}원 > 예산 ${Number(exec.budget_monthly).toLocaleString()}원`);
      await logFailedStep(exec.execution_id, step.id, 'budget_monthly_exceeded');
      return 'paused_budget';
    }
  }

  // 8. 잔액 차감 (atomic)
  const deduct = await prepaidDeduct(exec.company_id, 1, msgType, exec.journey_id, exec.created_by || undefined);
  if (!deduct.ok) {
    await pauseJourney(exec.journey_id, deduct.error || '잔액 부족');
    await logFailedStep(exec.execution_id, step.id, 'insufficient_balance');
    return 'paused_balance';
  }

  // 9. campaigns INSERT (source='journey' — 추적 정합)
  const cleanPhone = normalizePhone(customer.phone);
  if (!cleanPhone) {
    await logFailedStep(exec.execution_id, step.id, 'invalid_phone');
    await advanceOrComplete(exec, step, sendCost);
    return 'failed';
  }

  const campaignRes = await query(
    `INSERT INTO campaigns (
      company_id, campaign_name, message_type, message_content, subject, message_subject, message_template,
      is_ad, target_count, sent_count, created_by, send_channel, callback_number, status, scheduled_at, sent_at
    ) VALUES (
      $1::uuid, $2, $3, $4, $5, $5, $4,
      $6, 1, 1, $7::uuid, 'sms', $8, 'sending', NOW(), NOW()
    ) RETURNING id`,
    [
      exec.company_id,
      `[여정] step ${step.step_order}`,
      msgType,
      message,
      subject || null,
      isAd,
      exec.created_by,
      callbackNumber,
    ]
  );
  const campaignId = campaignRes.rows[0].id as string;

  // 10. bulkInsertSmsQueue (단건)
  try {
    const tables = await getCompanySmsTables(exec.company_id, exec.created_by || undefined);
    if (tables.length === 0) {
      await pauseJourney(exec.journey_id, 'SMS 발송 테이블 미할당');
      await logFailedStep(exec.execution_id, step.id, 'no_sms_tables');
      return 'failed';
    }

    const row = [
      cleanPhone,
      callbackNumber,
      message,
      msgType,
      subject || '',
      new Date(),
      exec.company_id,
      `journey:${exec.journey_id}:${step.id}`,
      '',
      '',
      '',
    ];
    await bulkInsertSmsQueue(tables, [row], true);
  } catch (sendErr: any) {
    console.error('[JourneyExecutor] bulkInsertSmsQueue 실패:', sendErr?.message || sendErr);
    await logFailedStep(exec.execution_id, step.id, 'queue_insert_failed');
    await advanceOrComplete(exec, step, sendCost);
    return 'failed';
  }

  // 11. step_log INSERT
  await query(
    `INSERT INTO journey_step_logs (
      id, execution_id, step_id, campaign_id, sent_at, status, cost
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, NOW(), 'sent', $4
    )`,
    [exec.execution_id, step.id, campaignId, sendCost]
  );

  // 12. execution + journey 통계 갱신
  await advanceOrComplete(exec, step, sendCost);

  return 'sent';
}

// ════════════════════════════════════════════════════════════════════
// 발송 시간 검증 (KST 08:00 ~ 21:00) — 광고 자동 검증 #3
// ════════════════════════════════════════════════════════════════════

function isWithinSendHours(now: Date = new Date()): boolean {
  const kstHour = (now.getUTCHours() + 9) % 24;
  return kstHour >= 8 && kstHour < 21;
}

function computeNextSendWindow(now: Date = new Date()): Date {
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const kstTarget = new Date(kstNow);
  const kstHour = kstNow.getUTCHours();
  if (kstHour >= 21) {
    kstTarget.setUTCDate(kstTarget.getUTCDate() + 1);
  }
  kstTarget.setUTCHours(8, 0, 0, 0);
  return new Date(kstTarget.getTime() - 9 * 60 * 60 * 1000);
}

// ════════════════════════════════════════════════════════════════════
// execution advance / complete / pause / log
// ════════════════════════════════════════════════════════════════════

async function advanceOrComplete(exec: ExecutionRow, currentStep: StepRow, addedCost: number): Promise<void> {
  // 다음 step 조회
  const nextRes = await query(
    `SELECT step_order, delay_hours FROM journey_steps
     WHERE journey_id = $1::uuid AND step_order > $2
     ORDER BY step_order ASC LIMIT 1`,
    [exec.journey_id, currentStep.step_order]
  );

  if (nextRes.rows.length === 0) {
    await query(
      `UPDATE journey_executions SET
         status = 'completed',
         completed_at = NOW(),
         current_step_order = $2,
         total_cost = total_cost + $3
       WHERE id = $1::uuid`,
      [exec.execution_id, currentStep.step_order, addedCost]
    );
    await query(
      `UPDATE journeys SET
         stats_total_completed = stats_total_completed + 1,
         stats_total_cost = stats_total_cost + $2,
         updated_at = NOW()
       WHERE id = $1::uuid`,
      [exec.journey_id, addedCost]
    );
    return;
  }

  const nextDelayHours = Number(nextRes.rows[0].delay_hours || 0);
  const nextRunAt = new Date(Date.now() + nextDelayHours * 60 * 60 * 1000);

  await query(
    `UPDATE journey_executions SET
       current_step_order = $2,
       next_run_at = $3,
       total_cost = total_cost + $4
     WHERE id = $1::uuid`,
    [exec.execution_id, currentStep.step_order, nextRunAt, addedCost]
  );
  if (addedCost > 0) {
    await query(
      `UPDATE journeys SET stats_total_cost = stats_total_cost + $2, updated_at = NOW()
       WHERE id = $1::uuid`,
      [exec.journey_id, addedCost]
    );
  }
}

async function markExecutionCompleted(executionId: string, journeyId: string): Promise<void> {
  await query(
    `UPDATE journey_executions SET status = 'completed', completed_at = NOW()
     WHERE id = $1::uuid AND status = 'active'`,
    [executionId]
  );
  await query(
    `UPDATE journeys SET stats_total_completed = stats_total_completed + 1, updated_at = NOW()
     WHERE id = $1::uuid`,
    [journeyId]
  );
}

async function pauseJourney(journeyId: string, reason: string): Promise<void> {
  await query(
    `UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $2, updated_at = NOW()
     WHERE id = $1::uuid AND status = 'active'`,
    [journeyId, reason.slice(0, 500)]
  );
  console.warn(`[JourneyExecutor] 여정 일시정지 — journey=${journeyId} reason="${reason}"`);
}

async function logSkippedStep(executionId: string, stepId: string, reason: string): Promise<void> {
  await query(
    `INSERT INTO journey_step_logs (
      id, execution_id, step_id, sent_at, status, cost, error_reason
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, NOW(), 'skipped', 0, $3
    )`,
    [executionId, stepId, reason.slice(0, 500)]
  );
}

async function logFailedStep(executionId: string, stepId: string, reason: string): Promise<void> {
  await query(
    `INSERT INTO journey_step_logs (
      id, execution_id, step_id, sent_at, status, cost, error_reason
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, NOW(), 'failed', 0, $3
    )`,
    [executionId, stepId, reason.slice(0, 500)]
  );
}
