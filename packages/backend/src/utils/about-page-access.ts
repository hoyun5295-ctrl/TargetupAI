/**
 * ★ 2026-10-07 (Harold) 소개 페이지(/about) = 숨김. 고객사 계정 중 허용 목록만 연다 — ABOUT_PAGE_VIEWER_IDS(기본 'hoyun').
 *   경위: 기능 소개가 바깥에 퍼져 경쟁사가 기능을 보고 따라 할 수 있다는 우려(nginx 기록에 고객사 아닌 IP · 페이스북 공유 흔적).
 *   미가입 업체는 AI Operator 안 기능 안내 창(영상 · 설명)으로 충분하다 — 소개 페이지는 대표가 미팅에서 직접 보여 줄 때만.
 *   판정은 서버 — 화면은 이 값으로만 그린다(화면에서 다시 세지 않는다).
 */
export function isAboutPageViewer(user?: { userType?: string; loginId?: string } | null): boolean {
  if (!user?.loginId) return false;
  if (user.userType !== 'company_admin' && user.userType !== 'company_user') return false;
  const ids = String(process.env.ABOUT_PAGE_VIEWER_IDS ?? 'hoyun')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return ids.includes(String(user.loginId).trim().toLowerCase());
}
