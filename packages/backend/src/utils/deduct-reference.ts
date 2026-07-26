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

/**
 * (순수) 차감 설명 되읽기 — 그 차감이 **몇 건을 얼마에** 깎았는지. (★ 2026-07-26)
 *
 * 신설 사유: 환불·회수·sweep이 정당 금액을 계산할 때 **지금 단가**를 곱하고 있었다.
 *   차감은 과거 단가로 일어났는데 환불은 현재 단가로 계산하면 그 차이만큼 회계가 어긋난다
 *   (`차감 = 성공 + 순환불` 불변식이 깨진다 — LESSONS_DB 2026-06-29).
 *   평소엔 단가가 안 바뀌어 드러나지 않지만, 전 업체 단가를 재입력하는 지금은 정확히 발동한다.
 *
 * 그래서 **그 차감 행이 기록한 값**을 되읽어 쓴다. 파싱은 `buildDeductDescription`과
 * 같은 파일에 둔다 — 형식을 바꾸면 두 함수를 함께 고치게 된다(따로 두면 조용히 어긋난다).
 *
 * 형식: `[라벨] SMS 1,000건 발송 차감 (건당 7.92원)` — 라벨 접두·천단위 콤마 모두 허용.
 * 되읽을 수 없으면 `null`(옛 형식·수기 조정 등) — 호출부는 그때만 현재 단가로 폴백한다.
 */
export function parseDeductDescription(description: string | null | undefined): { count: number; unitPrice: number } | null {
  const s = String(description || '');
  const m = s.match(/([\d,]+)\s*건\s*발송\s*차감\s*\(\s*건당\s*([\d.]+)\s*원\s*\)/);
  if (!m) return null;
  const count = Number(m[1].replace(/,/g, ''));
  const unitPrice = Number(m[2]);
  if (!Number.isFinite(count) || count <= 0) return null;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  return { count, unitPrice };
}
