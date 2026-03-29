import { useState, useEffect } from 'react';
import './index.css';
import LoginPage from './pages/LoginPage';
import FlyerPage from './pages/FlyerPage';
import SendPage from './pages/SendPage';
import ResultsPage from './pages/ResultsPage';
import BalancePage from './pages/BalancePage';
import UnsubscribesPage from './pages/UnsubscribesPage';
import SettingsPage from './pages/SettingsPage';

export const API_BASE = import.meta.env.VITE_API_URL || '';
export function getToken(): string { return localStorage.getItem('flyer_token') || ''; }
export type Page = 'flyer' | 'send' | 'results' | 'balance' | 'unsubscribes' | 'settings';

const MAIN_MENUS: { key: Page; label: string; icon: string }[] = [
  { key: 'flyer', label: '전단제작', icon: '📄' },
  { key: 'send', label: '발송', icon: '📨' },
  { key: 'results', label: '결과', icon: '📊' },
  { key: 'balance', label: '충전관리', icon: '💳' },
];

const SUB_MENUS: { key: Page; label: string }[] = [
  { key: 'unsubscribes', label: '수신거부' },
  { key: 'settings', label: '설정' },
];

function App() {
  const [token, setToken] = useState<string>(getToken());
  const [user, setUser] = useState<any>(() => {
    const saved = localStorage.getItem('flyer_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [currentPage, setCurrentPage] = useState<Page>('flyer');

  const handleLogin = (t: string, u: any) => { setToken(t); setUser(u); };
  const handleLogout = () => {
    localStorage.removeItem('flyer_token');
    localStorage.removeItem('flyer_user');
    setToken(''); setUser(null); setCurrentPage('flyer');
  };

  useEffect(() => {
    const handler = () => handleLogout();
    window.addEventListener('flyer-auth-expired', handler);
    return () => window.removeEventListener('flyer-auth-expired', handler);
  }, []);

  if (!token || !user) return <LoginPage onLogin={handleLogin} />;

  return (
    <div className="min-h-screen bg-bg">
      {/* ── 헤더 ── */}
      <header className="bg-surface border-b border-border sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-14">
          {/* 좌측: 로고 + 메인 메뉴 */}
          <div className="flex items-center gap-1">
            <button onClick={() => setCurrentPage('flyer')} className="flex items-center gap-2 mr-6 group">
              <div className="w-7 h-7 bg-gradient-to-br from-brand-500 to-brand-700 rounded-lg flex items-center justify-center">
                <span className="text-white text-xs font-black">F</span>
              </div>
              <span className="text-sm font-bold text-text group-hover:text-brand-600 transition-colors">전단AI</span>
            </button>

            <nav className="flex">
              {MAIN_MENUS.map(m => (
                <button key={m.key} onClick={() => setCurrentPage(m.key)}
                  className={`px-4 h-14 text-[13px] font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
                    currentPage === m.key
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-text-secondary hover:text-text hover:border-border-strong'
                  }`}
                >
                  <span className="text-sm">{m.icon}</span>
                  {m.label}
                </button>
              ))}
            </nav>
          </div>

          {/* 우측: 부가 메뉴 + 사용자 */}
          <div className="flex items-center gap-1">
            {SUB_MENUS.map(m => (
              <button key={m.key} onClick={() => setCurrentPage(m.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  currentPage === m.key ? 'bg-primary-50 text-primary-600' : 'text-text-muted hover:text-text-secondary hover:bg-bg'
                }`}
              >{m.label}</button>
            ))}
            <div className="ml-3 pl-3 border-l border-border flex items-center gap-2">
              <div className="w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center">
                <span className="text-[10px] font-bold text-primary-600">{(user.loginId || '?')[0].toUpperCase()}</span>
              </div>
              <span className="text-xs text-text-secondary">{user.loginId}</span>
              <button onClick={handleLogout} className="text-xs text-text-muted hover:text-error-500 transition-colors ml-1">로그아웃</button>
            </div>
          </div>
        </div>
      </header>

      {/* ── 페이지 ── */}
      <main className="max-w-6xl mx-auto px-6 py-6">
        {currentPage === 'flyer' && <FlyerPage token={token} />}
        {currentPage === 'send' && <SendPage token={token} />}
        {currentPage === 'results' && <ResultsPage token={token} />}
        {currentPage === 'balance' && <BalancePage token={token} />}
        {currentPage === 'unsubscribes' && <UnsubscribesPage token={token} />}
        {currentPage === 'settings' && <SettingsPage token={token} />}
      </main>
    </div>
  );
}

export default App;
