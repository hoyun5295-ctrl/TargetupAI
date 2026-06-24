"use strict";
/**
 * ★ CT-F01 — 전단AI SMS 큐 컨트롤타워
 *
 * 한줄로 utils/sms-queue.ts와 완전 분리.
 * - 라인그룹 조회: flyer_companies.line_group_id 기반
 * - MySQL QTmsg 큐 조작 함수(smsAggAll/bulkInsertSmsQueue 등)는 sms-queue.ts 것을 재export
 *   (MySQL 테이블 조작은 PG 스키마와 무관하므로 안전)
 *
 * ⚠️ flyer_companies.line_group_id 컬럼이 반드시 있어야 함 (FLYER-SCHEMA.md 참조)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuthSmsTable = exports.getTestSmsTables = exports.insertTestSmsQueue = exports.bulkInsertSmsQueue = exports.smsExecAll = exports.smsBatchAggByGroup = exports.smsGroupByAll = exports.smsMinAll = exports.smsSelectAll = exports.smsCountAll = exports.smsAggAll = exports.toKoreaTimeStr = exports.toQtmsgType = void 0;
exports.getFlyerCompanySmsTables = getFlyerCompanySmsTables;
exports.invalidateFlyerLineGroupCache = invalidateFlyerLineGroupCache;
const database_1 = require("../../../config/database");
// 라인그룹 캐시 (간단한 메모리 캐시, TTL 5분)
const TTL = 5 * 60 * 1000;
const cache = new Map();
const BULK_FALLBACK = (process.env.SMS_TABLES || 'SMSQ_SEND').split(',').map(s => s.trim());
/**
 * 전단AI 회사의 발송 라인그룹 테이블 조회.
 * flyer_companies.line_group_id → sms_line_groups → sms_tables 배열
 * 할당 없으면 환경변수 SMS_TABLES fallback (한줄로와 공유하는 기본 라인)
 */
async function getFlyerCompanySmsTables(companyId) {
    const cacheKey = `flyer:${companyId}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now())
        return cached.tables;
    const result = await (0, database_1.query)(`SELECT lg.sms_tables
     FROM sms_line_groups lg
     JOIN flyer_companies fc ON fc.line_group_id = lg.id
     WHERE fc.id = $1 AND lg.is_active = true AND lg.group_type = 'bulk'`, [companyId]);
    const tables = result.rows.length > 0 && result.rows[0].sms_tables?.length > 0
        ? result.rows[0].sms_tables
        : BULK_FALLBACK;
    cache.set(cacheKey, { tables, expires: Date.now() + TTL });
    return tables;
}
function invalidateFlyerLineGroupCache(companyId) {
    if (companyId)
        cache.delete(`flyer:${companyId}`);
    else
        cache.clear();
}
// ──────────────────────────────────────────────────────────
// MySQL 큐 조작은 한줄로 sms-queue.ts 것을 그대로 재export
// (테이블 조작이므로 PG 스키마 격리와 무관)
// ──────────────────────────────────────────────────────────
var sms_queue_1 = require("../../sms-queue");
Object.defineProperty(exports, "toQtmsgType", { enumerable: true, get: function () { return sms_queue_1.toQtmsgType; } });
Object.defineProperty(exports, "toKoreaTimeStr", { enumerable: true, get: function () { return sms_queue_1.toKoreaTimeStr; } });
Object.defineProperty(exports, "smsAggAll", { enumerable: true, get: function () { return sms_queue_1.smsAggAll; } });
Object.defineProperty(exports, "smsCountAll", { enumerable: true, get: function () { return sms_queue_1.smsCountAll; } });
Object.defineProperty(exports, "smsSelectAll", { enumerable: true, get: function () { return sms_queue_1.smsSelectAll; } });
Object.defineProperty(exports, "smsMinAll", { enumerable: true, get: function () { return sms_queue_1.smsMinAll; } });
Object.defineProperty(exports, "smsGroupByAll", { enumerable: true, get: function () { return sms_queue_1.smsGroupByAll; } });
Object.defineProperty(exports, "smsBatchAggByGroup", { enumerable: true, get: function () { return sms_queue_1.smsBatchAggByGroup; } });
Object.defineProperty(exports, "smsExecAll", { enumerable: true, get: function () { return sms_queue_1.smsExecAll; } });
Object.defineProperty(exports, "bulkInsertSmsQueue", { enumerable: true, get: function () { return sms_queue_1.bulkInsertSmsQueue; } });
Object.defineProperty(exports, "insertTestSmsQueue", { enumerable: true, get: function () { return sms_queue_1.insertTestSmsQueue; } });
Object.defineProperty(exports, "getTestSmsTables", { enumerable: true, get: function () { return sms_queue_1.getTestSmsTables; } });
Object.defineProperty(exports, "getAuthSmsTable", { enumerable: true, get: function () { return sms_queue_1.getAuthSmsTable; } });
//# sourceMappingURL=flyer-sms-queue.js.map