/**
 * ★ CT-78: In-app Message Segment Matcher — D215+ (2026-05-25)
 *
 * 🎯 목적
 *   인앱 메시지 segment_conditions를 D214+ Unified Customer Profile + cdp_events 매칭하여
 *   - matchCustomersBySegment: 대상 customer ID 배열 응답
 *   - countSegment: 매칭 count (활성화 직전 시뮬레이션 — 회사 admin이 0건 인지 확인)
 *   - customerMatchesSegment: 단일 customer 매칭 검증 (SDK active 호출 시점)
 *
 * ⛔ 영구 원칙
 *   - 0건 자동 완화 X (feedback_no_target_auto_relax) — 0건이면 빈 배열/0 그대로 응답
 *   - 회사 격리 (company_id 의무)
 *   - cdp_events 매칭은 회사 admin이 명시한 within_days 범위만
 *   - column does not exist 에러 = 호출부 endpoint catch에서 503 DB_MIGRATION_PENDING 처리 (db_alter_safety_net 룰)
 */

import { query } from '../config/database';
import { buildCustomerFilter } from './customer-filter';
import type { SegmentConditions } from './inapp-ai-generator';

// ════════════════════════════════════════════════════════════════════
// SQL 빌더 — 동적 WHERE 절 안전 생성 (SQL injection 차단 — parameterized only)
// ════════════════════════════════════════════════════════════════════

interface SqlPart {
  where: string;
  params: any[];
  nextIdx: number;
}

/**
 * customers 테이블 WHERE 절 빌드.
 * @param startIdx parameterized index 시작 (1부터)
 */
function buildCustomerWhereClause(
  companyId: string,
  segmentConditions: SegmentConditions,
  startIdx: number = 1
): SqlPart {
  const parts: string[] = [`c.company_id = $${startIdx}::uuid`, `c.is_active = true`];
  const params: any[] = [companyId];
  let idx = startIdx + 1;

  const cust = segmentConditions.customer || {};

  if (Array.isArray(cust.grade) && cust.grade.length > 0) {
    parts.push(`c.grade = ANY($${idx}::text[])`);
    params.push(cust.grade);
    idx++;
  }
  if (Array.isArray(cust.region) && cust.region.length > 0) {
    // region OR address LIKE 양쪽 매핑 — D214+ Unified Profile 정합
    parts.push(`(c.region = ANY($${idx}::text[]) OR c.address LIKE ANY($${idx + 1}::text[]))`);
    params.push(cust.region);
    params.push(cust.region.map((r) => `%${r}%`));
    idx += 2;
  }
  if (typeof cust.age_min === 'number') {
    parts.push(`c.age >= $${idx}::integer`);
    params.push(cust.age_min);
    idx++;
  }
  if (typeof cust.age_max === 'number') {
    parts.push(`c.age <= $${idx}::integer`);
    params.push(cust.age_max);
    idx++;
  }
  if (typeof cust.ltv_min === 'number') {
    parts.push(`COALESCE(c.total_purchase_amount, 0) >= $${idx}::numeric`);
    params.push(cust.ltv_min);
    idx++;
  }
  if (typeof cust.cart_add_count_30d_min === 'number') {
    parts.push(`COALESCE(c.cart_add_count_30d, 0) >= $${idx}::integer`);
    params.push(cust.cart_add_count_30d_min);
    idx++;
  }
  if (typeof cust.last_activity_days_ago_max === 'number') {
    parts.push(`c.last_activity_at >= NOW() - (INTERVAL '1 day' * $${idx}::integer)`);
    params.push(cust.last_activity_days_ago_max);
    idx++;
  }

  return {
    where: parts.join(' AND '),
    params,
    nextIdx: idx,
  };
}

/**
 * cdp_events 매칭 EXISTS 절 빌드 (within_days 범위).
 */
function buildEventExistsClauses(
  segmentConditions: SegmentConditions,
  startIdx: number
): SqlPart {
  const parts: string[] = [];
  const params: any[] = [];
  let idx = startIdx;

  const ev = segmentConditions.events || {};

  if (typeof ev.cart_add_within_days === 'number' && ev.cart_add_within_days > 0) {
    parts.push(`EXISTS (
      SELECT 1 FROM cdp_events e
      WHERE e.company_id = c.company_id
        AND e.customer_id = c.id
        AND e.event_name IN ('cart_add', 'cart.add')
        AND e.occurred_at >= NOW() - (INTERVAL '1 day' * $${idx}::integer)
    )`);
    params.push(ev.cart_add_within_days);
    idx++;
  }
  if (typeof ev.purchase_within_days === 'number' && ev.purchase_within_days > 0) {
    parts.push(`EXISTS (
      SELECT 1 FROM cdp_events e
      WHERE e.company_id = c.company_id
        AND e.customer_id = c.id
        AND e.event_name IN ('purchase', 'order.completed', 'order.created')
        AND e.occurred_at >= NOW() - (INTERVAL '1 day' * $${idx}::integer)
    )`);
    params.push(ev.purchase_within_days);
    idx++;
  }
  if (typeof ev.page_view_within_days === 'number' && ev.page_view_within_days > 0) {
    parts.push(`EXISTS (
      SELECT 1 FROM cdp_events e
      WHERE e.company_id = c.company_id
        AND e.customer_id = c.id
        AND e.event_name IN ('page_view', 'page.view')
        AND e.occurred_at >= NOW() - (INTERVAL '1 day' * $${idx}::integer)
    )`);
    params.push(ev.page_view_within_days);
    idx++;
  }

  return {
    where: parts.length > 0 ? '(' + parts.join(' AND ') + ')' : '',
    params,
    nextIdx: idx,
  };
}

// ════════════════════════════════════════════════════════════════════
// 핵심 API
// ════════════════════════════════════════════════════════════════════

/**
 * 세그먼트 조건 매칭 customer ID 배열 응답 (전체 또는 limit).
 * 0건 = 빈 배열 그대로 반환 (자동 완화 X).
 */
export async function matchCustomersBySegment(
  companyId: string,
  segmentConditions: SegmentConditions,
  limit: number = 10000
): Promise<string[]> {
  if (!companyId) throw new Error('companyId는 필수입니다.');

  const customerPart = buildCustomerWhereClause(companyId, segmentConditions, 1);
  const eventPart = buildEventExistsClauses(segmentConditions, customerPart.nextIdx);

  const allWhere = eventPart.where
    ? `${customerPart.where} AND ${eventPart.where}`
    : customerPart.where;
  const allParams = [...customerPart.params, ...eventPart.params];

  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50000);
  const sql = `
    SELECT c.id
    FROM customers c
    WHERE ${allWhere}
    ORDER BY c.last_activity_at DESC NULLS LAST
    LIMIT ${safeLimit}
  `;

  const r = await query(sql, allParams);
  return r.rows.map((row: any) => String(row.id));
}

/**
 * 세그먼트 매칭 count — 활성화 직전 시뮬레이션 (회사 admin이 0건 인지 확인용).
 * 0건 = 0 그대로 반환 (자동 완화 X).
 */
export async function countSegment(
  companyId: string,
  segmentConditions: SegmentConditions
): Promise<number> {
  if (!companyId) throw new Error('companyId는 필수입니다.');

  const customerPart = buildCustomerWhereClause(companyId, segmentConditions, 1);
  const eventPart = buildEventExistsClauses(segmentConditions, customerPart.nextIdx);

  const allWhere = eventPart.where
    ? `${customerPart.where} AND ${eventPart.where}`
    : customerPart.where;
  const allParams = [...customerPart.params, ...eventPart.params];

  const sql = `SELECT COUNT(*)::int AS cnt FROM customers c WHERE ${allWhere}`;
  const r = await query(sql, allParams);
  return Number(r.rows[0]?.cnt || 0);
}

/**
 * 단일 customer가 세그먼트에 매칭되는지 확인 — SDK active 호출 시점.
 */
export async function customerMatchesSegment(
  companyId: string,
  customerId: string,
  segmentConditions: SegmentConditions
): Promise<boolean> {
  if (!companyId || !customerId) return false;

  const customerPart = buildCustomerWhereClause(companyId, segmentConditions, 1);
  const eventPart = buildEventExistsClauses(segmentConditions, customerPart.nextIdx);

  // customer ID 추가 조건 (event params 다음 위치)
  const customerIdIdx = eventPart.nextIdx;
  const customerWhere = `${customerPart.where} AND c.id = $${customerIdIdx}::uuid`;

  const allWhere = eventPart.where
    ? `${customerWhere} AND ${eventPart.where}`
    : customerWhere;
  const allParams = [...customerPart.params, ...eventPart.params, customerId];

  const sql = `SELECT 1 FROM customers c WHERE ${allWhere} LIMIT 1`;
  const r = await query(sql, allParams);
  return r.rows.length > 0;
}

/**
 * 단일 customer가 CT-01 structured filter(타겟 추출 결과)에 매칭되는지 — SDK active 시점.
 * segment_conditions와 별개 축 — 인앱 표시 대상을 "단 1 오차 없는" 타겟으로 지정할 때.
 */
export async function customerMatchesFilter(
  companyId: string,
  customerId: string,
  filter: Record<string, { operator: string; value: any }>,
): Promise<boolean> {
  if (!companyId || !customerId || !filter || Object.keys(filter).length === 0) return false;
  const { sql: filterSql, params } = buildCustomerFilter(filter, {
    tableAlias: 'c',
    startParamIndex: 3,
    storeCodeMode: 'skip',
    inputFormat: 'structured',
  });
  const sql = `SELECT 1 FROM customers c WHERE c.company_id = $1::uuid AND c.id = $2::uuid AND c.is_active = true${filterSql} LIMIT 1`;
  const r = await query(sql, [companyId, customerId, ...params]);
  return r.rows.length > 0;
}

/**
 * ★ 2026-07-17 "전 등급 선택 = 제한 없음" 정규화.
 *   근본: AI 인앱 생성기가 일반 메시지에도 customer.grade=[VIP,일반,신규](전 표준 등급)을 자동으로 넣어,
 *   서빙(getActiveMessagesForCustomerV2 Step 3)이 grade 있음 = "등급 잡히는 로그인 고객만"으로 해석 →
 *   익명(비로그인) 방문자를 전원 제외 → 인앱이 웹/앱 어디에도 안 뜨던 근본(2026-07-16 직원 신고).
 *   전 표준 등급을 모두 포함 = 사실상 등급 제한 없음이므로 grade 키를 제거해 전체(익명 포함) 노출로 되돌린다.
 *   실제로 좁힌 등급(예: ['VIP'])은 그대로 유지 = 진짜 타겟은 보존.
 *   ★ 서빙·저장 양쪽에 적용(CT 단일 정의) — 기존 메시지는 서빙 정규화로 즉시 복구(재저장·수동 UPDATE 불필요).
 */
const STANDARD_GRADES = ['VIP', '일반', '신규'];
export function normalizeSegmentConditions<T extends SegmentConditions>(seg: T): T {
  if (!seg || typeof seg !== 'object') return seg;
  const cust = (seg as any).customer;
  if (cust && Array.isArray(cust.grade) && cust.grade.length > 0) {
    const set = new Set(cust.grade.map((g: any) => String(g).trim()));
    const coversAllStandard = STANDARD_GRADES.every((g) => set.has(g));
    if (coversAllStandard) {
      const restCust = { ...cust };
      delete restCust.grade;
      return { ...(seg as any), customer: restCust };
    }
  }
  return seg;
}

/**
 * 빈 세그먼트 (조건 0건) 여부 — true이면 회사 전체 active customer가 대상.
 */
export function isEmptySegment(segmentConditions: SegmentConditions): boolean {
  const cust = segmentConditions.customer || {};
  const ev = segmentConditions.events || {};
  const custKeys = Object.keys(cust).filter((k) => {
    const v = (cust as any)[k];
    return v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0);
  });
  const evKeys = Object.keys(ev).filter((k) => {
    const v = (ev as any)[k];
    return v !== undefined && v !== null;
  });
  return custKeys.length === 0 && evKeys.length === 0;
}

/**
 * 세그먼트 조건 사람-읽기 텍스트 변환 — UI 안 표시용 (자세히 분석 / 시뮬레이션 카드).
 */
export function describeSegment(segmentConditions: SegmentConditions): string {
  const parts: string[] = [];
  const cust = segmentConditions.customer || {};
  const ev = segmentConditions.events || {};

  if (Array.isArray(cust.grade) && cust.grade.length > 0) {
    parts.push(`등급 ${cust.grade.join('/')}`);
  }
  if (Array.isArray(cust.region) && cust.region.length > 0) {
    parts.push(`지역 ${cust.region.join('/')}`);
  }
  if (typeof cust.age_min === 'number' || typeof cust.age_max === 'number') {
    parts.push(`연령 ${cust.age_min ?? '제한 X'}~${cust.age_max ?? '제한 X'}`);
  }
  if (typeof cust.ltv_min === 'number') {
    parts.push(`LTV ${cust.ltv_min.toLocaleString()}원 이상`);
  }
  if (typeof cust.cart_add_count_30d_min === 'number') {
    parts.push(`30일 장바구니 ${cust.cart_add_count_30d_min}회 이상`);
  }
  if (typeof cust.last_activity_days_ago_max === 'number') {
    parts.push(`${cust.last_activity_days_ago_max}일 안 활동`);
  }
  if (typeof ev.cart_add_within_days === 'number') {
    parts.push(`${ev.cart_add_within_days}일 안 장바구니 추가`);
  }
  if (typeof ev.purchase_within_days === 'number') {
    parts.push(`${ev.purchase_within_days}일 안 구매`);
  }
  if (typeof ev.page_view_within_days === 'number') {
    parts.push(`${ev.page_view_within_days}일 안 페이지 조회`);
  }

  return parts.length > 0 ? parts.join(' · ') : '전체 회원';
}
