/**
 * Journey Anchor Scheduler — 날짜축 여정(date_anchor) (2026-06-30 여정 일반화)
 *
 * 목적
 *   회사가 지정한 기준 날짜(anchor_date)를 기준으로 step별 D-N(anchor_offset_days)일에 묶음 발송한다.
 *   고객별 execution 스레딩이 아니라 "스텝별 날짜 스케줄 발송" — 단, 발송 자산(executor·묶음 campaign·
 *   멱등 차감·안전필터·통계·정지)은 그대로 재사용한다. 스케줄러는 발송 예정일이 도래한 step의 대상을
 *   추출해 journey_anchor_dispatch(멱등)로 잠그고, 그 step 1건짜리 execution을 만들어 executor가 보낸다.
 *
 * 라이프사이클
 *   - D-0(최소 offset) 발송일이 지나면: recurrence='none' → 자동 정지(재지정 시 재가동) /
 *     recurrence≠none → 다음 앵커로 자동 갱신(computeNextAnchor). 순수 함수 isAnchorCycleComplete로 판정.
 *
 * 영구 원칙
 *   - 회사 격리: 모든 SQL company_id.
 *   - no_target_auto_relax: 대상 0건 = 침묵(발송 X). 자동완화 0.
 *   - 멱등: journey_anchor_dispatch PK(journey,step,customer,send_date) — 재실행 중복 발송 0.
 *   - 대량 차단(threshold) 동일 적용.
 *   - one_shot dispatch도 같은 단발 execution 경로 재사용.
 */

import { query, pool } from '../config/database';
import { selectAnchorAudienceIds, JOURNEY_COUNT_CAP } from './journey-target-extractor';
import { getJourneyHoldoutPct } from './journey-entry-ledger';
import {
  computeAnchorStepRunAt,
  computeNextAnchor,
  isAnchorCycleComplete,
  shiftToSendableHour,
} from './send-time-util';

const DEFAULT_ANCHOR_HOUR_KST = 10;

interface AnchorJourneyRow {
  id: string;
  company_id: string;
  anchor_date: Date | null;
  anchor_recurrence: string | null;
  anchor_recurrence_day: number | null;
  anchor_hour_kst: number | null;
  trigger_filters: Record<string, any> | null;
  threshold_recipients_per_step: number | null;
}

interface AnchorStepRow {
  id: string;
  step_order: number;
  anchor_offset_days: number | null;
  target_hour_kst: number | null;
}

/** KST 기준 날짜 문자열(YYYY-MM-DD). */
function kstDateStr(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

let workerRunning = false;

export async function runJourneyAnchorScheduler(now: Date = new Date()): Promise<{ journeys: number; dispatched: number; enqueued: number }> {
  if (workerRunning) return { journeys: 0, dispatched: 0, enqueued: 0 };
  workerRunning = true;
  const summary = { journeys: 0, dispatched: 0, enqueued: 0 };

  try {
    const jres = await query(
      `SELECT id, company_id, anchor_date, anchor_recurrence, anchor_recurrence_day, anchor_hour_kst,
              trigger_filters, threshold_recipients_per_step
       FROM journeys
       WHERE status = 'active' AND start_kind = 'date_anchor'
       ORDER BY created_at ASC`,
    );
    for (const j of jres.rows as AnchorJourneyRow[]) {
      summary.journeys++;
      try {
        const r = await processAnchorJourney(j, now);
        summary.dispatched += r.dispatched;
        summary.enqueued += r.enqueued;
      } catch (err: any) {
        console.error(`[JourneyAnchor] 여정=${j.id} 처리 실패:`, err?.message || err);
      }
    }
    if (summary.enqueued > 0) {
      console.log(`[JourneyAnchor] 처리 완료 — journeys=${summary.journeys} dispatched=${summary.dispatched} enqueued=${summary.enqueued}`);
    }
  } finally {
    workerRunning = false;
  }
  return summary;
}

async function processAnchorJourney(j: AnchorJourneyRow, now: Date): Promise<{ dispatched: number; enqueued: number }> {
  if (!j.anchor_date) return { dispatched: 0, enqueued: 0 };
  const anchorDate = new Date(j.anchor_date);
  const hourKst = j.anchor_hour_kst != null ? Number(j.anchor_hour_kst) : DEFAULT_ANCHOR_HOUR_KST;
  const todayKst = kstDateStr(now);

  const stepsRes = await query(
    `SELECT id, step_order, anchor_offset_days, target_hour_kst
     FROM journey_steps
     WHERE journey_id = $1::uuid AND COALESCE(step_type, 'message') = 'message'
     ORDER BY step_order ASC`,
    [j.id],
  );
  const steps = stepsRes.rows as AnchorStepRow[];
  if (steps.length === 0) return { dispatched: 0, enqueued: 0 };

  let dispatched = 0;
  let enqueued = 0;

  for (const step of steps) {
    const offset = step.anchor_offset_days != null ? Number(step.anchor_offset_days) : 0;
    const stepHour = step.target_hour_kst != null ? Number(step.target_hour_kst) : hourKst;
    const runAt = computeAnchorStepRunAt(anchorDate, offset, stepHour);
    // 발송 예정일이 오늘(KST)이고 발송 시각이 도래했는가.
    if (kstDateStr(runAt) !== todayKst) continue;
    if (now.getTime() < runAt.getTime()) continue;

    const sendDate = kstDateStr(runAt); // = todayKst
    const res = await dispatchAnchorStep(j, step, runAt, sendDate, now);
    dispatched++;
    enqueued += res.enqueued;
  }

  // 라이프사이클 — D-0(최소 offset) 발송일이 지났으면 정지/다음 앵커 갱신.
  const minOffset = steps.reduce((m, s) => Math.min(m, s.anchor_offset_days != null ? Number(s.anchor_offset_days) : 0), Number.MAX_SAFE_INTEGER);
  if (isAnchorCycleComplete(Number.isFinite(minOffset) ? minOffset : 0, anchorDate, now)) {
    const recurrence = String(j.anchor_recurrence || 'none');
    if (recurrence !== 'none') {
      const next = computeNextAnchor(recurrence, j.anchor_recurrence_day != null ? Number(j.anchor_recurrence_day) : null, anchorDate);
      if (next) {
        await query(
          `UPDATE journeys SET anchor_date = $2::date, updated_at = NOW()
           WHERE id = $1::uuid AND status = 'active' AND start_kind = 'date_anchor'`,
          [j.id, kstDateStr(next)],
        );
        console.log(`[JourneyAnchor] 여정=${j.id} 다음 앵커로 갱신 → ${kstDateStr(next)} (${recurrence})`);
      }
    } else {
      await query(
        `UPDATE journeys SET status = 'paused', paused_at = NOW(),
           pause_reason = $2, updated_at = NOW()
         WHERE id = $1::uuid AND status = 'active' AND start_kind = 'date_anchor'`,
        [j.id, '지정일 D-0 발송 완료. 다음 기준 날짜 지정 시 재가동'],
      );
      console.log(`[JourneyAnchor] 여정=${j.id} D-0 완료 → 자동 정지(none)`);
    }
  }

  return { dispatched, enqueued };
}

async function dispatchAnchorStep(
  j: AnchorJourneyRow,
  step: AnchorStepRow,
  runAt: Date,
  sendDate: string,
  now: Date,
): Promise<{ enqueued: number }> {
  // 대상 추출 — 안전필터 + 대상 조건(audience). 대량 차단(threshold) 적용.
  const cap = j.threshold_recipients_per_step;
  const extractLimit = cap != null ? Number(cap) + 1 : JOURNEY_COUNT_CAP;
  const ids = await selectAnchorAudienceIds(j.company_id, j.trigger_filters || {}, extractLimit);
  if (ids.length === 0) return { enqueued: 0 };
  if (cap != null && ids.length > Number(cap)) {
    await query(
      `UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $2, updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'`,
      [j.id, `대량 진입 감지 (${ids.length}건 > 상한 ${Number(cap)}건). 자동 정지, 담당자 확인 필요`],
    );
    console.warn(`[JourneyAnchor] 대량 차단 — journey=${j.id} step=${step.step_order} 후보=${ids.length} 상한=${cap} → 정지`);
    return { enqueued: 0 };
  }

  // 멱등 dispatch + 단발 execution 생성을 한 트랜잭션 — ON CONFLICT로 (journey,step,customer,날짜) 1회.
  const nextRunAt = now.getTime() >= runAt.getTime() ? shiftToSendableHour(now) : runAt;
  let enqueued = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      `INSERT INTO journey_anchor_dispatch (journey_id, step_id, customer_id, send_date)
       SELECT $1::uuid, $2::uuid, cid, $3::date FROM unnest($4::uuid[]) AS t(cid)
       ON CONFLICT (journey_id, step_id, customer_id, send_date) DO NOTHING
       RETURNING customer_id`,
      [j.id, step.id, sendDate, ids],
    );
    const newIds = claimed.rows.map((r: any) => r.customer_id);
    if (newIds.length > 0) {
      const holdoutPct = await getJourneyHoldoutPct(j.id);  // ★ 2026-07-11 홀드아웃 — 최초 진입에서만 배정
      const ins = await client.query(
        `INSERT INTO journey_executions (id, journey_id, customer_id, current_step_order, status, entered_at, next_run_at, created_at)
         SELECT gen_random_uuid(), $1::uuid, cid, $2,
                CASE
                  WHEN EXISTS (SELECT 1 FROM journey_executions he
                                WHERE he.journey_id = $1::uuid AND he.customer_id = cid AND he.status = 'holdout')
                    THEN 'holdout'
                  WHEN $5::int > 0 AND random() * 100 < $5::int THEN 'holdout'
                  ELSE 'active'
                END,
                NOW(), $3, NOW()
           FROM unnest($4::uuid[]) AS t(cid)`,
        [j.id, step.step_order - 1, nextRunAt, newIds, holdoutPct],
      );
      enqueued = ins.rowCount || 0;
      await client.query(
        `UPDATE journeys SET stats_total_entered = stats_total_entered + $2, updated_at = NOW() WHERE id = $1::uuid`,
        [j.id, enqueued],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  if (enqueued > 0) {
    console.log(`[JourneyAnchor] journey=${j.id} step=${step.step_order} (${sendDate}) 단발 enqueue=${enqueued}`);
  }
  return { enqueued };
}

/**
 * one_shot 여정 dispatch — 활성 시점(또는 예약 시각)에 대상군 1회 발송.
 *   단발 execution(current_step_order = 발송 step_order−1)을 만들어 executor가 보내고 완료(단발 분기).
 *   멱등: 이미 execution이 있으면 skip(중복 dispatch 차단). 라우트가 firstActivation 시 1회 호출.
 */
export async function dispatchOneShotJourney(companyId: string, journeyId: string, now: Date = new Date()): Promise<{ enqueued: number; reason?: string }> {
  const jr = await query(
    `SELECT id, company_id, trigger_filters, one_shot_scheduled_at, threshold_recipients_per_step, status, start_kind
       FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
    [journeyId, companyId],
  );
  const j = jr.rows[0];
  if (!j) return { enqueued: 0, reason: 'not_found' };
  if (String(j.start_kind) !== 'one_shot') return { enqueued: 0, reason: 'not_one_shot' };

  // 멱등 — 이미 dispatch(=execution 존재)면 skip.
  const exist = await query(`SELECT 1 FROM journey_executions WHERE journey_id = $1::uuid LIMIT 1`, [journeyId]);
  if (exist.rows.length > 0) return { enqueued: 0, reason: 'already_dispatched' };

  // 발송 step(첫 message step) 조회.
  const stepRes = await query(
    `SELECT id, step_order FROM journey_steps
     WHERE journey_id = $1::uuid AND COALESCE(step_type, 'message') = 'message'
     ORDER BY step_order ASC LIMIT 1`,
    [journeyId],
  );
  if (stepRes.rows.length === 0) return { enqueued: 0, reason: 'no_step' };
  const step = stepRes.rows[0];

  const cap = j.threshold_recipients_per_step;
  const extractLimit = cap != null ? Number(cap) + 1 : JOURNEY_COUNT_CAP;
  const ids = await selectAnchorAudienceIds(companyId, j.trigger_filters || {}, extractLimit);
  if (ids.length === 0) return { enqueued: 0, reason: 'no_target' };
  if (cap != null && ids.length > Number(cap)) {
    await query(
      `UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $2, updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'`,
      [journeyId, `대량 진입 감지 (${ids.length}건 > 상한 ${Number(cap)}건). 자동 정지, 담당자 확인 필요`],
    );
    return { enqueued: 0, reason: 'threshold_exceeded' };
  }

  // 발송 시각 = 예약 시각 || 즉시(발송가능 시각으로 가드).
  const scheduledAt = j.one_shot_scheduled_at ? new Date(j.one_shot_scheduled_at) : null;
  const nextRunAt = scheduledAt && scheduledAt.getTime() > now.getTime() ? scheduledAt : shiftToSendableHour(now);

  let enqueued = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const holdoutPct = await getJourneyHoldoutPct(journeyId);  // ★ 2026-07-11 홀드아웃 — 최초 진입에서만 배정
    const ins = await client.query(
      `INSERT INTO journey_executions (id, journey_id, customer_id, current_step_order, status, entered_at, next_run_at, created_at)
       SELECT gen_random_uuid(), $1::uuid, cid, $2,
              CASE
                WHEN EXISTS (SELECT 1 FROM journey_executions he
                              WHERE he.journey_id = $1::uuid AND he.customer_id = cid AND he.status = 'holdout')
                  THEN 'holdout'
                WHEN $5::int > 0 AND random() * 100 < $5::int THEN 'holdout'
                ELSE 'active'
              END,
              NOW(), $3, NOW()
         FROM unnest($4::uuid[]) AS t(cid)`,
      [journeyId, Number(step.step_order) - 1, nextRunAt, ids, holdoutPct],
    );
    enqueued = ins.rowCount || 0;
    await client.query(
      `UPDATE journeys SET stats_total_entered = stats_total_entered + $2, updated_at = NOW() WHERE id = $1::uuid`,
      [journeyId, enqueued],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  console.log(`[JourneyAnchor] one_shot journey=${journeyId} enqueue=${enqueued} (${scheduledAt ? '예약' : '즉시'})`);
  return { enqueued };
}

export function startJourneyAnchorScheduler(): void {
  const intervalMs = 30 * 60 * 1000; // 30분마다 점검(날짜·시각 도래)
  setInterval(() => {
    runJourneyAnchorScheduler().catch((err) => console.error('[JourneyAnchor] 예외:', err));
  }, intervalMs);
  setTimeout(() => {
    runJourneyAnchorScheduler().catch((err) => console.error('[JourneyAnchor] 초기 실행 예외:', err));
  }, 120 * 1000);
  console.log('[JourneyAnchor] 스케줄러 시작 (30분 주기)');
}
