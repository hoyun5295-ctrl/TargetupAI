/**
 * ★ 전단AI 상품 카탈로그 라우트
 * 마운트: /api/flyer/catalog
 * CT: CT-F11 flyer-catalog.ts
 */

import { Request, Response, Router } from 'express';
import { query } from '../../config/database';
import { flyerAuthenticate, requireFlyerAdmin } from '../../middlewares/flyer-auth';
import { getCatalogItems, upsertCatalogItem, touchCatalogUsage } from '../../utils/flyer';

const router = Router();
router.use(flyerAuthenticate);

router.get('/', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    const result = await getCatalogItems(companyId, { category, search });
    return res.json(result);
  } catch (error: any) {
    console.error('[flyer/catalog] list error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const id = await upsertCatalogItem(companyId, req.body);
    return res.status(201).json({ id });
  } catch (error: any) {
    console.error('[flyer/catalog] create error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/touch', async (req: Request, res: Response) => {
  try {
    await touchCatalogUsage(req.params.id);
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    await query(`DELETE FROM flyer_catalog WHERE id = $1 AND company_id = $2`, [req.params.id, companyId]);
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
