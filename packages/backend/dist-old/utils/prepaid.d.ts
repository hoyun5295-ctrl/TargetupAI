/**
 * 선불 차감
 * @param createdBy - ★ D98: 차감 실행 사용자 ID (user_id 기반 사용금액 격리용)
 */
export declare function prepaidDeduct(companyId: string, count: number, messageType: string, referenceId: string, createdBy?: string): Promise<{
    ok: boolean;
    error?: string;
    amount?: number;
    balance?: number;
    insufficientBalance?: boolean;
}>;
/** 선불 환불 (실패건 또는 취소) — 중복 환불 방지 포함 */
export declare function prepaidRefund(companyId: string, count: number, messageType: string, campaignId: string, reason: string): Promise<{
    refunded: number;
}>;
//# sourceMappingURL=prepaid.d.ts.map