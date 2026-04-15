/**
 * ★ rembg 클라이언트 — 상품 이미지 누끼(배경 제거) 처리
 *
 * Phase 2: 인쇄용 전단 이미지 생성 시 상품 이미지 배경 제거
 * - rembg Docker 서비스 (danielgatis/rembg) 또는 로컬 설치 연동
 * - 서비스 미가동 시 원본 이미지 fallback (기간계 안정성)
 */

const REMBG_URL = process.env.REMBG_URL || 'http://localhost:5100/api/remove';
const TIMEOUT_MS = 15000; // 15초 타임아웃

/**
 * 이미지 배경 제거
 * @param imageBuffer 원본 이미지 바이너리
 * @returns 배경 제거된 PNG 바이너리 (실패 시 원본 반환)
 */
export async function removeBackground(imageBuffer: Buffer): Promise<Buffer> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(REMBG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: imageBuffer,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[rembg] 응답 오류 (${res.status}) — 원본 이미지 사용`);
      return imageBuffer;
    }

    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    // rembg 서비스 미가동 시 원본 이미지 fallback
    console.warn(`[rembg] 연결 실패 — 원본 이미지 사용: ${err.message}`);
    return imageBuffer;
  }
}

/**
 * rembg 서비스 가용 여부 확인
 */
export async function isRembgAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(REMBG_URL.replace('/api/remove', '/'), {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
