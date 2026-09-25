/**
 * spell-check-quota.ts — 직접발송 맞춤법 검사 사용 한도 (2026-09-25 Harold 지시)
 * 설계 SoT = docs/2026-09-25-direct-send-precheck-design.md §4
 *
 * 규칙
 *   - 요금제 사용 회사(`isActivePaidPlan`) = 무제한 · 크레딧 0.
 *   - 미가입 회사 = **회사 단위 한 달 5회**(KST 달력 월). 다음 달 1일에 다시 5회.
 *   - 모든 회사 = 사용자당 1분 6회(남용 방지 · 프로세스 메모리).
 *
 * 원장 = `spell_check_uses`(DDL 대기 · SCHEMA.md 등재). 한 번 검사 = 한 행.
 *   ① 검사 **전에** 행을 'reserved'로 넣는다(회사 advisory 잠금 안에서 세고 넣어 동시 요청이 한도를 넘지 못한다)
 *   ② 끝나면 'done'(찾은 수 기록) · AI 실패면 'failed'(한도에서 빠진다 = 고객 탓이 아닌 실패는 세지 않는다)
 *   ③ 'reserved'로 남은 행(검사 중 서버 재시작)은 센다 — 한도를 넘기는 쪽으로 새지 않게.
 * ⛔ 표가 없으면(배포 뒤 DDL 전): 요금제 회사는 기록 없이 검사한다 · 미가입 회사는 한도를 셀 수 없어 막는다(fail-closed).
 */
import pool, { query } from '../config/database';
import { isMissingSchemaError } from './db-errors';
import { DIRECT_SPELL_AI_SOURCE } from './ai-rate-limit';

/** 미가입 회사의 한 달 무료 횟수 */
export const SPELL_FREE_MONTHLY_LIMIT = 5;
/** 사용자당 1분 최대 횟수(전 요금제) */
export const SPELL_PER_MINUTE_LIMIT = 6;
/** 직접발송 검사의 원장 source(= AI 호출 source · 이름 소유 = CT-55 · 월 AI 호출 한도 면제 목록에 있다) */
export const DIRECT_SPELL_SOURCE = DIRECT_SPELL_AI_SOURCE;

const minuteWindow = new Map<string, number[]>();

/** 1분 창 — 남으면 한 칸을 쓰고 true. 순수 메모리(프로세스 하나 · 재시작하면 비워진다). */
export function takeSpellMinuteSlot(key: string, now = Date.now()): boolean {
  const hits = (minuteWindow.get(key) || []).filter((t) => now - t < 60_000);
  if (hits.length >= SPELL_PER_MINUTE_LIMIT) {
    minuteWindow.set(key, hits);
    return false;
  }
  hits.push(now);
  minuteWindow.set(key, hits);
  return true;
}

/** 테스트용 — 1분 창 비우기 */
export function resetSpellMinuteWindow(): void {
  minuteWindow.clear();
}

/** 원장의 달(KST 'YYYY-MM') — 계산을 SQL 한 곳에 둔다(서버 시계·시간대가 갈리지 않게). */
const PERIOD_SQL = `to_char(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`;

/**
 * 예약 수명(한 벌) — **세는 자리(예약)와 완료하는 자리(done)가 같은 판정을 같은 회사 잠금 안에서** 쓴다.
 *   세는 행 = done + 살아 있는 reserved · done 은 살아 있는 reserved 에서만 된다 → 한도를 넘는 done 이 생기지 않는다.
 * ★Codex 4R: 예약 뒤 서버가 죽거나 마무리 UPDATE가 실패하면 reserved 가 남아 달 끝까지 한 번을 먹었다 → 수명.
 * ★Codex 5R: 수명이 지난 예약이 늦게 done 이 되면, 그 사이 자리를 가져간 새 예약과 합쳐 한도를 넘었다 → 완료도 수명 안에서만.
 * 70분 = AI 두 곳 × SDK 기본 시간 제한 10분 × 3번 시도(timeout 600000 · maxRetries 2 — node_modules 실측) = 60분 + 여유.
 * `clock_timestamp()` = 문장 시각. `NOW()`는 트랜잭션 시작 시각이라 잠금을 기다린 만큼 과거여서 쓰지 않는다.
 * failed 는 세지 않는다.
 */
const SPELL_LEASE_ALIVE_SQL = `created_at > clock_timestamp() - INTERVAL '70 minutes'`;
const SPELL_COUNTED_SQL = `(status = 'done' OR (status = 'reserved' AND ${SPELL_LEASE_ALIVE_SQL}))`;
/** 회사 한도 잠금(예약·완료 공용) */
const SPELL_LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext('spell-quota'), hashtext($1::text))`;

export interface SpellUsage {
  /** 원장 표가 있는가 */
  ready: boolean;
  usedThisMonth: number;
  issuesThisMonth: number;
}

/** 이번 달 사용·찾은 수(화면 표시 · 안내 창 요약). 표가 없으면 ready=false. */
export async function readSpellUsage(companyId: string): Promise<SpellUsage> {
  try {
    const r = await query(
      `SELECT COUNT(*)::int AS used, COALESCE(SUM(issue_count), 0)::int AS issues
         FROM spell_check_uses
        WHERE company_id = $1::uuid AND source = $2 AND period_month = ${PERIOD_SQL} AND ${SPELL_COUNTED_SQL}`,
      [companyId, DIRECT_SPELL_SOURCE],
    );
    return { ready: true, usedThisMonth: Number(r.rows[0]?.used || 0), issuesThisMonth: Number(r.rows[0]?.issues || 0) };
  } catch (err: any) {
    if (isMissingSchemaError(err)) return { ready: false, usedThisMonth: 0, issuesThisMonth: 0 };
    throw err;
  }
}

export type SpellReserveResult =
  | { ok: true; useId: number | null }
  | { ok: false; code: 'SPELL_FREE_EXHAUSTED'; used: number; limit: number }
  | { ok: false; code: 'DB_MIGRATION_PENDING' };

/**
 * 검사 한 번 예약. `monthlyLimit` = null이면 무제한(기록만 한다).
 * 회사 advisory 잠금 안에서 세고 넣는다 — 같은 회사의 동시 요청이 5를 넘기지 못한다.
 */
export async function reserveSpellUse(input: {
  companyId: string;
  userId: string | null;
  monthlyLimit: number | null;
}): Promise<SpellReserveResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SPELL_LOCK_SQL, [input.companyId]);
    const c = await client.query(
      `SELECT COUNT(*)::int AS used FROM spell_check_uses
        WHERE company_id = $1::uuid AND source = $2 AND period_month = ${PERIOD_SQL} AND ${SPELL_COUNTED_SQL}`,
      [input.companyId, DIRECT_SPELL_SOURCE],
    );
    const used = Number(c.rows[0]?.used || 0);
    if (input.monthlyLimit != null && used >= input.monthlyLimit) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'SPELL_FREE_EXHAUSTED', used, limit: input.monthlyLimit };
    }
    const ins = await client.query(
      `INSERT INTO spell_check_uses (company_id, user_id, source, period_month, status)
       VALUES ($1::uuid, $2::uuid, $3, ${PERIOD_SQL}, 'reserved')
       RETURNING id`,
      [input.companyId, input.userId, DIRECT_SPELL_SOURCE],
    );
    await client.query('COMMIT');
    return { ok: true, useId: Number(ins.rows[0].id) };
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (isMissingSchemaError(err)) {
      // 표가 없다: 무제한 회사는 기록 없이 진행, 한도 회사는 셀 수 없으니 막는다.
      return input.monthlyLimit == null ? { ok: true, useId: null } : { ok: false, code: 'DB_MIGRATION_PENDING' };
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 예약 행 마무리. failed = 세지 않는다. done = **예약이 살아 있을 때만**(회사 잠금 안 · 세는 자리와 같은 판정).
 * 수명이 지났으면 failed 로 닫는다(그 자리는 이미 다른 예약이 가져갔을 수 있다).
 * @returns done 으로 기록했으면 true. useId 없음(표 없는 무제한 회사) = true. 그 밖(실패·수명 지남·기록 오류) = false
 *   → 무료 회사는 결과를 내주지 않는다(횟수에서도 빠진다 · 기록 오류로 남은 reserved 는 수명이 지나면 세지 않는다).
 */
export async function finishSpellUse(
  useId: number | null,
  companyId: string,
  outcome: { failed: boolean; issueCount: number },
): Promise<boolean> {
  if (useId == null) return true;
  if (outcome.failed) {
    try {
      await query(`UPDATE spell_check_uses SET status = 'failed', issue_count = 0 WHERE id = $1 AND status = 'reserved'`, [useId]);
    } catch (err: any) {
      console.warn('[spell-quota] 실패 기록 마무리 실패(수명이 지나면 세지 않는다):', err?.message);
    }
    return false;
  }
  let client: any = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(SPELL_LOCK_SQL, [companyId]);
    const u = await client.query(
      `UPDATE spell_check_uses SET status = 'done', issue_count = $2
        WHERE id = $1 AND status = 'reserved' AND ${SPELL_LEASE_ALIVE_SQL}`,
      [useId, Math.max(0, Math.floor(outcome.issueCount))],
    );
    const done = (u.rowCount ?? 0) > 0;
    if (!done) {
      await client.query(`UPDATE spell_check_uses SET status = 'failed', issue_count = 0 WHERE id = $1 AND status = 'reserved'`, [useId]);
    }
    await client.query('COMMIT');
    return done;
  } catch (err: any) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    console.warn('[spell-quota] 사용 기록 마무리 실패(수명이 지나면 세지 않는다):', err?.message);
    return false;
  } finally {
    client?.release();
  }
}
