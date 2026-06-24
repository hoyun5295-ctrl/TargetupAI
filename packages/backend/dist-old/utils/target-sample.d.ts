/**
 * target-sample.ts — 타겟 첫 고객 조회 컨트롤타워 (CT-A, B5/B6 통합)
 *
 * 자동발송/캠페인 미리보기/스팸테스트에서 "타겟 필터에 매칭되는 첫 고객 1명"을
 * 가져오는 인라인 SELECT가 4곳 이상 산재해 있어서 일관성을 잃고 있었음.
 *
 * 이 컨트롤타워가 단일 진입점이 되어, 다음 5가지를 모두 보장한다:
 *   1) CT-01 buildFilterQueryCompat 로 타겟 필터 적용 (birth_month/숫자/날짜 등 동적)
 *   2) is_active = true AND sms_opt_in = true 기본 필터
 *   3) ★ store_code 격리 (자동발송 ac.store_code 또는 캠페인 store_code)
 *   4) ★ CT-03 buildUnsubscribeFilter 로 사용자별 수신거부 제외
 *   5) custom_fields JSONB flat 처리 — replaceMessageVars/replaceVariables 양쪽 호환
 *
 * 사용처:
 *   - utils/auto-campaign-worker.ts (runMessageGeneration, executePreSendSpamTest)
 *   - routes/auto-campaigns.ts (POST /preview-sample — 자동발송 모달 스팸필터 직전)
 *   - routes/ai.ts (recommend-target sample_customer_raw 생성)
 *
 * ⚠️ 절대 금지:
 *   - "SELECT * FROM customers ... ORDER BY updated_at DESC LIMIT 1" 인라인 작성 금지
 *   - 반드시 이 함수를 통할 것 (D88/D91/B5 재발 방지)
 */
export interface TargetSampleOptions {
    /** 회사 ID — 필수 */
    companyId: string;
    /** 타겟 필터 (mixed 형식, AI/캠페인용) — 비어있으면 전체 타겟에서 추출 */
    targetFilter?: any;
    /** 발송 주체 사용자 ID — 수신거부 필터 적용 (없으면 수신거부 필터 스킵) */
    userId?: string | null;
    /** 매장 코드 — 자동발송 ac.store_code (브랜드 격리) */
    storeCode?: string | null;
}
export interface TargetSampleResult {
    /** column 키 raw + custom_fields flat (replaceVariables 호환) */
    raw: Record<string, any> | null;
    /** 매칭 여부 — false면 raw=null */
    matched: boolean;
}
/**
 * 타겟 필터에 매칭되는 첫 고객 1명을 조회한다.
 *
 * 정렬: ORDER BY updated_at DESC NULLS LAST LIMIT 1
 *   - 가장 최근 활동 고객 우선 (대표성 + 데이터 신선도)
 *
 * 반환:
 *   - matched=true 시 raw 객체 (column + custom_fields flat)
 *   - 매칭 0건이면 matched=false, raw=null
 */
export declare function fetchTargetSampleCustomer(options: TargetSampleOptions): Promise<TargetSampleResult>;
//# sourceMappingURL=target-sample.d.ts.map