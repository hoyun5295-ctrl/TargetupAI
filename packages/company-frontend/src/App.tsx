import { useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useSessionTimeout } from './hooks/useSessionTimeout';
import SessionTimeoutModal from './components/SessionTimeoutModal';
import LoginPage from './pages/LoginPage';
import CompanyDashboard from './pages/CompanyDashboard';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function SessionTimeoutGuard() {
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useAuthStore();

  const handleSessionLogout = useCallback(() => {
    logout();
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

export default function App() {
  return (
    <>
      <SessionTimeoutGuard />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <CompanyDashboard />
          </PrivateRoute>
        }
      />
    </Routes>
    </>
  );
}
