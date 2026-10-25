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
 *   - 한줄로 운영 영향 0 (Read-only 진단 + 추천만)
 */

import { nightRangeKo, sendWindowKo } from './send-time-util';
import { extractJsonFromAiText } from './ai-json';
import { UserFacingError } from './http-error';
import { getCreditCost } from './ai-credit-calc';
import { runChargedAi, InsufficientCreditError } from './ai-credit';
import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { stripUnauthorizedBenefits, dropInventedEfficacyTitledBody, EFFICACY_PROMPT_RULES } from './copy-benefit-detector';
import { buildJourneyStats, JourneyFullStats, JourneyStepStat } from './journey-stats';
import { JOURNEY_SUBJECT_MAX_CHARS } from './journey-step-limits';

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
  // ★ 2026-09-27 한줄로 V2 R424 — 통계 화면과 같은 완주율(발송군 = 홀드아웃 제외 · journey-stats가 소유). 옛: 홀드아웃까지 분모에 넣어 화면과 달랐다.
  const completionRate = stats.overview.completionRate;
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
    .map((s) => `${s.stepOrder}번째 칸: ${s.topExitReason} (이탈 ${(s.dropoutRate * 100).toFixed(0)}%)`);

  if (topConcerns.length === 0 && messageSteps.length > 0) {
    topConcerns.push('모든 칸이 잘 흘러가요. 칸을 더해 볼 수 있어요.');
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
    { reason: `보낼 수 없는 발송 시간대(${nightRangeKo()})`, count: step.skippedHoursCount },
    { reason: '수신거부 (광고성 차단)', count: step.skippedOptOutCount },
    { reason: '고객 정보 없음', count: step.skippedNoCustomerCount },
    { reason: '조건 미충족', count: step.conditionFailedCount },
    { reason: '기다리는 중', count: step.waitedCount },
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
      recommendation: `기다리는 칸에서 ${(dropoutRate * 100).toFixed(0)}%가 빠져요. 대기 시간을 지금의 절반으로 줄여 보세요.`,
      oneClickAction: {
        type: 'adjust_wait_hours',
        label: '대기 시간 절반으로 줄이기',
        payload: { stepId: step.stepId, halveHours: true },
      },
    };
  }

  // 발송 시간대 차단 영역
  if (topExitReason.includes('발송 시간대')) {
    return {
      recommendation: `${nightRangeKo()}에 걸려 ${step.skippedHoursCount.toLocaleString()}건이 못 나갔어요. 보내는 시각을 낮으로 옮겨 보세요.`,
      oneClickAction: {
        type: 'expand_send_hours',
        // ★ 2026-10-25 원장 #40 — 옛 라벨 「KST 09~20시 → 08~21시」 = 없는 설정 · 숫자 박기
        label: `보내는 시각을 발송 가능 시간대(${sendWindowKo()}) 안으로 옮기기`,
        payload: { stepId: step.stepId, expandHours: true },
      },
    };
  }

  // 수신거부 영역
  if (topExitReason.includes('수신거부')) {
    return {
      recommendation: `수신거부 ${step.skippedOptOutCount.toLocaleString()}건. 광고가 아닌 안내 흐름을 더하거나 앞 칸 문안 말투를 고쳐 보세요.`,
      oneClickAction: null,
    };
  }

  // 조건 미충족 영역
  if (topExitReason.includes('조건 미충족')) {
    return {
      recommendation: `조건에 안 맞은 고객 ${step.conditionFailedCount.toLocaleString()}명. 조건을 넓히거나 다른 흐름을 더해 보세요.`,
      oneClickAction: {
        type: 'adjust_condition',
        label: '조건 다시 보기',
        payload: { stepId: step.stepId },
      },
    };
  }

  // 클릭률 영역 (message step 안 클릭률 5% 미만)
  if (step.stepType === 'message' && step.sentCount > 100 && step.clickRate < 0.05) {
    return {
      recommendation: `클릭률 ${(step.clickRate * 100).toFixed(1)}%. A/B 문안 시험을 해 보세요.`,
      oneClickAction: {
        type: 'add_variant',
        label: 'A/B 문안 만들기',
        payload: { stepId: step.stepId },
      },
    };
  }

  // 정상 흐름 영역
  return {
    recommendation: dropoutRate < 0.1 ? '잘 흘러가고 있어요. 고칠 곳이 없어요.' : `이탈률 ${(dropoutRate * 100).toFixed(0)}%. 조금 더 지켜볼게요.`,
    oneClickAction: null,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. recommendNextJourneyStep — 다음 단계 자동 추천 (AI orchestrate)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** ★ 2026-09-27 한줄로 V2 R424 — 여정 목표 종류(journeys.goal_kind · journey-options-validator GOAL_KINDS) → 프롬프트 표기.
 *  옛: 없는 칸(objective)을 읽어 목표가 늘 '재구매 유도'였다. */
const JOURNEY_GOAL_LABEL: Record<string, string> = { purchase: '구매 전환', click: '클릭 전환', visit: '방문 전환' };

export async function recommendNextJourneyStep(
  journeyId: string,
  companyId: string,
): Promise<NextStepRecommendation> {
  // journey 정보 조회
  const journeyRes = await query(
    `SELECT j.id, j.name, j.template_code, j.trigger_event, j.goal_kind,
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
    throw new UserFacingError(404, 'JOURNEY_NOT_FOUND', '여정을 찾을 수 없어요.');
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
${EFFICACY_PROMPT_RULES}
회사의 현재 여정 단계 흐름을 분석하여 가장 적합한 다음 단계 1개 + 대안 2개를 추천합니다.

영구 원칙:
- 구체 혜택(% / 원 / 무료 / 쿠폰) 임의 작성 절대 금지. 회사 admin이 직접 작성 (메시지 본문 안 [혜택 안내: 직접 수정해주세요] placeholder 사용).
- 단계 흐름 안 발송 시간대 제약 (KST 09~20시 권장).
- 단계 간 wait 시간은 24~168h (1~7일) 범위 권장.
- 회사 admin 검토 + 승인 후 추가. AI 자동 추가 X.

JSON 형식으로만 응답하세요.`;

  const stepsDescription = existingSteps.map((s, idx) => {
    if (s.step_type === 'wait') return `${idx + 1}. wait ${s.delay_hours}h`;
    if (s.step_type === 'condition') return `${idx + 1}. condition (분기)`;
    return `${idx + 1}. message [${s.channel || 'sms'}] delay=${s.delay_hours}h: "${(s.message_template || '').slice(0, 60)}..."`;
  }).join('\n');

  const userMessage = `## 회사 정보
- 회사명: ${company.brand_name || company.company_name || '브랜드'}
- 업종: ${company.business_type || '기타'}
- 브랜드 톤: ${company.brand_tone || '친근함'}

## 현재 여정
- 이름: ${journey.name}
- 템플릿: ${journey.template_code}
- 트리거: ${journey.trigger_event}
- 목표: ${JOURNEY_GOAL_LABEL[String(journey.goal_kind || '')] || '지정 안 됨(이름·트리거로 판단)'}

## 현재 단계 흐름 (${existingSteps.length}개)
${stepsDescription || '(단계 영역 없음)'}

## 요청
위 흐름에 추가할 다음 단계 1개 + 대안 2개를 추천해주세요:
- stepType: message / wait / condition 중 하나
- delayHours: 직전 단계 후 대기 시간 (h)
- channel: sms / lms / mms (message 영역만)
- messageTemplate: 본문 (구체 혜택 절대 금지, [혜택 안내: 직접 수정해주세요] placeholder)
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
    // ★ 2026-10-25 원장 Z4 — 돈 = AI 결과 정산 한 곳: 아래 본문이 끝까지 가면 걷고, 던지면(읽지 못함 등) catch 의 대체 결과 = 0원
    //   (옛: AI 응답 순간 차감 · 대체 결과를 줘도 나갔다) · 바깥 묶음 안이면 걷지 않는다
    const { result: chargedOut } = await runChargedAi({
      companyId: companyId, cost: getCreditCost('journey-step-diagnosis'), source: 'journey-step-diagnosis', createdBy: null,
      run: async () => {
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

        // ★ 2026-09-30 WP4 — JSON 추출은 CT 하나(ai-json · 머리말 · 코드펜스 · 문자열 안 제어문자 복구). 옛 코드펜스만 벗기는 인라인은 모델이 앞에 한 줄만 붙여도 실패했다.
        const parsed: any = extractJsonFromAiText(text);
        // ★ 2026-10-24 세 채널 구조체크 ② — 추천 문안도 고객 글이다(이 생산자만 거름이 없었다 · R13).
        //   근거 = 이 여정에 이미 저장된 본문 · 제목(사람이 확인한 글) · 혜택 → 자리표시 · 효능 → 문장 빼기(제목 = 비움)
        const recGround = existingSteps.map((s: any) => `${s?.message_template || ''}\n${s?.subject || ''}`).join('\n');
        //   제목 + 본문 = 이어 읽는 단위(CT dropInventedEfficacyTitledBody · 여정 생성과 같은 규칙)
        const guardPair = (s: any) => dropInventedEfficacyTitledBody(
          typeof s?.subject === 'string' ? stripUnauthorizedBenefits(s.subject.slice(0, JOURNEY_SUBJECT_MAX_CHARS), recGround) : '',
          typeof s?.messageTemplate === 'string' ? stripUnauthorizedBenefits(s.messageTemplate.slice(0, 2000), recGround) : '',
          recGround,
        );
        const mapStep = (s: any): RecommendedStep => ({
          stepType: (['message', 'wait', 'condition'].includes(s?.stepType) ? s.stepType : 'message') as 'message' | 'wait' | 'condition',
          delayHours: typeof s?.delayHours === 'number' ? Math.max(0, Math.min(720, s.delayHours)) : 24,
          channel: (['sms', 'lms', 'mms'].includes(s?.channel) ? s.channel : null) as 'sms' | 'lms' | 'mms' | null,
          messageTemplate: typeof s?.messageTemplate === 'string' ? guardPair(s).body : null,
          subject: typeof s?.subject === 'string' ? guardPair(s).subject : null,
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
  
      },
      // ★ 1026 Codex 1R — 쓸 결과 = 최종 결과 기준(옛: 늘 참이라 빈 결과에도 걷었다)
      accept: (r) => r.recommended.stepType !== 'message' || !!(r.recommended.messageTemplate || '').trim(),
    });
    return chargedOut;
  } catch (err: any) {
    // 잔액 부족 · 원장 쓰기 실패는 대체 결과로 접지 않는다(호출부 402 · 503)
    if (err instanceof InsufficientCreditError || err instanceof UserFacingError) throw err;
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
        reasoning: 'AI 추천을 지금 만들 수 없어요. 잠시 뒤 다시 시도해 주세요.',
        expectedImpact: '',
      },
      alternatives: [],
      reasoning: 'AI 추천을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    };
  }
}
