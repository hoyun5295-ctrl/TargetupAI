/**
 * JourneyStepNotifyToggle.tsx — D218+ (2026-05-26) 신설
 *
 * 본질: step별 담당자 알림 (보내기 전 안내 + 보낸 결과) ON/OFF/default 3 상태 토글.
 *   - true  = 항상 ON (사용자 명시)
 *   - false = 항상 OFF (사용자 명시 — 첫/마지막 메시지 칸에서도 X)
 *   - null  = default (첫/마지막 메시지 칸 ON / 그 밖 OFF · 판정 = utils/journey-step-notify 한 곳 · 서버와 같은 함수)
 * ★ 2026-10-31 문구 = 실제 시점(설계서 docs/2026-10-31-journey-step-gate-notice-design.md §2-7 · 오류접수 cmvujpa3w)
 *   문자 칸 = 보내기 2시간 전 안내 · 바로 보내는 칸은 그날 첫 발송 전 검사 뒤 안내(그날 첫 발송 10~20분 늦어짐) / 알림톡 칸 = 보낸 결과만.
 *   - PATCH /api/ai/operator/journeys/:id/steps/:stepId body { notifyManagerOnPretest: true|false|null }
 *
 * 영구 룰 정합:
 *   - feedback_design_quality_minimum_journey_level (다크 톤 + violet 액센트)
 *   - feedback_no_native_browser_dialog (useToast 활용)
 */

import { useState } from 'react';
import { BellRing, BellOff, Sparkles, Loader2 } from 'lucide-react';
import { useToast } from '../ToastProvider';
import { isStepNotifyOn } from '../../utils/journey-step-notify';

interface Props {
  journeyId: string;
  stepId: string;
  stepOrder: number;
  /** 그 여정 메시지 칸 첫 · 끝 번호(기본값 판정) */
  firstMessageOrder: number | null;
  lastMessageOrder: number | null;
  /** 칸 채널 — 알림톡은 보내기 전 안내가 없다(스팸 검사 대상 아님) */
  channel: string;
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
  journeyId, stepId, stepOrder, firstMessageOrder, lastMessageOrder, channel, currentValue, token, onChange,
}: Props) {
  const toast = useToast();
  const [state, setState] = useState<ToggleState>(valueToState(currentValue));
  const [saving, setSaving] = useState(false);

  const defaultEffective = isStepNotifyOn(null, stepOrder, firstMessageOrder, lastMessageOrder) ? '켬' : '끔';
  const isText = ['sms', 'lms', 'mms'].includes(String(channel || '').toLowerCase());

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
        toast.success(`담당자 알림을 ${next === 'on' ? '늘 켰어요' : next === 'off' ? '늘 껐어요' : '기본(첫 · 마지막 메시지 칸만 켬)으로 바꿨어요'}.`);
        if (onChange) onChange(stateToValue(next));
      } else {
        toast.error(data?.error || '저장하지 못했어요.');
        setState(oldState);
      }
    } catch (e: any) {
      toast.error(e?.message || '저장하지 못했어요.');
      setState(oldState);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
        <BellRing className="w-3 h-3" />
        {isText ? '담당자 알림(보내기 전 · 보낸 결과)' : '담당자 알림(보낸 결과)'}
        {saving && <Loader2 className="w-3 h-3 animate-spin text-violet-700" />}
      </div>
      <div className="inline-flex items-center bg-white border border-slate-200 rounded-lg p-0.5 gap-0.5">
        <ToggleBtn
          active={state === 'on'}
          onClick={() => onSelect('on')}
          icon={BellRing}
          label="늘 켬"
          color="emerald"
          disabled={saving}
        />
        <ToggleBtn
          active={state === 'default'}
          onClick={() => onSelect('default')}
          icon={Sparkles}
          label={`기본(${defaultEffective})`}
          color="violet"
          disabled={saving}
        />
        <ToggleBtn
          active={state === 'off'}
          onClick={() => onSelect('off')}
          icon={BellOff}
          label="늘 끔"
          color="rose"
          disabled={saving}
        />
      </div>
      <div className="text-[12px] leading-relaxed text-slate-400">
        {isText && (
          <p>보내기 2시간 전에 안내해요. 바로 보내는 칸은 그날 첫 발송 전에 스팸 검사를 하느라 그날 첫 발송이 10~20분 늦어지고, 안내는 그 검사 뒤에 와요.</p>
        )}
        <p>보낸 결과는 그날 이 칸 발송이 끝나고 결과가 다 나오면 와요. 하루 내내 이어서 나가는 칸은 다음 날 아침에 하루 합계가 한 번 더 와요.</p>
        <p>기본은 첫 메시지 칸과 마지막 메시지 칸만 켜요.</p>
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
    emerald: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    violet: 'bg-violet-100 text-violet-900 border-violet-300',
    rose: 'bg-rose-100 text-rose-900 border-rose-300',
  }[color];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 py-1 rounded-md text-[12px] font-semibold flex items-center gap-1 border transition-all ${
        active ? activeColor : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-white'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}
