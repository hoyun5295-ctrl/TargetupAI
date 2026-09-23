/**
 * ★ 2026-09-23 AI 영업 — 프로세스 안 단일 자리 대기열 CT (설계 = docs/2026-09-23-outreach-direct-send-design.md §8 · 불변 51)
 *
 * 렌더 워커(동시 1건 · 겹치면 409)와 이미지 제작(rembg 단일 워커)은 한 번에 하나만 받는다. 예전에는 겹친 요청이
 * 409·예외로 즉시 떨어지고 호출부가 정적 결과로 조용히 넘어가 재료·채점이 빠졌다(일괄 체인 크롤 × 앞 건 제작 캡처).
 * 이 대기열은 겹친 요청을 **도착 순서대로 기다리게** 하고, 대기 상한을 넘은 것만 실패로 돌려준다(옛 실패 계약 그대로).
 *
 * - 자리를 넘길 때 busy 를 풀지 않고 다음 대기자에게 바로 준다(사이에 새 요청이 끼어들지 않는다 · FIFO).
 * - 대기 상한 초과 = 대기열에서 빠지고 { ok:false }. fn 은 실행하지 않는다.
 * - fn 의 예외는 그대로 던진다(자리는 finally 에서 반납).
 * - 단일 프로세스(fork 모드) 전제다. 다중 프로세스는 워커의 409 가 여전히 최종 방어다.
 */

export type SlotRun<T> = { ok: true; value: T } | { ok: false; reason: 'wait_timeout' };

export interface SlotQueue {
  run<T>(fn: () => Promise<T>, maxWaitMs: number): Promise<SlotRun<T>>;
  /** 지금 자리가 차 있는가(관측용) */
  readonly busy: boolean;
  /** 기다리는 수(관측용) */
  readonly waiting: number;
}

export function createSlotQueue(): SlotQueue {
  let busy = false;
  const waiters: Array<{ grant: () => void; timer: ReturnType<typeof setTimeout> }> = [];

  const release = () => {
    const next = waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      next.grant(); // busy 는 true 로 둔 채 넘긴다
    } else {
      busy = false;
    }
  };

  return {
    get busy() { return busy; },
    get waiting() { return waiters.length; },
    async run<T>(fn: () => Promise<T>, maxWaitMs: number): Promise<SlotRun<T>> {
      if (busy) {
        const granted = await new Promise<boolean>((resolve) => {
          const w = {
            grant: () => resolve(true),
            timer: setTimeout(() => {
              const i = waiters.indexOf(w);
              if (i >= 0) waiters.splice(i, 1);
              resolve(false);
            }, Math.max(0, maxWaitMs)),
          };
          waiters.push(w);
        });
        if (!granted) return { ok: false, reason: 'wait_timeout' };
      } else {
        busy = true;
      }
      try {
        return { ok: true, value: await fn() };
      } finally {
        release();
      }
    },
  };
}
