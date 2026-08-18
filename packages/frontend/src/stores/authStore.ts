import { create } from 'zustand';

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
  loadFromStorage: () => void;
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
    const token = localStorage.getItem('token');
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {});
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    set({ user: null, token: null, isAuthenticated: false });
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
