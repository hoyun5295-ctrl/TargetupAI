/**
 * sns-caption-ai.ts — AI 캡션·태그 (2026-09-21 S2)
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-8 · 불변 §2-10·§2-11.
 *
 * ⛔ **AI 는 태그 생성기가 아니라 선택기다**(§2-10). 회사 고정 세트를 주고 "이 글에 맞는 것을 고르라"고 하며,
 *   서버가 `tags ⊆ fixedSet` 를 **강제**한다. 세트 밖 태그는 모델이 뭐라 하든 버린다.
 *   근거 = 회의 §8-1 6번(고유명사 판별기가 없어 AI 가 지어낸 태그를 검증할 방법이 없다 · 오탐 0).
 *
 * ⛔ **캡션은 다듬기만 한다**(§2-11). 없는 혜택·가격·기간·수치·링크를 만들지 않는다.
 *   ① URL·금액은 토큰으로 바꿔 모델에 넘기고 결과에서 되돌린다 — **토큰을 잃은 후보는 폐기한다**
 *      (모델이 링크를 지우거나 바꿨다는 뜻이고, 그 결과를 쓰면 고객 링크가 사라진다)
 *   ② 출구에서 `stripUnauthorizedBenefits(text, 사용자 원문)` — 원문에 없던 혜택 약속을 지운다
 *
 * ⚠ **사진 입력은 아직 들어 있지 않다.** Harold 승인(0920)은 설계에 반영됐지만, 구현하려면 공용 CT
 *   `services/ai.ts` 가 이미지를 받도록 확장해야 한다. "접수 하나 때문에 공용 CT 를 고치지 않는다"는
 *   규율에 따라 별도 과제로 분리했다(설계서 §9-11). 지금은 글만 보고 고른다.
 */

import { callAIWithFallback, withCopyRules } from '../services/ai';
import { stripUnauthorizedBenefits } from './copy-benefit-detector';
import { normalizeSnsTags } from './sns-caption-rules';

/** 모델에 넘기기 전 감춰 둘 것 — 링크와 금액. 돌아온 뒤 그대로 되돌린다. */
const URL_RE = /https?:\/\/[^\s]+/g;
const PRICE_RE = /\d[\d,]*\s*원/g;

interface Masked {
  text: string;
  tokens: Map<string, string>;
}

function mask(body: string): Masked {
  const tokens = new Map<string, string>();
  let i = 0;
  let text = body.replace(URL_RE, (m) => {
    const key = `{{link${++i}}}`;
    tokens.set(key, m);
    return key;
  });
  let j = 0;
  text = text.replace(PRICE_RE, (m) => {
    const key = `{{price${++j}}}`;
    tokens.set(key, m);
    return key;
  });
  return { text, tokens };
}

/** 토큰을 되돌린다. **하나라도 사라졌으면 null** — 그 후보는 쓰지 않는다. */
function unmask(text: string, tokens: Map<string, string>): string | null {
  let out = text;
  for (const [key, value] of tokens) {
    if (!out.includes(key)) return null;
    out = out.split(key).join(value);
  }
  return out;
}

const SYSTEM = withCopyRules(
  [
    '너는 한국 소상공인의 SNS 게시글을 다듬는 편집자다.',
    '규칙:',
    '- 사용자가 쓴 내용만 쓴다. 없는 사실·혜택·가격·기간·수치를 지어내지 않는다.',
    '- {{link1}} {{price1}} 같은 토큰은 그대로 남긴다. 지우거나 바꾸지 않는다.',
    '- 문장을 자연스럽게 다듬되 뜻을 바꾸지 않는다.',
    '- 효과를 장담하는 말(확산·바이럴·도달·팔로워 증가)을 쓰지 않는다.',
    '- 해시태그를 본문에 직접 쓰지 않는다. 태그는 따로 고른다.',
    '출력 형식(JSON 하나만):',
    '{"caption":"다듬은 글","tags":["세트에서 고른 태그"]}',
  ].join('\n'),
);

export interface SnsAiCaptionResult {
  caption: string;
  tags: string[];
  /** 세트 밖이라 버린 태그(진단용 · 화면에 쓰지 않는다) */
  rejectedTags: string[];
}

/**
 * @param body   사용자가 쓴 원문. **이것이 유일한 면허다**(태그·브랜드 킷은 재료일 뿐)
 * @param tagSet 회사 고정 세트. 비면 태그는 고르지 않고 캡션만 다듬는다
 */
export async function generateSnsCaption(input: {
  companyId: string;
  body: string;
  tagSet: string[];
}): Promise<SnsAiCaptionResult> {
  const original = String(input.body || '');
  const set = normalizeSnsTags(input.tagSet || []);
  const masked = mask(original);

  const userMessage = [
    '다듬을 글:',
    masked.text,
    '',
    set.length ? `고를 수 있는 태그(이 목록 밖은 절대 쓰지 마라): ${set.join(', ')}` : '태그 목록이 없다. tags 는 빈 배열로 둔다.',
  ].join('\n');

  const raw = await callAIWithFallback({
    system: SYSTEM,
    userMessage,
    maxTokens: 1200,
    temperature: 0.6,
    companyId: input.companyId,
    source: 'sns-caption-generate',
  });

  let parsed: { caption?: string; tags?: unknown[] } = {};
  try {
    const m = String(raw).match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  } catch {
    parsed = {};
  }

  // ① 토큰 복원 — 잃었으면 다듬기 결과를 버리고 원문을 그대로 쓴다.
  const restored = unmask(String(parsed.caption ?? ''), masked.tokens);
  let caption = restored ?? original;

  // ② 출구 차단기 — 원문에 없던 혜택 약속을 지운다.
  caption = stripUnauthorizedBenefits(caption, original);
  if (!caption.trim()) caption = original;

  // 태그는 **세트의 부분집합**만 남긴다. 모델이 지어낸 것은 여기서 전부 떨어진다.
  const suggested = normalizeSnsTags(Array.isArray(parsed.tags) ? parsed.tags : []);
  const lower = new Set(set.map((t) => t.toLowerCase()));
  const tags = suggested.filter((t) => lower.has(t.toLowerCase()));
  const rejectedTags = suggested.filter((t) => !lower.has(t.toLowerCase()));

  return { caption, tags, rejectedTags };
}
