import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface DashboardHeaderProps {
  companyName: string;
  userName: string;
  department?: string;
  isCompanyAdmin: boolean;
  onDirectSend: () => void;
  onCalendar: () => void;
  onResults: () => void;
  onLogout: () => void;
}

type MenuColor = 'green' | 'gold' | 'gray';

interface MenuItem {
  label: string;
  onClick: () => void;
  color: MenuColor;
  emphasized?: boolean;
}

const COLOR_CONFIG: Record<MenuColor, { normal: string; hover: string; bar: string }> = {
  green: { normal: '#4b5563', hover: '#15803d', bar: '#16a34a' },
  gold:  { normal: '#4b5563', hover: '#b45309', bar: '#d97706' },
  gray:  { normal: '#9ca3af', hover: '#6b7280', bar: '#9ca3af' },
};

const EMPHASIZED_COLOR: Record<string, string> = {
  green: '#15803d',
  gold: '#b45309',
};

export default function DashboardHeader({
  companyName,
  userName,
  department,
  isCompanyAdmin,
  onDirectSend,
  onCalendar,
  onResults,
  onLogout,
}: DashboardHeaderProps) {
  const navigate = useNavigate();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const menuItems: MenuItem[] = [
    { label: '직접발송', onClick: onDirectSend, color: 'green', emphasized: true },
    { label: '캘린더', onClick: onCalendar, color: 'gold' },
    { label: '발송결과', onClick: onResults, color: 'green' },
    { label: '수신거부', onClick: () => navigate('/unsubscribes'), color: 'gold' },
    { label: '설정', onClick: () => navigate('/settings'), color: 'green' },
    ...(isCompanyAdmin
      ? [{ label: '관리', onClick: () => navigate('/manage'), color: 'gold' as MenuColor, emphasized: true }]
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

        {/* 우측: 탭 스타일 메뉴 */}
        <nav className="flex items-center">
          {menuItems.map((item, idx) => {
            const cfg = COLOR_CONFIG[item.color];
            const isHovered = hoveredIdx === idx;
            const isEmphasized = !!item.emphasized;

            // 텍스트 색상: 강조→항상 색상, 호버→hover색, 기본→normal색
            const textColor = isHovered
              ? cfg.hover
              : isEmphasized
                ? EMPHASIZED_COLOR[item.color] || cfg.normal
                : cfg.normal;

            // 밑줄 너비: 강조→항상 표시, 호버→표시
            const barWidth = isEmphasized || isHovered ? '60%' : '0%';

            return (
              <button
                key={item.label}
                onClick={item.onClick}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="relative px-4 py-2 text-sm transition-colors duration-200"
                style={{
                  color: textColor,
                  fontWeight: isEmphasized ? 600 : 400,
                }}
              >
                {item.label}
                {/* 밑줄 애니메이션 */}
                <span
                  className="absolute bottom-0 left-1/2 h-[2px] rounded-full"
                  style={{
                    transform: 'translateX(-50%)',
                    width: barWidth,
                    backgroundColor: cfg.bar,
                    transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                />
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
