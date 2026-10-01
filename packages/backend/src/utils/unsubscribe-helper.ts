/**
 * unsubscribe-helper.ts — 수신거부 관리 컨트롤타워 (CT-03)
 *
 * 수신거부 필터 SQL 패턴이 campaigns.ts, customers.ts, ai.ts, upload.ts 등
 * 10곳 이상에 산재. 이 파일에서 한 곳으로 관리하여 누락/불일치 방지.
 *
 * 또한 opt-in 동기화 로직(단건/벌크)도 여기서 제공하여 재사용 가능하게 함.
 */

import { query } from '../config/database';
import { normalizePhone } from './normalize-phone';
import { mallConsentCodeAmong } from './mall-consent';

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
/**
 * ★ 2026-10-01 브랜드 계정에 옮겨 적을 거부 고객의 판정(B-1001-4) — 이 함수 하나만 쓴다(인라인 금지).
 *   = 고객 행 store_code 가 계정 코드에 있음(옛 판정 · 지금 등록되던 것은 하나도 줄이지 않는다)
 *     OR 그 계정 코드의 소속 행이 있음(소속 표 · 고객은 폰당 1행이라 다매장 고객의 고객 행 칸엔 브랜드 하나만 있다)
 *        — 단 **계정 코드에 몰 동의 코드가 하나라도 있으면 이 분기는 끈다**(resolveSendConsent 와 같은 단위: 그 계정은 몰 동의로 보낸다).
 *   이유(D93): 자사몰 회사는 신규 고객 행을 sms_opt_in=false 로 만들고(cdp-identity · 동의는 올리지 않음) 몰 동의의 진실은 소속 행이다.
 *   몰 동의로 보내는 계정에 고객 행 false 를 영구 수신거부로 옮기면 그 몰에 동의한 고객까지 막히고 몰이 다시 동의해도 풀리지 않는다
 *   (이에스페이먼트 4몰 · Codex 1001 R1: 몰A+업로드B 섞인 계정이 B 소속을 통해 몰A 동의 고객을 막던 반례).
 *   080·수동 수신거부는 이 판정과 무관하게 registerUnsubscribe 가 회사 전 계정에 넣는다(H2-1).
 * @param o.customerAlias 고객 행 별칭(예: 'c' · 'customers')
 * @param o.companyRef    회사 id 식(예: '$1')
 * @param o.codesRef      계정 분류코드 배열 식(예: 'u.store_codes' · '$3::text[]')
 */
export function brandRefusalCopyCond(o: { customerAlias: string; companyRef: string; codesRef: string }): string {
  const a = o.customerAlias;
  return `(${a}.store_code = ANY(${o.codesRef})`
    + ` OR (NOT ${mallConsentCodeAmong(o.companyRef, o.codesRef)}`
    + ` AND EXISTS (SELECT 1 FROM customer_stores bm WHERE bm.company_id = ${o.companyRef} AND bm.customer_id = ${a}.id AND bm.store_code = ANY(${o.codesRef}))))`;
}

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
         -- ★ 2026-10-01 브랜드 판정 = brandRefusalCopyCond(고객 행 칸 OR 몰 동의 코드가 아닌 소속 · B-1001-4)
         (u.store_codes IS NOT NULL AND array_length(u.store_codes, 1) > 0
          AND ${brandRefusalCopyCond({ customerAlias: 'c', companyRef: '$1', codesRef: 'u.store_codes' })}
          AND EXISTS (SELECT 1 FROM customer_stores cs
                       WHERE cs.company_id = $1
                         AND cs.store_code = ANY(u.store_codes)))
       )
     ON CONFLICT (user_id, phone) DO NOTHING`,
    [companyId, source],
  );
  return result.rowCount || 0;
}

/**
 * ★ 2026-10-01 브랜드 사용자가 업로드한 뒤 **업로더 본인** 명부에 거부 고객을 옮겨 적는다(D114 P3 · upload.ts 인라인 SQL 을 옮김 · B-1001-4).
 *   계정 코드가 있으면 brandRefusalCopyCond 범위만 · 없으면(단일 브랜드 회사) 회사 전체 — 옛 동작 그대로.
 * @returns 실제 INSERT 건수
 */
export async function registerUploaderOwnUnsubscribes(
  companyId: string,
  userId: string,
  storeCodes: string[] | null | undefined,
  source: string,
): Promise<number> {
  const codes = (storeCodes || []).filter(Boolean);
  const scoped = codes.length > 0;
  const result = await query(
    `INSERT INTO unsubscribes (company_id, user_id, phone, source)
     SELECT $1, $2, phone, $3
     FROM customers
     WHERE company_id = $1 AND sms_opt_in = false AND is_active = true
       ${scoped ? `AND ${brandRefusalCopyCond({ customerAlias: 'customers', companyRef: '$1', codesRef: '$4::text[]' })}` : ''}
       AND NOT EXISTS (
         SELECT 1 FROM unsubscribes u WHERE u.user_id = $2 AND u.phone = customers.phone
       )
     ON CONFLICT (user_id, phone) DO NOTHING`,
    scoped ? [companyId, userId, source, codes] : [companyId, userId, source],
  );
  return result.rowCount || 0;
}

/**
 * 회사의 사용자 격리 스위치(companies.user_isolation_enabled). 없음·NULL = false.
 * ★2026-09-22: 이 값을 보는 입구가 등록 하나뿐이었다 → 삭제·080·동의 동기화도 같은 판정을 쓴다(설계서 docs/2026-09-22-mall-consent-isolation-design.md §4-3).
 */
export async function isUserIsolationEnabled(companyId: string): Promise<boolean> {
  const r = await query(
    `SELECT COALESCE(user_isolation_enabled, false) AS iso FROM companies WHERE id = $1::uuid`,
    [companyId]
  );
  return r.rows[0]?.iso === true;
}

/**
 * 격리 ON 회사의 수신거부 삭제 — **본인(user_id) 행만** 지운다. H2: 한 계정(몰)의 삭제가 다른 계정의 거부를 풀지 않는다.
 * ⛔ 관리자 행은 지우지 않는다(Codex 0922 R1) — 관리자 행이 등록 사본인지 관리자 자신의 독립된 거부(자기 080 직접 매칭 등)인지
 *    행만 봐서는 구별할 수 없다. 사본으로 보고 지우면 관리자 발송에서 그 번호의 제외가 풀린다. 남기는 쪽은 "덜 보낸다"뿐이다.
 * ⛔ customers.sms_opt_in 을 되살리지 않는다(회사 전체 값이라 다른 몰까지 켠다 — 0922 실측한 과발송 방향).
 * @param phones 비우면(undefined) 그 사용자의 전체
 * @returns 실제로 지운 번호(중복 제거)
 */
export async function deleteIsolatedUnsubscribes(companyId: string, userId: string, phones?: string[]): Promise<string[]> {
  const own = phones && phones.length > 0
    ? await query(
        `DELETE FROM unsubscribes WHERE company_id = $1::uuid AND user_id = $2::uuid AND phone = ANY($3::varchar[]) RETURNING phone`,
        [companyId, userId, phones]
      )
    : await query(
        `DELETE FROM unsubscribes WHERE company_id = $1::uuid AND user_id = $2::uuid RETURNING phone`,
        [companyId, userId]
      );
  return Array.from(new Set(own.rows.map((r: any) => r.phone as string)));
}

export class IsolationBlockedError extends Error {
  constructor() {
    super('ISOLATION_BLOCKED');
    this.name = 'IsolationBlockedError';
  }
}

/** ★ 2026-09-26 한줄로 V2 R1-17 — 파일 등록이 번호별 등록을 동시에 몇 건까지 돌리는가(번호끼리 독립 · PG 풀을 몰아 쓰지 않게) */
export const UNSUB_UPLOAD_CONCURRENCY = 5;

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
  const isolationEnabled = await isUserIsolationEnabled(companyId);

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
  // ★ 2026-09-28 한줄로 V2 R171 — 양쪽을 숫자만 남겨 비교한다(normalizePhone 과 같은 규칙 = 비숫자 제거).
  //   저장된 번호에 하이픈이 섞여 있어도 놓치지 않는다(놓치면 수신거부자에게 나간다). 돌려주는 값 = 숫자만 남긴 번호.
  //   옛 소비처(브랜드 발송)는 계정 수신거부 전량을 받아 앱에서 걸렀다 → 받는 번호만 DB에서 찾는다.
  const normalized = Array.from(new Set((phones || []).map((p) => normalizePhone(p)).filter(Boolean)));
  if (normalized.length === 0) return [];

  const result = await query(
    `SELECT DISTINCT regexp_replace(phone, '\\D', '', 'g') AS phone FROM unsubscribes
      WHERE user_id = $1 AND regexp_replace(phone, '\\D', '', 'g') = ANY($2::text[])`,
    [userId, normalized]
  );
  return result.rows.map((r: any) => String(r.phone));
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
  //   ★2026-09-22: 격리 ON 회사는 돌리지 않는다 — 회사 전체 값이라 한 계정(몰)의 080 거부가 다른 몰의 동의까지 끈다(H2).
  //   거부 자체는 위에서 계정 행으로 이미 들어갔고, 발송 제외는 unsubscribes(user_id) 안티조인이 한다.
  for (const companyId of companyIds) {
    if (await isUserIsolationEnabled(companyId)) continue;
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

  // ★ 2026-09-28 한줄로 V2 R142 — 번호별 최신 1건(DISTINCT ON) 뒤 정렬·페이지를 SQL에서 한다.
  //   옛: 대상 전체를 받아 JS에서 created_at 정렬·slice로 한 쪽(50건)을 잘랐다(큰 회사면 수만 건 전송). 결과는 같다.
  const pageParams = [...params, limit, offset];
  const dataResult = await query(
    `SELECT id, phone, source, created_at FROM (
       SELECT DISTINCT ON (phone) id, phone, source, created_at
         FROM unsubscribes ${whereClause}
        ORDER BY phone, created_at DESC
     ) latest
     ORDER BY created_at DESC
     LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
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
  // 먼저 company_id 조회 (sms_opt_in 동기화 + 회사 전체 row DELETE 영역)
  const userResult = await query('SELECT company_id FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) return 0;
  const companyId = userResult.rows[0].company_id;

  // ★2026-09-22: 격리 ON 회사는 그 사용자 행만 지우고 동의를 되살리지 않는다(아래 회사 전체 DELETE 는 격리 OFF 의 broadcast 등록과 짝이다).
  if (await isUserIsolationEnabled(companyId)) {
    return (await deleteIsolatedUnsubscribes(companyId, userId, phones)).length;
  }

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
