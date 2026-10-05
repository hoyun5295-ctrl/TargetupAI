// ============================================================
// 자동 마케팅 [제안 받기] = 미리보기 · 승인 창 (★ 2026-10-05 · 설계서 docs/2026-10-05-automarketing-preview-design.md
//   · docs/2026-10-05-automarketing-trust-design.md)
//   미리보기 = 등록 없이 첫 회차와 같은 계산 · 대상은 대상 번역 module 이 계약으로 고정 · AI 문안 = 허브와 같은 키(5 · 대상 0명 0) ·
//   직접 쓴 문안 = AI 0(0크레딧). 창 편집(칸 · 기준 · 문안 분기 · 혜택)은 서버 보관본에 반영한다.
//   [이번 주 승인하고 시작] = 보관한 입력 그대로 등록(200 · 기존 멱등) + 승인 기간 + 본 제안 = 첫 회차.
//   실행 중 자동 마케팅의 [다음 승인] · [조건 확인]도 같은 계산(AI 문안 없이)을 쓴다.
// ============================================================
import { randomUUID } from 'crypto';
import { query } from '../config/database';
import { getCompanyCosts } from '../config/defaults';
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
  createOperator, generateProposalForOperator, validateOperatorInput, operatorContextFields,
  explainEmptyRound, findOpenProposalForOperator,
  loadOperatorCompanyContext, buildOperatorOrchestrateContext,
  approveOperatorWindow, normalizeFixedCopyInput, normalizeOperatorBenefit, mapRowToOperator, operatorContract, type FixedCopy,
} from './continuous-operator';
import { computeApprovalWindow, countEmptyRounds, parseScheduleFromText, approvalSummarySince } from './autosend-policy';

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
  if (err instanceof InsufficientCreditError) {
    return { status: 402, body: { success: false, error: '자동 마케팅 시작에 필요한 크레딧이 부족합니다. 크레딧을 충전해 주세요.', code: 'INSUFFICIENT_CREDIT' } };
  }
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
  /** 결과를 만들 때의 핵심 혜택 — 바뀌면 결과를 버린다(혜택은 문안에 녹아 있다) */
  resultBenefit: string | null;
  appliedSegment: { key: string; label: string } | null;
  createdAt: number;
  /** 실행 중 자동 마케팅의 승인 창이면 그 운영자(문안은 회차가 만든다 · 시작이 아니라 승인) */
  operatorId: string | null;
  /** 판 번호 — 편집마다 1 증가. 시작 · 승인은 화면이 본 판일 때만(본 것 = 저장한 것 · Codex 2R) */
  rev: number;
  /** 화면에 마지막으로 보여 준 승인 기간 시작 — 발송 시각을 넘겨 기간이 바뀌면 판을 올리고 다시 확인받는다(Codex 3R) */
  shownStart: string | null;
}
const previews = new Map<string, PreviewEntry>();
const inflight = new Set<string>();

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

function putPreview(entry: PreviewEntry): string {
  const now = Date.now();
  for (const [id, e] of previews) if (now - e.createdAt > PREVIEW_TTL_MS) previews.delete(id);
  while (previews.size >= PREVIEW_MAX) previews.delete(previews.keys().next().value as string);
  const id = randomUUID();
  previews.set(id, entry);
  return id;
}

/** 꺼내는 순간 지운다(같은 미리보기로 두 번 등록 금지). 없음 · 남의 것 · 만료 = null(남의 것은 지우지 않는다) */
export function takePreview(id: string, companyId: string, userId: string): PreviewEntry | null {
  const e = previews.get(id);
  if (!e || e.companyId !== companyId || e.userId !== userId) return null;
  previews.delete(id);
  return Date.now() - e.createdAt > PREVIEW_TTL_MS ? null : e;
}

/** 창 편집용 — 지우지 않고 본다(주인 · 만료 검사는 같다) */
function peekPreview(id: string, companyId: string, userId: string): PreviewEntry | null {
  const e = previews.get(id);
  if (!e || e.companyId !== companyId || e.userId !== userId) return null;
  if (Date.now() - e.createdAt > PREVIEW_TTL_MS) { previews.delete(id); return null; }
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
   * needs_choice = 칸을 골라야 한다 · blocked = 막힘(데이터 없음 · 조건 없음 · 주기 짝)
   */
  kind: 'proposal' | 'baseline' | 'zero' | 'needs_choice' | 'blocked';
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
  const result = await orchestrate(
    buildOperatorOrchestrateContext({ ...fields, id: null, anchorAt: anchor }, loaded),
    { source: 'ai-operator-propose', cost: getCreditCost('ai-operator-propose'), chargeOnlyWithTarget: true },
  );
  if ((result.messages?.length || 0) === 0) throw new Error('문안 생성 결과 없음');
  return result;
}

/**
 * 미리보기를 한 번 계산한다(새로 만들기 · 창 편집 공용). AI 문안은 필요할 때만(AI 모드 · 결과 없음 · 대상 있음) 만든다.
 *   0명(축 · 칸 조건 · 지금 기준) = 시작 불가 · 차감 0. 생일 · 매일은 7일 예상이 기준(0명인 날은 정상).
 */
async function refreshEntry(
  e: PreviewEntry,
  previewId: string | null,
  /** generate = 필요하면 AI 문안을 만든다(미리보기 · 편집) · existing = 만들지 않고 있는 것만(시작 판정 · 돈 0) · skip = 문안 없이(승인 창 · 회차가 만든다) */
  copyStep: 'generate' | 'existing' | 'skip' = 'generate',
): Promise<PreviewOutcome> {
  const loaded = await loadOperatorCompanyContext(e.companyId);
  if (!loaded) throw new PreviewInputError('회사 정보를 찾을 수 없습니다.');
  const win = windowFor(e.input);
  const tr = e.translation;
  const channel = (e.input.channel ? String(e.input.channel) : 'lms').toLowerCase();
  const costs = getCompanyCosts(loaded.companyInfo as any) as Record<string, number>;
  const copyMode: 'ai' | 'fixed' = e.input.copyMode === 'fixed' ? 'fixed' : 'ai';
  const vars = await checkFixedCopyVariables(e.companyId, loaded.companyInfo.customer_schema, e.input.fixedCopy?.subject || '', e.input.fixedCopy?.body || '');

  const base: Omit<PreviewOutcome, 'kind' | 'previewId' | 'proposal' | 'reason' | 'ready' | 'count' | 'forecast'> = {
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
  // 직접 쓴 문안 = 문안이 있고 값 없는 %칸% 이 없어야 시작 · 승인(기준 축도 같다)
  const fixedText = e.input.fixedCopy?.body || '';
  const badVars = [...vars.empty, ...vars.unknown];
  const fixedReason = !fixedText ? '보낼 문안을 넣어 주세요.'
    : badVars.length > 0 ? `%${badVars.join('% · %')}% 칸은 값이 없어 쓸 수 없어요. 넣을 수 있는 칸만 써 주세요.` : null;

  if (tr.kind === 'blocked') {
    return { ...base, kind: 'blocked', previewId, proposal: null, reason: tr.reason, ready: false, count: null, forecast: null };
  }
  if (tr.kind === 'needs_choice') {
    const terms = tr.unresolved.map((u) => `「${u.term}」`).join(' · ');
    return { ...base, kind: 'needs_choice', previewId, proposal: null, reason: `${terms}을(를) 어느 칸으로 판단할지 골라 주세요. 값이 있는 칸만 고를 수 있어요.`, ready: false, count: null, forecast: null };
  }

  const m = await measureEntry(e, win);
  if (m.baseline) {
    return { ...base, kind: 'baseline', previewId, proposal: null, reason: copyMode === 'fixed' ? fixedReason : null, ready: copyMode === 'ai' || !fixedReason, count: null, forecast: null };
  }
  if (!m.forecast && (m.count || 0) === 0) {
    return { ...base, kind: 'zero', previewId, proposal: null, reason: '지금 조건에 맞는 고객이 없어요. 조건을 임의로 넓혀서 보내지 않아요. 기준을 고치거나 세부 설정에서 대상을 바꿔 주세요.', ready: false, count: 0, forecast: null };
  }

  if (copyMode === 'fixed') {
    return { ...base, kind: 'proposal', previewId, proposal: null, reason: fixedReason, ready: !fixedReason, count: m.count, forecast: m.forecast };
  }

  // AI 문안 — 결과가 없거나 핵심 혜택이 바뀌었으면 만든다(생일 · 매일 = 생일자가 있는 첫날 기준)
  if (copyStep === 'skip') {
    return { ...base, kind: 'proposal', previewId, proposal: null, reason: null, ready: true, count: m.count, forecast: m.forecast };
  }
  const benefitNow = normalizeOperatorBenefit(e.input.benefitContent);
  if (e.result && e.resultBenefit !== benefitNow) e.result = null;
  if (!e.result) {
    const firstDay = m.forecast ? m.forecast.findIndex((d: { count: number }) => d.count > 0) : 0;
    if (firstDay < 0) {
      // 7일 내내 생일 고객이 없다 — 미리 보여 줄 문안이 없다(차감 0). 시작하면 생일 고객이 있는 날 그날 문안을 만든다.
      return { ...base, kind: 'proposal', previewId, proposal: null, reason: '앞으로 7일 동안 대상 고객이 없어 미리 보여 드릴 문안이 없어요. 시작하면 대상이 있는 날 그날 문안을 만들어 보내요.', ready: true, count: m.count, forecast: m.forecast };
    }
    if (copyStep === 'existing') {
      return { ...base, kind: 'proposal', previewId, proposal: null, reason: '문안을 아직 만들지 않았어요. 다시 [제안 받기]를 눌러 주세요.', ready: false, count: m.count, forecast: m.forecast };
    }
    const anchor = new Date(win.startAt.getTime() + firstDay * 24 * 60 * 60 * 1000);
    e.result = await generateCopy(e, loaded, anchor);
    e.resultBenefit = benefitNow;
  }
  return { ...base, kind: 'proposal', previewId, proposal: e.result, reason: null, ready: true, count: m.count, forecast: m.forecast };
}

/** 문장 주기 → 등록 본문 칸(없으면 매월 · 오늘 날짜 · 시각은 문장에 있으면 그것) */
export function scheduleBodyFromText(objective: string, body: any, now: Date = new Date()): Record<string, any> {
  const s = parseScheduleFromText(objective);
  const todayKst = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCDate();
  const v = s || { schedule: 'monthly' as const, scheduleDayOfWeek: null, scheduleDayOfMonth: todayKst, scheduleTime: null };
  return {
    schedule: v.schedule,
    schedule_day_of_week: v.schedule === 'weekly' ? v.scheduleDayOfWeek : null,
    schedule_day_of_month: v.schedule === 'monthly' ? v.scheduleDayOfMonth : null,
    schedule_time: v.scheduleTime || body?.schedule_time || '09:00',
  };
}

/** [제안 받기] — 등록 없이 첫 회차와 같은 계산. 같은 회사 · 같은 사람의 동시 요청은 PreviewBusyError(409) */
export async function runOperatorPreview(companyId: string, userId: string, body: any): Promise<PreviewOutcome> {
  return withLock(companyId, userId, async () => {
    // ★ 2026-10-05 한 줄 · 오늘의 추천 입구(infer_schedule) — 문장의 주기(매일 · 매주 ○요일 · 매월 ○일 · 매월 초 · 생일인 날)를 읽는다.
    //   주기 말이 없으면 매월 · 오늘 날짜(매일 · 매주 + 상태 조건은 같은 고객 반복이라 막히므로 · Q9). 정해진 주기는 승인 창 첫 줄에 날짜로 보인다.
    if (body?.infer_schedule === true) body = { ...body, ...scheduleBodyFromText(String(body?.objective || ''), body) };
    // 등록이 거절할 입력은 돈을 쓰기 전에 거른다(등록과 같은 검증 함수)
    const base = createOperatorInputFromBody(companyId, userId, body);
    try { validateOperatorInput(base as CreateOperatorInput); } catch (e: any) { throw new PreviewInputError(e?.message || '입력을 확인해 주세요.'); }
    let tr: AudienceTranslation;
    try {
      tr = await translateAudience({
        companyId, userId, objective: base.objective, schedule: base.schedule || 'daily',
        segmentKey: body?.segment_key, segmentParams: body?.segment_params, targetHint: body?.target_hint,
        conditions: Array.isArray(body?.audience_conditions) ? body.audience_conditions : null,
      });
    } catch (e: any) {
      if (e instanceof AudienceConditionError) throw new PreviewInputError(e.message);
      throw e;
    }
    const copyMode: 'ai' | 'fixed' = body?.copy_mode === 'fixed' ? 'fixed' : 'ai';
    const fixed = copyMode === 'fixed' ? normalizeFixedCopyInput({ subject: body?.fixed_subject, body: body?.fixed_body }) : null;
    const input: CreateOperatorInput = applyTranslation({ ...(base as CreateOperatorInput), copyMode, fixedCopy: fixed }, tr);
    const entry: PreviewEntry = {
      companyId, userId, input, translation: tr, result: null, resultBenefit: null,
      appliedSegment: tr.kind === 'axis' && tr.mapped ? { key: tr.segmentKey, label: tr.label } : null,
      createdAt: Date.now(), operatorId: null, rev: 0, shownStart: null,
    };
    // 막힘은 보관하지 않는다(시작 · 편집할 것이 없다). 그 밖은 보관해 창 편집이 이어진다.
    const previewId = tr.kind === 'blocked' ? null : putPreview(entry);
    return shown(entry, await refreshEntry(entry, previewId));
  });
}

/**
 * 창 편집(칸 고르기 · 기준 숫자 · 문안 분기 · 직접 쓴 문안 · 핵심 혜택) — 서버가 검증해 보관본에 반영하고 다시 계산한다.
 *   AI 문안이 필요해지면(AI 로 바꿈 · 칸을 골라 대상이 생김 · 핵심 혜택을 고침) 그때 만든다(5 · 대상 0명이면 0).
 */
export async function updateOperatorPreview(previewId: string, companyId: string, userId: string, patch: any): Promise<PreviewOutcome | null> {
  return withLock(companyId, userId, async () => {
    const e = peekPreview(previewId, companyId, userId);
    if (!e) return null;
    const copyStep = e.operatorId ? 'skip' : 'generate';   // 승인 창 = AI 문안 0(회차가 만든다)
    if (patch?.revision !== e.rev) throw new PreviewStaleError(PREVIEW_STALE_MESSAGE, shown(e, await refreshEntry(e, previewId, e.operatorId ? 'skip' : 'existing')));
    const schedule = e.input.schedule || 'daily';
    if (Array.isArray(patch?.conditions) || (typeof patch?.segment_key === 'string' && patch.segment_key.trim())) {
      try {
        e.translation = await translateAudience({
          companyId, userId, objective: e.input.objective, schedule,
          segmentKey: typeof patch.segment_key === 'string' ? patch.segment_key : null,
          segmentParams: patch.segment_params || null,
          conditions: Array.isArray(patch.conditions) ? patch.conditions : null,
          carry: e.translation,   // 창의 말(term)은 빠지지 않는다
        });
      } catch (err: any) {
        if (err instanceof AudienceConditionError) throw new PreviewInputError(err.message);
        throw err;
      }
      e.input = applyTranslation(e.input, e.translation);
      e.appliedSegment = null;   // 사람이 고른 계약 — AI 가 고정했다는 안내는 더 이상 맞지 않는다
    }
    if (patch?.copy_mode === 'ai' || patch?.copy_mode === 'fixed') e.input = { ...e.input, copyMode: patch.copy_mode };
    if (typeof patch?.fixed_body === 'string' || typeof patch?.fixed_subject === 'string') {
      e.input = { ...e.input, fixedCopy: normalizeFixedCopyInput({ subject: patch.fixed_subject ?? e.input.fixedCopy?.subject, body: patch.fixed_body ?? e.input.fixedCopy?.body }) };
    }
    if (patch?.benefit !== undefined) e.input = { ...e.input, benefitContent: typeof patch.benefit === 'string' ? patch.benefit : null };
    e.rev += 1;
    return shown(e, await refreshEntry(e, previewId, copyStep));
  });
}

/**
 * [이번 주 승인하고 시작] — 보관한 입력으로 등록(200 · 멱등키 continuous-operator:{id}) → 승인 기간 → 첫 회차(AI 문안 = 본 제안).
 * null = 만료 · 남의 것(410 · 차감 0). 시작할 수 없는 상태면 PreviewInputError(400 · 차감 0).
 * 잔액 부족이면 보관본을 되돌려 충전 뒤 다시 누를 수 있게 한다.
 */
export async function startOperatorFromPreview(previewId: string, companyId: string, userId: string, revision: unknown): Promise<{
  operator: ContinuousOperator;
  appliedSegment: { key: string; label: string } | null;
  proposal: OperatorProposal | null;
  message: string | null;
  approvedUntil: string | null;
} | null> {
  const peek = peekPreview(previewId, companyId, userId);
  if (!peek || peek.operatorId) return null;
  // 시작 가능 판정은 서버가 다시 한다(창 상태를 믿지 않는다) — 판정 중 다른 요청이 같은 미리보기를 꺼내지 못하게 잠근다.
  //   화면이 본 판이 아니면 시작하지 않고 지금 상태를 돌려준다(본 것 = 등록한 것 · Codex 2R).
  const checked = await withLock(companyId, userId, async () => {
    const out = await refreshEntry(peek, previewId, 'existing');
    assertSeen(peek, out, revision);
    return out;
  });
  if (!checked.ready) throw new PreviewInputError('아직 시작할 수 없는 상태예요. 창에 표시된 안내를 먼저 마무리해 주세요.');
  const entry = takePreview(previewId, companyId, userId);
  if (!entry) return null;
  let operator: ContinuousOperator;
  try {
    operator = await createOperator(entry.input);
  } catch (e) {
    // 되돌림 = 행이 없음이 증명되는 오류만(Codex 1R high). 잔액 부족은 INSERT 전 사전 확인(checkCredit)에서만 던진다
    //   (INSERT 뒤 차감은 부족해도 던지지 않는다). 그 밖 실패는 INSERT 가 커밋됐는지 모르므로 되돌리지 않는다 —
    //   되돌리면 같은 미리보기로 두 번째 활성 등록이 생긴다. 그때는 다시 [제안 받기].
    if (e instanceof InsufficientCreditError) previews.set(previewId, entry);
    throw e;
  }
  // 승인 기간(첫 주) — 칸이 준비되기 전(DDL 전)이면 건너뛴다: 회차마다 승인 대기(더 안전한 쪽)로 남는다.
  let approvedUntil: string | null = null;
  try {
    const win = await approveOperatorWindow({ companyId, operatorId: operator.id, userId, window: confirmedWindow(checked) });
    approvedUntil = win ? win.until.toISOString() : null;
    if (win) operator = { ...operator, approvedUntil: win.until };
  } catch (e: any) {
    console.warn('[AutomarketingPreview] 승인 기간 저장 생략(회차마다 승인으로):', e?.message || e);
  }
  // 등록은 끝났다 — 첫 회차 저장이 실패해도 등록 · 차감은 유효하다(정해진 회차에 다시 만든다). 500 으로 돌려 다시 누르게 하면 두 번 등록된다.
  let proposal: OperatorProposal | null = null;
  try {
    const useResult = entry.input.copyMode !== 'fixed' && entry.result;
    proposal = await generateProposalForOperator(operator.id, useResult ? { precomputed: entry.result } : undefined);
  } catch (e: any) {
    console.warn('[AutomarketingPreview] 첫 회차 저장 중 오류(등록 유지 · 저장 상태로 판정):', e?.message || e);
  }
  // 반환값만 믿지 않는다(Codex 1R) — 제안 INSERT 뒤 후속 단계가 던져도 행은 남는다. 저장 상태로 판정하고, 사유는 run-now 와 같은 함수로.
  //   ⛔ 모르는 상태를 「없음」으로 접지 않는다(Codex 2R · 되돌림과 같은 뿌리) — 재조회가 실패하면 「확인하지 못했다」고 말한다.
  //   「만들지 못했다」는 재조회가 0행을 정상으로 돌려준 때만.
  let message: string | null = null;
  if (!proposal) {
    try {
      proposal = await findOpenProposalForOperator(operator.id, companyId);
      if (!proposal) message = await explainEmptyRound(operator.id, companyId);
    } catch (e: any) {
      console.warn('[AutomarketingPreview] 첫 회차 저장 상태 확인 실패:', e?.message || e);
      message = START_STATE_UNKNOWN_MESSAGE;
    }
  }
  return { operator, appliedSegment: entry.appliedSegment, proposal, message, approvedUntil };
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
      companyId, userId: viewerUserId, input, translation: tr, result: null, resultBenefit: null, appliedSegment: null,
      createdAt: Date.now(), operatorId: op.id, rev: 0, shownStart: null,
    };
    const previewId = putPreview(entry);
    // AI 문안은 회차마다 그때 만든다 — 승인 창에서는 만들지 않는다(차감 0)
    const outcome = shown(entry, await refreshEntry(entry, previewId, 'skip'));
    let lastWindow: ApprovalPreview['lastWindow'] = null;
    try {
      const since = approvalSummarySince(op.approvalMeta?.windowStart, op.autoSendLeadMinutes, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      const s = await query(
        `SELECT COUNT(*) FILTER (WHERE status IN ('sent', 'auto_executed'))::int AS sent_rounds,
                COALESCE(SUM(recipient_count) FILTER (WHERE status IN ('sent', 'auto_executed')), 0)::int AS people,
                COUNT(*) FILTER (WHERE status IN ('admin_review', 'admin_stopped', 'skipped'))::int AS held
           FROM operator_proposals
          WHERE operator_id = $1::uuid AND created_at >= $2
            AND COALESCE(proposal_json->'meta'->>'is_reminder', 'false') <> 'true'`,
        [op.id, since],
      );
      lastWindow = {
        since: since.toISOString(),
        sentRounds: Number(s.rows[0]?.sent_rounds) || 0,
        people: Number(s.rows[0]?.people) || 0,
        emptyDays: countEmptyRounds(op.roundLog, since),
        held: Number(s.rows[0]?.held) || 0,
      };
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
    });
    if (!win) return null;
    previews.delete(previewId);   // 승인한 창은 끝 — 같은 창으로 두 번 저장하지 않는다
    return { until: win.until.toISOString() };
  });
}

/** 테스트 전용 — 보관 · 잠금 비우기 */
export function __resetPreviewStoreForTest(): void {
  previews.clear();
  inflight.clear();
}

/** 테스트 전용 — 보관 시각을 과거로(만료 검증) */
export function __agePreviewForTest(id: string, ms: number): void {
  const e = previews.get(id);
  if (e) e.createdAt -= ms;
}
