/**
 * FeatureChips — AI 자동제작 기능 칩 4종 + "AI가 알아서"(2026-09-14 T5 · 설계서 §3-4 · §4-2)
 *
 * 값 null = "AI가 알아서"(서버 후처리 no-op). 칩을 하나라도 고르면 명시 목록이 되고, "AI가 알아서"를 켜면 다시 null.
 * 재료가 없는 칩은 회색 + 사유(죽은 컨트롤이 아니라 "왜 못 켜는가"를 말한다). 이메일은 카운트다운 칩을 아예 그리지 않는다(서버 허용 타입 밖).
 * 판정 원천은 서버(materialsMeta.features) · 여기는 사용자가 고른 값만 든다.
 */
import { Check, Sparkles } from 'lucide-react';
import { AI_BUILD_FEATURES, type BuildChannel, type FeatureAvailability } from '../../utils/ai-build';

export default function FeatureChips({ value, onChange, availability, channel, disabled }: {
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  availability: Record<string, FeatureAvailability>;
  channel: BuildChannel;
  disabled?: boolean;
}) {
  const auto = value === null;
  const chips = AI_BUILD_FEATURES.filter((f) => !(channel === 'email' && f.key === 'countdown'));
  const toggle = (key: string) => {
    if (disabled) return;
    const cur = value ?? [];
    onChange(cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => { if (!disabled) onChange(auto ? [] : null); }}
          disabled={disabled}
          aria-pressed={auto}
          className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold border transition-colors disabled:opacity-50 ${auto ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10'}`}
        >
          <Sparkles className="w-3.5 h-3.5" /> AI가 알아서
        </button>
        {chips.map((f) => {
          const on = !auto && (value ?? []).includes(f.key);
          const av = availability[f.key] || { ok: true, reason: null };
          const blocked = !av.ok;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => { if (!blocked) toggle(f.key); }}
              disabled={disabled || blocked}
              aria-pressed={on}
              title={blocked ? (av.reason || '') : f.hint}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] border transition-colors ${
                blocked ? 'bg-white/[0.03] border-white/10 text-white/35 cursor-not-allowed'
                  : on ? 'bg-fuchsia-500/20 border-fuchsia-400/50 text-fuchsia-100'
                    : auto ? 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10' : 'bg-white/5 border-white/15 text-white/75 hover:bg-white/10'
              } disabled:opacity-60`}
            >
              {on && <Check className="w-3.5 h-3.5" />}
              {f.label}
            </button>
          );
        })}
      </div>
      {(() => {
        const blockedList = chips.filter((f) => availability[f.key] && !availability[f.key].ok);
        if (blockedList.length === 0) return <p className="text-[11px] text-white/45">{auto ? '재료에 맞춰 AI가 구성해요. 꼭 넣고 싶은 것만 고르세요.' : '고른 것만 넣고, 고르지 않은 것은 빼요.'}</p>;
        return (
          <ul className="text-[11px] text-white/45 space-y-0.5">
            {blockedList.map((f) => <li key={f.key}>{f.label}: {availability[f.key].reason}</li>)}
          </ul>
        );
      })()}
    </div>
  );
}
