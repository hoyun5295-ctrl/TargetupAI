/**
 * ★ D219+ Part 2 (2026-05-27) — Wizard Step 1: 환영
 */

import { Sparkles, ArrowRight, Zap, BarChart3, Mail } from 'lucide-react';
import type { OnboardingStateData } from '../../pages/OnboardingWizardPage';

interface Props {
  state: OnboardingStateData;
  onNext: () => void;
}

export default function Step1Welcome({ onNext }: Props) {
  return (
    <div className="space-y-6">
      {/* 그라데이션 환영 카드 */}
      <div className="rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-500/20 via-fuchsia-500/15 to-indigo-500/20 p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl md:text-2xl font-bold text-white mb-2">
              30분 안 첫 발송 + ROI 측정 시작
            </h2>
            <p className="text-sm text-white/80 leading-relaxed">
              AI 오퍼레이션 무료체험 30일 동안 한줄로 핵심 기능 전체 무료 개방.
              7 단계로 첫 발송에 도달하고, 매일 9시 자동 인사이트 메일로 성과 추적.
            </p>
          </div>
        </div>
      </div>

      {/* 7 step 가치 카드 — 3 영역 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <Zap className="w-6 h-6 text-amber-400 mb-3" />
          <h3 className="text-sm font-semibold text-white mb-1">즉시 가치</h3>
          <p className="text-[12px] text-white/60 leading-relaxed">
            자연어 1줄로 세그먼트 추출 + AI 본문 생성 + 본인 휴대폰 인증 발송까지 30분.
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <BarChart3 className="w-6 h-6 text-cyan-400 mb-3" />
          <h3 className="text-sm font-semibold text-white mb-1">정확한 추출</h3>
          <p className="text-[12px] text-white/60 leading-relaxed">
            한줄로 운영 검증 안전망. AI 단순 SQL 생성 절대 X — 검증된 필드/연산자만 사용.
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <Mail className="w-6 h-6 text-emerald-400 mb-3" />
          <h3 className="text-sm font-semibold text-white mb-1">매일 인사이트</h3>
          <p className="text-[12px] text-white/60 leading-relaxed">
            매일 9시 자동 인사이트 메일. 한 달 안 30번 자동 성과 추적 + 다음 캠페인 추천.
          </p>
        </div>
      </div>

      {/* 시작 버튼 */}
      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-violet-500/20"
        >
          시작하기 (1/7)
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
