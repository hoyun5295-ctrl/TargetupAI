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
import { applyCustomerConditions } from './journey-simulator';

export async function selectJourneyTargetCustomerIds(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  limit: number,
): Promise<string[]> {
  const filters = triggerFilters || {};

  switch (triggerEvent) {
    // 1. 신규 가입 (customers.created_at 직전 N시간 안)
    case 'customer.created': {
      const params: any[] = [companyId, String(Number(filters.recent_hours || 24))];
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND c.is_active = true
           AND c.sms_opt_in = true
           AND c.created_at >= NOW() - ($2 || ' hours')::interval
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.created_at DESC
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // 2. 재구매 / 6. 예약 (cdp_events 직전 N분)
    case 'cdp.purchase':
      return selectCdpEvent(companyId, 'purchase', 5, filters, limit);
    case 'cdp.reservation_created':
      return selectCdpEvent(companyId, 'reservation_created', 5, filters, limit);

    // 3. 휴면 (customers.recent_purchase_date < NOW - N일)
    case 'customer.dormant': {
      const d = Number(filters.dormant_days || 30);
      const params: any[] = [companyId, String(d), String(d + 7)];
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND c.is_active = true
           AND c.sms_opt_in = true
           AND c.recent_purchase_date IS NOT NULL
           AND c.recent_purchase_date < (CURRENT_DATE - ($2 || ' days')::interval)
           AND c.recent_purchase_date > (CURRENT_DATE - ($3 || ' days')::interval)
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
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `WITH abandoned AS (
           SELECT DISTINCT ON (customer_id) customer_id, occurred_at AS cart_add_at
           FROM cdp_events
           WHERE company_id = $1::uuid
             AND event_name = 'cart_add'
             AND customer_id IS NOT NULL
             AND occurred_at >= NOW() - (($2::int + 1) || ' hours')::interval
             AND occurred_at <= NOW() - ($2 || ' hours')::interval
           ORDER BY customer_id, occurred_at DESC
         )
         SELECT a.customer_id
         FROM abandoned a
         ${cond ? `INNER JOIN customers c ON c.id = a.customer_id` : ''}
         WHERE NOT EXISTS (
           SELECT 1 FROM cdp_events e2
           WHERE e2.company_id = $1::uuid
             AND e2.customer_id = a.customer_id
             AND e2.event_name IN ('checkout_start', 'purchase')
             AND e2.occurred_at > a.cart_add_at
         )
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
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND c.is_active = true
           AND c.sms_opt_in = true
           AND (
             (c.birth_month_day IS NOT NULL AND c.birth_month_day = TO_CHAR((CURRENT_DATE + ($2 || ' days')::interval), 'MM-DD'))
             OR
             (c.birth_date IS NOT NULL AND TO_CHAR(c.birth_date, 'MM-DD') = TO_CHAR((CURRENT_DATE + ($2 || ' days')::interval), 'MM-DD'))
           )
           ${cond ? ` AND ${cond}` : ''}
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    default:
      return [];
  }
}

async function selectCdpEvent(
  companyId: string,
  eventName: string,
  recentMinutes: number,
  filters: Record<string, any>,
  limit: number,
): Promise<string[]> {
  const params: any[] = [companyId, eventName, String(recentMinutes)];
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
  params.push(String(limit));
  const r = await query(
    `SELECT DISTINCT e.customer_id FROM cdp_events e
     ${cond ? `INNER JOIN customers c ON c.id = e.customer_id` : ''}
     WHERE e.company_id = $1::uuid
       AND e.event_name = $2
       AND e.customer_id IS NOT NULL
       AND e.occurred_at >= NOW() - ($3 || ' minutes')::interval
       ${cond ? ` AND ${cond}` : ''}
     LIMIT $${params.length}::int`,
    params,
  );
  return r.rows.map((x: any) => x.customer_id);
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
): Promise<JourneyPreviewSample[]> {
  const ids = await selectJourneyTargetCustomerIds(companyId, triggerEvent, triggerFilters, limit);
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
