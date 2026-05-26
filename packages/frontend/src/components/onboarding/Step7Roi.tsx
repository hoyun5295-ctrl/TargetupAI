/**
 * ★ D219+ Part 2 (2026-05-27) — Wizard Step 7: ROI 측정 + 매일 9시 인사이트 메일 활성
 */

import { useState } from 'react';
import { Mail, Check, Sparkles, TrendingUp, Calendar } from 'lucide-react';
import type { OnboardingStateData } from '../../pages/OnboardingWizardPage';

interface Props {
  state: OnboardingStateData;
  onComplete: (dailyInsightEnabled: boolean) => void;
}

export default function Step7Roi({ state, onComplete }: Props) {
  const [enabled, setEnabled] = useState(state.dailyInsightEnabled);
  const [completing, setCompleting] = useState(false);

  async function handleFinish() {
    setCompleting(true);
    await onComplete(enabled);
  }

  return (
    <div className="space-y-5">
      {/* 환영 카드 */}
      <div className="rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/15 to-teal-500/10 p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white mb-2">거의 다 왔어요!</h2>
            <p className="text-[13px] text-white/80 leading-relaxed">
              마지막 단계 — 매일 9시 자동 인사이트 메일을 활성화하면 한 달 안 30번 자동 성과 추적 + 다음 캠페인 추천을 받을 수 있어요.
            </p>
          </div>
        </div>
      </div>

      {/* 매일 9시 메일 토글 카드 */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center flex-shrink-0">
            <Mail className="w-5 h-5 text-emerald-300" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-base font-semibold text-white">매일 9시 인사이트 메일</h3>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>
            <p className="text-[12px] text-white/65 leading-relaxed">
              회사 admin 이메일로 매일 오전 9시 자동 발송. 어제 발송 결과 + 활성 고객 수 + 오늘의 추천을 한 눈에 확인.
            </p>
          </div>
        </div>
      </div>

      {/* 가치 카드 3 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <TrendingUp className="w-5 h-5 text-cyan-400 mb-2" />
          <h4 className="text-[12px] font-semibold text-white mb-1">성과 추적</h4>
          <p className="text-[11px] text-white/60">매일 자동 발송 통계 + 트렌드 분석</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <Calendar className="w-5 h-5 text-fuchsia-400 mb-2" />
          <h4 className="text-[12px] font-semibold text-white mb-1">한 달 30번</h4>
          <p className="text-[11px] text-white/60">무료체험 동안 30일 매일 자동 가치 인지</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <Sparkles className="w-5 h-5 text-violet-400 mb-2" />
          <h4 className="text-[12px] font-semibold text-white mb-1">AI 추천</h4>
          <p className="text-[11px] text-white/60">고객 데이터 기반 다음 캠페인 추천</p>
        </div>
      </div>

      {/* 종결 버튼 */}
      <div className="pt-4 border-t border-white/10 flex justify-end">
        <button
          onClick={handleFinish}
          disabled={completing}
          className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 text-white rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/20"
        >
          <Check className="w-4 h-4" />
          {completing ? '종결 중...' : 'Wizard 완성 + 대시보드로'}
        </button>
      </div>
    </div>
  );
}
