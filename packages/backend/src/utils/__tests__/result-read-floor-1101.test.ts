/**
 * 정산 기준(본 적 있는 가장 큰 값) — B-1101-4 · 뿌리 R37 (★2026-11-01 · 설계서 docs/2026-11-01-result-read-shrink-guard-design.md)
 *
 * 1101 실측: .62 SMSQ_SEND_15 의 보조 인덱스가 본체와 어긋나 캠페인 742행 중 274행만 읽혔고, 정산 스위퍼 · 재대조가 그 숫자를
 * 진실로 받아 468건(12,097.8원)을 미적재로 환불할 뻔했다. 실제로는 늘기만 하는 수(적재 · 성공 · 대체 · 차액)를 읽기로 내리지 않는다.
 *
 * 못 박는 것(하네스 = mysql-refund-sweeper-alimtalk-0926 과 같은 모양)
 *   1. 1101 모양: 적재 742 · 읽기 274 → 미적재 환불 0 · 경보 문구 = 읽기 이상 · 성공 기준 기록.
 *   2. 성공 기준이 있으면 덜 읽힌 성공이 회수 한도를 키우지 않는다(행 기준 실패 환불의 넘친 몫을 그대로 거둔다).
 *   3. 분리 축(both) 축 적재 기준 · 4. 여정 알림톡 대체 기준(Codex 설계 2R #1) · 5. 차액 기준(3R #1) · 모호 회차 지급 0(4R #1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const CAMP = '66666666-6666-4666-8666-666666666666';
const UNITS = { KAKAO: 5.5, SMS: 11, LMS: 27.5 };

const state = {
  camp: {} as Record<string, any>,
  dedRows: [] as Array<{ amount: number; description: string; created_at?: Date }>,
  dedByType: null as null | Record<string, Array<{ amount: number; description: string; created_at?: Date }>>,
  counts: { total: 0, success: 0, fail: 0, pending: 0 } as Record<string, number>,
  scoped: {} as Record<string, Record<string, number>>,
  agg: undefined as any,
  sub: 0,
  reverseNet: 0,
  /** 기준 저장 결과(차례대로 · 비면 반영) — false = 세대 바뀜(0행) */
  persistOk: [] as boolean[],
};
const updates: Array<{ sql: string; params: any[] }> = [];

const queryMock = vi.fn(async (sql: string, params?: any[]) => {
  const s = String(sql);
  if (s.includes('JOIN companies co ON co.id = c.company_id')) return { rows: [state.camp] };
  if (s.includes('FROM companies WHERE id = $1') && s.includes('cost_per_lms')) {
    return { rows: [{ unit_price_basis: 'vat_included', cost_per_sms: 11, cost_per_lms: 27.5, cost_per_mms: 60, cost_per_kakao: 8.8, cost_per_brand: 20, cost_per_brand_nonfriend: 20 }] };
  }
  if (s.includes("type = 'deduct'") && s.includes('SELECT amount, description, created_at FROM balance_transactions')) {
    if (state.dedByType) return { rows: state.dedByType[String(params?.[2])] || [] };
    return { rows: state.dedRows };
  }
  if (/^\s*UPDATE campaigns/.test(s)) {
    updates.push({ sql: s, params: params || [] });
    if (s.includes("'{readHigh}'")) return { rows: [], rowCount: state.persistOk.length ? (state.persistOk.shift() ? 1 : 0) : 1 };
    return { rows: [], rowCount: 1 };
  }
  return { rows: [] };
});
vi.mock('../../config/database', () => ({
  default: { query: (...a: any[]) => (queryMock as any)(...a), connect: vi.fn(async () => ({ query: async () => ({ rows: [] }), release: () => undefined })) },
  query: (...a: any[]) => (queryMock as any)(...a),
}));

const resultAgg = vi.fn(async () => new Map(state.agg ? [[CAMP, state.agg]] : []));
vi.mock('../sms-queue', () => ({
  getCompanySmsTablesWithLogs: async () => ['SMSQ_SEND_15'],
  smsCampaignCountsSafe: async (_t: string[], _ids: any[], _g?: string, scope?: string) =>
    new Map([[CAMP, scope && scope !== 'all' ? state.scoped[scope] : state.counts]]),
  smsAlimtalkResultAgg: (...a: any[]) => (resultAgg as any)(...a),
  smsCampaignSubRowCounts: async () => new Map<string, number>(state.sub ? [[CAMP, state.sub]] : []),
}));

const refundMock = vi.fn(async (..._a: any[]) => ({ refunded: 0, ok: true }));
const reverseMock = vi.fn(async (..._a: any[]) => ({ reversed: 0, netRefundedAmt: state.reverseNet, skipped: false }));
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
import { parseReadHigh, mergeReadHigh, readHighGrew } from '../refund-calc';

const keyCalls = (k: string) => refundMock.mock.calls.filter((c) => c[6]?.refundKey === k);
const invariantAlerts = () => alertMock.mock.calls.filter((c) => String(c[0]?.dedupKey || '').startsWith('refund-invariant:'));
const readHighWrites = () => updates.filter((u) => u.sql.includes("'{readHigh}'"));

beforeEach(() => {
  state.dedByType = null;
  state.scoped = {};
  state.agg = undefined;
  state.sub = 0;
  state.persistOk = [];
  updates.length = 0;
  resultAgg.mockClear(); refundMock.mockClear(); reverseMock.mockClear(); alertMock.mockClear(); queryMock.mockClear();
});

describe('R37 기준 CT(순수)', () => {
  it('못 읽는 값은 0 · 얹기 = 칸마다 큰 값 · 커졌을 때만 기록', () => {
    const prev = parseReadHigh({ success: '733', sub: 'x', unitDiff: -3, brandLoaded: null });
    expect(prev).toEqual({ success: 733, sub: 0, unitDiff: 0, brandLoaded: 0, brandSuccess: 0, nonBrandLoaded: 0, nonBrandSuccess: 0 });
    const next = mergeReadHigh(prev, { success: 274, unitDiff: 88.456, sub: 3 });
    expect(next.success).toBe(733);
    expect(next.unitDiff).toBe(88.46);
    expect(next.sub).toBe(3);
    expect(readHighGrew(prev, next)).toBe(true);
    expect(readHighGrew(next, mergeReadHigh(next, { success: 10 }))).toBe(false);
  });
});

describe('정산 스위퍼 — 1101 모양(적재 742 · 읽기 274)', () => {
  beforeEach(() => {
    state.camp = {
      id: CAMP, company_id: 'c1', created_by: 'u1', message_type: 'LMS', send_channel: 'sms', send_type: 'direct', status: 'completed',
      success_count: 274, fail_count: 0, sent_count: 742, send_phase: 'sent', send_base: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000), read_high: null,
    };
    state.dedRows = [{ amount: 19180.7, description: buildDeductDescription('campaign', 'LMS', 742, 25.85) }];
    state.counts = { total: 274, success: 274, fail: 0, pending: 0 };
    state.reverseNet = 232.65;   // 실패 9건 × 25.85 환불 끝
  });

  it('미적재 · 실패 환불 0 · 회수 한도 = 742 − 274(기준 없음) · 경보 문구 = 읽기 이상 · 성공 기준 274 기록', async () => {
    await runMysqlRefundSweepOnce();
    expect(keyCalls('notloaded')).toHaveLength(0);
    expect(keyCalls('fail')).toHaveLength(0);
    expect(reverseMock).toHaveBeenCalledWith('c1', 468, 'LMS', CAMP, 0, 'campaign');
    expect(invariantAlerts()).toHaveLength(1);
    expect(String(invariantAlerts()[0][0].message)).toContain('결과 행 일부가 안 읽힘');
    expect(String(invariantAlerts()[0][0].message)).not.toContain('미환불 의심');
    expect(readHighWrites()).toHaveLength(1);
    expect(readHighWrites()[0].params.slice(0, 2)).toEqual([CAMP, 274]);
    // 화면 숫자 갱신(4-1)은 적재 수를 올리기만 한다(GREATEST) · 낮추는 쓰기 0
    expect(updates.some((u) => /sent_count\s*=\s*\$/.test(u.sql))).toBe(false);
  });

  it('성공 기준 733 이 있으면 회수 한도 = 9(덜 읽힌 성공이 한도를 키우지 않는다) · 불변식 균형 = 경보 0 · 기록 0', async () => {
    state.camp.read_high = { success: 733 };
    await runMysqlRefundSweepOnce();
    expect(reverseMock).toHaveBeenCalledWith('c1', 9, 'LMS', CAMP, 0, 'campaign');
    expect(invariantAlerts()).toHaveLength(0);
    expect(readHighWrites()).toHaveLength(0);
  });

  it('회귀 — 읽기가 정상(742 · 733/9)이면 종전과 같은 호출 · 기준만 올림', async () => {
    state.counts = { total: 742, success: 733, fail: 9, pending: 0 };
    await runMysqlRefundSweepOnce();
    expect(keyCalls('notloaded')).toHaveLength(0);
    expect(keyCalls('fail')[0][1]).toBe(9);
    expect(reverseMock).toHaveBeenCalledWith('c1', 9, 'LMS', CAMP, 0, 'campaign');
    expect(invariantAlerts()).toHaveLength(0);
    expect(readHighWrites()[0].params[1]).toBe(733);
  });
});

describe('정산 스위퍼 — 분리 축(both) 축 적재 기준(Codex 설계 1R #1)', () => {
  beforeEach(() => {
    state.camp = {
      id: CAMP, company_id: 'c1', created_by: 'u1', message_type: 'LMS', send_channel: 'both', send_type: 'direct', status: 'completed',
      success_count: 130, fail_count: 0, sent_count: 100, send_phase: 'sent', send_base: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      read_high: { success: 200, brandLoaded: 100, brandSuccess: 100, nonBrandLoaded: 100, nonBrandSuccess: 100 },
    };
    state.dedByType = {
      BRAND: [{ amount: 2000, description: buildDeductDescription('campaign', 'BRAND', 100, 20) }],
      LMS: [{ amount: 2750, description: buildDeductDescription('campaign', 'LMS', 100, 27.5) }],
    };
    state.counts = { total: 130, success: 130, fail: 0, pending: 0 };
    state.scoped = { brand: { total: 30, success: 30, fail: 0, pending: 0 }, nonBrand: { total: 100, success: 100, fail: 0, pending: 0 } };
    state.reverseNet = 0;
  });

  it('브랜드 70행이 안 읽혀도 브랜드 축 미적재 환불 0 · 회수 한도 = 0 · 경보 문구 = 읽기 이상', async () => {
    await runMysqlRefundSweepOnce();
    expect(keyCalls('notloaded')).toHaveLength(0);
    const brandRev = reverseMock.mock.calls.find((c) => c[2] === 'BRAND');
    expect(brandRev?.[1]).toBe(0);
    const brandAlert = invariantAlerts().find((c) => String(c[0].dedupKey).endsWith(':BRAND'));
    expect(brandAlert).toBeUndefined();   // 성공 기준 100 → 브랜드 축 균형(기준 없으면 70건 미환불 · 미적재 환불)
  });

  it('기준이 없던 첫 주기는 이번 읽기로 기준을 기록한다(분리 축 포함)', async () => {
    state.camp.read_high = null;
    state.scoped.brand = { total: 100, success: 100, fail: 0, pending: 0 };
    state.counts = { total: 200, success: 200, fail: 0, pending: 0 };
    await runMysqlRefundSweepOnce();
    expect(readHighWrites()).toHaveLength(1);
    // [id, success, sub, unitDiff, brandLoaded, brandSuccess, nonBrandLoaded, nonBrandSuccess, 세대]
    expect(readHighWrites()[0].params).toEqual([CAMP, 200, 0, 0, 100, 100, 100, 100, 0]);
  });

  it('Codex 구현 1R #2 — 뒤 원장 조회가 실패해도 이번에 본 기준 증가(브랜드 100)는 먼저 남는다', async () => {
    state.camp.read_high = { success: 100, brandLoaded: 50, brandSuccess: 50, nonBrandLoaded: 100, nonBrandSuccess: 100 };
    state.scoped.brand = { total: 100, success: 100, fail: 0, pending: 0 };
    state.counts = { total: 200, success: 200, fail: 0, pending: 0 };
    state.dedByType = new Proxy({}, { get: () => { throw new Error('원장 조회 실패(시험)'); } }) as any;
    await runMysqlRefundSweepOnce();
    expect(readHighWrites()).toHaveLength(1);
    expect(readHighWrites()[0].params.slice(4, 6)).toEqual([100, 100]);
  });

  it('Codex 구현 1R #1 — 기준 · 화면 숫자 쓰기는 집계 전에 읽은 세대를 조건으로 건다(취소 정산이 끼면 0행)', async () => {
    state.camp.read_high = null;
    state.camp.read_high_gen = 3;
    state.counts = { total: 200, success: 200, fail: 0, pending: 0 };
    state.scoped.brand = { total: 100, success: 100, fail: 0, pending: 0 };
    await runMysqlRefundSweepOnce();
    expect(readHighWrites()[0].sql).toMatch(/readHighGen[\s\S]*= \$9::int/);
    expect(readHighWrites()[0].params[8]).toBe(3);
    const countWrite = updates.find((u) => u.sql.includes('SET success_count = $1'));
    expect(countWrite?.sql).toMatch(/readHighGen[\s\S]*= \$5::int/);
    expect(countWrite?.params[4]).toBe(3);
  });
});

describe('정산 스위퍼 — 여정 알림톡 대체 기준(Codex 설계 2R #1)', () => {
  beforeEach(() => {
    state.camp = {
      id: CAMP, company_id: 'c1', created_by: 'u1', message_type: 'KAKAO', send_channel: 'alimtalk', send_type: 'journey', status: 'completed',
      journey_ledger: true, success_count: 10, fail_count: 100, sent_count: 100, send_phase: 'sent',
      send_base: new Date(Date.now() - 36 * 60 * 60 * 1000), read_high: { success: 100, sub: 100 },
    };
    state.dedRows = Array.from({ length: 100 }, () => ({ amount: 8.8, description: '[여정 발송] KAKAO 1건 발송 차감 (건당 8.8원)', created_at: new Date(Date.now() - 2 * 60 * 60 * 1000) }));
    // K 실패 100 + LMS 대체 성공 100 중 대체 90행이 안 읽힘
    state.counts = { total: 110, success: 10, fail: 100, pending: 0 };
    state.sub = 10;
    state.reverseNet = 0;
  });

  it('대체 기준 100 → 실패 − 대체 = 0 · 여정 환불 목표 0', async () => {
    await runMysqlRefundSweepOnce();
    const journeyCalls = refundMock.mock.calls.filter((c) => c[6]?.netTargetCount !== undefined);
    expect(journeyCalls.every((c) => c[6].netTargetCount === 0)).toBe(true);
  });
});

describe('정산 스위퍼 — 알림톡 결과별 차액 기준(Codex 설계 3R #1 · 4R #1)', () => {
  beforeEach(() => {
    state.camp = {
      id: CAMP, company_id: 'c1', created_by: 'u1', message_type: 'LMS', send_channel: 'alimtalk', send_type: 'direct', status: 'completed',
      success_count: 6, fail_count: 2, sent_count: 6, send_phase: 'sent', send_base: new Date(Date.now() - 60 * 60 * 1000), read_high: null,
    };
    state.dedRows = [{ amount: 165, description: buildDeductDescription('campaign', 'LMS', 6, 27.5, 0, UNITS) }];
    state.counts = { total: 8, success: 6, fail: 2, pending: 0 };
    state.agg = { kakao: 4, inRowSms: 0, inRowLms: 0, subSms: 0, subLms: 2, sub: 2 };
    state.reverseNet = 88;
  });

  it('정상 회차: 차액 88 지급 · 기준 88 기록', async () => {
    await runMysqlRefundSweepOnce();
    expect(keyCalls('kakao_diff')[0][6]).toEqual({ refundKey: 'kakao_diff', targetAmount: 88 });
    // 건수 기준(성공 6)은 돈 계산 전 · 차액 기준(88)은 지급 전에 따로 남긴다(Codex 구현 1R #2)
    expect(readHighWrites().map((w) => w.params[3])).toEqual([0, 88]);
  });

  it('알림톡 성공이 덜 읽혀도(4 → 1) 지급 목표 · 회수 한도의 차액 = 기준 88(정당한 차액을 회수하지 않음)', async () => {
    state.camp.read_high = { success: 6, unitDiff: 88 };
    state.counts = { total: 5, success: 3, fail: 2, pending: 0 };
    state.agg = { kakao: 1, inRowSms: 0, inRowLms: 0, subSms: 0, subLms: 2, sub: 2 };
    await runMysqlRefundSweepOnce();
    expect(keyCalls('kakao_diff')[0][6]).toEqual({ refundKey: 'kakao_diff', targetAmount: 88 });
    expect(reverseMock).toHaveBeenCalledWith('c1', 0, 'LMS', CAMP, 88, 'campaign');
  });

  it('Codex 구현 2R — 건수 저장 뒤 차액 저장이 거절되면(세대 바뀜 · 0행) 차액 지급 · 회수 · 불변식을 이번 주기에 하지 않는다', async () => {
    state.persistOk = [true, false];
    await runMysqlRefundSweepOnce();
    expect(readHighWrites()).toHaveLength(2);
    expect(keyCalls('kakao_diff')).toHaveLength(0);
    expect(reverseMock).not.toHaveBeenCalled();
    expect(invariantAlerts()).toHaveLength(0);
  });

  it('Codex 구현 2R — 첫 기준 저장이 거절되면 그 캠페인은 이번 주기 돈 계산 0', async () => {
    state.persistOk = [false];
    await runMysqlRefundSweepOnce();
    expect(refundMock).not.toHaveBeenCalled();
    expect(reverseMock).not.toHaveBeenCalled();
  });

  it('모호 회차(K행 대체 코드 + 대체 행): 기준이 있어도 새 지급 0 · 회수 한도에는 기준 88', async () => {
    state.camp.read_high = { success: 6, unitDiff: 88 };
    state.agg = { kakao: 4, inRowSms: 1, inRowLms: 0, subSms: 1, subLms: 0, sub: 1 };
    await runMysqlRefundSweepOnce();
    expect(keyCalls('kakao_diff')).toHaveLength(0);
    expect(reverseMock).toHaveBeenCalledWith('c1', 0, 'LMS', CAMP, 88, 'campaign');
  });
});
