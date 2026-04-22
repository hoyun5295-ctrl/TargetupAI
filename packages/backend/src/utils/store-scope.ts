/**
 * ★ B16-01: 브랜드(store_code) 격리 공통 헬퍼
 *
 * 컨트롤타워: 모든 라우트에서 이 함수 하나로 store 격리 판단.
 * - 브랜드 체계 없는 회사(단일 본사): 필터 없이 company_id 전체
 * - 브랜드 체계 있는 회사 + store_codes 할당된 사용자: 해당 store만
 * - 브랜드 체계 있는 회사 + store_codes 미할당 사용자: 차단 (관리자에게만)
 */
import { query } from '../config/database';

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
      return { type: 'no_filter' };
    }
    return { type: 'filtered', storeCodes };
  }

  // 2. store_codes 미할당 → 회사에 브랜드 체계가 있는지 확인
  const hasStores = await query(
    'SELECT EXISTS(SELECT 1 FROM customer_stores WHERE company_id = $1 LIMIT 1) as has_stores',
    [companyId]
  );

  if (hasStores.rows[0]?.has_stores) {
    // 브랜드 체계 있는데 사용자에게 미할당 → 차단
    return { type: 'blocked' };
  }

  // 브랜드 체계 없는 회사 → 필터 없이 전체
  return { type: 'no_filter' };
}
