/**
 * 공개 페이지 방문 기록 훅(★ 2026-11-19 C145 · 설계서 docs/2026-11-19-c145-public-session-visits-design.md §3-3)
 *
 * 페이지를 열 때 방문 하나를 등록하고, 화면이 실제로 보이는 동안의 시간만 쌓아 30초마다 · 숨겨질 때 · 떠날 때 보낸다.
 * 저장 · 상한 판정은 서버 CT(backend utils/public-visits.ts)가 한다. 실패는 전부 삼킨다 — 기록이 페이지를 막으면 안 된다.
 * 등록된 페이지만(서버 PUBLIC_VISIT_PAGES · 계약 K7 이 그 페이지 화면이 이 훅을 부르는지 본다).
 */
import { useEffect, useMemo } from 'react';

export type PublicVisitPage = 'jbn';

const BROWSER_KEY = 'hanjul.visitor';
const BEAT_MS = 30_000;
const MAX_BEAT_SECONDS = 60;

const uuid = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* 아래로 */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

/** 같은 브라우저 열쇠(없으면 만든다 · 저장을 못 쓰면 방문마다 새 값) */
function browserKeyOf(fallback: string): string {
  try {
    const v = localStorage.getItem(BROWSER_KEY);
    if (v && /^[0-9a-f-]{36}$/i.test(v)) return v;
    localStorage.setItem(BROWSER_KEY, fallback);
    return fallback;
  } catch {
    return fallback;
  }
}

function send(path: 'start' | 'beat', body: Record<string, unknown>, withToken = false): void {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (withToken) {
      const token = localStorage.getItem('token');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    fetch(`/api/public/visits/${path}`, { method: 'POST', headers, body: JSON.stringify(body), keepalive: true }).catch(() => {});
  } catch { /* 기록 실패는 화면에 영향 없음 */ }
}

export function usePublicVisit(page: PublicVisitPage): { visitId: string; browserKey: string } {
  const ids = useMemo(() => {
    const visitId = uuid();
    return { visitId, browserKey: browserKeyOf(visitId) };
  }, []);

  useEffect(() => {
    const { visitId, browserKey } = ids;
    const base = { id: visitId, page, browserKey };
    let src: string | null = null;
    let referrerHost: string | null = null;
    try {
      src = new URLSearchParams(window.location.search).get('src');
      const ref = document.referrer ? new URL(document.referrer) : null;
      referrerHost = ref && ref.host !== window.location.host ? ref.hostname : null;
    } catch { /* 값 없이 */ }
    send('start', { ...base, src, referrerHost }, true);

    // 보이는 동안만 센다
    let visibleSince: number | null = document.visibilityState === 'visible' ? Date.now() : null;
    let pendingMs = 0;
    const take = (): number => {
      if (visibleSince !== null) {
        const now = Date.now();
        pendingMs += now - visibleSince;
        visibleSince = now;
      }
      const s = Math.min(MAX_BEAT_SECONDS, Math.floor(pendingMs / 1000));
      pendingMs -= s * 1000;
      return s;
    };
    const flush = () => {
      const seconds = take();
      if (seconds > 0) send('beat', { ...base, seconds });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        visibleSince = Date.now();
      } else {
        flush();
        visibleSince = null;
      }
    };
    const timer = window.setInterval(flush, BEAT_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      flush();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [ids, page]);

  return ids;
}
