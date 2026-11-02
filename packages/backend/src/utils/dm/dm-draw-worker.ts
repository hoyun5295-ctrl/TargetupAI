/**
 * dm-draw-worker.ts — DM 마감 추첨 워커 (1분 cron)
 *
 * lucky_draw 섹션의 draw_at 도래 시 응모자 풀에서 등급별 랜덤 추첨 → dm_winners.
 * dm_draw_runs 원자적 claim으로 중복 추첨(=중복 통보) 차단. 발송·돈 무관(당첨 통보 발송은 F/G).
 * 패턴: utils/cancelled-queue-sweeper.ts setInterval + _running 가드 미러.
 */
import { loadDrawableLuckyDraws, runLuckyDrawForCampaign, type DrawableCampaign } from './dm-interaction';
import { notifyOperatorAdmins } from '../continuous-operator';
import { alertPassFailures, type PassFailure } from '../system-alert';

const INTERVAL_MS = 60 * 1000; // 1분 — draw_at 분 단위 도래 충분
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/**
 * ★ 2026-10-25 원장 #71 — 추첨 실패 = 횟수 상한 · 다음 시도 시각 · 담당자 통지 · 운영 경보(옛: 로그만 · 1분마다 끝없이 · 사람 0).
 *   실패 N 번째마다 다음 시도를 늦추고(1 · 2 · 4 … 최대 60분), DRAW_FAIL_NOTIFY 번째 실패에 한 번 알린다(그 뒤에도 늦춰 가며 다시 시도 · 성공하면 지운다).
 *   ponytail: 횟수는 프로세스 메모리 — 재기동하면 처음부터 센다(그때 다시 한 번 알린다 · 추첨 표에 칸을 더하지 않는다).
 */
const DRAW_FAIL_NOTIFY = 5;
const drawFails = new Map<string, { count: number; nextAt: number }>();
/** 돌려줌 = 이번이 알릴 차례인가(DRAW_FAIL_NOTIFY 번째 실패) — 운영 경보는 부르는 패스가 모아 1통 */
async function noteDrawFailure(c: DrawableCampaign, err: any): Promise<boolean> {
  const prev = drawFails.get(c.campaignId) || { count: 0, nextAt: 0 };
  const count = prev.count + 1;
  const waitMin = Math.min(60, 2 ** (count - 1));
  drawFails.set(c.campaignId, { count, nextAt: Date.now() + waitMin * 60 * 1000 });
  if (count !== DRAW_FAIL_NOTIFY) return false;
  const title = c.title ? `'${c.title}'` : '모바일 DM';
  await notifyOperatorAdmins(
    { adminPhoneNumbers: [], backupAdminPhone: null, companyId: c.companyId, createdBy: c.createdBy || null },
    '[모바일 DM] 추첨 확인 필요',
    `${title} 마감 추첨을 ${count}번 시도했지만 당첨자를 뽑지 못했어요. 늦춰 가며 다시 시도하고 있어요. 계속되면 고객센터로 알려 주세요.`,
    { noticeHeader: '[한줄로 모바일 DM 안내문자]' },
  ).catch((e: any) => console.warn('[dm-draw-worker] 추첨 실패 통지 경고:', e?.message));
  return true;
}

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

  const failures: PassFailure[] = [];
  for (const c of targets) {
    const f = drawFails.get(c.campaignId);
    if (f && f.nextAt > Date.now()) continue;   // 실패 뒤 늦춘 다음 시도 시각 전
    scanned++;
    try {
      const r = await runLuckyDrawForCampaign(c);
      drawFails.delete(c.campaignId);
      if (r.drawn) {
        drawn++;
        winners += r.winners;
        console.log(`[dm-draw-worker] 캠페인 ${c.campaignId} 마감추첨 — 응모 ${r.entries} → 당첨 ${r.winners}`);
      }
    } catch (err: any) {
      console.error(`[dm-draw-worker] 캠페인 ${c.campaignId} 추첨 오류:`, err?.message);
      if (await noteDrawFailure(c, err)) failures.push({ companyId: c.companyId, error: String(err?.message || err), key: c.campaignId });
    }
  }
  // ★ 2026-11-01 §16-6 — 운영 경보 = 한 주기 1통(옛: 캠페인마다 1통) · 캠페인 = 로그 · 담당자 통지는 캠페인마다 그대로
  await alertPassFailures({
    pass: 'dm-draw', title: `DM 마감 추첨이 ${DRAW_FAIL_NOTIFY}번 연속 실패한 캠페인이 있습니다.`, failures, total: scanned,
    action: '서버 로그 [dm-draw-worker] 추첨 오류 줄을 확인해 주세요(늦춰 가며 다시 시도합니다).',
  }).catch((e: any) => console.warn('[dm-draw-worker] 경보 발송 실패:', e?.message));
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
