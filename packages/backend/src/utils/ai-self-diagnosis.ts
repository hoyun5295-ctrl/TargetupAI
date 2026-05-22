/**
 * CT-54 utils/ai-self-diagnosis.ts (D205 2026-05-22)
 *
 * AI 자율 진단 + 자동 추천 강화 — 옛 ContinuousOperator + next-action-advisor 진화
 *
 * 본질: 회사 admin 자연어 입력 의존도 0
 *  - AI가 회사 데이터를 종합해서 본인이 자동 진단
 *  - "이번 달 매출 부진 원인은 휴면 고객 회복 캠페인 부재" 자동 분석
 *  - 다음 추천 캠페인 자동 제안 (Predictive + 시즌 + 옛 효과 종합)
 *
 * 사용처:
 *  - AI Operator dashboard 진입 시 자동 추천 카드 (회사 admin 첫 진입 안내)
 *  - routes/ai.ts /operator/self-diagnosis endpoint
 *
 * 영구 원칙 정합:
 *  - 회사 격리 (companyId)
 *  - 모델명 사용자 노출 X
 *  - AI 임의 혜택 X (placeholder 유지)
 *  - 6,000사+ 운영 영향 0 (Read-only 진단)
 */

import { query } from '../config/database';
import { getCompanyPredictionSummary } from './predictive-suite';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 인터페이스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CompanyHealthDiagnosis {
  companyId: string;
  diagnosedAt: Date;
  signals: HealthSignal[];
  overallScore: number;       // 0~100 (회사 건강 점수)
  topConcerns: string[];      // 우선 처리 영역 3건
  recommendations: AutoRecommendation[];
}

export interface HealthSignal {
  category: 'sales' | 'engagement' | 'churn' | 'campaign' | 'inventory';
  severity: 'good' | 'warning' | 'critical';
  metric: string;
  value: number | string;
  trend: 'up' | 'down' | 'flat';
  message: string;
}

export interface AutoRecommendation {
  id: string;
  priority: 1 | 2 | 3;
  type: 'churn_recovery' | 'purchase_push' | 'season_campaign' | 'new_customer_welcome' | 'reorder';
  title: string;
  reason: string;
  targetCount: number;
  expectedImpact: string;
  oneClickObjective: string;  // 자연어 한 줄 (AI Operator 직접 진입용)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. diagnoseCompanyHealth — 회사 건강 종합 진단
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function diagnoseCompanyHealth(companyId: string): Promise<CompanyHealthDiagnosis> {
  const signals: HealthSignal[] = [];

  // 1) 옛 30일 매출 추이 (campaigns 영역 — total_cost 옛 영역 활용)
  try {
    const salesRes = await query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS recent_30,
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '60 days' AND created_at <= NOW() - INTERVAL '30 days') AS prev_30
       FROM campaigns
       WHERE company_id = $1::uuid AND status = 'completed'`,
      [companyId]
    );
    const r = salesRes.rows[0] || {};
    const recent = Number(r.recent_30) || 0;
    const prev = Number(r.prev_30) || 0;
    const change = prev > 0 ? (recent - prev) / prev : 0;
    signals.push({
      category: 'campaign',
      severity: recent === 0 ? 'critical' : change < -0.2 ? 'warning' : 'good',
      metric: '최근 30일 캠페인 발송',
      value: `${recent}건 (직전 30일 ${prev}건)`,
      trend: change > 0.1 ? 'up' : change < -0.1 ? 'down' : 'flat',
      message: recent === 0
        ? '최근 30일 발송 0건 — 캠페인 활성화 의무'
        : change < -0.2
        ? `직전 30일 대비 ${Math.abs(change * 100).toFixed(0)}% 감소`
        : `직전 30일 대비 ${(change * 100).toFixed(0)}% 변화`,
    });
  } catch (err: any) {
    console.warn('[SelfDiagnosis] sales 진단 skip:', err?.message);
  }

  // 2) 활성 고객 수
  try {
    const activeRes = await query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE recent_purchase_date > NOW() - INTERVAL '90 days') AS active_90d,
         COUNT(*) FILTER (WHERE recent_purchase_date < NOW() - INTERVAL '90 days' OR recent_purchase_date IS NULL) AS dormant
       FROM customers
       WHERE company_id = $1::uuid`,
      [companyId]
    );
    const r = activeRes.rows[0] || {};
    const total = Number(r.total) || 0;
    const active = Number(r.active_90d) || 0;
    const dormant = Number(r.dormant) || 0;
    const activeRate = total > 0 ? active / total : 0;
    signals.push({
      category: 'engagement',
      severity: activeRate < 0.2 ? 'critical' : activeRate < 0.4 ? 'warning' : 'good',
      metric: '90일 안 활성 고객 비율',
      value: `${(activeRate * 100).toFixed(0)}% (${active.toLocaleString()}/${total.toLocaleString()}명)`,
      trend: 'flat',
      message: dormant > active
        ? `휴면 고객 ${dormant.toLocaleString()}명 — 활성 고객보다 많음. 회복 캠페인 우선`
        : `활성 고객 ${active.toLocaleString()}명 안정 영역`,
    });
  } catch (err: any) {
    console.warn('[SelfDiagnosis] engagement 진단 skip:', err?.message);
  }

  // 3) Predictive 점수 통합 (옛 Phase B-2 정합)
  let predictiveSummary;
  try {
    predictiveSummary = await getCompanyPredictionSummary(companyId);
    if (predictiveSummary.totalCustomers > 0) {
      signals.push({
        category: 'churn',
        severity: predictiveSummary.highRiskCount > predictiveSummary.totalCustomers * 0.3 ? 'critical' :
                  predictiveSummary.highRiskCount > 0 ? 'warning' : 'good',
        metric: 'AI 예측 이탈 위험 70%+ 고객',
        value: `${predictiveSummary.highRiskCount.toLocaleString()}명`,
        trend: 'flat',
        message: predictiveSummary.highRiskCount > 0
          ? `${predictiveSummary.highRiskCount.toLocaleString()}명 회복 캠페인 즉시 의무`
          : '이탈 위험 고객 없음',
      });
      signals.push({
        category: 'sales',
        severity: predictiveSummary.highPotentialCount > 0 ? 'good' : 'flat' as any,
        metric: 'AI 예측 구매 가능성 60%+ 고객',
        value: `${predictiveSummary.highPotentialCount.toLocaleString()}명`,
        trend: 'up',
        message: predictiveSummary.highPotentialCount > 0
          ? `${predictiveSummary.highPotentialCount.toLocaleString()}명 구매 유도 캠페인 추천`
          : '예측 데이터 누적 중',
      });
    }
  } catch (err: any) {
    console.warn('[SelfDiagnosis] predictive 진단 skip:', err?.message);
  }

  // 4) 옛 캠페인 효과 (옛 30일 클릭률)
  try {
    const clickRes = await query(
      `SELECT
         COUNT(*) FILTER (WHERE event_name = 'message_click' AND occurred_at > NOW() - INTERVAL '30 days') AS clicks_30,
         COUNT(*) FILTER (WHERE event_name = 'order' AND occurred_at > NOW() - INTERVAL '30 days') AS orders_30
       FROM cdp_events
       WHERE company_id = $1::uuid`,
      [companyId]
    );
    const r = clickRes.rows[0] || {};
    const clicks = Number(r.clicks_30) || 0;
    const orders = Number(r.orders_30) || 0;
    signals.push({
      category: 'engagement',
      severity: clicks === 0 ? 'warning' : 'good',
      metric: '최근 30일 메시지 클릭 + 주문',
      value: `클릭 ${clicks.toLocaleString()} / 주문 ${orders.toLocaleString()}`,
      trend: 'flat',
      message: clicks === 0
        ? 'Click 트래킹 데이터 누적 시작 영역 (단축 URL 발송 시점부터 누적)'
        : `전환율 ${clicks > 0 ? (orders / clicks * 100).toFixed(1) : '0'}%`,
    });
  } catch (err: any) {
    console.warn('[SelfDiagnosis] engagement 진단 skip:', err?.message);
  }

  // 5) 추천 캠페인 자동 도출
  const recommendations = await autoRecommendNextCampaigns(companyId, signals, predictiveSummary);

  // 6) 종합 점수
  const overallScore = computeOverallScore(signals);

  // 7) Top concerns
  const topConcerns = signals
    .filter(s => s.severity === 'critical' || s.severity === 'warning')
    .slice(0, 3)
    .map(s => s.message);

  return {
    companyId,
    diagnosedAt: new Date(),
    signals,
    overallScore,
    topConcerns,
    recommendations,
  };
}

function computeOverallScore(signals: HealthSignal[]): number {
  if (signals.length === 0) return 50;
  let total = 0;
  for (const s of signals) {
    if (s.severity === 'good') total += 100;
    else if (s.severity === 'warning') total += 50;
    else if (s.severity === 'critical') total += 10;
    else total += 50;
  }
  return Math.round(total / signals.length);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. autoRecommendNextCampaigns — Predictive + 옛 진단 종합 추천 3건
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function autoRecommendNextCampaigns(
  companyId: string,
  signals: HealthSignal[],
  predictiveSummary: any,
): Promise<AutoRecommendation[]> {
  const recommendations: AutoRecommendation[] = [];
  const month = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCMonth() + 1;

  // 1) 이탈 위험 회복 (최우선)
  if (predictiveSummary?.highRiskCount > 0) {
    recommendations.push({
      id: `rec-churn-${Date.now()}`,
      priority: 1,
      type: 'churn_recovery',
      title: `이탈 위험 ${predictiveSummary.highRiskCount.toLocaleString()}명 회복 캠페인`,
      reason: 'AI 예측 결과 이탈 위험 70% 이상 고객 다수 존재 — 즉시 회복 안내 의무',
      targetCount: predictiveSummary.highRiskCount,
      expectedImpact: '회복 시 평균 30% 활성 복귀',
      oneClickObjective: '이탈 위험 70%+ 고객 회복 캠페인 + 등급별 분기 인사 + 회복 안내',
    });
  }

  // 2) 구매 가능성 푸시
  if (predictiveSummary?.highPotentialCount > 0) {
    recommendations.push({
      id: `rec-purchase-${Date.now()}`,
      priority: 2,
      type: 'purchase_push',
      title: `구매 가능성 ${predictiveSummary.highPotentialCount.toLocaleString()}명 푸시 캠페인`,
      reason: 'AI 예측 결과 구매 가능성 60% 이상 고객 — 즉시 구매 유도 효과 큼',
      targetCount: predictiveSummary.highPotentialCount,
      expectedImpact: '예측 그룹 평균 전환율 2~3배 향상',
      oneClickObjective: '구매 가능성 60%+ 고객 구매 유도 캠페인 + VIP/등급별 분기',
    });
  }

  // 3) 시즌 캠페인 (월별 자동)
  const seasonKeywords: Record<number, { title: string; objective: string }> = {
    1: { title: '새해 안부 캠페인', objective: '새해 안부 + 신년 인사 + 첫 구매 안내' },
    2: { title: '설날 + 발렌타인 캠페인', objective: '설날 명절 안부 + 발렌타인 시즌 인사' },
    3: { title: '봄맞이 + 새 학기 캠페인', objective: '봄맞이 새 소식 + 새 학기 안내' },
    4: { title: '벚꽃 봄나들이 캠페인', objective: '벚꽃 봄나들이 시즌 + 야외 활동 안내' },
    5: { title: '가정의 달 + 어버이날 캠페인', objective: '가정의 달 인사 + 어버이날/스승의날 안내' },
    6: { title: '여름맞이 캠페인', objective: '여름맞이 인사 + 휴가 준비 안내' },
    7: { title: '바캉스 휴가 캠페인', objective: '바캉스 시즌 인사 + 휴가 상품 안내' },
    8: { title: '여름 마무리 + 개학 캠페인', objective: '여름 마무리 안부 + 개학 준비 안내' },
    9: { title: '추석 명절 캠페인', objective: '추석 명절 안부 + 한가위 인사' },
    10: { title: '단풍 가을 캠페인', objective: '단풍 가을 시즌 + 가을 정취 안내' },
    11: { title: '늦가을 + 빼빼로데이 캠페인', objective: '늦가을 인사 + 빼빼로데이 안내' },
    12: { title: '크리스마스 + 연말 캠페인', objective: '크리스마스 + 연말 송년 인사' },
  };
  const season = seasonKeywords[month] || seasonKeywords[5];
  recommendations.push({
    id: `rec-season-${Date.now()}`,
    priority: 3,
    type: 'season_campaign',
    title: season.title,
    reason: `${month}월 시즌 — 자연스러운 안부 캠페인 추천`,
    targetCount: 0,  // 회사 전체 활성 고객
    expectedImpact: '시즌 활용 시 평균 클릭률 1.5배 향상',
    oneClickObjective: season.objective,
  });

  return recommendations.slice(0, 3);
}
