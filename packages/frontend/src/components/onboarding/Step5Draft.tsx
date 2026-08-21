/**
 * ★ D219+ Part 2 (2026-05-27) — Wizard Step 5: 본문 작성 (단순 안내)
 *
 * 기존 직접발송 + AI 다듬기 메뉴 활용 안내. 본 step에서는 본문 자유 입력 + 다음 진입.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, ExternalLink, ArrowRight, Check, Sparkles } from 'lucide-react';
import type { OnboardingStateData } from '../../pages/OnboardingWizardPage';

interface Props {
  state: OnboardingStateData;
  onNext: () => void;
  onSync: () => void;
}

export default function Step5Draft({ state, onNext, onSync }: Props) {
  const navigate = useNavigate();
  const completed = state.completedSteps.includes(5);
  const [draft, setDraft] = useState(state.draftedMessageTemplate || '');
  const [saving, setSaving] = useState(false);

  async function handleSaveDraft() {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      await fetch('/api/onboarding/step-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stepNum: 5, data: { draftedMessageTemplate: draft } }),
      });
      onSync();
    } catch (e) {
      console.error('handleSaveDraft 실패:', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center flex-shrink-0">
            <MessageSquare className="w-5 h-5 text-indigo-300" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-white mb-1.5">본문 작성 + AI 다듬기</h2>
            <p className="text-[12px] text-white/65 leading-relaxed">
              본문 골격을 입력하고 AI 다듬기로 풍성한 광고 카피로 변환할 수 있습니다.
              구체 혜택 (%, 원, 쿠폰)은 직접 작성해주세요. AI는 임의 생성하지 않습니다.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <label className="text-[11px] text-white/50 mb-1.5 block">본문 골격</label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="예: 안녕하세요 {name}님! 이번 주말 한정 [직접 작성해주세요] 이벤트 진행합니다. 매장에서 만나뵐게요."
          className="w-full bg-slate-950/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-400/50"
          rows={5}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[10px] text-white/35">{draft.length}자 · {draft.length <= 90 ? 'SMS' : 'LMS'} 발송</p>
          <div className="flex gap-2">
            <button
              onClick={handleSaveDraft}
              disabled={saving}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 rounded-lg text-xs"
            >
              임시 저장
            </button>
            <button
              onClick={() => navigate('/direct-send')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-semibold"
            >
              <Sparkles className="w-3 h-3" />
              AI 다듬기 메뉴
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center pt-4 border-t border-white/10">
        <p className="text-[11px] text-white/40">
          {completed ? '✓ 완성된 step.' : '본문 골격 입력 후 다음 단계로 진입하세요.'}
        </p>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-500 hover:bg-violet-600 text-white rounded-lg text-sm font-semibold"
        >
          {completed ? <Check className="w-4 h-4" /> : null}
          다음 단계 (6/7)
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
