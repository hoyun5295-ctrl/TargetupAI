/**
 * 정산 스위퍼 — 선불 알림톡 결과별 정산 배선 (★2026-09-26 한줄로 V2 F01·F04)
 *
 * 못 박는 것
 *   1. 차감 행에 결과별 단가가 실린 캠페인만 결과별 집계를 한 번 더 조회한다(다른 캠페인은 조회·동작 불변 = 부하 0).
 *   2. 차액은 KAKAO_DIFF 항아리에 금액 목표로 돌려준다 · 실패·미적재 환불은 종전 그대로(행 기준).
 *      행 기준을 바꾸지 않는 이유: sent_count가 대체 행까지 센 적재수로 올라가 있어, 실패만 수신자 기준으로 바꾸면
 *      미적재가 줄어 미환불이 난다. 행 기준 실패 + 미적재 합은 정당 환불 건수와 같고, 넘친 몫은 회수가 맞춘다.
 *   3. 초과 환불 회수는 차액을 정당 환불로 더해서 잰다 — 빼먹으면 30분 뒤 차액을 다시 빼간다.
 *   4. 불변식 감시도 차액을 정당 환불로 본다(균형이면 경보 없음).
 *   5. K행 대체 코드와 대체 행이 한 캠페인에 같이 있으면 차액을 돌려주지 않고 경보만 낸다(추측 금지).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const CAMP = '55555555-5555-4555-8555-555555555555';
const UNITS = { KAKAO: 5.5, SMS: 11, LMS: 27.5 };

const state = {
  camp: {} as Record<string, any>,
  dedRows: [] as Array<{ amount: number; description: string }>,
  counts: { total: 8, success: 6, fail: 2, pending: 0 },
  agg: undefined as any,
  reverseNet: 0,
};

const queryMock = vi.fn(async (sql: string, _params?: any[]) => {
  const s = String(sql);
  if (s.includes('JOIN companies co ON co.id = c.company_id')) return { rows: [state.camp] };
  if (s.includes("type = 'deduct'") && s.includes('SELECT amount, description, created_at FROM balance_transactions')) return { rows: state.dedRows };
  return { rows: [] };
});
vi.mock('../../config/database', () => ({
  default: { query: (...a: any[]) => (queryMock as any)(...a), connect: vi.fn(async () => ({ query: async () => ({ rows: [] }), release: () => undefined })) },
  query: (...a: any[]) => (queryMock as any)(...a),
}));

const resultAgg = vi.fn(async () => new Map(state.agg ? [[CAMP, state.agg]] : []));
vi.mock('../sms-queue', () => ({
  getCompanySmsTablesWithLogs: async () => ['SMSQ_SEND_1', 'SMSQ_SEND_1_202609'],
  smsCampaignCountsSafe: async () => new Map([[CAMP, state.counts]]),
  smsAlimtalkResultAgg: (...a: any[]) => (resultAgg as any)(...a),
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

beforeEach(() => {
  state.camp = {
    id: CAMP, company_id: 'c1', created_by: 'u1', message_type: 'LMS', send_channel: 'alimtalk',
    success_count: 6, fail_count: 2, sent_count: 6, send_phase: 'sent', send_base: new Date(Date.now() - 60 * 60 * 1000),
  };
  // LMS 6건 × 27.5원 = 165원 차감(결과별 단가 실림)
  state.dedRows = [{ amount: 165, description: buildDeductDescription('campaign', 'LMS', 6, 27.5, 0, UNITS) }];
  // c617 운영 실측 모양: K 1800×4 · K 7300×2 + 대체 L 1000×2
  state.counts = { total: 8, success: 6, fail: 2, pending: 0 };
  state.agg = { kakao: 4, inRowSms: 0, inRowLms: 0, subSms: 0, subLms: 2, sub: 2 };
  state.reverseNet = 88;
  resultAgg.mockClear(); refundMock.mockClear(); reverseMock.mockClear(); alertMock.mockClear(); queryMock.mockClear();
});

const diffCalls = () => refundMock.mock.calls.filter((c) => c[6]?.refundKey === 'kakao_diff');
const failCalls = () => refundMock.mock.calls.filter((c) => c[6]?.refundKey === 'fail');
const invariantAlerts = () => alertMock.mock.calls.filter((c) => String(c[0]?.dedupKey || '').startsWith('refund-invariant:'));

describe('정산 스위퍼 — 선불 알림톡 결과별 정산', () => {
  it('결과별 단가가 실린 캠페인: 차액 88원(알림톡 4 × 22)을 금액 목표로 돌려주고 회수 한도에 더한다', async () => {
    await runMysqlRefundSweepOnce();
    expect(resultAgg).toHaveBeenCalledTimes(1);
    expect(diffCalls()).toHaveLength(1);
    expect(diffCalls()[0].slice(0, 6)).toEqual(['c1', 0, 'LMS', CAMP, '알림톡 결과별 단가 차액 환불', 'campaign']);
    expect(diffCalls()[0][6]).toEqual({ refundKey: 'kakao_diff', targetAmount: 88 });
    // 실패 환불은 종전(행 기준) 그대로
    expect(failCalls()[0][1]).toBe(2);
    // 회수 한도 = 0건 × 단가 + 차액 88원
    expect(reverseMock).toHaveBeenCalledWith('c1', 0, 'LMS', CAMP, 88, 'campaign');
    expect(invariantAlerts()).toHaveLength(0);
  });

  it('차액을 못 돌려줬으면(순환불 0) 불변식 경보가 미환불로 뜬다', async () => {
    state.reverseNet = 0;
    await runMysqlRefundSweepOnce();
    expect(invariantAlerts()).toHaveLength(1);
    expect(String(invariantAlerts()[0][0].message)).toContain('미환불');
  });

  it('결과별 단가가 없는 캠페인(옛 차감·문자 발송)은 결과별 집계를 조회하지 않고 종전과 같다', async () => {
    state.dedRows = [{ amount: 165, description: buildDeductDescription('campaign', 'LMS', 6, 27.5) }];
    state.reverseNet = 0;
    await runMysqlRefundSweepOnce();
    expect(resultAgg).not.toHaveBeenCalled();
    expect(diffCalls()).toHaveLength(0);
    expect(reverseMock).toHaveBeenCalledWith('c1', 0, 'LMS', CAMP, 0, 'campaign');
    expect(invariantAlerts()).toHaveLength(0);
  });

  it('K행 대체 코드와 대체 행이 같이 있으면 차액을 돌려주지 않고 경보만 낸다', async () => {
    state.agg = { kakao: 4, inRowSms: 1, inRowLms: 0, subSms: 1, subLms: 0, sub: 1 };
    state.reverseNet = 0;
    await runMysqlRefundSweepOnce();
    expect(diffCalls()).toHaveLength(0);
    expect(reverseMock).toHaveBeenCalledWith('c1', 0, 'LMS', CAMP, 0, 'campaign');
    expect(alertMock.mock.calls.some((c) => String(c[0]?.dedupKey || '').startsWith('alimtalk-settle-ambiguous:'))).toBe(true);
  });

  it('적재 중(send_phase=processing)이면 결과별 집계도 조회하지 않는다', async () => {
    state.camp.send_phase = 'processing';
    await runMysqlRefundSweepOnce();
    expect(resultAgg).not.toHaveBeenCalled();
    expect(refundMock).not.toHaveBeenCalled();
  });
});
