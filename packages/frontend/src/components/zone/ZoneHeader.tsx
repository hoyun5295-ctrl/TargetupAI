/**
 * ZoneHeader.tsx — AI 존 남색 머리 띠(★ 2026-09-30 AI 존 대개편 · 설계서 §3-2 ①)
 *
 * 모든 메뉴가 같은 좌표·같은 순서: [← 부모로] [메뉴 타일] [제목 · 부제] … [보조 ≤1] [? 도움말] [⋯ 더보기]
 * 제목·타일·부제는 허브 카드와 **같은 객체**(`ai-operator-modules.ts`)를 읽는다 — 손으로 옮겨 적으면 갈라진다(0821 이후 실측).
 * 탭이 있는 메뉴는 띠 둘째 줄에 흰 글자 탭(주소가 탭을 소유 · `to` 가 있으면 링크).
 * 머리에 두지 않는 것: 새로고침(명령 카드 "다시 읽기" 한 곳) · 기간 칩 · NEW · 상태 뱃지 · 크레딧 칩.
 *
 * ⛔ className prop 이 없다. 탈출구가 생기면 메뉴마다 다시 갈라진다(0821 → 0930 재분열의 경로).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleHelp, Ellipsis, type LucideIcon } from 'lucide-react';
import { zoneModule, type ZoneModuleId } from '../../constants/ai-operator-modules';
import { goBackOr } from '../../lib/scroll-restoration';

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
  count?: number | string | null;
  /** 주소가 있는 탭(다른 라우트) — 없으면 onSelect */
  to?: string;
}

export interface ZoneHeaderProps {
  moduleId: ZoneModuleId;
  /** 하위 위치(예: '지도', 여정 이름) — 제목 뒤에 "› sub" */
  sub?: string | null;
  /** 뒤로가기 목적지(기본 = 허브) · onBack 이 있으면 그것을 부른다(작성 중 확인 등) */
  backTo?: string;
  backLabel?: string;
  onBack?: () => void;
  aux?: ZoneAction | null;
  onHelp?: (() => void) | null;
  more?: ZoneMenuItem[];
  tabs?: ZoneTab[];
  activeTab?: string;
  onSelectTab?: (id: string) => void;
  /** 제목 칸 대신 그릴 것(편집기 변형: 제목 인라인 수정 · 저장 상태) */
  titleSlot?: ReactNode;
  /** 오른쪽 끝(편집기 변형의 1차 동작 · 보내기) */
  endSlot?: ReactNode;
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

export default function ZoneHeader({
  moduleId, sub, backTo = '/ai-operator', backLabel, onBack, aux, onHelp, more = [], tabs, activeTab, onSelectTab, titleSlot, endSlot,
}: ZoneHeaderProps) {
  const navigate = useNavigate();
  const m = zoneModule(moduleId);
  const Icon = m.icon;
  const back = onBack ?? (() => goBackOr(navigate, backTo));
  return (
    <header className="sticky top-0 z-30 bg-slate-900 text-white bg-[radial-gradient(360px_120px_at_8%_0%,rgba(99,102,241,0.20),transparent_70%)]" data-zone="head">
      <div className="max-w-[1240px] mx-auto px-4 md:px-6 h-14 md:h-16 flex items-center gap-2 md:gap-3">
        <button type="button" onClick={back} className={MENU_BTN} aria-label={backLabel ?? (backTo === '/ai-operator' ? 'AI Operator로' : '이전 화면으로')} data-zone="back">
          <ArrowLeft className="w-[18px] h-[18px]" />
        </button>
        <span className={`w-8 h-8 md:w-10 md:h-10 rounded-[10px] bg-gradient-to-br ${m.gradient} flex items-center justify-center shadow-md shrink-0`} data-zone="tile">
          <Icon className="w-4 h-4 md:w-5 md:h-5 text-white" />
        </span>
        {titleSlot ?? (
          <div className="min-w-0 ml-0.5" data-zone="title">
            <h1 className="text-[16px] md:text-[18px] font-semibold tracking-[-0.02em] leading-tight truncate">
              {m.label}
              {sub && <span className="font-normal text-white/60"> <span className="text-white/40">›</span> {sub}</span>}
            </h1>
            <p className="hidden md:block text-[13px] text-slate-400 leading-tight mt-0.5 truncate">{m.description}</p>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {aux && (
            <button type="button" onClick={aux.onClick} disabled={aux.disabled} className="hidden md:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] text-white/85 hover:bg-white/10 disabled:opacity-40 transition-colors">
              {aux.icon && <aux.icon className="w-[15px] h-[15px]" />}
              {aux.label}
            </button>
          )}
          {onHelp && (
            <button type="button" onClick={onHelp} className={MENU_BTN} aria-label="도움말">
              <CircleHelp className="w-[17px] h-[17px]" />
            </button>
          )}
          {/* 보조 동작은 넓은 화면에서 글자 버튼, 좁은 화면에서는 ⋯ 안으로(사라지지 않게) */}
          <div className="hidden md:block"><ZoneMoreMenu items={more} /></div>
          <div className="md:hidden"><ZoneMoreMenu items={aux ? [{ label: aux.label, icon: aux.icon, onClick: aux.onClick, disabled: aux.disabled }, ...more.map((it, i) => (i === 0 ? { ...it, divider: true } : it))] : more} /></div>
          {endSlot}
        </div>
      </div>
      {tabs && tabs.length > 0 && (
        <nav className="max-w-[1240px] mx-auto px-4 md:px-6 h-10 flex items-end gap-5 overflow-x-auto" data-zone="tabs" aria-label={`${m.label} 보기`}>
          {tabs.map((t) => {
            const on = t.id === activeTab;
            const cls = `h-10 inline-flex items-center gap-1 text-[13.5px] whitespace-nowrap transition-colors ${on ? 'text-white font-semibold shadow-[inset_0_-2px_0_#fff]' : 'text-white/55 hover:text-white'}`;
            const count = t.count != null && t.count !== '' ? <span className={`text-[12px] tabular-nums ${on ? 'text-white/70' : 'text-white/40'}`}>{t.count}</span> : null;
            return t.to ? (
              <Link key={t.id} to={t.to} className={cls} aria-current={on ? 'page' : undefined}>{t.label}{count}</Link>
            ) : (
              <button key={t.id} type="button" onClick={() => onSelectTab?.(t.id)} className={cls} aria-current={on ? 'page' : undefined}>{t.label}{count}</button>
            );
          })}
        </nav>
      )}
    </header>
  );
}
