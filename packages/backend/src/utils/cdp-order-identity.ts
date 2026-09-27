/**
 * CT: 자사몰 주문의 외부 고객 id (★ 2026-09-27 한줄로 V2 R245 · 순수 · import 0)
 *
 * 회원 id → 비회원은 `guest:{휴대폰}` → 번호도 없으면 `order:{주문번호}`. 고도몰 파서(godo-parse)가 쓰던 규칙을 CT로 올렸다.
 * 옛: 아임웹·카페24·네이버는 회원 id만 넣어 비회원 주문이 빈 값 → 주문 적재 CT(syncOrder)가 예외 → 주문이 쌓이지 않았다.
 */
export function orderExternalId(memberId: unknown, phone: unknown, orderId: unknown): string {
  const m = String(memberId ?? '').trim();
  if (m) return m;
  const p = String(phone ?? '').trim();
  if (p) return `guest:${p}`;
  return `order:${String(orderId ?? '').trim()}`;
}
