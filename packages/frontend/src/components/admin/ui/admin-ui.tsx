/**
 * admin-ui.tsx — 슈퍼관리자 화면 공용 부품(★ 2026-10-09 슈퍼관리자 다듬기 · Harold 목업 v2 승인)
 *
 * 기준 = 「스팸 검사 · 맞춤법 사용 현황」(PrecheckUsageTab) 결. 구조는 지금 그대로(머리 줄 · 숫자 카드 · 가로 메뉴 7묶음 · 내용 카드)이고
 * 옛 화면(고객사 목록 · 고객사 상세 설정 창 등)을 이 부품으로 맞춘다. 글씨 = 기준 화면보다 한 단계 작게(Harold 「글씨 너무 크지 않게」).
 * 강조색 = emerald 하나 · 상태 알약 = 의미 색 6가지(PILL). 서비스 화면(AI 존)의 메뉴별 색은 쓰지 않는다(Harold 「슈퍼관리자답게 담백하게」).
 * ⛔ native dialog 0 · 모델명 0 · 줄표 0.
 */
import type { ReactNode } from 'react';

/** 내용 카드 */
export function AdminPanel({ title, description, actions, children }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {description ? <p className="text-xs text-gray-500 mt-0.5">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** 거르기 줄(회색 띠) */
export function AdminFilterBar({ children }: { children: ReactNode }) {
  return <div className="px-5 py-2.5 border-b border-gray-100 bg-gray-50/70 flex flex-wrap items-center gap-2.5">{children}</div>;
}

export function AdminFilterLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs text-gray-500 font-medium">{children}</span>;
}

/** 칩 묶음(하나 고르기) */
export function AdminSegmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: readonly { key: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden divide-x divide-gray-200">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`px-2.5 py-1 text-xs transition-colors ${value === o.key ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 요약 숫자 카드 묶음 */
export function AdminStatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 px-5 py-4">{children}</div>;
}

const STAT_TONE = {
  gray: 'text-gray-900', emerald: 'text-emerald-600', blue: 'text-blue-600', violet: 'text-violet-600', amber: 'text-amber-600', rose: 'text-rose-600',
} as const;

export function AdminStat({ label, value, unit, sub, tone = 'gray' }: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  tone?: keyof typeof STAT_TONE;
}) {
  return (
    <div className="rounded-lg border border-gray-200/80 px-3.5 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold tracking-tight mt-0.5 tabular-nums ${STAT_TONE[tone]}`}>
        {value}{unit ? <span className="text-xs text-gray-400 font-semibold ml-0.5">{unit}</span> : null}
      </div>
      {sub ? <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div> : null}
    </div>
  );
}

/** 상태 알약 — 의미 색 */
export const PILL = {
  green: 'bg-emerald-50 text-emerald-700',
  blue: 'bg-blue-50 text-blue-700',
  violet: 'bg-violet-50 text-violet-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  gray: 'bg-gray-100 text-gray-600',
} as const;

export function AdminPill({ tone = 'gray', children }: { tone?: keyof typeof PILL; children: ReactNode }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${PILL[tone]}`}>{children}</span>;
}

/** 표 글자 규격 — 표마다 같은 값을 쓴다(머리 = 작은 회색 · 칸 = 13px · 숫자는 tabular-nums) */
export const ADMIN_TABLE = 'w-full text-[13px]';
export const ADMIN_THEAD = 'bg-gray-50 text-left text-xs text-gray-500';
export const ADMIN_TH = 'px-4 py-2 font-medium whitespace-nowrap';
export const ADMIN_TH_FIRST = 'px-5 py-2 font-medium whitespace-nowrap';
export const ADMIN_TBODY = 'divide-y divide-gray-100';
export const ADMIN_TR = 'hover:bg-gray-50/60';
export const ADMIN_TD = 'px-4 py-2 whitespace-nowrap text-gray-700';
export const ADMIN_TD_FIRST = 'px-5 py-2 whitespace-nowrap';
export const ADMIN_NUM = 'text-right tabular-nums';

/** 표 빈 상태 · 불러오는 중 한 줄 */
export function AdminTableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return <tr><td colSpan={colSpan} className="px-5 py-10 text-center text-xs text-gray-400">{children}</td></tr>;
}

/** 버튼 */
export const ADMIN_BTN = 'h-8 px-3 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40';
export const ADMIN_BTN_PRIMARY = 'h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-40';
export const ADMIN_BTN_DANGER = 'h-8 px-3 rounded-lg border border-rose-200 bg-white text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40';
export const ADMIN_BTN_SM = 'h-7 px-2.5 rounded-md border border-gray-200 bg-white text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40';
export const ADMIN_BTN_SM_DANGER = 'h-7 px-2.5 rounded-md border border-rose-200 bg-white text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40';
export const ADMIN_INPUT = 'h-8 px-3 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200';

/** 쪽 넘김 = 공용 TablePagination(accent="emerald") 을 쓴다 — 여기서 따로 만들지 않는다(목록 화면 페이저 단일 입구). */

/** 표 아래 출처 한 줄 */
export function AdminSource({ children }: { children: ReactNode }) {
  return <p className="px-5 py-2.5 border-t border-gray-100 text-[10px] text-gray-400 italic">{children}</p>;
}

/** 창 안 묶음 카드(상세 설정 창) — 기본 = 이름표 칸(AdminField) 두 줄 격자 · plain = 칸 모양이 아닌 내용(스위치 · 목록)을 그대로 담는다 */
export function AdminSection({ title, hint, plain, children }: { title: ReactNode; hint?: ReactNode; plain?: boolean; children: ReactNode }) {
  return (
    <section className="bg-white border border-gray-200/80 rounded-lg overflow-hidden mb-3 last:mb-0">
      <h4 className="px-3.5 py-2.5 border-b border-gray-100 text-[13px] font-semibold text-gray-900 flex items-baseline justify-between gap-2">
        <span>{title}</span>{hint ? <small className="text-[11px] font-normal text-gray-400">{hint}</small> : null}
      </h4>
      {plain ? <div className="p-3.5 space-y-3.5">{children}</div> : <div className="grid grid-cols-1 md:grid-cols-2 -mb-px">{children}</div>}
    </section>
  );
}

/** 이름표 왼쪽 · 값 오른쪽 한 칸(full = 두 칸 차지) */
export function AdminField({ label, required, hint, full, children }: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-[108px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 px-3.5 py-2.5 border-b border-gray-100 ${full ? 'md:col-span-2' : 'md:[&:nth-child(odd)]:border-r md:[&:nth-child(odd)]:border-gray-100'}`}>
      <label className="text-xs text-gray-500 sm:pt-1.5">{label}{required ? <span className="text-rose-500"> *</span> : null}</label>
      <div className="min-w-0">
        {children}
        {hint ? <p className="text-[11px] text-gray-400 mt-1 leading-snug">{hint}</p> : null}
      </div>
    </div>
  );
}

/** 상세 설정 창 칸 입력 규격 */
export const ADMIN_FIELD_INPUT = 'w-full h-8 px-2.5 border border-gray-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200';
