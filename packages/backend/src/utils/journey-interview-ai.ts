/**
 * journey-interview-ai.ts — 문장으로 여정 만들기: 문장 해석 AI 1회 (★ 2026-09-30 여정 V2 2차 · 설계서 §5)
 *
 * 담당자 문장 한 줄 → 만들 여정 계획 1~4개(시작 사건 · 이름 · 목표 문장). 시작 사건은 **레지스트리 목록 안에서만**
 * (목록 밖 값은 sanitizeInterviewPlans 가 버린다 · 프롬프트는 경계가 아니다).
 *
 * 요금: 해석은 차감하지 않는다(runInCreditBundle = 이 안의 AI 호출 차감 0 · 호출 기록은 남음).
 *   차감은 여정 설계(journey-ai-generate 단가 × 만든 여정 수)에서만 한다 — 질문만 보고 그만두면 0.
 *   (Harold 승인 "요금 = 기존 여정 AI 생성 요금 기준 재사용" · 설계서 §5)
 */
import { extractJsonFromAiText } from './ai-json';
import { callAIWithFallback } from '../services/ai';
import { runInCreditBundle } from './ai-credit-context';
import { checkCredit } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { formatTriggerMenuForAi, resolveTriggerAvailability, availabilityByEvent, isCreatableTriggerEvent, isProductPickTrigger, triggerLabel } from './journey-trigger-capability';
// ★ 2026-10-23 한 줄 여정 한 길 — 듣기 · 반복 발송 점검 = 1023 한줄 CT(한 곳)
import { listenLine } from './one-line-ct/listen';
import { checkRecurringLine } from './one-line-ct/recurring';
import { presetObjectiveFor } from './journey-opportunities';
import { JOURNEY_TEMPLATES, type JourneyTemplateCode } from './journey-builder';
import { entryEndsColumnReady } from './journey-lineage';
import { JourneyMigrationPendingError } from './journey-trigger-db';
import { getCompanyJourneyFacts } from './company-data-profile';
import { generateJourneyPackage } from './journey-ai-generator';
import { JourneyInputError } from './journey-step-limits';
import { listJourneyCallbackNumbers, defaultCallbackOf, saveJourneyPackageAsDraft, nextDraftChargeKey, chargeThenSaveDraft } from './journey-draft-save';
import {
  buildInterviewQuestions, decideJourneySpec, sanitizeInterviewPlans, MAX_INTERVIEW_PLANS, kstTodayYmd,
  type InterviewAnswers, type InterviewPlan, type InterviewQuestion, type TriggerAvailability,
} from './journey-interview';

export const MAX_INTERVIEW_SENTENCE = 300;


export async function parseJourneyIntent(companyId: string, sentence: string): Promise<InterviewPlan[]> {
  const s = String(sentence || '').trim().slice(0, MAX_INTERVIEW_SENTENCE);
  const system = `당신은 한국 마케팅 자동화 여정 설계 도우미입니다. 담당자가 쓴 한 문장을 읽고 만들 여정 목록을 JSON 으로만 답합니다.

[고를 수 있는 시작 사건]
${formatTriggerMenuForAi()}

[규칙]
1. triggerEvent 는 위 목록의 값만 씁니다. 맞는 값이 없으면 그 여정은 빼세요.
2. 문장이 여러 단계를 말하면(예: 가입부터 재구매까지) 단계마다 여정 하나씩, 최대 ${MAX_INTERVIEW_PLANS}개, 고객이 지나는 순서대로 적습니다.
3. 한 가지 상황만 말하면 여정 하나만 적습니다.
4. title 은 12자 안팎의 여정 이름, objective 는 이 여정이 고객에게 무엇을 하려는지 한 문장입니다.
5. 할인율 · 쿠폰 금액 같은 혜택은 지어내지 마세요. 문장에 적힌 혜택만 objective 에 그대로 옮깁니다.
6. 설명 없이 JSON 만 답합니다.

[형식]
{"plans":[{"triggerEvent":"customer.created","title":"가입 환영","objective":"가입한 고객을 반기고 첫 구매를 권한다"}]}`;

  const text = await runInCreditBundle(() => callAIWithFallback({
    system,
    userMessage: `담당자 문장: ${s}`,
    maxTokens: 800,
    temperature: 0.2,
    model: 'sonnet',
    companyId,
    source: 'journey-interview-parse',
  }));
  let parsed: unknown;
  try {
    parsed = extractJsonFromAiText(text);
  } catch {
    return [];
  }
  return sanitizeInterviewPlans(parsed);
}

/** 이 회사의 시작 사건 가능 여부(사건 기준) — 질문 선택지의 잠금 · 설계 직전 재확인에 같이 쓴다. */
export async function loadInterviewAvailability(companyId: string): Promise<TriggerAvailability> {
  return availabilityByEvent(resolveTriggerAvailability(await getCompanyJourneyFacts(companyId)));
}

export interface InterviewPrepared {
  plans: InterviewPlan[];
  questions: InterviewQuestion[];
  callback: { defaultPhone: string | null; options: Array<{ phone: string; description: string | null }> };
  costPerJourney: number;
  /** ★ 2026-10-23 한 줄 반복 발송 점검(여정은 계속 나간다 · 날짜 말 · 혜택) — 막지 않는다 · 화면이 질문 위에 보인다. */
  notes: string[];
}

/**
 * ★ 2026-10-23 한 줄 여정 한 길 — 문장 → 계획(AI 해석 · 차감 0) + 듣기(listenLine · AI 0)로 혜택 · 마감일을 칸에 채워 둔다.
 *   한 줄 입구 · 지도 한 줄 · 문장으로 만들기가 모두 이 함수 하나다(옛: 한 줄은 패키지를 화면에 돌려주는 다른 길 · 돌려보기마다 차감).
 */
export async function prepareInterview(companyId: string, sentence: string): Promise<InterviewPrepared> {
  const [plans, availability, numbers] = await Promise.all([
    parseJourneyIntent(companyId, sentence),
    loadInterviewAvailability(companyId),
    listJourneyCallbackNumbers(companyId),
  ]);
  const intent = listenLine(sentence);
  const said = String(sentence || '').trim().slice(0, MAX_INTERVIEW_SENTENCE);
  return {
    plans: plans.map((p) => ({ ...p, sentence: said })),   // 대상 조건은 해석 AI 가 옮긴 목표문이 아니라 이 한 줄에서 읽는다(Codex 1R)
    questions: buildInterviewQuestions(plans, availability, { benefit: intent.concreteBenefit ? intent.benefit : null, entryEndsOn: intent.periodEnd }),
    callback: { defaultPhone: defaultCallbackOf(numbers), options: numbers.map((n) => ({ phone: n.phone, description: n.description })) },
    costPerJourney: getCreditCost('journey-ai-generate'),
    notes: checkRecurringLine(intent, 'journeys').map((n) => n.text),
  };
}

/**
 * ★ 2026-10-23 한 줄 여정 한 길 — 시작 사건이 정해진 입구(빠른 시작 · 기회 카드 · 다음 수 · 한 줄 답 카드 · 지도 [만들기])의 질문표.
 *   AI 0 · 차감 0 · 설계 · 저장은 문장과 같은 designJourneyFromInterview(초안마다 차감 · 멱등).
 *   상품 재구매는 상품 고르기 창 전용(상품 없이 만들면 영영 0건).
 */
export async function prepareInterviewPreset(companyId: string, input: { triggerEvent?: string | null; templateCode?: string | null; objective?: string | null }): Promise<InterviewPrepared> {
  const fromTemplate = input.templateCode ? JOURNEY_TEMPLATES[input.templateCode as JourneyTemplateCode]?.triggerEvent : undefined;
  const trigger = String(input.triggerEvent || fromTemplate || '').trim();
  if (!trigger || !isCreatableTriggerEvent(trigger)) throw new JourneyInputError('지원하지 않는 시작 사건이에요. 다시 골라 주세요.');
  if (isProductPickTrigger(trigger)) throw new JourneyInputError('상품 재구매 여정은 상품을 고르는 창에서 만들어요.');
  const objective = String(input.objective || '').trim().slice(0, 300) || presetObjectiveFor(trigger) || '';
  const [plan] = sanitizeInterviewPlans({ plans: [{ triggerEvent: trigger, title: `${triggerLabel(trigger)} 여정`, objective }] });
  if (!plan) throw new JourneyInputError('만들 수 없는 시작 사건이에요. 다시 골라 주세요.');
  const [availability, numbers] = await Promise.all([loadInterviewAvailability(companyId), listJourneyCallbackNumbers(companyId)]);
  const intent = objective ? listenLine(objective) : null;
  return {
    plans: [plan],
    questions: buildInterviewQuestions([plan], availability, intent ? { benefit: intent.concreteBenefit ? intent.benefit : null, entryEndsOn: intent.periodEnd } : {}),
    callback: { defaultPhone: defaultCallbackOf(numbers), options: numbers.map((n) => ({ phone: n.phone, description: n.description })) },
    costPerJourney: getCreditCost('journey-ai-generate'),
    notes: [],
  };
}

export interface InterviewDesignResult {
  journeyId: string;
  name: string;
  triggerEvent: string;
  charged: number;
  /** ★ 2026-10-23 저장된 대상을 사람 말로(작업 화면을 열기 전에 보인다) · 반영 못 한 대상 조건 */
  targetSummary?: string;
  notices?: string[];
  /** 저장한 「목표를 이루면 멈춤」(다음 수 안내가 「이어받습니다」를 말하는 근거) */
  goalExitEnabled?: boolean;
}

// 같은 프로세스에서 같은 (회사 · 인터뷰 · 계획) 요청이 겹치거나 다시 오면 같은 결과를 돌려준다(두 번 누름 · 재시도). 30분 뒤 잊는다.
//   ★ 0930 Codex 1R · 6R — 여기는 덧장치다. 재시작 · 만료 뒤의 재전송은 원장(과금 시도 키)이 막는다(journey-draft-save nextDraftChargeKey).
const DESIGN_TTL_MS = 30 * 60 * 1000;
const designDone = new Map<string, { at: number; result: InterviewDesignResult }>();
const designInflight = new Map<string, Promise<InterviewDesignResult>>();

/**
 * 인터뷰 계획 하나 → AI 설계 1회(규약 밖 결과면 같은 묶음 안에서 1회 재요청) → 1회 차감 확정 → 서버 초안 저장.
 *   - 차감 = 기존 여정 AI 생성 단가(journey-ai-generate) · 요청 키 journey-interview:${companyId}:${interviewId}:${planKey} · 시도 키 = 요청 키#n
 *   - 설계가 실패하면 차감하지 않는다(묶음 안 AI 호출은 차감 0). 잔액 부족이면 초안 없이 402 · 저장이 실패하면 환불.
 */
export async function designJourneyFromInterview(input: {
  companyId: string;
  userId: string;
  interviewId: string;
  plan: InterviewPlan;
  answers: InterviewAnswers;
  callbackNumber?: string | null;
  /** ★ 2026-10-09 AI 진단 추천 — 서버가 다시 계산한 칸 시점(누적 일수) · 휴면 기준일. 화면 값이 아니다(라우트가 다시 계산해 넘긴다). */
  timing?: { daysFromStart: number[]; dormantDays?: number | null };
}): Promise<InterviewDesignResult> {
  const key = `${input.companyId}:${input.interviewId}:${input.plan.key}`;
  const now = Date.now();
  for (const [k, v] of designDone) if (now - v.at > DESIGN_TTL_MS) designDone.delete(k);
  const done = designDone.get(key);
  if (done) return done.result;
  const running = designInflight.get(key);
  if (running) return running;

  const job = (async () => {
    const [plan] = sanitizeInterviewPlans({ plans: [input.plan] });   // 사람이 쓴 한 줄(sentence)도 그대로 남는다
    if (!plan) throw new JourneyInputError('만들 수 없는 시작 사건이에요. 질문을 다시 받아 주세요.');
    plan.key = input.plan.key;
    plan.title = String(input.plan.title || plan.title).slice(0, 30);
    const availability = await loadInterviewAvailability(input.companyId);
    const decided = decideJourneySpec(plan, buildInterviewQuestions([plan], availability), input.answers || {}, kstTodayYmd());
    if (!decided.ok) throw new JourneyInputError(decided.error);
    const spec = decided.spec;

    const numbers = await listJourneyCallbackNumbers(input.companyId);
    const wanted = String(input.callbackNumber || '').replace(/-/g, '').trim();
    const callbackNumber = wanted && numbers.some((n) => n.phone === wanted) ? wanted : defaultCallbackOf(numbers);
    if (!callbackNumber) throw new JourneyInputError(numbers.length === 0 ? '회신번호를 먼저 등록해 주세요.' : '보낼 회신번호를 골라 주세요.');

    if (spec.entryEndsOn && !(await entryEndsColumnReady())) {
      throw new JourneyMigrationPendingError('새 고객 받는 마지막 날을 저장할 준비가 아직 안 됐어요. DB 마이그레이션 필요: 운영자에게 여정 표 ALTER 실행을 요청하거나 마지막 날을 비우고 만들어 주세요.');
    }
    const cost = getCreditCost('journey-ai-generate');
    const chargeKey = await nextDraftChargeKey(input.companyId, `journey-interview:${input.companyId}:${input.interviewId}:${plan.key}`);
    await checkCredit(input.companyId, cost);
    // 추천 시점은 AI 호출 **전에** 목표 문장에 싣는다(문안의 경과 표현이 실제 시점과 맞게 · 회의론자 D3) · 생성 뒤 같은 값으로 다시 고정.
    const timingText = input.timing && input.timing.daysFromStart.length > 0
      ? ` 보내는 시점은 ${input.timing.daysFromStart.map((d, i) => `${i + 1}번째 ${d === 0 ? '시작하자마자' : `시작 ${d}일 뒤`}`).join(', ')}입니다.`
      : '';
    const gen = () => generateJourneyPackage({
      companyId: input.companyId,
      createdBy: input.userId,
      objective: `${spec.objective}${timingText}`,
      preferTriggerEvent: spec.triggerEvent,
      audienceLine: plan.sentence,
      benefitText: spec.benefitText,   // null = 질문표에서 비움(목표문을 혜택 근거로 쓰지 않는다 · Codex 1R)
      timing: input.timing,
    });
    const pkg = await runInCreditBundle(async () => {
      try {
        return await gen();
      } catch (e) {
        if (e instanceof JourneyInputError) throw e;
        return gen();   // 규약 밖 결과(JSON 깨짐 등) = 같은 묶음 안에서 1회 재요청
      }
    });
    const { journeyId, charged } = await chargeThenSaveDraft({
      companyId: input.companyId,
      userId: input.userId,
      cost,
      chargeKey,
      save: () => saveJourneyPackageAsDraft(input.companyId, input.userId, pkg, {
        callbackNumber,
        objective: spec.objective,
        goalExitEnabled: spec.goalExitEnabled,
        entryEndsOn: spec.entryEndsOn,
      }),
    });
    const result: InterviewDesignResult = { journeyId, name: pkg.name, triggerEvent: spec.triggerEvent, charged, targetSummary: pkg.targetSummary, notices: pkg.droppedConditionNotices, goalExitEnabled: typeof spec.goalExitEnabled === 'boolean' ? spec.goalExitEnabled : pkg.goalExitDefault };
    designDone.set(key, { at: Date.now(), result });
    return result;
  })();
  designInflight.set(key, job);
  try {
    return await job;
  } finally {
    designInflight.delete(key);
  }
}
