/**
 * daily-brief-policy.ts — 오늘의 추천(회사 일일 마케팅 브리핑) 순수 정책 (2026-07-02 3단계)
 *
 * DB 미import — 순수 테스트 대상. AI 호출·저장은 company-daily-brief.ts(배선)가 담당.
 *
 * 영구 원칙:
 *  - 숫자는 실데이터만 — AI가 만든 targetCount는 무시하고 실측 신호 count로 귀속 (feedback_no_arbitrary_constants)
 *  - 구체 혜택(%·쿠폰·무료·N원) 생성 금지 — title/objective에 있으면 그 추천 폐기 (feedback_ai_no_arbitrary_benefit)
 *  - 추천 최대 3건 · 신호 없으면 빈 배열(insufficient_data 정직)
 */

export interface BriefSignalOpportunity {
  type: string;
  title: string;
  count: number;
  valueAtStake: number;
  suggestedObjective: string;
}

export interface BriefRecommendation {
  title: string;
  objective: string;
  reason: string;
  opportunityType: string | null;   // 신호 type | 'journey_promotion'(여정 정착 제안 — 5차)
  targetCount: number | null;
  valueAtStake: number | null;
  // ★ 5차: 채널 제안 — 채널 성과 학습 근거가 있을 때만 AI가 지정 (sms 외 = 해당 채널 화면으로 안내)
  recommendedChannel: 'sms' | 'email' | 'dm' | null;
}

// 여정 정착 제안 — 실측 신호 매칭 없이 보존하는 특수 type (5차).
const PROMOTION_TYPE = 'journey_promotion';
const CHANNEL_WHITELIST = ['sms', 'email', 'dm'] as const;

// 구체 혜택 패턴 — 발송 목표(objective)·제목에 들어가면 AI가 혜택을 지어낸 것 → 폐기.
const BENEFIT_PATTERN = /\d+\s*%|쿠폰|무료|\d[\d,]*\s*원/;

/** AI 생성 텍스트에 구체 혜택이 들어갔는지 — 캘린더 등 다른 정책 모듈과 공유 (feedback_ai_no_arbitrary_benefit). */
export function containsConcreteBenefit(text: string): boolean {
  return BENEFIT_PATTERN.test(String(text || ''));
}

export function sanitizeBriefRecommendations(
  raw: unknown,
  opportunities: BriefSignalOpportunity[],
): BriefRecommendation[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefRecommendation[] = [];
  for (const r of raw) {
    if (out.length >= 3) break;
    const title = String((r as any)?.title || '').trim().slice(0, 80);
    const objective = String((r as any)?.objective || '').trim().slice(0, 500);
    const reason = String((r as any)?.reason || '').trim().slice(0, 300);
    if (!title || objective.length < 5) continue;
    if (BENEFIT_PATTERN.test(title) || BENEFIT_PATTERN.test(objective)) continue;
    const oppType = typeof (r as any)?.opportunityType === 'string' ? (r as any).opportunityType : null;
    const matched = oppType ? opportunities.find((o) => o.type === oppType) : undefined;
    const rawChannel = (r as any)?.recommendedChannel;
    out.push({
      title,
      objective,
      reason,
      // 실측 신호 매칭 type + 정착 제안(journey_promotion)만 보존 — 그 외 AI 임의 type은 버린다.
      opportunityType: matched ? matched.type : (oppType === PROMOTION_TYPE ? PROMOTION_TYPE : null),
      // 숫자 귀속 = 실측 신호만. AI가 보낸 targetCount는 신뢰하지 않는다.
      targetCount: matched ? matched.count : null,
      valueAtStake: matched ? matched.valueAtStake : null,
      recommendedChannel: (CHANNEL_WHITELIST as readonly string[]).includes(rawChannel) ? rawChannel : null,
    });
  }
  return out;
}

/** AI 응답에서 JSON 오브젝트 안전 추출 — 코드펜스/평문/앞뒤 잡문 허용, 실패 시 null. */
export function extractJsonObject(text: string): any | null {
  const t = String(text || '');
  let jsonStr = t;
  if (t.includes('```json')) {
    const start = t.indexOf('```json') + 7;
    const end = t.indexOf('```', start);
    jsonStr = end > start ? t.slice(start, end) : t.slice(start);
  } else if (t.includes('```')) {
    const start = t.indexOf('```') + 3;
    const end = t.indexOf('```', start);
    jsonStr = end > start ? t.slice(start, end) : t.slice(start);
  } else {
    const first = t.indexOf('{');
    const last = t.lastIndexOf('}');
    if (first === -1 || last <= first) return null;
    jsonStr = t.slice(first, last + 1);
  }
  try {
    return JSON.parse(jsonStr.trim());
  } catch {
    return null;
  }
}

export function buildDailyBriefSystemPrompt(): string {
  return `당신은 한줄로(마케팅 자동화 서비스)의 AI 마케팅 전략가입니다.
회사의 실측 데이터(고객 신호·누적 학습·운영 현황)를 보고 "오늘 이 회사에 가장 효과가 클 마케팅"을 추천합니다.

규칙 (반드시 지킬 것):
1. 제공된 실측 숫자만 사용한다. 새로운 숫자·통계를 만들지 않는다.
2. 할인율·금액·쿠폰·무료 같은 구체 혜택을 임의로 만드는 것은 금지. 혜택은 회사 담당자가 직접 정한다.
3. 이미 운영 중인 자동 마케팅과 목표가 겹치는 추천은 하지 않는다.
4. 의미 있는 신호가 없으면 추천하지 않는다. recommendations를 빈 배열로 돌려라. 억지 추천 금지.
5. 추천은 최대 3건. 각 추천의 reason에는 이 회사의 실측 근거(신호 이름·인원·규모)를 인용한다.
6. 누적 학습(Company Memory)에 성공 패턴이 있으면 그 패턴("이럴 때 이런 마케팅이 효과 있었다")을 우선 반영하고 reason에 근거로 남겨라.
7. "여정 정착 후보"가 제공되면 그중 성과가 뚜렷한 것을 opportunityType "journey_promotion"으로 추천할 수 있다(objective = 그 후보의 목표 그대로, reason에 발송·클릭 실측 인용).
8. 누적 학습의 채널 성과에 뚜렷한 근거가 있을 때만 recommendedChannel("sms"|"email"|"dm")을 지정하라. 근거가 없으면 생략한다.

출력은 JSON만:
{
  "headline": "오늘의 한 줄 브리핑 (그 회사 데이터를 근거로, 80자 이내)",
  "recommendations": [
    { "title": "짧은 제목", "objective": "자동 마케팅 목표 한 줄 (자연어, 구체 혜택 없이)", "reason": "실측 근거 인용", "opportunityType": "신호 type (제공된 것 중 해당 시만)", "recommendedChannel": "sms|email|dm (근거 있을 때만)" }
  ]
}`;
}

export interface YesterdayRecapSummary {
  campaigns: number;
  sent: number;
  success: number;
  clicked: number;
}

export interface PromotionCandidate {
  name: string;
  objective: string;
  sent: number;
  clicks: number;
}

export function buildDailyBriefUserMessage(input: {
  memoryBlock: string;
  opportunities: BriefSignalOpportunity[];
  activeOperators: Array<{ name: string; objective: string }>;
  pendingProposals: number;
  // ★ 5차: 어제 성과 요약(2차 회고와 동일 실측) + 여정 정착 후보(발송·클릭 실측)
  yesterdayRecap?: YesterdayRecapSummary | null;
  promotionCandidates?: PromotionCandidate[];
}): string {
  const oppLines = input.opportunities.length > 0
    ? input.opportunities.map((o) =>
        `- [${o.type}] ${o.title}: ${o.count.toLocaleString()}명 (관련 매출 규모 ₩${Math.round(o.valueAtStake).toLocaleString()}): 제안 골격: ${o.suggestedObjective}`,
      ).join('\n')
    : '(감지된 신호 없음)';
  const opLines = input.activeOperators.length > 0
    ? input.activeOperators.map((o) => `- ${o.name}: ${o.objective}`).join('\n')
    : '(운영 중인 자동 마케팅 없음)';
  const recap = input.yesterdayRecap;
  const recapLine = recap && recap.campaigns > 0
    ? `발송 ${recap.campaigns}건 · ${recap.sent.toLocaleString()}명 · 성공 ${recap.success.toLocaleString()}명${recap.clicked > 0 ? ` · 클릭 ${recap.clicked.toLocaleString()}명` : ''}`
    : '(어제 자동 마케팅 발송 없음)';
  const promoLines = (input.promotionCandidates || []).length > 0
    ? (input.promotionCandidates || []).map((p) =>
        `- ${p.name}: ${p.objective} (발송 ${p.sent.toLocaleString()}건 · 클릭 ${p.clicks.toLocaleString()}건)`,
      ).join('\n')
    : '(정착 후보 없음)';
  return `${input.memoryBlock || '(회사 누적 학습 없음)'}

## 어제 자동 마케팅 발송 성과 (실측)
${recapLine}

## 오늘의 고객 DB 실측 신호
${oppLines}

## 운영 중인 자동 마케팅 (목표 중복 금지)
${opLines}

## 여정 정착 후보 (성과가 검증된 자동 마케팅, journey_promotion 추천 가능)
${promoLines}

## 승인 대기 중인 추천 수: ${input.pendingProposals}건

위 데이터만 근거로 오늘의 추천을 JSON으로 작성하세요.`;
}
