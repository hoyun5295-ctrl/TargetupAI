"use strict";
/**
 * ★ 전단AI QR 쿠폰 라우트
 *
 * 마운트: /api/flyer/coupons (인증 필요)
 * 공개:   /api/flyer/q (인증 불필요 — QR 스캔 페이지)
 *
 * CT: CT-F15 flyer-coupons.ts
 */
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
exports.publicRouter = void 0;
const express_1 = require("express");
const flyer_auth_1 = require("../../middlewares/flyer-auth");
const flyer_1 = require("../../utils/flyer");
const database_1 = require("../../config/database");
// ============================================================
// 공개 라우트 (QR 스캔 — 인증 불필요)
// ============================================================
exports.publicRouter = (0, express_1.Router)();
/** GET /api/flyer/q/:qrCode — QR 스캔 시 쿠폰 페이지 렌더링 */
exports.publicRouter.get('/:qrCode', async (req, res) => {
    try {
        const { qrCode } = req.params;
        const campaign = await (0, flyer_1.getCampaignByQrCode)(qrCode);
        if (!campaign) {
            return res.status(404).send(renderErrorPage('쿠폰을 찾을 수 없습니다.'));
        }
        if (campaign.status !== 'active') {
            return res.status(410).send(renderErrorPage('종료된 쿠폰입니다.'));
        }
        if (campaign.expires_at && new Date(campaign.expires_at) < new Date()) {
            return res.status(410).send(renderErrorPage('쿠폰 기한이 만료되었습니다.'));
        }
        // 클릭 로그 (비동기)
        const ip = req.ip || req.socket.remoteAddress || null;
        const ua = req.headers['user-agent'] || null;
        (0, database_1.query)(`INSERT INTO url_clicks (short_url_id, ip, user_agent)
       SELECT su.id, $2, $3
       FROM short_urls su
       JOIN flyers f ON f.id = su.flyer_id
       JOIN flyer_coupon_campaigns cc ON cc.flyer_id = f.id
       WHERE cc.qr_code = $1
       LIMIT 1`, [qrCode, ip, ua]).catch(() => { });
        const html = (0, flyer_1.renderCouponPage)(campaign);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    }
    catch (err) {
        console.error('[flyer/q] 쿠폰 페이지 렌더링 실패:', err.message);
        res.status(500).send(renderErrorPage('페이지를 불러올 수 없습니다.'));
    }
});
/** POST /api/flyer/q/:qrCode/claim — 쿠폰 수령 */
exports.publicRouter.post('/:qrCode/claim', async (req, res) => {
    try {
        const { qrCode } = req.params;
        const { phone, name } = req.body;
        if (!phone)
            return res.status(400).json({ ok: false, error: '전화번호를 입력해주세요.' });
        const result = await (0, flyer_1.claimCoupon)(qrCode, phone, name);
        // 수령 성공 시 SMS 발송 (비동기 — 실패해도 쿠폰 발급은 유지)
        if (result.ok && result.couponCode) {
            const campaign = await (0, flyer_1.getCampaignByQrCode)(qrCode);
            if (campaign) {
                const discountDesc = campaign.discount_description
                    || (campaign.coupon_type === 'percent'
                        ? `${campaign.discount_value}%`
                        : `${Number(campaign.discount_value).toLocaleString()}원`);
                const smsMsg = (0, flyer_1.buildCouponSmsMessage)(campaign.store_name || '', result.couponCode, discountDesc, campaign.expires_at || undefined);
                // CT-F01 인증 라인으로 1건 발송 (대량발송 Agent 차단 우회)
                const { getAuthSmsTable, toQtmsgType } = await Promise.resolve().then(() => __importStar(require('../../utils/flyer')));
                const { mysqlQuery } = await Promise.resolve().then(() => __importStar(require('../../config/database')));
                const authTable = getAuthSmsTable();
                // 발신번호: 회사의 대표 콜백번호 조회
                const cbResult = await (0, database_1.query)(`SELECT phone FROM flyer_callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1`, [campaign.company_id]);
                const callback = cbResult.rows[0]?.phone || '';
                if (callback && authTable) {
                    mysqlQuery(`INSERT INTO ${authTable} (dest_no, call_back, msg_contents, msg_type, title_str, app_etc2)
             VALUES (?, ?, ?, ?, ?, ?)`, [phone.replace(/[^0-9]/g, ''), callback, smsMsg, toQtmsgType('SMS'), '', campaign.company_id]).catch(err => console.error('[flyer/q] 쿠폰 SMS 발송 실패:', err.message));
                }
            }
        }
        return res.json(result);
    }
    catch (err) {
        console.error('[flyer/q] 쿠폰 수령 실패:', err.message);
        return res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
    }
});
// ============================================================
// 인증 라우트 (매장 관리)
// ============================================================
const router = (0, express_1.Router)();
router.use(flyer_auth_1.flyerAuthenticate);
/** POST / — 쿠폰 캠페인 생성 */
router.post('/', async (req, res) => {
    try {
        const { companyId, userId } = req.flyerUser;
        const { coupon_name, coupon_type, discount_value, discount_description, min_purchase, max_issues, expires_at, flyer_id } = req.body;
        if (!coupon_name || !coupon_type || discount_value === undefined) {
            return res.status(400).json({ error: 'coupon_name, coupon_type, discount_value 필수' });
        }
        const campaign = await (0, flyer_1.createCouponCampaign)({
            companyId,
            createdBy: userId,
            flyerId: flyer_id,
            couponName: coupon_name,
            couponType: coupon_type,
            discountValue: discount_value,
            discountDescription: discount_description,
            minPurchase: min_purchase,
            maxIssues: max_issues,
            expiresAt: expires_at,
        });
        return res.status(201).json(campaign);
    }
    catch (err) {
        console.error('[flyer/coupons] 생성 실패:', err.message);
        return res.status(500).json({ error: '서버 오류' });
    }
});
/** GET / — 쿠폰 캠페인 목록 */
router.get('/', async (req, res) => {
    try {
        const { companyId } = req.flyerUser;
        const campaigns = await (0, flyer_1.listCouponCampaigns)(companyId);
        return res.json(campaigns);
    }
    catch (err) {
        return res.status(500).json({ error: '서버 오류' });
    }
});
/** GET /lookup — 전화번호로 미사용 쿠폰 조회 */
router.get('/lookup', async (req, res) => {
    try {
        const { companyId } = req.flyerUser;
        const phone = req.query.phone;
        if (!phone)
            return res.status(400).json({ error: 'phone 필수' });
        const coupons = await (0, flyer_1.lookupCouponsByPhone)(phone, companyId);
        return res.json(coupons);
    }
    catch (err) {
        return res.status(500).json({ error: '서버 오류' });
    }
});
/** GET /:id — 쿠폰 캠페인 상세 */
router.get('/:id', async (req, res) => {
    try {
        const { companyId } = req.flyerUser;
        const campaign = await (0, flyer_1.getCouponCampaign)(req.params.id, companyId);
        if (!campaign)
            return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
        return res.json(campaign);
    }
    catch (err) {
        return res.status(500).json({ error: '서버 오류' });
    }
});
/** GET /:id/stats — 통계 */
router.get('/:id/stats', async (req, res) => {
    try {
        const { companyId } = req.flyerUser;
        const stats = await (0, flyer_1.getCouponStats)(req.params.id, companyId);
        if (!stats)
            return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
        return res.json(stats);
    }
    catch (err) {
        return res.status(500).json({ error: '서버 오류' });
    }
});
/** GET /:id/coupons — 발급된 쿠폰 목록 */
router.get('/:id/coupons', async (req, res) => {
    try {
        const { companyId } = req.flyerUser;
        const coupons = await (0, flyer_1.listCoupons)(req.params.id, companyId);
        return res.json(coupons);
    }
    catch (err) {
        return res.status(500).json({ error: '서버 오류' });
    }
});
/** PUT /:id — 쿠폰 캠페인 수정 */
router.put('/:id', async (req, res) => {
    try {
        const { companyId } = req.flyerUser;
        const { coupon_name, discount_value, discount_description, min_purchase, max_issues, expires_at } = req.body;
        const updated = await (0, flyer_1.updateCouponCampaign)(req.params.id, companyId, {
            couponName: coupon_name,
            discountValue: discount_value,
            discountDescription: discount_description,
            minPurchase: min_purchase,
            maxIssues: max_issues,
            expiresAt: expires_at,
        });
        if (!updated)
            return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
        return res.json(updated);
    }
    catch (err) {
        return res.status(500).json({ error: '서버 오류' });
    }
});
/** DELETE /:id — 비활성화 */
router.delete('/:id', async (req, res) => {
    try {
        const { companyId } = req.flyerUser;
        const ok = await (0, flyer_1.disableCouponCampaign)(req.params.id, companyId);
        if (!ok)
            return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
        return res.json({ ok: true });
    }
    catch (err) {
        return res.status(500).json({ error: '서버 오류' });
    }
});
/** POST /redeem — 쿠폰 사용 처리 */
router.post('/redeem', async (req, res) => {
    try {
        const { companyId, userId } = req.flyerUser;
        const { coupon_code, purchase_amount } = req.body;
        if (!coupon_code)
            return res.status(400).json({ error: 'coupon_code 필수' });
        const result = await (0, flyer_1.redeemCoupon)(coupon_code, companyId, userId, purchase_amount);
        return res.json(result);
    }
    catch (err) {
        return res.status(500).json({ error: '서버 오류' });
    }
});
// ============================================================
// GET /dashboard — 쿠폰 통계 대시보드 (CT: coupon/flyer-coupons getCouponDashboard)
// ============================================================
router.get('/dashboard', async (req, res) => {
    try {
        const { companyId } = req.flyerUser;
        const data = await (0, flyer_1.getCouponDashboard)(companyId);
        return res.json(data);
    }
    catch (err) {
        console.error('[coupon] dashboard error:', err);
        return res.status(500).json({ error: '서버 오류' });
    }
});
exports.default = router;
// ============================================================
// 에러 페이지 (공개)
// ============================================================
function renderErrorPage(message) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>쿠폰</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Noto Sans KR',sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .msg{text-align:center;padding:40px}
  .msg h1{font-size:20px;color:#666;margin-bottom:8px}
  .msg p{font-size:14px;color:#999}
</style>
</head>
<body><div class="msg"><h1>${message}</h1><p>hanjul-flyer.kr</p></div></body>
</html>`;
}
//# sourceMappingURL=coupons.js.map