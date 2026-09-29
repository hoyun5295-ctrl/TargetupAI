/**
 * journey-interview.ts — 문장으로 여정 만들기: 질문표 · 답 검증 · 결정값 (★ 2026-09-30 여정 V2 2차 · 설계서 §5 · 순수 · DB/AI 0)
 *
 * 흐름: 문장 → (AI 해석 1회 · journey-interview-ai.ts) 여정 계획 1~4개 → **이 CT가 질문을 만든다** → 담당자가 고른다
 *       → 이 CT가 답을 검증하고 여정마다 설계 입력(시작 사건 · 목표 문장 · 혜택 · 자동 종료)을 정한다 → 여정마다 AI 설계 1회.
 *
 * 원칙
 *   - 질문은 코드가 만든다(AI 가 질문을 지어내지 않는다). 선택지는 레지스트리 · 회사 데이터 판정 안에서만.
 *   - 추천 답은 미리 골라 둔다 · [이대로 만들기]가 늘 가능하다(추가 입력 강요 금지 · 1클릭 원칙).
 *   - 혜택은 미리 채우지 않는다(AI 가 지어낸 혜택이 발송되는 것을 막는 자리 · 혜택은 사람만 안다).
 *   - 자동 종료 추천값 = 트리거 계약 파생(defaultGoalExitFor · Harold 승인 결정 1).
 */
import {
  TRIGGER_CONTRACTS, aiSelectableTriggerEvents, defaultGoalExitFor, laneForTrigger, triggerLabel,
} from './journey-trigger-capability';

export const MAX_INTERVIEW_PLANS = 4;
export const MAX_BENEFIT_CHARS = 200;
const MESSAGE_COUNT_OPTIONS = ['1', '2', '3', '4'] as const;

export interface InterviewPlan {
  /** p1 · p2 … 고객이 지나는 순서. */
  key: string;
  triggerEvent: string;
  title: string;
  objective: string;
}

export interface InterviewOption {
  value: string;
  label: string;
  desc?: string;
  disabled?: boolean;
  reason?: string;
}

export interface InterviewQuestion {
  id: string;
  planKey: string;
  kind: 'choice' | 'text';
  label: string;
  help?: string;
  options?: InterviewOption[];
  /** 미리 골라 둔 답(없으면 비워 둠 = 혜택). */
  recommended?: string;
  /** 시작 사건별 추천 답(자동 종료 질문 · 시작 사건을 바꾸면 추천도 따라 바뀐다). */
  recommendedByTrigger?: Record<string, string>;
  /** 이 시작 사건을 고르면 질문을 숨긴다(자동 종료가 뜻이 없는 사건 = 메시지를 다 보내면 끝나는 여정). */
  hideForTriggers?: string[];
  required: boolean;
  placeholder?: string;
  maxLength?: number;
}

export type TriggerAvailability = Record<string, { available: boolean; reason: string }>;

/** 사건별로 알맞은 기본 횟수 — 생애 흐름은 3 · 순간(장바구니 · 생일 …)은 2. 담당자가 바꾼다(추천일 뿐). */
function recommendedMessageCount(triggerEvent: string): string {
  return laneForTrigger(triggerEvent) === 'moment' ? '2' : '3';
}

/** 한 계획에서 고를 수 있는 시작 사건 = AI 가 고른 것 + 같은 레인의 다른 사건(레지스트리 · AI 선택 가능 목록 안). */
function triggerOptionsFor(plan: InterviewPlan, availability: TriggerAvailability): InterviewOption[] {
  const selectable = new Set(aiSelectableTriggerEvents());
  const lane = laneForTrigger(plan.triggerEvent);
  const events = [plan.triggerEvent, ...TRIGGER_CONTRACTS
    .filter((c) => c.lane === lane && c.event !== plan.triggerEvent && selectable.has(c.event))
    .map((c) => c.event)];
  return [...new Set(events)].filter((e) => selectable.has(e)).map((e) => {
    const cap = availability[e];
    const c = TRIGGER_CONTRACTS.find((t) => t.event === e);
    return {
      value: e,
      label: triggerLabel(e),
      desc: c?.desc || '',
      disabled: cap ? !cap.available : false,
      reason: cap && !cap.available ? cap.reason : undefined,
    };
  });
}

export function buildInterviewQuestions(plans: InterviewPlan[], availability: TriggerAvailability): InterviewQuestion[] {
  const out: InterviewQuestion[] = [];
  const exitEvents = TRIGGER_CONTRACTS.map((c) => c.event);
  for (const p of plans) {
    const triggerOptions = triggerOptionsFor(p, availability);
    const firstOpen = triggerOptions.find((o) => !o.disabled);
    out.push({
      id: `${p.key}:trigger`,
      planKey: p.key,
      kind: 'choice',
      label: `${p.title}: 언제 시작할까요?`,
      options: triggerOptions,
      recommended: firstOpen?.value,
      required: true,
    });
    out.push({
      id: `${p.key}:messages`,
      planKey: p.key,
      kind: 'choice',
      label: '문자를 몇 번 보낼까요?',
      help: '간격은 AI 가 정하고 초안에서 고칠 수 있어요.',
      options: MESSAGE_COUNT_OPTIONS.map((n) => ({ value: n, label: `${n}번` })),
      recommended: recommendedMessageCount(firstOpen?.value || p.triggerEvent),
      required: true,
    });
    const recommendedByTrigger: Record<string, string> = {};
    const hideForTriggers: string[] = [];
    // 목표(구매 · 포인트 사용)로 끝낼 수 있는 사건만 묻는다. 끝까지 보내는 사건(배송 · 등급 · 생일 · 휴면 복귀 · 상시)은 숨기고 계약 기본값(꺼짐)에 맡긴다.
    for (const e of exitEvents) {
      if (defaultGoalExitFor(e)) recommendedByTrigger[e] = 'yes';
      else hideForTriggers.push(e);
    }
    out.push({
      id: `${p.key}:goal`,
      planKey: p.key,
      kind: 'choice',
      label: '목표를 이루면 남은 문자를 멈출까요?',
      help: '멈추면 다음 여정이 이어받을 수 있어요.',
      options: [{ value: 'yes', label: '멈춤', desc: '이미 구매한 고객에게 권유 문자를 더 보내지 않아요' }, { value: 'no', label: '끝까지 보냄' }],
      recommended: recommendedByTrigger[firstOpen?.value || p.triggerEvent] || 'yes',
      recommendedByTrigger,
      hideForTriggers,
      required: true,
    });
    out.push({
      id: `${p.key}:benefit`,
      planKey: p.key,
      kind: 'text',
      label: '넣을 혜택이 있나요?',
      help: '비워 두면 혜택 자리를 표시해 두고, 켜기 전에 채우게 해요.',
      placeholder: '예: 첫 구매 10% 쿠폰',
      maxLength: MAX_BENEFIT_CHARS,
      required: false,
    });
  }
  return out;
}

export interface JourneyDesignSpec {
  planKey: string;
  triggerEvent: string;
  title: string;
  /** 생성기 목표 문장(횟수 지시 포함). */
  objective: string;
  benefitText: string | null;
  messageCount: number;
  /** undefined = 계약 기본값에 맡긴다(메시지를 다 보내면 끝나는 사건). */
  goalExitEnabled: boolean | undefined;
}

export type InterviewAnswers = Record<string, string>;

/**
 * 한 계획의 답을 검증하고 설계 입력을 정한다. 답이 없으면 추천 답을 쓴다([이대로 만들기]).
 * ⛔ 선택지 밖 값 · 잠긴 시작 사건은 거부한다(화면 우회로 목록 밖 트리거가 저장되지 않게).
 */
export function decideJourneySpec(
  plan: InterviewPlan,
  questions: InterviewQuestion[],
  answers: InterviewAnswers,
): { ok: true; spec: JourneyDesignSpec } | { ok: false; error: string } {
  const q = (suffix: string) => questions.find((x) => x.id === `${plan.key}:${suffix}`);
  const pick = (suffix: string): string | undefined => {
    const v = answers[`${plan.key}:${suffix}`];
    return v !== undefined && v !== null && String(v).trim() !== '' ? String(v).trim() : q(suffix)?.recommended;
  };

  const trigQ = q('trigger');
  const trigger = pick('trigger');
  const trigOpt = trigQ?.options?.find((o) => o.value === trigger);
  if (!trigger || !trigOpt) return { ok: false, error: `${plan.title}: 시작 사건을 목록에서 골라 주세요.` };
  if (trigOpt.disabled) return { ok: false, error: `${plan.title}: ${trigOpt.label}은 지금 데이터로 만들 수 없어요. ${trigOpt.reason || ''}`.trim() };

  const countRaw = pick('messages');
  if (!countRaw || !MESSAGE_COUNT_OPTIONS.includes(countRaw as any)) return { ok: false, error: `${plan.title}: 보낼 횟수를 골라 주세요.` };
  const messageCount = Number(countRaw);

  const goalQ = q('goal');
  let goalExitEnabled: boolean | undefined;
  if (goalQ && !(goalQ.hideForTriggers || []).includes(trigger)) {
    const raw = answers[`${plan.key}:goal`];
    const g = raw !== undefined && raw !== null && String(raw).trim() !== '' ? String(raw).trim() : (goalQ.recommendedByTrigger?.[trigger] || goalQ.recommended);
    if (g !== 'yes' && g !== 'no') return { ok: false, error: `${plan.title}: 목표를 이루면 멈출지 골라 주세요.` };
    goalExitEnabled = g === 'yes';
  }

  const benefitRaw = String(answers[`${plan.key}:benefit`] ?? '').trim();
  if (benefitRaw.length > MAX_BENEFIT_CHARS) return { ok: false, error: `${plan.title}: 혜택은 ${MAX_BENEFIT_CHARS}자 안으로 적어 주세요.` };

  const objectiveBase = plan.objective.trim() || `${triggerLabel(trigger)} 고객에게 보내는 여정`;
  return {
    ok: true,
    spec: {
      planKey: plan.key,
      triggerEvent: trigger,
      title: plan.title,
      objective: `${objectiveBase} 문자는 ${messageCount}번 보냅니다.`,
      benefitText: benefitRaw || null,
      messageCount,
      goalExitEnabled,
    },
  };
}

/**
 * AI 해석 결과 정리 — 레지스트리(AI 선택 가능 목록) 밖 사건은 버리고 · 같은 사건은 하나로 · 최대 4개 · p1~p4 키.
 * 제목 · 목표는 길이만 자른다(내용을 바꾸지 않는다).
 */
export function sanitizeInterviewPlans(raw: unknown): InterviewPlan[] {
  const selectable = new Set(aiSelectableTriggerEvents());
  const list: any[] = Array.isArray((raw as any)?.plans) ? (raw as any).plans : [];
  const seen = new Set<string>();
  const out: InterviewPlan[] = [];
  for (const p of list) {
    const ev = String(p?.triggerEvent || '').trim();
    if (!selectable.has(ev) || seen.has(ev)) continue;
    seen.add(ev);
    out.push({
      key: `p${out.length + 1}`,
      triggerEvent: ev,
      title: String(p?.title || triggerLabel(ev) + ' 여정').trim().slice(0, 30),
      objective: String(p?.objective || '').trim().slice(0, 300),
    });
    if (out.length >= MAX_INTERVIEW_PLANS) break;
  }
  return out;
}
