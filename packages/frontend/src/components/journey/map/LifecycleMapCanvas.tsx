/**
 * LifecycleMapCanvas — 생애 지도 캔버스 (★ 2026-09-29 여정 V2 1차 · 읽기 전용)
 *
 * 설계서 = docs/2026-09-29-journey-v2-master-design.md §3.
 *
 * 무엇을 그리나
 *   윗띠 = 생애 흐름 레인(열) · 그 아래 "언제든 생기는 순간" 띠 · 맨 아래 상시 · 날짜 예약 · 정보 알림(읽기 전용).
 *   선 = 서버가 준 선(계약 간선)만. 화면은 **기하만** 계산한다(카드 위치 → 곡선 좌표). 선 상태 · 사유 · 숫자는 서버 값.
 *
 * 폭
 *   768 이상 = 레인 열 + SVG 선(좁으면 가로 스크롤 · 레인 머리 고정) / 768 미만 = 레인 접기 + 카드 속 "다음 →" 줄이 선을 대신.
 *
 * 움직임
 *   최근 7일 실제로 이어받은 고객이 있는 선만 흐른다(움직임 = 사실). 움직임 줄이기 설정이면 멈춘다(journey-map.css).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Lock, Plus, X } from 'lucide-react';
import MapJourneyCard from './MapJourneyCard';
import {
  LINE_SHORT, LINE_STYLE, countText, sortForLane,
  type AttachFix, type CreateMode, type LifecycleMapData, type LineTier, type MapJourney, type MapLine, type MapStep,
} from '../../../utils/journey-map';
import '../../../styles/journey-map.css';

export type MapStatusFilter = 'all' | 'active' | 'paused' | 'draft';

interface Props {
  data: LifecycleMapData;
  statusFilter: MapStatusFilter;
  search: string;
  focusId: string | null;
  onFocusJourney: (id: string) => void;
  onOpenStep: (journey: MapJourney, step: MapStep) => void;
  onOpenJourney: (id: string) => void;
  onCreate: (triggerEvent: string, mode?: CreateMode) => void;
  /** 선 고치기(서버가 정한 행동) — 페이지가 확인 창 · 요청을 소유한다. */
  onFix: (fix: AttachFix) => void;
  /** ★ 0930 V2 5차 — 새 판 만들기 */
  onNewVersion: (journey: MapJourney) => void;
}

interface LineGeo {
  line: MapLine;
  d: string;
  mx: number;
  my: number;
}

const TIERS: LineTier[] = ['solid', 'warn', 'empty'];

/** 카드 머리 높이 근처에 선을 붙인다(펼쳐도 붙는 자리가 변하지 않게). */
function anchorY(r: { top: number; height: number }): number {
  return r.top + Math.min(26, r.height / 2);
}

function computeGeometry(root: HTMLElement, lines: MapLine[]): LineGeo[] {
  const rb = root.getBoundingClientRect();
  const rel = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { left: r.left - rb.left, right: r.right - rb.left, top: r.top - rb.top, height: r.height };
  };
  const out: LineGeo[] = [];
  for (const ln of lines) {
    const fromEl = root.querySelector(`[data-anchor~="j:${ln.fromJourneyId}"]`);
    const toEl = ln.toJourneyId
      ? root.querySelector(`[data-anchor~="j:${ln.toJourneyId}"]`)
      : root.querySelector(`[data-anchor~="g:${ln.toTrigger}"]`);
    if (!fromEl || !toEl || fromEl === toEl) continue;
    const a = rel(fromEl);
    const b = rel(toEl);
    const ay = anchorY(a);
    const by = anchorY(b);
    let p0: [number, number];
    let p1: [number, number];
    let p2: [number, number];
    let p3: [number, number];
    if (b.left >= a.right - 4) {
      p0 = [a.right, ay]; p3 = [b.left, by];
      const dx = Math.max(28, (p3[0] - p0[0]) / 2);
      p1 = [p0[0] + dx, ay]; p2 = [p3[0] - dx, by];
    } else if (b.right <= a.left + 4) {
      p0 = [a.left, ay]; p3 = [b.right, by];
      const dx = Math.max(28, (p0[0] - p3[0]) / 2);
      p1 = [p0[0] - dx, ay]; p2 = [p3[0] + dx, by];
    } else if (root.clientWidth - Math.max(a.right, b.right) >= 72) {
      // 같은 레인: 카드 오른쪽으로 돌아 들어간다.
      const x = Math.max(a.right, b.right) + 30;
      p0 = [a.right, ay]; p3 = [b.right, by];
      p1 = [x, ay]; p2 = [x, by];
    } else {
      // 같은 레인인데 오른쪽 여백이 없다(맨 오른쪽 레인) — 왼쪽 레인 사이로 돌아 들어간다(화면 밖으로 나가지 않게).
      const x = Math.min(a.left, b.left) - 30;
      p0 = [a.left, ay]; p3 = [b.left, by];
      p1 = [x, ay]; p2 = [x, by];
    }
    const mx = (p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8;
    const my = (p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8;
    out.push({ line: ln, d: `M ${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${p3[0]} ${p3[1]}`, mx, my });
  }
  return out;
}

function useIsDesktop(): boolean {
  const q = '(min-width: 768px)';
  const [ok, setOk] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(q).matches : true));
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setOk(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return ok;
}

export default function LifecycleMapCanvas({
  data, statusFilter, search, focusId, onFocusJourney, onOpenStep, onOpenJourney, onCreate, onFix, onNewVersion,
}: Props) {
  const isDesktop = useIsDesktop();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showQuiet, setShowQuiet] = useState<Set<string>>(() => new Set());
  const [closedLanes, setClosedLanes] = useState<Set<string>>(() => new Set());
  const [geo, setGeo] = useState<LineGeo[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [openLineId, setOpenLineId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(data.journeys.map((j) => [j.id, j])), [data.journeys]);

  const q = search.trim().toLowerCase();
  const matches = useCallback((j: MapJourney) => {
    if (statusFilter !== 'all' && j.status !== statusFilter) return false;
    if (!q) return true;
    return j.name.toLowerCase().includes(q) || j.triggerLabel.toLowerCase().includes(q);
  }, [statusFilter, q]);

  /** 레인 키 → 보이는 카드 · 접힌 카드(초안 · 끝남). 필터가 초안이면 초안을 접지 않는다. */
  const groupOf = useCallback((list: MapJourney[], groupKey: string) => {
    const hit = sortForLane(list.filter(matches));
    const quietStatuses = statusFilter === 'draft' ? ['ended'] : ['draft', 'ended'];
    const open = showQuiet.has(groupKey);
    return {
      shown: hit.filter((j) => open || !quietStatuses.includes(j.status)),
      quiet: open ? [] : hit.filter((j) => quietStatuses.includes(j.status)),
    };
  }, [matches, statusFilter, showQuiet]);

  const flowLanes = data.lanes.filter((l) => l.band === 'flow');
  const momentJourneys = data.journeys.filter((j) => j.band === 'moment');
  const standingJourneys = data.journeys.filter((j) => j.band === 'standing');
  const infoJourneys = data.journeys.filter((j) => j.band === 'info');

  const outgoingOf = useMemo(() => {
    const m = new Map<string, MapLine[]>();
    for (const ln of data.lines) {
      if (!m.has(ln.fromJourneyId)) m.set(ln.fromJourneyId, []);
      m.get(ln.fromJourneyId)!.push(ln);
    }
    return m;
  }, [data.lines]);

  const overlapsOf = useMemo(() => {
    const m = new Map<string, Array<{ id: string; name: string; concurrentActive: number }>>();
    const add = (from: string, to: string, n: number) => {
      const other = byId.get(to);
      if (!other) return;
      if (!m.has(from)) m.set(from, []);
      m.get(from)!.push({ id: to, name: other.name, concurrentActive: n });
    };
    for (const o of data.overlaps) { add(o.a, o.b, o.concurrentActive); add(o.b, o.a, o.concurrentActive); }
    return m;
  }, [data.overlaps, byId]);

  // 초점: 접힌 곳에 있으면 펼치고 카드도 펼친 뒤 그 자리로 스크롤한다.
  useEffect(() => {
    if (!focusId) return;
    const j = byId.get(focusId);
    if (!j) return;
    const groupKey = j.band === 'flow' ? `lane:${j.lane}` : `band:${j.band}`;
    setShowQuiet((prev) => (prev.has(groupKey) ? prev : new Set(prev).add(groupKey)));
    setClosedLanes((prev) => { if (!prev.has(groupKey)) return prev; const n = new Set(prev); n.delete(groupKey); return n; });
    setExpanded((prev) => (prev.has(focusId) ? prev : new Set(prev).add(focusId)));
    const t = window.setTimeout(() => {
      const el = contentRef.current?.querySelector(`[data-anchor~="j:${focusId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 60);
    return () => window.clearTimeout(t);
  }, [focusId, byId]);

  const drawable = useMemo(() => data.lines, [data.lines]);
  const layoutKey = `${statusFilter}|${q}|${[...expanded].join(',')}|${[...showQuiet].join(',')}|${[...closedLanes].join(',')}`;

  useLayoutEffect(() => {
    const root = contentRef.current;
    if (!root || !isDesktop) { setGeo([]); return; }
    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setGeo(computeGeometry(root, drawable));
        setSize({ w: root.scrollWidth, h: root.scrollHeight });
      });
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(root);
    root.querySelectorAll('[data-anchor]').forEach((el) => ro.observe(el));
    window.addEventListener('resize', run);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('resize', run); };
  }, [isDesktop, drawable, layoutKey]);

  useEffect(() => {
    if (!openLineId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenLineId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openLineId]);

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) =>
    set((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const renderCard = (j: MapJourney) => (
    <MapJourneyCard
      key={j.id}
      journey={j}
      outgoing={outgoingOf.get(j.id) || []}
      overlapsWith={overlapsOf.get(j.id) || []}
      expanded={expanded.has(j.id)}
      focused={focusId === j.id}
      onToggle={() => toggle(setExpanded, j.id)}
      onOpenStep={(s) => onOpenStep(j, s)}
      onFocusJourney={onFocusJourney}
      onOpenJourney={onOpenJourney}
      onNewVersion={onNewVersion}
    />
  );

  const renderQuiet = (quiet: MapJourney[], groupKey: string) => {
    if (quiet.length === 0) return null;
    const drafts = quiet.filter((j) => j.status === 'draft').length;
    const ended = quiet.length - drafts;
    const parts = [drafts > 0 ? `초안 ${drafts}` : '', ended > 0 ? `끝남 ${ended}` : ''].filter(Boolean).join(' · ');
    return (
      <button
        type="button"
        data-anchor={quiet.map((j) => `j:${j.id}`).join(' ')}
        onClick={() => toggle(setShowQuiet, groupKey)}
        className="w-full rounded-lg border border-dashed border-white/15 px-3 py-2 text-left text-[11px] text-white/50 hover:bg-white/[0.04] transition-colors"
      >
        {parts} 펼쳐 보기
      </button>
    );
  };

  const renderGhost = (g: LifecycleMapData['ghosts'][number]) => (
    <div key={g.triggerEvent} data-anchor={`g:${g.triggerEvent}`} className="rounded-xl border border-dashed border-white/20 bg-white/[0.02] p-3">
      <div className="text-xs font-semibold text-white/75">{g.label} 여정이 없어요</div>
      {g.available ? (
        <>
          <p className="mt-1 text-[11px] leading-relaxed text-white/45">이 구간에 들어온 고객에게 보낼 여정이 아직 없습니다.</p>
          <button
            type="button"
            onClick={() => onCreate(g.triggerEvent, g.createMode)}
            className="mt-2 h-8 w-full rounded-lg text-[11px] font-semibold text-violet-100 bg-violet-600/80 hover:bg-violet-500 inline-flex items-center justify-center gap-1 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> {g.label} 여정 만들기
          </button>
          <p className="mt-1 text-center text-[11px] text-white/35">초안 만들기 {data.costs.generate} 크레딧 · 켜기 전에는 보내지 않아요</p>
        </>
      ) : (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-white/45">
          <Lock className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{g.reason || '데이터 연동이 필요해요.'}</span>
        </p>
      )}
    </div>
  );

  const laneHead = (groupKey: string, label: string, count: number, hint?: string) => (
    <button
      type="button"
      onClick={() => toggle(setClosedLanes, groupKey)}
      aria-expanded={!closedLanes.has(groupKey)}
      className="w-full flex items-center gap-2 py-2 text-left md:cursor-default"
    >
      <span className="text-xs font-semibold tracking-wide text-white/80">{label}</span>
      <span className="text-[11px] text-white/40 tabular-nums">{count}</span>
      {hint && <span className="hidden md:inline text-[11px] text-white/35 truncate">{hint}</span>}
      <ChevronDown className={`md:hidden ml-auto w-4 h-4 text-white/40 transition-transform ${closedLanes.has(groupKey) ? '' : 'rotate-180'}`} />
    </button>
  );

  const openLine = openLineId ? geo.find((g) => g.line.id === openLineId) || null : null;

  const renderBand = (groupKey: string, label: string, list: MapJourney[], hint: string) => {
    if (list.length === 0) return null;
    const { shown, quiet } = groupOf(list, groupKey);
    const count = list.filter(matches).length;
    return (
      <section className="relative z-[1] mt-8">
        {laneHead(groupKey, label, count, hint)}
        <div className={`${closedLanes.has(groupKey) ? 'hidden' : 'grid'} md:grid gap-3 grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]`}>
          {shown.map(renderCard)}
          {renderQuiet(quiet, groupKey)}
          {shown.length === 0 && quiet.length === 0 && <div className="text-[11px] text-white/35 py-2">조건에 맞는 여정이 없어요.</div>}
        </div>
      </section>
    );
  };

  return (
    <div ref={contentRef} className="relative px-4 md:px-6 pt-4 pb-10">
      {isDesktop && size.w > 0 && (
        <svg className="absolute left-0 top-0 pointer-events-none" width={size.w} height={size.h} aria-hidden>
          <defs>
            {TIERS.map((t) => (
              <marker key={t} id={`jmap-arrow-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={LINE_STYLE[t].stroke} />
              </marker>
            ))}
          </defs>
          {geo.map((g) => {
            const st = LINE_STYLE[g.line.tier];
            const active = openLineId === g.line.id;
            return (
              <g key={g.line.id}>
                <path d={g.d} fill="none" stroke={st.stroke} strokeWidth={active ? 2.5 : 1.75} strokeDasharray={st.dash} markerEnd={`url(#jmap-arrow-${g.line.tier})`} opacity={active ? 1 : 0.85} />
                {g.line.tier === 'solid' && (g.line.handedOver7d || 0) > 0 && (
                  <path d={g.d} fill="none" stroke="#ddd6fe" strokeWidth={1.75} className="jmap-flow" />
                )}
              </g>
            );
          })}
        </svg>
      )}

      {/* 윗띠: 생애 흐름 레인 */}
      <div
        className="relative z-[1] flex flex-col gap-4 md:grid md:gap-x-[72px] md:gap-y-0"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, flowLanes.length)}, minmax(216px, 1fr))` }}
      >
        {flowLanes.map((lane) => {
          const groupKey = `lane:${lane.key}`;
          const inLane = data.journeys.filter((j) => j.band === 'flow' && j.lane === lane.key);
          const { shown, quiet } = groupOf(inLane, groupKey);
          const ghosts = data.ghosts.filter((g) => g.lane === lane.key);
          const count = inLane.filter(matches).length;
          return (
            <section key={lane.key} className="min-w-0">
              <div className="md:sticky md:top-0 z-[3] bg-slate-950/95 backdrop-blur-sm border-b border-white/10 mb-3">
                {laneHead(groupKey, lane.label, count)}
              </div>
              <div className={`${closedLanes.has(groupKey) ? 'hidden' : 'flex'} md:flex flex-col gap-3`}>
                {shown.map(renderCard)}
                {renderQuiet(quiet, groupKey)}
                {ghosts.map(renderGhost)}
              </div>
            </section>
          );
        })}
      </div>

      {/* 선 위 이름표 — 누르면 사유 · 숫자 */}
      {isDesktop && geo.map((g) => {
        const tone = g.line.tier === 'solid'
          ? 'border-violet-400/40 bg-slate-900 text-violet-100'
          : g.line.tier === 'warn'
            ? 'border-amber-400/50 bg-slate-900 text-amber-100'
            : 'border-white/20 bg-slate-900 text-white/60';
        const text = g.line.tier === 'solid' ? `이어받음 ${countText(g.line.handedOver)}` : LINE_SHORT[g.line.state];
        return (
          <button
            key={`pill:${g.line.id}`}
            type="button"
            onClick={() => setOpenLineId((cur) => (cur === g.line.id ? null : g.line.id))}
            className={`absolute z-[2] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[11px] font-medium shadow-sm hover:brightness-125 transition ${tone}`}
            style={{ left: g.mx, top: g.my }}
          >
            {text}
          </button>
        );
      })}

      {openLine && (() => {
        const ln = openLine.line;
        const from = byId.get(ln.fromJourneyId);
        const width = 272;
        const left = Math.max(8, Math.min(openLine.mx - width / 2, size.w - width - 8));
        return (
          <div
            role="dialog"
            aria-label="선 설명"
            className="absolute z-[4] rounded-xl border border-white/15 bg-slate-900 p-3 shadow-2xl shadow-black/50"
            style={{ left, top: openLine.my + 16, width }}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0 text-xs font-semibold text-white">
                {from?.name || '여정'} → {ln.toLabel} 여정
              </div>
              <button type="button" onClick={() => setOpenLineId(null)} className="p-0.5 rounded text-white/50 hover:text-white hover:bg-white/10" aria-label="닫기">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className={`mt-1.5 text-[11px] leading-relaxed ${ln.tier === 'warn' ? 'text-amber-200' : 'text-white/65'}`}>{ln.reason}</p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
                <div className="text-[11px] text-white/45">구매 확인(30일)</div>
                <div className="text-xs font-semibold text-emerald-300 tabular-nums">{ln.goalMet.toLocaleString('ko-KR')}명</div>
              </div>
              <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
                <div className="text-[11px] text-white/45">다음 여정에 들어옴</div>
                <div className="text-xs font-semibold text-violet-200 tabular-nums">{ln.handedOver == null ? '측정 전' : `${ln.handedOver.toLocaleString('ko-KR')}명`}</div>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">
              {ln.handedOver == null
                ? '다음 여정에 들어온 고객은 이번 업데이트 뒤 들어온 고객부터 셉니다.'
                : ln.handedOver === 0
                  ? '아직 넘어간 고객이 없어요. 켠 날부터 셉니다.'
                  : '같은 고객이 목표를 이룬 뒤 하루 안에 다음 여정에 들어온 수입니다.'}
            </p>
            {ln.fix && (
              <button type="button" onClick={() => { setOpenLineId(null); onFix(ln.fix!); }} className="mt-2 w-full h-8 rounded-lg text-[11px] font-semibold text-white bg-violet-600 hover:bg-violet-500 transition-colors">
                {ln.fix.label}
              </button>
            )}
            <div className="mt-1.5 flex gap-1.5">
              <button type="button" onClick={() => { setOpenLineId(null); onFocusJourney(ln.fromJourneyId); }} className="flex-1 h-8 rounded-lg text-[11px] font-medium text-white/80 border border-white/15 hover:bg-white/10 transition-colors">
                보내는 여정
              </button>
              {ln.toJourneyId && (
                <button type="button" onClick={() => { setOpenLineId(null); onFocusJourney(ln.toJourneyId!); }} className="flex-1 h-8 rounded-lg text-[11px] font-medium text-white/80 border border-white/15 hover:bg-white/10 transition-colors">
                  받는 여정
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* 아랫띠: 언제든 생기는 순간 · 상시 · 정보 알림 */}
      {renderBand('band:moment', '언제든 생기는 순간', momentJourneys, '장바구니 · 조회 후 미구매 · 배송 · 생일 · 등급 · 포인트')}
      {renderBand('band:standing', '상시 · 날짜 예약', standingJourneys, '고른 고객에게 한 번 · 기준일에 맞춰')}
      {renderBand('band:info', '정보 알림', infoJourneys, '광고가 아닌 알림톡 · 흐름에 넣지 않습니다')}
    </div>
  );
}
