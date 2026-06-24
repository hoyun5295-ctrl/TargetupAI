import { getColumnFields } from '../utils/standard-field-map';
export declare function callAIWithFallback(params: {
    system: string;
    userMessage: string;
    maxTokens: number;
    temperature: number;
}): Promise<string>;
export interface VarCatalogEntry {
    column: string;
    type: 'string' | 'number' | 'date';
    description: string;
    sample: string | number;
    values?: string[];
    /** 저장 방식: 'column'=직접 컬럼(SQL SELECT 가능), 'custom_fields'=JSONB 내부 키(SQL SELECT 불가) */
    storageType?: 'column' | 'custom_fields';
}
interface MessageVariant {
    variant_id: string;
    variant_name: string;
    concept: string;
    sms_text: string;
    lms_text: string;
    kakao_text?: string;
    score: number;
}
interface AIRecommendResult {
    variants: MessageVariant[];
    recommendation: string;
    recommendation_reason: string;
}
interface TargetInfo {
    total_count: number;
    gender_ratio?: {
        male: number;
        female: number;
    };
    age_groups?: {
        [key: string]: number;
    };
    avg_purchase_count?: number;
    avg_total_spent?: number;
}
/**
 * 메시지 내 개인화 변수 검증
 * - 메시지에서 %...% 패턴을 추출하여 available_vars에 없는 것이 있으면 invalid 반환
 * - 발송 전 반드시 호출하여 잘못된 변수가 고객에게 노출되는 것을 방지
 */
export declare function validatePersonalizationVars(message: string, availableVars: string[]): {
    valid: boolean;
    invalidVars: string[];
};
/**
 * customer_schema에서 field_mappings, available_vars 추출
 * - customer_schema에 있으면 그대로 사용
 * - 없으면 FIELD_MAP(standard-field-map.ts) 기반 동적 생성
 *
 * ★ D111 P2: 최종 반환 전 FIELD_MAP.aliases 자동 보강
 *   → isoi 사례처럼 customer_schema.field_mappings가 있든 없든 `%이름%`, `%전화번호%` 등 한글 동의어 자동 지원.
 *   → 이미 등록된 키는 덮어쓰지 않으므로 customer_schema 우선순위 유지.
 */
export declare function extractVarCatalog(customerSchema: any): {
    fieldMappings: Record<string, VarCatalogEntry>;
    availableVars: string[];
};
/**
 * ★ D121: 실제 데이터가 있는 필드만 남기도록 varCatalog/availableVars 필터링
 * enabled-fields와 동일한 COUNT FILTER 패턴 — 데이터 없는 필드를 AI가 사용하면 빈 공간 발생
 * routes/ai.ts(generate-messages) + auto-campaign-worker.ts 양쪽에서 호출하는 컨트롤타워
 */
export declare function filterVarCatalogByData(varCatalog: Record<string, VarCatalogEntry>, availableVars: string[], companyId: string): Promise<void>;
export declare function generateMessages(prompt: string, targetInfo: TargetInfo, extraContext?: {
    productName?: string;
    discountRate?: number;
    eventName?: string;
    brandName?: string;
    brandSlogan?: string;
    brandDescription?: string;
    brandTone?: string;
    channel?: string;
    isAd?: boolean;
    rejectNumber?: string;
    usePersonalization?: boolean;
    personalizationVars?: string[];
    availableVarsCatalog?: Record<string, VarCatalogEntry>;
    availableVars?: string[];
    recentMessages?: string[];
}): Promise<AIRecommendResult>;
interface ActiveFieldsResult {
    activeColumnFields: ReturnType<typeof getColumnFields>;
    customFieldLabels: Record<string, string>;
    distinctValues: Record<string, string[]>;
}
/**
 * 고객사별 데이터 있는 필드 + 커스텀 필드 라벨 + DISTINCT 값 일괄 조회.
 * recommendTarget, parseBriefing 등 AI 프롬프트 생성 시 공통 사용.
 */
export declare function detectActiveFields(companyId: string): Promise<ActiveFieldsResult>;
/**
 * AI 프롬프트용 "사용 가능한 필터 필드" 섹션 생성.
 * detectActiveFields() 결과를 받아 프롬프트 텍스트로 변환.
 */
export declare function buildFilterFieldsPrompt(fields: ActiveFieldsResult): string;
export declare function recommendTarget(companyId: string, objective: string, customerStats: any, companyInfo?: {
    business_type?: string;
    reject_number?: string;
    brand_name?: string;
    company_name?: string;
    customer_schema?: any;
    has_kakao_profile?: boolean;
}): Promise<{
    filters: any;
    reasoning: string;
    estimated_count: number;
    recommended_channel: string;
    channel_reason: string;
    is_ad: boolean;
    recommended_time: string;
    suggested_campaign_name: string;
    use_individual_callback: boolean;
    use_personalization: boolean;
    personalization_vars: string[];
}>;
export interface TargetCondition {
    description: string;
    gender: string;
    grade: string;
    ageRange: string;
    region: string;
    purchasePeriod: string;
    storeName: string;
    minPurchaseAmount: string;
    birthMonth: string;
    extra: string;
}
export declare function parseBriefing(briefing: string, companyId?: string): Promise<{
    promotionCard: {
        name: string;
        benefit: string;
        condition: string;
        period: string;
        target: string;
        couponCode?: string;
        extra?: string;
    };
    targetCondition: TargetCondition;
    targetFilters: Record<string, any>;
}>;
interface CustomMessageOptions {
    briefing: string;
    promotionCard: {
        name: string;
        benefit: string;
        condition: string;
        period: string;
        target: string;
        couponCode?: string;
        extra?: string;
    };
    personalFields: string[];
    fieldLabels?: Record<string, string>;
    url?: string;
    tone?: string;
    brandName: string;
    brandTone?: string;
    channel: string;
    isAd: boolean;
    rejectNumber?: string;
}
export declare function generateCustomMessages(options: CustomMessageOptions): Promise<{
    variants: Array<{
        variant_id: string;
        variant_name: string;
        concept: string;
        message_text: string;
        subject?: string;
        score: number;
    }>;
    recommendation: string;
}>;
export interface FilterCountResult {
    count: number;
    unsubscribeCount: number;
}
/**
 * 필터 조건으로 타겟 고객 수 조회 (공통 함수)
 * - CT-01 buildFilterWhereClauseCompat 활용
 * - 수신거부 필터 포함 (user_id 기준 — B17-01 준수)
 * - 에러 시 0명 반환 (전체고객 폴백 절대 방지 — D77)
 */
export declare function countFilteredCustomers(companyId: string, filters: Record<string, any>, userId: string, storeFilter?: string, baseParams?: any[]): Promise<FilterCountResult>;
export interface RelaxFiltersResult {
    filters: Record<string, any>;
    reasoning: string;
    relaxed_fields: string[];
}
/**
 * AI에게 필터 조건 완화를 요청하는 함수
 * - 원래 필터 + 0명 사유를 AI에 전달
 * - AI가 의도를 유지하면서 가장 영향 적은 필드부터 완화
 * - relaxed_fields로 어떤 필드를 완화했는지 명시
 */
export declare function relaxFilters(originalFilters: Record<string, any>, originalReasoning: string, customerStats: any, activeFieldsPrompt: string, companyInfo?: {
    business_type?: string;
    brand_name?: string;
}): Promise<RelaxFiltersResult>;
export interface CampaignRecommendation {
    recommended_target: {
        filters: Record<string, any>;
        reasoning: string;
    };
    recommended_time: string;
    recommended_channel: string;
    insights: string[];
    suggested_objective: string;
}
/**
 * 과거 캠페인 성과를 바탕으로 다음 캠페인을 추천
 * - stats-aggregation.ts의 aggregateCampaignPerformance() 결과를 입력받음
 * - AI가 성과 데이터를 분석하여 최적 타겟/시간대/채널 추천
 */
export declare function recommendNextCampaign(companyId: string, performanceData: any, customerStats: any, companyInfo?: {
    business_type?: string;
    brand_name?: string;
    company_name?: string;
}): Promise<CampaignRecommendation>;
export declare function checkAPIStatus(): {
    available: boolean;
    message: string;
    fallback: boolean;
};
export {};
//# sourceMappingURL=ai.d.ts.map