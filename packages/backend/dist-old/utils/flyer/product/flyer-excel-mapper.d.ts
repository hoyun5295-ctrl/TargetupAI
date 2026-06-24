/**
 * ★ CT-F24 — 전단AI 엑셀 업로드 + AI 자동 매핑
 *
 * 한줄로AI upload.ts의 AI 매핑 패턴을 전단AI에 적용.
 * 엑셀(xlsx/xls) 업로드 → 헤더 추출 → AI 자동 매핑 → 상품 데이터 변환
 *
 * 매핑 대상 필드:
 *   - product_name: 상품명 (필수)
 *   - sale_price: 판매가/할인가 (필수)
 *   - original_price: 원가/정가
 *   - unit: 단위/규격 (kg, g, 팩, 봉 등)
 *   - category: 카테고리 (축산, 청과, 수산 등)
 *   - promo_type: 행사구분 (메인/서브/일반)
 *   - origin: 원산지
 *   - image_url: 이미지 URL
 */
export interface FlyerProductMapping {
    [excelHeader: string]: string | null;
}
export interface FlyerMappingResult {
    success: boolean;
    mapping: FlyerProductMapping;
    unmapped: string[];
    hasProductName: boolean;
    hasSalePrice: boolean;
    message: string;
}
export interface MappedProduct {
    productName: string;
    salePrice: number;
    originalPrice: number;
    unit: string;
    category: string;
    promoType: 'main' | 'sub' | 'general';
    origin: string;
    imageUrl: string;
}
export declare function mapFlyerExcelHeaders(headers: string[]): Promise<FlyerMappingResult>;
export declare function applyFlyerMapping(rows: Record<string, any>[], mapping: FlyerProductMapping): MappedProduct[];
export declare function getFlyerMappingFields(): {
    fieldKey: string;
    displayName: string;
    description: string;
    required: boolean;
}[];
//# sourceMappingURL=flyer-excel-mapper.d.ts.map