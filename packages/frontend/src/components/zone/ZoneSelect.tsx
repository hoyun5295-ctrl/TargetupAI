/**
 * ZoneSelect.tsx — 목록 머리의 고르기 칸(★ 2026-09-30 AI 존 보정)
 *
 * 높이 40 · 둥근 12 · 옅은 그림자 — 전환 버튼(ZoneSegmented)·찾기 칸과 같은 줄에서 선이 맞는다.
 * 브라우저 기본 모양 대신 같은 모양의 화살표를 그린다(글자색은 명시 · 흰 패널 컨트롤 규칙).
 */
import { ChevronDown } from 'lucide-react';

export default function ZoneSelect<T extends string>({ value, onChange, options, ariaLabel }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  ariaLabel: string;
}) {
  return (
    <label className="relative h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center" data-zone="select">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={ariaLabel}
        className="appearance-none h-full pl-3 pr-8 rounded-xl bg-transparent text-[13px] font-semibold text-slate-700 outline-none cursor-pointer focus:ring-2 focus:ring-indigo-100"
      >
        {options.map((o) => <option key={o.value} value={o.value} className="bg-white text-slate-900">{o.label}</option>)}
      </select>
      <ChevronDown className="w-[15px] h-[15px] absolute right-2.5 text-slate-400 pointer-events-none" />
    </label>
  );
}
