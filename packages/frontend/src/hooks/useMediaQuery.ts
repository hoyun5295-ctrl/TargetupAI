/**
 * useMediaQuery — CSS 미디어 쿼리가 지금 맞는지(창 크기가 바뀌면 따라간다).
 *
 * ★ 2026-09-19 블록 조립 화면(임은지 접수 cmu51q01u05tujnluc32zp8ej) — 넓은 화면에서만 블록 창을 오른쪽 열에 붙이고
 *   좁은 화면은 모달을 쓴다. Tailwind 분기(lg: 등)와 **같은 기준**을 JS에서 읽어야 할 때 이 훅을 쓴다.
 *   컴포넌트마다 window.matchMedia 를 인라인으로 두지 않는다.
 * matchMedia 가 없는 환경(구형·테스트)은 false.
 */
import { useEffect, useState } from 'react';

function currentMatch(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => currentMatch(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
