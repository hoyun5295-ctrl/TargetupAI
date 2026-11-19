import { useEffect, useRef, useCallback } from 'react';
import api from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { endClientSession, sharedEndFor } from '../utils/session-end';
import { isPublicPath } from '../utils/public-paths';

/**
 * 세션 감시 훅
 * - 30초마다 서버에 세션 유효성 확인 · 탭에 다시 포커스 올 때 즉시 확인
 *   ★ 2026-11-19 C145 — 확인 요청의 401 은 API 통로(api/client.ts)가 로그인 끝 처리 CT(utils/session-end)로 판정한다.
 *     이 훅은 401 을 다시 판정하지 않는다(같은 401 을 두 자리가 판정하면 갈라진다 · 설계 2R).
 * - ★ D111 P0: 같은 브라우저의 다른 탭/창에서 로그인이 바뀌면 `storage` 이벤트로 즉시 감지
 *   ★ C145 — 끝난 것 = 바뀌기 전 토큰(oldValue) · 새 로그인의 토큰은 지우지 않는다(이 탭은 그것을 따른다 · 공개 경로 = 조용히)
 */
export function useSessionGuard() {
  const { isAuthenticated, user, token } = useAuthStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCheckingRef = useRef(false);

  const checkSession = useCallback(async () => {
    // 중복 체크 방지
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    try {
      await api.get('/auth/session-check');
    } catch {
      // 401 = 통로가 끝 처리 CT 로 판정했다 · 그 밖(네트워크 등) = 다음 확인에서 다시
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

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

    const handleStorage = (e: StorageEvent) => {
      if (e.key !== 'token') return;
      if (e.newValue) {
        // 다른 창이 새로 로그인했다 — 끝난 것 = 바뀌기 전 값(내 탭과 같으면 이 탭의 로그인이 끝난 것)
        if (e.newValue !== token) endClientSession({ endedToken: e.oldValue });
        return;
      }
      // 다른 창이 토큰을 지웠다 — 그 창이 서버의 끝을 받아 원인을 나눴으면(이 탭 토큰 것) 그 사유로 끝낸다 · 아니면 본인 로그아웃(지금처럼 무시)
      if (!isPublicPath(window.location.pathname)) {
        const shared = sharedEndFor(token);
        if (shared) endClientSession({ endedToken: token, serverReason: shared.reason });
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('storage', handleStorage);
    };
  }, [isAuthenticated, user, token, checkSession]);
}
