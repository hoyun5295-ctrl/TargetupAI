/**
 * 캠페인 학습 누적 — 한 번 평가한 캠페인은 다시 고르지 않고, 10분 간격으로만 돈다 (★2026-09-26 한줄로 V2 F13·F42)
 *
 * 클릭 0 캠페인은 학습 메모리 행을 만들지 않아 NOT EXISTS가 계속 참이었다 → 24시간 동안 30초마다(2,880회) 다시 후보가 되고,
 * 그때마다 그 회사의 message_click 이벤트 전체를 COUNT했다(campaign_id는 JSON 속성이라 인덱스 밖). LIMIT 100을 최신 무클릭 캠페인이
 * 채워 앞선 캠페인은 학습되지 않았고, 환불 스윕과 같은 사이클 안이라 길어지면 다음 환불 사이클이 건너뛰어졌다.
 * 처방: 평가한 캠페인 id를 프로세스 메모리에 적어 후보에서 뺀다(DB 쓰기 없음 · 25시간 뒤 정리 · 재기동 뒤엔 한 번 더 평가) ·
 * 학습 누적은 급하지 않아 10분 간격으로만 돈다(환불은 종전대로 30초).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const CAMP = '66666666-6666-4666-8666-666666666666';
const learningSql: Array<{ sql: string; params: any[] }> = [];

const queryMock = vi.fn(async (sql: string, params?: any[]) => {
  const s = String(sql);
  // 스위퍼는 선불 후보가 0건이면 학습 전에 돌아간다(기존 구조) — 적재 중 캠페인 하나를 둬 환불 블록은 건너뛰게 한다
  if (s.includes('JOIN companies co ON co.id = c.company_id')) {
    return { rows: [{ id: 'cand-1', company_id: 'c1', created_by: 'u1', message_type: 'LMS', send_channel: 'sms', send_type: 'direct', journey_ledger: false,
      success_count: 0, fail_count: 0, sent_count: 0, send_phase: 'processing', send_base: new Date() }] };
  }
  if (s.includes('FROM ai_company_memory m') && s.includes("e.event_name = 'message_click'")) {
    learningSql.push({ sql: s, params: params || [] });
    const excluded: string[] = (params && params[0]) || [];
    return { rows: excluded.includes(CAMP) ? [] : [{
      campaign_id: CAMP, company_id: 'c1', campaign_name: 'x', message_type: 'LMS', send_type: 'direct',
      is_ad: false, sent_count: 20, success_count: 20, fail_count: 0, click_count: 0, conversion_count: 0, sent_at: new Date(),
    }] };
  }
  return { rows: [] };
});
vi.mock('../../config/database', () => ({
  default: { query: (...a: any[]) => (queryMock as any)(...a), connect: vi.fn(async () => ({ query: async () => ({ rows: [] }), release: () => undefined })) },
  query: (...a: any[]) => (queryMock as any)(...a),
}));
vi.mock('../sms-queue', () => ({
  getCompanySmsTablesWithLogs: async () => [],
  smsCampaignCountsSafe: async () => new Map(),
  smsAlimtalkResultAgg: async () => new Map(),
  smsCampaignSubRowCounts: async () => new Map(),
}));
vi.mock('../prepaid', () => ({
  prepaidRefund: vi.fn(async () => ({ refunded: 0, ok: true })),
  prepaidReverseOverRefund: vi.fn(async () => ({ reversed: 0, netRefundedAmt: 0, skipped: false })),
  REFUND_KEYS: { NOT_LOADED: 'notloaded', FAIL: 'fail', CANCEL: 'cancel', TEST: 'test', KAKAO_DIFF: 'kakao_diff' },
}));
vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => undefined) }));
const recordMock = vi.fn(async () => undefined);
vi.mock('../company-memory', () => ({ recordCampaignLearning: (...a: any[]) => (recordMock as any)(...a) }));
vi.mock('../sweep-cadence', () => ({ isSweepDue: () => true }));

import { runMysqlRefundSweepOnce } from '../mysql-refund-sweeper';

describe('학습 누적 — 1회 평가 · 10분 간격', () => {
  beforeEach(() => {
    learningSql.length = 0;
    recordMock.mockClear();
  });

  it('같은 캠페인은 한 번만 평가하고, 10분 안에는 학습 조회 자체를 하지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-26T03:00:00Z'));
      await runMysqlRefundSweepOnce();
      expect(recordMock).toHaveBeenCalledTimes(1);
      expect(learningSql).toHaveLength(1);

      // 30초 뒤 — 학습 조회 없음
      vi.setSystemTime(new Date('2026-09-26T03:00:30Z'));
      await runMysqlRefundSweepOnce();
      expect(learningSql).toHaveLength(1);

      // 11분 뒤 — 조회는 하되 평가한 캠페인은 후보에서 뺀다
      vi.setSystemTime(new Date('2026-09-26T03:11:00Z'));
      await runMysqlRefundSweepOnce();
      expect(learningSql).toHaveLength(2);
      expect(learningSql[1].sql).toContain('NOT (c.id = ANY($1::uuid[]))');
      expect(learningSql[1].params[0]).toContain(CAMP);
      expect(recordMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
