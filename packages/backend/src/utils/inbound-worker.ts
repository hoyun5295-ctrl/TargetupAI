/**
 * inbound-worker.ts — 답장 상담 워커 (★ 2026-11-14 C133 F5 · 설계서 §7 · §18 「배포 D」 정한 것 12)
 *
 * 1분마다 한 바퀴(utils/inbound-sms runInboundPass): ① 자동 답장 시간이 열렸으면 야간 대기를 되돌린다 ② 받은 글 판정 ③ 답장 행 보내기.
 *   쥐기 · 판정 · 대조 · 발송 · 상태는 전부 그 CT 가 한다(여기는 주기만).
 * 표가 없으면(DDL 전) 로그 한 줄만 남기고 아무것도 하지 않는다.
 */
import { runInboundPass } from './inbound-sms';

const LOG = '[inbound-worker]';
const TICK_MS = 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let running = false;
let warnedMissing = false;

async function inboundWorkerTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const out = await runInboundPass();
    if (out.reopened + out.decided + out.sent > 0) console.log(`${LOG} 야간 대기 풀림 ${out.reopened} · 판정 ${out.decided} · 보냄 ${out.sent}`);
  } catch (e: any) {
    if (e?.code === '42P01') {
      if (!warnedMissing) { warnedMissing = true; console.warn(`${LOG} inbound_messages 표가 없습니다 — DDL(C133-DDL-7) 실행 전에는 아무것도 하지 않습니다`); }
    } else {
      console.error(`${LOG} 실패:`, e?.message || e);
    }
  } finally {
    running = false;
  }
}

export function startInboundWorker(): void {
  if (process.env.VITEST) return;
  if (timer) return;
  timer = setInterval(() => { void inboundWorkerTick(); }, TICK_MS);
  console.log(`${LOG} 시작 — 1분마다 · 받은 글 판정 · 답장 보내기 · 야간 대기 풀기`);
}

export function stopInboundWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
