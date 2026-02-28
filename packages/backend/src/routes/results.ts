import { Request, Response, Router } from 'express';
import { mysqlQuery, query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { getCompanySmsTablesWithLogs } from './campaigns';
import { STATUS_CODE_MAP, CARRIER_MAP, SUCCESS_CODES, PENDING_CODES, getStatusLabel, getCarrierLabel } from '../utils/sms-result-map';

const router = Router();

// ===== UNION ALL 기반 MySQL 헬퍼 (서버측 정렬/페이지네이션) =====
// [S9-08] 기존: N개 테이블 순차 쿼리 → 메모리 concat → JS 정렬 → slice (30만건 OOM 위험)
// 개선: UNION ALL 단일 쿼리 → MySQL이 정렬+페이징 처리 (페이지 분량만 메모리 로드)

/** 파라미터를 테이블 수만큼 반복 (UNION ALL 각 서브쿼리에 동일 WHERE 파라미터 필요) */
function repeatParams(params: any[], count: number): any[] {
  const result: any[] = [];
  for (let i = 0; i < count; i++) result.push(...params);
  return result;
}

/** UNION ALL COUNT: 여러 테이블의 COUNT를 SUM으로 합산 — 단일 쿼리 */
async function smsUnionCount(tables: string[], whereClause: string, params: any[]): Promise<number> {
  if (tables.length === 0) return 0;
  const sql = `SELECT SUM(cnt) AS total FROM (${
    tables.map(t => `SELECT COUNT(*) AS cnt FROM ${t} ${whereClause}`).join(' UNION ALL ')
  }) AS _u`;
  const rows = await mysqlQuery(sql, repeatParams(params, tables.length)) as any[];
  return parseInt(rows[0]?.total || '0');
}

/** UNION ALL SELECT: ORDER BY + LIMIT/OFFSET을 MySQL에서 처리 */
async function smsUnionSelect(
  tables: string[], fields: string, whereClause: string, params: any[],
  orderBy?: string, limit?: number, offset?: number
): Promise<any[]> {
  if (tables.length === 0) return [];
  let sql = tables.map(t => `(SELECT ${fields} FROM ${t} ${whereClause})`).join(' UNION ALL ');
  const allParams = repeatParams(params, tables.length);
  if (orderBy) sql += ` ORDER BY ${orderBy}`;
  if (limit !== undefined) { sql += ` LIMIT ?`; allParams.push(limit); }
  if (offset !== undefined) { sql += ` OFFSET ?`; allParams.push(offset); }
  return await mysqlQuery(sql, allParams) as any[];
}

/** UNION ALL GROUP BY: 여러 테이블 통합 후 단일 GROUP BY 집계 — 기존 N회→1회 */
async function smsUnionGroupBy(
  tables: string[], rawField: string, whereClause: string, params: any[]
): Promise<Record<string, number>> {
  if (tables.length === 0) return {};
  const sql = `SELECT _grp, COUNT(*) AS cnt FROM (${
    tables.map(t => `(SELECT ${rawField} AS _grp FROM ${t} ${whereClause})`).join(' UNION ALL ')
  }) AS _u GROUP BY _grp`;
  const rows = await mysqlQuery(sql, repeatParams(params, tables.length)) as any[];
  const result: Record<string, number> = {};
  for (const r of rows) result[String(r._grp ?? '')] = parseInt(r.cnt);
  return result;
}

// ===== 카카오 브랜드메시지 헬퍼 (단일 테이블 — 변경 불필요) =====

async function kakaoCountWhere(whereClause: string, params: any[]): Promise<number> {
  const rows = await mysqlQuery(`SELECT COUNT(*) AS cnt FROM IMC_BM_FREE_BIZ_MSG ${whereClause}`, params) as any[];
  return parseInt(rows[0]?.cnt || '0');
}

async function kakaoSelectWhere(fields: string, whereClause: string, params: any[], suffix?: string): Promise<any[]> {
  return await mysqlQuery(`SELECT ${fields} FROM IMC_BM_FREE_BIZ_MSG ${whereClause} ${suffix || ''}`, params) as any[];
}

router.use(authenticate);

// ======================================================================
// GET /api/v1/results/summary — 캠페인 요약 + 비용 (PostgreSQL — 변경 없음)
// ======================================================================
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
    
    let summaryQuery = `SELECT 
        COUNT(*) as total_campaigns,
        SUM(target_count) as total_target,
        SUM(sent_count) as total_sent,
        SUM(success_count) as total_success,
        SUM(fail_count) as total_fail
       FROM campaigns 
       WHERE company_id = $1`;
    
    const summaryParams: any[] = [companyId];

    summaryQuery += ` AND status NOT IN ('cancelled', 'draft')`;

    if (fromDate && toDate) {
      summaryQuery += ` AND created_at >= $2::date::timestamp AT TIME ZONE 'Asia/Seoul' AND created_at < ($3::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Seoul'`;
      summaryParams.push(String(fromDate), String(toDate));
    } else {
      summaryQuery += ` AND created_at >= $2::date::timestamp AT TIME ZONE 'Asia/Seoul' AND created_at < ($2::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul'`;
      summaryParams.push(`${yearMonth.slice(0,4)}-${yearMonth.slice(4,6)}-01`);
    }
    
    if (userType === 'company_user') {
      summaryQuery += ` AND created_by = $${summaryParams.length + 1}`;
      summaryParams.push(userId);
    }

    if (userType === 'company_admin' && req.query.filter_user_id) {
      summaryQuery += ` AND created_by = $${summaryParams.length + 1}`;
      summaryParams.push(req.query.filter_user_id);
    }
    
    const campaignStats = await query(summaryQuery, summaryParams);

    const costResult = await query(
      `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1`,
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

// ======================================================================
// GET /api/v1/results/campaigns — 캠페인 목록 (PostgreSQL — 변경 없음)
// ======================================================================
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
    
    if (userType === 'company_user') {
      whereClause += ` AND created_by = $${paramIndex++}`;
      params.push(userId);
    }

    if (userType === 'company_admin' && req.query.filter_user_id) {
      whereClause += ` AND created_by = $${paramIndex++}`;
      params.push(req.query.filter_user_id);
    }

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

// ======================================================================
// GET /api/v1/results/campaigns/:id — 캠페인 상세 (차트 데이터)
// [S9-08] 기존: 27테이블 × 2집계 = 54쿼리 → UNION ALL GROUP BY 단일 쿼리 2개
// ======================================================================
router.get('/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const { id } = req.params;

    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const companyTables = await getCompanySmsTablesWithLogs(companyId);

    const campaignResult = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }

    const campaign = campaignResult.rows[0];

    const runsResult = await query(
      `SELECT * FROM campaign_runs WHERE campaign_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    const sendChannel = campaign.send_channel || 'sms';

    let errorStats: Record<string, number> = {};
    let carrierStats: Record<string, number> = {};

    // ===== SMS 결과 집계 — UNION ALL + GROUP BY (단일 쿼리 2개) =====
    if (sendChannel === 'sms' || sendChannel === 'both') {
      // 실패사유별 집계
      const statusAgg = await smsUnionGroupBy(
        companyTables, 'status_code', 'WHERE app_etc1 = ?', [id]
      );

      // statusCodeMap → sms-result-map.ts의 STATUS_CODE_MAP 사용

      for (const [codeStr, cnt] of Object.entries(statusAgg)) {
        const code = parseInt(codeStr);
        if (![...SUCCESS_CODES, ...PENDING_CODES].includes(code)) {
          const label = getStatusLabel(code);
          errorStats[label] = (errorStats[label] || 0) + cnt;
        }
      }

      // 통신사별 집계 (성공 건만) — sms-result-map.ts 상수 사용
      const carrierAgg = await smsUnionGroupBy(
        companyTables, 'mob_company',
        `WHERE app_etc1 = ? AND status_code IN (${SUCCESS_CODES.join(',')})`, [id]
      );

      for (const [carrier, cnt] of Object.entries(carrierAgg)) {
        const label = getCarrierLabel(carrier);
        carrierStats[label] = (carrierStats[label] || 0) + cnt;
      }
    }

    // ===== 카카오 결과 집계 =====
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

// ======================================================================
// GET /api/v1/results/campaigns/:id/messages — 개별 발송 건 목록
// [S9-08 핵심] 기존: 27테이블 전체 SELECT → 메모리 concat → sort → slice (30만건 OOM)
// 개선: SMS+카카오 UNION ALL 단일 쿼리 → MySQL ORDER BY + LIMIT/OFFSET (페이지 분량만 로드)
// ======================================================================
router.get('/campaigns/:id/messages', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const { id } = req.params;
    const { searchType, searchValue, status, page = 1, limit = 100 } = req.query;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const offset = (pageNum - 1) * limitNum;

    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const msgTables = await getCompanySmsTablesWithLogs(companyId);

    // 캠페인 채널 확인
    const campResult = await query('SELECT send_channel FROM campaigns WHERE id = $1 AND company_id = $2', [id, companyId]);
    const sendChannel = campResult.rows[0]?.send_channel || 'sms';

    // ===== UNION ALL 서브쿼리 빌드 =====
    const dataSubqueries: string[] = [];
    const countSubqueries: string[] = [];
    const dataParams: any[] = [];
    const countParams: any[] = [];

    // ----- SMS 서브쿼리 (테이블 수만큼 UNION ALL) -----
    if (sendChannel === 'sms' || sendChannel === 'both') {
      let smsWhere = 'WHERE app_etc1 = ?';
      const smsBaseParams: any[] = [id];

      if (searchType && searchValue) {
        const sv = `%${String(searchValue).trim()}%`;
        if (searchType === 'phone') { smsWhere += ' AND dest_no LIKE ?'; smsBaseParams.push(sv); }
        else if (searchType === 'callback') { smsWhere += ' AND call_back LIKE ?'; smsBaseParams.push(sv); }
        else if (searchType === 'content') { smsWhere += ' AND msg_contents LIKE ?'; smsBaseParams.push(sv); }
      }

      if (status === 'success') smsWhere += ` AND status_code IN (${SUCCESS_CODES.join(',')})`;
      else if (status === 'fail') smsWhere += ` AND status_code NOT IN (${[...SUCCESS_CODES, ...PENDING_CODES].join(',')})`;

      // SMS 통합 필드 (카카오와 UNION ALL 호환 — 컬럼 수/순서 동일)
      const smsFields = `seqno, dest_no, call_back, msg_type, msg_contents, status_code, mob_company,
        sendreq_time, mobsend_time, repmsg_recvtm,
        'sms' AS _channel, sendreq_time AS _sort_time,
        NULL AS kakao_bubble_type, NULL AS kakao_report_code,
        NULL AS resend_type, NULL AS resend_report_code`;

      for (const t of msgTables) {
        dataSubqueries.push(`(SELECT ${smsFields} FROM ${t} ${smsWhere})`);
        countSubqueries.push(`SELECT COUNT(*) AS cnt FROM ${t} ${smsWhere}`);
        dataParams.push(...smsBaseParams);
        countParams.push(...smsBaseParams);
      }
    }

    // ----- 카카오 서브쿼리 (단일 테이블) -----
    if (sendChannel === 'kakao' || sendChannel === 'both') {
      let kakaoWhere = 'WHERE REQUEST_UID = ?';
      const kakaoBaseParams: any[] = [id];

      if (searchType && searchValue) {
        const sv = `%${String(searchValue).trim()}%`;
        if (searchType === 'phone') { kakaoWhere += ' AND PHONE_NUMBER LIKE ?'; kakaoBaseParams.push(sv); }
        else if (searchType === 'content') { kakaoWhere += ' AND MESSAGE LIKE ?'; kakaoBaseParams.push(sv); }
        // callback 검색은 카카오에 미적용 (원래 동작과 동일)
      }

      if (status === 'success') kakaoWhere += ` AND REPORT_CODE = '0000'`;
      else if (status === 'fail') kakaoWhere += ` AND REPORT_CODE != '0000' AND STATUS IN ('3','4')`;

      // 카카오 통합 필드 (SMS와 UNION ALL 호환 — 동일 컬럼 이름으로 매핑)
      const kakaoFields = `ID AS seqno, PHONE_NUMBER AS dest_no, '-' AS call_back, 'KAKAO' AS msg_type,
        MESSAGE AS msg_contents,
        CASE WHEN REPORT_CODE='0000' THEN 1800 WHEN STATUS='1' THEN 100 ELSE 9999 END AS status_code,
        '카카오' AS mob_company,
        REQUEST_DATE AS sendreq_time, RESPONSE_DATE AS mobsend_time, REPORT_DATE AS repmsg_recvtm,
        'kakao' AS _channel, REQUEST_DATE AS _sort_time,
        CHAT_BUBBLE_TYPE AS kakao_bubble_type, REPORT_CODE AS kakao_report_code,
        RESEND_MT_TYPE AS resend_type, RESEND_REPORT_CODE AS resend_report_code`;

      dataSubqueries.push(`(SELECT ${kakaoFields} FROM IMC_BM_FREE_BIZ_MSG ${kakaoWhere})`);
      countSubqueries.push(`SELECT COUNT(*) AS cnt FROM IMC_BM_FREE_BIZ_MSG ${kakaoWhere}`);
      dataParams.push(...kakaoBaseParams);
      countParams.push(...kakaoBaseParams);
    }

    // 서브쿼리가 없으면 빈 결과
    if (dataSubqueries.length === 0) {
      return res.json({ messages: [], pagination: { total: 0, page: pageNum, limit: limitNum } });
    }

    // ===== COUNT — 단일 쿼리 (기존: N+1쿼리 → 1쿼리) =====
    const countSql = `SELECT SUM(cnt) AS total FROM (${countSubqueries.join(' UNION ALL ')}) AS _c`;
    const countRows = await mysqlQuery(countSql, countParams) as any[];
    const total = parseInt(countRows[0]?.total || '0');

    // ===== DATA — 단일 쿼리, MySQL이 정렬+페이징 (기존: 30만건 메모리 로드 → 페이지 분량만) =====
    const dataSql = `${dataSubqueries.join(' UNION ALL ')} ORDER BY _sort_time DESC LIMIT ? OFFSET ?`;
    dataParams.push(limitNum, offset);
    const messages = await mysqlQuery(dataSql, dataParams) as any[];

    return res.json({
      messages,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error('메시지 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ======================================================================
// GET /api/v1/results/campaigns/:id/export — 발송내역 CSV 다운로드
// [S9-08] 기존: 30만건 전체 메모리 로드 → join → res.send (OOM/타임아웃)
// 개선: UNION ALL + 청크 단위 스트리밍 (10,000건씩 쿼리→즉시 write→다음 청크)
// ======================================================================
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

    // statusMap, carrierMap → sms-result-map.ts의 getStatusLabel(), getCarrierLabel() 사용

    // ===== UNION ALL 서브쿼리 빌드 =====
    const subqueries: string[] = [];
    const baseParams: any[] = [];

    if (sendChannel === 'sms' || sendChannel === 'both') {
      const exportTables = await getCompanySmsTablesWithLogs(companyId);
      const smsFields = `dest_no, call_back, msg_type, msg_contents, status_code, mob_company,
        sendreq_time, mobsend_time, repmsg_recvtm, 'sms' AS _channel, NULL AS report_code_raw`;
      for (const t of exportTables) {
        subqueries.push(`(SELECT ${smsFields} FROM ${t} WHERE app_etc1 = ?)`);
        baseParams.push(id);
      }
    }

    if (sendChannel === 'kakao' || sendChannel === 'both') {
      const kakaoFields = `PHONE_NUMBER AS dest_no, '-' AS call_back,
        CONCAT('카카오(', COALESCE(CHAT_BUBBLE_TYPE, 'TEXT'), ')') AS msg_type,
        MESSAGE AS msg_contents,
        CASE WHEN REPORT_CODE='0000' THEN 1800 WHEN STATUS='1' THEN 100 ELSE 9999 END AS status_code,
        '카카오' AS mob_company,
        REQUEST_DATE AS sendreq_time, RESPONSE_DATE AS mobsend_time, REPORT_DATE AS repmsg_recvtm,
        'kakao' AS _channel, REPORT_CODE AS report_code_raw`;
      subqueries.push(`(SELECT ${kakaoFields} FROM IMC_BM_FREE_BIZ_MSG WHERE REQUEST_UID = ?)`);
      baseParams.push(id);
    }

    // CSV 헤더 스트리밍 시작
    const BOM = '\uFEFF';
    const headers = '수신번호,회신번호,메시지유형,메시지내용,전송결과,결과코드,통신사,전송요청시간,발송시간,수신확인시간';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=send_detail_${id}.csv`);
    res.write(BOM + headers + '\n');

    if (subqueries.length === 0) { res.end(); return; }

    // ===== 청크 단위 스트리밍 — 10,000건씩 쿼리 → 즉시 write → 다음 청크 =====
    const CHUNK_SIZE = 10000;
    const baseSql = subqueries.join(' UNION ALL ');
    let chunkOffset = 0;

    while (true) {
      const chunkParams = [...baseParams, CHUNK_SIZE, chunkOffset];
      const rows = await mysqlQuery(
        `${baseSql} ORDER BY sendreq_time ASC LIMIT ? OFFSET ?`,
        chunkParams
      ) as any[];

      if (rows.length === 0) break;

      for (const m of rows) {
        const channel = m._channel;
        let msgTypeDisplay: string;
        let statusDisplay: string;
        let carrierDisplay: string;

        if (channel === 'kakao') {
          msgTypeDisplay = m.msg_type;
          statusDisplay = m.status_code === 1800
            ? '카카오성공'
            : `카카오실패(${m.report_code_raw || '미수신'})`;
          carrierDisplay = '카카오';
        } else {
          msgTypeDisplay = m.msg_type === 'S' ? 'SMS' : m.msg_type === 'L' ? 'LMS' : m.msg_type;
          statusDisplay = getStatusLabel(m.status_code);
          carrierDisplay = getCarrierLabel(m.mob_company);
        }

        res.write([
          m.dest_no, m.call_back, msgTypeDisplay,
          `"${(m.msg_contents || '').replace(/"/g, '""')}"`,
          statusDisplay, m.status_code,
          carrierDisplay,
          m.sendreq_time || '', m.mobsend_time || '', m.repmsg_recvtm || ''
        ].join(',') + '\n');
      }

      chunkOffset += rows.length;
      if (rows.length < CHUNK_SIZE) break;
    }

    res.end();
  } catch (error) {
    console.error('내보내기 에러:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: '내보내기 실패' });
    } else {
      res.end();
    }
  }
});

export default router;
