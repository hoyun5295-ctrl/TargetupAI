/**
 * deduct-reference.test.ts — 차감/환불 reference_type 라벨·설명 (순수)
 *
 * 배경(2026-07-07): prepaidDeduct가 테스트·스팸·여정·캠페인 차감을 전부 reference_type='campaign'으로
 *   하드코딩 → 차감이력에서 스팸필터 테스트 차감이 "LMS 3건 발송 차감"으로 일반 발송과 구분 불가
 *   → 발송내역엔 없고 차감이력엔 떠서 불일치·추적 불가(서수란 신고). reference_type를 유형별로 분리한다.
 */
import { describe, test, expect } from 'vitest';
import { deductReferenceLabel, buildDeductDescription, parseDeductDescription, parseFreeCount, parseAlimtalkUnits, resolveAlimtalkLedgerUnits } from './deduct-reference';

describe('deductReferenceLabel', () => {
  test('유형별 한국어 라벨', () => {
    expect(deductReferenceLabel('campaign')).toBe('캠페인 발송');
    expect(deductReferenceLabel('test')).toBe('테스트 발송');
    expect(deductReferenceLabel('spam')).toBe('스팸필터 테스트');
    expect(deductReferenceLabel('journey')).toBe('여정 발송');
    expect(deductReferenceLabel('brand')).toBe('브랜드메시지');
  });

  test('미지정/옛 데이터(null·빈값·미지의 값) → 캠페인 발송(기본)', () => {
    expect(deductReferenceLabel(null)).toBe('캠페인 발송');
    expect(deductReferenceLabel(undefined)).toBe('캠페인 발송');
    expect(deductReferenceLabel('')).toBe('캠페인 발송');
    expect(deductReferenceLabel('unknown_future')).toBe('캠페인 발송');
  });
});

describe('buildDeductDescription', () => {
  test('campaign은 기존 설명 그대로(하위호환 — 라벨 접두사 없음)', () => {
    expect(buildDeductDescription('campaign', 'LMS', 3, 26.4)).toBe('LMS 3건 발송 차감 (건당 26.4원)');
  });

  test('스팸필터 테스트는 접두사로 구분 — "발송 차감" 위장 해소', () => {
    expect(buildDeductDescription('spam', 'LMS', 3, 26.4)).toBe('[스팸필터 테스트] LMS 3건 발송 차감 (건당 26.4원)');
  });

  test('테스트 발송 접두사', () => {
    expect(buildDeductDescription('test', 'SMS', 2, 15)).toBe('[테스트 발송] SMS 2건 발송 차감 (건당 15원)');
  });

  test('여정 발송 접두사', () => {
    expect(buildDeductDescription('journey', 'LMS', 1, 26.4)).toBe('[여정 발송] LMS 1건 발송 차감 (건당 26.4원)');
  });

  test('미지정(기본 campaign)은 접두사 없음', () => {
    expect(buildDeductDescription('campaign', 'MMS', 5, 200)).toBe('MMS 5건 발송 차감 (건당 200원)');
  });
});

describe('parseDeductDescription — 차감 설명 되읽기 (2026-07-26)', () => {
  test('buildDeductDescription 왕복 — 만든 값을 그대로 되읽는다', () => {
    for (const [refType, mt, count, unit] of [
      ['campaign', 'SMS', 1000, 7.92],
      ['test', 'SMS', 2, 15],
      ['spam', 'LMS', 3, 26.4],
      ['journey', 'LMS', 1, 26.4],
      ['brand', 'KAKAO', 7, 8.25],
      ['campaign', 'MMS', 5, 200],
    ] as const) {
      const desc = buildDeductDescription(refType, mt, count, unit);
      expect(parseDeductDescription(desc), desc).toEqual({ count, unitPrice: unit });
    }
  });

  test('천단위 콤마가 붙어도 읽는다 — toLocaleString이 섞인 옛 행 대비', () => {
    expect(parseDeductDescription('LMS 15,400건 발송 차감 (건당 26.4원)')).toEqual({ count: 15400, unitPrice: 26.4 });
  });

  test('환불·회수 설명은 읽지 않는다 — 차감 행만 건수의 근거다', () => {
    expect(parseDeductDescription('발송 실패 환불 (LMS 112건 × 26.4원)')).toBeNull();
    expect(parseDeductDescription('초과 환불 reverse (정당 한도 3건 초과분 자동 회수, LMS)')).toBeNull();
  });

  test('형식이 다르거나 값이 0·비수치면 null — 호출부가 현재 단가로 폴백한다', () => {
    expect(parseDeductDescription('')).toBeNull();
    expect(parseDeductDescription(null)).toBeNull();
    expect(parseDeductDescription(undefined)).toBeNull();
    expect(parseDeductDescription('수기 조정')).toBeNull();
    expect(parseDeductDescription('SMS 0건 발송 차감 (건당 7.92원)')).toBeNull();
    expect(parseDeductDescription('SMS 10건 발송 차감 (건당 0원)')).toBeNull();
  });

  test('★ 단가가 바뀌어도 그 차감 행의 단가·건수는 그대로 읽힌다 — 환불 짝 맞추기의 근거', () => {
    // 부가세 별도 전환 전 25.08원에 1,000건 차감 → 이후 단가를 22.7(공급가)로 재입력해도
    // 이 행은 여전히 25.08 × 1,000을 말한다. 환불은 이 값으로 해야 차감과 짝이 맞는다.
    const desc = buildDeductDescription('campaign', 'LMS', 1000, 25.08);
    const parsed = parseDeductDescription(desc)!;
    expect(parsed.count * parsed.unitPrice).toBeCloseTo(25080, 6);
  });
});

/**
 * ★ 2026-09-26 한줄로 V2 F01·F04 — 선불 알림톡 결과별 정산 단가.
 * 알림톡은 대체 문자까지 보낼 수 있어 차감은 문자 단가(보통 LMS)로 한다. 그런데 결과는 셋으로 갈린다
 * (알림톡 성공 · SMS 대체 · LMS 대체). 후불 청구는 결과별 단가로 매기는데 선불만 차감 단가로 굳었다.
 * 정산이 쓰는 결과별 단가는 **차감한 그 순간의 단가**여야 하므로 차감 행에 함께 싣는다(단가 변경 뒤에도 짝이 맞게).
 */
describe('알림톡 결과별 정산 단가 — 차감 설명에 싣고 되읽기 (2026-09-26)', () => {
  const units = { KAKAO: 5.5, SMS: 11, LMS: 27.5 };

  test('차감 설명 뒤에 붙인다 — 앞 문구는 한 글자도 바뀌지 않는다', () => {
    expect(buildDeductDescription('campaign', 'LMS', 10, 27.5, 0, units))
      .toBe('LMS 10건 발송 차감 (건당 27.5원) · 결과별 정산: 알림톡 5.5원 · SMS 대체 11원 · LMS 대체 27.5원');
  });

  test('부분 무료에도 붙고, 전량 무료(과금 없음)에는 붙이지 않는다 — 돌려줄 차액이 없다', () => {
    expect(buildDeductDescription('campaign', 'LMS', 6, 27.5, 4, units))
      .toBe('LMS 10건 중 무료 4건 · 과금 6건 발송 차감 (건당 27.5원) · 결과별 정산: 알림톡 5.5원 · SMS 대체 11원 · LMS 대체 27.5원');
    expect(buildDeductDescription('campaign', 'LMS', 0, 27.5, 10, units)).toBe('LMS 무료 제공 10건 발송 (과금 없음)');
  });

  test('붙여도 차감 건수·단가·무료 되읽기는 그대로다', () => {
    const desc = buildDeductDescription('campaign', 'LMS', 6, 27.5, 4, units);
    expect(parseDeductDescription(desc)).toEqual({ count: 6, unitPrice: 27.5 });
    expect(parseFreeCount(desc)).toBe(4);
  });

  test('왕복 — 0원 계약도 그대로 읽는다', () => {
    expect(parseAlimtalkUnits(buildDeductDescription('campaign', 'LMS', 10, 27.5, 0, units))).toEqual(units);
    const zero = { KAKAO: 0, SMS: 8.8, LMS: 22 };
    expect(parseAlimtalkUnits(buildDeductDescription('campaign', 'SMS', 3, 8.8, 0, zero))).toEqual(zero);
  });

  test('단가를 싣지 않은 옛 문구·다른 문구는 null', () => {
    expect(parseAlimtalkUnits(buildDeductDescription('campaign', 'LMS', 10, 27.5))).toBeNull();
    expect(parseAlimtalkUnits('발송 실패 환불 (LMS 2건 × 27.5원)')).toBeNull();
    expect(parseAlimtalkUnits(null)).toBeNull();
  });
});

describe('resolveAlimtalkLedgerUnits — 차감 원장 행들에서 결과별 정산 단가 하나를 고른다 (2026-09-26)', () => {
  const units = { KAKAO: 5.5, SMS: 11, LMS: 27.5 };
  const paid = (count: number, u: any = units) => ({ amount: count * 27.5, description: buildDeductDescription('campaign', 'LMS', count, 27.5, 0, u) });

  test('과금 행이 모두 같은 단가를 실었으면 그 단가', () => {
    expect(resolveAlimtalkLedgerUnits([paid(10), paid(5)])).toEqual(units);
  });

  test('금액 0 행(전량 무료)은 보지 않는다', () => {
    expect(resolveAlimtalkLedgerUnits([paid(10), { amount: 0, description: buildDeductDescription('campaign', 'LMS', 0, 27.5, 3) }])).toEqual(units);
  });

  test('과금 행 하나라도 단가가 없으면 null — 옛 방식으로 정산한다', () => {
    expect(resolveAlimtalkLedgerUnits([paid(10), { amount: 137.5, description: buildDeductDescription('campaign', 'LMS', 5, 27.5) }])).toBeNull();
  });

  test('과금 행끼리 단가가 다르면 null — 어느 쪽인지 추측하지 않는다', () => {
    expect(resolveAlimtalkLedgerUnits([paid(10), paid(5, { KAKAO: 6.6, SMS: 11, LMS: 27.5 })])).toBeNull();
  });

  test('과금 행이 없으면 null', () => {
    expect(resolveAlimtalkLedgerUnits([])).toBeNull();
    expect(resolveAlimtalkLedgerUnits([{ amount: 0, description: buildDeductDescription('campaign', 'LMS', 0, 27.5, 3) }])).toBeNull();
  });
});
