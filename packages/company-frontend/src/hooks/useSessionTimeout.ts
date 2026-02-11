import { useState, useEffect, useCallback, useRef } from 'react';

interface UseSessionTimeoutOptions {
  onLogout: () => void;
  onWarning?: () => void;
}

interface UseSessionTimeoutReturn {
  showWarningModal: boolean;
  remainingSeconds: number;
  extendSession: () => void;
  handleLogout: () => void;
}

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
const WARNING_BEFORE_SECONDS = 300; // 5분 전 경고
const TICK_INTERVAL = 1000;

export function useSessionTimeout({ onLogout }: UseSessionTimeoutOptions): UseSessionTimeoutReturn {
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const lastActivityRef = useRef<number>(Date.now());
  const timeoutMinutesRef = useRef<number>(30);
  const warningShownRef = useRef(false);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // localStorage에서 세션 타임아웃 분 가져오기
  const getTimeoutMinutes = useCallback((): number => {
    try {
      const stored = localStorage.getItem('sessionTimeoutMinutes');
      if (stored) {
        const val = parseInt(stored, 10);
        if (val > 0) return val;
      }
    } catch {}
    return 30; // 기본 30분
  }, []);

  // 활동 감지 → 마지막 활동 시각 갱신
  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    // 경고 모달이 안 떠있을 때만 리셋 (경고 중엔 활동해도 무시)
    if (!warningShownRef.current) {
      // 활동이 감지되면 타이머 리셋됨 (tick에서 자동 계산)
    }
  }, []);

  // 세션 연장
  const extendSession = useCallback(() => {
    lastActivityRef.current = Date.now();
    warningShownRef.current = false;
    setShowWarningModal(false);
    setRemainingSeconds(0);

    // 서버에 세션 연장 알림 (선택적)
    try {
      const token = localStorage.getItem('token');
      if (token) {
        fetch('/api/auth/extend-session', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }).catch(() => {}); // 실패해도 프론트 타이머는 리셋
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
    timeoutMinutesRef.current = getTimeoutMinutes();

    const tick = () => {
      const now = Date.now();
      const timeoutMs = timeoutMinutesRef.current * 60 * 1000;
      const elapsed = now - lastActivityRef.current;
      const remaining = Math.max(0, Math.ceil((timeoutMs - elapsed) / 1000));

      // 만료
      if (remaining <= 0) {
        handleLogout();
        return;
      }

      // 경고 구간 진입 (5분 전)
      if (remaining <= WARNING_BEFORE_SECONDS && !warningShownRef.current) {
        warningShownRef.current = true;
        setShowWarningModal(true);
      }

      // 경고 모달이 떠있을 때만 남은 시간 업데이트
      if (warningShownRef.current) {
        setRemainingSeconds(remaining);
      }
    };

    tickIntervalRef.current = setInterval(tick, TICK_INTERVAL);

    return () => {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
      }
    };
  }, [getTimeoutMinutes, handleLogout]);

  // 활동 이벤트 리스너 등록
  useEffect(() => {
    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [handleActivity]);

  return {
    showWarningModal,
    remainingSeconds,
    extendSession,
    handleLogout,
  };
}
