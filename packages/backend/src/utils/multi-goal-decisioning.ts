/**
 * ★ CT-34: Multi-Goal Decisioning 컨트롤타워 — D179 (2026-05-19)
 *
 * 🎯 목적
 *   비전 v0.3 § 2 8축 차별화 #4 — "매출 + 신규 + 휴면" 같은 다중 목표 동시 박을 때
 *   Opus 4.7이 충돌 없는 흐름 자동 분석 + 우선순위 박음 + 사용자 검토 흐름 박음.
 *   Braze Canvas는 1 목표 = 1 흐름 / 한줄로는 N 목표 → AI가 충돌 분석 박음.
 *
 * 📊 흐름
 *   1. 사용자: createOperator 박을 때 goals JSON 배열 박음 (단일 objective 박은 영역 확장)
 *      예: [{ name: "VIP 재구매", weight: 0.5 }, { name: "휴면 회수", weight: 0.3 }, { name: "신규 유입", weight: 0.2 }]
 *   2. generateProposalForOperator 호출 시 analyzeGoalConflicts 박음
 *   3. Opus 4.7이 각 목표별 타겟 + 채널 + 시점 박은 후 충돌 영역 박음 (예: 동일 고객 동시 발송, 메시지 중복 등)
 *   4. 우선순위 박음 + 충돌 없는 통합 proposal 박음
 *   5. 사용자가 본 분석 검토 + 승인 박음 (영구 원칙 #1 — AI 단독 실행 X)
 *
 * ⛔ 영구 원칙 정합
 *   - AI 단독 실행 X — 다중 목표 분석 결과는 사용자 검토 후 발송
 *   - Zero-Count #2 — 각 목표별 target 0건 시 본 목표 제외 (전체 차단 X, 그 목표만 차단)
 *   - 모델 분리 #3 — Opus 4.7 영역 (AI Operator 영역, Sonnet 4.6 흐름 영향 0건)
 */

import { callAIWithFallback } from '../services/ai';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface OperatorGoal {
  name: string;           // "VIP 재구매" / "휴면 회수" / "신규 유입"
  description?: string;   // 자연어 상세
  weight: number;         // 0.0~1.0 (각 목표 가중치 합 = 1.0 정합)
}

export interface GoalSubPlan {
  goalName: string;
  targetCriteria: string;     // AI가 박은 타겟 조건 (자연어 + filters JSON)
  channelRecommended: string; // SMS / LMS / 알림톡 / Push / Email
  timingRecommended: string;  // 박을 시점 (KST)
  conflicts: string[];        // 다른 목표와의 충돌 영역
  priority: number;           // 1 = 최우선, N = 후순위
  shouldExecute: boolean;     // 충돌/Zero-Count 결과로 실행 여부
  reasoning: string;
}

export interface MultiGoalAnalysis {
  goals: OperatorGoal[];
  subPlans: GoalSubPlan[];
  overallStrategy: string;     // 통합 전략 사용자 노출용
  conflictMatrix: string;      // 충돌 매트릭스 사용자 노출용 (markdown)
  recommendedOrder: string[];  // 박을 순서 (goal name 배열)
  analyzedAt: Date;
}

// ════════════════════════════════════════════════════════════════════
// 충돌 분석 — Opus 4.7 Tool Use
// ════════════════════════════════════════════════════════════════════

export async function analyzeGoalConflicts(input: {
  goals: OperatorGoal[];
  companyInfo: any;
  customerStats: any;
}): Promise<MultiGoalAnalysis> {
  const { goals, companyInfo, customerStats } = input;

  if (goals.length === 0) {
    throw new Error('goals 배열은 1건 이상 필요합니다.');
  }

  // 단일 목표면 충돌 분석 박지 X — 단순 박음
  if (goals.length === 1) {
    return {
      goals,
      subPlans: [
        {
          goalName: goals[0].name,
          targetCriteria: goals[0].description || goals[0].name,
          channelRecommended: 'SMS',
          timingRecommended: '오후 2~4시 (KST)',
          conflicts: [],
          priority: 1,
          shouldExecute: true,
          reasoning: '단일 목표. 충돌 분석 불필요.',
        },
      ],
      overallStrategy: `단일 목표 "${goals[0].name}" 분석 완료. 표준 흐름 진행.`,
      conflictMatrix: '단일 목표라 충돌 매트릭스 불필요.',
      recommendedOrder: [goals[0].name],
      analyzedAt: new Date(),
    };
  }

  const systemPrompt = buildSystemPrompt(companyInfo, customerStats);
  const userMessage = `다음 ${goals.length}개 목표의 충돌을 분석하고 진행 순서를 도출해주세요:

${goals.map((g, i) => `${i + 1}. "${g.name}" (가중치 ${g.weight}${g.description ? `: ${g.description}` : ''})`).join('\n')}

각 목표에 대해 sub_plan을 생성하고, 다른 목표와의 충돌 영역(동일 고객 동시 발송 / 메시지 중복 / 시점 겹침 등)을 분석해주세요.
응답은 반드시 valid JSON으로만 응답해주세요 (다른 텍스트 X).`;

  let aiResponse = '';
  try {
    const aiResult = await callAIWithFallback({
      model: 'opus',
      system: systemPrompt,
      userMessage,
      maxTokens: 2000,
      temperature: 0,
      // ★ D209+ Phase D 통합: companyId + source 전달 → 회사별 월 한도 + cache + 통계 자동 활성.
      companyId: companyInfo?.id,
      source: 'multi-goal-decisioning',
    });
    aiResponse = aiResult || '';
  } catch (err: any) {
    console.error('[MultiGoal] AI 호출 실패:', err?.message || err);
    return fallbackAnalysis(goals);
  }

  // JSON 파싱
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 응답에서 JSON 찾을 수 없음');
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      goals,
      subPlans: (parsed.sub_plans || parsed.subPlans || []).map((sp: any, idx: number) => ({
        goalName: sp.goal_name || sp.goalName || goals[idx]?.name || `목표 ${idx + 1}`,
        targetCriteria: sp.target_criteria || sp.targetCriteria || '',
        channelRecommended: sp.channel_recommended || sp.channelRecommended || 'SMS',
        timingRecommended: sp.timing_recommended || sp.timingRecommended || '오후 2~4시 (KST)',
        conflicts: Array.isArray(sp.conflicts) ? sp.conflicts : [],
        priority: Number(sp.priority || idx + 1),
        shouldExecute: sp.should_execute !== false && sp.shouldExecute !== false,
        reasoning: sp.reasoning || '',
      })),
      overallStrategy: parsed.overall_strategy || parsed.overallStrategy || '',
      conflictMatrix: parsed.conflict_matrix || parsed.conflictMatrix || '',
      recommendedOrder: Array.isArray(parsed.recommended_order)
        ? parsed.recommended_order
        : Array.isArray(parsed.recommendedOrder)
          ? parsed.recommendedOrder
          : goals.map((g) => g.name),
      analyzedAt: new Date(),
    };
  } catch (err: any) {
    console.error('[MultiGoal] JSON 파싱 실패:', err?.message || err);
    return fallbackAnalysis(goals);
  }
}

function buildSystemPrompt(companyInfo: any, customerStats: any): string {
  return `당신은 한줄로AI Multi-Goal Decisioning 분석 에이전트입니다.

회사 정보:
- 회사: ${companyInfo.company_name || '미설정'}
- 브랜드: ${companyInfo.brand_name || '미설정'}
- 톤: ${companyInfo.brand_tone || '친절하고 전문적'}

고객 통계:
- 전체 고객: ${customerStats.total || 0}명
- SMS 수신 동의: ${customerStats.sms_opt_in_count || 0}명
- 평균 구매 횟수: ${customerStats.avg_purchase_count || 0}
- 평균 구매 금액: ${customerStats.avg_total_spent || 0}원

분석 원칙 (영구):
1. 각 목표에 대해 target_criteria + channel_recommended + timing_recommended + priority 도출
2. 다른 목표와의 충돌(동일 고객 동시 발송 / 메시지 중복 / 시점 겹침)을 conflicts 배열에 명시
3. 우선순위 + 가중치 기반으로 recommended_order 작성 (목표 이름 배열)
4. overall_strategy: 사용자 노출용 통합 전략 (한국어, 3~5 문장)
5. conflict_matrix: 사용자 노출용 충돌 매트릭스 (markdown 표)
6. 한국 SMB 마케팅 영역 정합 (정보통신망법 + 카카오 정책 + 통신사 스팸 정책)
7. AI 단독 실행 X. 본 분석은 추천만 제공, 발송은 사용자 승인 후

응답 형식 (valid JSON only, 다른 텍스트 X):
{
  "sub_plans": [
    {
      "goal_name": "VIP 재구매",
      "target_criteria": "VIP 등급 + 최근 30일 미구매 고객",
      "channel_recommended": "알림톡",
      "timing_recommended": "화/목 오후 2시 (KST)",
      "conflicts": ["휴면 회수 목표와 동일 고객 겹칠 수 있음. 등급 우선 적용"],
      "priority": 1,
      "should_execute": true,
      "reasoning": "VIP 가중치 0.5로 최우선 적용"
    }
  ],
  "overall_strategy": "...",
  "conflict_matrix": "| 목표 A | 목표 B | 충돌 영역 |\\n|---|---|---|\\n| VIP 재구매 | 휴면 회수 | 등급 우선 적용 |",
  "recommended_order": ["VIP 재구매", "휴면 회수", "신규 유입"]
}`;
}

function fallbackAnalysis(goals: OperatorGoal[]): MultiGoalAnalysis {
  // AI 실패 시 가중치 기반 단순 정렬
  const sorted = [...goals].sort((a, b) => b.weight - a.weight);
  return {
    goals,
    subPlans: sorted.map((g, idx) => ({
      goalName: g.name,
      targetCriteria: g.description || g.name,
      channelRecommended: 'SMS',
      timingRecommended: '오후 2~4시 (KST)',
      conflicts: idx > 0 ? [`${sorted[0].name}과 동일 고객 겹칠 가능성. 우선순위 적용`] : [],
      priority: idx + 1,
      shouldExecute: true,
      reasoning: `가중치 ${g.weight} 기반 fallback 적용 (AI 분석 실패)`,
    })),
    overallStrategy: `${goals.length}개 목표를 가중치 기반으로 정렬 (AI 충돌 분석 실패, 표준 흐름 fallback).`,
    conflictMatrix: 'AI 분석 실패. 충돌 매트릭스를 도출하지 못했습니다. 사용자 직접 검토 진행해주세요.',
    recommendedOrder: sorted.map((g) => g.name),
    analyzedAt: new Date(),
  };
}
