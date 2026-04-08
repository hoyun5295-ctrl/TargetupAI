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
      // ★ D111 P0: appSource='flyer' — 전단AI는 한줄로(hanjul)와 별개 세션으로 공존 허용
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password, appSource: 'flyer' }),
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
          <img src="/logo.png" alt="한줄로" className="h-8 brightness-0 invert mb-8" />
          <h1 className="text-3xl font-bold text-white leading-snug">
            <span className="font-black">한줄전단 AI</span><br/>스마트 전단지 솔루션
          </h1>
          <p className="text-white/60 mt-4 text-sm leading-relaxed">
            상품만 입력하면 전단지 자동 생성<br/>
            단축URL 발급부터 발송까지 한번에
          </p>
        </div>

        <div className="relative z-10 space-y-3">
          <div className="text-white/30 text-xs leading-relaxed">
            <p><span className="font-semibold">주식회사 인비토</span> | 대표이사 유호윤</p>
            <p>사업자등록번호 667-86-00578 | 통신판매신고 제 2017-서울송파-0160호</p>
            <p>서울시 송파구 오금로36길 46, 신승빌딩 4F | 문의전화 1800-8125</p>
            <p className="mt-1">&copy; {new Date().getFullYear()} INVITO. All rights reserved.</p>
          </div>
        </div>

        {/* 배경 장식 */}
        <div className="absolute top-[-60px] right-[-60px] w-[200px] h-[200px] bg-white/5 rounded-full" />
        <div className="absolute bottom-[-40px] left-[-40px] w-[160px] h-[160px] bg-white/5 rounded-full" />
        <div className="absolute top-1/2 right-[-20px] w-[100px] h-[100px] bg-white/5 rounded-full" />
      </div>

      {/* 우측: 로그인 폼 */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-sm">
            {/* 모바일 로고 */}
            <div className="lg:hidden text-center mb-8">
              <img src="/logo.png" alt="한줄로" className="h-8 mx-auto mb-3" />
            </div>

            <h2 className="text-xl font-bold text-text mb-1">로그인</h2>
            <p className="text-sm text-text-secondary mb-8"><span className="font-semibold">한줄전단 AI</span> 계정으로 로그인하세요</p>

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

            <p className="text-center text-xs text-text-muted mt-6">문의전화 1800-8125</p>
          </div>
        </div>

        {/* 모바일 푸터 */}
        <footer className="lg:hidden bg-bg text-text-muted py-4 px-4">
          <div className="text-center text-xs leading-relaxed">
            <p>주식회사 인비토 | 667-86-00578</p>
            <p className="mt-1">&copy; {new Date().getFullYear()} INVITO. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
