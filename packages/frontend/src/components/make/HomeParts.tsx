/**
 * HomeParts — DM·이메일 첫 화면 공용 부품(★ 2026-09-27 만들기 개편 · 목업 (마) ①③)
 *
 * ★ 2026-09-30 AI 존 대개편: 만들기 카드(MakeHeroCard)는 명령 카드(한 줄 입력 · 다른 방법 칩)로 흡수되어 지웠다(설계서 D8).
 * "다른 방법으로 만들기" 접힘 · 상태 거름 칩 · 찾기 · 정렬 · 카드칩(요약 숫자는 명령 카드로).
 * 카드칩 숫자는 저장값만(열람 수 · 오픈/클릭 = 서버 집계) — 화면이 지어내는 비율 0.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { MK_STATUS_CHIP } from '../../utils/make-ui';
import { CHIP_STATUS_LABEL, type ChipStatus } from '../../utils/make-flow';

export function OtherMethods({ open, onToggle, summary, children }: { open: boolean; onToggle: () => void; summary: string; children: ReactNode }) {
  return (
    <section className={`rounded-[16px] border border-dashed ${open ? 'border-slate-300 bg-white' : 'border-slate-300'}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-2.5 px-5 py-3.5 text-left">
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        <b className="text-[13px] text-slate-700">다른 방법으로 만들기</b>
        <span className="text-[12px] text-slate-400 truncate">{summary}</span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}

export function ListHead<F extends string>({ title, summary, filters, filter, onFilter, query, onQuery, sort, onSort, sortOptions }: {
  title: string; summary?: string;
  filters: Array<{ key: F; label: string; count: number }>; filter: F; onFilter: (f: F) => void;
  query: string; onQuery: (v: string) => void;
  sort: string; onSort: (v: string) => void; sortOptions: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <b className="text-[15px] text-slate-900">{title}</b>
        {summary && <span className="text-[12px] text-slate-500">{summary}</span>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {filters.map((f) => (
          <button key={f.key} type="button" onClick={() => onFilter(f.key)} aria-pressed={filter === f.key}
            className={`h-8 px-3 rounded-full text-[13px] border transition-colors ${filter === f.key ? 'bg-indigo-600 text-white border-indigo-600 font-semibold' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-200'}`}>
            {f.label} <span className={`tabular-nums ${filter === f.key ? 'text-white/70' : 'text-slate-400'}`}>{f.count}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="제목으로 찾기" className="h-9 w-[180px] md:w-[200px] pl-8 pr-3 rounded-lg bg-white border border-slate-200 text-[12.5px] text-slate-900 placeholder-slate-400 outline-none focus:border-violet-300" />
          </div>
          <select value={sort} onChange={(e) => onSort(e.target.value)} className="h-9 px-3 rounded-lg bg-white border border-slate-200 text-[12.5px] text-slate-700 outline-none">
            {sortOptions.map((o) => <option key={o.value} value={o.value} className="bg-white">{o.label}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

export function StatusChip({ status, className = '' }: { status: ChipStatus; className?: string }) {
  return <span className={`text-[10.5px] font-bold rounded-md px-1.5 py-0.5 ${MK_STATUS_CHIP[status]} ${className}`}>{CHIP_STATUS_LABEL[status]}</span>;
}

/** DM 카드칩(휴대폰 모양 표지) */
export function DmChip({ cover, fallback, status, catalog, title, meta, metric, onOpen, onContinue }: {
  cover: string | null; fallback: ReactNode; status: ChipStatus; catalog?: boolean; title: string; meta: string; metric?: ReactNode; onOpen: () => void; onContinue?: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="group rounded-2xl border border-slate-200 bg-white overflow-hidden hover:border-violet-300 transition-colors">
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`${title} 열기`}>
        <div className="relative aspect-[3/4] bg-white overflow-hidden">
          {cover ? <img src={cover} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center">{fallback}</div>}
          <StatusChip status={status} className="absolute left-2.5 top-2.5" />
          {catalog && <span className="absolute right-2.5 top-2.5 text-[10.5px] font-bold rounded-md px-1.5 py-0.5 bg-violet-500 text-white">카탈로그</span>}
          {status === 'draft' && onContinue && (
            <span className={`absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center transition-opacity ${hover ? 'opacity-100' : 'opacity-90'}`}>
              <span onClick={(e) => { e.stopPropagation(); onContinue(); }} className="text-[12px] font-bold text-white bg-violet-600 rounded-lg px-3 py-1.5 shadow-lg">이어서 만들기</span>
            </span>
          )}
        </div>
        <div className="px-3.5 py-3 min-h-[86px]">
          <b className="block text-[13.5px] text-slate-900 truncate">{title}</b>
          <span className="block text-[11.5px] text-slate-400 mt-0.5 truncate">{meta}</span>
          {metric && <div className="mt-2">{metric}</div>}
        </div>
      </button>
    </div>
  );
}

/** 이메일 카드칩(받은편지함 모양 머리 + 표지) */
export function EmailChip({ from, subject, cover, status, title, meta, metric, onOpen }: {
  from: string; subject: string; cover: string | null; status: ChipStatus; title: string; meta: ReactNode; metric?: ReactNode; onOpen: () => void;
}) {
  return (
    <button type="button" onClick={onOpen} className="block w-full text-left rounded-2xl border border-slate-200 bg-white overflow-hidden hover:border-sky-300 transition-colors" aria-label={`${title} 열기`}>
      <div className="bg-white px-3.5 py-2.5 flex items-center gap-2.5">
        <span className="w-7 h-7 rounded-full bg-[#9a4f2c] text-white text-[12px] font-bold flex items-center justify-center shrink-0">{(from || 'H').slice(0, 1)}</span>
        <div className="min-w-0"><div className="text-[12px] font-bold text-slate-900 truncate">{from || '보내는 사람'}</div><div className="text-[11.5px] text-slate-600 truncate">{subject || '(제목 없음)'}</div></div>
      </div>
      <div className="relative h-[124px] bg-white overflow-hidden">
        {cover ? <img src={cover} alt="" className="w-full h-full object-cover" loading="lazy" /> : null}
        <StatusChip status={status} className="absolute left-2.5 bottom-2.5" />
      </div>
      <div className="px-3.5 py-3 min-h-[80px]">
        <b className="block text-[13.5px] text-slate-900 truncate">{title}</b>
        <span className="block text-[11.5px] text-slate-400 mt-0.5 truncate">{meta}</span>
        {metric && <div className="mt-2">{metric}</div>}
      </div>
    </button>
  );
}

export function Meter({ label, pct }: { label: ReactNode; pct: number | null }) {
  return (
    <div>
      <div className="text-[12px] font-bold text-slate-900">{label}</div>
      {pct !== null && <div className="h-1.5 rounded-full bg-slate-100 mt-1.5 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>}
    </div>
  );
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400 && d.getDate() === new Date().getDate()) return `오늘 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
