import { useEffect, useRef, useCallback } from 'react';
import api from '../api/client';
import { useAuthStore } from '../stores/authStore';

/**
 * 세션 감시 훅
 * - 30초마다 서버에 세션 유효성 확인
 * - 탭에 다시 포커스 올 때 즉시 확인
 * - 세션 무효화 감지 시 onForceLogout 콜백 실행
 */
export function useSessionGuard(onForceLogout: (message: string) => void) {
  const { isAuthenticated, user } = useAuthStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCheckingRef = useRef(false);

  const checkSession = useCallback(async () => {
    // 중복 체크 방지
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;

    try {
      await api.get('/auth/session-check');
    } catch (err: any) {
      if (err.response?.status === 401 && err.response?.data?.forceLogout) {
        // client.ts interceptor가 먼저 처리하지만,
        // 여기서도 콜백으로 모달 표시
        onForceLogout(err.response.data.error || '다른 곳에서 로그인되어 현재 세션이 종료되었습니다.');
      }
    } finally {
      isCheckingRef.current = false;
    }
  }, [onForceLogout]);

  useEffect(() => {
    // 로그인 상태 + 슈퍼관리자가 아닐 때만 감시
    if (!isAuthenticated || user?.userType === 'super_admin') return;

    // 30초마다 체크
    intervalRef.current = setInterval(checkSession, 30 * 1000);

    // 탭 포커스 시 즉시 체크
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkSession();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isAuthenticated, user, checkSession]);
}
