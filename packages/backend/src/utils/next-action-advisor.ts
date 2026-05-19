/**
 * ★ CT-25: Step 1 Next Action Advisor 컨트롤타워 — D174 (2026-05-19)
 *
 * 🎯 목적
 *   AI Operator의 "1회성 발송툴 탈출" 진정 가치 박는 영역.
 *   - 회사의 과거 30일 캠페인 성과 + 고객 RFM + CDP 이벤트(D172) 통합 분석
 *   - Opus 4.7이 다음 캠페인 자동 제안 (타겟 + 채널 + 시점 + 핵심 인사이트)
 *   - 기존 services/ai.ts recommendNextCampaign (Sonnet 4.6, PRO+ 게이팅)와 분리
 *     → 본 함수는 AI Operator 전용 (Opus 4.7, BUSINESS+ 베타)
 *
 * ⛔ 영구 원칙
 *   - 모델 분리 룰: Opus 4.7 박음 (Sonnet 4.6 흐름 영향 0건) — feedback_ai_operator_model_isolation.md
 *   - 타겟 0건 자동완화 X (Harold 영구 원칙) — feedback_no_target_auto_relax.md
 *   - 추천 결과는 사용자가 직접 검토 + 승인 후 발송 (AI 단독 발송 X)
 */

import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { aggregateCampaignPerformance } from './stats-aggregation';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface PerformanceSnapshot {
  /** 최근 30일 발송 캠페인 수 */
  totalCampaigns: number;
  /** 최근 30일 총 발송 건수 */
  totalSent: number;
  /** 최근 30일 총 발송 성공 건수 */
  totalSuccess: number;
  /** 성공률 = totalSuccess / totalSent */
  successRate: number;
  /** 채널별 성과 (sms/lms/mms/kakao) */
  byChannel: Array<{ channel: string; sent: number; success: number; successRate: number }>;
  /** 시간대별 성과 (hour bucket 0-23) */
  byHour: Array<{ hour: number; sent: number; successRate: number }>;
  /** 매출 영향 추정 (CDP cdp_events 'purchase' 박힘 시) */
  estimatedRevenue: number;
  /** 30일 신규 고객 (customers.created_at 또는 cdp_identity_links) */
  newCustomers30d: number;
  /** 30일 활성 고객 (CDP 이벤트 발생 또는 캠페인 수신) */
  activeCustomers30d: number;
}

export interface NextActionResult {
  /** 한 줄 요약 ("주말 저녁 8시 VIP 재구매 캠페인 추천 — 평균 성공률 +14%") */
  summary: string;
  /** 추천 타겟 (자연어) */
  recommendedAudience: string;
  /** 추천 채널 */
  recommendedChannel: 'SMS' | 'LMS' | 'MMS' | 'KAKAO';
  /** 추천 발송 시점 (ISO datetime) */
  recommendedTime: string;
  /** 핵심 인사이트 3~5개 */
  insights: string[];
  /** 다음 마케팅 목표 (AI Operator orchestrate에 박을 자연어 한 줄) */
  suggestedObjective: string;
  /** 추정 성과 (클릭률 / 전환율 / 매출) */
  expectedClickRate: number;
  expectedConversionRate: number;
  expectedRevenue: number;
  /** Opus 4.7 reasoning trace (Extended Thinking 활성 시) */
  reasoning?: string;
}

// ════════════════════════════════════════════════════════════════════
// Performance Snapshot 생성
// ════════════════════════════════════════════════════════════════════

export async function buildPerformanceSnapshot(companyId: string): Promise<PerformanceSnapshot> {
  // 1. 캠페인 성과 집계 (기존 stats-aggregation 활용)
  const performance = await aggregateCampaignPerformance(companyId);

  // 2. 채널별 성과
  const byChannelResult = await query(
    `SELECT
        message_type AS channel,
        SUM(success_count) AS success,
        SUM(success_count + fail_count) AS sent
     FROM campaigns
     WHERE company_id = $1::uuid
       AND status = 'completed'
       AND sent_at > NOW() - INTERVAL '30 days'
     GROUP BY message_type`,
    [companyId]
  );

  // 3. 시간대별 성과
  const byHourResult = await query(
    `SELECT
        EXTRACT(HOUR FROM (sent_at AT TIME ZONE 'Asia/Seoul'))::int AS hour,
        SUM(success_count + fail_count) AS sent,
        SUM(success_count)::float / NULLIF(SUM(success_count + fail_count), 0) AS success_rate
     FROM campaigns
     WHERE company_id = $1::uuid
       AND status = 'completed'
       AND sent_at > NOW() - INTERVAL '30 days'
     GROUP BY hour
     ORDER BY hour`,
    [companyId]
  );

  // 4. 매출 추정 (CDP purchase 이벤트 박힘 시)
  const revenueResult = await query(
    `SELECT COALESCE(SUM((properties->>'total_amount')::numeric), 0) AS total
     FROM cdp_events
     WHERE company_id = $1::uuid
       AND event_name = 'purchase'
       AND occurred_at > NOW() - INTERVAL '30 days'`,
    [companyId]
  );

  // 5. 신규/활성 고객
  const customerStats = await query(
    `SELECT
        (SELECT COUNT(*)::int FROM customers WHERE company_id = $1::uuid AND created_at > NOW() - INTERVAL '30 days') AS new_customers,
        (SELECT COUNT(DISTINCT customer_id)::int FROM cdp_events WHERE company_id = $1::uuid AND occurred_at > NOW() - INTERVAL '30 days' AND customer_id IS NOT NULL) AS active_via_cdp,
        (SELECT COUNT(DISTINCT customer_id)::int FROM campaign_runs cr JOIN campaigns c ON cr.campaign_id = c.id WHERE c.company_id = $1::uuid AND cr.created_at > NOW() - INTERVAL '30 days') AS active_via_campaign`,
    [companyId]
  );

  const stats = customerStats.rows[0];
  const activeCustomers = Math.max(parseInt(stats.active_via_cdp || '0'), parseInt(stats.active_via_campaign || '0'));

  const totalCampaigns = (performance as any).total_campaigns || 0;
  const totalSent = (performance as any).total_sent || 0;
  const totalSuccess = (performance as any).total_success || 0;

  return {
    totalCampaigns,
    totalSent,
    totalSuccess,
    successRate: totalSent > 0 ? totalSuccess / totalSent : 0,
    byChannel: byChannelResult.rows.map((r: any) => ({
      channel: r.channel || 'SMS',
      sent: parseInt(r.sent || '0'),
      success: parseInt(r.success || '0'),
      successRate: parseInt(r.sent || '0') > 0 ? parseInt(r.success || '0') / parseInt(r.sent || '0') : 0,
    })),
    byHour: byHourResult.rows.map((r: any) => ({
      hour: r.hour,
      sent: parseInt(r.sent || '0'),
      successRate: parseFloat(r.success_rate || '0'),
    })),
    estimatedRevenue: parseFloat(revenueResult.rows[0]?.total || '0'),
    newCustomers30d: parseInt(stats.new_customers || '0'),
    activeCustomers30d: activeCustomers,
  };
}

// ════════════════════════════════════════════════════════════════════
// AI 호출 — Opus 4.7 (AI Operator 영역, 모델 분리 룰 정합)
// ════════════════════════════════════════════════════════════════════

export async function recommendNextAction(
  companyId: string,
  snapshot: PerformanceSnapshot,
  companyInfo: { company_name?: string; brand_name?: string; business_type?: string; brand_tone?: string }
): Promise<NextActionResult> {
  const brandName = companyInfo.brand_name || companyInfo.company_name || '브랜드';
  const businessType = companyInfo.business_type || '기타';

  const system = `당신은 CRM 마케팅 데이터 분석 전문가입니다.
회사의 최근 30일 캠페인 성과 + 고객 데이터를 분석하여 다음 캠페인을 추천합니다.

영구 원칙:
- 타겟 매칭 0건 시 자동완화 절대 금지. 사용자에게 조건 재입력 안내만 박을 것.
- 추천 시점은 한국 표준시(KST) 기준 08:00~21:00 사이만 박을 것.
- 추천 결과는 사용자가 직접 검토 + 승인 후 발송. AI 단독 발송 X.

JSON 형식으로만 응답하세요.`;

  const userMessage = `## 회사 정보
- 회사명: ${brandName}
- 업종: ${businessType}
- 브랜드 톤: ${companyInfo.brand_tone || '친근함'}

## 최근 30일 캠페인 성과
- 발송 캠페인 수: ${snapshot.totalCampaigns}개
- 총 발송 건수: ${snapshot.totalSent.toLocaleString()}건
- 성공 건수: ${snapshot.totalSuccess.toLocaleString()}건 (성공률 ${(snapshot.successRate * 100).toFixed(1)}%)
- 채널별:
${snapshot.byChannel.map((c) => `  · ${c.channel}: ${c.sent.toLocaleString()}건 (성공률 ${(c.successRate * 100).toFixed(1)}%)`).join('\n')}
- 시간대별 (상위 5):
${snapshot.byHour.sort((a, b) => b.sent - a.sent).slice(0, 5).map((h) => `  · ${h.hour}시: ${h.sent.toLocaleString()}건 (성공률 ${(h.successRate * 100).toFixed(1)}%)`).join('\n')}

## 자사몰 CDP 데이터 (있을 시)
- 30일 추정 매출: ${snapshot.estimatedRevenue.toLocaleString()}원
- 30일 신규 고객: ${snapshot.newCustomers30d.toLocaleString()}명
- 30일 활성 고객 (이벤트 발생): ${snapshot.activeCustomers30d.toLocaleString()}명

## 요청
위 데이터를 분석해 다음 캠페인을 추천해주세요:
1. 한 줄 요약 (예: "주말 저녁 8시 VIP 재구매 캠페인 추천 — 평균 성공률 +14% 기대")
2. 추천 타겟 (자연어 한 줄, AI Operator orchestrate에 입력 가능한 형식)
3. 추천 채널 (SMS / LMS / MMS / KAKAO 중 하나)
4. 추천 발송 시점 (다음 7일 내 KST 08~21시 1개)
5. 핵심 인사이트 3~5개 (데이터 기반, 구체 수치 포함)
6. 다음 마케팅 목표 자연어 한 줄 (AI Operator 자연어 입력칸에 박을 형식)
7. 추정 성과 (클릭률 0.01~0.10, 전환율 0.001~0.05, 매출 원화)

## 출력 형식 (JSON만 응답)
{
  "summary": "한 줄 요약",
  "recommendedAudience": "자연어 타겟 설명",
  "recommendedChannel": "SMS|LMS|MMS|KAKAO",
  "recommendedTime": "YYYY-MM-DDTHH:mm:00+09:00",
  "insights": ["인사이트1", "인사이트2", ...],
  "suggestedObjective": "다음 캠페인 마케팅 목표 자연어 한 줄",
  "expectedClickRate": 0.04,
  "expectedConversionRate": 0.012,
  "expectedRevenue": 1500000
}`;

  try {
    const text = await callAIWithFallback({
      system,
      userMessage,
      maxTokens: 2048,
      temperature: 0.3,
      model: 'opus',  // ★ AI Operator 영역 — Opus 4.7 박음 (Harold 모델 분리 룰)
    });

    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const parsed = JSON.parse(jsonStr);
    void companyId; // 추후 회사별 운영 로그 추가 영역
    return {
      summary: String(parsed.summary || ''),
      recommendedAudience: String(parsed.recommendedAudience || ''),
      recommendedChannel: (['SMS', 'LMS', 'MMS', 'KAKAO'].includes(parsed.recommendedChannel) ? parsed.recommendedChannel : 'SMS') as NextActionResult['recommendedChannel'],
      recommendedTime: String(parsed.recommendedTime || ''),
      insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 5).map(String) : [],
      suggestedObjective: String(parsed.suggestedObjective || ''),
      expectedClickRate: typeof parsed.expectedClickRate === 'number' ? parsed.expectedClickRate : 0.03,
      expectedConversionRate: typeof parsed.expectedConversionRate === 'number' ? parsed.expectedConversionRate : 0.008,
      expectedRevenue: typeof parsed.expectedRevenue === 'number' ? parsed.expectedRevenue : 0,
    };
  } catch (err) {
    console.error('[NextActionAdvisor] AI 호출 실패:', err);
    return {
      summary: '캠페인 추천 생성에 실패했습니다. 잠시 후 다시 시도해주세요.',
      recommendedAudience: '',
      recommendedChannel: 'SMS',
      recommendedTime: '',
      insights: ['AI 응답 처리 중 오류가 발생했습니다.'],
      suggestedObjective: '',
      expectedClickRate: 0,
      expectedConversionRate: 0,
      expectedRevenue: 0,
    };
  }
}
