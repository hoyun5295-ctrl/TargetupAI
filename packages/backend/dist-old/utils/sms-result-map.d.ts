export type StatusType = 'success' | 'fail' | 'pending' | 'unknown';
export interface StatusCodeInfo {
    label: string;
    type: StatusType;
}
/** QTmsg status_code → 한줄로 결과 매핑 (유일한 정의) */
export declare const STATUS_CODE_MAP: Record<number, StatusCodeInfo>;
/** 성공 코드 배열 — SQL WHERE 조건 등에 사용 */
export declare const SUCCESS_CODES: readonly number[];
/** 대기 코드 배열 */
export declare const PENDING_CODES: readonly number[];
/** 성공 여부 판별 */
export declare function isSuccess(statusCode: number): boolean;
/** 실패 여부 판별 (성공도 아니고 대기도 아닌 모든 코드) */
export declare function isFail(statusCode: number): boolean;
/** 대기 여부 판별 */
export declare function isPending(statusCode: number): boolean;
/** status_code → 라벨 문자열 (매핑에 없으면 '코드 NNN') */
export declare function getStatusLabel(statusCode: number): string;
/** status_code → 타입 (매핑에 없으면 'unknown') */
export declare function getStatusType(statusCode: number): StatusType;
/** SQL용: 성공 코드 IN 절 문자열 — 예: "6, 1000, 1800" */
export declare const SUCCESS_CODES_SQL: string;
/** SQL용: 대기 코드 IN 절 문자열 — 예: "100, 104" */
export declare const PENDING_CODES_SQL: string;
/** mob_company → 표시명 (유일한 정의) */
export declare const CARRIER_MAP: Record<string, string>;
/** mob_company → 표시명 (매핑에 없으면 원본 반환) */
export declare function getCarrierLabel(mobCompany: string): string;
/** 스팸필터 result 상수 — spam-filter.ts에서 문자열 직접 사용 대신 이 상수 사용 */
export declare const SPAM_RESULT: {
    readonly PASS: "pass";
    readonly BLOCKED: "blocked";
    readonly FAILED: "failed";
    readonly TIMEOUT: "timeout";
};
export type SpamResultType = typeof SPAM_RESULT[keyof typeof SPAM_RESULT];
/** 스팸필터 result → 표시명 */
export declare const SPAM_RESULT_LABEL: Record<string, string>;
/** 스팸필터 result → 표시명 (null/undefined → '대기') */
export declare function getSpamResultLabel(result: string | null | undefined): string;
/** 스팸필터 result → CSS 타입 (프론트 배지 색상 결정용) */
export declare function getSpamResultType(result: string | null | undefined): 'pass' | 'blocked' | 'fail' | 'pending';
//# sourceMappingURL=sms-result-map.d.ts.map