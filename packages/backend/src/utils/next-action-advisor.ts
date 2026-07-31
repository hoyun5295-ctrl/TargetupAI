/**
 * ★ CT-25: Step 1 Next Action Advisor 컨트롤타워 — D174 (2026-05-19)
 *
 * 🎯 목적
 *   AI Operator의 "1회성 발송툴 탈출" 핵심 가치를 담는 부분.
 *   - 회사의 과거 30일 캠페인 성과 + 고객 RFM + CDP 이벤트(D172) 통합 분석
 *   - Opus 4.7이 다음 캠페인 자동 제안 (타겟 + 채널 + 시점 + 핵심 인사이트)
 *   - 기존 services/ai.ts recommendNextCampaign (Sonnet 4.6, PRO+ 게이팅)와 분리
 *     → 본 함수는 AI Operator 전용 (Opus 4.7, BUSINESS+ 베타)
 *
 * ⛔ 영구 원칙
 *   - 모델 분리 룰: Opus 4.7 적용 (Sonnet 4.6 흐름 영향 0건) — feedback_ai_operator_model_isolation.md
 *   - 타겟 0건 자동완화 X (Harold 영구 원칙) — feedback_no_target_auto_relax.md
 *   - 추천 결과는 사용자가 직접 검토 + 승인 후 발송 (AI 단독 발송 X)
 */

import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { aggregateCampaignPerformance, aggregateSmsCountsByCampaign } from './stats-aggregation';
// (2026-07-30) 브랜드 SMSQ 합류 — 옛 카카오 IMC 집계 import 폐기
import { computeRoasMetric } from './performance-roas-core';
import { getCompanyCosts } from '../config/defaults';
import { channelPlainLabel } from './campaign-list-csv';
import type { RoasMetric } from './performance-roas-core';

/**
 * (순수) `(send_channel, message_type)` 집계 행 → 채널 라벨 단위 합산.
 *
 * 브랜드메시지는 채널값이 둘이고(`kakao`는 역사적 이름, `kakao_brand`는 전용 발송) 알림톡·브랜드가
 * 전부 `message_type='LMS'`다. 라벨로 합쳐야 "브랜드메시지 N건"이 한 줄로 나온다.
 * 발송량 내림차순 — AI 프롬프트에서 큰 채널이 먼저 읽히게 한다.
 */
export function mergeByChannelLabel(
  rows: Array<{ send_channel?: string | null; message_type?: string | null; sent?: any; success?: any }>,
): Array<{ channel: string; sent: number; success: number; successRate: number }> {
  const agg = new Map<string, { sent: number; success: number }>();
  for (const r of rows) {
    const label = channelPlainLabel(r.send_channel, r.message_type);
    const e = agg.get(label) || { sent: 0, success: 0 };
    e.sent += parseInt(r.sent || '0', 10) || 0;
    e.success += parseInt(r.success || '0', 10) || 0;
    agg.set(label, e);
  }
  return Array.from(agg.entries())
    .map(([channel, v]) => ({
      channel,
      sent: v.sent,
      success: v.success,
      successRate: v.sent > 0 ? v.success / v.sent : 0,
    }))
    .sort((a, b) => b.sent - a.sent);
}

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
  /** 매출 영향 추정 (CDP cdp_events 'purchase' 적재 시) */
  estimatedRevenue: number;
  /** 30일 신규 고객 (customers.created_at 또는 cdp_identity_links) */
  newCustomers30d: number;
  /** 30일 활성 고객 (CDP 이벤트 발생 또는 캠페인 수신) */
  activeCustomers30d: number;
  // ★ D210+ Phase 3 B-2 (2026-05-23 Harold 명시): cdp_events 4 type funnel 영역
  funnelStats?: FunnelStats;
}

// ★ D210+ Phase 3 B-2 (2026-05-23 Harold 명시): cdp_events 4 type funnel 매트릭스
//   view → cart_add → wishlist_add → purchase 영역 dropout 영역 분석
export interface FunnelStats {
  viewCount: number;
  cartAddCount: number;
  wishlistAddCount: number;
  purchaseCount: number;
  cartConversionRate: number;      // cart_add / view
  purchaseConversionRate: number;  // purchase / view
  cartToPurchaseRate: number;      // purchase / cart_add
}

export async function buildFunnelStats(companyId: string, days = 30): Promise<FunnelStats> {
  const r = await query(
    `SELECT
       COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS view_count,
       COUNT(*) FILTER (WHERE event_name = 'cart_add')::int AS cart_count,
       COUNT(*) FILTER (WHERE event_name = 'wishlist_add')::int AS wishlist_count,
       COUNT(*) FILTER (WHERE event_name IN ('order', 'purchase'))::int AS purchase_count
     FROM cdp_events
     WHERE company_id = $1::uuid
       AND occurred_at > NOW() - ($2 || ' days')::interval`,
    [companyId, days]
  );
  const row = r.rows[0] || {};
  const viewCount = Number(row.view_count) || 0;
  const cartAddCount = Number(row.cart_count) || 0;
  const wishlistAddCount = Number(row.wishlist_count) || 0;
  const purchaseCount = Number(row.purchase_count) || 0;
  return {
    viewCount,
    cartAddCount,
    wishlistAddCount,
    purchaseCount,
    cartConversionRate: viewCount > 0 ? cartAddCount / viewCount : 0,
    purchaseConversionRate: viewCount > 0 ? purchaseCount / viewCount : 0,
    cartToPurchaseRate: cartAddCount > 0 ? purchaseCount / cartAddCount : 0,
  };
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
  /** 다음 마케팅 목표 (AI Operator orchestrate에 전달할 자연어 한 줄) */
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
  // ★ 2026-07-31 정정. 전에는 `message_type AS channel`로 묶었는데, 이 시스템은 카카오를
  //   message_type이 아니라 send_channel로 구분한다 — 알림톡·브랜드메시지가 전부 'LMS'로 저장되므로
  //   그 묶음은 **채널이 아니라 문자 규격**이었고, 세 채널이 LMS 한 줄로 합쳐져 AI에게 들어갔다.
  //   두 컬럼으로 묶은 뒤 채널 라벨 CT로 합산한다(kakao·kakao_brand가 같은 라벨로 수렴).
  const byChannelResult = await query(
    `SELECT
        send_channel,
        message_type,
        SUM(success_count) AS success,
        SUM(success_count + fail_count) AS sent
     FROM campaigns
     WHERE company_id = $1::uuid
       AND status = 'completed'
       AND sent_at > NOW() - INTERVAL '30 days'
     GROUP BY send_channel, message_type`,
    [companyId]
  );

  // 3. 시간대별 성과
  // D183 fix: 성공률 영역 = success / sent (대기 영역 포함 분모) — 사용자 관점 정합
  const byHourResult = await query(
    `SELECT
        EXTRACT(HOUR FROM (sent_at AT TIME ZONE 'Asia/Seoul'))::int AS hour,
        SUM(sent_count) AS sent,
        SUM(success_count)::float / NULLIF(SUM(sent_count), 0) AS success_rate
     FROM campaigns
     WHERE company_id = $1::uuid
       AND status = 'completed'
       AND sent_at > NOW() - INTERVAL '30 days'
     GROUP BY hour
     ORDER BY hour`,
    [companyId]
  );

  // 4. 매출 추정 (CDP purchase 이벤트 적재 시)
  const revenueResult = await query(
    `SELECT COALESCE(SUM((properties->>'total_amount')::numeric), 0) AS total
     FROM cdp_events
     WHERE company_id = $1::uuid
       AND event_name = 'purchase'
       AND occurred_at > NOW() - INTERVAL '30 days'`,
    [companyId]
  );

  // 5. 신규/활성 고객
  // D183 fix: campaign_runs / campaigns 영역 customer_id 컬럼 부재 (SCHEMA L152-215 검증) → active_via_campaign 영역 영구 제거.
  // 실제 활성 고객 기준 = cdp_events 행동(purchase / page_view / cart_add 등) 일치.
  const customerStats = await query(
    `SELECT
        (SELECT COUNT(*)::int FROM customers WHERE company_id = $1::uuid AND created_at > NOW() - INTERVAL '30 days') AS new_customers,
        (SELECT COUNT(DISTINCT customer_id)::int FROM cdp_events WHERE company_id = $1::uuid AND occurred_at > NOW() - INTERVAL '30 days' AND customer_id IS NOT NULL) AS active_via_cdp`,
    [companyId]
  );

  const stats = customerStats.rows[0];
  const activeCustomers = parseInt(stats.active_via_cdp || '0');

  // ★ D210+ Phase 3 B-2 (2026-05-23 Harold 명시): cdp_events 4 type funnel 영역 통합
  const funnelStats = await buildFunnelStats(companyId, 30).catch(() => undefined);

  const totalCampaigns = (performance as any).total_campaigns || 0;
  const totalSent = (performance as any).total_sent || 0;
  const totalSuccess = (performance as any).total_success || 0;

  return {
    totalCampaigns,
    totalSent,
    totalSuccess,
    successRate: totalSent > 0 ? totalSuccess / totalSent : 0,
    byChannel: mergeByChannelLabel(byChannelResult.rows),
    byHour: byHourResult.rows.map((r: any) => ({
      hour: r.hour,
      sent: parseInt(r.sent || '0'),
      successRate: parseFloat(r.success_rate || '0'),
    })),
    estimatedRevenue: parseFloat(revenueResult.rows[0]?.total || '0'),
    newCustomers30d: parseInt(stats.new_customers || '0'),
    activeCustomers30d: activeCustomers,
    // ★ D210+ Phase 3 B-2 (2026-05-23 Harold 명시): cdp_events 4 type funnel 응답 통합
    funnelStats,
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
- 타겟 매칭 0건 시 자동완화 절대 금지. 사용자에게 조건 재입력 안내만 제시할 것.
- 추천 시점은 한국 표준시(KST) 기준 08:00~21:00 사이만 제안할 것.
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
6. 다음 마케팅 목표 자연어 한 줄 (AI Operator 자연어 입력칸에 넣을 형식)
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
      // ★ D209+ (Harold 명시 2026-05-22): Sonnet 4.6 전환 — 다음 캠페인 단순 추천 영역. 비용 80% 절감.
      //   Phase D 통합: companyId + source 전달 → 회사별 월 한도 + cache + 통계 자동 활성.
      model: 'sonnet',
      companyId,
      source: 'next-action-advisor',
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

// ════════════════════════════════════════════════════════════════════
// ★ D213+ (2026-05-24) buildPerformanceSnapshotV2 신설
//   D144 정합 = MySQL 큐 직접 집계 (옛 PG c.success_count 캐시 폐기)
//   기간 매트릭스 = current + previous 2 윈도우 (격차 자동 계산)
//   추가 영역 = byChannelROI + byHourWeekday + byDailyTrend + topCampaigns
//
//   ⛔ 옛 buildPerformanceSnapshot (line 113~199) 영역 = /operator/next-action endpoint 영역 호환 유지
//   본 V2 영역 = 4번 메뉴 성과리포트 (/performance) 전용 신규
// ════════════════════════════════════════════════════════════════════

export type PerformancePeriod = '7d' | '14d' | '30d' | '90d';

const PERIOD_DAYS: Record<PerformancePeriod, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
};

export interface PerformanceMetricV2 {
  current: number;
  previous: number;
  diffPct: number;          // (current - previous) / previous × 100 (previous=0 → 100 또는 0)
  betterThan: boolean;
}

export interface PerformanceChannelROI {
  channel: string;
  sent: number;
  success: number;
  successRate: number;
  estimatedRevenue: number;  // 회사 전체 매출 × (채널 sent / 전체 sent)
  estimatedCost: number;
  roas: number;              // revenue / cost
  previousSent: number;      // 이전 윈도우 비교용
}

export interface PerformanceTrend {
  date: string;              // 'YYYY-MM-DD' (KST)
  sent: number;
  success: number;
}

export interface PerformanceTopCampaign {
  id: string;
  name: string;
  messageType: string;
  sent: number;
  success: number;
  successRate: number;
  estimatedRevenue: number;
  roas: number;
  sentAt: string;
  isAd: boolean;
}

export interface HourWeekdayCell {
  hour: number;             // 0~23
  weekday: number;          // 0~6 (0=일)
  sent: number;
  successRate: number;
}

export interface PerformanceSnapshotV2 {
  period: PerformancePeriod;
  periodDays: number;
  // 요약 6 metric (current + previous 격차)
  totalCampaigns: PerformanceMetricV2;
  totalSent: PerformanceMetricV2;
  successRate: PerformanceMetricV2;
  newCustomers: PerformanceMetricV2;
  activeCustomers: PerformanceMetricV2;
  estimatedRevenue: PerformanceMetricV2;
  estimatedRoas: RoasMetric;  // 블렌디드 ROAS (기간 매출 ÷ 기간 비용). 헤드라인 ROAS 카드용
  // 자세히 매트릭스
  byChannelROI: PerformanceChannelROI[];
  byHourWeekday: HourWeekdayCell[];
  byDailyTrend: PerformanceTrend[];
  byDailyTrendPrevious: PerformanceTrend[];
  funnelStats?: FunnelStats;
  topCampaigns: PerformanceTopCampaign[];
  computedAt: string;
  source: string;
}

/**
 * ★ 2026-07-26 인라인 중복 정의를 폐기하고 컨트롤타워(`config/defaults.getCompanyCosts`)로 흡수했다.
 *   같은 이름의 함수가 두 벌이라, 부가세 기준(`unit_price_basis`)을 CT에만 반영하면
 *   이 화면만 조용히 옛 기준으로 남는다. 폴백 상수도 CT의 `DEFAULT_COSTS` 하나로 통일된다.
 */
async function loadCompanyCosts(companyId: string): Promise<{ sms: number; lms: number; mms: number; kakao: number }> {
  const r = await query(
    `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, unit_price_basis
       FROM companies WHERE id = $1::uuid`,
    [companyId]
  );
  return getCompanyCosts(r.rows[0] || {});
}

function calcDiffPct(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

/**
 * buildPerformanceSnapshotV2 — D144 정합 + 기간 매트릭스 + 추가 영역.
 *
 * @param companyId - 회사 ID
 * @param period - '7d' | '14d' | '30d' | '90d' (default '30d')
 */
export async function buildPerformanceSnapshotV2(
  companyId: string,
  period: PerformancePeriod = '30d'
): Promise<PerformanceSnapshotV2> {
  const days = PERIOD_DAYS[period];
  const costs = await loadCompanyCosts(companyId);

  // 1) 캠페인 메타 조회 (current + previous 2 윈도우)
  //    current  = NOW() - $days ~ NOW()
  //    previous = NOW() - $days*2 ~ NOW() - $days
  const campaignsResult = await query(
    `SELECT
        id, company_id, created_by, message_type, sent_at,
        campaign_name, is_ad,
        CASE
          WHEN sent_at > NOW() - ($1 || ' days')::interval THEN 'current'
          ELSE 'previous'
        END AS period_bucket
      FROM campaigns
      WHERE company_id = $2::uuid
        AND status = 'completed'
        AND sent_at IS NOT NULL
        AND sent_at > NOW() - ($3 || ' days')::interval`,
    [days, companyId, days * 2]
  );

  const allCampaigns = campaignsResult.rows;

  // 2) MySQL 큐 직접 집계 (D144 정합) — 전체 캠페인 일괄 처리
  // ★ 2026-07-30: 브랜드 행(msg_type='F')이 SMSQ 합류 — SMS 집계 하나가 전 채널을 담는다.
  const smsCountMap = await aggregateSmsCountsByCampaign(allCampaigns as any);

  type CampaignMetric = {
    id: string;
    name: string;
    messageType: string;
    sent: number;
    success: number;
    fail: number;
    cost: number;
    sentAt: Date;
    isAd: boolean;
    bucket: 'current' | 'previous';
  };

  const campaignMetrics: CampaignMetric[] = allCampaigns.map((c: any) => {
    const sms = smsCountMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0 };
    const sent = Number(sms.total_count || 0);
    const success = Number(sms.success_count || 0);
    const fail = Number(sms.fail_count || 0);
    const channelRaw = String(c.message_type || 'SMS').toUpperCase();
    // 'S' → 'SMS', 'L' → 'LMS', 'M' → 'MMS' 변환
    const channel =
      channelRaw === 'S' ? 'SMS' :
      channelRaw === 'L' ? 'LMS' :
      channelRaw === 'M' ? 'MMS' :
      channelRaw === 'K' ? 'KAKAO' :
      channelRaw;
    let unitCost = costs.sms;
    if (channel === 'LMS') unitCost = costs.lms;
    else if (channel === 'MMS') unitCost = costs.mms;
    else if (channel === 'KAKAO') unitCost = costs.kakao;
    return {
      id: c.id,
      name: c.campaign_name || '',
      messageType: channel,
      sent,
      success,
      fail,
      cost: success * unitCost,
      sentAt: new Date(c.sent_at),
      isAd: Boolean(c.is_ad),
      bucket: c.period_bucket as 'current' | 'previous',
    };
  });

  const currentMetrics = campaignMetrics.filter((m) => m.bucket === 'current');
  const previousMetrics = campaignMetrics.filter((m) => m.bucket === 'previous');

  // 3) 요약 metric 합산
  const sumSent = (arr: CampaignMetric[]) => arr.reduce((s, m) => s + m.sent, 0);
  const sumSuccess = (arr: CampaignMetric[]) => arr.reduce((s, m) => s + m.success, 0);

  const currentSent = sumSent(currentMetrics);
  const currentSuccess = sumSuccess(currentMetrics);
  const previousSent = sumSent(previousMetrics);
  const previousSuccess = sumSuccess(previousMetrics);

  // 4) 매출 영역 (CDP cdp_events.purchase / order)
  const revenueResult = await query(
    `SELECT
        CASE
          WHEN occurred_at > NOW() - ($1 || ' days')::interval THEN 'current'
          ELSE 'previous'
        END AS bucket,
        COALESCE(SUM((properties->>'total_amount')::numeric), 0)::float AS revenue
      FROM cdp_events
      WHERE company_id = $2::uuid
        AND event_name IN ('purchase', 'order')
        AND occurred_at > NOW() - ($3 || ' days')::interval
      GROUP BY bucket`,
    [days, companyId, days * 2]
  );
  const revenueMap = new Map<string, number>();
  for (const r of revenueResult.rows) revenueMap.set(String(r.bucket), Number(r.revenue) || 0);
  const currentRevenue = revenueMap.get('current') || 0;
  const previousRevenue = revenueMap.get('previous') || 0;

  // 5) 신규 / 활성 고객 영역
  const newCustomersResult = await query(
    `SELECT
        COUNT(*) FILTER (WHERE created_at > NOW() - ($1 || ' days')::interval)::int AS current_new,
        COUNT(*) FILTER (WHERE created_at > NOW() - ($2 || ' days')::interval AND created_at <= NOW() - ($1 || ' days')::interval)::int AS previous_new
      FROM customers
      WHERE company_id = $3::uuid`,
    [days, days * 2, companyId]
  );
  const currentNew = Number(newCustomersResult.rows[0]?.current_new) || 0;
  const previousNew = Number(newCustomersResult.rows[0]?.previous_new) || 0;

  const activeCustomersResult = await query(
    `SELECT
        COUNT(DISTINCT customer_id) FILTER (WHERE occurred_at > NOW() - ($1 || ' days')::interval AND customer_id IS NOT NULL)::int AS current_active,
        COUNT(DISTINCT customer_id) FILTER (WHERE occurred_at > NOW() - ($2 || ' days')::interval AND occurred_at <= NOW() - ($1 || ' days')::interval AND customer_id IS NOT NULL)::int AS previous_active
      FROM cdp_events
      WHERE company_id = $3::uuid`,
    [days, days * 2, companyId]
  );
  const currentActive = Number(activeCustomersResult.rows[0]?.current_active) || 0;
  const previousActive = Number(activeCustomersResult.rows[0]?.previous_active) || 0;

  // 6) byChannelROI
  const channelMap = new Map<string, { sent: number; success: number; cost: number; previousSent: number }>();
  for (const m of currentMetrics) {
    if (!channelMap.has(m.messageType)) channelMap.set(m.messageType, { sent: 0, success: 0, cost: 0, previousSent: 0 });
    const v = channelMap.get(m.messageType)!;
    v.sent += m.sent;
    v.success += m.success;
    v.cost += m.cost;
  }
  for (const m of previousMetrics) {
    if (!channelMap.has(m.messageType)) channelMap.set(m.messageType, { sent: 0, success: 0, cost: 0, previousSent: 0 });
    channelMap.get(m.messageType)!.previousSent += m.sent;
  }
  const byChannelROI: PerformanceChannelROI[] = Array.from(channelMap.entries()).map(([channel, v]) => {
    const channelRevenue = currentRevenue > 0 && currentSent > 0 ? currentRevenue * (v.sent / currentSent) : 0;
    return {
      channel,
      sent: v.sent,
      success: v.success,
      successRate: v.sent > 0 ? v.success / v.sent : 0,
      estimatedRevenue: channelRevenue,
      estimatedCost: v.cost,
      roas: v.cost > 0 ? channelRevenue / v.cost : 0,
      previousSent: v.previousSent,
    };
  });

  // ★ 2026-07-03 고객 축 — EMAIL·DM 채널 행 합류 (집계 원천이 campaigns 밖이라 별도 조회)
  //   EMAIL: email_campaigns 집계(발송/열람/클릭 — 발송 무료 정책이라 비용 0, success=열람).
  //   DM: dm_recipient_tokens 수신 고객 + dm_views 열람 고객(success=열람). 발송 문자분은 SMS 행에
  //   이미 포함(createDirectSendCampaign 경유)이라 DM 행은 "열람 축" — 이중 계상 아님(라벨로 명시).
  //   실패 시 skip — 기존 채널 행 영향 0. (컬럼 = information_schema 2026-07-03 실측)
  try {
    const emailAgg = await query(
      `SELECT CASE WHEN sent_at > NOW() - ($1 || ' days')::interval THEN 'current' ELSE 'previous' END AS bucket,
              COALESCE(SUM(sent_count), 0)::int AS sent,
              COALESCE(SUM(open_count), 0)::int AS opens
         FROM email_campaigns
        WHERE company_id = $2::uuid
          AND sent_at IS NOT NULL
          AND sent_at > NOW() - ($3 || ' days')::interval
        GROUP BY 1`,
      [days, companyId, days * 2]
    );
    const emailCur = emailAgg.rows.find((r: any) => r.bucket === 'current');
    const emailPrev = emailAgg.rows.find((r: any) => r.bucket === 'previous');
    const emailSent = Number(emailCur?.sent) || 0;
    const emailOpens = Number(emailCur?.opens) || 0;
    if (emailSent > 0 || Number(emailPrev?.sent) > 0) {
      byChannelROI.push({
        channel: 'EMAIL',
        sent: emailSent,
        success: emailOpens,
        successRate: emailSent > 0 ? emailOpens / emailSent : 0,
        estimatedRevenue: 0,
        estimatedCost: 0,
        roas: 0,
        previousSent: Number(emailPrev?.sent) || 0,
      });
    }

    const dmAgg = await query(
      `SELECT CASE WHEN created_at > NOW() - ($1 || ' days')::interval THEN 'current' ELSE 'previous' END AS bucket,
              COUNT(DISTINCT customer_id)::int AS recipients
         FROM dm_recipient_tokens
        WHERE company_id = $2::uuid
          AND created_at > NOW() - ($3 || ' days')::interval
        GROUP BY 1`,
      [days, companyId, days * 2]
    );
    const dmCur = dmAgg.rows.find((r: any) => r.bucket === 'current');
    const dmPrev = dmAgg.rows.find((r: any) => r.bucket === 'previous');
    const dmRecipients = Number(dmCur?.recipients) || 0;
    if (dmRecipients > 0 || Number(dmPrev?.recipients) > 0) {
      const dmViewersResult = await query(
        `SELECT COUNT(DISTINCT t.customer_id)::int AS viewers
           FROM dm_views v
           JOIN dm_recipient_tokens t ON t.token = v.recipient_token
          WHERE v.company_id = $1::uuid
            AND v.recipient_token IS NOT NULL
            AND v.viewed_at > NOW() - ($2 || ' days')::interval`,
        [companyId, days]
      );
      const dmViewers = Number(dmViewersResult.rows[0]?.viewers) || 0;
      byChannelROI.push({
        channel: 'DM',
        sent: dmRecipients,
        success: dmViewers,
        successRate: dmRecipients > 0 ? dmViewers / dmRecipients : 0,
        estimatedRevenue: 0,
        estimatedCost: 0,
        roas: 0,
        previousSent: Number(dmPrev?.recipients) || 0,
      });
    }
  } catch (e: any) {
    console.log('[snapshot-v2] EMAIL/DM 채널 행 skip:', e?.message || e);
  }

  // 7) byHourWeekday (24 × 7 매트릭스, KST)
  const hourWeekdayMap = new Map<string, { sent: number; success: number }>();
  for (const m of currentMetrics) {
    const kst = new Date(m.sentAt.getTime() + 9 * 3600 * 1000);
    const hour = kst.getUTCHours();
    const weekday = kst.getUTCDay();
    const key = `${hour}-${weekday}`;
    if (!hourWeekdayMap.has(key)) hourWeekdayMap.set(key, { sent: 0, success: 0 });
    const v = hourWeekdayMap.get(key)!;
    v.sent += m.sent;
    v.success += m.success;
  }
  const byHourWeekday: HourWeekdayCell[] = [];
  for (let h = 0; h < 24; h++) {
    for (let w = 0; w < 7; w++) {
      const v = hourWeekdayMap.get(`${h}-${w}`) || { sent: 0, success: 0 };
      byHourWeekday.push({ hour: h, weekday: w, sent: v.sent, successRate: v.sent > 0 ? v.success / v.sent : 0 });
    }
  }

  // 8) byDailyTrend (current + previous overlay 영역)
  function buildDailyTrend(metrics: CampaignMetric[], offsetDays: number): PerformanceTrend[] {
    const dailyMap = new Map<string, { sent: number; success: number }>();
    for (const m of metrics) {
      const kst = new Date(m.sentAt.getTime() + 9 * 3600 * 1000);
      const dateStr = kst.toISOString().substring(0, 10);
      if (!dailyMap.has(dateStr)) dailyMap.set(dateStr, { sent: 0, success: 0 });
      const v = dailyMap.get(dateStr)!;
      v.sent += m.sent;
      v.success += m.success;
    }
    const result: PerformanceTrend[] = [];
    const today = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(today.getTime() - (i + offsetDays) * 24 * 3600 * 1000);
      const kst = new Date(d.getTime() + 9 * 3600 * 1000);
      const dateStr = kst.toISOString().substring(0, 10);
      const v = dailyMap.get(dateStr) || { sent: 0, success: 0 };
      result.push({ date: dateStr, sent: v.sent, success: v.success });
    }
    return result.reverse();
  }
  const byDailyTrend = buildDailyTrend(currentMetrics, 0);
  const byDailyTrendPrevious = buildDailyTrend(previousMetrics, days);

  // 9) topCampaigns (current 영역 top 10)
  const topCampaigns: PerformanceTopCampaign[] = [...currentMetrics]
    .filter((m) => m.sent > 0)
    .sort((a, b) => b.success - a.success)
    .slice(0, 10)
    .map((m) => {
      const campaignRevenue = currentRevenue > 0 && currentSent > 0 ? currentRevenue * (m.sent / currentSent) : 0;
      return {
        id: m.id,
        name: m.name,
        messageType: m.messageType,
        sent: m.sent,
        success: m.success,
        successRate: m.sent > 0 ? m.success / m.sent : 0,
        estimatedRevenue: campaignRevenue,
        roas: m.cost > 0 ? campaignRevenue / m.cost : 0,
        sentAt: m.sentAt.toISOString(),
        isAd: m.isAd,
      };
    });

  // 10) funnelStats (CDP)
  const funnelStats = await buildFunnelStats(companyId, days).catch(() => undefined);

  const currentSuccessRate = currentSent > 0 ? currentSuccess / currentSent : 0;
  const previousSuccessRate = previousSent > 0 ? previousSuccess / previousSent : 0;

  // 블렌디드 ROAS (기간 전체 매출 ÷ 기간 전체 비용) — 헤드라인 ROAS 카드
  const currentCost = currentMetrics.reduce((s, m) => s + m.cost, 0);
  const previousCost = previousMetrics.reduce((s, m) => s + m.cost, 0);
  const estimatedRoas = computeRoasMetric(currentRevenue, currentCost, previousRevenue, previousCost);

  return {
    period,
    periodDays: days,
    totalCampaigns: {
      current: currentMetrics.length,
      previous: previousMetrics.length,
      diffPct: calcDiffPct(currentMetrics.length, previousMetrics.length),
      betterThan: currentMetrics.length > previousMetrics.length,
    },
    totalSent: {
      current: currentSent,
      previous: previousSent,
      diffPct: calcDiffPct(currentSent, previousSent),
      betterThan: currentSent > previousSent,
    },
    successRate: {
      current: currentSuccessRate,
      previous: previousSuccessRate,
      diffPct: calcDiffPct(currentSuccessRate, previousSuccessRate),
      betterThan: currentSuccessRate > previousSuccessRate,
    },
    newCustomers: {
      current: currentNew,
      previous: previousNew,
      diffPct: calcDiffPct(currentNew, previousNew),
      betterThan: currentNew > previousNew,
    },
    activeCustomers: {
      current: currentActive,
      previous: previousActive,
      diffPct: calcDiffPct(currentActive, previousActive),
      betterThan: currentActive > previousActive,
    },
    estimatedRevenue: {
      current: currentRevenue,
      previous: previousRevenue,
      diffPct: calcDiffPct(currentRevenue, previousRevenue),
      betterThan: currentRevenue > previousRevenue,
    },
    estimatedRoas,
    byChannelROI,
    byHourWeekday,
    byDailyTrend,
    byDailyTrendPrevious,
    funnelStats,
    topCampaigns,
    computedAt: new Date().toISOString(),
    source: 'campaigns + MySQL 큐 직접 집계 (D144 정합 — aggregateSmsCountsByCampaign, 브랜드 msg_type F 포함) + cdp_events.purchase + customers + email_campaigns/dm_recipient_tokens(2026-07-03 채널 합류)',
  };
}
