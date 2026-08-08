/**
 * CT-45: Journey AI Generator — D187-fix3 One-shot AI Operator (2026-05-21)
 *
 * 목적
 *   자연어 한 줄 → 완전 여정 패키지 자동 생성. 진정 AI Operator 본질 정합.
 *   Sonnet 4.6 + ai_company_memory + 회사 톤 + 메모리 통합 (D209+ 전환 — 기존 ai.ts 흐름 정합).
 *   ★ 2026-07-05: 시즌 컨텍스트 주입 제거 — 여정은 상시 발송이라 계절 박제 금지(Harold 확정). 시간 불문 감성으로 통일.
 *
 * 영구 룰 정합
 *   - 여정 생성 model:'opus' (2026-06-01 가치 가격 — 핵심 작업 고급), 여정 다듬기는 'sonnet' 유지
 *   - ai_no_arbitrary_benefit: 구체 혜택(% / 원 / 무료 / 쿠폰) 임의 작성 X
 *       안내문/인사/감성 텍스트는 풍성, 혜택 영역만 [혜택 안내 — 직접 수정해주세요] placeholder
 *   - no_humuson_keyword_exposure: 검수 단어 X
 *   - 회사 격리: company_id FK
 *   - (광고)+080+KISA 제목 = 시스템 자동 합성 (직접 작성 X)
 */

import { callAIWithFallback, getKoreanCalendar } from '../services/ai';
import { buildMemoryPromptContext } from './company-memory';
// ★ D225+ (2026-05-28 Harold 명시): Brand Voice Learning — 회사별 LMS 대표 문안 5건 + 가이드라인 자동 주입.
import { buildSystemPromptWithBrandVoice } from './brand-voice-prompt';
// ★ 2026-06-23: 비카카오 여정 광고 표기 강제 정책 — AI 정보성 오판으로 (광고) 누락 차단.
import { resolveJourneyAdFlag } from './journey-ad-policy';
import { query } from '../config/database';
import { sanitizeForSms } from './message-sanitizer';
// ★ 2026-06-30: AI가 본문에 박은 (광고)/무료수신거부 제거 — body는 순수 본문, (광고)+080은 발송 시 buildAdMessage 자동 합성.
import { stripAdParts } from './messageUtils';
// ★ D210+ Phase 2 (Harold 명시 2026-05-23): CT-58 — 회사 customer DB 실측 프로필 동적 주입.
//   본질 = AI가 어설픈 변수 임의 작성 차단 (Harold 명시: "개인화 어설프게 실수로 들어가는게 더 안좋다").
import { getCompanyDataProfile, formatProfileForAiPrompt } from './company-data-profile';
// ★ 2026-08-02 §13-3: 발송 시점 문구는 화면·브리핑과 같은 단일 출처를 쓴다(AI에게 다른 말로 설명하지 않는다).
import { formatStepTiming, describeJourneyTrigger } from './journey-step-format';
// ★ 2026-08-08 이어달리기 — 트리거는 계약이 정한다(AI 출력에 약속을 걸지 않는다). 설계서 §6.
import { isImplementedTriggerEvent, triggerTemplateCode } from './journey-trigger-capability';
// 추천 문구의 단일 출처 — "이어서 만들기"와 기회 카드가 같은 목표 골격을 쓴다.
import { successionObjectiveFor } from './journey-opportunities';
// ★ 2026-08-02 (Codex 1R): AI가 지어낸 혜택 기계 차단 — 프롬프트는 경계가 아니다.
import { stripUnauthorizedBenefits } from './copy-benefit-detector';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface JourneyAIGenerateInput {
  companyId: string;
  createdBy: string;
  objective?: string;
  templateHint?: 'onboarding' | 'repeat' | 'dormant' | 'cart' | 'birthday' | 'reservation' | 'custom';
  /**
   * ★ 2026-08-08 이어달리기 — 추천이 약속한 트리거(journeys.trigger_event 저장값).
   *   값이 오면 **결과 트리거는 계약이 정한다** — AI는 스텝·문안만 설계한다.
   *   프롬프트 지시만으로는 보장이 아니다(AI가 다른 트리거를 내면 추천과 어긋난 여정이 만들어진다).
   */
  preferTriggerEvent?: string;
  /**
   * ★ 2026-08-08 혜택 입력 — 사용자가 준 혜택 하나(예: "신규 가입 10% 쿠폰").
   *   혜택은 AI가 못 지어내는 유일한 값이라 사용자 입력이 정당한 자리다.
   *   값이 오면 ①AI는 placeholder 대신 이것을 문안에 녹이고 ②차단기의 허용 근거에 합류한다 —
   *   입력한 혜택은 살고, AI가 덧붙인 다른 혜택은 여전히 placeholder로 되돌아간다.
   */
  benefitText?: string;
}

export interface GeneratedStep {
  stepOrder: number;
  stepType: 'message';
  delayHours: number;
  channel: 'sms' | 'lms' | 'mms';
  messageTemplate: string;
  subject: string;
  isAd: boolean;
  stepIntent: string;
}

export interface JourneyAIPackage {
  name: string;
  templateCode: string;
  triggerEvent: string;
  triggerFilters: Record<string, any>;
  steps: GeneratedStep[];
  allowReentry: boolean;
  reentryCooldownDays: number | null;
  callbackNumberHint: string | null;
  budgetMonthlyHint: number | null;
  thresholdCostHint: number | null;
  reasoning: string;
  /**
   * ★ 2026-08-08 이어달리기 — 이 패키지의 트리거가 **계약이 고정한 값**인가.
   *   null이면 옛 흐름(트리거는 템플릿 기본값이 정한다) 그대로다. 화면은 이 값이 있을 때만
   *   저장 요청에 트리거를 실어 보낸다 — 그래야 추천이 약속한 여정이 실제로 만들어진다.
   */
  presetTriggerEvent: string | null;
  /**
   * ★ 2026-08-08 혜택 입력 — 이 패키지 생성에 실제로 쓰인 혜택(정규화 후). null = 미입력.
   *   재생성이 이 값을 다시 실어야 다시 만들기 한 번에 혜택이 placeholder로 되돌아가지 않는다
   *   (프리셋 유실과 같은 뿌리 — 패키지를 다시 만드는 자리가 축을 떨어뜨린다).
   */
  benefitText: string | null;
}

/**
 * ★ 2026-08-02 §13-3 — AI가 문안을 쓰려면 알아야 하는 여정 맥락.
 *
 * 지금까지 AI가 받은 것은 현재 본문·채널·광고 여부·의도 넷뿐이었다. **앞 스텝을 모른다.**
 * 그래서 "앞 스텝과 겹치지 않게"가 원리적으로 불가능했고, 빈 스텝에서는 아예 부를 수도 없었다.
 * 화면을 스텝별로 전환하면(설계서 §6-3) 앞 스텝이 확정된 채로 뒤에 있으므로 넘길 맥락이 그대로 갖춰진다 —
 * 프롬프트에 컨텍스트를 더 밀어 넣는 방식은 땜질이라는 것이 §6-4 설계 메모의 결론이다.
 */
export interface JourneyStepAiContext {
  /** 무엇으로 시작하는 여정인가 — 저장값이 아니라 사람 말로(예: "첫 구매"). */
  triggerLabel?: string;
  /** 이 여정의 목적 — 진입 자연어 또는 추천 모달이 만든 문장. */
  objective?: string;
  /** 지금이 몇 번째 스텝인가(1부터). */
  stepOrder?: number;
  /** 트리거 발생 시점으로부터 몇 시간 뒤인가(누적). */
  hoursFromTrigger?: number;
  /** 앞 스텝들의 확정 문안 전부 — 겹침을 피하려면 이것이 있어야 한다. */
  previousMessages?: Array<{ stepOrder: number; hoursFromTrigger: number; message: string }>;
}

export interface StepRefineInput {
  companyId: string;
  /** 비어 있으면 **생성 모드** — 여정 맥락(journey)으로 처음부터 쓴다(§13-3). */
  currentMessage: string;
  channel: 'sms' | 'lms' | 'mms';
  isAd: boolean;
  stepIntent?: string;
  journey?: JourneyStepAiContext;
}

export interface StepRefineCandidate {
  message: string;
  tone: '감성적' | '실용적' | '캐주얼';
  bytes: number;
  reasoning: string;
}

export interface StepSpamRegenInput {
  companyId: string;
  currentMessage: string;
  channel: 'sms' | 'lms' | 'mms';
  isAd: boolean;
  matchedStopWords: string[];  // 스팸 판정에 걸린 단어 — 이 표현을 피해 재작성
}

// ★ 2026-07-05 (Harold 확정): 여정은 상시 자동 발송이라 생성 시점 계절이 문안에 박제되면
//   이후 달에 어긋난 문자가 나간다(7월 생성 → 8월에도 "장마" 발송). 여정 생성·재생성·날짜축
//   전 경로에서 시즌 컨텍스트 주입을 제거하고 시간 불문(evergreen) 감성으로 통일.
//   (캠페인·자동마케팅·DM·인앱은 즉시 발송이라 season-context CT 주입 유지 — 여정만 제외.)

// ════════════════════════════════════════════════════════════════════
// 회사 컨텍스트
// ════════════════════════════════════════════════════════════════════

interface CompanyContext {
  companyName: string;
  brandName: string | null;
  brandTone: string | null;
  businessType: string | null;
  rejectNumber: string | null;
}

async function loadCompanyContext(companyId: string): Promise<CompanyContext> {
  const r = await query(
    `SELECT company_name, brand_name, brand_tone, business_type,
            COALESCE(reject_number, opt_out_080_number) AS reject_number
     FROM companies WHERE id = $1::uuid`,
    [companyId]
  );
  const row = r.rows[0] || {};
  return {
    companyName: row.company_name || '',
    brandName: row.brand_name || null,
    brandTone: row.brand_tone || null,
    businessType: row.business_type || null,
    rejectNumber: row.reject_number || null,
  };
}

function getBytes(s: string): number {
  let b = 0;
  for (let i = 0; i < s.length; i++) b += s.charCodeAt(i) > 127 ? 2 : 1;
  return b;
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

// ════════════════════════════════════════════════════════════════════
// 핵심: 자연어 한 줄 → 완전 여정 패키지
// ════════════════════════════════════════════════════════════════════

export async function generateJourneyPackage(input: JourneyAIGenerateInput): Promise<JourneyAIPackage> {
  // ★ 2026-08-08 이어달리기 — 프리셋은 등록·구현된 트리거만 인정한다. 모르는 값이면 만들지 않는다(fail-closed).
  //   라우트가 앞에서 400으로 거르지만, 발송 대상을 정하는 축이라 생성기도 그냥 넘기지 않는다.
  const presetTrigger = input.preferTriggerEvent ? String(input.preferTriggerEvent) : null;
  if (presetTrigger && !isImplementedTriggerEvent(presetTrigger)) {
    throw new Error('지원하지 않는 발송 조건입니다. 트리거를 다시 선택해 주세요.');
  }
  // 프리셋만 온 경로(다음 수 카드 = 클릭 한 번)는 목표 골격을 추천 문구에서 파생한다 —
  // 화면이 자기 문장을 지어내면 같은 추천이 경로마다 다른 여정을 만든다.
  const objectiveText = (input.objective || '').trim() || (presetTrigger ? successionObjectiveFor(presetTrigger) || '' : '');
  if (!objectiveText && !input.templateHint) {
    throw new Error('objective (자연어) 또는 templateHint (7 표준 단축) 중 하나는 필수입니다.');
  }
  // ★ 2026-08-08 혜택 입력 — 사용자가 준 혜택 하나. 상한은 화면 입력 한 줄 분량이다.
  const benefitText = String(input.benefitText || '').trim().slice(0, 200);
  // 차단기의 허용 근거 — **전용 입력이 있으면 그것 하나다**(Codex 1R). 목표문까지 합치면
  // 목표에 "20% 쿠폰 행사"라 쓰고 혜택 칸에 "10% 쿠폰"을 쓴 모순 입력에서 20%도 살아남아
  // 프롬프트의 "이것 하나뿐"이 경계가 아니게 된다. 전용 입력이 비었을 때만 목표문이 하위호환 근거다.
  const benefitBasis = benefitText || objectiveText;

  const ctx = await loadCompanyContext(input.companyId);
  const memoryContext = await buildMemoryPromptContext(input.companyId, 30).catch(() => '');
  // ★ D210+ Phase 2 (Harold 명시 2026-05-23): 회사 customer DB 실측 프로필 (CT-58).
  //   AI 시스템 프롬프트 안 안전/분기/차단 3단계 분류 동적 주입.
  const dataProfile = await getCompanyDataProfile(input.companyId).catch(() => null);
  const dataProfilePrompt = dataProfile ? formatProfileForAiPrompt(dataProfile) : '';

  let system = `당신은 한국 마케팅 자동화 여정 설계 전문가입니다.
회사 admin이 입력한 자연어 목표 또는 표준 템플릿 진입을 받아 완전한 여정 패키지를 JSON으로 응답합니다.

[회사 컨텍스트]
- 회사명: ${ctx.companyName}
- 브랜드명: ${ctx.brandName || '(미설정)'}
- 톤앤매너: ${ctx.brandTone || '친근함'}
- 업종: ${ctx.businessType || '(미설정)'}

[★ ★ ★ 상시 발송 원칙 — 계절 언급 절대 금지 (Harold 확정 2026-07-05) ★ ★ ★]
이 여정은 한 번 만들면 연중 내내 자동 발송됩니다 (신규 가입·구매·휴면 등 트리거가 발생할 때마다).
지금 만든 문안이 8월에도, 12월에도 그대로 나갑니다.
✗ 계절·월·날씨·명절·시기 언급 절대 금지: "장마", "여름", "벚꽃", "봄", "크리스마스", "7월", "요즘 날씨", "환절기", "연말" 등 전부 금지
✗ "이 계절", "계절이 바뀌는 요즘" 같은 우회 표현도 금지
✓ 대신 시간 불문 감성으로 풍성하게: 첫 인연의 설렘 / 진심 어린 감사 / 일상 공감 / 기다림과 반가움 / 브랜드 따뜻함
   (단, 사용자 목표문에 계절·명절·특정 시기가 명시된 경우에만 그 시기를 반영)

${getKoreanCalendar()}
⚠️ 날짜에 요일을 표기할 때(예: "7월 30일(목)") 반드시 위 달력의 요일을 그대로 사용하세요. 직접 요일을 계산하지 마세요. 위 달력에 없는 월의 날짜는 요일을 괄호로 표기하지 마세요 (날짜만 표기).

${memoryContext}

[설계 원칙]
1. 표준 트리거 매트릭스 (자연어 목표에서 자동 매칭):
   - customer.created (24h 안 신규 가입) — 환영/온보딩 시리즈
   - cdp.purchase (구매 직후 5분) — 후기/재구매 유도
   - customer.dormant (휴면 N일+) — 회수 시리즈
   - cdp.cart_abandon (장바구니 24h+ 결제 X) — 회복 시리즈
   - customer.birthday_approaching (D-N) — 생일 축하
   - cdp.reservation_created — 예약 follow-up
   - custom (위 외 자유 — 정기 발송 / 신상품 알림 / VIP 감사 등)

1-2. ★ 타겟 세그먼트 추출 (매우 중요 — 절대 누락 금지)
   사용자가 "어떤 고객에게" 보낼지 조건을 말하면(예: "매장명이 송파가락점인 회원", "VIP 등급만", "서울 지역", "3회 이상 구매") 반드시 triggerFilters.customer_conditions 배열로 담는다.
   - 형식: { "field": "허용필드", "op": "==|!=|>=|<=|>|<|in|not_in", "value": 값 }
   - 허용 field (이 목록 외 절대 사용 금지): store_name(매장명), store_code(매장코드), grade(등급), region(지역), age(나이), purchase_count(구매횟수), total_purchase_amount(총구매액), sms_opt_in(수신동의)
   - 여러 조건이면 logic을 "AND" 또는 "OR"로 명시.
   - 예: "매장명이 송파가락점인 회원에게" -> "customer_conditions": [{ "field": "store_name", "op": "==", "value": "송파가락점" }], "logic": "AND"
   ✗ 사용자가 세그먼트를 말했는데 customer_conditions를 비우면 전체 고객에게 발송되는 중대한 사고다 — 명시된 조건은 반드시 담는다.
   ✓ 세그먼트 조건이 없으면(전체 대상) customer_conditions는 빈 배열로 둔다.

2. step 개수: 기본 2~5개 (목표 + 시계열에 맞춰 자동 결정).
   ★ 단발성 발송 의무 룰: 사용자가 한 번만 보내려는 의도를 명시하면(예: "한번만", "1회만", "한 번", "딱 한 번", "한 차례") 반드시 step 1개만 생성한다. 시계열 시리즈로 늘리지 말 것 — 사용자가 지정한 발송 횟수를 절대 무시하지 않는다.
   ★ 단발성·단순 일률 발송의 본문은 Liquid 문법({{ }} / {% %})을 쓰지 말고 %고객명% 같은 단순 변수만 사용한다 (마케팅 담당자가 직접 편집하기 쉽도록). 등급별/조건 분기 등 고급 1:1 개인화를 명시한 경우에만 Liquid를 사용한다.
3. delay_hours: 0(즉시) / 24(1일) / 72(3일) / 168(7일) / 336(14일) / 720(30일) 자연 단위
4. channel: 'lms' default (광고 표기 + 무료거부 자동 합성 시 90바이트 SMS 한계 초과)
5. isAd: 마케팅성은 true default (정보 안내성만 false)
6. subject (제목): LMS/MMS 채널 시 필수 — 한 줄 20자 안 / 본문 핵심을 단순 요약 / 호기심 유발 / 따뜻한 감성 (계절 단어 금지)
   ★ Harold 명시 영구 룰: 제목은 변수(%고객명% / %이름% 등) + Liquid 문법({{ }} / {% %}) 절대 사용 금지. 모든 수신자에게 동일 단순 텍스트만 사용 (가독성 + 통신사 표시 영역 좁음 + 개인화는 본문에서).
   좋은 예시: "곧 다가올 생일을 미리 축하해요" / "VIP만 받는 첫 안내" / "오랜만에 안부 전해요" / "함께하게 되어 반가워요" / "감사한 마음을 전해요"
   나쁜 예시: "%고객명%님, 곧 생일이에요" (변수 X) / "{{ customer.name | default: '고객' }}님 안내" (Liquid X)
   SMS 채널은 빈 문자열 ""로 응답 (제목 없음).
7. allow_reentry / reentry_cooldown_days: 시리즈에 맞춰 자동 결정
   - 가입 온보딩: false / null
   - 재구매: true / 0
   - 휴면: true / 90
   - 장바구니: true / 7
   - 생일: true / 365
   - 예약: true / 0
   - 정기 발송: true / 0 또는 30

[메시지 작성 원칙 — 매우 중요]
★ Harold 명시 영구 룰 — 본문은 보다 풍성하게 작성 의무 (단순 1~2 줄 안내 X)

★ ★ ★ 브랜드 격조 영구 룰 (Harold 명시 D191-fix2) ★ ★ ★
✗ 저렴한 단어 / 친근감 과한 단어 사용 절대 금지:
   - "단골" / "단골 고객님" / "단골 손님" — 격조 X 본질, 브랜드 가치 손상 (저렴 인상)
   - "사장님이 직접" / "초특가" / "역대급" — 광고 톤 X
✓ 대체 표현 매트릭스 (격조 + 정중 + 감사 본질):
   - "단골" → "오랜 시간 함께해주신" / "꾸준한 관심을 보내주신" / "변함없이 찾아주시는" / "한결같은 신뢰를 보내주신"
   - "단골 고객님" → "오래 함께해주신 고객님" / "소중한 고객님" / "꾸준히 사랑해주시는 고객님"
✓ 브랜드 톤 본질: 격조 / 정중함 / 진심 어린 감사 / 절제된 감성 — 친근한 대화체 X, 정중한 안부 O
✓ 안내문 / 인사 / 감성 텍스트 / 회사 톤 = 매우 풍성하게 직접 작성 (마케팅 가치 본질 — 계절 단어 없이)
   - 단순 "안녕하세요 고객님" 수준 X = 5단 매트릭스 자연 전개 의무 (★ D210+ Phase 2-fix6 Harold 명시 강화):
     1) 공감 도입 (1~2 문장) = 안부 + %고객명%님 자연 호명 (메신저 보내듯 친밀한 톤)
     2) 감성 디테일 (2~3 문장) = 시간 불문 감성 묘사 + 사용자 일상 공감 ("첫 인연을 맺어주신 반가움", "늘 곁에 두고 싶은 브랜드가 되고 싶은 마음" 등 구체 묘사 — 계절·날씨·월 언급 금지)
     3) 가치 제안 (2~3 문장) = [혜택 안내 — 직접 수정해주세요] placeholder + 왜 이 안내가 특별한지 스토리 (기존 고객 / VIP / 오랜 관심 등 맥락)
     4) CTA 안내 (1~2 문장) = 구체 행동 유도 + URL 또는 매장 방문 자연 안내 ("아래 링크에서 확인하세요" / "%최근구매매장%에서 바로 사용 가능해요")
     5) 안부 마무리 (1~2 문장) = 진심 어린 감사 + 기대감 + 브랜드 따뜻함 ("늘 함께해주셔서 감사해요", "오랜만의 인사가 반가우셨길")
   - 한국 마케팅 정합 분량 = LMS 500~700바이트 (광고 합성 후 580~780바이트) — 단순 단답 X 풍성 본문 의무
   - 줄바꿈 / 단락 활용으로 가독성 정합 (4~6 단락 권장)
   - ★ 스토리텔링 매트릭스 = 단체 마케팅 안내 X = 1:1 대화감 본질 = "이 브랜드가 %고객명%님한테 직접 보낸 느낌"
   - ★ 변수 활용 의무 = 안전 변수 (회사 실측 매트릭스) 1~3개 자연 활용 — "%고객명%님" / "%등급% 회원님" / "%최근구매매장%" 등
✗ 구체 혜택 (% / 원 / 무료 / 쿠폰 / 사은품 / 적립 / 할인 / 무료배송) = 절대 임의 작성 금지
  대신 \`[혜택 안내 — 직접 수정해주세요]\` placeholder만 정확히 사용
✓ URL = http(s):// 실제 URL 직접 작성 가능 (D190 #1 강화) — 발송 시점 자동 단축 URL 변환 (hanjul.ai/c/xxxxxxxx, 30자) + 클릭 트래킹 + Bandit 학습 자동 활성. 회사 자사몰 URL이 정합되지 않은 영역은 \`[URL — 회사 admin 수정]\` placeholder 사용
✗ (광고) 표기 직접 작성 X (시스템 자동 합성)
✗ 무료수신거부 080 직접 작성 X (시스템 자동 합성)
✓ %고객명% 변수 사용 권장 (본문 영역만 — 제목 영역은 변수 X)
✓ LMS 300~500바이트 권장 (광고 합성 후 380~580바이트)

[★ ★ ★ 보존 영역 vs 자유 영역 분리 (D209+ Harold 명시 강화 — 옛 ai.ts 정합 통합) ★ ★ ★]
✓ 보존 영역 (절대 변경 X — 회사 admin이 직접 작성할 영역):
   - 구체 혜택 (% / 원 / 무료 / 쿠폰 / 사은품 / 적립 / 무료배송) → [혜택 안내 — 직접 수정해주세요] placeholder
   - 상품명 / 매장명 / 일시 / 숫자 / 연락처 / 주소 / URL → [URL 입력] placeholder 또는 실제 URL 작성
   - 변수 {{ customer.X }} / %고객명% → 자리 그대로 보존
✓ 자유 영역 (적극 활용 — 카피라이터 감각으로):
   - 수식어 / 감성 표현 ("기다리시던" / "소중한" / "정성스럽게" / "오랜 시간 함께해주신")
   - 감성 묘사 (시간 불문 — 인연·감사·설렘·일상 공감의 자연스러운 1~2 줄 묘사, 계절 단어 금지)
   - 1:1 대화감 (단체 안내 X, 브랜드가 나한테 직접 보낸 느낌)
   - 문장 리듬 (짧은 문장 + 긴 문장 교차)
   - 호기심 갭 (정보 일부 열고 나머지 궁금증 유발 — 사용자가 URL 클릭하고 싶은 느낌)

[★ ★ ★ 뻔한 표현 금지 (D209+ Harold 명시 강화 — 옛 ai.ts 정합 통합) ★ ★ ★]
✗ "안녕하세요 고객님" — 금지 (감성 도입 / 질문 / 숫자로 시작 — 단 계절 단어는 금지)
✗ "특별한 혜택 / 소식 / 선물" — 금지 (구체 혜택 placeholder 사용)
✗ "준비했어요 / 준비했습니다" — 금지 ("지금 ~할 수 있어요" 또는 감성 도입부로)
✗ "소중한 고객님" — 금지 (%고객명% 또는 {{ customer.name | default: '고객' }} 직접 활용)
✗ "다양한 혜택" — 금지 (핵심 1가지 구체 placeholder)
✗ "많은 관심 부탁드립니다" — 금지 (구체 CTA로)
✗ 느낌표 폭탄 (!!!) — 전체에서 최대 2~3개
✗ 과장 형용사 ("초특가" / "역대급" / "미친" / "대박") — 금지

[★ Liquid 동적 콘텐츠 — D191 강화 (사용자별 1:1 개인화)]
회사 admin이 고급 1:1 동적 콘텐츠를 원할 때 Liquid 문법 활용 권장. 발송 시점 사용자별 자동 분기 + 변수 계산:
✓ 변수 출력: {{ customer.name | default: '고객' }} / {{ customer.grade }} / {{ customer.points }}
✓ 기본값 fallback: {{ customer.name | default: '고객' }} (값 없으면 '고객'으로 자동 대체)
✓ ★★ 필수 규칙: 모든 {{ customer.X }} 출력 변수에는 반드시 | default 를 붙인다. default 없는 {{ customer.X }}는 값 없는 고객에게 그 자리가 비어 발송되므로 절대 금지. 예: {{ customer.name | default: '고객' }} / {{ customer.grade | default: '' }} / {{ customer.region | default: '' }} (format_number 등 다른 필터가 이미 있으면 그대로 둔다)
✓ 숫자 포맷: {{ customer.points | format_number }} → 2,300 (한국 천 단위 콤마 자동)
✓ 조건 분기: {% if customer.grade == 'VIP' %} VIP 안내 {% elsif customer.purchase_count > 10 %} 오래 함께한 고객 안내 {% else %} 일반 안내 {% endif %}
✓ 계산: {{ customer.points | minus: 1000 }} (포인트 차감) / {{ customer.amount | times: 0.1 | round: 0 }} (10% 환산)
✓ 등급별 인사 / 지역별 매장 안내 / 직전 구매 회상 = 1개 메시지로 N가지 분기 자동 처리

[Liquid 활용 가이드 — AI 작성 시 의무]
- 회사 admin이 "등급별 분기 / 지역별 / 직전 구매 회상" 영역 명시 시 Liquid 적극 활용
- Liquid 분기 안의 구체 혜택 텍스트도 동일 룰: % / 원 / 무료 등 임의 작성 X → \`[혜택 안내 — 직접 수정해주세요]\` placeholder
- 단순 일률 발송 영역은 Liquid 미사용 (기존 %고객명% 변수만 사용 권장)
- ★ D210+ Phase 2 — 모르는 필드(customer.X) 사용 절대 금지. 아래 [회사 실측 데이터 활용 매트릭스]의 안전/분기 변수만 사용 의무.

${dataProfilePrompt}

[★ ★ ★ 날씨 Liquid 변수 — D209+ 신규 (Connected Content 통합) ★ ★ ★]
✗ 날씨 단순 단어 직접 작성 절대 금지 ("맑음" / "비" / "눈" / "흐림" / "쌀쌀해요" / "더워요" / "화창" / "쌀쌀") — 발송 시점 실시간 날씨와 불일치 사고 위험 (예: "오늘 날씨 화창해요" 작성한 메시지가 폭우 영역에 발송 = 신뢰 파괴)
✓ 발송 시점 실시간 자동 분기는 Liquid 변수 의무:
   - {{ weather.summary }} — 고객 region 기준 현재 날씨 한 줄 ("맑음 18°C" 등)
   - {{ weather.store.summary }} — 매장 region 기준 (매장 단독 행사 영역 의무 — 예: "강남점 봄 행사")
   - {{ weather.temp }} / {{ weather.condition }} — 온도 / 상태 (분기 조건용)
✓ 분기 예시 — 폭우 / 폭염 / 눈 영역 안내:
   {% if weather.condition == 'Rain' %}
   비 오는 오늘, 매장 방문이 어려우신 분들을 위해
   {% elsif weather.temp > 30 %}
   더위 속에도 발걸음 해주시는 분들께
   {% else %}
   오늘 날씨와 함께
   {% endif %}
✓ 매장 단독 행사 영역 (회사 admin이 "강남점 봄 행사" / "부산점 가을 세일" 명시 시) = {{ weather.store.summary }} 의무

[★ ★ ★ AI 자율 예측 점수 활용 가이드 — D197 신규 (Predictive Suite 통합) ★ ★ ★]
발송 시점에 customer 객체에 자동 첨부되는 3 예측 점수 (0~1 매트릭스):
✓ {{ customer.click_score }} — 다음 메시지 클릭 가능성
✓ {{ customer.churn_risk }} — 이탈 위험 (높을수록 회복 캠페인 의무)
✓ {{ customer.purchase_likelihood }} — 구매 가능성 (높을수록 구매 유도)

[AI 자율 분기 작성 가이드 — 회사 admin이 "이탈 고객 회복" / "구매 유도" / "AI가 알아서 분기" 영역 명시 시 적극 활용]

예시 1 — 이탈 위험 분기:
{{ customer.name | default: '고객' }}님,
{% if customer.churn_risk > 0.7 %}
오랜만에 인사드려요. 다시 뵙고 싶은 마음에 [회복 안내 — 직접 작성해주세요] 준비했어요.
{% elsif customer.purchase_likelihood > 0.6 %}
{{ customer.name | default: '고객' }}님께 어울리는 새 상품 [추천 안내 — 직접 작성해주세요]
{% else %}
새로운 소식 전해드려요.
{% endif %}

예시 2 — 클릭 가능성 + 등급 통합:
{{ customer.name | default: '고객' }}님,
{% if customer.click_score > 0.4 and customer.grade == 'VIP' %}
VIP 회원님께 가장 먼저 안내드리는 소식.
{% elsif customer.churn_risk > 0.6 %}
오랜만에 안부 전해드려요.
{% else %}
새 소식 안내.
{% endif %}

[Predictive 점수 분기 본질 룰]
✓ 점수는 발송 시점 자동 계산 (cache 24h TTL)
✓ 신규 회사 영역도 cold start fallback 정합 — 등급별 평균 점수 사용
✓ 데이터 누적 시 모델 자동 정확도 향상 — 시간 지날수록 정확도↑
✗ 점수 자체를 메시지에 직접 노출 금지 (예: "당신의 이탈 위험은 87%입니다" X)
✗ Liquid 분기 안 구체 혜택 임의 작성 X — placeholder 유지 의무

[★ 문자 사용 절대 룰 — 한국 통신사 SMS/LMS 표준]
✗ 이모지 절대 사용 금지 — 🎂 🎉 💝 🌸 🎁 ✨ 💌 🌷 🍀 ❤ 등 모든 이모지 통신사 미지원 (발송 실패 / 깨짐 위험)
✗ 비표준 특수문자 사용 금지:
  - 대시: — – ‐ (대신 - 사용)
  - 화살표: ▶ ▷ ➤ ➜ (대신 > 사용 or "자세히 →" 단어 형태)
  - 표시: ★ ☆ ✓ ✗ ◆ ※ ‣ • (대신 * V X · 사용 or 단어로 풀어쓰기)
  - 따옴표: " " ' ' 『 』 (대신 표준 " ' 사용)
  - 전각 기호: ＆ ％ ＋ ？ ！ (대신 표준 & % + ? ! 사용)
✓ 허용 단어: 한글 / 영문 / 숫자 / 표준 기호 ( . , ! ? : ; ( ) [ ] " ' + - * / = @ # $ % & | < > → ) / 줄바꿈
✓ SMS 호환 특수문자 화이트리스트 (D209+ 강화 — EUC-KR 통신사 검증 정합): ★ ☆ ♥ ♡ ◆ ◇ ■ □ ▲ △ ▶ ◀ ● ○ ◎ ♨ ※ ☞ ☎ ① ② ③ ④ ⑤ ↑ ↓ ← → ㈜ ㎝ ㎏ ㎡
✓ "→" 단어는 자세히 안내 화살표로 허용

[좋은 메시지 예시 — 생일 D-7 사전 안내 (풍성 본문 + 단순 제목 · 계절 언급 없음)]
제목: "곧 다가올 생일을 미리 축하해요"

본문:
%고객명%님, 안녕하세요.

달력을 넘기다 곧 다가올 %고객명%님의 생일을 미리 떠올려봤어요.

한 해 한 살 더 나이를 먹는다는 건
그만큼 더 많은 추억과 이야기가 쌓인다는 의미이기도 해요.
일 년 중 단 하루, %고객명%님이 주인공인 날이니까요.

%고객명%님의 이번 생일은
조금 더 특별하게 기억되길 바라는 마음으로 작은 선물을 준비했어요.

[혜택 안내 — 직접 수정해주세요]

미리 축하드려요. 생일 당일까지 설레는 하루하루 되시길.

자세히 → [URL 입력]

[좋은 메시지 예시 — 등급별 1:1 분기 (Liquid 활용 + 풍성 본문 + 단순 제목)]
제목: "오랜만에 안부 전해요"

본문:
{{ customer.name | default: '고객' }}님, 안녕하세요.

{% if customer.grade == 'VIP' %}
저희 매장의 VIP 회원님이신 {{ customer.name | default: '고객' }}님께
가장 먼저 전하고 싶은 소식이 있어 인사드려요.

오랜 시간 변함없이 찾아주시는 발걸음 하나하나가
저희에게는 가장 큰 힘이 되고 있어요.

VIP 회원님만을 위해 마련한 이번 특별 안내,
가장 먼저 받아보실 수 있도록 정성껏 준비했답니다.
{% elsif customer.purchase_count > 10 %}
{{ customer.name | default: '고객' }}님과 함께한 {{ customer.purchase_count }}번의 만남,
어느덧 오랜 시간 함께해주신 소중한 고객님이 되어주셨네요.

매번 변함없는 신뢰로 찾아주셔서 진심으로 감사드려요.
{{ customer.name | default: '고객' }}님 같은 고객님이 계셔서
저희가 더 좋은 제품과 서비스를 고민할 수 있어요.

오래 함께해주신 분들께만 전해드리는 특별한 인사 준비했어요.
{% else %}
새로운 소식 전해드리고 싶어
{{ customer.name | default: '고객' }}님께 인사드려요.

바쁜 하루하루 속에서도 잠시 미소 지을 수 있는 순간이 되길 바라며,
저희가 준비한 새로운 이야기로
%고객명%님의 일상에 작은 즐거움을 더해드릴게요.
{% endif %}

[혜택 안내 — 직접 수정해주세요]

자세히 → [URL 입력]

[좋은 메시지 예시 — 신규 가입 환영 (D209+ 신규 Onboarding LMS — 풍성 본문 + 단순 제목)]
제목: "함께하게 되어 진심으로 반가워요"

본문:
{{ customer.name | default: '고객' }}님, 안녕하세요.

오늘 저희 매장의 새 가족이 되어주셔서
진심으로 감사한 마음을 먼저 전해요.

첫 인연을 맺게 된 {{ customer.name | default: '고객' }}님께
저희가 가장 정성껏 준비한 첫 인사를 드리고 싶었어요.

처음 만나는 분께만 드리는 작은 선물 한 가지,
오래 함께해주실 분들을 위해 정성껏 준비했답니다.

[혜택 안내 — 직접 수정해주세요]

자세히 → [URL 입력]

[좋은 메시지 예시 — 휴면 고객 회복 (D209+ 신규 Dormant LMS — Predictive churn_risk 활용)]
제목: "오랜만에 안부 전해드려요"

본문:
{{ customer.name | default: '고객' }}님, 안녕하세요.

{% if customer.churn_risk > 0.7 %}
오랜 시간 발걸음이 뜸하셨네요.
혹시 그동안 불편하셨던 영역이 있었다면 부족함을 먼저 사과드리고 싶어요.

다시 한 번 좋은 인연으로 이어가고 싶은 마음으로
오랜 시간 함께해주신 분들께만 전해드리는 회복 안내 준비했답니다.

[혜택 안내 — 직접 수정해주세요]
{% else %}
문득 {{ customer.name | default: '고객' }}님 생각이 나 잘 지내고 계신지 안부 전해드려요.

오랜만에 전하는 소식과 함께 {{ customer.name | default: '고객' }}님께
어울리는 작은 안내 드리고 싶었어요.

[혜택 안내 — 직접 수정해주세요]
{% endif %}

자세히 → [URL 입력]

[budget / threshold]
- budgetMonthlyHint: NULL = 무제한 default (회사 자유)
- thresholdCostHint: NULL = 무제한 default (회사 자유)

[출력 JSON 형식 — 다른 텍스트 없이 JSON만]
{
  "name": "여정 이름 (한국어, 30자 안)",
  "templateCode": "onboarding|repeat|dormant|cart|birthday|reservation|custom",
  "triggerEvent": "customer.created 등",
  "triggerFilters": { "recent_hours": 24, "customer_conditions": [], "logic": "AND" },
  "steps": [
    {
      "stepOrder": 1,
      "stepType": "message",
      "delayHours": 0,
      "channel": "lms",
      "subject": "한 줄 20자 안 제목 (LMS/MMS만)",
      "messageTemplate": "...풍성 본문... [혜택 안내 — 직접 수정해주세요] ... → [URL 입력]",
      "isAd": true,
      "stepIntent": "환영 인사 + 첫 구매 안내"
    }
  ],
  "allowReentry": false,
  "reentryCooldownDays": null,
  "budgetMonthlyHint": null,
  "thresholdCostHint": null,
  "reasoning": "AI가 결정한 흐름의 한 줄 근거 (회사 admin 검토용)"
}`;

  // ★ 2026-08-08 (Codex 1R·2R) — 예외는 규칙이 사는 곳에 적고, **프롬프트의 허용 범위는 차단기 근거와 같아야 한다.**
  //   strip은 지우기만 할 수 있다 — AI가 더 엄격한 프롬프트를 따라 placeholder를 내면 승인된 혜택을 복원할 길이 없다.
  //   그래서 분기마다 basis와 같은 집합을 프롬프트에 선언한다: 전용 입력이 있으면 그것 하나 / 없으면 목표문의 혜택.
  if (benefitText) {
    system += `

[★ 예외 — 회사가 승인한 혜택 (위 placeholder 규칙보다 우선)]
이번 생성에서는 "${benefitText}" 이 혜택 하나만 구체적으로 쓸 수 있습니다.
[혜택 안내 — 직접 수정해주세요] placeholder를 쓰지 말고 이 혜택을 본문에 자연스럽게 녹이세요.
이 혜택 외의 다른 구체 혜택(%·원·쿠폰·무료 등)은 여전히 절대 금지입니다.`;
  } else {
    system += `

[혜택 규칙의 근거 — 위 placeholder 규칙과 함께 적용]
사용자가 목표문에 직접 적은 구체 혜택은 창작이 아닙니다 — placeholder로 바꾸지 말고 그대로 사용하세요.
사용자가 주지 않은 혜택만 placeholder 대상입니다.`;
  }

  let userMessage: string;
  if (objectiveText.length >= 3) {
    userMessage = `여정 목표: ${objectiveText}\n\n위 회사 컨텍스트 + 메모리를 종합하여 완전한 여정 패키지 JSON을 응답하세요. 계절·월·날씨 언급 없이 시간 불문 감성으로 풍성하게 작성하고, 혜택 영역은 placeholder로 처리하세요.`;
  } else {
    userMessage = `7 표준 시리즈 단축 진입: ${input.templateHint}\n\n위 회사 컨텍스트 + 메모리에 맞춰 ${input.templateHint} 시리즈의 표준 흐름을 계절 언급 없이 풍성하게 작성한 JSON 응답하세요.`;
  }

  // ★ 2026-08-08 이어달리기 — 시작 신호가 정해진 생성. AI는 그 전제 위에서 스텝·문안만 설계한다.
  //   (트리거 값 자체는 아래에서 계약값으로 덮어쓴다 — 이 지시는 문안이 신호와 맞게 하려는 것뿐이다)
  if (presetTrigger) {
    userMessage += `\n\n[시작 신호 고정] 이 여정은 "${describeJourneyTrigger(presetTrigger, {})}"에게 나갑니다. 스텝 수·발송 간격·문안을 그 상황에 맞춰 설계하세요.`;
  }

  // ★ 2026-08-08 혜택 입력 — placeholder 대신 사용자가 준 혜택을 처음부터 녹인다.
  //   이 지시는 문장을 자연스럽게 하려는 것이고, 경계는 아래 stripUnauthorizedBenefits가 잡는다
  //   (이 혜택 밖의 %·원·쿠폰·무료는 근거가 없어 여전히 placeholder로 되돌아간다).
  if (benefitText) {
    userMessage += `\n\n[사용 가능한 혜택 — 이것 하나뿐] "${benefitText}"\n[혜택 안내 — 직접 수정해주세요] placeholder를 쓰지 말고 이 혜택을 본문에 자연스럽게 녹이세요. 이 혜택 외의 다른 구체 혜택은 절대 쓰지 마세요.`;
  }

  // ★ D225+ Brand Voice Learning — 회사별 가이드라인 자동 주입 (회사 등록 미존재 시 옛 흐름 그대로)
  system = await buildSystemPromptWithBrandVoice(input.companyId, system);

  // ★ D209+ (Harold 명시 2026-05-22): Sonnet 4.6 전환 — 기존 ai.ts generateMessages 시스템 프롬프트
  //   매트릭스(D152 + D80 정합) 정합 본질 + 비용 80% 절감.
  //   Phase D 통합: companyId + source 전달 → 회사별 월 한도 + cache + 통계 자동 활성.
  const text = await callAIWithFallback({
    system,
    userMessage,
    maxTokens: 4096,
    temperature: 0.4,
    model: 'opus',
    companyId: input.companyId,
    source: 'journey-ai-generate',
  });

  let parsed: any;
  try {
    parsed = JSON.parse(extractJSON(text));
  } catch (err: any) {
    console.error('[journey-ai-generator] JSON parse 실패. raw:', text.slice(0, 500));
    throw new Error('AI 응답 JSON 파싱 실패. 다시 시도해주세요.');
  }

  const rawSteps: any[] = Array.isArray(parsed.steps) ? parsed.steps : [];
  const steps: GeneratedStep[] = rawSteps.slice(0, 5).map((s: any, idx: number) => {
    const channel = ['sms', 'lms', 'mms'].includes(s.channel) ? s.channel : 'lms';
    // ★ D187-fix5: AI 응답에 이모지/비표준 특수문자 포함 가능성 — sanitize 자동 적용
    const rawMessage = String(s.messageTemplate || '').slice(0, 2000);
    const rawSubject = channel === 'sms' ? '' : String(s.subject || '').slice(0, 50);
    const messageSan = sanitizeForSms(rawMessage);
    const subjectSan = sanitizeForSms(rawSubject);
    if (messageSan.hadChanges) {
      console.log(`[journey-ai-generator] step ${idx + 1} message sanitize:`, messageSan.warnings.join(' / '));
    }
    if (subjectSan.hadChanges) {
      console.log(`[journey-ai-generator] step ${idx + 1} subject sanitize:`, subjectSan.warnings.join(' / '));
    }
    return {
      stepOrder: Number(s.stepOrder) || idx + 1,
      stepType: 'message' as const,
      delayHours: Math.max(0, Math.min(720, Number(s.delayHours) || 0)),
      channel,
      // ★ 본문/제목은 순수 상태로 저장 — (광고)/무료수신거부는 발송·미리보기 시 buildAdMessage가 합성.
      //   AI가 본문에 (광고)를 넣어도 여기서 제거해야 이중부착(미리보기·발송)이 안 남.
      // ★ 2026-08-08 — 지어낸 혜택은 기계로 되돌린다. 프롬프트는 경계가 아니다(0802 다듬기와 같은 규약인데
      //   **생성 경로에는 빠져 있었다**). 근거로 인정하는 것은 사용자가 준 목표 하나뿐 —
      //   프리셋 1클릭 경로는 목표에 혜택이 없으므로 숫자가 나오면 전부 창작이다.
      messageTemplate: stripUnauthorizedBenefits(stripAdParts(messageSan.sanitized), benefitBasis),
      subject: stripUnauthorizedBenefits(stripAdParts(subjectSan.sanitized), benefitBasis),
      isAd: resolveJourneyAdFlag(channel, s.isAd),
      stepIntent: String(s.stepIntent || '').slice(0, 100),
    };
  });

  if (steps.length === 0) {
    throw new Error('AI가 유효한 step을 생성하지 못했습니다. 목표 문구를 더 명확히 작성해주세요.');
  }

  const cbRes = await query(
    `SELECT REPLACE(phone, '-', '') AS phone FROM callback_numbers
     WHERE company_id = $1::uuid AND is_default = true
     LIMIT 1`,
    [input.companyId]
  );
  const callbackHint = cbRes.rows[0]?.phone || null;

  const validTemplates = ['onboarding','repeat','dormant','cart','birthday','reservation','custom'];
  let templateCode = validTemplates.includes(parsed.templateCode) ? parsed.templateCode : 'custom';
  let triggerEvent = String(parsed.triggerEvent || 'custom').slice(0, 50);
  let triggerFilters: Record<string, any> =
    typeof parsed.triggerFilters === 'object' && parsed.triggerFilters !== null ? parsed.triggerFilters : {};

  // ★ 2026-08-08 이어달리기(설계서 §6) — 프리셋이 오면 트리거 축은 **AI 출력과 무관하게** 계약값으로 고정한다.
  //   프롬프트에 "이 트리거로 만들라"고 적는 것은 보장이 아니다. 추천이 휴면 복귀를 권했는데
  //   AI가 재구매 여정을 만들어 놓는 어긋남을 여기서 닫는다.
  //   조건(triggerFilters)은 비운다 — 기본값은 추출기·워커가 소유한다(휴면 복귀 30일 등 카탈로그 값과 같다).
  //   AI가 지어낸 조건을 실으면 추천이 약속한 대상과 달라진다.
  if (presetTrigger) {
    triggerEvent = presetTrigger;
    templateCode = triggerTemplateCode(presetTrigger) || 'custom';
    triggerFilters = {};
  }

  return {
    name: String(parsed.name || '여정').slice(0, 100),
    templateCode,
    triggerEvent,
    triggerFilters,
    presetTriggerEvent: presetTrigger,
    benefitText: benefitText || null,
    steps,
    allowReentry: !!parsed.allowReentry,
    reentryCooldownDays: parsed.reentryCooldownDays != null ? Math.max(0, Math.min(3650, Number(parsed.reentryCooldownDays))) : null,
    callbackNumberHint: callbackHint,
    budgetMonthlyHint: parsed.budgetMonthlyHint != null ? Number(parsed.budgetMonthlyHint) : null,
    thresholdCostHint: parsed.thresholdCostHint != null ? Number(parsed.thresholdCostHint) : null,
    reasoning: String(parsed.reasoning || '').slice(0, 500),
  };
}

// ════════════════════════════════════════════════════════════════════
// step별 AI 다듬기 — 3 후보 다양성 (감성 / 실용 / 캐주얼)
// ════════════════════════════════════════════════════════════════════

/**
 * 여정 맥락을 프롬프트 블록으로 (§13-3). 없는 값은 줄 자체를 넣지 않는다 — 빈 라벨은 AI를 헷갈리게 한다.
 * 발송 시점 문구는 `formatStepTiming` 단일 출처를 그대로 쓴다(화면·브리핑과 같은 말이 나가야 한다).
 */
function buildJourneyContextBlock(jc: JourneyStepAiContext | undefined, hasBody: boolean): string {
  if (!jc) return '';
  const lines: string[] = [];
  if (jc.triggerLabel) lines.push(`- 시작 신호: ${jc.triggerLabel}`);
  if (jc.objective) lines.push(`- 여정 목적: ${String(jc.objective).slice(0, 300)}`);
  if (jc.stepOrder != null) lines.push(`- 지금 쓰는 것: ${jc.stepOrder}번째 스텝`);
  if (jc.hoursFromTrigger != null) {
    lines.push(`- 발송 시점: ${formatStepTiming({ delayMode: 'relative', delayHours: Math.max(0, Number(jc.hoursFromTrigger) || 0), targetHourKst: null }, true)}`);
  }

  const prev = (jc.previousMessages || []).filter((p) => p && String(p.message || '').trim());
  let prevBlock = '';
  if (prev.length > 0) {
    const rows = prev
      .slice(0, 6)
      .map((p) => `  · ${p.stepOrder}번째(${formatStepTiming({ delayMode: 'relative', delayHours: Math.max(0, Number(p.hoursFromTrigger) || 0), targetHourKst: null }, true)}): ${String(p.message).slice(0, 400)}`)
      .join('\n');
    prevBlock = `\n[앞 스텝 문안 — 이미 이 사람에게 나간 말]\n${rows}\n⛔ 위와 인사말·용건·마무리가 겹치면 같은 사람이 같은 말을 두 번 받는다. 이어지는 다음 말을 쓴다.`;
  }

  if (lines.length === 0 && !prevBlock) return '';
  const head = lines.length > 0 ? `\n[여정 맥락]\n${lines.join('\n')}` : '';
  const mode = hasBody
    ? ''
    : '\n[지금 하는 일] 이 스텝은 아직 비어 있다. 위 맥락에 맞는 문안을 처음부터 쓴다.';
  return `${head}${prevBlock}${mode}`;
}

export async function refineStepMessage(input: StepRefineInput): Promise<{ candidates: StepRefineCandidate[] }> {
  // ★ 2026-08-02 §13-3 — 빈 스텝이면 **생성 모드**로 간다.
  //   옛 흐름은 사람이 먼저 열 글자를 써야 AI를 부를 수 있었다(추가 입력 요구 = marketing_user_ux_priority 위반).
  //   ⛔ 다만 맥락 없이 짓지는 않는다 — 여정 맥락도 본문도 없으면 지어낼 근거가 없으므로 빈손으로 돌린다.
  const hasBody = !!input.currentMessage && input.currentMessage.trim().length >= 5;
  const jc = input.journey;
  const hasContext = !!jc && (!!jc.triggerLabel || !!jc.objective || (jc.previousMessages?.length ?? 0) > 0);
  if (!hasBody && !hasContext) {
    return { candidates: [] };
  }

  const ctx = await loadCompanyContext(input.companyId);
  const memoryContext = await buildMemoryPromptContext(input.companyId, 20).catch(() => '');

  const maxBytes = input.channel === 'sms' ? 90 : 2000;

  let system = `당신은 한국 마케팅 메시지 다듬기 전문가입니다.
회사 admin이 작성한 step 메시지를 받아 3가지 톤의 후보로 다듬어 JSON으로 응답합니다.

[회사 컨텍스트]
- 회사명: ${ctx.companyName}
- 브랜드명: ${ctx.brandName || '(미설정)'}
- 톤앤매너: ${ctx.brandTone || '친근함'}
- 업종: ${ctx.businessType || '(미설정)'}

[상시 발송 원칙 — 계절 언급 금지]
이 문안은 여정에서 연중 상시 자동 발송됩니다. 계절·월·날씨·명절 언급 절대 금지 (원본에 있던 계절 표현도 시간 불문 감성으로 교체).

${memoryContext}

[step 의도] ${input.stepIntent || '(미지정)'}
${buildJourneyContextBlock(jc, hasBody)}

[다듬기 원칙]
✓ 원본의 의미 / 변수 / 혜택 placeholder([혜택 안내 — 직접 수정해주세요]) / URL placeholder 모두 보존
✓ 안내문 / 인사 / 감성 텍스트는 회사 톤에 맞춰 풍성하게 정련 (계절 단어 없이)
✗ 구체 혜택 (% / 원 / 무료 / 쿠폰) 임의 생성 금지 — placeholder 유지
✗ (광고) / 무료수신거부 080 직접 작성 X
✗ 날씨 단순 단어 직접 작성 X — {{ weather.summary }} / {{ weather.store.summary }} Liquid 변수 의무 (D209+ Connected Content 정합)
✓ 최대 ${maxBytes}바이트 안
✓ ★ D191 강화: Liquid 문법({{ }}, {% if %}, {% endif %}, {% elsif %}, {% else %}, | filter)이 원본에 있으면 정확히 보존. Liquid 분기 안 텍스트만 톤 정련. Liquid 미사용 영역은 기존대로 평문 처리.
✓ ★ D209+ 강화 (옛 ai.ts 정합 통합):
  - 뻔한 표현 금지: "안녕하세요 고객님" / "특별한 혜택" / "준비했어요" / "소중한 고객님" / "다양한 혜택" / "많은 관심 부탁드립니다" / 느낌표 폭탄 / 과장 형용사 ("초특가" / "역대급" / "미친" / "대박")
  - SMS 호환 특수문자 화이트리스트 (EUC-KR 통신사 검증 정합): ★ ☆ ♥ ♡ ◆ ◇ ■ □ ▲ △ ▶ ◀ ● ○ ◎ ♨ ※ ☞ ☎ ① ② ③ ④ ⑤ ↑ ↓ ← → ㈜ ㎝ ㎏ ㎡
  - 자유 영역 (수식어 / 감성 / 1:1 대화감 / 호기심 갭) 적극 활용, 사실 영역 (숫자 / 장소 / 약속 / 혜택) 절대 보존

[3 후보 톤 매트릭스]
1. 감성적: 따뜻함 / 정서적 공감 / 호기심 유발 / 진심 어린 안부 (계절 단어 없이)
2. 실용적: 명확 / 정보 중심 / CTA 강조 / 구체적 안내
3. 캐주얼: 친근 / 가벼움 / 일상적 / 부담 X 톤

[출력 JSON — 다른 텍스트 금지]
{
  "candidates": [
    { "message": "...", "tone": "감성적", "reasoning": "..." },
    { "message": "...", "tone": "실용적", "reasoning": "..." },
    { "message": "...", "tone": "캐주얼", "reasoning": "..." }
  ]
}`;

  const userMessage = hasBody
    ? `원본 메시지:\n${input.currentMessage}\n\n위 메시지를 3가지 톤 후보로 다듬어 JSON으로 응답하세요. 혜택 placeholder + 변수는 그대로 유지하고 안내문/감성 텍스트만 정련하세요.`
    : `이 스텝의 문안을 처음부터 3가지 톤 후보로 써서 JSON으로 응답하세요. 위 [여정 맥락]의 트리거·목적·순번·발송 시점에 맞추고, [앞 스텝 문안]과 내용이 겹치지 않게 하세요. 구체 혜택은 지어내지 말고 placeholder로 두세요.`;

  // ★ D225+ Brand Voice Learning — 회사별 가이드라인 자동 주입 (회사 등록 미존재 시 옛 흐름 그대로)
  system = await buildSystemPromptWithBrandVoice(input.companyId, system);

  // ★ D209+ (Harold 명시 2026-05-22): Sonnet 4.6 전환 — D152 AI 다듬기 정합 본질
  //   (기존 ai.ts 흐름과 동일 모델) + 비용 80% 절감.
  //   Phase D 통합: companyId + source 전달 → 회사별 월 한도 + cache + 통계 자동 활성.
  const text = await callAIWithFallback({
    system,
    userMessage,
    maxTokens: 3000,
    temperature: 0.5,
    model: 'sonnet',
    companyId: input.companyId,
    source: 'journey-ai-refine',
  });

  let parsed: any;
  try {
    parsed = JSON.parse(extractJSON(text));
  } catch {
    return { candidates: [] };
  }

  const raw: any[] = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const validTones: Array<'감성적' | '실용적' | '캐주얼'> = ['감성적', '실용적', '캐주얼'];

  // ★ 2026-08-02 (Codex 1R·4R) — 지어낸 혜택은 기계로 막는다. 프롬프트는 경계가 아니다.
  //   ⛔ 근거는 **사람이 쓴 원본 본문 하나뿐**이다. 목적 문장·앞 스텝은 근거가 아니다 —
  //     "30% 행사를 알리고 싶다"는 말이 AI에게 그 숫자를 문안에 렌더링할 면허는 아니다(혜택은 사용자가 편집기에서 쓴다).
  //     생성 모드는 원본이 없으므로 구체 혜택이 전부 placeholder가 된다 = 의도한 동작.
  const candidates: StepRefineCandidate[] = raw.slice(0, 3).map((c: any) => {
    const rawMsg = String(c.message || '').slice(0, maxBytes * 2);
    // ★ D187-fix5: refine 응답도 sanitize 자동 적용
    const san = sanitizeForSms(rawMsg);
    const pure = stripUnauthorizedBenefits(stripAdParts(san.sanitized), input.currentMessage || '');
    return {
      message: pure, // 순수 본문 — (광고)는 발송/미리보기 합성 (이중부착 방지)
      tone: validTones.includes(c.tone) ? c.tone : '감성적',
      bytes: getBytes(pure),
      reasoning: String(c.reasoning || '').slice(0, 200),
    };
  });

  return { candidates };
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-06-30 여정 일반화 SP-B — 날짜축 스텝 LMS 문안 1건 생성 (제목+본문).
//   회사 admin이 자연어 목표 + D-N(offset)만 주면 안내문은 풍성, 구체 혜택은 placeholder로 1건 생성.
//   source 'journey-ai-refine' → callAIWithFallback가 1크레딧 자동 차감(문안생성 1건 = 1크레딧).
//   feedback_ai_no_arbitrary_benefit: % / 원 / 쿠폰 등 임의 혜택 생성 금지 → [혜택 안내 — 직접 수정해주세요] placeholder.
// ════════════════════════════════════════════════════════════════════
export async function generateAnchorStepMessage(input: {
  companyId: string;
  objective: string;
  offsetDays: number;
}): Promise<{ subject: string; message: string }> {
  const ctx = await loadCompanyContext(input.companyId);
  const memoryContext = await buildMemoryPromptContext(input.companyId, 20).catch(() => '');
  const offset = Math.max(0, Math.floor(Number(input.offsetDays) || 0));
  const timing = offset === 0 ? '기준일 당일(D-0, 마지막 안내)' : `기준일 ${offset}일 전(D-${offset})`;

  let system = `당신은 한국 마케팅 LMS 문안 작성 전문가입니다.
회사가 지정한 기준 날짜(예: 포인트 소멸일·만료일·행사일)를 기준으로 ${timing}에 발송할 LMS 문안 1건(제목+본문)을 작성합니다.

[회사 컨텍스트]
- 회사명: ${ctx.companyName}
- 브랜드명: ${ctx.brandName || '(미설정)'}
- 톤앤매너: ${ctx.brandTone || '친근함'}
- 업종: ${ctx.businessType || '(미설정)'}

[계절 언급 원칙]
발송일은 회사가 지정한 기준 날짜에 따라 반복될 수 있습니다. 오늘(생성 시점)의 계절·월·날씨를 언급하지 마세요.
여정 목표문에 계절·명절·특정 시기가 명시된 경우(예: "추석 감사 인사")에만 그 시기를 반영합니다.

${memoryContext}

[발송 시점] ${timing} — D-0에 가까울수록 남은 기간 긴박감을 자연스럽게 높이세요.

[작성 원칙]
✓ %고객명% 변수로 시작 (예: "%고객명%님, ...")
✓ 안내문 / 인사 / 감성 텍스트 / 긴박감(D-N) = 풍성하게 직접 작성 (계절 단어는 목표문에 명시된 경우만)
✓ 제목 = 본문 요약 한 줄 (40자 안, LMS 필수)
✗ 구체 혜택(% / 원 / 무료 / 쿠폰 / 사은품 / 적립 / 할인 / 무료배송) 임의 생성 절대 금지 → 정확히 \`[혜택 안내 — 직접 수정해주세요]\` placeholder 1개 사용
✗ 상품명 / 일시 / 숫자 / 연락처 임의 작성 X (모르면 placeholder)
✗ URL = \`[URL 입력]\` placeholder 또는 실제 http(s):// URL
✗ (광고) 표기 / 무료수신거부 080 직접 작성 X (시스템 자동 합성)
✗ 날씨 단순 단어 직접 작성 X
✗ 뻔한 표현 금지: "특별한 혜택" / "다양한 혜택" / "소중한 고객님" / 느낌표 폭탄 / 과장 형용사
✓ 최대 2000바이트(LMS) 안

[출력 JSON — 다른 텍스트 금지]
{ "subject": "제목 한 줄", "message": "본문" }`;

  system = await buildSystemPromptWithBrandVoice(input.companyId, system);

  const userMessage = `여정 목표(회사 입력): ${String(input.objective || '').trim() || '(미입력)'}\n\n위 목표와 발송 시점(${timing})에 맞춰 LMS 제목+본문 1건을 JSON으로 응답하세요. 구체 혜택은 placeholder로 두세요.`;

  const text = await callAIWithFallback({
    system,
    userMessage,
    maxTokens: 2000,
    temperature: 0.6,
    model: 'sonnet',
    companyId: input.companyId,
    source: 'journey-ai-refine',
  });

  let parsed: any = {};
  try { parsed = JSON.parse(extractJSON(text)); } catch { parsed = {}; }
  // ★ AI가 본문/제목에 박은 (광고)·무료수신거부 제거 → 순수 본문만(발송 시 buildAdMessage가 (광고)+080 자동 합성, 빌더 표시도 일관).
  const subj = stripAdParts(sanitizeForSms(String(parsed.subject || '').slice(0, 80)).sanitized).slice(0, 40);
  const msg = stripAdParts(sanitizeForSms(String(parsed.message || '').slice(0, 4000)).sanitized);
  return { subject: subj, message: msg };
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-06-30 여정 일반화 SP-B — 자연어 목표에서 D-N 오프셋 파싱(순수, DB import 0).
//   "7일전 3일전 당일" → [7,3,0](큰 것부터=먼저 보냄). 아무것도 없으면 기본 [7,3,1,0]. 최대 8스텝.
// ════════════════════════════════════════════════════════════════════
export function parseAnchorOffsets(objective: string): number[] {
  const text = String(objective || '');
  const set = new Set<number>();
  const re = /(\d{1,3})\s*일\s*전/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Math.max(0, Math.min(365, parseInt(m[1], 10)));
    if (Number.isFinite(n)) set.add(n);
  }
  if (/당일|당\s*일|오늘|그\s*날|D-?0/i.test(text)) set.add(0);
  let arr = Array.from(set).sort((a, b) => b - a);
  if (arr.length === 0) arr = [7, 3, 1, 0];
  return arr.slice(0, 8);
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-06-30 여정 일반화 SP-B — 자연어 목표 → 날짜축 여정 자동 생성(스텝 일괄).
//   오프셋은 정규식 파싱(결정적), 각 스텝 문안은 generateAnchorStepMessage(1건 1크레딧)로 생성.
//   "7일전 3일전 당일" → D-7/D-3/D-0 3스텝 문안 자동 작성(구체 혜택은 placeholder).
// ════════════════════════════════════════════════════════════════════
export async function generateAnchorJourneyPlan(input: {
  companyId: string;
  objective: string;
}): Promise<{ steps: { offsetDays: number; subject: string; message: string }[] }> {
  const offsets = parseAnchorOffsets(input.objective);
  const steps: { offsetDays: number; subject: string; message: string }[] = [];
  for (const off of offsets) {
    const m = await generateAnchorStepMessage({ companyId: input.companyId, objective: input.objective, offsetDays: off });
    steps.push({ offsetDays: off, subject: m.subject, message: m.message });
  }
  return { steps };
}

// ════════════════════════════════════════════════════════════════════
// 스팸필터 회피 재생성 — 걸린 step 문안을 1회 재작성 (Phase 6B)
//   source 'journey-ai-refine' → callAIWithFallback가 1크레딧 자동 차감.
//   혜택/숫자/약속/placeholder/Liquid는 그대로 보존 (거짓 혜택 생성 금지).
// ════════════════════════════════════════════════════════════════════
export async function regenerateStepAvoidingSpam(input: StepSpamRegenInput): Promise<string | null> {
  if (!input.currentMessage || input.currentMessage.trim().length < 5) return null;

  const ctx = await loadCompanyContext(input.companyId);
  const maxBytes = input.channel === 'sms' ? 90 : 2000;
  const avoid = (input.matchedStopWords || []).filter(Boolean).slice(0, 30);

  let system = `당신은 한국 마케팅 문안을 통신사 스팸필터에 걸리지 않게 재작성하는 전문가입니다.
회사 admin이 작성한 문안이 스팸필터에 걸렸습니다. 같은 의미·같은 정보를 유지하되, 걸린 표현만 자연스럽게 바꿔 1개 문안으로 재작성하세요.

[회사]
- 회사명: ${ctx.companyName}
- 톤앤매너: ${ctx.brandTone || '친근함'}

[절대 규칙]
- 혜택(% / 원 / 무료 / 쿠폰 / 사은품 / 할인)·숫자·일시·장소·약속은 절대 바꾸거나 새로 만들지 말 것. 원본 그대로 유지.
- [직접 작성해주세요] 같은 placeholder와 Liquid 문법({{ }}, {% %})은 정확히 보존.
- 유니코드 이모지 금지 — SMS 호환 특수문자만.
- 최대 ${maxBytes}바이트.

[출력 — 다른 텍스트 없이 재작성된 문안만]`;

  system = await buildSystemPromptWithBrandVoice(input.companyId, system);

  const userMessage = `원본 문안:\n${input.currentMessage}\n\n스팸필터에 걸린 표현: ${avoid.length ? avoid.join(', ') : '(불명 — 광고성 과장·금지 표현 추정)'}\n\n위 표현을 피해 같은 의미로 1개 문안만 재작성하세요. 혜택·숫자·placeholder·Liquid는 그대로 두세요.`;

  const text = await callAIWithFallback({
    system,
    userMessage,
    maxTokens: 1500,
    temperature: 0.5,
    model: 'sonnet',
    companyId: input.companyId,
    source: 'journey-ai-refine',
  });

  const cleaned = String(text || '').trim();
  if (!cleaned) return null;
  const san = sanitizeForSms(cleaned.slice(0, maxBytes * 2));
  return san.sanitized || null;
}
