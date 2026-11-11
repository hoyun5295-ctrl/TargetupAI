// replaces: none
/**
 * C129 여정 남은 결함 아홉 건 — 실 PostgreSQL(★ 2026-11-11 · 설계서 docs/2026-11-11-journey-remaining-nine-design.md §6 T4)
 *
 *   D1 · D2 자동 멈춤 = 계보 잠금 안 · 여정이 멈춘 상태일 때만 · 진행 중 실행만 · 기록 = 멈춘 때만(다시 켜기 끼어들기 포함)
 *   D3 차감 실패 = 표식 삭제와 방금 시도 기록 삭제가 한 문장 · 소진 조각 = 칸별 시도 기록 수
 *   D4 월 예산 달 = KST · D6 칸 지우기 가드 = 미완료 실행 · D8 붙이기 · 떼기 = 저장 대기일 ≥ 새 시작의 최솟값
 *   D9 감시의 첫 발송 시각 = 넣는 트랜잭션 안에서 읽은 첫 칸(끼어들기)
 * 끼어들기 = 다른 연결이 그 여정의 계보 잠금(journey-entry)을 쥔 채 일을 띄우고 pg_locks 로 기다림을 확인한 뒤 값을 바꿔 커밋한다(시험용 훅 없음).
 * 고객 번호 = 010-0000-xxxx(도달 불가 대역).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../system-alert', () => ({ sendSystemAlert: async () => 1, alertPassFailures: async () => undefined }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { autoPauseExecution } from '../journey-pause-handler';
import { CLEAR_UNPAID_CLAIMS_SQL, loadAttemptsSql, LOAD_ATTEMPT_MAX, JOURNEY_MONTH_COST_SQL } from '../journey-executor';
import { deleteJourneyStep } from '../journey-builder';
import { attachJourney, detachJourney } from '../journey-attach';
import { runJourneyTriggerWatcher } from '../journey-trigger-watcher';
import { KST_MONTH_START_SQL } from '../stats-aggregation';
import { prepaidDeduct, prepaidRefund, REFUND_KEYS } from '../prepaid';
import { pickStepCampaignForUnits, kstDateString, resetStepCampaignSeqCache } from '../journey-step-campaign';
import { ledgerBlockSql } from './pg/global-setup';
import { resolveAlimtalkLedgerUnits } from '../deduct-reference';

const CO = randomUUID();
const OWNER = randomUUID();
const H = 3_600_000;
const D = 24 * H;
const ago = (ms: number) => new Date(Date.now() - ms);
let seq = 8900;

async function customer(over: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `0100000${String(seq++)}`, is_active: true, sms_opt_in: true, ...over });
  await pool.query(`UPDATE customers SET created_at = NOW() - INTERVAL '900 days' WHERE id = $1`, [id]);   // 이관 유예(갓 들어온 고객 제외) 밖
  return id;
}
async function journey(trigger: string, over: Record<string, unknown> = {}, steps = 1): Promise<{ id: string; stepIds: string[] }> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'journeys', {
    id, company_id: CO, created_by: OWNER, name: `남은 결함 ${trigger}`, status: 'active', start_kind: 'event', trigger_event: trigger,
    callback_number: '0212345678', ...over,
  });
  const stepIds: string[] = [];
  for (let k = 1; k <= steps; k++) {
    const sid = randomUUID();
    stepIds.push(sid);
    await insertMinimalRow(pool, 'journey_steps', { id: sid, journey_id: id, step_order: k, step_type: 'message', channel: 'sms', message_template: `안내 ${k}`, delay_mode: 'relative', delay_hours: 0 });
  }
  return { id, stepIds };
}
async function run(journeyId: string, customerId: string, status: string, over: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'journey_executions', { id, journey_id: journeyId, customer_id: customerId, current_step_order: 0, status, entered_at: ago(2 * D), ...over });
  return id;
}
const execRow = async (id: string) => (await pool.query(`SELECT status, error_log, next_run_at, completed_at IS NOT NULL AS ended FROM journey_executions WHERE id = $1`, [id])).rows[0];
const pauseLogs = async (executionId: string) => (await pool.query(`SELECT pause_reason, execution_status_at_pause FROM journey_step_pause_logs WHERE execution_id = $1`, [executionId])).rows;

/** 그 여정들의 계보 잠금을 다른 연결이 쥔 채 work 를 띄운다 → work 가 잠금에서 기다리는 것을 확인 → change(커밋) → 잠금 해제 → work 끝 */
async function interleave<T>(journeyIds: string[], work: () => Promise<T>, change: (holder: { query: (t: string, p?: any[]) => Promise<any> }) => Promise<void>): Promise<T> {
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    for (const id of journeyIds) {
      await holder.query(`SELECT pg_advisory_xact_lock(hashtext('journey-entry'), hashtext((COALESCE(lineage_id, id))::text)) FROM journeys WHERE id = $1::uuid`, [id]);
    }
    const running = work();
    let waiting = 0;
    for (let i = 0; i < 400 && waiting === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const w = await pool.query(
        `SELECT COUNT(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' AND NOT l.granted AND a.query ILIKE '%journey-entry%' AND a.pid <> $1`, [(holder as any).processID]);
      waiting = Number(w.rows[0].n);
    }
    expect(waiting, 'work 가 계보 잠금에서 기다려야 끼어들기가 성립한다').toBeGreaterThan(0);
    await change(holder);
    await holder.query('COMMIT');
    return await running;
  } catch (e) {
    await holder.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    holder.release();
  }
}

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '여정 남은 결함 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-2222', login_id: 't-1111-journey-remaining' });
});

describe('D1 · D2 자동 멈춤 — 여정이 멈춘 상태일 때만 · 진행 중인 실행에만 · 기록 = 멈춘 때만', () => {
  const pauseArgs = (j: { id: string; stepIds: string[] }, executionId: string) =>
    ({ companyId: CO, journeyId: j.id, stepId: j.stepIds[0], executionId, pauseReason: 'carrier_temp_fail' as const, pauseTriggerSource: 'test' });

  it('① 멈춘 여정 + 진행 중 실행 = 멈춤 + 기록 1 · 완료 · 끝냄 · 이미 멈춘 실행 = 상태 그대로 · 기록 0', async () => {
    const j = await journey('cdp.purchase', { status: 'paused' });
    const eActive = await run(j.id, await customer(), 'active');
    const eDone = await run(j.id, await customer(), 'completed', { completed_at: ago(H) });
    const eEnded = await run(j.id, await customer(), 'ended', { completed_at: ago(H) });
    const ePaused = await run(j.id, await customer(), 'paused');
    expect(await autoPauseExecution(pauseArgs(j, eActive))).toBe('paused');
    expect((await execRow(eActive)).status).toBe('paused');
    expect(await pauseLogs(eActive)).toEqual([{ pause_reason: 'carrier_temp_fail', execution_status_at_pause: 'active' }]);
    for (const [id, st] of [[eDone, 'completed'], [eEnded, 'ended'], [ePaused, 'paused']] as const) {
      expect(await autoPauseExecution(pauseArgs(j, id)), st).toBe('skipped');
      expect((await execRow(id)).status, st).toBe(st);                 // 옛: 완료 · 끝낸 실행이 paused 로 덮였다
      expect(await pauseLogs(id), st).toEqual([]);
    }
  });

  it('① 켜진 여정(여정 멈춤이 실패했거나 그 사이 다시 켰다) + 진행 중 실행 = 그대로 · 기록 0', async () => {
    const j = await journey('cdp.purchase', { status: 'active' });
    const e = await run(j.id, await customer(), 'active');
    expect(await autoPauseExecution(pauseArgs(j, e))).toBe('skipped');
    expect((await execRow(e)).status).toBe('active');
    expect(await pauseLogs(e)).toEqual([]);
  });

  it('② 끼어들기: 여정 멈춤 → (계보 잠금을 쥔 다시 켜기가 먼저 끝남) → 실행 멈춤 = 켜진 여정을 보고 건너뛴다(켜진 여정 + 멈춘 실행 0)', async () => {
    const j = await journey('cdp.purchase', { status: 'paused' });
    const e = await run(j.id, await customer(), 'active');
    const out = await interleave([j.id], () => autoPauseExecution(pauseArgs(j, e)), async (holder) => {
      await holder.query(`UPDATE journeys SET status = 'active' WHERE id = $1`, [j.id]);   // 다시 켜기(같은 계보 잠금을 쥔 트랜잭션)
    });
    expect(out).toBe('skipped');
    expect((await execRow(e)).status).toBe('active');
    expect(await pauseLogs(e)).toEqual([]);
  });
});

describe('D3 차감 실패 — 표식을 지우면서 방금 남긴 시도 기록 하나를 같이 지운다 · 소진 = 칸별 시도 기록 수', () => {
  it('③ 그 칸 · 그 캠페인 시도 기록의 맨 뒤 하나만 빠진다 · sending 이 아닌 표식의 실행은 그대로', async () => {
    const j = await journey('cdp.purchase', {}, 2);
    const [S, OTHER] = j.stepIds;
    const C = 'camp-1111';
    const att = (step: string, at: string) => ({ reason: 'load_attempt', step_id: step, campaign_id: C, at });
    const log = [att(S, '2026-11-11T00:00:01.123456+00:00'), { reason: 'queue_insert_failed', step_id: S }, att(OTHER, '2026-11-11T00:00:02.000001+00:00'), att(S, '2026-11-11T00:00:03.654321+00:00')];
    const eUnpaid = await run(j.id, await customer(), 'active', { error_log: JSON.stringify(log), error_count: 1 });
    const eSent = await run(j.id, await customer(), 'active', { error_log: JSON.stringify(log) });
    const claimUnpaid = randomUUID();
    const claimSent = randomUUID();
    await insertMinimalRow(pool, 'journey_step_logs', { id: claimUnpaid, execution_id: eUnpaid, step_id: S, status: 'sending', cost: 10 });
    await insertMinimalRow(pool, 'journey_step_logs', { id: claimSent, execution_id: eSent, step_id: S, status: 'sent', cost: 10 });
    const attempts = async (id: string, step: string) =>
      Number((await pool.query(`SELECT ${loadAttemptsSql('e', '$2')}::int AS n FROM journey_executions e WHERE e.id = $1::uuid`, [id, step])).rows[0].n);
    expect(await attempts(eUnpaid, S)).toBe(2);
    expect(LOAD_ATTEMPT_MAX).toBe(2);

    await pool.query(CLEAR_UNPAID_CLAIMS_SQL, [[claimUnpaid, claimSent], S, C]);

    expect((await execRow(eUnpaid)).error_log).toEqual([log[0], log[1], log[2]]);          // 맨 뒤 그 칸 시도 하나만 빠짐(다른 칸 · 다른 기록 그대로 · 차례 그대로)
    expect(await attempts(eUnpaid, S)).toBe(1);                                             // 차감 실패는 시도로 세지 않는다
    expect(await attempts(eUnpaid, OTHER)).toBe(1);
    expect((await pool.query(`SELECT 1 FROM journey_step_logs WHERE id = $1`, [claimUnpaid])).rows).toHaveLength(0);
    expect((await execRow(eSent)).error_log).toEqual(log);                                   // 표식이 sending 이 아니면 손대지 않는다
    expect((await pool.query(`SELECT status FROM journey_step_logs WHERE id = $1`, [claimSent])).rows[0].status).toBe('sent');
    // 소진 조각(표식 문장 · 상한 확인 · 재시도 소진이 같이 쓰는 조건): 실행 전체 오류 횟수 1 + 그 칸 시도 1 = 소진 아님 · 그 칸 시도 2 = 소진(새 표식 0)
    const open = async (id: string) =>
      (await pool.query(`SELECT 1 FROM journey_executions e WHERE e.id = $1::uuid AND ${loadAttemptsSql('e', '$2')} < ${LOAD_ATTEMPT_MAX}`, [id, S])).rows.length === 1;
    expect(await open(eUnpaid)).toBe(true);
    expect(await open(eSent)).toBe(false);
  });
});

describe('D4 월 예산 달 = KST', () => {
  it('⑦ KST 이번 달 시작 뒤의 발송 로그만 합한다(옛 UTC 달 시작 = 한국 시간 1일 09시 전 발송분이 빠졌다)', async () => {
    const j = await journey('cdp.purchase');
    const e = await run(j.id, await customer(), 'active');
    const m: Date = (await pool.query(`SELECT ${KST_MONTH_START_SQL} AS m`)).rows[0].m;
    await insertMinimalRow(pool, 'journey_step_logs', { id: randomUUID(), execution_id: e, step_id: j.stepIds[0], status: 'sent', cost: 10, sent_at: new Date(m.getTime() + H) });      // 이번 달 1일 01시(KST)
    await insertMinimalRow(pool, 'journey_step_logs', { id: randomUUID(), execution_id: e, step_id: j.stepIds[0], status: 'sent', cost: 100, sent_at: new Date(m.getTime() - H) });    // 전달 말일 23시(KST)
    await insertMinimalRow(pool, 'journey_step_logs', { id: randomUUID(), execution_id: e, step_id: j.stepIds[0], status: 'failed', cost: 1000, sent_at: new Date(m.getTime() + H) });  // 실패 로그 = 제외
    expect(Number((await pool.query(JOURNEY_MONTH_COST_SQL, [j.id])).rows[0].month_cost)).toBe(10);
  });
});

describe('D6 칸 지우기 가드 = 미완료 실행(진행 중 + 멈춤)', () => {
  it('④ 멈춘 실행이 걸친 칸 = 지울 수 없다 · 끝난 실행뿐이면 지워진다', async () => {
    const held = await journey('cdp.purchase', { status: 'paused' }, 3);
    await run(held.id, await customer(), 'paused', { current_step_order: 1 });       // 다음에 2번째 칸을 받을 멈춘 실행
    await expect(deleteJourneyStep(CO, held.id, held.stepIds[1])).rejects.toThrow(/지울 수 없습니다/);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM journey_steps WHERE journey_id = $1`, [held.id])).rows[0].n).toBe(3);

    const free = await journey('cdp.purchase', { status: 'paused' }, 3);
    await run(free.id, await customer(), 'completed', { current_step_order: 3, completed_at: ago(H) });
    const r = await deleteJourneyStep(CO, free.id, free.stepIds[1]);
    expect(r?.deletedOrder).toBe(2);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM journey_steps WHERE journey_id = $1`, [free.id])).rows[0].n).toBe(2);
  });
});

describe('D8 붙이기 · 떼기 = 저장 대기일을 새 시작의 최솟값 이상으로', () => {
  const cooldown = async (id: string) => {
    const r = (await pool.query(`SELECT trigger_event, reentry_cooldown_days FROM journeys WHERE id = $1`, [id])).rows[0];
    return [String(r.trigger_event), r.reentry_cooldown_days == null ? null : Number(r.reentry_cooldown_days)];
  };
  it('⑤ 휴면(최솟값 7) 여정을 붙였다 떼면 0일 → 7일 · 더 큰 값 · 재진입 불가 여정은 그대로 · 자동 재진입 = 자동 최솟값', async () => {
    const front = await journey('cdp.purchase', { status: 'draft' });
    const dorm0 = await journey('customer.dormant', { status: 'draft', allow_reentry: true, reentry_cooldown_days: 0, trigger_filters: { dormant_days: 30 } });
    const dorm30 = await journey('customer.dormant', { status: 'draft', allow_reentry: true, reentry_cooldown_days: 30, trigger_filters: { dormant_days: 30 } });
    const dormNo = await journey('customer.dormant', { status: 'draft', allow_reentry: false, reentry_cooldown_days: 0, trigger_filters: { dormant_days: 30 } });
    const auto0 = await journey('cdp.purchase', { status: 'draft', allow_reentry: true, auto_reentry_enabled: true, reentry_cooldown_days: 0 });

    await attachJourney(CO, dorm0.id, front.id, 'completed');
    expect(await cooldown(dorm0.id)).toEqual(['journey.after', 0]);          // 앞 여정을 마치면 = 최솟값 0 → 그대로
    await detachJourney(CO, dorm0.id);
    expect(await cooldown(dorm0.id)).toEqual(['customer.dormant', 7]);       // 옛: 0 으로 남아 화면 값과 실제 적용 값이 달랐다

    await attachJourney(CO, dorm30.id, front.id, 'completed');
    await detachJourney(CO, dorm30.id);
    expect(await cooldown(dorm30.id)).toEqual(['customer.dormant', 30]);     // 줄이지 않는다

    await attachJourney(CO, dormNo.id, front.id, 'completed');
    await detachJourney(CO, dormNo.id);
    expect(await cooldown(dormNo.id)).toEqual(['customer.dormant', 0]);      // 재진입 불가 = 그대로

    await attachJourney(CO, auto0.id, front.id, 'completed');
    expect(await cooldown(auto0.id)).toEqual(['journey.after', 1]);          // 자동으로 다시 받기 = 어떤 시작이든 최소 1일
  });
});

describe('D9 감시의 첫 발송 시각 = 넣는 트랜잭션 안에서 읽은 첫 칸', () => {
  it('⑥ 잠금에서 기다리는 사이 첫 칸 대기를 0 → 168시간으로 바꾸면, 그 회차에 들어온 실행의 첫 발송 시각 = 새 값', async () => {
    const j = await journey('custom', { trigger_filters: { customer_conditions: [{ field: 'grade', op: '==', value: '남은결함9' }] } });
    const c = await customer({ grade: '남은결함9' });
    await interleave([j.id], () => runJourneyTriggerWatcher(), async (holder) => {
      await holder.query(`UPDATE journey_steps SET delay_hours = 168 WHERE journey_id = $1 AND step_order = 1`, [j.id]);
    });
    const rows = (await pool.query(`SELECT status, next_run_at FROM journey_executions WHERE journey_id = $1 AND customer_id = $2`, [j.id, c])).rows;
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].next_run_at).getTime() - Date.now()).toBeGreaterThan(100 * H);   // 옛: 잠금 앞에서 읽은 0시간 = 지금
  });
});

describe('배포 실측 문장(설계서 §8 P1) — 실제 표에서 오류 없이 돈다', () => {
  it('⑧ 읽기 문장 셋', async () => {
    const doc = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'docs', '2026-11-11-journey-remaining-nine-design.md'), 'utf8');
    const block = /```sql\r?\n([\s\S]*?)```/.exec(doc);
    expect(block).not.toBeNull();
    const stmts = block![1].split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('--'));
    expect(stmts).toHaveLength(3);
    for (const sql of stmts) {
      expect(sql).toMatch(/^SELECT /);
      await pool.query(sql);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// ★ 2026-11-11 C129 D10(설계서 §10 처방 26 ~ 31 · 시험 T6 ① ~ ③-e) — 선불 여정 알림톡 칸의 차감 꼴 · 원장 열쇠 · 단계 캠페인 가름 · 월 예산 원천
//   실행기 한 회차(알림톡 적재)는 시험 그릇에 세우는 장치가 없다 → 부품(차감 · 환불 · 캠페인 고르기 · 예산 문장)을 실 PG 로, 호출 배선은 소스 계약(journey-remaining-1111.test.ts T5)으로.
// ════════════════════════════════════════════════════════════════════
describe('D10 선불 여정 알림톡 칸 — 차감 꼴 · 원장 열쇠 · 단계 캠페인 가름 · 월 예산 원천', () => {
  const P = randomUUID();         // 선불 · 알림톡 10 · SMS 12 · LMS 30(부가세 포함 값)
  const P_NOLMS = randomUUID();   // 선불 · LMS 단가 미설정
  const POST = randomUUID();      // 후불
  const PU = randomUUID();
  const LMS_SHAPE = 'KAKAO|LMS|30|10/30/30';
  type Key = { fallback: 'SMS' | 'LMS' | null; expectShape: string; sendDay: string };
  const key = (over: Partial<Key> = {}) => ({ kakaoCharge: { fallback: 'LMS', expectShape: LMS_SHAPE, sendDay: kstDateString(), ...over } as Key });
  const bal = async (co: string) => Number((await pool.query(`SELECT balance FROM companies WHERE id = $1`, [co])).rows[0].balance);
  const txs = async (ref: string) =>
    (await pool.query(`SELECT type, amount::float AS amount, description, refund_key FROM balance_transactions WHERE reference_id = $1 ORDER BY created_at, id`, [ref])).rows;

  beforeAll(async () => {
    const prices = { unit_price_basis: 'vat_included', cost_per_kakao: 10, cost_per_sms: 12, cost_per_lms: 30 };
    await insertMinimalRow(pool, 'companies', { id: P, company_name: '선불 알림톡', billing_type: 'prepaid', balance: 100000, ...prices });
    await insertMinimalRow(pool, 'companies', { id: P_NOLMS, company_name: '선불 LMS 미설정', billing_type: 'prepaid', balance: 100000, ...prices, cost_per_lms: null });
    await insertMinimalRow(pool, 'companies', { id: POST, company_name: '후불 알림톡', billing_type: 'postpaid', ...prices });
    await insertMinimalRow(pool, 'users', { id: PU, company_id: P, user_type: 'admin', is_active: true, phone: '010-0000-2223', login_id: 't-1111-journey-prepaid' });
    // 단계 캠페인 이어 붙임(순번 칸 · 4열 기본 키)은 덤프 뒤 DDL — 운영은 1103 적용(원장 C96-DDL-1 · 2A · 2B) · 이 사본에 얹는다
    for (const id of ['C96-DDL-1', 'C96-DDL-2A', 'C96-DDL-2B']) await pool.query(ledgerBlockSql(id));
    resetStepCampaignSeqCache();
  });

  it('① 대체 LMS = n × max(알림톡, LMS) · 차감 행에 결과별 단가 · 대체 없음 = 알림톡 단가 · 단가 미기재(종전)', async () => {
    const ref = randomUUID();
    const before = await bal(P);
    expect(await prepaidDeduct(P, 2, 'KAKAO', ref, PU, 'journey', null, key())).toMatchObject({ ok: true, amount: 60 });
    expect(await bal(P)).toBe(before - 60);
    const rows = await txs(ref);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toContain('KAKAO 2건 발송 차감 (건당 30원) · 결과별 정산: 알림톡 10원 · SMS 대체 30원 · LMS 대체 30원');
    expect(resolveAlimtalkLedgerUnits(rows as any)).toEqual({ KAKAO: 10, SMS: 30, LMS: 30 });   // 정산기가 읽는 함수

    const none = randomUUID();
    expect(await prepaidDeduct(P, 2, 'KAKAO', none, PU, 'journey', null, key({ fallback: null, expectShape: 'KAKAO|N|10|-' }))).toMatchObject({ ok: true, amount: 20 });
    const nrows = await txs(none);
    expect(nrows[0].description).toContain('KAKAO 2건 발송 차감 (건당 10원)');
    expect(nrows[0].description).not.toContain('결과별 정산');
  });

  it('①(③-b · ③-d · ③-e) 원장 열쇠가 준비 때와 다르면 차감 0(chargeChanged · 잔액 · 원장 그대로) / 고른 대체 단가 미설정 = 거절', async () => {
    const before = await bal(P);
    const cases: Array<[string, string, ReturnType<typeof key> | undefined]> = [
      ['꼴 — 회사 단가가 바뀜', P, key({ expectShape: 'KAKAO|LMS|27|10/27/27' })],
      ['꼴 — 대체 유형이 바뀜', P, key({ fallback: 'SMS' })],
      ['발송 날이 바뀜', P, key({ sendDay: '2000-01-01' })],
      ['열쇠 없음(준비 때는 후불이었다)', P, undefined],
      ['선불이 아님(준비 때는 선불이었다)', POST, key()],
    ];
    for (const [name, co, o] of cases) {
      const ref = randomUUID();
      const r = await prepaidDeduct(co, 1, 'KAKAO', ref, PU, 'journey', null, o);
      expect(r.ok, name).toBe(false);
      expect(r.chargeChanged, name).toBe(true);
      expect(await txs(ref), name).toHaveLength(0);
    }
    expect(await bal(P)).toBe(before);
    // 후불 + 열쇠 없음 = 종전(차감 없이 통과) · 여정이 아닌 알림톡 차감(참조 campaign)은 열쇠를 요구하지 않는다
    expect(await prepaidDeduct(POST, 1, 'KAKAO', randomUUID(), PU, 'journey')).toMatchObject({ ok: true, amount: 0 });
    expect(await prepaidDeduct(P, 1, 'KAKAO', randomUUID(), PU, 'campaign')).toMatchObject({ ok: true, amount: 10 });
    // 고른 대체 단가 미설정 = 거절(공짜 대체 0 · 꼴 바뀜이 아니다 = 실행기의 일반 차감 실패 갈래 = 여정 멈춤)
    const u = await prepaidDeduct(P_NOLMS, 1, 'KAKAO', randomUUID(), PU, 'journey', null, key());
    expect(u.ok).toBe(false);
    expect(u.chargeChanged).toBeUndefined();
    expect(u.error).toContain('LMS 단가가 설정되지 않아');
    expect(await bal(P_NOLMS)).toBe(100000);
  });

  it('①-b 여정 원장 + 결과별 단가 = 차액 환불과 실패 환불이 서로를 줄이지 않는다(두 순서 · 다시 불러도 0)', async () => {
    // 2건 차감 60 · 한 건 알림톡 성공(차액 30 − 10 = 20) · 한 건 실패(30) → 환불 합 50
    for (const order of ['차액 먼저', '실패 먼저'] as const) {
      const ref = randomUUID();
      await prepaidDeduct(P, 2, 'KAKAO', ref, PU, 'journey', null, key());
      const diff = () => prepaidRefund(P, 0, 'KAKAO', ref, '결과별 단가 차액 환불', 'journey', { refundKey: REFUND_KEYS.KAKAO_DIFF, targetAmount: 20 });
      const fail = () => prepaidRefund(P, 0, 'KAKAO', ref, '여정 발송 실패 환불 (sweep)', 'journey', { refundKey: REFUND_KEYS.FAIL, netTargetCount: 1 });
      const got = order === '차액 먼저' ? [(await diff()).refunded, (await fail()).refunded] : [(await fail()).refunded, (await diff()).refunded];
      expect([...got].sort((a, b) => a - b), order).toEqual([20, 30]);
      expect((await diff()).refunded + (await fail()).refunded, order).toBe(0);
      const refunded = (await txs(ref)).filter((t: any) => t.type === 'refund').reduce((sum: number, t: any) => sum + t.amount, 0);
      expect(refunded, order).toBe(50);
    }
  });

  it('③(③-d) 단계 캠페인 = 꼴이 같으면 같은 캠페인 · 다르면(회사 단가 · 대체 유형 · 꼴 없음 = 후불 전환) 새 순번 · 꼴 없음끼리 = 종전', async () => {
    const j = await journey('cdp.purchase', { company_id: P, created_by: PU });
    const pick = async (ledgerShape?: string): Promise<string> => {
      const r = await pickStepCampaignForUnits({
        companyId: P, journeyId: j.id, stepId: j.stepIds[0], stepOrder: 1, msgType: 'KAKAO', representativeMessage: '알림', subject: null, isAd: false,
        createdBy: PU, sendChannel: 'alimtalk', callbackNumber: '0212345678', kakaoTemplateId: null, mmsImagePaths: null, ledgerShape,
      });
      if ('blocked' in r) throw new Error('이어 붙임이 닫혀 있다');
      expect(r.sendDate).toBe(kstDateString());
      return r.campaignId;
    };
    const a = await pick(LMS_SHAPE);
    expect(await pick(LMS_SHAPE)).toBe(a);
    const b = await pick('KAKAO|LMS|40|10/40/40');   // 같은 날 회사 LMS 단가가 바뀜
    const c = await pick('KAKAO|N|10|-');             // 같은 날 대체 유형이 바뀜
    const d = await pick(undefined);                   // 선불 → 후불(꼴 없음)
    expect(await pick(undefined)).toBe(d);
    expect(new Set([a, b, c, d]).size).toBe(4);
    const rows = (await pool.query(
      `SELECT jsc.campaign_id, jsc.seq::int AS seq, c.send_config->>'ledgerShape' AS shape FROM journey_step_campaigns jsc JOIN campaigns c ON c.id = jsc.campaign_id
        WHERE jsc.journey_id = $1 ORDER BY jsc.seq`, [j.id])).rows;
    expect(rows.map((x: any) => [String(x.campaign_id), x.seq, x.shape])).toEqual([[a, 0, LMS_SHAPE], [b, 1, 'KAKAO|LMS|40|10/40/40'], [c, 2, 'KAKAO|N|10|-'], [d, 3, null]]);

    // 문자 칸 · 후불(꼴을 넘기지 않는 호출) = 한 캠페인 그대로
    const sms = await journey('cdp.purchase', { company_id: P, created_by: PU });
    const smsPick = async () => {
      const r = await pickStepCampaignForUnits({
        companyId: P, journeyId: sms.id, stepId: sms.stepIds[0], stepOrder: 1, msgType: 'LMS', representativeMessage: '문자', subject: '제목', isAd: false,
        createdBy: PU, sendChannel: 'sms', callbackNumber: '0212345678', kakaoTemplateId: null, mmsImagePaths: null,
      });
      return 'blocked' in r ? '' : r.campaignId;
    };
    expect(await smsPick()).toBe(await smsPick());
  });

  it('③-c 월 예산 = 꼴 없는 캠페인의 칸 기록 + 꼴 있는 캠페인의 원장 순지출(차감 − 환불 + 회수 · 이번 달 발송 날) · 꼴 있는 캠페인의 칸 기록은 세지 않는다', async () => {
    const j = await journey('cdp.purchase', { company_id: P, created_by: PU });
    const e = await run(j.id, await customer(), 'active');
    const camp = async (shape: string | null): Promise<string> => {
      const id = randomUUID();
      await insertMinimalRow(pool, 'campaigns', { id, company_id: P, created_by: PU, campaign_name: '[여정] step 1', message_type: 'LMS', status: 'sending', send_type: 'journey' });
      if (shape) await pool.query(`UPDATE campaigns SET send_config = jsonb_build_object('ledgerShape', $2::text) WHERE id = $1`, [id, shape]);
      return id;
    };
    const link = (campaignId: string, seqNo: number, day: string) => pool.query(
      `INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id, seq) VALUES ($1, $2, $3, $4, $5)`, [j.id, j.stepIds[0], day, campaignId, seqNo]);
    const tx = (ref: string, type: string, amount: number, description: string) => pool.query(
      `INSERT INTO balance_transactions (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method, message_type)
       VALUES ($1, $2, $3, 0, $4, 'journey', $5, 'system', 'KAKAO')`, [P, type, amount, description, ref]);
    const log = (campaignId: string, cost: number) =>
      insertMinimalRow(pool, 'journey_step_logs', { id: randomUUID(), execution_id: e, step_id: j.stepIds[0], campaign_id: campaignId, sent_at: new Date(), status: 'sent', cost });
    const today = kstDateString();
    const lastMonth = String((await pool.query(`SELECT ((date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') - INTERVAL '1 day')::date)::text AS d`)).rows[0].d);
    const shaped = await camp(LMS_SHAPE);
    const plain = await camp(null);
    const old = await camp(LMS_SHAPE);
    await link(shaped, 0, today);
    await link(plain, 1, today);
    await link(old, 0, lastMonth);
    await tx(shaped, 'deduct', 90, '[여정] KAKAO 3건 발송 차감 (건당 30원)');
    await tx(shaped, 'refund', 20, '결과별 단가 차액 환불 (KAKAO 20원)');
    await tx(shaped, 'admin_deduct', -5, 'KAKAO 환불 reverse 5원');
    await tx(old, 'deduct', 1000, '[여정] KAKAO 지난달 차감');
    await log(shaped, 10);   // 꼴 있는 캠페인 = 원장이 센다(칸 기록 10 은 세지 않는다)
    await log(plain, 7);
    const cost = async () => Number((await pool.query(JOURNEY_MONTH_COST_SQL, [j.id])).rows[0].month_cost);
    expect(await cost()).toBe(82);   // 7 + (90 − 20 + 5)
    // 결과가 더 와서 차액을 더 돌려주면 그만큼 다시 열린다
    await tx(shaped, 'refund', 20, '결과별 단가 차액 환불 (KAKAO 추가 20원, 누적 40원)');
    expect(await cost()).toBe(62);
  });
});

