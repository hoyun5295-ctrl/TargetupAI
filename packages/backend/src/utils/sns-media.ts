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
  const filename = `${input.targetId}.jpg`;
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
