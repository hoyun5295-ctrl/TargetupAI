/**
 * plan-term.ts — 선불 요금제 이용 기간 컨트롤타워 (★2026-10-04 신설)
 *
 * 설계 = docs/2026-10-04-prepaid-plan-term-design.md. 계산은 plan-term-calc.ts(순수)가 소유한다.
 *
 * ⛔ 쓰기 입구는 이 파일 하나다. `companies.plan_term_*` 칸과 `company_plan_term_events` 표를 다른 파일이 쓰면
 *    계약 테스트(plan-term-contract.test.ts)가 막는다. 요금제 이용료 차감(balance_transactions reference_type 'plan_term')도 여기서만 만든다.
 *
 * 공통 규칙
 *  - 잠금 = companies 행 FOR UPDATE 한 줄(prepaidDeduct·AI 충전과 같은 축 · LESSONS_DB 30). 교착이 생길 다른 잠금을 잡지 않는다.
 *  - 모든 변경 = 회차(plan_term_version) +1 을 조건부 UPDATE로 차지하고 원장 1행(LESSONS_DB 14 회차 멱등).
 *  - 날짜는 전부 'YYYY-MM-DD' 문자열(to_jsonb·to_char로 읽는다). 오늘 = todayKst() 하나를 인자로 받는다. DB의 현재 날짜 함수는 쓰지 않는다(DB 시간대가 UTC라 KST 00~09시에 전날이 된다).
 *  - 모든 진입(승인·견적·연장·관리자 조작·워커)이 잠금 직후 만료 정산(settle)을 먼저 돈다 — 만료~워커 사이 창에서
 *    옛 상태로 판정하면 0원 올림 같은 틀린 결과가 난다(회의론자 최종 #5).
 *  - DDL 전(컬럼·표 부재)에는 준비 안 됨으로 판정해 기존 경로를 그대로 탄다(회의론자 최종 #2 · 설계 §8).
 */

import type { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import pool, { query } from '../config/database';
import { recordPlanChange, todayKst } from './plan-change-log';
import { sendSystemAlert } from './system-alert';
import { carriedBaseOnReset } from './ai-credit-tx';
import { shiftDayKey } from './plan-proration';
import {
  periodEnd, monthlyCharge, planOfDay, upgradeCharge, lastPlanSetterPlanId, daysLeft,
  decideSettle, decidePlanRequest, isYmd, PURCHASE_EVENT_TYPES, type TermEvent,
} from './plan-term-calc';

export const PLAN_TERM_REFERENCE_TYPE = 'plan_term';

/**
 * 관리 중 판정 SQL 조각 — 컬럼이 없어도 깨지지 않는다(to_jsonb). 게이트(회사 수정·체험·진단·무료 메시징)가 쓴다.
 * @param rowExpr companies 행 별칭 또는 테이블명(예: 'c', 'companies')
 */
export function planTermManagedSql(rowExpr: string): string {
  return `((to_jsonb(${rowExpr}) ->> 'plan_term_expires_on') IS NOT NULL)`;
}

/** 라우트가 상태 코드·본문을 그대로 돌려주는 오류 */
export class PlanTermError extends Error {
  status: number;
  body: { error: string; code: string; [k: string]: any };
  constructor(status: number, body: { error: string; code: string; [k: string]: any }) {
    super(body.error);
    this.name = 'PlanTermError';
    this.status = status;
    this.body = body;
  }
}

export const migrationPendingError = () => new PlanTermError(503, {
  code: 'DB_MIGRATION_PENDING',
  error: 'DB 마이그레이션 필요: companies(plan_term_* 5칸)·company_plan_term_events ALTER 실행 요청',
});

/** 관리 중 회사에 체험·요금제 직접 변경이 들어왔을 때(체험 코어·회사 수정이 던진다) */
export const planTermManagedError = (what: string) => new PlanTermError(409, {
  code: 'PLAN_TERM_MANAGED',
  error: `선불 이용 기간 중인 회사는 ${what}. 요금제 변경은 고객 신청 승인으로, 종료는 단가/요금 탭의 이용 기간에서 합니다.`,
});

export interface TermActor {
  type: 'company_user' | 'super_admin' | 'system';
  id?: string | null;
  label?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}
const SYSTEM: TermActor = { type: 'system', label: '자동' };

interface PlanRow { id: string; plan_code: string; plan_name: string; monthly_price: number; ai_credits_per_month: number }

interface TermRow {
  id: string;
  company_name: string;
  status: string | null;
  billing_type: string;
  balance: number;
  plan_id: string | null;
  ready: boolean;
  expires_on: string | null;
  auto_renew: boolean;
  restore_plan_id: string | null;
  next_plan_id: string | null;
  version: number;
  ai_base: number;
  ai_purchased: number;
}

interface TermState { row: TermRow; events: (TermEvent & { id: string; created_at: string; detail: any })[]; today: string }

// ════════════════════════════════════════════════════════════
// 읽기
// ════════════════════════════════════════════════════════════

const ROW_SELECT = `
  SELECT c.id, c.company_name, c.status, c.billing_type, c.balance, c.plan_id,
         ((to_jsonb(c) ? 'plan_term_version') AND to_regclass('public.company_plan_term_events') IS NOT NULL) AS ready,
         to_jsonb(c) ->> 'plan_term_expires_on' AS expires_on,
         COALESCE((to_jsonb(c) ->> 'plan_term_auto_renew')::boolean, true) AS auto_renew,
         to_jsonb(c) ->> 'plan_term_restore_plan_id' AS restore_plan_id,
         to_jsonb(c) ->> 'plan_term_next_plan_id' AS next_plan_id,
         COALESCE((to_jsonb(c) ->> 'plan_term_version')::int, 0) AS version,
         COALESCE(c.ai_credits_base_remaining, 0) AS ai_base,
         COALESCE(c.ai_credits_purchased, 0) AS ai_purchased
    FROM companies c
   WHERE c.id = $1`;

function toRow(r: any): TermRow {
  return {
    id: String(r.id),
    company_name: r.company_name || '',
    status: r.status ?? null,
    billing_type: String(r.billing_type || ''),
    balance: Number(r.balance) || 0,
    plan_id: r.plan_id ? String(r.plan_id) : null,
    ready: r.ready === true,
    expires_on: r.expires_on || null,
    auto_renew: r.auto_renew !== false,
    restore_plan_id: r.restore_plan_id || null,
    next_plan_id: r.next_plan_id || null,
    version: Number(r.version) || 0,
    ai_base: Number(r.ai_base) || 0,
    ai_purchased: Number(r.ai_purchased) || 0,
  };
}

async function loadEvents(db: { query: PoolClient['query'] } | typeof pool, companyId: string): Promise<TermState['events']> {
  const r = await (db as any).query(
    `SELECT id, term_version, event_type, plan_id, monthly_price,
            to_char(covers_from, 'YYYY-MM-DD') AS covers_from, to_char(covers_to, 'YYYY-MM-DD') AS covers_to,
            created_at, detail
       FROM company_plan_term_events WHERE company_id = $1 ORDER BY term_version`,
    [companyId],
  );
  return r.rows.map((e: any) => ({
    ...e,
    id: String(e.id),
    term_version: Number(e.term_version),
    plan_id: e.plan_id ? String(e.plan_id) : null,
    created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
  }));
}

/** 회사 행을 잠그고 상태·원장을 읽는다. 준비 안 됨이면 events는 빈 배열 */
async function lockTerm(client: PoolClient, companyId: string, today: string): Promise<TermState | null> {
  const r = await client.query(`${ROW_SELECT} FOR UPDATE OF c`, [companyId]);
  if (r.rows.length === 0) return null;
  const row = toRow(r.rows[0]);
  // 원장은 관리 중 회사만 읽는다(미관리는 판정에 원장이 필요 없다 · 승인·전환마다 도는 경로라 비용을 늘리지 않는다)
  const events = row.ready && row.expires_on ? await loadEvents(client, companyId) : [];
  return { row, events, today };
}

async function getPlan(db: { query: (s: string, p?: any[]) => Promise<any> }, planId: string | null): Promise<PlanRow | null> {
  if (!planId) return null;
  const r = await db.query(
    `SELECT id, plan_code, plan_name, COALESCE(monthly_price, 0) AS monthly_price, COALESCE(ai_credits_per_month, 0) AS ai_credits_per_month
       FROM plans WHERE id = $1::uuid`,
    [planId],
  );
  const p = r.rows[0];
  return p ? { id: String(p.id), plan_code: String(p.plan_code || ''), plan_name: p.plan_name || p.plan_code || '', monthly_price: Number(p.monthly_price) || 0, ai_credits_per_month: Number(p.ai_credits_per_month) || 0 } : null;
}

async function getFreePlan(db: { query: (s: string, p?: any[]) => Promise<any> }): Promise<PlanRow> {
  const r = await db.query(`SELECT id FROM plans WHERE plan_code = 'FREE' LIMIT 1`);
  const p = r.rows[0] ? await getPlan(db, String(r.rows[0].id)) : null;
  if (!p) throw new PlanTermError(500, { code: 'FREE_PLAN_MISSING', error: '미가입(FREE) 요금제가 없습니다.' });
  return p;
}

const isManaged = (s: TermState) => s.row.ready && !!s.row.expires_on;
const isBlocked = (s: TermState) => isManaged(s) && !!s.row.restore_plan_id;

/** 다음 1개월을 살 요금제 = 내림 예약 ?? 만료일의 요금제 ?? 현재 요금제 */
function nextPurchasePlanId(s: TermState): string | null {
  const { row, events } = s;
  if (row.next_plan_id) return row.next_plan_id;
  if (row.expires_on) {
    const p = planOfDay(events, row.expires_on);
    if (p?.planId) return p.planId;
  }
  return row.plan_id;
}

// ════════════════════════════════════════════════════════════
// 쓰기 부품
// ════════════════════════════════════════════════════════════

interface TermChanges {
  expires_on?: string | null;
  auto_renew?: boolean;
  restore_plan_id?: string | null;
  next_plan_id?: string | null;
  /** plan_id 교체. paid=true면 subscription_status='paid'·trial_expires_at=NULL 동반(체험 경로가 관리 회사를 못 건드리게) */
  plan?: { id: string; paid: boolean };
}

/** 회차를 차지하며 상태 칸을 쓴다. 잠금을 쥔 상태라 CAS 실패는 결함이다(던진다). */
async function writeTerm(client: PoolClient, s: TermState, ch: TermChanges): Promise<number> {
  const sets: string[] = ['plan_term_version = plan_term_version + 1', 'updated_at = NOW()'];
  const params: any[] = [s.row.id, s.row.version];
  const add = (sql: string, v: any) => { params.push(v); sets.push(sql.replace('?', `$${params.length}`)); };
  if ('expires_on' in ch) add('plan_term_expires_on = ?::date', ch.expires_on);
  if ('auto_renew' in ch) add('plan_term_auto_renew = ?::boolean', ch.auto_renew);
  if ('restore_plan_id' in ch) add('plan_term_restore_plan_id = ?::uuid', ch.restore_plan_id);
  if ('next_plan_id' in ch) add('plan_term_next_plan_id = ?::uuid', ch.next_plan_id);
  if (ch.plan) {
    add('plan_id = ?::uuid', ch.plan.id);
    if (ch.plan.paid) sets.push(`subscription_status = 'paid'`, 'trial_expires_at = NULL');
  }
  const r = await client.query(
    `UPDATE companies SET ${sets.join(', ')} WHERE id = $1 AND plan_term_version = $2 RETURNING plan_term_version`,
    params,
  );
  if (r.rows.length === 0) {
    throw new PlanTermError(409, { code: 'VERSION_CHANGED', error: '이용 기간이 방금 바뀌었습니다. 다시 확인해 주세요.' });
  }
  const v = Number(r.rows[0].plan_term_version);
  s.row.version = v;
  if ('expires_on' in ch) s.row.expires_on = ch.expires_on ?? null;
  if ('auto_renew' in ch) s.row.auto_renew = !!ch.auto_renew;
  if ('restore_plan_id' in ch) s.row.restore_plan_id = ch.restore_plan_id ?? null;
  if ('next_plan_id' in ch) s.row.next_plan_id = ch.next_plan_id ?? null;
  if (ch.plan) s.row.plan_id = ch.plan.id;
  return v;
}

interface EventInput {
  id?: string;
  type: string;
  plan?: PlanRow | null;
  coversFrom?: string | null;
  coversTo?: string | null;
  charge?: { supply: number; vat: number; total: number } | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  balanceTxId?: string | null;
  expiresBefore?: string | null;
  expiresAfter?: string | null;
  actor: TermActor;
  requestId?: string | null;
  reason?: string | null;
  detail?: any;
}

async function insertEvent(client: PoolClient, s: TermState, version: number, e: EventInput): Promise<string> {
  const id = e.id || randomUUID();
  await client.query(
    `INSERT INTO company_plan_term_events
       (id, company_id, term_version, event_type, plan_id, plan_code, monthly_price, covers_from, covers_to,
        supply_amount, vat_amount, total_amount, balance_before, balance_after, balance_tx_id,
        expires_before, expires_after, actor_type, actor_id, actor_label, request_id, ip, user_agent, reason, detail)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7, $8::date, $9::date,
             $10, $11, $12, $13, $14, $15::uuid,
             $16::date, $17::date, $18, $19::uuid, $20, $21::uuid, $22, $23, $24, $25::jsonb)`,
    [
      id, s.row.id, version, e.type, e.plan?.id ?? null, e.plan?.plan_code ?? null, e.plan ? e.plan.monthly_price : null,
      e.coversFrom ?? null, e.coversTo ?? null,
      e.charge?.supply ?? 0, e.charge?.vat ?? 0, e.charge?.total ?? 0,
      e.balanceBefore ?? null, e.balanceAfter ?? null, e.balanceTxId ?? null,
      e.expiresBefore ?? null, e.expiresAfter ?? null,
      e.actor.type, e.actor.id ?? null, (e.actor.label ?? '').slice(0, 100) || null, e.requestId ?? null,
      (e.actor.ip ?? '').slice(0, 64) || null, e.actor.userAgent ?? null, e.reason ?? null,
      e.detail === undefined ? null : JSON.stringify(e.detail),
    ],
  );
  s.events.push({
    id, term_version: version, event_type: e.type, plan_id: e.plan?.id ?? null,
    monthly_price: e.plan ? e.plan.monthly_price : null,
    covers_from: e.coversFrom ?? null, covers_to: e.coversTo ?? null,
    created_at: new Date().toISOString(), detail: e.detail ?? null,
  });
  return id;
}

/** 잔액 차감 + 잔액 원장. 잠금을 쥔 상태에서 부른다. 부족하면 false(아무것도 안 바뀜). */
async function deduct(
  client: PoolClient, s: TermState, total: number, eventId: string, description: string, actor: TermActor,
): Promise<{ ok: true; before: number; after: number; txId: string } | { ok: false }> {
  if (total <= 0) return { ok: true, before: s.row.balance, after: s.row.balance, txId: '' };
  const u = await client.query(
    `UPDATE companies SET balance = balance - $1, updated_at = NOW() WHERE id = $2 AND balance >= $1 RETURNING balance`,
    [total, s.row.id],
  );
  if (u.rows.length === 0) return { ok: false };
  const before = s.row.balance;
  const after = Number(u.rows[0].balance);
  const tx = await client.query(
    `INSERT INTO balance_transactions
       (company_id, type, amount, balance_before, balance_after, description, reference_type, reference_id, payment_method, created_by)
     VALUES ($1, 'deduct', $2, $3, $4, $5, $6, $7::uuid, 'system', $8)
     RETURNING id`,
    [s.row.id, total, before, after, description, PLAN_TERM_REFERENCE_TYPE, eventId,
      actor.type === 'company_user' ? (actor.id ?? null) : null],
  );
  s.row.balance = after;
  return { ok: true, before, after, txId: String(tx.rows[0].id) };
}

const won = (n: number) => `${Math.floor(n).toLocaleString('ko-KR')}원`;

async function changePlan(
  client: PoolClient, s: TermState, toPlan: PlanRow, actor: TermActor, reason: string,
): Promise<void> {
  await recordPlanChange({
    client, companyId: s.row.id, toPlanId: toPlan.id, changeType: 'auto',
    changedBy: actor.type === 'system' ? null : (actor.id ?? null), reason, effectiveDate: s.today,
  });
}

async function alertOnce(key: string, message: string): Promise<void> {
  console.warn(`[plan-term] ${message}`);
  await sendSystemAlert({ dedupKey: `plan-term:${key}`, message: `선불 이용 기간: ${message}` })
    .catch((e: any) => console.warn('[plan-term] 알림 실패', e?.message || e));
}

// ════════════════════════════════════════════════════════════
// 동작
// ════════════════════════════════════════════════════════════

/** 1개월 구매(자동 결제·직접 연장·복구·첫 결제). 부족하면 PlanTermError 402 */
async function purchase(
  client: PoolClient, s: TermState,
  o: { kind: 'first_charge' | 'renew' | 'extend' | 'restore'; plan: PlanRow; coversFrom: string; actor: TermActor; requestId?: string | null },
): Promise<void> {
  const coversTo = periodEnd(o.coversFrom);
  if (!coversTo) throw new PlanTermError(500, { code: 'BAD_DATE', error: '이용 기간 날짜를 계산하지 못했습니다.' });
  const charge = monthlyCharge(o.plan.monthly_price);
  const eventId = randomUUID();
  const d = await deduct(client, s, charge.total, eventId,
    `[요금제 이용료] ${o.plan.plan_name} 1개월 ${o.coversFrom}~${coversTo} (공급가 ${won(charge.supply)} + 부가세 ${won(charge.vat)})`, o.actor);
  if (!d.ok) {
    throw new PlanTermError(402, {
      code: 'INSUFFICIENT_BALANCE', error: `잔액이 부족합니다. 필요 ${won(charge.total)} / 현재 ${won(s.row.balance)}`,
      insufficientBalance: true, balance: s.row.balance, requiredAmount: charge.total,
    });
  }
  const expiresBefore = s.row.expires_on;
  const setsPlan = o.kind === 'first_charge' || o.kind === 'restore';
  const planChanged = setsPlan && s.row.plan_id !== o.plan.id;
  const ch: TermChanges = { expires_on: coversTo, next_plan_id: null };
  if (setsPlan) Object.assign(ch, { restore_plan_id: null, plan: { id: o.plan.id, paid: true } });
  if (o.kind === 'first_charge') ch.auto_renew = true;
  const v = await writeTerm(client, s, ch);
  await insertEvent(client, s, v, {
    id: eventId, type: o.kind, plan: o.plan, coversFrom: o.coversFrom, coversTo, charge,
    balanceBefore: d.before, balanceAfter: d.after, balanceTxId: d.txId || null,
    expiresBefore, expiresAfter: coversTo, actor: o.actor, requestId: o.requestId ?? null,
  });
  if (planChanged) await changePlan(client, s, o.plan, o.actor, `선불 이용 기간 ${o.kind === 'restore' ? '다시 열기' : '시작'}(${o.plan.plan_code})`);
  if (o.kind === 'restore') await topUpAiCreditsOnRestore(client, s, o.plan, v);
}

/**
 * 잠긴 동안 FREE 기준으로 월 리셋이 돌았으면 복구 요금제 한 달치로 base를 다시 채운다(설계 §4 · 회의론자 최종 #17).
 * 리셋이 안 돌았으면 손대지 않는다 — 다음 AI 사용 때 복구된 요금제로 lazy 리셋된다.
 * INSERT가 먼저고, 실제로 들어간 경우에만 base를 고친다(이중 지급 차단).
 */
async function topUpAiCreditsOnRestore(client: PoolClient, s: TermState, plan: PlanRow, version: number): Promise<void> {
  const block = [...s.events].reverse().find((e) => e.event_type === 'block');
  if (!block) return;
  const reset = await client.query(
    `SELECT 1 FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND source = 'monthly-reset' AND created_at >= $2::timestamptz LIMIT 1`,
    [s.row.id, block.created_at],
  );
  if (reset.rows.length === 0) return;
  const credits = plan.ai_credits_per_month;
  const base = carriedBaseOnReset({ plan_credits: credits, base: s.row.ai_base, billing_type: 'prepaid' });
  const ins = await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, reason)
     VALUES ($1::uuid, 'reset', $2, 'base', 'plan-term-restore', $3, $4, $5, $6)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [s.row.id, credits, `plan-term-restore:${s.row.id}:${version}`, base, s.row.ai_purchased,
      `선불 이용 기간 다시 열기: 잠긴 동안 지난 월 리셋분 보충(${plan.plan_code})`],
  );
  if ((ins.rowCount || 0) === 0) return;
  await client.query(`UPDATE companies SET ai_credits_base_remaining = $2 WHERE id = $1::uuid`, [s.row.id, base]);
  s.row.ai_base = base;
}

/** 잠금: plan_id ← FREE, 복구할 요금제 기억(D2). subscription_status는 건드리지 않는다(expired는 발송까지 막는다). */
async function block(client: PoolClient, s: TermState, reason: 'insufficient' | 'auto_off', required: number): Promise<void> {
  const free = await getFreePlan(client);
  const restoreId = nextPurchasePlanId(s);
  const restore = await getPlan(client, restoreId);
  const v = await writeTerm(client, s, { plan: { id: free.id, paid: false }, restore_plan_id: restoreId, next_plan_id: null });
  await insertEvent(client, s, v, {
    type: 'block', plan: restore, expiresBefore: s.row.expires_on, expiresAfter: s.row.expires_on, actor: SYSTEM,
    detail: { reason, balance: s.row.balance, required, expires_on: s.row.expires_on },
  });
  await changePlan(client, s, free, SYSTEM,
    `선불 요금제 이용 기간 만료 잠금(${reason === 'insufficient' ? '잔액 부족' : '자동 연장 꺼짐'})`);
}

/** 다음 구매가 FREE(내림 예약)인 만료 — FREE로 바꾸고 관리를 끝낸다 */
async function expireToFree(client: PoolClient, s: TermState): Promise<void> {
  const free = await getFreePlan(client);
  const expiresBefore = s.row.expires_on;
  const changed = s.row.plan_id !== free.id;
  const v = await writeTerm(client, s, {
    plan: { id: free.id, paid: false }, expires_on: null, restore_plan_id: null, next_plan_id: null, auto_renew: true,
  });
  await insertEvent(client, s, v, { type: 'expire_free', plan: free, expiresBefore, expiresAfter: null, actor: SYSTEM });
  if (changed) await changePlan(client, s, free, SYSTEM, '선불 이용 기간 만료: 미가입 전환(내림 예약)');
}

/** 관리 종료(요금제는 그대로, 환불 없음). 세 칸을 한 UPDATE로 비운다(회의론자 최종 #16). */
async function endTerm(client: PoolClient, s: TermState, actor: TermActor, reason: string): Promise<void> {
  const expiresBefore = s.row.expires_on;
  const v = await writeTerm(client, s, { expires_on: null, restore_plan_id: null, next_plan_id: null, auto_renew: true });
  await insertEvent(client, s, v, { type: 'end', expiresBefore, expiresAfter: null, actor, reason });
}

/**
 * 정렬: 오늘의 원장 요금제로 plan_id를 맞춘다(미리 산 다른 요금제 구간이 시작된 날).
 * plan_id가 "마지막으로 요금제를 정한 이벤트"의 요금제와 같을 때만 바꾼다 — 다르면 CT 밖에서 바뀐 것이라 손대지 않고 알린다.
 */
async function align(client: PoolClient, s: TermState): Promise<void> {
  if (!isManaged(s) || isBlocked(s)) return;
  const p = planOfDay(s.events, s.today);
  if (!p?.planId || p.planId === s.row.plan_id) return;
  const guard = lastPlanSetterPlanId(s.events);
  if (guard !== s.row.plan_id) {
    await alertOnce(`align-mismatch:${s.row.id}`,
      `${s.row.company_name}(${s.row.id.slice(0, 8)}) 요금제가 이용 기간 원장과 다릅니다(현재 ${s.row.plan_id} / 원장 ${p.planId}). 손대지 않았습니다.`);
    return;
  }
  const plan = await getPlan(client, p.planId);
  if (!plan) return;
  const v = await writeTerm(client, s, { plan: { id: plan.id, paid: plan.monthly_price > 0 } });
  await insertEvent(client, s, v, { type: 'align', plan, actor: SYSTEM });
  await changePlan(client, s, plan, SYSTEM, `선불 이용 기간: 미리 산 구간 시작(${plan.plan_code})`);
}

/** 만료 정산 — 한 번에 1회차. 잠긴 회사는 재시도하지 않는다. */
async function settle(client: PoolClient, s: TermState): Promise<void> {
  const { row } = s;
  if (!isManaged(s) || isBlocked(s) || !(row.expires_on! < s.today)) return;
  if (row.billing_type !== 'prepaid' || row.status === 'terminated') {
    await alertOnce(`settle-skip:${row.id}`, `${row.company_name}(${row.id.slice(0, 8)}) 만료 정산을 건너뜀: 결제방식 ${row.billing_type} · 상태 ${row.status}`);
    return;
  }
  const nextPlan = await getPlan(client, nextPurchasePlanId(s));
  if (!nextPlan) {
    await alertOnce(`settle-noplan:${row.id}`, `${row.company_name}(${row.id.slice(0, 8)}) 다음 구매 요금제를 찾지 못해 정산을 멈췄습니다.`);
    return;
  }
  const action = decideSettle({
    blocked: false, expiresOn: row.expires_on!, today: s.today, autoRenew: row.auto_renew, balance: row.balance,
    nextPlan: { code: nextPlan.plan_code, price: nextPlan.monthly_price },
  });
  if (action === 'alert') {
    await alertOnce(`settle-zero:${row.id}`, `${row.company_name}(${row.id.slice(0, 8)}) 다음 구매 요금제가 0원(${nextPlan.plan_code})이라 정산하지 않았습니다.`);
  } else if (action === 'expire_free') {
    await expireToFree(client, s);
  } else if (action === 'renew') {
    await purchase(client, s, { kind: 'renew', plan: nextPlan, coversFrom: shiftDayKey(row.expires_on!, 1), actor: SYSTEM });
    await align(client, s);
  } else if (action === 'block') {
    await block(client, s, row.auto_renew ? 'insufficient' : 'auto_off', monthlyCharge(nextPlan.monthly_price).total);
  }
}

/** 진입 공통: 잠금 → 만료 정산 → 정렬 */
async function enter(client: PoolClient, companyId: string, today: string): Promise<TermState | null> {
  const s = await lockTerm(client, companyId, today);
  if (!s || !s.row.ready) return s;
  await settle(client, s);
  await align(client, s);
  return s;
}

async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 이미 끝난 트랜잭션 */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 만료 정산이 끝나지 않은 활성 기간(만료일 < 오늘)이면 돈이 걸린 판정을 하지 않는다.
 * 정상이면 진입 정산이 이미 결제·잠금으로 넘겼다. 남아 있다 = 정산이 일부러 멈춘 회사(해지·선불 아님·0원 요금제 알림)라
 * 여기서 연장·올림을 하면 지난 날짜 구간을 사거나 거꾸로 된 구간을 만든다.
 */
function assertSettled(s: TermState): void {
  if (isManaged(s) && !isBlocked(s) && s.row.expires_on! < s.today) {
    throw new PlanTermError(409, { code: 'SETTLE_PENDING', error: '이용 기간 만료 정산이 끝나지 않았습니다. 잠시 뒤 다시 시도하거나 담당자에게 문의해 주세요.' });
  }
}

function requireManaged(s: TermState | null): TermState {
  if (!s) throw new PlanTermError(404, { code: 'COMPANY_NOT_FOUND', error: '회사를 찾을 수 없습니다.' });
  if (!s.row.ready) throw migrationPendingError();
  if (!isManaged(s)) throw new PlanTermError(409, { code: 'PLAN_TERM_NOT_MANAGED', error: '선불 이용 기간을 쓰는 회사가 아닙니다.' });
  return s;
}

// ════════════════════════════════════════════════════════════
// 고객 — 견적 · 1개월 연장 · 자동 연장 스위치
// ════════════════════════════════════════════════════════════

export interface PlanTermQuote {
  version: number;
  plan_name: string;
  plan_code: string;
  restoring: boolean;
  expires_before: string | null;
  days_left: number;
  starts_on: string;
  new_expires: string;
  supply: number;
  vat: number;
  total: number;
  balance: number;
  balance_after: number;
  enough: boolean;
  auto_renew: boolean;
  next_plan_free: boolean;
}

async function buildQuote(client: PoolClient, s: TermState): Promise<PlanTermQuote> {
  const restoring = isBlocked(s);
  const plan = await getPlan(client, restoring ? s.row.restore_plan_id : nextPurchasePlanId(s));
  if (!plan) throw new PlanTermError(409, { code: 'PLAN_NOT_FOUND', error: '연장할 요금제를 찾지 못했습니다.' });
  assertSettled(s);
  const startsOn = restoring ? s.today : shiftDayKey(s.row.expires_on!, 1);
  const newExpires = periodEnd(startsOn)!;
  const charge = monthlyCharge(plan.monthly_price);
  return {
    version: s.row.version,
    plan_name: plan.plan_name,
    plan_code: plan.plan_code,
    restoring,
    expires_before: restoring ? null : s.row.expires_on,
    days_left: restoring ? 0 : daysLeft(s.today, s.row.expires_on!),
    starts_on: startsOn,
    new_expires: newExpires,
    supply: charge.supply,
    vat: charge.vat,
    total: charge.total,
    balance: s.row.balance,
    balance_after: Math.round((s.row.balance - charge.total) * 100) / 100,
    enough: s.row.balance >= charge.total,
    auto_renew: s.row.auto_renew,
    next_plan_free: plan.monthly_price <= 0,
  };
}

/** 1개월 연장 견적. 진입 공통(정산·정렬)을 먼저 돌려 지금 상태로 계산한다. */
export async function getPlanTermQuote(companyId: string, today: string = todayKst()): Promise<PlanTermQuote> {
  return withTx(async (client) => buildQuote(client, requireManaged(await enter(client, companyId, today))));
}

export interface ExtendResult { replayed: boolean; restored: boolean; expires_on: string | null; balance_after: number | null; total: number }

/**
 * 1개월 연장(잠김이면 다시 열기). 순서가 계약이다(회의론자 최종 #3):
 * 잠금 → 같은 requestId 행이 있으면 그 행을 그대로 재생(재계산 금지) → 정산·정렬 → 견적 재계산 → 회차·금액 CAS → 차감.
 * CAS가 어긋나면 정산·정렬은 커밋하고 409 + 새 견적을 돌려준다(그 자체로 정당한 처리다).
 */
export async function extendPlanTerm(
  companyId: string, input: { requestId: string; version: number; total: number }, actor: TermActor, today: string = todayKst(),
): Promise<ExtendResult | { conflict: PlanTermError }> {
  return withTx(async (client) => {
    const locked = await lockTerm(client, companyId, today);
    const s0 = requireManaged(locked);
    const prior = await client.query(
      `SELECT event_type, to_char(expires_after, 'YYYY-MM-DD') AS expires_after, balance_after, total_amount
         FROM company_plan_term_events WHERE company_id = $1 AND request_id = $2::uuid`,
      [companyId, input.requestId],
    );
    if (prior.rows.length > 0) {
      const p = prior.rows[0];
      return { replayed: true, restored: p.event_type === 'restore', expires_on: p.expires_after, balance_after: p.balance_after == null ? null : Number(p.balance_after), total: Number(p.total_amount) || 0 };
    }
    await settle(client, s0);
    await align(client, s0);
    const quote = await buildQuote(client, s0);
    if (quote.version !== Number(input.version) || quote.total !== Number(input.total)) {
      return { conflict: new PlanTermError(409, { code: 'QUOTE_CHANGED', error: '그사이 이용 기간이나 금액이 바뀌었습니다. 바뀐 내용으로 다시 확인해 주세요.', quote }) };
    }
    if (quote.next_plan_free) {
      return { conflict: new PlanTermError(409, { code: 'NEXT_PLAN_FREE', error: '미가입으로 바뀌도록 예약되어 있어 연장할 수 없습니다.', quote }) };
    }
    const restoring = quote.restoring;
    const plan = (await getPlan(client, restoring ? s0.row.restore_plan_id : nextPurchasePlanId(s0)))!;
    await purchase(client, s0, {
      kind: restoring ? 'restore' : 'extend', plan, coversFrom: quote.starts_on, actor, requestId: input.requestId,
    });
    if (!restoring) await align(client, s0);
    return { replayed: false, restored: restoring, expires_on: s0.row.expires_on, balance_after: s0.row.balance, total: quote.total };
  });
}

/** 자동 연장 스위치(고객 관리자·슈퍼관리자 대리). 같은 값이면 아무것도 안 한다. */
export async function setPlanTermAutoRenew(
  companyId: string, enabled: boolean, actor: TermActor, today: string = todayKst(),
): Promise<{ auto_renew: boolean; version: number; changed: boolean }> {
  return withTx(async (client) => {
    const s = requireManaged(await enter(client, companyId, today));
    if (s.row.auto_renew === enabled) return { auto_renew: enabled, version: s.row.version, changed: false };
    const v = await writeTerm(client, s, { auto_renew: enabled });
    await insertEvent(client, s, v, { type: enabled ? 'auto_on' : 'auto_off', actor });
    return { auto_renew: enabled, version: v, changed: true };
  });
}

// ════════════════════════════════════════════════════════════
// 요금제 신청 승인 · 결제방식 전환 (호출부 트랜잭션 안)
// ════════════════════════════════════════════════════════════

export type PlanRequestOutcome =
  | { handled: false }
  | { handled: true; outcome: string; message: string; charged: number; scheduledFrom?: string | null };

/**
 * 요금제 신청 승인 판정·실행(설계 §5-2). 호출부(admin.ts 승인)의 트랜잭션 client로 돈다.
 * handled=false면 호출부의 기존 UPDATE·이력 경로를 그대로 탄다(후불·미관리 FREE 신청·DDL 전).
 */
export async function applyPlanRequestWithClient(
  client: PoolClient,
  input: { companyId: string; targetPlanId: string; trialRequest: boolean; actor: TermActor },
  today: string = todayKst(),
): Promise<PlanRequestOutcome> {
  const s = await enter(client, input.companyId, today);
  if (!s || !s.row.ready) return { handled: false };
  const target = await getPlan(client, input.targetPlanId);
  if (!target) return { handled: false };
  const managed = isManaged(s);
  const blocked = isBlocked(s);
  if (managed && !blocked) assertSettled(s);
  // 진입 정렬이 plan_id를 바꿨을 수 있다 — 판정 기준 가격은 지금 plan_id의 정가를 다시 읽는다(잠금 때 읽은 값은 낡았을 수 있다)
  const todayPrice = (await getPlan(client, s.row.plan_id))?.monthly_price ?? 0;
  const upgradeTotal = managed && !blocked
    ? upgradeCharge(s.events, s.today, s.row.expires_on!, { planId: target.id, price: target.monthly_price }).total
    : 0;
  const d = decidePlanRequest({
    ready: true, prepaid: s.row.billing_type === 'prepaid', managed, blocked, trialRequest: input.trialRequest,
    target: { id: target.id, code: target.plan_code, price: target.monthly_price },
    todayPlan: { id: s.row.plan_id, price: todayPrice },
    nextPlanId: s.row.next_plan_id, upgradeTotal,
  });
  switch (d.kind) {
    case 'unhandled':
      return { handled: false };
    case 'reject':
      throw new PlanTermError(d.status, { code: d.code, error: d.error });
    case 'first_charge': {
      await purchase(client, s, { kind: 'first_charge', plan: target, coversFrom: s.today, actor: input.actor });
      return { handled: true, outcome: 'first_charge', charged: monthlyCharge(target.monthly_price).total,
        message: `${target.plan_name} 요금제를 시작했습니다. 1개월 요금 ${won(monthlyCharge(target.monthly_price).total)}(부가세 포함)을 충전 잔액에서 차감했고 ${s.row.expires_on}까지 이용합니다.` };
    }
    case 'restore': {
      await purchase(client, s, { kind: 'restore', plan: target, coversFrom: s.today, actor: input.actor });
      return { handled: true, outcome: 'restore', charged: monthlyCharge(target.monthly_price).total,
        message: `${target.plan_name} 요금제로 다시 열었습니다. 1개월 요금 ${won(monthlyCharge(target.monthly_price).total)}(부가세 포함)을 차감했고 ${s.row.expires_on}까지 이용합니다.` };
    }
    case 'end': {
      await endTerm(client, s, input.actor, '잠긴 상태에서 미가입 신청 승인');
      return { handled: true, outcome: 'end', charged: 0, message: '이용 기간 관리를 끝냈습니다. 미가입 상태를 유지합니다.' };
    }
    case 'upgrade': {
      const charge = upgradeCharge(s.events, s.today, s.row.expires_on!, { planId: target.id, price: target.monthly_price });
      const eventId = randomUUID();
      const fromName = (await getPlan(client, s.row.plan_id))?.plan_name || '';
      const dd = await deduct(client, s, charge.total, eventId,
        `[요금제 이용료] ${fromName}→${target.plan_name} 올림 차액 ${s.today}~${s.row.expires_on} (공급가 ${won(charge.supply)} + 부가세 ${won(charge.vat)})`, input.actor);
      if (!dd.ok) {
        throw new PlanTermError(402, {
          code: 'INSUFFICIENT_BALANCE', error: `잔액이 부족해 승인하지 못했습니다. 필요 ${won(charge.total)} / 현재 ${won(s.row.balance)}`,
          insufficientBalance: true, balance: s.row.balance, requiredAmount: charge.total,
        });
      }
      const planChanged = s.row.plan_id !== target.id;
      const v = await writeTerm(client, s, { plan: { id: target.id, paid: true }, next_plan_id: null });
      await insertEvent(client, s, v, {
        id: eventId, type: 'upgrade', plan: target, coversFrom: s.today, coversTo: s.row.expires_on, charge,
        balanceBefore: dd.before, balanceAfter: dd.after, balanceTxId: dd.txId || null,
        expiresBefore: s.row.expires_on, expiresAfter: s.row.expires_on, actor: input.actor,
      });
      if (planChanged) await changePlan(client, s, target, input.actor, `선불 이용 기간 중 올림(${target.plan_code})`);
      return { handled: true, outcome: 'upgrade', charged: charge.total,
        message: charge.total > 0
          ? `${target.plan_name} 요금제로 바꿨습니다. 남은 기간 차액 ${won(charge.total)}(부가세 포함)을 차감했고 만료일(${s.row.expires_on})은 그대로입니다.`
          : `${target.plan_name} 요금제로 바꿨습니다. 추가 결제는 없고 만료일(${s.row.expires_on})은 그대로입니다.` };
    }
    case 'reserve': {
      const from = shiftDayKey(s.row.expires_on!, 1);
      if (s.row.next_plan_id !== target.id) {
        const v = await writeTerm(client, s, { next_plan_id: target.id });
        await insertEvent(client, s, v, { type: 'reserve', plan: target, actor: input.actor });
      }
      return { handled: true, outcome: 'reserve', charged: 0, scheduledFrom: from,
        message: `지금은 바뀌지 않습니다. ${from}부터 ${target.plan_name} 요금제로 바뀝니다(남은 기간 환불 없음).` };
    }
    case 'reserve_cancel': {
      const v = await writeTerm(client, s, { next_plan_id: null });
      await insertEvent(client, s, v, { type: 'reserve_cancel', plan: target, actor: input.actor });
      return { handled: true, outcome: 'reserve_cancel', charged: 0, message: `예약된 요금제 변경을 취소했습니다. ${target.plan_name} 요금제를 계속 이용합니다.` };
    }
    case 'noop':
      return { handled: true, outcome: 'noop', charged: 0, message: `이미 ${target.plan_name} 요금제를 이용 중입니다.` };
  }
}

/**
 * 결제방식 전환 게이트(switchCompanyBillingType의 회사 행 잠금 안에서 부른다 · 설계 §5-3).
 * 선불→후불만 본다. 관리 중 활성 = 409 / 잠김 = 관리 종료 후 통과 / 미관리라도 이미 낸 기간이 남았으면 409.
 */
export async function guardBillingTypeSwitchWithClient(
  client: PoolClient, companyId: string, from: string, to: string, actor: TermActor, today: string = todayKst(),
): Promise<void> {
  if (!(from === 'prepaid' && to === 'postpaid')) return;
  const s = await enter(client, companyId, today);
  if (!s || !s.row.ready) return;
  if (isManaged(s) && !isBlocked(s)) {
    throw new PlanTermError(409, {
      code: 'PLAN_TERM_ACTIVE',
      error: `선불 이용 기간(${s.row.expires_on}까지)이 진행 중입니다. 단가/요금 탭의 이용 기간에서 [관리 종료]를 먼저 해 주세요.`,
    });
  }
  if (isBlocked(s)) await endTerm(client, s, actor, '후불 전환: 잠긴 이용 기간 관리 종료');
  const paid = await client.query(
    `SELECT to_char(MAX(covers_to), 'YYYY-MM-DD') AS until FROM company_plan_term_events
      WHERE company_id = $1 AND event_type = ANY($2::text[])`,
    [companyId, PURCHASE_EVENT_TYPES as unknown as string[]],
  );
  const until = paid.rows[0]?.until || null;
  if (until && until >= today) {
    throw new PlanTermError(409, {
      code: 'PAID_TERM_REMAINS',
      error: `선불로 이미 낸 이용 기간이 ${until}까지 남아 있습니다. 그 다음 날부터 후불로 바꿀 수 있습니다(후불 정산이 같은 기간 요금제를 다시 청구하지 않게).`,
      until,
    });
  }
}

// ════════════════════════════════════════════════════════════
// 슈퍼관리자
// ════════════════════════════════════════════════════════════

function assertVersion(s: TermState, version: unknown) {
  if (Number(version) !== s.row.version) {
    // 버전을 싣지 않는다 — 이 오류로 트랜잭션이 롤백되어 진입 정산이 올린 회차도 사라진다. 화면은 상자를 다시 읽는다.
    throw new PlanTermError(409, { code: 'VERSION_CHANGED', error: '그사이 이용 기간이 바뀌었습니다. 새로 고친 뒤 다시 시도해 주세요.' });
  }
}

/** 이용 기간 시작(결제 없음). 만료일 = 어제면 다음 정산(10분 안)에 첫 결제가 난다. */
export async function adminStartPlanTerm(
  companyId: string, input: { expiresOn: string; reason: string }, actor: TermActor, today: string = todayKst(),
): Promise<{ expires_on: string; version: number }> {
  return withTx(async (client) => {
    const s = await lockTerm(client, companyId, today);
    if (!s) throw new PlanTermError(404, { code: 'COMPANY_NOT_FOUND', error: '회사를 찾을 수 없습니다.' });
    if (!s.row.ready) throw migrationPendingError();
    if (isManaged(s)) throw new PlanTermError(409, { code: 'ALREADY_MANAGED', error: '이미 이용 기간을 관리 중입니다.' });
    const plan = await getPlan(client, s.row.plan_id);
    if (s.row.billing_type !== 'prepaid') throw new PlanTermError(409, { code: 'NOT_PREPAID', error: '선불 회사만 이용 기간을 시작할 수 있습니다.' });
    if (!plan || plan.monthly_price <= 0 || plan.plan_code === 'TRIAL') {
      throw new PlanTermError(409, { code: 'NOT_PAID_PLAN', error: '유료 요금제(무료체험 제외)를 쓰는 회사만 시작할 수 있습니다.' });
    }
    const sub = await client.query(`SELECT subscription_status FROM companies WHERE id = $1`, [companyId]);
    if (sub.rows[0]?.subscription_status === 'trial') {
      throw new PlanTermError(409, { code: 'TRIAL_ACTIVE', error: '무료체험 중인 회사는 시작할 수 없습니다.' });
    }
    const yesterday = shiftDayKey(today, -1);
    if (!isYmd(input.expiresOn) || input.expiresOn < yesterday) {
      throw new PlanTermError(400, { code: 'BAD_EXPIRES', error: `만료일은 ${yesterday} 이후 날짜여야 합니다.` });
    }
    const v = await writeTerm(client, s, { expires_on: input.expiresOn, auto_renew: true, restore_plan_id: null, next_plan_id: null });
    await insertEvent(client, s, v, {
      type: 'start', plan,
      coversFrom: input.expiresOn >= today ? today : null, coversTo: input.expiresOn >= today ? input.expiresOn : null,
      expiresBefore: null, expiresAfter: input.expiresOn, actor, reason: input.reason,
    });
    return { expires_on: input.expiresOn, version: v };
  });
}

/** 만료일 조정(돈 이동 없음). 잠김이면 409. 이미 결제한 구간보다 앞당길 수 없다(회의론자 최종 #4). */
export async function adminAdjustPlanTermExpires(
  companyId: string, input: { expiresOn: string; reason: string; version: number }, actor: TermActor, today: string = todayKst(),
): Promise<{ expires_on: string; version: number }> {
  return withTx(async (client) => {
    const s = requireManaged(await enter(client, companyId, today));
    if (isBlocked(s)) throw new PlanTermError(409, { code: 'PLAN_TERM_BLOCKED', error: '잠긴 이용 기간은 조정할 수 없습니다. 고객이 1개월 연장으로 다시 열거나 [관리 종료] 해 주세요.' });
    assertVersion(s, input.version);
    const yesterday = shiftDayKey(today, -1);
    if (!isYmd(input.expiresOn) || input.expiresOn < yesterday) {
      throw new PlanTermError(400, { code: 'BAD_EXPIRES', error: `만료일은 ${yesterday} 이후 날짜여야 합니다.` });
    }
    const paidUntil = s.events
      .filter((e) => (PURCHASE_EVENT_TYPES as readonly string[]).includes(e.event_type) && e.covers_to)
      .reduce<string | null>((m, e) => (!m || e.covers_to! > m ? e.covers_to! : m), null);
    if (paidUntil && input.expiresOn < paidUntil) {
      throw new PlanTermError(409, { code: 'PAID_THROUGH', error: `이미 결제한 기간(${paidUntil}까지)보다 앞당길 수 없습니다.`, paid_through: paidUntil });
    }
    const old = s.row.expires_on!;
    if (input.expiresOn === old) return { expires_on: old, version: s.row.version };
    let coverPlan: PlanRow | null = null;
    if (input.expiresOn > old) coverPlan = await getPlan(client, planOfDay(s.events, old)?.planId ?? s.row.plan_id);
    const v = await writeTerm(client, s, { expires_on: input.expiresOn });
    await insertEvent(client, s, v, {
      type: 'admin_adjust', plan: coverPlan,
      coversFrom: coverPlan ? shiftDayKey(old, 1) : null, coversTo: coverPlan ? input.expiresOn : null,
      expiresBefore: old, expiresAfter: input.expiresOn, actor, reason: input.reason,
    });
    return { expires_on: input.expiresOn, version: v };
  });
}

/** 관리 종료(요금제 그대로 · 환불 없음) */
export async function adminEndPlanTerm(
  companyId: string, input: { reason: string; version: number }, actor: TermActor, today: string = todayKst(),
): Promise<{ ended: true }> {
  return withTx(async (client) => {
    const s = requireManaged(await enter(client, companyId, today));
    assertVersion(s, input.version);
    await endTerm(client, s, actor, input.reason);
    return { ended: true };
  });
}

// ════════════════════════════════════════════════════════════
// 조회(잠금 없음)
// ════════════════════════════════════════════════════════════

const EVENT_LABEL: Record<string, string> = {
  start: '이용 기간 시작',
  first_charge: '요금제 시작 결제',
  renew: '자동 연장 결제',
  extend: '1개월 연장 결제',
  restore: '다시 열기 결제',
  upgrade: '요금제 올림',
  reserve: '요금제 변경 예약',
  reserve_cancel: '변경 예약 취소',
  align: '요금제 변경',
  block: '요금제 잠김',
  expire_free: '이용 기간 종료(미가입)',
  auto_on: '자동 연장 켬',
  auto_off: '자동 연장 끔',
  admin_adjust: '만료일 조정',
  end: '이용 기간 관리 종료',
};

export interface PlanTermView {
  state: 'active' | 'blocked';
  plan_name: string;
  plan_code: string;
  expires_on: string;
  days_left: number;
  auto_renew: boolean;
  next_charge_date: string | null;
  next_charge_plan_name: string;
  price_supply: number;
  price_vat: number;
  price_total: number;
  next_plan_name: string | null;
  next_plan_from: string | null;
  block_reason: string | null;
  block_snapshot: { balance: number; required: number } | null;
  blocked_on: string | null;
  version: number;
  can_manage: boolean;
}

async function readState(companyId: string, today: string): Promise<TermState | null> {
  const r = await query(ROW_SELECT, [companyId]);
  if (r.rows.length === 0) return null;
  const row = toRow(r.rows[0]);
  // my-plan마다 부르는 경로 — 미관리 회사(대부분)는 원장을 읽지 않는다
  if (!row.ready || !row.expires_on) return { row, events: [], today };
  return { row, events: await loadEvents(pool, companyId), today };
}

function kstDay(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function buildView(s: TermState, canManage: boolean): Promise<PlanTermView | null> {
  if (!isManaged(s)) return null;
  const blocked = isBlocked(s);
  const shownPlan = await getPlan(pool as any, blocked ? s.row.restore_plan_id : s.row.plan_id);
  const buyPlan = await getPlan(pool as any, blocked ? s.row.restore_plan_id : nextPurchasePlanId(s));
  const charge = monthlyCharge(buyPlan?.monthly_price ?? 0);
  // 다음에 바뀌는 요금제: 미리 산 구간 중 오늘 요금제와 다른 첫 날 → 없으면 내림 예약(만료 다음 날부터)
  let nextPlanId: string | null = null;
  let nextFrom: string | null = null;
  if (!blocked) {
    const todayPlan = planOfDay(s.events, s.today)?.planId ?? s.row.plan_id;
    for (let d = shiftDayKey(s.today, 1); d <= s.row.expires_on!; d = shiftDayKey(d, 1)) {
      const p = planOfDay(s.events, d);
      if (p?.planId && p.planId !== todayPlan) { nextPlanId = p.planId; nextFrom = d; break; }
    }
    if (!nextPlanId && s.row.next_plan_id && s.row.next_plan_id !== (planOfDay(s.events, s.row.expires_on!)?.planId ?? s.row.plan_id)) {
      nextPlanId = s.row.next_plan_id;
      nextFrom = shiftDayKey(s.row.expires_on!, 1);
    }
  }
  const nextPlan = nextPlanId ? await getPlan(pool as any, nextPlanId) : null;
  const lastBlock = blocked ? [...s.events].reverse().find((e) => e.event_type === 'block') : undefined;
  const detail = lastBlock?.detail || null;
  return {
    state: blocked ? 'blocked' : 'active',
    plan_name: shownPlan?.plan_name || '',
    plan_code: shownPlan?.plan_code || '',
    expires_on: s.row.expires_on!,
    days_left: blocked ? 0 : daysLeft(s.today, s.row.expires_on!),
    auto_renew: s.row.auto_renew,
    next_charge_date: !blocked && s.row.auto_renew && !(buyPlan && buyPlan.monthly_price <= 0) ? shiftDayKey(s.row.expires_on!, 1) : null,
    next_charge_plan_name: buyPlan?.plan_name || '',
    price_supply: charge.supply,
    price_vat: charge.vat,
    price_total: charge.total,
    next_plan_name: nextPlan?.plan_name || null,
    next_plan_from: nextFrom,
    block_reason: detail?.reason ?? null,
    block_snapshot: detail ? { balance: Number(detail.balance) || 0, required: Number(detail.required) || 0 } : null,
    blocked_on: lastBlock ? kstDay(lastBlock.created_at) : null,
    version: s.row.version,
    can_manage: canManage,
  };
}

/** my-plan용. 미관리·DDL 전 = null */
export async function getPlanTermView(companyId: string, canManage: boolean, today: string = todayKst()): Promise<PlanTermView | null> {
  const s = await readState(companyId, today);
  return s ? buildView(s, canManage) : null;
}

export interface PlanTermEventRow {
  id: string;
  at: string;
  event_type: string;
  label: string;
  plan_name: string | null;
  amount_total: number;
  expires_before: string | null;
  expires_after: string | null;
  actor_label: string;
  reason: string | null;
  detail: any;
}

/** 이력. audience='customer'면 슈퍼관리자 실명 대신 '한줄로 담당자', 사유는 싣지 않는다. */
export async function listPlanTermEvents(
  companyId: string, opts: { offset?: number; limit?: number; audience: 'customer' | 'admin' },
): Promise<{ rows: PlanTermEventRow[]; total: number } | null> {
  const ready = await query(`SELECT to_regclass('public.company_plan_term_events') IS NOT NULL AS ok`);
  if (!ready.rows[0]?.ok) return null;
  const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 50);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const cnt = await query(`SELECT COUNT(*)::int AS n FROM company_plan_term_events WHERE company_id = $1`, [companyId]);
  const r = await query(
    `SELECT e.id, e.created_at, e.event_type, e.total_amount, e.actor_type, e.actor_label, e.reason, e.detail,
            to_char(e.expires_before, 'YYYY-MM-DD') AS expires_before, to_char(e.expires_after, 'YYYY-MM-DD') AS expires_after,
            p.plan_name
       FROM company_plan_term_events e LEFT JOIN plans p ON p.id = e.plan_id
      WHERE e.company_id = $1
      ORDER BY e.term_version DESC
      LIMIT $2 OFFSET $3`,
    [companyId, limit, offset],
  );
  const rows = r.rows.map((e: any): PlanTermEventRow => {
    const actor = e.actor_type === 'system' ? '자동'
      : e.actor_type === 'super_admin' ? (opts.audience === 'admin' ? `슈퍼관리자 ${e.actor_label || ''}`.trim() : '한줄로 담당자')
      : (e.actor_label || '회사 관리자');
    return {
      id: String(e.id),
      at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
      event_type: e.event_type,
      label: EVENT_LABEL[e.event_type] || e.event_type,
      plan_name: e.plan_name || null,
      amount_total: Number(e.total_amount) || 0,
      expires_before: e.expires_before,
      expires_after: e.expires_after,
      actor_label: actor,
      reason: opts.audience === 'admin' ? (e.reason || null) : null,
      detail: e.event_type === 'block' ? e.detail : null,
    };
  });
  return { rows, total: Number(cnt.rows[0]?.n) || 0 };
}

/** 슈퍼관리자 상자: 상태 + 시작 가능 여부 */
export async function getAdminPlanTermState(companyId: string, today: string = todayKst()): Promise<{
  ready: boolean; managed: boolean; view: PlanTermView | null;
  startable: boolean; start_block_reason: string | null; default_expires_on: string; plan_name: string | null; billing_type: string;
} | null> {
  const s = await readState(companyId, today);
  if (!s) return null;
  const plan = await getPlan(pool as any, s.row.plan_id);
  const sub = await query(`SELECT subscription_status FROM companies WHERE id = $1`, [companyId]);
  let reason: string | null = null;
  if (!s.row.ready) reason = 'DB 마이그레이션 전입니다.';
  else if (isManaged(s)) reason = null;
  else if (s.row.billing_type !== 'prepaid') reason = '후불 회사입니다(요금제는 정산서로 청구).';
  else if (!plan || plan.monthly_price <= 0 || plan.plan_code === 'TRIAL') reason = '유료 요금제를 쓰는 회사가 아닙니다.';
  else if (sub.rows[0]?.subscription_status === 'trial') reason = '무료체험 중입니다.';
  return {
    ready: s.row.ready,
    managed: isManaged(s),
    view: await buildView(s, true),
    startable: s.row.ready && !isManaged(s) && reason === null,
    start_block_reason: reason,
    default_expires_on: periodEnd(today) || today,
    plan_name: plan?.plan_name || null,
    billing_type: s.row.billing_type,
  };
}

/** plan-request/status 용: 승인된 신청이 내림 예약이면 적용일. 미관리·DDL 전 = null */
export async function getScheduledFromForPlan(companyId: string, planId: string | null, today: string = todayKst()): Promise<string | null> {
  if (!planId) return null;
  const s = await readState(companyId, today);
  if (!s || !isManaged(s) || isBlocked(s) || s.row.next_plan_id !== planId) return null;
  return shiftDayKey(s.row.expires_on!, 1);
}

// ════════════════════════════════════════════════════════════
// 워커 — 기동 즉시 + 10분(무료 메시징 지급과 같은 주기 · app.ts)
// ════════════════════════════════════════════════════════════

let _warnedNotReady = false;
let _running = false;
let _timer: NodeJS.Timeout | null = null;

function isSchemaMissing(err: any): boolean {
  const code = String(err?.code || '');
  return code === '42P01' || code === '42703';
}

/** 한 패스: 정산·정렬이 필요할 수 있는 관리 회사만 골라 회사별 트랜잭션으로 처리(재판정은 잠금 안에서). */
export async function runPlanTermPass(today: string = todayKst()): Promise<{ processed: number }> {
  if (_running) return { processed: 0 };
  _running = true;
  try {
    let candidates: string[] = [];
    try {
      const r = await query(
        `SELECT c.id FROM companies c
          WHERE (to_jsonb(c) ->> 'plan_term_expires_on') IS NOT NULL
            AND (to_jsonb(c) ->> 'plan_term_restore_plan_id') IS NULL
            AND ( (to_jsonb(c) ->> 'plan_term_expires_on')::date < $1::date
                  OR EXISTS (SELECT 1 FROM company_plan_term_events e
                              WHERE e.company_id = c.id AND e.covers_from <= $1::date AND e.covers_to >= $1::date
                                AND e.plan_id IS DISTINCT FROM c.plan_id) )`,
        [today],
      );
      candidates = r.rows.map((x: any) => String(x.id));
    } catch (err: any) {
      if (isSchemaMissing(err)) {
        if (!_warnedNotReady) { console.warn('[plan-term] DDL 전: 워커 건너뜀:', err?.message); _warnedNotReady = true; }
        return { processed: 0 };
      }
      throw err;
    }
    let processed = 0;
    for (const id of candidates) {
      try {
        await withTx(async (client) => { await enter(client, id, today); });
        processed++;
      } catch (err: any) {
        await alertOnce(`worker-fail:${id}`, `회사 ${id.slice(0, 8)} 정산 실패: ${err?.message || err}`);
      }
    }
    if (processed > 0) console.log(`[plan-term] 정산·정렬 ${processed}곳`);
    return { processed };
  } finally {
    _running = false;
  }
}

export function startPlanTermWorker(): void {
  if (_timer) return;
  const tick = () => { runPlanTermPass().catch((e) => console.error('[plan-term] 패스 실패', e?.message || e)); };
  tick();
  _timer = setInterval(tick, 10 * 60 * 1000);
  console.log('[plan-term] 워커 시작(기동 즉시 + 10분)');
}

export function stopPlanTermWorker(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
