# 성과 리포트 전면 재설계 — 구현 계획 (2026-06-08)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/performance` 성과 리포트를 산만한 세로 나열에서 3단 위계(헤드라인 KPI 4 + AI 한 줄 진단 → 요약 아이콘 바 → 클릭 시 세부 모달)로 전면 재작성하고, 헤드라인 ROAS 실데이터 지표와 PDF 풀 보고서를 백엔드에 보강한다.

**Architecture:** 백엔드 9개 엔드포인트는 전부 실데이터(점검 완료). 두 가지만 보강한다 — (1) snapshot-v2에 블렌디드 ROAS 지표(`estimatedRoas`, current/previous/diff) 추가(신규 DB 컬럼 0), (2) report-pdf를 풀 보고서로 확장. 프론트는 단일 파일 `PerformancePage.tsx`를 인라인 서브컴포넌트로 재작성(직접 선례 `PredictiveDashboardPage.tsx` 패턴). 다크 톤 `slate-950` + violet, 모든 차트는 모달로 격리, 자사몰 연동 여부(`hasCdpIntegration`)에 따라 적응형.

**Tech Stack:** Node/Express + TypeScript(backend), React 18 + TypeScript + Tailwind + recharts + lucide-react(frontend). 백엔드 테스트 = `manual-test.ts` + `npx ts-node`(vitest 아님). 프론트 테스트 인프라 없음 → 검증 = tsc + 자가 grep.

**확정 결정 (brainstorming 2026-06-08):**
- 헤드라인 KPI 4 = 매출 · ROAS · 성공률 · 활성고객.
- 어제 인사이트(CT-98) = Tier 3 작은 접이식 칩(기본 접힘).
- 백엔드 수정 = Harold 위임("제대로 된 리포트에 필요한 것 판단해 진행") → estimatedRoas 추가 + PDF 풀 보고서 두 건만, DB 스키마 변경 0.

**백엔드 점검 결과 (실측):**
- snapshot-v2(`next-action-advisor.ts:428`): 실데이터. estimatedRevenue current+previous 있음. **top-level ROAS 지표 없음** → 추가 대상. byChannelROI에 채널별 previous revenue/cost 없으나, snapshot 레벨 currentRevenue/previousRevenue + current/previous cost 합으로 블렌디드 ROAS 산출 가능.
- explain(`performance-explainer.ts`): AI(Opus)가 실제 snapshot을 받아 factors/impactScore/topInsight 도출(하드코딩 상수 아님). 30일 고정(`buildPerformanceSnapshot`) — 기간 토글과 별개. v1은 30일 유지(공유 함수라 운영 영향 회피).
- quick-action(`performance-quick-action.ts`): AI(Opus) 실데이터. objective/targetFilters/suggestedChannel/tone/hour/expectedImpact/reasoning 반환.
- cohort/benchmark/attribution/data-availability/campaigns: 전부 실데이터.
- report-pdf(`ai.ts:1345`): 기본형(요약 6지표 + 채널 ROI + 상위 캠페인 + 간단 진단만). AI 서사·시간대·퍼널·기여도·코호트·벤치마크 없음 → 풀 보고서 확장 대상. 라이트 톤(인쇄용) 유지.

**영구 룰 (매 작업 준수):** frontend tsc 0 · 모델명(Opus/Sonnet/GPT/Claude/Anthropic) UI grep 0 · native dialog(alert/confirm/prompt) grep 0 · 박-단어 grep 0 · 다크 톤 slate-950 + violet · 모든 카드/차트 source caption · 모바일 반응형 · CreditConfirmModal/ConfirmModal/useToast · 임의상수 0(실데이터 근거).

---

## 파일 구조

**백엔드 (수정/생성):**
- Create: `packages/backend/src/utils/performance-roas-core.ts` — 블렌디드 ROAS 순수 산출(DB-free, TDD 대상).
- Create: `packages/backend/src/utils/__tests__/performance-roas-core.manual-test.ts` — 위 순수 함수 테스트.
- Modify: `packages/backend/src/utils/next-action-advisor.ts` — `PerformanceSnapshotV2`에 `estimatedRoas` 추가 + 산출 코드.
- Modify: `packages/backend/src/routes/ai.ts` (report-pdf 핸들러 ~1345-1502) — 풀 보고서 섹션 확장.

**프론트 (재작성):**
- Modify(전면 재작성): `packages/frontend/src/pages/PerformancePage.tsx` — 단일 파일, 인라인 서브컴포넌트. 컨테이너(state/fetch 재사용) + Tier1/2/3 + 다크 모달 셸 + 9 모달 + 적응형.

**프론트 단일 파일 유지 근거:** 직접 선례 `PredictiveDashboardPage.tsx`(1093줄)와 현 `PerformancePage.tsx`(1267줄)가 모두 단일 파일 + 인라인 컴포넌트. 프론트 테스트 러너가 없어 분리 TDD 이득 없음. 일관성 우선.

---

## Phase A — 백엔드 보강 (ROAS 지표 + PDF 풀 보고서)

### Task A1: 블렌디드 ROAS 순수 산출 함수 (TDD)

**Files:**
- Create: `packages/backend/src/utils/performance-roas-core.ts`
- Test: `packages/backend/src/utils/__tests__/performance-roas-core.manual-test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`packages/backend/src/utils/__tests__/performance-roas-core.manual-test.ts`:

```ts
/**
 * performance-roas-core 순수 로직 테스트 — ts-node 단독 실행.
 * 실행: npx ts-node src/utils/__tests__/performance-roas-core.manual-test.ts
 *
 * 블렌디드 ROAS = 기간 전체 매출 ÷ 기간 전체 비용. current/previous/diff 산출.
 * 임의상수 0 — 입력(실매출·실비용)만으로 계산. cost 0 / previous 0 가드 검증.
 */
import { computeBlendedRoas, computeRoasMetric } from '../performance-roas-core';

let pass = 0;
let fail = 0;
function check(n: string, f: () => void) {
  try { f(); pass++; console.log('  PASS:', n); }
  catch (e: any) { fail++; console.log('  FAIL:', n, '—', e?.message); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
function near(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) < eps; }

check('정상 ROAS = 매출/비용', () => {
  assert(near(computeBlendedRoas(300000, 100000), 3), '300000/100000 = 3');
});

check('비용 0 → ROAS 0 (0 나눗셈 가드)', () => {
  assert(computeBlendedRoas(300000, 0) === 0, 'cost 0 → 0');
});

check('매출 0 → ROAS 0', () => {
  assert(computeBlendedRoas(0, 100000) === 0, 'revenue 0 → 0');
});

check('NaN/Infinity 입력 → 0', () => {
  assert(computeBlendedRoas(NaN, 100) === 0, 'NaN → 0');
  assert(computeBlendedRoas(Infinity, 0) === 0, 'Inf/0 → 0');
});

check('metric: current/previous/diffPct/betterThan', () => {
  // current ROAS = 2 (200000/100000), previous ROAS = 1 (100000/100000)
  const m = computeRoasMetric(200000, 100000, 100000, 100000);
  assert(near(m.current, 2), 'current 2');
  assert(near(m.previous, 1), 'previous 1');
  assert(near(m.diffPct, 100), 'diff +100%');
  assert(m.betterThan === true, 'better true');
});

check('previous ROAS 0 → diffPct 100(current>0) 또는 0', () => {
  const m1 = computeRoasMetric(200000, 100000, 0, 0);
  assert(m1.previous === 0 && near(m1.diffPct, 100), 'prev 0, current>0 → +100');
  const m2 = computeRoasMetric(0, 100000, 0, 0);
  assert(m2.current === 0 && m2.diffPct === 0, 'both 0 → diff 0');
});

console.log(`\n결과: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/backend && npx ts-node src/utils/__tests__/performance-roas-core.manual-test.ts`
Expected: FAIL — `Cannot find module '../performance-roas-core'`

- [ ] **Step 3: 순수 함수 구현**

`packages/backend/src/utils/performance-roas-core.ts`:

```ts
/**
 * ★ 성과리포트 블렌디드 ROAS 순수 산출 — DB-free (TDD 대상).
 *
 * 헤드라인 ROAS 카드(현재/이전/격차)용. snapshot-v2가 호출.
 * 임의상수 0 — 기간 실매출(cdp_events)·실비용(success × 단가)만으로 계산.
 * 블렌디드 = 채널 합산 매출 ÷ 채널 합산 비용 (개별 채널 평균 아님).
 */

export interface RoasMetric {
  current: number;    // 현재 기간 블렌디드 ROAS (매출/비용). 비용 0 → 0
  previous: number;   // 직전 기간 블렌디드 ROAS
  diffPct: number;    // (current - previous) / previous × 100
  betterThan: boolean;
}

/** 매출 ÷ 비용. 0 나눗셈·NaN·Infinity 가드 → 0 */
export function computeBlendedRoas(revenue: number, cost: number): number {
  if (!isFinite(revenue) || !isFinite(cost) || cost <= 0 || revenue <= 0) return 0;
  const roas = revenue / cost;
  return isFinite(roas) ? roas : 0;
}

/** current/previous 매출·비용 → ROAS 지표(격차 포함). diffPct 규칙은 snapshot calcDiffPct와 동일 */
export function computeRoasMetric(
  currentRevenue: number,
  currentCost: number,
  previousRevenue: number,
  previousCost: number,
): RoasMetric {
  const current = computeBlendedRoas(currentRevenue, currentCost);
  const previous = computeBlendedRoas(previousRevenue, previousCost);
  const diffPct = previous === 0 ? (current > 0 ? 100 : 0) : ((current - previous) / previous) * 100;
  return { current, previous, diffPct, betterThan: current > previous };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/backend && npx ts-node src/utils/__tests__/performance-roas-core.manual-test.ts`
Expected: PASS — `7 pass / 0 fail`

- [ ] **Step 5: 커밋**

```bash
git add packages/backend/src/utils/performance-roas-core.ts packages/backend/src/utils/__tests__/performance-roas-core.manual-test.ts
git commit -m "feat(performance): 블렌디드 ROAS 순수 산출 함수 + TDD"
```

---

### Task A2: snapshot-v2에 estimatedRoas 추가

**Files:**
- Modify: `packages/backend/src/utils/next-action-advisor.ts` (interface `PerformanceSnapshotV2` ~382-401, return ~659-707)

- [ ] **Step 1: import 추가**

`next-action-advisor.ts` 상단 import 묶음에 추가 (기존 `import { query } ...` 근처):

```ts
import { computeRoasMetric } from './performance-roas-core';
import type { RoasMetric } from './performance-roas-core';
```

- [ ] **Step 2: 인터페이스에 estimatedRoas 추가**

`PerformanceSnapshotV2` 인터페이스(현 `estimatedRevenue: PerformanceMetricV2;` 다음 줄)에 추가:

```ts
  estimatedRevenue: PerformanceMetricV2;
  estimatedRoas: RoasMetric;   // 블렌디드 ROAS (기간 매출 ÷ 기간 비용). 헤드라인 ROAS 카드용
```

- [ ] **Step 3: 비용 합산 + estimatedRoas 산출**

`buildPerformanceSnapshotV2` 안, `byChannelROI` 배열 생성 직후(현 ~585) 또는 return 직전에 추가:

```ts
  // 블렌디드 ROAS (기간 전체 매출 ÷ 기간 전체 비용) — 헤드라인 ROAS 카드
  const currentCost = currentMetrics.reduce((s, m) => s + m.cost, 0);
  const previousCost = previousMetrics.reduce((s, m) => s + m.cost, 0);
  const estimatedRoas = computeRoasMetric(currentRevenue, currentCost, previousRevenue, previousCost);
```

- [ ] **Step 4: return 객체에 추가**

return 객체에서 `estimatedRevenue: { ... },` 블록 다음에 추가:

```ts
    estimatedRoas,
```

- [ ] **Step 5: 백엔드 tsc 확인**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: 커밋**

```bash
git add packages/backend/src/utils/next-action-advisor.ts
git commit -m "feat(performance): snapshot-v2 estimatedRoas(블렌디드) 추가"
```

---

### Task A3: report-pdf 풀 보고서 확장

**Files:**
- Modify: `packages/backend/src/routes/ai.ts` (report-pdf 핸들러 ~1345-1502)

**배경:** 현 PDF는 요약 6지표 + 채널 ROI + 상위 캠페인 + 간단 진단만. 풀 보고서로 AI 진단 서사 + 시간대 + 퍼널 + 기여도 + 코호트 + 벤치마크를 추가한다. `explainPerformance`·`buildCohortRetention`·`buildBenchmark`·`buildCampaignAttribution`·`buildPerformanceSnapshot`은 ai.ts에 이미 import됨(다른 라우트가 사용).

- [ ] **Step 1: 데이터 수집 확장 (snapshot 생성 직후, ~1365 다음)**

현 `const snapshot = await buildPerformanceSnapshotV2(companyId, period);` 다음에 추가. 모두 try/catch graceful(실패해도 PDF는 생성):

```ts
    const days = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[period];
    const companyMeta = await query(
      `SELECT company_name, business_type, brand_name, brand_tone FROM companies WHERE id = $1::uuid`,
      [companyId],
    );
    const companyInfo = companyMeta.rows[0] || {};
    // 풀 보고서 부가 데이터 (실패 graceful — PDF 생성은 계속)
    let explanation: Awaited<ReturnType<typeof explainPerformance>> | null = null;
    let cohort: Awaited<ReturnType<typeof buildCohortRetention>> | null = null;
    let benchmark: Awaited<ReturnType<typeof buildBenchmark>> | null = null;
    let attribution: Awaited<ReturnType<typeof buildCampaignAttribution>> | null = null;
    try { const sn = await buildPerformanceSnapshot(companyId); explanation = await explainPerformance(companyId, sn, companyInfo); } catch (e: any) { console.log('[report-pdf] explain skip:', e?.message); }
    try { cohort = await buildCohortRetention(companyId, 12); } catch (e: any) { console.log('[report-pdf] cohort skip:', e?.message); }
    try { benchmark = await buildBenchmark(companyId, days); } catch (e: any) { console.log('[report-pdf] benchmark skip:', e?.message); }
    try { attribution = await buildCampaignAttribution(companyId, days); } catch (e: any) { console.log('[report-pdf] attribution skip:', e?.message); }
```

> 주의: `companyName`은 기존 코드가 별도 query로 가져옴(현 ~1366). 위 `companyInfo.company_name`로 통일하거나 기존 companyName 변수 유지 — 중복 query 1건 제거 권장. 기존 `const companyRow = await query(...)`와 `companyName` 라인을 위 `companyMeta`로 대체하고 `const companyName = companyInfo.company_name || '';`로 정리.

- [ ] **Step 2: AI 진단 서사 섹션 (현 "요약 진단" 블록을 교체/강화)**

현 "요약 진단 (snapshot 수치 기반 — AI 호출 없음)" 블록(~1476-1487)을 다음으로 교체. explanation 있으면 AI 서사, 없으면 기존 snapshot 요약 fallback:

```ts
    // AI 진단 서사 (풀분석 — explanation 있으면 AI, 없으면 snapshot 요약 fallback)
    if (y > 660) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text('AI 자율 진단', 50, y); y += 20;
    if (explanation && explanation.topInsight) {
      setFont(true); doc.fontSize(10).fillColor(dark).text(`전체 성과 스코어 ${explanation.overallScore}/100`, 50, y); y += 16;
      setFont(false); doc.fontSize(9).fillColor(dark).text(explanation.topInsight, 50, y, { width: 495 }); y += 24;
      if (explanation.factors.length > 0) {
        setFont(true); doc.fontSize(9).fillColor(gray).text('영향 요인', 50, y); y += 14;
        setFont(false); doc.fontSize(9);
        for (const f of explanation.factors.slice(0, 6)) {
          if (y > 740) { doc.addPage(); y = 50; }
          const dir = f.direction === 'positive' ? '▲' : f.direction === 'negative' ? '▼' : '–';
          doc.fillColor(dark).text(`${dir} ${f.label} (${Math.round(f.impactScore * 100)}%) — ${f.detail}`, 60, y, { width: 485 }); y += 14;
        }
        y += 4;
      }
      if (explanation.recommendation) {
        setFont(true); doc.fontSize(9).fillColor(primary).text('1순위 권장', 50, y); y += 13;
        setFont(false); doc.fontSize(9).fillColor(dark).text(explanation.recommendation, 60, y, { width: 485 }); y += 18;
      }
      setFont(false); doc.fontSize(7).fillColor(gray).text('AI 자율 진단은 최근 30일 데이터 기준입니다.', 50, y); y += 14;
    } else {
      const best = [...snapshot.byChannelROI].sort((a, b) => (b.roas || 0) - (a.roas || 0))[0];
      setFont(false); doc.fontSize(9).fillColor(dark);
      const lines = [
        `· 기간 추정 매출 ${won(snapshot.estimatedRevenue.current)} (직전 대비 ${dpct(snapshot.estimatedRevenue)})`,
        best ? `· 최고 효율 채널: ${best.channel} (ROAS ${(best.roas || 0).toFixed(2)}x)` : '',
        `· 평균 성공률 ${pctStr(snapshot.successRate.current)} · 활성 고객 ${(snapshot.activeCustomers.current || 0).toLocaleString()}명`,
      ].filter(Boolean);
      for (const ln of lines) { doc.text(ln, 50, y); y += 15; }
    }
    y += 10;
```

- [ ] **Step 3: 시간대 best/worst 섹션**

상위 캠페인 섹션 다음에 추가(byHourWeekday에서 시간별 발송 집계):

```ts
    // 시간대 (발송량 상위/성공률 상위)
    if (y > 690) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text('시간대 분석', 50, y); y += 20;
    const hourAgg = new Map<number, { sent: number; success: number }>();
    for (const c of snapshot.byHourWeekday) {
      const a = hourAgg.get(c.hour) || { sent: 0, success: 0 };
      a.sent += c.sent; a.success += Math.round(c.sent * c.successRate);
      hourAgg.set(c.hour, a);
    }
    const hourRows = Array.from(hourAgg.entries()).filter(([, a]) => a.sent > 0).sort((a, b) => b[1].sent - a[1].sent).slice(0, 5);
    setFont(false); doc.fontSize(9);
    if (hourRows.length === 0) { doc.fillColor(gray).text('발송 데이터 없음', 50, y); y += 16; }
    else {
      for (const [hour, a] of hourRows) {
        const sr = a.sent > 0 ? a.success / a.sent : 0;
        doc.fillColor(dark).text(`${hour}시 — 발송 ${a.sent.toLocaleString()}건 / 성공률 ${pctStr(sr)}`, 50, y); y += 15;
      }
    }
    y += 12;
```

- [ ] **Step 4: 퍼널 + 기여도 섹션 (자사몰)**

```ts
    // 자사몰 퍼널 (funnelStats 있을 때)
    if (snapshot.funnelStats && snapshot.funnelStats.viewCount > 0) {
      if (y > 700) { doc.addPage(); y = 50; }
      const f = snapshot.funnelStats;
      setFont(true); doc.fontSize(13).fillColor(primary).text('자사몰 퍼널', 50, y); y += 20;
      setFont(false); doc.fontSize(9).fillColor(dark);
      doc.text(`조회 ${f.viewCount.toLocaleString()} → 장바구니 ${f.cartAddCount.toLocaleString()} → 위시 ${f.wishlistAddCount.toLocaleString()} → 구매 ${f.purchaseCount.toLocaleString()}`, 50, y); y += 15;
      doc.text(`장바구니 전환율 ${pctStr(f.cartConversionRate)} · 구매 전환율 ${pctStr(f.purchaseConversionRate)} · 장바구니→구매 ${pctStr(f.cartToPurchaseRate)}`, 50, y); y += 18;
    }
    // 기여도 (attribution 있을 때)
    if (attribution && attribution.totalCampaigns > 0 && attribution.windows.length > 0) {
      if (y > 700) { doc.addPage(); y = 50; }
      setFont(true); doc.fontSize(13).fillColor(primary).text('캠페인 발송 후 기여', 50, y); y += 20;
      setFont(false); doc.fontSize(9).fillColor(dark);
      for (const w of attribution.windows) {
        const line = attribution.hasCdpData
          ? `발송 후 ${w.windowLabel} — CDP 구매 ${w.cdpPurchaseCount.toLocaleString()}건 / 매출 ${won(w.cdpRevenue)}`
          : `발송 후 ${w.windowLabel} — 구매 고객 ${w.customerPurchaseCount.toLocaleString()}명 (CDP 미연동 추정)`;
        doc.text(line, 50, y); y += 15;
      }
      y += 8;
    }
```

- [ ] **Step 5: 코호트 + 벤치마크 섹션**

```ts
    // 코호트 잔존
    if (cohort && cohort.cohorts.length > 0) {
      if (y > 700) { doc.addPage(); y = 50; }
      setFont(true); doc.fontSize(13).fillColor(primary).text('가입월별 잔존', 50, y); y += 20;
      setFont(false); doc.fontSize(9).fillColor(dark);
      doc.text(`평균 30일 잔존율 ${pctStr(cohort.avgM1Rate)} · 90일 잔존율 ${pctStr(cohort.avgM3Rate)}`, 50, y); y += 15;
      for (const c of cohort.cohorts.slice(0, 6)) {
        doc.text(`${c.cohortMonth} — 가입 ${c.totalCustomers.toLocaleString()}명 / 30일 ${pctStr(c.m1Rate)} / 90일 ${pctStr(c.m3Rate)}`, 50, y); y += 14;
      }
      y += 8;
    }
    // 업계 벤치마크
    if (benchmark && benchmark.peerCompanyCount > 0 && benchmark.metrics.length > 0) {
      if (y > 700) { doc.addPage(); y = 50; }
      setFont(true); doc.fontSize(13).fillColor(primary).text(`업계 벤치마크 (${benchmark.planName})`, 50, y); y += 20;
      setFont(false); doc.fontSize(9).fillColor(dark);
      for (const m of benchmark.metrics) {
        const cv = m.companyValue < 1 && m.companyValue > 0 ? pctStr(m.companyValue) : Math.round(m.companyValue).toLocaleString();
        const iv = m.industryAvg < 1 && m.industryAvg > 0 ? pctStr(m.industryAvg) : Math.round(m.industryAvg).toLocaleString();
        doc.text(`${m.label} — 우리 ${cv} vs 업계 ${iv} (${m.diffPct >= 0 ? '+' : ''}${m.diffPct.toFixed(1)}%)`, 50, y); y += 14;
      }
      y += 8;
    }
```

- [ ] **Step 6: source caption은 기존 유지** (현 ~1490 `Data source — ...`). 그대로 둠.

- [ ] **Step 7: 백엔드 tsc 확인**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 8: 커밋**

```bash
git add packages/backend/src/routes/ai.ts
git commit -m "feat(performance): report-pdf 풀 보고서 확장(AI 서사·시간대·퍼널·기여·코호트·벤치마크)"
```

---

## Phase B — 프론트 재작성 (PerformancePage.tsx)

> 단일 파일 전면 재작성. 기존 state/fetch(`load`/`loadExplanation`/`loadCampaigns`/`handleQuickAction`/`downloadPdf`)와 인터페이스는 **그대로 재사용**하고, 렌더 구조만 3단 위계로 교체. 기존 차트 JSX는 폐기하지 않고 모달 본문으로 이동(DRY).

### Task B1: 인터페이스 + 포맷 헬퍼 + 컨테이너 셸

**Files:**
- Modify: `packages/frontend/src/pages/PerformancePage.tsx` (상단 인터페이스 + 컴포넌트 함수 본체)

- [ ] **Step 1: SnapshotV2 인터페이스에 estimatedRoas 추가**

`interface SnapshotV2`의 `estimatedRevenue: PerformanceMetricV2;` 다음 줄:

```ts
  estimatedRevenue: PerformanceMetricV2;
  estimatedRoas: PerformanceMetricV2;  // 블렌디드 ROAS (백엔드 신규)
```

- [ ] **Step 2: 포맷 헬퍼 정리 (기존 formatPct/formatWon 유지 + roas/숫자 추가)**

컴포넌트 함수 내부 또는 파일 상단 모듈 스코프에 순수 함수로:

```ts
const formatPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const formatWon = (n: number) => `${Math.round(n).toLocaleString()}원`;
const formatRoas = (n: number) => (n > 0 ? `${n.toFixed(2)}×` : '—');
const formatNum = (n: number) => Math.round(n).toLocaleString();
const formatDiff = (m: PerformanceMetricV2) =>
  m.diffPct === 0 ? '변동 없음' : `${m.diffPct >= 0 ? '+' : ''}${m.diffPct.toFixed(1)}%`;
```

- [ ] **Step 3: 모달 열림 상태 추가**

기존 `useState` 묶음에 추가(단일 활성 모달 키로 관리 — 한 번에 하나):

```ts
type ModalKey =
  | null | 'revenue' | 'channel' | 'hour' | 'funnel'
  | 'attribution' | 'cohort' | 'benchmark' | 'trend' | 'diagnosis' | 'campaigns';
const [activeModal, setActiveModal] = useState<ModalKey>(null);
const [insightExpanded, setInsightExpanded] = useState(false);  // Tier3 어제 인사이트 접이식
```

- [ ] **Step 4: 진단 모달 열 때 explain 지연 로드 연결**

`diagnosis` 모달을 열 때 `loadExplanation()`을 호출하도록 헬퍼:

```ts
const openModal = (key: ModalKey) => {
  if (key === 'diagnosis') loadExplanation();
  setActiveModal(key);
};
const closeModal = () => setActiveModal(null);
```

- [ ] **Step 5: 배경 다크 톤 교체 (slate-950)**

최상위 `<div className="min-h-screen bg-gradient-to-br from-violet-900 ...">`를 교체:

```tsx
<div className="min-h-screen bg-slate-950 text-white">
```

헤더 컨테이너도 `bg-slate-950/80 backdrop-blur-sm border-b border-white/10 sticky top-0 z-30`로 교체.

- [ ] **Step 6: frontend tsc 확인**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: 0 errors (estimatedRoas 미사용 경고는 이후 태스크에서 소비)

- [ ] **Step 7: 커밋**

```bash
git add packages/frontend/src/pages/PerformancePage.tsx
git commit -m "refactor(performance): 인터페이스 estimatedRoas + 포맷 헬퍼 + 모달 상태 + slate-950 톤"
```

---

### Task B2: 헤더 (sticky) — 기간 토글 · CDP 배지 · PDF · 새로고침

**Files:**
- Modify: `packages/frontend/src/pages/PerformancePage.tsx` (헤더 영역)

- [ ] **Step 1: 헤더 우측에 자사몰 연동 상태 배지 추가**

기간 토글 좌측(또는 제목 옆)에 `availability.hasCdpIntegration` 기반 배지:

```tsx
{availability && (
  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
    availability.hasCdpIntegration
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
      : 'bg-white/5 text-white/50 border-white/15'
  }`}>
    {availability.hasCdpIntegration ? '자사몰 연동됨' : '자사몰 미연동'}
  </span>
)}
```

- [ ] **Step 2: 기간 토글/PDF 버튼/새로고침/CreditConfirmModal 유지**

기존 `PERIOD_OPTIONS` 토글 + PDF 버튼(+ `CreditConfirmModal` source="orchestrate") + 새로고침 버튼은 그대로 두되, 색상 클래스를 slate/violet 톤으로 정리(`bg-violet-500/20 text-violet-200 border-violet-400/40` 활성).

- [ ] **Step 3: 부제목 갱신**

부제목을 분석 리포트 성격으로: `과거~현재 마케팅 성과 분석 — 결과·원인·제안`.

- [ ] **Step 4: tsc + 커밋**

Run: `cd packages/frontend && npx tsc --noEmit` → 0 errors
```bash
git add packages/frontend/src/pages/PerformancePage.tsx
git commit -m "feat(performance): 헤더 자사몰 연동 배지 + slate/violet 톤 정리"
```

---

### Task B3: Tier 1 — 헤드라인 KPI 4 + AI 한 줄 진단

**Files:**
- Modify: `packages/frontend/src/pages/PerformancePage.tsx`

- [ ] **Step 1: HeadlineKpiCard 인라인 컴포넌트 추가 (파일 하단 컴포넌트 묶음)**

```tsx
function HeadlineKpiCard({
  label, value, metric, icon, accent, sub, onClick,
}: {
  label: string;
  value: string;
  metric?: PerformanceMetricV2;
  icon: React.ReactNode;
  accent: 'violet' | 'emerald' | 'cyan' | 'amber';
  sub?: string;           // 보조 캡션 (예: "실매출(자사몰)" / "자사몰 연동 시 산출")
  onClick: () => void;
}) {
  const ring: Record<string, string> = {
    violet: 'hover:border-violet-400/50', emerald: 'hover:border-emerald-400/50',
    cyan: 'hover:border-cyan-400/50', amber: 'hover:border-amber-400/50',
  };
  const iconBg: Record<string, string> = {
    violet: 'bg-violet-500/20 text-violet-300', emerald: 'bg-emerald-500/20 text-emerald-300',
    cyan: 'bg-cyan-500/20 text-cyan-300', amber: 'bg-amber-500/20 text-amber-300',
  };
  const diffColor = !metric ? '' : metric.diffPct === 0 ? 'text-white/40' : metric.betterThan ? 'text-emerald-300' : 'text-rose-300';
  const arrow = !metric ? '' : metric.diffPct === 0 ? '─' : metric.betterThan ? '↑' : '↓';
  return (
    <button onClick={onClick} className={`text-left p-4 md:p-5 bg-white/5 border border-white/10 rounded-2xl transition-colors ${ring[accent]} group`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg[accent]}`}>{icon}</div>
        <span className="text-xs text-white/50">{label}</span>
      </div>
      <div className="text-2xl md:text-3xl font-bold text-white truncate" title={value}>{value}</div>
      <div className="flex items-center gap-2 mt-1">
        {metric && <span className={`text-[11px] font-mono ${diffColor}`}>{arrow} {formatDiff(metric)}</span>}
        {sub && <span className="text-[10px] text-white/40">{sub}</span>}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: AiDiagnosisLine 인라인 컴포넌트 추가**

```tsx
function AiDiagnosisLine({
  explanation, loading, onOpen,
}: {
  explanation: PerformanceExplanation | null;
  loading: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="p-4 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-indigo-500/15 border border-violet-400/30 rounded-2xl">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-violet-100">AI 자율 진단</span>
            {explanation && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/30 text-violet-200 border border-violet-400/30 font-mono">{explanation.overallScore}/100</span>}
          </div>
          {explanation ? (
            <>
              <p className="text-xs text-white/80 leading-relaxed">{explanation.topInsight}</p>
              <button onClick={onOpen} className="mt-1.5 text-[11px] text-violet-300 hover:text-violet-200 underline-offset-2 hover:underline">자세히 보기 →</button>
            </>
          ) : loading ? (
            <div className="text-xs text-white/60 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> AI 분석 중 (10~20초)</div>
          ) : (
            <button onClick={onOpen} className="text-xs text-violet-200 hover:text-violet-100 underline-offset-2 hover:underline">AI 자율 진단 시작 →</button>
          )}
          <p className="mt-2 text-[10px] text-white/30 italic">Data source — 최근 30일 campaigns · cdp_events 기반 AI 진단</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Tier 1 렌더 (KPI 4 그리드 + 진단 라인)**

본문 `{!loading && !error && snapshot && (` 안 최상단(데이터 부족 카드 다음)에 배치. 매출·ROAS는 CDP 적응형:

```tsx
{/* Tier 1 — 헤드라인 */}
<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
  <HeadlineKpiCard
    label="매출" accent="violet" icon={<TrendingUp className="w-4 h-4" />}
    value={availability?.hasCdpIntegration && snapshot.estimatedRevenue.current > 0 ? formatWon(snapshot.estimatedRevenue.current) : '—'}
    metric={availability?.hasCdpIntegration && snapshot.estimatedRevenue.current > 0 ? snapshot.estimatedRevenue : undefined}
    sub={availability?.hasCdpIntegration ? '실매출(자사몰)' : '자사몰 연동 시 집계'}
    onClick={() => openModal('revenue')}
  />
  <HeadlineKpiCard
    label="ROAS" accent="cyan" icon={<BarChart3 className="w-4 h-4" />}
    value={formatRoas(snapshot.estimatedRoas.current)}
    metric={snapshot.estimatedRoas.current > 0 ? snapshot.estimatedRoas : undefined}
    sub={snapshot.estimatedRoas.current > 0 ? '매출 ÷ 비용' : '자사몰 매출 연동 시 산출'}
    onClick={() => openModal('channel')}
  />
  <HeadlineKpiCard
    label="성공률" accent="emerald" icon={<Activity className="w-4 h-4" />}
    value={formatPct(snapshot.successRate.current)} metric={snapshot.successRate}
    onClick={() => openModal('trend')}
  />
  <HeadlineKpiCard
    label="활성 고객" accent="amber" icon={<Users className="w-4 h-4" />}
    value={formatNum(snapshot.activeCustomers.current)} metric={snapshot.activeCustomers}
    onClick={() => openModal('cohort')}
  />
</div>
{/* 기간 보조 한 줄 (잔여 지표) */}
<div className="text-[11px] text-white/40">
  이 기간 캠페인 {formatNum(snapshot.totalCampaigns.current)}건 · 총 발송 {formatNum(snapshot.totalSent.current)}건 · 신규 고객 {formatNum(snapshot.newCustomers.current)}명 · 직전 {period} 대비 비교
</div>
<AiDiagnosisLine explanation={explanation} loading={explainLoading} onOpen={() => openModal('diagnosis')} />
```

- [ ] **Step 4: tsc + 자가 grep + 커밋**

Run: `cd packages/frontend && npx tsc --noEmit` → 0 errors
Run(자가 grep): `grep -nE "Opus|Sonnet|GPT|Claude|Anthropic|alert\(|confirm\(|prompt\(|박[음힘는을힌지혀힙히혔힐았]" packages/frontend/src/pages/PerformancePage.tsx` → 0건
```bash
git add packages/frontend/src/pages/PerformancePage.tsx
git commit -m "feat(performance): Tier1 헤드라인 KPI4 + AI 한 줄 진단(CDP 적응형 매출·ROAS)"
```

---

### Task B4: Tier 2 — 요약 아이콘 바 (칩 → 모달)

**Files:**
- Modify: `packages/frontend/src/pages/PerformancePage.tsx`

- [ ] **Step 1: SummaryChip 인라인 컴포넌트**

```tsx
function SummaryChip({
  icon, label, summary, accent, badge, onClick,
}: {
  icon: React.ReactNode; label: string; summary: string;
  accent: string; badge?: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-colors text-left flex-shrink-0">
      <span className={accent}>{icon}</span>
      <span className="flex flex-col">
        <span className="text-xs font-medium text-white/80 flex items-center gap-1">
          {label}
          {badge && <span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-300">{badge}</span>}
        </span>
        <span className="text-[10px] text-white/40">{summary}</span>
      </span>
    </button>
  );
}
```

- [ ] **Step 2: 칩 한 줄 요약 산출 (인라인 표현)**

각 칩의 `summary`는 로드된 데이터에서 한 줄로 산출. 예:
- 채널: `${snapshot.byChannelROI.length}개 채널 · 최고 ROAS ${(가장 높은 roas).toFixed(2)}×`
- 시간대: 최다 발송 시각 `${maxHour}시`
- 퍼널: `구매 전환 ${formatPct(funnelStats.purchaseConversionRate)}` 또는 미연동 시 업셀 칩
- 기여도: `발송 후 7일 구매 ${...}` 또는 미연동 업셀
- 코호트: `30일 잔존 ${formatPct(cohort.avgM1Rate)}`
- 벤치마크: `${benchmark.planName} ${benchmark.peerCompanyCount}개사 평균 대비`
- 추세: `${period} 일별 발송 추이`

(값 없으면 `'데이터 준비 중'`.)

- [ ] **Step 3: 칩 바 렌더 (자사몰 적응형 순서)**

연동 시 퍼널·기여도 칩을 앞쪽으로, 미연동 시 업셀 칩으로:

```tsx
<div className="flex flex-wrap gap-2">
  <SummaryChip icon={<Sparkles className="w-4 h-4" />} accent="text-fuchsia-300" label="채널 ROI" summary={channelSummary} onClick={() => openModal('channel')} />
  <SummaryChip icon={<Clock className="w-4 h-4" />} accent="text-cyan-300" label="시간대" summary={hourSummary} onClick={() => openModal('hour')} />
  {availability?.hasCdpIntegration ? (
    <>
      <SummaryChip icon={<Activity className="w-4 h-4" />} accent="text-emerald-300" label="퍼널" badge="자사몰" summary={funnelSummary} onClick={() => openModal('funnel')} />
      <SummaryChip icon={<MousePointerClick className="w-4 h-4" />} accent="text-violet-300" label="기여도" badge="자사몰" summary={attrSummary} onClick={() => openModal('attribution')} />
    </>
  ) : (
    <SummaryChip icon={<Database className="w-4 h-4" />} accent="text-cyan-300" label="자사몰 연동" summary="실매출·퍼널·기여도 보기" onClick={() => navigate('/cdp-settings')} />
  )}
  <SummaryChip icon={<Users className="w-4 h-4" />} accent="text-violet-300" label="코호트" summary={cohortSummary} onClick={() => openModal('cohort')} />
  <SummaryChip icon={<BarChart3 className="w-4 h-4" />} accent="text-amber-300" label="벤치마크" summary={benchmarkSummary} onClick={() => openModal('benchmark')} />
  <SummaryChip icon={<TrendingUp className="w-4 h-4" />} accent="text-emerald-300" label="추세" summary={`${period} 일별 추이`} onClick={() => openModal('trend')} />
</div>
```

- [ ] **Step 4: tsc + 자가 grep + 커밋**

```bash
git add packages/frontend/src/pages/PerformancePage.tsx
git commit -m "feat(performance): Tier2 요약 아이콘 바(칩→모달·CDP 적응형 순서)"
```

---

### Task B5: 공용 다크 모달 셸 (PerfModal)

**Files:**
- Modify: `packages/frontend/src/pages/PerformancePage.tsx`

- [ ] **Step 1: PerfModal 인라인 컴포넌트 (다크 톤 + ESC + backdrop + source caption)**

ModalBase는 라이트 톤이라 재사용하지 않고 다크 셸을 신설:

```tsx
function PerfModal({
  open, title, icon, source, onClose, children, wide,
}: {
  open: boolean; title: string; icon: React.ReactNode; source?: string;
  onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} max-h-[calc(100vh-2rem)] flex flex-col bg-slate-900 border border-white/10 rounded-2xl shadow-2xl`}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/10 flex-shrink-0">
          {icon}
          <h2 className="text-sm font-semibold text-white flex-1">{title}</h2>
          <button onClick={onClose} aria-label="닫기" className="p-1.5 rounded-lg hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {source && <div className="px-5 py-2.5 border-t border-white/10 text-[10px] text-white/30 italic flex-shrink-0">Data source — {source}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: X 아이콘 import 추가**

상단 lucide import에 `X` 추가.

- [ ] **Step 3: CdpUpsellCard 인라인 컴포넌트 (모달 내 미연동 업셀)**

```tsx
function CdpUpsellCard({ onConnect, lines }: { onConnect: () => void; lines: string }) {
  return (
    <div className="p-5 bg-gradient-to-br from-cyan-500/10 to-violet-500/10 border border-cyan-400/30 rounded-xl text-center">
      <Database className="w-8 h-8 mx-auto text-cyan-300 mb-2" />
      <div className="text-sm font-semibold text-white mb-1">자사몰 연동하면 보입니다</div>
      <div className="text-xs text-white/60 mb-3">{lines}</div>
      <button onClick={onConnect} className="px-3 py-1.5 bg-cyan-500/30 hover:bg-cyan-500/50 text-cyan-50 rounded text-xs font-semibold">자사몰 연동 진입 →</button>
    </div>
  );
}
```

- [ ] **Step 4: tsc + 커밋**

```bash
git add packages/frontend/src/pages/PerformancePage.tsx
git commit -m "feat(performance): 공용 다크 모달 셸 PerfModal + CdpUpsellCard"
```

---

### Task B6: 세부 모달 — 채널/시간대/추세/코호트/벤치마크 (기존 차트 이동)

**Files:**
- Modify: `packages/frontend/src/pages/PerformancePage.tsx`

> 기존 `detailsExpanded` 인라인 차트 6종(현 ~742-957)을 폐기하고, 각 차트 JSX를 해당 PerfModal 본문으로 이동. 차트 코드(recharts BarChart/LineChart, 히트맵 table, FunnelBar)는 동일하게 재사용.

- [ ] **Step 1: 채널 ROI 모달** — 기존 "채널별 ROI 비교" BarChart + 채널별 성공률/비용/ROAS 목록(현 ~744-778)을 `<PerfModal open={activeModal==='channel'} title="채널 ROI" ...>` 본문으로 이동. source="campaigns + MySQL 큐 직접 집계".

- [ ] **Step 2: 시간대 모달** — 기존 "시간대 × 요일 히트맵" table(현 ~780-820)을 `activeModal==='hour'` 모달로 이동. `hourWeekdayMaxSent` useMemo 유지. source="campaigns.sent_at (KST)".

- [ ] **Step 3: 추세 모달** — 기존 "일별 추세" LineChart(현 ~857-873) + `trendData` useMemo 유지를 `activeModal==='trend'` 모달로. source="campaigns (KST 일별 그룹)".

- [ ] **Step 4: 코호트 모달** — 기존 "Retention Curve" LineChart(현 ~907-925) + `cohortChartData` useMemo 유지를 `activeModal==='cohort'` 모달로. 미데이터 시 "가입·구매 데이터 누적 후 활성". source=cohort.source.

- [ ] **Step 5: 벤치마크 모달** — 기존 벤치마크 metrics 그리드(현 ~927-956)를 `activeModal==='benchmark'` 모달로. peerCompanyCount===0 시 source 메시지. source=benchmark.source.

- [ ] **Step 6: FunnelBar 컴포넌트 유지** (현 ~1254, 퍼널 모달에서 사용).

- [ ] **Step 7: tsc + 자가 grep + 커밋**

```bash
git add packages/frontend/src/pages/PerformancePage.tsx
git commit -m "feat(performance): 채널/시간대/추세/코호트/벤치마크 세부 모달(기존 차트 이동)"
```

---

### Task B7: CDP 적응형 모달 — 매출·기여 / 퍼널

**Files:**
- Modify: `packages/frontend/src/pages/PerformancePage.tsx`

- [ ] **Step 1: 매출·기여 모달 (`activeModal==='revenue'`)**

연동 시: attribution.windows별 발송→구매 기여 매출·건수(기존 attribution 카드 JSX 현 ~875-905 재사용) + estimatedRevenue current/previous. 미연동 시: `CdpUpsellCard`(lines="실매출·발송 후 구매 기여를 자사몰 연동 시 집계합니다") + `navigate('/cdp-settings')`.

- [ ] **Step 2: 퍼널 모달 (`activeModal==='funnel'`)**

연동 + funnelStats 있으면: 기존 FunnelBar 4단 + 전환율 3칸(현 ~822-844) 재사용. 미연동/데이터 없음: `CdpUpsellCard`(lines="조회→장바구니→구매 전환 퍼널을 자사몰 연동 시 시각화합니다").

- [ ] **Step 3: 기여도 모달 (`activeModal==='attribution'`)** — 매출·기여 모달과 분리 운용하거나 동일 컴포넌트 재사용. 기여도 칩은 attribution.windows 표 중심, 매출 칩은 estimatedRevenue 중심으로 구분. (중복 시 attribution 표를 두 모달에서 공유하는 내부 렌더 함수 1개로 DRY.)

- [ ] **Step 4: tsc + 자가 grep + 커밋**

```bash
git add packages/frontend/src/pages/PerformancePage.tsx
git commit -m "feat(performance): 매출·기여/퍼널 CDP 적응형 모달 + 업셀"
```

---

### Task B8: AI 진단 모달 (factors 전체 + recommendation + 1-click 연결)

**Files:**
- Modify: `packages/frontend/src/pages/PerformancePage.tsx`

- [ ] **Step 1: 진단 모달 (`activeModal==='diagnosis'`)**

기존 "AI 영향 요인" 블록(현 ~960-993)을 모달 본문으로 이동 + overallScore + factors 막대(impactScore) + direction 색 + detail + recommendation 카드. 하단에 1-click 액션 3행(QuickActionRow, Task B9) 연결("이 진단을 액션으로"). explainLoading 시 스피너. source="factors[].sourceField".

- [ ] **Step 2: tsc + 커밋**

```bash
git add packages/frontend/src/pages/PerformancePage.tsx
git commit -m "feat(performance): AI 진단 모달(영향 요인·권장·1클릭 연결)"
```

---

### Task B9: Tier 3 — 1-click 액션 + Top 캠페인 모달 + 어제 인사이트 칩

**Files:**
- Modify: `packages/frontend/src/pages/PerformancePage.tsx`

- [ ] **Step 1: QuickActionRow 인라인 컴포넌트 (컴팩트 3행)**

기존 `QuickActionCard`(현 ~1187)를 컴팩트 행 버전으로 재구성(rose/emerald/amber color-coded). 클릭 = 기존 `handleQuickAction` → CreditConfirmModal 경유. **주의:** quick-action도 크레딧 차감이면 `CreditConfirmModal`로 감싸기(현재 handleQuickAction은 즉시 navigate — 차감 발생 지점 확인 후 필요 시 confirm 게이트 추가). 차감 없으면 그대로.

- [ ] **Step 2: Tier 3 렌더 (1-click 3행 + Top 캠페인 3 + 어제 인사이트 칩)**

```tsx
{/* Tier 3 — 액션 & 보조 */}
<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
  <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
    <div className="text-xs font-semibold text-white/70 mb-2">추천 액션 (AI 자동 마케팅)</div>
    {/* QuickActionRow ×3 */}
  </div>
  <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-semibold text-white/70">Top 캠페인</span>
      <button onClick={() => openModal('campaigns')} className="text-[11px] text-violet-300 hover:text-violet-200">전체 보기 →</button>
    </div>
    {/* snapshot.topCampaigns.slice(0,3) 컴팩트 행 */}
  </div>
</div>
```

- [ ] **Step 3: 어제 인사이트 칩 (접이식)**

기존 큰 일일 인사이트 카드(현 ~551-604)를 Tier 3 작은 접이식 칩으로 축소:

```tsx
{dailyInsight && (
  <div className="bg-white/5 border border-white/10 rounded-xl">
    <button onClick={() => setInsightExpanded(!insightExpanded)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
      <Sparkles className="w-3.5 h-3.5 text-violet-300" />
      <span className="text-xs text-white/70">어제 발송 {formatNum(dailyInsight.yesterdaySent)}건 · 성공 {formatNum(dailyInsight.yesterdaySuccess)} · 활성 {formatNum(dailyInsight.totalCustomers)}</span>
      {insightExpanded ? <ChevronUp className="w-3.5 h-3.5 ml-auto text-white/40" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto text-white/40" />}
    </button>
    {insightExpanded && (
      <div className="px-4 pb-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        {/* 어제 발송/성공/실패/활성 4칸 + source caption (기존 내용 축소 재사용) */}
      </div>
    )}
  </div>
)}
```

`ChevronUp`/`ChevronDown` import 추가.

- [ ] **Step 4: 캠페인 드릴다운 모달 (`activeModal==='campaigns'`)**

기존 Top 캠페인 테이블 + 드릴다운(검색/필터/정렬/페이지, 현 ~996-1145) 전체를 `PerfModal wide`로 이동. `loadCampaigns` useEffect 트리거를 `activeModal==='campaigns'`로 변경(기존 `campaignsExpanded` 대체). 모달 내부 select 옵션 배경 `bg-slate-900`.

- [ ] **Step 5: tsc + 자가 grep + 커밋**

```bash
git add packages/frontend/src/pages/PerformancePage.tsx
git commit -m "feat(performance): Tier3 1클릭 액션·Top캠페인·어제 인사이트 칩·캠페인 드릴다운 모달"
```

---

### Task B10: 데이터 부족 카드 배치 + 죽은 코드 제거 + 최종 정리

**Files:**
- Modify: `packages/frontend/src/pages/PerformancePage.tsx`

- [ ] **Step 1: 데이터 부족 카드 유지** — `availability.cards`(현 ~619-662)는 Tier1 위(상단)에 간결하게 유지. critical/warning만 눈에 띄게, good은 작게.

- [ ] **Step 2: 죽은 코드 제거** — `detailsExpanded` state + 토글 버튼 + 인라인 차트 묶음 + 기존 큰 SummaryMetricCard 6그리드(현 ~719-740) + 기존 QuickActionCard 3그리드(현 ~689-717) + 기존 AI 영향 요인 인라인 블록 등, 모달로 이동되어 더 이상 안 쓰는 코드 전부 삭제. `SummaryMetricCard` 컴포넌트가 미사용이면 제거.

- [ ] **Step 3: 하단 면책 문구 유지** — "이 추천은 AI 분석 결과이며 사용자 검토 + 승인 후 발송됩니다" + 마지막 계산 시각(현 ~1147-1151)은 그대로.

- [ ] **Step 4: 모든 모달 렌더 배치** — 본문 최하단에 9개 `<PerfModal>` + `CreditConfirmModal`을 한 곳에 모아 렌더.

- [ ] **Step 5: 전체 tsc + 자가 grep (영구 룰 최종)**

Run: `cd packages/frontend && npx tsc --noEmit` → 0 errors
Run: `grep -nE "Opus|Sonnet|GPT|Claude|Anthropic" packages/frontend/src/pages/PerformancePage.tsx` → 0건
Run: `grep -nE "alert\(|confirm\(|prompt\(" packages/frontend/src/pages/PerformancePage.tsx` → 0건
Run: `grep -nE "박[음힘는을힌지혀힙히혔힐았]" packages/frontend/src/pages/PerformancePage.tsx` → 0건
Run(source caption 존재): `grep -c "Data source" packages/frontend/src/pages/PerformancePage.tsx` → 모든 모달/차트 수 이상

- [ ] **Step 6: 커밋**

```bash
git add packages/frontend/src/pages/PerformancePage.tsx
git commit -m "refactor(performance): 데이터 부족 카드 배치 + 죽은 코드 제거 + 모달 일괄 배치"
```

---

## Phase C — 통합 검증

### Task C1: 백엔드 + 프론트 tsc 동시 0 + 순수 테스트 재확인

- [ ] **Step 1: 백엔드 tsc**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: 프론트 tsc**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: ROAS 순수 테스트 재실행**

Run: `cd packages/backend && npx ts-node src/utils/__tests__/performance-roas-core.manual-test.ts`
Expected: `7 pass / 0 fail`

- [ ] **Step 4: 영구 룰 grep 최종 (프론트 전체)**

Run: `grep -rnE "Opus|Sonnet|GPT|Claude|Anthropic|alert\(|confirm\(|prompt\(" packages/frontend/src/pages/PerformancePage.tsx`
Expected: 0건 (모델명/native dialog)

### Task C2: 빌드 안전 검증 + 종료 멘트

- [ ] **Step 1: 안전 빌드 (Harold 실행 영역 — AI는 명령만 안내)**

배포는 Harold 직접: `tp-push "성과 리포트 전면 재설계"` + 서버 backend/frontend `npm run build:safe` + `pm2 restart all`.

- [ ] **Step 2: Codex 이중 검증 권장** — `/codex:review`(프론트 재작성) + `/codex:adversarial-review`(report-pdf·snapshot estimatedRoas — 돈/매출 연관).

- [ ] **Step 3: 표준 종료 멘트** — "작업이 완료되었습니다. Harold님, 직접 git add/commit/push 및 배포를 진행해 주세요."

---

## Self-Review (계획 ↔ 설계 문서 대조)

**스펙 커버리지:**
- §2 3단 위계 → Task B3(Tier1)·B4(Tier2)·B6~B9(모달=Tier3 세부). ✓
- §2 6종 인라인 차트 모달 격리 → Task B6 (기존 차트 이동). ✓
- §2 분석 서사(결과→원인→제안) → topInsight(Tier1) → factors(B8 진단 모달) → recommendation→1클릭(B8/B9). ✓
- §2 다크 slate-950 + violet → B1 Step5. ✓
- §2 native dialog 0 / 모델명 0 / source caption / 모바일 / CreditConfirmModal → B3/B10 grep + PerfModal source + grid 반응형 + CreditConfirmModal 유지. ✓
- §4 헤드라인 KPI4(매출·ROAS·성공률·활성고객) + AI 한 줄 → B3. ✓ (ROAS 실데이터 = A1/A2)
- §4 Tier2 칩 7종 → B4. ✓
- §4 Tier3 1클릭·Top·어제 인사이트 칩 → B9. ✓
- §5 모달 공통 셸(slate-900·X·ESC·backdrop·source) → B5. ✓ 각 모달 → B6~B9. ✓
- §6 자사몰 적응형(hasCdpIntegration) → B2 배지·B3 매출/ROAS·B4 칩 순서·B7 업셀. ✓
- §7 AI 해석 서사 + 임의상수 0 → explain 실데이터 확인(점검 완료)·impactScore=AI 판정(상수 아님). ✓
- §8 PDF 풀 보고서 → A3. ✓
- §9 컴포넌트 분해 → 단일 파일 인라인(선례 일치) + ROAS 순수만 backend 분리. ✓ (근거 명시)
- §10 검증/영구 룰 → C1/C2 + 각 태스크 grep. ✓

**미해결/주의:**
- explain·quick-action 30일 고정(기간 토글 무관) — 공유 함수 운영 영향 회피로 v1 유지. AI 진단 모달/라인에 "최근 30일 기준" 명시. 향후 기간 연동은 별도 과제.
- 매출/ROAS는 자사몰 미연동 시 실데이터 0 → 허위 추정 생성 X, "연동 시 집계" 정직 안내(임의상수 금지 룰 준수).
- quick-action 차감 여부에 따라 CreditConfirmModal 게이트(B9 Step1) — 구현 시 차감 지점 확인.

**타입 일관성:** `estimatedRoas`는 backend `RoasMetric`(current/previous/diffPct/betterThan) = frontend `PerformanceMetricV2`와 동일 4필드 → frontend는 `PerformanceMetricV2`로 받음. `computeRoasMetric`/`computeBlendedRoas` 시그니처 A1↔A2 일치. `ModalKey`/`openModal`/`closeModal`/`activeModal` 명칭 B1~B10 통일.
