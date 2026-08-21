/**
 * JourneyStepNotifyToggle.tsx — D218+ (2026-05-26) 신설
 *
 * 본질: step별 담당자 알림 (발송 2시간 전 + 발송 결과) ON/OFF/default 3 상태 토글.
 *   - true  = 항상 ON (사용자 명시)
 *   - false = 항상 OFF (사용자 명시 — 첫/마지막 step에서도 X)
 *   - null  = default (첫/마지막 step ON / 중간 step OFF)
 *   - PATCH /api/ai/operator/journeys/:id/steps/:stepId body { notifyManagerOnPretest: true|false|null }
 *
 * 영구 룰 정합:
 *   - feedback_design_quality_minimum_journey_level (다크 톤 + violet 액센트)
 *   - feedback_no_native_browser_dialog (useToast 활용)
 */

import { useState } from 'react';
import { BellRing, BellOff, Sparkles, Loader2 } from 'lucide-react';
import { useToast } from '../ToastProvider';

interface Props {
  journeyId: string;
  stepId: string;
  stepOrder: number;
  totalSteps: number;
  currentValue: boolean | null;
  token: string;
  onChange?: (newValue: boolean | null) => void;
}

type ToggleState = 'on' | 'off' | 'default';

function valueToState(v: boolean | null): ToggleState {
  if (v === true) return 'on';
  if (v === false) return 'off';
  return 'default';
}

function stateToValue(s: ToggleState): boolean | null {
  if (s === 'on') return true;
  if (s === 'off') return false;
  return null;
}

export default function JourneyStepNotifyToggle({
  journeyId, stepId, stepOrder, totalSteps, currentValue, token, onChange,
}: Props) {
  const toast = useToast();
  const [state, setState] = useState<ToggleState>(valueToState(currentValue));
  const [saving, setSaving] = useState(false);

  const isFirstOrLast = stepOrder === 1 || stepOrder === totalSteps;
  const defaultEffective = isFirstOrLast ? 'ON' : 'OFF';

  const onSelect = async (next: ToggleState) => {
    if (saving || next === state) return;
    setSaving(true);
    const oldState = state;
    setState(next);
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/steps/${stepId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ notifyManagerOnPretest: stateToValue(next) }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`담당자 알림 = ${next === 'on' ? '항상 ON' : next === 'off' ? '항상 OFF' : '기본 (첫/마지막 ON)'}`);
        if (onChange) onChange(stateToValue(next));
      } else {
        toast.error(data?.error || '저장 사고');
        setState(oldState);
      }
    } catch (e: any) {
      toast.error(e?.message || '저장 호출 사고');
      setState(oldState);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-white/60">
        <BellRing className="w-3 h-3" />
        담당자 알림 (발송 2시간 전 + 결과)
        {saving && <Loader2 className="w-3 h-3 animate-spin text-violet-300" />}
      </div>
      <div className="inline-flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5 gap-0.5">
        <ToggleBtn
          active={state === 'on'}
          onClick={() => onSelect('on')}
          icon={BellRing}
          label="ON"
          color="emerald"
          disabled={saving}
        />
        <ToggleBtn
          active={state === 'default'}
          onClick={() => onSelect('default')}
          icon={Sparkles}
          label={`기본 (${defaultEffective})`}
          color="violet"
          disabled={saving}
        />
        <ToggleBtn
          active={state === 'off'}
          onClick={() => onSelect('off')}
          icon={BellOff}
          label="OFF"
          color="rose"
          disabled={saving}
        />
      </div>
      <div className="text-[10px] text-white/30 italic">
        Data source: journey_steps.notify_manager_on_pretest · 첫·마지막 step 기본 ON / 중간 기본 OFF
      </div>
    </div>
  );
}

function ToggleBtn({
  active, onClick, icon: Icon, label, color, disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof BellRing;
  label: string;
  color: 'emerald' | 'violet' | 'rose';
  disabled?: boolean;
}) {
  const activeColor = {
    emerald: 'bg-emerald-500/30 text-emerald-100 border-emerald-400/40',
    violet: 'bg-violet-500/30 text-violet-100 border-violet-400/40',
    rose: 'bg-rose-500/30 text-rose-100 border-rose-400/40',
  }[color];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 border transition-all ${
        active ? activeColor : 'border-transparent text-white/50 hover:text-white/80 hover:bg-white/5'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}
