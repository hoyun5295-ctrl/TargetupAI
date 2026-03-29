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
      } else { setError(data.error || '로그인에 실패했습니다.'); }
    } catch { setError('서버 연결에 실패했습니다.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-bg flex">
      {/* 좌측: 브랜드 패널 */}
      <div className="hidden lg:flex w-[480px] bg-gradient-to-br from-brand-600 via-brand-700 to-primary-700 flex-col justify-between p-12 relative overflow-hidden">
        <div className="relative z-10">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center mb-8">
            <span className="text-white text-lg font-black">F</span>
          </div>
          <h1 className="text-3xl font-bold text-white leading-snug">
            전단지 만들고<br/>바로 발송하세요
          </h1>
          <p className="text-white/70 mt-4 text-sm leading-relaxed">
            상품 입력만 하면 전단지 자동 생성<br/>
            단축URL + SMS 발송까지 한번에
          </p>
        </div>
        <p className="text-white/40 text-xs relative z-10">hanjul-flyer.com</p>
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
            <div className="w-12 h-12 bg-gradient-to-br from-brand-500 to-brand-700 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <span className="text-white text-xl font-black">F</span>
            </div>
          </div>

          <h2 className="text-xl font-bold text-text mb-1">로그인</h2>
          <p className="text-sm text-text-secondary mb-8">전단AI 계정으로 로그인하세요</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label="아이디" type="text" value={loginId} onChange={e => setLoginId(e.target.value)} placeholder="아이디를 입력하세요" autoFocus />
            <Input label="비밀번호" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호를 입력하세요" />

            {error && (
              <div className="bg-error-50 border border-error-500/20 rounded-lg px-3 py-2">
                <p className="text-sm text-error-600">{error}</p>
              </div>
            )}

            <Button size="lg" className="w-full" disabled={loading || !loginId || !password}>
              {loading ? '로그인 중...' : '로그인'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
