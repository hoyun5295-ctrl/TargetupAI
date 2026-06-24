/**
 * CT-09: 스팸 테스트 큐 컨트롤타워
 *
 * 역할: 스팸필터 테스트 큐 등록 + 순차 실행의 유일한 진입점
 * 원칙: 테스트폰에 동시에 1건만 발송 → 매칭 정확도 100% 보장
 *
 * 사용처:
 *   - routes/spam-filter.ts (수동 테스트)
 *   - routes/ai.ts (AI 자동 테스트 + 재생성)
 *   - app.ts (큐 워커 시작)
 *
 * D78: 프로 요금제 자동 스팸검사 기능
 */
export interface SpamTestEnqueueParams {
    companyId: string;
    userId: string;
    callbackNumber: string;
    messageContentSms?: string;
    messageContentLms?: string;
    messageType: 'SMS' | 'LMS' | 'MMS';
    subject?: string;
    firstRecipient?: Record<string, any>;
    source: 'manual' | 'auto_ai';
    variantId?: string;
    batchId?: string;
    skipPrepaid?: boolean;
}
export interface SpamTestEnqueueResult {
    ok: boolean;
    testId?: string;
    error?: string;
    errorCode?: string;
    insufficientBalance?: boolean;
    balance?: number;
    requiredAmount?: number;
}
export interface SpamTestBatchResult {
    batchId: string;
    completed: boolean;
    variants: Array<{
        variantId: string;
        testId: string;
        status: string;
        overallResult: 'pass' | 'blocked' | 'failed' | 'timeout' | 'pending';
        carrierResults: Array<{
            carrier: string;
            messageType: string;
            result: string | null;
        }>;
    }>;
}
export interface AutoSpamTestVariant {
    variantId: string;
    messageText: string;
    subject?: string;
}
export interface AutoSpamTestResult {
    batchId: string;
    variants: Array<{
        variantId: string;
        messageText: string;
        subject?: string;
        spamResult: 'pass' | 'blocked' | 'failed' | 'timeout';
        carrierResults: Array<{
            carrier: string;
            messageType: string;
            result: string;
        }>;
        regenerated: boolean;
        regenerateCount: number;
    }>;
    totalTestCount: number;
    totalRegenerateCount: number;
}
export declare function normalizeContent(s: string): string;
export declare function computeMessageHash(content: string): string;
export declare function enqueueSpamTest(params: SpamTestEnqueueParams): Promise<SpamTestEnqueueResult>;
export declare function processSpamTestQueue(): Promise<void>;
export declare function getSpamTestBatchResults(batchId: string): Promise<SpamTestBatchResult>;
export declare function autoSpamTestWithRegenerate(params: {
    companyId: string;
    userId: string;
    callbackNumber: string;
    messageType: 'SMS' | 'LMS' | 'MMS';
    subject?: string;
    variants: AutoSpamTestVariant[];
    isAd: boolean;
    rejectNumber?: string;
    firstRecipient?: Record<string, any>;
    regenerateCallback?: (blockedVariantId: string) => Promise<{
        messageText: string;
        subject?: string;
    } | null>;
    maxRetries?: number;
}): Promise<AutoSpamTestResult>;
export declare function startSpamTestQueueWorker(): void;
export declare function stopSpamTestQueueWorker(): void;
//# sourceMappingURL=spam-test-queue.d.ts.map