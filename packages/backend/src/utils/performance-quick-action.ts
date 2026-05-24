/**
 * ★ CT-68: 성과리포트 1-click 액션 컨트롤타워 — D213+ (2026-05-24)
 *
 * 🎯 목적
 *   성과 분석 안 1-click 액션 3 매트릭스 → AI 자동 마케팅 prefill.
 *   - 4번 메뉴 성과리포트 "1-click 액션 3 카드" 영역 진정 데이터 source
 *   - 채널 ROI 회복 / 시간대 최적화 / 최고 성과 복제
 *
 * ⛔ 영구 원칙
 *   - 모델 = Opus 4.7 (AI Operator 영역) — feedback_ai_operator_model_isolation
 *   - 액션 결과 = AI 자동 마케팅 진입 prefill (sessionStorage)
 *   - 0건 자동완화 X (feedback_no_target_auto_relax)
 *   - 사용자 검토 + 승인 후 발송 (AI 단독 발송 X)
 *   - 구체 혜택(%/원/쿠폰) X (feedback_ai_no_arbitrary_benefit)
 */

import { callAIWithFallback } from '../services/ai';
import type { PerformanceSnapshot } from './next-action-advisor';

export type QuickActionType = 'channel_recovery' | 'time_optimization' | 'top_performer_replication';

export interface QuickActionResult {
  actionType: QuickActionType;
  objective: string;             // AI 자동 마케팅 자연어 한 줄
  targetFilters: Record<string, any>;
  suggestedChannel: 'SMS' | 'LMS' | 'MMS' | 'KAKAO';
  suggestedTone: string;
  suggestedHour: number;
  expectedImpact: string;
  reasoning: string;
  generatedAt: string;
}

const ACTION_LABEL: Record<QuickActionType, { label: string; description: string }> = {
  channel_recovery: {
    label: '채널 ROI 회복',
    description: '저성과 채널 회복 캠페인 자동 설계',
  },
  time_optimization: {
    label: '시간대 최적화',
    description: '저성과 시간대 최적화 캠페인 자동 설계',
  },
  top_performer_replication: {
    label: '최고 성과 복제',
    description: '30일 안 top 캠페인 복제 + 강화 매트릭스',
  },
};

export async function generateQuickAction(
  companyId: string,
  actionType: QuickActionType,
  snapshot: PerformanceSnapshot,
  companyInfo: { company_name?: string; brand_name?: string; business_type?: string; brand_tone?: string }
): Promise<QuickActionResult> {
  const brandName = companyInfo.brand_name || companyInfo.company_name || '브랜드';
  const actionMeta = ACTION_LABEL[actionType];

  const system = `당신은 CRM 마케팅 전문가입니다. 회사의 성과 데이터를 분석해 1-click 액션 캠페인을 자동 설계합니다.

영구 원칙:
- 타겟 0건 자동완화 X (조건 완화 X — 0건이면 빈 결과 응답)
- 추천 시점 = KST 08~21시
- AI 단독 발송 X (사용자 검토 + 승인 후 진행)
- 구체 혜택(%/원/쿠폰) X — 흐름/안내문/감성 텍스트만 (회사 admin 직접 작성)

JSON 형식으로만 응답하세요.`;

  const userMessage = `## 액션 타입
${actionMeta.label} — ${actionMeta.description}

## 회사 정보
- 회사명: ${brandName}
- 업종: ${companyInfo.business_type || '기타'}
- 브랜드 톤: ${companyInfo.brand_tone || '친근함'}

## 최근 30일 성과
- 발송 캠페인: ${snapshot.totalCampaigns}건 / 총 발송 ${snapshot.totalSent.toLocaleString()}건 / 성공률 ${(snapshot.successRate * 100).toFixed(1)}%
- 채널별:
${snapshot.byChannel.map((c) => `  · ${c.channel}: ${c.sent.toLocaleString()}건 (성공률 ${(c.successRate * 100).toFixed(1)}%)`).join('\n') || '  (없음)'}
- 시간대별 (상위 5):
${snapshot.byHour.sort((a, b) => b.sent - a.sent).slice(0, 5).map((h) => `  · ${h.hour}시: ${h.sent.toLocaleString()}건 (성공률 ${(h.successRate * 100).toFixed(1)}%)`).join('\n') || '  (없음)'}
- 신규/활성 고객: ${snapshot.newCustomers30d.toLocaleString()}명 / ${snapshot.activeCustomers30d.toLocaleString()}명

## 요청 (${actionMeta.label})
${actionType === 'channel_recovery'
  ? '저성과 채널 회복 캠페인 자동 설계 — 어떤 채널 성과 저하 영역 / 회복 매트릭스 도출'
  : actionType === 'time_optimization'
    ? '저성과 시간대 회복 캠페인 자동 설계 — 어떤 시간대 성과 저하 영역 / 최적 시간대 매트릭스 도출'
    : '30일 안 top 캠페인 복제 + 강화 — 어떤 영역 성과 견인 / 복제 매트릭스 도출'}

다음 매트릭스 도출:
1. objective: AI 자동 마케팅 자연어 한 줄 (예: "주말 저녁 8시 VIP 재구매 회복 캠페인")
2. targetFilters: 타겟 필터 jsonb (예: {"grade": "VIP", "recent_purchase_days": 30})
3. suggestedChannel: SMS / LMS / MMS / KAKAO 중 하나
4. suggestedTone: 짧은 톤 안내 (예: "감성적", "실용적")
5. suggestedHour: 0~23 KST 시간
6. expectedImpact: 예상 효과 한 줄
7. reasoning: 추천 근거 한 줄 (구체 수치 포함)

## 출력 (JSON만)
{
  "objective": "...",
  "targetFilters": {},
  "suggestedChannel": "LMS",
  "suggestedTone": "감성적",
  "suggestedHour": 20,
  "expectedImpact": "...",
  "reasoning": "..."
}`;

  try {
    const text = await callAIWithFallback({
      system,
      userMessage,
      maxTokens: 1024,
      temperature: 0.3,
      // ★ AI Operator 영역 = Opus 4.7
      model: 'opus',
      companyId,
      source: 'performance-quick-action',
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
      actionType,
      objective: String(parsed.objective || ''),
      targetFilters: typeof parsed.targetFilters === 'object' && parsed.targetFilters ? parsed.targetFilters : {},
      suggestedChannel: ['SMS', 'LMS', 'MMS', 'KAKAO'].includes(parsed.suggestedChannel) ? parsed.suggestedChannel : 'SMS',
      suggestedTone: String(parsed.suggestedTone || '친근함'),
      suggestedHour:
        typeof parsed.suggestedHour === 'number' && parsed.suggestedHour >= 0 && parsed.suggestedHour <= 23
          ? parsed.suggestedHour
          : 11,
      expectedImpact: String(parsed.expectedImpact || ''),
      reasoning: String(parsed.reasoning || ''),
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[QuickAction] AI 호출 실패:', err);
    return {
      actionType,
      objective: '',
      targetFilters: {},
      suggestedChannel: 'SMS',
      suggestedTone: '친근함',
      suggestedHour: 11,
      expectedImpact: 'AI 응답 처리 중 오류',
      reasoning: '',
      generatedAt: new Date().toISOString(),
    };
  }
}
