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
 *  - 한줄로 운영 영향 0 (Read-only 집계)
 */

import { query } from '../config/database';
// ★ Phase2 A (2026-06-26): 사후확률 α/β는 실측 count(sent/click)에서 도출 — bandit-arm 단일 진실.
import { deriveBanditArm } from './bandit-arm';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 인터페이스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface JourneyOverview {
  journeyId: string;
  totalEntered: number;
  active: number;
  completed: number;
  /** ★ 2026-07-10 목표 달성 종료(진입 이후 구매 확인 이탈) — 실패가 아니라 성과 지표 */
  goalMet: number;
  /** ★ 2026-07-11 홀드아웃 대조군 — 진입했지만 의도적으로 발송하지 않는 그룹(증분 성과 비교용) */
  holdout: number;
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
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): funnel 시각화 영역 + 이탈 사유 영역 분류
  funnelPercentage: number;        // Step N enteredCount / Step 1 enteredCount * 100 (이탈 영역 funnel)
  skippedHoursCount: number;       // status='skipped' AND error_reason LIKE '%hours%'
  skippedOptOutCount: number;      // status='skipped' AND error_reason LIKE '%opt_out%'
  skippedNoCustomerCount: number;  // status='skipped' AND error_reason LIKE '%customer_not_found%'
  conditionFailedCount: number;    // status='skipped' AND error_reason LIKE '%condition_failed%'
  waitedCount: number;             // status='skipped' AND error_reason LIKE '%wait_step_passed%'
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
  /** ★ 2026-07-11 홀드아웃 증분 비교 — 대조군 없으면 null */
  holdoutCompare?: JourneyHoldoutCompare | null;
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
       COUNT(*) FILTER (WHERE status = 'goal_met') AS goal_met,
       COUNT(*) FILTER (WHERE status = 'holdout') AS holdout,
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
  const holdout = Number(exec.holdout) || 0;

  return {
    journeyId,
    totalEntered,
    active: Number(exec.active) || 0,
    completed,
    goalMet: Number(exec.goal_met) || 0,
    holdout: Number(exec.holdout) || 0,
    paused: Number(exec.paused) || 0,
    failed: Number(exec.failed) || 0,
    totalCost: Number(exec.total_cost) || 0,
    totalSent: Number(log.total_sent) || 0,
    totalFailed: Number(log.total_failed) || 0,
    totalSkipped: Number(log.total_skipped) || 0,
    avgCompletionHours: exec.avg_completion_hours != null ? Number(exec.avg_completion_hours) : null,
    // ★ 2026-07-11: 완주율 분모 = 발송군(홀드아웃 제외) — 대조군이 완주율을 희석하지 않게
    completionRate: (totalEntered - holdout) > 0 ? completed / (totalEntered - holdout) : 0,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Journey step 통계 (step별 발송/클릭/전환)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getJourneyStepStats(journeyId: string): Promise<JourneyStepStat[]> {
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): skipped 영역 분류 4건 + waited 영역 추가 (이탈 사유 영역 funnel 매트릭스)
  //   journey-executor 영역 logSkippedStep 호출 영역 안 error_reason 영역 매트릭스:
  //   - 'wait_step_passed' = waited 영역
  //   - 'condition_failed_ended' / 'condition_failed' = condition_failed 영역
  //   - 'opt_out_or_inactive' / 'unsubscribed' = opt_out 영역
  //   - 'customer_not_found' / 'condition_customer_not_found' = no_customer 영역
  //   - 'skipped_hours' (시간대 영역) = hours 영역
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
       COUNT(*) FILTER (WHERE l.status = 'skipped' AND COALESCE(l.error_reason, '') LIKE '%hours%') AS skipped_hours_count,
       COUNT(*) FILTER (WHERE l.status = 'skipped' AND (COALESCE(l.error_reason, '') LIKE '%opt_out%' OR COALESCE(l.error_reason, '') LIKE '%unsubscribed%' OR COALESCE(l.error_reason, '') LIKE '%inactive%')) AS skipped_opt_out_count,
       COUNT(*) FILTER (WHERE l.status = 'skipped' AND COALESCE(l.error_reason, '') LIKE '%customer_not_found%') AS skipped_no_customer_count,
       COUNT(*) FILTER (WHERE l.status = 'skipped' AND COALESCE(l.error_reason, '') LIKE '%condition_failed%') AS condition_failed_count,
       COUNT(*) FILTER (WHERE l.status = 'skipped' AND COALESCE(l.error_reason, '') = 'wait_step_passed') AS waited_count,
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

  // funnel 영역 매트릭스 — Step 1 entered_count 영역 = 100% 기준
  const rawRows = r.rows;
  const firstStepEnteredCount = rawRows.length > 0 ? Number(rawRows[0].entered_count) || 0 : 0;

  return rawRows.map((row: any) => {
    const sentCount = Number(row.sent_count) || 0;
    const clickCount = Number(row.click_count) || 0;
    const conversionCount = Number(row.conversion_count) || 0;
    const enteredCount = Number(row.entered_count) || 0;
    return {
      stepId: row.step_id,
      stepOrder: Number(row.step_order),
      stepType: row.step_type,
      channel: row.channel,
      enteredCount,
      sentCount,
      failedCount: Number(row.failed_count) || 0,
      skippedCount: Number(row.skipped_count) || 0,
      totalCost: Number(row.total_cost) || 0,
      clickCount,
      conversionCount,
      clickRate: sentCount > 0 ? clickCount / sentCount : 0,
      conversionRate: sentCount > 0 ? conversionCount / sentCount : 0,
      funnelPercentage: firstStepEnteredCount > 0 ? (enteredCount / firstStepEnteredCount) * 100 : 0,
      skippedHoursCount: Number(row.skipped_hours_count) || 0,
      skippedOptOutCount: Number(row.skipped_opt_out_count) || 0,
      skippedNoCustomerCount: Number(row.skipped_no_customer_count) || 0,
      conditionFailedCount: Number(row.condition_failed_count) || 0,
      waitedCount: Number(row.waited_count) || 0,
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
    // ★ Phase2 A (2026-06-26): α/β·사후확률은 실측 count(sent_count/click_count)에서 deriveBanditArm로 도출.
    //   기존 bandit_alpha/bandit_beta 컬럼 직접 읽기 폐기 — 컬럼은 더 이상 갱신 안 되며 과거값은 drift 상태.
    `SELECT
       v.step_id,
       v.id AS variant_id,
       v.variant_id AS variant_label,
       v.traffic_weight,
       v.sent_count,
       v.click_count,
       v.conversion_count
     FROM journey_step_variants v
     INNER JOIN journey_steps s ON s.id = v.step_id
     WHERE s.journey_id = $1::uuid
     ORDER BY s.step_order ASC, v.variant_id ASC`,
    [journeyId]
  );

  return r.rows.map((row: any) => {
    const sentCount = Number(row.sent_count) || 0;
    const clickCount = Number(row.click_count) || 0;
    const arm = deriveBanditArm(sentCount, clickCount);
    return {
      stepId: row.step_id,
      variantId: row.variant_id,
      variantLabel: row.variant_label,
      trafficWeight: Number(row.traffic_weight) || 0,
      sentCount,
      clickCount,
      conversionCount: Number(row.conversion_count) || 0,
      posteriorMean: arm.alpha / (arm.alpha + arm.beta),
      posteriorAlpha: arm.alpha,
      posteriorBeta: arm.beta,
    };
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 진입 사용자 리스트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ★ D210+ Phase 3 (2026-05-23 Harold 명시): listJourneyEnteredCustomers 강화
//   옛 매트릭스 = status filter + limit + offset 영역만
//   신규 매트릭스 = search (4 영역 ILIKE) + status filter 5건 + sort 5건 + 페이지네이션
//   Phase 3-Predictive listCompanyPredictionCustomers 매트릭스 미러 영역 정합

export type JourneyExecutionStatus = 'all' | 'active' | 'completed' | 'paused' | 'ended' | 'failed' | 'goal_met';  // ★ 2026-07-10 목표 달성 종료
export type JourneyExecutionSort =
  | 'entered_at_desc'
  | 'entered_at_asc'
  | 'current_step_desc'
  | 'total_cost_desc'
  | 'completed_at_desc';

export async function listJourneyEnteredCustomers(
  journeyId: string,
  companyId: string,
  options: {
    status?: JourneyExecutionStatus;
    sort?: JourneyExecutionSort;
    search?: string;
    page?: number;
    limit?: number;
    offset?: number;  // legacy 호환 (page 영역 우선)
  } = {}
): Promise<{ rows: JourneyCustomerRow[]; total: number; filteredCount: number; page: number; totalPages: number; limit: number }> {
  await verifyJourneyOwnership(journeyId, companyId);

  const limit = Math.min(Math.max(options.limit || 10, 1), 200);
  const page = Math.max(1, Number(options.page) || 1);
  const offset = options.offset != null ? Math.max(0, options.offset) : (page - 1) * limit;
  const search = (options.search || '').trim();

  // status 영역 white-list (SQL injection 차단 정합)
  const validStatuses: JourneyExecutionStatus[] = ['all', 'active', 'completed', 'paused', 'ended', 'failed', 'goal_met'];
  const status: JourneyExecutionStatus = options.status && validStatuses.includes(options.status) ? options.status : 'all';
  const statusFilter = status === 'all' ? '' : `AND e.status = '${status}'`;

  // sort 영역 white-list
  const sort: JourneyExecutionSort = options.sort && [
    'entered_at_desc', 'entered_at_asc', 'current_step_desc', 'total_cost_desc', 'completed_at_desc',
  ].includes(options.sort) ? options.sort : 'entered_at_desc';

  const orderClause = (() => {
    switch (sort) {
      case 'entered_at_asc': return 'ORDER BY e.entered_at ASC';
      case 'current_step_desc': return 'ORDER BY e.current_step_order DESC, e.entered_at DESC';
      case 'total_cost_desc': return 'ORDER BY e.total_cost DESC, e.entered_at DESC';
      case 'completed_at_desc': return 'ORDER BY e.completed_at DESC NULLS LAST, e.entered_at DESC';
      case 'entered_at_desc':
      default: return 'ORDER BY e.entered_at DESC';
    }
  })();

  // 검색 ILIKE 매트릭스 (4 영역 OR — name / phone / grade / region)
  const params: any[] = [journeyId];
  let searchClause = '';
  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    searchClause = `AND (
      c.name ILIKE $${idx}
      OR c.phone ILIKE $${idx}
      OR COALESCE(c.grade, '') ILIKE $${idx}
      OR COALESCE(c.region, '') ILIKE $${idx}
    )`;
  }

  // 전체 카운트 (journey 진입 영역 모든 영역)
  const totalRes = await query(
    `SELECT COUNT(*)::int AS total FROM journey_executions e
     WHERE e.journey_id = $1::uuid`,
    [journeyId]
  );
  const totalCount = Number(totalRes.rows[0]?.total) || 0;

  // 필터 + 검색 적용 카운트
  const filteredRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM journey_executions e
     INNER JOIN customers c ON c.id = e.customer_id
     WHERE e.journey_id = $1::uuid
       ${statusFilter}
       ${searchClause}`,
    params
  );
  const filteredCount = Number(filteredRes.rows[0]?.total) || 0;

  // 데이터 조회 (페이지네이션 적용)
  params.push(limit);
  params.push(offset);
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
     WHERE e.journey_id = $1::uuid
       ${statusFilter}
       ${searchClause}
     ${orderClause}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const totalPages = filteredCount > 0 ? Math.ceil(filteredCount / limit) : 0;

  return {
    total: totalCount,
    filteredCount,
    page,
    totalPages,
    limit,
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

  // ★ 2026-07-11 홀드아웃 증분 비교 — 대조군이 있을 때만(전환 판정 = purchase 이벤트 또는 프로필 최근구매일 갱신,
  //   goal purchase 판정과 동일 신호). 발송군 = holdout 제외 전체.
  let holdoutCompare: JourneyHoldoutCompare | null = null;
  if (overview.holdout > 0) {
    try {
      const hc = await query(
        `SELECT
           COUNT(*) FILTER (WHERE e.status = 'holdout') AS h_total,
           COUNT(*) FILTER (WHERE e.status = 'holdout' AND e.conv) AS h_conv,
           COUNT(*) FILTER (WHERE e.status <> 'holdout') AS s_total,
           COUNT(*) FILTER (WHERE e.status <> 'holdout' AND e.conv) AS s_conv
         FROM (
           SELECT e.id, e.status,
                  (EXISTS (
                     SELECT 1 FROM cdp_events ce
                      WHERE ce.company_id = j.company_id AND ce.customer_id = e.customer_id
                        AND ce.event_name = 'purchase' AND ce.occurred_at > e.entered_at
                   ) OR EXISTS (
                     SELECT 1 FROM customers c
                      WHERE c.id = e.customer_id AND c.company_id = j.company_id
                        AND c.recent_purchase_date IS NOT NULL
                        AND c.recent_purchase_date > (e.entered_at AT TIME ZONE 'Asia/Seoul')::date
                   ) OR EXISTS (
                     -- ★ 2026-08-01 §11-4: 매장(싱크) 구매는 원장에만 있다. 위 프로필 신호는 날짜 정밀이라
                     --   진입 당일 구매를 못 가르므로 원장을 시각 정밀로 함께 본다(KST naive 규약).
                     SELECT 1 FROM purchases p
                      WHERE p.company_id = j.company_id AND p.customer_id = e.customer_id
                        AND p.purchase_date IS NOT NULL
                        AND p.purchase_date > (e.entered_at AT TIME ZONE 'Asia/Seoul')
                   )) AS conv
             FROM journey_executions e
             JOIN journeys j ON j.id = e.journey_id
            WHERE e.journey_id = $1::uuid
         ) e`,
        [journeyId]
      );
      const row = hc.rows[0] || {};
      const hTotal = Number(row.h_total) || 0;
      const sTotal = Number(row.s_total) || 0;
      holdoutCompare = {
        holdoutTotal: hTotal,
        holdoutConverted: Number(row.h_conv) || 0,
        sentTotal: sTotal,
        sentConverted: Number(row.s_conv) || 0,
        holdoutRate: hTotal > 0 ? (Number(row.h_conv) || 0) / hTotal : 0,
        sentRate: sTotal > 0 ? (Number(row.s_conv) || 0) / sTotal : 0,
      };
    } catch (e: any) {
      console.log('[JourneyStats] 홀드아웃 비교 실패(통계만 생략):', e?.message || e);
    }
  }

  return { overview, steps, segments, hourly, weekday, variants, holdoutCompare };
}

/** ★ 2026-07-11 홀드아웃 증분 비교 — 발송군 vs 미발송 대조군 전환율 */
export interface JourneyHoldoutCompare {
  holdoutTotal: number;
  holdoutConverted: number;
  sentTotal: number;
  sentConverted: number;
  holdoutRate: number;
  sentRate: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ★ D211+ Phase A 2번 (2026-05-23 Harold 명시): 실시간 customer 진행 위치 영역
//
//   본질 (회사 admin "지금 이 순간 우리 고객 어디 있는지" 인지):
//     - step별 현재 active execution 수
//     - 단계별 평균 체류 시간 (옛 entered_at 영역 vs 현재)
//     - 다음 발송 예정 시간 (가장 가까운 next_run_at)
//
//   옛 step 통계 영역 = 누적 영역 / 본 영역 = 실시간 영역
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface JourneyLivePosition {
  stepId: string;
  stepOrder: number;
  stepType: string;
  channel: string | null;
  activeCount: number;            // 현재 본 step 안 active execution 수
  avgDwellMinutes: number;        // 본 step 안 평균 체류 시간 (분)
  nextRunAt: string | null;       // 본 step 영역 가장 가까운 next_run_at (ISO)
}

export interface JourneyLiveSnapshot {
  journeyId: string;
  snapshotAt: Date;
  totalActive: number;
  totalCompleted24h: number;
  positions: JourneyLivePosition[];
  nextRunAt: string | null;       // 전체 journey 영역 가장 가까운 next_run_at
}

export async function getJourneyLiveSnapshot(journeyId: string, companyId: string): Promise<JourneyLiveSnapshot> {
  await verifyJourneyOwnership(journeyId, companyId);

  // 전체 active + 24h 안 completed
  const overviewRes = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'active')::int AS total_active,
       COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '24 hours')::int AS completed_24h,
       MIN(next_run_at) FILTER (WHERE status = 'active') AS next_run_at
     FROM journey_executions
     WHERE journey_id = $1::uuid`,
    [journeyId],
  );
  const overview = overviewRes.rows[0] || {};

  // step별 실시간 위치
  // current_step_order 매트릭스 = journey_executions.current_step_order
  // 옛 매트릭스 = current_step_order 영역이 1-based (1, 2, 3...) 정합
  const stepsRes = await query(
    `SELECT
       js.id AS step_id,
       js.step_order,
       js.step_type,
       js.channel,
       COALESCE(SUM(CASE WHEN je.status = 'active' AND je.current_step_order = js.step_order THEN 1 ELSE 0 END), 0)::int AS active_count,
       AVG(EXTRACT(EPOCH FROM (NOW() - je.entered_at)) / 60)
         FILTER (WHERE je.status = 'active' AND je.current_step_order = js.step_order) AS avg_dwell_minutes,
       MIN(je.next_run_at)
         FILTER (WHERE je.status = 'active' AND je.current_step_order = js.step_order) AS next_run_at
     FROM journey_steps js
     LEFT JOIN journey_executions je ON je.journey_id = js.journey_id
     WHERE js.journey_id = $1::uuid
     GROUP BY js.id, js.step_order, js.step_type, js.channel
     ORDER BY js.step_order ASC`,
    [journeyId],
  );

  const positions: JourneyLivePosition[] = stepsRes.rows.map((row: any) => ({
    stepId: row.step_id,
    stepOrder: Number(row.step_order),
    stepType: row.step_type,
    channel: row.channel,
    activeCount: Number(row.active_count) || 0,
    avgDwellMinutes: row.avg_dwell_minutes !== null ? Math.round(Number(row.avg_dwell_minutes)) : 0,
    nextRunAt: row.next_run_at ? new Date(row.next_run_at).toISOString() : null,
  }));

  return {
    journeyId,
    snapshotAt: new Date(),
    totalActive: Number(overview.total_active) || 0,
    totalCompleted24h: Number(overview.completed_24h) || 0,
    positions,
    nextRunAt: overview.next_run_at ? new Date(overview.next_run_at).toISOString() : null,
  };
}
