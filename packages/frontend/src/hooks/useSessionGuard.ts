import { useEffect, useRef, useCallback } from 'react';
import api from '../api/client';
import { useAuthStore } from '../stores/authStore';

/**
 * 세션 감시 훅
 * - 30초마다 서버에 세션 유효성 확인
 * - 탭에 다시 포커스 올 때 즉시 확인
 * - ★ D111 P0: 같은 브라우저의 다른 탭/창에서 같은 계정으로 재로그인 시 `storage` 이벤트로 즉시 감지
 *   (서버가 push 불가 → localStorage 변경 이벤트 기반 탭 간 실시간 동기화)
 * - 세션 무효화 감지 시 onForceLogout 콜백 실행
 */
export function useSessionGuard(onForceLogout: (message: string) => void) {
  const { isAuthenticated, user, token } = useAuthStore();
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
    // ★ 보안: 슈퍼관리자 포함 전체 사용자 세션 감시
    if (!isAuthenticated) return;

    // 30초마다 체크
    intervalRef.current = setInterval(checkSession, 30 * 1000);

    // 탭 포커스 시 즉시 체크
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkSession();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ★ D111 P0: 같은 브라우저의 다른 탭/창에서 같은 계정 재로그인 시 즉시 감지
    //   창 B가 localStorage.setItem('token', newToken) → 창 A에 storage 이벤트 발화
    //   창 A의 현재 토큰과 다르면 = 같은 계정을 다른 사람이 로그인 → 즉시 강제 로그아웃
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== 'token') return;
      // 로그아웃 케이스 (newValue=null)는 무시 — 자신이 로그아웃한 경우도 포함
      if (!e.newValue) return;
      // 다른 탭에서 새 토큰이 저장됨 → 내 토큰과 다르면 내가 밀려난 것
      if (e.newValue !== token) {
        onForceLogout('같은 계정이 다른 곳에서 로그인되어 현재 세션이 종료되었습니다.');
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('storage', handleStorage);
    };
  }, [isAuthenticated, user, token, checkSession, onForceLogout]);
}
