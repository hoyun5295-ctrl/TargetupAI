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

import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { buildMemoryPromptContext } from './company-memory';
import { seedBaselineForJourney } from './journey-entry-ledger';
import { formatStepTiming, formatConditionChip } from './journey-step-format';
import { journeyListWhere, executionStatusFilter } from './journey-list-filter';
import { StartKind, normalizeStartKind, classifyStartKind } from './journey-start-kind';
import { validateAlimtalkFallback, AlimtalkFallbackError } from './alimtalk-fallback';

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
export type StepType = 'message' | 'wait' | 'condition';
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
  /** ★ 2026-07-10 목표 달성 시 자동 종료 — 진입 이후 구매 확인 시 잔여 step 중단 (기본 false) */
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
}

// ★ 2026-06-26 라프레리 신고 fix: 옛 ['[', ']'].every()는 대괄호가 있기만 하면 무조건 차단 →
//   "[송파가락점]" 같은 정상 텍스트까지 막아 활성화가 안 됐다(사용자가 대괄호까지 지워야 시작 가능).
//   실제 미편집 placeholder([... 직접/작성해/수정해/입력해 ...] / [URL ...])만 차단하도록 교정.
//   email-ai.ts hasUneditedPlaceholder 패턴과 동일 철학.
const PLACEHOLDER_PATTERN = /\[[^\[\]\n]{0,80}(직접|작성해|수정해|입력해|URL)[^\[\]\n]{0,80}\]/;

// 여정 step 최대 지연(시간) = 365일. 생성·AI생성·편집 전 경로 공통(상한 불일치 정정 #9).
const MAX_STEP_DELAY_HOURS = 8760;

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
    throw new Error(`알 수 없는 템플릿 코드: ${input.templateCode}`);
  }
  if (input.templateCode === 'custom' && !input.customObjective && (!input.steps || input.steps.length === 0)) {
    throw new Error('Custom 여정은 자연어 목표 또는 step 목록이 필요합니다.');
  }
  if (!input.callbackNumber || !input.callbackNumber.trim()) {
    throw new Error('회신번호는 필수입니다. 회사 admin이 활성화 전 선택해주세요.');
  }

  const ctx = await loadCompanyContext(input.companyId);

  let steps: JourneyStepDefinition[];
  if (input.steps && input.steps.length > 0) {
    steps = input.steps.map((s, idx) => {
      const channel = s.channel || 'lms';
      return {
        stepOrder: s.stepOrder || idx + 1,
        stepType: s.stepType || 'message',
        delayHours: Math.max(0, Math.min(MAX_STEP_DELAY_HOURS, Number(s.delayHours) || 0)),
        channel,
        messageTemplate: (s.messageTemplate || '').slice(0, 2000),
        subject: channel === 'sms' ? '' : (s.subject || '').slice(0, 50),
        isAd: s.isAd !== undefined ? !!s.isAd : true,
        conditionJsonb: s.conditionJsonb,
        // ★ 2026-07-11 분기·이벤트 대기: 필드 보존(0605 교훈 — map 경로 누락=조용한 소실)
        notMetGoto: s.notMetGoto != null && Number.isFinite(Number(s.notMetGoto)) ? Math.floor(Number(s.notMetGoto)) : undefined,
        waitEventName: typeof s.waitEventName === 'string' && s.waitEventName.trim() ? s.waitEventName.trim().slice(0, 50) : undefined,
        waitTimeoutHours: s.waitTimeoutHours != null && Number.isFinite(Number(s.waitTimeoutHours)) && Number(s.waitTimeoutHours) > 0
          ? Math.min(720, Math.floor(Number(s.waitTimeoutHours)))
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
  const allowReentry = input.allowReentry !== undefined ? input.allowReentry : tmpl.allowReentry;
  const reentryCooldownDays = input.reentryCooldownDays !== undefined ? input.reentryCooldownDays : tmpl.reentryCooldownDays;

  // ★ 2026-06-30 여정 일반화 — 트리거/대상 오버라이드(미지정 시 템플릿 기본) + start_kind 도출 + 앵커 값.
  //   event = 거래 이벤트 트리거 / standing·one_shot·date_anchor = 'custom'(대상 조건 audience). 회귀: 미지정이면 옛 동작 그대로.
  const resolvedTriggerEvent = input.triggerEvent || tmpl.triggerEvent;
  const resolvedTriggerFilters = input.triggerFilters !== undefined ? input.triggerFilters : tmpl.triggerFilters;
  const startKind: StartKind = normalizeStartKind(
    input.startKind || classifyStartKind(resolvedTriggerEvent, { expiryMode: (resolvedTriggerFilters as any)?.expiry_mode }),
  );
  const isAnchor = startKind === 'date_anchor';
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
      goal_exit_enabled,
      created_by, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2, $3, $4, $5::jsonb,
      'draft', $6, $7, $8,
      $9, $10, $11,
      $12, $13,
      $15, $16::date, $17, $18, $19, $20::timestamptz,
      $21,
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
      input.goalExitEnabled === true,  // ★ 2026-07-10 목표 달성 자동 종료 (실측 컬럼 — DDL 실행 확인)
    ]
  );

  const journeyId = journeyRes.rows[0].id as string;

  // ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 + MMS 컬럼 7건 추가 (DB ALTER 정합).
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): wait step 정확도 — delay_mode + target_hour_kst 컬럼 2건 추가.
  for (const step of steps) {
    await query(
      `INSERT INTO journey_steps (
        id, journey_id, step_order, step_type, delay_hours, channel, message_template, subject, is_ad, condition_jsonb,
        alimtalk_profile_id, alimtalk_template_code, alimtalk_variable_map,
        alimtalk_next_type, alimtalk_next_contents, alimtalk_next_subject,
        mms_image_paths, delay_mode, target_hour_kst, anchor_offset_days, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
        $10::uuid, $11, $12::jsonb,
        $13, $14, $15,
        $16::text[], $17, $18, $19, NOW()
      )`,
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
      ]
    );

    // ★ 2026-07-11 분기(not_met_goto)·이벤트 대기(wait_event_name/wait_timeout_hours) — 신규 컬럼이라 INSERT 밖 별도 UPDATE.
    //   DDL 미실행(42703)이면 해당 설정만 조용히 누락(로그) — 여정 생성 본류는 절대 안 죽는다.
    //   분기는 전방 점프만 허용(자기 자신 이하 = 무한루프 위험 → 저장 안 함).
    if (step.stepType === 'condition' && step.notMetGoto != null && step.notMetGoto > step.stepOrder) {
      try {
        await query(
          `UPDATE journey_steps SET not_met_goto = $1
            WHERE journey_id = $2::uuid AND step_order = $3`,
          [step.notMetGoto, journeyId, step.stepOrder]
        );
      } catch (e: any) {
        console.log(`[JourneyBuilder] not_met_goto 저장 skip(컬럼 미마이그레이션 추정): ${e?.message || e}`);
      }
    }
    if (step.stepType === 'wait' && step.waitEventName) {
      try {
        await query(
          `UPDATE journey_steps SET wait_event_name = $1, wait_timeout_hours = $2
            WHERE journey_id = $3::uuid AND step_order = $4`,
          [step.waitEventName, step.waitTimeoutHours ?? 72, journeyId, step.stepOrder]
        );
      } catch (e: any) {
        console.log(`[JourneyBuilder] wait_event 저장 skip(컬럼 미마이그레이션 추정): ${e?.message || e}`);
      }
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

async function generateCustomStepsWithAI(
  companyId: string,
  objective: string,
  ctx: CompanyContext
): Promise<JourneyStepDefinition[]> {
  const memoryContext = await buildMemoryPromptContext(companyId, 20).catch(() => '');

  // ★ D188 Phase 2-B-1 (2026-05-21): wait + condition step 사용 가이드 + JSON 응답 형식 확장.
  const system = `당신은 한국 마케팅 자동화 여정 설계 전문가입니다.
회사 admin이 자연어로 입력한 여정 목표를 받아, 2~7개의 step (시계열)을 JSON으로 응답합니다.

step_type 3종:
- "message": 메시지 발송 (SMS/LMS/MMS/알림톡)
- "wait": 시간 대기만 (delay_hours 후 다음 step 진입) — 메시지 발송 없음
- "condition": 고객 조건 평가 — 만족 시 다음 step 진입 / 미만족 시 여정 종료

규칙:
- delayHours: 0(즉시) ~ 720h(30일) 범위. 24/48/72/168 등 자연 단위 권장
- channel (message step만): 'sms'(90자 내), 'lms'(2000자), 'kakao'(알림톡)
- messageTemplate (message step만): %고객명%, %상품명%, %혜택% 등 변수 활용
- 메시지에 (광고) 표기 없음 (시스템 자동 처리)
- 한국 정보통신망법 + 통신사 스팸 정책 정합
- conditionJsonb (condition step만) — 3 type 지원:
  1. customer_field — {"type":"customer_field","field":"<컬럼명>","operator":"==|!=|>=|<=|>|<|in|not_in|is_null|not_null","value":<값>}
     · 지원 컬럼: name / phone / email / birth_date / recent_purchase_date / recent_purchase_amount / total_purchase_amount / purchase_count / grade / points / sms_opt_in / is_active
  2. cdp_event_exists — {"type":"cdp_event_exists","event_name":"<이벤트명>","within_days":<1~365>,"presence":"exists"|"not_exists"}
     · 이벤트명 예: purchase / order / cart_add / page_view / message_click
     · 사용 예: "지난 7일 안 구매 안 한 고객 영역 리마인드 발송" → presence='not_exists'
  3. journey_step_clicked — {"type":"journey_step_clicked","step_order":<옛 step N>,"within_days":<1~365>,"clicked":true|false}
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
  const rawSteps: any[] = Array.isArray(parsed.steps) ? parsed.steps : [];

  // ★ D188 Phase 2-B-1 (2026-05-21): step_type 3종 정합 — message/wait/condition.
  //   AI가 잘못된 step_type 반환 시 'message' default. condition_jsonb 정합 검증 X — activateJourney에서 검증.
  const steps: JourneyStepDefinition[] = rawSteps.slice(0, 7).map((s: any, idx: number) => {
    const stepType: StepType = ['message', 'wait', 'condition'].includes(s.stepType) ? s.stepType : 'message';
    const base: JourneyStepDefinition = {
      stepOrder: idx + 1,
      stepType,
      delayHours: Math.max(0, Math.min(MAX_STEP_DELAY_HOURS, Number(s.delayHours) || 0)),
    };
    if (stepType === 'message') {
      base.channel = ['sms', 'lms', 'mms', 'kakao', 'email'].includes(s.channel) ? s.channel : 'sms';
      base.messageTemplate = String(s.messageTemplate || '').slice(0, 2000);
      base.isAd = s.isAd !== undefined ? !!s.isAd : true;
    } else if (stepType === 'condition') {
      if (s.conditionJsonb && typeof s.conditionJsonb === 'object') {
        base.conditionJsonb = s.conditionJsonb;
      }
    }
    return base;
  });

  if (steps.length === 0) {
    throw new Error('AI가 유효한 step을 생성하지 못했습니다. 목표 문구를 더 명확히 작성해주세요.');
  }

  return steps;
}

// ════════════════════════════════════════════════════════════════════
// 여정 상태 변경
// ════════════════════════════════════════════════════════════════════

export async function activateJourney(companyId: string, journeyId: string, userId: string): Promise<{ ok: boolean; reason?: string }> {
  // 활성화 전 검증 — placeholder 미편집 차단 + 회신번호 필수 + 본문 최소 길이
  // ★ D188 Phase 2-B-1 (2026-05-21): step_type별 다른 검증 분기 — message/wait/condition.
  // ★ D194 (2026-05-22): Liquid 문법 사전 검증 + subject 빈 영역 검증 추가 (직원 테스트 발송 사고 0건 영구 안전망)
  const detail = await query(
    `SELECT j.callback_number, j.status, j.start_kind, j.anchor_date,
            (SELECT json_agg(json_build_object(
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

  // ★ 2026-06-30 여정 일반화 — date_anchor/one_shot 시작 방식 검증.
  const startKind = normalizeStartKind(row.start_kind);
  if (startKind === 'date_anchor') {
    if (!row.anchor_date) {
      return { ok: false, reason: '날짜축 여정은 기준 날짜(anchor_date)가 필요합니다. 빌더에서 기준 날짜를 지정해주세요.' };
    }
    const msgSteps = steps.filter((s: any) => String(s.type || 'message') === 'message');
    for (const s of msgSteps) {
      if (s.anchorOffset == null || Number.isNaN(Number(s.anchorOffset)) || Number(s.anchorOffset) < 0) {
        return { ok: false, reason: `날짜축 step ${s.order}에 D-N(anchor_offset_days)이 비어있습니다. 며칠 전에 보낼지 지정해주세요.` };
      }
    }
  }
  if (startKind === 'one_shot') {
    const msgSteps = steps.filter((s: any) => String(s.type || 'message') === 'message');
    if (msgSteps.length !== 1) {
      return { ok: false, reason: '1회 발송(one_shot) 여정은 발송 step이 정확히 1개여야 합니다.' };
    }
  }
  for (const s of steps) {
    const stepType = String(s.type || 'message');

    // ★ D188 Phase 2-B-1: step_type별 검증 분기
    // ★ D210+ Phase 3 (2026-05-23 Harold 명시): wait step delay_mode 영역 검증 추가
    if (stepType === 'wait') {
      const delayMode = String(s.delayMode || 'relative');
      // ★ Fix #10 (2026-06-05): relative_at_hour 추가 — 다른 경로(타입·생성·calculateNextRunAt)는 다 지원하는데 wait 검증만 빠져 거부되던 문제.
      const validDelayModes = ['relative', 'relative_at_hour', 'specific_hour', 'next_business_day'];
      if (!validDelayModes.includes(delayMode)) {
        return { ok: false, reason: `step ${s.order} (wait) delay_mode = ${validDelayModes.join(' / ')} 중 하나 의무.` };
      }

      if (delayMode === 'relative') {
        // relative = delay_hours > 0 필수 (의미 있는 대기)
        const delay = Number(s.delay || 0);
        if (delay <= 0) {
          return { ok: false, reason: `step ${s.order} (wait relative) 대기 시간이 0 이하입니다. 1시간 이상 설정해주세요.` };
        }
      } else if (delayMode === 'specific_hour' || delayMode === 'relative_at_hour') {
        // specific_hour / relative_at_hour = target_hour_kst (0~23) 의무
        const targetHour = Number(s.targetHourKst);
        if (!Number.isFinite(targetHour) || targetHour < 0 || targetHour > 23) {
          return { ok: false, reason: `step ${s.order} (wait ${delayMode}) target_hour_kst = 0~23 의무.` };
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
        return { ok: false, reason: `step ${s.order} (condition) condition_jsonb 미설정. 조건을 작성해주세요.` };
      }
      const condType = String((cond as any).type || '');
      const validTypes = ['customer_field', 'cdp_event_exists', 'journey_step_clicked'];
      if (!validTypes.includes(condType)) {
        return { ok: false, reason: `step ${s.order} (condition) type은 ${validTypes.join(' / ')} 중 하나여야 합니다.` };
      }

      // type 1: customer_field — 옛 매트릭스 (field + operator + value 영역)
      if (condType === 'customer_field') {
        const condField = String((cond as any).field || '');
        const condOperator = String((cond as any).operator || '');
        if (!condField.trim()) {
          return { ok: false, reason: `step ${s.order} (condition customer_field) 조건 필드명이 비어있습니다.` };
        }
        const validOps = ['==', '!=', '>=', '<=', '>', '<', 'in', 'not_in', 'is_null', 'not_null'];
        if (!validOps.includes(condOperator)) {
          return { ok: false, reason: `step ${s.order} (condition customer_field) operator는 ${validOps.join('/')} 중 하나여야 합니다.` };
        }
        // is_null / not_null은 value 불요, 그 외는 value 필수
        if (!['is_null', 'not_null'].includes(condOperator) && (cond as any).value === undefined) {
          return { ok: false, reason: `step ${s.order} (condition customer_field) value가 비어있습니다.` };
        }
      }

      // type 2: cdp_event_exists — event_name + within_days + presence 영역
      if (condType === 'cdp_event_exists') {
        const eventName = String((cond as any).event_name || '').trim();
        const withinDays = Number((cond as any).within_days);
        const presence = String((cond as any).presence || 'exists');
        if (!eventName) {
          return { ok: false, reason: `step ${s.order} (condition cdp_event_exists) event_name 영역 필수입니다.` };
        }
        if (!Number.isFinite(withinDays) || withinDays < 1 || withinDays > 365) {
          return { ok: false, reason: `step ${s.order} (condition cdp_event_exists) within_days = 1~365 범위 의무.` };
        }
        if (!['exists', 'not_exists'].includes(presence)) {
          return { ok: false, reason: `step ${s.order} (condition cdp_event_exists) presence = 'exists' / 'not_exists' 의무.` };
        }
      }

      // type 3: journey_step_clicked — step_order + within_days + clicked 영역
      if (condType === 'journey_step_clicked') {
        const stepOrderTarget = Number((cond as any).step_order);
        const withinDays = Number((cond as any).within_days);
        const clicked = (cond as any).clicked;
        if (!Number.isFinite(stepOrderTarget) || stepOrderTarget < 1) {
          return { ok: false, reason: `step ${s.order} (condition journey_step_clicked) step_order 영역 필수 (1+).` };
        }
        if (stepOrderTarget >= s.order) {
          return { ok: false, reason: `step ${s.order} (condition journey_step_clicked) step_order = 옛 step만 참조 가능 (현재 ${s.order} > ${stepOrderTarget} 영역 의무).` };
        }
        if (!Number.isFinite(withinDays) || withinDays < 1 || withinDays > 365) {
          return { ok: false, reason: `step ${s.order} (condition journey_step_clicked) within_days = 1~365 범위 의무.` };
        }
        if (typeof clicked !== 'boolean') {
          return { ok: false, reason: `step ${s.order} (condition journey_step_clicked) clicked 영역 = true / false 의무.` };
        }
      }

      continue; // condition step은 본문 검증 skip
    }

    // message step = 본문 길이 + placeholder 검증 (기존 매트릭스)
    const msg = String(s.message || '').trim();
    if (!msg || msg.length < 10) {
      return { ok: false, reason: `step ${s.order} 본문이 너무 짧습니다 (최소 10자).` };
    }
    if (hasUneditedPlaceholder(msg)) {
      return { ok: false, reason: `step ${s.order} 본문에 미편집 [...] 영역이 남아있습니다. 회사 admin이 직접 작성해주세요.` };
    }

    // ★ D194 (2026-05-22) 강화: subject 빈 영역 차단 — LMS/MMS 채널은 제목 필수
    const channel = String(s.channel || 'lms');
    if (channel === 'lms' || channel === 'mms') {
      const subj = String(s.subject || '').trim();
      if (!subj) {
        return { ok: false, reason: `step ${s.order} (${channel.toUpperCase()}) 제목이 비어있습니다. 본문 요약 단순 텍스트 한 줄로 작성해주세요.` };
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
        return { ok: false, reason: `step ${s.order} (알림톡) ${violation}` };
      }
    }

    // ★ D194 (2026-05-22) 강화: Liquid 문법 사전 검증 — 잘못된 문법 발견 시 차단 (발송 시점 매번 실패 영구 방지)
    try {
      const { detectLiquidSyntax, validateLiquidTemplate } = await import('./liquid-templating');
      if (detectLiquidSyntax(msg)) {
        const valid = validateLiquidTemplate(msg);
        if (!valid.valid) {
          const errMsg = valid.errors.map((e) => e.message).join(' / ');
          return { ok: false, reason: `step ${s.order} Liquid 문법 오류 — ${errMsg}. 미리보기 모달에서 문법 확인 후 재시도해주세요.` };
        }
      }
    } catch (err: any) {
      console.warn('[activateJourney] Liquid 문법 검증 오류 (skip):', err?.message);
    }
  }

  const r = await query(
    `UPDATE journeys SET
      status = 'active',
      approved_by = $3::uuid,
      approved_at = NOW(),
      paused_at = NULL,
      pause_reason = NULL,
      updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('draft', 'paused')
     RETURNING id`,
    [journeyId, companyId, userId]
  );

  // 활성화 종결 직후 = step snapshot 보존 (활성화 시점 본문 = 발송 시점 본문 동일 보장).
  //   발송 2시간 전 스팸테스트·담당자 안내는 journey-pretest-notifier 스캐너가 실제 next_run_at 기준으로 처리(Phase 6B).
  if (r.rows.length > 0) {
    try {
      await createJourneyStepSnapshots(companyId, journeyId);
    } catch (err: any) {
      console.warn('[activateJourney] snapshot 생성 실패 (skip):', err?.message);
    }
    // ★ Phase 2: 신규가입(customer.created) 여정 첫 활성화 시 진입 원장 baseline 적재.
    //   그 시점 회사 전체 고객 식별자(회사+매장코드+전화번호)를 'baseline'으로 1회 → 이후 원장에 없는 식별자만 신규.
    try {
      const jrow = await query(
        `SELECT trigger_event, entry_baseline_at FROM journeys WHERE id = $1::uuid`,
        [journeyId],
      );
      if (jrow.rows[0]?.trigger_event === 'customer.created' && !jrow.rows[0]?.entry_baseline_at) {
        const { seeded } = await seedBaselineForJourney(journeyId, companyId);
        console.log(`[activateJourney] 진입 원장 baseline 적재 journey=${journeyId} seeded=${seeded}`);
      }
    } catch (e: any) {
      console.warn('[activateJourney] 진입 원장 baseline 적재 실패:', e?.message);
    }
    // ★ Phase 3: cdp 구매·예약 여정 첫 활성화 시 이벤트 커서=NOW (과거 이벤트 소급 발송 0).
    try {
      await query(
        `UPDATE journeys SET last_event_cursor = NOW()
          WHERE id = $1::uuid
            AND trigger_event IN ('cdp.purchase', 'cdp.reservation_created')
            AND last_event_cursor IS NULL`,
        [journeyId],
      );
    } catch (e: any) {
      console.warn('[activateJourney] cdp 이벤트 커서 초기화 실패:', e?.message);
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
  // 회사 격리 + 활성 상태 게이트
  const j = await query(
    `SELECT status FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
    [journeyId, companyId]
  );
  if (j.rows.length === 0) return false;
  const isActive = j.rows[0].status === 'active';
  if (isActive) {
    const structuralKeys: Array<keyof typeof patch> = [
      'channel', 'delayHours', 'isAd', 'stepType', 'conditionJsonb',
      'alimtalkProfileId', 'alimtalkTemplateCode', 'alimtalkVariableMap',
      'alimtalkNextType', 'alimtalkNextContents', 'alimtalkNextSubject',
      'mmsImagePaths', 'delayMode', 'targetHourKst',
    ];
    const touchesStructure = structuralKeys.some((k) => patch[k] !== undefined);
    const touchesMessage = patch.messageTemplate !== undefined || patch.subject !== undefined;
    if (!patch.allowActiveMessageEdit || touchesStructure || !touchesMessage) {
      throw new Error('활성 상태 여정은 문안(본문·제목)만 수정할 수 있습니다. 구조·일정 변경은 먼저 일시정지해주세요.');
    }
  }

  // ★ D188 Phase 2-B-1: step_type 변경 시 conditionJsonb 정합 검증 (condition은 conditionJsonb 필수).
  if (patch.stepType === 'condition' && (!patch.conditionJsonb || typeof patch.conditionJsonb !== 'object')) {
    throw new Error('condition step은 conditionJsonb가 필수입니다.');
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

  const r = await query(
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
      patch.subject !== undefined ? patch.subject.slice(0, 50) : null,
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
  // ★ Fix #4 (2026-06-05): step 편집 시 발송 전 검증 마커 무효화 — 편집 후 재검증해야 활성화 가능.
  if (r.rows.length > 0) {
    await query(`UPDATE journeys SET last_pretest_passed_at = NULL WHERE id = $1::uuid`, [journeyId]);
  }

  // ★ 2026-07-11 활성 중 문안 수정 — 발송은 최신 snapshot을 소비(D218 ORDER BY created_at DESC)하므로
  //   새 snapshot을 만들어야 수정 본문이 실제 발송에 반영된다. 함께 이 step의 pretest dedup을 지워
  //   발송 2시간 전 자동 스팸 재검사(scanAndPretest)가 새 본문을 다시 검사하게 강제한다(기존 파이프라인 재사용).
  //   snapshot 실패 = throw(문안만 바뀌고 발송은 옛 본문인 어긋남을 사용자에게 즉시 알림).
  if (isActive && r.rows.length > 0) {
    const s = await query(
      `SELECT s.channel, s.is_ad, s.message_template, s.subject,
              s.alimtalk_variable_map, s.alimtalk_template_code, j.callback_number
         FROM journey_steps s JOIN journeys j ON j.id = s.journey_id
        WHERE s.id = $1::uuid AND s.journey_id = $2::uuid`,
      [stepId, journeyId]
    );
    if (s.rows.length > 0) {
      const row = s.rows[0];
      await query(
        `INSERT INTO journey_step_snapshots
           (company_id, journey_id, step_id, variant_id, message_body, message_subject,
            variable_map, channel, is_ad, callback_number, alimtalk_template_code, confidence_score)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, 100)`,
        [
          companyId, journeyId, stepId,
          row.message_template, row.subject,
          row.alimtalk_variable_map || {}, row.channel, row.is_ad,
          row.callback_number, row.alimtalk_template_code,
        ]
      );
    }
    await query(
      `DELETE FROM journey_pretest_schedules WHERE journey_id = $1::uuid AND step_id = $2::uuid`,
      [journeyId, stepId]
    ).catch((e: any) => console.log(`[JourneyBuilder] pretest dedup 리셋 skip: ${e?.message || e}`));
  }
  return r.rows.length > 0;
}

// 여정 callback_number 갱신
export async function updateJourneyCallback(companyId: string, journeyId: string, callbackNumber: string): Promise<boolean> {
  if (!callbackNumber || !callbackNumber.trim()) return false;
  const r = await query(
    `UPDATE journeys SET callback_number = $3, updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status != 'active'
     RETURNING id`,
    [journeyId, companyId, callbackNumber.trim().slice(0, 20)]
  );
  return r.rows.length > 0;
}

export async function pauseJourney(companyId: string, journeyId: string, reason?: string): Promise<boolean> {
  const r = await query(
    `UPDATE journeys SET
      status = 'paused',
      paused_at = NOW(),
      pause_reason = $3,
      updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'active'
     RETURNING id`,
    [journeyId, companyId, reason || null]
  );
  // ★ Fix #5 (2026-06-05): 기존 'pending'/'scheduled' 일괄 UPDATE는 execution에 존재하지 않는 상태값이라 0건(무효)이었다.
  //   개별 execution을 paused로 바꾸면 재개 시 balance/단축URL 정지분과 섞여 복구가 꼬인다 → 무효 UPDATE 제거.
  //   여정 정지 즉시 반영은 executor 발송 직전 status 재확인이 journey.status까지 보게 강화해 처리(레이스 차단).
  return r.rows.length > 0;
}

export async function endJourney(companyId: string, journeyId: string): Promise<boolean> {
  const r = await query(
    `UPDATE journeys SET status = 'ended', updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status != 'ended'
     RETURNING id`,
    [journeyId, companyId]
  );
  return r.rows.length > 0;
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
    return { ok: false, reason: '활성 여정은 영구 삭제 X — 먼저 일시정지 또는 종료해주세요.' };
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

export async function listJourneys(companyId: string, status?: JourneyStatus | 'all' | 'archived') {
  // ★ Fix #3 (2026-06-05): status는 라우트가 받은 신뢰 불가 값(타입 캐스팅은 런타임 보장 X) →
  //   화이트리스트 CT로 검증해 SQL 주입을 차단한다. archived 분리 + 허용 상태만 보간.
  const where = journeyListWhere(status);
  // ★ 2026-07-10 goal_met_count — 목표 달성 종료(진입 이후 구매 확인) 카드 뱃지용. 회사당 여정 수가 작아 서브쿼리 COUNT 부담 미미.
  // ★ 2026-07-11 holdout_count — 홀드아웃 대조군(미발송) 카드 뱃지용. status 값만 신규(컬럼 신규 아님 — DDL 무관 안전).
  const r = await query(
    `SELECT j.*,
            (SELECT COUNT(*)::int FROM journey_executions e WHERE e.journey_id = j.id AND e.status = 'goal_met') AS goal_met_count,
            (SELECT COUNT(*)::int FROM journey_executions e WHERE e.journey_id = j.id AND e.status = 'holdout') AS holdout_count
     FROM journeys j
     WHERE j.company_id = $1::uuid ${where}
     ORDER BY j.status ASC, j.created_at DESC`,
    [companyId]
  );
  return r.rows;
}

export async function getJourneyDetail(companyId: string, journeyId: string) {
  const j = await query(
    `SELECT * FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
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
  return { journey: j.rows[0], steps: stepsWithLabels };
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
