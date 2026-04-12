/**
 * ★ 전단AI 상품 카탈로그 라우트
 * 마운트: /api/flyer/catalog
 * CT: CT-F11 flyer-catalog.ts, CT-F17 flyer-naver-search.ts
 */

import { Request, Response, Router } from 'express';
import path from 'path';
import fs from 'fs';
import { query } from '../../config/database';
import { flyerAuthenticate, requireFlyerAdmin } from '../../middlewares/flyer-auth';
import { getCatalogItems, upsertCatalogItem, touchCatalogUsage } from '../../utils/flyer';
import {
  searchNaverShopping,
  downloadAndSaveImage,
  autoMatchImage,
  batchAutoMatchImages,
} from '../../utils/flyer/flyer-naver-search';

const router = Router();

// ★ 카탈로그 이미지 서빙 (공개 — 인증 불필요)
router.get('/catalog-images/:companyId/:filename', (req: Request, res: Response) => {
  const { companyId, filename } = req.params;
  // 경로 traversal 방지
  if (companyId.includes('..') || filename.includes('..')) return res.status(400).send('Invalid path');
  const filePath = path.join(process.cwd(), 'uploads', 'catalog-images', companyId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  const ext = path.extname(filename).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.sendFile(filePath);
});

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

// ============================================================
// ★ 네이버 쇼핑 이미지 검색 API (CT-F17)
// ============================================================

/** POST /search-image — 상품명으로 이미지 후보 검색 */
router.post('/search-image', async (req: Request, res: Response) => {
  try {
    const { product_name } = req.body;
    if (!product_name) return res.status(400).json({ error: 'product_name 필수' });

    const result = await searchNaverShopping(product_name, 5);
    return res.json({
      query: result.query,
      total: result.total,
      items: result.items.map(item => ({
        title: item.title,
        image: item.image,
        lprice: item.lprice,
        brand: item.brand,
        maker: item.maker,
      })),
    });
  } catch (error: any) {
    console.error('[flyer/catalog] search-image error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/** POST /select-image — 검색 결과에서 이미지 선택 → 서버 저장 */
router.post('/select-image', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { image_url, catalog_id } = req.body;
    if (!image_url) return res.status(400).json({ error: 'image_url 필수' });

    const savedUrl = await downloadAndSaveImage(image_url, companyId);
    if (!savedUrl) return res.status(500).json({ error: '이미지 다운로드 실패' });

    // 카탈로그 아이템에 이미지 업데이트
    if (catalog_id) {
      await query(
        `UPDATE flyer_catalog SET image_url = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
        [savedUrl, catalog_id, companyId]
      );
    }

    return res.json({ ok: true, image_url: savedUrl });
  } catch (error: any) {
    console.error('[flyer/catalog] select-image error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/** POST /auto-match — 상품명 → 자동 이미지 매칭 (1순위 자동 저장) */
router.post('/auto-match', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { product_name } = req.body;
    if (!product_name) return res.status(400).json({ error: 'product_name 필수' });

    const result = await autoMatchImage(product_name, companyId);
    return res.json(result);
  } catch (error: any) {
    console.error('[flyer/catalog] auto-match error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/** POST /batch-match — CSV 배치 이미지 매칭 */
router.post('/batch-match', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { products } = req.body; // [{ name, index }]
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'products[] 필수' });
    }

    // 최대 50개 제한 (API 호출 제한 보호)
    const limited = products.slice(0, 50);
    const results = await batchAutoMatchImages(limited, companyId);
    return res.json({ results, total: results.length });
  } catch (error: any) {
    console.error('[flyer/catalog] batch-match error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
