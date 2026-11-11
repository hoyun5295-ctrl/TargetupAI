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
import { pausedSetSql, pausedCaseSetSql, ANCHOR_COMPLETED_PAUSE_REASON } from './journey-pause-reason';   // ★ 2026-11-02 여정 멈춤 CT(설계서 3-0 CT-J2)
import { createScanCursor } from './scan-cursor';
// ★ 2026-09-30 여정 V2 5차 — 진입이 닫힌 옛 판은 새 날짜 사이클을 받지 않는다.
import { entryOpenClause, lockEntryIfActive, lineageColumnsReady, oneShotColumnsReady, withJourneySessionLock } from './journey-lineage';
import { selectAnchorAudienceIds, anchorAudienceSql } from './journey-target-extractor';
// ★ 2026-09-27 한줄로 V2 S5-04 — 여정 작성자 분류코드 범위
import { getJourneyOwnerScopeSql } from './store-scope';
import { journeyOwnerConsent } from './mall-consent';
import { entryCapExceeded } from './journey-step-limits';
import { getJourneyHoldoutPct } from './journey-entry-ledger';
import {
  computeAnchorStepRunAt,
  computeNextAnchor,
  isAnchorCycleComplete,
  sendableAt,
  isNightExemptStep,
} from './send-time-util';
// ★ 2026-10-31 앞보기 창 = 발송 전 스캔과 같은 상수(설계서 docs/2026-10-31-journey-step-gate-notice-design.md §2-3)
import { PRETEST_LEAD_HOURS } from './journey-pretest-notifier';
import { deductCreditOutcome, isChargedByKey, InsufficientCreditError, type DeductOutcome } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { sendSystemAlert, alertPassFailures, type PassFailure } from './system-alert';
import { interleaveByCompany } from './concurrency';

const DEFAULT_ANCHOR_HOUR_KST = 10;

/** ★ 2026-10-31 칸 하나 뽑아 넣기의 결과 종류(「그날 처리함」 기억은 결과에서 · 대상 0 만 메모리) */
export type AnchorDispatchKind = 'dispatched' | 'no_target' | 'capped' | 'not_active';

interface AnchorJourneyRow {
  id: string;
  company_id: string;
  /** ★ 2026-10-25 #7 — 기준일 글자('YYYY-MM-DD' · `anchor_date::text`). 드라이버 Date 는 서버 로컬 자정이라 하루 당겨진다(R16). */
  anchor_day: string | null;
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
  channel: string | null;
  alimtalk_next_type: string | null;
}

/** KST 기준 날짜 문자열(YYYY-MM-DD). */
function kstDateStr(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

let workerRunning = false;

// ★ 2026-09-28 한줄로 V2 R261 — (여정 · 스텝 · 발송일) 처리 완료 표식. 발송 시각이 지나면 그날 남은 30분 틱마다
//   대상 전체를 다시 뽑고 ON CONFLICT로 버렸다(무거운 추출 반복). 게다가 그 사이 대상이 늘어 상한을 넘으면
//   이미 보낸 뒤에 여정이 정지됐다. 지정일 발송은 발송 시각의 대상이 기준이다 → 한 번 처리한 날은 다시 뽑지 않는다.
// ★ 2026-10-31 「그날 처리함」 = 결과에서 끌어낸다(설계서 docs/2026-10-31-journey-step-gate-notice-design.md §2-3 · Codex 설계 1R ② · 2R).
//   뽑아 넣음 = journey_anchor_dispatch 에 (여정 · 칸 · 발송일) 행이 있음(DB · 재시작해도 다시 안 뽑음) ·
//   대상 0 = 이 메모리에만 그날 기억(행이 없다 · 재시작하면 한 번 더 뽑는다) · 상한 초과 · 꺼짐 = 아무것도 기억하지 않는다(같은 날 다시 켜면 다시 뽑음).
//   옛: 결과와 상관없이 메모리에 찍어 재시작 뒤 다시 뽑아 상한 초과로 잡아 둔 발송까지 멈췄고, 상한 초과 날 다시 켜도 안 뽑았다.
const _anchorNoTarget = new Map<string, string>(); // `${journeyId}:${stepId}` → 대상 0 이던 발송일(KST)

/** ★ 2026-10-31 칸 발송 판정 — 발송 예정일이 오늘(KST)이고 보낼 시각 2시간 전(스캔 앞보기 창)이 됐는가. 앞서 만든 실행은 next_run_at = runAt. */
export function anchorDispatchDue(runAt: Date, now: Date): boolean {
  if (kstDateStr(runAt) !== kstDateStr(now)) return false;
  return now.getTime() >= runAt.getTime() - PRETEST_LEAD_HOURS * 60 * 60 * 1000;
}

/**
 * (여정 · 칸 · 발송일)을 이미 뽑아 넣었는가(PK 앞부분 = journey_id · step_id).
 *   ★ 2026-11-02 설계서 3-17 — 회차 루프의 잠금 밖 확인은 빠른 길 · 결정은 넣기 트랜잭션의 계보 잠금 안에서 같은 함수(run = 그 연결)로 다시 본다.
 */
export async function anchorStepDispatched(journeyId: string, stepId: string, sendDate: string, run: SqlRun = query): Promise<boolean> {
  const r = await run(
    `SELECT 1 FROM journey_anchor_dispatch WHERE journey_id = $1::uuid AND step_id = $2::uuid AND send_date = $3::date LIMIT 1`,
    [journeyId, stepId, sendDate],
  );
  return r.rows.length > 0;
}

/** 시험 전용. */
export function resetAnchorNoTargetMemory(): void { _anchorNoTarget.clear(); }

export async function runJourneyAnchorScheduler(now: Date = new Date()): Promise<{ journeys: number; dispatched: number; enqueued: number }> {
  if (workerRunning) return { journeys: 0, dispatched: 0, enqueued: 0 };
  workerRunning = true;
  const summary = { journeys: 0, dispatched: 0, enqueued: 0 };

  try {
    const jres = await query(
      `SELECT id, company_id, anchor_date::text AS anchor_day, anchor_recurrence, anchor_recurrence_day, anchor_hour_kst,
              trigger_filters, threshold_recipients_per_step
       FROM journeys
       WHERE status = 'active' AND start_kind = 'date_anchor'${await entryOpenClause()}
       ORDER BY created_at ASC`,
    );
    // ★ 2026-11-02 엔진 재설계 E2-5 — 회사 돌아가며(한 회사 날짜 기준 여정이 회차를 다 차지하지 않게)
    const ordered = interleaveByCompany(jres.rows as AnchorJourneyRow[], (x) => String(x.company_id));
    for (const j of ordered) {
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
    // ★ 2026-11-02 E1-2 — 켜졌는데 아직 넣지 못한 한 번 보내기 회복(정산은 원장 · 적재는 잠금 안 멱등)
    try {
      await recoverPendingOneShots();
    } catch (err: any) {
      console.error('[JourneyAnchor] 한 번 보내기 회복 실패(다음 회차 다시):', err?.message || err);
    }
  } finally {
    workerRunning = false;
  }
  return summary;
}

async function processAnchorJourney(j: AnchorJourneyRow, now: Date): Promise<{ dispatched: number; enqueued: number }> {
  if (!j.anchor_day) return { dispatched: 0, enqueued: 0 };
  const anchorDate = String(j.anchor_day);
  const hourKst = j.anchor_hour_kst != null ? Number(j.anchor_hour_kst) : DEFAULT_ANCHOR_HOUR_KST;
  const todayKst = kstDateStr(now);

  const stepsRes = await query(
    `SELECT id, step_order, anchor_offset_days, target_hour_kst, channel, alimtalk_next_type
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
    // ★ 2026-10-31 발송 예정일이 오늘(KST)이고 보낼 시각 2시간 전이 됐는가(앞서 만든 실행 = 2시간 전 검사 · 담당자 안내 · 정지 링크가 그대로 걸린다).
    if (!anchorDispatchDue(runAt, now)) continue;

    const sendDate = kstDateStr(runAt); // = todayKst
    const doneKey = `${j.id}:${step.id}`;
    for (const [k, d] of _anchorNoTarget) if (d !== todayKst) _anchorNoTarget.delete(k);
    if (_anchorNoTarget.get(doneKey) === sendDate) continue;              // 오늘 대상 0 이던 칸(메모리)
    if (await anchorStepDispatched(j.id, step.id, sendDate)) continue;   // 오늘 이미 뽑아 넣은 칸(DB)
    const res = await dispatchAnchorStep(j, step, runAt, sendDate, now);
    if (res.kind === 'no_target') _anchorNoTarget.set(doneKey, sendDate); // 상한 초과 · 꺼짐 = 기억 0(같은 날 다시 켜면 다시 뽑음)
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
          [j.id, next],
        );
        console.log(`[JourneyAnchor] 여정=${j.id} 다음 앵커로 갱신 → ${next} (${recurrence})`);
      }
    } else {
      // ★ 2026-10-25 #8 — 그 회차 실행이 아직 남아 있으면 멈추지 않는다(밤 경계로 다음 날 아침에 밀린 D-0 이 자정 멈춤에 걸려 안 나가던 것).
      //   실행기는 여정이 켜져 있어야 보낸다 → 남은 회차가 다 나간 다음 30분 회차에 멈춘다.
      const pp: any[] = [j.id];
      const r = await query(
        `UPDATE journeys SET ${pausedSetSql(pp, ANCHOR_COMPLETED_PAUSE_REASON)}, updated_at = NOW()
         WHERE id = $1::uuid AND status = 'active' AND start_kind = 'date_anchor'
           AND NOT EXISTS (SELECT 1 FROM journey_executions e WHERE e.journey_id = $1::uuid AND e.status = 'active')`,
        pp,
      );
      if ((r?.rowCount || 0) > 0) console.log(`[JourneyAnchor] 여정=${j.id} D-0 완료 → 자동 정지(none)`);
    }
  }

  return { dispatched, enqueued };
}

/**
 * ★ 2026-11-01 B-1101-7 ①②(뿌리 R40 「양 상한에서 자른 나머지를 버린다」 · Codex C92 2R) — 넣을 대상 = 넣기 문장의 `aud`.
 *   상한을 정한 여정 = 넘음 판정에 쓴 그 id 그대로(옛과 같은 집합) · 정하지 않은 여정 = 대상 SQL 한 벌(anchorAudienceSql)을 넣기 문장 안에서 = 한 시점의 전원.
 *   옛: 정하지 않은 여정도 10만에서 끊고 날짜 기준은 그날 「뽑음」 · 한 번 보내기는 「실행 있음」으로 남아 나머지가 조용히 빠졌다.
 *   (묶음으로 나눠 넣으면 묶음마다 기준 시점이 달라 한 번도 대상이 아니었던 조합에 보낸다 = Codex 2R · 그래서 한 문장.)
 */
async function audienceSource(companyId: string, journeyId: string, filters: Record<string, any>, cappedIds: string[] | null): Promise<{ sql: string; params: any[] }> {
  if (cappedIds) return { sql: 'SELECT unnest($1::uuid[]) AS customer_id', params: [cappedIds] };
  return anchorAudienceSql(companyId, filters, await getJourneyOwnerScopeSql(companyId, journeyId), await journeyOwnerConsent(companyId, journeyId));
}

/** 날짜 기준 칸 하나 뽑아 넣기(★ 2026-11-01 시험이 직접 부른다 · 그 밖 호출 = processAnchorJourney). */
export async function dispatchAnchorStep(
  j: AnchorJourneyRow,
  step: AnchorStepRow,
  runAt: Date,
  sendDate: string,
  now: Date,
): Promise<{ kind: AnchorDispatchKind; enqueued: number }> {
  // 대상 추출 — 안전필터 + 대상 조건(audience). 대량 차단(threshold) 적용.
  const cap = j.threshold_recipients_per_step;
  const scopeSql = await getJourneyOwnerScopeSql(j.company_id, j.id);
  const consent = await journeyOwnerConsent(j.company_id, j.id);
  // ★ 2026-11-02 설계서 3-17 · Codex 설계 4R #1 — 잠금 앞 셈 = 「대상 0 이면 잠금도 잡지 않는다」 빠른 길만(상한 셈 · 멈춤은 잠금 안 · 이미 뽑았나 뒤).
  if ((await selectAnchorAudienceIds(j.company_id, j.trigger_filters || {}, 1, scopeSql, consent)).length === 0) return { kind: 'no_target', enqueued: 0 };

  // 멱등 dispatch + 단발 execution 생성을 한 트랜잭션 — ON CONFLICT로 (journey,step,customer,날짜) 1회.
  const nextRunAt = now.getTime() >= runAt.getTime() ? sendableAt(now, isNightExemptStep(step)) : runAt;   // ★ 2026-11-02 정보성 알림톡 = 밤 예외(CT-J7)
  let enqueued = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ★ 2026-10-25 Codex 1R — 넣기 관문(같은 계보 잠금 안 · 그사이 끝내기 · 멈추기면 넣지 않는다)
    if (!(await lockEntryIfActive(client, j.id)).ok) {
      await client.query('ROLLBACK');
      return { kind: 'not_active', enqueued: 0 };
    }
    // ★ 2026-11-02 설계서 3-17 · Codex 설계 3R — 「이 칸 · 이날 이미 뽑았나」를 잠금 안에서 다시 본다(잠금 밖 확인을 두 회차가 함께 지나면 뒤 회차가
    //   잠금을 얻은 뒤 표식 없는 줄을 또 뽑았다) → (여정 · 칸 · 날) 뽑기 = 정확히 한 번 · 상한 멈춤도 이 뒤(이미 넣은 정상 발송을 멈추지 않는다 · 4R #1).
    if (await anchorStepDispatched(j.id, step.id, sendDate, (t, p) => client.query(t, p))) {
      await client.query('ROLLBACK');
      return { kind: 'dispatched', enqueued: 0 };
    }
    // 상한 정함 = 잠금 안에서 상한 + 1 까지 세어 넘으면 멈춤(같은 트랜잭션 · CT-J2 조각) · 넣기 대상 = 센 그 id · 안 정함 = 넣기 한 문장이 전원.
    let ids: string[] | null = null;
    if (cap != null) {
      ids = await selectAnchorAudienceIds(j.company_id, j.trigger_filters || {}, Number(cap) + 1, scopeSql, consent);
      if (ids.length === 0) {
        await client.query('ROLLBACK');
        return { kind: 'no_target', enqueued: 0 };
      }
      if (entryCapExceeded(cap, null, ids.length)) {   // 날짜축 = 하루 몫 없음(정한 날 한 번에)
        const pp: any[] = [j.id];
        await client.query(
          `UPDATE journeys SET ${pausedSetSql(pp, `대량 진입 감지 (${ids.length}건 > 상한 ${Number(cap)}건). 자동 정지, 담당자 확인 필요`)}, updated_at = NOW()
           WHERE id = $1::uuid AND status = 'active'`,
          pp,
        );
        await client.query('COMMIT');
        console.warn(`[JourneyAnchor] 대량 차단 — journey=${j.id} step=${step.step_order} 후보=${ids.length} 상한=${cap} → 정지`);
        return { kind: 'capped', enqueued: 0 };
      }
    }
    const holdoutPct = await getJourneyHoldoutPct(j.id);  // ★ 2026-07-11 홀드아웃 — 최초 진입에서만 배정
    // ★ 2026-11-01 B-1101-7 ① — 표식(여정 · 칸 · 고객 · 날) + 실행을 한 문장에(대상 = 한 시점 전원 · 이미 표식 있는 분 = 넣지 않음).
    const src = await audienceSource(j.company_id, j.id, j.trigger_filters || {}, ids);
    const n = src.params.length;
    const ins = await client.query(
      `WITH aud AS (${src.sql}),
       claimed AS (
         INSERT INTO journey_anchor_dispatch (journey_id, step_id, customer_id, send_date)
         SELECT $${n + 1}::uuid, $${n + 2}::uuid, aud.customer_id, $${n + 3}::date FROM aud
         ON CONFLICT (journey_id, step_id, customer_id, send_date) DO NOTHING
         RETURNING customer_id
       )
       INSERT INTO journey_executions (id, journey_id, customer_id, current_step_order, status, entered_at, next_run_at, created_at)
       SELECT gen_random_uuid(), $${n + 1}::uuid, cl.customer_id, $${n + 4},
              CASE
                WHEN EXISTS (SELECT 1 FROM journey_executions he
                              WHERE he.journey_id = $${n + 1}::uuid AND he.customer_id = cl.customer_id AND he.status = 'holdout')
                  THEN 'holdout'
                WHEN $${n + 6}::int > 0 AND random() * 100 < $${n + 6}::int THEN 'holdout'
                ELSE 'active'
              END,
              NOW(), $${n + 5}, NOW()
         FROM claimed cl`,
      [...src.params, j.id, step.id, sendDate, step.step_order - 1, nextRunAt, holdoutPct],
    );
    enqueued = ins.rowCount || 0;
    if (enqueued > 0) {
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
  return { kind: 'dispatched', enqueued };
}

/**
 * one_shot 여정 dispatch — 활성 시점(또는 예약 시각)에 대상군 1회 발송.
 *   단발 execution(current_step_order = 발송 step_order−1)을 만들어 executor가 보내고 완료(단발 분기).
 *   멱등: 이미 execution이 있으면 skip(중복 dispatch 차단). 라우트가 firstActivation 시 1회 호출.
 */
export async function dispatchOneShotJourney(companyId: string, journeyId: string, now: Date = new Date()): Promise<{ enqueued: number; reason?: string }> {
  // ★ 2026-11-02 E1-2 — 칸이 있으면 넣기 완료 표식이 진실(대상 0 · 실행이 이미 있음도 「넣음」 · 넣기 대기를 지운다)
  const tracked = await oneShotColumnsReady();
  const jr = await query(
    `SELECT id, company_id, trigger_filters, one_shot_scheduled_at, threshold_recipients_per_step, status, start_kind${tracked ? ', one_shot_dispatched_at IS NOT NULL AS dispatched' : ''}
       FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
    [journeyId, companyId],
  );
  const j = jr.rows[0];
  if (!j) return { enqueued: 0, reason: 'not_found' };
  if (String(j.start_kind) !== 'one_shot') return { enqueued: 0, reason: 'not_one_shot' };
  if (tracked && j.dispatched) return { enqueued: 0, reason: 'already_dispatched' };
  const done = async (reason: string): Promise<{ enqueued: number; reason: string }> => {
    if (tracked) await markOneShotDispatched(query, journeyId);
    return { enqueued: 0, reason };
  };

  // 멱등 — 이미 dispatch(=execution 존재)면 skip.
  const exist = await query(`SELECT 1 FROM journey_executions WHERE journey_id = $1::uuid LIMIT 1`, [journeyId]);
  if (exist.rows.length > 0) return done('already_dispatched');

  // 발송 step(첫 message step) 조회.
  const stepRes = await query(
    `SELECT id, step_order, channel, alimtalk_next_type FROM journey_steps
     WHERE journey_id = $1::uuid AND COALESCE(step_type, 'message') = 'message'
     ORDER BY step_order ASC LIMIT 1`,
    [journeyId],
  );
  if (stepRes.rows.length === 0) return done('no_step');
  const step = stepRes.rows[0];

  const cap = j.threshold_recipients_per_step;
  const scopeSql = await getJourneyOwnerScopeSql(companyId, journeyId);
  const consent = await journeyOwnerConsent(companyId, journeyId);
  // ★ 2026-11-02 설계서 3-17 · Codex 설계 4R #1 — 잠금 앞 셈 = 「대상 0 이면 잠금도 잡지 않는다」 빠른 길만(상한 셈 · 멈춤은 잠금 안 · 멱등 확인 뒤).
  if ((await selectAnchorAudienceIds(companyId, j.trigger_filters || {}, 1, scopeSql, consent)).length === 0) return done('no_target');

  // 발송 시각 = 예약 시각 || 즉시(발송가능 시각으로 가드).
  const scheduledAt = j.one_shot_scheduled_at ? new Date(j.one_shot_scheduled_at) : null;
  const nextRunAt = scheduledAt && scheduledAt.getTime() > now.getTime() ? scheduledAt : sendableAt(now, isNightExemptStep(step));   // ★ 2026-11-02 CT-J7

  let enqueued = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ★ 2026-10-25 Codex 1R — 넣기 관문(켜기 직후 그사이 끝내기 · 멈추기면 넣지 않는다)
    if (!(await lockEntryIfActive(client, journeyId)).ok) {
      await client.query('ROLLBACK');
      return { enqueued: 0, reason: 'not_active' };
    }
    // ★ 2026-11-01 Codex C92 2R(뿌리 R12) — 멱등은 잠금 안에서 다시 본다(잠금 밖 확인을 둘이 함께 지나면 뒤 호출이 기다렸다 전원을 또 넣었다).
    const again = await client.query(`SELECT 1 FROM journey_executions WHERE journey_id = $1::uuid LIMIT 1`, [journeyId]);
    if (again.rows.length > 0) {
      if (tracked) await markOneShotDispatched((t, p) => client.query(t, p), journeyId);
      await client.query(tracked ? 'COMMIT' : 'ROLLBACK');
      return { enqueued: 0, reason: 'already_dispatched' };
    }
    // 상한 정함 = 잠금 · 멱등 확인 뒤에 상한 + 1 까지 세어 넘으면 멈춤(같은 트랜잭션 · CT-J2 조각) · 넣기 대상 = 센 그 id · 안 정함 = 넣기 한 문장이 전원.
    let ids: string[] | null = null;
    if (cap != null) {
      ids = await selectAnchorAudienceIds(companyId, j.trigger_filters || {}, Number(cap) + 1, scopeSql, consent);
      if (ids.length === 0) {
        if (tracked) await markOneShotDispatched((t, p) => client.query(t, p), journeyId);   // 대상 0 = 넣음(잠금 밖 done 과 같은 판정)
        await client.query(tracked ? 'COMMIT' : 'ROLLBACK');
        return { enqueued: 0, reason: 'no_target' };
      }
      if (entryCapExceeded(cap, null, ids.length)) {   // 날짜축 = 하루 몫 없음(정한 날 한 번에)
        const pp: any[] = [journeyId];
        await client.query(
          `UPDATE journeys SET ${pausedSetSql(pp, `대량 진입 감지 (${ids.length}건 > 상한 ${Number(cap)}건). 자동 정지, 담당자 확인 필요`)}, updated_at = NOW()
           WHERE id = $1::uuid AND status = 'active'`,
          pp,
        );
        await client.query('COMMIT');
        return { enqueued: 0, reason: 'threshold_exceeded' };
      }
    }
    const holdoutPct = await getJourneyHoldoutPct(journeyId);  // ★ 2026-07-11 홀드아웃 — 최초 진입에서만 배정
    // ★ 2026-11-01 B-1101-7 ② — 대상 = 한 시점 전원(한 문장 · 10만 자르기 없음).
    const src = await audienceSource(companyId, journeyId, j.trigger_filters || {}, ids);
    const n = src.params.length;
    const ins = await client.query(
      `INSERT INTO journey_executions (id, journey_id, customer_id, current_step_order, status, entered_at, next_run_at, created_at)
       SELECT gen_random_uuid(), $${n + 1}::uuid, aud.customer_id, $${n + 2},
              CASE
                WHEN EXISTS (SELECT 1 FROM journey_executions he
                              WHERE he.journey_id = $${n + 1}::uuid AND he.customer_id = aud.customer_id AND he.status = 'holdout')
                  THEN 'holdout'
                WHEN $${n + 4}::int > 0 AND random() * 100 < $${n + 4}::int THEN 'holdout'
                ELSE 'active'
              END,
              NOW(), $${n + 3}, NOW()
         FROM (${src.sql}) aud`,
      [...src.params, journeyId, Number(step.step_order) - 1, nextRunAt, holdoutPct],
    );
    enqueued = ins.rowCount || 0;
    await client.query(
      `UPDATE journeys SET stats_total_entered = stats_total_entered + $2, updated_at = NOW() WHERE id = $1::uuid`,
      [journeyId, enqueued],
    );
    if (tracked) await markOneShotDispatched((t, p) => client.query(t, p), journeyId);   // 실행 넣기와 같은 트랜잭션
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

type SqlRun = (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

/** 넣기 완료 = 한 번만 찍고 넣기 대기를 지운다(실행 넣기와 같은 트랜잭션에서 부른다). */
async function markOneShotDispatched(run: SqlRun, journeyId: string): Promise<void> {
  await run(
    `UPDATE journeys SET one_shot_dispatched_at = COALESCE(one_shot_dispatched_at, NOW()), one_shot_dispatch_pending_at = NULL WHERE id = $1::uuid`,
    [journeyId],
  );
}

/**
 * ★ 2026-11-02 E1-2(설계 5R D5-1) — 한 번 보내기의 [정산 → 되돌리기 또는 적재]는 여정마다 하나인 잠금 안에서만.
 *   PG 세션 advisory lock · 잠금 전용 풀(lockPool · R41 · 작업 풀을 잡지 않는다) · 풀지 못하면 그 연결을 버린다(세션이 끝나야 잠금이 풀린다).
 *   wait = 켜기 경로(기다려 잡음) · try = 회복(못 잡으면 그 판 이번 회차 넘김).
 */
export async function withOneShotLock<T>(journeyId: string, wait: boolean, work: () => Promise<T>): Promise<{ locked: true; value: T } | { locked: false }> {
  // ★ 2026-11-11 C129 — 잠금의 꼴은 공용(journey-lineage withJourneySessionLock) · 이름(one-shot-settle) · 키(여정 id)는 그대로 = 옛 프로세스와 같은 잠금
  return withJourneySessionLock('one-shot-settle', journeyId, wait, work);
}

/**
 * ★ 2026-11-02 E1-2 — 정산 확인 한 곳(정산의 진실 = 원장 · 칸 없음). 계보 뿌리 판이면 첫 켜기와 같은 키 `journey-activate:<id>` 줄이 있는가 →
 *   없으면 같은 키 · 같은 차감 함수로 지금 차감(회사 잠금 안 멱등 = 두 번 빠짐 0). 뿌리가 아닌 판(새 판) = 무료 · 크레딧제 미적용 결말 = 정산 끝.
 *   chargedNow = 이번 호출이 차감(또는 같은 키 중복)으로 끝남 · alreadyCharged = 원장에 이미 있었음.
 */
export async function ensureOneShotSettled(companyId: string, journeyId: string, createdBy: string | null): Promise<
  { ok: true; chargedNow: boolean; alreadyCharged: boolean } | { ok: false; insufficient: boolean }
> {
  try {
    const lineage = await lineageColumnsReady();
    const jr = await query(`SELECT id${lineage ? ', lineage_id' : ''} FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`, [journeyId, companyId]);
    const row = jr.rows[0];
    if (!row) return { ok: false, insufficient: false };
    if (row.lineage_id && String(row.lineage_id) !== String(row.id)) return { ok: true, chargedNow: false, alreadyCharged: false };
    const key = `journey-activate:${journeyId}`;
    if (await isChargedByKey(companyId, key)) return { ok: true, chargedNow: false, alreadyCharged: true };
    let outcome: DeductOutcome;
    try {
      outcome = await deductCreditOutcome({
        companyId, cost: getCreditCost('journey-activate'), source: 'journey-activate', createdBy, idempotencyKey: key, throwOnInsufficient: true,
      });
    } catch (e) {
      if (e instanceof InsufficientCreditError) return { ok: false, insufficient: true };
      throw e;
    }
    if (outcome === 'failed') return { ok: false, insufficient: false };
    return { ok: true, chargedNow: outcome === 'deducted' || outcome === 'duplicate', alreadyCharged: false };
  } catch (err: any) {
    console.error(`[JourneyAnchor] 한 번 보내기 정산 확인 실패 journey=${journeyId}:`, err?.message || err);
    return { ok: false, insufficient: false };
  }
}

/**
 * ★ 2026-11-02 E1-2 — 이번 켜기 시도만 되돌린다(토큰 = 그 켜기가 찍은 approved_at). 그 뒤 다른 요청이 다시 켰거나 · 회복이 넣었거나 ·
 *   원장에 정산 줄이 생겼는지는 부르는 쪽이 같은 잠금 안에서 크레딧 CT(isChargedByKey)로 먼저 본다. 첫 켜기 = 초안(옛 revertFirstActivation 과 같은 칸) · 다시 켜기 = 멈춤.
 */
async function revertOneShotAttempt(companyId: string, journeyId: string, token: string, to: 'draft' | 'paused', reason: string): Promise<void> {
  try {
    await query(
      `UPDATE journeys SET status = $4::text,
              approved_by = CASE WHEN $4::text = 'draft' THEN NULL ELSE approved_by END,
              approved_at = CASE WHEN $4::text = 'draft' THEN NULL ELSE approved_at END,
              ${pausedCaseSetSql('$4::text', '$5::text')},
              last_event_cursor = CASE WHEN $4::text = 'draft' AND trigger_event = 'journey.after' THEN NULL ELSE last_event_cursor END,
              one_shot_dispatch_pending_at = NULL,
              updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'active' AND approved_at = $3::timestamptz
          AND one_shot_dispatched_at IS NULL`,
      [journeyId, companyId, token, to, reason],
    );
  } catch (err: any) {
    console.error(`[JourneyAnchor] 한 번 보내기 켜기 되돌리기 실패 journey=${journeyId}:`, err?.message || err);
    void sendSystemAlert({
      companyId,
      dedupKey: `journey-activate-revert:${journeyId}`,
      message: '여정 켜기 크레딧을 걷지 못했는데 켜기를 되돌리지 못했습니다(돈을 받지 않은 한 번 보내기 여정이 켜져 있음 · 회복이 넣기 전에 원장으로 정산합니다). 그 회사의 여정 상태를 확인해 주세요.',
    }).catch(() => undefined);
  }
}

export type OneShotActivation =
  | { ok: true; charged: boolean; dispatchPending: boolean }
  | { ok: false; code: 'INSUFFICIENT_CREDIT' | 'CREDIT_SETTLE_FAILED'; message: string };

/**
 * ★ 2026-11-02 E1-2 — 켜기 경로(한 번 보내기 · 이번 켜기가 넣기 대기를 찍은 판): 잠금 → 잠금 안 다시 판정 → 정산 → 실패 = 이번 시도만 되돌림 ·
 *   끝 = 적재. 적재가 던져도 켜기는 유지 + dispatchPending(회복이 2분 뒤부터 30분 안에 다시 넣는다).
 */
export async function settleAndDispatchOneShot(
  companyId: string, journeyId: string, userId: string, attempt: { token: string; firstActivation: boolean },
): Promise<OneShotActivation> {
  const r = await withOneShotLock(journeyId, true, async (): Promise<OneShotActivation> => {
    const cur = await query(
      `SELECT status, approved_at::text AS token, one_shot_dispatched_at IS NOT NULL AS dispatched FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
      [journeyId, companyId],
    );
    const row = cur.rows[0];
    if (!row || String(row.status) !== 'active' || String(row.token) !== attempt.token || row.dispatched) {
      // 그사이 회복이 정산 · 적재했거나 다른 요청이 멈춤 · 다시 켰다 = 이번 시도가 할 일이 없다
      const charged = !!row?.dispatched && attempt.firstActivation && (await isChargedByKey(companyId, `journey-activate:${journeyId}`).catch(() => false));
      return { ok: true, charged, dispatchPending: false };
    }
    const s = await ensureOneShotSettled(companyId, journeyId, userId);
    if (!s.ok) {
      // 되돌리기 직전 잠금 안에서 원장을 다시 본다(정산 줄이 생겼으면 되돌리지 않는다 · 원장 조회 = 크레딧 CT 함수)
      if (await isChargedByKey(companyId, `journey-activate:${journeyId}`).catch(() => true)) {
        return { ok: true, charged: attempt.firstActivation, dispatchPending: true };
      }
      const message = s.insufficient
        ? '여정 저장에 필요한 크레딧이 부족합니다. 크레딧을 충전해 주세요.'
        : '크레딧 기록을 확인하지 못해 켜지 않았어요. 잠시 후 다시 시도해 주세요.';
      await revertOneShotAttempt(companyId, journeyId, attempt.token, attempt.firstActivation ? 'draft' : 'paused', message);
      return { ok: false, code: s.insufficient ? 'INSUFFICIENT_CREDIT' : 'CREDIT_SETTLE_FAILED', message };
    }
    const charged = s.chargedNow || (attempt.firstActivation && s.alreadyCharged);
    try {
      const dr = await dispatchOneShotJourney(companyId, journeyId);
      console.log(`[Journeys activate] one_shot dispatch journey=${journeyId} enqueued=${dr.enqueued} reason=${dr.reason || ''}`);
      return { ok: true, charged, dispatchPending: false };
    } catch (dispErr: any) {
      console.error(`[Journeys activate] one_shot dispatch 실패(켜짐 유지 · 회복이 다시 넣음) journey=${journeyId}:`, dispErr?.message || dispErr);
      return { ok: true, charged, dispatchPending: true };
    }
  });
  // wait = 늘 잡는다(형식상 갈래) · 못 잡았다면 넣기 대기가 남아 회복이 넣는다
  return r.locked ? r.value : { ok: true, charged: false, dispatchPending: true };
}

/** 회복 한 회차에 보는 여정 수(여정 id 순 회전 커서 · 진행 못 하는 판이 앞자리를 영구히 막지 않는다 · R12 · Codex 구현 1R) */
export const ONE_SHOT_RECOVERY_LIMIT = 50;
const _oneShotCursor = createScanCursor();
/** 시험 전용. */
export function resetOneShotRecoveryCursor(): void { _oneShotCursor.reset(); }
/** 켜기 요청과 겹침을 줄이는 대기(겹쳐도 정산 · 적재 둘 다 멱등) */
export const ONE_SHOT_RECOVERY_GRACE_MINUTES = 2;

/**
 * ★ 2026-11-02 E1-2 — 회복: 켜짐 · 넣기 대기 · 아직 안 넣음 · 대기 2분 지남 → 잠금 잡기 시도 · 잠금 안 다시 판정 → 정산(원장 · 커밋 뒤 정산 전에 죽은 판도 여기서) → 적재.
 *   잔액 부족 · 정산 확인 실패 = 그 회차 넘김 + 운영 경보 여정마다 하루 한 통(충전되면 다음 회차) · 옛 코드 판(넣기 대기 없음 · 실행 0) = 자동 적재 0 · 경보 한 통.
 */
export async function recoverPendingOneShots(): Promise<{ checked: number; dispatched: number }> {
  const out = { checked: 0, dispatched: 0 };
  if (!(await oneShotColumnsReady())) return out;
  const rows = await query(
    `SELECT id, company_id, approved_by FROM journeys
      WHERE start_kind = 'one_shot' AND status = 'active'
        AND one_shot_dispatch_pending_at IS NOT NULL AND one_shot_dispatched_at IS NULL
        AND one_shot_dispatch_pending_at < NOW() - INTERVAL '${ONE_SHOT_RECOVERY_GRACE_MINUTES} minutes'
        AND ($1::uuid IS NULL OR id > $1::uuid)
      ORDER BY id
      LIMIT ${ONE_SHOT_RECOVERY_LIMIT}`,
    [_oneShotCursor.after],
  );
  _oneShotCursor.advance(rows.rows.map((r: any) => String(r.id)), ONE_SHOT_RECOVERY_LIMIT);
  const dispatchFailures: PassFailure[] = [];   // 이번 회차 받는 분 넣기 실패(아래 한 통)
  for (const j of rows.rows as Array<{ id: string; company_id: string; approved_by: string | null }>) {
    out.checked++;
    try {
      const r = await withOneShotLock(String(j.id), false, async () => {
        const cur = await query(
          `SELECT status, one_shot_dispatch_pending_at IS NOT NULL AS pending, one_shot_dispatched_at IS NOT NULL AS dispatched FROM journeys WHERE id = $1::uuid`,
          [j.id],
        );
        const c = cur.rows[0];
        if (!c || String(c.status) !== 'active' || !c.pending || c.dispatched) return false;
        const s = await ensureOneShotSettled(String(j.company_id), String(j.id), j.approved_by ? String(j.approved_by) : null);
        if (!s.ok) {
          void sendSystemAlert({
            companyId: String(j.company_id),
            dedupKey: `journey-one-shot-settle:${j.id}`,
            cooldownMs: 24 * 60 * 60 * 1000,
            message: `켜진 한 번 보내기 여정의 켜기 크레딧을 ${s.insufficient ? '잔액이 부족해' : '원장을 확인하지 못해'} 정산하지 못해 받는 분을 아직 넣지 않았습니다(충전 · 복구되면 다음 회차에 넣습니다). journey=${j.id}`,
          }).catch(() => undefined);
          return false;
        }
        await dispatchOneShotJourney(String(j.company_id), String(j.id));
        return true;
      });
      if (r.locked && r.value) out.dispatched++;
    } catch (err: any) {
      console.error(`[JourneyAnchor] 한 번 보내기 회복 실패 journey=${j.id}:`, err?.message || err);
      dispatchFailures.push({ companyId: String(j.company_id), key: String(j.id), error: String(err?.message || err).slice(0, 200) });
    }
  }
  // ★ 2026-11-02 설계서 docs/2026-11-01-credit-control-tower-design.md §16-6 · §17-2 — 넣기 실패 = 한 회차 1통 · 항목 = 여정(6시간 안 알린 여정은 거름 = 종전 여정당 6시간)
  //   (옛: 반복문 catch 에서 여정마다 1통 = 원인 하나에 N통 · 계약 ⑥)
  if (dispatchFailures.length > 0) {
    await alertPassFailures({
      pass: 'journey-one-shot-dispatch',
      title: '켜진 한 번 보내기 여정의 받는 분 넣기가 회복 회차에서도 실패했습니다(30분마다 다시 시도).',
      action: '서버 로그 [JourneyAnchor] 한 번 보내기 회복 실패 줄의 여정으로 원인을 확인해 주세요.',
      failures: dispatchFailures, total: rows.rows.length,
    }).catch(() => undefined);
  }
  // ★ E9 ④ — 넣기 대기가 30분을 넘은 판 = 운영 경보(원인 하나 · 회사 없음 · 1시간)
  const late = await query(
    `SELECT COUNT(*)::int AS n FROM journeys
      WHERE start_kind = 'one_shot' AND status = 'active'
        AND one_shot_dispatch_pending_at IS NOT NULL AND one_shot_dispatched_at IS NULL
        AND one_shot_dispatch_pending_at < NOW() - INTERVAL '30 minutes'`,
  );
  if (Number(late.rows[0]?.n || 0) > 0) {
    void sendSystemAlert({
      companyId: null, dedupKey: 'journey-one-shot-lag', cooldownMs: 60 * 60 * 1000,
      message: `켜진 한 번 보내기 여정 ${Number(late.rows[0].n)}개가 30분 넘게 받는 분을 넣지 못했습니다(회복 회차가 계속 다시 넣습니다 · 정산 · 적재 경보 확인).`,
    }).catch(() => undefined);
  }
  // 옛 코드 판(DDL 과 코드 배포 사이에 켜짐 · 넣기 대기 없음 · 실행 0) = 자동 적재 0 · 원인 하나 한 통
  const legacy = await query(
    `SELECT COUNT(*)::int AS n FROM journeys j
      WHERE j.start_kind = 'one_shot' AND j.status = 'active'
        AND j.one_shot_dispatch_pending_at IS NULL AND j.one_shot_dispatched_at IS NULL
        AND j.approved_at < NOW() - INTERVAL '10 minutes'
        AND NOT EXISTS (SELECT 1 FROM journey_executions e WHERE e.journey_id = j.id)`,
  );
  const n = Number(legacy.rows[0]?.n || 0);
  if (n > 0) {
    void sendSystemAlert({
      companyId: null,
      dedupKey: 'journey-one-shot-legacy-undispatched',
      cooldownMs: 6 * 60 * 60 * 1000,
      message: `켜졌지만 넣기 기록이 없는 한 번 보내기 여정이 ${n}개 있습니다(배포 전환 사이 옛 코드로 켜짐 · 자동으로 넣지 않음). 그 여정을 멈춘 뒤 다시 켜면 넣습니다.`,
    }).catch(() => undefined);
  }
  if (out.checked > 0) console.log(`[JourneyAnchor] 한 번 보내기 회복 — checked=${out.checked} dispatched=${out.dispatched}`);
  return out;
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
