/**
 * 전화번호 정규화 유틸리티
 *
 * 모든 비숫자 문자를 제거하여 일관된 전화번호 형식을 보장합니다.
 * campaigns.ts, spam-filter.ts 등 전체 모듈에서 동일한 정규화 함수를 사용합니다.
 *
 * 패턴: /\D/g (비숫자 전체 제거) — 하이픈(-), 공백, 괄호, 점 등 모두 처리
 * 기존 replace(/-/g, '') → normalizePhone() 으로 통일
 */

/**
 * 전화번호에서 모든 비숫자 문자를 제거
 * @param phone - 원본 전화번호 문자열
 * @returns 숫자만 남은 전화번호 (예: '010-1234-5678' → '01012345678')
 */
export function normalizePhone(phone: string): string {
  if (!phone || typeof phone !== 'string') return '';
  return phone.replace(/\D/g, '');
}
