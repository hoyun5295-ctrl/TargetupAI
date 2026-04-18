/**
 * 성별 정규화
 * 다양한 표현 → 'M' | 'F' | null
 *
 * 입력 예시:
 *   남, 남자, male, M, m, 1 → M
 *   여, 여자, female, F, f, 2 → F
 */

const MALE_PATTERNS = new Set(['남', '남자', '남성', 'male', 'm', '1', 'man', 'boy']);
const FEMALE_PATTERNS = new Set(['여', '여자', '여성', 'female', 'f', '2', 'woman', 'girl']);

export function normalizeGender(raw: unknown): 'M' | 'F' | null {
  if (raw === null || raw === undefined || raw === '') return null;

  const value = String(raw).trim().toLowerCase();

  if (MALE_PATTERNS.has(value)) return 'M';
  if (FEMALE_PATTERNS.has(value)) return 'F';

  return null;
}
