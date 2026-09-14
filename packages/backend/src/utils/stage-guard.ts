/**
 * stage-guard.ts — 주기 워커 단계 겹침 가드(★2026-09-13(3) · B-0825-7)
 *
 * 같은 이름의 단계가 이 프로세스에서 돌고 있으면 새로 시작하지 않고, 건너뛴 요청이 있었으면 앞 실행이 끝난 직후
 * **한 번 더** 돈다(주기가 밀려 다음 tick까지 5분이 비지 않게).
 * ⛔ 프로세스 안 가드다. 여러 프로세스는 막지 않는다(운영 단일 fork · ecosystem.config.js instances 1).
 * ⛔ 오래 걸린다고 가드를 풀지 마라. 풀면 가장 느린 순간에 겹침이 되살아난다(부르는 쪽이 알리기만 한다).
 * 순수 유틸이라 설정·DB를 import하지 않는다.
 */
export interface StageGuard {
  /** 돌았으면 true, 이미 돌고 있어 건너뛰었으면 false(끝난 뒤 한 번 이어 돈다) */
  run(name: string, fn: () => Promise<void>): Promise<boolean>;
  /** 돌고 있으면 경과 ms, 아니면 null */
  runningForMs(name: string, now?: number): number | null;
}

export function createStageGuard(onSkip?: (name: string, runningForMs: number) => void): StageGuard {
  const startedAt = new Map<string, number>();
  const pending = new Set<string>();
  return {
    async run(name, fn) {
      const since = startedAt.get(name);
      // 대기 전에 동기로 판정·표시한다(같은 마이크로태스크에서 두 번 불려도 한쪽만 돈다)
      if (since !== undefined) {
        pending.add(name);
        onSkip?.(name, Date.now() - since);
        return false;
      }
      startedAt.set(name, Date.now());
      try {
        do {
          pending.delete(name);
          await fn();
        } while (pending.has(name));
      } finally {
        startedAt.delete(name);
        // 던졌으면 이어 돌기는 버린다(다음 tick이 다시 한다)
        pending.delete(name);
      }
      return true;
    },
    runningForMs(name, now = Date.now()) {
      const s = startedAt.get(name);
      return s === undefined ? null : now - s;
    },
  };
}
