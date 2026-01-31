import { Router, Request, Response } from 'express';
import { query, mysqlQuery } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

router.use(authenticate);

// GET /api/v1/results/summary - 요약 + 비용
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { from, to } = req.query;
    const yearMonth = String(from || new Date().toISOString().slice(0, 7).replace('-', ''));

    // PostgreSQL에서 캠페인 집계 조회
    const campaignStats = await query(
      `SELECT 
        COUNT(*) as total_campaigns,
        SUM(target_count) as total_target,
        SUM(sent_count) as total_sent,
        SUM(success_count) as total_success,
        SUM(fail_count) as total_fail
       FROM campaigns 
       WHERE company_id = $1 
       AND created_at >= $2::date 
       AND created_at < ($2::date + interval '1 month')`,
      [companyId, `${yearMonth.slice(0,4)}-${yearMonth.slice(4,6)}-01`]
    );

    // 비용 계산
    const costResult = await query(
      `SELECT 
        cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao
       FROM companies WHERE id = $1`,
      [companyId]
    );
    const costs = costResult.rows[0] || {};

    const stats = campaignStats.rows[0];
    const successRate = stats.total_sent > 0 
      ? ((stats.total_success / stats.total_sent) * 100).toFixed(1) 
      : '0';

    return res.json({
      period: yearMonth,
      summary: {
        totalCampaigns: parseInt(stats.total_campaigns) || 0,
        totalSent: parseInt(stats.total_sent) || 0,
        totalSuccess: parseInt(stats.total_success) || 0,
        totalFail: parseInt(stats.total_fail) || 0,
        successRate: parseFloat(successRate),
      },
      costs: {
        perSms: parseFloat(costs.cost_per_sms) || 9.9,
        perLms: parseFloat(costs.cost_per_lms) || 27,
        perMms: parseFloat(costs.cost_per_mms) || 50,
        perKakao: parseFloat(costs.cost_per_kakao) || 7.5,
      },
    });
  } catch (error) {
    console.error('결과 요약 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/v1/results/campaigns - 캠페인 목록 (채널통합조회)
router.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { from, to, channel, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    let paramIndex = 2;

    // 기간 필터
    if (from) {
      whereClause += ` AND created_at >= $${paramIndex++}::date`;
      params.push(`${String(from).slice(0,4)}-${String(from).slice(4,6)}-01`);
    }
    if (to) {
      whereClause += ` AND created_at < ($${paramIndex++}::date + interval '1 month')`;
      params.push(`${String(to).slice(0,4)}-${String(to).slice(4,6)}-01`);
    }

    // 채널 필터
    if (channel && channel !== 'all') {
      whereClause += ` AND message_type = $${paramIndex++}`;
      params.push(channel);
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM campaigns ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(Number(limit), offset);
    const result = await query(
      `SELECT 
        id, campaign_name, message_type, message_content,
        target_count, sent_count, success_count, fail_count,
        is_ad, scheduled_at, sent_at, created_at,
        CASE WHEN sent_count > 0 
          THEN ROUND((success_count::numeric / sent_count) * 100, 1)
          ELSE 0 
        END as success_rate
       FROM campaigns
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    return res.json({
      campaigns: result.rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('캠페인 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/v1/results/campaigns/:id - 캠페인 상세 (차트 데이터 포함)
router.get('/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const { id } = req.params;

    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    // 캠페인 기본 정보
    const campaignResult = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }

    const campaign = campaignResult.rows[0];

    // campaign_runs 조회
    const runsResult = await query(
      `SELECT * FROM campaign_runs WHERE campaign_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    // campaign_run_id 목록
    const runIds = runsResult.rows.map(r => r.id);

    // MySQL에서 실패사유별 집계 조회
    let errorStats: Record<string, number> = {};
    let carrierStats: Record<string, number> = {};
    
    if (runIds.length > 0) {
      // 실패사유별 집계
      const errorResult = await mysqlQuery(
        `SELECT status_code, COUNT(*) as cnt FROM SMSQ_SEND 
         WHERE app_etc1 IN (${runIds.map(() => '?').join(',')})
         GROUP BY status_code`,
        runIds
      ) as any[];

      // status_code 매핑
      const statusCodeMap: Record<number, string> = {
        6: 'SMS 성공',
        1000: 'LMS 성공',
        1800: '카카오 성공',
        100: '발송 대기',
        55: '요금 부족',
        2008: '비가입자/결번',
        23: '식별코드 오류',
        2323: '식별코드 오류',
        3000: '메시지 형식 오류',
        3001: '발신번호 오류',
        3002: '수신번호 오류',
        3003: '메시지 길이 초과',
        3004: '스팸 차단',
        4000: '전송 시간 초과',
        9999: '기타 오류',
      };

      errorResult.forEach((row: any) => {
        const code = row.status_code;
        const label = statusCodeMap[code] || `오류 코드 ${code}`;
        // 성공 코드는 제외
        if (![6, 1000, 1800, 100].includes(code)) {
          errorStats[label] = (errorStats[label] || 0) + parseInt(row.cnt);
        }
      });

      // 통신사별 집계
      const carrierResult = await mysqlQuery(
        `SELECT mob_company, COUNT(*) as cnt FROM SMSQ_SEND 
         WHERE app_etc1 IN (${runIds.map(() => '?').join(',')})
         AND status_code IN (6, 1000, 1800)
         GROUP BY mob_company`,
        runIds
      ) as any[];

      const carrierMap: Record<string, string> = {
        'SKT': 'SKT',
        'KTF': 'KT',
        'LGT': 'LG U+',
        'SKM': 'SKT 알뜰폰',
        'KTM': 'KT 알뜰폰',
        'LGM': 'LG 알뜰폰',
      };

      carrierResult.forEach((row: any) => {
        const carrier = row.mob_company;
        const label = carrierMap[carrier] || carrier || '알 수 없음';
        carrierStats[label] = (carrierStats[label] || 0) + parseInt(row.cnt);
      });
    }

    return res.json({
      campaign,
      runs: runsResult.rows,
      summary: null,
      charts: {
        successFail: {
          success: campaign.success_count || 0,
          fail: campaign.fail_count || 0,
        },
        carriers: carrierStats,
        errors: errorStats,
      },
    });
  } catch (error) {
    console.error('캠페인 상세 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/v1/results/campaigns/:id/messages - 개별 발송 건 목록
router.get('/campaigns/:id/messages', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const { id } = req.params;
    const { searchType, searchValue, status, page = 1, limit = 100 } = req.query;

    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    // 캠페인 run_id로 MySQL에서 조회
    const runsResult = await query(
      `SELECT id FROM campaign_runs WHERE campaign_id = $1`,
      [id]
    );
    
    if (runsResult.rows.length === 0) {
      return res.json({ messages: [], pagination: { total: 0 } });
    }

    const runIds = runsResult.rows.map(r => r.id);
    const offset = (Number(page) - 1) * Number(limit);

    // MySQL에서 SMSQ_SEND 조회 (app_etc1 = campaign_run_id)
    let whereClause = `WHERE app_etc1 IN (${runIds.map(() => '?').join(',')})`;
    const params: any[] = [...runIds];

    // 검색 필터
    if (searchType && searchValue) {
      switch (searchType) {
        case 'phone':
          whereClause += ` AND dest_no LIKE ?`;
          params.push(`%${searchValue}%`);
          break;
        case 'content':
          whereClause += ` AND msg_contents LIKE ?`;
          params.push(`%${searchValue}%`);
          break;
      }
    }

    // 상태 필터
    if (status === 'success') {
      whereClause += ` AND status_code IN (6, 1000, 1800)`;
    } else if (status === 'fail') {
      whereClause += ` AND status_code NOT IN (6, 1000, 1800, 100)`;
    }

    const messages = await mysqlQuery(
      `SELECT 
        seqno, dest_no, msg_type, status_code, mob_company,
        sendreq_time, mobsend_time, repmsg_recvtm
       FROM SMSQ_SEND 
       ${whereClause}
       ORDER BY seqno DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    return res.json({
      messages,
      pagination: {
        page: Number(page),
        limit: Number(limit),
      },
    });
  } catch (error) {
    console.error('메시지 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;