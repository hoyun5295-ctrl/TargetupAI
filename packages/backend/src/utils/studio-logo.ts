/**
 * studio-logo.ts — 이미지 스튜디오 브랜드 로고 층 CT(★ 2026-11-07 C112 · 설계서 docs/2026-11-07-c112-studio-brand-logo-design.md)
 *
 * 로고 원본 = 브랜드 키트 logo_url 하나(D4). 처음 쓸 때 한 번 안전하게 바꿔 회사별 캐시에 둔다(주소 해시 · 바뀌면 새로).
 * 합성 = node sharp 한 함수(D15 · py 무변경) · 미리보기 = 응답 안 그림(파일 0 · D1) · 저장 = 같은 함수로 원본 크기(D3).
 * 외부 호출(키트 읽기 · 그림 가져오기)은 deps 로 받는다(시험 주입 · 기본값 = 운영 CT).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import type { Metadata, OverlayOptions } from 'sharp';
import { runSerial } from './inflight-lock';
import {
  GROUP_MAX_INPUT_PIXELS, inappImageLocalPath, readTempMeta, findTempFile, findPermanentByTempId, discardTemp, writeStudioPermanent, buildAssetDisplayName,
  isStudioTempFull, writeTempBuffer, isValidTempId, moveTempToPermanent, StudioError,   // ★ C113 D9 찾기 = 임시 · 쓰기 = 영구
} from './image-studio';
import { getStorageUsage, getAssetByUrl, registerAssetConfirmed, type RegisterAssetInput } from './assets';
import { dmImageLocalPath } from './dm/dm-viewer-utils';
import { getCompanyBrandKitRaw, setBrandKitLogoIfEmpty } from './dm/dm-brand-kit';
import { fetchHtmlGuarded } from './dm/dm-brand-extractor';
import { normalizeReadUrl } from './brand-page-reader';
import { fetchImageGuarded } from './sales-outreach-produce';
import { extractLogoCandidates, OUTREACH_FETCH_OPTS, type GuardedImageFetcher } from './sales-outreach-media';
import type { DmBrandKit } from './dm/dm-tokens';
import {
  allowedLogoCorners, isLogoCorner, isLogoSize, logoSizeOptions, logoTargetSize, logoPlacement, needsPlate, plateTone, srgbLuminance, rgbLuminance,
  LOGO_DEFAULT_SIZE, PLATE_PAD_RATIO, PLATE_RADIUS_RATIO, PLATE_LIGHT, PLATE_DARK, type LogoCorner, type LogoSize,
} from './studio-zones';

/** 회사별 로고 캐시 루트(저장 · 임시 폴더와 별개 · 스윕 대상 아님 · 회사당 한 장) */
const STUDIO_LOGO_BASE = process.env.STUDIO_LOGO_PATH || path.resolve('./uploads/studio-logos');
/** 원본 폭 하한 = 홈페이지 로고 거르기와 같은 값(brand-page-reader.ts 의 `size.width < 60`) */
export const LOGO_MIN_SOURCE_WIDTH = 60;
/** 캐시 PNG 긴 변 상한(크게 24% · 2K 포스터에도 넉넉) */
export const LOGO_CACHE_MAX_SIDE = 1024;
/** 우리 저장본을 디스크에서 읽을 때의 크기 상한(가드 가져오기와 같은 10MB) */
const LOGO_SOURCE_MAX_BYTES = 10 * 1024 * 1024;

export type LogoUnusableReason = 'format' | 'small' | 'fetch';
export type StudioLogoState =
  | { state: 'none'; homepage: string | null }
  | { state: 'unusable'; reason: LogoUnusableReason }
  | { state: 'ready'; key: string; path: string; png: Buffer; width: number; height: number };   // ★ C113 D8 key = 확정 키(주소 + 그림 내용) · png = 이 순간 읽은 바이트(비교 · 합성 같은 버퍼)

export interface LogoSourceDeps {
  readKit: (companyId: string) => Promise<Partial<DmBrandKit> | null>;
  fetchImage: GuardedImageFetcher;
}
export const defaultLogoDeps: LogoSourceDeps = {
  readKit: (companyId) => getCompanyBrandKitRaw(companyId),
  fetchImage: (url) => fetchImageGuarded(url),
};

// ── 안전 변환(D4 · 홈페이지 읽기도 같은 함수) ─────────────────────────

export type SafeLogo =
  | { ok: true; png: Buffer; width: number; height: number; sourceWidth: number; sourceHeight: number }
  | { ok: false; reason: 'format' | 'small' };

/** 형식(png · jpeg · webp 만) · 입력 픽셀 상한 · 원본 폭 60 · 1024 안으로 줄인 PNG(알파 유지 · 키우지 않음) */
export async function safeLogoPng(buf: Buffer): Promise<SafeLogo> {
  // svg · xml 은 sharp 에 넘기지 않는다(외부 참조 위험 · 형식 판정 전에 거른다)
  if (!buf || buf.length < 8 || buf.subarray(0, 256).toString('utf8').replace(/^﻿/, '').trimStart().startsWith('<')) return { ok: false, reason: 'format' };
  let meta: Metadata;
  try { meta = await sharp(buf, { limitInputPixels: GROUP_MAX_INPUT_PIXELS }).metadata(); } catch { return { ok: false, reason: 'format' }; }
  const fmt = String(meta.format || '');
  if (fmt !== 'png' && fmt !== 'jpeg' && fmt !== 'webp') return { ok: false, reason: 'format' };
  const sw = Number(meta.width) || 0;
  const sh = Number(meta.height) || 0;
  // metadata 는 머리만 읽어 픽셀 상한을 걸지 않는다 → 디코드 전에 직접 본다
  if (!sw || !sh || sw * sh > GROUP_MAX_INPUT_PIXELS) return { ok: false, reason: 'format' };
  if (sw < LOGO_MIN_SOURCE_WIDTH) return { ok: false, reason: 'small' };
  try {
    const out = await sharp(buf, { limitInputPixels: GROUP_MAX_INPUT_PIXELS })
      .resize({ width: LOGO_CACHE_MAX_SIDE, height: LOGO_CACHE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha().png().toBuffer({ resolveWithObject: true });
    return { ok: true, png: out.data, width: out.info.width, height: out.info.height, sourceWidth: sw, sourceHeight: sh };
  } catch {
    return { ok: false, reason: 'format' };
  }
}

/** 흰 로고 — 지금 pngLooksWhite(sales-outreach-media.ts)와 같은 기준(불투명 화소 20개 이상 중 90% 이상이 밝기 0.9 이상) · 줄인 그림에서 잰다 */
export async function logoLooksWhite(png: Buffer): Promise<boolean> {
  try {
    const { data } = await sharp(png, { limitInputPixels: GROUP_MAX_INPUT_PIXELS })
      .resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    let bright = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      n++;
      if (Math.max(data[i], data[i + 1], data[i + 2]) / 255 >= 0.9) bright++;
    }
    return n >= 20 && bright / n >= 0.9;
  } catch {
    return false;
  }
}

// ── 로고 원본 읽기(D4) ──────────────────────────────────────────

/**
 * 우리 저장본(DM 업로드 · 인앱 그림) 주소 → 이 회사 폴더 바로 안 경로 · 다른 회사 · 폴더 밖 = 'foreign'(영구히 못 씀) · 우리 저장본 꼴이 아니면 null.
 *   파일이 있는지는 여기서 보지 않는다 — 없음 · 접근 오류는 읽을 때 일시 장애(fetch · 기억 안 함)로 가른다(Codex 구현 1R).
 */
export function companyStoredImagePath(companyId: string, url: string): string | 'foreign' | null {
  const p = dmImageLocalPath(url) || inappImageLocalPath(url);
  if (!p) return null;
  const name = path.basename(p);
  if (!name || name === '.' || name === '..' || path.basename(path.dirname(p)) !== companyId) return 'foreign';
  return p;
}

/** 로고 원본 바이트 — 우리 저장본 = 디스크 · https = 가드 가져오기 · 그 밖(http · data · 다른 회사 저장본) = 쓸 수 없음 */
async function loadLogoSource(companyId: string, url: string, deps: LogoSourceDeps): Promise<{ buf: Buffer } | { reason: LogoUnusableReason }> {
  const local = companyStoredImagePath(companyId, url);
  if (local === 'foreign') return { reason: 'format' };   // 우리 저장본 꼴인데 이 회사 폴더가 아니다(영구)
  if (local) {
    // 이 회사 파일 = 없음 · 접근 오류는 일시 장애(다음에 다시 읽는다) · 너무 큰 파일만 영구
    try {
      const st = fs.statSync(local);
      if (!st.isFile()) return { reason: 'fetch' };
      if (st.size > LOGO_SOURCE_MAX_BYTES) return { reason: 'format' };
      return { buf: fs.readFileSync(local) };
    } catch { return { reason: 'fetch' }; }
  }
  if (!/^https:\/\//i.test(url)) return { reason: 'format' };
  try {
    const img = await deps.fetchImage(url);
    return img ? { buf: img.buffer } : { reason: 'fetch' };
  } catch { return { reason: 'fetch' }; }
}

function writeAtomic(file: string, data: Buffer | string): void {
  const tmp = path.join(path.dirname(file), `.tmp-${crypto.randomUUID()}`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** 그 회사 캐시에서 지금 키가 아닌 파일을 지운다(주소가 바뀌면 옛 캐시 정리) */
function pruneLogoDir(dir: string, key: string): void {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === `${key}.png` || f === `${key}.bad`) continue;
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* 다음 정리 때 */ }
    }
  } catch { /* 폴더 없음 */ }
}

/** ★ C113 D8 — 외부 주소(https) 로고 캐시 나이 상한(넘으면 다시 받음 · 못 받으면 옛 그림 · 우리 저장본 = 기한 없음) */
export const LOGO_REMOTE_TTL_MS = 10 * 60 * 1000;

/** ★ C113 D8 — 확정 키 = 주소 키 + 그림 내용(같은 주소의 그림이 바뀌어도 미리보기 · 저장이 다른 로고를 쓰지 않게) */
export function logoConfirmKey(addressKey: string, png: Buffer): string {
  const body = crypto.createHash('sha256').update(png).digest('hex');
  return crypto.createHash('sha256').update(`${addressKey}:${body}`).digest('hex').slice(0, 24);
}

/**
 * 로고 상태 — 키트 logo_url 하나 · 주소 해시 캐시 · 영구히 못 쓰는 주소(형식 · 작음)는 표시 파일로 기억 ·
 * 가져오기 실패(fetch)는 기억하지 않는다(다음에 다시 받는다) · 회사 줄 세움(같은 회사 동시 준비 0).
 * ★ C113 D8 — 외부 주소는 캐시(PNG · 표시 파일) 나이가 10분을 넘으면 다시 받는다(성공 = 덮어씀 · 못 받음 = 옛 그림 · 시각 갱신 · 형식 · 작음 = 표시 파일) ·
 *   ready = 확정 키(주소 + 내용) + 이 순간 읽은 바이트.
 */
export async function studioLogoState(companyId: string, deps: LogoSourceDeps = defaultLogoDeps, now: () => number = Date.now): Promise<StudioLogoState> {
  const kit = await deps.readKit(companyId);
  const url = typeof kit?.logo_url === 'string' ? kit.logo_url.trim() : '';
  if (!url) {
    const web = typeof kit?.contact?.website === 'string' ? kit.contact.website.trim() : '';
    return { state: 'none', homepage: web || null };
  }
  const key = crypto.createHash('sha256').update(url).digest('hex').slice(0, 24);
  const remote = /^https:\/\//i.test(url) && companyStoredImagePath(companyId, url) === null;
  return runSerial(`studio-logo:${companyId}`, async (): Promise<StudioLogoState> => {
    const dir = path.join(STUDIO_LOGO_BASE, companyId);
    const file = path.join(dir, `${key}.png`);
    const mark = path.join(dir, `${key}.bad`);
    const stale = (f: string): boolean => {
      if (!remote) return false;
      try { return now() - fs.statSync(f).mtimeMs > LOGO_REMOTE_TTL_MS; } catch { return true; }
    };
    const touch = (f: string) => { try { const t = new Date(now()); fs.utimesSync(f, t, t); } catch { /* 다음에 다시 */ } };
    const ready = async (png: Buffer, w?: number, h?: number): Promise<StudioLogoState> => {
      let width = Number(w) || 0;
      let height = Number(h) || 0;
      if (!width || !height) { const m = await sharp(png).metadata(); width = Number(m.width) || 0; height = Number(m.height) || 0; }
      return { state: 'ready', key: logoConfirmKey(key, png), path: file, png, width, height };
    };
    const hasFile = fs.existsSync(file);
    if (hasFile && !stale(file)) return ready(fs.readFileSync(file));
    const hasMark = !hasFile && fs.existsSync(mark);
    if (hasMark && !stale(mark)) return { state: 'unusable', reason: fs.readFileSync(mark, 'utf8').trim() === 'small' ? 'small' : 'format' };
    const src = await loadLogoSource(companyId, url, deps);
    const remember = (reason: 'format' | 'small') => {
      fs.mkdirSync(dir, { recursive: true });
      try { fs.unlinkSync(file); } catch { /* 없음 */ }
      writeAtomic(mark, reason);
      pruneLogoDir(dir, key);
    };
    if ('reason' in src) {
      if (src.reason === 'fetch') {
        // 받기 실패 = 기억하지 않는다 · 옛 캐시가 있으면 그것(시각 갱신 = 10분 뒤 다시) · 표시 파일이면 그 판정 그대로
        if (hasFile) { touch(file); return ready(fs.readFileSync(file)); }
        if (hasMark) { touch(mark); return { state: 'unusable', reason: fs.readFileSync(mark, 'utf8').trim() === 'small' ? 'small' : 'format' }; }
        return { state: 'unusable', reason: 'fetch' };
      }
      remember(src.reason);
      return { state: 'unusable', reason: src.reason };
    }
    const safe = await safeLogoPng(src.buf);
    if (!safe.ok) {
      remember(safe.reason);
      return { state: 'unusable', reason: safe.reason };
    }
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(file, safe.png);
    try { fs.unlinkSync(mark); } catch { /* 없음 */ }
    pruneLogoDir(dir, key);
    return ready(safe.png, safe.width, safe.height);
  });
}

// ── 계획 · 합성 · 미리보기(D1 · D5 ~ D7 · D15) ─────────────────────────

export interface LogoPlan {
  posterW: number;
  posterH: number;
  corner: LogoCorner;
  size: LogoSize;
  logo: { left: number; top: number; width: number; height: number };
  plate: null | { left: number; top: number; width: number; height: number; radius: number; tone: 'light' | 'dark' };
  corners: LogoCorner[];
  sizes: Array<{ id: LogoSize; ok: boolean }>;
}

type GreyImage = { data: Buffer; width: number; height: number };

/** 그 자리 회색 밝기 통계 — 표준편차(조용함) · 하위 10% · 상위 10%(판 판정) · 2px 간격 표본 */
function regionStats(img: GreyImage, rect: { left: number; top: number; width: number; height: number }): { std: number; p10: number; p90: number } {
  const hist = new Array<number>(256).fill(0);
  let n = 0;
  let sum = 0;
  let sq = 0;
  const x1 = Math.min(img.width, rect.left + rect.width);
  const y1 = Math.min(img.height, rect.top + rect.height);
  for (let y = Math.max(0, rect.top); y < y1; y += 2) {
    for (let x = Math.max(0, rect.left); x < x1; x += 2) {
      const v = img.data[y * img.width + x];
      hist[v]++;
      n++;
      sum += v;
      sq += v * v;
    }
  }
  if (!n) return { std: 0, p10: 255, p90: 255 };
  const mean = sum / n;
  const pick = (q: number) => {
    const target = q * n;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
    return 255;
  };
  return { std: Math.sqrt(Math.max(0, sq / n - mean * mean)), p10: pick(0.1), p90: pick(0.9) };
}

/** 로고 상대 휘도 — 불투명 화소(알파 128 이상) 평균 · 불투명 화소가 없으면 중간 */
async function logoLuminance(logo: Buffer): Promise<number> {
  const { data } = await sharp(logo, { limitInputPixels: GROUP_MAX_INPUT_PIXELS })
    .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  let sum = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    n++;
    sum += rgbLuminance(data[i], data[i + 1], data[i + 2]);
  }
  return n ? sum / n : 0.5;
}

/**
 * 계획 — 바탕 · 로고 · 요청(모서리 · 크기 · 비면 기본) → 자리 · 판.
 * 기본 크기 = 보통(못 고르면 작게) · 기본 모서리 = 허용 모서리 가운데 로고 + 판 자리의 밝기 표준편차가 가장 작은 곳(같으면 표 순서) ·
 * 판 = 그 자리 하위 10% · 상위 10% 와 로고의 대비가 하나라도 3:1 미만. 허용 밖 요청 = 오류(화면이 서버 목록으로만 보낸다).
 */
export async function planLogo(
  basePath: string,
  logo: { png: Buffer; width: number; height: number },   // ★ C113 D8 — 상태가 읽은 그 바이트(비교 · 합성 같은 버퍼)
  req: { corner: LogoCorner | null; size: LogoSize | null },
  textless: boolean,
): Promise<LogoPlan | { error: 'corner' | 'size' }> {
  const corners = allowedLogoCorners(textless);
  if (req.corner && !corners.includes(req.corner)) return { error: 'corner' };
  const grey = await sharp(basePath, { limitInputPixels: GROUP_MAX_INPUT_PIXELS }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = grey.info.width;
  const H = grey.info.height;
  const img: GreyImage = { data: grey.data, width: W, height: H };
  const sizes = logoSizeOptions(W, H, logo.width, logo.height);
  const okOf = (id: LogoSize) => !!sizes.find((s) => s.id === id)?.ok;
  let size: LogoSize;
  if (req.size) {
    if (!okOf(req.size)) return { error: 'size' };
    size = req.size;
  } else {
    size = okOf(LOGO_DEFAULT_SIZE) ? LOGO_DEFAULT_SIZE : 's';
  }
  const t = logoTargetSize(W, H, logo.width, logo.height, size);
  const pad = Math.max(2, Math.round(t.height * PLATE_PAD_RATIO));
  const outer = { width: t.width + pad * 2, height: t.height + pad * 2 };
  const measure = (c: LogoCorner) => {
    const p = logoPlacement(W, H, outer, c);
    return { c, p, s: regionStats(img, { left: p.left, top: p.top, width: outer.width, height: outer.height }) };
  };
  let pick = req.corner ? measure(req.corner) : null;
  if (!pick) {
    for (const c of corners) {
      const m = measure(c);
      if (!pick || m.s.std < pick.s.std) pick = m;
    }
  }
  const chosen = pick!;
  const logoLum = await logoLuminance(logo.png);
  const plate = needsPlate(logoLum, srgbLuminance(chosen.s.p10), srgbLuminance(chosen.s.p90))
    ? { left: chosen.p.left, top: chosen.p.top, width: outer.width, height: outer.height, radius: Math.round(outer.height * PLATE_RADIUS_RATIO), tone: plateTone(logoLum) }
    : null;
  return {
    posterW: W, posterH: H, corner: chosen.c, size,
    logo: { left: chosen.p.left + pad, top: chosen.p.top + pad, width: t.width, height: t.height },
    plate, corners, sizes,
  };
}

/** 합성 — 원본 크기 · JPEG 92 · 결정적(같은 바탕 · 로고 · 계획 = 같은 바이트 · 미리보기와 저장이 이 함수 하나) */
export async function renderLogoComposite(basePath: string, logo: Buffer, plan: LogoPlan): Promise<Buffer> {
  const layers: OverlayOptions[] = [];
  if (plan.plate) {
    const { width, height, radius, tone, left, top } = plan.plate;
    const c = tone === 'light' ? PLATE_LIGHT : PLATE_DARK;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="rgb(${c.r},${c.g},${c.b})" fill-opacity="${c.alpha}"/></svg>`;
    layers.push({ input: Buffer.from(svg), left, top });
  }
  const logoBuf = await sharp(logo, { limitInputPixels: GROUP_MAX_INPUT_PIXELS })
    .resize({ width: plan.logo.width, height: plan.logo.height, fit: 'fill' }).png().toBuffer();
  layers.push({ input: logoBuf, left: plan.logo.left, top: plan.logo.top });
  return sharp(basePath, { limitInputPixels: GROUP_MAX_INPUT_PIXELS })
    .composite(layers).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
}

/** 미리보기 = 같은 합성을 폭 1080 이하로 줄인 JPEG data URL(파일 쓰기 0) */
export const LOGO_PREVIEW_MAX_WIDTH = 1080;
export async function renderLogoPreview(basePath: string, logo: Buffer, plan: LogoPlan): Promise<string> {
  const full = await renderLogoComposite(basePath, logo, plan);
  const small = await sharp(full).resize({ width: LOGO_PREVIEW_MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${small.toString('base64')}`;
}

// ── 저장 1 · 2단계(D3 · 영구 이름 = 바탕 id · 지금 저장의 이름 규칙 그대로) ───────────────

export interface LogoSaveLayers { corner: LogoCorner; size: LogoSize; key: string; textless: boolean }

/** /save 의 layers 읽기 — 없음 · 끔 = null · 켜짐 = 확정 설정 · 꼴 오류 = 'invalid'(라우트 400) */
export function readLogoSaveLayers(raw: unknown): LogoSaveLayers | null | 'invalid' {
  if (!raw || typeof raw !== 'object') return null;
  const logo = (raw as { logo?: unknown }).logo;
  if (!logo || typeof logo !== 'object' || (logo as { on?: unknown }).on !== true) return null;
  const { corner, size, key } = logo as { corner?: unknown; size?: unknown; key?: unknown };
  if (!isLogoCorner(corner) || !isLogoSize(size) || typeof key !== 'string' || !/^[0-9a-f]{24}$/.test(key)) return 'invalid';
  return { corner, size, key, textless: (raw as { textless?: unknown }).textless === true };
}

export interface LogoSaveDeps {
  logoState: (companyId: string) => Promise<StudioLogoState>;
  storageUsage: (companyId: string) => Promise<{ usedBytes: number; limitBytes: number }>;
  assetByUrl: (companyId: string, url: string) => Promise<{ id: string; channel_spec?: string | null } | null>;
  registerConfirmed: (input: RegisterAssetInput) => Promise<{ id: string | null; registered: 'yes' | 'no' | 'unknown' }>;
  discardBase: (companyId: string, tempId: string) => void;
}
export const defaultLogoSaveDeps: LogoSaveDeps = {
  logoState: (companyId) => studioLogoState(companyId),
  storageUsage: (companyId) => getStorageUsage(companyId),
  assetByUrl: (companyId, url) => getAssetByUrl(companyId, url),
  registerConfirmed: (input) => registerAssetConfirmed(input),
  discardBase: (companyId, tempId) => discardTemp(companyId, tempId),
};

type StageResult = { status: number; body: Record<string, unknown> } | null;
const REGISTER_UNKNOWN = { success: false, error: '라이브러리에 올렸는지 확인하지 못했어요. 잠시 뒤 같은 그림으로 다시 저장해 주세요.', code: 'ASSET_REGISTER_UNKNOWN' };

/** 바탕 지우기(등재 뒤) — 실패 = 경고만(다음 요청이 1단계에서 마무리한다) */
function finishBase(companyId: string, tempId: string, deps: LogoSaveDeps): void {
  try { deps.discardBase(companyId, tempId); } catch (e: any) {
    console.warn(`[studio-logo] 저장 뒤 바탕 정리 실패(다음 저장이 마무리): ${e?.message || e}`);
  }
}

/**
 * /save 의 로고 단계 — 라우트가 저장 잠금(같은 임시 id 줄 세움) 안에서 지금 갈래보다 먼저 부른다. null = 지금 갈래로.
 *   1단계(모든 요청) = 바탕 그림이 남아 있고 그 바탕 id 의 영구 파일도 있으면(앞선 로고 저장이 등재 모름 · 바탕 지우기 실패로 멈춘 자리)
 *     소재 조회 → 있음 = 바탕을 지우고 그 소재(바탕 하나 = 소재 하나) / 0행 = 켜짐은 아래가 덮어쓰고 · 끔은 그 파일을 지운 뒤 지금 갈래 / 조회 실패 = 503.
 *   2단계(바탕이 있고 켜짐 · 옛 MMS 사양 아님) = 로고 상태 · 키(409) → 합성 → 저장 용량 → {바탕 id}.jpeg → 등재 판정 → 바탕 정리.
 *   바탕이 없으면 지금 갈래(pendingAsset · savedAs · 영구 파일 단건 판정)가 같은 이름으로 그대로 찾는다.
 */
export async function logoSaveStage(
  ctx: { companyId: string; userId: string | null; tempId: string; title: string | null | undefined; channelSpec: string | null | undefined; layers: LogoSaveLayers | null },
  deps: LogoSaveDeps = defaultLogoSaveDeps,
): Promise<StageResult> {
  const { companyId, tempId, layers } = ctx;
  const meta = readTempMeta(companyId, tempId);
  const found = findTempFile(companyId, tempId);
  if (!meta || !found) return null;
  const effectiveSpec = ctx.channelSpec || meta.channelSpec || null;
  const wantLogo = !!layers && effectiveSpec !== 'mms' && meta.kind === 'poster';

  // 1단계 — 남은 바탕의 영구 파일
  const perm = findPermanentByTempId(companyId, tempId);
  if (perm) {
    let existing: { id: string; channel_spec?: string | null } | null;
    try { existing = await deps.assetByUrl(companyId, perm.url); } catch { return { status: 503, body: REGISTER_UNKNOWN }; }
    if (existing) {
      finishBase(companyId, tempId, deps);
      return { status: 200, body: { success: true, asset: { id: existing.id, url: perm.url, bytes: perm.bytes, channelSpec: existing.channel_spec ?? null } } };
    }
    if (!wantLogo) {
      const p = inappImageLocalPath(perm.url);
      if (p) { try { fs.unlinkSync(p); } catch { /* 없으면 이미 지움 */ } }
      return null;
    }
  }
  if (!wantLogo || !layers) return null;

  // 2단계 — 로고 켜짐
  const st = await deps.logoState(companyId);
  if (st.state !== 'ready') return { status: 409, body: { success: false, error: '브랜드 키트 로고를 지금 쓸 수 없어요. 로고를 끄고 저장하거나 키트 로고를 바꿔 주세요.', code: 'LOGO_UNAVAILABLE' } };
  if (st.key !== layers.key) return { status: 409, body: { success: false, error: '브랜드 키트 로고가 바뀌었어요. 다시 확인해 주세요.', code: 'LOGO_CHANGED' } };
  const plan = await planLogo(found.absPath, st, { corner: layers.corner, size: layers.size }, layers.textless);
  if ('error' in plan) return { status: 400, body: { success: false, error: '로고 자리와 크기를 다시 골라 주세요.', code: 'LAYER_INVALID' } };
  const buf = await renderLogoComposite(found.absPath, st.png, plan);   // ★ C113 D8 — 키를 비교한 그 버퍼로 합성
  const usage = await deps.storageUsage(companyId);
  if (usage.usedBytes + buf.length > usage.limitBytes) {
    return { status: 409, body: { success: false, error: '저장 용량 한도를 초과했습니다. 라이브러리에서 정리 후 다시 저장해주세요.', code: 'STORAGE_FULL' } };
  }
  const moved = writeStudioPermanent(companyId, tempId, 'jpeg', buf);
  const reg = await deps.registerConfirmed({
    companyId, createdBy: ctx.userId, kind: 'generated', origin: 'studio',
    url: moved.url, filename: buildAssetDisplayName(ctx.title, effectiveSpec, 'jpeg'), bytes: moved.bytes, format: 'jpg',
    prompt: null, channelSpec: effectiveSpec, width: plan.posterW, height: plan.posterH,
  });
  if (reg.registered === 'unknown') return { status: 503, body: REGISTER_UNKNOWN };   // 파일 · 바탕 그대로 → 다음 요청 = 1단계
  if (reg.registered === 'no') {
    const p = inappImageLocalPath(moved.url);
    if (p) { try { fs.unlinkSync(p); } catch { /* 없으면 이미 지움 */ } }
    return { status: 503, body: { success: false, error: '라이브러리에 올리지 못했어요. 잠시 뒤 같은 그림으로 다시 저장해 주세요.', code: 'ASSET_REGISTER_FAILED' } };
  }
  finishBase(companyId, tempId, deps);
  return { status: 200, body: { success: true, asset: { id: reg.id, url: moved.url, bytes: moved.bytes, channelSpec: effectiveSpec } } };
}

// ── 홈페이지 로고 읽기(D11) ──────────────────────────────────────

/** 화면에 보내는 로고 상태(캐시 경로는 싣지 않는다 · 확정 키는 미리보기가 준다) */
export function publicLogoState(st: StudioLogoState): { state: 'ready' } | { state: 'none'; homepage: string | null } | { state: 'unusable'; reason: LogoUnusableReason } {
  if (st.state === 'ready') return { state: 'ready' };
  if (st.state === 'none') return { state: 'none', homepage: st.homepage };
  return { state: 'unusable', reason: st.reason };
}

export interface HomepageLogoDeps extends LogoSourceDeps {
  fetchHtml: (url: string) => Promise<{ html: string; baseUrl: string; finalUrl: string } | null>;
  setLogoIfEmpty: (companyId: string, url: string) => Promise<boolean>;
}
export const defaultHomepageLogoDeps: HomepageLogoDeps = {
  ...defaultLogoDeps,
  fetchHtml: (url) => fetchHtmlGuarded(url, OUTREACH_FETCH_OPTS),
  setLogoIfEmpty: (companyId, url) => setBrandKitLogoIfEmpty(companyId, url),
};
/** 후보 크기 상한 = 홈페이지 페이지 읽기의 로고 거르기와 같은 값(brand-page-reader.ts 의 `img.buffer.length > 400_000`) */
const HOMEPAGE_LOGO_MAX_BYTES = 400_000;

/**
 * 찾기(★ C113 D9 · 1단계) — 키트가 비어 있을 때 홈페이지에서 로고 후보를 찾아 임시(kind logo)에만 둔다(키트 · 영구 쓰기 0 · 회사 줄 세움).
 *   이미 찬 키트 = 읽지 않고 지금 상태 · 후보(img logo 먼저 · apple-touch-icon · png og:image)마다
 *   가져오기(400KB 이하) → 안전 변환(형식 · 화소 상한 · 줄인 PNG) → 비율 0.5 ~ 8 · 폭 60 → 흰 로고 → 통과한 첫 PNG = 후보(보기 = data URL).
 *   공용 회사 값(키트)은 사람이 본 뒤 「이 로고로 저장」(useHomepageLogo)에서만 쓴다.
 */
export async function readHomepageLogo(companyId: string, rawUrl: unknown, deps: HomepageLogoDeps = defaultHomepageLogoDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  return runSerial(`studio-logo-read:${companyId}`, async () => {
    const kit = await deps.readKit(companyId);
    if (typeof kit?.logo_url === 'string' && kit.logo_url.trim()) {
      return { status: 200, body: { success: true, saved: false, logo: publicLogoState(await studioLogoState(companyId, deps)) } };
    }
    const url = normalizeReadUrl(rawUrl);
    if (!url) return { status: 400, body: { success: false, error: '주소 형식이 맞지 않아요. 예: https://www.우리회사.com', code: 'URL_INVALID', field: 'url' } };
    const page = await deps.fetchHtml(url);
    if (!page?.html) return { status: 422, body: { success: false, error: '홈페이지를 읽지 못했어요. 주소를 확인해 주세요.', code: 'READ_FAILED' } };
    const base = page.finalUrl || page.baseUrl || url;
    // 후보 = 가져오기 · 검증만(어떤 실패든 다음 후보) · 사본 저장 · 키트 쓰기는 고른 하나만 · 그 오류는 라우트로(Codex 구현 2R)
    let picked: Extract<SafeLogo, { ok: true }> | null = null;
    for (const u of extractLogoCandidates(page.html, base)) {
      picked = await homepageLogoCandidate(u, deps).catch(() => null);
      if (picked) break;
    }
    if (!picked) {
      return { status: 422, body: { success: false, error: '홈페이지에서 로고를 찾지 못했어요. AI 메모리 › 브랜드 키트에서 로고 파일을 올려 주세요.', code: 'LOGO_NOT_FOUND' } };
    }
    if (isStudioTempFull(companyId)) return { status: 409, body: { success: false, error: new StudioError('TEMP_FULL', 409).message, code: 'TEMP_FULL' } };
    const tempId = writeTempBuffer(companyId, picked.png, { kind: 'logo', ext: 'png', mime: 'image/png', width: picked.width, height: picked.height });
    return {
      status: 200,
      body: { success: true, candidate: { tempId, width: picked.width, height: picked.height, preview: `data:image/png;base64,${picked.png.toString('base64')}` } },
    };
  });
}

/**
 * 쓰기(★ C113 D9 · 2단계) — 찾기가 둔 이 회사 임시 로고(kind logo)를 영구로 옮겨 키트 빈 칸에만 저장(덮어쓰기 0 · 같은 회사 줄 세움).
 *   그 사이 키트가 찼거나 0행 확정 = 옮긴 사본을 지운다 · 저장 오류 = 라우트(키트 그대로 · 사본은 남긴다: 끊긴 연결은 커밋 여부를 확정할 수 없다).
 */
export async function useHomepageLogo(companyId: string, rawTempId: unknown, deps: HomepageLogoDeps = defaultHomepageLogoDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const tempId = typeof rawTempId === 'string' ? rawTempId : '';
  if (!isValidTempId(tempId)) return { status: 400, body: { success: false, error: '저장할 로고를 찾을 수 없어요. 「로고 찾기」를 다시 눌러 주세요.', code: 'LOGO_NOT_FOUND' } };
  return runSerial(`studio-logo-read:${companyId}`, async () => {
    const meta = readTempMeta(companyId, tempId);
    if (!meta || meta.kind !== 'logo' || !findTempFile(companyId, tempId)) {
      return { status: 404, body: { success: false, error: '찾은 로고의 보관 시간이 지났어요. 「로고 찾기」를 다시 눌러 주세요.', code: 'LOGO_NOT_FOUND' } };
    }
    const kit = await deps.readKit(companyId);
    if (typeof kit?.logo_url === 'string' && kit.logo_url.trim()) {
      discardTemp(companyId, tempId);
      return { status: 200, body: { success: true, saved: false, logo: publicLogoState(await studioLogoState(companyId, deps)) } };
    }
    const moved = moveTempToPermanent(companyId, tempId);
    if (!moved) return { status: 404, body: { success: false, error: '찾은 로고의 보관 시간이 지났어요. 「로고 찾기」를 다시 눌러 주세요.', code: 'LOGO_NOT_FOUND' } };
    const saved = await deps.setLogoIfEmpty(companyId, moved.url);
    if (!saved) {
      const copy = inappImageLocalPath(moved.url);
      if (copy) { try { fs.unlinkSync(copy); } catch { /* 이미 없음 */ } }
    }
    return { status: 200, body: { success: true, saved, logo: publicLogoState(await studioLogoState(companyId, deps)) } };
  });
}

/** 홈페이지 로고 후보 하나 — 400KB 이하 · D4 안전 변환 · 비율 0.5 ~ 8 · 흰 로고 아님 · 통과 = 변환본(사본 저장 · 키트 쓰기는 부른 쪽) */
async function homepageLogoCandidate(u: string, deps: HomepageLogoDeps): Promise<Extract<SafeLogo, { ok: true }> | null> {
  const img = await deps.fetchImage(u);
  if (!img || img.buffer.length > HOMEPAGE_LOGO_MAX_BYTES) return null;
  const safe = await safeLogoPng(img.buffer);
  if (!safe.ok) return null;
  const ratio = safe.sourceWidth / safe.sourceHeight;
  if (ratio < 0.5 || ratio > 8) return null;
  if (await logoLooksWhite(safe.png)) return null;
  return safe;
}

// ── 미리보기 단계(/layers · D1 · D2 · D8) ──────────────────────────

export interface LayerPreviewRequest { on: boolean; corner: LogoCorner | null; size: LogoSize | null }

/** /layers 의 logo 읽기 — on 은 참 · 거짓만 · 모서리 · 크기는 비거나 허용 값(그 밖 = 'invalid' · 라우트 400) */
export function readLayerPreviewRequest(raw: unknown): LayerPreviewRequest | 'invalid' {
  if (!raw || typeof raw !== 'object') return 'invalid';
  const { on, corner, size } = raw as { on?: unknown; corner?: unknown; size?: unknown };
  if (typeof on !== 'boolean') return 'invalid';
  if (corner != null && !isLogoCorner(corner)) return 'invalid';
  if (size != null && !isLogoSize(size)) return 'invalid';
  return { on, corner: corner ?? null, size: size ?? null };
}

/** 화면에 보내는 로고 보기 — 준비됨이면 확정 설정(키 · 자리 · 크기 · 칩 · 판 여부) · 캐시 경로는 싣지 않는다 */
export type LogoView =
  | { state: 'ready'; on: boolean; corner: LogoCorner; size: LogoSize; key: string; plate: boolean; corners: LogoCorner[]; sizes: Array<{ id: LogoSize; ok: boolean }> }
  | { state: 'none'; homepage: string | null }
  | { state: 'unusable'; reason: LogoUnusableReason };

function readyView(st: Extract<StudioLogoState, { state: 'ready' }>, plan: LogoPlan, on: boolean): LogoView {
  return { state: 'ready', on, corner: plan.corner, size: plan.size, key: st.key, plate: !!plan.plate, corners: plan.corners, sizes: plan.sizes };
}

/**
 * 미리보기 — 바탕(이 회사 임시 · kind poster)을 읽기만 한다(쓰기 0 · 잠금 0 · 0크레딧).
 *   키트 로고가 없거나 못 쓰면 상태만 · 켜짐 = 합성 미리보기(data URL) · 끔 = 미리보기 null + 자리 · 칩(다시 켤 때 같은 자리).
 */
export async function previewLogoStage(
  companyId: string, baseTempId: string, req: LayerPreviewRequest, textless: boolean,
  deps: Pick<LogoSaveDeps, 'logoState'> = defaultLogoSaveDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const meta = readTempMeta(companyId, baseTempId);
  const found = findTempFile(companyId, baseTempId);
  if (!meta || !found || meta.kind !== 'poster') {
    return { status: 404, body: { success: false, error: '이 포스터는 기간이 지나 로고를 바꿀 수 없어요.', code: 'BASE_NOT_FOUND' } };
  }
  const st = await deps.logoState(companyId);
  if (st.state !== 'ready') return { status: 200, body: { success: true, logo: publicLogoState(st), preview: null } };
  const plan = await planLogo(found.absPath, st, { corner: req.corner, size: req.size }, textless);
  if ('error' in plan) return { status: 400, body: { success: false, error: '로고 자리와 크기를 다시 골라 주세요.', code: 'LAYER_INVALID' } };
  if (!req.on) return { status: 200, body: { success: true, logo: readyView(st, plan, false), preview: null } };
  const preview = await renderLogoPreview(found.absPath, st.png, plan);
  return { status: 200, body: { success: true, logo: readyView(st, plan, true), preview } };
}
