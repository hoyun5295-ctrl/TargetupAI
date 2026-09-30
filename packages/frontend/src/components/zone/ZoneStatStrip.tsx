/**
 * ZoneStatStrip.tsx — 숫자 띠(★ 2026-09-30 AI 존 보정 · Harold "옆에 왜 저렇게 배치하지 · 줄이 안 맞는다")
 *
 * 목록 옆에 짝지어 두던 성과 칸(줄이 어긋난다)을 목록 위 한 줄 띠로. 숫자는 폭을 칸 수로 고르게 나눈다(한쪽에 몰지 않는다).
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface ZoneStatCell {
  label: string;
  value: ReactNode;
  tone?: 'emerald' | 'amber' | 'rose';
}
const TONE = { emerald: 'text-emerald-700', amber: 'text-amber-700', rose: 'text-rose-700' } as const;
// 칸 수 → 열 수. 7~8칸은 한 줄에 두면 금액이 잘린다(★0930 캡처 "₩4,310,…") → 4칸 2줄.
const COLS: Record<number, string> = {
  2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 md:grid-cols-4', 5: 'grid-cols-2 md:grid-cols-5',
  6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6', 7: 'grid-cols-2 md:grid-cols-4', 8: 'grid-cols-2 md:grid-cols-4',
};
// 마지막 칸이 줄에 혼자 남으면 남는 폭을 채운다(빈 칸 금지)
const LAST_SPAN: Record<number, string> = { 5: 'col-span-2 md:col-span-1', 7: 'col-span-2' };

export default function ZoneStatStrip({ title, icon: Icon, source, cells, footnote }: {
  title: string;
  icon?: LucideIcon;
  source?: string;
  cells: ZoneStatCell[];
  footnote?: ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_32px_-16px_rgba(15,23,42,0.25)] overflow-hidden" data-zone="strip">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 pt-3.5 text-[13px] font-semibold text-slate-600">
        {Icon && <span className="w-6 h-6 rounded-md bg-slate-100 text-slate-600 flex items-center justify-center"><Icon className="w-[14px] h-[14px]" /></span>}
        {title}
        {source && <span className="ml-1 text-[11px] font-normal text-slate-400 italic">출처: {source}</span>}
      </div>
      <div className={`grid ${COLS[Math.min(Math.max(cells.length, 2), 8)]} gap-px bg-slate-100 border-y border-slate-100 mt-3`}>
        {cells.map((c, i) => (
          <div key={c.label} className={`bg-white px-5 py-3.5 min-w-0 ${i === cells.length - 1 ? LAST_SPAN[cells.length] || '' : ''}`}>
            <div className="text-[12.5px] text-slate-500 truncate">{c.label}</div>
            <div className={`text-[20px] font-bold tabular-nums mt-0.5 truncate ${c.tone ? TONE[c.tone] : 'text-slate-900'}`}>{c.value}</div>
          </div>
        ))}
      </div>
      {footnote ? <div className="px-5 py-3 text-[12.5px] text-slate-500">{footnote}</div> : <div className="h-1" aria-hidden="true" />}
    </div>
  );
}
