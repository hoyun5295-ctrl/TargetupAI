/**
 * ★ D227+ (2026-05-28) 예약 캠페인 자동 정리 worker
 *
 * 옛 흐름 = manage-scheduled.ts + admin.ts + campaigns.ts 안 동기 cleanupScheduledCampaigns 호출 영역
 *   → 6만건 안 30~40초 영역 사고 (영업팀장 박성용 신고).
 *
 * 신규 흐름 = 1분 cron 안 백그라운드 진행 → 응답 영역 즉시 + 옛 정리 영역 보장.
 *
 * 호출 영역 = app.ts:listen 안 startScheduledCleanupWorker() 호출.
 */

import { cleanupScheduledCampaigns } from './campaign-lifecycle';

const CLEANUP_INTERVAL_MS = 60 * 1000; // 1분 cron

export function startScheduledCleanupWorker() {
  console.log('🧹 [scheduled-cleanup] 1분 cron worker 시작 (D227+)');

  // 첫 진입 직후 1회 실행 (옛 stale 영역 정리)
  runCleanup();

  // 옛 1분 cron 영역 진입
  setInterval(runCleanup, CLEANUP_INTERVAL_MS);
}

async function runCleanup() {
  try {
    const result = await cleanupScheduledCampaigns({});
    if (result.cleaned > 0) {
      console.log(`[scheduled-cleanup] ${result.cleaned}건 정리 종결`);
    }
  } catch (err: any) {
    console.error('[scheduled-cleanup] worker 오류:', err.message || err);
  }
}
