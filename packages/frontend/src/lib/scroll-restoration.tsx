/**
 * scroll-restoration.tsx — 전역 스크롤 복원 (2026-07-04 Harold 명시: 뒤로가기=복원 / 메뉴=최상단)
 *
 * 배경: 옛 ScrollToTop(App.tsx)이 pathname 변경마다 무조건 window.scrollTo(0,0) →
 *   메뉴 진입은 원하는 대로 top이지만, 하위 모듈에서 뒤로가기 시 보던 위치까지 top으로 날아갔다.
 * 통일: 히스토리 타입으로 구분한다 — PUSH/REPLACE(메뉴·신규 진입)=최상단(6/28 룰 유지),
 *   POP(브라우저 back/forward, navigate(-1))=이전 위치 복원. React Router BrowserRouter(비-데이터 라우터)라
 *   내장 ScrollRestoration을 못 써서 동일 알고리즘을 직접 구현.
 * 뒤로가기 버튼은 goBackOr(navigate, fallback)로 통일 — 앱 내부 히스토리가 있으면 navigate(-1)(=POP=복원),
 *   직접진입(히스토리 없음)이면 fallback 경로로.
 */
import { useEffect } from 'react';
import { useLocation, useNavigationType, type NavigateFunction } from 'react-router-dom';

// 히스토리 엔트리(location.key)별 스크롤 Y — sessionStorage 백업(새로고침에도 유지). 상한 60 엔트리.
const STORE_KEY = 'hj_scroll_positions_v1';
const MAX_ENTRIES = 60;

function loadStore(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}') as Record<string, number>;
  } catch {
    return {};
  }
}
const positions: Record<string, number> = loadStore();

function persist() {
  try {
    const keys = Object.keys(positions);
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete positions[k];
    }
    sessionStorage.setItem(STORE_KEY, JSON.stringify(positions));
  } catch {
    /* quota/private mode 무시 */
  }
}

// ★ 2026-10-01 히스토리 칸(idx)마다 어느 화면(pathname)인가 — goUpTo 가 "바로 앞 칸이 부모인가"를 판정한다.
//   React Router 는 history.state.idx 만 주고 앞 칸 주소는 주지 않는다. sessionStorage 백업(새로고침에도 유지).
const PATHS_KEY = 'hj_hist_paths_v1';
function loadPaths(): Record<string, string> {
  try { return JSON.parse(sessionStorage.getItem(PATHS_KEY) || '{}') as Record<string, string>; } catch { return {}; }
}
const histPaths: Record<string, string> = loadPaths();
function currentIdx(): number {
  const st = window.history.state as { idx?: number } | null;
  return st && typeof st.idx === 'number' ? st.idx : 0;
}
function recordPath(idx: number, pathname: string, navType: string) {
  // 새 칸(PUSH)이면 그 뒤 칸(앞으로 가기 기록)은 사라진 것이다
  if (navType === 'PUSH') for (const k of Object.keys(histPaths)) if (Number(k) > idx) delete histPaths[k];
  histPaths[String(idx)] = pathname;
  try { sessionStorage.setItem(PATHS_KEY, JSON.stringify(histPaths)); } catch { /* quota/private mode 무시 */ }
}

export function ScrollManager() {
  const location = useLocation();
  const navType = useNavigationType(); // 'PUSH' | 'POP' | 'REPLACE'
  const key = location.key;

  useEffect(() => { recordPath(currentIdx(), location.pathname, navType); }, [key, location.pathname, navType]);

  // 현재 엔트리 스크롤 추적 + 이동 직전 최종 저장(cleanup)
  useEffect(() => {
    const onScroll = () => { positions[key] = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      positions[key] = window.scrollY;
      persist();
      window.removeEventListener('scroll', onScroll);
    };
  }, [key]);

  // 진입: POP=복원 / 그 외=최상단
  useEffect(() => {
    if (navType !== 'POP') {
      window.scrollTo(0, 0);
      return;
    }
    const target = positions[key] ?? 0;
    if (target <= 0) { window.scrollTo(0, 0); return; }

    // 비동기 데이터로 페이지가 늦게 자라는 경우 대비 — 목표 도달까지 rAF 재시도(최대 ~1s) + 지연 보정 2회
    let frame = 0;
    let raf = 0;
    const tryRestore = () => {
      window.scrollTo(0, target);
      frame += 1;
      const reached = Math.abs(window.scrollY - target) <= 2;
      const pageTallEnough = document.documentElement.scrollHeight - window.innerHeight >= target;
      if (!reached && !pageTallEnough && frame < 60) {
        raf = requestAnimationFrame(tryRestore);
      }
    };
    raf = requestAnimationFrame(tryRestore);
    const t1 = window.setTimeout(() => window.scrollTo(0, target), 250);
    const t2 = window.setTimeout(() => window.scrollTo(0, target), 600);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}

/**
 * 뒤로가기 버튼 공통 — 앱 내부 히스토리가 있으면 navigate(-1)(POP=스크롤 복원), 없으면 fallback.
 * React Router v6는 history.state.idx로 세션 내 히스토리 인덱스를 관리한다(첫 진입 idx=0).
 * 훅이 아니라 순수 함수라 컴포넌트 상단 선언 없이 onClick에서 바로 호출 가능.
 */
export function goBackOr(navigate: NavigateFunction, fallback: string): void {
  const st = window.history.state as { idx?: number } | null;
  const idx = st && typeof st.idx === 'number' ? st.idx : 0;
  if (idx > 0) navigate(-1);
  else navigate(fallback);
}

/**
 * 부모 화면으로 올라가기 — 메뉴 첫 화면(부모 = AI Operator 허브)의 ← (★ 2026-10-01 · D177 "하위 메뉴 ← = 항상 부모").
 * 바로 앞 칸이 부모면 navigate(-1)(POP = 부모에서 보던 자리 복원), 아니면 부모로 바로 간다.
 * goBackOr 는 "앞 칸"으로 가서, 만들기 → 결과 → 자세히 편집 → 짝 전환처럼 여러 화면을 거쳐 만든 뒤에는
 * 메뉴 첫 화면 ← 가 거쳐 온 화면으로 한 칸씩 되돌아가 두세 번 눌러야 허브에 닿았다(남지현 접수 cmungxd9d 재오픈).
 */
export function goUpTo(navigate: NavigateFunction, parent: string): void {
  const idx = currentIdx();
  const prev = idx > 0 ? histPaths[String(idx - 1)] : undefined;
  const parentPath = parent.split('?')[0];
  if (prev !== undefined && prev === parentPath) navigate(-1);
  else navigate(parent);
}
