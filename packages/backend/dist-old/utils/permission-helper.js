"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCompanyScope = getCompanyScope;
exports.buildUserFilter = buildUserFilter;
exports.isAdmin = isAdmin;
exports.isSuperAdmin = isSuperAdmin;
exports.getUserId = getUserId;
exports.getCompanyId = getCompanyId;
exports.getUserType = getUserType;
// ============================================================
// 패턴 A: getCompanyScope — 회사 범위 결정
// ============================================================
/**
 * 요청자의 userType에 따라 조회 대상 회사 ID를 결정.
 *
 * - super_admin: query.companyId로 특정 회사 지정 가능. 미지정 시 null (전체).
 * - company_admin / company_user: 자사 companyId 고정.
 *
 * @returns companyId 또는 null (전체 조회)
 */
function getCompanyScope(req) {
    const { userType, companyId } = req.user;
    if (userType === 'super_admin')
        return req.query.companyId || null;
    return companyId;
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
function buildUserFilter(req, startParamIndex, columnName = 'created_by') {
    const { userType, userId } = req.user;
    let sql = '';
    const params = [];
    let paramIndex = startParamIndex;
    // company_user: 본인 것만
    if (userType === 'company_user' && userId) {
        sql += ` AND ${columnName} = $${paramIndex++}`;
        params.push(userId);
    }
    // company_admin: 특정 사용자 필터 (선택적)
    if (userType === 'company_admin' && req.query.filter_user_id) {
        sql += ` AND ${columnName} = $${paramIndex++}`;
        params.push(req.query.filter_user_id);
    }
    return { sql, params, nextIndex: paramIndex };
}
// ============================================================
// 헬퍼: 권한 체크 유틸
// ============================================================
/** 관리자 이상 권한인지 확인 (company_admin 또는 super_admin) */
function isAdmin(req) {
    const userType = req.user?.userType;
    return userType === 'company_admin' || userType === 'super_admin';
}
/** 슈퍼관리자인지 확인 */
function isSuperAdmin(req) {
    return req.user?.userType === 'super_admin';
}
/** 요청자의 userId 추출 */
function getUserId(req) {
    return req.user.userId;
}
/** 요청자의 companyId 추출 (super_admin은 null 가능) */
function getCompanyId(req) {
    return req.user?.companyId;
}
/** 요청자의 userType 추출 */
function getUserType(req) {
    return req.user.userType;
}
//# sourceMappingURL=permission-helper.js.map