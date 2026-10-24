/**
 * line-template-copy.ts — 템플릿 문구 칸 채우기(AI 1회) + 검증 (★ 2026-10-17 · 설계서 docs/2026-10-17-line-template-campaign-design.md §2-3)
 *
 * ⛔ 불변
 *   - AI 는 **닫힌 문구 칸(JSON 키)만** 쓴다. 구조 · 가격 · 사진 · 링크 · 혜택 원문은 AI 를 지나지 않는다.
 *   - 칸마다 글자 상한(넘으면 자른다) · 원문(한 줄 · 사람이 준 답 · 그대로 쓰기 켠 페이지 문구 · 상품 이름)에 없는 숫자나 혜택이 생기면 그 칸 = 템플릿 기본 문구(숫자 0).
 *   - 줄표(—) · 따옴표 장식 · 줄바꿈 정리. 빈 칸 = 기본 문구(빈 껍데기 0).
 *   - 호출부는 `runInCreditBundle` 안에서 부른다(이 호출 자체의 차감 0 · 라우트가 한 줄 완성 키로 1회 차감).
 */
import { callAIWithFallback } from '../services/ai';
import { extractJsonFromAiText } from './ai-json';
import { rewriteAddsFacts, EFFICACY_PROMPT_RULES } from './copy-benefit-detector';
import type { LineTemplate, LineCopyKey } from './design-core/line-templates';
import type { LineCopy } from './line-template-compose';

export interface LineCopyGround {
  line: string;
  benefit: string | null;
  periodLabel: string | null;
  brandName: string;
  productNames: string[];
  /** 그대로 쓰기 켠 이벤트 페이지 문구(숫자 근거로 인정) */
  pageText: string | null;
}

/** 근거 글(숫자 · 혜택 판정의 원문) */
export function lineCopyGroundText(g: LineCopyGround): string {
  return [g.line, g.benefit, g.periodLabel, g.brandName, ...g.productNames, g.pageText].filter(Boolean).join('\n');
}

/** (순수) AI 응답 → 문구(칸마다 정리 · 상한 · 숫자 · 혜택 검사 · 실패 칸 = 기본 문구). replaced = 기본 문구로 바꾼 칸 */
export function sanitizeLineCopy(t: LineTemplate, raw: unknown, groundText: string): { copy: LineCopy; replaced: LineCopyKey[] } {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const copy = {} as LineCopy;
  const replaced: LineCopyKey[] = [];
  for (const f of t.copy) {
    let v = typeof obj[f.key] === 'string' ? String(obj[f.key]) : '';
    v = v.replace(/[—–]/g, ' ').replace(/[“”"']/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (v.length > f.max) v = v.slice(0, f.max).trim();
    // ★ 2026-10-24 ② 판정 = rewriteAddsFacts(숫자 ∥ 혜택 ∥ 효능 · 같은 근거)
    const bad = !v || rewriteAddsFacts(v, groundText);
    if (bad) { copy[f.key] = f.fallback; replaced.push(f.key); } else copy[f.key] = v;
  }
  return { copy, replaced };
}

const SYSTEM = `당신은 한국 브랜드의 마케팅 카피라이터입니다. 정해진 템플릿의 문구 칸만 채웁니다.
규칙:
- 반드시 JSON 객체 하나만 출력합니다(코드블록 · 설명 금지). 키는 요청한 키만 씁니다.
- 각 칸의 글자 수 상한을 지킵니다(공백 포함). 짧고 또렷하게, 존댓말로 씁니다.
- 원문에 없는 숫자 · 할인율 · 금액 · 날짜 · 기간 · 수량 · 혜택(무료 · 증정 · 쿠폰 등)을 절대 만들지 않습니다. 원문에 있는 것만 그대로 씁니다.
- 상품의 효과 · 성분 · 품질을 단정하지 않습니다(최고 · 1위 · 완벽 같은 과장 금지).
${EFFICACY_PROMPT_RULES}
- 긴 줄표 기호와 따옴표 장식을 쓰지 않습니다. 이모지를 쓰지 않습니다.`;

/** AI 1회 — 실패(응답 없음 · JSON 아님)는 던진다(호출부 503 · 차감 0) */
/** ★ 2026-10-21 실물 예시 상한(문자 · 토큰 예산) */
export const LINE_COPY_EXEMPLAR_MAX = 2400;

/**
 * ctx.exemplars = 같은 업종 직원 실물 문구(가린 글 · 설계서 docs/2026-10-21-oneline-content-design.md §3-5) — 리듬 · 길이 · 말투 참고만.
 *   ⛔ 근거 글(ground)에 넣지 않는다 = 예시의 숫자 · 혜택이 값 검사 근거가 되지 않는다(지어낸 값은 그대로 기본 문구로 바뀐다).
 */
export async function fillLineTemplateCopy(t: LineTemplate, g: LineCopyGround, ctx: { companyId: string; userId?: string; source: string; exemplars?: string | null }): Promise<{ copy: LineCopy; replaced: LineCopyKey[] }> {
  const fields = t.copy.map((f) => `- ${f.key} (${f.max}자 이내): ${f.hint}`).join('\n');
  const user = [
    `[템플릿] ${t.label} · ${t.desc}`,
    `[흐름] ${t.story.map((s) => `${s.role} ${s.text}`).join(' / ')}`,
    `[브랜드] ${g.brandName || '(이름 없음)'}`,
    `[담당자가 쓴 한 줄] ${g.line}`,
    g.benefit ? `[혜택 원문 · 이 글자 그대로만] ${g.benefit}` : '[혜택] 없음(혜택 문구를 만들지 마세요)',
    g.periodLabel ? `[기간] ${g.periodLabel}` : '',
    g.productNames.length > 0 ? `[상품] ${g.productNames.slice(0, 8).join(', ')}` : '',
    g.pageText ? `[행사 페이지 문구 · 그대로 써도 되는 원문]\n${g.pageText.slice(0, 1200)}` : '',
    ctx.exemplars ? `[같은 업종 브랜드가 실제로 보낸 문구 · 문장 리듬 · 길이 · 말투만 참고 · 예시의 숫자 · 혜택 · 상품명 · 브랜드명은 절대 쓰지 않는다]\n${ctx.exemplars.slice(0, LINE_COPY_EXEMPLAR_MAX)}` : '',
    `[채울 칸]\n${fields}`,
    'JSON 으로만 답하세요.',
  ].filter(Boolean).join('\n');
  const text = await callAIWithFallback({
    system: SYSTEM,
    userMessage: user,
    maxTokens: 1200,
    temperature: 0.6,
    companyId: ctx.companyId,
    userId: ctx.userId,
    source: ctx.source,
    noCache: true,
  });
  const parsed = extractJsonFromAiText<Record<string, unknown>>(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('LINE_COPY_EMPTY');
  return sanitizeLineCopy(t, parsed, lineCopyGroundText(g));
}

/** 예시 문구(가상 업체 · 고정) — 같은 검증을 지난다(예시도 규칙을 어기지 않게) */
export function lineExampleCopy(t: LineTemplate): LineCopy {
  const ex = t.example;
  const ground = lineCopyGroundText({ line: ex.line, benefit: ex.benefit, periodLabel: null, brandName: ex.company, productNames: ex.products.map((p) => p.name), pageText: null });
  return sanitizeLineCopy(t, ex.copy, ground).copy;
}
