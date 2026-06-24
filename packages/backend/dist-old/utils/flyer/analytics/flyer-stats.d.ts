/**
 * ★ CT-F09 — 전단AI 대시보드 통계 집계 컨트롤타워
 *
 * 한줄로 utils/stats-aggregation.ts와 완전 분리.
 * - flyer_campaigns 기반 발송 통계
 * - url_clicks 기반 클릭 추적
 * - flyer_customers 기반 고객 통계
 * - Phase B: flyer_pos_sales 기반 ROI 집계
 */
export interface FlyerDashboardStats {
    totalCustomers: number;
    totalCampaigns: number;
    totalSent: number;
    totalSuccess: number;
    totalClicks: number;
    monthlyStats: {
        month: string;
        campaigns: number;
        sent: number;
        success: number;
        clicks: number;
    }[];
}
/**
 * 전단AI 대시보드 상단 카드 + 월별 추이.
 */
export declare function getFlyerDashboardStats(companyId: string): Promise<FlyerDashboardStats>;
/**
 * 개별 캠페인 발송 결과 상세 (ResultsPage용).
 */
export declare function getFlyerCampaignResults(companyId: string, page?: number, pageSize?: number): Promise<{
    items: any[];
    total: number;
}>;
//# sourceMappingURL=flyer-stats.d.ts.map