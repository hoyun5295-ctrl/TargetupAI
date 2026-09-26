/**
 * 취소 결말 판정 CT (★2026-09-26 한줄로 V2 F35 · Codex 4차 1R high A)
 *
 * 옛 취소는 **삭제 전에 센 대기 수**로 환불하고 결과와 무관하게 'cancelled'로 확정했다. 예약 시각이 지난 뒤에는
 * 세고 지우는 사이에 Agent가 행을 집어 갈 수 있어, 나간 행까지 환불되고(과환불) 상태가 cancelled라 청구·정산에서 빠졌다.
 * 대기 행을 지운 **뒤**에는 새로 집힐 행이 없으므로, 그때 사실로 결말을 가른다.
 *
 * 못 박는 것
 *   1. 행이 하나라도 대기를 떠났다(라이브 비대기 + 이력) = 발송 캠페인이다 — 취소로 표시하지 않고 completed + 적재 수 = 남은 행 실측.
 *      환불은 여기서 하지 않는다(정산 스위퍼가 막은 몫 = 미적재 · 실패 · 초과 회수를 한 원장으로 맞춘다 — 두 곳이 주면 이중 지급).
 *   2. 아무것도 나가지 않았다 = 취소 확정(예약·초안일 때만 상태를 바꾼다) → 축마다 캠페인 전체 기준(차감 − 남는 행) CANCEL 환불.
 *   3. 발송 중·완료 상태인데 나간 행이 0이면 모순 — 돈을 움직이지 않고 경보만(재시도 의무는 남는다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const CAMP = '77777777-7777-4777-8777-777777777777';
const state = {
  started: 0,
  counts: {
    all: { total: 0, success: 0, fail: 0, pending: 0 },
    brand: { total: 0, success: 0, fail: 0, pending: 0 },
    nonBrand: { total: 0, success: 0, fail: 0, pending: 0 },
  } as Record<string, { total: number; success: number; fail: number; pending: number }>,
  refundOk: true,
  refundAmount: 110,
};

const queryMock = vi.fn(async (_sql: string, _params?: any[]) => ({ rows: [], rowCount: 1 }));
vi.mock('../../config/database', () => ({
  default: { query: (...a: any[]) => (queryMock as any)(...a) },
  query: (...a: any[]) => (queryMock as any)(...a),
}));

const countAll = vi.fn(async (_t: string[], _w: string, _p: any[]) => state.started);
const countsSafe = vi.fn(async (_t: string[], ids: any[], _g?: string, scope: string = 'all') =>
  new Map([[String(ids[0]), state.counts[scope]]]));
vi.mock('../sms-queue', () => ({
  getCampaignSmsTables: async (_c: string, d: Date, _u: string | undefined, cfg: any) =>
    [...(cfg?.sentTables || []), `SMSQ_SEND_1_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`],
  smsCountAll: (...a: any[]) => (countAll as any)(...a),
  smsCampaignCountsSafe: (...a: any[]) => (countsSafe as any)(...a),
}));

const refundMock = vi.fn(async (..._a: any[]) => ({ refunded: state.refundOk ? state.refundAmount : 0, ok: state.refundOk }));
vi.mock('../prepaid', () => ({
  prepaidRefund: (...a: any[]) => (refundMock as any)(...a),
  REFUND_KEYS: { NOT_LOADED: 'notloaded', FAIL: 'fail', CANCEL: 'cancel', TEST: 'test', KAKAO_DIFF: 'kakao_diff' },
}));

const alertMock = vi.fn(async (_x: any) => undefined);
vi.mock('../system-alert', () => ({ sendSystemAlert: (...a: any[]) => (alertMock as any)(...a) }));

import { settleCancelOutcome, campaignRefDates, countCampaignStartedRows } from '../cancel-settle';

const baseCamp = () => ({
  id: CAMP, company_id: 'co-1', created_by: 'u-1', status: 'scheduled',
  send_channel: 'sms', message_type: 'SMS',
  created_at: new Date('2026-09-20T01:00:00Z'), scheduled_at: new Date('2026-09-26T01:00:00Z'),
});
const zero = { total: 0, success: 0, fail: 0, pending: 0 };

beforeEach(() => {
  queryMock.mockClear(); countAll.mockClear(); countsSafe.mockClear(); refundMock.mockClear(); alertMock.mockClear();
  state.started = 0;
  state.counts = { all: { ...zero }, brand: { ...zero }, nonBrand: { ...zero } };
  state.refundOk = true;
  state.refundAmount = 110;
});

const sqls = () => queryMock.mock.calls.map((c) => String(c[0]));

describe('countCampaignStartedRows — 대기를 떠난 행(라이브 비대기 + 이력)', () => {
  it('발송 당시 라이브 테이블과 기준월 이력 테이블을 함께 본다', async () => {
    state.started = 2;
    const n = await countCampaignStartedRows('co-1', 'u-1', CAMP, ['SMSQ_SEND_1'], campaignRefDates(baseCamp()));
    expect(n).toBe(2);
    const [tables, where, params] = countAll.mock.calls[0];
    expect(tables).toContain('SMSQ_SEND_1');
    expect(tables).toContain('SMSQ_SEND_1_202609');
    expect(where).toBe('app_etc1 = ? AND status_code != 100');
    expect(params).toEqual([CAMP]);
  });
});

describe('settleCancelOutcome — 나간 행이 있으면 발송 캠페인으로 넘긴다', () => {
  it('적재 수 = 남은 행 실측(상태가 먼저 completed로 바뀌었어도) · 예약·초안이면 completed로 · 취소된 행은 건드리지 않음 · 환불하지 않는다', async () => {
    state.started = 3;
    state.counts.all = { total: 3, success: 2, fail: 1, pending: 0 };
    const r = await settleCancelOutcome({ camp: baseCamp(), liveTables: ['SMSQ_SEND_1'], refDates: campaignRefDates(baseCamp()) });
    expect(r).toEqual({ outcome: 'sent', ok: true, refunded: 0 });
    const i = sqls().findIndex((s) => s.includes("THEN 'completed' ELSE status END"));
    expect(i).toBeGreaterThan(-1);
    expect(sqls()[i]).toContain("status = CASE WHEN status IN ('scheduled', 'draft') THEN 'completed' ELSE status END");
    expect(sqls()[i]).toMatch(/WHERE id = \$\d AND status <> 'cancelled'/);
    const params = queryMock.mock.calls[i][1] as any[];
    expect(params).toContain(3);   // sent_count = 남은 행
    expect(sqls().some((s) => s.includes("status = 'cancelled'"))).toBe(false);
    expect(refundMock).not.toHaveBeenCalled();
  });
});

describe('settleCancelOutcome — 발송 캠페인 결말이 반영되지 않으면', () => {
  it('반영 0행(취소로 굳은 캠페인에 나간 행) = ok=false + 경보(의무 유지)', async () => {
    state.started = 1;
    state.counts.all = { total: 1, success: 1, fail: 0, pending: 0 };
    queryMock.mockImplementationOnce(async () => ({ rows: [], rowCount: 0 }));
    const r = await settleCancelOutcome({ camp: { ...baseCamp(), status: 'cancelled' }, liveTables: ['SMSQ_SEND_1'], refDates: campaignRefDates(baseCamp()) });
    expect(r.outcome).toBe('sent');
    expect(r.ok).toBe(false);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(refundMock).not.toHaveBeenCalled();
  });
});

describe('settleCancelOutcome — 아무것도 나가지 않았으면 취소 확정 + 전체 기준 환불', () => {
  it('상태 cancelled(예약·초안만) · 실행 행 cancelled · CANCEL 항아리 keepCount = 남는 행', async () => {
    const r = await settleCancelOutcome({
      camp: baseCamp(), liveTables: ['SMSQ_SEND_1'], refDates: campaignRefDates(baseCamp()),
      cancel: { cancelledBy: 'u-9', cancelledByType: 'company_user', reason: '고객 요청' },
    });
    expect(r).toEqual({ outcome: 'cancelled', ok: true, refunded: 110 });
    const iUpd = sqls().findIndex((s) => s.includes("status = 'cancelled'") && s.includes('UPDATE campaigns SET'));
    expect(iUpd).toBeGreaterThan(-1);
    expect(sqls()[iUpd]).toMatch(/WHERE id = \$4 AND status <> 'cancelled'/);
    expect(queryMock.mock.calls[iUpd][1]).toEqual(expect.arrayContaining(['u-9', 'company_user', '고객 요청', CAMP]));
    expect(sqls().some((s) => s.includes('UPDATE campaign_runs') && s.includes("status = 'cancelled'"))).toBe(true);
    // 상태를 먼저 확정하고 환불한다(환불이 실패해도 재시도 워커가 같은 결말로 다시 정산한다)
    expect(refundMock).toHaveBeenCalledTimes(1);
    const a = refundMock.mock.calls[0];
    expect(a[0]).toBe('co-1');
    expect(a[1]).toBe(0);
    expect(a[2]).toBe('SMS');
    expect(a[3]).toBe(CAMP);
    expect(a[5]).toBe('campaign');
    expect(a[6]).toEqual({ refundKey: 'cancel', keepCount: 0 });
  });

  it('both = 문자·브랜드 두 축을 각자 남는 행 기준으로', async () => {
    const camp = { ...baseCamp(), send_channel: 'both', message_type: 'LMS' };
    await settleCancelOutcome({ camp, liveTables: ['SMSQ_SEND_1'], refDates: campaignRefDates(camp) });
    expect(refundMock.mock.calls.map((c) => c[2])).toEqual(['LMS', 'BRAND']);
    const scopes = countsSafe.mock.calls.map((c) => c[3]);
    expect(scopes).toEqual(expect.arrayContaining(['nonBrand', 'brand']));
  });

  it('환불이 끝나지 않으면 ok=false(재시도 의무 유지)', async () => {
    state.refundOk = false;
    const r = await settleCancelOutcome({ camp: baseCamp(), liveTables: ['SMSQ_SEND_1'], refDates: campaignRefDates(baseCamp()) });
    expect(r.outcome).toBe('cancelled');
    expect(r.ok).toBe(false);
  });

  it('이미 취소·실패로 굳은 캠페인도 환불은 한다', async () => {
    const r = await settleCancelOutcome({ camp: { ...baseCamp(), status: 'failed' }, liveTables: ['SMSQ_SEND_1'], refDates: campaignRefDates(baseCamp()) });
    expect(r.outcome).toBe('cancelled');
    expect(refundMock).toHaveBeenCalledTimes(1);
  });
});

describe('settleCancelOutcome — 동기화가 대기 행만 보고 completed로 만든 캠페인 (Codex 4차 3R)', () => {
  it('나간 행이 0이면 취소로 바로잡고 전체 기준 환불(스위퍼는 취소를 보지 않는다 · 차감 상한이 이중 지급을 막는다)', async () => {
    const r = await settleCancelOutcome({ camp: { ...baseCamp(), status: 'completed' }, liveTables: ['SMSQ_SEND_1'], refDates: campaignRefDates(baseCamp()) });
    expect(r).toEqual({ outcome: 'cancelled', ok: true, refunded: 110 });
    expect(sqls().some((s) => s.includes("status = 'cancelled'") && s.includes("status <> 'cancelled'"))).toBe(true);
    expect(refundMock).toHaveBeenCalledTimes(1);
    expect(alertMock).not.toHaveBeenCalled();
  });
});
