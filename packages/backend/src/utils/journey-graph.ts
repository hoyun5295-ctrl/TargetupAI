/**
 * journey-graph.ts — 여정 칸 행 → 그림 재료(노드 · 간선 · 출구) (★ 2026-09-29 여정 V2 1차 · 순수 · DB/AI 0)
 *
 * 설계서 = docs/2026-09-29-journey-v2-master-design.md §4 "그래프".
 *
 * 왜 따로 있나
 *   흐름 그림이 실행기와 다른 말을 했다("조건 미충족 (skip)" vs 실제 종료 · 점프). 그림이 칸 배열을 보고 스스로
 *   해석하면 실행기와 또 갈라진다. 실행기가 도는 규칙을 여기 한 곳에 적고 생애 지도 · 흐름 그림 · 저장 검증이
 *   이것만 읽는다. 규칙의 원문 = journey-executor.ts(processExecution · jumpToStep · advanceOrComplete).
 *
 * 실행기 규칙(0929 코드 기준)
 *   - 다음 칸 = current_step_order + 1. 마지막 칸을 보낸 뒤 곧바로 completed(목표 검사 없음 · 출구 없음).
 *   - 목표 종료가 켜져 있으면 칸을 처리하기 **직전마다** 목표를 확인한다 → 출구는 "k번째 칸 뒤"(k = 0..n-1).
 *   - 조건 칸: 맞으면 다음 칸 · 아니면 not_met_goto(앞쪽 칸만) · 없으면 여정 끝(ended).
 *     점프하면 current_step_order = 대상 − 1 로 기록된다(journey-executor.ts jumpToStep).
 *   - 대기 칸: 시간만 대기 · 사건 대기(wait_event_name)면 사건이 오면 바로 · 최대 대기 뒤 다음 칸(둘 다 같은 다음 칸).
 *   - 모르는 칸 종류: 보내지 않고 그 실행을 끝낸다(0차 ⑩).
 *   - ★ 2026-09-30 V2 4차 끝 칸: 발송 0 · 도착하면 그 자리에서 completed. 나가는 간선이 없다 — 끝 칸 뒤 칸은 조건 칸의 "아니면"만 가리킬 수 있다.
 */

export type GraphNodeKind = 'message' | 'wait' | 'condition' | 'end' | 'unknown';

export interface GraphStepInput {
  id: string;
  step_order: number;
  step_type: string;
  delay_hours: number | null;
  delay_mode?: string | null;
  target_hour_kst?: number | null;
  channel?: string | null;
  is_ad?: boolean | null;
  not_met_goto?: number | null;
  wait_event_name?: string | null;
  wait_timeout_hours?: number | null;
  anchor_offset_days?: number | null;
}

export interface GraphNode {
  stepId: string;
  order: number;
  kind: GraphNodeKind;
  channel: string | null;
  isAd: boolean;
  /** 앞 칸 뒤 대기(시간). */
  delayHours: number;
  /** 사건 대기 칸인가(사건이 오면 바로 다음 칸). */
  waitsForEvent: boolean;
  /** 시작부터 이 칸까지 누적(시간) — 최소 · 최대(사건 대기 · 갈래가 끼면 범위). 날짜축 · 닿지 않는 칸은 null. */
  cumulativeMinHours: number | null;
  cumulativeMaxHours: number | null;
  /** 사람 말 시점 — "시작하면 바로" · "D+7" · "D+3~6" · 날짜축 "기준일 3일 전" · 끝 칸 "여기서 끝". */
  timingLabel: string;
  /** 칸 사이 간격 — "바로" · "3일 뒤" · "다음 평일 오전 9시" · "오전 10시". */
  intervalLabel: string;
  /** 시작에서 닿는가(끝 칸 뒤 칸은 어느 갈래가 가리켜야 닿는다). */
  reachable: boolean;
}

export type GraphEdgeKind = 'next' | 'met' | 'not_met' | 'not_met_end';

export interface GraphEdge {
  /** 0 = 시작. */
  from: number;
  /** -1 = 여정 끝. */
  to: number;
  kind: GraphEdgeKind;
}

export interface JourneyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** 목표 종료 출구가 생길 수 있는 자리 — "k번째 칸 뒤"의 k 목록(0 = 첫 칸 전). 목표 종료가 꺼져 있으면 빈 목록. */
  exitSlots: number[];
  /** 규칙 위반(그림이 거짓말하지 않도록 드러낸다) — 뒤쪽이 아닌 점프 · 없는 칸으로 점프 · 모르는 칸 종류 · 닿지 않는 칸. */
  issues: string[];
  /** ★ 2026-09-30 V2 4차 — 켜기를 막아야 하는 구조 결함(닿지 않는 칸 · 첫 칸이 끝 칸). 활성화 게이트가 읽는다. */
  blockingIssues: string[];
}

function kindOf(t: string): GraphNodeKind {
  return t === 'message' || t === 'wait' || t === 'condition' || t === 'end' ? t : 'unknown';
}

/** 칸 사이 간격 문구 — 시간 표기는 journey-labels(프론트)와 같은 규칙: 바로 · N시간 뒤 · N일 뒤 · N일 M시간 뒤. */
export function formatInterval(delayHours: number, delayMode?: string | null, targetHourKst?: number | null): string {
  const h = Math.max(0, Math.floor(Number(delayHours) || 0));
  if (delayMode === 'next_business_day') return '다음 평일 오전 9시';
  const base = h === 0 ? '바로' : h < 24 ? `${h}시간 뒤` : h % 24 === 0 ? `${h / 24}일 뒤` : `${Math.floor(h / 24)}일 ${h % 24}시간 뒤`;
  if ((delayMode === 'specific_hour' || delayMode === 'relative_at_hour') && targetHourKst != null) {
    const hh = Math.max(0, Math.min(23, Number(targetHourKst)));
    const clock = hh < 12 ? `오전 ${hh === 0 ? 12 : hh}시` : `오후 ${hh === 12 ? 12 : hh - 12}시`;
    return h === 0 ? clock : `${base} ${clock}`;
  }
  return base;
}

function dLabel(minH: number, maxH: number): string {
  const a = Math.floor(minH / 24);
  const b = Math.floor(maxH / 24);
  if (minH === 0 && maxH === 0) return '시작하면 바로';
  return a === b ? `D+${a}` : `D+${a}~${b}`;
}

export function buildJourneyGraph(
  steps: GraphStepInput[],
  opts: { goalExitEnabled: boolean; startKind?: string | null },
): JourneyGraph {
  const sorted = [...(steps || [])].sort((x, y) => Number(x.step_order) - Number(y.step_order));
  const orders = new Set(sorted.map((s) => Number(s.step_order)));
  const issues: string[] = [];
  const blockingIssues: string[] = [];
  const edges: GraphEdge[] = [];
  const isAnchor = opts.startKind === 'date_anchor';

  // ① 간선 — 실행기 규칙 그대로(다음 칸 · 조건 두 갈래 · 끝 칸은 나가는 간선 없음).
  sorted.forEach((s, i) => {
    const order = Number(s.step_order);
    const kind = kindOf(String(s.step_type || ''));
    if (kind === 'unknown') issues.push(`${order}번째 칸은 알 수 없는 종류라 발송되지 않습니다.`);
    const next = i + 1 < sorted.length ? Number(sorted[i + 1].step_order) : -1;
    if (i === 0) edges.push({ from: 0, to: order, kind: 'next' });
    if (kind === 'condition') {
      edges.push({ from: order, to: next, kind: 'met' });
      const g = s.not_met_goto == null ? null : Number(s.not_met_goto);
      if (g != null && Number.isFinite(g)) {
        if (g <= order) issues.push(`${order}번째 칸의 건너뛰기 대상은 뒤쪽 칸이어야 합니다.`);
        else if (!orders.has(g)) issues.push(`${order}번째 칸의 건너뛰기 대상(${g}번째)이 없습니다. 맞지 않는 고객은 여정을 끝냅니다.`);
        edges.push({ from: order, to: g > order && orders.has(g) ? g : -1, kind: g > order && orders.has(g) ? 'not_met' : 'not_met_end' });
      } else {
        edges.push({ from: order, to: -1, kind: 'not_met_end' });
      }
    } else if (kind !== 'unknown' && kind !== 'end') {
      edges.push({ from: order, to: next, kind: 'next' });
    }
  });
  if (sorted.length > 0 && kindOf(String(sorted[0].step_type || '')) === 'end') {
    blockingIssues.push('첫 칸이 끝 칸이라 아무것도 보내지 않고 끝납니다.');
  }

  // ② 누적 시점 — 앞에서 들어오는 간선마다 (앞 칸 누적 + 이 칸 대기)의 최소 · 최대(갈래가 합치면 범위).
  const byOrder = new Map(sorted.map((s) => [Number(s.step_order), s]));
  const cum = new Map<number, { min: number; max: number }>([[0, { min: 0, max: 0 }]]);
  for (const s of sorted) {
    const order = Number(s.step_order);
    const kind = kindOf(String(s.step_type || ''));
    const delay = kind === 'end' ? 0 : Math.max(0, Math.floor(Number(s.delay_hours) || 0));
    const waitsForEvent = kind === 'wait' && !!(s.wait_event_name && String(s.wait_event_name).trim());
    const addMin = waitsForEvent ? 0 : delay;
    const addMax = waitsForEvent ? Math.max(0, Math.floor(Number(s.wait_timeout_hours) || delay)) : delay;
    for (const e of edges.filter((x) => x.to === order)) {
      const from = cum.get(e.from);
      if (!from) continue;
      const cur = cum.get(order);
      const min = from.min + addMin;
      const max = from.max + addMax;
      cum.set(order, cur ? { min: Math.min(cur.min, min), max: Math.max(cur.max, max) } : { min, max });
    }
  }

  // ③ 노드
  const nodes: GraphNode[] = sorted.map((s) => {
    const order = Number(s.step_order);
    const kind = kindOf(String(s.step_type || ''));
    const delay = kind === 'end' ? 0 : Math.max(0, Math.floor(Number(s.delay_hours) || 0));
    const waitsForEvent = kind === 'wait' && !!(s.wait_event_name && String(s.wait_event_name).trim());
    const c = cum.get(order) || null;
    const reachable = !!c;
    let timingLabel: string;
    if (kind === 'end') timingLabel = '여기서 끝';
    else if (isAnchor) {
      const off = Number(s.anchor_offset_days);
      timingLabel = Number.isFinite(off) ? (off === 0 ? '기준일 당일' : `기준일 ${off}일 전`) : '기준일 기준';
    } else timingLabel = c ? dLabel(c.min, c.max) : '닿지 않음';
    return {
      stepId: s.id,
      order,
      kind,
      channel: s.channel ?? null,
      isAd: s.is_ad !== false,
      delayHours: delay,
      waitsForEvent,
      cumulativeMinHours: isAnchor || !c ? null : c.min,
      cumulativeMaxHours: isAnchor || !c ? null : c.max,
      timingLabel,
      intervalLabel: kind === 'end' ? '바로' : waitsForEvent ? '사건이 오면 바로 · 늦어도 정한 시간 뒤' : formatInterval(delay, s.delay_mode, s.target_hour_kst),
      reachable,
    };
  });
  for (const n of nodes) {
    if (!n.reachable) {
      const msg = `${n.order}번째 칸은 어느 갈래에서도 닿지 않아요. 앞 조건 칸의 "아니면" 이동 칸으로 이어 주세요.`;
      issues.push(msg);
      blockingIssues.push(msg);
    }
  }

  // ④ 목표 출구: 칸을 처리하기 직전마다 확인 → k번째 칸 뒤(k = 0..). 마지막 칸 뒤 · 끝 칸 앞뒤에는 없다(곧바로 완료).
  const exitSlots: number[] = [];
  if (opts.goalExitEnabled && sorted.length > 0) {
    if (kindOf(String(sorted[0].step_type || '')) !== 'end') exitSlots.push(0);
    sorted.forEach((s, i) => {
      const next = sorted[i + 1];
      if (!next) return;
      if (kindOf(String(s.step_type || '')) === 'end') return;
      if (kindOf(String(next.step_type || '')) === 'end') return;
      exitSlots.push(Number(s.step_order));
    });
  }
  void byOrder;

  return { nodes, edges, exitSlots, issues, blockingIssues };
}

/**
 * goal_met 행의 current_step_order 해석 — "k번째 칸 뒤에 나감"(k = 마지막으로 처리한 칸).
 * 점프하면 대상 − 1 이 기록되므로 k 는 칸 번호 위치로만 읽는다(어느 갈래였는지는 모른다 · 설계서 §3).
 * 0 = 첫 칸 전. 칸 수 이상이면(칸 삭제 뒤 옛 기록) 마지막 칸 뒤로 붙인다.
 */
export function exitSlotOf(currentStepOrder: number, graph: JourneyGraph): number {
  const k = Math.max(0, Math.floor(Number(currentStepOrder) || 0));
  if (graph.exitSlots.length === 0) return k;
  const last = graph.exitSlots[graph.exitSlots.length - 1];
  return Math.min(k, last);
}
