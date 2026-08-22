/**
 * help-answer.ts — 도움말 봇 답변 조립 CT (★ 2026-08-22 신설)
 *
 * 설계 = docs/FEATURE-HELP-CATALOG.md §4-5. 호출부 = routes/help.ts 하나.
 *
 * 환각 차단 4겹 (프롬프트 지시가 아니라 **코드 출구**다)
 *   1. 폐집합 매칭 — 카탈로그에서 후보를 못 찾으면 **모델을 부르지 않는다.** 지어낼 재료가 없다.
 *   2. 컨텍스트 = 후보 작업 3개의 공개 필드뿐. 내부 문서·화면 문구·FEATURE-*.md는 넣지 않는다.
 *   3. 출구 검사 — 응답 안 모든 `/경로`가 카탈로그 진입 경로 집합에 있는지 · 혜택 토큰(%·원·쿠폰·무료)이 없는지 ·
 *      모델명이 없는지. 하나라도 걸리면 답변을 버리고 1번 응답(후보 카드만)으로 되돌린다.
 *   4. 요금제 문구는 모델이 쓰지 않는다 — 라우트가 `canUseFeature`로 판정해 `locked`를 붙이고 화면이 우리 문자열로 그린다.
 *
 * 과금 = 무료. `CREDIT_COST_MAP`에 등록하지 않는다(미등록 source = 0). 기록만 `ai_call_log`에 `help-ask`로 남긴다(원가 실측).
 * 남용 방지 = 매칭 실패는 호출 전 거절 · 캐시(5분) · 회사당 일 30회·분 3회(초과 시 잠그지 않고 후보 카드만) · 입력 240자.
 */
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS, isAdaptiveOnlyModel } from '../config/defaults';
import { FEATURE_CATALOG, toPublicJob, normalizePath, type FeatureJob, type PublicFeatureJob } from '../content/feature-catalog';
import { detectBenefits } from './copy-benefit-detector';
import { generateCacheKey, getCachedResponse, setCachedResponse } from './ai-cache';
import { recordAiCall } from './ai-rate-limit';

export const HELP_SOURCE = 'help-ask';
export const HELP_MAX_QUESTION = 240;
export const HELP_DAILY_LIMIT = 30;
export const HELP_MINUTE_LIMIT = 3;
/** 이 점수 미만이면 "모른다"로 끝낸다(모델 호출 0) */
export const HELP_MATCH_THRESHOLD = 3;

// ────────────── 1. 폐집합 매칭 ──────────────

const norm = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, '');

export interface MatchHit { job: FeatureJob; score: number }

/**
 * 키워드·제목·목적·현재 화면으로 점수를 매긴다. 임베딩을 쓰지 않는다 — 항목이 수십 개라 순회가 더 싸고,
 * "정의를 고쳤는데 벡터가 낡음"이라는 새 실패 모드를 들이지 않는다.
 */
export function matchJobs(question: string, currentPath?: string | null, catalog: readonly FeatureJob[] = FEATURE_CATALOG): MatchHit[] {
  const q = norm(question);
  if (!q) return [];
  const path = currentPath ? normalizePath(currentPath) : null;
  const hits: MatchHit[] = [];
  for (const job of catalog) {
    let score = 0;
    // 키워드 전체 일치 = 가장 강한 신호
    for (const k of job.keywords) {
      const nk = norm(k);
      if (nk && q.includes(nk)) score += 4;
    }
    const nt = norm(job.title);
    if (nt && q.includes(nt)) score += 4;
    // 낱말 단위(키워드·제목의 조각). 활용형("보내요"·"보내는")은 어간(끝 글자를 뺀 형태)으로 한 번 더 본다.
    // 같은 낱말이 여러 키워드에 겹쳐도 한 번만 센다 — 키워드 수로 점수가 부풀지 않게.
    const tokens = new Set<string>();
    for (const k of [...job.keywords, job.title]) for (const w of k.split(/\s+/)) { const nw = norm(w); if (nw.length >= 2) tokens.add(nw); }
    for (const tok of tokens) {
      if (q.includes(tok)) score += 2;
      else if (tok.length >= 3 && q.includes(tok.slice(0, tok.length - 1))) score += 1;
    }
    if (path && job.entry.path === path) score += 1;
    if (score > 0) hits.push({ job, score });
  }
  hits.sort((a, b) => b.score - a.score || (a.job.status === b.job.status ? 0 : a.job.status === 'ready' ? -1 : 1));
  return hits;
}

// ────────────── 2. 프롬프트 ──────────────

const SYSTEM_PROMPT = [
  '당신은 "한줄로" 서비스의 사용법 안내 도우미입니다. 사용자는 마케팅 담당자입니다.',
  '아래 [기능 정의]에 적힌 내용만으로 답합니다. 정의에 없는 기능·화면·버튼·조건을 말하지 않습니다.',
  '정의에 답이 없으면 "이 안내에는 없는 내용입니다"라고만 말하고 가장 가까운 기능 이름을 하나 권합니다.',
  '할인율·금액·쿠폰·무료 같은 혜택 수치를 만들지 않습니다. 요금제 이름이나 가격을 말하지 않습니다.',
  '화면 경로는 [기능 정의]의 entry.path에 있는 것만 씁니다.',
  '한국어 존댓말, 5문장 이내, 긴 줄표·이모지·영어 약어 없이, 누를 것은 큰따옴표로 표시합니다.',
  '내부 시스템·모델·데이터베이스 이름을 말하지 않습니다.',
].join('\n');

export function buildHelpMessages(question: string, jobs: PublicFeatureJob[], currentPath?: string | null) {
  const defs = jobs.map((j) => ({
    id: j.id, title: j.title, goal: j.goal, entry: j.entry, steps: j.steps, blockers: j.blockers, related: j.related,
    status: j.status === 'stub' ? '본문 없음(제목·목적·시작 위치만 있음)' : '본문 있음',
  }));
  const user = [
    currentPath ? `[지금 보고 있는 화면] ${currentPath}` : '',
    `[질문] ${question}`,
    `[기능 정의] ${JSON.stringify(defs)}`,
  ].filter(Boolean).join('\n');
  return { system: SYSTEM_PROMPT, user };
}

// ────────────── 3. 출구 검사 ──────────────

const MODEL_NAME_RE = /opus|sonnet|haiku|gpt|claude|anthropic/i;

export interface ExitCheck { ok: boolean; reason?: string }

/** 응답 본문이 폐집합을 벗어났는가. 걸리면 답변을 버린다 */
export function checkAnswer(text: string, allowedPaths: Set<string>): ExitCheck {
  if (!text || !text.trim()) return { ok: false, reason: 'empty' };
  if (MODEL_NAME_RE.test(text)) return { ok: false, reason: 'model-name' };
  // 경로처럼 보이는 토큰 전부가 허용 집합 안이어야 한다
  const paths = text.match(/\/[a-z][a-z0-9-]*(?:\/[a-z0-9:-]+)*/gi) || [];
  for (const p of paths) {
    if (!allowedPaths.has(normalizePath(p))) return { ok: false, reason: `path:${p}` };
  }
  const benefits = detectBenefits(text);
  if (benefits.hasBenefit) return { ok: false, reason: `benefit:${benefits.tokens.join(',')}` };
  // 긴 줄표(U+2014)는 "AI 티 1순위"라 답변에서 막는다. 리터럴을 소스에 두면 줄표 불변식 테스트에 걸리므로 코드 포인트로 만든다
  if (text.includes(String.fromCharCode(0x2014))) return { ok: false, reason: 'dash' };
  return { ok: true };
}

export function allowedPathSet(catalog: readonly FeatureJob[] = FEATURE_CATALOG): Set<string> {
  return new Set(catalog.map((j) => j.entry.path));
}

// ────────────── 4. 호출 제한(도움말 전용 소한도) ──────────────

interface Bucket { day: string; dayCount: number; minute: number; minuteCount: number }
const buckets = new Map<string, Bucket>();

/** 초과하면 false. 잠그지 않고 호출부가 후보 카드만 돌려준다 */
export function takeHelpQuota(companyId: string, now: Date = new Date()): boolean {
  const day = now.toISOString().slice(0, 10);
  const minute = Math.floor(now.getTime() / 60000);
  const b = buckets.get(companyId) || { day, dayCount: 0, minute, minuteCount: 0 };
  if (b.day !== day) { b.day = day; b.dayCount = 0; }
  if (b.minute !== minute) { b.minute = minute; b.minuteCount = 0; }
  if (b.dayCount >= HELP_DAILY_LIMIT || b.minuteCount >= HELP_MINUTE_LIMIT) { buckets.set(companyId, b); return false; }
  b.dayCount += 1; b.minuteCount += 1;
  buckets.set(companyId, b);
  return true;
}

/** 테스트용 */
export function resetHelpQuota(): void { buckets.clear(); }

// ────────────── 5. 모델 호출 ──────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
const MAX_TOKENS = 600;

export interface HelpAnswer {
  answered: boolean;
  /** answered=false면 빈 문자열 */
  answer: string;
  /** 매칭된 작업(공개 필드). 화면이 카드로 그린다 */
  jobs: PublicFeatureJob[];
  /** 모델을 불렀는가(원가 실측·디버그) */
  usedModel: boolean;
  /** 거절 사유(내부 로그용) */
  reason?: string;
}

export async function answerHelpQuestion(opts: {
  companyId: string;
  question: string;
  currentPath?: string | null;
  catalog?: readonly FeatureJob[];
  /** 테스트 주입 */
  callModel?: (system: string, user: string) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}): Promise<HelpAnswer> {
  const catalog = opts.catalog || FEATURE_CATALOG;
  const question = String(opts.question || '').trim().slice(0, HELP_MAX_QUESTION);
  const hits = matchJobs(question, opts.currentPath, catalog);
  const top = hits.filter((h) => h.score >= HELP_MATCH_THRESHOLD).slice(0, 3);
  const fallbackJobs = hits.slice(0, 3).map((h) => toPublicJob(h.job));

  // 1겹: 폐집합 매칭 실패 = 모델 호출 0
  if (top.length === 0) return { answered: false, answer: '', jobs: fallbackJobs, usedModel: false, reason: 'no-match' };

  const jobs = top.map((h) => toPublicJob(h.job));
  if (!takeHelpQuota(opts.companyId)) return { answered: false, answer: '', jobs, usedModel: false, reason: 'quota' };

  const { system, user } = buildHelpMessages(question, jobs, opts.currentPath);
  // 답은 회사와 무관하다(요금제 판정은 라우트가 따로 붙인다) — 캐시를 전 회사가 공유한다
  const cacheKey = generateCacheKey('help-global', system, user);
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    const check = checkAnswer(cached, allowedPathSet(catalog));
    if (check.ok) return { answered: true, answer: cached, jobs, usedModel: false };
  }

  const call = opts.callModel || callAnthropic;
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const r = await call(system, user);
    text = r.text; inputTokens = r.inputTokens; outputTokens = r.outputTokens;
  } catch (err: any) {
    await recordAiCall({ companyId: opts.companyId, source: HELP_SOURCE, modelType: 'sonnet', success: false });
    return { answered: false, answer: '', jobs, usedModel: true, reason: `model-error:${err?.message || 'unknown'}` };
  }
  await recordAiCall({ companyId: opts.companyId, source: HELP_SOURCE, modelType: 'sonnet', inputTokens, outputTokens, costWon: 0 });

  // 3겹: 출구 검사
  const check = checkAnswer(text, allowedPathSet(catalog));
  if (!check.ok) return { answered: false, answer: '', jobs, usedModel: true, reason: `exit:${check.reason}` };

  setCachedResponse(cacheKey, text);
  return { answered: true, answer: text.trim(), jobs, usedModel: true };
}

async function callAnthropic(system: string, user: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const modelId = AI_MODELS.claude;
  const adaptiveGuard: any = isAdaptiveOnlyModel(modelId) ? { thinking: { type: 'disabled' } } : {};
  const response: any = await anthropic.messages.create({
    model: modelId,
    max_tokens: MAX_TOKENS,
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
