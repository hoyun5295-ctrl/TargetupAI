/**
 * format-number.ts — 숫자 포맷팅 컨트롤타워 (D111)
 *
 * 배경:
 *   - 백엔드 messageUtils.replaceVariables는 소수점 필수 패턴 `\d+\.\d+`만 감지 → 정수 50000이 쉼표 없이 발송
 *   - 프론트 formatPreviewValue는 정수도 감지 → 미리보기는 쉼표 O
 *   - 두 곳의 규칙이 달라서 미리보기/실전송 불일치 (PDF 0408 지적)
 *
 * 정책 (Harold님 확정):
 *   - 정수는 정수 그대로 (강제 소수점 금지): 50000 → 50,000 (NOT 50,000.00)
 *   - trailing zero 제거: 50000.00 → 50,000
 *   - 유효 소수 자릿수 보존: 50000.5 → 50,000.5 / 50000.55 → 50,000.55
 *   - 전화번호(0시작/하이픈 포함) 제외
 *   - YYMMDD 6자리 / YYYYMMDD 8자리 날짜 제외 (월/일 범위 검증)
 *
 * ⚠️ 동일 규칙이 frontend/utils/formatDate.ts 의 formatNumericLike 에도 존재.
 *    규칙 변경 시 반드시 양쪽 동시 수정. 한쪽만 고치면 미리보기/실전송 불일치 재발.
 */

/**
 * 값이 "숫자처럼 보이는지" 판정 후 천단위 쉼표 포맷 문자열 반환.
 * 숫자가 아니거나 제외 조건에 걸리면 null 반환 → 호출부는 원본 문자열 사용.
 */
export function formatNumericLike(value: any): string | null {
  if (value === null || value === undefined) return null;

  // number 타입 직접 처리
  if (typeof value === 'number') {
    if (!isFinite(value)) return null;
    return formatFiniteNumber(value);
  }

  const str = String(value).trim();
  if (!str) return null;

  // 1. 전화번호 제외: 0으로 시작하는 순수 숫자 (01012345678, 0212345678 등)
  if (/^0\d+$/.test(str)) return null;

  // 2. 하이픈 포함 숫자열 제외 (1800-8125, 02-1234-5678)
  if (/^\d[\d-]+\d$/.test(str) && str.includes('-')) return null;

  // 3. 쉼표 제거 후 정수/소수 패턴 매칭
  const clean = str.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(clean)) return null;

  // 4. YYMMDD (6자리) 날짜 → 날짜 형태 문자열 반환 (PPT#1: 숫자 제외만이 아니라 날짜로 변환)
  if (/^\d{6}$/.test(clean)) {
    const mm = parseInt(clean.slice(2, 4), 10);
    const dd = parseInt(clean.slice(4, 6), 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const yy = parseInt(clean.slice(0, 2), 10);
      const yyyy = yy >= 50 ? 1900 + yy : 2000 + yy;
      return `${yyyy}.${String(mm).padStart(2, '0')}.${String(dd).padStart(2, '0')}`;
    }
  }

  // 5. YYYYMMDD (8자리) 날짜 → 날짜 형태 문자열 반환 (PPT#1: 숫자 제외만이 아니라 날짜로 변환)
  if (/^\d{8}$/.test(clean)) {
    const mm = parseInt(clean.slice(4, 6), 10);
    const dd = parseInt(clean.slice(6, 8), 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${clean.slice(0, 4)}.${clean.slice(4, 6)}.${clean.slice(6, 8)}`;
    }
  }

  const num = Number(clean);
  if (isNaN(num) || !isFinite(num)) return null;
  return formatFiniteNumber(num);
}

/**
 * 유한한 숫자를 천단위 쉼표 포맷 문자열로 변환.
 * - 정수: 50000 → "50,000" (소수점 없음)
 * - 소수: 50000.5 → "50,000.5" (유효자리 그대로)
 * - trailing zero: 50000.00 → "50,000" (Number가 50000으로 파싱)
 */
function formatFiniteNumber(num: number): string {
  if (Number.isInteger(num)) {
    return num.toLocaleString('ko-KR');
  }
  // num.toString() 은 trailing zero 자동 제거: 50000.50 → "50000.5"
  const [intPart, decPart] = num.toString().split('.');
  const intFormatted = Number(intPart).toLocaleString('ko-KR');
  return decPart ? `${intFormatted}.${decPart}` : intFormatted;
}
