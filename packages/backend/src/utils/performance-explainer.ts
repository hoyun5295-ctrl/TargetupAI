/**
 * ★ CT-67: 성과리포트 Explainability 컨트롤타워 — D213+ (2026-05-24)
 *
 * 🎯 목적
 *   회사 성과 영역 안 영향 요인 매트릭스 (Predictive Explainability 정합).
 *   - 4번 메뉴 성과리포트 "AI 자율 진단" 영역 진정 데이터 source
 *   - 채널/시간대/캠페인 타입 영향도 매트릭스 + Data source 명시
 *
 * ⛔ 영구 원칙
 *   - 모델 = Opus 4.7 (AI Operator 영역) — Sonnet 4.6 흐름 영향 0건 (feedback_ai_operator_model_isolation)
 *   - 영향 요인 = 실제 데이터 기반만 (mock X)
 *   - Source caption 의무 (feedback_no_mock_data_in_production)
 *   - 결과 = 사용자 검토 + 승인 흐름 정합 (AI 단독 발송 X)
 */

import { callAIWithFallback } from '../services/ai';
import type { PerformanceSnapshot } from './next-action-advisor';

/**
 * 채널 요인의 데이터 출처 — 서버가 고정한다(AI가 적게 두지 않는다).
 *
 * 채널 집계(`mergeByChannelLabel`)는 `send_channel`과 `message_type` 두 컬럼을 함께 묶는다.
 * 알림톡·브랜드메시지가 전부 `message_type='LMS'`로 저장되므로 한 컬럼만으로는 채널이 구분되지 않고,
 * 그 상태로 출처를 적으면 화면 Source caption이 재현 불가능한 근거를 말하게 된다.
 */
export const CHANNEL_SOURCE_FIELD =
  'campaigns.send_channel + campaigns.message_type + success_count + fail_count';

export interface ExplainFactor {
  category: 'channel' | 'time' | 'campaign_type' | 'audience' | 'cdp_funnel';
  label: string;
  impactScore: number;          // 0~1
  direction: 'positive' | 'negative' | 'neutral';
  detail: string;
  sourceField: string;
}

export interface PerformanceExplanation {
  overallScore: number;          // 0~100 회사 전체 성과 스코어
  topInsight: string;            // 한 줄 핵심 인사이트
  factors: ExplainFactor[];
  recommendation: string;        // 1순위 권장 액션
  explainedAt: string;
}

/**
 * 회사 성과 영향 요인 분석 (Opus 4.7).
 *
 * @param companyId - 회사 ID
 * @param snapshot - PerformanceSnapshot
 * @param companyInfo - 회사 메타
 */
export async function explainPerformance(
  companyId: string,
  snapshot: PerformanceSnapshot,
  companyInfo: { company_name?: string; brand_name?: string; business_type?: string },
  // ★ 2026-07-03 고객 축 — 등급·전 채널 실측 라인 주입(옵셔널 — 기존 호출부 무변). 'audience' factors 실동작용.
  extraLines?: string[]
): Promise<PerformanceExplanation> {
  const brandName = companyInfo.brand_name || companyInfo.company_name || '브랜드';

  const system = `당신은 CRM 마케팅 성과 분석 전문가입니다.
회사의 최근 30일 캠페인 데이터를 분석하여 성과 영향 요인을 도출합니다.

영구 원칙:
- 영향 요인 = 실제 데이터 기반만 (추측 / 일반론 X)
- 각 요인 = 구체 수치 + Data source 명시 의무
- 사용자 검토 + 승인 후 액션 진행 (AI 단독 실행 X)

JSON 형식으로만 응답하세요.`;

  const userMessage = `## 회사 정보
- 회사명: ${brandName}
- 업종: ${companyInfo.business_type || '기타'}

## 최근 30일 성과 매트릭스
- 발송 캠페인 수: ${snapshot.totalCampaigns}건
- 총 발송: ${snapshot.totalSent.toLocaleString()}건 / 성공: ${snapshot.totalSuccess.toLocaleString()}건 (성공률 ${(snapshot.successRate * 100).toFixed(1)}%)
- 채널별:
${snapshot.byChannel.map((c) => `  · ${c.channel}: ${c.sent.toLocaleString()}건 (성공률 ${(c.successRate * 100).toFixed(1)}%)`).join('\n') || '  (없음)'}
- 시간대별 (상위 5):
${snapshot.byHour.sort((a, b) => b.sent - a.sent).slice(0, 5).map((h) => `  · ${h.hour}시: ${h.sent.toLocaleString()}건 (성공률 ${(h.successRate * 100).toFixed(1)}%)`).join('\n') || '  (없음)'}
- 30일 신규 고객: ${snapshot.newCustomers30d.toLocaleString()}명 / 활성 고객: ${snapshot.activeCustomers30d.toLocaleString()}명
- 30일 추정 매출 (CDP): ${snapshot.estimatedRevenue.toLocaleString()}원
${snapshot.funnelStats ? `- CDP Funnel: 조회 ${snapshot.funnelStats.viewCount} → 장바구니 ${snapshot.funnelStats.cartAddCount} → 구매 ${snapshot.funnelStats.purchaseCount} (전환율 ${(snapshot.funnelStats.purchaseConversionRate * 100).toFixed(2)}%)` : '- CDP 미연동'}
${extraLines && extraLines.length > 0 ? `\n## 고객 축 실측 (등급·전 채널 — audience 요인 근거)\n${extraLines.map((l) => `- ${l}`).join('\n')}` : ''}

## 요청
위 데이터를 분석해 영향 요인 매트릭스를 도출해주세요:
1. 전체 성과 스코어 (0~100, 동종 업계 평균 대비)
2. 한 줄 핵심 인사이트 (예: "주말 저녁 시간대 발송 시 성공률 +14% 영역 큼")
3. 영향 요인 3~6개:
   - category: 'channel' | 'time' | 'campaign_type' | 'audience' | 'cdp_funnel'
   - label: 짧은 명사 (예: "LMS 채널", "20시 발송")
   - impactScore: 0~1 (영향력 크기)
   - direction: 'positive' (성과 견인) | 'negative' (성과 저하) | 'neutral'
   - detail: 구체 수치 안내 (예: "LMS 발송 성공률 96.2% — SMS 89.1% 대비 +7.1%p")
   - sourceField: 데이터 source (예: "campaigns.sent_at AT TIME ZONE 'Asia/Seoul' + success_count")
4. 1순위 권장 액션 (사용자 실행 가능 한 줄)

## 출력 형식 (JSON만 응답)
{
  "overallScore": 72,
  "topInsight": "주말 저녁 시간대 발송 시 성공률 +14%",
  "factors": [
    {"category": "time", "label": "20시 발송", "impactScore": 0.85, "direction": "positive", "detail": "20시 발송 성공률 94.3% — 전체 평균 +6.2%p", "sourceField": "campaigns.sent_at AT TIME ZONE 'Asia/Seoul'"}
  ],
  "recommendation": "다음 캠페인 LMS 채널 + 20시 발송 정합"
}`;

  try {
    const text = await callAIWithFallback({
      system,
      userMessage,
      maxTokens: 2048,
      temperature: 0.3,
      // ★ AI Operator 영역 = Opus 4.7 (feedback_ai_operator_model_isolation)
      model: 'opus',
      companyId,
      source: 'performance-explainer',
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
    return {
      overallScore: typeof parsed.overallScore === 'number' ? Math.max(0, Math.min(100, parsed.overallScore)) : 50,
      topInsight: String(parsed.topInsight || ''),
      factors: Array.isArray(parsed.factors)
        ? parsed.factors.slice(0, 6).map((f: any) => {
            const category = ['channel', 'time', 'campaign_type', 'audience', 'cdp_funnel'].includes(f.category)
              ? f.category
              : 'audience';
            return {
              category,
              label: String(f.label || ''),
              impactScore: typeof f.impactScore === 'number' ? Math.max(0, Math.min(1, f.impactScore)) : 0.5,
              direction: ['positive', 'negative', 'neutral'].includes(f.direction) ? f.direction : 'neutral',
              detail: String(f.detail || ''),
              // ★ 2026-07-31 채널 요인의 출처는 서버가 고정한다.
              //   채널 집계가 send_channel + message_type 두 컬럼으로 바뀌었는데(알림톡·브랜드가
              //   전부 message_type='LMS'라 한 컬럼으로는 구분이 안 된다) AI가 옛 한 컬럼을 출처로
              //   적으면 화면의 Source caption이 재현 불가능한 근거를 말하게 된다.
              sourceField: category === 'channel' ? CHANNEL_SOURCE_FIELD : String(f.sourceField || ''),
            };
          })
        : [],
      recommendation: String(parsed.recommendation || ''),
      explainedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[PerformanceExplainer] AI 호출 실패:', err);
    return {
      overallScore: 50,
      topInsight: '성과 분석 영역 일시 오류 — 잠시 후 다시 시도해주세요.',
      factors: [],
      recommendation: '',
      explainedAt: new Date().toISOString(),
    };
  }
}
