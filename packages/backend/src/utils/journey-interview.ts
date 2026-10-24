/**
 * journey-interview.ts — 문장으로 여정 만들기: 질문표 · 답 검증 · 결정값 (★ 2026-09-30 여정 V2 2차 · 설계서 §5 · 순수 · DB/AI 0)
 *
 * 흐름: 문장 → (AI 해석 1회 · journey-interview-ai.ts) 여정 계획 1~4개 → **이 CT가 질문을 만든다** → 담당자가 고른다
 *       → 이 CT가 답을 검증하고 여정마다 설계 입력(시작 사건 · 목표 문장 · 혜택 · 자동 종료)을 정한다 → 여정마다 AI 설계 1회.
 *
 * 원칙
 *   - 질문은 코드가 만든다(AI 가 질문을 지어내지 않는다). 선택지는 레지스트리 · 회사 데이터 판정 안에서만.
 *   - 추천 답은 미리 골라 둔다 · [이대로 만들기]가 늘 가능하다(추가 입력 강요 금지 · 1클릭 원칙).
 *   - 혜택은 AI 가 채우지 않는다(AI 가 지어낸 혜택이 발송되는 것을 막는 자리 · 혜택은 사람만 안다).
 *     ★ 2026-10-23 한 줄 여정 한 길 — 담당자가 한 줄에 직접 적은 혜택 · 마감일은 듣기(listenLine)가 읽어 칸에 채워 둔다(사람의 글 · 고치거나 지울 수 있다).
 *   - 자동 종료 추천값 = 트리거 계약 파생(defaultGoalExitFor · Harold 승인 결정 1).
 */
import {
  TRIGGER_CONTRACTS, aiSelectableTriggerEvents, defaultGoalExitFor, laneForTrigger, triggerLabel,
} from './journey-trigger-capability';
import type { LineQuestion, LineQuestionOption } from './one-line-ct/questions';

export const MAX_INTERVIEW_PLANS = 4;
export const MAX_BENEFIT_CHARS = 200;
const MESSAGE_COUNT_OPTIONS = ['1', '2', '3', '4'] as const;

export interface InterviewPlan {
  /** p1 · p2 … 고객이 지나는 순서. */
  key: string;
  triggerEvent: string;
  title: string;
  objective: string;
  /** ★ 2026-10-23 담당자가 쓴 한 줄 그대로(대상 조건 · 지역 · 성별 · 등급의 근거). 시작 사건이 정해진 입구(카드 · 빠른 시작)는 없다. */
  sentence?: string;
}

/** ★ 2026-10-24 질문 모양 = 한 줄 CT 한 곳(one-line-ct/questions · 자동 마케팅 질문표와 같은 모양) */
export type InterviewOption = LineQuestionOption;

export interface InterviewQuestion extends LineQuestion {
  planKey: string;
  /** 시작 사건별 추천 답(자동 종료 질문 · 시작 사건을 바꾸면 추천도 따라 바뀐다). */
  recommendedByTrigger?: Record<string, string>;
  /** 이 시작 사건을 고르면 질문을 숨긴다(자동 종료가 뜻이 없는 사건 = 메시지를 다 보내면 끝나는 여정). */
  hideForTriggers?: string[];
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

/** 한 줄에서 읽어 칸에 채워 둘 값(담당자가 직접 적은 것만 · listenLine). */
export interface InterviewPrefill { benefit?: string | null; entryEndsOn?: string | null }

export function buildInterviewQuestions(plans: InterviewPlan[], availability: TriggerAvailability, prefill: InterviewPrefill = {}): InterviewQuestion[] {
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
      help: prefill.benefit ? '한 줄에 적은 혜택을 넣어 두었어요. 이 혜택만 실어요.' : '비워 두면 혜택 자리를 표시해 두고, 켜기 전에 채우게 해요.',
      placeholder: '예: 첫 구매 10% 쿠폰',
      maxLength: MAX_BENEFIT_CHARS,
      ...(prefill.benefit ? { recommended: String(prefill.benefit).slice(0, MAX_BENEFIT_CHARS) } : {}),
      required: false,
    });
    // ★ 2026-10-23 새 고객을 받는 마지막 날(V.3 entry_ends_on) — 한 줄에 마감이 있으면 그날을 채워 둔다 · 비우면 계속 받는다.
    out.push({
      id: `${p.key}:ends`,
      planKey: p.key,
      kind: 'date',
      label: '새 고객은 언제까지 받을까요?',
      help: prefill.entryEndsOn ? '한 줄에 적은 마감일을 넣어 두었어요. 그날 뒤로는 새 고객을 받지 않아요.' : '비워 두면 계속 받아요.',
      ...(prefill.entryEndsOn ? { recommended: prefill.entryEndsOn } : {}),
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
  /** 새 고객을 받는 마지막 날(YYYY-MM-DD · KST) · null = 계속 받는다. */
  entryEndsOn: string | null;
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
  todayKst?: string,
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

  // 혜택 = 고른 답 · 없으면 한 줄에서 채워 둔 값(지우면 빈 글 = 혜택 없음)
  const benefitRaw = String(answers[`${plan.key}:benefit`] ?? q('benefit')?.recommended ?? '').trim();
  if (benefitRaw.length > MAX_BENEFIT_CHARS) return { ok: false, error: `${plan.title}: 혜택은 ${MAX_BENEFIT_CHARS}자 안으로 적어 주세요.` };

  const endsRaw = String(answers[`${plan.key}:ends`] ?? q('ends')?.recommended ?? '').trim();
  let entryEndsOn: string | null = null;
  if (endsRaw) {
    if (!isYmd(endsRaw)) return { ok: false, error: `${plan.title}: 마지막 날은 날짜로 골라 주세요.` };
    if (endsRaw < (todayKst || kstTodayYmd())) return { ok: false, error: `${plan.title}: 마지막 날이 이미 지났어요. 오늘이나 그 뒤로 골라 주세요.` };
    entryEndsOn = endsRaw;
  }

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
      entryEndsOn,
    },
  };
}

function isYmd(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** 오늘(KST · YYYY-MM-DD). */
export function kstTodayYmd(nowMs = Date.now()): string {
  return new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(0, 10);
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
      ...(String(p?.sentence || '').trim() ? { sentence: String(p.sentence).trim().slice(0, 300) } : {}),
    });
    if (out.length >= MAX_INTERVIEW_PLANS) break;
  }
  return out;
}
