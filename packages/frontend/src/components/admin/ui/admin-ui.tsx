/**
 * admin-ui.tsx — 슈퍼관리자 화면 공용 부품(★ 2026-10-09 슈퍼관리자 다듬기 · Harold 목업 v2 승인)
 *
 * 기준 = 「스팸 검사 · 맞춤법 사용 현황」(PrecheckUsageTab) 결. 구조는 지금 그대로(머리 줄 · 숫자 카드 · 가로 메뉴 7묶음 · 내용 카드)이고
 * 옛 화면(고객사 목록 · 고객사 상세 설정 창 등)을 이 부품으로 맞춘다. 글씨 = 기준 화면보다 한 단계 작게(Harold 「글씨 너무 크지 않게」).
 * 강조색 = emerald 하나 · 상태 알약 = 의미 색 6가지(PILL). 서비스 화면(AI 존)의 메뉴별 색은 쓰지 않는다(Harold 「슈퍼관리자답게 담백하게」).
 * ⛔ native dialog 0 · 모델명 0 · 줄표 0.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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

/**
 * 표 칸 한 줄(★ 2026-10-20 Harold 「칸을 줄여 넣고 호버하면 전체 · 클릭하면 창」) — 슈퍼관리자 표는 전부 table className 에 이 값을 더한다.
 * 머리 · 칸 글을 꺾지 않는다(이름 · 상태 배지가 한 글자씩 꺾이던 것). 긴 글은 AdminLongText 가 정한 폭에서 줄인다.
 * 펼친 줄(colSpan 상세)처럼 여러 줄이 맞는 곳은 칸 안쪽 상자에 whitespace-normal 을 준다(안쪽 상자 값이 이긴다).
 * 넘치는 폭은 표를 감싼 overflow-x-auto 안에서만 민다(화면 가로 넘침 0). 계약 시험 = backend admin-table-oneline-1020.
 */
export const ADMIN_TABLE_ONELINE = '[&_th]:whitespace-nowrap [&_td]:whitespace-nowrap';

/** 표 글자 규격 — 표마다 같은 값을 쓴다(머리 = 작은 회색 · 칸 = 13px · 숫자는 tabular-nums) */
export const ADMIN_TABLE = `w-full text-[13px] ${ADMIN_TABLE_ONELINE}`;
export const ADMIN_THEAD = 'bg-gray-50 text-left text-xs text-gray-500';
export const ADMIN_TH = 'px-4 py-2 font-medium whitespace-nowrap';
export const ADMIN_TH_FIRST = 'px-5 py-2 font-medium whitespace-nowrap';
export const ADMIN_TBODY = 'divide-y divide-gray-100';
export const ADMIN_TR = 'hover:bg-gray-50/60';
export const ADMIN_TD = 'px-4 py-2 whitespace-nowrap text-gray-700';
export const ADMIN_TD_FIRST = 'px-5 py-2 whitespace-nowrap';
export const ADMIN_NUM = 'text-right tabular-nums';

/**
 * 긴 글 칸 — 정한 폭(max px)에서 「…」로 줄이고, 마우스를 올리면 전문(title), 누르면 전문 창.
 * 행을 누르면 상세 창이 열리는 표는 rowOpens — 칸이 따로 창을 열지 않고 행 클릭에 맡긴다(창이 두 개 뜨지 않게).
 */
export function AdminLongText({ text, max = 240, label, rowOpens, className = '' }: {
  text?: string | null;
  max?: number;
  /** 전문 창 제목(칸 머리 이름) */
  label?: string;
  rowOpens?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = String(text ?? '').trim();
  if (!t) return <span className="text-gray-300">-</span>;
  const cls = `block truncate ${className}`;
  if (rowOpens) return <span className={cls} style={{ maxWidth: max }} title={t}>{t}</span>;
  return (
    <>
      <button
        type="button"
        title={t}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`${cls} text-left hover:text-emerald-700`}
        style={{ maxWidth: max }}
      >
        {t}
      </button>
      {open && <AdminTextModal title={label} text={t} onClose={() => setOpen(false)} />}
    </>
  );
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const focusablesIn = (root: Element) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'));
/** 지금 화면 맨 위 창 = 화면 한가운데를 실제로 덮은 고정 층(이 규칙 밖의 창 · 본체 알림 · 확인 창까지 같은 잣대 · Codex T2) */
const topOverlayAtCenter = () => document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.closest('.fixed') ?? null;

/**
 * 창 껍데기 — 몸통에 포털로 띄운다(표 · 다른 창의 overflow 에 안 잘린다) · 창 안 클릭은 바깥 행 클릭으로 번지지 않는다 · 배경 클릭으로 닫지 않는다 · Esc = 닫기.
 * 키보드 격리(Codex T1 · T2 · T3 = 한 부류): 규칙 하나 — 「Tab 은 화면 맨 위 층 안에서만 돈다」(이 창이든 위에 뜬 다른 창 · 본체 실패 알림이든).
 * Esc 는 이 창이 맨 위일 때만 닫는다. 열리면 초점을 창 안으로 · 닫히면 연 자리(행 · 버튼)로 돌려준다.
 */
function AdminModalShell({ z, width, title, onClose, children, footer }: {
  z: string;
  width: string;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = layerRef.current;
    const box = boxRef.current;
    if (!layer || !box) return;
    (focusablesIn(box)[0] ?? box).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Tab') return;
      const top = topOverlayAtCenter() ?? layer;
      if (e.key === 'Escape') {
        // 부모 창(정산표 등)도 Esc 로 닫히므로 — 창(window) 잡기 단계에서 먼저 받아 이 창만 닫는다 · 위에 다른 층이면 그 층 몫
        if (top === layer) { e.preventDefault(); e.stopPropagation(); closeRef.current(); }
        return;
      }
      const scope: HTMLElement = top === layer ? box : (top as HTMLElement);
      const f = focusablesIn(scope);
      const active = document.activeElement;
      if (!f.length) { e.preventDefault(); if (scope === box) box.focus(); return; }
      const first = f[0];
      const last = f[f.length - 1];
      if (!(active && scope.contains(active))) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);
  return createPortal(
    <div ref={layerRef} className={`fixed inset-0 ${z} bg-gray-900/40 flex items-center justify-center p-4`} onClick={(e) => e.stopPropagation()}>
      <div ref={boxRef} tabIndex={-1} role="dialog" aria-modal="true" className={`bg-white rounded-2xl shadow-2xl w-full ${width} max-h-[85vh] flex flex-col overflow-hidden focus:outline-none`}>
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-gray-900 min-w-0 truncate">{title}</h3>
          <button type="button" onClick={onClose} aria-label="닫기" className="shrink-0 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer ? <div className="px-5 py-3.5 border-t border-gray-100 bg-gray-50/60">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 긴 글 전문 창(AdminLongText 가 연다) — 표가 든 어떤 창보다 위: 정산표 창이 확인 · 차단 층(z-[2000])을 쓰고
 * 080 청구 · 최소과금 · 수량 수정 창이 z-[130] 이라 그 위(z-[2010]) · 시스템 층(9997~) 아래(Codex T1).
 */
export function AdminTextModal({ title, text, onClose }: { title?: string; text: string; onClose: () => void }) {
  return (
    <AdminModalShell z="z-[2010]" width="max-w-lg" title={title || '전체 내용'} onClose={onClose}>
      <p className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap break-words">{text}</p>
    </AdminModalShell>
  );
}

/**
 * 행 상세 창 — 행을 누르면 열리고, 승인 · 반려 같은 처리는 footer 에서 한다(표 안 처리 버튼 0).
 * 층 = z-[55]: 탭 위 창(z-50) 위 · 본체 알림 · 확인 창(AdminDashboard modal = z-[60]) 아래 — 처리 실패 알림이 이 창 뒤에 깔리지 않게.
 */
export function AdminDetailModal({ title, onClose, children, footer }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return <AdminModalShell z="z-[55]" width="max-w-xl" title={title} onClose={onClose} footer={footer}>{children}</AdminModalShell>;
}

/** 상세 창 이름표 · 값 한 줄 — 값은 꺾여도 된다(창 안은 폭이 정해져 있다) */
export function AdminDetailItem({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-2 border-b border-gray-100 last:border-b-0">
      <dt className="text-xs text-gray-500 sm:pt-0.5">{label}</dt>
      <dd className="text-[13px] text-gray-800 break-words whitespace-pre-wrap min-w-0">{children}</dd>
    </div>
  );
}

/** 행 클릭 = 상세 창 · 키보드로도 열린다(행 자체에 초점이 있을 때 Enter · Space — 행 안 버튼의 Enter 는 그 버튼 몫) · 모양 = ADMIN_TR_OPEN */
export function adminRowOpen(onOpen: () => void) {
  return {
    onClick: onOpen,
    onKeyDown: (e: ReactKeyboardEvent<HTMLTableRowElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
    },
    tabIndex: 0,
  };
}
export const ADMIN_TR_OPEN = 'cursor-pointer hover:bg-gray-50 focus:outline-none focus-visible:bg-emerald-50/60';

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
