/**
 * deduct-reference.test.ts — 차감/환불 reference_type 라벨·설명 (순수)
 *
 * 배경(2026-07-07): prepaidDeduct가 테스트·스팸·여정·캠페인 차감을 전부 reference_type='campaign'으로
 *   하드코딩 → 차감이력에서 스팸필터 테스트 차감이 "LMS 3건 발송 차감"으로 일반 발송과 구분 불가
 *   → 발송내역엔 없고 차감이력엔 떠서 불일치·추적 불가(서수란 신고). reference_type를 유형별로 분리한다.
 */
import { describe, test, expect } from 'vitest';
import { deductReferenceLabel, buildDeductDescription } from './deduct-reference';

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
