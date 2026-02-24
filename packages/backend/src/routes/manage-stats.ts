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
// ★ 2026-02-25 수정: 테스트 통계에 스팸필터 합산 + 비용 계산 추가

// SMS 테이블 설정 (런타임에 읽어야 dotenv 로드 후 적용됨)
function getTestSmsTable(): string {
  const tables = process.env.SMS_TABLES ? process.env.SMS_TABLES.split(',') : ['SMSQ_SEND'];
  return tables.find(t => t.includes('_10')) || tables[0];
}

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
    let startDate = (req.query.startDate as string) || '';
    let endDate = (req.query.endDate as string) || '';

    // 월별 조회 시 날짜를 월 단위로 자동 확장
    if (view === 'monthly') {
      if (startDate) startDate = startDate.substring(0, 7) + '-01';
      if (endDate) {
        const d = new Date(endDate);
        d.setMonth(d.getMonth() + 1, 0);
        endDate = d.toISOString().split('T')[0];
      }
    }

    const companyScope = getCompanyScope(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    let dateWhere = '';
    const baseParams: any[] = [];
    let paramIdx = 1;

    // ★ KST 기준 날짜 필터
    if (startDate) {
      dateWhere += ` AND c.sent_at >= $${paramIdx}::date AT TIME ZONE 'Asia/Seoul'`;
      baseParams.push(startDate);
      paramIdx++;
    }
    if (endDate) {
      dateWhere += ` AND c.sent_at < ($${paramIdx}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Seoul'`;
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

    // 1) 요약 (campaigns 직접 조회 — 직접발송 포함)
    const summaryResult = await pool.query(`
      SELECT 
        COALESCE(SUM(c.sent_count), 0) as total_sent,
        COALESCE(SUM(c.success_count), 0) as total_success,
        COALESCE(SUM(c.fail_count), 0) as total_fail
      FROM campaigns c
      WHERE c.sent_at IS NOT NULL
        AND c.status NOT IN ('cancelled', 'draft')
        ${dateWhere} ${companyWhere} ${userWhere}
    `, baseParams);

    // 2) 테스트 발송 통계 (담당자 MySQL + 스팸필터 PostgreSQL)
    let testSummary = { total: 0, success: 0, fail: 0, pending: 0, sms: 0, lms: 0, cost: 0 };
    if (companyScope) {
      try {
        // 2-1) 담당자 테스트 (MySQL)
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

        const testRows = await mysqlQuery(
          `SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status_code IN (6, 1000, 1800) THEN 1 ELSE 0 END) as success,
            SUM(CASE WHEN status_code NOT IN (6, 1000, 1800, 100) THEN 1 ELSE 0 END) as fail,
            SUM(CASE WHEN status_code = 100 THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN msg_type = 'S' THEN 1 ELSE 0 END) as sms,
            SUM(CASE WHEN msg_type = 'L' THEN 1 ELSE 0 END) as lms
          FROM ${getTestSmsTable()}
          WHERE app_etc1 = 'test' AND app_etc2 = ? ${mysqlDateWhere}`,
          mysqlParams
        );
        if (testRows && (testRows as any[]).length > 0) {
          const t = (testRows as any[])[0];
          testSummary.total += Number(t.total) || 0;
          testSummary.success += Number(t.success) || 0;
          testSummary.fail += Number(t.fail) || 0;
          testSummary.pending += Number(t.pending) || 0;
          testSummary.sms += Number(t.sms) || 0;
          testSummary.lms += Number(t.lms) || 0;
        }

        // 2-2) 스팸필터 테스트 (PostgreSQL)
        let sfDateWhere = '';
        const sfParams: any[] = [companyScope];
        let sfIdx = 2;
        if (startDate) {
          sfDateWhere += ` AND t.created_at >= $${sfIdx}::date AT TIME ZONE 'Asia/Seoul'`;
          sfParams.push(startDate);
          sfIdx++;
        }
        if (endDate) {
          sfDateWhere += ` AND t.created_at < ($${sfIdx}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Seoul'`;
          sfParams.push(endDate);
          sfIdx++;
        }

        const sfAgg = await pool.query(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN r.message_type = 'SMS' THEN 1 ELSE 0 END) as sms,
            SUM(CASE WHEN r.message_type = 'LMS' THEN 1 ELSE 0 END) as lms,
            SUM(CASE WHEN r.result IS NOT NULL THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN r.result IS NULL AND t.status IN ('active','pending') THEN 1 ELSE 0 END) as pending
          FROM spam_filter_test_results r
          JOIN spam_filter_tests t ON r.test_id = t.id
          WHERE t.company_id = $1 ${sfDateWhere}
        `, sfParams);
        const sf = sfAgg.rows[0];
        testSummary.total += Number(sf.total) || 0;
        testSummary.success += Number(sf.completed) || 0;
        testSummary.pending += Number(sf.pending) || 0;
        testSummary.sms += Number(sf.sms) || 0;
        testSummary.lms += Number(sf.lms) || 0;

        // 비용 계산 (회사 단가 기준)
        const costRes = await pool.query('SELECT cost_per_sms, cost_per_lms FROM companies WHERE id = $1', [companyScope]);
        const cSms = Number(costRes.rows[0]?.cost_per_sms) || 9.9;
        const cLms = Number(costRes.rows[0]?.cost_per_lms) || 27;
        testSummary.cost = Math.round(((testSummary.sms - testSummary.pending) * cSms + testSummary.lms * cLms) * 10) / 10;
        // 더 정확하게: 성공 건만 과금 (sms 성공 개수 × 단가)
        // 담당자 성공 sms/lms 분리는 MySQL에서 이미 구분됨
        // 스팸필터는 completed 건 전체 과금 (SMS/LMS 비율로)
        testSummary.cost = Math.round((testSummary.sms * cSms + testSummary.lms * cLms) * 10) / 10;
      } catch (mysqlErr) {
        console.error('테스트 통계 조회 실패:', mysqlErr);
      }
    }

    // 3) 페이징된 일별/월별 (KST 그룹핑)
    const groupCol = view === 'monthly'
      ? `TO_CHAR(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`
      : `TO_CHAR(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;
    const groupAlias = view === 'monthly' ? 'month' : 'date';

    const countResult = await pool.query(`
      SELECT COUNT(*) FROM (
        SELECT ${groupCol} as grp
        FROM campaigns c
        WHERE c.sent_at IS NOT NULL
          AND c.status NOT IN ('cancelled', 'draft')
          ${dateWhere} ${companyWhere} ${userWhere}
        GROUP BY grp
      ) sub
    `, baseParams);
    const total = parseInt(countResult.rows[0].count);

    const rowsResult = await pool.query(`
      SELECT 
        ${groupCol} as "${groupAlias}",
        COUNT(DISTINCT c.id) as runs,
        COALESCE(SUM(c.sent_count), 0) as sent,
        COALESCE(SUM(c.success_count), 0) as success,
        COALESCE(SUM(c.fail_count), 0) as fail
      FROM campaigns c
      WHERE c.sent_at IS NOT NULL
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
      ? `TO_CHAR(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`
      : `TO_CHAR(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;

    // 사용자 필터 (고객사관리자용)
    const filterUserId = req.query.filterUserId as string;
    const userFilter = filterUserId ? ` AND c.created_by = $3` : '';
    const detailParams = filterUserId ? [dateVal, targetCompanyId, filterUserId] : [dateVal, targetCompanyId];

    // 비용 계산용 단가
    const costRes = await pool.query('SELECT cost_per_sms, cost_per_lms FROM companies WHERE id = $1', [targetCompanyId]);
    const cSms = Number(costRes.rows[0]?.cost_per_sms) || 9.9;
    const cLms = Number(costRes.rows[0]?.cost_per_lms) || 27;

    // 사용자별 통계 (campaigns 직접 조회 — 직접발송 포함)
    const result = await pool.query(`
      SELECT 
        u.id as user_id,
        u.name as user_name,
        u.login_id,
        u.department,
        u.store_codes,
        COUNT(DISTINCT c.id) as runs,
        COALESCE(SUM(c.sent_count), 0) as sent,
        COALESCE(SUM(c.success_count), 0) as success,
        COALESCE(SUM(c.fail_count), 0) as fail,
        COALESCE(SUM(CASE WHEN c.message_type IN ('SMS','S') THEN c.success_count ELSE 0 END), 0) as sms_success,
        COALESCE(SUM(CASE WHEN c.message_type IN ('LMS','L','MMS','M') THEN c.success_count ELSE 0 END), 0) as lms_success
      FROM campaigns c
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.sent_at IS NOT NULL
        AND ${groupCol} = $1
        AND c.company_id = $2
        AND c.status NOT IN ('cancelled', 'draft')
        ${userFilter}
      GROUP BY u.id, u.name, u.login_id, u.department, u.store_codes
      ORDER BY sent DESC
    `, detailParams);

    // 사용자별 비용 계산
    const userStats = result.rows.map((u: any) => ({
      ...u,
      cost: Math.round((Number(u.sms_success) * cSms + Number(u.lms_success) * cLms) * 10) / 10,
    }));

    // 캠페인 상세 목록 (campaigns 직접 조회 — 직접발송 포함)
    const campaignsResult = await pool.query(`
      SELECT 
        c.id as campaign_id,
        c.campaign_name,
        c.send_type,
        u.name as user_name,
        u.login_id,
        c.id as run_id,
        1 as run_number,
        c.sent_count,
        c.success_count,
        c.fail_count,
        c.target_count,
        c.message_type,
        c.sent_at
      FROM campaigns c
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.sent_at IS NOT NULL
        AND ${groupCol} = $1
        AND c.company_id = $2
        AND c.status NOT IN ('cancelled', 'draft')
        ${userFilter}
      ORDER BY c.sent_at DESC
    `, detailParams);

    // ===== 테스트 발송 상세 (담당자 MySQL + 스팸필터 PostgreSQL) =====
    let testDetail: any[] = [];
    try {
      // 1) 담당자 테스트 (MySQL)
      let mysqlDateWhere = '';
      const mysqlParams: any[] = [targetCompanyId];
      if (view === 'monthly') {
        mysqlDateWhere = ` AND DATE_FORMAT(msg_instm, '%Y-%m') = ?`;
      } else {
        mysqlDateWhere = ` AND DATE_FORMAT(msg_instm, '%Y-%m-%d') = ?`;
      }
      mysqlParams.push(dateVal);

      const testRows = await mysqlQuery(
        `SELECT 
          dest_no as phone,
          msg_type,
          status_code,
          msg_instm as sent_at,
          bill_id as sender_id
        FROM ${getTestSmsTable()}
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
        testType: 'manager',
      }));

      // 2) 스팸필터 테스트 (PostgreSQL)
      let sfDateCond = '';
      if (view === 'monthly') {
        sfDateCond = `AND TO_CHAR(t.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $2`;
      } else {
        sfDateCond = `AND TO_CHAR(t.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $2`;
      }
      const sfDetail = await pool.query(`
        SELECT r.phone, r.carrier, r.message_type, r.result,
               t.created_at as sent_at
        FROM spam_filter_test_results r
        JOIN spam_filter_tests t ON r.test_id = t.id
        WHERE t.company_id = $1 ${sfDateCond}
        ORDER BY t.created_at DESC LIMIT 50
      `, [targetCompanyId, dateVal]);

      sfDetail.rows.forEach((r: any) => {
        testDetail.push({
          phone: r.phone,
          msgType: r.message_type || 'SMS',
          status: r.result ? 'success' : 'pending',
          result: r.result || 'pending',
          carrier: r.carrier,
          sentAt: r.sent_at,
          testType: 'spam_filter',
        });
      });
    } catch (mysqlErr) {
      console.error('테스트 상세 MySQL 조회 실패:', mysqlErr);
    }

    res.json({
      userStats,
      campaigns: campaignsResult.rows,
      testDetail,
      unitCost: { sms: cSms, lms: cLms },
    });
  } catch (error) {
    console.error('발송 통계 상세 조회 실패:', error);
    res.status(500).json({ error: '발송 통계 상세 조회 실패' });
  }
});

export default router;
