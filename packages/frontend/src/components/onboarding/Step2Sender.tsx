/**
 * ★ D219+ Part 2 (2026-05-27) — Wizard Step 2: 발신번호 + 서류 업로드
 *
 * 기존 sender-registration 메뉴 안내 + 본 step에서는 외부 메뉴로 이동 안내만.
 */

import { useNavigate } from 'react-router-dom';
import { Phone, ExternalLink, AlertCircle, ArrowRight, Check } from 'lucide-react';
import type { OnboardingStateData } from '../../pages/OnboardingWizardPage';

interface Props {
  state: OnboardingStateData;
  onNext: () => void;
  onSync: () => void;
}

export default function Step2Sender({ state, onNext, onSync }: Props) {
  const navigate = useNavigate();
  const completed = state.completedSteps.includes(2);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center flex-shrink-0">
            <Phone className="w-5 h-5 text-cyan-300" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-white mb-1.5">발신번호 등록 + 서류 업로드</h2>
            <p className="text-[12px] text-white/65 leading-relaxed">
              실제 고객 발송을 위해서는 카카오 검수가 필요합니다. 단 본 무료체험 안 샘플 발송 (Step 6)은 인증 라인 사용으로 검수 통과 전에도 즉시 가능합니다.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
          <div className="text-[12px] text-amber-100 leading-relaxed">
            <p className="font-semibold mb-1">검수 흐름 안내</p>
            <p className="text-amber-100/80">
              · 발신번호 + 서류 등록 → 운영팀 즉시 검수 (1시간 안)<br />
              · 검수 통과 전 = 인증 라인 사용 (본인 휴대폰 발송만 가능)<br />
              · 검수 통과 후 = 일반 라인 사용 (전체 고객 발송 가능)
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => navigate('/sender-registration')}
          className="flex items-center gap-2 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg text-sm font-semibold"
        >
          <ExternalLink className="w-4 h-4" />
          발신번호 등록 메뉴로 이동
        </button>
        <button
          onClick={onSync}
          className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 rounded-lg text-sm"
        >
          상태 새로고침
        </button>
      </div>

      <div className="flex justify-between items-center pt-4 border-t border-white/10">
        <p className="text-[11px] text-white/40">
          {completed ? '✓ 완성된 step. 건너뛰어도 됩니다.' : '발신번호 등록 후 다음 단계로 진입하세요.'}
        </p>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-500 hover:bg-violet-600 text-white rounded-lg text-sm font-semibold"
        >
          {completed ? <Check className="w-4 h-4" /> : null}
          다음 단계 (3/7)
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
