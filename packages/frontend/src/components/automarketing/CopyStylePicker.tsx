// 문안 스타일 4종 선택 — 2026-07-02 2단계 (설정 시 문안 느낌 선택지 + 예시 미리보기)
// 선택 없음(null) = 브랜드 톤 자동. 같은 카드 재클릭 = 해제. 예시는 느낌 참고용 고정 문구(구체 혜택 없음).
export type CopyStyleKey = 'courteous' | 'friendly' | 'witty' | 'punchy';

export const COPY_STYLE_PRESETS: Array<{ key: CopyStyleKey; label: string; desc: string; example: string }> = [
  { key: 'courteous', label: '정중한', desc: '격식 있는 존댓말, 신뢰감', example: '고객님, 늘 찾아주셔서 감사합니다. 준비한 소식을 정중히 안내드립니다.' },
  { key: 'friendly', label: '친근한', desc: '단골에게 말 걸 듯 다정하게', example: '고객님, 잘 지내셨죠? 반가운 소식이 있어 살짝 들고 왔어요.' },
  { key: 'witty', label: '위트있는', desc: '가볍게 미소 짓게 하는 한 줄', example: '사장님이 또 일을 냈습니다. 이번엔 그냥 지나치기 어려우실 거예요.' },
  { key: 'punchy', label: '짧고 강한', desc: '핵심만 임팩트 있게', example: '딱 하나만 말씀드릴게요. 지금 확인해 보세요.' },
];

interface Props {
  value: CopyStyleKey | null | undefined;
  onChange: (next: CopyStyleKey | null) => void;
  disabled?: boolean;
  compact?: boolean; // 자연어 시작 등 좁은 자리 — 칩 + 선택 예시 한 줄
}

export default function CopyStylePicker({ value, onChange, disabled, compact }: Props) {
  const selected = COPY_STYLE_PRESETS.find((s) => s.key === value) || null;

  if (compact) {
    return (
      <div>
        <div className="flex flex-wrap gap-2">
          {COPY_STYLE_PRESETS.map((s) => {
            const on = value === s.key;
            return (
              <button
                key={s.key}
                type="button"
                disabled={disabled}
                onClick={() => onChange(on ? null : s.key)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${on ? 'bg-indigo-500/30 border-indigo-400/50 text-indigo-100' : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60'}`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 text-[11px] text-white/40 italic leading-relaxed">
          {selected ? `예: ${selected.example}` : '선택하지 않으면 브랜드 톤에 맞춰 자동으로 작성됩니다.'}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {COPY_STYLE_PRESETS.map((s) => {
          const on = value === s.key;
          return (
            <button
              key={s.key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(on ? null : s.key)}
              className={`text-left rounded-xl border p-3 transition-colors ${on ? 'bg-indigo-500/20 border-indigo-400/50' : 'bg-white/5 hover:bg-white/10 border-white/10'}`}
            >
              <div className={`text-[13px] font-medium ${on ? 'text-indigo-100' : 'text-white'}`}>{s.label}</div>
              <div className="mt-0.5 text-[11px] text-white/50">{s.desc}</div>
              <div className="mt-1.5 text-[11px] text-white/40 italic leading-relaxed">예: {s.example}</div>
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 text-[10px] text-white/40">선택하지 않으면 브랜드 톤에 맞춰 자동으로 작성됩니다. 같은 카드를 다시 누르면 해제됩니다.</div>
    </div>
  );
}
