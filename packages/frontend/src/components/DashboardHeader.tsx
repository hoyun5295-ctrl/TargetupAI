import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import SessionTimer from './SessionTimer';

interface DashboardHeaderProps {
  companyName: string;
  userName: string;
  department?: string;
  isCompanyAdmin: boolean;
  onDirectSend: () => void;
  // ★ D162-4 (2026-05-15) 2차: Harold님 명시 — DashboardHeader 메뉴에서 '알림톡 발송' 제거.
  //   직접발송/직접타겟발송 모달 내부 버튼으로 진입. 본 prop은 호환성 차 optional 유지 (외부 호출 가능).
  onAlimtalkSend?: () => void;
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
  // ★ ENTERPRISE 전용 기능 게이팅 (자동발송, 카카오&RCS)
  planCode?: string;
  // ★ D163 (2026-05-19) Braze급 SaaS Step 0 — AI Operator 베타 메뉴.
  //   클릭 시 Dashboard.tsx에서 isBetaAccessAllowed 게이팅:
  //   ENTERPRISE/BUSINESS = /ai-operator 진입 / 그 외 = BetaFeatureModal 표시.
  onAiOperatorClick?: () => void;
}

type MenuColor = 'green' | 'gold' | 'gray' | 'beta';

interface MenuItem {
  label: string;
  onClick: () => void;
  color: MenuColor;
  emphasized?: boolean;
  locked?: boolean;
  betaBadge?: boolean; // ★ D163: BETA 뱃지 노출 (AI Operator 등 베타 메뉴)
  path?: string; // 현재 페이지 활성 감지용
}

// ★ D95: 필(pill) 스타일 메뉴 — 밑줄 제거, 호버/강조 시 배경색
// ★ D163: 'beta' 색상 추가 — AI Operator 등 베타 메뉴 강조 (그라데이션 amber→fuchsia)
const COLOR_CONFIG: Record<MenuColor, { text: string; hoverText: string; hoverBg: string; activeBg: string; activeText: string }> = {
  green: { text: '#4b5563', hoverText: '#15803d', hoverBg: '#f0fdf4', activeBg: '#ecfdf5', activeText: '#15803d' },
  gold:  { text: '#4b5563', hoverText: '#b45309', hoverBg: '#fffbeb', activeBg: '#fef3c7', activeText: '#b45309' },
  gray:  { text: '#9ca3af', hoverText: '#6b7280', hoverBg: '#f3f4f6', activeBg: '#f3f4f6', activeText: '#6b7280' },
  beta:  { text: '#4b5563', hoverText: '#a21caf', hoverBg: '#fdf4ff', activeBg: '#fae8ff', activeText: '#a21caf' },
};

export default function DashboardHeader({
  companyName,
  userName,
  department,
  isCompanyAdmin,
  onDirectSend,
  onAlimtalkSend,
  onCalendar,
  onResults,
  onAnalysis,
  onLogout,
  onFeatureLocked,
  customerDbEnabled,
  isSubscriptionLocked,
  onSubscriptionLocked,
  planCode,
  onAiOperatorClick,
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

  // ★ ENTERPRISE 전용 게이팅 — 자동발송 / 카카오&RCS
  //   planCode가 아직 로드되지 않았으면(undefined/'') 잠금 표시 보류
  const isEnterprise = planCode === 'ENTERPRISE';
  const isEnterpriseLocked = !!planCode && !isEnterprise;
  const [enterpriseModal, setEnterpriseModal] = useState<{ show: boolean; featureName: string; description: string }>({ show: false, featureName: '', description: '' });
  const enterpriseGuard = (featureName: string, description: string, handler: () => void) => {
    if (isEnterpriseLocked) {
      setEnterpriseModal({ show: true, featureName, description });
      return;
    }
    handler();
  };

  const menuItems: MenuItem[] = [
    // ★ D163 (2026-05-19) Braze급 SaaS Step 0 — AI Operator 베타 메뉴.
    // ★ D177-ux2 (2026-05-19) Harold 명시 정정 — dropdown 박지 X, AI Operator 페이지 안에 sub-menu 박음.
    //   메뉴 깊이 박힌 영역에 신규 기능 노출 = 영업/노출 정합. 헤더에는 AI Operator 메뉴만 박음.
    ...(onAiOperatorClick
      ? [{
          label: 'AI Operator',
          onClick: onAiOperatorClick,
          color: 'beta' as MenuColor,
          betaBadge: true,
          path: '/ai-operator',
        }]
      : []),
    {
      label: '자동발송',
      onClick: () => enterpriseGuard('자동발송', '반복 발송 스케줄을 설정하면 자동으로 메시지가 발송됩니다.',
        () => lockGuard(() => navigate('/auto-send'))),
      color: 'gold',
      locked: isEnterpriseLocked || isSubscriptionLocked,
      path: '/auto-send',
    },
    { label: '모바일DM', onClick: () => lockGuard(() => navigate('/dm-builder')), color: 'gold', locked: isSubscriptionLocked, path: '/dm-builder' },
    {
      label: '카카오&RCS',
      onClick: () => enterpriseGuard('카카오 & RCS', '알림톡 템플릿 · 브랜드메시지 · RCS 통합 관리 기능입니다.',
        () => navigate('/kakao-rcs')),
      color: 'green',
      locked: isEnterpriseLocked,
      path: '/kakao-rcs',
    },
    { label: '직접발송', onClick: onDirectSend, color: 'green', path: '/' },
    // ★ D162-4 (2026-05-15) 2차: Harold님 명시 정합 — DashboardHeader 메뉴에서 '알림톡 발송' 제거.
    //   직접발송/직접타겟발송 모달 헤더 안에서 알림톡 모달 진입 (카카오 노란색 버튼). 메뉴 분리 시 사용자 혼란 차단.
    //   onAlimtalkSend prop은 호환성 위해 유지 (Dashboard에서 직접발송/타겟발송 → 알림톡 모달 진입 callback).
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
                className="px-3.5 py-1.5 text-[13px] rounded-lg transition-all duration-200 flex items-center gap-1.5 tracking-wide"
                style={{
                  color: textColor,
                  backgroundColor: bgColor,
                  fontWeight: isActive ? 600 : 500,
                }}
              >
                {item.locked && <span className="text-xs">🔒</span>}
                {item.label}
                {item.betaBadge && (
                  <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-500 text-white shadow-sm">
                    BETA
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ★ 베타테스트 잠금 안내 모달 */}
      {enterpriseModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6">
            <div className="text-center">
              <div className="text-4xl mb-3">🧪</div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{enterpriseModal.featureName}</h3>
              <p className="text-xs text-gray-500 mb-4">{enterpriseModal.description}</p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5">
                <p className="text-sm text-gray-700">
                  현재 <span className="font-bold text-amber-700">베타테스트 진행 중</span>입니다.<br />
                  테스트 완료 후 사용 가능합니다.
                </p>
              </div>
              <button
                onClick={() => setEnterpriseModal({ show: false, featureName: '', description: '' })}
                className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
