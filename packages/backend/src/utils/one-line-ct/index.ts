/**
 * one-line-ct — 한줄 프롬프트 CT(두뇌 · 설계서 docs/2026-10-22-oneline-ct-design.md §2 · §11)
 *
 * 다섯 단계: ① 듣기(규칙 · 한 줄 사실) → ② 판단(구성 고르기 · AI 1회 · 2크레딧) → ③ 진단(구성 칸표 대조 · 코드)
 *           → ④ 채우기 도움(회사 사실 · 몰 · 페이지 읽기 · 화면) → ⑤ 요리(재료 + 문구 AI → 구성 5종 조립).
 * 모든 입구(모바일DM · 이메일 · 인앱)가 이 모듈 함수만 부른다. AI 호출은 `./ai.ts` 한 곳.
 *
 * ⛔ 돈
 *   - 판단 2 = 한 줄당 오늘 · 어제 한 번(키 = 문자 입구와 같은 aio-base · 원천 oneline-judge) · AI 성공 뒤에만 정산.
 *   - 두뇌 실패 · 하루 상한 초과 · 잔액 부족 = 규칙 판단(0원 · source 'rule').
 *   - 요리 금액(합계 15 · 다시 3)은 `line-steps-context.ts` resolveLineStepsCharge 한 곳.
 */
import { randomUUID } from 'crypto';
import { getBrandBasicInfo } from '../brand-basic-info';
import { checkCredit, deductCreditOutcome, InsufficientCreditError } from '../ai-credit';
import { runInCreditBundle } from '../ai-credit-context';
import { aiLineBaseKeyOfFp } from '../ai-line';
import { takeDailyQuota, tryAcquireInflight, releaseInflight } from '../inflight-lock';
import { lineFpLockKey } from '../one-line-steps';
import {
  lineTermFacts, formatLinePeriodEnd, LINE_JUDGE_SOURCE, LINE_PRICE,
  type LineStep, type LineStepsPlan, type LineStepsPlanInput, type LineRichBody,
} from '../one-line-steps';
import { lineJudgeCovered } from '../line-steps-context';
import { withoutBenefitSpans } from '../copy-benefit-detector';
import { lineCopyExemplars, LineTemplateError } from '../line-template-run';
import {
  LINE_COMPOSITIONS, getLineComposition, composeRichDm, composeRichEmail, composeRichInapp, compositionGate, compositionFallbackCopy, compositionChannelSlots, diagnoseComposition, diagnosisBlocking,
  type LineComposition, type LineCompositionId, type LineRichMaterials, type LineRichCopy, type LineRichProduct,
} from '../line-compositions';
import { judgeLineWithAi, writeLineRichCopy, type LineCtDrafts, type LineCtGround } from './ai';
import { listenLine, type LineIntent } from './listen';
import type { LineMallCard } from '../line-mall-cards';
import type { LinePageMaterial } from '../line-template-page';
import type { Section } from '../dm/dm-section-registry';
import type { LineInAppMessage } from '../line-template-compose';

// ─────────────── ③ 진단 판(구성마다 재료 칸 · 순수) ───────────────

export interface LineCompositionPlan extends LineStepsPlan {
  composition: LineCompositionId;
}


/**
 * (순수) 구성 + 한 줄(① 의도) + 회사 사실 → 재료 칸 목록(화면 재료 판 · 칸마다 단계 · 묻는 말 · 채우는 방법).
 *   순서 = 첫 화면 → (비연동) 상품 페이지 주소 → 구성 칸 순서(③ 진단과 같은 채널 칸표) → 버튼 주소. 한 줄에서 찾은 값 = 제안 칩(기본값 0 · 1017 원칙).
 */
export function buildCompositionPlan(comp: LineComposition, input: LineStepsPlanInput, intent: LineIntent): LineCompositionPlan {
  const base: LineCompositionPlan = {
    v: 1, composition: comp.id, channel: input.channel, line_fp: input.lineFp, mall: input.mall,
    block: null, upload: input.upload, steps: [], later: [], offers: [], filled: {}, link_default: null, cost: input.cost,
  };
  if (input.channel === 'inapp' && input.inappBlocked) return { ...base, block: 'INAPP_DISPLAY_UNAVAILABLE' };
  const steps: LineStep[] = [];
  const typedUrl = intent.urls[0] ?? null;
  steps.push({ key: 'hero_photo', level: 'suggest', ask: '맨 위에 크게 세울 그림', why: '첫 화면이 결과를 좌우해요', fill: ['studio', 'upload'] });
  // 비연동 회사의 첫 칸 = 상품 · 행사 페이지 주소 하나(읽어서 표지 사진 · 문구를 채운다) · 한 줄에 주소를 쳤으면 그 주소
  if (typedUrl || !input.mall) steps.push({ key: 'event_page', ...(typedUrl ? { url: typedUrl } : {}), level: 'suggest', ask: '상품 · 행사 페이지 주소', why: '주소 하나면 사진과 문구를 읽어 채워요', fill: ['url'] });
  for (const slot of compositionChannelSlots(comp, input.channel)) {
    const meta = { level: slot.level, ask: slot.ask, why: slot.why, fill: slot.fill, ...(slot.level === 'block' ? { required: true } : {}) };
    if (slot.key === 'products') {
      const words = intent.productTerms;
      const terms = words.map((item) => ({ item, ...lineTermFacts(input.line, item, words.length) }));
      steps.push({ key: 'products', terms, min: slot.level === 'block' ? slot.min : 0, max: slot.max, ...meta });
    } else if (slot.key === 'benefit') {
      steps.push({ key: 'benefit', ...meta, ...(intent.benefit ? { suggest: intent.benefit } : {}) });
    } else if (slot.key === 'periodEnd') {
      steps.push({ key: 'period', ...meta, ...(intent.periodEnd ? { suggest: intent.periodEnd } : {}) });
    } else if (slot.key === 'points') steps.push({ key: 'points', min: slot.min, max: slot.max, ...meta });
    else if (slot.key === 'steps') steps.push({ key: 'usage', min: slot.min, max: slot.max, ...meta });
    else if (slot.key === 'mood') steps.push({ key: 'mood', min: slot.min, max: slot.max, ...meta });
    else if (slot.key === 'proof') steps.push({ key: 'proof', ...meta });
    else if (slot.key === 'couponCode') steps.push({ key: 'coupon_code', ...meta });
    else if (slot.key === 'store') steps.push({ key: 'store', ...meta });
  }
  if (typedUrl) base.filled.link = typedUrl;
  else if (input.website) base.link_default = { kind: 'website', url: input.website };
  else if (input.mallHome) base.link_default = { kind: 'mall_home', url: input.mallHome };
  else steps.push({ key: 'link', skip_if: 'product_link', level: 'suggest', ask: '버튼을 누르면 갈 주소', why: '비우면 편집 화면에서 넣어요', fill: ['url'] });
  return { ...base, steps };
}

/** 모든 구성의 재료 판(판단 카드 「바꾸기」 = 이 중 하나 · AI 0) */
export function buildCompositionPlans(input: LineStepsPlanInput, intent: LineIntent): Record<LineCompositionId, LineCompositionPlan> {
  return Object.fromEntries(LINE_COMPOSITIONS.map((c) => [c.id, buildCompositionPlan(c, input, intent)])) as Record<LineCompositionId, LineCompositionPlan>;
}

/** 화면에 싣는 구성 정보(이름 · 설명 · 색) */
export function compositionInfos(): Array<{ id: LineCompositionId; label: string; desc: string; primary: string }> {
  return LINE_COMPOSITIONS.map((c) => ({ id: c.id, label: c.label, desc: c.desc, primary: c.primary }));
}

// ─────────────── ② 판단(AI 1회 · 2크레딧 · 실패 = 규칙) ───────────────

export interface LineJudgeResult {
  pick: LineCompositionId;
  reason: string;
  source: 'ai' | 'rule';
  drafts: LineCtDrafts;
  /** 이번 판단으로 2크레딧을 냈는가 · 이 한 줄로 판단을 낸 적이 있는가(오늘 · 어제) */
  charged: boolean;
  paid: boolean;
  /** 규칙 판단으로 내려간 이유(화면 안내 한 줄) */
  note: 'NO_CREDIT' | 'DAILY_LIMIT' | 'AI_FAILED' | null;
}

/** 회사당 하루 AI 판단 상한(설계서 §11-3 · 시연 뒤 호출 기록으로 다시 정한다) */
export const LINE_JUDGE_DAILY_MAX = 60;
const JUDGE_TTL_MS = 24 * 3600_000;
const JUDGE_MAX = 500;
/** ponytail: 낸 판단 기억(프로세스 메모리 · 24시간 · 500) — 재기동 뒤 같은 한 줄은 다시 AI 를 부르되 다시 걷지 않는다(원장이 진실) */
const judged = new Map<string, { at: number; v: Omit<LineJudgeResult, 'charged'> }>();
function rememberJudge(key: string, v: Omit<LineJudgeResult, 'charged'>): void {
  judged.delete(key);
  judged.set(key, { at: Date.now(), v });
  while (judged.size > JUDGE_MAX) { const k = judged.keys().next().value; if (k === undefined) break; judged.delete(k); }
}

function ruleJudge(line: string, industry: string | null, note: LineJudgeResult['note'], paid: boolean): LineJudgeResult {
  // 판정 화면(gaps)의 추천과 같은 순위(① 듣기 · 업종 반영)
  const top = listenLine(line, { industry }).rank[0];
  const comp = getLineComposition(top.id)!;
  return { pick: top.id, reason: `${comp.label} 구성이 이 한 줄에 맞아요`, source: 'rule', drafts: {}, charged: false, paid, note };
}

export class LineJudgeBusyError extends Error { constructor() { super('LINE_JUDGE_BUSY'); } }

/**
 * 판단 — 같은 한 줄(지문) 동시 요청은 하나씩(409 · 화면이 잠시 뒤 다시) · 오늘 · 어제 낸 적이 있으면 0원(기억이 있으면 AI 도 0).
 *   원장 조회 실패는 던진다(호출부 503 · 모르는 납부를 0 으로 접지 않는다).
 */
export async function runLineJudge(input: {
  companyId: string; userId?: string; line: string; lineFp: string; productNames: string[]; nowMs?: number;
}): Promise<LineJudgeResult> {
  const nowMs = input.nowMs ?? Date.now();
  // 같은 한 줄의 결과물 생성(금액 확정 ~ 차감) · 문자 입구 판단 정산과 같은 잠금(Codex CT R1 · 합계 15 를 넘지 않게)
  const lock = lineFpLockKey(input.companyId, input.lineFp);
  if (!tryAcquireInflight(lock)) throw new LineJudgeBusyError();
  try {
    const basic = await getBrandBasicInfo(input.companyId).catch(() => null);
    const industry = String(basic?.industry_code || '') || null;
    const brandName = String(basic?.brand_name || basic?.company_name || '').trim().slice(0, 30);
    const paid = await lineJudgeCovered(input.companyId, input.lineFp, nowMs);
    const memKey = `${input.companyId}:${input.lineFp}`;
    const hit = judged.get(memKey);
    if (paid && hit && nowMs - hit.at < JUDGE_TTL_MS) return { ...hit.v, charged: false, paid: true };
    if (!takeDailyQuota(`line-judge:${input.companyId}`, LINE_JUDGE_DAILY_MAX, nowMs)) return ruleJudge(input.line, industry, 'DAILY_LIMIT', paid);
    if (!paid) {
      try { await checkCredit(input.companyId, LINE_PRICE.judge); } catch (e) {
        if (e instanceof InsufficientCreditError) return ruleJudge(input.line, industry, 'NO_CREDIT', false);
        throw e;
      }
    }
    const ground: LineCtGround = { line: input.line, brandName, industry, productNames: input.productNames };
    let ai: Awaited<ReturnType<typeof judgeLineWithAi>>;
    try {
      ai = await runInCreditBundle(() => judgeLineWithAi(ground, { companyId: input.companyId, userId: input.userId, source: LINE_JUDGE_SOURCE }));
    } catch {
      return ruleJudge(input.line, industry, 'AI_FAILED', paid);
    }
    // 목록 안 구성을 고르지 못한 답(빈 객체 · 목록 밖) = 판단을 받지 못한 것 → 규칙 판단 · 0원(Codex CT R1)
    if (!ai.pick) return ruleJudge(input.line, industry, 'AI_FAILED', paid);
    const pick = ai.pick;
    const reason = ai.reason || `${getLineComposition(pick)!.label} 구성이 이 한 줄에 맞아요`;
    let charged = false;
    // 정산 직전 = 그 순간의 오늘 · 어제 납부를 다시 본다(AI 를 기다리는 사이 자정 · 다른 입구 정산)
    const paidNow = paid || await lineJudgeCovered(input.companyId, input.lineFp, Date.now());
    if (!paidNow) {
      // 성공 뒤 정산 · 키 = 문자 입구와 같은 aio-base(오늘) · 동시 소진 = 402 를 던진다(결과를 건네지 않는다)
      //   결말 = 냄 · 같은 키로 이미 냄 → 낸 것 · 크레딧제 미적용(시연 회사 등) → 걷지 않음 · 원장 쓰기 실패 → 결과를 건네지 않는다(규칙 판단 0원 · 미과금 AI 결과 0)
      const outcome = await deductCreditOutcome({ companyId: input.companyId, cost: LINE_PRICE.judge, source: LINE_JUDGE_SOURCE, idempotencyKey: aiLineBaseKeyOfFp(input.companyId, input.lineFp, new Date()), createdBy: input.userId, throwOnInsufficient: true });
      if (outcome === 'failed') return ruleJudge(input.line, industry, 'AI_FAILED', false);
      charged = outcome === 'deducted';
    }
    const v: Omit<LineJudgeResult, 'charged'> = { pick, reason, source: 'ai', drafts: ai.drafts, paid: true, note: null };
    rememberJudge(memKey, v);
    return { ...v, charged };
  } finally {
    releaseInflight(lock);
  }
}

// ─────────────── ⑤ 요리(재료 확정 + 문구 AI + 조립) ───────────────

export interface LineCookInput {
  composition: LineComposition;
  channel: 'dm' | 'email' | 'inapp';
  companyId: string;
  /** 사용자가 친 한 줄(사진 조각 면허 적용 뒤) */
  line: string;
  brandName: string;
  logoUrl: string | null;
  csPhone: string | null;
  pinnedPrimary: string | null;
  /** 몰 상품(재조회 ok) + 직접 넣은 상품(사진 있음) · 종류는 직접 넣은 순서대로 */
  cards: readonly LineMallCard[];
  cardCategories?: ReadonlyArray<string | null>;
  heroUpload: string | null;
  heroAsIs: boolean;
  proof: ReadonlyArray<{ body: string; author: string; rating: number }>;
  page: LinePageMaterial | null;
  benefitAnswer: string | null | undefined;
  periodEnd: string | null;
  link: string | null;
  rich: LineRichBody;
}

export interface LineCookDraft {
  comp: LineComposition;
  materials: LineRichMaterials;
  copy: LineRichCopy;
}

/** 요리 실패 = 템플릿 실패와 같은 모양(라우트가 같은 catch 로 상태 · 코드 · 문장을 돌려준다 · 차감 전) */
export class LineCookError extends LineTemplateError {}

/** (순수) 직접 넣은 상품 → 카드(사진 있는 것만 · 구성은 글 상품을 싣지 않는다) + 같은 순서의 종류 */
export function lineCookManual(rows: ReadonlyArray<{ name: string; price?: number; image?: string; url?: string }>, categories: ReadonlyArray<string | null>): { cards: LineMallCard[]; categories: Array<string | null> } {
  const cards: LineMallCard[] = [];
  const cats: Array<string | null> = [];
  rows.forEach((r, i) => {
    if (!r.image) return;
    cards.push({ name: r.name, price: r.price ?? 0, image_url: r.image, ...(r.url ? { link_url: r.url } : {}) });
    cats.push(categories[i] ?? null);
  });
  return { cards, categories: cats };
}

/** (순수) 재료 확정 — 회사 주색이 있으면 구성 주색을 바꾼 사본 */
export function lineCookMaterials(input: LineCookInput): { comp: LineComposition; materials: LineRichMaterials } {
  const comp = input.pinnedPrimary ? { ...input.composition, primary: input.pinnedPrimary } : input.composition;
  const benefit = typeof input.benefitAnswer === 'string' ? input.benefitAnswer.trim() : '';
  const posterUrl = input.heroUpload || input.page?.banner || null;
  const products: LineRichProduct[] = input.cards.map((c, i) => ({
    name: c.name, price: c.price > 0 ? c.price : null,
    ...(c.discount_price ? { discount_price: c.discount_price } : {}),
    image_url: c.image_url, ...(c.link_url ? { link_url: c.link_url } : {}),
    category: input.cardCategories?.[i] ?? null,
  }));
  const pt = (p: LineRichBody['points'][number]) => ({ title: p.title, body: p.body, ...(p.image ? { image_url: p.image } : {}) });
  const materials: LineRichMaterials = {
    brandName: input.brandName,
    ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
    ...(input.csPhone ? { csPhone: input.csPhone } : {}),
    poster: posterUrl ? { url: posterUrl, ...(input.heroAsIs && posterUrl === input.heroUpload ? { asIs: true } : {}) } : null,
    products,
    points: input.rich.points.map(pt),
    steps: input.rich.usage.map(pt),
    mood: input.rich.mood,
    proof: input.proof.map((r) => ({ ...r })),
    benefit: benefit || null,
    benefitNote: input.rich.benefitNote,
    couponCode: input.rich.couponCode,
    periodEnd: input.periodEnd,
    periodLabel: input.periodEnd ? `${formatLinePeriodEnd(input.periodEnd)}까지` : null,
    link: input.link,
    store: input.rich.store,
  };
  return { comp, materials };
}

/** 문구 AI 1회(호출부가 `runInCreditBundle` 안에서 부른다 · 실패 = 던짐 · 차감 전) · 근거 = 혜택 자리를 뺀 한 줄(값 = 코드 · B-1018-1) */
export async function draftLineCook(input: LineCookInput, ai: { userId?: string; source: string }): Promise<LineCookDraft> {
  const { comp, materials } = lineCookMaterials(input);
  // 필수 칸 = 실제로 조립되는 재료로 판정(사진 없는 상품 · 몰에서 빠진 상품은 세지 않는다 · 화면 판정과 같은 기준 · AI · 차감 전 · Codex CT R1)
  const missing = diagnosisBlocking(diagnoseComposition(comp, materials, input.channel));
  if (missing.length > 0) throw new LineCookError(400, 'LINE_COMPOSITION_MISSING', `${missing.map((s) => s.ask).join(' · ')}이(가) 있어야 이 구성을 만들 수 있어요. 크레딧은 쓰지 않았어요.`, missing.map((s) => s.key).join(','), missing.map((s) => s.step));
  const ground: LineCtGround = { line: withoutBenefitSpans(input.line), brandName: input.brandName, industry: null, productNames: materials.products.map((p) => p.name) };
  try {
    const r = await writeLineRichCopy(comp, ground, { companyId: input.companyId, userId: ai.userId, source: ai.source, exemplars: await lineCopyExemplars(input.companyId, input.channel) });
    return { comp, materials, copy: r.copy };
  } catch (err: any) {
    throw new LineCookError(503, 'LINE_TEMPLATE_AI_FAILED', '문구를 만들지 못했어요. 크레딧은 쓰지 않았어요. 잠시 뒤 다시 만들어 주세요.', String(err?.message || ''));
  }
}

function gateOrThrow(comp: LineComposition, sections: readonly Section[]): void {
  const bad = compositionGate(sections);
  if (bad.length > 0) throw new LineCookError(500, 'LINE_TEMPLATE_GATE', '완성본을 조립하지 못했어요. 크레딧은 쓰지 않았어요.', `${comp.id}: ${bad.join(' · ')}`);
}

export function buildLineCookDm(d: LineCookDraft): { sections: Section[]; pages: Section[][]; brandKitPatch: { primary_color: string; accent_color: string } } {
  const r = composeRichDm(d.comp, d.materials, d.copy, () => randomUUID());
  gateOrThrow(d.comp, r.sections);
  return r;
}
export function buildLineCookEmail(d: LineCookDraft): { sections: Section[]; subject: string; preheader: string } {
  const r = composeRichEmail(d.comp, d.materials, d.copy, () => randomUUID());
  gateOrThrow(d.comp, r.sections);
  return r;
}
export function buildLineCookInapp(d: LineCookDraft): LineInAppMessage {
  return composeRichInapp(d.comp, d.materials, d.copy);
}

/** 구성 DM 표식(편집 화면이 템플릿 DM 처럼 다룬다 · 장 키 없음 = 세로 한 페이지) */
export const lineCompositionDmMarker = (id: LineCompositionId): string => `line:c-${id}`;

/** (순수) 미리보기 문구 — AI 0 · 기본 문구(재료 판 미리보기 · 시안) */
export function previewCopy(comp: LineComposition): LineRichCopy {
  return compositionFallbackCopy(comp);
}

export { getLineComposition, isLineCompositionId } from '../line-compositions';
export type { LineCtDrafts } from './ai';
export { listenLine, type LineIntent } from './listen';
/** 시험 전용 — 판단 기억 비우기 */
export function _resetLineJudgeMemory(): void { judged.clear(); }
