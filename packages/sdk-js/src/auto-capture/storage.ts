/**
 * anonymous_id (영구) + session_id (30분 TTL) 발급 + localStorage/sessionStorage 영역 보존.
 * §12 #6 — ID 병합 전체 보존 흐름.
 */

const ANON_KEY = 'hjl_anon_id';
const SESS_KEY = 'hjl_session_id';
const SESS_TTL_MS = 30 * 60 * 1000;

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getAnonymousId(): string {
  let id = localStorage.getItem(ANON_KEY);
  if (!id) {
    id = `anon_${generateUUID()}`;
    localStorage.setItem(ANON_KEY, id);
  }
  return id;
}

export function getSessionId(): string {
  const raw = sessionStorage.getItem(SESS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { id: string; expires: number };
      if (parsed.expires > Date.now()) {
        return parsed.id;
      }
    } catch {
      // 파싱 실패 = 신규 발급 흐름
    }
  }
  const id = `sess_${generateUUID()}`;
  const expires = Date.now() + SESS_TTL_MS;
  sessionStorage.setItem(SESS_KEY, JSON.stringify({ id, expires }));
  return id;
}

export function clearSession(): void {
  sessionStorage.removeItem(SESS_KEY);
}
