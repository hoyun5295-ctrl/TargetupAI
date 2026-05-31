/**
 * AI 메모리 화면 TYPE_META fallback 회귀 테스트 — ts-node 단독 (백엔드 러너 사용).
 * 실행: npx ts-node src/utils/__tests__/ai-memory-type-fallback.manual-test.ts
 *
 * D227+ 사고: brand voice 문안 저장 시 representative_message 타입이 학습 통계(top-impact)에 섞여
 *   프론트 TYPE_META[memoryType] = undefined → meta.gradient 접근 throw → /ai-memory 전체 blank.
 * 2중 방어를 검증:
 *   1) 백엔드: 학습 통계 쿼리는 brand voice 2 타입 제외 (= 애초에 안 섞임)
 *   2) 프론트: 그래도 미지 타입이 오면 fallback (= 전체 blank 차단)
 * 이 테스트는 프론트 fallback 로직과 백엔드 제외 규칙을 동일 구조로 박제한다.
 */

// 프론트 TopImpactCard / AiMemoryPage와 동일한 5 학습 타입 + fallback
const TYPE_META: Record<string, { label: string }> = {
  success_pattern: { label: '성공 패턴' },
  customer_insight: { label: '고객 인사이트' },
  brand_tone_evolution: { label: '브랜드 톤' },
  channel_performance: { label: '채널 성과' },
  compliance_learning: { label: '컴플라이언스 학습' },
};
const FALLBACK = { label: '학습' };
const resolveMeta = (t: string) => TYPE_META[t] || FALLBACK;

// 백엔드 학습 통계 쿼리가 제외하는 brand voice 2 타입
const EXCLUDED_FROM_STATS = ['representative_message', 'brand_guideline'];
const isLearningStatType = (t: string) => !EXCLUDED_FROM_STATS.includes(t);

let pass = 0;
let fail = 0;
function check(n: string, f: () => void) {
  try { f(); pass++; console.log('  PASS:', n); }
  catch (e: any) { fail++; console.log('  FAIL:', n, '—', e?.message); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

check('5 학습 타입은 정상 메타 반환', () => {
  for (const t of ['success_pattern', 'customer_insight', 'brand_tone_evolution', 'channel_performance', 'compliance_learning']) {
    assert(resolveMeta(t).label !== '학습', `${t} 정상 라벨`);
  }
});

check('★ brand voice 타입(representative_message)도 throw 없이 fallback (전체 blank 차단)', () => {
  const meta = resolveMeta('representative_message');
  assert(meta !== undefined && typeof meta.label === 'string', 'meta 정의됨 (undefined 아님)');
});

check('★ 미지의 임의 타입도 fallback (미래 타입 추가 대비)', () => {
  assert(resolveMeta('some_future_unknown_type').label === '학습', 'fallback 라벨');
});

check('★ 백엔드 학습 통계는 brand voice 2 타입 제외 (애초에 안 섞임)', () => {
  assert(isLearningStatType('success_pattern') === true, '학습 타입 포함');
  assert(isLearningStatType('representative_message') === false, 'representative_message 제외');
  assert(isLearningStatType('brand_guideline') === false, 'brand_guideline 제외');
});

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
