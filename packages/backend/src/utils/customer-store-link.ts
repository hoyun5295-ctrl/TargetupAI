/**
 * ★ CT: 고객 ↔ 분류코드 소속 기록 (2026-09-18 · 설계서 docs/2026-09-18-mall-integration-user-scope-design.md §2-5 · §3-3)
 *
 * 고객은 폰당 1행이 진실이고 다매장 소속은 customer_stores 가 소유한다(status/SCHEMA.md customers 절 · 0814 정정).
 * 사용자 범위 필터(utils/store-scope.ts 소비처 전부)가 이 표를 거친다.
 *   `id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY(...))`
 *
 * 형제 적재 경로(routes/upload.ts · routes/sync.ts · routes/customers.ts)는 같은 줄을 각자 인라인으로 쓰고 있다.
 * 자사몰 적재(utils/cdp-identity.ts identifyCustomer)가 네 번째 인라인을 만들지 않도록 이 함수 하나를 둔다.
 * 기존 3곳을 이 함수로 옮기는 일은 별건이다(설계서 §8).
 *
 * ⛔ 실패를 던지지 않는다. 분류 기록 실패로 회원·주문 적재가 유실되면 안 된다(다음 이벤트에서 다시 기록된다).
 * ⛔ 분류코드가 비어 있으면 아무것도 쓰지 않는다 = 단일몰·무분류 회사의 동작 불변.
 */
import { query } from '../config/database';

export async function linkCustomerStore(
  companyId: string,
  customerId: string,
  storeCode: string | null | undefined,
): Promise<boolean> {
  const code = typeof storeCode === 'string' ? storeCode.trim() : '';
  if (!companyId || !customerId || !code) return false;
  try {
    await query(
      `INSERT INTO customer_stores (company_id, customer_id, store_code)
       VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, store_code) DO NOTHING`,
      [companyId, customerId, code],
    );
    return true;
  } catch (err: any) {
    console.warn(`[customer-store-link] 분류 기록 실패(적재는 계속) company=${companyId} customer=${customerId} code=${code}:`, err?.message || err);
    return false;
  }
}
