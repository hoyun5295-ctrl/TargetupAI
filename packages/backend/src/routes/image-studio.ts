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
import { registerAsset, getStorageUsage, isAssetsTableMissing, getAsset } from '../utils/assets';
import {
  isStudioReady, StudioError, CREDIT_SOURCE,
  resolvePreset, buildPosterPrompt, hasBenefitPattern, buildAssetDisplayName,
  refitImage, resolvePermanentAssetPath, deriveHeadlineFromDisplayName,
  generatePoster, editOrUpscale, UPSCALE_4K_INSTRUCTION, buildEditInstruction,
  removeBackground, composeImage,
  writeTempBuffer, allocTempPath, writeTempMeta, readTempMeta, findTempFile, moveTempToPermanent,
  companyTempUsageBytes, isValidTempId, newTempId,
  tryAcquireGenerateLock, releaseGenerateLock,
  STUDIO_TEMP_CAP_BYTES, STUDIO_TEMP_TTL_DAYS,
  type ComposeTypography,
} from '../utils/image-studio';
import { getTemplate, listTemplatesPublic } from '../utils/image-studio-templates';

export const imageStudioRouter = Router();
imageStudioRouter.use(authenticate);

const FONT_DIR = process.env.STUDIO_FONT_DIR || path.resolve('./uploads/fonts');
// 라이브러리 자산 실물 경로 — utils/assets.ts와 동일 정의 미러(단일 env 소스)
const INAPP_IMAGE_BASE = process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp');
// MMS 이미지 저장소 — routes/mms-images.ts와 동일 정의 미러(변환 산출물을 기존 발송 계약 저장소로)
const MMS_IMAGE_BASE = process.env.MMS_IMAGE_PATH || path.resolve('./uploads/mms');

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

// ── GET /templates — 갤러리 공개 목록(★은닉 스캐폴드 미포함) ─────────
imageStudioRouter.get('/templates', (_req: any, res: Response) => {
  return res.json({ success: true, templates: listTemplatesPublic() });
});

// ── POST /generate — 템플릿 + 누끼 + 지정 문구 → 완성 포스터 후보 2장 ──
imageStudioRouter.post('/generate', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  if (!isStudioReady()) return respondStudioError(res, new StudioError('STUDIO_NOT_READY', 503));

  const { templateId, presetKey, userHint, texts, cutoutTempId } = req.body || {};
  const template = getTemplate(String(templateId || ''));
  if (!template) return res.status(400).json({ success: false, error: '템플릿을 선택해주세요.' });
  const preset = resolvePreset(presetKey);

  // 누끼 첨부(선택) — 있으면 제품 포함 완성 포스터, 없으면 문구 포함 배경 포스터
  let cutout: { base64: string; mime: string } | null = null;
  if (cutoutTempId) {
    const cf = findTempFile(companyId, String(cutoutTempId));
    const cm = readTempMeta(companyId, String(cutoutTempId));
    if (!cf || !cm || (cm.kind !== 'cutout' && cm.kind !== 'source')) {
      return res.status(404).json({ success: false, error: '제품 이미지를 찾을 수 없습니다. 다시 준비해주세요.' });
    }
    cutout = { base64: fs.readFileSync(cf.absPath).toString('base64'), mime: cf.mime };
  }

  // 사전 차단(최대 2크레딧 기준)
  try { await checkCredit(companyId, 2); } catch (err) { return respondStudioError(res, err); }

  // 회사당 동시 생성 1건 (fork 단일 = in-memory)
  if (!tryAcquireGenerateLock(companyId)) return respondStudioError(res, new StudioError('BUSY', 409));

  try {
    // temp 상한 검사(200MB)
    if (companyTempUsageBytes(companyId) >= STUDIO_TEMP_CAP_BYTES) {
      return res.status(409).json({ success: false, error: '임시 보관 용량이 가득 찼습니다. 저장하거나 정리 후 다시 시도해주세요.', code: 'TEMP_FULL' });
    }

    const benefitInHint = hasBenefitPattern(userHint);
    const prompt = buildPosterPrompt({
      template, preset,
      texts: { label: texts?.label, title: texts?.title, subtitle: texts?.subtitle },
      userHint: benefitInHint ? null : userHint,
      hasProduct: !!cutout,
    });

    // 후보 2장 병렬 생성
    const settled = await Promise.allSettled([
      generatePoster(prompt, preset, cutout),
      generatePoster(prompt, preset, cutout),
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
        kind: 'poster', ext, mime: img.mime, prompt, presetKey: preset.key,
        channelSpec: preset.channelSpec, aspectRatio: preset.aspectRatio, width: null, height: null,
      });
      return { tempId, url: `/api/image-studio/temp/${tempId}`, presetKey: preset.key };
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
      benefitNotice: benefitInHint ? '혜택 문구는 문구 칸(라벨·헤드라인·부제)에 입력해주세요 — 장면 힌트에는 장면 묘사만 들어가요.' : null,
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
  if (!found || !meta || (meta.kind !== 'background' && meta.kind !== 'poster')) {
    return res.status(404).json({ success: false, error: '편집 가능한 생성 이미지가 아닙니다.', code: 'NOT_EDITABLE' });
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
      kind: meta.kind, ext, mime: result.mime,
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

  const { tempId, channelSpec, title } = req.body || {};
  if (!isValidTempId(tempId)) return res.status(400).json({ success: false, error: '저장할 이미지를 찾을 수 없습니다.' });
  let meta = readTempMeta(companyId, tempId);
  let found = findTempFile(companyId, tempId);
  if (!meta || !found) {
    // 사이드카/파일 없음 = 이미 저장됨(1회성 소비) 또는 만료 → 409(더블클릭 중복 등재 차단 M-2)
    return res.status(409).json({ success: false, error: '이미 저장됐거나 만료된 이미지입니다.', code: 'ALREADY_SAVED' });
  }

  try {
    const effectiveSpec = channelSpec || meta.channelSpec || null;
    let effTempId: string = tempId;

    // ★ MMS 트랙 = 서버가 저장 직전 1080px + JPEG ≤300KB 압축 보장(§4-4 — 사용자가 오버사이즈를 만들 수 없음)
    if (effectiveSpec === 'mms') {
      const alloc = allocTempPath(companyId, 'jpeg');
      const r = await composeImage({
        bgPath: found.absPath, cutoutPath: null, outPath: alloc.absPath,
        layout: null, typography: [], mmsMaxBytes: LIMITS.mmsImageSize, format: 'jpeg',
      });
      writeTempMeta(companyId, alloc.tempId, {
        kind: 'composite', ext: 'jpeg', mime: 'image/jpeg', prompt: meta.prompt || null,
        presetKey: meta.presetKey || null, channelSpec: 'mms', width: r.width, height: r.height,
        aspectRatio: meta.aspectRatio || null,
      });
      // 원본 temp 1회성 소비(중복 저장 차단)
      const dir = path.dirname(found.absPath);
      try { fs.unlinkSync(found.absPath); } catch { /* noop */ }
      try { fs.unlinkSync(path.join(dir, `${tempId}.json`)); } catch { /* noop */ }
      effTempId = alloc.tempId;
      meta = readTempMeta(companyId, effTempId);
      found = findTempFile(companyId, effTempId);
      if (!meta || !found) return respondStudioError(res, new StudioError('GEN_FAILED', 502));
    }

    // 플랜 용량 한도 검사(P3 CT 재사용) — 실제 산출물 크기로 판정
    const usage = await getStorageUsage(companyId);
    const projected = usage.usedBytes + (fs.existsSync(found.absPath) ? fs.statSync(found.absPath).size : 0);
    if (projected > usage.limitBytes) {
      return res.status(409).json({ success: false, error: '저장 용량 한도를 초과했습니다. 라이브러리에서 정리 후 다시 저장해주세요.', code: 'STORAGE_FULL' });
    }

    const moved = moveTempToPermanent(companyId, effTempId);
    if (!moved) return res.status(409).json({ success: false, error: '이미 저장됐거나 만료된 이미지입니다.', code: 'ALREADY_SAVED' });

    const format = moved.ext === 'png' ? 'png' : 'jpg';
    // ★ 2026-07-21 표시명 = "헤드라인_채널.ext" (랜덤 UUID 대신 — 용도 체킹 동시). 실제 파일(moved.url)은 tempId 유지.
    const displayName = buildAssetDisplayName(title, effectiveSpec, moved.ext);
    const assetId = await registerAsset({
      companyId, createdBy: userId, kind: 'generated', origin: 'studio',
      url: moved.url, filename: displayName, bytes: moved.bytes, format,
      prompt: meta.prompt || null,
      channelSpec: effectiveSpec,
      width: meta.width ?? null, height: meta.height ?? null,
    });

    return res.json({ success: true, asset: { id: assetId, url: moved.url, bytes: moved.bytes, channelSpec: effectiveSpec } });
  } catch (err: any) {
    if (isAssetsTableMissing(err)) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 cdp_assets 테이블 확인 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    return respondStudioError(res, err);
  }
});

// ── POST /mms-from-asset — 라이브러리 소재 → MMS 규격(≤300KB JPG) 변환 (무료) ──
//   ★ 2026-07-19 Harold 확정: 스튜디오는 고품질만 생성·저장하고, MMS는 발송 시점에 기존 소재를 변환.
//   산출물 = 기존 MMS 저장소(MMS_IMAGE_BASE) + 업로드 응답 계약 동일 {serverPath,url,filename,size}
//   → 발송 경로(mms_image_paths·QTmsg 절대경로 계약) 무수정 접속. 300KB는 서버 실측 보장.
imageStudioRouter.post('/mms-from-asset', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  const assetId = String(req.body?.assetId || '');
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return res.status(400).json({ success: false, error: '소재를 찾을 수 없습니다.' });

  try {
    const asset = await getAsset(companyId, assetId);
    if (!asset) return res.status(404).json({ success: false, error: '소재를 찾을 수 없습니다.' });
    // 우리 서빙 URL(인앱 이미지 저장소)만 로컬 변환 대상 — deleteAsset과 동일 패턴
    const m = String(asset.url || '').match(/^\/api\/cdp\/inapp\/image\/([^/]+)\/([^/?#]+)$/);
    if (!m || m[1] !== companyId) {
      return res.status(400).json({ success: false, error: '이 소재는 MMS로 변환할 수 없습니다. 스튜디오·업로드 소재를 사용해주세요.' });
    }
    const srcPath = path.join(INAPP_IMAGE_BASE, companyId, m[2]);
    if (!fs.existsSync(srcPath)) return res.status(404).json({ success: false, error: '소재 원본 파일을 찾을 수 없습니다.' });

    const destDir = path.join(MMS_IMAGE_BASE, companyId);
    fs.mkdirSync(destDir, { recursive: true });
    const filename = `${newTempId()}.jpg`;
    const outPath = path.join(destDir, filename);
    const r = await composeImage({
      bgPath: srcPath, cutoutPath: null, outPath,
      layout: null, typography: [], mmsMaxBytes: LIMITS.mmsImageSize, format: 'jpeg',
    });
    return res.json({
      success: true,
      image: {
        serverPath: path.resolve(outPath),
        url: `/api/mms-images/${companyId}/${filename}`,
        filename,
        originalName: asset.filename || filename,
        size: r.bytes,
      },
    });
  } catch (err: any) {
    if (isAssetsTableMissing(err)) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 cdp_assets 테이블 확인 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    return respondStudioError(res, err);
  }
});

// ── POST /convert-channel — 완성 소재를 다른 채널 비율로 재맞춤(1크레딧) → 라이브러리 추가 ────────────
//   [근본] DM용 1:1 소재는 인앱(3:4)·이메일(16:9)에 그대로 못 쓴다 → 대상 비율로 재맞춤.
//   ★ 2026-07-21 AI 재생성(editOrUpscale) 폐기 — 상품 색·디테일을 바꿔버려(검정 스커트→흰색 사고) 원본 파괴.
//     studio-py /refit = 원본 픽셀 100% 보존(배경 연장)만. 크레딧 1은 유지(Harold 확정) · 저장 성공 후 차감.
imageStudioRouter.post('/convert-channel', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  if (!isStudioReady()) return respondStudioError(res, new StudioError('STUDIO_NOT_READY', 503));

  const assetId = String(req.body?.assetId || '');
  const preset = resolvePreset(String(req.body?.targetPreset || ''));
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return res.status(400).json({ success: false, error: '소재를 찾을 수 없습니다.' });

  try {
    const asset = await getAsset(companyId, assetId);
    if (!asset) return res.status(404).json({ success: false, error: '소재를 찾을 수 없습니다.' });
    if ((asset.channel_spec || '') === preset.channelSpec) {
      return res.status(400).json({ success: false, error: '이미 이 채널용 이미지예요.' });
    }
    const srcPath = resolvePermanentAssetPath(companyId, asset.url);
    if (!srcPath) return res.status(400).json({ success: false, error: '이 소재는 변환할 수 없습니다. 스튜디오·업로드 소재를 사용해주세요.' });

    // 크레딧 사전 확인(부족 시 402) — 실제 차감은 저장 성공 후
    try { await checkCredit(companyId, 1); } catch (err) { return respondStudioError(res, err); }
    if (!tryAcquireGenerateLock(companyId)) return respondStudioError(res, new StudioError('BUSY', 409));

    try {
      // 비율 재맞춤(원본 보존·배경 연장) — studio-py가 out 경로에 직접 씀(파일 경로 기반, AI 0)
      const alloc = allocTempPath(companyId, 'jpeg');
      const r = await refitImage({ srcPath, outPath: alloc.absPath, aspectRatio: preset.aspectRatio, format: 'jpeg' });
      writeTempMeta(companyId, alloc.tempId, {
        kind: 'poster', ext: 'jpeg', mime: 'image/jpeg', prompt: asset.prompt || null,
        presetKey: preset.key, channelSpec: preset.channelSpec, aspectRatio: preset.aspectRatio,
        width: r.width, height: r.height,
      });

      // 용량 한도 검사(영구 이동 전, temp 실크기로) — 초과 시 크레딧 미차감(temp는 TTL 정리)
      const usage = await getStorageUsage(companyId);
      const tf = findTempFile(companyId, alloc.tempId);
      const tempBytes = tf && fs.existsSync(tf.absPath) ? fs.statSync(tf.absPath).size : 0;
      if (usage.usedBytes + tempBytes > usage.limitBytes) {
        return res.status(409).json({ success: false, error: '저장 용량 한도를 초과했습니다. 라이브러리에서 정리 후 다시 시도해주세요.', code: 'STORAGE_FULL' });
      }

      const moved = moveTempToPermanent(companyId, alloc.tempId);
      if (!moved) return respondStudioError(res, new StudioError('GEN_FAILED', 502));

      // 표시명 = 원본 헤드라인 + 대상 채널(채널만 교체) — 용도 체킹 유지
      const displayName = buildAssetDisplayName(deriveHeadlineFromDisplayName(asset.filename), preset.channelSpec, moved.ext);
      const newAssetId = await registerAsset({
        companyId, createdBy: userId, kind: 'generated', origin: 'studio',
        url: moved.url, filename: displayName, bytes: moved.bytes, format: 'jpg',
        prompt: asset.prompt || null, channelSpec: preset.channelSpec,
        width: r.width || null, height: r.height || null,
      });

      // 저장 성공 후 차감(멱등키) — 6원칙 ②효과 검증 후, ⑤돈=성공 확인 후. AI 미사용이나 크레딧 1 유지(Harold 확정)
      const convReqId = newTempId();
      await deductCreditSafe({ companyId, cost: 1, source: CREDIT_SOURCE.channelConvert, createdBy: userId, idempotencyKey: `image-studio:${convReqId}` });

      return res.json({ success: true, asset: { id: newAssetId, url: moved.url, filename: displayName, bytes: moved.bytes, channelSpec: preset.channelSpec } });
    } finally {
      releaseGenerateLock(companyId);
    }
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
