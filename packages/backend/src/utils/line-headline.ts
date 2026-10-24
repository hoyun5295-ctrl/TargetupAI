/**
 * line-headline.ts — 한 줄 콘텐츠의 전면 헤드라인 = 이미지 스튜디오 템플릿 3안 고르기 (★ 2026-10-21 · 설계서 docs/2026-10-21-oneline-content-design.md §3-4)
 *
 * Harold 「이미지스튜디오에서 해당 업체와 가장 비슷하고 한줄입력에서 가장 어울리는 템플릿을 활용해서 그걸 전면 헤드라인에」.
 * 고르기만 한다(0원 · 그림 생성은 화면이 스튜디오 생성 경로를 그대로 부른다 · 2크레딧은 그 경로가 성공 뒤 걷는다).
 *
 * ⛔ 불변
 *   - 후보 = 업종 풀(AI 영업과 같은 함수 · 달 · 장면 필터) · 상품 사진이 없으면 행사 템플릿만(누끼 없이 제품 템플릿 = 「문구만 든 배경」).
 *   - AI 1회(묶음 안 · 차감 0)로 순위 + 헤드라인 한 줄 · 목록 밖 id 는 버린다 · **해시 대체 금지** = AI 실패 시 풀 순서 그대로(source 'rule' · 화면이 갤러리를 먼저 연다).
 *   - 3안은 세부 분류가 서로 다르게(같은 그림 셋 방지).
 *   - 헤드라인 글 = 한 줄에 없는 숫자 · 혜택 0 · 16자 · 실패 = 한 줄 앞부분(그림 안 글자에 지어낸 값이 박히지 않게).
 */
import { callAIWithFallback } from '../services/ai';
import { runInCreditBundle } from './ai-credit-context';
import { templatePickCandidates, buildTemplateJudgePrompt, parseTemplatePick } from './sales-outreach-produce';
import { SUB_BY_ID } from './image-studio-template-subs';
import type { StudioTemplate } from './image-studio-templates';
import { withoutBenefitSpans, claimsEfficacy } from './copy-benefit-detector';
import { extractJsonFromAiText } from './ai-json';

export const LINE_HEADLINE_PICKS = 3;
export const LINE_HEADLINE_TITLE_MAX = 16;

export interface LineHeadlinePick {
  id: string;
  name: string;
  kind: 'product' | 'event';
  sub: string | null;
  useCase: string;
  /** 예시 그림(공개 샘플 · 「예시 그림」으로 보인다) */
  sampleUrl: string;
}

export interface LineHeadlineResult {
  picks: LineHeadlinePick[];
  /** 그림 안 헤드라인 글(한 줄 근거만) */
  title: string;
  /** ai = 모델이 골랐다 · rule = 모델 실패로 풀 순서(화면 = 갤러리 먼저) */
  source: 'ai' | 'rule';
}

/** (순수) 템플릿 → 고르기 카드 */
export function toLineHeadlinePick(t: StudioTemplate): LineHeadlinePick {
  return {
    id: t.id, name: t.name, kind: (t.kind ?? 'product') as 'product' | 'event', sub: SUB_BY_ID[t.id] || null, useCase: t.useCase,
    sampleUrl: t.exampleUrl || `/api/image-studio/template-sample/${t.id}`,
  };
}

/** (순수) 순위 id 들 → 세부 분류가 서로 다른 앞 3개(같은 분류만 남으면 그대로 채운다) */
export function diverseLineHeadlines(ids: readonly string[], byId: ReadonlyMap<string, StudioTemplate>): StudioTemplate[] {
  const list = ids.map((id) => byId.get(id)).filter((t): t is StudioTemplate => !!t);
  const out: StudioTemplate[] = [];
  const subs = new Set<string>();
  for (const t of list) {
    const s = SUB_BY_ID[t.id] || t.category;
    if (subs.has(s)) continue;
    subs.add(s);
    out.push(t);
    if (out.length >= LINE_HEADLINE_PICKS) return out;
  }
  for (const t of list) { if (out.length >= LINE_HEADLINE_PICKS) break; if (!out.includes(t)) out.push(t); }
  return out;
}

/** 그림 안 글자에 두지 않는 혜택 낱말(값은 본품 카드 · 혜택 띠 글자에만 · Codex P2 R1 high = 낱말별 대조는 「20% 할인」 교차 조합을 통과시킨다) */
const HEADLINE_BENEFIT_RE = /할인|세일|쿠폰|적립|무료|증정|사은품|경품|반값|특가|최저가|퍼센트|프로|[%％]|원(?![가-힣])/g;

/** 그림 안 글자 상한(헤드라인 · 말머리) */
export const LINE_HEADLINE_LABEL_MAX = 12;

/** (순수) 그림 안 글자로 쓸 수 있는가 — 숫자 0 · 혜택 낱말 0 */
export function headlineTextSafe(v: string): boolean {
  HEADLINE_BENEFIT_RE.lastIndex = 0;
  return !/[0-9０-９]/.test(v) && !HEADLINE_BENEFIT_RE.test(v);
}

/**
 * ★ 2026-10-22 AI 가 쓴 그림 글자만 = 몸 · 피부 말 + 변화 말이 함께 있으면 효능 단정(「가입만 해도 피부가 편안해져요」 · 시연 판정).
 *   고객이 직접 쓴 글(이미지 스튜디오 입력 · 한 줄에서 뽑은 대체 문구)에는 걸지 않는다(headlineTextSafe 와 분리 · Codex 지적).
 *   ★ 2026-10-24 판정 = copy-benefit-detector 한 곳(한 줄 CT 글 · 문자 문안과 같은 낱말 · 그림 글은 근거를 쓰지 않는다)
 */
export const headlineClaimsEfficacy = claimsEfficacy;

/** (순수) 헤드라인 글 — 정리 · 16자 · 숫자나 혜택 낱말이 있으면 null(그림 안 값 0 · 한 줄을 근거로 쓰지 않는다) */
export function sanitizeLineHeadlineTitle(raw: unknown): string | null {
  let v = typeof raw === 'string' ? raw : '';
  v = v.replace(/[—–]/g, ' ').replace(/[“”"'「」]/g, '').replace(/\s+/g, ' ').trim();
  if (!v) return null;
  // ★ 2026-10-22 길면 자르지 않고 버린다(글자 중간 자름 = 그림에 「차려집」이 박힌다 · 시연 판정) → 호출부가 대체 문구
  if (v.length > LINE_HEADLINE_TITLE_MAX) return null;
  return headlineTextSafe(v) && !headlineClaimsEfficacy(v) ? v : null;
}

/** (순수) 낱말 단위로 상한까지만(글자 중간 자르지 않음 · 끝 쉼표 · 가운뎃점 제거 · 첫 낱말부터 넘치면 빈 글) */
function fitHeadlineWords(v: string): string {
  let out = '';
  for (const w of v.split(' ').filter(Boolean)) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > LINE_HEADLINE_TITLE_MAX) break;
    out = next;
  }
  return out.replace(/[,·\s]+$/, '').trim();
}

/** (순수) AI 가 쓸 헤드라인이 없을 때 = 한 줄 앞부분에서 혜택 구간 · 숫자 · 혜택 낱말을 뺀 말(16자 · 비면 빈 글 = 화면이 적게 한다) */
export function fallbackLineHeadlineTitle(line: string): string {
  const head = String(line || '').split(/[.!?\n·,]/)[0];
  // ★ 2026-10-22 숫자가 든 낱말은 통째로 뺀다(숫자만 지우면 「3일간」 → 「일간」이 그림에 남는다 · 시연 판정)
  const noNum = withoutBenefitSpans(head).split(/\s+/).filter((w) => !/[0-9０-９]/.test(w)).join(' ');
  const clean = noNum.replace(HEADLINE_BENEFIT_RE, '').replace(/\s+/g, ' ').trim();
  return fitHeadlineWords(clean);
}

export interface LineHeadlineInput {
  companyId: string;
  userId?: string;
  companyName: string;
  industry: string | null;
  line: string;
  productNames: readonly string[];
  /** 누끼를 얹을 상품 사진이 있는가(없으면 행사 템플릿만) */
  hasPhoto: boolean;
  now?: Date;
}

/** AI 1회(묶음 안 · 0원) — 3안 + 헤드라인 글 · 실패 = 풀 순서(source 'rule') */
export async function pickLineHeadlines(input: LineHeadlineInput): Promise<LineHeadlineResult> {
  const now = input.now || new Date();
  const pool = templatePickCandidates(input.industry, now);
  const cands = { product: input.hasPhoto ? pool.product : [], event: pool.event };
  const byId = new Map<string, StudioTemplate>([...cands.product, ...cands.event].map((t) => [t.id, t]));
  const rule = (): LineHeadlineResult => ({
    picks: diverseLineHeadlines([...cands.product, ...cands.event].map((t) => t.id), byId).map(toLineHeadlinePick),
    title: fallbackLineHeadlineTitle(input.line),
    source: 'rule',
  });
  try {
    const p = buildTemplateJudgePrompt({
      jobId: 'line', companyName: input.companyName, industry: input.industry,
      eventTitles: [input.line], productNames: input.productNames, focusQuote: null, now,
    }, cands);
    const system = `${p.system}\n추가: JSON 에 "title" 도 넣는다 = 포스터에 크게 들어갈 한국어 헤드라인 한 줄(${LINE_HEADLINE_TITLE_MAX}자 이내 · 숫자 · 할인율 · 금액 · 할인 · 쿠폰 · 무료 같은 혜택 말 금지(값은 그림 밖에 따로 들어간다) · 이 행사의 분위기 · 상품의 매력을 한 줄로 · 효능 · 효과 · 몸이나 피부가 달라진다는 말(~해져요 등) 금지 · 가입 · 구매를 효과로 엮지 않는다 · 이모지 금지).${input.hasPhoto ? '' : ' 제품 사진이 없으므로 product 는 빈 배열로 둔다.'}`;
    const raw = await runInCreditBundle(() => callAIWithFallback({
      system, userMessage: p.user, maxTokens: 300, temperature: 0,
      companyId: input.companyId, userId: input.userId, source: 'line-headline-pick', noCache: true,
    }));
    const parsed = parseTemplatePick(raw, { product: cands.product.map((t) => t.id), event: cands.event.map((t) => t.id) });
    if (!parsed) return rule();
    const j = extractJsonFromAiText<Record<string, unknown>>(String(raw || '')) || {};
    const picks = diverseLineHeadlines([...parsed.product, ...parsed.event], byId);
    if (picks.length === 0) return rule();
    return {
      picks: picks.map(toLineHeadlinePick),
      title: sanitizeLineHeadlineTitle(j.title) || fallbackLineHeadlineTitle(input.line),
      source: 'ai',
    };
  } catch (err: any) {
    console.log(`[line-headline] 판정 실패(풀 순서로) company=${input.companyId} err=${err?.message}`);
    return rule();
  }
}
