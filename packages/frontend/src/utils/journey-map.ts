/**
 * journey-map.ts — 생애 지도 응답 타입 · 색 사전 · 문구 사전 (★ 2026-09-29 여정 V2 1차)
 *
 * 설계서 = docs/2026-09-29-journey-v2-master-design.md §3.
 *
 * ⛔ 의미(선 상태 · 칸 출구 · 잠금 · 레인)는 서버(journey-lifecycle-map CT)가 정한다. 여기는 **그리는 값**만 둔다.
 *    화면이 칸 배열을 보고 선 · 갈래를 다시 추론하는 코드를 만들지 않는다(그림이 실행기와 다른 말을 하던 뿌리).
 * ⛔ 색은 이 사전 한 곳에서만 꺼낸다. 호박색(amber)은 "손봐야 함" 전용 — 대기 칸 · 흐름 중간값에 쓰지 않는다
 *    (같은 색이 두 뜻이면 고칠 곳 신호가 묻힌다 · 디자이너 최종 검증).
 * ⛔ 사용자 문구에 영문 식별자 · 내부어 · 모델명 · 줄표를 쓰지 않는다.
 */

export type JourneyLane = 'signup' | 'first_purchase' | 'repurchase' | 'product' | 'winback' | 'moment' | 'standing';
export type LineState = 'connected' | 'leak' | 'no_receiver' | 'receiver_draft' | 'receiver_off' | 'receiver_locked' | 'reentry_off';
export type LineTier = 'solid' | 'warn' | 'empty';

export interface MapStep {
  stepId: string;
  order: number;
  kind: 'message' | 'wait' | 'condition' | 'unknown' | string;
  channel: string | null;
  isAd: boolean;
  timingLabel: string;
  intervalLabel: string;
  preview: string;
  waitingHere: number;
  exitsAfter: number | null;
}

export interface MapJourney {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'draft' | 'ended' | string;
  lane: JourneyLane | null;
  band: 'flow' | 'moment' | 'standing' | 'info';
  triggerEvent: string;
  triggerLabel: string;
  startKind: string;
  goalExitEnabled: boolean;
  goalKind: string;
  goalLabel: string;
  notices: string[];
  allowReentry: boolean;
  autoReentry: boolean;
  thresholdRecipients: number | null;
  targetSummary: string;
  broadAudience: boolean;
  counts: { activeNow: number; entered30d: number; goalMet30d: number; completed30d: number };
  pendingGoalExit: number | null;
  exitsBeforeFirst: number | null;
  steps: MapStep[];
  graph: { edges: Array<{ from: number; to: number; kind: string }>; exitSlots: number[]; issues: string[] };
  lock: { level: 'full' | 'append_only' | 'copy_only' | 'none'; reason: string };
  capability: { available: boolean; reason: string } | null;
  updatedAt: string | null;
  /** ★ 0930 V2 5차 — 계보 · 새 판 */
  lineageId: string | null;
  canNewVersion: boolean;
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
  goalMet: number;
  handedOver: number | null;
  handedOver7d: number | null;
  fix: AttachFix | null;
}

export interface LifecycleMapData {
  generatedAt: string;
  judgedAt: string | null;
  lanes: Array<{ key: JourneyLane; label: string; band: 'flow' | 'moment' | 'standing' }>;
  journeys: MapJourney[];
  lines: MapLine[];
  ghosts: Array<{ lane: JourneyLane; triggerEvent: string; label: string; available: boolean; reason: string; createMode: CreateMode }>;
  overlaps: Array<{ a: string; b: string; concurrentActive: number }>;
  lockedTriggers: Array<{ triggerEvent: string; label: string; reason: string }>;
  costs: { generate: number; activate: number };
}

/** 선 색 · 모양(시각 3종 · 선 모양이 2차 단서 = 색만으로 가르지 않는다). SVG 속성값. */
export const LINE_STYLE: Record<LineTier, { stroke: string; dash?: string; label: string }> = {
  solid: { stroke: '#8b5cf6', label: '이어짐' },
  warn: { stroke: '#f59e0b', dash: '5 4', label: '손봐야 함' },
  empty: { stroke: 'rgba(255,255,255,0.35)', dash: '2 5', label: '비어 있음' },
};

/** 선 위 짧은 이름(사유 전문은 서버 reason · 누르면 보인다). */
export const LINE_SHORT: Record<LineState, string> = {
  connected: '이어짐',
  leak: '자동 종료 꺼짐',
  no_receiver: '받는 여정 없음',
  receiver_draft: '받는 여정 초안',
  receiver_off: '받는 여정 멈춤',
  receiver_locked: '연동이 필요해요',
  reentry_off: '다시 받기 막힘',
};

/** 칸 종류 → 모양 · 색(Tailwind 완성 리터럴 · 조립 금지). */
export const CHIP_STYLE: Record<string, { box: string; label: string }> = {
  message: { box: 'bg-violet-50 border border-violet-300 text-violet-900', label: '문자' },
  wait: { box: 'bg-slate-100 border border-dashed border-slate-500/50 text-slate-700', label: '대기' },
  condition: { box: 'bg-cyan-50 border border-cyan-300 text-cyan-900', label: '조건' },
  end: { box: 'bg-white border border-slate-300 text-slate-600', label: '끝' },
  unknown: { box: 'bg-rose-50 border border-rose-300 text-rose-900', label: '알 수 없는 칸' },
};

export const STATUS_META: Record<string, { label: string; dot: string; rank: number }> = {
  active: { label: '켜짐', dot: 'bg-emerald-400', rank: 0 },
  paused: { label: '멈춤', dot: 'bg-amber-400', rank: 1 },
  draft: { label: '초안', dot: 'bg-slate-400', rank: 2 },
  ended: { label: '끝남', dot: 'bg-slate-300', rank: 3 },
};

/** 레인 안 정렬 — 켜짐 → 멈춤 → 초안 → 끝남(디자이너 최종 검증 · 방대해져도 읽히게). */
export function sortForLane(list: MapJourney[]): MapJourney[] {
  return [...list].sort((a, b) => (STATUS_META[a.status]?.rank ?? 9) - (STATUS_META[b.status]?.rank ?? 9));
}

/** 숫자 0 은 "아직 없음"으로(0 은 안전의 증거가 아니다 · 켠 날부터 센다). null = 측정 전. */
export function countText(n: number | null | undefined, zero = '아직 없음'): string {
  if (n === null || n === undefined) return '측정 전';
  return n === 0 ? zero : n.toLocaleString('ko-KR');
}

// ★ 2026-09-30 여정 V2 2차 — 문장으로 만들기 · 이어붙이기 점검 · 모두 켜기(서버 응답 그대로)

export type AttachFixAction = 'goal_exit_on' | 'allow_reentry_on' | 'pause_and_allow_reentry' | 'activate' | 'create';
/** ★ 2026-09-30 V2 3차 — 만드는 길(서버가 정함): 1클릭 프리셋 / 상품 고르기 창. */
export type CreateMode = 'preset' | 'product';
export interface AttachFix { action: AttachFixAction; label: string; journeyId?: string; triggerEvent?: string; activeCount?: number; createMode?: CreateMode }
export interface AttachCheckRow {
  id: string;
  journeyId: string;
  kind: 'outgoing' | 'incoming' | 'overlap' | 'duplicate' | 'suggest_sender';
  tier: LineTier;
  text: string;
  reason: string;
  fix: AttachFix | null;
}

export interface InterviewPlan { key: string; triggerEvent: string; title: string; objective: string }
export interface InterviewOption { value: string; label: string; desc?: string; disabled?: boolean; reason?: string }
export interface InterviewQuestion {
  id: string;
  planKey: string;
  kind: 'choice' | 'text';
  label: string;
  help?: string;
  options?: InterviewOption[];
  recommended?: string;
  recommendedByTrigger?: Record<string, string>;
  hideForTriggers?: string[];
  required: boolean;
  placeholder?: string;
  maxLength?: number;
}
export interface InterviewPrepared {
  plans: InterviewPlan[];
  questions: InterviewQuestion[];
  callback: { defaultPhone: string | null; options: Array<{ phone: string; description: string | null }> };
  costPerJourney: number;
}

export type BatchResultCode = 'NOT_FOUND' | 'DB_MIGRATION_PENDING' | 'PRETEST_REQUIRED' | 'INSUFFICIENT_CREDIT' | 'ACTIVATE_FAILED' | 'CALLBACK_CONFIRM_REQUIRED' | 'NOT_ALLOWED';
export interface BatchActivationItem {
  journeyId: string;
  name: string;
  result: { ok: true; firstActivation: boolean } | { ok: false; code: BatchResultCode; message: string; callbackUnregisteredCount?: number };
}
