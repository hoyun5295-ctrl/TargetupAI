/**
 * 차감 뒤 첫 적재 전에 멈춘 동기 발송 — 적재 0 고착을 영속 환불 의무로 넘긴다
 * (★ 2026-09-26 한줄로 V2 CRASH · F08·m053·m123 · R316 돈 부분 · Codex 1R ①② 구조 정정)
 *
 * 동기 발송 경로(AI 캠페인 · 직접발송 동기 · 브랜드 동기 · 예약 동기)는 [차감 커밋 → 큐 적재]다.
 * 그 사이에 멈추면 큐는 0건인데, 스위퍼 산식은 "처리 0 = 미적재 0"이라 그 차감을 영영 돌려주지 않았다.
 * 1차 처방(스위퍼가 직접 환불 → 성공하면 종결)은 Codex 1R에서 두 구멍이 나왔다:
 *   ① preparing 중화 뒤 환불이 실패하면 다음 사이클이 그 캠페인을 다시 보지 않는다(상태가 재시도 근거를 지웠다)
 *   ② 한 축만 환불하고도 종결할 수 있었다(다른 축 미경과·원장 해석 실패)
 * 구조 정정: 판정을 **전 축**으로 하고, 확인되면 한 트랜잭션에서 [실패 종결 + 실행 행 종결 + refundPending + 표식]을 커밋한다.
 *   갚는 것은 기존 재시도 워커(전 축 성공까지 백오프 · 만료 없음 · prepaidRefund 멱등). 스위퍼는 환불을 직접 하지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const CAMP = '66666666-6666-4666-8666-666666666666';
const HOUR = 60 * 60 * 1000;

const sqlLog: Array<{ sql: string; params: any[] }> = [];
const txLog: Array<{ sql: string; params: any[] }> = [];
const state = {
  camp: {} as Record<string, any>,
  dedByType: {} as Record<string, Array<{ amount: number; description: string; created_at?: Date | null }>>,
  counts: { total: 0, success: 0, fail: 0, pending: 0 } as any,
  rawCount: 0,
  locked: {} as Record<string, any>,
};

const queryMock = vi.fn(async (sql: string, params?: any[]) => {
  const s = String(sql);
  sqlLog.push({ sql: s, params: params || [] });
  if (s.includes('JOIN companies co ON co.id = c.company_id')) return { rows: [state.camp] };
  if (s.includes('FROM companies WHERE id = $1') && s.includes('cost_per_lms')) {
    return { rows: [{ unit_price_basis: 'vat_included', cost_per_sms: 11, cost_per_lms: 27.5, cost_per_mms: 60, cost_per_kakao: 8.8, cost_per_brand: 20, cost_per_brand_nonfriend: 20 }] };
  }
  if (s.includes("type = 'deduct'") && s.includes('SELECT amount, description, created_at FROM balance_transactions')) {
    return { rows: state.dedByType[String(params?.[2])] || [] };
  }
  return { rows: [], rowCount: 1 };
});
const client = {
  query: vi.fn(async (sql: string, params?: any[]) => {
    const s = String(sql).trim();
    txLog.push({ sql: s, params: params || [] });
    if (s.includes('FOR UPDATE')) return { rows: [state.locked] };
    return { rows: [], rowCount: 1 };
  }),
  release: vi.fn(),
};
vi.mock('../../config/database', () => ({
  default: { query: (...a: any[]) => (queryMock as any)(...a), connect: vi.fn(async () => client) },
  pool: { query: (...a: any[]) => (queryMock as any)(...a), connect: vi.fn(async () => client) },
  query: (...a: any[]) => (queryMock as any)(...a),
}));

const countAllMock = vi.fn(async (..._a: any[]) => state.rawCount);
const campaignTablesMock = vi.fn(async (..._a: any[]) => ['SMSQ_SEND_1', 'SMSQ_SEND_1_202607']);
vi.mock('../sms-queue', async () => ({
  // 축 조건은 실물(정산 축 분리와 같은 조건인지가 계약이다)
  smsMsgTypeScopeSql: ((await vi.importActual('../sms-queue')) as any).smsMsgTypeScopeSql,
  getCompanySmsTablesWithLogs: async () => ['SMSQ_SEND_1', 'SMSQ_SEND_1_202609'],
  getCampaignSmsTablesWide: (...a: any[]) => (campaignTablesMock as any)(...a),
  smsCampaignCountsSafe: async () => new Map([[state.camp.id, state.counts]]),
  smsAlimtalkResultAgg: async () => new Map(),
  smsCampaignSubRowCounts: async () => new Map(),
  smsCountAll: (...a: any[]) => (countAllMock as any)(...a),
}));

const refundMock = vi.fn(async (..._a: any[]) => ({ refunded: 275, ok: true }));
const reverseMock = vi.fn(async (..._a: any[]) => ({ reversed: 0, netRefundedAmt: 0, skipped: false }));
vi.mock('../prepaid', () => ({
  prepaidRefund: (...a: any[]) => (refundMock as any)(...a),
  prepaidReverseOverRefund: (...a: any[]) => (reverseMock as any)(...a),
  REFUND_KEYS: { NOT_LOADED: 'notloaded', FAIL: 'fail', CANCEL: 'cancel', TEST: 'test', KAKAO_DIFF: 'kakao_diff' },
}));
const alertMock = vi.fn(async (..._a: any[]) => undefined);
vi.mock('../system-alert', () => ({ sendSystemAlert: (...a: any[]) => (alertMock as any)(...a) }));
vi.mock('../company-memory', () => ({ recordCampaignLearning: async () => undefined }));
vi.mock('../sweep-cadence', () => ({ isSweepDue: () => true }));

import { runMysqlRefundSweepOnce } from '../mysql-refund-sweeper';
import { buildDeductDescription } from '../deduct-reference';
import { calcRefundParts, isZeroLoadShape, isDeductSettledForZeroLoad, ZERO_LOAD_SETTLE_MS } from '../refund-calc';

const UNITS = { KAKAO: 5.5, SMS: 11, LMS: 27.5 };
const lmsDed = (count: number, ago: number) => ({ amount: count * 27.5, description: buildDeductDescription('campaign', 'LMS', count, 27.5, 0, UNITS), created_at: new Date(Date.now() - ago) });
const brandDed = (count: number, ago: number) => ({ amount: count * 20, description: buildDeductDescription('campaign', 'BRAND', count, 20, 0, UNITS), created_at: new Date(Date.now() - ago) });

let seq = 0;
beforeEach(() => {
  seq++;
  state.camp = {
    id: `${CAMP.slice(0, -4)}${String(seq).padStart(4, '0')}`, company_id: 'c1', created_by: 'u1', message_type: 'LMS', send_channel: 'sms', send_type: 'direct',
    status: 'sending', success_count: 0, fail_count: 0, sent_count: 0, send_phase: null, zero_load_settled: false,
    send_base: new Date(Date.now() - 2 * HOUR),
  };
  state.dedByType = { LMS: [lmsDed(10, 2 * HOUR)] };
  state.counts = { total: 0, success: 0, fail: 0, pending: 0 };
  state.rawCount = 0;
  state.locked = { sc: {}, status: 'sending', send_phase: null, sent: 0 };
  sqlLog.length = 0; txLog.length = 0;
  refundMock.mockClear(); reverseMock.mockClear(); countAllMock.mockClear(); queryMock.mockClear(); client.query.mockClear(); alertMock.mockClear();
});

const settleUpdate = () => txLog.find((q) => q.sql.includes('UPDATE campaigns') && q.sql.includes("status = 'failed'"));
const runsUpdate = () => txLog.find((q) => q.sql.includes('UPDATE campaign_runs'));
const committed = () => txLog.some((q) => q.sql === 'COMMIT');

describe('순수 판정', () => {
  it('일반 산식은 종전 그대로(처리 0 = 미적재 0) — 고착은 산식이 아니라 의무 경로가 소유한다', () => {
    expect(calcRefundParts({ deductedCount: 10, sentCount: 0, mysqlSuccess: 0, mysqlFail: 0, mysqlPending: 0 }).notLoaded).toBe(0);
    expect(calcRefundParts({ deductedCount: 10, sentCount: 0, mysqlSuccess: 4, mysqlFail: 0, mysqlPending: 0 }).notLoaded).toBe(6);
  });

  it('고착 모양 = 동기 경로(또는 preparing) · sending/draft/failed · 적재 기록 0 · 집계 0 · 여정 아님 · 표식 없음', () => {
    const ok = { status: 'sending', sendPhase: null, sentCount: 0, mysqlTotal: 0, sendType: 'direct' };
    expect(isZeroLoadShape(ok)).toBe(true);
    expect(isZeroLoadShape({ ...ok, status: 'draft' })).toBe(true);
    expect(isZeroLoadShape({ ...ok, status: 'failed' })).toBe(true);
    expect(isZeroLoadShape({ ...ok, sendPhase: 'preparing' })).toBe(true);
    expect(isZeroLoadShape({ ...ok, status: 'completed' })).toBe(false);
    expect(isZeroLoadShape({ ...ok, sendPhase: 'queued' })).toBe(false);
    expect(isZeroLoadShape({ ...ok, sendPhase: 'failed' })).toBe(false);
    expect(isZeroLoadShape({ ...ok, sentCount: 1 })).toBe(false);
    expect(isZeroLoadShape({ ...ok, mysqlTotal: 1 })).toBe(false);
    expect(isZeroLoadShape({ ...ok, sendType: 'journey' })).toBe(false);
    expect(isZeroLoadShape({ ...ok, zeroLoadSettled: true })).toBe(false);
  });

  it('차감 행 전부가 30분 지나야 자리 잡은 차감이다', () => {
    const now = Date.now();
    expect(isDeductSettledForZeroLoad([{ created_at: new Date(now - ZERO_LOAD_SETTLE_MS - 1) }], now)).toBe(true);
    expect(isDeductSettledForZeroLoad([{ created_at: new Date(now - 5 * 60 * 1000) }], now)).toBe(false);
    expect(isDeductSettledForZeroLoad([{ created_at: null }], now)).toBe(false);
    expect(isDeductSettledForZeroLoad([], now)).toBe(false);
  });
});

describe('의무로 넘기기', () => {
  it('고착이면 한 트랜잭션에서 실패 종결 + 실행 행 종결 + refundPending + 표식 · 스위퍼는 직접 환불하지 않는다', async () => {
    await runMysqlRefundSweepOnce();
    expect(countAllMock).toHaveBeenCalledTimes(1);
    expect(refundMock).not.toHaveBeenCalled();
    const upd = settleUpdate()!;
    expect(upd).toBeTruthy();
    expect(upd.sql).toContain("'{zeroLoadSettled}'");
    expect(upd.sql).toContain("'{refundPending}'");
    const rp = JSON.parse(upd.params[1]);
    expect(rp).toMatchObject({ count: 10, messageType: 'LMS', refundKey: 'notloaded' });
    expect(runsUpdate()).toBeTruthy();
    expect(committed()).toBe(true);
  });

  it('both 캠페인은 두 축을 함께 넘긴다', async () => {
    state.camp = { ...state.camp, send_channel: 'both' };
    state.dedByType = { LMS: [lmsDed(10, 2 * HOUR)], BRAND: [brandDed(10, 2 * HOUR)] };
    await runMysqlRefundSweepOnce();
    const rp = JSON.parse(settleUpdate()!.params[1]);
    expect(rp).toMatchObject({ count: 10, messageType: 'LMS', refundKey: 'notloaded' });
    expect(rp.brand).toMatchObject({ count: 10, messageType: 'BRAND', refundKey: 'notloaded' });
  });

  it('② 한 축이라도 30분 전이면 아무것도 하지 않는다', async () => {
    state.camp = { ...state.camp, send_channel: 'both' };
    state.dedByType = { LMS: [lmsDed(10, 2 * HOUR)], BRAND: [brandDed(10, 5 * 60 * 1000)] };
    await runMysqlRefundSweepOnce();
    expect(countAllMock).not.toHaveBeenCalled();
    expect(settleUpdate()).toBeUndefined();
  });

  it('② 원장 설명을 되읽지 못하면 넘기지 않고 경보', async () => {
    state.dedByType = { LMS: [{ amount: 275, description: '알 수 없는 옛 형식', created_at: new Date(Date.now() - 2 * HOUR) }] };
    await runMysqlRefundSweepOnce();
    expect(settleUpdate()).toBeUndefined();
    expect(alertMock.mock.calls.some((c) => String(c[0]?.dedupKey || '').startsWith('zero-load-ledger-unresolved:'))).toBe(true);
  });

  it('원행이 하나라도 있으면 넘기지 않는다', async () => {
    state.rawCount = 3;
    await runMysqlRefundSweepOnce();
    expect(settleUpdate()).toBeUndefined();
  });

  it('워커 경로(queued)는 건드리지 않는다', async () => {
    state.camp = { ...state.camp, send_phase: 'queued' };
    await runMysqlRefundSweepOnce();
    expect(countAllMock).not.toHaveBeenCalled();
    expect(settleUpdate()).toBeUndefined();
  });

  it('① preparing은 같은 문장에서 send_phase를 failed로 — 상태와 의무가 한 커밋이라 사이에 멈춰도 의무가 남는다', async () => {
    state.camp = { ...state.camp, send_phase: 'preparing' };
    state.locked = { sc: {}, status: 'sending', send_phase: 'preparing', sent: 0 };
    await runMysqlRefundSweepOnce();
    const upd = settleUpdate()!;
    expect(upd.sql).toMatch(/send_phase = CASE WHEN send_phase = 'preparing' THEN 'failed' ELSE send_phase END/);
    expect(upd.sql).toContain("'{refundPending}'");
    expect(committed()).toBe(true);
  });

  it('잠근 뒤 모양이 바뀌었으면(그 사이 적재됨) 롤백', async () => {
    state.locked = { sc: {}, status: 'sending', send_phase: null, sent: 5 };
    await runMysqlRefundSweepOnce();
    expect(settleUpdate()).toBeUndefined();
    expect(txLog.some((q) => q.sql === 'ROLLBACK')).toBe(true);
  });

  it('기존 의무(브랜드 경로 markRefundPending)와 합친다 — 건수는 줄이지 않고 재시도 상태를 보존', async () => {
    state.locked = { sc: { refundPending: { count: 12, messageType: 'LMS', refundKey: 'notloaded', attempts: 2, nextAttemptAt: '2026-09-27T00:00:00Z' } }, status: 'sending', send_phase: null, sent: 0 };
    await runMysqlRefundSweepOnce();
    const rp = JSON.parse(settleUpdate()!.params[1]);
    expect(rp.count).toBe(12);
    expect(rp.attempts).toBe(2);
  });

  it('draft 고착(AI 발송 중 멈춤)은 넘긴다', async () => {
    state.camp = { ...state.camp, status: 'draft', send_type: 'ai' };
    state.locked = { sc: {}, status: 'draft', send_phase: null, sent: 0 };
    await runMysqlRefundSweepOnce();
    expect(settleUpdate()).toBeTruthy();
  });

  it('draft인데 적재 진행 중(부분 적재)이면 아무 정산도 하지 않는다', async () => {
    state.camp = { ...state.camp, status: 'draft', send_type: 'ai' };
    state.counts = { total: 4, success: 0, fail: 0, pending: 4 };
    await runMysqlRefundSweepOnce();
    expect(refundMock).not.toHaveBeenCalled();
    expect(reverseMock).not.toHaveBeenCalled();
    expect(settleUpdate()).toBeUndefined();
  });

  it('이미 넘긴 캠페인(표식)은 다시 세지 않는다', async () => {
    state.camp = { ...state.camp, status: 'failed', zero_load_settled: true };
    await runMysqlRefundSweepOnce();
    expect(countAllMock).not.toHaveBeenCalled();
  });

  it('후보에 실행 행이 발송 중인 draft 캠페인과 표식 칸이 들어간다', async () => {
    await runMysqlRefundSweepOnce();
    const cand = sqlLog.find((q) => q.sql.includes('JOIN companies co ON co.id = c.company_id'))!;
    expect(cand.sql).toMatch(/c\.status = 'draft'[\s\S]*campaign_runs[\s\S]*status = 'sending'/);
    expect(cand.sql).toContain("(c.send_config ? 'zeroLoadSettled') AS zero_load_settled");
  });
});

/**
 * ★ Codex 2R ② — 넘긴 뒤 늦게 들어온 동기 적재. 판정(원행 0) 뒤에 30분 넘게 멈췄던 동기 경로가 적재하면 보낸 캠페인을 환불한다.
 * preparing은 PG 울타리가 있다(활성화 UPDATE가 send_phase='preparing'을 조건으로 해 failed가 된 캠페인은 워커가 집지 않는다).
 * 동기 경로(send_phase 없음)는 MySQL에 바로 넣어 울타리가 없다 → 의무에 재확인 표식을 싣고, 재시도 워커가 **갚기 직전** 같은 문장으로 원행을 다시 센다.
 * 원행이 있으면 의무를 무효로 지운다(일반 정산이 차감 − 적재로 다시 잰다 · failed는 정산 대상). 갚은 뒤에 들어온 적재는 일반 정산의 초과 환불 회수(4-3)가 맞춘다.
 */
describe('재시도 직전 재확인 (Codex 2R ②)', () => {
  it('넘기는 의무에 재확인 표식을 싣는다', async () => {
    await runMysqlRefundSweepOnce();
    const rp = JSON.parse(settleUpdate()!.params[1]);
    expect(rp.verifyZeroLoad).toBe(true);
  });

  const CAMP_ROW = { id: 'camp-x', created_by: 'u1', send_config: { sentTables: ['SMSQ_SEND_1'] }, sent_at: null, scheduled_at: null, created_at: '2026-07-10T01:00:00Z' };

  it('축별로 센다 — 원행이 들어온 축만 알린다 · 셀 수 없음 = 미룬다 (Codex 3R ① both 한 축만 늦게 적재)', async () => {
    const { recheckZeroLoadObligation } = await import('../refund-pending');
    const BRAND_WHERE = "app_etc1 = ? AND msg_type = 'F'";
    const NONBRAND_WHERE = "app_etc1 = ? AND (msg_type IS NULL OR msg_type <> 'F')";
    try {
      countAllMock.mockImplementation(async (_t: any, where: any) => (String(where) === BRAND_WHERE ? 0 : 3));
      expect(await recheckZeroLoadObligation('c1', CAMP_ROW, ['LMS', 'BRAND'])).toEqual({ verdict: 'checked', loaded: ['LMS'] });
      const calls = countAllMock.mock.calls.map((c) => [c[0], c[1], c[2]]);
      expect(calls).toContainEqual([['SMSQ_SEND_1', 'SMSQ_SEND_1_202607'], NONBRAND_WHERE, ['camp-x']]);
      expect(calls).toContainEqual([['SMSQ_SEND_1', 'SMSQ_SEND_1_202607'], BRAND_WHERE, ['camp-x']]);
      countAllMock.mockImplementation(async () => 0);
      expect(await recheckZeroLoadObligation('c1', CAMP_ROW, ['LMS', 'BRAND'])).toEqual({ verdict: 'checked', loaded: [] });
      countAllMock.mockImplementation(async (_t: any, where: any) => (String(where) === BRAND_WHERE ? 1 : 0));
      expect(await recheckZeroLoadObligation('c1', CAMP_ROW, ['BRAND'])).toEqual({ verdict: 'checked', loaded: ['BRAND'] });
      countAllMock.mockImplementation(async () => { throw new Error('mysql down'); });
      expect((await recheckZeroLoadObligation('c1', CAMP_ROW, ['LMS'])).verdict).toBe('defer');
    } finally {
      countAllMock.mockImplementation(async () => state.rawCount);
    }
  });

  it('테이블은 그 캠페인의 발송월 기준으로 고른다(몇 달 뒤 재시도에도 그 달 이력을 본다 · Codex 4R ③)', async () => {
    const { recheckZeroLoadObligation } = await import('../refund-pending');
    campaignTablesMock.mockClear();
    await recheckZeroLoadObligation('c1', CAMP_ROW, ['LMS']);
    expect(campaignTablesMock).toHaveBeenCalledWith('c1', CAMP_ROW);
  });

  it('원행이 들어온 축을 의무에서 뺀다 — 주 슬롯이 빠지면 브랜드 슬롯이 올라오고 재시도 상태는 유지된다', async () => {
    const { dropRefundPendingAxes } = await import('../refund-pending');
    const rp = { count: 10, messageType: 'LMS', refundKey: 'notloaded', at: 'T', attempts: 3, nextAttemptAt: 'N', verifyZeroLoad: true,
      brand: { count: 7, messageType: 'BRAND' } };
    expect(dropRefundPendingAxes(rp, ['BRAND'])).toEqual({ count: 10, messageType: 'LMS', refundKey: 'notloaded', at: 'T', attempts: 3, nextAttemptAt: 'N', verifyZeroLoad: true });
    expect(dropRefundPendingAxes(rp, ['LMS'])).toEqual({ count: 7, messageType: 'BRAND', at: 'T', attempts: 3, nextAttemptAt: 'N', verifyZeroLoad: true });
    expect(dropRefundPendingAxes(rp, ['LMS', 'BRAND'])).toBeNull();
    expect(dropRefundPendingAxes({ count: 5, messageType: 'SMS', verifyZeroLoad: true }, ['SMS'])).toBeNull();
    expect(dropRefundPendingAxes(rp, [])).toEqual(rp);
  });

  it('스위퍼 판정과 재확인이 같은 계수 CT를 쓴다', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const sweeper = readFileSync(join(__dirname, '..', 'mysql-refund-sweeper.ts'), 'utf8');
    expect(sweeper).toContain('countZeroLoadRawRows(tables, camp.id)');
    expect(sweeper).not.toContain("smsCountAll(tables, 'app_etc1 = ?', [camp.id])");
  });

  it('재시도 워커는 표식이 있으면 환불 전에 축별로 재확인하고, 원행이 들어온 축은 의무에서 빼서 저장한다(CAS)', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const w = readFileSync(join(__dirname, '..', 'direct-send-worker.ts'), 'utf8');
    const body = w.slice(w.indexOf('async function retryPendingRefunds()'), w.indexOf('export async function runDirectSendOnce'));
    // 캠페인 발송월 기준 테이블을 고르는 데 필요한 칸
    expect(body).toMatch(/SELECT id, company_id, created_by, send_config, sent_at, scheduled_at, created_at, send_config->'refundPending' AS rp/);
    const iCheck = body.indexOf('if (rp.verifyZeroLoad === true) {');
    const iPay = body.indexOf('await prepaidRefund(');
    expect(iCheck).toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(iPay);
    const seg = body.slice(iCheck, iPay);
    expect(seg).toContain('recheckZeroLoadObligation(row.company_id, row, parts.map((p) => p.messageType))');
    expect(seg).toMatch(/verdict === 'defer'\) \{[^}]*await defer\(/);
    expect(seg).toContain('const rest = dropRefundPendingAxes(rp, check.loaded);');
    expect(seg).toMatch(/if \(!rest\) \{\s*await clear\(\);\s*continue;\s*\}/);
    // 빠진 축을 저장한다 — 읽은 기록 그대로일 때만(CAS) · 저장 뒤 다음 사이클이 남은 축을 다시 재확인하고 갚는다
    expect(seg).toMatch(/SET send_config = jsonb_set\(send_config, '\{refundPending\}', \$2::jsonb\)[\s\S]*WHERE id = \$1 AND send_config->'refundPending' = \$3::jsonb/);
    expect(seg).toContain('[row.id, JSON.stringify(rest), snapshot]');
    expect(body).toContain('for (const part of parts) {');
    expect(body).not.toContain('payParts');
  });
});
