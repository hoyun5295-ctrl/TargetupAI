/**
 * utils/billing-type-history.ts — 회사 결제 방식(선불·후불) 전환 이력 CT
 *
 * ★ 2026-09-27 한줄로 V2 F34 — 정산 발행이 「발행 시점」 결제 방식 하나로 판정해,
 *   전환 뒤 지난 기간을 발행하면 선불 기간이 후불로 청구되거나(이중 청구 · 발송 때 잔액에서 이미 차감됨)
 *   후불 기간이 선불이라 막혀 영구 미청구가 됐다.
 *   → 전환을 이력으로 남기고(전환과 같은 트랜잭션 · 이력 없는 전환은 판정을 틀리게 하므로 둘 다 되거나 둘 다 안 된다),
 *     발행·미리보기·정액·일괄 목록이 「그 기간에 적용된 결제 방식」으로 판정한다.
 *
 * 이력 = audit_logs(action 'billing_type_change' · target_type 'company' · target_id 회사 · details {from, to}).
 *   새 테이블 없이 기존 감사 로그 컬럼만 쓴다(recordAuditLog와 같은 컬럼 · 운영에서 쓰는 INSERT와 같다).
 * 날짜 = 한국 날짜(정산 기간 billing_start·billing_end가 한국 날짜 문자열이다).
 *
 * 판정 규칙(resolvePeriodBillingType)
 *   · 기간 안(첫날·끝날 포함)에 전환이 있으면 섞임 → 발행하지 않는다(전환일을 뺀 앞·뒤로 나눠 발행).
 *     전환일 하루는 선불·후불 발송이 섞여 어느 쪽으로 청구해도 틀린다 → 발행하지 않는다(이중 청구 방지 쪽 · Harold 확인 필요).
 *   · 기간 뒤 첫 전환이 있으면 그 직전 값(from)이 그 기간의 값이다.
 *   · 기간 뒤 전환이 없으면 지금 값이다(이력이 없던 때의 전환은 알 수 없다 · 지금까지와 같은 판정).
 */
import type { PoolClient } from 'pg';
import { pool } from '../config/database';
import { guardBillingTypeSwitchWithClient } from './plan-term';

export const BILLING_TYPE_CHANGE_ACTION = 'billing_type_change';
export type CompanyBillingType = 'prepaid' | 'postpaid';

const isBillingType = (v: unknown): v is CompanyBillingType => v === 'prepaid' || v === 'postpaid';

/** 한국 날짜 — 전환 이력을 정산 기간(한국 날짜)과 같은 축으로 비교한다. 읽기·목록 SQL이 같은 식을 쓴다. */
const kstDaySql = (col: string) => `(${col} AT TIME ZONE 'Asia/Seoul')::date`;

export interface BillingTypeSwitch {
  /** 전환한 한국 날짜 YYYY-MM-DD */
  day: string;
  at: string;
  from: string;
  to: string;
}

export type PeriodBillingType =
  | { kind: 'single'; type: CompanyBillingType }
  | { kind: 'mixed'; switches: BillingTypeSwitch[] }
  | { kind: 'unknown'; reason: string };

/**
 * 엄격한 한국 날짜 문자열(YYYY-MM-DD · 실제 날짜). 판정은 문자열 비교라, 공백·한 자리 월 같은 비정규 입력은
 * 비교가 어긋나는데 사용량 SQL(::date)은 같은 날로 읽는다(Codex BT 1R) → 판정하지 않는다(발행 차단 쪽).
 */
function isStrictYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** (순수) switches = 시간순. start·end = 한국 날짜 YYYY-MM-DD(엄격 · 아니면 알 수 없음). */
export function resolvePeriodBillingType(
  switches: BillingTypeSwitch[],
  start: string,
  end: string,
  currentType: string,
): PeriodBillingType {
  if (!isStrictYmd(start) || !isStrictYmd(end) || start > end) {
    return { kind: 'unknown', reason: `기간 형식 이상(${String(start)}~${String(end)})` };
  }
  const inPeriod = switches.filter((s) => s.day >= start && s.day <= end);
  if (inPeriod.length > 0) return { kind: 'mixed', switches: inPeriod };
  const next = switches.find((s) => s.day > end);
  const type = next ? next.from : currentType;
  if (!isBillingType(type)) {
    return { kind: 'unknown', reason: next ? `전환 이력 값 이상(${String(next.from)})` : `현재 결제 방식 값 이상(${String(currentType)})` };
  }
  return { kind: 'single', type };
}

type Db = Pick<PoolClient, 'query'>;

/** 그 기간에 적용된 결제 방식. 잠금 아래에서 다시 볼 때는 같은 트랜잭션의 client를 넘긴다. */
export async function readPeriodBillingType(
  companyId: string,
  start: string,
  end: string,
  db: Db = pool,
): Promise<PeriodBillingType> {
  const co = await db.query(`SELECT billing_type FROM companies WHERE id = $1`, [companyId]);
  if (co.rows.length === 0) return { kind: 'unknown', reason: '회사 없음' };
  const hist = await db.query(
    `SELECT to_char(${kstDaySql('created_at')}, 'YYYY-MM-DD') AS day, created_at AS at,
            details->>'from' AS from_type, details->>'to' AS to_type
       FROM audit_logs
      WHERE target_id = $1 AND action = $2 AND target_type = 'company'
      ORDER BY created_at ASC`,
    [companyId, BILLING_TYPE_CHANGE_ACTION],
  );
  const switches: BillingTypeSwitch[] = hist.rows.map((r: any) => ({
    day: String(r.day), at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    from: String(r.from_type ?? ''), to: String(r.to_type ?? ''),
  }));
  return resolvePeriodBillingType(switches, start, end, String(co.rows[0].billing_type ?? ''));
}

/**
 * 발행을 막는 사유(섞임·알 수 없음·선불) — 미리보기와 발행이 같은 문구를 쓴다. 후불 하나면 null.
 * 선불 문구는 경로마다 다르므로(일반 발행·정액) 호출부가 자기 문구를 쓸 수 있게 code만 같게 둔다.
 */
export function describePeriodBillingTypeBlock(p: PeriodBillingType): { code: string; message: string } | null {
  if (p.kind === 'single') {
    return p.type === 'postpaid'
      ? null
      : { code: 'PREPAID_COMPANY_NOT_BILLABLE', message: '이 기간은 선불: 발송 시점에 잔액에서 이미 차감되어 월 정산서 발행 시 이중 청구' };
  }
  if (p.kind === 'mixed') {
    const list = p.switches.map((s) => `${s.day} ${s.from === 'prepaid' ? '선불' : '후불'}→${s.to === 'prepaid' ? '선불' : '후불'}`).join(', ');
    return {
      code: 'BILLING_TYPE_CHANGED_IN_PERIOD',
      message: `이 기간 중 결제 방식이 바뀌었습니다(${list}). 바뀐 날을 뺀 앞·뒤 기간으로 나눠 발행해 주세요. 바뀐 날 하루는 선불·후불 발송이 섞여 있어 발행하지 않습니다.`,
    };
  }
  return { code: 'BILLING_TYPE_HISTORY_UNREADABLE', message: `이 기간의 결제 방식을 확인하지 못해 발행을 중단했습니다(${p.reason}).` };
}

/**
 * 일괄 목록용 — 전환 이력을 한 번만 읽는 CTE 본문(목록 SQL 앞에 `WITH ${BILLING_TYPE_SWITCHES_CTE}`).
 * 회사마다 audit_logs를 다시 훑지 않게 한다.
 */
export const BILLING_TYPE_SWITCHES_CTE = `billing_type_switches AS (
  SELECT target_id AS company_id, created_at, details->>'from' AS from_type, ${kstDaySql('created_at')} AS day
    FROM audit_logs
   WHERE action = '${BILLING_TYPE_CHANGE_ACTION}' AND target_type = 'company'
)`;

/**
 * 일괄 목록 조건 — 그 기간에 후불이었거나(기간 뒤 첫 전환의 직전 값, 없으면 지금 값) 기간 안에 전환한 회사.
 * 기간 안 전환 회사는 목록에 남긴다(사람이 보고 나눠 발행 · 발행 코어가 섞임으로 막는다). resolvePeriodBillingType과 같은 규칙.
 */
export function periodPostpaidOrSwitchedSql(alias: string, startParam: string, endParam: string): string {
  return `(COALESCE(
        (SELECT s.from_type FROM billing_type_switches s WHERE s.company_id = ${alias}.id AND s.day > ${endParam}::date ORDER BY s.created_at ASC LIMIT 1),
        ${alias}.billing_type) = 'postpaid'
      OR EXISTS (SELECT 1 FROM billing_type_switches s2 WHERE s2.company_id = ${alias}.id AND s2.day BETWEEN ${startParam}::date AND ${endParam}::date))`;
}

/**
 * 결제 방식 전환 — 회사 행 잠금 → 갱신 → 이력 기록을 한 트랜잭션으로.
 * 회사 행 잠금은 정산 발행 잠금(lockCompanyForBilling)과 같은 행이라, 발행 중에는 전환이 끼어들지 못한다.
 * 같은 값이면 전환이 아니다(이력 없음 · 값도 그대로).
 */
export async function switchCompanyBillingType(input: {
  companyId: string;
  to: CompanyBillingType;
  actorUserId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<
  | { found: false }
  | { found: true; changed: boolean; from: string; company: { id: string; company_name: string; billing_type: string; balance: any } }
> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT billing_type FROM companies WHERE id = $1 FOR UPDATE`, [input.companyId]);
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return { found: false };
    }
    const from = String(cur.rows[0].billing_type ?? '');
    // ★ 2026-10-04 선불 이용 기간 게이트(설계 §5-3) — 선불→후불: 진행 중이면 409 · 잠김이면 관리 종료 후 통과 ·
    //   이미 낸 기간이 남았으면 409(후불 정산이 같은 기간 요금제를 다시 청구하지 않게). 같은 행 잠금 안에서 판정한다.
    if (from !== input.to) {
      await guardBillingTypeSwitchWithClient(client, input.companyId, from, input.to, {
        type: 'super_admin', id: input.actorUserId, label: null, ip: input.ip ?? null, userAgent: input.userAgent ?? null,
      });
    }
    if (from === input.to) {
      const same = await client.query(`SELECT id, company_name, billing_type, balance FROM companies WHERE id = $1`, [input.companyId]);
      await client.query('COMMIT');
      return { found: true, changed: false, from, company: same.rows[0] };
    }
    const upd = await client.query(
      `UPDATE companies SET billing_type = $1, updated_at = NOW() WHERE id = $2 RETURNING id, company_name, billing_type, balance`,
      [input.to, input.companyId],
    );
    await client.query(
      // ★ Codex BT 1R — 시각은 잠금을 얻은 뒤의 실제 시각(clock_timestamp). 기본값(트랜잭션 시작 시각)이면
      //   먼저 BEGIN하고 늦게 잠근 전환이 앞선 것으로 정렬돼 「기간 뒤 첫 전환」이 뒤집히고, 자정을 넘긴 대기는 전날로 찍힌다.
      `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
       VALUES ($1, $2, 'company', $3, $4, $5, $6, clock_timestamp())`,
      [input.actorUserId || null, BILLING_TYPE_CHANGE_ACTION, input.companyId,
        JSON.stringify({ from, to: input.to }), input.ip || null, input.userAgent || ''],
    );
    await client.query('COMMIT');
    return { found: true, changed: true, from, company: upd.rows[0] };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 이미 끝난 트랜잭션 */ }
    throw err;
  } finally {
    client.release();
  }
}
