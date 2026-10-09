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
// ★ 2026-10-09 고객 관계 지도 — 칸 편집 정책(PATCH 게이트와 같은 함수) · 구매 문(가입 안내문이 문마다 다르다)
import { stepEditPolicy, type StepEditPolicy } from './journey-step-edit-policy';
import { isMallPurchaseDoorActive } from './journey-purchase-ledger';

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

// ★ 2026-10-09 고객 관계 지도(설계서 docs/2026-10-09-journey-crm-map-design.md §3) — sender_off · dormant_mismatch 추가.
export type LineState = 'connected' | 'leak' | 'no_receiver' | 'receiver_draft' | 'receiver_off' | 'receiver_locked' | 'reentry_off' | 'sender_off' | 'dormant_mismatch';
export type LineTier = 'solid' | 'warn' | 'empty';

const LINE_TIER: Record<LineState, LineTier> = {
  connected: 'solid', leak: 'warn', receiver_draft: 'warn', receiver_off: 'warn', reentry_off: 'warn', dormant_mismatch: 'warn',
  // 보내는 여정이 켜져 있지 않으면 계획 점선(손봐야 함 호박색은 켜진 흐름의 결함 전용 · 빈 곳 숫자에도 안 센다).
  no_receiver: 'empty', receiver_locked: 'empty', sender_off: 'empty',
};
const LINE_REASON: Record<LineState, string> = {
  connected: '목표를 이루면 이 여정을 마치고 다음 여정이 자기 시작 사건으로 새로 맞이합니다.',
  leak: '목표를 이뤄도 남은 문자가 계속 나가요. "목표 달성 시 자동 종료"를 켜면 이어집니다.',
  no_receiver: '받는 여정이 아직 없어요.',
  receiver_draft: '받는 여정이 초안이라 아직 못 받아요.',
  receiver_off: '받는 여정이 멈춰 있거나 끝나서 못 받아요.',
  receiver_locked: '받는 여정을 만들려면 데이터 연동이 필요해요.',
  reentry_off: '받는 여정이 다시 들어오기를 막고 있어 두 번째부터 못 받아요.',
  sender_off: '보내는 여정이 켜져 있지 않아 아직 이어지지 않아요.',
  dormant_mismatch: '두 여정의 휴면 기준일이 달라요. 같은 값이어야 휴면 여정을 받은 고객이 복귀 여정으로 이어집니다.',
};

/** 휴면 기준일(대상 필터 dormant_days · 없으면 추출기 · 워커 기본값 30). */
export const DEFAULT_DORMANT_DAYS = 30;
export function dormantDaysOf(filters: Record<string, any> | null | undefined): number {
  const n = Number((filters || {}).dormant_days);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_DORMANT_DAYS;
}

/**
 * 숫자 창(일) — 여정마다: 마지막 칸 누적 최대 + 7일, 30~180일(설계서 §3-4).
 *   30일 고정 창이면 30일보다 뒤에 있는 칸 도달이 늘 0으로 보인다(재구매 30일 · 상품 45일 칸).
 */
export const MAP_WINDOW_MIN_DAYS = 30;
export const MAP_WINDOW_MAX_DAYS = 180;
export function mapWindowDays(graph: Pick<JourneyGraph, 'nodes'>): number {
  const maxHours = Math.max(0, ...graph.nodes.map((n) => n.cumulativeMaxHours ?? 0));
  const days = Math.ceil(maxHours / 24) + 7;
  return Math.min(MAP_WINDOW_MAX_DAYS, Math.max(MAP_WINDOW_MIN_DAYS, days));
}

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
  /** 최근 W일 들어온 고객 중 이 칸을 받은 사람(시연 기록 포함). */
  reached: number;
  /** 최근 W일 들어온 고객 중 이 칸 뒤에서 목표를 이뤄 마친 사람. 목표 종료 꺼짐 · 출구 자리 아님 = null. */
  exitsAfter: number | null;
  /** 이미 목표를 이뤄 이 칸 다음 차례 직전에 마칠 예정(조회 때 계산 · 쓰기 없음). 판정 안 함 = null. */
  pendingHere: number | null;
  /** 이 칸의 누적 시점이 숫자 창 W 보다 뒤 — 도달 0 을 "아직 없음"으로 읽지 않게. */
  outOfWindow: boolean;
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
  /**
   * ★ 2026-10-09 숫자 한 벌 — 상태 숫자(activeNow · inProgress)는 지금 · 누적 숫자(entered · goalMet · completed)는
   *   같은 창(windowDays) · 같은 코호트(그 창 안에 들어온 고객 · holdout 제외). 옛 30일 필드는 지웠다(두 벌 금지).
   */
  counts: { activeNow: number; inProgress: number; entered: number; goalMet: number; completed: number };
  windowDays: number;
  /** 이미 목표를 이뤄 다음 칸 직전에 빠질 예정(칸별 합 · 조회 때 계산 · 쓰기 없음). 판정 안 함 = null. */
  pendingGoalExit: number | null;
  /** 최근 W일 들어온 고객 중 첫 문자 전에 목표를 이뤄 마친 사람(출구 0). 목표 종료 꺼짐 = null. */
  exitsBeforeFirst: number | null;
  /** 바닥 한 줄 — 이 여정이 언제 끝나는지(목표 종료 · 목표 종류 · 계약 출구로 서버가 정한다). */
  endNote: string;
  /** 같은 상품을 다시 사면 처음부터(진입 교체) — 켜진 여정만 그린다. */
  entryReplace: boolean;
  steps: MapStep[];
  graph: Pick<JourneyGraph, 'edges' | 'exitSlots' | 'issues'>;
  /** 칸 편집 정책(PATCH 게이트와 같은 함수 · journey-step-edit-policy). */
  edit: StepEditPolicy;
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
  /** 최근 W일(A 의 창) A 에 들어온 고객 중 목표를 이룬 사람. */
  goalMet: number;
  /** 그중 B 가 이어받은 사람(같은 구매로 동시에 들어온 경우 · 재진입 워커 진입 제외). 표식 이전 = null("측정 전"). */
  handedOver: number | null;
  handedOver7d: number | null;
  /** B 의 같은 창(A 의 W일) 전체 진입 — 라벨 "이어받음 M / 전체 X" 의 분모. 받는 여정 없음 = null. */
  receiverEntered: number | null;
  /** 이 선 숫자의 창(= A 의 windowDays). */
  windowDays: number;
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

/**
 * 카드 안내(사실 문장).
 *   ★ 2026-10-09 — 가입 직후 구매 안내는 구매 문에 따라 다르다(회의론자 최종 검증 A5).
 *   자사몰 문 = 구매 사건 시각이 진입 뒤라 목표 판정이 첫 칸 앞에서 잡힌다 → 환영 대신 첫 구매 여정.
 *   매장 원장 문(싱크) = 고객과 구매가 같은 묶음으로 오고 구매일(어제)이 진입 시각(오늘)보다 앞 → 목표로 안 잡혀 둘 다 받는다
 *   (journey-executor 구매 판정 = 진입 뒤 구매). 사실과 다른 문장을 싣지 않는다.
 */
function journeyNotices(triggerEvent: string, goalExitEnabled: boolean, door: 'mall' | 'ledger'): string[] {
  const out: string[] = [];
  if (triggerEvent === 'customer.created' && goalExitEnabled) {
    out.push(door === 'mall'
      ? '가입 직후 구매한 고객은 환영 문자 대신 첫 구매 여정이 맞이해요.'
      : '같은 날 가입하고 산 고객은 환영 문자와 첫 구매 문자를 둘 다 받아요.');
  }
  return out;
}

const GOAL_END_NOTE: Record<string, string> = {
  purchase: '구매가 확인되면 여기서 끝나요',
  points_used: '포인트를 쓰면 여기서 끝나요',
  click: '링크를 누르면 여기서 끝나요',
  visit: '방문이 확인되면 여기서 끝나요',
};

/** 바닥 한 줄 — 언제 끝나는가(설계서 §2 · 회의론자 A1). 목표 종료 꺼짐 · 상품 · 끝까지 보내는 사건을 가른다. */
export function journeyEndNote(triggerEvent: string, goalExitEnabled: boolean, goalKind: string): string {
  const exit = getTriggerContract(triggerEvent)?.exit;
  if (!goalExitEnabled) {
    return exit === 'steps_done' || exit === 'reservation_closed' || !exit
      ? '마지막 문자를 보내면 끝나요'
      : '구매해도 끝까지 보냅니다';
  }
  if (exit === 'product_repurchase') return '같은 상품을 다시 사면 여기서 끝나요';
  return GOAL_END_NOTE[goalKind || 'purchase'] || '목표를 이루면 여기서 끝나요';
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
 *   ★ 2026-10-09 — 칸별(`journeyId:current_step_order`)로 센다(지도 척추의 칸마다 "곧 마칠 예정").
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
    `SELECT e.journey_id, e.current_step_order AS k, COUNT(*)::int AS pending
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
      GROUP BY e.journey_id, e.current_step_order`,
    [companyId, journeyIds],
  );
  const value = new Map<string, number>(r.rows.map((x: any) => [`${x.journey_id}:${Number(x.k || 0)}`, Number(x.pending || 0)]));
  const entry = { at: Date.now(), value };
  pendingCache.set(companyId, entry);
  return entry;
}

/** 선 판정 입력(순수) — 지도 여정 + 대상 필터(휴면 기준일). */
export interface LineJourneyInput {
  id: string;
  status: string;
  triggerEvent: string;
  goalExitEnabled: boolean;
  allowReentry: boolean;
  filters: Record<string, any>;
}

/** 선 판정 결과(숫자 · 고치기 없음) — 지도 · 이어붙이기 점검이 같은 판정을 쓴다. */
export interface ComputedLine {
  id: string;
  fromJourneyId: string;
  toJourneyId: string | null;
  fromTrigger: string;
  toTrigger: string;
  state: LineState;
  reason: string;
}

/**
 * 선 판정(순수 · DB 0) — 설계서 §3-1 · §3-2 · §3-7.
 *   받는 쪽 = 같은 시작 사건의 끝나지 않은 마케팅 여정 중 **켜진 것 전부**. 켜진 것이 없으면 대표 하나(멈춤 > 초안)에 점선 한 가닥.
 *   (초안이 여럿인 회사에서 선이 덤불이 되지 않게 · 회의론자 B1)
 *   보내는 여정이 켜짐이 아니면 실선을 긋지 않는다(sender_off · 계획 점선).
 */
export function computeMapLines(marketing: LineJourneyInput[], capOf: (ev: string) => { available: boolean; reason: string } | null): ComputedLine[] {
  const out: ComputedLine[] = [];
  for (const c of TRIGGER_CONTRACTS.filter((t) => (t.nextEvents || []).length > 0)) {
    const senders = marketing.filter((j) => j.triggerEvent === c.event && j.status !== 'ended');
    for (const a of senders) {
      for (const to of c.nextEvents || []) {
        const ranked = marketing
          .filter((j) => j.triggerEvent === to && j.status !== 'ended')
          .sort((x, y) => (RECEIVER_RANK[x.status] ?? 9) - (RECEIVER_RANK[y.status] ?? 9));
        const actives = ranked.filter((j) => j.status === 'active');
        const receivers: Array<LineJourneyInput | null> = actives.length > 0 ? actives : [ranked[0] || null];
        for (const b of receivers) {
          const cap = capOf(to);
          let state: LineState;
          let reason: string | null = null;
          if (!b) state = cap && !cap.available ? 'receiver_locked' : 'no_receiver';
          else if (b.status === 'paused') state = 'receiver_off';
          else if (b.status === 'draft') state = 'receiver_draft';
          else if (a.status !== 'active') state = 'sender_off';
          else if (!a.goalExitEnabled) state = 'leak';
          else if (getTriggerContract(to)?.reentryRequired && !b.allowReentry) state = 'reentry_off';
          else if (c.event === 'customer.dormant' && to === 'customer.dormant_return' && dormantDaysOf(a.filters) !== dormantDaysOf(b.filters)) {
            state = 'dormant_mismatch';
            reason = `${LINE_REASON.dormant_mismatch} 지금 휴면 ${dormantDaysOf(a.filters)}일 · 복귀 ${dormantDaysOf(b.filters)}일.`;
          } else state = 'connected';
          out.push({
            id: `${a.id}->${b ? b.id : to}`,
            fromJourneyId: a.id,
            toJourneyId: b ? b.id : null,
            fromTrigger: c.event,
            toTrigger: to,
            state,
            reason: reason ?? (state === 'receiver_locked' && cap ? cap.reason : LINE_REASON[state]),
          });
        }
      }
    }
  }
  return out;
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
  const graphById = new Map<string, JourneyGraph>();
  const windowById = new Map<string, number>();
  const waitingByStep = new Map<string, number>();
  const exitsBySlot = new Map<string, number>();
  const reachedByStep = new Map<string, number>();
  const stateById = new Map<string, { activeNow: number; inProgress: number }>();
  const cohortById = new Map<string, { entered: number; goalMet: number; completed: number }>();

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
  }
  for (const r of rows) {
    const id = String(r.id);
    const g = buildJourneyGraph(stepsByJourney.get(id) || [], { goalExitEnabled: r.goal_exit_enabled === true, startKind: String(r.start_kind || 'event') });
    graphById.set(id, g);
    windowById.set(id, mapWindowDays(g));
  }
  const windows = ids.map((id) => windowById.get(id) || MAP_WINDOW_MIN_DAYS);

  if (ids.length > 0) {
    // 상태 숫자(지금) — 진행 중 · 칸별 대기.
    const st = await query(
      `SELECT journey_id, current_step_order AS k,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active_now,
              COUNT(*)::int AS in_progress
         FROM journey_executions
        WHERE journey_id = ANY($1::uuid[]) AND status IN ('active', 'paused')
        GROUP BY journey_id, current_step_order`,
      [ids],
    );
    for (const p of st.rows) {
      const id = String(p.journey_id);
      const cur = stateById.get(id) || { activeNow: 0, inProgress: 0 };
      cur.activeNow += Number(p.active_now || 0);
      cur.inProgress += Number(p.in_progress || 0);
      stateById.set(id, cur);
      waitingByStep.set(`${id}:${Number(p.k || 0)}`, Number(p.active_now || 0));
    }

    // 누적 숫자(코호트) — 여정마다 창 W 안에 들어온 고객(holdout 제외). 진입 · 칸 뒤 구매 확인 · 끝까지 받음이 한 벌.
    const co = await query(
      `SELECT e.journey_id, e.status, e.current_step_order AS k, COUNT(*)::int AS n
         FROM journey_executions e
         JOIN unnest($1::uuid[], $2::int[]) AS w(jid, days) ON w.jid = e.journey_id
        WHERE e.status <> 'holdout' AND e.entered_at > NOW() - make_interval(days => w.days)
        GROUP BY e.journey_id, e.status, e.current_step_order`,
      [ids, windows],
    );
    for (const p of co.rows) {
      const id = String(p.journey_id);
      const n = Number(p.n || 0);
      const cur = cohortById.get(id) || { entered: 0, goalMet: 0, completed: 0 };
      cur.entered += n;
      if (p.status === 'goal_met') {
        cur.goalMet += n;
        // 출구 자리 밖 위치(마지막 칸 뒤 등)는 가장 가까운 출구 자리에 더한다(옛: 아무 데도 안 잡혀 합이 안 맞았다).
        const g = graphById.get(id);
        const slot = g ? exitSlotOf(Number(p.k || 0), g) : Number(p.k || 0);
        exitsBySlot.set(`${id}:${slot}`, (exitsBySlot.get(`${id}:${slot}`) || 0) + n);
      }
      if (p.status === 'completed') cur.completed += n;
      cohortById.set(id, cur);
    }

    // 칸별 도달(같은 코호트) — 보냈다(시연 기록 = 'sent' 포함)로 남은 칸.
    const rc = await query(
      `SELECT e.journey_id, l.step_id, COUNT(DISTINCT l.execution_id)::int AS reached
         FROM journey_executions e
         JOIN unnest($1::uuid[], $2::int[]) AS w(jid, days) ON w.jid = e.journey_id
         JOIN journey_step_logs l ON l.execution_id = e.id AND l.status = 'sent'
        WHERE e.status <> 'holdout' AND e.entered_at > NOW() - make_interval(days => w.days)
        GROUP BY e.journey_id, l.step_id`,
      [ids, windows],
    );
    for (const p of rc.rows) reachedByStep.set(String(p.step_id), Number(p.reached || 0));
  }

  const availability = toAvailabilityMap(resolveTriggerAvailability(await getCompanyJourneyFacts(companyId)));
  const capOf = (ev: string) => {
    const key = triggerKeyForEvent(ev);
    const v = key ? availability[key] : undefined;
    return v ? { available: v.available, reason: v.reason } : null;
  };
  const door: 'mall' | 'ledger' = (await isMallPurchaseDoorActive(companyId).catch(() => false)) ? 'mall' : 'ledger';

  const goalJourneyIds = rows
    .filter((r) => r.status === 'active' && r.goal_exit_enabled === true && ['purchase', '', null, undefined].includes(r.goal_kind)
      && getTriggerContract(String(r.trigger_event || ''))?.exit !== 'product_repurchase')
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
    const graph = graphById.get(id) || buildJourneyGraph(steps, { goalExitEnabled: r.goal_exit_enabled === true, startKind });
    const windowDays = windowById.get(id) || MAP_WINDOW_MIN_DAYS;
    const tf = r.trigger_filters || {};
    const hasConds = Array.isArray(tf.customer_conditions) && tf.customer_conditions.length > 0;
    const goalExitEnabled = r.goal_exit_enabled === true;
    const goalKind = String(r.goal_kind || 'purchase');
    const state = stateById.get(id) || { activeNow: 0, inProgress: 0 };
    const cohort = cohortById.get(id) || { entered: 0, goalMet: 0, completed: 0 };
    const judged = !!(pending && pending.value && goalJourneyIds.includes(id));
    const pendingAt = (k: number): number | null => (judged ? (pending!.value.get(`${id}:${k}`) || 0) : null);
    return {
      id,
      name: String(r.name || ''),
      status: String(r.status || ''),
      lane: band === 'flow' || band === 'moment' ? lane : band === 'standing' ? 'standing' : null,
      band,
      triggerEvent,
      triggerLabel: triggerLabel(triggerEvent) || '알 수 없는 시작 사건',
      startKind,
      goalExitEnabled,
      goalKind,
      goalLabel: GOAL_LABEL[goalKind] || '목표 달성',
      notices: journeyNotices(triggerEvent, goalExitEnabled, door),
      allowReentry: r.allow_reentry === true,
      autoReentry: r.auto_reentry_enabled === true,
      thresholdRecipients: r.threshold_recipients_per_step != null ? Number(r.threshold_recipients_per_step) : null,
      targetSummary: describeJourneyTarget(triggerEvent, tf),
      broadAudience: triggerEvent === 'custom' && startKind === 'standing' && !hasConds,
      counts: { activeNow: state.activeNow, inProgress: state.inProgress, entered: cohort.entered, goalMet: cohort.goalMet, completed: cohort.completed },
      windowDays,
      pendingGoalExit: judged ? [...pending!.value.entries()].filter(([k]) => k.startsWith(`${id}:`)).reduce((s, [, v]) => s + v, 0) : null,
      exitsBeforeFirst: goalExitEnabled ? (exitsBySlot.get(`${id}:0`) || 0) : null,
      endNote: journeyEndNote(triggerEvent, goalExitEnabled, goalKind),
      entryReplace: tf.entry_replace === true,
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
          reached: reachedByStep.get(n.stepId) || 0,
          exitsAfter: goalExitEnabled && graph.exitSlots.includes(n.order) ? (exitsBySlot.get(`${id}:${n.order}`) || 0) : null,
          pendingHere: pendingAt(n.order - 1),
          outOfWindow: n.cumulativeMinHours != null && n.cumulativeMinHours > windowDays * 24,
        };
      }),
      graph: { edges: graph.edges, exitSlots: graph.exitSlots, issues: graph.issues },
      edit: stepEditPolicy(String(r.status || ''), state.inProgress),
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
  // 레인 안 순서(서버가 정한다 · 회의론자 A4) — 켜짐 → 멈춤 → 초안 → 끝남, 같은 상태면 지금 진행 중 많은 순.
  journeys.sort((a, b) => ((RECEIVER_RANK[a.status] ?? 9) - (RECEIVER_RANK[b.status] ?? 9)) || (b.counts.activeNow - a.counts.activeNow));

  // ── 선: 계약 간선에서만(computeMapLines · 순수). 정보 알림 · 상시는 선에 참여하지 않는다.
  const marketing = journeys.filter((j) => j.band === 'flow' || j.band === 'moment');
  const filtersById = new Map(rows.map((r) => [String(r.id), (r.trigger_filters || {}) as Record<string, any>]));
  const journeyById = new Map(journeys.map((j) => [j.id, j]));
  const lines: MapLine[] = computeMapLines(
    marketing.map((j) => ({ id: j.id, status: j.status, triggerEvent: j.triggerEvent, goalExitEnabled: j.goalExitEnabled, allowReentry: j.allowReentry, filters: filtersById.get(j.id) || {} })),
    capOf,
  ).map((c) => {
    const a = journeyById.get(c.fromJourneyId)!;
    return {
      ...c,
      toLabel: triggerLabel(c.toTrigger),
      tier: LINE_TIER[c.state],
      goalMet: a.counts.goalMet,
      handedOver: null,
      handedOver7d: null,
      receiverEntered: null,
      windowDays: a.windowDays,
      fix: null,
    };
  });

  // 선마다 1클릭 고치기(이어붙이기 점검과 같은 규칙 · fixForLine 한 곳).
  for (const ln of lines) ln.fix = fixForLine(ln, journeyById);

  // 선 숫자 — 같은 고객 · A 에 창 W(A 의 창) 안에 들어와 목표 달성 · B 는 트리거 사건으로 들어옴(__entry 표식) · A 진입 뒤 ~ A 종료 + 24시간 ·
  //   같은 사건(같은 key)으로 동시에 들어온 경우 제외 · holdout 제외. 표식이 있는 B 행이 하나도 없으면 null(측정 전).
  //   분모 = B 의 같은 창 전체 진입(holdout 제외) — "이어받음 M / 전체 X".
  for (const ln of lines) {
    if (!ln.toJourneyId) continue;
    const r = await query(
      `WITH marked AS (
         SELECT COUNT(*)::int AS n FROM journey_executions b
          WHERE b.journey_id = $2::uuid AND b.entry_event_properties ? '__entry'
       ), total AS (
         SELECT COUNT(*)::int AS n FROM journey_executions b
          WHERE b.journey_id = $2::uuid AND b.status <> 'holdout' AND b.entered_at > NOW() - make_interval(days => $3::int)
       )
       SELECT (SELECT n FROM marked) AS marked,
              (SELECT n FROM total) AS receiver_entered,
              COUNT(DISTINCT a.customer_id)::int AS handed,
              COUNT(DISTINCT a.customer_id) FILTER (WHERE a.completed_at > NOW() - INTERVAL '7 days')::int AS handed_7d
         FROM journey_executions a
         JOIN journey_executions b ON b.customer_id = a.customer_id AND b.journey_id = $2::uuid
        WHERE a.journey_id = $1::uuid
          AND a.status = 'goal_met' AND a.entered_at > NOW() - make_interval(days => $3::int)
          AND b.status <> 'holdout'
          AND b.entry_event_properties ? '__entry'
          AND b.entry_event_properties->'__entry'->>'src' = 'trigger'
          AND b.entered_at > a.entered_at
          AND b.entered_at <= a.completed_at + INTERVAL '24 hours'
          AND COALESCE(b.entry_event_properties->'__entry'->>'key', '') IS DISTINCT FROM COALESCE(a.entry_event_properties->'__entry'->>'key', '~')`,
      [ln.fromJourneyId, ln.toJourneyId, ln.windowDays],
    );
    const marked = Number(r.rows[0]?.marked || 0);
    ln.handedOver = marked > 0 ? Number(r.rows[0]?.handed || 0) : null;
    ln.handedOver7d = marked > 0 ? Number(r.rows[0]?.handed_7d || 0) : null;
    ln.receiverEntered = Number(r.rows[0]?.receiver_entered || 0);
  }

  // ── 겹침: 계약 겹침 쌍 중 두 여정이 모두 있는 것. 지금 동시에 진행 중인 사람(약).
  //   ★ 2026-09-30 V2 3차 — 주문 완료 여정이 첫 구매 고객을 빼면(겹침 해소) 첫 구매 여정과는 겹치지 않는다.
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
