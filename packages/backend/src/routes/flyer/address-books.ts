/**
 * ★ 전단AI 주소록 라우트
 * 마운트: /api/flyer/address-books
 *
 * 한줄로 routes/address-books.ts와 완전 분리.
 * 전단AI 전용 주소록 — flyer_customers 기반 그룹 관리.
 * 현재는 간단한 그룹명 기반 태그 시스템으로 구현.
 *
 * TODO Phase 2: flyer_address_book_groups / flyer_address_book_entries 테이블 신설 시 확장
 */

import { Request, Response, Router } from 'express';
import { query } from '../../config/database';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';

const router = Router();
router.use(flyerAuthenticate);

/**
 * GET /groups — 주소록 그룹 목록
 * 현재는 flyer_customers.source 기반 간단 그룹핑
 */
router.get('/groups', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const result = await query(
      `SELECT source AS group_name, COUNT(*)::int AS count
       FROM flyer_customers
       WHERE company_id = $1 AND deleted_at IS NULL AND source IS NOT NULL
       GROUP BY source
       ORDER BY count DESC`,
      [companyId]
    );
    return res.json(result.rows);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /:groupName — 그룹 내 고객 목록
 */
router.get('/:groupName', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { groupName } = req.params;
    const result = await query(
      `SELECT id, name, phone, gender, email
       FROM flyer_customers
       WHERE company_id = $1 AND source = $2 AND deleted_at IS NULL
       ORDER BY name ASC
       LIMIT 500`,
      [companyId, groupName]
    );
    return res.json(result.rows);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST / — 주소록 저장 (CSV/엑셀 데이터를 source 태그로 저장)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { groupName, recipients } = req.body;
    if (!groupName || !Array.isArray(recipients)) {
      return res.status(400).json({ error: '그룹명과 수신자 목록이 필요합니다' });
    }

    let saved = 0;
    for (const r of recipients) {
      if (!r.phone) continue;
      await query(
        `INSERT INTO flyer_customers (id, company_id, name, phone, source, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
         ON CONFLICT (company_id, phone) DO UPDATE SET source = $4, updated_at = NOW()`,
        [companyId, r.name || null, r.phone, groupName]
      );
      saved++;
    }
    return res.json({ saved, groupName });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /:groupName — 그룹 삭제 (source 태그 초기화)
 */
router.delete('/:groupName', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { groupName } = req.params;
    await query(
      `UPDATE flyer_customers SET source = 'manual' WHERE company_id = $1 AND source = $2`,
      [companyId, groupName]
    );
    return res.json({ message: '그룹이 삭제되었습니다' });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
