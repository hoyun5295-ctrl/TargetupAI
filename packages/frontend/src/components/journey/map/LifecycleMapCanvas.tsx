/**
 * LifecycleMapCanvas — 고객 관계 지도 (★ 2026-10-09 전면 개편 · ★ 2026-10-20 여정 V.3 §10 보기 쉽게)
 *
 * 읽는 법 한 줄: **왼쪽에서 오른쪽 = 가입 → 첫 구매 → 재구매 → 이탈 · 복귀.** 상품 여정 = 열 아래 가로 띠.
 *   [한눈에](기본) = 여정마다 요약 카드 한 장(MapJourneyCard · 높이는 데이터로 · 배치 함수 그대로) · 선은 카드 머리 높이에서.
 *   [칸까지] = 옛 그림(문 + 칸 척추 + 구매 출구 ◆) 그대로 · 기본 펼침 규칙은 이 모양에서만.
 *   선은 카드 바탕 아래층 · 상품 띠로 가는 선은 띠 머리 한 점으로 묶는다(이름표 대신 상품 카드가 「이어받음 N명」).
 *
 * ⛔ 의미(선 상태 · 출구 · 숫자 · 손볼 곳 · 겹침)는 서버 값이다. 좌표만 utils/journey-map-layout(순수)이 정한다(DOM 측정 0).
 * ⛔ 호박색 = 손볼 곳 전용 · 멈춤 = 회색 · 글씨 하한 12px · 이름 14px.
 * 768 미만 = SVG 없이 레인별 세로 요약 카드(list 모양 · 기본 접힘 · 「구매하면 → ○○ 여정」 줄이 선을 대신한다).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, ChevronDown, ChevronUp, Flag, GitBranch, Hourglass, Lock, MessageSquare, Plus, RotateCcw, Wrench, X } from 'lucide-react';
import MapJourneyCard from './MapJourneyCard';
import {
  EXIT_STROKE, LINE_SHORT, LINE_STYLE, STATUS_META, countText, lineFinishLabel, lineTargetText, triggerWhen,
  type AttachFix, type CreateMode, type LifecycleMapData, type LineTier, type MapJourney, type MapLine, type MapOverlap,
} from '../../../utils/journey-map';
import { FLOW_COLUMNS, L, PRODUCT_LANE, layoutMap, matchesFilter, type CardLayout, type MapStatusFilter } from '../../../utils/journey-map-layout';
import { stepChannelLabel } from '../../../utils/journey-labels';
import '../../../styles/journey-map.css';

export type { MapStatusFilter } from '../../../utils/journey-map-layout';

interface Props {
  data: LifecycleMapData;
  statusFilter: MapStatusFilter;
  search: string;
  focusId: string | null;
  /** ★ V.3 — 한눈에(요약 카드) · 거짓 = 칸까지. */
  glance: boolean;
  busyId: string | null;
  onFocusJourney: (id: string) => void;
  /** 작업 화면(여정 · 칸) — 카드 · 칸 띠 · 칸 상자 어디서 눌러도 같은 창. */
  onOpen: (journeyId: string, stepId: string | null) => void;
  onEntrants: (journeyId: string) => void;
  /** 멈추기 · 다시 켜기 · 켜기(페이지의 공용 훅). */
  onAction: (journey: MapJourney) => void;
  onCreate: (triggerEvent: string, mode?: CreateMode) => void;
  /** 고치기(서버가 정한 행동) — 페이지가 요청을 소유한다. */
  onFix: (fix: AttachFix) => void;
  /** ★ V.3 §18 — 뒤에 여정 붙이기 창 · 앞 여정에서 떼기(페이지가 창 · 확인을 소유한다). */
  onAttach: (journey: MapJourney) => void;
  onDetach: (journey: MapJourney) => void;
}

const TIERS: LineTier[] = ['solid', 'warn', 'empty'];

function useMedia(q: string): boolean {
  const [ok, setOk] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(q).matches : true));
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setOk(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return ok;
}

const toggleIn = (set: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) =>
  set((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

/** 조건 칸 두 갈래 문구 — 서버 그래프 간선 그대로. */
function branchText(j: MapJourney, order: number): string {
  const edges = j.graph.edges.filter((e) => e.from === order);
  const met = edges.find((e) => e.kind === 'met');
  const notMet = edges.find((e) => e.kind === 'not_met' || e.kind === 'not_met_end');
  return `${met && met.to > 0 ? '맞으면 다음 칸' : '맞으면 끝'} · ${notMet && notMet.kind === 'not_met' ? `아니면 ${notMet.to}번째 칸` : '아니면 끝'}`;
}

/** 선 이름표 — 이어짐은 이어받은 사람이 있을 때만 「이어받음 N명」(분모 · 사유는 선 창) · 묶인 선은 없음. */
function lineLabel(ln: MapLine): string | null {
  if (ln.tier === 'solid') return (ln.handedOver || 0) > 0 ? `이어받음 ${Number(ln.handedOver).toLocaleString('ko-KR')}명` : null;
  return LINE_SHORT[ln.state];
}

export default function LifecycleMapCanvas({
  data, statusFilter, search, focusId, glance, busyId, onFocusJourney, onOpen, onEntrants, onAction, onCreate, onFix, onAttach, onDetach,
}: Props) {
  const isDesktop = useMedia('(min-width: 768px)');
  const wide = useMedia('(min-width: 1280px)');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showQuiet, setShowQuiet] = useState<Set<string>>(() => new Set());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState<Set<string>>(() => new Set());

  const byId = useMemo(() => new Map(data.journeys.map((j) => [j.id, j])), [data.journeys]);
  const layout = useMemo(
    () => layoutMap(data, { statusFilter, search, expanded, collapsed, showQuiet, preview: wide, glance }),
    [data, statusFilter, search, expanded, collapsed, showQuiet, wide, glance],
  );

  const outgoingOf = useMemo(() => {
    const m = new Map<string, MapLine[]>();
    for (const ln of data.lines) { if (!m.has(ln.fromJourneyId)) m.set(ln.fromJourneyId, []); m.get(ln.fromJourneyId)!.push(ln); }
    return m;
  }, [data.lines]);
  const incomingOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const ln of data.lines) if (ln.toJourneyId && ln.tier === 'solid') m.set(ln.toJourneyId, (m.get(ln.toJourneyId) || 0) + Number(ln.handedOver || 0));
    return m;
  }, [data.lines]);
  const overlapsOf = useMemo(() => {
    const m = new Map<string, MapOverlap[]>();
    for (const o of data.overlaps) for (const id of [o.a, o.b]) { if (!m.has(id)) m.set(id, []); m.get(id)!.push(o); }
    return m;
  }, [data.overlaps]);
  const nameOf = useCallback((id: string) => byId.get(id)?.name || '여정', [byId]);

  // 초점: 접혀 있으면 펼치고 그 자리로 스크롤.
  useEffect(() => {
    if (!focusId) return;
    const j = byId.get(focusId);
    if (!j) return;
    setCollapsed((p) => { if (!p.has(focusId)) return p; const n = new Set(p); n.delete(focusId); return n; });
    setExpanded((p) => (p.has(focusId) ? p : new Set(p).add(focusId)));
    if (j.lane) setShowQuiet((p) => (p.has(j.lane!) ? p : new Set(p).add(j.lane!)));
    setMobileOpen((p) => (p.has(focusId) ? p : new Set(p).add(focusId)));
    const t = window.setTimeout(() => {
      document.querySelector(`[data-jmap-card="${focusId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 80);
    return () => window.clearTimeout(t);
  }, [focusId, byId]);

  useEffect(() => {
    if (!openLineId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenLineId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openLineId]);

  const toggleCard = useCallback((j: MapJourney, c: CardLayout) => {
    if (c.open) {
      setExpanded((p) => { const n = new Set(p); n.delete(j.id); return n; });
      setCollapsed((p) => new Set(p).add(j.id));
    } else {
      setCollapsed((p) => { const n = new Set(p); n.delete(j.id); return n; });
      setExpanded((p) => new Set(p).add(j.id));
    }
  }, []);

  const related = useCallback((ln: MapLine) => !hoverId || ln.fromJourneyId === hoverId || ln.toJourneyId === hoverId, [hoverId]);

  const card = (j: MapJourney, variant: 'canvas' | 'list', extra: { style?: React.CSSProperties; expanded?: boolean; onToggle?: () => void } = {}) => (
    <MapJourneyCard
      key={j.id}
      journey={j}
      variant={variant}
      overlaps={overlapsOf.get(j.id) || []}
      nameOf={nameOf}
      incoming={j.lane === PRODUCT_LANE ? incomingOf.get(j.id) ?? null : null}
      outgoing={outgoingOf.get(j.id) || []}
      focused={focusId === j.id}
      busy={busyId === j.id}
      onOpen={(stepId) => onOpen(j.id, stepId)}
      onAction={() => onAction(j)}
      onFix={onFix}
      onFocusJourney={onFocusJourney}
      onEntrants={() => onEntrants(j.id)}
      onAttach={() => onAttach(j)}
      onDetach={() => onDetach(j)}
      onHover={(on) => setHoverId(on ? j.id : null)}
      {...extra}
    />
  );

  const renderGhost = (g: LifecycleMapData['ghosts'][number]) => (
    <>
      <div className="text-[13px] font-semibold text-slate-700">{g.label} 여정이 없어요</div>
      {g.available ? (
        <>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-500">이 단계에 들어온 고객을 맞이할 여정이 아직 없어요.</p>
          <button
            type="button"
            onClick={() => onCreate(g.triggerEvent, g.createMode)}
            className="mt-2 h-8 w-full rounded-lg text-[12.5px] font-semibold text-white bg-slate-900 hover:bg-slate-800 inline-flex items-center justify-center gap-1 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> {g.label} 여정 만들기
          </button>
          <p className="mt-1 text-center text-[12px] text-slate-400">초안 {data.costs.generate}크레딧 · 켜기 전에는 보내지 않아요</p>
        </>
      ) : (
        <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-relaxed text-slate-500">
          <Lock className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{g.reason || '데이터 연동이 필요해요.'}</span>
        </p>
      )}
    </>
  );

  // ── 모바일: 레인별 세로 요약 카드(기본 접힘 · 범례 숨김 · 선 대신 「구매하면 →」 줄) ──
  if (!isDesktop) {
    const lanes = [...FLOW_COLUMNS, { key: PRODUCT_LANE, label: '상품 여정' }];
    return (
      <div className="px-3 pt-3 pb-8 space-y-6">
        {lanes.map((lane) => {
          const list = data.journeys.filter((j) => j.band === 'flow' && j.lane === lane.key && matchesFilter(j, statusFilter, search));
          const gs = data.ghosts.filter((g) => g.lane === lane.key);
          if (list.length === 0 && gs.length === 0) return null;
          return (
            <section key={lane.key}>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-[14px] font-semibold text-slate-800">{lane.label}</span>
                <span className="text-[12px] tabular-nums text-slate-400">{list.length}</span>
              </div>
              <div className="space-y-3">
                {list.map((j) => card(j, 'list', { expanded: mobileOpen.has(j.id), onToggle: () => toggleIn(setMobileOpen, j.id) }))}
                {gs.map((g) => <div key={g.triggerEvent} className="rounded-xl border border-dashed border-slate-300 bg-white p-3">{renderGhost(g)}</div>)}
              </div>
            </section>
          );
        })}
        <BottomBands data={data} statusFilter={statusFilter} search={search} card={card} />
      </div>
    );
  }

  const openLine = openLineId ? layout.lines.find((g) => g.line.id === openLineId) || null : null;

  return (
    <div className="pb-8">
      {/* 열 머리 — 판 안에서 스크롤해도 남는다 · 흐름 화살 */}
      <div className="sticky top-0 z-[6] border-b border-slate-200 bg-white/95 backdrop-blur" style={{ minWidth: layout.width }}>
        <div className="relative mx-auto h-11" style={{ width: layout.width }}>
          {layout.columns.map((c, i) => (
            <div key={c.key} className="absolute top-0 flex h-11 items-center gap-2" style={{ left: c.x, width: L.colW + (i < layout.columns.length - 1 ? L.gap : 0) }}>
              <span className="text-[14px] font-semibold text-slate-800">{c.label}</span>
              <span className="text-[12px] tabular-nums text-slate-400">{c.count}</span>
              {i < layout.columns.length - 1 && <ArrowRight className="ml-auto mr-6 h-4 w-4 text-slate-300" aria-hidden />}
            </div>
          ))}
        </div>
      </div>
      <div className="px-6 pt-3"><Legend /></div>
      <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }} onMouseLeave={() => setHoverId(null)}>
        {layout.band && (
          <div className="absolute flex items-center gap-2 border-b border-slate-200 pb-2" style={{ left: layout.band.x, top: layout.band.y, width: layout.band.w }}>
            <span className="text-[14px] font-semibold text-slate-800">상품 여정</span>
            <span className="text-[12px] tabular-nums text-slate-400">{layout.band.count}</span>
            <span className="text-[12px] text-slate-400">고른 상품이 들어 있는 구매로 함께 시작해요</span>
          </div>
        )}

        {/* 선 · 척추 · 출구(SVG 한 장 · 카드 아래층) */}
        <svg className="absolute left-0 top-0 pointer-events-none" width={layout.width} height={layout.height} aria-hidden>
          <defs>
            {TIERS.map((t) => (
              <marker key={t} id={`jmap-arrow-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={LINE_STYLE[t].stroke} />
              </marker>
            ))}
          </defs>
          {layout.lines.map((g) => {
            const st = LINE_STYLE[g.tier];
            const on = related(g.line);
            const active = openLineId === g.line.id;
            return (
              <g key={g.line.id} opacity={on ? 1 : 0.25}>
                <path d={g.d} fill="none" stroke={st.stroke} strokeWidth={active ? 2.75 : 2} strokeDasharray={st.dash} markerEnd={`url(#jmap-arrow-${g.tier})`} />
                {g.tier === 'solid' && (g.line.handedOver7d || 0) > 0 && (
                  <path d={g.d} fill="none" stroke="#a78bfa" strokeWidth={2} className="jmap-flow" />
                )}
              </g>
            );
          })}
        </svg>

        {glance ? (
          layout.cards.map((c) => card(byId.get(c.journeyId)!, 'canvas', { style: { left: c.x, top: c.y, width: c.w, height: c.h } }))
        ) : (
          <>
            {/* 카드 바탕(척추를 담는 틀) */}
            {layout.cards.map((c) => {
              const j = byId.get(c.journeyId)!;
              const dim = j.status === 'draft' || j.status === 'ended';
              return (
                <div
                  key={`bg:${c.journeyId}`}
                  data-jmap-card={c.journeyId}
                  className={`absolute rounded-2xl border bg-white transition-shadow ${dim ? 'border-dashed border-slate-300' : 'border-slate-200 shadow-sm'} ${focusId === c.journeyId ? 'ring-2 ring-indigo-300' : ''} ${hoverId === c.journeyId ? 'shadow-md' : ''}`}
                  style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
                  onMouseEnter={() => setHoverId(c.journeyId)}
                />
              );
            })}
            <svg className="absolute left-0 top-0 pointer-events-none" width={layout.width} height={layout.height} aria-hidden>
              {layout.cards.filter((c) => c.open && c.steps.length > 0).map((c) => (
                <line key={`spine:${c.journeyId}`} x1={c.x + 30} y1={c.y + L.doorH - 4} x2={c.x + 30} y2={(c.endY ?? c.y + c.h) + 8} stroke="#e2e8f0" strokeWidth={2} />
              ))}
              {layout.cards.map((c) => (
                <g key={`exit:${c.journeyId}`}>
                  {c.exits.map((e) => (
                    <line key={e.slot} x1={c.x + c.w - 2} y1={e.y} x2={c.rail ? c.rail.x : c.x + c.w + L.railOff} y2={e.y} stroke={EXIT_STROKE} strokeWidth={1.75} />
                  ))}
                  {c.rail && <line x1={c.rail.x} y1={c.rail.y1} x2={c.rail.x} y2={c.rail.y2} stroke={EXIT_STROKE} strokeWidth={1.75} />}
                  {c.diamond && <path d={`M ${c.diamond.x} ${c.diamond.y - 6} L ${c.diamond.x + 6} ${c.diamond.y} L ${c.diamond.x} ${c.diamond.y + 6} L ${c.diamond.x - 6} ${c.diamond.y} Z`} fill={EXIT_STROKE} />}
                </g>
              ))}
            </svg>

            {/* 카드 내용(칸까지) */}
            {layout.cards.map((c) => {
              const j = byId.get(c.journeyId)!;
              const st = STATUS_META[j.status] || STATUS_META.ended;
              const fix = j.health && (j.health.tone === 'fix' || j.health.tone === 'blocked');
              const ov = overlapsOf.get(j.id) || [];
              return (
                <div key={`card:${c.journeyId}`} onMouseEnter={() => setHoverId(c.journeyId)}>
                  <div className="absolute px-3 pt-2.5" style={{ left: c.door.x, top: c.door.y, width: c.door.w, height: c.open ? L.doorH : c.h }}>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} aria-hidden />
                      <button type="button" onClick={() => toggleCard(j, c)} className="flex-1 min-w-0 text-left text-[14px] font-semibold text-slate-900 truncate hover:text-indigo-700" aria-expanded={c.open}>
                        {j.name || '이름 없는 여정'}
                      </button>
                      {fix && <span className="shrink-0 inline-flex items-center rounded-full bg-amber-50 px-1.5 text-amber-800" title={j.health.text}><AlertCircle className="w-3.5 h-3.5" /></span>}
                      <button type="button" onClick={() => onOpen(j.id, null)} className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label={`${j.name} 고치기`}>
                        <Wrench className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => toggleCard(j, c)} className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label={c.open ? '칸 접기' : '칸 펼치기'}>
                        {c.open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-slate-500 min-w-0">
                      <span className="shrink-0">{st.label}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{triggerWhen(j.triggerLabel, j.triggerEvent)} 시작</span>
                      <span className="ml-auto shrink-0 tabular-nums text-slate-400" title={`최근 ${j.windowDays}일 들어온 고객`}>{j.windowDays}일 {j.counts.entered.toLocaleString('ko-KR')}명</span>
                    </div>
                    {ov.length > 0 && c.open && (
                      <button type="button" onClick={() => (ov[0].fix ? onFix(ov[0].fix) : onFocusJourney(ov[0].a === j.id ? ov[0].b : ov[0].a))}
                        className={`absolute right-2 -top-3 max-w-[90%] truncate rounded-full border px-2 py-0.5 text-[12px] shadow-sm ${ov[0].fix ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-500'}`}>
                        {ov[0].text}{ov[0].fix ? ` · ${ov[0].fix.label}` : ''}
                      </button>
                    )}
                  </div>

                  {c.open && j.steps.map((s, i) => {
                    const b = c.steps[i];
                    if (!b) return null;
                    const Icon = s.kind === 'wait' ? Hourglass : s.kind === 'condition' ? GitBranch : s.kind === 'message' ? MessageSquare : AlertCircle;
                    const tone = s.kind === 'message' ? 'text-indigo-600' : s.kind === 'condition' ? 'text-cyan-600' : 'text-slate-400';
                    const exit = c.exits.find((e) => e.slot === s.order - 1);
                    return (
                      <div key={s.stepId}>
                        {b.intervalY != null && (
                          <div className="absolute flex items-center gap-1.5 text-[12px] text-slate-500" style={{ left: c.x + 40, top: b.intervalY - 9, width: c.w - 52, height: 18 }}>
                            <span className="truncate">↓ {s.intervalLabel}</span>
                            {exit && <span className="ml-auto shrink-0 font-medium tabular-nums text-emerald-700">구매 확인 {countText(exit.n)}</span>}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpen(j.id, s.stepId)}
                          className="absolute text-left rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 hover:border-indigo-300 hover:shadow-sm transition"
                          style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                        >
                          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-800">
                            <Icon className={`w-3.5 h-3.5 shrink-0 ${tone}`} />
                            <span className="truncate">
                              {s.kind === 'message' ? `${s.order}번째 문자 · ${stepChannelLabel(s.channel)}` : s.kind === 'condition' ? `${s.order}번째 · 조건` : s.kind === 'wait' ? `${s.order}번째 · 기다림` : `${s.order}번째 · 알 수 없는 칸`}
                            </span>
                            <span className="ml-auto shrink-0 font-normal text-[12px] text-slate-500 tabular-nums">{s.timingLabel}</span>
                          </div>
                          {s.kind === 'message' && wide && s.preview && <div className="mt-0.5 text-[12px] text-slate-500 truncate">{s.preview}</div>}
                          {s.kind === 'condition' && <div className="mt-0.5 text-[12px] text-slate-500 truncate">{branchText(j, s.order)}</div>}
                          {s.kind === 'message' && (
                            <div className="mt-0.5 flex items-center gap-2 text-[12px] tabular-nums">
                              {s.waitingHere > 0 && <span className="text-slate-600">지금 {s.waitingHere.toLocaleString('ko-KR')}명</span>}
                              {s.pendingHere != null && s.pendingHere > 0 && <span className="text-emerald-700">곧 마침 {s.pendingHere.toLocaleString('ko-KR')}</span>}
                              <span className="ml-auto text-slate-400">{s.outOfWindow ? `${j.windowDays}일 창 밖` : `받음 ${countText(s.reached, '0')}`}</span>
                            </div>
                          )}
                        </button>
                      </div>
                    );
                  })}

                  {c.open && c.endY != null && (
                    <>
                      {(() => {
                        const lastExit = c.exits.find((e) => e.slot === j.steps.length);
                        return lastExit ? (
                          <div className="absolute text-right text-[12px] font-medium tabular-nums text-emerald-700" style={{ left: c.x + 40, top: c.endY - 20, width: c.w - 52 }}>구매 확인 {countText(lastExit.n)}</div>
                        ) : null;
                      })()}
                      <div className="absolute flex items-center gap-1.5 px-3 text-[12px] text-slate-500" style={{ left: c.x, top: c.endY, width: c.w, height: L.endH }}>
                        {j.entryReplace ? <RotateCcw className="w-3 h-3 shrink-0 text-emerald-600" /> : <Flag className="w-3 h-3 shrink-0 text-slate-400" />}
                        <span className="truncate">{j.entryReplace ? '같은 상품을 다시 사면 처음부터' : j.endNote}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-slate-400">끝까지 {countText(j.counts.completed, '0')}</span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* 초안 · 끝남 묶음 */}
        {layout.quiet.map((q) => (
          <button
            key={`quiet:${q.lane}`}
            type="button"
            onClick={() => toggleIn(setShowQuiet, q.lane)}
            className="absolute rounded-xl border border-dashed border-slate-300 bg-white px-3 text-left text-[12.5px] text-slate-500 hover:bg-slate-50"
            style={{ left: q.x, top: q.y, width: q.w, height: q.h }}
          >
            {q.label} 펼쳐 보기
          </button>
        ))}

        {/* 빈 자리 */}
        {layout.ghosts.map((g) => {
          const ghost = data.ghosts.find((x) => x.triggerEvent === g.triggerEvent);
          if (!ghost) return null;
          return (
            <div key={`ghost:${g.triggerEvent}`} className="absolute rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-3" style={{ left: g.x, top: g.y, width: g.w, height: g.h }}>
              {renderGhost(ghost)}
            </div>
          );
        })}

        {/* 선 이름표 — 누르면 사유 · 숫자 · 고치기(묶인 선 · 이어받음 0 인 이어짐은 이름표 없음) */}
        {layout.lines.map((g) => {
          const label = g.bundled ? null : lineLabel(g.line);
          if (!label) return null;
          const tone = g.tier === 'solid' ? 'border-slate-300 bg-white text-slate-800' : g.tier === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-300 bg-white text-slate-500';
          return (
            <button
              key={`pill:${g.line.id}`}
              type="button"
              onClick={() => setOpenLineId((cur) => (cur === g.line.id ? null : g.line.id))}
              className={`absolute z-[2] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium shadow-sm transition ${tone} ${related(g.line) ? '' : 'opacity-30'}`}
              style={{ left: g.mx, top: g.my }}
            >
              {label}
            </button>
          );
        })}

        {openLine && (() => {
          const ln = openLine.line;
          const from = byId.get(ln.fromJourneyId);
          const width = 300;
          const left = Math.max(8, Math.min(openLine.mx - width / 2, layout.width - width - 8));
          return (
            <div role="dialog" aria-label="선 설명" className="absolute z-[4] rounded-xl border border-slate-200 bg-white p-3 shadow-xl" style={{ left, top: openLine.my + 16, width }}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0 text-[13px] font-semibold text-slate-900">{from?.name || '여정'} → {lineTargetText(ln)}</div>
                <button type="button" onClick={() => setOpenLineId(null)} className="p-0.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100" aria-label="닫기"><X className="w-3.5 h-3.5" /></button>
              </div>
              <p className={`mt-1.5 text-[12px] leading-relaxed ${ln.tier === 'warn' ? 'text-amber-800' : 'text-slate-500'}`}>{ln.reason}</p>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {[
                  [lineFinishLabel(ln), `${ln.goalMet.toLocaleString('ko-KR')}명`, 'text-emerald-700'],
                  ['이어받음', ln.handedOver == null ? '측정 전' : `${ln.handedOver.toLocaleString('ko-KR')}명`, 'text-slate-800'],
                  ['받는 쪽 전체', ln.receiverEntered == null ? '없음' : `${ln.receiverEntered.toLocaleString('ko-KR')}명`, 'text-slate-800'],
                ].map(([k, v, t]) => (
                  <div key={k} className="rounded-lg bg-slate-50 px-2 py-1.5">
                    <div className="text-[12px] text-slate-400">{k}</div>
                    <div className={`text-[13px] font-semibold tabular-nums ${t}`}>{v}</div>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-slate-400">
                최근 {ln.windowDays}일 들어온 고객 기준이에요. {ln.handedOver == null
                  ? '이어받은 고객은 이번 업데이트 뒤 들어온 고객부터 세요.'
                  : ln.kind === 'attach'
                    ? '앞 여정을 마치고 이 여정으로 넘어온 고객 수예요.'
                    : '구매로 앞 여정을 마친 뒤 하루 안에 받는 여정이 자기 시작 사건으로 맞이한 수예요.'}
              </p>
              {ln.fix && (
                <button type="button" onClick={() => { setOpenLineId(null); onFix(ln.fix!); }} className="mt-2 w-full h-8 rounded-lg text-[12.5px] font-semibold text-white bg-slate-900 hover:bg-slate-800 transition-colors">
                  {ln.fix.label}
                </button>
              )}
              <div className="mt-1.5 flex gap-1.5">
                <button type="button" onClick={() => { setOpenLineId(null); onFocusJourney(ln.fromJourneyId); }} className="flex-1 h-8 rounded-lg text-[12.5px] font-medium text-slate-700 border border-slate-200 hover:bg-slate-50">보내는 여정</button>
                {ln.toJourneyId && (
                  <button type="button" onClick={() => { setOpenLineId(null); onFocusJourney(ln.toJourneyId!); }} className="flex-1 h-8 rounded-lg text-[12.5px] font-medium text-slate-700 border border-slate-200 hover:bg-slate-50">받는 여정</button>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      <div className="px-6">
        <BottomBands data={data} statusFilter={statusFilter} search={search} card={card} />
      </div>
    </div>
  );
}

/** 범례 세 가지(선의 뜻 · 12px). */
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-slate-500">
      {(['solid', 'warn', 'empty'] as const).map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <svg width="24" height="6" aria-hidden><line x1="0" y1="3" x2="24" y2="3" stroke={LINE_STYLE[t].stroke} strokeWidth="2" strokeDasharray={LINE_STYLE[t].dash} /></svg>
          {LINE_STYLE[t].label}
        </span>
      ))}
    </div>
  );
}

/** 아랫띠 — 언제든 생기는 순간 · 상시 · 정보 알림(선에 참여하지 않는다 · 요약 카드 격자). */
function BottomBands({ data, statusFilter, search, card }: {
  data: LifecycleMapData;
  statusFilter: MapStatusFilter;
  search: string;
  card: (j: MapJourney, variant: 'canvas' | 'list', extra?: { expanded?: boolean; onToggle?: () => void }) => JSX.Element;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const bands: Array<{ key: MapJourney['band']; label: string; hint: string }> = [
    { key: 'moment', label: '언제든 생기는 순간', hint: '장바구니 · 조회 후 미구매 · 배송 · 생일 · 등급 · 포인트' },
    { key: 'standing', label: '상시 · 날짜 예약', hint: '고른 고객에게 한 번 · 기준일에 맞춰' },
    { key: 'info', label: '정보 알림', hint: '광고가 아닌 알림톡 · 흐름에 넣지 않아요' },
  ];
  return (
    <>
      {bands.map((b) => {
        const list = data.journeys.filter((j) => j.band === b.key && matchesFilter(j, statusFilter, search));
        if (list.length === 0) return null;
        return (
          <section key={b.key} className="mt-8">
            <div className="mb-2 flex items-baseline gap-2 border-b border-slate-200 pb-2">
              <span className="text-[14px] font-semibold text-slate-800">{b.label}</span>
              <span className="text-[12px] tabular-nums text-slate-400">{list.length}</span>
              <span className="hidden md:inline text-[12px] text-slate-400 truncate">{b.hint}</span>
            </div>
            <div className="grid gap-3 grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
              {list.map((j) => card(j, 'list', { expanded: open.has(j.id), onToggle: () => toggleIn(setOpen, j.id) }))}
            </div>
          </section>
        );
      })}
    </>
  );
}
