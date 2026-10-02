import { useState, useEffect, useCallback, useRef } from 'react';

interface UseSessionTimeoutOptions {
  onLogout: () => void;
  onWarning?: () => void;
}

interface UseSessionTimeoutReturn {
  showWarningModal: boolean;
  remainingSeconds: number;
  totalSeconds: number;
  extendSession: () => void;
  handleLogout: () => void;
}

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
const WARNING_BEFORE_SECONDS = 300; // 5분 전 경고
const TICK_INTERVAL = 1000;
// ★ 2026-09-27 한줄로 V2 S2-04 — 입력이 이어지면 5분에 한 번 서버 세션도 연장한다(서버 활동 갱신 간격과 같은 5분).
//   옛: 입력은 화면 타이머만 늘리고 서버에 알리지 않아, 긴 글을 쓰는 동안 서버 세션만 만료돼 저장 순간 강제 로그아웃될 수 있었다.
const SERVER_PING_INTERVAL_MS = 5 * 60 * 1000;
/**
 * 고객사 세션 기본 시간(분) — 서버 `TIMEOUTS.companySessionDefaultMinutes`와 같은 값(계약 테스트가 둘을 대조한다).
 * ★ 2026-10-02 30 → 480(8시간). 로그인마다 인증번호를 받으므로 30분 자동 로그아웃을 걷어 냈다.
 *   자동 로그아웃 자체는 남는다 — 8시간 동안 입력이 없으면 끊고, 5분 전에 안내 창이 뜬다.
 */
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 480;

export function useSessionTimeout({ onLogout }: UseSessionTimeoutOptions): UseSessionTimeoutReturn {
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const lastActivityRef = useRef<number>(Date.now());
  const timeoutMinutesRef = useRef<number>(DEFAULT_SESSION_TIMEOUT_MINUTES);
  const warningShownRef = useRef(false);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastServerPingRef = useRef<number>(Date.now());

  // 서버 세션 연장 알림(실패해도 화면 타이머는 그대로)
  const pingServer = useCallback(() => {
    lastServerPingRef.current = Date.now();
    try {
      const token = localStorage.getItem('token');
      if (token) {
        fetch('/api/auth/extend-session', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        }).catch(() => {});
      }
    } catch {}
  }, []);

  // localStorage에서 세션 타임아웃 분 가져오기
  const getTimeoutMinutes = useCallback((): number => {
    try {
      const stored = localStorage.getItem('sessionTimeoutMinutes');
      if (stored) {
        const val = parseInt(stored, 10);
        if (val > 0) return val;
      }
    } catch {}
    return DEFAULT_SESSION_TIMEOUT_MINUTES;
  }, []);

  // 활동 감지 → 마지막 활동 시각 갱신
  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (!warningShownRef.current && Date.now() - lastServerPingRef.current > SERVER_PING_INTERVAL_MS) pingServer();
    // 경고 모달이 안 떠있을 때만 리셋 (경고 중엔 활동해도 무시)
    if (!warningShownRef.current) {
      // 활동이 감지되면 타이머 리셋됨 (tick에서 자동 계산)
    }
  }, [pingServer]);

  // 세션 연장
  const extendSession = useCallback(() => {
    lastActivityRef.current = Date.now();
    warningShownRef.current = false;
    setShowWarningModal(false);
    setRemainingSeconds(0);

    // 서버에 세션 연장 알림 (실패해도 프론트 타이머는 리셋)
    pingServer();
  }, [pingServer]);

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

      // ★ 항상 남은 시간 업데이트 (헤더 타이머 표시용)
      setRemainingSeconds(remaining);
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
    totalSeconds: timeoutMinutesRef.current * 60,
    extendSession,
    handleLogout,
  };
}
