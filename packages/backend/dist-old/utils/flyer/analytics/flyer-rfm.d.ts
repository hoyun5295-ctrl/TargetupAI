/**
 * ★ CT-F10 — 전단AI RFM 세분화 컨트롤타워
 *
 * Phase B 기능 9번: POS 판매 데이터 기반 RFM 자동 세분화.
 * flyer_pos_sales → flyer_customers.rfm_segment 업데이트.
 *
 * ⚠️ 스켈레톤 — Phase B 구현 시 채운다. 지금은 인터페이스만 정의.
 */
export type RfmSegment = 'champion' | 'loyal' | 'new' | 'at_risk' | 'lost' | 'whale' | 'unknown';
export interface RfmResult {
    customerId: string;
    recencyDays: number;
    frequency: number;
    monetary: number;
    segment: RfmSegment;
}
/**
 * 단일 고객의 RFM 점수 계산.
 * flyer_pos_sales 최근 90일 기준.
 */
export declare function calculateCustomerRfm(companyId: string, customerId: string): Promise<RfmResult | null>;
/**
 * 회사 전체 고객 RFM 일괄 재계산 (배치).
 * POS Agent가 데이터 싱크할 때 호출.
 */
export declare function recalculateAllRfm(companyId: string): Promise<number>;
/**
 * RFM 세그먼트별 고객 수 집계 (대시보드 위젯).
 */
export declare function getRfmSegmentCounts(companyId: string): Promise<Record<RfmSegment, number>>;
//# sourceMappingURL=flyer-rfm.d.ts.map