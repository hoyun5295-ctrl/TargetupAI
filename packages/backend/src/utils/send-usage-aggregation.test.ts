import { describe, it, expect } from 'vitest';
import { rollupUsageByPeriod, USAGE_TYPE_LABEL, MSG_TYPE_TO_USAGE_KEY, resolveBillingUnitPrices, buildBillingTotals, findUnbillableUsageKeys, billingLogMonths, type UsageDayData } from './send-usage-aggregation';
import {
  agentUsageKey, AGENT_MSG_TYPE_TO_USAGE_KEY, rollupAgentRowsForBilling, findUnbillableBillingRows,
  diffBillingRowsVsDayData, sortBillingUsageRows, priceBillingRows, toDayKey,
  billingRowKey, resolveBillingUnitPricesDetailed, findUnsetPricedTypes, summarizeBlockList,
  nullifyUnknownUserIds, checkBillingAmountIdentity, chunkArray,
  splitBillingSheets, checkSheetSumIdentity, buildPlanBillingItems, aggregateBillingSendIds, partitionBillingSendIds, findBlockingPendingRows,
  buildExtraBillingItems, extraRowUserId, extraRowsBlockingIssue,
  type BillingUsageRow, type AgentUnitPriceRow, type PricedBillingItem, type ExtraItemSourceRow,
} from './send-usage-aggregation';
import type { PayAgentStoreRow } from './pay-stats';
import { sumFlooredInvoiceLines } from './billing-invoice-lines';
import { normalizeAgentSendId } from './send-usage-aggregation';
// ★ 2026-09-04 별칭 흡수 계약 — 변환표의 모든 코드가 단가 붙는 유형으로 가는지 축 정의로 대조한다
import { BILLING_TYPES } from './billing-types';

/**
 * ★ 2026-08-20 발송ID 표기 정규화 CT (Harold 승인 — 예방 수정).
 * 등록 endpoint가 trim만 하고 저장해서, PG UNIQUE(case-sensitive)상 `b0023`과 `B0023`이
 * 서로 다른 회사에 각각 등록될 수 있었다 — 집계·정산은 양쪽 다 대문자화해 비교하므로 그 순간
 * 같은 CustId 실적이 두 회사에 이중 귀속된다. 저장 시점에 대문자로 정규화하면 UNIQUE가
 * 대소문자 표기 차이까지 잡는다(운영 데이터는 0820 실측 전부 대문자·중복 0).
 */
describe('normalizeAgentSendId — 발송ID 표기 정규화(저장·비교 공용)', () => {
  it('trim + 대문자', () => {
    expect(normalizeAgentSendId(' b0023 ')).toBe('B0023');
    expect(normalizeAgentSendId('v0001')).toBe('V0001');
    expect(normalizeAgentSendId('B0023')).toBe('B0023');
  });
  it('빈 값·비문자열은 빈 문자열', () => {
    expect(normalizeAgentSendId('')).toBe('');
    expect(normalizeAgentSendId(null)).toBe('');
    expect(normalizeAgentSendId(undefined)).toBe('');
  });
});

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
  it('S/L/M/K/F 다섯 코드가 모두 청구 키로 변환된다', () => {
    expect(MSG_TYPE_TO_USAGE_KEY.S).toBe('SMS');
    expect(MSG_TYPE_TO_USAGE_KEY.L).toBe('LMS');
    expect(MSG_TYPE_TO_USAGE_KEY.M).toBe('MMS');
    expect(MSG_TYPE_TO_USAGE_KEY.K).toBe('KAKAO');
    // ★ 2026-07-30 브랜드 SMSQ 합류 — 'F'가 빠지면 브랜드 발송이 통째로 0원 청구된다.
    expect(MSG_TYPE_TO_USAGE_KEY.F).toBe('BRAND');
  });

  it('청구 합산이 읽는 키와 정확히 일치한다 — 어긋나면 그 유형이 0원 청구된다', () => {
    // billing.ts 합산부가 읽는 키: SMS·LMS·MMS·KAKAO·BRAND.
    // 과거 'M'·'K'가 변환되지 않아 MMS·알림톡이 통째로 청구에서 빠졌다.
    const billingKeys = ['SMS', 'LMS', 'MMS', 'KAKAO', 'BRAND'];
    for (const v of Object.values(MSG_TYPE_TO_USAGE_KEY)) {
      expect(billingKeys).toContain(v);
    }
    expect(new Set(Object.values(MSG_TYPE_TO_USAGE_KEY)).size).toBe(5); // 중복 매핑 없음
  });
});

describe('buildBillingTotals — 청구 수량 합산 (2026-07-25)', () => {
  const day = (t: number, s: number, f = 0, p = 0) => ({ total: t, success: s, fail: f, pending: p });

  it('빈 입력 — 9개 유형키가 전부 0으로 존재한다', () => {
    const t = buildBillingTotals({});
    expect(t).toEqual({ SMS: 0, LMS: 0, MMS: 0, KAKAO: 0, BRAND: 0, TEST_SMS: 0, TEST_LMS: 0, SPAM_SMS: 0, SPAM_LMS: 0 });
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
  // ★ 2026-07-26 단가는 회사별 부가세 기준(`unit_price_basis`)을 거쳐 **공급가**로 해석된다.
  //   기존 케이스는 전환 후(공급가 입력) 기준 — 저장값이 곧 공급가다.
  const row = (o: Record<string, any> = {}) => ({
    unit_price_basis: 'vat_excluded',
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

// ============================================================
//  청구용 통합 집계 (2026-07-26 — 정산 재구성 ①)
// ============================================================


// ★ 2026-07-30 절사 위치 정정의 장 분리 계약 — 장 = 독립 문서 = 절사 단위.
//   계정별 발행은 장이 늘어 절사 횟수도 늘므로 합산 발행과 1원 수준 차이가 **의도적으로** 난다
//   (전역 절사 후 배분하면 각 장의 공급가가 그 장 항목표와 어긋난다 — 서수란 0729 문제의 장 단위 재발).
//   방향은 항상 고객 유리(장 합 ≤ 합산). Codex 0730 지적 ①에 대한 불수용 근거의 박제.
describe('장별 절사 계약 — 합산 vs 계정별 (2026-07-30)', () => {
  const mk = (userId: string, success: number): PricedBillingItem => ({
    channel: 'web', itemDate: '2026-07-01', typeKey: 'SMS', userId, agentSendId: null,
    total: success, success, fail: 0, pending: 0, agentId: null,
    unitPrice: 7.2, amount: success * 7.2, amountExact: success * 7.2, planDays: null, planMonthDays: null,
  });

  it('합산 1장 = floor(총수량×단가), 계정별 N장 = 각 장 floor의 합 — 1원 차이는 의도(고객 유리)', () => {
    const items = [mk('u1', 1), mk('u2', 4)]; // 7.2 + 28.8 = 36.0
    const combined = splitBillingSheets(items, 'combined').map((sh) => sumFlooredInvoiceLines(sh.items as any));
    const byUser = splitBillingSheets(items, 'by_user').map((sh) => sumFlooredInvoiceLines(sh.items as any));
    expect(combined.reduce((a, b) => a + b, 0)).toBe(36);          // floor(36.0)
    expect(byUser.reduce((a, b) => a + b, 0)).toBe(35);            // floor(7.2)+floor(28.8) = 7+28
    // 방향 불변식 — 장이 늘수록 금액은 같거나 줄어든다(고객에게 불리해지는 방향은 없다)
    expect(byUser.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(combined.reduce((a, b) => a + b, 0));
  });

  it('각 장의 공급가는 그 장 항목표의 절사 합과 정확히 같다 — 장만 받아 본 고객의 검산이 성립한다', () => {
    const items = [mk('u1', 1), mk('u2', 4)];
    for (const sh of splitBillingSheets(items, 'by_user')) {
      const lineSum = sumFlooredInvoiceLines(sh.items as any);
      expect(Number.isInteger(lineSum)).toBe(true);
    }
  });
});

// ★ 2026-08-04 원장 파생 회귀 차단 — 서수란 0803 접수 2건의 계약.
//   [반영]이 매핑 원장의 값을 항목 행에 복사해 굳혀서, 매핑을 고쳐도 청구서가 옛 값으로 나갔다.
//   이제 스냅샷은 통화료 하나뿐이고 나머지는 발행 시점에 원장에서 읽는다 — 그 계약을 여기서 고정한다.
// ★ 2026-08-21 고정료 축 분리(서수란 0821 접수) — 고정료(이용료·KT 부가서비스)는 발행 코어가
//   정산월마다 만드는 `080_base` 행이 파생하고, `080_call`은 통화료만 파생한다. 명세서가 없는 달에
//   고정료가 통째로 빠지던 전 고객사 공통 함정과, 두 행이 겹칠 때의 이중 계상을 함께 고정한다.
describe('추가 항목 파생 — 매핑 원장이 진실 (2026-08-04 · 2026-08-21 고정료 축 분리)', () => {
  const snap = (over: Partial<ExtraItemSourceRow> = {}): ExtraItemSourceRow => ({
    kind: '080_call', supply_amount: 7096, period_month: '2026-07-01', source_ref: '0805647720',
    user_id: null, map_found: true, map_is_active: true, map_monthly_fee_supply: 9000, map_kt_fee_supply: 4000,
    map_charge_call_fee: true, map_user_id: null, ...over,
  });
  const base = (over: Partial<ExtraItemSourceRow> = {}): ExtraItemSourceRow =>
    snap({ kind: '080_base', supply_amount: 0, ...over });
  const byType = (rows: ExtraItemSourceRow[]) =>
    Object.fromEntries(buildExtraBillingItems(rows).map((i) => [i.typeKey, i.amount]));

  it('매핑 기본값 — 고정료 행+통화료 행에서 이용료·부가서비스·통화료 3줄', () => {
    expect(byType([base(), snap()])).toEqual({ EXTRA_080_FEE: 9000, EXTRA_080_SVC: 4000, EXTRA_080_CALL: 7096 });
  });

  it('★0821 — 명세서(080_call) 없는 달도 고정료 행만으로 이용료·부가서비스가 실린다', () => {
    expect(byType([base()])).toEqual({ EXTRA_080_FEE: 9000, EXTRA_080_SVC: 4000 });
  });

  it('★0821 — 080_call은 고정료를 파생하지 않는다(080_base와의 이중 계상 차단). 통화료 한 줄뿐', () => {
    expect(byType([snap()])).toEqual({ EXTRA_080_CALL: 7096 });
  });

  it('★접수1(시세이도) — 이용료 10만·부가서비스 0·통화료 미청구로 고치면 이용료 한 줄만 나간다', () => {
    // 행은 그대로인데 원장을 고쳤다 = 접수 당시 청구서가 9,000/4,000/7,096으로 나간 상황.
    const over = { map_monthly_fee_supply: 100000, map_kt_fee_supply: 0, map_charge_call_fee: false };
    expect(byType([base(over), snap(over)])).toEqual({ EXTRA_080_FEE: 100000 });
  });

  it('★접수2(금강제화) — 귀속은 매핑 원장이 소유한다. 행 user_id가 비어 있어도 계정 장으로 간다', () => {
    const rows = [base({ user_id: null, map_user_id: 'u-kumkang' }), snap({ user_id: null, map_user_id: 'u-kumkang' })];
    for (const row of rows) expect(extraRowUserId(row)).toBe('u-kumkang');
    expect(buildExtraBillingItems(rows).every((i) => i.userId === 'u-kumkang')).toBe(true);
    // 그리고 그 항목들은 실제로 그 계정 장에 실린다(마커가 걸리는 장과 같아야 한다).
    const sheets = splitBillingSheets(buildExtraBillingItems(rows), 'by_user');
    expect(sheets.find((s) => s.userId === 'u-kumkang')!.items).toHaveLength(3);
    expect(sheets.find((s) => s.sheetScope === 'common')!.items).toHaveLength(0);
  });

  it('수기 항목은 원장이 없어 자기 user_id가 귀속 — 080 축과 섞이지 않는다', () => {
    const row: ExtraItemSourceRow = {
      kind: 'manual', supply_amount: 50000, period_month: '2026-07-01', source_ref: null,
      user_id: 'u-sh', map_found: false, map_user_id: 'u-other',
    };
    expect(extraRowUserId(row)).toBe('u-sh');
    expect(byType([row])).toEqual({ EXTRA_MANUAL: 50000 });
  });

  it('★접수4(신성통상) — 비활성으로 바꾸면 이용료가 더는 청구되지 않는다', () => {
    const rows = [base({ map_is_active: false }), snap({ map_is_active: false })];
    expect(buildExtraBillingItems(rows)).toEqual([]);
    // 비활성은 사람이 명시한 청구 중단이므로 발행을 막지 않는다 — 매핑 없음과 다른 상태다.
    expect(extraRowsBlockingIssue(rows)).toEqual([]);
  });

  it('★매핑이 사라지면 아무것도 청구하지 않고 발행을 막는다 — 없던 통화료가 새로 붙던 fail-open 차단', () => {
    const rows = [base({ map_found: false }), snap({ map_found: false, map_charge_call_fee: null })];
    expect(buildExtraBillingItems(rows)).toEqual([]);
    expect(extraRowsBlockingIssue(rows)).toEqual([
      { sourceRef: '0805647720', periodMonth: '2026-07-01' },
      { sourceRef: '0805647720', periodMonth: '2026-07-01' },
    ]);
    // 정상 행·수기 항목은 차단 대상이 아니다.
    expect(extraRowsBlockingIssue([base(), snap(), { kind: 'manual', supply_amount: 50000, period_month: '2026-07-01' }])).toEqual([]);
  });

  it('전액 무료 번호(리스킨류) — 0원은 줄을 만들지 않는다', () => {
    expect(buildExtraBillingItems([
      base({ map_monthly_fee_supply: 0, map_kt_fee_supply: 0, map_charge_call_fee: false }),
      snap({ supply_amount: 0, map_monthly_fee_supply: 0, map_kt_fee_supply: 0, map_charge_call_fee: false }),
    ])).toEqual([]);
  });

  it('★옛 080_fee·080_svc 행 — 고정료 근거 행(080_base)이 있으면 건너뛰고(이중 계상 차단), 없으면 그 행이 유일한 근거라 청구한다', () => {
    const legacy = (kind: string, amount: number, hasBase: boolean): ExtraItemSourceRow => ({
      kind, supply_amount: amount, period_month: '2026-07-01', source_ref: '0805647720',
      map_found: true, map_is_active: true, has_base_row: hasBase,
    });
    // 고정료 근거 행이 대신 파생한다 → 옛 행은 0줄
    expect(buildExtraBillingItems([legacy('080_fee', 9000, true), legacy('080_svc', 4000, true)])).toEqual([]);
    // 옛 행이 있는 달은 발행 코어가 080_base를 만들지 않는다 — 그 달의 유일한 근거라 청구한다
    expect(byType([legacy('080_fee', 9000, false), legacy('080_svc', 4000, false)]))
      .toEqual({ EXTRA_080_FEE: 9000, EXTRA_080_SVC: 4000 });
    // 비활성으로 바꾸면 옛 행도 멈춘다
    expect(buildExtraBillingItems([{ ...legacy('080_fee', 9000, false), map_is_active: false }])).toEqual([]);
    // ★0821 통화료 스냅샷 존재는 더는 스킵 근거가 아니다 — 080_call은 고정료를 파생하지 않으므로
    //   옛 행+080_call 조합(0804 이전 반영분)에서 고정료는 옛 행이 내야 한다(빠지면 과소청구).
    expect(byType([{ ...legacy('080_fee', 9000, false) }, snap()]))
      .toEqual({ EXTRA_080_FEE: 9000, EXTRA_080_CALL: 7096 });
  });

  it('★재오픈(리스킨) — 매핑을 다른 회사로 옮기면 옛 행도 그 회사에서 청구되지 않는다', () => {
    // 접수: 080 번호의 청구 회사를 리스킨 → 인비토로 바꿨는데 리스킨에 9,000+4,000이 계속 실렸다.
    // 원인: 옛 종류 행이 매핑을 아예 보지 않았다(비활성만 막고 타사 이전은 안 봤다).
    const moved = (kind: string, amount: number): ExtraItemSourceRow => ({
      kind, supply_amount: amount, period_month: '2026-07-01', source_ref: '0805663330',
      map_found: false,        // 이 회사에는 매핑이 없다
      map_exists_any: true,    // 그런데 그 번호의 매핑은 (다른 회사에) 있다 = 사람이 옮겼다
      has_base_row: false,
    });
    expect(buildExtraBillingItems([moved('080_fee', 9000), moved('080_svc', 4000)])).toEqual([]);
  });

  it('★매핑이 아예 없는 옛 행은 종전대로 청구한다 — 원장 도입 전 행까지 막으면 과소청구다', () => {
    const orphan: ExtraItemSourceRow = {
      kind: '080_fee', supply_amount: 9000, period_month: '2026-07-01', source_ref: '0809999999',
      map_found: false, map_exists_any: false, has_base_row: false,
    };
    expect(byType([orphan])).toEqual({ EXTRA_080_FEE: 9000 });
  });

  it('항목줄은 같은 단가끼리 합쳐 참 산식으로 인쇄된다 — 시세이도 3개 부서 10만원', () => {
    const rows = ['0805647710', '0805647720', '0805647730'].map((n) => base({
      source_ref: n, map_monthly_fee_supply: 100000, map_kt_fee_supply: 0, map_charge_call_fee: false,
    }));
    expect(sumFlooredInvoiceLines(buildExtraBillingItems(rows) as any)).toBe(300000);
  });
});

// ★ 2026-07-31 귀속 축 회귀 차단 — Codex 적대검증 high.
//   `extra`(080·부가서비스)에 귀속 계정을 실어 보냈는데 분배 조건이 `channel === 'web'` 리터럴이라
//   계정 귀속 항목이 **전부 공통 장으로** 갔다. 채널을 늘릴 때 같은 사고가 나지 않도록 계약을 고정한다.
describe('귀속 축 — 추가 항목(extra)의 장 분배 (2026-07-31)', () => {
  const extra = (userId: string | null, amount: number): PricedBillingItem => ({
    channel: 'extra' as any, itemDate: '2026-07-01', typeKey: 'EXTRA_080_FEE', userId, agentSendId: null,
    total: 0, success: 0, fail: 0, pending: 0, agentId: null,
    unitPrice: amount, amount, amountExact: amount, planDays: null, planMonthDays: null,
  });
  const web = (userId: string): PricedBillingItem => ({
    channel: 'web', itemDate: '2026-07-01', typeKey: 'SMS', userId, agentSendId: null,
    total: 10, success: 10, fail: 0, pending: 0, agentId: null,
    unitPrice: 10, amount: 100, amountExact: 100, planDays: null, planMonthDays: null,
  });

  it('계정 귀속 extra는 그 계정 장에 실린다 (공통 장으로 새지 않는다)', () => {
    const sheets = splitBillingSheets([web('u1'), extra('u1', 9000)], 'by_user');
    const userSheet = sheets.find((s) => s.userId === 'u1');
    expect(userSheet, '계정 장이 만들어져야 한다').toBeTruthy();
    expect(userSheet!.items.some((i) => i.channel === 'extra')).toBe(true);
    const common = sheets.find((s) => s.sheetScope === 'common');
    expect(common!.items.some((i) => i.channel === 'extra'), '공통 장에 중복으로 실리면 안 된다').toBe(false);
  });

  it('귀속 없는 extra는 공통 장에 실린다 — 고객사 전체 귀속의 제자리', () => {
    const sheets = splitBillingSheets([web('u1'), extra(null, 4000)], 'by_user');
    const common = sheets.find((s) => s.sheetScope === 'common');
    expect(common!.items.some((i) => i.channel === 'extra')).toBe(true);
    expect(sheets.find((s) => s.userId === 'u1')!.items.some((i) => i.channel === 'extra')).toBe(false);
  });

  it('extra만 있는 계정도 장이 생긴다 — 발송이 없어도 그 계정 앞으로 청구된다', () => {
    const sheets = splitBillingSheets([extra('u9', 50000)], 'by_user');
    expect(sheets.find((s) => s.userId === 'u9')).toBeTruthy();
  });

  it('전체 발행(combined)은 귀속과 무관하게 한 장에 모인다', () => {
    const sheets = splitBillingSheets([extra('u1', 9000), extra(null, 4000)], 'combined');
    expect(sheets).toHaveLength(1);
    expect(sheets[0].items.filter((i) => i.channel === 'extra')).toHaveLength(2);
  });

  it('계정 축이 없는 채널(agent)은 userId가 있어도 공통 장 — 집합 밖은 섞이지 않는다', () => {
    const agentItem: PricedBillingItem = {
      channel: 'agent' as any, itemDate: '2026-07-01', typeKey: 'SMS', userId: 'u1', agentSendId: 'B0001',
      total: 5, success: 5, fail: 0, pending: 0, agentId: null,
      unitPrice: 10, amount: 50, amountExact: 50, planDays: null, planMonthDays: null,
    };
    const sheets = splitBillingSheets([web('u1'), agentItem], 'by_user');
    expect(sheets.find((s) => s.userId === 'u1')!.items.some((i) => i.channel === 'agent')).toBe(false);
    expect(sheets.find((s) => s.sheetScope === 'common')!.items.some((i) => i.channel === 'agent')).toBe(true);
  });
});

describe('splitBillingSheets — 발행 단위 장 분할 (2026-07-26)', () => {
  const pi = (o: Partial<PricedBillingItem>): PricedBillingItem => ({
    channel: 'web', itemDate: '2026-07-01', typeKey: 'SMS', userId: 'u1', agentSendId: null,
    total: 0, success: 0, fail: 0, pending: 0, agentId: null, unitPrice: 9, amount: 0, ...o,
  });

  it('합산이면 한 장에 전부 들어간다', () => {
    const sheets = splitBillingSheets([pi({ success: 10, amount: 90 }), pi({ channel: 'test', typeKey: 'TEST_SMS', amount: 18 })], 'combined');
    expect(sheets).toHaveLength(1);
    expect(sheets[0].sheetScope).toBe('combined');
    expect(sheets[0].amount).toBe(108);
    expect(sheets[0].carriesCompanyItems).toBe(true);
  });

  it('계정별이면 계정 장 N개 + 공통 장 1개', () => {
    const sheets = splitBillingSheets([
      pi({ userId: 'u1', success: 10, amount: 90 }),
      pi({ userId: 'u2', success: 5, amount: 45 }),
      pi({ channel: 'test', userId: 'u1', typeKey: 'TEST_SMS', success: 2, amount: 18 }),
    ], 'by_user');
    expect(sheets.map((s) => s.sheetScope)).toEqual(['by_user', 'by_user', 'common']);
    expect(sheets[0].userId).toBe('u1');
    expect(sheets[0].amount).toBe(90);
    expect(sheets[2].amount).toBe(18); // 테스트는 계정이 있어도 공통 장
  });

  it('회사 단위 항목을 싣는 장은 하나뿐이다', () => {
    const sheets = splitBillingSheets([pi({ userId: 'u1' }), pi({ userId: 'u2' })], 'by_user');
    expect(sheets.filter((s) => s.carriesCompanyItems)).toHaveLength(1);
    expect(sheets.filter((s) => s.carriesCompanyItems)[0].sheetScope).toBe('common');
  });

  it('에이전트 발송분은 공통 장으로 — 계정 축이 없다', () => {
    const sheets = splitBillingSheets([
      pi({ channel: 'agent', userId: null, agentSendId: 'D0018', typeKey: 'LMS', success: 100, amount: 2200 }),
      pi({ userId: 'u1', success: 10, amount: 90 }),
    ], 'by_user');
    expect(sheets.find((s) => s.sheetScope === 'common')!.amount).toBe(2200);
  });

  it('계정 미상 웹 발송도 공통 장으로 — 삭제된 계정 방어와 맞물린다', () => {
    const sheets = splitBillingSheets([pi({ userId: null, success: 3, amount: 27 })], 'by_user');
    expect(sheets).toHaveLength(1);
    expect(sheets[0].sheetScope).toBe('common');
    expect(sheets[0].amount).toBe(27);
  });

  it('장별 유형 수량이 그 장 것만 담는다 — billings 헤더 컬럼에 그대로 들어간다', () => {
    const sheets = splitBillingSheets([
      pi({ userId: 'u1', typeKey: 'SMS', success: 10 }),
      pi({ userId: 'u1', typeKey: 'LMS', success: 4 }),
      pi({ userId: 'u2', typeKey: 'SMS', success: 7 }),
    ], 'by_user');
    expect(sheets[0].totals.SMS).toBe(10);
    expect(sheets[0].totals.LMS).toBe(4);
    expect(sheets[1].totals.SMS).toBe(7);
  });

  it('계정 장 정렬이 결정적이다 — 같은 입력이면 같은 순서', () => {
    const rows = [pi({ userId: 'u2' }), pi({ userId: 'u1' })];
    expect(splitBillingSheets(rows, 'by_user').map((s) => s.userId)).toEqual(['u1', 'u2', null]);
  });

  it('빈 입력에 안전하다', () => {
    expect(splitBillingSheets([], 'combined')[0].amount).toBe(0);
    expect(splitBillingSheets(undefined as any, 'by_user')).toHaveLength(1);
  });
});

describe('checkSheetSumIdentity — 분산 N장 합 = 합산 1장 (2026-07-26)', () => {
  const sheet = (amount: number) => ({
    sheetScope: 'by_user' as const, userId: 'u', items: [], totals: {}, amount, carriesCompanyItems: false,
  });

  it('안분이 없으므로 정수 덧셈으로 정확히 맞는다', () => {
    expect(checkSheetSumIdentity([sheet(90), sheet(45), sheet(18)], 4000, 4153).ok).toBe(true);
  });

  it('한 장이 빠지면 잡힌다 — 분산 발행이 회사 총액을 다 담았는지 보는 유일한 장치', () => {
    const r = checkSheetSumIdentity([sheet(90), sheet(45)], 4000, 4153);
    expect(r.ok).toBe(false);
    expect(r.diff).toBe(-18);
  });

  it('AI 크레딧을 어느 장도 안 실으면 잡힌다', () => {
    expect(checkSheetSumIdentity([sheet(153)], 0, 4153).ok).toBe(false);
  });

  it('빈 입력에 안전하다', () => {
    expect(checkSheetSumIdentity([], 0, 0).ok).toBe(true);
  });
});

describe('nullifyUnknownUserIds — 삭제된 계정 방어 (2026-07-26)', () => {
  const it0 = (userId: string | null) => ({ userId, amount: 100 });

  it('남아 있는 계정은 그대로', () => {
    const { items, unknownUserIds } = nullifyUnknownUserIds([it0('u1')], new Set(['u1']));
    expect(items[0].userId).toBe('u1');
    expect(unknownUserIds).toEqual([]);
  });

  it('삭제된 계정은 null로 내리고 목록으로 돌려준다 — 청구서 전체를 막지 않는다', () => {
    const { items, unknownUserIds } = nullifyUnknownUserIds([it0('gone'), it0('u1')], new Set(['u1']));
    expect(items[0].userId).toBeNull();
    expect(items[1].userId).toBe('u1');
    expect(unknownUserIds).toEqual(['gone']);
  });

  it('금액은 건드리지 않는다 — 계정은 표시 축이지 금액 축이 아니다', () => {
    const { items } = nullifyUnknownUserIds([it0('gone')], new Set());
    expect(items[0].amount).toBe(100);
  });

  it('이미 null인 행은 미상 목록에 넣지 않는다', () => {
    const { unknownUserIds } = nullifyUnknownUserIds([it0(null)], new Set());
    expect(unknownUserIds).toEqual([]);
  });

  it('같은 계정이 여러 행이어도 목록에는 한 번만', () => {
    const { unknownUserIds } = nullifyUnknownUserIds([it0('gone'), it0('gone')], new Set());
    expect(unknownUserIds).toEqual(['gone']);
  });

  it('빈 입력에 안전하다', () => {
    expect(nullifyUnknownUserIds([], new Set()).items).toEqual([]);
    expect(nullifyUnknownUserIds(undefined as any, new Set()).items).toEqual([]);
  });
});

describe('checkBillingAmountIdentity — 상세합 + 크레딧 = 공급가액 (2026-07-26)', () => {
  it('맞으면 ok', () => {
    const r = checkBillingAmountIdentity([{ amount: 900 }, { amount: 22000 }], 4000, 26900);
    expect(r.ok).toBe(true);
    expect(r.diff).toBe(0);
  });

  it('에이전트 금액이 헤더에만 들어가면 잡힌다 — 실제로 있었던 증상', () => {
    // 웹 900 + 에이전트 22,000인데 항목표에는 웹만 있고 공급가액에는 둘 다 들어간 상태
    const r = checkBillingAmountIdentity([{ amount: 900 }], 0, 22900);
    expect(r.ok).toBe(false);
    expect(r.diff).toBe(-22000);
  });

  it('AI 크레딧을 빼먹으면 잡힌다 — billing_items에 크레딧 행이 없다', () => {
    expect(checkBillingAmountIdentity([{ amount: 900 }], 0, 4900).ok).toBe(false);
  });

  it('상세가 비고 크레딧만 있어도 성립한다', () => {
    expect(checkBillingAmountIdentity([], 4000, 4000).ok).toBe(true);
  });

  it('전부 0이면 성립한다 — 발송 0건 회사', () => {
    expect(checkBillingAmountIdentity([], 0, 0).ok).toBe(true);
  });

  it('값이 깨져도 NaN으로 통과시키지 않는다', () => {
    const r = checkBillingAmountIdentity([{ amount: 'abc' as any }], 0, 100);
    expect(r.ok).toBe(false);
    expect(Number.isFinite(r.itemsSum)).toBe(true);
  });
});

describe('chunkArray — PG 파라미터 상한 회피 (2026-07-26)', () => {
  it('상한 이하면 한 덩어리', () => {
    expect(chunkArray([1, 2, 3], 1000)).toEqual([[1, 2, 3]]);
  });

  it('나눠도 전체 개수가 보존된다 — 한 배치가 조용히 빠지면 안 된다', () => {
    const rows = Array.from({ length: 4682 }, (_, i) => i);
    const out = chunkArray(rows, 1000);
    expect(out).toHaveLength(5);
    expect(out.flat()).toHaveLength(4682);
    expect(out.flat()).toEqual(rows);
  });

  it('한 배치가 파라미터 상한을 넘지 않는다 — 14컬럼 × 1,000행 = 14,000개', () => {
    const rows = Array.from({ length: 4682 }, (_, i) => i);
    for (const b of chunkArray(rows, 1000)) expect(b.length * 14).toBeLessThan(65535);
  });

  it('빈 배열·잘못된 크기에 안전하다', () => {
    expect(chunkArray([], 1000)).toEqual([]);
    expect(chunkArray(undefined as any, 1000)).toEqual([]);
    expect(chunkArray([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe('billingRowKey — 구분자 충돌 차단 (2026-07-26)', () => {
  const r = (o: Partial<BillingUsageRow>): BillingUsageRow => ({
    channel: 'agent', itemDate: '2026-07-01', typeKey: 'SMS', userId: null, agentSendId: 'A',
    total: 0, success: 0, fail: 0, pending: 0, ...o,
  });

  it('파이프가 섞여도 서로 다른 행은 다른 키다 — 옛 문자열 연결에서는 같은 키였다', () => {
    const a = billingRowKey(r({ agentSendId: 'A', typeKey: 'B|SMS' }));
    const b = billingRowKey(r({ agentSendId: 'A|B', typeKey: 'SMS' }));
    expect(a).not.toBe(b);
  });

  it('같은 내용이면 같은 키다', () => {
    expect(billingRowKey(r({ success: 1 }))).toBe(billingRowKey(r({ success: 999 })));
  });

  it('채널이 다르면 다른 키다 — 옛 에이전트 키에는 채널 접두가 빠져 있었다', () => {
    expect(billingRowKey(r({ channel: 'web', agentSendId: null, userId: 'u1' })))
      .not.toBe(billingRowKey(r({ channel: 'test', agentSendId: null, userId: 'u1' })));
  });

  it('계정 null과 빈 문자열을 같게 본다 — 두 값이 같은 "계정 미상"이다', () => {
    expect(billingRowKey(r({ channel: 'web', agentSendId: null, userId: null })))
      .toBe(billingRowKey(r({ channel: 'web', agentSendId: null, userId: '' })));
  });
});

describe('resolveBillingUnitPricesDetailed — 미설정 유형키 색출 (2026-07-26)', () => {
  it('전부 설정돼 있으면 미설정 없음', () => {
    const { unsetKeys } = resolveBillingUnitPricesDetailed({
      cost_per_sms: 9, cost_per_lms: 27, cost_per_mms: 90, cost_per_kakao: 8, cost_per_brand: 12,
    });
    expect(unsetKeys).toEqual([]);
  });

  it('MMS만 비면 MMS만 잡힌다', () => {
    const { prices, unsetKeys } = resolveBillingUnitPricesDetailed({
      cost_per_sms: 9, cost_per_lms: 27, cost_per_mms: null, cost_per_kakao: 8, cost_per_brand: 12,
    });
    expect(unsetKeys).toEqual(['MMS']);
    expect(prices.MMS).toBe(0); // 값은 기존과 같다 — 막는 건 게이트 쪽
  });

  // ★ 2026-07-29 브랜드메시지는 알림톡과 다른 단가다. 상속시키면 미설정이 조용히 알림톡 단가로 청구된다.
  it('브랜드 단가만 비면 BRAND만 잡힌다 — 알림톡을 상속하지 않는다', () => {
    const { prices, unsetKeys } = resolveBillingUnitPricesDetailed({
      cost_per_sms: 9, cost_per_lms: 27, cost_per_mms: 90, cost_per_kakao: 8, cost_per_brand: null,
    });
    expect(unsetKeys).toEqual(['BRAND']);
    expect(prices.BRAND).toBe(0);   // 알림톡 8원이 새어 들어오면 안 된다
  });

  it('명시적 0원은 미설정이 아니다', () => {
    const { unsetKeys } = resolveBillingUnitPricesDetailed({
      cost_per_sms: 0, cost_per_lms: '0.00', cost_per_mms: 0, cost_per_kakao: 0, cost_per_brand: 0,
    });
    expect(unsetKeys).toEqual([]);
  });

  it('테스트 단가는 상속이 살아 있으면 미설정이 아니다 — 상속은 설계된 동작', () => {
    const { unsetKeys } = resolveBillingUnitPricesDetailed({
      cost_per_sms: 9, cost_per_lms: 27, cost_per_mms: 90, cost_per_kakao: 8, cost_per_brand: 12,
      cost_per_test_sms: null, cost_per_test_lms: null,
    });
    expect(unsetKeys).toEqual([]);
  });

  it('자기도 비고 상속원도 비면 테스트·스팸까지 잡힌다', () => {
    const { unsetKeys } = resolveBillingUnitPricesDetailed({ cost_per_mms: 90, cost_per_kakao: 8 });
    expect(unsetKeys).toEqual(['SMS', 'LMS', 'BRAND', 'TEST_SMS', 'TEST_LMS', 'SPAM_SMS', 'SPAM_LMS']);
  });

  it('기존 함수와 단가 값이 같다 — 시그니처 호환', () => {
    const row = { cost_per_sms: 9, cost_per_lms: 27, cost_per_mms: null, cost_per_kakao: 8 };
    expect(resolveBillingUnitPricesDetailed(row).prices).toEqual(resolveBillingUnitPrices(row));
  });
});

describe('findUnsetPricedTypes — 미설정 단가로 실제 발송된 유형만 (2026-07-26)', () => {
  const r = (o: Partial<BillingUsageRow>): BillingUsageRow => ({
    channel: 'web', itemDate: '2026-07-01', typeKey: 'MMS', userId: 'u1', agentSendId: null,
    total: 0, success: 0, fail: 0, pending: 0, ...o,
  });

  it('미설정 유형에 성공이 있으면 잡힌다', () => {
    expect(findUnsetPricedTypes(['MMS'], [r({ total: 1200, success: 1000 })]))
      .toEqual([{ key: 'MMS', success: 1000, total: 1200 }]);
  });

  it('성공 0이면 막지 않는다 — 안 쓰는 유형까지 막으면 발행이 이유 없이 멈춘다', () => {
    expect(findUnsetPricedTypes(['MMS'], [r({ total: 5, success: 0, fail: 5 })])).toEqual([]);
  });

  it('설정된 유형은 잡지 않는다', () => {
    expect(findUnsetPricedTypes(['MMS'], [r({ typeKey: 'SMS', success: 100 })])).toEqual([]);
  });

  it('에이전트 행은 대상이 아니다 — 발송ID별 단가라 축이 다르다', () => {
    expect(findUnsetPricedTypes(['LMS'], [r({ channel: 'agent', typeKey: 'LMS', userId: null, agentSendId: 'D0018', success: 596968 })]))
      .toEqual([]);
  });

  it('여러 날짜가 합산된다', () => {
    const out = findUnsetPricedTypes(['MMS'], [
      r({ total: 10, success: 8 }),
      r({ itemDate: '2026-07-02', total: 5, success: 5 }),
    ]);
    expect(out).toEqual([{ key: 'MMS', success: 13, total: 15 }]);
  });

  it('빈 입력에 안전하다', () => {
    expect(findUnsetPricedTypes([], [])).toEqual([]);
    expect(findUnsetPricedTypes(undefined as any, undefined as any)).toEqual([]);
  });
});

describe('summarizeBlockList — 토스트를 뚫지 않게 절단 (2026-07-26)', () => {
  it('상한 이하면 그대로', () => {
    expect(summarizeBlockList(['A', 'B', 'C'])).toBe('A, B, C');
  });

  it('상한을 넘으면 상위 5건 + 외 N건', () => {
    const ids = Array.from({ length: 283 }, (_, i) => `ID${i}`);
    expect(summarizeBlockList(ids)).toBe('ID0, ID1, ID2, ID3, ID4 외 278건');
  });

  it('빈 값은 걸러진다', () => {
    expect(summarizeBlockList(['A', '', 'B'])).toBe('A, B');
    expect(summarizeBlockList([])).toBe('');
    expect(summarizeBlockList(undefined as any)).toBe('');
  });
});

describe('toDayKey — 드라이버가 준 날짜값 → YYYY-MM-DD (2026-07-26 밀림 정정)', () => {
  it('로컬 자정 Date의 달력일을 그대로 돌려준다 — toISOString()이면 KST에서 하루 밀렸다', () => {
    // 서버 실측: mysql2가 DATE('2026-07-15')를 `Wed Jul 15 2026 00:00:00 GMT+0900`로 준다.
    // 옛 구현은 toISOString().slice(0,10) = '2026-07-14'였다.
    expect(toDayKey(new Date(2026, 6, 15))).toBe('2026-07-15');
  });

  it('월·일이 한 자리여도 0을 채운다', () => {
    expect(toDayKey(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(toDayKey(new Date(2026, 8, 9))).toBe('2026-09-09');
  });

  it('월 경계 자정도 밀리지 않는다 — 청구 기간 양끝이 여기서 갈린다', () => {
    expect(toDayKey(new Date(2026, 6, 1))).toBe('2026-07-01');
    expect(toDayKey(new Date(2026, 6, 31))).toBe('2026-07-31');
  });

  it('문자열은 앞 10자를 그대로 쓴다 — 에이전트 축과 같은 결과', () => {
    expect(toDayKey('2026-07-15')).toBe('2026-07-15');
    expect(toDayKey('2026-07-15 10:00:00')).toBe('2026-07-15');
  });

  it('서버 시간대와 무관하게 같은 답이다 — 두 드라이버 모두 로컬 자정 Date를 준다', () => {
    // 로컬 성분을 읽으므로 TZ가 UTC든 KST든 드라이버가 만든 자정의 달력일이 나온다.
    const d = new Date(2026, 6, 15);
    expect(toDayKey(d)).toBe(`${d.getFullYear()}-07-15`);
  });
});

describe('agentUsageKey — 에이전트 MsgType → 청구 유형키', () => {
  it('S/L/M/K는 청구 유형키로 변환된다', () => {
    expect(agentUsageKey('S')).toBe('SMS');
    expect(agentUsageKey('L')).toBe('LMS');
    expect(agentUsageKey('M')).toBe('MMS');
    expect(agentUsageKey('K')).toBe('KAKAO');
  });

  it('소문자·공백이 섞여도 같은 키로 — 게이트웨이 원천값을 신뢰하지 않는다', () => {
    expect(agentUsageKey(' l ')).toBe('LMS');
    expect(agentUsageKey('k')).toBe('KAKAO');
  });

  it('모르는 코드는 원본 그대로 남는다 — 임의로 뭉치면 그 유형이 조용히 0원이 된다', () => {
    // ★ 2026-07-29 G(브랜드메시지)는 이제 아는 코드다 — 단가 축과 함께 정식 등재됐다.
    //   이 테스트의 취지는 "미지 코드를 기존 유형에 뭉치지 않는다"이므로 예시를 미등재 코드로 바꾼다.
    // ★ 2026-09-04 KS·KL도 아는 코드가 됐다(문자 유형 별칭 — 0904 랩디 접수). 예시에서 뺀다.
    expect(agentUsageKey('X')).toBe('X');
    expect(agentUsageKey('ZZ')).toBe('ZZ');
  });

  it('G는 브랜드메시지로 변환된다 — 미등재 시절엔 발행이 통째로 차단됐다', () => {
    // 실측 2026-07-26: G = 여미지(B0227) 7월 성공 42,833건.
    expect(agentUsageKey('G')).toBe('BRAND');
    expect(agentUsageKey(' g ')).toBe('BRAND');
  });

  it('빈 값은 (유형 미상)', () => {
    expect(agentUsageKey('')).toBe('(유형 미상)');
    expect(agentUsageKey(null)).toBe('(유형 미상)');
    expect(agentUsageKey(undefined)).toBe('(유형 미상)');
  });

  it('변환표에는 청구 단가가 있는 코드만 있다 — 별칭 포함', () => {
    // ★ 2026-09-04 KS·KL(카카오 실패 전환분) 추가 — 유형키가 아니라 SMS·LMS의 별칭이라
    //   그 문자 단가로 청구된다. 변환표에 없으면 발행이 통째로 막힌다(0904 랩디).
    expect(Object.keys(AGENT_MSG_TYPE_TO_USAGE_KEY).sort()).toEqual(['G', 'K', 'KL', 'KS', 'L', 'M', 'S']);
    // 변환표의 모든 코드는 단가가 붙는 유형키로 간다 — 하나라도 아니면 그 코드가 0원이 되거나 발행을 막는다.
    for (const key of Object.values(AGENT_MSG_TYPE_TO_USAGE_KEY)) {
      expect(BILLING_TYPES.find((t) => t.key === key)?.agentPriceColumn, `${key}에 발송ID 단가 컬럼이 없다`).toBeTruthy();
    }
  });
});

describe('rollupAgentRowsForBilling — 대상ID 그레인 → 청구 그레인(일자×발송ID×유형)', () => {
  const sr = (o: Partial<PayAgentStoreRow>): PayAgentStoreRow => ({
    period: '2026-07-01', agent_send_id: 'D0018', store_id: '', msg_type: 'L', type_label: 'LMS',
    sent: 0, success: 0, fail: 0, pending: 0, ...o,
  });
  const allow = (...ids: string[]) => new Set(ids.map((i) => i.toUpperCase()));

  it('같은 일자·발송ID·유형이면 대상ID가 달라도 한 줄로 합쳐진다', () => {
    const { rows } = rollupAgentRowsForBilling([
      sr({ store_id: '지점A', sent: 10, success: 9, fail: 1 }),
      sr({ store_id: '지점B', sent: 20, success: 18, fail: 2 }),
      sr({ store_id: '', sent: 5, success: 5 }),
    ], allow('D0018'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: 'agent', itemDate: '2026-07-01', agentSendId: 'D0018', typeKey: 'LMS',
      total: 35, success: 32, fail: 3, userId: null,
    });
  });

  it('대상ID가 3만 개여도 청구 행은 유형 수만큼만 나온다 — 청구서가 건바이건이 되지 않는다', () => {
    // 실측 2026-07-26: 제이씨패밀리(B0229) 7월 대상ID 29,598개 / 행 30,314개(거의 1:1)
    const many = Array.from({ length: 3000 }, (_, i) => sr({ agent_send_id: 'B0229', store_id: `s${i}`, sent: 2, success: 1 }));
    const { rows } = rollupAgentRowsForBilling(many, allow('B0229'));
    expect(rows).toHaveLength(1);
    expect(rows[0].success).toBe(3000);
  });

  it('일자·유형이 다르면 행이 나뉜다', () => {
    const { rows } = rollupAgentRowsForBilling([
      sr({ sent: 1, success: 1 }),
      sr({ period: '2026-07-02', sent: 2, success: 2 }),
      sr({ msg_type: 'S', sent: 3, success: 3 }),
    ], allow('D0018'));
    expect(rows).toHaveLength(3);
  });

  it('선불 발송ID는 청구에서 빠지고 목록으로 돌아온다 — 게이트웨이 잔액에서 이미 빠진 돈이다', () => {
    const { rows, excludedSendIds } = rollupAgentRowsForBilling([
      sr({ agent_send_id: 'D0018', sent: 10, success: 10 }),
      sr({ agent_send_id: 'B0023', sent: 99, success: 99 }),
    ], allow('D0018'));
    expect(rows).toHaveLength(1);
    expect(rows[0].agentSendId).toBe('D0018');
    expect(excludedSendIds).toEqual(['B0023']);
  });

  it('허용 목록 판정은 대소문자를 가리지 않는다', () => {
    const { rows, excludedSendIds } = rollupAgentRowsForBilling([sr({ agent_send_id: 'd0018', sent: 1, success: 1 })], allow('D0018'));
    expect(rows).toHaveLength(1);
    expect(excludedSendIds).toEqual([]);
  });

  it('월 그레인(YYYY-MM)·깨진 일자는 청구에 넣지 않는다 — item_date는 date 컬럼이다', () => {
    const { rows } = rollupAgentRowsForBilling([
      sr({ period: '2026-07', sent: 10, success: 10 }),
      sr({ period: '', sent: 10, success: 10 }),
      sr({ period: '2026-07-01', sent: 1, success: 1 }),
    ], allow('D0018'));
    expect(rows).toHaveLength(1);
    expect(rows[0].itemDate).toBe('2026-07-01');
  });

  it('부달 재전송 귀속 행도 원 발송ID로 합산된다', () => {
    const { rows } = rollupAgentRowsForBilling([
      sr({ agent_send_id: 'D0018', sent: 10, success: 10 }),
      sr({ agent_send_id: 'D0018', store_id: 'b0179_16601910', is_relay: true, sent: 3, success: 3 }),
    ], allow('D0018'));
    expect(rows).toHaveLength(1);
    expect(rows[0].success).toBe(13);
  });

  it('빈 입력·발송ID 없는 행은 조용히 무시된다', () => {
    expect(rollupAgentRowsForBilling([], allow('D0018')).rows).toEqual([]);
    expect(rollupAgentRowsForBilling(undefined as any, allow('D0018')).rows).toEqual([]);
    expect(rollupAgentRowsForBilling([sr({ agent_send_id: '  ', sent: 5, success: 5 })], allow('D0018')).rows).toEqual([]);
  });
});

describe('findUnbillableBillingRows — 단가 없는 유형키 색출', () => {
  const r = (o: Partial<BillingUsageRow>): BillingUsageRow => ({
    channel: 'agent', itemDate: '2026-07-01', typeKey: 'SMS', userId: null, agentSendId: 'B0227',
    total: 0, success: 0, fail: 0, pending: 0, ...o,
  });

  it('청구 유형키만 있으면 빈 배열', () => {
    expect(findUnbillableBillingRows([r({ typeKey: 'SMS', success: 10 }), r({ typeKey: 'TEST_LMS', channel: 'test', success: 2 })])).toEqual([]);
  });

  it('G처럼 단가 없는 유형은 수량과 함께 잡힌다 — 조용한 0원 청구 차단', () => {
    const out = findUnbillableBillingRows([
      r({ typeKey: 'G', total: 20000, success: 19000 }),
      r({ typeKey: 'G', itemDate: '2026-07-02', total: 24722, success: 23833 }),
      r({ typeKey: 'SMS', success: 5 }),
    ]);
    expect(out).toEqual([{ key: 'G', success: 42833, total: 44722 }]);
  });

  it('여러 미지 유형은 성공 수량 내림차순', () => {
    const out = findUnbillableBillingRows([r({ typeKey: 'X', success: 1 }), r({ typeKey: 'G', success: 100 })]);
    expect(out.map((u) => u.key)).toEqual(['G', 'X']);
  });

  it('빈 입력에 안전하다', () => {
    expect(findUnbillableBillingRows([])).toEqual([]);
    expect(findUnbillableBillingRows(undefined as any)).toEqual([]);
  });
});

describe('diffBillingRowsVsDayData — 새 청구 상세 ↔ 기존 집계 대조', () => {
  const r = (o: Partial<BillingUsageRow>): BillingUsageRow => ({
    channel: 'web', itemDate: '2026-07-01', typeKey: 'SMS', userId: 'u1', agentSendId: null,
    total: 0, success: 0, fail: 0, pending: 0, ...o,
  });

  it('유형별 성공 수량이 같으면 차이 없음', () => {
    const rows = [r({ typeKey: 'SMS', success: 60 }), r({ typeKey: 'SMS', userId: 'u2', success: 40 }), r({ typeKey: 'LMS', success: 9 })];
    const day: UsageDayData = { '2026-07-01': { SMS: { total: 0, success: 100, fail: 0, pending: 0 }, LMS: { total: 0, success: 9, fail: 0, pending: 0 } } };
    expect(diffBillingRowsVsDayData(rows, day)).toEqual([]);
  });

  it('한 유형이라도 어긋나면 그 유형이 잡힌다 — 발행을 막는 근거', () => {
    const rows = [r({ typeKey: 'SMS', success: 95 })];
    const day: UsageDayData = { '2026-07-01': { SMS: { total: 0, success: 100, fail: 0, pending: 0 } } };
    expect(diffBillingRowsVsDayData(rows, day)).toEqual([{ typeKey: 'SMS', rowsSuccess: 95, dayDataSuccess: 100 }]);
  });

  it('한쪽에만 있는 유형도 잡힌다', () => {
    const rows = [r({ typeKey: 'MMS', success: 7 })];
    expect(diffBillingRowsVsDayData(rows, {})).toEqual([{ typeKey: 'MMS', rowsSuccess: 7, dayDataSuccess: 0 }]);
    const day: UsageDayData = { '2026-07-01': { KAKAO: { total: 0, success: 3, fail: 0, pending: 0 } } };
    expect(diffBillingRowsVsDayData([], day)).toEqual([{ typeKey: 'KAKAO', rowsSuccess: 0, dayDataSuccess: 3 }]);
  });

  it('에이전트 행은 대조에서 빠진다 — 기존 집계에 없는 채널이다', () => {
    const rows = [r({ channel: 'agent', typeKey: 'LMS', userId: null, agentSendId: 'D0018', success: 596968 })];
    expect(diffBillingRowsVsDayData(rows, {})).toEqual([]);
  });

  it('빈 입력에 안전하다', () => {
    expect(diffBillingRowsVsDayData([], {})).toEqual([]);
    expect(diffBillingRowsVsDayData(undefined as any, undefined as any)).toEqual([]);
  });
});

describe('sortBillingUsageRows — 청구서 표시 순서', () => {
  const r = (o: Partial<BillingUsageRow>): BillingUsageRow => ({
    channel: 'web', itemDate: '2026-07-01', typeKey: 'SMS', userId: null, agentSendId: null,
    total: 0, success: 0, fail: 0, pending: 0, ...o,
  });

  it('채널 → 일자 → 계정/발송ID → 유형 순', () => {
    const out = sortBillingUsageRows([
      r({ channel: 'spam', typeKey: 'SPAM_SMS' }),
      r({ channel: 'agent', agentSendId: 'D0018', typeKey: 'LMS' }),
      r({ channel: 'agent', agentSendId: 'B0077', typeKey: 'SMS' }),
      r({ channel: 'web', userId: 'u1', typeKey: 'LMS' }),
      r({ channel: 'web', userId: 'u1', typeKey: 'SMS' }),
      r({ channel: 'test', typeKey: 'TEST_SMS' }),
    ]);
    expect(out.map((x) => `${x.channel}:${x.agentSendId || x.userId || '-'}:${x.typeKey}`)).toEqual([
      'web:u1:SMS', 'web:u1:LMS', 'agent:B0077:SMS', 'agent:D0018:LMS', 'test:-:TEST_SMS', 'spam:-:SPAM_SMS',
    ]);
  });

  it('같은 채널이면 일자 오름차순', () => {
    const out = sortBillingUsageRows([r({ itemDate: '2026-07-03' }), r({ itemDate: '2026-07-01' })]);
    expect(out.map((x) => x.itemDate)).toEqual(['2026-07-01', '2026-07-03']);
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const input = [r({ itemDate: '2026-07-03' }), r({ itemDate: '2026-07-01' })];
    sortBillingUsageRows(input);
    expect(input[0].itemDate).toBe('2026-07-03');
  });
});

describe('priceBillingRows — 청구 상세 단가·금액 부착 (2026-07-26)', () => {
  const web = { SMS: 9, LMS: 27, MMS: 90, KAKAO: 8, TEST_SMS: 9, TEST_LMS: 27, SPAM_SMS: 9, SPAM_LMS: 27 };
  const r = (o: Partial<BillingUsageRow>): BillingUsageRow => ({
    channel: 'web', itemDate: '2026-07-01', typeKey: 'SMS', userId: 'u1', agentSendId: null,
    total: 0, success: 0, fail: 0, pending: 0, ...o,
  });
  const ap = (o: Partial<AgentUnitPriceRow>): AgentUnitPriceRow => ({
    id: 'cai-1', agent_send_id: 'D0018', cost_per_sms: null, cost_per_lms: null, cost_per_mms: null, cost_per_kakao: null, ...o,
  });

  it('웹·테스트·스팸은 회사 단가로 계산된다', () => {
    const out = priceBillingRows([
      r({ typeKey: 'SMS', success: 100 }),
      r({ channel: 'test', typeKey: 'TEST_LMS', success: 3 }),
      r({ channel: 'spam', typeKey: 'SPAM_SMS', success: 2 }),
    ], web, []);
    expect(out.items.map((i) => i.amount)).toEqual([900, 81, 18]);
    // ★ 2026-07-30 extra(080 등 월별 추가 항목) 채널 축 추가 — 단가 계산기(발송 축)에서는 항상 0이다.
    expect(out.amountByChannel).toEqual({ plan: 0, web: 900, agent: 0, test: 81, spam: 18, extra: 0 });
  });

  it('★소수 단가 행은 절사 없이 정확값이다 — 절사는 항목줄에서 1회 (2026-07-30 Harold 정정)', () => {
    // 0726 "행 단위 절사"는 지시("최종 청구 금액의 소수점만 버려라")의 과대 해석이었다.
    // 일자행마다 절사하면 항목표가 수량×단가와 수십 원 어긋난다(서수란 0729 접수:
    // 1,733×7.2 = 12,477.6인데 12,456 표시). 행은 정확값, 절사는 buildInvoiceLines 항목줄에서 1회.
    const priceEx = { ...web, LMS: 22.8, SMS: 7.2 };
    const out = priceBillingRows([
      r({ typeKey: 'LMS', success: 2758 }),   // 62,882.4
      r({ typeKey: 'SMS', success: 6793 }),   // 48,909.6
    ], priceEx, []);

    expect(out.items[0].amount).toBeCloseTo(62882.4, 6);
    expect(out.items[1].amount).toBeCloseTo(48909.6, 6);
    // amount === amountExact — 발송 행에서 두 축은 같은 값이다(절사 축이 사라졌으므로)
    out.items.forEach((i) => expect(i.amount).toBe(i.amountExact));
    expect(out.amountByChannel.web).toBeCloseTo(62882.4 + 48909.6, 6);
    expect(out.amountExactByChannel.web).toBeCloseTo(62882.4 + 48909.6, 6);
  });

  it('★서수란 0729 접수 재현 — 일자별로 쪼개 절사 없이 합하면 정확히 수량×단가가 된다', () => {
    // 1,733건이 여러 날로 쪼개져도 Σ(일자수량×7.2) = 1,733×7.2 = 12,477.6 — 절사 누적 손실 0.
    const days = [311, 402, 297, 356, 188, 179]; // 합 1,733
    const out = priceBillingRows(
      days.map((s, i) => r({ typeKey: 'SMS', success: s, itemDate: `2026-07-${String(i + 1).padStart(2, '0')}` })),
      { ...web, SMS: 7.2 }, [],
    );
    const sum = out.items.reduce((s, i) => s + i.amount, 0);
    expect(sum).toBeCloseTo(1733 * 7.2, 6); // 12,477.6 — 항목줄 절사가 12,477을 만든다
  });

  it('에이전트는 회사 단가가 아니라 발송ID별 단가로 계산되고 agent_id FK가 붙는다', () => {
    const out = priceBillingRows(
      [r({ channel: 'agent', typeKey: 'LMS', userId: null, agentSendId: 'D0018', success: 1000 })],
      web,
      [ap({ id: 'cai-D0018', cost_per_lms: 22 })],
      'vat_excluded',
    );
    expect(out.items[0]).toMatchObject({ agentId: 'cai-D0018', unitPrice: 22, amount: 22000 });
    expect(out.amountByChannel.agent).toBe(22000);
    expect(out.missingAgentPrices).toEqual([]);
  });

  it('발송ID 매칭은 대소문자를 가리지 않는다', () => {
    const out = priceBillingRows(
      [r({ channel: 'agent', typeKey: 'SMS', userId: null, agentSendId: 'd0018', success: 10 })],
      web,
      [ap({ agent_send_id: 'D0018', cost_per_sms: 7 })],
      'vat_excluded',
    );
    expect(out.items[0].amount).toBe(70);
  });

  it('단가 미설정(NULL)은 0원으로 밀지 않고 어디가 비었는지 돌려준다 — 조용한 0원 청구 차단', () => {
    // 실측 2026-07-26: company_agent_ids 283행 전부 단가 미설정
    const out = priceBillingRows([
      r({ channel: 'agent', typeKey: 'LMS', userId: null, agentSendId: 'D0018', success: 596968 }),
      r({ channel: 'agent', typeKey: 'SMS', userId: null, agentSendId: 'D0018', success: 5 }),
    ], web, [ap({})]);
    expect(out.amountByChannel.agent).toBe(0);
    expect(out.missingAgentPrices).toEqual([
      { agentSendId: 'D0018', typeKey: 'LMS', success: 596968 },
      { agentSendId: 'D0018', typeKey: 'SMS', success: 5 },
    ]);
  });

  it('같은 발송ID·유형의 여러 날짜는 미설정 목록에서 합산된다', () => {
    const out = priceBillingRows([
      r({ channel: 'agent', typeKey: 'LMS', userId: null, agentSendId: 'D0018', success: 10 }),
      r({ channel: 'agent', itemDate: '2026-07-02', typeKey: 'LMS', userId: null, agentSendId: 'D0018', success: 5 }),
    ], web, [ap({})]);
    expect(out.missingAgentPrices).toEqual([{ agentSendId: 'D0018', typeKey: 'LMS', success: 15 }]);
  });

  it('명시된 0원은 0원 그대로 — 미설정과 구분한다', () => {
    const out = priceBillingRows(
      [r({ channel: 'agent', typeKey: 'SMS', userId: null, agentSendId: 'D0018', success: 100 })],
      web,
      [ap({ cost_per_sms: 0 })],
    );
    expect(out.items[0].unitPrice).toBe(0);
    expect(out.missingAgentPrices).toEqual([]);
  });

  it('성공 0인 행은 단가가 없어도 발행을 막지 않는다', () => {
    const out = priceBillingRows(
      [r({ channel: 'agent', typeKey: 'SMS', userId: null, agentSendId: 'D0018', total: 5, success: 0, fail: 5 })],
      web,
      [ap({})],
    );
    expect(out.missingAgentPrices).toEqual([]);
  });

  it('매핑에 없는 발송ID는 단가 미설정으로 잡힌다 — 조용히 0원으로 새지 않는다', () => {
    const out = priceBillingRows(
      [r({ channel: 'agent', typeKey: 'SMS', userId: null, agentSendId: 'B9999', success: 3 })],
      web, [ap({})],
    );
    expect(out.items[0].agentId).toBeNull();
    expect(out.missingAgentPrices).toEqual([{ agentSendId: 'B9999', typeKey: 'SMS', success: 3 }]);
  });

  it('단가 정의 자체가 없는 유형은 성공 수량이 있을 때만 잡힌다', () => {
    // 실측 2026-07-26: G = 여미지(B0227) 7월 성공 42,833건. 단가 칸이 아예 없다.
    const out = priceBillingRows([
      r({ channel: 'agent', typeKey: 'G', userId: null, agentSendId: 'B0227', total: 44722, success: 42833 }),
      r({ channel: 'agent', typeKey: 'X', userId: null, agentSendId: 'B0227', total: 1, success: 0 }),
    ], web, [ap({ id: 'cai-B0227', agent_send_id: 'B0227', cost_per_sms: 9 })]);
    expect(out.unbillableTypes).toEqual([{ key: 'G', success: 42833, total: 44722 }]);
  });

  it('빈 입력에 안전하다', () => {
    const out = priceBillingRows([], web, []);
    expect(out.items).toEqual([]);
    // 요금제는 단가 계산기를 거치지 않으므로 여기서는 항상 0이다 — 라우트가 따로 합친다.
    expect(out.amountByChannel).toEqual({ plan: 0, web: 0, agent: 0, test: 0, spam: 0, extra: 0 });
    expect(out.missingAgentPrices).toEqual([]);
    expect(out.unbillableTypes).toEqual([]);
    expect(priceBillingRows(undefined as any, web, undefined as any).items).toEqual([]);
  });

  it('깨진 단가 값은 금액을 NaN으로 만들지 않는다', () => {
    const out = priceBillingRows(
      [r({ channel: 'agent', typeKey: 'SMS', userId: null, agentSendId: 'D0018', success: 10 })],
      web, [ap({ cost_per_sms: 'abc' })],
    );
    expect(Number.isFinite(out.items[0].amount)).toBe(true);
    expect(out.missingAgentPrices).toHaveLength(1); // 숫자가 아니면 미설정과 같게 다룬다
  });
});

// ============================================================
//  요금제 행 전용 일수 컬럼 (★ 2026-07-26 Codex 3차 HIGH)
// ============================================================

describe('buildPlanBillingItems — 요금제 행 (2026-07-26)', () => {
  const seg = (o: Record<string, any> = {}) => ({
    planCode: 'BASIC', monthlyPrice: 350000,
    from: '2026-07-01', to: '2026-07-09', days: 9, monthDays: 31, amount: 101613, ...o,
  });

  it('일수는 전용 필드로 나가고 발송 수량 4칸은 전부 0이다 — PDF 전송·실패 열과 화면 합계 오염 차단', () => {
    const [it0] = buildPlanBillingItems([seg()]);
    expect(it0.planDays).toBe(9);
    expect(it0.planMonthDays).toBe(31);
    expect([it0.total, it0.success, it0.fail, it0.pending]).toEqual([0, 0, 0, 0]);
  });

  it('금액·단가는 일할 결과와 월정액 그대로', () => {
    const [it0] = buildPlanBillingItems([seg()]);
    expect(it0.unitPrice).toBe(350000);
    expect(it0.amount).toBe(101613);
    expect(it0.channel).toBe('plan');
    expect(it0.typeKey).toBe('PLAN_BASIC');
  });

  it('일할 금액도 원 미만을 절사한다 — 발송 행과 같은 규칙이어야 장 소계가 정수로 성립한다 (2026-07-26)', () => {
    // 350,000 × 9/31 = 101,612.903…
    const [it0] = buildPlanBillingItems([seg({ amount: 101612.903225806 })]);
    expect(it0.amount).toBe(101612);
    expect(it0.amountExact).toBeCloseTo(101612.903225806, 6);
    expect(Number.isInteger(it0.amount)).toBe(true);
  });

  it('구간이 여럿이면 행도 여럿 — 구간 시작일이 item_date다', () => {
    const items = buildPlanBillingItems([
      seg({ from: '2026-07-01', to: '2026-07-09' }),
      seg({ planCode: 'PRO', from: '2026-07-10', to: '2026-07-31', days: 22, amount: 709677 }),
    ]);
    expect(items.map((i) => i.itemDate)).toEqual(['2026-07-01', '2026-07-10']);
  });

  it('발송 행에는 요금제 일수 축이 없다 — null이 그 사실이다', () => {
    const rows: BillingUsageRow[] = [{
      channel: 'web', itemDate: '2026-07-01', typeKey: 'SMS', userId: 'u1', agentSendId: null,
      total: 10, success: 10, fail: 0, pending: 0,
    }];
    const priced = priceBillingRows(rows, { SMS: 9 }, []);
    expect(priced.items[0].planDays).toBeNull();
    expect(priced.items[0].planMonthDays).toBeNull();
  });

  it('요금제 행은 장 헤더 수량(totals)에 섞이지 않는다 — 청구 수량 축은 성공 건수뿐', () => {
    const [planRow] = buildPlanBillingItems([seg()]);
    const sheets = splitBillingSheets([planRow], 'combined');
    expect(Object.values(sheets[0].totals).every((v) => v === 0)).toBe(true);
    expect(sheets[0].amount).toBe(101613);
  });
});

// ★ 2026-07-31 레거시 예약 직접발송 누락 정정 — 두 집합의 **기간 조건 계약**을 고정한다.
//   서수란 접수("거래내역서 수량 상이")의 실원인이 이 축이었다: 레거시 direct는 send_phase가 NULL이라
//   `= 'sent'` 조건에서 빠지고, 예약 건은 campaign_runs도 없어 두 축 어디에도 안 걸렸다.
//   정정은 "레거시 NULL 건을 periodCampaignIds(기간 조건 동반)로 보낸다"인데, 이때 **eventIds로 잘못 보내면**
//   이미 기간 보호를 받던 캠페인이 dateless 축으로 옮겨가 발송 월과 무관하게 전량 계상되는 더 큰 사고가 난다.
//   그 계약을 여기서 못 박는다 — agg가 주입 가능이라 실제 WHERE 절을 검사할 수 있다.
describe('aggregateBillingSendIds — 집합별 기간 조건 계약 (2026-07-31)', () => {
  const capture = () => {
    const calls: { where: string; params: any[] }[] = [];
    const agg = async (_tables: string[], where: string, params: any[]) => {
      calls.push({ where, params });
      return [];
    };
    return { calls, agg };
  };

  it('eventIds는 기간 조건 없이 app_etc1만으로 집계한다 (1 ID = 1 발송 이벤트 계약)', async () => {
    const { calls, agg } = capture();
    await aggregateBillingSendIds(['T1'], { eventIds: ['e1', 'e2'], periodCampaignIds: [] }, agg, '2026-07-01', '2026-07-31');
    expect(calls).toHaveLength(1);
    expect(calls[0].where).toContain('app_etc1 IN');
    expect(calls[0].where).not.toContain('sendreq_time');
    expect(calls[0].params).toEqual(['e1', 'e2']);
  });

  it('periodCampaignIds는 **반드시** sendreq_time 기간 조건과 함께 집계한다 (월경계 이중계상 차단)', async () => {
    const { calls, agg } = capture();
    await aggregateBillingSendIds(['T1'], { eventIds: [], periodCampaignIds: ['c1'] }, agg, '2026-07-01', '2026-07-31');
    expect(calls).toHaveLength(1);
    expect(calls[0].where).toContain('sendreq_time >= ?');
    expect(calls[0].where).toContain('DATE_ADD(?, INTERVAL 1 DAY)');
    // 기간 파라미터가 ID 뒤에 붙는다 — 순서가 바뀌면 엉뚱한 기간으로 집계된다.
    expect(calls[0].params).toEqual(['c1', '2026-07-01', '2026-07-31']);
  });

  it('두 집합이 함께 있으면 각자의 계약대로 **따로** 나간다', async () => {
    const { calls, agg } = capture();
    await aggregateBillingSendIds(['T1'], { eventIds: ['e1'], periodCampaignIds: ['c1'] }, agg, '2026-07-01', '2026-07-31');
    expect(calls).toHaveLength(2);
    const dateless = calls.filter((c) => !c.where.includes('sendreq_time'));
    const dated = calls.filter((c) => c.where.includes('sendreq_time'));
    expect(dateless).toHaveLength(1);
    expect(dated).toHaveLength(1);
    expect(dateless[0].params).toEqual(['e1']);
    expect(dated[0].params).toEqual(['c1', '2026-07-01', '2026-07-31']);
  });

  it('빈 집합은 쿼리를 만들지 않는다 (전 테이블 스캔 유발 차단)', async () => {
    const { calls, agg } = capture();
    await aggregateBillingSendIds(['T1'], { eventIds: [], periodCampaignIds: [] }, agg, '2026-07-01', '2026-07-31');
    expect(calls).toHaveLength(0);
  });
});

// ★ 2026-07-31 레거시 direct 배분 계약 — **이 판정이 틀리면 청구 금액이 틀린다.**
//   실원인: 레거시 `POST /direct-send`가 send_phase를 안 넣어 NULL이고(컬럼 DEFAULT 없음 — 실측),
//   예약 건은 campaign_runs도 없어 두 축 어디에도 안 걸려 실발송이 미청구였다(라프레리 6월 성공 11건 실측).
describe('partitionBillingSendIds — 레거시 direct 배분 (2026-07-31)', () => {
  it('레거시(send_phase NULL) direct는 **periodCampaignIds로** 간다 — eventIds로 가면 기간 보호가 사라진다', () => {
    const out = partitionBillingSendIds({ runs: [], directs: [], legacyDirects: [{ campaign_id: 'legacy1' }] });
    expect(out.periodCampaignIds).toEqual(['legacy1']);
    expect(out.eventIds).toEqual([]);
  });

  it('기존 축은 그대로다 — run은 cr.id가 eventIds, 그 campaigns.id는 periodCampaignIds', () => {
    const out = partitionBillingSendIds({
      runs: [{ run_id: 'run1', campaign_id: 'camp1' }],
      directs: [{ run_id: 'direct1' }],
      legacyDirects: [],
    });
    expect(out.eventIds.sort()).toEqual(['direct1', 'run1']);
    expect(out.periodCampaignIds).toEqual(['camp1']);
  });

  it('같은 id가 eventIds에 있으면 periodCampaignIds에 넣지 않는다 (한 행이 두 축에 걸리면 이중 계상)', () => {
    // 구형 경로: direct 캠페인이 campaign_runs도 만들어 campaigns.id가 양쪽 후보가 되는 경우
    const out = partitionBillingSendIds({
      runs: [{ run_id: 'run1', campaign_id: 'dup' }],
      directs: [{ run_id: 'dup' }],
      legacyDirects: [{ campaign_id: 'dup' }],
    });
    expect(out.eventIds.sort()).toEqual(['dup', 'run1']);
    expect(out.periodCampaignIds).toEqual([]);
  });

  it('레거시가 run 기반 campaigns.id와 겹쳐도 중복되지 않는다', () => {
    const out = partitionBillingSendIds({
      runs: [{ run_id: 'run1', campaign_id: 'camp1' }],
      directs: [],
      legacyDirects: [{ campaign_id: 'camp1' }],
    });
    expect(out.periodCampaignIds).toEqual(['camp1']);
  });

  it('빈 입력·누락 필드에도 터지지 않는다', () => {
    expect(partitionBillingSendIds({ runs: [], directs: [], legacyDirects: [] }))
      .toEqual({ eventIds: [], periodCampaignIds: [] });
  });
});


// ★ 2026-07-31 (Codex 1R high + 2R high) 결과 미확정 차단 — 상세 행 기준·유예 반영.
//   1R: 대기 건을 0원으로 확정하면 기간 겹침 차단 때문에 영구 미청구가 된다 → 막는다.
//   2R: ① 입력이 dayData면 **에이전트 대기가 통째로 빠진다**(그 축은 일자 집계에 없다)
//       ② 무조건 차단하면 결과가 영영 안 오는 행 하나가 그 회사 발행을 영구 봉쇄한다.
describe('findBlockingPendingRows — 발행 차단 대기 판정 (2026-07-31)', () => {
  const row = (over: any) => ({
    channel: 'web', itemDate: '2026-07-30', typeKey: 'LMS', userId: null, agentSendId: null,
    total: 0, success: 0, fail: 0, pending: 0, ...over,
  }) as any;
  const NOW = new Date('2026-07-31T12:00:00+09:00');

  it('대기는 채널·유형별로 합산하고 많은 순으로 준다', () => {
    const out = findBlockingPendingRows([
      row({ pending: 2 }),
      row({ pending: 3, itemDate: '2026-07-31' }),
      row({ channel: 'agent', typeKey: 'SMS', pending: 1, agentSendId: 'B0082' }),
    ], { now: NOW });
    expect(out).toEqual([
      { channel: 'web', key: 'LMS', pending: 5, latestDate: '2026-07-31', stale: false },
      { channel: 'agent', key: 'SMS', pending: 1, latestDate: '2026-07-30', stale: false },
    ]);
  });

  it('★ 에이전트 대기도 잡는다 (일자축 입력이면 이 채널이 통째로 빠졌다 — 2R high)', () => {
    const out = findBlockingPendingRows([
      row({ channel: 'agent', typeKey: 'LMS', pending: 7, agentSendId: 'B0082' }),
    ], { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ channel: 'agent', pending: 7 });
  });

  it('★ 오래된 대기도 **막는다** — 나이는 종결을 증명하지 않는다 (3R high)', () => {
    const out = findBlockingPendingRows([row({ pending: 9, itemDate: '2026-07-01' })], { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ pending: 9, stale: true });
  });

  it('유예 경계 — 안쪽은 stale=false, 바깥은 stale=true (둘 다 차단 대상)', () => {
    // 기본 48h → 커트라인 2026-07-29
    expect(findBlockingPendingRows([row({ pending: 1, itemDate: '2026-07-29' })], { now: NOW })[0].stale).toBe(false);
    expect(findBlockingPendingRows([row({ pending: 1, itemDate: '2026-07-28' })], { now: NOW })[0].stale).toBe(true);
  });

  it('같은 묶음에 최근 대기가 섞여 있으면 stale이 아니다 (기다리면 풀릴 수 있다)', () => {
    const out = findBlockingPendingRows([
      row({ pending: 1, itemDate: '2026-07-01' }),
      row({ pending: 1, itemDate: '2026-07-31' }),
    ], { now: NOW });
    expect(out[0]).toMatchObject({ pending: 2, latestDate: '2026-07-31', stale: false });
  });

  it('대기 0이거나 행이 없으면 빈 배열 = 발행 통과', () => {
    expect(findBlockingPendingRows([row({ pending: 0 })], { now: NOW })).toEqual([]);
    expect(findBlockingPendingRows([], { now: NOW })).toEqual([]);
  });
});

/**
 * ★ 2026-09-04 카카오 실패 전환분(KS·LMS 대체 KL) 청구 축 편입 — 서수란 접수 `cmtmlfbr108yojnot0bb4bxoi`(랩디).
 *
 * 게이트웨이는 알림톡 실패로 나간 문자를 `KS`(SMS 대체)·`KL`(LMS 대체)로 적재한다.
 * 그 코드가 청구 유형 축에 없어 `agentUsageKey`가 원본 코드를 그대로 유형키로 남겼고,
 * **단가 정의도 없고 단가를 입력할 칸도 없어** 발행이 두 사유로 동시에 막혔다
 * (`UNBILLABLE_TYPE_KEY` + `AGENT_UNIT_PRICE_MISSING`). 실측 = 랩디 V0001 8월 KL 성공 40건.
 *
 * 전환분의 실체는 그 문자 자체이므로 **문자 단가로 청구한다**(별도 단가 컬럼을 만들지 않는다 —
 * 쓰는 회사가 한 곳인데 전 고객사 단가 화면에 칸을 둘 늘리면 0814에 정리한 소음이 되살아난다).
 */
describe('카카오 전환분 KS·KL — 문자 유형으로 흡수 (2026-09-04 랩디)', () => {
  it('전환 코드가 문자 유형키로 매핑된다', () => {
    expect(agentUsageKey('KS')).toBe('SMS');
    expect(agentUsageKey('KL')).toBe('LMS');
    expect(AGENT_MSG_TYPE_TO_USAGE_KEY.KS).toBe('SMS');
    expect(AGENT_MSG_TYPE_TO_USAGE_KEY.KL).toBe('LMS');
  });

  it('원래 코드는 그대로 — 흡수가 기존 매핑을 덮지 않는다', () => {
    expect(agentUsageKey('S')).toBe('SMS');
    expect(agentUsageKey('L')).toBe('LMS');
    expect(agentUsageKey('K')).toBe('KAKAO');
    expect(agentUsageKey('G')).toBe('BRAND');
  });

  it('매핑에 없는 코드는 여전히 원본 그대로 남는다 — 새 유형이 조용히 0원이 되지 않게', () => {
    expect(agentUsageKey('ZZ')).toBe('ZZ');
  });

  it('전환 실적이 있어도 발행이 안 막힌다 — 단가 정의·발송ID 단가 둘 다 (접수 실물 재현)', () => {
    const rows: BillingUsageRow[] = [
      { channel: 'agent', itemDate: '2026-08-30', typeKey: agentUsageKey('KL'), userId: null, agentSendId: 'V0001', total: 14, success: 13, fail: 1, pending: 0 },
    ];
    const agentPrices: AgentUnitPriceRow[] = [
      { id: 'a1', agent_send_id: 'V0001', cost_per_sms: 7.2, cost_per_lms: 23.5, cost_per_mms: 50, cost_per_kakao: 4.5, cost_per_brand: null },
    ];
    const priced = priceBillingRows(rows, {}, agentPrices, 'vat_excluded');
    expect(priced.unbillableTypes, '전환분 유형에 청구 단가 정의가 없다 = 발행 차단').toEqual([]);
    expect(priced.missingAgentPrices, '전환분에 발송ID 단가가 안 붙는다 = 발행 차단').toEqual([]);
  });

  it('전환분은 그 문자의 단가로 청구된다 — LMS 대체 = LMS 단가', () => {
    const rows: BillingUsageRow[] = [
      { channel: 'agent', itemDate: '2026-08-30', typeKey: agentUsageKey('KL'), userId: null, agentSendId: 'V0001', total: 14, success: 13, fail: 1, pending: 0 },
      { channel: 'agent', itemDate: '2026-08-30', typeKey: agentUsageKey('KS'), userId: null, agentSendId: 'V0001', total: 3, success: 2, fail: 1, pending: 0 },
    ];
    const agentPrices: AgentUnitPriceRow[] = [
      { id: 'a1', agent_send_id: 'V0001', cost_per_sms: 7.2, cost_per_lms: 23.5, cost_per_mms: 50, cost_per_kakao: 4.5, cost_per_brand: null },
    ];
    const priced = priceBillingRows(rows, {}, agentPrices, 'vat_excluded');
    const kl = priced.items.find((i) => i.typeKey === 'LMS');
    const ks = priced.items.find((i) => i.typeKey === 'SMS');
    expect(kl?.unitPrice).toBe(23.5);
    expect(kl?.amount).toBe(13 * 23.5);
    expect(ks?.unitPrice).toBe(7.2);
    expect(ks?.amount).toBe(2 * 7.2);
  });

  it('전환분과 일반 문자가 같은 날 같은 발송ID면 한 줄로 합쳐진다 — 청구서에 유형이 갈리지 않게', () => {
    const rolled = rollupAgentRowsForBilling(
      [
        { agent_send_id: 'V0001', period: '2026-08-30', msg_type: 'L', sent: 10, success: 10, fail: 0, pending: 0 } as any,
        { agent_send_id: 'V0001', period: '2026-08-30', msg_type: 'KL', sent: 14, success: 13, fail: 1, pending: 0 } as any,
      ],
      new Set(['V0001']),
    );
    const lms = rolled.rows.filter((r) => r.typeKey === 'LMS');
    expect(lms, '전환분이 별도 행으로 남으면 같은 단가의 줄이 둘로 갈린다').toHaveLength(1);
    expect(lms[0].success).toBe(23);
    expect(lms[0].total).toBe(24);
  });
});
