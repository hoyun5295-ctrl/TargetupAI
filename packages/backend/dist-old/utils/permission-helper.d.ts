/**
 * permission-helper.ts — 권한/스코프 헬퍼 컨트롤타워 (CT-02)
 *
 * 유일한 권한 스코프 추출기. manage-stats.ts, manage-callbacks.ts,
 * manage-users.ts, manage-scheduled.ts 등 6개+ 파일에 복붙되어 있던
 * getCompanyScope + 사용자 필터 로직을 한 곳으로 통합.
 *
 * 패턴 A: getCompanyScope(req) — super_admin이면 query에서, 아니면 토큰에서 companyId 추출
 * 패턴 B: buildUserFilter(req, startIndex) — company_user는 created_by 강제, company_admin은 filter_user_id 선택적
 */
import { Request } from 'express';
/**
 * 요청자의 userType에 따라 조회 대상 회사 ID를 결정.
 *
 * - super_admin: query.companyId로 특정 회사 지정 가능. 미지정 시 null (전체).
 * - company_admin / company_user: 자사 companyId 고정.
 *
 * @returns companyId 또는 null (전체 조회)
 */
export declare function getCompanyScope(req: Request): string | null;
export interface UserFilterResult {
    sql: string;
    params: any[];
    nextIndex: number;
}
/**
 * 사용자 유형에 따라 created_by 필터를 생성.
 *
 * - company_user: 본인이 만든 것만 조회 (created_by = userId 강제)
 * - company_admin: filter_user_id가 query에 있으면 해당 사용자로 필터
 * - super_admin: 필터 없음
 *
 * @param req - Express Request (user 토큰 + query.filter_user_id)
 * @param startParamIndex - 파라미터 시작 인덱스
 * @param columnName - created_by 컬럼명 (기본: 'created_by', 필요 시 'c.created_by' 등)
 * @returns {sql, params, nextIndex}
 */
export declare function buildUserFilter(req: Request, startParamIndex: number, columnName?: string): UserFilterResult;
/** 관리자 이상 권한인지 확인 (company_admin 또는 super_admin) */
export declare function isAdmin(req: Request): boolean;
/** 슈퍼관리자인지 확인 */
export declare function isSuperAdmin(req: Request): boolean;
/** 요청자의 userId 추출 */
export declare function getUserId(req: Request): string;
/** 요청자의 companyId 추출 (super_admin은 null 가능) */
export declare function getCompanyId(req: Request): string | undefined;
/** 요청자의 userType 추출 */
export declare function getUserType(req: Request): 'super_admin' | 'company_admin' | 'company_user';
//# sourceMappingURL=permission-helper.d.ts.map