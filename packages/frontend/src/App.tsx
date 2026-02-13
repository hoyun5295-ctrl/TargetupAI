import { useEffect, useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useSessionGuard } from './hooks/useSessionGuard';
import { useSessionTimeout } from './hooks/useSessionTimeout';
import SessionTimeoutModal from './components/SessionTimeoutModal';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/AdminDashboard';
import Dashboard from './pages/Dashboard';
import ManagePage from './pages/ManagePage';
import CalendarPage from './pages/CalendarPage';
import Settings from './pages/Settings';
import Unsubscribes from './pages/Unsubscribes';
import PricingPage from './pages/PricingPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';

// 인증 필요 라우트
function PrivateRoute({ children, allowedTypes }: { children: React.ReactNode; allowedTypes?: string[] }) {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedTypes && user && !allowedTypes.includes(user.userType)) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// 세션 감시 + 강제 로그아웃 모달
function SessionGuard() {
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');

  const handleForceLogout = useCallback((message: string) => {
    setModalMessage(message);
    setShowModal(true);
  }, []);

  useSessionGuard(handleForceLogout);

  const handleConfirm = () => {
    setShowModal(false);
    logout();
    navigate('/login', { replace: true });
  };

  if (!showModal) return null;

  return (
    <>
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
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[9999] animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
          <div className="px-6 pt-8 pb-2 text-center">
            <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900">세션이 종료되었습니다</h3>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">{modalMessage}</p>
          </div>
          <div className="px-6 pb-6 pt-4">
            <button
              onClick={handleConfirm}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              로그인 페이지로 이동
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// 세션 타임아웃 (비활동 감지 → 자동 로그아웃)
function SessionTimeoutGuard() {
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useAuthStore();

  const handleSessionLogout = useCallback(() => {
    logout();
    sessionStorage.setItem('forceLogoutReason', '장시간 활동이 없어 자동 로그아웃되었습니다.');
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  const { showWarningModal, remainingSeconds, extendSession, handleLogout } =
    useSessionTimeout({ onLogout: handleSessionLogout });

  if (!isAuthenticated) return null;

  return (
    <SessionTimeoutModal
      isOpen={showWarningModal}
      remainingSeconds={remainingSeconds}
      onExtend={extendSession}
      onLogout={handleLogout}
    />
  );
}

function App() {
  const { loadFromStorage, isAuthenticated, user } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadFromStorage();
    setIsLoading(false);
  }, [loadFromStorage]);

  if (isLoading) {
    return <div>로딩 중...</div>;
  }

  return (
    <BrowserRouter>
      {/* 세션 감시 (로그인 상태일 때만 활성) */}
      <SessionGuard />
      <SessionTimeoutGuard />

      <Routes>
        {/* 로그인 */}
        <Route path="/login" element={<LoginPage />} />

        {/* 슈퍼관리자 */}
        <Route
          path="/admin"
          element={
            <PrivateRoute allowedTypes={['super_admin']}>
              <AdminDashboard />
            </PrivateRoute>
          }
        />

        {/* 고객사 대시보드 */}
        <Route
          path="/dashboard"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <Dashboard />
            </PrivateRoute>
          }
        />

        {/* 고객사 관리자 전용 — 관리 페이지 */}
        <Route
          path="/manage"
          element={
            <PrivateRoute allowedTypes={['company_admin']}>
              <ManagePage />
            </PrivateRoute>
          }
        />

        {/* 캘린더 */}
        <Route
          path="/calendar"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <CalendarPage />
            </PrivateRoute>
          }
        />

        {/* 기본 리다이렉트 */}
        <Route
          path="/"
          element={
            isAuthenticated ? (
              user?.userType === 'super_admin' ? (
                <Navigate to="/admin" replace />
              ) : (
                <Navigate to="/dashboard" replace />
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
        <Route path="/unsubscribes" element={<PrivateRoute><Unsubscribes /></PrivateRoute>} />
        <Route path="/pricing" element={<PrivateRoute><PricingPage /></PrivateRoute>} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />

        {/* 404 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
