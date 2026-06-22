/**
 * dm-code.ts — DM 단축코드 정규화 (순수, DB import 0)
 *
 * ★ 2026-06-22: 발행/테스트 공개 URL은 `.../dm-{short_code}` 형식(dm.ts 발행 333·테스트 585)인데
 *   viewer 라우트(/api/dm/v/:code)가 받은 :code를 그대로 short_code 컬럼과 비교해 조회가 실패했다
 *   (short_code 저장값은 "dm-" 없는 7자라 'dm-BJF71HG' ≠ 'BJF71HG' → "존재하지 않는 DM").
 *   해법: 조회 직전 선두 "dm-" 접두사를 1회 제거. short_code 문자셋은 영숫자뿐이라 하이픈은 접두사로만 등장.
 */
export function normalizeDmShortCode(raw: string): string {
  if (!raw) return '';
  return String(raw).trim().replace(/^dm-/, '');
}
