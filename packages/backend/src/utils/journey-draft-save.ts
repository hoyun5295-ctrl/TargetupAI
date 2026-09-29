/**
 * journey-draft-save.ts — AI 여정 패키지를 서버에서 초안으로 저장 (★ 2026-09-30 여정 V2 2차 · 설계서 §5 · §13-1 "2차 서버 초안 저장")
 *
 * 왜 있나
 *   문장으로 만들기는 여정 여러 개를 한 번에 초안으로 만든다. 지금까지 초안 저장은 화면(JourneysPage handleSaveDraft)만 했다.
 *   화면의 매핑(템플릿 · 트리거 · 조건 · 재진입 · 자동 종료 · 예산 힌트)을 서버 한 곳으로 옮겨 같은 규칙으로 저장한다.
 *   저장은 기존 createJourneyFromTemplate(레지스트리 · 대상 조건 · 칸 종류 · 칸 수 검증)을 그대로 지난다.
 *
 * ⛔ 초안만 만든다. 켜기는 사전 검증(문안 · 스팸 · 제목 · 자리표시)과 켜기 게이트(journey-activation)를 지나야 한다.
 */
import { query } from '../config/database';
import { createJourneyFromTemplate, type JourneyTemplateCode } from './journey-builder';
import type { JourneyAIPackage, GeneratedStep } from './journey-ai-generator';
import { deductCreditOutcome, refundCredit } from './ai-credit';
import { JourneyInputError } from './journey-step-limits';

export interface CallbackNumberRow {
  phone: string;
  source: string;
  description: string | null;
  is_default: boolean;
}

/** 회사 회신번호 목록(인증된 발신번호 + 회신번호 · 기본 먼저). GET journeys-callback-numbers 와 같은 SQL(한 곳). */
export async function listJourneyCallbackNumbers(companyId: string): Promise<CallbackNumberRow[]> {
  const r = await query(
    `SELECT DISTINCT phone, source, description, is_default FROM (
       SELECT REPLACE(phone_number, '-', '') AS phone, 'sender' AS source, description, false AS is_default
       FROM sender_numbers
       WHERE company_id = $1::uuid AND is_active = true AND is_verified = true
       UNION
       SELECT REPLACE(phone, '-', '') AS phone, 'callback' AS source, label AS description, is_default
       FROM callback_numbers
       WHERE company_id = $1::uuid
     ) src
     WHERE phone IS NOT NULL AND LENGTH(phone) >= 8
     ORDER BY is_default DESC NULLS LAST, phone ASC`,
    [companyId]
  );
  return r.rows;
}

/**
 * 묻지 않고 쓸 회신번호 — 기본 번호가 있으면 그것 · 번호가 하나뿐이면 그것 · 아니면 null(그때만 묻는다 · 설계서 §13-1).
 */
export function defaultCallbackOf(rows: CallbackNumberRow[]): string | null {
  const d = rows.find((r) => r.is_default);
  if (d) return d.phone;
  return rows.length === 1 ? rows[0].phone : null;
}

/**
 * AI 칸을 초안 저장용으로 맞춘다 — 사진 없는 사진 문자(MMS)는 장문 문자(LMS)로.
 * 화면 저장은 사진 없는 MMS 를 막는다(LMS 보다 비싼 단가로 글자만 나감 · 2026-08-02 Harold). 서버 초안은 막는 대신 LMS 로 둔다
 * (AI 초안에는 사진이 없고, 사진은 담당자가 넣으면서 다시 MMS 로 바꾼다).
 */
export function normalizeGeneratedStepsForDraft(steps: GeneratedStep[]): GeneratedStep[] {
  return steps.map((s) => (s.channel === 'mms' ? { ...s, channel: 'lms' as const } : s));
}

export async function saveJourneyPackageAsDraft(
  companyId: string,
  userId: string,
  pkg: JourneyAIPackage,
  opts: { callbackNumber: string; objective?: string; goalExitEnabled?: boolean },
): Promise<string> {
  const triggerEvent = pkg.presetTriggerEvent || pkg.triggerEvent;
  const { journeyId } = await createJourneyFromTemplate({
    companyId,
    createdBy: userId,
    templateCode: pkg.templateCode as JourneyTemplateCode,
    name: pkg.name || undefined,
    customObjective: pkg.templateCode === 'custom' ? (opts.objective || undefined) : undefined,
    callbackNumber: opts.callbackNumber,
    callbackMode: 'fixed',
    steps: normalizeGeneratedStepsForDraft(pkg.steps) as any,
    budgetMonthly: pkg.budgetMonthlyHint ?? null,
    thresholdCost: pkg.thresholdCostHint ?? null,
    allowReentry: pkg.allowReentry,
    reentryCooldownDays: pkg.reentryCooldownDays,
    goalExitEnabled: typeof opts.goalExitEnabled === 'boolean' ? opts.goalExitEnabled : pkg.goalExitDefault,
    triggerEvent,
    triggerFilters: pkg.triggerFilters || {},
  });
  return journeyId;
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-09-30 여정 V2 · Codex 1R · 6R — AI 초안의 과금(문장으로 만들기 · 상품 재구매 공용 CT)
//
//   순서 = AI 결과 → **차감 확정** → 초안 저장. 돈을 받지 않은 초안은 한순간도 만들어지지 않는다(6R — 저장 뒤 차감이면
//   거절 때 초안을 지워야 하고, 지우기가 실패하면 무과금 초안이 남는다). 저장이 실패하면 같은 시도 키로 환불한다.
//   **요청 식별의 진실은 원장 하나다** — 시도 키 = `${요청 키}#${n}`(요청 키에 회사 id: 원장의 중복 판정은 키 하나로 본다).
//     되돌리지 않은 차감이 있으면 이 요청은 이미 초안을 만들었다 → 거절. 저장 실패로 환불된 시도는 끝난 시도 → 다음 번호로 다시.
//   호출부의 프로세스 메모리는 두 번 누름을 줄이는 덧장치일 뿐이다(재시작 · 30분 만료 뒤에는 원장이 막는다).
//   ⚠ 크레딧제 미적용 회사(차감 행 없음)는 원장 기록이 없어 재시작 뒤 같은 요청이 초안을 한 번 더 만들 수 있다(돈 0 · 설계서 13-9 기록).
// ════════════════════════════════════════════════════════════════════

export const DRAFT_ALREADY_MADE = '이 요청으로 만든 여정 초안이 이미 있어요. 여정 목록에서 이어서 고쳐 주세요.';

/**
 * AI 를 부르기 전 — 이 요청의 다음 시도 키를 원장에서 정한다. 되돌리지 않은 차감이 있으면 DRAFT_ALREADY_MADE.
 * 조회 오류는 던진다(모르는 것을 "안 냈다"로 접지 않는다).
 */
export async function nextDraftChargeKey(companyId: string, requestKey: string): Promise<string> {
  const r = await query(
    `SELECT idempotency_key, type FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND idempotency_key LIKE $2`,
    [companyId, `${requestKey}#%`],
  );
  const refunded = new Set(
    (r.rows as any[]).filter((x) => x.type === 'refund').map((x) => String(x.idempotency_key).replace(/:refund$/, '')),
  );
  const charged = (r.rows as any[]).filter((x) => x.type === 'deduct').map((x) => String(x.idempotency_key));
  if (charged.some((k) => !refunded.has(k))) throw new JourneyInputError(DRAFT_ALREADY_MADE);
  return `${requestKey}#${charged.length + 1}`;
}

/**
 * 차감 확정 → 초안 저장. 돌려주는 값 = 초안 id · 실제 차감액.
 *   - 잔액 부족(사전 확인 뒤 동시 소진) → InsufficientCreditError(라우트 402) · 초안 없음.
 *   - 같은 시도 키가 먼저 과금됨(duplicate · 다른 프로세스가 같은 요청을 먼저) → DRAFT_ALREADY_MADE · 초안 없음.
 *   - 그 밖 실패(DB 오류 · 영구 실패 = [CREDIT][MISS] 로그) · 크레딧제 미적용 → 결과는 막지 않는다(집안 원칙) · 차감액 0.
 *   - 저장 실패 → 차감했으면 같은 시도 키로 환불하고 저장 오류를 그대로 던진다(다음 요청은 다음 시도 번호).
 */
export async function chargeThenSaveDraft(opts: {
  companyId: string;
  userId: string;
  cost: number;
  chargeKey: string;
  save: () => Promise<string>;
}): Promise<{ journeyId: string; charged: number }> {
  const outcome = await deductCreditOutcome({
    companyId: opts.companyId,
    cost: opts.cost,
    source: 'journey-ai-generate',
    createdBy: opts.userId,
    idempotencyKey: opts.chargeKey,
    throwOnInsufficient: true,
  });
  if (outcome === 'duplicate') throw new JourneyInputError(DRAFT_ALREADY_MADE);
  const charged = outcome === 'deducted' ? opts.cost : 0;
  try {
    return { journeyId: await opts.save(), charged };
  } catch (saveErr) {
    if (charged > 0) {
      try {
        const rr = await refundCredit({
          companyId: opts.companyId,
          amount: charged,
          source: 'journey-ai-generate',
          reason: '여정 초안 저장 실패 · 차감 되돌림',
          createdBy: opts.userId,
          idempotencyKey: `${opts.chargeKey}:refund`,
          originalIdempotencyKey: opts.chargeKey,
        });
        if (!rr.refunded && rr.skipReason !== 'duplicate') {
          console.log(`[CREDIT][REFUND-MISS] company=${opts.companyId} key=${opts.chargeKey} reason=${rr.skipReason || 'unknown'}`);
        }
      } catch (refundErr: any) {
        console.log(`[CREDIT][REFUND-MISS] company=${opts.companyId} key=${opts.chargeKey} err=${refundErr?.message}`);
      }
    }
    throw saveErr;
  }
}
