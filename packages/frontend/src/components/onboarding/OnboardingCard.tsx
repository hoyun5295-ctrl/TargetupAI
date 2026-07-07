/**
 * ★ D219+ Part 2 (2026-05-27 신설) — Dashboard 안 Onboarding 진입 안내 카드
 *
 * 노출 조건:
 *   - AI 오퍼레이션 무료체험 활성 (ai_operator_trial_until > NOW())
 *   - Wizard 미종결 (completed_at IS NULL)
 *   - 24h dismiss cooldown 미적용
 *
 * 액션:
 *   - "지금 시작" → /onboarding 라우트 진입
 *   - "오늘 하루 보지 않기" → 24h localStorage cooldown 기록 + 카드 자동 숨김
 *   - X 닫기 → 본 세션 안 단순 숨김 (다음 로그인 재노출)
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, X, Clock } from 'lucide-react';
import { isWizardDismissedNow, dismissWizardForToday } from '../../pages/OnboardingWizardPage';

interface TrialInfo {
  active: boolean;
  until: string | null;
}

interface StateInfo {
  currentStep: number;
  completedSteps: number[];
  completedAt: string | null;
}

export default function OnboardingCard() {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [trial, setTrial] = useState<TrialInfo | null>(null);
  const [state, setState] = useState<StateInfo | null>(null);
  const [sessionHidden, setSessionHidden] = useState(false);

  useEffect(() => {
    if (isWizardDismissedNow()) {
      setVisible(false);
      return;
    }
    fetchOnboardingState();
  }, []);

  async function fetchOnboardingState() {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/onboarding/state', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setVisible(false);
        return;
      }
      const data = await res.json();
      if (!data?.trial?.active || data?.state?.completedAt) {
        setVisible(false);
        return;
      }
      setTrial(data.trial);
      setState({
        currentStep: data.state.currentStep,
        completedSteps: data.state.completedSteps || [],
        completedAt: data.state.completedAt,
      });
      setVisible(true);
    } catch {
      setVisible(false);
    }
  }

  if (!visible || sessionHidden || !trial || !state) return null;

  const daysRemaining = trial.until
    ? Math.max(0, Math.ceil((new Date(trial.until).getTime() - Date.now()) / 86400000))
    : 0;
  const completed = state.completedSteps.length;
  const progressPct = Math.round((completed / 7) * 100);

  return (
    <div className="mx-4 md:mx-6 mt-4 mb-2">
      <div className="rounded-2xl border border-violet-400/40 bg-gradient-to-br from-violet-600/95 via-fuchsia-600/90 to-indigo-600/95 p-5 md:p-6 shadow-lg shadow-violet-900/30 relative">
        <button
          onClick={() => setSessionHidden(true)}
          className="absolute top-3 right-3 text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10"
          aria-label="이 세션에서 숨기기"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-start gap-3 flex-1">
            <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <h3 className="text-base md:text-lg font-bold text-white">
                  {completed === 0 ? 'AI 오퍼레이션 시작하기' : 'AI 오퍼레이션 계속하기'}
                </h3>
              </div>
              <p className="text-[12px] text-white/85 leading-relaxed">
                {completed === 0
                  ? '30분 안 첫 발송 + 매일 9시 인사이트 메일 활성. 7 단계 (각 5분 안)로 가치를 즉시 확인하세요.'
                  : `${completed}/7 단계 완성. 다음 단계 (${state.currentStep})에서 이어 진행하세요.`}
              </p>

              {/* 진행률 bar */}
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/80 transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="text-[11px] text-white/80 font-mono whitespace-nowrap">{progressPct}%</span>
              </div>

              <p className="mt-2 text-[10px] text-white/70 flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                무료체험 D-{daysRemaining}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 flex-shrink-0">
            <button
              onClick={() => navigate('/onboarding')}
              className="flex items-center justify-center gap-1.5 px-5 py-2.5 bg-white hover:bg-white/90 text-violet-700 rounded-xl text-sm font-bold shadow-md"
            >
              {completed === 0 ? '지금 시작' : '이어 진행'}
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                dismissWizardForToday();
                setVisible(false);
              }}
              className="text-[11px] text-white/70 hover:text-white px-3 py-1.5"
            >
              오늘 하루 보지 않기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
