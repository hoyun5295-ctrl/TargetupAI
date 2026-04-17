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
export async function selectSampleCustomers(companyId: string): Promise<SampleCustomer[]> {
  const [vip, newbie] = await Promise.all([
    selectVip(companyId),
    selectNewbie(companyId),
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

async function selectVip(companyId: string): Promise<Record<string, any> | null> {
  try {
    const res = await query(
      `SELECT * FROM customers
       WHERE company_id = $1
         AND (LOWER(COALESCE(grade, '')) LIKE 'vip%' OR COALESCE(points, 0) > 0)
       ORDER BY
         CASE WHEN LOWER(COALESCE(grade, '')) LIKE 'vip%' THEN 0 ELSE 1 END,
         COALESCE(points, 0) DESC,
         COALESCE(total_purchase_amount, 0) DESC
       LIMIT 1`,
      [companyId],
    );
    return res.rows[0] || (await fallbackAnyCustomer(companyId));
  } catch {
    return null;
  }
}

async function selectNewbie(companyId: string): Promise<Record<string, any> | null> {
  try {
    const res = await query(
      `SELECT * FROM customers
       WHERE company_id = $1
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

async function fallbackAnyCustomer(companyId: string): Promise<Record<string, any> | null> {
  try {
    const res = await query(`SELECT * FROM customers WHERE company_id = $1 LIMIT 1`, [companyId]);
    return res.rows[0] || null;
  } catch {
    return null;
  }
}

export async function selectSampleCustomerByKey(companyId: string, key: SampleCustomerKey): Promise<SampleCustomer> {
  if (key === 'vip')    return { key, label: '샘플 A (VIP)',    description: '등급/포인트가 높은 대표 고객', data: await selectVip(companyId) };
  if (key === 'newbie') return { key, label: '샘플 B (신규)',   description: '최근 가입 + 구매 경험이 적은 고객', data: await selectNewbie(companyId) };
  return                       { key, label: '데이터 없는 고객', description: 'fallback만 적용되는 상태', data: null };
}
