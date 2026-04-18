/**
 * 전화번호 정규화 (휴대폰 전용)
 * 다양한 형식 → 01012345678 (숫자만)
 *
 * 입력 예시:
 *   +82-10-1234-5678 → 01012345678
 *   010.1234.5678    → 01012345678
 *   82-10-1234-5678  → 01012345678
 *   1012345678       → 01012345678
 */

export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;

  let phone = String(raw).trim();

  // 숫자, +, - 외 제거
  phone = phone.replace(/[^\d+]/g, '');

  // 국가코드 제거: +82, 82 → 0
  if (phone.startsWith('+82')) {
    phone = '0' + phone.slice(3);
  } else if (phone.startsWith('82') && phone.length > 10) {
    phone = '0' + phone.slice(2);
  }

  // 앞자리 0 보정 (10자리인 경우)
  if (phone.length === 10 && !phone.startsWith('0')) {
    phone = '0' + phone;
  }

  // 유효성: 한국 휴대폰 010, 011, 016, 017, 018, 019
  // 또는 일반전화 02, 031~064
  if (!/^0\d{9,10}$/.test(phone)) {
    return null; // 유효하지 않은 번호
  }

  return phone;
}

/**
 * 유선번호 유효성 검사
 * - 0으로 시작 + 휴대폰(01X) 아닌 7자리 이상이면 유선번호로 인정
 * - 1588, 1544, 1577 등 대표번호(8자리) 허용
 *
 * ※ 서버 packages/backend/src/utils/normalize.ts:242 와 동일 로직.
 */
export function isValidKoreanLandline(phone: string): boolean {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0') && !/^01[016789]/.test(cleaned) && cleaned.length >= 7) return true;
  if (/^1[0-9]{3}/.test(cleaned) && cleaned.length === 8) return true;
  return false;
}

/**
 * 매장전화번호 정규화 — 유선번호 + 휴대폰 모두 허용
 *
 * ※ M-2 (SyncAgent v1.5.0): 기존 normalizePhone(휴대폰 전용)만으로는
 *    매장 유선번호(02, 031, 1588 등)가 null 처리되는 버그(D74) → 전용 함수 추가.
 *    서버 packages/backend/src/utils/normalize.ts:258-293 로직을 그대로 포팅.
 *
 * 반환 규칙:
 *   - 휴대폰: normalizePhone 위임 (숫자만)
 *   - 유선번호: 하이픈 포함 원본 유지 (포맷팅 복원)
 *   - 대표번호(1588 등): 숫자만 (8자리)
 *   - 유효하지 않으면 null
 */
export function normalizeStorePhone(value: unknown): string | null {
  if (value == null || value === '') return null;
  let v = String(value).trim();
  // 특수문자 제거
  v = v.replace(/[\s\(\)\+\.]/g, '');
  // 하이픈만 남긴 원본 보관 (포맷팅 복원용)
  const withHyphens = v;
  // 숫자만 추출
  const digits = v.replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;

  // 앞 0 빠짐 보정 (Excel 숫자 저장)
  let cleaned = digits;
  if (!cleaned.startsWith('0') && /^[2-9]/.test(cleaned)) {
    cleaned = '0' + cleaned;
  }

  // 휴대폰이면 normalizePhone 위임
  if (/^01[016789]/.test(cleaned)) {
    return normalizePhone(value);
  }

  // 유선번호
  if (isValidKoreanLandline(cleaned)) {
    if (withHyphens.includes('-')) return withHyphens;
    return cleaned;
  }

  // 대표번호 (1588 등)
  if (/^1[0-9]{3}/.test(cleaned) && cleaned.length === 8) {
    return cleaned;
  }

  return null;
}
