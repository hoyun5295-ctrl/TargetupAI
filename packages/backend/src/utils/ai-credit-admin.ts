/**
 * utils/ai-credit-admin.ts — 관리 · 요금제 쪽 크레딧 일(★ 2026-11-01 크레딧 컨트롤타워 편입 · 설계서 docs/2026-11-01-credit-control-tower-design.md §16-1 F11~F15 · F17 · 뿌리 R39)
 *
 * 관리자 라우트 · 요금제 신청 · 체험 부여는 크레딧 칸을 직접 묻거나 쓰지 않고 이 함수들을 부른다.
 *   - 후불 한도 쓰기(F11) · 크레딧 모자람 회사 목록(F12 · F17 = 표시와 같은 투영 getCreditState + isCreditLow 한 판정)
 *   - 요금제 월 크레딧 바꾸기(F13 = 그 달 고정표 스냅숏과 한 거래 · 새 값은 다음 달 1일부터)
 *   - 요금제 월 크레딧 읽기(F14) · 체험 크레딧 양(F15)
 */
import { pool } from '../config/database';
import { getCreditState } from './ai-credit';
import { isCreditLow } from './ai-credit-calc';
import { planMonthCreditsReady, snapshotOpenMonths } from './ai-credit-month';

type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

/** 크레딧 칸 · 표가 아직 없어서 난 오류인가(DDL 전 · 라우트가 503 DB_MIGRATION_PENDING 으로 답한다) */
export function isCreditSchemaPending(err: unknown): boolean {
  const msg = String((err as any)?.message || '');
  return msg.includes('does not exist') && /plan_month_credits|ai_credit_requests|\bseq\b|reason/.test(msg);
}

/** 후불 추가 사용 한도 쓰기 — 없으면 null */
export async function setPostpaidOverageLimit(companyId: string, limit: number): Promise<{ companyName: string; overageLimit: number } | null> {
  const r = await pool.query(
    'UPDATE companies SET postpaid_overage_limit = $1, updated_at = NOW() WHERE id = $2 RETURNING company_name, postpaid_overage_limit',
    [Math.floor(limit), companyId],
  );
  if (r.rows.length === 0) return null;
  return { companyName: String(r.rows[0].company_name || ''), overageLimit: Number(r.rows[0].postpaid_overage_limit) || 0 };
}

export interface LowCreditCompany {
  id: string; companyName: string; planName: string;
  base: number; purchased: number; total: number; planCredits: number;
  risk: 'negative' | 'depleted' | 'low'; nearCap: boolean;
}

/**
 * 크레딧 모자람 회사(관리자 위험 회사 레이더) — 월 크레딧이 있는 요금제 회사 중 isCreditLow(표시와 같은 투영 · 여정 담당자 안내와 같은 판정).
 *   옛: 날 칸(월 마감 투영 없음)으로 「20% 이하」를 따로 셌다(여정 안내 = 「20% 밑」 · 기준 두 벌 · F17).
 */
export async function listLowCreditCompanies(limit = 200): Promise<LowCreditCompany[]> {
  const cands = await pool.query(
    `SELECT c.id, c.company_name, p.plan_name
       FROM companies c
       JOIN plans p ON c.plan_id = p.id
      WHERE p.ai_credits_per_month IS NOT NULL AND p.ai_credits_per_month > 0`,
  );
  const out: LowCreditCompany[] = [];
  for (const row of cands.rows) {
    const st = await getCreditState(String(row.id));
    if (!isCreditLow(st)) continue;
    const base = st.baseRemaining;
    const planCredits = st.planCredits;
    const total = st.total;
    // 위험 등급: 마이너스(운영 과금 음수 누적) > 소진(0) > 소진 임박
    const risk: LowCreditCompany['risk'] = total < 0 ? 'negative' : total === 0 ? 'depleted' : 'low';
    const nearCap = planCredits > 0 && base <= -(planCredits * 0.8);   // −1개월 grant 상한 80% 근접
    out.push({ id: String(row.id), companyName: row.company_name, planName: row.plan_name, base, purchased: st.purchased, total, planCredits, risk, nearCap });
  }
  return out.sort((a, b) => a.total - b.total).slice(0, limit);
}

/**
 * 요금제 월 크레딧 바꾸기(요금제 수정 거래 안 · 호출부가 그 요금제 행을 잠근 뒤).
 *   월 크레딧은 그 달에 고정 — 바꾸기 **전에** 아직 닫히지 않았을 수 있는 달 전부를 지금(수정 전) 값으로 고정하고 같은 거래에서 바꾼다(★ C10 · P14 · Codex R3-3).
 *   반환 = 'unchanged'(같은 값) · 'changed'(새 값은 다음 달 1일부터) · 'migration_pending'(고정표 없음 = 바꾸지 않음) · 'not_found'.
 */
export async function setPlanMonthCredits(client: Db, planId: string, credits: number, now: Date): Promise<'unchanged' | 'changed' | 'migration_pending' | 'not_found'> {
  const cur = await client.query(`SELECT ai_credits_per_month FROM plans WHERE id = $1 FOR UPDATE`, [planId]);
  if (cur.rows.length === 0) return 'not_found';
  if (Number(cur.rows[0].ai_credits_per_month ?? -1) === credits) return 'unchanged';
  if (!(await planMonthCreditsReady(client))) return 'migration_pending';
  await snapshotOpenMonths(client, now);
  await client.query(`UPDATE plans SET ai_credits_per_month = $2 WHERE id = $1`, [planId, credits]);
  return 'changed';
}

/** 요금제 월 크레딧(요금제 표 지금 값 · 없으면 null = 크레딧제 미적용 요금제) */
export async function planMonthCreditsOf(planId: string, db: Db = pool): Promise<number | null> {
  const r = await db.query(`SELECT ai_credits_per_month FROM plans WHERE id = $1`, [planId]);
  const v = r.rows[0]?.ai_credits_per_month;
  return v == null ? null : Number(v);
}

