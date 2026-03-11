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
 * ★ B17-01: user_id 기준으로 통일 (080 자동연동과 일관성 유지 — 사용자별 수신거부)
 *
 * @param userIdRef - user_id 참조 (예: '$2', '$${paramIdx}')
 * @param phoneRef - phone 참조 (예: 'c.phone', 'customers.phone', 'customers_unified.phone')
 * @returns SQL 문자열 (AND NOT EXISTS ...)
 *
 * @example
 * const unsub = buildUnsubscribeFilter('$2', 'c.phone');
 * // → " AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $2 AND u.phone = c.phone)"
 */
export function buildUnsubscribeFilter(userIdRef: string, phoneRef: string): string {
  return ` AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = ${userIdRef} AND u.phone = ${phoneRef})`;
}

/**
 * EXISTS 수신거부 체크 SQL 생성 (수신거부 된 것만 조회할 때).
 * ★ B17-01: user_id 기준으로 통일
 *
 * @param userIdRef - user_id 참조
 * @param phoneRef - phone 참조
 * @returns SQL 문자열 (AND EXISTS ...)
 */
export function buildUnsubscribeExistsFilter(userIdRef: string, phoneRef: string): string {
  return ` AND EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = ${userIdRef} AND u.phone = ${phoneRef})`;
}

/**
 * CASE WHEN 수신거부 상태 컬럼 SQL 생성 (고객 목록 등에서 사용).
 * ★ B17-01: user_id 기준으로 통일
 *
 * @param userIdRef - user_id 참조
 * @param phoneRef - phone 참조
 * @param alias - 결과 컬럼 alias (기본: 'is_unsubscribed')
 * @returns SQL 문자열 (CASE WHEN EXISTS ...)
 */
export function buildUnsubscribeCase(userIdRef: string, phoneRef: string, alias: string = 'is_unsubscribed'): string {
  return `CASE WHEN EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = ${userIdRef} AND u.phone = ${phoneRef}) THEN true ELSE false END as ${alias}`;
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
 * ★ B17-01: user_id 기준으로 통일
 *
 * @param userId - 사용자 ID
 * @param phone - 전화번호
 * @returns true면 수신거부 상태
 */
export async function isUnsubscribed(userId: string, phone: string): Promise<boolean> {
  const result = await query(
    'SELECT EXISTS(SELECT 1 FROM unsubscribes WHERE user_id = $1 AND phone = $2) as exists',
    [userId, phone]
  );
  return result.rows[0]?.exists === true;
}

/**
 * 여러 전화번호 중 수신거부 상태인 번호들만 추출.
 * ★ B17-01: user_id 기준으로 통일
 *
 * @param userId - 사용자 ID
 * @param phones - 전화번호 배열
 * @returns 수신거부된 전화번호 배열
 */
export async function getUnsubscribedPhones(userId: string, phones: string[]): Promise<string[]> {
  if (!phones || phones.length === 0) return [];

  const result = await query(
    'SELECT DISTINCT phone FROM unsubscribes WHERE user_id = $1 AND phone = ANY($2)',
    [userId, phones]
  );
  return result.rows.map((r: any) => r.phone);
}

// ============================================================
// 080 수신거부 자동연동 (나래인터넷 콜백)
// ============================================================

/**
 * 080번호로 사용자 매칭 (나래인터넷 콜백에서 사용).
 * users.opt_out_080_number 우선 매칭 → 없으면 companies.opt_out_080_number fallback.
 *
 * @param opt080Number - 나래인터넷에서 전달한 080번호 (숫자만)
 * @returns 매칭된 사용자/회사 정보 배열 (여러 사용자가 같은 080번호를 쓸 수 있음)
 */
export async function findUserBy080Number(opt080Number: string): Promise<{
  userId: string;
  companyId: string;
  companyName: string;
  source: 'user' | 'company';
}[]> {
  // 1순위: users 테이블에서 직접 매칭 (사용자 레벨)
  const userResult = await query(
    `SELECT u.id as user_id, u.company_id, c.company_name
     FROM users u
     JOIN companies c ON c.id = u.company_id
     WHERE REPLACE(REPLACE(u.opt_out_080_number, '-', ''), ' ', '') = $1
       AND u.opt_out_auto_sync = true
       AND u.is_active = true
       AND c.status = 'active'`,
    [opt080Number]
  );

  if (userResult.rows.length > 0) {
    return userResult.rows.map((r: any) => ({
      userId: r.user_id,
      companyId: r.company_id,
      companyName: r.company_name,
      source: 'user' as const,
    }));
  }

  // 2순위: companies 테이블 fallback (기존 호환)
  const companyResult = await query(
    `SELECT id, company_name, opt_out_auto_sync FROM companies
     WHERE REPLACE(REPLACE(opt_out_080_number, '-', ''), ' ', '') = $1
       AND status = 'active'
     LIMIT 1`,
    [opt080Number]
  );

  if (companyResult.rows.length === 0) return [];

  const company = companyResult.rows[0];
  if (!company.opt_out_auto_sync) return [];

  // 해당 회사의 모든 활성 사용자에게 broadcast
  const usersResult = await query(
    `SELECT id FROM users WHERE company_id = $1 AND is_active = true`,
    [company.id]
  );

  return usersResult.rows.map((r: any) => ({
    userId: r.id,
    companyId: company.id,
    companyName: company.company_name,
    source: 'company' as const,
  }));
}

/**
 * 080 콜백 처리: 수신거부 등록 + 고객 sms_opt_in 동기화.
 *
 * @param phone - 수신거부 전화번호 (숫자만)
 * @param opt080Number - 나래인터넷 080번호 (숫자만)
 * @returns 등록 결과
 */
export async function process080Callback(phone: string, opt080Number: string): Promise<{
  success: boolean;
  insertedCount: number;
  companyName: string;
}> {
  const matches = await findUserBy080Number(opt080Number);

  if (matches.length === 0) {
    return { success: false, insertedCount: 0, companyName: '' };
  }

  let insertedCount = 0;
  const companyName = matches[0].companyName;
  const companyIds = new Set<string>();

  for (const match of matches) {
    const result = await query(
      `INSERT INTO unsubscribes (company_id, user_id, phone, source)
       VALUES ($1, $2, $3, '080_ars')
       ON CONFLICT (user_id, phone) DO NOTHING
       RETURNING id`,
      [match.companyId, match.userId, phone]
    );
    if (result.rows.length > 0) insertedCount++;
    companyIds.add(match.companyId);
  }

  // 각 회사별 customers.sms_opt_in 동기화
  for (const companyId of companyIds) {
    await syncCustomerOptIn(companyId, [phone], false);
  }

  return { success: true, insertedCount, companyName };
}

// ============================================================
// 슈퍼관리자용 수신거부 관리 (사용자별)
// ============================================================

/**
 * 사용자별 수신거부 목록 조회 (슈퍼관리자용).
 */
export async function getUserUnsubscribes(userId: string, options: {
  page?: number;
  limit?: number;
  search?: string;
} = {}): Promise<{ data: any[]; total: number }> {
  const page = options.page || 1;
  const limit = options.limit || 50;
  const offset = (page - 1) * limit;

  let whereClause = 'WHERE user_id = $1';
  const params: any[] = [userId];

  if (options.search) {
    params.push(`%${options.search}%`);
    whereClause += ` AND phone LIKE $${params.length}`;
  }

  const countResult = await query(
    `SELECT COUNT(*) FROM unsubscribes ${whereClause}`,
    params
  );

  const dataResult = await query(
    `SELECT id, phone, source, created_at
     FROM unsubscribes ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    data: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

/**
 * 사용자별 수신거부 일괄삭제.
 *
 * @param userId - 사용자 ID
 * @param phones - 삭제할 번호 배열 (비어있으면 전체 삭제)
 * @returns 삭제된 건수
 */
export async function deleteUserUnsubscribes(userId: string, phones?: string[]): Promise<number> {
  // 먼저 company_id 조회 (sms_opt_in 동기화용)
  const userResult = await query('SELECT company_id FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) return 0;
  const companyId = userResult.rows[0].company_id;

  let deletedPhones: string[];

  if (phones && phones.length > 0) {
    // 선택 삭제
    const result = await query(
      `DELETE FROM unsubscribes WHERE user_id = $1 AND phone = ANY($2) RETURNING phone`,
      [userId, phones]
    );
    deletedPhones = result.rows.map((r: any) => r.phone);
  } else {
    // 전체 삭제
    const result = await query(
      `DELETE FROM unsubscribes WHERE user_id = $1 RETURNING phone`,
      [userId]
    );
    deletedPhones = result.rows.map((r: any) => r.phone);
  }

  // 삭제된 번호들 sms_opt_in 복구
  if (deletedPhones.length > 0) {
    await syncCustomerOptIn(companyId, deletedPhones, true);
  }

  return deletedPhones.length;
}

/**
 * 사용자별 수신거부 전체 목록 (CSV 다운로드용).
 */
export async function exportUserUnsubscribes(userId: string): Promise<{ phone: string; source: string; created_at: string }[]> {
  const result = await query(
    `SELECT phone, source, created_at FROM unsubscribes
     WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}
