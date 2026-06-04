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
 *   - custom: audience(customer_conditions) + 안전필터 매칭 중 미진입분만 진입 (execution 안티조인 dedup, 상시 세그먼트)
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

import { query, pool } from '../config/database';
// 추출 조건 = journey-target-extractor 공유 컨트롤타워 (발송·미리보기 동일 기준 단일 진입점)
import { selectJourneyTargetCustomerIds, selectCdpEvent } from './journey-target-extractor';
import { recordEnteredWithClient } from './journey-entry-ledger';
import { calculateNextRunAt } from './send-time-util';

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
  threshold_recipients_per_step: number | null;
  last_event_cursor: Date | null;
}

interface FirstStepRow {
  id: string;
  delay_hours: number;
  delay_mode: string;
  target_hour_kst: number | null;
}

// 진입 INSERT — enqueueCandidates / processCdpCursorJourney 공용(중복 정의 방지).
const INSERT_EXECUTION_SQL =
  `INSERT INTO journey_executions (
     id, journey_id, customer_id, current_step_order, status,
     entered_at, next_run_at, created_at
   ) VALUES (
     gen_random_uuid(), $1::uuid, $2::uuid, 0, 'active',
     NOW(), $3, NOW()
   )`;

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
              allow_reentry, reentry_cooldown_days, stats_total_entered,
              threshold_recipients_per_step, last_event_cursor
       FROM journeys
       WHERE status = 'active'
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
  // ★ Phase 3: cdp 구매·예약은 이벤트 커서 경로(누락 0 + 정확히 1회). 그 외는 공유 컨트롤타워 추출.
  if (j.trigger_event === 'cdp.purchase' || j.trigger_event === 'cdp.reservation_created') {
    const eventName = j.trigger_event === 'cdp.purchase' ? 'purchase' : 'reservation_created';
    return processCdpCursorJourney(j, eventName);
  }
  // 추출 = journey-target-extractor 공유 컨트롤타워. journeyId 전달 → 신규가입은 진입 원장 기준.
  const ids = await selectJourneyTargetCustomerIds(j.company_id, j.trigger_event, j.trigger_filters || {}, 500, j.id);
  if (ids.length === 0) {
    return { matched: 0, enqueued: 0, skipped: 0 };
  }
  // ★ Phase 2 대량 차단기: 한 번 진입 후보가 회사 설정 상한 초과 → 자동발송 X, 여정 정지 + 사유 기록(담당자 확인).
  //   임의 상수 X — 회사가 설정한 threshold_recipients_per_step(NULL=무제한)만 사용.
  const cap = j.threshold_recipients_per_step;
  if (cap != null && ids.length > Number(cap)) {
    await query(
      `UPDATE journeys SET status = 'paused', paused_at = NOW(),
         pause_reason = $2, updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'`,
      [j.id, `대량 진입 감지 (${ids.length}건 > 상한 ${cap}건) — 자동 정지, 담당자 확인 필요`]
    );
    console.warn(`[JourneyTrigger] 대량 차단 — journey=${j.id} 후보=${ids.length} 상한=${cap} → 정지`);
    return { matched: ids.length, enqueued: 0, skipped: ids.length };
  }
  return enqueueCandidates(j, ids);
}

// ════════════════════════════════════════════════════════════════════
// ★ Phase 3: cdp 이벤트 커서 처리 (구매·예약) — 커서 이후~지금 이벤트 전수, 진입+커서 전진을 한 트랜잭션.
// ════════════════════════════════════════════════════════════════════

async function processCdpCursorJourney(j: ActiveJourney, eventName: string): Promise<{ matched: number; enqueued: number; skipped: number }> {
  const windowEnd = new Date();  // 이번 윈도우 끝 — 추출과 커서 전진에 동일 값
  const cursorStart = j.last_event_cursor || windowEnd;  // 커서 없으면 빈 창(다음 회차부터)
  const ids = await selectCdpEvent(j.company_id, eventName, j.trigger_filters || {}, 500, cursorStart, windowEnd);

  // 대량 차단기 — 후보 과다 시 정지+사유(커서 전진 안 함 → 재활성화 시 재평가).
  const cap = j.threshold_recipients_per_step;
  if (cap != null && ids.length > Number(cap)) {
    await query(
      `UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $2, updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'`,
      [j.id, `대량 진입 감지 (${ids.length}건 > 상한 ${cap}건) — 자동 정지, 담당자 확인 필요`]
    );
    console.warn(`[JourneyTrigger] 대량 차단(cdp) — journey=${j.id} 후보=${ids.length} 상한=${cap} → 정지`);
    return { matched: ids.length, enqueued: 0, skipped: ids.length };
  }

  const firstStepRes = await query(
    `SELECT id, delay_hours, delay_mode, target_hour_kst FROM journey_steps WHERE journey_id = $1::uuid AND step_order = 1`,
    [j.id]
  );
  // step 없거나 후보 0이어도 커서는 전진(이 창 처리 완료 표시 — 누락 방지).
  if (firstStepRes.rows.length === 0 || ids.length === 0) {
    await query(`UPDATE journeys SET last_event_cursor = $2 WHERE id = $1::uuid`, [j.id, windowEnd]);
    return { matched: ids.length, enqueued: 0, skipped: ids.length };
  }
  const firstStep = firstStepRes.rows[0] as FirstStepRow;

  // ★ 정확히 1회: 진입 전부 + 커서 전진을 한 트랜잭션 (크래시 시 통째 롤백 → 다음 회차 동일 창 재처리, 중복 0).
  let enqueued = 0;
  let skipped = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const customerId of ids) {
      const allowed = await checkCooldown(j, customerId);
      if (!allowed) { skipped++; continue; }
      const nextRunAt = calculateNextRunAt(firstStep.delay_mode, Number(firstStep.delay_hours || 0), firstStep.target_hour_kst);
      await client.query(INSERT_EXECUTION_SQL, [j.id, customerId, nextRunAt]);
      enqueued++;
    }
    await client.query(`UPDATE journeys SET last_event_cursor = $2 WHERE id = $1::uuid`, [j.id, windowEnd]);
    if (enqueued > 0) {
      await client.query(
        `UPDATE journeys SET stats_total_entered = stats_total_entered + $2, updated_at = NOW() WHERE id = $1::uuid`,
        [j.id, enqueued]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { matched: ids.length, enqueued, skipped };
}

// ════════════════════════════════════════════════════════════════════
// enqueue 처리 (cooldown 검증 + journey_executions INSERT)
// ════════════════════════════════════════════════════════════════════

async function enqueueCandidates(j: ActiveJourney, customerIds: string[]): Promise<{ matched: number; enqueued: number; skipped: number }> {
  const summary = { matched: customerIds.length, enqueued: 0, skipped: 0 };
  if (customerIds.length === 0) return summary;

  // 첫 step 조회 (step_order=1)
  const firstStepRes = await query(
    `SELECT id, delay_hours, delay_mode, target_hour_kst FROM journey_steps WHERE journey_id = $1::uuid AND step_order = 1`,
    [j.id]
  );
  if (firstStepRes.rows.length === 0) {
    return summary;
  }
  const firstStep = firstStepRes.rows[0] as FirstStepRow;

  // ★ Phase 2: 신규가입은 진입 시 원장에 'entered' 기록(execution과 원자 트랜잭션). 식별자(매장코드+전화번호) 일괄 조회.
  const isSignup = j.trigger_event === 'customer.created';
  const identityMap = new Map<string, { store_code: string | null; phone: string }>();
  if (isSignup) {
    const idRes = await query(
      `SELECT id, store_code, phone FROM customers WHERE id = ANY($1::uuid[]) AND company_id = $2::uuid`,
      [customerIds, j.company_id]
    );
    for (const row of idRes.rows) identityMap.set(row.id, { store_code: row.store_code, phone: row.phone });
  }

  const insertExecSql = INSERT_EXECUTION_SQL;

  for (const customerId of customerIds) {
    const allowed = await checkCooldown(j, customerId);
    if (!allowed) {
      summary.skipped++;
      continue;
    }

    const nextRunAt = calculateNextRunAt(firstStep.delay_mode, Number(firstStep.delay_hours || 0), firstStep.target_hour_kst);
    const insertExecParams = [j.id, customerId, nextRunAt];

    if (isSignup) {
      // 진입 원장 'entered' 기록을 execution INSERT와 한 트랜잭션으로 (원자성 — 한쪽만 남는 사고 차단).
      const ident = identityMap.get(customerId);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(insertExecSql, insertExecParams);
        if (ident?.phone) {
          await recordEnteredWithClient(client, j.id, j.company_id, ident.store_code, ident.phone);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } else {
      await query(insertExecSql, insertExecParams);
    }

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
