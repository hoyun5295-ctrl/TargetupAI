import { describe, test, expect } from 'vitest';
import { shouldFinalizeCampaign, classifyResultTables } from './sms-table-split';

// ★ 2026-07-04 라인13 비토 게이트웨이 성공 0 사고 근본 수정 검증 — LOG 짝 없는 LIVE는 결과까지 집계.
describe('classifyResultTables — LOG 짝 없는 LIVE는 결과 집계 대상', () => {
  test('LOG 없는 라인13 = 그 LIVE가 결과 집계 대상, 대기전용 아님', () => {
    const r = classifyResultTables(['SMSQ_SEND_13']);
    expect(r.resultTables).toEqual(['SMSQ_SEND_13']);
    expect(r.pendingLiveTables).toEqual([]);
  });
  test('LOG 있는 표준 라인 = LIVE는 대기전용, 결과는 LOG', () => {
    const r = classifyResultTables(['SMSQ_SEND_1', 'SMSQ_SEND_1_202607']);
    expect(r.resultTables).toEqual(['SMSQ_SEND_1_202607']);
    expect(r.pendingLiveTables).toEqual(['SMSQ_SEND_1']);
  });
  test('혼합(표준+라인13) = 표준 LIVE만 대기전용, 라인13은 결과 집계', () => {
    const r = classifyResultTables(['SMSQ_SEND_1', 'SMSQ_SEND_1_202607', 'SMSQ_SEND_13']);
    expect(r.pendingLiveTables).toEqual(['SMSQ_SEND_1']);
    expect([...r.resultTables].sort()).toEqual(['SMSQ_SEND_13', 'SMSQ_SEND_1_202607'].sort());
  });
  test('언더스코어 경계 — SMSQ_SEND_1 이 SMSQ_SEND_13_YYYYMM 을 자기 LOG로 오매칭하지 않음', () => {
    const r = classifyResultTables(['SMSQ_SEND_1', 'SMSQ_SEND_13', 'SMSQ_SEND_13_202607']);
    expect(r.pendingLiveTables).toEqual(['SMSQ_SEND_13']);
    expect([...r.resultTables].sort()).toEqual(['SMSQ_SEND_1', 'SMSQ_SEND_13_202607'].sort());
  });
});

const HOUR = 60 * 60 * 1000;
const NOW = 1_750_000_000_000; // 고정 기준 시각(테스트 결정성)

function base(over: Partial<Parameters<typeof shouldFinalizeCampaign>[0]> = {}) {
  return {
    status: 'completed',
    sendBaseMs: NOW - 7 * HOUR, // 발송 7시간 경과(>6h)
    nowMs: NOW,
    successCount: 0,
    failCount: 0,
    sentCount: 0,
    targetCount: 0,
    ...over,
  };
}

describe('shouldFinalizeCampaign — 결과 캐시 확정 판정 (조기 확정 차단)', () => {
  test('마트스마트 사고: 성공+실패(3108) < target(3180)이면 확정 안 함 — 미해결 행 잔존', () => {
    // sent_count가 3095로 과소라 옛 게이트(>=sent_count)는 통과했지만, target 기준이면 미완결.
    expect(shouldFinalizeCampaign(base({
      successCount: 3085, failCount: 23, sentCount: 3095, targetCount: 3180,
    }))).toBe(false);
  });

  test('정상 완결: 성공+실패가 target에 도달하면 확정', () => {
    expect(shouldFinalizeCampaign(base({
      successCount: 9678, failCount: 503, sentCount: 10181, targetCount: 10181,
    }))).toBe(true);
  });

  test('성공+실패 >= sent_count이지만 < target이면 확정 안 함 (sent_count 과소 게임 차단)', () => {
    expect(shouldFinalizeCampaign(base({
      successCount: 3000, failCount: 95, sentCount: 3000, targetCount: 3180,
    }))).toBe(false);
  });

  test('발송 6시간 미경과면 확정 안 함', () => {
    expect(shouldFinalizeCampaign(base({
      sendBaseMs: NOW - 3 * HOUR,
      successCount: 100, failCount: 0, sentCount: 100, targetCount: 100,
    }))).toBe(false);
  });

  test('terminal 아닌 상태(sending/scheduled)는 확정 안 함', () => {
    expect(shouldFinalizeCampaign(base({
      status: 'sending', successCount: 100, failCount: 0, sentCount: 100, targetCount: 100,
    }))).toBe(false);
  });

  test('failed 상태도 완결 시 확정', () => {
    expect(shouldFinalizeCampaign(base({
      status: 'failed', successCount: 0, failCount: 50, sentCount: 50, targetCount: 50,
    }))).toBe(true);
  });

  test('benchmark 0(target·sent 모두 0)이면 확정 안 함', () => {
    expect(shouldFinalizeCampaign(base({ successCount: 0, failCount: 0, sentCount: 0, targetCount: 0 }))).toBe(false);
  });

  test('target 없고 sent만 있는 옛 캠페인은 sent 기준으로 완결 판정', () => {
    expect(shouldFinalizeCampaign(base({
      successCount: 80, failCount: 20, sentCount: 100, targetCount: 0,
    }))).toBe(true);
  });

  test('sendBase 없음(0)이면 확정 안 함', () => {
    expect(shouldFinalizeCampaign(base({
      sendBaseMs: 0, successCount: 100, failCount: 0, sentCount: 100, targetCount: 100,
    }))).toBe(false);
  });
});
