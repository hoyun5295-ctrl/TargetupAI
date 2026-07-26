/**
 * deduct-reference.test.ts — 차감/환불 reference_type 라벨·설명 (순수)
 *
 * 배경(2026-07-07): prepaidDeduct가 테스트·스팸·여정·캠페인 차감을 전부 reference_type='campaign'으로
 *   하드코딩 → 차감이력에서 스팸필터 테스트 차감이 "LMS 3건 발송 차감"으로 일반 발송과 구분 불가
 *   → 발송내역엔 없고 차감이력엔 떠서 불일치·추적 불가(서수란 신고). reference_type를 유형별로 분리한다.
 */
import { describe, test, expect } from 'vitest';
import { deductReferenceLabel, buildDeductDescription, parseDeductDescription } from './deduct-reference';

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
