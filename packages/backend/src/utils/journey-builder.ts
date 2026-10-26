/**
 * CT-43: Journey Builder — D187 (2026-05-20)
 *
 * 목적
 *   Braze Canvas Journey 압도 차별화 — 7 표준 여정 자동 생성 + 자연어 진입 (Opus 4.7)
 *   - 7 표준 템플릿: 가입 / 재구매 / 휴면 / 장바구니 / 생일 / 예약 / Custom
 *   - 회사 자유 임계값 (NULL = 무제한 default)
 *   - 회사 자유 예산 (budget_monthly NULL = 무제한)
 *   - 광고/비광고 둘 다 자동 (4 광고 검증 통과 시 — journey-executor 영역)
 *
 * 영구 원칙 정합
 *   - ai_operator_model_isolation: model: 'opus' 명시 (Sonnet 4.6 흐름 영향 없음)
 *   - no_target_auto_relax: step 발송 0건 = 차단 (journey-executor 영역)
 *   - 회사 격리: company_id FK 모든 SQL 정합
 *   - ai_operator_user_gating: AI_OPERATOR_ALLOWED_USERS 게이팅 (routes/ai.ts 영역)
 */

import { UserFacingError } from './http-error';
import { extractJsonFromAiText, aiStr } from './ai-json';
import { getCreditCost } from './ai-credit-calc';
import { runChargedAi } from './ai-credit';
import { query, pool } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { stripUnauthorizedBenefits, dropInventedEfficacy, EFFICACY_PROMPT_RULES } from './copy-benefit-detector';
import { buildMemoryPromptContext } from './company-memory';
import { seedBaselineForJourney, seedGradeStateForJourney } from './journey-entry-ledger';
import { formatStepTiming, formatConditionChip } from './journey-step-format';
import { journeyListWhere, executionStatusFilter } from './journey-list-filter';
import { StartKind, normalizeStartKind, classifyStartKind } from './journey-start-kind';
import { validateAlimtalkFallback, AlimtalkFallbackError } from './alimtalk-fallback';
// ★ 2026-08-01 여정 재설계 — 활성화가 발송이 시작되는 유일한 길목이라 게이트를 여기 둔다(Codex 4R).
import { resolveTriggerAvailability, toAvailabilityMap, triggerKeyForEvent, requiresRecipientCap, CAP_EXEMPT_TRIGGERS, isImplementedTriggerEvent, isCreatableTriggerEvent, getTriggerContract, goalKindForTrigger, defaultGoalExitFor, isProductPickTrigger, AFTER_JOURNEY_EVENT } from './journey-trigger-capability';
import { readAfterConfig } from './journey-after-config';
// ★ 2026-09-30 여정 V2 3차 — 상품 재구매 필터 검증(상품 · 문) · 키 규칙은 journey-product 한 곳.
import { normalizeProductFilters } from './journey-product';
// ★ 2026-09-30 여정 V2 4차 — 활성화는 그래프 CT 의 구조 결함(닿지 않는 칸 · 첫 칸이 끝 칸)을 막는다(그림과 같은 규칙).
import { buildJourneyGraph } from './journey-graph';
// ★ 2026-09-30 여정 V2 5차 — 새 판을 켜면 같은 트랜잭션에서 같은 계보의 옛 판 진입을 닫는다(진행 중 고객만 마무리).
import { lineageColumnsReady, lockLineageEntry, CLOSE_OTHER_VERSIONS_ENTRY_SQL, INHERIT_ENTRY_CURSORS_SQL, pauseJourneyLineage, endJourneyLineage, entryEndsColumnReady } from './journey-lineage';
import { activationCostOf } from './journey-activation-cost';
import { pauseReasonView } from './journey-pause-reason';
import { applyResumeAdjustments } from './journey-resume';
// ★ 2026-09-29 V2 (회의론자 0차 검증 2-나) — 생성 경로의 타이밍 필터도 옵션 PATCH 와 같은 정규화를 지난다(AI 가 지은 값 clamp).
import { normalizeJourneyOptions } from './journey-options-validator';
import { isUuid } from './normalize';
import { stepEditPolicy, blockedStepEditGroups, stepEditBlockedMessage, keepsPretestMarkerForStep } from './journey-step-edit-policy';
import { getCompanyJourneyFacts } from './company-data-profile';
// ★ 2026-09-29 여정 V2 0차 ⑧⑩ — 칸 종류 · 개수 · 대기 상한은 CT 한 곳(자르지 않고 거부 · 모르는 종류는 거부).
import { MAX_JOURNEY_STEPS, MAX_STEP_DELAY_HOURS, MAX_WAIT_TIMEOUT_HOURS, isKnownStepType, resolveStepType, assertStepCountWithinLimit, assertStepsWithinLimit, MAX_MESSAGE_STEPS, JourneyInputError, JOURNEY_SUBJECT_MAX_CHARS } from './journey-step-limits';
// ★ 2026-09-29 여정 V2 0차 ② — 대상 조건 검증은 추출기와 같은 허용 목록(단일 출처).
import { findCustomerConditionIssues, describeCustomerConditionIssue } from './journey-target-extractor';
import { journeyOwnerSql, type JourneyViewer } from './journey-access';
import { anchorSendHourIssue } from './send-time-util';

export { MAX_JOURNEY_STEPS, JourneyInputError };

// 앵커 반복 규칙 화이트리스트 — 설계 잠금(4종). 미지원 값은 'none'으로.
const ANCHOR_RECURRENCES = ['none', 'monthly_day', 'monthly_last', 'yearly'];
function normalizeAnchorRecurrence(x: any): string {
  return ANCHOR_RECURRENCES.includes(String(x)) ? String(x) : 'none';
}

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type JourneyTemplateCode =
  | 'onboarding'
  | 'repeat'
  | 'dormant'
  | 'points_expiring'
  | 'cart'
  | 'birthday'
  | 'reservation'
  | 'custom';

export type JourneyStatus = 'draft' | 'active' | 'paused' | 'ended';
// ★ 2026-09-30 V2 4차 — 'end'(끝 칸 · 발송 0). 저장은 JOURNEY_END_CHIP_ENABLED 일 때만(journey-step-limits isKnownStepType).
export type StepType = 'message' | 'wait' | 'condition' | 'end';
export type ChannelType = 'sms' | 'lms' | 'mms' | 'kakao' | 'email';

export interface JourneyStepDefinition {
  stepOrder: number;
  stepType: StepType;
  delayHours: number;
  channel?: ChannelType;
  messageTemplate?: string;
  subject?: string;
  isAd?: boolean;
  conditionJsonb?: Record<string, unknown>;
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): wait step 정확도 강화 — KST 시간대 영역
  //   'relative' (default) = 옛 매트릭스 (delay_hours 영역 NOW() + N시간)
  //   'specific_hour'      = 오늘/내일 target_hour_kst 영역 (예: "내일 오전 9시 발송 영역")
  //   'next_business_day'  = 다음 평일 09시 KST (단순 월~금 정합)
  delayMode?: 'relative' | 'relative_at_hour' | 'specific_hour' | 'next_business_day';
  targetHourKst?: number;  // 0~23 (specific_hour 영역 사용)
  // ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 (channel='kakao') 영역 — sms-queue insertAlimtalkQueue 정합.
  alimtalkProfileId?: string;
  alimtalkTemplateCode?: string;
  alimtalkVariableMap?: Record<string, string>;       // #{name} → 실제값 또는 @@필드키@@
  alimtalkNextType?: 'N' | 'S' | 'L' | 'A' | 'B';     // 부달 발송 정책
  alimtalkNextContents?: string;                      // A/B 시 대체 문구
  alimtalkNextSubject?: string;                       // L/B 시 LMS 대체 제목
  // ★ D188 Phase 2-B-2 (2026-05-21): MMS (channel='mms') 영역 — 이미지 서버 경로 배열.
  mmsImagePaths?: string[];
  // ★ 2026-06-30 여정 일반화: date_anchor 스텝 offset(앵커 N일 전, 0=당일). date_anchor 외에는 미사용.
  anchorOffsetDays?: number;
  // ★ 2026-07-11 진짜 분기: condition step 미충족 시 이동할 step_order(전방만). null/미지정 = 현행(여정 종료).
  //   신규 컬럼(not_met_goto)이라 INSERT 본문에 넣지 않고 저장 후 별도 UPDATE(42703 시 조용히 skip) — 여정 생성 본류 보호.
  notMetGoto?: number | null;
  // ★ 2026-07-11 wait-until-event: wait step 이벤트 대기(cdp 이벤트명 + 타임아웃 시간). 미지정 = 기존 시간 대기.
  //   신규 컬럼 2종 — notMetGoto와 동일하게 INSERT 밖 별도 UPDATE.
  waitEventName?: string | null;
  waitTimeoutHours?: number | null;
}

export interface JourneyTemplate {
  templateCode: JourneyTemplateCode;
  name: string;
  description: string;
  triggerEvent: string;
  triggerFilters: Record<string, unknown>;
  allowReentry: boolean;
  reentryCooldownDays: number | null;
  steps: JourneyStepDefinition[];
}

export interface CreateJourneyInput {
  companyId: string;
  createdBy: string;
  templateCode: JourneyTemplateCode;
  name?: string;
  customObjective?: string;
  callbackNumber: string;
  callbackMode?: string; // 'fixed'(고정번호) | 'store'(고객 매장번호 store_phone 우선)
  steps?: JourneyStepDefinition[];
  thresholdRecipients?: number | null;
  thresholdCost?: number | null;
  thresholdRiskLevel?: 'low' | 'medium' | 'high';
  budgetMonthly?: number | null;
  allowReentry?: boolean;
  reentryCooldownDays?: number | null;
  /**
   * ★ 2026-07-10 목표 달성 시 자동 종료 — 진입 이후 구매 확인 시 잔여 step 중단.
   * ★ 2026-09-29 V2 0차 ⑪ — 값을 주지 않으면(undefined) 트리거 계약에서 파생한다(새 여정). 명시값은 그대로.
   */
  goalExitEnabled?: boolean;
  // ★ 2026-06-30 여정 일반화 — 시작 방식(start_kind) 1급화 + 날짜축/one_shot 필드.
  startKind?: StartKind;                 // 미지정 시 classifyStartKind(triggerEvent)로 도출
  triggerEvent?: string;                 // 미지정 시 tmpl.triggerEvent (event=거래이벤트 / standing·one_shot·date_anchor='custom')
  triggerFilters?: Record<string, unknown>; // 대상 조건(audience) — 미지정 시 tmpl.triggerFilters
  anchorDate?: string | null;            // 'YYYY-MM-DD' (date_anchor 전용)
  anchorRecurrence?: string | null;      // 'none'|'monthly_day'|'monthly_last'|'yearly'
  anchorRecurrenceDay?: number | null;   // monthly_day일 때 N일
  anchorHourKst?: number | null;         // 기본 발송 시각(0~23), step별 targetHourKst override 가능
  oneShotScheduledAt?: string | null;    // one_shot 예약 시각(ISO). null = 즉시.
  /** ★ 2026-10-23 새 고객 받는 마지막 날 'YYYY-MM-DD'(V.3 entry_ends_on). 값이 있을 때만 칸을 쓴다(칸 준비는 호출부가 먼저 확인). */
  entryEndsOn?: string | null;
}

// ★ 2026-06-26 라프레리 신고 fix: 옛 ['[', ']'].every()는 대괄호가 있기만 하면 무조건 차단 →
//   "[송파가락점]" 같은 정상 텍스트까지 막아 활성화가 안 됐다(사용자가 대괄호까지 지워야 시작 가능).
//   실제 미편집 placeholder([... 직접/작성해/수정해/입력해 ...] / [URL ...])만 차단하도록 교정.
//   email-ai.ts hasUneditedPlaceholder 패턴과 동일 철학.
const PLACEHOLDER_PATTERN = /\[[^\[\]\n]{0,80}(직접|작성해|수정해|입력해|URL)[^\[\]\n]{0,80}\]/;

// 여정 step 최대 지연(시간) = 365일 — ★ 2026-09-29 V2: journey-step-limits CT 가 소유(여기서 다시 적지 않는다).

export function hasUneditedPlaceholder(message: string | null | undefined): boolean {
  if (!message) return true;
  return PLACEHOLDER_PATTERN.test(message);
}

export interface CompanyContext {
  companyName: string;
  brandName: string | null;
  brandTone: string | null;
  businessType: string | null;
  rejectNumber: string | null;
}

// ════════════════════════════════════════════════════════════════════
// 7 표준 템플릿 매트릭스 (Harold 확정 D187)
//   재진입 default: 가입 OFF / 재구매 ON 0d / 휴면 ON 90d / 장바구니 ON 7d / 생일 ON 365d / 예약 ON 0d
// ════════════════════════════════════════════════════════════════════

export const JOURNEY_TEMPLATES: Record<JourneyTemplateCode, JourneyTemplate> = {
  onboarding: {
    templateCode: 'onboarding',
    name: '신규 가입 온보딩',
    description: '신규 가입 후 24시간 안 환영 + 사용법 안내 + 첫 구매 유도 (4 step)',
    triggerEvent: 'customer.created',
    triggerFilters: { recent_hours: 24 },
    allowReentry: false,
    reentryCooldownDays: null,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 가입을 환영합니다.\n\n[환영 메시지와 첫 사용 안내를 작성해주세요]\n\n자세히 → [URL 입력]' },
      { stepOrder: 2, stepType: 'message', delayHours: 24, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 시작을 도와드릴게요.\n\n[첫 사용 가이드 또는 추천 상품을 작성해주세요]\n\n자세히 → [URL 입력]' },
      { stepOrder: 3, stepType: 'message', delayHours: 72, channel: 'lms', isAd: true, messageTemplate: '%고객명%님께 안내드립니다.\n\n[첫 구매 안내 또는 회사가 제공할 혜택을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
      { stepOrder: 4, stepType: 'message', delayHours: 168, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 일주일 함께해 주셔서 감사드립니다.\n\n[멤버 안내 또는 회사가 제공할 혜택을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
    ],
  },
  repeat: {
    templateCode: 'repeat',
    name: '재구매 유도',
    description: '구매 후 7일 후기 → 14일 관련 상품 → 30일 재방문 안내 (3 step)',
    triggerEvent: 'cdp.purchase',
    triggerFilters: {},
    allowReentry: true,
    reentryCooldownDays: 0,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 168, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 최근 구매하신 상품은 어떠셨나요?\n\n[후기 안내 또는 회사가 제공할 혜택을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
      { stepOrder: 2, stepType: 'message', delayHours: 336, channel: 'lms', isAd: true, messageTemplate: '%고객명%님께 추천 상품을 안내드려요.\n\n[관련 상품 또는 회사가 제공할 혜택을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
      { stepOrder: 3, stepType: 'message', delayHours: 720, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 재방문 안내드립니다.\n\n[재구매 안내 또는 회사가 제공할 혜택을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
    ],
  },
  dormant: {
    templateCode: 'dormant',
    name: '휴면 회수',
    description: '최근 구매 30일 이상 휴면 고객 회복 + 회복 안내 + 마지막 안내 (3 step)',
    triggerEvent: 'customer.dormant',
    triggerFilters: { dormant_days: 30 },
    allowReentry: true,
    reentryCooldownDays: 90,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 오랜만에 인사드립니다.\n\n[안부 메시지와 회사가 제공할 혜택을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
      { stepOrder: 2, stepType: 'message', delayHours: 168, channel: 'lms', isAd: true, messageTemplate: '%고객명%님께 안내드립니다.\n\n[회복 안내 또는 회사가 제공할 혜택을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
      { stepOrder: 3, stepType: 'message', delayHours: 336, channel: 'lms', isAd: true, messageTemplate: '%고객명%님께 마지막 안내드립니다.\n\n[최종 안내 또는 회사가 제공할 혜택과 유효기간을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
    ],
  },
  points_expiring: {
    templateCode: 'points_expiring',
    name: '포인트 소멸 임박',
    description: '포인트 N점 이상 미사용 또는 연 소멸일 D-N 사용 독려 (2 step). N·일수·소멸일은 회사가 설정.',
    triggerEvent: 'customer.points_expiring',
    triggerFilters: { expiry_mode: 'inactivity', points_min: 0, inactive_days: 180 },
    allowReentry: true,
    reentryCooldownDays: 90,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 보유하신 포인트가 있어요.\n\n[포인트 사용 안내 또는 회사가 제공할 혜택을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
      { stepOrder: 2, stepType: 'message', delayHours: 168, channel: 'lms', isAd: true, messageTemplate: '%고객명%님께 다시 안내드립니다.\n\n[포인트 소멸 전 사용 안내 또는 회사가 제공할 혜택과 유효기간을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
    ],
  },
  cart: {
    templateCode: 'cart',
    name: '장바구니 포기',
    description: '장바구니 담은 후 24h 결제 시작 0건 시 알림 + 리마인더 + 회복 안내 (3 step)',
    triggerEvent: 'cdp.cart_abandon',
    triggerFilters: { abandon_hours: 24 },
    allowReentry: true,
    reentryCooldownDays: 7,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 장바구니에 담아두신 상품이 있어요.\n\n[장바구니 안내를 작성해주세요]\n\n장바구니 → [URL 입력]' },
      { stepOrder: 2, stepType: 'message', delayHours: 24, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 장바구니 리마인드 안내드려요.\n\n[리마인드 메시지를 작성해주세요]\n\n장바구니 → [URL 입력]' },
      { stepOrder: 3, stepType: 'message', delayHours: 72, channel: 'lms', isAd: true, messageTemplate: '%고객명%님께 안내드립니다.\n\n[장바구니 회복 안내 또는 회사가 제공할 혜택을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
    ],
  },
  birthday: {
    templateCode: 'birthday',
    name: '생일 축하',
    description: 'D-7 사전 안내 + D-Day 축하 (2 step)',
    triggerEvent: 'customer.birthday_approaching',
    triggerFilters: { days_before: 7 },
    allowReentry: true,
    reentryCooldownDays: 365,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 7일 후 생일이 다가오고 있어요.\n\n[생일 사전 안내 또는 회사가 제공할 혜택을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
      { stepOrder: 2, stepType: 'message', delayHours: 168, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 생일을 축하드립니다.\n\n[생일 당일 안내 또는 회사가 제공할 혜택과 유효기간을 직접 작성해주세요]\n\n자세히 → [URL 입력]' },
    ],
  },
  reservation: {
    templateCode: 'reservation',
    name: '예약 알림',
    description: 'D-3 사전 + D-Day 당일 + D+1 후기 (3 step)',
    triggerEvent: 'cdp.reservation_created',
    triggerFilters: {},
    allowReentry: true,
    reentryCooldownDays: 0,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 3일 후 예약 안내드립니다.\n\n[예약 정보를 작성해주세요]\n\n자세히 → [URL 입력]' },
      { stepOrder: 2, stepType: 'message', delayHours: 72, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 오늘 예약 시간 안내드립니다.\n\n[당일 안내를 작성해주세요]\n\n자세히 → [URL 입력]' },
      { stepOrder: 3, stepType: 'message', delayHours: 96, channel: 'lms', isAd: true, messageTemplate: '%고객명%님, 어제 방문 감사드립니다.\n\n[후기 안내 또는 다음 예약 안내를 작성해주세요]\n\n자세히 → [URL 입력]' },
    ],
  },
  custom: {
    templateCode: 'custom',
    name: 'Custom (자연어 진입)',
    description: '회사 admin이 자연어로 입력 → AI가 골격 step 자동 생성 (회사 admin이 활성화 전 본문 직접 편집)',
    triggerEvent: 'custom',
    triggerFilters: {},
    allowReentry: true,
    reentryCooldownDays: 0,
    steps: [],
  },
};

// ════════════════════════════════════════════════════════════════════
// 표준 템플릿 자동 생성
// ════════════════════════════════════════════════════════════════════

export async function createJourneyFromTemplate(input: CreateJourneyInput): Promise<{ journeyId: string }> {
  const tmpl = JOURNEY_TEMPLATES[input.templateCode];
  if (!tmpl) {
    throw new JourneyInputError('알 수 없는 여정 종류예요. 여정 만들기를 다시 열어 주세요.');
  }
  if (input.templateCode === 'custom' && !input.customObjective && (!input.steps || input.steps.length === 0)) {
    throw new JourneyInputError('직접 만드는 여정은 목표 한 줄이나 칸이 하나 이상 있어야 해요.');
  }
  if (!input.callbackNumber || !input.callbackNumber.trim()) {
    throw new JourneyInputError('보낼 회신번호를 골라 주세요.');
  }

  const ctx = await loadCompanyContext(input.companyId);

  let steps: JourneyStepDefinition[];
  if (input.steps && input.steps.length > 0) {
    // ★ 2026-09-29 V2 0차 ⑧ — 생성 경로에는 칸 수 상한이 없었다(추가 경로에만 있었다). 넘치면 자르지 않고 거부.
    // ★ 2026-09-30 V2 4차 — 문자 칸 7 + 전체 12(갈림 두 갈래 여유).
    assertStepsWithinLimit(input.steps, '여정 저장');
    steps = input.steps.map((s, idx) => {
      const channel = s.channel || 'lms';
      const stepType = resolveStepType(s.stepType, `${idx + 1}번째 칸`);
      if (stepType === 'end' && idx === 0) throw new JourneyInputError('첫 칸은 끝 칸일 수 없어요. 끝 칸은 한 갈래를 마치는 자리에 둡니다.');
      return {
        stepOrder: s.stepOrder || idx + 1,
        // ★ 2026-09-29 V2 0차 ⑩ — 옛: `s.stepType || 'message'` = 모르는 값이 검증 없이 저장됐다(실행기는 문자로 보낸다).
        stepType,
        // ★ 2026-09-30 V2 4차 — 끝 칸은 기다리지 않는다(도착하면 그 자리에서 끝 · 대기 0 고정).
        delayHours: stepType === 'end' ? 0 : Math.max(0, Math.min(MAX_STEP_DELAY_HOURS, Number(s.delayHours) || 0)),
        channel,
        messageTemplate: (s.messageTemplate || '').slice(0, 2000),
        subject: channel === 'sms' ? '' : (s.subject || '').slice(0, JOURNEY_SUBJECT_MAX_CHARS),
        isAd: s.isAd !== undefined ? !!s.isAd : true,
        conditionJsonb: s.conditionJsonb,
        // ★ 2026-07-11 분기·이벤트 대기: 필드 보존(0605 교훈 — map 경로 누락=조용한 소실)
        notMetGoto: s.notMetGoto != null && Number.isFinite(Number(s.notMetGoto)) ? Math.floor(Number(s.notMetGoto)) : undefined,
        waitEventName: typeof s.waitEventName === 'string' && s.waitEventName.trim() ? s.waitEventName.trim().slice(0, 50) : undefined,
        waitTimeoutHours: s.waitTimeoutHours != null && Number.isFinite(Number(s.waitTimeoutHours)) && Number(s.waitTimeoutHours) > 0
          ? Math.min(MAX_WAIT_TIMEOUT_HOURS, Math.floor(Number(s.waitTimeoutHours)))
          : undefined,
        // ★ Phase 9 fix: 발송 시점(시각) + 알림톡/MMS 필드 보존 — 이전엔 map에서 누락돼 09시·알림톡 설정이 저장 안 됐음.
        delayMode: s.delayMode,
        targetHourKst: typeof s.targetHourKst === 'number' ? s.targetHourKst : undefined,
        alimtalkProfileId: s.alimtalkProfileId,
        alimtalkTemplateCode: s.alimtalkTemplateCode,
        alimtalkVariableMap: s.alimtalkVariableMap,
        alimtalkNextType: s.alimtalkNextType,
        alimtalkNextContents: s.alimtalkNextContents,
        alimtalkNextSubject: s.alimtalkNextSubject,
        mmsImagePaths: s.mmsImagePaths,
        anchorOffsetDays: s.anchorOffsetDays != null ? Math.max(0, Math.floor(Number(s.anchorOffsetDays))) : undefined,
      };
    });
  } else if (input.templateCode === 'custom' && input.customObjective) {
    steps = await generateCustomStepsWithAI(input.companyId, input.customObjective, ctx);
  } else {
    steps = tmpl.steps.map((s) => ({
      ...s,
      messageTemplate: s.messageTemplate ? customizeMessage(s.messageTemplate, ctx) : s.messageTemplate,
    }));
  }

  const journeyName = input.name || tmpl.name;
  let allowReentry = input.allowReentry !== undefined ? input.allowReentry : tmpl.allowReentry;
  let reentryCooldownDays = input.reentryCooldownDays !== undefined ? input.reentryCooldownDays : tmpl.reentryCooldownDays;

  // ★ 2026-06-30 여정 일반화 — 트리거/대상 오버라이드(미지정 시 템플릿 기본) + start_kind 도출 + 앵커 값.
  //   event = 거래 이벤트 트리거 / standing·one_shot·date_anchor = 'custom'(대상 조건 audience). 회귀: 미지정이면 옛 동작 그대로.
  const resolvedTriggerEvent = input.triggerEvent || tmpl.triggerEvent;
  // ★ 2026-08-02 §11-5(§5-4) — 저장측 화이트리스트. 지금까지는 요청값을 그대로 저장해
  //   오타·AI 환각 한 번이면 "화면상 정상인데 영원히 0건"인 여정이 만들어졌다(§9-C2).
  //   활성화 게이트가 이미 막지만, 저장 단계에서 거부해야 사용자가 200크레딧 전에 안다.
  //   미구현 트리거(레지스트리 implemented=false)도 같은 이유로 거부 — 만들 수 없는 것은 만들어지지 않아야 한다.
  // ★ V.3 §18 — 붙이기 전용(앞 여정을 마치면)은 만들기에서 받지 않는다(지도 [뒤에 여정 붙이기]로만 생긴다).
  if (!isCreatableTriggerEvent(resolvedTriggerEvent)) {
    throw new JourneyInputError('지원하지 않는 발송 조건이에요. 시작 사건을 다시 골라 주세요.');
  }
  const rawTriggerFilters = input.triggerFilters !== undefined ? input.triggerFilters : tmpl.triggerFilters;
  // ★ 2026-09-29 V2 (회의론자 0차 검증 2-나) — 타이밍 키(휴면 일수 · 방치 시간 등)는 옵션 PATCH 와 같은 범위로 정규화한다.
  //   옛: 생성 경로는 원문 그대로 저장해 AI 가 지은 "휴면 1일" 같은 값이 그대로 발송 조건이 됐다. 대상 조건 · 그 밖 키는 그대로 둔다.
  const resolvedTriggerFilters: Record<string, unknown> = {
    ...((rawTriggerFilters || {}) as Record<string, unknown>),
    ...normalizeJourneyOptions((rawTriggerFilters || {}) as Record<string, any>).triggerFilters,
  };
  // ★ 2026-09-29 여정 V2 0차 ② — 모르는 대상 조건은 저장에서 거부한다. 추출기는 모르는 항목을 조용히 건너뛰어
  //   "VIP만"이 "전 고객"이 된다(더 보내는 쪽으로 샘). 화면이 보여 준 대상과 저장되는 대상이 같아야 한다.
  {
    const rf: any = resolvedTriggerFilters || {};
    const issues = findCustomerConditionIssues(rf.customer_conditions, rf.logic);
    if (issues.length > 0) throw new JourneyInputError(describeCustomerConditionIssue(issues[0]));
  }
  // ★ 2026-09-30 여정 V2 3차 — 상품 재구매: 상품 · 문이 없으면 거부(만들어도 영영 0건).
  //   새 주기(같은 상품 재구매)마다 다시 받아야 하므로 재진입 켜짐 · 쿨다운 0 · 진입 교체 켜짐을 서버가 고정한다(설계서 §6 · 승인 결정 3).
  if (isProductPickTrigger(resolvedTriggerEvent)) {
    Object.assign(resolvedTriggerFilters, normalizeProductFilters(resolvedTriggerFilters as Record<string, any>), { entry_replace: true });
    allowReentry = true;
    reentryCooldownDays = 0;
  }
  // ★ 2026-10-20 여정 V.3 §8-2 — 새 주문 완료 여정은 「돌아온 고객은 환영만」 기본 켬(휴면 복귀 여정과 같은 구매에 두 통 0 · 끄면 같이 받는다).
  if (resolvedTriggerEvent === 'cdp.purchase' && (resolvedTriggerFilters as any).exclude_dormant_return === undefined) {
    (resolvedTriggerFilters as any).exclude_dormant_return = true;
  }
  const startKind: StartKind = normalizeStartKind(
    input.startKind || classifyStartKind(resolvedTriggerEvent, { expiryMode: (resolvedTriggerFilters as any)?.expiry_mode }),
  );
  const isAnchor = startKind === 'date_anchor';
  // ★ 2026-10-25 #8 — 날짜 예약의 보내는 시각(기준 · 칸마다) = 발송 창 안(밖이면 다음 날로 밀려 날짜가 어긋난다 · 실행기와 같은 창)
  if (isAnchor) {
    const hourIssue = anchorSendHourIssue(input.anchorHourKst) || steps.map((s) => anchorSendHourIssue(s.targetHourKst)).find(Boolean) || null;
    if (hourIssue) throw new JourneyInputError(hourIssue);
  }
  const anchorDateVal = isAnchor ? (input.anchorDate || null) : null;
  const anchorRecurrenceVal = isAnchor ? normalizeAnchorRecurrence(input.anchorRecurrence) : 'none';
  const anchorRecurrenceDayVal = isAnchor && input.anchorRecurrenceDay != null ? Math.max(1, Math.min(31, Math.floor(Number(input.anchorRecurrenceDay)))) : null;
  const anchorHourKstVal = isAnchor && input.anchorHourKst != null ? Math.max(0, Math.min(23, Math.floor(Number(input.anchorHourKst)))) : null;
  const oneShotScheduledAtVal = startKind === 'one_shot' ? (input.oneShotScheduledAt || null) : null;

  const journeyRes = await query(
    `INSERT INTO journeys (
      id, company_id, name, template_code, trigger_event, trigger_filters,
      status, budget_monthly, allow_reentry, reentry_cooldown_days,
      threshold_recipients_per_step, threshold_cost_per_step, threshold_risk_level,
      callback_number, callback_mode,
      start_kind, anchor_date, anchor_recurrence, anchor_recurrence_day, anchor_hour_kst, one_shot_scheduled_at,
      goal_exit_enabled, goal_kind,${input.entryEndsOn ? ' entry_ends_on,' : ''}
      created_by, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2, $3, $4, $5::jsonb,
      'draft', $6, $7, $8,
      $9, $10, $11,
      $12, $13,
      $15, $16::date, $17, $18, $19, $20::timestamptz,
      $21, $22,${input.entryEndsOn ? ' $23::date,' : ''}
      $14::uuid, NOW(), NOW()
    ) RETURNING id`,
    [
      input.companyId,
      journeyName.slice(0, 100),
      tmpl.templateCode,
      resolvedTriggerEvent,
      JSON.stringify(resolvedTriggerFilters || {}),
      input.budgetMonthly ?? null,
      allowReentry,
      reentryCooldownDays,
      input.thresholdRecipients ?? null,
      input.thresholdCost ?? null,
      input.thresholdRiskLevel || 'low',
      input.callbackNumber.trim().slice(0, 20),
      input.callbackMode === 'store' ? 'store' : 'fixed',
      input.createdBy,
      startKind,
      anchorDateVal,
      anchorRecurrenceVal,
      anchorRecurrenceDayVal,
      anchorHourKstVal,
      oneShotScheduledAtVal,
      // ★ 2026-07-10 목표 달성 자동 종료 (실측 컬럼 — DDL 실행 확인) · ★ 0929 V2 0차 ⑪ 미지정 = 계약 파생
      typeof input.goalExitEnabled === 'boolean' ? input.goalExitEnabled : defaultGoalExitFor(resolvedTriggerEvent),
      // ★ 2026-09-29 여정 V2 0차 ⑫(Harold 승인 결정 2) — 새 여정의 목표 종류를 트리거 계약에서 정한다.
      //   옛: 컬럼 기본값 'purchase'라 포인트 소멸 여정도 "구매"로 끝났다. goal_kind = 0929 information_schema 실측 컬럼(NOT NULL · CHECK 없음).
      goalKindForTrigger(resolvedTriggerEvent),
      ...(input.entryEndsOn ? [input.entryEndsOn] : []),
    ]
  );

  const journeyId = journeyRes.rows[0].id as string;

  // ★ 2026-08-02 §13-1: step INSERT는 insertJourneyStepRow 단일 정의를 쓴다.
  //   저장 후 스텝 추가 API(addJourneyStep)가 같은 컬럼 집합을 두 번째로 적으면 알림톡·MMS·앵커 컬럼이
  //   한쪽에만 추가되는 어긋남이 생긴다 — 그래서 생성 경로도 같은 함수를 부른다.
  // ★ 2026-09-30 여정 V2 4차 — "이 칸 링크를 눌렀나" 조건은 검토 화면에서 칸 번호(step_ref_order)로 고른다(저장 전엔 칸 id 가 없다).
  //   저장 뒤 그 번호의 칸 id 로 바꿔 넣는다(실행기 · 활성화 검증 · 통계는 step_id 축). 앞쪽 문자 칸만 받는다.
  const byOrder = new Map(steps.map((st) => [Number(st.stepOrder), st]));
  for (const st of steps) {
    const c: any = st.stepType === 'condition' ? st.conditionJsonb : null;
    if (c && c.type === 'step_link_clicked' && !c.step_id) {
      const ref = Number(c.step_ref_order);
      const target = byOrder.get(ref);
      if (!Number.isFinite(ref) || !target || ref >= Number(st.stepOrder) || target.stepType !== 'message') {
        throw new JourneyInputError(`${st.stepOrder}번째 조건 칸: 링크를 볼 앞쪽 문자 칸을 골라 주세요.`);
      }
    }
  }
  const idByOrder = new Map<number, string>();
  for (const step of steps) {
    const stepId = await insertJourneyStepRow(journeyId, step);
    idByOrder.set(Number(step.stepOrder), stepId);
  }
  for (const st of steps) {
    const c: any = st.stepType === 'condition' ? st.conditionJsonb : null;
    if (c && c.type === 'step_link_clicked' && !c.step_id) {
      const converted = { type: 'step_link_clicked', step_id: idByOrder.get(Number(c.step_ref_order)), clicked: c.clicked !== false };
      await query(`UPDATE journey_steps SET condition_jsonb = $2::jsonb WHERE id = $1::uuid`, [idByOrder.get(Number(st.stepOrder)), JSON.stringify(converted)]);
    }
  }

  return { journeyId };
}

async function loadCompanyContext(companyId: string): Promise<CompanyContext> {
  const r = await query(
    `SELECT
       c.company_name,
       c.brand_name,
       c.brand_tone,
       c.business_type,
       COALESCE(c.reject_number, c.opt_out_080_number) AS reject_number
     FROM companies c
     WHERE c.id = $1::uuid`,
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

/**
 * Liquid 출력 변수 {{ customer.X }} 중 필터(default 등)가 없는 것에 default를 자동 주입한다.
 *
 * AI 생성/사용자 작성 본문에서 일부 변수만 default가 빠지면(예: {{ customer.name }}) 값이 없는
 * 고객에게 그 자리가 비어 발송된다. 저장 직전 한 번 보정해 모든 customer 변수에 default를 보장한다.
 * 이미 필터가 있는 변수({{ customer.points | format_number }} 등)는 건드리지 않는다.
 * name은 '고객'으로, 그 외 필드는 빈 문자열로 대체한다.
 */
export function applyVariableDefaults(text: string): string {
  if (!text) return text;
  return text.replace(/\{\{\s*(customer\.[a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, varPath: string) => {
    const field = varPath.split('.')[1] || '';
    const def = field === 'name' ? '고객' : '';
    return `{{ ${varPath} | default: '${def}' }}`;
  });
}

function customizeMessage(template: string, ctx: CompanyContext): string {
  if (!ctx.brandName) return template;
  return template.replace(/\{\{brand\}\}/g, ctx.brandName);
}

// ════════════════════════════════════════════════════════════════════
// Custom 여정 — 자연어 진입 (D209+ Sonnet 4.6 전환 — 메시지 흐름 추론 ai.ts 정합)
// ════════════════════════════════════════════════════════════════════

async function generateCustomStepsWithAI(...args: Parameters<typeof generateCustomStepsUncharged>): ReturnType<typeof generateCustomStepsUncharged> {
  // ★ 2026-10-25 원장 Z4 — 돈 = AI 결과 정산 한 곳(단계를 읽어 냈을 때만) · 쓸 결과가 아니면 0원 · 잔액 부족 402 · 원장 쓰기 실패 503 · 바깥 묶음이면 0
  const { result } = await runChargedAi({
    companyId: args[0], cost: getCreditCost('journey-builder-custom'), source: 'journey-builder-custom',
    run: () => generateCustomStepsUncharged(...args),
    // ★ 1026 Codex 3R — 쓸 결과 = 본문이 남은 문자 칸이 하나라도(빈 칸만 = 0원)
    accept: (r) => Array.isArray(r) && r.some((s: any) => s.stepType === 'message' && !!String(s.messageTemplate || '').trim()),
  });
  return result;
}

async function generateCustomStepsUncharged(
  companyId: string,
  objective: string,
  ctx: CompanyContext
): Promise<JourneyStepDefinition[]> {
  const memoryContext = await buildMemoryPromptContext(companyId, 20).catch(() => '');

  // ★ D188 Phase 2-B-1 (2026-05-21): wait + condition step 사용 가이드 + JSON 응답 형식 확장.
  const system = `당신은 한국 마케팅 자동화 여정 설계 전문가입니다.
회사 admin이 자연어로 입력한 여정 목표를 받아, 2~7개의 step (시계열)을 JSON으로 응답합니다.
${EFFICACY_PROMPT_RULES}

step_type 3종:
- "message": 메시지 발송 (SMS/LMS/MMS/알림톡)
- "wait": 시간 대기만 (delay_hours 후 다음 step 진입). 메시지 발송 없음
- "condition": 고객 조건 평가: 만족 시 다음 step 진입 / 미만족 시 여정 종료

규칙:
- delayHours: 0(즉시) ~ 720h(30일) 범위. 24/48/72/168 등 자연 단위 권장
- channel (message step만): 'sms'(90자 내), 'lms'(2000자), 'kakao'(알림톡)
- messageTemplate (message step만): %고객명%, %상품명%, %혜택% 등 변수 활용
- 메시지에 (광고) 표기 없음 (시스템 자동 처리)
- 한국 정보통신망법 + 통신사 스팸 정책 정합
- conditionJsonb (condition step만): 3 type 지원:
  1. customer_field: {"type":"customer_field","field":"<컬럼명>","operator":"==|!=|>=|<=|>|<|in|not_in|is_null|not_null","value":<값>}
     · 지원 컬럼: name / phone / email / birth_date / recent_purchase_date / recent_purchase_amount / total_purchase_amount / purchase_count / grade / points / sms_opt_in / is_active
  2. cdp_event_exists: {"type":"cdp_event_exists","event_name":"<이벤트명>","within_days":<1~365>,"presence":"exists"|"not_exists"}
     · 이벤트명 예: purchase / order / cart_add / page_view / message_click
     · 사용 예: "지난 7일 안 구매 안 한 고객 영역 리마인드 발송" → presence='not_exists'
  3. journey_step_clicked: {"type":"journey_step_clicked","step_order":<옛 step N>,"within_days":<1~365>,"clicked":true|false}
     · step_order = 옛 step만 참조 가능 (현재 step보다 작은 영역 의무)
     · 사용 예: "Step 1 영역 발송 후 5일 안 클릭 X 영역 다른 채널 재시도" → clicked=false

언제 wait/condition 사용:
- wait: 메시지 발송 후 충분한 시간 대기가 의미 있는 영역 (예: 후기 요청 전 충분한 사용 시간)
- condition: 고객 분기가 필요한 영역 (예: VIP 등급만 받을 step / 지난 구매 영역 분기 / 옛 step 클릭 영역 분기)

회사 컨텍스트:
- 회사명: ${ctx.companyName}
- 브랜드명: ${ctx.brandName || '(미설정)'}
- 톤앤매너: ${ctx.brandTone || '친근함'}
- 업종: ${ctx.businessType || '(미설정)'}

${memoryContext}

JSON 형식만 응답:
{
  "steps": [
    { "stepOrder": 1, "stepType": "message", "delayHours": 0, "channel": "sms", "messageTemplate": "..." },
    { "stepOrder": 2, "stepType": "wait", "delayHours": 72 },
    { "stepOrder": 3, "stepType": "condition", "delayHours": 0, "conditionJsonb": {"type":"customer_field","field":"recent_purchase_amount","operator":">=","value":100000} },
    { "stepOrder": 4, "stepType": "message", "delayHours": 0, "channel": "lms", "messageTemplate": "..." }
  ]
}`;

  const userMessage = `여정 목표: ${objective}\n\n위 회사 컨텍스트와 메모리를 활용해 2~5개의 step JSON을 응답하세요.`;

  // ★ D209+ (Harold 명시 2026-05-22): Sonnet 4.6 전환 — 메시지 흐름 추론 ai.ts 정합 본질 + 비용 80% 절감.
  //   Phase D 통합: companyId + source 전달 → 회사별 월 한도 + cache + 통계 자동 활성.
  const text = await callAIWithFallback({
    system,
    userMessage,
    maxTokens: 1024,
    temperature: 0.2,
    model: 'sonnet',
    companyId,
    source: 'journey-builder-custom',
  });

  // ★ 2026-09-30 WP4 — JSON 추출은 CT 하나(ai-json · 머리말 · 코드펜스 · 문자열 안 제어문자 복구). 옛 코드펜스만 벗기는 인라인은 모델이 앞에 한 줄만 붙여도 실패했다.
  const parsed: any = extractJsonFromAiText(text);
  const rawSteps: any[] = Array.isArray(parsed.steps) ? parsed.steps : [];

  // ★ D188 Phase 2-B-1 (2026-05-21): step_type 3종 정합 — message/wait/condition. condition_jsonb 정합 검증 X — activateJourney에서 검증.
  // ★ 2026-09-29 여정 V2 0차 ⑧⑩ — 옛: 7칸 넘는 응답은 조용히 잘랐고 모르는 종류는 문자로 바꿨다. 이제 둘 다 거부한다.
  assertStepsWithinLimit(rawSteps, 'AI 생성 결과');
  const steps: JourneyStepDefinition[] = rawSteps.map((s: any, idx: number) => {
    const stepType: StepType = resolveStepType(s.stepType, `AI 생성 ${idx + 1}번째 칸`);
    const base: JourneyStepDefinition = {
      stepOrder: idx + 1,
      stepType,
      delayHours: Math.max(0, Math.min(MAX_STEP_DELAY_HOURS, Number(s.delayHours) || 0)),
    };
    if (stepType === 'message') {
      base.channel = ['sms', 'lms', 'mms', 'kakao', 'email'].includes(s.channel) ? s.channel : 'sms';
      // ★ 2026-10-24 세 채널 구조체크 ② — 이 생산자만 거름이 없었다(R13 · 다른 여정 생성 경로와 같은 근거 = 회사가 준 목표문).
      //   혜택 → 자리표시 · 효능 → 문장 빼기(다 빠지면 직접 채울 자리 · 활성화 관문이 막는다)
      base.messageTemplate = dropInventedEfficacy(stripUnauthorizedBenefits(aiStr(s.messageTemplate).slice(0, 2000), objective), objective).text;
      base.isAd = s.isAd !== undefined ? !!s.isAd : true;
    } else if (stepType === 'condition') {
      if (s.conditionJsonb && typeof s.conditionJsonb === 'object') {
        base.conditionJsonb = s.conditionJsonb;
      }
    }
    return base;
  });

  if (steps.length === 0) {
    throw new UserFacingError(422, 'AI_RESULT_INVALID', 'AI가 쓸 수 있는 단계를 만들지 못했어요. 목표를 조금 더 구체적으로 적어 주세요.');
  }

  return steps;
}

// ════════════════════════════════════════════════════════════════════
// 여정 상태 변경
// ════════════════════════════════════════════════════════════════════

/**
 * ★ 2026-10-20 여정 V.3 §7-2 — 시작 조건 · 한도 · 재진입 검사(순수). 켜기 관문(activateJourney)과 켜진 여정 그 자리 저장이 같은 함수를 쓴다.
 *   거절 문장(고객 언어) 또는 null. 순서와 문장은 옛 켜기 관문 그대로(조건 문장 끝의 「새로 만들어야」만 지움 · 이제 조건을 고칠 수 있다).
 */
export function validateJourneyEntryConfig(row: {
  trigger_event: string;
  allow_reentry: boolean;
  reentry_cooldown_days: number | null;
  trigger_filters: any;
  threshold_recipients_per_step: number | null;
}): string | null {
  const triggerEvent = String(row.trigger_event || '');
  // ★ §11-5(§9-N1 종결) — 재진입 허용 트리거의 최소 쿨다운을 레지스트리가 강제한다.
  //   장바구니가 기원: 정보 알림 빌더가 쿨다운 0을 고정하면 추출 안티조인이 사라져
  //   24시간 창 동안 5분마다 재발송·재차감됐다. 조건은 계약(TRIGGER_CONTRACTS)에만 산다.
  const contract = getTriggerContract(triggerEvent);
  if (contract?.cooldownMinDays != null && row.allow_reentry === true) {
    const cd = Number(row.reentry_cooldown_days || 0);
    if (cd < contract.cooldownMinDays) {
      return `이 발송 조건은 같은 분께 다시 보내기까지 최소 ${contract.cooldownMinDays}일이 필요합니다. 재진입 간격을 지정해 주세요.`;
    }
  }
  // ★ 2026-10-20 V.3 §18 — 붙인 여정은 앞 여정 · 넘길 결과가 있어야 받는다(없으면 영영 0건).
  if (triggerEvent === AFTER_JOURNEY_EVENT && !readAfterConfig(row.trigger_filters)) {
    return '앞 여정 설정이 없어 켤 수 없어요. 지도에서 다시 붙여 주세요.';
  }
  // ★ 2026-09-29 여정 V2 0차 ② — 대상 조건 최종 게이트. 저장이 먼저 막지만 옛 저장분 · 직접 UPDATE가 남을 수 있어
  //   발송이 시작되는 유일한 길목(활성화)에서 한 번 더 본다. 추출기는 모르는 항목을 조용히 건너뛰어 대상을 넓힌다.
  {
    const tf: any = row.trigger_filters || {};
    const issues = findCustomerConditionIssues(tf.customer_conditions, tf.logic);
    if (issues.length > 0) return describeCustomerConditionIssue(issues[0]);
  }
  // ★ §11-5(§9-N6 종결) — 포인트 임계 양수 강제. 기본값 0은 사실상 전원이다.
  if (triggerEvent === 'customer.points_expiring') {
    const pm = Number((row.trigger_filters || {}).points_min);
    if (!Number.isFinite(pm) || pm < 1) {
      return '포인트 기준값을 1 이상으로 지정해 주세요. 0이면 포인트가 없는 분까지 전원 대상이 됩니다.';
    }
  }
  // ★ 이관 배치가 유예 만료일에 통째로 들어오는 것은 유예가 못 막는다(단조 조건).
  //   그것을 막는 것은 수신자 상한이라 **커서 경로가 아닌 트리거**는 상한을 필수로 받는다.
  //   ⛔ 5R 정정 — 유예 대상과 상한 필수 대상은 다른 집합이다. 옛 코드가 둘을 묶어 생일이 빠졌었다.
  //     생일은 유예가 필요 없지만(실제 날짜), 생년월일 대량 적재는 그날 코호트를 한꺼번에 만든다.
  if (requiresRecipientCap(triggerEvent) && row.threshold_recipients_per_step == null) {
    return '한 번에 보낼 최대 인원을 정해 주세요. 고객 정보를 한꺼번에 옮겨 올 때 예상보다 많은 분께 나가는 것을 막습니다.';
  }
  return null;
}

export async function activateJourney(
  companyId: string, journeyId: string, userId: string,
  /** ★ V.3 Codex 적대 A2 — 새 모양 복제본을 켤 때 원본 id. 같은 계보 잠금 안에서 원본이 아직 켜져 있을 때만 켠다(그사이 사람이 멈췄으면 그만둔다). */
  opts: { requireActiveSource?: string } = {},
): Promise<{ ok: boolean; reason?: string }> {
  // 활성화 전 검증 — placeholder 미편집 차단 + 회신번호 필수 + 본문 최소 길이
  // ★ D188 Phase 2-B-1 (2026-05-21): step_type별 다른 검증 분기 — message/wait/condition.
  // ★ D194 (2026-05-22): Liquid 문법 사전 검증 + subject 빈 영역 검증 추가 (직원 테스트 발송 사고 0건 영구 안전망)
  const detail = await query(
    `SELECT j.callback_number, j.status, j.start_kind, j.anchor_date,
            j.trigger_event, j.threshold_recipients_per_step,
            j.allow_reentry, j.reentry_cooldown_days, j.trigger_filters,
            (SELECT json_agg(json_build_object(
              'id', id,
              'notMetGoto', not_met_goto,
              'order', step_order,
              'type', step_type,
              'message', message_template,
              'subject', subject,
              'channel', channel,
              'delay', delay_hours,
              'condition', condition_jsonb,
              'delayMode', delay_mode,
              'targetHourKst', target_hour_kst,
              'anchorOffset', anchor_offset_days,
              'alimtalkNextType', alimtalk_next_type,
              'alimtalkNextContents', alimtalk_next_contents,
              'alimtalkNextSubject', alimtalk_next_subject
            ) ORDER BY step_order) FROM journey_steps WHERE journey_id = j.id) AS steps
     FROM journeys j
     WHERE j.id = $1::uuid AND j.company_id = $2::uuid`,
    [journeyId, companyId]
  );
  if (detail.rows.length === 0) return { ok: false, reason: '여정을 찾을 수 없습니다.' };
  const row = detail.rows[0];
  if (!['draft', 'paused'].includes(row.status)) {
    return { ok: false, reason: '초안 또는 일시정지 상태인 여정만 활성화 가능합니다.' };
  }
  if (!row.callback_number || !String(row.callback_number).trim()) {
    return { ok: false, reason: '회신번호가 비어있습니다. 여정 편집 후 다시 시도해주세요.' };
  }
  const steps = Array.isArray(row.steps) ? row.steps : [];
  if (steps.length === 0) {
    return { ok: false, reason: 'step이 없는 여정은 활성화할 수 없습니다.' };
  }

  // ★ 2026-08-01 Codex 4R 수용 — 발송이 시작되는 유일한 길목이 활성화다. 게이트는 여기 있어야 한다.
  //   화면 잠금만으로는 새지 않는다: 자연어 생성 경로는 잠금을 안 보고, 조회가 실패해도 우회된다.
  //   여기서 막으면 어느 경로로 만들어졌든 발송 직전에 걸린다.
  //   가능 여부 조회가 실패하면 throw되어 활성화가 실패한다 — 발송 개시라서 fail-closed가 맞다.
  const triggerEvent = String(row.trigger_event || '');
  // ★ 2026-08-02 §11-5(§5-4) — 판정을 레지스트리 하나로. 모르는 값·미구현 값은 추출 default에 걸려
  //   **조용히 0건**이 되므로 발송 개시 길목(활성화)에서 거부한다. 저장측 화이트리스트가 먼저 막지만
  //   DDL 이전에 저장된 여정·직접 UPDATE가 남아 있을 수 있어 여기가 최종 게이트다.
  if (!isImplementedTriggerEvent(triggerEvent)) {
    return { ok: false, reason: '지원하지 않는 발송 조건이라 켤 수 없습니다. 여정을 다시 만들어 주세요.' };
  }
  // ★ 2026-10-20 V.3 §18 — 붙인 여정: 앞 여정 계보가 이 회사에 남아 있어야 켠다(보관 · 끝남만 남았으면 넘어올 고객이 없다).
  if (triggerEvent === AFTER_JOURNEY_EVENT) {
    const cfg = readAfterConfig(row.trigger_filters);
    const lineageOk = await lineageColumnsReady();
    const alive = cfg ? await query(
      `SELECT 1 FROM journeys WHERE company_id = $1::uuid AND archived_at IS NULL AND status <> 'ended'
          AND ${lineageOk ? '(id = $2::uuid OR lineage_id = $2::uuid)' : 'id = $2::uuid'} LIMIT 1`,
      [companyId, cfg.root],
    ) : null;
    if (!alive || alive.rows.length === 0) {
      return { ok: false, reason: '앞 여정이 없거나 끝나서 켤 수 없어요. 떼거나 다른 여정 뒤에 붙여 주세요.' };
    }
  }
  const trgKey = triggerKeyForEvent(triggerEvent);
  if (trgKey) {
    const availability = toAvailabilityMap(resolveTriggerAvailability(await getCompanyJourneyFacts(companyId)));
    const verdict = availability[trgKey];
    if (verdict && !verdict.available) {
      return { ok: false, reason: verdict.reason };
    }
  }

  // ★ 2026-10-20 여정 V.3 §7-2 — 시작 조건 · 한도 · 재진입 검사는 그 자리 저장(옵션 주소)과 같은 함수(검사 두 벌 0).
  {
    const entryIssue = validateJourneyEntryConfig({
      trigger_event: triggerEvent,
      allow_reentry: row.allow_reentry === true,
      reentry_cooldown_days: row.reentry_cooldown_days,
      trigger_filters: row.trigger_filters,
      threshold_recipients_per_step: row.threshold_recipients_per_step,
    });
    if (entryIssue) return { ok: false, reason: entryIssue };
  }

  // ★ 2026-06-30 여정 일반화 — date_anchor/one_shot 시작 방식 검증.
  const startKind = normalizeStartKind(row.start_kind);
  if (startKind === 'date_anchor') {
    if (!row.anchor_date) {
      return { ok: false, reason: '날짜로 보내는 여정은 기준 날짜가 있어야 해요. 기준 날짜를 정해 주세요.' };
    }
    const msgSteps = steps.filter((s: any) => String(s.type || 'message') === 'message');
    for (const s of msgSteps) {
      if (s.anchorOffset == null || Number.isNaN(Number(s.anchorOffset)) || Number(s.anchorOffset) < 0) {
        return { ok: false, reason: `${s.order}번째 칸에 며칠 전에 보낼지(D-N)가 비어 있어요. 정해 주세요.` };
      }
    }
  }
  if (startKind === 'one_shot') {
    const msgSteps = steps.filter((s: any) => String(s.type || 'message') === 'message');
    if (msgSteps.length !== 1) {
      return { ok: false, reason: '한 번만 보내는 여정은 문자 칸이 꼭 하나여야 해요.' };
    }
  }
  // ★ 2026-09-30 V2 4차 — 갈림 구조 결함은 켜지 않는다(끝 칸 뒤 칸이 어느 갈래에서도 닿지 않음 · 첫 칸이 끝 칸).
  {
    const graph = buildJourneyGraph(
      steps.map((x: any) => ({ id: String(x.id || ''), step_order: Number(x.order), step_type: String(x.type || 'message'), delay_hours: Number(x.delay || 0), not_met_goto: x.notMetGoto ?? null })),
      { goalExitEnabled: false, startKind: row.start_kind },
    );
    if (graph.blockingIssues.length > 0) return { ok: false, reason: graph.blockingIssues[0] };
  }
  const stepIdOrder = new Map<string, { order: number; type: string }>(steps.map((x: any) => [String(x.id || ''), { order: Number(x.order), type: String(x.type || 'message') }]));

  for (const s of steps) {
    const stepType = String(s.type || 'message');

    // ★ 2026-09-30 V2 4차 — 끝 칸: 발송 0 · 대기 0 고정. 본문 검증 없음.
    if (stepType === 'end') {
      if (Number(s.delay || 0) !== 0) return { ok: false, reason: `${s.order}번째 칸(끝) 끝 칸은 기다리지 않아요. 대기 시간을 0으로 두세요.` };
      continue;
    }

    // ★ D188 Phase 2-B-1: step_type별 검증 분기
    // ★ D210+ Phase 3 (2026-05-23 Harold 명시): wait step delay_mode 영역 검증 추가
    if (stepType === 'wait') {
      const delayMode = String(s.delayMode || 'relative');
      // ★ Fix #10 (2026-06-05): relative_at_hour 추가 — 다른 경로(타입·생성·calculateNextRunAt)는 다 지원하는데 wait 검증만 빠져 거부되던 문제.
      const validDelayModes = ['relative', 'relative_at_hour', 'specific_hour', 'next_business_day'];
      if (!validDelayModes.includes(delayMode)) {
        return { ok: false, reason: `${s.order}번째 칸(기다리기) 기다리는 방식을 골라 주세요.` };
      }

      if (delayMode === 'relative') {
        // relative = delay_hours > 0 필수 (의미 있는 대기)
        const delay = Number(s.delay || 0);
        if (delay <= 0) {
          return { ok: false, reason: `${s.order}번째 칸(기다리기) 기다리는 시간을 1시간 이상으로 정해 주세요.` };
        }
      } else if (delayMode === 'specific_hour' || delayMode === 'relative_at_hour') {
        // specific_hour / relative_at_hour = target_hour_kst (0~23) 의무
        const targetHour = Number(s.targetHourKst);
        if (!Number.isFinite(targetHour) || targetHour < 0 || targetHour > 23) {
          return { ok: false, reason: `${s.order}번째 칸(기다리기) 보낼 시각을 0시에서 23시 사이로 골라 주세요.` };
        }
      }
      // next_business_day = 추가 검증 0건 (다음 평일 09시 KST 고정 영역)

      continue; // wait step은 본문 검증 skip
    }

    if (stepType === 'condition') {
      // ★ D210+ Phase 3 (2026-05-23 Harold 명시): condition step type 화이트리스트 3종 확장
      //   1. customer_field — 옛 매트릭스 (9 operator)
      //   2. cdp_event_exists — 신규 (지난 N일 이벤트 EXISTS 영역)
      //   3. journey_step_clicked — 신규 (옛 step N 클릭 영역 EXISTS)
      const cond = s.condition;
      if (!cond || typeof cond !== 'object') {
        return { ok: false, reason: `${s.order}번째 칸(조건) 조건을 정해 주세요.` };
      }
      const condType = String((cond as any).type || '');
      // ★ 2026-09-30 V2 4차 — 새 조건 2종: 이 여정에 들어온 뒤 구매했나 · 이 칸 링크를 눌렀나(통계와 같은 step_id 축).
      const validTypes = ['customer_field', 'cdp_event_exists', 'journey_step_clicked', 'purchase_since_entry', 'step_link_clicked'];
      if (!validTypes.includes(condType)) {
        return { ok: false, reason: `${s.order}번째 칸(조건) 지원하지 않는 조건이에요. 조건을 다시 골라 주세요.` };
      }

      // type 1: customer_field — 옛 매트릭스 (field + operator + value 영역)
      if (condType === 'customer_field') {
        const condField = String((cond as any).field || '');
        const condOperator = String((cond as any).operator || '');
        if (!condField.trim()) {
          return { ok: false, reason: `${s.order}번째 칸(조건: 고객 정보) 볼 고객 정보를 골라 주세요.` };
        }
        const validOps = ['==', '!=', '>=', '<=', '>', '<', 'in', 'not_in', 'is_null', 'not_null'];
        if (!validOps.includes(condOperator)) {
          return { ok: false, reason: `${s.order}번째 칸(조건: 고객 정보) 비교 방법을 다시 골라 주세요.` };
        }
        // is_null / not_null은 value 불요, 그 외는 value 필수
        if (!['is_null', 'not_null'].includes(condOperator) && (cond as any).value === undefined) {
          return { ok: false, reason: `${s.order}번째 칸(조건: 고객 정보) 비교할 값을 넣어 주세요.` };
        }
      }

      // type 2: cdp_event_exists — event_name + within_days + presence 영역
      if (condType === 'cdp_event_exists') {
        const eventName = String((cond as any).event_name || '').trim();
        const withinDays = Number((cond as any).within_days);
        const presence = String((cond as any).presence || 'exists');
        if (!eventName) {
          return { ok: false, reason: `${s.order}번째 칸(조건: 고객 행동) 볼 행동을 골라 주세요.` };
        }
        if (!Number.isFinite(withinDays) || withinDays < 1 || withinDays > 365) {
          return { ok: false, reason: `${s.order}번째 칸(조건: 고객 행동) 기간을 1일에서 365일 사이로 정해 주세요.` };
        }
        if (!['exists', 'not_exists'].includes(presence)) {
          return { ok: false, reason: `${s.order}번째 칸(조건: 고객 행동) "했으면 / 안 했으면" 중 하나를 골라 주세요.` };
        }
      }

      // type 3: journey_step_clicked — step_order + within_days + clicked 영역
      if (condType === 'journey_step_clicked') {
        const stepOrderTarget = Number((cond as any).step_order);
        const withinDays = Number((cond as any).within_days);
        const clicked = (cond as any).clicked;
        if (!Number.isFinite(stepOrderTarget) || stepOrderTarget < 1) {
          return { ok: false, reason: `${s.order}번째 칸(조건: 링크 클릭) 볼 문자 칸을 골라 주세요.` };
        }
        if (stepOrderTarget >= s.order) {
          return { ok: false, reason: `${s.order}번째 칸(조건: 링크 클릭) 앞쪽 문자 칸만 볼 수 있어요.` };
        }
        if (!Number.isFinite(withinDays) || withinDays < 1 || withinDays > 365) {
          return { ok: false, reason: `${s.order}번째 칸(조건: 링크 클릭) 기간을 1일에서 365일 사이로 정해 주세요.` };
        }
        if (typeof clicked !== 'boolean') {
          return { ok: false, reason: `${s.order}번째 칸(조건: 링크 클릭) "눌렀으면 / 안 눌렀으면" 중 하나를 골라 주세요.` };
        }
      }

      // ★ 2026-09-30 V2 4차 — purchase_since_entry: purchased = true(샀으면) / false(안 샀으면) · 없으면 true.
      if (condType === 'purchase_since_entry') {
        const purchased = (cond as any).purchased;
        if (purchased !== undefined && typeof purchased !== 'boolean') {
          return { ok: false, reason: `${s.order}번째 칸(조건: 들어온 뒤 구매) "샀으면 / 안 샀으면" 중 하나를 골라 주세요.` };
        }
      }
      // ★ 2026-09-30 V2 4차 — step_link_clicked: 이 여정의 **앞쪽 문자 칸** 하나 + clicked(true/false).
      if (condType === 'step_link_clicked') {
        const target = stepIdOrder.get(String((cond as any).step_id || ''));
        if (!target) return { ok: false, reason: `${s.order}번째 칸(조건: 링크 클릭) 볼 문자 칸을 이 여정 안에서 골라 주세요.` };
        if (target.type !== 'message') return { ok: false, reason: `${s.order}번째 칸(조건: 링크 클릭) 링크를 볼 칸은 문자 칸이어야 해요.` };
        if (target.order >= Number(s.order)) return { ok: false, reason: `${s.order}번째 칸(조건: 링크 클릭) 앞쪽 문자 칸만 볼 수 있어요.` };
        if (typeof (cond as any).clicked !== 'boolean') return { ok: false, reason: `${s.order}번째 칸(조건: 링크 클릭) "눌렀으면 / 안 눌렀으면" 중 하나를 골라 주세요.` };
      }

      continue; // condition step은 본문 검증 skip
    }

    // message step = 본문 길이 + placeholder 검증 (기존 매트릭스)
    const msg = String(s.message || '').trim();
    if (!msg || msg.length < 10) {
      return { ok: false, reason: `${s.order}번째 칸 본문이 너무 짧아요(10자 이상).` };
    }
    if (hasUneditedPlaceholder(msg)) {
      return { ok: false, reason: `${s.order}번째 칸 본문에 채울 자리 [...] 가 남아 있어요. 직접 고쳐 주세요.` };
    }

    // ★ D194 (2026-05-22) 강화: subject 빈 영역 차단 — LMS/MMS 채널은 제목 필수
    const channel = String(s.channel || 'lms');
    if (channel === 'lms' || channel === 'mms') {
      const subj = String(s.subject || '').trim();
      if (!subj) {
        return { ok: false, reason: `${s.order}번째 칸(${channel.toUpperCase()}) 제목이 비어 있어요. 본문을 한 줄로 줄인 제목을 넣어 주세요.` };
      }
    }

    // ★ 2026-07-27: 알림톡 step 전환재발송(대체발송) 검증 — CT(alimtalk-fallback) 단일 기준.
    //   '대체문안 직접 작성'인데 문안이 비거나 LMS 전환인데 제목이 비면 발송 시점에 막힌다.
    //   발송 때 죽는 대신 활성화에서 먼저 막아 사용자가 화면에서 고치게 한다.
    if (channel === 'kakao') {
      const violation = validateAlimtalkFallback({
        nextType: s.alimtalkNextType,
        nextContents: s.alimtalkNextContents,
        nextSubject: s.alimtalkNextSubject,
      });
      if (violation) {
        return { ok: false, reason: `${s.order}번째 칸(알림톡) ${violation}` };
      }
    }

    // ★ D194 (2026-05-22) 강화: Liquid 문법 사전 검증 — 잘못된 문법 발견 시 차단 (발송 시점 매번 실패 영구 방지)
    try {
      const { detectLiquidSyntax, validateLiquidTemplate } = await import('./liquid-templating');
      if (detectLiquidSyntax(msg)) {
        const valid = validateLiquidTemplate(msg);
        if (!valid.valid) {
          // ★ 2026-10-25 원장 #119 — 템플릿 엔진 원문(「Tag 미종결 (position N)」 등)은 로그로만 · 고객에게는 칸 번호 문장
          console.warn(`[activateJourney] ${s.order}번째 칸 Liquid 오류:`, valid.errors.map((e) => e.message).join(' / '));
          return { ok: false, reason: `${s.order}번째 칸의 개인화 문법이 맞지 않아요. 미리보기에서 확인해 주세요.` };
        }
      }
    } catch (err: any) {
      console.warn('[activateJourney] Liquid 문법 검증 오류 (skip):', err?.message);
    }
  }

  // ★ 2026-08-02 §11-5(§9-N2, Codex 정정) — baseline은 활성화 **전에** 심는다.
  //   active 커밋 후 적재하면 그 사이 워커가 baseline 없는 추정 경로를 보고, 실패를 정지로 되돌리는
  //   장치가 또 필요했다(fail-open). 순서를 바꾸면 실패 = 안 켜짐이라 그 장치 자체가 사라진다.
  //   draft 상태 적재는 무해하다 — 활성화가 실패해도 baseline은 다음 활성화가 재사용한다(멱등).
  try {
    const base = await query(
      `SELECT trigger_event, entry_baseline_at FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
      [journeyId, companyId],
    );
    // ⛔ Codex 2R — 기준선은 매 활성화마다 재기준(거부된 시도·정지 기간의 낡은 기준선 고착 차단).
    //   신규가입 = 명단 보충(DO NOTHING) / 등급 = 값 재기준(DO UPDATE). 둘 다 덜 보내는 방향.
    if (base.rows[0]?.trigger_event === 'customer.created') {
      const { seeded } = await seedBaselineForJourney(journeyId, companyId);
      console.log(`[activateJourney] 진입 원장 baseline 선적재 journey=${journeyId} seeded=${seeded}`);
    }
    // ★ §11-5 #7 — 등급 변동은 등급 기준선(kind='state')이 선행. state_value 미마이그레이션(42703)이면
    //   여기서 던져져 활성화가 거부된다 — 기준 없이 켜면 첫 회차가 전 고객을 "변동"으로 오판한다.
    if (base.rows[0]?.trigger_event === 'customer.grade_changed') {
      const { seeded } = await seedGradeStateForJourney(journeyId, companyId);
      console.log(`[activateJourney] 등급 기준선 선적재 journey=${journeyId} seeded=${seeded}`);
    }
  } catch (e: any) {
    console.warn('[activateJourney] baseline 선적재 실패 — 활성화 중단:', e?.message);
    return { ok: false, reason: '진입 기준 기록에 실패해 여정을 켜지 못했습니다. 잠시 후 다시 켜 주세요.' };
  }

  // ★ 2026-09-30 V2 5차 — 활성화와 옛 판 진입 닫기를 한 트랜잭션으로(켜졌는데 옛 판도 새 고객을 받는 틈 0).
  //   DDL(lineage_id · entry_closed_at) 전이면 닫기 문장을 내지 않는다(옛 동작 그대로).
  //   ★ 0930 Codex 2R — 확인 오류를 "DDL 전"으로 접지 않는다. 모르면 켜지 않는다(켜고 옛 판 닫기를 건너뛰면 두 판이 새 고객을 받는다).
  let closeOthers: boolean;
  try {
    closeOthers = await lineageColumnsReady();
  } catch (e: any) {
    console.warn('[activateJourney] 계보 컬럼 확인 실패 — 활성화 중단:', e?.message);
    return { ok: false, reason: '여정 상태를 확인하지 못해 켜지 못했습니다. 잠시 후 다시 켜 주세요.' };
  }
  // ★ V.3 Codex 적대 A9 — 계보 컬럼 유무와 무관하게 켜기 · 다시 켜기 보정을 한 트랜잭션으로(옛: 컬럼 전 경로는 켜기가 먼저 커밋되고 보정이 뒤따라
  //   그 사이 실행기가 밀린 문자를 보낼 수 있었다 · 보정 실패도 삼켰다). 옛 판 닫기 · 커서 이어받기만 계보 컬럼이 있을 때.
  const actClient = await pool.connect();
  let r: { rows: any[] };
  let inheritConflict = false;
  let sourceStopped = false;
  try {
    await actClient.query('BEGIN');
    // ★ 0930 Codex 3R — 진입 워커 · 재진입 워커와 같은 진입 잠금을 켜기 전에 잡는다(켜기 · 옛 판 닫기와 진입이 엇갈리지 않게 · ★V.3 사람 멈춤도 같은 잠금).
    await lockLineageEntry(actClient, journeyId);
    if (opts.requireActiveSource) {
      const src = await actClient.query(
        `SELECT status FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
        [opts.requireActiveSource, companyId],
      );
      if (String(src.rows[0]?.status || '') !== 'active') sourceStopped = true;
    }
    if (sourceStopped) {
      await actClient.query('ROLLBACK');
      return { ok: false, reason: '바꾸는 사이에 여정이 멈췄어요. 다시 켠 뒤 바꿔 주세요.' };
    }
    // ★ 2026-10-20 여정 V.3 §6 — 다시 켜기 보정(journey-resume)에 쓰는 옛 상태 · 멈춘 시각(원문)을 잠금 안에서 읽는다(UPDATE 가 paused_at 을 지우기 전).
    const prevRes = await actClient.query(
      `SELECT status, paused_at::text AS paused_raw, start_kind FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [journeyId, companyId],
    );
    const prev = prevRes?.rows?.[0] || null;
    r = await actClient.query(
    `UPDATE journeys SET
      status = 'active',
      approved_by = $3::uuid,
      approved_at = NOW(),
      paused_at = NULL,
      pause_reason = NULL,
      updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('draft', 'paused')
       AND (threshold_recipients_per_step IS NOT NULL OR trigger_event = ANY($4::text[]))
       AND last_pretest_passed_at IS NOT NULL
     RETURNING id, approved_at`,
    // ★ 2026-08-01 Codex 5R — 상한 검사를 쓰기와 원자화한다.
    //   위에서 SELECT로 확인만 하면, 그 사이 옵션 저장이 상한을 비워도 활성화가 그대로 성사돼
    //   상한 NULL인 활성 여정이 남는다(워커는 상한이 없으면 상한 검사를 건너뛴다).
    //   면제 목록은 CT 단일 출처 — 커서 트리거만 상한 없이 켤 수 있다.
    // ★ 2026-08-02 Codex 2R — **사전검사 마커도 같은 문장 안으로 옮겼다(같은 교훈의 두 번째 적용).**
    //   라우트가 SELECT로 마커를 확인한 뒤 여기까지 오는 사이에 스텝이 추가되면(추가는 마커를 NULL로 만든다)
    //   확인은 통과했는데 검사받지 않은 문안이 켜진다. 확인과 반영이 갈라져 있으면 그 틈이 곧 구멍이다.
    [journeyId, companyId, userId, CAP_EXEMPT_TRIGGERS]
    );
    // ★ V.3 §6-1 ~ §6-3 — 멈춤 → 다시 켜기 보정(밀린 문자 일 단위 밀기 · 멈춘 동안 사건 안 받기 · 굳은 고객 되살리기). 첫 켜기는 손대지 않는다.
    //   실패 = 트랜잭션 되돌림(안 켜지는 방향 · 계보 컬럼 유무와 무관).
    if (r.rows.length > 0 && prev) {
      const adj = await applyResumeAdjustments(
        actClient, journeyId,
        { status: String(prev.status || ''), pausedRaw: prev.paused_raw ?? null, startKind: prev.start_kind ?? null },
        r.rows[0].approved_at,
      );
      if (adj.cursorReset) console.log(`[activateJourney] 다시 켜기 보정 journey=${journeyId} 되살림=${adj.revived} 밀림=${adj.shifted}`);
    }
    if (r.rows.length > 0 && closeOthers) {
      // ★ 0930 Codex 3R · 4R — 닫기 전에 켜진 옛 판 커서 이어받기. 이어받을 판이 둘 이상(비정상)이면 켜지 않는다(누락 · 재처리 0).
      const inh = await actClient.query(INHERIT_ENTRY_CURSORS_SQL, [journeyId]);
      if (Number(inh.rows[0]?.sources || 0) > 1) inheritConflict = true;
      else await actClient.query(CLOSE_OTHER_VERSIONS_ENTRY_SQL, [journeyId]);
    }
    // ★ V.3 §18(Codex 적대 A 1R) — 앞 여정을 마치면: 기준 시각을 켜기와 같은 트랜잭션에서 켠 시각으로(커밋 뒤에 잡으면 그 사이 마친 고객이 영영 빠진다).
    //   다시 켜기 보정 · 새 모양 커서 이어받기가 이미 채웠으면 그대로 둔다.
    if (r.rows.length > 0) {
      await actClient.query(
        `UPDATE journeys SET last_event_cursor = $2::timestamptz, last_event_cursor_id = NULL
          WHERE id = $1::uuid AND trigger_event = 'journey.after' AND last_event_cursor IS NULL`,
        [journeyId, r.rows[0].approved_at],
      );
    }
    await actClient.query(inheritConflict ? 'ROLLBACK' : 'COMMIT');
  } catch (txErr) {
    await actClient.query('ROLLBACK').catch(() => {});
    throw txErr;
  } finally {
    actClient.release();
  }
  if (inheritConflict) {
    console.warn(`[activateJourney] 같은 계보에 새 고객을 받는 옛 판이 둘 이상 — 활성화 되돌림 journey=${journeyId}`);
    return { ok: false, reason: '같은 여정의 다른 판 둘 이상이 아직 새 고객을 받고 있어 켜지 못했습니다. 옛 판 하나를 멈춘 뒤 다시 켜 주세요.' };
  }
  if (r.rows.length === 0) {
    return { ok: false, reason: '여정 설정이 방금 바뀌어 켜지 못했습니다. 새로고침 후 다시 시도해 주세요.' };
  }

  // 활성화 종결 직후 = step snapshot 보존 (활성화 시점 본문 = 발송 시점 본문 동일 보장).
  //   발송 2시간 전 스팸테스트·담당자 안내는 journey-pretest-notifier 스캐너가 실제 next_run_at 기준으로 처리(Phase 6B).
  if (r.rows.length > 0) {
    try {
      await createJourneyStepSnapshots(companyId, journeyId);
    } catch (err: any) {
      console.warn('[activateJourney] snapshot 생성 실패 (skip):', err?.message);
    }
    // ★ Phase 3: cdp 구매·예약 여정 첫 활성화 시 이벤트 커서=NOW (과거 이벤트 소급 발송 0).
    try {
      await query(
        `UPDATE journeys SET last_event_cursor = NOW()
          WHERE id = $1::uuid
            AND trigger_event IN ('cdp.purchase', 'purchase.first', 'customer.dormant_return', 'purchase.product', 'cdp.reservation_created')
            AND last_event_cursor IS NULL`,
        [journeyId],
      );
    } catch (e: any) {
      console.warn('[activateJourney] cdp 이벤트 커서 초기화 실패:', e?.message);
    }
    // ★ 2026-08-01 §11-4: 구매 원장 커서를 **활성화 시각(approved_at)** 으로 잡는다.
    //   ⛔ NOW()를 쓰면 안 된다 — 활성화 UPDATE는 이미 커밋됐고 그 뒤로 여러 await가 지난다.
    //     그 사이에 적재된 구매는 `created_at > 커서` 엄격 비교에서 영구히 빠진다(Codex 지적, 내 판단이 깨진 자리).
    //     활성화가 찍은 시각을 그대로 쓰면 그 창이 0이 된다.
    //   ⛔ 커서가 NULL인 여정은 워커가 원장 문을 아예 안 연다 — 기준이 없는 채로 열면 활성화 이전 구매까지
    //     소급 발송된다. 그래서 이 자리가 원장 문의 유일한 개시 지점이다(DDL 후 기존 활성 여정은 DDL이 재기준).
    //   ⛔ 여기서 throw하지 않는다. 활성화 UPDATE는 **이미 커밋**됐으므로 예외를 올리면
    //     "여정은 켜졌는데 호출자는 실패를 받는" 상태가 된다. 재시도해도 status가 이미 active라
    //     활성화 UPDATE의 WHERE(draft·paused)가 걸려 영원히 "켜지 못했습니다"만 돌아온다.
    //     커서를 못 심으면 워커가 원장 문을 안 여는 쪽(=안전)으로 남고, DDL 재기준 UPDATE로 되살릴 수 있다.
    //     앞의 snapshot·baseline 단계도 같은 이유로 삼킨다 — 같은 규약을 따른다.
    try {
      await query(
        `UPDATE journeys SET last_purchase_cursor = $2::timestamptz
          WHERE id = $1::uuid
            AND trigger_event IN ('cdp.purchase', 'purchase.first', 'customer.dormant_return', 'purchase.product')
            AND last_purchase_cursor IS NULL`,
        [journeyId, r.rows[0].approved_at],
      );
    } catch (e: any) {
      if (e?.code === '42703') {
        console.warn('[activateJourney] 구매 원장 커서 컬럼 미마이그레이션 — 원장 문은 DDL 후 열린다');
      } else {
        // 조용히 넘기면 그 여정만 영원히 원장 진입 0이 된다 — 복구 대상으로 식별되게 남긴다.
        console.error(`[activateJourney] 구매 원장 커서 초기화 실패 journey=${journeyId} — 원장 문 미개방(복구: DDL 재기준 UPDATE):`, e?.message || e);
      }
    }
  }

  return { ok: r.rows.length > 0 };
}

/**
 * ★ D218+ (2026-05-26) 활성화 시점 본문 + 변수 매핑 snapshot 저장.
 *   본문 변경 사고 차단 + 정지 이력 보존 안전망.
 */
export async function createJourneyStepSnapshots(companyId: string, journeyId: string): Promise<void> {
  const stepsRes = await query(
    `SELECT s.id, s.channel, s.message_template, s.subject, s.is_ad, j.callback_number,
            s.alimtalk_template_code, s.alimtalk_variable_map
       FROM journey_steps s
       JOIN journeys j ON j.id = s.journey_id
      WHERE s.journey_id = $1
        AND COALESCE(s.step_type, 'message') = 'message'`,
    [journeyId],
  );

  for (const step of stepsRes.rows) {
    const variantsRes = await query(
      `SELECT id, message_template FROM journey_step_variants WHERE step_id = $1`,
      [step.id],
    );
    const variants = variantsRes.rows.length > 0
      ? variantsRes.rows
      : [{ id: null, message_template: step.message_template }];

    for (const variant of variants) {
      await query(
        `INSERT INTO journey_step_snapshots
           (company_id, journey_id, step_id, variant_id, message_body, message_subject,
            variable_map, channel, is_ad, callback_number, alimtalk_template_code, confidence_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          companyId,
          journeyId,
          step.id,
          variant.id,
          variant.message_template,
          step.subject,
          step.alimtalk_variable_map || {},
          step.channel,
          step.is_ad,
          step.callback_number,
          step.alimtalk_template_code,
          100,
        ],
      );
    }
  }
}

// step 본문 갱신 (활성화 전 회사 admin이 직접 편집)
// ★ D188 Phase 2-B-1 (2026-05-21): step_type + conditionJsonb patch 추가 — wait/condition step 편집 영역.
export async function updateJourneyStep(
  companyId: string,
  journeyId: string,
  stepId: string,
  patch: {
    messageTemplate?: string;
    subject?: string;
    channel?: ChannelType;
    delayHours?: number;
    isAd?: boolean;
    stepType?: StepType;
    conditionJsonb?: Record<string, unknown> | null;
    // ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 + MMS 영역 patch.
    alimtalkProfileId?: string | null;
    alimtalkTemplateCode?: string | null;
    alimtalkVariableMap?: Record<string, string> | null;
    alimtalkNextType?: 'N' | 'S' | 'L' | 'A' | 'B' | null;
    alimtalkNextContents?: string | null;
    alimtalkNextSubject?: string | null;
    mmsImagePaths?: string[] | null;
    // ★ D210+ Phase 3 (2026-05-23 Harold 명시): wait step 정확도 영역 patch
    delayMode?: 'relative' | 'relative_at_hour' | 'specific_hour' | 'next_business_day' | null;
    targetHourKst?: number | null;
    // ★ D218+ (2026-05-26): step별 담당자 알림 ON/OFF/default 토글
    notifyManagerOnPretest?: boolean | null;
    // ★ 2026-07-11 활성 중 문안 수정 — 라우트 명시 opt-in. 문안 키(messageTemplate/subject)만 허용,
    //   구조 키(채널·일정·조건·알림톡·MMS)는 활성 중 계속 차단. 수정 후 새 snapshot + 스팸 재검사 강제.
    allowActiveMessageEdit?: boolean;
  }
): Promise<boolean> {
  // ★ 2026-09-29 여정 V2 0차 ⑩ (회의론자 0차 검증 3) — 칸 편집 경로에도 칸 종류 화이트리스트를 건다.
  //   옛: `step_type = COALESCE($n, step_type)`로 모르는 값이 그대로 저장됐다(실행기는 이제 그 칸을 보내지 않고 끝낸다 = 조용한 0건).
  if (patch.stepType !== undefined && patch.stepType !== null && !isKnownStepType(patch.stepType)) {
    throw new JourneyInputError('알 수 없는 칸 종류라 저장하지 않았어요. 문자 · 대기 · 조건 중에서 골라 주세요.');
  }
  // ★ 2026-10-09 — 지도 편집 창이 대기 방식을 보낸다(라우트가 이제 넘긴다) · 추가 경로와 같은 화이트리스트.
  if (patch.delayMode !== undefined && patch.delayMode !== null && !STEP_DELAY_MODES.includes(patch.delayMode)) {
    throw new JourneyInputError('알 수 없는 발송 시점 방식이라 저장하지 않았어요.');
  }
  // ⛔ 2026-08-02 Codex 5R — 상태 게이트는 **잠금 안에서** 판정한다(아래 withJourneyValidationReset).
  //   여기서 미리 읽으면 그 직후 활성화가 먼저 잠금을 가져갔을 때, 운영 중 여정을 비활성인 줄 알고 고친다.
  // ★ 2026-10-09 고객 관계 지도 — 판정 = stepEditPolicy 한 곳(지도 응답과 같은 함수 · 설계서 §4).
  //   진행 중 수도 같은 잠금 안에서 센다. 거절 = JourneyStepGateError(409 · 옛: 일반 Error 500).
  const assertStepEditAllowed = async (run: SqlRunner, status: string, startKind: string | null): Promise<void> => {
    const inProgress = status === 'paused' ? await countInProgressExecutions(run, journeyId) : 0;
    const policy = stepEditPolicy(status, inProgress, startKind);
    const blocked = blockedStepEditGroups(policy, patch as Record<string, unknown>, status);
    if (blocked.length > 0) throw new JourneyStepGateError(stepEditBlockedMessage(policy, blocked), 'STEP_EDIT_LOCKED');
  };
  const touchesCopy = patch.messageTemplate !== undefined || patch.subject !== undefined;

  // ★ D188 Phase 2-B-1: step_type 변경 시 conditionJsonb 정합 검증 (condition은 conditionJsonb 필수).
  if (patch.stepType === 'condition' && (!patch.conditionJsonb || typeof patch.conditionJsonb !== 'object')) {
    throw new JourneyInputError('조건 칸은 조건을 정해야 저장할 수 있어요.');
  }

  // ★ 2026-07-27: 알림톡 전환재발송 검증은 "저장 후 최종 상태" 기준. 부분 수정(PATCH)이라
  //   요청에 든 값만 보면 두 방향으로 다 틀린다 — 제목만 ''로 보내면 검증을 건너뛰고 빈 제목이 저장되고,
  //   타입만 보내면 DB에 멀쩡한 문안·제목이 있어도 거부된다. 아래 UPDATE의 COALESCE와 같은 규칙으로
  //   기존값과 병합한 뒤 검증한다(undefined·null = 기존값 유지, 빈 문자열 = 덮어씀).
  const touchesFallback =
    patch.alimtalkNextType !== undefined ||
    patch.alimtalkNextContents !== undefined ||
    patch.alimtalkNextSubject !== undefined;
  if (touchesFallback) {
    const cur = await query(
      `SELECT channel, alimtalk_next_type, alimtalk_next_contents, alimtalk_next_subject
         FROM journey_steps WHERE id = $1::uuid AND journey_id = $2::uuid`,
      [stepId, journeyId]
    );
    if (cur.rows.length === 0) return false;
    const row = cur.rows[0];
    const merge = <T>(patched: T | null | undefined, existing: T): T =>
      (patched === undefined || patched === null ? existing : patched);
    const mergedChannel = String(merge(patch.channel, row.channel) || '').toLowerCase();
    if (mergedChannel === 'kakao') {
      const violation = validateAlimtalkFallback({
        nextType: merge(patch.alimtalkNextType, row.alimtalk_next_type),
        nextContents: merge(patch.alimtalkNextContents, row.alimtalk_next_contents),
        nextSubject: merge(patch.alimtalkNextSubject, row.alimtalk_next_subject),
      });
      if (violation) throw new AlimtalkFallbackError(violation);
    }
  }

  // ⛔ 2026-08-02 Harold 지시 — 이미지 없는 MMS로 **옮겨 가는 것**을 막는다.
  //   채널이나 이미지를 건드리는 요청만 본다. 본문만 고치는 요청까지 막으면
  //   이미 그 상태인 스텝을 고칠 길이 없어져 되레 갇힌다(고칠 수 있어야 빠져나온다).
  if (patch.channel !== undefined || patch.mmsImagePaths !== undefined) {
    const cur = await query(
      `SELECT step_type, channel, mms_image_paths FROM journey_steps WHERE id = $1::uuid AND journey_id = $2::uuid`,
      [stepId, journeyId]
    );
    if (cur.rows.length === 0) return false;
    const row = cur.rows[0];
    assertMmsHasImage(
      patch.stepType ?? row.step_type,
      patch.channel ?? row.channel,
      patch.mmsImagePaths !== undefined ? patch.mmsImagePaths : row.mms_image_paths,
    );
  }

  // ⛔ 2026-08-02 Codex 4R — 스텝 변경과 검증 무효화를 **한 트랜잭션**에서 커밋한다.
  //   따로 나가면 그 사이에 활성화가 끼어들어, 바뀐 문안을 옛 통과 마커로 켠다.
  let isActive = false;
  // ★ 2026-10-20 V.3 §4-4 — 간격 · 담당자 알림만 고치면 사전검사 표식을 지킨다(판 = updated_at 은 늘 올림). 그 밖 키가 하나라도 있으면 지금처럼 비운다.
  const keepMarker = keepsPretestMarkerForStep(patch as Record<string, unknown>);
  const r = (await withJourneyValidationReset(companyId, journeyId, async (run, journey) => {
    await assertStepEditAllowed(run, journey.status, journey.startKind);   // 잠근 상태로 판정(5R)
    // ★ 2026-10-25 #8 — 날짜 예약 칸의 보내는 시각도 발송 창 안(만들기와 같은 판정)
    if (journey.startKind === 'date_anchor') {
      const hourIssue = anchorSendHourIssue(patch.targetHourKst);
      if (hourIssue) throw new JourneyInputError(hourIssue);
    }
    isActive = journey.status === 'active' && touchesCopy;
    const upd = await run(
    `UPDATE journey_steps SET
       message_template = COALESCE($4, message_template),
       channel = COALESCE($5, channel),
       delay_hours = COALESCE($6, delay_hours),
       is_ad = COALESCE($7, is_ad),
       subject = COALESCE($8, subject),
       step_type = COALESCE($9, step_type),
       condition_jsonb = COALESCE($10::jsonb, condition_jsonb),
       alimtalk_profile_id = COALESCE($11::uuid, alimtalk_profile_id),
       alimtalk_template_code = COALESCE($12, alimtalk_template_code),
       alimtalk_variable_map = COALESCE($13::jsonb, alimtalk_variable_map),
       alimtalk_next_type = COALESCE($14, alimtalk_next_type),
       alimtalk_next_contents = COALESCE($15, alimtalk_next_contents),
       alimtalk_next_subject = COALESCE($16, alimtalk_next_subject),
       mms_image_paths = COALESCE($17::text[], mms_image_paths),
       delay_mode = COALESCE($18, delay_mode),
       target_hour_kst = COALESCE($19, target_hour_kst),
       notify_manager_on_pretest = CASE WHEN $20::boolean IS NULL AND $21::boolean = false THEN notify_manager_on_pretest ELSE $20::boolean END
     WHERE id = $1::uuid AND journey_id = $2::uuid
       AND EXISTS (SELECT 1 FROM journeys j WHERE j.id = $2::uuid AND j.company_id = $3::uuid)
     RETURNING id`,
    [
      stepId,
      journeyId,
      companyId,
      patch.messageTemplate != null ? applyVariableDefaults(patch.messageTemplate.slice(0, 2000)) : null,
      patch.channel ?? null,
      patch.delayHours != null ? Math.max(0, Math.min(MAX_STEP_DELAY_HOURS, Number(patch.delayHours))) : null,
      patch.isAd !== undefined ? !!patch.isAd : null,
      patch.subject !== undefined ? patch.subject.slice(0, JOURNEY_SUBJECT_MAX_CHARS) : null,
      patch.stepType ?? null,
      patch.conditionJsonb !== undefined ? JSON.stringify(patch.conditionJsonb) : null,
      patch.alimtalkProfileId ?? null,
      patch.alimtalkTemplateCode ?? null,
      patch.alimtalkVariableMap !== undefined ? JSON.stringify(patch.alimtalkVariableMap) : null,
      patch.alimtalkNextType ?? null,
      patch.alimtalkNextContents ?? null,
      patch.alimtalkNextSubject ?? null,
      Array.isArray(patch.mmsImagePaths) ? patch.mmsImagePaths : null,
      patch.delayMode ?? null,
      patch.targetHourKst != null ? Math.max(0, Math.min(23, Number(patch.targetHourKst))) : null,
      // ★ D218+ (2026-05-26): notify_manager_on_pretest — true/false/null 3 상태 (NULL = default 첫/마지막 ON / 중간 OFF)
      patch.notifyManagerOnPretest !== undefined ? patch.notifyManagerOnPretest : null,
      patch.notifyManagerOnPretest !== undefined,
    ]
    );
    // ★ 2026-10-19 B-1009-6 — 켜진 여정의 새 스냅샷은 문안 변경과 **한 트랜잭션**(새 문안이 보이는 순간 재검사 전 표식(confidence_score 0)도 보인다).
    //   실행기가 발송 직전 「최신 스냅샷이 재검사 전」이면 문자 칸 발송을 미룬다(journey-executor · 새 진입 · 다음 칸 전진 · 이미 차례 모두 같은 자리)
    //   → 재검사 스캐너(journey-pretest-notifier)가 그 판을 검사하고 통과면 100 으로 올린다. 실패 = 문안 저장도 되돌린다.
    if (isActive && upd.rows.length > 0) await createStepSnapshot(companyId, journeyId, stepId, run);
    return upd;
  }, { keepMarker })) ?? { rows: [] as any[] };
  // ★ Fix #4 (2026-06-05): step 편집 시 발송 전 검증 마커 무효화 — 편집 후 재검증해야 활성화 가능.
  //   무효화는 위 트랜잭션이 함께 커밋했다. 스텝을 못 찾은 요청도 무효화되지만 그건 안전한 방향이다
  //   (한 번 더 검증하게 할 뿐이고, 반대로 놓치면 미검증 문안이 켜진다).

  // ★ 2026-07-11 활성 중 문안 수정 — 발송은 최신 snapshot을 소비(D218 ORDER BY created_at DESC)하므로
  //   새 snapshot을 만들어야 수정 본문이 실제 발송에 반영된다. 함께 이 step의 pretest dedup을 지워
  //   발송 2시간 전 자동 스팸 재검사(scanAndPretest)가 새 본문을 다시 검사하게 강제한다(기존 파이프라인 재사용).
  //   snapshot 실패 = throw(문안만 바뀌고 발송은 옛 본문인 어긋남을 사용자에게 즉시 알림).
  if (isActive && r.rows.length > 0) {
    // ★ 2026-08-02 §13-1: snapshot 생성은 createStepSnapshot 단일 정의(추가 API와 공용) · ★ 1019 위 트랜잭션 안에서 만든다.
    await query(
      `DELETE FROM journey_pretest_schedules WHERE journey_id = $1::uuid AND step_id = $2::uuid`,
      [journeyId, stepId]
    ).catch((e: any) => console.log(`[JourneyBuilder] pretest dedup 리셋 skip: ${e?.message || e}`));
  }
  return r.rows.length > 0;
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-08-02 §13-1 — 저장 후 스텝 추가·삭제 (화면 흐름 재설계의 선행)
//   지금까지 step INSERT는 여정 생성 함수 한 곳뿐이었고 DELETE는 아예 없었다.
//   스텝을 늘려 가며 쓰는 화면(설계서 §6-3)이 이것 없이는 성립하지 않는다.
//
// ⛔ 순번에 구멍이 나면 여정이 통째로 죽는다
//   실행기는 다음 step을 current_step_order + 1로 찾고(journey-executor.ts:284), 진입은 step_order = 1을 찾는다.
//   그래서 삭제는 반드시 재번호를 동반한다. 그런데 UNIQUE(journey_id, step_order)가 즉시 검사라
//   (condeferrable = f — 2026-08-02 pg_constraint 실조회) 한 문장으로 당기면 갱신 순서에 따라 충돌한다 → 2단계로 옮긴다.
// ════════════════════════════════════════════════════════════════════

/** step 상한 — ★ 2026-09-29 V2: journey-step-limits CT 가 소유(위 import · 재수출). 화면(JourneysPage)과 같은 값. */

/** 재번호 임시 자리 — 상한이 7이라 실제 순번과 겹칠 수 없다. */
const RENUMBER_OFFSET = 1000;

/**
 * ⛔ 런타임 화이트리스트 (Codex 1R P2-4) — **TypeScript 유니온은 `req.body`를 검사하지 않는다.**
 *   `stepType: 'unknown'`이 그대로 저장되면 실행기는 message 경로로 흘려보내고, 그 step은
 *   아무도 의도하지 않은 문안을 보낸다.
 * ★ 2026-09-29 정정 — 옛 주석은 "SCHEMA의 CHECK와 같은 집합"이라 했지만 journey_steps.step_type 에는 CHECK가 없다
 *   (0929 pg_constraint 실측: UNIQUE(journey_id, step_order) 뿐). **이 화이트리스트가 유일한 문이다** — 값 집합은
 *   journey-step-limits CT(KNOWN_STEP_TYPES)가 소유한다.
 */
/**
 * ⛔ 집합의 출처는 **실제로 검사·발송하는 쪽**이다 (Codex 2R).
 *   `ChannelType`에는 email이 있지만 활성화 사전검사는 kakao·sms·lms·mms만 처리하고
 *   (`journey-pretest-validator`), 실행기도 이메일 경로가 없다. 타입에 있다는 이유로 열어 두면
 *   **스팸검사를 건너뛴 채 엉뚱한 채널로 나가고 과금된다.** 이메일은 그 경로가 생길 때 연다.
 */
const STEP_CHANNELS = ['sms', 'lms', 'mms', 'kakao'];
const STEP_DELAY_MODES = ['relative', 'relative_at_hour', 'specific_hour', 'next_business_day'];

/** 트랜잭션 client를 넘기면 그 안에서 실행된다. 기본 = 풀 직행. */
type SqlRunner = (text: string, params?: any[]) => Promise<any>;

/**
 * ★ 2026-08-02 Codex 4R — **검증을 무효로 만드는 변경은 전부 이 문을 지난다.**
 *
 * 규약을 세 곳에 흩어 적었더니 라운드마다 빠진 경로가 나왔다(스텝 편집은 판을 안 올리고,
 * 옵션은 마커를 안 지우고, 회신번호는 둘 다 안 했다). 그리고 문장이 따로 나가면 그 사이에 활성화가 끼어든다 —
 * 변경은 됐는데 마커는 아직 살아 있는 순간이 실제로 존재한다.
 *
 * 그래서 **부모 여정을 잠그고, 변경과 무효화를 한 트랜잭션에서 함께 커밋**한다.
 * 무효화 = `last_pretest_passed_at = NULL` + `updated_at = NOW()` 두 개가 한 몸이다
 * (마커는 활성화가 읽고, 판은 사전검사 CAS가 읽는다).
 *
 * @param companyId 회사 격리. null이면 여정 id만으로 잠근다(내부 워커 경로).
 * @returns fn의 반환값. 여정이 없으면 null.
 */
export async function withJourneyValidationReset<T>(
  companyId: string | null,
  journeyId: string,
  fn: (run: SqlRunner, journey: { status: string; startKind: string | null }) => Promise<T>,
  // ★ 2026-10-20 V.3 §4-4 — keepMarker = 표식은 지키고 판(updated_at)만 올린다. 호출부가 「건드린 키가 전부 유지 목록」일 때만 켠다.
  opts: { keepMarker?: boolean } = {},
): Promise<T | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run: SqlRunner = (text, params) => client.query(text, params);
    // ⛔ 2026-08-02 Codex 5R — 잠금과 함께 **현재 status를 읽어 콜백에 넘긴다.**
    //   호출부가 잠금 전에 읽은 status는 이미 옛것일 수 있다. 활성화가 먼저 이 행을 잠그면
    //   그 뒤에 들어온 변경이 "비활성인 줄 알고" 운영 중 여정을 고친다. 상태 판정도 잠금 안에서 한다.
    const lock = await run(
      companyId
        ? `SELECT id, status, start_kind FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`
        : `SELECT id, status, start_kind FROM journeys WHERE id = $1::uuid FOR UPDATE`,
      companyId ? [journeyId, companyId] : [journeyId],
    );
    if (lock.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const out = await fn(run, { status: String(lock.rows[0].status), startKind: lock.rows[0].start_kind ? String(lock.rows[0].start_kind) : null });
    await run(
      opts.keepMarker
        ? `UPDATE journeys SET updated_at = NOW() WHERE id = $1::uuid`
        : `UPDATE journeys SET last_pretest_passed_at = NULL, updated_at = NOW() WHERE id = $1::uuid`,
      [journeyId],
    );
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 추가·삭제 게이트 위반 — 입력·상태 문제라 호출부가 409로 돌린다(500이면 서버 결함으로 오인된다).
 */
export class JourneyStepGateError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'JourneyStepGateError';
    this.code = code;
  }
}

/**
 * ⛔ 이미지 없는 MMS 차단 (2026-08-02 Harold 지시).
 *   MMS는 이미지가 본체다. 이미지 없이 나가면 **LMS보다 비싼 단가로 글자만** 나간다.
 *   화면이 먼저 막지만 서버가 다시 막는다 — 화면 검증만 있으면 직접 호출로 우회된다.
 */
function assertMmsHasImage(stepType: unknown, channel: unknown, images: unknown): void {
  if (String(stepType || 'message') !== 'message') return;
  if (String(channel || '') !== 'mms') return;
  if (Array.isArray(images) && images.length > 0) return;
  throw new JourneyStepGateError(
    '사진 문자는 이미지를 넣어야 저장할 수 있습니다. 이미지를 올리거나 장문 문자로 바꿔 주세요.',
    'MMS_IMAGE_REQUIRED'
  );
}

/**
 * step 1행 INSERT — **생성 경로와 추가 API의 단일 정의.**
 * ⛔ 컬럼 집합을 다른 곳에 두 번째로 적지 않는다 — 알림톡·MMS·앵커 컬럼이 한쪽에만 붙는 어긋남이 생긴다.
 */
async function insertJourneyStepRow(
  journeyId: string,
  step: JourneyStepDefinition,
  run: SqlRunner = query,
  /** ★ 2026-10-20 V.3 — 화면이 미리 만든 칸 id(칸 넣기 멱등 · addJourneyStep 만 넘긴다). 없으면 서버가 만든다. */
  id?: string,
): Promise<string> {
  // ⛔ 2026-08-02 Harold 지시 — **이미지 없는 MMS는 저장하지 않는다.**
  //   그대로 두면 LMS보다 비싼 단가로 글자만 나간다(고객사 돈이 새는 방향).
  //   INSERT가 여기 하나뿐이라 여정 생성·스텝 추가 두 경로가 이 문장 하나로 함께 막힌다.
  assertMmsHasImage(step.stepType, step.channel, step.mmsImagePaths);

  // ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 + MMS 컬럼 7건 (DB ALTER 정합).
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): wait step 정확도 — delay_mode + target_hour_kst.
  const r = await run(
    `INSERT INTO journey_steps (
      id, journey_id, step_order, step_type, delay_hours, channel, message_template, subject, is_ad, condition_jsonb,
      alimtalk_profile_id, alimtalk_template_code, alimtalk_variable_map,
      alimtalk_next_type, alimtalk_next_contents, alimtalk_next_subject,
      mms_image_paths, delay_mode, target_hour_kst, anchor_offset_days, created_at
    ) VALUES (
      COALESCE($20::uuid, gen_random_uuid()), $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
      $10::uuid, $11, $12::jsonb,
      $13, $14, $15,
      $16::text[], $17, $18, $19, NOW()
    ) RETURNING id`,
    [
      journeyId,
      step.stepOrder,
      step.stepType,
      step.delayHours,
      step.channel || null,
      step.messageTemplate ? applyVariableDefaults(step.messageTemplate) : null,
      step.subject || null,
      step.isAd !== undefined ? !!step.isAd : true,
      step.conditionJsonb ? JSON.stringify(step.conditionJsonb) : null,
      step.alimtalkProfileId || null,
      step.alimtalkTemplateCode || null,
      step.alimtalkVariableMap ? JSON.stringify(step.alimtalkVariableMap) : null,
      step.alimtalkNextType || null,
      step.alimtalkNextContents || null,
      step.alimtalkNextSubject || null,
      Array.isArray(step.mmsImagePaths) && step.mmsImagePaths.length > 0 ? step.mmsImagePaths : null,
      step.delayMode || 'relative',
      (step.delayMode === 'specific_hour' || step.delayMode === 'relative_at_hour') && typeof step.targetHourKst === 'number' ? step.targetHourKst : null,
      step.anchorOffsetDays != null ? step.anchorOffsetDays : null,
      id || null,
    ]
  );
  const stepId = r.rows[0].id as string;

  // ★ 2026-07-11 분기(not_met_goto)·이벤트 대기(wait_event_name/wait_timeout_hours) — 신규 컬럼이라 INSERT 밖 별도 UPDATE.
  //   분기는 전방 점프만 허용(자기 자신 이하 = 무한루프 위험 → 저장 안 함).
  //   ⛔ 42703 삼킴은 **풀 직행일 때만**이다. 트랜잭션(run = client) 안에서 삼키면 이미 죽은 트랜잭션을
  //     되살리지 못한 채 뒤 문장이 전부 실패한다 — 그때는 그대로 올려 호출부가 DB_MIGRATION_PENDING으로 돌린다.
  //     세 컬럼 실존은 2026-08-02 information_schema로 확인했다.
  const swallowMigrationError = run === query;
  if (step.stepType === 'condition' && step.notMetGoto != null && step.notMetGoto > step.stepOrder) {
    try {
      await run(`UPDATE journey_steps SET not_met_goto = $1 WHERE id = $2::uuid`, [step.notMetGoto, stepId]);
    } catch (e: any) {
      if (!swallowMigrationError) throw e;
      console.log(`[JourneyBuilder] not_met_goto 저장 skip(컬럼 미마이그레이션 추정): ${e?.message || e}`);
    }
  }
  if (step.stepType === 'wait' && step.waitEventName) {
    try {
      await run(
        `UPDATE journey_steps SET wait_event_name = $1, wait_timeout_hours = $2 WHERE id = $3::uuid`,
        [step.waitEventName, step.waitTimeoutHours ?? 72, stepId]
      );
    } catch (e: any) {
      if (!swallowMigrationError) throw e;
      console.log(`[JourneyBuilder] wait_event 저장 skip(컬럼 미마이그레이션 추정): ${e?.message || e}`);
    }
  }
  return stepId;
}

/**
 * 활성 여정의 발송 본문 스냅샷 1건 — 발송은 최신 snapshot을 우선 소비한다(D218).
 * 편집(updateJourneyStep)과 추가(addJourneyStep) 공용.
 */
/** ★ 2026-10-19 B-1009-6 — 켜진 여정 문안 수정 스냅샷 = confidence_score 0(재검사 전 · 실행기가 문자 발송을 미룬다 · 스캐너 통과 = 100). 활성화 스냅샷은 100(활성화 검증 통과). */
async function createStepSnapshot(companyId: string, journeyId: string, stepId: string, run: SqlRunner = query): Promise<void> {
  const s = await run(
    `SELECT s.channel, s.is_ad, s.message_template, s.subject,
            s.alimtalk_variable_map, s.alimtalk_template_code, j.callback_number
       FROM journey_steps s JOIN journeys j ON j.id = s.journey_id
      WHERE s.id = $1::uuid AND s.journey_id = $2::uuid`,
    [stepId, journeyId]
  );
  if (s.rows.length === 0) return;
  const row = s.rows[0];
  await run(
    `INSERT INTO journey_step_snapshots
       (company_id, journey_id, step_id, variant_id, message_body, message_subject,
        variable_map, channel, is_ad, callback_number, alimtalk_template_code, confidence_score)
     VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, 0)`,
    [
      companyId, journeyId, stepId,
      row.message_template, row.subject,
      row.alimtalk_variable_map || {}, row.channel, row.is_ad,
      row.callback_number, row.alimtalk_template_code,
    ]
  );
}

/**
 * 저장 후 step 추가 — 맨 뒤에 붙인다(설계서 §13-1).
 *   - 크레딧 0 — 200은 최초 활성화 1회다(설계서 §7).
 *   - 상한 판정과 순번 계산 사이에 다른 요청이 끼지 못하도록 부모 여정 행을 잠근다.
 *
 * ⛔ **활성 여정에는 추가하지 않는다** (Codex 1R P1-1 수용).
 *   설계 초안은 "활성도 허용하되 소급 안 됨"이었는데 그러면 **사전 스팸검사를 건너뛴 문안이 나간다** —
 *   `last_pretest_passed_at`은 활성화 엔드포인트만 읽고 실행기는 보지 않으며(전수 grep),
 *   자동 재검사 스캐너는 `next_run_at > NOW()`만 고르므로 지연 0으로 붙인 스텝은 검사 창 자체가 없다.
 *   그리고 스텝을 늘리는 것은 문안 수정이 아니라 **구조 변경**이라, 이미 있는 규칙
 *   (`updateJourneyStep`: 활성 중에는 문안만) 과도 어긋났다. 규칙을 하나로 되돌린다.
 * @returns null = 여정이 없거나 그 회사 것이 아님
 */
export async function addJourneyStep(
  companyId: string,
  journeyId: string,
  step: Omit<JourneyStepDefinition, 'stepOrder'>,
  /**
   * ★ 2026-10-20 V.3(Codex 적대 B 3R · 같은 부류 세 번 → 구조) — clientStepId = 화면이 미리 만든 칸 id.
   *   응답을 못 받은 넣기를 화면이 서버 상태(칸 수 · 내용 지문)로 추측하던 것을 없앤다: 같은 id 를 다시 보내면 만들지 않고 그 칸을 돌려준다.
   */
  opts: { clientStepId?: string } = {},
): Promise<{ stepId: string; stepOrder: number; existed?: boolean } | null> {
  if (opts.clientStepId != null && !isUuid(opts.clientStepId)) {
    throw new JourneyInputError('칸 번호 형식이 맞지 않아요. 화면을 새로 열어 주세요.');
  }
  // ★ D188 Phase 2-B-1과 같은 규칙 — condition step은 conditionJsonb가 있어야 판정이 성립한다.
  if (step.stepType === 'condition' && (!step.conditionJsonb || typeof step.conditionJsonb !== 'object')) {
    throw new JourneyStepGateError('조건 스텝은 조건 설정이 있어야 합니다.', 'CONDITION_REQUIRED');
  }
  // 런타임 화이트리스트 — 타입 유니온은 요청 본문을 검사하지 않는다.
  if (!isKnownStepType(step.stepType)) {
    throw new JourneyStepGateError('지원하지 않는 스텝 종류입니다.', 'INVALID_STEP_TYPE');
  }
  // ⛔ message 스텝은 채널이 **반드시** 있어야 한다. 비워 두면 검증도 건너뛰고 실행기가 기본 경로로 보낸다.
  if (String(step.stepType) === 'message' && !step.channel) {
    throw new JourneyStepGateError('발송 채널을 정해 주세요.', 'CHANNEL_REQUIRED');
  }
  if (step.channel != null && !STEP_CHANNELS.includes(String(step.channel))) {
    throw new JourneyStepGateError('지원하지 않는 발송 채널입니다.', 'INVALID_CHANNEL');
  }
  if (step.delayMode != null && !STEP_DELAY_MODES.includes(String(step.delayMode))) {
    throw new JourneyStepGateError('지원하지 않는 발송 시점 방식입니다.', 'INVALID_DELAY_MODE');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run: SqlRunner = (text, params) => client.query(text, params);

    const j = await run(
      `SELECT status, start_kind FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [journeyId, companyId]
    );
    if (j.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    // ★ 2026-10-25 #8 — 날짜 예약 칸의 보내는 시각 = 발송 창 안(만들기 · 고치기와 같은 판정)
    if (String(j.rows[0].start_kind || '') === 'date_anchor') {
      const hourIssue = anchorSendHourIssue(step.targetHourKst);
      if (hourIssue) throw new JourneyInputError(hourIssue);
    }
    // 같은 칸 id 가 이미 있으면 = 앞서 보낸 넣기가 들어간 것 → 다시 만들지 않고 그 칸을 돌려준다(여정 행 잠금 뒤라 동시에 온 같은 요청도 한 칸).
    //   상태 · 개수 검사보다 앞이다 — 이미 들어간 칸을 「못 넣었다」고 답하지 않게.
    if (opts.clientStepId) {
      const ex = await run(`SELECT journey_id, step_order FROM journey_steps WHERE id = $1::uuid`, [opts.clientStepId]);
      if (ex.rows.length > 0) {
        if (String(ex.rows[0].journey_id).toLowerCase() !== String(journeyId).toLowerCase()) {
          throw new JourneyStepGateError('칸 번호가 다른 칸과 겹쳤어요. 화면을 새로 열어 주세요.', 'STEP_ID_CONFLICT');
        }
        await client.query('ROLLBACK');
        return { stepId: opts.clientStepId, stepOrder: Number(ex.rows[0].step_order), existed: true };
      }
    }
    if (String(j.rows[0].status) === 'active') {
      throw new JourneyStepGateError(
        '운영 중인 여정에는 스텝을 더할 수 없습니다. 먼저 일시정지해 주세요. 스팸 사전검사를 다시 받아야 나갈 수 있습니다.',
        'JOURNEY_ACTIVE'
      );
    }

    const agg = await run(
      `SELECT COUNT(*)::int AS n, COALESCE(MAX(step_order), 0)::int AS mx
         FROM journey_steps WHERE journey_id = $1::uuid`,
      [journeyId]
    );
    // ★ 2026-09-30 V2 4차 — 문자 칸 수 · 갈림 유무는 따로 센다(행이 없으면 0 · 없음).
    const kinds = await run(
      `SELECT COUNT(*) FILTER (WHERE COALESCE(step_type, 'message') = 'message')::int AS msgs,
              COUNT(*) FILTER (WHERE step_type IN ('condition', 'end'))::int AS branches
         FROM journey_steps kjs WHERE kjs.journey_id = $1::uuid`,
      [journeyId]
    );
    const msgCount = Number(kinds.rows[0]?.msgs || 0);
    const branchCount = Number(kinds.rows[0]?.branches || 0);
    if (agg.rows[0].n >= MAX_JOURNEY_STEPS) {
      throw new JourneyStepGateError(`스텝은 최대 ${MAX_JOURNEY_STEPS}개까지 만들 수 있습니다.`, 'STEP_LIMIT');
    }
    // ★ 2026-09-30 V2 4차 — 문자 칸은 7개까지(전체 12 안에서).
    if (String(step.stepType || 'message') === 'message' && msgCount >= MAX_MESSAGE_STEPS) {
      throw new JourneyStepGateError(`문자 칸은 최대 ${MAX_MESSAGE_STEPS}개까지 만들 수 있습니다.`, 'STEP_LIMIT');
    }
    // ★ 2026-09-30 V2 4차 — 갈림(조건 · 끝 칸)이 있는 여정은 진행 중(active · paused) 고객이 있으면 칸을 넣지 않는다(설계서 §7 · 새 판으로).
    if (branchCount > 0 || String(step.stepType) === 'end' || String(step.stepType) === 'condition') {
      await assertNoInProgressForBranchEdit(run, journeyId);
    }
    const stepOrder = agg.rows[0].mx + 1;

    const stepId = await insertJourneyStepRow(
      journeyId,
      { ...step, stepOrder, delayHours: Math.max(0, Math.min(MAX_STEP_DELAY_HOURS, Number(step.delayHours) || 0)) },
      run,
      opts.clientStepId,
    );

    // 편집과 같은 규칙 — 스텝 구성이 바뀌었으니 발송 전 검증을 다시 받아야 한다.
    //   활성 여정을 거부하므로 이 값은 **다음 활성화가 반드시 읽는다**(그때 스팸 사전검사가 걸린다).
    //   snapshot은 만들지 않는다 — 활성화가 전 스텝 snapshot을 새로 만들기 때문이다(중복 생성 제거).
    await run(`UPDATE journeys SET last_pretest_passed_at = NULL, updated_at = NOW() WHERE id = $1::uuid`, [journeyId]);
    await client.query('COMMIT');
    return { stepId, stepOrder };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * ★ 2026-09-30 여정 V2 4차 — 갈림(조건 · 끝 칸) 여정의 칸 넣기 · 지우기 게이트(설계서 §7).
 *   진행 중(active · paused) 실행이 하나라도 있으면 거부한다 — 갈래 번호(not_met_goto)와 current_step_order 가 함께 어긋난다.
 *   구조를 바꾸려면 새 판(5차)으로 고친다.
 */
/** 진행 중(active · paused) 실행 수 — 갈림 잠금 · 칸 편집 정책이 같은 조회를 쓴다(잠금 안에서 부른다). */
export async function countInProgressExecutions(run: SqlRunner, journeyId: string): Promise<number> {
  const r = await run(
    `SELECT COUNT(*)::int AS n FROM journey_executions WHERE journey_id = $1::uuid AND status IN ('active', 'paused')`,
    [journeyId],
  );
  return Number(r.rows[0]?.n || 0);
}

async function assertNoInProgressForBranchEdit(run: SqlRunner, journeyId: string): Promise<void> {
  if ((await countInProgressExecutions(run, journeyId)) > 0) {
    throw new JourneyStepGateError('갈림이 있는 여정은 진행 중인 고객이 있으면 칸을 넣거나 뺄 수 없어요. 켠 채로 칸 모양을 바꾸면 새로 들어오는 고객부터 바뀐 모양으로 받아요.', 'BRANCH_LOCKED');
  }
}

/**
 * 저장 후 step 삭제 + 재번호(설계서 §13-1).
 *
 * ⛔ 게이트 셋 — 하나라도 걸리면 지우지 않는다.
 *   1. 스텝이 하나뿐이면 거부 (스텝 0개 여정은 성립하지 않는다)
 *   2. 발송 이력이 있으면 거부 — `journey_step_logs`가 ON DELETE CASCADE라(2026-08-02 실조회)
 *      지우는 순간 그 스텝의 발송 이력과 비용 기록이 함께 사라져 정산·통계 축이 조용히 깨진다.
 *   3. 그 자리를 이미 지났거나 **바로 다음에 받을** 고객이 진행 중이면 거부 —
 *      재번호가 `current_step_order`의 의미를 어긋나게 만든다. 날짜축 단발 실행행은
 *      `current_step_order = 발송 순번 − 1`로 만들어지므로(journey-anchor-scheduler) 직전 자리까지 봐야 닫힌다.
 *      이 게이트가 있어서 실행행 보정 코드가 통째로 필요 없다.
 *
 * `journey_anchor_dispatch`·`journey_step_variants`는 CASCADE라 함께 지워진다.
 * `journey_step_snapshots`는 **FK가 없어** CASCADE가 안 되므로 직접 지운다(2026-08-02 실조회에서 드러남).
 * @returns null = 여정·스텝이 없거나 그 회사 것이 아님
 */
export async function deleteJourneyStep(
  companyId: string,
  journeyId: string,
  stepId: string,
): Promise<{ deletedOrder: number; renumbered: number } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run: SqlRunner = (text, params) => client.query(text, params);

    const j = await run(
      `SELECT id FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [journeyId, companyId]
    );
    if (j.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const s = await run(
      `SELECT step_order FROM journey_steps WHERE id = $1::uuid AND journey_id = $2::uuid FOR UPDATE`,
      [stepId, journeyId]
    );
    if (s.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const deletedOrder = Number(s.rows[0].step_order);

    const cnt = await run(`SELECT COUNT(*)::int AS n FROM journey_steps WHERE journey_id = $1::uuid`, [journeyId]);
    if (cnt.rows[0].n <= 1) {
      throw new JourneyStepGateError('스텝이 하나뿐인 여정은 그 스텝을 지울 수 없습니다.', 'LAST_STEP');
    }
    // ★ 2026-09-30 V2 4차 — 갈림 여정은 진행 중 고객이 있으면 칸을 지우지 않는다(갈래 번호가 바뀐다 · 새 판으로).
    const branch = await run(
      `SELECT EXISTS (SELECT 1 FROM journey_steps WHERE journey_id = $1::uuid AND step_type IN ('condition', 'end')) AS has_branch`,
      [journeyId],
    );
    if (branch.rows[0]?.has_branch === true) await assertNoInProgressForBranchEdit(run, journeyId);
    // ★ 2026-09-30 V2 4차 — "이 칸 링크를 눌렀나" 조건이 가리키는 칸은 지우지 않는다(조건이 영영 거짓이 된다).
    const referenced = await run(
      `SELECT jsr.step_order AS ref_order FROM journey_steps jsr
        WHERE jsr.journey_id = $1::uuid AND jsr.step_type = 'condition'
          AND jsr.condition_jsonb->>'type' = 'step_link_clicked' AND jsr.condition_jsonb->>'step_id' = $2::text
        LIMIT 1`,
      [journeyId, stepId],
    );
    if (referenced.rows.length > 0) {
      throw new JourneyStepGateError(`${referenced.rows[0].ref_order}번째 조건 칸이 이 칸의 링크 클릭을 보고 있어 지울 수 없어요. 조건을 먼저 바꿔 주세요.`, 'REFERENCED_BY_CONDITION');
    }

    const logs = await run(`SELECT 1 FROM journey_step_logs WHERE step_id = $1::uuid LIMIT 1`, [stepId]);
    if (logs.rows.length > 0) {
      throw new JourneyStepGateError(
        '이미 발송된 스텝은 지울 수 없습니다. 발송 이력과 비용 기록이 함께 사라집니다.',
        'ALREADY_SENT'
      );
    }

    // ⛔ 'paused'를 넣지 않는 근거 — 재번호가 해를 주는 것은 **앞으로 step_order를 다시 소비할** 실행행뿐이다.
    //   paused를 active로 되돌리는 경로가 코드 전체에 없어(2026-08-02 전수 grep) 정지된 실행행은 순번을 다시 읽지 않는다.
    //   정지가 영구라 넣으면 고객 한 명만 정지해도 그 여정은 스텝을 영영 못 지운다.
    //   **재개 기능을 만들면 이 조건을 함께 고쳐야 한다.**
    const busy = await run(
      `SELECT 1 FROM journey_executions
        WHERE journey_id = $1::uuid AND status = 'active' AND current_step_order >= $2
        LIMIT 1`,
      [journeyId, deletedOrder - 1]
    );
    if (busy.rows.length > 0) {
      throw new JourneyStepGateError(
        '이 스텝을 곧 받을 고객이 진행 중이라 지금은 지울 수 없습니다. 그 고객들이 끝난 뒤에 지워 주세요.',
        'IN_PROGRESS'
      );
    }

    // FK가 없어 CASCADE가 안 되는 것 — 직접 지운다.
    await run(`DELETE FROM journey_step_snapshots WHERE step_id = $1::uuid`, [stepId]);
    // CASCADE = journey_anchor_dispatch / journey_step_variants / journey_step_logs(위 게이트로 0건)
    await run(`DELETE FROM journey_steps WHERE id = $1::uuid AND journey_id = $2::uuid`, [stepId, journeyId]);

    // 재번호 2단계 — UNIQUE(journey_id, step_order)가 즉시 검사라 한 문장으로 당기면 충돌한다.
    await run(
      `UPDATE journey_steps SET step_order = step_order + $2 WHERE journey_id = $1::uuid AND step_order > $3`,
      [journeyId, RENUMBER_OFFSET, deletedOrder]
    );
    const rn = await run(
      `UPDATE journey_steps SET step_order = step_order - $2 WHERE journey_id = $1::uuid AND step_order > $3`,
      [journeyId, RENUMBER_OFFSET + 1, RENUMBER_OFFSET]
    );

    // 분기 포인터 보정 — 지운 자리를 가리키던 값은 비우고(현행 동작 = 여정 종료), 뒤를 가리키던 값은 함께 당긴다.
    //   ⛔ 순서를 바꾸면 안 된다. 당기기를 먼저 하면 지운 자리를 가리키던 값이 살아남는다.
    await run(`UPDATE journey_steps SET not_met_goto = NULL WHERE journey_id = $1::uuid AND not_met_goto = $2`, [journeyId, deletedOrder]);
    await run(`UPDATE journey_steps SET not_met_goto = not_met_goto - 1 WHERE journey_id = $1::uuid AND not_met_goto > $2`, [journeyId, deletedOrder]);

    await run(`UPDATE journeys SET last_pretest_passed_at = NULL, updated_at = NOW() WHERE id = $1::uuid`, [journeyId]);
    await client.query('COMMIT');

    // 발송 전 자동 스팸 재검사 dedup 정리 — 실패해도 삭제는 이미 성립했다(편집 경로와 같은 방어).
    await query(`DELETE FROM journey_pretest_schedules WHERE journey_id = $1::uuid AND step_id = $2::uuid`, [journeyId, stepId])
      .catch((e: any) => console.log(`[JourneyBuilder] pretest dedup 정리 skip: ${e?.message || e}`));

    return { deletedOrder, renumbered: rn.rowCount ?? 0 };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 여정 callback_number 갱신.
 * ⛔ 2026-08-02 Codex 4R — 회신번호는 **사전검사 입력**이다(스팸 테스트를 그 번호로 넣는다).
 *   여기서 마커를 안 지우면 통과 뒤에 번호만 바꿔 검사하지 않은 발신 구성으로 켤 수 있다.
 *   옵션 PATCH와 같은 규약을 쓰도록 공용 문을 지난다.
 */
export async function updateJourneyCallback(companyId: string, journeyId: string, callbackNumber: string): Promise<boolean> {
  if (!callbackNumber || !callbackNumber.trim()) return false;
  const r = await withJourneyValidationReset(companyId, journeyId, (run) => run(
    `UPDATE journeys SET callback_number = $3
     WHERE id = $1::uuid AND company_id = $2::uuid AND status != 'active'
     RETURNING id`,
    [journeyId, companyId, callbackNumber.trim().slice(0, 20)]
  ));
  return (r?.rows.length ?? 0) > 0;
}

export async function pauseJourney(companyId: string, journeyId: string, reason?: string): Promise<boolean> {
  // ★ 2026-10-20 여정 V.3 §6-5 — 사람 멈춤 = 같은 계보의 켜진 판 전부(옛 판 마무리분 포함 · journey-lineage pauseJourneyLineage 한 곳).
  const paused = await pauseJourneyLineage(companyId, journeyId, reason || null);
  const r = { rows: paused.includes(journeyId) ? [{ id: journeyId }] : [] };
  // ★ Fix #5 (2026-06-05): 기존 'pending'/'scheduled' 일괄 UPDATE는 execution에 존재하지 않는 상태값이라 0건(무효)이었다.
  //   개별 execution을 paused로 바꾸면 재개 시 balance/단축URL 정지분과 섞여 복구가 꼬인다 → 무효 UPDATE 제거.
  //   여정 정지 즉시 반영은 executor 발송 직전 status 재확인이 journey.status까지 보게 강화해 처리(레이스 차단).
  return r.rows.length > 0;
}

export async function endJourney(companyId: string, journeyId: string): Promise<boolean> {
  // ★ 2026-10-25 여정 구조체크 2차 #5 · #4 — 끝내기 = 계보 전체(멈추기와 같은 범위 · 같은 잠금) + 진행 중 실행 닫기(journey-lineage endJourneyLineage 한 곳).
  //   옛: 지금 판만 끝내 옛 판이 진행 중 고객에게 계속 보냈다(화면은 「종료하면 발송이 멈추고」라고 약속).
  const ended = await endJourneyLineage(companyId, journeyId);
  return ended.includes(journeyId);
}

// ════════════════════════════════════════════════════════════════════
// ★ D211+ Phase 3 (2026-05-23 Harold 명시): Archive (soft delete) + Hard Delete 매트릭스
//
//   본질:
//     - archive  = journeys.archived_at = NOW()  → listJourneys default 제외 (통계 보존)
//     - unarchive = journeys.archived_at = NULL  → 보관함 영역 안 복원
//     - delete   = DB row 영구 제거 (FK CASCADE — journey_steps / journey_executions / journey_step_logs / journey_step_variants)
//
//   안전 매트릭스:
//     - active 여정 = archive/delete 차단 (먼저 pause/end 의무)
//     - archive = 모든 status 영역 가능 (active 제외)
//     - delete = 영구 손실 영역 — 회사 admin 강력 confirm 의무 (frontend 영역)
//     - cdp_events 안 journey_id 컬럼 X = 통계 영역 손실 X 정합
// ════════════════════════════════════════════════════════════════════

export async function archiveJourney(companyId: string, journeyId: string): Promise<boolean> {
  const r = await query(
    `UPDATE journeys SET archived_at = NOW(), updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
       AND status != 'active'
       AND archived_at IS NULL
     RETURNING id`,
    [journeyId, companyId]
  );
  return r.rows.length > 0;
}

export async function unarchiveJourney(companyId: string, journeyId: string): Promise<boolean> {
  const r = await query(
    `UPDATE journeys SET archived_at = NULL, updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
       AND archived_at IS NOT NULL
     RETURNING id`,
    [journeyId, companyId]
  );
  return r.rows.length > 0;
}

export async function deleteJourney(companyId: string, journeyId: string): Promise<{ ok: boolean; reason?: string }> {
  // active 여정 영역 차단 — 먼저 pause/end 의무
  const status = await query(
    `SELECT status FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
    [journeyId, companyId]
  );
  if (status.rows.length === 0) {
    return { ok: false, reason: '여정을 찾을 수 없습니다.' };
  }
  if (status.rows[0].status === 'active') {
    return { ok: false, reason: '활성 여정은 영구 삭제 X. 먼저 일시정지 또는 종료해주세요.' };
  }
  // FK CASCADE = journey_steps / journey_executions / journey_step_logs / journey_step_variants 자동 삭제
  const r = await query(
    `DELETE FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid RETURNING id`,
    [journeyId, companyId]
  );
  return { ok: r.rows.length > 0 };
}

// ════════════════════════════════════════════════════════════════════
// 조회
// ════════════════════════════════════════════════════════════════════

export async function listJourneys(companyId: string, status?: JourneyStatus | 'all' | 'archived', viewer?: JourneyViewer) {
  // ★ Fix #3 (2026-06-05): status는 라우트가 받은 신뢰 불가 값(타입 캐스팅은 런타임 보장 X) →
  //   화이트리스트 CT로 검증해 SQL 주입을 차단한다. archived 분리 + 허용 상태만 보간.
  const where = journeyListWhere(status);
  // ★ 2026-07-10 goal_met_count — 목표 달성 종료(진입 이후 구매 확인) 카드 뱃지용. 회사당 여정 수가 작아 서브쿼리 COUNT 부담 미미.
  // ★ 2026-07-11 holdout_count — 홀드아웃 대조군(미발송) 카드 뱃지용. status 값만 신규(컬럼 신규 아님 — DDL 무관 안전).
  // ★ 2026-10-23 여정 결함 0 — 담당자는 자기가 만든 여정만(캠페인 · 자동발송과 같다 · journey-access 한 곳)
  const params: any[] = [companyId];
  const owner = viewer ? journeyOwnerSql(viewer, params) : '';
  const r = await query(
    `SELECT j.*,
            (SELECT COUNT(*)::int FROM journey_executions e WHERE e.journey_id = j.id AND e.status = 'goal_met') AS goal_met_count,
            (SELECT COUNT(*)::int FROM journey_executions e WHERE e.journey_id = j.id AND e.status = 'holdout') AS holdout_count
     FROM journeys j
     WHERE j.company_id = $1::uuid ${where}${owner}
     ORDER BY j.status ASC, j.created_at DESC`,
    params
  );
  return r.rows;
}

export async function getJourneyDetail(companyId: string, journeyId: string) {
  // ★ V.3 D2 — 「새 고객 받는 마지막 날」(date 칸)은 글자로 읽는다. 드라이버가 date 를 로컬 자정 Date 로 주고 JSON 이 UTC 로 바꾸면 KST 서버에서 하루 앞으로 밀린다
  //   (send-usage-aggregation toDayKey 경위 · 1082 파서는 전역으로 바꾸지 않는다 · planner-date-contract). 칸이 없으면(DDL 전) 화면이 이 칸을 그리지 않는다.
  const endsReady = await entryEndsColumnReady().catch(() => false);
  const j = await query(
    `SELECT *${endsReady ? ', entry_ends_on::text AS entry_ends_on_text' : ''} FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
    [journeyId, companyId]
  );
  if (j.rows.length === 0) return null;
  const steps = await query(
    `SELECT * FROM journey_steps WHERE journey_id = $1::uuid ORDER BY step_order ASC`,
    [journeyId]
  );
  // Phase 9: 타임라인용 사람이 읽는 라벨(시점·조건) 부착. 첫 step(i===0)은 "트리거 후", 이후는 "직전 단계 후".
  const stepsWithLabels = steps.rows.map((s: any, i: number) => ({
    ...s,
    timingLabel: formatStepTiming({ delayMode: s.delay_mode, delayHours: s.delay_hours, targetHourKst: s.target_hour_kst }, i === 0),
    conditionLabel: s.step_type === 'condition' ? formatConditionChip(s.condition_jsonb) : null,
  }));
  // ★ 2026-10-20 V.3 §5-1 — 처음 켜기 크레딧은 서버가 정한다(계보당 1번 · 새 판 초안 = 0).
  // ★ V.3 §6-6 — 멈춘 이유 사람 말(원문은 화면에 내보내지 않는다).
  const pauseView = j.rows[0].status === 'paused' ? pauseReasonView(j.rows[0].pause_reason) : null;
  const { entry_ends_on_text: endsText, ...row } = j.rows[0];
  return {
    journey: { ...row, entry_ends_on: endsReady ? (endsText ?? null) : undefined, entry_ends_ready: endsReady, activation_cost: activationCostOf(row), pause_view: pauseView },
    steps: stepsWithLabels,
  };
}

export async function listExecutions(
  companyId: string,
  journeyId: string,
  opts: { limit?: number; offset?: number; status?: string } = {}
) {
  // ★ Fix #3 (2026-06-05): 실행 status도 화이트리스트 검증(SQL 주입 차단).
  const statusFilter = executionStatusFilter(opts.status);
  const r = await query(
    `SELECT e.*, c.name AS customer_name, c.phone AS customer_phone
     FROM journey_executions e
     JOIN journeys j ON e.journey_id = j.id
     LEFT JOIN customers c ON e.customer_id = c.id
     WHERE j.company_id = $1::uuid AND e.journey_id = $2::uuid ${statusFilter}
     ORDER BY e.entered_at DESC
     LIMIT $3 OFFSET $4`,
    [companyId, journeyId, Math.min(opts.limit || 50, 200), opts.offset || 0]
  );
  return r.rows;
}

export async function getJourneyStats(companyId: string, journeyId: string) {
  const j = await query(
    `SELECT stats_total_entered, stats_total_completed, stats_total_cost
     FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
    [journeyId, companyId]
  );
  if (j.rows.length === 0) return null;

  const stepStats = await query(
    `SELECT s.step_order, s.channel, s.message_template,
            COUNT(l.id) FILTER (WHERE l.status = 'sent') AS sent_count,
            COUNT(l.id) FILTER (WHERE l.status = 'failed') AS failed_count,
            COALESCE(SUM(l.cost), 0) AS total_cost
     FROM journey_steps s
     LEFT JOIN journey_step_logs l ON l.step_id = s.id
     WHERE s.journey_id = $1::uuid
     GROUP BY s.id, s.step_order, s.channel, s.message_template
     ORDER BY s.step_order ASC`,
    [journeyId]
  );

  return {
    total: j.rows[0],
    bySteps: stepStats.rows,
  };
}
