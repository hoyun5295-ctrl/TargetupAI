/**
 * routes/image-studio.ts — P4 AI 이미지 스튜디오 API (2026-07-19)
 *
 * 흐름: 상품 누끼(픽셀 보존) → AI 배경 생성 → 서버 합성(/compose) → 정제 타이포 → 저장(라이브러리).
 * 크레딧: checkCredit(사전 402) → Gemini 성공 → deductCreditSafe(멱등키 image-studio:{uuid}).
 * 에러: Gemini/py 원문 미노출(StudioError 코드 매핑만) — 모델명 노출 차단(§5-1-11).
 *
 * endpoint:
 *   GET  /status                       — 준비 여부 + temp 사용량
 *   POST /generate                     — 완성 포스터 1장(2크레딧) ★2026-07-30 후보 2장→1장(같은 프롬프트 무작위 2회였음·레시피 차이 없음), 크레딧 2 유지(Harold 확정)
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
import { resolveOwnerScope } from '../utils/owner-scope';
import { LIMITS } from '../config/defaults';
import { checkCredit, deductCreditSafe, InsufficientCreditError } from '../utils/ai-credit';
import { registerAsset, getStorageUsage, isAssetsTableMissing, getAsset } from '../utils/assets';
import {
  isStudioReady, StudioError, CREDIT_SOURCE,
  resolvePreset, buildPosterPrompt, hasBenefitPattern, buildAssetDisplayName,
  generatePoster, editOrUpscale, UPSCALE_4K_INSTRUCTION, buildEditInstruction,
  removeBackground, composeImage,
  writeTempBuffer, allocTempPath, writeTempMeta, readTempMeta, findTempFile, moveTempToPermanent,
  companyTempUsageBytes, isValidTempId, newTempId,
  tryAcquireGenerateLock, releaseGenerateLock,
  findTemplateSample, writeTemplateSample,
  STUDIO_TEMP_CAP_BYTES, STUDIO_TEMP_TTL_DAYS,
  type ComposeTypography,
} from '../utils/image-studio';
import { getTemplate, listTemplatesPublic } from '../utils/image-studio-templates';

export const imageStudioRouter = Router();

// ── GET /template-sample/:id — 템플릿 예시 실샘플 서빙 (★인증 미들웨어 앞 = 공개) ──
//   갤러리 카드가 <img src>로 직접 로드(인증 헤더 없음). 은닉 정보 없음(완성 목업 이미지뿐).
//   경로는 카탈로그 실존 id로만 조립(getTemplate 검증) — 임의 경로 조작 차단.
imageStudioRouter.get('/template-sample/:id', (req: any, res: Response) => {
  const id = String(req.params.id || '');
  if (!getTemplate(id)) return res.status(404).json({ success: false, error: '템플릿을 찾을 수 없습니다.' });
  const sample = findTemplateSample(id);
  if (!sample) return res.status(404).json({ success: false, error: '예시 이미지가 아직 없습니다.' });
  res.setHeader('Content-Type', sample.mime);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.sendFile(sample.absPath);
});

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
//   ★2026-07-31 exampleUrl 폴백 — 카탈로그 미지정이어도 배치 생성 실샘플 파일이 있으면 카드에 표시.
imageStudioRouter.get('/templates', (_req: any, res: Response) => {
  const templates = listTemplatesPublic().map((t) => ({
    ...t,
    exampleUrl: t.exampleUrl || (findTemplateSample(t.id) ? `/api/image-studio/template-sample/${t.id}` : null),
  }));
  return res.json({ success: true, templates });
});

// ── POST /template-samples/generate — 예시 실샘플 배치 생성 (★슈퍼관리자 전용·내부 원가) ──
//   템플릿 sample 카피(무드별 실카피·혜택 수치 0)로 제품 없이 1장씩 생성해 영구 저장.
//   크레딧 미차감(고객 과금 아님 — Gemini 원가만). HTTP 타임아웃 대비 호출당 limit장(기본 2·최대 5)씩 진행,
//   remaining이 0이 될 때까지 재호출. 동시 실행 1회(모듈 잠금).
let sampleGenInFlight = false;
imageStudioRouter.post('/template-samples/generate', async (req: any, res: Response) => {
  if (req.user?.userType !== 'super_admin') {
    return res.status(403).json({ success: false, error: '슈퍼관리자만 실행할 수 있습니다.' });
  }
  if (!isStudioReady()) return respondStudioError(res, new StudioError('STUDIO_NOT_READY', 503));
  if (sampleGenInFlight) return res.status(409).json({ success: false, error: '샘플 생성이 이미 진행 중입니다.' });
  sampleGenInFlight = true;
  try {
    const limit = Math.max(1, Math.min(5, Number(req.body?.limit) || 2));
    const publicList = listTemplatesPublic();
    const missing = publicList.filter((t) => !t.exampleUrl && !findTemplateSample(t.id));
    const targets = missing.slice(0, limit);
    const preset = resolvePreset('poster');
    // 토큰({productName})·placeholder([...]) 포함 기본값은 샘플에 쓰지 않는다 — sample 카피가 항상 우선.
    const clean = (s?: string) => (s && !s.includes('{') && !s.includes('[') ? s : '');
    const generated: string[] = [];
    const failed: string[] = [];
    for (const pub of targets) {
      const t = getTemplate(pub.id);
      if (!t) continue;
      try {
        const prompt = buildPosterPrompt({
          template: t,
          preset,
          texts: {
            label: clean(t.defaultTexts.label),
            title: t.sample?.title || clean(t.defaultTexts.title) || t.name,
            subtitle: t.sample?.subtitle || '',
          },
          userHint: null,
          hasProduct: false,
        });
        const img = await generatePoster(prompt, preset, null);
        writeTemplateSample(t.id, Buffer.from(img.base64, 'base64'), img.mime);
        generated.push(t.id);
      } catch (err: any) {
        console.error(`[image-studio] 템플릿 샘플 생성 실패(${t.id}):`, err?.message || err);
        failed.push(t.id);
      }
    }
    return res.json({
      success: true,
      generated,
      failed,
      remaining: missing.length - generated.length,
      total: publicList.length,
    });
  } finally {
    sampleGenInFlight = false;
  }
});

// ── POST /generate — 템플릿 + 누끼 + 지정 문구 → 완성 포스터 1장 (2크레딧 고정) ──
imageStudioRouter.post('/generate', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  if (!isStudioReady()) return respondStudioError(res, new StudioError('STUDIO_NOT_READY', 503));

  const { templateId, presetKey, userHint, texts, cutoutTempId, textPosition } = req.body || {};
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
    // ★ 2026-08-09 문구 위치(행사 포스터 위/중앙/아래) — 화이트리스트 밖 값은 무시(템플릿 기본 배치)
    const textPos = textPosition === 'top' || textPosition === 'center' || textPosition === 'bottom' ? textPosition : null;
    const prompt = buildPosterPrompt({
      template, preset,
      texts: { label: texts?.label, title: texts?.title, subtitle: texts?.subtitle },
      userHint: benefitInHint ? null : userHint,
      hasProduct: !!cutout,
      textPosition: textPos,
    });

    // ★ 2026-07-30 1장 생성 (Harold 확정) — 옛 후보 2장은 같은 prompt·preset 무작위 2회 호출이라 레시피 차이가 없었다.
    //   1회 호출로 줄이고 크레딧은 2 유지 → 크레딧당 Gemini 호출 0.5회(원가 절반). 실패 = 미차감(throw → respondStudioError).
    const oks = [await generatePoster(prompt, preset, cutout)];

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

    // 성공 후 차감 — 생성 1회 = 2크레딧 고정(★2026-07-30 Harold 확정: 1장 생성이어도 2). 멱등키 = 생성 요청 uuid.
    const cost = 2;
    const genReqId = newTempId();
    await deductCreditSafe({
      companyId, cost, source: CREDIT_SOURCE.generate, createdBy: userId,
      idempotencyKey: `image-studio:${genReqId}`,
    });

    return res.json({
      success: true,
      images,
      benefitNotice: benefitInHint ? '혜택 문구는 문구 칸(라벨·헤드라인·부제)에 입력해주세요. 장면 힌트에는 장면 묘사만 들어가요.' : null,
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
      return res.status(503).json({ success: false, error: '이미지 보관함을 준비 중입니다. 잠시 후 다시 시도해 주세요.', code: 'DB_MIGRATION_PENDING' });
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
    const asset = await getAsset(companyId, assetId, resolveOwnerScope(req));
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
      return res.status(503).json({ success: false, error: '이미지 보관함을 준비 중입니다. 잠시 후 다시 시도해 주세요.', code: 'DB_MIGRATION_PENDING' });
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
