/**
 * CT: product-images.ts — 상품 이미지 자동 매핑 컨트롤타워
 *
 * 3단계 이미지 소싱:
 *   1. DALL-E 생성 이미지 (서버 저장, 최우선)
 *   2. Unsplash 큐레이션 이미지 (키워드 매핑 폴백)
 *   3. 이모지 (최종 폴백)
 *
 * 사용처: short-urls.ts (전단지 공개 페이지 렌더링), flyers.ts (이미지 생성 API)
 */
export interface ProductDisplay {
    emoji: string;
    imageUrl: string | null;
}
/**
 * 상품명에서 키워드를 매칭하여 이모지 + 이미지 URL을 반환.
 * 매칭되지 않으면 이모지만 '📦', 이미지는 null.
 */
export declare function getProductDisplay(productName: string): ProductDisplay;
/**
 * 이모지만 반환 (하위호환용 — 기존 getEmoji 대체)
 */
export declare function getEmoji(productName: string): string;
/**
 * 이미지 태그 또는 이모지 태그 반환 (HTML 렌더링용)
 * 우선순위: DALL-E 생성 이미지 > Unsplash > 이모지
 * @param size - 이미지 크기 (기본 48px)
 * @param generatedImageUrl - DALL-E 생성 이미지 URL (있으면 최우선)
 */
export declare function renderProductImage(productName: string, size?: number, generatedImageUrl?: string): string;
/**
 * DALL-E 3로 상품 이미지 생성 + 서버 저장
 * @returns 로컬 파일 경로 또는 null (실패 시)
 */
export declare function generateProductImage(productName: string): Promise<string | null>;
/**
 * 전단지의 모든 상품에 대해 이미지 일괄 생성 (비동기 백그라운드)
 * @returns 생성 결과 { 상품명: 이미지URL }
 */
export declare function generateFlyerImages(categories: any[]): Promise<Record<string, string>>;
/**
 * 상품명으로 생성된 이미지의 API URL 반환
 * (Nginx에서 /api/flyer/product-images/ 를 서빙하거나, 별도 엔드포인트에서 제공)
 */
export declare function getGeneratedImageUrl(productName: string): string | null;
/**
 * 최종 이미지 URL 결정
 * ⚠️ DALL-E = AI 느낌 강함, Unsplash = 외국 식재료 느낌 → 둘 다 부적합
 * 이모지가 가장 깔끔하고 안정적 (로드 실패 없음, 한국 마트 느낌)
 */
export declare function resolveProductImageUrl(productName: string): string | null;
//# sourceMappingURL=product-images.d.ts.map