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
 * 수신거부 등록 — 유일한 쓰기 진입점 (CT-03)
 *
 * - 브랜드 사용자 → 본인 user_id로 등록
 * - 고객사관리자(admin) → 고객의 store_code 기준으로 올바른 브랜드 사용자에게 자동 배정
 *   (예: 한 고객이 특정 브랜드 소속이면 → 해당 브랜드 user_id로 등록)
 *   매칭되는 브랜드 사용자가 없으면 등록 스킵 (admin user_id로 잘못 등록하지 않음)
 *
 * @param companyId  회사 ID
 * @param userId     로그인한 사용자 ID
 * @param userType   'company_admin' | 'company_user'
 * @param phone      전화번호 (정규화된)
 * @param source     등록 경로 ('manual', 'upload', 'db_upload' 등)
 * @returns 실제 INSERT된 건수
 */
/**
 * ★ D136 (2026-04-22) 신설: 회사 전체 sms_opt_in=false 고객 → company_user 자동 배정 (bulk).
 *
 * 배경:
 *   sync.ts(동기화)와 upload.ts(업로드) 2곳에 동일 패턴 `c.store_code = ANY(u.store_codes)`가
 *   인라인으로 중복. getStoreScope(CT-02) 4단계 판정을 반영하지 못해 유령 배정 버그 발생.
 *
 * 판정 (getStoreScope와 동일):
 *   - no_filter-1: 회사 customer_stores 체계 없음           → 전체 user에게 전체 고객 배정
 *   - no_filter-2: store_codes 배정됐으나 실존 매칭 0       → 유령 배정, 전체 고객 배정
 *   - filtered   : customer_stores 실존 매칭 + store_code   → 해당 user에게 해당 store 고객만
 *   - blocked    : store_codes 미배정 + 체계 있음            → 스킵 (INSERT 없음)
 *
 * @param companyId  회사 ID
 * @param source     등록 경로 ('sync', 'db_upload' 등)
 * @returns 실제 INSERT된 총 건수
 */
export async function registerBulkCompanyUserUnsubscribes(
  companyId: string,
  source: string,
): Promise<number> {
  const result = await query(
    `INSERT INTO unsubscribes (company_id, user_id, phone, source)
     SELECT c.company_id, u.id, c.phone, $2
     FROM customers c
     JOIN users u ON u.company_id = c.company_id
       AND u.user_type = 'user'
       AND COALESCE(u.is_active, true) = true
     WHERE c.company_id = $1
       AND c.sms_opt_in = false
       AND c.is_active = true
       AND (
         NOT EXISTS (SELECT 1 FROM customer_stores cs WHERE cs.company_id = $1)
         OR
         (u.store_codes IS NOT NULL AND array_length(u.store_codes, 1) > 0
          AND NOT EXISTS (SELECT 1 FROM customer_stores cs
                           WHERE cs.company_id = $1
                             AND cs.store_code = ANY(u.store_codes)))
         OR
         (u.store_codes IS NOT NULL AND array_length(u.store_codes, 1) > 0
          AND c.store_code = ANY(u.store_codes)
          AND EXISTS (SELECT 1 FROM customer_stores cs
                       WHERE cs.company_id = $1
                         AND cs.store_code = ANY(u.store_codes)))
       )
     ON CONFLICT (user_id, phone) DO NOTHING`,
    [companyId, source],
  );
  return result.rowCount || 0;
}

export class IsolationBlockedError extends Error {
  constructor() {
    super('ISOLATION_BLOCKED');
    this.name = 'IsolationBlockedError';
  }
}

export async function registerUnsubscribe(
  companyId: string,
  userId: string,
  userType: string,
  phone: string,
  source: string
): Promise<number> {
  let insertCount = 0;

  // ★ D162-3 (2026-05-15) Harold 명시 4 분기 매트릭스:
  //   - 격리 OFF + 누구든     → 회사 전체 active user broadcast
  //   - 격리 ON  + company_admin → 차단 (IsolationBlockedError, 라우트에서 403 + 안내)
  //   - 격리 ON  + company_user → 본인 user_id + 회사의 admin user_id 양쪽 INSERT
  //   - 격리 ON  + 그 외       → 차단 (방어)
  //   회사별 user_isolation_enabled = false(기본) → broadcast / true → 사용자별 격리.
  //   옛 D136 customers JOIN + store_code 격리 디자인 폐기 (Harold 새 설계로 대체).
  const companyResult = await query(
    `SELECT COALESCE(user_isolation_enabled, false) AS iso FROM companies WHERE id = $1::uuid`,
    [companyId]
  );
  const isolationEnabled = companyResult.rows[0]?.iso === true;

  if (isolationEnabled) {
    if (userType === 'company_admin') {
      throw new IsolationBlockedError();
    }
    if (userType !== 'company_user') {
      throw new IsolationBlockedError();
    }
    // 격리 ON + 사용자 → 본인 + 회사 admin 양쪽 INSERT
    const result = await query(
      `INSERT INTO unsubscribes (company_id, user_id, phone, source)
       SELECT $1::uuid, u.id, $3::varchar, $4::varchar
       FROM users u
       WHERE u.company_id = $1::uuid
         AND COALESCE(u.is_active, true) = true
         AND (u.id = $2::uuid OR u.user_type = 'admin')
       ON CONFLICT (user_id, phone) DO NOTHING`,
      [companyId, userId, phone, source]
    );
    return result.rowCount || 0;
  }

  // 격리 OFF (기본) — 회사 전체 active user broadcast (admin + user 모두)
  void userId; void userType;
  const result = await query(
    `INSERT INTO unsubscribes (company_id, user_id, phone, source)
     SELECT $1::uuid, u.id, $2::varchar, $3::varchar
     FROM users u
     WHERE u.company_id = $1::uuid
       AND u.user_type IN ('admin', 'user')
       AND COALESCE(u.is_active, true) = true
     ON CONFLICT (user_id, phone) DO NOTHING`,
    [companyId, phone, source]
  );
  insertCount = result.rowCount || 0;

  return insertCount;
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
 * users.opt_out_080_number 매칭 + companies.opt_out_080_number 매칭의 합집합 (2026-07-06 Harold 룰 —
 * 같은 080번호는 계정 간 공유 가능, 매칭 전원 등록).
 *
 * @param opt080Number - 나래인터넷에서 전달한 080번호 (숫자만)
 * @returns 매칭된 사용자/회사 정보 배열 (여러 사용자·회사가 같은 080번호를 공유할 수 있음)
 */
export async function findUserBy080Number(opt080Number: string): Promise<{
  userId: string;
  companyId: string;
  companyName: string;
  source: 'user' | 'company';
}[]> {
  // ★ 2026-07-06 Harold 명시 룰 — 같은 080번호는 계정(사용자·회사) 간 공유 가능:
  //   등록 = user 매칭과 company 매칭의 "합집합" 전원 등록. 옛 "1순위 잡히면 2순위 skip" 조기 return은
  //   공유 상대(회사 레벨 연동)를 누락시키므로 폐기. 삭제는 쓰기 경로가 본인 회사·본인 user 행만 만져
  //   공유 상대에 영향 없음(설정 저장·슈퍼관리자 수정 전수 확인 2026-07-06).
  const out: { userId: string; companyId: string; companyName: string; source: 'user' | 'company' }[] = [];
  const seen = new Set<string>(); // userId dedup — user 매칭과 회사 broadcast 겹침 제거

  // user 레벨 매칭 (사용자별 오버라이드 + auto_sync ON)
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
  for (const r of userResult.rows) {
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    out.push({ userId: r.user_id, companyId: r.company_id, companyName: r.company_name, source: 'user' });
  }

  // company 레벨 매칭 — auto_sync ON인 매칭 회사 "전부"의 활성 사용자 broadcast.
  //   ★ 2026-07-06: LIMIT 1 + 단일 행 auto_sync 검사 제거 — 같은 번호 회사 여럿일 때 false 행이
  //   LIMIT 1(정렬 없음)을 차지하면 true 회사까지 통째로 매칭 실패하던 결함(psy5868/0807196700 실측).
  const companyResult = await query(
    `SELECT id, company_name FROM companies
     WHERE REPLACE(REPLACE(opt_out_080_number, '-', ''), ' ', '') = $1
       AND opt_out_auto_sync = true
       AND status = 'active'`,
    [opt080Number]
  );
  for (const company of companyResult.rows) {
    const usersResult = await query(
      `SELECT id FROM users WHERE company_id = $1 AND is_active = true`,
      [company.id]
    );
    for (const r of usersResult.rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ userId: r.id, companyId: company.id, companyName: company.company_name, source: 'company' });
    }
  }

  if (out.length === 0) {
    // 매칭 0건 — 번호는 일치하는데 조건(auto_sync/활성)에서 제외된 후보를 로그로 남겨 운영 진단 (읽기 전용)
    try {
      const nearMiss = await query(
        `SELECT 'user' AS src, u.login_id AS name, u.opt_out_auto_sync::text AS auto_sync, u.is_active::text AS active
           FROM users u
          WHERE REPLACE(REPLACE(u.opt_out_080_number, '-', ''), ' ', '') = $1
         UNION ALL
         SELECT 'company', c.company_name, c.opt_out_auto_sync::text, (c.status = 'active')::text
           FROM companies c
          WHERE REPLACE(REPLACE(c.opt_out_080_number, '-', ''), ' ', '') = $1`,
        [opt080Number]
      );
      if (nearMiss.rows.length > 0) {
        console.log(`[080콜백] 번호 일치·조건 제외 후보 (${opt080Number}): ${JSON.stringify(nearMiss.rows)}`);
      }
    } catch { /* 진단 로그 실패는 무시 — 콜백 응답에 영향 X */ }
  }
  return out;
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

  // 매칭된 user_id 수집 (admin 동기화 시 중복 방지용)
  const matchedUserIds = new Set(matches.map(m => m.userId));

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

  // ★ 상위 고객사관리자(admin)에게 자동 동기화
  // 브랜드 담당자에게 수신거부 등록 시 → 같은 회사의 admin user에게도 INSERT
  for (const companyId of companyIds) {
    const adminUsers = await query(
      `SELECT id FROM users
       WHERE company_id = $1 AND user_type = 'admin' AND is_active = true`,
      [companyId]
    );
    for (const admin of adminUsers.rows) {
      if (matchedUserIds.has(admin.id)) continue; // 이미 매칭된 admin이면 스킵
      const result = await query(
        `INSERT INTO unsubscribes (company_id, user_id, phone, source)
         VALUES ($1, $2, $3, '080_ars_sync')
         ON CONFLICT (user_id, phone) DO NOTHING
         RETURNING id`,
        [companyId, admin.id, phone]
      );
      if (result.rows.length > 0) insertedCount++;
    }
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
  companyId?: string;
  userType?: string;
} = {}): Promise<{ data: any[]; total: number }> {
  const page = options.page || 1;
  const limit = options.limit || 50;
  const offset = (page - 1) * limit;

  // company_admin은 회사 전체 수신거부 조회, 일반 사용자는 본인 user_id만
  let whereClause: string;
  const params: any[] = [];
  if (options.userType === 'company_admin' && options.companyId) {
    whereClause = 'WHERE company_id = $1';
    params.push(options.companyId);
  } else {
    whereClause = 'WHERE user_id = $1';
    params.push(userId);
  }

  if (options.search) {
    params.push(`%${options.search}%`);
    whereClause += ` AND phone LIKE $${params.length}`;
  }

  const countResult = await query(
    `SELECT COUNT(DISTINCT phone) FROM unsubscribes ${whereClause}`,
    params
  );

  const dataResult = await query(
    `SELECT DISTINCT ON (phone) id, phone, source, created_at
     FROM unsubscribes ${whereClause}
     ORDER BY phone, created_at DESC`,
    params
  );

  // phone 기준 중복 제거 후 created_at DESC 정렬 + 페이지네이션
  const sorted = dataResult.rows.sort((a: any, b: any) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const paged = sorted.slice(offset, offset + limit);

  return {
    data: paged,
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
  // 먼저 company_id 조회 (sms_opt_in 동기화 + 회사 전체 row DELETE 영역)
  const userResult = await query('SELECT company_id FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) return 0;
  const companyId = userResult.rows[0].company_id;

  // ★ D162-3 (2026-05-15) Harold 명시 의도 — 격리 OFF(기본) 회사 = 사용자/admin/슈퍼관리자
  //   누가 삭제하든 회사 전체 user_id의 해당 phone row 모두 DELETE (등록 broadcast 패턴 정합).
  //   옛 user_id 단일 DELETE는 회사 전체 broadcast 등록과 불일치 → 한 user 삭제 시 다른 user에
  //   row 잔존 → 발송 시 매칭 X → 수신거부 풀림 사고. 회사 전체 row 일괄 DELETE로 정합.
  let deletedPhones: string[];

  if (phones && phones.length > 0) {
    // 선택 삭제 — 회사 전체 row DELETE
    const result = await query(
      `DELETE FROM unsubscribes WHERE company_id = $1::uuid AND phone = ANY($2::varchar[]) RETURNING phone`,
      [companyId, phones]
    );
    deletedPhones = Array.from(new Set(result.rows.map((r: any) => r.phone)));
  } else {
    // 전체 삭제 — 회사 전체 row DELETE
    const result = await query(
      `DELETE FROM unsubscribes WHERE company_id = $1::uuid RETURNING phone`,
      [companyId]
    );
    deletedPhones = Array.from(new Set(result.rows.map((r: any) => r.phone)));
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

// ============================================================
// ★ 캠페인 SELECT용 080 번호 SQL fragment (B2-광고+080표시 통합)
// ============================================================
//
// 캠페인 표시 화면(발송결과/캘린더/슈퍼관리자/대시보드)에서
// "(광고)+080번호"를 정확히 부착하려면 캠페인 응답에 사용자/회사의
// opt_out_080_number가 함께 내려가야 한다.
//
// 매칭 우선순위 (CT-03 080 콜백 매칭과 동일):
//   1) users.opt_out_auto_sync = true 인 경우 → users.opt_out_080_number
//   2) 그 외 → companies.opt_out_080_number (fallback)
//
// 사용 위치 (전부 동일 패턴):
//   - results.ts (캠페인 목록/상세)
//   - campaigns.ts (캘린더/캠페인 상세)
//   - admin.ts (슈퍼관리자 통계 캠페인 목록)
//   - stats-aggregation.ts (고객사 대시보드 캠페인 목록)
//   - auto-campaigns.ts (자동발송 목록/실행이력)
//
// ⚠️ 사용 규칙:
//   - 메인 캠페인 테이블 alias 는 반드시 'c' 여야 한다.
//   - 다른 LEFT JOIN 의 alias 와 충돌하지 않게 'opt_user', 'opt_co' 사용.
//   - SELECT 절에는 CAMPAIGN_OPT080_SELECT_EXPR 추가, FROM 뒤에 CAMPAIGN_OPT080_LEFT_JOIN 추가.

/**
 * 캠페인 SELECT 절에 추가할 opt_out_080_number 표현식.
 * 주의: 끝 콤마/공백 없음 — 호출부에서 콤마와 함께 삽입.
 */
export const CAMPAIGN_OPT080_SELECT_EXPR = `COALESCE(
  CASE WHEN opt_user.opt_out_auto_sync = true THEN opt_user.opt_out_080_number END,
  opt_co.opt_out_080_number
) AS opt_out_080_number`;

/**
 * 캠페인 FROM 절 뒤에 추가할 LEFT JOIN — alias/컬럼 가변 빌더.
 *
 * @param campaignAlias - 메인 캠페인 테이블 alias (기본 'c')
 * @param userIdColumn - 발송 주체 사용자 ID 컬럼 (기본 'created_by', 자동발송은 'user_id')
 *
 * @example 일반 캠페인:
 *   buildCampaignOpt080LeftJoin() → "LEFT JOIN users opt_user ON opt_user.id = c.created_by ..."
 * @example 자동발송:
 *   buildCampaignOpt080LeftJoin('ac', 'user_id') → "LEFT JOIN users opt_user ON opt_user.id = ac.user_id ..."
 */
export function buildCampaignOpt080LeftJoin(
  campaignAlias: string = 'c',
  userIdColumn: string = 'created_by'
): string {
  return `
  LEFT JOIN users opt_user ON opt_user.id = ${campaignAlias}.${userIdColumn}
  LEFT JOIN companies opt_co ON opt_co.id = ${campaignAlias}.company_id
`;
}

/**
 * 일반 캠페인용 기본 LEFT JOIN 상수 (alias 'c' + created_by).
 * 6곳의 발송 결과/캘린더/슈퍼관리자/대시보드 SELECT에서 사용.
 */
export const CAMPAIGN_OPT080_LEFT_JOIN = buildCampaignOpt080LeftJoin();
