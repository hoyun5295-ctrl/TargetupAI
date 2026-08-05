import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { formatDate } from '../utils/formatDate';
import { isCustomerSelectablePlan } from '../utils/planLabel'; // ★ 2026-07-28 내부 요금제(임직원 등) 노출 차단 — 단일 소스
import { COMPANY_PHONE, COMPANY_PHONE_TEL } from '../constants/company';
import { Sparkles, Users, Server, Cpu } from 'lucide-react';
import CreditSummaryBar from '../components/credit/CreditSummaryBar';
import CreditRechargeModal from '../components/credit/CreditRechargeModal';
import { PLAN_INFRA, planBonusPct, dailyDbAnalysisCredits } from '../constants/credit';
import { useToast } from '../components/ToastProvider';

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

/** 미사용분 소멸·차감 시점을 한 줄로 알린다(설계 §5-1-A 정직성 요구) — 두 화면이 같은 문구를 쓴다. */
const FREE_MESSAGING_NOTE = '매월 제공 · 발송 시도 시점에 차감되며 미사용분은 이월되지 않습니다';

export default function PricingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuthStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [myCredit, setMyCredit] = useState<any>(null);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [requestMessage, setRequestMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successModalType, setSuccessModalType] = useState<'plan' | 'inquiry'>('plan');
  const [showContactModal, setShowContactModal] = useState(false);
  const [showRecharge, setShowRecharge] = useState(false);
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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const token = localStorage.getItem('token');
      
      const plansRes = await fetch('/api/plans', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const plansData = await plansRes.json();
      // CT-17: FREE(미가입) + TRIAL(무료체험) 은 유료 요금제 카드에서 제외
      //   · FREE = 요금제 미가입 상태, 사용자가 선택 대상 아님
      //   · TRIAL = 슈퍼관리자가 부여하는 체험 plan, 사용자 선택 대상 아님
      const sortedPlans = (plansData.plans || [])
        .filter((p: Plan) => isCustomerSelectablePlan(p.plan_code, p.is_active))
        .sort((a: Plan, b: Plan) => a.monthly_price - b.monthly_price);
      setPlans(sortedPlans);

      // 종량제 Phase 5: 내 AI 크레딧 잔여
      try {
        const creditRes = await fetch('/api/companies/my-credit', { headers: { Authorization: `Bearer ${token}` } });
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
    setRequestMessage(`${plan.plan_name} 플랜으로 변경 신청합니다.`);
    setShowRequestModal(true);
  };

  const openInquiryModal = () => {
    setInquiryForm({
      companyName: (companyInfo as any)?.company_name || '',
      contactName: '', phone: '', email: '', planInterest: '', subject: '', message: '',
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

  const handleSubmitRequest = async () => {
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

  // 종량제 — 등급별 기능 차등 폐지(스타터부터 전 기능 동일). 인프라 등급 아이콘만 등급별로 구분.
  const infraIcon = (planCode: string) => {
    if (planCode === 'ENTERPRISE') return Cpu;
    if (planCode === 'BUSINESS') return Server;
    return Users;
  };

  const getRecommendedPlan = () => {
    if (!companyInfo) return null;
    const currentCount = Number(companyInfo.current_customers) || 0;
    const recommended = plans.find(p => p.max_customers >= currentCount && p.plan_code !== 'ENTERPRISE');
    return recommended?.id || null;
  };

  const recommendedPlanId = getRecommendedPlan();

  // 크레딧 시각화 기준값 — 상대 게이지(최대 크레딧 기준)
  const maxCredits = Math.max(1, ...plans.map(p => Number(p.ai_credits_per_month) || 0));

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
              onClick={() => navigate(-1)}
              className="text-gray-600 hover:text-gray-900"
            >
              ← 뒤로
            </button>
            <h1 className="text-xl font-bold text-gray-900">요금제 안내</h1>
          </div>
          <div className="text-sm text-gray-500">
            {(companyInfo as any)?.company_name || user?.name}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {companyInfo && (() => {
          // ★ CT-17: 30일 PRO 무료체험 상태 계산
          //   plan_code='TRIAL'을 진실의 원천으로 사용 (subscription_status에 의존하지 않음).
          //   이유: admin.ts 요금제 승인 API 등 여러 경로가 subscription_status를 'paid'로 덮어쓰는 이슈가 있어
          //   subscription_status 기반 판정은 견고하지 않음. plan_code는 grant-trial/revoke-trial/Cron 강등 3곳에서만 변경됨.
          const isOnTrial = (companyInfo.plan_code === 'TRIAL' || companyInfo.subscription_status === 'trial') && !!companyInfo.trial_expires_at;
          const isTrialExpired = companyInfo.subscription_status === 'trial_expired';
          const isUnsubscribed = companyInfo.plan_code === 'FREE' && !isTrialExpired;
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
              <div className="mb-6 p-4 bg-gradient-to-r from-violet-50 via-purple-50 to-violet-50 border border-violet-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md shadow-violet-200">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-violet-900">
                      현재 무료체험 중인 요금제는 <span className="text-purple-700">{equivalentPlanName} 플랜</span>입니다
                    </p>
                    <p className="text-xs text-violet-700 mt-1 leading-relaxed">
                      고객 DB {formatNumber(Number(companyInfo.max_customers))}명 · AI 메시지 · 자동발송 · 모바일 DM · AI 프리미엄 · 스팸필터 자동화 전 기능 이용 가능
                    </p>
                    {companyInfo.trial_expires_at && (
                      <div className="mt-3 pt-3 border-t border-violet-200/70 flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-1.5 text-xs text-violet-800">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>체험 만료 <b className="font-bold">{formatDate(companyInfo.trial_expires_at)}</b> · <b className="font-bold text-purple-700">{daysRemaining}일</b> 남음</span>
                        </div>
                        <span className="text-[11px] text-violet-500">
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
                        {isTrialExpired ? '미가입' : companyInfo.plan_name}
                      </span>
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

                {/* ★ 2026-08-05 요금제 포함 무료 메시지 — 제공량·사용량·잔여. 제공이 없는 요금제면 통째로 숨긴다. */}
                {freeMessaging?.available && (
                  <div className="mt-5 pt-5 border-t border-gray-100">
                    <div className="flex items-baseline justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-900">요금제 포함 무료 메시지</h3>
                      <span className="text-[11px] text-gray-500">{FREE_MESSAGING_NOTE}</span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {freeMessaging.lines.filter((l) => l.granted > 0).map((l) => {
                        const pct = l.granted > 0 ? Math.min(100, (l.used / l.granted) * 100) : 0;
                        return (
                          <div key={l.type} className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2.5">
                            <div className="flex items-baseline justify-between">
                              <span className="text-xs font-medium text-gray-600">{FREE_TYPE_LABEL[l.type] || l.label}</span>
                              <span className="text-[11px] text-gray-400">{formatNumber(l.granted)}건</span>
                            </div>
                            <div className="mt-1 flex items-baseline gap-1">
                              <span className="text-lg font-bold text-gray-900">{formatNumber(l.remaining)}</span>
                              <span className="text-[11px] text-gray-500">건 남음</span>
                            </div>
                            <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all ${pct >= 100 ? 'bg-gray-400' : 'bg-violet-500'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="mt-1 text-[11px] text-gray-500">{formatNumber(l.used)}건 사용</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

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
            />
          </div>
        )}

        <h2 className="text-lg font-semibold mb-4">요금제 비교</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {plans.map((plan) => {
            const isCurrentPlan = companyInfo?.plan_id === plan.id;
            // ★ CT-17: FREE(미가입) / TRIAL(무료체험)은 아직 유료 구독이 아니므로 모든 유료 플랜이 "업그레이드".
            //   유료 가입자만 max_customers 크기 비교로 업/다운을 구분한다.
            const isFreeOrTrial = companyInfo?.plan_code === 'FREE' || companyInfo?.plan_code === 'TRIAL';
            const isUpgrade = companyInfo && (isFreeOrTrial || plan.max_customers > (companyInfo.max_customers || 0));
            const isRecommended = plan.id === recommendedPlanId && companyInfo?.plan_code === 'FREE';
            // 종량제 크레딧 시각화 (전부 실제 plan 데이터 — 임의 상수 없음)
            const credits = Number(plan.ai_credits_per_month) || 0;
            const creditPct = Math.max(4, Math.round((credits / maxCredits) * 100));
            const bonusPct = planBonusPct(Number(plan.monthly_price) || 0, credits);
            const infra = PLAN_INFRA[plan.plan_code] || { label: '고성능 공유 서버', benefit: '당사 IDC 고성능 서버를 멀티테넌트로 사용', premium: false };
            const InfraIcon = infraIcon(plan.plan_code);
            
            return (
              <div
                key={plan.id}
                className={`relative bg-white rounded-xl overflow-hidden flex flex-col transition-shadow ${
                  isCurrentPlan ? 'ring-2 ring-blue-500 shadow-sm' :
                  isRecommended ? 'ring-2 ring-purple-500 shadow-sm' :
                  infra.premium ? 'ring-1 ring-violet-200 shadow-md shadow-violet-100' : 'shadow-sm'
                }`}
              >
                <div className={`p-4 ${
                  isRecommended ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white' :
                  isCurrentPlan ? 'bg-blue-50' :
                  infra.premium ? 'bg-gradient-to-r from-violet-50 to-fuchsia-50' : 'bg-gray-50'
                }`}>
                  {isRecommended && (
                    <div className="text-xs font-semibold mb-1 text-yellow-300">👉 추천</div>
                  )}
                  {isCurrentPlan && (
                    <div className="text-xs font-semibold mb-1 text-blue-600">현재 플랜</div>
                  )}
                  {!isRecommended && !isCurrentPlan && infra.premium && (
                    <div className="mb-1 inline-flex items-center gap-1 text-[10px] font-bold text-violet-600">
                      <Sparkles className="h-3 w-3" /> 전용 인프라
                    </div>
                  )}
                  <h3 className={`text-lg font-bold ${
                    isRecommended ? 'text-white' : 'text-gray-900'
                  }`}>
                    {plan.plan_name}
                  </h3>
                  <div className={`text-2xl font-bold mt-2 ${
                    isRecommended ? 'text-white' : 'text-gray-900'
                  }`}>
                    {formatPrice(plan.monthly_price)}
                    <span className={`text-sm font-normal ${
                      isRecommended ? 'text-blue-200' : 'text-gray-500'
                    }`}>/월</span>
                  </div>
                  <div className={`text-xs mt-1 ${
                    isRecommended ? 'text-blue-200' : 'text-gray-400'
                  }`}>VAT 별도</div>
                </div>

                <div className="p-4 flex-1 flex flex-col">
                  {/* 월 AI 크레딧 — 히어로 */}
                  {credits > 0 ? (
                    <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-3 mb-3">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-medium text-violet-700">월 AI 크레딧</div>
                        {bonusPct > 0 && (
                          <span className="rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-1.5 py-0.5 text-[9px] font-bold text-white">보너스 +{bonusPct}%</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-end gap-1">
                        <span className="text-2xl font-bold tabular-nums text-slate-900">{formatNumber(credits)}</span>
                        <span className="mb-0.5 text-[11px] text-slate-400">크레딧</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${creditPct}%` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-3 mb-3 text-[11px] text-slate-500">
                      월 AI 크레딧 <b className="text-violet-700">맞춤 산정</b> · 상담 시 안내
                    </div>
                  )}

                  {/* 인프라 등급 — 비즈니스·엔터 전용 강조 */}
                  <div className={`rounded-xl border p-2.5 mb-3 ${infra.premium ? 'border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50' : 'border-gray-100 bg-gray-50'}`}>
                    <div className="flex items-center gap-1.5">
                      <InfraIcon className={`h-4 w-4 flex-shrink-0 ${infra.premium ? 'text-violet-600' : 'text-slate-400'}`} />
                      <span className={`text-xs font-bold ${infra.premium ? 'text-violet-800' : 'text-slate-600'}`}>{infra.label}</span>
                      {infra.premium && (
                        <span className="ml-auto rounded-full bg-violet-600 px-1.5 py-0.5 text-[9px] font-bold text-white">전용</span>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] leading-snug text-slate-400">{infra.benefit}</div>
                  </div>

                  <div className="mt-auto pt-4">
                    {isCurrentPlan ? (
                      <button
                        disabled
                        className="w-full py-2 px-4 bg-gray-100 text-gray-500 rounded-lg cursor-not-allowed"
                      >
                        이용 중
                      </button>
                    ) : hasPending ? (
                      <button
                        disabled
                        className="w-full py-2 px-4 bg-yellow-50 text-yellow-600 border border-yellow-200 rounded-lg cursor-not-allowed text-sm"
                      >
                        신청 대기 중
                      </button>
                    ) : isUpgrade ? (
                      <button
                        onClick={() => handleRequestPlan(plan)}
                        className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                          isRecommended 
                            ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        업그레이드 신청
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRequestPlan(plan)}
                        className="w-full py-2 px-4 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
                      >
                        다운그레이드 신청
                      </button>
                    )}

                    {/* ★ 2026-08-05 요금제 가입 메리트 — 이 요금제에 포함된 무료 메시지. `plans` 파생이라 화면에 수량을 적지 않는다. */}
                    {(() => {
                      const quota = freeMessaging?.planQuotas?.[plan.plan_code];
                      const entries = Object.entries(quota || {}).filter(([, v]) => Number(v) > 0);
                      if (entries.length === 0) return null;
                      return (
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <div className="text-[11px] font-medium text-gray-700 mb-1.5">포함된 무료 메시지</div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                            {entries.map(([type, qty]) => (
                              <div key={type} className="flex items-baseline justify-between">
                                <span className="text-[11px] text-gray-500">{FREE_TYPE_LABEL[type] || type}</span>
                                <span className="text-xs font-semibold text-gray-900">{formatNumber(Number(qty))}건</span>
                              </div>
                            ))}
                          </div>
                          <div className="mt-1.5 text-[10px] text-gray-400 leading-snug">{FREE_MESSAGING_NOTE}</div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

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
                      <td className="py-2 pl-4 text-right text-gray-600 tabular-nums">{(daily * 30).toLocaleString()} 크레딧</td>
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
                onClick={openInquiryModal}
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
                onClick={handleSubmitRequest}
                disabled={submitting}
                className="flex-1 px-4 py-3 text-blue-600 font-medium hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                {submitting ? '신청 중...' : '신청하기'}
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
                  navigate('/dashboard');
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
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">요금제 변경 완료</h3>
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-blue-600">{unconfirmedResult.requested_plan_name}</span> 플랜으로<br/>
                    변경이 완료되었습니다.
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
