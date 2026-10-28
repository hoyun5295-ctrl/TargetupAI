/**
 * ★ 카페24 OAuth + Webhook receiver — D172-B (2026-05-19)
 *
 * Endpoint:
 *   - GET  /api/cafe24/oauth/authorize  : authorize URL 생성 (회사 admin 인증)
 *   - GET  /api/cafe24/oauth/callback   : OAuth callback (카페24 → 한줄로, state 검증 후 토큰 교환)
 *   - GET  /api/cafe24/status           : 현재 회사 카페24 연동 상태 조회 (CdpSettingsPage)
 *   - DELETE /api/cafe24/disconnect     : 연동 해제 (token revoke + DB row status='revoked')
 *   - POST /api/cafe24/webhook          : 카페24 표준 webhook 수신 (idempotency_key + cdp-* CT 자동 호출)
 *
 * 보안:
 *   - authorize/callback/status/disconnect: 회사 admin 인증 (authenticate)
 *   - webhook: X-API-Key 인증(2026-07-03 실측 정정) + 구형 HMAC 하위 호환
 *
 * idempotency:
 *   - 모든 webhook은 cdp_webhook_deliveries 테이블의 (company_id, source, idempotency_key)로 중복 차단
 *   - idempotency_key = `${webhook_event}:${order_id || customer_id || timestamp}` 적용
 */

import { Router, Request, Response, json } from 'express';
import { randomBytes } from 'crypto';
import { serveSdkFile } from '../utils/sdk-serve';
import { authenticate } from '../middlewares/auth';
import { query } from '../config/database';
import { deliverWebhookToCompanies, extractWebhookResource } from '../utils/cdp-webhook-delivery';
import {
  buildCafe24AuthorizeUrl,
  exchangeCafe24Code,
  saveCafe24Integration,
  registerCafe24AllowedOrigins,
  getCafe24Integration,
  getCafe24IntegrationsByMallId,
  verifyCafe24WebhookSignature,
  verifyCafe24WebhookApiKey,
  cafe24Adapter,
  saveCafe24ByoCredentials,
  getCafe24ByoCredentials,
} from '../utils/cafe24-client';
import { ensureCafe24ScriptTag, removeCafe24ScriptTag } from '../utils/cafe24-scripttag';
import { signCafe24InstallState, verifyCafe24InstallState } from '../utils/cafe24-install-state';

import { publicErrorText, respondUserError, UserFacingError } from '../utils/http-error';
import { releaseMallAllowedOrigins } from '../utils/mall-origins';   // ★1028 K12
import { stashPendingApproval, confirmPendingApproval, approvalConfirmUrl } from '../utils/oauth-pending';   // ★1028 M24
import { storeCodeForConnect } from '../utils/integration-scope';   // ★1028 N6 연결 분류코드
const router = Router();

// ════════════════════════════════════════════════════════════════════
// Webhook receiver (인증 미들웨어 전 — 카페24 서명 + idempotency_key로 자체 검증)
// ════════════════════════════════════════════════════════════════════

/**
 * 카페24가 표준 webhook 발화 시점:
 *   - order.created / order.updated / order.cancelled
 *   - customer.created / customer.updated
 *   - product.created (Phase 2)
 *
 * Request body 표준 (카페24):
 *   {
 *     event_no: 12345,
 *     resource: { mall_id, order_id?, member_id?, ... }
 *   }
 */
router.post('/webhook', json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }), async (req: Request, res: Response) => {
  try {
    // ★ 2026-07-03 공식 문서 실측 정정 — 실제 형식: X-API-Key 헤더 인증 + 본문 { event_no, resource }.
    //   이벤트 식별: (구형 가정) X-Cafe24-Event 헤더 하위 호환 → body.event_no 매핑 (CT mapCafe24EventNo).
    const event = cafe24Adapter.extractEventFromWebhook(req.headers as any, req.body || {});
    const mallId = cafe24Adapter.extractMallIdFromWebhook(req.headers as any, req.body || {});

    // 인증 — X-API-Key(실제 방식, .env CAFE24_WEBHOOK_API_KEY) 우선, 구형 HMAC 서명 하위 호환
    const apiKeyHeader = (req.headers['x-api-key'] || req.headers['X-API-Key']) as string | undefined;
    const apiKeyOk = verifyCafe24WebhookApiKey(apiKeyHeader);

    if (!event || !mallId) {
      console.warn('[Cafe24 Webhook] event/mall_id 식별 실패 — event_no:', req.body?.event_no, 'mall_id:', mallId);
      // ★ 2026-10-04 카페24가 보낸(인증된) 웹훅인데 우리 표에 없는 이벤트 번호면 200 으로 받고 무시한다.
      //   400 으로 거절하면 카페24 실패 집계에 쌓이고, "주간 실패 100건+ · 성공률 10% 미만"이면 그 앱의 웹훅 수신 전체가 자동 차단된다
      //   (아래 미연동 몰 200 무시와 같은 이유). 인증 안 된 요청은 종전처럼 400.
      if (apiKeyOk) return res.json({ success: true, ignored: true });
      return res.status(400).json({ success: false, error: 'event 또는 mall_id를 식별할 수 없습니다.' });
    }

    // 회사 식별 (mall_id → company_integrations)
    // ★ 2026-09-27 한줄로 V2 R098 — 같은 몰이 여러 회사에 연동돼 있으면 전부에게 전달한다(옛: LIMIT 1 임의 한 회사).
    const integrations = await getCafe24IntegrationsByMallId(mallId);
    let targets = integrations;

    if (!apiKeyOk) {
      // 구형 HMAC 경로 — 그 회사의 webhook_secret으로 서명이 맞는 연동에만 전달한다
      const signature = (req.headers['x-cafe24-hmac-sha256'] || req.headers['X-Cafe24-Hmac-Sha256']) as string | undefined;
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      targets = integrations.filter((i) => verifyCafe24WebhookSignature(rawBody, signature || '', i.webhookSecret));
      if (targets.length === 0) {
        console.warn('[Cafe24 Webhook] 인증 실패 (X-API-Key/서명 모두 불일치), mall_id=', mallId);
        return res.status(401).json({ success: false, error: '웹훅 인증에 실패했습니다.' });
      }
    }

    if (targets.length === 0) {
      // 인증은 통과(카페24 발신 확인)했으나 미연동 몰 — 개발자센터 TEST(샘플 몰ID)·연동 해제 몰 이벤트가 여기 해당.
      // 404로 거부하면 카페24 실패 집계에 쌓여 "실패 100건+성공률 10% 미만 = 수신 자동 차단" 정책에 걸린다 → 200 무시.
      console.log('[Cafe24 Webhook] 미연동 mall_id — 인증된 요청이라 200 무시:', mallId, 'event:', event);
      return res.json({ success: true, ignored: true });
    }

    // idempotency_key — CT-85 단일 진입점 (엔티티 + 본문 해시 · event_no는 종류 번호라 키로 쓰지 않음 ★0925 C-12)
    const resource = extractWebhookResource('cafe24', req.body || {});
    const idempotencyKey = cafe24Adapter.buildIdempotencyKey(event, resource, req.body || {});

    // ★ 회사마다 전달 행 기록 → 즉시 200 → 처리는 뒤(★ 2026-10-27 자사몰 대비 K2-5 · 처리 = 수신 CT 의 줄 · 재처리 워커가 같은 함수)
    const outcome = await deliverWebhookToCompanies({
      source: 'cafe24',
      companyIds: targets.map((i) => i.companyId),
      event,
      idempotencyKey,
      payload: req.body || {},
      mallId,
      logTag: 'Cafe24',
    });
    if (outcome.recorded === 0 && outcome.duplicate > 0) return res.json({ success: true, duplicate: true });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Cafe24 Webhook] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, 'webhook 처리 실패') });
  }
});

// ★ 2026-09-28 한줄로 V2 R310 — 앱 실행 파라미터 실측 로그(A-0 · POST /launch-log) 제거.
//   확정용 임시 경로였고, 인증 없이 받은 값(사용자 이름 등)을 로그에 남겼다. 화면 호출도 함께 뺐다(Cafe24LaunchPage).

// ════════════════════════════════════════════════════════════════════
// SDK 서빙 (CORS) — 공개(인증 전). ★ 2026-07-08 공용 CT(utils/sdk-serve.ts)로 추출·재사용.
//   서빙 로직·CORS·버전 폴백은 serveSdkFile 단일 정의 — /api/cdp/sdk/·레거시 /sdk/ 와 동일.
// ════════════════════════════════════════════════════════════════════
router.get('/sdk/:version/hanjul.min.js', serveSdkFile);

// ════════════════════════════════════════════════════════════════════
// 회사 admin 인증 — authorize / callback / status / disconnect
// ════════════════════════════════════════════════════════════════════

router.use(authenticate);

/**
 * GET /api/cafe24/oauth/authorize?mall_id=...
 * → CdpSettingsPage가 새 창으로 열어 사용자가 카페24 인증.
 * state = base64(JSON({ company_id, csrf_nonce, ts })) — callback에서 검증.
 */
router.get('/oauth/authorize', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') return res.status(403).json({ success: false, error: '카페24 연동은 회사 관리자만 가능합니다.' });

    // ★ 2026-07-03 A-3(Harold 확정): FREE(미가입) 계정도 카페24 OAuth 연동 "시작"을 허용한다.
    //   심사위원 동선 = 신규 가입 FREE 상태로 앱 실행 → 여기서 403이면 심사 반려 위험.
    //   요금제 게이팅(isCdpEnabledForPlan)은 SDK/webhook ingest 경로(cdp-auth)에 그대로 유지 — 연동 시작만 개방.
    //   남용은 이벤트 ingest 월 한도(isOverMonthlyCdpLimit)가 별도 통제 + 연동에는 로그인·OAuth 동의가 필수라 무해.

    const mallId = String(req.query.mall_id || '').trim().toLowerCase();
    if (!mallId || !/^[a-z0-9_-]+$/i.test(mallId)) {
      return res.status(400).json({ success: false, error: 'mall_id 형식이 올바르지 않습니다.' });
    }

    const storeCode = await storeCodeForConnect(req.user, req.query.store_code);   // ★1028 N6 분류코드(확정 때 그 값으로 저장)
    const csrfNonce = randomBytes(16).toString('hex');
    // state 저장 (10분 TTL — Phase 2에서 Redis 검토)
    await query(
      `INSERT INTO cdp_webhook_deliveries (
        id, company_id, source, webhook_event, idempotency_key, payload, status, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, 'cafe24', 'oauth_state', $2, $3::jsonb, 'received', NOW()
      )
      ON CONFLICT (company_id, source, idempotency_key) DO UPDATE SET
        payload = EXCLUDED.payload,
        created_at = NOW()`,
      [companyId, `state:${csrfNonce}`, JSON.stringify({ mall_id: mallId, nonce: csrfNonce, store_code: storeCode })]
    );

    const state = Buffer.from(JSON.stringify({ company_id: companyId, nonce: csrfNonce, ts: Date.now() })).toString('base64url');
    const byoCreds = await getCafe24ByoCredentials(companyId, mallId);
    const authorizeUrl = buildCafe24AuthorizeUrl(mallId, state, undefined, byoCreds);
    return res.json({ success: true, authorize_url: authorizeUrl });
  } catch (err: any) {
    console.error('[Cafe24 /oauth/authorize] 오류:', err);
    if (respondUserError(res, err)) return;   // ★1028 N6 분류코드 거절(고객 문장)
    return res.status(500).json({ success: false, error: publicErrorText(err, 'authorize URL 생성 실패') });
  }
});

/**
 * GET /api/cafe24/oauth/callback?code=...&state=...
 * → 카페24가 redirect_uri로 호출. state 검증 후 토큰 교환 + DB 저장 + 종료 페이지 HTML 응답.
 *
 * NOTE: 본 endpoint는 카페24가 호출 (사용자 브라우저 redirect)이므로 authenticate 우회.
 * authenticate 미들웨어가 위에 걸려 있어 이 endpoint는 ★ authenticate 통과 못 함 — 별도 라우터 분리 필요.
 * → 해결: callback은 이 라우터 등록 전에 별도 endpoint로 둠 (아래 보조 라우터가 담당).
 */
router.get('/oauth/callback', (_req: Request, res: Response) => {
  // 이 경로는 callbackRouter (아래)가 먼저 매칭되어야 정합.
  // 만약 본 핸들러에 도달했다면 라우터 등록 순서 오류.
  return res.status(500).send('카페24 OAuth callback 라우터 등록 순서 오류. 운영 점검 필요.');
});

/**
 * POST /api/cafe24/oauth/confirm  body { confirm }
 * ★ 2026-10-28 자사몰 대비 M24 — 승인 콜백이 담아 둔 미확정 토큰을 로그인된 회사 관리자가 확정한다(JWT 회사 = 승인을 시작한 회사 · 확정 표 = 콜백을 받은 브라우저만).
 */
router.post('/oauth/confirm', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (req.user?.userType !== 'company_admin') return res.status(403).json({ success: false, error: '카페24 연동은 회사 관리자만 가능합니다.' });
    // 승인 행 잠금 → 풀기 → 연동 저장 → 승인 행 지우기(한 트랜잭션 · 저장이 실패하면 승인 행이 남아 다시 확정할 수 있다)
    const done = await confirmPendingApproval(companyId, 'cafe24', String(req.body?.confirm || ''), async (state, pending, run) => {
      const mall = String(state.mall_id || '');
      if (!mall) throw new UserFacingError(400, 'OAUTH_CONFIRM_INVALID', '승인 상태가 올바르지 않아요. 자사몰 연동에서 다시 연결해 주세요.');
      await saveCafe24Integration(companyId, mall, pending, null, typeof state.store_code === 'string' ? state.store_code : null, run);
      return mall;
    });
    if (!done) return res.status(400).json({ success: false, error: '승인 확인 시간이 지났거나 이 계정이 시작한 연결이 아니에요. 자사몰 연동에서 다시 연결해 주세요.', code: 'OAUTH_CONFIRM_INVALID' });
    const mallId = done.result;
    await registerCafe24AllowedOrigins(companyId, mallId);   // 커밋 뒤(K12 · 확정 트랜잭션 밖)
    // ★ 2026-07-03 B-2: 연동 성공 직후 SDK scripttag 자동삽입 (fire-and-forget — 실패해도 연동은 성공).
    //   mall.write_application scope(B-1) 필요 — 재연동 후에만 성공. raw 응답은 [Cafe24 ScriptTag] 로그로 실측.
    ensureCafe24ScriptTag(companyId, mallId).catch((e: any) =>
      console.log('[Cafe24 confirm] scripttag 자동삽입 실패(연동은 성공):', e?.message || e),
    );
    return res.json({ success: true, mall_id: mallId });
  } catch (err: any) {
    console.error('[Cafe24 /oauth/confirm] 오류:', err);
    if (respondUserError(res, err)) return;   // 분류코드 모드 거절(409 · 고객 문장)
    return res.status(500).json({ success: false, error: publicErrorText(err, '카페24 연결 확정 실패') });
  }
});

/**
 * POST /api/cafe24/byo-credentials
 * → 고객이 입력한 self-app client_id/secret/mall_id 저장(OAuth 전). 이후 /oauth/authorize로 연결.
 */
router.post('/byo-credentials', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') return res.status(403).json({ success: false, error: '카페24 연동은 회사 관리자만 가능합니다.' });

    const mallId = String(req.body?.mall_id || '').trim().toLowerCase();
    const clientId = String(req.body?.client_id || '').trim();
    const clientSecret = String(req.body?.client_secret || '').trim();
    if (!mallId || !/^[a-z0-9_-]+$/i.test(mallId)) {
      return res.status(400).json({ success: false, error: 'mall_id 형식이 올바르지 않습니다.' });
    }
    if (!clientId || !clientSecret) {
      return res.status(400).json({ success: false, error: 'client_id / client_secret을 모두 입력해주세요.' });
    }

    const storeCode = await storeCodeForConnect(req.user, req.body?.store_code);   // ★1028 N6
    await saveCafe24ByoCredentials(companyId, mallId, clientId, clientSecret, storeCode);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Cafe24 /byo-credentials] 오류:', err);
    if (respondUserError(res, err)) return;   // ★ 2026-10-27 자사몰 대비 K9 SC1 — 분류코드 모드 거절(409 · 고객 문장)
    return res.status(500).json({ success: false, error: publicErrorText(err, 'self-app 자격 저장 실패') });
  }
});

/**
 * GET /api/cafe24/status
 * → 현재 회사 카페24 연동 상태 (CdpSettingsPage 표시).
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

    const integration = await getCafe24Integration(companyId);
    // ★ 2026-07-03 fix: getCafe24Integration은 status 무관 반환 → 해제(revoked)·미완료(pending_oauth) 행도 있었다.
    //   active만 connected로 응답해야 연동 해제가 화면에 반영되고 재연동 흐름이 복구된다.
    if (!integration || integration.status !== 'active') {
      // ★ 2026-08-10 — 사유를 함께 돌려준다. 옛 응답은 `connected:false` 하나뿐이라
      //   **토큰이 만료된 연동과 아예 연결한 적 없는 상태가 화면에서 같아 보였다**(둘 다 "아직 연결 전").
      //   `status='token_expired'`는 refresh 실패 시 cafe24-client가 기록하는 실값이다 — 재연결이 필요한 상태이므로
      //   화면이 그것을 '조치 필요'로 말할 수 있어야 한다. `connected`는 그대로 false(기존 소비처 무영향).
      return res.json({ success: true, connected: false, status: integration?.status ?? null, mall_id: integration?.mallId ?? null });   // ★1028 N3 재연결 미리 채움
    }
    return res.json({
      success: true,
      connected: true,
      mall_id: integration.mallId,
      status: integration.status,
      token_expires_at: integration.tokenExpiresAt,
      scope: integration.scope,
    });
  } catch (err: any) {
    console.error('[Cafe24 /status] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
  }
});

/**
 * DELETE /api/cafe24/disconnect
 * → 연동 해제 (회사 admin). DB row status='revoked'. 카페24 측 revoke API는 Phase 2.
 */
router.delete('/disconnect', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') return res.status(403).json({ success: false, error: '연동 해제는 회사 관리자만 가능합니다.' });

    // ★ 2026-07-03 B-2: 해제 전(토큰 유효 상태) scripttag 제거 — fire-and-forget
    const integ = await getCafe24Integration(companyId);
    if (integ?.mallId) {
      removeCafe24ScriptTag(companyId, integ.mallId).catch(() => {});
    }

    const revoked = await query(
      `UPDATE company_integrations
       SET status = 'revoked', updated_at = NOW()
       WHERE company_id = $1::uuid AND provider = 'cafe24'
       RETURNING mall_id`,
      [companyId]
    );
    // ★ 1028 K12 — 그 몰들이 넣은 수집 허용 도메인만 뺀다(손 등록 · 다른 몰 값 불변 · 실패해도 해제는 그대로)
    for (const r of revoked.rows) {
      await releaseMallAllowedOrigins(companyId, 'cafe24', r.mall_id).catch((e: any) => console.warn(`[Cafe24 /disconnect] 수집 허용 도메인 정리 실패 mall=${r.mall_id}: ${e?.message || e}`));
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Cafe24 /disconnect] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '연동 해제 실패') });
  }
});

export default router;

// ════════════════════════════════════════════════════════════════════
// 별도 callback 라우터 — authenticate 우회 (카페24가 브라우저 redirect로 호출)
// app.ts에 router보다 먼저 등록
// ════════════════════════════════════════════════════════════════════

export const cafe24CallbackRouter = Router();

/**
 * GET /api/cafe24/oauth/install-start?mall_id=...
 * → 계정(로그인) 없이 카페24 OAuth를 시작한다(앱스토어 설치·심사 동선). state = HMAC 서명된 install state.
 *   authenticate 우회(공개) — 본 라우터가 authenticate 라우터보다 app.ts에서 먼저 마운트됨.
 *   mall_id는 정규식 검증(SSRF/오픈리다이렉트 방어) 후 authorize URL의 서브도메인으로만 사용.
 */
cafe24CallbackRouter.get('/oauth/install-start', (req: Request, res: Response) => {
  try {
    const mallId = String(req.query.mall_id || '').trim().toLowerCase();
    if (!mallId || !/^[a-z0-9_-]+$/.test(mallId)) {
      return res.status(400).send(renderCafe24CallbackHtml('error', 'mall_id 형식이 올바르지 않습니다.'));
    }
    const state = signCafe24InstallState(mallId, Date.now());
    const authorizeUrl = buildCafe24AuthorizeUrl(mallId, state);
    return res.redirect(302, authorizeUrl);
  } catch (err: any) {
    console.error('[Cafe24 /oauth/install-start] 오류:', err);
    return res.status(500).send(renderCafe24CallbackHtml('error', publicErrorText(err, '카페24 연동 시작에 실패했습니다.')));
  }
});

cafe24CallbackRouter.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code || '');
    const stateRaw = String(req.query.state || '');
    if (!code || !stateRaw) {
      return res.status(400).send(renderCafe24CallbackHtml('error', '카페24가 보낸 응답에 code 또는 state가 누락되었습니다.'));
    }

    // ★ 2026-07-05 설치(앱스토어·심사) 동선 — 로그인 없이 시작한 install state(HMAC 서명).
    //   토큰 교환(=설치 인증)만 하고 회사에 저장하지 않는다. 카페24 앱은 계약 고객의 자사몰 연동 도구라
    //   계정 자동생성·발송은 없음(선 계약 후 발급 모델 유지). 기존 고객은 로그인 후 자사몰 연동에서 연결.
    const installState = verifyCafe24InstallState(stateRaw);
    if (installState) {
      await exchangeCafe24Code(installState.mallId, code); // env 자격으로 교환 → 설치 인증 완료
      console.log('[Cafe24 install] OAuth 설치 인증 완료 mall_id=', installState.mallId);
      return res.send(renderCafe24CallbackHtml(
        'ok',
        `${installState.mallId} 쇼핑몰 설치·인증이 완료되었습니다. 한줄로는 사전 계약 후 이용하는 서비스로, 이미 한줄로를 이용 중이시면 로그인 후 자사몰 연동에서 이 몰을 연결하실 수 있습니다.`,
      ));
    }

    let parsed: { company_id?: string; nonce?: string; ts?: number };
    try {
      parsed = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
    } catch {
      return res.status(400).send(renderCafe24CallbackHtml('error', 'state 검증 실패 (변조 의심).'));
    }
    if (!parsed.company_id || !parsed.nonce) {
      return res.status(400).send(renderCafe24CallbackHtml('error', 'state 형식이 올바르지 않습니다.'));
    }
    // state TTL 10분
    if (!parsed.ts || Date.now() - parsed.ts > 10 * 60 * 1000) {
      return res.status(400).send(renderCafe24CallbackHtml('error', 'OAuth 세션이 만료되었습니다. 다시 시도해주세요.'));
    }

    // DB에 저장된 nonce 확인
    const stateRow = await query(
      `SELECT payload FROM cdp_webhook_deliveries
       WHERE company_id = $1::uuid AND source = 'cafe24'
         AND webhook_event = 'oauth_state' AND idempotency_key = $2
       LIMIT 1`,
      [parsed.company_id, `state:${parsed.nonce}`]
    );
    if (stateRow.rows.length === 0) {
      return res.status(400).send(renderCafe24CallbackHtml('error', 'state 검증 실패 (재시도 또는 변조 의심).'));
    }
    const payload = stateRow.rows[0].payload as { mall_id?: string };
    const mallId = payload?.mall_id;
    if (!mallId) {
      return res.status(400).send(renderCafe24CallbackHtml('error', 'state에 mall_id가 누락되었습니다.'));
    }

    // 토큰 교환 — 회사 self-app 자격(없으면 env)으로
    const byoCreds = await getCafe24ByoCredentials(parsed.company_id, mallId);
    const tokenRes = await exchangeCafe24Code(mallId, code, byoCreds);

    // ★ 2026-10-28 자사몰 대비 M24 — 연동 행에 바로 넣지 않는다(콜백엔 로그인 정보가 없다 · 남이 시작한 승인 링크를 몰 주인이 누르면 그 몰이 남의 회사에 묶였다).
    //   미확정으로 담고(암호문 · 그 승인 행) 로그인된 화면으로 돌려보낸다 → 화면이 그 회사 관리자로 확정해야 저장 · 스크립트 설치(POST /oauth/confirm).
    const confirm = await stashPendingApproval(parsed.company_id, 'cafe24', parsed.nonce, tokenRes);
    return res.redirect(302, approvalConfirmUrl('cafe24', confirm));
  } catch (err: any) {
    console.error('[Cafe24 callback] 오류:', err);
    return res.status(500).send(renderCafe24CallbackHtml('error', publicErrorText(err, '카페24 연동 처리 중 오류가 발생했습니다.')));
  }
});

// ════════════════════════════════════════════════════════════════════
// callback HTML 응답 (사용자가 새 창에서 보는 화면)
// ════════════════════════════════════════════════════════════════════

function renderCafe24CallbackHtml(status: 'ok' | 'error', message: string): string {
  const color = status === 'ok' ? '#059669' : '#dc2626';
  const icon = status === 'ok' ? '✓' : '✕';
  const title = status === 'ok' ? '카페24 연동 완료' : '카페24 연동 실패';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>한줄로 · ${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 60px 20px; }
  .card { max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); text-align: center; }
  .icon { font-size: 48px; color: ${color}; margin-bottom: 16px; }
  h1 { color: #111827; font-size: 20px; margin: 0 0 12px; }
  p { color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0; }
  .footer { margin-top: 24px; font-size: 12px; color: #9ca3af; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>${escapeHtml(message)}</p>
  <div class="footer">본 창을 닫으시면 한줄로AI로 돌아가실 수 있습니다.</div>
</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
