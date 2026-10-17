/**
 * line-template-plan.ts — 템플릿 캠페인 재료 단계 판정 (순수 · ★ 2026-10-17 · 설계서 docs/2026-10-17-line-template-campaign-design.md §2-6)
 *
 * 1017 단계 판정(`buildLineStepsPlan`)과 같은 입력 · 같은 출력 모양 — 다른 것은 「무엇을 묻는가」의 기준이 **고른 템플릿의 재료 칸**이라는 것.
 * ⛔ 불변
 *   - AI 0 · DB 0. 회사 사실은 라우트가 넣는다(`loadLineStepsCompanyFacts` 그대로).
 *   - 순서 = 이벤트 페이지 → 혜택 → 상품(한 단계 · 여러 개) → 대표 사진 → 버튼 주소 → 기간 · 상한 4.
 *   - **표지 · 띠에 크게 실리는 구조 값(혜택 · 마감일)은 사람이 확인한 답으로만** 싣는다(Codex 1R high · 부정 · 조건 누락 방지).
 *     한 줄에서 찾은 값은 제안 칩으로만 보인다(기본값 0 · 사람이 눌러야 채워짐 · 5R) · 생성은 답만 읽는다.
 *   - **필수 칸은 미루지 않는다** — 넘치면 선택 칸부터 뺀다(대표 사진 → 이벤트 페이지 → 선택 혜택 → 버튼 주소 → 선택 상품).
 *     템플릿마다 물을 수 있는 필수 칸 ≤ 3(등록 관문 `validateLineTemplate`) → 필수만으로 상한을 넘지 않는다.
 *   - 판정 규칙은 `one-line-facts.ts` · `one-line-steps.ts` 함수를 그대로 쓴다(같은 규칙 두 벌 금지).
 */
import { hasConcreteBenefit, hasPromotionIntent, lineProductTerms, lineBenefitPrefill } from './one-line-facts';
import { LINE_STEPS_MAX, lineTermFacts, lineUrls, lineEndDatePrefill, type LineStep, type LineStepsPlan, type LineStepsPlanInput } from './one-line-steps';
import type { LineTemplate, LineTemplateId } from './design-core/line-templates';

export interface LineTemplatePlan extends LineStepsPlan {
  template: LineTemplateId;
}

/** 넘칠 때 빼는 순서(먼저 뺀다) — 필수 단계는 목록에 없다 */
const DROP_ORDER: Array<(s: LineStep) => boolean> = [
  (s) => s.key === 'hero_photo',
  (s) => s.key === 'event_page',
  (s) => s.key === 'benefit' && !s.required,
  (s) => s.key === 'link',
  (s) => s.key === 'products' && !s.required,
];

/** (순수) 템플릿 + 한 줄 + 회사 사실 → 재료 단계(nowMs = 마감 날짜 미리 채움의 오늘) */
export function buildLineTemplatePlan(t: LineTemplate, input: LineStepsPlanInput, nowMs: number = Date.now()): LineTemplatePlan {
  const base: LineTemplatePlan = {
    v: 1, template: t.id, channel: input.channel, line_fp: input.lineFp, mall: input.mall,
    block: null, upload: input.upload, steps: [], later: [], offers: [], filled: {}, link_default: null, cost: input.cost,
  };
  if (input.channel === 'inapp' && input.inappBlocked) return { ...base, block: 'INAPP_DISPLAY_UNAVAILABLE' };

  const steps: LineStep[] = [];
  const typedUrl = lineUrls(input.typed)[0] ?? null;
  const benefitKnown = hasConcreteBenefit(input.judged);
  const benefitMissing = t.needs.benefit !== 'none' && !benefitKnown;
  // 혜택 단계 = 필수 템플릿은 늘 · 선택 템플릿은 한 줄이 혜택 · 행사를 말했을 때(확인 · 묻기) · 미리 채움 = 사용자가 친 글(사진 조각 제외)
  const benefitAsk = t.needs.benefit === 'required' || (t.needs.benefit === 'optional' && (benefitKnown || hasPromotionIntent(input.judged)));
  const benefitPrefill = benefitKnown ? lineBenefitPrefill(input.typed) : null;

  // ① 이벤트 페이지 — 한 줄에 주소를 쳤으면 그 주소로 열자마자 읽는다 · 아니면 혜택이 비었거나 사진 표지 템플릿일 때만(선택)
  if (typedUrl || benefitMissing || t.needs.hero === 'ask') steps.push({ key: 'event_page', ...(typedUrl ? { url: typedUrl } : {}) });

  // ② 혜택 — required = 건너뛰기 없음
  if (benefitAsk) steps.push({ key: 'benefit', ...(t.needs.benefit === 'required' ? { required: true } : {}), ...(benefitPrefill ? { suggest: benefitPrefill } : {}) });

  // ③ 상품 — 한 단계에서 여러 개(낱말 탭 · 찾기 · 직접 넣기) · 채널 상한 · min ≥ 1 이면 필수
  const max = t.needs.products.max[input.channel];
  const words = lineProductTerms(input.line);
  const terms = words.map((item) => ({ item, ...lineTermFacts(input.line, item, words.length) }));
  if (max > 0) steps.push({ key: 'products', terms, min: t.needs.products.min, max, ...(t.needs.products.min > 0 ? { required: true } : {}) });

  // ④ 대표 사진 — 사진 표지 템플릿 · 올릴 수 있을 때만 · 이벤트 페이지에서 표지 사진을 읽었으면 건너뜀
  if (t.needs.hero === 'ask' && input.upload) steps.push({ key: 'hero_photo', skip_if: 'page_banner' });

  // ⑤ 버튼 주소 — 한 줄 주소 · 홈페이지 · 몰 첫 화면이 있으면 단계 없이 그 값(1017 규칙 그대로) · 상품 링크 · 읽은 페이지가 있으면 화면이 건너뜀
  if (typedUrl) base.filled.link = typedUrl;
  else if (input.website) base.link_default = { kind: 'website', url: input.website };
  else if (input.mallHome) base.link_default = { kind: 'mall_home', url: input.mallHome };
  else steps.push({ key: 'link', skip_if: 'product_link' });

  // ⑥ 마감 — DM · 이메일 · 템플릿 필수 = 늘 확인(한 줄의 날짜는 미리 채움 · 「이번 주말까지」처럼 날짜가 아닌 말은 칩으로 고른다)
  if (input.channel !== 'inapp' && t.needs.period === 'required') {
    const end = lineEndDatePrefill(input.typed, nowMs);
    steps.push({ key: 'period', required: true, ...(end ? { suggest: end } : {}) });
  }

  const kept = [...steps];
  const later: LineTemplatePlan['later'] = [];
  for (const drop of DROP_ORDER) {
    if (kept.length <= LINE_STEPS_MAX) break;
    const i = kept.findIndex(drop);
    if (i >= 0) later.push({ key: kept.splice(i, 1)[0].key });
  }
  return { ...base, steps: kept, later };
}
