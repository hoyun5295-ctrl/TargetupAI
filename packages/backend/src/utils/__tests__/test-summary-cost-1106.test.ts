/**
 * ★ 2026-11-06 C108(C107F ④ · 한줄로 Codex 구현 1R) — 관리 발송 통계 「시험 발송 요약 비용」 = 청구 수량 × 청구 유형 단가.
 *   옛 식은 전 채널 대기 합을 시험 SMS 건수에서 빼서, 대기 104 를 바로 세자 MMS 시험만 있는 기간이 음수 비용이 됐다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { testSummaryCost, testSummaryUnitPrices } from '../test-summary-cost';

const P = { SMS: 9.9, LMS: 27, TEST_SMS: 5, TEST_LMS: 20, TEST_MMS: 50, TEST_BRAND: 15 };

describe('시험 발송 요약 비용 CT', () => {
  it('대기만 있는 기간(MMS 104 하나) = 0원(청구 수량에 대기를 넣지 않는다 · 음수 0)', () => {
    expect(testSummaryCost([], { sms: 0, lms: 0 }, P)).toBe(0);
  });
  it('유형 = 정산서와 같은 키(S · KS → 시험 SMS · L · KL → 시험 LMS · M → 시험 MMS · F · FN → 시험 브랜드) · 스팸 = 일반 단가', () => {
    const cost = testSummaryCost([
      { msgType: 'S', billed: 2 }, { msgType: 'KS', billed: 1 }, { msgType: 'L', billed: 1 }, { msgType: 'KL', billed: 1 },
      { msgType: 'M', billed: 1 }, { msgType: 'F', billed: 1 }, { msgType: 'FN', billed: 2 },
    ], { sms: 3, lms: 1 }, P);
    expect(cost).toBe(Math.round((3 * 5 + 2 * 20 + 50 + 3 * 15 + 3 * 9.9 + 27) * 10) / 10);
  });
  it('단가 = 표시 기준(부가세 포함) · 시험 전용 칸이 비면 일반 단가 · 명시 0원은 0원', () => {
    const u = testSummaryUnitPrices({ unit_price_basis: 'vat_excluded', cost_per_sms: 10, cost_per_lms: 20, cost_per_mms: 50, cost_per_brand: 15, cost_per_test_sms: null, cost_per_test_lms: 0 });
    expect(u.TEST_SMS).toBe(u.SMS);
    expect(u.TEST_LMS).toBe(0);
    expect(u.SMS).toBe(11);
    expect(u.TEST_MMS).toBe(55);
    expect(u.TEST_BRAND).toBe(16.5);
  });
  it('관리 통계 경로가 CT 를 쓰고 옛 식(SMS 건수 − 대기)이 없다', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'routes', 'manage-stats.ts'), 'utf8');
    expect(src).toContain('testSummary.cost = testSummaryCost(testBilledRows,');
    expect(src).toContain('const billingType = billingMsgTypeSql(friendTables.has(tbl));');
    expect(src).toContain("WHERE app_etc1 = 'test' AND app_etc2 = ? AND status_code IN (${SUCCESS_CODES_SQL}) ${mysqlDateWhere}");
    expect(src).not.toMatch(/testSummary\.sms\s*-\s*testSummary\.pending/);
  });
});
