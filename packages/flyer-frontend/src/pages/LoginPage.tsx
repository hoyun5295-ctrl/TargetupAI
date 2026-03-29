import { useState } from 'react';
import { API_BASE } from '../App';
import { Button, Input } from '../components/ui';

interface Props { onLogin: (token: string, user: any) => void; }

export default function LoginPage({ onLogin }: Props) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem('flyer_token', data.token);
        localStorage.setItem('flyer_user', JSON.stringify(data.user));
        onLogin(data.token, data.user);
      } else { setError(data.error || '\ub85c\uadf8\uc778\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.'); }
    } catch { setError('\uc11c\ubc84 \uc5f0\uacb0\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-bg flex">
      {/* 좌측: 브랜드 패널 */}
      <div className="hidden lg:flex w-[480px] bg-gradient-to-br from-brand-600 via-brand-700 to-primary-700 flex-col justify-between p-12 relative overflow-hidden">
        <div className="relative z-10">
          <img src="/logo.png" alt="\ud55c\uc904\ub85c" className="h-8 brightness-0 invert mb-8" />
          <h1 className="text-3xl font-bold text-white leading-snug">
            {'\uc804\ub2e8\uc9c0 \ub9cc\ub4e4\uace0'}<br/>{'\ubc14\ub85c \ubc1c\uc1a1\ud558\uc138\uc694'}
          </h1>
          <p className="text-white/70 mt-4 text-sm leading-relaxed">
            {'\uc0c1\ud488 \uc785\ub825\ub9cc \ud558\uba74 \uc804\ub2e8\uc9c0 \uc790\ub3d9 \uc0dd\uc131'}<br/>
            {'\ub2e8\ucd95URL + SMS \ubc1c\uc1a1\uae4c\uc9c0 \ud55c\ubc88\uc5d0'}
          </p>
        </div>
        <div className="relative z-10">
          <p className="text-white/30 text-xs">hanjul-flyer.com</p>
        </div>
        {/* 배경 장식 */}
        <div className="absolute top-[-60px] right-[-60px] w-[200px] h-[200px] bg-white/5 rounded-full" />
        <div className="absolute bottom-[-40px] left-[-40px] w-[160px] h-[160px] bg-white/5 rounded-full" />
        <div className="absolute top-1/2 right-[-20px] w-[100px] h-[100px] bg-white/5 rounded-full" />
      </div>

      {/* 우측: 로그인 폼 */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          {/* 모바일 로고 */}
          <div className="lg:hidden text-center mb-8">
            <img src="/logo.png" alt="\ud55c\uc904\ub85c" className="h-8 mx-auto mb-3" />
          </div>

          <h2 className="text-xl font-bold text-text mb-1">{'\ub85c\uadf8\uc778'}</h2>
          <p className="text-sm text-text-secondary mb-8">{'\uc804\ub2e8AI \uacc4\uc815\uc73c\ub85c \ub85c\uadf8\uc778\ud558\uc138\uc694'}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label={'\uc544\uc774\ub514'} type="text" value={loginId} onChange={e => setLoginId(e.target.value)} placeholder={'\uc544\uc774\ub514\ub97c \uc785\ub825\ud558\uc138\uc694'} autoFocus />
            <Input label={'\ube44\ubc00\ubc88\ud638'} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={'\ube44\ubc00\ubc88\ud638\ub97c \uc785\ub825\ud558\uc138\uc694'} />

            {error && (
              <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2">
                <p className="text-sm text-error-600">{error}</p>
              </div>
            )}

            <Button size="lg" className="w-full" disabled={loading || !loginId || !password}>
              {loading ? '\ub85c\uadf8\uc778 \uc911...' : '\ub85c\uadf8\uc778'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
