/**
 * ★ CT-F15 — 전단AI QR 쿠폰 컨트롤타워
 *
 * 쿠폰 캠페인 CRUD + QR 생성 + 수령(claim) + 사용(redeem) + 통계
 *
 * 설계: FLYER-QR-COUPON-DESIGN.md
 * 의존: CT-F08(sendFlyerCampaign), CT-F03(billing), CT-F01(sms-queue)
 */
export interface CreateCouponCampaignParams {
    companyId: string;
    createdBy: string;
    flyerId?: string;
    campaignId?: string;
    couponName: string;
    couponType: 'fixed' | 'percent' | 'free_item';
    discountValue: number;
    discountDescription?: string;
    minPurchase?: number;
    maxIssues?: number;
    expiresAt?: string;
}
export interface CouponCampaign {
    id: string;
    company_id: string;
    coupon_name: string;
    coupon_type: string;
    discount_value: number;
    discount_description: string | null;
    min_purchase: number;
    qr_code: string;
    qr_url: string;
    qr_data_url: string;
    max_issues: number | null;
    issued_count: number;
    redeemed_count: number;
    expires_at: string | null;
    status: string;
    created_at: string;
}
export interface ClaimResult {
    ok: boolean;
    couponCode?: string;
    expiresAt?: string;
    error?: string;
}
export interface RedeemResult {
    ok: boolean;
    discount?: string;
    customerPhone?: string;
    customerName?: string;
    error?: string;
}
export interface CouponStats {
    issuedCount: number;
    redeemedCount: number;
    conversionRate: number;
    totalDiscountAmount: number;
    avgPurchaseAmount: number | null;
    scanCount: number;
}
/** QR 코드 6자리 영숫자 생성 (중복 방지 최대 5회 재시도) */
export declare function generateQrCode(): Promise<string>;
/** 개인 쿠폰 코드 4자리 생성 (중복 방지) */
export declare function generateCouponCode(): Promise<string>;
/** QR 코드 Data URL 이미지 생성 */
export declare function generateQrDataUrl(qrCode: string): Promise<string>;
/** 쿠폰 캠페인 생성 */
export declare function createCouponCampaign(params: CreateCouponCampaignParams): Promise<CouponCampaign>;
/** 쿠폰 캠페인 목록 조회 */
export declare function listCouponCampaigns(companyId: string): Promise<CouponCampaign[]>;
/** 쿠폰 캠페인 상세 조회 */
export declare function getCouponCampaign(id: string, companyId: string): Promise<CouponCampaign | null>;
/** 쿠폰 캠페인 수정 */
export declare function updateCouponCampaign(id: string, companyId: string, updates: Partial<Pick<CreateCouponCampaignParams, 'couponName' | 'discountValue' | 'discountDescription' | 'minPurchase' | 'maxIssues' | 'expiresAt'>>): Promise<CouponCampaign | null>;
/** 쿠폰 캠페인 비활성화 */
export declare function disableCouponCampaign(id: string, companyId: string): Promise<boolean>;
/** QR 코드로 캠페인 조회 (공개) */
export declare function getCampaignByQrCode(qrCode: string): Promise<CouponCampaign | null>;
/** 쿠폰 수령 처리 */
export declare function claimCoupon(qrCode: string, phone: string, name?: string): Promise<ClaimResult>;
/** 쿠폰 코드로 사용 처리 */
export declare function redeemCoupon(couponCode: string, companyId: string, redeemedBy: string, purchaseAmount?: number): Promise<RedeemResult>;
/** 전화번호로 미사용 쿠폰 조회 */
export declare function lookupCouponsByPhone(phone: string, companyId: string): Promise<any[]>;
/** 쿠폰 캠페인 통계 */
export declare function getCouponStats(campaignId: string, companyId: string): Promise<CouponStats | null>;
/** 캠페인의 발급된 쿠폰 목록 */
export declare function listCoupons(campaignId: string, companyId: string): Promise<any[]>;
/** QR 쿠폰 공개 페이지 HTML */
export declare function renderCouponPage(campaign: any): string;
export interface CouponDashboardData {
    summary: {
        totalCampaigns: number;
        totalIssued: number;
        totalRedeemed: number;
        conversionRate: number;
    };
    trend: Array<{
        date: string;
        issued: number;
        redeemed: number;
    }>;
    campaigns: Array<{
        id: string;
        coupon_name: string;
        coupon_type: string;
        discount_value: number;
        issued_count: number;
        redeemed_count: number;
        conversion_rate: number;
        created_at: string;
    }>;
}
export declare function getCouponDashboard(companyId: string): Promise<CouponDashboardData>;
/** 쿠폰 수령 완료 SMS 메시지 생성 */
export declare function buildCouponSmsMessage(storeName: string, couponCode: string, discountDesc: string, expiresAt?: string): string;
//# sourceMappingURL=flyer-coupons.d.ts.map