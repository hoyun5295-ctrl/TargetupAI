/**
 * ★ CT-F19 — 전단AI 장바구니 컨트롤타워
 *
 * Phase 3: 전단지 뷰어에서 상품 장바구니 담기 → 주문 연결
 * - 로그인 불필요: phone (tracking URL에서 식별) 기반
 * - flyer_id + phone 당 장바구니 1개 (UNIQUE 제약)
 * - 장바구니 아이템은 JSONB로 관리
 */

import { query } from '../../../config/database';

// ============================================================
// 타입
// ============================================================
export interface CartItem {
  productName: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  category?: string;
  unit?: string;
}

export interface Cart {
  id: string;
  companyId: string;
  flyerId: string;
  phone: string;
  items: CartItem[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// 장바구니 조회/생성 (UPSERT 패턴)
// ============================================================
export async function getOrCreateCart(
  companyId: string,
  flyerId: string,
  phone: string,
): Promise<Cart> {
  // 기존 장바구니 있으면 반환
  const existing = await query(
    `SELECT * FROM flyer_carts WHERE flyer_id = $1 AND phone = $2`,
    [flyerId, phone]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return {
      id: row.id,
      companyId: row.company_id,
      flyerId: row.flyer_id,
      phone: row.phone,
      items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // 새 장바구니 생성
  const result = await query(
    `INSERT INTO flyer_carts (company_id, flyer_id, phone, items)
     VALUES ($1, $2, $3, '[]')
     ON CONFLICT (flyer_id, phone) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [companyId, flyerId, phone]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    companyId: row.company_id,
    flyerId: row.flyer_id,
    phone: row.phone,
    items: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// 장바구니 아이템 업데이트 (전체 교체)
// ============================================================
export async function updateCartItems(
  flyerId: string,
  phone: string,
  items: CartItem[],
): Promise<Cart | null> {
  const result = await query(
    `UPDATE flyer_carts
     SET items = $1, updated_at = NOW()
     WHERE flyer_id = $2 AND phone = $3
     RETURNING *`,
    [JSON.stringify(items), flyerId, phone]
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    companyId: row.company_id,
    flyerId: row.flyer_id,
    phone: row.phone,
    items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// 장바구니에 상품 추가 (기존 상품이면 수량 증가)
// ============================================================
export async function addItemToCart(
  companyId: string,
  flyerId: string,
  phone: string,
  item: CartItem,
): Promise<Cart> {
  const cart = await getOrCreateCart(companyId, flyerId, phone);
  const existingIdx = cart.items.findIndex(
    i => i.productName === item.productName && i.price === item.price
  );

  if (existingIdx >= 0) {
    cart.items[existingIdx].quantity += item.quantity;
  } else {
    cart.items.push(item);
  }

  const updated = await updateCartItems(flyerId, phone, cart.items);
  return updated || cart;
}

// ============================================================
// 장바구니 비우기
// ============================================================
export async function clearCart(flyerId: string, phone: string): Promise<void> {
  await query(
    `DELETE FROM flyer_carts WHERE flyer_id = $1 AND phone = $2`,
    [flyerId, phone]
  );
}

// ============================================================
// 장바구니 총액 계산
// ============================================================
export function calculateCartTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
}
