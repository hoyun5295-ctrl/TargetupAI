import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import SessionTimer from './SessionTimer';

interface DashboardHeaderProps {
  companyName: string;
  userName: string;
  department?: string;
  isCompanyAdmin: boolean;
  onDirectSend: () => void;
  onCalendar: () => void;
  onResults: () => void;
  onAnalysis: () => void;
  onLogout: () => void;
  // D53: 게이팅 콜백 — 잠긴 기능 클릭 시 업그레이드 모달
  onFeatureLocked?: (featureName: string, requiredPlan: string) => void;
  customerDbEnabled?: boolean;
  // ★ D88: 구독 만료 시 전체 잠금
  isSubscriptionLocked?: boolean;
  onSubscriptionLocked?: () => void;
}

type MenuColor = 'green' | 'gold' | 'gray';

interface MenuItem {
  label: string;
  onClick: () => void;
  color: MenuColor;
  emphasized?: boolean;
  locked?: boolean;
  path?: string; // 현재 페이지 활성 감지용
}

// ★ D95: 필(pill) 스타일 메뉴 — 밑줄 제거, 호버/강조 시 배경색
const COLOR_CONFIG: Record<MenuColor, { text: string; hoverText: string; hoverBg: string; activeBg: string; activeText: string }> = {
  green: { text: '#4b5563', hoverText: '#15803d', hoverBg: '#f0fdf4', activeBg: '#ecfdf5', activeText: '#15803d' },
  gold:  { text: '#4b5563', hoverText: '#b45309', hoverBg: '#fffbeb', activeBg: '#fef3c7', activeText: '#b45309' },
  gray:  { text: '#9ca3af', hoverText: '#6b7280', hoverBg: '#f3f4f6', activeBg: '#f3f4f6', activeText: '#6b7280' },
};

export default function DashboardHeader({
  companyName,
  userName,
  department,
  isCompanyAdmin,
  onDirectSend,
  onCalendar,
  onResults,
  onAnalysis,
  onLogout,
  onFeatureLocked,
  customerDbEnabled,
  isSubscriptionLocked,
  onSubscriptionLocked,
}: DashboardHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // D53: 캘린더 게이팅 — customer_db_enabled 필요
  const isCalendarLocked = customerDbEnabled === false;

  // ★ D88: 구독 만료 시 잠금 핸들러
  const lockGuard = (handler: () => void) => {
    if (isSubscriptionLocked) { onSubscriptionLocked?.(); return; }
    handler();
  };

  const menuItems: MenuItem[] = [
    { label: 'AI 분석', onClick: () => lockGuard(onAnalysis), color: 'gold', locked: isSubscriptionLocked, path: '/' },
    { label: '자동발송', onClick: () => lockGuard(() => navigate('/auto-send')), color: 'gold', locked: isSubscriptionLocked, path: '/auto-send' },
    { label: '카카오&RCS', onClick: () => navigate('/kakao-rcs'), color: 'green', path: '/kakao-rcs' },
    { label: '직접발송', onClick: onDirectSend, color: 'green', path: '/' },
    { label: '캘린더', onClick: (isSubscriptionLocked || isCalendarLocked)
        ? () => isSubscriptionLocked ? onSubscriptionLocked?.() : onFeatureLocked?.('캘린더', '스타터')
        : onCalendar, color: 'gold', locked: isSubscriptionLocked || isCalendarLocked, path: '/calendar' },
    { label: '발송결과', onClick: onResults, color: 'green', path: '/' },
    { label: '수신거부', onClick: () => navigate('/unsubscribes'), color: 'gold', path: '/unsubscribes' },
    { label: '설정', onClick: () => navigate('/settings'), color: 'green', path: '/settings' },
    ...(isCompanyAdmin
      ? [{ label: '관리', onClick: () => navigate('/manage'), color: 'gold' as MenuColor, path: '/manage' }]
      : []),
    { label: '로그아웃', onClick: onLogout, color: 'gray' as MenuColor },
  ];

  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        {/* 좌측: 회사명 + 사용자 */}
        <div className="cursor-pointer select-none" onClick={() => window.location.reload()}>
          <h1 className="text-xl font-bold text-gray-800">{companyName}</h1>
          <p className="text-sm text-gray-500">
            {userName}
            {department ? ` · ${department}` : ''}
          </p>
        </div>

        {/* 우측: 세션 타이머 + 탭 스타일 메뉴 */}
        <nav className="flex items-center gap-1">
          <SessionTimer />
          {menuItems.map((item, idx) => {
            const cfg = COLOR_CONFIG[item.color];
            const isHovered = hoveredIdx === idx;
            // 현재 페이지 활성 감지 (path가 '/'인 메뉴는 대시보드에서만 활성)
            const isActive = item.path && item.path !== '/'
              ? location.pathname === item.path
              : false;

            // 텍스트 색상: 활성→강조색, 호버→호버색, 기본→회색
            const textColor = item.locked
              ? '#d1d5db'
              : isActive
                ? cfg.activeText
                : isHovered
                  ? cfg.hoverText
                  : cfg.text;

            // 배경색: 활성→활성배경, 호버→호버배경
            const bgColor = item.locked
              ? 'transparent'
              : isActive
                ? cfg.activeBg
                : isHovered
                  ? cfg.hoverBg
                  : 'transparent';

            return (
              <button
                key={item.label}
                onClick={item.onClick}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="px-3.5 py-1.5 text-[13px] rounded-lg transition-all duration-200 flex items-center gap-1 tracking-wide"
                style={{
                  color: textColor,
                  backgroundColor: bgColor,
                  fontWeight: isActive ? 600 : 500,
                }}
              >
                {item.locked && <span className="text-xs">🔒</span>}
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
