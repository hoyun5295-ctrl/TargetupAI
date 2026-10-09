/**
 * LifecycleMapCanvas — 고객 관계 지도 (★ 2026-10-09 전면 개편 · 설계서 docs/2026-10-09-journey-crm-map-design.md §2)
 *
 * 읽는 법 한 줄: **아래로 = 기다림 · 오른쪽으로 = 샀다.**
 *   열 = 가입 · 첫 구매 · 재구매 · 이탈·복귀 · 상품 여정 = 열 아래 가로 띠.
 *   여정 = 문(시작 사건) + 칸 척추(늘 펼침 · 레인마다 켜짐 · 멈춤 앞 2개) + 바닥 줄(언제 끝나는가).
 *   구매 출구 = 서버 출구 자리에만 카드 오른쪽 초록 눈금 → 레일 → ◆ 하나 → 받는 여정 문(같은 여정의 선은 ◆ 를 공유 = 포크).
 *
 * ⛔ 의미(선 상태 · 출구 · 숫자 · 편집 정책)는 서버 값이다. 좌표만 utils/journey-map-layout(순수)이 정한다(DOM 측정 0).
 * ⛔ 선은 "옮겨 넣음"이 아니다 — 받는 여정이 자기 시작 사건으로 맞이한 것(범례 상시 · 라벨 = 이어받음 M / 전체 X).
 * 768 미만 = SVG 없이 레인별 세로 카드(MapJourneyCard) · 카드 속 "구매하면 → ○○ 여정" 줄이 선을 대신한다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, ExternalLink, Flag, GitBranch, Hourglass, Lock, MessageSquare, Plus, RotateCcw, Users, X } from 'lucide-react';
import MapJourneyCard from './MapJourneyCard';
import {
  EXIT_STROKE, LINE_SHORT, LINE_STYLE, STATUS_META, countText,
  type AttachFix, type CreateMode, type LifecycleMapData, type LineTier, type MapJourney, type MapLine, type MapStep,
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
  onFocusJourney: (id: string) => void;
  onOpenStep: (journey: MapJourney, step: MapStep) => void;
  onOpenJourney: (id: string) => void;
  onCreate: (triggerEvent: string, mode?: CreateMode) => void;
  /** 선 고치기(서버가 정한 행동) — 페이지가 확인 창 · 요청을 소유한다. */
  onFix: (fix: AttachFix) => void;
  onNewVersion: (journey: MapJourney) => void;
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

function warnCount(j: MapJourney): number {
  return (j.broadAudience ? 1 : 0) + (j.capability && !j.capability.available && j.status !== 'ended' ? 1 : 0) + j.graph.issues.length;
}

export default function LifecycleMapCanvas({
  data, statusFilter, search, focusId, onFocusJourney, onOpenStep, onOpenJourney, onCreate, onFix, onNewVersion,
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
    () => layoutMap(data, { statusFilter, search, expanded, collapsed, showQuiet, preview: wide }),
    [data, statusFilter, search, expanded, collapsed, showQuiet, wide],
  );

  const outgoingOf = useMemo(() => {
    const m = new Map<string, MapLine[]>();
    for (const ln of data.lines) { if (!m.has(ln.fromJourneyId)) m.set(ln.fromJourneyId, []); m.get(ln.fromJourneyId)!.push(ln); }
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

  const lineLabel = (ln: MapLine) => (ln.tier === 'solid'
    ? `이어받음 ${countText(ln.handedOver)}${ln.receiverEntered != null && ln.handedOver != null ? ` / ${ln.receiverEntered.toLocaleString('ko-KR')}` : ''}`
    : LINE_SHORT[ln.state]);

  const renderGhost = (g: LifecycleMapData['ghosts'][number]) => (
    <>
      <div className="text-[12px] font-semibold text-slate-700">{g.label} 여정이 없어요</div>
      {g.available ? (
        <>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">이 단계에 들어온 고객을 맞이할 여정이 아직 없습니다.</p>
          <button
            type="button"
            onClick={() => onCreate(g.triggerEvent, g.createMode)}
            className="mt-2 h-8 w-full rounded-lg text-[12px] font-semibold text-white bg-slate-900 hover:bg-slate-800 inline-flex items-center justify-center gap-1 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> {g.label} 여정 만들기
          </button>
          <p className="mt-1 text-center text-[11px] text-slate-400">초안 {data.costs.generate} 크레딧 · 켜기 전에는 보내지 않아요</p>
        </>
      ) : (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
          <Lock className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{g.reason || '데이터 연동이 필요해요.'}</span>
        </p>
      )}
    </>
  );

  // ── 모바일: 레인별 세로 카드(척추는 카드 안 · 선 대신 "구매하면 →" 줄) ──
  if (!isDesktop) {
    const lanes = [...FLOW_COLUMNS, { key: PRODUCT_LANE, label: '상품 여정' }];
    return (
      <div className="px-3 pt-3 pb-8 space-y-6">
        <Legend />
        {lanes.map((lane) => {
          const list = data.journeys.filter((j) => j.band === 'flow' && j.lane === lane.key && matchesFilter(j, statusFilter, search));
          const gs = data.ghosts.filter((g) => g.lane === lane.key);
          if (list.length === 0 && gs.length === 0) return null;
          return (
            <section key={lane.key}>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-[13px] font-semibold text-slate-800">{lane.label}</span>
                <span className="text-[11px] tabular-nums text-slate-400">{list.length}</span>
              </div>
              <div className="space-y-3">
                {list.map((j) => (
                  <MapJourneyCard
                    key={j.id}
                    journey={j}
                    outgoing={outgoingOf.get(j.id) || []}
                    overlapsWith={overlapsOf.get(j.id) || []}
                    expanded={mobileOpen.has(j.id) || ((j.status === 'active' || j.status === 'paused') && !collapsed.has(j.id))}
                    focused={focusId === j.id}
                    onToggle={() => {
                      const open = mobileOpen.has(j.id) || ((j.status === 'active' || j.status === 'paused') && !collapsed.has(j.id));
                      if (open) { setMobileOpen((p) => { const n = new Set(p); n.delete(j.id); return n; }); setCollapsed((p) => new Set(p).add(j.id)); }
                      else { setCollapsed((p) => { const n = new Set(p); n.delete(j.id); return n; }); setMobileOpen((p) => new Set(p).add(j.id)); }
                    }}
                    onOpenStep={(s) => onOpenStep(j, s)}
                    onFocusJourney={onFocusJourney}
                    onOpenJourney={onOpenJourney}
                    onNewVersion={onNewVersion}
                  />
                ))}
                {gs.map((g) => <div key={g.triggerEvent} className="rounded-xl border border-dashed border-slate-300 bg-white p-3">{renderGhost(g)}</div>)}
              </div>
            </section>
          );
        })}
        <BottomBands data={data} statusFilter={statusFilter} search={search} focusId={focusId} outgoingOf={outgoingOf} overlapsOf={overlapsOf}
          onOpenStep={onOpenStep} onFocusJourney={onFocusJourney} onOpenJourney={onOpenJourney} onNewVersion={onNewVersion} />
      </div>
    );
  }

  const openLine = openLineId ? layout.lines.find((g) => g.line.id === openLineId) || null : null;

  return (
    <div className="pb-8">
      <div className="px-6 pt-4"><Legend /></div>
      <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }} onMouseLeave={() => setHoverId(null)}>
        {/* 열 머리 */}
        {layout.columns.map((c) => (
          <div key={c.key} className="absolute flex items-center gap-2 border-b border-slate-200 pb-2" style={{ left: c.x, top: 6, width: L.colW }}>
            <span className="text-[13px] font-semibold text-slate-800">{c.label}</span>
            <span className="text-[11px] tabular-nums text-slate-400">{c.count}</span>
          </div>
        ))}
        {layout.band && (
          <div className="absolute flex items-center gap-2 border-b border-slate-200 pb-2" style={{ left: layout.band.x, top: layout.band.y, width: layout.band.w }}>
            <span className="text-[13px] font-semibold text-slate-800">상품 여정</span>
            <span className="text-[11px] tabular-nums text-slate-400">{layout.band.count}</span>
            <span className="text-[11px] text-slate-400">고른 상품이 들어 있는 구매로 함께 시작해요</span>
          </div>
        )}

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

        {/* 선 · 척추 · 출구(SVG 한 장) */}
        <svg className="absolute left-0 top-0 pointer-events-none" width={layout.width} height={layout.height} aria-hidden>
          <defs>
            {TIERS.map((t) => (
              <marker key={t} id={`jmap-arrow-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={LINE_STYLE[t].stroke} />
              </marker>
            ))}
          </defs>
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

        {/* 카드 내용 */}
        {layout.cards.map((c) => {
          const j = byId.get(c.journeyId)!;
          const st = STATUS_META[j.status] || STATUS_META.ended;
          const warns = warnCount(j);
          const overlaps = overlapsOf.get(j.id) || [];
          return (
            <div key={`card:${c.journeyId}`} onMouseEnter={() => setHoverId(c.journeyId)}>
              {/* 문 */}
              <div className="absolute px-3 pt-2.5" style={{ left: c.door.x, top: c.door.y, width: c.door.w, height: c.open ? L.doorH : c.h }}>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} aria-hidden />
                  <button type="button" onClick={() => toggleCard(j, c)} className="flex-1 min-w-0 text-left text-[13px] font-semibold text-slate-900 truncate hover:text-indigo-700" aria-expanded={c.open}>
                    {j.name || '이름 없는 여정'}
                  </button>
                  {warns > 0 && <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 text-[11px] font-medium text-amber-800"><AlertCircle className="w-3 h-3" />{warns}</span>}
                  <button type="button" onClick={() => onOpenJourney(j.id)} className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label={`${j.name} 자세히 보기`}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => toggleCard(j, c)} className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label={c.open ? '칸 접기' : '칸 펼치기'}>
                    {c.open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 min-w-0">
                  <span className="shrink-0">{st.label}</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{j.triggerLabel} 때 시작</span>
                  <span className="ml-auto shrink-0 tabular-nums text-slate-400" title={`최근 ${j.windowDays}일 들어온 고객`}>{j.windowDays}일 {j.counts.entered.toLocaleString('ko-KR')}명</span>
                </div>
                {overlaps.length > 0 && c.open && (
                  <button type="button" onClick={() => onFocusJourney(overlaps[0].id)} className="absolute right-2 -top-3 inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-900 shadow-sm hover:bg-rose-100">
                    <Users className="w-3 h-3" /> 같은 구매로 함께 시작 · {overlaps[0].name}
                  </button>
                )}
              </div>

              {/* 칸 */}
              {c.open && j.steps.map((s, i) => {
                const b = c.steps[i];
                if (!b) return null;
                const Icon = s.kind === 'wait' ? Hourglass : s.kind === 'condition' ? GitBranch : s.kind === 'message' ? MessageSquare : AlertCircle;
                const tone = s.kind === 'message' ? 'text-indigo-600' : s.kind === 'condition' ? 'text-cyan-600' : 'text-slate-400';
                const exit = c.exits.find((e) => e.slot === s.order - 1);
                return (
                  <div key={s.stepId}>
                    {b.intervalY != null && (
                      <div className="absolute flex items-center gap-1.5 text-[11px] text-slate-500" style={{ left: c.x + 40, top: b.intervalY - 9, width: c.w - 52, height: 18 }}>
                        <span className="truncate">↓ {s.intervalLabel}</span>
                        {exit && <span className="ml-auto shrink-0 font-medium tabular-nums text-emerald-700">구매 확인 {countText(exit.n)}</span>}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenStep(j, s)}
                      className="absolute text-left rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 hover:border-indigo-300 hover:shadow-sm transition"
                      style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                    >
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${tone}`} />
                        <span className="truncate">
                          {s.kind === 'message' ? `${s.order}번째 문자 · ${stepChannelLabel(s.channel)}` : s.kind === 'condition' ? `${s.order}번째 · 조건` : s.kind === 'wait' ? `${s.order}번째 · 기다림` : `${s.order}번째 · 알 수 없는 칸`}
                        </span>
                        <span className="ml-auto shrink-0 font-normal text-[11px] text-slate-500 tabular-nums">{s.timingLabel}</span>
                      </div>
                      {s.kind === 'message' && wide && s.preview && <div className="mt-0.5 text-[11px] text-slate-500 truncate">{s.preview}</div>}
                      {s.kind === 'condition' && <div className="mt-0.5 text-[11px] text-slate-500 truncate">{branchText(j, s.order)}</div>}
                      {s.kind === 'message' && (
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] tabular-nums">
                          {s.waitingHere > 0 && <span className="text-slate-600">지금 {s.waitingHere.toLocaleString('ko-KR')}명</span>}
                          {s.pendingHere != null && s.pendingHere > 0 && <span className="text-emerald-700">곧 마침 {s.pendingHere.toLocaleString('ko-KR')}</span>}
                          <span className="ml-auto text-slate-400">{s.outOfWindow ? `${j.windowDays}일 창 밖` : `받음 ${countText(s.reached, '0')}`}</span>
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}

              {/* 마지막 칸 뒤 출구 · 바닥 줄 */}
              {c.open && c.endY != null && (
                <>
                  {(() => {
                    const lastExit = c.exits.find((e) => e.slot === j.steps.length);
                    return lastExit ? (
                      <div className="absolute text-right text-[11px] font-medium tabular-nums text-emerald-700" style={{ left: c.x + 40, top: c.endY - 20, width: c.w - 52 }}>구매 확인 {countText(lastExit.n)}</div>
                    ) : null;
                  })()}
                  <div className="absolute flex items-center gap-1.5 px-3 text-[11px] text-slate-500" style={{ left: c.x, top: c.endY, width: c.w, height: L.endH }}>
                    {j.entryReplace ? <RotateCcw className="w-3 h-3 shrink-0 text-emerald-600" /> : <Flag className="w-3 h-3 shrink-0 text-slate-400" />}
                    <span className="truncate">{j.entryReplace ? '같은 상품을 다시 사면 처음부터' : j.endNote}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-slate-400">끝까지 {countText(j.counts.completed, '0')}</span>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* 초안 · 끝남 묶음 */}
        {layout.quiet.map((q) => (
          <button
            key={`quiet:${q.lane}`}
            type="button"
            onClick={() => toggleIn(setShowQuiet, q.lane)}
            className="absolute rounded-xl border border-dashed border-slate-300 bg-white px-3 text-left text-[12px] text-slate-500 hover:bg-slate-50"
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

        {/* 선 이름표 — 누르면 사유 · 숫자 · 고치기 */}
        {layout.lines.map((g) => {
          const tone = g.tier === 'solid' ? 'border-slate-300 bg-white text-slate-800' : g.tier === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-300 bg-white text-slate-500';
          return (
            <button
              key={`pill:${g.line.id}`}
              type="button"
              onClick={() => setOpenLineId((cur) => (cur === g.line.id ? null : g.line.id))}
              className={`absolute z-[2] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium shadow-sm transition ${tone} ${related(g.line) ? '' : 'opacity-30'}`}
              style={{ left: g.mx, top: g.my }}
            >
              {lineLabel(g.line)}
            </button>
          );
        })}

        {openLine && (() => {
          const ln = openLine.line;
          const from = byId.get(ln.fromJourneyId);
          const width = 288;
          const left = Math.max(8, Math.min(openLine.mx - width / 2, layout.width - width - 8));
          return (
            <div role="dialog" aria-label="선 설명" className="absolute z-[4] rounded-xl border border-slate-200 bg-white p-3 shadow-xl" style={{ left, top: openLine.my + 16, width }}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0 text-[12px] font-semibold text-slate-900">{from?.name || '여정'} → {ln.toLabel} 여정</div>
                <button type="button" onClick={() => setOpenLineId(null)} className="p-0.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100" aria-label="닫기"><X className="w-3.5 h-3.5" /></button>
              </div>
              <p className={`mt-1.5 text-[11px] leading-relaxed ${ln.tier === 'warn' ? 'text-amber-800' : 'text-slate-500'}`}>{ln.reason}</p>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                  <div className="text-[11px] text-slate-400">구매 확인</div>
                  <div className="text-[12px] font-semibold text-emerald-700 tabular-nums">{ln.goalMet.toLocaleString('ko-KR')}명</div>
                </div>
                <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                  <div className="text-[11px] text-slate-400">이어받음</div>
                  <div className="text-[12px] font-semibold text-slate-800 tabular-nums">{ln.handedOver == null ? '측정 전' : `${ln.handedOver.toLocaleString('ko-KR')}명`}</div>
                </div>
                <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                  <div className="text-[11px] text-slate-400">받는 쪽 전체</div>
                  <div className="text-[12px] font-semibold text-slate-800 tabular-nums">{ln.receiverEntered == null ? '없음' : `${ln.receiverEntered.toLocaleString('ko-KR')}명`}</div>
                </div>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                최근 {ln.windowDays}일 들어온 고객 기준이에요. {ln.handedOver == null
                  ? '이어받은 고객은 이번 업데이트 뒤 들어온 고객부터 셉니다.'
                  : '구매로 앞 여정을 마친 뒤 하루 안에 받는 여정이 자기 시작 사건으로 맞이한 수입니다.'}
              </p>
              {ln.fix && (
                <button type="button" onClick={() => { setOpenLineId(null); onFix(ln.fix!); }} className="mt-2 w-full h-8 rounded-lg text-[12px] font-semibold text-white bg-slate-900 hover:bg-slate-800 transition-colors">
                  {ln.fix.label}
                </button>
              )}
              <div className="mt-1.5 flex gap-1.5">
                <button type="button" onClick={() => { setOpenLineId(null); onFocusJourney(ln.fromJourneyId); }} className="flex-1 h-8 rounded-lg text-[12px] font-medium text-slate-700 border border-slate-200 hover:bg-slate-50">보내는 여정</button>
                {ln.toJourneyId && (
                  <button type="button" onClick={() => { setOpenLineId(null); onFocusJourney(ln.toJourneyId!); }} className="flex-1 h-8 rounded-lg text-[12px] font-medium text-slate-700 border border-slate-200 hover:bg-slate-50">받는 여정</button>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      <div className="px-6">
        <BottomBands data={data} statusFilter={statusFilter} search={search} focusId={focusId} outgoingOf={outgoingOf} overlapsOf={overlapsOf}
          onOpenStep={onOpenStep} onFocusJourney={onFocusJourney} onOpenJourney={onOpenJourney} onNewVersion={onNewVersion} />
      </div>
    </div>
  );
}

/** 범례 한 줄(상시 · 폭과 무관) — 그림을 읽는 법과 선의 뜻. */
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
      <span className="font-medium text-slate-700">아래로 기다림 · 오른쪽으로 구매</span>
      {(['solid', 'warn', 'empty'] as const).map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <svg width="24" height="6" aria-hidden><line x1="0" y1="3" x2="24" y2="3" stroke={LINE_STYLE[t].stroke} strokeWidth="2" strokeDasharray={LINE_STYLE[t].dash} /></svg>
          {LINE_STYLE[t].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <svg width="12" height="12" aria-hidden><path d="M 6 0 L 12 6 L 6 12 L 0 6 Z" fill={EXIT_STROKE} /></svg>
        구매 확인
      </span>
      <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-200 border border-rose-300" aria-hidden />같은 구매로 함께 시작</span>
      <span className="text-slate-400">구매한 고객은 다음 여정이 자기 시작 사건으로 맞이합니다</span>
    </div>
  );
}

interface BandsProps {
  data: LifecycleMapData;
  statusFilter: MapStatusFilter;
  search: string;
  focusId: string | null;
  outgoingOf: Map<string, MapLine[]>;
  overlapsOf: Map<string, Array<{ id: string; name: string; concurrentActive: number }>>;
  onOpenStep: (journey: MapJourney, step: MapStep) => void;
  onFocusJourney: (id: string) => void;
  onOpenJourney: (id: string) => void;
  onNewVersion: (journey: MapJourney) => void;
}

/** 아랫띠 — 언제든 생기는 순간 · 상시 · 정보 알림(선에 참여하지 않는다 · 카드 격자). */
function BottomBands({ data, statusFilter, search, focusId, outgoingOf, overlapsOf, onOpenStep, onFocusJourney, onOpenJourney, onNewVersion }: BandsProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const bands: Array<{ key: MapJourney['band']; label: string; hint: string }> = [
    { key: 'moment', label: '언제든 생기는 순간', hint: '장바구니 · 조회 후 미구매 · 배송 · 생일 · 등급 · 포인트' },
    { key: 'standing', label: '상시 · 날짜 예약', hint: '고른 고객에게 한 번 · 기준일에 맞춰' },
    { key: 'info', label: '정보 알림', hint: '광고가 아닌 알림톡 · 흐름에 넣지 않습니다' },
  ];
  return (
    <>
      {bands.map((b) => {
        const list = data.journeys.filter((j) => j.band === b.key && matchesFilter(j, statusFilter, search));
        if (list.length === 0) return null;
        return (
          <section key={b.key} className="mt-8">
            <div className="mb-2 flex items-baseline gap-2 border-b border-slate-200 pb-2">
              <span className="text-[13px] font-semibold text-slate-800">{b.label}</span>
              <span className="text-[11px] tabular-nums text-slate-400">{list.length}</span>
              <span className="hidden md:inline text-[11px] text-slate-400 truncate">{b.hint}</span>
            </div>
            <div className="grid gap-3 grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
              {list.map((j) => (
                <MapJourneyCard
                  key={j.id}
                  journey={j}
                  outgoing={outgoingOf.get(j.id) || []}
                  overlapsWith={overlapsOf.get(j.id) || []}
                  expanded={open.has(j.id) || focusId === j.id}
                  focused={focusId === j.id}
                  onToggle={() => toggleIn(setOpen, j.id)}
                  onOpenStep={(s) => onOpenStep(j, s)}
                  onFocusJourney={onFocusJourney}
                  onOpenJourney={onOpenJourney}
                  onNewVersion={onNewVersion}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
