/**
 * 금액 정규화
 * 다양한 형식 → 숫자 (number)
 *
 * 입력 예시:
 *   ₩1,000원   → 1000
 *   1,000      → 1000
 *   ￦10000     → 10000
 *   10,000.50  → 10000.5
 *   -500       → -500
 */

export function normalizeAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;

  // 이미 숫자
  if (typeof raw === 'number') {
    return isNaN(raw) ? null : raw;
  }

  let value = String(raw).trim();

  // 통화 기호 제거
  value = value.replace(/[^0-9.\-]/g, '');

  // 콤마 제거
  value = value.replace(/,/g, '');

  // 공백 제거
  value = value.replace(/\s/g, '');

  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}
