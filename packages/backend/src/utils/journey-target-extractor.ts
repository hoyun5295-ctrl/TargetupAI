/**
 * Journey Target Extractor — 여정 trigger 조건으로 후보 customer_id 추출 (공유 컨트롤타워)
 *
 * 목적
 *   발송(journey-trigger-watcher)과 미리보기(ai.ts sample-customer / preview-samples)가
 *   동일 기준으로 고객을 추출하도록 단일 진입점으로 둔다.
 *
 * 동작 보존
 *   각 trigger의 SQL은 journey-trigger-watcher.ts의 기존 match 함수에서 1:1로 옮긴 것이다.
 *   cond(customer_conditions) 파라미터 인덱스를 기존과 동일하게 유지하기 위해,
 *   limit는 applyCustomerConditions 적용 이후 마지막에 push 한다.
 *   기존 발송 SQL과의 유일한 차이는 LIMIT 500 → LIMIT $N 파라미터화 (발송은 500을 그대로 전달).
 *
 * 영구 원칙
 *   - no_target_auto_relax: 매칭 0건 시 빈 배열 반환, 자동완화 없음
 *   - 회사 격리: 모든 SQL company_id 필수
 */

import { query } from '../config/database';
import { buildJourneySafetyFilter, buildReentryAntiJoin } from './journey-safety-filter';
import { resolvePointsExpiringConfig } from './journey-points-trigger';
import { buildLedgerAntiJoin, hasBaseline } from './journey-entry-ledger';
import { buildSegmentBreakdown, SegmentBreakdown } from './journey-simulator-core';

export async function selectJourneyTargetCustomerIds(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  limit: number,
  journeyId?: string,
  reentry?: { allowReentry: boolean; cooldownDays: number },
): Promise<string[]> {
  const filters = triggerFilters || {};

  switch (triggerEvent) {
    // 1. 신규 가입 (customers.created_at 직전 N시간 안)
    case 'customer.created': {
      // ★ Phase 2: created_at 의존 제거 — 활성(baseline 적재됨) 여정은 진입 원장에 없는 식별자만 신규.
      //   초안/미리보기(baseline 없음)는 created_at 최근 창으로 "추정"만(실발송 아님).
      const params: any[] = [companyId];
      const useLedger = !!journeyId && (await hasBaseline(journeyId));
      let entryClause: string;
      if (useLedger) {
        params.push(journeyId);                                     // $2 = journeyId
        entryClause = buildLedgerAntiJoin('c', params.length);
      } else {
        params.push(String(Number(filters.recent_hours || 24)));    // $2 = hours (추정)
        entryClause = `c.created_at > NOW() - ($${params.length} || ' hours')::interval`;
      }
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c')}
           AND ${entryClause}
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.created_at DESC
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // 2. 재구매 / 6. 예약 (cdp_events 직전 N분)
    // 라이브 발송은 trigger-watcher가 selectCdpEvent를 커서 모드로 직접 호출. 여기(미리보기)는 추정 모드.
    case 'cdp.purchase':
      return selectCdpEvent(companyId, 'purchase', filters, limit);
    case 'cdp.reservation_created':
      return selectCdpEvent(companyId, 'reservation_created', filters, limit);

    // 3. 휴면 (customers.recent_purchase_date < NOW - N일)
    case 'customer.dormant': {
      const d = Number(filters.dormant_days || 30);
      const params: any[] = [companyId, String(d), String(d + 7)];
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays) : '';
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c')}
           AND c.recent_purchase_date IS NOT NULL
           AND c.recent_purchase_date < (CURRENT_DATE - ($2 || ' days')::interval)
           AND c.recent_purchase_date > (CURRENT_DATE - ($3 || ' days')::interval)
           ${antiJoin}
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.recent_purchase_date DESC
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // 4. 장바구니 포기 (cdp_events cart_add 직전 abandon_hours, 이후 checkout_start/purchase 없음)
    case 'cdp.cart_abandon': {
      const h = Number(filters.abandon_hours || 24);
      const params: any[] = [companyId, String(h)];
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays) : '';
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `WITH abandoned AS (
           SELECT DISTINCT ON (customer_id) customer_id, occurred_at AS cart_add_at
           FROM cdp_events
           WHERE company_id = $1::uuid
             AND event_name = 'cart_add'
             AND customer_id IS NOT NULL
             -- ★ Phase 3: 창 [N, N+24h]로 확대 — 워처 다운타임(최대 ~1일) 견딤. cooldown 7일이 중복 진입 차단.
             AND occurred_at >= NOW() - (($2::int + 24) || ' hours')::interval
             AND occurred_at <= NOW() - ($2 || ' hours')::interval
           ORDER BY customer_id, occurred_at DESC
         )
         SELECT a.customer_id
         FROM abandoned a
         INNER JOIN customers c ON c.id = a.customer_id AND c.company_id = $1::uuid
         WHERE NOT EXISTS (
           SELECT 1 FROM cdp_events e2
           WHERE e2.company_id = $1::uuid
             AND e2.customer_id = a.customer_id
             AND e2.event_name IN ('checkout_start', 'purchase')
             AND e2.occurred_at > a.cart_add_at
         )
           AND ${buildJourneySafetyFilter('c')}
         ${antiJoin}
         ${cond ? ` AND ${cond}` : ''}
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // 5. 생일 (D-N): NOW + N days의 MM-DD가 customers.birth_month_day 또는 birth_date와 일치
    case 'customer.birthday_approaching': {
      const days = Number(filters.days_before || 7);
      const params: any[] = [companyId, String(days)];
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays) : '';
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c')}
           AND (
             (c.birth_month_day IS NOT NULL AND c.birth_month_day = TO_CHAR((CURRENT_DATE + ($2 || ' days')::interval), 'MM-DD'))
             OR
             (c.birth_date IS NOT NULL AND TO_CHAR(c.birth_date, 'MM-DD') = TO_CHAR((CURRENT_DATE + ($2 || ' days')::interval), 'MM-DD'))
           )
           ${antiJoin}
           ${cond ? ` AND ${cond}` : ''}
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // 8. 포인트 소멸 임박 (Phase 8): points 임계 + (미사용 또는 연 단위 소멸일 D-N). 둘 다 공통 안전필터.
    case 'customer.points_expiring': {
      const cfg = resolvePointsExpiringConfig(filters);
      const params: any[] = [companyId, String(cfg.pointsMin)];
      let edgeClause: string;
      if (cfg.mode === 'annual_date') {
        if (!cfg.expiryMonthDay) return [];  // 소멸일 미설정 = 발송 0 (안전)
        params.push(String(cfg.daysBefore));   // $3
        params.push(cfg.expiryMonthDay);       // $4
        edgeClause = `TO_CHAR((CURRENT_DATE + ($3 || ' days')::interval), 'MM-DD') = $4`;
      } else {
        params.push(String(cfg.inactiveDays));  // $3
        edgeClause = `(c.recent_purchase_date IS NULL OR c.recent_purchase_date < (CURRENT_DATE - ($3 || ' days')::interval))`;
      }
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays) : '';
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c')}
           AND c.points IS NOT NULL AND c.points >= $2::int
           AND ${edgeClause}
           ${antiJoin}
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.points DESC
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // 7. 자유여정(custom) — audience(customer_conditions) + 안전필터 + 미진입(execution 안티조인) 고객만.
    //   조건 없으면 전체 활성 고객(브로드캐스트). 진입한 고객 제외 → 폴마다 미진입분만, 각 1회.
    case 'custom': {
      const params: any[] = [companyId];
      let dedupClause = '';
      if (journeyId) {
        params.push(journeyId);
        dedupClause = `AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = $${params.length}::uuid AND je.customer_id = c.id)`;
      }
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c')}
           ${dedupClause}
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.id
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    default:
      return [];
  }
}

// ★ Phase 3: 이벤트 커서 — cursorStart+windowEnd 주어지면(라이브) 그 창의 이벤트 전수,
//   없으면(미리보기) 최근 7일 추정. 라이브는 trigger-watcher가 커서/윈도우를 넘기고 처리 후 커서 전진.
export async function selectCdpEvent(
  companyId: string,
  eventName: string,
  filters: Record<string, any>,
  limit: number,
  cursorStart?: Date | string | null,
  windowEnd?: Date | string | null,
): Promise<string[]> {
  const params: any[] = [companyId, eventName];
  let timeClause: string;
  if (cursorStart && windowEnd) {
    params.push(cursorStart);
    params.push(windowEnd);
    timeClause = `e.occurred_at > $${params.length - 1} AND e.occurred_at <= $${params.length}`;
  } else {
    timeClause = `e.occurred_at >= NOW() - INTERVAL '7 days'`;
  }
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
  params.push(String(limit));
  const r = await query(
    `SELECT DISTINCT e.customer_id FROM cdp_events e
     INNER JOIN customers c ON c.id = e.customer_id AND c.company_id = $1::uuid
     WHERE e.company_id = $1::uuid
       AND e.event_name = $2
       AND e.customer_id IS NOT NULL
       AND ${timeClause}
       AND ${buildJourneySafetyFilter('c')}
       ${cond ? ` AND ${cond}` : ''}
     LIMIT $${params.length}::int`,
    params,
  );
  return r.rows.map((x: any) => x.customer_id);
}

// ★ Fix #11 (2026-06-05): cdp 커서용 — (cursor, windowEnd] 이벤트를 occurred_at ASC로 chunk만큼(안전필터+조건).
//   distinct가 아니라 행+시각을 반환 → 호출부가 커서를 마지막 처리 이벤트 시각까지만 전진(LIMIT로 이벤트 누락하던 문제 정정).
export async function selectCdpEventRowsForCursor(
  companyId: string,
  eventName: string,
  filters: Record<string, any>,
  cursorStart: Date | string,
  windowEnd: Date | string,
  chunkLimit: number,
): Promise<{ customerId: string; occurredAt: Date; properties: Record<string, any> | null }[]> {
  const params: any[] = [companyId, eventName, cursorStart, windowEnd];
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
  params.push(String(chunkLimit));
  const r = await query(
    `SELECT e.customer_id, e.occurred_at, e.properties FROM cdp_events e
     INNER JOIN customers c ON c.id = e.customer_id AND c.company_id = $1::uuid
     WHERE e.company_id = $1::uuid
       AND e.event_name = $2
       AND e.customer_id IS NOT NULL
       AND e.occurred_at > $3 AND e.occurred_at <= $4
       AND ${buildJourneySafetyFilter('c')}
       ${cond ? ` AND ${cond}` : ''}
     ORDER BY e.occurred_at ASC
     LIMIT $${params.length}::int`,
    params,
  );
  return r.rows.map((x: any) => ({ customerId: x.customer_id, occurredAt: x.occurred_at, properties: x.properties ?? null }));
}

// ════════════════════════════════════════════════════════════════════
// 미리보기 샘플 빌더 — 여정 trigger 기준 N명 (label + 한국어키 + 영문키)
//   preview-samples(저장 후 journeyId) + preview-target-samples(review 단계 trigger) 공통 사용.
// ════════════════════════════════════════════════════════════════════

export interface JourneyPreviewSample {
  label: string;
  customerId: string;
  sampleCustomer: Record<string, any>;
  sampleCustomerFields: Record<string, any>;
  modelVersion: string | null;
}

export async function buildJourneyPreviewSamples(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  limit: number,
  journeyId?: string,
): Promise<JourneyPreviewSample[]> {
  const ids = await selectJourneyTargetCustomerIds(companyId, triggerEvent, triggerFilters, limit, journeyId);
  if (ids.length === 0) return [];

  // 추출 순서(trigger ORDER BY — 신규가입=created_at DESC 등) 유지 + 예측 점수 LEFT JOIN
  const r = await query(
    `SELECT c.*, p.click_score, p.churn_risk, p.purchase_likelihood, p.model_version
     FROM customers c
     LEFT JOIN cdp_customer_predictions p ON p.customer_id = c.id
     WHERE c.company_id = $1::uuid AND c.id = ANY($2::uuid[])
     ORDER BY array_position($2::uuid[], c.id)`,
    [companyId, ids],
  );

  return r.rows.map((row: any, i: number): JourneyPreviewSample => ({
    label: row.name || `대상 ${i + 1}`,
    customerId: row.id,
    sampleCustomer: {
      고객명: row.name || '',
      이름: row.name || '',
      등급: row.grade || '',
      지역: row.region || '',
      전화번호: row.phone || '',
      포인트: row.points != null ? Number(row.points).toLocaleString() : '',
      최근구매일: row.recent_purchase_date ? new Date(row.recent_purchase_date).toLocaleDateString('ko-KR') : '',
      총구매액: row.total_purchase_amount != null ? Number(row.total_purchase_amount).toLocaleString() : '',
      누적구매횟수: row.purchase_count != null ? String(row.purchase_count) : '',
    },
    sampleCustomerFields: {
      name: row.name || null,
      phone: row.phone || null,
      grade: row.grade || null,
      region: row.region || null,
      age: row.age != null ? Number(row.age) : null,
      gender: row.gender || null,
      purchase_count: row.purchase_count != null ? Number(row.purchase_count) : 0,
      total_purchase_amount: row.total_purchase_amount != null ? Number(row.total_purchase_amount) : 0,
      recent_purchase_amount: row.recent_purchase_amount != null ? Number(row.recent_purchase_amount) : 0,
      recent_purchase_date: row.recent_purchase_date || null,
      birth_date: row.birth_date || null,
      points: row.points != null ? Number(row.points) : 0,
      email: row.email || null,
      click_score: row.click_score != null ? Number(row.click_score) : 0.5,
      churn_risk: row.churn_risk != null ? Number(row.churn_risk) : 0.5,
      purchase_likelihood: row.purchase_likelihood != null ? Number(row.purchase_likelihood) : 0.5,
    },
    modelVersion: row.model_version || null,
  }));
}

// ════════════════════════════════════════════════════════════════════
// 전체 매칭 수 + 등급 분포 — 미리보기·시뮬레이션 공용 (Phase 9)
//   발송과 동일한 selectJourneyTargetCustomerIds로 ID를 받아(상한 JOURNEY_COUNT_CAP) 등급만 집계.
//   → 미리보기·시뮬레이션 = 실발송 대상 100% 일치(같은 함수). 상한 초과 시 capped=true(정직 표기).
//   grade/company_id/id = information_schema 확인 컬럼(2026-06-04).
// ════════════════════════════════════════════════════════════════════

export const JOURNEY_COUNT_CAP = 100000;

export interface JourneyTargetCount {
  total: number;
  segments: SegmentBreakdown[];
  capped: boolean;
}

/** 주어진 customer id 집합의 등급 분포(grade GROUP BY → 셰이핑). */
export async function gradeBreakdownForIds(
  companyId: string,
  ids: string[],
): Promise<{ total: number; segments: SegmentBreakdown[] }> {
  if (ids.length === 0) return { total: 0, segments: [] };
  const r = await query(
    `SELECT COALESCE(grade, '일반') AS segment, COUNT(*)::int AS cnt
     FROM customers
     WHERE company_id = $1::uuid AND id = ANY($2::uuid[])
     GROUP BY COALESCE(grade, '일반')`,
    [companyId, ids],
  );
  return buildSegmentBreakdown(r.rows);
}

/** 주어진 customer id 집합의 실데이터 평균 — 객단가·전환·클릭. 행/값 없으면 null(추정 생략용). */
export async function averageScoresForIds(
  companyId: string,
  ids: string[],
): Promise<{ avgOrderValue: number | null; avgConversion: number | null; avgClick: number | null }> {
  if (ids.length === 0) return { avgOrderValue: null, avgConversion: null, avgClick: null };
  const r = await query(
    `SELECT AVG(c.avg_order_value) AS aov,
            AVG(p.purchase_likelihood) AS conv,
            AVG(p.click_score) AS clk
     FROM customers c
     LEFT JOIN cdp_customer_predictions p ON p.customer_id = c.id
     WHERE c.company_id = $1::uuid AND c.id = ANY($2::uuid[])`,
    [companyId, ids],
  );
  const row = r.rows[0] || {};
  const num = (v: any) => (v != null ? Number(v) : null);
  return { avgOrderValue: num(row.aov), avgConversion: num(row.conv), avgClick: num(row.clk) };
}

/** 전체 매칭 수 + 등급 분포 (미리보기·시뮬레이션 공용). 발송과 동일 함수로 ID 추출. */
export async function countJourneyTargetCustomers(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  journeyId?: string,
): Promise<JourneyTargetCount> {
  const ids = await selectJourneyTargetCustomerIds(companyId, triggerEvent, triggerFilters, JOURNEY_COUNT_CAP, journeyId);
  const { total, segments } = await gradeBreakdownForIds(companyId, ids);
  return { total, segments, capped: ids.length >= JOURNEY_COUNT_CAP };
}

// ════════════════════════════════════════════════════════════════════
// customer_conditions 복합 조건 → SQL 조각 (5번 트리거 복합 조합)
//   순수(파라미터 배열에 push). journey-simulator에서 이동(Phase 9 순환 참조 제거).
// ════════════════════════════════════════════════════════════════════

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
