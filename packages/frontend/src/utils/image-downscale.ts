/**
 * image-downscale.ts — 업로드 이미지 클라이언트 다운스케일 (2026-07-08)
 *
 * 행사 캠페인 이미지 판독(vision) 업로드 전, 긴 변 최대 1568px + JPEG 재인코딩으로
 * 페이로드/판독 비용을 줄인다. 캔버스 인코딩 실패 시 원본 파일을 그대로 반환(안전 폴백).
 */

const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.85;

/** File → 다운스케일 JPEG Blob. 실패 시 원본 File 반환. */
export async function downscaleToJpeg(file: File): Promise<Blob> {
  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap as any, 0, 0, w, h);
    if ('close' in bitmap && typeof (bitmap as any).close === 'function') (bitmap as any).close();

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY),
    );
    return blob || file;
  } catch {
    return file;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img> 경로
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 로드 실패'));
    };
    img.src = url;
  });
}
