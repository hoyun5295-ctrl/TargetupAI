/**
 * ★ D219+ Part 2 (2026-05-27 신설) — AI 오퍼레이션 무료체험 사용자 온보딩 Wizard
 *
 * 🎯 Harold 명시 본질 (2026-05-26): "강압 X + 사용자 자유 닫기 + 오늘 하루 보지 않기 옵션 (24h cooldown)"
 *
 * 7 step 흐름 + 진행률 카드 + skip + 재진입 가능.
 * 보라 톤 (violet 그라데이션) + 액센트 (D222+ Phase 3 정정 — D215+ design_quality_minimum_journey_level 정합).
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Sparkles, ChevronRight, ChevronLeft,
  Check, ArrowRight, Clock, AlertCircle,
} from 'lucide-react';
import Step1Welcome from '../components/onboarding/Step1Welcome';
import Step2Sender from '../components/onboarding/Step2Sender';
import Step3Import from '../components/onboarding/Step3Import';
import Step4Segment from '../components/onboarding/Step4Segment';
import Step5Draft from '../components/onboarding/Step5Draft';
import Step6Sample from '../components/onboarding/Step6Sample';
import Step7Roi from '../components/onboarding/Step7Roi';
// ★ 2026-07-18 (Codex M1 재시도 라운드): "오늘 하루 보지 않기" 헬퍼를 lib/onboarding-dismiss로 분리 —
//   OnboardingCard(대시보드 정적 그래프)가 이 페이지를 import하지 않게 해 Dashboard↔위저드 청크 격리.
import { dismissWizardForToday, clearWizardDismiss } from '../lib/onboarding-dismiss';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface OnboardingStateData {
  id: string;
  companyId: string;
  userId: string;
  currentStep: number;
  completedSteps: number[];
  senderRegistrationId: string | null;
  importedCustomerCount: number;
  importColumnMapping: any;
  savedSegmentId: string | null;
  draftedMessageTemplate: string | null;
  draftedMessageSubject: string | null;
  sampleSentAt: string | null;
  sampleSentToPhone: string | null;
  dailyInsightEnabled: boolean;
  completedAt: string | null;
}

interface TrialInfo {
  active: boolean;
  startedAt: string | null;
  until: string | null;
}

// ════════════════════════════════════════════════════════════════════
// 7 step 정의
// ════════════════════════════════════════════════════════════════════

const STEPS = [
  { num: 1, title: '환영', desc: '회사 정보 확인' },
  { num: 2, title: '발신번호', desc: '서류 업로드 + 즉시 검수' },
  { num: 3, title: '고객 임포트', desc: 'AI 자동 컬럼 매핑' },
  { num: 4, title: '세그먼트', desc: '자연어 → 자동 추출' },
  { num: 5, title: '본문 작성', desc: '자연어 → AI 본문' },
  { num: 6, title: '샘플 발송', desc: '본인 휴대폰 인증' },
  { num: 7, title: 'ROI 측정', desc: '매일 9시 인사이트' },
];

// ════════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ════════════════════════════════════════════════════════════════════

export default function OnboardingWizardPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<OnboardingStateData | null>(null);
  const [trial, setTrial] = useState<TrialInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(1);

  useEffect(() => {
    loadState();
  }, []);

  async function loadState() {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/onboarding/state', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.code === 'AI_OPERATOR_TRIAL_INACTIVE') {
          setError(data.error);
          return;
        }
        if (data?.code === 'DB_MIGRATION_PENDING') {
          setError(data.error);
          return;
        }
        throw new Error(data?.error || 'Wizard 상태 조회 실패');
      }
      setState(data.state);
      setTrial(data.trial);
      // 종결되지 않은 다음 step 자동 진입
      const nextStep = data.state?.completedAt
        ? 7
        : Math.max(1, Math.min(7, Number(data.state?.currentStep || 1)));
      setActiveStep(nextStep);
    } catch (e: any) {
      setError(e?.message || 'Wizard 상태 조회 실패');
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    navigate('/dashboard');
  }

  function handleDismissToday() {
    dismissWizardForToday();
    navigate('/dashboard');
  }

  function handlePrev() {
    setActiveStep((s) => Math.max(1, s - 1));
  }

  async function handleNextStep(stepNum: number) {
    if (!state) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/onboarding/step-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stepNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '단계 완성 실패');
      setState(data.state);
      setActiveStep(Math.min(7, stepNum + 1));
    } catch (e: any) {
      console.error('handleNextStep 실패:', e);
    }
  }

  async function handleCompleteWizard(dailyInsightEnabled: boolean) {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dailyInsightEnabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Wizard 종결 실패');
      clearWizardDismiss();
      navigate('/dashboard');
    } catch (e: any) {
      console.error('handleCompleteWizard 실패:', e);
    }
  }

  // ════════════════════════════════════════════════════
  // 렌더링
  // ════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 flex items-center justify-center">
        <div className="text-white/60 text-sm">Wizard 로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-violet-900/40 border border-rose-500/30 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <AlertCircle className="w-6 h-6 text-rose-400" />
            <h2 className="text-lg font-semibold text-white">Wizard 진입 불가</h2>
          </div>
          <p className="text-sm text-white/70 leading-relaxed mb-5">{error}</p>
          <button
            onClick={handleClose}
            className="w-full px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium"
          >
            대시보드로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  const daysRemaining = trial?.until
    ? Math.max(0, Math.ceil((new Date(trial.until).getTime() - Date.now()) / 86400000))
    : 0;

  return (
    // ★ D222+ Phase 3 (2026-05-27): 다크 → 보라 그라데이션 톤 다운
    <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white">
      {/* sticky 헤더 — D222+ Phase 3 보라 톤 다운 */}
      <div className="sticky top-0 z-30 bg-violet-800/50 backdrop-blur-md border-b border-violet-400/30">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base md:text-lg font-bold text-white">AI 오퍼레이션 시작하기</h1>
                </div>
                <p className="text-[11px] text-white/50 mt-0.5 flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  무료체험 D-{daysRemaining} · 7 단계 (각 5분 안)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleDismissToday}
                className="text-xs text-white/60 hover:text-white px-3 py-2 rounded-lg hover:bg-white/5"
                title="다음 로그인 시 24시간 동안 재노출 안됨"
              >
                오늘 하루 보지 않기
              </button>
              <button
                onClick={handleClose}
                className="text-white/60 hover:text-white p-2 rounded-lg hover:bg-white/5"
                aria-label="닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* 진행률 카드 — 7 step */}
          <div className="mt-4 grid grid-cols-7 gap-1.5">
            {STEPS.map((step) => {
              const completed = state?.completedSteps?.includes(step.num);
              const active = activeStep === step.num;
              return (
                <button
                  key={step.num}
                  onClick={() => setActiveStep(step.num)}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    active
                      ? 'bg-violet-500/20 border-violet-400/50'
                      : completed
                      ? 'bg-emerald-500/10 border-emerald-400/30'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {completed ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <span className={`text-[10px] font-bold ${active ? 'text-violet-300' : 'text-white/40'}`}>
                        {step.num}
                      </span>
                    )}
                    <span className={`text-[10px] font-semibold truncate ${active ? 'text-white' : 'text-white/60'}`}>
                      {step.title}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 본문 — 활성 step */}
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        {state && (
          <>
            {activeStep === 1 && <Step1Welcome state={state} onNext={() => handleNextStep(1)} />}
            {activeStep === 2 && <Step2Sender state={state} onNext={() => handleNextStep(2)} onSync={loadState} />}
            {activeStep === 3 && <Step3Import state={state} onNext={() => handleNextStep(3)} onSync={loadState} />}
            {activeStep === 4 && <Step4Segment state={state} onNext={() => handleNextStep(4)} onSync={loadState} />}
            {activeStep === 5 && <Step5Draft state={state} onNext={() => handleNextStep(5)} onSync={loadState} />}
            {activeStep === 6 && <Step6Sample state={state} onNext={() => handleNextStep(6)} onSync={loadState} />}
            {activeStep === 7 && <Step7Roi state={state} onComplete={handleCompleteWizard} />}
          </>
        )}

        {/* 이전/다음 네비게이션 */}
        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={handlePrev}
            disabled={activeStep === 1}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            이전
          </button>

          <p className="text-[11px] text-white/40">
            Wizard는 언제든 종료할 수 있어요. 다시 진입은 대시보드 카드에서.
          </p>

          <button
            onClick={() => setActiveStep((s) => Math.min(7, s + 1))}
            disabled={activeStep === 7}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            다음
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Source caption (D215+ design_quality 정합) */}
      <div className="max-w-4xl mx-auto px-4 md:px-6 pb-8">
        <p className="text-[10px] text-white/30 italic text-center">
          Data source: AI 오퍼레이션 Wizard 자동 생성 (자연어 입력 → AI 자동 변환 → 검증된 필터 SQL 빌더 통과)
        </p>
      </div>
    </div>
  );
}
