import { useEffect, useState } from 'react';

/**
 * 시간 경계로 바뀌는 화면을 주기적으로 다시 그린다(★ 2026-10-19 보낼 시각 15분 전 잠금 · 열어 둔 화면이 경계를 넘으면 버튼을 다시 판정).
 * 반환 = 지금 시각(ms). 판정 함수에 넘겨 같은 시각으로 계산한다. 서버가 최종 판정이라 경계 오차는 이 주기 안이다.
 */
export function useClockTick(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
