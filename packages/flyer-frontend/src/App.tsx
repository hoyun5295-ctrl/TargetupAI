import { useState, useEffect } from 'react';
import './index.css';
import LoginPage from './pages/LoginPage';
import FlyerPage from './pages/FlyerPage';
import SendPage from './pages/SendPage';
import ResultsPage from './pages/ResultsPage';
import BalancePage from './pages/BalancePage';
import UnsubscribesPage from './pages/UnsubscribesPage';
import SettingsPage from './pages/SettingsPage';

// ── API 베이스 URL ──
export const API_BASE = import.meta.env.VITE_API_URL || '';

export function getToken(): string {
  return localStorage.getItem('flyer_token') || '';
}

export type Page = 'flyer' | 'send' | 'results' | 'balance' | 'unsubscribes' | 'settings';

function App() {
  const [token, setToken] = useState<string>(getToken());
  const [user, setUser] = useState<any>(() => {
    const saved = localStorage.getItem('flyer_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [currentPage, setCurrentPage] = useState<Page>('flyer');

  const handleLogin = (t: string, u: any) => {
    setToken(t);
    setUser(u);
  };

  const handleLogout = () => {
    localStorage.removeItem('flyer_token');
    localStorage.removeItem('flyer_user');
    setToken('');
    setUser(null);
    setCurrentPage('flyer');
  };

  // 401 응답 시 자동 로그아웃
  useEffect(() => {
    const handler = () => handleLogout();
    window.addEventListener('flyer-auth-expired', handler);
    return () => window.removeEventListener('flyer-auth-expired', handler);
  }, []);

  if (!token || !user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const mainMenus: { key: Page; label: string }[] = [
    { key: 'flyer', label: '전단제작' },
    { key: 'send', label: '발송' },
    { key: 'results', label: '결과' },
    { key: 'balance', label: '충전관리' },
  ];

  const subMenus: { key: Page; label: string }[] = [
    { key: 'unsubscribes', label: '수신거부' },
    { key: 'settings', label: '설정' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-0 flex items-center justify-between">
          {/* 좌측: 로고 + 메인 메뉴 */}
          <div className="flex items-center gap-8">
            <div className="py-4 cursor-pointer" onClick={() => setCurrentPage('flyer')}>
              <h1 className="text-lg font-bold text-gray-800">전단AI</h1>
            </div>
            <nav className="flex">
              {mainMenus.map(m => (
                <button
                  key={m.key}
                  onClick={() => setCurrentPage(m.key)}
                  className={`px-4 py-4 text-sm font-medium border-b-2 transition-colors ${
                    currentPage === m.key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </nav>
          </div>

          {/* 우측: 부가 메뉴 + 사용자 정보 */}
          <div className="flex items-center gap-4">
            {subMenus.map(m => (
              <button
                key={m.key}
                onClick={() => setCurrentPage(m.key)}
                className={`text-xs transition-colors ${
                  currentPage === m.key ? 'text-blue-600 font-medium' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {m.label}
              </button>
            ))}
            <div className="border-l border-gray-200 pl-4 flex items-center gap-3">
              <span className="text-xs text-gray-500">{user.loginId}</span>
              <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-gray-600">로그아웃</button>
            </div>
          </div>
        </div>
      </header>

      {/* 페이지 콘텐츠 */}
      <main className="max-w-6xl mx-auto px-4 py-6">
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
