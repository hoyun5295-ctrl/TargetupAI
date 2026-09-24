/**
 * sns-caption-rules.ts — 캡션·태그 규칙 컨트롤타워 (순수 · DB·네트워크 의존 0) · 2026-09-21 S2
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §2-9 · §3-8 · §3-9.
 *   "캡션 규칙은 CT 하나. **미리보기·저장·예약·워커 전 경로가 같은 CT를 지나고**, target 행에 확정본을
 *    저장하며 워커는 그 컬럼만 읽는다. 화면 규격표(`GET /api/sns/specs`)는 그 CT 상수를 그대로 직렬화한다."
 *
 * ⛔ **고객 문안을 말없이 바꾸지 않는다.**
 *   상한을 넘어도 **자르지 않는다.** 넘었다는 사실과 몇 자 넘었는지를 돌려주고, 게시를 막는 것은 호출부다.
 *   글자를 잘라 보내면 문장이 중간에 끊긴 채 고객 계정에 남는다 — 그것이 곧 사고다.
 *
 * ⛔ **AI 표시는 끌 수 없다**(§3-9). 우리가 만든 이미지가 실린 게시물은 캡션 끝에 표시 문장이 붙고,
 *   그 문장 몫까지 포함해 상한을 판정한다(붙이고 나서 넘치면 게시가 막히는 것이 맞다 · 표시를 빼는 것이 아니라).
 */

import { BRAND_AI_IMAGE_NOTICE } from './brand-message';

/** 태그 한 개의 형식. 한글·영문·숫자·밑줄만. 앞의 `#` 는 우리가 붙인다(사용자가 쓴 `#` 는 지운다). */
const TAG_BODY_RE = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_]+$/;

export interface SnsCaptionSpec {
  maxCaptionChars: number;
  maxTags: number;
  /** ★ 1차-B — 글자 세는 방식. 없으면 chars(1차-A 동작 그대로) */
  captionCounting?: SnsCaptionCounting;
  /**
   * ★ 2026-09-24 첫 태그만 태그로 인정하는 채널(Threads · 공식 문서 '게시물당 1개 · 첫 유효 태그').
   *   본문에 태그가 여럿이어도 거부가 아니라 표시 방식이라 **경고하지 않는다**(0924 최종 검증 F3).
   */
  tagFirstOnly?: boolean;
}

export type SnsCaptionCounting = 'chars' | 'x_weighted';

// ───────────── ★ 2026-09-23 1차-B — X 가중 글자 수 ─────────────
// 근거 = docs.x.com counting-characters(2026-09-23 열람): 280 가중 · CJK·이모지 2 · URL 23 · NFC.
// 가중 1 구간 = twitter-text v3 설정값(0~4351 · 8192~8205 · 8208~8223 · 8242~8247). 그 밖은 2.
// ⚠ 근사 둘: ①스킴 없는 주소는 흔한 도메인 끝말만 주소로 본다 ②키캡 이모지는 따로 묶지 않는다.
//   둘 다 **더 크게 세는 쪽이 아니라 같은 값**을 내는 흔한 경우를 덮는다. 실측에서 다르면 이 블록만 고친다.
// ⛔ 화면 미러 = frontend/src/utils/sns-view.ts countSnsCaption. 계약 테스트가 같은 표로 둘을 맞춘다.
const X_SCHEME_URL_RE = /https?:\/\/[^\s]+/gi;
const X_BARE_URL_RE = /\b(?:[a-z0-9-]+\.)+(?:com|net|org|ai|io|co|kr|me|app|dev|shop|store|info|biz|xyz|jp|us|tv|ly|gg)\b(?:\/[^\s]*)?/gi;
const X_EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;

function xWeight(cp: number): number {
  if (cp <= 4351) return 1;
  if (cp >= 8192 && cp <= 8205) return 1;
  if (cp >= 8208 && cp <= 8223) return 1;
  if (cp >= 8242 && cp <= 8247) return 1;
  return 2;
}

/** 채널 방식으로 센 글자 수. chars = 코드포인트 수(1차-A 그대로) · x_weighted = X 가중. */
export function countSnsCaption(text: string, mode: SnsCaptionCounting): number {
  const raw = String(text ?? '');
  if (mode !== 'x_weighted') return [...raw].length;
  let total = 0;
  let marks = 0;
  const take = (w: number) => () => { total += w; marks += 1; return '\n'; };
  const rest = raw.normalize('NFC')
    .replace(X_SCHEME_URL_RE, take(23))
    .replace(X_BARE_URL_RE, take(23))
    .replace(X_EMOJI_RE, take(2));
  for (const ch of rest) total += xWeight(ch.codePointAt(0) ?? 0);
  return total - marks;   // 자리표시 줄바꿈(가중 1)은 원문에 없던 글자다
}

/** 글 속 링크 자리(스킴 주소 · 맨 도메인). 겹치지 않고 앞에서부터. */
export interface SnsTextSpan { start: number; end: number; text: string }

/**
 * ★ 2026-09-24 글 속 링크 자리 — AI 캡션 가림(B-6)과 맞춤법 보호 구간(B-7)이 같은 판정을 쓴다.
 *   X 가중 세기와 같은 두 정규식이다(주소로 보는 기준이 경로마다 달라지지 않게).
 */
export function findSnsLinkSpans(text: string): SnsTextSpan[] {
  const src = String(text ?? '');
  const spans: SnsTextSpan[] = [];
  for (const re of [X_SCHEME_URL_RE, X_BARE_URL_RE]) {
    for (const m of src.matchAll(re)) {
      if (m.index == null) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      spans.push({ start, end, text: m[0] });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** 링크의 호스트(소문자). 스킴이 없으면 붙여 읽는다. 읽지 못하면 소문자 원문. */
export function snsLinkHost(link: string): string {
  const raw = String(link ?? '').trim();
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

export interface SnsCaptionInput {
  /** 사용자가 쓴 원문. **이 값은 절대 변형하지 않는다.** */
  body: string;
  /** 켜진 태그(순서 유지 · `#` 없이) */
  tags: string[];
  /** 우리가 만든 이미지가 실렸는가 → AI 표시 문장 부착 대상(§3-9) */
  aiNotice: boolean;
}

export interface SnsCaptionResult {
  /** 실제로 채널에 보낼 확정본. target 행 `caption` 에 저장되고 워커는 이것만 읽는다. */
  text: string;
  /** 확정본 길이(표시 문장·태그 포함 · 채널 방식) */
  length: number;
  /** 상한 */
  limit: number;
  /** 상한을 넘은 글자 수(0 이면 통과) */
  overBy: number;
  /** 게시 가능한가 — 넘침 0 **그리고** 채울 자리 0 */
  ok: boolean;
  /** 태그 자리가 모자라 이 채널에 싣지 못한 칩(잘라낸 것이 아니라 **처음부터 싣지 않은 것**) */
  droppedTags: string[];
  /** AI 표시 문장이 캡션에 들어 있는가(이번에 붙였거나 본문 끝에 이미 있었거나) */
  aiNoticeApplied: boolean;
  // ── ★ 2026-09-24 (docs/2026-09-24-sns-channel-design.md §4 B-3) ──
  /** 이 채널에 실제로 실은 칩 */
  keptTags: string[];
  /** 본문에 사용자가 직접 쓴 태그(고유 · 대소문자 무시) — 채널 태그 자리를 먼저 쓴다 */
  bodyTags: string[];
  /** 본문에 이미 있어 조립에서 뺀 칩(두 번 붙지 않게) */
  alreadyInBody: string[];
  /** 본문 태그만으로 채널 상한을 넘는다(경고만 · 첫 태그만 인정하는 채널은 false) */
  bodyTagsOver: boolean;
  /** 사용자가 채워야 할 자리 표기가 남았다(`[혜택 안내: 직접 수정해주세요]` · `[URL 입력]`) — 게시 불가 */
  placeholderLeft: boolean;
}

/** 태그 한 개 판정 결과. 거절이면 사람이 읽는 사유 한 문장. */
export type SnsTagCheck = { ok: true; tag: string } | { ok: false; raw: string; reason: string };

/** Threads 주제 태그 상한(공식 문서 · 1~50자). 다른 채널에도 같은 상한을 쓴다(한 칸의 태그가 채널마다 달라지지 않게). */
export const SNS_TAG_MAX_CHARS = 50;
const JAMO_ONLY_RE = /^[ㄱ-ㅎㅏ-ㅣ]+$/;
const DIGITS_ONLY_RE = /^[0-9]+$/;

/**
 * ★ 2026-09-24 태그 한 개 판정 — **사유를 돌려준다**(전에는 말없이 null 이었다 · 0924 확인 결함 K1).
 * 앞의 `#` 와 공백은 지운다. 화면은 같은 규칙(sns-view 미러)으로 입력 순간 거절하고, 서버는 저장 때 400 으로 거절한다.
 */
export function checkSnsTag(raw: unknown): SnsTagCheck | null {
  const src = String(raw ?? '');
  const s = src.trim().replace(/^#+/, '').replace(/\s+/g, '').normalize('NFC');
  if (!s) return null;
  if (!TAG_BODY_RE.test(s)) return { ok: false, raw: src.trim(), reason: '태그에는 한글·영문·숫자·밑줄만 쓸 수 있어요.' };
  if (DIGITS_ONLY_RE.test(s)) return { ok: false, raw: src.trim(), reason: '숫자만으로는 태그가 되지 않아요.' };
  if (JAMO_ONLY_RE.test(s)) return { ok: false, raw: src.trim(), reason: '자음·모음만으로는 태그를 만들 수 없어요.' };
  if ([...s].length > SNS_TAG_MAX_CHARS) return { ok: false, raw: src.trim(), reason: `태그는 ${SNS_TAG_MAX_CHARS}자까지 쓸 수 있어요.` };
  return { ok: true, tag: s };
}

/** 태그 1개 정규화. 형식 위반이면 null(사유가 필요하면 checkSnsTag 를 쓴다). */
export function normalizeSnsTag(raw: unknown): string | null {
  const r = checkSnsTag(raw);
  return r && r.ok ? r.tag : null;
}

/** 중복·형식 위반을 걸러 낸 태그 목록(순서 유지 · 대소문자 구분 없이 중복 제거). */
export function normalizeSnsTags(raw: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const tag = normalizeSnsTag(item);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** 형식 위반 태그 목록(사유 포함). 저장 거절(TAG_INVALID)과 세트 조회(invalid[])가 쓴다. */
export function invalidSnsTags(raw: readonly unknown[]): Array<{ raw: string; reason: string }> {
  const out: Array<{ raw: string; reason: string }> = [];
  for (const item of raw) {
    const r = checkSnsTag(item);
    if (r && !r.ok) out.push({ raw: r.raw, reason: r.reason });
  }
  return out;
}

// 본문 해시태그 — `#` 앞은 글자가 아니어야 하고(‘abc#태그’ 는 태그가 아니다) URL 조각은 뺀다.
const BODY_TAG_RE = /(^|[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_&/])#([0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_]+)/g;

/**
 * ★ 2026-09-24 본문에 사용자가 직접 쓴 해시태그(고유 · 대소문자 무시 · 처음 나온 표기 유지).
 * 운영 사실 = Harold 는 완성 글을 해시태그째 본문에 붙여 넣는다. 이 태그도 채널 태그 자리를 먼저 쓴다.
 * ⛔ 태그로 인정하는 기준은 checkSnsTag 와 같다(숫자만인 `#1` 은 태그가 아니다 · Threads 도 그렇게 본다).
 * ⛔ 전역 정규식은 matchAll/replace 로만 쓴다(`.test` 는 lastIndex 가 남아 호출마다 결과가 달라진다).
 */
export function extractBodyHashtags(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const span of findBodyHashtagSpans(String(body ?? '').normalize('NFC'))) {
    const key = span.tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(span.tag);
  }
  return out;
}

/**
 * ★ 2026-09-24 본문 해시태그의 **자리**(`#` 포함 · 받은 문자열 기준 위치 · 링크 안 조각 제외).
 *   AI 캡션 가림(B-6)과 맞춤법 보호 구간(B-7)이 쓴다. extractBodyHashtags 도 이 함수를 지난다(판정 하나).
 */
export function findBodyHashtagSpans(text: string): Array<SnsTextSpan & { tag: string }> {
  const src = String(text ?? '');
  const links = findSnsLinkSpans(src);
  const out: Array<SnsTextSpan & { tag: string }> = [];
  for (const m of src.matchAll(BODY_TAG_RE)) {
    if (m.index == null) continue;
    const start = m.index + m[1].length;
    const end = start + 1 + m[2].length;
    if (links.some((l) => start < l.end && end > l.start)) continue;
    const r = checkSnsTag(m[2]);
    if (!r || !r.ok) continue;
    out.push({ start, end, text: src.slice(start, end), tag: r.tag });
  }
  return out;
}

// ── 채울 자리 표기(시스템이 심는 문구만 · 넓히지 않는다) ──
// ⛔ 원본 규약 = frontend/src/utils/message-placeholders.ts(BENEFIT_PLACEHOLDER_SOURCE · URL_PLACEHOLDER_SOURCE).
//   고객 글 '[매장 직접 방문 시 증정]' 같은 정상 문구는 걸리지 않는다. 두 값이 같은지 계약 테스트가 본다.
export const SNS_BENEFIT_PLACEHOLDER_SOURCE = '\\[[^\\[\\]\\n]*혜택[^\\[\\]\\n]*직접\\s*(?:수정|작성)해\\s*주세요[^\\[\\]\\n]*\\]';
export const SNS_URL_PLACEHOLDER_SOURCE = '\\[\\s*URL\\s*입력\\s*\\]';

/** 사용자가 채워야 할 자리 표기가 남았는가. */
export function hasSnsPlaceholder(text: string): boolean {
  const t = String(text ?? '');
  return new RegExp(SNS_BENEFIT_PLACEHOLDER_SOURCE).test(t) || new RegExp(SNS_URL_PLACEHOLDER_SOURCE, 'i').test(t);
}

// AI 표시 문장이 본문 끝 독립 줄로 이미 있으면 다시 붙이지 않는다(brand-message NOTICE_TAIL_RE 선례 · 0924 F12).
const NOTICE_TAIL_RE = new RegExp(`(?:^|\\n)${BRAND_AI_IMAGE_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/**
 * 채널 하나의 확정본을 만든다. **모든 경로가 이 함수를 지난다**(미리보기·저장·예약·워커).
 *
 * 조립 순서 = 본문 → 태그 → AI 표시(§3-9 "표시 부착 → 규칙 CT → 확정본 저장" 을 한 함수 안에서 지킨다).
 * ★ 2026-09-24 태그 자리 = 채널 상한 − 본문 태그 수. 본문에 이미 있는 칩은 조립에서 뺀다(두 번 붙지 않게).
 *   칩은 남은 자리까지만 싣고, 넘치는 것은 **자르지 않고 `droppedTags` 로 알린다.** 본문은 한 글자도 바꾸지 않는다.
 */
export function buildSnsCaption(input: SnsCaptionInput, spec: SnsCaptionSpec): SnsCaptionResult {
  const body = String(input.body ?? '');
  const chips = normalizeSnsTags(input.tags ?? []);

  const bodyTags = extractBodyHashtags(body);
  const bodyKeys = new Set(bodyTags.map((t) => t.toLowerCase()));
  const alreadyInBody = chips.filter((t) => bodyKeys.has(t.toLowerCase()));
  const remaining = chips.filter((t) => !bodyKeys.has(t.toLowerCase()));
  const budget = Math.max(0, spec.maxTags - bodyTags.length);
  const keptTags = remaining.slice(0, budget);
  const droppedTags = remaining.slice(keptTags.length);
  const bodyTagsOver = !spec.tagFirstOnly && bodyTags.length > spec.maxTags;

  const noticeInBody = NOTICE_TAIL_RE.test(body.trimEnd());
  const parts: string[] = [];
  if (body.trim()) parts.push(body);
  if (keptTags.length) parts.push(keptTags.map((t) => `#${t}`).join(' '));
  if (input.aiNotice && !noticeInBody) parts.push(BRAND_AI_IMAGE_NOTICE);

  const text = parts.join('\n\n');
  // chars = 이모지·결합 문자를 1자로 세는 쪽이 Meta 계열 카운트에 가깝다 · X 는 가중(★ 1차-B)
  const length = countSnsCaption(text, spec.captionCounting ?? 'chars');
  const limit = spec.maxCaptionChars;
  const overBy = Math.max(0, length - limit);
  const placeholderLeft = hasSnsPlaceholder(body);

  return {
    text,
    length,
    limit,
    overBy,
    ok: overBy === 0 && !placeholderLeft,
    droppedTags,
    aiNoticeApplied: !!input.aiNotice || noticeInBody,
    keptTags,
    bodyTags,
    alreadyInBody,
    bodyTagsOver,
    placeholderLeft,
  };
}

/**
 * 여러 채널의 확정본을 한 번에. "한 번 쓰면 채널마다 알아서" 의 계산부.
 * 채널마다 상한이 다르므로 **같은 글이 어떤 채널은 통과하고 어떤 채널은 막힌다** — 그 사실을 그대로 돌려준다.
 */
export function buildSnsCaptions<T extends { platform: string; spec: SnsCaptionSpec }>(
  input: SnsCaptionInput,
  channels: readonly T[],
): Array<{ platform: string; result: SnsCaptionResult }> {
  return channels.map((c) => ({ platform: c.platform, result: buildSnsCaption(input, c.spec) }));
}

/** 화면이 게이지에 쓸 기준 채널 = **상한이 가장 빡빡한 채널**(여기만 지키면 나머지는 통과한다). */
export function tightestCaptionChannel<T extends { platform: string; label: string; spec: SnsCaptionSpec }>(
  channels: readonly T[],
): T | null {
  if (channels.length === 0) return null;
  return channels.reduce((min, c) => (c.spec.maxCaptionChars < min.spec.maxCaptionChars ? c : min), channels[0]);
}
