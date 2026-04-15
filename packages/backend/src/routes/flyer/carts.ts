/**
 * ★ 전단AI: 장바구니 공개 API
 *
 * 마운트: /api/flyer/cart (공개 — 인증 불필요)
 * phone 기반 식별 (tracking URL에서 서버가 조회한 값)
 *
 * ⚠️ 보안: phone은 short_urls 테이블에서 서버가 조회한 값만 사용.
 *         클라이언트가 직접 phone을 조작하더라도 장바구니/주문 정도의 리스크.
 */

import { Request, Response, Router } from 'express';
import {
  getOrCreateCart,
  addItemToCart,
  updateCartItems,
  clearCart,
  CartItem,
} from '../../utils/flyer/order/flyer-carts';
import { createOrder, getOrdersByPhone, CreateOrderParams } from '../../utils/flyer/order/flyer-orders';
import { query } from '../../config/database';

const router = Router();

/**
 * 전단지 → 회사 ID 조회 헬퍼
 */
async function getCompanyIdByFlyer(flyerId: string): Promise<string | null> {
  const r = await query(`SELECT company_id FROM flyers WHERE id = $1`, [flyerId]);
  return r.rows[0]?.company_id || null;
}

/**
 * GET /cart/:flyerId — 장바구니 조회
 * Query: ?phone=01012345678
 */
router.get('/:flyerId', async (req: Request, res: Response) => {
  try {
    const { flyerId } = req.params;
    const phone = req.query.phone as string;
    if (!phone) return res.status(400).json({ error: 'phone 필수' });

    const companyId = await getCompanyIdByFlyer(flyerId);
    if (!companyId) return res.status(404).json({ error: '전단지 없음' });

    const cart = await getOrCreateCart(companyId, flyerId, phone);
    return res.json(cart);
  } catch (err: any) {
    console.error('[flyer/cart] GET error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /cart/:flyerId/add — 장바구니에 상품 추가
 * Body: { phone, item: { productName, price, quantity, imageUrl?, category?, unit? } }
 */
router.post('/:flyerId/add', async (req: Request, res: Response) => {
  try {
    const { flyerId } = req.params;
    const { phone, item } = req.body;
    if (!phone || !item?.productName || item.price == null) {
      return res.status(400).json({ error: 'phone, item.productName, item.price 필수' });
    }

    const companyId = await getCompanyIdByFlyer(flyerId);
    if (!companyId) return res.status(404).json({ error: '전단지 없음' });

    const cart = await addItemToCart(companyId, flyerId, phone, {
      productName: item.productName,
      price: Number(item.price),
      quantity: Number(item.quantity) || 1,
      imageUrl: item.imageUrl,
      category: item.category,
      unit: item.unit,
    });
    return res.json(cart);
  } catch (err: any) {
    console.error('[flyer/cart] add error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /cart/:flyerId — 장바구니 아이템 전체 업데이트
 * Body: { phone, items: CartItem[] }
 */
router.put('/:flyerId', async (req: Request, res: Response) => {
  try {
    const { flyerId } = req.params;
    const { phone, items } = req.body;
    if (!phone || !Array.isArray(items)) {
      return res.status(400).json({ error: 'phone, items[] 필수' });
    }

    const cart = await updateCartItems(flyerId, phone, items);
    if (!cart) return res.status(404).json({ error: '장바구니 없음' });
    return res.json(cart);
  } catch (err: any) {
    console.error('[flyer/cart] update error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /cart/:flyerId — 장바구니 비우기
 * Query: ?phone=01012345678
 */
router.delete('/:flyerId', async (req: Request, res: Response) => {
  try {
    const { flyerId } = req.params;
    const phone = req.query.phone as string;
    if (!phone) return res.status(400).json({ error: 'phone 필수' });

    await clearCart(flyerId, phone);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[flyer/cart] delete error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /cart/:flyerId/order — 주문 생성 (장바구니 → 주문 전환)
 * Body: { phone, customerName?, pickupType?, pickupTime?, note? }
 */
router.post('/:flyerId/order', async (req: Request, res: Response) => {
  try {
    const { flyerId } = req.params;
    const { phone, customerName, pickupType, pickupTime, note } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone 필수' });

    const companyId = await getCompanyIdByFlyer(flyerId);
    if (!companyId) return res.status(404).json({ error: '전단지 없음' });

    // 장바구니에서 아이템 가져오기
    const cart = await getOrCreateCart(companyId, flyerId, phone);
    if (!cart.items || cart.items.length === 0) {
      return res.status(400).json({ error: '장바구니가 비어있습니다' });
    }

    const order = await createOrder({
      companyId,
      flyerId,
      phone,
      customerName,
      items: cart.items,
      pickupType: pickupType || 'store_pickup',
      pickupTime: pickupTime || null,
      note,
    });

    return res.json(order);
  } catch (err: any) {
    console.error('[flyer/cart] order error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /cart/:flyerId/orders — 고객 본인 주문 내역 조회
 * Query: ?phone=01012345678
 */
router.get('/:flyerId/orders', async (req: Request, res: Response) => {
  try {
    const { flyerId } = req.params;
    const phone = req.query.phone as string;
    if (!phone) return res.status(400).json({ error: 'phone 필수' });

    const orders = await getOrdersByPhone(flyerId, phone);
    return res.json(orders);
  } catch (err: any) {
    console.error('[flyer/cart] orders error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
