/**
 * ★ B16-01: 브랜드(store_code) 격리 공통 헬퍼
 *
 * 컨트롤타워: 모든 라우트에서 이 함수 하나로 store 격리 판단.
 * - 브랜드 체계 없는 회사(단일 본사): 필터 없이 company_id 전체
 * - 브랜드 체계 있는 회사 + store_codes 할당된 사용자: 해당 store만 (★2026-09-18: 내 코드의 고객이 아직 0건이어도 그대로 filtered)
 * - 브랜드 체계 있는 회사 + store_codes 미할당 사용자: 차단 (관리자에게만)
 * 소비처 = 8파일 28곳(고객 조회 · 직접 타겟 발송 · 자동 캠페인 · 수신거부 · 운영 대상). 계약 테스트 = __tests__/store-scope.test.ts(0918 신설).
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
