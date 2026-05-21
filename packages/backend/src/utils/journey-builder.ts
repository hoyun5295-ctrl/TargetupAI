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
  conditionJsonb?: Record<string, unknown>;
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
  thresholdRecipients?: number | null;
  thresholdCost?: number | null;
  thresholdRiskLevel?: 'low' | 'medium' | 'high';
  budgetMonthly?: number | null;
  allowReentry?: boolean;
  reentryCooldownDays?: number | null;
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
    description: '24시간 안 가입한 신규 고객 환영 + 사용법 안내 + 첫 혜택 + 첫 구매 유도',
    triggerEvent: 'customer.created',
    triggerFilters: { recent_hours: 24 },
    allowReentry: false,
    reentryCooldownDays: null,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'sms', messageTemplate: '%고객명%님, 가입을 환영합니다. 즐거운 시간 보내세요.' },
      { stepOrder: 2, stepType: 'message', delayHours: 24, channel: 'sms', messageTemplate: '%고객명%님, 어제 가입하셨네요. 첫 사용을 도와드릴게요.' },
      { stepOrder: 3, stepType: 'message', delayHours: 72, channel: 'lms', messageTemplate: '%고객명%님, 첫 구매 한정 혜택을 준비했습니다.' },
      { stepOrder: 4, stepType: 'message', delayHours: 168, channel: 'sms', messageTemplate: '%고객명%님, 일주일 동안 함께해 주셔서 감사합니다.' },
    ],
  },
  repeat: {
    templateCode: 'repeat',
    name: '재구매 유도',
    description: '구매 직후 후기 → 7일 관련 상품 → 30일 재구매 쿠폰',
    triggerEvent: 'cdp.purchase',
    triggerFilters: {},
    allowReentry: true,
    reentryCooldownDays: 0,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 168, channel: 'sms', messageTemplate: '%고객명%님, 구매하신 상품은 만족스러우셨나요? 후기를 남겨주세요.' },
      { stepOrder: 2, stepType: 'message', delayHours: 336, channel: 'lms', messageTemplate: '%고객명%님께 어울리는 상품을 추천해 드립니다.' },
      { stepOrder: 3, stepType: 'message', delayHours: 720, channel: 'lms', messageTemplate: '%고객명%님, 재구매 한정 쿠폰을 보내드립니다.' },
    ],
  },
  dormant: {
    templateCode: 'dormant',
    name: '휴면 회수',
    description: '최근 구매 30일 이상 휴면 고객 안부 + 특별 혜택 + 마지막 제안',
    triggerEvent: 'customer.dormant',
    triggerFilters: { dormant_days: 30 },
    allowReentry: true,
    reentryCooldownDays: 90,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'sms', messageTemplate: '%고객명%님, 오랜만에 인사 드립니다. 잘 지내셨나요?' },
      { stepOrder: 2, stepType: 'message', delayHours: 168, channel: 'lms', messageTemplate: '%고객명%님, 다시 찾아주시면 특별 혜택을 드립니다.' },
      { stepOrder: 3, stepType: 'message', delayHours: 336, channel: 'lms', messageTemplate: '%고객명%님께 마지막 제안 드립니다. 한 번 더 둘러보세요.' },
    ],
  },
  cart: {
    templateCode: 'cart',
    name: '장바구니 포기',
    description: '장바구니 담은 후 24시간 안 결제 시작 없음 시 알림 + 리마인더 + 할인 쿠폰',
    triggerEvent: 'cdp.cart_abandon',
    triggerFilters: { abandon_hours: 24 },
    allowReentry: true,
    reentryCooldownDays: 7,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'sms', messageTemplate: '%고객명%님, 장바구니에 담아두신 상품이 기다리고 있어요.' },
      { stepOrder: 2, stepType: 'message', delayHours: 24, channel: 'sms', messageTemplate: '%고객명%님, 인기 상품이 곧 품절될 수 있어요.' },
      { stepOrder: 3, stepType: 'message', delayHours: 72, channel: 'lms', messageTemplate: '%고객명%님께만 드리는 할인 쿠폰을 보내드립니다.' },
    ],
  },
  birthday: {
    templateCode: 'birthday',
    name: '생일 축하',
    description: 'D-7 사전 안내 + D-Day 축하 쿠폰',
    triggerEvent: 'customer.birthday_approaching',
    triggerFilters: { days_before: 7 },
    allowReentry: true,
    reentryCooldownDays: 365,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'sms', messageTemplate: '%고객명%님, 곧 생일이시네요. 7일 후 특별 선물을 준비하고 있어요.' },
      { stepOrder: 2, stepType: 'message', delayHours: 168, channel: 'lms', messageTemplate: '%고객명%님, 생일 축하드립니다. 오늘 한정 쿠폰을 보내드려요.' },
    ],
  },
  reservation: {
    templateCode: 'reservation',
    name: '예약 알림',
    description: 'D-3 사전 + D-Day 당일 + D+1 후기',
    triggerEvent: 'cdp.reservation_created',
    triggerFilters: {},
    allowReentry: true,
    reentryCooldownDays: 0,
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'sms', messageTemplate: '%고객명%님, 예약이 3일 후로 잡혔습니다. 잊지 마세요.' },
      { stepOrder: 2, stepType: 'message', delayHours: 72, channel: 'sms', messageTemplate: '%고객명%님, 오늘 예약 시간을 안내드립니다.' },
      { stepOrder: 3, stepType: 'message', delayHours: 96, channel: 'lms', messageTemplate: '%고객명%님, 어제 방문해 주셔서 감사합니다. 어떠셨나요?' },
    ],
  },
  custom: {
    templateCode: 'custom',
    name: 'Custom (자연어 진입)',
    description: '회사 admin이 자연어로 입력 → AI가 자동 step 생성',
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
  if (input.templateCode === 'custom' && !input.customObjective) {
    throw new Error('Custom 여정은 customObjective 자연어가 필요합니다.');
  }

  const ctx = await loadCompanyContext(input.companyId);

  let steps: JourneyStepDefinition[] = tmpl.steps;
  if (input.templateCode === 'custom' && input.customObjective) {
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
      created_by, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2, $3, $4, $5::jsonb,
      'draft', $6, $7, $8,
      $9, $10, $11,
      $12::uuid, NOW(), NOW()
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
      input.createdBy,
    ]
  );

  const journeyId = journeyRes.rows[0].id as string;

  for (const step of steps) {
    await query(
      `INSERT INTO journey_steps (
        id, journey_id, step_order, step_type, delay_hours, channel, message_template, condition_jsonb, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, $7::jsonb, NOW()
      )`,
      [
        journeyId,
        step.stepOrder,
        step.stepType,
        step.delayHours,
        step.channel || null,
        step.messageTemplate || null,
        step.conditionJsonb ? JSON.stringify(step.conditionJsonb) : null,
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
// Custom 여정 — Opus 4.7 자연어 진입
// ════════════════════════════════════════════════════════════════════

async function generateCustomStepsWithAI(
  companyId: string,
  objective: string,
  ctx: CompanyContext
): Promise<JourneyStepDefinition[]> {
  const memoryContext = await buildMemoryPromptContext(companyId, 20).catch(() => '');

  const system = `당신은 한국 마케팅 자동화 여정 설계 전문가입니다.
회사 admin이 자연어로 입력한 여정 목표를 받아, 2~5개의 step (메시지 발송 시계열)을 JSON으로 응답합니다.

규칙:
- 각 step은 message 타입만 사용 (wait/condition은 다음 영역에서 다룹니다)
- delayHours: 0(즉시) ~ 720h(30일) 범위. 24/48/72/168 등 자연 단위 권장
- channel: 'sms'(90자 내), 'lms'(2000자), 'kakao'(알림톡)
- messageTemplate: %고객명%, %상품명%, %혜택% 등 변수 활용
- 메시지에 (광고) 표기 없음 (시스템 자동 처리)
- 한국 정보통신망법 + 통신사 스팸 정책 정합

회사 컨텍스트:
- 회사명: ${ctx.companyName}
- 브랜드명: ${ctx.brandName || '(미설정)'}
- 톤앤매너: ${ctx.brandTone || '친근함'}
- 업종: ${ctx.businessType || '(미설정)'}

${memoryContext}

JSON 형식만 응답:
{
  "steps": [
    { "stepOrder": 1, "stepType": "message", "delayHours": 0, "channel": "sms", "messageTemplate": "..." }
  ]
}`;

  const userMessage = `여정 목표: ${objective}\n\n위 회사 컨텍스트와 메모리를 활용해 2~5개의 step JSON을 응답하세요.`;

  const text = await callAIWithFallback({
    system,
    userMessage,
    maxTokens: 1024,
    temperature: 0.2,
    model: 'opus',
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

  const steps: JourneyStepDefinition[] = rawSteps.slice(0, 5).map((s: any, idx: number) => ({
    stepOrder: idx + 1,
    stepType: 'message',
    delayHours: Math.max(0, Math.min(720, Number(s.delayHours) || 0)),
    channel: ['sms', 'lms', 'mms', 'kakao', 'email'].includes(s.channel) ? s.channel : 'sms',
    messageTemplate: String(s.messageTemplate || '').slice(0, 2000),
  }));

  if (steps.length === 0) {
    throw new Error('AI가 유효한 step을 생성하지 못했습니다. 목표 문구를 더 명확히 작성해주세요.');
  }

  return steps;
}

// ════════════════════════════════════════════════════════════════════
// 여정 상태 변경
// ════════════════════════════════════════════════════════════════════

export async function activateJourney(companyId: string, journeyId: string, userId: string): Promise<boolean> {
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
