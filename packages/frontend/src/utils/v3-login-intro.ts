/**
 * v3-login-intro.ts — 로그인 화면이 「한줄로 V3」 안내 창을 띄울지 묻는다 (★ 2026-11-15 C135 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §2-1)
 *
 * 판정 = 서버 스위치 한 곳(backend utils/v3-login-intro.ts · ENV). 화면은 묻기만 한다.
 * 못 받거나 늦으면(1.5초) false = 종전 인증 안내 창(모르면 새 창을 띄우지 않는다).
 */
export const V3_LOGIN_INTRO_WAIT_MS = 1500;

export async function fetchV3LoginIntroOn(timeoutMs = V3_LOGIN_INTRO_WAIT_MS): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/public/intro/v3-login', { signal: ctl.signal });
    if (!r.ok) return false;
    const d = await r.json();
    return d?.success === true && d.on === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
