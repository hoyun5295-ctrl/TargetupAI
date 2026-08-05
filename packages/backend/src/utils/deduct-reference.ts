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
 *
 * ★ 2026-08-05 요금제 무료 메시징 — `freeCount`(요금제 제공분으로 덮인 건수)를 함께 싣는다.
 *   무료가 0이면 **문구가 종전과 한 글자도 다르지 않다**(기존 행·기존 테스트 무손상).
 *
 *   왜 여기에 싣는가: 정산 축이 `차감 건수`에서 `부담 건수(= 차감 + 무료)`로 넓어지는데,
 *   그 값을 두 번째 저장소에 두면 원장과 갈릴 수 있다. 이 파일은 이미 "만드는 함수와 되읽는 함수를
 *   같은 곳에 둔다"는 계약을 갖고 있으므로(아래 parseDeductDescription) 무료도 같은 자리에 둔다.
 *
 *   형식 두 가지 — 되읽기 규칙은 parseDeductDescription 주석 참조.
 *   · 부분 무료: `SMS 100건 중 무료 40건 · 과금 60건 발송 차감 (건당 7.92원)`
 *   · 전량 무료: `SMS 무료 제공 100건 발송 (과금 없음)`  ← 차감액 0이라 단가 축이 없다
 */
export function buildDeductDescription(
  refType: string, messageType: string, count: number, unitPrice: number, freeCount: number = 0,
): string {
  const prefix = refType && refType !== 'campaign' ? `[${deductReferenceLabel(refType)}] ` : '';
  const free = Math.max(0, Math.floor(Number(freeCount) || 0));
  if (free <= 0) return `${prefix}${messageType} ${count}건 발송 차감 (건당 ${unitPrice}원)`;
  if (count <= 0) return `${prefix}${messageType} 무료 제공 ${free}건 발송 (과금 없음)`;
  return `${prefix}${messageType} ${count + free}건 중 무료 ${free}건 · 과금 ${count}건 발송 차감 (건당 ${unitPrice}원)`;
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
 *
 * ★ 2026-08-05 무료 메시징 — 이 함수의 계약은 **바뀌지 않는다**.
 *   부분 무료 문구(`SMS 100건 중 무료 40건 · 과금 60건 발송 차감 (건당 7.92원)`)에서도
 *   정규식이 잡는 것은 `과금 60건` 조각이라 **`count`는 언제나 실제 차감 건수**다(단가 역산 그대로 성립).
 *   전량 무료 문구에는 `발송 차감` 자체가 없어 `null`이고, 그 행은 차감액이 0이라 단가 축에 기여할 것도 없다
 *   (`prepaid.ts loadDeductLedger`가 금액 0 행을 단가 역산에서 제외한다).
 *   무료 건수는 아래 `parseFreeCount`가 따로 읽는다 — 한 문자열, 두 물음.
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

/**
 * (순수) 차감 설명에서 **요금제 무료 제공으로 덮인 건수**를 되읽는다. (★ 2026-08-05)
 *
 * 정산이 쓰는 축은 `차감 건수`가 아니라 **`부담 건수 = 차감 + 무료`**다.
 * 무료분만큼 차감이 줄어드는데 성공 건수는 줄지 않으므로, 차감만 보면
 * "성공 > 차감"이 되어 정당 환불 한도가 0으로 계산되고 **정상 환불을 초과로 오인해 회수한다**
 * (`mysql-refund-sweeper` maxLegitRefund / `refundInvariantGap`).
 *
 * 무료가 없던 옛 행·다른 유형 문구는 `0` — 부담 = 차감이 되어 종전 계산과 완전히 같다.
 */
export function parseFreeCount(description: string | null | undefined): number {
  const m = String(description || '').match(/무료(?:\s*제공)?\s*([\d,]+)\s*건/);
  if (!m) return 0;
  const free = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(free) && free > 0 ? free : 0;
}
