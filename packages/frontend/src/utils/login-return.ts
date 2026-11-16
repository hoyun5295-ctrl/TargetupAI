/**
 * login-return.ts — 로그인 뒤 가려던 화면으로 복귀 (★ 2026-10-04 플래너 보강 · 설계서 §5-4)
 *
 * 문자 링크로 연 휴대폰 확인 화면에서 [이 휴대폰에서 로그인하고 승인]을 누르거나, 로그인 전 보호 경로로 들어오면
 * 가려던 경로를 sessionStorage 키 하나에 남기고(PrivateRoute · 확인 화면) 로그인 성공 분기가 그 키를 읽는다
 * (카페24 복귀 `cafe24_return_mall_id`와 같은 방식의 일반화).
 * ⛔ 허용 경로 목록만 받는다 — 아무 주소나 받으면 로그인 직후 외부·임의 화면으로 보내는 열린 리다이렉트가 된다.
 */
const KEY = 'hj_login_return_path';
const ALLOWED: RegExp[] = [
  /^\/marketing-planner(\?month=\d{4}-\d{2})?$/,
  /^\/marketing-planner\/events\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // ★ 2026-10-28 자사몰 대비 M24 · M30 — 몰 승인이 돌아온 확정 링크 · 아임웹 앱 추가 진입(로그인 뒤 그 연결을 잇는다)
  /^\/oauth-confirm\?provider=(cafe24|imweb)&oauth_confirm=[A-Za-z0-9_-]{20,64}$/,
  /^\/cdp-settings\?connect=imweb&site_code=[A-Za-z0-9_-]{1,64}$/,
  // ★ 2026-11-16 C136 — 메일로 받은 제안 페이지 링크(로그인 뒤 그 페이지로 · src = 링크 식별 값)
  /^\/proposal(\?src=[A-Za-z0-9._-]{1,40})?$/,
];
/** 카페24 앱 실행 랜딩이 남기는 복귀 값(LoginPage 의 로그인 성공 갈래가 읽는다) */
const CAFE24_RETURN_KEY = 'cafe24_return_mall_id';

export function isLoginReturnAllowed(path: string): boolean {
  return ALLOWED.some((re) => re.test(path));
}

/** 허용 경로면 남긴다(아니면 아무 일도 하지 않는다) */
export function rememberLoginReturn(path: string): void {
  try { if (isLoginReturnAllowed(path)) sessionStorage.setItem(KEY, path); } catch { /* 저장 불가 = 복귀 없이 대시보드 */ }
}

/**
 * ★ 2026-11-16 C136(Codex 설계 1R) — 사람이 방금 「로그인」을 눌러 가려는 곳. 복귀 값이 둘이면 가장 최근에 누른 쪽이 이긴다:
 *   같은 탭에 남아 있던 옛 카페24 복귀 값을 지우고 이 경로를 남긴다(안 지우면 로그인 성공 갈래가 카페24 로 먼저 보낸다).
 *   허용 경로가 아니면 아무 일도 하지 않는다(옛 값도 그대로).
 */
export function rememberExplicitLoginReturn(path: string): void {
  if (!isLoginReturnAllowed(path)) return;
  try {
    sessionStorage.removeItem(CAFE24_RETURN_KEY);
    sessionStorage.setItem(KEY, path);
  } catch { /* 저장 불가 = 복귀 없이 대시보드 */ }
}

/** 한 번 꺼내고 지운다 — 허용 경로가 아니면 null */
export function takeLoginReturn(): string | null {
  try {
    const p = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return p && isLoginReturnAllowed(p) ? p : null;
  } catch {
    return null;
  }
}
