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

import { pool } from '../config/database';
import { needsMonthlyReset } from './ai-credit-calc';
import { setCreditEvent } from './request-context';
import {
  loadCreditRow,
  applyResetIfNeeded,
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

/** 호출 전 사전 차단 — 보유 크레딧이 작업 비용보다 적으면 throw InsufficientCreditError. */
export async function checkCredit(companyId: string, cost: number): Promise<void> {
  if (!companyId || !cost || cost <= 0) return;
  const st = await getCreditState(companyId);
  if (!st.creditEnabled) return;  // 크레딧제 미적용(요금제 크레딧 미설정) → 통과(차단 X)
  // ★ D227+ 후불은 추가 사용 한도까지 통과(월말 청구). 선불은 보유 부족 시 차단.
  const overageAllowed = st.billingType === 'postpaid' ? Math.max(0, st.overageLimit) : 0;
  if (st.total + overageAllowed < cost) {
    throw new InsufficientCreditError(cost, st.total);
  }
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
export async function deductCreditSafe(
  opts: {
    companyId: string | null;
    cost: number;
    source: string;
    aiCallLogId?: string | null;
    createdBy?: string | null;
    /** 멱등키 직접 지정(회사+행위 고정 키). 재시도·재개·동시요청 중복 차감 차단. 미지정 시 aiCallLogId/fallback 기준. */
    idempotencyKey?: string;
  },
  _deps?: { deductFn?: typeof deductCredit; sleep?: (ms: number) => Promise<void> }
): Promise<boolean> {
  // 차감 대상이 아니다 = 남은 의무가 없다. false로 답하면 호출부가 정상 흐름을 보류로 오판한다.
  if (!opts.companyId || !opts.cost || opts.cost <= 0) return true;
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
        return true;
      }
      // 차감이 안 일어났다 — 사유를 봐야 "돈이 빠졌는가"가 갈린다(재시도해도 바뀌지 않는 결말들이다).
      if (result?.skipReason === 'duplicate' || result?.skipReason === 'not_applicable') return true;
      console.log(`[CREDIT][MISS] company=${opts.companyId} source=${opts.source} cost=${opts.cost} aiCallLogId=${opts.aiCallLogId || 'none'} reason=${result?.skipReason || 'unknown'}`);
      return false;
    } catch (err: any) {
      // 잔액 부족 = 정상 차단(사전 checkCredit 통과 후 동시 소진). 재시도 무의미.
      if (err instanceof InsufficientCreditError) {
        console.log(`[CREDIT][SKIP] insufficient company=${opts.companyId} source=${opts.source} cost=${opts.cost} aiCallLogId=${opts.aiCallLogId || 'none'}`);
        return false;
      }
      if (attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 200);
        continue;
      }
      // 영구 실패 — stdout 추적(LESSONS_BACKEND: console.log 의무). aiCallLogId로 수동 재차감 가능.
      console.log(`[CREDIT][MISS] company=${opts.companyId} source=${opts.source} cost=${opts.cost} aiCallLogId=${opts.aiCallLogId || 'none'} attempts=${MAX_ATTEMPTS} err=${err?.message}`);
      return false;
    }
  }
  return false;
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
