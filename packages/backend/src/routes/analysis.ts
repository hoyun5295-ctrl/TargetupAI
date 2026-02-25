import { Request, Response, Router } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// 모든 라우트에 인증 필요
router.use(authenticate);

// ============================================================
// 타입 정의
// ============================================================
interface InsightKeyMetric {
  label: string;
  value: string;
}

interface AnalysisInsight {
  id: string;
  category: string;
  title: string;
  summary: string;
  details: string;
  level: 'basic' | 'advanced';
  keyMetrics: InsightKeyMetric[];
  recommendations: string[];
}

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
// 헬퍼: 회사명 조회
// ============================================================
async function getCompanyName(companyId: string): Promise<string> {
  const result = await query(`SELECT company_name FROM companies WHERE id = $1`, [companyId]);
  return result.rows[0]?.company_name || '고객사';
}

// ============================================================
// 프롬프트: 시스템 프롬프트 (공통)
// ============================================================
const ANALYSIS_SYSTEM_PROMPT = `당신은 한국의 SMS/LMS/MMS 마케팅 데이터 분석 전문가입니다.
기업의 메시징 캠페인 데이터를 분석하여 실행 가능한 인사이트를 제공합니다.

분석 원칙:
1. 데이터에 기반한 구체적 수치를 반드시 인용하세요.
2. 한국 마케팅 환경(화법, 업종 특성, 계절성)에 맞게 분석하세요.
3. "~하세요"가 아닌 "~를 권장합니다", "~가 효과적입니다" 등 전문가 톤을 사용하세요.
4. 즉시 실행 가능한 구체적 제안을 포함하세요.
5. 데이터가 부족한 항목은 "데이터 축적 후 분석 가능" 으로 안내하세요.

반드시 아래 JSON 형식으로만 응답하세요. JSON 외 다른 텍스트, 마크다운 코드블록(\`\`\`)은 절대 포함하지 마세요.`;

// ============================================================
// 프롬프트: 프로 분석 (1회 호출)
// ============================================================
function buildProPrompt(collectedData: any): string {
  return `아래 마케팅 데이터를 분석하여 인사이트를 생성해주세요.

=== 수집된 데이터 ===
${JSON.stringify(collectedData, null, 2)}

=== 응답 JSON 형식 ===
{
  "insights": [
    {
      "id": "인사이트ID",
      "category": "카테고리",
      "title": "한글 제목",
      "summary": "핵심 요약 1~2문장 (구체적 수치 포함)",
      "details": "상세 분석 3~5문장 (데이터 근거 + 해석 + 의미)",
      "level": "basic",
      "keyMetrics": [
        { "label": "지표명", "value": "값 (단위 포함)" }
      ],
      "recommendations": ["구체적 추천사항 1", "구체적 추천사항 2"]
    }
  ]
}

=== 반드시 생성할 인사이트 (6개) ===
1. id: "campaign-performance", category: "campaign", title: "캠페인 성과 분석"
   - campaignSummary, channelStats, topCampaigns 데이터 기반
   - 성공률/실패율, 채널별 비교, TOP 캠페인 언급
   - keyMetrics: 총 캠페인 수, 총 발송, 평균 성공률, TOP 캠페인

2. id: "optimal-timing", category: "timing", title: "최적 발송 시간 분석"
   - dayOfWeekStats, hourStats 데이터 기반
   - 가장 효과적인 요일+시간대 조합, 피해야 할 시간대
   - keyMetrics: 최고 성과 요일, 최고 성과 시간대, 최저 성과 시간대

3. id: "channel-comparison", category: "channel", title: "채널별 비교 분석"
   - channelStats 데이터 기반
   - SMS vs LMS vs MMS 성과 비교, 채널별 특성 분석
   - keyMetrics: 채널별 성공률, 가장 효과적 채널

4. id: "customer-overview", category: "customer", title: "고객 분포 분석"
   - customerDistribution (gender, grade) 데이터 기반
   - 성별/등급 분포, 주요 타겟 고객군 특성
   - keyMetrics: 성별 비율, 등급별 비율

5. id: "unsubscribe-trend", category: "unsubscribe", title: "수신거부 추이 분석"
   - unsubscribeTrend 데이터 기반
   - 월별 증감 패턴, 증가 시 원인 추정
   - keyMetrics: 기간 내 수신거부 수, 월평균, 추이 방향

6. id: "monthly-summary", category: "summary", title: "종합 분석 요약"
   - 전체 데이터 종합
   - 가장 중요한 3가지 핵심 발견, 종합 평가
   - keyMetrics: 핵심 지표 3~4개
   - recommendations: 향후 1개월 내 실행할 액션 3가지

각 인사이트의 summary는 반드시 실제 데이터 수치를 포함하세요.
recommendations는 인사이트당 2~3개, "~를 권장합니다" 톤으로 작성하세요.
데이터가 0이거나 없는 항목은 "해당 기간 데이터 없음" 으로 표기하세요.`;
}

// ============================================================
// 프롬프트: 비즈니스 분석 (3회 호출)
// ============================================================
function buildBusinessPrompt1(collectedData: any): string {
  return `아래 마케팅 캠페인 상세 데이터를 심층 분석해주세요. (1단계: 캠페인 심층 분석)

=== 수집된 데이터 ===
- 캠페인 요약: ${JSON.stringify(collectedData.campaignSummary)}
- 채널별 성과: ${JSON.stringify(collectedData.channelStats)}
- 요일별 성과: ${JSON.stringify(collectedData.dayOfWeekStats)}
- 시간대별 성과: ${JSON.stringify(collectedData.hourStats)}
- TOP 캠페인: ${JSON.stringify(collectedData.topCampaigns)}
- 개별 캠페인 상세 (최근 20건): ${JSON.stringify(collectedData.campaignDetails || [])}

=== 응답 JSON 형식 (insights 배열) ===
{
  "insights": [
    {
      "id": "인사이트ID",
      "category": "카테고리",
      "title": "한글 제목",
      "summary": "핵심 요약 1~2문장",
      "details": "상세 분석 5~8문장 (심층 데이터 근거)",
      "level": "advanced",
      "keyMetrics": [{ "label": "지표명", "value": "값" }],
      "recommendations": ["추천사항"]
    }
  ]
}

=== 반드시 생성할 인사이트 (4개) ===
1. id: "campaign-performance", category: "campaign", title: "캠페인 성과 심층 분석"
   - 전체 성과 + 개별 캠페인 패턴 비교
   - 어떤 메시지/프롬프트가 높은 성과를 냈는지 분석
   - keyMetrics 5~6개

2. id: "optimal-timing", category: "timing", title: "최적 발송 시간 분석"
   - 요일×시간대 교차 분석, 성과 상위/하위 패턴
   - keyMetrics: 골든타임 top3, 피해야 할 시간 top2

3. id: "channel-comparison", category: "channel", title: "채널별 심층 비교"
   - SMS/LMS/MMS 각 채널 특성 + 적합한 용도 매칭
   - keyMetrics 4~5개

4. id: "campaign-pattern", category: "campaign", title: "캠페인 메시지 패턴 분석"
   - user_prompt와 message_content 분석
   - 성과 좋은 메시지 특성 (길이, 개인화, 톤 등)
   - level: "advanced"

모든 분석은 실제 데이터 수치에 근거하세요. 추정은 "추정치"로 명시하세요.`;
}

function buildBusinessPrompt2(collectedData: any): string {
  return `아래 고객 데이터를 심층 분석해주세요. (2단계: 고객 심층 분석)

=== 수집된 데이터 ===
- 고객 분포 (성별/등급): ${JSON.stringify(collectedData.customerDistribution)}
- 수신거부 추이: ${JSON.stringify(collectedData.unsubscribeTrend)}
- RFM 세그먼트: ${JSON.stringify(collectedData.rfmSegments || [])}
- 이탈 위험 고객 TOP 20: ${JSON.stringify(collectedData.churnRiskCustomers || [])}
- 구매 전환 분석: ${JSON.stringify(collectedData.conversionAnalysis || [])}

=== 응답 JSON 형식 ===
{ "insights": [ { "id": "...", "category": "...", "title": "...", "summary": "...", "details": "...", "level": "advanced", "keyMetrics": [...], "recommendations": [...] } ] }

=== 반드시 생성할 인사이트 (4개) ===
1. id: "customer-segments", category: "customer", title: "고객 세그먼트 분석"
   - RFM 데이터 기반 고객군 분류 + 각 군별 특성/전략
   - 등급별 고객 수, 평균 구매금액, 평균 구매횟수 분석

2. id: "churn-risk", category: "customer", title: "이탈 위험 고객 분석"
   - 90일+ 미구매 고객 특성 분석
   - 이탈 위험군 규모, 잠재 매출 손실 추정
   - 재활성화 메시지 전략 제안

3. id: "conversion-analysis", category: "conversion", title: "캠페인 전환 분석"
   - 캠페인 발송 후 7일 내 구매 전환 분석
   - 전환율 높은 캠페인 특성, ROI 추정
   - 데이터 없으면 "구매 데이터 연동 시 분석 가능" 안내

4. id: "unsubscribe-trend", category: "unsubscribe", title: "수신거부 심층 분석"
   - 월별 추이 + 원인 추정 + 감소 전략
   - 업종 평균 대비 평가 (일반적으로 월 0.3~0.5% 수준)

모든 분석은 실제 데이터 수치에 근거하세요. 고객명/전화번호는 PDF에 포함하지 마세요.`;
}

function buildBusinessPrompt3(turn1Insights: AnalysisInsight[], turn2Insights: AnalysisInsight[], collectedData: any): string {
  return `이전 분석 결과를 종합하여 전략적 액션 플랜을 수립해주세요. (3단계: 전략 종합)

=== 1단계 캠페인 분석 결과 ===
${turn1Insights.map(i => `[${i.title}] ${i.summary}`).join('\n')}

=== 2단계 고객 분석 결과 ===
${turn2Insights.map(i => `[${i.title}] ${i.summary}`).join('\n')}

=== 기간 정보 ===
분석 기간: ${collectedData.period.from} ~ ${collectedData.period.to}

=== 응답 JSON 형식 ===
{ "insights": [ { "id": "...", "category": "...", "title": "...", "summary": "...", "details": "...", "level": "advanced", "keyMetrics": [...], "recommendations": [...] } ] }

=== 반드시 생성할 인사이트 (3개) ===
1. id: "action-plan", category: "strategy", title: "맞춤 액션 플랜"
   - 향후 1개월 실행할 구체적 캠페인 3~5개 제안
   - 각 캠페인: 타겟군 + 메시지 방향 + 추천 발송 시간 + 예상 효과
   - recommendations 5개 이상

2. id: "roi-analysis", category: "conversion", title: "ROI 종합 분석"
   - 현재 캠페인 투자 대비 성과 종합
   - 개선 시 예상 ROI 향상 추정
   - 비용 최적화 방안

3. id: "monthly-summary", category: "summary", title: "종합 분석 리포트"
   - 전체 분석의 핵심 발견 5가지
   - 강점/약점/기회/위협 정리
   - 최우선 개선 과제 3가지
   - keyMetrics: 핵심 KPI 5~6개

전략 제안은 한국 마케팅 실무에서 즉시 실행 가능한 수준으로 구체적으로 작성하세요.`;
}

// ============================================================
// 헬퍼: Claude 응답 파싱
// ============================================================
function parseClaudeResponse(text: string): AnalysisInsight[] {
  let jsonStr = text.trim();

  // 마크다운 코드블록 제거
  if (jsonStr.includes('```json')) {
    const start = jsonStr.indexOf('```json') + 7;
    const end = jsonStr.indexOf('```', start);
    jsonStr = jsonStr.slice(start, end).trim();
  } else if (jsonStr.includes('```')) {
    const start = jsonStr.indexOf('```') + 3;
    const end = jsonStr.indexOf('```', start);
    jsonStr = jsonStr.slice(start, end).trim();
  }

  const parsed = JSON.parse(jsonStr);
  const insights: AnalysisInsight[] = (parsed.insights || []).map((i: any) => ({
    id: i.id || 'unknown',
    category: i.category || 'general',
    title: i.title || '분석',
    summary: i.summary || '',
    details: i.details || '',
    level: i.level || 'basic',
    keyMetrics: Array.isArray(i.keyMetrics) ? i.keyMetrics : [],
    recommendations: Array.isArray(i.recommendations) ? i.recommendations : [],
  }));

  return insights;
}

// ============================================================
// 헬퍼: Claude API 호출 (재시도 포함)
// ============================================================
async function callClaude(userMessage: string, maxRetries = 2): Promise<AnalysisInsight[]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        temperature: 0.3,
        system: ANALYSIS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return parseClaudeResponse(text);
    } catch (error: any) {
      console.error(`Claude 호출 실패 (시도 ${attempt + 1}/${maxRetries + 1}):`, error.message);
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기 후 재시도
    }
  }
  return [];
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

      // 10) 세그먼트 수 (등급 수 기반)
      const segmentResult = await query(`
        SELECT COUNT(DISTINCT grade) as segment_count
        FROM customers
        WHERE company_id = $1 AND is_active = true AND grade IS NOT NULL AND grade != ''
      `, [companyId]);

      // 11) 추정 ROI
      const roiResult = await query(`
        SELECT 
          COALESCE(SUM(pu.total_amount), 0) as purchase_total
        FROM purchases pu
        JOIN customers cu ON pu.customer_id = cu.id
        WHERE cu.company_id = $1
          AND pu.purchase_date >= NOW() - INTERVAL '30 days'
      `, [companyId]);

      const bestDayRow = bestDayResult.rows[0];
      const churnCount = churnResult.rows.length;

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
// 프로 이상 — AI 분석 실행 (캐시 체크 → 데이터 수집 → Claude 호출 → 저장)
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

    const { period, startDate, endDate, forceRefresh } = req.body;

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
      dateTo = now.toISOString().split('T')[0];
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      dateFrom = from.toISOString().split('T')[0];
    }

    // ── 캐시 체크 (forceRefresh가 아닌 경우) ──
    if (!forceRefresh) {
      const cached = await query(`
        SELECT id, insights, created_at
        FROM analysis_results
        WHERE company_id = $1
          AND analysis_level = $2
          AND period_from = $3::date
          AND period_to = $4::date
          AND created_at >= NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC
        LIMIT 1
      `, [companyId, analysisLevel, dateFrom, dateTo]);

      if (cached.rows.length > 0) {
        const row = cached.rows[0];
        return res.json({
          analysisId: row.id,
          level: analysisLevel,
          generatedAt: row.created_at,
          insights: row.insights,
          cached: true,
        });
      }
    }

    // ── 데이터 수집 (기존 로직 유지) ──
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

      // 11) 구매 전환 분석
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

    // ── Claude API 호출 ──
    let allInsights: AnalysisInsight[] = [];

    if (analysisLevel === 'basic') {
      // 프로: 1회 호출
      const proPrompt = buildProPrompt(collectedData);
      allInsights = await callClaude(proPrompt);
      // level 강제 설정
      allInsights = allInsights.map(i => ({ ...i, level: 'basic' as const }));

    } else if (analysisLevel === 'advanced') {
      // 비즈니스: 3회 호출 (멀티턴)
      // 1턴: 캠페인 심층 분석
      const turn1Insights = await callClaude(buildBusinessPrompt1(collectedData));
      
      // 2턴: 고객 심층 분석
      const turn2Insights = await callClaude(buildBusinessPrompt2(collectedData));
      
      // 3턴: 전략 종합 (1턴+2턴 결과 기반)
      const turn3Insights = await callClaude(buildBusinessPrompt3(turn1Insights, turn2Insights, collectedData));

      allInsights = [
        ...turn1Insights.map(i => ({ ...i, level: 'advanced' as const })),
        ...turn2Insights.map(i => ({ ...i, level: 'advanced' as const })),
        ...turn3Insights.map(i => ({ ...i, level: 'advanced' as const })),
      ];
    }

    // ── 캐시 저장 (UPSERT) ──
    const saveResult = await query(`
      INSERT INTO analysis_results (company_id, analysis_level, period_from, period_to, insights, collected_data)
      VALUES ($1, $2, $3::date, $4::date, $5::jsonb, $6::jsonb)
      ON CONFLICT (company_id, analysis_level, period_from, period_to)
      DO UPDATE SET insights = $5::jsonb, collected_data = $6::jsonb, created_at = NOW()
      RETURNING id, created_at
    `, [companyId, analysisLevel, dateFrom, dateTo, JSON.stringify(allInsights), JSON.stringify(collectedData)]);

    const savedRow = saveResult.rows[0];

    res.json({
      analysisId: savedRow.id,
      level: analysisLevel,
      generatedAt: savedRow.created_at,
      insights: allInsights,
      cached: false,
    });

  } catch (error: any) {
    console.error('AI 분석 실행 실패:', error);
    res.status(500).json({ error: 'AI 분석 실행 실패', message: error.message });
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
    if (!analysisId) {
      return res.status(400).json({ error: 'analysisId가 필요합니다.' });
    }

    // 분석 결과 조회
    const result = await query(`
      SELECT ar.*, c.company_name
      FROM analysis_results ar
      JOIN companies c ON ar.company_id = c.id
      WHERE ar.id = $1 AND ar.company_id = $2
    `, [analysisId, companyId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '분석 결과를 찾을 수 없습니다.' });
    }

    const ar = result.rows[0];
    const insights: AnalysisInsight[] = ar.insights;
    const companyName = ar.company_name || '고객사';
    const periodFrom = ar.period_from instanceof Date ? ar.period_from.toISOString().slice(0, 10) : String(ar.period_from).slice(0, 10);
    const periodTo = ar.period_to instanceof Date ? ar.period_to.toISOString().slice(0, 10) : String(ar.period_to).slice(0, 10);

    // PDF 생성
    const PDFDocument = require('pdfkit');

    const fontPath = path.join(__dirname, '../../fonts/malgun.ttf');
    const fontBoldPath = path.join(__dirname, '../../fonts/malgunbd.ttf');
    const hasFont = fs.existsSync(fontPath);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    const pdfDir = path.join(__dirname, '../../pdfs');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const pdfFilename = `한줄로_AI분석_${companyName}_${periodFrom}_${periodTo}.pdf`;
    const pdfPath = path.join(pdfDir, `analysis_${String(analysisId).slice(0, 8)}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    const setFont = (bold = false) => { if (hasFont) doc.font(bold ? fontBoldPath : fontPath); };
    const primary = '#4f46e5';
    const dark = '#1f2937';
    const gray = '#6b7280';
    const lightBg = '#f0f0ff';
    const pageWidth = 495; // A4 width - margins
    const pageBottom = 760;

    // ── 카테고리별 색상 ──
    const categoryColors: Record<string, string> = {
      campaign: '#059669',
      timing: '#d97706',
      channel: '#7c3aed',
      customer: '#2563eb',
      unsubscribe: '#dc2626',
      conversion: '#0891b2',
      strategy: '#c026d3',
      summary: '#4f46e5',
    };

    const categoryLabels: Record<string, string> = {
      campaign: '캠페인',
      timing: '발송시간',
      channel: '채널',
      customer: '고객',
      unsubscribe: '수신거부',
      conversion: '전환',
      strategy: '전략',
      summary: '종합',
    };

    let y = 0;

    // ============================
    // PAGE 1 — 커버
    // ============================
    // 상단 배너
    doc.rect(0, 0, 612, 120).fill(primary);
    setFont(true);
    doc.fontSize(24).fillColor('white').text('AI 마케팅 분석 리포트', 50, 35);
    setFont(false);
    doc.fontSize(11).fillColor('#c7d2fe').text(companyName, 50, 68);
    doc.fontSize(10).text(`분석 기간: ${periodFrom} ~ ${periodTo}`, 50, 86);
    doc.fontSize(8).text(`생성일: ${new Date().toISOString().slice(0, 10)}  |  분석 레벨: ${ar.analysis_level === 'advanced' ? '비즈니스 (고급)' : '프로 (기본)'}`, 50, 103);

    y = 140;

    // 요약 지표 카드 (수집 데이터에서)
    const cd = ar.collected_data;
    if (cd?.campaignSummary) {
      const cs = cd.campaignSummary;
      const summaryMetrics = [
        { label: '총 캠페인', value: `${parseInt(cs.total_campaigns || '0')}건` },
        { label: '총 발송', value: `${parseInt(cs.total_sent || '0').toLocaleString()}건` },
        { label: '성공률', value: `${cs.success_rate || 0}%` },
        { label: '총 실패', value: `${parseInt(cs.total_fail || '0').toLocaleString()}건` },
      ];

      const cardW = 113;
      const cardGap = 8;
      summaryMetrics.forEach((m, idx) => {
        const cx = 50 + idx * (cardW + cardGap);
        doc.rect(cx, y, cardW, 50).lineWidth(0.5).strokeColor('#e5e7eb').fillAndStroke('#fafafa', '#e5e7eb');
        setFont(false);
        doc.fontSize(8).fillColor(gray).text(m.label, cx + 8, y + 8, { width: cardW - 16 });
        setFont(true);
        doc.fontSize(14).fillColor(dark).text(m.value, cx + 8, y + 24, { width: cardW - 16 });
      });
      y += 65;
    }

    // 구분선
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
    y += 15;

    // 인사이트 목차
    setFont(true);
    doc.fontSize(12).fillColor(primary).text('분석 항목 목차', 50, y);
    y += 22;

    insights.forEach((insight, idx) => {
      const catColor = categoryColors[insight.category] || gray;
      setFont(false);
      doc.fontSize(9).fillColor(catColor).text(`${idx + 1}. `, 55, y, { continued: true });
      doc.fillColor(dark).text(insight.title);
      y += 16;
    });

    y += 10;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
    y += 15;

    // ============================
    // 인사이트 페이지들
    // ============================
    const renderInsight = (insight: AnalysisInsight, idx: number) => {
      // 페이지 넘김 체크 (최소 200px 필요)
      if (y + 200 > pageBottom) {
        doc.addPage();
        y = 50;
      }

      const catColor = categoryColors[insight.category] || gray;
      const catLabel = categoryLabels[insight.category] || insight.category;

      // 카테고리 뱃지 + 번호 + 제목
      doc.roundedRect(50, y, 50, 18, 3).fill(catColor);
      setFont(true);
      doc.fontSize(8).fillColor('white').text(catLabel, 52, y + 4, { width: 46, align: 'center' });
      doc.fontSize(13).fillColor(dark).text(`${idx + 1}. ${insight.title}`, 108, y - 1);
      y += 28;

      // Summary (강조 박스)
      const summaryHeight = doc.heightOfString(insight.summary, { width: pageWidth - 20, fontSize: 10 }) + 16;
      doc.rect(50, y, pageWidth, summaryHeight).fill('#f5f3ff');
      setFont(true);
      doc.fontSize(10).fillColor(primary).text(insight.summary, 60, y + 8, { width: pageWidth - 20 });
      y += summaryHeight + 8;

      // Details
      if (insight.details) {
        setFont(false);
        const detailHeight = doc.heightOfString(insight.details, { width: pageWidth, fontSize: 9 });
        if (y + detailHeight > pageBottom) {
          doc.addPage();
          y = 50;
        }
        doc.fontSize(9).fillColor(dark).text(insight.details, 50, y, { width: pageWidth, lineGap: 3 });
        y += detailHeight + 12;
      }

      // Key Metrics (테이블)
      if (insight.keyMetrics && insight.keyMetrics.length > 0) {
        if (y + 30 + insight.keyMetrics.length * 20 > pageBottom) {
          doc.addPage();
          y = 50;
        }

        setFont(true);
        doc.fontSize(9).fillColor(gray).text('주요 지표', 50, y);
        y += 16;

        // 헤더
        doc.rect(50, y, pageWidth, 18).fill('#f3f4f6');
        doc.fontSize(8).fillColor(gray);
        doc.text('지표', 60, y + 5, { width: 200 });
        doc.text('값', 300, y + 5, { width: 195, align: 'right' });
        y += 18;

        insight.keyMetrics.forEach((m, mi) => {
          if (mi % 2 === 0) doc.rect(50, y, pageWidth, 18).fill('#fafafa');
          setFont(false);
          doc.fontSize(8).fillColor(dark).text(m.label, 60, y + 5, { width: 200 });
          setFont(true);
          doc.text(m.value, 300, y + 5, { width: 195, align: 'right' });
          y += 18;
          doc.moveTo(50, y).lineTo(545, y).strokeColor('#f0f0f0').stroke();
        });
        y += 8;
      }

      // Recommendations
      if (insight.recommendations && insight.recommendations.length > 0) {
        if (y + 20 + insight.recommendations.length * 18 > pageBottom) {
          doc.addPage();
          y = 50;
        }

        setFont(true);
        doc.fontSize(9).fillColor(catColor).text('💡 추천사항', 50, y);
        y += 16;

        insight.recommendations.forEach((rec) => {
          if (y + 18 > pageBottom) {
            doc.addPage();
            y = 50;
          }
          setFont(false);
          const recHeight = doc.heightOfString(`• ${rec}`, { width: pageWidth - 15, fontSize: 9 });
          doc.fontSize(9).fillColor(dark).text(`• ${rec}`, 58, y, { width: pageWidth - 15, lineGap: 2 });
          y += recHeight + 4;
        });
        y += 8;
      }

      // 구분선
      if (y + 15 <= pageBottom) {
        doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
        y += 20;
      }
    };

    // 인사이트 렌더링
    insights.forEach((insight, idx) => {
      renderInsight(insight, idx);
    });

    // ============================
    // 마지막 페이지 — 푸터
    // ============================
    if (y + 60 > pageBottom) {
      doc.addPage();
      y = 50;
    }
    y += 10;
    doc.rect(50, y, pageWidth, 45).fill('#f8fafc');
    setFont(false);
    doc.fontSize(8).fillColor(gray);
    doc.text('본 리포트는 한줄로 AI 분석 시스템에서 자동 생성되었습니다.', 60, y + 8, { width: pageWidth - 20, align: 'center' });
    doc.text('데이터 기반 분석이며, 실제 마케팅 의사결정 시 추가 검토를 권장합니다.', 60, y + 20, { width: pageWidth - 20, align: 'center' });
    doc.text(`© ${new Date().getFullYear()} INVITO corp. (한줄로 hanjul.ai)`, 60, y + 32, { width: pageWidth - 20, align: 'center' });

    doc.end();
    await new Promise<void>((resolve) => stream.on('finish', resolve));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(pdfFilename)}"`);
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);

  } catch (error: any) {
    console.error('PDF 생성 실패:', error);
    res.status(500).json({ error: 'PDF 생성 실패', message: error.message });
  }
});

export default router;
