/**
 * ★ 전단AI 발신번호 등록 라우트
 * 마운트: /api/flyer/companies/sender-registration
 *
 * 한줄로 routes/sender-registration.ts와 완전 분리.
 * 전단AI는 flyer_callback_numbers 기반 발신번호 관리.
 * 현재는 간단한 CRUD (한줄로의 승인 플로우 없이 즉시 등록).
 */

import { Request, Response, Router } from 'express';
import { query } from '../../config/database';
import { flyerAuthenticate, requireFlyerAdmin } from '../../middlewares/flyer-auth';

const router = Router();
router.use(flyerAuthenticate);

/**
 * GET /my — 내 회사 발신번호 등록 현황
 */
router.get('/my', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const result = await query(
      `SELECT id, phone, label, is_default, created_at
       FROM flyer_callback_numbers
       WHERE company_id = $1 AND deleted_at IS NULL
       ORDER BY is_default DESC, created_at ASC`,
      [companyId]
    );
    return res.json({ numbers: result.rows });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST / — 발신번호 등록 신청 (전단AI는 즉시 등록)
 */
router.post('/', requireFlyerAdmin, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { phone, label } = req.body;
    if (!phone) return res.status(400).json({ error: '발신번호가 필요합니다' });

    const result = await query(
      `INSERT INTO flyer_callback_numbers (id, company_id, phone, label, is_default, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, false, NOW())
       RETURNING id, phone, label`,
      [companyId, phone, label || null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
