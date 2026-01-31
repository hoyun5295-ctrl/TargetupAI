import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/AdminDashboard';
import Dashboard from './pages/Dashboard';
import CalendarPage from './pages/CalendarPage';
import Settings from './pages/Settings';

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
        {/* 404 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
