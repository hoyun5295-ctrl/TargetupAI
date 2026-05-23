/**
 * CT-60: Journey Simulator — D211+ Phase A (2026-05-23 Harold 명시)
 *
 * 본질: 활성화 직전 가상 실행 영역 — 회사 admin "활성화 전 안심" 본질.
 *   - 트리거 매칭 customer 수 (실시간 SQL)
 *   - step별 예상 발송 건수 (funnel 비율 반영)
 *   - 예상 비용 (channel별 단가 × 발송 건수)
 *   - 예상 클릭률 (Predictive Suite + Beta 사전 분포)
 *   - 예상 매출 영향 (purchase_likelihood × 평균 객단가)
 *
 * 영구 룰 정합:
 *   - 회사 격리 (companyId 의무)
 *   - 모델 호출 0건 (Read-only SQL 영역 — 비용 영역 0)
 *   - feedback_no_target_auto_relax (매칭 0건 영역 = 빈 결과 + 안내만)
 *
 * 사용처:
 *   - GET /operator/journeys/:id/simulate
 *   - JourneysPage 활성화 직전 시뮬레이션 카드
 */

import { query } from '../config/database';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 인터페이스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface JourneySimulationResult {
  journeyId: string;
  simulatedAt: Date;
  triggerEvent: string;
  matchedCustomers: number;
  customerSegments: SegmentBreakdown[];
  steps: StepSimulation[];
  totalEstimatedSends: number;
  totalEstimatedCost: number;
  estimatedClickRate: number;
  estimatedConversionRate: number;
  estimatedRevenue: number;
  reasoning: string;
  warnings: string[];
}

export interface SegmentBreakdown {
  segment: string;       // 'VIP' / 'Gold' / 'Silver' / '일반' / '신규'
  count: number;
  pct: number;
}

export interface StepSimulation {
  stepOrder: number;
  stepType: string;
  channel: string | null;
  expectedSends: number;
  expectedCost: number;
  expectedClicks: number;
  expectedConversions: number;
  cumulativeRetention: number; // 0~1 (Step N entered / Step 1 entered)
}

// 채널별 단가 매트릭스 (원/건) — 옛 평균 영역 정합
const CHANNEL_UNIT_COST: Record<string, number> = {
  sms: 9,
  lms: 30,
  mms: 100,
  kakao: 8,
};

// 단계 간 평균 잔존율 (옛 평균 영역) — 보수 영역
const STEP_RETENTION_RATE = 0.85;

// 평균 객단가 (한국 마케팅 영역 평균 — 회사별 정합 영역 향후 추가)
const AVG_PURCHASE_AMOUNT = 50_000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. simulateJourney — 활성화 직전 가상 실행
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function simulateJourney(
  journeyId: string,
  companyId: string,
): Promise<JourneySimulationResult> {
  // 회사 격리 + journey 정보 조회
  const jRes = await query(
    `SELECT id, trigger_event, trigger_filters, allow_reentry, reentry_cooldown_days
     FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
    [journeyId, companyId],
  );
  if (jRes.rows.length === 0) {
    throw new Error('여정 접근 권한 없음 (회사 격리)');
  }
  const journey = jRes.rows[0];

  // step 매트릭스
  const stepsRes = await query(
    `SELECT id, step_order, step_type, channel, delay_hours
     FROM journey_steps WHERE journey_id = $1::uuid
     ORDER BY step_order ASC`,
    [journeyId],
  );
  const steps = stepsRes.rows;

  // 트리거 매칭 customer 수 + 등급 분포 + Predictive 평균
  const matched = await matchTriggerCustomers(journey, companyId);

  const warnings: string[] = [];
  if (matched.count === 0) {
    warnings.push('트리거 조건에 매칭되는 customer 영역 0건 — 활성화하면 즉시 발송 영역 0건. 트리거 영역 또는 customer_conditions 영역 검토 권장.');
  }
  if (steps.length === 0) {
    warnings.push('step 영역 0건 — 발송 영역 X.');
  }

  // step별 시뮬레이션
  const stepSimulations: StepSimulation[] = [];
  let cumulativeRetention = 1.0;
  let totalSends = 0;
  let totalCost = 0;
  let totalClicks = 0;
  let totalConversions = 0;

  for (const s of steps) {
    if (s.step_type === 'message') {
      const expectedSends = Math.floor(matched.count * cumulativeRetention);
      const unitCost = CHANNEL_UNIT_COST[s.channel || 'sms'] || 9;
      const expectedCost = expectedSends * unitCost;
      const expectedClicks = Math.floor(expectedSends * matched.avgClickScore);
      const expectedConversions = Math.floor(expectedSends * matched.avgPurchaseLikelihood);

      stepSimulations.push({
        stepOrder: s.step_order,
        stepType: s.step_type,
        channel: s.channel,
        expectedSends,
        expectedCost,
        expectedClicks,
        expectedConversions,
        cumulativeRetention,
      });

      totalSends += expectedSends;
      totalCost += expectedCost;
      totalClicks += expectedClicks;
      totalConversions += expectedConversions;
    } else {
      // wait / condition step — 발송 영역 X / 잔존율 적용
      stepSimulations.push({
        stepOrder: s.step_order,
        stepType: s.step_type,
        channel: null,
        expectedSends: 0,
        expectedCost: 0,
        expectedClicks: 0,
        expectedConversions: 0,
        cumulativeRetention,
      });
    }
    // 각 step 후 잔존율 감소 (이탈 영역 반영)
    cumulativeRetention *= STEP_RETENTION_RATE;
  }

  const estimatedRevenue = totalConversions * AVG_PURCHASE_AMOUNT;
  const estimatedClickRate = totalSends > 0 ? totalClicks / totalSends : 0;
  const estimatedConversionRate = totalSends > 0 ? totalConversions / totalSends : 0;

  const reasoning = buildReasoning(matched, steps.length, totalSends, totalCost, estimatedRevenue);

  return {
    journeyId,
    simulatedAt: new Date(),
    triggerEvent: journey.trigger_event,
    matchedCustomers: matched.count,
    customerSegments: matched.segments,
    steps: stepSimulations,
    totalEstimatedSends: totalSends,
    totalEstimatedCost: totalCost,
    estimatedClickRate,
    estimatedConversionRate,
    estimatedRevenue,
    reasoning,
    warnings,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. 트리거 매칭 customer + Predictive 평균
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface MatchResult {
  count: number;
  segments: SegmentBreakdown[];
  avgClickScore: number;
  avgPurchaseLikelihood: number;
}

async function matchTriggerCustomers(
  journey: any,
  companyId: string,
): Promise<MatchResult> {
  const filters = journey.trigger_filters || {};

  // 트리거별 SQL 매트릭스 (옛 trigger-watcher 패턴 정합)
  let baseWhere = `c.company_id = $1::uuid AND c.is_active = true AND c.sms_opt_in = true`;
  const params: any[] = [companyId];

  switch (journey.trigger_event) {
    case 'customer.created':
      params.push(String(Number(filters.recent_hours || 24)));
      baseWhere += ` AND c.created_at >= NOW() - ($${params.length} || ' hours')::interval`;
      break;
    case 'customer.dormant': {
      const dormantDays = Number(filters.dormant_days || 30);
      params.push(String(dormantDays));
      params.push(String(dormantDays + 7));
      baseWhere += ` AND c.recent_purchase_date IS NOT NULL
                     AND c.recent_purchase_date < (CURRENT_DATE - ($${params.length - 1} || ' days')::interval)
                     AND c.recent_purchase_date > (CURRENT_DATE - ($${params.length} || ' days')::interval)`;
      break;
    }
    case 'customer.birthday_approaching': {
      const daysBefore = Number(filters.days_before || 7);
      params.push(String(daysBefore));
      baseWhere += ` AND (
        (c.birth_month_day IS NOT NULL AND c.birth_month_day = TO_CHAR((CURRENT_DATE + ($${params.length} || ' days')::interval), 'MM-DD'))
        OR (c.birth_date IS NOT NULL AND TO_CHAR(c.birth_date, 'MM-DD') = TO_CHAR((CURRENT_DATE + ($${params.length} || ' days')::interval), 'MM-DD'))
      )`;
      break;
    }
    case 'cdp.purchase':
    case 'cdp.reservation_created':
    case 'cdp.cart_abandon':
      // CDP 영역 = 옛 30일 누적 customer 영역 추정 (시뮬레이션 영역 정합)
      baseWhere += ` AND EXISTS (
        SELECT 1 FROM cdp_events e
        WHERE e.company_id = $1::uuid
          AND e.customer_id = c.id
          AND e.occurred_at >= NOW() - INTERVAL '30 days'
      )`;
      break;
    default:
      // custom 영역 = 전체 active customer 영역 (보수 추정)
      break;
  }

  // ★ D211+ Phase 5 (2026-05-23 Harold 명시): customer_conditions 복합 영역 적용
  const customerConditions = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
  if (customerConditions) {
    baseWhere += ` AND ${customerConditions}`;
  }

  // 카운트 + 등급 분포
  const countRes = await query(
    `SELECT
       COUNT(*)::int AS total,
       COALESCE(c.grade, '일반') AS segment
     FROM customers c
     WHERE ${baseWhere}
     GROUP BY COALESCE(c.grade, '일반')`,
    params,
  );

  let totalCount = 0;
  const segments: SegmentBreakdown[] = [];
  for (const row of countRes.rows) {
    const cnt = Number(row.total) || 0;
    totalCount += cnt;
    segments.push({ segment: row.segment, count: cnt, pct: 0 });
  }
  segments.forEach((s) => (s.pct = totalCount > 0 ? s.count / totalCount : 0));
  segments.sort((a, b) => b.count - a.count);

  // Predictive 평균 (cdp_customer_predictions 영역 활용)
  const predRes = await query(
    `SELECT
       AVG(p.click_score) AS avg_click,
       AVG(p.purchase_likelihood) AS avg_purchase
     FROM cdp_customer_predictions p
     INNER JOIN customers c ON c.id = p.customer_id
     WHERE ${baseWhere}`,
    params,
  );

  const avgClickScore = Number(predRes.rows[0]?.avg_click) || 0.15;
  const avgPurchaseLikelihood = Number(predRes.rows[0]?.avg_purchase) || 0.05;

  return {
    count: totalCount,
    segments,
    avgClickScore,
    avgPurchaseLikelihood,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. customer_conditions 복합 영역 SQL 생성 (5번 트리거 복합 조합 영역)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function applyCustomerConditions(
  conditions: Array<{ field: string; op: string; value: any }>,
  logic: 'AND' | 'OR',
  params: any[],
): string | null {
  if (!conditions || conditions.length === 0) return null;
  const allowedFields = ['grade', 'region', 'age', 'purchase_count', 'total_purchase_amount', 'sms_opt_in'];
  const allowedOps = ['==', '!=', '>=', '<=', '>', '<', 'in', 'not_in', 'is_null', 'not_null'];
  const clauses: string[] = [];

  for (const cond of conditions) {
    if (!allowedFields.includes(cond.field)) continue;
    if (!allowedOps.includes(cond.op)) continue;

    const col = `c.${cond.field}`;
    if (cond.op === 'is_null') {
      clauses.push(`${col} IS NULL`);
      continue;
    }
    if (cond.op === 'not_null') {
      clauses.push(`${col} IS NOT NULL`);
      continue;
    }
    if (cond.op === 'in' || cond.op === 'not_in') {
      const values = Array.isArray(cond.value) ? cond.value : [cond.value];
      if (values.length === 0) continue;
      const placeholders = values.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      clauses.push(`${col} ${cond.op === 'in' ? 'IN' : 'NOT IN'} (${placeholders.join(', ')})`);
      continue;
    }
    // 일반 비교 operator
    const sqlOp = cond.op === '==' ? '=' : cond.op;
    params.push(cond.value);
    clauses.push(`${col} ${sqlOp} $${params.length}`);
  }

  if (clauses.length === 0) return null;
  const joiner = logic === 'OR' ? ' OR ' : ' AND ';
  return `(${clauses.join(joiner)})`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. reasoning 안내 한국어 생성
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildReasoning(
  matched: MatchResult,
  stepCount: number,
  totalSends: number,
  totalCost: number,
  estimatedRevenue: number,
): string {
  if (matched.count === 0) {
    return '트리거 조건에 매칭되는 customer 영역 0건 — 활성화 시 즉시 발송 영역 0건. 조건 영역 검토 후 재시뮬레이션 권장.';
  }
  if (stepCount === 0) {
    return 'step 영역 0건 — 발송 영역 없음.';
  }

  const topSegment = matched.segments[0];
  const segText = topSegment ? `최다 ${topSegment.segment} 영역 ${topSegment.count.toLocaleString()}명 (${(topSegment.pct * 100).toFixed(0)}%)` : '';
  const roiText = totalCost > 0 ? ` · 예상 ROI ${(estimatedRevenue / totalCost).toFixed(1)}배` : '';

  return `트리거 매칭 ${matched.count.toLocaleString()}명${segText ? ` (${segText})` : ''} · 총 발송 영역 ${totalSends.toLocaleString()}건 · 예상 비용 ${totalCost.toLocaleString()}원 · 예상 매출 ${estimatedRevenue.toLocaleString()}원${roiText}`;
}
