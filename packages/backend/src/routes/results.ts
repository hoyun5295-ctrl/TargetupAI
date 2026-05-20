import { Request, Response, Router } from 'express';
import { mysqlQuery, query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import {
  getCompanySmsTablesWithLogs,
  smsCountAll as smsUnionCount,
  smsSelectAll,
  smsGroupByAll as smsUnionGroupBy,
  kakaoCountWhere,
  kakaoSelectWhere,
  kakaoGroupBy,
  kakaoBatchAggByGroup,
} from '../utils/sms-queue';
import { STATUS_CODE_MAP, CARRIER_MAP, SUCCESS_CODES, PENDING_CODES, getStatusLabel, getStatusType, getCarrierLabel, isSuccess } from '../utils/sms-result-map';
import { DEFAULT_COSTS, redis, CACHE_TTL } from '../config/defaults';
import { buildDateRangeFilter, buildPeriodFilter, aggregateSmsCountsByCampaign, aggregateSmsSendTimesByCampaign } from '../utils/stats-aggregation';
import { CAMPAIGN_OPT080_SELECT_EXPR, CAMPAIGN_OPT080_LEFT_JOIN } from '../utils/unsubscribe-helper';

const router = Router();

/**
 * ★ D98: CSV/엑셀 출력용 날짜 포맷팅 — YYYY-MM-DD HH:mm:ss 형식
 * MySQL DATETIME → JS Date → .toString() 시 "Mon Mar 23 2026 14:27:08 GMT+0900" 방지
 */
function formatCsvDateTime(val: any): string {
  if (!val) return '';
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// ===== SMS 필드 정의 컨트롤타워 (3곳에서 사용 — 인라인 중복 방지) =====
// ★ D98: MySQL 서버 TZ=KST(+09:00)이지만, QTmsg Agent가 mobsend_time/repmsg_recvtm을 UTC로 기록
//   - sendreq_time: 우리 앱 NOW() → KST → DATE_ADD 불필요
//   - mobsend_time: QTmsg Agent → UTC → DATE_ADD(+9h) 필요
//   - repmsg_recvtm: QTmsg Agent → UTC → DATE_ADD(+9h) 필요 (현재 미사용 — B10 참조)
// ★ D124: UI 발송내역(ResultsModal)은 수신확인 컬럼 제거
// ★ B10(0417 PDF #4): 엑셀다운로드에서도 수신확인시간 컬럼 제거
//   사유: 고객이 "발송일시 vs 수신확인시간" 차이로 지연수신 오해/클레임 소지
//   → UI와 엑셀 전부 2컬럼 유지(전송요청/발송)로 통일
/** 상세조회용 SMS 필드 (seqno 포함) — UI만 사용, 수신확인 없음 */
const SMS_DETAIL_FIELDS = `seqno, dest_no, call_back, msg_type, msg_contents, status_code, mob_company,
  sendreq_time,
  DATE_ADD(mobsend_time, INTERVAL 9 HOUR) AS mobsend_time,
  'sms' AS _channel, sendreq_time AS _sort_time,
  '' AS kakao_bubble_type, '' AS kakao_report_code,
  '' AS resend_type, '' AS resend_report_code`;

/** 엑셀 export용 SMS 필드 (seqno 제외) — 엑셀 2컬럼 유지: 전송요청/발송 (B10: 수신확인 제거) */
const SMS_EXPORT_FIELDS = `dest_no, call_back, msg_type, msg_contents, status_code, mob_company,
  sendreq_time,
  DATE_ADD(mobsend_time, INTERVAL 9 HOUR) AS mobsend_time,
  'sms' AS _channel, NULL AS report_code_raw`;

// ===== UNION ALL 기반 MySQL 헬퍼 — CT-04(sms-queue.ts)로 승격됨 =====
// smsUnionCount → smsCountAll, smsUnionGroupBy → smsGroupByAll, kakao 헬퍼 → CT-04
// smsUnionSelect는 ORDER BY/LIMIT 후미구문 호환을 위해 smsSelectAll 래퍼로 유지.

/** smsSelectAll 래퍼: orderBy/limit/offset을 suffix로 조립 */
async function smsUnionSelect(
  tables: string[], fields: string, whereClause: string, params: any[],
  orderBy?: string, limit?: number, offset?: number
): Promise<any[]> {
  // whereClause는 "WHERE ..." 형식으로 전달받음 — "WHERE " 접두사 제거하여 CT-04 규약으로 변환
  const where = whereClause.replace(/^\s*WHERE\s+/i, '');
  let suffix = '';
  if (orderBy) suffix += `ORDER BY ${orderBy} `;
  if (limit !== undefined) suffix += `LIMIT ${Number(limit)} `;
  if (offset !== undefined) suffix += `OFFSET ${Number(offset)}`;
  return await smsSelectAll(tables, fields, where, params, suffix.trim() || undefined);
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
    
    // ★ D144: PG sent_count/success_count/fail_count 캐시 의존 제거.
    //   PG는 캠페인 메타(id/target)만 SELECT → MySQL 큐 + 카카오 직접 카운트 → JS 합산.
    let summaryQuery = `SELECT
        c.id, c.company_id, c.created_by, c.target_count
       FROM campaigns c
       WHERE c.company_id = $1`;

    const summaryParams: any[] = [companyId];

    // ★ D98: draft/cancelled도 실패로 카운트 (목록에서 제외하지 않음)
    summaryQuery += ` AND c.status NOT IN ('cancelled')`;

    // ★ D143 (2026-05-04, shiseido6 신고): 발송결과 출력 기준 = 발송일시
    //   발송 완료(sent_at) 우선 → 예약 대기(scheduled_at) → 미발송(created_at) 폴백
    //   정산이 발송일 기준이므로 4/30 등록 + 5/7 예약 캠페인은 5월 결과에 표시되어야 함
    const summaryDr = buildPeriodFilter('COALESCE(c.sent_at, c.scheduled_at, c.created_at)', {
      fromDate: fromDate ? String(fromDate) : undefined,
      toDate: toDate ? String(toDate) : undefined,
      yearMonth: (!fromDate || !toDate) ? yearMonth : undefined,
    }, summaryParams.length + 1);
    summaryQuery += summaryDr.sql;
    summaryParams.push(...summaryDr.params);

    if (userType === 'company_user') {
      summaryQuery += ` AND c.created_by = $${summaryParams.length + 1}`;
      summaryParams.push(userId);
    }

    if (userType === 'company_admin' && req.query.filter_user_id) {
      summaryQuery += ` AND c.created_by = $${summaryParams.length + 1}`;
      summaryParams.push(req.query.filter_user_id);
    }

    const summaryMeta = await query(summaryQuery, summaryParams);
    const summarySmsMap = await aggregateSmsCountsByCampaign(summaryMeta.rows);
    const summaryKakaoMap = await kakaoBatchAggByGroup(summaryMeta.rows.map((c: any) => c.id));

    let totalSent = 0, totalSuccess = 0, totalFail = 0, totalTarget = 0;
    for (const c of summaryMeta.rows) {
      totalTarget += Number(c.target_count || 0);
      const sms = summarySmsMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0 };
      const kakao = summaryKakaoMap.get(c.id) || { total: 0, success: 0, fail: 0, pending: 0 };
      totalSent += Number(sms.total_count || 0) + kakao.total;
      totalSuccess += Number(sms.success_count || 0) + kakao.success;
      totalFail += Number(sms.fail_count || 0) + kakao.fail;
    }
    const totalCampaigns = summaryMeta.rows.length;

    const costResult = await query(
      `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1`,
      [companyId]
    );
    const costs = costResult.rows[0] || {};

    const successRate = totalSent > 0
      ? ((totalSuccess / totalSent) * 100).toFixed(1)
      : '0';

    return res.json({
      period: yearMonth,
      summary: {
        totalCampaigns,
        totalSent,
        totalSuccess,
        totalFail,
        successRate: parseFloat(successRate),
      },
      costs: {
        perSms: parseFloat(costs.cost_per_sms) || DEFAULT_COSTS.sms,
        perLms: parseFloat(costs.cost_per_lms) || DEFAULT_COSTS.lms,
        perMms: parseFloat(costs.cost_per_mms) || DEFAULT_COSTS.mms,
        perKakao: parseFloat(costs.cost_per_kakao) || DEFAULT_COSTS.kakao,
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

    // ★ D98: draft도 목록에 포함 (실패로 표시 — 직원 요청)
    // ★ D120: 미확정 draft는 DELETE되므로 sent_count=0 제외 조건 불필요. cancelled 전부 표시.

    if (userType === 'company_user') {
      whereClause += ` AND created_by = $${paramIndex++}`;
      params.push(userId);
    }

    if (userType === 'company_admin' && req.query.filter_user_id) {
      whereClause += ` AND created_by = $${paramIndex++}`;
      params.push(req.query.filter_user_id);
    }

    // ★ D143 (2026-05-04, shiseido6 신고): 발송결과 출력 기준 = 발송일시
    //   발송 완료(sent_at) 우선 → 예약 대기(scheduled_at) → 미발송(created_at) 폴백
    //   정산이 발송일 기준이므로 4/30 등록 + 5/7 예약 캠페인은 5월 결과에 표시되어야 함
    const campDr = buildPeriodFilter('COALESCE(sent_at, scheduled_at, created_at)', {
      fromDate: fromDate ? String(fromDate) : undefined,
      toDate: toDate ? String(toDate) : undefined,
      yearMonth: (!fromDate || !toDate) ? (from ? String(from) : undefined) : undefined,
    }, paramIndex);
    whereClause += campDr.sql;
    params.push(...campDr.params);
    paramIndex = campDr.nextIndex;

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
      .replace(/\bstatus\b/g, 'c.status')
      .replace(/\bsent_count\b/g, 'c.sent_count')
      .replace(/\bsent_at\b/g, 'c.sent_at')
      .replace(/\bcreated_at\b/g, 'c.created_at')
      .replace(/\bmessage_type\b/g, 'c.message_type');

    // ★ D144: PG c.sent_count/success_count/fail_count + success_rate 캐시 의존 제거.
    //   페이지된 캠페인을 PG에서 메타만 SELECT → MySQL 카운트 매핑 + success_rate JS 계산.
    const result = await query(
      `SELECT
        c.id, c.company_id, c.created_by, c.campaign_name, c.message_type, c.message_content, c.send_type, c.status,
        c.target_count,
        c.is_ad, c.scheduled_at, c.sent_at, c.created_at, c.send_channel, c.callback_number,
        c.subject, c.message_subject, c.mms_image_paths,
        (c.created_at AT TIME ZONE 'Asia/Seoul')::date as created_date_kst,
        c.cancelled_by_type, c.cancel_reason,
        u.login_id as created_by_name,
        ${CAMPAIGN_OPT080_SELECT_EXPR}
       FROM campaigns c
       LEFT JOIN users u ON c.created_by = u.id
       ${CAMPAIGN_OPT080_LEFT_JOIN}
       ${aliasedWhere}
       ORDER BY c.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    const campListSmsMap = await aggregateSmsCountsByCampaign(result.rows);
    const campListKakaoMap = await kakaoBatchAggByGroup(result.rows.map((c: any) => c.id));
    const campListSentTimeMap = await aggregateSmsSendTimesByCampaign(result.rows);
    const campaigns = result.rows.map((c: any) => {
      const sms = campListSmsMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0 };
      const kakao = campListKakaoMap.get(c.id) || { total: 0, success: 0, fail: 0, pending: 0 };
      const sent = Number(sms.total_count || 0) + kakao.total;
      const success = Number(sms.success_count || 0) + kakao.success;
      const fail = Number(sms.fail_count || 0) + kakao.fail;
      return {
        ...c,
        sent_count: sent,
        success_count: success,
        fail_count: fail,
        success_rate: sent > 0 ? Math.round((success / sent) * 1000) / 10 : 0,
        sent_at: campListSentTimeMap.get(c.id) ?? c.sent_at,
      };
    });

    return res.json({
      campaigns,
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
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    // ★ userId 전달: 사용자별 라인그룹 테이블 포함 조회
    const companyTables = await getCompanySmsTablesWithLogs(companyId, userId);

    const userType = req.user?.userType;
    // ★ B2: opt_out_080_number 포함을 위해 LEFT JOIN
    let detailQuery = `SELECT c.*, ${CAMPAIGN_OPT080_SELECT_EXPR}
                       FROM campaigns c
                       ${CAMPAIGN_OPT080_LEFT_JOIN}
                       WHERE c.id = $1 AND c.company_id = $2`;
    const detailParams: any[] = [id, companyId];
    // ★ 사용자는 본인 캠페인만 조회 가능
    if (userType === 'company_user' && userId) {
      detailQuery += ` AND c.created_by = $3`;
      detailParams.push(userId);
    }
    const campaignResult = await query(detailQuery, detailParams);

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }

    const campaign = campaignResult.rows[0];

    const runsResult = await query(
      `SELECT * FROM campaign_runs WHERE campaign_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    const sendChannel = campaign.send_channel || 'sms';
    const isCompleted = ['completed', 'cancelled'].includes(campaign.status);

    // ===== Redis 캐시 확인 (대량 발송 차트 데이터 최적화) =====
    const chartCacheKey = `result_chart:${companyId}:${id}`;
    let errorStats: Record<string, number> = {};
    let carrierStats: Record<string, number> = {};
    let cacheHit = false;

    try {
      const cached = await redis.get(chartCacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        errorStats = parsed.errorStats || {};
        carrierStats = parsed.carrierStats || {};
        cacheHit = true;
      }
    } catch (e) { /* Redis 실패 시 DB 직접 조회 */ }

    if (!cacheHit) {
      // ===== SMS 결과 집계 — UNION ALL + GROUP BY (단일 쿼리 2개) =====
      if (sendChannel === 'sms' || sendChannel === 'both') {
        // 실패사유별 집계
        const statusAgg = await smsUnionGroupBy(
          companyTables, 'status_code', 'WHERE app_etc1 = ?', [id]
        );

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

      // ===== Redis 캐시 저장 (완료 캠페인: 24h / 진행중: 5min) =====
      try {
        const ttl = isCompleted ? CACHE_TTL.resultChartCompleted : CACHE_TTL.resultChartActive;
        await redis.setex(chartCacheKey, ttl, JSON.stringify({ errorStats, carrierStats }));
      } catch (e) { /* Redis 실패 시 무시 — 다음 요청에서 재조회 */ }
    }

    // ★ D144: campaign.success_count/fail_count/sent_at 캐시 의존 제거 → MySQL 직접
    const chartSmsMap = await aggregateSmsCountsByCampaign([campaign]);
    const chartKakaoMap = await kakaoBatchAggByGroup([campaign.id]);
    const chartSentTimeMap = await aggregateSmsSendTimesByCampaign([campaign]);
    const chSms = chartSmsMap.get(campaign.id) || { total_count: 0, success_count: 0, fail_count: 0 };
    const chKakao = chartKakaoMap.get(campaign.id) || { total: 0, success: 0, fail: 0, pending: 0 };
    campaign.success_count = Number(chSms.success_count || 0) + chKakao.success;
    campaign.fail_count = Number(chSms.fail_count || 0) + chKakao.fail;
    campaign.sent_count = Number(chSms.total_count || 0) + chKakao.total;
    const chSentTime = chartSentTimeMap.get(campaign.id);
    if (chSentTime) campaign.sent_at = chSentTime;

    return res.json({
      campaign,
      runs: runsResult.rows,
      summary: null,
      charts: {
        successFail: {
          success: campaign.success_count || 0,
          fail: campaign.fail_count || 0,
          // D183 fix: 사용자 관점 성공률 영역 = success / sent (대기 영역 포함 분모) — frontend 영역 정합
          sent: campaign.sent_count || 0,
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
    const userId = req.user?.userId;
    const { id } = req.params;
    const { searchType, searchValue, status, page = 1, limit = 100 } = req.query;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const offset = (pageNum - 1) * limitNum;

    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    // ★ userId 전달: 사용자별 라인그룹 테이블 포함 조회
    const msgTables = await getCompanySmsTablesWithLogs(companyId, userId);

    // 캠페인 채널+상태 확인
    const campResult = await query('SELECT send_channel, status FROM campaigns WHERE id = $1 AND company_id = $2', [id, companyId]);
    const sendChannel = campResult.rows[0]?.send_channel || 'sms';
    const campStatus = campResult.rows[0]?.status || '';

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
        // ★ D89: 전화번호/회신번호 검색 시 하이픈 제거 (DB에 하이픈 없이 저장)
        const cleanValue = (searchType === 'phone' || searchType === 'callback')
          ? String(searchValue).trim().replace(/-/g, '')
          : String(searchValue).trim();
        const sv = `%${cleanValue}%`;
        if (searchType === 'phone') { smsWhere += ' AND REPLACE(dest_no, \'-\', \'\') LIKE ?'; smsBaseParams.push(sv); }
        else if (searchType === 'callback') { smsWhere += ' AND REPLACE(call_back, \'-\', \'\') LIKE ?'; smsBaseParams.push(sv); }
        else if (searchType === 'content') { smsWhere += ' AND msg_contents LIKE ?'; smsBaseParams.push(sv); }
      }

      if (status === 'success') smsWhere += ` AND status_code IN (${SUCCESS_CODES.join(',')})`;
      else if (status === 'fail') smsWhere += ` AND status_code NOT IN (${[...SUCCESS_CODES, ...PENDING_CODES].join(',')})`;

      const smsFields = SMS_DETAIL_FIELDS;

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
        // ★ D89: 전화번호 검색 시 하이픈 제거
        const cleanValue = searchType === 'phone'
          ? String(searchValue).trim().replace(/-/g, '')
          : String(searchValue).trim();
        const sv = `%${cleanValue}%`;
        if (searchType === 'phone') { kakaoWhere += ' AND REPLACE(PHONE_NUMBER, \'-\', \'\') LIKE ?'; kakaoBaseParams.push(sv); }
        else if (searchType === 'content') { kakaoWhere += ' AND MESSAGE LIKE ?'; kakaoBaseParams.push(sv); }
        // callback 검색은 카카오에 미적용 (원래 동작과 동일)
      }

      if (status === 'success') kakaoWhere += ` AND REPORT_CODE = '0000'`;
      else if (status === 'fail') kakaoWhere += ` AND REPORT_CODE != '0000' AND STATUS IN ('3','4')`;

      // 카카오 통합 필드 (SMS와 UNION ALL 호환 — 동일 컬럼 이름으로 매핑)
      // ★ D124: 수신확인(repmsg_recvtm) 제거 — SMS_DETAIL_FIELDS와 스키마 일치
      const kakaoFields = `ID AS seqno, PHONE_NUMBER AS dest_no, '-' AS call_back, 'KAKAO' AS msg_type,
        MESSAGE AS msg_contents,
        CASE WHEN REPORT_CODE='0000' THEN 1800 WHEN STATUS='1' THEN 100 ELSE 9999 END AS status_code,
        '카카오' AS mob_company,
        REQUEST_DATE AS sendreq_time, RESPONSE_DATE AS mobsend_time,
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

    // ===== COUNT — Redis 캐시 + 단일 쿼리 (필터 없는 전체 카운트는 캐시) =====
    const hasFilter = !!(searchValue || (status && status !== 'all'));
    const countCacheKey = hasFilter ? '' : `result_msg_count:${companyId}:${id}`;
    let total = 0;
    let countCacheHit = false;

    if (countCacheKey) {
      try {
        const cachedCount = await redis.get(countCacheKey);
        if (cachedCount) { total = parseInt(cachedCount); countCacheHit = true; }
      } catch (e) { /* Redis 실패 시 DB 직접 조회 */ }
    }

    if (!countCacheHit) {
      const countSql = `SELECT SUM(cnt) AS total FROM (${countSubqueries.join(' UNION ALL ')}) AS _c`;
      const countRows = await mysqlQuery(countSql, countParams) as any[];
      total = parseInt(countRows[0]?.total || '0');

      // 필터 없는 전체 카운트 캐시 (완료 캠페인: 24h / 진행중: 5min)
      if (countCacheKey) {
        try {
          const isComp = ['completed', 'cancelled'].includes(campStatus);
          const ttl = isComp ? CACHE_TTL.resultChartCompleted : CACHE_TTL.resultChartActive;
          await redis.setex(countCacheKey, ttl, String(total));
        } catch (e) { /* Redis 실패 시 무시 */ }
      }
    }

    // ===== DATA — 단일 쿼리, MySQL이 정렬+페이징 =====
    // ★ LOG 테이블 스키마 차이 시 전체 UNION ALL 실패 → LIVE 테이블만 재시도
    // ★ D150-4 (2026-05-09) PDF #1: dest_no tie-breaker 추가 — 동일 _sort_time row가
    //   페이지 사이에 비결정적으로 분배되어 분류 카운트 차이 발생 (폴라초이스 14df97e7
    //   16,106건이 모두 sendreq_time='2026-05-06 11:00:00' 단일 시각). dest_no는 CT-14
    //   deduplicate로 한 캠페인 내 unique → 결정적 정렬 보장.
    const dataSql = `${dataSubqueries.join(' UNION ALL ')} ORDER BY _sort_time DESC, dest_no ASC LIMIT ? OFFSET ?`;
    dataParams.push(limitNum, offset);
    let messages: any[];
    try {
      messages = await mysqlQuery(dataSql, dataParams) as any[];
    } catch (unionErr) {
      console.warn('[messages] UNION ALL 실패 — LOG 테이블 제외 후 LIVE 테이블만 재시도:', (unionErr as Error).message);
      // LIVE 테이블만으로 재구성 (LOG 테이블 패턴: SMSQ_SEND_XX_YYYYMM)
      const logPattern = /_\d{6}$/;
      const liveOnlyDataSubs: string[] = [];
      const liveOnlyParams: any[] = [];
      const smsBaseParams: any[] = [id];
      if (searchType && searchValue) {
        // ★ D89: 전화번호/회신번호 검색 시 하이픈 제거
        const cleanValue = (searchType === 'phone' || searchType === 'callback')
          ? String(searchValue).trim().replace(/-/g, '')
          : String(searchValue).trim();
        const sv = `%${cleanValue}%`;
        if (['phone', 'callback', 'content'].includes(String(searchType))) smsBaseParams.push(sv);
      }

      const smsFields = SMS_DETAIL_FIELDS;
      let smsWhere = 'WHERE app_etc1 = ?';
      if (searchType && searchValue) {
        // ★ D89: 전화번호/회신번호 검색 시 하이픈 제거 + REPLACE
        const cleanValue = (searchType === 'phone' || searchType === 'callback')
          ? String(searchValue).trim().replace(/-/g, '')
          : String(searchValue).trim();
        const sv = `%${cleanValue}%`;
        if (searchType === 'phone') smsWhere += ' AND REPLACE(dest_no, \'-\', \'\') LIKE ?';
        else if (searchType === 'callback') smsWhere += ' AND REPLACE(call_back, \'-\', \'\') LIKE ?';
        else if (searchType === 'content') smsWhere += ' AND msg_contents LIKE ?';
      }
      if (status === 'success') smsWhere += ` AND status_code IN (${SUCCESS_CODES.join(',')})`;
      else if (status === 'fail') smsWhere += ` AND status_code NOT IN (${[...SUCCESS_CODES, ...PENDING_CODES].join(',')})`;

      for (const t of msgTables) {
        if (logPattern.test(t)) continue; // LOG 테이블 스킵
        liveOnlyDataSubs.push(`(SELECT ${smsFields} FROM ${t} ${smsWhere})`);
        liveOnlyParams.push(...smsBaseParams);
      }

      if (liveOnlyDataSubs.length > 0) {
        // ★ D150-4 (2026-05-09) PDF #1: dest_no tie-breaker 추가 (591번과 동일 사고 패턴)
        const fallbackSql = `${liveOnlyDataSubs.join(' UNION ALL ')} ORDER BY _sort_time DESC, dest_no ASC LIMIT ? OFFSET ?`;
        liveOnlyParams.push(limitNum, offset);
        messages = await mysqlQuery(fallbackSql, liveOnlyParams) as any[];
      } else {
        messages = [];
      }
    }

    // sms-result-map.ts 기반 해석값 추가 (프론트 하드코딩 제거용)
    const enrichedMessages = messages.map((m: any) => ({
      ...m,
      status_label: getStatusLabel(m.status_code),
      status_type: getStatusType(m.status_code),
      carrier_label: m._channel === 'kakao' ? '카카오' : getCarrierLabel(m.mob_company),
    }));

    return res.json({
      messages: enrichedMessages,
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
    const userId = req.user?.userId;
    const { id } = req.params;
    if (!companyId) return res.status(403).json({ error: '권한이 필요합니다.' });

    const campaignResult = await query(
      `SELECT campaign_name, send_channel, created_at FROM campaigns WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    if (campaignResult.rows.length === 0) return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    const sendChannel = campaignResult.rows[0].send_channel || 'sms';
    // ★ D124: "전송요청시간(=등록일시)"은 한줄로에서 발송을 건 시간 = 캠페인 created_at
    //   (sendreq_time은 QTmsg 큐 INSERT 시간 → 발송 직전/예약 시점이라 의미 다름)
    const campaignCreatedAt = campaignResult.rows[0].created_at;

    // statusMap, carrierMap → sms-result-map.ts의 getStatusLabel(), getCarrierLabel() 사용

    // ===== UNION ALL 서브쿼리 빌드 =====
    const subqueries: string[] = [];
    const baseParams: any[] = [];

    if (sendChannel === 'sms' || sendChannel === 'both') {
      const exportTables = await getCompanySmsTablesWithLogs(companyId, userId);
      const smsFields = SMS_EXPORT_FIELDS;
      for (const t of exportTables) {
        subqueries.push(`(SELECT ${smsFields} FROM ${t} WHERE app_etc1 = ?)`);
        baseParams.push(id);
      }
    }

    if (sendChannel === 'kakao' || sendChannel === 'both') {
      // ★ D124: 엑셀은 전송요청/발송/수신확인 3컬럼 유지 (UI 발송내역만 수신확인 제거)
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
    // ★ D124: 웹 발송상세 UI와 컬럼명·순서 통일 (등록일시/발송일시 — 캠페인 created_at 기준)
    // ★ D131: 수신확인시간 컬럼 자체 제거 (서수란 팀장 제보 — B10에서 값만 제거됐고 헤더가 남아있었음)
    const BOM = '\uFEFF';
    const headers = '수신번호,회신번호,메시지내용,등록일시,발송일시,전송결과,결과코드,통신사,메시지유형';

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
      // ★ D150-4 (2026-05-09) PDF #1 root cause: 폴라초이스 14df97e7 16,106건이 모두
      //   sendreq_time='2026-05-06 11:00:00' 단일 시각 → ORDER BY tie-breaker 없으면
      //   청크 1(OFFSET 0)과 청크 2(OFFSET 10000) 사이에 동일 row가 비결정적으로 분배
      //   → 총 건수는 동일하지만 분류별 row 수가 화면 요약(SQL COUNT)과 어긋남
      //   (직원 신고: 화면 15,450/656 vs 엑셀 15,470/636).
      //   해결: dest_no ASC tie-breaker 추가 (CT-14 deduplicate로 한 캠페인 내 unique).
      const rows = await mysqlQuery(
        `${baseSql} ORDER BY sendreq_time ASC, dest_no ASC LIMIT ? OFFSET ?`,
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
          statusDisplay = isSuccess(m.status_code)
            ? '카카오성공'
            : `카카오실패(${m.report_code_raw || '미수신'})`;
          carrierDisplay = '카카오';
        } else {
          msgTypeDisplay = m.msg_type === 'S' ? 'SMS' : m.msg_type === 'L' ? 'LMS' : m.msg_type;
          statusDisplay = getStatusLabel(m.status_code);
          carrierDisplay = getCarrierLabel(m.mob_company);
        }

        // ★ D131: 헤더 순서(수신번호→메시지유형)와 일치 — 수신확인시간 컬럼 제거됨
        res.write([
          m.dest_no,
          m.call_back,
          `"${(m.msg_contents || '').replace(/"/g, '""')}"`,
          formatCsvDateTime(campaignCreatedAt), // 등록일시 = 캠페인 created_at (모든 행 동일)
          formatCsvDateTime(m.mobsend_time),    // 발송일시
          statusDisplay,
          m.status_code,
          carrierDisplay,
          msgTypeDisplay,                       // 메시지유형 (SMS/LMS/MMS/카카오) — 엑셀 전용
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
