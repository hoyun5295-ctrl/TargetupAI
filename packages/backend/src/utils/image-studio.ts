/**
 * utils/image-studio.ts — P4 AI 이미지 스튜디오 컨트롤타워 (2026-07-19)
 *
 * 정체성 = AI 오퍼레이터를 위한 스튜디오. 1급 흐름:
 *   원본 제품 누끼(픽셀 보존) → AI 배경 생성(제품 없음) → 서버 합성(/compose·PIL) → 정제 타이포 3단.
 *   AI는 배경만 만든다 — 제품 재생성 금지(브랜드 왜곡 구조적 차단).
 *
 * SoT = docs/2026-07-18-p4-image-studio-design.md (v3). 실측 확정(2026-07-19):
 *   - API 표면 = generateContent (x-goog-api-key). imageSize 대문자 K 의무.
 *   - 편집 = 멀티턴 보존(4K 격상은 2026-09-30 제거). ★단, 이전 응답의 thoughtSignature를 재전송하면 imageSize 변경 시 404
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
import sharp from 'sharp';   // ★ 2026-11-02 제품 사진 여러 장 묶기(groupProductCutouts)
import type { OutputInfo, OverlayOptions } from 'sharp';
import { getSeasonContext } from './season-context';
import { INAPP_CONTENT_SAFE } from './image-fit-spec';   // ★ C118 인앱 안전 칸 값 하나

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

// ── ★ 2026-07-31 템플릿 예시 실샘플 (Harold — "이 템플릿은 이런 이미지로 나온다") ──────
//   배치 생성 산출물(영구·temp 스윕 제외). 카드 exampleUrl 폴백 소스 — 파일이 있으면 카드가 실샘플을 표시.
//   경로 인자는 카탈로그 id로만 조립(라우트에서 getTemplate 검증 후 호출 — 경로 조작 차단).
const STUDIO_SAMPLE_BASE = process.env.STUDIO_SAMPLE_PATH || path.resolve('./uploads/studio-samples');
const SAMPLE_EXTS = ['jpg', 'jpeg', 'png', 'webp'] as const;

/** v = 파일 수정 시각(ms) — 주소에 붙여 긴 캐시를 건다(파일을 다시 만들면 v 가 바뀌어 새로 받는다). */
export function findTemplateSample(templateId: string): { absPath: string; mime: string; v: number } | null {
  for (const ext of SAMPLE_EXTS) {
    const p = path.join(STUDIO_SAMPLE_BASE, `${templateId}.${ext}`);
    try {
      const st = fs.statSync(p);
      return { absPath: p, mime: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', v: Math.floor(st.mtimeMs) };
    } catch { /* 이 확장자 없음 */ }
  }
  return null;
}

// ── ★ 2026-11-01 예시 생성 = 서버 스크립트 전용(scripts/studio-samples.ts) · 주소 없음(1025 R15 로 지운 /template-samples/generate 대신) ──
/** 예시 파일이 아직 없는 템플릿(ids 를 주면 그 안에서만) — 카탈로그 순서 그대로. */
export function templatesMissingSample<T extends { id: string; exampleUrl?: string | null }>(all: readonly T[], ids?: readonly string[] | null): T[] {
  return all.filter((t) => !t.exampleUrl && !findTemplateSample(t.id) && (!ids || ids.includes(t.id)));
}

/** 예시 한 장 저장 — 임시 파일에 쓰고 옮긴다(반쪽 파일이 서빙되거나 「있음」으로 세지지 않게). 확장자 = 모델이 준 형식. */
export function saveTemplateSample(templateId: string, img: { base64: string; mime: string }): string {
  fs.mkdirSync(STUDIO_SAMPLE_BASE, { recursive: true });
  const ext = img.mime.includes('png') ? 'png' : img.mime.includes('webp') ? 'webp' : 'jpg';
  const out = path.join(STUDIO_SAMPLE_BASE, `${templateId}.${ext}`);
  const tmp = path.join(STUDIO_SAMPLE_BASE, `.tmp-${crypto.randomUUID()}`);
  fs.writeFileSync(tmp, Buffer.from(img.base64, 'base64'));
  fs.renameSync(tmp, out);
  return out;
}

/** 예시 배치 — 앞에서부터 count 장 · 실패가 maxFail 번 쌓이면 멈춘다(장애 때 돈이 새지 않게). */
export async function runSampleBatch<T extends { id: string }>(
  list: readonly T[], count: number, makeOne: (t: T) => Promise<void>,
  log: (line: string) => void = console.log, maxFail = 3,
): Promise<{ made: string[]; failed: string[] }> {
  const made: string[] = [];
  const failed: string[] = [];
  for (const t of list.slice(0, count)) {
    try {
      await makeOne(t);
      made.push(t.id);
      log(`[${made.length + failed.length}/${Math.min(count, list.length)}] ${t.id} 완료`);
    } catch (e: any) {
      failed.push(t.id);
      log(`[${made.length + failed.length}/${Math.min(count, list.length)}] ${t.id} 실패: ${String(e?.code || e?.message || e).slice(0, 120)}`);
      if (failed.length >= maxFail) { log(`실패 ${failed.length}번 · 멈춤`); break; }
    }
  }
  return { made, failed };
}

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
  | 'BUSY'
  | 'TEMP_FULL'
  | 'PRODUCTS_INVALID'
  | 'PRODUCT_TOO_LARGE'
  | 'LAYER_FAILED'
  | 'LOGO_SAVE_FAILED';

const STUDIO_ERROR_MESSAGES: Record<StudioErrorCode, string> = {
  STUDIO_NOT_READY: '이미지 스튜디오가 준비 중입니다. 잠시 후 다시 시도해주세요.',
  SAFETY_BLOCKED: '안전 기준으로 생성이 거부됐어요. 문구나 상품을 바꿔 다시 시도해주세요.',
  RATE_LIMITED: '지금 요청이 몰려 잠시 대기가 필요합니다. 잠시 후 다시 시도해주세요.',
  GEN_FAILED: '이미지 생성에 실패했어요. 잠시 후 다시 시도해주세요.',
  PY_SERVICE_DOWN: '이미지 준비 기능을 점검 중입니다. 잠시 후 다시 시도해주세요.',
  INGEST_FAILED: '상품 이미지를 가져오지 못했어요. 다른 이미지를 사용해주세요.',
  BUSY: '다른 이미지 생성이 진행 중입니다. 완료 후 다시 시도해주세요.',
  TEMP_FULL: '임시 보관 용량이 가득 찼습니다. 저장하거나 정리 후 다시 시도해주세요.',
  PRODUCTS_INVALID: '제품 사진은 3개까지 넣을 수 있어요. 다시 골라 주세요.',
  PRODUCT_TOO_LARGE: '제품 사진이 너무 크거나 길쭉해서 함께 넣을 수 없어요. 다른 사진으로 다시 넣어 주세요.',
  LAYER_FAILED: '로고를 얹지 못했어요. 다시 눌러 주세요.',
  LOGO_SAVE_FAILED: '로고를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
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
  // ★ 2026-07-30 채널 축 폐기(Harold) — 생성은 'poster' 단일(3:4·채널 무관). 완성 포스터는 인앱/DM/이메일 어디든 통짜 삽입(0722 원칙).
  //   ★ 2026-11-08 C118 결정 바뀜(Harold 「각각 제작하게 · 하나로 모든 걸 커버하는 거 안 될 것 같다」) = 용도별 프리셋 셋 + 'poster' = 자유 형태(기본 3:4)
  //   설계서 docs/2026-11-08-c118-studio-per-use-inapp-app-design.md A1 · 옛 키 넷(아래) = 옛 임시 · 자산 해석용 그대로(값 무변경)
  'poster':       { key: 'poster',       label: '자유 형태',      aspectRatio: '3:4', imageSize: '2K', track: 'quality', channelSpec: 'poster',       textZone: 'top' },
  'use-inapp':    { key: 'use-inapp',    label: '인앱 메시지',    aspectRatio: '1:1', imageSize: '2K', track: 'quality', channelSpec: 'inapp-poster', textZone: 'top' },
  // ★ 1108 C118 E7 모바일 DM = 2:3(Harold 「DM 이랑 자유 형태 둘 다 3:4 인데 뭔 차이냐」 → 「2:3 세로로」 · DM 전단 기본 쪽 640:920 에 가장 가까움 · 자유 3:4 와 다른 그림)
  'use-dm':       { key: 'use-dm',       label: '모바일 DM',      aspectRatio: '2:3', imageSize: '2K', track: 'quality', channelSpec: 'dm',           textZone: 'top' },
  'use-email':    { key: 'use-email',    label: '이메일 마케팅',  aspectRatio: '4:3', imageSize: '2K', track: 'quality', channelSpec: 'email',        textZone: 'top' },
  // 아래 4종 = 레거시 호환(옛 temp meta·기존 자산 channel_spec 해석용). 신규 생성 UI는 'poster'만 보낸다.
  'inapp-poster': { key: 'inapp-poster', label: '인앱 포스터형', aspectRatio: '3:4', imageSize: '2K', track: 'quality', channelSpec: 'inapp-poster', textZone: 'top' },
  'dm-card':      { key: 'dm-card',      label: 'DM 카드',      aspectRatio: '1:1', imageSize: '2K', track: 'quality', channelSpec: 'dm',           textZone: 'bottom' },
  'email-hero':   { key: 'email-hero',   label: '이메일 히어로', aspectRatio: '16:9', imageSize: '2K', track: 'quality', channelSpec: 'email',       textZone: 'bottom' },
  'free':         { key: 'free',         label: '자유',          aspectRatio: '3:4', imageSize: '2K', track: 'quality', channelSpec: 'free',         textZone: 'top' },
  // MMS 전용 — 생성은 1K(896×1200), 서버가 1080px 리사이즈 + JPEG ≤300KB 보장(§4-4 트랙 B).
  'mms':          { key: 'mms',          label: 'MMS',          aspectRatio: '3:4', imageSize: '1K', track: 'mms',     channelSpec: 'mms',          textZone: 'top' },
};

/** ★ C118 A3 인앱용 프리셋(정사각 · 꽉 찬 그림 · 영구 이름 `.full.`) 판정 한 곳 */
export const STUDIO_FULL_PRESET = 'use-inapp';
export function isStudioFullPreset(presetKey: unknown): boolean {
  return presetKey === STUDIO_FULL_PRESET;
}
/** ★ C118 A3 영구 이름 계약 하나 — 인앱용 = `<id>.full.<ext>` · 그 밖 = `<id>.<ext>`(저장 · 다시 찾기 · 되돌리기가 이 이름을 쓴다) */
export function studioPermanentName(tempId: string, ext: string, full: boolean): string {
  return full ? `${tempId}.full.${ext}` : `${tempId}.${ext}`;
}

export function resolvePreset(presetKey: string | undefined): ChannelPreset {
  return (presetKey && CHANNEL_PRESETS[presetKey]) || CHANNEL_PRESETS['poster'];
}

// ★ 2026-07-21 채널 한글 라벨(파일명·표시용) — cdp_assets.channel_spec → 짧은 한글. 파일명만 봐도 용도 체킹.
const CHANNEL_LABEL_KO: Record<string, string> = {
  poster: '포스터', 'inapp-poster': '인앱', inapp: '인앱', dm: 'DM', email: '이메일', mms: 'MMS', free: '자유',
};
export function channelLabelKo(channelSpec: string | null | undefined): string {
  return (channelSpec && CHANNEL_LABEL_KO[channelSpec]) || '이미지';
}

// ★ 2026-07-21 라이브러리 표시 파일명 = "헤드라인_채널.ext" (랜덤 UUID 대체 + 용도 체킹 동시).
//   실제 저장 파일(URL)은 tempId 유지 — 이 값은 cdp_assets.filename(표시명)에만 들어간다. 파일시스템 안전화.
export function buildAssetDisplayName(title: string | null | undefined, channelSpec: string | null | undefined, ext: string): string {
  const safe = String(title || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '') // 파일명 금지·경로·제어 문자
    .replace(/\s+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 30);
  const base = safe || '이미지';
  const cleanExt = String(ext || 'jpg').replace(/^\./, '').replace('jpeg', 'jpg');
  return `${base}_${channelLabelKo(channelSpec)}.${cleanExt}`;
}

// ── 혜택 패턴 감지 — 장면 힌트 칸 오입력 안내용(문구 칸으로 유도). 문구 칸은 사용자 지정 verbatim 렌더 허용. ──
const BENEFIT_PATTERN = /(\d+\s*%)|(\d[\d,]*\s*원)|할인|쿠폰|무료|증정|사은품|적립|세일|special\s*offer|discount|sale|% ?off/i;
export function hasBenefitPattern(text: string | undefined | null): boolean {
  return !!text && BENEFIT_PATTERN.test(text);
}

// ── buildPosterPrompt (★v2 재정의 — 템플릿 스캐폴드 + 지정 문구까지 AI가 완성 포스터로 렌더) ──
import type { StudioTemplate } from './image-studio-templates';
import { discountPromptLines, discountFixedLayoutLine, type DiscountOffer, type DiscountLayout } from './studio-discount';

/**
 * ★ 2026-11-08 C114 D 글자 바닥 — 글 있는 모든 포스터(템플릿 textStyle 의 small · light · thin 을 이긴다 · 마지막 금지 줄 바로 앞).
 *   Harold 1108 「지금 우리 기존 템플릿들도 텍스트가 너무 보기에 작고」 · 템플릿 782종 데이터는 고치지 않고 이 한 줄.
 */
export const POSTER_LEGIBILITY_FLOOR = 'Legibility floor for phone screens (overrides any small, thin or light wording in the typography direction): the headline must be large and bold, at least about 5% of the poster height, any secondary line at least about 2.5% of the poster height, no hairline-thin weights for the headline, and no tiny fine print anywhere.';

export interface PosterTexts {
  label?: string | null;    // 작은 상단 라벨 (예: ONLINE EXCLUSIVE)
  title?: string | null;    // 메인 헤드라인 (예: 얼티뮨 세트 30% 할인)
  subtitle?: string | null; // 부제 (예: 한정 300명 특별 혜택)
}

/**
 * 은닉 스캐폴드(템플릿) + 사용자 지정 문구(verbatim) + 제품 보존 지시를 한 프롬프트로 합성.
 * 문구는 고객사가 직접 입력한 텍스트만 그대로 렌더 — "그 외 텍스트·숫자·로고 금지"가 항상 마지막(인젝션 방어).
 * 실증 결과물 = 시세이도 얼티뮨 포스터(Harold 실측 2026-07-19).
 */
export function buildPosterPrompt(input: {
  template: StudioTemplate;
  preset: ChannelPreset;
  texts: PosterTexts;
  userHint?: string | null;
  hasProduct: boolean;
  /** ★ 2026-08-09 문구 위치(위/중앙/아래) — 지정 시 템플릿 textStyle의 배치 문구보다 우선. 미지정 = 템플릿 기본(예시 배치도 미지정). */
  textPosition?: 'top' | 'center' | 'bottom' | null;
  now?: Date;
  /** ★ 2026-10-09 장면 문장 덮어쓰기(AI 영업이 소품 문장을 지운 판을 넘긴다) · 미지정 = template.scaffold 그대로 */
  scaffold?: string | null;
  /** ★ 2026-11-02 제품 사진 장수(2~3장 = 서버가 한 장으로 묶어 넘긴다 · 개수 줄 한 줄 더함) · 미지정 · 1 = 지금 출력 그대로 */
  productCount?: number;
  /** ★ 2026-11-08 C114 B 할인 템플릿 혜택(검사 끝난 값 · readDiscountOffer) · 할인 트랙만 */
  offer?: DiscountOffer | null;
  /** ★ C114 E 브랜드 키트 강조색(할인 트랙만 · 6자리 hex 만 줄이 된다) */
  brandColor?: string | null;
}): string {
  const { template, preset, texts } = input;
  const lines: string[] = [];
  // ★ C118 E3 할인 템플릿 = 글 자리 = 템플릿 배치(고정 틀 줄이 정한다 · 화면이 아래를 보내도 · 서버가 진실) ·
  //   ★ C119 stack = 위 · side = 왼쪽(위 · 가운데 · 아래 지점 문장 0 · 인앱 문장 = 왼쪽 글 · 오른쪽 아래 주제)
  const discountLayout: DiscountLayout = template.layout === 'side' ? 'side' : 'stack';
  const sideLayout = !!input.offer && discountLayout === 'side';
  const textPosition = input.offer && input.textPosition ? (sideLayout ? null : 'top') : input.textPosition;
  // ★ C118 E6 인앱용 = 할인 혜택 줄 · 고정 틀 줄도 안전 칸 안
  const discountSafe = isStudioFullPreset(preset.key) ? INAPP_CONTENT_SAFE : null;

  // 1. 장면 스캐폴드(은닉 — 템플릿이 품은 정교한 지시)
  lines.push(input.scaffold || template.scaffold);
  // 1-1. ★ 2026-08-09(2) 문구 위치 지정 시 — 장면 단계에서 그 자리를 비워 구도가 텍스트와 싸우지 않게 한다.
  //      (실측: 최후미 규칙만으로는 textStyle 상단 문구 + 장면 구도에 밀려 미준수 — 모순 제거가 뿌리 수정)
  if (textPosition) {
    const zone = textPosition === 'top' ? 'upper third' : textPosition === 'center' ? 'vertical center' : 'lower third';
    lines.push(`Scene composition requirement: reserve a calm, visually quiet zone at the ${zone} of the frame for the marketing copy, keep props, busy textures and strong highlights away from that zone.`);
  }
  // 2. 포스터 형식·비율
  lines.push(`This is a complete marketing poster design, aspect ratio ${preset.aspectRatio}.`);
  // 2-1. ★ C118 A3 인앱용 = 정사각 · 꽉 찬 그림 · 글 자리 = 같은 장면의 자연스러운 빈 공간 · 글 · 주제 = 가로 · 세로 가운데 80%(가장자리 10% = 배경만)
  if (isStudioFullPreset(preset.key)) {
    lines.push('Format: a full-bleed square in-app popup visual. The scene fills the whole square edge to edge, with no frame, border, card, box, banner bar or empty margins.');
    const pct = Math.round(INAPP_CONTENT_SAFE * 100);
    const edge = Math.round((1 - INAPP_CONTENT_SAFE) * 50);
    lines.push(`Keep every piece of copy and the main subject inside the central ${pct}% of the width and the central ${pct}% of the height; the outer ${edge}% on every side must contain only background scenery.`);
    const half = sideLayout ? 'left' : textPosition === 'bottom' ? 'lower' : 'upper';
    const other = sideLayout ? 'lower right' : half === 'upper' ? 'lower' : 'upper';
    lines.push(`The ${half} part of the square is a natural, color-matched calm continuation of the same scene where the copy sits, not a panel or overlay box. Place the main subject and props in the ${other} part so the copy never covers them.`);
  }
  // 3. 제품 보존(누끼 첨부 시) — 픽셀 충실 지시
  if (input.hasProduct) {
    lines.push('A product photo with transparent background is attached. Place it as the hero of the composition on a natural surface. Preserve the attached product EXACTLY as provided, do not redraw, restyle, recolor, or alter its shape, proportions, packaging, or label text in any way. Integrate it with scene-consistent lighting and a realistic soft ground shadow.');
    // ★ 2026-11-02 묶은 한 장 = 제품 n개(1102 운영 실측 12장에 쓴 문장 그대로 · 바로 위 보존 줄 다음 자리)
    const n = input.productCount || 1;
    if (n >= 2) {
      lines.push(`The attached transparent image contains ${n} different products placed side by side as one group. Show all ${n} products together as the hero group, keep their order and spacing, and preserve every one of them EXACTLY as provided, including each label text.`);
    }
  }
  // 4. 시즌(시즌 템플릿만)
  if (template.useSeason) {
    const season = getSeasonContext(input.now || new Date());
    lines.push(`Current Korean season: ${season.season} (month ${season.month}). Seasonal ambience keywords: ${season.keywords.slice(0, 3).join(', ')}, as scenery and mood only.`);
  }
  // 5. (중간) 장면 힌트 — 장면 묘사로만. 혜택 문구는 문구 칸으로(라우트가 안내).
  const hint = (input.userHint || '').trim();
  if (hint && !hasBenefitPattern(hint)) {
    lines.push(`Additional scene direction from the user (scenery only, never render this as text): ${hint.slice(0, 300)}`);
  }
  // 6. 문구 렌더 블록 — 사용자가 지정한 텍스트를 verbatim으로, 템플릿 타이포 지시에 맞춰.
  const label = (texts.label || '').trim().slice(0, 60);
  const title = (texts.title || '').trim().slice(0, 80);
  const subtitle = (texts.subtitle || '').trim().slice(0, 100);
  const given: string[] = [];
  if (label) given.push(`- Small top label: "${label}"`);
  if (title) given.push(`- Main headline: "${title}"`);
  if (subtitle) given.push(`- Sub-headline: "${subtitle}"`);
  if (given.length) {
    lines.push('Render the following marketing copy INTO the image as part of the design, in polished native-quality Korean typography (correct spelling, exact characters):');
    lines.push(given.join('\n'));
    // 위치 지정 시 textStyle의 위치 발언권을 박탈(서체·무드만) — 위치 권한자는 최후미 규칙 하나뿐.
    if (textPosition) {
      lines.push(`Typography direction (font mood and styling reference ONLY, any position wording inside it is void; the text position is defined solely by the FINAL LAYOUT RULE at the end): ${template.textStyle}`);
    } else {
      lines.push(`Typography direction: ${template.textStyle}`);
    }
    // ★ 2026-11-08 C114 B 할인 혜택 줄 = 지정 문구 뒤 · 마지막 금지 줄 앞(그릴 숫자 = 지정 문구 · 금지 줄이 막지 않는다)
    if (input.offer) lines.push(...discountPromptLines(input.offer, input.brandColor, discountSafe, discountLayout));
    // ★ 2026-11-08 C114 D 글자 바닥(모든 글 있는 포스터 · Harold 1108 「텍스트가 너무 보기에 작고」)
    lines.push(POSTER_LEGIBILITY_FLOOR);
  } else {
    lines.push('This poster has no text, pure visual composition with space that could hold a headline.');
  }
  // 7. (마지막) 제한 — 지정 문구 외 일체 금지.
  lines.push('Use ONLY the text given above, exactly as written, do not add, translate, paraphrase, or modify any wording or numbers. Do not render any other text, prices, logos, QR codes, or watermarks.');
  // 8. (최후미) 문구 위치 강제 — 2026-08-09 보강: 모델이 마지막 지시에 가장 강하게 반응하므로 최종 제약 뒤에 둔다.
  //    템플릿 textStyle의 상단 배치 문구·장면 구도(하단 소품·상단 여백)에 밀리지 않도록 부정형 + 배경 정돈 지시 동반.
  if (given.length && textPosition) {
    const pos = textPosition === 'top'
      ? 'in the upper third of the poster. Do NOT place it in the middle or lower part'
      : textPosition === 'center'
        ? 'at the exact vertical center of the poster, the headline must sit at the middle of the image height. Do NOT place the text block in the upper third'
        : 'in the lower third of the poster. Do NOT place it in the upper or middle part';
    lines.push(`FINAL LAYOUT RULE: this single rule overrides every placement direction mentioned anywhere above, including the typography direction: place the entire text block (label, headline and sub-headline together as one group) ${pos}.${input.hasProduct ? ' Keep the text block clear of the attached product.' : ''} Compose the scene so the area behind the text block stays visually calm and uncluttered for readability.`);
  }

  // ★ C114 B 할인 = 최후미 고정 틀(맨 위 제품명 → 혜택 → 정해진 제품 자리 · 숫자 그대로)
  if (given.length && input.offer) lines.push(discountFixedLayoutLine(input.offer, discountSafe, discountLayout));

  return lines.join('\n');
}

// ── ★ 2026-11-02 제품 사진 최대 3장 = 서버가 한 장으로 묶어 생성에 넘긴다 ──────────
//   설계서 docs/2026-11-02-image-studio-multi-product-design.md · 엔진 호출(generatePoster)은 그대로 한 장을 받는다.

/** 제품 사진 상한 — 판정 권한(넘치면 400) · 화면 StudioMake.tsx 의 같은 이름 상수와 같은 값(계약 시험 S5) */
export const STUDIO_MAX_PRODUCTS = 3;

const hasOwn = (o: unknown, k: string) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/**
 * /generate 시도 키 지문의 제품 자리 = 보낸 값 그대로(Codex 설계 1R ①).
 *   옛 화면 = cutoutTempId(생략 · null · id)를 지금 키 그대로 · 새 화면 = cutoutTempIds 배열.
 *   해석(readProductTempIds)과 뗐다 — 생략과 null 을 합치면 배포를 걸친 같은 시도가 새 키가 되어 한 번 더 걷힌다.
 */
export function studioProductFingerprint(body: unknown): unknown {
  if (hasOwn(body, 'cutoutTempIds')) return (body as any).cutoutTempIds;
  return (body as any)?.cutoutTempId;
}

/** /generate 제품 사진 목록 — 새 화면 = cutoutTempIds(0~3) · 옛 화면 = cutoutTempId 하나. 꼴이 어긋나면 null(400). */
export function readProductTempIds(body: unknown): string[] | null {
  let raw: unknown[] | null;
  if (hasOwn(body, 'cutoutTempIds')) {
    const v = (body as any).cutoutTempIds;
    raw = Array.isArray(v) ? v : null;
  } else {
    const one = (body as any)?.cutoutTempId;
    raw = one === undefined || one === null || one === '' ? [] : [one];
  }
  if (!raw || raw.length > STUDIO_MAX_PRODUCTS) return null;
  if (!raw.every((id) => typeof id === 'string' && isValidTempId(id))) return null;
  const ids = raw as string[];
  return new Set(ids).size === ids.length ? ids : null;
}

const GROUP_HEIGHT = 1200;
const GROUP_MAX_WIDTH = 3600;
const GROUP_GAP_RATIO = 0.08;
/** 입력 한 장 화소 상한 — 헤더로 디코드 전에 거른다(Codex 설계 1R ②) */
export const GROUP_MAX_INPUT_PIXELS = 25_000_000;   // ★ 2026-11-07 C112 로고 안전 변환도 같은 상한(studio-logo.ts)

/**
 * 제품 2~3장을 투명 PNG 한 장으로 — 넣은 순서대로 왼쪽부터 · 높이를 같게(1102 운영 실측 12장과 같은 꼴).
 * 배율을 먼저 정한다: 잘라낸 크기로 공통 높이를 구해 각 장 · 캔버스를 처음부터 폭 3600 안에서 만든다(한 장씩 차례로 · 동시 디코드 0).
 * ponytail: 실제 크기를 몰라 높이를 같게 맞춘다(작은 단지도 병만큼 커진다) · 크기 비율을 받게 되면 그때 넣는다.
 */
export async function groupProductCutouts(absPaths: string[]): Promise<{ base64: string; mime: 'image/png' }> {
  const parts: Array<{ buf: Buffer; w: number; h: number }> = [];
  for (const p of absPaths) {
    const m = await sharp(p).metadata();
    if (!m.width || !m.height) throw new StudioError('GEN_FAILED', 502);
    if (m.width * m.height > GROUP_MAX_INPUT_PIXELS) throw new StudioError('PRODUCT_TOO_LARGE', 400);
    const opts = { limitInputPixels: GROUP_MAX_INPUT_PIXELS };
    let t: { data: Buffer; info: OutputInfo };
    try { t = await sharp(p, opts).trim().png().toBuffer({ resolveWithObject: true }); }
    catch { t = await sharp(p, opts).png().toBuffer({ resolveWithObject: true }); }   // 한 색뿐이라 잘라낼 수 없으면 원본 그대로
    parts.push({ buf: t.data, w: t.info.width, h: t.info.height });
  }
  const n = parts.length;
  const ratioSum = parts.reduce((s, x) => s + x.w / x.h, 0) + GROUP_GAP_RATIO * (n - 1);
  // 장마다 폭을 반올림 · 최소 1 로 올려도 3600 을 넘지 않게 n 만큼 덜어 둔다
  const H = Math.max(1, Math.min(GROUP_HEIGHT, Math.floor((GROUP_MAX_WIDTH - n) / ratioSum)));
  const gap = Math.floor(GROUP_GAP_RATIO * H);
  const widths = parts.map((x) => Math.max(1, Math.round((x.w * H) / x.h)));
  // 높이 · 폭을 1 로 올린 극단 모양(20000×10 둘 · 3599×1 + 1×100 둘)은 3600 을 넘는다 = 만들기 전에 거절(Codex 설계 2R ①)
  if (widths.reduce((s, w) => s + w, 0) + gap * (n - 1) > GROUP_MAX_WIDTH) throw new StudioError('PRODUCT_TOO_LARGE', 400);
  const layers: OverlayOptions[] = [];
  let left = 0;
  for (const [i, x] of parts.entries()) {
    layers.push({ input: await sharp(x.buf).resize({ width: widths[i], height: H, fit: 'fill' }).png().toBuffer(), left, top: 0 });
    left += widths[i] + gap;
  }
  const out = await sharp({ create: { width: left - gap, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers).png().toBuffer();
  return { base64: out.toString('base64'), mime: 'image/png' };
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
  /** ★0930 실제로 만든 엔진(OpenAI 실패 → Gemini 대체면 'gemini') — 로그 · 비교 검증이 대체를 구분한다. */
  engine: StudioImageEngine;
}

async function callGemini(
  contents: any[],
  imageSize: '1K' | '2K',
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
  return { base64: imgPart.inlineData.data, mime: imgPart.inlineData.mimeType || 'image/jpeg', parts, imageTokens, ms, engine: 'gemini' };
}

// ── ★ 2026-09-30 생성 엔진 스위치 (3방식 블라인드 · 원장 docs/2026-09-30-ai-model-prompt-upgrade.md §2-4) ──
//   STUDIO_IMAGE_ENGINE=openai 이면 스튜디오 화면의 생성(/generate)·수정 지시(/edit)를 OpenAI 이미지 모델로 만든다.
//   기본 = gemini(배포만으로 동작 무변경). 엔진은 호출부가 넘긴다 — 넘기지 않으면 Gemini:
//     · 4K 격상 = 0930 제거(생성 모델이 새 그림을 그렸다)
//     · 아웃리치(배경만 생성 + 서버 글자) · 템플릿 예시 배치 = Gemini 그대로(별도 파이프라인 · 이번 비교 대상 아님)
//   OpenAI 가 30초 안에 일시 장애(429 · 5xx · 연결 실패 · 키/권한)면 같은 요청을 Gemini 로 한 번 더 만든다(차감은 성공 1회 뒤 1번 그대로).
//   안전 거부 · 그 밖의 400 · 시간 초과 · 늦은 실패는 대체하지 않는다(안전 우회 금지 · 대기 시간 두 배 금지).
export type StudioImageEngine = 'gemini' | 'openai';
export const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst';
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images';

let openaiKeyMissingWarned = false;
/** 스튜디오 화면이 쓸 생성 엔진 — 호출 시점의 ENV 를 읽는다(pm2 --update-env 재시작으로 켜고 끈다). */
export function studioImageEngine(): StudioImageEngine {
  if (String(process.env.STUDIO_IMAGE_ENGINE || '').trim().toLowerCase() !== 'openai') return 'gemini';
  if (!process.env.OPENAI_API_KEY) {
    if (!openaiKeyMissingWarned) {
      openaiKeyMissingWarned = true;
      console.log('[image-studio] STUDIO_IMAGE_ENGINE=openai 이나 OPENAI_API_KEY 미설정 → gemini 로 생성');
    }
    return 'gemini';
  }
  return 'openai';
}

/** 프리셋 크기 등급별 화소 예산 — 2K = 블라인드 비교에 쓴 1536×2048(3:4), 1K = 1008×1344(3:4). */
const OPENAI_PIXEL_BUDGET: Record<'1K' | '2K', number> = { '1K': 1008 * 1344, '2K': 1536 * 2048 };
/**
 * 프리셋 비율 → OpenAI 크기 문자열. 규격 = 가로·세로 16의 배수 · 비율 1:3~3:1 · 한 변 3840 이하 ·
 * 총 화소 655,360~8,294,400(2560×1440 초과는 실험 단계라 예산을 그 아래로 둔다).
 */
export function openaiImageSize(aspectRatio: string, imageSize: '1K' | '2K'): string {
  const [a, b] = String(aspectRatio || '').split(':').map(Number);
  const ratio = a > 0 && b > 0 ? Math.min(3, Math.max(1 / 3, a / b)) : 3 / 4;
  const budget = OPENAI_PIXEL_BUDGET[imageSize] || OPENAI_PIXEL_BUDGET['2K'];
  const to16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  const w = to16(Math.sqrt(budget * ratio));
  const h = to16(w / ratio);
  return `${w}x${h}`;
}

/**
 * 사진 없이 OpenAI 로 만들 때만 붙인다 — 상품 · 기기 · 포장 · 입은 옷 = 장면 지시나 제목이 이름을 대면 허용,
 * 사람 · 모델 · 마네킹 · 손 = 장면 지시가 명시할 때만(0930 확인: 사람을 상품과 한 줄로 묶었더니 "잡지 화보"를 사람 요구로 읽어 2/2 모델을 넣었다).
 */
export const OPENAI_NO_INVENTED_SUBJECT =
  'No product photo is attached: do not invent any specific product, device, packaged item or worn garment unless the scene description above or the headline names it. Do not show any person, model, mannequin or hands unless the scene description above explicitly asks for one. If the scene refers to a product area, leave it as an empty, softly lit display surface.';

/** OpenAI 실패 중 Gemini 로 대체해도 되는 것(일시 장애 · 설정 문제). 안전 거부 · 시간 초과는 StudioError 로 바로 던진다. */
class OpenAIFallback extends Error {
  constructor(message: string, readonly ms = 0) { super(message); }
}
/** 이보다 늦게 실패하면 대체하지 않는다 — 늦은 5xx 뒤 Gemini 를 또 기다리면 대기가 두 배가 된다. */
const OPENAI_FALLBACK_MAX_MS = 30_000;

async function callOpenAIImage(input: {
  prompt: string;
  size: string;
  images: Array<{ base64: string; mime: string }>;
  timeoutMs: number;
}): Promise<GeneratedImage> {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key) throw new OpenAIFallback('키 미설정');
  const isEdit = input.images.length > 0;
  let body: string | FormData;
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (isEdit) {
    // 사진이 있으면 수정 끝점(multipart · image[] 반복) — 공식 예시와 같은 형식
    const form = new FormData();
    form.append('model', OPENAI_IMAGE_MODEL);
    form.append('prompt', input.prompt);
    form.append('size', input.size);
    form.append('quality', 'high');
    form.append('output_format', 'jpeg');
    input.images.forEach((img, i) => {
      const ext = img.mime.includes('png') ? 'png' : img.mime.includes('webp') ? 'webp' : 'jpg';
      form.append('image[]', new Blob([Buffer.from(img.base64, 'base64')], { type: img.mime }), `input-${i}.${ext}`);
    });
    body = form;
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ model: OPENAI_IMAGE_MODEL, prompt: input.prompt, size: input.size, quality: 'high', output_format: 'jpeg', n: 1 });
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), input.timeoutMs);
  const t0 = Date.now();
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${OPENAI_IMAGE_URL}/${isEdit ? 'edits' : 'generations'}`, { method: 'POST', headers, body, signal: ac.signal });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      console.log(`[image-studio] OpenAI 이미지 시간 초과 ${input.timeoutMs}ms`);
      throw new StudioError('GEN_FAILED', 502, true);
    }
    throw new OpenAIFallback(`연결 실패 ${err?.message || err}`, Date.now() - t0);
  }
  const json: any = await res.json().catch(() => ({}));
  clearTimeout(timer);
  const ms = Date.now() - t0;
  if (ac.signal.aborted) {
    // 본문을 받는 중 시간 초과 — 대체하지 않는다(대기 두 배 금지)
    console.log(`[image-studio] OpenAI 이미지 시간 초과(본문 수신 중) ${input.timeoutMs}ms`);
    throw new StudioError('GEN_FAILED', 502, true);
  }

  if (!res.ok) {
    // 원문은 로그만 — 응답엔 코드 매핑 메시지만(§5-1-11 모델명 노출 차단)
    console.log(`[image-studio] OpenAI HTTP ${res.status} ${ms}ms: ${JSON.stringify(json).slice(0, 500)}`);
    const code = String(json?.error?.code || '');
    if (code === 'moderation_blocked' || code === 'content_policy_violation') throw new StudioError('SAFETY_BLOCKED', 400, true);
    // 400 = 요청 자체의 문제(본문을 못 읽은 안전 거부 포함) — 다른 모델로 돌리지 않는다(fail-closed · 미차감)
    if (res.status === 400) throw new StudioError('GEN_FAILED', 502, true);
    throw new OpenAIFallback(`HTTP ${res.status} ${code}`, ms);
  }
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new OpenAIFallback('이미지 없음', ms);
  const usage = json?.usage || {};
  const imageTokens = Number(usage?.output_tokens_details?.image_tokens ?? usage?.output_tokens ?? 0) || 0;
  return { base64: b64, mime: 'image/jpeg', parts: [], imageTokens, ms, engine: 'openai' };
}

/** 엔진 분기 — openai 가 대체 가능한 실패면 Gemini 로 한 번 더(로그 남김). 안전 거부 · 시간 초과는 그대로 던진다. */
async function runOnEngine(
  engine: StudioImageEngine,
  what: string,
  openai: () => Promise<GeneratedImage>,
  gemini: () => Promise<GeneratedImage>,
): Promise<GeneratedImage> {
  if (engine !== 'openai') return gemini();
  try {
    const img = await openai();
    console.log(`[image-studio] ${what} engine=openai model=${OPENAI_IMAGE_MODEL} ${img.ms}ms imageTokens=${img.imageTokens}`);
    return img;
  } catch (err: any) {
    if (!(err instanceof OpenAIFallback)) throw err;
    if (err.ms > OPENAI_FALLBACK_MAX_MS) {
      console.log(`[image-studio] ${what} engine=openai 늦은 실패(${err.message} · ${err.ms}ms) → 대체 안 함`);
      throw new StudioError('GEN_FAILED', 502, true);
    }
    console.log(`[image-studio] ${what} engine=openai 실패(${err.message} · ${err.ms}ms) → gemini 로 대체`);
    return gemini();
  }
}

/**
 * 완성 포스터 1장 생성(단일턴) — 누끼 제품 이미지를 입력으로 첨부하면
 * 생성 모델이 [제품 배치 + 배경 + 지정 문구 타이포]까지 한 장으로 렌더한다(실증 §0-2·Harold 실측).
 * cutout 미첨부 = 문구 포함 배경 포스터. engine 미지정 = Gemini(★0930 스위치는 스튜디오 라우트만 넘긴다).
 */
export async function generatePoster(
  prompt: string,
  preset: ChannelPreset,
  cutout?: { base64: string; mime: string } | null,
  opts?: { engine?: StudioImageEngine },
): Promise<GeneratedImage> {
  return runOnEngine(
    opts?.engine || 'gemini',
    cutout ? 'poster+product' : 'poster',
    () => callOpenAIImage({
      // ★ 2차 블라인드 — OpenAI 는 사진 없이 "상품 자리"를 지어낸 상품으로 채우고 소품 자리에 인물을 넣었다(2/6) · Gemini 에는 붙이지 않는다(동작 무변경)
      prompt: cutout ? prompt : `${prompt}\n${OPENAI_NO_INVENTED_SUBJECT}`,
      size: openaiImageSize(preset.aspectRatio, preset.imageSize),
      images: cutout ? [cutout] : [],
      timeoutMs: 120_000,
    }),
    () => {
      const parts: GeminiPart[] = [{ text: prompt }];
      if (cutout) parts.push({ inlineData: { mimeType: cutout.mime, data: cutout.base64 } });
      return callGemini(
        [{ role: 'user', parts }],
        preset.imageSize,
        preset.aspectRatio,
        120_000,
      );
    },
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
 * 멀티턴 보존 편집 (§4-3). basePrompt(원 생성 프롬프트) + base 이미지(sig 제거) + instruction.
 *  - 배경/무드 편집: instruction = 유저 요청(배경·전체 무드 한정), imageSize '2K'.
 *  ★ 2026-09-30 4K 격상 제거(Harold 확정) — "같은 그림 4K" 요청에 생성 모델이 구도·색을 새로 그렸다(운영 실측 3584×4800).
 *    크기 키우기는 생성 모델 금지 원칙(LESSONS_BACKEND 0721)과 같은 뿌리. 원장 docs/2026-09-30-ai-model-prompt-upgrade.md §2-4
 */
export async function editOrUpscale(opts: {
  baseImageBase64: string;
  baseMime: string;
  basePrompt: string;
  instruction: string;
  imageSize: '2K';
  aspectRatio: string;
  /** ★0930 생성 엔진 스위치(미지정 = Gemini). */
  engine?: StudioImageEngine;
}): Promise<GeneratedImage> {
  const gemini = () => {
    const modelTurnParts: GeminiPart[] = stripSignature([
      { inlineData: { mimeType: opts.baseMime, data: opts.baseImageBase64 } },
    ]);
    const contents = [
      { role: 'user', parts: [{ text: opts.basePrompt }] },
      { role: 'model', parts: modelTurnParts },
      { role: 'user', parts: [{ text: opts.instruction }] },
    ];
    return callGemini(contents, opts.imageSize, opts.aspectRatio, 120_000);
  };
  // OpenAI 수정 끝점은 대화 맥락이 없다 — 원 생성 프롬프트 대신 "나머지는 그대로(글자 포함)"를 지시에 붙인다
  return runOnEngine(
    opts.engine || 'gemini',
    'edit',
    () => callOpenAIImage({
      prompt: `${opts.instruction}\n${OPENAI_EDIT_KEEP_REST}`,
      size: openaiImageSize(opts.aspectRatio, '2K'),
      images: [{ base64: opts.baseImageBase64, mime: opts.baseMime }],
      timeoutMs: 120_000,
    }),
    gemini,
  );
}

export const OPENAI_EDIT_KEEP_REST =
  'Keep everything else in the attached image unchanged, including every existing text element exactly as written and where it sits, and any product exactly as shown.';

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
  kind: 'source' | 'background' | 'poster' | 'cutout' | 'composite' | 'logo';   // ★ C113 D9 logo = 홈페이지에서 찾은 로고 후보(「이 로고로 저장」만 소비)
  ext: string;
  mime: string;
  prompt?: string | null;
  presetKey?: string | null;
  channelSpec?: string | null;
  width?: number | null;
  height?: number | null;
  aspectRatio?: string | null;
  /** ★ 2026-10-19 Codex E3 — 영구 위치로 옮겼는데 라이브러리 등재 여부를 확인하지 못한 그림(다음 저장이 확인 · 등재로 마무리한다) */
  pendingAsset?: { url: string; filename: string; bytes: number; displayName: string; channelSpec: string | null } | null;
  /** ★ 2026-10-19 Codex E8 범위 밖 — MMS 변환 저장으로 원본 임시 그림을 소비한 뒤의 저장 주소(같은 원본 id 재저장이 그 소재를 찾게) */
  savedAs?: { url: string; bytes: number } | null;
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
/** ★ 2026-09-27 한줄로 V2 R125 — 임시 보관 상한 초과인가(모든 임시 쓰기 라우트가 같은 판정 · 옛: /generate만 봤다) */
export function isStudioTempFull(companyId: string): boolean {
  return companyTempUsageBytes(companyId) >= STUDIO_TEMP_CAP_BYTES;
}

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

/** ★ 2026-10-19 Codex E3 — 사이드카만 지운다(마무리 대기를 끝낸 뒤) */
export function clearTempMeta(companyId: string, tempId: string): void {
  if (!isValidTempId(tempId)) return;
  try { fs.unlinkSync(path.join(companyTempDir(companyId), `${tempId}.json`)); } catch { /* noop */ }
}

/** 임시 그림 · 사이드카를 함께 지운다(돈을 걷지 못해 건네지 않는 결과 · ★ 2026-10-25 성공 뒤 차감 한 규칙) */
/** ★ 1026 Codex 2R — 못 지우면 던진다(거두기 실패 = 경보 · settleOrUndo) · 없는 파일은 이미 거둔 것 */
export function discardTemp(companyId: string, tempId: string): void {
  const f = findTempFile(companyId, tempId);
  if (f) { try { fs.unlinkSync(f.absPath); } catch (e: any) { if (e?.code !== 'ENOENT') throw e; } }
  clearTempMeta(companyId, tempId);
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

/**
 * ★ 2026-09-15 우리 서빙 URL(`…/api/cdp/inapp/image/{companyId}/{filename}` · 절대·상대 모두) → 실물 경로. 형식이 아니면 null(호출부는 HTTP 폴백).
 *   routes/cdp.ts 서빙 경로와 같은 결합(INAPP_IMAGE_BASE/companyId/filename) · 경로 조작 문자는 정규식이 막는다.
 */
export function inappImageLocalPath(url: string): string | null {
  const m = String(url || '').match(/\/api\/cdp\/inapp\/image\/([0-9a-f-]{36})\/([A-Za-z0-9._-]+)(?:[?#].*)?$/i);
  if (!m) return null;
  return path.join(INAPP_IMAGE_BASE, m[1], m[2]);
}

/** temp → 영구(INAPP_IMAGE_BASE) 이동 + tempId 1회성 소비(사이드카·원본 삭제). URL·bytes 반환. */
export function moveTempToPermanent(companyId: string, tempId: string): { url: string; filename: string; bytes: number; ext: string } | null {
  const found = findTempFile(companyId, tempId);
  if (!found) return null;
  const destDir = path.join(INAPP_IMAGE_BASE, companyId);
  fs.mkdirSync(destDir, { recursive: true });
  // ★ C118 A3 인앱용 = `.full.` 이름(이름 CT 하나 · 그림을 바꾸면 주소가 바뀌어 표지도 저절로 빠진다)
  const filename = studioPermanentName(tempId, found.ext, isStudioFullPreset(readTempMeta(companyId, tempId)?.presetKey));
  const destPath = path.join(destDir, filename);
  // ★ 2026-11-07 C113 K21 — 크기를 옮기기 전에 읽는다(옛: 옮긴 뒤 읽다 실패하면 옮긴 파일이 기록 없이 남았다 · 되돌릴 수 없는 단계 = 마지막)
  const bytes = fs.statSync(found.absPath).size;
  fs.renameSync(found.absPath, destPath);
  // 사이드카 삭제 = 1회성 소비(재-save 시 findTempFile null → 409/404).
  try { fs.unlinkSync(path.join(companyTempDir(companyId), `${tempId}.json`)); } catch { /* noop */ }
  return { url: `/api/cdp/inapp/image/${companyId}/${filename}`, filename, bytes, ext: found.ext };
}

/**
 * ★ 2026-11-07 C112 영구 자리에 바로 쓴다 — 이름 = 저장한 임시 id(moveTempToPermanent · findPermanentByTempId 와 같은 이름 · 주소 규칙) ·
 *   그 폴더 안 임시 이름에 쓰고 이름 바꾸기(반쪽 파일이 서빙되지 않게). 같은 이름이 있으면 덮어쓴다(로고 저장의 0행 확정 뒤 다시 쓰기).
 */
export function writeStudioPermanent(companyId: string, tempId: string, ext: string, buffer: Buffer, opts: { full?: boolean } = {}): { url: string; filename: string; bytes: number; ext: string } {
  if (!isValidTempId(tempId) || !/^[a-z]{3,4}$/.test(ext)) throw new Error('invalid permanent name');
  const destDir = path.join(INAPP_IMAGE_BASE, companyId);
  fs.mkdirSync(destDir, { recursive: true });
  const filename = studioPermanentName(tempId, ext, !!opts.full);
  const tmp = path.join(destDir, `.tmp-${crypto.randomUUID()}`);
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, path.join(destDir, filename));
  return { url: `/api/cdp/inapp/image/${companyId}/${filename}`, filename, bytes: buffer.length, ext };
}

/**
 * ★ 2026-10-19 Codex E7 — 그 임시 id 로 영구 위치에 옮긴 파일(moveTempToPermanent 와 같은 이름 · 주소 규칙). 없으면 null.
 *   임시 파일이 없어진 뒤의 재저장이 「이미 저장됨」을 목록(최신 200건)이 아니라 이 주소의 소재 단건으로 판정하게 한다.
 */
export function findPermanentByTempId(companyId: string, tempId: string): { url: string; bytes: number } | null {
  if (!isValidTempId(tempId)) return null;
  // ★ C118 A3 두 이름 다 찾는다(인앱용 = `.full.` · 저장 응답 유실 뒤 다시 저장이 409 가 되지 않게 · Codex 설계 3R ①)
  for (const full of [false, true]) {
    for (const ext of ['png', 'jpeg', 'jpg', 'webp']) {
      const name = studioPermanentName(tempId, ext, full);
      const p = path.join(INAPP_IMAGE_BASE, companyId, name);
      try {
        const st = fs.statSync(p);
        if (st.isFile()) return { url: `/api/cdp/inapp/image/${companyId}/${name}`, bytes: st.size };
      } catch { /* 없음 */ }
    }
  }
  return null;
}

/**
 * ★ 2026-10-19 B-1016-3③ — 영구 위치로 옮긴 뒤 라이브러리 등재가 실패하면 되돌린다(같은 임시 id 로 다시 저장할 수 있게).
 *   파일을 임시 자리로 되돌리고 사이드카를 다시 쓴다. 되돌리기 실패 = 조용히 넘어간다(원래 오류를 그대로 돌려준다).
 */
export function restorePermanentToTemp(companyId: string, tempId: string, ext: string, meta: Omit<TempMeta, 'companyId' | 'createdAt'>, movedFilename?: string): void {
  try {
    // ★ C118 A3 실제로 옮긴 이름으로 되돌린다(인앱용 = `.full.` · Codex 설계 3R ①)
    const destPath = path.join(INAPP_IMAGE_BASE, companyId, movedFilename || `${tempId}.${ext}`);
    const dir = companyTempDir(companyId);
    fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(destPath, path.join(dir, `${tempId}.${ext}`));
    writeTempMeta(companyId, tempId, meta);
  } catch { /* 원래 오류를 돌려준다 */ }
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
//   ★ 2026-09-30 4K 격상 제거 — 'image-studio-4k' 는 새 차감이 없다(단가표 · 화면 이름표에는 지난 이력 표시용으로 남긴다).
export const CREDIT_SOURCE = {
  generate: 'image-studio-generate',
  edit: 'image-studio-edit',
} as const;

