/**
 * unsubscribe-helper.ts — 수신거부 관리 컨트롤타워 (CT-03)
 *
 * 수신거부 필터 SQL 패턴이 campaigns.ts, customers.ts, ai.ts, upload.ts 등
 * 10곳 이상에 산재. 이 파일에서 한 곳으로 관리하여 누락/불일치 방지.
 *
 * 또한 opt-in 동기화 로직(단건/벌크)도 여기서 제공하여 재사용 가능하게 함.
 */

import { query } from '../config/database';

// ============================================================
// 수신거부 필터 SQL 생성
// ============================================================

/**
 * NOT EXISTS 수신거부 필터 SQL 생성.
 *
 * @param companyIdRef - company_id 참조 (예: 'c.company_id', '$1', 'customers_unified.company_id')
 * @param phoneRef - phone 참조 (예: 'c.phone', 'customers.phone', 'customers_unified.phone')
 * @returns SQL 문자열 (AND NOT EXISTS ...)
 *
 * @example
 * // campaigns.ts에서 사용
 * const unsub = buildUnsubscribeFilter('c.company_id', 'c.phone');
 * // → " AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = c.company_id AND u.phone = c.phone)"
 *
 * @example
 * // upload.ts에서 사용 (파라미터 참조)
 * const unsub = buildUnsubscribeFilter('$1', 'customers.phone');
 */
export function buildUnsubscribeFilter(companyIdRef: string, phoneRef: string): string {
  return ` AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = ${companyIdRef} AND u.phone = ${phoneRef})`;
}

/**
 * EXISTS 수신거부 체크 SQL 생성 (수신거부 된 것만 조회할 때).
 *
 * @param companyIdRef - company_id 참조
 * @param phoneRef - phone 참조
 * @returns SQL 문자열 (AND EXISTS ...)
 */
export function buildUnsubscribeExistsFilter(companyIdRef: string, phoneRef: string): string {
  return ` AND EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = ${companyIdRef} AND u.phone = ${phoneRef})`;
}

/**
 * CASE WHEN 수신거부 상태 컬럼 SQL 생성 (고객 목록 등에서 사용).
 *
 * @param companyIdRef - company_id 참조
 * @param phoneRef - phone 참조
 * @param alias - 결과 컬럼 alias (기본: 'is_unsubscribed')
 * @returns SQL 문자열 (CASE WHEN EXISTS ...)
 */
export function buildUnsubscribeCase(companyIdRef: string, phoneRef: string, alias: string = 'is_unsubscribed'): string {
  return `CASE WHEN EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = ${companyIdRef} AND u.phone = ${phoneRef}) THEN true ELSE false END as ${alias}`;
}

// ============================================================
// 수신거부 동기화
// ============================================================

/**
 * 수신거부/수신동의 시 customers 테이블의 sms_opt_in 동기화.
 *
 * @param companyId - 회사 ID
 * @param phones - 전화번호 배열
 * @param optIn - true면 수신동의(sms_opt_in=true), false면 수신거부(sms_opt_in=false)
 */
export async function syncCustomerOptIn(companyId: string, phones: string[], optIn: boolean): Promise<void> {
  if (!phones || phones.length === 0) return;

  await query(
    `UPDATE customers SET sms_opt_in = $1, updated_at = NOW()
     WHERE company_id = $2 AND phone = ANY($3::text[])`,
    [optIn, companyId, phones]
  );
}

/**
 * 특정 전화번호가 수신거부 상태인지 확인.
 *
 * @param companyId - 회사 ID
 * @param phone - 전화번호
 * @returns true면 수신거부 상태
 */
export async function isUnsubscribed(companyId: string, phone: string): Promise<boolean> {
  const result = await query(
    'SELECT EXISTS(SELECT 1 FROM unsubscribes WHERE company_id = $1 AND phone = $2) as exists',
    [companyId, phone]
  );
  return result.rows[0]?.exists === true;
}

/**
 * 여러 전화번호 중 수신거부 상태인 번호들만 추출.
 *
 * @param companyId - 회사 ID
 * @param phones - 전화번호 배열
 * @returns 수신거부된 전화번호 배열
 */
export async function getUnsubscribedPhones(companyId: string, phones: string[]): Promise<string[]> {
  if (!phones || phones.length === 0) return [];

  const result = await query(
    'SELECT DISTINCT phone FROM unsubscribes WHERE company_id = $1 AND phone = ANY($2)',
    [companyId, phones]
  );
  return result.rows.map((r: any) => r.phone);
}
