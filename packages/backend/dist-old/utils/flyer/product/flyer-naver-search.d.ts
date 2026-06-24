/**
 * ★ CT-F17 — 전단AI 네이버 쇼핑 검색 (상품 이미지 자동 매칭)
 *
 * 상품명으로 네이버 쇼핑 검색 → 상품 이미지 URL 반환.
 * 카탈로그 등록/CSV 업로드 시 자동 이미지 매칭에 사용.
 *
 * API: https://openapi.naver.com/v1/search/shop.json
 * 무료: 일 25,000건
 */
export interface NaverShopItem {
    title: string;
    link: string;
    image: string;
    lprice: string;
    hprice: string;
    mallName: string;
    maker: string;
    brand: string;
    category1: string;
    category2: string;
    category3: string;
}
export interface ImageSearchResult {
    query: string;
    items: NaverShopItem[];
    total: number;
}
export declare function searchNaverShopping(query: string, display?: number): Promise<ImageSearchResult>;
/**
 * ★ 이미지 URL → 로컬 서버에 다운로드 저장
 *
 * 네이버 쇼핑 이미지 URL은 외부 CDN이라 직접 링크하면 불안정.
 * 우리 서버에 저장하여 안정적으로 서빙.
 */
export declare function downloadAndSaveImage(imageUrl: string, companyId: string): Promise<string | null>;
/**
 * ★ 상품명으로 이미지 자동 매칭 (검색 → 1순위 이미지 다운로드 → URL 반환)
 *
 * CSV 업로드나 카탈로그 자동 등록 시 사용.
 */
export declare function autoMatchImage(productName: string, companyId: string): Promise<{
    imageUrl: string | null;
    source: 'naver' | 'none';
    candidates: NaverShopItem[];
}>;
/**
 * ★ 배치 이미지 매칭 — CSV 업로드 시 여러 상품 한번에 처리
 *
 * 네이버 API 호출 제한 고려하여 순차 실행 + 딜레이
 */
export declare function batchAutoMatchImages(products: Array<{
    name: string;
    index: number;
}>, companyId: string): Promise<Array<{
    index: number;
    name: string;
    imageUrl: string | null;
    candidates: NaverShopItem[];
}>>;
//# sourceMappingURL=flyer-naver-search.d.ts.map