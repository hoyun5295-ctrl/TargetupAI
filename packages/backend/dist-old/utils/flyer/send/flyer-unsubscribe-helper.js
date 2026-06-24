"use strict";
/**
 * ★ CT-F02 — 전단AI 수신거부 컨트롤타워
 *
 * 한줄로 utils/unsubscribe-helper.ts와 완전 분리.
 * 데이터 저장: flyer_unsubscribes 테이블
 * 격리 키: flyer_users.id (user_id 기준)
 *
 * 필터 패턴:
 *   AND NOT EXISTS (
 *     SELECT 1 FROM flyer_unsubscribes fu
 *     WHERE fu.user_id = $발송자 AND fu.phone = c.phone
 *   )
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFlyerUnsubscribeFilter = buildFlyerUnsubscribeFilter;
exports.registerFlyerUnsubscribe = registerFlyerUnsubscribe;
exports.isFlyerUnsubscribed = isFlyerUnsubscribed;
exports.getFlyerUnsubscribes = getFlyerUnsubscribes;
exports.deleteFlyerUnsubscribes = deleteFlyerUnsubscribes;
exports.filterOutFlyerUnsubscribed = filterOutFlyerUnsubscribed;
const database_1 = require("../../../config/database");
/**
 * 발송 WHERE 절에 삽입할 수신거부 제외 필터 생성.
 */
function buildFlyerUnsubscribeFilter(userIdRef, phoneRef) {
    return `NOT EXISTS (
    SELECT 1 FROM flyer_unsubscribes fu
    WHERE fu.user_id = ${userIdRef} AND fu.phone = ${phoneRef}
  )`;
}
/**
 * 수신거부 단건 등록 (수동 등록 / 080 콜백 / 관리자 추가).
 */
async function registerFlyerUnsubscribe(userId, companyId, phone, source = 'manual') {
    await (0, database_1.query)(`INSERT INTO flyer_unsubscribes (id, user_id, company_id, phone, source, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, phone) DO NOTHING`, [userId, companyId, phone, source]);
    // flyer_customers.sms_opt_in 동기화
    await (0, database_1.query)(`UPDATE flyer_customers SET sms_opt_in = false, updated_at = NOW()
     WHERE company_id = $1 AND phone = $2`, [companyId, phone]);
}
/**
 * 수신거부 여부 조회 (단건).
 */
async function isFlyerUnsubscribed(userId, phone) {
    const result = await (0, database_1.query)(`SELECT 1 FROM flyer_unsubscribes WHERE user_id = $1 AND phone = $2 LIMIT 1`, [userId, phone]);
    return result.rows.length > 0;
}
/**
 * 수신거부 목록 조회 (사용자 기준).
 */
async function getFlyerUnsubscribes(userId, options = {}) {
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(500, Math.max(1, options.pageSize || 50));
    const offset = (page - 1) * pageSize;
    let where = `user_id = $1`;
    const params = [userId];
    if (options.search) {
        params.push(`%${options.search}%`);
        where += ` AND phone ILIKE $${params.length}`;
    }
    const countRes = await (0, database_1.query)(`SELECT COUNT(*)::int AS cnt FROM flyer_unsubscribes WHERE ${where}`, params);
    const total = countRes.rows[0]?.cnt || 0;
    params.push(pageSize, offset);
    const listRes = await (0, database_1.query)(`SELECT id, phone, source, created_at FROM flyer_unsubscribes
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items: listRes.rows, total };
}
async function deleteFlyerUnsubscribes(userId, phones) {
    if (!phones || phones.length === 0)
        return 0;
    const result = await (0, database_1.query)(`DELETE FROM flyer_unsubscribes WHERE user_id = $1 AND phone = ANY($2::text[])`, [userId, phones]);
    return result.rowCount || 0;
}
/**
 * 발송 대상 phone 목록에서 수신거부 번호 제거.
 */
async function filterOutFlyerUnsubscribed(userId, phones) {
    if (!phones || phones.length === 0)
        return [];
    const result = await (0, database_1.query)(`SELECT phone FROM flyer_unsubscribes WHERE user_id = $1 AND phone = ANY($2::text[])`, [userId, phones]);
    const blocked = new Set(result.rows.map((r) => r.phone));
    return phones.filter(p => !blocked.has(p));
}
//# sourceMappingURL=flyer-unsubscribe-helper.js.map