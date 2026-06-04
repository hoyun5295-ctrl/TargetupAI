// packages/backend/src/utils/journey-pretest-notifier-worker.ts
// 5분 cron — 발송 2시간 전 스팸테스트 스캐너 scanAndPretest 실행 (Phase 6B 재설계).
//   종전 notify_at 도달 schedule 처리 방식 폐기 → 실제 next_run_at 스캔으로 교체.

import { scanAndPretest } from './journey-pretest-notifier';

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
    await scanAndPretest();
  } catch (err: any) {
    console.log(`[journey-pretest-notifier] tick 오류 — ${err?.message || 'unknown'}`);
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
