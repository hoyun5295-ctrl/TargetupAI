/**
 * ★ 2026-10-19 B-1004-2② — 잔액 원장의 차감(type=deduct) 중 발송이 아닌 것을 참조 유형으로 가른다.
 *   슈퍼관리자 회사 잔액 이력 · 입금 화면 두 곳이 같은 판정을 쓴다(옛: 크레딧 충전도 「발송 차감」으로 보였다).
 *   null = 일반 라벨(type) 그대로.
 */
export function deductRefLabel(type: string, referenceType: string | null | undefined): string | null {
  if (type !== 'deduct') return null;
  if (referenceType === 'plan_term') return '요금제 이용료';
  if (referenceType === 'credit_recharge') return 'AI 크레딧 충전';
  return null;
}
