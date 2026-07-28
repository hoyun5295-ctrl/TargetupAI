/**
 * ★ CT: 세금계산서 작성일자 — 화면 미리보기 산식 (2026-07-28)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §5.
 *
 * ⚠ 발급 시 권위는 backend `utils/billing-settings.ts`의 `computeTaxbillIssueDate`다.
 *   이 파일은 **설정 화면에 "그래서 며칠로 찍히는가"를 보여주기 위한 표시 전용**이며,
 *   같은 입력에 같은 날짜를 내야 한다(스펙 = backend `billing-settings.test.ts`).
 *   프론트엔드는 backend를 import 할 수 없고 공유 패키지도 없어, 같은 순수 함수를 여기 CT로 둔다
 *   (`unitPrice.ts`·`planLabel.ts`와 같은 자리). 컴포넌트 안에 인라인으로 쓰지 않는다.
 *
 * 문자열 연산만 쓴다 — Date의 로컬 TZ 보정이 끼면 하루가 밀린다(0726 toISOString 계열).
 */

export type TaxbillDayPolicy = 'last_day' | 'first_day' | 'manual';

const p2 = (n: number): string => String(n).padStart(2, '0');

/**
 * (순수) 대상월(y년 m월, m은 1~12)에 대한 작성일자 YYYY-MM-DD.
 *  - last_day  → 대상월 말일 (30일 달이면 30일, 2월이면 28·29일)
 *  - first_day → 익월 1일 (12월분은 익년 1월 1일)
 *  - manual    → null (사람이 발급 때 지정)
 */
export function previewTaxbillIssueDate(policy: TaxbillDayPolicy, y: number, m: number): string | null {
  if (policy === 'last_day') {
    // Date.UTC(y, m, 0) = 그 달 말일 (m이 1-based라 그대로 "다음 달 0일")
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${p2(m)}-${p2(last)}`;
  }
  if (policy === 'first_day') {
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return `${ny}-${p2(nm)}-01`;
  }
  // manual + 알 수 없는 값. 화면 캐스팅(`as TaxbillDayPolicy`)이 무검증이라 여기로 이상값이 올 수 있다 —
  // 모르는 정책을 특정 날짜로 넘겨짚지 않는다(넘겨짚으면 틀린 작성일자를 맞는 것처럼 보여준다).
  return null;
}

/**
 * 설정 화면 미리보기 문구. 대상월이 정해지지 않은 화면이라 **지금 이 달**을 예로 든다.
 * 달이 바뀌면 문구도 따라 바뀐다 — 예시 월을 글자로 적어두면 그 달에만 맞는 안내가 된다.
 */
export function taxbillIssueDatePreviewText(policy: TaxbillDayPolicy, now: Date = new Date()): string {
  if (policy === 'manual') return '발급할 때마다 작성일자를 직접 지정합니다 (자동 발급 대상에서 빠집니다).';
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = previewTaxbillIssueDate(policy, y, m);
  if (!d) return '작성일자 정책을 확인할 수 없습니다. 다시 선택해 주세요.';
  return `지금 이 달(${y}년 ${m}월)분이면 작성일자는 ${d} 입니다.`;
}
