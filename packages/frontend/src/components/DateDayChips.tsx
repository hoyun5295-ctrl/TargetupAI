/**
 * DateDayChips — ★ 2026-11-20 직접 타겟 날짜 칸(생일 제외) 기준 토글 + 일수 칩 한 부품(설계서 docs/2026-11-20-staff-tickets-four-design.md P1-5)
 *   「최근 N일 안」(지금 그대로 · 기본) · 「N일 이상 지남」(새 · 90일 넘게 구매 없는 고객). 값 꼴 · 프리셋 · 글 = utils/customerFilterBuild 한 곳.
 *   쓰는 화면 = 직접발송 조건 창(DirectTargetFilterModal) · 타겟 추출 패널(TargetDirectPickPanel) — 칩 모양만 각 화면이 넘긴다.
 */
import { useState } from 'react';
import { DATE_DAY_PRESETS, dateDayCount, dateDayMode, dateDayValue, type DateDayMode } from '../utils/customerFilterBuild';

interface Props {
  /** 지금 값(「N」 · 「over:N」 · 빈 값) */
  value: string;
  /** 새 값(빈 값 = 조건 지움) */
  onChange: (next: string) => void;
  /** 칩 모양(화면마다 다름) */
  chipClass: (on: boolean) => string;
  /** 읽기 도우미용 칸 이름 */
  label: string;
}

const MODES: ReadonlyArray<{ mode: DateDayMode; text: string }> = [
  { mode: 'within', text: '최근 N일 안' },
  { mode: 'over', text: 'N일 이상 지남' },
];

export default function DateDayChips({ value, onChange, chipClass, label }: Props) {
  // 값이 없을 때 고른 기준(값이 있으면 값이 기준을 정한다)
  const [idleMode, setIdleMode] = useState<DateDayMode>('within');
  const mode = value ? dateDayMode(value) : idleMode;
  const days = dateDayCount(value);
  const pickMode = (m: DateDayMode) => {
    setIdleMode(m);
    if (days != null && m !== mode) onChange(dateDayValue(days, m));   // 고른 일수는 그대로 · 기준만 바꿈
  };
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="inline-flex w-fit max-w-full rounded-[10px] border border-stone-200 bg-stone-50 p-0.5" role="radiogroup" aria-label={`${label} 기준`}>
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={mode === m.mode}
            onClick={() => pickMode(m.mode)}
            className={`h-[26px] px-2.5 rounded-[8px] text-[12px] whitespace-nowrap transition-colors ${mode === m.mode ? 'bg-white text-stone-900 font-semibold shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
          >
            {m.text}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {DATE_DAY_PRESETS.map((p) => {
          const v = dateDayValue(p.days, mode);
          const on = value === v;
          return (
            <button key={p.days} type="button" onClick={() => onChange(on ? '' : v)} className={chipClass(on)}>
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
