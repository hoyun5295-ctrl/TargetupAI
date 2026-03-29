import { useState } from 'react';
import { API_BASE } from '../App';

interface Props {
  onLogin: (token: string, user: any) => void;
}

export default function LoginPage({ onLogin }: Props) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password }),
      });

      const data = await res.json();

      if (res.ok && data.token) {
        localStorage.setItem('flyer_token', data.token);
        localStorage.setItem('flyer_user', JSON.stringify(data.user));
        onLogin(data.token, data.user);
      } else {
        setError(data.error || '로그인에 실패했습니다.');
      }
    } catch {
      setError('서버 연결에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full mx-4 p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800">전단AI</h1>
          <p className="text-sm text-gray-500 mt-1">AI 전단지 솔루션</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">아이디</label>
            <input type="text" value={loginId} onChange={e => setLoginId(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="아이디를 입력하세요" autoFocus />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">비밀번호</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="비밀번호를 입력하세요" />
          </div>
          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
          <button type="submit" disabled={loading || !loginId || !password} className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>
        <p className="text-xs text-gray-400 text-center mt-6">hanjul-flyer.com</p>
      </div>
    </div>
  );
}
