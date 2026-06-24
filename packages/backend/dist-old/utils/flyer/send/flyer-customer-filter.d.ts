/**
 * ★ CT-F04 — 전단AI 고객 필터/쿼리 빌더
 *
 * 한줄로 utils/customer-filter.ts와 완전 분리.
 * - 테이블: flyer_customers
 * - 고정 컬럼: gender, age(birth_date 계산), grade, region, phone, sms_opt_in,
 *   last_purchase_at, total_purchase_amount, purchase_count, rfm_segment,
 *   pos_member_id, pos_grade, pos_points
 * - 기본 격리: company_id
 *
 * ⚠️ 전단AI는 한줄로 customer-filter.ts의 FIELD_MAP/커스텀필드 시스템을 사용하지 않는다.
 * 마트 업종 특화 필드(RFM/POS)만 지원.
 */
export interface FlyerFilterInput {
    gender?: 'M' | 'F';
    age_min?: number;
    age_max?: number;
    rfm_segment?: string | string[];
    last_purchase_days_min?: number;
    last_purchase_days_max?: number;
    purchase_count_min?: number;
    total_amount_min?: number;
    pos_grade?: string | string[];
    sms_opt_in?: boolean;
    search?: string;
}
export interface BuiltFilter {
    whereClause: string;
    params: any[];
}
/**
 * WHERE 절 빌더. company_id는 항상 강제 포함.
 * 반환 params의 첫 번째는 항상 companyId.
 */
export declare function buildFlyerCustomerFilter(companyId: string, filter?: FlyerFilterInput): BuiltFilter;
/**
 * 필터 결과 COUNT.
 */
export declare function countFlyerCustomers(companyId: string, filter?: FlyerFilterInput): Promise<number>;
/**
 * 필터 결과 phone + id 목록 (발송 대상 추출).
 */
export declare function selectFlyerCustomers(companyId: string, filter?: FlyerFilterInput, options?: {
    limit?: number;
    offset?: number;
    fields?: string[];
}): Promise<any[]>;
//# sourceMappingURL=flyer-customer-filter.d.ts.map