import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authApi } from '../api/client';
import { useAuthStore } from '../stores/authStore';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const isSuperAdminOnly = window.location.hostname === 'sys.hanjullo.com' || window.location.port === '5174';

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [tempUser, setTempUser] = useState<any>(null);
  const [tempToken, setTempToken] = useState('');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPwConfirm, setNewPwConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  // 강제 로그아웃 모달
  const [showForceLogoutModal, setShowForceLogoutModal] = useState(false);
  const [forceLogoutMessage, setForceLogoutMessage] = useState('');

  // 발송 중 차단 모달
  const [showSendingBlockModal, setShowSendingBlockModal] = useState(false);
  const [sendingBlockMessage, setSendingBlockMessage] = useState('');

  // 페이지 진입 시 강제 로그아웃 사유 확인
  useEffect(() => {
    const reason = sessionStorage.getItem('forceLogoutReason');
    if (reason) {
      setForceLogoutMessage(reason);
      setShowForceLogoutModal(true);
      sessionStorage.removeItem('forceLogoutReason');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await authApi.login({
        loginId,
        password,
        userType: isSuperAdminOnly ? 'super_admin' : undefined,
      });

      const { token, user } = response.data;

      if (user.mustChangePassword) {
        setTempUser(user);
        setTempToken(token);
        setCurrentPw(password);
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
      const status = err.response?.status;
      const data = err.response?.data;

      // 발송 진행 중 — 로그인 차단
      if (status === 409 && data?.reason === 'sending_in_progress') {
        setSendingBlockMessage(data.error);
        setShowSendingBlockModal(true);
      } else {
        setError(data?.error || '로그인에 실패했습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    setPwError('');
    if (newPw.length < 8) { setPwError('비밀번호는 8자 이상이어야 합니다.'); return; }
    if (newPw !== newPwConfirm) { setPwError('새 비밀번호가 일치하지 않습니다.'); return; }
    if (currentPw === newPw) { setPwError('기존 비밀번호와 다른 비밀번호를 입력하세요.'); return; }
    setPwLoading(true);
    try {
      await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: tempUser.id, currentPassword: currentPw, newPassword: newPw }),
      });
      login({ ...tempUser, mustChangePassword: false }, tempToken);
      if (tempUser.userType === 'super_admin') { navigate('/admin'); } else { navigate('/dashboard'); }
    } catch (err: any) { setPwError('비밀번호 변경에 실패했습니다.'); }
    finally { setPwLoading(false); }
  };

  // ===== 모달들 =====

  // 강제 로그아웃 모달 (다른 곳에서 로그인)
  const forceLogoutModal = showForceLogoutModal && (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        <div className="px-6 pt-8 pb-2 text-center">
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900">세션이 종료되었습니다</h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">{forceLogoutMessage}</p>
        </div>
        <div className="px-6 pb-6 pt-4">
          <button
            onClick={() => setShowForceLogoutModal(false)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );

  // 발송 진행 중 차단 모달
  const sendingBlockModalEl = showSendingBlockModal && (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        <div className="px-6 pt-8 pb-2 text-center">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900">접속할 수 없습니다</h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">{sendingBlockMessage}</p>
        </div>
        <div className="px-6 pb-6 pt-4">
          <button
            onClick={() => setShowSendingBlockModal(false)}
            className="w-full bg-gray-600 hover:bg-gray-700 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );

  // 비밀번호 변경 모달
  const passwordModal = showPasswordModal && (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        <div className="px-6 pt-8 pb-2 text-center">
          <div className="w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-orange-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900">비밀번호 변경 필요</h3>
          <p className="text-sm text-gray-500 mt-1">보안을 위해 비밀번호를 변경해주세요.</p>
        </div>
        <div className="px-6 pb-6 pt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 *</label>
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-sm"
              placeholder="8자 이상 입력" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 확인 *</label>
            <input type="password" value={newPwConfirm} onChange={(e) => setNewPwConfirm(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-sm"
              placeholder="비밀번호 재입력" />
          </div>
          {pwError && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600">{pwError}</div>}
          <button onClick={handlePasswordChange} disabled={pwLoading || !newPw || !newPwConfirm}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-xl text-sm transition-colors">
            {pwLoading ? '변경 중...' : '비밀번호 변경'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      {/* CSS 애니메이션 정의 */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes zoomIn {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
          {isSuperAdminOnly ? (
              <>
                <img src="/logo.png" alt="한줄로" className="h-10 mx-auto" />
                <p className="mt-3 text-sm text-gray-500">시스템 관리</p>
              </>
            ) : (
              <>
                <img src="/logo.png" alt="한줄로" className="h-10 mx-auto" />
                <p className="mt-3 text-sm text-gray-500">AI 마케팅 자동화</p>
              </>
            )}
          </div>

          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg p-8 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">아이디</label>
              <input type="text" value={loginId} onChange={(e) => setLoginId(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                placeholder="아이디 입력" autoFocus required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">비밀번호</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                placeholder="비밀번호 입력" required />
            </div>

            {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600">{error}</div>}

            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-lg text-sm transition">
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
            서울시 송파구 오금로36길 46, 신송빌딩 4F | 문의전화 1800-8125
          </p>
          <p className="mt-2">
            <Link to="/privacy" className="hover:text-white transition">개인정보처리방침</Link>
            <span className="mx-2">|</span>
            <Link to="/terms" className="hover:text-white transition">이용약관</Link>
          </p>
          <p className="mt-2 text-gray-500">
            © 2026 INVITO. All rights reserved.
          </p>
        </div>
      </footer>

      {/* 모달들 */}
      {forceLogoutModal}
      {sendingBlockModalEl}
      {passwordModal}
    </div>
  );
}
