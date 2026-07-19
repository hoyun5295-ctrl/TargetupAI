/**
 * utils/image-studio.ts — P4 AI 이미지 스튜디오 컨트롤타워 (2026-07-19)
 *
 * 정체성 = AI 오퍼레이터를 위한 스튜디오. 1급 흐름:
 *   원본 제품 누끼(픽셀 보존) → AI 배경 생성(제품 없음) → 서버 합성(/compose·PIL) → 정제 타이포 3단.
 *   AI는 배경만 만든다 — 제품 재생성 금지(브랜드 왜곡 구조적 차단).
 *
 * SoT = docs/2026-07-18-p4-image-studio-design.md (v3). 실측 확정(2026-07-19):
 *   - API 표면 = generateContent (x-goog-api-key). imageSize 대문자 K 의무.
 *   - 4K 격상·편집 = 멀티턴 보존. ★단, 이전 응답의 thoughtSignature를 재전송하면 imageSize 변경 시 404
 *     ("Requested entity was not found") → 재전송 파트에서 thoughtSignature를 반드시 제거(strip). (V1=sig+4K 404 / V2=nosig+4K OK 실측)
 *   - 누끼·합성 = 상주 python 서비스(127.0.0.1, rembg isnet-general-use + PIL). 0.0.0.0 금지.
 *   - 에러 원문 UI 노출 금지(모델명 노출 사고) → 코드 매핑만 반환, 원문은 PM2 로그.
 *
 * 크레딧: checkCredit(사전) → Gemini 성공 → deductCreditSafe(멱등키 image-studio:{uuid}). ai-credit.ts CT 사용.
 * 이 CT는 라우트(routes/image-studio.ts)와 temp 스윕 워커(studio-temp-sweeper.ts)가 소비한다.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getSeasonContext } from './season-context';

// ── env / 설정 ─────────────────────────────────────────────
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
/** 상주 python 서비스(누끼·합성). 127.0.0.1 전용. */
const STUDIO_PY_URL = process.env.STUDIO_PY_URL || 'http://127.0.0.1:8555';
/** temp 산출물 루트 — 저장 전 산출물(7일 스윕). */
const STUDIO_TEMP_BASE = process.env.STUDIO_TEMP_PATH || path.resolve('./uploads/studio-temp');
/** 저장(영구) 루트 — 인앱 이미지 서빙 경로 재사용(/api/cdp/inapp/image/{companyId}/{filename}). */
const INAPP_IMAGE_BASE = process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp');
/** 회사당 temp 총량 상한(§7-3 Harold 확정: 200MB). */
export const STUDIO_TEMP_CAP_BYTES = Number(process.env.STUDIO_TEMP_CAP_BYTES) || 200 * 1024 * 1024;
/** temp 보존일(스윕 기준). */
export const STUDIO_TEMP_TTL_DAYS = Number(process.env.STUDIO_TEMP_TTL_DAYS) || 7;

/** 스튜디오 사용 가능 여부(키 미설정 = 카드 "준비 중", 500 금지 §5-3). */
export function isStudioReady(): boolean {
  return !!GEMINI_API_KEY;
}

// ── 에러 매핑 (§5-1-11 — 원문 UI 노출 금지) ────────────────────
export type StudioErrorCode =
  | 'STUDIO_NOT_READY'
  | 'SAFETY_BLOCKED'
  | 'RATE_LIMITED'
  | 'GEN_FAILED'
  | 'PY_SERVICE_DOWN'
  | 'INGEST_FAILED'
  | 'BUSY';

const STUDIO_ERROR_MESSAGES: Record<StudioErrorCode, string> = {
  STUDIO_NOT_READY: '이미지 스튜디오가 준비 중입니다. 잠시 후 다시 시도해주세요.',
  SAFETY_BLOCKED: '안전 기준으로 생성이 거부됐어요 — 문구나 상품을 바꿔 다시 시도해주세요.',
  RATE_LIMITED: '지금 요청이 몰려 잠시 대기가 필요합니다. 잠시 후 다시 시도해주세요.',
  GEN_FAILED: '이미지 생성에 실패했어요. 잠시 후 다시 시도해주세요.',
  PY_SERVICE_DOWN: '이미지 준비 기능을 점검 중입니다. 잠시 후 다시 시도해주세요.',
  INGEST_FAILED: '상품 이미지를 가져오지 못했어요. 다른 이미지를 사용해주세요.',
  BUSY: '다른 이미지 생성이 진행 중입니다. 완료 후 다시 시도해주세요.',
};

export class StudioError extends Error {
  code: StudioErrorCode;
  httpStatus: number;
  /** 크레딧 미차감 여부(세이프티 거부·미준비 등은 미차감). */
  noCharge: boolean;
  constructor(code: StudioErrorCode, httpStatus = 400, noCharge = true) {
    super(STUDIO_ERROR_MESSAGES[code]);
    this.code = code;
    this.httpStatus = httpStatus;
    this.noCharge = noCharge;
  }
  get userMessage(): string {
    return STUDIO_ERROR_MESSAGES[this.code];
  }
}

// ── 채널 프리셋 (§4-4 2트랙) ───────────────────────────────
export type StudioTrack = 'quality' | 'mms';
export interface ChannelPreset {
  key: string;
  label: string;
  aspectRatio: string;
  imageSize: '1K' | '2K';
  track: StudioTrack;
  channelSpec: string; // cdp_assets.channel_spec 태그
  /** 오버레이 텍스트 존(상단/하단) — 프롬프트 여백 지시. */
  textZone: 'top' | 'bottom';
}

export const CHANNEL_PRESETS: Record<string, ChannelPreset> = {
  'inapp-poster': { key: 'inapp-poster', label: '인앱 포스터형', aspectRatio: '3:4', imageSize: '2K', track: 'quality', channelSpec: 'inapp-poster', textZone: 'top' },
  'dm-card':      { key: 'dm-card',      label: 'DM 카드',      aspectRatio: '1:1', imageSize: '2K', track: 'quality', channelSpec: 'dm',           textZone: 'bottom' },
  'email-hero':   { key: 'email-hero',   label: '이메일 히어로', aspectRatio: '16:9', imageSize: '2K', track: 'quality', channelSpec: 'email',       textZone: 'bottom' },
  'free':         { key: 'free',         label: '자유',          aspectRatio: '3:4', imageSize: '2K', track: 'quality', channelSpec: 'free',         textZone: 'top' },
  // MMS 전용 — 생성은 1K(896×1200), 서버가 1080px 리사이즈 + JPEG ≤300KB 보장(§4-4 트랙 B).
  'mms':          { key: 'mms',          label: 'MMS',          aspectRatio: '3:4', imageSize: '1K', track: 'mms',     channelSpec: 'mms',          textZone: 'top' },
};

export function resolvePreset(presetKey: string | undefined): ChannelPreset {
  return (presetKey && CHANNEL_PRESETS[presetKey]) || CHANNEL_PRESETS['inapp-poster'];
}

// ── 용도 카드 (§5-2 — 카드 문구 = 실제 주입 프롬프트 1:1) ─────────
export interface PurposeCard {
  key: string;
  label: string;
  desc: string;
  /** 배경 씬 스타일 지시(제품 없음 전제 — 제품은 누끼로 합성). */
  scene: string;
}

export const PURPOSE_CARDS: Record<string, PurposeCard> = {
  'new-product': {
    key: 'new-product', label: '신상품 포스터', desc: '깔끔한 스테이징에 신상품을 돋보이게',
    scene: 'A clean premium product-staging scene, minimal and modern, subtle elegant props at the edges, calm neutral studio backdrop that makes a single product stand out.',
  },
  'season-promo': {
    key: 'season-promo', label: '시즌 프로모션', desc: '지금 계절 감성의 판매 무드',
    scene: 'A warm inviting seasonal product-staging scene with tasteful seasonal props and atmosphere at the edges, keeping the product placement area clean.',
  },
  'event-notice': {
    key: 'event-notice', label: '이벤트 공지', desc: '행사·이벤트 알림용 배경',
    scene: 'A festive yet tasteful product-staging scene suitable for an event announcement, celebratory but clean and not cluttered, product placement area kept empty.',
  },
  'brand-mood': {
    key: 'brand-mood', label: '브랜드 무드컷', desc: '브랜드 감성의 editorial 컷',
    scene: 'An editorial high-end brand mood scene, refined lighting and texture, magazine-quality product staging, restrained palette, product placement area kept clean.',
  },
  'free-scene': {
    key: 'free-scene', label: '자유 생성', desc: '원하는 분위기를 자유롭게',
    scene: 'A tasteful product-staging scene.',
  },
};

export function resolvePurpose(purposeKey: string | undefined): PurposeCard {
  return (purposeKey && PURPOSE_CARDS[purposeKey]) || PURPOSE_CARDS['new-product'];
}

// ── 혜택 픽셀 금지 감지 (§5-3 — 유저 힌트에 혜택 수치 감지) ─────────
const BENEFIT_PATTERN = /(\d+\s*%)|(\d[\d,]*\s*원)|할인|쿠폰|무료|증정|사은품|적립|세일|special\s*offer|discount|sale|% ?off/i;
export function hasBenefitPattern(text: string | undefined | null): boolean {
  return !!text && BENEFIT_PATTERN.test(text);
}

// ── buildMarketingPrompt (§5-1-0 마케팅 증강 계층) ─────────────
export interface BuildPromptInput {
  purposeKey?: string;
  presetKey?: string;
  /** 유저 자연어 한 줄(선택) — "장면 묘사 힌트"로만 중간 삽입, 금지 지시는 마지막. */
  userHint?: string | null;
  /** 브랜드 키트(선택) — accentColor/tone. v1은 라우트가 있으면 주입, 없으면 생략. */
  brand?: { accentColor?: string | null; tone?: string | null } | null;
  /** 제품 합성용 배경인지(제품 놓일 하단 중앙 여백 강조). 스튜디오 기본 true. */
  forProductComposite?: boolean;
  now?: Date;
}

/**
 * 유저 입력을 그대로 모델에 넘기지 않는다. 증강 계층:
 *   용도 카드 씬 + 채널 구도 규칙 + 오버레이 여백(텍스트 존) + 광원·구도 제약(H-1 붙인 티 방지)
 *   + 브랜드 톤(선택) + 시즌 컨텍스트 + (중간)유저 힌트 + (마지막)금지 지시(픽셀 텍스트·숫자·혜택).
 * 지시 순서(H-6 인젝션 방어): 유저 한 줄은 중간 "장면 힌트", 금지 지시가 항상 마지막.
 */
export function buildMarketingPrompt(input: BuildPromptInput): string {
  const purpose = resolvePurpose(input.purposeKey);
  const preset = resolvePreset(input.presetKey);
  const now = input.now || new Date();
  const season = getSeasonContext(now);
  const forComposite = input.forProductComposite !== false;

  const lines: string[] = [];
  // 1. 씬 스타일(용도 카드)
  lines.push(purpose.scene);
  // 2. 채널 구도
  lines.push(`Composition for a ${preset.label} marketing poster, aspect ratio ${preset.aspectRatio}.`);
  // 3. 제품 자리 + 오버레이 여백(텍스트 존)
  if (forComposite) {
    lines.push('Leave a clean empty flat horizontal surface in the lower-center where a product will be composited later.');
  }
  lines.push(
    preset.textZone === 'top'
      ? 'Keep the upper third clean and simple, reserved for a text headline overlay.'
      : 'Keep the lower area clean and simple, reserved for a text headline overlay.'
  );
  // 4. 광원·구도 제약 (H-1 — "붙인 티" 방지)
  lines.push('Soft diffuse frontal lighting, eye-level camera angle, flat horizontal surface, no strong directional shadows.');
  // 5. 브랜드 톤(선택)
  if (input.brand?.accentColor) lines.push(`Subtle brand accent color harmony around ${input.brand.accentColor}.`);
  if (input.brand?.tone) lines.push(`Overall tone: ${input.brand.tone}.`);
  // 6. 시즌 컨텍스트(톤·소재로만)
  if (season.keywords.length) {
    lines.push(`Seasonal atmosphere hint (${season.season}): ${season.keywords.slice(0, 3).join(', ')} — as ambience only, do not add literal text.`);
  }
  // 7. (중간) 유저 힌트 — 장면 묘사로만. 혜택 패턴은 사전 제거(픽셀 텍스트 방지).
  const hint = (input.userHint || '').trim();
  if (hint && !hasBenefitPattern(hint)) {
    lines.push(`Scene hint from the user (describe the scene only, do not render it as text): ${hint.slice(0, 300)}`);
  }
  // 8. (마지막) 금지 지시 — 항상 끝에.
  lines.push('Do not render any product, any text, any numbers, any letters, any logos, any price, any discount or promotional marks in the image. Background scene only.');

  return lines.join('\n');
}

// ── Gemini 클라이언트 (generateContent) ────────────────────────
const GEMINI_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  thoughtSignature?: string;
}
export interface GeneratedImage {
  base64: string;
  mime: string;
  /** 원본 모델 파트(멀티턴 편집 시 재전송용 — thoughtSignature 포함 상태). */
  parts: GeminiPart[];
  imageTokens: number;
  ms: number;
}

async function callGemini(
  contents: any[],
  imageSize: '1K' | '2K' | '4K',
  aspectRatio: string,
  timeoutMs: number,
): Promise<GeneratedImage> {
  if (!GEMINI_API_KEY) throw new StudioError('STUDIO_NOT_READY', 503, true);
  const body = {
    contents,
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio, imageSize },
    },
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(GEMINI_URL(GEMINI_IMAGE_MODEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    console.error(`[image-studio] Gemini fetch 실패: ${err?.name === 'AbortError' ? 'timeout' : err?.message}`);
    throw new StudioError('GEN_FAILED', 502, true);
  }
  clearTimeout(timer);
  const ms = Date.now() - t0;
  const json: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    // 원문은 로그만 — 응답엔 코드 매핑 메시지만(§5-1-11 모델명 노출 차단).
    console.error(`[image-studio] Gemini HTTP ${res.status} ${ms}ms: ${JSON.stringify(json).slice(0, 500)}`);
    if (res.status === 429) throw new StudioError('RATE_LIMITED', 429, true);
    throw new StudioError('GEN_FAILED', 502, true);
  }

  const cand = json?.candidates?.[0];
  const finishReason = cand?.finishReason || json?.promptFeedback?.blockReason;
  const parts: GeminiPart[] = cand?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData);

  if (!imgPart?.inlineData) {
    // 이미지 없음 = 세이프티 거부(finishReason SAFETY/PROHIBITED_CONTENT/IMAGE_SAFETY) 또는 생성 실패.
    console.warn(`[image-studio] 이미지 파트 없음 finishReason=${finishReason} ${ms}ms`);
    const fr = String(finishReason || '').toUpperCase();
    if (fr.includes('SAFETY') || fr.includes('PROHIBITED') || fr.includes('BLOCK')) {
      throw new StudioError('SAFETY_BLOCKED', 400, true);
    }
    throw new StudioError('GEN_FAILED', 502, true);
  }

  const imageTokens = Number(
    (cand?.content && json?.usageMetadata?.candidatesTokensDetails?.find((d: any) => d.modality === 'IMAGE')?.tokenCount) || 0,
  );
  return { base64: imgPart.inlineData.data, mime: imgPart.inlineData.mimeType || 'image/jpeg', parts, imageTokens, ms };
}

/** 배경 1장 생성(단일턴). */
export async function generateBackground(prompt: string, preset: ChannelPreset): Promise<GeneratedImage> {
  return callGemini(
    [{ role: 'user', parts: [{ text: prompt }] }],
    preset.imageSize,
    preset.aspectRatio,
    90_000,
  );
}

/** ★ 재전송 파트에서 thoughtSignature 제거 (strip) — imageSize 변경 시 404 원인 차단(실측). */
function stripSignature(parts: GeminiPart[]): GeminiPart[] {
  return parts.map((p) => {
    const { thoughtSignature, ...rest } = p;
    return rest;
  });
}

/**
 * 멀티턴 보존 편집/격상 (§4-3). basePrompt(원 생성 프롬프트) + base 이미지(sig 제거) + instruction.
 *  - 4K 격상: instruction = 구도 유지 재출력, imageSize '4K'.
 *  - 배경/무드 편집: instruction = 유저 요청(배경·전체 무드 한정), imageSize '2K'.
 */
export async function editOrUpscale(opts: {
  baseImageBase64: string;
  baseMime: string;
  basePrompt: string;
  instruction: string;
  imageSize: '2K' | '4K';
  aspectRatio: string;
}): Promise<GeneratedImage> {
  const modelTurnParts: GeminiPart[] = stripSignature([
    { inlineData: { mimeType: opts.baseMime, data: opts.baseImageBase64 } },
  ]);
  const contents = [
    { role: 'user', parts: [{ text: opts.basePrompt }] },
    { role: 'model', parts: modelTurnParts },
    { role: 'user', parts: [{ text: opts.instruction }] },
  ];
  return callGemini(contents, opts.imageSize, opts.aspectRatio, 120_000);
}

export const UPSCALE_4K_INSTRUCTION =
  'Output the exact same image at 4K resolution. Do not change the composition, layout, colors, lighting, or any element. Same scene, higher resolution only.';

/** 배경/무드 편집 지시 — 제품 픽셀 재생성 뒷문 차단(배경·전체 무드만, M-8). */
export function buildEditInstruction(userInstruction: string): string {
  const safe = (userInstruction || '').trim().slice(0, 300);
  return [
    'Adjust only the background scene and overall mood of this image as follows:',
    safe,
    'Keep it a clean product-staging background. Do not add any product, any text, any numbers, any logos, any price or discount marks.',
  ].join('\n');
}

// ── 상주 python 서비스 클라이언트 (누끼·합성) ────────────────────
async function callPy(endpoint: string, payload: any, timeoutMs = 60_000): Promise<any> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${STUDIO_PY_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    console.error(`[image-studio] py ${endpoint} 연결 실패: ${err?.name === 'AbortError' ? 'timeout' : err?.message}`);
    throw new StudioError('PY_SERVICE_DOWN', 503, true);
  }
  clearTimeout(timer);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    console.error(`[image-studio] py ${endpoint} 오류 HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    throw new StudioError('PY_SERVICE_DOWN', 503, true);
  }
  return json;
}

/** 누끼 — src(제품 이미지) → out(알파 PNG). {width,height} 반환. */
export async function removeBackground(srcPath: string, outPath: string): Promise<{ width: number; height: number }> {
  const r = await callPy('/remove-bg', { src: srcPath, out: outPath }, 60_000);
  return { width: Number(r.width) || 0, height: Number(r.height) || 0 };
}

export interface ComposeLayout { x: number; y: number; scale: number } // 0~1 정규화(중심 x, 바닥 y, 폭 비율)
export interface ComposeTypography { text: string; fontPath?: string | null; size: number; color: string; align: 'left' | 'center' | 'right'; x: number; y: number }
export interface ComposeInput {
  bgPath: string;
  cutoutPath?: string | null;
  outPath: string;
  layout?: ComposeLayout | null;
  typography?: ComposeTypography[];
  /** MMS 트랙이면 maxBytes 지정 — 서버가 1080px 리사이즈 + JPEG 품질 이진탐색으로 보장. */
  mmsMaxBytes?: number | null;
  format: 'jpeg' | 'png';
}
/** 서버 합성(§5-1-5) — 알파 bbox 트림 + 접지 그림자 + 타이포 + 인코딩. bytes 서버 실측 반환(클라 신고 불신). */
export async function composeImage(input: ComposeInput): Promise<{ bytes: number; width: number; height: number; mime: string }> {
  const r = await callPy('/compose', {
    bg: input.bgPath,
    cutout: input.cutoutPath || null,
    out: input.outPath,
    layout: input.layout || null,
    typography: input.typography || [],
    mms_max_bytes: input.mmsMaxBytes || null,
    format: input.format,
  }, 60_000);
  return { bytes: Number(r.bytes) || 0, width: Number(r.width) || 0, height: Number(r.height) || 0, mime: String(r.mime || 'image/jpeg') };
}

// ── temp 저장소 (per-company, sidecar 메타) ────────────────────
export interface TempMeta {
  companyId: string;
  kind: 'source' | 'background' | 'cutout' | 'composite';
  ext: string;
  mime: string;
  prompt?: string | null;
  presetKey?: string | null;
  channelSpec?: string | null;
  width?: number | null;
  height?: number | null;
  aspectRatio?: string | null;
  createdAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidTempId(id: string): boolean {
  return UUID_RE.test(id || '');
}

export function newTempId(): string {
  return crypto.randomUUID();
}

function companyTempDir(companyId: string): string {
  return path.join(STUDIO_TEMP_BASE, companyId);
}
function ensureTempDir(companyId: string): string {
  const dir = companyTempDir(companyId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 회사 temp 총 사용량(bytes) — 200MB 상한 검사용. */
export function companyTempUsageBytes(companyId: string): number {
  const dir = companyTempDir(companyId);
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json')) continue;
    try { total += fs.statSync(path.join(dir, f)).size; } catch { /* noop */ }
  }
  return total;
}

/** temp 이미지 저장(buffer) + 사이드카 메타. tempId 반환. */
export function writeTempBuffer(companyId: string, buffer: Buffer, meta: Omit<TempMeta, 'companyId' | 'createdAt'>): string {
  const dir = ensureTempDir(companyId);
  const tempId = newTempId();
  fs.writeFileSync(path.join(dir, `${tempId}.${meta.ext}`), buffer);
  const full: TempMeta = { ...meta, companyId, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, `${tempId}.json`), JSON.stringify(full));
  return tempId;
}

/** python이 직접 쓸 temp 경로를 미리 할당(파일은 python이 생성). tempId + 절대경로 반환. */
export function allocTempPath(companyId: string, ext: string): { tempId: string; absPath: string } {
  const dir = ensureTempDir(companyId);
  const tempId = newTempId();
  return { tempId, absPath: path.join(dir, `${tempId}.${ext}`) };
}

/** python이 생성한 temp 파일의 사이드카 메타 기록. */
export function writeTempMeta(companyId: string, tempId: string, meta: Omit<TempMeta, 'companyId' | 'createdAt'>): void {
  const dir = ensureTempDir(companyId);
  const full: TempMeta = { ...meta, companyId, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, `${tempId}.json`), JSON.stringify(full));
}

export function readTempMeta(companyId: string, tempId: string): TempMeta | null {
  if (!isValidTempId(tempId)) return null;
  const p = path.join(companyTempDir(companyId), `${tempId}.json`);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as TempMeta;
  } catch { return null; }
}

/** tempId의 실제 이미지 파일 경로(확장자 미상 — 사이드카 ext 기준). 없으면 null. */
export function findTempFile(companyId: string, tempId: string): { absPath: string; ext: string; mime: string } | null {
  const meta = readTempMeta(companyId, tempId);
  if (!meta) return null;
  const abs = path.join(companyTempDir(companyId), `${tempId}.${meta.ext}`);
  if (!fs.existsSync(abs)) return null;
  return { absPath: abs, ext: meta.ext, mime: meta.mime };
}

/** temp → 영구(INAPP_IMAGE_BASE) 이동 + tempId 1회성 소비(사이드카·원본 삭제). URL·bytes 반환. */
export function moveTempToPermanent(companyId: string, tempId: string): { url: string; filename: string; bytes: number; ext: string } | null {
  const found = findTempFile(companyId, tempId);
  if (!found) return null;
  const destDir = path.join(INAPP_IMAGE_BASE, companyId);
  fs.mkdirSync(destDir, { recursive: true });
  const filename = `${tempId}.${found.ext}`;
  const destPath = path.join(destDir, filename);
  fs.renameSync(found.absPath, destPath);
  // 사이드카 삭제 = 1회성 소비(재-save 시 findTempFile null → 409/404).
  try { fs.unlinkSync(path.join(companyTempDir(companyId), `${tempId}.json`)); } catch { /* noop */ }
  const bytes = fs.statSync(destPath).size;
  return { url: `/api/cdp/inapp/image/${companyId}/${filename}`, filename, bytes, ext: found.ext };
}

/** 7일 스윕 — mtime 기준(사이드카 문구로 사용자 고지). ext·json 모두 정리. 삭제 건수 반환. */
export function sweepOldTemp(maxAgeDays = STUDIO_TEMP_TTL_DAYS): number {
  if (!fs.existsSync(STUDIO_TEMP_BASE)) return 0;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const company of fs.readdirSync(STUDIO_TEMP_BASE)) {
    const dir = path.join(STUDIO_TEMP_BASE, company);
    let stat: fs.Stats;
    try { stat = fs.statSync(dir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) { fs.unlinkSync(fp); removed++; }
      } catch { /* noop */ }
    }
  }
  return removed;
}

// ── 회사당 동시 생성 1건 락 (§5-1-1 — pm2 fork 단일 확정 → in-memory) ──
const inFlight = new Set<string>();
export function tryAcquireGenerateLock(companyId: string): boolean {
  if (inFlight.has(companyId)) return false;
  inFlight.add(companyId);
  return true;
}
export function releaseGenerateLock(companyId: string): void {
  inFlight.delete(companyId);
}

// ── 크레딧 source 상수 (ai-credit-calc.ts CREDIT_COST_MAP과 1:1) ──
export const CREDIT_SOURCE = {
  generate: 'image-studio-generate',
  upscale4k: 'image-studio-4k',
  edit: 'image-studio-edit',
} as const;
