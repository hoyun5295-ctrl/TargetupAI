// ============================================================
// 자동 마케팅 [제안 받기] = 미리보기 (★ 2026-10-05 · 설계서 docs/2026-10-05-automarketing-preview-design.md)
//   미리보기 = 등록 없이 첫 회차와 같은 계산 · 허브 제안과 같은 키(ai-operator-propose) · 대상 0명이면 차감 0.
//   [시작] = 서버가 보관한 입력 그대로 등록(200 · 기존 멱등)하고 본 제안을 첫 회차로 저장한다(다시 만들지 않는다).
//   등록 라우트(POST /operator/continuous)의 축 매핑 · 입력 조립 · 오류 응답도 여기로 옮겼다 — 등록과 미리보기가 같은 함수를 탄다.
// ============================================================
import { randomUUID } from 'crypto';
import { suggestSegmentForObjective } from '../services/ai';
import { orchestrate } from '../services/ai-orchestrator';
import { InsufficientCreditError } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { listSegmentAvailability, assertSegmentUsable } from './operator-audience';
import { segmentNeedsCycleBaseline } from './automarketing-segment';
import {
  CreateOperatorInput, ContinuousOperator, OperatorProposal,
  createOperator, generateProposalForOperator, validateOperatorInput, operatorContextFields,
  explainEmptyRound, findOpenProposalForOperator,
  loadOperatorCompanyContext, buildOperatorOrchestrateContext,
} from './continuous-operator';

export interface RegistrationSegment {
  segmentKey: string | null;
  segmentParams: Record<string, number> | null;
  /** AI 매핑으로 고정된 축 — 화면이 즉시 알린다(사용자 몰래 고정되는 상태 금지) */
  appliedSegment: { key: string; label: string } | null;
}

/** 등록 1회 축 매핑(POST /operator/continuous 에서 그대로 옮김 · 등록 · 미리보기 공용) */
export async function resolveRegistrationSegment(companyId: string, userId: string, body: any): Promise<RegistrationSegment> {
  const { name, objective, target_hint, segment_key, segment_params } = body || {};
  // ★ 2026-08-04 계약 필수화(§5-B ③) — 축을 안 고른 등록(자연어·오늘의 추천·시나리오 미선택)은
  //   **등록 1회에 한해** AI가 목표를 그 회사에서 열려 있는 축으로 옮긴다. 이게 되면 회차마다 목표를
  //   다시 해석하지 않는다(결정성). 축으로 표현이 안 되거나 확신이 없으면 종전대로 자유 해석 —
  //   매핑 실패로 등록을 막지 않는다(기능 우선). 무엇으로 고정됐는지는 응답에 실어 화면이 바로 알린다.
  let finalSegmentKey: string | null = typeof segment_key === 'string' && segment_key.trim() ? segment_key : null;
  let finalSegmentParams: Record<string, number> | null =
    segment_params && typeof segment_params === 'object' && !Array.isArray(segment_params)
      ? (segment_params as Record<string, number>) : null;
  let appliedSegment: { key: string; label: string } | null = null;
  // ⛔ 매핑이 서는 조건 넷(2026-08-04 Codex 반영):
  //   ①축 미지정 ②화면에서 축 선택 UI를 본 등록이 아님(segment_choice_seen — 모달의 "자동 판단" 명시
  //     선택을 덮으면 화면이 거짓말이 된다) ③옛 축(target_hint)도 명시 안 함 — 마케팅 캘린더는 그 축으로
  //     대상을 골라 보낸다. 그 선택을 AI 계약이 덮으면 캘린더 화면이 보여준 축과 실제가 갈린다(2R #8)
  //   ④이름·목표가 실재(빈 등록은 어차피 저장이 거부되는데 AI 호출·호출 한도만 소모한다).
  if (
    !finalSegmentKey
    && body?.segment_choice_seen !== true
    && !(typeof target_hint === 'string' && target_hint.trim())
    && typeof objective === 'string' && objective.trim()
    && typeof name === 'string' && name.trim()
  ) {
    try {
      const openAxes = (await listSegmentAvailability(companyId)).filter((a) => a.available);
      const mapped = await suggestSegmentForObjective(companyId, userId || null, objective.trim(), openAxes);
      if (mapped) {
        // 저장 검증을 여기서 미리 통과시킨다 — 매핑된 축이 표 미생성 등으로 저장 불가면 매핑을 버리고
        //   자유 해석으로 등록한다(매핑 실패가 등록 전체를 503으로 만들면 안 된다 — 기능 우선).
        await assertSegmentUsable(companyId, mapped.key);
        finalSegmentKey = mapped.key;
        finalSegmentParams = mapped.params;
        appliedSegment = { key: mapped.key, label: openAxes.find((a) => a.key === mapped.key)?.label || mapped.key };
      }
    } catch (e: any) {
      console.warn('[Operator continuous POST] 축 매핑 생략(자유 해석 등록):', e?.message);
    }
  }
  return { segmentKey: finalSegmentKey, segmentParams: finalSegmentParams, appliedSegment };
}

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

// ── 미리보기 보관 ──
// ponytail: 프로세스 메모리 보관(pm2 fork 1개) · 재시작 = 만료(시작 요청 410 · 차감 0 · 다시 제안 받기). 프로세스를 늘리면 DB 보관으로.
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const PREVIEW_MAX = 500;
export const PREVIEW_EXPIRED_MESSAGE = '미리보기가 만료됐어요. 다시 [제안 받기]를 눌러 주세요.';
export const START_STATE_UNKNOWN_MESSAGE = '자동 마케팅은 시작했어요. 첫 제안이 저장됐는지 확인하지 못했으니 승인할 제안 목록을 다시 열어 확인해 주세요.';

interface PreviewEntry {
  companyId: string;
  userId: string;
  /** 등록 입력(매핑된 축 포함) — 시작은 이것만 쓴다(화면 값으로 다시 만들지 않는다) */
  input: CreateOperatorInput;
  appliedSegment: RegistrationSegment['appliedSegment'];
  /** 오케스트레이터 결과 = 첫 회차. null = 변화 축(첫 회차는 기준만 잡는다 · AI 를 부르지 않았다) */
  result: any | null;
  createdAt: number;
}
const previews = new Map<string, PreviewEntry>();
const inflight = new Set<string>();

export class PreviewBusyError extends Error {}
export class PreviewInputError extends Error {}

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

export interface PreviewOutcome {
  /** proposal = 시작 가능 · baseline = 변화 축(시작 가능 · 첫 회차는 기준만) · zero = 대상 0명(시작 불가 · 차감 0) */
  kind: 'proposal' | 'baseline' | 'zero';
  previewId: string | null;
  proposal: any | null;
  reason: string | null;
  appliedSegment: RegistrationSegment['appliedSegment'];
  /** 세부 설정에서 고치기 — 매핑된 축을 그대로 프리필(사용자가 보고 바꾼다) */
  segment: { key: string | null; params: Record<string, number> | null };
}

/** [제안 받기] — 등록 없이 첫 회차와 같은 계산. 같은 회사 · 같은 사람의 동시 요청은 PreviewBusyError(409) */
export async function runOperatorPreview(companyId: string, userId: string, body: any): Promise<PreviewOutcome> {
  const lockKey = `${companyId}:${userId}`;
  if (inflight.has(lockKey)) throw new PreviewBusyError('앞서 누른 제안을 만드는 중이에요. 끝난 뒤 다시 눌러 주세요.');
  inflight.add(lockKey);
  try {
    // 등록이 거절할 입력은 돈을 쓰기 전에 거른다(등록과 같은 검증 함수)
    const base = createOperatorInputFromBody(companyId, userId, body);
    try { validateOperatorInput(base as CreateOperatorInput); } catch (e: any) { throw new PreviewInputError(e?.message || '입력을 확인해 주세요.'); }
    const seg = await resolveRegistrationSegment(companyId, userId, body);
    const input: CreateOperatorInput = { ...base, segmentKey: seg.segmentKey, segmentParams: seg.segmentParams };
    let fields: ReturnType<typeof operatorContextFields>;
    try { fields = operatorContextFields(input); } catch (e: any) { throw new PreviewInputError(e?.message || '발송 대상 조건을 확인해 주세요.'); }
    const common = { appliedSegment: seg.appliedSegment, segment: { key: fields.segmentKey, params: fields.segmentParams } };

    // 변화 축 — 첫 회차는 비교 기준만 잡는다(회차 생성과 같은 규칙). 미리 보여 줄 제안이 없으니 AI 를 부르지 않는다(0크레딧).
    if (segmentNeedsCycleBaseline(fields.segmentKey)) {
      const previewId = putPreview({ companyId, userId, input, appliedSegment: seg.appliedSegment, result: null, createdAt: Date.now() });
      return { kind: 'baseline', previewId, proposal: null, reason: null, ...common };
    }

    const loaded = await loadOperatorCompanyContext(companyId);
    if (!loaded) throw new PreviewInputError('회사 정보를 찾을 수 없습니다.');
    const result = await orchestrate(
      buildOperatorOrchestrateContext({ ...fields, id: null }, loaded),
      { source: 'ai-operator-propose', cost: getCreditCost('ai-operator-propose'), chargeOnlyWithTarget: true },
    );
    // 대상 0명 = 시작할 수 없는 제안 — 보관하지 않는다(시작 요청 = 410). 0건 자동완화 금지 · 사유만 돌려준다.
    if ((result.target?.count || 0) === 0) {
      return { kind: 'zero', previewId: null, proposal: null, reason: result.meta?.countError || null, ...common };
    }
    // 문안 0개 = 차감도 0(오케스트레이터 규칙) — 빈 제안을 첫 회차로 저장하지 않는다
    if ((result.messages?.length || 0) === 0) throw new Error('문안 생성 결과 없음');
    const previewId = putPreview({ companyId, userId, input, appliedSegment: seg.appliedSegment, result, createdAt: Date.now() });
    return { kind: 'proposal', previewId, proposal: result, reason: null, ...common };
  } finally {
    inflight.delete(lockKey);
  }
}

/**
 * [이대로 자동 마케팅 시작] — 보관한 입력으로 등록(200 · 멱등키 continuous-operator:{id})하고 본 제안을 첫 회차로 저장.
 * null = 만료 · 남의 것(410 · 차감 0). 잔액 부족이면 보관본을 되돌려 충전 뒤 다시 누를 수 있게 한다.
 */
export async function startOperatorFromPreview(previewId: string, companyId: string, userId: string): Promise<{
  operator: ContinuousOperator;
  appliedSegment: RegistrationSegment['appliedSegment'];
  proposal: OperatorProposal | null;
  message: string | null;
} | null> {
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
  // 등록은 끝났다 — 첫 회차 저장이 실패해도 등록 · 차감은 유효하다(정해진 회차에 다시 만든다). 500 으로 돌려 다시 누르게 하면 두 번 등록된다.
  let proposal: OperatorProposal | null = null;
  try {
    proposal = await generateProposalForOperator(operator.id, entry.result ? { precomputed: entry.result } : undefined);
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
  return { operator, appliedSegment: entry.appliedSegment, proposal, message };
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
