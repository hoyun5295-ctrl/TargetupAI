/**
 * 공개 경로 판정 — 로그인 없이 여는 화면(★ 2026-11-19 C145 · 설계서 docs/2026-11-19-c145-public-session-visits-design.md §2-1 · 뿌리 R99)
 *
 * 로그인 끝 처리(utils/session-end) · 로그인 사용자용 전역 부품(도움말 봇 · 보안 공지 카드 · 곧 로그아웃 창 · 시연 회사 띠)이
 * 「지금 공개 경로인가」를 묻는 유일한 자리다. 공개 경로에서는 로그인이 끊겨도 그 화면을 떠나지 않고 로그인 정보만 지운다.
 *
 * ⛔ 목록 = App.tsx 의 `PrivateRoute` 없는 `<Route path=` 줄 글자 그대로(이동만 하는 `/` · `*` 제외).
 *    계약 K1(backend utils/__tests__/c145-session-visits.test.ts)이 App.tsx 에서 뽑아 양쪽으로 맞춘다 — 공개 라우트를 새로 만들면 여기에도.
 */
export const PUBLIC_PATHS = [
  '/login',
  '/pricing',
  '/privacy',
  '/terms',
  '/cafe24/launch',
  '/payment/result',
  '/manager-board',
  '/journey-pause',
  '/journey-pause/:token',
  '/diagnosis',
  '/intro',
  '/jbn',
  '/proposal',
  '/agency-approve',
  '/charge-approve',
  '/planner-confirm',
  '/planner-recheck',
  '/autosend-stop',
] as const;

const SPLIT = PUBLIC_PATHS.map((p) => p.split('/'));

/** 경로 비교 = 끝 슬래시를 뗀 조각 비교 · `:이름` 조각은 빈 값이 아닌 아무 조각 */
export function isPublicPath(pathname: string): boolean {
  const p = String(pathname || '/').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  const parts = p.split('/');
  return SPLIT.some((pat) => pat.length === parts.length && pat.every((seg, i) => (seg.startsWith(':') ? parts[i] !== '' : seg === parts[i])));
}

/** 지금 화면의 경로(브라우저 밖 = 시험에서는 로그인 필요 경로로 본다) */
export function currentPathIsPublic(): boolean {
  return typeof window !== 'undefined' && isPublicPath(window.location.pathname);
}
