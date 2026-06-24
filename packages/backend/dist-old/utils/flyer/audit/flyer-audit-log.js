"use strict";
/**
 * ★ CT-F23 — 전단AI 감사로그 컨트롤타워
 *
 * 전단AI 사용자 접속/액션 이력 기록 및 조회.
 * 한줄로AI audit_logs 패턴 재활용, 전단AI 전용 flyer_audit_logs 테이블 사용.
 *
 * 기록 대상:
 *   - 로그인 (login)
 *   - 전단 생성/수정/삭제 (flyer_create, flyer_update, flyer_delete)
 *   - 발송 (campaign_send)
 *   - 주문 상태 변경 (order_status_change)
 *   - 설정 변경 (settings_update)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUDIT_ACTION_LABELS = void 0;
exports.logFlyerAudit = logFlyerAudit;
exports.queryFlyerAuditLogs = queryFlyerAuditLogs;
const database_1 = require("../../../config/database");
// ============================================================
// 감사로그 기록 (비동기 — 실패해도 서비스 영향 없음)
// ============================================================
async function logFlyerAudit(params) {
    try {
        await (0, database_1.query)(`INSERT INTO flyer_audit_logs
         (user_id, company_id, action, target_type, target_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
            params.userId,
            params.companyId,
            params.action,
            params.targetType || null,
            params.targetId || null,
            params.details ? JSON.stringify(params.details) : null,
            params.ipAddress || null,
            params.userAgent || null,
        ]);
    }
    catch (err) {
        // ★ 감사로그 실패해도 서비스 영향 없음
        console.error('[CT-F23] 감사로그 기록 실패:', err.message);
    }
}
async function queryFlyerAuditLogs(params) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    const queryParams = [];
    let paramIndex = 1;
    if (params.companyId) {
        whereClause += ` AND al.company_id = $${paramIndex++}::uuid`;
        queryParams.push(params.companyId);
    }
    if (params.userId) {
        whereClause += ` AND al.user_id = $${paramIndex++}::uuid`;
        queryParams.push(params.userId);
    }
    if (params.action) {
        whereClause += ` AND al.action = $${paramIndex++}`;
        queryParams.push(params.action);
    }
    if (params.fromDate) {
        whereClause += ` AND al.created_at >= $${paramIndex++}::date`;
        queryParams.push(params.fromDate);
    }
    if (params.toDate) {
        whereClause += ` AND al.created_at < ($${paramIndex++}::date + interval '1 day')`;
        queryParams.push(params.toDate);
    }
    // 총 건수
    const countResult = await (0, database_1.query)(`SELECT COUNT(*) FROM flyer_audit_logs al ${whereClause}`, queryParams);
    const total = parseInt(countResult.rows[0].count, 10);
    // 데이터 조회
    const dataParams = [...queryParams, limit, offset];
    const result = await (0, database_1.query)(`SELECT
       al.id, al.user_id, al.company_id, al.action, al.target_type, al.target_id,
       al.details, al.ip_address, al.user_agent, al.created_at,
       fu.login_id, fu.name as user_name, fu.store_name,
       fc.company_name
     FROM flyer_audit_logs al
     LEFT JOIN flyer_users fu ON al.user_id = fu.id
     LEFT JOIN flyer_companies fc ON al.company_id = fc.id
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`, dataParams);
    // 액션 유형 목록
    const actionsResult = await (0, database_1.query)(`SELECT DISTINCT action FROM flyer_audit_logs ORDER BY action`);
    return {
        logs: result.rows.map(parseLogRow),
        total,
        page,
        totalPages: Math.ceil(total / limit),
        actions: actionsResult.rows.map((r) => r.action),
    };
}
// ============================================================
// 액션 한국어 라벨
// ============================================================
exports.AUDIT_ACTION_LABELS = {
    login: '로그인',
    logout: '로그아웃',
    flyer_create: '전단 생성',
    flyer_update: '전단 수정',
    flyer_delete: '전단 삭제',
    flyer_publish: '전단 발행',
    campaign_send: '발송',
    order_status_change: '주문 상태 변경',
    coupon_create: '쿠폰 생성',
    coupon_redeem: '쿠폰 사용',
    settings_update: '설정 변경',
    customer_upload: '고객 업로드',
    balance_charge: '잔액 충전',
};
// ============================================================
// 내부 헬퍼
// ============================================================
function parseLogRow(row) {
    return {
        id: row.id,
        userId: row.user_id,
        companyId: row.company_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        createdAt: row.created_at,
        loginId: row.login_id,
        userName: row.user_name,
        storeName: row.store_name,
        companyName: row.company_name,
    };
}
//# sourceMappingURL=flyer-audit-log.js.map