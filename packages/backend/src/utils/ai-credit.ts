/**
 * CT — utils/ai-credit.ts (D227+ 2026-05-31)
 *
 * AI 크레딧 종량제 차감 단일 진입점. base(월 기본분) → purchased(구매분) 2버킷.
 * pool 연결만 담당하고, 트랜잭션 흐름은 ai-credit-tx.ts(client 주입), 순수 계산은 ai-credit-calc.ts.
 *
 * 영구 원칙:
 *  - 호출 성공 후 차감 (실패 시 미차감 = 환불 불필요). checkCredit은 호출 전 사전 차단.
 *  - 트랜잭션 원자성 — pool.connect + BEGIN + SELECT FOR UPDATE + COMMIT (동시 호출 음수 방지).
 *  - idempotent — FOR UPDATE 잠금 후 idempotency_key 재확인 + UNIQUE (동시 재시도 이중 차감 차단).
 *  - cost 0 = 차감 skip. companyId 없으면 skip.
 *  - 월 리셋 lazy — 차감 직전 reset_at 검사 후 base = plan.ai_credits_per_month.
 *  - prepaid 자동충전·월 상한 적용은 이후 단계.
 */

import { isDemoCompany } from './demo-company';   // ★ 2026-10-09 시연 회사 = AI 크레딧 차감 0
import { pool } from '../config/database';
import { needsMonthlyReset } from './ai-credit-calc';
import { setCreditEvent } from './request-context';
import { UserFacingError } from './http-error';
import {
  loadCreditRow,
  applyResetIfNeeded,
  creditOverageAllowance,
  carriedBaseOnReset,
  _deductWithClient,
  adjustCreditWithClient,
  refundCreditWithClient,
  InsufficientCreditError,
  type CreditState,
  type DeductResult,
  type DeductOpts,
  type AdjustOpts,
  type RefundOpts,
  type RefundResult,
} from './ai-credit-tx';

export { InsufficientCreditError };
export type { CreditState, DeductResult, DeductOpts, RefundOpts, RefundResult };

/** 현재 크레딧 상태 조회(읽기 전용). 리셋 필요 시 base를 요금제 기본분으로 환산해 표시. */
export async function getCreditState(companyId: string): Promise<CreditState> {
  const empty: CreditState = {
    baseRemaining: 0, purchased: 0, total: 0, monthlyCap: null, planCredits: 0, creditEnabled: false, resetAt: null,
    billingType: 'prepaid', overageLimit: 0,
  };
  if (!companyId) return empty;
  try {
    const row = await loadCreditRow(pool, companyId, false);
    if (!row) return empty;
    const planCredits = Number(row.plan_credits) || 0;
    const purchased = Number(row.purchased) || 0;
    const creditEnabled = row.plan_credits != null || purchased > 0;  // 크레딧제 적용 여부
    const resetAt = row.reset_at ? new Date(row.reset_at) : null;
    const baseRemaining = needsMonthlyReset(resetAt, new Date()) ? planCredits : (Number(row.base) || 0);
    return {
      baseRemaining,
      purchased,
      total: baseRemaining + purchased,
      monthlyCap: row.cap != null ? Number(row.cap) : null,
      planCredits,
      creditEnabled,
      resetAt,
      billingType: String(row.billing_type || 'prepaid'),
      overageLimit: Number(row.overage_limit) || 0,
    };
  } catch (err: any) {
    console.warn('[ai-credit] getCreditState 오류, default 0:', err?.message);
    return empty;
  }
}

/**
 * 크레딧제 적용 여부 — **과금 판정 전용. 조회 실패를 삼키지 않는다.**
 *
 * `getCreditState`는 실패를 `creditEnabled:false`로 접어 준다(표시·조회용으로는 그게 안전하다).
 * 그런데 그 값으로 **금액을 지으면** 조회가 한 번 실패한 견적은 0원을 보여주고, 뒤이은 생성은
 * 조회에 성공해 양수를 걷는다 — 사용자가 승인하지 않은 금액이 나간다. 반대 방향도 같다.
 * 그래서 가격을 정하는 자리에서는 "모른다"를 false로 접지 않고 던진다(호출부가 503으로 답한다).
 */
export async function isCreditEnabledStrict(companyId: string): Promise<boolean> {
  if (!companyId) return false;
  const row = await loadCreditRow(pool, companyId, false);
  if (!row) return false;                                   // 행 부재 = 크레딧제 미적용(오류가 아니다)
  return row.plan_credits != null || (Number(row.purchased) || 0) > 0;
}

/**
 * ★ 2026-09-27 한줄로 V2 R192(Codex 차수3 1R) — 과금 판정 전용 잔액 확인. checkCredit과 두 가지가 다르다.
 *  ① 조회 실패를 삼키지 않는다(던진다) — 모르는 잔액을 "크레딧제 미적용"으로 접어 통과시키지 않는다.
 *  ② 실제 차감(_deductWithClient)과 같은 source별 허용 한도·월 리셋 기본분으로 판단한다(같은 순수 함수).
 * 차감이 건너뛰는 경우(행 없음·크레딧제 미적용)는 걷을 돈이 없으니 true.
 */
export async function hasCreditForStrict(companyId: string, cost: number, source: string): Promise<boolean> {
  if (!companyId || !cost || cost <= 0) return true;
  const row = await loadCreditRow(pool, companyId, false);
  if (!row) return true;
  if (row.plan_credits == null && (Number(row.purchased) || 0) === 0) return true;
  const resetAt = row.reset_at ? new Date(row.reset_at) : null;
  const base = needsMonthlyReset(resetAt, new Date()) ? carriedBaseOnReset(row) : (Number(row.base) || 0);
  const purchased = Number(row.purchased) || 0;
  return (base + purchased) - cost >= -creditOverageAllowance(row, source);
}

/** 호출 전 사전 차단 — 보유 크레딧이 작업 비용보다 적으면 throw InsufficientCreditError. */
export async function checkCredit(companyId: string, cost: number): Promise<void> {
  if (!companyId || !cost || cost <= 0) return;
  if (await isDemoCompany(companyId)) return;   // ★ 2026-10-09 시연 회사 = 크레딧 차단 없음(차감도 0)
  const st = await getCreditState(companyId);
  if (!st.creditEnabled) return;  // 크레딧제 미적용(요금제 크레딧 미설정) → 통과(차단 X)
  // ★ D227+ 후불은 추가 사용 한도까지 통과(월말 청구). 선불은 보유 부족 시 차단.
  const overageAllowed = st.billingType === 'postpaid' ? Math.max(0, st.overageLimit) : 0;
  if (st.total + overageAllowed < cost) {
    throw new InsufficientCreditError(cost, st.total);
  }
}

/**
 * 이 멱등키로 이미 차감된 적이 있는가 — **과금 여부의 진실은 원장 하나다.**
 *
 * "냈다"를 다른 표에 표식으로 복사해 두고 그걸 읽으면, 차감은 성공했는데 표식만 실패한 순간부터
 * 두 진실이 갈린다(견적이 이미 낸 금액을 다시 청구하고 잔액 게이트가 부당하게 막는다).
 * 그래서 사본을 만들지 않고 원장에 직접 묻는다.
 *
 * ⛔ **조회 실패를 "안 냈다"로 접지 않는다 — 던진다.** 모르는 것을 미차감으로 답하면 이미 낸 대행비가
 * 견적에 다시 들어가고 그 합계로 잔액을 검사해, 신규 생성비만 있는 고객이 부당하게 막힌다.
 * 호출부는 이 예외를 **503(잠시 후 재시도)** 으로 돌려준다 — 확인 못 한 금액을 청구도 검사도 하지 않는다.
 */
export async function isChargedByKey(companyId: string, idempotencyKey: string): Promise<boolean> {
  if (!companyId || !idempotencyKey) return false;
  const r = await pool.query(
    `SELECT 1 FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND idempotency_key = $2 LIMIT 1`,
    [companyId, idempotencyKey],
  );
  return r.rows.length > 0;
}

/**
 * ★ 2026-10-18 AI 한줄로(Codex 1R high) — 이 멱등키로 **얼마를** 냈는가(차감 행 금액 · 없으면 null).
 *   같은 시도 재요청이 낸 것보다 많은 결과를 받지 않게(낸 종류 수까지만) 호출부가 이 값으로 자른다.
 *   ⛔ 조회 실패는 던진다(호출부 503 · 모르는 납부를 0 으로 접지 않는다 · isChargedByKey 와 같은 원칙).
 */
export async function chargedAmountByKey(companyId: string, idempotencyKey: string): Promise<number | null> {
  if (!companyId || !idempotencyKey) return null;
  const r = await pool.query(
    `SELECT amount FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND idempotency_key = $2 AND type = 'deduct' LIMIT 1`,
    [companyId, idempotencyKey],
  );
  return r.rows.length > 0 ? Number(r.rows[0].amount) || 0 : null;
}

/**
 * ★ 2026-10-17 한 줄 완성(설계서 docs/2026-10-17-oneline-steps-modal-design.md §3-11) — 이 원천 · 이 키 접두로 이미 차감된 행이 있는가.
 *   「오늘 이 한 줄로 한 줄 완성을 냈는가」(다시 만들기 = 생성비만)를 **원장에 직접** 묻는다(사본 표식 0 · isChargedByKey 와 같은 원칙).
 *   ⛔ 조회 실패는 던진다(호출부 503) · 접두는 고정 형식(영숫자 · 하이픈 · 콜론)만 받는다(LIKE 와일드카드 주입 차단).
 */
export async function hasChargeWithKeyPrefix(companyId: string, source: string, keyPrefix: string): Promise<boolean> {
  if (!companyId || !source || !keyPrefix) return false;
  if (!/^[A-Za-z0-9:-]+$/.test(keyPrefix)) throw new Error('invalid key prefix');
  const r = await pool.query(
    `SELECT 1 FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND type = 'deduct' AND source = $2 AND idempotency_key LIKE $3
      LIMIT 1`,
    [companyId, source, `${keyPrefix}%`],
  );
  return r.rows.length > 0;
}

/**
 * ★ 2026-09-29 여러 멱등 키 중 이미 과금된 키(isChargedByKey 묶음판 · 목록 화면이 한 번에 묻는다).
 *   인앱 만들기 개편 — 편집기 초안(멈춤)을 게시할 때 과금 확인 창을 띄울지 서버 과금 이력으로 정한다(설계서 §1-4).
 */
export async function chargedKeysAmong(companyId: string, keys: string[]): Promise<Set<string>> {
  if (!companyId || !Array.isArray(keys) || keys.length === 0) return new Set();
  const r = await pool.query(
    `SELECT idempotency_key FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND idempotency_key = ANY($2::text[])`,
    [companyId, keys],
  );
  return new Set(r.rows.map((row: any) => String(row.idempotency_key)));
}

/** 호출 성공 후 차감 (트랜잭션 + idempotent + 2버킷). 보유 부족 시 throw InsufficientCreditError. */
export async function deductCredit(opts: {
  companyId: string | null;
  cost: number;
  source: string;
  aiCallLogId?: string | null;
  createdBy?: string | null;
  idempotencyKey?: string;
}): Promise<DeductResult> {
  const empty: DeductResult = { deducted: false, fromBase: 0, fromPurchased: 0, baseAfter: 0, purchasedAfter: 0 };
  if (!opts.companyId || !opts.cost || opts.cost <= 0) return empty;
  // ★ 2026-10-09 시연 회사 = 크레딧 차감 대상 아님(not_applicable · 결과 판정은 deductCreditOutcome 이 그대로 '차감 의무 없음'으로 읽는다)
  if (await isDemoCompany(opts.companyId)) return { ...empty, skipReason: 'not_applicable' };

  const now = new Date();
  const client = await pool.connect();
  try {
    return await _deductWithClient(
      client,
      {
        companyId: opts.companyId,
        cost: opts.cost,
        source: opts.source,
        aiCallLogId: opts.aiCallLogId,
        createdBy: opts.createdBy,
        idempotencyKey: opts.idempotencyKey,
      },
      now
    );
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 차감 결말 — **`true/false` 둘로는 "돈이 실제로 빠졌는가"를 못 가른다.**
 *  - `deducted` = 원장이 움직였다 / `duplicate` = 같은 키로 이미 원장에 있다(둘 다 "수금됨")
 *  - `not_applicable` = 크레딧제 미적용이라 원장이 안 움직인다(수금 아님 — 금액을 표시하면 안 된다)
 *  - `not_required` = 걷을 것이 없다(cost 0·회사 없음) / `failed` = 잔액 부족·영구 실패(차감 의무 남음)
 */
export type DeductOutcome = 'deducted' | 'duplicate' | 'not_applicable' | 'not_required' | 'failed';

/**
 * 차감 안전 실행 래퍼 — AI 호출 성공 후 차감을 끝까지 보장한다.
 *  - 캐시·통계 기록과 분리해 호출(통계 실패가 차감을 막지 않음).
 *  - 일시 오류(deadlock·연결·잠금 경합) 시 최대 3회 재시도(차감은 원자·멱등이라 재호출해도 중복 0).
 *  - aiCallLogId가 없으면(통계 실패) 호출당 고정 대체 멱등키를 부여 → 재시도 이중 차감 차단.
 *  - idempotencyKey를 직접 주면(예: journey-activate:${journeyId}) 그 키로 고정 → 재개·재요청 중복 차감 0(ai_call_log_id FK 무관).
 *  - 최종 실패 = stdout 명시 로그([CREDIT][MISS])로 추적 + 그 키로 수동 재차감. AI 응답은 막지 않는다(throw 안 함).
 *  - _deps = 단위검증 주입용(prod 미사용).
 *
 * ★ 2026-08-05 — **차감 확정 여부를 반환한다**(`true` = 차감 의무가 남아 있지 않다).
 *   이 함수는 잔액 부족·영구 실패에도 throw하지 않으므로, 호출부의 `try/catch`는 실패를 절대 잡지 못한다.
 *   자동마케팅 발송이 그 죽은 catch에 기대어 무과금 발송을 'sent'로 마감하고 있었다(재차감 경로 소실).
 *   `true` = 차감됨 · 이미 차감됨(멱등 중복) · 차감 대상 아님(크레딧제 미적용·cost 0·companyId 없음).
 *   `false` = 잔액 부족 · 3회 영구 실패 · 크레딧 행 없음. **돈이 안 빠졌다는 뜻이므로 상태를 전진시키면 안 된다.**
 *   기존 소비처는 반환값을 쓰지 않아 동작이 그대로다(void → boolean은 하위 호환).
 */
export async function deductCreditOutcome(
  opts: {
    companyId: string | null;
    cost: number;
    source: string;
    aiCallLogId?: string | null;
    createdBy?: string | null;
    /** 멱등키 직접 지정(회사+행위 고정 키). 재시도·재개·동시요청 중복 차감 차단. 미지정 시 aiCallLogId/fallback 기준. */
    idempotencyKey?: string;
    /** ★ 2026-09-27 한줄로 V2(Codex 차수3 D 2R) — 잔액 부족을 'failed'로 접지 않고 그 예외를 그대로 던진다(성공 뒤 차감 확정 전용 · 기본 = 종전). */
    throwOnInsufficient?: boolean;
  },
  _deps?: { deductFn?: typeof deductCredit; sleep?: (ms: number) => Promise<void> }
): Promise<DeductOutcome> {
  // 차감 대상이 아니다 = 남은 의무가 없다.
  if (!opts.companyId || !opts.cost || opts.cost <= 0) return 'not_required';
  const deduct = _deps?.deductFn ?? deductCredit;
  const sleep = _deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // 호출측이 멱등키를 직접 주면 그걸 우선(고정). 아니면 aiCallLogId 있을 때 deductCredit이 source+aiCallLogId로,
  // 둘 다 없으면 호출당 1회 고정 대체 멱등키(재시도 루프 내내 동일) → 이중 차감 차단.
  const idempotencyKey = opts.idempotencyKey
    ?? (opts.aiCallLogId
      ? undefined
      : `fallback:${opts.companyId}:${opts.source}:${Date.now()}`);
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await deduct({
        companyId: opts.companyId,
        cost: opts.cost,
        source: opts.source,
        aiCallLogId: opts.aiCallLogId,
        createdBy: opts.createdBy,
        idempotencyKey,
      });
      // 사후 토스트용 — 차감 성공 시 요청 컨텍스트에 기록(응답 미들웨어가 _credit 첨부). worker는 no-op.
      if (result?.deducted) {
        setCreditEvent({ used: opts.cost, balance: (result.baseAfter || 0) + (result.purchasedAfter || 0), source: opts.source });
        return 'deducted';
      }
      // 차감이 안 일어났다 — 사유를 봐야 "돈이 빠졌는가"가 갈린다(재시도해도 바뀌지 않는 결말들이다).
      if (result?.skipReason === 'duplicate') return 'duplicate';
      if (result?.skipReason === 'not_applicable') return 'not_applicable';
      reportCreditMiss({ companyId: opts.companyId, source: opts.source, cost: opts.cost, key: idempotencyKey || opts.aiCallLogId || null, reason: String(result?.skipReason || 'unknown') });
      return 'failed';
    } catch (err: any) {
      // 잔액 부족 = 정상 차단(사전 checkCredit 통과 후 동시 소진). 재시도 무의미.
      if (err instanceof InsufficientCreditError) {
        console.log(`[CREDIT][SKIP] insufficient company=${opts.companyId} source=${opts.source} cost=${opts.cost} aiCallLogId=${opts.aiCallLogId || 'none'}`);
        if (opts.throwOnInsufficient) throw err;
        return 'failed';
      }
      if (attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 200);
        continue;
      }
      // 영구 실패 — stdout 추적(LESSONS_BACKEND: console.log 의무) + 운영 경보(Z1). 같은 키로 수동 재차감 가능.
      reportCreditMiss({ companyId: opts.companyId, source: opts.source, cost: opts.cost, key: idempotencyKey || opts.aiCallLogId || null, reason: `attempts=${MAX_ATTEMPTS} err=${err?.message}` });
      return 'failed';
    }
  }
  return 'failed';
}

/**
 * ★ 2026-09-27 한줄로 V2(Codex 차수3 D 1R·2R) — **성공 뒤 차감의 확정**. AI 결과를 돌려주기 직전에 부른다.
 *   사전 확인(checkCredit) 뒤 동시 요청이 잔액을 먼저 써서 이 차감이 잔액 부족으로 거절되면 InsufficientCreditError를 던진다
 *   — 결과를 무과금으로 내주지 않는다(호출부 402). 잔액 부족이 아닌 실패(DB 오류·영구 실패)는 기존 원칙대로 결과를 막지 않는다
 *   ([CREDIT][MISS] 로그 · 같은 멱등키로 수동 재차감).
 */
export async function settleCreditAfterSuccess(opts: {
  companyId: string;
  cost: number;
  source: string;
  createdBy?: string | null;
} & (
  { idempotencyKey: string; aiCallLogId?: never }
  // ★ 2026-10-25 R4 — AI 호출 함수의 묶음 밖 1회 차감 = 그 호출 기록 id 가 시도 키(기록이 없으면 원장 함수의 호출당 1회 대체 키)
  | { aiCallLogId: string | null; idempotencyKey?: never }
)): Promise<DeductOutcome> {
  // 잔액 부족은 차감 시점의 판정을 그대로 던진다(Codex 차수3 D 2R — 뒤에 다시 조회하면 그 사이 충전·리셋으로 통과될 수 있었다).
  // ★ 2026-10-25 성공 뒤 차감 한 규칙(원장 docs/2026-10-25-oneline-all-structure-check.md §8-2 D1 = A · Harold 결정):
  //   'failed'(원장 쓰기 실패 · 영구 실패) = 결과를 건네지 않는다 → CreditSettleError(503). 경보는 deductCreditOutcome 이 이미 냈다.
  //   호출부는 만든 결과(임시 그림 · 초안 행)를 거두고 503 으로 답한다. 잔액 부족 = InsufficientCreditError(402) 그대로.
  const outcome = await deductCreditOutcome({ ...opts, throwOnInsufficient: true });
  if (outcome === 'failed') throw new CreditSettleError();
  return outcome;
}

/**
 * ★ 2026-10-26 성공 뒤 차감 + 되돌리기 한 벌(Codex 1R 돈 묶음 · 뿌리 R4 · D1 = A) — 만든 것(첫 발행 · 게시 · 링크 · 그림 · 저장)을
 *   건네기 직전에 걷고, 못 걷으면(잔액 부족 402 · 원장 쓰기 실패 503) 만든 것을 되돌린 뒤 그 오류를 그대로 던진다.
 *   되돌리기마저 실패 = [CREDIT][ORPHAN] 경보(사람이 같은 키로 걷거나 거둔다 · 옛: 자리마다 console.error 한 줄이라 아무도 몰랐다).
 *   쓰는 곳 = 결과를 이미 저장 · 공개한 뒤 걷는 자리 전부(되돌릴 것이 없으면 settleCreditAfterSuccess 를 그대로 쓴다).
 */
export async function settleOrUndo(opts: {
  settle: Parameters<typeof settleCreditAfterSuccess>[0];
  /** 걷지 못했을 때 만든 것을 거두는 일 */
  undo: () => Promise<void> | void;
  /** 경보에 남길 이름(무엇을 거두려 했나) */
  what: string;
}): Promise<DeductOutcome> {
  try {
    return await settleCreditAfterSuccess(opts.settle);
  } catch (err) {
    try {
      await opts.undo();
    } catch (undoErr: any) {
      const s = opts.settle as { companyId: string; source: string; cost: number; idempotencyKey?: string };
      reportCreditMiss({ companyId: s.companyId, source: s.source, cost: s.cost, key: s.idempotencyKey ?? null, reason: `${opts.what} 되돌리기 실패 ${undoErr?.message || undoErr}`, tag: 'ORPHAN' });
    }
    throw err;
  }
}

/**
 * ★ 2026-10-26 호출부 트랜잭션 안의 성공 뒤 차감(Codex 1R 돈 묶음 #2 · 뿌리 R4) — 저장과 차감이 함께 커밋 · 롤백된다.
 *   옛: 저장 트랜잭션 안에서 다른 연결로 걷어, 저장 COMMIT 이 실패해도 차감만 남았다.
 *   잔액 부족 = InsufficientCreditError(호출부 ROLLBACK → 402) · 원장 쓰기 실패 = CreditSettleError(호출부 ROLLBACK → 503) · 시연 회사 · 크레딧제 미적용 = 걷지 않는다.
 */
export async function settleCreditInTx(client: any, opts: { companyId: string; cost: number; source: string; createdBy?: string | null; idempotencyKey: string }): Promise<DeductOutcome> {
  if (!opts.companyId || !opts.cost || opts.cost <= 0) return 'not_required';
  if (await isDemoCompany(opts.companyId)) return 'not_applicable';
  let r: DeductResult;
  try {
    r = await _deductWithClient(client, opts, new Date(), { manageTx: false });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) throw err;
    reportCreditMiss({ companyId: opts.companyId, source: opts.source, cost: opts.cost, key: opts.idempotencyKey, reason: `tx err=${err?.message}` });
    throw new CreditSettleError();
  }
  if (r.deducted) {
    setCreditEvent({ used: opts.cost, balance: (r.baseAfter || 0) + (r.purchasedAfter || 0), source: opts.source });
    return 'deducted';
  }
  if (r.skipReason === 'duplicate') return 'duplicate';
  if (r.skipReason === 'not_applicable') return 'not_applicable';
  reportCreditMiss({ companyId: opts.companyId, source: opts.source, cost: opts.cost, key: opts.idempotencyKey, reason: String(r.skipReason || 'unknown') });
  throw new CreditSettleError();
}

/**
 * ★ 2026-10-25 원장 쓰기 실패로 결과를 건네지 않는다(성공 뒤 차감 한 규칙 · D1 A). 라우트 = 503 · 사람 문장 그대로.
 * 사용자 조건 오류 종류(UserFacingError)라 `userErrorResponse` 가 그 상태로 돌려준다.
 */
export class CreditSettleError extends UserFacingError {
  constructor() {
    super(503, 'CREDIT_SETTLE_FAILED', '크레딧 기록을 확인하지 못해 결과를 건네지 않았어요. 잠시 후 다시 시도해 주세요.');
    this.name = 'CreditSettleError';
  }
}

/**
 * ★ 2026-10-25 차감을 끝내 기록하지 못했다 = 사람에게 닿아야 한다(원장 Z1 · 뿌리 R14).
 * 옛: `[CREDIT][MISS]` stdout 한 줄이 전부라 아무도 몰랐다. 이제 로그(검색 꼬리표 그대로) + 운영 경보(공용 입구 · 1시간 1회 묶음).
 * 경보는 기다리지 않는다(차감 경로를 늦추지 않게) · 경보 실패는 경보 함수가 삼킨다.
 */
export function reportCreditMiss(info: { companyId: string | null; source: string; cost: number; key?: string | null; reason: string; tag?: 'MISS' | 'ORPHAN' }): void {
  const tag = info.tag || 'MISS';
  console.log(`[CREDIT][${tag}] company=${info.companyId} source=${info.source} cost=${info.cost} key=${info.key || 'none'} reason=${info.reason}`);
  void import('./system-alert').then(({ sendSystemAlert }) => sendSystemAlert({
    dedupKey: `credit-${tag.toLowerCase()}`,
    cooldownMs: 60 * 60 * 1000,
    title: tag === 'MISS' ? '크레딧 차감을 기록하지 못했습니다.' : '돈을 받지 않은 결과(초안 · 발행 · 게시 · 그림)를 거두지 못했습니다.',
    details: [`기능: ${info.source}`, `금액: ${info.cost}`, `사유: ${info.reason.slice(0, 80)}`],
    action: `서버 로그에서 [CREDIT][${tag}] 줄을 찾아 같은 키로 처리해 주세요.`,
  })).catch(() => undefined);
}

/**
 * ★ 2026-10-25 AI 결과 정산 한 곳(원장 Z4 · 뿌리 R4) — 고객에게 결과를 돌려주는 AI 생산자는 이 함수만 쓴다.
 *   순서: 잔액 확인(402) → 묶음 안 AI(안쪽 차감 0) → 쓸 결과인가(accept) → 성공 뒤 차감(한 규칙 · 402 · 503).
 *   쓸 결과가 아니면(읽지 못함 · 전부 거절 · 바뀐 것 0) 0원이다. cost 0 · 크레딧제 미적용은 걷지 않는다.
 * 옛: `callAIWithFallback` 이 응답을 받는 순간 걷어, 형식 오류 · 거절된 결과에도 돈이 나갔다(#39 · #67 · #93 · #113 · 판독).
 */
export async function runChargedAi<T>(opts: {
  companyId: string;
  cost: number;
  source: string;
  createdBy?: string | null;
  /** 같은 시도 재요청 = 같은 키(없으면 호출마다 새 키) */
  idempotencyKey?: string;
  run: () => Promise<T>;
  accept: (result: T) => boolean;
}): Promise<{ result: T; charged: boolean }> {
  const { runInCreditBundle, isInCreditBundle } = await import('./ai-credit-context');
  // 바깥 묶음(AI 한줄로 만들기 · 오케스트레이터 등)이 차감을 소유하면 안에서 걷지 않는다(callAIWithFallback 과 같은 규칙)
  if (isInCreditBundle()) return { result: await opts.run(), charged: false };
  if (opts.cost > 0) await checkCredit(opts.companyId, opts.cost);
  const result = await runInCreditBundle(opts.run);
  if (opts.cost <= 0 || !opts.accept(result)) return { result, charged: false };
  const { randomUUID } = await import('crypto');
  const outcome = await settleCreditAfterSuccess({
    companyId: opts.companyId, cost: opts.cost, source: opts.source, createdBy: opts.createdBy ?? null,
    idempotencyKey: opts.idempotencyKey || `${opts.source}:${randomUUID()}`,
  });
  return { result, charged: outcome === 'deducted' };
}

/**
 * 차감 확정 여부(하위 호환) — `false`만이 "돈이 안 빠졌고 의무가 남았다"는 뜻이다.
 * 기존 소비처 전부가 이 불리언을 쓰므로 **판정은 `deductCreditOutcome` 하나가 소유하고 여기서는 접기만 한다**
 * (두 벌로 쓰면 한쪽만 고쳐져 갈라진다). 수금 여부까지 구분해야 하는 호출부는 outcome을 직접 쓴다.
 */
export async function deductCreditSafe(
  opts: Parameters<typeof deductCreditOutcome>[0],
  _deps?: Parameters<typeof deductCreditOutcome>[1],
): Promise<boolean> {
  return (await deductCreditOutcome(opts, _deps)) !== 'failed';
}

/**
 * 크레딧 환불 (★ 2026-08-13 마케팅 플래너) — 멱등키 필수. 트랜잭션·버킷 복원은 ai-credit-tx가 소유한다.
 * 되돌릴 차감이 없으면(no_original) 환불하지 않는다 — 근거 없는 지급을 만들지 않는다.
 */
export async function refundCredit(opts: RefundOpts): Promise<RefundResult> {
  if (!opts.companyId || !opts.amount || opts.amount <= 0) return { refunded: false, amount: 0 };
  const client = await pool.connect();
  try {
    return await refundCreditWithClient(client, opts, new Date());
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
    throw err;
  } finally {
    client.release();
  }
}

/** 명시적 월 리셋(워커/관리자용). 리셋했으면 true. */
export async function resetMonthlyCreditsIfNeeded(companyId: string): Promise<boolean> {
  if (!companyId) return false;
  const now = new Date();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await loadCreditRow(client, companyId, true);
    if (!row) { await client.query('ROLLBACK'); return false; }
    const resetAt = row.reset_at ? new Date(row.reset_at) : null;
    if (!needsMonthlyReset(resetAt, now)) {
      await client.query('ROLLBACK');
      return false;
    }
    await applyResetIfNeeded(client, companyId, row, now);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 이번 달(KST) 크레딧 순사용량 = 차감 − 환불.
 * ★ 2026-08-13: 환불 축이 생겨(마케팅 플래너 대행 취소) deduct만 세면 되돌려준 것까지 사용량으로 보인다.
 *   화면이 "쓴 만큼"을 말해야 하므로 순액으로 센다(reset·grant·admin_deduct는 여전히 제외).
 */
export async function getMonthlyUsage(companyId: string): Promise<number> {
  if (!companyId) return 0;
  try {
    const r = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'deduct' THEN amount WHEN type = 'refund' THEN -amount ELSE 0 END), 0) AS used
         FROM ai_credit_transactions
        WHERE company_id = $1::uuid AND type IN ('deduct', 'refund')
          AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`,
      [companyId]
    );
    return Number(r.rows[0]?.used) || 0;
  } catch (err: any) {
    console.warn('[ai-credit] getMonthlyUsage 오류:', err?.message);
    return 0;
  }
}

/** 슈퍼관리자 수동 크레딧 지급/조정 (트랜잭션 + 구매분 버킷). */
export async function adjustCredit(opts: AdjustOpts): Promise<{ purchasedAfter: number }> {
  const client = await pool.connect();
  try {
    return await adjustCreditWithClient(client, opts, new Date());
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
    throw err;
  } finally {
    client.release();
  }
}

/** 크레딧 이력 페이지네이션 (최신순). */
export async function getCreditTransactions(
  companyId: string,
  page = 1,
  pageSize = 20,
): Promise<{ rows: any[]; total: number }> {
  if (!companyId) return { rows: [], total: 0 };
  const offset = (Math.max(1, page) - 1) * pageSize;
  const [list, cnt] = await Promise.all([
    pool.query(
      `SELECT t.id, t.type, t.amount, t.bucket, t.source, t.balance_purchased_after, t.balance_base_after,
              t.created_by, t.created_at, t.reason,
              COALESCE(u.name, u.login_id) AS created_by_name
         FROM ai_credit_transactions t
         LEFT JOIN users u ON u.id = t.created_by
        WHERE t.company_id = $1::uuid
        ORDER BY t.created_at DESC
        LIMIT $2 OFFSET $3`,
      [companyId, pageSize, offset]
    ),
    pool.query(`SELECT COUNT(*) AS c FROM ai_credit_transactions WHERE company_id = $1::uuid`, [companyId]),
  ]);
  return { rows: list.rows, total: Number(cnt.rows[0].c) || 0 };
}

/** 전체 회사 크레딧 거래 (슈퍼관리자 — 회사명·사용자명 포함, 회사/타입 필터 + 페이지네이션). */
export async function getAllCreditTransactions(
  opts: { companyId?: string; type?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: any[]; total: number }> {
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize || 30));
  const offset = (page - 1) * pageSize;
  const conds: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (opts.companyId) { conds.push(`t.company_id = $${i++}::uuid`); params.push(opts.companyId); }
  if (opts.type) { conds.push(`t.type = $${i++}`); params.push(opts.type); }
  const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const [list, cnt] = await Promise.all([
    pool.query(
      `SELECT t.id, t.company_id, t.type, t.amount, t.bucket, t.source,
              t.balance_base_after, t.balance_purchased_after, t.created_at, t.reason,
              c.company_name, COALESCE(u.name, u.login_id) AS created_by_name
         FROM ai_credit_transactions t
         LEFT JOIN companies c ON c.id = t.company_id
         LEFT JOIN users u ON u.id = t.created_by
         ${whereSql}
        ORDER BY t.created_at DESC
        LIMIT $${i++} OFFSET $${i++}`,
      [...params, pageSize, offset],
    ),
    pool.query(`SELECT COUNT(*) AS c FROM ai_credit_transactions t ${whereSql}`, params),
  ]);
  return { rows: list.rows, total: Number(cnt.rows[0].c) || 0 };
}
