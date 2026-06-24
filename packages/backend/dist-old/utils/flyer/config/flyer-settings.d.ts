/**
 * ★ 전단AI 매장/회사 설정 컨트롤타워
 *
 * 데이터 자동 파기, 알림 설정 등 회사/캠페인 단위 설정 관리.
 * 라우트에서 인라인 query 금지 — 이 CT를 통해야 한다.
 */
/**
 * 회사 전체 자동 파기 설정 조회
 */
export declare function getAutoPurgeSettings(companyId: string): Promise<{
    auto_purge_days: number;
}>;
/**
 * 회사 전체 자동 파기 설정 변경
 */
export declare function updateAutoPurgeSettings(companyId: string, days: number): Promise<void>;
/**
 * 캠페인별 자동 파기 설정
 */
export declare function setCampaignAutoPurge(campaignId: string, companyId: string, days: number): Promise<void>;
//# sourceMappingURL=flyer-settings.d.ts.map