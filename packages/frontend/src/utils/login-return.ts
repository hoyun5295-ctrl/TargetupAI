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
];

export function isLoginReturnAllowed(path: string): boolean {
  return ALLOWED.some((re) => re.test(path));
}

/** 허용 경로면 남긴다(아니면 아무 일도 하지 않는다) */
export function rememberLoginReturn(path: string): void {
  try { if (isLoginReturnAllowed(path)) sessionStorage.setItem(KEY, path); } catch { /* 저장 불가 = 복귀 없이 대시보드 */ }
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
