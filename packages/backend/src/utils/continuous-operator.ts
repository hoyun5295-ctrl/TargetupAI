/**
 * ★ CT-28: Continuous Agentic Operator 컨트롤타워 — D176 (2026-05-19)
 *
 * 🎯 목적
 *   한줄로 BEYOND BRAZE 비전 압축 로드맵 1순위 — "AI가 매일 회고 + 제안서 생성 / 실행은 사용자 동의 후".
 *   - 회사 admin이 자연어 한 줄로 영구 운영 목표 등록 ("VIP 재구매 영구 운영")
 *   - 매일 09:00 KST worker가 활성 Operator의 제안서 생성
 *   - 사용자가 받은 제안서 일괄 승인 / 개별 승인 / 거부
 *   - ENT 자동 실행 옵션 활성 + 임계값 통과 시에만 AI가 자동 실행 (default OFF)
 *
 * ⛔ 영구 원칙 (Harold 명시 100% 정합)
 *   - AI는 의견을 낼 뿐, 실행은 항상 사용자 동의 후
 *   - 자동 실행은 default OFF (ENT 명시 ON + 1,000건/5만원/low risk 임계값 통과 시만)
 *   - 자동 실행 시에도 회사 admin에게 즉시 SMS/이메일 알림 (사후 통지)
 *   - 타겟 매칭 0건이면 제안서 생성 안 함 (Zero-Count 영구 원칙)
 *   - 7일 후 미응답 제안서는 expired 처리 (방치 차단)
 *
 * 📊 사용 흐름
 *   1. 사용자: createOperator(companyId, name, objective) → DB INSERT
 *   2. Worker: 매일 09:00 KST → listActiveOperators() → 각 Operator에 대해 generateProposal()
 *   3. AI: orchestrate() 호출하여 OrchestratorResult 생성 → operator_proposals INSERT
 *   4. Auto-eligible은 'scheduled'(준비+lead 뒤 자율 발송) / 그 외 status='pending'(수동 검토)
 *   5. 사용자: GET /api/ai/operator/proposals → 대기 중인 제안서 목록 조회
 *   6. 사용자: POST /api/ai/operator/proposals/:id/approve → 승인 + 즉시 발송 → status='sent'
 *   7. 사용자: POST /api/ai/operator/proposals/:id/reject → 거부 → status='rejected'
 */

import { query } from '../config/database';
import { orchestrate } from '../services/ai-orchestrator';
import { getCompanyCosts } from '../config/defaults';
import { shouldSkipProposalGeneration } from './operator-proposal-dedup';
// ★ D177 (2026-05-19): Self-Optimizing Bandit — message variants 생성 + Thompson Sampling
import { insertProposalVariants, recommendVariantForProposal, recordVariantReward } from './bandit-optimizer';
// ★ D212+ 정책 (2026-05-23 Harold 명시): CT-64 영역 통합 — 검증 영역 + 담당자 학습
// ★ D227+ 스팸 안전망 격상 — decideSpamOutcome(실제 테스트 결과 → 상태) + buildSpamRegeneratePrompt(AI 재작성)
import { recordAdminStopLearning, decideSpamOutcome, buildSpamRegeneratePrompt } from './continuous-operator-policy';
import { resolveAutoSendLeadMinutes, computeScheduledSendAt, decideSendOutcome, decideStuckSendingRecovery, decideBudgetGuard, buildAutoSendPrepInfoBody, buildPendingReviewNoticeBody, computeNextOccurrence, computeNextGenerationRun, normalizeSendTimeMode, SendTimeMode, normalizeCopyStyle, buildCopyStylePromptBlock, CopyStyle, wrapOperatorNoticeBody } from './autosend-policy';
import { getOpt080Number } from './messageUtils';
// ★ D227+ 검증된 스팸 자산 재사용 (auto-campaign-worker와 동일 패턴) — 실제 테스트폰 발송 + AI 재생성 + 재테스트
import { autoSpamTestWithRegenerate } from './spam-test-queue';
import { generateMessages } from '../services/ai';
// ★ D227+ 종량제: AI 사이클 크레딧 부족 감지 + 담당자 무과금 알림(인증 라인 재사용)
import { InsufficientCreditError, checkCredit, deductCreditSafe } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { runInCreditBundle } from './ai-credit-context';
import { getAuthSmsTable, bulkInsertSmsQueue } from './sms-queue';
import { randomUUID } from 'crypto';
import { buildFilterWhereClauseCompat } from './customer-filter';
import { buildSendableStagingInsertSql } from './operator-recipients';
import { createDirectSendCampaign } from './direct-send-core';
import { DirectSendError } from './direct-send-spec';
// ★ 2026-07-03 Gap5 Layer2: 고객별 발송 카운터 (예측 분모 전용 — 타겟 선정 무관)
import { recordCustomerSendsByFilter } from './customer-send-stats';
// ★ 2026-07-05: 발송 피로도 보호 — staging 추출 anti-join용 cap 조회
import { getFatigueCap } from './fatigue-guard';
// ★ Phase2 A (2026-06-26): 발송 본문 URL 단축 + 변이 추적(클릭→operator 변이 보상). journey-executor와 동일 패턴.
import { shortenUrlsInText } from './short-url';
// ★ Phase3 B (2026-06-26): 자율 발송 시각을 회사 클릭 반응 시간대로 개인화(데이터 부족 시 현행 폴백).
// ★ Phase3 C (2026-06-26): 리마인드 발송 시각을 발송 가능 시간대로 정렬(shiftToSendableHour).
import { pickBestSendHour, computeOptimalSendAt, shiftToSendableHour } from './send-time-util';
import { buildSeasonPromptBlock, getSeasonContext } from './season-context';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type OperatorSchedule = 'daily' | 'weekly' | 'monthly';
export type OperatorStatus = 'active' | 'paused' | 'paused_no_credit' | 'archived';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'auto_executed' | 'expired' | 'admin_review' | 'admin_stopped' | 'scheduled' | 'sending' | 'sent' | 'skipped';

export interface CreateOperatorInput {
  companyId: string;
  createdBy: string;
  name: string;
  objective: string;
  schedule?: OperatorSchedule;
  scheduleTime?: string;  // HH:mm KST, default 09:00
  scheduleDayOfWeek?: number | null;   // 0(일)~6(토) — weekly 전용 (미지정 시 생성일 요일)
  scheduleDayOfMonth?: number | null;  // 1~31 — monthly 전용 (말일 초과 시 그 달 말일로 클램프)
  // ★ 2026-06-26: 생성 시에도 저장(기존 누락 → #1 채널·#3 담당자·#4 혜택·예산 드롭 사고 fix)
  channel?: string;                    // 'sms' | 'lms' | 'mms' — 발송 채널 (default 'lms')
  benefitContent?: string | null;      // 관리자 직접 입력 혜택 (placeholder 치환)
  adminPhoneNumbers?: string[];        // 담당자 연락처 (1~3)
  backupAdminPhone?: string | null;    // 백업 담당자
  adminAlertChannel?: 'sms' | 'kakao' | 'email';  // 담당자 알림 채널 (default 'sms')
  autoSendLeadMinutes?: number | null; // 자율 발송 준비 시간(분)
  // ★ 2026-07-02 1단계 B: 발송 시각 모드 — 'fixed'(기본, 희망 시각 정각) | 'ai_optimal'(클릭 피크 개인화)
  sendTimeMode?: 'fixed' | 'ai_optimal';
  // ★ 2026-07-02 2단계: 문안 스타일 4종 — 미지정(null) = 브랜드 톤 자동
  copyStyle?: string | null;
  budgetMonthly?: number | null;
  budgetDaily?: number | null;
  budgetAlertThreshold?: number;
  deliveryPolicy?: 'daily' | 'weekly' | 'monthly';
  // ★ Phase3 C (2026-06-26): 다단계 시퀀스 — 1차 발송 후 N일 미반응자에 관리자 입력 리마인드.
  sequenceEnabled?: boolean;
  sequenceDelayDays?: number | null;       // 1~30일
  sequenceReminderContent?: string | null; // 관리자 직접 입력 (AI 임의 생성 금지)
}

export interface ContinuousOperator {
  id: string;
  companyId: string;
  createdBy: string | null;
  name: string;
  objective: string;
  schedule: OperatorSchedule;
  scheduleTime: string;
  scheduleDayOfWeek: number | null;   // 0(일)~6(토) — weekly 전용
  scheduleDayOfMonth: number | null;  // 1~31 — monthly 전용
  status: OperatorStatus;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  totalProposals: number;
  totalApproved: number;
  totalRejected: number;
  totalAutoExecuted: number;
  createdAt: Date;
  // ★ D212+ 5번 (2026-05-23 Harold 명시): 비용 제어 강화 — 월 예산 + 일별 한도 + 알림 임계값
  budgetMonthly: number | null;       // 월 예산 (원) — null = 무제한
  budgetDaily: number | null;          // 일별 한도 (원) — null = 무제한
  budgetAlertThreshold: number;        // 알림 임계값 % (default 80)
  budgetSpentMonth: number;            // 이번 달 누적 사용 (원) — auto-computed
  budgetSpentToday: number;            // 오늘 누적 사용 (원) — auto-computed
  // ★ D212+ 정책 (2026-05-23 Harold 명시): 발송 정책 + 검증 + 담당자 옵트아웃 + 스팸 임계값
  deliveryPolicy: 'daily' | 'weekly' | 'monthly';   // default 'daily'
  verificationRequiredDays: number;                 // default 7 (daily 영역 검증 의무 일수)
  verificationPassedDays: number;                   // 검증 통과 누적 일수
  adminPhoneNumbers: string[];                      // 담당자 영역 (1~3명)
  backupAdminPhone: string | null;                  // 백업 담당자 (휴가 영역)
  adminAlertChannel: 'sms' | 'kakao' | 'email';     // default 'sms'
  optOutMinutes: number;                            // default 5 (담당자 옵트아웃)
  spamScoreThreshold: number;                       // default 30
  maxSpamRetries: number;                           // default 3
  autoSendLeadMinutes: number | null;               // 자율 발송 준비·정지 창(분) — null→120
  // ★ 2026-07-02 1단계 B: 발송 시각 모드 — schedule_time = 발송 희망 시각, 생성 = 희망 − lead
  sendTimeMode: SendTimeMode;                       // 'fixed'(기본) | 'ai_optimal'(클릭 피크)
  // ★ 2026-07-02 2단계: 문안 스타일 4종 (null = 브랜드 톤 자동)
  copyStyle: CopyStyle | null;
  // ★ 2026-06-26: 발송 채널 + 관리자 입력 혜택
  channel: 'sms' | 'lms' | 'mms';                   // 발송 채널 (default 'lms')
  benefitContent: string | null;                    // 관리자 직접 입력 혜택 (placeholder 치환)
  // ★ Phase3 C (2026-06-26): 다단계 시퀀스 (1차 → N일 후 미반응자 리마인드)
  sequenceEnabled: boolean;                         // default false
  sequenceDelayDays: number | null;                 // 1~30일 (리마인드 대기)
  sequenceReminderContent: string | null;           // 관리자 직접 입력 리마인드 문안
}

export interface OperatorProposal {
  id: string;
  operatorId: string;
  companyId: string;
  proposalJson: Record<string, unknown>;
  recipientCount: number;
  costEstimate: number;
  status: ProposalStatus;
  autoExecuted: boolean;
  autoExecuteReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  campaignId: string | null;
  expiresAt: Date;
  createdAt: Date;
  operatorName?: string;
  operatorObjective?: string;
}

// ════════════════════════════════════════════════════════════════════
// CRUD — Operator
// ════════════════════════════════════════════════════════════════════

export async function createOperator(input: CreateOperatorInput): Promise<ContinuousOperator> {
  if (!input.name || !input.objective) {
    throw new Error('name과 objective는 필수입니다.');
  }
  if (input.objective.trim().length < 5) {
    throw new Error('objective는 5자 이상 입력해주세요.');
  }
  const schedule: OperatorSchedule = ['daily', 'weekly', 'monthly'].includes(input.schedule || '') ? input.schedule! : 'daily';
  const scheduleTime = input.scheduleTime || '09:00';
  const scheduleDayOfWeek = (schedule === 'weekly' && input.scheduleDayOfWeek != null) ? input.scheduleDayOfWeek : null;
  const scheduleDayOfMonth = (schedule === 'monthly' && input.scheduleDayOfMonth != null) ? input.scheduleDayOfMonth : null;
  // ★ 2026-07-02 1단계 B: schedule_time = 발송 희망 시각 — 생성(next_run_at)은 희망 시각 − 준비시간(lead)
  const sendTimeMode = normalizeSendTimeMode(input.sendTimeMode);
  // ★ 2026-07-02 2단계: 문안 스타일 (화이트리스트 밖/미지정 = null → 브랜드 톤 자동)
  const copyStyle = normalizeCopyStyle(input.copyStyle);
  const { nextRunAt } = computeNextGenerationRun(
    schedule, scheduleTime, scheduleDayOfWeek, scheduleDayOfMonth,
    resolveAutoSendLeadMinutes(input.autoSendLeadMinutes),
  );

  // ★ 2026-06-26: 생성 시 채널·혜택·담당자·예산도 저장 (기존엔 누락 → 담당자 연락처 드롭·2시간 알림 불가 #3 + 채널 #1 + 혜택 #4 fix)
  const channel = ['sms', 'lms', 'mms'].includes((input.channel || '').toLowerCase()) ? (input.channel as string).toLowerCase() : 'lms';
  const adminPhones = Array.isArray(input.adminPhoneNumbers) ? input.adminPhoneNumbers.filter((p) => typeof p === 'string' && p.trim()).slice(0, 3) : [];
  const adminAlertChannel = ['sms', 'kakao', 'email'].includes(input.adminAlertChannel || '') ? input.adminAlertChannel! : 'sms';
  const deliveryPolicy = ['daily', 'weekly', 'monthly'].includes(input.deliveryPolicy || '') ? input.deliveryPolicy! : 'daily';
  const benefitContent = typeof input.benefitContent === 'string' && input.benefitContent.trim() ? input.benefitContent.trim() : null;
  const backupAdminPhone = typeof input.backupAdminPhone === 'string' && input.backupAdminPhone.trim() ? input.backupAdminPhone.trim() : null;
  // ★ Phase3 C: 다단계 시퀀스 — delay 1~30일 클램프, 리마인드 문안 관리자 입력(슬라이스).
  const sequenceEnabled = input.sequenceEnabled === true;
  const sequenceDelayDays = typeof input.sequenceDelayDays === 'number' && input.sequenceDelayDays > 0 ? Math.min(30, Math.floor(input.sequenceDelayDays)) : null;
  const sequenceReminderContent = typeof input.sequenceReminderContent === 'string' && input.sequenceReminderContent.trim() ? input.sequenceReminderContent.trim().slice(0, 2000) : null;

  // ★ 2026-06-02 종량제: 자동마케팅 저장(활성화) = 200 1회. 사전 잔액 확인(선불 부족 차단) → INSERT → 성공 후 차감(멱등키 operatorId).
  const saveCost = getCreditCost('continuous-operator');
  await checkCredit(input.companyId, saveCost);
  const result = await query(
    `INSERT INTO continuous_operators (
      id, company_id, created_by, name, objective,
      schedule, schedule_time, schedule_day_of_week, schedule_day_of_month, status, next_run_at,
      channel, benefit_content, admin_phone_numbers, backup_admin_phone, admin_alert_channel,
      auto_send_lead_minutes, budget_monthly, budget_daily, budget_alert_threshold, delivery_policy,
      sequence_enabled, sequence_delay_days, sequence_reminder_content, send_time_mode, copy_style,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3, $4,
      $5, $6, $8, $9, 'active', $7,
      $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19,
      $20, $21, $22, $23, $24,
      NOW(), NOW()
    ) RETURNING *`,
    [
      input.companyId, input.createdBy, input.name, input.objective.trim(),
      schedule, scheduleTime, nextRunAt, scheduleDayOfWeek, scheduleDayOfMonth,
      channel, benefitContent, adminPhones, backupAdminPhone, adminAlertChannel,
      input.autoSendLeadMinutes != null ? input.autoSendLeadMinutes : null,
      input.budgetMonthly != null ? input.budgetMonthly : null,
      input.budgetDaily != null ? input.budgetDaily : null,
      input.budgetAlertThreshold != null ? input.budgetAlertThreshold : 80,
      deliveryPolicy,
      sequenceEnabled, sequenceDelayDays, sequenceReminderContent, sendTimeMode, copyStyle,
    ]
  );
  const operator = mapRowToOperator(result.rows[0]);
  await deductCreditSafe({
    companyId: input.companyId,
    cost: saveCost,
    source: 'continuous-operator',
    createdBy: input.createdBy,
    idempotencyKey: `continuous-operator:${operator.id}`,
  });
  return operator;
}

export async function listOperators(companyId: string): Promise<ContinuousOperator[]> {
  // ★ D212+ 5번 (2026-05-23 Harold 명시): budget_spent_month + budget_spent_today 영역 sub-query
  const result = await query(
    `SELECT o.*,
       COALESCE((
         SELECT SUM(cost_estimate) FROM operator_proposals
         WHERE operator_id = o.id
           AND created_at >= date_trunc('month', NOW())
           AND status IN ('approved', 'auto_executed', 'sent')
       ), 0) AS budget_spent_month,
       COALESCE((
         SELECT SUM(cost_estimate) FROM operator_proposals
         WHERE operator_id = o.id
           AND created_at >= CURRENT_DATE
           AND status IN ('approved', 'auto_executed', 'sent')
       ), 0) AS budget_spent_today
     FROM continuous_operators o
     WHERE o.company_id = $1::uuid AND o.status != 'archived'
     ORDER BY o.status DESC, o.created_at DESC`,
    [companyId]
  );
  return result.rows.map(mapRowToOperator);
}

export async function updateOperator(
  companyId: string,
  operatorId: string,
  patch: {
    name?: string;
    objective?: string;
    schedule?: OperatorSchedule;
    scheduleTime?: string;
    scheduleDayOfWeek?: number | null;
    scheduleDayOfMonth?: number | null;
    status?: OperatorStatus;
    // ★ D212+ 5번 (2026-05-23 Harold 명시): 비용 제어 강화 patch
    budgetMonthly?: number | null;
    budgetDaily?: number | null;
    budgetAlertThreshold?: number;
    // ★ D212+ 정책 (2026-05-23 Harold 명시): 발송 정책 + 검증 + 담당자 영역 patch
    deliveryPolicy?: 'daily' | 'weekly' | 'monthly';
    verificationRequiredDays?: number;
    adminPhoneNumbers?: string[];
    backupAdminPhone?: string | null;
    adminAlertChannel?: 'sms' | 'kakao' | 'email';
    optOutMinutes?: number;
    autoSendLeadMinutes?: number | null;
    spamScoreThreshold?: number;
    maxSpamRetries?: number;
    // ★ 2026-06-26: 발송 채널 + 관리자 입력 혜택
    channel?: 'sms' | 'lms' | 'mms';
    benefitContent?: string | null;
    // ★ Phase3 C (2026-06-26): 다단계 시퀀스
    sequenceEnabled?: boolean;
    sequenceDelayDays?: number | null;
    sequenceReminderContent?: string | null;
    // ★ 2026-07-02 1단계 B: 발송 시각 모드
    sendTimeMode?: 'fixed' | 'ai_optimal';
    // ★ 2026-07-02 2단계: 문안 스타일 (undefined = 변경 없음, null/화이트리스트 밖 = 해제 → 브랜드 톤 자동)
    copyStyle?: string | null;
  }
): Promise<ContinuousOperator | null> {
  // schedule/scheduleTime/요일/날짜/준비시간 변경 시 next_run_at 재계산 (생성 = 발송 희망 시각 − lead)
  let nextRunAt: Date | null = null;
  let nextDow: number | null = null;
  let nextDom: number | null = null;
  if (patch.schedule || patch.scheduleTime || patch.scheduleDayOfWeek !== undefined || patch.scheduleDayOfMonth !== undefined || patch.autoSendLeadMinutes !== undefined) {
    const current = await query(
      `SELECT schedule, schedule_time, schedule_day_of_week, schedule_day_of_month, auto_send_lead_minutes FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid`,
      [operatorId, companyId]
    );
    if (current.rows.length === 0) return null;
    const sched = (patch.schedule || current.rows[0].schedule) as OperatorSchedule;
    const time = patch.scheduleTime || current.rows[0].schedule_time;
    nextDow = sched === 'weekly' ? (patch.scheduleDayOfWeek !== undefined ? patch.scheduleDayOfWeek : current.rows[0].schedule_day_of_week) : null;
    nextDom = sched === 'monthly' ? (patch.scheduleDayOfMonth !== undefined ? patch.scheduleDayOfMonth : current.rows[0].schedule_day_of_month) : null;
    const lead = resolveAutoSendLeadMinutes(
      patch.autoSendLeadMinutes !== undefined ? patch.autoSendLeadMinutes : current.rows[0].auto_send_lead_minutes,
    );
    nextRunAt = computeNextGenerationRun(sched, time, nextDow, nextDom, lead).nextRunAt;
  }

  const result = await query(
    `UPDATE continuous_operators SET
      name = COALESCE($3, name),
      objective = COALESCE($4, objective),
      schedule = COALESCE($5, schedule),
      schedule_time = COALESCE($6, schedule_time),
      status = COALESCE($7, status),
      next_run_at = COALESCE($8, next_run_at),
      budget_monthly = $9,
      budget_daily = $10,
      budget_alert_threshold = COALESCE($11, budget_alert_threshold),
      delivery_policy = COALESCE($12, delivery_policy),
      verification_required_days = COALESCE($13, verification_required_days),
      admin_phone_numbers = COALESCE($14, admin_phone_numbers),
      backup_admin_phone = $15,
      admin_alert_channel = COALESCE($16, admin_alert_channel),
      opt_out_minutes = COALESCE($17, opt_out_minutes),
      spam_score_threshold = COALESCE($18, spam_score_threshold),
      max_spam_retries = COALESCE($19, max_spam_retries),
      auto_send_lead_minutes = COALESCE($20, auto_send_lead_minutes),
      schedule_day_of_week = COALESCE($21, schedule_day_of_week),
      schedule_day_of_month = COALESCE($22, schedule_day_of_month),
      channel = COALESCE($23, channel),
      benefit_content = COALESCE($24, benefit_content),
      sequence_enabled = COALESCE($25, sequence_enabled),
      sequence_delay_days = COALESCE($26, sequence_delay_days),
      sequence_reminder_content = COALESCE($27, sequence_reminder_content),
      send_time_mode = COALESCE($28, send_time_mode),
      copy_style = CASE WHEN $29::text = '__keep__' THEN copy_style ELSE NULLIF($29::text, '') END,
      updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
     RETURNING *`,
    [
      operatorId, companyId,
      patch.name ?? null,
      patch.objective ?? null,
      patch.schedule ?? null,
      patch.scheduleTime ?? null,
      patch.status ?? null,
      nextRunAt,
      patch.budgetMonthly === undefined ? null : patch.budgetMonthly,
      patch.budgetDaily === undefined ? null : patch.budgetDaily,
      patch.budgetAlertThreshold ?? null,
      patch.deliveryPolicy ?? null,
      patch.verificationRequiredDays ?? null,
      patch.adminPhoneNumbers ?? null,
      patch.backupAdminPhone === undefined ? null : patch.backupAdminPhone,
      patch.adminAlertChannel ?? null,
      patch.optOutMinutes ?? null,
      patch.spamScoreThreshold ?? null,
      patch.maxSpamRetries ?? null,
      patch.autoSendLeadMinutes ?? null,
      nextDow,
      nextDom,
      patch.channel ?? null,
      (typeof patch.benefitContent === 'string' && patch.benefitContent.trim()) ? patch.benefitContent.trim() : null,
      patch.sequenceEnabled ?? null,
      typeof patch.sequenceDelayDays === 'number' && patch.sequenceDelayDays > 0 ? Math.min(30, Math.floor(patch.sequenceDelayDays)) : null,
      (typeof patch.sequenceReminderContent === 'string' && patch.sequenceReminderContent.trim()) ? patch.sequenceReminderContent.trim().slice(0, 2000) : null,
      patch.sendTimeMode !== undefined ? normalizeSendTimeMode(patch.sendTimeMode) : null,
      // copy_style: undefined = 유지('__keep__'), 그 외 = 정규화 값 or ''(해제 → SQL NULLIF로 null)
      patch.copyStyle === undefined ? '__keep__' : (normalizeCopyStyle(patch.copyStyle) ?? ''),
    ]
  );
  return result.rows.length > 0 ? mapRowToOperator(result.rows[0]) : null;
}

export async function archiveOperator(companyId: string, operatorId: string): Promise<boolean> {
  const result = await query(
    `UPDATE continuous_operators SET status = 'archived', updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid RETURNING id`,
    [operatorId, companyId]
  );
  return result.rows.length > 0;
}

// ════════════════════════════════════════════════════════════════════
// 제안서 — 매일 worker가 생성
// ════════════════════════════════════════════════════════════════════

interface CompanyContextRow {
  company_name: string;
  business_type: string | null;
  brand_name: string | null;
  brand_slogan: string | null;
  brand_description: string | null;
  brand_tone: string | null;
  customer_schema: any;
  reject_number: string | null;
  // ★ 2026-07-02 1단계: 회사별 메시지 단가 — 예상 비용을 실제 회사 단가로 계산 (미설정 시 getCompanyCosts가 기본 단가 폴백)
  cost_per_sms: string | number | null;
  cost_per_lms: string | number | null;
  cost_per_mms: string | number | null;
  cost_per_kakao: string | number | null;
  cdp_auto_execute_enabled: boolean;
  cdp_auto_execute_max_recipients: number;
  cdp_auto_execute_max_cost_krw: number;
  // ★ D210+ Phase 3 B-1 (2026-05-23 Harold 명시): 회사별 risk 임계값 영역 (default 'low' — 옛 hardcoded 정합)
  cdp_auto_execute_max_risk: 'low' | 'medium' | 'high';
  plan_code: string;
}

export async function generateProposalForOperator(operatorId: string): Promise<OperatorProposal | null> {
  // 1. Operator 조회 — ★ D212+ 5번 (2026-05-23 Harold 명시): budget_spent 영역 sub-query 통합
  const operRes = await query(
    `SELECT o.*, c.id AS c_id,
       COALESCE((
         SELECT SUM(cost_estimate) FROM operator_proposals
         WHERE operator_id = o.id
           AND created_at >= date_trunc('month', NOW())
           AND status IN ('approved', 'auto_executed', 'sent')
       ), 0) AS budget_spent_month,
       COALESCE((
         SELECT SUM(cost_estimate) FROM operator_proposals
         WHERE operator_id = o.id
           AND created_at >= CURRENT_DATE
           AND status IN ('approved', 'auto_executed', 'sent')
       ), 0) AS budget_spent_today
     FROM continuous_operators o
     JOIN companies c ON o.company_id = c.id
     WHERE o.id = $1::uuid AND o.status = 'active'`,
    [operatorId]
  );
  if (operRes.rows.length === 0) return null;
  const operator = mapRowToOperator(operRes.rows[0]);

  // ★ D212+ 5번 (2026-05-23 Harold 명시): 예산 초과 차단 — 회사 admin 신뢰
  if (operator.budgetMonthly !== null && operator.budgetSpentMonth >= operator.budgetMonthly) {
    console.log(`[ContinuousOperator] ${operator.name} 월 예산 초과 (${operator.budgetSpentMonth.toLocaleString()}원 / ${operator.budgetMonthly.toLocaleString()}원) → 제안서 생성 차단`);
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }
  if (operator.budgetDaily !== null && operator.budgetSpentToday >= operator.budgetDaily) {
    console.log(`[ContinuousOperator] ${operator.name} 일별 예산 초과 (${operator.budgetSpentToday.toLocaleString()}원 / ${operator.budgetDaily.toLocaleString()}원) → 제안서 생성 차단`);
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }

  // ★ 2026-06-30: operator당 미처리 추천 1건 원칙 — 이미 발송 예약된 추천(scheduled, 리마인드 제외)이
  //   있으면 이중 예약 방지로 신규 생성 skip. 다단계 시퀀스 리마인드(meta.is_reminder=true)는 별개 발송이라 제외.
  const openProps = await query(
    `SELECT status, COALESCE(proposal_json->'meta'->>'is_reminder', 'false') = 'true' AS is_reminder
       FROM operator_proposals
      WHERE operator_id = $1::uuid AND status IN ('pending', 'admin_review', 'scheduled')`,
    [operator.id],
  );
  if (shouldSkipProposalGeneration(
    openProps.rows.map((r: any) => ({ status: r.status, isReminder: r.is_reminder === true })),
  )) {
    console.log(`[ContinuousOperator] ${operator.name} 이미 발송 예약된 추천 존재 → 신규 생성 skip (이중 예약 방지)`);
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }

  // 2. 회사 컨텍스트 + 자동 실행 옵션 조회
  const ctxRes = await query(
    `SELECT c.company_name, c.business_type, c.brand_name, c.brand_slogan,
            c.brand_description, c.brand_tone, c.customer_schema,
            COALESCE(c.reject_number, c.opt_out_080_number) AS reject_number,
            c.cost_per_sms, c.cost_per_lms, c.cost_per_mms, c.cost_per_kakao,
            COALESCE(c.cdp_auto_execute_enabled, false) AS cdp_auto_execute_enabled,
            COALESCE(c.cdp_auto_execute_max_recipients, 1000) AS cdp_auto_execute_max_recipients,
            COALESCE(c.cdp_auto_execute_max_cost_krw, 50000) AS cdp_auto_execute_max_cost_krw,
            COALESCE(c.cdp_auto_execute_max_risk, 'low') AS cdp_auto_execute_max_risk,
            COALESCE(p.plan_code, 'FREE') AS plan_code
     FROM companies c
     LEFT JOIN plans p ON c.plan_id = p.id
     WHERE c.id = $1::uuid`,
    [operator.companyId]
  );
  if (ctxRes.rows.length === 0) return null;
  const ctx = ctxRes.rows[0] as CompanyContextRow;

  // 3. 고객 통계 조회
  const statsRes = await query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE sms_opt_in = true) AS sms_opt_in_count,
       AVG((custom_fields->>'purchase_count')::numeric) AS avg_purchase_count,
       AVG((custom_fields->>'total_spent')::numeric) AS avg_total_spent
     FROM customers
     WHERE company_id = $1::uuid AND is_active = true`,
    [operator.companyId]
  );
  const customerStats = statsRes.rows[0];

  // 4. AI Operator 호출 (orchestrate) — 제안서 생성
  const companyInfo: any = {
    company_name: ctx.company_name,
    business_type: ctx.business_type,
    brand_name: ctx.brand_name,
    brand_slogan: ctx.brand_slogan,
    brand_description: ctx.brand_description,
    brand_tone: ctx.brand_tone,
    customer_schema: ctx.customer_schema,
    reject_number: ctx.reject_number,
    // ★ 2026-07-02 1단계: 회사별 단가 반영 — 빈 객체 전달로 항상 기본 단가만 쓰이던 것을 교정.
    //   raw cost_per_*도 함께 전달해 orchestrate 내부 getCompanyCosts(ctx.companyInfo)가 회사 단가를 해석하게 한다.
    cost_per_sms: ctx.cost_per_sms,
    cost_per_lms: ctx.cost_per_lms,
    cost_per_mms: ctx.cost_per_mms,
    cost_per_kakao: ctx.cost_per_kakao,
    ...getCompanyCosts(ctx as any),
  };

  console.log(`[ContinuousOperator] ${operator.name} 제안서 생성 시작 (objective: ${operator.objective.slice(0, 50)})`);

  let orchestratorResult: any;
  try {
    orchestratorResult = await orchestrate({
      companyId: operator.companyId,
      userId: operator.createdBy,
      objective: operator.objective,
      companyInfo,
      customerStats,
      // ★ 계절 문안 주입 — objective는 불변, 그 달 시즌을 메시지 톤·소재로만(§6-8).
      //   2026-07-02 2단계: 관리자 선택 문안 스타일 지시를 같은 힌트 채널로 함께 주입(미선택 = 계절만).
      seasonHint: [
        buildSeasonPromptBlock(getSeasonContext(new Date()).month, ctx.business_type),
        buildCopyStylePromptBlock(operator.copyStyle),
      ].filter(Boolean).join('\n'),
      // ★ 2026-06-26: 폼에서 고정한 채널(#1) + 관리자 입력 혜택(#4) 주입 → 제안·테스트·발송 일관
      forcedChannel: operator.channel,
      benefitContent: operator.benefitContent,
      // ★ 2026-07-02 (Harold 명시): 자동마케팅 = 마케팅 = 무조건 광고 — (광고)+무료거부 080 자동 합성 전제.
      forcedIsAd: true,
    }, { source: 'continuous-operator', cost: 0 });  // ★ 2026-06-02: 제안서 생성(매일)은 무과금 — 200은 저장 1회, 발송 시 문안 3로 재배치. source는 이력용 유지.
    // ★ D227+ 종량제: 크레딧 충분해 정상 실행 — paused_no_credit였으면 자동 재개
    await query(
      `UPDATE continuous_operators SET status = 'active', updated_at = NOW()
       WHERE id = $1::uuid AND status = 'paused_no_credit'`,
      [operator.id],
    );
  } catch (err: any) {
    // ★ D227+ 종량제: AI 크레딧 부족 → paused_no_credit(가시성) + 담당자 무과금 알림(전환 시 1회) + 다음 주기 재확인
    if (err instanceof InsufficientCreditError) {
      const transit = await query(
        `UPDATE continuous_operators SET status = 'paused_no_credit', updated_at = NOW()
         WHERE id = $1::uuid AND status <> 'paused_no_credit' RETURNING id`,
        [operator.id],
      );
      if (transit.rows.length > 0) {
        await notifyOperatorAdmins(
          operator,
          '[AI 오퍼레이션 일시 중지]',
          `AI 크레딧이 부족하여 '${operator.name}' 자동 운영이 일시 중지됐습니다. 크레딧 충전 시 다음 주기에 자동 재개됩니다.`,
        ).catch((e: any) => console.error('[ContinuousOperator] 크레딧 알림 발송 실패:', e?.message || e));
      }
      await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
      console.warn(`[ContinuousOperator] ${operator.name} 크레딧 부족 → paused_no_credit (다음 주기 재확인)`);
      return null;
    }
    console.error(`[ContinuousOperator] orchestrate 실패 ${operator.name}:`, err?.message || err);
    // Operator의 next_run_at만 갱신하고 제안서는 생성 안 함
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }

  // 5. Zero-Count 영구 원칙 — 0건 매칭 시 제안서 생성 안 함
  const recipientCount = orchestratorResult.target?.count || 0;
  if (recipientCount === 0) {
    console.log(`[ContinuousOperator] ${operator.name} 0건 매칭 → 제안서 생성 안 함 (Zero-Count 영구 원칙)`);
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }

  // 6. 자동 발송 자격 체크 (ENT 옵션)
  const costEstimate = orchestratorResult.cost?.estimated || 0;
  const compliance = orchestratorResult.compliance || { passed: true, riskLevel: 'low' };
  // ★ 2026-07-02 (Harold 명시): 자동마케팅 = 무조건 광고. orchestrate에 forcedIsAd로 고정했지만
  //   이 파일 안 판정도 상수로 고정(이중 안전) — 스팸테스트·080 가드·발송 전부 광고 기준.
  const isAd = true;

  // 자율 발송 가능 조건(발신번호 + 문안 + SMS/LMS) — 스팸테스트·실발송에 필수. 미충족이면 수동 검토(pending)로.
  const channelForSpam = (orchestratorResult.channel?.recommended || 'SMS').toUpperCase();
  const callbackForSpam = String(companyInfo.callback || companyInfo.callback_number || ctx.reject_number || '').trim();
  const firstMsg = ((orchestratorResult.messages as any[]) || [])[0];
  const bestMessage = firstMsg ? String(firstMsg.body || firstMsg.message || '') : '';
  // ★ 2026-07-02: 담당자에게 안내할 "실제 발송될 문안" — 스팸 재생성으로 교체되면 아래에서 갱신
  let finalNoticeCopy = bestMessage;
  const bestSubject = firstMsg ? String(firstMsg.subject || '') : '';
  const canAutoSend = !!bestMessage && !!callbackForSpam && channelForSpam !== '카카오' && channelForSpam !== 'KAKAO';

  // ★ 2026-06-06 광고 가드: 광고면 무료거부 번호(080) 해석 결과가 있어야 자율 발송 자격(정보통신망법). 발송 직전 dispatchProposalSend에서도 재확인.
  const adOpt080 = isAd ? await getOpt080Number(operator.createdBy, operator.companyId) : '';
  const adRejectOk = !isAd || !!adOpt080;

  // ★ D210+ Phase 3 B-1: risk 회사별 max_risk 비교 (low<medium<high — 회사 max 초과 차단)
  const riskRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
  const proposalRiskRank = riskRank[compliance.riskLevel] || 1;
  const maxRiskRank = riskRank[ctx.cdp_auto_execute_max_risk] || 1;
  const riskWithinThreshold = proposalRiskRank <= maxRiskRank;

  const autoExecuteEligible =
    ctx.cdp_auto_execute_enabled &&
    (ctx.plan_code === 'ENTERPRISE' || ctx.plan_code === 'BUSINESS') &&
    recipientCount <= ctx.cdp_auto_execute_max_recipients &&
    costEstimate <= ctx.cdp_auto_execute_max_cost_krw &&
    riskWithinThreshold &&
    compliance.passed &&
    canAutoSend &&
    adRejectOk;

  const autoExecuteReason = autoExecuteEligible
    ? `자동 실행 임계값 통과: ${recipientCount}명 / ${costEstimate.toLocaleString()}원 / ${compliance.riskLevel} risk (회사 max ${ctx.cdp_auto_execute_max_risk}) / 광고`
    : `자동 실행 미통과 — ${[
        !ctx.cdp_auto_execute_enabled && '옵션 OFF',
        !['ENTERPRISE', 'BUSINESS'].includes(ctx.plan_code) && '요금제',
        recipientCount > ctx.cdp_auto_execute_max_recipients && `${recipientCount}건 > ${ctx.cdp_auto_execute_max_recipients}`,
        costEstimate > ctx.cdp_auto_execute_max_cost_krw && `${costEstimate}원 > ${ctx.cdp_auto_execute_max_cost_krw}원`,
        !riskWithinThreshold && `compliance ${compliance.riskLevel} > 회사 max ${ctx.cdp_auto_execute_max_risk}`,
        !compliance.passed && 'compliance fail',
        !canAutoSend && '발신번호·문안·채널(SMS/LMS) 미충족',
        !adRejectOk && '광고 무료거부 번호(080) 미설정',
      ].filter(Boolean).join(', ')}`;

  // 7. 제안서 INSERT — auto-eligible은 'scheduled'(T에 자율 발송) + scheduled_send_at, 아니면 'pending'(수동 검토)
  const leadMinutes = resolveAutoSendLeadMinutes(operator.autoSendLeadMinutes);
  // ★ 2026-07-02 1단계 B (Harold 스펙): schedule_time = 발송 희망 시각.
  //   fixed(기본) = 희망 시각 정각 발송 — 생성 워커가 희망 − lead에 돌므로 다음 occurrence가 이번 주기 희망 시각.
  //   ai_optimal(명시 선택) = Phase3 B 클릭 피크 개인화(준비 창 보존·데이터 부족 시 now+lead 폴백) 유지.
  const scheduledSendAt = operator.sendTimeMode === 'ai_optimal'
    ? await resolveOptimalScheduledSendAt(operator.companyId, leadMinutes)
    : computeNextOccurrence(operator.schedule, operator.scheduleTime, operator.scheduleDayOfWeek, operator.scheduleDayOfMonth);
  const proposalRes = await query(
    `INSERT INTO operator_proposals (
      id, operator_id, company_id, proposal_json, recipient_count, cost_estimate,
      status, auto_executed, auto_execute_reason, scheduled_send_at, expires_at, created_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3::jsonb, $4, $5,
      $6, $7, $8, $9, NOW() + INTERVAL '7 days', NOW()
    ) RETURNING *`,
    [
      operator.id,
      operator.companyId,
      JSON.stringify(orchestratorResult),
      recipientCount,
      costEstimate,
      autoExecuteEligible ? 'scheduled' : 'pending',
      autoExecuteEligible,
      autoExecuteReason,
      autoExecuteEligible ? scheduledSendAt : null,
    ]
  );

  // ★ 2026-06-30: operator당 미처리 추천 1건 원칙 — 방금 만든 것 외 직전 미처리(pending/admin_review)는
  //   만료시켜 "오늘의 추천" 중복 누적을 차단(테스트계정2 = 한 operator에 제안 다수 쌓임 정정).
  //   'scheduled'(자율발송·리마인드)는 발송 확정분이라 건드리지 않음. operator_proposals엔 updated_at 컬럼 없음 → status만 set.
  await query(
    `UPDATE operator_proposals SET status = 'expired'
      WHERE operator_id = $1::uuid AND status IN ('pending', 'admin_review') AND id <> $2::uuid`,
    [operator.id, proposalRes.rows[0].id],
  );

  // 8. D177 Self-Optimizing — message variants 생성 (Bandit 학습 기반)
  const messages: any[] = (orchestratorResult.messages as any[]) || [];
  if (messages.length > 0) {
    try {
      await insertProposalVariants(
        messages.slice(0, 3).map((m: any, idx: number) => ({
          proposalId: proposalRes.rows[0].id,
          variantIndex: idx,
          messageBody: String(m.body || m.message || ''),
          byteCount: Number(m.byteCount || m.byte_count || 0),
        }))
      );
    } catch (err: any) {
      console.warn(`[ContinuousOperator] variant 생성 실패 (proposal=${proposalRes.rows[0].id}):`, err?.message || err);
    }
  }

  // 9. ★ D227+ 스팸 안전망 — 실제 테스트폰 발송 → 차단 시 AI 재생성(2회) → 재테스트 → 끝내 실패 시 담당자 검토.
  //    auto-campaign-worker와 동일한 검증된 자산(autoSpamTestWithRegenerate + generateMessages) 재사용.
  //    channelForSpam·callbackForSpam·bestMessage·bestSubject·canAutoSend는 위 자격 판정에서 계산됨.
  if (canAutoSend) {
    try {
      const spamResult = await autoSpamTestWithRegenerate({
        companyId: operator.companyId,
        userId: operator.createdBy || operator.companyId,
        callbackNumber: callbackForSpam,
        messageType: (channelForSpam === 'LMS' || channelForSpam === 'MMS' ? channelForSpam : 'SMS') as 'SMS' | 'LMS' | 'MMS',
        subject: bestSubject || undefined,
        variants: [{ variantId: 'A', messageText: bestMessage, subject: bestSubject || undefined }],
        isAd: !!isAd,
        rejectNumber: ctx.reject_number || undefined,
        maxRetries: 2,  // ★ Harold 2026-05-31: AI 재생성 2회
        // 차단 시 AI 재작성 (Opus) — buildSpamRegeneratePrompt: 목표 유지 + 구체 혜택 생성 금지
        regenerateCallback: async () => {
          try {
            // 스팸 재생성은 자동마케팅 사이클 안전망(품질 보증) → 묶음으로 차감 0 (사이클 1회 200에 포함).
            const regen = await runInCreditBundle(() => generateMessages(
              buildSpamRegeneratePrompt(operator.objective, buildCopyStylePromptBlock(operator.copyStyle)),
              { count: recipientCount, segmentName: orchestratorResult.target?.suggestedName || operator.name, criteria: orchestratorResult.target?.criteria || '' } as any,
              { channel: channelForSpam, isAd: !!isAd, rejectNumber: ctx.reject_number || undefined, model: 'opus', companyId: operator.companyId },
            ));
            const nv = regen.variants?.[0] as any;
            if (nv) return { messageText: String(nv.message_text || nv.sms_text || nv.lms_text || nv.body || ''), subject: nv.subject };
            return null;
          } catch { return null; }
        },
      });

      const variantResult = spamResult.variants[0];
      const finalResult = (variantResult?.spamResult || 'failed') as 'pass' | 'blocked' | 'failed' | 'timeout';
      const regenCount = variantResult?.regenerateCount || 0;

      // 재생성된 문안이 통과했으면 proposal_json의 best 메시지를 교체 (실제 발송될 문안 = 통과 문안)
      if (variantResult?.regenerated && variantResult.messageText) {
        finalNoticeCopy = variantResult.messageText;
        try {
          const pj = orchestratorResult;
          if (pj.messages?.[0]) {
            pj.messages[0].body = variantResult.messageText;
            if (variantResult.subject) pj.messages[0].subject = variantResult.subject;
          }
          await query(`UPDATE operator_proposals SET proposal_json = $2::jsonb WHERE id = $1::uuid`,
            [proposalRes.rows[0].id, JSON.stringify(pj)]);
        } catch (e: any) { console.warn('[ContinuousOperator] 재생성 문안 반영 skip:', e?.message); }
      }

      // 스팸 결과 저장 + 상태 결정 (decideSpamOutcome 순수 정책)
      const outcome = decideSpamOutcome(finalResult, regenCount);
      await query(
        `UPDATE operator_proposals SET
           spam_test_status = $2, spam_test_retry_count = $3, spam_test_reasoning = $4
         WHERE id = $1::uuid`,
        [proposalRes.rows[0].id, finalResult, regenCount, outcome.reason],
      );

      if (outcome.status === 'admin_review') {
        // 끝내 통과 X → 담당자 검토 대기 (자동 발송 차단 + scheduled 해제, 자동 폐기 X)
        await query(
          `UPDATE operator_proposals SET status = 'admin_review', auto_executed = false, scheduled_send_at = NULL, auto_execute_reason = $2
           WHERE id = $1::uuid`,
          [proposalRes.rows[0].id, outcome.reason],
        );
        console.warn(`[ContinuousOperator] ${operator.name} 스팸 미통과 (재생성 ${regenCount}회) → 담당자 검토 대기`);
        // ★ 스팸 2회 재생성 후에도 실패 → 운영자 일시정지 + 담당자 사유 알림(설계 §1)
        await query(`UPDATE continuous_operators SET status = 'paused', updated_at = NOW() WHERE id = $1::uuid AND status = 'active'`, [operator.id]).catch(() => {});
        await notifyOperatorAdmins(operator, '[AI 자동마케팅] 일시정지', `'${operator.name}' 문안이 스팸필터를 통과하지 못해 자동마케팅을 일시정지했습니다. 문안 검토 후 재개해주세요.`).catch((e: any) => console.warn('[ContinuousOperator] 정지 알림 경고:', e?.message));
      } else {
        console.log(`[ContinuousOperator] ${operator.name} 스팸 통과 (재생성 ${regenCount}회)`);
        // 자율 발송 예정(scheduled) → 담당자에 실문안 + 발송 정보(일시·타겟·비용)·정지 안내 (준비 시점 알림, 무과금 인증 라인)
        if (autoExecuteEligible) {
          // ★ 2026-07-02: 재생성으로 문안이 교체됐으면 실제 발송될 통과 문안을 통지 (직전엔 원본을 보내 통지≠실발송 불일치)
          await sendAutoSendPrepNotice(operator, proposalRes.rows[0].id, finalNoticeCopy, scheduledSendAt, {
            recipientCount,
            costEstimate,
            channelLabel: channelForSpam,
            unitCost: Number(orchestratorResult.cost?.unitCost) || 0,
          }).catch((e: any) => console.warn('[ContinuousOperator] 준비 알림 경고:', e?.message));
        }
      }
    } catch (err: any) {
      console.warn(`[ContinuousOperator] 스팸테스트 오류:`, err?.message);
      // 스팸 검증 실패 = 자동 발송 금지. scheduled였으면 담당자 검토로 내림(미검증 발송 차단).
      if (autoExecuteEligible) {
        await query(
          `UPDATE operator_proposals SET status = 'admin_review', auto_executed = false, scheduled_send_at = NULL,
             auto_execute_reason = '스팸 검증 오류 — 담당자 검토 필요' WHERE id = $1::uuid`,
          [proposalRes.rows[0].id],
        ).catch(() => {});
      }
    }
  }

  // (검증 7일 게이팅 제거 — verification_* 컬럼은 보존하되 자율 발송 흐름에서 미사용. 스팸 통과만으로 'scheduled'.)

  // 10. ★ 2026-07-02 1단계: pending(수동 검토)으로 남은 새 추천 — 담당자 통지 문자 2건.
  //    자율 발송 자격 미달이면 그동안 아무 통지가 없어 담당자가 새 추천을 몰랐음. 통지 실패는 생성 흐름에 영향 X.
  //    Harold 2026-07-02: 승인 대기도 ①실제 발송될 문안 ②승인 안내(대상·비용) 2건으로 — 자율발송 예고와 같은 짜임.
  try {
    const curRes = await query(`SELECT status FROM operator_proposals WHERE id = $1::uuid`, [proposalRes.rows[0].id]);
    if (curRes.rows[0]?.status === 'pending') {
      if (finalNoticeCopy.trim()) {
        await notifyOperatorAdmins(operator, '[AI 자동마케팅] 추천 문안', finalNoticeCopy);
      }
      await notifyOperatorAdmins(
        operator,
        '[AI 자동마케팅] 승인 대기',
        buildPendingReviewNoticeBody({ operatorName: operator.name, recipientCount, costEstimate }),
      );
    }
  } catch (e: any) {
    console.warn('[ContinuousOperator] 승인 대기 통지 경고:', e?.message);
  }

  // 11. Operator 통계 갱신
  await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 1, autoExecuteEligible);

  console.log(`[ContinuousOperator] ${operator.name} 제안서 생성 완료 (${recipientCount}명 / ${costEstimate}원 / ${autoExecuteEligible ? '자동 실행' : 'pending'} / variants ${messages.length}건 / 정책 ${operator.deliveryPolicy})`);

  // 자율 발송 크레딧(continuous-operator-send)은 실제 발송 성공 시점에 1회 차감(멱등키 proposalId) — runAutoSendPass에서 처리.
  return mapRowToProposal(proposalRes.rows[0]);
}

// ★ D212+ 정책 (2026-05-23 Harold 명시): 담당자 정지 — AI 학습 통합
export async function adminStopProposal(
  companyId: string,
  proposalId: string,
  stopReason: { reason: 'spam_suspicion' | 'content_correction' | 'no_send' | 'other'; detail?: string },
): Promise<boolean> {
  // 회사 격리 + proposal 조회 (scheduled = 자율 발송 대기분도 정지 가능 — 정지 창)
  const r = await query(
    `SELECT id, proposal_json FROM operator_proposals
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('pending', 'admin_review', 'scheduled')`,
    [proposalId, companyId],
  );
  if (r.rows.length === 0) return false;

  const proposal = r.rows[0];
  const messageBody = proposal.proposal_json?.messages?.[0]?.body || proposal.proposal_json?.messages?.[0]?.message || '';

  // 정지 처리 — scheduled_send_at 해제로 발송 패스에서 제외
  await query(
    `UPDATE operator_proposals SET
       status = 'admin_stopped',
       admin_response = 'stopped',
       admin_stop_reason = $2,
       scheduled_send_at = NULL,
       reviewed_at = NOW()
     WHERE id = $1::uuid`,
    [proposalId, JSON.stringify(stopReason)],
  );

  // 담당자 정지 사유 → ai_company_memory 학습 (다음 생성에 반영)
  await recordAdminStopLearning(companyId, proposalId, stopReason, messageBody);

  return true;
}

// ★ D212+ 정책 (2026-05-23 Harold 명시): 회사 admin 매일 컨펌
export async function adminConfirmProposal(
  companyId: string,
  proposalId: string,
): Promise<{ ok: boolean; verificationDays: number } | null> {
  // 회사 격리 + proposal 조회
  const r = await query(
    `SELECT p.id, p.operator_id, o.verification_passed_days, o.verification_required_days
     FROM operator_proposals p
     INNER JOIN continuous_operators o ON o.id = p.operator_id
     WHERE p.id = $1::uuid AND p.company_id = $2::uuid AND p.status = 'pending'`,
    [proposalId, companyId],
  );
  if (r.rows.length === 0) return null;

  const proposal = r.rows[0];

  // 승인 영역 처리
  await query(
    `UPDATE operator_proposals SET
       status = 'approved',
       admin_response = 'confirmed',
       reviewed_at = NOW()
     WHERE id = $1::uuid`,
    [proposalId],
  );

  // 검증 일수 누적
  const incRes = await query(
    `UPDATE continuous_operators SET
       verification_passed_days = COALESCE(verification_passed_days, 0) + 1,
       updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
     RETURNING verification_passed_days`,
    [proposal.operator_id, companyId],
  );

  return {
    ok: true,
    verificationDays: incRes.rows[0]?.verification_passed_days || 0,
  };
}

async function updateOperatorAfterRun(
  operatorId: string,
  schedule: OperatorSchedule,
  scheduleTime: string,
  proposalIncrement: number,
  autoExecuted: boolean = false
): Promise<void> {
  // 지정 요일/날짜 반영 — 컬럼 미존재(ALTER 전) 환경에서도 안전하게 fallback
  let dow: number | null = null;
  let dom: number | null = null;
  let lead: number | null = null;
  try {
    const dayRes = await query(
      `SELECT schedule_day_of_week, schedule_day_of_month, auto_send_lead_minutes FROM continuous_operators WHERE id = $1::uuid`,
      [operatorId]
    );
    dow = dayRes.rows[0]?.schedule_day_of_week ?? null;
    dom = dayRes.rows[0]?.schedule_day_of_month ?? null;
    lead = dayRes.rows[0]?.auto_send_lead_minutes ?? null;
  } catch { /* 컬럼 미존재 시 기존 동작 유지 */ }
  // ★ 2026-07-02 1단계 B: 다음 생성 = 다음 발송 희망 시각 − 준비시간 (같은 주기 재선정 없음 — computeNextGenerationRun이 보장)
  const nextRunAt = computeNextGenerationRun(schedule, scheduleTime, dow, dom, resolveAutoSendLeadMinutes(lead)).nextRunAt;
  await query(
    `UPDATE continuous_operators SET
       last_run_at = NOW(),
       next_run_at = $2,
       total_proposals = total_proposals + $3,
       total_auto_executed = total_auto_executed + $4,
       updated_at = NOW()
     WHERE id = $1::uuid`,
    [operatorId, nextRunAt, proposalIncrement, autoExecuted ? 1 : 0]
  );
}

// ════════════════════════════════════════════════════════════════════
// 제안서 — 사용자 승인/거부
// ════════════════════════════════════════════════════════════════════

export async function listProposals(
  companyId: string,
  status: ProposalStatus | 'all' = 'pending',
  limit: number = 50
): Promise<OperatorProposal[]> {
  // 만료 자동 처리 (조회 시점에 한 번 실행)
  await query(
    `UPDATE operator_proposals SET status = 'expired'
     WHERE company_id = $1::uuid AND status = 'pending' AND expires_at < NOW()`,
    [companyId]
  );

  // ★ D227+ pending 조회 시 admin_review(스팸 미통과 담당자 검토 대기)도 함께 노출 — 담당자가 한 탭에서 처리
  const params: any[] = [companyId];
  let statusFilter = '';
  if (status !== 'all') {
    if (status === 'pending') {
      statusFilter = `AND p.status IN ('pending', 'admin_review', 'scheduled')`;
    } else {
      params.push(status);
      statusFilter = `AND p.status = $${params.length}`;
    }
  }
  params.push(Math.min(limit, 200));
  const result = await query(
    `SELECT p.*, o.name AS operator_name, o.objective AS operator_objective
     FROM operator_proposals p
     LEFT JOIN continuous_operators o ON p.operator_id = o.id
     WHERE p.company_id = $1::uuid ${statusFilter}
     ORDER BY p.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(mapRowToProposal);
}

export async function approveProposal(
  companyId: string,
  proposalId: string,
  userId: string
): Promise<{ ok: boolean; reason?: string; action?: 'sent' | 'skipped'; campaignId?: string; sentCount?: number }> {
  // claim: pending/admin_review → sending. 백엔드에서 바로 발송(자동 경로와 동일)해 크레딧↔발송 원자성 확보.
  const claim = await query(
    `UPDATE operator_proposals SET
       status = 'sending',
       reviewed_by = $3::uuid,
       reviewed_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('pending', 'admin_review')
     RETURNING *`,
    [proposalId, companyId, userId]
  );
  if (claim.rows.length === 0) {
    return { ok: false, reason: '승인 가능한 상태가 아니거나 권한이 없는 제안서입니다.' };
  }

  // 통계 갱신
  await query(
    `UPDATE continuous_operators SET total_approved = total_approved + 1, updated_at = NOW()
     WHERE id = $1::uuid`,
    [claim.rows[0].operator_id]
  );

  // 발송 — dispatchProposalSend 공유. 크레딧은 발송 성공 시점 1회(멱등키 proposalId).
  const r = await dispatchProposalSend(claim.rows[0]);
  return { ok: true, ...r };
}

export async function rejectProposal(
  companyId: string,
  proposalId: string,
  userId: string
): Promise<boolean> {
  const result = await query(
    `UPDATE operator_proposals SET
       status = 'rejected',
       reviewed_by = $3::uuid,
       reviewed_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('pending', 'admin_review')
     RETURNING id, operator_id`,
    [proposalId, companyId, userId]
  );
  if (result.rows.length === 0) return false;

  await query(
    `UPDATE continuous_operators SET total_rejected = total_rejected + 1, updated_at = NOW()
     WHERE id = $1::uuid`,
    [result.rows[0].operator_id]
  );
  return true;
}

// ════════════════════════════════════════════════════════════════════
// Worker — 매일 09:00 KST에 활성 Operator 처리
// ════════════════════════════════════════════════════════════════════

let workerRunning = false;

export async function runOperatorWorker(): Promise<{ processed: number; failed: number }> {
  if (workerRunning) {
    console.log('[ContinuousOperator Worker] 이미 실행 중 — skip');
    return { processed: 0, failed: 0 };
  }
  workerRunning = true;

  let processed = 0;
  let failed = 0;

  try {
    const dueRes = await query(
      `SELECT id FROM continuous_operators
       WHERE status IN ('active', 'paused_no_credit')
         AND (next_run_at IS NULL OR next_run_at <= NOW())
       ORDER BY next_run_at NULLS FIRST
       LIMIT 100`
    );

    for (const row of dueRes.rows) {
      try {
        await generateProposalForOperator(row.id);
        processed++;
      } catch (err: any) {
        failed++;
        console.error(`[ContinuousOperator Worker] ${row.id} 처리 실패:`, err?.message || err);
      }
    }

    if (dueRes.rows.length > 0) {
      console.log(`[ContinuousOperator Worker] 처리 완료 — ${processed} 성공 / ${failed} 실패`);
    }

    // 발송 패스 — scheduled_send_at(준비+lead) 도달한 자율 발송 제안서를 직접발송 파이프라인으로 처리.
    await runAutoSendPass().catch((e: any) => console.error('[ContinuousOperator AutoSend] 패스 예외:', e?.message || e));
  } finally {
    workerRunning = false;
  }

  return { processed, failed };
}

// ════════════════════════════════════════════════════════════════════
// 자율 발송 패스 — scheduled_send_at(준비+lead) 도달 제안서를 직접발송 파이프라인으로 발송
// ════════════════════════════════════════════════════════════════════

export async function runAutoSendPass(limit: number = 20): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;
  const due = await query(
    `SELECT id FROM operator_proposals
     WHERE status = 'scheduled' AND scheduled_send_at IS NOT NULL AND scheduled_send_at <= NOW()
     ORDER BY scheduled_send_at ASC
     LIMIT $1`,
    [limit],
  );
  for (const row of due.rows) {
    try {
      const r = await sendScheduledProposal(row.id);
      if (r === 'sent') sent++; else skipped++;
    } catch (err: any) {
      skipped++;
      console.error(`[ContinuousOperator AutoSend] ${row.id} 발송 실패:`, err?.message || err);
    }
  }
  // 'sending' 정지 복구 — 매 패스 점검: campaign_id 있으면 'sent' 마감, 없고 claim 후 노후면 'admin_review'(자동 재발송 X).
  await reconcileStuckSending().catch((e: any) => console.error('[ContinuousOperator AutoSend] 정지 복구 예외:', e?.message || e));

  if (due.rows.length > 0) {
    console.log(`[ContinuousOperator AutoSend] ${sent} 발송 / ${skipped} 스킵`);
  }
  return { sent, skipped };
}

/** 'sending'에 정지된 제안 복구(decideStuckSendingRecovery 순수 정책). campaign 'sending' 자동정리 패턴 미러. */
async function reconcileStuckSending(staleMinutes: number = 30): Promise<void> {
  const stuck = await query(
    `SELECT id, company_id, operator_id, campaign_id, reviewed_at
     FROM operator_proposals WHERE status = 'sending' LIMIT 100`,
  );
  for (const row of stuck.rows) {
    const action = decideStuckSendingRecovery(
      { campaignId: row.campaign_id || null, reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null },
      new Date(),
      staleMinutes,
    );
    if (action === 'mark_sent') {
      // 발송 커밋됨(마커 있음) → 최종 상태만 마감 + 크래시로 누락됐을 수 있는 크레딧 멱등 보강.
      const upd = await query(
        `UPDATE operator_proposals SET status = 'sent', auto_sent_at = COALESCE(auto_sent_at, NOW())
         WHERE id = $1::uuid AND status = 'sending' AND campaign_id IS NOT NULL RETURNING id`,
        [row.id],
      ).catch(() => ({ rows: [] as any[] }));
      if (upd.rows.length > 0) {
        // 발송 직후(campaign_id 마커)~차감 사이 중단으로 차감이 빠졌을 수 있어 1회 보강.
        // 멱등키 proposalId = dispatchProposalSend의 정상 차감과 동일 키 → 정상분은 skip(중복 0).
        const opRes = await query(
          `SELECT created_by FROM continuous_operators WHERE id = $1::uuid`,
          [row.operator_id],
        ).catch(() => ({ rows: [] as any[] }));
        const createdBy = opRes.rows[0]?.created_by || row.company_id;
        await deductCreditSafe({
          companyId: row.company_id,
          cost: getCreditCost('continuous-operator-send'),
          source: 'continuous-operator-send',
          createdBy,
          idempotencyKey: `continuous-operator-send:${row.id}`,
        }).catch((e: any) => console.warn('[ContinuousOperator AutoSend] 정지복구 크레딧 보강 경고:', e?.message));
      }
    } else if (action === 'demote_admin_review') {
      // 커밋 전 중단(마커 없음) + 노후 → 담당자 검토(절대 자동 재발송 X).
      const upd = await query(
        `UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL,
           auto_execute_reason = '발송 준비 중단 — 담당자 검토 (자동 복구)'
         WHERE id = $1::uuid AND status = 'sending' AND campaign_id IS NULL RETURNING id`,
        [row.id],
      ).catch(() => ({ rows: [] as any[] }));
      if (upd.rows.length > 0) {
        const opRes = await query(
          `SELECT name, admin_phone_numbers, backup_admin_phone FROM continuous_operators WHERE id = $1::uuid`,
          [row.operator_id],
        ).catch(() => ({ rows: [] as any[] }));
        const op = opRes.rows[0] || {};
        await notifyOperatorAdmins(
          { adminPhoneNumbers: Array.isArray(op.admin_phone_numbers) ? op.admin_phone_numbers : [], backupAdminPhone: op.backup_admin_phone || null, companyId: row.company_id },
          '[AI 자동마케팅] 발송 보류', `'${op.name || ''}' 발송 준비가 중단되어 담당자 검토로 전환했습니다.`,
        ).catch(() => {});
      }
    }
  }
}

async function sendScheduledProposal(proposalId: string): Promise<'sent' | 'skipped'> {
  // claim (scheduled → sending) — 동시 발송/중복 방지
  const claim = await query(
    `UPDATE operator_proposals SET status = 'sending', reviewed_at = NOW()
     WHERE id = $1::uuid AND status = 'scheduled' RETURNING *`,
    [proposalId],
  );
  if (claim.rows.length === 0) return 'skipped'; // 다른 패스가 선점했거나 담당자가 정지함
  const p = claim.rows[0];

  // ★ Phase2 D — 자율 발송 직전 예산 재검증. 제안 생성~lead 대기 사이 같은 오퍼레이터의 다른 발송이
  //   예산을 소진했을 수 있어 발송 직전 1회 더 확인. 월/일 = 당월/당일 로그 SUM(누적 컬럼 X — 여정 J2),
  //   status 집합은 listOperators 예산 sub-query와 동일 유지. 초과 또는 검증 불가 시 admin_review 보류(돈 보호 fail-safe, 자동 발송 X).
  //   수동 승인 경로(approveProposal→dispatchProposalSend)는 사람이 이미 검토했으므로 가드 대상 아님 — 자율 발송 전용.
  try {
    const budRes = await query(
      `SELECT o.budget_monthly, o.budget_daily, o.name, o.admin_phone_numbers, o.backup_admin_phone,
         COALESCE((SELECT SUM(cost_estimate) FROM operator_proposals
            WHERE operator_id = o.id AND created_at >= date_trunc('month', NOW())
              AND status IN ('approved','auto_executed','sent')), 0) AS spent_month,
         COALESCE((SELECT SUM(cost_estimate) FROM operator_proposals
            WHERE operator_id = o.id AND created_at >= CURRENT_DATE
              AND status IN ('approved','auto_executed','sent')), 0) AS spent_today
       FROM continuous_operators o WHERE o.id = $1::uuid`,
      [p.operator_id],
    );
    const bud = budRes.rows[0];
    if (bud) {
      const guard = decideBudgetGuard({
        budgetMonthly: bud.budget_monthly != null ? Number(bud.budget_monthly) : null,
        budgetDaily: bud.budget_daily != null ? Number(bud.budget_daily) : null,
        spentMonth: Number(bud.spent_month) || 0,
        spentToday: Number(bud.spent_today) || 0,
        pendingCost: Number(p.cost_estimate) || 0,
      });
      if (guard.over) {
        await query(
          `UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = $2
           WHERE id = $1::uuid AND status = 'sending'`,
          [proposalId, guard.reason],
        );
        await notifyOperatorAdmins(
          { adminPhoneNumbers: Array.isArray(bud.admin_phone_numbers) ? bud.admin_phone_numbers : [], backupAdminPhone: bud.backup_admin_phone || null, companyId: p.company_id },
          '[AI 자동마케팅] 발송 보류', `'${bud.name || ''}' ${guard.reason}. 담당자 검토가 필요합니다.`,
        ).catch(() => {});
        console.log(`[ContinuousOperator AutoSend] ${proposalId} ${guard.reason} → admin_review 보류`);
        return 'skipped';
      }
    }
  } catch (budErr: any) {
    // 예산 검증 실패 = 발송하지 않음(돈 보호). 'sending' 정지 방지 위해 admin_review로 내림.
    await query(
      `UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '예산 검증 오류 — 담당자 검토'
       WHERE id = $1::uuid AND status = 'sending'`,
      [proposalId],
    ).catch(() => {});
    console.error(`[ContinuousOperator AutoSend] ${proposalId} 예산 검증 오류:`, budErr?.message || budErr);
    return 'skipped';
  }

  const r = await dispatchProposalSend(p);
  return r.action;
}

/**
 * claim된('sending') 제안을 직접발송 파이프라인으로 발송 — 자동(scheduled)·수동(승인) 공유.
 * 크레딧은 발송 성공 시점 1회(멱등). 0건/잔액/발신번호 미설정은 skip + 통지.
 */
async function dispatchProposalSend(p: any): Promise<{ action: 'sent' | 'skipped'; campaignId?: string; sentCount?: number; reason?: string }> {
  const proposalId: string = p.id;
  const companyId: string = p.company_id;
  const pj: any = p.proposal_json || {};

  // 통지/발신자 컨텍스트 — 커밋 전 예외는 아래 try가 'sending'을 admin_review로 내려 정지 방지.
  let op: any = {};
  let userId: string = companyId;
  const notify = (title: string, body: string) =>
    notifyOperatorAdmins(
      { adminPhoneNumbers: Array.isArray(op.admin_phone_numbers) ? op.admin_phone_numbers : [], backupAdminPhone: op.backup_admin_phone || null, companyId },
      title, body,
    ).catch((e: any) => console.warn('[ContinuousOperator AutoSend] 통지 경고:', e?.message));

  // ★ Phase2 A — Bandit(Thompson Sampling) 추천 변이를 발송 + 실측 trial 기록.
  //   옛: pj.messages[0] 고정(Bandit 무시·발송 변이 미기록). 변경: 누적 클릭 성과 기반 추천 변이를 보내고
  //   발송 성공 시 그 변이에 sent_count 실측 누적(클릭/전환은 추적 경로에서 별도 누적). 추천 실패/변이 없음 → 0번 fallback.
  let chosenIndex = 0;
  let chosenVariantId: string | null = null;
  try {
    const rec = await recommendVariantForProposal(proposalId, { operatorId: p.operator_id, useAccumulated: true });
    if (rec && Number.isInteger(rec.variantIndex) && rec.variantIndex >= 0 && pj.messages?.[rec.variantIndex]) {
      chosenIndex = rec.variantIndex;
      chosenVariantId = rec.variantId;
    }
  } catch (recErr: any) {
    console.warn('[ContinuousOperator AutoSend] Bandit 추천 실패, 0번 변이 fallback:', recErr?.message);
  }

  // 메시지/채널 (스팸 통과 본문) — 광고 가드에 isAd 필요해 먼저 계산.
  const msg = pj.messages?.[chosenIndex] || pj.messages?.[0] || {};
  const body = String(msg.body || msg.message || '');
  const subject = String(msg.subject || '');
  const channel = String(pj.channel?.recommended || 'SMS').toUpperCase();
  const msgType = (channel === 'LMS' || channel === 'MMS') ? channel : 'SMS';
  // ★ 2026-07-02 (Harold 명시): 자동마케팅 = 무조건 광고 — 과거 저장분(pj.channel.isAd=false)도 광고로 발송.
  //   (광고)·무료거부 080 자동 합성(direct-send-worker) + 080 미설정 시 발송 보류 가드가 전 건 적용된다.
  const isAd = true;

  let stagingId = '';
  let recipientTotal = 0;
  let callback: string | null = null;
  // 발송 타겟 필터 — try 밖(발송 후 예측 분모 적재)에서도 참조하므로 함수 스코프에 둔다.
  // ★ Phase3 C — 리마인드면 미클릭가드(excludeClickedSince)로 1차 클릭 고객 제외.
  const filters = pj.target?.filters || {};
  const excludeClickedSince = pj.meta?.excludeClickedSince ? new Date(pj.meta.excludeClickedSince) : null;
  // filterWhere 컴파일은 try 안에서(throw 시 admin_review 정리 보존) — 값은 발송 후 예측 카운터에서도 쓰므로 스코프 선언.
  let filterWhere = '';
  let filterParams: any[] = [];
  try {
    // operator(통지 대상 · created_by · Phase3 C 시퀀스 설정)
    const opRes = await query(
      `SELECT created_by, name, admin_phone_numbers, backup_admin_phone,
              sequence_enabled, sequence_delay_days, sequence_reminder_content
       FROM continuous_operators WHERE id = $1::uuid`,
      [p.operator_id],
    );
    op = opRes.rows[0] || {};
    userId = op.created_by || companyId;

    // 광고 가드 — 광고면 무료거부 번호(080) 해석 결과 필수(정보통신망법). 없으면 발송 보류(담당자 검토).
    if (isAd) {
      const opt080 = await getOpt080Number(op.created_by || null, companyId);
      if (!opt080) {
        await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '광고 무료거부 번호(080) 미설정 — 발송 보류' WHERE id = $1::uuid`, [proposalId]);
        await notify('[AI 자동마케팅] 발송 보류', `'${op.name || ''}' 광고 무료거부 번호(080)가 없어 발송을 보류했습니다. 080 등록 후 다시 진행해주세요.`);
        return { action: 'skipped', reason: '광고 무료거부 번호(080) 미설정' };
      }
    }

    // 발송 발신번호 먼저 확인 (없으면 staging 적재 자체가 무의미 — 매 사이클 대량 적재+삭제 낭비 차단).
    const cbRes = await query(
      `SELECT REPLACE(phone, '-', '') AS phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1`,
      [companyId],
    );
    callback = cbRes.rows[0]?.phone || null;
    if (!callback) {
      await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '발신번호 미설정 — 발송 보류' WHERE id = $1::uuid`, [proposalId]);
      await notify('[AI 자동마케팅] 발송 보류', `'${op.name || ''}' 등록된 발신번호가 없어 발송을 보류했습니다.`);
      return { action: 'skipped', reason: '발신번호 미설정' };
    }

    // 발송 시점 타겟 재추출 → campaign_send_staging 서버사이드 직접 적재(상한 없음 · Node 왕복 없음).
    //   옛 결함: preview 표본용 buildSendableRecipientsSql(LIMIT 10000)을 발송이 공유 → 1만 초과 조용한 누락.
    //   통제선은 고객 예산·선불 잔액뿐. 정지 창 동안 새 수신거부는 공통 안전필터가 발송 시점에 반영.
    const compiled = buildFilterWhereClauseCompat(filters, 2);
    filterWhere = compiled.sql;
    filterParams = compiled.params;
    stagingId = randomUUID();
    // ★ 2026-07-05 발송 피로도 보호 — 자동마케팅은 광고 강제(0705 라벨 정정)라 cap 설정 회사면 추출 단계에서 제외(차감 전).
    const fatigueCap = await getFatigueCap(companyId);
    const { sql: insSql, params: insParams } = buildSendableStagingInsertSql(stagingId, companyId, filterWhere, filterParams, '', excludeClickedSince, fatigueCap);
    recipientTotal = (await query(insSql, insParams)).rowCount || 0;

    // 0건 → 스킵 + 통지 (operator는 다음 주기 정상). staging 0행이라 잔여 없음.
    const outcome = decideSendOutcome({ recipientCount: recipientTotal, balanceOk: true });
    if (outcome.action === 'skip') {
      await query(`UPDATE operator_proposals SET status = 'skipped', auto_execute_reason = $2 WHERE id = $1::uuid`, [proposalId, outcome.reason]);
      if (outcome.notify) await notify('[AI 자동마케팅] 발송 생략', `'${op.name || ''}' 이번 사이클은 ${outcome.reason}.`);
      return { action: 'skipped', reason: outcome.reason };
    }
  } catch (preErr: any) {
    // 발송 커밋 전 예외 → 'sending' 정지 방지: 담당자 검토로 내리고(자동 재발송 X) 통지 후 재던짐.
    await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '발송 준비 오류 — 담당자 검토' WHERE id = $1::uuid AND status = 'sending'`, [proposalId]).catch(() => {});
    await notify('[AI 자동마케팅] 발송 보류', `'${op.name || ''}' 발송 준비 중 오류로 보류했습니다. 담당자 검토가 필요합니다.`);
    throw preErr;
  }

  // ★ Phase2 A — 발송 변이 추적: 본문 URL을 변이 id로 단축 → 클릭 시 operator 변이에 보상 자동 누적.
  //   journey-executor와 동일하게 검증(스팸테스트) 이후 발송 시점 단축. 단축 실패 시 원본 보존(안전).
  const trackedBody = chosenVariantId
    ? await shortenUrlsInText(body, { companyId, variantId: chosenVariantId }).catch(() => body)
    : body;

  // 발송 (직접발송 파이프라인 공유) — 잔액 부족이면 skip+통지
  let campaignId: string;
  try {
    const res = await createDirectSendCampaign(
      {
        stagingId,
        campaignName: `AI 자동마케팅 ${op.name || ''} ${new Date().toLocaleDateString('ko-KR')}`,
        msgType, message: trackedBody, subject: subject || null, callback, sendChannel: 'sms',
        adEnabled: isAd, total: recipientTotal, dedupEnabled: true, unsubFilterEnabled: true,
      },
      { companyId, userId },
      { finalSource: 'selected_as_is', aiMessages: [trackedBody] },
    );
    campaignId = res.campaignId;
  } catch (e: any) {
    if (e instanceof DirectSendError && e.code === 'INSUFFICIENT_BALANCE') {
      await query(`UPDATE operator_proposals SET status = 'skipped', auto_execute_reason = '잔액 부족 — 발송 생략' WHERE id = $1::uuid`, [proposalId]);
      await notify('[AI 자동마케팅] 발송 생략', `'${op.name || ''}' 잔액 부족으로 이번 사이클 발송을 생략했습니다.`);
      return { action: 'skipped', reason: '잔액 부족' };
    }
    await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '발송 오류 — 담당자 검토' WHERE id = $1::uuid`, [proposalId]).catch(() => {});
    throw e;
  }

  // 발송 커밋 마커 — campaign_id 즉시 기록. 이후 최종 UPDATE가 실패해도 정리 패스가 'sent'로 마감(정지 방지·재발송 X).
  await query(`UPDATE operator_proposals SET campaign_id = $2::uuid WHERE id = $1::uuid`, [proposalId, campaignId]).catch((e: any) => console.warn('[ContinuousOperator AutoSend] campaign_id 기록 경고:', e?.message));

  // ★ 2026-07-03 Gap5 Layer2: 고객별 발송 카운터 (예측 분모 전용, fire-and-forget — 발송·돈 무영향, campaignRef 멱등)
  //   서버사이드 필터 적재라 id를 Node로 안 들고온다(대량 상한 제거와 정합). 발송 추출과 동일 where.
  void recordCustomerSendsByFilter({
    companyId,
    campaignRef: `op:${campaignId}`,
    filterWhere, filterParams, excludeClickedSince,
  });

  // 기능 크레딧 1회 차감 (멱등키 proposalId) — 발송 성공 시점에만.
  //   ★ 'sent' 전환을 차감 성공에 종속: 차감 실패면 status='sending' 유지(campaign_id 마커 있음) →
  //     다음 워커 패스 reconcileStuckSending이 mark_sent + 동일 멱등키로 재차감(유실 0). 발송 자체는 이미 커밋됨.
  let creditDeducted = true;
  try {
    await deductCreditSafe({
      companyId, cost: getCreditCost('continuous-operator-send'), source: 'continuous-operator-send',
      createdBy: userId, idempotencyKey: `continuous-operator-send:${proposalId}`,
    });
  } catch (e: any) {
    creditDeducted = false;
    console.warn('[ContinuousOperator AutoSend] 크레딧 차감 실패 — sending 유지(정지복구가 재차감):', e?.message);
  }

  // 완료 표시(차감 성공 시에만 'sent' 마감) + 통지 — 발송은 커밋됐으므로 통지는 진행.
  if (creditDeducted) {
    await query(
      `UPDATE operator_proposals SET status = 'sent', auto_sent_at = NOW() WHERE id = $1::uuid AND status = 'sending'`,
      [proposalId],
    );
  }
  await notify('[AI 자동마케팅] 발송 완료', `'${op.name || ''}' ${recipientTotal}명에게 발송을 완료했습니다.`);

  // ★ Phase2 A — 발송된 변이에 실측 trial(sent_count) 누적 → 다음 제안 Bandit 추천 정교화(클릭/전환은 추적 경로에서 별도 누적).
  if (chosenVariantId) {
    await recordVariantReward({ variantId: chosenVariantId, sent: recipientTotal, clicked: 0, converted: 0 })
      .catch((e: any) => console.warn('[ContinuousOperator AutoSend] Bandit trial 기록 경고:', e?.message));
  }

  // ★ Phase3 C — 다단계 시퀀스: 1차 발송 성공 시 설정돼 있으면 N일 후 미반응자 리마인드 예약(리마인드의 리마인드는 막음).
  if (op.sequence_enabled === true && pj.meta?.is_reminder !== true) {
    await scheduleSequenceReminder(op, p, pj, companyId).catch((e: any) =>
      console.warn('[ContinuousOperator Sequence] 리마인드 예약 경고:', e?.message));
  }
  return { action: 'sent', campaignId, sentCount: recipientTotal };
}

/**
 * ★ Phase3 C — 다단계 시퀀스 리마인드 예약. 1차 발송 성공 직후 호출.
 *   리마인드 = 같은 오퍼레이터의 'scheduled' 제안(관리자 직접 입력 문안), N일 후 발송 + 1차 후 클릭한 고객 제외
 *   (meta.excludeClickedSince). dispatchProposalSend 공유 발송 → 예산 가드·광고/080 가드 동일 적용.
 *   meta.is_reminder=true 표식으로 리마인드의 리마인드 재귀를 차단한다.
 */
async function scheduleSequenceReminder(op: any, p: any, pj: any, companyId: string): Promise<void> {
  const reminderContent = typeof op.sequence_reminder_content === 'string' ? op.sequence_reminder_content.trim() : '';
  const delayDays = Number(op.sequence_delay_days) || 0;
  if (!reminderContent || delayDays <= 0) return; // 설정 미완 → 리마인드 없음

  const now = new Date();
  const reminderSendAt = shiftToSendableHour(new Date(now.getTime() + delayDays * 24 * 60 * 60 * 1000));
  const expiresAt = new Date(reminderSendAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  // 1차 구조 재사용 + 문안만 관리자 입력 리마인드로 교체 + 재귀 차단(is_reminder)·미클릭 기준(excludeClickedSince) 표식.
  const baseMsg = (pj.messages && pj.messages[0]) || {};
  const reminderPj = {
    ...pj,
    messages: [{ ...baseMsg, body: reminderContent, message: reminderContent }],
    meta: { ...(pj.meta || {}), is_reminder: true, excludeClickedSince: now.toISOString() },
  };

  const ins = await query(
    `INSERT INTO operator_proposals (
       id, operator_id, company_id, proposal_json, recipient_count, cost_estimate,
       status, auto_executed, auto_execute_reason, scheduled_send_at, expires_at, created_at
     ) VALUES (
       gen_random_uuid(), $1::uuid, $2::uuid, $3::jsonb, $4, $5,
       'scheduled', false, '다단계 시퀀스 리마인드 (미반응자)', $6, $7, NOW()
     ) RETURNING id`,
    [p.operator_id, companyId, JSON.stringify(reminderPj), Number(p.recipient_count) || 0, Number(p.cost_estimate) || 0, reminderSendAt, expiresAt],
  );

  // 담당자 리마인드 예약 알림(실문안 + 정지 안내) — 무과금 인증 라인.
  const operatorForNotice = {
    adminPhoneNumbers: Array.isArray(op.admin_phone_numbers) ? op.admin_phone_numbers : [],
    backupAdminPhone: op.backup_admin_phone || null,
    companyId,
    name: op.name || '',
  };
  await sendAutoSendPrepNotice(operatorForNotice, ins.rows[0].id, reminderContent, reminderSendAt, {
    recipientCount: Number(p.recipient_count) || 0,
    costEstimate: Number(p.cost_estimate) || 0,
    channelLabel: String(pj.channel?.recommended || 'SMS').toUpperCase(),
    unitCost: Number(pj.cost?.unitCost) || 0,
  }).catch(() => {});
}

export function startContinuousOperatorScheduler(): void {
  const intervalMs = 60 * 1000; // ★ 2026-06-26: 1분마다 due 체크 (5분→1분) — 지정 시각 ±1분 내 생성(#5 생성 시각 지연 fix). next_run_at 인덱스 + LIMIT 100이라 부하 영향 낮음.
  setInterval(() => {
    runOperatorWorker().catch((err) => {
      console.error('[ContinuousOperator Worker] 예외:', err);
    });
  }, intervalMs);
  // boot 60초 후 1회 실행
  setTimeout(() => {
    runOperatorWorker().catch((err) => {
      console.error('[ContinuousOperator Worker] 초기 실행 예외:', err);
    });
  }, 60 * 1000);
  console.log('[ContinuousOperator Worker] 스케줄러 시작 (1분 주기)');
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

/**
 * ★ D227+ 종량제: AI 오퍼레이션 담당자 알림 — 무과금(회사 발송비 차감 X, 인증 라인 사용 = 우리 서비스 부담).
 * 현재 = 문자(LMS). 알림톡 템플릿 등록 후 = 1순위 알림톡 → 2순위 문자 fallback으로 교체 예정(아래 TODO seam).
 */
// ★ 2026-07-02 2차: 성과 회고(operator-daily-recap)와 공유 — export (담당자 안내 발송 단일 경로 유지)
export async function notifyOperatorAdmins(
  operator: { adminPhoneNumbers: string[]; backupAdminPhone: string | null; companyId: string },
  title: string,
  body: string,
): Promise<void> {
  const phones = [...(operator.adminPhoneNumbers || []), operator.backupAdminPhone || '']
    .map((p) => String(p || '').replace(/\D/g, ''))
    .filter((p) => /^01\d{8,9}$/.test(p));
  const unique = Array.from(new Set(phones));
  if (unique.length === 0) return;

  // TODO(알림톡 템플릿 등록 후): 1순위 알림톡(insertAlimtalkQueue) → 실패 시 아래 문자(2순위)로 fallback.
  // ★ Harold 2026-07-02: 모든 담당자 안내 문자 첫 줄 = [한줄로 AI 자동마케팅 안내문자] (중앙 1곳 부착)
  const wrappedBody = wrapOperatorNoticeBody(body);
  const authTable = await getAuthSmsTable();
  const rows = unique.map((phone) => [
    phone,                  // dest_no
    phone,                  // call_back
    wrappedBody,            // msg_contents
    'L',                    // msg_type (LMS)
    title.slice(0, 40),     // title_str
    null,                   // sendreq_time (useNow)
    '',                     // app_etc1
    operator.companyId,     // app_etc2
    '', '', '',             // file_name 1/2/3
  ]);
  await bulkInsertSmsQueue([authTable], rows as any, true);
}

/** 준비 시점 담당자 알림 — 실문안 1건 + 발송 정보(일시·타겟·비용)와 정지 안내 1건(무과금 인증 라인). admin_notified_at 기록. */
async function sendAutoSendPrepNotice(
  operator: { adminPhoneNumbers: string[]; backupAdminPhone: string | null; companyId: string; name: string },
  proposalId: string,
  messageBody: string,
  scheduledSendAt: Date,
  // ★ 2026-07-02 1단계 (Harold 스펙): 통지 2번 = 발송 일시 + 추출 타겟 수 + 예상 비용(단가 × 수량) + 정지 안내
  info: { recipientCount: number; costEstimate: number; channelLabel: string; unitCost: number },
): Promise<void> {
  const when = scheduledSendAt.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  // 1. 실문안 (고객이 받을 본문 그대로)
  await notifyOperatorAdmins(operator, '[AI 자동마케팅] 발송 예정 문안', messageBody);
  // 2. 발송 정보 + 정지 안내 (순수 빌더 — autosend-policy.test.ts로 고정)
  await notifyOperatorAdmins(
    operator,
    '[AI 자동마케팅] 발송 예정 안내',
    buildAutoSendPrepInfoBody({ sendAtLabel: when, ...info }),
  );
  await query(`UPDATE operator_proposals SET admin_notified_at = NOW() WHERE id = $1::uuid`, [proposalId]);
}

// ★ Phase3 B — 회사 클릭 반응 시간대 기반 발송 시각 개인화.
const SEND_TIME_LOOKBACK_DAYS = 90;       // 클릭 시각 학습 lookback(실데이터 윈도우)
const SEND_TIME_MIN_CLICK_SAMPLE = 20;    // 통계 신뢰 최소 표본(데이터 충분성 가드 — 사업 지표 아님)

/**
 * 발송 예정 시각 = 회사 message_click 시각 히스토그램(KST 시) 피크로 정렬(준비 창 보존).
 * 데이터 부족(표본 부족·시간대 내 클릭 없음)·조회 오류 시 현행 now+lead 폴백(insufficient_data 정직 처리).
 */
async function resolveOptimalScheduledSendAt(companyId: string, leadMinutes: number): Promise<Date> {
  const now = new Date();
  try {
    const hist = await query(
      `SELECT EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Asia/Seoul')::int AS hour, COUNT(*)::int AS count
         FROM cdp_events
        WHERE company_id = $1::uuid AND event_name = 'message_click'
          AND occurred_at >= NOW() - make_interval(days => $2::int)
        GROUP BY 1`,
      [companyId, SEND_TIME_LOOKBACK_DAYS],
    );
    const best = pickBestSendHour(
      hist.rows.map((r: any) => ({ hour: r.hour, count: r.count })),
      SEND_TIME_MIN_CLICK_SAMPLE,
    );
    if (best.hour !== null) {
      console.log(`[ContinuousOperator] 발송 시각 개인화 — ${best.reason}`);
    }
    return computeOptimalSendAt(now, leadMinutes, best.hour);
  } catch (e: any) {
    console.warn('[ContinuousOperator] 발송 시각 개인화 실패, 현행 폴백:', e?.message);
    return computeScheduledSendAt(now, leadMinutes);
  }
}

// (computeNextRun은 autosend-policy.ts computeNextOccurrence로 이동 — 2026-07-02 1단계 B, now 주입형 순수 CT)

function mapRowToOperator(row: any): ContinuousOperator {
  return {
    id: row.id,
    companyId: row.company_id,
    createdBy: row.created_by,
    name: row.name,
    objective: row.objective,
    schedule: row.schedule,
    scheduleTime: row.schedule_time,
    scheduleDayOfWeek: row.schedule_day_of_week ?? null,
    scheduleDayOfMonth: row.schedule_day_of_month ?? null,
    status: row.status,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
    nextRunAt: row.next_run_at ? new Date(row.next_run_at) : null,
    totalProposals: row.total_proposals || 0,
    totalApproved: row.total_approved || 0,
    totalRejected: row.total_rejected || 0,
    totalAutoExecuted: row.total_auto_executed || 0,
    createdAt: new Date(row.created_at),
    // ★ D212+ 5번 (2026-05-23 Harold 명시): 비용 제어 강화 영역 매핑
    budgetMonthly: row.budget_monthly !== null && row.budget_monthly !== undefined ? Number(row.budget_monthly) : null,
    budgetDaily: row.budget_daily !== null && row.budget_daily !== undefined ? Number(row.budget_daily) : null,
    budgetAlertThreshold: Number(row.budget_alert_threshold) || 80,
    budgetSpentMonth: Number(row.budget_spent_month) || 0,
    budgetSpentToday: Number(row.budget_spent_today) || 0,
    // ★ D212+ 정책 (2026-05-23 Harold 명시): 발송 정책 + 검증 + 담당자 영역 매핑
    deliveryPolicy: (row.delivery_policy || 'daily') as 'daily' | 'weekly' | 'monthly',
    verificationRequiredDays: Number(row.verification_required_days) || 7,
    verificationPassedDays: Number(row.verification_passed_days) || 0,
    adminPhoneNumbers: Array.isArray(row.admin_phone_numbers) ? row.admin_phone_numbers : [],
    backupAdminPhone: row.backup_admin_phone || null,
    adminAlertChannel: (row.admin_alert_channel || 'sms') as 'sms' | 'kakao' | 'email',
    optOutMinutes: Number(row.opt_out_minutes) || 5,
    spamScoreThreshold: Number(row.spam_score_threshold) || 30,
    maxSpamRetries: Number(row.max_spam_retries) || 3,
    autoSendLeadMinutes: row.auto_send_lead_minutes !== null && row.auto_send_lead_minutes !== undefined ? Number(row.auto_send_lead_minutes) : null,
    // ★ 2026-07-02 1단계 B: 발송 시각 모드 (컬럼 미존재/ALTER 전 = undefined → 'fixed' 안전 기본)
    sendTimeMode: normalizeSendTimeMode(row.send_time_mode),
    // ★ 2026-07-02 2단계: 문안 스타일 (미존재/NULL = 브랜드 톤 자동)
    copyStyle: normalizeCopyStyle(row.copy_style),
    // ★ 2026-06-26: 발송 채널 + 관리자 입력 혜택
    channel: (['sms', 'lms', 'mms'].includes(row.channel) ? row.channel : 'lms') as 'sms' | 'lms' | 'mms',
    benefitContent: row.benefit_content || null,
    // ★ Phase3 C (2026-06-26): 다단계 시퀀스
    sequenceEnabled: row.sequence_enabled === true,
    sequenceDelayDays: row.sequence_delay_days !== null && row.sequence_delay_days !== undefined ? Number(row.sequence_delay_days) : null,
    sequenceReminderContent: row.sequence_reminder_content || null,
  };
}

function mapRowToProposal(row: any): OperatorProposal {
  return {
    id: row.id,
    operatorId: row.operator_id,
    companyId: row.company_id,
    proposalJson: row.proposal_json || {},
    recipientCount: row.recipient_count || 0,
    costEstimate: row.cost_estimate || 0,
    status: row.status,
    autoExecuted: !!row.auto_executed,
    autoExecuteReason: row.auto_execute_reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    campaignId: row.campaign_id,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
    operatorName: row.operator_name,
    operatorObjective: row.operator_objective,
  };
}
