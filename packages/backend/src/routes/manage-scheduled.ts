import { Router, Request, Response } from 'express';
import { authenticate, requireCompanyAdmin } from '../middlewares/auth';
import { query } from '../config/database';

const router = Router();

// ============================================================
//  예약 캠페인 관리 API — 공용 (슈퍼관리자 + 고객사관리자)
//  마운트: /api/manage/scheduled
//  슈퍼관리자: 전체 회사 예약 캠페인 관리
//  고객사관리자: 자사 예약 캠페인만 관리
// ============================================================

router.use(authenticate, requireCompanyAdmin);

function getCompanyScope(req: Request): string | null {
  const { userType, companyId } = req.user!;
  if (userType === 'super_admin') return (req.query.companyId as string) || null;
  return companyId!;
}

// GET / - 예약된 캠페인 목록 조회
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyScope = getCompanyScope(req);

    let sql = `
      SELECT 
        c.id, c.campaign_name, c.status, c.scheduled_at, c.target_count,
        c.created_at, c.cancelled_by, c.cancelled_by_type, c.cancel_reason, c.cancelled_at,
        co.company_name, co.company_code,
        u.name as created_by_name
      FROM campaigns c
      LEFT JOIN companies co ON c.company_id = co.id
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.status IN ('scheduled', 'cancelled')
    `;
    const params: any[] = [];

    if (companyScope) {
      params.push(companyScope);
      sql += ` AND c.company_id = $${params.length}`;
    }

    sql += ' ORDER BY c.created_at DESC';

    const result = await query(sql, params);
    res.json({ campaigns: result.rows });
  } catch (error) {
    console.error('예약 캠페인 조회 실패:', error);
    res.status(500).json({ error: '예약 캠페인 조회 실패' });
  }
});

// POST /:id/cancel - 예약 취소
router.post('/:id/cancel', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const { userId, userType: callerType, companyId: callerCompanyId } = req.user!;

  if (!reason || reason.trim() === '') {
    return res.status(400).json({ error: '취소 사유를 입력해주세요.' });
  }

  try {
    // 캠페인 조회
    const check = await query('SELECT status, scheduled_at, company_id FROM campaigns WHERE id = $1', [id]);

    if (check.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }

    // 고객사관리자: 자사 캠페인만 취소 가능
    if (callerType === 'company_admin' && check.rows[0].company_id !== callerCompanyId) {
      return res.status(403).json({ error: '자사 캠페인만 취소할 수 있습니다.' });
    }

    if (check.rows[0].status !== 'scheduled') {
      return res.status(400).json({ error: '예약 상태인 캠페인만 취소할 수 있습니다.' });
    }

    // cancelled_by_type: 슈퍼관리자 or 고객사관리자 구분
    const cancelledByType = callerType === 'super_admin' ? 'super_admin' : 'company_admin';

    const result = await query(`
      UPDATE campaigns 
      SET status = 'cancelled',
          cancelled_by = $1,
          cancelled_by_type = $2,
          cancel_reason = $3,
          cancelled_at = NOW(),
          updated_at = NOW()
      WHERE id = $4
      RETURNING id, campaign_name
    `, [userId, cancelledByType, reason.trim(), id]);

    res.json({
      message: '예약이 취소되었습니다.',
      campaign: result.rows[0]
    });
  } catch (error) {
    console.error('예약 취소 실패:', error);
    res.status(500).json({ error: '예약 취소 실패' });
  }
});

export default router;
