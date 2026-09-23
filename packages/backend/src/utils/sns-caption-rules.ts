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
  /** 확정본 길이(표시 문장·태그 포함) */
  length: number;
  /** 상한 */
  limit: number;
  /** 상한을 넘은 글자 수(0 이면 통과) */
  overBy: number;
  /** 게시 가능한가 */
  ok: boolean;
  /** 상한을 넘겨 실리지 못한 태그(잘라낸 것이 아니라 **처음부터 싣지 않은 것**) */
  droppedTags: string[];
  /** AI 표시 문장이 실제로 붙었는가 */
  aiNoticeApplied: boolean;
}

/** 태그 1개 정규화. 형식 위반이면 null(호출부가 사용자에게 사유를 말한다). */
export function normalizeSnsTag(raw: unknown): string | null {
  const s = String(raw ?? '').trim().replace(/^#+/, '').replace(/\s+/g, '');
  if (!s) return null;
  if (!TAG_BODY_RE.test(s)) return null;
  return s;
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

/**
 * 채널 하나의 확정본을 만든다. **모든 경로가 이 함수를 지난다**(미리보기·저장·예약·워커).
 *
 * 조립 순서 = 본문 → 태그 → AI 표시(§3-9 "표시 부착 → 규칙 CT → 확정본 저장" 을 한 함수 안에서 지킨다).
 * 태그는 채널 상한(`maxTags`)까지만 싣고, 넘치는 것은 **자르지 않고 `droppedTags` 로 알린다.**
 */
export function buildSnsCaption(input: SnsCaptionInput, spec: SnsCaptionSpec): SnsCaptionResult {
  const body = String(input.body ?? '');
  const tags = normalizeSnsTags(input.tags ?? []);

  const kept = tags.slice(0, Math.max(0, spec.maxTags));
  const droppedTags = tags.slice(kept.length);

  const parts: string[] = [];
  if (body.trim()) parts.push(body);
  if (kept.length) parts.push(kept.map((t) => `#${t}`).join(' '));
  if (input.aiNotice) parts.push(BRAND_AI_IMAGE_NOTICE);

  const text = parts.join('\n\n');
  // chars = 이모지·결합 문자를 1자로 세는 쪽이 Meta 계열 카운트에 가깝다 · X 는 가중(★ 1차-B)
  const length = countSnsCaption(text, spec.captionCounting ?? 'chars');
  const limit = spec.maxCaptionChars;
  const overBy = Math.max(0, length - limit);

  return {
    text,
    length,
    limit,
    overBy,
    ok: overBy === 0,
    droppedTags,
    aiNoticeApplied: !!input.aiNotice,
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
