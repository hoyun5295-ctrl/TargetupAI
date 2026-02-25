import { Request, Response, Router } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

// 모든 라우트에 인증 필요
router.use(authenticate);

// ============================================================
// 헬퍼: 회사의 ai_analysis_level 조회
// ============================================================
async function getAnalysisLevel(companyId: string): Promise<string> {
  const result = await query(`
    SELECT COALESCE(p.ai_analysis_level, 'none') as ai_analysis_level
    FROM companies c
    LEFT JOIN plans p ON c.plan_id = p.id
    WHERE c.id = $1
  `, [companyId]);
  return result.rows[0]?.ai_analysis_level || 'none';
}

// ============================================================
// GET /api/analysis/preview
// 모든 요금제 — 티저 데이터
// none: 기본 4개만 / basic/advanced: 전체 반환
// ============================================================
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    const analysisLevel = await getAnalysisLevel(companyId);

    // ── 기본 4개 필드 (모든 요금제) ──
    // 1) 최근 30일 캠페인 수
    const campaignCountResult = await query(`
      SELECT COUNT(*) as total_campaigns
      FROM campaigns
      WHERE company_id = $1
        AND status IN ('completed', 'sent')
        AND created_at >= NOW() - INTERVAL '30 days'
    `, [companyId]);

    // 2) 총 발송 수
    const sentCountResult = await query(`
      SELECT COALESCE(SUM(cr.sent_count), 0) as total_sent
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      WHERE c.company_id = $1
        AND cr.sent_at >= NOW() - INTERVAL '30 days'
    `, [companyId]);

    // 3) 평균 성공률
    const successRateResult = await query(`
      SELECT 
        CASE 
          WHEN COALESCE(SUM(cr.sent_count), 0) = 0 THEN 0
          ELSE ROUND(COALESCE(SUM(cr.success_count), 0)::numeric / NULLIF(SUM(cr.sent_count), 0) * 100, 1)
        END as avg_success_rate
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      WHERE c.company_id = $1
        AND cr.sent_at >= NOW() - INTERVAL '30 days'
    `, [companyId]);

    // 4) 전체 활성 고객 수
    const customerCountResult = await query(`
      SELECT COUNT(*) as total_customers
      FROM customers
      WHERE company_id = $1 AND is_active = true
    `, [companyId]);

    const teaser: any = {
      totalCampaigns: parseInt(campaignCountResult.rows[0]?.total_campaigns || '0'),
      totalSent: parseInt(sentCountResult.rows[0]?.total_sent || '0'),
      avgSuccessRate: parseFloat(successRateResult.rows[0]?.avg_success_rate || '0'),
      totalCustomers: parseInt(customerCountResult.rows[0]?.total_customers || '0'),
    };

    // ── 상세 필드 (프로 이상만) ──
    if (analysisLevel !== 'none') {
      // 5) 최적 발송 시간대 (성공률 기준)
      const bestTimeResult = await query(`
        SELECT 
          EXTRACT(DOW FROM cr.sent_at) as dow,
          EXTRACT(HOUR FROM cr.sent_at) as hour,
          ROUND(SUM(cr.success_count)::numeric / NULLIF(SUM(cr.sent_count), 0) * 100, 1) as success_rate,
          SUM(cr.sent_count) as total_sent
        FROM campaign_runs cr
        JOIN campaigns c ON cr.campaign_id = c.id
        WHERE c.company_id = $1
          AND cr.sent_at >= NOW() - INTERVAL '90 days'
          AND cr.sent_count > 0
        GROUP BY EXTRACT(DOW FROM cr.sent_at), EXTRACT(HOUR FROM cr.sent_at)
        HAVING SUM(cr.sent_count) >= 10
        ORDER BY success_rate DESC
        LIMIT 1
      `, [companyId]);

      const dowNames = ['일', '월', '화', '수', '목', '금', '토'];
      const bestRow = bestTimeResult.rows[0];

      // 6) 최고 성과 요일
      const bestDayResult = await query(`
        SELECT 
          EXTRACT(DOW FROM cr.sent_at) as dow,
          ROUND(SUM(cr.success_count)::numeric / NULLIF(SUM(cr.sent_count), 0) * 100, 1) as success_rate
        FROM campaign_runs cr
        JOIN campaigns c ON cr.campaign_id = c.id
        WHERE c.company_id = $1
          AND cr.sent_at >= NOW() - INTERVAL '90 days'
          AND cr.sent_count > 0
        GROUP BY EXTRACT(DOW FROM cr.sent_at)
        HAVING SUM(cr.sent_count) >= 10
        ORDER BY success_rate DESC
        LIMIT 1
      `, [companyId]);

      // 7) TOP 캠페인 (성공률 기준)
      const topCampaignResult = await query(`
        SELECT 
          c.campaign_name,
          ROUND(SUM(cr.success_count)::numeric / NULLIF(SUM(cr.sent_count), 0) * 100, 1) as success_rate
        FROM campaign_runs cr
        JOIN campaigns c ON cr.campaign_id = c.id
        WHERE c.company_id = $1
          AND cr.sent_at >= NOW() - INTERVAL '90 days'
          AND cr.sent_count >= 10
        GROUP BY c.id, c.campaign_name
        ORDER BY success_rate DESC
        LIMIT 1
      `, [companyId]);

      // 8) 수신거부 30일
      const unsubCountResult = await query(`
        SELECT COUNT(*) as unsub_count
        FROM unsubscribes
        WHERE company_id = $1
          AND created_at >= NOW() - INTERVAL '30 days'
      `, [companyId]);

      // 9) 이탈 위험 고객 (마지막 구매 90일+)
      const churnResult = await query(`
        SELECT COUNT(DISTINCT cu.id) as churn_risk_count
        FROM customers cu
        LEFT JOIN purchases pu ON cu.id = pu.customer_id
        WHERE cu.company_id = $1
          AND cu.is_active = true
        GROUP BY cu.id
        HAVING MAX(pu.purchase_date) < NOW() - INTERVAL '90 days'
           OR MAX(pu.purchase_date) IS NULL
      `, [companyId]);

      // 10) 세그먼트 수 (고정값 or 등급 수 기반)
      const segmentResult = await query(`
        SELECT COUNT(DISTINCT grade) as segment_count
        FROM customers
        WHERE company_id = $1 AND is_active = true AND grade IS NOT NULL AND grade != ''
      `, [companyId]);

      // 11) 추정 ROI (캠페인 발송 후 7일 내 구매 / 발송비용)
      const roiResult = await query(`
        SELECT 
          COALESCE(SUM(pu.total_amount), 0) as purchase_total
        FROM purchases pu
        JOIN customers cu ON pu.customer_id = cu.id
        WHERE cu.company_id = $1
          AND pu.purchase_date >= NOW() - INTERVAL '30 days'
      `, [companyId]);

      const bestDayRow = bestDayResult.rows[0];
      const churnCount = churnResult.rows.length; // GROUP BY 결과의 행 수 = 이탈 위험 고객 수

      teaser.bestTimeSlot = bestRow
        ? `${dowNames[parseInt(bestRow.dow)]} ${String(parseInt(bestRow.hour)).padStart(2, '0')}:00`
        : null;
      teaser.bestDayOfWeek = bestDayRow
        ? `${dowNames[parseInt(bestDayRow.dow)]}요일`
        : null;
      teaser.topCampaignName = topCampaignResult.rows[0]?.campaign_name || null;
      teaser.unsubscribeCount30d = parseInt(unsubCountResult.rows[0]?.unsub_count || '0');
      teaser.churnRiskCount = churnCount;
      teaser.segmentCount = parseInt(segmentResult.rows[0]?.segment_count || '0');

      // ROI: 구매액 / 발송비용 추정 (SMS 15원 기준 간이 계산)
      const estimatedCost = teaser.totalSent * 15;
      const purchaseTotal = parseFloat(roiResult.rows[0]?.purchase_total || '0');
      teaser.estimatedROI = estimatedCost > 0
        ? `${Math.round(purchaseTotal / estimatedCost * 100)}%`
        : null;
    }

    res.json({ analysisLevel, teaser });
  } catch (error) {
    console.error('분석 프리뷰 조회 실패:', error);
    res.status(500).json({ error: '분석 프리뷰 조회 실패' });
  }
});

// ============================================================
// POST /api/analysis/run
// 프로 이상 — AI 분석 실행 (데이터 수집 + Claude 호출)
// ============================================================
router.post('/run', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    const analysisLevel = await getAnalysisLevel(companyId);
    if (analysisLevel === 'none') {
      return res.status(403).json({ error: '프로 이상 요금제에서 사용 가능합니다.', code: 'PLAN_REQUIRED' });
    }

    const { period, startDate, endDate } = req.body;

    // 기간 계산
    let dateFrom: string;
    let dateTo: string;
    const now = new Date();

    if (period === 'custom' && startDate && endDate) {
      dateFrom = startDate;
      dateTo = endDate;
    } else if (period === '90d') {
      dateTo = now.toISOString().split('T')[0];
      const from = new Date(now);
      from.setDate(from.getDate() - 90);
      dateFrom = from.toISOString().split('T')[0];
    } else {
      // 기본 30일
      dateTo = now.toISOString().split('T')[0];
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      dateFrom = from.toISOString().split('T')[0];
    }

    // ── 프로 (basic): 집계값 기반 데이터 수집 ──
    const collectedData: any = {
      period: { from: dateFrom, to: dateTo },
      level: analysisLevel,
    };

    // 1) 캠페인 성과 요약
    const campaignSummary = await query(`
      SELECT 
        COUNT(*) as total_campaigns,
        SUM(cr.sent_count) as total_sent,
        SUM(cr.success_count) as total_success,
        SUM(cr.fail_count) as total_fail,
        ROUND(SUM(cr.success_count)::numeric / NULLIF(SUM(cr.sent_count), 0) * 100, 1) as success_rate
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      WHERE c.company_id = $1
        AND cr.sent_at >= $2::date
        AND cr.sent_at < $3::date + INTERVAL '1 day'
    `, [companyId, dateFrom, dateTo]);

    collectedData.campaignSummary = campaignSummary.rows[0];

    // 2) 채널별 성과
    const channelStats = await query(`
      SELECT 
        cr.message_type,
        COUNT(*) as run_count,
        SUM(cr.sent_count) as sent,
        SUM(cr.success_count) as success,
        ROUND(SUM(cr.success_count)::numeric / NULLIF(SUM(cr.sent_count), 0) * 100, 1) as success_rate
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      WHERE c.company_id = $1
        AND cr.sent_at >= $2::date
        AND cr.sent_at < $3::date + INTERVAL '1 day'
      GROUP BY cr.message_type
      ORDER BY sent DESC
    `, [companyId, dateFrom, dateTo]);

    collectedData.channelStats = channelStats.rows;

    // 3) 요일별 성과
    const dayOfWeekStats = await query(`
      SELECT 
        EXTRACT(DOW FROM cr.sent_at) as dow,
        SUM(cr.sent_count) as sent,
        SUM(cr.success_count) as success,
        ROUND(SUM(cr.success_count)::numeric / NULLIF(SUM(cr.sent_count), 0) * 100, 1) as success_rate
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      WHERE c.company_id = $1
        AND cr.sent_at >= $2::date
        AND cr.sent_at < $3::date + INTERVAL '1 day'
        AND cr.sent_count > 0
      GROUP BY EXTRACT(DOW FROM cr.sent_at)
      ORDER BY dow
    `, [companyId, dateFrom, dateTo]);

    collectedData.dayOfWeekStats = dayOfWeekStats.rows;

    // 4) 시간대별 성과
    const hourStats = await query(`
      SELECT 
        EXTRACT(HOUR FROM cr.sent_at) as hour,
        SUM(cr.sent_count) as sent,
        SUM(cr.success_count) as success,
        ROUND(SUM(cr.success_count)::numeric / NULLIF(SUM(cr.sent_count), 0) * 100, 1) as success_rate
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      WHERE c.company_id = $1
        AND cr.sent_at >= $2::date
        AND cr.sent_at < $3::date + INTERVAL '1 day'
        AND cr.sent_count > 0
      GROUP BY EXTRACT(HOUR FROM cr.sent_at)
      ORDER BY hour
    `, [companyId, dateFrom, dateTo]);

    collectedData.hourStats = hourStats.rows;

    // 5) 고객 분포 (성별/등급)
    const genderDist = await query(`
      SELECT gender, COUNT(*) as count
      FROM customers
      WHERE company_id = $1 AND is_active = true AND gender IS NOT NULL AND gender != ''
      GROUP BY gender
      ORDER BY count DESC
    `, [companyId]);

    const gradeDist = await query(`
      SELECT grade, COUNT(*) as count
      FROM customers
      WHERE company_id = $1 AND is_active = true AND grade IS NOT NULL AND grade != ''
      GROUP BY grade
      ORDER BY count DESC
    `, [companyId]);

    collectedData.customerDistribution = {
      gender: genderDist.rows,
      grade: gradeDist.rows,
    };

    // 6) 수신거부 월별 추이
    const unsubTrend = await query(`
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as count
      FROM unsubscribes
      WHERE company_id = $1
        AND created_at >= $2::date
        AND created_at < $3::date + INTERVAL '1 day'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month
    `, [companyId, dateFrom, dateTo]);

    collectedData.unsubscribeTrend = unsubTrend.rows;

    // 7) TOP 5 캠페인
    const topCampaigns = await query(`
      SELECT 
        c.campaign_name,
        c.message_type,
        SUM(cr.sent_count) as sent,
        SUM(cr.success_count) as success,
        ROUND(SUM(cr.success_count)::numeric / NULLIF(SUM(cr.sent_count), 0) * 100, 1) as success_rate,
        MIN(cr.sent_at) as sent_at
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      WHERE c.company_id = $1
        AND cr.sent_at >= $2::date
        AND cr.sent_at < $3::date + INTERVAL '1 day'
        AND cr.sent_count >= 10
      GROUP BY c.id, c.campaign_name, c.message_type
      ORDER BY success_rate DESC
      LIMIT 5
    `, [companyId, dateFrom, dateTo]);

    collectedData.topCampaigns = topCampaigns.rows;

    // ── 비즈니스 (advanced): 로우데이터 추가 수집 ──
    if (analysisLevel === 'advanced') {
      // 8) 개별 캠페인 상세 (최근 20건)
      const campaignDetails = await query(`
        SELECT 
          c.campaign_name,
          c.message_type,
          c.send_type,
          c.user_prompt,
          c.message_content,
          c.target_count,
          cr.sent_count,
          cr.success_count,
          cr.fail_count,
          ROUND(cr.success_count::numeric / NULLIF(cr.sent_count, 0) * 100, 1) as success_rate,
          cr.sent_at
        FROM campaign_runs cr
        JOIN campaigns c ON cr.campaign_id = c.id
        WHERE c.company_id = $1
          AND cr.sent_at >= $2::date
          AND cr.sent_at < $3::date + INTERVAL '1 day'
        ORDER BY cr.sent_at DESC
        LIMIT 20
      `, [companyId, dateFrom, dateTo]);

      collectedData.campaignDetails = campaignDetails.rows;

      // 9) 이탈 위험 고객 TOP 20
      const churnRisk = await query(`
        SELECT 
          cu.name,
          cu.phone,
          cu.grade,
          cu.gender,
          MAX(pu.purchase_date) as last_purchase_date,
          COUNT(pu.id) as purchase_count,
          COALESCE(SUM(pu.total_amount), 0) as total_purchase_amount
        FROM customers cu
        LEFT JOIN purchases pu ON cu.id = pu.customer_id
        WHERE cu.company_id = $1
          AND cu.is_active = true
        GROUP BY cu.id, cu.name, cu.phone, cu.grade, cu.gender
        HAVING MAX(pu.purchase_date) < NOW() - INTERVAL '90 days'
           OR MAX(pu.purchase_date) IS NULL
        ORDER BY total_purchase_amount DESC
        LIMIT 20
      `, [companyId]);

      collectedData.churnRiskCustomers = churnRisk.rows;

      // 10) RFM 세그먼트 분석용 데이터
      const rfmData = await query(`
        SELECT 
          cu.grade,
          COUNT(DISTINCT cu.id) as customer_count,
          ROUND(AVG(cu.purchase_count), 1) as avg_purchase_count,
          ROUND(AVG(cu.total_purchase_amount)::numeric, 0) as avg_purchase_amount,
          ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - cu.recent_purchase_date)) / 86400), 0) as avg_days_since_purchase
        FROM customers cu
        WHERE cu.company_id = $1
          AND cu.is_active = true
          AND cu.grade IS NOT NULL AND cu.grade != ''
        GROUP BY cu.grade
        ORDER BY avg_purchase_amount DESC
      `, [companyId]);

      collectedData.rfmSegments = rfmData.rows;

      // 11) 구매 전환 분석 (캠페인 발송 후 7일 내 구매)
      const conversionData = await query(`
        SELECT 
          c.campaign_name,
          cr.sent_at,
          cr.sent_count,
          COUNT(DISTINCT pu.customer_id) as converted_customers,
          COALESCE(SUM(pu.total_amount), 0) as conversion_revenue
        FROM campaign_runs cr
        JOIN campaigns c ON cr.campaign_id = c.id
        LEFT JOIN purchases pu ON pu.company_id = c.company_id
          AND pu.purchase_date >= cr.sent_at
          AND pu.purchase_date < cr.sent_at + INTERVAL '7 days'
        WHERE c.company_id = $1
          AND cr.sent_at >= $2::date
          AND cr.sent_at < $3::date + INTERVAL '1 day'
          AND cr.sent_count >= 10
        GROUP BY c.id, c.campaign_name, cr.sent_at, cr.sent_count
        ORDER BY conversion_revenue DESC
        LIMIT 10
      `, [companyId, dateFrom, dateTo]);

      collectedData.conversionAnalysis = conversionData.rows;
    }

    // TODO (세션3): Claude API 호출 → collectedData를 프롬프트에 전달 → 인사이트 생성
    // 현재는 수집된 데이터 그대로 반환
    res.json({
      analysisId: null, // 세션3에서 UUID 생성
      level: analysisLevel,
      generatedAt: new Date().toISOString(),
      collectedData,
      insights: [], // 세션3에서 Claude 응답으로 채움
    });

  } catch (error) {
    console.error('AI 분석 실행 실패:', error);
    res.status(500).json({ error: 'AI 분석 실행 실패' });
  }
});

// ============================================================
// GET /api/analysis/pdf
// 프로 이상 — 분석 결과 PDF 다운로드
// ============================================================
router.get('/pdf', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    const analysisLevel = await getAnalysisLevel(companyId);
    if (analysisLevel === 'none') {
      return res.status(403).json({ error: '프로 이상 요금제에서 사용 가능합니다.', code: 'PLAN_REQUIRED' });
    }

    const { analysisId } = req.query;

    // TODO (세션3): analysisId로 캐싱된 분석 결과 조회 → PDF 생성 → 다운로드
    // 프로: 1~2페이지 기본 보고서
    // 비즈니스: 5~10페이지 상세 보고서

    res.status(501).json({ 
      error: 'PDF 생성 기능은 준비 중입니다.',
      message: '세션3에서 구현 예정',
    });

  } catch (error) {
    console.error('PDF 생성 실패:', error);
    res.status(500).json({ error: 'PDF 생성 실패' });
  }
});

export default router;
