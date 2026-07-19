/**
 * routes/image-studio.ts — P4 AI 이미지 스튜디오 API (2026-07-19)
 *
 * 흐름: 상품 누끼(픽셀 보존) → AI 배경 생성 → 서버 합성(/compose) → 정제 타이포 → 저장(라이브러리).
 * 크레딧: checkCredit(사전 402) → Gemini 성공 → deductCreditSafe(멱등키 image-studio:{uuid}).
 * 에러: Gemini/py 원문 미노출(StudioError 코드 매핑만) — 모델명 노출 차단(§5-1-11).
 *
 * endpoint:
 *   GET  /status                       — 준비 여부 + temp 사용량
 *   POST /generate                     — 배경 후보 2장(2크레딧, 부분성공 1)
 *   POST /ingest-product {url}         — 연동몰 CDN 이미지 SSRF 가드 fetch → source temp
 *   POST /upload-product (multipart)   — 제품 이미지 업로드 → source temp
 *   POST /remove-bg {sourceTempId}     — 누끼(무료) → cutout temp
 *   POST /edit {tempId, instruction?, targetSize?} — 멀티턴 보존 편집/4K 격상
 *   POST /compose {...}                — 서버 합성(무료) → composite temp
 *   POST /save {tempId, channelSpec?}  — 영구 저장 + cdp_assets 등재(tempId 1회성)
 *   GET  /temp/:tempId                 — 인증 서빙(프론트 fetch+blob)
 */

import { Router, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import net from 'net';
import { authenticate } from '../middlewares/auth';
import { LIMITS } from '../config/defaults';
import { checkCredit, deductCreditSafe, InsufficientCreditError } from '../utils/ai-credit';
import { registerAsset, getStorageUsage, isAssetsTableMissing } from '../utils/assets';
import {
  isStudioReady, StudioError, CREDIT_SOURCE,
  resolvePreset, resolvePurpose, buildMarketingPrompt, hasBenefitPattern,
  generateBackground, editOrUpscale, UPSCALE_4K_INSTRUCTION, buildEditInstruction,
  removeBackground, composeImage,
  writeTempBuffer, allocTempPath, writeTempMeta, readTempMeta, findTempFile, moveTempToPermanent,
  companyTempUsageBytes, isValidTempId, newTempId,
  tryAcquireGenerateLock, releaseGenerateLock,
  STUDIO_TEMP_CAP_BYTES, STUDIO_TEMP_TTL_DAYS,
  type ComposeTypography,
} from '../utils/image-studio';

export const imageStudioRouter = Router();
imageStudioRouter.use(authenticate);

const FONT_DIR = process.env.STUDIO_FONT_DIR || path.resolve('./uploads/fonts');

// StudioError / 크레딧 부족 → 표준 응답. 그 외 = 로그 후 GEN_FAILED.
function respondStudioError(res: Response, err: any): Response {
  if (err instanceof StudioError) {
    return res.status(err.httpStatus).json({ success: false, error: err.userMessage, code: err.code });
  }
  if (err instanceof InsufficientCreditError) {
    return res.status(402).json({ success: false, error: '크레딧이 부족합니다. 충전 후 다시 시도해주세요.', code: 'INSUFFICIENT_CREDIT' });
  }
  console.error('[image-studio] 처리 오류:', err?.message || err);
  return res.status(502).json({ success: false, error: '이미지 생성에 실패했어요. 잠시 후 다시 시도해주세요.', code: 'GEN_FAILED' });
}

// ── GET /status ──────────────────────────────────────────────
imageStudioRouter.get('/status', (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const usageBytes = companyId ? companyTempUsageBytes(companyId) : 0;
  return res.json({
    success: true,
    ready: isStudioReady(),
    tempCapBytes: STUDIO_TEMP_CAP_BYTES,
    tempUsageBytes: usageBytes,
    tempTtlDays: STUDIO_TEMP_TTL_DAYS,
  });
});

// ── POST /generate ───────────────────────────────────────────
imageStudioRouter.post('/generate', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  if (!isStudioReady()) return respondStudioError(res, new StudioError('STUDIO_NOT_READY', 503));

  const { purposeKey, presetKey, userHint } = req.body || {};
  const preset = resolvePreset(presetKey);
  resolvePurpose(purposeKey); // 검증(미존재 시 기본)

  // 사전 차단(최대 2크레딧 기준)
  try { await checkCredit(companyId, 2); } catch (err) { return respondStudioError(res, err); }

  // 회사당 동시 생성 1건 (fork 단일 = in-memory)
  if (!tryAcquireGenerateLock(companyId)) return respondStudioError(res, new StudioError('BUSY', 409));

  try {
    // temp 상한 검사(200MB)
    if (companyTempUsageBytes(companyId) >= STUDIO_TEMP_CAP_BYTES) {
      return res.status(409).json({ success: false, error: '임시 보관 용량이 가득 찼습니다. 저장하거나 정리 후 다시 시도해주세요.', code: 'TEMP_FULL' });
    }

    const benefitBlocked = hasBenefitPattern(userHint);
    const prompt = buildMarketingPrompt({
      purposeKey, presetKey, userHint: benefitBlocked ? null : userHint, forProductComposite: true,
    });

    // 후보 2장 병렬 생성
    const settled = await Promise.allSettled([
      generateBackground(prompt, preset),
      generateBackground(prompt, preset),
    ]);
    const oks = settled.filter((s) => s.status === 'fulfilled').map((s: any) => s.value);

    if (oks.length === 0) {
      // 전부 실패 — 세이프티면 미차감 SAFETY, 아니면 첫 에러.
      const firstErr = (settled.find((s) => s.status === 'rejected') as any)?.reason;
      const anySafety = settled.some((s) => s.status === 'rejected' && (s as any).reason?.code === 'SAFETY_BLOCKED');
      return respondStudioError(res, anySafety ? new StudioError('SAFETY_BLOCKED', 400) : (firstErr || new StudioError('GEN_FAILED', 502)));
    }

    // temp 기록
    const images = oks.map((img) => {
      const buf = Buffer.from(img.base64, 'base64');
      const ext = (img.mime.split('/')[1] || 'jpeg').replace('jpg', 'jpeg');
      const tempId = writeTempBuffer(companyId, buf, {
        kind: 'background', ext, mime: img.mime, prompt, presetKey: preset.key,
        channelSpec: preset.channelSpec, aspectRatio: preset.aspectRatio, width: null, height: null,
      });
      return { tempId, url: `/api/image-studio/temp/${tempId}` };
    });

    // 성공 후 차감 — 성공 장수만큼(부분성공 1). 멱등키 = 생성 요청 uuid.
    const cost = Math.min(2, oks.length);
    const genReqId = newTempId();
    await deductCreditSafe({
      companyId, cost, source: CREDIT_SOURCE.generate, createdBy: userId,
      idempotencyKey: `image-studio:${genReqId}`,
    });

    return res.json({
      success: true,
      images,
      partial: oks.length < 2,
      benefitNotice: benefitBlocked ? '문구(할인·혜택)는 이미지에 새기지 않고 텍스트 편집에서 얹어주세요.' : null,
    });
  } catch (err) {
    return respondStudioError(res, err);
  } finally {
    releaseGenerateLock(companyId);
  }
});

// ── POST /edit (멀티턴 보존 편집 / 4K 격상) ─────────────────────
imageStudioRouter.post('/edit', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  if (!isStudioReady()) return respondStudioError(res, new StudioError('STUDIO_NOT_READY', 503));

  const { tempId, instruction, targetSize } = req.body || {};
  if (!isValidTempId(tempId)) return res.status(400).json({ success: false, error: '대상 이미지를 찾을 수 없습니다.' });
  const found = findTempFile(companyId, tempId);
  const meta = readTempMeta(companyId, tempId);
  if (!found || !meta || meta.kind !== 'background') {
    return res.status(404).json({ success: false, error: '편집 가능한 배경 이미지가 아닙니다.', code: 'NOT_BACKGROUND' });
  }

  const is4k = String(targetSize) === '4K';
  const cost = is4k ? 2 : 1;
  const source = is4k ? CREDIT_SOURCE.upscale4k : CREDIT_SOURCE.edit;
  if (!is4k && !(instruction && String(instruction).trim())) {
    return res.status(400).json({ success: false, error: '어떻게 바꿀지 알려주세요.' });
  }

  try { await checkCredit(companyId, cost); } catch (err) { return respondStudioError(res, err); }
  if (!tryAcquireGenerateLock(companyId)) return respondStudioError(res, new StudioError('BUSY', 409));

  try {
    const base = fs.readFileSync(found.absPath).toString('base64');
    const result = await editOrUpscale({
      baseImageBase64: base, baseMime: found.mime,
      basePrompt: meta.prompt || 'A clean product-staging background scene.',
      instruction: is4k ? UPSCALE_4K_INSTRUCTION : buildEditInstruction(instruction),
      imageSize: is4k ? '4K' : '2K',
      aspectRatio: meta.aspectRatio || resolvePreset(meta.presetKey || undefined).aspectRatio,
    });

    const buf = Buffer.from(result.base64, 'base64');
    const ext = (result.mime.split('/')[1] || 'jpeg').replace('jpg', 'jpeg');
    const newTemp = writeTempBuffer(companyId, buf, {
      kind: 'background', ext, mime: result.mime,
      prompt: meta.prompt, presetKey: meta.presetKey, channelSpec: meta.channelSpec,
      aspectRatio: meta.aspectRatio, width: null, height: null,
    });

    const editReqId = newTempId();
    await deductCreditSafe({ companyId, cost, source, createdBy: userId, idempotencyKey: `image-studio:${editReqId}` });

    return res.json({ success: true, image: { tempId: newTemp, url: `/api/image-studio/temp/${newTemp}` } });
  } catch (err) {
    return respondStudioError(res, err);
  } finally {
    releaseGenerateLock(companyId);
  }
});

// ── POST /ingest-product (SSRF 가드 fetch) ──────────────────────
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;             // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT
    return false;
  }
  const low = ip.toLowerCase();
  return low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80') || low.startsWith('::ffff:127.') || low.startsWith('::ffff:10.') || low.startsWith('::ffff:192.168.');
}

imageStudioRouter.post('/ingest-product', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  const rawUrl = String(req.body?.url || '').trim();

  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return respondStudioError(res, new StudioError('INGEST_FAILED', 400)); }
  if (parsed.protocol !== 'https:') return respondStudioError(res, new StudioError('INGEST_FAILED', 400));
  if (parsed.username || parsed.password) return respondStudioError(res, new StudioError('INGEST_FAILED', 400));

  try {
    // DNS 해석 후 사설 IP 차단(SSRF). IP 리터럴도 동일 검사.
    const host = parsed.hostname;
    const addrs = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true })).map((a) => a.address);
    if (addrs.length === 0 || addrs.some((ip) => isPrivateIp(ip))) {
      return respondStudioError(res, new StudioError('INGEST_FAILED', 400));
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    let r: Awaited<ReturnType<typeof fetch>>;
    try {
      r = await fetch(parsed.toString(), { redirect: 'manual', signal: ac.signal });
    } finally { clearTimeout(timer); }
    // 리다이렉트는 SSRF 우회 경로 → 거부(직접 CDN URL만 허용)
    if (r.status >= 300 && r.status < 400) return respondStudioError(res, new StudioError('INGEST_FAILED', 400));
    if (!r.ok) return respondStudioError(res, new StudioError('INGEST_FAILED', 400));

    const ctype = String(r.headers.get('content-type') || '').toLowerCase();
    if (!ctype.startsWith('image/')) return respondStudioError(res, new StudioError('INGEST_FAILED', 400));
    const clen = Number(r.headers.get('content-length') || 0);
    if (clen && clen > 10 * 1024 * 1024) return respondStudioError(res, new StudioError('INGEST_FAILED', 413));

    const ab = await r.arrayBuffer();
    if (ab.byteLength > 10 * 1024 * 1024) return respondStudioError(res, new StudioError('INGEST_FAILED', 413));
    const buf = Buffer.from(ab);
    const ext = ctype.includes('png') ? 'png' : ctype.includes('webp') ? 'webp' : 'jpeg';
    const tempId = writeTempBuffer(companyId, buf, { kind: 'source', ext, mime: ctype, width: null, height: null });
    return res.json({ success: true, source: { tempId, url: `/api/image-studio/temp/${tempId}` } });
  } catch (err) {
    return respondStudioError(res, err);
  }
});

// ── POST /upload-product (multipart) ───────────────────────────
const productUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.toLowerCase().startsWith('image/')) cb(null, true);
    else cb(new Error('이미지 파일만 업로드할 수 있습니다.'));
  },
});
imageStudioRouter.post('/upload-product', (req: any, res: Response) => {
  productUpload.single('image')(req, res, (err: any) => {
    if (err) return res.status(400).json({ success: false, error: err.message || '업로드 실패' });
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ success: false, error: '이미지를 선택해주세요.' });
    const ctype = file.mimetype.toLowerCase();
    const ext = ctype.includes('png') ? 'png' : ctype.includes('webp') ? 'webp' : 'jpeg';
    const tempId = writeTempBuffer(companyId, file.buffer, { kind: 'source', ext, mime: ctype, width: null, height: null });
    return res.json({ success: true, source: { tempId, url: `/api/image-studio/temp/${tempId}` } });
  });
});

// ── POST /remove-bg (누끼 — 무료) ───────────────────────────────
imageStudioRouter.post('/remove-bg', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  const { sourceTempId } = req.body || {};
  const src = findTempFile(companyId, sourceTempId);
  if (!src) return res.status(404).json({ success: false, error: '원본 이미지를 찾을 수 없습니다.' });

  try {
    const { tempId, absPath } = allocTempPath(companyId, 'png');
    const { width, height } = await removeBackground(src.absPath, absPath);
    writeTempMeta(companyId, tempId, { kind: 'cutout', ext: 'png', mime: 'image/png', width, height });
    return res.json({ success: true, cutout: { tempId, url: `/api/image-studio/temp/${tempId}`, width, height } });
  } catch (err) {
    return respondStudioError(res, err);
  }
});

// ── POST /compose (서버 합성 — 무료) ────────────────────────────
imageStudioRouter.post('/compose', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

  const { bgTempId, cutoutTempId, layout, typography, presetKey } = req.body || {};
  const bg = findTempFile(companyId, bgTempId);
  const bgMeta = readTempMeta(companyId, bgTempId);
  if (!bg || !bgMeta) return res.status(404).json({ success: false, error: '배경 이미지를 찾을 수 없습니다.' });
  const cutout = cutoutTempId ? findTempFile(companyId, cutoutTempId) : null;
  if (cutoutTempId && !cutout) return res.status(404).json({ success: false, error: '누끼 이미지를 찾을 수 없습니다.' });

  const preset = resolvePreset(presetKey || bgMeta.presetKey || undefined);
  const isMms = preset.track === 'mms';

  // 타이포 폰트 키 → 서버 폰트 경로(있으면). 없으면 python이 기본 폰트 폴백.
  const typo: ComposeTypography[] = Array.isArray(typography)
    ? typography.slice(0, 5).map((t: any) => {
        const key = String(t.font || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const fp = key ? path.join(FONT_DIR, `${key}.ttf`) : '';
        return {
          text: String(t.text || '').slice(0, 200),
          fontPath: fp && fs.existsSync(fp) ? fp : null,
          size: Math.min(0.3, Math.max(0.01, Number(t.size) || 0.06)),
          color: /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : '#ffffff',
          align: ['left', 'center', 'right'].includes(t.align) ? t.align : 'center',
          x: Math.min(1, Math.max(0, Number(t.x) || 0.5)),
          y: Math.min(1, Math.max(0, Number(t.y) || 0.1)),
        } as ComposeTypography;
      }).filter((t) => t.text)
    : [];

  try {
    const { tempId, absPath } = allocTempPath(companyId, 'jpeg');
    const r = await composeImage({
      bgPath: bg.absPath,
      cutoutPath: cutout?.absPath || null,
      outPath: absPath,
      layout: layout && typeof layout === 'object' ? {
        x: Math.min(1, Math.max(0, Number(layout.x) || 0.5)),
        y: Math.min(1, Math.max(0, Number(layout.y) || 0.72)),
        scale: Math.min(1, Math.max(0.1, Number(layout.scale) || 0.5)),
      } : null,
      typography: typo,
      mmsMaxBytes: isMms ? LIMITS.mmsImageSize : null,
      format: 'jpeg',
    });
    writeTempMeta(companyId, tempId, {
      kind: 'composite', ext: 'jpeg', mime: r.mime, prompt: bgMeta.prompt,
      presetKey: preset.key, channelSpec: preset.channelSpec, width: r.width, height: r.height,
      aspectRatio: preset.aspectRatio,
    });
    return res.json({ success: true, composite: { tempId, url: `/api/image-studio/temp/${tempId}`, bytes: r.bytes, width: r.width, height: r.height } });
  } catch (err) {
    return respondStudioError(res, err);
  }
});

// ── POST /save (영구 저장 + cdp_assets 등재) ─────────────────────
imageStudioRouter.post('/save', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

  const { tempId, channelSpec } = req.body || {};
  if (!isValidTempId(tempId)) return res.status(400).json({ success: false, error: '저장할 이미지를 찾을 수 없습니다.' });
  const meta = readTempMeta(companyId, tempId);
  const found = findTempFile(companyId, tempId);
  if (!meta || !found) {
    // 사이드카/파일 없음 = 이미 저장됨(1회성 소비) 또는 만료 → 409(더블클릭 중복 등재 차단 M-2)
    return res.status(409).json({ success: false, error: '이미 저장됐거나 만료된 이미지입니다.', code: 'ALREADY_SAVED' });
  }

  try {
    // 플랜 용량 한도 검사(P3 CT 재사용) — 실제 산출물 크기로 판정
    const usage = await getStorageUsage(companyId);
    const projected = usage.usedBytes + (fs.existsSync(found.absPath) ? fs.statSync(found.absPath).size : 0);
    if (projected > usage.limitBytes) {
      return res.status(409).json({ success: false, error: '저장 용량 한도를 초과했습니다. 라이브러리에서 정리 후 다시 저장해주세요.', code: 'STORAGE_FULL' });
    }

    const moved = moveTempToPermanent(companyId, tempId);
    if (!moved) return res.status(409).json({ success: false, error: '이미 저장됐거나 만료된 이미지입니다.', code: 'ALREADY_SAVED' });

    const format = moved.ext === 'png' ? 'png' : 'jpg';
    const assetId = await registerAsset({
      companyId, createdBy: userId, kind: 'generated', origin: 'studio',
      url: moved.url, filename: moved.filename, bytes: moved.bytes, format,
      prompt: meta.prompt || null,
      channelSpec: channelSpec || meta.channelSpec || null,
      width: meta.width ?? null, height: meta.height ?? null,
    });

    return res.json({ success: true, asset: { id: assetId, url: moved.url, bytes: moved.bytes, channelSpec: channelSpec || meta.channelSpec || null } });
  } catch (err: any) {
    if (isAssetsTableMissing(err)) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 cdp_assets 테이블 확인 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    return respondStudioError(res, err);
  }
});

// ── GET /temp/:tempId (인증 서빙 — 프론트 fetch+blob) ────────────
imageStudioRouter.get('/temp/:tempId', (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ error: '권한 없음' });
  const { tempId } = req.params;
  if (!isValidTempId(tempId)) return res.status(400).json({ error: '잘못된 요청' });
  const found = findTempFile(companyId, tempId); // 회사 dir 안에서만 조회 = 소유 검증
  if (!found) return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
  res.setHeader('Content-Type', found.mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=600');
  return res.sendFile(found.absPath);
});

export default imageStudioRouter;
