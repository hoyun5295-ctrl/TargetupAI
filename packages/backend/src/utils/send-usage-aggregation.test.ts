import { describe, it, expect } from 'vitest';
import { rollupUsageByPeriod, USAGE_TYPE_LABEL, MSG_TYPE_TO_USAGE_KEY, resolveBillingUnitPrices, buildBillingTotals, findUnbillableUsageKeys, billingLogMonths, type UsageDayData } from './send-usage-aggregation';

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

describe('buildBillingTotals — 청구 수량 합산 (2026-07-25)', () => {
  const day = (t: number, s: number, f = 0, p = 0) => ({ total: t, success: s, fail: f, pending: p });

  it('빈 입력 — 8개 유형키가 전부 0으로 존재한다', () => {
    const t = buildBillingTotals({});
    expect(t).toEqual({ SMS: 0, LMS: 0, MMS: 0, KAKAO: 0, TEST_SMS: 0, TEST_LMS: 0, SPAM_SMS: 0, SPAM_LMS: 0 });
    expect(buildBillingTotals(undefined as any).SMS).toBe(0);
  });

  it('성공 건수만 센다 — 실패·대기는 청구 대상이 아니다', () => {
    const d: UsageDayData = { '2026-07-01': { SMS: day(100, 90, 7, 3) } };
    expect(buildBillingTotals(d).SMS).toBe(90);
  });

  it('여러 날짜가 유형별로 합산된다', () => {
    const d: UsageDayData = {
      '2026-07-01': { SMS: day(10, 10), MMS: day(2, 2) },
      '2026-07-02': { SMS: day(5, 4, 1), KAKAO: day(3, 3) },
    };
    const t = buildBillingTotals(d);
    expect(t.SMS).toBe(14);
    expect(t.MMS).toBe(2);
    expect(t.KAKAO).toBe(3);
  });

  it('★ MMS·알림톡이 합산에 잡힌다 — 이 둘이 빠져 0원 청구되던 결함의 회귀 방지', () => {
    const d: UsageDayData = { '2026-07-10': { MMS: day(308043, 308043), KAKAO: day(16, 16) } };
    const t = buildBillingTotals(d);
    expect(t.MMS).toBe(308043);
    expect(t.KAKAO).toBe(16);
  });

  it('미등록 유형키는 합산에 섞이지 않는다', () => {
    const d: UsageDayData = { '2026-07-01': { SMS: day(1, 1), WEIRD: day(999, 999) } };
    const t = buildBillingTotals(d);
    expect(t.SMS).toBe(1);
    expect((t as any).WEIRD).toBeUndefined();
    expect(Object.values(t).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('MSG_TYPE_TO_USAGE_KEY가 내놓는 키는 전부 합산 대상이다 — 하나라도 빠지면 그 유형이 0원 청구', () => {
    const t = buildBillingTotals({});
    for (const key of Object.values(MSG_TYPE_TO_USAGE_KEY)) {
      expect(t[key]).toBeDefined();
    }
  });
});

describe('billingLogMonths — LOG 테이블 월 범위 (2026-07-25)', () => {
  it('★ 7월 정산은 6월·7월·8월 LOG를 훑는다 — 6월 LOG에 앉은 7/1 발송 385건이 사라지던 결함', () => {
    expect(billingLogMonths('2026-07-01', '2026-07-31')).toEqual(['202606', '202607', '202608']);
  });

  it('연말 경계 — 해를 넘어간다', () => {
    expect(billingLogMonths('2026-12-01', '2026-12-31')).toEqual(['202611', '202612', '202701']);
  });

  it('연초 경계 — 전년으로 넘어간다', () => {
    expect(billingLogMonths('2026-01-01', '2026-01-31')).toEqual(['202512', '202601', '202602']);
  });

  it('여러 달 기간 — 중간 달이 빠지지 않는다', () => {
    expect(billingLogMonths('2026-03-15', '2026-05-20')).toEqual(['202602', '202603', '202604', '202605', '202606']);
  });

  it('하루짜리 기간도 앞뒤 한 달씩', () => {
    expect(billingLogMonths('2026-07-15', '2026-07-15')).toEqual(['202606', '202607', '202608']);
  });

  it('연월이 중복되지 않는다 — 같은 테이블을 두 번 훑으면 이중 계상이다', () => {
    const months = billingLogMonths('2026-01-01', '2026-12-31');
    expect(new Set(months).size).toBe(months.length);
    expect(months[0]).toBe('202512');
    expect(months[months.length - 1]).toBe('202701');
  });

  it('잘못된 날짜는 빈 배열 — 엉뚱한 테이블명을 만들지 않는다', () => {
    expect(billingLogMonths('bad', '2026-07-31')).toEqual([]);
    expect(billingLogMonths('2026-07-01', '')).toEqual([]);
  });
});

describe('findUnbillableUsageKeys — 청구가 못 읽는 유형키 감지 (2026-07-25)', () => {
  const day = (t: number, s: number) => ({ total: t, success: s, fail: 0, pending: 0 });

  it('정상 유형만 있으면 빈 배열', () => {
    const d: UsageDayData = { '2026-07-01': { SMS: day(10, 10), MMS: day(5, 5), KAKAO: day(1, 1) } };
    expect(findUnbillableUsageKeys(d)).toEqual([]);
    expect(findUnbillableUsageKeys({})).toEqual([]);
    expect(findUnbillableUsageKeys(undefined as any)).toEqual([]);
  });

  it('★ 변환 안 된 원시 msg_type을 잡아낸다 — MMS 308,043건이 이 모양으로 새어나갔다', () => {
    // 유형키 변환 전에는 dayData에 'M'·'K'가 그대로 담겼고, 청구 합산은 그걸 못 읽어 0원이 됐다.
    const d: UsageDayData = { '2026-07-10': { SMS: day(100, 90), M: day(308043, 308043), K: day(20, 16) } };
    const found = findUnbillableUsageKeys(d);
    expect(found.map((f) => f.key)).toEqual(['M', 'K']); // 성공 건수 내림차순
    expect(found[0]).toMatchObject({ key: 'M', success: 308043, total: 308043 });
    expect(found[1]).toMatchObject({ key: 'K', success: 16, total: 20 });
  });

  it('여러 날짜에 흩어진 같은 키를 합산한다', () => {
    const d: UsageDayData = {
      '2026-07-01': { NEWCH: day(3, 2) },
      '2026-07-02': { NEWCH: day(7, 5) },
    };
    expect(findUnbillableUsageKeys(d)).toEqual([{ key: 'NEWCH', success: 7, total: 10 }]);
  });

  it('성공 0이어도 적재가 있으면 잡는다 — 다음 달엔 성공이 날 수 있다', () => {
    const d: UsageDayData = { '2026-07-01': { WEIRD: day(50, 0) } };
    expect(findUnbillableUsageKeys(d)).toEqual([{ key: 'WEIRD', success: 0, total: 50 }]);
  });

  it('buildBillingTotals가 세는 키와 정확히 상보 관계다 — 어느 쪽에도 안 걸리는 키가 있으면 안 된다', () => {
    const d: UsageDayData = {
      '2026-07-01': { SMS: day(1, 1), LMS: day(1, 1), MMS: day(1, 1), KAKAO: day(1, 1), TEST_SMS: day(1, 1), TEST_LMS: day(1, 1), SPAM_SMS: day(1, 1), SPAM_LMS: day(1, 1), GHOST: day(9, 9) },
    };
    const billed = Object.values(buildBillingTotals(d)).reduce((a, b) => a + b, 0);
    const unbilled = findUnbillableUsageKeys(d).reduce((a, u) => a + u.success, 0);
    expect(billed).toBe(8);
    expect(unbilled).toBe(9);
    expect(billed + unbilled).toBe(17); // 총 성공 = 청구분 + 누락분, 사라지는 건 없다
  });
});

describe('resolveBillingUnitPrices — 청구 단가 스냅샷 (2026-07-25)', () => {
  // PG numeric은 드라이버가 문자열로 준다 — 실제 행 모양대로 문자열로 쓴다.
  const row = (o: Record<string, any> = {}) => ({
    cost_per_sms: '9.00', cost_per_lms: '27.00', cost_per_mms: '50.00', cost_per_kakao: '8.00',
    cost_per_test_sms: null, cost_per_test_lms: null, ...o,
  });

  it('기본 4종을 그대로 읽는다', () => {
    const p = resolveBillingUnitPrices(row());
    expect(p.SMS).toBe(9);
    expect(p.LMS).toBe(27);
    expect(p.MMS).toBe(50);
    expect(p.KAKAO).toBe(8);
  });

  it('테스트 단가 미설정(NULL) = 일반 단가 상속', () => {
    const p = resolveBillingUnitPrices(row());
    expect(p.TEST_SMS).toBe(9);
    expect(p.TEST_LMS).toBe(27);
  });

  it('★ 테스트 단가 0원은 0원 그대로 — 일반 단가로 되돌아가면 무료 설정이 과금된다', () => {
    const p = resolveBillingUnitPrices(row({ cost_per_test_sms: '0.00', cost_per_test_lms: 0 }));
    expect(p.TEST_SMS).toBe(0);
    expect(p.TEST_LMS).toBe(0);
  });

  it('빈 문자열 = 미설정으로 취급(화면에서 비우면 상속)', () => {
    const p = resolveBillingUnitPrices(row({ cost_per_test_sms: '', cost_per_test_lms: '' }));
    expect(p.TEST_SMS).toBe(9);
    expect(p.TEST_LMS).toBe(27);
  });

  it('일반 단가 0원도 0원 그대로', () => {
    const p = resolveBillingUnitPrices(row({ cost_per_sms: '0', cost_per_mms: 0 }));
    expect(p.SMS).toBe(0);
    expect(p.MMS).toBe(0);
    expect(p.TEST_SMS).toBe(0); // 0원 단가를 상속해도 0원
  });

  it('스팸필터 단가 = 일반 SMS/LMS 단가 (D16)', () => {
    const p = resolveBillingUnitPrices(row());
    expect(p.SPAM_SMS).toBe(9);
    expect(p.SPAM_LMS).toBe(27);
  });

  it('행 자체가 없거나 값이 깨져도 0으로 — 청구가 NaN이 되면 안 된다', () => {
    const p = resolveBillingUnitPrices(undefined);
    expect(p.SMS).toBe(0);
    const bad = resolveBillingUnitPrices(row({ cost_per_sms: 'abc' }));
    expect(bad.SMS).toBe(0);
    expect(Object.values(bad).every((v) => Number.isFinite(v))).toBe(true);
  });

  it('청구 유형키 전부에 단가가 있다 — 누락되면 그 유형이 0원 청구된다', () => {
    const p = resolveBillingUnitPrices(row());
    for (const k of ['SMS', 'LMS', 'MMS', 'KAKAO', 'TEST_SMS', 'TEST_LMS', 'SPAM_SMS', 'SPAM_LMS']) {
      expect(p[k]).toBeDefined();
    }
  });
});
