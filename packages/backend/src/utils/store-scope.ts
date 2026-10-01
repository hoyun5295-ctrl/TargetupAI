/**
 * ★ B16-01: 브랜드(store_code) 격리 공통 헬퍼
 *
 * 컨트롤타워: 모든 라우트에서 이 함수 하나로 store 격리 판단.
 * - 브랜드 체계 없는 회사(단일 본사): 필터 없이 company_id 전체
 * - 브랜드 체계 있는 회사 + store_codes 할당된 사용자: 해당 store만 (★2026-09-18: 내 코드의 고객이 아직 0건이어도 그대로 filtered)
 * - 브랜드 체계 있는 회사 + store_codes 미할당 사용자: 차단 (관리자에게만)
 * 소비처 = 8파일 28곳(고객 조회 · 직접 타겟 발송 · 자동 캠페인 · 수신거부 · 운영 대상). 계약 테스트 = __tests__/store-scope.test.ts(0918 신설).
 */
import { escapeLiteral } from 'pg';
import { query } from '../config/database';

/**
 * 고객 매장 격리 SQL 조각 — 파라미터 번호를 쓸 수 없는 자리(한 조각을 여러 쿼리에 이어 붙이는 대시보드 카드 등)용.
 * ★ 2026-09-25 한줄로 전수점검 C-02: 매장 코드(users.store_codes)는 고객사 관리자가 자유 문자열로 넣는다(manage-users 검증 없음).
 *   따옴표로만 감싸 붙이면 SQL을 바꿀 수 있고 따옴표 하나에도 500이 난다 → 값은 반드시 pg escapeLiteral로 감싼다.
 *   파라미터 바인딩(`ANY($n::text[])`)을 쓸 수 있는 자리는 그쪽이 우선이다.
 */
export function buildCustomerStoreFilterLiteral(companyId: string, storeCodes: string[], alias?: string): string {
  const codes = storeCodes.map((s) => escapeLiteral(String(s))).join(',');
  // ★ 2026-09-27 S5-04 — 조인 쿼리(cdp_events e JOIN customers c 등)에서 id가 모호해지지 않게 별칭(선택). 없으면 종전과 1바이트도 같다.
  const col = alias ? `${alias}.id` : 'id';
  return ` AND ${col} IN (SELECT customer_id FROM customer_stores WHERE company_id = ${escapeLiteral(String(companyId))} AND store_code = ANY(ARRAY[${codes}]::text[]))`;
}

/**
 * ★ 2026-10-01 브랜드(분류코드) 소속 조건 — 파라미터 바인딩 자리용. 소속의 진실은 customer_stores 다(SCHEMA customers 절 0814 정정).
 *   고객 행 `customers.store_code` 는 자사몰 연동 고객에서 비어 있다(cdp-identity 가 채우지 않는다) → 그 칸으로 거르면 몰 고객이 전부 빠졌다
 *   (박성용 접수 cmuozso84 · 이에스페이먼트 428,962명 전원 빈 칸). 브랜드로 거르는 자리는 이 함수만 쓴다(인라인 금지).
 *   고객은 폰당 1행(customers_company_id_phone_key)이라 업로드 회사의 다매장 고객도 옛 칸에는 브랜드 하나만 있다 → 소속 표로 보면 그 고객이
 *   소속된 모든 브랜드에 잡힌다(넓어짐). 옛 칸에만 있고 같은 코드 소속 행이 없는 고객 = 전 회사 0명(1001 실측) → 빠지는 고객 없음.
 * @param idCol          고객 id 열(별칭 포함 · 예: 'c.id' · 'id' · 'p.customer_id')
 * @param companyRef     회사 id 자리표(예: '$1')
 * @param codeRef        분류코드 자리표(예: '$3') — many 면 text[] 배열
 * @param requireConsent 몰 동의 발송(mall-consent buildSendConsent mode=mall)일 때 true — 브랜드 소속과 그 브랜드의 동의를 **같은 소속 행**에서 본다.
 *                       없으면 범위 [A,B] 계정이 A 를 고를 때 A 거부·B 동의 고객이 범위 조각의 B 동의로 통과한다(Codex 1001 R1 high).
 *                       별칭 한정(mcs) = mall-consent 0922 R1 규칙 — 동의 컬럼이 없는 환경에서 바깥 customers.sms_opt_in 으로 새지 않고 42703 으로 드러난다.
 */
export interface StoreMembershipOpts { idCol: string; companyRef: string; codeRef: string; many?: boolean; requireConsent?: boolean }
export function storeMembershipCond(opts: StoreMembershipOpts): string {
  const code = opts.many ? `ANY(${opts.codeRef}::text[])` : opts.codeRef;
  if (opts.requireConsent) {
    return `${opts.idCol} IN (SELECT mcs.customer_id FROM customer_stores mcs WHERE mcs.company_id = ${opts.companyRef} AND mcs.store_code = ${code} AND mcs.sms_opt_in = true)`;
  }
  return `${opts.idCol} IN (SELECT customer_id FROM customer_stores WHERE company_id = ${opts.companyRef} AND store_code = ${code})`;
}
/** storeMembershipCond 앞에 ' AND ' 를 붙인 WHERE 덧붙임 조각 */
export function storeMembershipClause(opts: StoreMembershipOpts): string {
  return ` AND ${storeMembershipCond(opts)}`;
}

/**
 * ★ 2026-10-01 범위 안 고객 중 소속 행이 하나라도 있는가 — 활성 필드 탐지(CT-18)의 매장코드 판정용.
 *   자사몰 연동 회사는 고객 행 store_code 가 전부 비어 고객 행 칸만 세면 매장코드 필드가 꺼졌다(B-1001-3 · Codex R1 medium).
 * @param scopeWhere customers 기준 WHERE 조각(별칭 없음 · 예: 'company_id = $1 AND is_active = true')
 * @param scopeParams 그 조각의 파라미터 — 회사 id 는 맨 뒤 자리로 덧붙인다(소속 표 회사 인덱스 idx_cs_company_store)
 */
export async function hasStoreMembershipInScope(companyId: string, scopeWhere: string, scopeParams: any[]): Promise<boolean> {
  const r = await query(
    `SELECT EXISTS (SELECT 1 FROM customer_stores cs WHERE cs.company_id = $${scopeParams.length + 1} AND cs.customer_id IN (SELECT id FROM customers WHERE ${scopeWhere})) AS has`,
    [...scopeParams, companyId],
  );
  return r.rows[0]?.has === true;
}

/**
 * ★ 2026-10-01 범위 안 고객의 소속 분류코드 목록(가나다순 · 최대 100) SQL — 활성 필드 드롭다운 옵션(CT-18)의 매장코드용.
 *   결과 열 이름 = store_code. 파라미터 = [...scopeParams, companyId].
 */
export function storeMembershipCodesSql(scopeWhere: string, scopeParamCount: number): string {
  return `SELECT DISTINCT cs.store_code FROM customer_stores cs WHERE cs.company_id = $${scopeParamCount + 1} AND cs.store_code <> '' AND cs.customer_id IN (SELECT id FROM customers WHERE ${scopeWhere}) ORDER BY cs.store_code LIMIT 100`;
}

/**
 * ★ 2026-10-01 화면·엑셀의 「매장코드」 = 고객 행 값이 있으면 그것 · 없으면 소속 표의 코드들(쉼표로 · 가나다순).
 *   자사몰 연동 고객은 고객 행 값이 비어 매장코드가 빈칸으로 보였다(cmuozso84 관련).
 * @param alias 고객 행 별칭(예: 'customers_unified' · 'c') — company_id · id · store_code 열이 있어야 한다
 */
export function storeCodeDisplayExpr(alias: string): string {
  return `COALESCE(NULLIF(${alias}.store_code, ''), (SELECT string_agg(cs.store_code, ', ' ORDER BY cs.store_code) FROM customer_stores cs WHERE cs.company_id = ${alias}.company_id AND cs.customer_id = ${alias}.id))`;
}

export type StoreScopeResult =
  | { type: 'no_filter' }           // 브랜드 체계 없음 → company_id 전체
  | { type: 'filtered'; storeCodes: string[] }  // 브랜드 체계 있음 + 할당됨
  | { type: 'blocked' };            // 브랜드 체계 있는데 미할당 → 차단

/**
 * company_user의 store 격리 범위를 결정
 * company_admin/super_admin은 이 함수를 호출하지 않음 (전체 조회 가능)
 */
export async function getStoreScope(companyId: string, userId: string): Promise<StoreScopeResult> {
  // 1. 사용자의 store_codes 조회
  const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
  const storeCodes = userResult.rows[0]?.store_codes;

  if (storeCodes && storeCodes.length > 0) {
    // ★ D136 (2026-04-22): 유령 배정 방어
    //   배경: 주식회사 인비토 사례 — customer_stores 0건(브랜드 체계 없음)인데
    //         users.store_codes에 {JIHYUN}/{EUNJI} 수동 배정 → filtered 판정 후
    //         customers.store_code 전원 NULL로 매칭 0건 → 고객DB 조회 0건.
    //   방어: 배정된 store_codes 중 customer_stores에 실존하는 것이 하나도 없으면
    //         "brand 체계 없는 회사의 유령 배정"으로 간주하고 no_filter 폴백.
    //         향후 customer_stores 채워지면 자동으로 filtered 동작 복귀.
    const validCheck = await query(
      `SELECT EXISTS(
         SELECT 1 FROM customer_stores
          WHERE company_id = $1 AND store_code = ANY($2::text[])
       ) AS has_match`,
      [companyId, storeCodes]
    );
    if (!validCheck.rows[0]?.has_match) {
      // ★ 2026-09-18 정정(설계서 docs/2026-09-18-mall-integration-user-scope-design.md §3-6):
      //   "내 코드 매칭 0건"만으로 전체를 열면, 분류 체계가 있는 회사에서 아직 자기 고객이 없는 사용자에게
      //   회사 전체가 열린다(조회뿐 아니라 직접 타겟 발송 campaigns.ts 3곳도 같은 결과를 쓴다).
      //   유령 배정 폴백은 회사 전체에 customer_stores 가 0행일 때(인비토 사례)만 — 그 밖은 "아직 내 고객이 없다" = 0건이 정답.
      //   0918 실측: 배정 사용자 7명 전원이 0행 회사 소속이라 이 갈래로 행동이 바뀌는 운영 사용자는 없다.
      const anyRows = await query(
        'SELECT EXISTS(SELECT 1 FROM customer_stores WHERE company_id = $1 LIMIT 1) as has_stores',
        [companyId]
      );
      if (!anyRows.rows[0]?.has_stores) return { type: 'no_filter' };
    }
    return { type: 'filtered', storeCodes };
  }

  // 2. store_codes 미할당 → 회사에 브랜드 체계가 있는지 확인
  const hasStores = await query(
    'SELECT EXISTS(SELECT 1 FROM customer_stores WHERE company_id = $1 LIMIT 1) as has_stores',
    [companyId]
  );

  if (hasStores.rows[0]?.has_stores) {
    // ★ 2026-07-08 (Harold 명시): 회사 옵션 — 하위 사용자 전체 접근 허용 시 차단 대신 회사 전체 조회.
    //   브랜드 격리 회사에서 미할당 하위 사용자도 회사 전체 고객·구매데이터를 쓰게 하려는 회사만 켠다.
    //   기본 false = 기존 차단 유지(다른 격리 회사 영향 0). 컬럼 미존재(마이그레이션 전) = false 취급(db_alter_safety_net).
    let allowUserFullAccess = false;
    try {
      const optResult = await query('SELECT allow_user_full_access FROM companies WHERE id = $1', [companyId]);
      allowUserFullAccess = optResult.rows[0]?.allow_user_full_access === true;
    } catch (e: any) {
      const msg = e?.message || '';
      if (!(msg.includes('column') && msg.includes('does not exist'))) throw e;
    }
    if (allowUserFullAccess) return { type: 'no_filter' };
    // 브랜드 체계 있는데 미할당 + 옵션 꺼짐 → 차단
    return { type: 'blocked' };
  }

  // 브랜드 체계 없는 회사 → 필터 없이 전체
  return { type: 'no_filter' };
}

// ============================================================
// 고객 범위 SQL 조각 — 주인(사용자 id) 기준 (★2026-09-27 한줄로 V2 S5-04 · R113)
// ============================================================

/**
 * 주인(요청 사용자 · 캠페인·여정 작성자)의 분류코드 범위를 고객 쿼리에 붙일 **리터럴** 조각으로 돌려준다.
 * 파라미터 번호를 맞출 필요가 없어 쿼리 모양이 여럿인 곳(여정 추출 13곳 · 타겟 인원 · 이메일 대상)에 같은 한 줄로 붙는다.
 * - 주인 없음 · 사용자 유형이 'user'(담당자)가 아님(관리자·시스템·슈퍼) = 빈 조각(종전 SQL 그대로)
 * - filtered = 범위 서브쿼리 · blocked(분류 체계가 있는데 미배정) = ' AND FALSE' · no_filter(분류 체계 없는 회사) = 빈 조각
 * 판정은 getStoreScope 하나(재구현 금지). 값은 escapeLiteral로 감싼다(buildCustomerStoreFilterLiteral).
 */
export async function getOwnerCustomerScopeSql(
  companyId: string,
  ownerUserId: string | null | undefined,
  alias = 'c',
): Promise<string> {
  if (!ownerUserId) return '';
  const u = await query('SELECT user_type FROM users WHERE id = $1', [ownerUserId]);
  if (u.rows[0]?.user_type !== 'user') return '';
  const scope = await getStoreScope(companyId, ownerUserId);
  if (scope.type === 'filtered') return buildCustomerStoreFilterLiteral(companyId, scope.storeCodes, alias);
  if (scope.type === 'blocked') return ' AND FALSE';
  return '';
}

/**
 * 여정 대상의 분류코드 범위 = 그 여정 **작성자** 기준(발송 워커에는 요청 사용자가 없다).
 * 관리자가 만든 여정·분류 체계 없는 회사는 빈 조각이라 추출 SQL이 종전과 같다.
 */
export async function getJourneyOwnerScopeSql(
  companyId: string,
  journeyId: string | null | undefined,
  alias = 'c',
): Promise<string> {
  if (!journeyId) return '';
  const j = await query('SELECT created_by FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid', [journeyId, companyId]);
  return getOwnerCustomerScopeSql(companyId, j.rows[0]?.created_by || null, alias);
}

// ============================================================
// 개인화 샘플 고객 1명 조회의 범위 (★2026-09-22)
// ============================================================

/** 샘플 고객 조회(`FROM customers WHERE company_id = $1 …`)에 붙일 조각. 빈 조각 = 기존 SQL 과 1바이트도 같다. */
export interface SampleCustomerScope { where: string; params: any[] }

/**
 * 테스트 발송·스팸 테스트가 개인화 미리보기에 쓰는 "샘플 고객 1명" 조회의 분류코드 격리.
 * 결함(0922 실측): 이 조회들이 회사 전체를 읽어, 분류코드 사용자(몰별 계정)의 테스트 문자에 다른 몰 고객의 이름·커스텀 필드가 찍혔다.
 *
 * - 판정은 getStoreScope 하나(재구현 금지). company_user(DB user_type='user')만 탄다 — 관리자·슈퍼·사용자 없음 = 빈 조각.
 * - userType(JWT)을 모르는 경로(큐 워커)는 users.user_type 으로 판정한다.
 * - filtered = 범위 서브쿼리 한 모양 · blocked = ` AND FALSE`(고객을 주지 않는다 → 호출부의 기존 폴백 `rows[0] || {}` 가 빈 객체로 받는다 · 발송은 막지 않는다).
 * @param opts.paramIndex 분류코드 배열이 들어갈 자리($N). 호출부는 `[companyId, ...scope.params]` 로 넘긴다.
 */
export async function getSampleCustomerScope(
  companyId: string,
  userId: string | null | undefined,
  opts: { userType?: string; paramIndex: number },
): Promise<SampleCustomerScope> {
  const none: SampleCustomerScope = { where: '', params: [] };
  if (!userId) return none;
  let isStoreUser: boolean;
  if (opts.userType !== undefined) {
    isStoreUser = opts.userType === 'company_user';
  } else {
    const r = await query('SELECT user_type FROM users WHERE id = $1', [userId]);
    isStoreUser = r.rows[0]?.user_type === 'user';
  }
  if (!isStoreUser) return none;
  const scope = await getStoreScope(companyId, userId);
  if (scope.type === 'filtered') {
    return {
      where: ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${opts.paramIndex}::text[]))`,
      params: [scope.storeCodes],
    };
  }
  if (scope.type === 'blocked') return { where: ' AND FALSE', params: [] };
  return none;
}
