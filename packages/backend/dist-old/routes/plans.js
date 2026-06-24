"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// GET /api/plans - 요금제 목록 (인증 불필요)
router.get('/', async (req, res) => {
    try {
        const result = await (0, database_1.query)(`SELECT * FROM plans WHERE is_active = true ORDER BY monthly_price ASC`);
        return res.json({ plans: result.rows });
    }
    catch (error) {
        console.error('요금제 목록 조회 에러:', error);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
});
exports.default = router;
//# sourceMappingURL=plans.js.map