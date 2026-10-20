/**
 * journey-map-layout.ts — 고객 관계 지도 배치(순수 함수 · DOM 측정 0) ★ 2026-10-09
 *
 * 설계서 = docs/2026-10-09-journey-crm-map-design.md §2.
 *   축: 단계 열 왼→오 · 여정 칸 위→아래 척추. "아래로 = 기다림 · 오른쪽으로 = 샀다".
 *   열 = 가입 · 첫 구매 · 재구매 · 이탈·복귀 · 상품 여정 = 열 아래 가로 띠.
 *
 * ⛔ 의미(선 상태 · 출구 자리 · 숫자)는 서버 응답 그대로다. 여기는 **좌표만** 정한다.
 *    칸 배열을 보고 갈래를 다시 추론하지 않는다 · 좌표는 저장하지 않는다.
 * ⛔ 다른 열끼리의 높이는 시간을 뜻하지 않는다(문을 출구 높이에 맞추지 않는다) — 열마다 고정 계단 오프셋만.
 * 백엔드 vitest(journey-map-layout-invariants)가 이 파일을 불러 "끝점 누락 0 · 노드 겹침 0"을 단언한다.
 * ★ 2026-10-20 여정 V.3 §10-2 — 기본 [한눈에](요약 카드 · 높이는 데이터로 정한다 · 카드가 같은 상수로 그린다) · [칸까지] = 옛 척추 그대로.
 *   계단 0 · 열 간격 72(1440 가로 스크롤 0) · 상품 띠로 가는 선은 띠 머리 한 점으로 묶는다(이름표 없음 · 상품 카드가 이어받음을 말한다).
 */
import type { JourneyLane, LifecycleMapData, MapJourney, MapLine, LineTier } from './journey-map';

export const FLOW_COLUMNS: Array<{ key: JourneyLane; label: string }> = [
  { key: 'signup', label: '가입' },
  { key: 'first_purchase', label: '첫 구매' },
  { key: 'repurchase', label: '재구매' },
  { key: 'winback', label: '이탈 · 복귀' },
];
export const PRODUCT_LANE: JourneyLane = 'product';

export const L = {
  padX: 24,
  colW: 264,
  gap: 72,
  headH: 40,
  top: 16,
  stair: 0,
  doorH: 58,
  quietH: 40,
  intH: 26,
  msgH: 58,
  msgHPreview: 74,
  condH: 50,
  waitH: 34,
  endH: 34,
  cardGap: 28,
  ghostH: 150,
  railOff: 14,
  bandGap: 56,
  bandHeadH: 30,
} as const;

export type MapStatusFilter = 'all' | 'active' | 'paused' | 'draft';

export interface LayoutOpts {
  statusFilter: MapStatusFilter;
  search: string;
  /** 사용자가 펼친 여정(기본 펼침 대상이 아니어도 척추를 그린다). */
  expanded: ReadonlySet<string>;
  /** 사용자가 접은 여정(기본 펼침 대상이어도 문만 그린다). */
  collapsed: ReadonlySet<string>;
  /** 초안 · 끝남 묶음을 펼친 레인. */
  showQuiet: ReadonlySet<string>;
  /** 미리보기 1줄(넓은 화면). */
  preview: boolean;
  /** ★ V.3 — 한눈에(요약 카드) · 거짓 = 칸까지(척추). */
  glance?: boolean;
}

/**
 * ★ V.3 §10-2 — 요약 카드 행 높이(px). MapJourneyCard 가 같은 상수로 그린다(배치는 DOM 을 재지 않는다 · 두 벌 금지).
 *   머리 · 한 문장 · 칸 띠 · 숫자 3칸 · (있을 때만) 손볼 곳 · 멈춘 이유 한 줄 · 겹침 줄(최대 2) · 바닥 버튼.
 */
export const S = { pad: 12, head: 20, gap: 8, line: 18, strip: 40, nums: 44, note: 20, overlap: 24, actions: 32 } as const;
export const SUMMARY_OVERLAP_MAX = 2;

/** 요약 카드에 줄로 나오는 손볼 곳 · 멈춘 이유(서버 health · pause) — 카드와 배치가 같은 판정을 쓴다. */
export function summaryNote(j: MapJourney): { tone: 'fix' | 'quiet' | 'paused'; text: string } | null {
  if (j.pause) return { tone: 'paused', text: j.pause.text };
  // 겹침 해소(첫 구매 빼기 · 돌아온 고객은 환영만)가 손볼 곳이면 겹침 줄이 같은 사실과 [한 통만 보내기]를 이미 보여 준다.
  if (j.health && (j.health.tone === 'fix' || j.health.tone === 'blocked') && !String(j.health.fix?.action || '').startsWith('exclude_')) return { tone: 'fix', text: j.health.text };
  if (j.health && j.health.tone === 'quiet') return { tone: 'quiet', text: j.health.text };
  return null;
}

export function summaryCardHeight(j: MapJourney, overlapCount: number): number {
  const rows: number[] = [S.head, S.line, S.strip, S.nums];
  if (summaryNote(j)) rows.push(S.note);
  for (let i = 0; i < Math.min(overlapCount, SUMMARY_OVERLAP_MAX); i++) rows.push(S.overlap);
  rows.push(S.actions);
  return S.pad * 2 + rows.reduce((a, b) => a + b, 0) + S.gap * (rows.length - 1);
}

export interface Box { x: number; y: number; w: number; h: number }
export interface StepBox extends Box { stepId: string; order: number; intervalY: number | null }
export interface ExitTick { slot: number; y: number; n: number }

export interface CardLayout extends Box {
  journeyId: string;
  open: boolean;
  door: Box;
  steps: StepBox[];
  endY: number | null;
  exits: ExitTick[];
  /** 출구 레일(카드 오른쪽 세로선) · ◆ 위치. 출구 자리가 없으면 null. */
  rail: { x: number; y1: number; y2: number } | null;
  diamond: { x: number; y: number } | null;
  /** 나가는 선의 출발점(◆ · 출구 없음이면 카드 오른쪽). */
  origin: { x: number; y: number };
  /** 받는 선의 도착점(문 왼쪽 가운데 · 상품 띠는 문 위 가운데). */
  inlet: { x: number; y: number; fromTop: boolean };
}

export interface GhostLayout extends Box { triggerEvent: string; lane: JourneyLane; inlet: { x: number; y: number; fromTop: boolean } }
export interface QuietLayout extends Box { lane: string; ids: string[]; label: string }
export interface LineLayout {
  line: MapLine; d: string; mx: number; my: number; tier: LineTier;
  /** ★ V.3 — 상품 띠 머리 한 점으로 묶인 선(이름표를 그리지 않는다 · 같은 보내는 여정의 선은 한 줄로 겹친다). */
  bundled?: boolean;
}

export interface MapLayout {
  width: number;
  height: number;
  columns: Array<{ key: JourneyLane; label: string; x: number; count: number }>;
  cards: CardLayout[];
  ghosts: GhostLayout[];
  quiet: QuietLayout[];
  band: { y: number; x: number; w: number; count: number } | null;
  lines: LineLayout[];
}

/** 걸러보기(상태 · 찾기) — 지도와 모바일 목록이 같이 쓴다. */
export function matchesFilter(j: MapJourney, statusFilter: MapStatusFilter, search: string): boolean {
  if (statusFilter !== 'all' && j.status !== statusFilter) return false;
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return j.name.toLowerCase().includes(q) || j.triggerLabel.toLowerCase().includes(q);
}

const isQuiet = (j: MapJourney, statusFilter: MapStatusFilter) =>
  (statusFilter === 'draft' ? ['ended'] : ['draft', 'ended']).includes(j.status);

/** 칸 높이(종류별 고정). */
export function stepHeight(kind: string, preview: boolean): number {
  if (kind === 'message') return preview ? L.msgHPreview : L.msgH;
  if (kind === 'condition') return L.condH;
  if (kind === 'wait') return L.waitH;
  return L.waitH;
}

/** 요약 카드 한 장(한눈에) — 칸 상자 · 출구 레일 없음 · 선은 카드 머리 높이에서 나가고 들어온다. */
export function layoutSummaryCard(j: MapJourney, x: number, y: number, w: number, overlapCount: number): CardLayout {
  const h = summaryCardHeight(j, overlapCount);
  const midY = y + S.pad + S.head / 2;
  return {
    journeyId: j.id, open: false, x, y, w, h, door: { x, y, w, h }, steps: [], endY: null, exits: [], rail: null, diamond: null,
    origin: { x: x + w, y: midY }, inlet: { x, y: midY, fromTop: false },
  };
}

/** 여정 카드 한 장 배치(열린 척추 또는 문만). */
export function layoutCard(j: MapJourney, x: number, y: number, w: number, open: boolean, preview: boolean): CardLayout {
  const door: Box = { x, y, w, h: L.doorH };
  if (!open) {
    const h = L.quietH + 18;
    return {
      journeyId: j.id, open: false, x, y, w, h, door: { x, y, w, h }, steps: [], endY: null, exits: [], rail: null, diamond: null,
      origin: { x: x + w, y: y + h / 2 }, inlet: { x, y: y + h / 2, fromTop: false },
    };
  }
  const steps: StepBox[] = [];
  let cy = y + L.doorH;
  const gapCenters = new Map<number, number>(); // 출구 자리 k → 그 틈의 가운데 y(k = 0 · 문과 첫 칸 사이)
  j.steps.forEach((s, i) => {
    const gapTop = cy;
    cy += L.intH;
    gapCenters.set(i, gapTop + L.intH / 2);
    const h = stepHeight(s.kind, preview);
    steps.push({ stepId: s.stepId, order: s.order, x: x + 10, y: cy, w: w - 20, h, intervalY: gapTop + L.intH / 2 });
    cy += h;
  });
  // 마지막 칸 뒤 틈(끝 줄 앞)
  gapCenters.set(j.steps.length, cy + 10);
  const endY = cy + 12;
  const h = endY + L.endH - y;
  const exits: ExitTick[] = [];
  if (j.goalExitEnabled) {
    for (const slot of j.graph.exitSlots) {
      const n = slot === 0 ? (j.exitsBeforeFirst ?? 0) : (j.steps.find((s) => s.order === slot)?.exitsAfter ?? 0);
      const gy = gapCenters.get(slot);
      if (gy != null) exits.push({ slot, y: gy, n });
    }
  }
  const railX = x + w + L.railOff;
  const rail = exits.length > 0 ? { x: railX, y1: Math.min(...exits.map((e) => e.y)), y2: Math.max(...exits.map((e) => e.y)) + 18 } : null;
  const diamond = rail ? { x: railX, y: rail.y2 } : null;
  return {
    journeyId: j.id, open: true, x, y, w, h, door, steps, endY, exits, rail, diamond,
    origin: diamond ?? { x: x + w, y: endY + L.endH / 2 },
    inlet: { x, y: y + L.doorH / 2, fromTop: false },
  };
}

function bezier(a: { x: number; y: number }, b: { x: number; y: number; fromTop: boolean }, sameColumnRight: boolean): { d: string; mx: number; my: number } {
  let p1: [number, number];
  let p2: [number, number];
  if (b.fromTop) {
    const dy = Math.max(40, (b.y - a.y) / 2);
    p1 = [a.x, a.y + dy];
    p2 = [b.x, b.y - dy];
  } else if (sameColumnRight) {
    const out = 44;
    p1 = [a.x + out, a.y];
    p2 = [b.x + out, b.y];
  } else {
    const dx = Math.max(36, (b.x - a.x) / 2);
    p1 = [a.x + dx, a.y];
    p2 = [b.x - dx, b.y];
  }
  const mx = (a.x + 3 * p1[0] + 3 * p2[0] + b.x) / 8;
  const my = (a.y + 3 * p1[1] + 3 * p2[1] + b.y) / 8;
  return { d: `M ${a.x} ${a.y} C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${b.x} ${b.y}`, mx, my };
}

export function layoutMap(data: LifecycleMapData, opts: LayoutOpts): MapLayout {
  const colX = (i: number) => L.padX + i * (L.colW + L.gap);
  const width = colX(FLOW_COLUMNS.length - 1) + L.colW + L.padX + L.railOff;
  const cards: CardLayout[] = [];
  const ghosts: GhostLayout[] = [];
  const quiet: QuietLayout[] = [];
  const visible = data.journeys.filter((j) => matchesFilter(j, opts.statusFilter, opts.search));
  const flow = visible.filter((j) => j.band === 'flow');
  const cardW = L.colW;
  const overlapCount = new Map<string, number>();
  for (const o of data.overlaps || []) for (const id of [o.a, o.b]) overlapCount.set(id, (overlapCount.get(id) || 0) + 1);
  const place = (j: MapJourney, x: number, y: number, open: boolean) => (opts.glance
    ? layoutSummaryCard(j, x, y, cardW, overlapCount.get(j.id) || 0)
    : layoutCard(j, x, y, cardW, open, opts.preview));

  const placeLane = (laneKey: JourneyLane, list: MapJourney[], x: number, startY: number): number => {
    let y = startY;
    const live = list.filter((j) => !isQuiet(j, opts.statusFilter));
    const sleepy = list.filter((j) => isQuiet(j, opts.statusFilter));
    let spines = 0;
    for (const j of live) {
      const byDefault = (j.status === 'active' || j.status === 'paused') && spines < 2;
      const open = !opts.collapsed.has(j.id) && (byDefault || opts.expanded.has(j.id));
      if (open && byDefault) spines += 1;
      const c = place(j, x, y, open);
      cards.push(c);
      y += c.h + L.cardGap;
    }
    if (sleepy.length > 0) {
      if (opts.showQuiet.has(laneKey)) {
        for (const j of sleepy) {
          const c = place(j, x, y, opts.expanded.has(j.id));
          cards.push(c);
          y += c.h + L.cardGap;
        }
      } else {
        const drafts = sleepy.filter((j) => j.status === 'draft').length;
        const ended = sleepy.length - drafts;
        const label = [drafts > 0 ? `초안 ${drafts}` : '', ended > 0 ? `끝남 ${ended}` : ''].filter(Boolean).join(' · ');
        quiet.push({ lane: laneKey, ids: sleepy.map((j) => j.id), label, x, y, w: cardW, h: L.quietH });
        y += L.quietH + L.cardGap;
      }
    }
    for (const g of data.ghosts.filter((gh) => gh.lane === laneKey)) {
      ghosts.push({ triggerEvent: g.triggerEvent, lane: laneKey, x, y, w: cardW, h: L.ghostH, inlet: { x, y: y + 28, fromTop: false } });
      y += L.ghostH + L.cardGap;
    }
    return y;
  };

  const columns = FLOW_COLUMNS.map((c, i) => {
    const list = flow.filter((j) => j.lane === c.key);
    return { key: c.key, label: c.label, x: colX(i), count: list.length, list };
  });
  let bottom = L.headH + L.top;
  columns.forEach((c, i) => {
    const end = placeLane(c.key, c.list, c.x, L.headH + L.top + i * L.stair);
    bottom = Math.max(bottom, end);
  });

  // 상품 띠 — 첫 구매 열부터 오른쪽으로 카드를 가로로 놓는다(넘치면 다음 줄).
  const products = flow.filter((j) => j.lane === PRODUCT_LANE);
  const productGhosts = data.ghosts.filter((g) => g.lane === PRODUCT_LANE);
  let band: MapLayout['band'] = null;
  if (products.length > 0 || productGhosts.length > 0) {
    const bandX = colX(1);
    const bandW = width - L.padX - bandX;
    const bandY = bottom + L.bandGap;
    band = { y: bandY, x: bandX, w: bandW, count: products.length };
    const perRow = Math.max(1, Math.floor((bandW + L.cardGap) / (cardW + L.cardGap)));
    const rowTop = bandY + L.bandHeadH;
    let rowY = rowTop;
    let rowH = 0;
    let col = 0;
    const placeInBand = (h: number): { x: number; y: number } => {
      if (col >= perRow) { rowY += rowH + L.cardGap; rowH = 0; col = 0; }
      const pos = { x: bandX + col * (cardW + L.cardGap), y: rowY };
      col += 1;
      rowH = Math.max(rowH, h);
      return pos;
    };
    let spines = 0;
    for (const j of products) {
      const byDefault = (j.status === 'active' || j.status === 'paused') && spines < 3;
      const open = !opts.collapsed.has(j.id) && !isQuiet(j, opts.statusFilter) && (byDefault || opts.expanded.has(j.id));
      if (open && byDefault) spines += 1;
      const probe = place(j, 0, 0, open);
      const pos = placeInBand(probe.h);
      const c = place(j, pos.x, pos.y, open);
      c.inlet = { x: pos.x + cardW / 2, y: pos.y, fromTop: true };
      cards.push(c);
    }
    for (const g of productGhosts) {
      const pos = placeInBand(L.ghostH);
      ghosts.push({ triggerEvent: g.triggerEvent, lane: PRODUCT_LANE, x: pos.x, y: pos.y, w: cardW, h: L.ghostH, inlet: { x: pos.x + cardW / 2, y: pos.y, fromTop: true } });
    }
    bottom = rowY + rowH;
  }

  // 선 — 서버 선만. 같은 보내는 여정의 선은 ◆ 하나에서 갈라진다(포크).
  const cardOf = new Map(cards.map((c) => [c.journeyId, c]));
  const quietOf = new Map<string, QuietLayout>();
  for (const q of quiet) for (const id of q.ids) quietOf.set(id, q);
  const ghostOf = new Map(ghosts.map((g) => [g.triggerEvent, g]));
  const lines: LineLayout[] = [];
  for (const ln of data.lines) {
    const from = cardOf.get(ln.fromJourneyId);
    if (!from) continue;
    let inlet: { x: number; y: number; fromTop: boolean } | null = null;
    let toX: number | null = null;
    if (ln.toJourneyId) {
      const to = cardOf.get(ln.toJourneyId);
      const qz = quietOf.get(ln.toJourneyId);
      if (to) { inlet = to.inlet; toX = to.x; } else if (qz) { inlet = { x: qz.x, y: qz.y + qz.h / 2, fromTop: false }; toX = qz.x; }
    } else {
      const g = ghostOf.get(ln.toTrigger);
      if (g) { inlet = g.inlet; toX = g.x; }
    }
    if (!inlet || toX == null) continue;
    // ★ V.3 §10-2 — 상품 띠로 가는 선은 띠 머리 한 점으로(부채꼴 · 내려꽂는 곡선 0). 이어받음 숫자는 상품 카드가 말한다.
    const bundled = inlet.fromTop && band != null;
    const sameColumn = !inlet.fromTop && Math.abs(toX - from.x) < 1;
    const target = bundled ? { x: band!.x + 28, y: band!.y + 2, fromTop: true } : sameColumn ? { x: toX + cardW, y: inlet.y, fromTop: false } : inlet;
    const geo = bezier(from.origin, target, sameColumn);
    lines.push({ line: ln, d: geo.d, mx: geo.mx, my: geo.my, tier: ln.tier, ...(bundled ? { bundled: true } : {}) });
  }

  return {
    width,
    height: bottom + 24,
    columns: columns.map(({ key, label, x, count }) => ({ key, label, x, count })),
    cards,
    ghosts,
    quiet,
    band,
    lines,
  };
}
