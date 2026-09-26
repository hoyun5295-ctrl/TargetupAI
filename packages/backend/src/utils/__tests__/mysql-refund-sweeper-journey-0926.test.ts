/**
 * 정산 스위퍼 — 여정 단계 캠페인 환불 배선 (★2026-09-26 한줄로 V2 F05·F06·F11) · 하네스는 알림톡 배선 테스트와 같다
 * (아래 머리 주석은 하네스 원본 설명이다)
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

const dedParams: any[][] = [];
const state = {
  camp: {} as Record<string, any>,
  dedRows: [] as Array<{ amount: number; description: string; created_at?: Date }>,
  counts: { total: 8, success: 6, fail: 2, pending: 0 },
  agg: undefined as any,
  reverseNet: 0,
  sub: 0,
};

const queryMock = vi.fn(async (sql: string, _params?: any[]) => {
  const s = String(sql);
  if (s.includes('JOIN companies co ON co.id = c.company_id')) return { rows: [state.camp] };
  // 회사 단가(getUnitPrice) — 운영처럼 단가가 있다(빈 행이면 단가 0으로 정산 블록 전체를 건너뛰어 운영보다 관대해진다)
  if (s.includes('FROM companies WHERE id = $1') && s.includes('cost_per_lms')) {
    return { rows: [{ unit_price_basis: 'vat_included', cost_per_sms: 11, cost_per_lms: 27.5, cost_per_mms: 60, cost_per_kakao: 8.8, cost_per_brand: 20, cost_per_brand_nonfriend: 20 }] };
  }
  if (s.includes("type = 'deduct'") && s.includes('SELECT amount, description, created_at FROM balance_transactions')) {
    dedParams.push(_params || []);
    return { rows: state.dedRows };
  }
  return { rows: [] };
});
vi.mock('../../config/database', () => ({
  default: { query: (...a: any[]) => (queryMock as any)(...a), connect: vi.fn(async () => ({ query: async () => ({ rows: [] }), release: () => undefined })) },
  query: (...a: any[]) => (queryMock as any)(...a),
}));

const resultAgg = vi.fn(async () => new Map(state.agg ? [[CAMP, state.agg]] : []));
const subRows = vi.fn(async () => new Map<string, number>(state.sub ? [[CAMP, state.sub]] : []));
vi.mock('../sms-queue', () => ({
  getCompanySmsTablesWithLogs: async () => ['SMSQ_SEND_1', 'SMSQ_SEND_1_202609'],
  smsCampaignCountsSafe: async () => new Map([[CAMP, state.counts]]),
  smsAlimtalkResultAgg: (...a: any[]) => (resultAgg as any)(...a),
  smsCampaignSubRowCounts: (...a: any[]) => (subRows as any)(...a),
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
// ★ Codex 3R — 여정은 단일 목표(netTargetCount)로 순환불과 비교해 지급한다
const journeyCalls = () => refundMock.mock.calls.filter((c) => c[6]?.netTargetCount !== undefined);
const invariantAlerts = () => alertMock.mock.calls.filter((c) => String(c[0]?.dedupKey || '').startsWith('refund-invariant:'));

describe('정산 스위퍼 — 여정 단계 캠페인', () => {
  beforeEach(() => {
    dedParams.length = 0;
    // 새 원장 표식이 있고 그날이 끝난(어제) 단계 캠페인 — 회수·불변식까지 도는 기본 모양
    state.camp = { ...state.camp, send_type: 'journey', send_channel: 'sms', message_type: 'LMS', journey_ledger: true,
      send_base: new Date(Date.now() - 36 * 60 * 60 * 1000) };
    // 여정은 1건씩 차감한다 — 6행 × 27.5원
    // 실제 행처럼 차감 시각이 있다(2시간 전 = 자리 잡은 차감)
    state.dedRows = Array.from({ length: 6 }, () => ({ amount: 27.5, description: '[여정 발송] LMS 1건 발송 차감 (건당 27.5원)', created_at: new Date(Date.now() - 2 * 60 * 60 * 1000) }));
    state.counts = { total: 6, success: 4, fail: 2, pending: 0 };
    state.agg = undefined;
    state.sub = 0;
    state.reverseNet = 55;
    subRows.mockClear();
  });

  it('여정 원장(journey · 단계 캠페인 id)을 읽고 실패 2건을 journey 유형으로 환불 · 회수도 journey', async () => {
    await runMysqlRefundSweepOnce();
    expect(dedParams).toHaveLength(1);
    expect(dedParams[0]).toEqual(['c1', CAMP, 'LMS', 'journey']);
    expect(journeyCalls()).toHaveLength(1);
    expect(journeyCalls()[0].slice(0, 6)).toEqual(['c1', 0, 'LMS', CAMP, '여정 발송 실패 환불 (sweep)', 'journey']);
    expect(journeyCalls()[0][6]).toEqual({ refundKey: 'fail', netTargetCount: 2 });
    // 여정은 항아리(FAIL·NOT_LOADED 누적 목표)를 쓰지 않는다
    expect(refundMock.mock.calls.filter((c) => c[6]?.netTargetCount === undefined)).toHaveLength(0);
    expect(reverseMock).toHaveBeenCalledWith('c1', 2, 'LMS', CAMP, 0, 'journey');
    expect(invariantAlerts()).toHaveLength(0);
  });

  it('여정 알림톡 단계는 KAKAO 축 원장을 읽는다(캠페인 행의 LMS가 아니다)', async () => {
    state.camp.send_channel = 'alimtalk';
    state.dedRows = Array.from({ length: 6 }, () => ({ amount: 8.8, description: '[여정 발송] KAKAO 1건 발송 차감 (건당 8.8원)', created_at: new Date(Date.now() - 2 * 60 * 60 * 1000) }));
    state.reverseNet = 17.6;
    await runMysqlRefundSweepOnce();
    expect(dedParams[0]).toEqual(['c1', CAMP, 'KAKAO', 'journey']);
    expect(journeyCalls()[0][2]).toBe('KAKAO');
    expect(reverseMock).toHaveBeenCalledWith('c1', 2, 'KAKAO', CAMP, 0, 'journey');
  });

  it('일반 캠페인은 종전 그대로 campaign 원장', async () => {
    state.camp.send_type = 'direct';
    state.dedRows = [{ amount: 165, description: 'LMS 6건 발송 차감 (건당 27.5원)' }];
    await runMysqlRefundSweepOnce();
    expect(dedParams[0]).toEqual(['c1', CAMP, 'LMS', 'campaign']);
    expect(failCalls()[0][5]).toBe('campaign');
    expect(reverseMock).toHaveBeenCalledWith('c1', 2, 'LMS', CAMP, 0, 'campaign');
  });

  it('새 원장 표식이 없는 여정 캠페인(배포 전에 만든 날)은 정산·회수·불변식을 건너뛴다 — 옛 참조와 섞이지 않고 거짓 경보도 없다', async () => {
    state.camp.journey_ledger = false;
    state.reverseNet = 0;
    await runMysqlRefundSweepOnce();
    expect(dedParams).toHaveLength(0);
    expect(refundMock).not.toHaveBeenCalled();
    expect(reverseMock).not.toHaveBeenCalled();
    expect(invariantAlerts()).toHaveLength(0);
  });

  it('그날이 안 끝난 여정 캠페인도 회수는 돈다(차감 → 적재라 결과가 차감보다 먼저 보일 수 없다) · 불변식 경보만 마감 뒤', async () => {
    // 날짜만 고정: 지금 = 2026-09-26 12:00 KST · 단계 캠페인 = 같은 날 11:00 KST
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-26T03:00:00Z'));
    try {
      state.camp.send_base = new Date('2026-09-26T02:00:00Z');
      state.dedRows = state.dedRows.map((r) => ({ ...r, created_at: new Date('2026-09-26T02:10:00Z') }));
      state.reverseNet = 0;   // 순환불 0 · 실패 2 → 날이 끝났다면 미환불 경보가 났을 모양
      await runMysqlRefundSweepOnce();
      expect(journeyCalls()).toHaveLength(1);
      expect(reverseMock).toHaveBeenCalledWith('c1', 2, 'LMS', CAMP, 0, 'journey');
      expect(invariantAlerts()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('여정 미적재는 5분 지난 차감만 센다 — 방금 차감하고 아직 적재가 안 보이는 건을 미적재로 환불하지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-26T03:00:00Z'));
    try {
      state.camp.send_base = new Date('2026-09-26T01:00:00Z');
      // 차감 7건: 6건은 1시간 전, 1건은 방금(적재 전) · 결과 = 성공 4 · 실패 2 (적재 6)
      state.dedRows = [
        ...Array.from({ length: 6 }, () => ({ amount: 27.5, description: '[여정 발송] LMS 1건 발송 차감 (건당 27.5원)', created_at: new Date('2026-09-26T02:00:00Z') })),
        { amount: 27.5, description: '[여정 발송] LMS 1건 발송 차감 (건당 27.5원)', created_at: new Date('2026-09-26T02:59:30Z') },
      ];
      state.camp.sent_count = 6;
      await runMysqlRefundSweepOnce();
      // 목표 = 실패 2 + 미적재(자리 잡은 6 − 적재 6 = 0) = 2 — 방금 차감분은 목표에 안 들어간다
      expect(journeyCalls()[0][6]).toEqual({ refundKey: 'fail', netTargetCount: 2 });
      // 회수 한도는 전체 차감 기준 = 7 − 4 − 0 = 3건(방금 차감분이 한도를 늘리는 쪽 = 안전)
      expect(reverseMock).toHaveBeenCalledWith('c1', 3, 'LMS', CAMP, 0, 'journey');
    } finally {
      vi.useRealTimers();
    }
  });

  it('5분 지났는데도 적재가 안 보이는 차감은 미적재로 환불한다(적재 실패분)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-26T03:00:00Z'));
    try {
      state.camp.send_base = new Date('2026-09-26T01:00:00Z');
      state.dedRows = Array.from({ length: 7 }, () => ({ amount: 27.5, description: '[여정 발송] LMS 1건 발송 차감 (건당 27.5원)', created_at: new Date('2026-09-26T02:00:00Z') }));
      state.camp.sent_count = 6;
      await runMysqlRefundSweepOnce();
      // 목표 = 실패 2 + 미적재(7 − 6) 1 = 3
      expect(journeyCalls()[0][6]).toEqual({ refundKey: 'fail', netTargetCount: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('일반 캠페인은 원장이 없어도 종전처럼 불변식 감시를 한다(차감 없는 성공 = 진짜 이상)', async () => {
    state.camp.send_type = 'direct';
    state.dedRows = [];
    state.reverseNet = 0;
    await runMysqlRefundSweepOnce();
    expect(invariantAlerts()).toHaveLength(1);
  });

  it('여정 알림톡: 카카오 실패 + 대체 성공은 실패가 아니다(행 실패 − 대체 행) · 대체 행 집계는 여정 알림톡에만', async () => {
    state.camp.send_channel = 'alimtalk';
    state.dedRows = [{ amount: 8.8, description: '[여정 발송] KAKAO 1건 발송 차감 (건당 8.8원)', created_at: new Date(Date.now() - 2 * 60 * 60 * 1000) }];
    state.counts = { total: 2, success: 1, fail: 1, pending: 0 };   // K 7300 + 대체 L 1000
    state.sub = 1;
    state.camp.sent_count = 1;
    state.reverseNet = 0;
    await runMysqlRefundSweepOnce();
    expect(subRows).toHaveBeenCalledTimes(1);
    expect(journeyCalls()).toHaveLength(0);
    expect(reverseMock).toHaveBeenCalledWith('c1', 0, 'KAKAO', CAMP, 0, 'journey');
  });

  it('Codex 3R 반례: 대체 성공(실패 환불 → 회수 뒤) 다음 적재 실패는 미적재로 목표에 들어간다(순환불 비교라 막히지 않는다)', async () => {
    state.camp.send_channel = 'alimtalk';
    // 차감 2(둘 다 자리 잡음) · 적재 1(K 실패 + 대체 성공) · 1건은 적재 실패
    state.dedRows = Array.from({ length: 2 }, () => ({ amount: 8.8, description: '[여정 발송] KAKAO 1건 발송 차감 (건당 8.8원)', created_at: new Date(Date.now() - 2 * 60 * 60 * 1000) }));
    state.counts = { total: 2, success: 1, fail: 1, pending: 0 };
    state.sub = 1;
    state.camp.sent_count = 1;
    state.reverseNet = 0;
    await runMysqlRefundSweepOnce();
    expect(journeyCalls()).toHaveLength(1);
    expect(journeyCalls()[0][6]).toEqual({ refundKey: 'fail', netTargetCount: 1 });
  });

  it('여정 문자 단계는 대체 행 집계를 하지 않는다(부하 0)', async () => {
    await runMysqlRefundSweepOnce();
    expect(subRows).not.toHaveBeenCalled();
  });

  it('여정은 발송 수(sent_count)를 스위퍼가 올리지 않는다 — 실행기가 발송마다 +1(대체 행이 적재 수를 부풀리지 않게)', async () => {
    state.camp.send_channel = 'alimtalk';
    state.counts = { total: 3, success: 2, fail: 1, pending: 0 };
    state.sub = 1;
    state.camp.sent_count = 2;
    state.camp.success_count = 0;
    await runMysqlRefundSweepOnce();
    const upd = queryMock.mock.calls.find((c) => String(c[0]).includes('UPDATE campaigns') && String(c[0]).includes('sent_count = GREATEST'));
    expect(upd).toBeDefined();
    expect(upd![1][3]).toBe(2);
  });
});
