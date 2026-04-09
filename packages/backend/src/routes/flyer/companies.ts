/**
 * ★ 전단AI 회사 정보 라우트 (SettingsPage 백엔드)
 * 마운트: /api/flyer/companies
 *
 * 내 회사 정보 조회/수정, 080 번호, 단가, 발신번호 등 설정.
 */

import { Request, Response, Router } from 'express';
import { query } from '../../config/database';
import { flyerAuthenticate, requireFlyerAdmin } from '../../middlewares/flyer-auth';

const router = Router();

router.use(flyerAuthenticate);

/**
 * GET / — 내 회사 정보
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser!.companyId;
    const result = await query(
      `SELECT id, company_name, business_type, business_number, owner_name, owner_phone,
              address, store_hours, plan_type, monthly_fee, plan_started_at, plan_expires_at,
              payment_status, opt_out_080_number, opt_out_080_auto_sync,
              pos_type, pos_agent_key, pos_last_sync_at,
              sms_unit_price, lms_unit_price, mms_unit_price
       FROM flyer_companies WHERE id = $1 AND deleted_at IS NULL`,
      [companyId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: '회사를 찾을 수 없습니다' });
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('[flyer/companies] get error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT / — 내 회사 정보 수정 (admin만)
 */
router.put('/', requireFlyerAdmin, async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser!.companyId;
    const {
      company_name, business_type, business_number, owner_name, owner_phone,
      address, store_hours, opt_out_080_number, opt_out_080_auto_sync,
    } = req.body;

    await query(
      `UPDATE flyer_companies SET
         company_name = COALESCE($2, company_name),
         business_type = COALESCE($3, business_type),
         business_number = COALESCE($4, business_number),
         owner_name = COALESCE($5, owner_name),
         owner_phone = COALESCE($6, owner_phone),
         address = COALESCE($7, address),
         store_hours = COALESCE($8, store_hours),
         opt_out_080_number = $9,
         opt_out_080_auto_sync = COALESCE($10, opt_out_080_auto_sync),
         updated_at = NOW()
       WHERE id = $1`,
      [
        companyId, company_name, business_type, business_number, owner_name, owner_phone,
        address, store_hours, opt_out_080_number || null, opt_out_080_auto_sync,
      ]
    );
    return res.json({ message: '회사 정보가 수정되었습니다' });
  } catch (error: any) {
    console.error('[flyer/companies] update error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /callback-numbers — 발신번호 목록 (전단AI 전용)
 */
router.get('/callback-numbers', async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser!.companyId;
    const result = await query(
      `SELECT id, phone, label, is_default, created_at
       FROM flyer_callback_numbers
       WHERE company_id = $1 AND deleted_at IS NULL
       ORDER BY is_default DESC, created_at ASC`,
      [companyId]
    );
    return res.json(result.rows);
  } catch (error: any) {
    console.error('[flyer/companies] callback-numbers error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/callback-numbers', requireFlyerAdmin, async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser!.companyId;
    const { phone, label, is_default } = req.body;
    if (!phone) return res.status(400).json({ error: '번호가 필요합니다' });

    if (is_default) {
      await query(
        `UPDATE flyer_callback_numbers SET is_default = false WHERE company_id = $1`,
        [companyId]
      );
    }
    const result = await query(
      `INSERT INTO flyer_callback_numbers (id, company_id, phone, label, is_default, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
       RETURNING id, phone, label, is_default`,
      [companyId, phone, label || null, !!is_default]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    console.error('[flyer/companies] add callback error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/callback-numbers/:id', requireFlyerAdmin, async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser!.companyId;
    const { id } = req.params;
    await query(
      `UPDATE flyer_callback_numbers SET deleted_at = NOW() WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return res.json({ message: '삭제되었습니다' });
  } catch (error: any) {
    console.error('[flyer/companies] delete callback error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
