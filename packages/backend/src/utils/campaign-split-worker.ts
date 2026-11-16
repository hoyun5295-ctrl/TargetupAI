/**
 * campaign-split-worker.ts — 나눠 보내기 워커 (★ 2026-11-14 C133 F4 · 설계서 §6-2 · §18 「배포 C-3」 정한 것 12)
 *
 * 1분마다 때가 된 나눠 보내기를 집어 **시작 요청과 같은 함수**(campaign-split advanceSplit)를 부른다.
 *   집는 행 = 시험 묶음이 남은 것(시작 요청이 끝내지 못한 것) · 판정 시각이 된 것 · 판정 중인 것.
 *   쥐기 · 대조 · 발송 · 상태는 전부 그 함수가 한다(여기는 순서만). 살아 있는 실행이 쥔 행은 그 함수가 건너뛴다.
 * 표가 없으면(DDL 전) 로그 한 줄만 남기고 아무것도 하지 않는다.
 */
import { query } from '../config/database';
import { advanceSplit, SPLIT_DUE_SQL } from './campaign-split';

const LOG = '[campaign-split-worker]';
const TICK_MS = 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let running = false;
let warnedMissing = false;

/** 한 번 돈다 → 상태가 나아간 행 수 */
export async function runCampaignSplitPass(): Promise<number> {
  let rows: Array<{ id: string }>;
  try {
    rows = (await query(SPLIT_DUE_SQL)).rows;
  } catch (e: any) {
    if (e?.code === '42P01') {
      if (!warnedMissing) { warnedMissing = true; console.warn(`${LOG} campaign_split_tests 표가 없습니다 — DDL(C133-DDL-6) 실행 전에는 아무것도 하지 않습니다`); }
      return 0;
    }
    throw e;
  }
  let moved = 0;
  for (const r of rows) {
    try {
      const out = await advanceSplit(String(r.id));
      if (out !== 'held' && out !== 'waiting' && out !== 'none') moved += 1;
      if (out === 'blocked' || out === 'done' || out === 'cancelled') console.log(`${LOG} split=${r.id} → ${out}`);
    } catch (e: any) {
      console.error(`${LOG} 실행 실패 split=${r.id}:`, e?.message || e);
    }
  }
  return moved;
}

async function campaignSplitTick(): Promise<void> {
  if (running) return;
  running = true;
  try { await runCampaignSplitPass(); } catch (e: any) { console.error(`${LOG} 실패:`, e?.message || e); } finally { running = false; }
}

export function startCampaignSplitWorker(): void {
  if (process.env.VITEST) return;
  if (timer) return;
  timer = setInterval(() => { void campaignSplitTick(); }, TICK_MS);
  console.log(`${LOG} 시작 — 1분마다 · 시험 묶음이 남은 것 · 판정 시각이 된 것 · 판정 중인 것`);
}

export function stopCampaignSplitWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
