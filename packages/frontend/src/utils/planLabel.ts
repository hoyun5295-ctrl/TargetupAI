/**
 * ★ CT: 요금제 표시 라벨 (2026-07-28)
 *
 * 슈퍼관리자 요금제 선택 드롭다운이 오래도록 `요금제명 (고객 수)`를 보여 줬다.
 * 관리 가능 DB 수량은 이미 폐기된 축이라 요금제를 고르는 자리에 맞지 않는다 —
 * 요금제를 고르는 기준은 **월정액**이다.
 *
 * 0원 요금제(미가입·무료체험·임직원)는 **이름만** 적는다.
 * `(월 0원)`은 "요금이 아직 안 정해졌다"로 읽히고, `(무료)`는 `무료체험 (무료)`처럼 겹쳐 읽힌다.
 * 값이 없다는 것 자체가 정보이므로 붙이지 않는 쪽이 목록을 훑을 때 더 빨리 갈린다.
 *
 * 표시 경로가 둘 이상(고객사 추가·고객사 수정)이라 여기 한 곳에서만 만든다 —
 * 화면마다 따로 조립하면 같은 요금제가 화면마다 다르게 보인다.
 */
export function formatPlanOptionLabel(
  planName: string | null | undefined,
  monthlyPrice: number | string | null | undefined,
): string {
  const name = String(planName ?? '').trim() || '(이름 없음)';
  const price = Number(monthlyPrice);
  if (!Number.isFinite(price) || price <= 0) return name;
  return `${name} (월 ${price.toLocaleString()}원)`;
}
