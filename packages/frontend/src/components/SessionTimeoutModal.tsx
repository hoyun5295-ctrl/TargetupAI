import React, { useEffect, useState } from 'react';
import { Clock, LogOut, RefreshCw } from 'lucide-react';

interface SessionTimeoutModalProps {
  isOpen: boolean;
  remainingSeconds: number;
  onExtend: () => void;
  onLogout: () => void;
}

const SessionTimeoutModal: React.FC<SessionTimeoutModalProps> = ({
  isOpen,
  remainingSeconds,
  onExtend,
  onLogout,
}) => {
  const [visible, setVisible] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimateIn(true));
      });
    } else {
      setAnimateIn(false);
      const timer = setTimeout(() => setVisible(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!visible) return null;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeDisplay = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const isUrgent = remainingSeconds <= 60;

  // 원형 프로그레스 (5분 = 300초 기준)
  const progress = Math.min(remainingSeconds / 300, 1);
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: animateIn ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)',
        backdropFilter: animateIn ? 'blur(4px)' : 'none',
        transition: 'background-color 0.2s ease, backdrop-filter 0.2s ease',
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '16px',
          padding: '32px',
          maxWidth: '380px',
          width: '90%',
          boxShadow: '0 25px 60px rgba(0,0,0,0.2)',
          transform: animateIn ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(20px)',
          opacity: animateIn ? 1 : 0,
          transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease',
          textAlign: 'center' as const,
        }}
      >
        {/* 원형 타이머 */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <div style={{ position: 'relative', width: '100px', height: '100px' }}>
            <svg width="100" height="100" style={{ transform: 'rotate(-90deg)' }}>
              {/* 배경 원 */}
              <circle
                cx="50" cy="50" r="40"
                fill="none"
                stroke="#f0f0f0"
                strokeWidth="6"
              />
              {/* 프로그레스 원 */}
              <circle
                cx="50" cy="50" r="40"
                fill="none"
                stroke={isUrgent ? '#ef4444' : '#f59e0b'}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease' }}
              />
            </svg>
            {/* 가운데 시간 */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  fontSize: '22px',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  color: isUrgent ? '#ef4444' : '#f59e0b',
                  transition: 'color 0.3s ease',
                }}
              >
                {timeDisplay}
              </span>
            </div>
          </div>
        </div>

        {/* 아이콘 + 제목 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            marginBottom: '8px',
          }}
        >
          <Clock size={20} color={isUrgent ? '#ef4444' : '#f59e0b'} />
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1a1a1a' }}>
            세션 만료 예정
          </h3>
        </div>

        {/* 설명 */}
        <p style={{ margin: '0 0 24px', fontSize: '14px', color: '#666', lineHeight: 1.5 }}>
          {isUrgent
            ? '곧 자동 로그아웃됩니다. 계속 사용하시려면 세션을 연장해주세요.'
            : '장시간 활동이 없어 세션이 곧 만료됩니다. 계속 사용하시려면 세션을 연장해주세요.'}
        </p>

        {/* 버튼 */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onLogout}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '10px',
              border: '1px solid #e0e0e0',
              backgroundColor: '#fff',
              color: '#666',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#f5f5f5';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#fff';
            }}
          >
            <LogOut size={16} />
            로그아웃
          </button>
          <button
            onClick={onExtend}
            style={{
              flex: 1.5,
              padding: '10px 16px',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: '#2E7D32',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
              boxShadow: '0 2px 8px rgba(46,125,50,0.3)',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#1b5e20';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#2E7D32';
            }}
          >
            <RefreshCw size={16} />
            세션 연장
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionTimeoutModal;
