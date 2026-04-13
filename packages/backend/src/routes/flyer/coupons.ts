/**
 * ★ 전단AI QR 쿠폰 라우트
 *
 * 마운트: /api/flyer/coupons (인증 필요)
 * 공개:   /api/flyer/q (인증 불필요 — QR 스캔 페이지)
 *
 * CT: CT-F15 flyer-coupons.ts
 */

import { Request, Response, Router } from 'express';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';
import {
  createCouponCampaign,
  listCouponCampaigns,
  getCouponCampaign,
  updateCouponCampaign,
  disableCouponCampaign,
  getCampaignByQrCode,
  claimCoupon,
  redeemCoupon,
  lookupCouponsByPhone,
  getCouponStats,
  listCoupons,
  renderCouponPage,
  buildCouponSmsMessage,
} from '../../utils/flyer';
import { query } from '../../config/database';

// ============================================================
// 공개 라우트 (QR 스캔 — 인증 불필요)
// ============================================================
export const publicRouter = Router();

/** GET /api/flyer/q/:qrCode — QR 스캔 시 쿠폰 페이지 렌더링 */
publicRouter.get('/:qrCode', async (req: Request, res: Response) => {
  try {
    const { qrCode } = req.params;
    const campaign = await getCampaignByQrCode(qrCode);

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
    query(
      `INSERT INTO url_clicks (short_url_id, ip, user_agent)
       SELECT su.id, $2, $3
       FROM short_urls su
       JOIN flyers f ON f.id = su.flyer_id
       JOIN flyer_coupon_campaigns cc ON cc.flyer_id = f.id
       WHERE cc.qr_code = $1
       LIMIT 1`,
      [qrCode, ip, ua]
    ).catch(() => {});

    const html = renderCouponPage(campaign);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    console.error('[flyer/q] 쿠폰 페이지 렌더링 실패:', err.message);
    res.status(500).send(renderErrorPage('페이지를 불러올 수 없습니다.'));
  }
});

/** POST /api/flyer/q/:qrCode/claim — 쿠폰 수령 */
publicRouter.post('/:qrCode/claim', async (req: Request, res: Response) => {
  try {
    const { qrCode } = req.params;
    const { phone, name } = req.body;

    if (!phone) return res.status(400).json({ ok: false, error: '전화번호를 입력해주세요.' });

    const result = await claimCoupon(qrCode, phone, name);

    // 수령 성공 시 SMS 발송 (비동기 — 실패해도 쿠폰 발급은 유지)
    if (result.ok && result.couponCode) {
      const campaign = await getCampaignByQrCode(qrCode);
      if (campaign) {
        const discountDesc = campaign.discount_description
          || (campaign.coupon_type === 'percent'
            ? `${campaign.discount_value}%`
            : `${Number(campaign.discount_value).toLocaleString()}원`);
        const smsMsg = buildCouponSmsMessage(
          (campaign as any).store_name || '',
          result.couponCode,
          discountDesc,
          campaign.expires_at || undefined
        );

        // CT-F01 인증 라인으로 1건 발송 (대량발송 Agent 차단 우회)
        const { getAuthSmsTable, toQtmsgType } = await import('../../utils/flyer');
        const { mysqlQuery } = await import('../../config/database');
        const authTable = getAuthSmsTable();

        // 발신번호: 회사의 대표 콜백번호 조회
        const cbResult = await query(
          `SELECT phone FROM flyer_callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1`,
          [campaign.company_id]
        );
        const callback = cbResult.rows[0]?.phone || '';

        if (callback && authTable) {
          mysqlQuery(
            `INSERT INTO ${authTable} (dest_no, call_back, msg_contents, msg_type, title_str, app_etc2)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [phone.replace(/[^0-9]/g, ''), callback, smsMsg, toQtmsgType('SMS'), '', campaign.company_id]
          ).catch(err => console.error('[flyer/q] 쿠폰 SMS 발송 실패:', err.message));
        }
      }
    }

    return res.json(result);
  } catch (err: any) {
    console.error('[flyer/q] 쿠폰 수령 실패:', err.message);
    return res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// 인증 라우트 (매장 관리)
// ============================================================
const router = Router();
router.use(flyerAuthenticate);

/** POST / — 쿠폰 캠페인 생성 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { companyId, userId } = (req as any).user;
    const { coupon_name, coupon_type, discount_value, discount_description, min_purchase, max_issues, expires_at, flyer_id } = req.body;

    if (!coupon_name || !coupon_type || discount_value === undefined) {
      return res.status(400).json({ error: 'coupon_name, coupon_type, discount_value 필수' });
    }

    const campaign = await createCouponCampaign({
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
  } catch (err: any) {
    console.error('[flyer/coupons] 생성 실패:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

/** GET / — 쿠폰 캠페인 목록 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { companyId } = (req as any).user;
    const campaigns = await listCouponCampaigns(companyId);
    return res.json(campaigns);
  } catch (err: any) {
    return res.status(500).json({ error: '서버 오류' });
  }
});

/** GET /lookup — 전화번호로 미사용 쿠폰 조회 */
router.get('/lookup', async (req: Request, res: Response) => {
  try {
    const { companyId } = (req as any).user;
    const phone = req.query.phone as string;
    if (!phone) return res.status(400).json({ error: 'phone 필수' });

    const coupons = await lookupCouponsByPhone(phone, companyId);
    return res.json(coupons);
  } catch (err: any) {
    return res.status(500).json({ error: '서버 오류' });
  }
});

/** GET /:id — 쿠폰 캠페인 상세 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { companyId } = (req as any).user;
    const campaign = await getCouponCampaign(req.params.id, companyId);
    if (!campaign) return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    return res.json(campaign);
  } catch (err: any) {
    return res.status(500).json({ error: '서버 오류' });
  }
});

/** GET /:id/stats — 통계 */
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const { companyId } = (req as any).user;
    const stats = await getCouponStats(req.params.id, companyId);
    if (!stats) return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    return res.json(stats);
  } catch (err: any) {
    return res.status(500).json({ error: '서버 오류' });
  }
});

/** GET /:id/coupons — 발급된 쿠폰 목록 */
router.get('/:id/coupons', async (req: Request, res: Response) => {
  try {
    const { companyId } = (req as any).user;
    const coupons = await listCoupons(req.params.id, companyId);
    return res.json(coupons);
  } catch (err: any) {
    return res.status(500).json({ error: '서버 오류' });
  }
});

/** PUT /:id — 쿠폰 캠페인 수정 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { companyId } = (req as any).user;
    const { coupon_name, discount_value, discount_description, min_purchase, max_issues, expires_at } = req.body;

    const updated = await updateCouponCampaign(req.params.id, companyId, {
      couponName: coupon_name,
      discountValue: discount_value,
      discountDescription: discount_description,
      minPurchase: min_purchase,
      maxIssues: max_issues,
      expiresAt: expires_at,
    });

    if (!updated) return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: '서버 오류' });
  }
});

/** DELETE /:id — 비활성화 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { companyId } = (req as any).user;
    const ok = await disableCouponCampaign(req.params.id, companyId);
    if (!ok) return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: '서버 오류' });
  }
});

/** POST /redeem — 쿠폰 사용 처리 */
router.post('/redeem', async (req: Request, res: Response) => {
  try {
    const { companyId, userId } = (req as any).user;
    const { coupon_code, purchase_amount } = req.body;

    if (!coupon_code) return res.status(400).json({ error: 'coupon_code 필수' });

    const result = await redeemCoupon(coupon_code, companyId, userId, purchase_amount);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ============================================================
// GET /dashboard — 쿠폰 통계 대시보드 (전체 집계)
// ============================================================
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const { companyId } = (req as any).user;

    // 전체 집계
    const aggResult = await query(
      `SELECT
         COUNT(*) AS total_campaigns,
         SUM(issued_count) AS total_issued,
         SUM(redeemed_count) AS total_redeemed,
         CASE WHEN SUM(issued_count) > 0
              THEN ROUND(SUM(redeemed_count)::numeric / SUM(issued_count) * 100, 1)
              ELSE 0 END AS conversion_rate
       FROM flyer_coupon_campaigns
       WHERE company_id = $1`,
      [companyId]
    );

    // 최근 7일 일별 발급/사용 추이
    const trendResult = await query(
      `SELECT
         TO_CHAR(c.issued_at, 'YYYY-MM-DD') AS date,
         COUNT(*) AS issued,
         COUNT(CASE WHEN c.status = 'redeemed' THEN 1 END) AS redeemed
       FROM flyer_coupons c
       JOIN flyer_coupon_campaigns cc ON cc.id = c.campaign_id
       WHERE cc.company_id = $1
         AND c.issued_at >= NOW() - INTERVAL '7 days'
       GROUP BY TO_CHAR(c.issued_at, 'YYYY-MM-DD')
       ORDER BY date`,
      [companyId]
    );

    // 캠페인별 실적
    const campaignResult = await query(
      `SELECT id, coupon_name, coupon_type, discount_value,
              issued_count, redeemed_count,
              CASE WHEN issued_count > 0
                   THEN ROUND(redeemed_count::numeric / issued_count * 100, 1)
                   ELSE 0 END AS conversion_rate,
              TO_CHAR(created_at, 'YYYY-MM-DD') AS created_at
       FROM flyer_coupon_campaigns
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [companyId]
    );

    const agg = aggResult.rows[0] || {};
    return res.json({
      summary: {
        totalCampaigns: Number(agg.total_campaigns) || 0,
        totalIssued: Number(agg.total_issued) || 0,
        totalRedeemed: Number(agg.total_redeemed) || 0,
        conversionRate: Number(agg.conversion_rate) || 0,
      },
      trend: trendResult.rows,
      campaigns: campaignResult.rows,
    });
  } catch (err: any) {
    console.error('[coupon] dashboard error:', err);
    return res.status(500).json({ error: '서버 오류' });
  }
});

export default router;

// ============================================================
// 에러 페이지 (공개)
// ============================================================
function renderErrorPage(message: string): string {
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
