/**
 * utils/ai-credit-reconcile.ts — 크레딧 원장 · 잔액 대조(★ 2026-11-01 크레딧 컨트롤타워 C9 · 설계서 docs/2026-11-01-credit-control-tower-design.md §5)
 *
 * 원장(ai_credit_transactions)과 회사 잔액 칸(companies.ai_credits_*)은 진실이 두 곳이다(6원칙 ③). 매일 한 번 seq 순으로 읽어
 *   I3 = 직전 줄 잔액 + 이 줄 변동(creditTxDelta · §5-2) = 이 줄 잔액
 *   I4 = 마지막 seq 줄 잔액 = 회사 잔액 칸
 *   구매 잔액 ≥ 0 · 차감 = 두 항아리 모두 줄거나 그대로 · 환불 = 모두 늘거나 그대로
 * 을 검사하고, 1크레딧이라도 다르면 그날 경보(회사 · 날짜당 하나). 고치지 않는다(돈 = 사람 판정).
 * 읽는 범위 = 최근 RECONCILE_WINDOW_DAYS 일 줄 중 가장 작은 seq 바로 앞 줄(= 기준점)부터 끝까지의 seq 연속 구간
 *   (줄 시각과 seq 는 같은 순서가 아니다 · 밀린 마감은 지난 날짜 줄을 큰 seq 로 넣는다 · Codex 구현 2R-3). 최근 줄이 없으면 마지막 줄만(I4).
 *   원장 전체를 매일 다시 읽지 않는다(줄 수에 상한 없음) · 그 앞 옛 행의 옛 뜻은 검사하지 않는다(DDL 뒤 줄부터).
 */
import { pool } from '../config/database';
import { creditTxDelta, kstDateTag } from './ai-credit-calc';
import { creditSeqReady } from './ai-credit-month';

export interface ReconcileRow {
  seq: string;
  type: string;
  amount: number;
  overage_credits: number | null;
  balance_base_after: number | null;
  balance_purchased_after: number | null;
}

/** (순수) 한 회사 줄 목록(seq 오름차순) + 회사 잔액 칸 → 어긋남 설명 목록(빈 배열 = 맞음) */
export function reconcileCompanyRows(rows: ReconcileRow[], company: { base: number; purchased: number } | null): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.balance_base_after == null || r.balance_purchased_after == null) {
      out.push(`seq ${r.seq} ${r.type}: 잔액 칸이 비었다`);
      continue;
    }
    if (Number(r.balance_purchased_after) < 0) out.push(`seq ${r.seq} ${r.type}: 구매 잔액 ${r.balance_purchased_after} < 0`);
    const d = creditTxDelta(r);
    if (!d) {
      out.push(`seq ${r.seq}: 모르는 type ${r.type}`);
      continue;
    }
    if (i === 0) continue; // 기준점
    const p = rows[i - 1];
    if (p.balance_base_after == null || p.balance_purchased_after == null) continue; // 앞 줄 어긋남은 이미 적었다
    const dB = Number(r.balance_base_after) - Number(p.balance_base_after);
    const dP = Number(r.balance_purchased_after) - Number(p.balance_purchased_after);
    const ok = d.bucket === 'base' ? dB === d.delta && dP === 0
      : d.bucket === 'purchased' ? dP === d.delta && dB === 0
      : dB + dP === d.delta && (r.type === 'deduct' ? dB <= 0 && dP <= 0 : dB >= 0 && dP >= 0);
    if (!ok) out.push(`seq ${r.seq} ${r.type} ${r.amount}: 기본 ${p.balance_base_after}→${r.balance_base_after} · 구매 ${p.balance_purchased_after}→${r.balance_purchased_after}(변동표 ${d.delta})`);
  }
  const last = rows[rows.length - 1];
  if (last && company && (Number(last.balance_base_after) !== company.base || Number(last.balance_purchased_after) !== company.purchased)) {
    out.push(`마지막 seq ${last.seq} 잔액(기본 ${last.balance_base_after} · 구매 ${last.balance_purchased_after}) ≠ 회사 칸(기본 ${company.base} · 구매 ${company.purchased})`);
  }
  return out;
}

let warnedNoSeqOn = '';
const RECONCILE_WINDOW_DAYS = 40;

/** 하루 한 번(월 워커가 04:30 KST 뒤 첫 패스에 부른다) · 회사마다 REPEATABLE READ READ ONLY 스냅숏 */
export async function runCreditReconcilePass(now: Date = new Date()): Promise<{ checked: number; mismatched: number }> {
  const today = kstDateTag(now);
  if (!(await creditSeqReady(pool))) {
    if (warnedNoSeqOn !== today) {
      warnedNoSeqOn = today;
      console.warn('[credit-reconcile] seq 칸 없음(DDL 전) — 대조를 건너뜀');
    }
    return { checked: 0, mismatched: 0 };
  }
  const since = new Date(now.getTime() - RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const companies = await pool.query(`SELECT id FROM companies ORDER BY id`);
  let checked = 0;
  let mismatched = 0;
  for (const c of companies.rows) {
    const companyId = String(c.id);
    const client = await pool.connect();
    let problems: string[] = [];
    let rowCount = 0;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const rows = await client.query(
        `WITH lo AS (SELECT MIN(seq) AS s FROM ai_credit_transactions WHERE company_id = $1::uuid AND seq IS NOT NULL AND created_at >= $2::timestamptz)
         SELECT r.seq::text AS seq, r.type, r.amount, r.overage_credits, r.balance_base_after, r.balance_purchased_after
           FROM ai_credit_transactions r
          WHERE r.company_id = $1::uuid AND r.seq IS NOT NULL
            AND r.seq >= COALESCE(
                  (SELECT MAX(t.seq) FROM ai_credit_transactions t, lo WHERE t.company_id = $1::uuid AND t.seq < lo.s),
                  (SELECT s FROM lo),
                  (SELECT MAX(seq) FROM ai_credit_transactions WHERE company_id = $1::uuid AND seq IS NOT NULL))
          ORDER BY r.seq`,   // 숫자 순서(출력 별칭 seq 는 글자라 ORDER BY seq 면 99 → 100 경계가 뒤집힌다 · Codex 구현 3R)
        [companyId, since],
      );
      rowCount = rows.rows.length;
      const co = await client.query(
        `SELECT COALESCE(ai_credits_base_remaining, 0) AS base, COALESCE(ai_credits_purchased, 0) AS purchased FROM companies WHERE id = $1::uuid`,
        [companyId],
      );
      await client.query('COMMIT');
      problems = reconcileCompanyRows(rows.rows as ReconcileRow[], co.rows[0] ? { base: Number(co.rows[0].base), purchased: Number(co.rows[0].purchased) } : null);
    } catch (err: any) {
      try { await client.query('ROLLBACK'); } catch { /* 이미 끝난 트랜잭션 */ }
      problems = [`대조 조회 실패: ${err?.message || err}`];
    } finally {
      client.release();
    }
    if (rowCount === 0 && problems.length === 0) continue;   // seq 줄이 없는 회사(DDL 뒤 크레딧 변동 없음)
    checked++;
    if (problems.length === 0) continue;
    mismatched++;
    const { sendSystemAlert } = await import('./system-alert');
    await sendSystemAlert({
      companyId,
      dedupKey: `credit-reconcile:${companyId}:${today}`,
      message: `AI 크레딧 원장 · 잔액 어긋남(회사 ${companyId}) ${problems.length}건: ${problems.slice(0, 3).join(' / ').slice(0, 400)}`,
    }).catch(() => undefined);
  }
  console.log(`[credit-reconcile] 대조 ${checked}곳 · 어긋남 ${mismatched}곳`);
  return { checked, mismatched };
}
