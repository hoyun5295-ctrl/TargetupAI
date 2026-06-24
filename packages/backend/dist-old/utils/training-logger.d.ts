/**
 * training-logger.ts
 * ============================================================
 * AI 학습용 비식별 데이터 수집 유틸리티
 * ============================================================
 * 목적: 캠페인 발송 데이터를 비식별화하여 ai_training_logs 테이블에 적재
 *       → 향후 인비토AI (메시징 특화 모델) 학습 데이터셋으로 활용
 *
 * 원칙:
 *   - 적재 실패해도 발송 플로우에 영향 없음 (try-catch 격리)
 *   - 고객사/수신자 역추적 불가 (HMAC 해시 + 텍스트 마스킹)
 *   - deterministic 메타는 코드로 계산, 애매한 분류만 model label
 *
 * 설계: Claude + GPT + Gemini 3자 토론 → Harold 최종 확정 (2026-02-19)
 * ============================================================
 */
export declare const TRAINING_VERSIONS: {
    prompt: string;
    persona: string;
    policy: string;
    redaction: string;
};
interface CandidateFeatures {
    emoji_count: number;
    sentence_count: number;
    char_length: number;
    has_link: boolean;
    has_phone_cta: boolean;
    cta_type: 'link' | 'phone' | 'visit' | 'none';
    first_sentence_pattern?: string;
}
interface GuardrailActions {
    status: 'passed' | 'modified' | 'blocked';
    actions: string[];
    flags: string[];
}
interface TrainingLogParams {
    campaignRunId: string;
    companyId: string;
    industryCode?: string;
    brandTone?: string;
    companyName?: string;
    userPrompt?: string;
    targetFilter?: Record<string, any>;
    targetCount?: number;
    segmentKey?: string;
    messageType: 'SMS' | 'LMS' | 'MMS' | 'KAKAO';
    isAd: boolean;
    aiMessages?: string[];
    selectedIndex?: number;
    finalMessage: string;
    finalSource: 'selected_as_is' | 'edited' | 'manual';
    sendAt?: Date;
    modelId?: string;
    modelParams?: Record<string, any>;
    guardrailActions?: GuardrailActions;
}
interface TrainingMetricsParams {
    sourceRef: string;
    sentCount: number;
    successCount: number;
    failCount: number;
    spamBlocked?: number;
}
export declare function maskForTraining(text: string, companyName?: string): string;
export declare function computeMessageFeatures(text: string): CandidateFeatures;
export declare function logTrainingData(params: TrainingLogParams): Promise<void>;
export declare function updateTrainingMetrics(params: TrainingMetricsParams): Promise<void>;
export declare function getSourceRef(campaignRunId: string): string;
export {};
//# sourceMappingURL=training-logger.d.ts.map