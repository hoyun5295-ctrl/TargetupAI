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

import { Router, Request, Response, urlencoded, raw } from 'express';
import { isUuid } from '../utils/normalize';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
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
import {
  storeSnsMedia, copyAssetToSnsMedia, snsMediaAbsPath, SnsMediaError, SNS_IMAGE_MAX_BYTES,
  startSnsVideoUpload, appendSnsVideoChunk, completeSnsVideoUpload, resolveSnsServeFile, SNS_UPLOAD_CHUNK_BYTES, snsMediaThumbnail,
} from '../utils/sns-media';
import { verifySnsMediaToken, isSnsMediaUrlLive } from '../utils/sns-signed-media';
import { planSnsFit, planSnsVideoFit, type SnsVideoFacts } from '../utils/sns-media-fit';
import { probeSnsVideoFile } from '../utils/sns-video-probe';
import { snsChannelAvailable } from '../utils/sns-availability';
import { normalizeSnsTags, countSnsCaption, type SnsCaptionSpec } from '../utils/sns-caption-rules';
import { parseSnsScheduleAt } from '../utils/sns-schedule';
import { retrySnsTarget } from '../utils/sns-retry';
import { listSnsPostsView, loadSnsPostsByIds, snsComposeDefaults } from '../utils/sns-posts';
import { listSnsAttention } from '../utils/sns-attention';
import { generateSnsCaption, loadSnsCaptionImages, splitTrailingTagLines, type SnsCaptionAction } from '../utils/sns-caption-ai';
import { snsMediaNeedsAiNotice, snsMediaAiNoticeMap } from '../utils/sns-ai-notice';
import { readSnsTagSet, replaceSnsTagSet, patchSnsTagSet, snsTagSeeds, SnsTagSetError } from '../utils/sns-tag-set';
import { checkSnsSpelling } from '../utils/sns-spell-check';
import { composeSnsPost, rescheduleSnsPost } from '../utils/sns-compose';

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

/**
 * 채널 규격 — 어댑터가 선언한 값 그대로. 화면은 이 값만 보고 추론하지 않는다(§3-3).
 * ★ 1차-B — `available` = 코드 · 자격 ENV · 실비 상한 셋 다(`snsChannelAvailable` · 불변 23).
 *   코드만 배포되고 ENV 가 없으면 카드는 `준비 중` 그대로다.
 */
function specsPayload(companyId: string | null) {
  return listSnsAdapters().map((a) => ({
    platform: a.platform,
    label: a.label,
    // ★ 2026-09-24 — 채널 회사 명단까지 본다(심사 전 채널은 명단에 든 회사에만 열린다).
    available: snsChannelAvailable(a, companyId).ok,
    capabilities: a.capabilities,
  }));
}

router.get('/specs', (req: Request, res: Response) => {
  const companyId = ((req as any).user?.companyId as string) ?? null;
  return res.json({ success: true, specs: specsPayload(companyId) });
});

/**
 * 화면 1콜. **ENV 게이트를 여기서 막지 않는다** — 미개방 회사도 `준비 중` 화면을 그려야 하므로
 * `enabled:false` 를 실어 보낸다(§2-16 · 403 빈 화면 0).
 */
router.get('/overview', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const enabled = snsPublishEnabled(companyId);
  if (!enabled) {
    return res.json({ success: true, enabled: false, accounts: [], specs: specsPayload(companyId) });
  }
  try {
    const rows = await listSnsAccounts(companyId);
    const userId = ((req as any).user?.userId as string) ?? null;
    // ★ 2026-09-24 화면 1콜에 '확인할 것' 띠(C1)와 작성 기본값(D1 · 지난번 채널)을 함께 싣는다.
    const attention = await listSnsAttention(companyId, rows);
    const defaults = await snsComposeDefaults(companyId, userId);
    return res.json({
      success: true,
      enabled: true,
      accounts: rows.map((r) => toAccountCard(r)),
      specs: specsPayload(companyId),
      attention,
      defaults,
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
 * ★ 2026-09-24 C2 — [연결]과 [다시 연결]이 같은 함수를 지난다(다시 연결 1탭 · 창을 두 번 열지 않는다).
 */
async function startSnsAuth(companyId: string, userId: string | null, platform: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!isSnsPlatform(platform)) {
    return { status: 400, body: { success: false, error: '알 수 없는 채널입니다.' } };
  }
  const adapter = getSnsAdapter(platform);
  if (!adapter) {
    return { status: 400, body: { success: false, error: '아직 준비 중인 채널이에요.' } };
  }
  const open = snsChannelAvailable(adapter, companyId);
  if (!open.ok) {
    return { status: 400, body: { success: false, code: 'SNS_CHANNEL_CLOSED', error: open.reason } };
  }
  const creds = resolveSnsCredentials(platform);
  if (!creds.ok) {
    return { status: 503, body: { success: false, code: 'SNS_CREDENTIALS_MISSING', error: creds.reason } };
  }

  // ★ 1차-B — PKCE 채널(X). verifier 는 1회용 state 행에만 두고(30분 · 소비 시 삭제) 주소에는 해시만 싣는다.
  let codeChallenge: string | undefined;
  const statePayload: Record<string, string> = {};
  if (adapter.pkce) {
    const verifier = randomBytes(32).toString('base64url');
    statePayload.code_verifier = verifier;
    codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  }

  const nonce = randomUUID();
  await query(
    `INSERT INTO sns_oauth_states (state_nonce, company_id, platform, created_by, payload, expires_at)
     VALUES ($1, $2::uuid, $3, $4::uuid, $5::jsonb, NOW() + ($6 || ' milliseconds')::interval)`,
    [nonce, companyId, platform, userId, JSON.stringify(statePayload), String(SNS_OAUTH_STATE_TTL_MS)],
  );

  const state = signSnsState({ companyId, platform, nonce, ts: Date.now() });
  return {
    status: 200,
    body: {
      success: true,
      platform,
      authorizeUrl: adapter.buildAuthorizeUrl(creds.credentials, state, { codeChallenge }),
      stateNonce: nonce,
    },
  };
}

router.post('/auth/start/:platform', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const userId = (req as any).user?.userId ?? null;
  try {
    const r = await startSnsAuth(companyId, userId, String(req.params.platform));
    return res.status(r.status).json(r.body);
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS auth/start] state 저장 오류:', err);
    return res.status(500).json({ success: false, error: '연결을 시작하지 못했습니다.' });
  }
});

/** 해제 — 행은 남기고 토큰만 지운다(§3-1). 이력이 이 행을 참조한다. */
router.post('/accounts/:id/disconnect', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const done = await revokeSnsAccount(companyId, String(req.params.id));
    if (!done) return res.status(404).json({ success: false, error: '계정을 찾을 수 없습니다.' });
    return res.json({ success: true, account: toAccountCard(done.row), cancelledScheduled: done.cancelled });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS disconnect] 오류:', err);
    return res.status(500).json({ success: false, error: '연결을 해제하지 못했습니다.' });
  }
});

/**
 * 재연결 — 소유를 확인하고 **같은 응답에 승인 주소까지** 싣는다(C2 · 1탭).
 * 화면은 누르는 순간 빈 창을 열어 두고 이 주소로 보낸다(팝업 차단을 피한다). platform 은 옛 화면 호환으로 남긴다.
 */
router.post('/accounts/:id/reconnect', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const userId = (req as any).user?.userId ?? null;
  try {
    const row = await getSnsAccount(companyId, String(req.params.id));
    if (!row) return res.status(404).json({ success: false, error: '계정을 찾을 수 없습니다.' });
    const r = await startSnsAuth(companyId, userId, row.platform);
    return res.status(r.status).json({ platform: row.platform, ...r.body });
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
  const userId = (req as any).user?.userId ?? null;
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
      // ★ 2026-09-24 B-8 — 직접 올린 사진은 AI 표시 대상이 아니다(판정 CT = sns-ai-notice).
      media: { id: row.id, width: row.width, height: row.height, kind: 'image', aiNotice: false },
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
  const userId = (req as any).user?.userId ?? null;
  const assetId = String(req.body?.assetId || '');
  if (!assetId) return res.status(400).json({ success: false, error: '소재를 골라 주세요.' });

  try {
    const a = await query(`SELECT id, url, kind FROM cdp_assets WHERE id = $1::uuid AND company_id = $2::uuid`, [assetId, companyId]);
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
      // ★ 2026-09-24 B-8 — 이미지 스튜디오에서 만든 소재만 AI 표시 대상(직접 올려 둔 소재는 아니다).
      media: { id: row.id, width: row.width, height: row.height, kind: 'image', aiNotice: a.rows[0].kind === 'generated' },
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
      accepted: true,
    };
  });
}

/** ★ 1차-B — 이 영상을 채널마다 받는가. 영상은 손대지 않으므로 받으면 언제나 "그대로"다(불변 21). */
function videoFitsByChannel(v: SnsVideoFacts) {
  return listSnsAdapters().filter((a) => a.available).map((a) => {
    const fit = planSnsVideoFit(v, a.capabilities.video);
    return { platform: a.platform, label: a.label, untouched: true, notice: fit.notice, accepted: fit.accepted };
  });
}

// ───────────────────────────── 영상 조각 업로드 (★ 2026-09-23 1차-B · 설계 1b §3-2) ─────────────────────────────
// nginx 본문 상한(가이드 전역 5M)을 바꾸지 않도록 4MB 조각으로 받는다. 세션은 디스크에만 있다(메모리 상태 0).

function sendMediaError(res: Response, err: any, what: string) {
  if (err instanceof SnsMediaError) return res.status(400).json({ success: false, code: err.code, error: err.message });
  if (isMissingSnsTable(err)) return sendDbPending(res);
  console.error(`[SNS video] ${what} 오류:`, err);
  return res.status(500).json({ success: false, error: '영상을 올리지 못했습니다.' });
}

router.post('/media/uploads', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const userId = (req as any).user?.userId ?? null;
  try {
    const r = await startSnsVideoUpload({
      companyId,
      userId,
      originalName: String(req.body?.name || ''),
      totalBytes: Number(req.body?.bytes),
    });
    return res.json({ success: true, uploadId: r.uploadId, chunkBytes: r.chunkBytes });
  } catch (err: any) {
    return sendMediaError(res, err, '업로드 시작');
  }
});

router.put(
  '/media/uploads/:id/chunks/:index',
  raw({ type: 'application/octet-stream', limit: SNS_UPLOAD_CHUNK_BYTES + 1024 }),
  async (req: Request, res: Response) => {
    const companyId = (req as any).user?.companyId as string;
    try {
      const r = await appendSnsVideoChunk({
        companyId,
        uploadId: String(req.params.id),
        index: Number(req.params.index),
        chunk: req.body as Buffer,
      });
      return res.json({ success: true, received: r.received, totalBytes: r.totalBytes });
    } catch (err: any) {
      return sendMediaError(res, err, '조각');
    }
  },
);

router.post('/media/uploads/:id/complete', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const userId = (req as any).user?.userId ?? null;
  try {
    const stored = await completeSnsVideoUpload({ companyId, uploadId: String(req.params.id) });
    const r = await query(
      `INSERT INTO sns_media (company_id, created_by, kind, path, format, bytes, width, height)
       VALUES ($1::uuid, $2::uuid, 'video', $3, $4, $5, $6, $7)
       RETURNING id, width, height`,
      [companyId, userId, stored.relPath, stored.format, stored.bytes, stored.width, stored.height],
    );
    const row = r.rows[0];
    const facts: SnsVideoFacts = {
      bytes: stored.bytes,
      durationSec: stored.probe.durationSec,
      width: stored.probe.width,
      height: stored.probe.height,
      videoCodec: stored.probe.videoCodec,
    };
    return res.json({
      success: true,
      media: { id: row.id, width: row.width, height: row.height, kind: 'video', durationSec: stored.probe.durationSec, aiNotice: false },
      fits: videoFitsByChannel(facts),
      relocated: stored.relocated,
    });
  } catch (err: any) {
    return sendMediaError(res, err, '업로드 마무리');
  }
});

/**
 * 불러와서 쓰기(E7) — 예전 글의 사진·영상을 작성 칸에 다시 싣는다. **회사 조건으로 다시 읽는다.**
 * 응답은 업로드 응답과 같은 모양(media · fits)이라 화면이 같은 함수(appendMedia)로 싣는다. 영상은 다시 판독한다.
 */
router.post('/media/lookup', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const ids: string[] = (Array.isArray(req.body?.mediaIds) ? req.body.mediaIds : []).map(String).filter(isUuid).slice(0, 20);
  if (!ids.length) return res.json({ success: true, items: [], missing: [] });
  try {
    const r = await query(
      `SELECT id, kind, path, bytes, width, height FROM sns_media WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`,
      [companyId, ids],
    );
    const byId = new Map(r.rows.map((row: any) => [String(row.id), row]));
    const ai = await snsMediaAiNoticeMap(companyId, ids);
    const items: any[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const m: any = byId.get(id);
      if (!m) { missing.push(id); continue; }
      if (m.kind === 'video') {
        try {
          const probe = await probeSnsVideoFile(snsMediaAbsPath(m.path));
          const facts: SnsVideoFacts = { bytes: Number(m.bytes) || 0, durationSec: probe.durationSec, width: probe.width, height: probe.height, videoCodec: probe.videoCodec };
          items.push({
            media: { id: m.id, width: probe.width, height: probe.height, kind: 'video', durationSec: probe.durationSec, aiNotice: ai.get(id) ?? false },
            fits: videoFitsByChannel(facts),
          });
        } catch {
          missing.push(id);
        }
        continue;
      }
      items.push({
        media: { id: m.id, width: m.width, height: m.height, kind: 'image', aiNotice: ai.get(id) ?? false },
        fits: fitsByChannel(Number(m.width) || 0, Number(m.height) || 0),
      });
    }
    return res.json({ success: true, items, missing });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS media lookup] 오류:', err);
    return res.status(500).json({ success: false, error: '사진을 불러오지 못했습니다.' });
  }
});

/**
 * 화면 미리보기 — 인증 + 회사 조건. 영구히 살아 있다(플랫폼이 쓰는 주소와 다르다 · 불변 14).
 * ★ 2026-09-24 `?thumb=1` = 목록 썸네일(사진만 · 192px).
 */
router.get('/media/:id', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const r = await query(`SELECT path, kind FROM sns_media WHERE id = $1::uuid AND company_id = $2::uuid`, [String(req.params.id), companyId]);
    if (!r.rows[0]) return res.status(404).json({ success: false, error: '사진을 찾을 수 없습니다.' });
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (req.query.thumb === '1') {
      if (r.rows[0].kind !== 'image') return res.status(404).json({ success: false, error: '썸네일이 없는 형식이에요.' });
      const buf = await snsMediaThumbnail(r.rows[0].path);
      res.setHeader('Content-Type', 'image/jpeg');
      return res.end(buf);
    }
    return res.sendFile(snsMediaAbsPath(r.rows[0].path));
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS media] 조회 오류:', err);
    return res.status(500).json({ success: false, error: '사진을 불러오지 못했습니다.' });
  }
});

// ───────────────────────────────── 태그 세트 (S2) ─────────────────────────────────

function sendTagSetError(res: Response, err: any, what: string) {
  if (err instanceof SnsTagSetError) {
    return res.status(err.status).json({ success: false, code: err.code, error: err.message, invalid: err.invalid });
  }
  console.error(`[SNS tag-set] ${what} 오류:`, err);
  return res.status(500).json({ success: false, error: '자주 쓰는 태그를 저장하지 못했어요.' });
}

/**
 * 회사 '자주 쓰는 태그'. `companies.brand_kit` jsonb 안에 둔다(신규 테이블 0).
 * ★ 2026-09-24 B-5 — 형식 위반 옛 값은 `invalid[]` 로 함께 준다(말없이 삭제 0) · 세트가 비면 씨앗(지난 글 태그 빈도 상위 10).
 */
router.get('/tag-set', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const set = await readSnsTagSet(companyId);
    const seeds = set.tags.length === 0 && set.invalid.length === 0 ? await snsTagSeeds(companyId) : [];
    return res.json({ success: true, tags: set.tags, invalid: set.invalid, seeds });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS tag-set] 조회 오류:', err);
    return res.status(500).json({ success: false, error: '자주 쓰는 태그를 불러오지 못했어요.' });
  }
});

/** 통째 저장(옛 화면 호환 · 상한·형식 거절). */
router.put('/tag-set', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const set = await replaceSnsTagSet(companyId, Array.isArray(req.body?.tags) ? req.body.tags : []);
    return res.json({ success: true, tags: set.tags, invalid: set.invalid });
  } catch (err: any) {
    return sendTagSetError(res, err, '저장');
  }
});

/** ★ 2026-09-24 더하기·빼기 1클릭(한 트랜잭션 · 회사 행 잠금). */
router.patch('/tag-set', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const set = await patchSnsTagSet(companyId, { add: req.body?.add, remove: req.body?.remove });
    return res.json({ success: true, tags: set.tags, invalid: set.invalid });
  } catch (err: any) {
    return sendTagSetError(res, err, '더하기·빼기');
  }
});

/**
 * ★ 2026-09-24 B-7 맞춤법 검사. 결과는 후보 목록뿐이고 글은 바꾸지 않는다(고치기는 화면에서 사용자가 누를 때).
 * 보호 낱말 = 회사명 · 브랜드명 · 자주 쓰는 태그.
 */
router.post('/typo-check', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const userId = ((req as any).user?.userId as string) ?? null;
  const body = String(req.body?.body ?? '');
  if (!body.trim()) return res.status(400).json({ success: false, error: '검사할 글을 먼저 써 주세요.' });
  try {
    const c = await query(`SELECT company_name, brand_name FROM companies WHERE id = $1::uuid`, [companyId]);
    const set = await readSnsTagSet(companyId);
    const protectedWords = [c.rows[0]?.company_name, c.rows[0]?.brand_name, ...set.tags].filter(Boolean).map(String);
    const out = await checkSnsSpelling({ companyId, userId, body, protectedWords });
    if (out.failed) return res.status(502).json({ success: false, code: 'SPELL_UNREADABLE', error: '검사 결과를 읽지 못했어요. 한 번 더 눌러 주세요.' });
    return res.json({ success: true, bodyHash: out.bodyHash, issues: out.issues });
  } catch (err: any) {
    if (err?.name === 'AiRateLimitExceeded') return res.status(429).json({ success: false, code: 'AI_RATE_LIMIT', error: err.message });
    console.error('[SNS typo-check] 오류:', err);
    return res.status(500).json({ success: false, error: '맞춤법을 검사하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  }
});

/**
 * `AI로 캡션 쓰기` — **1클릭**(§2-17). ★ 2026-09-24 B-6: 모드는 서버가 정한다(다듬기 · 사진 초안 · 잠금).
 * ⛔ 중간 입력을 묻지 않는다. 결과를 버렸으면 `changed:false` + 사유 한 줄(가짜 성공 0 · K9).
 * 요청 = {body, tags, mediaIds?, action('write'|'again'|'fit'), previous?, fitPlatform?}
 */
router.post('/caption', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const userId = ((req as any).user?.userId as string) ?? null;
  const body = String(req.body?.body ?? '');
  const rawAction = String(req.body?.action ?? 'write');
  const action: SnsCaptionAction = rawAction === 'again' || rawAction === 'fit' ? rawAction : 'write';
  const tags = normalizeSnsTags(Array.isArray(req.body?.tags) ? req.body.tags : []);
  const mediaIds: string[] = (Array.isArray(req.body?.mediaIds) ? req.body.mediaIds : []).map(String).filter(isUuid);
  const previous = typeof req.body?.previous === 'string' ? req.body.previous : undefined;

  try {
    let fit: { label: string; spec: SnsCaptionSpec; aiNotice: boolean } | undefined;
    if (action === 'fit') {
      const adapter = getSnsAdapter(String(req.body?.fitPlatform || '') as SnsPlatform);
      if (!adapter) return res.status(400).json({ success: false, code: 'FIT_PLATFORM_REQUIRED', error: '어느 채널 길이에 맞출지 알 수 없어요.' });
      fit = { label: adapter.label, spec: adapter.capabilities, aiNotice: await snsMediaNeedsAiNotice(companyId, mediaIds) };
    }
    const media = await loadSnsCaptionImages(companyId, mediaIds, !splitTrailingTagLines(body).head.trim());
    const tagSet = (await readSnsTagSet(companyId)).tags;

    const out = await generateSnsCaption({ companyId, userId, action, body, previous, tags, tagSet, media, fit });
    if (out.mode === 'locked') {
      return res.status(400).json({ success: false, code: 'CAPTION_AI_LOCKED', mode: out.mode, error: out.note });
    }
    return res.json({
      success: true,
      mode: out.mode,
      changed: out.changed,
      caption: out.caption,
      tags: out.tags,
      note: out.note,
    });
  } catch (err: any) {
    if (err?.name === 'AiRateLimitExceeded') return res.status(429).json({ success: false, code: 'AI_RATE_LIMIT', error: err.message });
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS caption] 오류:', err);
    return res.status(500).json({ success: false, error: '글을 다듬지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
  }
});

// ───────────────────────────────── 게시물 (S3) ─────────────────────────────────

/**
 * 저장(+ 게시). 채널마다 target 행이 하나씩 생기고, **각 행이 그 채널 규격으로 만든 확정본을 갖는다**
 * (§2-9 "워커는 그 컬럼만 읽는다"). 여기가 "한 번 쓰면 채널마다 알아서"의 서버 쪽이다.
 * ★ 2026-09-24 S5·B-4 — 판정·저장·게시는 CT(`composeSnsPost`) 한 트랜잭션이 한다.
 *   `publish` 가 오면 저장과 예약을 한 번에 한다(두 번 누름·끊김으로 글이 둘 되지 않게 composeId 로 대조).
 *   `publish` 없이 오면 예전처럼 초안만 만든다(배포 사이 옛 화면 호환 · 그 뒤 /publish).
 */
router.post('/posts', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const userId = ((req as any).user?.userId as string) ?? null;
  const rawPublish = req.body?.publish;
  const publish = rawPublish && typeof rawPublish === 'object' ? rawPublish : rawPublish === true ? {} : null;
  try {
    const r = await composeSnsPost({
      companyId,
      userId,
      body: req.body?.body,
      tags: req.body?.tags,
      mediaIds: req.body?.mediaIds,
      accountIds: req.body?.accountIds,
      composeId: req.body?.composeId,
      expected: req.body?.expected,
      publish,
      replacesPostId: req.body?.replacesPostId,
    });
    if (!r.ok) return res.status(r.status).json({ success: false, code: r.code, error: r.error, ...(r.extra ?? {}) });
    return res.json({
      success: true,
      existing: r.existing,
      postId: r.postId,
      published: r.published,
      scheduledAt: r.scheduledAt,
      targets: r.targets,
    });
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
  // ★ 2026-09-24 예약 시각은 CT 하나로 읽는다 — 시간대 없는 값·지난 시각이 조용히 즉시 게시되던 결함(K5).
  const sched = parseSnsScheduleAt(req.body?.scheduledAt);
  if (!sched.ok) return res.status(400).json({ success: false, code: sched.code, error: sched.error });
  const scheduledAt = sched.at;

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
    // ★ 2026-09-24 채널 방식으로 센다(X 는 한글·이모지 2 · 링크 23). 코드포인트로 세면 X 가 거부할 글이 통과한다(K11).
    const over = targets.rows.filter((t) => {
      const adapter = getSnsAdapter(t.platform);
      if (!adapter) return true;
      return countSnsCaption(String(t.caption), adapter.capabilities.captionCounting) > adapter.capabilities.maxCaptionChars;
    });
    if (over.length > 0) {
      return res.status(400).json({
        success: false,
        error: '글이 채널 상한을 넘는 곳이 있어요. 그 채널만 따로 줄여 주세요.',
        platforms: over.map((t) => t.platform),
      });
    }

    const when = scheduledAt ?? new Date();
    await query(
      `UPDATE sns_post_targets SET status = 'scheduled', scheduled_at = $3, updated_at = NOW()
        WHERE post_id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
      [postId, companyId, when],
    );
    // ★ 2026-09-24 게시물의 예약 시각은 **사용자가 고른 시각만** 적는다 — 지금 올리기는 NULL(S7).
    //   지금 올리기에도 지금 시각을 적으니 기록이 게시된 글에 '… 예정'을 붙였다(K8). target 은 워커가 읽으므로 그대로 둔다.
    await query(`UPDATE sns_posts SET status = 'scheduled', scheduled_at = $3, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`, [postId, companyId, scheduledAt]);

    return res.json({ success: true, scheduledAt: when.toISOString() });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS publish] 예약 오류:', err);
    return res.status(500).json({ success: false, error: '게시를 시작하지 못했습니다.' });
  }
});

/** ★ 2026-09-24 E4 예약 시각 바꾸기 — 판정·잠금은 CT(`rescheduleSnsPost`) 한 트랜잭션. */
router.post('/posts/:id/reschedule', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  const postId = String(req.params.id);
  if (!isUuid(postId)) return res.status(400).json({ success: false, error: '잘못된 요청입니다.' });
  try {
    const r = await rescheduleSnsPost(companyId, postId, req.body?.scheduledAt);
    if (!r.ok) return res.status(r.status).json({ success: false, code: r.code, error: r.error });
    return res.json({ success: true, scheduledAt: r.scheduledAt, moved: r.moved });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS reschedule] 오류:', err);
    return res.status(500).json({ success: false, error: '시각을 바꾸지 못했습니다.' });
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

/**
 * 다시 시도 — **새 행**을 만든다(§2-7 `failed → scheduled` 전이 없음).
 * ★ 2026-09-24 S1 — 판정·잠금·삽입은 CT(`retrySnsTarget`) 한 트랜잭션이 한다. 두 번 누르면 두 번째는 409(K2).
 *   새 행은 원래 예약 시각을 지킨다(다음 주 예약이 지금 올라가던 결함).
 */
router.post('/targets/:id/retry', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const r = await retrySnsTarget(companyId, String(req.params.id));
    if (!r.ok) return res.status(r.status).json({ success: false, code: r.code, error: r.error, action: r.action ?? null });
    return res.json({ success: true, targetId: r.targetId, scheduledAt: r.scheduledAt });
  } catch (err: any) {
    if (isMissingSnsTable(err)) return sendDbPending(res);
    console.error('[SNS retry] 오류:', err);
    return res.status(500).json({ success: false, error: '다시 시도하지 못했습니다.' });
  }
});

/**
 * 이력 목록 — `{ upcoming, posts, attention }`.
 * ★ 2026-09-24 CT(`listSnsPostsView`)가 예약·기록을 가르고, 묶음 상태를 계정별 최신 행으로 파생하며(S6),
 *   채널 줄마다 계정 이름·확정본·대체 여부·할 수 있는 일을 싣는다(E1~E3). 확인할 것 띠도 함께 실어
 *   폴링 한 번으로 새 실패·끊김이 띠에 뜨게 한다(0924 최종 검증 R3-10).
 */
router.get('/posts', async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId as string;
  try {
    const view = await listSnsPostsView(companyId);
    const accounts = await listSnsAccounts(companyId);
    const attention = await listSnsAttention(companyId, accounts);
    // 띠가 가리키는 글이 목록 밖이면 기록 끝에 덧붙인다([보기]가 갈 곳이 있게).
    const shown = new Set([...view.upcoming, ...view.posts].map((p) => p.id));
    const missing = attention.items.map((i) => i.postId).filter((id): id is string => !!id && !shown.has(id));
    const extra = missing.length ? await loadSnsPostsByIds(companyId, Array.from(new Set(missing))) : [];
    return res.json({ success: true, upcoming: view.upcoming, posts: [...view.posts, ...extra], attention });
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

    // ★ 1차-B — 서명 속 미디어가 사진이면 그 target·미디어의 게시본(D2), 영상이면 보관본 그대로(불변 21).
    const m = await query(
      `SELECT id, kind, path, format FROM sns_media WHERE id = $1::uuid AND company_id = $2::uuid`,
      [payload.mediaId, payload.companyId],
    );
    if (!m.rows[0]) return res.status(404).end();
    const file = resolveSnsServeFile({ companyId: payload.companyId, targetId: payload.targetId, media: m.rows[0] });

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Type', file.contentType);
    // Range 206 은 sendFile 이 처리한다(Meta 가 영상을 나눠 받아도 된다).
    return res.sendFile(file.absPath, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
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
  // ★ 1차-B — PKCE verifier 도 이 행에서만 꺼낸다(소비와 함께 사라진다).
  let startedBy: string | null = null;
  let codeVerifier: string | undefined;
  try {
    const used = await query(
      `DELETE FROM sns_oauth_states
        WHERE state_nonce = $1 AND company_id = $2::uuid AND expires_at > NOW()
        RETURNING state_nonce, created_by, payload`,
      [st.nonce, st.companyId],
    );
    if (used.rowCount === 0) {
      return res.status(400).send(renderSnsReturnHtml('error', '연결 요청이 만료되었어요. 한줄로 화면에서 다시 시작해 주세요.', platform, null, st.nonce));
    }
    startedBy = used.rows[0]?.created_by ?? null;
    const verifier = used.rows[0]?.payload?.code_verifier;
    codeVerifier = typeof verifier === 'string' && verifier ? verifier : undefined;
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
    const token = await adapter.exchangeToken(creds.credentials, code, { codeVerifier });

    // ★ 1차-B — 로그인 1회에 계정이 여럿인 채널(페이스북 = 페이지 N개). 페이지마다 자기 토큰으로 한 행씩.
    if (adapter.fetchAccounts) {
      const list = await adapter.fetchAccounts(token.accessToken);
      if (list.length === 0) {
        return res.send(renderSnsReturnHtml('error', '연결할 페이지가 없어요. 페이지를 관리하는 계정으로 다시 시도해 주세요.', platform, null, st.nonce));
      }
      const saved: Array<{ id: string; profile: typeof list[number]['profile'] }> = [];
      for (const item of list) {
        const row = await upsertPendingAccount({
          companyId: st.companyId,
          platform,
          externalAccountId: item.profile.externalAccountId,
          token: item.token,
          connectedBy: startedBy,
        });
        saved.push({ id: row.id, profile: item.profile });
      }
      void (async () => {
        for (const s of saved) {
          try { await applyAccountProfile(st.companyId, s.id, s.profile); } catch (e) { console.error('[SNS callback] 프로필 반영 오류:', e); }
        }
      })();
      return res.send(renderSnsReturnHtml('ok', `${saved.length}개를 연결했어요. 이 창은 자동으로 닫힙니다.`, platform, saved[0].id, st.nonce));
    }

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
    // ★ 1차-B — 페이스북은 로그인한 **사람의 id** 를 준다. 페이지 행은 연결 때 남긴 `meta.profile.owner_user_id` 로 찾는다.
    const byOwner = getSnsAdapter(platform)?.deauthKey === 'owner';
    const rows = await query(
      byOwner
        ? `SELECT id, company_id FROM sns_accounts
            WHERE platform = $1 AND meta->'profile'->>'owner_user_id' = $2 AND status <> 'revoked'`
        : `SELECT id, company_id FROM sns_accounts
            WHERE platform = $1 AND external_account_id = $2 AND status <> 'revoked'`,
      [platform, externalId],
    );
    for (const row of rows.rows) {
      // ★ 2026-09-24 Harold 결정 Q1 가(기다림) — 계정만 닫고 예약은 미리 닫지 않는다.
      //   다시 연결하면 원래 시각에 나가고, 끝내 연결이 안 되면 발행 워커가 그 시각에 사유와 함께 닫는다.
      //   끊긴 동안은 화면 '확인할 것' 띠가 기다리는 예약 수와 함께 알린다(조용히 실패 0).
      await setSnsAccountStatus(row.company_id, row.id, 'reauth_required', '채널에서 연결 권한이 해제되었어요. 다시 연결해 주세요.');
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
