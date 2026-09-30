/**
 * ZoneSegmented.tsx — 거름·보기 전환 버튼 한 덩어리(★ 2026-09-30 AI 존 보정 · Harold "칩 같은 것들은 신경 써서 버튼을")
 *
 * 흩어진 알약 칩 대신 테두리 한 칸 안에 붙은 버튼들. 고른 것 = 짙은 바탕 + 흰 글자, 개수 = 작은 배지.
 * 높이 40(찾기 칸·정렬 버튼과 같은 줄에 선이 맞는다 · 줄 어긋남 검사 기준).
 */
import type { LucideIcon } from 'lucide-react';

export interface ZoneSegItem<T extends string = string> {
  id: T;
  label: string;
  count?: number | string | null;
  icon?: LucideIcon;
  disabled?: boolean;
}

const ON = 'h-8 pl-3 pr-2 rounded-lg bg-slate-900 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 shadow whitespace-nowrap';
const OFF = 'h-8 pl-3 pr-2 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 text-[13px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const CNT_ON = 'min-w-[20px] h-5 px-1.5 rounded-md bg-white/20 text-[11.5px] font-bold tabular-nums flex items-center justify-center';
const CNT_OFF = 'min-w-[20px] h-5 px-1.5 rounded-md bg-slate-100 text-slate-500 text-[11.5px] font-bold tabular-nums flex items-center justify-center';

export default function ZoneSegmented<T extends string>({ items, value, onChange, ariaLabel }: {
  items: ZoneSegItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex max-w-full overflow-x-auto p-[3px] rounded-xl bg-white border border-slate-200 shadow-sm" data-zone="segmented">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            disabled={it.disabled}
            onClick={() => onChange(it.id)}
            className={`${on ? ON : OFF} ${it.count == null || it.count === '' ? 'pr-3' : ''}`}
          >
            {it.icon && <it.icon className="w-[14px] h-[14px]" />}
            {it.label}
            {it.count != null && it.count !== '' && <span className={on ? CNT_ON : CNT_OFF}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
