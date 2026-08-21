/**
 * ★ CT: AI 성과 분석가 — 순수 로직 (D227+ 2026-05-31)
 *
 * AI Operator 성과 추정(통계) 위에 얹는 "AI 분석가" sub-agent의 순수 부분.
 * 통계가 뽑은 숫자를 받아 → 진단·인사이트·전략·리스크를 자연어로 해석하도록
 * 프롬프트를 빌드하고, AI 출력을 안전하게 정규화한다.
 *
 * 영구 원칙 (Harold 명시 D227+)
 *   - AI는 숫자를 만들지 않는다. 통계가 준 숫자만 인용. (임의 상수/추측 = 사기)
 *   - AI는 구체 혜택(%/할인/쿠폰/금액)을 지어내지 않는다. 혜택은 회사가 정함.
 *   - 데이터 부족 시 가짜 분석 대신 "데이터 연동" 정직 안내.
 *   - AI 호출(ai-orchestrator generatePerformanceInsight)은 이 순수 함수들을 사용.
 */

export interface InsightInput {
  level: string;             // basis.level (purchase_cycle / grade_actual / campaign_actual)
  companyName: string;
  objective: string;         // 사용자가 입력한 마케팅 목표
  channel: string;
  targetCount: number;
  expectedConversions: number;
  conversionRate: number;
  expectedRevenue: number;
  estimatedCost: number;
  multiple: number;          // 투자 대비 배수 (매출 ÷ 발송비)
  eventWindowDays: number;
  confidence: string;        // high / medium / low
  gradeBreakdown: Array<{ grade: string; count: number; conversionRate: number; expectedRevenue: number }>;
  basisLabel: string;
}

export interface InsightResult {
  diagnosis: string;   // 한 줄 진단
  insights: string[];  // 해석 (최대 3)
  strategy: string[];  // 다음 액션 제안 (최대 3)
  risks: string[];     // 리스크 경고 (최대 2)
  generated: boolean;  // true=AI 분석 생성, false=데이터부족 고정 안내
}

const MAX_INSIGHTS = 3;
const MAX_STRATEGY = 3;
const MAX_RISKS = 2;

/** 배열만 허용, 문자열 trim + 빈 제거 + 개수 제한 */
function cleanList(v: any, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => x.length > 0)
    .slice(0, max);
}

/**
 * 통계 결과 → AI 분석가 프롬프트(system + userMessage).
 * system에 "숫자/혜택 생성 금지" 가드 + JSON 출력 형식. userMessage에 통계 숫자 + 목표.
 */
export function buildInsightPrompt(input: InsightInput): { system: string; userMessage: string } {
  const system = [
    '당신은 마케팅 성과 분석가입니다. 주어진 통계 수치를 해석해 마케팅 담당자에게 진단·평가·전략·리스크를 한국어로 제시합니다.',
    '',
    '절대 규칙:',
    '- 주어진 통계 숫자만 인용합니다. 통계에 없는 전환율·매출·비율·금액을 새로 만들거나 지어내지 않습니다.',
    '- 할인율·쿠폰·금액 같은 구체 혜택을 지어내지 않습니다. 혜택은 회사가 직접 정합니다.',
    '- 추측이 필요하면 "데이터가 더 쌓이면 정확해집니다"라고 정직하게 말합니다.',
    '- 마케팅 담당자가 바로 이해할 자연스러운 한국어로, 과장 없이 씁니다.',
    '',
    '다음 JSON 형식으로만 응답합니다(설명문 없이):',
    '{',
    '  "diagnosis": "한 줄 진단: 왜 이 성과가 나오는지",',
    '  "insights": ["해석 1", "해석 2"],',
    '  "strategy": ["다음 캠페인 액션 제안 1", "제안 2"],',
    '  "risks": ["주의/리스크 경고 1"]',
    '}',
  ].join('\n');

  const gradeLines = (input.gradeBreakdown || [])
    .map((g) => `  - ${g.grade}: ${g.count.toLocaleString()}명, 예상 전환율 ${(g.conversionRate * 100).toFixed(1)}%, 예상 매출 ${g.expectedRevenue.toLocaleString()}원`)
    .join('\n');

  const userMessage = [
    `[회사] ${input.companyName}`,
    `[마케팅 목표] ${input.objective}`,
    `[채널] ${input.channel}`,
    `[추정 근거] ${input.basisLabel} (신뢰도: ${input.confidence})`,
    `[행사기간] ${input.eventWindowDays}일 기준`,
    '',
    '[통계 결과: 이 숫자만 사용]',
    `- 발송(타겟): ${input.targetCount.toLocaleString()}명`,
    `- 예상 전환: ${input.expectedConversions.toLocaleString()}명 (전환율 ${(input.conversionRate * 100).toFixed(1)}%)`,
    `- 예상 매출: ${input.expectedRevenue.toLocaleString()}원`,
    `- 발송비: ${input.estimatedCost.toLocaleString()}원`,
    `- 투자 대비: ${input.multiple.toFixed(1)}배`,
    gradeLines ? `[등급별]\n${gradeLines}` : '',
    '',
    '위 통계를 해석해 진단·인사이트·전략·리스크를 JSON으로 제시하세요.',
    '특히 충성고객의 자연 구매가 섞여 있을 수 있으니, 순수 메시지 효과는 보수적으로 보라는 맥락을 리스크에 반영하세요.',
  ].filter((l) => l !== '').join('\n');

  return { system, userMessage };
}

/** AI 출력(파싱된 객체) → 안전 정규화. 어떤 형태가 와도 throw 없이 InsightResult. */
export function normalizeInsight(raw: any): InsightResult {
  const r = raw || {};
  return {
    diagnosis: typeof r.diagnosis === 'string' ? r.diagnosis.trim() : '',
    insights: cleanList(r.insights, MAX_INSIGHTS),
    strategy: cleanList(r.strategy, MAX_STRATEGY),
    risks: cleanList(r.risks, MAX_RISKS),
    generated: true,
  };
}

/** 데이터 부족 시 — 가짜 분석 대신 데이터 연동 정직 안내. */
export function buildInsufficientInsight(): InsightResult {
  return {
    diagnosis: '아직 고객 구매 데이터가 부족해 AI 분석을 시작할 수 없습니다.',
    insights: ['구매횟수·구매일·등급 데이터가 쌓이면 등급별 전환과 매출을 정확히 분석해 드립니다.'],
    strategy: ['고객 구매 데이터를 업로드하거나 CDP(자사몰)를 연동해주세요.'],
    risks: [],
    generated: false,
  };
}
