/**
 * mms-image-util.ts — MMS 이미지 경로/원본 파일명 추출 컨트롤타워 (백엔드)
 *
 * ★ D124 N4: campaigns.mms_image_paths(JSONB) 구조가 두 가지 형태를 동시 수용:
 *   - 과거: string[]                                — 절대경로만
 *   - 신규: Array<{ path: string; originalName: string }>  — 경로 + 원본 파일명
 *
 * QTmsg 큐 INSERT/발송 시에는 항상 절대경로 문자열만 필요.
 * 표시용(발송결과 UI/엑셀)에서는 원본 파일명이 있으면 그것을 우선 사용.
 */

export type MmsImageItem = string | { path?: string; originalName?: string };

/**
 * mms_image_paths에서 서버 절대경로만 추출.
 * QTmsg Agent가 파일 시스템에서 읽을 경로.
 */
export function getMmsImagePath(item: MmsImageItem): string {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return item.path || '';
}

/**
 * mms_image_paths에서 표시용 파일명 추출.
 * - 신규 구조(객체)면 originalName 반환
 * - 과거 구조(문자열)면 경로의 basename 반환 (fallback)
 */
export function getMmsImageDisplayName(item: MmsImageItem): string {
  if (!item) return '';
  if (typeof item === 'object' && item.originalName) return item.originalName;
  const p = getMmsImagePath(item);
  return p.replace(/\\/g, '/').split('/').pop() || '';
}

/**
 * 배열 전체를 절대경로 string[]로 정규화 (QTmsg용).
 * null/undefined 항목 제거.
 */
export function normalizeMmsImagePaths(items: MmsImageItem[] | null | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items.map(getMmsImagePath).filter(Boolean);
}
