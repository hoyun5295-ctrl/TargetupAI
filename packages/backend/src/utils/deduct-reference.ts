/**
 * deduct-reference.ts — 선불 차감/환불 reference_type 라벨·설명 (순수, DB import 0)
 *
 * ★ 2026-07-07: prepaidDeduct가 모든 차감을 reference_type='campaign'으로 하드코딩하던 결함 수정.
 *   테스트·스팸필터 테스트·여정 차감이 "LMS N건 발송 차감"으로 일반 캠페인 발송과 구분 불가 →
 *   차감이력(충전관리)엔 뜨는데 발송내역(캠페인)엔 없어 불일치·추적 불가(서수란 신고 2026-07-06).
 *   유형별 reference_type로 분리 기록하고, 차감이력 화면·차감 설명이 유형을 표시하게 한다.
 *   차감↔환불은 (reference_type, reference_id) 쌍으로 매칭되므로 차감·환불이 같은 유형을 써야 한다(prepaid.ts).
 */

/** 차감/환불 reference_type. balance_transactions.reference_type(varchar 30)에 저장. */
export type DeductReferenceType = 'campaign' | 'test' | 'spam' | 'journey' | 'brand';

/**
 * reference_type → 사용자 표시 라벨(차감이력 화면·차감 설명 공용).
 * 미지정/옛 데이터(null·빈값)·미지의 값은 '캠페인 발송'(기본) — 기존 대부분이 campaign이라 안전.
 */
export function deductReferenceLabel(refType: string | null | undefined): string {
  switch (refType) {
    case 'test': return '테스트 발송';
    case 'spam': return '스팸필터 테스트';
    case 'journey': return '여정 발송';
    case 'brand': return '브랜드메시지';
    case 'campaign':
    default: return '캠페인 발송';
  }
}

/**
 * prepaidDeduct 차감 설명. campaign은 기존 문구 그대로(하위호환), 그 외 유형만 `[라벨] ` 접두사로 구분.
 * 예) spam → "[스팸필터 테스트] LMS 3건 발송 차감 (건당 26.4원)"
 */
export function buildDeductDescription(refType: string, messageType: string, count: number, unitPrice: number): string {
  const prefix = refType && refType !== 'campaign' ? `[${deductReferenceLabel(refType)}] ` : '';
  return `${prefix}${messageType} ${count}건 발송 차감 (건당 ${unitPrice}원)`;
}
