/**
 * surface-flags.ts — 화면 상태를 body 속성으로 알린다 (★ 2026-08-22 신설)
 *
 * 쓰는 곳: 인터럽트 3종(`data-interrupt-open`: ConfirmModal · CreditConfirmModal · CustomerDataRequiredModal).
 * 읽는 곳: 도움말 런처. 인터럽트가 뜨면 숨는다(도움말이 차단 창을 덮으면 사고다).
 *
 * ★ 2026-08-22(2) `data-toast-open` 폐기. 공용 알림은 우측 **상단**이라(`ToastProvider`) 우하단 런처와 겹치지
 *   않는데도 런처가 위로 비켜서고 있었다. 겹치는 쪽은 화면이 제 우하단에 따로 만든 알림이고, 그것은 그 화면을
 *   공용 알림으로 되돌려 없앤다. 자리를 피하는 장치를 남기면 다음 사람이 "겹치면 비켜선다"고 잘못 믿는다.
 *
 * 같은 이름을 여러 컴포넌트가 동시에 켤 수 있어 카운터로 센다(하나가 꺼져도 다른 하나가 켜져 있으면 유지).
 */
import { useEffect, useSyncExternalStore } from 'react';

export type SurfaceFlag = 'data-interrupt-open';

const counts: Record<SurfaceFlag, number> = { 'data-interrupt-open': 0 };
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
