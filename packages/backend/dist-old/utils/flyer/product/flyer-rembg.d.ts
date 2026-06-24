/**
 * ★ rembg 클라이언트 — 상품 이미지 누끼(배경 제거) 처리
 *
 * Phase 2: 인쇄용 전단 이미지 생성 시 상품 이미지 배경 제거
 * - rembg Docker 서비스 (danielgatis/rembg) 또는 로컬 설치 연동
 * - 서비스 미가동 시 원본 이미지 fallback (기간계 안정성)
 */
/**
 * 이미지 배경 제거
 * @param imageBuffer 원본 이미지 바이너리
 * @returns 배경 제거된 PNG 바이너리 (실패 시 원본 반환)
 */
export declare function removeBackground(imageBuffer: Buffer): Promise<Buffer>;
/**
 * rembg 서비스 가용 여부 확인
 */
export declare function isRembgAvailable(): Promise<boolean>;
//# sourceMappingURL=flyer-rembg.d.ts.map