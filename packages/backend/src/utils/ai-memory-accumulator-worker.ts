// packages/backend/src/utils/ai-memory-accumulator-worker.ts
// D218+ (2026-05-26) 신설 — 1시간 cron + 7일 KPI 누적 + ai_company_memory 학습
//
// 옛 활용 영역:
//   - recordCampaignLearning (CT-37 company-memory)
//   - journey_executions 완료 영역 (status='completed' 또는 'sent')

import { query } from '../config/database';
import { recordCampaignLearning } from './company-memory';

const INTERVAL_MS = 60 * 60 * 1000; // 1시간
let _workerTimer: NodeJS.Timeout | null = null;
let _workerRunning = false;

/**
 * 1시간 cron tick — 7일 누적 KPI 회사별 + step별 학습.
 * idempotent: 옛 ai_company_memory 안 동일 source_step_id + 동일 일자 중복 차단 정합.
 */
export async function runAiMemoryAccumulatorTick(): Promise<void> {
  if (_workerRunning) return;
  _workerRunning = true;
  try {
    // 7일 안 완료 execution = 회사 + journey 별 집계 + journey 이름 조회
    const recentRes = await query(
      `SELECT e.company_id, e.journey_id, j.name AS journey_name,
              COUNT(*) FILTER (WHERE e.status IN ('completed', 'sent')) AS sent_count,
              COUNT(*) FILTER (WHERE e.status = 'failed') AS failed_count
         FROM journey_executions e
         JOIN journeys j ON j.id = e.journey_id
        WHERE e.completed_at >= NOW() - INTERVAL '7 days'
          AND e.completed_at <= NOW()
        GROUP BY e.company_id, e.journey_id, j.name
        HAVING COUNT(*) >= 10`,
    );

    if (recentRes.rows.length === 0) {
      return;
    }
    console.log(`[ai-memory-accumulator] tick — ${recentRes.rows.length} 회사·여정 학습 대상`);

    let learnedCount = 0;
    for (const row of recentRes.rows) {
      try {
        const sentCount = Number(row.sent_count) || 0;
        if (sentCount < 10) continue;

        await recordCampaignLearning({
          companyId: row.company_id,
          campaignId: row.journey_id,
          campaignName: row.journey_name || '여정 자동 발송',
          channel: 'mixed',
          targetCriteria: 'journey_executor',
          messageBody: '', // 옛 short-url click_count = D183+ 후속 영역
          sentCount,
          clickCount: 0,
          conversionCount: 0,
          isAd: false,
        });
        learnedCount += 1;
      } catch (err: any) {
        console.log(
          `[ai-memory-accumulator] journey=${row.journey_id} 오류 — ${err?.message || 'unknown'}`,
        );
      }
    }
    console.log(`[ai-memory-accumulator] tick 종결 — ${learnedCount}건 학습`);
  } catch (err: any) {
    console.log(`[ai-memory-accumulator] tick 진입 오류 — ${err?.message || 'unknown'}`);
  } finally {
    _workerRunning = false;
  }
}

export function startAiMemoryAccumulatorWorker(): void {
  if (_workerTimer) return;
  _workerTimer = setInterval(() => {
    runAiMemoryAccumulatorTick().catch((e) =>
      console.log(`[ai-memory-accumulator] interval 오류 — ${(e as Error).message}`),
    );
  }, INTERVAL_MS);
  console.log('[ai-memory-accumulator] 1시간 cron worker 시작');
}

export function stopAiMemoryAccumulatorWorker(): void {
  if (_workerTimer) {
    clearInterval(_workerTimer);
    _workerTimer = null;
  }
}
