/**
 * free-messaging.test.ts — 요금제 무료 메시징 정산 계약 (★ 2026-08-05 신설)
 *
 * 고정하는 것은 셋이다.
 *  ① 원장 문자열 왕복 — 무료가 0이면 **문구가 종전과 한 글자도 다르지 않다**(옛 행 무손상).
 *  ② 부담 축(`차감 + 무료`)이 미적재·정당 한도를 정확히 만든다.
 *  ③ 불변식 `부담 = 성공 + 순환불 + 무료실패소멸`이 **정상·대량실패 양쪽에서 0**으로 닫힌다.
 *
 * ③이 이 기능의 핵심 위험이다. 차감만으로 재면 무료가 낀 캠페인에서 "성공 > 차감"이 되어
 * 정당 환불 한도가 0으로 계산되고 정상 실패 환불을 초과로 오인해 회수한다(설계 §5-1-B).
 */

import { describe, test, expect } from 'vitest';
import { buildDeductDescription, parseDeductDescription, parseFreeCount } from './deduct-reference';
import { calcRefundParts, refundInvariantGap } from './refund-calc';
import { findNegativeAdjustedTypes } from './billing-qty-adjust';
import { buildInvoiceLines } from './billing-invoice-lines';
import { splitBillingSheets } from './send-usage-aggregation';
import {
  isFreeMessagingEligible, FREE_MESSAGING_TYPES,
  allocateFreeToRows, freeQuotaKey, monthStartOf, freeDeductibleFingerprint,
} from './free-messaging';

describe('원장 문구 — 무료 0이면 종전과 동일', () => {
  test('무료 0은 옛 문구 그대로 (기본 인자·명시 0 모두)', () => {
    expect(buildDeductDescription('campaign', 'LMS', 3, 26.4)).toBe('LMS 3건 발송 차감 (건당 26.4원)');
    expect(buildDeductDescription('campaign', 'LMS', 3, 26.4, 0)).toBe('LMS 3건 발송 차감 (건당 26.4원)');
    expect(parseFreeCount('LMS 3건 발송 차감 (건당 26.4원)')).toBe(0);
  });

  test('부분 무료 — 되읽은 count는 언제나 **실제 차감 건수**다', () => {
    const desc = buildDeductDescription('campaign', 'SMS', 60, 7.92, 40);
    expect(desc).toBe('SMS 100건 중 무료 40건 · 과금 60건 발송 차감 (건당 7.92원)');
    expect(parseDeductDescription(desc)).toEqual({ count: 60, unitPrice: 7.92 });
    expect(parseFreeCount(desc)).toBe(40);
  });

  test('전량 무료 — 차감 축이 없어 파싱은 null, 무료만 읽힌다', () => {
    const desc = buildDeductDescription('campaign', 'SMS', 0, 7.92, 100);
    expect(desc).toBe('SMS 무료 제공 100건 발송 (과금 없음)');
    expect(parseDeductDescription(desc)).toBeNull();
    expect(parseFreeCount(desc)).toBe(100);
  });

  test('유형 라벨 접두가 붙어도 두 되읽기가 모두 성립한다', () => {
    const desc = buildDeductDescription('journey', 'KAKAO', 5, 6.6, 2);
    expect(desc.startsWith('[여정 발송] ')).toBe(true);
    expect(parseDeductDescription(desc)).toEqual({ count: 5, unitPrice: 6.6 });
    expect(parseFreeCount(desc)).toBe(2);
  });

  test('환불·회수 문구를 무료로 오독하지 않는다', () => {
    expect(parseFreeCount('발송 실패 환불 (LMS 112건 × 26.4원)')).toBe(0);
    expect(parseFreeCount('초과 환불 reverse (정당 한도 3건 초과분 자동 회수, LMS)')).toBe(0);
    expect(parseFreeCount(null)).toBe(0);
  });
});

describe('부담 축 — 미적재 판정', () => {
  test('무료 0이면 종전 계산과 완전히 같다', () => {
    const base = { deductedCount: 100, sentCount: 100, mysqlSuccess: 90, mysqlFail: 10, mysqlPending: 0 };
    expect(calcRefundParts(base)).toEqual(calcRefundParts({ ...base, freeCount: 0 }));
  });

  test('전량 적재·무료 포함 — 미적재 0, 실패분만 환불', () => {
    // 100건 발송(무료 40·차감 60), 성공 90 실패 10
    const parts = calcRefundParts({
      deductedCount: 60, freeCount: 40, sentCount: 100,
      mysqlSuccess: 90, mysqlFail: 10, mysqlPending: 0,
    });
    expect(parts).toEqual({ fail: 10, notLoaded: 0 });
  });

  test('미적재는 부담 기준으로 잡되 환불 상한은 차감이다', () => {
    // 부담 100(무료 40·차감 60)인데 큐에 80건만 올라갔다 → 미적재 20
    const parts = calcRefundParts({
      deductedCount: 60, freeCount: 40, sentCount: 80,
      mysqlSuccess: 80, mysqlFail: 0, mysqlPending: 0,
    });
    expect(parts.notLoaded).toBe(20);
    // 차감(60)을 넘지 않는다 — 무료분은 돌려줄 돈이 없다
    expect(parts.fail + parts.notLoaded).toBeLessThanOrEqual(60);
  });

  test('차감만으로 재면 미적재를 놓친다 (부담 축이 필요한 이유)', () => {
    const withFree = calcRefundParts({
      deductedCount: 60, freeCount: 40, sentCount: 80,
      mysqlSuccess: 80, mysqlFail: 0, mysqlPending: 0,
    });
    const withoutFree = calcRefundParts({
      deductedCount: 60, sentCount: 80,
      mysqlSuccess: 80, mysqlFail: 0, mysqlPending: 0,
    });
    expect(withoutFree.notLoaded).toBe(0);
    expect(withFree.notLoaded).toBe(20);
  });
});

describe('불변식 — 부담 = 성공 + 순환불 + 무료실패소멸', () => {
  test('무료 0이면 옛 식과 같다', () => {
    expect(refundInvariantGap({ deductedCount: 100, successCount: 90, netRefundedCount: 10 })).toBe(0);
    expect(refundInvariantGap({ deductedCount: 100, successCount: 90, netRefundedCount: 10, freeCount: 0 })).toBe(0);
  });

  test('정상(무료 ≤ 성공) — 실패분만 환불되고 0으로 닫힌다', () => {
    // 발송 100 = 무료 40 + 차감 60, 성공 90(무료 40 + 유료 50), 실패 10 전액 환불
    expect(refundInvariantGap({
      deductedCount: 60, freeCount: 40, successCount: 90, netRefundedCount: 10,
    })).toBe(0);
  });

  test('대량 실패(무료 > 성공) — 차감 전액 환불 + 무료 소멸분이 흡수돼 0', () => {
    // 발송 100 = 무료 40 + 차감 60, 성공 30, 실패 70 → 환불은 차감액(60건)에서 캡
    expect(refundInvariantGap({
      deductedCount: 60, freeCount: 40, successCount: 30, netRefundedCount: 60,
    })).toBe(0);
  });

  test('전량 무료 — 차감 0이어도 오경보가 없다', () => {
    expect(refundInvariantGap({ deductedCount: 0, freeCount: 100, successCount: 100, netRefundedCount: 0 })).toBe(0);
    expect(refundInvariantGap({ deductedCount: 0, freeCount: 100, successCount: 60, netRefundedCount: 0 })).toBe(0);
  });

  test('무료를 빼먹으면 실제로 오경보가 난다 (이 축이 필요한 근거)', () => {
    const wrong = refundInvariantGap({ deductedCount: 60, successCount: 90, netRefundedCount: 10 });
    expect(wrong).toBe(-40);   // 초과환불 잔존으로 오판 → 정상 환불을 회수하러 간다
  });

  test('진짜 미환불은 여전히 잡힌다 (무료가 결함을 가리지 않는다)', () => {
    // 부담 100, 성공 80, 실패 20인데 환불이 5건만 나갔다 → 15건 미환불
    expect(refundInvariantGap({
      deductedCount: 60, freeCount: 40, successCount: 80, netRefundedCount: 5,
    })).toBe(15);
  });
});

describe('후불 배분 — 달 × 유형 키 (Codex 1R high 정정)', () => {
  const row = (o: any) => ({ channel: 'web', typeKey: 'SMS', itemDate: '2026-08-03', userId: null, success: 100, ...o });

  test('한 달 몫이 다른 달 행에 붙지 않는다', () => {
    // 7월 행이 먼저 오지만 배분은 8월 한도만 있다 — 옛 코드는 유형만 보고 7월 행에 붙였다
    const jul = row({ itemDate: '2026-07-20', success: 100 });
    const aug = row({ itemDate: '2026-08-03', success: 100 });
    const alloc = allocateFreeToRows([jul, aug], { [freeQuotaKey('2026-08-01', 'SMS')]: 60 });
    expect(alloc.get(jul)).toBeUndefined();
    expect(alloc.get(aug)).toBe(60);
  });

  test('달마다 한도가 따로 소진된다', () => {
    const jul = row({ itemDate: '2026-07-20', success: 100 });
    const aug = row({ itemDate: '2026-08-03', success: 100 });
    const alloc = allocateFreeToRows([jul, aug], {
      [freeQuotaKey('2026-07-01', 'SMS')]: 30,
      [freeQuotaKey('2026-08-01', 'SMS')]: 60,
    });
    expect(alloc.get(jul)).toBe(30);
    expect(alloc.get(aug)).toBe(60);
  });

  test('같은 달 여러 행은 이른 일자부터 결정적으로 채운다', () => {
    const d1 = row({ itemDate: '2026-08-01', success: 40 });
    const d2 = row({ itemDate: '2026-08-02', success: 40 });
    const d3 = row({ itemDate: '2026-08-03', success: 40 });
    const alloc = allocateFreeToRows([d3, d1, d2], { [freeQuotaKey('2026-08-01', 'SMS')]: 70 });
    expect(alloc.get(d1)).toBe(40);
    expect(alloc.get(d2)).toBe(30);
    expect(alloc.get(d3)).toBeUndefined();
  });

  test('행의 성공 건수를 넘겨 배분하지 않는다', () => {
    const r = row({ success: 10 });
    const alloc = allocateFreeToRows([r], { [freeQuotaKey('2026-08-01', 'SMS')]: 500 });
    expect(alloc.get(r)).toBe(10);
  });

  test('웹이 아닌 채널·대상 아닌 유형은 배분되지 않는다', () => {
    const agent = row({ channel: 'agent' });
    const brand = row({ typeKey: 'BRAND' });
    const alloc = allocateFreeToRows([agent, brand], {
      [freeQuotaKey('2026-08-01', 'SMS')]: 100,
      [freeQuotaKey('2026-08-01', 'BRAND')]: 100,
    });
    expect(alloc.size).toBe(0);
  });

  test('공제량이 없으면 아무 것도 배분하지 않는다 (DDL 미실행 상태)', () => {
    expect(allocateFreeToRows([row()], {}).size).toBe(0);
  });

  test('monthStartOf — 형식이 아니면 빈 문자열이라 어느 한도에도 안 붙는다', () => {
    expect(monthStartOf('2026-08-17')).toBe('2026-08-01');
    expect(monthStartOf(null)).toBe('');
    expect(monthStartOf('bad')).toBe('');
  });

  test('지문은 순서와 무관하게 같은 값이다 (잠금 전후 대조용)', () => {
    const a = { 'b|LMS': 2, 'a|SMS': 1 };
    const b = { 'a|SMS': 1, 'b|LMS': 2 };
    expect(freeDeductibleFingerprint(a)).toBe(freeDeductibleFingerprint(b));
    expect(freeDeductibleFingerprint({ 'a|SMS': 1 })).not.toBe(freeDeductibleFingerprint({ 'a|SMS': 2 }));
  });
});

describe('정산 축 정합 — 헤더·음수 판정이 청구 수량을 본다 (3R 정정)', () => {
  const priced = (o: any) => ({
    channel: 'web', typeKey: 'SMS', itemDate: '2026-08-03', userId: null, agentSendId: null, agentId: null,
    total: 0, fail: 0, pending: 0, unitPrice: 10, planDays: null, planMonthDays: null,
    success: 10, freeCount: 0, amount: 0, amountExact: 0, ...o,
  });

  test('음수 판정은 성공이 아니라 성공 − 무료로 센다', () => {
    // 성공 10이 전량 무료(청구 0)인 줄에 -1 조정 → 원시 합은 9라 통과하지만 청구 수량은 -1이다
    const rows = [
      priced({ success: 10, freeCount: 10 }),
      priced({ success: -1, freeCount: 0 }),
    ];
    const neg = findNegativeAdjustedTypes(rows as any);
    expect(neg).toHaveLength(1);
    expect(neg[0].total).toBe(-1);
  });

  test('무료가 없으면 판정이 종전과 같다', () => {
    expect(findNegativeAdjustedTypes([priced({ success: 10 }), priced({ success: -1 })] as any)).toHaveLength(0);
    expect(findNegativeAdjustedTypes([priced({ success: 1 }), priced({ success: -3 })] as any)).toHaveLength(1);
  });

  test('무료 공제분이 정상 하향 조정을 오거부하지 않는다', () => {
    // 성공 100 중 무료 30 → 청구 70. -20 조정은 정상이다
    const rows = [priced({ success: 100, freeCount: 30 }), priced({ success: -20 })];
    expect(findNegativeAdjustedTypes(rows as any)).toHaveLength(0);
  });

  test('하향 조정이 인쇄 수량에서 사라지지 않는다 — 수량 × 단가 = 금액 (Codex 4R high)', () => {
    // 성공 100·무료 30·조정 -20 → 청구 수량 50, 금액도 50건분이어야 한다.
    // 행 단위로 0 하한을 걸면 수량만 70이 되어 금액과 갈린다.
    const lines = buildInvoiceLines([
      { channel: 'web', message_type: 'SMS', unit_price: 10, success_count: 100, free_count: 30, amount: 700, item_date: '2026-08-01' },
      { channel: 'web', message_type: 'SMS', unit_price: 10, success_count: -20, free_count: 0, amount: -200, item_date: '2026-08-01' },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].count).toBe(50);
    expect(lines[0].amount).toBe(500);
    expect(lines[0].count * lines[0].unitPrice).toBe(lines[0].amount);
  });

  test('장 헤더 수량도 같은 정의를 쓴다 — 조정이 반영된 청구 수량', () => {
    const sheets = splitBillingSheets([
      priced({ success: 100, freeCount: 30, unitPrice: 10, amount: 700, amountExact: 700 }),
      priced({ success: -20, freeCount: 0, unitPrice: 10, amount: -200, amountExact: -200 }),
    ] as any);
    const total = sheets.reduce((s, sh) => s + (Number(sh.totals.SMS) || 0), 0);
    expect(total).toBe(50);
  });
});

describe('적용 축 — 웹 4종만', () => {
  test('웹 4종 × 발송 성격 차감만 무료로 덮인다', () => {
    for (const t of FREE_MESSAGING_TYPES) {
      expect(isFreeMessagingEligible(t.key, 'campaign')).toBe(true);
      expect(isFreeMessagingEligible(t.key, 'journey')).toBe(true);
    }
  });

  test('테스트·스팸 차감은 같은 유형키여도 제외된다', () => {
    expect(isFreeMessagingEligible('SMS', 'test')).toBe(false);
    expect(isFreeMessagingEligible('LMS', 'spam')).toBe(false);
    expect(isFreeMessagingEligible('LMS', 'brand')).toBe(false);
  });

  test('브랜드메시지·테스트/스팸 유형키는 축 자체가 아니다', () => {
    expect(isFreeMessagingEligible('BRAND', 'campaign')).toBe(false);
    expect(isFreeMessagingEligible('TEST_SMS', 'campaign')).toBe(false);
    expect(isFreeMessagingEligible('SPAM_LMS', 'campaign')).toBe(false);
    expect(isFreeMessagingEligible('', 'campaign')).toBe(false);
    expect(isFreeMessagingEligible(null, 'campaign')).toBe(false);
  });

  test('축 정의는 4종이고 plans 컬럼이 서로 다르다', () => {
    expect(FREE_MESSAGING_TYPES.map((t) => t.key)).toEqual(['SMS', 'LMS', 'MMS', 'KAKAO']);
    expect(new Set(FREE_MESSAGING_TYPES.map((t) => t.planColumn)).size).toBe(4);
  });
});
