/**
 * ★ 전단AI: 주문 관리 라우트 (사장님용 — 인증 필요)
 *
 * 마운트: /api/flyer/orders
 * CT: CT-F20 flyer-orders.ts
 */

import { Request, Response, Router } from 'express';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';
import {
  getOrdersByCompany,
  getOrderDetail,
  updateOrderStatus,
  getOrderSummary,
  OrderStatus,
} from '../../utils/flyer/order/flyer-orders';

const router = Router();
router.use(flyerAuthenticate);

/**
 * GET /orders — 주문 목록 (사장님)
 * Query: ?page=1&pageSize=20&status=pending
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const page = parseInt(String(req.query.page || '1'), 10);
    const pageSize = parseInt(String(req.query.pageSize || '20'), 10);
    const status = req.query.status as OrderStatus | undefined;

    const result = await getOrdersByCompany(companyId, page, pageSize, status);
    return res.json(result);
  } catch (err: any) {
    console.error('[flyer/orders] list error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /orders/summary — 주문 요약 통계 (대시보드용)
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const summary = await getOrderSummary(companyId);
    return res.json(summary);
  } catch (err: any) {
    console.error('[flyer/orders] summary error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /orders/:id — 주문 상세
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const order = await getOrderDetail(req.params.id, companyId);
    if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다' });
    return res.json(order);
  } catch (err: any) {
    console.error('[flyer/orders] detail error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PATCH /orders/:id/status — 주문 상태 변경
 * Body: { status: 'confirmed' | 'ready' | 'completed' | 'cancelled' }
 */
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { status } = req.body;

    if (!status) return res.status(400).json({ error: 'status 필수' });

    const validStatuses: OrderStatus[] = ['confirmed', 'ready', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `유효하지 않은 상태: ${status}` });
    }

    const order = await updateOrderStatus(req.params.id, companyId, status);
    if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다' });
    return res.json(order);
  } catch (err: any) {
    if (err.message.includes('상태 전환 불가')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[flyer/orders] status update error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
