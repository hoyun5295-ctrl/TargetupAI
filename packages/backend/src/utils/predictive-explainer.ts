/**
 * CT-63: Predictive Explainer — D211+ Predictive 강화 (2026-05-23 Harold 명시)
 *
 * 본질: 회사 admin "AI 영역 왜 이 예측인지" 진정 안내 본질
 *   - SHAP-like 영역 영향 요인 영역 분석 (recency / click_history / purchase_frequency / grade / engagement)
 *   - 각 요인 영역 영향 점수 (0~1) + 방향 (positive / negative)
 *   - 회사 admin 안 자연어 안내 영역 (단순 템플릿 — Anthropic 호출 X / 비용 영역 0)
 *
 * 영구 룰 정합:
 *   - 회사 격리 의무 (companyId)
 *   - AI 호출 X (단순 SQL + 자연어 템플릿 — 비용 영역 0)
 *   - 6,000사+ 운영 영향 0 (Read-only)
 *
 * 사용처:
 *   - GET /operator/predictive/customers/:id/explain
 *   - PredictiveDashboardPage customer 상세 영역 expand
 */

import { query } from '../config/database';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 인터페이스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ExplainFactor {
  category: 'recency' | 'click_history' | 'purchase_frequency' | 'grade' | 'engagement' | 'channel';
  label: string;                  // 회사 admin 안 자연어 영역
  impactScore: number;            // 0~1 (영향 크기)
  direction: 'positive' | 'negative' | 'neutral';
  detail: string;                 // 영역 정확 안내
  sourceField: string;            // 옛 데이터 source 필드 (cdp_events / customers / journey_step_logs)
}

export interface CustomerExplanation {
  customerId: string;
  customerName: string | null;
  customerGrade: string | null;
  predictions: {
    clickScore: number;
    churnRisk: number;
    purchaseLikelihood: number;
    ltv90d: number;
    nextPurchaseDays: number | null;
    channelPreference: string | null;
    bestHour: number | null;
  };
  factors: ExplainFactor[];
  topRecommendation: string;      // 회사 admin 안 1순위 권장 영역 (자연어)
  explainedAt: Date;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. explainCustomerPrediction — 단일 customer 영역 예측 안내
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function explainCustomerPrediction(
  customerId: string,
  companyId: string,
): Promise<CustomerExplanation> {
  // customer + predictions + 활동 영역 조회
  const r = await query(
    `SELECT
       c.id, c.name, c.grade, c.recent_purchase_date, c.purchase_count, c.total_purchase_amount, c.created_at,
       p.click_score, p.churn_risk, p.purchase_likelihood, p.ltv_90d, p.next_purchase_days, p.channel_preference, p.best_hour,
       (SELECT COUNT(*) FROM cdp_events
        WHERE customer_id = c.id AND event_name = 'message_click') AS total_clicks,
       (SELECT MAX(occurred_at) FROM cdp_events
        WHERE customer_id = c.id AND event_name = 'message_click') AS last_click_at,
       (SELECT COUNT(*) FROM journey_step_logs l
        JOIN journey_executions e ON e.id = l.execution_id
        WHERE e.customer_id = c.id AND l.status = 'sent') AS total_sent
     FROM customers c
     LEFT JOIN cdp_customer_predictions p ON p.customer_id = c.id
     WHERE c.id = $1::uuid AND c.company_id = $2::uuid`,
    [customerId, companyId],
  );

  if (r.rows.length === 0) {
    throw new Error('고객 영역 접근 권한 없음 (회사 격리)');
  }

  const row = r.rows[0];
  const factors: ExplainFactor[] = [];

  // 1. Recency 영역 (마지막 활동 영역)
  const lastActivity = row.recent_purchase_date || row.last_click_at;
  if (lastActivity) {
    const daysSince = Math.floor((Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24));
    factors.push({
      category: 'recency',
      label: '최근 활동',
      impactScore: daysSince <= 30 ? 0.9 : daysSince <= 90 ? 0.5 : 0.95,
      direction: daysSince <= 30 ? 'positive' : daysSince <= 90 ? 'neutral' : 'negative',
      detail: daysSince <= 30
        ? `최근 ${daysSince}일 안 활동 — 활성 영역`
        : daysSince <= 90
        ? `${daysSince}일 전 마지막 활동 — 주의 영역`
        : `${daysSince}일+ 활동 없음 — 휴면 위험 영역`,
      sourceField: 'customers.recent_purchase_date + cdp_events.message_click',
    });
  } else {
    factors.push({
      category: 'recency',
      label: '최근 활동',
      impactScore: 0.7,
      direction: 'negative',
      detail: '활동 이력 영역 없음 — 신규 또는 휴면 영역',
      sourceField: 'customers.recent_purchase_date',
    });
  }

  // 2. Click history 영역
  const totalClicks = Number(row.total_clicks) || 0;
  const totalSent = Number(row.total_sent) || 0;
  const clickRate = totalSent > 0 ? totalClicks / totalSent : 0;
  if (totalSent >= 3) {
    factors.push({
      category: 'click_history',
      label: '메시지 클릭 이력',
      impactScore: Math.min(1, clickRate * 2.5),
      direction: clickRate > 0.2 ? 'positive' : clickRate > 0.05 ? 'neutral' : 'negative',
      detail: `누적 발송 ${totalSent}건 · 클릭 ${totalClicks}건 (클릭률 ${(clickRate * 100).toFixed(1)}%)`,
      sourceField: 'journey_step_logs + cdp_events.message_click',
    });
  } else {
    factors.push({
      category: 'click_history',
      label: '메시지 클릭 이력',
      impactScore: 0.3,
      direction: 'neutral',
      detail: `누적 발송 ${totalSent}건 — 데이터 영역 부족 (cold start)`,
      sourceField: 'journey_step_logs',
    });
  }

  // 3. Purchase frequency 영역
  const purchaseCount = Number(row.purchase_count) || 0;
  const totalAmount = Number(row.total_purchase_amount) || 0;
  if (purchaseCount > 0) {
    factors.push({
      category: 'purchase_frequency',
      label: '구매 빈도',
      impactScore: Math.min(1, purchaseCount / 10),
      direction: purchaseCount >= 5 ? 'positive' : purchaseCount >= 2 ? 'neutral' : 'positive',
      detail: `누적 구매 ${purchaseCount}회 · 총 ${totalAmount.toLocaleString()}원 (평균 ${Math.round(totalAmount / purchaseCount).toLocaleString()}원)`,
      sourceField: 'customers.purchase_count + customers.total_purchase_amount',
    });
  } else {
    factors.push({
      category: 'purchase_frequency',
      label: '구매 빈도',
      impactScore: 0.5,
      direction: 'negative',
      detail: '구매 이력 영역 없음 — 첫 구매 유도 영역',
      sourceField: 'customers.purchase_count',
    });
  }

  // 4. Grade 영역
  const grade = row.grade || '일반';
  const gradeImpact: Record<string, { score: number; dir: 'positive' | 'negative' | 'neutral' }> = {
    'VIP': { score: 0.95, dir: 'positive' },
    'Gold': { score: 0.7, dir: 'positive' },
    'Silver': { score: 0.5, dir: 'neutral' },
    '일반': { score: 0.4, dir: 'neutral' },
    '신규': { score: 0.6, dir: 'positive' },
  };
  const gi = gradeImpact[grade] || gradeImpact['일반'];
  factors.push({
    category: 'grade',
    label: '고객 등급',
    impactScore: gi.score,
    direction: gi.dir,
    detail: `${grade} 등급 — 옛 등급별 평균 클릭률 + 평균 객단가 영역 기준`,
    sourceField: 'customers.grade',
  });

  // 5. Engagement 영역 (회사 admin 안 진정 본질)
  const engagementScore = Math.min(1, (Number(row.click_score) || 0) * 0.5 + clickRate * 0.5);
  factors.push({
    category: 'engagement',
    label: '브랜드 engagement',
    impactScore: engagementScore,
    direction: engagementScore > 0.3 ? 'positive' : 'neutral',
    detail: `클릭 점수 ${((Number(row.click_score) || 0) * 100).toFixed(0)}% · 옛 발송 영역 클릭 영역 종합`,
    sourceField: 'cdp_customer_predictions.click_score + journey_step_logs',
  });

  // 6. Channel 영역 (preferred 영역 표시)
  if (row.channel_preference) {
    factors.push({
      category: 'channel',
      label: '선호 채널',
      impactScore: 0.6,
      direction: 'positive',
      detail: `${String(row.channel_preference).toUpperCase()} 영역 가장 많이 클릭`,
      sourceField: 'journey_step_logs.channel + cdp_events.message_click',
    });
  }

  // 영향 점수 내림차순 정렬
  factors.sort((a, b) => b.impactScore - a.impactScore);

  // 1순위 권장 영역 (자연어 템플릿)
  const churnRisk = Number(row.churn_risk) || 0;
  const purchaseLikelihood = Number(row.purchase_likelihood) || 0;
  let topRecommendation: string;
  if (churnRisk > 0.7) {
    topRecommendation = `이탈 위험 영역 ${(churnRisk * 100).toFixed(0)}% — 회복 캠페인 (감성 톤 + 옛 클릭 채널 ${row.channel_preference || 'SMS'} 영역) 권장`;
  } else if (purchaseLikelihood > 0.5) {
    topRecommendation = `구매 가능성 영역 ${(purchaseLikelihood * 100).toFixed(0)}% — 추천 상품 캠페인 ${row.next_purchase_days !== null ? `(다음 구매 예상 D+${row.next_purchase_days}일 전 발송)` : ''} 권장`;
  } else if (grade === 'VIP' || grade === 'Gold') {
    topRecommendation = `${grade} 등급 영역 — 옛 LTV ${Math.round(Number(row.ltv_90d) || 0).toLocaleString()}원 (90일) 영역 보존 + VIP 전용 혜택 영역 권장`;
  } else {
    topRecommendation = `${grade} 등급 영역 — 옛 클릭 이력 영역 분석 후 채널/시간대 영역 맞춤 발송 권장`;
  }

  return {
    customerId: row.id,
    customerName: row.name,
    customerGrade: row.grade,
    predictions: {
      clickScore: Number(row.click_score) || 0,
      churnRisk,
      purchaseLikelihood,
      ltv90d: Number(row.ltv_90d) || 0,
      nextPurchaseDays: row.next_purchase_days !== null ? Number(row.next_purchase_days) : null,
      channelPreference: row.channel_preference || null,
      bestHour: row.best_hour !== null ? Number(row.best_hour) : null,
    },
    factors,
    topRecommendation,
    explainedAt: new Date(),
  };
}
