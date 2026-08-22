import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LifeBuoy } from 'lucide-react';
import SessionTimer from './SessionTimer';
import { toggleHelp, useHelpEligible } from '../lib/help-open';
import { HELP_HEADER_BTN } from './help/help-ui';

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
  // ★ 2026-08-20 상위 등급 게이트 — 판정 원천 = 서버 plans.advanced_access_enabled 하나(my-plan 응답).
  //   그전에는 planCode === 'BUSINESS'/'ENTERPRISE' 하드코딩이라, 플래그를 켠 임직원 요금제(STAFF)가
  //   서버 API는 통과하는데 메뉴만 안 떴다(plan-guard 0728 전환 사유가 여기서 재현). 코드 비교 금지.
  advancedAccess?: boolean;
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
  advancedAccess,
  onAiOperatorClick,
}: DashboardHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  // 도움말 대상 여부는 서버가 판정해 HelpDock이 받아 둔 것을 읽기만 한다. 헤더가 요금제를 따로 조회하지 않는다
  const helpEligible = useHelpEligible();

  // D53: 캘린더 게이팅 — customer_db_enabled 필요
  const isCalendarLocked = customerDbEnabled === false;

  // ★ D88: 구독 만료 시 잠금 핸들러
  const lockGuard = (handler: () => void) => {
    if (isSubscriptionLocked) { onSubscriptionLocked?.(); return; }
    handler();
  };

  // ★ 2026-07-20 (Harold 확정): 카카오&RCS ENTERPRISE 게이팅 제거 — 전 요금제 개방.
  //   ENTERPRISE 한정은 내부 검증용 임시 조치였고, 알림톡은 직접발송 모달에도 이미 진입점이 있어 막을 이유가 없다.
  //   같이 묶였던 자동발송은 D188에서 메뉴 자체가 제거돼(위 주석) 이 게이트를 쓰는 곳은 0이 됐다 → 기계 전체 제거.
  //   구독 만료·정지 차단(subscriptionGuard)은 별개로 유지된다.

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
      onClick: () => navigate('/kakao-rcs'),
      color: 'green',
      path: '/kakao-rcs',
    },
    // ★ 2026-08-22 '고객' 메뉴는 두지 않는다(Harold 확정) — 헤더가 이미 길고,
    //   진입은 대시보드 "DB 현황" 카드의 상세보기 하나로 충분하다. 진입점을 늘리지 않는다.
    { label: '직접발송', onClick: onDirectSend, color: 'green', path: '/' },
    // ★ D162-4 (2026-05-15) 2차: Harold님 명시 정합 — DashboardHeader 메뉴에서 '알림톡 발송' 제거.
    //   직접발송/직접타겟발송 모달 헤더 안에서 알림톡 모달 진입 (카카오 노란색 버튼). 메뉴 분리 시 사용자 혼란 차단.
    //   onAlimtalkSend prop은 호환성 위해 유지 (Dashboard에서 직접발송/타겟발송 → 알림톡 모달 진입 callback).
    // ★ 2026-06-08 (Harold 명시): 고객 세그먼트 메뉴는 AI Operator 서브메뉴(SUB_MODULE_CARDS)로 이동.
    //   AI Operator가 모든 유료 요금제 크레딧 사용으로 전환되어 접근 회귀 없음. aiMessagingEnabled prop은 호환성 위해 유지.
    { label: '발송결과', onClick: onResults, color: 'green', path: '/' },
    // ★ 2026-07-09 CRM 캠페인 대행 — 상위 등급 전용 특별 서비스. 미만 요금제 = 메뉴 자체 비노출 (Harold 명시).
    //   ★ 2026-08-20 판정을 서버 플래그(advanced_access_enabled)로 — 코드 하드코딩이 STAFF 4개사를 막고 있었다.
    ...(advancedAccess
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

        {/* 우측: 도움말 + 세션 타이머 + 메뉴 — 모바일에서는 가로 스크롤 */}
        <nav className="flex items-center gap-1 overflow-x-auto w-full md:w-auto -mx-3 px-3 md:mx-0 md:px-0 scrollbar-thin">
          {/* ★ 2026-08-22(2) 도움말 진입점 — 타이머 옆(Harold: 회사명이 길면 업체명 옆 자리는 밀린다).
              ⛔ 메뉴 목록(menuItems)에 넣지 않는다 — "헤더에 메뉴를 늘리지 않는다"는 확정은 유지된다. 이건 메뉴가 아니라 유틸리티다.
              열림 상태는 우하단 런처와 공유한다(lib/help-open.ts) — 진입점이 둘이어도 창은 하나다. */}
          {helpEligible && (
            <button
              type="button"
              onClick={toggleHelp}
              className={`${HELP_HEADER_BTN} mr-1.5 md:mr-2`}
              aria-label="도움말 열기"
            >
              <LifeBuoy className="w-3.5 h-3.5" strokeWidth={2.2} />
              궁금한 건 물어보세요
            </button>
          )}
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

    </header>
  );
}
