/**
 * dm-sample-customer.ts — 샘플 고객 A/B/empty 선정
 *
 * 용도:
 *  - 에디터에서 "샘플 고객 보기" 버튼 클릭 시 실제 DB의 대표 고객 1명으로 렌더링
 *  - 검수 엔진의 data 영역 검사 (변수 치환 실패 탐지)
 *
 * 설계서: status/DM-PRO-DESIGN.md §11-4
 */
import { query } from '../../config/database';
import { getOwnerCustomerScopeSql } from '../store-scope';

export type SampleCustomerKey = 'vip' | 'newbie' | 'empty';

export type SampleCustomer = {
  key: SampleCustomerKey;
  label: string;
  description: string;
  data: Record<string, any> | null;
};

/**
 * 회사별 샘플 고객 3종 선정.
 * VIP: grade='VIP' 또는 points 상위 / Newbie: 최근 가입 + 구매횟수 적음 / Empty: 가상 null
 */
export async function selectSampleCustomers(companyId: string, ownerUserId?: string | null): Promise<SampleCustomer[]> {
  const scope = await ownerScope(companyId, ownerUserId);
  const [vip, newbie] = await Promise.all([
    selectVip(companyId, scope),
    selectNewbie(companyId, scope),
  ]);

  return [
    {
      key: 'vip',
      label: '샘플 A (VIP)',
      description: '등급/포인트가 높은 대표 고객',
      data: vip,
    },
    {
      key: 'newbie',
      label: '샘플 B (신규)',
      description: '최근 가입 + 구매 경험이 적은 고객',
      data: newbie,
    },
    {
      key: 'empty',
      label: '데이터 없는 고객',
      description: 'fallback만 적용되는 상태',
      data: null,
    },
  ];
}

/**
 * ★ 2026-10-24 세 채널 구조체크 ④ — 담당자는 자기 분류 고객만 샘플로 본다(발송 대상과 같은 범위 CT · 관리자 = 빈 조각).
 *   범위를 못 읽으면 아무도 고르지 않는다(fail-closed · 샘플이 비면 가상 값으로 그린다).
 */
async function ownerScope(companyId: string, ownerUserId: string | null | undefined): Promise<string> {
  try { return await getOwnerCustomerScopeSql(companyId, ownerUserId, ''); }
  catch { return ' AND FALSE'; }
}

async function selectVip(companyId: string, scope: string): Promise<Record<string, any> | null> {
  try {
    const res = await query(
      `SELECT * FROM customers
       WHERE company_id = $1
         AND (LOWER(COALESCE(grade, '')) LIKE 'vip%' OR COALESCE(points, 0) > 0)${scope}
       ORDER BY
         CASE WHEN LOWER(COALESCE(grade, '')) LIKE 'vip%' THEN 0 ELSE 1 END,
         COALESCE(points, 0) DESC,
         COALESCE(total_purchase_amount, 0) DESC
       LIMIT 1`,
      [companyId],
    );
    return res.rows[0] || (await fallbackAnyCustomer(companyId, scope));
  } catch {
    return null;
  }
}

async function selectNewbie(companyId: string, scope: string): Promise<Record<string, any> | null> {
  try {
    const res = await query(
      `SELECT * FROM customers
       WHERE company_id = $1${scope}
       ORDER BY
         COALESCE(purchase_count, 0) ASC,
         created_at DESC NULLS LAST
       LIMIT 1`,
      [companyId],
    );
    return res.rows[0] || null;
  } catch {
    return null;
  }
}

async function fallbackAnyCustomer(companyId: string, scope: string): Promise<Record<string, any> | null> {
  try {
    const res = await query(`SELECT * FROM customers WHERE company_id = $1${scope} LIMIT 1`, [companyId]);
    return res.rows[0] || null;
  } catch {
    return null;
  }
}

export async function selectSampleCustomerByKey(companyId: string, key: SampleCustomerKey, ownerUserId?: string | null): Promise<SampleCustomer> {
  if (key === 'vip')    return { key, label: '샘플 A (VIP)',    description: '등급/포인트가 높은 대표 고객', data: await selectVip(companyId, await ownerScope(companyId, ownerUserId)) };
  if (key === 'newbie') return { key, label: '샘플 B (신규)',   description: '최근 가입 + 구매 경험이 적은 고객', data: await selectNewbie(companyId, await ownerScope(companyId, ownerUserId)) };
  return                       { key, label: '데이터 없는 고객', description: 'fallback만 적용되는 상태', data: null };
}
