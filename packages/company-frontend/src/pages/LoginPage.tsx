import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../api/client';
import { useAuthStore } from '../stores/authStore';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId || !password) {
      setError('아이디와 비밀번호를 입력해주세요.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await authApi.login({ loginId, password, loginSource: 'company-admin' });
      const { token, user, sessionTimeoutMinutes } = res.data;
      localStorage.setItem('sessionTimeoutMinutes', String(sessionTimeoutMinutes || 30));

      // 슈퍼관리자는 이 프론트에 접속 불가
      if (user.userType === 'super_admin') {
        setError('고객사 관리자 전용 페이지입니다.');
        return;
      }

      login(user, token);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* 로고 */}
        <div className="text-center mb-8">
        <img src="/logo.png" alt="한줄로" className="h-10 mx-auto" />
        <p className="mt-3 text-sm text-gray-500">사용자 관리</p>
        </div>

        {/* 로그인 폼 */}
        <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-lg p-8 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">아이디</label>
            <input
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              placeholder="아이디 입력"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              placeholder="비밀번호 입력"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-lg text-sm transition"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </div>
      </div>

      {/* 푸터 */}
      <footer className="bg-gray-800 text-gray-400 py-4 px-4">
        <div className="max-w-4xl mx-auto text-center text-xs leading-relaxed">
          <p>
            주식회사 인비토 | 대표이사 유호윤 | 사업자등록번호 667-86-00578 | 통신판매신고 제 2017-서울송파-0160호
          </p>
          <p className="mt-1">
            서울시 송파구 오금로36길 46, 신승빌딩 4F | 문의전화 1800-8125
          </p>
          <p className="mt-2 text-gray-500">
            © 2026 INVITO. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
