/**
 * sns-caption-ai.ts — AI 캡션 쓰기 (2026-09-21 S2 · ★ 2026-09-24 B-6 전면 개편)
 * 설계 SoT = docs/2026-09-24-sns-channel-design.md §4 B-6 · 이전 = 0917 §3-8 · 불변 §2-10·§2-11.
 *
 * 모드는 **서버가 정한다**(화면 미러 = frontend/src/utils/sns-view.ts snsCaptionMode).
 *   - 글이 있다 → refine(다듬기)
 *   - 글이 없고 사진이 있다 → photo_draft(사진 보고 첫 글 · Harold 0924 Q2 가)
 *   - 영상만 있거나 아무것도 없다 → locked(사유 한 줄)
 * 동작은 셋 = write(처음) · again(다시 쓰기) · fit(채널 길이에 맞게 줄이기).
 *
 * ⛔ **AI 는 태그 생성기가 아니라 선택기다**(§2-10). 회사 '자주 쓰는 태그'에서만 고르고 서버가 `tags ⊆ 세트`를 강제한다.
 * ⛔ **사용자가 쓴 글이 유일한 면허다**(§2-11). 없는 혜택·가격·기간·수치·링크를 만들지 않는다.
 *   ① 링크·맨 도메인·금액·혜택 덩어리·문장 속 #태그를 `{{k#}}` 로 가려 넘기고 되돌린다 — 하나라도 잃으면 **결과를 버린다**
 *   ② 결과의 링크 호스트 ⊆ 원문 링크 호스트 — 아니면 버린다
 *   ③ 원문에 없던 #태그는 지운다(원문에 그 낱말이 있으면 # 만 뗀다)
 *   ④ 출구에서 `stripUnauthorizedBenefits(결과, 원문)`
 *   ⑤ 글 끝 태그 줄은 떼어 두었다가 그대로 다시 붙인다(모델이 만지지 않는다)
 * ⛔ 버렸으면 **버렸다고 말한다**(0924 K9 · 전에는 원문을 성공처럼 돌려줬다).
 * ★ 2026-09-25 사진 초안 = **두 단계**(Harold 0925 A안 · 포스터 문구가 한 글자도 안 들어가던 결함)
 *   ① 사진 속 글자를 그대로 옮겨 적는다(창작 금지 · 무작위성 0) → ② 그 글을 메시지로 삼아 SNS 글을 쓴다.
 *   쓸 수 있는 사실의 범위(면허) = ①의 글 + 회사 이름. **글을 쓰기 전에 정해 둔다** — 쓰는 단계가 면허를 넓힐 수 없다.
 *   ①의 글은 화면에 '사진에서 읽은 글'로 보여 준다(잘못 읽었으면 사람이 바로 본다).
 * ⛔ again 의 면허는 `body`(= AI 쓰기 직전 사용자 글)다. `previous` 는 "피할 안"으로만 넘기고 면허가 아니다.
 */

import sharp from 'sharp';
import { callAIWithFallback } from '../services/ai';
import { query } from '../config/database';
import { extractJsonFromAiText } from './ai-json';
import { findBenefitSpans, stripUnauthorizedBenefits } from './copy-benefit-detector';
import {
  buildSnsCaption, countSnsCaption, findBodyHashtagSpans, findSnsLinkSpans, normalizeSnsTags, snsLinkHost,
  extractBodyHashtags, type SnsCaptionSpec, type SnsTextSpan,
} from './sns-caption-rules';
import { snsMediaAbsPath } from './sns-media';

export type SnsCaptionAction = 'write' | 'again' | 'fit';
export type SnsCaptionMode = 'refine' | 'photo_draft' | 'locked';

/** 사진 초안에 쓰는 사진 수(영상 제외 · 앞에서부터) */
export const SNS_CAPTION_PHOTO_LIMIT = 3;
/** 사진 초안이 이보다 짧으면 결과 없이 한 줄 안내 */
const PHOTO_DRAFT_MIN_CHARS = 8;
const PHOTO_DRAFT_TOO_SHORT = '한 줄만 써 주시면 다듬어 드릴게요.';

/**
 * 사진 초안에서 **문장째 빼는** 낱말 — 사진만으로 알 수 없는 사실·행사·조건이다.
 * ⛔ 넓히지 않는다(좁을수록 초안이 산다). 숫자·링크·혜택 덩어리는 따로 본다.
 */
const PHOTO_DRAFT_FACT_WORDS = [
  '행사', '이벤트', '세일', '특가', '오픈', '개업', '마감', '한정', '선착순', '오늘만', '기간',
  '신상', '입고', '출시', '예약', '주문', '배송', '가격', '영업', '휴무', '위치', '전화', '문의',
  '당첨', '추첨', '프로모션', '혜택', '무료', '증정', '할인', '쿠폰', '적립',
];

/**
 * ★ 2026-09-25 알림 낱말의 영문 표기 — 포스터가 'NOW OPEN' 이면 글의 '오픈'은 사진 속 글에 있는 사실이다.
 * ⛔ 알림 낱말만 둔다. 조건·기한·혜택 낱말(할인·한정·오늘만 등)은 사진 속 글에 **그 낱말 그대로** 있어야 한다.
 */
const PHOTO_FACT_WORD_EQUIV: Record<string, RegExp> = {
  '오픈': /\bopen(ing)?\b/i,
  '개업': /\bopen(ing)?\b/i,
  '출시': /\b(launch|release|new)\b/i,
  '신상': /\bnew\b/i,
  '입고': /\b(new|arrival)\b/i,
  '행사': /\b(event|sale)\b/i,
  '이벤트': /\bevent\b/i,
  '세일': /\bsale\b/i,
};

/** 사진 속 글을 옮길 때 줄 수 · 줄 길이 상한 */
const IMAGE_TEXT_MAX_LINES = 12;
const IMAGE_TEXT_MAX_CHARS = 120;
/** 같은 사진을 다시 쓰기 할 때 다시 읽지 않는다(프로세스 1개 전제 · 30분) */
const IMAGE_TEXT_TTL_MS = 30 * 60 * 1000;
const imageTextCache = new Map<string, { lines: string[]; at: number }>();

// ───────────────────────────── 모드 ─────────────────────────────

/** 글 끝의 태그만 있는 줄을 떼어 낸다. head = 다듬을 글 · tail = 그대로 다시 붙일 꼬리(앞 줄바꿈 포함). */
export function splitTrailingTagLines(body: string): { head: string; tail: string } {
  const src = String(body ?? '');
  const lines = src.split('\n');
  let cut = lines.length;
  while (cut > 0) {
    const line = lines[cut - 1];
    if (!line.trim()) { cut -= 1; continue; }
    const rest = line.replace(/(^|\s)#[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_]+/g, ' ').trim();
    if (rest === '' && /#/.test(line)) { cut -= 1; continue; }
    break;
  }
  // 태그 줄이 하나도 없으면 원문 그대로(끝 빈 줄도 건드리지 않는다)
  const tailLines = lines.slice(cut);
  if (!tailLines.some((l) => /#/.test(l))) return { head: src, tail: '' };
  const head = lines.slice(0, cut).join('\n');
  return { head, tail: src.slice(head.length) };
}

/** 모드 판정(순수 · 화면 미러). */
export function snsCaptionMode(input: { body: string; imageCount: number; videoCount: number }): { mode: SnsCaptionMode; reason: string | null } {
  const { head } = splitTrailingTagLines(input.body);
  if (head.trim()) return { mode: 'refine', reason: null };
  if (input.imageCount > 0) return { mode: 'photo_draft', reason: null };
  if (input.videoCount > 0) return { mode: 'locked', reason: '영상만 있으면 AI가 첫 글을 쓸 수 없어요. 한 줄만 써 주시면 다듬어 드릴게요.' };
  return { mode: 'locked', reason: '글을 한 줄 쓰거나 사진을 올리면 AI가 도와드려요.' };
}

// ───────────────────────────── 가림 ─────────────────────────────

interface TokenTable {
  keyOf: Map<string, string>;
  valueOf: Map<string, string>;
  next: number;
}

function newTable(): TokenTable {
  return { keyOf: new Map(), valueOf: new Map(), next: 0 };
}

/** 가릴 자리 = 링크 · 혜택 덩어리(금액·%·N+N·무료·혜택 낱말) · 문장 속 #태그. 겹치면 합친다. */
function protectedSpans(text: string): SnsTextSpan[] {
  const raw: SnsTextSpan[] = [
    ...findSnsLinkSpans(text),
    ...findBenefitSpans(text),
    ...findBodyHashtagSpans(text),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: SnsTextSpan[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && s.start < last.end) {
      if (s.end > last.end) { last.end = s.end; last.text = text.slice(last.start, last.end); }
      continue;
    }
    merged.push({ start: s.start, end: s.end, text: text.slice(s.start, s.end) });
  }
  return merged;
}

/**
 * 가린다. `addNew=false` 면 표에 있는 값만 가린다(again 의 지난 안 · 면허 밖 값은 토큰이 되지 않는다).
 * @returns 가린 글과 이번에 쓴 키
 */
function maskWith(text: string, table: TokenTable, addNew: boolean): { text: string; used: Set<string> } {
  const used = new Set<string>();
  let out = '';
  let pos = 0;
  for (const s of protectedSpans(text)) {
    let key = table.keyOf.get(s.text);
    if (!key) {
      if (!addNew) continue;
      table.next += 1;
      key = `{{k${table.next}}}`;
      table.keyOf.set(s.text, key);
      table.valueOf.set(key, s.text);
    }
    used.add(key);
    out += text.slice(pos, s.start) + key;
    pos = s.end;
  }
  return { text: out + text.slice(pos), used };
}

/** 되돌린다. **쓴 키가 하나라도 없거나 모르는 키가 남았으면 null**(그 결과는 쓰지 않는다). */
function unmask(text: string, table: TokenTable, used: Set<string>): string | null {
  for (const key of used) if (!text.includes(key)) return null;
  let out = text;
  for (const [key, value] of table.valueOf) out = out.split(key).join(value);
  if (/\{\{\s*k\d+\s*\}\}/.test(out)) return null;
  return out;
}

// ───────────────────────────── 가드 ─────────────────────────────

/** 결과의 링크 호스트가 모두 원문에 있는가. */
function linksWithinOriginal(result: string, original: string): boolean {
  const allowed = new Set(findSnsLinkSpans(original).map((s) => snsLinkHost(s.text)));
  return findSnsLinkSpans(result).every((s) => allowed.has(snsLinkHost(s.text)));
}

/** 원문에 없던 #태그를 지운다. 원문에 그 낱말이 있으면 `#` 만 뗀다. */
function dropInventedHashtags(result: string, original: string): string {
  const allowed = new Set(extractBodyHashtags(original).map((t) => t.toLowerCase()));
  const plain = original.toLowerCase();
  let out = result;
  const spans = findBodyHashtagSpans(result).filter((s) => !allowed.has(s.tag.toLowerCase()));
  for (const s of spans.sort((a, b) => b.start - a.start)) {
    if (plain.includes(s.tag.toLowerCase())) {
      out = out.slice(0, s.start) + out.slice(s.start + 1, s.end) + out.slice(s.end);
    } else {
      const before = out.slice(0, s.start).replace(/[ \t]+$/, '');
      out = before + out.slice(s.end);
    }
  }
  return out.replace(/[ \t]+\n/g, '\n');
}

/**
 * 사진 초안에서 **면허 밖 사실**이 든 문장을 뺀다.
 * ★ 2026-09-25 면허 = 사진 속 글 + 회사 이름. 그 안에 있는 숫자·링크·혜택·사실 낱말은 쓸 수 있다
 *   (전에는 전부 뺐다 → 포스터 문구가 든 문장이 통째로 빠졌다).
 */
function keepPhotoSafeSentences(text: string, license = ''): string {
  const lic = String(license ?? '');
  const licLower = lic.toLowerCase();
  const licDigits = lic.replace(/\s+/g, '');
  const licHosts = new Set(findSnsLinkSpans(lic).map((s) => snsLinkHost(s.text)));
  const spanKey = (t: string) => t.replace(/\s+/g, ' ').trim();
  const licBenefits = new Set(findBenefitSpans(lic).map((s) => spanKey(s.text)));
  const wordLicensed = (w: string) => licLower.includes(w.toLowerCase()) || !!PHOTO_FACT_WORD_EQUIV[w]?.test(lic);

  const lines = String(text ?? '').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const sentences = line.split(/(?<=[.!?…~])\s+/);
    const safe = sentences.filter((s) => {
      const t = s.trim();
      if (!t) return false;
      if ((t.match(/\d+/g) ?? []).some((d) => !licDigits.includes(d))) return false;
      if (findSnsLinkSpans(t).some((l) => !licHosts.has(snsLinkHost(l.text)))) return false;
      if (findBenefitSpans(t).some((b) => !licBenefits.has(spanKey(b.text)))) return false;
      if (PHOTO_DRAFT_FACT_WORDS.some((w) => t.includes(w) && !wordLicensed(w))) return false;
      return true;
    });
    if (safe.length) kept.push(safe.join(' '));
  }
  return kept.join('\n').trim();
}

function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
}

// ───────────────────────────── 사진 ─────────────────────────────

/**
 * 사진 초안에 넘길 사진 — **회사 조건으로 다시 읽고** 영상은 빼고 요청 순서대로 앞 3장 · 긴 변 1024 로 줄여 JPEG.
 * 공용 AI 함수(`services/ai.ts` images)는 고치지 않는다.
 */
export async function loadSnsCaptionImages(companyId: string, mediaIds: readonly string[], withImages = true): Promise<{
  images: Array<{ media_type: string; data: string }>;
  /** images 와 같은 순서의 미디어 id(사진 속 글 캐시 키) */
  imageIds: string[];
  imageCount: number;
  videoCount: number;
}> {
  const ids = [...new Set(mediaIds.map(String))].slice(0, 20);
  if (!ids.length) return { images: [], imageIds: [], imageCount: 0, videoCount: 0 };
  const r = await query(
    `SELECT id, kind, path FROM sns_media WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`,
    [companyId, ids],
  );
  const byId = new Map(r.rows.map((row: any) => [String(row.id), row]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as Array<{ id: string; kind: string; path: string }>;
  const photos = ordered.filter((m) => m.kind === 'image');
  const videoCount = ordered.filter((m) => m.kind === 'video').length;
  const images: Array<{ media_type: string; data: string }> = [];
  const imageIds: string[] = [];
  // 글이 있으면(다듬기) 사진을 읽지 않는다 — 모드 판정에 필요한 건 수뿐이다
  for (const m of withImages ? photos.slice(0, SNS_CAPTION_PHOTO_LIMIT) : []) {
    try {
      const buf = await sharp(snsMediaAbsPath(m.path))
        .rotate()
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      images.push({ media_type: 'image/jpeg', data: buf.toString('base64') });
      imageIds.push(String(m.id));
    } catch (err) {
      console.error('[SNS caption] 사진 읽기 실패:', m.id, err);
    }
  }
  return { images, imageIds, imageCount: photos.length, videoCount };
}

const TRANSCRIBE_SYSTEM = [
  '너는 사진 속 글자를 옮겨 적는 전사 담당이다.',
  '사진에 인쇄된 글자를 줄 단위로 보이는 그대로 옮긴다. 요약·의역·번역·창작 금지 · 사진에 없는 말 금지.',
  '영문·숫자·기호도 그대로 옮긴다. 너무 작거나 흐려 읽을 수 없는 글자는 뺀다.',
  '사진이 여러 장이면 장 순서대로 이어서 적는다.',
  `출력은 JSON 하나만: {"lines":["첫 줄","둘째 줄"]} · 최대 ${IMAGE_TEXT_MAX_LINES}줄 · 글자가 없으면 {"lines":[]}`,
].join('\n');

/**
 * ★ 2026-09-25 사진 속 글자 옮겨 적기(A안 1단계). 무작위성 0 · 창작 금지.
 * 선례 = AI 영업 배너 전사(`sales-outreach-produce.ts transcribeBannerLines`).
 * 읽지 못하면 [] — 사진 초안은 사진 속 글 없이(보이는 것만) 이어 간다. 한도 초과는 그대로 던진다(라우트가 429).
 */
export async function transcribeSnsImageText(input: {
  companyId: string;
  userId?: string | null;
  images: Array<{ media_type: string; data: string }>;
  imageIds: readonly string[];
}): Promise<string[]> {
  if (!input.images.length) return [];
  const key = `${input.companyId}:${input.imageIds.join(',')}`;
  const hit = imageTextCache.get(key);
  if (hit && Date.now() - hit.at < IMAGE_TEXT_TTL_MS) return hit.lines;

  let raw: string;
  try {
    raw = await callAIWithFallback({
      system: TRANSCRIBE_SYSTEM,
      userMessage: '사진 속 글자를 옮겨라.',
      maxTokens: 500,
      temperature: 0,
      companyId: input.companyId,
      userId: input.userId ?? undefined,
      source: 'sns-caption-generate',
      images: input.images,
    });
  } catch (err: any) {
    if (err?.name === 'AiRateLimitExceeded') throw err;
    console.error('[SNS caption] 사진 속 글 읽기 실패(보이는 것만으로 이어 감):', err?.message || err);
    return [];
  }
  let lines: string[] = [];
  try {
    const parsed = extractJsonFromAiText<{ lines?: unknown }>(String(raw));
    lines = (Array.isArray(parsed.lines) ? parsed.lines : [])
      .map((x) => String(x ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, IMAGE_TEXT_MAX_LINES)
      .map((l) => [...l].slice(0, IMAGE_TEXT_MAX_CHARS).join(''));
  } catch {
    lines = [];
  }
  if (imageTextCache.size > 200) imageTextCache.clear();
  imageTextCache.set(key, { lines, at: Date.now() });
  return lines;
}

// ───────────────────────────── 프롬프트 ─────────────────────────────

const OUTPUT_RULE = '출력 형식(JSON 하나만):\n{"caption":"글","tags":["목록에서 고른 태그"]}';

const REFINE_SYSTEM = [
  '너는 한국 소상공인의 SNS 게시글을 다듬는 편집자다.',
  '규칙:',
  '- 사용자가 쓴 내용만 쓴다. 없는 사실·혜택·가격·기간·수치·장소·연락처를 지어내지 않는다.',
  '- {{k1}} 같은 토큰은 링크·금액·혜택·태그 자리다. 토큰 글자를 하나도 바꾸지 말고 모두 남긴다. 문장에 맞게 자리를 옮기는 것은 된다.',
  '- 맞춤법·띄어쓰기·어색한 문장을 바로잡고 읽기 좋게 줄을 나눈다. 뜻은 바꾸지 않는다.',
  '- 효과를 장담하는 말(확산·바이럴·도달·팔로워 증가)을 쓰지 않는다.',
  '- 해시태그(#)를 새로 쓰지 않는다. 태그는 목록에서 고르기만 한다.',
  '- 이모지는 원문에 있던 만큼만 쓰고, 원문에 없으면 0~2개.',
  OUTPUT_RULE,
].join('\n');

// ★ 2026-09-25 A안 — 사진 속 글이 메시지다. 묘사가 아니라 게시글을 쓴다(소설식 묘사체가 나오던 결함).
const PHOTO_SYSTEM = [
  '너는 한국 소상공인·브랜드의 SNS 게시글 첫 초안을 쓰는 마케터다.',
  '사진과 아래 "사진 속 글"을 보고 이 사진과 함께 올릴 글을 쓴다.',
  '규칙:',
  '- 사진 속 글이 있으면 그것이 이 게시물의 메시지다. 첫 줄은 사진 속 제목이나 핵심 문구를 살려 쓴다.',
  '- 이름·날짜·시각·가격·혜택·기간·행사·장소·연락처·링크 같은 사실은 사진 속 글과 회사 이름에 있는 것만 쓴다. 없는 사실은 지어내지 않는다.',
  '- 사진 속 장면은 한 문장 이하로만 거든다. 장면을 늘어놓거나 소설처럼 묘사하지 않는다.',
  '- 말투는 SNS에 올리는 친근한 존댓말(해요체). 2~4줄이고 줄마다 한 가지 이야기만 한다. 이모지는 0~2개.',
  '- 효과를 장담하는 말(확산·바이럴·도달·팔로워 증가)을 쓰지 않는다.',
  '- 해시태그(#)를 쓰지 않는다. 태그는 목록에서 고르기만 한다.',
  '- 사진 속 글이 없으면 사진에 보이는 것을 해요체로 두세 문장만 쓴다.',
  OUTPUT_RULE,
].join('\n');

// ───────────────────────────── 본체 ─────────────────────────────

export interface SnsAiCaptionInput {
  companyId: string;
  userId?: string | null;
  action: SnsCaptionAction;
  /** 면허. write·fit = 지금 글 · again = AI 쓰기 직전 사용자 글 */
  body: string;
  /** again 에서 피할 지난 안(면허 아님) */
  previous?: string;
  /** 지금 켜진 칩(참고 · 고를 후보에서 뺀다) */
  tags: string[];
  /** 회사 자주 쓰는 태그 */
  tagSet: string[];
  /** 사진 초안용(라우트가 loadSnsCaptionImages 로 준비) */
  media: { images: Array<{ media_type: string; data: string }>; imageIds?: string[]; imageCount: number; videoCount: number };
  /** ★ 0925 회사 이름(브랜드명 우선) — 사진 초안의 면허에 든다 */
  brandName?: string;
  /** fit 전용 — 맞출 채널 */
  fit?: { label: string; spec: SnsCaptionSpec; aiNotice: boolean };
}

export interface SnsAiCaptionResult {
  mode: SnsCaptionMode;
  /** 넣을 글. changed=false 면 원문 그대로(사진 초안 실패면 빈 글) */
  caption: string;
  /** 원문과 다른 글을 돌려주는가 */
  changed: boolean;
  /** AI 가 켠 자주 쓰는 태그(세트 부분집합) */
  tags: string[];
  /** 사용자에게 보일 한 줄(없으면 null) */
  note: string | null;
  /** 세트 밖이라 버린 태그(진단용 · 화면에 쓰지 않는다) */
  rejectedTags: string[];
  /** ★ 0925 사진 초안에서 읽은 사진 속 글(화면 '사진에서 읽은 글' · 그 밖 모드는 빈 배열) */
  imageText: string[];
}

function unchanged(mode: SnsCaptionMode, body: string, note: string): SnsAiCaptionResult {
  return { mode, caption: mode === 'photo_draft' ? '' : body, changed: false, tags: [], note, rejectedTags: [], imageText: [] };
}

export async function generateSnsCaption(input: SnsAiCaptionInput): Promise<SnsAiCaptionResult> {
  const original = String(input.body ?? '');
  const judged = snsCaptionMode({ body: original, imageCount: input.media.imageCount, videoCount: input.media.videoCount });
  if (judged.mode === 'locked') return unchanged('locked', original, judged.reason || '');
  const mode = judged.mode;
  if (input.action === 'fit' && (mode !== 'refine' || !input.fit)) {
    return unchanged(mode, original, '줄일 글이 없어요.');
  }
  if (mode === 'photo_draft' && !input.media.images.length) {
    return unchanged(mode, original, '사진을 읽지 못했어요. 한 줄만 써 주시면 다듬어 드릴게요.');
  }

  const { head, tail } = splitTrailingTagLines(original);
  const set = normalizeSnsTags(input.tagSet || []);
  const onKeys = new Set(normalizeSnsTags(input.tags || []).map((t) => t.toLowerCase()));
  const candidates = input.action === 'fit' ? [] : set.filter((t) => !onKeys.has(t.toLowerCase()));

  const table = newTable();
  const masked = maskWith(head, table, true);
  const previous = input.action === 'again' && input.previous ? maskWith(splitTrailingTagLines(String(input.previous)).head, table, false).text : '';

  let fitTarget = 0;
  if (input.action === 'fit' && input.fit) {
    const now = buildSnsCaption({ body: original, tags: input.tags, aiNotice: input.fit.aiNotice }, input.fit.spec);
    if (now.overBy === 0) return unchanged(mode, original, `이미 ${input.fit.label} 길이에 맞아요.`);
    const counting = input.fit.spec.captionCounting ?? 'chars';
    const headLen = countSnsCaption(head, counting);
    const room = Math.max(20, headLen - now.overBy - Math.ceil(input.fit.spec.maxCaptionChars * 0.05));
    // X 는 한글 1자를 2로 센다 — 모델에게는 한글 글자 수로 말한다.
    fitTarget = counting === 'x_weighted' ? Math.floor(room / 2) : room;
  }

  // ★ 0925 A안 1단계 — 사진 속 글을 먼저 읽는다(면허를 쓰기 전에 정한다)
  const imageText = mode === 'photo_draft'
    ? await transcribeSnsImageText({ companyId: input.companyId, userId: input.userId, images: input.media.images, imageIds: input.media.imageIds ?? [] })
    : [];
  const brand = String(input.brandName ?? '').trim();

  const lines: string[] = [];
  if (mode === 'photo_draft') {
    if (brand) lines.push(`회사 이름: ${brand}`);
    lines.push(imageText.length
      ? `사진 속 글(보이는 그대로 옮긴 것 · 사실은 여기 있는 것만 쓴다):\n${imageText.join('\n')}`
      : '사진 속 글: 없음');
  }
  if (mode === 'refine') {
    lines.push('다듬을 글:', masked.text);
    if (input.action === 'fit') lines.push('', `이 글을 한글 기준 ${fitTarget}자 이내로 줄여라. 토큰과 핵심(무엇·언제·어디)은 남기고 군더더기를 뺀다.`);
  }
  if (previous) lines.push('', '지난 안(이 안과 다른 표현으로 써라. 문장을 그대로 가져오지 않는다):', previous);
  lines.push('');
  lines.push(candidates.length
    ? `고를 수 있는 태그(이 목록 밖은 절대 쓰지 마라 · 글과 맞는 것만 · 없으면 빈 배열): ${candidates.join(', ')}`
    : '고를 태그가 없다. tags 는 빈 배열로 둔다.');

  const raw = await callAIWithFallback({
    system: mode === 'photo_draft' ? PHOTO_SYSTEM : REFINE_SYSTEM,
    userMessage: lines.join('\n'),
    maxTokens: 1200,
    temperature: input.action === 'again' ? 0.9 : input.action === 'fit' ? 0.3 : 0.6,
    companyId: input.companyId,
    userId: input.userId ?? undefined,
    source: 'sns-caption-generate',
    images: mode === 'photo_draft' ? input.media.images : undefined,
  });

  let parsed: { caption?: unknown; tags?: unknown } = {};
  try {
    parsed = extractJsonFromAiText(String(raw));
  } catch {
    return unchanged(mode, original, 'AI 답을 읽지 못했어요. 한 번 더 눌러 주세요.');
  }

  // 태그 = 세트 부분집합만(켜진 칩은 후보에서 뺐다)
  const suggested = normalizeSnsTags(Array.isArray(parsed.tags) ? parsed.tags : []);
  const candKeys = new Set(candidates.map((t) => t.toLowerCase()));
  const tags = suggested.filter((t) => candKeys.has(t.toLowerCase()));
  const rejectedTags = suggested.filter((t) => !candKeys.has(t.toLowerCase()));

  let text = String(parsed.caption ?? '').trim();
  if (mode === 'photo_draft') {
    // 면허 = 사진 속 글 + 회사 이름 — 그 밖의 사실·태그가 든 문장은 뺀다
    const license = [...imageText, brand].filter(Boolean).join('\n');
    text = dropInventedHashtags(text, license);
    text = keepPhotoSafeSentences(text, license);
    if ([...text].length < PHOTO_DRAFT_MIN_CHARS) return { ...unchanged(mode, original, PHOTO_DRAFT_TOO_SHORT), tags, imageText };
    const caption = tail.trim() ? `${text}\n\n${tail.replace(/^\s+/, '')}` : text;
    return { mode, caption, changed: true, tags, note: null, rejectedTags, imageText };
  }

  // ① 토큰 복원 — 잃었으면 버리고 버렸다고 말한다.
  const restored = unmask(text, table, masked.used);
  if (restored == null || !restored.trim()) {
    return { ...unchanged(mode, original, 'AI가 링크나 금액을 바꾸려 해서 넣지 않았어요. 한 번 더 눌러 주세요.'), tags };
  }
  // ② 링크 호스트 ⊆ 원문
  if (!linksWithinOriginal(restored, original)) {
    return { ...unchanged(mode, original, 'AI가 원래 없던 링크를 넣으려 해서 넣지 않았어요. 한 번 더 눌러 주세요.'), tags };
  }
  // ③ 원문에 없던 #태그 · ④ 원문에 없던 혜택
  let out = dropInventedHashtags(restored, original);
  out = stripUnauthorizedBenefits(out, original);
  if (!out.trim()) return { ...unchanged(mode, original, '글을 다듬지 못했어요. 한 번 더 눌러 주세요.'), tags };

  // ⑤ 끝 태그 줄 다시 붙이기(원문 그대로)
  const caption = tail ? `${out.replace(/\s+$/, '')}${tail}` : out;
  const changed = !sameText(caption, original);

  let note: string | null = changed ? null : '고칠 곳을 찾지 못했어요.';
  if (changed && input.action === 'fit' && input.fit) {
    const after = buildSnsCaption({ body: caption, tags: input.tags, aiNotice: input.fit.aiNotice }, input.fit.spec);
    if (after.overBy > 0) note = `아직 ${input.fit.label} 길이보다 ${after.overBy}자 길어요. 한 번 더 줄이거나 직접 고쳐 주세요.`;
  }
  return { mode, caption, changed, tags, note, rejectedTags, imageText: [] };
}
