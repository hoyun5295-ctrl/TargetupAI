/**
 * dm-image-url.ts — 저장된 이미지 src를 실제 서빙되는 공개 경로(/api/dm/v/images)로 정규화.
 * 백엔드 publicImageUrl의 프런트 미러. 캔버스·editor·썸네일이 reachable URL로 이미지를 표시하게 한다.
 * (기존 업로드가 서빙 안 되는 /api/flyer/p/dm-images/... 로 저장돼 있어도 여기서 복구.)
 */
export function dmImageUrl(src: string | undefined | null): string {
  if (!src) return '';
  if (src.startsWith('data:') || src.startsWith('http')) return src;
  const m = src.match(/\/(?:api\/dm\/images|api\/flyer\/p\/dm-images|api\/dm\/v\/images)\/([^/]+)\/([^/]+)$/);
  if (!m) return src;
  return `/api/dm/v/images/${m[1]}/${m[2]}`;
}
