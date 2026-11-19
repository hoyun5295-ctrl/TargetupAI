/**
 * 로그인 끝 처리 — 유일한 자리(★ 2026-11-19 C145 · 설계서 docs/2026-11-19-c145-public-session-visits-design.md §2-1 · 뿌리 R99)
 *
 * 읽는 쪽 = API 통로 401(api/client.ts) · 다른 창 로그인 바뀜(hooks/useSessionGuard) · 자동 로그아웃(App.tsx SessionTimeoutGuard).
 * 판정은 순수 함수 decideSessionEnd 하나 — 백엔드 시험(c145-session-visits.test.ts B1)이 이 파일과 authStore 를 직접 불러 행동을 본다.
 *
 * 상태 둘을 나눈다(설계 2R · 3R):
 *   - 브라우저 공유 저장소(localStorage 'token' · API 통로가 읽는 쪽) = **끝난 그 토큰일 때만** 지운다(다른 창의 새 로그인을 지우지 않는다).
 *   - 이 탭의 메모리(authStore) = 끝난 뒤 언제나 공유 저장소를 따른다(다른 로그인이 있으면 따르고 · 없으면 비운다).
 *   - 끝난 토큰 = 요청을 **보낼 때 고정한 값**(실은 토큰 → 없으면 그 순간 탭 토큰) — 닿을 때 읽으면 그 사이 생긴 새 로그인을 끝난 것으로 읽는다.
 * 공개 경로에서는 그 화면을 떠나지 않는다(사유 창 0 · 이동 0).
 * ⛔ localStorage 'token' 을 지우는 곳 = authStore 하나 · forceLogoutReason · hanjul.sessionEnd 를 적는 곳 = 이 파일 하나(계약 K2).
 */
import { useAuthStore, serverLogout } from '../stores/authStore';
import { isPublicPath } from './public-paths';

/** 끊긴 원인을 같은 브라우저의 다른 탭과 나누는 자리 */
export const SESSION_END_SHARED_KEY = 'hanjul.sessionEnd';
/** 나눈 원인을 쓰는 기한 */
export const SESSION_END_SHARED_TTL_MS = 10 * 60 * 1000;
/** 이 브라우저의 다른 창에서 새로 로그인했을 때(다른 계정일 수 있어 「같은 계정」이라 말하지 않는다) */
export const OTHER_WINDOW_LOGIN_MESSAGE = '이 브라우저의 다른 창에서 새로 로그인되어 이 화면의 로그인이 끝났습니다.';
/** 서버가 끝났다고 했지만 문구가 없을 때 */
export const SESSION_END_FALLBACK_MESSAGE = '로그인이 끝났습니다. 다시 로그인해 주세요.';
/** 다른 창 새 로그인 안내 창을 띄우라는 신호(App.tsx SessionGuard 가 듣는다) */
export const SESSION_NOTICE_EVENT = 'hanjul:session-notice';

const tail = (t: string | null): string | null => (t ? t.slice(-24) : null);

export interface SharedSessionEnd { t: string; reason: string; at: number }

export interface SessionEndInput {
  /** 지금 화면 경로 */
  path: string;
  /** 끝난 바로 그 로그인(보낼 때 고정한 값 · 이벤트의 옛 값 · 자동 로그아웃 때 탭 토큰) */
  endedToken: string | null;
  /** 지금 공유 저장소의 토큰 */
  sharedToken: string | null;
  /** 지금 이 탭 메모리의 토큰 */
  tabToken: string | null;
  /** 서버가 준 끝 문구(강제 표식이 있을 때만) · 자동 로그아웃 안내 */
  serverReason: string | null;
  /** 다른 탭이 나눈 원인 */
  sharedEnd: SharedSessionEnd | null;
  now: number;
}

export interface SessionEndDecision {
  /** 공유 저장소의 로그인을 지운다 */
  clearShared: boolean;
  /** 이 탭 메모리 = 그대로 · 비움 · 공유 저장소의 다른 로그인을 따름 */
  tab: 'keep' | 'clear' | 'adopt';
  /** 다른 탭과 나눌 원인 */
  recordShared: { t: string; reason: string } | null;
  /** 로그인 화면에서 보여 줄 사유(로그인 필요 경로 · 비움일 때만) */
  reason: string | null;
  /** 로그인 화면으로 · 새로 불러오기(다른 창 새 로그인 안내 뒤) · 이동 없음 */
  navigate: 'login' | 'reload' | null;
}

export function decideSessionEnd(i: SessionEndInput): SessionEndDecision {
  const clearShared = i.endedToken !== null && i.sharedToken === i.endedToken;
  const sharedAfter = clearShared ? null : i.sharedToken;
  const tab: SessionEndDecision['tab'] = sharedAfter && sharedAfter !== i.tabToken ? 'adopt'
    : !sharedAfter && i.tabToken !== null ? 'clear'
      : 'keep';
  const recordShared = i.serverReason && i.endedToken ? { t: tail(i.endedToken)!, reason: i.serverReason } : null;
  if (isPublicPath(i.path)) return { clearShared, tab, recordShared, reason: null, navigate: null };
  if (tab === 'adopt') return { clearShared, tab, recordShared, reason: null, navigate: 'reload' };
  if (tab !== 'clear') return { clearShared, tab, recordShared, reason: null, navigate: null };
  const shared = i.sharedEnd && i.sharedEnd.t === tail(i.endedToken) && i.now - i.sharedEnd.at <= SESSION_END_SHARED_TTL_MS
    ? i.sharedEnd.reason : null;
  return { clearShared, tab, recordShared, reason: i.serverReason || shared, navigate: 'login' };
}

function readSharedEnd(): SharedSessionEnd | null {
  try {
    const v = JSON.parse(localStorage.getItem(SESSION_END_SHARED_KEY) || 'null');
    return v && typeof v.t === 'string' && typeof v.reason === 'string' && typeof v.at === 'number' ? v : null;
  } catch {
    return null;
  }
}

/**
 * 판정대로 지우기 · 따르기 · 이동. 결과를 돌려준다(시험 · 부르는 쪽 기록용).
 * serverAlive = 서버 세션이 아직 살아 있는 끝(자동 로그아웃) — 공유 로그인을 지울 때 서버도 끊는다.
 */
export function endClientSession(opts: { endedToken: string | null; serverReason?: string | null; serverAlive?: boolean }): SessionEndDecision {
  const store = useAuthStore.getState();
  let sharedToken: string | null = null;
  try { sharedToken = localStorage.getItem('token'); } catch { /* 저장소를 못 쓰는 브라우저 */ }
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const d = decideSessionEnd({
    path, endedToken: opts.endedToken, sharedToken, tabToken: store.token,
    serverReason: opts.serverReason ?? null, sharedEnd: readSharedEnd(), now: Date.now(),
  });
  if (d.recordShared) {
    try { localStorage.setItem(SESSION_END_SHARED_KEY, JSON.stringify({ ...d.recordShared, at: Date.now() })); } catch { /* 나누지 못해도 이 탭 처리는 한다 */ }
  }
  if (opts.serverAlive && d.clearShared) serverLogout(opts.endedToken);
  if (d.clearShared || d.tab === 'clear') store.clearLocal();
  else if (d.tab === 'adopt') store.adoptShared();
  if (typeof window === 'undefined') return d;
  if (d.navigate === 'login') {
    if (d.reason) { try { sessionStorage.setItem('forceLogoutReason', d.reason); } catch { /* 사유 없이 이동 */ } }
    window.location.href = '/login';
  } else if (d.navigate === 'reload') {
    window.dispatchEvent(new CustomEvent(SESSION_NOTICE_EVENT, { detail: { message: OTHER_WINDOW_LOGIN_MESSAGE } }));
  }
  return d;
}

/** 다른 탭이 나눈 원인이 이 탭 토큰의 것인가(다른 창에서 토큰이 지워졌을 때 · 로그인 필요 경로) */
export function sharedEndFor(token: string | null, now: number = Date.now()): SharedSessionEnd | null {
  const v = readSharedEnd();
  return v && token && v.t === tail(token) && now - v.at <= SESSION_END_SHARED_TTL_MS ? v : null;
}
