import { create } from 'zustand';
import { clearSnsDrafts } from '../utils/sns-draft';
import { clearAiLineRuns } from '../utils/ai-line';
import { resetDashboardIntro } from '../utils/dashboard-live';
import { clearSessionCompanyData } from '../utils/session-data';

interface User {
  id: string;
  loginId: string;
  name: string;
  email: string;
  userType: 'super_admin' | 'company_admin' | 'company_user';
  hiddenFeatures?: string[];
  company?: {
    id: string;
    name: string;
    code: string;
    // ★ 2026-07-03 사용구분: web(웹발송) / agent(QTmsg 에이전트 전용 — 메뉴 게이팅) / both
    usageType?: 'web' | 'agent' | 'both';
    /** ★ 2026-10-09 시연 회사(화면 띠 전용 · 발송·돈 차단 판정은 서버가 한다) */
    isDemo?: boolean;
  };
}

// ★ 2026-07-03 에이전트 전용 회사 여부 (usage_type='agent' → 카카오&RCS + 발송결과만 허용)
export function isAgentOnlyCompany(user: User | null): boolean {
  return user?.company?.usageType === 'agent';
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
  /** ★ 2026-11-19 C145 — 서버 호출 없이 이 브라우저의 로그인 정보와 이 탭의 메모리 상태(user · token · isAuthenticated)를 지운다(로그인 끝 처리 = utils/session-end 가 부른다) */
  clearLocal: () => void;
  /** ★ 2026-11-19 C145 — 이 브라우저의 다른 창에서 새로 로그인한 것을 이 탭이 따른다(옛 계정 탭 자료를 지우고 공유 저장소의 로그인을 읽는다 · 공유 토큰은 건드리지 않는다) */
  adoptShared: () => void;
  loadFromStorage: () => void;
}

/**
 * 이 탭에만 있는 계정 작업 자료(sessionStorage · 탭 메모리) — 로그인을 지울 때 · 다른 창 로그인을 따를 때 둘 다.
 * ★ 2026-11-19 C145 — 탭 자료와 브라우저가 같이 쓰는 자료를 나눈다(Codex 구현 2R · 따르기가 새 로그인 창의 자료를 지우지 않게)
 */
function clearTabAccountData(): void {
  clearAiLineRuns();   // ★ 2026-10-19 AI 한줄로 진행 · 알림톡 넘기기(같은 탭 다음 계정에 남지 않게 · ai-line.ts)
  resetDashboardIntro();   // ★ 2026-10-19 B-1010-11 같은 탭 재로그인 = 대시보드 들어오기 다시 1회
  clearSessionCompanyData();   // ★ 2026-10-19 B-1018-5③ 임시 글 · 넘기기 문장(다음 계정에 남지 않게 · session-data.ts)
}

/** 이 브라우저가 같이 쓰는 계정 작업 자료(localStorage) — 이 브라우저의 로그인을 지울 때만(다른 창의 새 로그인 자료일 수 있어 따르기에서는 지우지 않는다) */
function clearSharedAccountData(): void {
  // ★ 2026-09-24 SNS 쓰던 글도 지운다(같은 PC 다음 사용자에게 남지 않게 · sns-draft.ts).
  clearSnsDrafts();
}

/** 서버 세션 끊기(await 하지 않는다 · 실패해도 로그아웃은 끝난다) — 로그아웃 단추 · 자동 로그아웃(utils/session-end)이 같이 쓴다 */
export function serverLogout(token: string | null): void {
  if (!token) return;
  try {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      keepalive: true,
    }).catch(() => {});
  } catch { /* 브라우저 밖(시험) */ }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,

  login: (user, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ user, token, isAuthenticated: true });
  },

  logout: () => {
    // ★ 2026-08-18(2) 서버 세션도 끊는다.
    //   종전에는 localStorage만 지워 서버 행이 is_active=true로 남았고, 다시 로그인할 때
    //   접속 인계가 그 유령 세션을 "접속 중"으로 읽어 본인에게 인계 안내를 띄웠다(실사고).
    //   ⚠ await하지 않는다 — 네트워크가 느리거나 실패해도 로그아웃 자체는 즉시 끝나야 한다.
    serverLogout(localStorage.getItem('token'));
    useAuthStore.getState().clearLocal();
  },

  clearLocal: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    clearSharedAccountData();
    clearTabAccountData();
    set({ user: null, token: null, isAuthenticated: false });
  },

  adoptShared: () => {
    // ★ 2026-11-19 C145 — 다른 창의 새 로그인을 따를 때 옛 계정의 탭 자료만 먼저 지운다(Codex 구현 1R) · 브라우저가 같이 쓰는 자료는 새 로그인 것이라 둔다(2R)
    clearTabAccountData();
    useAuthStore.getState().loadFromStorage();
  },

  loadFromStorage: () => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        set({ user, token, isAuthenticated: true });
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
  },
}));
