/**
 * agency-send-refine.ts — 대행발송 문안 다듬기 (★ 2026-08-22 신설)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §3(불변 8) · §4-4(워커 A·B).
 *
 * 스팸필터에 걸린 문안을 다시 쓴다. **고객이 보낸 문안을 우리가 대신 고치는 것**이라
 * 문안 생성(generateMessages)과 규칙이 다르다:
 *   - 새로 짓는 게 아니라 **바꿔 쓴다.** 원문에 없던 내용이 들어오면 그 결과를 버린다.
 *   - 날짜·시각·금액·전화번호·주소는 **글자 그대로 남아야 한다.** 행사 날짜가 하루 밀리면 그건 다른 발송이다.
 *   - 혜택은 원문에 있는 것만. 판정은 공용 CT(`findInventedBenefits` · 값 · 종류 짝)에 맡긴다.
 *
 * 회차별 세기(설계서 §4-4 A):
 *   1회차 = 표현을 폭넓게 다듬는다. 2회차 = 핵심을 건드리지 않고 **표현만 최소 수정**.
 *
 * 과금 = 0. `CREDIT_COST_MAP`에 등록하지 않는다(미등록 source = 0, 과금 코드 변경 0 · Harold 확정 §8-1).
 *   기록만 `ai_call_log`에 `agency-send-refine`으로 남겨 원가를 잰다.
 */
import Anthropic from '@anthropic-ai/sdk';
import { composeVoicePrompt } from './brand-voice-prompt';
import { resolveCopyIntent } from './copy-content-type';
import { rewriteShapeDrift } from './copy-shape';
import { AI_MODELS, claudeRequestShape } from '../config/defaults';
import { findNewNumbers, findLostNumbers, findInventedBenefits, claimsInventedEfficacy, EFFICACY_REWRITE_RULE } from './copy-benefit-detector';
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
  if (findInventedBenefits(text, original).length > 0) {
    return { ok: false, reason: 'benefit-invented' };
  }

  // ③ 원문에 없던 숫자(★ 2026-09-30 WP2 — "90분 안에" · "3일 한정" 같은 조건은 혜택 낱말 없이도 약속이 된다. 지시 2번을 기계로도 본다)
  const invented = findNewNumbers(text, original);
  if (invented.length > 0) return { ok: false, reason: `number-invented:${invented.slice(0, 3).join(',')}` };

  // ④ ★ 2026-10-24 세 채널 구조체크 ② — 원문에 없던 효능 단정(같은 근거)
  if (claimsInventedEfficacy(text, original)) return { ok: false, reason: 'efficacy-invented' };

  // ⑤ ★ 2026-11-26 C164(설계서 docs/2026-11-25-spam-diag-rewrite-design.md §6-2) — 원문의 숫자가 사라졌는가(혜택 숫자 · 이번 달 조건을 지운 다듬기 = 다른 발송 · 같은 숫자 여러 번이면 개수까지)
  const gone = findLostNumbers(original, text);
  if (gone.length > 0) return { ok: false, reason: `number-lost:${gone.slice(0, 3).join(',')}` };

  return { ok: true };
}

// ────────────── 프롬프트 ──────────────

const BASE_RULES = [
  '당신은 문자 발송 문안을 다듬는 사람입니다. 고객사가 보낸 문안이 통신사 스팸필터에 걸렸습니다.',
  '전하려는 내용은 그대로 두고, 걸릴 만한 표현만 바꿔 다시 씁니다.',
  '반드시 지킬 것:',
  '1. 날짜, 시각, 금액, 전화번호, 인터넷 주소, 매장 이름은 원문에 있는 그대로 씁니다. 한 글자도 바꾸지 않습니다.',
  '2. 원문에 없는 혜택이나 숫자를 만들지 않습니다. 할인율, 사은품, 무료 같은 말을 새로 넣지 않습니다.',
  EFFICACY_REWRITE_RULE,
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

/** 고칠 줄만 보낼 때(C164 §6-2)의 덧붙임 규칙 — 줄마다 번호를 붙여 보내고 같은 번호 · 같은 줄 수로 받는다 */
const NUMBERED_RULE = '6. 줄마다 앞에 대괄호 번호가 있습니다. 받은 번호를 그대로 붙여 같은 수의 줄을 돌려줍니다. 줄을 합치거나 나누거나 빼지 않고, 번호 없는 줄을 보태지 않습니다.\n'
  + '7. <<URL1>> 같은 표시는 주소가 들어갈 자리입니다. 글자 그대로 그 줄에 두고, 지우거나 고치거나 다른 줄로 옮기지 않습니다. 주소를 직접 쓰지 않습니다.';
/**
 * 주소 꼴(스킴 · www · 도메인.xx 가 든 덩어리 · 메일 주소 포함) — 고칠 줄만 보낼 때 자리표시로 가린다(★ Codex 구현 1R · 2R 같은 부류 두 번 = 구조 답).
 *   주소를 뽑아 앞뒤를 견주는 방식은 정규식이 못 읽는 꼴(스킴 없는 www · 대소문자 · 줄 사이 맞바꿈)마다 샜다 → AI 가 주소를 아예 보지 못하게 하고 받은 자리표시에 원래 글자를 되돌린다.
 *   넓게 잡아 주소가 아닌 덩어리가 가려져도 그 글자가 그대로 남을 뿐이다.
 */
const URLISH_RE = /(?:https?:\/\/|www\.)[^\s]+|[^\s]*[0-9A-Za-z가-힣]\.[A-Za-z]{2,}[^\s]*/gi;
const URL_MARK_RE = /<<URL\d+>>/g;
/** 자리표시의 꺾쇠 쌍 — 이것이 든 줄은 고칠 줄로 보내지 않고 · 되돌린 줄에 남으면 버린다 */
const ANGLE_PAIR_RE = /<<|>>/;

export function buildRefinePrompt(original: string, round: number, avoid: ReadonlyArray<string> = [], editable?: ReadonlyArray<string>): { system: string; user: string } {
  const rule = ROUND_RULES[round] || ROUND_RULES[2];
  // ★ 2026-11-26 C164(설계서 docs/2026-11-25-spam-diag-rewrite-design.md §6-2) — 피할 표현 = 기록으로 좁힌 의심 조각(숫자 · 주소는 넣지 않는다 · spam-block-hint isRewordable) · 이번에는 다른 말로
  const avoidLine = avoid.length > 0 ? `\n\n특히 아래 표현이 걸렸을 수 있습니다. 이 표현은 같은 뜻의 다른 말로 바꿉니다: ${avoid.join(', ')}` : '';
  if (editable) {
    return {
      system: `${BASE_RULES}\n${NUMBERED_RULE}\n${rule}`,
      user: `아래는 문안에서 고칠 수 있는 줄입니다. 번호를 붙인 채 다듬어 주세요.${avoidLine}\n\n${editable.map((l, i) => `[${i + 1}] ${l}`).join('\n')}`,
    };
  }
  return {
    system: `${BASE_RULES}\n${rule}`,
    user: `아래 문안을 다듬어 주세요.${avoidLine}\n\n${original}`,
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
  /** 피할 표현(★ 2026-11-26 C164 — 기록으로 좁힌 의심 조각 · 다른 말로 바꿔 달라고 한다) */
  avoid?: ReadonlyArray<string>;
  /** ★ 2026-11-26 C164 §6-2 — 고칠 줄(original 의 줄 위치). 주면 그 줄만 바깥 요청에 싣고 돌아온 줄을 그 자리에 넣는다(나머지 줄은 글자 그대로) · 검사는 글 전체 기준 */
  editable?: ReadonlyArray<number>;
  /** 원가 기록 이름(기본 = 대행 다듬기) */
  source?: string;
  callModel?: (system: string, user: string) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}): Promise<RefineResult> {
  // 고칠 줄 위치는 받은 글 그대로의 줄 번호다 → 그때는 앞뒤 공백을 떼지 않는다
  const original = opts.editable ? String(opts.original || '') : String(opts.original || '').trim();
  if (!original.trim()) return { ok: false, reason: 'empty-original' };
  const lines = original.split('\n');
  // 자리표시(<<URLn>>)와 같은 꺾쇠 쌍이 든 줄은 보내지 않고 그대로 둔다(★ Codex 구현 3R · 4R · 5R 같은 부류 세 번 = 구조 답) —
  //   고객 글의 꺾쇠와 자리표시가 한 줄에 섞이면 되돌린 뒤 남은 자리표시를 꼴 · 개수로는 가려낼 수 없다. 섞이지 않게 하면 「되돌린 줄에 꺾쇠 쌍이 남았다 = 못 되돌린 자리표시」가 된다.
  const at = opts.editable ? opts.editable.filter((i) => typeof lines[i] === 'string' && !ANGLE_PAIR_RE.test(lines[i])) : null;
  const picked = at ? at.map((i) => lines[i]) : null;
  if (picked && (picked.length === 0 || picked.some((l) => !l.trim()))) return { ok: false, reason: 'no-editable' };
  // 고칠 줄의 주소는 자리표시로 가린다(바깥 요청에 주소 0 · 돌아온 자리표시에 원래 글자를 되돌린다)
  const held: string[] = [];
  const masked = picked ? picked.map((l) => l.replace(URLISH_RE, (m) => { held.push(m); return `<<URL${held.length}>>`; })) : null;
  const source = opts.source || AGENCY_REFINE_SOURCE;

  // 피할 표현에 주소 꼴이 섞여 오면 뺀다(★ Codex 구현 3R — 본문에서 가린 주소가 이 목록으로 바깥 요청에 실리지 않게)
  const avoid = (opts.avoid || []).filter((t) => !(String(t).match(URLISH_RE) || []).length);
  const built = buildRefinePrompt(original, opts.round, avoid, masked || undefined);
  // ★ 2026-10-28 AI 메모리 설계 K11-1 — 대행 스팸 회피 = 고치기(예시 0 · 원문 꼴 유지 · 평문 출력) · 성격 = 원문 광고 표기
  const { system } = await composeVoicePrompt({
    companyId: opts.companyId, producer: 'agency-spam-refine', mode: 'rewrite',
    kind: resolveCopyIntent({ isAd: /\(광고\)/.test(original) }).kind, basePrompt: built.system,
    outputFormat: picked ? '[출력 다시 확인] 번호가 붙은 줄만, 받은 줄 수 그대로 평문으로 출력한다.' : '[출력 다시 확인] 다듬은 문안 본문만 평문으로 출력한다.',
  });
  const user = built.user;
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
    await recordAiCall({ companyId: opts.companyId, source, modelType: 'sonnet', success: false });
    return { ok: false, reason: `model-error:${err?.message || 'unknown'}` };
  }
  // 과금 0. 원가만 기록한다
  await recordAiCall({
    companyId: opts.companyId, source, modelType: 'sonnet',
    inputTokens, outputTokens, costWon: 0,
  });

  // ★ 2026-10-28 K11-1 고치기 출구 대조 — 원문 꼴(줄바꿈 · 빈 줄 · 기호)이 무너진 안은 버린다(I12)
  let after: string[] | null = null;
  if (picked) {
    // 번호 1 ~ n 이 한 번씩 · 번호 없는 줄 0 일 때만 받는다 → 보낸 글의 그 줄 자리에 넣는다(고정 줄은 글자 그대로)
    const got = new Map<number, string>();
    const rows = text.split('\n').filter((l) => l.trim());
    for (const l of rows) {
      const m = /^\s*\[(\d+)\]\s*(.*\S)\s*$/.exec(l);
      if (!m || got.has(Number(m[1]))) { got.clear(); break; }
      got.set(Number(m[1]), m[2]);
    }
    if (rows.length !== picked.length || got.size !== picked.length || picked.some((_l, i) => !got.has(i + 1))) {
      console.warn('[agency-send][refine] 다듬은 줄을 버렸다: line-mismatch');
      return { ok: false, reason: 'line-mismatch' };
    }
    const raw = picked.map((_l, i) => got.get(i + 1)!);
    // 자리표시는 받은 줄마다 보낸 줄과 같은 것이 같은 순서로 있어야 한다(지움 · 다른 줄로 옮김 · 직접 쓴 주소 = 버림)
    const marksOf = (l: string) => (l.match(URL_MARK_RE) || []).join(' ');
    if (raw.some((l, i) => marksOf(l) !== marksOf(masked![i]))) {
      console.warn('[agency-send][refine] 다듬은 줄을 버렸다: url-moved');
      return { ok: false, reason: 'url-moved' };
    }
    after = raw.map((l) => l.replace(URL_MARK_RE, (m) => held[Number(m.slice(5, -2)) - 1]));
    // ★ Codex 구현 3R — 되돌린 줄의 주소 꼴이 가리기 전과 글자 그대로 같아야 한다(자리표시에 글자를 붙여 「…/sale에서」가 되거나 · 자리표시는 두고 새 주소를 덧붙인 답 = 버림)
    // 되돌린 줄에 꺾쇠 쌍이 남았다 = 못 되돌린 자리표시(「<<URL>>」 · 「<<url>>」 · 덜 닫힌 꼴 …) — 보낸 줄에는 자리표시 말고 꺾쇠 쌍이 없었다
    const urlsOf = (l: string) => (l.match(URLISH_RE) || []).join(' ');
    if (after.some((l, i) => ANGLE_PAIR_RE.test(l) || urlsOf(l) !== urlsOf(picked[i]))) {
      console.warn('[agency-send][refine] 다듬은 줄을 버렸다: url-moved');
      return { ok: false, reason: 'url-moved' };
    }
    const out = [...lines];
    at!.forEach((n, i) => { out[n] = after![i]; });
    text = out.join('\n');
  }
  // 고칠 줄만 바꾼 글 = 원문에 없던 주소 · 번호 · 날짜 · 시각 · 변수 칸이 생겨도 버린다(사라진 것은 checkRefined ① · 지어낸 주소가 판 · 짧은 주소로 가지 않게 · C164 설계서 §0)
  if (picked) {
    const had = extractAnchors(original);
    const added = [...extractAnchors(text)].filter((x) => !had.has(x));
    if (added.length > 0) {
      console.warn('[agency-send][refine] 다듬은 줄을 버렸다: anchor-added');
      return { ok: false, reason: `anchor-added:${added.slice(0, 3).join(',')}` };
    }
  }
  const drift = picked && after ? rewriteShapeDrift(picked.join('\n'), after.join('\n')) : rewriteShapeDrift(original, text);
  const check = drift.length > 0 ? { ok: false as const, reason: `shape-drift:${drift.join(',')}` } : checkRefined(original, text);
  if (!check.ok) {
    console.warn(`[agency-send][refine] 다듬은 문안을 버렸다: ${check.reason}`);
    return { ok: false, reason: check.reason };
  }
  return { ok: true, content: text };
}

async function callAnthropic(system: string, user: string) {
  const modelId = AI_MODELS.claude;
  const adaptiveGuard: any = claudeRequestShape(modelId);   // 모델별 생각 끄기 형태
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
