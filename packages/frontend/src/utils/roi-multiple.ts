/**
 * ★ 2026-10-25 원장 #32 — 투자 대비 배수(ROI 「N.N×」) 한 곳 = 예상 매출 ÷ 발송비.
 *   옛: 제안 카드가 추정기의 퍼센트 값(×100)을 그대로 「N.N×」로 그려 100배 부풀렸다(350% → 「350.0×」) · 결과 카드는 매출 ÷ 비용으로 바르게.
 *   0 · 값 없음 = null(그리지 않는다).
 */
export function roiMultiple(revenue: number | null | undefined, cost: number | null | undefined): number | null {
  const r = Number(revenue) || 0;
  const c = Number(cost) || 0;
  return c > 0 && r > 0 ? r / c : null;
}
