/**
 * ★ 전단AI 전용 세션 만료 경고 모달
 * - 원형 프로그레스 타이머 (5분=300초 기준)
 * - 세션 연장 또는 로그아웃 선택
 * - lucide-react 의존 없이 인라인 SVG 사용 (전단AI에는 lucide 미설치)
 */
import { useEffect, useState } from 'react';

interface SessionTimeoutModalProps {
  isOpen: boolean;
  remainingSeconds: number;
  onExtend: () => void;
  onLogout: () => void;
}

export default function SessionTimeoutModal({ isOpen, remainingSeconds, onExtend, onLogout }: SessionTimeoutModalProps) {
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

  const progress = Math.min(remainingSeconds / 300, 1);
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: animateIn ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)',
      backdropFilter: animateIn ? 'blur(4px)' : 'none',
      transition: 'background-color 0.2s ease, backdrop-filter 0.2s ease',
    }}>
      <div style={{
        backgroundColor: '#fff', borderRadius: '16px', padding: '32px',
        maxWidth: '380px', width: '90%',
        boxShadow: '0 25px 60px rgba(0,0,0,0.2)',
        transform: animateIn ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(20px)',
        opacity: animateIn ? 1 : 0,
        transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease',
        textAlign: 'center' as const,
      }}>
        {/* 원형 타이머 */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <div style={{ position: 'relative', width: '100px', height: '100px' }}>
            <svg width="100" height="100" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="50" cy="50" r="40" fill="none" stroke="#f0f0f0" strokeWidth="6" />
              <circle cx="50" cy="50" r="40" fill="none"
                stroke={isUrgent ? '#ef4444' : '#f59e0b'}
                strokeWidth="6" strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
                style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease' }}
              />
            </svg>
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{
                fontSize: '22px', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                color: isUrgent ? '#ef4444' : '#f59e0b',
                transition: 'color 0.3s ease',
              }}>{timeDisplay}</span>
            </div>
          </div>
        </div>

        {/* 제목 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isUrgent ? '#ef4444' : '#f59e0b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1a1a1a' }}>세션 만료 예정</h3>
        </div>

        <p style={{ margin: '0 0 24px', fontSize: '14px', color: '#666', lineHeight: 1.5 }}>
          {isUrgent
            ? '곧 자동 로그아웃됩니다. 계속 사용하시려면 세션을 연장해주세요.'
            : '장시간 활동이 없어 세션이 곧 만료됩니다. 계속 사용하시려면 세션을 연장해주세요.'}
        </p>

        {/* 버튼 */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onLogout} style={{
            flex: 1, padding: '10px 16px', borderRadius: '10px',
            border: '1px solid #e0e0e0', backgroundColor: '#fff',
            color: '#666', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            로그아웃
          </button>
          <button onClick={onExtend} style={{
            flex: 1.5, padding: '10px 16px', borderRadius: '10px',
            border: 'none', backgroundColor: '#7c3aed', color: '#fff',
            fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            세션 연장
          </button>
        </div>
      </div>
    </div>
  );
}
