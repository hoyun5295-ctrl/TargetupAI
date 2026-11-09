import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { formatDate } from '../utils/formatDate';
import { isCustomerSelectablePlan } from '../utils/planLabel'; // ★ 2026-07-28 내부 요금제(임직원 등) 노출 차단 — 단일 소스
import { COMPANY_PHONE, COMPANY_PHONE_TEL } from '../constants/company';
import CreditSummaryBar from '../components/credit/CreditSummaryBar';
import CreditRechargeModal from '../components/credit/CreditRechargeModal';
import PrepaidTermCard, { prepaidTermRequestNote, type PrepaidTermView } from '../components/PrepaidTermCard';
import BalanceModals from '../components/BalanceModals';
import { PLAN_INFRA, planBonusPct, dailyDbAnalysisCredits } from '../constants/credit';
import { useToast } from '../components/ToastProvider';
import { goBackOr } from '../lib/scroll-restoration';

interface Plan {
  id: string;
  plan_code: string;
  plan_name: string;
  max_customers: number;
  monthly_price: number;
  is_active: boolean;
  ai_credits_per_month?: number;
}

interface CompanyInfo {
  plan_id: string;
  plan_name: string;
  plan_code: string;
  max_customers: number;
  current_customers: number;
  created_at: string;
  trial_expires_at: string | null;
  is_trial_expired: boolean;
  // ★ CT-17 (2026-04-22)
  subscription_status?: string | null; // 'trial' | 'trial_expired' | 'paid' | 'expired' | 'suspended' (※ 'active'는 네이밍 충돌로 2026-04-22 폐지, 'paid'로 통일)
  monthly_price?: number;
  // ★ 2026-10-04 선불 요금제 이용 기간(관리 대상이 아니면 null)
  prepaid_term?: PrepaidTermView | null;
}

/** ★ 2026-08-05 요금제 무료 메시징 — `GET /api/companies/my-free-messaging` 응답 */
interface FreeMessagingLine {
  type: string;
  label: string;
  granted: number;
  used: number;
  remaining: number;
}
interface FreeMessagingInfo {
  available: boolean;
  periodMonth: string | null;
  lines: FreeMessagingLine[];
  /** 요금제코드 → 유형별 제공 수량 */
  planQuotas: Record<string, Record<string, number>>;
}

/** 유형 표시 순서·이름은 서버 축(`FREE_MESSAGING_TYPES`)이 정한다 — 여기서 다시 정의하지 않는다. */
const FREE_TYPE_LABEL: Record<string, string> = { SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', KAKAO: '알림톡' };

/** 미사용분 소멸·차감 시점을 한 줄로 알린다(설계 §5-1-A 정직성 요구) — 두 화면이 같은 문구를 쓴다(요금제 비교 각주 · 크레딧 요약 카드). */
const FREE_MESSAGING_NOTE = '무료 메시지는 매월 제공됩니다. 발송을 시도할 때 차감되고, 남은 수량은 다음 달로 넘어가지 않습니다.';

/**
 * ★ 2026-11-09 요금제 비교 카드 아래 운영 방식(시안 = marketing/proposals/2026-11-hanjul-proposal/pricing-plans.html).
 *   전용 등급(PLAN_INFRA.premium = 비즈니스 이상) = 캠페인 대행 운영 포함(Harold 1105) · 대행 항목에서 「기획」 뺌(Harold 1109).
 */
const PLAN_OPERATION = {
  self: { title: '직접 운영', items: ['AI가 대상과 문안을 정하고', '담당자가 확인하고 보냅니다', '전 채널을 한 화면에서 보냅니다'] },
  agency: { title: '캠페인 대행 운영 포함', items: ['전담 담당자 배정', '제작, 발송, 여정 운영', '매달 성과 리포트'] },
};
const AGENCY_SCOPE_NOTE = '캠페인 대행 운영의 한 달 운영 범위(캠페인 수와 채널)는 계약 때 함께 정합니다. 승인 없는 발송은 없습니다.';
const BONUS_NOTE = '크레딧 옆 %는 월 요금 대비 더 드리는 AI 크레딧입니다.';
const ANALYSIS_NOTE = 'DB 분석 차감은 지금 고객 DB 수로 계산한 한 달 값(×30일)입니다. 고객 DB가 늘거나 줄면 함께 바뀝니다.';
/** DB 분석 차감 한 달 환산 일수 — 요금제 카드 · 가로띠 · 아래 DB 규모별 표가 같은 값을 쓴다. */
const MONTH_DAYS = 30;
const PLAN_BTN = 'h-11 w-full rounded-xl text-[14px] font-bold transition-colors';

export default function PricingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, isAuthenticated } = useAuthStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [myCredit, setMyCredit] = useState<any>(null);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [requestMessage, setRequestMessage] = useState('');
  /** ★ 2026-10-20 여정 V.3 §5-5 — 켜 둔 여정이 한 달에 쓰는 크레딧이 바꿀 요금제 기본보다 많을 때 서버가 돌려준 숫자(신청 창 안에서 한 번 확인). */
  const [journeyCreditWarn, setJourneyCreditWarn] = useState<{ total: number; basis: string; lineages: number; autoMarketing: number; planCredits: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successModalType, setSuccessModalType] = useState<'plan' | 'inquiry'>('plan');
  const [showContactModal, setShowContactModal] = useState(false);
  const [showRecharge, setShowRecharge] = useState(false);
  // ★ 2026-10-04 선불 이용 기간 카드의 [잔액 충전] — 대시보드와 같은 충전 창을 이 페이지에서 바로 연다(다른 화면으로 보내지 않는다)
  const [showBalanceCharge, setShowBalanceCharge] = useState(false);
  const [showBalanceInfo, setShowBalanceInfo] = useState(false);
  const [insufficientInfo, setInsufficientInfo] = useState<{ show: boolean; balance: number; required: number } | null>(null);
  const [inquiryForm, setInquiryForm] = useState({
    companyName: '', contactName: '', phone: '', email: '', planInterest: '', subject: '', message: '',
  });
  const [inquirySubmitting, setInquirySubmitting] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [pendingPlanName, setPendingPlanName] = useState('');
  const [unconfirmedResult, setUnconfirmedResult] = useState<any>(null);
  const [showResultModal, setShowResultModal] = useState(false);
  // ★ 2026-08-05 요금제 무료 메시징 — 당월 제공·사용 현황 + 요금제별 제공량(서버 파생, 화면 하드코딩 금지)
  const [freeMessaging, setFreeMessaging] = useState<FreeMessagingInfo | null>(null);
  // ★ 2026-09-03 방문자 모드 — /api/plans가 함께 주는 요금제별 무료 메시지 수량(plans 파생). 로그인은 my-free-messaging이 우선.
  const [planQuotasPublic, setPlanQuotasPublic] = useState<Record<string, Record<string, number>> | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const token = localStorage.getItem('token');
      
      // ★ 2026-09-03 방문자 모드 — /pricing이 공개 라우트가 되어 비로그인도 들어온다.
      //   요금제 목록은 공개 API라 인증 헤더 없이 부르고, 로그인 전용 넷(크레딧·무료 현황·내 플랜·신청 상태)은 건너뛴다.
      const plansRes = await fetch('/api/plans', isAuthenticated ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
      const plansData = await plansRes.json();
      // CT-17: FREE(미가입) + TRIAL(무료체험) 은 유료 요금제 카드에서 제외
      //   · FREE = 요금제 미가입 상태, 사용자가 선택 대상 아님
      //   · TRIAL = 슈퍼관리자가 부여하는 체험 plan, 사용자 선택 대상 아님
      const sortedPlans = (plansData.plans || [])
        .filter((p: Plan) => isCustomerSelectablePlan(p.plan_code, p.is_active))
        .sort((a: Plan, b: Plan) => a.monthly_price - b.monthly_price);
      setPlans(sortedPlans);
      if (plansData.planQuotas) setPlanQuotasPublic(plansData.planQuotas);
      if (!isAuthenticated) return; // 방문자: 로그인 전용 조회 넷은 건너뛴다(finally가 loading을 내린다)

      // 종량제 Phase 5: 내 AI 크레딧 잔여
      try {
        // usage30=1 = 지난 30일 AI 사용(분석 제외)을 함께 받는다(추천 기준 A · 이 화면만)
        const creditRes = await fetch('/api/companies/my-credit?usage30=1', { headers: { Authorization: `Bearer ${token}` } });
        if (creditRes.ok) { const cd = await creditRes.json(); if (cd && cd.success !== false) setMyCredit(cd); }
      } catch { /* 조회 실패 시 게이지 숨김 */ }

      // ★ 2026-08-05 요금제 무료 메시징 — 실패해도 화면 전체가 막히지 않게 조용히 숨긴다(DDL 대기 상태 포함).
      try {
        const freeRes = await fetch('/api/companies/my-free-messaging', { headers: { Authorization: `Bearer ${token}` } });
        if (freeRes.ok) {
          const fd = await freeRes.json();
          if (fd && fd.success !== false) setFreeMessaging(fd);
        }
      } catch { /* 조회 실패 시 무료 제공 표시 숨김 */ }

      const companyRes = await fetch('/api/companies/my-plan', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const companyData = await companyRes.json();
      setCompanyInfo(companyData);

      // 요금제 신청 상태 조회 (pending + 미확인 결과)
      const statusRes = await fetch('/api/companies/plan-request/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.pending) {
          setHasPending(true);
          setPendingPlanName(statusData.pending.requested_plan_name || '');
        }
        if (statusData.unconfirmed) {
          setUnconfirmedResult(statusData.unconfirmed);
          setShowResultModal(true);
        }
      }
    } catch (error) {
      console.error('데이터 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString('ko-KR');
  };

  const formatPrice = (price: number) => {
    if (price === 0) return '무료';
    return `${formatNumber(Math.floor(price))}원`;
  };

  const handleRequestPlan = (plan: Plan) => {
    setSelectedPlan(plan);
    setJourneyCreditWarn(null);
    setRequestMessage(`${plan.plan_name} 플랜으로 변경 신청합니다.`);
    setShowRequestModal(true);
  };

  const openInquiryModal = (planInterest = '') => {
    setInquiryForm({
      companyName: (companyInfo as any)?.company_name || '',
      contactName: '', phone: '', email: '', planInterest, subject: '', message: '',
    });
    setShowContactModal(true);
  };

  // ★ D217+ (2026-05-25): about-ai-operator.html 영업 상담 신청 CTA → /pricing?openContactModal=true 진입 시 자동 모달 열기
  //   URL 파라미터 처리 후 history.replaceState로 정리 (새로고침 시 중복 진입 차단)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('openContactModal') === 'true') {
      openInquiryModal();
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
    // companyInfo 변경 시 재진입 차단 = []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyInfo]);

  const handleInquirySubmit = async () => {
    if (!inquiryForm.contactName || !inquiryForm.phone || !inquiryForm.email || !inquiryForm.subject || !inquiryForm.message) {
      toast.warning('필수 항목을 모두 입력해주세요.');
      return;
    }
    setInquirySubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/companies/inquiry', {
        method: 'POST',
        // 방문자는 토큰이 없다 — /inquiry는 공개 라우트(companies.ts · authenticate 앞)
        headers: token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : { 'Content-Type': 'application/json' },
        body: JSON.stringify(inquiryForm),
      });
      if (res.ok) {
        setShowContactModal(false);
        setSuccessModalType('inquiry');
        setShowSuccessModal(true);
      } else {
        const data = await res.json();
        toast.error(data.error || '문의 전송에 실패했습니다.');
      }
    } catch {
      toast.error('문의 전송 중 오류가 발생했습니다.');
    } finally {
      setInquirySubmitting(false);
    }
  };

  const handleSubmitRequest = async (acknowledgeJourneyCredit = false) => {
    if (!selectedPlan) return;
    setSubmitting(true);
    
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/companies/plan-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          requestedPlanId: selectedPlan.id,
          message: requestMessage,
          acknowledgeJourneyCredit,
        }),
      });
      
      if (res.ok) {
        setShowRequestModal(false);
        setSuccessModalType('plan');
        setShowSuccessModal(true);
        setHasPending(true);
        setPendingPlanName(selectedPlan.plan_name);
      } else {
        const data = await res.json();
        if (data.code === 'DUPLICATE_PENDING') {
          setShowRequestModal(false);
          setHasPending(true);
        } else if (data.code === 'JOURNEY_CREDIT_OVER_PLAN' && data.forecast) {
          // 창을 닫지 않고 숫자를 보여 준 뒤 고객사가 정한다([그대로 신청] = 확인하고 다시 보냄)
          setJourneyCreditWarn({
            total: Number(data.forecast.total) || 0,
            basis: String(data.forecast.basis || 'measured'),
            lineages: Array.isArray(data.forecast.perLineage) ? data.forecast.perLineage.length : 0,
            autoMarketing: Number(data.forecast.autoMarketing30) || 0,
            planCredits: Number(data.planCredits) || 0,
          });
        } else {
          toast.error(data.error || '신청 실패');
        }
      }
    } catch (error) {
      toast.error('신청 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const getUsagePercent = () => {
    if (!companyInfo || !companyInfo.max_customers) return 0;
    return Math.min(100, (Number(companyInfo.current_customers) / Number(companyInfo.max_customers)) * 100);
  };

  // ★ 2026-11-09 DB 분석 차감 · 실제 쓸 수 있는 크레딧 · 추천(Harold 기준 A · 목업 docs/mockups/2026-11-09-pricing-db-credit-mockup.html)
  //   고객 수 = 차감 워커와 같은 셈(customers 회사별 COUNT · my-plan current_customers) · 하루 차감 = 식 한 벌(dailyDbAnalysisCredits) · 한 달 = ×MONTH_DAYS.
  //   추천 = 한 달 분석 차감 + 지난 30일 AI 사용(분석 제외) 이상을 주는 가장 싼 요금제 · 지금 요금제 월 크레딧이 모자랄 때만.
  //   옛 추천(고객 한도 max_customers 기준 · 미가입만)은 한도가 없어져 이 하나로 바꿨다.
  const customerCount = Number(companyInfo?.current_customers) || 0;
  const dailyAnalysis = dailyDbAnalysisCredits(customerCount);
  const monthAnalysis = dailyAnalysis * MONTH_DAYS;
  const showAnalysis = isAuthenticated && monthAnalysis > 0;
  // 사실 셋(차감 대상 · 지금 요금제 월 크레딧 · 지난 30일 사용)은 서버 한 함수가 함께 읽는다 · null = 못 읽음(차감 없음 · 추천 문장을 내지 않는다 · Codex 1R)
  const facts: { charged: boolean; planCredits: number; usage30: number } | null = myCredit?.analysisFacts ?? null;
  const currentPlanCredits = facts?.charged ? Number(facts.planCredits) || 0 : 0;
  const usage30: number | null = facts ? Number(facts.usage30) || 0 : null;
  const needCredits = monthAnalysis + (usage30 ?? 0);
  const needMore = showAnalysis && !!facts && currentPlanCredits < needCredits;
  const recommendedPlan = needMore
    ? plans.find((p) => p.id !== companyInfo?.plan_id && (Number(p.ai_credits_per_month) || 0) >= needCredits) ?? null
    : null;
  const recommendedPlanId = recommendedPlan?.id ?? null;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => goBackOr(navigate, isAuthenticated ? '/dashboard' : '/login')}
              className="text-gray-600 hover:text-gray-900"
            >
              ← 뒤로
            </button>
            <h1 className="text-xl font-bold text-gray-900">요금제 안내</h1>
          </div>
          <div className="text-sm text-gray-500">
            {isAuthenticated ? ((companyInfo as any)?.company_name || user?.name) : (
              <button onClick={() => navigate('/login')} className="text-sm font-medium text-blue-600 hover:text-blue-700">로그인</button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* ★ 2026-10-04 선불 요금제 이용 기간(관리 대상 회사만) — 만료일 · 자동 연장 · 1개월 연장 · 기록 */}
        {companyInfo?.prepaid_term && (
          <PrepaidTermCard
            term={companyInfo.prepaid_term}
            onChanged={loadData}
            onOpenCharge={() => setShowBalanceCharge(true)}
          />
        )}
        {companyInfo && (() => {
          // ★ CT-17: 30일 PRO 무료체험 상태 계산
          //   plan_code='TRIAL'을 진실의 원천으로 사용 (subscription_status에 의존하지 않음).
          //   이유: admin.ts 요금제 승인 API 등 여러 경로가 subscription_status를 'paid'로 덮어쓰는 이슈가 있어
          //   subscription_status 기반 판정은 견고하지 않음. plan_code는 grant-trial/revoke-trial/Cron 강등 3곳에서만 변경됨.
          const isOnTrial = (companyInfo.plan_code === 'TRIAL' || companyInfo.subscription_status === 'trial') && !!companyInfo.trial_expires_at;
          const isTrialExpired = companyInfo.subscription_status === 'trial_expired';
          // ★ 2026-10-04 선불 이용 기간이 잠긴 회사는 plan_code가 FREE지만 미가입이 아니다(돈 내던 회사 · 위 카드가 다시 열기를 안내)
          const termBlocked = companyInfo.prepaid_term?.state === 'blocked';
          const isUnsubscribed = companyInfo.plan_code === 'FREE' && !isTrialExpired && !termBlocked;
          // 크레딧 보유 시 요금제+DB는 아래 크레딧 카드가 보여줌 → 이 단독 카드는 미가입/FREE에서만 표시
          const isCreditEnabled = !!myCredit?.creditEnabled && (((myCredit?.planCredits || 0) > 0) || ((myCredit?.purchased || 0) > 0));
          const daysRemaining = isOnTrial && companyInfo.trial_expires_at
            ? Math.max(0, Math.ceil((new Date(companyInfo.trial_expires_at).getTime() - Date.now()) / 86400000))
            : 0;
          // ★ 체험 중인 플랜과 동일한 max_customers를 가진 유료 플랜 이름 동적 매칭 (TRIAL=1M → PRO)
          const equivalentPlan = plans.find(p => Number(p.max_customers) === Number(companyInfo.max_customers));
          const equivalentPlanName = equivalentPlan?.plan_name || '프로';
          return (
          <>
            {/* 무료체험 D-N 만료 안내 — 요금제·DB는 아래 크레딧 카드가 보여주므로 만료 강조만 분리 */}
            {isOnTrial && (
              <div className="mb-6 p-4 bg-[#FFF3EC] border border-[#FFE3D4] rounded-xl">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-[#FF5A1F] rounded-xl flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#1A1A1A]">
                      현재 무료체험 중인 요금제는 <span className="text-[#C8410C]">{equivalentPlanName} 플랜</span>입니다
                    </p>
                    <p className="text-xs text-[#44403C] mt-1 leading-relaxed">
                      고객 DB {formatNumber(Number(companyInfo.max_customers))}명 · AI 메시지 · 자동발송 · 모바일 DM · AI 프리미엄 · 스팸필터 자동화 전 기능 이용 가능
                    </p>
                    {companyInfo.trial_expires_at && (
                      <div className="mt-3 pt-3 border-t border-[#FFE3D4] flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-1.5 text-xs text-[#44403C]">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>체험 만료 <b className="font-bold">{formatDate(companyInfo.trial_expires_at)}</b> · <b className="font-bold text-[#C8410C]">{daysRemaining}일</b> 남음</span>
                        </div>
                        <span className="text-[11px] text-[#8A847E]">
                          만료 시 자동으로 미가입 상태 전환
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 크레딧 미적용(미가입/FREE)에서만 단독 플랜 카드 — 크레딧 보유 시 아래 반반 카드가 요금제+DB를 표시 */}
            {!isCreditEnabled && (
              <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
                <h2 className="text-lg font-semibold mb-4">현재 이용 중인 플랜</h2>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-2xl font-bold text-blue-600">
                        {termBlocked ? companyInfo.prepaid_term!.plan_name : isTrialExpired ? '미가입' : companyInfo.plan_name}
                      </span>
                      {termBlocked && (
                        <span className="px-2.5 py-1 bg-rose-100 text-rose-700 text-xs font-bold rounded-full">잠김</span>
                      )}
                      {isTrialExpired && (
                        <span className="px-2.5 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full">
                          체험 만료
                        </span>
                      )}
                      {isUnsubscribed && (
                        <span className="px-2.5 py-1 bg-gray-100 text-gray-700 text-xs font-bold rounded-full">
                          요금제 미가입
                        </span>
                      )}
                    </div>
                    {isTrialExpired && (
                      <p className="text-sm text-gray-600 mt-2">
                        무료체험이 종료되어 미가입 상태로 전환되었습니다. 직접발송 등 기본 기능은 계속 이용 가능합니다. 아래에서 요금제를 선택해 주세요.
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-500">고객 DB 사용량</div>
                    <div className="text-lg font-semibold">
                      {formatNumber(Number(companyInfo.current_customers))} / {formatNumber(Number(companyInfo.max_customers))}명
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        getUsagePercent() >= 90 ? 'bg-red-500' :
                        getUsagePercent() >= 70 ? 'bg-yellow-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${getUsagePercent()}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>{getUsagePercent().toFixed(1)}% 사용 중</span>
                    <span>{formatNumber(Number(companyInfo.max_customers) - Number(companyInfo.current_customers))}명 여유</span>
                  </div>
                </div>

                {/* 무료 메시지 현황은 위 요약 카드(CreditSummaryBar)가 소유한다 — 두 곳에 그리면 갈린다 */}
                {isTrialExpired && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-700">
                      ⚠️ 무료 체험 기간이 만료되었습니다. AI 기능을 계속 사용하려면 유료 플랜으로 업그레이드해주세요.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
          );
        })()}

        {/* 대기 중 신청 배너 */}
        {hasPending && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6 flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-yellow-800">
                {pendingPlanName ? `${pendingPlanName} 플랜` : '요금제'} 변경 신청이 대기 중입니다
              </p>
              <p className="text-sm text-yellow-600 mt-0.5">담당자 확인 후 처리됩니다. 중복 신청은 불가합니다.</p>
            </div>
          </div>
        )}

        {/* 종량제: 크레딧 요약 바 (FREE 0크레딧 숨김) */}
        {myCredit?.creditEnabled && (myCredit.planCredits > 0 || myCredit.purchased > 0) && (
          <div className="mb-6">
            <CreditSummaryBar
              planName={companyInfo?.plan_name || '—'}
              currentCustomers={Number(companyInfo?.current_customers) || 0}
              maxCustomers={Number(companyInfo?.max_customers) || 0}
              usagePercent={getUsagePercent()}
              total={myCredit.total}
              baseRemaining={myCredit.baseRemaining}
              purchased={myCredit.purchased}
              planCredits={myCredit.planCredits}
              monthlyUsed={myCredit.monthlyUsed}
              billingType={myCredit.billingType}
              overageLimit={myCredit.overageLimit}
              onRecharge={() => setShowRecharge(true)}
              freeMessaging={freeMessaging}
              freeMessagingNote={FREE_MESSAGING_NOTE}
            />
          </div>
        )}

        {/* ★ 2026-11-09 요금제 비교 = 시안(marketing/proposals/2026-11-hanjul-proposal/pricing-plans.html) 모양 · 목업 = docs/mockups/2026-11-09-pricing-compare-mockup.html(Harold 승인)
            고객 DB 줄 없음(전 요금제 저장 한도 없음 · 규모 = 아래 DB 분석 차감 표) · 숫자는 전부 plans · planQuotas 파생(화면에 적지 않는다) */}
        {plans.length > 0 && (() => {
          const quotas = freeMessaging?.planQuotas || planQuotasPublic;
          const quotaEntriesOf = (code: string) => Object.entries(quotas?.[code] || {}).filter(([, v]) => Number(v) > 0);
          // 대행 = 전용 등급(PLAN_INFRA.premium) · plans 는 월 요금 오름차순이라 첫 대행 칸 = 가장 싼 대행 요금제
          const agencyIdx = plans.flatMap((p, i) => (PLAN_INFRA[p.plan_code]?.premium ? [i] : []));
          const firstAgency = agencyIdx.length > 0 ? plans[agencyIdx[0]] : null;
          const lastAgencyIdx = agencyIdx[agencyIdx.length - 1];
          // 띠는 대행 칸이 붙어 있고 첫 줄(5칸) 안일 때만 그 칸 위에 건다 · 아니면 한 줄 전체(가운데 꼭지 없음)
          const ribbonCol = firstAgency && lastAgencyIdx - agencyIdx[0] + 1 === agencyIdx.length && lastAgencyIdx < 5
            ? `${agencyIdx[0] + 1} / span ${agencyIdx.length}` : undefined;
          const agencyFromWon = Number(firstAgency?.monthly_price) || 0;
          const notes = [
            plans.some((p) => quotaEntriesOf(p.plan_code).length > 0) ? FREE_MESSAGING_NOTE : null,
            firstAgency ? AGENCY_SCOPE_NOTE : null,
            plans.some((p) => planBonusPct(Number(p.monthly_price) || 0, Number(p.ai_credits_per_month) || 0) > 0) ? BONUS_NOTE : null,
            showAnalysis ? ANALYSIS_NOTE : null,
          ].filter((t): t is string => !!t);
          const currentUsable = Math.max(0, currentPlanCredits - monthAnalysis);
          const analysisPct = currentPlanCredits > 0 ? Math.min(100, Math.round((monthAnalysis / currentPlanCredits) * 100)) : 0;
          return (
            <section className="break-keep">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div>
                  <div className="inline-flex items-center gap-2 text-[13px] font-bold text-[#C8410C]">
                    <span className="h-[3px] w-5 rounded-full bg-[#FF5A1F]" />요금제 비교
                  </div>
                  <h2 className="mt-2 text-[22px] md:text-[26px] font-extrabold leading-snug tracking-[-0.035em] text-[#1A1A1A]">
                    {plans[0].plan_name}부터{' '}
                    <span style={{ background: 'linear-gradient(rgba(255,90,31,.22), rgba(255,90,31,.22)) no-repeat 0 88% / 100% 32%', padding: '0 3px' }}>AI 전 기능, 전 채널 발송</span>이 같습니다
                  </h2>
                  <p className="mt-1.5 text-[14px] md:text-[15px] font-medium text-[#44403C]">
                    요금제마다 AI 크레딧, 무료 메시지, 서버가 달라집니다.{firstAgency && ` ${firstAgency.plan_name}부터는 캠페인 대행 운영이 들어갑니다.`}
                  </p>
                </div>
                <div className="text-[13px] font-semibold text-[#66605B]">VAT 별도</div>
              </div>

              {/* ★ 2026-11-09 가로띠 — 지금 고객 DB 로 매일 · 한 달 분석 차감 · 지금 요금제에서 실제 쓸 수 있는 크레딧 · 추천 */}
              {showAnalysis && (
                <div className="mt-6 overflow-hidden rounded-[20px] border-[1.5px] border-[#FFE3D4] bg-white shadow-[0_12px_32px_rgba(28,25,23,.05)]">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#ECEAE7]">
                    {[
                      { label: '지금 고객 DB', sub: '', value: customerCount, unit: '명' },
                      { label: '매일 분석 차감', sub: '', value: dailyAnalysis, unit: '크레딧' },
                      { label: '한 달 분석 차감', sub: `(×${MONTH_DAYS}일)`, value: monthAnalysis, unit: '크레딧' },
                    ].map((s) => (
                      <div key={s.label} className="bg-white px-5 py-4">
                        <div className="text-[13px] font-semibold text-[#66605B]">
                          {s.label}{s.sub && <span className="ml-1 font-medium text-[#8A847E]">{s.sub}</span>}
                        </div>
                        <div className="mt-1 text-[22px] font-extrabold tabular-nums text-[#1A1A1A]">
                          {formatNumber(s.value)}<span className="ml-0.5 text-[14px] font-semibold text-[#66605B]">{s.unit}</span>
                        </div>
                      </div>
                    ))}
                    {!facts ? (
                      <div className="bg-[#F7F6F4] px-5 py-4">
                        <div className="text-[13px] font-semibold text-[#66605B]">{companyInfo?.plan_name}에서 실제 쓸 수 있는 크레딧</div>
                        <div className="mt-1 text-[14px] font-semibold leading-snug text-[#44403C]">지금 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요</div>
                      </div>
                    ) : facts.charged ? (
                      <div className="bg-[#FFF3EC] px-5 py-4">
                        <div className="text-[13px] font-semibold text-[#C8410C]">{companyInfo?.plan_name}에서 실제 쓸 수 있는 크레딧</div>
                        <div className="mt-1 text-[22px] font-extrabold tabular-nums text-[#C8410C]">
                          {formatNumber(currentUsable)}<span className="ml-1 text-[14px] font-semibold text-[#66605B]">/ 월 {formatNumber(currentPlanCredits)}</span>
                        </div>
                        <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-[#FFE3D4]">
                          <div className="h-full bg-[#1A1A1A]" style={{ width: `${analysisPct}%` }} />
                          <div className="h-full bg-[#FF5A1F]" style={{ width: `${100 - analysisPct}%` }} />
                        </div>
                      </div>
                    ) : (
                      <div className="bg-[#F7F6F4] px-5 py-4">
                        <div className="text-[13px] font-semibold text-[#66605B]">지금 요금제에서는 분석 차감 없음</div>
                        <div className="mt-1 text-[14px] font-semibold leading-snug text-[#44403C]">아래 요금제로 바꾸면 카드의 차감이 적용됩니다</div>
                      </div>
                    )}
                  </div>
                  {facts && usage30 !== null && (
                    <div className="flex flex-col gap-3 bg-[#1A1A1A] px-5 py-4 md:flex-row md:items-center md:justify-between">
                      <p className="text-[14px] font-medium leading-relaxed text-[#E7E5E4]">
                        지난 30일 AI 사용 <b className="text-white">{formatNumber(usage30)}크레딧</b>(분석 제외)까지 더하면 한 달 <b className="text-white">{formatNumber(needCredits)}크레딧</b>이 필요합니다.{' '}
                        {recommendedPlan ? (
                          <b className="text-[#FF8A5C]">AI 오퍼레이터를 원활히 쓰시려면 {recommendedPlan.plan_name} 요금제를 추천합니다.</b>
                        ) : needMore ? (
                          <b className="text-[#FF8A5C]">가장 큰 요금제로도 모자라 맞춤 요금제를 상담해 드립니다.</b>
                        ) : (
                          <b className="text-[#FF8A5C]">지금 요금제로 충분합니다.</b>
                        )}
                      </p>
                      {recommendedPlan ? (
                        <button
                          onClick={() => handleRequestPlan(recommendedPlan)}
                          disabled={hasPending}
                          className="h-10 flex-none rounded-xl bg-[#FF5A1F] px-5 text-[14px] font-bold text-white hover:bg-[#E64A12] disabled:cursor-not-allowed disabled:bg-[#66605B]"
                        >
                          {hasPending ? '신청 대기 중' : `${recommendedPlan.plan_name} 요금제 신청`}
                        </button>
                      ) : needMore ? (
                        <button onClick={() => openInquiryModal()} className="h-10 flex-none rounded-xl bg-[#FF5A1F] px-5 text-[14px] font-bold text-white hover:bg-[#E64A12]">
                          담당자 문의
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              {firstAgency && (
                <div className="mt-8 xl:grid xl:grid-cols-5 xl:gap-4">
                  <div
                    className="relative flex flex-wrap min-h-[34px] items-center justify-center gap-x-2.5 rounded-full bg-[#1A1A1A] px-4 py-1.5 text-center text-[14px] font-bold text-white"
                    style={{ gridColumn: ribbonCol ?? '1 / -1' }}
                  >
                    <b className="text-[#FF8A5C]">월 {agencyFromWon % 10000 === 0 ? `${formatNumber(agencyFromWon / 10000)}만원` : formatPrice(agencyFromWon)}부터</b>
                    <span>전담 담당자가 캠페인을 대신 운영합니다</span>
                    {ribbonCol && (
                      <span className="absolute left-1/2 -bottom-[7px] -ml-[7px] hidden xl:block h-0 w-0 border-x-[7px] border-t-[7px] border-x-transparent border-t-[#1A1A1A]" />
                    )}
                  </div>
                </div>
              )}

              <div className={`${firstAgency ? 'mt-5' : 'mt-8'} grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4`}>
                {plans.map((plan) => {
                  const isCurrentPlan = companyInfo?.plan_id === plan.id;
                  // ★ CT-17: FREE(미가입) / TRIAL(무료체험)은 아직 유료 구독이 아니므로 모든 유료 플랜이 "업그레이드".
                  //   유료 가입자만 max_customers 크기 비교로 업/다운을 구분한다.
                  const isFreeOrTrial = companyInfo?.plan_code === 'FREE' || companyInfo?.plan_code === 'TRIAL';
                  const isUpgrade = companyInfo && (isFreeOrTrial || plan.max_customers > (companyInfo.max_customers || 0));
                  const isRecommended = plan.id === recommendedPlanId;
                  const credits = Number(plan.ai_credits_per_month) || 0;
                  const bonusPct = planBonusPct(Number(plan.monthly_price) || 0, credits);
                  const infra = PLAN_INFRA[plan.plan_code] || { label: '고성능 공유 서버', benefit: '당사 IDC 고성능 서버를 멀티테넌트로 사용', premium: false };
                  const top = infra.premium;
                  const ops = top ? PLAN_OPERATION.agency : PLAN_OPERATION.self;
                  // ★ 2026-08-05 요금제 가입 메리트 — 이 요금제에 포함된 무료 메시지. `plans` 파생이라 화면에 수량을 적지 않는다.
                  const quotaEntries = quotaEntriesOf(plan.plan_code);

                  return (
                    <div
                      key={plan.id}
                      className={`relative flex flex-col rounded-[20px] border-[1.5px] bg-white ${
                        isCurrentPlan ? 'border-[#1A1A1A] shadow-[0_12px_32px_rgba(28,25,23,.10)]' :
                        isRecommended ? 'border-[#FF5A1F] shadow-[0_16px_40px_rgba(255,90,31,.16)]' :
                        top ? 'border-[#FF5A1F] shadow-[0_16px_40px_rgba(255,90,31,.12)]' : 'border-[#ECEAE7] shadow-[0_12px_32px_rgba(28,25,23,.06)]'
                      }`}
                    >
                      {(isCurrentPlan || isRecommended) && (
                        <span className={`absolute -top-3 left-5 rounded-full px-2.5 py-0.5 text-[12px] font-bold text-white ${isCurrentPlan ? 'bg-[#1A1A1A]' : 'bg-[#FF5A1F]'}`}>
                          {isCurrentPlan ? '이용 중' : '추천'}
                        </span>
                      )}
                      <div className={`rounded-t-[19px] border-b px-5 pt-5 pb-4 ${top ? 'border-[#FFE3D4] bg-[#FFF3EC]' : 'border-[#ECEAE7]'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="whitespace-nowrap text-[18px] font-extrabold tracking-[-0.02em] text-[#1A1A1A]">{plan.plan_name}</h3>
                          <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-bold ${top ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white' : 'border-[#ECEAE7] bg-[#F7F6F4] text-[#44403C]'}`}>
                            {infra.label}
                          </span>
                        </div>
                        <div className="mt-3 whitespace-nowrap text-[26px] font-extrabold tabular-nums tracking-[-0.03em] text-[#1A1A1A]">
                          {formatPrice(plan.monthly_price)}<span className="ml-0.5 text-[14px] font-semibold text-[#66605B]">/월</span>
                        </div>
                      </div>

                      <div className="flex flex-1 flex-col px-5 pt-2 pb-5">
                        <div className="flex items-center justify-between border-b border-[#ECEAE7] py-3">
                          <span className="text-[13.5px] font-semibold text-[#66605B]">월 AI 크레딧</span>
                          {credits > 0 ? (
                            <span className="whitespace-nowrap text-[16px] font-extrabold tabular-nums text-[#1A1A1A]">
                              {formatNumber(credits)}
                              {bonusPct > 0 && <small className="ml-1.5 text-[12.5px] font-bold text-[#C8410C]">+{bonusPct}%</small>}
                            </span>
                          ) : (
                            <span className="text-[13.5px] font-bold text-[#1A1A1A]">상담 시 안내</span>
                          )}
                        </div>

                        {/* ★ 2026-11-09 지금 고객 DB 기준 — 한 달 분석 차감 · 실제 쓸 수 있는 크레딧 */}
                        {showAnalysis && credits > 0 && (
                          <>
                            <div className="flex items-center justify-between border-b border-[#ECEAE7] py-2.5">
                              <span className="text-[13px] font-medium text-[#8A847E]">DB 분석 차감 (월)</span>
                              <span className="whitespace-nowrap text-[14px] font-bold tabular-nums text-[#66605B]">−{formatNumber(monthAnalysis)}</span>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <span className="text-[13.5px] font-bold text-[#1A1A1A]">실제 쓸 수 있는 크레딧</span>
                              <span className="whitespace-nowrap text-[17px] font-extrabold tabular-nums text-[#C8410C]">{formatNumber(Math.max(0, credits - monthAnalysis))}</span>
                            </div>
                          </>
                        )}

                        {quotaEntries.length > 0 && (
                          <>
                            <div className="mt-4 text-[13px] font-extrabold text-[#C8410C]">매월 무료 메시지</div>
                            <div className={`mt-2 divide-y divide-[#ECEAE7] rounded-[14px] px-3.5 py-1 ${top ? 'bg-[#FFF8F4]' : 'bg-[#F7F6F4]'}`}>
                              {quotaEntries.map(([type, qty]) => (
                                <div key={type} className="flex items-center justify-between py-[7px] text-[14px]">
                                  <span className="font-semibold text-[#44403C]">{FREE_TYPE_LABEL[type] || type}</span>
                                  <b className="font-extrabold tabular-nums text-[#1A1A1A]">{formatNumber(Number(qty))}건</b>
                                </div>
                              ))}
                            </div>
                          </>
                        )}

                        {/* 운영 방식 — 칸 높이를 채워 다섯 카드의 아래 끝을 맞춘다 */}
                        <div className={`mt-4 flex-1 rounded-[14px] px-4 py-3.5 ${top ? 'bg-[#1A1A1A]' : 'bg-[#F7F6F4]'}`}>
                          <div className={`text-[14.5px] font-extrabold ${top ? 'text-[#FF8A5C]' : 'text-[#1A1A1A]'}`}>{ops.title}</div>
                          <ul className="mt-2 space-y-1.5">
                            {ops.items.map((t) => (
                              <li key={t} className={`flex items-start gap-2 text-[13px] font-semibold leading-snug ${top ? 'text-[#E7E5E4]' : 'text-[#44403C]'}`}>
                                <span className="mt-[6px] h-1.5 w-1.5 flex-none rounded-full bg-[#FF5A1F]" />{t}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="pt-5">
                          {!isAuthenticated ? (
                            <button onClick={() => openInquiryModal(plan.plan_name)} className={`${PLAN_BTN} bg-[#1A1A1A] text-white hover:bg-black`}>
                              이용 문의
                            </button>
                          ) : isCurrentPlan ? (
                            <button disabled className={`${PLAN_BTN} cursor-not-allowed bg-[#F7F6F4] text-[#A8A29E]`}>
                              이용 중
                            </button>
                          ) : hasPending ? (
                            <button disabled className={`${PLAN_BTN} cursor-not-allowed bg-[#FFF3EC] text-[#C8410C]`}>
                              신청 대기 중
                            </button>
                          ) : isUpgrade ? (
                            <button
                              onClick={() => handleRequestPlan(plan)}
                              className={`${PLAN_BTN} text-white ${isRecommended ? 'bg-[#FF5A1F] hover:bg-[#E64A12]' : 'bg-[#1A1A1A] hover:bg-black'}`}
                            >
                              {isRecommended ? '추천 요금제 신청' : '업그레이드 신청'}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRequestPlan(plan)}
                              className={`${PLAN_BTN} border border-[#D6D3D1] bg-white text-[#1A1A1A] hover:bg-[#F7F6F4]`}
                            >
                              다운그레이드 신청
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {notes.length > 0 && (
                <div className="mt-6 grid gap-x-10 gap-y-2 md:grid-cols-2">
                  {notes.map((t) => (
                    <p key={t} className="flex gap-2 text-[13px] font-medium leading-relaxed text-[#66605B]">
                      <span className="mt-[8px] h-[5px] w-[5px] flex-none rounded-full bg-[#D6D3D1]" />{t}
                    </p>
                  ))}
                </div>
              )}
            </section>
          );
        })()}

        {/* DB 규모별 매일 분석 차감 안내 — 요금제 이용 중 고객 DB 보유 시 매일 오전 9시 자동 분석·차감 (공식 dailyDbAnalysisCredits 단일 소스) */}
        <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900">DB 규모별 매일 분석 차감</h3>
          <p className="text-sm text-gray-500 mt-1">
            요금제 이용 중 고객 DB가 있으면 매일 오전 9시에 DB 규모 기준으로 AI 분석이 실행되고 크레딧이 자동 차감됩니다.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4 font-medium">고객 DB</th>
                  <th className="py-2 px-4 font-medium text-right">일일 차감</th>
                  <th className="py-2 pl-4 font-medium text-right">월 환산 (×30일)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: '10만 이하', n: 100000 },
                  { label: '20만', n: 200000 },
                  { label: '30만', n: 300000 },
                  { label: '50만', n: 500000 },
                  { label: '100만', n: 1000000 },
                  { label: '200만', n: 2000000 },
                  { label: '300만', n: 3000000 },
                ].map((r) => {
                  const daily = dailyDbAnalysisCredits(r.n);
                  return (
                    <tr key={r.n} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-4 text-gray-800">{r.label}</td>
                      <td className="py-2 px-4 text-right font-semibold text-gray-900 tabular-nums">{daily} 크레딧</td>
                      <td className="py-2 pl-4 text-right text-gray-600 tabular-nums">{(daily * MONTH_DAYS).toLocaleString()} 크레딧</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            고객 DB가 없으면 차감되지 않습니다. 실제 차감은 보유 고객 수 기준으로 자동 계산됩니다.
          </p>
        </div>

        <div className="mt-8 bg-gradient-to-r from-gray-800 to-gray-900 rounded-xl p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">맞춤 요금제가 필요하신가요?</h3>
              <p className="text-gray-300 text-sm mt-1">
                대용량 고객 DB, 특수 기능 등 맞춤 상담을 원하시면 연락주세요.
              </p>
            </div>
            <div className="flex items-stretch gap-3">
              <a
                href={`tel:${COMPANY_PHONE_TEL}`}
                className="px-6 py-3 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100 transition-colors text-center flex flex-col justify-center"
              >
                <div className="text-xs text-gray-500">대표번호</div>
                <div>{COMPANY_PHONE}</div>
              </a>
              <button
                onClick={() => openInquiryModal()}
                className="px-6 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors flex items-center"
              >
                담당자 문의
              </button>
            </div>
          </div>
        </div>
      </main>

      {showRequestModal && selectedPlan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">
                {selectedPlan && companyInfo && (
                  companyInfo.plan_code === 'FREE' ||
                  companyInfo.plan_code === 'TRIAL' ||
                  selectedPlan.max_customers > (companyInfo.max_customers || 0)
                ) ? '업그레이드 신청' : '다운그레이드 신청'}
              </h3>
              
              <div className="bg-blue-50 rounded-lg p-4 mb-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">신청 플랜</span>
                  <span className="font-semibold text-blue-600">{selectedPlan.plan_name}</span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-gray-600">월 요금</span>
                  <span className="font-semibold">{formatPrice(selectedPlan.monthly_price)}</span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-gray-600">고객 DB 한도</span>
                  <span className="font-semibold">{formatNumber(selectedPlan.max_customers)}명</span>
                </div>
              </div>

              {/* ★ 2026-10-04 선불 이용 기간 회사 — 승인되면 돈이 어떻게 움직이는지 한 줄(금액은 승인하는 날 서버가 계산) */}
              {companyInfo?.prepaid_term && (
                <p className="text-xs text-slate-600 bg-slate-50 ring-1 ring-slate-200 rounded-lg px-3 py-2 mb-4 leading-relaxed">
                  {prepaidTermRequestNote(companyInfo.prepaid_term, Number(companyInfo.monthly_price) || 0, selectedPlan)}
                </p>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  요청 메시지 (선택)
                </label>
                <textarea
                  value={requestMessage}
                  onChange={(e) => setRequestMessage(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  rows={3}
                  placeholder="추가 요청사항이 있으면 입력해주세요."
                />
              </div>

              {journeyCreditWarn && (
                <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2.5 mb-4 text-xs text-amber-900 leading-relaxed">
                  <p>
                    켜 둔 여정 {journeyCreditWarn.lineages.toLocaleString()}개{journeyCreditWarn.autoMarketing > 0 ? ` · 자동 마케팅(${journeyCreditWarn.autoMarketing.toLocaleString()})` : ''}가 한 달에 {journeyCreditWarn.total.toLocaleString()}크레딧을 써요
                    {journeyCreditWarn.basis === 'measured' ? '(지난 30일 실제)' : '(지난 30일 실제 · 켠 지 30일이 안 된 여정은 최대로 셈)'}.
                    바꿀 요금제의 한 달 기본 크레딧은 {journeyCreditWarn.planCredits.toLocaleString()}이에요.
                  </p>
                  <p className="mt-1 font-semibold">크레딧이 모자라면 켜 둔 여정 · 자동 마케팅이 멈춰요.</p>
                  <button type="button" onClick={() => navigate('/ai-journeys')} className="mt-2 h-8 px-3 rounded-lg bg-white ring-1 ring-amber-300 text-amber-900 font-semibold hover:bg-amber-100">
                    켜 둔 여정 고르기
                  </button>
                </div>
              )}

              <p className="text-xs text-gray-500 mb-4">
                신청 후 영업일 기준 1~2일 내 담당자가 연락드립니다.
              </p>
            </div>
            
            <div className="flex border-t">
              <button
                onClick={() => setShowRequestModal(false)}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={() => void handleSubmitRequest(!!journeyCreditWarn)}
                disabled={submitting}
                className="flex-1 px-4 py-3 text-blue-600 font-medium hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                {submitting ? '신청 중...' : journeyCreditWarn ? '그대로 신청' : '신청하기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{successModalType === 'inquiry' ? '문의 접수 완료!' : '신청 완료!'}</h3>
              <p className="text-sm text-gray-600">
                {successModalType === 'inquiry' ? '문의가 정상적으로 접수되었습니다.' : '플랜 변경 신청이 접수되었습니다.'}<br/>
                담당자가 곧 연락드리겠습니다.
              </p>
            </div>
            <div className="border-t">
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  if (isAuthenticated) navigate('/dashboard'); // 방문자는 요금제 화면에 남는다
                }}
                className="w-full px-4 py-3 text-blue-600 font-medium hover:bg-blue-50 transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecharge && (
        <CreditRechargeModal onClose={() => setShowRecharge(false)} onSuccess={loadData} />
      )}

      {/* ★ 2026-10-04 선불 이용 기간 카드의 [잔액 충전] — 충전 창만 쓴다(잔액 창은 열지 않는다) */}
      {companyInfo?.prepaid_term && (
        <BalanceModals
          showBalanceModal={showBalanceInfo}
          setShowBalanceModal={setShowBalanceInfo}
          showChargeModal={showBalanceCharge}
          setShowChargeModal={setShowBalanceCharge}
          balanceInfo={null}
          showInsufficientBalance={insufficientInfo}
          setShowInsufficientBalance={setInsufficientInfo}
        />
      )}

      {showContactModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-[zoomIn_0.2s_ease-out]">
            <div className="px-6 pt-6 pb-4 bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-lg font-bold text-gray-900">📩 솔루션 문의</h3>
              <p className="text-sm text-gray-500 mt-1">문의 내용을 작성해주시면 담당자가 연락드립니다.</p>
            </div>
            <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">회사명</label>
                  <input value={inquiryForm.companyName} onChange={(e) => setInquiryForm(f => ({ ...f, companyName: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자명 *</label>
                  <input value={inquiryForm.contactName} onChange={(e) => setInquiryForm(f => ({ ...f, contactName: e.target.value }))}
                    placeholder="홍길동"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">연락처 *</label>
                  <input value={inquiryForm.phone} onChange={(e) => setInquiryForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="010-1234-5678"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">이메일 *</label>
                  <input type="email" value={inquiryForm.email} onChange={(e) => setInquiryForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="email@company.com"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">관심 요금제</label>
                <select value={inquiryForm.planInterest} onChange={(e) => setInquiryForm(f => ({ ...f, planInterest: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                  <option value="">선택 안함</option>
                  <option value="스타터">스타터 (150,000원/월)</option>
                  <option value="베이직">베이직 (350,000원/월)</option>
                  <option value="프로">프로 (1,000,000원/월)</option>
                  <option value="비즈니스">비즈니스 (3,000,000원/월)</option>
                  <option value="엔터프라이즈">엔터프라이즈 (5,500,000원/월)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목 *</label>
                <input value={inquiryForm.subject} onChange={(e) => setInquiryForm(f => ({ ...f, subject: e.target.value }))}
                  placeholder="문의 제목을 입력해주세요"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">문의 내용 *</label>
                <textarea value={inquiryForm.message} onChange={(e) => setInquiryForm(f => ({ ...f, message: e.target.value }))}
                  rows={4} placeholder="문의하실 내용을 자유롭게 작성해주세요."
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setShowContactModal(false)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                취소
              </button>
              <button onClick={handleInquirySubmit} disabled={inquirySubmitting}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 transition">
                {inquirySubmitting ? '전송 중...' : '문의 전송'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 요금제 승인/거절 결과 알림 모달 */}
      {showResultModal && unconfirmedResult && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in">
            <div className="p-6 text-center">
              {unconfirmedResult.status === 'approved' ? (
                <>
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  {/* ★ 2026-10-04 선불 이용 기간 — 내림은 승인돼도 지금 바뀌지 않는다(만료 다음 날부터). 서버가 적용일을 준다 */}
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{unconfirmedResult.scheduled_from ? '요금제 변경 예약' : '요금제 변경 완료'}</h3>
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-blue-600">{unconfirmedResult.requested_plan_name}</span> 플랜으로<br/>
                    {unconfirmedResult.scheduled_from
                      ? `${formatDate(unconfirmedResult.scheduled_from)}부터 바뀝니다. 남은 기간은 지금 요금제로 이용합니다.`
                      : '변경이 완료되었습니다.'}
                  </p>
                  {unconfirmedResult.admin_note && (
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg text-left">
                      <p className="text-xs text-gray-500 mb-1">관리자 메모</p>
                      <p className="text-sm text-gray-700">{unconfirmedResult.admin_note}</p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">요금제 승인 반려</h3>
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-800">{unconfirmedResult.requested_plan_name}</span> 플랜 신청이<br/>
                    반려되었습니다.
                  </p>
                  {unconfirmedResult.admin_note && (
                    <div className="mt-3 p-3 bg-red-50 rounded-lg text-left">
                      <p className="text-xs text-red-500 mb-1">반려 사유</p>
                      <p className="text-sm text-red-700">{unconfirmedResult.admin_note}</p>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="border-t">
              <button
                onClick={async () => {
                  try {
                    const token = localStorage.getItem('token');
                    await fetch(`/api/companies/plan-request/${unconfirmedResult.id}/confirm`, {
                      method: 'PUT',
                      headers: { Authorization: `Bearer ${token}` },
                    });
                  } catch (e) {
                    console.error('확인 처리 실패:', e);
                  }
                  setShowResultModal(false);
                  setUnconfirmedResult(null);
                  // 승인된 경우 페이지 데이터 새로고침
                  if (unconfirmedResult.status === 'approved') {
                    loadData();
                  }
                }}
                className="w-full px-4 py-3 text-blue-600 font-medium hover:bg-blue-50 transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
