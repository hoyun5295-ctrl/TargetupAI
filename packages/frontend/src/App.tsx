import { useEffect, useState, useCallback, createContext, useContext, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { ScrollManager } from './lib/scroll-restoration';
import { useAuthStore, isAgentOnlyCompany } from './stores/authStore';
import { useSessionGuard } from './hooks/useSessionGuard';
import { useSessionTimeout } from './hooks/useSessionTimeout';
import SessionTimeoutModal from './components/SessionTimeoutModal';
// ★ D212+ (2026-05-23 Harold 명시): Toast 알림 영역 — native alert() 영구 폐기 정합
import { ToastProvider } from './components/ToastProvider';
// ★ 2026-07-17 축 A(M1) 번들 스플리팅 — 정적 유지 6개는 "깨지면 사고인 동선"(공개·결제·심사·로그인)이라
//   로딩 방식 변경에서 제외. 나머지 35개 페이지는 lazyPage(페이지별 청크 + 배포 직후 청크 소실 1회 새로고침 가드).
import { lazyPage, prefetchPage, PageErrorBoundary } from './lib/lazy-page';
import LoginPage from './pages/LoginPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
// ★ 2026-07-03: 카페24 앱 실행 랜딩 (심사위원 동선 — 공개 라우트)
import Cafe24LaunchPage from './pages/Cafe24LaunchPage';
// ★ D184 (2026-05-20): 이니시스 결제 결과 fallback 페이지 (새 창 자동 close 차단 시 fallback 표시)
import PaymentResultPage from './pages/PaymentResultPage';
import JourneyPausePage from './pages/JourneyPausePage'; // ★ D218+ Public 정지 페이지 (인증 X)

const AdminDashboard = lazyPage(() => import('./pages/AdminDashboard'));
const AiTrainingDataPage = lazyPage(() => import('./pages/AiTrainingDataPage'));
const BestCopyPage = lazyPage(() => import('./pages/BestCopyPage'));
const Dashboard = lazyPage(() => import('./pages/Dashboard'));
const ManagePage = lazyPage(() => import('./pages/ManagePage'));
const CalendarPage = lazyPage(() => import('./pages/CalendarPage'));
const Settings = lazyPage(() => import('./pages/Settings'));
const Unsubscribes = lazyPage(() => import('./pages/Unsubscribes'));
const PricingPage = lazyPage(() => import('./pages/PricingPage'));
const AutoSendPage = lazyPage(() => import('./pages/AutoSendPage'));
const KakaoRcsPage = lazyPage(() => import('./pages/KakaoRcsPage'));
const DmBuilderPage = lazyPage(() => import('./pages/DmBuilderPage')); // ★ 모바일 DM 빌더
// ★ D130: 슈퍼관리자 알림톡 발신프로필 모니터링 페이지
const AlimtalkSendersPage = lazyPage(() => import('./pages/AlimtalkSendersPage'));
// ★ D163 (2026-05-19) Braze급 SaaS Step 0 — AI Operator placeholder (ENT/BUSINESS 대상 베타)
const AiOperatorPage = lazyPage(() => import('./pages/AiOperatorPage'));
// ★ D172 (2026-05-19): 한줄로 CDP — 자사몰 → 한줄로 sync 설정 페이지
const CdpSettingsPage = lazyPage(() => import('./pages/CdpSettingsPage'));
// ★ D174 (2026-05-19): Step 1 — 성과 리포트 + AI 다음 캠페인 추천
const PerformancePage = lazyPage(() => import('./pages/PerformancePage'));
// ★ D175-A (2026-05-19): Web Push + In-app Message 채널
const PushCampaignsPage = lazyPage(() => import('./pages/PushCampaignsPage'));
const InAppMessagesPage = lazyPage(() => import('./pages/InAppMessagesPage'));
// ★ D176 (2026-05-19): Continuous Agentic Operator (사용자 동의 흐름)
const ContinuousOperatorPage = lazyPage(() => import('./pages/ContinuousOperatorPage'));
// ★ 2026-07-02 4차: 마케팅 캘린더 — 1년 시즌 캠페인 AI 설계
const MarketingCalendarPage = lazyPage(() => import('./pages/MarketingCalendarPage'));
// ★ D178 (2026-05-19): 인바운드 AI 음성 응답 (Naver Clova STT/TTS)
const VoiceInboundPage = lazyPage(() => import('./pages/VoiceInboundPage'));
// ★ D180 (2026-05-19): Email 채널 (SendGrid)
const EmailCampaignsPage = lazyPage(() => import('./pages/EmailCampaignsPage'));
// ★ D181 (2026-05-19): Phase 1 영구 개선 — Memory + Batch + Citations
const AiMemoryPage = lazyPage(() => import('./pages/AiMemoryPage'));
const AiBatchesPage = lazyPage(() => import('./pages/AiBatchesPage'));
const AiExplainPage = lazyPage(() => import('./pages/AiExplainPage'));
const OnboardingWizardPage = lazyPage(() => import('./pages/OnboardingWizardPage')); // ★ D219+ Part 2 온보딩 Wizard 7 step
const SegmentsPage = lazyPage(() => import('./pages/SegmentsPage')); // ★ D220+ Task 6 세그먼트 관리
// ★ D187 (2026-05-20): Journey Builder Lite — 7 표준 여정 + 자연어 진입
const JourneysPage = lazyPage(() => import('./pages/JourneysPage'));
// ★ D192 (2026-05-22): Journey monitoring + 통계 페이지 신규
const JourneyDetailPage = lazyPage(() => import('./pages/JourneyDetailPage'));
const JourneyStatsPage = lazyPage(() => import('./pages/JourneyStatsPage'));
// ★ D197 (2026-05-22) Phase B-2: Predictive Suite 대시보드 — AI 자율 예측 분석
const PredictiveDashboardPage = lazyPage(() => import('./pages/PredictiveDashboardPage'));
// ★ D209+ (2026-05-22) Phase D 비용 안전 — AI 호출 월 한도 + cache 통계 대시보드
const AiUsagePage = lazyPage(() => import('./pages/AiUsagePage'));
const QuickCampaignPage = lazyPage(() => import('./pages/QuickCampaignPage'));
const CampaignAgencyPage = lazyPage(() => import('./pages/CampaignAgencyPage')); // ★ 2026-07-09 CRM 캠페인 대행 접수
const AdminCampaignAgencyPage = lazyPage(() => import('./pages/AdminCampaignAgencyPage')); // ★ 2026-07-09 캠페인 대행 설계

// ★ 세션 타이머 Context — 헤더 등에서 남은 시간 표시용
interface SessionTimerContextType {
  remainingSeconds: number;
  totalSeconds: number;
  extendSession: () => void;
}
export const SessionTimerContext = createContext<SessionTimerContextType>({
  remainingSeconds: 0,
  totalSeconds: 0,
  extendSession: () => {},
});

// ★ 2026-07-03 에이전트(QTmsg) 전용 회사 허용 라우트 — 이 외 전 라우트는 /kakao-rcs로 회수.
//   메뉴 숨김이 아니라 라우트 자체 차단 (URL 직접 입력 누수 방지). 동종 메시징 업체 대시보드 노출 차단이 목적.
const AGENT_ALLOWED_PATHS = ['/kakao-rcs'];

// 인증 필요 라우트
function PrivateRoute({ children, allowedTypes }: { children: React.ReactNode; allowedTypes?: string[] }) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedTypes && user && !allowedTypes.includes(user.userType)) {
    return <Navigate to="/login" replace />;
  }

  // ★ 2026-07-03 에이전트 전용 게이팅 — 허용 목록 외 전부 /kakao-rcs
  if (isAgentOnlyCompany(user) && !AGENT_ALLOWED_PATHS.includes(location.pathname)) {
    return <Navigate to="/kakao-rcs" replace />;
  }

  return <>{children}</>;
}

// 세션 감시 + 강제 로그아웃 모달
function SessionGuard() {
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');

  const handleForceLogout = useCallback((message: string) => {
    setModalMessage(message);
    setShowModal(true);
  }, []);

  useSessionGuard(handleForceLogout);

  const handleConfirm = () => {
    setShowModal(false);
    logout();
    navigate('/login', { replace: true });
  };

  if (!showModal) return null;

  return (
    <>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes zoomIn {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[9999] animate-[fadeIn_0.2s_ease-out]">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
          <div className="px-6 pt-8 pb-2 text-center">
            <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900">세션이 종료되었습니다</h3>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">{modalMessage}</p>
          </div>
          <div className="px-6 pb-6 pt-4">
            <button
              onClick={handleConfirm}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              로그인 페이지로 이동
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// 세션 타임아웃 (비활동 감지 → 자동 로그아웃) + Context Provider
function SessionTimeoutGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useAuthStore();

  const handleSessionLogout = useCallback(() => {
    logout();
    sessionStorage.setItem('forceLogoutReason', '장시간 활동이 없어 자동 로그아웃되었습니다.');
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  const { showWarningModal, remainingSeconds, totalSeconds, extendSession, handleLogout } =
    useSessionTimeout({ onLogout: handleSessionLogout });

  return (
    <SessionTimerContext.Provider value={{ remainingSeconds, totalSeconds, extendSession }}>
      {children}
      {isAuthenticated && (
        <SessionTimeoutModal
          isOpen={showWarningModal}
          remainingSeconds={remainingSeconds}
          onExtend={extendSession}
          onLogout={handleLogout}
        />
      )}
    </SessionTimerContext.Provider>
  );
}

// ★ 2026-07-17 축 A — lazy 페이지 청크 로딩 중 폴백 (다크 톤 + violet 액센트, 페이지 배경과 동일 룩)
function PageLoadingFallback() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
    </div>
  );
}

// ★ Codex 확인 라운드 — 청크 로드가 자동 새로고침 후에도 실패한 경우의 복구 화면 (백지 방지)
function PageLoadError() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
        <h3 className="text-white font-bold text-lg">화면을 불러오지 못했습니다</h3>
        <p className="text-white/50 text-sm mt-2 leading-relaxed">네트워크 상태를 확인한 뒤 다시 시도해 주세요.</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 w-full bg-violet-600 hover:bg-violet-500 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}

function App() {
  const { loadFromStorage, isAuthenticated, user } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadFromStorage();
    setIsLoading(false);
  }, [loadFromStorage]);

  // ★ 2026-07-17 축 A — 로그인 상태면 "실제 착지 라우트"의 청크를 백그라운드 선로딩 (첫 전환 대기 0).
  //   Codex 확인 라운드 정정: super_admin은 /admin·에이전트 전용은 /kakao-rcs로 가므로
  //   무조건 Dashboard(0.86MB)를 받으면 느린 회선에서 실제 필요한 청크와 경합한다.
  useEffect(() => {
    if (!isAuthenticated) return;
    // ★ Codex 확인 라운드: 선로딩은 로그인/루트 착지 흐름에서만 — 딥링크·새로고침(/settings 등)은
    //   실제 목적 라우트 청크가 우선이라 경합시키지 않는다.
    const path = window.location.pathname;
    if (path !== '/' && path !== '/login') return;
    if (user?.userType === 'super_admin') prefetchPage(() => import('./pages/AdminDashboard'));
    else if (isAgentOnlyCompany(user)) prefetchPage(() => import('./pages/KakaoRcsPage'));
    else prefetchPage(() => import('./pages/Dashboard'));
  }, [isAuthenticated, user]);

  if (isLoading) {
    return <div>로딩 중...</div>;
  }

  return (
    <BrowserRouter>
      {/* ★ 2026-07-04: 전역 스크롤 복원 — 뒤로가기(POP)=이전 위치 복원 / 메뉴·신규(PUSH)=최상단(6/28 유지) */}
      <ScrollManager />
      {/* ★ D212+ (2026-05-23 Harold 명시): Toast 알림 영역 — native alert() 영구 폐기 정합 */}
      <ToastProvider>
      {/* 세션 감시 (로그인 상태일 때만 활성) */}
      <SessionGuard />
      <SessionTimeoutGuard>

      {/* ★ 2026-07-17 축 A — lazy 페이지 청크 로딩 경계 (fallback = 다크 스피너) + 지속 실패 복구 화면 */}
      <PageErrorBoundary fallback={<PageLoadError />}>
      <Suspense fallback={<PageLoadingFallback />}>
      <Routes>
        {/* 로그인 */}
        <Route path="/login" element={<LoginPage />} />

        {/* 슈퍼관리자 */}
        <Route
          path="/admin"
          element={
            <PrivateRoute allowedTypes={['super_admin']}>
              <AdminDashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="/admin/ai-training"
          element={
            <PrivateRoute allowedTypes={['super_admin']}>
              <AiTrainingDataPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/admin/best-copy"
          element={
            <PrivateRoute allowedTypes={['super_admin']}>
              <BestCopyPage />
            </PrivateRoute>
          }
        />

        {/* ★ D152: FlyerAdminDashboard 라우트 제거 — hanjulDM 분리. admin.hanjuldm.kr 별도 도메인 */}

        {/* 고객사 대시보드 */}
        <Route
          path="/dashboard"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <Dashboard />
            </PrivateRoute>
          }
        />

        {/* 고객사 관리자 전용 — 관리 페이지 */}
        <Route
          path="/manage"
          element={
            <PrivateRoute allowedTypes={['company_admin']}>
              <ManagePage />
            </PrivateRoute>
          }
        />

        {/* 캘린더 */}
        <Route
          path="/calendar"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <CalendarPage />
            </PrivateRoute>
          }
        />

        {/* 기본 리다이렉트 */}
        <Route
          path="/"
          element={
            // ★ 2026-07-03: 과거 App URL(루트)로 mall_id 쿼리 진입 대비 — 쿼리 보존해 카페24 랜딩으로
            new URLSearchParams(window.location.search).get('mall_id') ? (
              <Navigate to={`/cafe24/launch${window.location.search}`} replace />
            ) : isAuthenticated ? (
              user?.userType === 'super_admin' ? (
                <Navigate to="/admin" replace />
              ) : isAgentOnlyCompany(user) ? (
                // ★ 2026-07-03 에이전트 전용 회사 — 카카오&RCS 랜딩
                <Navigate to="/kakao-rcs" replace />
              ) : (
                <Navigate to="/dashboard" replace />
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        {/* D69: 자동발송 */}
        <Route
          path="/auto-send"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <AutoSendPage />
            </PrivateRoute>
          }
        />

        {/* 채널 확장: 카카오&RCS */}
        <Route
          path="/kakao-rcs"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <KakaoRcsPage />
            </PrivateRoute>
          }
        />

        {/* ★ D163 (2026-05-19) Braze급 SaaS Step 0 — AI Operator placeholder.
            메뉴 게이팅(isBetaAccessAllowed)은 Dashboard.tsx에서 처리. URL 직접 진입은 placeholder 노출. */}
        <Route
          path="/ai-operator"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <AiOperatorPage />
            </PrivateRoute>
          }
        />

        {/* ★ D172 (2026-05-19): 자사몰 연동 (CDP) 설정 — BUSINESS+ */}
        <Route
          path="/cdp-settings"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <CdpSettingsPage />
            </PrivateRoute>
          }
        />

        {/* ★ D174 (2026-05-19): 성과 리포트 + AI 다음 캠페인 추천 — BUSINESS+ 베타 */}
        <Route
          path="/performance"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <PerformancePage />
            </PrivateRoute>
          }
        />

        {/* ★ D175-A (2026-05-19): Web Push 캠페인 — BUSINESS+ 베타 */}
        <Route
          path="/push-campaigns"
          element={
            <PrivateRoute allowedTypes={['company_admin']}>
              <PushCampaignsPage />
            </PrivateRoute>
          }
        />

        {/* ★ D175-A (2026-05-19): In-app Message 관리 — BUSINESS+ 베타 */}
        <Route
          path="/inapp-messages"
          element={
            <PrivateRoute allowedTypes={['company_admin']}>
              <InAppMessagesPage />
            </PrivateRoute>
          }
        />

        {/* ★ D176 (2026-05-19): Continuous Agentic Operator — BUSINESS+ 베타 */}
        <Route
          path="/continuous-operator"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <ContinuousOperatorPage />
            </PrivateRoute>
          }
        />
        {/* ★ 2026-07-02 4차: 마케팅 캘린더 — 1년 시즌 캠페인 AI 설계 → 자동마케팅 등록 */}
        <Route
          path="/marketing-calendar"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <MarketingCalendarPage />
            </PrivateRoute>
          }
        />

        {/* ★ D178 (2026-05-19): 인바운드 AI 음성 응답 — BUSINESS+ 베타 (회사 admin) */}
        <Route
          path="/voice-inbound"
          element={
            <PrivateRoute allowedTypes={['company_admin']}>
              <VoiceInboundPage />
            </PrivateRoute>
          }
        />

        {/* ★ D180 (2026-05-19): Email 캠페인 (SendGrid) — BUSINESS+ 베타 (회사 admin) */}
        <Route
          path="/email-campaigns"
          element={
            <PrivateRoute allowedTypes={['company_admin']}>
              <EmailCampaignsPage />
            </PrivateRoute>
          }
        />

        {/* ★ D181 (2026-05-19): AI 학습 메모리 (Anthropic Memory tool 패턴) */}
        <Route
          path="/ai-memory"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <AiMemoryPage />
            </PrivateRoute>
          }
        />

        {/* ★ D181 (2026-05-19): AI Batch (50% 비용 절감) */}
        <Route
          path="/ai-batches"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <AiBatchesPage />
            </PrivateRoute>
          }
        />

        {/* ★ D181 (2026-05-19): AI에게 질문 (Citations 근거 인용) */}
        <Route
          path="/ai-explain"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <AiExplainPage />
            </PrivateRoute>
          }
        />

        {/* ★ D219+ Part 2 (2026-05-27): AI 오퍼레이션 무료체험 사용자 온보딩 Wizard 7 step */}
        <Route
          path="/onboarding"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <OnboardingWizardPage />
            </PrivateRoute>
          }
        />
        {/* ★ D220+ Task 6 (2026-05-27): 고객 세그먼트 관리 메뉴 — Braze 동급 자산 */}
        <Route
          path="/segments"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <SegmentsPage />
            </PrivateRoute>
          }
        />
        {/* ★ D187 (2026-05-20): Journey Builder Lite — 7 표준 여정 + 자연어 진입 */}
        <Route
          path="/ai-journeys"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <JourneysPage />
            </PrivateRoute>
          }
        />
        {/* ★ D192 (2026-05-22): Journey 상세 — 진입 사용자 리스트 + step별 진행 매트릭스 */}
        <Route
          path="/ai-journeys/:id"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <JourneyDetailPage />
            </PrivateRoute>
          }
        />
        {/* ★ D192 (2026-05-22): Journey 통계 — 전체 통계 + 등급별 + 시간대 + 요일 + Variant Bandit */}
        <Route
          path="/ai-journeys/:id/stats"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <JourneyStatsPage />
            </PrivateRoute>
          }
        />
        {/* ★ D197 (2026-05-22) Phase B-2: Predictive Suite 대시보드 */}
        <Route
          path="/predictive"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <PredictiveDashboardPage />
            </PrivateRoute>
          }
        />

        {/* ★ D209+ (2026-05-22) Phase D 비용 안전 매트릭스 — AI 호출 월 한도 + cache 통계 */}
        <Route
          path="/ai-usage"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <AiUsagePage />
            </PrivateRoute>
          }
        />

        {/* ★ 2026-07-08 원클릭 캠페인 (행사·이미지 → DM·이메일·인앱 초안) */}
        <Route
          path="/quick-campaign"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <QuickCampaignPage />
            </PrivateRoute>
          }
        />

        {/* ★ 2026-07-09 CRM 캠페인 대행 — 고객사 접수(비즈니스+ 게이트는 페이지/백엔드 이중) + 슈퍼관리자 설계 */}
        <Route
          path="/campaign-agency"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <CampaignAgencyPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/admin/campaign-agency"
          element={
            <PrivateRoute allowedTypes={['super_admin']}>
              <AdminCampaignAgencyPage />
            </PrivateRoute>
          }
        />

        {/* ★ D130: 발신프로필 관리 (슈퍼관리자) */}
        <Route
          path="/admin/alimtalk-senders"
          element={
            <PrivateRoute allowedTypes={['super_admin']}>
              <AlimtalkSendersPage />
            </PrivateRoute>
          }
        />

        {/* ★ 모바일 DM 빌더 (프로 요금제 이상) */}
        <Route
          path="/dm-builder"
          element={
            <PrivateRoute allowedTypes={['company_admin', 'company_user']}>
              <DmBuilderPage />
            </PrivateRoute>
          }
        />

        <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
        <Route path="/unsubscribes" element={<PrivateRoute><Unsubscribes /></PrivateRoute>} />
        <Route path="/pricing" element={<PrivateRoute><PricingPage /></PrivateRoute>} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        {/* ★ 2026-07-03 카페24 앱 실행 랜딩 (심사위원 동선) — 공개, 페이지가 로그인 3분기 판별 */}
        <Route path="/cafe24/launch" element={<Cafe24LaunchPage />} />
        {/* D184: 이니시스 결제 결과 fallback (인증 X — 새 창 자동 close 차단 시 표시) */}
        <Route path="/payment/result" element={<PaymentResultPage />} />

        {/* ★ D218+ (2026-05-26): 여정 발송 2시간 전 담당자 알림 안 단축 URL 진입 페이지 (인증 X) */}
        <Route path="/journey-pause/:token" element={<JourneyPausePage />} />

        {/* 404 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </PageErrorBoundary>
      </SessionTimeoutGuard>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
