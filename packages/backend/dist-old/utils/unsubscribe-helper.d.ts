/**
 * unsubscribe-helper.ts — 수신거부 관리 컨트롤타워 (CT-03)
 *
 * 수신거부 필터 SQL 패턴이 campaigns.ts, customers.ts, ai.ts, upload.ts 등
 * 10곳 이상에 산재. 이 파일에서 한 곳으로 관리하여 누락/불일치 방지.
 *
 * 또한 opt-in 동기화 로직(단건/벌크)도 여기서 제공하여 재사용 가능하게 함.
 */
/**
 * NOT EXISTS 수신거부 필터 SQL 생성.
 * ★ B17-01: user_id 기준으로 통일 (080 자동연동과 일관성 유지 — 사용자별 수신거부)
 *
 * @param userIdRef - user_id 참조 (예: '$2', '$${paramIdx}')
 * @param phoneRef - phone 참조 (예: 'c.phone', 'customers.phone', 'customers_unified.phone')
 * @returns SQL 문자열 (AND NOT EXISTS ...)
 *
 * @example
 * const unsub = buildUnsubscribeFilter('$2', 'c.phone');
 * // → " AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $2 AND u.phone = c.phone)"
 */
export declare function buildUnsubscribeFilter(userIdRef: string, phoneRef: string): string;
/**
 * EXISTS 수신거부 체크 SQL 생성 (수신거부 된 것만 조회할 때).
 * ★ B17-01: user_id 기준으로 통일
 *
 * @param userIdRef - user_id 참조
 * @param phoneRef - phone 참조
 * @returns SQL 문자열 (AND EXISTS ...)
 */
export declare function buildUnsubscribeExistsFilter(userIdRef: string, phoneRef: string): string;
/**
 * CASE WHEN 수신거부 상태 컬럼 SQL 생성 (고객 목록 등에서 사용).
 * ★ B17-01: user_id 기준으로 통일
 *
 * @param userIdRef - user_id 참조
 * @param phoneRef - phone 참조
 * @param alias - 결과 컬럼 alias (기본: 'is_unsubscribed')
 * @returns SQL 문자열 (CASE WHEN EXISTS ...)
 */
export declare function buildUnsubscribeCase(userIdRef: string, phoneRef: string, alias?: string): string;
/**
 * 수신거부/수신동의 시 customers 테이블의 sms_opt_in 동기화.
 *
 * @param companyId - 회사 ID
 * @param phones - 전화번호 배열
 * @param optIn - true면 수신동의(sms_opt_in=true), false면 수신거부(sms_opt_in=false)
 */
export declare function syncCustomerOptIn(companyId: string, phones: string[], optIn: boolean): Promise<void>;
/**
 * 수신거부 등록 — 유일한 쓰기 진입점 (CT-03)
 *
 * - 브랜드 사용자 → 본인 user_id로 등록
 * - 고객사관리자(admin) → 고객의 store_code 기준으로 올바른 브랜드 사용자에게 자동 배정
 *   (예: 한 고객이 특정 브랜드 소속이면 → 해당 브랜드 user_id로 등록)
 *   매칭되는 브랜드 사용자가 없으면 등록 스킵 (admin user_id로 잘못 등록하지 않음)
 *
 * @param companyId  회사 ID
 * @param userId     로그인한 사용자 ID
 * @param userType   'company_admin' | 'company_user'
 * @param phone      전화번호 (정규화된)
 * @param source     등록 경로 ('manual', 'upload', 'db_upload' 등)
 * @returns 실제 INSERT된 건수
 */
/**
 * ★ D136 (2026-04-22) 신설: 회사 전체 sms_opt_in=false 고객 → company_user 자동 배정 (bulk).
 *
 * 배경:
 *   sync.ts(동기화)와 upload.ts(업로드) 2곳에 동일 패턴 `c.store_code = ANY(u.store_codes)`가
 *   인라인으로 중복. getStoreScope(CT-02) 4단계 판정을 반영하지 못해 유령 배정 버그 발생.
 *
 * 판정 (getStoreScope와 동일):
 *   - no_filter-1: 회사 customer_stores 체계 없음           → 전체 user에게 전체 고객 배정
 *   - no_filter-2: store_codes 배정됐으나 실존 매칭 0       → 유령 배정, 전체 고객 배정
 *   - filtered   : customer_stores 실존 매칭 + store_code   → 해당 user에게 해당 store 고객만
 *   - blocked    : store_codes 미배정 + 체계 있음            → 스킵 (INSERT 없음)
 *
 * @param companyId  회사 ID
 * @param source     등록 경로 ('sync', 'db_upload' 등)
 * @returns 실제 INSERT된 총 건수
 */
export declare function registerBulkCompanyUserUnsubscribes(companyId: string, source: string): Promise<number>;
export declare function registerUnsubscribe(companyId: string, userId: string, userType: string, phone: string, source: string): Promise<number>;
/**
 * 특정 전화번호가 수신거부 상태인지 확인.
 * ★ B17-01: user_id 기준으로 통일
 *
 * @param userId - 사용자 ID
 * @param phone - 전화번호
 * @returns true면 수신거부 상태
 */
export declare function isUnsubscribed(userId: string, phone: string): Promise<boolean>;
/**
 * 여러 전화번호 중 수신거부 상태인 번호들만 추출.
 * ★ B17-01: user_id 기준으로 통일
 *
 * @param userId - 사용자 ID
 * @param phones - 전화번호 배열
 * @returns 수신거부된 전화번호 배열
 */
export declare function getUnsubscribedPhones(userId: string, phones: string[]): Promise<string[]>;
/**
 * 080번호로 사용자 매칭 (나래인터넷 콜백에서 사용).
 * users.opt_out_080_number 우선 매칭 → 없으면 companies.opt_out_080_number fallback.
 *
 * @param opt080Number - 나래인터넷에서 전달한 080번호 (숫자만)
 * @returns 매칭된 사용자/회사 정보 배열 (여러 사용자가 같은 080번호를 쓸 수 있음)
 */
export declare function findUserBy080Number(opt080Number: string): Promise<{
    userId: string;
    companyId: string;
    companyName: string;
    source: 'user' | 'company';
}[]>;
/**
 * 080 콜백 처리: 수신거부 등록 + 고객 sms_opt_in 동기화.
 *
 * @param phone - 수신거부 전화번호 (숫자만)
 * @param opt080Number - 나래인터넷 080번호 (숫자만)
 * @returns 등록 결과
 */
export declare function process080Callback(phone: string, opt080Number: string): Promise<{
    success: boolean;
    insertedCount: number;
    companyName: string;
}>;
/**
 * 사용자별 수신거부 목록 조회 (슈퍼관리자용).
 */
export declare function getUserUnsubscribes(userId: string, options?: {
    page?: number;
    limit?: number;
    search?: string;
    companyId?: string;
    userType?: string;
}): Promise<{
    data: any[];
    total: number;
}>;
/**
 * 사용자별 수신거부 일괄삭제.
 *
 * @param userId - 사용자 ID
 * @param phones - 삭제할 번호 배열 (비어있으면 전체 삭제)
 * @returns 삭제된 건수
 */
export declare function deleteUserUnsubscribes(userId: string, phones?: string[]): Promise<number>;
/**
 * 사용자별 수신거부 전체 목록 (CSV 다운로드용).
 */
export declare function exportUserUnsubscribes(userId: string): Promise<{
    phone: string;
    source: string;
    created_at: string;
}[]>;
/**
 * 캠페인 SELECT 절에 추가할 opt_out_080_number 표현식.
 * 주의: 끝 콤마/공백 없음 — 호출부에서 콤마와 함께 삽입.
 */
export declare const CAMPAIGN_OPT080_SELECT_EXPR = "COALESCE(\n  CASE WHEN opt_user.opt_out_auto_sync = true THEN opt_user.opt_out_080_number END,\n  opt_co.opt_out_080_number\n) AS opt_out_080_number";
/**
 * 캠페인 FROM 절 뒤에 추가할 LEFT JOIN — alias/컬럼 가변 빌더.
 *
 * @param campaignAlias - 메인 캠페인 테이블 alias (기본 'c')
 * @param userIdColumn - 발송 주체 사용자 ID 컬럼 (기본 'created_by', 자동발송은 'user_id')
 *
 * @example 일반 캠페인:
 *   buildCampaignOpt080LeftJoin() → "LEFT JOIN users opt_user ON opt_user.id = c.created_by ..."
 * @example 자동발송:
 *   buildCampaignOpt080LeftJoin('ac', 'user_id') → "LEFT JOIN users opt_user ON opt_user.id = ac.user_id ..."
 */
export declare function buildCampaignOpt080LeftJoin(campaignAlias?: string, userIdColumn?: string): string;
/**
 * 일반 캠페인용 기본 LEFT JOIN 상수 (alias 'c' + created_by).
 * 6곳의 발송 결과/캘린더/슈퍼관리자/대시보드 SELECT에서 사용.
 */
export declare const CAMPAIGN_OPT080_LEFT_JOIN: string;
//# sourceMappingURL=unsubscribe-helper.d.ts.map