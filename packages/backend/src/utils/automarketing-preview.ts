// ============================================================
// 자동 마케팅 [제안 받기] = 미리보기 · 승인 창 (★ 2026-10-05 · 설계서 docs/2026-10-05-automarketing-preview-design.md
//   · docs/2026-10-05-automarketing-trust-design.md · ★ 2026-10-24 한 줄 · 질문 · 키 docs/2026-10-24-automarketing-oneline-design.md)
//   미리보기 = 등록 없이 첫 회차와 같은 계산 · 대상은 대상 번역 module 이 계약으로 고정 · AI 문안 5(대상 0명 0) · 직접 쓴 문안 0.
//   ★ 1024 한 줄 → 모자란 것만 묻는다(질문표 = automarketing-interview · 순수). 답하기 전에는 0크레딧.
//   돈은 두 순간뿐 — [이대로 첫 문안 보기 · 5] · [이 대상으로 다시 만들기 · 5](요청 키 = 화면 키 + 문안 입력 지문) · [시작 · 200](키 = 미리보기 id = 운영자 행 id).
//   창 편집(칸 · 기준 · 주기 · 번호 · 직접 쓴 문안)은 문안을 만들지 않고 다시 센다.
//   실행 중 자동 마케팅의 [다음 승인] · [조건 확인]도 같은 계산(AI 문안 없이)을 쓴다.
// ============================================================
import { UserFacingError } from './http-error';
import { createHash, randomUUID } from 'crypto';
import { query } from '../config/database';
import { getCompanyCosts, SEND_HOURS } from '../config/defaults';
import { extractVarCatalog, filterVarCatalogByData } from '../services/ai';
import { orchestrate } from '../services/ai-orchestrator';
import { InsufficientCreditError } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { segmentNeedsCycleBaseline } from './automarketing-segment';
import {
  translateAudience, countContractAudience, forecastByDate, describeConditions, AudienceConditionError, loadAudienceFieldOptions,
  type AudienceTranslation, type AudienceCondition, type AudienceFieldOption,
} from './audience-translate';
import {
  CreateOperatorInput, ContinuousOperator, OperatorProposal, OperatorCompanyContext,
  registerOperator, generateProposalForOperator, validateOperatorInput, operatorContextFields,
  explainEmptyRound, findOpenProposalForOperator,
  loadOperatorCompanyContext, buildOperatorOrchestrateContext,
  approveOperatorWindow, normalizeFixedCopyInput, normalizeOperatorBenefit, normalizeOperatorChannel, mapRowToOperator, operatorContract, type FixedCopy,
  OperatorCallbackError, OperatorRegisterConflictError, OperatorChargeError, OperatorPairingError, OperatorScheduleChangedError, operatorScheduleShape, type OperatorScheduleShape,
  checkOperatorCallback, listOperatorCallbackChoices, finalCopiesOf, approvalWindowSummary,
} from './continuous-operator';
import type { OperatorFinalCopy } from './operator-final-copy';
import {
  computeApprovalWindow, countEmptyRounds, parseScheduleFromText, parseTimeFromText, clampToSendableTime, koreanTimeLabel, approvalSummarySince,
} from './autosend-policy';
import { buildOperatorQuestions, decideOperatorAnswers, datedTerms, type OperatorQuestion } from './automarketing-interview';
import { listenLine } from './one-line-ct/listen';
import { lineBenefitFragments } from './one-line-facts';
import { listSegmentAvailability } from './operator-audience';
import { getOpt080Number } from './messageUtils';
import { isDemoCompany } from './demo-company';
import { isUuid } from './normalize';

/** 요청 본문 → 등록 입력(축 제외 · POST /operator/continuous 에서 그대로 옮김 · 등록 · 미리보기 공용) */
export function createOperatorInputFromBody(companyId: string, userId: string, body: any): Omit<CreateOperatorInput, 'segmentKey' | 'segmentParams'> {
  const {
    name, objective, schedule, schedule_time, schedule_day_of_week, schedule_day_of_month, schedule_month,
    channel, benefit_content, admin_phone_numbers, backup_admin_phone, admin_alert_channel,
    auto_send_lead_minutes, budget_monthly, budget_daily, budget_alert_threshold, delivery_policy,
    sequence_enabled, sequence_delay_days, sequence_reminder_content, send_time_mode, copy_style,
    target_hint, mms_image_paths,
  } = body || {};
  return {
    companyId,
    createdBy: userId,
    name: String(name || '').slice(0, 100),
    objective: String(objective || ''),
    schedule,
    scheduleTime: schedule_time,
    scheduleDayOfWeek: schedule_day_of_week != null ? Number(schedule_day_of_week) : null,
    scheduleDayOfMonth: schedule_day_of_month != null ? Number(schedule_day_of_month) : null,
    scheduleMonth: schedule_month != null ? Number(schedule_month) : null,  // ★ 2026-07-05 yearly 대상 월
    // ★ 2026-06-26: 생성 시에도 채널·혜택·담당자·예산 저장 (#1 채널 / #3 담당자·2h알림 / #4 혜택 fix)
    channel,
    benefitContent: typeof benefit_content === 'string' ? benefit_content : null,
    adminPhoneNumbers: Array.isArray(admin_phone_numbers) ? admin_phone_numbers.filter((p: any) => typeof p === 'string' && p.trim()) : undefined,
    backupAdminPhone: backup_admin_phone === undefined ? undefined : (backup_admin_phone === null ? null : String(backup_admin_phone)),
    adminAlertChannel: ['sms', 'kakao', 'email'].includes(admin_alert_channel) ? admin_alert_channel : undefined,
    autoSendLeadMinutes: auto_send_lead_minutes != null ? Number(auto_send_lead_minutes) : null,
    budgetMonthly: budget_monthly === undefined ? undefined : (budget_monthly === null ? null : Number(budget_monthly)),
    budgetDaily: budget_daily === undefined ? undefined : (budget_daily === null ? null : Number(budget_daily)),
    budgetAlertThreshold: budget_alert_threshold !== undefined ? Number(budget_alert_threshold) : undefined,
    deliveryPolicy: ['daily', 'weekly', 'monthly'].includes(delivery_policy) ? delivery_policy : undefined,
    // ★ Phase3 C: 다단계 시퀀스 (1차 → N일 후 미반응자 리마인드)
    sequenceEnabled: sequence_enabled === true,
    sequenceDelayDays: sequence_delay_days != null ? Number(sequence_delay_days) : null,
    sequenceReminderContent: typeof sequence_reminder_content === 'string' ? sequence_reminder_content : null,
    // ★ 2026-07-02 1단계 B: 발송 시각 모드 — 'fixed'(기본) | 'ai_optimal'
    sendTimeMode: send_time_mode === 'ai_optimal' ? 'ai_optimal' : 'fixed',
    // ★ 2026-07-02 2단계: 문안 스타일 (createOperator가 화이트리스트 정규화)
    copyStyle: typeof copy_style === 'string' ? copy_style : null,
    // ★ 2026-07-07 마케팅 캘린더 완비: 발송 대상 축 (createOperator가 화이트리스트 정규화)
    targetHint: typeof target_hint === 'string' ? target_hint : null,
    // ★ 2026-07-30 (임은지 접수): MMS 이미지 (createOperator가 채널 mms + 최대 3장으로 정규화)
    mmsImagePaths: Array.isArray(mms_image_paths) ? mms_image_paths : null,
  };
}

/** 등록 저장 오류 → 응답(POST /operator/continuous 에서 그대로 옮김 · 등록 · 시작 공용). null = 500 으로 */
export function operatorSaveErrorResponse(err: any): { status: number; body: Record<string, unknown> } | null {
  // ★ 2026-10-05 대상 계약 없음(옛 자유 해석) · 고른 칸이 틀림 = 400(차감 0)
  if (err?.code === 'AUDIENCE_REQUIRED' || err instanceof AudienceConditionError) {
    return { status: 400, body: { success: false, error: err.message, code: err?.code || 'AUDIENCE_INVALID' } };
  }
  // ★ 2026-10-07 회신번호 = 등록 번호만(400 · 차감 0)
  if (err instanceof OperatorCallbackError) return { status: 400, body: { success: false, error: err.message, code: 'CALLBACK_NOT_REGISTERED' } };
  if (err instanceof InsufficientCreditError) {
    return { status: 402, body: { success: false, error: '자동 마케팅 시작에 필요한 크레딧이 부족합니다. 크레딧을 충전해 주세요.', code: 'INSUFFICIENT_CREDIT' } };
  }
  // ★ 2026-10-24 등록 한 트랜잭션(registerOperator) — 같은 키가 남의 행 = 409 · 차감 확인 실패 = 503(등록도 없다)
  if (err instanceof OperatorRegisterConflictError) return { status: 409, body: { success: false, error: err.message, code: err.code } };
  if (err instanceof OperatorChargeError) return { status: 503, body: { success: false, error: err.message, code: err.code } };
  if (err instanceof OperatorPairingError) return { status: 400, body: { success: false, error: err.message, code: err.code } };
  if (err instanceof OperatorScheduleChangedError) return { status: 409, body: { success: false, error: err.message, code: err.code } };
  const msg = err?.message || '';
  if (err?.code === 'DB_MIGRATION_PENDING' || err?.code === '42P01') {
    return { status: 503, body: { success: false, error: '지난번과 달라진 점을 찾는 조건은 준비 중입니다. 다른 조건으로 저장해 주세요.', code: 'DB_MIGRATION_PENDING' } };
  }
  if (msg.includes('column') && msg.includes('does not exist')) {
    return { status: 503, body: { success: false, error: 'DB 마이그레이션이 필요합니다. 운영자에게 continuous_operators 컬럼 추가(ALTER)를 요청해주세요.', code: 'DB_MIGRATION_PENDING' } };
  }
  return null;
}

// ── 직접 쓴 문안의 %칸% (Q18) ──

/** 직접 쓴 문안의 %칸% 검사 — 값이 있는 칸만 쓸 수 있다(빈 이름이 나가지 않게). available = 칩으로 보여 줄 칸 */
export async function checkFixedCopyVariables(
  companyId: string,
  customerSchema: any,
  subject: string,
  body: string,
): Promise<{ available: string[]; empty: string[]; unknown: string[] }> {
  const { fieldMappings, availableVars } = extractVarCatalog(customerSchema);
  const all = new Set(Object.keys(fieldMappings));
  const live = [...availableVars];
  await filterVarCatalogByData({ ...fieldMappings }, live, companyId);
  const liveSet = new Set(live);
  const tokens = [...new Set([...`${subject}\n${body}`.matchAll(/%([^%\s]{1,20})%/g)].map((m) => m[1]))];
  return {
    available: live,
    empty: tokens.filter((t) => all.has(t) && !liveSet.has(t)),
    unknown: tokens.filter((t) => !all.has(t)),
  };
}

// ── 미리보기 보관 ──
// ponytail: 프로세스 메모리 보관(pm2 fork 1개) · 재시작 = 만료(시작 요청 410 · 차감 0 · 다시 제안 받기). 프로세스를 늘리면 DB 보관으로.
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const PREVIEW_MAX = 500;
export const PREVIEW_EXPIRED_MESSAGE = '미리보기가 만료됐어요. 다시 [제안 받기]를 눌러 주세요.';
export const START_STATE_UNKNOWN_MESSAGE = '자동 마케팅은 시작했어요. 첫 제안이 저장됐는지 확인하지 못했으니 승인할 제안 목록을 다시 열어 확인해 주세요.';

interface PreviewEntry {
  companyId: string;
  userId: string;
  /** 등록 입력(계약 · 문안 분기 포함) — 시작은 이것만 쓴다(화면 값으로 다시 만들지 않는다) */
  input: CreateOperatorInput;
  /** 대상 번역 결과(창 편집으로 바뀐다 · 서버가 검증한 값) */
  translation: AudienceTranslation;
  /** AI 문안 결과 = 첫 회차. null = 직접 쓴 문안 · 변화 축 · 아직 없음 */
  result: any | null;
  /** 결과를 만들 때의 문안 입력 지문 — 지금 지문과 다르면 결과는 묵은 것(시작 잠금 · [이 대상으로 다시 만들기]) */
  resultPrint: string | null;
  appliedSegment: { key: string; label: string } | null;
  createdAt: number;
  /** 실행 중 자동 마케팅의 승인 창이면 그 운영자(문안은 회차가 만든다 · 시작이 아니라 승인) */
  operatorId: string | null;
  /** 판 번호 — 편집마다 1 증가. 시작 · 승인은 화면이 본 판일 때만(본 것 = 저장한 것 · Codex 2R) */
  rev: number;
  /** 화면에 마지막으로 보여 준 승인 기간 시작 — 발송 시각을 넘겨 기간이 바뀌면 판을 올리고 다시 확인받는다(Codex 3R) */
  shownStart: string | null;
  /** ★ 1024 화면 키(한 줄마다 하나) — 5 의 원장 키 재료 · 같은 키 /preview = 이 보관본 그대로(AI 0 · 차감 0) */
  screenKey: string | null;
  /** ★ 1024 사람이 쓴 주기인가(한 줄의 주기 말 · 세부 설정) — ③ 짝 질문은 이때만 */
  scheduleWritten: boolean;
  /** ★ 1024 ④ 혜택 질문(답하면 null) */
  benefitAsk: { reason: 'missing' | 'mixed'; prefill: string | null } | null;
  /** ★ 1024 지금 질문표(서버가 만든 것 · 답은 이것으로만 검증) */
  questions: OperatorQuestion[];
  /** ★ 1024 옮기고 알린 것(시각 · 한 줄에서 읽은 혜택) — 결과 문장 아래 한 줄씩 */
  notes: string[];
  /** ★ 1024 이 보관본을 만든 요청 본문의 지문 — 같은 화면 키라도 본문이 다르면 재사용하지 않는다(Codex 1R) */
  bodyPrint: string;
  /** ★ 1024 이 창에서 ③ · ② 답으로 주기를 「매월로」 바꿨다 — 승인 창 저장이 이때만 주기를 넘긴다(그 밖 = 지금 저장된 주기 그대로 · 옛 창 값으로 덮지 않는다) */
  scheduleAnswered?: true;
  /** ★ 1024 승인 창을 열 때 운영자의 일정 — 승인 저장이 잠근 행과 비교한다(창을 연 뒤 바뀌었으면 409) */
  scheduleSeen?: OperatorScheduleShape;
}
const previews = new Map<string, PreviewEntry>();
/** ★ 1024 화면 키 → 미리보기 id(같은 키 재전송 = 같은 보관본 · 회의론자 §9-5b) */
const previewByKey = new Map<string, string>();
const inflight = new Set<string>();
const keyRef = (companyId: string, userId: string, screenKey: string) => `${companyId}:${userId}:${screenKey}`;
/** 화면 키 모양(영숫자 · 하이픈 8~64자) — 아니면 키 없음(옛 화면 = 지금 그대로) */
function screenKeyOf(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(raw) ? raw : null;
}

export class PreviewBusyError extends Error {}
export class PreviewInputError extends Error {}
/** 화면이 본 판이 아니다(409) — 지금 상태(current)를 돌려줘 화면이 바꾸고 사용자가 다시 확인한다 */
export class PreviewStaleError extends Error {
  constructor(message: string, public current: PreviewOutcome | null) { super(message); }
}
export const PREVIEW_STALE_MESSAGE = '창이 최신 상태가 아니었어요. 지금 상태로 바꿨으니 확인하고 다시 눌러 주세요.';
export const APPROVAL_EXPIRED_MESSAGE = '승인 창이 만료됐어요. 실행 중 목록에서 다시 열어 주세요.';
export const PREVIEW_WINDOW_MOVED_MESSAGE = '발송 시각이 지나 승인 기간이 바뀌었어요. 바뀐 기간을 확인하고 다시 눌러 주세요.';

/**
 * 화면에 보여 줄 결과 — 보여 준 승인 기간을 보관본에 남긴다. 이미 보여 준 기간과 다르면 판을 올린다(이 함수 한 곳 · Codex 4R).
 *   어느 응답 경로(편집 · 409 · 시작 · 승인)로 새 기간이 나가도 판이 함께 바뀌어, 그 기간을 못 본 화면의 판으로는 저장되지 않는다.
 */
function shown(e: PreviewEntry, out: PreviewOutcome): PreviewOutcome {
  if (e.shownStart != null && out.window.startAt !== e.shownStart) {
    e.rev += 1;
    out = { ...out, revision: e.rev };
  }
  e.shownStart = out.window.startAt;
  return out;
}

/** 시작 · 승인 직전 확인 — 화면이 본 판 · 본 승인 기간일 때만. 아니면 지금 상태(판을 올린)를 돌려준다(409). */
function assertSeen(e: PreviewEntry, out: PreviewOutcome, revision: unknown): void {
  const moved = out.window.startAt !== e.shownStart;
  if (moved || revision !== e.rev) {
    throw new PreviewStaleError(moved ? PREVIEW_WINDOW_MOVED_MESSAGE : PREVIEW_STALE_MESSAGE, shown(e, out));
  }
}

/** 화면이 확인한 승인 기간(저장은 이것 그대로 · 지금 시각으로 다시 계산하지 않는다) */
function confirmedWindow(out: PreviewOutcome): { startAt: Date; until: Date; rounds: Date[] } {
  return { startAt: new Date(out.window.startAt), until: new Date(out.window.until), rounds: out.window.rounds.map((d) => new Date(d)) };
}

function dropPreview(id: string): void {
  const e = previews.get(id);
  if (e?.screenKey) {
    const k = keyRef(e.companyId, e.userId, e.screenKey);
    if (previewByKey.get(k) === id) previewByKey.delete(k);
  }
  previews.delete(id);
}

function putPreview(entry: PreviewEntry): string {
  const now = Date.now();
  for (const [id, e] of previews) if (now - e.createdAt > PREVIEW_TTL_MS) dropPreview(id);
  while (previews.size >= PREVIEW_MAX) dropPreview(previews.keys().next().value as string);
  const id = randomUUID();
  previews.set(id, entry);
  if (entry.screenKey) previewByKey.set(keyRef(entry.companyId, entry.userId, entry.screenKey), id);
  return id;
}

/** 꺼내는 순간 지운다(같은 미리보기로 두 번 등록 금지). 없음 · 남의 것 · 만료 = null(남의 것은 지우지 않는다) */
export function takePreview(id: string, companyId: string, userId: string): PreviewEntry | null {
  const e = previews.get(id);
  if (!e || e.companyId !== companyId || e.userId !== userId) return null;
  dropPreview(id);
  return Date.now() - e.createdAt > PREVIEW_TTL_MS ? null : e;
}

/** 창 편집용 — 지우지 않고 본다(주인 · 만료 검사는 같다) */
function peekPreview(id: string, companyId: string, userId: string): PreviewEntry | null {
  const e = previews.get(id);
  if (!e || e.companyId !== companyId || e.userId !== userId) return null;
  if (Date.now() - e.createdAt > PREVIEW_TTL_MS) { dropPreview(id); return null; }
  return e;
}

async function withLock<T>(companyId: string, userId: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = `${companyId}:${userId}`;
  if (inflight.has(lockKey)) throw new PreviewBusyError('앞서 누른 작업을 처리하는 중이에요. 끝난 뒤 다시 눌러 주세요.');
  inflight.add(lockKey);
  try { return await fn(); } finally { inflight.delete(lockKey); }
}

// ── 응답 모양 ──

export interface PreviewOutcome {
  /**
   * proposal = 시작 가능(AI 문안 · 직접 쓴 문안) · baseline = 변화 축(첫 회차는 기준만) · zero = 지금 대상 0명(시작 불가 · 차감 0)
   * questions = 여쭤볼 것이 있다(상태 A · 답하기 전 0크레딧) · needs_choice = 칸을 골라야 한다(승인 창) · blocked = 막힘(데이터 없음 · 080 · 발신번호)
   */
  kind: 'proposal' | 'baseline' | 'zero' | 'needs_choice' | 'blocked' | 'questions';
  /** ★ 1024 여쭤볼 것(상태 A) — 비면 상태 B */
  questions: OperatorQuestion[];
  /** ★ 1024 옮기고 알린 것(시각 · 읽은 혜택 · 문안에서 뺀 날짜 말) */
  notes: string[];
  /** ★ 1024 막힘 갈래(080 · 발신번호 · 데이터) — 화면이 등록 화면으로 안내한다 */
  blockCode: string | null;
  /** ★ 1024 문안 입력(대상 칸 · 혜택 · 채널 · 문안 방식)이 바뀌어 문안이 묵었다 — 시작 잠금 + [이 대상으로 다시 만들기] */
  copyStale: boolean;
  /** ★ 1024 보내는 번호 · 알림 받는 번호(추천으로 정한 값 · 화면이 [바꾸기]) */
  sendVia: { callback: string | null; adminPhone: string | null };
  /** ★ 1024 문안 안마다 나가는 글(혜택 · (광고) · 080 · operatorFinalCopy) — 화면은 AI 원문 대신 이것을 보여 준다 */
  finalCopies: Array<OperatorFinalCopy | null> | null;
  /** ★ 1024 돈(서버 값 · 화면 상수 0) — 시작 · 문안 */
  costs: { start: number; copy: number; send: number };
  previewId: string | null;
  proposal: any | null;
  reason: string | null;
  /** 시작 버튼을 켤 수 있는가(서버 판정) */
  ready: boolean;
  /** 보관본 판 번호 — 편집 · 시작 · 승인 때 그대로 돌려보낸다 */
  revision: number;
  audience: {
    mode: 'axis' | 'filters' | 'none';
    label: string | null;
    description: string | null;
    conditions: AudienceCondition[];
    unresolved: Array<{ term: string; operator?: string; value?: any }>;
    options: AudienceFieldOption[];
    mapped: boolean;
    suggestKey: string | null;
  };
  count: number | null;
  forecast: Array<{ date: string; count: number }> | null;
  window: { startAt: string; until: string; rounds: string[]; schedule: string; scheduleTime: string };
  copy: { mode: 'ai' | 'fixed'; subject: string; body: string; benefit: string | null; variables: string[] };
  limits: { maxRecipients: number; maxCost: number; unitCost: number; channel: string };
  appliedSegment: { key: string; label: string } | null;
  segment: { key: string | null; params: Record<string, number> | null };
}

function windowFor(input: CreateOperatorInput, now: Date = new Date()) {
  const v = validateOperatorInput(input);
  const op = {
    schedule: v.schedule,
    scheduleTime: v.scheduleTime,
    scheduleDayOfWeek: v.schedule === 'weekly' && input.scheduleDayOfWeek != null ? input.scheduleDayOfWeek : null,
    scheduleDayOfMonth: (v.schedule === 'monthly' || v.schedule === 'yearly') && input.scheduleDayOfMonth != null ? input.scheduleDayOfMonth : null,
    scheduleMonth: v.scheduleMonth,
  };
  return { ...computeApprovalWindow(op as any, now), schedule: v.schedule, scheduleTime: v.scheduleTime };
}

/** 번역 결과를 등록 입력의 계약 칸에 싣는다(축 ↔ 칸 조건 상호배타 · 옛 힌트 해제) */
function applyTranslation(input: CreateOperatorInput, tr: AudienceTranslation): CreateOperatorInput {
  if (tr.kind === 'axis') return { ...input, segmentKey: tr.segmentKey, segmentParams: tr.segmentParams, audienceConditions: null, targetHint: null };
  if (tr.kind === 'filters') return { ...input, segmentKey: null, segmentParams: null, audienceConditions: tr.conditions, targetHint: null };
  return { ...input, segmentKey: null, segmentParams: null, audienceConditions: null, targetHint: null };
}

/** 대상 수 · 날짜별 예상(생일 · 매일) · 변화 축 여부 */
async function measureEntry(e: PreviewEntry, win: { startAt: Date }) {
  const tr = e.translation;
  if (tr.kind !== 'axis' && tr.kind !== 'filters') return { count: null as number | null, forecast: null as any, baseline: false };
  const key = tr.kind === 'axis' ? tr.segmentKey : null;
  if (key && segmentNeedsCycleBaseline(key)) return { count: null, forecast: null, baseline: true };
  const schedule = e.input.schedule || 'daily';
  const owner = e.input.createdBy || e.userId;   // 매장 범위 · 수신동의 = 회차와 같은 사람(승인 창은 보는 사람이 달라도 운영자 주인)
  const forecast = await forecastByDate({ companyId: e.companyId, ownerUserId: owner, schedule, segmentKey: key, startAt: win.startAt, days: 7 });
  const count = forecast
    ? forecast.reduce((s, d) => s + d.count, 0)
    : await countContractAudience({
      companyId: e.companyId, ownerUserId: owner, schedule,
      segmentKey: key, segmentParams: tr.kind === 'axis' ? tr.segmentParams : null,
      conditions: tr.kind === 'filters' ? tr.conditions : null, anchor: win.startAt,
    });
  return { count, forecast, baseline: false };
}

/** AI 문안(첫 회차) — 허브와 같은 키(5) · 대상 0명이면 차감 0. anchor = 문안을 만들 회차(생일 = 생일자가 있는 첫날) */
async function generateCopy(e: PreviewEntry, loaded: OperatorCompanyContext, anchor: Date): Promise<any> {
  const fields = operatorContextFields(e.input);
  // ★ 1024 요청 키 = 화면 키 + 문안 입력 지문(같은 화면 · 같은 입력의 재전송 = 차감 0 · 입력이 바뀌면 새 5) · 잔액이 모자라면 결과를 내주지 않는다(402)
  const key = e.screenKey
    ? `ai-operator-propose:${e.companyId}:${createHash('sha256').update(`${e.userId}|${e.screenKey}|${copyPrint(e)}`).digest('hex').slice(0, 32)}`
    : undefined;
  const result = await orchestrate(
    buildOperatorOrchestrateContext({ ...fields, id: null, anchorAt: anchor }, loaded),
    { source: 'ai-operator-propose', cost: getCreditCost('ai-operator-propose'), chargeOnlyWithTarget: true, idempotencyKey: key, throwOnInsufficient: true },
  );
  if ((result.messages?.length || 0) === 0) throw new UserFacingError(502, 'AI_RESULT_EMPTY', '문안을 만들지 못했어요. 잠시 뒤 다시 해 주세요.');
  return result;
}

/**
 * 문안 입력 지문 — 대상 칸(축 key · 칸 · 연산자 · **값 제외**) · 혜택 · 채널 · 문안 방식 · 문안 스타일.
 *   기준 숫자(값)는 0크레딧으로 다시 센다(회의론자 §9-6). 이 지문이 바뀌면 만든 문안은 묵은 것이다(N5 · 「VIP 고객님께」 문안이 휴면 고객에게).
 */
function copyPrint(e: PreviewEntry): string {
  const tr = e.translation;
  const contract = tr.kind === 'axis' ? { k: tr.segmentKey }
    : tr.kind === 'filters' || tr.kind === 'needs_choice' ? { c: tr.conditions.map((c) => `${c.field}:${c.operator}`).sort() } : {};
  return createHash('sha256').update(JSON.stringify({
    ...contract,
    b: normalizeOperatorBenefit(e.input.benefitContent),
    ch: normalizeOperatorChannel(e.input.channel),
    m: e.input.copyMode === 'fixed' ? 'fixed' : 'ai',
    st: e.input.copyStyle ?? null,
  })).digest('hex').slice(0, 16);
}

interface PreviewBlock { code: string; reason: string }

/** 계정 휴대폰(담당자 알림 기본값 · 등록과 같은 판정) */
async function accountPhone(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const r = await query(`SELECT phone FROM users WHERE id = $1::uuid`, [userId]);
  const d = String(r.rows[0]?.phone || '').replace(/\D/g, '');
  return /^01\d{8,9}$/.test(d) ? d : null;
}

/**
 * ★ 1024 질문표 · 막힘을 다시 정한다(편집마다 · 질문은 순수 함수 · 사실은 DB). 추천으로 정한 값(회신번호 후보 하나 · 계정 휴대폰)은
 *   보관본 입력에 적는다(빈 칸에 기대지 않는다 · 회의론자 §9-13). 승인 창(실행 중) = 대상 질문만(번호 · 혜택은 이미 정해져 있다).
 */
async function settleQuestions(e: PreviewEntry): Promise<PreviewBlock | null> {
  const owner = e.input.createdBy || e.userId;
  const renewal = !!e.operatorId;
  let block: PreviewBlock | null = null;
  let callbackCandidates: string[] | null = null;
  let adminPhoneMissing = false;
  if (!renewal) {
    const demo = await isDemoCompany(e.companyId);   // 시연 회사 = 실제로 보내지 않는다(발송 경로와 같은 판정)
    if (!demo && !(await getOpt080Number(owner, e.companyId))) {
      block = { code: 'OPT080_MISSING', reason: '광고 문자 끝에 넣을 무료거부 번호(080)가 없어 시작할 수 없어요. 설정에서 080 번호를 등록하면 바로 시작할 수 있어요.' };
    }
    if (!block && !demo && !e.input.callback) {
      const ch = await listOperatorCallbackChoices(e.companyId, owner);
      if (!ch.defaultNumber) {
        if (ch.candidates.length === 0) {
          block = { code: 'CALLBACK_MISSING', reason: '보낼 발신번호가 등록돼 있지 않아 시작할 수 없어요. 회사 관리자가 「관리」 메뉴에서 발신번호를 등록하면 바로 시작할 수 있어요.' };
        } else if (ch.candidates.length === 1) {
          e.input = { ...e.input, callback: { callbackNumber: ch.candidates[0], useIndividualCallback: false } };
        } else {
          callbackCandidates = ch.candidates;
        }
      }
    }
    if (!(e.input.adminPhoneNumbers && e.input.adminPhoneNumbers.length > 0)) {
      const phone = await accountPhone(owner);
      if (phone) e.input = { ...e.input, adminPhoneNumbers: [phone] };
      else adminPhoneMissing = true;
    }
  }
  const tr = e.translation;
  const needAxes = (tr.kind === 'blocked' && (tr.code === 'NO_CONDITION' || tr.code === 'TRANSLATE_FAILED'))
    || (tr.kind === 'axis' && tr.segmentKey === 'all' && tr.mapped);
  const axes = needAxes
    ? (await listSegmentAvailability(e.companyId)).map((a) => ({ key: a.key, label: a.label, available: a.available, reason: a.reason }))
    : [];
  const everyoneCount = needAxes
    ? await countContractAudience({ companyId: e.companyId, ownerUserId: owner, schedule: 'monthly', segmentKey: 'all' }).catch(() => null)
    : null;
  e.questions = buildOperatorQuestions({
    translation: tr, axes, everyoneCount,
    schedule: e.input.schedule || 'monthly',
    benefitAsk: renewal ? null : e.benefitAsk,
    callbackCandidates, adminPhoneMissing,
  });
  return block;
}

/**
 * 미리보기를 한 번 계산한다(새로 만들기 · 창 편집 공용).
 *   ★ 1024 문안은 copyStep 'generate' 일 때만 만든다 — 상태 A [이대로 첫 문안 보기] · [이 대상으로 다시 만들기] · 질문 없는 첫 한 줄.
 *   그 밖 편집은 'existing'(문안 0 · 다시 세기만 · 회의론자 §9-6). 질문이 남으면 상태 A(문안 · 차감 0).
 *   0명(축 · 칸 조건 · 지금 기준) = 시작 불가 · 차감 0. 생일 · 매일은 7일 예상이 기준(0명인 날은 정상).
 */
async function refreshEntry(
  e: PreviewEntry,
  previewId: string | null,
  /** generate = 필요하면 AI 문안을 만든다 · existing = 만들지 않고 있는 것만(돈 0) · skip = 문안 없이(승인 창 · 회차가 만든다) */
  copyStep: 'generate' | 'existing' | 'skip' = 'existing',
): Promise<PreviewOutcome> {
  const loaded = await loadOperatorCompanyContext(e.companyId);
  if (!loaded) throw new PreviewInputError('회사 정보를 찾을 수 없습니다.');
  const block = await settleQuestions(e);
  const win = windowFor(e.input);
  const tr = e.translation;
  const channel = normalizeOperatorChannel(e.input.channel);
  const costs = getCompanyCosts(loaded.companyInfo as any) as Record<string, number>;
  const copyMode: 'ai' | 'fixed' = e.input.copyMode === 'fixed' ? 'fixed' : 'ai';
  const vars = await checkFixedCopyVariables(e.companyId, loaded.companyInfo.customer_schema, e.input.fixedCopy?.subject || '', e.input.fixedCopy?.body || '');
  const print = copyPrint(e);
  const stale = !!e.result && e.resultPrint !== print;
  const dated = copyMode === 'ai' ? datedTerms(e.input.objective, e.input.schedule) : [];

  const base: Omit<PreviewOutcome, 'kind' | 'previewId' | 'proposal' | 'reason' | 'ready' | 'count' | 'forecast'> = {
    questions: e.questions,
    finalCopies: null,
    notes: [...e.notes, ...dated.map((w) => `「${w}」은(는) 회차마다 지나가는 날짜라 문안에서 뺐어요.`)],
    blockCode: block?.code ?? (tr.kind === 'blocked' ? tr.code : null),
    copyStale: false,
    sendVia: { callback: e.input.callback?.callbackNumber ?? null, adminPhone: e.input.adminPhoneNumbers?.[0] ?? null },
    costs: { start: getCreditCost('continuous-operator'), copy: getCreditCost('ai-operator-propose'), send: getCreditCost('continuous-operator-send') },
    audience: {
      mode: tr.kind === 'axis' ? 'axis' : tr.kind === 'filters' ? 'filters' : 'none',
      label: tr.kind === 'axis' ? tr.label : null,
      description: tr.kind === 'axis' ? tr.description : tr.kind === 'filters' ? describeConditions(tr.conditions) : null,
      conditions: tr.kind === 'filters' || tr.kind === 'needs_choice' ? tr.conditions : [],
      unresolved: tr.kind === 'needs_choice' ? tr.unresolved : [],
      // 칸 조건이면 [다른 칸 고르기] 목록(값 있는 칸 · DB 근거)도 싣는다
      options: tr.kind === 'needs_choice' ? tr.options : tr.kind === 'filters' ? (await loadAudienceFieldOptions(e.companyId)).options : [],
      mapped: tr.kind === 'axis' ? tr.mapped : tr.kind === 'filters' ? tr.conditions.some((c) => c.source === 'ai') : false,
      suggestKey: tr.kind === 'blocked' ? (tr.suggestKey ?? null) : null,
    },
    window: { startAt: win.startAt.toISOString(), until: win.until.toISOString(), rounds: win.rounds.map((r) => r.toISOString()), schedule: win.schedule, scheduleTime: win.scheduleTime },
    copy: {
      mode: copyMode,
      subject: e.input.fixedCopy?.subject || '',
      body: e.input.fixedCopy?.body || '',
      benefit: normalizeOperatorBenefit(e.input.benefitContent),
      variables: vars.available,
    },
    limits: {
      maxRecipients: Number(loaded.ctx.cdp_auto_execute_max_recipients) || 0,
      maxCost: Number(loaded.ctx.cdp_auto_execute_max_cost_krw) || 0,
      unitCost: Number(costs[channel]) || Number(costs.sms) || 0,
      channel: channel.toUpperCase(),
    },
    appliedSegment: e.appliedSegment,
    segment: { key: tr.kind === 'axis' ? tr.segmentKey : null, params: tr.kind === 'axis' ? tr.segmentParams : null },
    revision: e.rev,
  };
  const none = { proposal: null, count: null, forecast: null };
  // 보여 줄 문안 = 나가는 글(혜택 · (광고) · 080) — 결과가 있을 때만 080 · 회신번호를 읽는다
  const finalsOf = async (result: any): Promise<Array<OperatorFinalCopy | null> | null> => {
    if (!result || !Array.isArray(result.messages)) return null;
    const owner = e.input.createdBy || e.userId;
    const cb = e.input.callback?.callbackNumber || (await listOperatorCallbackChoices(e.companyId, owner).catch(() => ({ defaultNumber: null }))).defaultNumber || '';
    const opt080 = await getOpt080Number(owner, e.companyId).catch(() => '');
    return finalCopiesOf(result, { benefit: e.input.benefitContent ?? null, opt080, callback: cb });
  };
  // 직접 쓴 문안 = 문안이 있고 값 없는 %칸% 이 없어야 시작 · 승인(기준 축도 같다)
  const fixedText = e.input.fixedCopy?.body || '';
  const badVars = [...vars.empty, ...vars.unknown];
  const fixedReason = !fixedText ? '보낼 문안을 넣어 주세요.'
    : badVars.length > 0 ? `%${badVars.join('% · %')}% 칸은 값이 없어 쓸 수 없어요. 넣을 수 있는 칸만 써 주세요.` : null;

  if (block) return { ...base, ...none, kind: 'blocked', previewId, reason: block.reason, ready: false };
  if (e.questions.length > 0) return { ...base, ...none, kind: 'questions', previewId, reason: null, ready: false };
  if (tr.kind === 'blocked') return { ...base, ...none, kind: 'blocked', previewId, reason: tr.reason, ready: false };
  if (tr.kind === 'needs_choice') {
    const terms = tr.unresolved.map((u) => `「${u.term}」`).join(' · ');
    return { ...base, ...none, kind: 'needs_choice', previewId, reason: `${terms}을(를) 어느 칸으로 판단할지 골라 주세요. 값이 있는 칸만 고를 수 있어요.`, ready: false };
  }

  const m = await measureEntry(e, win);
  if (m.baseline) {
    return { ...base, ...none, kind: 'baseline', previewId, reason: copyMode === 'fixed' ? fixedReason : null, ready: copyMode === 'ai' || !fixedReason };
  }
  if (!m.forecast && (m.count || 0) === 0) {
    return { ...base, ...none, kind: 'zero', previewId, reason: '지금 조건에 맞는 고객이 없어요. 조건을 임의로 넓혀서 보내지 않아요. 기준을 고치거나 다른 대상을 골라 주세요.', ready: false, count: 0 };
  }
  const counted = { count: m.count, forecast: m.forecast };
  if (copyMode === 'fixed') return { ...base, ...counted, kind: 'proposal', previewId, proposal: null, reason: fixedReason, ready: !fixedReason };
  if (copyStep === 'skip') return { ...base, ...counted, kind: 'proposal', previewId, proposal: null, reason: null, ready: true };
  if (e.result && !stale) return { ...base, ...counted, kind: 'proposal', previewId, proposal: e.result, finalCopies: await finalsOf(e.result), reason: null, ready: true };

  // 문안이 없거나 묵었다 — 생일 · 매일 = 생일자가 있는 첫날 기준
  const firstDay = m.forecast ? m.forecast.findIndex((d: { count: number }) => d.count > 0) : 0;
  if (firstDay < 0) {
    // 7일 내내 생일 고객이 없다 — 미리 보여 줄 문안이 없다(차감 0). 시작하면 생일 고객이 있는 날 그날 문안을 만든다.
    e.result = null;
    return { ...base, ...counted, kind: 'proposal', previewId, proposal: null, reason: '앞으로 7일 동안 대상 고객이 없어 미리 보여 드릴 문안이 없어요. 시작하면 대상이 있는 날 그날 문안을 만들어 보내요.', ready: true };
  }
  if (copyStep === 'existing') {
    return {
      ...base, ...counted, kind: 'proposal', previewId,
      proposal: stale ? e.result : null,
      finalCopies: stale ? await finalsOf(e.result) : null,
      copyStale: stale,
      reason: stale ? '받는 분이나 혜택이 바뀌어 문안을 다시 만들어야 시작할 수 있어요.' : '문안을 아직 만들지 않았어요.',
      ready: false,
    };
  }
  const anchor = new Date(win.startAt.getTime() + firstDay * 24 * 60 * 60 * 1000);
  e.result = await generateCopy(e, loaded, anchor);
  e.resultPrint = print;
  return { ...base, ...counted, kind: 'proposal', previewId, proposal: e.result, finalCopies: await finalsOf(e.result), reason: null, ready: true };
}

/** 가장 빨리 첫 회차가 나가는 날(KST) — 오늘 그 시각 전이면 오늘 · 지났으면 내일(주재자 판정 1) */
function earliestRoundDay(time: string, now: Date): { dow: number; dom: number } {
  const k = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const [h, mi] = String(time || '09:00').split(':').map((v) => parseInt(v, 10) || 0);
  const passed = k.getUTCHours() * 60 + k.getUTCMinutes() >= h * 60 + mi;
  const d = passed ? new Date(k.getTime() + 24 * 60 * 60 * 1000) : k;
  return { dow: d.getUTCDay(), dom: d.getUTCDate() };
}

/**
 * 한 줄의 주기 → 등록 본문 칸(★ 1024 · 설계서 §1-1). 주기 말이 없으면 매월(written = false · 번역 뒤 생일 축이면 매일로 바뀐다).
 *   날 = 가장 빨리 첫 회차가 나가는 날 · 시각 = 한 줄의 시각(주기 말이 없어도) → 없으면 09:00 · 발송 가능 시간 밖이면 옮긴다(검증 전 · §9-16).
 */
export function scheduleBodyFromText(objective: string, body: any, now: Date = new Date()): {
  fields: Record<string, any>; written: boolean; moved: { from: string; to: string } | null;
} {
  const s = parseScheduleFromText(objective);
  const rawTime = s?.scheduleTime || parseTimeFromText(objective) || (typeof body?.schedule_time === 'string' && body.schedule_time) || '09:00';
  const c = clampToSendableTime(rawTime, SEND_HOURS.start, SEND_HOURS.end);
  const day = earliestRoundDay(c.time, now);
  const schedule = s?.schedule || 'monthly';
  return {
    fields: {
      schedule,
      schedule_day_of_week: schedule === 'weekly' ? (s?.scheduleDayOfWeek ?? day.dow) : null,
      schedule_day_of_month: schedule === 'monthly' ? (s?.scheduleDayOfMonth ?? day.dom) : null,
      schedule_time: c.time,
    },
    written: !!s,
    moved: c.moved ? { from: rawTime, to: c.time } : null,
  };
}

/** 번역 → 보관본(★ 1024 번역은 늘 매월로 · 짝 판정은 질문표가 지금 주기로 한 번만 · §9-12) */
async function retranslate(
  e: PreviewEntry,
  x: { segmentKey?: string | null; segmentParams?: Record<string, number> | null; conditions?: Array<{ term?: string; field: string; operator: string; value: any }> | null },
): Promise<void> {
  try {
    e.translation = await translateAudience({
      companyId: e.companyId, userId: e.userId, objective: e.input.objective, schedule: 'monthly',
      segmentKey: x.segmentKey ?? null, segmentParams: x.segmentParams ?? null, conditions: x.conditions ?? null,
      carry: e.translation,   // 창의 말(term)은 빠지지 않는다
    });
  } catch (err: any) {
    if (err instanceof AudienceConditionError) throw new PreviewInputError(err.message);
    throw err;
  }
  e.input = applyTranslation(e.input, e.translation);
  e.appliedSegment = null;   // 사람이 고른 계약 — AI 가 고정했다는 안내는 더 이상 맞지 않는다
}

/**
 * 추천 주기(사람이 주기를 쓰지 않았을 때만) — 대상이 바뀔 때마다 다시 정한다(Codex 1R: 생일 → 전체로 바꾸면 매일이 남아 짝을 우회했다).
 *   생일 축 = 생일인 날(매일 · 생일은 반복 축이 아니다) · 그 밖 = 매월(가장 빨리 나가는 날).
 */
function birthdayDefault(e: PreviewEntry): void {
  if (e.scheduleWritten) return;
  const tr = e.translation;
  if (tr.kind === 'axis' && tr.segmentKey === 'birthday') {
    e.input = { ...e.input, schedule: 'daily', scheduleDayOfWeek: null, scheduleDayOfMonth: null };
  } else if (e.input.schedule !== 'monthly') {
    e.input = { ...e.input, schedule: 'monthly', scheduleDayOfWeek: null, scheduleDayOfMonth: earliestRoundDay(e.input.scheduleTime || '09:00', new Date()).dom };
  }
}

/**
 * 한 줄의 혜택 → 보관본(★ 1024 · 사람 글만 · listenLine). AI 가 쓴 목표(오늘의 추천 · 캘린더) = 읽은 조각 취급(채움 0 · 값이 없으면 묻는다).
 *   허용 꼴 하나 = 칸에 채우고 알린다 · 행사 말인데 값 없음 = ④ 묻기 · 값이 조건과 섞임 = ④ 사람 글 조각을 채운 글 칸.
 */
function readLineBenefit(e: PreviewEntry, objectiveFromAi: boolean): void {
  if (e.input.copyMode === 'fixed' || normalizeOperatorBenefit(e.input.benefitContent)) return;   // 직접 쓴 문안 · 화면이 적어 보낸 혜택
  const intent = listenLine(e.input.objective, objectiveFromAi ? { reads: [e.input.objective] } : {});
  if (intent.benefit) {
    e.input = { ...e.input, benefitContent: intent.benefit };
    e.notes.push(`적어 주신 혜택 「${intent.benefit}」만 실어요.`);
  } else if (intent.gaps.benefit || (intent.concreteBenefit && !intent.typed.trim())) {
    e.benefitAsk = { reason: 'missing', prefill: null };
  } else if (intent.concreteBenefit) {
    e.benefitAsk = { reason: 'mixed', prefill: lineBenefitFragments(intent.typed) };
  }
}

/** [제안 받기] — 등록 없이 첫 회차와 같은 계산. 같은 회사 · 같은 사람의 동시 요청은 PreviewBusyError(409) */
export async function runOperatorPreview(companyId: string, userId: string, body: any): Promise<PreviewOutcome> {
  return withLock(companyId, userId, async () => {
    // ★ 1024 같은 화면 키 = 그 보관본 그대로(AI 0 · 차감 0 · 응답을 못 받은 재전송 · 회의론자 §9-5b)
    const screenKey = screenKeyOf(body?.request_key);
    const bodyPrint = createHash('sha256').update(JSON.stringify({ ...(body || {}), request_key: undefined })).digest('hex').slice(0, 16);
    if (screenKey) {
      const hitId = previewByKey.get(keyRef(companyId, userId, screenKey));
      const hit = hitId ? peekPreview(hitId, companyId, userId) : null;
      // 같은 화면 키 + 같은 본문 = 그 보관본(재전송) · 본문이 다르면 새 보관본(바뀐 설정이 옛 미리보기로 대체되지 않게)
      if (hitId && hit && !hit.operatorId && hit.bodyPrint === bodyPrint) return shown(hit, await refreshEntry(hit, hitId, 'existing'));
    }
    // ★ 2026-10-05 한 줄 · 오늘의 추천 입구(infer_schedule) — 문장의 주기를 읽는다 · ★ 1024 시각은 검증 전에 발송 가능 시간 안으로 옮기고 알린다
    const notes: string[] = [];
    let scheduleWritten = true;
    if (body?.infer_schedule === true) {
      const r = scheduleBodyFromText(String(body?.objective || ''), body);
      body = { ...body, ...r.fields };
      scheduleWritten = r.written;
      if (r.moved) notes.push(`적어 주신 ${koreanTimeLabel(r.moved.from)}는 보낼 수 없는 시각이라 ${koreanTimeLabel(r.moved.to)}로 옮겼어요.`);
    }
    // 등록이 거절할 입력은 돈을 쓰기 전에 거른다(등록과 같은 검증 함수)
    const base = createOperatorInputFromBody(companyId, userId, body);
    try { validateOperatorInput(base as CreateOperatorInput); } catch (e: any) { throw new PreviewInputError(e?.message || '입력을 확인해 주세요.'); }
    let tr: AudienceTranslation;
    try {
      tr = await translateAudience({
        companyId, userId, objective: base.objective, schedule: 'monthly',   // 짝은 질문표가 지금 주기로 본다(§9-12)
        segmentKey: body?.segment_key, segmentParams: body?.segment_params, targetHint: body?.target_hint,
        conditions: Array.isArray(body?.audience_conditions) ? body.audience_conditions : null,
      });
    } catch (e: any) {
      if (e instanceof AudienceConditionError) throw new PreviewInputError(e.message);
      throw e;
    }
    const copyMode: 'ai' | 'fixed' = body?.copy_mode === 'fixed' ? 'fixed' : 'ai';
    const fixed = copyMode === 'fixed' ? normalizeFixedCopyInput({ subject: body?.fixed_subject, body: body?.fixed_body }) : null;
    // ★ 1024 회신번호 — 화면(세부 설정)이 골랐을 때만 온다(검사 = 등록과 같은 함수)
    const cb = body?.callback_number !== undefined || body?.use_individual_callback !== undefined
      ? await checkOperatorCallback(companyId, userId, { callbackNumber: body.callback_number, useIndividualCallback: body.use_individual_callback })
      : null;
    const input: CreateOperatorInput = applyTranslation({ ...(base as CreateOperatorInput), copyMode, fixedCopy: fixed, ...(cb ? { callback: cb } : {}) }, tr);
    const entry: PreviewEntry = {
      companyId, userId, input, translation: tr, result: null, resultPrint: null,
      appliedSegment: tr.kind === 'axis' && tr.mapped && tr.segmentKey !== 'all' ? { key: tr.segmentKey, label: tr.label } : null,
      createdAt: Date.now(), operatorId: null, rev: 0, shownStart: null,
      screenKey, scheduleWritten, benefitAsk: null, questions: [], notes, bodyPrint,
    };
    birthdayDefault(entry);
    readLineBenefit(entry, body?.objective_source === 'ai');
    const previewId = putPreview(entry);
    // 질문이 없을 때만 바로 문안(5) — 질문이 있으면 상태 A(0)
    return shown(entry, await refreshEntry(entry, previewId, 'generate'));
  });
}

/** ★ 1024 답(서버 질문표로 검증한 값) → 보관본 */
async function applyAnswers(e: PreviewEntry, a: ReturnType<typeof decideOperatorAnswers> & { ok: true }): Promise<void> {
  const ans = a.patch;
  const tr = e.translation;
  const picks = Object.entries(ans.fields);
  if (picks.length > 0 && tr.kind === 'needs_choice') {
    const add = picks.map(([term, field]) => {
      const u = tr.unresolved.find((x) => x.term === term);
      const o = tr.options.find((x) => x.field === field);
      const numeric = o?.dataType === 'number';
      return { term, field, operator: u?.operator || (numeric ? 'gte' : 'eq'), value: u?.value ?? (numeric ? 1 : (o?.samples[0] ?? '')) };
    });
    await retranslate(e, { conditions: [...tr.conditions.map((c) => ({ term: c.term, field: c.field, operator: c.operator, value: c.value })), ...add] });
  }
  if (ans.segmentKey) {
    await retranslate(e, { segmentKey: ans.segmentKey });
    birthdayDefault(e);
  }
  if (ans.schedule === 'monthly') {
    e.input = { ...e.input, schedule: 'monthly', scheduleDayOfWeek: null, scheduleDayOfMonth: earliestRoundDay(e.input.scheduleTime || '09:00', new Date()).dom };
    e.scheduleAnswered = true;
  }
  if (ans.benefit !== undefined) {
    e.input = { ...e.input, benefitContent: ans.benefit };
    e.benefitAsk = null;
  }
  if (ans.callback) e.input = { ...e.input, callback: await checkOperatorCallback(e.companyId, e.input.createdBy || e.userId, { callbackNumber: ans.callback }) };
  if (ans.adminPhone) e.input = { ...e.input, adminPhoneNumbers: [ans.adminPhone] };
}

/**
 * 창 편집 — 서버가 검증해 보관본에 반영하고 다시 센다.
 *   ★ 1024 문안은 둘에서만 만든다(5): 답(answers · 상태 A 버튼) · regenerate(상태 B [이 대상으로 다시 만들기] · AI 문안으로 바꾸기 · 혜택 고치고 다시 만들기).
 *   그 밖(칸 · 기준 숫자 · 주기 · 번호 · 직접 쓴 문안)은 문안 0 · 지문이 바뀌면 시작 잠금.
 */
export async function updateOperatorPreview(previewId: string, companyId: string, userId: string, patch: any): Promise<PreviewOutcome | null> {
  return withLock(companyId, userId, async () => {
    const e = peekPreview(previewId, companyId, userId);
    if (!e) return null;
    const renewal = !!e.operatorId;   // 승인 창 = AI 문안 0(회차가 만든다)
    if (patch?.revision !== e.rev) throw new PreviewStaleError(PREVIEW_STALE_MESSAGE, shown(e, await refreshEntry(e, previewId, renewal ? 'skip' : 'existing')));
    const k = screenKeyOf(patch?.request_key);
    if (k && !e.screenKey) { e.screenKey = k; previewByKey.set(keyRef(companyId, userId, k), previewId); }
    let wantsCopy = patch?.regenerate === true;
    if (patch?.answers && typeof patch.answers === 'object' && !Array.isArray(patch.answers)) {
      const d = decideOperatorAnswers(e.questions, patch.answers);
      if (!d.ok) throw new PreviewInputError(d.error);
      await applyAnswers(e, d);
      wantsCopy = true;
    }
    if (Array.isArray(patch?.conditions) || (typeof patch?.segment_key === 'string' && patch.segment_key.trim())) {
      await retranslate(e, {
        segmentKey: typeof patch.segment_key === 'string' ? patch.segment_key : null,
        segmentParams: patch.segment_params || null,
        conditions: Array.isArray(patch.conditions) ? patch.conditions : null,
      });
      birthdayDefault(e);
    }
    if (!renewal) {
      // ★ 1024 0크레딧 칸 — 주기 · 날 · 시각(등록과 같은 검증) · 회신번호(등록 번호만) · 알림 번호
      const sched = ['daily', 'weekly', 'monthly'].includes(patch?.schedule) ? patch.schedule : null;
      if (sched || typeof patch?.schedule_time === 'string' || patch?.schedule_day_of_week !== undefined || patch?.schedule_day_of_month !== undefined) {
        const s2 = sched || e.input.schedule || 'monthly';
        const t2 = typeof patch?.schedule_time === 'string' ? patch.schedule_time : (e.input.scheduleTime || '09:00');
        const day = earliestRoundDay(t2, new Date());
        const dow = patch?.schedule_day_of_week !== undefined && patch.schedule_day_of_week !== null ? Number(patch.schedule_day_of_week) : (e.input.scheduleDayOfWeek ?? day.dow);
        const dom = patch?.schedule_day_of_month !== undefined && patch.schedule_day_of_month !== null ? Number(patch.schedule_day_of_month) : (e.input.scheduleDayOfMonth ?? day.dom);
        const next: CreateOperatorInput = {
          ...e.input, schedule: s2 as any, scheduleTime: t2,
          scheduleDayOfWeek: s2 === 'weekly' && Number.isInteger(dow) && dow >= 0 && dow <= 6 ? dow : null,
          scheduleDayOfMonth: s2 === 'monthly' && Number.isInteger(dom) && dom >= 1 && dom <= 31 ? dom : null,
        };
        if ((s2 === 'weekly' && next.scheduleDayOfWeek == null) || (s2 === 'monthly' && next.scheduleDayOfMonth == null)) throw new PreviewInputError('보낼 요일이나 날짜를 골라 주세요.');
        try { validateOperatorInput(next); } catch (err: any) { throw new PreviewInputError(err?.message || '주기를 확인해 주세요.'); }
        e.input = next;
        e.scheduleWritten = true;
      }
      if (patch?.callback_number !== undefined) {
        e.input = { ...e.input, callback: await checkOperatorCallback(companyId, e.input.createdBy || userId, { callbackNumber: patch.callback_number }) };
      }
      if (patch?.admin_phone !== undefined) {
        const d = String(patch.admin_phone || '').replace(/\D/g, '');
        if (!/^01\d{8,9}$/.test(d)) throw new PreviewInputError('휴대폰 번호를 다시 확인해 주세요.');
        e.input = { ...e.input, adminPhoneNumbers: [d] };
      }
    }
    if (patch?.copy_mode === 'ai' || patch?.copy_mode === 'fixed') e.input = { ...e.input, copyMode: patch.copy_mode };
    if (typeof patch?.fixed_body === 'string' || typeof patch?.fixed_subject === 'string') {
      e.input = { ...e.input, fixedCopy: normalizeFixedCopyInput({ subject: patch.fixed_subject ?? e.input.fixedCopy?.subject, body: patch.fixed_body ?? e.input.fixedCopy?.body }) };
    }
    if (patch?.benefit !== undefined) {
      const b = typeof patch.benefit === 'string' ? patch.benefit : null;
      const dated = datedTerms(b || '');
      if (dated.length > 0) throw new PreviewInputError(`혜택 글의 「${dated[0]}」은(는) 회차마다 지나가는 날짜예요. 날짜는 빼고 적어 주세요.`);
      e.input = { ...e.input, benefitContent: b };
      e.benefitAsk = null;
    }
    e.rev += 1;
    return shown(e, await refreshEntry(e, previewId, renewal ? 'skip' : wantsCopy ? 'generate' : 'existing'));
  });
}

/**
 * [이번 주 승인하고 시작] — 보관한 입력으로 등록(200 · registerOperator 한 트랜잭션 · 승인 기간 같은 INSERT) → 첫 회차(본 안 = 나가는 안).
 *   ★ 1024 잠금 하나로 판정 + 등록(회의론자 §9-3) — 같은 시작의 재전송은 409(처리 중) · 보관본은 커밋 뒤에만 지운다.
 *   행이 먼저다(id = 미리보기 id) — 응답을 못 받은 재전송 · 재시작 뒤에도 같은 행을 돌려준다(차감 0).
 *   null = 만료 · 남의 것(410 · 차감 0). 시작할 수 없는 상태면 PreviewInputError(400 · 차감 0).
 */
export async function startOperatorFromPreview(previewId: string, companyId: string, userId: string, revision: unknown, variantIndex?: unknown): Promise<{
  operator: ContinuousOperator;
  appliedSegment: { key: string; label: string } | null;
  proposal: OperatorProposal | null;
  message: string | null;
  approvedUntil: string | null;
} | null> {
  if (!isUuid(previewId)) return null;
  return withLock(companyId, userId, async () => {
    const prior = await query(
      `SELECT * FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid AND created_by = $3::uuid`,
      [previewId, companyId, userId],
    );
    if (prior.rows[0]) {
      const op = mapRowToOperator(prior.rows[0]);
      dropPreview(previewId);
      let proposal: OperatorProposal | null = null;
      let message: string | null = null;
      try {
        proposal = await findOpenProposalForOperator(op.id, companyId);
        if (!proposal) message = START_STATE_UNKNOWN_MESSAGE;
      } catch { message = START_STATE_UNKNOWN_MESSAGE; }
      return { operator: op, appliedSegment: null, proposal, message, approvedUntil: op.approvedUntil ? op.approvedUntil.toISOString() : null };
    }
    const e = peekPreview(previewId, companyId, userId);
    if (!e || e.operatorId) return null;
    // 시작 가능 판정은 서버가 다시 한다(창 상태를 믿지 않는다) · 화면이 본 판이 아니면 지금 상태를 돌려준다(본 것 = 등록한 것 · Codex 2R)
    const checked = await refreshEntry(e, previewId, 'existing');
    assertSeen(e, checked, revision);
    if (!checked.ready) throw new PreviewInputError(checked.reason || '아직 시작할 수 없는 상태예요. 창에 표시된 안내를 먼저 마무리해 주세요.');
    const useResult = e.input.copyMode !== 'fixed' && e.result ? e.result : null;
    const messages: any[] = Array.isArray(useResult?.messages) ? useResult.messages : [];
    // ★ 1024 화면이 보고 있던 안 = 첫 회차가 보내는 안(회의론자 §9-9) — 없거나 틀리면 추천 순서(통과 안 → 추천 → 0)
    const vi = typeof variantIndex === 'number' && Number.isInteger(variantIndex) && messages[variantIndex] ? variantIndex : null;
    const win = confirmedWindow(checked);
    const { operator } = await registerOperator(e.input, { id: previewId, window: { startAt: win.startAt, until: win.until } });
    dropPreview(previewId);   // 커밋 뒤에만 지운다
    // 등록은 끝났다 — 첫 회차 저장이 실패해도 등록 · 차감은 유효하다(정해진 회차에 다시 만든다).
    let proposal: OperatorProposal | null = null;
    try {
      proposal = await generateProposalForOperator(operator.id, useResult ? { precomputed: useResult, variantIndex: vi } : undefined);
    } catch (err: any) {
      console.warn('[AutomarketingPreview] 첫 회차 저장 중 오류(등록 유지 · 저장 상태로 판정):', err?.message || err);
    }
    // 반환값만 믿지 않는다(Codex 1R) — 저장 상태로 판정하고, 사유는 run-now 와 같은 함수로. 재조회가 실패하면 「확인하지 못했다」(Codex 2R).
    let message: string | null = null;
    if (!proposal) {
      try {
        proposal = await findOpenProposalForOperator(operator.id, companyId);
        if (!proposal) message = await explainEmptyRound(operator.id, companyId);
      } catch (err: any) {
        console.warn('[AutomarketingPreview] 첫 회차 저장 상태 확인 실패:', err?.message || err);
        message = START_STATE_UNKNOWN_MESSAGE;
      }
    }
    return { operator, appliedSegment: e.appliedSegment, proposal, message, approvedUntil: win.until.toISOString() };
  });
}

// ── 실행 중 자동 마케팅의 승인 창(다음 승인 · 조건 확인) ──

export interface ApprovalPreview {
  operatorId: string;
  name: string;
  objective: string;
  needsContract: boolean;
  outcome: PreviewOutcome;
  lastWindow: { since: string; sentRounds: number; people: number; emptyDays: number; held: number } | null;
  approvedUntil: string | null;
}

/**
 * 실행 중 자동 마케팅의 지금 계약 → 승인 창 첫 번역. 저장된 축 · 칸 조건이 있으면 그것(AI 0) · 없으면(옛 자유 해석) 목표 번역.
 *   창을 연 뒤의 편집 · 승인은 보관본(updateOperatorPreview · approveOperatorFromScreen)이 맡는다 — 계약을 다시 정하는 곳은 없다.
 */
async function resolveOperatorContract(companyId: string, op: ContinuousOperator, userId: string): Promise<AudienceTranslation> {
  const base = { companyId, userId, objective: op.objective, schedule: op.schedule };
  const stored = operatorContract(op);
  try {
    if (stored?.key) return await translateAudience({ ...base, segmentKey: stored.key, segmentParams: op.segmentParams });
    if (stored?.conditions) {
      try {
        return await translateAudience({ ...base, conditions: stored.conditions });
      } catch (e: any) {
        if (!(e instanceof AudienceConditionError)) throw e;   // 저장된 칸이 지금은 비었다(값이 사라짐) — 칸을 다시 고르게 한다
      }
    }
  } catch (e: any) {
    if (e instanceof AudienceConditionError) throw new PreviewInputError(e.message);
    throw e;
  }
  return translateAudience(base);
}

/**
 * 실행 중 자동 마케팅의 승인 창 — 계약이 없으면(옛 자유 해석) 번역부터, 있으면 지금 계약의 근거를 다시 센다(AI 문안 0).
 *   overrides = 창에서 고른 칸 · 축(서버가 다시 검증해 센다 · 저장은 승인 때).
 */
export async function previewOperatorApproval(companyId: string, operatorId: string, viewerUserId: string): Promise<ApprovalPreview | null> {
  const r = await query(`SELECT * FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid AND status <> 'archived'`, [operatorId, companyId]);
  if (r.rows.length === 0) return null;
  const op = mapRowToOperator(r.rows[0]);
  const owner = op.createdBy || viewerUserId;
  const needsContract = !operatorContract(op);
  return withLock(companyId, viewerUserId, async () => {
    const tr = await resolveOperatorContract(companyId, op, viewerUserId);
    const input: CreateOperatorInput = applyTranslation({
      companyId, createdBy: owner, name: op.name, objective: op.objective, schedule: op.schedule, scheduleTime: op.scheduleTime,
      scheduleDayOfWeek: op.scheduleDayOfWeek, scheduleDayOfMonth: op.scheduleDayOfMonth, scheduleMonth: op.scheduleMonth,
      channel: op.channel, benefitContent: op.benefitContent, copyStyle: op.copyStyle,
      copyMode: op.copyMode, fixedCopy: op.fixedCopy,
    }, tr);
    // 승인 창도 서버 보관본 하나 — 편집(preview/update) · 승인(approve-window)이 이것만 쓴다. 보는 사람이 주인(잠금 · 꺼내기)
    const entry: PreviewEntry = {
      companyId, userId: viewerUserId, input, translation: tr, result: null, resultPrint: null, appliedSegment: null,
      createdAt: Date.now(), operatorId: op.id, rev: 0, shownStart: null,
      screenKey: null, scheduleWritten: true, benefitAsk: null, questions: [], notes: [], bodyPrint: '',
      scheduleSeen: operatorScheduleShape(op),
    };
    const previewId = putPreview(entry);
    // AI 문안은 회차마다 그때 만든다 — 승인 창에서는 만들지 않는다(차감 0)
    const outcome = shown(entry, await refreshEntry(entry, previewId, 'skip'));
    let lastWindow: ApprovalPreview['lastWindow'] = null;
    try {
      const since = approvalSummarySince(op.approvalMeta?.windowStart, op.autoSendLeadMinutes, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      const s = await approvalWindowSummary(op.id, since);   // ★ 2026-10-25 원장 #45 갱신 안내와 같은 함수
      lastWindow = { since: since.toISOString(), sentRounds: s.sentRounds, people: s.people, emptyDays: countEmptyRounds(op.roundLog, since), held: s.held };
    } catch { /* 요약은 부가 정보 */ }
    return { operatorId: op.id, name: op.name, objective: op.objective, needsContract, outcome, lastWindow, approvedUntil: op.approvedUntil ? op.approvedUntil.toISOString() : null };
  });
}


/**
 * [다음 승인] · [조건 확인] — 승인 창 보관본(서버가 검증한 계약 · 문안 분기 · 핵심 혜택)을 승인 기간과 함께 한 문장에 저장한다(차감 0).
 *   화면이 본 판일 때만 · 시작 가능 판정과 같은 함수(refreshEntry)로 다시 판정 · 계약을 다시 정하지 않는다(Codex 2R).
 *   null = 만료 · 남의 것 · 다른 운영자의 창 · 운영자 없음(410).
 */
export async function approveOperatorFromScreen(companyId: string, operatorId: string, userId: string, body: any): Promise<{ until: string } | null> {
  const previewId = typeof body?.preview_id === 'string' ? body.preview_id : '';
  if (!previewId) return null;
  return withLock(companyId, userId, async () => {
    // 잠금 안에서 꺼낸다 — 앞선 승인이 지운 창을 다시 저장하지 않게
    const e = peekPreview(previewId, companyId, userId);
    if (!e || e.operatorId !== operatorId) return null;
    const out = await refreshEntry(e, previewId, 'skip');
    assertSeen(e, out, body?.revision);
    if (!out.ready) throw new PreviewInputError(out.reason || '아직 승인할 수 없는 상태예요. 창에 표시된 안내를 먼저 마무리해 주세요.');
    const tr = e.translation;
    if (tr.kind !== 'axis' && tr.kind !== 'filters') throw new PreviewInputError('보낼 대상을 먼저 확인해 주세요.');
    const r = await query(`SELECT * FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid AND status <> 'archived'`, [operatorId, companyId]);
    if (r.rows.length === 0) return null;
    const op = mapRowToOperator(r.rows[0]);
    const copyMode: 'ai' | 'fixed' = e.input.copyMode === 'fixed' ? 'fixed' : 'ai';
    let fixedCopy: FixedCopy | null = copyMode === 'fixed' && e.input.fixedCopy
      ? { subject: e.input.fixedCopy.subject || '', body: e.input.fixedCopy.body, spam: null }
      : null;
    // 같은 문안이면 지난 검사 결과(지문)를 이어 간다 — 문안을 고쳤으면 첫 회차에 다시 검사한다(Q17)
    if (fixedCopy && op.fixedCopy && op.fixedCopy.body === fixedCopy.body && op.fixedCopy.subject === fixedCopy.subject) fixedCopy = { ...fixedCopy, spam: op.fixedCopy.spam || null };
    const win = await approveOperatorWindow({
      companyId, operatorId, userId,
      contract: {
        segmentKey: tr.kind === 'axis' ? tr.segmentKey : null,
        segmentParams: tr.kind === 'axis' ? tr.segmentParams : null,
        conditions: tr.kind === 'filters' ? tr.conditions : null,
      },
      copy: { mode: copyMode, fixedCopy },
      benefitContent: e.input.benefitContent ?? null,
      window: confirmedWindow(out),
      // ③ · ② 「매월로」 답일 때만 창이 보여 준 주기를 저장한다(창의 회차 = 이 주기) · 답이 없으면 넘기지 않는다(창을 연 뒤 바뀐 주기를 옛 값으로 덮지 않게)
      schedule: e.scheduleAnswered ? { schedule: e.input.schedule as any, scheduleDayOfWeek: e.input.scheduleDayOfWeek ?? null, scheduleDayOfMonth: e.input.scheduleDayOfMonth ?? null } : null,
      seenSchedule: e.scheduleSeen ?? null,
    });
    if (!win) return null;
    dropPreview(previewId);   // 승인한 창은 끝 — 같은 창으로 두 번 저장하지 않는다
    return { until: win.until.toISOString() };
  });
}

/** 테스트 전용 — 보관 · 잠금 비우기 */
export function __resetPreviewStoreForTest(): void {
  previews.clear();
  previewByKey.clear();
  inflight.clear();
}

/** 테스트 전용 — 보관 시각을 과거로(만료 검증) */
export function __agePreviewForTest(id: string, ms: number): void {
  const e = previews.get(id);
  if (e) e.createdAt -= ms;
}
