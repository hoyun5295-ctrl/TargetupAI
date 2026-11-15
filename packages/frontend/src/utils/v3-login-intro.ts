/**
 * v3-login-intro.ts — 로그인 화면이 「한줄로 V3」 안내 창을 띄울지 묻는다 (★ 2026-11-15 C135 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §2-1)
 *
 * 판정 = 서버 스위치 한 곳(backend utils/v3-login-intro.ts · ENV). 화면은 묻기만 한다.
 * ★ 2026-11-15 (같은 날 고침) — 받은 답을 이 브라우저에 기억해 둔다. 로그인 화면은 **첫 그림부터** 기억한 답으로 창을 띄우고(없으면 종전 인증 안내 창),
 *   서버 답은 기억을 고치는 데 쓴다. 답을 기다렸다가 창을 띄우면 이미 그려진 로그인 화면 위로 창이 뒤늦게 나타난다(배포 직후 접수 · 설계서 §12-5).
 * 못 받거나 늦으면(1.5초) null = 모름(띄워 둔 창을 바꾸지 않는다 · 기억도 그대로).
 */
export const V3_LOGIN_INTRO_WAIT_MS = 1500;

const SEEN_KEY = 'v3LoginIntroOn';

/** 이 브라우저가 지난번에 받은 답 — 첫 그림에 무엇을 띄울지(받은 적 없음 · 저장이 막힘 = 꺼짐 = 종전 인증 안내 창) */
export function rememberedV3LoginIntroOn(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** 서버 답 — true · false = 받은 답(기억해 둔다) · null = 못 받음 · 늦음 */
export async function fetchV3LoginIntroOn(timeoutMs = V3_LOGIN_INTRO_WAIT_MS): Promise<boolean | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/public/intro/v3-login', { signal: ctl.signal });
    if (!r.ok) return null;
    const d = await r.json();
    // 꼴이 맞는 답만 받은 답이다 — on 이 빠졌거나 참 · 거짓이 아닌 응답을 「꺼짐」으로 읽으면 켜 둔 창과 기억이 잘못 바뀐다
    if (d?.success !== true || typeof d.on !== 'boolean') return null;
    const on: boolean = d.on;
    try {
      localStorage.setItem(SEEN_KEY, on ? '1' : '0');
    } catch {
      /* 저장이 막힌 브라우저에서는 다음 방문도 종전 인증 안내 창부터 뜬다 */
    }
    return on;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
