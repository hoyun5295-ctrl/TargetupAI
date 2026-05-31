/**
 * operator-performance-estimator 순수 계산 테스트 — 백엔드 vitest 부재로 ts-node 단독 실행.
 * 실행: npx ts-node src/utils/__tests__/operator-performance-estimator.manual-test.ts
 * 종료코드 0 = 전부 통과.
 *
 * ★ D227+ 산식 재설계 — 마케팅 퍼널 물리 법칙(클릭/전환 ≤ 100%, 전환 ≤ 클릭) 강제.
 */
import { computeEstimate, CTR_REALISTIC_MAX, CVR_REALISTIC_MAX } from '../operator-performance-estimator';

let pass = 0;
let fail = 0;
function check(n: string, f: () => void) {
  try { f(); pass++; console.log('  PASS:', n); }
  catch (e: any) { fail++; console.log('  FAIL:', n, '—', e?.message); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

// ═══════════════════════════════════════════════════════
// 물리 법칙 — 어떤 입력에도 절대 위반 불가 (사기 숫자 차단)
// ═══════════════════════════════════════════════════════

check('★ 깨진 실측(구매>발송) → CTR ≤ 현실상한, CVR ≤ CTR (1300발송 클릭1900 사고 재현)', () => {
  // 테스트 계정: 과거 발송 적은데 구매 카운트 폭발 → 옛 코드는 CVR 0.5 cap + CTR 1.5(150%) 사고
  const r = computeEstimate({
    count: 1301, unitCost: 30, avgRevenue: 119780,
    actual: { totalSent: 200, purchase7d: 5000, revenuePerMsg: 0, totalCampaigns: 2, hasCdpData: true },
    targetProfile: { avgPurchaseCount: 190, activeRatio: 1 },
  });
  assert(r.performance.clickRate <= CTR_REALISTIC_MAX, `CTR ${r.performance.clickRate} ≤ ${CTR_REALISTIC_MAX}`);
  assert(r.performance.conversionRate <= r.performance.clickRate, 'CVR ≤ CTR (전환은 클릭 부분집합)');
  assert(r.performance.expectedClicks <= 1301, '클릭수 ≤ 발송수');
  assert(r.performance.expectedConversions <= r.performance.expectedClicks, '전환수 ≤ 클릭수');
});

check('★ 모든 비율은 0~1 범위 (음수/100%초과 불가)', () => {
  const r = computeEstimate({
    count: 1000, unitCost: 30, avgRevenue: 50000,
    actual: { totalSent: 10, purchase7d: 99999, revenuePerMsg: 0, totalCampaigns: 1, hasCdpData: true },
    targetProfile: null,
  });
  assert(r.performance.clickRate >= 0 && r.performance.clickRate <= 1, '0 ≤ CTR ≤ 1');
  assert(r.performance.conversionRate >= 0 && r.performance.conversionRate <= 1, '0 ≤ CVR ≤ 1');
});

check('★ 빈약 표본(캠페인 1건·발송 적음) → 실측 신뢰 X → target_profile 강등', () => {
  const r = computeEstimate({
    count: 1301, unitCost: 30, avgRevenue: 119780,
    actual: { totalSent: 200, purchase7d: 5000, revenuePerMsg: 0, totalCampaigns: 2, hasCdpData: true },
    targetProfile: { avgPurchaseCount: 5, activeRatio: 0.8 },
  });
  // 오염된 실측(구매>발송)은 campaign_actual로 인정 X
  assert(r.basis.level !== 'campaign_actual', '오염 실측은 campaign_actual 아님');
});

// ═══════════════════════════════════════════════════════
// 정상 케이스 — 퍼널 모델
// ═══════════════════════════════════════════════════════

check('campaign_actual — 충분 표본 + 현실적 전환율', () => {
  // 발송 50000 중 클릭 추정용 구매 500 → CVR=1% (현실 범위)
  const r = computeEstimate({
    count: 1000, unitCost: 30, avgRevenue: 200000,
    actual: { totalSent: 50000, purchase7d: 500, revenuePerMsg: 0, totalCampaigns: 12, hasCdpData: false },
    targetProfile: null,
  });
  assert(r.basis.level === 'campaign_actual', 'level=campaign_actual');
  assert(Math.abs(r.performance.conversionRate - 0.01) < 0.001, 'CVR=500/50000=1%');
  assert(r.performance.conversionRate <= r.performance.clickRate, 'CVR ≤ CTR');
  assert(r.performance.expectedConversions === 10, 'conv=1000*0.01=10');
  assert(r.basis.confidence === 'high', 'confidence=high');
});

check('target_profile — VIP 객단가 반영 + 물리 법칙 준수', () => {
  const r = computeEstimate({
    count: 1301, unitCost: 27, avgRevenue: 400000,
    actual: null, targetProfile: { avgPurchaseCount: 5, activeRatio: 0.8 },
  });
  assert(r.basis.level === 'target_profile', 'level=target_profile');
  assert(r.performance.conversionRate <= CVR_REALISTIC_MAX, 'CVR ≤ 현실상한');
  assert(r.performance.conversionRate <= r.performance.clickRate, 'CVR ≤ CTR');
  assert(r.performance.expectedRevenue > 0, '매출 양수');
  assert(r.basis.confidence === 'medium', 'confidence=medium');
});

check('low_data — 보수적 하한', () => {
  const r = computeEstimate({ count: 1000, unitCost: 30, avgRevenue: 0, actual: null, targetProfile: null });
  assert(r.basis.level === 'low_data', 'level=low_data');
  assert(r.performance.conversionRate <= r.performance.clickRate, 'CVR ≤ CTR');
  assert(r.basis.confidence === 'low', 'confidence=low');
});

check('ROI = 매출 ÷ 비용 × 100', () => {
  const r = computeEstimate({
    count: 1000, unitCost: 30, avgRevenue: 200000,
    actual: { totalSent: 50000, purchase7d: 500, revenuePerMsg: 0, totalCampaigns: 12, hasCdpData: false },
    targetProfile: null,
  });
  const expectedRoi = Math.round((r.performance.expectedRevenue) / (1000 * 30) * 100);
  assert(r.performance.roi === expectedRoi, 'ROI 일치');
});

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
