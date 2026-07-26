import { Router, Request, Response } from 'express';
import { authenticate, requireCompanyAdmin } from '../middlewares/auth';
import pool, { mysqlQuery } from '../config/database';
import { DEFAULT_COSTS, getCompanyCosts } from '../config/defaults';
import { getCompanyScope } from '../utils/permission-helper';
import { getTestSmsTables } from '../utils/sms-queue';
// ★ 2026-07-25 `querySendStats`(campaigns 축) 미사용 — 화면·엑셀 모두 청구 축(send-usage-aggregation)으로 통일.
//   슈퍼관리자 통계(admin.ts)는 계정·캠페인 단위 운영 뷰라 그 축을 계속 쓴다.
import { buildDateRangeFilter, querySendStatsDetail } from '../utils/stats-aggregation';
// ★ 2026-07-25 청구서와 동일한 사용량 집계 CT — 엑셀 유형이 청구 유형과 갈리면 정산 대조가 불가능하다.
import { buildCompanyUsageByDay, rollupUsageByPeriod, logUnbillableUsageKeys } from '../utils/send-usage-aggregation';
// ★ 2026-07-25 월 확장 규칙 CT — 화면·에이전트·엑셀 웹 행이 같은 함수를 써야 기간 축이 갈리지 않는다.
import { expandMonthlyRange } from '../utils/stats-period';
// ★ 2026-07-20: 에이전트 전용 회사 = 엔진(PAY) 통계 축 — campaigns엔 행이 없어 0으로 보이던 결함의 근본 배선
//   2026-07-23: 웹/에이전트/테스트 탭 분리 — 교체가 아니라 별도 축(agentRows) 병행 반환으로 전환.
import { queryPayAgentStats, queryPayAgentStoreBreakdown, validateStatsDateRange, isPayStatsConfigured, type PayStatsResult, type PayAgentStoreRow } from '../utils/pay-stats';
// ★ 2026-07-23 (서수란) 발송 통계 엑셀(CSV) 다운로드 — 웹+에이전트 합산 CT
import { buildManageStatsXlsx, type StatsExportWebRow } from '../utils/manage-stats-export';
import { XLSX_CONTENT_TYPE, xlsxContentDisposition } from '../utils/xlsx-writer';

const router = Router();

// ============================================================
//  발송 통계 API — 공용 (슈퍼관리자 + 고객사관리자)
//  마운트: /api/manage/stats
//  ★ D106: 통계 쿼리를 stats-aggregation.ts 컨트롤타워로 통합
//     manage-stats.ts는 테스트 통계(MySQL)만 인라인, 나머지는 컨트롤타워 호출
// ============================================================

router.use(authenticate, requireCompanyAdmin);

// GET /send - 발송 통계 (요약 + 페이징된 일별/월별) + 테스트 발송 분리
router.get('/send', async (req: Request, res: Response) => {
  try {
    const view = (req.query.view as string) === 'monthly' ? 'monthly' : 'daily';
    const startDate = (req.query.startDate as string) || '';
    const endDate = (req.query.endDate as string) || '';
    const companyScope = getCompanyScope(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const filterUserId = req.query.filterUserId as string;

    // ★ 2026-07-25 웹 탭을 **청구 축으로 통일**한다(Harold 지시: 정산은 정합성 최우선).
    //   전에는 화면만 campaigns 축(querySendStats)이고 엑셀·청구서는 청구 축이라 같은 기간인데 숫자가 달랐다.
    //   화면을 띄워놓고 엑셀을 받는 담당자에게 그건 "고치면서 숫자를 깨뜨렸다"로 읽힌다.
    //   행 축도 에이전트 탭과 같은 (기간 × 유형)으로 맞춘다 — 티켓 "웹만 유형이 없다"의 화면 쪽 해소.
    //   `발송 횟수`(캠페인 수)는 청구 축에 없는 개념이라 열에서 뺀다. 캠페인 목록은 기간별 `상세`가 이미 보여준다.
    //   ★ Codex 적대검증 지적 수용(2026-07-25): 조건이 하나라도 빠지면 옛 축으로 **조용히** 복귀해
    //   청구 축과 다른 숫자를 보여주던 폴백이 있었다. 엑셀에서 없앤 결함을 화면에 남겨두면 같은 사고다.
    //   날짜는 화면이 항상 오늘로 채워 보내지만 `<input type="date">`는 비울 수 있다 — 그때 걸린다.
    if (!companyScope) {
      return res.status(400).json({ error: '고객사를 확인할 수 없습니다.', code: 'COMPANY_SCOPE_REQUIRED' });
    }
    if (!startDate || !endDate) {
      return res.status(400).json({ error: '시작일과 종료일을 선택해주세요.', code: 'DATE_RANGE_REQUIRED' });
    }

    let statsResult;
    {
      const range = expandMonthlyRange(view as 'daily' | 'monthly', startDate, endDate);
      const dayData = await buildCompanyUsageByDay({
        companyId: companyScope,
        startDate: range.startDate!,
        endDate: range.endDate!,
        userId: filterUserId || undefined,
      });
      logUnbillableUsageKeys(dayData, `발송통계화면 company=${companyScope} ${range.startDate}~${range.endDate}`);
      // 테스트·스팸은 화면 '테스트' 탭이 따로 담당한다(엑셀의 '테스트' 채널 행과 같은 구분).
      const webTypeRows = rollupUsageByPeriod(dayData, view as 'daily' | 'monthly')
        .filter((r) => !r.type_key.startsWith('TEST_') && !r.type_key.startsWith('SPAM_'));

      const totalRows = webTypeRows.length;
      const totalPages = Math.max(1, Math.ceil(totalRows / limit));
      const safePage = Math.min(Math.max(1, page), totalPages);
      const sum = (k: 'sent' | 'success' | 'fail' | 'pending') => webTypeRows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
      statsResult = {
        summary: {
          total_sent: String(sum('sent')),
          total_success: String(sum('success')),
          total_fail: String(sum('fail')),
          total_pending: String(sum('pending')),
        },
        rows: webTypeRows.slice((safePage - 1) * limit, safePage * limit),
        total: totalRows,
        page: safePage,
        totalPages,
      };
    }

    // ★ 2026-07-23: 웹/에이전트/테스트 탭 분리 — 에이전트(엔진) 통계는 웹을 "교체"하지 않고 별도 축으로 병행 반환.
    //   usage_type in (agent, both)면 company_agent_ids CustId 전량을 pay-ingest-db RSRM_SalesStts에서 합산(pay-stats CT).
    //   웹(campaigns) 축은 불변(회귀 0). env 미설정·미연결·실패 = agentRows 빈 배열(조용한 폴백).
    //   에이전트는 일자 단위 소량이라 전량 반환(limit 크게) 후 프론트에서 별도 탭 페이징.
    let usageType = 'web';
    let agentSummary: PayStatsResult['summary'] | null = null;
    let agentRows: PayStatsResult['rows'] = [];         // (기간 × 유형) 행
    let agentByType: PayStatsResult['byType'] = [];     // 유형별 합계 (SMS/LMS/MMS/카카오)
    if (companyScope) {
      const compType = await pool.query('SELECT usage_type FROM companies WHERE id = $1', [companyScope]);
      usageType = compType.rows[0]?.usage_type || 'web';
      if ((usageType === 'agent' || usageType === 'both') && isPayStatsConfigured()) {
        const payResult = await queryPayAgentStats({
          companyId: companyScope,
          view: view as 'daily' | 'monthly',
          startDate,
          endDate,
          page: 1,
          limit: 100000,
        });
        if (payResult) { agentSummary = payResult.summary; agentRows = payResult.rows; agentByType = payResult.byType; }
      }
    }

    // 테스트 발송 통계 (MySQL — 컨트롤타워 대상 아님, 관리자 전용)
    let testSummary = { total: 0, success: 0, fail: 0, pending: 0, sms: 0, lms: 0, cost: 0 };
    if (companyScope) {
      try {
        // 월별 조회 시 날짜 확장 (테스트 통계용)
        let testStartDate = startDate;
        let testEndDate = endDate;
        if (view === 'monthly') {
          if (testStartDate) testStartDate = testStartDate.substring(0, 7) + '-01';
          if (testEndDate) {
            const d = new Date(testEndDate);
            d.setMonth(d.getMonth() + 1, 0);
            testEndDate = d.toISOString().split('T')[0];
          }
        }

        // 담당자 테스트 (MySQL)
        let mysqlDateWhere = '';
        const mysqlParams: any[] = [companyScope];
        if (testStartDate) {
          mysqlDateWhere += ` AND msg_instm >= ?`;
          mysqlParams.push(testStartDate);
        }
        if (testEndDate) {
          mysqlDateWhere += ` AND msg_instm < DATE_ADD(?, INTERVAL 1 DAY)`;
          mysqlParams.push(testEndDate);
        }

        const testTables = await getTestSmsTables();
        for (const tbl of testTables) {
          const testRows = await mysqlQuery(
            `SELECT
              COUNT(*) as total,
              SUM(CASE WHEN status_code IN (6, 1000, 1800) THEN 1 ELSE 0 END) as success,
              SUM(CASE WHEN status_code NOT IN (6, 1000, 1800, 100) THEN 1 ELSE 0 END) as fail,
              SUM(CASE WHEN status_code = 100 THEN 1 ELSE 0 END) as pending,
              SUM(CASE WHEN msg_type = 'S' THEN 1 ELSE 0 END) as sms,
              SUM(CASE WHEN msg_type = 'L' THEN 1 ELSE 0 END) as lms
            FROM ${tbl}
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
        }

        // 스팸필터 테스트 (PostgreSQL)
        const sfDr = buildDateRangeFilter('t.created_at', testStartDate, testEndDate, 2);
        const sfDateWhere = sfDr.sql;
        const sfParams: any[] = [companyScope, ...sfDr.params];

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
        const costRes = await pool.query('SELECT cost_per_sms, cost_per_lms, unit_price_basis FROM companies WHERE id = $1', [companyScope]);
        const { sms: cSms, lms: cLms } = getCompanyCosts(costRes.rows[0] || {});
        testSummary.cost = Math.round(((testSummary.sms - testSummary.pending) * cSms + testSummary.lms * cLms) * 10) / 10;
      } catch (mysqlErr) {
        console.error('테스트 통계 조회 실패:', mysqlErr);
      }
    }

    res.json({
      summary: statsResult.summary,
      testSummary,
      rows: statsResult.rows,
      total: statsResult.total,
      page: statsResult.page,
      totalPages: statsResult.totalPages,
      // ★ 2026-07-23 탭 분리 + 유형별: 회사 유형 + 에이전트(엔진) 통계 병행 축
      usageType,
      agentSummary,
      agentRows,     // (기간 × 유형)
      agentByType,   // 유형별 합계
    });
  } catch (error) {
    console.error('발송 통계 조회 실패:', error);
    res.status(500).json({ error: '발송 통계 조회 실패' });
  }
});

// GET /send/detail - 발송 통계 상세 (사용자별 분해)
router.get('/send/detail', async (req: Request, res: Response) => {
  try {
    const view = (req.query.view as string) === 'monthly' ? 'monthly' : 'daily';
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

    const filterUserId = req.query.filterUserId as string;

    // ★ 컨트롤타워 호출 — 인라인 쿼리 제거
    let detailResult = await querySendStatsDetail(
      { view: view as 'daily' | 'monthly', date: dateVal, companyId: targetCompanyId, filterUserId: filterUserId || undefined },
      { sms: DEFAULT_COSTS.sms, lms: DEFAULT_COSTS.lms }
    );

    // ★ 2026-07-23: 에이전트는 수신자별 상세 데이터가 없어(집계만 유입) 상세 축 없음 — 웹/테스트 상세만 유지.

    // 테스트 발송 상세 (MySQL — 관리자 전용)
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

      const testRows = await mysqlQuery(
        `SELECT
          dest_no as phone, msg_type, status_code,
          msg_instm as sent_at, bill_id as sender_id
        FROM ${(await getTestSmsTables())[0]}
        WHERE app_etc1 = 'test' AND app_etc2 = ? ${mysqlDateWhere}
        ORDER BY msg_instm DESC LIMIT 50`,
        mysqlParams
      );
      testDetail = (testRows as any[]).map(r => ({
        phone: r.phone,
        msgType: r.msg_type === 'S' ? 'SMS' : 'LMS',
        status: [6, 1000, 1800].includes(r.status_code) ? 'success' : r.status_code === 100 ? 'pending' : 'fail',
        sentAt: r.sent_at,
        testType: 'manager',
      }));

      // 스팸필터 테스트
      let sfDateCond = '';
      if (view === 'monthly') {
        sfDateCond = `AND TO_CHAR(t.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $2`;
      } else {
        sfDateCond = `AND TO_CHAR(t.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $2`;
      }
      const sfDetail = await pool.query(`
        SELECT r.phone, r.carrier, r.message_type, r.result, t.created_at as sent_at
        FROM spam_filter_test_results r
        JOIN spam_filter_tests t ON r.test_id = t.id
        WHERE t.company_id = $1 ${sfDateCond}
        ORDER BY t.created_at DESC LIMIT 50
      `, [targetCompanyId, dateVal]);

      sfDetail.rows.forEach((r: any) => {
        testDetail.push({
          phone: r.phone, msgType: r.message_type || 'SMS',
          status: r.result ? 'success' : 'pending', result: r.result || 'pending',
          carrier: r.carrier, sentAt: r.sent_at, testType: 'spam_filter',
        });
      });
    } catch (mysqlErr) {
      console.error('테스트 상세 MySQL 조회 실패:', mysqlErr);
    }

    res.json({
      ...detailResult,
      testDetail,
    });
  } catch (error) {
    console.error('발송 통계 상세 조회 실패:', error);
    res.status(500).json({ error: '발송 통계 상세 조회 실패' });
  }
});

// GET /send/export — 발송 통계 엑셀(CSV) 다운로드 (웹+에이전트 한 파일 합산·서수란 2026-07-23)
//   웹=buildCompanyUsageByDay(기간×유형·청구 축)·에이전트=queryPayAgentStoreBreakdown(기간×발송ID×대상ID×유형)을 페이징 없이 전량.
//   ★ 2026-07-25 (#2) CSV는 대상ID(StoreId)별 정산 분해 — 화면 GET(집계)과 별도 함수라 회귀 0. 웹 축 무접촉.
router.get('/send/export', async (req: Request, res: Response) => {
  try {
    const view = (req.query.view as string) === 'monthly' ? 'monthly' : 'daily';
    // 공백 낀 값이 하위(expandMonthly substring)에서 깨지지 않도록 입구에서 정규화
    let startDate = String(req.query.startDate || '').trim();
    let endDate = String(req.query.endDate || '').trim();
    const filterUserId = req.query.filterUserId as string;
    const companyScope = getCompanyScope(req);

    // ★ 2026-07-25 이 CSV는 정산 대조용이다. 회사 스코프가 없으면 청구 축 집계를 만들 수 없고,
    //   그 상태로 다른 축(캠페인 선언 유형) 숫자를 조용히 내보내면 대조가 성립하지 않는다 — 명시 차단.
    //   (고객사 관리자는 토큰에서 스코프가 항상 잡히고, super_admin이 companyId 없이 부를 때만 여기 걸린다.)
    if (!companyScope) {
      return res.status(400).json({
        error: '발송통계 엑셀은 고객사를 지정해야 받을 수 있습니다. (정산 대조용 파일이라 회사 단위 집계가 필요합니다)',
        code: 'COMPANY_SCOPE_REQUIRED',
      });
    }

    // ★ 2026-07-25 날짜 검증을 usage_type 무관 전건으로 올렸다.
    //   전에는 agent/both일 때만 검증해서, 웹 전용 회사가 날짜를 비우면 기간 필터 없이 전 이력을 스캔한 뒤
    //   청구 축이 아닌 폴백 숫자를 내보냈다. 정산 파일에서 조용히 다른 축이 나가는 것이 빈 유형보다 나쁘다.
    //   검증은 정규화(trim)된 날짜를 돌려주며, 이후 전 경로(웹·에이전트 조회·파일명)가 그 값을 쓴다.
    const dateCheck = validateStatsDateRange(startDate, endDate);
    if (!dateCheck.ok) {
      return res.status(400).json({ error: `발송통계 엑셀 — ${dateCheck.error}` });
    }
    startDate = dateCheck.startDate;
    endDate = dateCheck.endDate;

    // ★ 2026-07-25 에이전트 축 사전 검증 — 웹 조회 전에 수행(헛일 방지).
    //   미설정(PAY env)을 조용히 빈 에이전트 축으로 흘리면 정산에서 "발송 0"으로 오독된다(Codex R2 HIGH 1).
    let includeAgent = false;
    {
      const compType = await pool.query('SELECT usage_type FROM companies WHERE id = $1', [companyScope]);
      const usageType = compType.rows[0]?.usage_type || 'web';
      if (usageType === 'agent' || usageType === 'both') {
        if (!isPayStatsConfigured()) {
          return res.status(503).json({ error: '에이전트 통계 DB가 설정되지 않아 다운로드할 수 없습니다.', code: 'PAY_STATS_NOT_CONFIGURED' });
        }
        includeAgent = true;
      }
    }

    // ★ 2026-07-25 (#3) 웹 행 유형 — **청구서와 같은 집계 CT**(send-usage-aggregation)를 쓴다.
    //   Harold 지시: 정산 대조용 엑셀의 유형이 청구서와 다르면 정산이 성립하지 않는다.
    //   캠페인에 선언된 유형은 큐 적재 시 SMS→LMS 자동 승격을 반영하지 못해 청구서와 갈렸다.
    //   테스트·스팸필터분은 화면 탭 구분과 맞춰 '테스트' 채널 행으로 분리한다.
    //   ★ 2026-07-25 월별 보기는 기간을 그 달 전체로 넓혀 조회한다(stats-period CT).
    //   화면(querySendStats)과 에이전트(queryPayAgentStoreBreakdown)는 원래 넓혔는데 웹 행만 안 넓혀서,
    //   월별로 받으면 같은 파일 안에서 에이전트는 그 달 전체·웹은 하루치인데 기간 라벨은 둘 다 `YYYY-MM`이었다.
    const webRange = expandMonthlyRange(view, startDate, endDate);
    let webRows: StatsExportWebRow[] = [];
    let testRows: StatsExportWebRow[] = [];
    {
      const dayData = await buildCompanyUsageByDay({
        companyId: companyScope,
        startDate: webRange.startDate!,
        endDate: webRange.endDate!,
        userId: filterUserId || undefined,
      });
      // 청구가 못 읽는 유형키가 섞이면 그 유형은 원시 키로 실려 대조가 깨진다 — 그 자리에서 로그로 드러낸다.
      logUnbillableUsageKeys(dayData, `발송통계엑셀 company=${companyScope} ${webRange.startDate}~${webRange.endDate}`);
      for (const r of rollupUsageByPeriod(dayData, view as 'daily' | 'monthly')) {
        const row: StatsExportWebRow = {
          period: r.period,
          type_label: r.type_label,
          sent: r.sent,
          success: r.success,
          fail: r.fail,
          pending: r.pending,
        };
        if (r.type_key.startsWith('TEST_') || r.type_key.startsWith('SPAM_')) testRows.push(row);
        else webRows.push(row);
      }
    }

    // ★ 2026-07-25 (#2) CSV 에이전트 축 = 대상ID(StoreId)별 분해(정산 구분). 화면 GET은 queryPayAgentStats(집계) 유지.
    let agentRows: PayAgentStoreRow[] = [];
    if (includeAgent && companyScope) {
      const storeRows = await queryPayAgentStoreBreakdown({
        scope: 'company',
        companyId: companyScope,
        view: view as 'daily' | 'monthly',
        startDate,
        endDate,
      });
      // null(조회 실패) ≠ [](정상 0건) — 실패를 빈 CSV로 내면 정산 과소집계로 오인
      if (storeRows === null) {
        return res.status(503).json({ error: '에이전트 통계 조회에 실패했습니다. 잠시 후 다시 시도해주세요.', code: 'PAY_STATS_QUERY_FAILED' });
      }
      agentRows = storeRows;
    }

    // ★ 2026-07-25 CSV → 엑셀(.xlsx). Harold 지시 + LESSONS_BACKEND "고객 대상 xlsx = exceljs".
    //   수량 열이 실제 숫자로 들어가 담당자가 바로 합계·필터를 걸 수 있다(CSV는 문자로 읽혀 안 됐다).
    //   웹 행은 청구 축(성공 기준 과금)이라 캡션에 기준을 명시한다 — 대조 시 '전송'으로 맞추다 어긋나는 걸 막는다.
    const buf = await buildManageStatsXlsx(
      { webRows, testRows, agentRows },
      {
        title: `발송통계 ${startDate} ~ ${endDate}`,
        caption: `${view === 'monthly' ? '월별' : '일별'} · 청구 기준 집계(성공 건수가 과금 대상) · 웹/테스트는 발송ID·대상ID 축이 없습니다`,
      },
    );
    const filename = `발송통계_${startDate}_${endDate}.xlsx`;
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', xlsxContentDisposition(filename));
    return res.send(buf);
  } catch (error) {
    console.error('발송 통계 엑셀 export 실패:', error);
    return res.status(500).json({ error: '엑셀 다운로드에 실패했습니다.' });
  }
});

export default router;
