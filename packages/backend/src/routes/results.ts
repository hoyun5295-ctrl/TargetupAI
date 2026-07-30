import { Request, Response, Router } from 'express';
import { mysqlQuery, query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import {
  getCompanySmsTablesWithLogs,
  smsCountAll as smsUnionCount,
  smsSelectAll,
  smsGroupByAll as smsUnionGroupBy,
} from '../utils/sms-queue';
// ★ 2026-07-30 브랜드 SMSQ 합류(msg_type='F') — 채널 분기 판정은 CT 목록 하나만 쓴다
import { BRAND_CAMPAIGN_CHANNELS } from '../utils/billing-types';
import { STATUS_CODE_MAP, CARRIER_MAP, SUCCESS_CODES, PENDING_CODES, getStatusLabel, getStatusType, getCarrierLabel, getSendTypeLabel, getQueueRowStatus, getDisplayContents } from '../utils/sms-result-map';
import { DEFAULT_COSTS, getCompanyCosts, redis, CACHE_TTL } from '../config/defaults';
import { buildDateRangeFilter, buildPeriodFilter, STAT_DATE_EXPR, STAT_STARTED_GUARD, aggregateSmsCountsByCampaign, aggregateSmsSendTimesByCampaign } from '../utils/stats-aggregation';
import { computeDisplayCounts } from '../utils/sms-table-split';
import { CAMPAIGN_OPT080_SELECT_EXPR, CAMPAIGN_OPT080_LEFT_JOIN } from '../utils/unsubscribe-helper';
import { buildCampaignListCsv, channelPlainLabel, CampaignCsvRow } from '../utils/campaign-list-csv';
// ★ 2026-07-23: 에이전트(agent·both) 회사 발송결과에 엔진 통계 유형별 병행 표시
import { queryPayAgentByType, isPayStatsConfigured } from '../utils/pay-stats';

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
  '' AS resend_type, '' AS resend_report_code,
  IFNULL(k_template_code, '') AS k_template_code,
  IFNULL(k_next_type, '') AS k_next_type,
  IFNULL(k_oriseq, 0) AS k_oriseq,
  (sendreq_time > NOW()) AS is_future`;

/** 엑셀 export용 SMS 필드 (seqno 제외) — 엑셀 2컬럼 유지: 전송요청/발송 (B10: 수신확인 제거) */
const SMS_EXPORT_FIELDS = `dest_no, call_back, msg_type, msg_contents, status_code, mob_company,
  sendreq_time,
  DATE_ADD(mobsend_time, INTERVAL 9 HOUR) AS mobsend_time,
  'sms' AS _channel, NULL AS report_code_raw, IFNULL(k_oriseq, 0) AS k_oriseq,
  (sendreq_time > NOW()) AS is_future`;

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
    
    // ★ D144: PG sent_count/success_count/fail_count 캐시 의존 제거 (진행 중 캠페인은 MySQL 직접).
    // ★ D228+ (2026-05-30): 완료 캠페인(result_final=true)은 PG 캐시값 그대로 읽어 MySQL 집계 제거.
    //   result_final/sent/success/fail을 함께 SELECT → 완료분은 PG, 진행 중분만 MySQL.
    let summaryQuery = `SELECT
        c.id, c.company_id, c.created_by, c.target_count,
        c.sent_count, c.success_count, c.fail_count, c.result_final
       FROM campaigns c
       WHERE c.company_id = $1`;

    const summaryParams: any[] = [companyId];

    // ★ D98: draft/cancelled도 실패로 카운트 (목록에서 제외하지 않음)
    summaryQuery += ` AND c.status NOT IN ('cancelled')`;
    // ★ 발송 시작된 캠페인만 (전송시각 미도래 예약 제외) — Harold 명시 2026-06-09
    summaryQuery += ` AND ${STAT_STARTED_GUARD}`;

    // ★ D143 (2026-05-04, shiseido6 신고): 발송결과 출력 기준 = 발송일시
    //   발송 완료(sent_at) 우선 → 예약 대기(scheduled_at) → 미발송(created_at) 폴백
    //   정산이 발송일 기준이므로 4/30 등록 + 5/7 예약 캠페인은 5월 결과에 표시되어야 함
    const summaryDr = buildPeriodFilter(STAT_DATE_EXPR, {
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
    // ★ D228+ 발송결과 속도: 진행 중(result_final=false)만 MySQL 실시간 집계.
    //   완료 캠페인은 PG 캐시(워커 확정값 — SMS+카카오 합산 저장됨)를 그대로 합산.
    const summaryNonFinal = summaryMeta.rows.filter((c: any) => !c.result_final);
    // ★ 2026-07-30: 브랜드 행이 SMSQ(msg_type='F')로 합류 — SMS 집계가 전 채널을 담는다(별도 카카오 합산 폐기).
    const summarySmsMap = await aggregateSmsCountsByCampaign(summaryNonFinal);

    let totalSent = 0, totalSuccess = 0, totalFail = 0, totalTarget = 0, totalPending = 0;
    for (const c of summaryMeta.rows) {
      totalTarget += Number(c.target_count || 0);
      if (c.result_final) {
        const dc = computeDisplayCounts(true, c.sent_count, Number(c.success_count || 0), Number(c.fail_count || 0), 0);
        totalSent += dc.sent; totalSuccess += dc.success; totalFail += dc.fail; totalPending += dc.pending;
        continue;
      }
      const sms = summarySmsMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0 };
      const s = Number(sms.success_count || 0);
      const f = Number(sms.fail_count || 0);
      const tot = Number(sms.total_count || 0);
      const dc = computeDisplayCounts(false, c.sent_count, s, f, Math.max(0, tot - s - f));
      totalSent += dc.sent; totalSuccess += dc.success; totalFail += dc.fail; totalPending += dc.pending;
    }
    const totalCampaigns = summaryMeta.rows.length;

    const costResult = await query(
      `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, unit_price_basis FROM companies WHERE id = $1`,
      [companyId]
    );
    // ★ 2026-07-26 화면 비용은 고객이 실제로 지불하는 금액(부가세 포함)이다 — CT가 기준을 해석한다.
    const costs = getCompanyCosts(costResult.rows[0] || {});

    const successRate = totalSent > 0
      ? ((totalSuccess / totalSent) * 100).toFixed(1)
      : '0';

    // ★ 2026-07-23: 에이전트(agent·both) 회사 — 엔진 발송을 유형(SMS/LMS/MMS/카카오)별로 병행 반환.
    //   웹 캠페인 요약은 불변. env 미설정·미연결·실패 = agentByType 빈 배열(조용한 폴백).
    //   ★ 격리: 에이전트 통계는 회사 전체 집계(사용자별 귀속 없음)라 관리자 전용 — company_user(담당자)는
    //     웹이 created_by로 격리되므로 에이전트 축도 제외. admin이 특정 사용자 필터 중이면 그 사용자 관점이라 미표시.
    let agentSummary: any = null;
    let agentByType: any[] = [];
    if (isPayStatsConfigured() && userType !== 'company_user' && !req.query.filter_user_id) {
      const ut = await query(`SELECT usage_type FROM companies WHERE id = $1`, [companyId]);
      const usageType = ut.rows[0]?.usage_type || 'web';
      if (usageType === 'agent' || usageType === 'both') {
        let aStart = fromDate ? String(fromDate) : undefined;
        let aEnd = toDate ? String(toDate) : undefined;
        if (!aStart || !aEnd) {
          const y = yearMonth.slice(0, 4), m = yearMonth.slice(4, 6);
          const last = new Date(Number(y), Number(m), 0).getDate();
          aStart = `${y}-${m}-01`;
          aEnd = `${y}-${m}-${String(last).padStart(2, '0')}`;
        }
        const at = await queryPayAgentByType({ companyId, startDate: aStart, endDate: aEnd });
        if (at) { agentSummary = at.summary; agentByType = at.byType; }
      }
    }

    return res.json({
      period: yearMonth,
      summary: {
        totalCampaigns,
        totalSent,
        totalSuccess,
        totalFail,
        totalPending,
        successRate: parseFloat(successRate),
      },
      costs: {
        perSms: costs.sms,
        perLms: costs.lms,
        perMms: costs.mms,
        perKakao: costs.kakao,
      },
      // ★ 2026-07-23 에이전트(엔진) 발송 유형별 (agent·both만 채워짐)
      agent: { summary: agentSummary, byType: agentByType },
    });
  } catch (error: any) {
    // ★ D228+ db_alter_safety_net: result_final 등 신규 컬럼 미마이그레이션 시 500 대신 503 안내.
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        error: 'DB 마이그레이션 필요 — 운영자에게 campaigns ALTER(result_final/result_synced_at) 실행 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
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
    // ★ D227+-3 (2026-05-28 영업팀장 박성용 신고 fix): from/to/fromDate/toDate 모두 누락 시 default 7일 한정
    //   주인님 명시 = "일주일만 보여주고 결과 제대로" → 7일 default + PG 인덱스 영역 양쪽 적용
    let effectiveFromDate = fromDate ? String(fromDate) : undefined;
    let effectiveToDate = toDate ? String(toDate) : undefined;
    const effectiveYearMonth = from ? String(from) : undefined;
    if (!effectiveFromDate && !effectiveToDate && !effectiveYearMonth) {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      effectiveFromDate = sevenDaysAgo.toISOString().split('T')[0];
      effectiveToDate = today.toISOString().split('T')[0];
    }
    const campDr = buildPeriodFilter('COALESCE(scheduled_at, sent_at)', {
      fromDate: effectiveFromDate,
      toDate: effectiveToDate,
      yearMonth: (!effectiveFromDate || !effectiveToDate) ? effectiveYearMonth : undefined,
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
        c.sent_count, c.success_count, c.fail_count, c.result_final,
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

    // ★ D228+ 발송결과 속도: 진행 중(result_final=false)만 MySQL 집계 3종. 완료분은 PG 캐시.
    const campListNonFinal = result.rows.filter((c: any) => !c.result_final);
    // ★ 2026-07-30: 브랜드 행이 SMSQ(msg_type='F')로 합류 — SMS 집계가 전 채널을 담는다.
    const campListSmsMap = await aggregateSmsCountsByCampaign(campListNonFinal);
    const campListSentTimeMap = await aggregateSmsSendTimesByCampaign(campListNonFinal);
    const campaigns = result.rows.map((c: any) => {
      if (c.result_final) {
        // PG 캐시 — 6h 경과 완료 캠페인 (워커 확정값). 대기는 정의상 0.
        const dc = computeDisplayCounts(true, c.sent_count, Number(c.success_count || 0), Number(c.fail_count || 0), 0);
        return {
          ...c,
          sent_count: dc.sent,
          success_count: dc.success,
          fail_count: dc.fail,
          pending_count: dc.pending,
          success_rate: dc.sent > 0 ? Math.round((dc.success / dc.sent) * 1000) / 10 : 0,
          sent_at: c.sent_at,
        };
      }
      const sms = campListSmsMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0 };
      const success = Number(sms.success_count || 0);
      const fail = Number(sms.fail_count || 0);
      const total = Number(sms.total_count || 0);
      const dc = computeDisplayCounts(false, c.sent_count, success, fail, Math.max(0, total - success - fail));
      return {
        ...c,
        sent_count: dc.sent,
        success_count: dc.success,
        fail_count: dc.fail,
        pending_count: dc.pending,
        success_rate: dc.sent > 0 ? Math.round((dc.success / dc.sent) * 1000) / 10 : 0,
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
  } catch (error: any) {
    // ★ D228+ db_alter_safety_net: result_final 등 신규 컬럼 미마이그레이션 시 500 대신 503 안내.
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        error: 'DB 마이그레이션 필요 — 운영자에게 campaigns ALTER(result_final/result_synced_at) 실행 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('캠페인 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ======================================================================
// GET /api/v1/results/campaigns/export — 채널통합조회 목록 CSV (기간 전체)
//   /campaigns(203) 조회·필터를 LIMIT만 빼고 재사용 + 카운트 + campaign-list-csv 빌더.
//   ★ 신규 SQL 컬럼 0 — /campaigns와 동일 기존 컬럼만. :id 라우트보다 먼저 둬야 매칭 정확.
// ======================================================================
router.get('/campaigns/export', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }
    const { from, fromDate, toDate, sendType, sender } = req.query;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    let whereClause = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    let paramIndex = 2;

    // 권한: company_user는 본인 발송분만 (화면 권한과 동일)
    if (userType === 'company_user') {
      whereClause += ` AND created_by = $${paramIndex++}`;
      params.push(userId);
    }

    // 기간 필터 — /campaigns와 동일 (발송일 우선: COALESCE(sent_at, scheduled_at, created_at)). 누락 시 7일.
    let effectiveFromDate = fromDate ? String(fromDate) : undefined;
    let effectiveToDate = toDate ? String(toDate) : undefined;
    const effectiveYearMonth = from ? String(from) : undefined;
    if (!effectiveFromDate && !effectiveToDate && !effectiveYearMonth) {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      effectiveFromDate = sevenDaysAgo.toISOString().split('T')[0];
      effectiveToDate = today.toISOString().split('T')[0];
    }
    const campDr = buildPeriodFilter('COALESCE(scheduled_at, sent_at)', {
      fromDate: effectiveFromDate,
      toDate: effectiveToDate,
      yearMonth: (!effectiveFromDate || !effectiveToDate) ? effectiveYearMonth : undefined,
    }, paramIndex);
    whereClause += campDr.sql;
    params.push(...campDr.params);
    paramIndex = campDr.nextIndex;

    // 화면 필터 정합 — 유형(filterType: ai/direct = send_type), 발송자(filterSender = u.login_id)
    if (sendType === 'direct') {
      whereClause += ` AND send_type = $${paramIndex++}`;
      params.push('direct');
    } else if (sendType === 'ai') {
      whereClause += ` AND send_type <> $${paramIndex++}`;
      params.push('direct');
    }
    let senderFilter = '';
    if (sender && sender !== 'all' && typeof sender === 'string') {
      senderFilter = ` AND u.login_id = $${paramIndex++}`;
      params.push(sender);
    }

    const aliasedWhere = whereClause
      .replace(/company_id/g, 'c.company_id')
      .replace(/created_by/g, 'c.created_by')
      .replace(/\bstatus\b/g, 'c.status')
      .replace(/\bsent_count\b/g, 'c.sent_count')
      .replace(/\bsent_at\b/g, 'c.sent_at')
      .replace(/\bcreated_at\b/g, 'c.created_at')
      .replace(/\bsend_type\b/g, 'c.send_type');

    // ★ LIMIT/OFFSET 없음 — 조회 기간 전체. 컬럼은 /campaigns(281)와 동일 기존 컬럼.
    const result = await query(
      `SELECT
        c.id, c.company_id, c.created_by, c.message_type, c.message_content, c.status,
        c.target_count, c.sent_count, c.success_count, c.fail_count, c.result_final,
        c.scheduled_at, c.sent_at, c.created_at, c.send_channel,
        u.login_id as created_by_name
       FROM campaigns c
       LEFT JOIN users u ON c.created_by = u.id
       ${aliasedWhere}${senderFilter}
       ORDER BY c.created_at DESC`,
      params
    );

    // 카운트: 완료(result_final)는 PG 캐시, 진행 중만 MySQL 집계 (/campaigns와 동일 규칙)
    // ★ 2026-07-30: 브랜드 행이 SMSQ(msg_type='F')로 합류 — SMS 집계가 전 채널을 담는다.
    const nonFinal = result.rows.filter((c: any) => !c.result_final);
    const smsMap = await aggregateSmsCountsByCampaign(nonFinal);

    const fmtKst = (d: any) => d
      ? new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '';

    const csvRows: CampaignCsvRow[] = result.rows.map((c: any) => {
      let dc;
      if (c.result_final) {
        dc = computeDisplayCounts(true, c.sent_count, Number(c.success_count || 0), Number(c.fail_count || 0), 0);
      } else {
        const sms = smsMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0 };
        const cSuccess = Number(sms.success_count || 0);
        const cFail = Number(sms.fail_count || 0);
        const cTotal = Number(sms.total_count || 0);
        dc = computeDisplayCounts(false, c.sent_count, cSuccess, cFail, Math.max(0, cTotal - cSuccess - cFail));
      }
      const { sent, success, fail, pending } = dc;
      const rate = sent > 0 ? Math.round((success / sent) * 1000) / 10 : 0;
      return {
        message: String(c.message_content || ''),
        createdAt: fmtKst(c.created_at),
        sentAt: fmtKst(c.sent_at || c.scheduled_at),
        channel: channelPlainLabel(c.send_channel, c.message_type),
        sent, success, fail, pending, rate,
        sender: c.created_by_name || '',
      };
    });

    const csv = buildCampaignListCsv(csvRows);
    const filename = `발송결과_${effectiveFromDate || ''}_${effectiveToDate || ''}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    return res.send(csv);
  } catch (error: any) {
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        error: 'DB 마이그레이션 필요 — 운영자에게 campaigns ALTER 실행 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('발송결과 목록 엑셀 export 에러:', error);
    return res.status(500).json({ error: '다운로드에 실패했습니다.' });
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
      // ===== 결과 집계 — UNION ALL + GROUP BY (단일 쿼리 2개) =====
      // ★ 2026-07-30: 브랜드(kakao·kakao_brand)·알림톡도 SMSQ(app_etc1) 합류 — 전 채널 동일 경로.
      if (sendChannel === 'sms' || sendChannel === 'both' || sendChannel === 'alimtalk'
          || (BRAND_CAMPAIGN_CHANNELS as readonly string[]).includes(sendChannel)) {
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

      // (2026-07-30 재구축) 옛 카카오 IMC 집계 폐기 — 브랜드 행도 위 SMSQ status_code/mob_company
      //   집계에 포함된다. 대체발송 성공분은 k_oriseq>0 행으로 같은 집계에 잡힌다(알림톡과 동일 구조).

      // ===== Redis 캐시 저장 (완료 캠페인: 24h / 진행중: 5min) =====
      try {
        const ttl = isCompleted ? CACHE_TTL.resultChartCompleted : CACHE_TTL.resultChartActive;
        await redis.setex(chartCacheKey, ttl, JSON.stringify({ errorStats, carrierStats }));
      } catch (e) { /* Redis 실패 시 무시 — 다음 요청에서 재조회 */ }
    }

    // ★ D144: campaign.success_count/fail_count/sent_at 캐시 의존 제거 → MySQL 직접
    // ★ 2026-07-30: 브랜드 행이 SMSQ(msg_type='F')로 합류 — SMS 집계가 전 채널을 담는다.
    const chartSmsMap = await aggregateSmsCountsByCampaign([campaign]);
    const chartSentTimeMap = await aggregateSmsSendTimesByCampaign([campaign]);
    const chSms = chartSmsMap.get(campaign.id) || { total_count: 0, success_count: 0, fail_count: 0 };
    // ★ 2026-06-15 버그3: 전송 = max(적재 sent_count(PG), 성공+실패+대기) — 상세도 목록·요약·엑셀과 동일 정의
    const chSuccess = Number(chSms.success_count || 0);
    const chFail = Number(chSms.fail_count || 0);
    const chTotal = Number(chSms.total_count || 0);
    const chDc = computeDisplayCounts(!!campaign.result_final, campaign.sent_count, chSuccess, chFail, Math.max(0, chTotal - chSuccess - chFail));
    campaign.success_count = chDc.success;
    campaign.fail_count = chDc.fail;
    campaign.sent_count = chDc.sent;
    campaign.pending_count = chDc.pending;
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
          pending: campaign.pending_count || 0,
          // D183 (2026-05-20): 단축 URL 클릭 트래킹 — cdp_events 'message_click' 영역 집계
          clicks: Number(
            (
              await query(
                `SELECT COUNT(*)::int AS clicks
                 FROM cdp_events
                 WHERE company_id = $1::uuid
                   AND event_name = 'message_click'
                   AND properties->>'campaign_id' = $2`,
                [campaign.company_id, campaign.id],
              )
            ).rows[0]?.clicks || 0,
          ),
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
    // ★ D227+-3 (2026-05-28 사이트 다운 긴급 복구): campaigns 테이블 = alimtalk_template_code 컬럼 X (kakao_template_id uuid FK만 존재).
    //   옛 D227+ 영역 = 없는 컬럼 SELECT → SQL 에러 → 발송결과 endpoint 500 전체 다운 사고 정정.
    //   알림톡 templateCode = kakao_template_id JOIN 으로 안전 조회.
    const campResult = await query(
      `SELECT c.send_channel, c.status, kt.template_code AS alimtalk_template_code
       FROM campaigns c
       LEFT JOIN kakao_templates kt ON c.kakao_template_id = kt.id
       WHERE c.id = $1 AND c.company_id = $2`,
      [id, companyId],
    );
    const sendChannel = campResult.rows[0]?.send_channel || 'sms';
    const campStatus = campResult.rows[0]?.status || '';
    const campAlimtalkTemplateCode = campResult.rows[0]?.alimtalk_template_code || '';

    // ===== UNION ALL 서브쿼리 빌드 =====
    const dataSubqueries: string[] = [];
    const countSubqueries: string[] = [];
    const dataParams: any[] = [];
    const countParams: any[] = [];

    // ----- SMS 서브쿼리 (테이블 수만큼 UNION ALL) -----
    // ★ D225+ (2026-05-28 영업팀장 박성용 신고 fix): alimtalk 영역 추가 — 옛 흐름 = SMSQ_SEND msg_type='K' 영역 사용 + sendChannel='alimtalk' 분기 X → 발송 결과 안 messages 영역 0건 사고
    // ★ 2026-07-30: 브랜드(kakao·kakao_brand)도 SMSQ(msg_type='F') 합류 — 전 채널이 이 서브쿼리 하나로 조회된다.
    //   (재구축 전 kakao_brand는 어느 분기에도 없어 상세가 항상 0건이었다.)
    if (sendChannel === 'sms' || sendChannel === 'both' || sendChannel === 'alimtalk'
        || (BRAND_CAMPAIGN_CHANNELS as readonly string[]).includes(sendChannel)) {
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
      else if (status === 'substitute') smsWhere += ` AND k_oriseq > 0 AND msg_type IN ('L', 'S')`;

      const smsFields = SMS_DETAIL_FIELDS;

      // ★ 2026-06-13 속도: 테이블별 top-(offset+limit) 선잘라내기 — 일치 행 전체(본문 포함)를
      //   임시 테이블로 모은 뒤 정렬하던 구조가 대형 캠페인 상세 10초+의 잔여 병목 (admin 상세와 동일 fix).
      const innerLimit = limitNum + offset;
      for (const t of msgTables) {
        dataSubqueries.push(`(SELECT ${smsFields} FROM ${t} ${smsWhere} ORDER BY _sort_time DESC, dest_no ASC LIMIT ${innerLimit})`);
        countSubqueries.push(`SELECT COUNT(*) AS cnt FROM ${t} ${smsWhere}`);
        dataParams.push(...smsBaseParams);
        countParams.push(...smsBaseParams);
      }
    }

    // (2026-07-30 재구축) 옛 카카오 IMC 서브쿼리 폐기 — 브랜드 행은 위 SMS 서브쿼리(app_etc1)에 포함된다.

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
      else if (status === 'substitute') smsWhere += ` AND k_oriseq > 0 AND msg_type IN ('L', 'S')`;

      for (const t of msgTables) {
        if (logPattern.test(t)) continue; // LOG 테이블 스킵
        // ★ 2026-06-13 속도: 본 경로와 동일한 테이블 내부 선잘라내기
        liveOnlyDataSubs.push(`(SELECT ${smsFields} FROM ${t} ${smsWhere} ORDER BY _sort_time DESC, dest_no ASC LIMIT ${limitNum + offset})`);
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
    // ★ 2026-06-13: 발송 요청 시각이 미래인 대기 행 = "발송 예약" — 결과 대기와 구분 (Harold 지시)
    const enrichedMessages = messages.map((m: any) => {
      const rowStatus = getQueueRowStatus(Number(m.status_code), !!Number(m.is_future));
      return {
        ...m,
        // ★ 2026-07-30: 브랜드 행(msg_type='F')은 msg_contents가 JSON — 본문(MESSAGE)만 풀어 표시.
        msg_contents: getDisplayContents(m.msg_type, m.msg_contents),
        status_label: rowStatus.label,
        status_type: rowStatus.type,
        // 라벨은 msg_type 축(getSendTypeLabel 'F'=브랜드메시지) 단일.
        carrier_label: rowStatus.type === 'scheduled' ? '-' : getCarrierLabel(m.mob_company),
        send_type: getSendTypeLabel(m.msg_type, m.k_oriseq),
      };
    });

    // ★ D225+ (2026-05-28 영업팀장 박성용 신고 fix): 알림톡 발송 영역 = 응답 안 templateInfo 추가
    //   Harold 기대 = 전송 결과 상세 안 [템플릿코드] + [템플릿명] 확인 가능 의무
    // ★ D227+ (2026-05-28 재발 fix): 발송 X 영역 시 (messages 영역 0건) campaigns 안 alimtalk_template_code fallback 활용
    let alimtalkTemplateInfo: { code: string; name: string; status: string } | null = null;
    if (sendChannel === 'alimtalk') {
      // 1차 = messages 안 k_template_code 영역 (옛 D225+ fix 흐름)
      let firstTemplateCode = enrichedMessages.length > 0
        ? (enrichedMessages.find((m: any) => m.k_template_code)?.k_template_code || '')
        : '';
      // 2차 fallback = campaigns 안 alimtalk_template_code (옛 D227+ 재발 fix 흐름)
      if (!firstTemplateCode && campAlimtalkTemplateCode) {
        firstTemplateCode = campAlimtalkTemplateCode;
      }
      if (firstTemplateCode) {
        try {
          const tplResult = await query(
            `SELECT template_code, template_name, status FROM kakao_templates
             WHERE company_id = $1::uuid AND template_code = $2 LIMIT 1`,
            [companyId, firstTemplateCode],
          );
          if (tplResult.rows.length > 0) {
            alimtalkTemplateInfo = {
              code: tplResult.rows[0].template_code,
              name: tplResult.rows[0].template_name || '',
              status: tplResult.rows[0].status || '',
            };
          } else {
            // PG 미발견 — MySQL 큐의 templateCode만 응답 (검수상태는 빈 값)
            alimtalkTemplateInfo = { code: firstTemplateCode, name: '', status: '' };
          }
        } catch (tplErr) {
          console.warn('[results messages] 알림톡 템플릿 조회 실패 — code만 응답:', tplErr);
          alimtalkTemplateInfo = { code: firstTemplateCode, name: '', status: '' };
        }
      }
    }

    return res.json({
      messages: enrichedMessages,
      alimtalkTemplateInfo,
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

    // ★ 발송내역 화면 필터(전체/성공/실패/대체) 반영 — 보이는 그대로 다운로드
    const exportStatus = (req.query.status as string) || '';
    let smsStatusWhere = '';
    if (exportStatus === 'success') smsStatusWhere = ` AND status_code IN (${SUCCESS_CODES.join(',')})`;
    else if (exportStatus === 'fail') smsStatusWhere = ` AND status_code NOT IN (${[...SUCCESS_CODES, ...PENDING_CODES].join(',')})`;
    else if (exportStatus === 'substitute') smsStatusWhere = ` AND k_oriseq > 0 AND msg_type IN ('L', 'S')`;

    // ★ 알림톡(alimtalk)도 SMSQ_SEND msg_type='K' 경로라 SMS 분기에 포함 (messages 조회와 동일)
    // ★ 2026-07-30: 브랜드(kakao·kakao_brand)도 SMSQ(msg_type='F') 합류 — 옛 IMC 서브쿼리 폐기.
    if (sendChannel === 'sms' || sendChannel === 'both' || sendChannel === 'alimtalk'
        || (BRAND_CAMPAIGN_CHANNELS as readonly string[]).includes(sendChannel)) {
      const exportTables = await getCompanySmsTablesWithLogs(companyId, userId);
      const smsFields = SMS_EXPORT_FIELDS;
      for (const t of exportTables) {
        subqueries.push(`(SELECT ${smsFields} FROM ${t} WHERE app_etc1 = ?${smsStatusWhere})`);
        baseParams.push(id);
      }
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
        // ★ 2026-07-30: 브랜드 행도 SMSQ 합류 — 라벨은 msg_type 축(getSendTypeLabel 'F'=브랜드메시지) 단일.
        // ★ 2026-06-13: 발송 요청 시각이 미래인 대기 행 = "발송 예약" (화면 상세와 동일 산출)
        const rowStatus = getQueueRowStatus(Number(m.status_code), !!Number(m.is_future));
        const msgTypeDisplay = getSendTypeLabel(m.msg_type, m.k_oriseq);
        const statusDisplay = rowStatus.label;
        const carrierDisplay = rowStatus.type === 'scheduled' ? '-' : getCarrierLabel(m.mob_company);

        // ★ D131: 헤더 순서(수신번호→메시지유형)와 일치 — 수신확인시간 컬럼 제거됨
        res.write([
          m.dest_no,
          m.call_back,
          `"${getDisplayContents(m.msg_type, m.msg_contents).replace(/"/g, '""')}"`,
          formatCsvDateTime(campaignCreatedAt), // 등록일시 = 캠페인 created_at (모든 행 동일)
          formatCsvDateTime(m.sendreq_time),    // 발송일시 = 발송요청/예약 시각(KST·D98) — 목록·상세와 동일 기준(D233+)
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
