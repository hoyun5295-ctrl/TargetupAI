/**
 * CT-88 — dm-event-recommender.ts
 *
 * D216+ 모바일DM 강화 — 회사 데이터 + 시즌 → 이벤트 종류 자동 추천.
 *
 * 추천 영역:
 *   - lucky_draw (추첨) / roulette (룰렛) / instant_coupon (즉시 쿠폰)
 *   - limited_quantity (선착순) / poll (투표) / survey (설문) / email_capture (이메일 수집)
 *
 * 영구 룰 정합:
 *   - feedback_ai_no_arbitrary_benefit — 구체 혜택 제시 X
 *   - feedback_ai_operator_model_isolation — model: 'opus'
 *   - feedback_no_target_auto_relax — 임의 추측 X
 *
 * 호출 영역: routes/dm.ts POST /dm/event-recommend
 */

import { query } from '../../config/database';
import { callAIWithFallback } from '../../services/ai';
import { listMemories } from '../company-memory';
import { extractJson } from './dm-ai';

// ────────────── 타입 ──────────────

export type EventCategory =
  | 'lucky_draw'
  | 'roulette'
  | 'instant_coupon'
  | 'limited_quantity'
  | 'poll'
  | 'survey'
  | 'email_capture';

export interface EventRecommendation {
  event_type: EventCategory;
  reason: string;
  expected_engagement: 'high' | 'medium' | 'low';
  quick_start_scenario?: string;
  default_section_chain: string[];
}

export interface EventRecommendInput {
  campaign_goal?: string;
  target_audience?: string;
  budget_level?: 'low' | 'medium' | 'high';
}

// ────────────── 시즌 매트릭스 ──────────────

const SEASON_BY_MONTH: Record<number, string[]> = {
  1: ['신년', '새해', '복', '시무식'],
  2: ['설날', '발렌타인', '봄맞이'],
  3: ['봄', '입학', '꽃샘추위'],
  4: ['봄꽃', '벚꽃', '식목일'],
  5: ['어버이날', '어린이날', '가정의달', '봄여행'],
  6: ['초여름', '현충일', '여름맞이'],
  7: ['장마', '여름', '휴가'],
  8: ['휴가', '광복절', '늦여름'],
  9: ['추석', '가을', '환절기'],
  10: ['단풍', '가을여행', '핼러윈'],
  11: ['김장', '늦가을', '블랙프라이데이'],
  12: ['크리스마스', '연말', '송년'],
};

const VALID_EVENT_TYPES: EventCategory[] = [
  'lucky_draw',
  'roulette',
  'instant_coupon',
  'limited_quantity',
  'poll',
  'survey',
  'email_capture',
];

// ────────────── 시스템 프롬프트 ──────────────

const SYSTEM_PROMPT = `당신은 모바일 DM 이벤트 추천 전문가입니다. 회사 데이터 + 시즌 + 캠페인 목표를 종합하여 가장 효과 클 이벤트 1건을 추천합니다.

**선택지:**
- lucky_draw (추첨) — 리드 발굴 강력 / 응모 form 활용
- roulette (룰렛) — 참여 강력 / 즉시 보상 / 신규 고객 환영
- instant_coupon (즉시 쿠폰) — 직접 매출 직결 / 활성 고객 재구매
- limited_quantity (선착순) — 긴급감 강력 / VIP 인기
- poll (투표) — 참여 가볍게 / 인사이트 발굴
- survey (설문) — 깊은 인사이트 / 보상 시 효과
- email_capture (이메일 수집) — 리드 발굴 / 동의 기반

**절대 금지:**
- 구체 혜택 제시 (%/원/쿠폰 액수 등) 금지 — 회사 admin 직접 작성 영역
- AI 도구명 / 모델명 노출 금지

**default_section_chain 매트릭스:**
- 추첨 시나리오 = ["header", "hero", "lucky_draw", "cta", "footer"]
- 룰렛 시나리오 = ["header", "hero", "roulette", "cta", "footer"]
- 즉시 쿠폰 = ["header", "hero", "instant_coupon", "cta", "footer"]
- 선착순 = ["header", "countdown", "limited_quantity", "cta", "footer"]
- 투표 = ["header", "poll", "cta", "footer"]
- 설문 = ["header", "survey", "instant_coupon", "footer"]
- 이메일 수집 = ["header", "hero", "email_capture", "cta", "footer"]

**출력 형식 (JSON):**
{
  "event_type": "...",
  "reason": "...",
  "expected_engagement": "high|medium|low",
  "quick_start_scenario": "...",
  "default_section_chain": ["header", "...", "footer"]
}`;

// ────────────── default fallback ──────────────

function defaultRecommendation(): EventRecommendation {
  return {
    event_type: 'instant_coupon',
    reason: '안전한 default 추천 — 회사 admin 직접 혜택 작성 의무',
    expected_engagement: 'medium',
    quick_start_scenario: '즉시 쿠폰 발급',
    default_section_chain: ['header', 'hero', 'instant_coupon', 'cta', 'footer'],
  };
}

// ────────────── 메인 함수 ──────────────

export async function recommendEventType(
  companyId: string,
  input: EventRecommendInput = {},
): Promise<EventRecommendation> {
  const month = new Date().getMonth() + 1;
  const seasonKeywords = SEASON_BY_MONTH[month] || [];

  const memories = await listMemories(companyId, { limit: 8, minImportance: 3 });
  const memorySnippet = memories
    .filter((m) => m.memoryType === 'success_pattern' || m.memoryType === 'channel_performance')
    .map((m) => `[${m.memoryType}] ${m.memoryKey}: ${m.memoryValue}`)
    .join('\n')
    .slice(0, 1500);

  const statsResult = await query(
    `SELECT
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_customers_30d,
      COUNT(*) FILTER (WHERE last_purchase_date >= NOW() - INTERVAL '90 days') AS active_customers,
      COUNT(*) AS total
    FROM customers
    WHERE company_id = $1`,
    [companyId],
  );

  const stats = statsResult.rows[0] || {};

  const userMessage = `회사 데이터:
- 신규 고객 30일: ${stats.new_customers_30d || 0}
- 활성 고객 (90일 구매): ${stats.active_customers || 0}
- 전체 고객: ${stats.total || 0}

시즌 (현재 ${month}월): ${seasonKeywords.join(', ')}
캠페인 목표: ${input.campaign_goal || '미지정'}
타겟 영역: ${input.target_audience || '전체'}
예산 영역: ${input.budget_level || 'medium'}

회사 메모리:
${memorySnippet || '(없음)'}

이벤트 추천 1건 출력.`;

  try {
    const aiText = await callAIWithFallback({
      system: SYSTEM_PROMPT,
      userMessage,
      maxTokens: 600,
      temperature: 0.5,
      model: 'opus',
      companyId,
      source: 'dm-event-recommender',
    });

    const parsed = extractJson<{
      event_type?: string;
      reason?: string;
      expected_engagement?: string;
      quick_start_scenario?: string;
      default_section_chain?: string[];
    }>(aiText);

    if (!parsed?.event_type || !VALID_EVENT_TYPES.includes(parsed.event_type as EventCategory)) {
      return defaultRecommendation();
    }

    const engagement: 'high' | 'medium' | 'low' =
      parsed.expected_engagement === 'high' || parsed.expected_engagement === 'low'
        ? parsed.expected_engagement
        : 'medium';

    return {
      event_type: parsed.event_type as EventCategory,
      reason: String(parsed.reason || '시즌 + 회사 데이터 정합 추천'),
      expected_engagement: engagement,
      quick_start_scenario: parsed.quick_start_scenario,
      default_section_chain: Array.isArray(parsed.default_section_chain) && parsed.default_section_chain.length > 0
        ? parsed.default_section_chain
        : ['header', parsed.event_type as string, 'cta', 'footer'],
    };
  } catch (err) {
    console.warn('[dm-event-recommender] AI 추천 실패:', err);
    return defaultRecommendation();
  }
}
