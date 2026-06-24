"use strict";
/**
 * ★ 전단AI 수신거부 라우트
 * 마운트: /api/flyer/unsubscribes
 * CT: CT-F02 flyer-unsubscribe-helper.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const flyer_auth_1 = require("../../middlewares/flyer-auth");
const flyer_1 = require("../../utils/flyer");
const router = (0, express_1.Router)();
router.use(flyer_auth_1.flyerAuthenticate);
router.get('/', async (req, res) => {
    try {
        const { userId } = req.flyerUser;
        const page = parseInt(String(req.query.page || '1'), 10);
        const pageSize = parseInt(String(req.query.pageSize || '50'), 10);
        const search = req.query.search;
        const result = await (0, flyer_1.getFlyerUnsubscribes)(userId, { page, pageSize, search });
        return res.json(result);
    }
    catch (error) {
        console.error('[flyer/unsubscribes] list error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});
router.post('/', async (req, res) => {
    try {
        const { userId, companyId } = req.flyerUser;
        const { phone } = req.body;
        if (!phone)
            return res.status(400).json({ error: '전화번호가 필요합니다' });
        await (0, flyer_1.registerFlyerUnsubscribe)(userId, companyId, phone, 'manual');
        return res.json({ message: '수신거부 등록되었습니다' });
    }
    catch (error) {
        console.error('[flyer/unsubscribes] register error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});
router.delete('/', async (req, res) => {
    try {
        const { userId } = req.flyerUser;
        const { phones } = req.body;
        if (!Array.isArray(phones))
            return res.status(400).json({ error: 'phones 배열이 필요합니다' });
        const deleted = await (0, flyer_1.deleteFlyerUnsubscribes)(userId, phones);
        return res.json({ deleted });
    }
    catch (error) {
        console.error('[flyer/unsubscribes] delete error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=unsubscribes.js.map