/**
 * ★ 네이버 스마트스토어 (커머스 API) 연동 + Webhook receiver — D178 신설 / ★ 2026-07-06 인증 전면 재작성
 *
 * 인증 모델 (2026-07-06 서버 실측 확정 — 옛 authorization_code OAuth 라우트 전면 폐기):
 *   커머스 API = client_credentials + bcrypt 전자서명. authorize/callback 리다이렉트 없음.
 *   연동 = 자격 입력 → 토큰 발급으로 "실제 검증" 성공 시에만 active (6원칙 ② — 고도몰 선례 미러).
 *
 * Endpoint:
 *   - POST /api/naver-commerce/connect        : store_id + client_id/secret → 토큰 발급 검증 후 연동 (회사 admin)
 *   - GET  /api/naver-commerce/status         : 연동 상태
 *   - GET  /api/naver-commerce/orders/preview : 최근 N시간(≤24) 주문 raw 미리보기 — 스키마 실측용 (회사 admin)
 *   - DELETE /api/naver-commerce/disconnect   : 연동 해제
 *   - POST /api/naver-commerce/webhook        : webhook 수신 (서명 + idempotency_key)
 *
 * 사전조건: 네이버 커머스 API센터 앱 "API 호출 IP"에 한줄로 서버 egress IP 등록.
 *   ★ 보안 — 서버 IP는 코드/화면/응답 어디에도 리터럴로 두지 않는다(전 고객사 인지 = 공격 표면).
 *   실제 연동 업체만 SDK 연동 담당자가 개별 안내. 담당자는 서버에서 `curl -s https://api.ipify.org`로 확인.
 */

import { Router, Request, Response, json } from 'express';
import { authenticate } from '../middlewares/auth';
import { query } from '../config/database';
import {
  connectNaverCommerce,
  getNaverCommerceIntegration,
  getNaverCommerceIntegrationByStoreId,
  verifyNaverCommerceWebhookSignature,
  naverSmartStoreAdapter,
  fetchRecentNaverOrdersPreview,
} from '../utils/naver-commerce-client';
import { isCdpEnabledForPlan } from '../utils/cdp-auth';
// ★ 2026-08-10: 스키마 실측 로그는 값이 아니라 구조로 남긴다(개인정보 미기록)
import { describeJsonShape } from '../utils/json-shape';

const router = Router();

// ════════════════════════════════════════════════════════════════════
// Webhook receiver (인증 미들웨어 전 — 서명 + idempotency_key로 자체 검증)
// ════════════════════════════════════════════════════════════════════

router.post(
  '/webhook',
  json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }),
  async (req: Request, res: Response) => {
    try {
      const event = (req.headers['x-naver-event']) as string | undefined;
      const signature = (req.headers['x-naver-signature']) as string | undefined;
      const storeId = (req.headers['x-naver-store-id'] || req.body?.store_id || req.body?.resource?.store_id) as string | undefined;

      if (!event || !storeId) {
        return res.status(400).json({ success: false, error: 'X-Naver-Event 또는 store_id가 누락되었습니다.' });
      }

      const integration = await getNaverCommerceIntegrationByStoreId(String(storeId));
      if (!integration) {
        console.warn('[NaverCommerce Webhook] 미연동 store_id, 무시:', storeId);
        return res.status(404).json({ success: false, error: '연동된 store_id가 없습니다.' });
      }

      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      const isValid = verifyNaverCommerceWebhookSignature(rawBody, signature || '', integration.webhookSecret);
      if (!isValid) {
        console.warn('[NaverCommerce Webhook] 서명 검증 실패, store=', storeId);
        return res.status(401).json({ success: false, error: '서명 검증에 실패했습니다.' });
      }

      const resource = req.body?.resource || req.body || {};
      const idempotencyKey = naverSmartStoreAdapter.buildIdempotencyKey(event, resource, req.body || {});

      const insertRes = await query(
        `INSERT INTO cdp_webhook_deliveries (
          id, company_id, source, webhook_event, idempotency_key, payload, status, retry_count, created_at
        ) VALUES (
          gen_random_uuid(), $1::uuid, 'naver_smart_store', $2, $3, $4::jsonb, 'received', 0, NOW()
        )
        ON CONFLICT (company_id, source, idempotency_key) DO NOTHING
        RETURNING id`,
        [integration.companyId, event, idempotencyKey, JSON.stringify(req.body || {})]
      );

      if (insertRes.rows.length === 0) {
        // 2026-06-10 정정: updated_at은 cdp_webhook_deliveries에 없는 컬럼(실측) — 포함 시 중복 응답이 전부 500
        await query(
          `UPDATE cdp_webhook_deliveries
           SET status = 'duplicate', processed_at = NOW()
           WHERE company_id = $1::uuid AND source = 'naver_smart_store' AND idempotency_key = $2`,
          [integration.companyId, idempotencyKey]
        );
        return res.json({ success: true, duplicate: true });
      }

      const deliveryId = insertRes.rows[0].id;

      try {
        await naverSmartStoreAdapter.processWebhookEvent(integration.companyId, event, resource);
        await query(
          `UPDATE cdp_webhook_deliveries SET status = 'processed', processed_at = NOW() WHERE id = $1::uuid`,
          [deliveryId]
        );
        return res.json({ success: true });
      } catch (processErr: any) {
        console.error('[NaverCommerce Webhook] 이벤트 처리 실패:', processErr);
        await query(
          `UPDATE cdp_webhook_deliveries
           SET status = 'failed', error_message = $2, processed_at = NOW()
           WHERE id = $1::uuid`,
          [deliveryId, String(processErr?.message || 'unknown').slice(0, 1000)]
        );
        return res.json({ success: false, error: '이벤트 처리 실패' });
      }
    } catch (err: any) {
      console.error('[NaverCommerce Webhook] 오류:', err);
      return res.status(500).json({ success: false, error: err?.message || 'webhook 처리 실패' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════
// 회사 admin 인증 endpoint
// ════════════════════════════════════════════════════════════════════

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
    res.status(403).json({ success: false, error: '네이버 스마트스토어 연동은 회사 관리자만 가능합니다.' });
    return null;
  }
  const cdpEnabled = await isCdpEnabledForPlan(companyId);
  if (!cdpEnabled) {
    res.status(403).json({
      success: false,
      error: '네이버 스마트스토어 연동은 유료 요금제 가입 후 이용 가능합니다.',
      code: 'PLAN_FEATURE_LOCKED',
    });
    return null;
  }
  return companyId;
}

/**
 * POST /connect — 자격 입력 → 토큰 발급으로 실제 검증 → 성공 시에만 active 저장.
 * 실패는 네이버 오류 메시지 그대로 반환 (IP 미등록 / 자격 오류 / 서명 오류가 메시지로 구분됨).
 */
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const companyId = await gateCompanyAdmin(req, res);
    if (!companyId) return;

    const storeId = String(req.body?.store_id || '').trim();
    const clientId = String(req.body?.client_id || '').trim();
    const clientSecret = String(req.body?.client_secret || '').trim();
    if (!storeId) return res.status(400).json({ success: false, error: 'store_id는 필수입니다.' });
    if (!clientId || !clientSecret) {
      return res.status(400).json({ success: false, error: '애플리케이션 ID(client_id)와 시크릿(client_secret)을 모두 입력해주세요.' });
    }

    const { tokenExpiresAt } = await connectNaverCommerce(companyId, storeId, { clientId, clientSecret });
    return res.json({
      success: true,
      message: '네이버 스마트스토어 연동이 완료되었습니다.',
      store_id: storeId,
      token_expires_at: tokenExpiresAt,
    });
  } catch (err: any) {
    console.error('[NaverCommerce /connect] 오류:', err?.message || err);
    // 토큰 발급 실패 = 외부 검증 실패 — 원인 메시지를 그대로 전달해 사용자가 스스로 교정 가능하게
    // ★ 보안: 서버 IP는 응답에 노출하지 않는다 — 담당자 개별 안내.
    return res.status(502).json({
      success: false,
      error: err?.message || '네이버 커머스 연동 검증에 실패했습니다.',
      hint: '커머스 API센터 앱의 "API 호출 IP"에 한줄로 서버 IP가 등록되어 있는지(등록 IP는 SDK 연동 담당자에게 문의), 애플리케이션 ID/시크릿이 정확한지 확인해주세요.',
    });
  }
});

router.get('/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const integration = await getNaverCommerceIntegration(companyId);
    if (!integration || integration.status === 'revoked') return res.json({ success: true, connected: false });
    return res.json({
      success: true,
      connected: true,
      store_id: integration.storeId,
      status: integration.status,
      token_expires_at: integration.tokenExpiresAt,
    });
  } catch (err: any) {
    console.error('[NaverCommerce /status] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

/**
 * GET /orders/preview?hours=24 — 최근 변경 주문 raw 미리보기.
 * ⛔ 스키마 실측 전 CDP 매핑 금지(영구 룰) — 이 응답으로 구조를 확정한 뒤 매핑을 후속으로 붙인다.
 */
router.get('/orders/preview', async (req: Request, res: Response) => {
  try {
    const companyId = await gateCompanyAdmin(req, res);
    if (!companyId) return;

    const integration = await getNaverCommerceIntegration(companyId);
    if (!integration || integration.status === 'revoked') {
      return res.status(404).json({ success: false, error: '네이버 스마트스토어 연동이 없습니다. 먼저 연동해주세요.' });
    }

    const hours = Number(req.query.hours) || 24;
    const preview = await fetchRecentNaverOrdersPreview(integration, hours);
    console.log(`[NaverCommerce preview] company=${companyId} store=${integration.storeId} from=${preview.from} ids=${preview.idCount}`);
    // ★ 2026-08-10 — 스키마 실측용 출력을 raw에서 **구조**로 바꿨다.
    //   옛 로그는 응답을 그대로 찍어 구매자 성명·휴대폰이 PM2 로그에 쌓였고, 그 줄을 옮겨 적으면 개인정보가 함께 따라갔다.
    //   매핑에 필요한 것은 키 이름과 형식뿐이라 값은 마스킹한다(json-shape CT).
    console.log('[NaverCommerce preview] detailsRaw shape:', describeJsonShape(preview.detailsRaw));
    return res.json({ success: true, ...preview });
  } catch (err: any) {
    console.error('[NaverCommerce /orders/preview] 오류:', err?.message || err);
    return res.status(502).json({ success: false, error: err?.message || '주문 미리보기 조회 실패' });
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
      `UPDATE company_integrations
       SET status = 'revoked', updated_at = NOW()
       WHERE company_id = $1::uuid AND provider = 'naver_smart_store'`,
      [companyId]
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[NaverCommerce /disconnect] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '연동 해제 실패' });
  }
});

export default router;
