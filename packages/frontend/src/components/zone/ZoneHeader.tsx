/**
 * ZoneHeader.tsx — AI 존 남색 머리 띠(★ 2026-09-30 AI 존 대개편 · ★ 같은 날 보정: 빈자리 쓰기)
 *
 * 왼쪽 = [← 부모로] [메뉴 타일] [제목 · 부제] [? 도움말] [⋯ 더보기]
 * 오른쪽 = 탭이 있으면 **숫자 타일이 곧 탭**(고른 것 = 흰 판) · 없으면 **핵심 숫자 묶음**(누르는 것 아님 · 테두리 한 덩어리)
 *          그 아래 한 줄 = 링크(자세히 분석 · 관리 등) + 기준 시각 · 다시 읽기(새로고침은 이 한 곳)
 * Harold 0930: "공간이 많이 남는데 왜 저렇게 배치하지 · 탭이 누르는 거라고 보이겠냐" → 탭 글자 줄·외톨이 오른쪽 버튼을 없앴다.
 * 제목·타일·부제는 허브 카드와 같은 객체(ai-operator-modules.ts). 머리 띠 빛 = 메뉴 색(zone-color.ts).
 *
 * ⛔ className prop 없음 · 오른쪽 끝 외톨이 버튼 prop 없음(aux 폐지 — 입구는 시작 카드·링크·명령 카드로).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleHelp, Ellipsis, RotateCw, type LucideIcon } from 'lucide-react';
import { zoneModule, type ZoneModuleId } from '../../constants/ai-operator-modules';
import { goBackOr } from '../../lib/scroll-restoration';
import { zoneBand } from './zone-color';

export interface ZoneAction {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

export interface ZoneMenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  /** 이 항목 앞에 구분선 */
  divider?: boolean;
  disabled?: boolean;
}

export interface ZoneTab {
  id: string;
  label: string;
  /** 숫자(있으면 큰 숫자 타일) */
  count?: number | string | null;
  unit?: string;
  /** 숫자 없는 타일의 아이콘 */
  icon?: LucideIcon;
  /** 상태 점(승인 대기 = amber · 실행 중 = emerald) */
  dot?: 'amber' | 'emerald' | 'rose' | 'indigo';
  /** 주소가 있는 탭(다른 라우트) — 없으면 onSelect */
  to?: string;
}

export interface ZoneKpi {
  label: string;
  value: ReactNode;
  tone?: 'emerald' | 'amber' | 'rose';
}

export interface ZoneStamp {
  text: string;
  onRefresh?: () => void;
  loading?: boolean;
}

export interface ZoneHeaderProps {
  moduleId: ZoneModuleId;
  /** 하위 위치(예: '지도', 여정 이름) — 제목 뒤에 "› sub" */
  sub?: string | null;
  /** 뒤로가기 목적지(기본 = 허브) · onBack 이 있으면 그것을 부른다(작성 중 확인 등) */
  backTo?: string;
  backLabel?: string;
  onBack?: () => void;
  onHelp?: (() => void) | null;
  /** 제목 옆 ⋯ (자주 안 쓰는 설정) */
  more?: ZoneMenuItem[];
  tabs?: ZoneTab[];
  activeTab?: string;
  onSelectTab?: (id: string) => void;
  /** 탭이 없을 때 오른쪽 = 핵심 숫자 */
  kpis?: ZoneKpi[];
  /** 오른쪽 아래 한 줄: 링크 + 기준 시각 */
  links?: ZoneAction[];
  stamp?: ZoneStamp | null;
  /** 제목 칸 대신 그릴 것(편집기 변형: 제목 인라인 수정 · 저장 상태) */
  titleSlot?: ReactNode;
  /** 오른쪽 끝(편집기 변형의 1차 동작 · 보내기) */
  endSlot?: ReactNode;
  /** ZoneFrame 이 바탕을 한 덩어리로 칠할 때 false(머리 + 명령 카드 걸침 띠가 이어진다) */
  paint?: boolean;
  /** 전폭 화면(여정 지도 캔버스 등) — 머리 좌우 끝을 작업면과 같은 전폭에 맞춘다. ZoneFrame 이 width 로 정한다. */
  full?: boolean;
}

const MENU_MIN_W = 200;
const MENU_BTN = 'w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white transition-colors shrink-0';

export function ZoneMoreMenu({ items, align = 'right', tone = 'dark' }: { items: ZoneMenuItem[]; align?: 'right' | 'left'; tone?: 'dark' | 'light' }) {
  const [open, setOpen] = useState(false);
  // ★ 2026-09-30 Codex R1: 메뉴는 포털로 그린다 — 행 카드처럼 overflow-hidden 인 부모 안에서도 잘리지 않게(버튼 좌표로 고정 위치).
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number; maxHeight: number; maxWidth: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // ★ Codex R2: 위아래 모두 모자라면 더 넓은 쪽으로 펴고 그 높이에 맞춰 메뉴 안에서 스크롤(항목이 화면 밖으로 나가지 않게)
    const need = items.length * 36 + 16 + items.filter((it) => it.divider).length * 13;
    const below = window.innerHeight - r.bottom - 6 - 8;
    const above = r.top - 6 - 8;
    const up = need > below && above > below;
    const maxHeight = Math.max(44, up ? above : below); // 가용 높이 그대로(한 항목 44 는 보장) — 큰 최솟값은 다시 화면 밖으로 민다
    // 좌우도 메뉴 폭(최소 200) 기준으로 화면 안에 묶는다
    const W = MENU_MIN_W;
    const edge = align === 'right'
      ? Math.min(Math.max(8, window.innerWidth - r.right), Math.max(8, window.innerWidth - W - 8))
      : Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - W - 8));
    const x = align === 'right' ? { right: edge } : { left: edge };
    // 긴 항목(예: 회사 메일 주소)이 메뉴를 넓혀도 반대쪽 가장자리가 화면 밖으로 나가지 않게 폭 상한(넘치면 글자 말줄임)
    const maxWidth = window.innerWidth - 8 - edge;
    setPos(up ? { bottom: window.innerHeight - r.top + 6, maxHeight, maxWidth, ...x } : { top: r.bottom + 6, maxHeight, maxWidth, ...x });
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // 좌표가 낡는 순간 닫는다: 바깥 스크롤(메뉴 안 스크롤은 제외) · 창 크기 변경·회전(무조건)
    const onScroll = (e: Event) => { const t = e.target; if (t instanceof Node && menuRef.current?.contains(t)) return; setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { if (!open) place(); setOpen((v) => !v); }}
        className={tone === 'dark' ? MENU_BTN : 'w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors shrink-0'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="더보기"
      >
        <Ellipsis className="w-[17px] h-[17px]" />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} role="menu" style={pos} className="fixed z-[1500] min-w-[200px] overflow-y-auto overscroll-contain py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.28),0_2px_6px_rgba(15,23,42,0.08)]">
          {items.map((it, i) => (
            <div key={`${it.label}-${i}`}>
              {it.divider && i > 0 && <div className="my-1.5 h-px bg-slate-100" />}
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => { setOpen(false); it.onClick(); }}
                className={`w-full h-9 px-3 flex items-center gap-2 text-left text-[13px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${it.danger ? 'text-rose-600 hover:bg-rose-50' : 'hover:bg-slate-50 hover:text-slate-900'}`}
              >
                {it.icon && <it.icon className={`w-[15px] h-[15px] shrink-0 ${it.danger ? '' : 'text-slate-400'}`} />}
                <span className="truncate">{it.label}</span>
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

const DOT = { amber: 'bg-amber-500', emerald: 'bg-emerald-400', rose: 'bg-rose-400', indigo: 'bg-indigo-400' } as const;
const KPI_TONE = { emerald: 'text-emerald-300', amber: 'text-amber-300', rose: 'text-rose-300' } as const;
const KPI_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4', 5: 'grid-cols-3 sm:grid-cols-5' };
const TAB_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4' };

// 타일 폭 = 개수에 맞춰 오른쪽 자리를 채운다(한쪽에 몰고 가운데를 비우지 않는다 · 빈 가운데 검사 기준)
const TILE_W: Record<number, string> = { 1: 'sm:w-[240px]', 2: 'sm:w-[232px]', 3: 'sm:w-[184px]', 4: 'sm:w-[140px]' };

function TabTile({ t, on, width, onSelect }: { t: ZoneTab; on: boolean; width: string; onSelect?: (id: string) => void }) {
  const hasCount = t.count != null && t.count !== '';
  const cls = `${width} h-[62px] rounded-xl px-4 text-left flex flex-col justify-center transition-colors ${on
    ? 'bg-white text-slate-900 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.5)]'
    : 'bg-white/[0.07] hover:bg-white/[0.14] border border-white/15 text-white'}`;
  const inner = hasCount ? (
    <>
      <span className={`flex items-center justify-between gap-2 text-[12.5px] font-semibold ${on ? 'text-slate-500' : 'text-slate-300'}`}>
        <span className="truncate">{t.label}</span>
        {t.dot && <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[t.dot]}`} />}
      </span>
      <span className="block text-[22px] font-bold tabular-nums leading-tight mt-0.5">
        {t.count}{t.unit && <span className={`text-[13px] font-semibold ml-0.5 ${on ? 'text-slate-500' : 'text-slate-400'}`}>{t.unit}</span>}
      </span>
    </>
  ) : (
    <span className="flex items-center gap-2 text-[14px] font-semibold">
      {t.icon && <t.icon className={`w-[17px] h-[17px] shrink-0 ${on ? 'text-slate-700' : 'text-white/75'}`} />}
      <span className="truncate">{t.label}</span>
    </span>
  );
  return t.to ? (
    <Link to={t.to} role="tab" aria-selected={on} aria-current={on ? 'page' : undefined} className={cls} data-zone="tab">{inner}</Link>
  ) : (
    <button type="button" role="tab" aria-selected={on} onClick={() => onSelect?.(t.id)} className={cls} data-zone="tab">{inner}</button>
  );
}

export default function ZoneHeader({
  moduleId, sub, backTo = '/ai-operator', backLabel, onBack, onHelp, more = [], tabs, activeTab, onSelectTab,
  kpis, links = [], stamp, titleSlot, endSlot, paint = true, full = false,
}: ZoneHeaderProps) {
  const box = full ? 'w-full px-4 md:px-6' : 'max-w-[1240px] mx-auto px-4 md:px-6';
  const navigate = useNavigate();
  const m = zoneModule(moduleId);
  const Icon = m.icon;
  const back = onBack ?? (() => goBackOr(navigate, backTo));
  const editor = !!(titleSlot || endSlot);
  const hasTabs = !!tabs && tabs.length > 0;
  const hasKpis = !hasTabs && !!kpis && kpis.length > 0;
  const hasFoot = links.length > 0 || !!stamp;
  const rightSlot = hasTabs || hasKpis;
  const foot = (
    <>
      {links.map((l) => (
        <button key={l.label} type="button" onClick={l.onClick} disabled={l.disabled} className="inline-flex items-center gap-1 text-slate-300 hover:text-white hover:underline underline-offset-2 disabled:opacity-40">
          {l.icon && <l.icon className="w-[13px] h-[13px]" />}{l.label}
        </button>
      ))}
      {stamp && (
        <button type="button" onClick={stamp.onRefresh} disabled={!stamp.onRefresh || stamp.loading} className="inline-flex items-center gap-1 text-slate-400 hover:text-white disabled:cursor-default whitespace-nowrap" aria-label="다시 읽기">
          <RotateCw className={`w-3 h-3 ${stamp.loading ? 'animate-spin' : ''}`} />{stamp.text}
        </button>
      )}
    </>
  );
  return (
    <header
      className={`${editor ? 'sticky top-0 z-30' : 'relative'} text-white`}
      style={paint || editor ? { background: zoneBand(moduleId) } : undefined}
      data-zone="head"
    >
      <div className={editor
        ? `${box} h-14 md:h-16 flex items-center gap-2 md:gap-3`
        : `${box} pt-4 md:pt-5 pb-4 flex flex-wrap items-center gap-x-4 gap-y-3`}
      >
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <button type="button" onClick={back} className={MENU_BTN} aria-label={backLabel ?? (backTo === '/ai-operator' ? 'AI Operator로' : '이전 화면으로')} data-zone="back">
            <ArrowLeft className="w-[18px] h-[18px]" />
          </button>
          <span className={`${editor ? 'w-8 h-8 md:w-10 md:h-10' : 'w-10 h-10 md:w-11 md:h-11'} rounded-xl bg-gradient-to-br ${m.gradient} flex items-center justify-center shadow-md shrink-0`} data-zone="tile">
            <Icon className="w-5 h-5 text-white" />
          </span>
          {titleSlot ?? (
            <div className="min-w-0 ml-0.5" data-zone="title">
              <h1 className="text-[17px] md:text-[19px] font-semibold tracking-[-0.02em] leading-tight truncate">
                {m.label}
                {sub && <span className="font-normal text-white/60"> <span className="text-white/40">›</span> {sub}</span>}
              </h1>
              <p className="text-[12.5px] md:text-[13px] text-slate-400 leading-tight mt-0.5 truncate">{m.description}</p>
              {/* 오른쪽 자리(숫자·탭)가 없는 화면 = 기준 시각·링크를 제목 아래에(오른쪽 끝에 혼자 떠 있지 않게) */}
              {!editor && !rightSlot && hasFoot && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] mt-1.5" data-zone="band-foot">{foot}</div>}
            </div>
          )}
          {onHelp && (
            <button type="button" onClick={onHelp} className={MENU_BTN} aria-label="도움말">
              <CircleHelp className="w-[17px] h-[17px]" />
            </button>
          )}
          <ZoneMoreMenu items={more} align="left" />
        </div>
        {!editor && rightSlot && (
          <div className="ml-auto w-full sm:w-auto flex flex-col items-stretch sm:items-end gap-1.5" data-zone="band-right">
            {hasTabs && (
              <nav role="tablist" aria-label={`${m.label} 보기`} className={`grid gap-2 ${TAB_COLS[Math.min(tabs!.length, 4)]}`} data-zone="tabs">
                {tabs!.map((t) => <TabTile key={t.id} t={t} on={t.id === activeTab} width={TILE_W[Math.min(tabs!.length, 4)]} onSelect={onSelectTab} />)}
              </nav>
            )}
            {hasKpis && (
              <div className={`grid ${KPI_COLS[Math.min(kpis!.length, 5)]} rounded-xl bg-white/[0.06] border border-white/10 divide-x divide-white/10`} data-zone="kpi">
                {kpis!.map((k) => (
                  <div key={k.label} className={`px-4 py-2 min-w-0 ${kpis!.length <= 2 ? 'sm:min-w-[200px]' : kpis!.length === 3 ? 'sm:min-w-[160px]' : 'sm:min-w-[128px]'}`}>
                    <div className="text-[12px] text-slate-400 whitespace-nowrap truncate">{k.label}</div>
                    <div className={`text-[20px] font-bold tabular-nums leading-tight truncate ${k.tone ? KPI_TONE[k.tone] : 'text-white'}`}>{k.value}</div>
                  </div>
                ))}
              </div>
            )}
            {hasFoot && <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[12px]" data-zone="band-foot">{foot}</div>}
          </div>
        )}
        {endSlot && <div className="ml-auto flex items-center gap-1 shrink-0">{endSlot}</div>}
      </div>
    </header>
  );
}
