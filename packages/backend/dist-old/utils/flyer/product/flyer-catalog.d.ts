/**
 * ★ CT-F11 — 전단AI 상품 카탈로그 컨트롤타워
 *
 * Phase A 기능 15번: 한 번 만든 상품을 재사용 자산화.
 * flyer_catalog 테이블 기반 CRUD + 인기 정렬 + POS 연동 매핑.
 *
 * ⚠️ 스켈레톤 — Phase A 구현 시 채운다.
 */
export interface CatalogItem {
    id: string;
    company_id: string;
    product_name: string;
    category: string | null;
    default_price: number | null;
    image_url: string | null;
    description: string | null;
    usage_count: number;
    pos_product_code: string | null;
}
/**
 * 카탈로그 목록 (usage_count 내림차순 = 자주 쓴 순).
 */
export declare function getCatalogItems(companyId: string, options?: {
    category?: string;
    search?: string;
    limit?: number;
    offset?: number;
}): Promise<{
    items: CatalogItem[];
    total: number;
}>;
/**
 * 전단지에 상품 사용 시 usage_count +1.
 */
export declare function touchCatalogUsage(itemId: string): Promise<void>;
/**
 * 카탈로그 아이템 추가/업데이트 (UPSERT by product_name).
 */
export declare function upsertCatalogItem(companyId: string, item: Partial<CatalogItem>): Promise<string>;
//# sourceMappingURL=flyer-catalog.d.ts.map