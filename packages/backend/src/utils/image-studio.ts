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

// ── ★ 2026-07-31 템플릿 예시 실샘플 (Harold — "이 템플릿은 이런 이미지로 나온다") ──────
//   배치 생성 산출물(영구·temp 스윕 제외). 카드 exampleUrl 폴백 소스 — 파일이 있으면 카드가 실샘플을 표시.
//   경로 인자는 카탈로그 id로만 조립(라우트에서 getTemplate 검증 후 호출 — 경로 조작 차단).
const STUDIO_SAMPLE_BASE = process.env.STUDIO_SAMPLE_PATH || path.resolve('./uploads/studio-samples');
const SAMPLE_EXTS = ['jpg', 'jpeg', 'png', 'webp'] as const;

export function findTemplateSample(templateId: string): { absPath: string; mime: string } | null {
  try {
    for (const ext of SAMPLE_EXTS) {
      const p = path.join(STUDIO_SAMPLE_BASE, `${templateId}.${ext}`);
      if (fs.existsSync(p)) {
        return { absPath: p, mime: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
      }
    }
  } catch { /* noop */ }
  return null;
}

export function writeTemplateSample(templateId: string, buffer: Buffer, mime: string): void {
  fs.mkdirSync(STUDIO_SAMPLE_BASE, { recursive: true });
  const ext = ((mime.split('/')[1] || 'jpeg').toLowerCase()).replace('jpeg', 'jpg');
  const safeExt = (SAMPLE_EXTS as readonly string[]).includes(ext) ? ext : 'jpg';
  fs.writeFileSync(path.join(STUDIO_SAMPLE_BASE, `${templateId}.${safeExt}`), buffer);
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
  | 'TEMP_FULL';

const STUDIO_ERROR_MESSAGES: Record<StudioErrorCode, string> = {
  STUDIO_NOT_READY: '이미지 스튜디오가 준비 중입니다. 잠시 후 다시 시도해주세요.',
  SAFETY_BLOCKED: '안전 기준으로 생성이 거부됐어요. 문구나 상품을 바꿔 다시 시도해주세요.',
  RATE_LIMITED: '지금 요청이 몰려 잠시 대기가 필요합니다. 잠시 후 다시 시도해주세요.',
  GEN_FAILED: '이미지 생성에 실패했어요. 잠시 후 다시 시도해주세요.',
  PY_SERVICE_DOWN: '이미지 준비 기능을 점검 중입니다. 잠시 후 다시 시도해주세요.',
  INGEST_FAILED: '상품 이미지를 가져오지 못했어요. 다른 이미지를 사용해주세요.',
  BUSY: '다른 이미지 생성이 진행 중입니다. 완료 후 다시 시도해주세요.',
  TEMP_FULL: '임시 보관 용량이 가득 찼습니다. 저장하거나 정리 후 다시 시도해주세요.',
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
  'poster':       { key: 'poster',       label: '포스터',        aspectRatio: '3:4', imageSize: '2K', track: 'quality', channelSpec: 'poster',       textZone: 'top' },
  // 아래 4종 = 레거시 호환(옛 temp meta·기존 자산 channel_spec 해석용). 신규 생성 UI는 'poster'만 보낸다.
  'inapp-poster': { key: 'inapp-poster', label: '인앱 포스터형', aspectRatio: '3:4', imageSize: '2K', track: 'quality', channelSpec: 'inapp-poster', textZone: 'top' },
  'dm-card':      { key: 'dm-card',      label: 'DM 카드',      aspectRatio: '1:1', imageSize: '2K', track: 'quality', channelSpec: 'dm',           textZone: 'bottom' },
  'email-hero':   { key: 'email-hero',   label: '이메일 히어로', aspectRatio: '16:9', imageSize: '2K', track: 'quality', channelSpec: 'email',       textZone: 'bottom' },
  'free':         { key: 'free',         label: '자유',          aspectRatio: '3:4', imageSize: '2K', track: 'quality', channelSpec: 'free',         textZone: 'top' },
  // MMS 전용 — 생성은 1K(896×1200), 서버가 1080px 리사이즈 + JPEG ≤300KB 보장(§4-4 트랙 B).
  'mms':          { key: 'mms',          label: 'MMS',          aspectRatio: '3:4', imageSize: '1K', track: 'mms',     channelSpec: 'mms',          textZone: 'top' },
};

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
}): string {
  const { template, preset, texts } = input;
  const lines: string[] = [];

  // 1. 장면 스캐폴드(은닉 — 템플릿이 품은 정교한 지시)
  lines.push(template.scaffold);
  // 1-1. ★ 2026-08-09(2) 문구 위치 지정 시 — 장면 단계에서 그 자리를 비워 구도가 텍스트와 싸우지 않게 한다.
  //      (실측: 최후미 규칙만으로는 textStyle 상단 문구 + 장면 구도에 밀려 미준수 — 모순 제거가 뿌리 수정)
  if (input.textPosition) {
    const zone = input.textPosition === 'top' ? 'upper third' : input.textPosition === 'center' ? 'vertical center' : 'lower third';
    lines.push(`Scene composition requirement: reserve a calm, visually quiet zone at the ${zone} of the frame for the marketing copy, keep props, busy textures and strong highlights away from that zone.`);
  }
  // 2. 포스터 형식·비율
  lines.push(`This is a complete marketing poster design, aspect ratio ${preset.aspectRatio}.`);
  // 3. 제품 보존(누끼 첨부 시) — 픽셀 충실 지시
  if (input.hasProduct) {
    lines.push('A product photo with transparent background is attached. Place it as the hero of the composition on a natural surface. Preserve the attached product EXACTLY as provided, do not redraw, restyle, recolor, or alter its shape, proportions, packaging, or label text in any way. Integrate it with scene-consistent lighting and a realistic soft ground shadow.');
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
    if (input.textPosition) {
      lines.push(`Typography direction (font mood and styling reference ONLY, any position wording inside it is void; the text position is defined solely by the FINAL LAYOUT RULE at the end): ${template.textStyle}`);
    } else {
      lines.push(`Typography direction: ${template.textStyle}`);
    }
  } else {
    lines.push('This poster has no text, pure visual composition with space that could hold a headline.');
  }
  // 7. (마지막) 제한 — 지정 문구 외 일체 금지.
  lines.push('Use ONLY the text given above, exactly as written, do not add, translate, paraphrase, or modify any wording or numbers. Do not render any other text, prices, logos, QR codes, or watermarks.');
  // 8. (최후미) 문구 위치 강제 — 2026-08-09 보강: 모델이 마지막 지시에 가장 강하게 반응하므로 최종 제약 뒤에 둔다.
  //    템플릿 textStyle의 상단 배치 문구·장면 구도(하단 소품·상단 여백)에 밀리지 않도록 부정형 + 배경 정돈 지시 동반.
  if (given.length && input.textPosition) {
    const pos = input.textPosition === 'top'
      ? 'in the upper third of the poster. Do NOT place it in the middle or lower part'
      : input.textPosition === 'center'
        ? 'at the exact vertical center of the poster, the headline must sit at the middle of the image height. Do NOT place the text block in the upper third'
        : 'in the lower third of the poster. Do NOT place it in the upper or middle part';
    lines.push(`FINAL LAYOUT RULE: this single rule overrides every placement direction mentioned anywhere above, including the typography direction: place the entire text block (label, headline and sub-headline together as one group) ${pos}.${input.hasProduct ? ' Keep the text block clear of the attached product.' : ''} Compose the scene so the area behind the text block stays visually calm and uncluttered for readability.`);
  }

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
  /** ★0930 실제로 만든 엔진(OpenAI 실패 → Gemini 대체면 'gemini') — 로그 · 비교 검증이 대체를 구분한다. */
  engine: StudioImageEngine;
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
  return { base64: imgPart.inlineData.data, mime: imgPart.inlineData.mimeType || 'image/jpeg', parts, imageTokens, ms, engine: 'gemini' };
}

// ── ★ 2026-09-30 생성 엔진 스위치 (3방식 블라인드 · 원장 docs/2026-09-30-ai-model-prompt-upgrade.md §2-4) ──
//   STUDIO_IMAGE_ENGINE=openai 이면 스튜디오 화면의 생성(/generate)·수정 지시(/edit 2K)를 OpenAI 이미지 모델로 만든다.
//   기본 = gemini(배포만으로 동작 무변경). 엔진은 호출부가 넘긴다 — 넘기지 않으면 Gemini:
//     · 4K 격상 = 늘 Gemini(OpenAI 최대 8,294,400 화소 → 3:4 4K 불가)
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
    () => callOpenAIImage({ prompt, size: openaiImageSize(preset.aspectRatio, preset.imageSize), images: cutout ? [cutout] : [], timeoutMs: 120_000 }),
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
  /** ★0930 스위치 — 2K 수정 지시에만 적용. 4K 는 늘 Gemini(OpenAI 화소 상한). */
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
  if (opts.imageSize === '4K') return gemini();
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
  kind: 'source' | 'background' | 'poster' | 'cutout' | 'composite';
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

