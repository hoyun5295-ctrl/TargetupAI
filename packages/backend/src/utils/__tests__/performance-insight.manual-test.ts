/**
 * performance-insight 순수 로직 테스트 — ts-node 단독 실행.
 * 실행: npx ts-node src/utils/__tests__/performance-insight.manual-test.ts
 *
 * AI 성과 분석가 sub-agent의 순수 부분(프롬프트 빌드 + 출력 정규화/가드 + 데이터부족 분기).
 * AI 호출 자체는 services/ai.ts generatePerformanceInsight에서 통합 (이 파일은 AI 무관 순수 검증).
 * 핵심: AI가 새 숫자·혜택을 못 만들게 system 가드 + 출력 구조 정규화.
 */
import { buildInsightPrompt, normalizeInsight, buildInsufficientInsight } from '../performance-insight';

let pass = 0;
let fail = 0;
function check(n: string, f: () => void) {
  try { f(); pass++; console.log('  PASS:', n); }
  catch (e: any) { fail++; console.log('  FAIL:', n, '—', e?.message); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

const sampleInput = {
  level: 'purchase_cycle',
  companyName: '테스트상사',
  objective: '휴면 VIP 재구매 유도',
  channel: 'LMS',
  targetCount: 1000,
  expectedConversions: 120,
  conversionRate: 0.12,
  expectedRevenue: 12000000,
  estimatedCost: 30000,
  multiple: 400,
  eventWindowDays: 7,
  confidence: 'medium',
  gradeBreakdown: [
    { grade: 'VIP', count: 600, conversionRate: 0.18, expectedRevenue: 9000000 },
    { grade: 'Gold', count: 400, conversionRate: 0.05, expectedRevenue: 3000000 },
  ],
  basisLabel: '등급별 구매주기 기반 추정',
};

// ═══════════════════════════════════════════════════════
// buildInsightPrompt — 숫자/혜택 생성 금지 가드 + 통계 전달
// ═══════════════════════════════════════════════════════

check('system 프롬프트에 숫자 생성 금지 가드', () => {
  const { system } = buildInsightPrompt(sampleInput);
  assert(/숫자|수치/.test(system) && /금지|만들지|생성하지|지어내/.test(system), 'system에 숫자 생성 금지');
});

check('system 프롬프트에 혜택/할인 생성 금지 가드', () => {
  const { system } = buildInsightPrompt(sampleInput);
  assert(/혜택|할인|쿠폰/.test(system), 'system에 혜택 생성 금지');
});

check('userMessage에 통계 숫자 + 목표가 그대로 전달', () => {
  const { userMessage } = buildInsightPrompt(sampleInput);
  assert(userMessage.includes('1,000') || userMessage.includes('1000'), '타겟수 전달');
  assert(userMessage.includes('휴면 VIP 재구매 유도'), '목표 전달');
  assert(userMessage.includes('LMS'), '채널 전달');
});

check('userMessage에 등급별 분해 숫자 전달', () => {
  const { userMessage } = buildInsightPrompt(sampleInput);
  assert(userMessage.includes('VIP') && userMessage.includes('Gold'), '등급 2종 전달');
});

// ═══════════════════════════════════════════════════════
// normalizeInsight — AI 출력 구조 정규화/가드 (throw 없이 안전)
// ═══════════════════════════════════════════════════════

check('정상 raw → 구조 정규화 + generated true', () => {
  const r = normalizeInsight({
    diagnosis: 'VIP 구매주기가 짧아 전환이 높습니다',
    insights: ['해석1', '해석2'],
    strategy: ['전략1'],
    risks: ['리스크1'],
  });
  assert(r.diagnosis.length > 0, 'diagnosis');
  assert(r.insights.length === 2, `insights 2 (실제 ${r.insights.length})`);
  assert(r.strategy.length === 1, 'strategy 1');
  assert(r.risks.length === 1, 'risks 1');
  assert(r.generated === true, 'generated true');
});

check('insights 4개 초과 → 3개로 제한 (장황 방지)', () => {
  const r = normalizeInsight({ diagnosis: 'd', insights: ['1', '2', '3', '4', '5'], strategy: [], risks: [] });
  assert(r.insights.length === 3, `insights ${r.insights.length} → 3`);
});

check('비배열/null/빈문자열 방어 → 빈 배열, throw 없음', () => {
  const r = normalizeInsight({ diagnosis: null, insights: '문자열아님', strategy: undefined, risks: ['', '  '] });
  assert(r.diagnosis === '', 'diagnosis 빈 문자열');
  assert(Array.isArray(r.insights) && r.insights.length === 0, 'insights 빈 배열');
  assert(Array.isArray(r.strategy) && r.strategy.length === 0, 'strategy 빈 배열');
  assert(r.risks.length === 0, '공백 risk 제거');
});

check('완전 빈 raw {} → throw 없이 빈 구조 (generated true)', () => {
  const r = normalizeInsight({});
  assert(r.diagnosis === '' && r.insights.length === 0, '빈 구조');
  assert(r.generated === true, 'generated true (파싱 자체는 성공)');
});

// ═══════════════════════════════════════════════════════
// buildInsufficientInsight — 데이터 부족 시 가짜 분석 대신 정직 안내
// ═══════════════════════════════════════════════════════

check('데이터 부족 → generated false + 데이터 연동 안내', () => {
  const r = buildInsufficientInsight();
  assert(r.generated === false, 'generated false');
  assert(r.diagnosis.length > 0, '안내 문구 존재');
  assert(r.strategy.length > 0, '데이터 연동 제안 존재');
  assert(r.risks.length === 0, '데이터 부족 시 리스크 추정 안 함');
});

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
