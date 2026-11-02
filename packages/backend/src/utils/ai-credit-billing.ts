/**
 * utils/ai-credit-billing.ts — 후불 크레딧 청구 줄(★ 2026-11-01 크레딧 컨트롤타워 편입 · 설계서 docs/2026-11-01-credit-control-tower-design.md §16-1 F10 · 뿌리 R39)
 *
 * 정산(발행 · 정액 발행 거부 · 발행 삭제 되돌림 · 미리보기)은 크레딧 표를 직접 묻지 않고 이 함수들을 부른다.
 *   청구 줄 = 기간 안 승인 · 미청구 충전 요청 + 미청구 초과 차감 줄(overage_credits > 0 · billed_billing_id 없음).
 *   기간 = 발행 기간 한국 날짜(시작 0시 ~ 끝 다음 날 0시 · 세션 TZ 가 UTC 라 date 캐스트를 쓰지 않는다 · ★ 2026-07-26 경계 그대로).
 *   옮김 = 정산 코드의 원본 SQL 그대로(★ 1101 · 동작 그대로).
 */
type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

const REQ_IN_PERIOD = `company_id = $1::uuid AND status = 'approved' AND billed = false
            AND processed_at >= ($2 || ' 00:00:00+09')::timestamptz
            AND processed_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz`;
const OVERAGE_IN_PERIOD = `company_id = $1::uuid AND type = 'deduct' AND overage_credits > 0
            AND billed_billing_id IS NULL
            AND created_at >= ($2 || ' 00:00:00+09')::timestamptz
            AND created_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz`;

export interface CreditBillingLines {
  /** 승인 · 미청구 충전 요청(발행이 billed 로 표시할 줄) */
  requestIds: string[];
  /** 충전 크레딧 수 · 공급가 합 */
  chargeCount: number;
  chargeSupply: number;
  /** 미청구 초과 차감 줄(발행이 billed_billing_id 로 표시할 줄) · 초과 크레딧 합 */
  overageTxIds: string[];
  overageCount: number;
}

/** 발행 — 이 기간 청구 줄(FOR UPDATE = 합산한 줄과 표시할 줄이 같다) */
export async function loadCreditBillingLines(client: Db, companyId: string, start: string, end: string): Promise<CreditBillingLines> {
  const req = await client.query(`SELECT id, credits, supply_amount FROM ai_credit_requests WHERE ${REQ_IN_PERIOD} FOR UPDATE`, [companyId, start, end]);
  const ov = await client.query(`SELECT id, overage_credits FROM ai_credit_transactions WHERE ${OVERAGE_IN_PERIOD} FOR UPDATE`, [companyId, start, end]);
  return {
    requestIds: req.rows.map((r: any) => String(r.id)),
    chargeCount: req.rows.reduce((s: number, r: any) => s + Number(r.credits || 0), 0),
    chargeSupply: req.rows.reduce((s: number, r: any) => s + Number(r.supply_amount || 0), 0),
    overageTxIds: ov.rows.map((r: any) => String(r.id)),
    overageCount: ov.rows.reduce((s: number, r: any) => s + (Number(r.overage_credits) || 0), 0),
  };
}

/** 미리보기 — 발행과 같은 기준 · 읽기만(billed 는 건드리지 않는다) */
export async function previewCreditBillingLines(db: Db, companyId: string, start: string, end: string): Promise<{ chargeCount: number; chargeSupply: number; overageCount: number }> {
  const req = await db.query(`SELECT credits, supply_amount FROM ai_credit_requests WHERE ${REQ_IN_PERIOD}`, [companyId, start, end]);
  const ov = await db.query(`SELECT COALESCE(SUM(overage_credits), 0) AS oc FROM ai_credit_transactions WHERE ${OVERAGE_IN_PERIOD}`, [companyId, start, end]);
  return {
    chargeCount: req.rows.reduce((s: number, r: any) => s + Number(r.credits || 0), 0),
    chargeSupply: req.rows.reduce((s: number, r: any) => s + Number(r.supply_amount || 0), 0),
    overageCount: Number(ov.rows[0]?.oc) || 0,
  };
}

/** 정액 발행 거부 판정 — 이 기간 미청구 크레딧 줄(충전 · 초과)이 있나 */
export async function hasUnbilledCreditLines(client: Db, companyId: string, start: string, end: string): Promise<boolean> {
  const req = await client.query(`SELECT 1 FROM ai_credit_requests WHERE ${REQ_IN_PERIOD} LIMIT 1`, [companyId, start, end]);
  if (req.rows.length > 0) return true;
  const ov = await client.query(`SELECT 1 FROM ai_credit_transactions WHERE ${OVERAGE_IN_PERIOD} LIMIT 1`, [companyId, start, end]);
  return ov.rows.length > 0;
}

/** 발행 표시 — 크레딧을 실은 장 id 로 충전 · 초과 줄을 묶는다(id 배열로 정확히 · 중복 청구 차단) */
export async function markCreditBillingLines(client: Db, billingId: string, lines: Pick<CreditBillingLines, 'requestIds' | 'overageTxIds'>): Promise<void> {
  if (lines.requestIds.length > 0) {
    await client.query(`UPDATE ai_credit_requests SET billed = true, billed_invoice_id = $1::uuid WHERE id = ANY($2::uuid[])`, [billingId, lines.requestIds]);
  }
  if (lines.overageTxIds.length > 0) {
    await client.query(`UPDATE ai_credit_transactions SET billed_billing_id = $1::uuid WHERE id = ANY($2::uuid[])`, [billingId, lines.overageTxIds]);
  }
}

/** 발행 삭제 되돌림 — 그 장들이 실었던 충전 · 초과 줄을 다시 청구 대상으로(반환 = 되돌린 줄 수 · 로그용) */
export async function unmarkCreditBillingLines(client: Db, billingIds: string[]): Promise<{ requests: number; overage: number }> {
  const r1 = await client.query(
    `UPDATE ai_credit_requests SET billed = false, billed_invoice_id = NULL WHERE billed_invoice_id = ANY($1::uuid[]) RETURNING id`,
    [billingIds],
  );
  const r2 = await client.query(
    `UPDATE ai_credit_transactions SET billed_billing_id = NULL WHERE billed_billing_id = ANY($1::uuid[]) RETURNING id`,
    [billingIds],
  );
  return { requests: r1.rows.length, overage: r2.rows.length };
}
