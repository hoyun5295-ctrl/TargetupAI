/**
 * dm-draw-worker.ts — DM 마감 추첨 워커 (1분 cron)
 *
 * lucky_draw 섹션의 draw_at 도래 시 응모자 풀에서 등급별 랜덤 추첨 → dm_winners.
 * dm_draw_runs 원자적 claim으로 중복 추첨(=중복 통보) 차단. 발송·돈 무관(당첨 통보 발송은 F/G).
 * 패턴: utils/cancelled-queue-sweeper.ts setInterval + _running 가드 미러.
 */
import { loadDrawableLuckyDraws, runLuckyDrawForCampaign } from './dm-interaction';

const INTERVAL_MS = 60 * 1000; // 1분 — draw_at 분 단위 도래 충분
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/** 1회 스캔 — 마감 도래한 미추첨 캠페인 추첨. */
export async function runDmDrawOnce(): Promise<{ scanned: number; drawn: number; winners: number }> {
  let scanned = 0;
  let drawn = 0;
  let winners = 0;

  let targets;
  try {
    targets = await loadDrawableLuckyDraws();
  } catch (err: any) {
    // 신규 테이블(dm_draw_runs 등) 미생성 = 마이그레이션 전 → 조용히 skip(로그 스팸 방지)
    if (/does not exist/i.test(err?.message || '')) return { scanned: 0, drawn: 0, winners: 0 };
    throw err;
  }

  for (const c of targets) {
    scanned++;
    try {
      const r = await runLuckyDrawForCampaign(c);
      if (r.drawn) {
        drawn++;
        winners += r.winners;
        console.log(`[dm-draw-worker] 캠페인 ${c.campaignId} 마감추첨 — 응모 ${r.entries} → 당첨 ${r.winners}`);
      }
    } catch (err: any) {
      console.error(`[dm-draw-worker] 캠페인 ${c.campaignId} 추첨 오류:`, err?.message);
    }
  }
  return { scanned, drawn, winners };
}

export function startDmDrawWorker(): void {
  if (_timer) return;
  const tick = async () => {
    if (_running) return;
    _running = true;
    try {
      await runDmDrawOnce();
    } catch (err: any) {
      console.error('[dm-draw-worker] 사이클 오류:', err?.message);
    } finally {
      _running = false;
    }
  };
  _timer = setInterval(tick, INTERVAL_MS);
  tick().catch(() => {});
  console.log('[dm-draw-worker] 시작 — 1분 주기 마감 추첨 스캔');
}
