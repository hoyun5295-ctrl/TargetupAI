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

/**
 * 발송 payload 조립 컨트롤타워 — Dashboard 7곳의 인라인 `.map(img => ({ path, originalName }))` 통합.
 * 업로드 직후 객체 `{serverPath, url, filename, originalName?, size}`를 DB 저장용 `{path, originalName}`으로 변환.
 *
 * ★ D136 (D3): 빈 슬롯(null/undefined/path 없음) 자동 제외 + 순서 compact.
 *   기존: 사용자가 UI에서 이미지 1/2/3 중 슬롯 2,3에만 업로드 → `[null, img2, img3]`로 배열 저장 →
 *         map 결과 3개 `{path:'', ...}, {path:img2, ...}, {path:img3, ...}` → DB에 빈 객체 포함 →
 *         예약대기/발송결과/캘린더에서 3장 카운트 + 빈 슬롯 엑박 표시 버그.
 *   수정: filter로 빈 슬롯 제거 → 실제 업로드된 이미지만 순서대로 압축. UI는 그대로 유지.
 */
/**
 * ★2026-09-10 경로 배열 + 원본 파일명 배열(같은 순서)을 표시용 항목으로 묶는다(대행발송 `mms_image_names` · 임은지 접수).
 * 이름이 있는 칸만 `{ path, originalName }`이 되고, 없는 칸·옛 접수(null)는 원래 항목 그대로다(표시 = 저장 파일명).
 * 결과는 공용 `MmsImagePreview`·`getMmsImageDisplayName`이 그대로 읽는다.
 */
export function withMmsImageNames(paths: MmsImageItem[], names?: string[] | null): MmsImageItem[] {
  if (!Array.isArray(paths)) return [];
  if (!Array.isArray(names)) return paths;
  return paths.map((item, i) => {
    const name = typeof names[i] === 'string' ? names[i].trim() : '';
    return name ? { path: getMmsImagePath(item), originalName: name } : item;
  });
}

/**
 * ★2026-09-10 자동 맞춤 업로드(대행발송 화면 접수) 원본 한 장 상한.
 * 서버 `utils/mms-image-fit.ts MMS_FIT_MAX_UPLOAD_BYTES`와 같은 값이어야 한다(계약 테스트 · 갈리면 한쪽이 거짓 안내).
 */
export const MMS_AUTOFIT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const PHOTO_EXT_RE = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?)$/i;

/**
 * 자동 맞춤 업로드의 브라우저 사전 검사. 사진이 아닌 파일과 상한 초과만 막는다.
 * JPG·300KB 규격은 서버가 맞춘다(여기서 막으면 맞춤 기능이 죽는다). 형식 최종 판정도 서버가 한다.
 * @returns 막을 사유(없으면 null)
 */
export function precheckMmsAutoFitFile(file: { name: string; size: number; type?: string }): string | null {
  const isPhoto = String(file.type || '').toLowerCase().startsWith('image/') || PHOTO_EXT_RE.test(file.name || '');
  if (!isPhoto) return `${file.name}: 사진 파일만 첨부할 수 있습니다(JPG·PNG 등)`;
  if (file.size > MMS_AUTOFIT_MAX_UPLOAD_BYTES) {
    return `${file.name}: ${(file.size / (1024 * 1024)).toFixed(1)}MB입니다. 한 장 ${MMS_AUTOFIT_MAX_UPLOAD_BYTES / (1024 * 1024)}MB까지 올릴 수 있습니다`;
  }
  return null;
}

export function toMmsImagePaths(
  images: Array<{ serverPath?: string; path?: string; originalName?: string } | any>,
): Array<{ path: string; originalName: string }> {
  if (!Array.isArray(images)) return [];
  return images
    .filter((img: any) => !!(img?.serverPath || img?.path))
    .map((img: any) => ({
      path: img?.serverPath || img?.path || '',
      originalName: img?.originalName || '',
    }));
}
