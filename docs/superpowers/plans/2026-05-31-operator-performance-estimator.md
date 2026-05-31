# AI Operator 성과 추정 실데이터 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 또는 subagent-driven-development. 체크박스(`- [ ]`) 추적.

**Goal:** AI Operator 제안서의 "예상 성과"를 전 회사 고정 하드코딩(전환 0.8% × 객단가 5만원)에서 타겟 고객 실제 데이터 + 과거 캠페인 실측 기반 추정으로 전환한다.

**Architecture:** 신규 CT `utils/operator-performance-estimator.ts`가 (1) 타겟 filters로 매칭된 고객의 실제 객단가를 쿼리하고 (2) `buildCampaignAttribution` 과거 실측 → 타겟 구매성향 보정 → 보수적 하한 3단계로 전환율을 산출한다. `calculateCostROI`를 대체하고 orchestrate/orchestrateWithAI 양쪽이 호출. 추정 근거(basis)를 응답+화면에 노출.

**Tech Stack:** Express + PG(customers/campaigns/cdp_events) + TS + React.

**전제(클로드 원칙 db_column_verify_before_code):** customers 컬럼 5건(avg_order_value/total_purchase_amount/purchase_count/recent_purchase_date/grade) information_schema 검증 SQL을 Harold에게 제공 → 결과 확인 후 Task 2 쿼리 확정. SCHEMA.md는 참조용.

**기존 시그니처(확인 완료):**
- `buildCampaignAttribution(companyId, analysisPeriodDays=30)` → `{ totalCampaigns, totalSent, totalSuccess, windows[{windowLabel,cdpPurchaseCount,cdpRevenue,customerPurchaseCount}], hasCdpData }`. (clickRate/conversionRate 필드 없음 → 직접 계산)
- `buildFilterWhereClauseCompat(filters, startParamIndex)` → `{ sql, params }`.
- 호출부: ai-orchestrator.ts:420(orchestrate), :833(orchestrateWithAI).
- 프론트: AiOperatorPage.tsx performance 타입(L84~) + 표시(L1089~1136).

---

## Task 0: 컬럼 검증 게이트 (코드 작성 전 필수)

- [ ] **Step 1:** Harold에게 검증 SQL 제공 + 결과 확인:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'customers'
  AND column_name IN ('avg_order_value','total_purchase_amount','purchase_count','recent_purchase_date','grade');
```
Expected: 5건 모두 존재. 누락 컬럼 있으면 Task 2 쿼리에서 해당 컬럼 제외 + fallback 경로로.

---

## Task 1: estimator 타입 + 골격 + 테스트 (전환율 계산 순수 함수)

**Files:** Create `packages/backend/src/utils/operator-performance-estimator.ts` + `packages/backend/src/utils/__tests__/operator-performance-estimator.manual-test.ts`

- [ ] **Step 1: 순수 계산 함수 + 타입 작성** (DB 무관 부분 먼저 — TDD 가능)

```typescript
// operator-performance-estimator.ts (1차 — 순수 계산부)
export type EstimateBasisLevel = 'campaign_actual' | 'target_profile' | 'low_data';

export interface PerformanceEstimate {
  cost: { estimated: number; unitCost: number; breakdown: string };
  performance: {
    expectedClicks: number;
    expectedConversions: number;
    expectedRevenue: number;
    clickRate: number;
    conversionRate: number;
    avgRevenue: number;
    roi: number;
  };
  basis: {
    level: EstimateBasisLevel;
    label: string;
    confidence: 'high' | 'medium' | 'low';
    notes: string[];
  };
}

// 보수적 하한 (campaign_actual 데이터 없을 때만)
const BASE_CLICK_RATE = 0.02;
const BASE_CONVERSION_RATE = 0.005;
const ACTUAL_MIN_SENT = 100; // 실측 신뢰 임계

interface ComputeInput {
  count: number;
  unitCost: number;
  avgRevenue: number;          // 타겟 실제 객단가 (Task 2에서 주입)
  // 과거 실측 (Task 3에서 주입, 없으면 null)
  actual: { totalSent: number; purchase7d: number; revenuePerMsg: number; totalCampaigns: number; hasCdpData: boolean } | null;
  // 타겟 구매성향 (Task 2에서 주입)
  targetProfile: { avgPurchaseCount: number; activeRatio: number } | null; // activeRatio = 최근 90일 구매 비율
}

export function computeEstimate(input: ComputeInput): PerformanceEstimate {
  const { count, unitCost, avgRevenue, actual, targetProfile } = input;
  const estimatedCost = Math.round(count * unitCost);

  let clickRate = BASE_CLICK_RATE;
  let conversionRate = BASE_CONVERSION_RATE;
  let level: EstimateBasisLevel = 'low_data';
  let label = '데이터 부족 — 보수적 추정';
  let confidence: 'high' | 'medium' | 'low' = 'low';
  const notes: string[] = [];

  if (actual && actual.totalSent >= ACTUAL_MIN_SENT && actual.totalCampaigns >= 1) {
    // 1단계: 과거 실측
    conversionRate = Math.min(0.5, actual.purchase7d / actual.totalSent);
    clickRate = Math.max(conversionRate * 3, BASE_CLICK_RATE); // 클릭 실측 없음 → 전환의 3배 추정
    level = 'campaign_actual';
    label = `과거 ${actual.totalCampaigns}개 캠페인 실측 기반`;
    confidence = 'high';
    notes.push(`최근 발송 ${actual.totalSent.toLocaleString()}건 중 7일 내 구매 ${actual.purchase7d.toLocaleString()}건`);
  } else if (targetProfile) {
    // 2단계: 타겟 구매성향 보정 (등급 하드코딩 X — 실제 지표 기반)
    // 재구매 성향: 평균 구매횟수 2회 이상이면 base 대비 상향, 활성 비율 가중
    const repeatFactor = Math.min(3, 1 + (targetProfile.avgPurchaseCount - 1) * 0.5); // 1회=1.0, 3회=2.0, 5회=3.0(cap)
    const activeFactor = 0.5 + targetProfile.activeRatio;                              // 활성0%=0.5, 100%=1.5
    conversionRate = Math.min(0.3, BASE_CONVERSION_RATE * repeatFactor * activeFactor);
    clickRate = Math.max(conversionRate * 3, BASE_CLICK_RATE);
    level = 'target_profile';
    label = '타겟 고객 구매성향 기반 추정';
    confidence = 'medium';
    notes.push(`타겟 평균 구매 ${targetProfile.avgPurchaseCount.toFixed(1)}회 · 최근 활성 ${Math.round(targetProfile.activeRatio * 100)}%`);
  } else {
    notes.push('과거 캠페인·타겟 구매 데이터 부족 — 발송이 쌓이면 정확해집니다');
  }

  const expectedClicks = Math.round(count * clickRate);
  const expectedConversions = Math.round(count * conversionRate);
  // 매출 = 실측 매출/건이 있으면 우선, 없으면 전환수 × 객단가
  const expectedRevenue = actual && actual.hasCdpData && actual.revenuePerMsg > 0
    ? Math.round(count * actual.revenuePerMsg)
    : Math.round(expectedConversions * avgRevenue);
  const roi = estimatedCost > 0 ? Math.round((expectedRevenue / estimatedCost) * 100) : 0;

  return {
    cost: { estimated: estimatedCost, unitCost, breakdown: `${count.toLocaleString()}건 × ${unitCost.toLocaleString()}원` },
    performance: { expectedClicks, expectedConversions, expectedRevenue, clickRate, conversionRate, avgRevenue, roi },
    basis: { level, label, confidence, notes },
  };
}
```

- [ ] **Step 2: 테스트 작성** (3단계 분기 + 객단가 반영)

```typescript
// __tests__/operator-performance-estimator.manual-test.ts
import { computeEstimate } from '../operator-performance-estimator';
let pass=0, fail=0;
function check(n:string,f:()=>void){try{f();pass++;console.log('  PASS:',n);}catch(e:any){fail++;console.log('  FAIL:',n,'—',e?.message);}}
function assert(c:boolean,m:string){if(!c)throw new Error(m);}

check('campaign_actual — 실측 전환율 사용', () => {
  const r = computeEstimate({ count:1000, unitCost:30, avgRevenue:200000,
    actual:{ totalSent:5000, purchase7d:150, revenuePerMsg:0, totalCampaigns:12, hasCdpData:false }, targetProfile:null });
  assert(r.basis.level==='campaign_actual', 'level');
  assert(Math.abs(r.performance.conversionRate - 0.03) < 0.001, 'CVR=150/5000=3%');
  assert(r.performance.expectedConversions === 30, 'conv=1000*0.03=30');
  assert(r.performance.expectedRevenue === 30*200000, 'rev=conv*객단가');
});

check('campaign_actual — hasCdpData면 실측 매출/건 우선', () => {
  const r = computeEstimate({ count:1000, unitCost:30, avgRevenue:50000,
    actual:{ totalSent:5000, purchase7d:150, revenuePerMsg:8000, totalCampaigns:12, hasCdpData:true }, targetProfile:null });
  assert(r.performance.expectedRevenue === 1000*8000, 'rev=count*revenuePerMsg');
});

check('target_profile — VIP 고객단가 반영', () => {
  const r = computeEstimate({ count:1301, unitCost:27, avgRevenue:400000,
    actual:null, targetProfile:{ avgPurchaseCount:5, activeRatio:0.8 } });
  assert(r.basis.level==='target_profile', 'level');
  assert(r.performance.conversionRate > 0.005, '보정으로 base 초과');
  assert(r.performance.expectedRevenue > 500000, 'VIP 객단가40만 반영 → 50만 초과 (옛 사고 정정)');
  assert(r.basis.confidence==='medium', 'confidence');
});

check('low_data — 보수적 하한', () => {
  const r = computeEstimate({ count:1000, unitCost:30, avgRevenue:0, actual:null, targetProfile:null });
  assert(r.basis.level==='low_data', 'level');
  assert(r.performance.conversionRate === 0.005, 'base CVR');
  assert(r.basis.confidence==='low', 'confidence');
});

check('ROI 계산', () => {
  const r = computeEstimate({ count:1000, unitCost:30, avgRevenue:200000,
    actual:{ totalSent:5000, purchase7d:150, revenuePerMsg:0, totalCampaigns:12, hasCdpData:false }, targetProfile:null });
  assert(r.performance.roi === Math.round((30*200000)/(1000*30)*100), 'ROI=매출/비용*100');
});

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail>0?1:0);
```

- [ ] **Step 3: RED 확인** — Run: `cd packages/backend && npx ts-node src/utils/__tests__/operator-performance-estimator.manual-test.ts` → 모듈/함수 없어 실패 또는 import 에러
- [ ] **Step 4: Step 1 코드로 GREEN** — Run 동일 → `5 pass / 0 fail`
- [ ] **Step 5: tsc 0** — Run: `npx tsc --noEmit` → EXIT 0

---

## Task 2: 타겟 객단가 + 구매성향 쿼리 (DB 연동)

**Files:** Modify `packages/backend/src/utils/operator-performance-estimator.ts` (DB 함수 추가)

- [ ] **Step 1: 타겟 프로필 쿼리 함수 추가** (Task 0 컬럼 검증 결과 반영)

```typescript
import { query } from '../config/database';
import { buildFilterWhereClauseCompat } from './customer-filter';

interface TargetProfileResult {
  avgRevenue: number;        // 객단가
  avgPurchaseCount: number;
  activeRatio: number;       // 최근 90일 구매 비율
}

export async function fetchTargetProfile(companyId: string, filters: Record<string, any>): Promise<TargetProfileResult> {
  const { sql: filterWhere, params: filterParams } = buildFilterWhereClauseCompat(filters, 2);
  const r = await query(
    `SELECT
        AVG(NULLIF(c.avg_order_value, 0))                                                    AS aov,
        AVG(CASE WHEN COALESCE(c.purchase_count,0) > 0
                 THEN c.total_purchase_amount / c.purchase_count END)                        AS aov_fallback,
        AVG(COALESCE(c.purchase_count, 0))::float                                            AS avg_pc,
        AVG(CASE WHEN c.recent_purchase_date >= CURRENT_DATE - INTERVAL '90 days'
                 THEN 1.0 ELSE 0.0 END)::float                                               AS active_ratio
      FROM customers c
      WHERE c.company_id = $1::uuid AND c.is_active = true ${filterWhere}`,
    [companyId, ...filterParams],
  );
  const row = r.rows[0] || {};
  const avgRevenue = Number(row.aov) > 0 ? Number(row.aov) : (Number(row.aov_fallback) || 0);
  return {
    avgRevenue: Math.round(avgRevenue),
    avgPurchaseCount: Number(row.avg_pc) || 0,
    activeRatio: Number(row.active_ratio) || 0,
  };
}
```

- [ ] **Step 2: tsc 0** — Run: `npx tsc --noEmit`

---

## Task 3: 과거 실측 어댑터 + estimatePerformance 통합

**Files:** Modify `packages/backend/src/utils/operator-performance-estimator.ts`

- [ ] **Step 1: buildCampaignAttribution → actual 변환 + 메인 진입점**

```typescript
import { buildCampaignAttribution } from './campaign-response-attribution';

export interface EstimateInput {
  companyId: string;
  filters: Record<string, any>;
  count: number;
  channel: string;
  unitCost: number;
  fallbackAvgRevenue: number; // 전체 고객 평균 (customerStats.avg_total_spent)
}

export async function estimatePerformance(input: EstimateInput): Promise<PerformanceEstimate> {
  const { companyId, filters, count, unitCost, fallbackAvgRevenue } = input;

  // 1) 타겟 프로필 (객단가 + 구매성향)
  let profile: TargetProfileResult | null = null;
  try { profile = await fetchTargetProfile(companyId, filters); }
  catch (e: any) { console.log('[estimator] fetchTargetProfile skip:', e?.message); }

  const avgRevenue = (profile && profile.avgRevenue > 0) ? profile.avgRevenue : (fallbackAvgRevenue || 0);

  // 2) 과거 실측 (90일)
  let actual: ComputeInput['actual'] = null;
  try {
    const attr = await buildCampaignAttribution(companyId, 90);
    if (attr.totalCampaigns >= 1 && attr.totalSent > 0) {
      const w7 = attr.windows.find((w) => w.windowLabel === '7d');
      const purchase7d = w7 ? (attr.hasCdpData ? w7.cdpPurchaseCount : w7.customerPurchaseCount) : 0;
      const revenuePerMsg = (attr.hasCdpData && w7 && attr.totalSent > 0) ? (w7.cdpRevenue / attr.totalSent) : 0;
      actual = { totalSent: attr.totalSent, purchase7d, revenuePerMsg, totalCampaigns: attr.totalCampaigns, hasCdpData: attr.hasCdpData };
    }
  } catch (e: any) { console.log('[estimator] buildCampaignAttribution skip:', e?.message); }

  // 3) 순수 계산
  const targetProfile = profile ? { avgPurchaseCount: profile.avgPurchaseCount, activeRatio: profile.activeRatio } : null;
  return computeEstimate({ count, unitCost, avgRevenue, actual, targetProfile });
}
```

- [ ] **Step 2: tsc 0** — Run: `npx tsc --noEmit`

---

## Task 4: orchestrator 2곳 교체

**Files:** Modify `packages/backend/src/services/ai-orchestrator.ts` (import + L420 + L833 + OrchestratorResult.performance 타입)

- [ ] **Step 1: import 추가 + performance 타입 확장**

```typescript
import { estimatePerformance, PerformanceEstimate } from '../utils/operator-performance-estimator';
```
OrchestratorResult.performance에 추가: `avgRevenue: number; roi: number; basis: { level: string; label: string; confidence: string; notes: string[] };`

- [ ] **Step 2: orchestrate() L418~426 교체** (calculateCostROI → estimatePerformance)

```typescript
  // ============ 5. 성과 추정 (실데이터 기반) ============
  const costStart = Date.now();
  const unitCost = (getCompanyCosts(ctx.companyInfo) as Record<string, number>)[(targetResult.recommended_channel || 'SMS').toLowerCase()] ?? getCompanyCosts(ctx.companyInfo).sms;
  const est = await estimatePerformance({
    companyId: ctx.companyId,
    filters: targetResult.filters,
    count: estimatedCount,
    channel: targetResult.recommended_channel || 'SMS',
    unitCost,
    fallbackAvgRevenue: parseFloat(ctx.customerStats.avg_total_spent) || 0,
  });
  mark('costRoi', costStart);
```
return의 `cost: costRoi.cost` → `cost: est.cost`, `performance: costRoi.performance` → `performance: est.performance`. basis는 performance 안에 포함하거나 meta로.

- [ ] **Step 3: orchestrateWithAI() L833 동일 교체** (estimatedCount/targetResult 동일 스코프 확인)
- [ ] **Step 4: calculateCostROI 제거** (다른 소비처 grep 0 확인 후 — `grep -rn calculateCostROI`)
- [ ] **Step 5: backend tsc 0** — Run: `npx tsc --noEmit` → EXIT 0

---

## Task 5: 프론트 표시 (basis 근거 + 신뢰도 배지)

**Files:** Modify `packages/frontend/src/pages/AiOperatorPage.tsx` (performance 타입 L84 + 표시 L1089~1136)

- [ ] **Step 1: performance 타입에 avgRevenue/roi/basis 추가** (백엔드 응답과 일치)
- [ ] **Step 2: 예상 성과 카드에 basis.label + confidence 배지**

```tsx
{proposal.performance.basis && (
  <div className="mt-2 flex items-center gap-2">
    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
      proposal.performance.basis.confidence === 'high' ? 'bg-emerald-500/20 text-emerald-300'
      : proposal.performance.basis.confidence === 'medium' ? 'bg-amber-500/20 text-amber-300'
      : 'bg-white/10 text-white/50'}`}>
      {proposal.performance.basis.label}
    </span>
  </div>
)}
{proposal.performance.basis?.confidence === 'low' && (
  <p className="text-[10px] text-white/40 mt-1">데이터가 쌓이면 정확해집니다</p>
)}
```

- [ ] **Step 3: ROI 표시를 performance.roi 직접 사용** (기존 L1131 즉석 계산 → est.roi)
- [ ] **Step 4: frontend tsc 0** — Run: `cd packages/frontend && npx tsc --noEmit`

---

## Task 6: 통합 검증 + 자가 grep

- [ ] backend tsc 0 / frontend tsc 0 / estimator 테스트 5/5
- [ ] `grep -rn calculateCostROI` = 0 (완전 제거 확인)
- [ ] 자가 grep: 박-단어/모델명/native dialog 0 (변경 파일)
- [ ] 내장 code-review

## Task 7: 배포 후 실측 (Harold)
- [ ] 같은 입력("VIP 30% 할인")으로 예상 성과가 객단가 반영된 현실 수치 + basis 근거 노출 확인

---

## Self-Review

**스펙 커버리지:** 객단가 실제값(Task 2) / 전환율 3단계(Task 1·3) / basis 화면(Task 5) / 호출부 교체(Task 4) — 전부 태스크 있음.
**컬럼 검증:** Task 0이 db_column_verify 게이트. Task 2 쿼리는 결과 확인 후 확정.
**타입 일관성:** PerformanceEstimate / computeEstimate / fetchTargetProfile / estimatePerformance / EstimateInput 명칭 통일.
**범위 밖:** 머신러닝 예측, 시간대별 세분 추정(향후).
