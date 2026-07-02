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
