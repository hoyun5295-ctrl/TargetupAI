/**
 * operator-performance-estimator 순수 계산 테스트 — 백엔드 vitest 부재로 ts-node 단독 실행.
 * 실행: npx ts-node src/utils/__tests__/operator-performance-estimator.manual-test.ts
 * 종료코드 0 = 전부 통과.
 */
import { computeEstimate } from '../operator-performance-estimator';

let pass = 0;
let fail = 0;
function check(n: string, f: () => void) {
  try { f(); pass++; console.log('  PASS:', n); }
  catch (e: any) { fail++; console.log('  FAIL:', n, '—', e?.message); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

check('campaign_actual — 과거 실측 전환율 사용', () => {
  const r = computeEstimate({
    count: 1000, unitCost: 30, avgRevenue: 200000,
    actual: { totalSent: 5000, purchase7d: 150, revenuePerMsg: 0, totalCampaigns: 12, hasCdpData: false },
    targetProfile: null,
  });
  assert(r.basis.level === 'campaign_actual', 'level=campaign_actual');
  assert(Math.abs(r.performance.conversionRate - 0.03) < 0.001, 'CVR=150/5000=3%');
  assert(r.performance.expectedConversions === 30, 'conv=1000*0.03=30');
  assert(r.performance.expectedRevenue === 30 * 200000, 'rev=conv*객단가');
  assert(r.basis.confidence === 'high', 'confidence=high');
});

check('campaign_actual — hasCdpData면 실측 매출/건 우선', () => {
  const r = computeEstimate({
    count: 1000, unitCost: 30, avgRevenue: 50000,
    actual: { totalSent: 5000, purchase7d: 150, revenuePerMsg: 8000, totalCampaigns: 12, hasCdpData: true },
    targetProfile: null,
  });
  assert(r.performance.expectedRevenue === 1000 * 8000, 'rev=count*revenuePerMsg');
});

check('target_profile — VIP 고객단가 반영 (옛 50만 사고 정정)', () => {
  const r = computeEstimate({
    count: 1301, unitCost: 27, avgRevenue: 400000,
    actual: null, targetProfile: { avgPurchaseCount: 5, activeRatio: 0.8 },
  });
  assert(r.basis.level === 'target_profile', 'level=target_profile');
  assert(r.performance.conversionRate > 0.005, '보정으로 base 초과');
  assert(r.performance.expectedRevenue > 500000, 'VIP 객단가40만 반영 → 50만 초과');
  assert(r.basis.confidence === 'medium', 'confidence=medium');
});

check('low_data — 보수적 하한', () => {
  const r = computeEstimate({ count: 1000, unitCost: 30, avgRevenue: 0, actual: null, targetProfile: null });
  assert(r.basis.level === 'low_data', 'level=low_data');
  assert(r.performance.conversionRate === 0.005, 'base CVR 0.5%');
  assert(r.basis.confidence === 'low', 'confidence=low');
});

check('ROI 계산', () => {
  const r = computeEstimate({
    count: 1000, unitCost: 30, avgRevenue: 200000,
    actual: { totalSent: 5000, purchase7d: 150, revenuePerMsg: 0, totalCampaigns: 12, hasCdpData: false },
    targetProfile: null,
  });
  assert(r.performance.roi === Math.round((30 * 200000) / (1000 * 30) * 100), 'ROI=매출/비용*100');
});

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
