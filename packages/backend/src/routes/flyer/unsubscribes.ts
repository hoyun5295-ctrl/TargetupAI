/**
 * ★ 전단AI 수신거부 라우트
 * 마운트: /api/flyer/unsubscribes
 * CT: CT-F02 flyer-unsubscribe-helper.ts
 */

import { Request, Response, Router } from 'express';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';
import {
  registerFlyerUnsubscribe,
  getFlyerUnsubscribes,
  deleteFlyerUnsubscribes,
} from '../../utils/flyer';

const router = Router();
router.use(flyerAuthenticate);

router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId } = req.flyerUser!;
    const page = parseInt(String(req.query.page || '1'), 10);
    const pageSize = parseInt(String(req.query.pageSize || '50'), 10);
    const search = req.query.search as string | undefined;
    const result = await getFlyerUnsubscribes(userId, { page, pageSize, search });
    return res.json(result);
  } catch (error: any) {
    console.error('[flyer/unsubscribes] list error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { userId, companyId } = req.flyerUser!;
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: '전화번호가 필요합니다' });
    await registerFlyerUnsubscribe(userId, companyId, phone, 'manual');
    return res.json({ message: '수신거부 등록되었습니다' });
  } catch (error: any) {
    console.error('[flyer/unsubscribes] register error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/', async (req: Request, res: Response) => {
  try {
    const { userId } = req.flyerUser!;
    const { phones } = req.body;
    if (!Array.isArray(phones)) return res.status(400).json({ error: 'phones 배열이 필요합니다' });
    const deleted = await deleteFlyerUnsubscribes(userId, phones);
    return res.json({ deleted });
  } catch (error: any) {
    console.error('[flyer/unsubscribes] delete error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
