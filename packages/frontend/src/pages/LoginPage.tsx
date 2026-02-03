import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../api/client';
import { useAuthStore } from '../stores/authStore';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [userType, setUserType] = useState<'super_admin' | 'company'>('company');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 비밀번호 변경 모달 상태
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [tempUser, setTempUser] = useState<any>(null);
  const [tempToken, setTempToken] = useState('');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPwConfirm, setNewPwConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await authApi.login({
        loginId,
        password,
        userType: userType === 'super_admin' ? 'super_admin' : undefined,
      });

      const { token, user } = response.data;

      // 비밀번호 변경 필요 체크
      if (user.mustChangePassword) {
        setTempUser(user);
        setTempToken(token);
        setCurrentPw(password); // 방금 입력한 비밀번호
        setShowPasswordModal(true);
        setLoading(false);
        return;
      }

      login(user, token);

      if (user.userType === 'super_admin') {
        navigate('/admin');
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    setPwError('');

    if (newPw.length < 8) {
      setPwError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }

    if (newPw !== newPwConfirm) {
      setPwError('새 비밀번호가 일치하지 않습니다.');
      return;
    }

    if (currentPw === newPw) {
      setPwError('기존 비밀번호와 다른 비밀번호를 입력하세요.');
      return;
    }

    setPwLoading(true);

    try {
      await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: tempUser.id,
          currentPassword: currentPw,
          newPassword: newPw,
        }),
      });

      // 비밀번호 변경 성공 → 로그인 처리
      login({ ...tempUser, mustChangePassword: false }, tempToken);

      if (tempUser.userType === 'super_admin') {
        navigate('/admin');
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setPwError('비밀번호 변경에 실패했습니다.');
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        {/* 로고 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Target-UP</h1>
          <p className="text-gray-500 mt-2">타겟 메시징 플랫폼</p>
        </div>

        {/* 사용자 유형 선택 */}
        <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
          <button
            type="button"
            onClick={() => setUserType('company')}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
              userType === 'company'
                ? 'bg-white shadow text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            고객사
          </button>
          <button
            type="button"
            onClick={() => setUserType('super_admin')}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
              userType === 'super_admin'
                ? 'bg-white shadow text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            관리자
          </button>
        </div>

        {/* 로그인 폼 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              아이디
            </label>
            <input
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="아이디를 입력하세요"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              비밀번호
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="비밀번호를 입력하세요"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="text-center text-gray-400 text-sm mt-6">
          © 2026 INVITO. All rights reserved.
        </p>
      </div>

      {/* 비밀번호 변경 모달 */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-orange-50 to-amber-50">
              <h3 className="text-lg font-semibold text-gray-800">🔐 비밀번호 변경 필요</h3>
              <p className="text-sm text-gray-500 mt-1">보안을 위해 비밀번호를 변경해주세요.</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  새 비밀번호 *
                </label>
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="8자 이상 입력"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  새 비밀번호 확인 *
                </label>
                <input
                  type="password"
                  value={newPwConfirm}
                  onChange={(e) => setNewPwConfirm(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="비밀번호 재입력"
                />
              </div>

              {pwError && (
                <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
                  {pwError}
                </div>
              )}

              <button
                onClick={handlePasswordChange}
                disabled={pwLoading || !newPw || !newPwConfirm}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pwLoading ? '변경 중...' : '비밀번호 변경'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}