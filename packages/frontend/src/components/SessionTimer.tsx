import { useContext } from 'react';
import { SessionTimerContext } from '../App';

/**
 * 세션 남은 시간 표시 (은행 스타일)
 * - 10분 이상: 초록색
 * - 5~10분: 주황색
 * - 5분 미만: 빨간색 + 깜빡임
 */
export default function SessionTimer() {
  const { remainingSeconds, totalSeconds, extendSession } = useContext(SessionTimerContext);

  if (totalSeconds <= 0) return null;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  // 비율 기반 색상 결정
  const isUrgent = remainingSeconds <= 300; // 5분 미만
  const isWarning = remainingSeconds <= 600; // 10분 미만

  const color = isUrgent ? '#ef4444' : isWarning ? '#f59e0b' : '#22c55e';
  const bgColor = isUrgent ? '#fef2f2' : isWarning ? '#fffbeb' : '#f0fdf4';
  const borderColor = isUrgent ? '#fecaca' : isWarning ? '#fde68a' : '#bbf7d0';

  return (
    <div
      onClick={extendSession}
      title="클릭하면 세션이 연장됩니다"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '8px',
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        animation: isUrgent ? 'sessionPulse 1.5s ease-in-out infinite' : 'none',
        userSelect: 'none' as const,
      }}
    >
      <style>{`
        @keyframes sessionPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
      {/* 작은 시계 아이콘 */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <span
        style={{
          fontSize: '12px',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: color,
          letterSpacing: '0.5px',
        }}
      >
        {timeStr}
      </span>
    </div>
  );
}
