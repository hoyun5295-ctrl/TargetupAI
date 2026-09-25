/**
 * spam-trial.ts — 미가입 회사 스팸 검사 무료 체험 3회 + 검사 판정 공용 (2026-09-25 Harold 지시)
 * 설계 SoT = docs/2026-09-25-direct-send-precheck-design.md §5
 *
 * 체험 = 요금제에 스팸 검사가 없는 회사(`plans.spam_filter_enabled = false` · 지금은 FREE 하나)가
 *   회사당 **평생 3회**, 잔액 차감 없이 쓰는 스팸 검사.
 *
 * 표시 = `spam_filter_tests.source = 'trial'`(기존 칸 · 새 칸 0). 세는 것도 이 값, 청구에서 빼는 것도 이 값 하나다.
 * ⛔ 체험 검사는 **어느 청구·비용 집계에도 들어가지 않는다.** 선불은 차감을 건너뛰고(라우트),
 *   후불은 정산 집계가 `spamBillableTestSql()`로 뺀다. 이 조건을 각자 적지 않는다(글자가 갈리면 한 곳이 청구한다).
 * ⛔ 세고 넣는 것은 회사 advisory 잠금 안에서 한 번에 — 동시 요청이 3을 넘기지 못한다.
 */
import { query } from '../config/database';
import { normalizePhone } from './normalize';

/** 회사당 평생 체험 횟수 */
export const SPAM_TRIAL_LIMIT = 3;
/** `spam_filter_tests.source` 값 */
export const SPAM_TRIAL_SOURCE = 'trial';

/**
 * 청구·비용 집계에 넣어도 되는 검사인가 — SQL 조각(WHERE에 AND로 붙인다).
 * 쓰는 곳 = 정산 집계 2곳(`send-usage-aggregation.ts`) · 사용량 비용 표시 2곳(`manage-stats.ts`·`admin.ts`).
 */
export function spamBillableTestSql(alias = 't'): string {
  return `COALESCE(${alias}.source, 'manual') <> '${SPAM_TRIAL_SOURCE}'`;
}

/** 스팸 검사 표 advisory 잠금 키(체험 예약 전용) */
export const SPAM_TRIAL_LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext('spam-trial'), hashtext($1::text))`;

export interface SpamTrialStatus {
  /** 체험 대상 회사인가(요금제에 스팸 검사가 없다) */
  eligible: boolean;
  limit: number;
  used: number;
  remaining: number;
  /** 체험으로 막힌 문자를 찾은 검사 수(안내 창 요약) */
  blockedFound: number;
}

/** 체험 현황 — 화면 칸·안내 창이 쓴다. */
export async function readSpamTrialStatus(companyId: string): Promise<SpamTrialStatus> {
  const plan = await query(
    `SELECT p.spam_filter_enabled FROM companies c LEFT JOIN plans p ON c.plan_id = p.id WHERE c.id = $1::uuid`,
    [companyId],
  );
  const eligible = !plan.rows[0]?.spam_filter_enabled;
  const r = await query(
    `SELECT COUNT(*)::int AS used,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM spam_filter_test_results x WHERE x.test_id = t.id AND x.result = 'blocked'
            ))::int AS blocked_found
       FROM spam_filter_tests t
      WHERE t.company_id = $1::uuid AND t.source = $2`,
    [companyId, SPAM_TRIAL_SOURCE],
  );
  const used = Number(r.rows[0]?.used || 0);
  return {
    eligible,
    limit: SPAM_TRIAL_LIMIT,
    used,
    remaining: eligible ? Math.max(0, SPAM_TRIAL_LIMIT - used) : 0,
    blockedFound: Number(r.rows[0]?.blocked_found || 0),
  };
}

/** 트랜잭션 안에서 체험 한 칸이 남았는가(잠금을 잡은 뒤 부른다). */
export async function countSpamTrialsInTx(client: { query: (sql: string, params?: any[]) => Promise<any> }, companyId: string): Promise<number> {
  const r = await client.query(
    `SELECT COUNT(*)::int AS used FROM spam_filter_tests WHERE company_id = $1::uuid AND source = $2`,
    [companyId, SPAM_TRIAL_SOURCE],
  );
  return Number(r.rows[0]?.used || 0);
}

// ─────────────── 검사 판정(한 벌) ───────────────

export type SpamVerdict = 'running' | 'pass' | 'blocked' | 'warn';

export interface SpamResultRow {
  carrier: string;
  received: boolean;
  result: string | null;
}

/**
 * 검사 한 건의 판정(순수) — 막힘이 하나라도 있으면 blocked · 전부 받았으면 pass ·
 * 진행 중이면 running · 끝났는데 못 받은 곳(시간 초과·전달 실패)이 있으면 warn.
 * ⛔ 판정 전에 `withExpectedSpamDevices`로 기대 테스트폰을 채운 행을 넣는다(일부 행만으로 통과 금지). 화면은 서버 판정값만 쓴다.
 */
export function judgeSpamVerdict(status: string, rows: readonly SpamResultRow[]): SpamVerdict {
  if (rows.some((r) => r.result === 'blocked')) return 'blocked';
  if (rows.length > 0 && rows.every((r) => r.received || r.result === 'pass')) return 'pass';
  if (status !== 'completed') return 'running';
  return 'warn';
}

/**
 * 기대 테스트폰 채우기(순수) — 결과 행이 없는 **지금 쓰는 테스트폰**을 "결과 없음" 행으로 더한다(단말 = 통신사 + 번호).
 * ★Codex 6R: 번호만 보면 같은 번호가 통신사를 옮겼을 때 옛 통신사 결과가 새 통신사까지 채워 통과가 났다.
 * ★Codex 4R·5R: 발송이 중간에 끊기면 결과 행이 일부만 남아 그 일부로 통과가 났다(4R). 행을 발송 전에 미리 만들면
 *   못 보낸 행이 만료 정리(timeout)를 거쳐 청구됐다(5R). 결과 행 = 실제로 보낸 건(청구 단위)이라 쓰기는 건드리지 않고
 *   **판정하는 자리에서** 기대 집합과 맞춘다. 검사 뒤 테스트폰이 늘었으면 그 통신사는 결과 없음(이 문안으로 검사한 적이 없다).
 */
export function withExpectedSpamDevices(
  rows: readonly (SpamResultRow & { phone?: string | null })[],
  devices: readonly { carrier: string; phone: string | null }[],
): SpamResultRow[] {
  const phoneKey = (p: unknown) => normalizePhone(p) ?? String(p ?? '');
  const key = (carrier: unknown, p: unknown) => `${String(carrier ?? '')}|${phoneKey(p)}`;
  const have = new Set(rows.map((r) => key(r.carrier, r.phone)));
  const missing = devices
    .filter((d) => phoneKey(d.phone) !== '' && !have.has(key(d.carrier, d.phone)))
    .map((d) => ({ carrier: d.carrier, received: false, result: null }));
  return [...rows, ...missing];
}
