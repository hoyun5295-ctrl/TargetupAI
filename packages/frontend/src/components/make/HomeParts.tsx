/**
 * HomeParts — DM·이메일 첫 화면 공용 부품(★ 2026-09-27 만들기 개편 · 목업 (마) ①③)
 *
 * ★ 2026-09-30 AI 존 대개편: 만들기 카드(MakeHeroCard)는 명령 카드(한 줄 입력 · 다른 방법 칩)로 흡수되어 지웠다(설계서 D8).
 * "다른 방법으로 만들기" 접힘 · 상태 거름 칩 · 찾기 · 정렬 · 카드칩(요약 숫자는 명령 카드로).
 * 카드칩 숫자는 저장값만(열람 수 · 오픈/클릭 = 서버 집계) — 화면이 지어내는 비율 0.
 */
import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { CHIP_STATUS_LABEL, type ChipStatus } from '../../utils/make-flow';
import ZoneSection from '../zone/ZoneSection';
import ZoneSegmented from '../zone/ZoneSegmented';
import ZoneSelect from '../zone/ZoneSelect';

export function ListHead<F extends string>({ title, summary, filters, filter, onFilter, query, onQuery, sort, onSort, sortOptions }: {
  title: string; summary?: string;
  filters: Array<{ key: F; label: string; count: number }>; filter: F; onFilter: (f: F) => void;
  query: string; onQuery: (v: string) => void;
  sort: string; onSort: (v: string) => void; sortOptions: Array<{ value: string; label: string }>;
}) {
  // ★ 2026-09-30 AI 존 보정: 흩어진 알약 칩 → 전환 버튼 한 덩어리(제목 옆) · 찾기·정렬은 같은 40 높이(줄 어긋남 0)
  return (
    <ZoneSection
      title={title}
      filter={(
        <ZoneSegmented
          ariaLabel={`${title} 거르기`}
          items={filters.map((f) => ({ id: f.key, label: f.label, count: f.count }))}
          value={filter}
          onChange={onFilter}
        />
      )}
      desc={summary}
      right={(
        <>
          <label className="relative h-10 w-[200px] md:w-[240px] rounded-xl bg-white border border-slate-200 shadow-sm flex items-center">
            <Search className="w-[15px] h-[15px] absolute left-3 text-slate-400" />
            <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="제목으로 찾기" className="w-full h-full pl-9 pr-3 rounded-xl bg-transparent text-[13px] text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>
          <ZoneSelect ariaLabel="정렬" value={sort} onChange={onSort} options={sortOptions} />
        </>
      )}
    />
  );
}

const STATUS_DOT: Record<ChipStatus, string> = { draft: 'bg-slate-400', scheduled: 'bg-amber-500', sent: 'bg-emerald-500', stopped: 'bg-slate-300', failed: 'bg-rose-500' };
const STATUS_TEXT: Record<ChipStatus, string> = { draft: 'text-slate-700', scheduled: 'text-amber-800', sent: 'text-emerald-700', stopped: 'text-slate-500', failed: 'text-rose-700' };
/** 상태 표지 = 점 + 글자(★ 2026-09-30 AI 존 보정 · 사진 위에서도 읽히게 흰 바탕) */
export function StatusChip({ status, className = '' }: { status: ChipStatus; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full bg-white/95 border border-slate-200 text-[11.5px] font-semibold ${STATUS_TEXT[status]} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />{CHIP_STATUS_LABEL[status]}
    </span>
  );
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
          {catalog && <span className="absolute right-2.5 top-2.5 inline-flex items-center h-6 px-2 rounded-full bg-white/95 border border-slate-200 text-[11.5px] font-semibold text-sky-700">카탈로그</span>}
          {status === 'draft' && onContinue && (
            <span className={`absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100`}>
              <span onClick={(e) => { e.stopPropagation(); onContinue(); }} className="text-[12.5px] font-bold text-white bg-slate-900/90 hover:bg-slate-900 rounded-lg px-3.5 py-2 shadow-lg inline-flex items-center gap-1">이어서 만들기</span>
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
