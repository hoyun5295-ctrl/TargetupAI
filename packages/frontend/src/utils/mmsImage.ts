/**
 * mmsImage.ts — MMS 이미지 경로/원본 파일명 추출 컨트롤타워 (프론트)
 *
 * ★ D124 N4: campaigns.mms_image_paths(JSONB)가 두 가지 형태를 동시 수용:
 *   - 과거: string[]                                — 절대경로만
 *   - 신규: Array<{ path, originalName }>           — 경로 + 원본 파일명
 *
 * 표시 경로(ResultsModal, AdminDashboard, AiPreview 등)에서 filename 추출 시 반드시 사용.
 */

export type MmsImageItem = string | { path?: string; originalName?: string };

/** 서버 절대경로 추출 — mmsServerPathToUrl 등에 넘길 값 */
export function getMmsImagePath(item: MmsImageItem): string {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return item.path || '';
}

/**
 * 표시용 파일명 추출.
 * - 신규(객체): originalName 우선 (예: "KRC-재구매_02.jpg")
 * - 업로드 직후 클라이언트 객체: filename 차선 (예: {url, serverPath, filename, size})
 * - 과거(문자열/path만): 경로 basename (예: "a00e5390-....jpg")
 *
 * ★ B3(0417 PDF #3): 업로드 직후 객체({serverPath, filename}) 케이스도 수용 —
 *   발송창 썸네일/업로드 모달/미리보기 모든 경로에서 단일 진입점.
 */
export function getMmsImageDisplayName(item: MmsImageItem | any, fallback = ''): string {
  if (!item) return fallback;
  if (typeof item === 'object') {
    if (item.originalName) return item.originalName;
    if (item.filename) return item.filename; // 업로드 직후 클라이언트 상태 (Dashboard mmsUploadedImages)
    const p = item.path || item.serverPath || '';
    return p.replace(/\\/g, '/').split('/').pop() || fallback;
  }
  const p = getMmsImagePath(item);
  return p.replace(/\\/g, '/').split('/').pop() || fallback;
}
