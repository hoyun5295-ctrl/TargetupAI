/**
 * customer-filter.ts — 고객 필터/쿼리 빌더 컨트롤타워 (CT-01)
 *
 * 유일한 필터 WHERE 절 생성기. campaigns.ts, customers.ts, ai.ts 3곳의
 * 중복 필터 빌더를 이 파일 하나로 통합.
 *
 * 설계 원칙:
 * - 기존 3곳이 생성하던 SQL과 100% 동일한 결과를 생성
 * - tableAlias 옵션으로 'c.' 접두사 유무 제어 (campaigns.ts용)
 * - store_code는 호출부마다 다르므로 "호출부 위임" (skipStoreCode 옵션)
 * - 입력 형식: scalar 값과 {operator, value} 객체 모두 지원
 * - 나이 계산: KST 기준으로 통일 (campaigns.ts 방식)
 * - days_within: parameterized query로 SQL injection 방지
 * - 커스텀 필드: 8개 연산자 전부 지원 (customers.ts 기준)
 */
export interface FilterResult {
    sql: string;
    params: any[];
    nextIndex: number;
}
export interface FilterOptions {
    /** 테이블 alias 접두사. campaigns.ts는 'c', 나머지는 '' */
    tableAlias?: string;
    /** 파라미터 시작 인덱스 ($1, $2, ...) */
    startParamIndex: number;
    /**
     * store_code 처리 방식:
     * - 'skip': 호출부에서 직접 처리 (기본값)
     * - 'direct': WHERE store_code = $X (campaigns.ts 방식)
     * - 'subquery': WHERE id IN (SELECT ... FROM customer_stores) (customers.ts 방식, companyIdParamRef 필요)
     */
    storeCodeMode?: 'skip' | 'direct' | 'subquery';
    /** subquery 모드에서 company_id 파라미터 참조 (예: '$1') */
    companyIdParamRef?: string;
    /**
     * 입력 형식:
     * - 'mixed': scalar + {value, operator} 혼합 지원 (campaigns.ts, ai.ts 방식)
     * - 'structured': 항상 {operator, value} 형식 (customers.ts 방식)
     */
    inputFormat?: 'mixed' | 'structured';
}
/**
 * 필터 객체를 SQL WHERE 절 (AND ...) 문자열로 변환.
 *
 * @param filters - 필터 객체 (프론트엔드 또는 AI에서 전달)
 * @param options - 필터 빌드 옵션
 * @returns {sql, params, nextIndex}
 */
export declare function buildCustomerFilter(filters: any, options: FilterOptions): FilterResult;
/**
 * campaigns.ts 호환 래퍼.
 * 기존 시그니처: buildFilterQuery(filter, companyId) → {where, params}
 * 통합 시그니처: buildCustomerFilter(filter, options) → {sql, params, nextIndex}
 *
 * ★ 기존과 동일한 SQL 생성을 보장하되, nextIndex도 리턴하여 체이닝 가능.
 * ★ store_code는 'direct' 모드 + alias 'c' 사용.
 */
export declare function buildFilterQueryCompat(filter: any, _companyId: string): {
    where: string;
    params: any[];
    nextIndex: number;
};
/**
 * customers.ts 호환 래퍼.
 * 기존 시그니처: buildDynamicFilter(filters, startIndex) → {where, params, nextIndex}
 * ★ store_code는 'subquery' 모드.
 */
export declare function buildDynamicFilterCompat(filters: any, startIndex: number): {
    where: string;
    params: any[];
    nextIndex: number;
};
/**
 * ai.ts 호환 래퍼.
 * 기존 시그니처: buildFilterWhereClause(filters, startParamIndex) → {sql, params, nextIndex}
 * ★ ai.ts 원본은 gender를 사전 정규화(남→M, 여→F)한 후 buildGenderFilter에 넘김.
 *   campaigns.ts는 raw 그대로 넘기므로, 여기서 사전 정규화를 적용.
 * ★ store_code는 'skip' (ai.ts에서는 store_code 미사용).
 */
export declare function buildFilterWhereClauseCompat(filters: any, startParamIndex: number): FilterResult;
//# sourceMappingURL=customer-filter.d.ts.map