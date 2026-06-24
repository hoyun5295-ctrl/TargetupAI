/**
 * ★ CT-F08 — 전단AI 발송 오케스트레이터 (발송 경로의 유일한 진입점)
 *
 * 한줄로 campaigns.ts 5경로 → CT-F08 1경로로 단순화.
 * 모든 전단AI 발송(AI/직접/자동/테스트)은 이 함수를 통해야 한다.
 *
 * 흐름:
 *   1. 발송 가능 여부 확인 (CT-F03 canFlyerCompanySend)
 *   2. 회신번호 결정 (CT-F06 resolveFlyerCallback)
 *   3. 수신자 중복제거 (CT-F07 deduplicateFlyerRecipients)
 *   4. 수신거부 제외 (CT-F02 filterOutFlyerUnsubscribed)
 *   5. 변수 치환 + (광고)+080 부착 (CT-F05 prepareFlyerSendMessage)
 *   6. MySQL 큐 bulk INSERT (CT-F01 bulkInsertSmsQueue)
 *   7. flyer_campaigns 레코드 생성/업데이트
 */
import { FlyerRecipient } from './flyer-deduplicate';
import { FlyerCustomerVars } from './flyer-message';
export type FlyerMessageType = 'SMS' | 'LMS' | 'MMS';
export type FlyerSendRecipient = FlyerRecipient & Omit<FlyerCustomerVars, 'phone'> & {
    customer_id?: string | null;
};
export interface FlyerSendParams {
    companyId: string;
    userId: string;
    messageType: FlyerMessageType;
    messageTemplate: string;
    isAd: boolean;
    requestedCallback?: string | null;
    mmsImagePaths?: string[];
    subject?: string;
    recipients: FlyerSendRecipient[];
    flyerId?: string | null;
    shortUrlId?: string | null;
    scheduleAt?: Date | null;
    skipUnsubscribeFilter?: boolean;
    skipDeduplicate?: boolean;
}
export interface FlyerSendResult {
    ok: boolean;
    campaignId?: string;
    totalRequested: number;
    deduplicated: number;
    unsubscribedRemoved: number;
    enqueued: number;
    callbackUsed: string | null;
    error?: string;
}
export declare function sendFlyerCampaign(params: FlyerSendParams): Promise<FlyerSendResult>;
//# sourceMappingURL=flyer-send.d.ts.map