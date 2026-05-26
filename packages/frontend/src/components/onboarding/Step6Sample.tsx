/**
 * ★ D219+ Part 2 (2026-05-27) — Wizard Step 6: 샘플 발송 (단순 안내)
 *
 * admin 본인 phone 인증 라인 무료 발송 안내. 본 step에서는 입력 + 진행 안내만.
 * 실제 발송 = 기존 direct-send 흐름 활용 정합 (단순 saveStep + 다음 진입).
 */

import { useState } from 'react';
import { Send, ArrowRight, Check, AlertCircle } from 'lucide-react';
import type { OnboardingStateData } from '../../pages/OnboardingWizardPage';

interface Props {
  state: OnboardingStateData;
  onNext: () => void;
  onSync: () => void;
}

export default function Step6Sample({ state, onNext, onSync }: Props) {
  const completed = state.completedSteps.includes(6);
  const [phone, setPhone] = useState(state.sampleSentToPhone || '');
  const [saving, setSaving] = useState(false);

  async function handleMarkSent() {
    if (!phone.trim()) return;
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      await fetch('/api/onboarding/step-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          stepNum: 6,
          data: { sampleSentToPhone: phone.trim(), sampleSentAt: new Date().toISOString() },
        }),
      });
      onSync();
    } catch (e) {
      console.error('handleMarkSent 실패:', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center flex-shrink-0">
            <Send className="w-5 h-5 text-emerald-300" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-white mb-1.5">본인 휴대폰 인증 라인 무료 샘플 발송</h2>
            <p className="text-[12px] text-white/65 leading-relaxed">
              발신번호 검수 통과 전에도 본인 휴대폰으로 즉시 발송할 수 있습니다 (인증 라인 — 무료체험 잔액 차감 X).
              실제 발송된 메시지를 확인하고 첫 가치를 즉시 경험하세요.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
          <div className="text-[12px] text-amber-100 leading-relaxed">
            <p className="font-semibold mb-1">샘플 발송 안내</p>
            <p className="text-amber-100/80">
              · 본인 휴대폰만 발송 가능 (인증 라인)<br />
              · 검수 통과 전 = 일반 고객 발송 불가<br />
              · 발송 결과는 직접발송 메뉴에서 확인 가능
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <label className="text-[11px] text-white/50 mb-1.5 block">본인 휴대폰 번호</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="010-1234-5678"
          className="w-full bg-slate-950/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-400/50"
        />
        <button
          onClick={handleMarkSent}
          disabled={!phone.trim() || saving}
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-30 text-white rounded-lg text-sm font-semibold"
        >
          <Send className="w-4 h-4" />
          {saving ? '기록 중...' : '샘플 발송 기록'}
        </button>
        {state.sampleSentAt && (
          <p className="text-[11px] text-emerald-300 mt-2">
            ✓ 마지막 샘플 발송: {new Date(state.sampleSentAt).toLocaleString('ko-KR')}
          </p>
        )}
      </div>

      <div className="flex justify-between items-center pt-4 border-t border-white/10">
        <p className="text-[11px] text-white/40">
          {completed ? '✓ 완성된 step.' : '샘플 발송 기록 후 다음 단계로 진입하세요.'}
        </p>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-500 hover:bg-violet-600 text-white rounded-lg text-sm font-semibold"
        >
          {completed ? <Check className="w-4 h-4" /> : null}
          다음 단계 (7/7)
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
