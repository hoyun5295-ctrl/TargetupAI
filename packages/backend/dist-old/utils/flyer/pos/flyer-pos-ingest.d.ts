/**
 * ★ CT-F12 — 전단AI POS Agent 데이터 수신/정규화 컨트롤타워
 *
 * POS Agent가 보내는 판매/재고/회원 데이터를
 * flyer_pos_sales, flyer_pos_inventory, flyer_customers에 저장.
 *
 * 설계: FLYER-POS-AGENT.md §3 서버 API, FLYER-POS-AGENT-DEV.md
 */
export interface PosSaleItem {
    receipt_no: string;
    sold_at: string;
    product_code: string;
    product_name: string;
    category?: string;
    quantity?: number;
    unit_price?: number;
    sale_price?: number;
    total_amount?: number;
    cost_price?: number;
    pos_member_id?: string;
    raw?: Record<string, any>;
}
export interface PosInventoryItem {
    product_code: string;
    product_name: string;
    category?: string;
    current_stock?: number;
    unit?: string;
    cost_price?: number;
    sale_price?: number;
    expiry_date?: string;
    raw?: Record<string, any>;
}
export interface PosMember {
    pos_member_id: string;
    name?: string;
    phone?: string;
    gender?: string;
    birth_date?: string;
    grade?: string;
    points?: number;
    total_purchase?: number;
    last_purchase_at?: string;
    sms_opt_in?: boolean;
}
export interface IngestResult {
    accepted: number;
    rejected: number;
    errors: Array<{
        index: number;
        reason: string;
    }>;
}
/**
 * POS Agent 인증 (agent_key 검증).
 */
export declare function verifyPosAgent(agentKey: string): Promise<{
    companyId: string;
    agentId: string;
} | null>;
/**
 * ★ 판매 데이터 수신 + 정규화 + flyer_pos_sales UPSERT.
 *
 * - receipt_no + product_code + sold_at UNIQUE 기준 중복 방지
 * - 매칭된 회원의 구매 통계 자동 업데이트
 * - 카탈로그 자동 등록 (신상품 감지)
 */
export declare function ingestSales(companyId: string, agentId: string, items: PosSaleItem[]): Promise<IngestResult>;
/**
 * ★ 재고 스냅샷 수신 + 재고부족/유통기한 자동 감지.
 */
export declare function ingestInventory(companyId: string, agentId: string, items: PosInventoryItem[]): Promise<IngestResult>;
/**
 * ★ 회원 수신 → flyer_customers UPSERT (phone 기준).
 *
 * - 전화번호 정규화 후 매칭
 * - pos_member_id 연결
 * - 마스킹된 번호 자동 스킵 + 경고
 */
export declare function ingestMembers(companyId: string, agentId: string, members: PosMember[]): Promise<IngestResult>;
/**
 * Agent 하트비트 업데이트.
 */
export declare function updateAgentHeartbeat(agentId: string, lastSyncAt: string, pendingCount: number, errorCount24h: number): Promise<void>;
/**
 * ★ POS 판매 데이터 기반 인기 상품 TOP N 추천.
 * 최근 period일간 판매 수량 기준 정렬.
 */
export declare function getTopSellingProducts(companyId: string, limit?: number, period?: number): Promise<Array<{
    product_name: string;
    product_code: string;
    category: string | null;
    total_qty: number;
    total_amount: number;
    avg_price: number;
    image_url: string | null;
}>>;
/**
 * ★ POS Agent 상태 목록 (슈퍼관리자 대시보드용).
 */
export declare function getPosAgentStatusList(): Promise<Array<{
    agentId: string;
    companyId: string;
    companyName: string;
    storeName: string;
    syncStatus: string;
    lastSyncAt: string | null;
    lastHeartbeat: string | null;
    posType: string;
    dbType: string;
    errorCount: number;
}>>;
export interface PosPromotionItem {
    product_code: string;
    product_name: string;
    original_price?: number;
    promo_price: number;
    promo_type?: string;
    starts_at?: string;
    ends_at?: string;
}
export declare function ingestPromotions(companyId: string, posAgentId: string, items: PosPromotionItem[]): Promise<{
    accepted: number;
    rejected: number;
    errors: any[];
}>;
//# sourceMappingURL=flyer-pos-ingest.d.ts.map