import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../utils/dashboard-live';

/**
 * ★ 2026-10-10 대시보드 모션 — 숫자가 처음 들어올 때 한 번만 0에서 올라온다(0.9초).
 *   그 뒤 값이 바뀌면 바로 바꾼다(다시 세지 않는다). animate=false · 움직임 줄이기 = 처음부터 최종값.
 *   animateChanges = 바뀐 값을 옛 값에서 새 값으로 0.6초 이어 센다(명시적으로 켠 숫자만 · 크레딧 잔여).
 *   마지막 칸은 받은 값 그대로 format 에 넘긴다 — 움직임이 끝나면 옛 표기와 글자가 같다.
 */
export default function CountUp({ value, format, decimals = 0, animate = true, animateChanges = false }: {
  value: number;
  format: (v: number) => string;
  /** 도는 동안 반올림 자리(성공률 = 1) */
  decimals?: number;
  animate?: boolean;
  animateChanges?: boolean;
}) {
  const [shown, setShown] = useState(animate ? 0 : value);
  const shownRef = useRef(shown);
  const settled = useRef(!animate);

  useEffect(() => {
    const changing = settled.current && animateChanges && shownRef.current !== value;
    if ((settled.current && !changing) || !(value > 0 || changing) || prefersReducedMotion()) {
      if (value > 0) settled.current = true;
      shownRef.current = value;
      setShown(value);
      return;
    }
    const from = shownRef.current;
    const dur = changing ? 600 : 900;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const v = p >= 1 ? value : from + (value - from) * (1 - Math.pow(1 - p, 3));
      shownRef.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(step);
      else settled.current = true;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, animateChanges]);

  return <>{format(shown === value ? value : Number(shown.toFixed(decimals)))}</>;
}
