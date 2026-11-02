// replaces: none
/**
 * 엔진 처리 속도 측정 — 실 PostgreSQL(★ 2026-11-02 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md §13 · 빈칸 ①)
 *
 * 옛 부하 시험(engine-load-1102 ⑤)은 실행 한 건을 「5ms 기다림」으로 바꿔 줄 공정만 쟀다 = 실행 한 건의 실제 비용은 잰 적이 없다.
 * 여기는 실행기(runJourneyExecutor)를 운영 문장 그대로 끝까지 돌린다. 바깥만 시험이 쥔다:
 *   MySQL 적재(bulkInsertSmsQueue) = MYSQL_MS 기다림 뒤 넣은 수 · 운영 경보 = 기록만 · 발송 시간 창 = 하루 전체(시각에 따라 결과가 바뀌지 않게).
 * ★ 2026-11-02 묶음 발송(설계서 docs/2026-11-02-journey-batch-send-design.md 3-3 · §6) — 적재 = 단위 적재 CT(loadQueueUnit · INSERT 한 문장 = 단위)를 시험이 쥔다
 *   (단위 기록 → MYSQL_MS + 행 × MYSQL_ROW_MS 기다림 → 들어감) · 한 건 비용 = 회차 시간 ÷ 보낸 수(묶음은 한 단위 표식 시각이 같다 = 첫 · 끝 간격으로 못 잰다).
 * 큰 회사 1곳(실행 N) + 작은 회사 20곳(각 1) · 결과 = 실행 한 건 평균 · 큰 회사 시간당 · 작은 회사 첫 발송 지연(콘솔 한 줄 · §13 에 옮긴다).
 * 평소 test:pg = N 2,000 · 임시 폴더 표식 파일 engine-throughput-1102.on 이 있으면 파일 안 숫자.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const MYSQL_MS = 3;   // 운영 MySQL 한 문장 적재 가정(측정 아님 · 결과 줄에 같이 적는다)
const MYSQL_ROW_MS = 0.05;   // ★1102 묶음 = 한 문장에 행이 여럿 · 행마다 더하는 가정(측정 아님 · 5,000행 = 253ms · 결과 줄에 같이 적는다)
const ctl = vi.hoisted(() => ({ inserted: 0, units: 0, alerts: [] as string[], windowHours: 13 }));

vi.mock('../../config/database', async (orig) => {
  const real: any = await orig();
  return { ...real, withBoundedMysql: async (_ms: number, work: any) => work(async () => []) };
});
vi.mock('../../config/defaults', async (orig) => {
  const real: any = await orig();
  ctl.windowHours = real.SEND_HOURS.end - real.SEND_HOURS.start;   // 운영 발송 창 길이(합격선 비교 · 시험은 창을 하루 전체로 돌린다)
  return { ...real, SEND_HOURS: { start: 0, end: 24 } };
});
vi.mock('../sms-queue', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    getCompanySmsTables: async () => ['SMSQ_TEST'],
    getCompanySmsTablesWithLogs: async () => ['SMSQ_TEST'],
    hasCompanyLineGroup: async () => true,
    loadQueueUnit: async (p: any) => {
      const rows = p.kind === 'sms' ? p.smsRows : p.alimRows;
      await p.record({ threadId: 1, table: 'SMSQ_TEST', count: rows.length });
      await new Promise((r) => setTimeout(r, MYSQL_MS + rows.length * MYSQL_ROW_MS));
      ctl.inserted += rows.length;
      ctl.units += 1;
      return { state: 'loaded', table: 'SMSQ_TEST', threadId: 1, finish: () => undefined };
    },
    isMysqlThreadAlive: async () => false,
    recordCampaignSentTables: async () => undefined,
  };
});
vi.mock('../system-alert', () => ({
  sendSystemAlert: async (p: any) => { ctl.alerts.push(String(p?.dedupKey)); return 1; },
  alertPassFailures: async (p: any) => { if (p?.failures?.length) ctl.alerts.push(String(p.pass)); },
}));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { runJourneyExecutor } from '../journey-executor';
import { buildSendableStagingInsertSql } from '../operator-recipients';

const MARK = join(process.env.TEMP || process.env.TMP || '/tmp', 'engine-throughput-1102.on');
const N = existsSync(MARK) ? Number(readFileSync(MARK, 'utf8').trim()) || 20_000 : 2_000;
const BIG = randomUUID();
const SMALL = Array.from({ length: 20 }, () => randomUUID());
const PLAN = randomUUID();   // 유료 요금제(요금제가 잠기면 실행기가 여정을 멈춘다 = 측정이 아니다)
const journeyOf = new Map<string, string>();


/** 회사 하나 = 담당자 · 켜진 여정 · 문자 칸 1(검사 통과 판) · 고객 n · 지금 낼 실행 n */
async function seedCompany(companyId: string, n: number, tag: string): Promise<void> {
  const owner = randomUUID();
  const j = randomUUID();
  const step = randomUUID();
  journeyOf.set(companyId, j);
  await insertMinimalRow(pool, 'companies', { id: companyId, company_name: `처리 속도 ${tag}`, ai_credits_purchased: 100000, plan_id: PLAN, subscription_status: 'active' });
  await insertMinimalRow(pool, 'users', { id: owner, company_id: companyId, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: `t-1102-tp-${tag}` });
  await insertMinimalRow(pool, 'journeys', { id: j, company_id: companyId, created_by: owner, name: `처리 속도 ${tag}`, status: 'active', start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678' });
  await insertMinimalRow(pool, 'journey_steps', { id: step, journey_id: j, step_order: 1, step_type: 'message', channel: 'lms', message_template: '처리 속도 시험 안내 문안입니다.', delay_mode: 'relative', delay_hours: 0 });
  await insertMinimalRow(pool, 'journey_step_snapshots', { id: randomUUID(), journey_id: j, step_id: step, message_body: '처리 속도 시험 안내 문안입니다.', confidence_score: 100 });
  // 고객 · 실행 = 한 문장씩(번호는 발송 판정을 지나는 꼴 · 시험 DB 안에서만 · 실제 발송 0 = MySQL 적재가 시험 손)
  const seed = randomUUID();
  await insertMinimalRow(pool, 'customers', { id: seed, company_id: companyId, phone: '01099990000', is_active: true, sms_opt_in: true });
  if (n > 1) {
    await pool.query(
      `INSERT INTO customers SELECT (jsonb_populate_record(NULL::customers, to_jsonb(c) || jsonb_build_object('id', gen_random_uuid(), 'phone', '0109' || lpad(g::text, 7, '0')))).*
         FROM customers c, generate_series(1, $2::int) g WHERE c.id = $1::uuid`,
      [seed, n - 1],
    );
  }
  const ex = randomUUID();
  await insertMinimalRow(pool, 'journey_executions', { id: ex, journey_id: j, customer_id: seed, current_step_order: 0, status: 'active' });
  await pool.query(`UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [ex]);
  if (n > 1) {
    await pool.query(
      `INSERT INTO journey_executions SELECT (jsonb_populate_record(NULL::journey_executions, to_jsonb(e) || jsonb_build_object('id', gen_random_uuid(), 'customer_id', c.id))).*
         FROM journey_executions e, customers c WHERE e.id = $1::uuid AND c.company_id = $2::uuid AND c.id <> $3::uuid`,
      [ex, companyId, seed],
    );
  }
}

describe(`엔진 처리 속도(실 PG · 큰 회사 실행 ${N.toLocaleString()} + 작은 회사 20 · MySQL ${MYSQL_MS}ms 가정)`, () => {
  beforeAll(async () => {
    // C90-DDL-1 = 크레딧 원장 seq(운영엔 있음 · 시험 그릇 덤프엔 없음 = 없으면 차감 재시도 3번이 시간을 부풀린다)
    for (const id of ['C90-DDL-1', 'C93-DDL-1', 'C93-DDL-2', 'C93-DDL-3', 'C96-DDL-1']) await pool.query(ledgerBlockSql(id));
    await insertMinimalRow(pool, 'plans', { id: PLAN, plan_code: 'PRO', plan_name: 'PRO', monthly_price: 1000000, ai_credits_per_month: 2400, is_active: true });
    await seedCompany(BIG, N, 'big');
    for (const [i, co] of SMALL.entries()) await seedCompany(co, 1, `s${i}`);
  }, 600_000);

  it('실행기 한 회차 = 실행 한 건 실제 비용 · 큰 회사 시간당 · 작은 회사가 큰 회사 뒤에 줄 서지 않는다', async () => {
    const t0 = Date.now();
    const s = await runJourneyExecutor();
    const ms = Date.now() - t0;
    const sent = await pool.query(
      `SELECT j.company_id, COUNT(*)::int AS n, MIN(l.sent_at) AS first_at, MAX(l.sent_at) AS last_at
         FROM journey_step_logs l JOIN journey_executions e ON e.id = l.execution_id JOIN journeys j ON j.id = e.journey_id
        WHERE l.status = 'sent' AND j.company_id = ANY($1::uuid[]) GROUP BY j.company_id`,
      [[BIG, ...SMALL]],
    );
    const byCo = new Map(sent.rows.map((r: any) => [String(r.company_id), r]));
    const big = byCo.get(BIG) as any;
    const bigN = Number(big?.n || 0);
    const allSent = sent.rows.reduce((a: number, r: any) => a + Number(r.n), 0);
    const perExec = allSent > 0 ? ms / allSent : NaN;   // 회차 시간 ÷ 보낸 수(묶음 = 단위 표식 시각이 같다)
    const perHour = Math.floor((3_600_000 / perExec) * 0.8);   // 회차 예산 4분/5분
    const millionHours = 1_000_000 / perHour;   // 큰 회사 100만 = 합격선(Harold 추천값 · 발송 창 하루 안)
    const smallFirst = SMALL.map((co) => { const r: any = byCo.get(co); return r ? new Date(r.first_at).getTime() - t0 : NaN; });
    const worstSmall = Math.max(...smallFirst);
    console.log(
      `[처리 속도 · 묶음] 회차 ${ms.toLocaleString()}ms · 처리 ${s.processed} · 보냄 ${s.sent} · 넘김 ${s.skipped} · 기다림 ${s.waited} · 멈춤 ${s.paused} · 실패 ${s.failed}`
      + ` · 큰 회사 ${bigN.toLocaleString()}건 · 한 건 ${perExec.toFixed(2)}ms(회차 ÷ 보낸 수) · 시간당 ${perHour.toLocaleString()}건(×0.8) · 100만 = ${millionHours.toFixed(2)}시간`
      + ` · 작은 회사 첫 발송 최악 ${worstSmall.toLocaleString()}ms · MySQL 단위 ${ctl.units} · ${ctl.inserted.toLocaleString()}행(가정 ${MYSQL_MS}ms + 행 ${MYSQL_ROW_MS}ms) · 경보 ${ctl.alerts.join(',') || 0}`,
    );
    expect(s.failed).toBe(0);
    expect(bigN).toBe(N);   // 묶음 = 큰 회사 전원이 이 회차에(옛 = 회사당 25 · 4분 예산)
    expect(smallFirst.every((x) => Number.isFinite(x))).toBe(true);   // 작은 회사 20곳 모두 이 회차에 나갔다
    expect(worstSmall).toBeLessThan(ms / 2);   // ★1102 큰 회사 묶음이 한 줄을 쥐는 동안 나머지 줄이 작은 회사를 받는다(차례 끝을 기다리지 않는다)
    expect(millionHours).toBeLessThan(ctl.windowHours);   // 합격선 = 큰 회사 100만이 발송 창 하루(운영 SEND_HOURS) 안
  }, 600_000);

  it('자동마케팅 회차 한 건의 무거운 단계 = 대상 적재 한 문장(운영 SQL buildSendableStagingInsertSql · 큰 회사 전원)', async () => {
    const stagingId = randomUUID();
    const q = buildSendableStagingInsertSql(stagingId, [BIG], '', [], '', {});
    const t0 = Date.now();
    const r = await pool.query(q.sql, q.params);
    const ms = Date.now() - t0;
    console.log(`[처리 속도] 자동마케팅 대상 적재 한 문장 ${Number(r.rowCount).toLocaleString()}명 ${ms.toLocaleString()}ms (= 큰 회사 회차 하나가 발송 패스 줄 하나를 쥐는 시간 · 실제 문자 넣기는 직접발송 워커)`);
    expect(Number(r.rowCount)).toBe(N);
    await pool.query(`DELETE FROM campaign_send_staging WHERE staging_id = $1`, [stagingId]);
  }, 600_000);
});
