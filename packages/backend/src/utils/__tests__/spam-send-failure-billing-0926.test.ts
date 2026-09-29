/**
 * 스팸 검사 발송 실패는 청구하지 않는다 (★ 2026-09-26 한줄로 V2 m042 · Harold 결정 「발송 실패만 환불·청구 제외 · 시간 초과는 청구」)
 *
 * 옛 동작: 결과가 나온 행(통과·차단·실패·시간 초과)을 전부 청구 성공으로 셌다(후불 청구 두 축 · result IS NOT NULL).
 *   선불도 등록 때 차감한 뒤 통신사 발송 실패분을 돌려주지 않았다 — 두 방식이 같은 규칙이라 "일관"이었지만 미전달 검사를 청구했다.
 * 결정: 통신사가 실패로 확정한 행(failed)만 청구에서 뺀다. 시간 초과(timeout)는 그대로 청구한다.
 *   후불 = 청구 두 축(일자축 buildCompanyUsageByDay · 청구 행 buildBillingUsageRows)이 같은 판정 CT로 성공을 센다.
 *   선불 = 발송 실패를 기록하는 두 자리(수동 라우트·큐 워커 폴링)에서 실패를 쓴 직후, 실패 행 수만큼 FAIL 항아리로 환불(누적 목표 · 재호출 안전).
 *   검사를 끝내는 자리는 9곳(폴링·앱 수신 보고·화면 조회 시간 초과)이라 거기 붙이면 빠진다 — 실패가 생기는 자리는 둘뿐이다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const state = { rows: [] as any[] };
const queryMock = vi.fn(async (sql: string, _p?: any[]) => {
  if (String(sql).includes('FROM spam_filter_test_results r')) return { rows: state.rows };
  return { rows: [] };
});
vi.mock('../../config/database', () => ({
  default: { query: (...a: any[]) => (queryMock as any)(...a), connect: vi.fn() },
  query: (...a: any[]) => (queryMock as any)(...a),
  mysqlQuery: vi.fn(async () => []),
}));
const refundMock = vi.fn(async (..._a: any[]) => ({ refunded: 22, ok: true }));
vi.mock('../prepaid', () => ({
  prepaidDeduct: vi.fn(),
  prepaidRefund: (...a: any[]) => (refundMock as any)(...a),
  REFUND_KEYS: { NOT_LOADED: 'notloaded', FAIL: 'fail', CANCEL: 'cancel', TEST: 'test', KAKAO_DIFF: 'kakao_diff' },
}));
const alertMock = vi.fn(async (..._a: any[]) => undefined);
vi.mock('../system-alert', () => ({ sendSystemAlert: (...a: any[]) => (alertMock as any)(...a) }));
vi.mock('../messageUtils', () => ({ prepareFieldMappings: async () => ({}), replaceVariables: (t: string) => t, enrichWithCustomFields: (x: any) => x, buildAdMessage: (t: string) => t, buildAdSubject: (t: string) => t }));
vi.mock('../store-scope', () => ({ getSampleCustomerScope: async () => ({ where: '', params: [] }) }));
vi.mock('../sms-queue', () => ({ getTestSmsTables: async () => ['SMSQ_TEST'], toQtmsgType: (t: string) => t, insertTestSmsQueue: async () => undefined }));

import { spamBilledResultSql, spamFailedResultSql } from '../sms-result-map';
import { refundSpamSendFailures } from '../spam-test-queue';

beforeEach(() => { state.rows = []; refundMock.mockClear(); alertMock.mockClear(); queryMock.mockClear(); });

describe('판정 CT (sms-result-map)', () => {
  it('청구 = 결과가 나왔고 발송 실패가 아닌 행(통과·차단·시간 초과)', () => {
    expect(spamBilledResultSql('r')).toBe("(r.result IS NOT NULL AND r.result <> 'failed')");
    expect(spamFailedResultSql('r')).toBe("r.result = 'failed'");
  });
});

describe('선불 발송 실패 환불 (refundSpamSendFailures)', () => {
  it('유형별 실패 행 수를 FAIL 항아리 누적 목표로 환불한다', async () => {
    state.rows = [{ company_id: 'c1', message_type: 'SMS', failed: 2 }, { company_id: 'c1', message_type: 'LMS', failed: 0 }];
    await refundSpamSendFailures('test-1');
    expect(refundMock).toHaveBeenCalledTimes(1);
    expect(refundMock.mock.calls[0]).toEqual(['c1', 2, 'SMS', 'test-1', '스팸 검사 발송 실패 환불', 'spam', { refundKey: 'fail' }]);
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain(`FILTER (WHERE ${"r.result = 'failed'"})`);
    expect(sql).toContain('JOIN spam_filter_tests t ON t.id = r.test_id');
  });
  it('실패 행이 없으면 부르지 않는다', async () => {
    state.rows = [{ company_id: 'c1', message_type: 'SMS', failed: 0 }];
    await refundSpamSendFailures('test-1');
    expect(refundMock).not.toHaveBeenCalled();
  });
  it('환불이 끝나지 않으면 경보를 남기고 던지지 않는다(검사 종료를 막지 않는다)', async () => {
    state.rows = [{ company_id: 'c1', message_type: 'SMS', failed: 1 }];
    refundMock.mockImplementationOnce(async () => ({ refunded: 0, ok: false }));
    await expect(refundSpamSendFailures('test-1')).resolves.toBeUndefined();
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(String((alertMock.mock.calls[0] as any)[0].dedupKey)).toBe('spam-fail-refund-miss:test-1');
  });
});

describe('배선', () => {
  const agg = readFileSync(join(__dirname, '..', 'send-usage-aggregation.ts'), 'utf8');
  const route = readFileSync(join(__dirname, '..', '..', 'routes', 'spam-filter.ts'), 'utf8');
  const queue = readFileSync(join(__dirname, '..', 'spam-test-queue.ts'), 'utf8');

  it('후불 청구 두 축이 같은 판정 CT로 성공·실패를 센다(옛 result IS NOT NULL 성공 0)', () => {
    expect(agg.split("SUM(CASE WHEN ${spamBilledResultSql('r')} THEN 1 ELSE 0 END) as success_count").length - 1).toBe(2);
    expect(agg.split("SUM(CASE WHEN ${spamFailedResultSql('r')} THEN 1 ELSE 0 END) as fail_count").length - 1).toBe(2);
    expect(agg).not.toContain('SUM(CASE WHEN r.result IS NOT NULL THEN 1 ELSE 0 END) as success_count');
  });

  it('발송 실패를 기록하는 두 자리(수동 라우트·큐 워커 폴링)에서 실패를 쓴 직후 환불한다 — 검사를 끝내는 자리(9곳)가 아니라', () => {
    for (const src of [route, queue]) {
      expect(src.split('await refundSpamSendFailures(testId);').length - 1).toBe(1);
      // 실패를 쓴 폴링 회차에서만 · 결과 기록 루프 바로 뒤
      // ★ 2026-09-29 차수 5(Codex 1R high) — 판정 쓰기 CT(아직 판정 안 된 행만)가 이번에 쓴 때만 환불 신호
      expect(src).toMatch(/(\(w\.rowCount \?\? 0\) > 0 && result === SPAM_RESULT\.FAILED\) wroteFailed = true;|if \(result === SPAM_RESULT\.FAILED\) wroteFailed = true;)/);
      expect(src).toContain('await query(SPAM_RESULT_DECIDE_SQL, [result, row.id]);');
      // 루프 뒤 finally — 실패 한 건을 기록한 뒤 다음 행 기록이 던져도 이미 기록한 실패분을 환불한다(Codex m042 1R high)
      expect(src).toMatch(/\} finally \{\s*\/\/[^\n]*\n\s*if \(wroteFailed\) await refundSpamSendFailures\(testId\);\s*\}/);
      const loopAt = src.indexOf('let wroteFailed = false;');
      const callAt = src.indexOf('if (wroteFailed) await refundSpamSendFailures(testId);');
      expect(loopAt).toBeGreaterThan(-1);
      expect(callAt).toBeGreaterThan(loopAt);
    }
  });
});
