/**
 * CT-59: Journey Step Diagnosis — D211+ Phase 2 (2026-05-23 Harold 명시)
 *
 * AI 자동 진단 + 다음 단계 추천 — 옛 buildJourneyStats + ai-self-diagnosis 진화 + journey 단위 본질
 *
 * 본질:
 *   - 옛 next-action-advisor = 회사 30일 단위 다음 캠페인 추천
 *   - 옛 ai-self-diagnosis = 회사 건강 종합 진단
 *   - 신규 CT-59 = 특정 journey 단위 step별 진단 + 다음 step 추천 (Braze 진정 압도 본질)
 *
 * 사용처:
 *   - routes/ai.ts GET /operator/journeys/:id/step-diagnosis
 *   - routes/ai.ts GET /operator/journeys/:id/recommend-next-step
 *   - JourneysPage 안 step별 진단 카드 + next step 추천 카드 통합
 *
 * 영구 룰 정합:
 *   - 회사 격리 (verifyJourneyOwnership 의무)
 *   - 모델 분리 (Sonnet 4.6 — 단순 분석/추천 영역, D209+ 정합)
 *   - AI 임의 혜택 X (placeholder 유지)
 *   - feedback_no_target_auto_relax (자동 정정 X — 회사 admin 명시 적용 의무)
 *   - 6,000사+ 운영 영향 0 (Read-only 진단 + 추천만)
 */

import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { buildJourneyStats, JourneyFullStats, JourneyStepStat } from './journey-stats';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 인터페이스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface JourneyStepDiagnosis {
  journeyId: string;
  diagnosedAt: Date;
  overallScore: number;            // 0~100 (여정 건강 점수)
  topConcerns: string[];           // 우선 처리 영역 3건
  steps: StepDiagnosisItem[];
  totalEntered: number;
  totalCompleted: number;
  completionRate: number;
}

export interface StepDiagnosisItem {
  stepId: string;
  stepOrder: number;
  stepType: string;
  severity: 'good' | 'warning' | 'critical';
  funnelPercentage: number;
  dropoutRate: number;             // (이전 step entered - 현 step entered) / 이전 step entered
  topExitReason: string;           // '발송 시간대 차단' / '수신거부' / '조건 미충족' / 'wait 시간 초과' / '정상'
  topExitReasonCount: number;
  recommendation: string;          // AI 추천 자연어 한 줄
  oneClickAction: OneClickAction | null;
}

export interface OneClickAction {
  type: 'adjust_wait_hours' | 'adjust_condition' | 'add_variant' | 'pause_journey' | 'expand_send_hours';
  label: string;                   // 회사 admin 노출 버튼 label
  payload: Record<string, any>;    // 1-click 실행 시 전달 영역
}

export interface NextStepRecommendation {
  journeyId: string;
  recommendedAt: Date;
  currentStepCount: number;
  recommended: RecommendedStep;
  alternatives: RecommendedStep[];
  reasoning: string;               // 전체 추천 사유
}

export interface RecommendedStep {
  stepType: 'message' | 'wait' | 'condition';
  delayHours: number;
  channel: 'sms' | 'lms' | 'mms' | null;
  messageTemplate: string | null;
  subject: string | null;
  conditionType: string | null;
  reasoning: string;
  expectedImpact: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. diagnoseJourneySteps — 여정 단계별 진단
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function diagnoseJourneySteps(
  journeyId: string,
  companyId: string,
): Promise<JourneyStepDiagnosis> {
  // buildJourneyStats — 옛 회사 격리 검증 통합 (verifyJourneyOwnership)
  const stats: JourneyFullStats = await buildJourneyStats(journeyId, companyId);

  const messageSteps = stats.steps.filter((s) => s.stepType === 'message');
  const waitSteps = stats.steps.filter((s) => s.stepType === 'wait');
  void waitSteps;

  // 각 step별 진단 매트릭스
  const stepDiagnoses: StepDiagnosisItem[] = [];
  const sortedSteps = [...stats.steps].sort((a, b) => a.stepOrder - b.stepOrder);

  for (let i = 0; i < sortedSteps.length; i++) {
    const step = sortedSteps[i];
    const prevEntered = i === 0 ? step.enteredCount : sortedSteps[i - 1].enteredCount;
    const dropoutRate = prevEntered > 0 ? (prevEntered - step.enteredCount) / prevEntered : 0;
    const exit = identifyTopExitReason(step);

    // 심각도 매트릭스
    let severity: 'good' | 'warning' | 'critical' = 'good';
    if (i > 0 && dropoutRate > 0.5) severity = 'critical';
    else if (i > 0 && dropoutRate > 0.3) severity = 'warning';
    else if (step.funnelPercentage < 30 && i > 0) severity = 'warning';

    // 추천 매트릭스 + 1-click 액션 매트릭스
    const { recommendation, oneClickAction } = buildStepRecommendation(step, dropoutRate, exit.reason);

    stepDiagnoses.push({
      stepId: step.stepId,
      stepOrder: step.stepOrder,
      stepType: step.stepType,
      severity,
      funnelPercentage: step.funnelPercentage,
      dropoutRate,
      topExitReason: exit.reason,
      topExitReasonCount: exit.count,
      recommendation,
      oneClickAction,
    });
  }

  // 전체 건강 점수 (완료율 + 위험 step 수)
  const completionRate = stats.overview.totalEntered > 0
    ? stats.overview.completed / stats.overview.totalEntered
    : 0;
  const criticalCount = stepDiagnoses.filter((s) => s.severity === 'critical').length;
  const warningCount = stepDiagnoses.filter((s) => s.severity === 'warning').length;
  const overallScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(completionRate * 60 + (1 - criticalCount * 0.3 - warningCount * 0.1) * 40),
    ),
  );

  // 우선 처리 영역 3건
  const topConcerns: string[] = stepDiagnoses
    .filter((s) => s.severity !== 'good')
    .sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1;
      if (b.severity === 'critical' && a.severity !== 'critical') return 1;
      return b.dropoutRate - a.dropoutRate;
    })
    .slice(0, 3)
    .map((s) => `Step ${s.stepOrder} — ${s.topExitReason} (이탈 ${(s.dropoutRate * 100).toFixed(0)}%)`);

  if (topConcerns.length === 0 && messageSteps.length > 0) {
    topConcerns.push('전체 단계 정상 흐름 — 추가 단계 신설 검토 권장');
  }

  return {
    journeyId,
    diagnosedAt: new Date(),
    overallScore,
    topConcerns,
    steps: stepDiagnoses,
    totalEntered: stats.overview.totalEntered,
    totalCompleted: stats.overview.completed,
    completionRate,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. step별 이탈 사유 식별 + 추천 헬퍼
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function identifyTopExitReason(step: JourneyStepStat): { reason: string; count: number } {
  const candidates: Array<{ reason: string; count: number }> = [
    { reason: '발송 시간대 차단 (KST 21~08시 영역)', count: step.skippedHoursCount },
    { reason: '수신거부 (광고성 차단)', count: step.skippedOptOutCount },
    { reason: '고객 영역 누락', count: step.skippedNoCustomerCount },
    { reason: '조건 미충족', count: step.conditionFailedCount },
    { reason: 'wait 시간 영역 초과', count: step.waitedCount },
  ];
  candidates.sort((a, b) => b.count - a.count);
  if (candidates[0].count === 0) {
    return { reason: '정상 흐름', count: 0 };
  }
  return candidates[0];
}

function buildStepRecommendation(
  step: JourneyStepStat,
  dropoutRate: number,
  topExitReason: string,
): { recommendation: string; oneClickAction: OneClickAction | null } {
  // wait step 영역
  if (step.stepType === 'wait' && step.waitedCount > 0 && dropoutRate > 0.3) {
    return {
      recommendation: `wait 시간 영역 이탈 ${(dropoutRate * 100).toFixed(0)}% — 대기 시간 단축 검토 (현재 영역 → 권장 50% 단축)`,
      oneClickAction: {
        type: 'adjust_wait_hours',
        label: 'wait 시간 50% 단축 적용',
        payload: { stepId: step.stepId, halveHours: true },
      },
    };
  }

  // 발송 시간대 차단 영역
  if (topExitReason.includes('발송 시간대')) {
    return {
      recommendation: `KST 21~08시 발송 차단으로 ${step.skippedHoursCount.toLocaleString()}건 영역 누락 — 발송 시간대 매트릭스 확장 권장`,
      oneClickAction: {
        type: 'expand_send_hours',
        label: '발송 가능 시간대 확장 (KST 09~20시 → 08~21시)',
        payload: { stepId: step.stepId, expandHours: true },
      },
    };
  }

  // 수신거부 영역
  if (topExitReason.includes('수신거부')) {
    return {
      recommendation: `수신거부 누적 ${step.skippedOptOutCount.toLocaleString()}건 — 비광고성 안내 흐름 추가 검토 + 이전 단계 안 메시지 톤 정정 권장`,
      oneClickAction: null,
    };
  }

  // 조건 미충족 영역
  if (topExitReason.includes('조건 미충족')) {
    return {
      recommendation: `조건 미충족 ${step.conditionFailedCount.toLocaleString()}건 — 조건 영역 완화 또는 대체 흐름 추가 검토`,
      oneClickAction: {
        type: 'adjust_condition',
        label: '조건 영역 검토',
        payload: { stepId: step.stepId },
      },
    };
  }

  // 클릭률 영역 (message step 안 클릭률 5% 미만)
  if (step.stepType === 'message' && step.sentCount > 100 && step.clickRate < 0.05) {
    return {
      recommendation: `클릭률 ${(step.clickRate * 100).toFixed(1)}% — variant A/B 테스트 신설 권장 (옛 평균 대비 부족 영역)`,
      oneClickAction: {
        type: 'add_variant',
        label: 'A/B variant 신설',
        payload: { stepId: step.stepId },
      },
    };
  }

  // 정상 흐름 영역
  return {
    recommendation: dropoutRate < 0.1 ? '정상 흐름 — 추가 정정 영역 없음' : `이탈률 ${(dropoutRate * 100).toFixed(0)}% — 모니터링 영역`,
    oneClickAction: null,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. recommendNextJourneyStep — 다음 단계 자동 추천 (AI orchestrate)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function recommendNextJourneyStep(
  journeyId: string,
  companyId: string,
): Promise<NextStepRecommendation> {
  // journey 정보 조회
  const journeyRes = await query(
    `SELECT j.id, j.name, j.template_code, j.trigger_event, j.objective,
            (SELECT json_agg(s ORDER BY s.step_order)
             FROM (
               SELECT id, step_order, step_type, channel, delay_hours, message_template, subject
               FROM journey_steps WHERE journey_id = j.id
             ) s) AS steps
     FROM journeys j
     WHERE j.id = $1::uuid AND j.company_id = $2::uuid`,
    [journeyId, companyId],
  );
  if (journeyRes.rows.length === 0) {
    throw new Error('여정 접근 권한 없음 (회사 격리)');
  }
  const journey = journeyRes.rows[0];
  const existingSteps = (journey.steps || []) as Array<{
    step_order: number;
    step_type: string;
    channel: string | null;
    delay_hours: number;
    message_template: string | null;
    subject: string | null;
  }>;

  // 회사 정보
  const companyRes = await query(
    `SELECT company_name, brand_name, business_type, brand_tone FROM companies WHERE id = $1::uuid`,
    [companyId],
  );
  const company = companyRes.rows[0] || {};

  const system = `당신은 CRM 여정(journey) 설계 전문가입니다.
회사의 현재 여정 단계 흐름을 분석하여 가장 적합한 다음 단계 1개 + 대안 2개를 추천합니다.

영구 원칙:
- 구체 혜택(% / 원 / 무료 / 쿠폰) 임의 작성 절대 금지. 회사 admin이 직접 작성 (메시지 본문 안 [혜택 안내 — 직접 수정해주세요] placeholder 사용).
- 단계 흐름 안 발송 시간대 제약 (KST 09~20시 권장).
- 단계 간 wait 시간은 24~168h (1~7일) 범위 권장.
- 회사 admin 검토 + 승인 후 추가 — AI 자동 추가 X.

JSON 형식으로만 응답하세요.`;

  const stepsDescription = existingSteps.map((s, idx) => {
    if (s.step_type === 'wait') return `${idx + 1}. wait ${s.delay_hours}h`;
    if (s.step_type === 'condition') return `${idx + 1}. condition (분기)`;
    return `${idx + 1}. message [${s.channel || 'sms'}] delay=${s.delay_hours}h — "${(s.message_template || '').slice(0, 60)}..."`;
  }).join('\n');

  const userMessage = `## 회사 정보
- 회사명: ${company.brand_name || company.company_name || '브랜드'}
- 업종: ${company.business_type || '기타'}
- 브랜드 톤: ${company.brand_tone || '친근함'}

## 현재 여정
- 이름: ${journey.name}
- 템플릿: ${journey.template_code}
- 트리거: ${journey.trigger_event}
- 목표: ${journey.objective || '재구매 유도'}

## 현재 단계 흐름 (${existingSteps.length}개)
${stepsDescription || '(단계 영역 없음)'}

## 요청
위 흐름에 추가할 다음 단계 1개 + 대안 2개를 추천해주세요:
- stepType: message / wait / condition 중 하나
- delayHours: 직전 단계 후 대기 시간 (h)
- channel: sms / lms / mms (message 영역만)
- messageTemplate: 본문 (구체 혜택 절대 금지, [혜택 안내 — 직접 수정해주세요] placeholder)
- subject: LMS/MMS 영역 제목 (40자 이내)
- reasoning: 추천 사유 한 줄
- expectedImpact: 예상 영향 한 줄

## 출력 형식 (JSON만 응답)
{
  "recommended": {
    "stepType": "message",
    "delayHours": 48,
    "channel": "sms",
    "messageTemplate": "본문",
    "subject": null,
    "reasoning": "추천 사유",
    "expectedImpact": "예상 영향"
  },
  "alternatives": [
    { "stepType": "wait", "delayHours": 24, "channel": null, "messageTemplate": null, "subject": null, "reasoning": "...", "expectedImpact": "..." },
    { "stepType": "message", "delayHours": 72, "channel": "lms", "messageTemplate": "본문", "subject": "제목", "reasoning": "...", "expectedImpact": "..." }
  ],
  "reasoning": "전체 추천 사유"
}`;

  try {
    const text = await callAIWithFallback({
      system,
      userMessage,
      maxTokens: 1500,
      temperature: 0.3,
      // ★ D209+ Phase D 비용 안전 매트릭스 정합: Sonnet 4.6 + companyId + source
      model: 'sonnet',
      companyId,
      source: 'journey-step-diagnosis',
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
    const mapStep = (s: any): RecommendedStep => ({
      stepType: (['message', 'wait', 'condition'].includes(s?.stepType) ? s.stepType : 'message') as 'message' | 'wait' | 'condition',
      delayHours: typeof s?.delayHours === 'number' ? Math.max(0, Math.min(720, s.delayHours)) : 24,
      channel: (['sms', 'lms', 'mms'].includes(s?.channel) ? s.channel : null) as 'sms' | 'lms' | 'mms' | null,
      messageTemplate: typeof s?.messageTemplate === 'string' ? s.messageTemplate.slice(0, 2000) : null,
      subject: typeof s?.subject === 'string' ? s.subject.slice(0, 50) : null,
      conditionType: typeof s?.conditionType === 'string' ? s.conditionType : null,
      reasoning: typeof s?.reasoning === 'string' ? s.reasoning : '',
      expectedImpact: typeof s?.expectedImpact === 'string' ? s.expectedImpact : '',
    });

    return {
      journeyId,
      recommendedAt: new Date(),
      currentStepCount: existingSteps.length,
      recommended: mapStep(parsed.recommended || {}),
      alternatives: Array.isArray(parsed.alternatives)
        ? parsed.alternatives.slice(0, 3).map(mapStep)
        : [],
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    };
  } catch (err: any) {
    console.error('[JourneyStepDiagnosis] AI 호출 실패:', err?.message);
    return {
      journeyId,
      recommendedAt: new Date(),
      currentStepCount: existingSteps.length,
      recommended: {
        stepType: 'message',
        delayHours: 48,
        channel: 'sms',
        messageTemplate: null,
        subject: null,
        conditionType: null,
        reasoning: 'AI 추천 영역 일시 불가 — 잠시 후 다시 시도해주세요.',
        expectedImpact: '',
      },
      alternatives: [],
      reasoning: 'AI 호출 영역 오류 — 추후 자동 복구',
    };
  }
}
