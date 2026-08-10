/**
 * ★ 메이크샵 (커넥트웨이브 파트너센터 커머스 API) 연동 — 2026-07-06 신설 (서버 실측 확정)
 *
 * 인증 = client_credentials + Basic(자격 입력). webhook 미제공 → polling(수동/배치 조회).
 * 연동 = 자격+상점ID → 토큰 발급 실검증 성공 시에만 active (6원칙 ② — 네이버/고도몰 선례 미러).
 *
 * Endpoint:
 *   - POST   /api/makeshop/connect         : shop_uid + client_id/secret → 토큰 발급 검증 후 연동 (회사 admin)
 *   - GET    /api/makeshop/status          : 연동 상태
 *   - GET    /api/makeshop/preview?days=30 : 최근 회원·주문 raw 미리보기 — 스키마 실측용 (회사 admin)
 *   - DELETE /api/makeshop/disconnect      : 연동 해제
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { query } from '../config/database';
import {
  connectMakeshop,
  getMakeshopIntegration,
  fetchMakeshopPreview,
} from '../utils/makeshop-client';
import { isCdpEnabledForPlan } from '../utils/cdp-auth';
// ★ 2026-08-10: 스키마 실측 로그는 값이 아니라 구조로 남긴다(개인정보 미기록)
import { describeJsonShape } from '../utils/json-shape';

const router = Router();

router.use(authenticate);

/** 회사 admin + CDP 요금제 게이트. 실패 시 응답까지 처리하고 null 반환. */
async function gateCompanyAdmin(req: Request, res: Response): Promise<string | null> {
  const companyId = req.user?.companyId;
  const userType = req.user?.userType;
  if (!companyId) {
    res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    return null;
  }
  if (userType !== 'company_admin') {
    res.status(403).json({ success: false, error: '메이크샵 연동은 회사 관리자만 가능합니다.' });
    return null;
  }
  const cdpEnabled = await isCdpEnabledForPlan(companyId);
  if (!cdpEnabled) {
    res.status(403).json({ success: false, error: '메이크샵 연동은 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
    return null;
  }
  return companyId;
}

/** POST /connect — 자격+상점ID → 토큰 발급으로 실제 검증 → 성공 시에만 active 저장. */
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const companyId = await gateCompanyAdmin(req, res);
    if (!companyId) return;

    const shopUid = String(req.body?.shop_uid || '').trim();
    const clientId = String(req.body?.client_id || '').trim();
    const clientSecret = String(req.body?.client_secret || '').trim();
    if (!shopUid) return res.status(400).json({ success: false, error: '상점 ID(shop_uid)는 필수입니다.' });
    if (!clientId || !clientSecret) {
      return res.status(400).json({ success: false, error: 'Client ID와 Client Secret을 모두 입력해주세요.' });
    }

    const { tokenExpiresAt } = await connectMakeshop(companyId, shopUid, { clientId, clientSecret });
    return res.json({ success: true, message: '메이크샵 연동이 완료되었습니다.', shop_uid: shopUid, token_expires_at: tokenExpiresAt });
  } catch (err: any) {
    console.error('[Makeshop /connect] 오류:', err?.message || err);
    return res.status(502).json({
      success: false,
      error: err?.message || '메이크샵 연동 검증에 실패했습니다.',
      hint: '파트너센터 App의 Client ID/Secret과 상점 ID(shop_uid)가 정확한지, App에 회원·주문 Read 권한이 있는지 확인해주세요.',
    });
  }
});

router.get('/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const integration = await getMakeshopIntegration(companyId);
    if (!integration || integration.status === 'revoked') return res.json({ success: true, connected: false });
    return res.json({ success: true, connected: true, shop_uid: integration.shopUid, status: integration.status });
  } catch (err: any) {
    console.error('[Makeshop /status] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

/** GET /preview?days=30 — 최근 회원·주문 raw. ⛔ 스키마 실측 전 CDP 매핑 금지 — 이 응답으로 구조 확정 후 매핑 후속. */
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const companyId = await gateCompanyAdmin(req, res);
    if (!companyId) return;

    const integration = await getMakeshopIntegration(companyId);
    if (!integration || integration.status === 'revoked') {
      return res.status(404).json({ success: false, error: '메이크샵 연동이 없습니다. 먼저 연동해주세요.' });
    }

    const days = Number(req.query.days) || 30;
    const preview = await fetchMakeshopPreview(integration, days);
    // 스키마 실측용 raw 샘플 — PM2 로그로 구조 확인 후 CDP 매핑 확정 (F12 진단 금지 룰 정합)
    console.log(`[Makeshop preview] company=${companyId} shop=${integration.shopUid} from=${preview.from}`);
    // ★ 2026-08-10 — raw → 구조. 회원 응답에는 이름·휴대폰·수신동의가 그대로 들어 있어 로그에 남길 값이 아니다.
    //   매핑 확정에 필요한 키·형식만 남긴다(json-shape CT).
    console.log('[Makeshop preview] membersRaw shape:', describeJsonShape(preview.membersRaw));
    console.log('[Makeshop preview] ordersRaw shape:', describeJsonShape(preview.ordersRaw));
    return res.json({ success: true, ...preview });
  } catch (err: any) {
    console.error('[Makeshop /preview] 오류:', err?.message || err);
    return res.status(502).json({ success: false, error: err?.message || '미리보기 조회 실패' });
  }
});

router.delete('/disconnect', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '연동 해제는 회사 관리자만 가능합니다.' });
    }
    await query(
      `UPDATE company_integrations SET status = 'revoked', updated_at = NOW() WHERE company_id = $1::uuid AND provider = 'makeshop'`,
      [companyId],
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Makeshop /disconnect] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '연동 해제 실패' });
  }
});

export default router;
