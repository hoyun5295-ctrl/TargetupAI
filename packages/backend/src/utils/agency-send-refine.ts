/**
 * agency-send-refine.ts — 대행발송 문안 다듬기 (★ 2026-08-22 신설)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §3(불변 8) · §4-4(워커 A·B).
 *
 * 스팸필터에 걸린 문안을 다시 쓴다. **고객이 보낸 문안을 우리가 대신 고치는 것**이라
 * 문안 생성(generateMessages)과 규칙이 다르다:
 *   - 새로 짓는 게 아니라 **바꿔 쓴다.** 원문에 없던 내용이 들어오면 그 결과를 버린다.
 *   - 날짜·시각·금액·전화번호·주소는 **글자 그대로 남아야 한다.** 행사 날짜가 하루 밀리면 그건 다른 발송이다.
 *   - 혜택은 원문에 있는 것만. 판정은 기존 CT(`stripUnauthorizedBenefits`)에 맡긴다.
 *
 * 회차별 세기(설계서 §4-4 A):
 *   1회차 = 표현을 폭넓게 다듬는다. 2회차 = 핵심을 건드리지 않고 **표현만 최소 수정**.
 *
 * 과금 = 0. `CREDIT_COST_MAP`에 등록하지 않는다(미등록 source = 0, 과금 코드 변경 0 · Harold 확정 §8-1).
 *   기록만 `ai_call_log`에 `agency-send-refine`으로 남겨 원가를 잰다.
 */
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS, isAdaptiveOnlyModel } from '../config/defaults';
import { stripUnauthorizedBenefits } from './copy-benefit-detector';
import { recordAiCall } from './ai-rate-limit';

export const AGENCY_REFINE_SOURCE = 'agency-send-refine';

// ────────────── 핵심 토큰 보존 검사(순수) ──────────────

/** URL. 스팸 회피한다고 링크를 바꾸면 고객이 다른 곳으로 간다 */
const URL_RE = /https?:\/\/[^\s<>"']+|\b[a-z0-9-]+\.(?:kr|com|net|co\.kr|io|me)(?:\/[^\s<>"']*)?/gi;
/** 전화번호(하이픈·공백 허용). 회신처가 바뀌면 발송이 무의미하다 */
const PHONE_RE = /\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/g;
/** 날짜: 8/24 · 8월 24일 · 2026-08-24 · 24일 */
const DATE_RE = /\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}\s*[/월]\s*\d{1,2}\s*일?|\d{1,2}\s*일(?![시간])/g;
/** 시각: 14시 · 14:00 · 오후 2시 */
const TIME_RE = /\d{1,2}\s*:\s*\d{2}|\d{1,2}\s*시(?!간)/g;
/** 변수 자리. 치환 전 원문에는 %이름% 형태가 남아 있어야 한다 */
const VAR_RE = /%[^%\s]{1,20}%/g;

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * 바뀌면 안 되는 토큰을 뽑는다. 비교는 공백을 지운 형태로 한다
 * ("8월 24일"과 "8월24일"은 같은 날이다).
 */
export function extractAnchors(text: string): Set<string> {
  const out = new Set<string>();
  const src = String(text || '');
  for (const re of [URL_RE, PHONE_RE, DATE_RE, TIME_RE, VAR_RE]) {
    for (const m of src.matchAll(re)) {
      const key = norm(m[0]);
      if (key) out.add(key);
    }
  }
  return out;
}

export interface RefineCheck {
  ok: boolean;
  reason?: string;
}

/**
 * 다듬은 문안이 원문의 약속을 지켰는가.
 * ⛔ 여기서 통과한 것만 담당자에게 보낸다. 담당자가 승인하는 것은 이 검사를 지난 문장이다.
 */
export function checkRefined(original: string, refined: string): RefineCheck {
  const text = String(refined || '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > 2000) return { ok: false, reason: 'too-long' };

  // ① 원문에 있던 날짜·시각·번호·링크·변수가 그대로 남아 있어야 한다
  const before = extractAnchors(original);
  const after = extractAnchors(text);
  const lost: string[] = [];
  for (const a of before) if (!after.has(a)) lost.push(a);
  if (lost.length > 0) return { ok: false, reason: `anchor-lost:${lost.slice(0, 3).join(',')}` };

  // ② 원문에 없던 혜택을 지어내지 않았는가(기존 CT가 판정한다. 바뀐 곳이 있으면 지어낸 것)
  if (stripUnauthorizedBenefits(text, original) !== text) {
    return { ok: false, reason: 'benefit-invented' };
  }

  return { ok: true };
}

// ────────────── 프롬프트 ──────────────

const BASE_RULES = [
  '당신은 문자 발송 문안을 다듬는 사람입니다. 고객사가 보낸 문안이 통신사 스팸필터에 걸렸습니다.',
  '전하려는 내용은 그대로 두고, 걸릴 만한 표현만 바꿔 다시 씁니다.',
  '반드시 지킬 것:',
  '1. 날짜, 시각, 금액, 전화번호, 인터넷 주소, 매장 이름은 원문에 있는 그대로 씁니다. 한 글자도 바꾸지 않습니다.',
  '2. 원문에 없는 혜택이나 숫자를 만들지 않습니다. 할인율, 사은품, 무료 같은 말을 새로 넣지 않습니다.',
  '3. 퍼센트 기호를 감싼 낱말(예: %이름%)은 고객 정보가 들어갈 자리입니다. 그대로 두고 위치도 옮기지 않습니다.',
  '4. 원문과 길이가 비슷해야 합니다. 문장을 늘리지 않습니다.',
  '5. 다듬은 문안만 출력합니다. 설명, 인사, 따옴표를 붙이지 않습니다.',
].join('\n');

/**
 * 회차가 올라갈수록 **더 크게 바꾼다**(★Harold 2026-08-23 "1차 다듬기, 2차 중요내용 제외 문안 변경생성").
 *
 * ⛔ 순서를 뒤집지 마라. 2차를 더 보수적으로 쓰면 1차에서 걸린 문장이 거의 그대로 다시 나가
 *   세 번째 검사도 같은 이유로 걸린다. 한 번 걸린 표현을 조금 손봐서 통과할 리가 없다.
 * 중요 내용이 사라질 걱정은 프롬프트가 아니라 `checkRefined`가 막는다 — 날짜·시각·금액·전화번호·링크·변수를
 *   하나라도 잃으면 그 결과를 버린다. 그래서 2차는 나머지를 새로 써도 안전하다.
 */
const ROUND_RULES: Record<number, string> = {
  1: '표현만 손봅니다. 문장 순서와 구성은 그대로 두고, 광고처럼 읽히는 감탄 표현과 과장을 덜어 내 담백하게 씁니다.',
  2: [
    '한 번 다듬었는데도 걸렸습니다. 이번에는 **문장을 새로 씁니다.**',
    '원문에서 반드시 남길 것은 날짜, 시각, 금액, 전화번호, 인터넷 주소, 매장 이름, 퍼센트로 감싼 낱말입니다.',
    '그 밖의 문장은 순서와 표현을 자유롭게 바꿔 다시 구성합니다. 같은 뜻을 전하되 앞의 문장과 닮지 않게 씁니다.',
    '전하려는 용건(무엇을 언제 어디서 한다)은 그대로여야 합니다. 새 내용을 보태지 않습니다.',
  ].join('\n'),
};

export function buildRefinePrompt(original: string, round: number): { system: string; user: string } {
  const rule = ROUND_RULES[round] || ROUND_RULES[2];
  return {
    system: `${BASE_RULES}\n${rule}`,
    user: `아래 문안을 다듬어 주세요.\n\n${original}`,
  };
}

// ────────────── 호출 ──────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

export interface RefineResult {
  ok: boolean;
  content?: string;
  reason?: string;
}

/**
 * 스팸 차단된 문안을 한 번 다듬는다. 검사에 걸리면 **버린다**(잘못 다듬느니 안 다듬는 게 낫다).
 *
 * @param original 다듬을 원문(치환 전 문안). 검사 기준선도 이 값이다
 * @param round    이번이 몇 번째 다듬기인가(1 또는 2)
 * @param callModel 테스트 주입
 */
export async function refineForSpam(opts: {
  companyId: string;
  original: string;
  round: number;
  callModel?: (system: string, user: string) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}): Promise<RefineResult> {
  const original = String(opts.original || '').trim();
  if (!original) return { ok: false, reason: 'empty-original' };

  const { system, user } = buildRefinePrompt(original, opts.round);
  const call = opts.callModel || callAnthropic;

  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const r = await call(system, user);
    text = String(r.text || '').trim();
    inputTokens = r.inputTokens;
    outputTokens = r.outputTokens;
  } catch (err: any) {
    await recordAiCall({ companyId: opts.companyId, source: AGENCY_REFINE_SOURCE, modelType: 'sonnet', success: false });
    return { ok: false, reason: `model-error:${err?.message || 'unknown'}` };
  }
  // 과금 0. 원가만 기록한다
  await recordAiCall({
    companyId: opts.companyId, source: AGENCY_REFINE_SOURCE, modelType: 'sonnet',
    inputTokens, outputTokens, costWon: 0,
  });

  const check = checkRefined(original, text);
  if (!check.ok) {
    console.warn(`[agency-send][refine] 다듬은 문안을 버렸다: ${check.reason}`);
    return { ok: false, reason: check.reason };
  }
  return { ok: true, content: text };
}

async function callAnthropic(system: string, user: string) {
  const modelId = AI_MODELS.claude;
  const adaptiveGuard: any = isAdaptiveOnlyModel(modelId) ? { thinking: { type: 'disabled' } } : {};
  const response: any = await anthropic.messages.create({
    model: modelId,
    max_tokens: 1200,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } } as any],
    messages: [{ role: 'user', content: user }],
    ...adaptiveGuard,
  } as any);
  const text = (response.content || []).find((b: any) => b?.type === 'text')?.text || '';
  const usage = response.usage || {};
  return {
    text,
    inputTokens: Number(usage.input_tokens || 0) + Number(usage.cache_read_input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
  };
}
