/**
 * journey-lifecycle-map.ts — 생애 지도 단일 조회 (★ 2026-09-29 여정 V2 1차 · 읽기 전용 · 운영 영향 0)
 *
 * 설계서 = docs/2026-09-29-journey-v2-master-design.md §3 · §4 · §13-1.
 *
 * 화면은 이 응답을 **그리기만** 한다. 레인 · 선 상태 · 칸 출구 · 겹침 · 잠금의 의미를 화면이 다시 계산하지 않는다
 * (그림이 실행기와 다른 말을 하던 병의 뿌리 = 화면이 따로 해석한 것).
 *
 * 원칙
 *   - 선은 계약 간선(nextEvents)에서만 · 좌표 · 선 저장 0 · 진입로 0(다른 여정으로 태우지 않는다 · FEATURE §2).
 *   - 숫자는 원장에서 바로 센다. 인과를 주장하지 않는다. 표본이 없으면 null(화면이 "아직 없음 · 켠 날부터 셉니다").
 *   - 정보 알림(메시지 칸이 전부 알림톡 · 광고 아님)은 레인 · 선 · 겹침 계산에서 뺀다(회의론자 최종 검증 7).
 *   - 회사 격리: 모든 실행 행 조회는 그 회사 여정 id 목록으로 묶는다(journey_executions 에는 company_id 가 없다).
 */

import { query } from '../config/database';
import {
  TRIGGER_CONTRACTS, getTriggerContract, laneForTrigger, triggerLabel, triggerKeyForEvent, overlapTriggerEvents,
  resolveTriggerAvailability, toAvailabilityMap, isProductPickTrigger, type JourneyLane,
} from './journey-trigger-capability';

/** ★ 2026-09-30 V2 3차 — 만드는 길: 1클릭 프리셋 / 상품 고르기 창(상품을 골라야 하는 트리거). 서버가 정한다. */
export type CreateMode = 'preset' | 'product';
const createModeOf = (triggerEvent: string): CreateMode => (isProductPickTrigger(triggerEvent) ? 'product' : 'preset');
import { getCompanyJourneyFacts } from './company-data-profile';
import { buildJourneyGraph, exitSlotOf, type JourneyGraph } from './journey-graph';
import { describeJourneyTarget } from './journey-step-format';
import { getCreditCost } from './ai-credit-calc';
// ★ 2026-09-30 V2 5차 — 새 판 · 계보(옛 판은 현재 판 카드 안에 접는다 · DDL 전이면 계보 없음)
import { lineageColumnsReady } from './journey-lineage';

/** 지도 레인(윗띠 생애 흐름 → 아랫띠 순간 → 상시 레일). 계약에 트리거가 있는 레인만 나간다(없는 레인을 지어내지 않는다). */
const LANE_META: Array<{ key: JourneyLane; label: string; band: 'flow' | 'moment' | 'standing' }> = [
  { key: 'signup', label: '가입', band: 'flow' },
  { key: 'first_purchase', label: '첫 구매', band: 'flow' },
  { key: 'repurchase', label: '재구매', band: 'flow' },
  { key: 'product', label: '상품 재구매', band: 'flow' },
  { key: 'winback', label: '이탈·복귀', band: 'flow' },
  { key: 'moment', label: '언제든 생기는 순간', band: 'moment' },
  { key: 'standing', label: '상시 · 날짜 예약', band: 'standing' },
];

export type LineState = 'connected' | 'leak' | 'no_receiver' | 'receiver_draft' | 'receiver_off' | 'receiver_locked' | 'reentry_off';
export type LineTier = 'solid' | 'warn' | 'empty';

const LINE_TIER: Record<LineState, LineTier> = {
  connected: 'solid', leak: 'warn', receiver_draft: 'warn', receiver_off: 'warn', reentry_off: 'warn',
  no_receiver: 'empty', receiver_locked: 'empty',
};
const LINE_REASON: Record<LineState, string> = {
  connected: '목표를 이루면 이 여정을 마치고 다음 여정이 새로 맞이합니다.',
  leak: '목표를 이뤄도 남은 문자가 계속 나가요. "목표 달성 시 자동 종료"를 켜면 이어집니다.',
  no_receiver: '받는 여정이 아직 없어요.',
  receiver_draft: '받는 여정이 초안이라 아직 못 받아요.',
  receiver_off: '받는 여정이 멈춰 있거나 끝나서 못 받아요.',
  receiver_locked: '받는 여정을 만들려면 데이터 연동이 필요해요.',
  reentry_off: '받는 여정이 다시 들어오기를 막고 있어 두 번째부터 못 받아요.',
};

export interface MapStep {
  stepId: string;
  order: number;
  kind: string;
  channel: string | null;
  isAd: boolean;
  timingLabel: string;
  intervalLabel: string;
  /** 문안 앞부분(최대 60자) — 칸 얼굴 · 서랍 미리보기. */
  preview: string;
  /** 지금 이 칸 다음 차례를 기다리는 사람(= current_step_order 가 이 칸 앞). */
  waitingHere: number;
  /** 최근 30일 이 칸 뒤에서 목표를 이뤄 나간 사람. 목표 종료 꺼짐 = null. */
  exitsAfter: number | null;
}

export interface MapJourney {
  id: string;
  name: string;
  status: string;
  lane: JourneyLane | null;
  band: 'flow' | 'moment' | 'standing' | 'info';
  triggerEvent: string;
  triggerLabel: string;
  startKind: string;
  goalExitEnabled: boolean;
  goalKind: string;
  /** 목표 숫자 이름(구매 확인 · 포인트 줄어듦 등) — 목표 종류에서 서버가 정한다. 포인트는 소멸도 줄어듦에 들어간다(설계서 §13-1). */
  goalLabel: string;
  /** 카드 안내(사실 문장) — 화면이 트리거를 보고 지어내지 않게 서버가 준다. */
  notices: string[];
  allowReentry: boolean;
  autoReentry: boolean;
  /** 한 번에 보낼 최대 인원(켜기 필수 · 모두 켜기 창이 미리 채운다). null = 아직 안 정함. */
  thresholdRecipients: number | null;
  targetSummary: string;
  /** 상시 여정인데 대상 조건이 없다 = 전 고객(0차 ① 사례를 지도에서 드러낸다). */
  broadAudience: boolean;
  counts: { activeNow: number; entered30d: number; goalMet30d: number; completed30d: number };
  /** 이미 목표를 이뤄 다음 칸 직전에 빠질 예정(조회 때 계산 · 쓰기 없음). 계산 안 함 = null. */
  pendingGoalExit: number | null;
  /** 최근 30일 첫 문자 전에 목표를 이뤄 나간 사람(출구 0). 목표 종료 꺼짐 = null. */
  exitsBeforeFirst: number | null;
  steps: MapStep[];
  graph: Pick<JourneyGraph, 'edges' | 'exitSlots' | 'issues'>;
  lock: { level: 'full' | 'append_only' | 'copy_only' | 'none'; reason: string };
  capability: { available: boolean; reason: string } | null;
  updatedAt: string | null;
  /** ★ 0930 V2 5차 — 계보(새 판 · 옛 판 묶음). 없으면 null. */
  lineageId: string | null;
  /** 새 판을 만들 수 있는가(켜짐 · 멈춤 · 진입 열림 · DDL 뒤). */
  canNewVersion: boolean;
  /** 이 카드에 접힌 옛 판(진입 닫힘 · 진행 중 고객 마무리 중). */
  olderVersions: Array<{ id: string; name: string; status: string; activeNow: number }>;
}

export interface MapLine {
  id: string;
  fromJourneyId: string;
  toJourneyId: string | null;
  fromTrigger: string;
  toTrigger: string;
  toLabel: string;
  state: LineState;
  tier: LineTier;
  reason: string;
  /** 최근 30일 A 에서 목표를 이룬 사람. */
  goalMet: number;
  /** 그중 B 가 이어받은 사람(같은 구매로 동시에 들어온 경우 · 재진입 워커 진입 제외). 표식 이전 = null("측정 전"). */
  handedOver: number | null;
  handedOver7d: number | null;
  /** 1클릭 고치기(서버가 정한다 · 화면이 선 상태를 보고 행동을 지어내지 않게). 없으면 null. */
  fix: AttachFix | null;
}

export type AttachFixAction = 'goal_exit_on' | 'allow_reentry_on' | 'pause_and_allow_reentry' | 'activate' | 'create';
export interface AttachFix { action: AttachFixAction; label: string; journeyId?: string; triggerEvent?: string; activeCount?: number; createMode?: CreateMode }

export interface MapGhost {
  lane: JourneyLane;
  triggerEvent: string;
  label: string;
  available: boolean;
  reason: string;
  createMode: CreateMode;
}

export interface MapOverlap {
  a: string;
  b: string;
  /** 지금 두 여정을 동시에 진행 중인 사람(목표를 이미 이뤘는데 다음 칸 전이라 남아 있는 사람 포함 · "약"). */
  concurrentActive: number;
}

export interface LifecycleMap {
  generatedAt: string;
  judgedAt: string | null;
  lanes: Array<{ key: JourneyLane; label: string; band: 'flow' | 'moment' | 'standing' }>;
  journeys: MapJourney[];
  lines: MapLine[];
  ghosts: MapGhost[];
  overlaps: MapOverlap[];
  /** 이 회사 데이터로 아직 만들 수 없는 시작 사건(사유 = 무엇을 연동하면 열리는지). 빈 곳 찾기의 "데이터가 있어야 열리는 여정". */
  lockedTriggers: Array<{ triggerEvent: string; label: string; reason: string }>;
  /** 크레딧 단가(단가표 = ai-credit-calc 한 곳) — 화면이 금액을 따로 적지 않게 싣는다. 초안 만들기 = AI 생성 1회 · 켜기 = 최초 활성화 1회. */
  costs: { generate: number; activate: number };
}

/**
 * 정보 알림 판정 — 메시지 칸이 하나 이상이고 전부 알림톡 + 광고 아님.
 * SQL 판정(기회 엔진 등)과 같은 규칙: MARKETING_JOURNEY_SQL 은 그 여집합(광고 문자 칸이 하나라도 있다).
 */
export function isInfoAlertJourney(steps: Array<{ step_type: string; channel?: string | null; is_ad?: boolean | null }>): boolean {
  const msgs = steps.filter((s) => s.step_type === 'message');
  return msgs.length > 0 && msgs.every((s) => s.channel === 'kakao' && s.is_ad === false);
}

/** SQL 조각(별칭 j) — 마케팅 여정(정보 알림이 아닌 여정). isInfoAlertJourney 의 여집합과 같은 규칙. */
export const MARKETING_JOURNEY_SQL = `EXISTS (SELECT 1 FROM journey_steps ms WHERE ms.journey_id = j.id AND ms.step_type = 'message' AND (ms.channel IS DISTINCT FROM 'kakao' OR ms.is_ad IS DISTINCT FROM false))`;

const GOAL_LABEL: Record<string, string> = { purchase: '구매 확인', points_used: '포인트 줄어듦', click: '링크 클릭', visit: '방문 확인' };

function journeyNotices(triggerEvent: string, goalExitEnabled: boolean): string[] {
  const out: string[] = [];
  // 목표 판정이 첫 칸 앞에서도 돈다 → 가입 직후 산 고객은 환영 문자 없이 빠지고 첫 구매 여정이 맞이한다(설계서 §13-1).
  if (triggerEvent === 'customer.created' && goalExitEnabled) out.push('가입 직후 구매한 고객은 환영 문자 대신 첫 구매 여정이 맞이해요.');
  return out;
}

function lockOf(status: string): MapJourney['lock'] {
  if (status === 'draft') return { level: 'full', reason: '초안이라 자유롭게 고칠 수 있어요.' };
  if (status === 'paused') return { level: 'append_only', reason: '멈춘 여정은 끝에 칸을 붙이거나 아직 안 보낸 칸만 지울 수 있어요.' };
  if (status === 'active') return { level: 'copy_only', reason: '켜진 여정은 문안만 고칠 수 있어요. 구조를 바꾸려면 새 판으로 고쳐야 해요.' };
  return { level: 'none', reason: '끝난 여정은 고칠 수 없어요.' };
}

const RECEIVER_RANK: Record<string, number> = { active: 0, paused: 1, draft: 2, ended: 3 };

// 읽기 판정(목표 이미 이룸) 캐시 — 회사당 5분. 여러 프로세스라도 5분 안에서만 어긋난다(쓰기 없음).
const PENDING_TTL_MS = 5 * 60 * 1000;
const PENDING_MAX_ACTIVE = 20000;
const pendingCache = new Map<string, { at: number; value: Map<string, number> }>();

/**
 * 목표 이미 이룸(구매 목표) — 실행기 isGoalConvertedSinceEntry 의 구매 분기와 같은 세 신호를 집합 SQL 로 센다.
 *   ①프로필 최근 구매일 > 진입일(KST) ②자사몰 구매 사건 > 진입 시각 ③매장 원장 구매 > 진입 시각(KST naive).
 *   ⛔ 쓰기 없음 — 상태를 바꾸면 재진입 쿨다운 기준(completed_at)이 앞당겨져 기존 여정 동작이 바뀐다(설계서 §12).
 */
async function loadPendingGoalExits(companyId: string, journeyIds: string[]): Promise<{ value: Map<string, number>; at: number } | null> {
  if (journeyIds.length === 0) return { value: new Map(), at: Date.now() };
  const hit = pendingCache.get(companyId);
  if (hit && Date.now() - hit.at < PENDING_TTL_MS) return hit;
  const total = await query(
    `SELECT COUNT(*)::int AS n FROM journey_executions e WHERE e.journey_id = ANY($1::uuid[]) AND e.status = 'active'`,
    [journeyIds],
  );
  if (Number(total.rows[0]?.n || 0) > PENDING_MAX_ACTIVE) return null;
  const r = await query(
    `SELECT e.journey_id, COUNT(*)::int AS pending
       FROM journey_executions e
      WHERE e.journey_id = ANY($2::uuid[]) AND e.status = 'active'
        AND (
          EXISTS (SELECT 1 FROM customers c
                   WHERE c.id = e.customer_id AND c.company_id = $1::uuid
                     AND c.recent_purchase_date IS NOT NULL
                     AND c.recent_purchase_date > (e.entered_at AT TIME ZONE 'Asia/Seoul')::date)
          OR EXISTS (SELECT 1 FROM cdp_events ce
                      WHERE ce.company_id = $1::uuid AND ce.customer_id = e.customer_id
                        AND ce.event_name = 'purchase' AND ce.occurred_at > e.entered_at)
          OR EXISTS (SELECT 1 FROM purchases p
                      WHERE p.company_id = $1::uuid AND p.customer_id = e.customer_id
                        AND p.purchase_date IS NOT NULL
                        AND p.purchase_date > (e.entered_at AT TIME ZONE 'Asia/Seoul'))
        )
      GROUP BY e.journey_id`,
    [companyId, journeyIds],
  );
  const value = new Map<string, number>(r.rows.map((x: any) => [String(x.journey_id), Number(x.pending || 0)]));
  const entry = { at: Date.now(), value };
  pendingCache.set(companyId, entry);
  return entry;
}

export async function buildLifecycleMap(companyId: string): Promise<LifecycleMap> {
  const lineageReady = await lineageColumnsReady().catch(() => false);
  const jr = await query(
    `SELECT id, name, status, trigger_event, trigger_filters, start_kind, goal_exit_enabled, goal_kind,
            allow_reentry, auto_reentry_enabled, threshold_recipients_per_step, updated_at${lineageReady ? ', lineage_id, entry_closed_at' : ''}
       FROM journeys
      WHERE company_id = $1::uuid AND archived_at IS NULL
      ORDER BY created_at ASC`,
    [companyId],
  );
  const rows: any[] = jr.rows;
  const ids = rows.map((r) => String(r.id));

  const stepsByJourney = new Map<string, any[]>();
  const waitingByStep = new Map<string, number>();
  const exitsBySlot = new Map<string, number>();
  const countsByJourney = new Map<string, MapJourney['counts']>();

  if (ids.length > 0) {
    const sr = await query(
      `SELECT id, journey_id, step_order, step_type, delay_hours, delay_mode, target_hour_kst, channel, is_ad,
              LEFT(COALESCE(message_template, ''), 60) AS preview, not_met_goto, wait_event_name, wait_timeout_hours, anchor_offset_days
         FROM journey_steps
        WHERE journey_id = ANY($1::uuid[])
        ORDER BY journey_id, step_order`,
      [ids],
    );
    for (const s of sr.rows) {
      const k = String(s.journey_id);
      if (!stepsByJourney.has(k)) stepsByJourney.set(k, []);
      stepsByJourney.get(k)!.push(s);
    }

    const cr = await query(
      `SELECT journey_id,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active_now,
              COUNT(*) FILTER (WHERE status <> 'holdout' AND entered_at > NOW() - INTERVAL '30 days')::int AS entered_30d,
              COUNT(*) FILTER (WHERE status = 'goal_met' AND completed_at > NOW() - INTERVAL '30 days')::int AS goal_met_30d,
              COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '30 days')::int AS completed_30d
         FROM journey_executions
        WHERE journey_id = ANY($1::uuid[])
        GROUP BY journey_id`,
      [ids],
    );
    for (const c of cr.rows) {
      countsByJourney.set(String(c.journey_id), {
        activeNow: Number(c.active_now || 0), entered30d: Number(c.entered_30d || 0),
        goalMet30d: Number(c.goal_met_30d || 0), completed30d: Number(c.completed_30d || 0),
      });
    }

    // 칸별 대기(지금) · 칸 뒤 출구(최근 30일) — current_step_order 로 센다(= 마지막으로 처리한 칸).
    const pr = await query(
      `SELECT journey_id, current_step_order AS k,
              COUNT(*) FILTER (WHERE status = 'active')::int AS waiting,
              COUNT(*) FILTER (WHERE status = 'goal_met' AND completed_at > NOW() - INTERVAL '30 days')::int AS exited
         FROM journey_executions
        WHERE journey_id = ANY($1::uuid[]) AND status IN ('active', 'goal_met')
        GROUP BY journey_id, current_step_order`,
      [ids],
    );
    for (const p of pr.rows) {
      waitingByStep.set(`${p.journey_id}:${Number(p.k)}`, Number(p.waiting || 0));
      exitsBySlot.set(`${p.journey_id}:${Number(p.k)}`, Number(p.exited || 0));
    }
  }

  const availability = toAvailabilityMap(resolveTriggerAvailability(await getCompanyJourneyFacts(companyId)));
  const capOf = (ev: string) => {
    const key = triggerKeyForEvent(ev);
    const v = key ? availability[key] : undefined;
    return v ? { available: v.available, reason: v.reason } : null;
  };

  const goalJourneyIds = rows
    .filter((r) => r.status === 'active' && r.goal_exit_enabled === true && ['purchase', '', null, undefined].includes(r.goal_kind))
    .map((r) => String(r.id));
  const pending = await loadPendingGoalExits(companyId, goalJourneyIds).catch(() => null);

  const allJourneys: MapJourney[] = rows.map((r) => {
    const id = String(r.id);
    const steps = stepsByJourney.get(id) || [];
    const startKind = String(r.start_kind || 'event');
    const triggerEvent = String(r.trigger_event || '');
    const info = isInfoAlertJourney(steps);
    const lane = laneForTrigger(triggerEvent);
    const band: MapJourney['band'] = info ? 'info'
      : startKind === 'date_anchor' || startKind === 'one_shot' || startKind === 'standing' ? 'standing'
        : lane === 'moment' ? 'moment' : lane === 'standing' ? 'standing' : 'flow';
    const graph = buildJourneyGraph(steps, { goalExitEnabled: r.goal_exit_enabled === true, startKind });
    const tf = r.trigger_filters || {};
    const hasConds = Array.isArray(tf.customer_conditions) && tf.customer_conditions.length > 0;
    return {
      id,
      name: String(r.name || ''),
      status: String(r.status || ''),
      lane: band === 'flow' || band === 'moment' ? lane : band === 'standing' ? 'standing' : null,
      band,
      triggerEvent,
      triggerLabel: triggerLabel(triggerEvent) || '알 수 없는 시작 사건',
      startKind,
      goalExitEnabled: r.goal_exit_enabled === true,
      goalKind: String(r.goal_kind || 'purchase'),
      goalLabel: GOAL_LABEL[String(r.goal_kind || 'purchase')] || '목표 달성',
      notices: journeyNotices(triggerEvent, r.goal_exit_enabled === true),
      allowReentry: r.allow_reentry === true,
      autoReentry: r.auto_reentry_enabled === true,
      thresholdRecipients: r.threshold_recipients_per_step != null ? Number(r.threshold_recipients_per_step) : null,
      targetSummary: describeJourneyTarget(triggerEvent, tf),
      broadAudience: triggerEvent === 'custom' && startKind === 'standing' && !hasConds,
      counts: countsByJourney.get(id) || { activeNow: 0, entered30d: 0, goalMet30d: 0, completed30d: 0 },
      pendingGoalExit: pending && pending.value ? (goalJourneyIds.includes(id) ? (pending.value.get(id) || 0) : null) : null,
      exitsBeforeFirst: r.goal_exit_enabled === true ? (exitsBySlot.get(`${id}:0`) || 0) : null,
      steps: graph.nodes.map((n) => {
        const raw = steps.find((s: any) => String(s.id) === n.stepId);
        return {
          stepId: n.stepId,
          order: n.order,
          kind: n.kind,
          channel: n.channel,
          isAd: n.isAd,
          timingLabel: n.timingLabel,
          intervalLabel: n.intervalLabel,
          preview: String(raw?.preview || ''),
          waitingHere: waitingByStep.get(`${id}:${n.order - 1}`) || 0,
          exitsAfter: r.goal_exit_enabled === true && graph.exitSlots.includes(n.order)
            ? (exitsBySlot.get(`${id}:${exitSlotOf(n.order, graph)}`) || 0)
            : null,
        };
      }),
      graph: { edges: graph.edges, exitSlots: graph.exitSlots, issues: graph.issues },
      lock: lockOf(String(r.status || '')),
      capability: capOf(triggerEvent),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      lineageId: r.lineage_id ? String(r.lineage_id) : null,
      canNewVersion: lineageReady && (r.status === 'active' || r.status === 'paused') && !r.entry_closed_at,
      olderVersions: [],
    };
  });

  // ★ 2026-09-30 V2 5차 — 진입이 닫힌 옛 판(켜짐 · 멈춤)은 같은 계보의 현재 판 카드 안에 접는다(레인 · 선 · 겹침에서 빠진다).
  //   현재 판 = 같은 계보에서 진입이 열린 판(켜짐 > 멈춤 > 초안). 현재 판이 없으면 옛 판을 그대로 둔다(숨기지 않는다).
  const closedIds = new Set(rows.filter((r) => r.entry_closed_at && (r.status === 'active' || r.status === 'paused')).map((r) => String(r.id)));
  const journeys: MapJourney[] = [];
  for (const j of allJourneys) {
    if (!closedIds.has(j.id) || !j.lineageId) { journeys.push(j); continue; }
    const current = allJourneys
      .filter((x) => x.lineageId === j.lineageId && !closedIds.has(x.id) && x.status !== 'ended')
      .sort((a, b) => (RECEIVER_RANK[a.status] ?? 9) - (RECEIVER_RANK[b.status] ?? 9))[0];
    if (!current) { journeys.push(j); continue; }
    current.olderVersions.push({ id: j.id, name: j.name, status: j.status, activeNow: j.counts.activeNow });
  }

  // ── 선: 계약 간선에서만. 정보 알림 · 상시는 선에 참여하지 않는다.
  const marketing = journeys.filter((j) => j.band === 'flow' || j.band === 'moment');
  const lines: MapLine[] = [];
  const edgeContracts = TRIGGER_CONTRACTS.filter((c) => (c.nextEvents || []).length > 0);
  for (const c of edgeContracts) {
    const senders = marketing.filter((j) => j.triggerEvent === c.event && j.status !== 'ended');
    for (const a of senders) {
      for (const to of c.nextEvents || []) {
        const receivers = marketing
          .filter((j) => j.triggerEvent === to)
          .sort((x, y) => (RECEIVER_RANK[x.status] ?? 9) - (RECEIVER_RANK[y.status] ?? 9));
        const b = receivers[0] || null;
        const cap = capOf(to);
        let state: LineState;
        if (!b) state = cap && !cap.available ? 'receiver_locked' : 'no_receiver';
        else if (b.status === 'paused' || b.status === 'ended') state = 'receiver_off';
        else if (b.status === 'draft') state = 'receiver_draft';
        else if (!a.goalExitEnabled) state = 'leak';
        else if (getTriggerContract(to)?.reentryRequired && !b.allowReentry) state = 'reentry_off';
        else state = 'connected';
        lines.push({
          id: `${a.id}->${b ? b.id : to}`,
          fromJourneyId: a.id,
          toJourneyId: b ? b.id : null,
          fromTrigger: c.event,
          toTrigger: to,
          toLabel: triggerLabel(to),
          state,
          tier: LINE_TIER[state],
          reason: state === 'receiver_locked' && cap ? cap.reason : LINE_REASON[state],
          goalMet: a.counts.goalMet30d,
          handedOver: null,
          handedOver7d: null,
          fix: null,
        });
      }
    }
  }

  // 선마다 1클릭 고치기(이어붙이기 점검과 같은 규칙 · fixForLine 한 곳).
  const journeyById = new Map(journeys.map((j) => [j.id, j]));
  for (const ln of lines) ln.fix = fixForLine(ln, journeyById);

  // 선 숫자 — 같은 고객 · A 목표 달성(최근 30일) · B 는 트리거 사건으로 들어옴(__entry 표식) · A 진입 뒤 ~ A 종료 + 24시간 ·
  //   같은 사건(같은 key)으로 동시에 들어온 경우 제외 · holdout 제외. 표식이 있는 B 행이 하나도 없으면 null(측정 전).
  for (const ln of lines) {
    if (!ln.toJourneyId) continue;
    const r = await query(
      `WITH marked AS (
         SELECT COUNT(*)::int AS n FROM journey_executions b
          WHERE b.journey_id = $2::uuid AND b.entry_event_properties ? '__entry'
       )
       SELECT (SELECT n FROM marked) AS marked,
              COUNT(DISTINCT a.customer_id)::int AS handed,
              COUNT(DISTINCT a.customer_id) FILTER (WHERE a.completed_at > NOW() - INTERVAL '7 days')::int AS handed_7d
         FROM journey_executions a
         JOIN journey_executions b ON b.customer_id = a.customer_id AND b.journey_id = $2::uuid
        WHERE a.journey_id = $1::uuid
          AND a.status = 'goal_met' AND a.completed_at > NOW() - INTERVAL '30 days'
          AND b.status <> 'holdout'
          AND b.entry_event_properties ? '__entry'
          AND b.entry_event_properties->'__entry'->>'src' = 'trigger'
          AND b.entered_at > a.entered_at
          AND b.entered_at <= a.completed_at + INTERVAL '24 hours'
          AND COALESCE(b.entry_event_properties->'__entry'->>'key', '') IS DISTINCT FROM COALESCE(a.entry_event_properties->'__entry'->>'key', '~')`,
      [ln.fromJourneyId, ln.toJourneyId],
    );
    const marked = Number(r.rows[0]?.marked || 0);
    ln.handedOver = marked > 0 ? Number(r.rows[0]?.handed || 0) : null;
    ln.handedOver7d = marked > 0 ? Number(r.rows[0]?.handed_7d || 0) : null;
  }

  // ── 겹침: 계약 겹침 쌍 중 두 여정이 모두 있는 것. 지금 동시에 진행 중인 사람(약).
  //   ★ 2026-09-30 V2 3차 — 주문 완료 여정이 첫 구매 고객을 빼면(겹침 해소) 첫 구매 여정과는 겹치지 않는다.
  const filtersById = new Map(rows.map((r) => [String(r.id), (r.trigger_filters || {}) as Record<string, any>]));
  const excludesFirst = (j: MapJourney) => j.triggerEvent === 'cdp.purchase' && filtersById.get(j.id)?.exclude_first_purchase === true;
  const overlaps: MapOverlap[] = [];
  const seenPair = new Set<string>();
  for (const a of marketing) {
    for (const ev of overlapTriggerEvents(a.triggerEvent)) {
      for (const b of marketing.filter((x) => x.triggerEvent === ev && x.id !== a.id)) {
        const key = [a.id, b.id].sort().join('|');
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        if ((excludesFirst(a) && b.triggerEvent === 'purchase.first') || (excludesFirst(b) && a.triggerEvent === 'purchase.first')) continue;
        const r = await query(
          `SELECT COUNT(DISTINCT x.customer_id)::int AS n
             FROM journey_executions x
             JOIN journey_executions y ON y.customer_id = x.customer_id AND y.journey_id = $2::uuid AND y.status = 'active'
            WHERE x.journey_id = $1::uuid AND x.status = 'active'`,
          [a.id, b.id],
        );
        overlaps.push({ a: a.id, b: b.id, concurrentActive: Number(r.rows[0]?.n || 0) });
      }
    }
  }

  // ── 유령 카드: 윗띠 레인마다 여정이 하나도 없으면 그 레인의 첫 트리거 하나(데이터가 없으면 자물쇠 + 사유).
  const ghosts: MapGhost[] = [];
  const lanesInContract = new Set(TRIGGER_CONTRACTS.filter((c) => c.implemented && c.cls !== 'reservation').map((c) => c.lane));
  for (const meta of LANE_META.filter((l) => l.band === 'flow' && lanesInContract.has(l.key))) {
    if (marketing.some((j) => j.lane === meta.key && j.status !== 'ended')) continue;
    const c = TRIGGER_CONTRACTS.find((t) => t.lane === meta.key && t.implemented && t.key !== null);
    if (!c) continue;
    const cap = capOf(c.event);
    ghosts.push({ lane: meta.key, triggerEvent: c.event, label: c.label, available: cap ? cap.available : true, reason: cap ? cap.reason : '', createMode: createModeOf(c.event) });
  }
  // 받는 여정이 없는 선의 도착점도 유령 카드로(레인에 다른 여정이 있어도 · 예: 휴면 전환은 있고 휴면 복귀가 없을 때). 트리거당 1장.
  for (const ln of lines) {
    if (ln.toJourneyId || ghosts.some((g) => g.triggerEvent === ln.toTrigger)) continue;
    const lane = laneForTrigger(ln.toTrigger);
    if (!lane) continue;
    const cap = capOf(ln.toTrigger);
    ghosts.push({ lane, triggerEvent: ln.toTrigger, label: triggerLabel(ln.toTrigger), available: cap ? cap.available : true, reason: cap ? cap.reason : '', createMode: createModeOf(ln.toTrigger) });
  }

  const lockedTriggers = TRIGGER_CONTRACTS
    .filter((c) => c.implemented && c.key !== null && c.cls !== 'reservation')
    .map((c) => ({ c, cap: capOf(c.event) }))
    .filter(({ cap }) => cap && !cap.available)
    .map(({ c, cap }) => ({ triggerEvent: c.event, label: c.label, reason: cap!.reason }));

  return {
    generatedAt: new Date().toISOString(),
    judgedAt: pending ? new Date(pending.at).toISOString() : null,
    lanes: LANE_META.filter((l) => l.band !== 'flow' || lanesInContract.has(l.key)),
    journeys,
    lines,
    ghosts,
    overlaps,
    lockedTriggers,
    costs: { generate: getCreditCost('journey-ai-generate'), activate: getCreditCost('journey-activate') },
  };
}

// ════════════════════════════════════════════════════════════════════
// 이어붙이기 점검 (★ 2026-09-30 여정 V2 2차 · 설계서 §4 · §5 · §13-1 "2차 이어붙이기 1클릭 범위")
// ════════════════════════════════════════════════════════════════════

export interface AttachCheckRow {
  id: string;
  journeyId: string;
  kind: 'outgoing' | 'incoming' | 'overlap' | 'duplicate' | 'suggest_sender';
  tier: LineTier;
  text: string;
  reason: string;
  /** 1클릭 고치기 — 초안 · 멈춤 = 전부 · 켜진 여정 = 자동 종료 켜기만 · 나머지는 일시정지하고 고치기(설계서 §13-1). */
  fix: AttachFix | null;
}

function fixForLine(ln: MapLine, byId: Map<string, MapJourney>): AttachCheckRow['fix'] {
  const a = byId.get(ln.fromJourneyId);
  const b = ln.toJourneyId ? byId.get(ln.toJourneyId) : undefined;
  switch (ln.state) {
    case 'leak':
      return a ? { action: 'goal_exit_on', journeyId: a.id, label: '목표를 이루면 멈춤 켜기', activeCount: a.counts.activeNow } : null;
    case 'no_receiver':
      return { action: 'create', triggerEvent: ln.toTrigger, label: `${ln.toLabel} 여정 만들기`, createMode: createModeOf(ln.toTrigger) };
    case 'receiver_draft':
      return b ? { action: 'activate', journeyId: b.id, label: '받는 여정 켜기' } : null;
    case 'receiver_off':
      return b && b.status === 'paused' ? { action: 'activate', journeyId: b.id, label: '받는 여정 다시 켜기' } : null;
    case 'reentry_off':
      if (!b) return null;
      return b.status === 'active'
        ? { action: 'pause_and_allow_reentry', journeyId: b.id, label: '일시정지하고 다시 받기 켜기' }
        : { action: 'allow_reentry_on', journeyId: b.id, label: '다음 구매 때 다시 받기 켜기' };
    default:
      return null;
  }
}

/**
 * 한 여정(초안 포함) 기준으로 들어오는 선 · 나가는 선 · 같이 시작 · 같은 시작 사건의 켜진 여정 · 앞에 있으면 좋은 여정.
 * 지도 응답(buildLifecycleMap)만 읽는다 — 선 판정을 다시 하지 않는다.
 */
export function buildAttachCheck(map: LifecycleMap, journeyIds: string[]): AttachCheckRow[] {
  const byId = new Map(map.journeys.map((j) => [j.id, j]));
  const rows: AttachCheckRow[] = [];
  const seen = new Set<string>();
  const push = (r: AttachCheckRow) => { if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); } };
  const marketing = map.journeys.filter((j) => j.band === 'flow' || j.band === 'moment');

  for (const id of journeyIds) {
    const j = byId.get(id);
    if (!j) continue;
    for (const ln of map.lines.filter((l) => l.fromJourneyId === id)) {
      push({ id: `line:${ln.id}`, journeyId: id, kind: 'outgoing', tier: ln.tier, text: `${j.name} 다음 ${ln.toLabel} 여정`, reason: ln.reason, fix: fixForLine(ln, byId) });
    }
    for (const ln of map.lines.filter((l) => l.toJourneyId === id)) {
      const a = byId.get(ln.fromJourneyId);
      push({ id: `line:${ln.id}`, journeyId: id, kind: 'incoming', tier: ln.tier, text: `${a?.name || '여정'}에서 ${j.name}(으)로`, reason: ln.reason, fix: fixForLine(ln, byId) });
    }
    for (const o of map.overlaps.filter((x) => x.a === id || x.b === id)) {
      const other = byId.get(o.a === id ? o.b : o.a);
      push({ id: `overlap:${[o.a, o.b].sort().join('|')}`, journeyId: id, kind: 'overlap', tier: 'warn', text: `${j.name} · ${other?.name || '여정'}`, reason: '같은 구매 한 번에 두 여정이 함께 시작될 수 있어요. 켤 때 어떻게 할지 고릅니다.', fix: null });
    }
    if (j.status !== 'active' && j.status !== 'ended') {
      const dup = marketing.find((x) => x.id !== id && x.status === 'active' && x.triggerEvent === j.triggerEvent);
      if (dup) {
        push({ id: `dup:${id}:${dup.id}`, journeyId: id, kind: 'duplicate', tier: 'warn', text: `같은 시작 사건(${j.triggerLabel})으로 켜진 여정: ${dup.name}`, reason: '둘 다 켜면 한 고객이 두 여정을 모두 받습니다.', fix: null });
      }
    }
    if (j.band === 'flow' || j.band === 'moment') {
      for (const c of TRIGGER_CONTRACTS.filter((t) => (t.nextEvents || []).includes(j.triggerEvent))) {
        if (marketing.some((x) => x.triggerEvent === c.event && x.status !== 'ended')) continue;
        const cap = map.lockedTriggers.find((t) => t.triggerEvent === c.event);
        push({
          id: `sender:${c.event}:${id}`, journeyId: id, kind: 'suggest_sender', tier: 'empty',
          text: `앞에 ${c.label} 여정이 있으면 이 여정으로 이어져요`,
          reason: cap ? cap.reason : '목표를 이룬 고객이 이 여정으로 넘어옵니다.',
          fix: cap ? null : { action: 'create', triggerEvent: c.event, label: `${c.label} 여정 만들기`, createMode: createModeOf(c.event) },
        });
      }
    }
  }
  return rows;
}
