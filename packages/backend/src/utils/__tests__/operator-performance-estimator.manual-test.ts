/**
 * operator-performance-estimator 순수 계산 테스트 — 백엔드 vitest 부재로 ts-node 단독 실행.
 * 실행: npx ts-node src/utils/__tests__/operator-performance-estimator.manual-test.ts
 * 종료코드 0 = 전부 통과.
 *
 * D227+ 완전 데이터 기반 재설계 — 전환율/클릭률을 임의 상수가 아니라
 *   (1) 등급별 cdp 실측 (2) 등급별 구매주기 (3) 데이터 부족 시 정직 안내 로 도출.
 *   임의 상수 0 (CVR/CTR 상한·uplift·window·conv_per_click 하드코딩 제거).
 *   물리 법칙(전환 ≤ 클릭 ≤ 발송, 비율 ≤ 이상치 가드)만 최후 게이트로 유지.
 */
import { computeEstimate } from '../operator-performance-estimator';

let pass = 0;
let fail = 0;
function check(n: string, f: () => void) {
  try { f(); pass++; console.log('  PASS:', n); }
  catch (e: any) { fail++; console.log('  FAIL:', n, '—', e?.message); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

// 이상치 방어 가드 (정상 흐름은 이 값 근처에 가지 않음 — 산식 결함 감지용 최후 게이트)
const HARD_GUARD = 0.6;

// ═══════════════════════════════════════════════════════
// Layer 1 — 등급별 cdp 실측 (표본 충분 시 그 회사 실제 전환율 직접 사용, 상수 0)
// ═══════════════════════════════════════════════════════

check('등급 cdp 실측 충분 → grade_actual + 실측 cvr 직접 사용', () => {
  const r = computeEstimate({
    count: 1000, unitCost: 30, eventWindowDays: null, uplift: null,
    gradeStats: [{ grade: 'VIP', count: 1000, avgCycleDays: 10, activeRatio: 1, aov: 100000, actualCvr: 0.08, actualSampleOk: true }],
    companyActual: null, fallbackAvgRevenue: 50000,
  });
  assert(r.basis.level === 'grade_actual', `level=${r.basis.level}`);
  assert(Math.abs(r.performance.conversionRate - 0.08) < 0.005, `cvr=실측 8% (실제 ${r.performance.conversionRate})`);
  assert(r.basis.confidence === 'high', 'confidence=high');
});

// ═══════════════════════════════════════════════════════
// Layer 2 — 등급별 구매주기 (실측 부족 시 주력). 등급 차등 필수.
// ═══════════════════════════════════════════════════════

check('등급 차등 — VIP 구매주기 짧음 > 일반 (purchase_cycle)', () => {
  const base = { count: 1000, unitCost: 30, eventWindowDays: 7, uplift: null, companyActual: null, fallbackAvgRevenue: 50000 };
  const vip = computeEstimate({ ...base, gradeStats: [{ grade: 'VIP', count: 1000, avgCycleDays: 9, activeRatio: 1, aov: 100000, actualCvr: null, actualSampleOk: false }] });
  const normal = computeEstimate({ ...base, gradeStats: [{ grade: '일반', count: 1000, avgCycleDays: 300, activeRatio: 0.3, aov: 30000, actualCvr: null, actualSampleOk: false }] });
  assert(vip.basis.level === 'purchase_cycle', `vip level=${vip.basis.level}`);
  assert(vip.performance.conversionRate > normal.performance.conversionRate * 2,
    `VIP ${(vip.performance.conversionRate * 100).toFixed(1)}% > 일반 ${(normal.performance.conversionRate * 100).toFixed(1)}% 2배+`);
  assert(vip.performance.conversionRate <= HARD_GUARD, '가드 내');
});

check('행사기간 길수록 전환↑ (EVENT_WINDOW 3일 하드코딩 제거 증명)', () => {
  const base = {
    count: 1000, unitCost: 30, uplift: null, companyActual: null, fallbackAvgRevenue: 50000,
    gradeStats: [{ grade: 'Gold', count: 1000, avgCycleDays: 30, activeRatio: 1, aov: 50000, actualCvr: null, actualSampleOk: false }],
  };
  const short = computeEstimate({ ...base, eventWindowDays: 3 });
  const long = computeEstimate({ ...base, eventWindowDays: 14 });
  assert(long.performance.conversionRate > short.performance.conversionRate,
    `긴 행사 ${(long.performance.conversionRate * 100).toFixed(1)}% > 짧은 행사 ${(short.performance.conversionRate * 100).toFixed(1)}%`);
});

check('uplift 실측 도출 반영 — 클수록 전환↑ (MESSAGE_UPLIFT 1.4 하드코딩 제거 증명)', () => {
  const base = {
    count: 1000, unitCost: 30, eventWindowDays: 7, companyActual: null, fallbackAvgRevenue: 50000,
    gradeStats: [{ grade: 'Gold', count: 1000, avgCycleDays: 30, activeRatio: 1, aov: 50000, actualCvr: null, actualSampleOk: false }],
  };
  const u1 = computeEstimate({ ...base, uplift: 1.0 });
  const u2 = computeEstimate({ ...base, uplift: 2.0 });
  assert(u2.performance.conversionRate > u1.performance.conversionRate, 'uplift 2.0 > 1.0');
});

// ═══════════════════════════════════════════════════════
// Layer 3 — 데이터 부족 시 정직 안내 (가짜 숫자 X)
// ═══════════════════════════════════════════════════════

check('구매 데이터 전무 → insufficient_data + 수치 0 (가짜 숫자 차단)', () => {
  const r = computeEstimate({
    count: 1000, unitCost: 30, eventWindowDays: null, uplift: null,
    gradeStats: [{ grade: '신규', count: 1000, avgCycleDays: null, activeRatio: 0, aov: 0, actualCvr: null, actualSampleOk: false }],
    companyActual: null, fallbackAvgRevenue: 0,
  });
  assert(r.basis.level === 'insufficient_data', `level=${r.basis.level}`);
  assert(r.performance.expectedConversions === 0, `전환 수치 0 (실제 ${r.performance.expectedConversions})`);
  assert(r.performance.expectedRevenue === 0, '매출 수치 0');
  assert(r.basis.confidence === 'low', 'confidence=low');
});

// ═══════════════════════════════════════════════════════
// 회사 전체 발송 실측 (등급/구매주기 둘 다 부족할 때만)
// ═══════════════════════════════════════════════════════

check('등급/구매주기 부재 + 회사 발송실측 충분 → campaign_actual', () => {
  const r = computeEstimate({
    count: 1000, unitCost: 30, eventWindowDays: null, uplift: null,
    gradeStats: [],
    companyActual: { totalSent: 50000, purchase7d: 500, revenuePerMsg: 0, totalCampaigns: 12, hasCdpData: false },
    fallbackAvgRevenue: 80000,
  });
  assert(r.basis.level === 'campaign_actual', `level=${r.basis.level}`);
  assert(Math.abs(r.performance.conversionRate - 0.01) < 0.003, `cvr≈1% (실제 ${r.performance.conversionRate})`);
});

// ═══════════════════════════════════════════════════════
// 물리 법칙 — 어떤 입력에도 절대 위반 불가 (사기 숫자 차단)
// ═══════════════════════════════════════════════════════

check('물리법칙 — 깨진 입력에도 전환 ≤ 클릭 ≤ 발송, 비율 0~가드', () => {
  const r = computeEstimate({
    count: 1000, unitCost: 30, eventWindowDays: 30, uplift: 9,
    gradeStats: [{ grade: 'VIP', count: 1000, avgCycleDays: 1, activeRatio: 1, aov: 100000, actualCvr: 0.99, actualSampleOk: true }],
    companyActual: null, fallbackAvgRevenue: 50000,
  });
  assert(r.performance.conversionRate >= 0 && r.performance.conversionRate <= HARD_GUARD, `0≤CVR≤가드 (${r.performance.conversionRate})`);
  assert(r.performance.conversionRate <= r.performance.clickRate, '전환율 ≤ 클릭률');
  assert(r.performance.expectedClicks <= 1000, '클릭수 ≤ 발송수');
  assert(r.performance.expectedConversions <= r.performance.expectedClicks, '전환수 ≤ 클릭수');
});

// ═══════════════════════════════════════════════════════
// ROI 절대액 — 매출/비용 절대액 일관 (수만% 비현실 표기 방지)
// ═══════════════════════════════════════════════════════

check('ROI 절대액 — 매출=전환×객단가, 비용=발송×단가 일관', () => {
  const r = computeEstimate({
    count: 1000, unitCost: 30, eventWindowDays: 7, uplift: null,
    gradeStats: [{ grade: 'VIP', count: 1000, avgCycleDays: 15, activeRatio: 1, aov: 100000, actualCvr: null, actualSampleOk: false }],
    companyActual: null, fallbackAvgRevenue: 50000,
  });
  assert(r.cost.estimated === 30000, `비용=1000×30 (실제 ${r.cost.estimated})`);
  assert(r.performance.expectedRevenue === r.performance.expectedConversions * 100000,
    `매출=전환×객단가 (${r.performance.expectedRevenue} vs ${r.performance.expectedConversions * 100000})`);
  assert(r.performance.roi === Math.round(r.performance.expectedRevenue / 30000 * 100), 'ROI 일관');
});

// ═══════════════════════════════════════════════════════
// 등급 가중 — 여러 등급 혼합 타겟 = 등급별 cvr의 타겟수 가중평균
// ═══════════════════════════════════════════════════════

check('등급 혼합 타겟 → 등급별 가중평균 (고전환 등급 비중↑ 시 전체 전환↑)', () => {
  const base = { count: 2000, unitCost: 30, eventWindowDays: 7, uplift: null, companyActual: null, fallbackAvgRevenue: 50000 };
  const vipHeavy = computeEstimate({ ...base, gradeStats: [
    { grade: 'VIP', count: 1500, avgCycleDays: 9, activeRatio: 1, aov: 100000, actualCvr: null, actualSampleOk: false },
    { grade: '일반', count: 500, avgCycleDays: 300, activeRatio: 0.3, aov: 30000, actualCvr: null, actualSampleOk: false },
  ]});
  const normalHeavy = computeEstimate({ ...base, gradeStats: [
    { grade: 'VIP', count: 500, avgCycleDays: 9, activeRatio: 1, aov: 100000, actualCvr: null, actualSampleOk: false },
    { grade: '일반', count: 1500, avgCycleDays: 300, activeRatio: 0.3, aov: 30000, actualCvr: null, actualSampleOk: false },
  ]});
  assert(vipHeavy.performance.conversionRate > normalHeavy.performance.conversionRate, 'VIP 비중 높을수록 전체 전환↑');
});

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
