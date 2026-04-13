/**
 * ★ CT-F04 — 전단AI 고객 필터/쿼리 빌더
 *
 * 한줄로 utils/customer-filter.ts와 완전 분리.
 * - 테이블: flyer_customers
 * - 고정 컬럼: gender, age(birth_date 계산), grade, region, phone, sms_opt_in,
 *   last_purchase_at, total_purchase_amount, purchase_count, rfm_segment,
 *   pos_member_id, pos_grade, pos_points
 * - 기본 격리: company_id
 *
 * ⚠️ 전단AI는 한줄로 customer-filter.ts의 FIELD_MAP/커스텀필드 시스템을 사용하지 않는다.
 * 마트 업종 특화 필드(RFM/POS)만 지원.
 */

import { query } from '../../../config/database';

export interface FlyerFilterInput {
  gender?: 'M' | 'F';
  age_min?: number;
  age_max?: number;
  rfm_segment?: string | string[]; // 'champion' | 'loyal' | 'at_risk' | 'lost' | 'new' | 'whale'
  last_purchase_days_min?: number; // Recency: 최근 방문 N일 이내
  last_purchase_days_max?: number;
  purchase_count_min?: number;     // Frequency
  total_amount_min?: number;       // Monetary
  pos_grade?: string | string[];
  sms_opt_in?: boolean;
  search?: string; // 이름/전화/이메일 부분검색
}

export interface BuiltFilter {
  whereClause: string;
  params: any[];
}

/**
 * WHERE 절 빌더. company_id는 항상 강제 포함.
 * 반환 params의 첫 번째는 항상 companyId.
 */
export function buildFlyerCustomerFilter(companyId: string, filter: FlyerFilterInput = {}): BuiltFilter {
  const conditions: string[] = [`company_id = $1`, `deleted_at IS NULL`];
  const params: any[] = [companyId];

  const add = (cond: string, ...values: any[]) => {
    const indexed = cond.replace(/\?/g, () => `$${params.length + values.shift() + 1}`);
    // 단순화: 직접 인덱스로 처리
  };

  const nextP = (v: any) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (filter.gender === 'M' || filter.gender === 'F') {
    conditions.push(`gender = ${nextP(filter.gender)}`);
  }

  if (filter.age_min != null || filter.age_max != null) {
    if (filter.age_min != null) {
      conditions.push(`birth_date <= (CURRENT_DATE - INTERVAL '1 year' * ${nextP(filter.age_min)})`);
    }
    if (filter.age_max != null) {
      conditions.push(`birth_date >= (CURRENT_DATE - INTERVAL '1 year' * (${nextP(filter.age_max)} + 1) + INTERVAL '1 day')`);
    }
  }

  if (filter.rfm_segment) {
    const segs = Array.isArray(filter.rfm_segment) ? filter.rfm_segment : [filter.rfm_segment];
    conditions.push(`rfm_segment = ANY(${nextP(segs)}::text[])`);
  }

  if (filter.last_purchase_days_min != null) {
    conditions.push(`last_purchase_at >= NOW() - INTERVAL '1 day' * ${nextP(filter.last_purchase_days_min)}`);
  }
  if (filter.last_purchase_days_max != null) {
    conditions.push(`(last_purchase_at IS NULL OR last_purchase_at <= NOW() - INTERVAL '1 day' * ${nextP(filter.last_purchase_days_max)})`);
  }

  if (filter.purchase_count_min != null) {
    conditions.push(`purchase_count >= ${nextP(filter.purchase_count_min)}`);
  }

  if (filter.total_amount_min != null) {
    conditions.push(`total_purchase_amount >= ${nextP(filter.total_amount_min)}`);
  }

  if (filter.pos_grade) {
    const grades = Array.isArray(filter.pos_grade) ? filter.pos_grade : [filter.pos_grade];
    conditions.push(`pos_grade = ANY(${nextP(grades)}::text[])`);
  }

  if (filter.sms_opt_in !== undefined) {
    conditions.push(`sms_opt_in = ${nextP(filter.sms_opt_in)}`);
  }

  if (filter.search) {
    const s = `%${filter.search}%`;
    params.push(s, s, s);
    const i = params.length;
    conditions.push(`(name ILIKE $${i - 2} OR phone ILIKE $${i - 1} OR email ILIKE $${i})`);
  }

  return {
    whereClause: conditions.join(' AND '),
    params,
  };
}

/**
 * 필터 결과 COUNT.
 */
export async function countFlyerCustomers(companyId: string, filter: FlyerFilterInput = {}): Promise<number> {
  const { whereClause, params } = buildFlyerCustomerFilter(companyId, filter);
  const result = await query(`SELECT COUNT(*)::int AS cnt FROM flyer_customers WHERE ${whereClause}`, params);
  return result.rows[0]?.cnt || 0;
}

/**
 * 필터 결과 phone + id 목록 (발송 대상 추출).
 */
export async function selectFlyerCustomers(
  companyId: string,
  filter: FlyerFilterInput = {},
  options: { limit?: number; offset?: number; fields?: string[] } = {}
): Promise<any[]> {
  const { whereClause, params } = buildFlyerCustomerFilter(companyId, filter);
  const fields = options.fields?.length
    ? options.fields.join(', ')
    : 'id, name, phone, gender, birth_date, email, address, pos_grade, pos_points, last_purchase_at, total_purchase_amount, purchase_count, rfm_segment, sms_opt_in';

  const limit = Math.min(100000, options.limit || 10000);
  const offset = options.offset || 0;
  params.push(limit, offset);

  const result = await query(
    `SELECT ${fields} FROM flyer_customers
     WHERE ${whereClause}
     ORDER BY last_purchase_at DESC NULLS LAST, created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return result.rows;
}
