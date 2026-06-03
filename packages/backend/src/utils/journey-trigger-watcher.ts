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
// 추출 조건 = journey-target-extractor 공유 컨트롤타워 (발송·미리보기 동일 기준 단일 진입점)
import { selectJourneyTargetCustomerIds } from './journey-target-extractor';
import { shiftToSendableHour } from './send-time-util';

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
  // 추출 = journey-target-extractor 공유 컨트롤타워 (발송·미리보기 동일 기준). LIMIT 500은 발송 동작 보존.
  const ids = await selectJourneyTargetCustomerIds(j.company_id, j.trigger_event, j.trigger_filters || {}, 500);
  if (ids.length === 0) {
    return { matched: 0, enqueued: 0, skipped: 0 };
  }
  return enqueueCandidates(j, ids);
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

    const nextRunAt = shiftToSendableHour(new Date(Date.now() + Number(firstStep.delay_hours || 0) * 60 * 60 * 1000));

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
