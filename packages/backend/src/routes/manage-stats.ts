import { Router, Request, Response } from 'express';
import { authenticate, requireCompanyAdmin } from '../middlewares/auth';
import pool, { mysqlQuery } from '../config/database';

const router = Router();

// ============================================================
//  발송 통계 API — 공용 (슈퍼관리자 + 고객사관리자)
//  마운트: /api/manage/stats
//  슈퍼관리자: 전체 회사 통계 (회사별 필터 가능)
//  고객사관리자: 자사 통계만
// ============================================================

// SMS 테이블 설정 (로컬: SMSQ_SEND 1개, 서버: 11개)
const ALL_SMS_TABLES = process.env.SMS_TABLES ? process.env.SMS_TABLES.split(',') : ['SMSQ_SEND'];
const TEST_SMS_TABLE = ALL_SMS_TABLES.find(t => t.includes('_10')) || ALL_SMS_TABLES[0];

router.use(authenticate, requireCompanyAdmin);

function getCompanyScope(req: Request): string | null {
  const { userType, companyId } = (req as any).user!;
  if (userType === 'super_admin') return (req.query.companyId as string) || null;
  return companyId!;
}

// GET /send - 발송 통계 (요약 + 페이징된 일별/월별) + 테스트 발송 분리
router.get('/send', async (req: Request, res: Response) => {
  try {
    const view = (req.query.view as string) || 'daily';
    const startDate = (req.query.startDate as string) || '';
    const endDate = (req.query.endDate as string) || '';
    const companyScope = getCompanyScope(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    let dateWhere = '';
    const baseParams: any[] = [];
    let paramIdx = 1;

    // ★ KST 기준 날짜 필터 (UTC가 아닌 한국시간 자정 기준)
    if (startDate) {
      dateWhere += ` AND cr.sent_at >= $${paramIdx}::date AT TIME ZONE 'Asia/Seoul'`;
      baseParams.push(startDate);
      paramIdx++;
    }
    if (endDate) {
      dateWhere += ` AND cr.sent_at < ($${paramIdx}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Seoul'`;
      baseParams.push(endDate);
      paramIdx++;
    }
    let companyWhere = '';
    if (companyScope) {
      companyWhere = ` AND c.company_id = $${paramIdx}`;
      baseParams.push(companyScope);
      paramIdx++;
    }

    // 사용자 필터 (고객사관리자용)
    let userWhere = '';
    const filterUserId = req.query.filterUserId as string;
    if (filterUserId) {
      userWhere = ` AND c.created_by = $${paramIdx}`;
      baseParams.push(filterUserId);
      paramIdx++;
    }

    // 1) 요약 (실발송만 — campaign_runs 기반, 취소/draft 제외)
    const summaryResult = await pool.query(`
      SELECT 
        COALESCE(SUM(cr.sent_count), 0) as total_sent,
        COALESCE(SUM(cr.success_count), 0) as total_success,
        COALESCE(SUM(cr.fail_count), 0) as total_fail
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      WHERE cr.sent_at IS NOT NULL
        AND c.status NOT IN ('cancelled', 'draft')
        ${dateWhere} ${companyWhere} ${userWhere}
    `, baseParams);

    // 2) 테스트 발송 통계 (MySQL — 동적 테이블)
    let testSummary = { total: 0, success: 0, fail: 0, pending: 0, sms: 0, lms: 0 };
    if (companyScope) {
      try {
        let mysqlDateWhere = '';
        const mysqlParams: any[] = [companyScope];
        if (startDate) {
          mysqlDateWhere += ` AND msg_instm >= ?`;
          mysqlParams.push(startDate);
        }
        if (endDate) {
          mysqlDateWhere += ` AND msg_instm < DATE_ADD(?, INTERVAL 1 DAY)`;
          mysqlParams.push(endDate);
        }

        // ★ 동적 테이블 (로컬: SMSQ_SEND, 서버: SMSQ_SEND_10)
        const testRows = await mysqlQuery(
          `SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status_code IN (6, 1000, 1800) THEN 1 ELSE 0 END) as success,
            SUM(CASE WHEN status_code NOT IN (6, 1000, 1800, 100) THEN 1 ELSE 0 END) as fail,
            SUM(CASE WHEN status_code = 100 THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN msg_type = 'S' THEN 1 ELSE 0 END) as sms,
            SUM(CASE WHEN msg_type = 'L' THEN 1 ELSE 0 END) as lms
          FROM ${TEST_SMS_TABLE}
          WHERE app_etc1 = 'test' AND app_etc2 = ? ${mysqlDateWhere}`,
          mysqlParams
        );
        if (testRows && (testRows as any[]).length > 0) {
          const t = (testRows as any[])[0];
          testSummary = {
            total: Number(t.total) || 0,
            success: Number(t.success) || 0,
            fail: Number(t.fail) || 0,
            pending: Number(t.pending) || 0,
            sms: Number(t.sms) || 0,
            lms: Number(t.lms) || 0,
          };
        }
      } catch (mysqlErr) {
        console.error('테스트 통계 MySQL 조회 실패:', mysqlErr);
      }
    }

    // 3) 페이징된 일별/월별 (KST 그룹핑, 취소/draft 제외)
    const groupCol = view === 'monthly'
      ? `TO_CHAR(cr.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`
      : `TO_CHAR(cr.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;
    const groupAlias = view === 'monthly' ? 'month' : 'date';

    const countResult = await pool.query(`
      SELECT COUNT(*) FROM (
        SELECT ${groupCol} as grp
        FROM campaign_runs cr
        JOIN campaigns c ON cr.campaign_id = c.id
        WHERE cr.sent_at IS NOT NULL
          AND c.status NOT IN ('cancelled', 'draft')
          ${dateWhere} ${companyWhere} ${userWhere}
        GROUP BY grp
      ) sub
    `, baseParams);
    const total = parseInt(countResult.rows[0].count);

    const rowsResult = await pool.query(`
      SELECT 
        ${groupCol} as "${groupAlias}",
        COUNT(DISTINCT cr.id) as runs,
        COALESCE(SUM(cr.sent_count), 0) as sent,
        COALESCE(SUM(cr.success_count), 0) as success,
        COALESCE(SUM(cr.fail_count), 0) as fail
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      WHERE cr.sent_at IS NOT NULL
        AND c.status NOT IN ('cancelled', 'draft')
        ${dateWhere} ${companyWhere} ${userWhere}
      GROUP BY ${groupCol}
      ORDER BY "${groupAlias}" DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...baseParams, limit, offset]);

    res.json({
      summary: summaryResult.rows[0],
      testSummary,
      rows: rowsResult.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('발송 통계 조회 실패:', error);
    res.status(500).json({ error: '발송 통계 조회 실패' });
  }
});

// GET /send/detail - 발송 통계 상세 (사용자별 분해)
router.get('/send/detail', async (req: Request, res: Response) => {
  try {
    const view = (req.query.view as string) || 'daily';
    const dateVal = (req.query.date as string) || '';
    const companyScope = getCompanyScope(req);
    const targetCompanyId = (req.query.companyId as string) || companyScope;

    if (!dateVal || !targetCompanyId) {
      return res.status(400).json({ error: '날짜와 고객사 ID가 필요합니다.' });
    }

    // 고객사관리자: 자사만
    if ((req as any).user!.userType === 'company_admin' && targetCompanyId !== (req as any).user!.companyId) {
      return res.status(403).json({ error: '자사 통계만 조회할 수 있습니다.' });
    }

    const groupCol = view === 'monthly'
      ? `TO_CHAR(cr.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`
      : `TO_CHAR(cr.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;

    // 사용자 필터 (고객사관리자용)
    const filterUserId = req.query.filterUserId as string;
    const userFilter = filterUserId ? ` AND c.created_by = $3` : '';
    const detailParams = filterUserId ? [dateVal, targetCompanyId, filterUserId] : [dateVal, targetCompanyId];

    // 사용자별 통계 (취소/draft 제외)
    const result = await pool.query(`
      SELECT 
        u.id as user_id,
        u.name as user_name,
        u.login_id,
        u.department,
        u.store_codes,
        COUNT(DISTINCT cr.id) as runs,
        COALESCE(SUM(cr.sent_count), 0) as sent,
        COALESCE(SUM(cr.success_count), 0) as success,
        COALESCE(SUM(cr.fail_count), 0) as fail
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      LEFT JOIN users u ON c.created_by = u.id
      WHERE cr.sent_at IS NOT NULL
        AND ${groupCol} = $1
        AND c.company_id = $2
        AND c.status NOT IN ('cancelled', 'draft')
        ${userFilter}
      GROUP BY u.id, u.name, u.login_id, u.department, u.store_codes
      ORDER BY sent DESC
    `, detailParams);

    // 캠페인 상세 목록 (취소/draft 제외)
    const campaignsResult = await pool.query(`
      SELECT 
        c.id as campaign_id,
        c.campaign_name,
        c.send_type,
        u.name as user_name,
        u.login_id,
        cr.id as run_id,
        cr.run_number,
        cr.sent_count,
        cr.success_count,
        cr.fail_count,
        cr.target_count,
        cr.message_type,
        cr.sent_at
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      LEFT JOIN users u ON c.created_by = u.id
      WHERE cr.sent_at IS NOT NULL
        AND ${groupCol} = $1
        AND c.company_id = $2
        AND c.status NOT IN ('cancelled', 'draft')
        ${userFilter}
      ORDER BY cr.sent_at DESC
    `, detailParams);

    // 테스트 발송 상세 (MySQL — 동적 테이블)
    let testDetail: any[] = [];
    try {
      let mysqlDateWhere = '';
      const mysqlParams: any[] = [targetCompanyId];
      if (view === 'monthly') {
        mysqlDateWhere = ` AND DATE_FORMAT(msg_instm, '%Y-%m') = ?`;
      } else {
        mysqlDateWhere = ` AND DATE_FORMAT(msg_instm, '%Y-%m-%d') = ?`;
      }
      mysqlParams.push(dateVal);

      // ★ 동적 테이블
      const testRows = await mysqlQuery(
        `SELECT 
          dest_no as phone,
          msg_type,
          status_code,
          msg_instm as sent_at,
          bill_id as sender_id
        FROM ${TEST_SMS_TABLE}
        WHERE app_etc1 = 'test' AND app_etc2 = ? ${mysqlDateWhere}
        ORDER BY msg_instm DESC
        LIMIT 50`,
        mysqlParams
      );
      testDetail = (testRows as any[]).map(r => ({
        phone: r.phone,
        msgType: r.msg_type === 'S' ? 'SMS' : 'LMS',
        status: [6, 1000, 1800].includes(r.status_code) ? 'success' : r.status_code === 100 ? 'pending' : 'fail',
        sentAt: r.sent_at,
      }));
    } catch (mysqlErr) {
      console.error('테스트 상세 MySQL 조회 실패:', mysqlErr);
    }

    res.json({
      userStats: result.rows,
      campaigns: campaignsResult.rows,
      testDetail,
    });
  } catch (error) {
    console.error('발송 통계 상세 조회 실패:', error);
    res.status(500).json({ error: '발송 통계 상세 조회 실패' });
  }
});

export default router;
