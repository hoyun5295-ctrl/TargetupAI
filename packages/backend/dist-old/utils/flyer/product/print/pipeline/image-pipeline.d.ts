/**
 * ★ D129 V2 — 인쇄전단 이미지 파이프라인 (기존 자산 재사용 전용)
 *
 * 역할: 상품 리스트의 imageUrl을 인쇄 가능한 품질로 변환
 *
 * 이미지 소싱 순서 (전부 기존 컨트롤타워 재사용):
 *   1. product-images.ts getProductDisplay() — PRODUCT_MAP(한국 마트 상품 60개 키워드) 매칭
 *   2. flyer-naver-search.ts searchNaverShopping() — 네이버 쇼핑 API (한국 실사 판매상품)
 *   (외국 API 사용 금지 — 한국 마트 상품 매칭 정확도 낮음)
 *
 * 배경제거: 기존 flyer-rembg.ts removeBackground() 재사용
 *   - 결과는 data:image/png;base64 data URL 인라인 (Puppeteer 네트워크 의존 제거)
 *
 * 실패 정책: 각 단계 실패 시 원본 유지 (기간계 안정성)
 */
export interface PipelineProduct {
    productName: string;
    imageUrl?: string;
    category?: string;
    [key: string]: any;
}
export interface PipelineOptions {
    autoRembg?: boolean;
    autoMatchImage?: boolean;
    companyId?: string;
}
export declare function processProductImages<T extends PipelineProduct>(products: T[], opts?: PipelineOptions): Promise<T[]>;
//# sourceMappingURL=image-pipeline.d.ts.map