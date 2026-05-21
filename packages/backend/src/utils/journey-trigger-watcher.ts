/**
 * Journey Trigger Watcher — D187 (2026-05-20)
 *
 * 목적
 *   활성 여정의 trigger_event 영역을 5분 cron으로 polling하여 매칭 고객을 journey_executions에 enqueue합니다.
 *
 * 트리거 매트릭스 (D187 Harold 확정)
 *   - customer.created (onboarding): customers.created_at 최근 N시간 안 신규 가입 고객
 *   - cdp.purchase (repeat): cdp_events.event_name='purchase' 직전 5분 안 발생
 *   - customer.dormant (dormant): customers.recent_purchase_date < NOW() - dormant_days
 *   - cdp.cart_abandon (cart): cdp_events.event_name='cart_add' 직전 abandon_hours 시점, 이후 checkout_start 없음
 *   - customer.birthday_approaching (birthday): customers.birth_month_day = (NOW + days_before) MM-DD
 *   - cdp.reservation_created (reservation): cdp_events.event_name='reservation_created' 직전 5분
 *   - custom: 영역 처리 없음 (custom 여정은 활성화 시 외부 호출로 enqueue)
 *
 * 재진입 cooldown 정합
 *   - allow_reentry=false → 이미 execution 1건 이상이면 skip
 *   - allow_reentry=true, cooldown_days=0 → 항상 허용 (매 trigger 발생 시 신규 execution)
 *   - allow_reentry=true, cooldown_days>0 → 마지막 entered_at + cooldown_days < NOW() 시 허용
 *
 * 영구 원칙 정합
 *   - no_target_auto_relax: 매칭 0건 시 enqueue 없음, 침묵 유지
 *   - 회사 격리: 모든 SQL company_id 필수
 *   - ai_operator_model_isolation: AI 호출 없음 (Sonnet 4.6 흐름 영향 0)
 */

import { query } from '../config/database';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

interface ActiveJourney {
  id: string;
  company_id: string;
  template_code: string;
  trigger_event: string;
  trigger_filters: Record<string, any>;
  allow_reentry: boolean;
  reentry_cooldown_days: number | null;
  stats_total_entered: number;
}

interface FirstStepRow {
  id: string;
  delay_hours: number;
}

// ════════════════════════════════════════════════════════════════════
// Worker — 5분 cron
// ════════════════════════════════════════════════════════════════════

let workerRunning = false;

export async function runJourneyTriggerWatcher(): Promise<{ matched: number; enqueued: number; skipped: number }> {
  if (workerRunning) {
    return { matched: 0, enqueued: 0, skipped: 0 };
  }
  workerRunning = true;

  const summary = { matched: 0, enqueued: 0, skipped: 0 };

  try {
    const activeRes = await query(
      `SELECT id, company_id, template_code, trigger_event, trigger_filters,
              allow_reentry, reentry_cooldown_days, stats_total_entered
       FROM journeys
       WHERE status = 'active' AND template_code != 'custom'
       ORDER BY created_at ASC`
    );

    for (const j of activeRes.rows as ActiveJourney[]) {
      try {
        const result = await processJourneyTrigger(j);
        summary.matched += result.matched;
        summary.enqueued += result.enqueued;
        summary.skipped += result.skipped;
      } catch (err: any) {
        console.error(`[JourneyTrigger] 여정=${j.id} 처리 실패:`, err?.message || err);
      }
    }

    if (summary.matched > 0 || summary.enqueued > 0) {
      console.log(`[JourneyTrigger] 처리 완료 — matched=${summary.matched} enqueued=${summary.enqueued} skipped=${summary.skipped}`);
    }
  } finally {
    workerRunning = false;
  }

  return summary;
}

export function startJourneyTriggerWatcher(): void {
  const intervalMs = 5 * 60 * 1000;
  setInterval(() => {
    runJourneyTriggerWatcher().catch((err) => console.error('[JourneyTrigger] 예외:', err));
  }, intervalMs);
  setTimeout(() => {
    runJourneyTriggerWatcher().catch((err) => console.error('[JourneyTrigger] 초기 실행 예외:', err));
  }, 90 * 1000);
  console.log('[JourneyTrigger] 스케줄러 시작 (5분 주기)');
}

// ════════════════════════════════════════════════════════════════════
// 여정별 trigger 처리
// ════════════════════════════════════════════════════════════════════

async function processJourneyTrigger(j: ActiveJourney): Promise<{ matched: number; enqueued: number; skipped: number }> {
  const filters = j.trigger_filters || {};

  switch (j.trigger_event) {
    case 'customer.created':
      return matchCustomerCreated(j, Number(filters.recent_hours || 24));
    case 'cdp.purchase':
      return matchCdpEvent(j, 'purchase', 5);
    case 'customer.dormant':
      return matchCustomerDormant(j, Number(filters.dormant_days || 30));
    case 'cdp.cart_abandon':
      return matchCartAbandon(j, Number(filters.abandon_hours || 24));
    case 'customer.birthday_approaching':
      return matchBirthdayApproaching(j, Number(filters.days_before || 7));
    case 'cdp.reservation_created':
      return matchCdpEvent(j, 'reservation_created', 5);
    default:
      return { matched: 0, enqueued: 0, skipped: 0 };
  }
}

// 1. 신규 가입 (customers.created_at 직전 N시간 안)
async function matchCustomerCreated(j: ActiveJourney, recentHours: number): Promise<{ matched: number; enqueued: number; skipped: number }> {
  const candidates = await query(
    `SELECT id AS customer_id FROM customers
     WHERE company_id = $1::uuid
       AND is_active = true
       AND sms_opt_in = true
       AND created_at >= NOW() - ($2 || ' hours')::interval
     ORDER BY created_at DESC
     LIMIT 500`,
    [j.company_id, String(recentHours)]
  );
  return enqueueCandidates(j, candidates.rows.map((r: any) => r.customer_id));
}

// 2. 재구매 / 6. 예약 (cdp_events 직전 N분)
async function matchCdpEvent(j: ActiveJourney, eventName: string, recentMinutes: number): Promise<{ matched: number; enqueued: number; skipped: number }> {
  const candidates = await query(
    `SELECT DISTINCT customer_id FROM cdp_events
     WHERE company_id = $1::uuid
       AND event_name = $2
       AND customer_id IS NOT NULL
       AND occurred_at >= NOW() - ($3 || ' minutes')::interval
     LIMIT 500`,
    [j.company_id, eventName, String(recentMinutes)]
  );
  return enqueueCandidates(j, candidates.rows.map((r: any) => r.customer_id));
}

// 3. 휴면 (customers.recent_purchase_date < NOW - N일)
async function matchCustomerDormant(j: ActiveJourney, dormantDays: number): Promise<{ matched: number; enqueued: number; skipped: number }> {
  const candidates = await query(
    `SELECT id AS customer_id FROM customers
     WHERE company_id = $1::uuid
       AND is_active = true
       AND sms_opt_in = true
       AND recent_purchase_date IS NOT NULL
       AND recent_purchase_date < (CURRENT_DATE - ($2 || ' days')::interval)
       AND recent_purchase_date > (CURRENT_DATE - ($3 || ' days')::interval)
     ORDER BY recent_purchase_date DESC
     LIMIT 500`,
    [j.company_id, String(dormantDays), String(dormantDays + 7)]
  );
  return enqueueCandidates(j, candidates.rows.map((r: any) => r.customer_id));
}

// 4. 장바구니 포기 (cdp_events cart_add 직전 abandon_hours, 이후 checkout_start 없음)
async function matchCartAbandon(j: ActiveJourney, abandonHours: number): Promise<{ matched: number; enqueued: number; skipped: number }> {
  const candidates = await query(
    `WITH abandoned AS (
       SELECT DISTINCT ON (customer_id) customer_id, occurred_at AS cart_add_at
       FROM cdp_events
       WHERE company_id = $1::uuid
         AND event_name = 'cart_add'
         AND customer_id IS NOT NULL
         AND occurred_at >= NOW() - (($2::int + 1) || ' hours')::interval
         AND occurred_at <= NOW() - ($2 || ' hours')::interval
       ORDER BY customer_id, occurred_at DESC
     )
     SELECT a.customer_id
     FROM abandoned a
     WHERE NOT EXISTS (
       SELECT 1 FROM cdp_events e2
       WHERE e2.company_id = $1::uuid
         AND e2.customer_id = a.customer_id
         AND e2.event_name IN ('checkout_start', 'purchase')
         AND e2.occurred_at > a.cart_add_at
     )
     LIMIT 500`,
    [j.company_id, String(abandonHours)]
  );
  return enqueueCandidates(j, candidates.rows.map((r: any) => r.customer_id));
}

// 5. 생일 (D-N): NOW + N days의 MM-DD가 customers.birth_month_day 또는 birth_date와 일치
async function matchBirthdayApproaching(j: ActiveJourney, daysBefore: number): Promise<{ matched: number; enqueued: number; skipped: number }> {
  const candidates = await query(
    `SELECT id AS customer_id FROM customers
     WHERE company_id = $1::uuid
       AND is_active = true
       AND sms_opt_in = true
       AND (
         (birth_month_day IS NOT NULL AND birth_month_day = TO_CHAR((CURRENT_DATE + ($2 || ' days')::interval), 'MM-DD'))
         OR
         (birth_date IS NOT NULL AND TO_CHAR(birth_date, 'MM-DD') = TO_CHAR((CURRENT_DATE + ($2 || ' days')::interval), 'MM-DD'))
       )
     LIMIT 500`,
    [j.company_id, String(daysBefore)]
  );
  return enqueueCandidates(j, candidates.rows.map((r: any) => r.customer_id));
}

// ════════════════════════════════════════════════════════════════════
// enqueue 처리 (cooldown 검증 + journey_executions INSERT)
// ════════════════════════════════════════════════════════════════════

async function enqueueCandidates(j: ActiveJourney, customerIds: string[]): Promise<{ matched: number; enqueued: number; skipped: number }> {
  const summary = { matched: customerIds.length, enqueued: 0, skipped: 0 };
  if (customerIds.length === 0) return summary;

  // 첫 step 조회 (step_order=1)
  const firstStepRes = await query(
    `SELECT id, delay_hours FROM journey_steps WHERE journey_id = $1::uuid AND step_order = 1`,
    [j.id]
  );
  if (firstStepRes.rows.length === 0) {
    return summary;
  }
  const firstStep = firstStepRes.rows[0] as FirstStepRow;

  for (const customerId of customerIds) {
    const allowed = await checkCooldown(j, customerId);
    if (!allowed) {
      summary.skipped++;
      continue;
    }

    const nextRunAt = new Date(Date.now() + Number(firstStep.delay_hours || 0) * 60 * 60 * 1000);

    await query(
      `INSERT INTO journey_executions (
         id, journey_id, customer_id, current_step_order, status,
         entered_at, next_run_at, created_at
       ) VALUES (
         gen_random_uuid(), $1::uuid, $2::uuid, 0, 'active',
         NOW(), $3, NOW()
       )`,
      [j.id, customerId, nextRunAt]
    );

    summary.enqueued++;
  }

  if (summary.enqueued > 0) {
    await query(
      `UPDATE journeys SET stats_total_entered = stats_total_entered + $2, updated_at = NOW()
       WHERE id = $1::uuid`,
      [j.id, summary.enqueued]
    );
  }

  return summary;
}

async function checkCooldown(j: ActiveJourney, customerId: string): Promise<boolean> {
  if (!j.allow_reentry) {
    // 재진입 불가 — 어떤 execution이라도 존재 시 차단
    const r = await query(
      `SELECT 1 FROM journey_executions WHERE journey_id = $1::uuid AND customer_id = $2::uuid LIMIT 1`,
      [j.id, customerId]
    );
    return r.rows.length === 0;
  }

  // 재진입 가능
  const cooldownDays = Number(j.reentry_cooldown_days || 0);
  if (cooldownDays <= 0) {
    return true;
  }

  const last = await query(
    `SELECT entered_at FROM journey_executions
     WHERE journey_id = $1::uuid AND customer_id = $2::uuid
     ORDER BY entered_at DESC LIMIT 1`,
    [j.id, customerId]
  );
  if (last.rows.length === 0) return true;

  const lastEntered = new Date(last.rows[0].entered_at).getTime();
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
  return Date.now() - lastEntered >= cooldownMs;
}
