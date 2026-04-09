/**
 * ★ 전단AI 전용 세션 타임아웃 훅
 *
 * 한줄로AI와 완전 분리:
 * - localStorage 키: flyer_token (한줄로는 token)
 * - Context 없이 독립 동작
 * - 서버 세션 연장 API: /api/flyer/auth/session-check (전단AI 전용)
 */
import { useState, useEffect, useCallback, useRef } from 'react';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
const TIMEOUT_MINUTES = 30;
const WARNING_BEFORE_SECONDS = 300; // 5분 전 경고
const TICK_INTERVAL = 1000;

interface UseSessionTimeoutOptions {
  onLogout: () => void;
}

interface UseSessionTimeoutReturn {
  showWarningModal: boolean;
  remainingSeconds: number;
  totalSeconds: number;
  extendSession: () => void;
  handleLogout: () => void;
}

export function useSessionTimeout({ onLogout }: UseSessionTimeoutOptions): UseSessionTimeoutReturn {
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(TIMEOUT_MINUTES * 60);

  const lastActivityRef = useRef<number>(Date.now());
  const warningShownRef = useRef(false);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 활동 감지 → 마지막 활동 시각 갱신
  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // 세션 연장
  const extendSession = useCallback(() => {
    lastActivityRef.current = Date.now();
    warningShownRef.current = false;
    setShowWarningModal(false);
    setRemainingSeconds(TIMEOUT_MINUTES * 60);

    // 서버에 세션 연장 알림
    try {
      const token = localStorage.getItem('flyer_token');
      if (token) {
        fetch('/api/flyer/auth/session-check', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }).catch(() => {});
      }
    } catch {}
  }, []);

  // 로그아웃 처리
  const handleLogout = useCallback(() => {
    setShowWarningModal(false);
    warningShownRef.current = false;
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    onLogout();
  }, [onLogout]);

  // 매초 체크하는 tick
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const timeoutMs = TIMEOUT_MINUTES * 60 * 1000;
      const elapsed = now - lastActivityRef.current;
      const remaining = Math.max(0, Math.ceil((timeoutMs - elapsed) / 1000));

      if (remaining <= 0) {
        handleLogout();
        return;
      }

      if (remaining <= WARNING_BEFORE_SECONDS && !warningShownRef.current) {
        warningShownRef.current = true;
        setShowWarningModal(true);
      }

      setRemainingSeconds(remaining);
    };

    tickIntervalRef.current = setInterval(tick, TICK_INTERVAL);
    return () => {
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    };
  }, [handleLogout]);

  // 활동 이벤트 리스너
  useEffect(() => {
    ACTIVITY_EVENTS.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });
    return () => {
      ACTIVITY_EVENTS.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [handleActivity]);

  return { showWarningModal, remainingSeconds, totalSeconds: TIMEOUT_MINUTES * 60, extendSession, handleLogout };
}
