/**
 * CT-51 utils/journey-stats.ts (D192 2026-05-22)
 *
 * Journey 통계 + monitoring 집계 컨트롤타워
 *
 * 사용처: routes/ai.ts /operator/journeys/:id/stats endpoint
 *  + routes/ai.ts /operator/journeys/:id/customers endpoint
 *
 * 영구 원칙 정합:
 *  - 회사 격리 의무 (journeyId → company_id 검증 진입 직전)
 *  - cdp_events + journey_executions + journey_step_logs + journey_step_variants 통합
 *  - 6,000사+ 운영 영향 0 (Read-only 집계)
 */

import { query } from '../config/database';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 인터페이스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface JourneyOverview {
  journeyId: string;
  totalEntered: number;
  active: number;
  completed: number;
  paused: number;
  failed: number;
  totalCost: number;
  totalSent: number;
  totalFailed: number;
  totalSkipped: number;
  avgCompletionHours: number | null;
  completionRate: number;  // completed / totalEntered
}

export interface JourneyStepStat {
  stepId: string;
  stepOrder: number;
  stepType: string;
  channel: string | null;
  enteredCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  totalCost: number;
  clickCount: number;
  conversionCount: number;
  clickRate: number;       // clickCount / sentCount
  conversionRate: number;  // conversionCount / sentCount
}

export interface JourneySegmentStat {
  segment: string;     // 'VIP' / 'Gold' / 'Silver' / '일반' / '신규' / null
  enteredCount: number;
  completedCount: number;
  clickCount: number;
  conversionCount: number;
}

export interface JourneyHourlyStat {
  hour: number;  // 0~23
  sentCount: number;
  clickCount: number;
  conversionCount: number;
}

export interface JourneyWeekdayStat {
  weekday: number;  // 0(일)~6(토)
  sentCount: number;
  clickCount: number;
  conversionCount: number;
}

export interface JourneyVariantStat {
  stepId: string;
  variantId: string;
  variantLabel: string;
  trafficWeight: number;
  sentCount: number;
  clickCount: number;
  conversionCount: number;
  posteriorMean: number;
  posteriorAlpha: number;
  posteriorBeta: number;
}

export interface JourneyCustomerRow {
  executionId: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  customerGrade: string | null;
  customerRegion: string | null;
  currentStepOrder: number;
  status: string;
  enteredAt: string;
  completedAt: string | null;
  totalCost: number;
}

export interface JourneyFullStats {
  overview: JourneyOverview;
  steps: JourneyStepStat[];
  segments: JourneySegmentStat[];
  hourly: JourneyHourlyStat[];
  weekday: JourneyWeekdayStat[];
  variants: JourneyVariantStat[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 회사 격리 검증 (모든 통계 함수 진입 직전 의무)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function verifyJourneyOwnership(journeyId: string, companyId: string): Promise<void> {
  const r = await query(
    `SELECT 1 FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
    [journeyId, companyId]
  );
  if (r.rows.length === 0) {
    throw new Error('여정 접근 권한 없음 (회사 격리)');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. Journey overview (전체 통계)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getJourneyOverview(journeyId: string): Promise<JourneyOverview> {
  const execRes = await query(
    `SELECT
       COUNT(*) AS total_entered,
       COUNT(*) FILTER (WHERE status = 'active') AS active,
       COUNT(*) FILTER (WHERE status = 'completed') AS completed,
       COUNT(*) FILTER (WHERE status = 'paused') AS paused,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed,
       COALESCE(SUM(total_cost), 0) AS total_cost,
       AVG(EXTRACT(EPOCH FROM (completed_at - entered_at)) / 3600) FILTER (WHERE completed_at IS NOT NULL) AS avg_completion_hours
     FROM journey_executions
     WHERE journey_id = $1::uuid`,
    [journeyId]
  );

  const logRes = await query(
    `SELECT
       COUNT(*) FILTER (WHERE l.status = 'sent') AS total_sent,
       COUNT(*) FILTER (WHERE l.status = 'failed') AS total_failed,
       COUNT(*) FILTER (WHERE l.status = 'skipped') AS total_skipped
     FROM journey_step_logs l
     INNER JOIN journey_executions e ON e.id = l.execution_id
     WHERE e.journey_id = $1::uuid`,
    [journeyId]
  );

  const exec = execRes.rows[0] || {};
  const log = logRes.rows[0] || {};
  const totalEntered = Number(exec.total_entered) || 0;
  const completed = Number(exec.completed) || 0;

  return {
    journeyId,
    totalEntered,
    active: Number(exec.active) || 0,
    completed,
    paused: Number(exec.paused) || 0,
    failed: Number(exec.failed) || 0,
    totalCost: Number(exec.total_cost) || 0,
    totalSent: Number(log.total_sent) || 0,
    totalFailed: Number(log.total_failed) || 0,
    totalSkipped: Number(log.total_skipped) || 0,
    avgCompletionHours: exec.avg_completion_hours != null ? Number(exec.avg_completion_hours) : null,
    completionRate: totalEntered > 0 ? completed / totalEntered : 0,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Journey step 통계 (step별 발송/클릭/전환)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getJourneyStepStats(journeyId: string): Promise<JourneyStepStat[]> {
  const r = await query(
    `SELECT
       s.id AS step_id,
       s.step_order,
       s.step_type,
       s.channel,
       COUNT(DISTINCT l.execution_id) AS entered_count,
       COUNT(*) FILTER (WHERE l.status = 'sent') AS sent_count,
       COUNT(*) FILTER (WHERE l.status = 'failed') AS failed_count,
       COUNT(*) FILTER (WHERE l.status = 'skipped') AS skipped_count,
       COALESCE(SUM(l.cost), 0) AS total_cost,
       (
         SELECT COUNT(*)
         FROM cdp_events ce
         WHERE ce.event_name = 'message_click'
           AND (ce.properties->>'step_id')::uuid = s.id
       ) AS click_count,
       (
         SELECT COUNT(DISTINCT ce.customer_id)
         FROM cdp_events ce
         WHERE ce.event_name = 'order'
           AND ce.customer_id IN (
             SELECT e2.customer_id FROM journey_executions e2 WHERE e2.journey_id = $1::uuid
           )
           AND ce.occurred_at > (
             SELECT MIN(l2.sent_at) FROM journey_step_logs l2
             WHERE l2.step_id = s.id AND l2.execution_id IN (
               SELECT e2.id FROM journey_executions e2 WHERE e2.journey_id = $1::uuid
             )
           )
       ) AS conversion_count
     FROM journey_steps s
     LEFT JOIN journey_step_logs l ON l.step_id = s.id
     LEFT JOIN journey_executions e ON e.id = l.execution_id AND e.journey_id = $1::uuid
     WHERE s.journey_id = $1::uuid
     GROUP BY s.id, s.step_order, s.step_type, s.channel
     ORDER BY s.step_order ASC`,
    [journeyId]
  );

  return r.rows.map((row: any) => {
    const sentCount = Number(row.sent_count) || 0;
    const clickCount = Number(row.click_count) || 0;
    const conversionCount = Number(row.conversion_count) || 0;
    return {
      stepId: row.step_id,
      stepOrder: Number(row.step_order),
      stepType: row.step_type,
      channel: row.channel,
      enteredCount: Number(row.entered_count) || 0,
      sentCount,
      failedCount: Number(row.failed_count) || 0,
      skippedCount: Number(row.skipped_count) || 0,
      totalCost: Number(row.total_cost) || 0,
      clickCount,
      conversionCount,
      clickRate: sentCount > 0 ? clickCount / sentCount : 0,
      conversionRate: sentCount > 0 ? conversionCount / sentCount : 0,
    };
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. Segment 통계 (등급별 효과)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getJourneySegmentStats(journeyId: string): Promise<JourneySegmentStat[]> {
  const r = await query(
    `SELECT
       COALESCE(c.grade, '(미설정)') AS segment,
       COUNT(DISTINCT e.id) AS entered_count,
       COUNT(DISTINCT e.id) FILTER (WHERE e.status = 'completed') AS completed_count,
       (
         SELECT COUNT(*)
         FROM cdp_events ce
         WHERE ce.event_name = 'message_click'
           AND ce.customer_id = c.id
           AND (ce.properties->>'journey_id')::uuid = $1::uuid
       ) AS click_count,
       (
         SELECT COUNT(*)
         FROM cdp_events ce
         WHERE ce.event_name = 'order'
           AND ce.customer_id = c.id
           AND ce.occurred_at > e.entered_at
       ) AS conversion_count
     FROM journey_executions e
     INNER JOIN customers c ON c.id = e.customer_id
     WHERE e.journey_id = $1::uuid
     GROUP BY c.grade, c.id, e.id, e.entered_at
     ORDER BY entered_count DESC`,
    [journeyId]
  );

  // 등급별 집계 (위 쿼리는 row별 — segment 단위 reduce)
  const segmentMap = new Map<string, JourneySegmentStat>();
  for (const row of r.rows) {
    const seg = row.segment;
    if (!segmentMap.has(seg)) {
      segmentMap.set(seg, {
        segment: seg,
        enteredCount: 0,
        completedCount: 0,
        clickCount: 0,
        conversionCount: 0,
      });
    }
    const s = segmentMap.get(seg)!;
    s.enteredCount += Number(row.entered_count) || 0;
    s.completedCount += Number(row.completed_count) || 0;
    s.clickCount += Number(row.click_count) || 0;
    s.conversionCount += Number(row.conversion_count) || 0;
  }
  return Array.from(segmentMap.values()).sort((a, b) => b.enteredCount - a.enteredCount);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. 시간대별 통계 (0~23 hour)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getJourneyHourlyStats(journeyId: string): Promise<JourneyHourlyStat[]> {
  const sentRes = await query(
    `SELECT
       EXTRACT(HOUR FROM (l.sent_at AT TIME ZONE 'Asia/Seoul'))::int AS hour,
       COUNT(*) AS sent_count
     FROM journey_step_logs l
     INNER JOIN journey_executions e ON e.id = l.execution_id
     WHERE e.journey_id = $1::uuid AND l.status = 'sent'
     GROUP BY hour
     ORDER BY hour`,
    [journeyId]
  );

  const clickRes = await query(
    `SELECT
       EXTRACT(HOUR FROM (ce.occurred_at AT TIME ZONE 'Asia/Seoul'))::int AS hour,
       COUNT(*) AS click_count
     FROM cdp_events ce
     WHERE ce.event_name = 'message_click'
       AND (ce.properties->>'journey_id')::uuid = $1::uuid
     GROUP BY hour
     ORDER BY hour`,
    [journeyId]
  );

  const result: JourneyHourlyStat[] = [];
  for (let h = 0; h < 24; h++) {
    const sentRow = sentRes.rows.find((r: any) => r.hour === h);
    const clickRow = clickRes.rows.find((r: any) => r.hour === h);
    result.push({
      hour: h,
      sentCount: sentRow ? Number(sentRow.sent_count) : 0,
      clickCount: clickRow ? Number(clickRow.click_count) : 0,
      conversionCount: 0,  // 전환 시간대 통계는 D193+ 추가 영역
    });
  }
  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. 요일별 통계 (0=일 ~ 6=토)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getJourneyWeekdayStats(journeyId: string): Promise<JourneyWeekdayStat[]> {
  const sentRes = await query(
    `SELECT
       EXTRACT(DOW FROM (l.sent_at AT TIME ZONE 'Asia/Seoul'))::int AS weekday,
       COUNT(*) AS sent_count
     FROM journey_step_logs l
     INNER JOIN journey_executions e ON e.id = l.execution_id
     WHERE e.journey_id = $1::uuid AND l.status = 'sent'
     GROUP BY weekday`,
    [journeyId]
  );

  const clickRes = await query(
    `SELECT
       EXTRACT(DOW FROM (ce.occurred_at AT TIME ZONE 'Asia/Seoul'))::int AS weekday,
       COUNT(*) AS click_count
     FROM cdp_events ce
     WHERE ce.event_name = 'message_click'
       AND (ce.properties->>'journey_id')::uuid = $1::uuid
     GROUP BY weekday`,
    [journeyId]
  );

  const result: JourneyWeekdayStat[] = [];
  for (let d = 0; d < 7; d++) {
    const sentRow = sentRes.rows.find((r: any) => r.weekday === d);
    const clickRow = clickRes.rows.find((r: any) => r.weekday === d);
    result.push({
      weekday: d,
      sentCount: sentRow ? Number(sentRow.sent_count) : 0,
      clickCount: clickRow ? Number(clickRow.click_count) : 0,
      conversionCount: 0,
    });
  }
  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. Variant 통계 (A/B Bandit posterior)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getJourneyVariantStats(journeyId: string): Promise<JourneyVariantStat[]> {
  const r = await query(
    `SELECT
       v.step_id,
       v.id AS variant_id,
       v.variant_label,
       v.traffic_weight,
       v.sent_count,
       v.click_count,
       v.conversion_count,
       v.arm_alpha,
       v.arm_beta,
       CASE WHEN (v.arm_alpha + v.arm_beta) > 0 THEN v.arm_alpha / (v.arm_alpha + v.arm_beta) ELSE 0.5 END AS posterior_mean
     FROM journey_step_variants v
     INNER JOIN journey_steps s ON s.id = v.step_id
     WHERE s.journey_id = $1::uuid
     ORDER BY s.step_order ASC, v.variant_label ASC`,
    [journeyId]
  );

  return r.rows.map((row: any) => ({
    stepId: row.step_id,
    variantId: row.variant_id,
    variantLabel: row.variant_label,
    trafficWeight: Number(row.traffic_weight) || 0,
    sentCount: Number(row.sent_count) || 0,
    clickCount: Number(row.click_count) || 0,
    conversionCount: Number(row.conversion_count) || 0,
    posteriorMean: Number(row.posterior_mean) || 0,
    posteriorAlpha: Number(row.arm_alpha) || 1,
    posteriorBeta: Number(row.arm_beta) || 1,
  }));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 진입 사용자 리스트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function listJourneyEnteredCustomers(
  journeyId: string,
  companyId: string,
  options: { status?: string; limit?: number; offset?: number } = {}
): Promise<{ rows: JourneyCustomerRow[]; total: number }> {
  await verifyJourneyOwnership(journeyId, companyId);

  const limit = Math.min(Math.max(options.limit || 50, 1), 200);
  const offset = Math.max(options.offset || 0, 0);
  const statusFilter = options.status && options.status !== 'all'
    ? `AND e.status = '${options.status.replace(/[^a-z_]/g, '')}'`
    : '';

  const totalRes = await query(
    `SELECT COUNT(*) AS total FROM journey_executions e
     WHERE e.journey_id = $1::uuid ${statusFilter}`,
    [journeyId]
  );

  const r = await query(
    `SELECT
       e.id AS execution_id,
       e.customer_id,
       c.name AS customer_name,
       c.phone AS customer_phone,
       c.grade AS customer_grade,
       c.region AS customer_region,
       e.current_step_order,
       e.status,
       e.entered_at,
       e.completed_at,
       e.total_cost
     FROM journey_executions e
     INNER JOIN customers c ON c.id = e.customer_id
     WHERE e.journey_id = $1::uuid ${statusFilter}
     ORDER BY e.entered_at DESC
     LIMIT $2 OFFSET $3`,
    [journeyId, limit, offset]
  );

  return {
    total: Number(totalRes.rows[0]?.total) || 0,
    rows: r.rows.map((row: any) => ({
      executionId: row.execution_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerGrade: row.customer_grade,
      customerRegion: row.customer_region,
      currentStepOrder: Number(row.current_step_order),
      status: row.status,
      enteredAt: row.entered_at,
      completedAt: row.completed_at,
      totalCost: Number(row.total_cost) || 0,
    })),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 통합 진입점 — Journey 전체 통계 (회사 격리 + 6개 매트릭스 통합)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function buildJourneyStats(journeyId: string, companyId: string): Promise<JourneyFullStats> {
  await verifyJourneyOwnership(journeyId, companyId);

  const [overview, steps, segments, hourly, weekday, variants] = await Promise.all([
    getJourneyOverview(journeyId),
    getJourneyStepStats(journeyId),
    getJourneySegmentStats(journeyId),
    getJourneyHourlyStats(journeyId),
    getJourneyWeekdayStats(journeyId),
    getJourneyVariantStats(journeyId),
  ]);

  return { overview, steps, segments, hourly, weekday, variants };
}
