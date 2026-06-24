"use strict";
/**
 * ★ D112: 슈퍼관리자 서비스 전환 엔드포인트
 * 마운트: /api/admin/switch-service
 *
 * JWT를 재발급하여 currentService = 'hanjullo' | 'flyer' 변경.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
router.post('/', auth_1.authenticate, async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.userType !== 'super_admin') {
            return res.status(403).json({ error: 'Super admin only' });
        }
        const { to } = req.body;
        if (to !== 'hanjullo' && to !== 'flyer') {
            return res.status(400).json({ error: 'to must be "hanjullo" or "flyer"' });
        }
        // 새 JWT 발급 (currentService 포함)
        const newPayload = {
            userId: user.userId,
            userType: user.userType,
            loginId: user.loginId,
            sessionId: user.sessionId,
            currentService: to,
        };
        const token = (0, auth_1.generateToken)(newPayload);
        return res.json({
            token,
            currentService: to,
            redirectTo: to === 'flyer' ? '/flyer/dashboard' : '/hanjullo/dashboard',
        });
    }
    catch (error) {
        console.error('[admin/switch-service] error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=switch-service.js.map