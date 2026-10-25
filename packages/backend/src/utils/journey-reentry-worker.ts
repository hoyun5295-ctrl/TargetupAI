/**
 * journey-reentry-worker.ts — D210+ Phase 3 (2026-05-23 Harold 명시)
 *
 * 자동 재진입 worker (6시간 cron)
 *
 * 본질 (사용자 승인하 자동화 매트릭스):
 *   - Harold 명시 본질 = "AI 자기 맘대로 X / 사용자 승인하 진행"
 *   - 회사 admin 명시 활성화 의무 — `journeys.auto_reentry_enabled = true` 영역만 진입
 *   - default OFF — 옛 매트릭스 X (회사 admin 명시 토글 의무)
 *
 * 진입 조건 매트릭스 (모두 만족 시 신규 execution INSERT):
 *   1. journeys.auto_reentry_enabled = true (회사 admin 명시 활성)
 *   2. journeys.status = 'active'
 *   3. journey_executions.status = 'completed' (옛 진입한 영역 영역 완료)
 *   4. completed_at <= NOW() - reentry_cooldown_days * 1 day (cooldown 영역 경과)
 *   5. customers.is_active = true AND sms_opt_in = true (활성 + opt-in)
 *   6. 옛 customer 영역 안 신규 active execution 영역 X (중복 진입 차단)
 *   7. 가장 최근 completed execution 영역만 매칭 (중복 신규 entry 차단)
 *
 * 영구 원칙 정합:
 *   - feedback_no_target_auto_relax — 자동화 본질 = 사용자 승인하 정합 (default OFF + 회사 admin 토글 의무)
 *   - 회사 격리 — journey 영역 통한 company_id FK 정합 (journey_executions 영역 직접 X)
 *   - 한줄로 운영 영향 0 — worker 실패 시 발송 영향 0
 *   - workerRunning guard — 중복 진입 차단
 *   - 한 회사 batch limit 1,000명 (큰 회사 영역 분산 정합 — 다음 cron 영역 잔존 매트릭스 정합)
 */

import { query, pool } from '../config/database';
import { entryOpenClause, lockEntryIfActive } from './journey-lineage';
import { buildJourneySafetyFilter } from './journey-safety-filter';
import { journeyOwnerConsent } from './mall-consent';
import { getJourneyOwnerScopeSql } from './store-scope';
import { calculateNextRunAt } from './send-time-util';
import { backfillPerDayOf, entryCapExceeded, dailyRoomInLock } from './journey-step-limits';

/**
 * ★ 2026-10-25 여정 구조체크 2차 #6(뿌리 대장 R1) — 재진입도 진입 감시와 같은 진입 규칙 셋을 지난다.
 *   옛: ①상한(대량 진입 멈춤) 없이 한 번에 1,000명 ②첫 칸 보낼 시각(대기 · 시각 지정)을 무시하고 지금 바로 ③작성자 범위(담당자 매장) 없이 넣었다.
 *   상한을 넘으면 진입 감시와 같은 사유로 여정을 멈춘다(사유 문장이 같아야 멈춘 이유 화면이 「최대 인원」으로 읽는다).
 */
export const REENTRY_CAP_PAUSE_REASON = (n: number, cap: number) => `대량 진입 감지 (재진입 ${n}건 > 상한 ${cap}건). 자동 정지, 담당자 확인 필요`;

const WORKER_INTERVAL_MS = 6 * 60 * 60 * 1000;  // 6h
const PER_JOURNEY_BATCH_LIMIT = 1000;  // 한 journey당 1 cron 진입 영역 limit (큰 회사 영역 분산 정합)

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;

export function startJourneyReentryWorker(): void {
  if (workerInterval) {
    console.log('[JourneyReentryWorker] 옛 worker 진입 중 — skip');
    return;
  }
  console.log('[JourneyReentryWorker] 6시간 주기 worker 시작 — 자동 재진입 진입 (회사 admin 명시 활성 영역만)');

  // 진입 직후 1회 실행 (서버 재시작 직후 옛 due 영역 즉시 진입)
  void runReentryBatch();

  workerInterval = setInterval(() => {
    void runReentryBatch();
  }, WORKER_INTERVAL_MS);
}

export function stopJourneyReentryWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('[JourneyReentryWorker] worker 종료');
  }
}

/** 진입 잠금 뒤 보니 그 판의 진입이 닫혔다 — 롤백하고 이 여정만 건너뛴다(오류 아님). */
class EntryClosedSkip extends Error {}

async function runReentryBatch(): Promise<void> {
  if (workerRunning) {
    console.log('[JourneyReentryWorker] 옛 batch 진행 중 — skip');
    return;
  }
  workerRunning = true;
  const startedAt = Date.now();
  let totalReentered = 0;
  let journeysProcessed = 0;

  try {
    // 1) auto_reentry_enabled = true + status = 'active' 영역 journey 매트릭스
    // ★ 2026-09-30 여정 V2 5차 — 진입이 닫힌 옛 판은 다시 태우지 않는다(DDL 전 = 옛 문장 그대로).
    const journeyRes = await query(
      `SELECT id, company_id, reentry_cooldown_days, threshold_recipients_per_step, trigger_event, trigger_filters
       FROM journeys
       WHERE auto_reentry_enabled = true
         AND status = 'active'${await entryOpenClause()}
       ORDER BY id`
    );

    for (const j of journeyRes.rows) {
      try {
        const journeyId = j.id;
        const companyId = j.company_id;
        const cooldownDays = Number(j.reentry_cooldown_days) || 0;
        // ★ 2026-10-02 수신동의 읽기 = CT(추출과 같은 조각 — 여정 작성자 기준)
        const consent = await journeyOwnerConsent(companyId, journeyId);
        // ★ 2026-10-25 #6 ③ — 작성자 범위(담당자 = 자기 매장 고객 · 진입 감시 · 미리보기와 같은 조각 · LIMIT 앞)
        const scopeSql = await getJourneyOwnerScopeSql(companyId, journeyId);
        // ★ 2026-10-25 #6 ② — 첫 칸 보낼 시각(진입 감시와 같은 CT · 옛: 지금 바로)
        const first = await query(
          `SELECT delay_hours, delay_mode, target_hour_kst FROM journey_steps WHERE journey_id = $1::uuid AND step_order = 1`,
          [journeyId],
        );
        if (first.rows.length === 0) continue;
        const nextRunAt = calculateNextRunAt(String(first.rows[0].delay_mode || 'relative'), Number(first.rows[0].delay_hours || 0), first.rows[0].target_hour_kst ?? null);
        // ★ 2026-10-25 #6 ① — 상한 · 하루 몫 = 진입 감시와 같은 판정(entryCapExceeded · 하루 몫이 있으면 남은 몫만 · 없으면 cap + 1 까지 뽑아 넘으면 멈춤)
        //   ★ Codex 1R — 상한 판정용 뽑기는 cap + 1(회차 1,000 명으로 먼저 자르면 상한 1,000 이상에서 넘침을 못 본다) · 1,000 명은 상한 통과 뒤 넣을 때
        const cap = j.threshold_recipients_per_step != null ? Number(j.threshold_recipients_per_step) : null;
        const backfill = backfillPerDayOf(j);
        let pickLimit = cap != null ? cap + 1 : PER_JOURNEY_BATCH_LIMIT;

        // 2) 진입 조건 매트릭스 매칭 → 상한 판정 → 신규 execution INSERT(같은 트랜잭션)
        // ★ 0930 Codex 2R — 진입 워커와 같은 진입 잠금 안에서 넣고 합계까지 한 트랜잭션(두 워커가 같은 고객을 동시에 넣지 않는다).
        const client = await pool.connect();
        let reenteredCount = 0;
        try {
          await client.query('BEGIN');
          // ★ 0930 Codex 1R · 3R — 새 판으로 옮겨도 옛 판에서 끝낸 고객이 쿨다운 뒤 다시 들어오게: 이력 · 진행 중 판정은 계보 전체,
          //   넣는 곳은 이 판. 계보는 진입 잠금 뒤 다시 읽은 목록 · 진입이 그사이 닫혔으면 넣지 않는다.
          // ★ 2026-10-25 Codex 1R — 넣기 관문(같은 잠금 안 · 그사이 끝내기 · 멈추기 · 자동 재진입 끄기면 넣지 않는다)
          const fresh = await lockEntryIfActive(client, journeyId);
          const lineage = fresh.lineageIds;
          if (!fresh.ok || !fresh.autoReentryEnabled) throw new EntryClosedSkip();
          const room = await dailyRoomInLock(client, j);
          if (room != null) pickLimit = Math.max(0, Math.min(room, cap ?? room, PER_JOURNEY_BATCH_LIMIT));
          const cand = await client.query(
            `SELECT je.customer_id
             FROM journey_executions je
             JOIN customers c ON c.id = je.customer_id AND c.company_id = $1::uuid
             WHERE je.journey_id = ANY($4::uuid[])
               -- ★ 2026-07-10: goal_met(목표 달성 종료)도 완주와 동급으로 재진입 대상 — 구매로 이탈한 고객이
               --   쿨다운 뒤 다시 대상이 되면(휴면 재발 등) 자동 재진입이 막히면 안 된다.
               -- ★ Codex P2 정정: 단 쿨다운 0일이면 goal_met은 제외 — 방금 구매로 이탈한 고객이 같은 날
               --   즉시 재진입해 독려를 다시 받는 루프 차단(완주 재진입은 기존 동작 보존).
               AND (je.status = 'completed' OR (je.status = 'goal_met' AND $2 > 0))
               AND je.completed_at IS NOT NULL
               AND je.completed_at <= NOW() - ($2 * INTERVAL '1 day')
               -- ★ Fix #1 (2026-06-05): 추출과 동일한 공통 안전필터(is_active·sms_opt_in·is_opt_out·is_invalid·수신거부 회사+전화).
               AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
               -- 옛 customer 영역 안 신규 active execution 영역 X (중복 진입 차단)
               AND NOT EXISTS (
                 SELECT 1 FROM journey_executions je2
                 WHERE je2.journey_id = ANY($4::uuid[])
                   AND je2.customer_id = je.customer_id
                   AND je2.status = 'active'
               )
               -- 가장 최근 completed execution 영역만 정합 (중복 신규 entry 차단)
               AND je.completed_at = (
                 SELECT MAX(je3.completed_at) FROM journey_executions je3
                 WHERE je3.journey_id = ANY($4::uuid[])
                   AND je3.customer_id = je.customer_id
                   AND je3.status IN ('completed', 'goal_met')
               )
             GROUP BY je.customer_id
             ORDER BY MAX(je.completed_at) ASC
             LIMIT $3`,
            // ★ 2026-10-25 Codex 2R — 쓰지 않는 바인드 0(옛 넣기 문장의 $1 = journeyId 가 남아 PostgreSQL 이 자리표 타입을 못 정해 42P18 · 재진입이 매번 실패)
            [companyId, cooldownDays, pickLimit, lineage]
          );
          const picked: string[] = cand.rows.map((x: any) => String(x.customer_id));
          if (cap != null && entryCapExceeded(cap, backfill, picked.length)) {
            // 넣지 않고 멈춘다(진입 감시 대량 차단과 같은 규칙 · 같은 사유 · 같은 트랜잭션)
            await client.query(
              `UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $3, updated_at = NOW()
                WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'active'`,
              [journeyId, companyId, REENTRY_CAP_PAUSE_REASON(picked.length, cap)],
            );
            await client.query('COMMIT');
            console.warn(`[JourneyReentryWorker] 대량 재진입 차단 — journey=${journeyId} 후보=${picked.length} 상한=${cap} → 정지`);
            continue;
          }
          const ids = picked.slice(0, PER_JOURNEY_BATCH_LIMIT);   // 회차 상한(남은 분 = 다음 회차 · 완료가 이른 순)
          const r = ids.length === 0 ? { rows: [] as any[] } : await client.query(
            `INSERT INTO journey_executions
               (id, journey_id, customer_id, current_step_order, status, next_run_at, entered_at, created_at)
             SELECT gen_random_uuid(), $1::uuid, t.cid, 0, 'active', $2, NOW(), NOW()
               FROM unnest($3::uuid[]) AS t(cid)
             RETURNING id`,
            [journeyId, nextRunAt, ids],
          );

          reenteredCount = r.rows.length;
          if (reenteredCount > 0) {
            // journeys stats_total_entered 갱신
            await client.query(
              `UPDATE journeys SET
                 stats_total_entered = stats_total_entered + $2,
                 updated_at = NOW()
               WHERE id = $1::uuid`,
              [journeyId, reenteredCount]
            );
          }
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK').catch(() => {});
          if (!(txErr instanceof EntryClosedSkip)) throw txErr;
        } finally {
          client.release();
        }
        totalReentered += reenteredCount;
        journeysProcessed++;
      } catch (err: any) {
        console.warn('[JourneyReentryWorker] journey batch 오류, skip:', j.id, err?.message);
      }
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`[JourneyReentryWorker] batch 완료 — journey ${journeysProcessed}개 / 자동 재진입 ${totalReentered}명 / ${(elapsedMs / 1000).toFixed(1)}s`);
  } catch (err: any) {
    console.error('[JourneyReentryWorker] batch 진입 오류:', err?.message);
  } finally {
    workerRunning = false;
  }
}
