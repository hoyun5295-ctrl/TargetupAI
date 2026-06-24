"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const database_1 = __importStar(require("../config/database"));
const defaults_1 = require("../config/defaults");
const permission_helper_1 = require("../utils/permission-helper");
const sms_queue_1 = require("../utils/sms-queue");
const stats_aggregation_1 = require("../utils/stats-aggregation");
const router = (0, express_1.Router)();
// ============================================================
//  발송 통계 API — 공용 (슈퍼관리자 + 고객사관리자)
//  마운트: /api/manage/stats
//  ★ D106: 통계 쿼리를 stats-aggregation.ts 컨트롤타워로 통합
//     manage-stats.ts는 테스트 통계(MySQL)만 인라인, 나머지는 컨트롤타워 호출
// ============================================================
router.use(auth_1.authenticate, auth_1.requireCompanyAdmin);
// GET /send - 발송 통계 (요약 + 페이징된 일별/월별) + 테스트 발송 분리
router.get('/send', async (req, res) => {
    try {
        const view = req.query.view === 'monthly' ? 'monthly' : 'daily';
        const startDate = req.query.startDate || '';
        const endDate = req.query.endDate || '';
        const companyScope = (0, permission_helper_1.getCompanyScope)(req);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const filterUserId = req.query.filterUserId;
        // ★ 컨트롤타워 호출 — 인라인 쿼리 제거
        const statsResult = await (0, stats_aggregation_1.querySendStats)({
            view: view,
            startDate,
            endDate,
            companyId: companyScope || undefined,
            filterUserId: filterUserId || undefined,
            page,
            limit,
        });
        // 테스트 발송 통계 (MySQL — 컨트롤타워 대상 아님, 관리자 전용)
        let testSummary = { total: 0, success: 0, fail: 0, pending: 0, sms: 0, lms: 0, cost: 0 };
        if (companyScope) {
            try {
                // 월별 조회 시 날짜 확장 (테스트 통계용)
                let testStartDate = startDate;
                let testEndDate = endDate;
                if (view === 'monthly') {
                    if (testStartDate)
                        testStartDate = testStartDate.substring(0, 7) + '-01';
                    if (testEndDate) {
                        const d = new Date(testEndDate);
                        d.setMonth(d.getMonth() + 1, 0);
                        testEndDate = d.toISOString().split('T')[0];
                    }
                }
                // 담당자 테스트 (MySQL)
                let mysqlDateWhere = '';
                const mysqlParams = [companyScope];
                if (testStartDate) {
                    mysqlDateWhere += ` AND msg_instm >= ?`;
                    mysqlParams.push(testStartDate);
                }
                if (testEndDate) {
                    mysqlDateWhere += ` AND msg_instm < DATE_ADD(?, INTERVAL 1 DAY)`;
                    mysqlParams.push(testEndDate);
                }
                const testTables = await (0, sms_queue_1.getTestSmsTables)();
                for (const tbl of testTables) {
                    const testRows = await (0, database_1.mysqlQuery)(`SELECT
              COUNT(*) as total,
              SUM(CASE WHEN status_code IN (6, 1000, 1800) THEN 1 ELSE 0 END) as success,
              SUM(CASE WHEN status_code NOT IN (6, 1000, 1800, 100) THEN 1 ELSE 0 END) as fail,
              SUM(CASE WHEN status_code = 100 THEN 1 ELSE 0 END) as pending,
              SUM(CASE WHEN msg_type = 'S' THEN 1 ELSE 0 END) as sms,
              SUM(CASE WHEN msg_type = 'L' THEN 1 ELSE 0 END) as lms
            FROM ${tbl}
            WHERE app_etc1 = 'test' AND app_etc2 = ? ${mysqlDateWhere}`, mysqlParams);
                    if (testRows && testRows.length > 0) {
                        const t = testRows[0];
                        testSummary.total += Number(t.total) || 0;
                        testSummary.success += Number(t.success) || 0;
                        testSummary.fail += Number(t.fail) || 0;
                        testSummary.pending += Number(t.pending) || 0;
                        testSummary.sms += Number(t.sms) || 0;
                        testSummary.lms += Number(t.lms) || 0;
                    }
                }
                // 스팸필터 테스트 (PostgreSQL)
                const sfDr = (0, stats_aggregation_1.buildDateRangeFilter)('t.created_at', testStartDate, testEndDate, 2);
                const sfDateWhere = sfDr.sql;
                const sfParams = [companyScope, ...sfDr.params];
                const sfAgg = await database_1.default.query(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN r.message_type = 'SMS' THEN 1 ELSE 0 END) as sms,
            SUM(CASE WHEN r.message_type = 'LMS' THEN 1 ELSE 0 END) as lms,
            SUM(CASE WHEN r.result IS NOT NULL THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN r.result IS NULL AND t.status IN ('active','pending') THEN 1 ELSE 0 END) as pending
          FROM spam_filter_test_results r
          JOIN spam_filter_tests t ON r.test_id = t.id
          WHERE t.company_id = $1 ${sfDateWhere}
        `, sfParams);
                const sf = sfAgg.rows[0];
                testSummary.total += Number(sf.total) || 0;
                testSummary.success += Number(sf.completed) || 0;
                testSummary.pending += Number(sf.pending) || 0;
                testSummary.sms += Number(sf.sms) || 0;
                testSummary.lms += Number(sf.lms) || 0;
                // 비용 계산 (회사 단가 기준)
                const costRes = await database_1.default.query('SELECT cost_per_sms, cost_per_lms FROM companies WHERE id = $1', [companyScope]);
                const cSms = Number(costRes.rows[0]?.cost_per_sms) || defaults_1.DEFAULT_COSTS.sms;
                const cLms = Number(costRes.rows[0]?.cost_per_lms) || defaults_1.DEFAULT_COSTS.lms;
                testSummary.cost = Math.round(((testSummary.sms - testSummary.pending) * cSms + testSummary.lms * cLms) * 10) / 10;
            }
            catch (mysqlErr) {
                console.error('테스트 통계 조회 실패:', mysqlErr);
            }
        }
        res.json({
            summary: statsResult.summary,
            testSummary,
            rows: statsResult.rows,
            total: statsResult.total,
            page: statsResult.page,
            totalPages: statsResult.totalPages,
        });
    }
    catch (error) {
        console.error('발송 통계 조회 실패:', error);
        res.status(500).json({ error: '발송 통계 조회 실패' });
    }
});
// GET /send/detail - 발송 통계 상세 (사용자별 분해)
router.get('/send/detail', async (req, res) => {
    try {
        const view = req.query.view === 'monthly' ? 'monthly' : 'daily';
        const dateVal = req.query.date || '';
        const companyScope = (0, permission_helper_1.getCompanyScope)(req);
        const targetCompanyId = req.query.companyId || companyScope;
        if (!dateVal || !targetCompanyId) {
            return res.status(400).json({ error: '날짜와 고객사 ID가 필요합니다.' });
        }
        // 고객사관리자: 자사만
        if (req.user.userType === 'company_admin' && targetCompanyId !== req.user.companyId) {
            return res.status(403).json({ error: '자사 통계만 조회할 수 있습니다.' });
        }
        const filterUserId = req.query.filterUserId;
        // ★ 컨트롤타워 호출 — 인라인 쿼리 제거
        const detailResult = await (0, stats_aggregation_1.querySendStatsDetail)({ view: view, date: dateVal, companyId: targetCompanyId, filterUserId: filterUserId || undefined }, { sms: defaults_1.DEFAULT_COSTS.sms, lms: defaults_1.DEFAULT_COSTS.lms });
        // 테스트 발송 상세 (MySQL — 관리자 전용)
        let testDetail = [];
        try {
            let mysqlDateWhere = '';
            const mysqlParams = [targetCompanyId];
            if (view === 'monthly') {
                mysqlDateWhere = ` AND DATE_FORMAT(msg_instm, '%Y-%m') = ?`;
            }
            else {
                mysqlDateWhere = ` AND DATE_FORMAT(msg_instm, '%Y-%m-%d') = ?`;
            }
            mysqlParams.push(dateVal);
            const testRows = await (0, database_1.mysqlQuery)(`SELECT
          dest_no as phone, msg_type, status_code,
          msg_instm as sent_at, bill_id as sender_id
        FROM ${(await (0, sms_queue_1.getTestSmsTables)())[0]}
        WHERE app_etc1 = 'test' AND app_etc2 = ? ${mysqlDateWhere}
        ORDER BY msg_instm DESC LIMIT 50`, mysqlParams);
            testDetail = testRows.map(r => ({
                phone: r.phone,
                msgType: r.msg_type === 'S' ? 'SMS' : 'LMS',
                status: [6, 1000, 1800].includes(r.status_code) ? 'success' : r.status_code === 100 ? 'pending' : 'fail',
                sentAt: r.sent_at,
                testType: 'manager',
            }));
            // 스팸필터 테스트
            let sfDateCond = '';
            if (view === 'monthly') {
                sfDateCond = `AND TO_CHAR(t.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $2`;
            }
            else {
                sfDateCond = `AND TO_CHAR(t.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $2`;
            }
            const sfDetail = await database_1.default.query(`
        SELECT r.phone, r.carrier, r.message_type, r.result, t.created_at as sent_at
        FROM spam_filter_test_results r
        JOIN spam_filter_tests t ON r.test_id = t.id
        WHERE t.company_id = $1 ${sfDateCond}
        ORDER BY t.created_at DESC LIMIT 50
      `, [targetCompanyId, dateVal]);
            sfDetail.rows.forEach((r) => {
                testDetail.push({
                    phone: r.phone, msgType: r.message_type || 'SMS',
                    status: r.result ? 'success' : 'pending', result: r.result || 'pending',
                    carrier: r.carrier, sentAt: r.sent_at, testType: 'spam_filter',
                });
            });
        }
        catch (mysqlErr) {
            console.error('테스트 상세 MySQL 조회 실패:', mysqlErr);
        }
        res.json({
            ...detailResult,
            testDetail,
        });
    }
    catch (error) {
        console.error('발송 통계 상세 조회 실패:', error);
        res.status(500).json({ error: '발송 통계 상세 조회 실패' });
    }
});
exports.default = router;
//# sourceMappingURL=manage-stats.js.map