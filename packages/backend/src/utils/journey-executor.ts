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
import { prepaidDeduct } from './prepaid';
import { normalizePhone } from './normalize-phone';
import { getCompanyCosts } from '../config/defaults';
import { sanitizeForSms } from './message-sanitizer';
import { shortenUrlsInText } from './short-url';

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
  custom_fields: Record<string, any> | null;
  email: string | null;
  birth_date: Date | null;
  recent_purchase_date: Date | null;
}

// ★ D188 Phase 2-B-1 (2026-05-21): wait/condition step 신규 outcome — 통계 분리 영역.
type StepOutcome = 'sent' | 'skipped_hours' | 'skipped_opt_out' | 'skipped_no_customer' | 'waited' | 'condition_passed' | 'condition_failed' | 'paused_balance' | 'paused_budget' | 'paused_threshold' | 'failed' | 'completed';

// ════════════════════════════════════════════════════════════════════
// Worker — 5분 cron
// ════════════════════════════════════════════════════════════════════

let workerRunning = false;

// ★ D188 Phase 2-B-1 (2026-05-21): summary에 waited / condition_passed / condition_failed 카운트 추가.
export async function runJourneyExecutor(): Promise<{ processed: number; sent: number; skipped: number; waited: number; conditionPassed: number; conditionFailed: number; paused: number; failed: number }> {
  if (workerRunning) {
    return { processed: 0, sent: 0, skipped: 0, waited: 0, conditionPassed: 0, conditionFailed: 0, paused: 0, failed: 0 };
  }
  workerRunning = true;

  const summary = { processed: 0, sent: 0, skipped: 0, waited: 0, conditionPassed: 0, conditionFailed: 0, paused: 0, failed: 0 };

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
        else if (outcome === 'waited') summary.waited++;
        else if (outcome === 'condition_passed') summary.conditionPassed++;
        else if (outcome === 'condition_failed') summary.conditionFailed++;
        else if (outcome.startsWith('paused')) summary.paused++;
        else if (outcome.startsWith('skipped')) summary.skipped++;
        else if (outcome === 'failed') summary.failed++;
      } catch (err: any) {
        summary.failed++;
        console.error(`[JourneyExecutor] execution=${row.execution_id} 처리 실패:`, err?.message || err);
      }
    }

    if (dueRes.rows.length > 0) {
      console.log(`[JourneyExecutor] 처리 완료 — sent=${summary.sent} waited=${summary.waited} cond_pass=${summary.conditionPassed} cond_fail=${summary.conditionFailed} skipped=${summary.skipped} paused=${summary.paused} failed=${summary.failed}`);
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
    `SELECT id, journey_id, step_order, step_type, delay_hours, channel, message_template, subject, is_ad, condition_jsonb,
            alimtalk_profile_id, alimtalk_template_code, alimtalk_variable_map,
            alimtalk_next_type, alimtalk_next_contents, alimtalk_next_subject,
            mms_image_paths
     FROM journey_steps
     WHERE journey_id = $1::uuid AND step_order = $2`,
    [exec.journey_id, nextStepOrder]
  );

  if (stepRes.rows.length === 0) {
    await markExecutionCompleted(exec.execution_id, exec.journey_id);
    return 'completed';
  }

  const step = stepRes.rows[0] as StepRow;

  // ★ D188 Phase 2-B-1 (2026-05-21): step_type 분기 신규 — wait/condition은 메시지 발송 영역 우회.
  //   wait step = 메시지 발송 0 + 다음 step 진입 (delay_hours는 advanceOrComplete가 다음 step 영역 사용).
  //   condition step = 고객 조회 후 conditionJsonb 평가 — 만족 시 다음 step 진입 / 미만족 시 execution 종료.
  //   message step = 기존 흐름 (메시지 발송).
  if (step.step_type === 'wait') {
    await logSkippedStep(exec.execution_id, step.id, 'wait_step_passed');
    await advanceOrComplete(exec, step, 0);
    return 'waited';
  }

  if (step.step_type === 'condition') {
    // condition step도 customer 조회 필요 (조건 평가 영역)
    const condCustRes = await query(
      `SELECT id, phone, name, is_active, sms_opt_in, callback, custom_fields, email, birth_date,
              recent_purchase_date, recent_purchase_amount, total_purchase_amount, purchase_count,
              grade, points, age, gender, region
       FROM customers WHERE id = $1::uuid AND company_id = $2::uuid`,
      [exec.customer_id, exec.company_id]
    );
    if (condCustRes.rows.length === 0) {
      await logSkippedStep(exec.execution_id, step.id, 'condition_customer_not_found');
      await advanceOrComplete(exec, step, 0);
      return 'skipped_no_customer';
    }
    const condCustomer = condCustRes.rows[0];
    const passed = evaluateCondition(step.condition_jsonb, condCustomer);
    if (passed) {
      await logSkippedStep(exec.execution_id, step.id, 'condition_passed');
      await advanceOrComplete(exec, step, 0);
      return 'condition_passed';
    } else {
      // 조건 미만족 → execution 종료 (Phase 2-B-1 단순 매트릭스 — 분기 step은 Phase 2-B-2)
      await query(
        `UPDATE journey_executions SET status = 'ended', completed_at = NOW(), current_step_order = $2
         WHERE id = $1::uuid`,
        [exec.execution_id, step.step_order]
      );
      await logSkippedStep(exec.execution_id, step.id, 'condition_failed_ended');
      console.log(`[JourneyExecutor] execution=${exec.execution_id} step=${step.step_order} condition 미만족 → ended`);
      return 'condition_failed';
    }
  }

  // ──────────── message step (기존 흐름) ────────────

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
    );
  } catch (err: any) {
    console.warn('[JourneyExecutor] Connected Content skip:', err?.message);
  }

  // 광고 표기 — step.is_ad (DB default true) → buildAdMessage가 (광고)+080+KISA 제목 자동 합성 (알림톡 영역 무관 = 정보성 메시지)
  const isAd = step.is_ad !== false;

  let message: string;
  let subject: string;
  let kakaoTemplateRow: { id: string; template_code: string; content: string; buttons: any[]; status: string } | null = null;

  if (isKakao) {
    // ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 영역 — kakao_templates 조회 + alimtalk_variable_map 치환.
    if (!step.alimtalk_template_code) {
      await pauseJourney(exec.journey_id, `step ${step.step_order} 알림톡 템플릿 코드가 비어있어 발송 차단`);
      await logFailedStep(exec.execution_id, step.id, 'alimtalk_template_code_empty');
      return 'failed';
    }
    const tplRes = await query(
      `SELECT id, template_code, content, buttons, status
       FROM kakao_templates WHERE template_code = $1 AND company_id = $2::uuid LIMIT 1`,
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
    // 알림톡 본문 = template.content + alimtalk_variable_map 치환 (@@필드키@@ → customer[필드키] / 그 외 = 직접 입력값 그대로)
    message = replaceAlimtalkVars(
      String(kakaoTemplateRow!.content || ''),
      customer as Record<string, any>,
      step.alimtalk_variable_map || {}
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
    `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1::uuid`,
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

  // 8. 잔액 차감 (atomic) — KAKAO는 prepaidDeduct가 'KAKAO' msgType 지원 정합 (없으면 fallback 'SMS' 단가)
  const prepaidMsgType = msgType === 'KAKAO' ? 'KAKAO' : (msgType as 'SMS' | 'LMS' | 'MMS');
  const deduct = await prepaidDeduct(exec.company_id, 1, prepaidMsgType as any, exec.journey_id, exec.created_by || undefined);
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

  // ★ D188 Phase 2-B-2 (2026-05-21): campaigns INSERT — send_channel은 알림톡 시 'alimtalk' / 그 외 'sms' 정합.
  const sendChannelForCampaign = isKakao ? 'alimtalk' : 'sms';
  const campaignRes = await query(
    `INSERT INTO campaigns (
      company_id, campaign_name, message_type, message_content, subject, message_subject, message_template,
      is_ad, target_count, sent_count, created_by, send_channel, callback_number, status, scheduled_at, sent_at
    ) VALUES (
      $1::uuid, $2, $3, $4, $5, $5, $4,
      $6, 1, 1, $7::uuid, $9, $8, 'sending', NOW(), NOW()
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
      sendChannelForCampaign,
    ]
  );
  const campaignId = campaignRes.rows[0].id as string;

  // ★ D188 Phase 2-B-2 (2026-05-21): 10. queue INSERT — channel별 분기 (SMS/LMS/MMS = bulkInsertSmsQueue / KAKAO = insertAlimtalkQueue).
  try {
    const tables = await getCompanySmsTables(exec.company_id, exec.created_by || undefined);
    if (tables.length === 0) {
      await pauseJourney(exec.journey_id, 'SMS 발송 테이블 미할당');
      await logFailedStep(exec.execution_id, step.id, 'no_sms_tables');
      return 'failed';
    }

    if (isKakao && kakaoTemplateRow) {
      // 알림톡 영역 — insertAlimtalkQueue 사용. buttons → buttonJson 변환.
      const buttonJson = convertButtonsToQTmsgInline(kakaoTemplateRow.buttons || []);
      await insertAlimtalkQueue(
        tables,
        [{
          phone: cleanPhone,
          callback: callbackNumber,
          message,
          titleStr: subject || undefined,  // L/B 시 LMS 대체 제목
          templateCode: step.alimtalk_template_code || '',
          nextType: (step.alimtalk_next_type as 'N' | 'S' | 'L' | 'A' | 'B' | undefined) || 'L',
          nextContents: step.alimtalk_next_contents || undefined,
          buttonJson: buttonJson || undefined,
          etcJson: undefined,
          companyId: exec.company_id,
        }]
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
        exec.company_id,
        `journey:${exec.journey_id}:${step.id}`,
        // MMS 영역 — mms_image_paths[0..2] 사용 (basename 추출, sms-queue file_name1~3 정합)
        (msgType === 'MMS' && step.mms_image_paths && step.mms_image_paths[0]) ? extractBasename(step.mms_image_paths[0]) : '',
        (msgType === 'MMS' && step.mms_image_paths && step.mms_image_paths[1]) ? extractBasename(step.mms_image_paths[1]) : '',
        (msgType === 'MMS' && step.mms_image_paths && step.mms_image_paths[2]) ? extractBasename(step.mms_image_paths[2]) : '',
      ];
      await bulkInsertSmsQueue(tables, [row], true);
    }
  } catch (sendErr: any) {
    console.error('[JourneyExecutor] queue 발송 실패:', sendErr?.message || sendErr);
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

// ════════════════════════════════════════════════════════════════════
// ★ D188 Phase 2-B-1 (2026-05-21): evaluateCondition — condition step 평가 함수.
//   conditionJsonb 형식: { "type": "customer_field", "field": "<컬럼명>", "operator": "<연산자>", "value": <값> }
//   지원 연산자 9종: ==, !=, >=, <=, >, <, in, not_in, is_null, not_null
//   지원 필드: customers 테이블 컬럼 + custom_fields JSONB 영역.
//   잘못된 형식 / 미지원 operator = default pass (true) — activateJourney에서 사전 검증 적용됨.
// ════════════════════════════════════════════════════════════════════

function evaluateCondition(condJsonb: Record<string, unknown> | null, customer: Record<string, any>): boolean {
  if (!condJsonb || typeof condJsonb !== 'object') return true;

  const type = String(condJsonb.type || '');
  const field = String(condJsonb.field || '');
  const operator = String(condJsonb.operator || '');
  const value = (condJsonb as any).value;

  if (type !== 'customer_field' || !field) return true;

  // customer 영역 → 직접 컬럼 우선, fallback custom_fields JSONB
  let cv: any = null;
  if (field in customer) {
    cv = customer[field];
  } else if (customer.custom_fields && typeof customer.custom_fields === 'object' && field in customer.custom_fields) {
    cv = customer.custom_fields[field];
  }

  switch (operator) {
    case '==':       return String(cv ?? '') === String(value ?? '');
    case '!=':       return String(cv ?? '') !== String(value ?? '');
    case '>=':       return Number(cv) >= Number(value);
    case '<=':       return Number(cv) <= Number(value);
    case '>':        return Number(cv) > Number(value);
    case '<':        return Number(cv) < Number(value);
    case 'in':       return Array.isArray(value) && value.map((v) => String(v)).includes(String(cv ?? ''));
    case 'not_in':   return Array.isArray(value) && !value.map((v) => String(v)).includes(String(cv ?? ''));
    case 'is_null':  return cv == null || cv === '';
    case 'not_null': return cv != null && cv !== '';
    default:         return true;
  }
}

// ════════════════════════════════════════════════════════════════════
// ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 변수 치환 + 버튼 JSON 변환 + MMS 파일명 추출 헬퍼 3종.
// ════════════════════════════════════════════════════════════════════

/**
 * 알림톡 본문 #{변수} 치환.
 * varMap entry 값이 '@@필드키@@' 형식이면 customer[필드키]로 치환, 그 외는 직접 값 사용.
 * customer.custom_fields JSONB fallback.
 */
function replaceAlimtalkVars(
  content: string,
  customer: Record<string, any>,
  varMap: Record<string, string>
): string {
  if (!content) return '';
  let out = content;
  Object.entries(varMap || {}).forEach(([k, v]) => {
    const escapedKey = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let replacement: string;
    if (typeof v === 'string' && v.startsWith('@@') && v.endsWith('@@')) {
      const fieldKey = v.slice(2, -2);
      let cv: any = null;
      if (fieldKey in customer) {
        cv = customer[fieldKey];
      } else if (customer.custom_fields && typeof customer.custom_fields === 'object' && fieldKey in customer.custom_fields) {
        cv = customer.custom_fields[fieldKey];
      }
      replacement = cv != null && String(cv).trim() !== '' ? String(cv) : '';
    } else {
      replacement = v || '';
    }
    out = out.replace(new RegExp(escapedKey, 'g'), replacement);
  });
  return out;
}

/**
 * 알림톡 버튼 JSON 변환 (kakao_templates.buttons → QTmsg k_button_json 형식).
 * 입력: [{ name, type, url1, url2 }, ...] (또는 buttonName/buttonType/buttonUrlMobile/buttonUrlPc)
 * 출력: {"name1":"...","type1":"2","url1_1":"...","url1_2":"...","name2":...}  (최대 5개)
 */
function convertButtonsToQTmsgInline(buttons: any[]): string | null {
  if (!Array.isArray(buttons) || buttons.length === 0) return null;
  const TYPE_MAP: Record<string, string> = {
    DS: '1',       // 배송조회
    WL: '2',       // 웹링크
    AL: '3',       // 앱링크
    BK: '4',       // 봇키워드
    MD: '5',       // 메시지전달
    AC: '6',       // 채널추가
    BC: '4',       // 봇전환
    BF: '4',
    PD: '2',
  };
  const out: Record<string, string> = {};
  buttons.slice(0, 5).forEach((b, i) => {
    const n = i + 1;
    out[`name${n}`] = b.name || b.buttonName || b.label || `버튼${n}`;
    out[`type${n}`] = TYPE_MAP[b.type || b.buttonType] || '2';
    out[`url${n}_1`] = b.url1 || b.urlMobile || b.buttonUrlMobile || b.url || '';
    out[`url${n}_2`] = b.url2 || b.urlPc || b.buttonUrlPc || '';
  });
  return JSON.stringify(out);
}

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
