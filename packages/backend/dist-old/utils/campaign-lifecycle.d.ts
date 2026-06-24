export interface CancelCampaignResult {
    success: boolean;
    error?: string;
    tooLate?: boolean;
    cancelledCount: number;
    refundedAmount: number;
}
/**
 * 캠페인 예약 취소 — MySQL 큐 삭제 + PG 상태 변경 + 선불 환불
 * campaigns.ts와 manage-scheduled.ts 모두 이 함수를 호출한다.
 *
 * @param campaignId - 캠페인 ID
 * @param companyId - 회사 ID
 * @param options.reason - 취소 사유 (optional)
 * @param options.cancelledBy - 취소자 ID (optional)
 * @param options.cancelledByType - 취소자 유형 (optional: 'super_admin' | 'company_admin' | 'company_user')
 * @param options.skipTimeCheck - 15분 이내 체크 스킵 여부 (관리자용)
 */
export declare function cancelCampaign(campaignId: string, companyId: string, options?: {
    reason?: string;
    cancelledBy?: string;
    cancelledByType?: string;
    skipTimeCheck?: boolean;
}): Promise<CancelCampaignResult>;
export interface SyncResultsOutput {
    syncCount: number;
}
/**
 * MySQL 발송 결과를 PostgreSQL로 동기화
 * campaign_runs(AI 발송) + direct campaigns(직접 발송) 모두 처리
 *
 * @param companyId - 회사 ID (해당 회사의 최근 7일 캠페인만 동기화)
 */
export declare function syncCampaignResults(companyId: string): Promise<SyncResultsOutput>;
//# sourceMappingURL=campaign-lifecycle.d.ts.map