import { Router, Request, Response } from 'express';
import { query, mysqlQuery } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { getCompanySmsTables, ALL_SMS_TABLES } from './campaigns';

const router = Router();

async function smsQueryAll(tables: string[], sql: string, params: any[]): Promise<any[]> {
  let all: any[] = [];
  for (const t of tables) {
    const rows = await mysqlQuery(sql.replace(/SMSQ_SEND/g, t), params) as any[];
    all = all.concat(rows);
  }
  return all;
}

async function smsCountAllWhere(tables: string[], whereClause: string, params: any[]): Promise<number> {
  let total = 0;
  for (const t of tables) {
    const rows = await mysqlQuery(`SELECT COUNT(*) as cnt FROM ${t} ${whereClause}`, params) as any[];
    total += parseInt(rows[0]?.cnt || '0');
  }
  return total;
}

async function smsSelectAllWhere(tables: string[], selectFields: string, whereClause: string, params: any[], suffix?: string): Promise<any[]> {
  let all: any[] = [];
  for (const t of tables) {
    const rows = await mysqlQuery(`SELECT ${selectFields} FROM ${t} ${whereClause} ${suffix || ''}`, params) as any[];
    all = all.concat(rows);
  }
  return all;
}

async function smsAggAllWhere(tables: string[], selectFields: string, whereClause: string, params: any[]): Promise<any> {
  const results: any[] = [];
  for (const t of tables) {
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

// ===== 카카오 브랜드메시지 결과 조회 헬퍼 =====

async function kakaoCountWhere(whereClause: string, params: any[]): Promise<number> {
  const rows = await mysqlQuery(`SELECT COUNT(*) as cnt FROM IMC_BM_FREE_BIZ_MSG ${whereClause}`, params) as any[];
  return parseInt(rows[0]?.cnt || '0');
}

async function kakaoSelectWhere(selectFields: string, whereClause: string, params: any[], suffix?: string): Promise<any[]> {
  const rows = await mysqlQuery(`SELECT ${selectFields} FROM IMC_BM_FREE_BIZ_MSG ${whereClause} ${suffix || ''}`, params) as any[];
  return rows;
}

async function kakaoAggWhere(selectFields: string, whereClause: string, params: any[]): Promise<any> {
  const rows = await mysqlQuery(`SELECT ${selectFields} FROM IMC_BM_FREE_BIZ_MSG ${whereClause}`, params) as any[];
  return rows[0] || {};
}

router.use(authenticate);

// GET /api/v1/results/summary - 요약 + 비용
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { from, to, fromDate, toDate } = req.query;
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
       WHERE company_id = $1`;
    
    const summaryParams: any[] = [companyId];

    // 취소/초안 캠페인 제외
    summaryQuery += ` AND status NOT IN ('cancelled', 'draft')`;

    // 일자 범위 필터 (fromDate/toDate 우선, 없으면 월 단위) — KST 기준
    if (fromDate && toDate) {
      summaryQuery += ` AND created_at >= $2::date::timestamp AT TIME ZONE 'Asia/Seoul' AND created_at < ($3::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Seoul'`;
      summaryParams.push(String(fromDate), String(toDate));
    } else {
      summaryQuery += ` AND created_at >= $2::date::timestamp AT TIME ZONE 'Asia/Seoul' AND created_at < ($2::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul'`;
      summaryParams.push(`${yearMonth.slice(0,4)}-${yearMonth.slice(4,6)}-01`);
    }
    
    // 일반 사용자는 본인 캠페인만
    if (userType === 'company_user') {
      summaryQuery += ` AND created_by = $${summaryParams.length + 1}`;
      summaryParams.push(userId);
    }

    // 고객사 관리자: 특정 사용자 필터
    if (userType === 'company_admin' && req.query.filter_user_id) {
      summaryQuery += ` AND created_by = $${summaryParams.length + 1}`;
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

    const { from, to, channel, page = 1, limit = 20, fromDate, toDate } = req.query;
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

    // 기간 필터 (fromDate/toDate 일자 범위 우선, 없으면 from/to 월 단위) — KST 기준
    if (fromDate && toDate) {
      whereClause += ` AND created_at >= $${paramIndex++}::date::timestamp AT TIME ZONE 'Asia/Seoul'`;
      params.push(String(fromDate));
      whereClause += ` AND created_at < ($${paramIndex++}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Seoul'`;
      params.push(String(toDate));
    } else {
      if (from) {
        whereClause += ` AND created_at >= $${paramIndex++}::date::timestamp AT TIME ZONE 'Asia/Seoul'`;
        params.push(`${String(from).slice(0,4)}-${String(from).slice(4,6)}-01`);
      }
      if (to) {
        whereClause += ` AND created_at < ($${paramIndex++}::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul'`;
        params.push(`${String(to).slice(0,4)}-${String(to).slice(4,6)}-01`);
      }
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
        c.is_ad, c.scheduled_at, c.sent_at, c.created_at, c.send_channel,
        (c.created_at AT TIME ZONE 'Asia/Seoul')::date as created_date_kst,
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

    const companyTables = await getCompanySmsTables(companyId);

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
    const sendChannel = campaign.send_channel || 'sms';

    // MySQL에서 실패사유별 집계 조회
    let errorStats: Record<string, number> = {};
    let carrierStats: Record<string, number> = {};
    
    if (queryIds.length > 0) {
      // ===== SMS 결과 집계 (sms/both 채널) =====
      if (sendChannel === 'sms' || sendChannel === 'both') {
        // 실패사유별 집계 (회사 라인그룹 테이블 합산)
        const errorResult = await smsSelectAllWhere(companyTables,
          'status_code, COUNT(*) as cnt',
          `WHERE app_etc1 IN (${queryIds.map(() => '?').join(',')})`,
          queryIds,
          'GROUP BY status_code'
        );
        const errorAgg: Record<number, number> = {};
        errorResult.forEach((row: any) => {
          errorAgg[row.status_code] = (errorAgg[row.status_code] || 0) + parseInt(row.cnt);
        });

        const statusCodeMap: Record<number, string> = {
          6: 'SMS 성공', 1000: 'LMS 성공', 1800: '카카오 성공', 100: '발송 대기',
          55: '요금 부족', 2008: '비가입자/결번', 23: '식별코드 오류', 2323: '식별코드 오류',
          3000: '메시지 형식 오류', 3001: '발신번호 오류', 3002: '수신번호 오류',
          3003: '메시지 길이 초과', 3004: '스팸 차단', 4000: '전송 시간 초과', 9999: '기타 오류',
        };

        Object.entries(errorAgg).forEach(([codeStr, cnt]) => {
          const code = parseInt(codeStr);
          const label = statusCodeMap[code] || `오류 코드 ${code}`;
          if (![6, 1000, 1800, 100].includes(code)) {
            errorStats[label] = (errorStats[label] || 0) + cnt;
          }
        });

        // 통신사별 집계
        const carrierResult = await smsSelectAllWhere(companyTables,
          'mob_company, COUNT(*) as cnt',
          `WHERE app_etc1 IN (${queryIds.map(() => '?').join(',')}) AND status_code IN (6, 1000, 1800)`,
          queryIds,
          'GROUP BY mob_company'
        );
        const carrierAgg: Record<string, number> = {};
        carrierResult.forEach((row: any) => {
          const key = row.mob_company || '';
          carrierAgg[key] = (carrierAgg[key] || 0) + parseInt(row.cnt);
        });

        const carrierMap: Record<string, string> = {
          '11': 'SKT', '16': 'KT', '19': 'LG U+',
          '12': 'SKT 알뜰폰', '17': 'KT 알뜰폰', '20': 'LG 알뜰폰',
          'SKT': 'SKT', 'KTF': 'KT', 'LGT': 'LG U+',
        };

        Object.entries(carrierAgg).forEach(([carrier, cnt]) => {
          const label = carrierMap[carrier] || carrier || '알 수 없음';
          carrierStats[label] = (carrierStats[label] || 0) + cnt;
        });
      }

      // ===== 카카오 결과 집계 (kakao/both 채널) =====
      if (sendChannel === 'kakao' || sendChannel === 'both') {
        const kakaoErrorResult = await kakaoSelectWhere(
          'REPORT_CODE, COUNT(*) as cnt',
          `WHERE REQUEST_UID = ?`,
          [id],
          'GROUP BY REPORT_CODE'
        );
        kakaoErrorResult.forEach((row: any) => {
          const code = row.REPORT_CODE || '';
          const cnt = parseInt(row.cnt);
          if (code === '0000') {
            carrierStats['카카오'] = (carrierStats['카카오'] || 0) + cnt;
          } else if (code !== '' && row.REPORT_CODE !== null) {
            const label = `카카오 오류 (${code})`;
            errorStats[label] = (errorStats[label] || 0) + cnt;
          }
        });

        // 카카오 대체발송(SMS) 결과도 집계
        const kakaoResendResult = await kakaoSelectWhere(
          'RESEND_REPORT_CODE, COUNT(*) as cnt',
          `WHERE REQUEST_UID = ? AND RESEND_MT_TYPE != 'NO' AND RESEND_REPORT_CODE IS NOT NULL AND RESEND_REPORT_CODE != ''`,
          [id],
          'GROUP BY RESEND_REPORT_CODE'
        );
        kakaoResendResult.forEach((row: any) => {
          const cnt = parseInt(row.cnt);
          if (row.RESEND_REPORT_CODE === '0000') {
            carrierStats['카카오→SMS대체'] = (carrierStats['카카오→SMS대체'] || 0) + cnt;
          }
        });
      }
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

// GET /api/v1/results/campaigns/:id/messages - 개별 발송 건 목록 (SMS+카카오 통합)
router.get('/campaigns/:id/messages', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const { id } = req.params;
    const { searchType, searchValue, status, page = 1, limit = 100 } = req.query;

    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const msgTables = await getCompanySmsTables(companyId);
    const runIds = [id];
    const offset = (Number(page) - 1) * Number(limit);

    // 캠페인 채널 확인
    const campResult = await query('SELECT send_channel FROM campaigns WHERE id = $1 AND company_id = $2', [id, companyId]);
    const sendChannel = campResult.rows[0]?.send_channel || 'sms';

    let allMessages: any[] = [];
    let total = 0;

    // ===== SMS 메시지 조회 (sms/both) =====
    if (sendChannel === 'sms' || sendChannel === 'both') {
      let whereClause = `WHERE app_etc1 IN (${runIds.map(() => '?').join(',')})`;
      const params: any[] = [...runIds];

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

      if (status === 'success') {
        whereClause += ` AND status_code IN (6, 1000, 1800)`;
      } else if (status === 'fail') {
        whereClause += ` AND status_code NOT IN (6, 1000, 1800, 100)`;
      }

      total += await smsCountAllWhere(msgTables, whereClause, params);

      const smsMessages = await smsSelectAllWhere(msgTables,
        'seqno, dest_no, call_back, msg_type, msg_contents, status_code, mob_company, sendreq_time, mobsend_time, repmsg_recvtm',
        whereClause,
        params
      );
      // SMS 메시지에 channel 태그
      smsMessages.forEach((m: any) => { m._channel = 'sms'; m._sort_time = m.sendreq_time; });
      allMessages = allMessages.concat(smsMessages);
    }

    // ===== 카카오 메시지 조회 (kakao/both) =====
    if (sendChannel === 'kakao' || sendChannel === 'both') {
      let kakaoWhere = `WHERE REQUEST_UID = ?`;
      const kakaoParams: any[] = [id];

      if (searchType && searchValue) {
        switch (searchType) {
          case 'phone':
            kakaoWhere += ` AND PHONE_NUMBER LIKE ?`;
            kakaoParams.push(`%${searchValue}%`);
            break;
          case 'content':
            kakaoWhere += ` AND MESSAGE LIKE ?`;
            kakaoParams.push(`%${searchValue}%`);
            break;
        }
      }

      if (status === 'success') {
        kakaoWhere += ` AND REPORT_CODE = '0000'`;
      } else if (status === 'fail') {
        kakaoWhere += ` AND REPORT_CODE != '0000' AND STATUS IN ('3','4')`;
      }

      const kakaoTotal = await kakaoCountWhere(kakaoWhere, kakaoParams);
      total += kakaoTotal;

      const kakaoMessages = await kakaoSelectWhere(
        'ID, PHONE_NUMBER, MESSAGE, CHAT_BUBBLE_TYPE, STATUS, REPORT_CODE, REPORT_DATE, REQUEST_DATE, RESPONSE_DATE, RESEND_MT_TYPE, RESEND_REPORT_CODE',
        kakaoWhere,
        kakaoParams
      );
      // 카카오 메시지를 SMS와 같은 형태로 변환
      kakaoMessages.forEach((m: any) => {
        allMessages.push({
          seqno: m.ID,
          dest_no: m.PHONE_NUMBER,
          call_back: '-',
          msg_type: 'KAKAO',
          msg_contents: m.MESSAGE,
          status_code: m.REPORT_CODE === '0000' ? 1800 : (m.STATUS === '1' ? 100 : 9999),
          mob_company: '카카오',
          sendreq_time: m.REQUEST_DATE,
          mobsend_time: m.RESPONSE_DATE,
          repmsg_recvtm: m.REPORT_DATE,
          _channel: 'kakao',
          _sort_time: m.REQUEST_DATE,
          kakao_bubble_type: m.CHAT_BUBBLE_TYPE,
          kakao_report_code: m.REPORT_CODE,
          resend_type: m.RESEND_MT_TYPE,
          resend_report_code: m.RESEND_REPORT_CODE,
        });
      });
    }

    // 정렬 + 페이지네이션
    allMessages.sort((a: any, b: any) => {
      const ta = new Date(a._sort_time || 0).getTime();
      const tb = new Date(b._sort_time || 0).getTime();
      return tb - ta;
    });
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
// GET /api/v1/results/campaigns/:id/export - 발송내역 CSV 다운로드 (SMS+카카오 통합)
router.get('/campaigns/:id/export', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const { id } = req.params;
    if (!companyId) return res.status(403).json({ error: '권한이 필요합니다.' });

    const campaignResult = await query(
      `SELECT campaign_name, send_channel FROM campaigns WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    if (campaignResult.rows.length === 0) return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    const sendChannel = campaignResult.rows[0].send_channel || 'sms';

    const statusMap: Record<number, string> = {
      6:'SMS성공', 1000:'LMS성공', 1800:'카카오성공', 100:'대기',
      55:'요금부족', 2008:'비가입자/결번', 23:'식별코드오류', 2323:'식별코드오류',
      3000:'형식오류', 3001:'발신번호오류', 3002:'수신번호오류', 3003:'길이초과', 3004:'스팸차단', 4000:'시간초과', 9999:'기타오류'
    };
    const carrierMap: Record<string, string> = {
      '11':'SKT', '16':'KT', '19':'LG U+', '12':'SKT알뜰폰', '17':'KT알뜰폰', '20':'LG알뜰폰', 'SKT':'SKT', 'KTF':'KT', 'LGT':'LG U+'
    };

    let allRows: string[] = [];

    // SMS 내역
    if (sendChannel === 'sms' || sendChannel === 'both') {
      const exportTables = await getCompanySmsTables(companyId);
      const messages = await smsSelectAllWhere(exportTables,
        'seqno, dest_no, call_back, msg_type, msg_contents, status_code, mob_company, sendreq_time, mobsend_time, repmsg_recvtm',
        'WHERE app_etc1 = ?',
        [id]
      );
      messages.sort((a: any, b: any) => a.seqno - b.seqno);

      messages.forEach((m: any) => {
        allRows.push([
          m.dest_no, m.call_back,
          m.msg_type === 'S' ? 'SMS' : m.msg_type === 'L' ? 'LMS' : m.msg_type,
          `"${(m.msg_contents || '').replace(/"/g, '""')}"`,
          statusMap[m.status_code] || `코드${m.status_code}`, m.status_code,
          carrierMap[m.mob_company] || m.mob_company || '',
          m.sendreq_time || '', m.mobsend_time || '', m.repmsg_recvtm || ''
        ].join(','));
      });
    }

    // 카카오 내역
    if (sendChannel === 'kakao' || sendChannel === 'both') {
      const kakaoMessages = await kakaoSelectWhere(
        'ID, PHONE_NUMBER, MESSAGE, CHAT_BUBBLE_TYPE, REPORT_CODE, REQUEST_DATE, RESPONSE_DATE, REPORT_DATE',
        'WHERE REQUEST_UID = ?',
        [id]
      );

      kakaoMessages.forEach((m: any) => {
        const kakaoStatus = m.REPORT_CODE === '0000' ? '카카오성공' : `카카오실패(${m.REPORT_CODE || '미수신'})`;
        allRows.push([
          m.PHONE_NUMBER, '-',
          `카카오(${m.CHAT_BUBBLE_TYPE || 'TEXT'})`,
          `"${(m.MESSAGE || '').replace(/"/g, '""')}"`,
          kakaoStatus, m.REPORT_CODE || '',
          '카카오',
          m.REQUEST_DATE || '', m.RESPONSE_DATE || '', m.REPORT_DATE || ''
        ].join(','));
      });
    }

    const BOM = '\uFEFF';
    const headers = '수신번호,회신번호,메시지유형,메시지내용,전송결과,결과코드,통신사,전송요청시간,발송시간,수신확인시간';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=send_detail_${id}.csv`);
    res.send(BOM + headers + '\n' + allRows.join('\n'));
  } catch (error) {
    console.error('내보내기 에러:', error);
    res.status(500).json({ error: '내보내기 실패' });
  }
});

export default router;