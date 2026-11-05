/**
 * 혜택 기간 공용 입력(★ 2026-11-05 C105 H1) — AI한줄로 「문안에 넣을 내용」 창 · 한줄 단계 창이 같은 부품.
 *   칩 = 마감일(시작 없음) · 「기간으로 고르기」 = 시작일 · 마감일 두 칸 · 「기간 없이」 는 부르는 창이 따로 둔다(창마다 건너뛰기 뜻이 다르다).
 *   범위 · 글 = utils/line-period.ts(서버가 거절할 날을 고르지 못하게 서버보다 좁다).
 */
import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { periodBounds, periodLabel } from '../../utils/line-period';

export default function LinePeriodPick({ end, start, chips, onChange, chipClassName, activeChipClassName }: {
  end: string | null;
  start: string | null;
  chips: ReadonlyArray<{ label: string; value: string }>;
  onChange: (end: string | null, start: string | null) => void;
  chipClassName: string;
  activeChipClassName: string;
}) {
  const [rangePicked, setRangePicked] = useState(false);
  // ★ C105 Codex 구현 1R — 시작일이 있으면 늘 범위 모드(부모가 저장된 시작일을 마운트 뒤에 되살려도 숨지 않고 마감 고침이 지우지 않는다)
  const range = rangePicked || !!start;
  const b = periodBounds(start);
  const dateCls = 'h-9 rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-800 outline-none focus:border-violet-500';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-[13px]">
        {chips.map((c) => {
          const on = !range && end === c.value;
          return (
            <button key={c.value} type="button" aria-pressed={on} onClick={() => { setRangePicked(false); onChange(c.value, null); }}
              className={on ? activeChipClassName : chipClassName}>{c.label}</button>
          );
        })}
        <button type="button" aria-pressed={range} onClick={() => { const r = !range; setRangePicked(r); if (!r) onChange(end, null); }}
          className={range ? activeChipClassName : chipClassName}>
          <CalendarDays className="mr-1 inline h-4 w-4 align-[-3px]" aria-hidden />기간으로 고르기
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
        {range && (
          <>
            <label className="inline-flex items-center gap-1.5">시작
              <input type="date" className={dateCls} min={b.startMin} max={end || b.startMax} value={start || ''}
                onChange={(e) => onChange(end, e.target.value || null)} />
            </label>
            <span aria-hidden>~</span>
          </>
        )}
        <label className="inline-flex items-center gap-1.5">{range ? '마감' : '마감일 고르기'}
          <input type="date" className={dateCls} min={b.endMin} max={b.endMax} value={range ? (end || '') : (end && !chips.some((c) => c.value === end) ? end : '')}
            onChange={(e) => onChange(e.target.value || null, range ? start : null)} />
        </label>
      </div>
      {end && <p className="text-[12.5px] font-semibold text-violet-700">{periodLabel(end, range ? start : null)}</p>}
    </div>
  );
}
