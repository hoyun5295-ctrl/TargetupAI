import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { formatDate } from '../utils/formatDate';
import { COMPANY_PHONE, COMPANY_PHONE_TEL } from '../constants/company';

interface Plan {
  id: string;
  plan_code: string;
  plan_name: string;
  max_customers: number;
  monthly_price: number;
  is_active: boolean;
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

export default function PricingPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [requestMessage, setRequestMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successModalType, setSuccessModalType] = useState<'plan' | 'inquiry'>('plan');
  const [showContactModal, setShowContactModal] = useState(false);
  const [inquiryForm, setInquiryForm] = useState({
    companyName: '', contactName: '', phone: '', email: '', planInterest: '', subject: '', message: '',
  });
  const [inquirySubmitting, setInquirySubmitting] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [pendingPlanName, setPendingPlanName] = useState('');
  const [unconfirmedResult, setUnconfirmedResult] = useState<any>(null);
  const [showResultModal, setShowResultModal] = useState(false);

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
        .filter((p: Plan) => p.plan_code !== 'FREE' && p.plan_code !== 'TRIAL' && p.is_active)
        .sort((a: Plan, b: Plan) => a.monthly_price - b.monthly_price);
      setPlans(sortedPlans);

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

  const handleInquirySubmit = async () => {
    if (!inquiryForm.contactName || !inquiryForm.phone || !inquiryForm.email || !inquiryForm.subject || !inquiryForm.message) {
      alert('필수 항목을 모두 입력해주세요.');
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
        alert(data.error || '문의 전송에 실패했습니다.');
      }
    } catch {
      alert('문의 전송 중 오류가 발생했습니다.');
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
          alert(data.error || '신청 실패');
        }
      }
    } catch (error) {
      alert('신청 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const getUsagePercent = () => {
    if (!companyInfo || !companyInfo.max_customers) return 0;
    return Math.min(100, (Number(companyInfo.current_customers) / Number(companyInfo.max_customers)) * 100);
  };

  const getPlanFeatures = (planCode: string) => {
    const features: Record<string, string[]> = {
      STARTER: ['기본 SMS/LMS/MMS 발송', '엑셀 업로드 · AI 자동매핑', '직접타겟발송', '캘린더 관리', '발송 결과 조회', '스팸필터 테스트'],
      BASIC: ['STARTER 기능 포함', 'AI 타겟 추천', 'AI 문구 생성', 'AI 추천발송'],
      PRO: [
        'BASIC 기능 포함',
        '자동발송 5건 · AI 문안생성',
        '캠페인 성과분석 · 리타겟팅',
        '모바일 DM 제작',
        '스팸필터 테스트 자동화',
        '실시간 DB 동기화',
      ],
      BUSINESS: [
        'PRO 기능 포함',
        'AI 마케팅분석(고급)',
        '자동발송 10건',
        '맞춤 리포트',
        '전담 매니저 · SLA 보장',
      ],
      ENTERPRISE: [
        'BUSINESS 기능 포함',
        '자동발송 무제한',
        '온프레미스 설치',
        '커스텀 개발 · 24/7 지원',
      ],
    };
    return features[planCode] || [];
  };

  const getRecommendedPlan = () => {
    if (!companyInfo) return null;
    const currentCount = Number(companyInfo.current_customers) || 0;
    const recommended = plans.find(p => p.max_customers >= currentCount && p.plan_code !== 'ENTERPRISE');
    return recommended?.id || null;
  };

  const recommendedPlanId = getRecommendedPlan();

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
          const isOnTrial = companyInfo.plan_code === 'TRIAL' && !!companyInfo.trial_expires_at;
          const isTrialExpired = companyInfo.subscription_status === 'trial_expired';
          const isUnsubscribed = companyInfo.plan_code === 'FREE' && !isTrialExpired;
          const daysRemaining = isOnTrial && companyInfo.trial_expires_at
            ? Math.max(0, Math.ceil((new Date(companyInfo.trial_expires_at).getTime() - Date.now()) / 86400000))
            : 0;
          // ★ 체험 중인 플랜과 동일한 max_customers를 가진 유료 플랜 이름 동적 매칭 (TRIAL=1M → PRO)
          const equivalentPlan = plans.find(p => Number(p.max_customers) === Number(companyInfo.max_customers));
          const equivalentPlanName = equivalentPlan?.plan_name || '프로';
          return (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">현재 이용 중인 플랜</h2>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-2xl font-bold text-blue-600">
                    {isOnTrial ? '무료체험중' : (isTrialExpired ? '미가입' : companyInfo.plan_name)}
                  </span>
                  {isOnTrial && (
                    <span className="text-sm text-gray-500 font-medium">
                      (요금제 프로플랜 체험)
                    </span>
                  )}
                  {isOnTrial && (
                    <span className="px-2.5 py-1 bg-violet-100 text-violet-800 text-xs font-bold rounded-full whitespace-nowrap">
                      D-{daysRemaining}
                    </span>
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

            {/* ★ CT-17: 무료체험 안내 카드 — 동급 유료 플랜 명시 + 이용 가능 기능 + 만료일·D-N 재강조 */}
            {isOnTrial && (
              <div className="mt-5 p-4 bg-gradient-to-r from-violet-50 via-purple-50 to-violet-50 border border-violet-200 rounded-xl">
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

            {isTrialExpired && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">
                  ⚠️ 무료 체험 기간이 만료되었습니다. AI 기능을 계속 사용하려면 유료 플랜으로 업그레이드해주세요.
                </p>
              </div>
            )}
          </div>
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

        <h2 className="text-lg font-semibold mb-4">요금제 비교</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {plans.map((plan) => {
            const isCurrentPlan = companyInfo?.plan_id === plan.id;
            // ★ CT-17: FREE(미가입) / TRIAL(무료체험)은 아직 유료 구독이 아니므로 모든 유료 플랜이 "업그레이드".
            //   유료 가입자만 max_customers 크기 비교로 업/다운을 구분한다.
            const isFreeOrTrial = companyInfo?.plan_code === 'FREE' || companyInfo?.plan_code === 'TRIAL';
            const isUpgrade = companyInfo && (isFreeOrTrial || plan.max_customers > (companyInfo.max_customers || 0));
            const isRecommended = plan.id === recommendedPlanId && companyInfo?.plan_code === 'FREE';
            
            return (
              <div
                key={plan.id}
                className={`bg-white rounded-xl shadow-sm overflow-hidden flex flex-col ${
                  isCurrentPlan ? 'ring-2 ring-blue-500' : ''
                } ${isRecommended ? 'ring-2 ring-purple-500' : ''}`}
              >
                <div className={`p-4 ${
                  isRecommended ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white' :
                  isCurrentPlan ? 'bg-blue-50' : 'bg-gray-50'
                }`}>
                  {isRecommended && (
                    <div className="text-xs font-semibold mb-1 text-yellow-300">👉 추천</div>
                  )}
                  {isCurrentPlan && (
                    <div className="text-xs font-semibold mb-1 text-blue-600">현재 플랜</div>
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
                  <div className="text-sm text-gray-600 mb-3">
                    관리 가능 DB <span className="font-semibold text-gray-900">{plan.plan_code === 'ENTERPRISE' ? '제한없음' : `${formatNumber(plan.max_customers)}명`}</span>
                  </div>
                  
                  <ul className="space-y-2 text-sm">
                    {getPlanFeatures(plan.plan_code).map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-gray-600">{feature}</span>
                      </li>
                    ))}
                  </ul>

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
                    ) : plan.max_customers < Number(companyInfo?.current_customers || 0) ? (
                      <button
                        disabled
                        className="w-full py-2 px-4 bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed text-sm"
                      >
                        현재 DB 초과
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
                  </div>
                </div>
              </div>
            );
          })}
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
