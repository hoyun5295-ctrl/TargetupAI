/**
 * dm-ab-test.ts — DM A/B 테스트 CRUD + variant 선택 + 성과 집계
 *
 * 테이블: dm_ab_tests (D126 V2 신설)
 *         dm_views.ab_test_id / dm_views.ab_variant
 *
 * 상태:
 *   draft     — 생성만 (short_code 없음)
 *   running   — 배포 중 (short_code 발급, 방문자 분배 시작)
 *   paused    — 일시 중지
 *   completed — 종료 + 결과 집계 고정
 *
 * variant 선택:
 *   pickVariant() — 가중치 기반 랜덤 (weight_a + weight_b + weight_c 합을 분모로)
 *   뷰어에서 쿠키로 스티키 (같은 방문자는 같은 variant 유지)
 *
 * 소비처:
 *  - routes/dm.ts (A/B CRUD 라우트 + /ab/:code 뷰어)
 */
export type AbTestStatus = 'draft' | 'running' | 'paused' | 'completed';
export type AbPrimaryMetric = 'view' | 'click' | 'conversion' | 'complete_rate';
export type AbVariantKey = 'a' | 'b' | 'c';
export interface AbTestInput {
    name: string;
    description?: string;
    variant_a_page_id: string;
    variant_b_page_id: string;
    variant_c_page_id?: string | null;
    variant_a_weight?: number;
    variant_b_weight?: number;
    variant_c_weight?: number;
    primary_metric?: AbPrimaryMetric;
}
export interface AbTestRecord {
    id: string;
    company_id: string;
    created_by: string | null;
    name: string;
    description: string | null;
    short_code: string | null;
    variant_a_page_id: string;
    variant_b_page_id: string;
    variant_c_page_id: string | null;
    variant_a_weight: number;
    variant_b_weight: number;
    variant_c_weight: number;
    primary_metric: AbPrimaryMetric;
    status: AbTestStatus;
    started_at: string | null;
    ended_at: string | null;
    result_summary: Record<string, any> | null;
    created_at: string;
    updated_at: string;
}
export interface AbVariantStats {
    variant: AbVariantKey;
    page_id: string;
    views: number;
    unique_phones: number;
    avg_duration_sec: number;
    completion_rate: number;
    clicks: number;
}
export interface AbTestResult {
    test: AbTestRecord;
    variants: AbVariantStats[];
    winner: AbVariantKey | null;
    total_views: number;
}
export declare function createAbTest(companyId: string, userId: string | null, input: AbTestInput): Promise<AbTestRecord>;
export declare function getAbTest(id: string, companyId: string): Promise<AbTestRecord | null>;
export declare function getAbTestByShortCode(code: string): Promise<AbTestRecord | null>;
export declare function listAbTests(companyId: string): Promise<AbTestRecord[]>;
export declare function updateAbTest(id: string, companyId: string, patch: Partial<AbTestInput>): Promise<AbTestRecord | null>;
export declare function deleteAbTest(id: string, companyId: string): Promise<boolean>;
export declare function startAbTest(id: string, companyId: string): Promise<AbTestRecord | null>;
export declare function pauseAbTest(id: string, companyId: string): Promise<AbTestRecord | null>;
export declare function completeAbTest(id: string, companyId: string): Promise<AbTestRecord | null>;
/**
 * 가중치 기반 variant 선택.
 * @param test AbTestRecord
 * @param existingVariant 쿠키에서 전달된 기존 variant (스티키)
 */
export declare function pickVariant(test: AbTestRecord, existingVariant?: AbVariantKey): AbVariantKey;
/** variant 키 → dm_pages.id 매핑 */
export declare function variantToPageId(test: AbTestRecord, key: AbVariantKey): string | null;
/**
 * dm_views를 variant별로 GROUP BY 하여 집계.
 * 열람 추적 컬럼:
 *   - views: COUNT(*)
 *   - unique_phones: DISTINCT phone
 *   - avg_duration: AVG(duration_seconds)
 *   - completion_rate: page_reached == total_pages 비율
 *
 * click은 section_interactions JSONB에서 cta click 집계 (V2.1 확장)
 */
export declare function aggregateResults(id: string, companyId: string): Promise<AbTestResult | null>;
/**
 * A/B 테스트용 뷰 기록.
 * (기존 trackDmView는 dm_id 단위이므로 ab_test_id 컬럼도 함께 채움)
 */
export declare function trackAbTestView(abTestId: string, variant: AbVariantKey, dmPageId: string, companyId: string, phone: string | null, pageReached: number, totalPages: number, duration: number, ip: string | null, userAgent: string | null): Promise<void>;
//# sourceMappingURL=dm-ab-test.d.ts.map