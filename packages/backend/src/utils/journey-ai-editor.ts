/**
 * CT utils/journey-ai-editor.ts (2026-06-29 신설)
 *
 * 대화형 여정 수정 — 생성된 여정 패키지(초안)에 사용자가 자연어로 요청한 변경을 AI가 반영.
 *   예: "2단계 하루 늦추고 VIP만 보내줘" → 해당 step delayHours 조정 + 조건 추가.
 *   생성기(journey-ai-generator)는 message 전용이라 재사용 불가 — wait/condition/알림톡 step을 보존해야 하므로 별도 정규화.
 *
 * 영구 룰 정합:
 *  - 구체 혜택(%/원/무료/쿠폰/할인/적립) 임의 생성 금지 (feedback_ai_no_arbitrary_benefit) — placeholder 유지
 *  - (광고)/무료수신거부/제목 = 시스템 자동 합성 (본문 직접 작성 X)
 *  - 회사 격리: companyId 전달 (월 한도 + 통계)
 *  - 초안 패키지 편집만 — 저장/발송 경로 무변경 (프론트가 setAiPkg)
 */

import { callAIWithFallback } from '../services/ai';
import { sanitizeForSms } from './message-sanitizer';
import { stripAdParts } from './messageUtils';
import { resolveJourneyAdFlag } from './journey-ad-policy';
// ★ 2026-08-08 이어달리기 — 고정된 트리거는 편집으로 풀리지 않는다(설계서 §6).
import { isImplementedTriggerEvent, triggerTemplateCode } from './journey-trigger-capability';
import { describeJourneyTrigger } from './journey-step-format';
// ★ 2026-08-08 — 편집 결과도 생성과 같은 기계 차단을 지난다(프롬프트는 경계가 아니다).
import { stripUnauthorizedBenefits } from './copy-benefit-detector';

type ChannelType = 'sms' | 'lms' | 'mms' | 'kakao';
type StepType = 'message' | 'wait' | 'condition';

export interface EditJourneyInput {
  companyId: string;
  /** 프론트 AIJourneyPackage(풍부 step) — 초안 상태 */
  currentPackage: any;
  instruction: string;
}

function extractJSON(text: string): string {
  if (text.includes('```json')) {
    const start = text.indexOf('```json') + 7;
    const end = text.indexOf('```', start);
    return text.slice(start, end).trim();
  }
  if (text.includes('```')) {
    const start = text.indexOf('```') + 3;
    const end = text.indexOf('```', start);
    return text.slice(start, end).trim();
  }
  return text.trim();
}

function clampInt(v: any, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// 풍부 step 정규화 — 유형/채널/알림톡/조건 보존 (생성기의 message 전용 정규화와 분리)
function normalizeStep(s: any, idx: number): any {
  const stepType: StepType = ['message', 'wait', 'condition'].includes(s?.stepType) ? s.stepType : 'message';
  const channel: ChannelType = ['sms', 'lms', 'mms', 'kakao'].includes(s?.channel) ? s.channel : 'lms';

  const base: any = {
    stepOrder: idx + 1,
    stepType,
    delayHours: clampInt(s?.delayHours, 0, 720, 0),
    stepIntent: String(s?.stepIntent || '').slice(0, 100),
  };

  // 대기 방식 보존
  if (['relative', 'relative_at_hour', 'specific_hour', 'next_business_day'].includes(s?.delayMode)) {
    base.delayMode = s.delayMode;
    if (s.delayMode === 'relative_at_hour' || s.delayMode === 'specific_hour') {
      base.targetHourKst = clampInt(s?.targetHourKst, 0, 23, 9);
    }
  }

  if (stepType === 'condition') {
    // 조건 객체는 그대로 보존 (프론트가 추가 검증)
    base.channel = channel;
    base.messageTemplate = '';
    base.subject = '';
    base.isAd = false;
    if (s?.conditionJsonb && typeof s.conditionJsonb === 'object') base.conditionJsonb = s.conditionJsonb;
    return base;
  }

  if (stepType === 'wait') {
    base.channel = channel;
    base.messageTemplate = '';
    base.subject = '';
    base.isAd = false;
    return base;
  }

  // message step
  base.channel = channel;
  const rawMessage = String(s?.messageTemplate || '').slice(0, 2000);
  const rawSubject = channel === 'sms' ? '' : String(s?.subject || '').slice(0, 50);
  // 순수 본문/제목만 보존 — (광고)/무료수신거부는 발송·미리보기 시 합성 (이중부착 방지)
  base.messageTemplate = stripAdParts(sanitizeForSms(rawMessage).sanitized);
  base.subject = stripAdParts(sanitizeForSms(rawSubject).sanitized);
  base.isAd = channel === 'kakao' ? false : resolveJourneyAdFlag(channel, s?.isAd);

  // 알림톡(kakao) 설정 보존
  if (channel === 'kakao') {
    if (s?.alimtalkProfileId) base.alimtalkProfileId = String(s.alimtalkProfileId);
    if (s?.alimtalkTemplateCode) base.alimtalkTemplateCode = String(s.alimtalkTemplateCode);
    if (s?.alimtalkVariableMap && typeof s.alimtalkVariableMap === 'object') base.alimtalkVariableMap = s.alimtalkVariableMap;
    if (s?.alimtalkNextType) base.alimtalkNextType = s.alimtalkNextType;
    if (s?.alimtalkNextContents != null) base.alimtalkNextContents = String(s.alimtalkNextContents);
    if (s?.alimtalkNextSubject != null) base.alimtalkNextSubject = String(s.alimtalkNextSubject);
  }
  // MMS 이미지 보존
  if (channel === 'mms' && Array.isArray(s?.mmsImagePaths)) base.mmsImagePaths = s.mmsImagePaths.slice(0, 3).map((p: any) => String(p));

  return base;
}

/**
 * 초안 여정 패키지에 자연어 수정 요청을 AI로 반영해 전체 패키지를 반환.
 * 발송·돈 경로 무변경 — 프론트 setAiPkg 용 초안 편집.
 */
export async function editJourneyPackage(input: EditJourneyInput): Promise<any> {
  const cur = input.currentPackage || {};
  const instruction = String(input.instruction || '').trim();
  if (instruction.length < 2) throw new Error('수정 요청 문구가 너무 짧습니다.');

  // ★ 2026-08-08 이어달리기 — 고정된 시작 신호는 편집으로 풀리지 않는다.
  //   후처리로 트리거만 되돌리면 **문안은 다른 대상 기준으로 다시 쓰인 채** 남아 대상과 내용이 갈린다.
  //   그래서 AI에게 전제를 먼저 주고(아래 프롬프트), 결과는 계약값으로 다시 고정한다(아래 후처리).
  const presetTrigger = typeof cur.presetTriggerEvent === 'string' && isImplementedTriggerEvent(cur.presetTriggerEvent)
    ? cur.presetTriggerEvent : null;
  const presetLabel = presetTrigger ? describeJourneyTrigger(presetTrigger, {}) : '';

  // ★ 2026-08-08 혜택 입력 (Codex 1R) — benefitText를 메타데이터로만 복사하면 문안과 갈린다:
  //   편집 프롬프트는 "구체 혜택 placeholder 유지"를 지시하므로 모델이 유효한 혜택을 지우거나,
  //   반대로 새 혜택을 지어내도 통과했다. 지시(아래 프롬프트)와 차단(반환 직전 strip) 둘 다 건다.
  const benefitText = typeof cur.benefitText === 'string' && cur.benefitText.trim()
    ? cur.benefitText.trim().slice(0, 200) : null;

  const system = `당신은 한줄로 AI Operator의 여정 편집기입니다. 사용자가 자연어로 요청한 수정을 현재 여정 패키지(JSON)에 정확히 반영해 전체 패키지를 JSON으로 다시 응답합니다.

규칙:
- 요청한 부분만 수정하고 나머지 step·문안·설정은 그대로 유지한다.
- step 유형(message/wait/condition)·채널·알림톡 설정·조건(conditionJsonb)은 사용자가 요청할 때만 바꾼다. 그 외에는 받은 값을 그대로 돌려준다.
- 구체 혜택(%·원·무료·쿠폰·할인·적립·사은품)은 **새로 지어내지 않는다**. 단 다음은 사용자가 준 값이라 창작이 아니다 — placeholder로 바꾸지 말고 그대로 유지·사용한다:
  ① 현재 패키지의 본문·제목에 이미 있는 혜택  ② 사용자 수정 요청문에 적힌 혜택${benefitText ? `  ③ 회사가 승인한 혜택 "${benefitText}"` : ''}
  그 밖의 혜택 자리는 [혜택 안내 — 직접 수정해주세요] 형태 placeholder를 유지한다.
- (광고) 접두사·무료수신거부·제목 자동 합성은 시스템이 처리하므로 본문에 직접 쓰지 않는다.
- 여정은 연중 상시 자동 발송이다. 문안을 새로 쓰거나 다듬을 때 계절·월·날씨·명절 언급 금지 (시간 불문 감성으로). 원본에 계절 표현이 있으면 시간 불문 표현으로 교체한다. 단, 사용자 요청문에 계절·명절이 명시된 경우에만 반영.
- step은 최대 7개.
- 개인화 변수는 %고객명% 형태만 쓰고, 불확실한 변수는 만들지 않는다.

응답은 코드블록 없이 JSON만. 스키마:
{
  "name": string,
  "templateCode": "onboarding"|"repeat"|"dormant"|"cart"|"birthday"|"reservation"|"custom",
  "triggerEvent": string,
  "triggerFilters": object,
  "steps": [{ "stepOrder": number, "stepType": "message"|"wait"|"condition", "delayHours": number, "channel": "sms"|"lms"|"mms"|"kakao", "messageTemplate": string, "subject": string, "isAd": boolean, "stepIntent": string, "conditionJsonb": object|null, "delayMode": string|null, "targetHourKst": number|null, "alimtalkProfileId": string|null, "alimtalkTemplateCode": string|null, "alimtalkVariableMap": object|null }],
  "allowReentry": boolean,
  "reentryCooldownDays": number|null,
  "reasoning": "무엇을 어떻게 바꿨는지 한국어 한 줄"
}`;

  const userMessage = `현재 여정 패키지(JSON):
${JSON.stringify({
    name: cur.name,
    templateCode: cur.templateCode,
    triggerEvent: cur.triggerEvent,
    triggerFilters: cur.triggerFilters,
    steps: cur.steps,
    allowReentry: cur.allowReentry,
    reentryCooldownDays: cur.reentryCooldownDays,
  })}

사용자 수정 요청: ${instruction}
${presetTrigger ? `
[시작 신호 고정] 이 여정은 "${presetLabel}"에게 나갑니다. 대상은 바꾸지 말고 그 대상 기준으로만 문안을 고치세요.
triggerEvent·templateCode·triggerFilters는 받은 값을 그대로 돌려주세요. 사용자가 대상 변경을 요청해도 문안은 위 대상 기준을 유지합니다.
` : ''}
위 요청을 반영한 전체 패키지를 JSON으로만 응답하세요.`;

  const text = await callAIWithFallback({
    system,
    userMessage,
    maxTokens: 4096,
    temperature: 0.3,
    model: 'sonnet',
    companyId: input.companyId,
    source: 'journey-ai-edit',
  });

  let parsed: any;
  try {
    parsed = JSON.parse(extractJSON(text));
  } catch {
    throw new Error('AI 응답 JSON 파싱 실패. 요청을 더 명확히 작성해주세요.');
  }

  const rawSteps: any[] = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const steps = rawSteps.slice(0, 7).map((s, idx) => normalizeStep(s, idx));
  if (steps.length === 0) throw new Error('수정 결과에 유효한 step이 없습니다.');

  // ★ 2026-08-08 (Codex 1R) — 프롬프트는 경계가 아니다. 편집 결과의 지어낸 혜택도 기계로 되돌린다.
  //   근거 = 사용자가 준 문장 전부: 수정 요청문 + 승인 혜택 + **편집 전 패키지의 본문·제목**(비파괴 —
  //   이미 있던 혜택은 산다. 요청문에 쓴 새 혜택도 사용자 입력이라 산다. AI 창작만 죽는다).
  //   kakao 스텝은 승인 템플릿이 본체라 무접촉, wait·condition은 본문이 비어 대상이 아니다.
  const curSteps: any[] = Array.isArray(cur.steps) ? cur.steps : [];
  const editBasis = [
    instruction,
    benefitText || '',
    ...curSteps.map((s) => String(s?.messageTemplate || '')),
    ...curSteps.map((s) => String(s?.subject || '')),
  ].filter(Boolean).join('\n');
  for (const s of steps) {
    if (s.stepType !== 'message' || s.channel === 'kakao') continue;
    s.messageTemplate = stripUnauthorizedBenefits(String(s.messageTemplate || ''), editBasis);
    s.subject = stripUnauthorizedBenefits(String(s.subject || ''), editBasis);
  }

  const validTemplates = ['onboarding', 'repeat', 'dormant', 'cart', 'birthday', 'reservation', 'custom'];
  let templateCode = validTemplates.includes(parsed?.templateCode) ? parsed.templateCode : (cur.templateCode || 'custom');
  let triggerEvent = String(parsed?.triggerEvent || cur.triggerEvent || 'custom').slice(0, 50);
  let triggerFilters = (parsed?.triggerFilters && typeof parsed.triggerFilters === 'object') ? parsed.triggerFilters : (cur.triggerFilters || {});

  // ★ 2026-08-08 이어달리기 — 표식을 잃으면 화면이 저장에 트리거를 안 실어 약속과 다른 여정이 만들어지고,
  //   AI가 편집 중 트리거를 바꾸면 발송 대상 자체가 달라진다. 축은 계약이 계속 잡는다.
  //   ⛔ 대상을 바꾸려 든 응답은 **조용히 되돌리지 않는다** — 사유에 그대로 적어 사용자가 안다.
  let keptTargetNotice = '';
  if (presetTrigger) {
    const contractTemplate = triggerTemplateCode(presetTrigger) || 'custom';
    // ⛔ 이탈 판정은 **되돌리는 축 전부**를 본다. 트리거만 비교하면, AI가 같은 트리거에 조건만 붙이고
    //   "VIP만 보내도록 바꿨습니다"라고 답할 때 조건은 비워지는데 그 설명이 그대로 나간다 —
    //   사용자는 좁혀진 줄 알고 넓은 대상으로 활성화한다.
    const aiMovedTarget =
      (typeof parsed?.triggerEvent === 'string' && !!parsed.triggerEvent && parsed.triggerEvent !== presetTrigger)
      || (typeof parsed?.templateCode === 'string' && !!parsed.templateCode && parsed.templateCode !== contractTemplate)
      || (!!parsed?.triggerFilters && typeof parsed.triggerFilters === 'object' && Object.keys(parsed.triggerFilters).length > 0);
    if (aiMovedTarget) {
      // 사유는 **서버 문장으로 교체한다.** 대상을 옮긴 전제로 쓰인 설명은 문안 부분도 믿을 수 없다.
      keptTargetNotice = `대상은 바꾸지 않았습니다 — 시작 신호는 ${presetLabel} 그대로입니다. 대상을 바꾸려면 새 여정으로 만들어 주세요.`;
    }
    triggerEvent = presetTrigger;
    templateCode = contractTemplate;
    triggerFilters = {};
  }

  // 발송·타겟에 직결되는 trigger/회신/예산 힌트는 편집으로 잃지 않도록 현재값 유지 우선
  return {
    name: String(parsed?.name || cur.name || '여정').slice(0, 100),
    templateCode,
    triggerEvent,
    triggerFilters,
    presetTriggerEvent: presetTrigger,
    // ★ 2026-08-08 혜택 입력 — 편집도 패키지를 다시 만드는 자리다. 안 지나가면 수정 한 번에
    //   재생성 축에서 혜택이 사라진다(프리셋 유실과 같은 뿌리). 정규화 값은 위에서 한 번만 만든다.
    benefitText,
    steps,
    allowReentry: typeof parsed?.allowReentry === 'boolean' ? parsed.allowReentry : !!cur.allowReentry,
    reentryCooldownDays: parsed?.reentryCooldownDays != null ? clampInt(parsed.reentryCooldownDays, 0, 3650, 0) : (cur.reentryCooldownDays ?? null),
    callbackNumberHint: cur.callbackNumberHint ?? null,
    budgetMonthlyHint: cur.budgetMonthlyHint ?? null,
    thresholdCostHint: cur.thresholdCostHint ?? null,
    reasoning: (keptTargetNotice || String(parsed?.reasoning || '')).slice(0, 500),
  };
}
