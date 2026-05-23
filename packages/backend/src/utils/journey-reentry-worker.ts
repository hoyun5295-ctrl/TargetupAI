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
 *   - 6,000사+ 운영 영향 0 — worker 실패 시 발송 영향 0
 *   - workerRunning guard — 중복 진입 차단
 *   - 한 회사 batch limit 1,000명 (큰 회사 영역 분산 정합 — 다음 cron 영역 잔존 매트릭스 정합)
 */

import { query } from '../config/database';

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
    const journeyRes = await query(
      `SELECT id, company_id, reentry_cooldown_days
       FROM journeys
       WHERE auto_reentry_enabled = true
         AND status = 'active'
       ORDER BY id`
    );

    for (const j of journeyRes.rows) {
      try {
        const journeyId = j.id;
        const companyId = j.company_id;
        const cooldownDays = Number(j.reentry_cooldown_days) || 0;

        // 2) 진입 조건 매트릭스 매칭 + 신규 execution INSERT (한 SQL UPSERT)
        const r = await query(
          `INSERT INTO journey_executions
             (id, journey_id, customer_id, current_step_order, status, next_run_at, entered_at, created_at)
           SELECT
             gen_random_uuid(), $1::uuid, je.customer_id, 0, 'active', NOW(), NOW(), NOW()
           FROM journey_executions je
           JOIN customers c ON c.id = je.customer_id AND c.company_id = $2::uuid
           WHERE je.journey_id = $1::uuid
             AND je.status = 'completed'
             AND je.completed_at IS NOT NULL
             AND je.completed_at <= NOW() - ($3 * INTERVAL '1 day')
             AND c.is_active = true
             AND c.sms_opt_in = true
             -- 옛 customer 영역 안 신규 active execution 영역 X (중복 진입 차단)
             AND NOT EXISTS (
               SELECT 1 FROM journey_executions je2
               WHERE je2.journey_id = $1::uuid
                 AND je2.customer_id = je.customer_id
                 AND je2.status = 'active'
             )
             -- 가장 최근 completed execution 영역만 정합 (중복 신규 entry 차단)
             AND je.completed_at = (
               SELECT MAX(je3.completed_at) FROM journey_executions je3
               WHERE je3.journey_id = $1::uuid
                 AND je3.customer_id = je.customer_id
                 AND je3.status = 'completed'
             )
           LIMIT $4
           RETURNING id`,
          [journeyId, companyId, cooldownDays, PER_JOURNEY_BATCH_LIMIT]
        );

        const reenteredCount = r.rows.length;
        if (reenteredCount > 0) {
          // journeys stats_total_entered 갱신
          await query(
            `UPDATE journeys SET
               stats_total_entered = stats_total_entered + $2,
               updated_at = NOW()
             WHERE id = $1::uuid`,
            [journeyId, reenteredCount]
          );
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
