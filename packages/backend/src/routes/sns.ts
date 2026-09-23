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
import { findLinkDefectInText } from '../utils/normalize';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import multer from 'multer';
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
import { storeSnsMedia, copyAssetToSnsMedia, snsMediaAbsPath, snsRenderAbsPath, SnsMediaError, SNS_IMAGE_MAX_BYTES } from '../utils/sns-media';
import { verifySnsMediaToken, isSnsMediaUrlLive } from '../utils/sns-signed-media';
import { planSnsFit } from '../utils/sns-media-fit';
import { buildSnsCaption, normalizeSnsTags, tightestCaptionChannel } from '../utils/sns-caption-rules';
import { buildSnsIdempotencyKey } from '../utils/sns-idempotency';
import { generateSnsCaption } from '../utils/sns-caption-ai';

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

// ───────────────────────────────── 미디어 (S2) ─────────────────────────────────

const snsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SNS_IMAGE_MAX_BYTES, files: 10 },
});

/**
 * 사진 업로드. **원본을 그대로 저장한다** — 규격 맞춤은 게시 직전에 채널별로 따로 한다.
 * 응답에 채널별 판정(`fits`)을 실어, 화면이 "이 사진은 어느 채널에서 손대지 않고 올라가는가"를 바로 말할 수 있게 한다.
 */
router.post('/media', snsUpload.single('file'), async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const userId = (req as any).user?.id ?? null;
  const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
  if (!file) return res.status(400).json({ success: false, error: '파일이 없습니다.' });

  try {
    const stored = await storeSnsMedia({ companyId, buffer: file.buffer, originalName: file.originalname });
    const r = await query(
      `INSERT INTO sns_media (company_id, created_by, kind, path, format, bytes, width, height)
       VALUES ($1::uuid, $2::uuid, 'image', $3, $4, $5, $6, $7)
       RETURNING id, width, height`,
      [companyId, userId, stored.relPath, stored.format, stored.bytes, stored.width, stored.height],
    );
    const row = r.rows[0];
    return res.json({
      success: true,
      media: { id: row.id, width: row.width, height: row.height },
      fits: fitsByChannel(stored.width, stored.height),
    });
  } catch (err: any) {
    if (err instanceof SnsMediaError) return res.status(400).json({ success: false, code: err.code, error: err.message });
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS media] 업로드 오류:', err);
    return res.status(500).json({ success: false, error: '사진을 올리지 못했습니다.' });
  }
});

/**
 * 소재 라이브러리 목록 — 이미지 스튜디오에서 만든 것과 올려 둔 것.
 * ⛔ 회사 조건 직접. 다른 회사 소재는 애초에 안 나온다.
 */
router.get('/assets', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const r = await query(
      `SELECT id, url, filename, kind, width, height, created_at
         FROM cdp_assets
        WHERE company_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 60`,
      [companyId],
    );
    return res.json({
      success: true,
      assets: r.rows.map((a) => ({
        id: a.id,
        url: a.url,
        kind: a.kind,
        // 우리가 만든 소재인가 — 화면이 "AI로 만든 사진" 표시를 미리 보여줄 수 있게(§3-9)
        generated: a.kind === 'generated',
      })),
    });
  } catch (err: any) {
    console.error('[SNS assets] 조회 오류:', err);
    return res.status(500).json({ success: false, error: '소재를 불러오지 못했습니다.' });
  }
});

/**
 * 소재 라이브러리에서 가져오기. 파일을 **복사**하고 `asset_id` 를 남긴다.
 * ★ `asset_id` 가 있는 미디어만 AI 표시 자동 부착 대상이 된다(§3-9) — 이 경로가 그 근거를 만든다.
 */
router.post('/media/from-asset', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const userId = (req as any).user?.id ?? null;
  const assetId = String(req.body?.assetId || '');
  if (!assetId) return res.status(400).json({ success: false, error: '소재를 골라 주세요.' });

  try {
    const a = await query(`SELECT id, url FROM cdp_assets WHERE id = $1::uuid AND company_id = $2::uuid`, [assetId, companyId]);
    if (!a.rows[0]) return res.status(404).json({ success: false, error: '소재를 찾을 수 없습니다.' });

    const stored = await copyAssetToSnsMedia({ companyId, assetUrl: a.rows[0].url });
    const r = await query(
      `INSERT INTO sns_media (company_id, created_by, kind, path, format, bytes, width, height, asset_id)
       VALUES ($1::uuid, $2::uuid, 'image', $3, $4, $5, $6, $7, $8::uuid)
       RETURNING id, width, height`,
      [companyId, userId, stored.relPath, stored.format, stored.bytes, stored.width, stored.height, assetId],
    );
    const row = r.rows[0];
    return res.json({
      success: true,
      media: { id: row.id, width: row.width, height: row.height },
      fits: fitsByChannel(stored.width, stored.height),
    });
  } catch (err: any) {
    if (err instanceof SnsMediaError) return res.status(400).json({ success: false, code: err.code, error: err.message });
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS media] 소재 가져오기 오류:', err);
    return res.status(500).json({ success: false, error: '소재를 가져오지 못했습니다.' });
  }
});

/** 이 사진이 채널마다 어떻게 되는가 — **화면이 추론하지 않게 서버가 계산해서 준다.** */
function fitsByChannel(width: number, height: number) {
  return listSnsAdapters().filter((a) => a.available).map((a) => {
    const plan = planSnsFit(width, height, a.capabilities, 'pad');
    return {
      platform: a.platform,
      label: a.label,
      untouched: !plan.needsAspectChange && !plan.resized,
      notice: plan.notice,
    };
  });
}

/** 화면 미리보기 — 인증 + 회사 조건. 영구히 살아 있다(플랫폼이 쓰는 주소와 다르다 · 불변 14). */
router.get('/media/:id', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const r = await query(`SELECT path FROM sns_media WHERE id = $1::uuid AND company_id = $2::uuid`, [String(req.params.id), companyId]);
    if (!r.rows[0]) return res.status(404).json({ success: false, error: '사진을 찾을 수 없습니다.' });
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(snsMediaAbsPath(r.rows[0].path));
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS media] 조회 오류:', err);
    return res.status(500).json({ success: false, error: '사진을 불러오지 못했습니다.' });
  }
});

// ───────────────────────────────── 태그 세트 (S2) ─────────────────────────────────

/** 회사 고정 태그 세트. `companies.brand_kit` jsonb 안에 둔다(신규 테이블 0). */
router.get('/tag-set', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const r = await query(`SELECT brand_kit FROM companies WHERE id = $1::uuid`, [companyId]);
    const tags = normalizeSnsTags(r.rows[0]?.brand_kit?.sns_tag_set ?? []);
    return res.json({ success: true, tags });
  } catch (err: any) {
    console.error('[SNS tag-set] 조회 오류:', err);
    return res.status(500).json({ success: false, error: '태그를 불러오지 못했습니다.' });
  }
});

router.put('/tag-set', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const tags = normalizeSnsTags(Array.isArray(req.body?.tags) ? req.body.tags : []);
  try {
    await query(
      `UPDATE companies
          SET brand_kit = COALESCE(brand_kit, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
        WHERE id = $1::uuid`,
      [companyId, JSON.stringify({ sns_tag_set: tags })],
    );
    return res.json({ success: true, tags });
  } catch (err: any) {
    console.error('[SNS tag-set] 저장 오류:', err);
    return res.status(500).json({ success: false, error: '태그를 저장하지 못했습니다.' });
  }
});

/**
 * `AI로 캡션 쓰기` — **1클릭**(§2-17). 사용자가 쓴 글과 회사 태그 세트만 있으면 바로 돈다.
 * ⛔ 중간 입력을 묻지 않는다. 세트가 비어도 버튼은 살아 있고 캡션만 다듬은 뒤 사유 한 줄을 돌려준다.
 */
router.post('/caption', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const body = String(req.body?.body ?? '');
  if (!body.trim()) return res.status(400).json({ success: false, error: '다듬을 글을 먼저 써 주세요.' });

  try {
    const setRes = await query(`SELECT brand_kit FROM companies WHERE id = $1::uuid`, [companyId]);
    const tagSet = normalizeSnsTags(setRes.rows[0]?.brand_kit?.sns_tag_set ?? []);

    const out = await generateSnsCaption({ companyId, body, tagSet });
    return res.json({
      success: true,
      caption: out.caption,
      tags: out.tags,
      note: tagSet.length === 0 ? '태그 세트가 비어 있어 태그는 못 골랐어요.' : null,
    });
  } catch (err: any) {
    console.error('[SNS caption] 오류:', err);
    return res.status(500).json({ success: false, error: '글을 다듬지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
  }
});

// ───────────────────────────────── 게시물 (S3) ─────────────────────────────────

/** 선택된 채널들의 캡션 규격. 화면 게이지와 서버 판정이 같은 값을 보게 한다. */
function captionChannels(platforms: string[]) {
  return platforms
    .map((p) => getSnsAdapter(p as SnsPlatform))
    .filter((a): a is NonNullable<typeof a> => !!a && a.available)
    .map((a) => ({ platform: a.platform, label: a.label, spec: a.capabilities }));
}

/**
 * 저장(초안). 채널마다 target 행이 하나씩 생기고, **각 행이 그 채널 규격으로 만든 확정본을 갖는다**
 * (§2-9 "워커는 그 컬럼만 읽는다"). 여기가 "한 번 쓰면 채널마다 알아서"의 서버 쪽이다.
 */
router.post('/posts', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const userId = (req as any).user?.id ?? null;
  const body = String(req.body?.body ?? '');
  const tags = normalizeSnsTags(Array.isArray(req.body?.tags) ? req.body.tags : []);
  const mediaIds: string[] = Array.isArray(req.body?.mediaIds) ? req.body.mediaIds.map(String) : [];
  const accountIds: string[] = Array.isArray(req.body?.accountIds) ? req.body.accountIds.map(String) : [];

  if (!body.trim() && mediaIds.length === 0) {
    return res.status(400).json({ success: false, error: '글이나 사진 중 하나는 있어야 해요.' });
  }
  if (accountIds.length === 0) {
    return res.status(400).json({ success: false, error: '올릴 채널을 하나 이상 골라 주세요.' });
  }
  // ★2026-09-22 글 속 링크에 실존하지 않는 도메인이 있으면 올리지 않는다 — 게시는 되고 보는 사람이
  //   눌렀을 때 안 열린다. 판정은 CT(findLinkDefectInText)가 소유하고 전 채널이 같은 문구를 쓴다.
  const snsLinkDefect = findLinkDefectInText(body, '글 속 링크는');
  if (snsLinkDefect) {
    return res.status(400).json({ success: false, error: snsLinkDefect, code: 'LINK_DEFECT' });
  }

  try {
    // 계정은 **내 회사 것만** 쓴다(불변 5 — 요청 본문의 id 를 회사 조건으로 재조회해 소유를 확인한다).
    const accRes = await query(
      `SELECT id, platform FROM sns_accounts
        WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND status = 'active'`,
      [companyId, accountIds],
    );
    if (accRes.rows.length === 0) {
      return res.status(400).json({ success: false, code: SNS_ERROR_CODES.ACCOUNT_STATE_CHANGED, error: '고른 채널을 쓸 수 없어요. 연결 상태를 확인해 주세요.' });
    }

    // 우리가 만든 사진이 실렸는가 → AI 표시 부착 대상(§3-9)
    const aiRes = mediaIds.length
      ? await query(`SELECT COUNT(*)::int AS n FROM sns_media WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND (asset_id IS NOT NULL OR ai_declared)`, [companyId, mediaIds])
      : { rows: [{ n: 0 }] };
    const aiNotice = Number(aiRes.rows[0]?.n || 0) > 0;

    const postRes = await query(
      `INSERT INTO sns_posts (company_id, body, tags, media_ids, status, created_by)
       VALUES ($1::uuid, $2, $3::text[], $4::uuid[], 'draft', $5::uuid)
       RETURNING id`,
      [companyId, body, tags, mediaIds, userId],
    );
    const postId = postRes.rows[0].id;

    const format = mediaIds.length > 1 ? 'carousel' : mediaIds.length === 1 ? 'feed' : 'text';
    const results: any[] = [];

    for (const acc of accRes.rows) {
      const adapter = getSnsAdapter(acc.platform);
      if (!adapter) continue;
      const caption = buildSnsCaption({ body, tags, aiNotice }, adapter.capabilities);

      const targetId = randomUUID();
      const idem = buildSnsIdempotencyKey(companyId, targetId, { caption: caption.text, mediaIds, format });

      await query(
        `INSERT INTO sns_post_targets
           (id, post_id, company_id, account_id, platform, format, caption, status, idempotency_key)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, 'draft', $8)`,
        [targetId, postId, companyId, acc.id, acc.platform, format, caption.text, idem],
      );
      results.push({ targetId, platform: acc.platform, ok: caption.ok, overBy: caption.overBy, droppedTags: caption.droppedTags });
    }

    return res.json({ success: true, postId, targets: results });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS posts] 저장 오류:', err);
    return res.status(500).json({ success: false, error: '저장하지 못했습니다.' });
  }
});

/**
 * 게시·예약. 확인 창에서 누른 값을 **서버가 다시 검증**한다(§3-2) — 계정 상태가 그 사이 바뀌었으면 막는다.
 * ⛔ 상한을 넘는 채널이 있으면 **그 채널만 막는 것이 아니라 전체를 막는다.** 일부만 나가면 사용자가
 *   "올렸다"고 믿는 것과 실제가 갈린다.
 */
router.post('/posts/:id/publish', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const postId = String(req.params.id);
  const scheduledAt = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;

  try {
    const post = await query(`SELECT * FROM sns_posts WHERE id = $1::uuid AND company_id = $2::uuid`, [postId, companyId]);
    if (!post.rows[0]) return res.status(404).json({ success: false, error: '게시물을 찾을 수 없습니다.' });

    const targets = await query(
      `SELECT t.*, a.status AS account_status FROM sns_post_targets t
         JOIN sns_accounts a ON a.id = t.account_id
        WHERE t.post_id = $1::uuid AND t.company_id = $2::uuid AND t.status = 'draft'`,
      [postId, companyId],
    );
    if (targets.rows.length === 0) return res.status(400).json({ success: false, error: '올릴 채널이 없습니다.' });

    // 계정 상태 재검증
    const changed = targets.rows.filter((t) => t.account_status !== 'active');
    if (changed.length > 0) {
      return res.status(409).json({
        success: false, code: SNS_ERROR_CODES.ACCOUNT_STATE_CHANGED,
        error: '연결 상태가 바뀐 채널이 있어요. 채널을 다시 확인해 주세요.',
      });
    }

    // 캡션 상한 재검증 — 확정본 길이를 지금 다시 잰다(저장 뒤 규칙이 바뀌었을 수 있다).
    const over = targets.rows.filter((t) => {
      const adapter = getSnsAdapter(t.platform);
      if (!adapter) return true;
      return [...String(t.caption)].length > adapter.capabilities.maxCaptionChars;
    });
    if (over.length > 0) {
      return res.status(400).json({
        success: false,
        error: '글이 채널 상한을 넘는 곳이 있어요. 그 채널만 따로 줄여 주세요.',
        platforms: over.map((t) => t.platform),
      });
    }

    const when = scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt : new Date();
    await query(
      `UPDATE sns_post_targets SET status = 'scheduled', scheduled_at = $3, updated_at = NOW()
        WHERE post_id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
      [postId, companyId, when],
    );
    await query(`UPDATE sns_posts SET status = 'scheduled', scheduled_at = $3, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`, [postId, companyId, when]);

    return res.json({ success: true, scheduledAt: when.toISOString() });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS publish] 예약 오류:', err);
    return res.status(500).json({ success: false, error: '게시를 시작하지 못했습니다.' });
  }
});

/** 취소 — `scheduled` 만. 선점된 뒤에는 409(이미 나가는 중이라 되돌리면 이중 게시가 된다). */
router.post('/posts/:id/cancel', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const r = await query(
      `UPDATE sns_post_targets SET status = 'cancelled', updated_at = NOW()
        WHERE post_id = $1::uuid AND company_id = $2::uuid AND status = 'scheduled'
        RETURNING id`,
      [String(req.params.id), companyId],
    );
    if (r.rowCount === 0) return res.status(409).json({ success: false, error: '이미 올라가고 있어 취소할 수 없어요.' });
    await query(`UPDATE sns_posts SET status = 'cancelled', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`, [String(req.params.id), companyId]);
    return res.json({ success: true, cancelled: r.rowCount });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    return res.status(500).json({ success: false, error: '취소하지 못했습니다.' });
  }
});

/** 다시 시도 — **새 행**을 만든다(§2-7 `failed → scheduled` 전이 없음). 같은 내용이면 키도 같다. */
router.post('/targets/:id/retry', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const r = await query(
      `SELECT * FROM sns_post_targets WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'failed'`,
      [String(req.params.id), companyId],
    );
    const old = r.rows[0];
    if (!old) return res.status(404).json({ success: false, error: '다시 시도할 수 없는 상태입니다.' });

    const newId = randomUUID();
    const post = await query(`SELECT media_ids FROM sns_posts WHERE id = $1::uuid`, [old.post_id]);
    const mediaIds: string[] = post.rows[0]?.media_ids ?? [];
    const idem = buildSnsIdempotencyKey(companyId, newId, { caption: old.caption, mediaIds, format: old.format });

    await query(
      `INSERT INTO sns_post_targets
         (id, post_id, company_id, account_id, platform, format, caption, status, scheduled_at, idempotency_key)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, 'scheduled', NOW(), $8)`,
      [newId, old.post_id, companyId, old.account_id, old.platform, old.format, old.caption, idem],
    );
    return res.json({ success: true, targetId: newId });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS retry] 오류:', err);
    return res.status(500).json({ success: false, error: '다시 시도하지 못했습니다.' });
  }
});

/** 이력 목록 — 묶음 1행 + 채널 줄 N. */
router.get('/posts', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const r = await query(
      `SELECT p.id, p.body, p.status, p.scheduled_at, p.created_at, p.media_ids,
              COALESCE(json_agg(json_build_object(
                'targetId', t.id, 'platform', t.platform, 'status', t.status,
                'permalink', t.permalink, 'verifiedAt', t.verified_at,
                'deletedOnPlatformAt', t.deleted_on_platform_at,
                'verifyGaveUpAt', t.verify_gave_up_at,
                'platformPostId', t.platform_post_id,
                'lastError', t.last_error, 'lastErrorCode', t.last_error_code
              ) ORDER BY t.platform) FILTER (WHERE t.id IS NOT NULL), '[]') AS targets
         FROM sns_posts p
         LEFT JOIN sns_post_targets t ON t.post_id = p.id
        WHERE p.company_id = $1::uuid
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT 50`,
      [companyId],
    );
    return res.json({ success: true, posts: r.rows });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS posts] 목록 오류:', err);
    return res.status(500).json({ success: false, error: '이력을 불러오지 못했습니다.' });
  }
});

// ───────────────────────────────── 공개 구간 ─────────────────────────────────

/**
 * 플랫폼이 미디어를 가져가는 주소 — **공개이되 살아 있는 동안만**(§3-7 · 불변 14).
 * 서명이 통과해도 **DB 상태가 맞아야** 연다. 게시가 확인되면 즉시 죽는다.
 */
snsPublicRouter.get('/m/:token', async (req: Request, res: Response) => {
  const payload = verifySnsMediaToken(String(req.params.token || ''));
  if (!payload) return res.status(404).end();

  try {
    const r = await query(
      `SELECT t.id, t.status, t.container_created_at, t.created_at, t.verified_at, t.company_id,
              p.media_ids
         FROM sns_post_targets t JOIN sns_posts p ON p.id = t.post_id
        WHERE t.id = $1::uuid AND t.company_id = $2::uuid`,
      [payload.targetId, payload.companyId],
    );
    const row = r.rows[0];
    if (!row) return res.status(404).end();
    if (!isSnsMediaUrlLive(row)) return res.status(404).end();
    // 사진을 바꿨으면 옛 주소는 그 자리에서 죽는다.
    const mediaIds: string[] = row.media_ids ?? [];
    if (!mediaIds.includes(payload.mediaId)) return res.status(404).end();

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.sendFile(snsRenderAbsPath(`${payload.companyId}/${payload.targetId}.jpg`));
  } catch (err: any) {
    if (isMissingSnsTable(err)) return res.status(404).end();
    console.error('[SNS media serve] 오류:', err);
    return res.status(404).end();
  }
});

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
