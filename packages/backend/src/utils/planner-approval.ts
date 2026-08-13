/**
 * planner-approval.ts — 마케팅 플래너 월간 브리핑·결재 CT (★ 2026-08-13 Phase 2 · 취소·환불 Phase 3)
 *
 * 설계서 = docs/2026-08-12-ax-marketing-planner-design.md (요금 §3 · 승인 흐름 §5-3)
 * 기능 상설 = docs/FEATURE-MARKETING-PLANNER.md (불변 원칙 §3 · 요금 §5)
 *
 * 이 파일이 소유하는 것:
 *   월간 브리핑 조립(행사·터치포인트·타겟 수 실쿼리·예상 크레딧·잔액) · 승인 게이트 판정 ·
 *   차감 멱등키 · 결재 링크 토큰 · 결재 통지 문구 · 제출/승인/취소 전이 · 취소 환불.
 * 라우트(routes/marketing-planner.ts)는 이 CT를 부르고 오류를 HTTP로 옮기기만 한다.
 *
 * ⛔ 불변 (어기면 이 기능의 정체성이 무너진다)
 *   - **미승인 = 미발송 = 미차감.** 승인 게이트는 잔액 ≥ (아직 안 낸 대행분 + 그 달 예상 제작 합계).
 *   - 대행 단가의 진실 = getCreditCost('planner-monthly-agency') 하나. 이 파일에 숫자를 쓰지 않는다.
 *   - 차감 멱등키는 **회사·월 고정** — 더블클릭·재시도·재제출·재승인이 전부 한 키로 수렴한다(이중 차감 0).
 *   - **승인 시도에는 주인이 있다.** 선점은 pending→approving 한 방향이고 attempt(uuid)를 새긴다.
 *     복구·확정은 자기 attempt에만 건다 — 상태 문자열만으로 소유권을 흉내 내면 동시 요청이 서로를 덮어쓴다.
 *   - **승인 대상은 제출 스냅샷(event_ids)이다.** 결재 서류에 없던 행사는 승인되지 않는다.
 *     계획을 고치면 다시 결재에 올려야 한다 — 그때 대행료는 멱등키가 막아 다시 나가지 않는다.
 *   - **차감이 이미 일어난 시도는 확정만 남는다.** 그 경로가 잔액·월 경계 검사에 다시 걸리면
 *     돈만 빠진 채 영영 못 닫는다(대행분을 이미 낸 만큼 게이트에서 뺀다).
 *   - 브리핑 수치는 전부 실쿼리다. **셀 수 없는 축(deferred)과 못 센 축(error)을 같은 null로 뭉치지 않는다** —
 *     실릴 채널의 대상 수를 못 세면 승인은 fail-closed로 막는다.
 *   - 마이너스·자동충전 금지 — source를 OPERATION_SOURCES에 넣지 않는 것이 그 장치다(ai-credit-calc).
 *   - 토큰은 **딥링크 식별자일 뿐 결재 권한이 아니다.** 승인은 언제나 로그인한 고객사 사용자가 한다.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { pool, query } from '../config/database';
import { getCreditCost, kstMonthTag } from './ai-credit-calc';
import { getCreditState, deductCredit, InsufficientCreditError } from './ai-credit';
import { countCustomerEmailRecipients } from './email-channel';
import { notifyOperatorAdmins } from './continuous-operator';
import {
  PlannerChannel,
  PLANNER_CHANNEL_LABEL,
  TimingRule,
  computeTouchpointDate,
  estimateChannelCredits,
} from './marketing-planner';
// ★ 2026-08-13 Phase 3 — 대상 수는 실행과 같은 단일 문으로만 센다("보여준 수 = 나가는 수").
import { countPlannerAudience } from './planner-audience';
import {
  resolveAudienceMode, evaluateCancelRefund, plannerRefundKey, plannerAgencyDeductKey, PLANNER_NOTICE_HEADER,
} from './planner-execution';
import { refundCreditWithClient } from './ai-credit-tx';
import { countMonthWork } from './planner-touchpoint';

// ── 요금 축 ──────────────────────────────────────────────────────────
/** 대행 크레딧 source. 단가는 CREDIT_COST_MAP이 소유한다. */
export const PLANNER_AGENCY_SOURCE = 'planner-monthly-agency';

/** 그 달 대행 크레딧(= 승인 시 1회 차감분). */
export function getAgencyCredits(): number {
  return getCreditCost(PLANNER_AGENCY_SOURCE);
}

/**
 * 차감 멱등키 — 회사·월·**결제 회차**(설계서 §3-4 + ★2026-08-13 회차 축).
 * 회차 0 = 종전 키. 회차는 그 달의 환불 수다 — 환불 뒤 재승인은 새 회차라 다시 결제된다.
 */
export function buildApprovalIdempotencyKey(companyId: string, planMonth: string, cycle = 0): string {
  return plannerAgencyDeductKey(companyId, planMonth, cycle);
}

/**
 * 그 달의 결제 회차 = 지금까지 난 대행 환불 수.
 * 조회 실패는 전파한다 — 회차를 모른 채 차감·환불 키를 만들면 이중 결제·이중 환불의 문이 열린다.
 */
async function loadChargeCycle(companyId: string, planMonth: string): Promise<number> {
  const r = await query(
    `SELECT COUNT(*)::int AS cnt FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND type = 'refund' AND source = $2
        AND idempotency_key LIKE $3`,
    [companyId, PLANNER_AGENCY_SOURCE, `${plannerRefundKey(companyId, planMonth)}%`],
  );
  return Number(r.rows[0]?.cnt) || 0;
}

// ── 결재 링크 토큰 ───────────────────────────────────────────────────
/**
 * 결재 링크는 **DB에 저장한 랜덤 토큰**이다(정산 컨펌 축 invoice-confirm.ts와 같은 형태).
 * 서명만 하는 무상태 토큰은 폐기·1회성을 만들 수 없어, 재제출해도 옛 링크가 계속 살아 있다.
 */
export const APPROVAL_TOKEN_TTL_DAYS = 14;

export function generateApprovalToken(): string {
  return randomBytes(24).toString('hex'); // 48자 — 컬럼 varchar(64)
}

export function computeTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + APPROVAL_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ── 월 축 ────────────────────────────────────────────────────────────
/** KST 기준 이번 달 'YYYY-MM'. 시간 계산의 주인은 kstMonthTag 하나다. */
export function currentPlanMonth(now: Date = new Date()): string {
  const tag = kstMonthTag(now); // 'YYYYMM'
  return `${tag.slice(0, 4)}-${tag.slice(4)}`;
}

/** (순수) 지난 달 결재는 받지 않는다 — 이미 지난 계획을 승인하면 대행료만 나가고 실행할 날이 없다. */
export function isPastPlanMonth(planMonth: string, now: Date = new Date()): boolean {
  return planMonth < currentPlanMonth(now);
}

// ── 브리핑 ───────────────────────────────────────────────────────────
/**
 * 대상 수의 상태 — null 하나에 두 뜻을 담지 않는다.
 *  known    = 실쿼리로 셌다.
 *  deferred = 지금 셀 수 있는 축이 아니다(인앱 노출·알림톡 참여자 — 설계상 사후 확정).
 *  error    = 세려 했는데 실패했다. **이 상태로는 승인을 열지 않는다**(fail-closed).
 */
export type AudienceState = 'known' | 'deferred' | 'error';

export interface ChannelAudience {
  count: number | null;
  state: AudienceState;
  /** 그 수가 무엇인지 / 왜 수가 없는지 — 고객 언어. */
  note: string;
}

export interface BriefTouchpoint {
  id: string;
  channel: PlannerChannel;
  label: string;
  timing: TimingRule;
  scheduledOn: string;
  /** 소재 제작 예상 크레딧. null = 실행 시 별도(문자 당일 문안·알림톡 검수 대행) */
  estCredits: number | null;
  audience: ChannelAudience;
  /** ★ 2026-08-13 Phase 3 — 실행 상태(planned·ready·sent·hold_credit·locked·skipped…). 화면이 보류를 말하고 [다시 시작]을 띄운다. */
  status: string;
  /** 보류·생략 사유(고객 언어). 조용한 증발을 만들지 않는다. */
  lockReason: string | null;
}


export interface BriefEvent {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string;
  benefitText: string | null;
  products: Array<{ name: string }>;
  status: string;
  touchpoints: BriefTouchpoint[];
  estCredits: number;
}

export interface BriefTotals {
  eventCount: number;
  touchpointCount: number;
  productionCredits: number;
  agencyCredits: number;
  totalCredits: number;
}

export interface ApprovalRecord {
  status: 'pending' | 'approving' | 'approved' | 'cancelled';
  submittedAt: string | null;
  approvedAt: string | null;
  agencyCredits: number;
  deductedAt: string | null;
  tokenExpiresAt: string | null;
  /** 제출 스냅샷에 담긴 행사 수 — 화면이 "서류와 지금 계획이 같은가"를 말할 수 있게 한다. */
  eventCount: number;
}

export interface MonthlyBrief {
  month: string;
  events: BriefEvent[];
  totals: BriefTotals;
  balance: { total: number; creditEnabled: boolean };
  gate: { ok: boolean; shortfall: number; reason: string | null };
  approval: ApprovalRecord | null;
  /** 제출 뒤 계획이 바뀌었다 — 다시 결재에 올려야 그 변경이 승인 대상이 된다. */
  revisionChanged: boolean;
  /** 그 달 대행분이 이미 차감됐는가(재결재 시 다시 청구하지 않는다). */
  agencyPaid: boolean;
  pastMonth: boolean;
}

/** (순수) 합계 — 제작분만 센다. null(실행 축)은 합계에 들어가지 않는다. */
export function computeBriefTotals(events: BriefEvent[]): BriefTotals {
  let touchpointCount = 0;
  let productionCredits = 0;
  for (const ev of events) {
    touchpointCount += ev.touchpoints.length;
    productionCredits += ev.estCredits;
  }
  const agencyCredits = getAgencyCredits();
  return {
    eventCount: events.length,
    touchpointCount,
    productionCredits,
    agencyCredits,
    totalCredits: agencyCredits + productionCredits,
  };
}

/** (순수) 실릴 채널 중 대상 수를 못 센 축이 있는가 — 있으면 승인을 열지 않는다. */
export function hasAudienceError(events: BriefEvent[]): boolean {
  return events.some((ev) => ev.touchpoints.some((t) => t.audience.state === 'error'));
}

/**
 * (순수) 승인 게이트.
 *  - 필요액 = (대행분 — 이미 냈으면 0) + 그 달 예상 제작 합계.
 *    승인 즉시 빠지는 건 대행분뿐이지만, 제작비를 낼 수 없는 달을 승인시키면 월 중에 행사가 보류로 멈춘다.
 *  - 대상 수를 못 센 축이 있으면 막는다 — 결재 서류의 수치가 비어 있는 채로 1000을 결제시키지 않는다.
 *  - 크레딧제 미적용 회사(요금제 크레딧 미설정 + 구매분 0)는 차감 축 자체가 없으므로 금액 게이트도 없다.
 */
export function evaluateApprovalGate(input: {
  totals: BriefTotals;
  balance: { total: number; creditEnabled: boolean };
  eventCount: number;
  /** 그 달 대행분이 이미 차감됐는가 — 재결재에서 대행료를 두 번 요구하지 않기 위한 축. */
  agencyPaid?: boolean;
  /** 실릴 채널 중 대상 수 산출이 실패한 축이 있는가. */
  audienceError?: boolean;
}): { ok: boolean; shortfall: number; reason: string | null } {
  if (input.eventCount === 0) {
    return { ok: false, shortfall: 0, reason: '이번 달 계획에 담긴 행사가 없습니다.' };
  }
  if (input.audienceError) {
    return {
      ok: false,
      shortfall: 0,
      reason: '대상 고객 수를 확인하지 못했습니다. 잠시 후 다시 열어 확인한 뒤 승인해 주세요.',
    };
  }
  if (!input.balance.creditEnabled) return { ok: true, shortfall: 0, reason: null };
  const required = (input.agencyPaid ? 0 : input.totals.agencyCredits) + input.totals.productionCredits;
  const shortfall = required - input.balance.total;
  if (shortfall > 0) {
    return {
      ok: false,
      shortfall,
      reason: `크레딧이 ${shortfall.toLocaleString()} 부족합니다. 충전 후 승인할 수 있습니다.`,
    };
  }
  return { ok: true, shortfall: 0, reason: null };
}

/** (순수) 채널별 대상 설명 — 셀 수 없는 축은 "왜 수가 없는지"를 말한다. */
export function channelAudienceNote(channel: PlannerChannel): string {
  switch (channel) {
    case 'sms':
      return '문자 수신 가능 고객 (수신거부·유효번호·발송 피로도 게이트 적용)';
    case 'dm':
      return '모바일 DM 링크를 실어 보낼 문자 수신 가능 고객';
    case 'email':
      return '이메일 수신 가능 고객 (수신거부·무효 주소 제외)';
    case 'inapp':
      return '노출 대상은 방문 시점에 정해집니다 — 사전 인원이 없습니다';
    case 'alimtalk':
      return '정보성 안내 대상(행사 참여 신청자)은 행사 진행 중 확정됩니다';
  }
}

const AUDIENCE_ERROR_NOTE = '대상 수를 확인하지 못했습니다 — 다시 열어 확인한 뒤 승인할 수 있습니다';
const AUDIENCE_SCOPE_NOTE = '담당 매장 범위를 확인할 수 없어 대상을 정할 수 없습니다';

/**
 * 행사 축 대상 수 실쿼리 (★ 2026-08-13 Phase 3 정정 — 회사 단위 → **행사 단위**).
 *
 * ⛔ 왜 행사 단위인가: 실행은 **행사를 만든 계정의 매장 범위**로 좁혀 보낸다(보내기는 좁게).
 *   회사 전체 수를 서류에 적고 좁게 보내면 그 수가 거짓말이 된다. 세는 문·뽑는 문이 하나여야
 *   "보여준 수 = 나가는 수"가 구조로 성립한다 — 그 문이 `planner-audience`다.
 *  - 문자·DM = planner-audience(자동마케팅 게이트 + 매장 범위 + 참여자 축)
 *  - 이메일 = 이메일 채널 CT의 수신 가능 고객 수(그 발송 경로에 매장 범위가 없어 회사 단위가 맞다)
 *  - 인앱·알림톡 = 사후 확정(deferred). 알림톡 대상은 행사 참여 신청자라 승인 시점에 셀 수 없다.
 *  실패는 error로 내린다 — 0으로 내리면 "대상 없음"으로 읽히고, null이면 승인이 열린다.
 */
async function loadAudienceForEvent(input: {
  companyId: string;
  createdBy: string | null;
  eventId: string;
  /** 그 행사에 참여자 축 터치포인트가 있는가(있을 때만 참여자 수를 센다). */
  needsParticipants: boolean;
  emailCount: number | null;
}): Promise<{ all: Record<PlannerChannel, ChannelAudience>; participants: ChannelAudience }> {
  const messaging = await countPlannerAudience({
    companyId: input.companyId, createdBy: input.createdBy, mode: 'all', plannerEventId: input.eventId,
  }).catch((e: any) => {
    console.warn('[planner-approval] 문자 대상 수 산출 실패(승인 차단):', e?.message || e);
    return null;
  });
  const participantCount = input.needsParticipants
    ? await countPlannerAudience({
        companyId: input.companyId, createdBy: input.createdBy, mode: 'participants', plannerEventId: input.eventId,
      }).catch(() => null)
    : null;

  const messagingAudience = (channel: PlannerChannel): ChannelAudience => {
    if (messaging == null) return { count: null, state: 'error', note: AUDIENCE_ERROR_NOTE };
    if (messaging.blocked) return { count: null, state: 'error', note: AUDIENCE_SCOPE_NOTE };
    return { count: messaging.count, state: 'known', note: channelAudienceNote(channel) };
  };
  return {
    all: {
      sms: messagingAudience('sms'),
      dm: messagingAudience('dm'),
      email: input.emailCount == null
        ? { count: null, state: 'error', note: AUDIENCE_ERROR_NOTE }
        : { count: input.emailCount, state: 'known', note: channelAudienceNote('email') },
      inapp: { count: null, state: 'deferred', note: channelAudienceNote('inapp') },
      alimtalk: { count: null, state: 'deferred', note: channelAudienceNote('alimtalk') },
    },
    participants: participantCount == null || participantCount.blocked
      ? { count: null, state: 'deferred', note: '행사 참여 신청자는 행사 진행 중 확정됩니다' }
      : { count: participantCount.count, state: 'known', note: '행사 참여를 신청한 고객' },
  };
}

/** 그 달 승인 원장 1행(없으면 null). */
async function loadApprovalRow(companyId: string, planMonth: string): Promise<any | null> {
  const r = await query(
    `SELECT id, status, agency_credits, est_snapshot, deduct_idempotency_key, deducted_at,
            token, token_expires_at, submitted_at, approved_at, approve_attempt, event_ids, plan_hash
       FROM planner_monthly_approvals
      WHERE company_id = $1::uuid AND plan_month = $2`,
    [companyId, planMonth],
  );
  return r.rows[0] || null;
}

/**
 * 그 달 대행분이 실제로 차감됐는가 — 진실은 크레딧 원장이다(승인 원장의 표기가 아니라).
 * ⛔ 멱등키 문자열에 회사 uuid가 들어 있어도 그것은 **SQL의 테넌트 경계가 아니다.**
 *    회사·유형·source까지 조건으로 걸어야 다른 회사 행 하나가 이 회사의 복구 경로를 여는 일이 없다.
 */
async function hasAgencyDeduction(companyId: string, idempotencyKey: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM ai_credit_transactions
      WHERE idempotency_key = $1 AND company_id = $2::uuid AND type = 'deduct' AND source = $3
      LIMIT 1`,
    [idempotencyKey, companyId, PLANNER_AGENCY_SOURCE],
  );
  return r.rows.length > 0;
}

/**
 * 그 달 대행분이 **지금도 결제 상태인가** — 이번 회차의 차감이 있는가.
 *
 * ⛔ 차감 행만 월 단위로 보면 **환불된 달이 영원히 "이미 냈다"로 남는다.** 그러면
 *   승인 → 무작업 취소·환불 → 같은 달 새 계획 제출 → 승인이 **무료**로 성립한다(복구 경로로 들어가
 *   게이트를 건너뛰고, 차감은 같은 멱등키라 duplicate로 끝나 돈이 다시 나가지 않는다).
 *   회차 키를 쓰면 환불로 회차가 올라가 그 회차의 차감이 없으니 **미결제**가 되고, 승인은 정상 결제한다.
 */
async function loadAgencyPaymentState(companyId: string, planMonth: string): Promise<{ cycle: number; key: string; paid: boolean }> {
  const cycle = await loadChargeCycle(companyId, planMonth);
  const key = buildApprovalIdempotencyKey(companyId, planMonth, cycle);
  return { cycle, key, paid: await hasAgencyDeduction(companyId, key) };
}

function toApprovalRecord(row: any | null): ApprovalRecord | null {
  if (!row) return null;
  return {
    status: row.status,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    agencyCredits: Number(row.agency_credits) || 0,
    deductedAt: row.deducted_at ? new Date(row.deducted_at).toISOString() : null,
    tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at).toISOString() : null,
    eventCount: Array.isArray(row.event_ids) ? row.event_ids.length : 0,
  };
}

/**
 * (순수) 결재 서류의 지문 — **행사 ID 집합만으로는 서류가 고정되지 않는다.**
 * 같은 행사의 혜택·기간·상품·채널·시점·단가를 바꿔도 ID는 그대로라, 제출 당시와 다른 계획이 승인될 수 있다.
 * 그래서 결재 대상 필드 전부를 정규화해 해시로 굳힌다. 하나라도 바뀌면 다시 결재에 올려야 한다.
 */
export function computePlanHash(events: BriefEvent[]): string {
  const canonical = [...events]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((ev) => ({
      i: ev.id,
      t: ev.title,
      s: ev.startsOn,
      e: ev.endsOn,
      b: ev.benefitText || '',
      p: (ev.products || []).map((x) => x.name),
      c: [...ev.touchpoints]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((t) => ({
          i: t.id,
          ch: t.channel,
          a: t.timing?.anchor || '',
          o: t.timing?.offsetDays || 0,
          d: t.scheduledOn,
          cr: t.estCredits,
          // ★ 2026-08-13 Phase 3: 대상 축(전체/참여자)도 결재 대상이다 — 축이 바뀌면 나가는 사람이 바뀐다.
          au: resolveAudienceMode(t.channel, t.timing),
        })),
    }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** 월간 브리핑 조립 — 결재 화면과 승인 게이트가 같은 값을 본다(화면 수 ≠ 판정 수를 만들지 않는다). */
export async function loadMonthlyBrief(companyId: string, planMonth: string): Promise<MonthlyBrief> {
  const [evRes, emailCount, creditState, approvalRow, payment] = await Promise.all([
    query(
      `SELECT id, title, starts_on, ends_on, benefit_text, products, status, created_by
         FROM planner_events
        WHERE company_id = $1::uuid AND plan_month = $2 AND status <> 'cancelled'
        ORDER BY starts_on ASC, created_at ASC`,
      [companyId, planMonth],
    ),
    countCustomerEmailRecipients(companyId).catch((e: any) => {
      console.warn('[planner-approval] 이메일 대상 수 산출 실패(승인 차단):', e?.message || e);
      return null;
    }),
    getCreditState(companyId),
    loadApprovalRow(companyId, planMonth),
    loadAgencyPaymentState(companyId, planMonth),
  ]);

  const eventIds = evRes.rows.map((r: any) => r.id);
  const tpByEvent = new Map<string, any[]>();
  if (eventIds.length > 0) {
    // 회사 조건을 자식 조회에도 직접 건다 — 부모로만 격리하면 회사가 섞인 자식 행이 합계에 들어온다.
    const tp = await query(
      `SELECT id, event_id, channel, timing_rule, format, est_credits, status, lock_reason
         FROM planner_touchpoints
        WHERE event_id = ANY($1) AND company_id = $2::uuid
        ORDER BY created_at ASC`,
      [eventIds, companyId],
    );
    for (const row of tp.rows as any[]) {
      const arr = tpByEvent.get(String(row.event_id)) || [];
      arr.push(row);
      tpByEvent.set(String(row.event_id), arr);
    }
  }

  const events: BriefEvent[] = [];
  for (const r of evRes.rows as any[]) {
    const startsOn = String(r.starts_on).slice(0, 10);
    const endsOn = String(r.ends_on).slice(0, 10);
    const rawTps = tpByEvent.get(String(r.id)) || [];
    // 참여자 축 터치포인트가 있을 때만 참여자 수를 센다(없으면 셀 이유가 없다).
    const needsParticipants = rawTps.some(
      (t: any) => resolveAudienceMode(t.channel as PlannerChannel, t.timing_rule) === 'participants',
    );
    const audience = await loadAudienceForEvent({
      companyId,
      createdBy: r.created_by ? String(r.created_by) : null,
      eventId: String(r.id),
      needsParticipants,
      emailCount,
    });
    const touchpoints: BriefTouchpoint[] = rawTps.map((t: any) => {
      const channel = t.channel as PlannerChannel;
      const mode = resolveAudienceMode(channel, t.timing_rule);
      return {
        id: String(t.id),
        channel,
        label: PLANNER_CHANNEL_LABEL[channel] || channel,
        timing: t.timing_rule,
        // 발송 예정일은 저장하지 않고 계산한다(행사 기간 수정에 자동으로 따라온다 — 이중 진실 금지).
        scheduledOn: computeTouchpointDate(t.timing_rule, startsOn, endsOn),
        estCredits: estimateChannelCredits(channel),
        // 알림톡은 언제나 참여자 축이고(정보성 안내), 그 밖 채널은 기입에서 고른 축을 따른다.
        audience: mode === 'participants' && channel !== 'alimtalk' ? audience.participants : audience.all[channel],
        status: String(t.status || 'planned'),
        lockReason: t.lock_reason || null,
      };
    });
    events.push({
      id: String(r.id),
      title: r.title,
      startsOn,
      endsOn,
      benefitText: r.benefit_text,
      products: Array.isArray(r.products) ? r.products : [],
      status: r.status,
      touchpoints,
      estCredits: touchpoints.reduce((s, t) => s + (t.estCredits ?? 0), 0),
    });
  }

  const totals = computeBriefTotals(events);
  const balance = { total: creditState.total, creditEnabled: creditState.creditEnabled };
  const planHash = computePlanHash(events);
  return {
    month: planMonth,
    events,
    totals,
    balance,
    gate: evaluateApprovalGate({
      totals,
      balance,
      eventCount: events.length,
      agencyPaid: payment.paid,
      audienceError: hasAudienceError(events),
    }),
    approval: toApprovalRecord(approvalRow),
    // 서류의 동일성은 지문으로 본다 — 행사 ID가 같아도 내용이 바뀌면 다른 서류다.
    revisionChanged: !!approvalRow && String(approvalRow.plan_hash || '') !== planHash,
    agencyPaid: payment.paid,
    pastMonth: isPastPlanMonth(planMonth),
  };
}

// ── 오류 ─────────────────────────────────────────────────────────────
export class PlannerApprovalError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
    this.name = 'PlannerApprovalError';
  }
}

// ── 통지 ─────────────────────────────────────────────────────────────
/**
 * 플래너 통지 머리말 — 정의는 `planner-execution`(순수 CT)이 소유한다.
 * ★ 2026-08-13 Phase 3: 제작·실행·대조 워커도 같은 머리말을 쓰는데, 결재 CT에 두면
 *   원장 접근 CT가 결재 CT를 import해 순환이 생겼다. 여기서는 기존 소비처 호환을 위해 재수출만 한다.
 */
export { PLANNER_NOTICE_HEADER };

/** 결재 링크(절대 URL) — 백엔드가 토큰을 확인하고 결재 화면으로 보낸다. */
export function buildApprovalLink(token: string): string {
  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  return `${base}/api/marketing-planner/approval/${token}`;
}

/** (순수) 결재 요청 문자 본문 — 담당자 안내(정보성). 혜택·할인 표현을 넣지 않는다. */
export function buildApprovalNoticeBody(input: {
  planMonth: string;
  totals: BriefTotals;
  link: string;
}): string {
  const monthLabel = `${Number(input.planMonth.slice(5, 7))}월`;
  return [
    `${monthLabel} 마케팅 계획 결재 요청입니다.`,
    `행사 ${input.totals.eventCount}건 · 채널 ${input.totals.touchpointCount}개`,
    `예상 크레딧 ${input.totals.totalCredits.toLocaleString()} (대행 ${input.totals.agencyCredits.toLocaleString()} + 제작 ${input.totals.productionCredits.toLocaleString()})`,
    `아래에서 확인하고 승인해 주세요.`,
    input.link,
    `승인 전에는 제작·발송·차감이 일어나지 않습니다.`,
  ].join('\n');
}

// ── 제출(브리핑 올리기) ──────────────────────────────────────────────
/**
 * 그 달 계획을 결재에 올린다 — 승인 원장 pending + **그 시점 행사 목록 고정** + 행사 briefed 전이 + 결재 문자 1통.
 *
 * 승인된 달도 다시 올릴 수 있다(월 중 행사 추가·변경 — 설계서 §5-3). 대행료는 멱등키가 막아 다시 나가지 않는다.
 * ⛔ 승인 처리 중(approving)인 달만 건드리지 않는다 — 그 사이 상태를 되돌리면 차감을 마친 요청이 확정에 실패한다.
 */
export async function submitMonthlyBrief(
  companyId: string,
  planMonth: string,
  userId: string | null,
): Promise<{ status: string; notified: boolean; totals: BriefTotals }> {
  if (isPastPlanMonth(planMonth)) {
    throw new PlannerApprovalError('지난 달 계획은 결재에 올릴 수 없습니다.', 'PAST_MONTH');
  }
  const brief = await loadMonthlyBrief(companyId, planMonth);
  if (brief.events.length === 0) {
    throw new PlannerApprovalError('이번 달 계획에 담긴 행사가 없습니다.', 'NO_EVENTS');
  }

  const token = generateApprovalToken();
  const expiresAt = computeTokenExpiry();
  const snapshot = { ...brief.totals, month: planMonth };
  const eventIds = brief.events.map((e) => e.id);
  const planHash = computePlanHash(brief.events);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const up = await client.query(
      `INSERT INTO planner_monthly_approvals
         (company_id, plan_month, status, agency_credits, est_snapshot, event_ids, plan_hash,
          token, token_expires_at, submitted_by, submitted_at)
       VALUES ($1::uuid, $2, 'pending', $3, $4::jsonb, $5::uuid[], $6, $7, $8, $9, NOW())
       ON CONFLICT (company_id, plan_month) DO UPDATE
          SET status = 'pending', agency_credits = EXCLUDED.agency_credits, est_snapshot = EXCLUDED.est_snapshot,
              event_ids = EXCLUDED.event_ids, plan_hash = EXCLUDED.plan_hash,
              token = EXCLUDED.token, token_expires_at = EXCLUDED.token_expires_at,
              submitted_by = EXCLUDED.submitted_by, submitted_at = NOW(),
              approve_attempt = NULL, updated_at = NOW()
        WHERE planner_monthly_approvals.status <> 'approving'
       RETURNING id`,
      [companyId, planMonth, brief.totals.agencyCredits, JSON.stringify(snapshot), eventIds, planHash, token, expiresAt, userId],
    );
    if (up.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new PlannerApprovalError('승인 처리 중입니다. 잠시 후 화면을 새로고침해 주세요.', 'IN_PROGRESS', 409);
    }
    await client.query(
      `UPDATE planner_events SET status = 'briefed', updated_at = NOW()
        WHERE company_id = $1::uuid AND plan_month = $2 AND status IN ('draft', 're_brief')`,
      [companyId, planMonth],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }

  // 통지 실패가 제출을 되돌리지는 않는다 — 화면에도 결재 대기가 떠 있다(경로가 둘이다).
  let notified = false;
  try {
    notified = await notifyOperatorAdmins(
      { adminPhoneNumbers: [], backupAdminPhone: null, companyId, createdBy: userId },
      '[마케팅 플래너] 월간 결재 요청',
      buildApprovalNoticeBody({ planMonth, totals: brief.totals, link: buildApprovalLink(token) }),
      { noticeHeader: PLANNER_NOTICE_HEADER },
    );
  } catch (e: any) {
    console.warn('[planner-approval] 결재 요청 문자 실패:', e?.message || e);
  }
  console.log(`[planner-approval] 브리핑 제출 ${companyId} ${planMonth} — 행사 ${eventIds.length} · 통지 ${notified ? '발송' : '미발송'}`);
  return { status: 'pending', notified, totals: brief.totals };
}

// ── 승인(차감) ───────────────────────────────────────────────────────
/**
 * 선점 — **서류를 함께 집는다.** 승인이 쓸 행사 목록·금액은 이 UPDATE가 돌려준 값뿐이다.
 * 선점 전에 읽어 둔 값으로 승인하면, 그 사이 재제출된 다른 서류를 집고도 옛 계획을 확정하게 된다.
 *
 * lease — 차감 전에 프로세스가 끊기면 approving만 남고 아무도 그 달을 못 만진다(재제출도 approving을 거부한다).
 * 그래서 **오래 멈춘 시도는 회수한다.** 차감이 이미 일어난 시도는 회수돼도 안전하다 — 멱등키가 재차감을 막고
 * 다음 승인이 확정만 밟는다.
 */
const APPROVE_LEASE_MINUTES = 10;

async function claimApproval(companyId: string, planMonth: string, attempt: string): Promise<{
  eventIds: string[]; agencyCredits: number; planHash: string; cycle: number;
} | null> {
  // ⛔ **결제 회차도 이 선점 UPDATE가 함께 돌려준다.** 선점 전에 계산하면 그 사이 다른 요청이
  //   승인→취소·환불→재제출을 끝냈을 때 **옛 회차 키**로 확정해 duplicate를 결제로 오인한다(무료 승인 ABA).
  //   같은 문장 안 서브쿼리라 선점과 같은 스냅샷이다.
  const r = await query(
    `UPDATE planner_monthly_approvals a
        SET status = 'approving', approve_attempt = $3::uuid, updated_at = NOW()
      WHERE a.company_id = $1::uuid AND a.plan_month = $2
        AND (a.status = 'pending'
             OR (a.status = 'approving' AND a.updated_at < NOW() - INTERVAL '${APPROVE_LEASE_MINUTES} minutes'))
      RETURNING a.event_ids, a.agency_credits, a.plan_hash,
                (SELECT COUNT(*)::int FROM ai_credit_transactions t
                  WHERE t.company_id = a.company_id AND t.type = 'refund' AND t.source = $4
                    AND t.idempotency_key LIKE $5) AS cycle`,
    [companyId, planMonth, attempt, PLANNER_AGENCY_SOURCE, `${plannerRefundKey(companyId, planMonth)}%`],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    eventIds: Array.isArray(row.event_ids) ? row.event_ids.map(String) : [],
    agencyCredits: Number(row.agency_credits) || 0,
    planHash: String(row.plan_hash || ''),
    cycle: Number(row.cycle) || 0,
  };
}

/** 선점 해제 — 내 시도만 되돌린다(남의 시도를 건드리지 않는다). */
async function releaseApproval(companyId: string, planMonth: string, attempt: string): Promise<void> {
  await query(
    `UPDATE planner_monthly_approvals SET status = 'pending', approve_attempt = NULL, updated_at = NOW()
      WHERE company_id = $1::uuid AND plan_month = $2 AND status = 'approving' AND approve_attempt = $3::uuid`,
    [companyId, planMonth, attempt],
  ).catch((e: any) => console.warn('[planner-approval] 선점 해제 실패:', e?.message || e));
}

/** 확정 — 자기 시도(attempt)에만 걸고, 선점이 돌려준 서류의 행사만 전이한다. */
async function confirmApproval(input: {
  companyId: string;
  planMonth: string;
  userId: string | null;
  attempt: string;
  eventIds: string[];
  agencyCredits: number;
  idempotencyKey: string;
  deducted: boolean;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const confirmed = await client.query(
      `UPDATE planner_monthly_approvals
          SET status = 'approved', approved_by = $3, approved_at = NOW(),
              agency_credits = $4, deduct_idempotency_key = $5,
              deducted_at = CASE WHEN $6 AND deducted_at IS NULL THEN NOW() ELSE deducted_at END,
              approve_attempt = NULL, updated_at = NOW()
        WHERE company_id = $1::uuid AND plan_month = $2
          AND status = 'approving' AND approve_attempt = $7::uuid
        RETURNING id`,
      [input.companyId, input.planMonth, input.userId, input.agencyCredits, input.idempotencyKey, input.deducted, input.attempt],
    );
    // ⛔ 효과 검증 없이 성공을 돌려주지 않는다(6원칙 ②). 0행 = 내 시도가 아니다.
    if (confirmed.rows.length === 0) {
      await client.query('ROLLBACK');
      const cur = await query(
        `SELECT status FROM planner_monthly_approvals WHERE company_id = $1::uuid AND plan_month = $2`,
        [input.companyId, input.planMonth],
      );
      // 다른 요청이 이미 같은 달을 승인했다면 결과는 같다 — 오류가 아니다.
      if (String(cur.rows[0]?.status || '') === 'approved') return;
      throw new PlannerApprovalError('승인을 확정하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.', 'CONFIRM_FAILED', 409);
    }
    // 승인 대상 = 제출 스냅샷의 행사뿐. 서류에 없던 행사는 여기서 전이되지 않는다.
    if (input.eventIds.length > 0) {
      await client.query(
        `UPDATE planner_events SET status = 'approved', updated_at = NOW()
          WHERE company_id = $1::uuid AND plan_month = $2 AND id = ANY($3::uuid[])
            AND status IN ('draft', 'briefed', 're_brief')`,
        [input.companyId, input.planMonth, input.eventIds],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 월간 승인 = 그 달 대행 계약 체결. 순서 = **게이트 → 선점(서류 동봉) → 지문 재확인 → 차감 → 확정.**
 *
 * 승인이 쓰는 서류는 **선점이 돌려준 것 하나뿐이다.** 선점 전에 읽은 값으로 확정하면,
 * 그 사이 재제출된 다른 서류를 집고도 옛 계획을 승인하게 된다(원장과 행사 상태가 갈린다).
 *
 * 차감이 이미 일어난 달(복구)은 **잔액·월 경계를 다시 묻지 않는다.** 대행료가 빠져 잔액이 줄었는데
 * 같은 게이트를 다시 통과하라고 하면 돈만 빠진 달이 영영 안 닫힌다. 제작비가 모자라는 상황은
 * 제작 시점의 보류·통지가 처리한다(설계서 §3-4 확정 정책 — 크레딧 예약 축을 새로 만들지 않는다).
 */
export async function approveMonthlyBrief(
  companyId: string,
  planMonth: string,
  userId: string | null,
): Promise<{ status: string; deducted: boolean; agencyCredits: number; totals: BriefTotals }> {
  // ⛔ 차감 키는 **선점이 돌려준 회차**로 확정한다(아래 ①). 선점 전에 계산한 키를 쓰면 ABA로 무료 승인이 된다.
  let idempotencyKey = buildApprovalIdempotencyKey(companyId, planMonth);
  const row = await loadApprovalRow(companyId, planMonth);
  if (!row) {
    throw new PlannerApprovalError('먼저 이번 달 계획을 결재에 올려 주세요.', 'NOT_SUBMITTED');
  }
  if (row.status === 'cancelled') {
    throw new PlannerApprovalError('취소된 달입니다. 계획을 다시 결재에 올려 주세요.', 'NOT_SUBMITTED');
  }

  const brief = await loadMonthlyBrief(companyId, planMonth);

  if (row.status === 'approved') {
    // 이미 승인된 달 — 오류가 아니라 같은 결과다(새로고침·중복 클릭).
    // 계획이 바뀌었다면 다시 결재에 올려야 한다(화면이 revisionChanged로 안내한다).
    return { status: 'approved', deducted: false, agencyCredits: Number(row.agency_credits) || 0, totals: brief.totals };
  }

  // 돈이 아직 안 나간 승인만 관문을 지난다. 복구(이미 차감된 달)는 확정이 유일한 결말이다.
  const recovering = brief.agencyPaid;
  if (!recovering) {
    if (isPastPlanMonth(planMonth)) {
      throw new PlannerApprovalError('지난 달 계획은 승인할 수 없습니다.', 'PAST_MONTH');
    }
    if (brief.revisionChanged) {
      throw new PlannerApprovalError('결재에 올린 뒤 계획이 바뀌었습니다. 다시 결재에 올린 뒤 승인해 주세요.', 'REVISION_CHANGED');
    }
    if (!brief.gate.ok) {
      throw new PlannerApprovalError(brief.gate.reason || '지금은 승인할 수 없습니다.', 'GATE_BLOCKED');
    }
  }

  // ① 선점 — 서류(행사 목록·금액·지문)를 함께 집는다. 동시 요청 중 하나만 통과한다.
  const attempt = randomUUID();
  const claimed = await claimApproval(companyId, planMonth, attempt);
  if (!claimed) {
    throw new PlannerApprovalError('이번 달 결재가 처리 중입니다. 잠시 후 화면을 새로고침해 주세요.', 'IN_PROGRESS', 409);
  }
  // 선점이 돌려준 회차로 차감 키를 확정한다.
  idempotencyKey = buildApprovalIdempotencyKey(companyId, planMonth, claimed.cycle);
  if (claimed.eventIds.length === 0) {
    await releaseApproval(companyId, planMonth, attempt);
    throw new PlannerApprovalError('결재에 올린 행사가 없습니다. 계획을 다시 결재에 올려 주세요.', 'NOT_SUBMITTED');
  }
  // ② 지문 재확인 — 내가 본 계획과 내가 집은 서류가 같은가(그 사이 재제출이 끼어들었을 수 있다).
  //    복구도 예외가 아니다: 돈이 빠진 뒤라도 승인 대상은 집은 서류여야 한다.
  if (!recovering && claimed.planHash !== computePlanHash(brief.events)) {
    await releaseApproval(companyId, planMonth, attempt);
    throw new PlannerApprovalError('결재 내용이 방금 바뀌었습니다. 화면을 새로고침한 뒤 다시 승인해 주세요.', 'REVISION_CHANGED', 409);
  }

  const agencyCredits = claimed.agencyCredits || brief.totals.agencyCredits;
  let deducted = false;
  try {
    // ③ 차감 — 멱등키가 회사·월로 고정이라 복구 경로에서는 duplicate로 끝난다(재차감 0).
    const result = await deductCredit({
      companyId,
      cost: agencyCredits,
      source: PLANNER_AGENCY_SOURCE,
      createdBy: userId,
      idempotencyKey,
    });
    if (result.deducted || result.skipReason === 'duplicate') {
      // duplicate = 이미 그 키로 빠졌다. 돈은 나갔으므로 되돌리지 않고 확정으로 간다.
      deducted = true;
    } else if (result.skipReason === 'not_applicable') {
      // 크레딧제 미적용 회사 — 차감 축 자체가 없다(차단이 아니다). 승인은 성립한다.
      deducted = false;
    } else {
      throw new PlannerApprovalError('크레딧 차감을 확정하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'DEDUCT_FAILED', 503);
    }
  } catch (err: any) {
    await releaseApproval(companyId, planMonth, attempt);
    if (err instanceof InsufficientCreditError) {
      throw new PlannerApprovalError('크레딧이 부족해 승인하지 못했습니다. 충전 후 다시 시도해 주세요.', 'INSUFFICIENT_CREDIT');
    }
    throw err;
  }

  // ④ 확정 — 내 attempt에만 걸고, 집은 서류의 행사만 전이한다.
  try {
    await confirmApproval({
      companyId, planMonth, userId, attempt,
      eventIds: claimed.eventIds, agencyCredits, idempotencyKey, deducted,
    });
  } catch (err) {
    if (!deducted) {
      // 돈이 안 나갔다 — 내 시도를 되돌려 다음 시도가 그대로 이어받게 한다.
      await releaseApproval(companyId, planMonth, attempt);
      throw err;
    }
    // 돈은 이미 빠졌다 — 되돌리지 않는다(멱등키가 재차감을 막는다). 다시 승인하면 확정만 밟는다.
    // 선점은 lease로 회수되므로 이 달이 approving에 갇히지 않는다.
    console.error(`[planner-approval][CONFIRM-MISS] company=${companyId} month=${planMonth} key=${idempotencyKey} — 차감 후 확정 실패, 재승인으로 복구 가능`);
    throw err;
  }

  console.log(`[planner-approval] 월간 승인 ${companyId} ${planMonth} — 대행 ${agencyCredits} ${recovering ? '기차감 확정' : deducted ? '차감' : '차감 대상 아님'} · 행사 ${claimed.eventIds.length}`);
  return { status: 'approved', deducted: deducted && !recovering, agencyCredits, totals: brief.totals };
}

// ── 취소·환불 (★ 2026-08-13 Phase 3 · 인계 §4-⑤) ────────────────────
/**
 * 그 달 대행 취소. **환불은 그 달 제작·실행이 0건일 때만 전액**이다(설계서 §3-4 — 일할 계산 없음).
 *
 * 순서 = 실적 확인 → 원장 전이(취소) → 환불. 환불을 먼저 하면 전이가 실패했을 때 돈만 돌아간 달이 남는다.
 * ⛔ 되돌리는 것은 **대행료 하나**다. 이미 만든 소재·나간 발송은 되돌릴 수 없고, 그래서 실적이 있으면 환불이 없다.
 * ⛔ 환불 멱등키(`planner-refund:{회사}:{월}`)로 두 번 돌려주지 않는다. 원 차감 키가 없으면 환불하지 않는다.
 */
export async function cancelMonthlyApproval(
  companyId: string,
  planMonth: string,
  userId: string | null,
): Promise<{ status: string; refunded: boolean; refundAmount: number; reason: string }> {
  // ⛔ 이미 취소된 달도 **환불 완료 여부를 다시 대조한다**(취소는 커밋됐는데 환불만 실패한 창).
  //   상태 판정·전이·환불은 아래 단일 트랜잭션이 잠금 아래에서 한다.
  const row = await loadApprovalRow(companyId, planMonth);
  if (!row) throw new PlannerApprovalError('취소할 결재 내역이 없습니다.', 'NOT_SUBMITTED');
  const alreadyCancelled = row.status === 'cancelled';


  // ★ 2026-08-13 Codex 2R 구조 정정 — **취소·실적·환불을 한 트랜잭션에서 한다.**
  //   ①그 달 승인 원장 행을 FOR UPDATE로 잠근다 → 실행·제작 선점(claimTouchpointUnderPlanLock)과 직렬화된다.
  //   ②아직 선점되지 않은 터치포인트만 닫는다 — **producing은 건드리지 않는다**(진행 중 발송을 상태로 덮으면
  //     그 행이 나갔는지 아무도 모른다). 그 행은 아래 실적 집계가 실행으로 세어 환불을 막는다.
  //   ③실적 집계와 환불도 같은 트랜잭션 — 취소만 커밋되고 환불이 유실되는 창을 없앤다.
  //   잠금 순서는 승인 원장 → companies로 통일한다(선점 경로와 같은 순서라 교착이 없다).
  let verdict = { refundable: false, amount: 0, reason: '환불할 대행료 차감 내역이 없습니다.' };
  let refunded = false;
  let work = { produced: 0, executed: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(
      `SELECT status, agency_credits FROM planner_monthly_approvals
        WHERE company_id = $1::uuid AND plan_month = $2 FOR UPDATE`,
      [companyId, planMonth],
    );
    if (lock.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new PlannerApprovalError('취소할 결재 내역이 없습니다.', 'NOT_SUBMITTED');
    }
    // ⛔ 회차 키도 **잠금 안에서** 계산한다(잠금 밖에서 잡으면 그 사이 승인·환불이 끼어들어 옛 회차만 환불한다).
    const cycleRes = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM ai_credit_transactions
        WHERE company_id = $1::uuid AND type = 'refund' AND source = $2 AND idempotency_key LIKE $3`,
      [companyId, PLANNER_AGENCY_SOURCE, `${plannerRefundKey(companyId, planMonth)}%`],
    );
    const cycle = Number(cycleRes.rows[0]?.cnt) || 0;
    const idempotencyKey = buildApprovalIdempotencyKey(companyId, planMonth, cycle);
    const refundKey = plannerRefundKey(companyId, planMonth, cycle);
    const lockedStatus = String(lock.rows[0].status);
    if (lockedStatus === 'approving') {
      await client.query('ROLLBACK');
      throw new PlannerApprovalError('승인 처리 중입니다. 잠시 후 다시 시도해 주세요.', 'IN_PROGRESS', 409);
    }
    if (lockedStatus !== 'cancelled') {
      await client.query(
        `UPDATE planner_monthly_approvals
            SET status = 'cancelled', approve_attempt = NULL, token = NULL, token_expires_at = NULL, updated_at = NOW()
          WHERE company_id = $1::uuid AND plan_month = $2`,
        [companyId, planMonth],
      );
      await client.query(
        `UPDATE planner_touchpoints t
            SET status = 'skipped', lock_reason = '월간 대행이 취소돼 발송하지 않았습니다.'
          WHERE t.company_id = $1::uuid
            AND t.status IN ('planned', 'ready', 'hold_credit', 'locked')
            AND t.event_id IN (SELECT id FROM planner_events WHERE company_id = $1::uuid AND plan_month = $2)`,
        [companyId, planMonth],
      );
      await client.query(
        `UPDATE planner_events SET status = 'cancelled', updated_at = NOW()
          WHERE company_id = $1::uuid AND plan_month = $2 AND status <> 'cancelled'`,
        [companyId, planMonth],
      );
    }

    // 실적 집계 — 같은 트랜잭션·잠금 안이라 그 사이 새 선점이 끼어들 수 없다.
    const workRes = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE t.asset_ref IS NOT NULL)::int AS produced,
         COUNT(*) FILTER (
           WHERE t.exec_ref IS NOT NULL OR t.status IN ('sent', 'scheduled', 'producing')
              OR (t.exec_meta ? 'send_started_at')
         )::int AS executed
         FROM planner_touchpoints t
         JOIN planner_events e ON e.id = t.event_id AND e.company_id = t.company_id
        WHERE t.company_id = $1::uuid AND e.plan_month = $2`,
      [companyId, planMonth],
    );
    work = { produced: Number(workRes.rows[0]?.produced) || 0, executed: Number(workRes.rows[0]?.executed) || 0 };

    const paidRes = await client.query(
      `SELECT 1 FROM ai_credit_transactions
        WHERE idempotency_key = $1 AND company_id = $2::uuid AND type = 'deduct' AND source = $3 LIMIT 1`,
      [idempotencyKey, companyId, PLANNER_AGENCY_SOURCE],
    );
    verdict = evaluateCancelRefund({
      agencyPaid: paidRes.rows.length > 0,
      agencyCredits: Number(lock.rows[0].agency_credits) || 0,
      producedCount: work.produced,
      executedCount: work.executed,
    });

    if (verdict.refundable) {
      const res = await refundCreditWithClient(client, {
        companyId,
        amount: verdict.amount,
        source: PLANNER_AGENCY_SOURCE,
        reason: `${planMonth} 마케팅 플래너 월간 대행 취소 환불(제작·발송 0건)`,
        createdBy: userId,
        idempotencyKey: refundKey,
        originalIdempotencyKey: idempotencyKey,
        manageTx: false,
      }, new Date());
      refunded = res.refunded;
      if (!refunded && res.skipReason !== 'duplicate') {
        console.error(`[planner-approval][REFUND-MISS] company=${companyId} month=${planMonth} reason=${res.skipReason || 'unknown'}`);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }

  try {
    if (!alreadyCancelled || refunded) await notifyOperatorAdmins(
      { adminPhoneNumbers: [], backupAdminPhone: null, companyId, createdBy: userId },
      '[마케팅 플래너] 월간 대행 취소',
      [
        `${Number(planMonth.slice(5, 7))}월 마케팅 대행이 취소됐습니다.`,
        refunded ? `대행료 ${verdict.amount.toLocaleString()} 크레딧을 환불했습니다.` : verdict.reason,
        '남은 발송 계획은 모두 중지됐습니다.',
      ].join('\n'),
      { noticeHeader: PLANNER_NOTICE_HEADER },
    );
  } catch (e: any) {
    console.warn('[planner-approval] 취소 통지 실패:', e?.message || e);
  }

  console.log(`[planner-approval] 월간 취소 ${companyId} ${planMonth} — 환불 ${refunded ? verdict.amount : 0} · 제작 ${work.produced} · 실행 ${work.executed}`);
  return { status: 'cancelled', refunded, refundAmount: refunded ? verdict.amount : 0, reason: verdict.reason };
}

// ── 결재 링크 착지 ───────────────────────────────────────────────────
/** 토큰 → 그 달(만료·미존재는 null). 승인 권한이 아니라 어느 달의 결재 화면인지만 정한다. */
export async function resolveApprovalToken(token: string): Promise<{ planMonth: string; status: string } | null> {
  const t = String(token || '').trim();
  if (!/^[a-f0-9]{32,64}$/.test(t)) return null;
  const r = await query(
    `SELECT plan_month, status FROM planner_monthly_approvals
      WHERE token = $1 AND token_expires_at > NOW()`,
    [t],
  );
  if (r.rows.length === 0) return null;
  return { planMonth: String(r.rows[0].plan_month), status: String(r.rows[0].status) };
}
