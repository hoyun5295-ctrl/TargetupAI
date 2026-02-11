import { Router, Request, Response } from 'express';
import { query, mysqlQuery } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

// SMS 멀티테이블 설정 (campaigns.ts와 동일)
const SMS_TABLES = (process.env.SMS_TABLES || 'SMSQ_SEND').split(',').map(t => t.trim());

async function smsQueryAll(sql: string, params: any[]): Promise<any[]> {
  let all: any[] = [];
  for (const t of SMS_TABLES) {
    const rows = await mysqlQuery(sql.replace(/SMSQ_SEND/g, t), params) as any[];
    all = all.concat(rows);
  }
  return all;
}

async function smsCountAllWhere(whereClause: string, params: any[]): Promise<number> {
  let total = 0;
  for (const t of SMS_TABLES) {
    const rows = await mysqlQuery(`SELECT COUNT(*) as cnt FROM ${t} ${whereClause}`, params) as any[];
    total += parseInt(rows[0]?.cnt || '0');
  }
  return total;
}

async function smsSelectAllWhere(selectFields: string, whereClause: string, params: any[], suffix?: string): Promise<any[]> {
  let all: any[] = [];
  for (const t of SMS_TABLES) {
    const rows = await mysqlQuery(`SELECT ${selectFields} FROM ${t} ${whereClause} ${suffix || ''}`, params) as any[];
    all = all.concat(rows);
  }
  return all;
}

async function smsAggAllWhere(selectFields: string, whereClause: string, params: any[]): Promise<any> {
  const results: any[] = [];
  for (const t of SMS_TABLES) {
    const rows = await mysqlQuery(`SELECT ${selectFields} FROM ${t} ${whereClause}`, params) as any[];
    results.push(rows[0]);
  }
  // 숫자 필드 합산
  const merged: any = {};
  for (const row of results) {
    if (!row) continue;
    for (const key of Object.keys(row)) {
      merged[key] = (merged[key] || 0) + (parseInt(row[key]) || 0);
    }
  }
  return merged;
}

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

    const userId = req.user?.userId;
    const userType = req.user?.userType;
    
    // PostgreSQL에서 캠페인 집계 조회
    let summaryQuery = `SELECT 
        COUNT(*) as total_campaigns,
        SUM(target_count) as total_target,
        SUM(sent_count) as total_sent,
        SUM(success_count) as total_success,
        SUM(fail_count) as total_fail
       FROM campaigns 
       WHERE company_id = $1 
       AND created_at >= $2::date 
       AND created_at < ($2::date + interval '1 month')`;
    
    const summaryParams: any[] = [companyId, `${yearMonth.slice(0,4)}-${yearMonth.slice(4,6)}-01`];
    
    // 일반 사용자는 본인 캠페인만
    if (userType === 'company_user') {
      summaryQuery += ` AND created_by = $3`;
      summaryParams.push(userId);
    }

    // 고객사 관리자: 특정 사용자 필터
    if (userType === 'company_admin' && req.query.filter_user_id) {
      summaryQuery += ` AND created_by = $3`;
      summaryParams.push(req.query.filter_user_id);
    }
    
    const campaignStats = await query(summaryQuery, summaryParams);

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

    const userId = req.user?.userId;
    const userType = req.user?.userType;
    
    let whereClause = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    let paramIndex = 2;
    
    // 일반 사용자는 본인이 만든 캠페인만 조회
    if (userType === 'company_user') {
      whereClause += ` AND created_by = $${paramIndex++}`;
      params.push(userId);
    }

    // 고객사 관리자: 특정 사용자 필터
    if (userType === 'company_admin' && req.query.filter_user_id) {
      whereClause += ` AND created_by = $${paramIndex++}`;
      params.push(req.query.filter_user_id);
    }

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
    // whereClause에 테이블 별칭 적용
    const aliasedWhere = whereClause
      .replace(/company_id/g, 'c.company_id')
      .replace(/created_by/g, 'c.created_by')
      .replace(/created_at/g, 'c.created_at')
      .replace(/message_type/g, 'c.message_type');

    const result = await query(
      `SELECT 
        c.id, c.campaign_name, c.message_type, c.message_content, c.send_type, c.status,
        c.target_count, c.sent_count, c.success_count, c.fail_count,
        c.is_ad, c.scheduled_at, c.sent_at, c.created_at,
        c.cancelled_by_type, c.cancel_reason,
        u.login_id as created_by_name,
        CASE WHEN c.sent_count > 0 
          THEN ROUND((c.success_count::numeric / c.sent_count) * 100, 1)
          ELSE 0 
        END as success_rate
       FROM campaigns c
       LEFT JOIN users u ON c.created_by = u.id
       ${aliasedWhere}
       ORDER BY c.created_at DESC
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

    // 직접발송은 campaign_runs가 없으므로 campaign.id 사용
    const queryIds = [id];

    // MySQL에서 실패사유별 집계 조회
    let errorStats: Record<string, number> = {};
    let carrierStats: Record<string, number> = {};
    
    if (queryIds.length > 0) {
      // 실패사유별 집계 (멀티테이블 합산)
      const errorResult = await smsSelectAllWhere(
        'status_code, COUNT(*) as cnt',
        `WHERE app_etc1 IN (${queryIds.map(() => '?').join(',')})`,
        queryIds,
        'GROUP BY status_code'
      );
      // 같은 status_code 합산
      const errorAgg: Record<number, number> = {};
      errorResult.forEach((row: any) => {
        errorAgg[row.status_code] = (errorAgg[row.status_code] || 0) + parseInt(row.cnt);
      });

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

      Object.entries(errorAgg).forEach(([codeStr, cnt]) => {
        const code = parseInt(codeStr);
        const label = statusCodeMap[code] || `오류 코드 ${code}`;
        if (![6, 1000, 1800, 100].includes(code)) {
          errorStats[label] = (errorStats[label] || 0) + cnt;
        }
      });

      // 통신사별 집계 (멀티테이블 합산)
      const carrierResult = await smsSelectAllWhere(
        'mob_company, COUNT(*) as cnt',
        `WHERE app_etc1 IN (${queryIds.map(() => '?').join(',')}) AND status_code IN (6, 1000, 1800)`,
        queryIds,
        'GROUP BY mob_company'
      );
      // 같은 통신사 합산
      const carrierAgg: Record<string, number> = {};
      carrierResult.forEach((row: any) => {
        const key = row.mob_company || '';
        carrierAgg[key] = (carrierAgg[key] || 0) + parseInt(row.cnt);
      });

      const carrierMap: Record<string, string> = {
        '11': 'SKT',
        '16': 'KT', 
        '19': 'LG U+',
        '12': 'SKT 알뜰폰',
        '17': 'KT 알뜰폰',
        '20': 'LG 알뜰폰',
        'SKT': 'SKT',
        'KTF': 'KT',
        'LGT': 'LG U+',
      };

      Object.entries(carrierAgg).forEach(([carrier, cnt]) => {
        const label = carrierMap[carrier] || carrier || '알 수 없음';
        carrierStats[label] = (carrierStats[label] || 0) + cnt;
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

    const runIds = [id];
    const offset = (Number(page) - 1) * Number(limit);

    // MySQL에서 SMSQ_SEND 조회 (app_etc1 = campaign_id)
    let whereClause = `WHERE app_etc1 IN (${runIds.map(() => '?').join(',')})`;
    const params: any[] = [...runIds];

    // 검색 필터
    if (searchType && searchValue) {
      switch (searchType) {
        case 'phone':
          whereClause += ` AND dest_no LIKE ?`;
          params.push(`%${searchValue}%`);
          break;
        case 'callback':
          whereClause += ` AND call_back LIKE ?`;
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

    // 총 건수 조회 (멀티테이블 합산)
    const total = await smsCountAllWhere(whereClause, params);

    // 전체 테이블에서 조회 후 정렬/페이지네이션 (메모리)
    const allMessages = await smsSelectAllWhere(
      'seqno, dest_no, call_back, msg_type, msg_contents, status_code, mob_company, sendreq_time, mobsend_time, repmsg_recvtm',
      whereClause,
      params
    );
    allMessages.sort((a: any, b: any) => b.seqno - a.seqno);
    const messages = allMessages.slice(offset, offset + Number(limit));

    return res.json({
      messages,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
      },
    });
  } catch (error) {
    console.error('메시지 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});
// GET /api/v1/results/campaigns/:id/export - 발송내역 CSV 다운로드
router.get('/campaigns/:id/export', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const { id } = req.params;
    if (!companyId) return res.status(403).json({ error: '권한이 필요합니다.' });

    const campaignResult = await query(
      `SELECT campaign_name FROM campaigns WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    if (campaignResult.rows.length === 0) return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });

    const messages = await smsSelectAllWhere(
      'seqno, dest_no, call_back, msg_type, msg_contents, status_code, mob_company, sendreq_time, mobsend_time, repmsg_recvtm',
      'WHERE app_etc1 = ?',
      [id]
    );
    messages.sort((a: any, b: any) => a.seqno - b.seqno);

    const statusMap: Record<number, string> = {
      6:'SMS성공', 1000:'LMS성공', 1800:'카카오성공', 100:'대기',
      55:'요금부족', 2008:'비가입자/결번', 23:'식별코드오류', 2323:'식별코드오류',
      3000:'형식오류', 3001:'발신번호오류', 3002:'수신번호오류', 3003:'길이초과', 3004:'스팸차단', 4000:'시간초과', 9999:'기타오류'
    };
    const carrierMap: Record<string, string> = {
      '11':'SKT', '16':'KT', '19':'LG U+', '12':'SKT알뜰폰', '17':'KT알뜰폰', '20':'LG알뜰폰', 'SKT':'SKT', 'KTF':'KT', 'LGT':'LG U+'
    };

    const BOM = '\uFEFF';
    const headers = '수신번호,회신번호,메시지유형,메시지내용,전송결과,결과코드,통신사,전송요청시간,발송시간,수신확인시간';
    const rows = messages.map((m: any) => [
      m.dest_no, m.call_back,
      m.msg_type === 'S' ? 'SMS' : m.msg_type === 'L' ? 'LMS' : m.msg_type,
      `"${(m.msg_contents || '').replace(/"/g, '""')}"`,
      statusMap[m.status_code] || `코드${m.status_code}`, m.status_code,
      carrierMap[m.mob_company] || m.mob_company || '',
      m.sendreq_time || '', m.mobsend_time || '', m.repmsg_recvtm || ''
    ].join(','));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=send_detail_${id}.csv`);
    res.send(BOM + headers + '\n' + rows.join('\n'));
  } catch (error) {
    console.error('내보내기 에러:', error);
    res.status(500).json({ error: '내보내기 실패' });
  }
});

export default router;