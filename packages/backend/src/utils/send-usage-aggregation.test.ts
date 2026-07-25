import { describe, it, expect } from 'vitest';
import { rollupUsageByPeriod, USAGE_TYPE_LABEL, MSG_TYPE_TO_USAGE_KEY, type UsageDayData } from './send-usage-aggregation';

describe('rollupUsageByPeriod — 청구 사용량 일자 집계 → 기간×유형 롤업 (2026-07-25)', () => {
  const day = (t: number, s: number, f = 0, p = 0) => ({ total: t, success: s, fail: f, pending: p });

  it('빈 입력 — 빈 배열', () => {
    expect(rollupUsageByPeriod({}, 'daily')).toEqual([]);
    expect(rollupUsageByPeriod(undefined as any, 'monthly')).toEqual([]);
  });

  it('일별 — 유형별로 행이 나뉜다', () => {
    const d: UsageDayData = { '2026-07-23': { SMS: day(100, 95, 5), LMS: day(10, 9, 1) } };
    const rows = rollupUsageByPeriod(d, 'daily');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ period: '2026-07-23', type_key: 'SMS', sent: 100, success: 95, fail: 5 });
    expect(rows[1]).toMatchObject({ type_key: 'LMS', sent: 10, success: 9, fail: 1 });
  });

  it('월별 — 같은 달 일자들이 유형별로 합산된다', () => {
    const d: UsageDayData = {
      '2026-07-01': { SMS: day(10, 10) },
      '2026-07-15': { SMS: day(5, 4, 1) },
      '2026-08-02': { SMS: day(7, 7) },
    };
    const rows = rollupUsageByPeriod(d, 'monthly');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ period: '2026-08', sent: 7 }); // 기간 desc
    expect(rows[1]).toMatchObject({ period: '2026-07', sent: 15, success: 14, fail: 1 });
  });

  it('총량 보존 — 롤업 전후 합계가 같아야 정산이 성립한다', () => {
    const d: UsageDayData = {
      '2026-07-01': { SMS: day(10, 9, 1), LMS: day(3, 3), KAKAO: day(2, 2) },
      '2026-07-02': { SMS: day(20, 18, 2), TEST_SMS: day(4, 4) },
    };
    const rows = rollupUsageByPeriod(d, 'monthly');
    const sum = (k: 'sent' | 'success' | 'fail') => rows.reduce((a, r) => a + r[k], 0);
    expect(sum('sent')).toBe(39);
    expect(sum('success')).toBe(36);
    expect(sum('fail')).toBe(3);
  });

  it('청구 유형키 전부 라벨이 있다 — 라벨 누락은 엑셀에 원시 키가 노출된다', () => {
    for (const k of ['SMS', 'LMS', 'MMS', 'KAKAO', 'TEST_SMS', 'TEST_LMS', 'SPAM_SMS', 'SPAM_LMS']) {
      expect(USAGE_TYPE_LABEL[k]).toBeTruthy();
    }
  });

  it('유형 순서 — 청구서 항목 순서(SMS→LMS→MMS→카카오→테스트→스팸)', () => {
    const d: UsageDayData = {
      '2026-07-23': { SPAM_LMS: day(1, 1), KAKAO: day(1, 1), SMS: day(1, 1), TEST_SMS: day(1, 1), LMS: day(1, 1) },
    };
    expect(rollupUsageByPeriod(d, 'daily').map((r) => r.type_key)).toEqual(['SMS', 'LMS', 'KAKAO', 'TEST_SMS', 'SPAM_LMS']);
  });

  it('미등록 유형키도 버리지 않는다 — 조용히 사라지면 총량이 안 맞는다', () => {
    const d: UsageDayData = { '2026-07-23': { SMS: day(1, 1), WEIRD: day(9, 9) } };
    const rows = rollupUsageByPeriod(d, 'daily');
    expect(rows).toHaveLength(2);
    const weird = rows.find((r) => r.type_key === 'WEIRD')!;
    expect(weird.type_label).toBe('WEIRD'); // 라벨 없으면 키 그대로
    expect(weird.sent).toBe(9);
  });

  it('형식 밖 일자 키는 무시(오염 방어)', () => {
    const d: UsageDayData = { 'bad-key': { SMS: day(999, 999) }, '2026-07-23': { SMS: day(1, 1) } };
    const rows = rollupUsageByPeriod(d, 'daily');
    expect(rows).toHaveLength(1);
    expect(rows[0].sent).toBe(1);
  });
});

describe('MSG_TYPE_TO_USAGE_KEY — SMSQ 유형코드 → 청구 유형키 (2026-07-25)', () => {
  it('S/L/M/K 네 코드가 모두 청구 키로 변환된다', () => {
    expect(MSG_TYPE_TO_USAGE_KEY.S).toBe('SMS');
    expect(MSG_TYPE_TO_USAGE_KEY.L).toBe('LMS');
    expect(MSG_TYPE_TO_USAGE_KEY.M).toBe('MMS');
    expect(MSG_TYPE_TO_USAGE_KEY.K).toBe('KAKAO');
  });

  it('청구 합산이 읽는 키와 정확히 일치한다 — 어긋나면 그 유형이 0원 청구된다', () => {
    // billing.ts 합산부가 읽는 키: SMS·LMS·MMS·KAKAO.
    // 과거 'M'·'K'가 변환되지 않아 MMS·알림톡이 통째로 청구에서 빠졌다.
    const billingKeys = ['SMS', 'LMS', 'MMS', 'KAKAO'];
    for (const v of Object.values(MSG_TYPE_TO_USAGE_KEY)) {
      expect(billingKeys).toContain(v);
    }
    expect(new Set(Object.values(MSG_TYPE_TO_USAGE_KEY)).size).toBe(4); // 중복 매핑 없음
  });
});
