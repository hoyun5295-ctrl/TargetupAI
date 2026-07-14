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
  // ★ D220+ Task 8 (2026-05-27): ai_messaging 게이팅 — BASIC+ 영역 (세그먼트 메뉴 등)
  aiMessagingEnabled?: boolean;
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

// ★ D222+ Phase 1 (2026-05-27): AI Operator 메뉴 제거. 2026-07-05 매뉴얼 메뉴 → 푸터 이동(Dashboard.tsx).
//   'new' 색상 = 신규 메뉴 강조 (그라데이션 violet→fuchsia, 현재 'AI Operator 소개').
type MenuColor = 'green' | 'gold' | 'gray' | 'beta' | 'new';

interface MenuItem {
  label: string;
  onClick: () => void;
  color: MenuColor;
  emphasized?: boolean;
  locked?: boolean;
  betaBadge?: boolean; // ★ D163: BETA 뱃지 노출 (AI Operator 등 베타 메뉴)
  newBadge?: boolean; // ★ D222+ Phase 1: NEW 뱃지 노출 (매뉴얼 등 신규 메뉴)
  path?: string; // 현재 페이지 활성 감지용
}

// ★ D95: 필(pill) 스타일 메뉴 — 밑줄 제거, 호버/강조 시 배경색
// ★ D163: 'beta' 색상 추가 — AI Operator 등 베타 메뉴 강조 (그라데이션 amber→fuchsia)
// ★ D222+ Phase 1: 'new' 색상 추가 — 매뉴얼 등 신규 메뉴 강조 (violet 톤)
const COLOR_CONFIG: Record<MenuColor, { text: string; hoverText: string; hoverBg: string; activeBg: string; activeText: string }> = {
  green: { text: '#4b5563', hoverText: '#15803d', hoverBg: '#f0fdf4', activeBg: '#ecfdf5', activeText: '#15803d' },
  gold:  { text: '#4b5563', hoverText: '#b45309', hoverBg: '#fffbeb', activeBg: '#fef3c7', activeText: '#b45309' },
  gray:  { text: '#9ca3af', hoverText: '#6b7280', hoverBg: '#f3f4f6', activeBg: '#f3f4f6', activeText: '#6b7280' },
  beta:  { text: '#4b5563', hoverText: '#a21caf', hoverBg: '#fdf4ff', activeBg: '#fae8ff', activeText: '#a21caf' },
  new:   { text: '#4b5563', hoverText: '#7c3aed', hoverBg: '#f5f3ff', activeBg: '#ede9fe', activeText: '#7c3aed' },
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
  aiMessagingEnabled,
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
    // ★ D222+ Phase 1 (2026-05-27): AI Operator (BETA) 메뉴 영구 제거 — Dashboard 우측 카드 "AI Operator" 라벨 통합 진입.
    //   onAiOperatorClick prop = 호환성 유지 (Dashboard 우측 카드 클릭 callback). 헤더 메뉴 영역 = 제거.
    // ★ 2026-07-05 (Harold 명시): 헤더 '매뉴얼' 메뉴 제거 → 하단 푸터 링크로 복귀 (Dashboard.tsx 푸터). 헤더 간소화.
    // ★ AI Operator 소개 — about-ai-operator.html 새 탭 진입. 모든 요금제 공통(게이팅 없음).
    {
      label: 'AI Operator 소개',
      onClick: () => window.open('/about-ai-operator.html?v=4', '_blank', 'noopener'), // ?v= 캐시 버스터 — LoginPage 2곳과 동시 관리
      color: 'new',
    },
    // ★ D188 Phase 2-B-4 (2026-05-21) 자동발송 메뉴 영구 제거 — Harold 명시 "사용 고객사 0 + 여정 빌더가 진짜 업그레이드".
    //   /auto-send 라우트 진입 시 AutoSendPage.tsx가 여정 빌더 안내 페이지로 노출. auto_campaigns 운영 데이터는 보존 (worker 유지).
    // ★ D182 (2026-05-19): 모바일DM 헤더 메뉴 영구 제거 — AI Operator 페이지 안 SUB_MODULE_CARDS로 이동 (Harold 명시 — 헤더 간소화)
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
    // ★ 2026-06-08 (Harold 명시): 고객 세그먼트 메뉴는 AI Operator 서브메뉴(SUB_MODULE_CARDS)로 이동.
    //   AI Operator가 모든 유료 요금제 크레딧 사용으로 전환되어 접근 회귀 없음. aiMessagingEnabled prop은 호환성 위해 유지.
    { label: '발송결과', onClick: onResults, color: 'green', path: '/' },
    // ★ 2026-07-09 CRM 캠페인 대행 — 비즈니스+ 전용 특별 서비스. 미만 요금제 = 메뉴 자체 비노출 (Harold 명시).
    ...(planCode === 'BUSINESS' || planCode === 'ENTERPRISE'
      ? [{ label: '캠페인 대행', onClick: () => navigate('/campaign-agency'), color: 'new' as MenuColor, path: '/campaign-agency' }]
      : []),
    { label: '수신거부', onClick: () => navigate('/unsubscribes'), color: 'gold', path: '/unsubscribes' },
    // ★ 2026-07-09 (Harold 지시): 'AI 사용량' 헤더 메뉴 제거 — 요금제 미가입 사용자가 다수인 헤더에 둘 이유 없음.
    //   진입은 AI 학습 메모리(/ai-memory) 상단 서브메뉴로 이동 (AiMemoryPage 헤더 버튼).
    { label: '설정', onClick: () => navigate('/settings'), color: 'green', path: '/settings' },
    ...(isCompanyAdmin
      ? [{ label: '관리', onClick: () => navigate('/manage'), color: 'gold' as MenuColor, path: '/manage' }]
      : []),
    { label: '로그아웃', onClick: onLogout, color: 'gray' as MenuColor },
  ];

  return (
    <header className="bg-white border-b border-gray-200">
      {/* D186 Phase 1.5: 모바일 stacked + 데스크탑 좌우 분할 */}
      <div className="max-w-7xl mx-auto px-3 md:px-4 py-2 md:py-4 flex flex-col md:flex-row md:justify-between md:items-center gap-2 md:gap-0">
        {/* 좌측: 회사명 + 사용자 — 모바일에서는 한 줄 컴팩트 */}
        <div className="cursor-pointer select-none flex md:block items-center gap-2 shrink-0" onClick={() => window.location.reload()}>
          <h1 className="text-base md:text-xl font-bold text-gray-800 truncate max-w-[200px] md:max-w-none">{companyName}</h1>
          <p className="text-xs md:text-sm text-gray-500 truncate">
            {userName}
            {department ? ` · ${department}` : ''}
          </p>
        </div>

        {/* 우측: 세션 타이머 + 메뉴 — 모바일에서는 가로 스크롤 */}
        <nav className="flex items-center gap-1 overflow-x-auto w-full md:w-auto -mx-3 px-3 md:mx-0 md:px-0 scrollbar-thin">
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
                className="px-2.5 md:px-3.5 py-1.5 text-[12px] md:text-[13px] rounded-lg transition-all duration-200 flex items-center gap-1.5 tracking-wide flex-shrink-0 whitespace-nowrap"
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
                {item.newBadge && (
                  <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-sm">
                    NEW
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
