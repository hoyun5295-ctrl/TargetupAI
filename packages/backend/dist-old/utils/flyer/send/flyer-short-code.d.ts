/**
 * ★ CT-F18 — 수신자별 단축URL 벌크 생성
 *
 * Phase 1: 수신자별 추적 URL 시스템
 * - 5자리 base62 코드 생성 (62^5 = 약 9.1억 조합)
 * - 벌크 INSERT (배치 5000건 단위)
 * - 발송 시 SMS 메시지에 개인별 URL 삽입
 *
 * 설계: dm-builder.ts generateShortCode() 패턴 재활용
 * 참조: flyer-sms-queue.ts bulkInsertSmsQueue() 배치 패턴
 */
/**
 * 도메인 조회 (환경변수 우선)
 * hjl.kr 등록 후 .env에 SHORT_URL_DOMAIN=hjl.kr 설정
 */
export declare function getShortUrlDomain(): string;
export declare function generateShortCode(length?: number): string;
export interface RecipientCode {
    phone: string;
    code: string;
    url: string;
}
export declare function bulkInsertTrackingUrls(flyerId: string, companyId: string, campaignId: string, recipients: RecipientCode[]): Promise<void>;
export declare function generateTrackingUrls(flyerId: string, companyId: string, campaignId: string, phones: string[]): Promise<Map<string, string>>;
export interface TrackingStats {
    totalSent: number;
    totalClicked: number;
    clickRate: number;
    clickedList: {
        phone: string;
        clickedAt: string;
        clickCount: number;
    }[];
    notClickedList: {
        phone: string;
    }[];
}
export declare function getTrackingStats(flyerId: string, campaignId?: string): Promise<TrackingStats>;
//# sourceMappingURL=flyer-short-code.d.ts.map