/**
 * surface-flags.ts — 화면 상태를 body 속성으로 알린다 (★ 2026-08-22 신설)
 *
 * 쓰는 곳: 토스트(`data-toast-open`) · 인터럽트 3종(`data-interrupt-open`: ConfirmModal · CreditConfirmModal · CustomerDataRequiredModal).
 * 읽는 곳: 도움말 런처. 토스트가 뜨면 비켜서고, 인터럽트가 뜨면 숨는다(도움말이 차단 창을 덮으면 사고다).
 *
 * 같은 이름을 여러 컴포넌트가 동시에 켤 수 있어 카운터로 센다(하나가 꺼져도 다른 하나가 켜져 있으면 유지).
 */
import { useEffect, useSyncExternalStore } from 'react';

export type SurfaceFlag = 'data-toast-open' | 'data-interrupt-open';

const counts: Record<SurfaceFlag, number> = { 'data-toast-open': 0, 'data-interrupt-open': 0 };
const listeners = new Set<() => void>();

function apply(flag: SurfaceFlag) {
  if (typeof document === 'undefined') return;
  if (counts[flag] > 0) document.body.setAttribute(flag, '1');
  else document.body.removeAttribute(flag);
  listeners.forEach((l) => l());
}

/** on이 true인 동안 body에 속성을 켠다. 조기 return 위에서 호출한다(훅 순서) */
export function useBodyFlag(flag: SurfaceFlag, on: boolean): void {
  useEffect(() => {
    if (!on) return;
    counts[flag] += 1;
    apply(flag);
    return () => {
      counts[flag] = Math.max(0, counts[flag] - 1);
      apply(flag);
    };
  }, [flag, on]);
}

/** 속성이 켜져 있는가를 구독한다 */
export function useSurfaceFlag(flag: SurfaceFlag): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => counts[flag] > 0,
    () => false,
  );
}
