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

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type JourneyTemplateCode =
  | 'onboarding'
  | 'repeat'
  | 'dormant'
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
  // ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 (channel='kakao') 영역 — sms-queue insertAlimtalkQueue 정합.
  alimtalkProfileId?: string;
  alimtalkTemplateCode?: string;
  alimtalkVariableMap?: Record<string, string>;       // #{name} → 실제값 또는 @@필드키@@
  alimtalkNextType?: 'N' | 'S' | 'L' | 'A' | 'B';     // 부달 발송 정책
  alimtalkNextContents?: string;                      // A/B 시 대체 문구
  alimtalkNextSubject?: string;                       // L/B 시 LMS 대체 제목
  // ★ D188 Phase 2-B-2 (2026-05-21): MMS (channel='mms') 영역 — 이미지 서버 경로 배열.
  mmsImagePaths?: string[];
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
  steps?: JourneyStepDefinition[];
  thresholdRecipients?: number | null;
  thresholdCost?: number | null;
  thresholdRiskLevel?: 'low' | 'medium' | 'high';
  budgetMonthly?: number | null;
  allowReentry?: boolean;
  reentryCooldownDays?: number | null;
}

const PLACEHOLDER_MARKERS = ['[', ']'];

export function hasUneditedPlaceholder(message: string | null | undefined): boolean {
  if (!message) return true;
  return PLACEHOLDER_MARKERS.every((m) => message.includes(m));
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
        delayHours: Math.max(0, Math.min(720, Number(s.delayHours) || 0)),
        channel,
        messageTemplate: (s.messageTemplate || '').slice(0, 2000),
        subject: channel === 'sms' ? '' : (s.subject || '').slice(0, 50),
        isAd: s.isAd !== undefined ? !!s.isAd : true,
        conditionJsonb: s.conditionJsonb,
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

  const journeyRes = await query(
    `INSERT INTO journeys (
      id, company_id, name, template_code, trigger_event, trigger_filters,
      status, budget_monthly, allow_reentry, reentry_cooldown_days,
      threshold_recipients_per_step, threshold_cost_per_step, threshold_risk_level,
      callback_number,
      created_by, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2, $3, $4, $5::jsonb,
      'draft', $6, $7, $8,
      $9, $10, $11,
      $12,
      $13::uuid, NOW(), NOW()
    ) RETURNING id`,
    [
      input.companyId,
      journeyName.slice(0, 100),
      tmpl.templateCode,
      tmpl.triggerEvent,
      JSON.stringify(tmpl.triggerFilters),
      input.budgetMonthly ?? null,
      allowReentry,
      reentryCooldownDays,
      input.thresholdRecipients ?? null,
      input.thresholdCost ?? null,
      input.thresholdRiskLevel || 'low',
      input.callbackNumber.trim().slice(0, 20),
      input.createdBy,
    ]
  );

  const journeyId = journeyRes.rows[0].id as string;

  // ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 + MMS 컬럼 7건 추가 (DB ALTER 정합).
  for (const step of steps) {
    await query(
      `INSERT INTO journey_steps (
        id, journey_id, step_order, step_type, delay_hours, channel, message_template, subject, is_ad, condition_jsonb,
        alimtalk_profile_id, alimtalk_template_code, alimtalk_variable_map,
        alimtalk_next_type, alimtalk_next_contents, alimtalk_next_subject,
        mms_image_paths, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
        $10::uuid, $11, $12::jsonb,
        $13, $14, $15,
        $16::text[], NOW()
      )`,
      [
        journeyId,
        step.stepOrder,
        step.stepType,
        step.delayHours,
        step.channel || null,
        step.messageTemplate || null,
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
      ]
    );
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
- conditionJsonb (condition step만): {"type":"customer_field","field":"<컬럼명>","operator":"==|!=|>=|<=|>|<|in|not_in|is_null|not_null","value":<값>}
  지원 컬럼: name / phone / email / birth_date / recent_purchase_date / recent_purchase_amount / total_purchase_amount / purchase_count / grade / points / sms_opt_in / is_active

언제 wait/condition 사용:
- wait: 메시지 발송 후 충분한 시간 대기가 의미 있는 영역 (예: 후기 요청 전 충분한 사용 시간)
- condition: 고객 분기가 필요한 영역 (예: VIP 등급만 받을 step, 구매 금액 임계값 초과 고객만 진입)

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
      delayHours: Math.max(0, Math.min(720, Number(s.delayHours) || 0)),
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
    `SELECT j.callback_number, j.status,
            (SELECT json_agg(json_build_object(
              'order', step_order,
              'type', step_type,
              'message', message_template,
              'subject', subject,
              'channel', channel,
              'delay', delay_hours,
              'condition', condition_jsonb
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
  for (const s of steps) {
    const stepType = String(s.type || 'message');

    // ★ D188 Phase 2-B-1: step_type별 검증 분기
    if (stepType === 'wait') {
      // wait step = delay_hours > 0 필수 (의미 있는 대기 영역)
      const delay = Number(s.delay || 0);
      if (delay <= 0) {
        return { ok: false, reason: `step ${s.order} (wait) 대기 시간이 0 이하입니다. 1시간 이상 설정해주세요.` };
      }
      continue; // wait step은 본문 검증 skip
    }

    if (stepType === 'condition') {
      // condition step = conditionJsonb 정합 검증 (type + field + operator 필수)
      const cond = s.condition;
      if (!cond || typeof cond !== 'object') {
        return { ok: false, reason: `step ${s.order} (condition) condition_jsonb 미설정. 조건을 작성해주세요.` };
      }
      const condType = String((cond as any).type || '');
      const condField = String((cond as any).field || '');
      const condOperator = String((cond as any).operator || '');
      if (condType !== 'customer_field') {
        return { ok: false, reason: `step ${s.order} (condition) type은 'customer_field'만 지원합니다.` };
      }
      if (!condField.trim()) {
        return { ok: false, reason: `step ${s.order} (condition) 조건 필드명이 비어있습니다.` };
      }
      const validOps = ['==', '!=', '>=', '<=', '>', '<', 'in', 'not_in', 'is_null', 'not_null'];
      if (!validOps.includes(condOperator)) {
        return { ok: false, reason: `step ${s.order} (condition) operator는 ${validOps.join('/')} 중 하나여야 합니다.` };
      }
      // is_null / not_null은 value 불요, 그 외는 value 필수
      if (!['is_null', 'not_null'].includes(condOperator) && (cond as any).value === undefined) {
        return { ok: false, reason: `step ${s.order} (condition) value가 비어있습니다.` };
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
  return { ok: r.rows.length > 0 };
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
  }
): Promise<boolean> {
  // 회사 격리 + 활성 상태에서는 step 수정 차단
  const j = await query(
    `SELECT status FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
    [journeyId, companyId]
  );
  if (j.rows.length === 0) return false;
  if (j.rows[0].status === 'active') {
    throw new Error('활성 상태 여정의 step은 수정할 수 없습니다. 먼저 일시정지해주세요.');
  }

  // ★ D188 Phase 2-B-1: step_type 변경 시 conditionJsonb 정합 검증 (condition은 conditionJsonb 필수).
  if (patch.stepType === 'condition' && (!patch.conditionJsonb || typeof patch.conditionJsonb !== 'object')) {
    throw new Error('condition step은 conditionJsonb가 필수입니다.');
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
       mms_image_paths = COALESCE($17::text[], mms_image_paths)
     WHERE id = $1::uuid AND journey_id = $2::uuid
     RETURNING id`,
    [
      stepId,
      journeyId,
      companyId,
      patch.messageTemplate?.slice(0, 2000) ?? null,
      patch.channel ?? null,
      patch.delayHours != null ? Math.max(0, Math.min(720, Number(patch.delayHours))) : null,
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
    ]
  );
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
// 조회
// ════════════════════════════════════════════════════════════════════

export async function listJourneys(companyId: string, status?: JourneyStatus | 'all') {
  const where = status && status !== 'all' ? `AND status = '${status}'` : '';
  const r = await query(
    `SELECT * FROM journeys
     WHERE company_id = $1::uuid ${where}
     ORDER BY status ASC, created_at DESC`,
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
  return { journey: j.rows[0], steps: steps.rows };
}

export async function listExecutions(
  companyId: string,
  journeyId: string,
  opts: { limit?: number; offset?: number; status?: string } = {}
) {
  const statusFilter = opts.status ? `AND e.status = '${opts.status}'` : '';
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
