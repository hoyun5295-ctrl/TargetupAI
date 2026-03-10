import { Router, Request, Response } from 'express';
import { authenticate, requireCompanyAdmin } from '../middlewares/auth';
import { query } from '../config/database';
// ★ 메시징 컨트롤타워 — 취소 로직 통합
import { cancelCampaign } from '../utils/campaign-lifecycle';
import { getCompanyScope } from '../utils/permission-helper';

const router = Router();

// ============================================================
//  예약 캠페인 관리 API — 공용 (슈퍼관리자 + 고객사관리자)
//  마운트: /api/manage/scheduled
//  슈퍼관리자: 전체 회사 예약 캠페인 관리
//  고객사관리자: 자사 예약 캠페인만 관리
// ============================================================

router.use(authenticate, requireCompanyAdmin);

// ★ CT-02: getCompanyScope → permission-helper.ts 컨트롤타워로 통합

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

    // 사용자 필터 (고객사관리자용)
    const filterUserId = req.query.filter_user_id as string;
    if (filterUserId) {
      params.push(filterUserId);
      sql += ` AND c.created_by = $${params.length}`;
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
// ★ 컨트롤타워(cancelCampaign) 사용 — MySQL 큐 삭제 + 선불 환불 + PG 상태 변경 모두 처리
router.post('/:id/cancel', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const { userId, userType: callerType, companyId: callerCompanyId } = req.user!;

  if (!reason || reason.trim() === '') {
    return res.status(400).json({ error: '취소 사유를 입력해주세요.' });
  }

  try {
    // 캠페인 조회 (소유권 확인용)
    const check = await query('SELECT status, scheduled_at, company_id FROM campaigns WHERE id = $1', [id]);

    if (check.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }

    // 고객사관리자: 자사 캠페인만 취소 가능
    if (callerType === 'company_admin' && check.rows[0].company_id !== callerCompanyId) {
      return res.status(403).json({ error: '자사 캠페인만 취소할 수 있습니다.' });
    }

    const companyId = check.rows[0].company_id;
    const cancelledByType = callerType === 'super_admin' ? 'super_admin' : 'company_admin';

    // ★ 컨트롤타워 호출 — MySQL 큐 삭제 + 선불 환불 + PG 상태 변경 전부 처리
    const result = await cancelCampaign(id, companyId, {
      reason: reason.trim(),
      cancelledBy: userId,
      cancelledByType,
      skipTimeCheck: callerType === 'super_admin', // 슈퍼관리자는 15분 제한 없음
    });

    if (!result.success) {
      const status = result.error === '캠페인을 찾을 수 없습니다' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }

    res.json({
      message: '예약이 취소되었습니다.',
      campaign: { id }
    });
  } catch (error) {
    console.error('예약 취소 실패:', error);
    res.status(500).json({ error: '예약 취소 실패' });
  }
});

export default router;
