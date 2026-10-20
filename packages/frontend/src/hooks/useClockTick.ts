import { useEffect, useState } from 'react';

/**
 * 시간 경계로 바뀌는 화면을 주기적으로 다시 그린다(★ 2026-10-19 보낼 시각 15분 전 잠금 · 열어 둔 화면이 경계를 넘으면 버튼을 다시 판정).
 * 반환 = 지금 시각(ms). 판정 함수에 넘겨 같은 시각으로 계산한다. 서버가 최종 판정이라 경계 오차는 이 주기 안이다.
 */
export function useClockTick(intervalMs = 15_000, boundaryAt: number | null = null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  // ★ 2026-10-20 경계 시각(예: 보낼 시각 15분 전)에 정확히 다시 그린다 — 주기 사이(최대 15초)에 닫힌 버튼을 누를 틈을 없앤다(Harold).
  //   +50ms = 경계를 확실히 넘긴 시각으로 판정(잠금 판정은 「15분 미만」이라 경계 그 순간은 아직 열림).
  useEffect(() => {
    if (boundaryAt === null || !Number.isFinite(boundaryAt)) return;
    const wait = boundaryAt - Date.now();
    if (wait <= 0 || wait > 2_000_000_000) return;
    const t = setTimeout(() => setNow(Date.now()), wait + 50);
    return () => clearTimeout(t);
  }, [boundaryAt]);
  return now;
}
