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
  insertAlimtalkQueue,
} from './sms-queue';
import { convertButtonsToQTmsg } from './alimtalk-button';
import { buildAlimtalkEtcJson, type RepresentLink } from './alimtalk-emphasize';
import { fillAlimtalkVarMap } from './alimtalk-vars';
import { resolveAlimtalkFallback } from './alimtalk-fallback';
import { buildDefaultFallbacks } from './var-fallback';
import {
  listJourneyStepVariants,
  selectJourneyStepVariant,
  recordJourneyStepVariantReward,
} from './bandit-optimizer';
import {
  prepareSendMessage,
  prepareFieldMappings,
  getOpt080Number,
} from './messageUtils';
import { resolveJourneyAdFlag } from './journey-ad-policy';
import { isCallbackRegistered } from './callback-filter';
// ★ 2026-07-05: 발송 피로도 보호 — 광고 step 단건 게이트(차감 전 skip) + 발송 카운터
import { getFatigueCap, isFatigueBlocked, recordFatigueSends } from './fatigue-guard';
import { prepaidDeduct } from './prepaid';
import { deductCreditSafe } from './ai-credit';
import { getCreditCost, kstDateTag } from './ai-credit-calc';
import { logCampaignTraining } from './training-logger';
import { normalizePhone } from './normalize-phone';
import { getCompanyCosts } from '../config/defaults';
import { sanitizeForSms } from './message-sanitizer';
import { shortenUrlsInText } from './short-url';
import { autoPauseExecution } from './journey-pause-handler';
import { calculateNextRunAt, clampPersonalSendHour } from './send-time-util';
import { getOrCreateStepCampaign, bumpStepCampaignCount } from './journey-step-campaign';
import { evaluateCustomerFieldCondition, type ConditionOutcome } from './journey-condition';
import { isCustomerSendable } from './journey-safety-filter';
import { isSingleStepKind, normalizeStartKind } from './journey-start-kind';

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
  entry_event_properties: Record<string, any> | null;
  // journey 컬럼
  journey_status: string;
  budget_monthly: number | null;
  threshold_cost_per_step: number | null;
  threshold_recipients_per_step: number | null;
  stats_total_completed: number;
  stats_total_cost: number;
  created_by: string | null;
  journey_callback_number: string | null;
  callback_mode: string | null;
  // ★ 2026-06-30 여정 일반화 — date_anchor/one_shot은 단발(1 step 후 완료, 상대 advance 안 함).
  start_kind: string | null;
  // ★ 2026-07-10 목표 달성 자동 종료 — 진입 이후 구매 확인 시 잔여 step 중단(옵션, 기본 false).
  goal_exit_enabled: boolean;
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
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): wait step 정확도 — KST 시간대 영역
  delay_mode: string | null;       // 'relative' | 'specific_hour' | 'next_business_day' (default 'relative')
  target_hour_kst: number | null;  // 0~23 KST
  // ★ D188 Phase 2-B-1 (2026-05-21): condition step 평가용 conditionJsonb.
  condition_jsonb: Record<string, unknown> | null;
  // ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 + MMS 채널 확장 영역.
  alimtalk_profile_id: string | null;
  alimtalk_template_code: string | null;
  alimtalk_variable_map: Record<string, string> | null;
  alimtalk_next_type: string | null;
  alimtalk_next_contents: string | null;
  alimtalk_next_subject: string | null;
  mms_image_paths: string[] | null;
}

interface CustomerRow {
  id: string;
  phone: string;
  name: string | null;
  is_active: boolean;
  sms_opt_in: boolean;
  callback: string | null;
  store_phone: string | null;
  custom_fields: Record<string, any> | null;
  email: string | null;
  birth_date: Date | null;
  recent_purchase_date: Date | null;
  is_opt_out: boolean | null;
  is_invalid: boolean | null;
}

// ★ D188 Phase 2-B-1 (2026-05-21): wait/condition step 신규 outcome — 통계 분리 영역.
// ★ D218+ (2026-05-26): paused_external 추가 — 담당자 단축 URL 정지 / 관리자 직접 정지 / race condition 안전망 사고 차단.
type StepOutcome = 'sent' | 'skipped_hours' | 'skipped_opt_out' | 'skipped_no_customer' | 'skipped_already_sent' | 'waited' | 'condition_passed' | 'condition_failed' | 'condition_branched' | 'paused_balance' | 'paused_budget' | 'paused_threshold' | 'paused_external' | 'failed' | 'completed' | 'exited_goal';

// ════════════════════════════════════════════════════════════════════
// Worker — 5분 cron
// ════════════════════════════════════════════════════════════════════

let workerRunning = false;

// ★ D188 Phase 2-B-1 (2026-05-21): summary에 waited / condition_passed / condition_failed 카운트 추가.
export async function runJourneyExecutor(): Promise<{ processed: number; sent: number; skipped: number; waited: number; conditionPassed: number; conditionFailed: number; paused: number; failed: number; goalExited: number }> {
  if (workerRunning) {
    return { processed: 0, sent: 0, skipped: 0, waited: 0, conditionPassed: 0, conditionFailed: 0, paused: 0, failed: 0, goalExited: 0 };
  }
  workerRunning = true;

  const summary = { processed: 0, sent: 0, skipped: 0, waited: 0, conditionPassed: 0, conditionFailed: 0, paused: 0, failed: 0, goalExited: 0 };

  try {
    const dueRes = await query(
      `SELECT
         e.id AS execution_id,
         e.journey_id, e.customer_id,
         e.current_step_order, e.status, e.next_run_at, e.entered_at, e.total_cost,
         e.entry_event_properties,
         j.company_id, j.status AS journey_status,
         j.budget_monthly, j.threshold_cost_per_step, j.threshold_recipients_per_step,
         j.stats_total_completed, j.stats_total_cost, j.created_by,
         j.callback_number AS journey_callback_number,
         j.callback_mode, j.start_kind,
         COALESCE(j.goal_exit_enabled, false) AS goal_exit_enabled
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
        else if (outcome === 'waited') summary.waited++;
        else if (outcome === 'condition_passed') summary.conditionPassed++;
        else if (outcome === 'condition_failed') summary.conditionFailed++;
        else if (outcome === 'condition_branched') summary.conditionFailed++;  // ★ 2026-07-11 분기 — 미충족 계열로 집계
        else if (outcome === 'exited_goal') summary.goalExited++;
        else if (outcome.startsWith('paused')) summary.paused++;
        else if (outcome.startsWith('skipped')) summary.skipped++;
        else if (outcome === 'failed') summary.failed++;
      } catch (err: any) {
        summary.failed++;
        const reason = err?.message || String(err);
        console.error(`[JourneyExecutor] execution=${row.execution_id} 처리 실패:`, reason);
        // ★ 2026-07-27 실패를 실행행에도 남긴다.
        //   전에는 PM2 로그에만 찍혀서, 화면에서는 `error_count=0`·`error_log=[]`인 채로
        //   6건이 5분마다 조용히 실패만 반복했다(여정 알림톡 CHECK 위반 건에서 실측).
        //   로그를 못 보는 사람에겐 "이유 없이 안 나가는" 상태가 된다 — 원인을 데이터에 남겨야 한다.
        //   ⚠ 기록 자체가 실패해도 워커 루프는 멈추지 않는다(다음 실행행 처리가 우선).
        try {
          await query(
            `UPDATE journey_executions
                SET error_count = COALESCE(error_count, 0) + 1,
                    last_error_at = NOW(),
                    error_log = COALESCE(error_log, '[]'::jsonb) || $2::jsonb
              WHERE id = $1::uuid`,
            [
              row.execution_id,
              JSON.stringify([{ at: new Date().toISOString(), stage: 'process_execution', reason: reason.slice(0, 500) }]),
            ]
          );
        } catch (logErr: any) {
          console.error(`[JourneyExecutor] execution=${row.execution_id} 실패 기록 실패:`, logErr?.message || logErr);
        }
      }
    }

    if (dueRes.rows.length > 0) {
      console.log(`[JourneyExecutor] 처리 완료 — sent=${summary.sent} waited=${summary.waited} cond_pass=${summary.conditionPassed} cond_fail=${summary.conditionFailed} goal_exited=${summary.goalExited} skipped=${summary.skipped} paused=${summary.paused} failed=${summary.failed}`);
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
  // ★ D218+ (2026-05-26) 시점 1: 진입 직전 status 재확인 — race condition 안전망.
  //   옛 worker 조회 시점(line 133) 이후 = 단축 URL 정지 / 관리자 직접 정지 / pauseJourney 발화 사고 차단.
  // ★ Fix #5 (2026-06-05): execution.status뿐 아니라 journey.status까지 확인 — 관리자/단축URL 정지가
  //   이번 tick 조회 이후 발화한 경우(레이스)도 발송 직전 차단. 기존 검사의 상위집합(더 막고 덜 막지 않음).
  const statusCheck1 = await query(
    `SELECT je.status AS estatus, j.status AS jstatus
       FROM journey_executions je JOIN journeys j ON j.id = je.journey_id
      WHERE je.id = $1::uuid`,
    [exec.execution_id]
  );
  if (statusCheck1.rows[0]?.estatus === 'paused' || statusCheck1.rows[0]?.jstatus !== 'active') {
    console.log(`[JourneyExecutor] execution=${exec.execution_id} 진입 시점 정지 감지(execution/journey) → skip`);
    return 'paused_external';
  }

  // ★ 2026-07-10 목표 달성 자동 종료 (Harold — 시세이도 시연 질문 기원): 진입 이후 구매가 확인된 고객은
  //   남은 step(메시지/wait/condition 전부)을 진행하지 않고 'goal_met'로 종료. 차감·발송 이전 단계.
  //   판정 실패(쿼리 오류)는 통과 — 이탈은 보너스이지 여정을 멈추는 사유가 아니다.
  if (exec.goal_exit_enabled) {
    const converted = await isGoalConvertedSinceEntry(exec);
    if (converted) {
      await query(
        `UPDATE journey_executions SET status = 'goal_met', completed_at = NOW()
         WHERE id = $1::uuid AND status = 'active'`,
        [exec.execution_id]
      );
      console.log(`[JourneyExecutor] execution=${exec.execution_id} 진입 이후 구매 확인 → goal_met 종료(잔여 step 중단)`);
      return 'exited_goal';
    }
  }

  // 1. 다음 step 조회 (현재 current_step_order + 1)
  const nextStepOrder = exec.current_step_order + 1;
  const stepRes = await query(
    `SELECT id, journey_id, step_order, step_type, delay_hours, channel, message_template, subject, is_ad, condition_jsonb,
            alimtalk_profile_id, alimtalk_template_code, alimtalk_variable_map,
            alimtalk_next_type, alimtalk_next_contents, alimtalk_next_subject,
            mms_image_paths, delay_mode, target_hour_kst
     FROM journey_steps
     WHERE journey_id = $1::uuid AND step_order = $2`,
    [exec.journey_id, nextStepOrder]
  );

  if (stepRes.rows.length === 0) {
    await markExecutionCompleted(exec.execution_id, exec.journey_id);
    return 'completed';
  }

  const step = stepRes.rows[0] as StepRow;

  // ★ D218+ (2026-05-26) snapshot 우선 조회 — 활성화 시점 본문 보존 안전망.
  //   회사 admin이 활성화 후 step 본문 편집해도 발송 시점 = 활성화 시점 본문 100% 동일 보장.
  //   variant 영역(activeVariantId)은 옛 영역에서 별도 덮어쓰기 정합.
  try {
    const snapRes = await query(
      `SELECT message_body, message_subject
         FROM journey_step_snapshots
        WHERE step_id = $1::uuid AND journey_id = $2::uuid
        ORDER BY created_at DESC LIMIT 1`,
      [step.id, exec.journey_id]
    );
    if (snapRes.rows.length > 0) {
      const snap = snapRes.rows[0];
      if (snap.message_body) {
        step.message_template = snap.message_body;
      }
      if (snap.message_subject) {
        step.subject = snap.message_subject;
      }
    }
  } catch (snapErr: any) {
    // snapshot 조회 실패 = step 본 영역 fallback (안전망 — 발송 차단 X)
    console.warn(`[JourneyExecutor] snapshot 조회 실패 fallback:`, snapErr?.message);
  }

  // ★ D188 Phase 2-B-1 (2026-05-21): step_type 분기 신규 — wait/condition은 메시지 발송 영역 우회.
  //   wait step = 메시지 발송 0 + 다음 step 진입 (delay_hours는 advanceOrComplete가 다음 step 영역 사용).
  //   condition step = 고객 조회 후 conditionJsonb 평가 — 만족 시 다음 step 진입 / 미만족 시 execution 종료.
  //   message step = 기존 흐름 (메시지 발송).
  if (step.step_type === 'wait') {
    // ★ 2026-07-11 wait-until-event: wait_event_name(신규 컬럼)이 설정된 wait step은 이벤트 대기 —
    //   발생 시 즉시 다음 step, 타임아웃 시 다음 step(현행과 동일 방향 진행 — 분기는 뒤 condition step 몫).
    //   본류 SELECT에 신규 컬럼을 넣지 않고 지연 조회(42703 = 기존 시간 대기 그대로) — 발송 tick 본류 보호.
    let waitEventName: string | null = null;
    let waitTimeoutHours = 72;
    try {
      const w = await query(
        `SELECT wait_event_name, wait_timeout_hours FROM journey_steps WHERE id = $1::uuid`,
        [step.id]
      );
      const wn = w.rows[0]?.wait_event_name;
      if (wn != null && String(wn).trim()) waitEventName = String(wn).trim();
      const wt = Number(w.rows[0]?.wait_timeout_hours);
      if (Number.isFinite(wt) && wt > 0) waitTimeoutHours = Math.min(24 * 30, Math.floor(wt));
    } catch {
      /* wait 컬럼 미마이그레이션 → 기존 시간 대기 */
    }

    if (!waitEventName) {
      await logSkippedStep(exec.execution_id, step.id, 'wait_step_passed');
      await advanceOrComplete(exec, step, 0);
      return 'waited';
    }

    // 대기 앵커 = 이 step에 최초 도달한 시각(waiting_event 로그) — 없으면 지금 마킹.
    const anchorRes = await query(
      `SELECT sent_at FROM journey_step_logs
        WHERE execution_id = $1::uuid AND step_id = $2::uuid AND error_reason = 'waiting_event'
        ORDER BY sent_at ASC LIMIT 1`,
      [exec.execution_id, step.id]
    );
    let anchorAt: Date;
    if (anchorRes.rows.length === 0) {
      await logSkippedStep(exec.execution_id, step.id, 'waiting_event');
      anchorAt = new Date();
    } else {
      anchorAt = new Date(anchorRes.rows[0].sent_at);
    }

    // 이벤트 발생 검사 (cdp_events — cdp_event_exists 조건과 동일 소스·회사 격리)
    const ev = await query(
      `SELECT 1 FROM cdp_events
        WHERE company_id = $1::uuid AND customer_id = $2::uuid
          AND event_name = $3 AND occurred_at >= $4::timestamptz
        LIMIT 1`,
      [exec.company_id, exec.customer_id, waitEventName, anchorAt.toISOString()]
    );
    if (ev.rows.length > 0) {
      await logSkippedStep(exec.execution_id, step.id, 'wait_event_arrived');
      await advanceOrComplete(exec, step, 0);
      return 'waited';
    }

    const deadlineMs = anchorAt.getTime() + waitTimeoutHours * 3600 * 1000;
    if (Date.now() >= deadlineMs) {
      await logSkippedStep(exec.execution_id, step.id, 'wait_event_timeout');
      await advanceOrComplete(exec, step, 0);
      return 'waited';
    }

    // 기한 내 미발생 — 같은 step 유지 + 15분 후 재폴링
    await query(
      `UPDATE journey_executions SET next_run_at = NOW() + INTERVAL '15 minutes' WHERE id = $1::uuid`,
      [exec.execution_id]
    );
    return 'waited';
  }

  if (step.step_type === 'condition') {
    // condition step도 customer 조회 필요 — 조건이 어떤 필드든 평가할 수 있게 SELECT *.
    const condCustRes = await query(
      `SELECT * FROM customers WHERE id = $1::uuid AND company_id = $2::uuid`,
      [exec.customer_id, exec.company_id]
    );
    if (condCustRes.rows.length === 0) {
      await logSkippedStep(exec.execution_id, step.id, 'condition_customer_not_found');
      await advanceOrComplete(exec, step, 0);
      return 'skipped_no_customer';
    }
    const condCustomer = condCustRes.rows[0];
    // ★ D210+ Phase 3 + Phase 7 (2026-06-04): evaluateCondition 3분기 — met(다음 step) / not_met(종료) / error(보류·재시도).
    //   "조건을 확인 못 함"은 "보내도 됨"이 아니다. DB 오류는 발송이 아니라 재시도/정지로 받는다.
    const outcome = await evaluateCondition(step.condition_jsonb, condCustomer, exec.execution_id, exec.company_id);
    if (outcome === 'met') {
      await logSkippedStep(exec.execution_id, step.id, 'condition_passed');
      await advanceOrComplete(exec, step, 0);
      return 'condition_passed';
    }
    if (outcome === 'error') {
      // 조건 DB 평가 실패 → 발송 보류 + 재시도 (발송 실패 흐름과 동일 — error_count<1 재시도, 넘으면 정지).
      return await handleConditionEvalError(exec, step);
    }
    // not_met → 분기(not_met_goto) 또는 execution 종료.
    // ★ 2026-07-11 진짜 분기: not_met_goto(신규 컬럼)가 전방 step_order를 가리키면 종료 대신 그 step으로 점프.
    //   본류 step SELECT에 신규 컬럼을 넣지 않고 여기서 지연 조회(42703 = null = 현행 종료) — 발송 tick 본류 보호.
    let notMetGoto: number | null = null;
    try {
      const g = await query(`SELECT not_met_goto FROM journey_steps WHERE id = $1::uuid`, [step.id]);
      const raw = g.rows[0]?.not_met_goto;
      if (raw != null && Number.isFinite(Number(raw))) notMetGoto = Number(raw);
    } catch {
      /* not_met_goto 컬럼 미마이그레이션 → 현행(종료) */
    }
    if (notMetGoto != null && notMetGoto > step.step_order) {
      const jumped = await jumpToStep(exec, notMetGoto);
      await logSkippedStep(exec.execution_id, step.id, jumped ? 'condition_branched' : 'condition_branch_target_missing');
      if (!jumped) {
        // 분기 대상 step 없음(삭제 등) — 미충족 발송 없이 완주 처리
        await markExecutionCompleted(exec.execution_id, exec.journey_id);
      }
      console.log(`[JourneyExecutor] execution=${exec.execution_id} step=${step.step_order} condition 미충족 → ${jumped ? `step ${notMetGoto} 분기` : '분기 대상 없음(완료)'}`);
      return 'condition_branched';
    }

    // 분기 미설정 = execution 종료 (조건 확정 미충족 — 현 동작 보존)
    await query(
      `UPDATE journey_executions SET status = 'ended', completed_at = NOW(), current_step_order = $2
       WHERE id = $1::uuid`,
      [exec.execution_id, step.step_order]
    );
    await logSkippedStep(exec.execution_id, step.id, 'condition_failed_ended');
    console.log(`[JourneyExecutor] execution=${exec.execution_id} step=${step.step_order} condition 미충족 → ended`);
    return 'condition_failed';
  }

  // ──────────── message step (기존 흐름) ────────────

  // ★ Fix #6 (2026-06-05): 묶음 멱등 가드 — 이 execution+step이 이미 'sent' 로그면(크래시 후 재처리)
  //   deduct(잔액)~advance 사이 중복 차감·발송 없이 그대로 다음 step으로. 신규 컬럼 0(기존 journey_step_logs).
  const alreadySent = await query(
    `SELECT 1 FROM journey_step_logs WHERE execution_id = $1::uuid AND step_id = $2::uuid AND status = 'sent' LIMIT 1`,
    [exec.execution_id, step.id]
  );
  if (alreadySent.rows.length > 0) {
    console.warn(`[JourneyExecutor] execution=${exec.execution_id} step=${step.step_order} 이미 발송됨(재처리 감지) → 중복 차감/발송 없이 advance`);
    await advanceOrComplete(exec, step, 0);
    return 'skipped_already_sent';
  }

  // ★ D188 Phase 2-B-3 (2026-05-21): variants 선택 — Bandit Thompson Sampling.
  //   step에 variants ≥ 1건 있으면 선택 후 step 변수 덮어쓰기. 발송 후 recordJourneyStepVariantReward 호출.
  let activeVariantId: string | null = null;
  try {
    const variants = await listJourneyStepVariants(step.id);
    if (variants.length > 0) {
      const rec = selectJourneyStepVariant(variants);
      if (rec) {
        activeVariantId = rec.variant.id;
        step.message_template = rec.variant.messageTemplate || step.message_template;
        step.subject = rec.variant.subject || step.subject;
        step.channel = rec.variant.channel || step.channel;
        step.alimtalk_template_code = rec.variant.alimtalkTemplateCode || step.alimtalk_template_code;
        step.alimtalk_variable_map = rec.variant.alimtalkVariableMap || step.alimtalk_variable_map;
        console.log(`[JourneyExecutor] step=${step.step_order} variant ${rec.variant.variantId} 선택 — ${rec.reasoning}`);
      }
    }
  } catch (variantsErr: any) {
    // variants 조회 실패 시 fallback = step 본 영역 사용 (영역 안전망)
    console.warn(`[JourneyExecutor] variants 조회 실패 fallback:`, variantsErr?.message || variantsErr);
  }

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
  //   치환은 customer의 모든 직접 컬럼(등급·지역·나이·성별·구매정보 등)을 참조하므로 SELECT *.
  //   컬럼을 한정하면 발송 시 그 변수들이 빈 값으로 치환되는 문제가 생긴다.
  const custRes = await query(
    `SELECT * FROM customers WHERE id = $1::uuid AND company_id = $2::uuid`,
    [exec.customer_id, exec.company_id]
  );
  if (custRes.rows.length === 0) {
    await logSkippedStep(exec.execution_id, step.id, 'customer_not_found');
    await advanceOrComplete(exec, step, 0);
    return 'skipped_no_customer';
  }
  const customer = custRes.rows[0] as CustomerRow;
  // ★ 2026-06-22: 진입 이벤트 데이터(주문번호·상품명 등)를 알림톡 변수에 채우기 위해 customer에 병합 (customer 우선 — 프로필 신뢰)
  const eventProps = (exec.entry_event_properties && typeof exec.entry_event_properties === 'object') ? exec.entry_event_properties : {};
  const customerWithEvent = { ...eventProps, ...(customer as Record<string, any>) };

  // ★ Fix #1 (2026-06-05): 발송 직전 안전필터 재적용 — 추출 기준과 동일(is_active·sms_opt_in·is_opt_out·is_invalid).
  //   진입과 발송 사이(다단계는 며칠)에 고객이 비활성/수신거부/무효로 바뀌어도 발송 직전 한 번 더 막는다.
  if (!isCustomerSendable(customer)) {
    await logSkippedStep(exec.execution_id, step.id, 'opt_out_or_inactive');
    await advanceOrComplete(exec, step, 0);
    return 'skipped_opt_out';
  }

  // 4. 수신거부 검증 — 안전필터와 동일 기준(회사+전화). user_id 기준보다 넓게, 진입 후 수신거부분까지 발송 직전 차단.
  const unsubRes = await query(
    `SELECT 1 FROM unsubscribes WHERE company_id = $1::uuid AND phone = $2 LIMIT 1`,
    [exec.company_id, customer.phone]
  );
  if (unsubRes.rows.length > 0) {
    await logSkippedStep(exec.execution_id, step.id, 'unsubscribed');
    await advanceOrComplete(exec, step, 0);
    return 'skipped_opt_out';
  }

  // 5. 라인그룹 검증
  if (!(await hasCompanyLineGroup(exec.company_id))) {
    await pauseJourney(exec.journey_id, '발송 라인그룹 미설정');
    await logFailedStep(exec.execution_id, step.id, 'line_group_not_set');
    return 'failed';
  }

  // 5-2. 회신번호 — callback_mode='store'면 고객 매장번호(store_phone) 우선, 없으면 고정번호/주소록 fallback.
  //   callback-filter CT의 store_phone 폴백 개념을 여정 단건/기존 호환에 맞춰 적용(기존 우선순위 보존).
  const useStoreCallback = exec.callback_mode === 'store';
  const storePhoneCallback = useStoreCallback ? String(customer.store_phone || '').trim() : '';
  // ★ 매장번호 발송(store 모드): store_phone이 있는데 등록 발신번호가 아니면 발송 시도 없이 이 고객만 자동 실패.
  //   발신번호 사전등록제 — 미등록 발송은 통신사 거부. 크레딧 차감/발송 이전 단계라 미차감, 여정 전체는 계속 진행.
  //   매장번호가 아예 없는 고객은 아래 fallback(고정 회신번호)으로 발송된다.
  if (storePhoneCallback && !(await isCallbackRegistered(exec.company_id, storePhoneCallback, exec.created_by || undefined))) {
    await logFailedStep(exec.execution_id, step.id, 'callback_not_registered');
    await advanceOrComplete(exec, step, 0);
    return 'failed';
  }
  const callbackNumber = String(storePhoneCallback || exec.journey_callback_number || customer.callback || '').trim();
  if (!callbackNumber) {
    await pauseJourney(exec.journey_id, '회신번호가 비어있어 발송 차단됨');
    await logFailedStep(exec.execution_id, step.id, 'callback_number_empty');
    return 'failed';
  }

  // ★ 2026-07-05 발송 피로도 보호 — 회사 opt-in + 광고성 step만. 이 step 발송만 skip(비용 0·여정은 계속 진행,
  //   다음 step 시점에 윈도우가 풀리면 정상 발송). 정보성 알림톡(is_ad=false)은 게이트 대상 아님.
  if (resolveJourneyAdFlag(step.channel, step.is_ad)) {
    const fatigueCap = await getFatigueCap(exec.company_id);
    if (fatigueCap && (await isFatigueBlocked(exec.company_id, fatigueCap, customer.phone))) {
      await logSkippedStep(exec.execution_id, step.id, 'fatigue_capped');
      await advanceOrComplete(exec, step, 0);
      return 'skipped_opt_out';
    }
  }

  // ★ D188 Phase 2-B-2 (2026-05-21): channel 분기 — SMS/LMS/MMS = 기존 prepareSendMessage 흐름 / KAKAO = kakao_templates 조회 + alimtalk_variable_map 치환 + insertAlimtalkQueue.
  // 6. 메시지 + 비용 계산
  const channelLower = (step.channel || 'lms').toLowerCase();
  const isKakao = channelLower === 'kakao';
  const channelType = (step.channel || 'lms').toUpperCase();
  const msgType = isKakao ? 'KAKAO' : (channelType === 'LMS' || channelType === 'MMS' ? channelType : 'SMS');
  const fieldMappings = await prepareFieldMappings(exec.company_id);
  const opt080Number = await getOpt080Number(exec.created_by, exec.company_id);
  // ★ D194 (2026-05-22): Liquid context — company 정보 사전 조회 ({{ company.name }} / {{ company.brand_name }} 지원)
  const companyRes = await query(
    `SELECT company_name, brand_name FROM companies WHERE id = $1::uuid`,
    [exec.company_id]
  );
  const companyContext = {
    name: companyRes.rows[0]?.company_name || '',
    brand_name: companyRes.rows[0]?.brand_name || '',
  };

  // ★ D197 (2026-05-22) Phase B-2: Predictive Suite 통합 — customer 객체에 click_score / churn_risk / purchase_likelihood 자동 첨부
  //   Liquid 사용 가능: {% if customer.churn_risk > 0.7 %} 회복 안내 {% endif %}
  //   cache 우선 조회 (24h TTL) — 없으면 즉시 계산 + 저장 (cdp_customer_predictions)
  //   안전 fallback — 오류 시 원본 customer 반환 (발송 차단 X)
  const { enrichCustomerWithPredictions } = await import('./predictive-suite');
  const enrichedCustomer = await enrichCustomerWithPredictions(customer as Record<string, any>, exec.company_id);

  // ★ D201 (2026-05-22) Phase B-3: Connected Content 통합 — 외부 실시간 데이터 (날씨/재고/가격/신상품) 통합
  //   Liquid 변수 매칭된 경우만 fetch (불요 API 호출 0건)
  //   timeout 5초 + 실패 시 빈 값 fallback (발송 차단 X)
  let externalContext: Record<string, any> = {};
  try {
    const { enrichLiquidContextWithExternal } = await import('./connected-content');
    externalContext = await enrichLiquidContextWithExternal(
      step.message_template || '',
      exec.company_id,
      (enrichedCustomer as any).region || null,
      // ★ D209+ (Harold 명시 2026-05-22): 매장 region 강화 — recent_purchase_store 우선, registered_store fallback
      (enrichedCustomer as any).recent_purchase_store || (enrichedCustomer as any).registered_store || null,
    );
  } catch (err: any) {
    console.warn('[JourneyExecutor] Connected Content skip:', err?.message);
  }

  // ★ 장바구니 리커버리 — 담은 상품 노출 ({{ cart.product_name }} 등). cart 여정 외에는
  //   템플릿에 {{ cart.* }}가 없어 쿼리 skip. 실패 시 빈 객체 (발송 차단 X) — connected-content 동일 패턴.
  try {
    const { enrichLiquidContextWithCart } = await import('./cdp-events');
    const cartContext = await enrichLiquidContextWithCart(
      step.message_template || '',
      exec.company_id,
      exec.customer_id || null,
    );
    if (cartContext && Object.keys(cartContext).length > 0) {
      externalContext = { ...externalContext, ...cartContext };
    }
  } catch (err: any) {
    console.warn('[JourneyExecutor] cart context skip:', err?.message);
  }

  // 광고 표기 — ★ 2026-06-23: 비카카오(SMS/LMS/MMS) 여정은 알림톡이 아니므로 무조건 광고성 → isAd 강제 true
  //   (AI가 isAd=false로 내렸거나 과거 is_ad=false로 저장된 여정도 발송 직전 교정. 정보통신망법 광고 표기 의무).
  //   카카오(알림톡)만 정보성 허용. buildAdMessage가 (광고)+무료수신거부(080) 자동 합성.
  const isAd = resolveJourneyAdFlag(step.channel, step.is_ad);

  let message: string;
  let subject: string;
  let kakaoTemplateRow: { id: string; template_code: string; content: string; buttons: any[]; status: string; emphasize_title?: string | null; represent_link?: RepresentLink | null; profile_key?: string | null } | null = null;

  if (isKakao) {
    // ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 영역 — kakao_templates 조회 + alimtalk_variable_map 치환.
    if (!step.alimtalk_template_code) {
      await pauseJourney(exec.journey_id, `step ${step.step_order} 알림톡 템플릿 코드가 비어있어 발송 차단`);
      await logFailedStep(exec.execution_id, step.id, 'alimtalk_template_code_empty');
      return 'failed';
    }
    const tplRes = await query(
      `SELECT t.id, t.template_code, t.content, t.buttons, t.status, t.emphasize_title, t.represent_link, p.profile_key
         FROM kakao_templates t
         LEFT JOIN kakao_sender_profiles p ON p.id = t.profile_id
        WHERE t.template_code = $1 AND t.company_id = $2::uuid LIMIT 1`,
      [step.alimtalk_template_code, exec.company_id]
    );
    if (tplRes.rows.length === 0) {
      await pauseJourney(exec.journey_id, `step ${step.step_order} 알림톡 템플릿(${step.alimtalk_template_code}) 미존재 또는 회사 격리 위반`);
      await logFailedStep(exec.execution_id, step.id, 'alimtalk_template_not_found');
      return 'failed';
    }
    kakaoTemplateRow = tplRes.rows[0] as any;
    if (!['APPROVED', 'APR'].includes(String(kakaoTemplateRow!.status || '').toUpperCase())) {
      await pauseJourney(exec.journey_id, `step ${step.step_order} 알림톡 템플릿 미승인 (status=${kakaoTemplateRow!.status})`);
      await logFailedStep(exec.execution_id, step.id, 'alimtalk_template_not_approved');
      return 'failed';
    }
    // ★ CT-87 (2026-06-10): 카카오 활성상태(A) 가드 — 활성 대기(R) 템플릿은 카카오가 전부 7300 거부
    {
      const { decideKakaoTemplateSendable, getImcTemplateStatusSafe } = await import('./kakao-template-guard');
      const journeyTplGuard = decideKakaoTemplateSendable(
        await getImcTemplateStatusSafe(exec.company_id, step.alimtalk_template_code)
      );
      if (!journeyTplGuard.sendable) {
        await pauseJourney(exec.journey_id, `step ${step.step_order} ${journeyTplGuard.reason || '카카오 템플릿 비활성'}`);
        await logFailedStep(exec.execution_id, step.id, 'alimtalk_template_inactive');
        return 'failed';
      }
    }
    // 알림톡 본문 = template.content + alimtalk_variable_map 치환 (@@필드키@@ → customer[필드키] / 그 외 = 직접 입력값 그대로)
    message = fillAlimtalkVarMap(
      String(kakaoTemplateRow!.content || ''),
      step.alimtalk_variable_map || {},
      customerWithEvent,
      undefined,
      buildDefaultFallbacks(step.alimtalk_variable_map || {}),
    );
    // 알림톡 자체는 subject 무관, LMS 대체(L/B) 발송 시점만 alimtalk_next_subject 사용 (insertAlimtalkQueue title_str 영역)
    subject = step.alimtalk_next_subject || '';
  } else {
    // ★ 기존 흐름 — SMS/LMS/MMS는 prepareSendMessage 정합.
    // ★ D187-fix5: 발송 직전 최후 안전망 — sanitize 자동 적용 (이모지/비표준 특수문자 제거)
    const sanTemplate = sanitizeForSms(step.message_template || '');
    const sanSubject = sanitizeForSms(step.subject || '');
    if (sanTemplate.hadChanges) {
      console.log(`[JourneyExecutor] step ${step.step_order} 본문 sanitize:`, sanTemplate.warnings.join(' / '));
    }
    if (sanSubject.hadChanges) {
      console.log(`[JourneyExecutor] step ${step.step_order} 제목 sanitize:`, sanSubject.warnings.join(' / '));
    }

    const prep = prepareSendMessage(
      sanTemplate.sanitized,
      enrichedCustomer,
      fieldMappings,
      {
        msgType: msgType as 'SMS' | 'LMS' | 'MMS',
        isAd,
        opt080Number,
        subject: sanSubject.sanitized,
        // ★ D194 (2026-05-22): Liquid context — {{ company.name }} 지원
        // ★ D197 (2026-05-22) Phase B-2: enrichedCustomer = customer + Predictive 점수 통합
        // ★ D201 (2026-05-22) Phase B-3: externalContext = 날씨/재고/가격/신상품 통합
        company: companyContext,
        externalContext,
      }
    );
    message = prep.message;
    subject = prep.subject;

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

    // ★ D190 #1 (2026-05-22): 단축 URL 자동 변환 — Bandit reward + CDP 매칭 추적 컨텍스트 통합
    //   SMS/LMS/MMS 영역만 진입 (알림톡은 검수 완료 본문 변경 차단 — 통신사 정책)
    //   variantId 존재 시 message_short_urls.variant_id 저장 → 클릭 시 recordJourneyStepVariantReward 자동 호출
    //   customerId 저장 → 클릭 시 CDP 매칭 (한국 자사몰 도메인 인지 시 external_id 자동 추출)
    try {
      message = await shortenUrlsInText(message, {
        companyId: exec.company_id,
        journeyId: exec.journey_id,
        stepId: step.id,
        variantId: activeVariantId || undefined,
        customerId: customer.id,
      });
    } catch (shortenErr: any) {
      console.warn(`[JourneyExecutor] step ${step.step_order} 단축 URL 변환 실패 (원본 보존):`, shortenErr?.message);
    }
  }

  // 비용 산정 (회사별 단가) — channel별 단가
  const compRes = await query(
    `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, unit_price_basis FROM companies WHERE id = $1::uuid`,
    [exec.company_id]
  );
  const costs = getCompanyCosts(compRes.rows[0] || {});
  const unitCost =
    msgType === 'KAKAO' ? Number(costs.kakao) :
    msgType === 'LMS'   ? Number(costs.lms) :
    msgType === 'MMS'   ? Number(costs.mms) :
                          Number(costs.sms);
  const sendCost = Math.round(unitCost);

  // 7. 임계값 검증 (회사 자유 — NULL = 무제한)
  if (exec.threshold_cost_per_step != null && sendCost > Number(exec.threshold_cost_per_step)) {
    await pauseJourney(exec.journey_id, `step 비용 ${sendCost.toLocaleString()}원 > 임계값 ${Number(exec.threshold_cost_per_step).toLocaleString()}원`);
    await logFailedStep(exec.execution_id, step.id, 'threshold_cost_exceeded');
    return 'paused_threshold';
  }

  if (exec.budget_monthly != null) {
    // ★ 2026-06-06 J2 정정: 월 예산 = 이번 달 실제 발송 비용(journey_step_logs.cost · sent_at 당월) 합으로 비교.
    //   옛 코드는 journeys.stats_total_cost(전기간 누적)를 updated_at 월 필터로 SUM해 사실상 전기간 한도(월 리셋 없음)였다.
    const monthCostRes = await query(
      `SELECT COALESCE(SUM(l.cost), 0) AS month_cost
       FROM journey_step_logs l
       JOIN journey_executions e ON e.id = l.execution_id
       WHERE e.journey_id = $1::uuid AND l.status = 'sent'
         AND l.sent_at >= date_trunc('month', NOW())`,
      [exec.journey_id]
    );
    const monthCost = Number(monthCostRes.rows[0]?.month_cost || 0);
    if (monthCost + sendCost > Number(exec.budget_monthly)) {
      await pauseJourney(exec.journey_id, `이번 달 누적 ${(monthCost + sendCost).toLocaleString()}원 > 월 예산 ${Number(exec.budget_monthly).toLocaleString()}원`);
      await logFailedStep(exec.execution_id, step.id, 'budget_monthly_exceeded');
      return 'paused_budget';
    }
  }

  // ★ D218+ (2026-05-26) 시점 2: 잔액 차감 직전 status 재확인 — 단축 URL 정지 / 관리자 직접 정지 race condition 안전망.
  //   본 시점 이후 = 잔액 차감 + queue INSERT 흐름 = 정지 효과 0건 사고 차단 의무.
  const statusCheck2 = await query(
    `SELECT je.status AS estatus, j.status AS jstatus
       FROM journey_executions je JOIN journeys j ON j.id = je.journey_id
      WHERE je.id = $1::uuid`,
    [exec.execution_id]
  );
  if (statusCheck2.rows[0]?.estatus === 'paused' || statusCheck2.rows[0]?.jstatus !== 'active') {
    console.log(`[JourneyExecutor] execution=${exec.execution_id} 발송 직전 정지 감지(execution/journey) → skip (잔액 차감 X / queue INSERT X)`);
    return 'paused_external';
  }

  // 8. 잔액 사전 확인 (read-only 게이트) — 실제 차감은 큐 INSERT 성공 직후(아래).
  //    ★ 2026-06-06 J1: 옛 코드는 차감을 큐보다 먼저 해 큐 실패·재시도 시 과금만 되고 환불이 없었다(중복 차감) → 발송 성공 시점 차감으로 교정.
  const prepaidMsgType = msgType === 'KAKAO' ? 'KAKAO' : (msgType as 'SMS' | 'LMS' | 'MMS');
  const balRes = await query(
    `SELECT billing_type, balance FROM companies WHERE id = $1::uuid`,
    [exec.company_id]
  );
  const isPrepaid = balRes.rows[0]?.billing_type === 'prepaid';
  const curBalance = Number(balRes.rows[0]?.balance || 0);
  if (isPrepaid && curBalance < sendCost) {
    // ★ D218+ (2026-05-26) 잔액 부족 실패 분기 — autoPauseExecution + journey-level pause + journey_step_pause_logs 영구 기록.
    await pauseJourney(exec.journey_id, `잔액 부족 (보유 ${curBalance.toLocaleString()}원 < 필요 ${sendCost.toLocaleString()}원)`);
    await logFailedStep(exec.execution_id, step.id, 'insufficient_balance');
    try {
      await autoPauseExecution({
        companyId: exec.company_id,
        journeyId: exec.journey_id,
        stepId: step.id,
        executionId: exec.execution_id,
        pauseReason: 'balance_insufficient',
        pauseTriggerSource: 'auto_balance_check',
      });
    } catch (apErr: any) {
      console.warn(`[JourneyExecutor] autoPauseExecution(balance_insufficient) 사고 (skip):`, apErr?.message);
    }
    return 'paused_balance';
  }

  // 9. campaigns INSERT (source='journey' — 추적 정합)
  const cleanPhone = normalizePhone(customer.phone);
  if (!cleanPhone) {
    // ★ D218+ (2026-05-26) phone 무효 실패 분기 — autoPauseExecution(phone_invalid) + 옛 흐름 정합 (재시도 X = advance).
    await logFailedStep(exec.execution_id, step.id, 'invalid_phone');
    try {
      await autoPauseExecution({
        companyId: exec.company_id,
        journeyId: exec.journey_id,
        stepId: step.id,
        executionId: exec.execution_id,
        pauseReason: 'phone_invalid',
        pauseTriggerSource: 'auto_phone_check',
      });
    } catch (apErr: any) {
      console.warn(`[JourneyExecutor] autoPauseExecution(phone_invalid) 사고 (skip):`, apErr?.message);
    }
    await advanceOrComplete(exec, step, 0);  // ★ J1: 발송 0 → 비용 0 (옛 sendCost 가산은 미발송인데 통계·예산 부풀림)
    return 'failed';
  }

  // ★ Phase 5: 고객당 새 campaign 폐기 → (journey, step, 오늘 KST)당 campaign 1건 공유(find-or-create).
  //   발송결과 목록 1줄 + 상세는 app_etc1=campaignId로 N명 전화번호 검색(아래 큐). 개인화는 고객별 렌더 그대로.
  const sendChannelForCampaign = isKakao ? 'alimtalk' : 'sms';
  const campaignId = await getOrCreateStepCampaign({
    companyId: exec.company_id,
    journeyId: exec.journey_id,
    stepId: step.id,
    stepOrder: step.step_order,
    msgType,
    representativeMessage: message,
    subject: subject || null,
    isAd,
    createdBy: exec.created_by,
    sendChannel: sendChannelForCampaign,
    callbackNumber,
    kakaoTemplateId: isKakao && kakaoTemplateRow ? kakaoTemplateRow.id : null,  // 알림톡 결과 조회용 FK (results.ts JOIN)
    mmsImagePaths: (msgType === 'MMS' && step.mms_image_paths && step.mms_image_paths.length > 0) ? JSON.stringify(step.mms_image_paths) : null,
  });

  // AI 학습 데이터 적재 — 여정 발송(공유 step campaign, source_ref 멱등으로 (여정,step,일)당 1건, 발송 영향 0).
  void logCampaignTraining({
    campaignId,
    companyId: exec.company_id,
    messageType: (msgType === 'KAKAO' ? 'KAKAO' : String(msgType || 'LMS').toUpperCase()) as 'SMS' | 'LMS' | 'MMS' | 'KAKAO',
    isAd,
    finalMessage: message,
    finalSource: 'selected_as_is',
    sendAt: new Date(),
  });

  // ★ D188 Phase 2-B-2 (2026-05-21): 10. queue INSERT — channel별 분기 (SMS/LMS/MMS = bulkInsertSmsQueue / KAKAO = insertAlimtalkQueue).
  try {
    const tables = await getCompanySmsTables(exec.company_id, exec.created_by || undefined);
    if (tables.length === 0) {
      await pauseJourney(exec.journey_id, 'SMS 발송 테이블 미할당');
      await logFailedStep(exec.execution_id, step.id, 'no_sms_tables');
      return 'failed';
    }

    // ★ 2026-07-27 실적재 테이블 기록 — 직접발송(direct-send-worker)이 0611 사고 후 넣은 안전장치를
    //   여정만 갖고 있지 않았다(실측: 여정 campaign의 send_config가 비어 있음).
    //   라인그룹이 나중에 재배정되면 "이 발송이 어느 테이블에 들어갔는지" 알 방법이 사라져,
    //   집계·결과조회·안전망이 발송 당시 라인을 못 찾는다(에이치피오 취소 미삭제와 같은 뿌리).
    //   공유 campaign(여정·step·일당 1건)에 기록하므로 배치마다 덮어써도 값은 동일하다.
    //   실패해도 발송은 계속한다 — 기록은 추적용이지 발송 조건이 아니다.
    try {
      await query(
        `UPDATE campaigns
            SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{sentTables}', $1::jsonb),
                updated_at = NOW()
          WHERE id = $2::uuid`,
        [JSON.stringify(tables), campaignId],
      );
    } catch (cfgErr: any) {
      console.error(`[JourneyExecutor] sentTables 기록 실패 campaign=${campaignId}:`, cfgErr?.message || cfgErr);
    }

    if (isKakao && kakaoTemplateRow) {
      // 알림톡 영역 — insertAlimtalkQueue 사용. buttons → buttonJson 변환.
      const buttonJson = convertButtonsToQTmsg(kakaoTemplateRow.buttons || []);
      // ★ 2026-07-27: 전환재발송 규칙 CT 단일 진입점(alimtalk-fallback). 4경로 공통.
      //   원문 그대로(L)면 k_next_contents는 NULL로 정규화(게이트웨이가 msg_contents 사용),
      //   대체문안(B)인데 문구가 비면 여기서 throw → 바깥 catch가 error_log에 사유 기록 후 차단.
      //   ★ 알림톡 실패 대체문구(k_next_contents)도 본문(472)과 동일 변수 치환 — raw 발송 시 #{변수} 노출 차단.
      const alimFallback = resolveAlimtalkFallback({
        nextType: step.alimtalk_next_type,
        nextContents: step.alimtalk_next_contents
          ? fillAlimtalkVarMap(step.alimtalk_next_contents, step.alimtalk_variable_map || {}, customerWithEvent, undefined, buildDefaultFallbacks(step.alimtalk_variable_map || {}))
          : step.alimtalk_next_contents,
        nextSubject: subject,
      });
      await insertAlimtalkQueue(
        tables,
        [{
          phone: cleanPhone,
          callback: callbackNumber,
          message,
          titleStr: alimFallback.titleStr,  // L/B 시 LMS 대체 제목
          templateCode: step.alimtalk_template_code || '',
          nextType: alimFallback.nextType,
          nextContents: alimFallback.nextContents,
          buttonJson: buttonJson || undefined,
          // ★ 매뉴얼(qtmsg): 강조표기형 emphasize_title(본문과 동일 치환)만 → k_etc_json (senderkey는 CT-04가 비토 라인만 주입). 직접/자동과 동일 형태.
          etcJson: buildAlimtalkEtcJson({
            emphasizeTitle: kakaoTemplateRow.emphasize_title,
            representLink: kakaoTemplateRow.represent_link,
            substitute: (raw) => fillAlimtalkVarMap(raw, step.alimtalk_variable_map || {}, customerWithEvent, undefined, buildDefaultFallbacks(step.alimtalk_variable_map || {})),
          }),
          companyId: exec.company_id,
        }],
        campaignId,  // ★ Phase 5: app_etc1 = 공유 campaignId (결과 상세 app_etc1=campaignId 검색 일치)
      );
    } else {
      // SMS/LMS/MMS 영역 — bulkInsertSmsQueue 정합.
      const row = [
        cleanPhone,
        callbackNumber,
        message,
        msgType,
        subject || '',
        new Date(),
        // ★ Phase 5: row[6]=app_etc1=공유 campaignId(결과 상세 검색 일치), row[7]=app_etc2=companyId.
        //   기존엔 app_etc1=company_id, app_etc2=journey:... 로 뒤바뀌어 여정 SMS 수신자 상세가 안 잡혔음 — 직접발송과 동일 순서로 정정.
        campaignId,
        exec.company_id,
        // MMS 영역 — mms_image_paths[0..2] 사용 (basename 추출, sms-queue file_name1~3 정합)
        (msgType === 'MMS' && step.mms_image_paths && step.mms_image_paths[0]) ? extractBasename(step.mms_image_paths[0]) : '',
        (msgType === 'MMS' && step.mms_image_paths && step.mms_image_paths[1]) ? extractBasename(step.mms_image_paths[1]) : '',
        (msgType === 'MMS' && step.mms_image_paths && step.mms_image_paths[2]) ? extractBasename(step.mms_image_paths[2]) : '',
      ];
      await bulkInsertSmsQueue(tables, [row], true);
    }

    // ★ 2026-07-05 발송 피로도 카운터 — 광고성만(알림톡 정보성 제외), 큐 커밋 후 fire-and-forget
    if (isAd) {
      void recordFatigueSends(exec.company_id, [String(customer.phone || '')]);
    }
  } catch (sendErr: any) {
    // ★ D218+ (2026-05-26) 통신사 일시 fail 분기 — error_count < 1 = 5분 후 자동 재시도 1회 / 그 이상 = autoPauseExecution + pauseJourney.
    console.error('[JourneyExecutor] queue 발송 실패:', sendErr?.message || sendErr);
    const errMsg = String(sendErr?.message || '');
    try {
      const ecRes = await query(
        `SELECT COALESCE(error_count, 0) AS ec FROM journey_executions WHERE id = $1::uuid`,
        [exec.execution_id]
      );
      const errorCount = Number(ecRes.rows[0]?.ec || 0);
      if (errorCount < 1) {
        // 1회 자동 재시도 — 5분 후
        const errorLogEntry = JSON.stringify([
          { at: new Date().toISOString(), reason: 'queue_insert_failed', error: errMsg.slice(0, 300) },
        ]);
        await query(
          `UPDATE journey_executions SET
             next_run_at = NOW() + INTERVAL '5 minutes',
             error_count = COALESCE(error_count, 0) + 1,
             last_error_at = NOW(),
             error_log = COALESCE(error_log, '[]'::jsonb) || $2::jsonb
           WHERE id = $1::uuid`,
          [exec.execution_id, errorLogEntry]
        );
        await logFailedStep(exec.execution_id, step.id, 'queue_insert_failed_retry_scheduled');
        console.log(`[JourneyExecutor] execution=${exec.execution_id} 5분 후 자동 재시도 예약 (error_count=${errorCount + 1})`);
        return 'failed';
      }
      // 재시도 1회 후에도 fail → autoPauseExecution(carrier_temp_fail) + pauseJourney + advance.
      await autoPauseExecution({
        companyId: exec.company_id,
        journeyId: exec.journey_id,
        stepId: step.id,
        executionId: exec.execution_id,
        pauseReason: 'carrier_temp_fail',
        pauseTriggerSource: 'auto_retry_exhausted',
      });
      await pauseJourney(exec.journey_id, '통신사 일시 발송 실패 (자동 재시도 1회 후에도 fail)');
    } catch (retryErr: any) {
      console.warn(`[JourneyExecutor] 재시도 분기 사고 (skip):`, retryErr?.message);
    }
    await logFailedStep(exec.execution_id, step.id, 'queue_insert_failed');
    await advanceOrComplete(exec, step, 0);  // ★ J1: 발송 실패 → 비용 0 (차감은 발송 성공 시점에만)
    return 'failed';
  }

  // ★ 2026-06-06 J1: 큐 INSERT 성공 = 발송 확정 → ① 멱등 마커(step_log 'sent') 먼저 기록(재시도 중복발송 차단)
  //   ② 실제 잔액 차감(발송 성공 시점). 사전확인 후 동시 소진(드묾)으로 차감 실패면 이미 발송됨 → 정지만(1건 부담), 발송은 진행.
  await query(
    `INSERT INTO journey_step_logs (
      id, execution_id, step_id, campaign_id, sent_at, status, cost
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, NOW(), 'sent', $4
    )`,
    [exec.execution_id, step.id, campaignId, sendCost]
  );
  const deduct = await prepaidDeduct(exec.company_id, 1, prepaidMsgType as any, exec.journey_id, exec.created_by || undefined, 'journey');
  if (!deduct.ok) {
    console.warn(`[JourneyExecutor] execution=${exec.execution_id} 발송 후 차감 실패(잔액 동시 소진) — 1건 부담 + 여정 정지`);
    await pauseJourney(exec.journey_id, deduct.error || '잔액 부족(발송 후)');
  }

  // ★ v2 운영 과금 (크레딧 모델 v2 2026-06-30) — 발송비(prepaidDeduct, 위)와 별개인 AI 운영 크레딧.
  //   멱등키 = 여정:KST날짜 → 같은 여정 그날 첫 발송 1건만 10 차감(동일 여정 하루 1회 상한 · 고객수만큼 안 불어남).
  //   journey-operation = 운영 source(P4) → 잔액 0이어도 −1개월 grant 상한까지 음수 허용. deductCreditSafe는 throw 0 = 발송 절대 안 막음.
  await deductCreditSafe({
    companyId: exec.company_id,
    cost: getCreditCost('journey-operation'),
    source: 'journey-operation',
    idempotencyKey: `journey-operation:${exec.journey_id}:${kstDateTag(new Date())}`,
    createdBy: exec.created_by || null,
  });

  // ★ D218+ (2026-05-26) 시점 3: 발송 직후 status 재확인 — MySQL 큐 INSERT 도중 paused 동시 발화 사고 기록 안전망.
  //   본 시점 = MySQL 큐 INSERT 종결 후 = SMS 발송 영구 진행 영역. 정지 효과 X = log + execution_status_at_pause 추적.
  try {
    const statusCheck3 = await query(
      `SELECT status FROM journey_executions WHERE id = $1::uuid`,
      [exec.execution_id]
    );
    if (statusCheck3.rows[0]?.status === 'paused') {
      console.warn(`[JourneyExecutor] execution=${exec.execution_id} 발송 직후 paused 감지 — MySQL 큐 INSERT 종결 후 = SMS 발송 진행 영역 (정지 효과 X / 본 건 추적)`);
      // pause log INSERT — execution_status_at_pause = 'sent_after_pause' 영역 추적 (journey-pause-handler.ts 의무 X = 직접 INSERT)
      await query(
        `INSERT INTO journey_step_pause_logs
           (company_id, journey_id, step_id, execution_id,
            pause_reason, pause_trigger_source,
            target_count_snapshot, execution_status_at_pause)
         VALUES ($1, $2, $3, $4, 'race_after_send', 'auto_status_check_3', $5, 'sent_after_pause')`,
        [exec.company_id, exec.journey_id, step.id, exec.execution_id, 1]
      );
    }
  } catch (s3Err: any) {
    console.warn(`[JourneyExecutor] 시점 3 status 재확인 사고 (skip):`, s3Err?.message);
  }

  // (step_log 'sent' + 차감은 위 J1 블록에서 큐 성공 직후 처리 — 멱등 마커 우선)

  // ★ Phase 5: 공유 campaign 카운트 +1 (이 step+날짜 campaign의 발송 누적 — 발송결과 목록 "N명" 표시).
  await bumpStepCampaignCount(campaignId).catch((e: any) =>
    console.warn('[JourneyExecutor] bumpStepCampaignCount 실패:', e?.message));

  // ★ D188 Phase 2-B-3 (2026-05-21): variants reward 누적 — sent=1 (click/conversion은 추후 트래킹 endpoint 영역).
  if (activeVariantId) {
    try {
      await recordJourneyStepVariantReward(activeVariantId, 1, 0, 0);
    } catch (rewardErr: any) {
      console.warn(`[JourneyExecutor] variant reward 갱신 실패:`, rewardErr?.message || rewardErr);
    }
  }

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
  // ★ 2026-06-30 여정 일반화 — date_anchor/one_shot은 단발 execution: 이 step 발송 후 상대 advance 없이 완료.
  //   date_anchor 다음 step은 anchor-scheduler가 별도 날짜에 새 단발 execution을 만든다(상대 시각 오염 차단).
  //   one_shot은 1회 발송이라 완료. event/standing(기존)은 아래 상대 advance 그대로 — start_kind null/event면 분기 안 탐(byte 불변).
  if (isSingleStepKind(exec.start_kind)) {
    await query(
      `UPDATE journey_executions SET
         status = 'completed', completed_at = NOW(),
         current_step_order = $2, total_cost = total_cost + $3
       WHERE id = $1::uuid AND status = 'active'`,
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
    // one_shot: 남은 active execution 0이면 여정 종료(ended). date_anchor는 사이클 진행 중 → anchor-scheduler가 관리.
    if (normalizeStartKind(exec.start_kind) === 'one_shot') {
      const remain = await query(
        `SELECT 1 FROM journey_executions WHERE journey_id = $1::uuid AND status = 'active' LIMIT 1`,
        [exec.journey_id]
      );
      if (remain.rows.length === 0) {
        await query(
          `UPDATE journeys SET status = 'ended', updated_at = NOW() WHERE id = $1::uuid AND status = 'active'`,
          [exec.journey_id]
        );
      }
    }
    return;
  }

  // 다음 step 조회
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): delay_mode + target_hour_kst 컬럼 SELECT 추가
  const nextRes = await query(
    `SELECT step_order, delay_hours, delay_mode, target_hour_kst FROM journey_steps
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

  const nextRow = nextRes.rows[0];
  const nextDelayHours = Number(nextRow.delay_hours || 0);
  const nextDelayMode = String(nextRow.delay_mode || 'relative');
  let nextTargetHourKst = nextRow.target_hour_kst != null ? Number(nextRow.target_hour_kst) : null;

  // ★ 2026-07-11 send-time 개인화 — journeys.personal_send_time(신규 컬럼)이 켜져 있고 다음 step이 시각 지정 모드면
  //   고객의 최근 90일 반응(클릭·방문·구매) 최빈 시간대(최소 3건)로 발송 시각을 대체. 데이터 부족/오류/미마이그레이션 = 기본 시각.
  if (nextTargetHourKst != null && (nextDelayMode === 'specific_hour' || nextDelayMode === 'relative_at_hour')) {
    try {
      const ps = await query(`SELECT personal_send_time FROM journeys WHERE id = $1::uuid`, [exec.journey_id]);
      if (ps.rows[0]?.personal_send_time === true) {
        const h = await query(
          `SELECT EXTRACT(HOUR FROM (occurred_at AT TIME ZONE 'Asia/Seoul'))::int AS h, COUNT(*)::int AS c
             FROM cdp_events
            WHERE company_id = $1::uuid AND customer_id = $2::uuid
              AND event_name IN ('message_click', 'page_view', 'purchase')
              AND occurred_at >= NOW() - INTERVAL '90 days'
            GROUP BY 1 HAVING COUNT(*) >= 3
            ORDER BY c DESC, h ASC
            LIMIT 1`,
          [exec.company_id, exec.customer_id]
        );
        const preferred = h.rows[0]?.h;
        if (preferred != null) nextTargetHourKst = clampPersonalSendHour(Number(preferred));
      }
    } catch {
      /* personal_send_time 컬럼 미마이그레이션/조회 실패 → step 기본 시각 */
    }
  }

  const nextRunAt = calculateNextRunAt(nextDelayMode, nextDelayHours, nextTargetHourKst);

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

// calculateNextRunAt — send-time-util.ts CT로 이동(Phase 6A). advanceOrComplete·trigger-watcher가 거기서 import해 공유.

/** ★ 2026-07-11 분기 — targetOrder 이상 첫 step 직전으로 이동 + 그 step의 delay로 next_run_at 계산.
 *  대상 step 없으면 false(호출부가 완료 처리). 전방 점프만 호출부에서 보장(무한루프 차단). */
async function jumpToStep(exec: ExecutionRow, targetOrder: number): Promise<boolean> {
  const t = await query(
    `SELECT step_order, delay_hours, delay_mode, target_hour_kst FROM journey_steps
      WHERE journey_id = $1::uuid AND step_order >= $2
      ORDER BY step_order ASC LIMIT 1`,
    [exec.journey_id, targetOrder]
  );
  if (t.rows.length === 0) return false;
  const row = t.rows[0];
  const nextRunAt = calculateNextRunAt(
    String(row.delay_mode || 'relative'),
    Number(row.delay_hours || 0),
    row.target_hour_kst != null ? Number(row.target_hour_kst) : null
  );
  await query(
    `UPDATE journey_executions SET current_step_order = $2, next_run_at = $3 WHERE id = $1::uuid`,
    [exec.execution_id, Number(row.step_order) - 1, nextRunAt]
  );
  return true;
}

/** 목표 달성 판정 — 목표 종류(journeys.goal_kind, 2026-07-11 신설 컬럼)별 분기.
 *  purchase(기본·현행): 신호 1 = recent_purchase_date가 진입일(KST) **다음 날 이후**(엄격 초과 — Codex P1 정정: 진입 당일 구매를 포함하면
 *    구매가 진입 사유인 여정(cdp.purchase 트리거 등)이 첫 tick에 전원 즉시 이탈해 여정이 죽는다.
 *    당일 정밀 판정은 신호 2(cdp 이벤트 시각)가 담당 — 프로필만 있는 회사는 다음 날 tick부터 이탈)
 *    신호 2 = 연동몰 cdp 구매 이벤트(event_name='purchase', extractor와 동일 값)가 진입 시각 이후(시각 정밀).
 *  click: 이 execution이 발송한 step(journey_step_logs status='sent') 이후 message_click(cdp) —
 *    evaluateJourneyStepClickedCondition과 동일 조인(전 step 합집합). 발송 전에는 절대 참이 안 됨(진입 즉시 이탈 없음).
 *  visit: 진입 시각 이후 page_view(브라우저 SDK 수집 회사 한정 — 미수집 회사는 판정 항상 거짓=여정 계속).
 *  goal_kind 컬럼 미마이그레이션(42703) = 'purchase' 폴백(현행과 동일 — 발송 본류 무영향). */
async function isGoalConvertedSinceEntry(exec: ExecutionRow): Promise<boolean> {
  let goalKind = 'purchase';
  try {
    const gk = await query(`SELECT goal_kind FROM journeys WHERE id = $1::uuid`, [exec.journey_id]);
    const v = String(gk.rows[0]?.goal_kind || 'purchase');
    if (v === 'click' || v === 'visit') goalKind = v;
  } catch {
    /* goal_kind 컬럼 미마이그레이션 → purchase(현행) */
  }

  try {
    if (goalKind === 'click') {
      const byClick = await query(
        `SELECT 1 FROM journey_step_logs jsl
          JOIN cdp_events ce ON ce.customer_id = $2::uuid
           AND ce.company_id = $3::uuid
           AND ce.event_name = 'message_click'
           AND ce.occurred_at >= jsl.sent_at
         WHERE jsl.execution_id = $1::uuid AND jsl.status = 'sent'
         LIMIT 1`,
        [exec.execution_id, exec.customer_id, exec.company_id]
      );
      return byClick.rows.length > 0;
    }

    if (goalKind === 'visit') {
      const byVisit = await query(
        `SELECT 1 FROM cdp_events
          WHERE company_id = $1::uuid AND customer_id = $2::uuid
            AND event_name = 'page_view' AND occurred_at > $3::timestamptz
          LIMIT 1`,
        [exec.company_id, exec.customer_id, exec.entered_at]
      );
      return byVisit.rows.length > 0;
    }

    // purchase (기본 · 현행 동작 보존)
    const byProfile = await query(
      `SELECT 1 FROM customers
        WHERE id = $1::uuid AND company_id = $2::uuid
          AND recent_purchase_date IS NOT NULL
          AND recent_purchase_date > ($3::timestamptz AT TIME ZONE 'Asia/Seoul')::date
        LIMIT 1`,
      [exec.customer_id, exec.company_id, exec.entered_at]
    );
    if (byProfile.rows.length > 0) return true;
    const byEvent = await query(
      `SELECT 1 FROM cdp_events
        WHERE company_id = $1::uuid AND customer_id = $2::uuid
          AND event_name = 'purchase' AND occurred_at > $3::timestamptz
        LIMIT 1`,
      [exec.company_id, exec.customer_id, exec.entered_at]
    );
    return byEvent.rows.length > 0;
  } catch (e: any) {
    console.log(`[JourneyExecutor] 목표 달성 판정 실패 — 통과(여정 계속):`, e?.message || e);
    return false;
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

// ════════════════════════════════════════════════════════════════════
// ★ Phase 7 (2026-06-04): 조건 평가 DB 오류 → 발송 보류 + 재시도/정지.
//   발송 실패 재시도(processExecution queue catch)와 동일 흐름 — error_count<1이면 5분 뒤 재평가,
//   넘으면 autoPauseExecution + pauseJourney. 조건을 확인 못 했으므로 종료(ended)도 전진(advance)도 하지 않는다.
//   사용 컬럼 전부 기존 운영 컬럼(error_count·last_error_at·error_log·next_run_at) — 신규 컬럼 0.
// ════════════════════════════════════════════════════════════════════
async function handleConditionEvalError(exec: ExecutionRow, step: StepRow): Promise<StepOutcome> {
  try {
    const ecRes = await query(
      `SELECT COALESCE(error_count, 0) AS ec FROM journey_executions WHERE id = $1::uuid`,
      [exec.execution_id]
    );
    const errorCount = Number(ecRes.rows[0]?.ec || 0);
    if (errorCount < 1) {
      // 1회 자동 재평가 — 5분 후. 발송 안 함.
      const errorLogEntry = JSON.stringify([
        { at: new Date().toISOString(), reason: 'condition_eval_db_error', step_order: step.step_order },
      ]);
      await query(
        `UPDATE journey_executions SET
           next_run_at = NOW() + INTERVAL '5 minutes',
           error_count = COALESCE(error_count, 0) + 1,
           last_error_at = NOW(),
           error_log = COALESCE(error_log, '[]'::jsonb) || $2::jsonb
         WHERE id = $1::uuid`,
        [exec.execution_id, errorLogEntry]
      );
      await logFailedStep(exec.execution_id, step.id, 'condition_eval_db_error_retry_scheduled');
      console.log(`[JourneyExecutor] execution=${exec.execution_id} step=${step.step_order} 조건 DB 평가 실패 → 5분 후 재평가 (error_count=${errorCount + 1})`);
      return 'failed';
    }
    // 재평가 1회 후에도 실패 → 발송 안 하고 정지 + 담당자 안내 (pauseReason은 기존 값 재사용).
    await autoPauseExecution({
      companyId: exec.company_id,
      journeyId: exec.journey_id,
      stepId: step.id,
      executionId: exec.execution_id,
      pauseReason: 'auto_retry_exhausted',
      pauseTriggerSource: 'condition_eval_db_error',
    });
    await pauseJourney(exec.journey_id, '조건 평가 DB 오류 (자동 재시도 후에도 실패)');
  } catch (retryErr: any) {
    console.warn('[JourneyExecutor] 조건 평가 재시도 분기 처리 실패 (skip):', retryErr?.message);
  }
  await logFailedStep(exec.execution_id, step.id, 'condition_eval_db_error');
  return 'failed';
}

// ════════════════════════════════════════════════════════════════════
// evaluateCondition — condition step 평가 (D188 Phase 2-B-1 + D210+ Phase 3 + Phase 7 안전 분기)
//
// 지원 type 3종:
//   1. customer_field   — { field, operator(== != >= <= > < in not_in is_null not_null), value }. customers 컬럼 + custom_fields fallback. (CT journey-condition.ts 순수 평가)
//   2. cdp_event_exists — { event_name, within_days, presence: exists|not_exists }. 지난 N일 이벤트 EXISTS 여부 (cdp_events, 회사 격리).
//   3. journey_step_clicked — { step_order, within_days, clicked }. 직전 step 발송 후 클릭 EXISTS 여부 (journey_step_logs + cdp_events message_click).
//
// ★ Phase 7 (2026-06-04): 반환 'met' | 'not_met' | 'error'.
//   확인 불가(null · 미지원 type · 미지원 operator · 빈 field · 빈 event_name) = not_met → 발송 안 함.
//   DB 평가 오류(cdp / clicked) = error → 호출부가 발송 보류 + 재시도. 활성화 형식검증(activateJourney)은 그대로 유지.
// ════════════════════════════════════════════════════════════════════

async function evaluateCondition(
  condJsonb: Record<string, unknown> | null,
  customer: Record<string, any>,
  executionId: string,
  companyId: string,
): Promise<ConditionOutcome> {
  // ★ Phase 7 (2026-06-04): 확인 불가 = 미충족(발송 안 함). DB 평가 오류 = error(보류).
  if (!condJsonb || typeof condJsonb !== 'object') return 'not_met';

  const type = String(condJsonb.type || '');

  // 1. customer_field — 순수 평가 (CT journey-condition).
  if (type === 'customer_field') {
    return evaluateCustomerFieldCondition(condJsonb, customer) ? 'met' : 'not_met';
  }

  // 2. cdp_event_exists — DB SELECT. 오류 시 발송 안 하고 보류(error).
  if (type === 'cdp_event_exists') {
    try {
      const matched = await evaluateCdpEventExistsCondition(condJsonb, customer.id, companyId);
      return matched ? 'met' : 'not_met';
    } catch (err: any) {
      console.error('[Journey condition] cdp_event_exists 평가 DB 오류 → 발송 보류(재시도):', err?.message);
      return 'error';
    }
  }

  // 3. journey_step_clicked — DB SELECT. 오류 시 발송 안 하고 보류(error).
  if (type === 'journey_step_clicked') {
    try {
      const matched = await evaluateJourneyStepClickedCondition(condJsonb, executionId);
      return matched ? 'met' : 'not_met';
    } catch (err: any) {
      console.error('[Journey condition] journey_step_clicked 평가 DB 오류 → 발송 보류(재시도):', err?.message);
      return 'error';
    }
  }

  // 미지원 type — 발송 안 함.
  return 'not_met';
}

/**
 * type='cdp_event_exists' 평가 (D210+ Phase 3 신규).
 * 지난 within_days 안 customer 영역 + event_name 영역 EXISTS 여부.
 * presence 영역:
 *   - 'exists'      → 1건+ EXISTS 시 true (조건 만족 — 다음 step 진입)
 *   - 'not_exists'  → 0건 EXISTS 시 true (조건 만족 — 예: 구매 안 한 영역 리마인드 발송 정합)
 */
async function evaluateCdpEventExistsCondition(
  condJsonb: Record<string, unknown>,
  customerId: string,
  companyId: string,
): Promise<boolean> {
  const eventName = String(condJsonb.event_name || '').trim();
  const withinDays = Math.max(1, Math.min(365, Number(condJsonb.within_days) || 7));
  const presence = String(condJsonb.presence || 'exists');

  if (!eventName) return false;  // Phase 7: 빈 event_name = 확인 불가 = 미충족(발송 안 함)

  const r = await query(
    `SELECT EXISTS (
       SELECT 1
       FROM cdp_events
       WHERE customer_id = $1::uuid
         AND company_id = $2::uuid
         AND event_name = $3
         AND occurred_at >= NOW() - ($4 * INTERVAL '1 day')
     ) AS event_exists`,
    [customerId, companyId, eventName, withinDays]
  );
  const exists = Boolean(r.rows[0]?.event_exists);
  return presence === 'not_exists' ? !exists : exists;
}

/**
 * type='journey_step_clicked' 평가 (D210+ Phase 3 신규).
 * 옛 step_order N 영역 발송 후 within_days 안 클릭 (cdp_events.event_name='message_click') 영역 EXISTS 여부.
 * clicked 영역:
 *   - true   → 클릭 EXISTS 시 true
 *   - false  → 클릭 0건 시 true (예: "Step 1 영역 발송 후 클릭 X 영역" → 다른 채널 영역 재시도 정합)
 */
async function evaluateJourneyStepClickedCondition(
  condJsonb: Record<string, unknown>,
  executionId: string,
): Promise<boolean> {
  const stepOrder = Math.max(1, Number(condJsonb.step_order) || 1);
  const withinDays = Math.max(1, Math.min(365, Number(condJsonb.within_days) || 7));
  const clickedTarget = condJsonb.clicked !== false;  // default true

  const r = await query(
    `SELECT EXISTS (
       SELECT 1
       FROM journey_step_logs jsl
       JOIN journey_steps js ON js.id = jsl.step_id
       JOIN journey_executions je ON je.id = jsl.execution_id
       JOIN cdp_events ce ON ce.customer_id = je.customer_id
         AND ce.event_name = 'message_click'
         AND ce.occurred_at >= jsl.sent_at
         AND ce.occurred_at <= jsl.sent_at + ($1 * INTERVAL '1 day')
       WHERE jsl.execution_id = $2::uuid
         AND js.step_order = $3
         AND jsl.status = 'sent'
     ) AS step_clicked`,
    [withinDays, executionId, stepOrder]
  );
  const clicked = Boolean(r.rows[0]?.step_clicked);
  return clickedTarget ? clicked : !clicked;
}

// ════════════════════════════════════════════════════════════════════
// ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 변수 치환 + 버튼 JSON 변환 + MMS 파일명 추출 헬퍼 3종.
// ════════════════════════════════════════════════════════════════════

// 알림톡 본문 #{변수} 치환은 alimtalk-vars.fillAlimtalkVarMap으로 통일 (2026-06-22).
// 여정 경로는 buildDefaultFallbacks(표준 대체값)를 동반해 호출한다. (기존 replaceAlimtalkVars 정의 제거)

/**
 * MMS 이미지 서버 경로 → 파일명만 추출 (sms-queue file_name1~3 정합).
 * 예: "/home/admin/mms/abc123.jpg" → "abc123.jpg"
 */
function extractBasename(filePath: string | null | undefined): string {
  if (!filePath) return '';
  const s = String(filePath);
  const idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return idx >= 0 ? s.slice(idx + 1) : s;
}
