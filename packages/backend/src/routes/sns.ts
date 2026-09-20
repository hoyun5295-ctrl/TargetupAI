/**
 * routes/sns.ts — SNS 게시 라우트 (2026-09-20 S1)
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-2 · §3-10 · §3-11
 *
 * Endpoint(S1):
 *   - GET  /api/sns/overview                     : 화면 1콜(enabled · 계정 목록 · 채널 규격)
 *   - GET  /api/sns/specs                        : 어댑터 capabilities 직렬화(추론 0)
 *   - POST /api/sns/auth/start/:platform         : state 발급 + authorize URL
 *   - POST /api/sns/accounts/:id/disconnect      : 해제(revoked · 행 DELETE 0)
 *   - POST /api/sns/accounts/:id/reconnect       : 재승인 시작(= auth/start 와 같은 흐름)
 *   - GET  /api/sns/auth/callback/:platform      : **공개** · state 검증·소비 → 토큰 교환 → pending → 복귀 HTML
 *   - POST /api/sns/deauthorize/:platform        : **공개** · 플랫폼 권한 회수 콜백(서명 검증)
 *
 * 게이트 순서(§2-16) = 인증 → `requirePlanFeature('sns_publish')`(FREE 만 차단) → ENV 판정.
 *   ⛔ ENV 미개방 유료 회사는 403 빈 화면이 아니라 `준비 중` 화면 1장을 받는다 —
 *      그래서 `overview` 만 ENV 게이트를 통과시키고 `enabled:false` 로 답한다.
 *
 * 공개 라우터(`snsPublicRouter`)는 helmet **앞**에 마운트한다(app.ts:204 선례) —
 *   복귀 HTML 이 인라인 스크립트를 쓰기 때문이다. CSP 뒤에 두면 창이 안 닫힌다.
 */

import { Router, Request, Response, urlencoded } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { authenticate } from '../middlewares/auth';
import { query } from '../config/database';
import { requirePlanFeature } from '../utils/plan-guard';
import { snsPublishEnabled, isSnsPlatform, SNS_OAUTH_STATE_TTL_MS, SNS_ERROR_CODES, type SnsPlatform } from '../utils/sns-constants';
import { signSnsState, verifySnsState } from '../utils/sns-auth-state';
import { getSnsAdapter, listSnsAdapters, SnsAdapterError } from '../utils/sns';
import {
  listSnsAccounts, getSnsAccount, upsertPendingAccount, applyAccountProfile,
  setSnsAccountStatus, revokeSnsAccount, resolveSnsCredentials, toAccountCard, isMissingSnsTable,
} from '../utils/sns-accounts';

const router = Router();
export const snsPublicRouter = Router();

/** 복귀 창이 `postMessage` 를 보낼 대상 origin — `'*'` 금지(§3-10). */
function appOrigin(): string {
  const first = String(process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)[0];
  return first || 'https://hanjul.ai';
}

/** 테이블 미생성이면 500 대신 안내 — 마이그레이션 전 배포에서 화면이 죽지 않게(`db_alter_safety_net`). */
function sendDbPending(res: Response) {
  return res.status(503).json({
    success: false,
    code: 'DB_MIGRATION_PENDING',
    error: 'DB 마이그레이션 필요: sns_accounts 외 4개 테이블 생성 SQL 실행 요청',
  });
}

/** 어댑터 오류를 사람이 읽는 한 줄로. 원문은 서버 로그에 남긴다(사유를 버리지 않는다). */
function adapterErrorMessage(err: unknown): string {
  if (err instanceof SnsAdapterError) {
    return err.message || '채널 연결 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.';
  }
  return '채널 연결 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.';
}

// ───────────────────────────────── 인증 구간 ─────────────────────────────────

router.use(authenticate);
router.use(requirePlanFeature('sns_publish'));

/** 채널 규격 — 어댑터가 선언한 값 그대로. 화면은 이 값만 보고 추론하지 않는다(§3-3). */
function specsPayload() {
  return listSnsAdapters().map((a) => ({
    platform: a.platform,
    label: a.label,
    available: a.available,
    capabilities: a.capabilities,
  }));
}

router.get('/specs', (_req: Request, res: Response) => {
  return res.json({ success: true, specs: specsPayload() });
});

/**
 * 화면 1콜. **ENV 게이트를 여기서 막지 않는다** — 미개방 회사도 `준비 중` 화면을 그려야 하므로
 * `enabled:false` 를 실어 보낸다(§2-16 · 403 빈 화면 0).
 */
router.get('/overview', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const enabled = snsPublishEnabled(companyId);
  if (!enabled) {
    return res.json({ success: true, enabled: false, accounts: [], specs: specsPayload() });
  }
  try {
    const rows = await listSnsAccounts(companyId);
    return res.json({
      success: true,
      enabled: true,
      accounts: rows.map(toAccountCard),
      specs: specsPayload(),
    });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS overview] 오류:', err);
    return res.status(500).json({ success: false, error: '계정 정보를 불러오지 못했습니다.' });
  }
});

/** ENV 게이트 — overview·specs 를 제외한 나머지. */
router.use((req: Request, res: Response, next) => {
  const companyId = (req as any).user?.companyId as string;
  if (!snsPublishEnabled(companyId)) {
    return res.status(403).json({ success: false, code: 'SNS_NOT_OPENED', error: '아직 열리지 않은 기능이에요.' });
  }
  next();
});

/**
 * 연결 시작 — state 를 서명해 발급하고 `sns_oauth_states` 에 1회용 행을 남긴다.
 * 두 겹인 이유 = 서명(위조 차단) + DB 행(재사용 차단). §3-10.
 */
router.post('/auth/start/:platform', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const userId = (req as any).user?.id ?? null;
  const platform = req.params.platform;
  if (!isSnsPlatform(platform)) {
    return res.status(400).json({ success: false, error: '알 수 없는 채널입니다.' });
  }
  const adapter = getSnsAdapter(platform);
  if (!adapter || !adapter.available) {
    return res.status(400).json({ success: false, error: '아직 준비 중인 채널이에요.' });
  }
  const creds = resolveSnsCredentials(platform);
  if (!creds.ok) {
    return res.status(503).json({ success: false, code: 'SNS_CREDENTIALS_MISSING', error: creds.reason });
  }

  const nonce = randomUUID();
  try {
    await query(
      `INSERT INTO sns_oauth_states (state_nonce, company_id, platform, created_by, payload, expires_at)
       VALUES ($1, $2::uuid, $3, $4::uuid, $5::jsonb, NOW() + ($6 || ' milliseconds')::interval)`,
      [nonce, companyId, platform, userId, JSON.stringify({}), String(SNS_OAUTH_STATE_TTL_MS)],
    );
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS auth/start] state 저장 오류:', err);
    return res.status(500).json({ success: false, error: '연결을 시작하지 못했습니다.' });
  }

  const state = signSnsState({ companyId, platform, nonce, ts: Date.now() });
  return res.json({
    success: true,
    authorizeUrl: adapter.buildAuthorizeUrl(creds.credentials, state),
    stateNonce: nonce,
  });
});

/** 해제 — 행은 남기고 토큰만 지운다(§3-1). 이력이 이 행을 참조한다. */
router.post('/accounts/:id/disconnect', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const row = await revokeSnsAccount(companyId, String(req.params.id));
    if (!row) return res.status(404).json({ success: false, error: '계정을 찾을 수 없습니다.' });
    return res.json({ success: true, account: toAccountCard(row) });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS disconnect] 오류:', err);
    return res.status(500).json({ success: false, error: '연결을 해제하지 못했습니다.' });
  }
});

/** 재연결 — 소유 확인만 하고 시작 흐름은 auth/start 와 같다(화면이 그 URL 로 새 창을 연다). */
router.post('/accounts/:id/reconnect', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const row = await getSnsAccount(companyId, String(req.params.id));
    if (!row) return res.status(404).json({ success: false, error: '계정을 찾을 수 없습니다.' });
    return res.json({ success: true, platform: row.platform });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS reconnect] 오류:', err);
    return res.status(500).json({ success: false, error: '요청을 처리하지 못했습니다.' });
  }
});

// ───────────────────────────────── 공개 구간 ─────────────────────────────────

/**
 * 승인 복귀 — **공개**. state 검증 → 1회용 소비 → 토큰 교환 → `pending` 저장 → 복귀 HTML.
 * 프로필 재조회는 **응답 뒤** `void async` 로 돈다(§3-10) — 창이 플랫폼 응답을 기다리며 멈추지 않게.
 */
snsPublicRouter.get('/auth/callback/:platform', async (req: Request, res: Response) => {
  const platform = req.params.platform;
  if (!isSnsPlatform(platform)) {
    return res.status(400).send(renderSnsReturnHtml('error', '알 수 없는 채널입니다.', null, null, null));
  }
  const st = verifySnsState(req.query.state);
  // 경로 platform 과 state 안의 platform 이 다르면 위조다.
  if (!st || st.platform !== platform) {
    return res.status(400).send(renderSnsReturnHtml('error', '연결 정보를 확인할 수 없습니다. 한줄로 화면에서 다시 시도해 주세요.', platform, null, null));
  }
  const code = String(req.query.code || '');
  if (!code) {
    const denied = String(req.query.error_description || req.query.error || '');
    return res.send(renderSnsReturnHtml('error', denied ? `연결이 취소되었습니다. (${denied})` : '연결이 취소되었습니다. 이 창을 닫고 다시 시도해 주세요.', platform, null, st.nonce));
  }

  // 1회용 소비 — 0행이면 이미 쓴 state 이거나 만료다.
  // 누가 시작했는지는 이 행만 안다(공개 라우터라 세션이 없다). 원장에 남기려면 여기서 꺼내야 한다.
  let startedBy: string | null = null;
  try {
    const used = await query(
      `DELETE FROM sns_oauth_states
        WHERE state_nonce = $1 AND company_id = $2::uuid AND expires_at > NOW()
        RETURNING state_nonce, created_by`,
      [st.nonce, st.companyId],
    );
    if (used.rowCount === 0) {
      return res.status(400).send(renderSnsReturnHtml('error', '연결 요청이 만료되었어요. 한줄로 화면에서 다시 시작해 주세요.', platform, null, st.nonce));
    }
    startedBy = used.rows[0]?.created_by ?? null;
  } catch (err: any) {
    if (isMissingSnsTable(err)) {
      return res.status(503).send(renderSnsReturnHtml('error', 'DB 마이그레이션이 끝나면 연결할 수 있어요.', platform, null, st.nonce));
    }
    console.error('[SNS callback] state 소비 오류:', err);
    return res.status(500).send(renderSnsReturnHtml('error', '연결을 마치지 못했습니다.', platform, null, st.nonce));
  }

  const adapter = getSnsAdapter(platform);
  const creds = resolveSnsCredentials(platform);
  if (!adapter || !creds.ok) {
    return res.status(503).send(renderSnsReturnHtml('error', '이 채널은 아직 연결 준비가 끝나지 않았어요.', platform, null, st.nonce));
  }

  try {
    const token = await adapter.exchangeToken(creds.credentials, code);
    // 계정 식별자는 토큰으로 한 번 물어봐야 안다 — 여기까지는 동기 구간(행을 만들어야 창이 무엇을 가리킬지 정해진다).
    const profile = await adapter.fetchAccount(token.accessToken);
    const row = await upsertPendingAccount({
      companyId: st.companyId,
      platform,
      externalAccountId: profile.externalAccountId,
      token,
      connectedBy: startedBy,
    });

    // 판정은 응답 뒤. 실패해도 창은 이미 닫혔고 화면이 카드 상태를 다시 읽는다.
    void (async () => {
      try {
        await applyAccountProfile(st.companyId, row.id, profile);
      } catch (e) {
        console.error('[SNS callback] 프로필 반영 오류:', e);
      }
    })();

    return res.send(renderSnsReturnHtml('ok', '연결이 완료되었습니다. 이 창은 자동으로 닫힙니다.', platform, row.id, st.nonce));
  } catch (err: any) {
    console.error('[SNS callback] 토큰 교환 오류:', err instanceof SnsAdapterError ? { code: err.code, raw: err.raw } : err);
    return res.send(renderSnsReturnHtml('error', adapterErrorMessage(err), platform, null, st.nonce));
  }
});

/**
 * 권한 회수 콜백 — **공개**. 플랫폼이 "사용자가 앱 권한을 지웠다"를 알려 준다.
 * 서명(`signed_request`)을 앱 시크릿으로 검증하고, 그 외부 계정 id 를 가진 **회사별 후보 행을 전부** 닫는다.
 * ⛔ `(platform, external_account_id)` 만으로 회사를 특정하지 않는다(불변 5) — 후보를 전부 꺼내 각각 처리한다.
 * 어떤 경우에도 즉시 200 — 플랫폼이 재시도를 쌓지 않게.
 */
snsPublicRouter.post('/deauthorize/:platform', urlencoded({ extended: false, limit: '16kb' }), async (req: Request, res: Response) => {
  const platform = req.params.platform;
  res.status(200).json({ success: true });   // 먼저 닫는다. 아래는 응답 뒤 처리.

  if (!isSnsPlatform(platform)) return;
  const signed = String((req.body || {}).signed_request || '');
  if (!signed) return;

  const creds = resolveSnsCredentials(platform);
  if (!creds.ok) return;

  const externalId = parseSignedRequest(signed, creds.credentials.clientSecret);
  if (!externalId) {
    console.warn(`[SNS deauthorize] ${platform} 서명 검증 실패 — 무시`);
    return;
  }

  try {
    const rows = await query(
      `SELECT id, company_id FROM sns_accounts
        WHERE platform = $1 AND external_account_id = $2 AND status <> 'revoked'`,
      [platform, externalId],
    );
    for (const row of rows.rows) {
      await setSnsAccountStatus(row.company_id, row.id, 'reauth_required', '채널에서 연결 권한이 해제되었어요. 다시 연결해 주세요.');
      // 그 계정으로 예약된 행은 조용히 실패시키지 않고 사유를 남긴다(§3-10).
      await query(
        `UPDATE sns_post_targets
            SET status = 'failed',
                last_error_code = $3,
                last_error = '채널 연결이 해제되어 예약이 중단되었습니다.',
                updated_at = NOW()
          WHERE company_id = $1::uuid AND account_id = $2::uuid AND status = 'scheduled'`,
        [row.company_id, row.id, SNS_ERROR_CODES.REAUTH_REQUIRED],
      );
    }
  } catch (err: any) {
    if (isMissingSnsTable(err)) return;
    console.error('[SNS deauthorize] 처리 오류:', err);
  }
});

/** Meta `signed_request` — `base64url(sig).base64url(payload)`. 반환 = 외부 사용자 id(검증 실패는 null). */
function parseSignedRequest(signed: string, appSecret: string): string | null {
  const dot = signed.indexOf('.');
  if (dot <= 0) return null;
  const sigPart = signed.slice(0, dot);
  const payloadPart = signed.slice(dot + 1);
  try {
    const expected = createHmac('sha256', appSecret).update(payloadPart).digest();
    const got = Buffer.from(sigPart, 'base64url');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
    const parsed = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    const id = String(parsed?.user_id || parsed?.id || '');
    return id || null;
  } catch {
    return null;
  }
}

/**
 * 승인 뒤 돌아오는 창(우커머스 `renderWooReturnHtml` 형태 복제).
 * ⛔ 차이 둘(§3-10):
 *   ① `postMessage` 대상이 **우리 origin 명시**(`'*'` 금지)
 *   ② payload 에 **`success` 필드가 없다** — 부모는 이 메시지를 "다시 읽어라" 신호로만 쓰고,
 *      연결 여부는 서버 상태를 재조회한 결과로만 말한다(창이 거짓 초록을 만들지 않게).
 */
function renderSnsReturnHtml(
  status: 'ok' | 'error',
  message: string,
  platform: string | null,
  accountId: string | null,
  stateNonce: string | null,
): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const color = status === 'ok' ? '#059669' : '#dc2626';
  const icon = status === 'ok' ? '✓' : '✕';
  const title = status === 'ok' ? '채널 연결 완료' : '채널 연결 실패';
  const payload = JSON.stringify({ type: 'hanjullo:sns', platform, accountId, stateNonce });
  const origin = appOrigin();
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>한줄로 · ${esc(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 60px 20px; }
  .card { max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); text-align: center; }
  .icon { width: 56px; height: 56px; border-radius: 50%; background: ${color}; color: white; font-size: 28px; line-height: 56px; margin: 0 auto 20px; }
  h1 { font-size: 20px; margin: 0 0 12px; color: #111827; }
  p { color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
  </div>
<script>
  (function () {
    try {
      if (window.opener) window.opener.postMessage(${payload}, ${JSON.stringify(origin)});
    } catch (e) {}
    ${status === 'ok' ? 'setTimeout(function () { window.close(); }, 1500);' : ''}
  })();
</script>
</body>
</html>`;
}

export default router;
