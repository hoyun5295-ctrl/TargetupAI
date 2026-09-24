/**
 * sns-media.ts — SNS 미디어 저장·게시본 확정 (2026-09-21 S2)
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-7.
 *
 * ⛔ **Harold 확정(2026-09-21): 원본을 멋대로 자르거나 망가뜨리지 않는다.**
 *   판정은 `sns-media-fit.ts` 가 하고(순수), 여기는 그 판정대로 파일을 굽기만 한다.
 *   여백을 단색으로 채울지 블러로 채울지는 `image-serve.ts fitToCanvas` 가 사진을 보고 고른다
 *   (0908 비교 캡처로 확정된 판정 · SNS 에서 다시 짜면 같은 사진이 화면마다 다르게 나온다).
 *
 * ⛔ **원본은 절대 덮어쓰지 않는다.** 게시본은 언제나 별도 파일이다 — 채널마다 다르게 구워지고,
 *   `verified_at` 뒤 보관 기간이 지나면 게시본만 지운다(원본은 사용자 자산).
 * ⛔ **`.opt` 캐시를 쓰지 않는다**(§3-7). 서빙 캐시는 "보기 좋게"가 목적이고 게시본은 "플랫폼이 받아들이게"가
 *   목적이라 수명·규격이 다르다.
 * ⛔ **구운 파일의 실제 형식을 다시 읽어** JPEG 가 아니면 게시를 시작하지 않는다(§2-13 · 서빙 CT의 관용은 SNS 에서 독).
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { fitToCanvas } from './image-serve';
import { planSnsFit, type SnsFitMode, type SnsFitPlan, type SnsImageSpec } from './sns-media-fit';
import { probeSnsVideoFile, relocateMoovToFront, SnsVideoRelocateError, type SnsVideoProbe } from './sns-video-probe';

/** 원본 보관 위치. 인앱 이미지(`uploads/inapp`)와 섞지 않는다 — 수명·공개 규칙이 다르다. */
const SNS_MEDIA_BASE = process.env.SNS_MEDIA_PATH || path.resolve('./uploads/sns-media');
/** 게시본 보관 위치(채널·target 별). */
const SNS_RENDER_BASE = process.env.SNS_RENDER_PATH || path.resolve('./uploads/sns-render');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 올릴 수 있는 이미지 형식. gif 는 애니메이션이라 제외(플랫폼이 첫 프레임만 받거나 거부한다). */
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
export const SNS_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** 게시본 JPEG 품질 사다리. 용량 상한을 넘으면 이 순서로 낮춰 다시 굽는다(마지막도 넘으면 실패). */
const QUALITY_LADDER = [92, 86, 80, 72] as const;

export class SnsMediaError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SnsMediaError';
    this.code = code;
  }
}

export interface SnsStoredMedia {
  /** DB `sns_media.path` 에 들어갈 상대 경로 */
  relPath: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
}

function companyDir(base: string, companyId: string): string {
  if (!UUID_RE.test(companyId)) throw new SnsMediaError('BAD_COMPANY', '잘못된 요청입니다.');
  const dir = path.join(base, companyId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 업로드 원본을 저장한다. **변환하지 않는다** — 사용자가 올린 그대로 남긴다.
 * 규격 맞춤은 게시 직전에 별도 파일로 한다(원본은 다시 쓸 수 있어야 한다).
 */
export async function storeSnsMedia(input: {
  companyId: string;
  buffer: Buffer;
  originalName: string;
}): Promise<SnsStoredMedia> {
  const ext = path.extname(input.originalName).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    throw new SnsMediaError('BAD_FORMAT', '올릴 수 없는 형식이에요. JPG·PNG·WEBP 파일을 올려 주세요.');
  }
  if (input.buffer.length > SNS_IMAGE_MAX_BYTES) {
    throw new SnsMediaError('TOO_LARGE', '사진이 너무 큽니다. 8MB 이하로 올려 주세요.');
  }

  // 확장자는 거짓일 수 있다. 실제 내용으로 판정한다.
  let meta: Metadata;
  try {
    meta = await sharp(input.buffer).metadata();
  } catch {
    throw new SnsMediaError('UNREADABLE', '사진을 읽지 못했어요. 다른 파일로 시도해 주세요.');
  }
  if (!meta.width || !meta.height) {
    throw new SnsMediaError('UNREADABLE', '사진 크기를 읽지 못했어요. 다른 파일로 시도해 주세요.');
  }
  if (meta.pages && meta.pages > 1) {
    throw new SnsMediaError('ANIMATED', '움직이는 이미지는 올릴 수 없어요. 사진 한 장으로 올려 주세요.');
  }

  const dir = companyDir(SNS_MEDIA_BASE, input.companyId);
  const filename = `${randomUUID()}${ext}`;
  fs.writeFileSync(path.join(dir, filename), input.buffer);

  return {
    relPath: `${input.companyId}/${filename}`,
    format: String(meta.format || ext.slice(1)),
    bytes: input.buffer.length,
    width: meta.width,
    height: meta.height,
  };
}

/** 소재 라이브러리 원본이 있는 곳(`utils/assets.ts` 와 같은 값). */
const INAPP_IMAGE_BASE = process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp');
const INAPP_URL_PREFIX = '/api/cdp/inapp/image/';

/**
 * 소재 라이브러리 이미지를 SNS 미디어로 **복사**한다.
 *
 * ⛔ 경로만 참조하지 않고 복사하는 이유 둘.
 *   ① 라이브러리에서 그 소재를 지워도 게시 이력의 사진이 사라지면 안 된다
 *   ② 두 저장소의 수명·공개 규칙이 다르다(라이브러리는 영구 공개 · SNS 원본은 비공개)
 * ★ 이 경로로 들어온 미디어만 `asset_id` 를 갖고, 그것이 **AI 표시 자동 부착의 유일한 근거**다(§3-9).
 */
export async function copyAssetToSnsMedia(input: {
  companyId: string;
  assetUrl: string;
}): Promise<SnsStoredMedia> {
  const url = String(input.assetUrl || '');
  const prefix = `${INAPP_URL_PREFIX}${input.companyId}/`;
  if (!url.startsWith(prefix)) {
    // 다른 회사의 소재이거나 우리 서빙 경로가 아니다.
    throw new SnsMediaError('BAD_ASSET', '이 소재는 쓸 수 없어요.');
  }
  const filename = url.slice(prefix.length);
  if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\\')) {
    throw new SnsMediaError('BAD_ASSET', '이 소재는 쓸 수 없어요.');
  }

  const srcAbs = path.join(INAPP_IMAGE_BASE, input.companyId, filename);
  if (!fs.existsSync(srcAbs)) {
    throw new SnsMediaError('SOURCE_MISSING', '소재 파일을 찾지 못했어요.');
  }
  const buf = fs.readFileSync(srcAbs);
  // 저장 규칙은 직접 업로드와 **완전히 같다** — 형식·크기 검사도 그대로 지난다.
  return storeSnsMedia({ companyId: input.companyId, buffer: buf, originalName: filename });
}

/** 저장된 원본의 절대 경로. 경로 조작은 여기서 막는다(`routes/dm.ts:156~157` 규약). */
export function snsMediaAbsPath(relPath: string): string {
  const rel = String(relPath || '');
  if (rel.includes('..') || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new SnsMediaError('BAD_PATH', '잘못된 요청입니다.');
  }
  return path.join(SNS_MEDIA_BASE, rel);
}

/**
 * ★ 2026-09-24 E2 목록 썸네일(사진만 · 96px 칸의 2배). 원본은 건드리지 않고 매번 메모리에서 줄인다.
 * 서빙 캐시(.opt)를 쓰지 않는 규칙은 게시본 이야기라 여기와 무관하지만, 파일을 새로 만들지 않는 쪽이 정리할 것이 없다.
 */
export async function snsMediaThumbnail(relPath: string, width = 192): Promise<Buffer> {
  return sharp(snsMediaAbsPath(relPath))
    .rotate()
    .resize({ width, height: width, fit: 'cover', withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
}

export interface SnsRenderResult {
  /** 게시본 절대 경로 */
  absPath: string;
  /** 게시본 상대 경로(원장 기록용) */
  relPath: string;
  bytes: number;
  width: number;
  height: number;
  /** 무엇을 했는지. 아무것도 안 했으면 `plan.needsAspectChange=false && !resized` */
  plan: SnsFitPlan;
}

/**
 * 채널 하나의 게시본을 굽는다.
 *
 * 순서
 *   ① 원본 크기를 읽고 `planSnsFit` 으로 **할 일이 있는지** 판정한다.
 *   ② 비율을 바꿔야 하면 `fitToCanvas`(pad 기본 · 잘림 0)로 캔버스에 넣는다.
 *   ③ 투명은 흰색으로 깔고 JPEG 로 굽는다(플랫폼이 알파를 못 받는다).
 *   ④ 용량 상한을 넘으면 품질을 낮춰 다시 굽는다.
 *   ⑤ **구운 파일을 다시 읽어 JPEG 인지 확인한다.** 아니면 던진다 — 여기서 막는 것이 플랫폼에서 거부당하는 것보다 낫다.
 */
export async function renderSnsPublishFile(input: {
  companyId: string;
  targetId: string;
  /** ★ 2026-09-23 D2 — 게시본은 target·미디어마다 한 장이다(캐러셀이 마지막 사진 N장으로 나가던 것) */
  mediaId: string;
  sourceRelPath: string;
  spec: SnsImageSpec;
  mode?: SnsFitMode;
}): Promise<SnsRenderResult> {
  const srcAbs = snsMediaAbsPath(input.sourceRelPath);
  if (!fs.existsSync(srcAbs)) {
    throw new SnsMediaError('SOURCE_MISSING', '원본 사진을 찾지 못했어요. 다시 올려 주세요.');
  }
  const buf = fs.readFileSync(srcAbs);

  let meta: Metadata;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    throw new SnsMediaError('UNREADABLE', '사진을 읽지 못했어요.');
  }
  if (!meta.width || !meta.height) {
    throw new SnsMediaError('UNREADABLE', '사진 크기를 읽지 못했어요.');
  }

  const plan = planSnsFit(meta.width, meta.height, input.spec, input.mode ?? 'pad');

  // ② 비율 맞춤(필요할 때만) — 안 필요하면 원본 픽셀 그대로 간다.
  let working: Buffer = buf;
  if (plan.needsAspectChange) {
    working = await fitToCanvas(buf, plan.canvasWidth, plan.canvasHeight, plan.mode);
  } else if (plan.resized) {
    working = await sharp(buf).resize({ width: plan.canvasWidth, withoutEnlargement: true }).toBuffer();
  }

  // ③④ 흰 바탕 + JPEG · 용량 상한까지 품질을 낮춘다.
  const dir = companyDir(SNS_RENDER_BASE, input.companyId);
  const filename = snsRenderFileName(input.targetId, input.mediaId);
  const absPath = path.join(dir, filename);

  let out: Buffer | null = null;
  for (const quality of QUALITY_LADDER) {
    const candidate = await sharp(working)
      .flatten({ background: { r: 255, g: 255, b: 255 } })   // 투명 → 흰색
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (candidate.length <= input.spec.imageMaxBytes) { out = candidate; break; }
    out = candidate;   // 마지막 후보는 들고 있는다(아래에서 판정)
  }
  if (!out || out.length > input.spec.imageMaxBytes) {
    throw new SnsMediaError('TOO_LARGE_AFTER_ENCODE', '사진 용량을 채널 기준까지 줄이지 못했어요. 더 작은 사진으로 올려 주세요.');
  }
  fs.writeFileSync(absPath, out);

  // ⑤ 구운 결과를 **다시 읽어** 확인한다. 여기를 건너뛰면 형식 오류가 플랫폼에서 터진다.
  const outMeta = await sharp(absPath).metadata();
  if (outMeta.format !== 'jpeg') {
    try { fs.unlinkSync(absPath); } catch { /* 지우기 실패는 넘어간다 */ }
    throw new SnsMediaError('MEDIA_FORMAT', '게시용 사진을 만들지 못했어요. 다른 사진으로 시도해 주세요.');
  }

  return {
    absPath,
    relPath: `${input.companyId}/${filename}`,
    bytes: out.length,
    width: outMeta.width || plan.canvasWidth,
    height: outMeta.height || plan.canvasHeight,
    plan,
  };
}

/** 게시본 절대 경로(서명 서빙이 읽는다). */
export function snsRenderAbsPath(relPath: string): string {
  const rel = String(relPath || '');
  if (rel.includes('..') || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new SnsMediaError('BAD_PATH', '잘못된 요청입니다.');
  }
  return path.join(SNS_RENDER_BASE, rel);
}

/** 게시본 삭제(보관 기간 지난 것). 원본은 건드리지 않는다. */
export function removeSnsRenderFile(relPath: string): void {
  try {
    const abs = snsRenderAbsPath(relPath);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch { /* best-effort */ }
}

// ───────────────────────── ★ 2026-09-23 1차-B — 미디어별 게시본 · 영상 ─────────────────────────
// 설계 SoT = docs/2026-09-23-sns-1b-design.md §3-1·§3-2·§3-5 · 불변 21.

/**
 * 게시본 파일명. ⛔ D2 — 전에는 `{targetId}.jpg` 한 장이라 캐러셀 사진이 서로 덮어써 마지막 사진이 N번 나갔다.
 * target 과 미디어 둘 다 UUID 만 받는다(경로 조작 차단).
 */
export function snsRenderFileName(targetId: string, mediaId: string): string {
  if (!UUID_RE.test(targetId) || !UUID_RE.test(mediaId)) throw new SnsMediaError('BAD_PATH', '잘못된 요청입니다.');
  return `${targetId}-${mediaId}.jpg`;
}

/** 영상 보관 형식 → 전송 형식 */
export function snsVideoMime(format: string | null | undefined): string {
  return String(format || '').toLowerCase() === 'mov' ? 'video/quicktime' : 'video/mp4';
}

/**
 * 서명 주소가 내보낼 파일. 사진 = 그 target·미디어의 게시본(JPEG) · 영상 = 보관본 그대로(불변 21 · 변환 0).
 * `res.sendFile` 이 Range 206 을 처리한다(Meta 가 영상을 나눠 받아도 된다).
 */
export function resolveSnsServeFile(input: {
  companyId: string;
  targetId: string;
  media: { id: string; kind: string; path: string; format: string | null };
}): { absPath: string; contentType: string } {
  if (input.media.kind === 'video') {
    return { absPath: snsMediaAbsPath(input.media.path), contentType: snsVideoMime(input.media.format) };
  }
  return {
    absPath: snsRenderAbsPath(`${input.companyId}/${snsRenderFileName(input.targetId, input.media.id)}`),
    contentType: 'image/jpeg',
  };
}

/** 영상 한 개 상한 = 채널 중 가장 작은 인스타 릴스 300MB(원문). 이보다 큰 것은 받는 채널이 있어도 1차-B 는 받지 않는다. */
export const SNS_VIDEO_MAX_BYTES = 300 * 1024 * 1024;
/** 조각 크기. nginx 본문 상한(가이드 전역 5M)에 걸리지 않게 4MB(설계 1b §3-2) */
export const SNS_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const ALLOWED_VIDEO_EXT = new Set(['.mp4', '.mov']);
/** 끝나지 않은 조각을 치우는 기준 */
const INCOMING_STALE_MS = 6 * 60 * 60 * 1000;

interface UploadSession {
  companyId: string;
  userId: string | null;
  ext: string;
  totalBytes: number;
  createdAt: number;
}

function incomingDir(companyId: string): string {
  return companyDir(path.join(SNS_MEDIA_BASE, '_incoming'), companyId);
}
function sessionPaths(companyId: string, uploadId: string): { part: string; meta: string } {
  if (!UUID_RE.test(uploadId)) throw new SnsMediaError('BAD_UPLOAD', '업로드 정보를 찾지 못했어요. 처음부터 다시 올려 주세요.');
  const dir = incomingDir(companyId);
  return { part: path.join(dir, `${uploadId}.part`), meta: path.join(dir, `${uploadId}.json`) };
}
async function readSession(companyId: string, uploadId: string): Promise<UploadSession> {
  const { meta } = sessionPaths(companyId, uploadId);
  try {
    const s = JSON.parse(await fs.promises.readFile(meta, 'utf8')) as UploadSession;
    // 회사가 다르면 없는 것과 같다(경로가 이미 회사별이지만 한 번 더 본다).
    if (s.companyId !== companyId) throw new Error('company');
    return s;
  } catch {
    throw new SnsMediaError('BAD_UPLOAD', '업로드 정보를 찾지 못했어요. 처음부터 다시 올려 주세요.');
  }
}

/** 6시간 넘게 멈춘 조각을 치운다(그 회사 것만 · 실패해도 넘어간다). */
async function sweepIncoming(companyId: string): Promise<void> {
  try {
    const dir = incomingDir(companyId);
    const now = Date.now();
    for (const name of await fs.promises.readdir(dir)) {
      const abs = path.join(dir, name);
      const st = await fs.promises.stat(abs).catch(() => null);
      if (st && now - st.mtimeMs > INCOMING_STALE_MS) await fs.promises.unlink(abs).catch(() => undefined);
    }
  } catch { /* best-effort */ }
}

/**
 * 영상 업로드 시작. **메모리 상태 0** — 세션은 디스크의 조각 파일과 옆 JSON 이 전부다
 * (재시작·다중 프로세스에서도 이어진다).
 */
export async function startSnsVideoUpload(input: {
  companyId: string;
  userId: string | null;
  originalName: string;
  totalBytes: number;
}): Promise<{ uploadId: string; chunkBytes: number }> {
  const ext = path.extname(String(input.originalName || '')).toLowerCase();
  if (!ALLOWED_VIDEO_EXT.has(ext)) {
    throw new SnsMediaError('BAD_FORMAT', '올릴 수 없는 형식이에요. MP4·MOV 영상을 올려 주세요.');
  }
  const total = Number(input.totalBytes);
  if (!Number.isInteger(total) || total <= 0) throw new SnsMediaError('BAD_SIZE', '영상 크기를 확인하지 못했어요.');
  if (total > SNS_VIDEO_MAX_BYTES) {
    throw new SnsMediaError('TOO_LARGE', `영상이 너무 커요. ${SNS_VIDEO_MAX_BYTES / 1024 / 1024}MB 이하로 올려 주세요.`);
  }
  await sweepIncoming(input.companyId);

  const uploadId = randomUUID();
  const { part, meta } = sessionPaths(input.companyId, uploadId);
  const session: UploadSession = { companyId: input.companyId, userId: input.userId, ext, totalBytes: total, createdAt: Date.now() };
  await fs.promises.writeFile(part, Buffer.alloc(0));
  await fs.promises.writeFile(meta, JSON.stringify(session));
  return { uploadId, chunkBytes: SNS_UPLOAD_CHUNK_BYTES };
}

/**
 * 조각 하나. **순서대로만** 받는다 — `index × 조각 크기 = 지금까지 받은 크기` 여야 한다.
 * 같은 조각을 다시 보내면(응답을 못 받고 재시도) 이미 받은 것으로 보고 그대로 돌려준다.
 */
export async function appendSnsVideoChunk(input: {
  companyId: string;
  uploadId: string;
  index: number;
  chunk: Buffer;
}): Promise<{ received: number; totalBytes: number }> {
  const session = await readSession(input.companyId, input.uploadId);
  const { part } = sessionPaths(input.companyId, input.uploadId);
  const index = Number(input.index);
  if (!Number.isInteger(index) || index < 0) throw new SnsMediaError('BAD_CHUNK', '조각 번호가 잘못됐어요.');
  if (!Buffer.isBuffer(input.chunk) || input.chunk.length === 0 || input.chunk.length > SNS_UPLOAD_CHUNK_BYTES) {
    throw new SnsMediaError('BAD_CHUNK', '조각 크기가 잘못됐어요.');
  }
  const have = (await fs.promises.stat(part)).size;
  const start = index * SNS_UPLOAD_CHUNK_BYTES;
  if (start < have) return { received: have, totalBytes: session.totalBytes };   // 이미 받은 조각
  if (start > have) throw new SnsMediaError('OUT_OF_ORDER', '조각 순서가 맞지 않아요. 처음부터 다시 올려 주세요.');
  if (have + input.chunk.length > session.totalBytes) throw new SnsMediaError('BAD_CHUNK', '영상 크기보다 많이 받았어요.');
  if (input.chunk.length !== SNS_UPLOAD_CHUNK_BYTES && have + input.chunk.length !== session.totalBytes) {
    throw new SnsMediaError('BAD_CHUNK', '조각 크기가 잘못됐어요.');   // 마지막 조각만 작을 수 있다
  }
  await fs.promises.appendFile(part, input.chunk);
  return { received: have + input.chunk.length, totalBytes: session.totalBytes };
}

export interface SnsStoredVideo extends SnsStoredMedia {
  probe: SnsVideoProbe;
  /** moov 를 앞당겼는가(설계 1b §3-1 ③ · 무손실) */
  relocated: boolean;
}

/**
 * 업로드 마무리 — 크기 확인 → 판독 → (필요하면) moov 앞당김 → 보관.
 * ⛔ 영상·음성 바이트는 바꾸지 않는다(불변 21). 앞당김은 상자 순서와 위치표만 바꾼다.
 */
export async function completeSnsVideoUpload(input: { companyId: string; uploadId: string }): Promise<SnsStoredVideo> {
  const session = await readSession(input.companyId, input.uploadId);
  const { part, meta } = sessionPaths(input.companyId, input.uploadId);
  const cleanup = async () => {
    await fs.promises.unlink(part).catch(() => undefined);
    await fs.promises.unlink(meta).catch(() => undefined);
  };
  const have = (await fs.promises.stat(part)).size;
  if (have !== session.totalBytes) {
    throw new SnsMediaError('INCOMPLETE', '영상이 끝까지 올라오지 않았어요. 다시 올려 주세요.');
  }

  const first = await probeSnsVideoFile(part);
  if (!first.hasMoov) {
    await cleanup();
    throw new SnsMediaError('UNREADABLE', '영상 정보를 읽지 못했어요. 다른 파일로 올려 주세요.');
  }
  if (first.compressedMoov) {
    await cleanup();
    throw new SnsMediaError('UNREADABLE', '이 영상은 처리할 수 없는 형식이에요. 편집 앱에서 MP4 로 다시 내보내 주세요.');
  }

  const dir = companyDir(SNS_MEDIA_BASE, input.companyId);
  const filename = `${randomUUID()}${session.ext}`;
  const finalAbs = path.join(dir, filename);
  let relocated = false;
  try {
    if (first.fastStart) {
      await fs.promises.rename(part, finalAbs);
    } else {
      const r = await relocateMoovToFront(part, finalAbs);
      relocated = r.moved;
      if (!r.moved) await fs.promises.rename(part, finalAbs);
    }
  } catch (err) {
    await fs.promises.unlink(finalAbs).catch(() => undefined);
    await cleanup();
    if (err instanceof SnsVideoRelocateError) throw new SnsMediaError(err.code, err.message);
    throw err;
  }
  await cleanup();

  const probe = relocated ? await probeSnsVideoFile(finalAbs) : first;
  const bytes = (await fs.promises.stat(finalAbs)).size;
  return {
    relPath: `${input.companyId}/${filename}`,
    format: session.ext.slice(1),
    bytes,
    width: probe.width ?? 0,
    height: probe.height ?? 0,
    probe,
    relocated,
  };
}
