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
import { extractJsonFromAiText } from './ai-json';   // 순수 CT(import 0) — 이 파일의 "DB 미import" 원칙 유지

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
  // ★ 2026-09-30 WP4 — JSON 추출은 CT 하나(ai-json · 순수 · import 0 · 머리말 · 코드펜스 · 문자열 안 제어문자 복구). 객체만 · 실패 = null(종전 계약).
  try {
    const v = extractJsonFromAiText(String(text || ''));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * ★ 2026-10-10 한 줄 묻기 0단계 — 저장된 오늘의 추천을 **보는 사람에게 내보내는 모양**(설계서 docs/2026-10-10-oneline-ask-design.md §4-3).
 *   내보내는 곳 = GET /operator/daily-brief · /operator/self-diagnosis · 한 줄 답(자동 마케팅) — 셋 다 이 함수 하나로 읽는다(입구마다 숨기면 다른 입구로 샌다).
 *   - 담당자 = 제목 · 목표 · 종류 · 채널만(칸을 골라 담는다 · 펼쳐 담지 않는다). 머리 문장 · 이유 · 대상 수 · 규모는 회사 전체 고객으로 센 값이라 숨긴다.
 *     제목 · 목표에 숫자가 있으면(「휴면 1,240명 복귀」) 같은 행 신호의 코드 뼈대(제목 · 권장 목표)로 바꾸고, 뼈대가 없으면 그 추천을 뺀다.
 *     ponytail: 숫자 판정은 아라비아 숫자만 — 「천여 명」 같은 글자 수는 못 거른다(AI 규칙 1 = 실측 숫자만 · 지금 저장본은 숫자로 쓴다).
 *   - 관리자 = 이유 문장의 숫자를 같은 행에 저장된 신호(signals)와 대조해, 근거에 없는 숫자(AI 가 지어낸 수)가 있으면 이유를 비운다.
 *     (오늘 다시 계산한 신호와 대조하지 않는다 — 단위 정정 같은 변경 뒤 첫날 옛 행이 전부 걸린다)
 */
export interface StoredBriefRow {
  brief_date: unknown;
  headline: string | null;
  recommendations: unknown;
  created_at?: unknown;
  signals?: unknown;
}

export function briefForViewer(
  row: StoredBriefRow | null | undefined,
  viewer: { isAdmin: boolean },
  findNew: (output: string, source: string) => string[],
): { brief_date: unknown; headline: string | null; recommendations: BriefRecommendation[]; created_at?: unknown } | null {
  if (!row) return null;
  const recs: BriefRecommendation[] = Array.isArray(row.recommendations) ? (row.recommendations as BriefRecommendation[]) : [];
  if (!viewer.isAdmin) {
    const skeletons: any[] = Array.isArray((row.signals as any)?.opportunities) ? (row.signals as any).opportunities : [];
    const recommendations: BriefRecommendation[] = [];
    for (const r of recs) {
      let title = String(r?.title || '');
      let objective = String(r?.objective || '');
      if (/\d/.test(title) || /\d/.test(objective)) {
        const s = r?.opportunityType ? skeletons.find((x) => x?.type === r.opportunityType) : undefined;
        if (!s?.title || !s?.suggestedObjective) continue;
        title = String(s.title);
        objective = String(s.suggestedObjective);
      }
      recommendations.push({
        title,
        objective,
        reason: '',
        opportunityType: r?.opportunityType ?? null,
        targetCount: null,
        valueAtStake: null,
        recommendedChannel: r?.recommendedChannel ?? null,
      });
    }
    return {
      brief_date: row.brief_date,
      headline: null,
      recommendations,
      ...(row.created_at !== undefined ? { created_at: row.created_at } : {}),
    };
  }
  const source = JSON.stringify(row.signals ?? {});
  return {
    brief_date: row.brief_date,
    headline: row.headline && findNew(row.headline, source).length === 0 ? row.headline : null,
    recommendations: recs.map((r) => (r.reason && findNew(r.reason, source).length > 0 ? { ...r, reason: '' } : r)),
    ...(row.created_at !== undefined ? { created_at: row.created_at } : {}),
  };
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
