// packages/backend/src/utils/journey-pretest-notifier-worker.ts
// D218+ (2026-05-26) 신설 — 5분 cron + notify_at 도달 schedule LMS 발송
//
// 옛 활용 영역:
//   - sendPretestNotification (CT-93)
//   - journey_pretest_schedules (status='pending' + notify_at <= NOW())

import { query } from '../config/database';
import { sendPretestNotification } from './journey-pretest-notifier';

const INTERVAL_MS = 5 * 60 * 1000; // 5분
let _workerTimer: NodeJS.Timeout | null = null;
let _workerRunning = false;

/**
 * 5분 cron tick — notify_at 도달 schedule 일제 발송.
 * idempotent: status='pending' 검증 후만 발송 (중복 차단).
 */
export async function runJourneyPretestNotifierTick(): Promise<void> {
  if (_workerRunning) return;
  _workerRunning = true;
  try {
    const dueRes = await query(
      `SELECT id FROM journey_pretest_schedules
        WHERE notify_at <= NOW() AND status = 'pending'
        ORDER BY notify_at ASC LIMIT 100`,
    );
    if (dueRes.rows.length === 0) {
      return;
    }
    console.log(`[journey-pretest-notifier] tick — ${dueRes.rows.length}건 처리 대상`);

    let sentCount = 0;
    for (const row of dueRes.rows) {
      try {
        await sendPretestNotification(row.id);
        sentCount += 1;
      } catch (err: any) {
        console.log(
          `[journey-pretest-notifier] schedule_id=${row.id} 오류 — ${err?.message || 'unknown'}`,
        );
      }
    }
    console.log(`[journey-pretest-notifier] tick 종결 — ${sentCount}건 발송`);
  } catch (err: any) {
    console.log(`[journey-pretest-notifier] tick 진입 오류 — ${err?.message || 'unknown'}`);
  } finally {
    _workerRunning = false;
  }
}

export function startJourneyPretestNotifierWorker(): void {
  if (_workerTimer) return;
  _workerTimer = setInterval(() => {
    runJourneyPretestNotifierTick().catch((e) =>
      console.log(`[journey-pretest-notifier] interval 오류 — ${(e as Error).message}`),
    );
  }, INTERVAL_MS);
  console.log('[journey-pretest-notifier] 5분 cron worker 시작');
}

export function stopJourneyPretestNotifierWorker(): void {
  if (_workerTimer) {
    clearInterval(_workerTimer);
    _workerTimer = null;
  }
}
