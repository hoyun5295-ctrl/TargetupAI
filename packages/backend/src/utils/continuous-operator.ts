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

import { query, pool } from '../config/database';
import { orchestrate } from '../services/ai-orchestrator';
import { getCompanyCosts, SEND_HOURS } from '../config/defaults';
import { shouldSkipProposalGeneration } from './operator-proposal-dedup';
// ★ D177 (2026-05-19): Self-Optimizing Bandit — message variants 생성 + Thompson Sampling
import { insertProposalVariants, recommendVariantForProposal, recordVariantReward } from './bandit-optimizer';
// ★ D212+ 정책 (2026-05-23 Harold 명시): CT-64 영역 통합 — 검증 영역 + 담당자 학습
// ★ D227+ 스팸 안전망 격상 — decideSpamOutcome(실제 테스트 결과 → 상태) + buildSpamRegeneratePrompt(AI 재작성)
import { recordAdminStopLearning, decideSpamOutcome, buildSpamRegeneratePrompt } from './continuous-operator-policy';
import { resolveAutoSendLeadMinutes, computeScheduledSendAt, decideSendOutcome, decideStuckSendingRecovery, decideBudgetGuard, decideBudgetAlert, isSendableHourKst, validateScheduleTimeSendable, buildAutoSendPrepInfoBody, buildPendingReviewNoticeBody, computeNextOccurrence, computeNextGenerationRun, normalizeSendTimeMode, SendTimeMode, normalizeCopyStyle, buildCopyStylePromptBlock, CopyStyle, wrapOperatorNoticeBody, normalizeTargetHint, TargetHint, applyBenefitToBody, hasUneditedBenefitPlaceholder } from './autosend-policy';
import { getOpt080Number } from './messageUtils';
// ★ D227+ 검증된 스팸 자산 재사용 (auto-campaign-worker와 동일 패턴) — 실제 테스트폰 발송 + AI 재생성 + 재테스트
import { autoSpamTestWithRegenerate } from './spam-test-queue';
import { generateMessages, stripIncompatibleEmojis } from '../services/ai';
// ★ D227+ 종량제: AI 사이클 크레딧 부족 감지 + 담당자 무과금 알림(인증 라인 재사용)
import { InsufficientCreditError, checkCredit, deductCreditSafe } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { runInCreditBundle } from './ai-credit-context';
// ★ 2026-08-04 변화 축 settle — 캠페인 종결 후 실수신 번호를 발송 큐에서 되읽는다(보호 영역은 읽기만).
import { getAuthSmsTable, bulkInsertSmsQueue, getPlatformNoticeCallback, getCampaignSmsTables, smsSelectAll } from './sms-queue';
// ★ 2026-08-04 리마인드 코호트 — 성공 코드 판정은 결과값 CT 하나만 소유한다.
import { SUCCESS_CODES } from './sms-result-map';
import { randomUUID } from 'crypto';
import { buildSendableStagingInsertSql } from './operator-recipients';
// ★ 2026-08-03 타겟팅 재설계 A-1: 대상 수는 발송과 같은 게이트를 쓰는 단일 문으로만 센다.
import { resolveOperatorAudienceGates, compileOperatorAudience, resolveOperatorStoreScope, assertSegmentUsable } from './operator-audience';
import { AudienceGates } from './operator-recipients';
import { normalizeSegmentKey, normalizeSegmentParams, segmentNeedsCycleBaseline } from './automarketing-segment';
// ★ 2026-08-04 변화 축 — 회차 스냅샷(자동마케팅 고유 어휘의 유일한 근거).
//   기준선 보충(DO NOTHING)과 발송분 갱신(DO UPDATE) 두 문뿐 — 전체 교체는 폐기(Codex R3).
import { hasCycleBaseline, ensureCycleBaselineRows, advanceCycleSnapshotForPhones } from './operator-cycle-snapshot';
import { createDirectSendCampaign } from './direct-send-core';
import { DirectSendError } from './direct-send-spec';
// ★ 2026-07-30 (Codex 2R): MMS 이미지 필수 가드 CT(D131) — 자율발송 경로 배선
import { validateMmsPayload } from './mms-validator';
// ★ 2026-07-03 Gap5 Layer2: 고객별 발송 카운터 (예측 분모 전용 — 타겟 선정 무관)
import { recordCustomerSendsByFilter } from './customer-send-stats';
// ★ 2026-07-05: 발송 피로도 보호 — staging 추출 anti-join용 cap 조회
import { getFatigueCap } from './fatigue-guard';
import { FatigueCap } from './fatigue-guard-core';
// ★ Phase2 A (2026-06-26): 발송 본문 URL 단축 + 변이 추적(클릭→operator 변이 보상). journey-executor와 동일 패턴.
import { shortenUrlsInText } from './short-url';
import { eucKrByteLength } from './message-byte';
// ★ Phase3 B (2026-06-26): 자율 발송 시각을 회사 클릭 반응 시간대로 개인화(데이터 부족 시 현행 폴백).
// ★ Phase3 C (2026-06-26): 리마인드 발송 시각을 발송 가능 시간대로 정렬(shiftToSendableHour).
import { pickBestSendHour, computeOptimalSendAt, shiftToSendableHour } from './send-time-util';
import { buildSeasonPromptBlock, getSeasonContext } from './season-context';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

// ★ 2026-07-05: 'yearly' 신설 — 마케팅 캘린더 시즌 캠페인(연 1회, schedule_month 월 + schedule_day_of_month 일).
export type OperatorSchedule = 'daily' | 'weekly' | 'monthly' | 'yearly';
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
  scheduleDayOfMonth?: number | null;  // 1~31 — monthly·yearly 전용 (말일 초과 시 그 달 말일로 클램프)
  scheduleMonth?: number | null;       // 1~12 — yearly 전용 대상 월 (2026-07-05)
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
  // ★ 2026-07-07 마케팅 캘린더 완비: 발송 대상 축(TARGET_HINTS 화이트리스트) — 제안 생성 때 타겟 AI에 고정 지시.
  targetHint?: string | null;
  // ★ 2026-08-03 타겟팅 재설계 A-7: 세그먼트 계약(축 + 파라미터). 지정 시 회차마다 AI가 다시 해석하지 않는다.
  segmentKey?: string | null;
  segmentParams?: Record<string, number> | null;
  // ★ 2026-07-30 (임은지 접수): 채널 mms 전용 첨부 이미지(serverPath, 최대 3) — 매 자율 발송에 첨부.
  mmsImagePaths?: string[] | null;
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
  scheduleDayOfMonth: number | null;  // 1~31 — monthly·yearly 전용
  scheduleMonth: number | null;       // 1~12 — yearly 전용 대상 월 (2026-07-05)
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
  // ★ 2026-07-07 마케팅 캘린더 완비: 발송 대상 축 — null = 축 미지정(objective 자유 해석)
  targetHint: TargetHint | null;
  /**
   * ★ 2026-08-03 A-7: 세그먼트 계약 축. null = 계약 없음(옛 방식 — 저장된 filters를 그대로 쓴다).
   * 계약이 있으면 대상 조건은 회차마다 같은 SQL로 컴파일된다(결정성).
   * ⛔ 2R 정정: DB 원문 그대로다(화이트리스트 밖 값도 보존). 유효성 판정은 compileOperatorAudience가 한다 —
   *   여기서 깎으면 미지의 축이 "계약 없음"으로 둔갑해 전체 고객 경로로 흐른다.
   */
  segmentKey: string | null;
  segmentParams: Record<string, number> | null;
  // ★ 2026-07-30 (임은지 접수): 채널 mms 첨부 이미지(serverPath) — 컬럼 미생성/NULL = []
  mmsImagePaths: string[];
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
  // ★ 2026-07-07: 발송 예정 시각 — pending에도 저장(표시·경과 승인 경고용). 자율 발송 트리거는 status='scheduled'만.
  scheduledSendAt: Date | null;
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
  const schedule: OperatorSchedule = ['daily', 'weekly', 'monthly', 'yearly'].includes(input.schedule || '') ? input.schedule! : 'daily';
  const scheduleTime = input.scheduleTime || '09:00';
  // ★ 2026-07-12 C-1: 야간 광고 발송 제한 — 자동마케팅은 광고 강제라 발송 희망 시각을 발송 가능 창 안으로만 저장.
  const timeGate = validateScheduleTimeSendable(scheduleTime, SEND_HOURS.start, SEND_HOURS.end);
  if (!timeGate.ok) throw new Error(timeGate.reason);
  const scheduleDayOfWeek = (schedule === 'weekly' && input.scheduleDayOfWeek != null) ? input.scheduleDayOfWeek : null;
  const scheduleDayOfMonth = ((schedule === 'monthly' || schedule === 'yearly') && input.scheduleDayOfMonth != null) ? input.scheduleDayOfMonth : null;
  // ★ 2026-07-05 yearly: 대상 월(1~12) 필수 — 시즌 캠페인 연 1회 (없으면 매월 반복으로 오등록되므로 차단)
  const scheduleMonth = (schedule === 'yearly' && input.scheduleMonth != null && Number(input.scheduleMonth) >= 1 && Number(input.scheduleMonth) <= 12)
    ? Math.floor(Number(input.scheduleMonth)) : null;
  if (schedule === 'yearly' && scheduleMonth === null) {
    throw new Error('연 1회 일정은 대상 월(1~12)을 지정해야 합니다.');
  }
  // ★ 2026-07-02 1단계 B: schedule_time = 발송 희망 시각 — 생성(next_run_at)은 희망 시각 − 준비시간(lead)
  const sendTimeMode = normalizeSendTimeMode(input.sendTimeMode);
  // ★ 2026-07-02 2단계: 문안 스타일 (화이트리스트 밖/미지정 = null → 브랜드 톤 자동)
  const copyStyle = normalizeCopyStyle(input.copyStyle);
  const { nextRunAt } = computeNextGenerationRun(
    schedule, scheduleTime, scheduleDayOfWeek, scheduleDayOfMonth, scheduleMonth,
    resolveAutoSendLeadMinutes(input.autoSendLeadMinutes),
  );

  // ★ 2026-06-26: 생성 시 채널·혜택·담당자·예산도 저장 (기존엔 누락 → 담당자 연락처 드롭·2시간 알림 불가 #3 + 채널 #1 + 혜택 #4 fix)
  const channel = ['sms', 'lms', 'mms'].includes((input.channel || '').toLowerCase()) ? (input.channel as string).toLowerCase() : 'lms';
  let adminPhones = Array.isArray(input.adminPhoneNumbers) ? input.adminPhoneNumbers.filter((p) => typeof p === 'string' && p.trim()).slice(0, 3) : [];
  // ★ 2026-07-07 마케팅 캘린더 완비: 담당자 미입력 = 등록 계정(users.phone) 자동 기본값.
  //   담당자 번호가 비면 notifyOperatorAdmins가 조용히 통지를 생략해 "발송 2시간 전 문안 안내"·승인 대기·D-2
  //   문자가 전부 죽던 구멍의 등록 시점 차단(발송 시점 폴백은 notifyOperatorAdmins에 별도 유지).
  if (adminPhones.length === 0 && input.createdBy) {
    try {
      const creatorRes = await query(`SELECT phone FROM users WHERE id = $1::uuid`, [input.createdBy]);
      const creatorPhone = String(creatorRes.rows[0]?.phone || '').replace(/\D/g, '');
      if (/^01\d{8,9}$/.test(creatorPhone)) adminPhones = [creatorPhone];
    } catch (e: any) {
      console.log('[ContinuousOperator] 등록 계정 연락처 기본값 조회 실패(담당자 없이 생성):', e?.message || e);
    }
  }
  const adminAlertChannel = ['sms', 'kakao', 'email'].includes(input.adminAlertChannel || '') ? input.adminAlertChannel! : 'sms';
  const deliveryPolicy = ['daily', 'weekly', 'monthly'].includes(input.deliveryPolicy || '') ? input.deliveryPolicy! : 'daily';
  const benefitContent = typeof input.benefitContent === 'string' && input.benefitContent.trim() ? input.benefitContent.trim() : null;
  const backupAdminPhone = typeof input.backupAdminPhone === 'string' && input.backupAdminPhone.trim() ? input.backupAdminPhone.trim() : null;
  // ★ Phase3 C: 다단계 시퀀스 — delay 1~30일 클램프, 리마인드 문안 관리자 입력(슬라이스).
  // ★ 2026-08-04 되살림 — 1차 수신자 코호트를 발송결과(MySQL `app_etc1`=캠페인 id)에서 얻을 수 있게 되어
  //   보류 사유(수신자 원장 없음)가 사라졌다. 대상 = 1차 실수신 ∩ 안전필터 ∩ 미클릭 ∩ 피로도(기능 문서 §5).
  const sequenceEnabled = input.sequenceEnabled === true;
  const sequenceDelayDays = typeof input.sequenceDelayDays === 'number' && input.sequenceDelayDays > 0 ? Math.min(30, Math.floor(input.sequenceDelayDays)) : null;
  // 2R(#13): EUC-KR 안전화는 저장 문에서 — 예약 시점에만 걸면 저장·수정 경로가 우회 문이 된다.
  const sequenceReminderContent = typeof input.sequenceReminderContent === 'string' && input.sequenceReminderContent.trim()
    ? stripIncompatibleEmojis(input.sequenceReminderContent).trim().slice(0, 2000) || null : null;
  // ★ 2026-07-07: 타겟 축 — 화이트리스트 정규화(이상값·미지정 = null → 기존 자유 해석).
  const targetHint = normalizeTargetHint(input.targetHint);
  // ★ 2026-07-30 (임은지 접수): MMS 이미지 — 채널 mms일 때만 저장(최대 3장·serverPath 문자열).
  //   컬럼(mms_image_paths text[])은 2026-07-30 운영 ALTER 완료(Harold 실행·코드 배포보다 선행) — 42703 분기 불요.
  const mmsImagePaths = channel === 'mms' && Array.isArray(input.mmsImagePaths)
    ? input.mmsImagePaths.filter((p) => typeof p === 'string' && p.trim()).slice(0, 3)
    : [];

  // ★ 2026-06-02 종량제: 자동마케팅 저장(활성화) = 200 1회. 사전 잔액 확인(선불 부족 차단) → INSERT → 성공 후 차감(멱등키 operatorId).
  // ★ 2026-07-07 DDL 의존: target_hint 컬럼 미생성 시 42703 → 라우트 catch가 503 DB_MIGRATION_PENDING(배포 블록에 ALTER 선행 명시).
  const saveCost = getCreditCost('continuous-operator');
  await checkCredit(input.companyId, saveCost);

  // ★ 2026-08-03 A-7 / ⛔ 2R 정정: 계약을 INSERT 본문에 함께 넣는다.
  //   1R에서는 INSERT 뒤 별도 UPDATE + 실패 시 DELETE 보상이었는데, 그 보상 자체가 결함을 만들었다 —
  //   계약을 안 고른 등록도 UPDATE를 거쳐 일시적 DB 오류에 정상 등록이 지워지고, DELETE가 실패하면
  //   계약 없는 active 행이 남아 워커가 집었다. 한 문장에 넣으면 원자성은 DB가 보장하고 보상 코드는 사라진다.
  //   컬럼 미생성(42703)이면 계약을 고른 등록만 실패한다 — 행도 크레딧도 남지 않는다(라우트가 503).
  const wantsSegment = typeof input.segmentKey === 'string' && input.segmentKey.trim() !== '';
  const segKey = wantsSegment ? normalizeSegmentKey(input.segmentKey) : null;
  if (wantsSegment && !segKey) throw new Error(`알 수 없는 발송 대상 축입니다: ${String(input.segmentKey).slice(0, 40)}`);
  const segParams = segKey ? normalizeSegmentParams(segKey, input.segmentParams) : null;
  // ⛔ 5R 정정: 화이트리스트만 보고 저장하면 그 회사에서 쓸 수 없는 축도 active로 남고 크레딧까지 나간다
  //   (생일 데이터가 없는 회사가 API로 birthday를 보내는 경우). 화면이 잠그는 것과 같은 판정을 서버에서 한 번 더.
  // ⛔ 2026-08-04(R1): 검증은 근거 판정만 — 컴파일로 검증하면 변화 축이 "지난 회차 없음"에 걸려
  //   등록 자체가 안 된다(등록 시점엔 오퍼레이터가 아직 없다). 잠긴 축 사유는 그대로 라우트로 올라간다.
  if (segKey) {
    await assertSegmentUsable(input.companyId, segKey);
  }

  const insertParams: any[] = [
    input.companyId, input.createdBy, input.name, input.objective.trim(),
    schedule, scheduleTime, nextRunAt, scheduleDayOfWeek, scheduleDayOfMonth,
    channel, benefitContent, adminPhones, backupAdminPhone, adminAlertChannel,
    input.autoSendLeadMinutes != null ? input.autoSendLeadMinutes : null,
    input.budgetMonthly != null ? input.budgetMonthly : null,
    input.budgetDaily != null ? input.budgetDaily : null,
    input.budgetAlertThreshold != null ? input.budgetAlertThreshold : 80,
    deliveryPolicy,
    sequenceEnabled, sequenceDelayDays, sequenceReminderContent, sendTimeMode, copyStyle,
    // ⛔ 4R 정정: 대상 모드 상호배타 — 계약을 고른 등록에는 옛 힌트를 남기지 않는다(공존하면 무엇이 조건인지 모른다).
    scheduleMonth, segKey ? null : targetHint,
    mmsImagePaths.length > 0 ? mmsImagePaths : null,
  ];
  // 계약 미지정이면 컬럼을 아예 참조하지 않는다 — 마이그레이션 전에도 옛 등록은 그대로 된다.
  // 계약을 고른 등록은 컬럼이 준비된 뒤에만 받는다(없으면 라우트가 503으로 안내).
  if (segKey && !(await hasSegmentColumns())) {
    throw new Error('DB 마이그레이션 필요 — continuous_operators segment column does not exist');
  }
  let segCols = '';
  let segVals = '';
  if (segKey) {
    insertParams.push(segKey, JSON.stringify(segParams));
    segCols = ', segment_key, segment_params';
    segVals = `, $${insertParams.length - 1}, $${insertParams.length}::jsonb`;
  }
  const result = await query(
    `INSERT INTO continuous_operators (
      id, company_id, created_by, name, objective,
      schedule, schedule_time, schedule_day_of_week, schedule_day_of_month, status, next_run_at,
      channel, benefit_content, admin_phone_numbers, backup_admin_phone, admin_alert_channel,
      auto_send_lead_minutes, budget_monthly, budget_daily, budget_alert_threshold, delivery_policy,
      sequence_enabled, sequence_delay_days, sequence_reminder_content, send_time_mode, copy_style,
      schedule_month, target_hint, mms_image_paths${segCols},
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3, $4,
      $5, $6, $8, $9, 'active', $7,
      $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19,
      $20, $21, $22, $23, $24,
      $25, $26, $27::text[]${segVals},
      NOW(), NOW()
    ) RETURNING *`,
    insertParams,
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

export async function listOperators(companyId: string, scopeUserId?: string | null): Promise<ContinuousOperator[]> {
  // ★ D212+ 5번 (2026-05-23 Harold 명시): budget_spent_month + budget_spent_today 영역 sub-query
  // ★ 2026-07-09 노출 범위: scopeUserId 지정(비관리자)=본인이 만든 자동마케팅만 / null(관리자)=회사 전체.
  const params: any[] = [companyId];
  let ownerFilter = '';
  if (scopeUserId) { params.push(scopeUserId); ownerFilter = `AND o.created_by = $${params.length}::uuid`; }
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
     WHERE o.company_id = $1::uuid AND o.status != 'archived' ${ownerFilter}
     ORDER BY o.status DESC, o.created_at DESC`,
    params
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
    scheduleMonth?: number | null;  // ★ 2026-07-05 yearly 전용 대상 월(1~12)
    status?: OperatorStatus;
    // ★ D212+ 5번 (2026-05-23 Harold 명시): 비용 제어 강화 patch
    budgetMonthly?: number | null;
    budgetDaily?: number | null;
    budgetAlertThreshold?: number;
    // ★ 2026-07-12 C-2 죽은 설정 정리 — deliveryPolicy·verificationRequiredDays·optOutMinutes·
    //   spamScoreThreshold·maxSpamRetries patch 제거(소비 로직 0 — DB 컬럼은 보존, 코드 참조만 정리).
    adminPhoneNumbers?: string[];
    backupAdminPhone?: string | null;
    adminAlertChannel?: 'sms' | 'kakao' | 'email';
    autoSendLeadMinutes?: number | null;
    // ★ 2026-07-12 C-4: 타겟 축 — undefined = 유지, null/화이트리스트 밖 = 해제(자유 해석).
    targetHint?: string | null;
    // ★ 2026-08-03 A-7: 세그먼트 계약 — undefined = 유지, null/화이트리스트 밖 = 해제(옛 방식).
    segmentKey?: string | null;
    segmentParams?: Record<string, number> | null;
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
    // ★ 2026-07-30 (임은지 접수): MMS 이미지 — undefined = 유지, null/[] = 해제, 배열 = 교체(최대 3)
    mmsImagePaths?: string[] | null;
  }
): Promise<ContinuousOperator | null> {
  // ★ 2026-07-12 C-1: 야간 광고 발송 제한 — 발송 희망 시각 변경도 발송 가능 창 안만 허용.
  if (patch.scheduleTime) {
    const timeGate = validateScheduleTimeSendable(patch.scheduleTime, SEND_HOURS.start, SEND_HOURS.end);
    if (!timeGate.ok) throw new Error(timeGate.reason);
  }
  // schedule/scheduleTime/요일/날짜/준비시간 변경 시 next_run_at 재계산 (생성 = 발송 희망 시각 − lead)
  let nextRunAt: Date | null = null;
  let nextDow: number | null = null;
  let nextDom: number | null = null;
  let nextMonth: number | null = null;
  if (patch.schedule || patch.scheduleTime || patch.scheduleDayOfWeek !== undefined || patch.scheduleDayOfMonth !== undefined || patch.scheduleMonth !== undefined || patch.autoSendLeadMinutes !== undefined) {
    const current = await query(
      `SELECT schedule, schedule_time, schedule_day_of_week, schedule_day_of_month, schedule_month, auto_send_lead_minutes FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid`,
      [operatorId, companyId]
    );
    if (current.rows.length === 0) return null;
    const sched = (patch.schedule || current.rows[0].schedule) as OperatorSchedule;
    const time = patch.scheduleTime || current.rows[0].schedule_time;
    nextDow = sched === 'weekly' ? (patch.scheduleDayOfWeek !== undefined ? patch.scheduleDayOfWeek : current.rows[0].schedule_day_of_week) : null;
    nextDom = (sched === 'monthly' || sched === 'yearly') ? (patch.scheduleDayOfMonth !== undefined ? patch.scheduleDayOfMonth : current.rows[0].schedule_day_of_month) : null;
    // ★ 2026-07-05 yearly: 대상 월 — patch 우선, 없으면 기존 값
    nextMonth = sched === 'yearly' ? (patch.scheduleMonth !== undefined ? patch.scheduleMonth : current.rows[0].schedule_month) : null;
    const lead = resolveAutoSendLeadMinutes(
      patch.autoSendLeadMinutes !== undefined ? patch.autoSendLeadMinutes : current.rows[0].auto_send_lead_minutes,
    );
    nextRunAt = computeNextGenerationRun(sched, time, nextDow, nextDom, nextMonth, lead).nextRunAt;
  }

  // ★ 2026-07-12 Codex 정정: 부분 patch가 예산·백업 담당자를 NULL로 덮던 함정 봉합 —
  //   직접 대입 3컬럼(budget_monthly·budget_daily·backup_admin_phone)은 undefined = 현재값 유지(선조회),
  //   null = 명시 해제(무제한/제거) 의미 구분. 예산 가드·임계 알림의 보호선 유실 차단.
  const curRes = await query(
    `SELECT budget_monthly, budget_daily, backup_admin_phone FROM continuous_operators
      WHERE id = $1::uuid AND company_id = $2::uuid`,
    [operatorId, companyId],
  );
  if (curRes.rows.length === 0) return null;
  const cur = curRes.rows[0];
  // ★ 2026-07-30 (임은지 접수·Codex 2R·3R 정정): MMS 이미지 — 본 UPDATE 단문에 포함(부분 커밋 0) + "유지" 판정도
  //   SQL CASE로 같은 시점에(선조회 되쓰기 금지 — 0710 read-modify-write 교훈). undefined = 유지, null/[] = 해제(NULL), 배열 = 교체(최대 3).
  const mmsImagesProvided = patch.mmsImagePaths !== undefined;
  const nextMmsImages = (() => {
    if (!mmsImagesProvided) return null;
    const cleaned = Array.isArray(patch.mmsImagePaths)
      ? patch.mmsImagePaths.filter((p) => typeof p === 'string' && p.trim()).slice(0, 3)
      : [];
    return cleaned.length > 0 ? cleaned : null;
  })();

  // ★ 2026-07-12 C-2: 죽은 설정 SET 제거(delivery_policy·verification_required_days·opt_out_minutes·
  //   spam_score_threshold·max_spam_retries) — 소비 로직 0. DB 컬럼은 보존, 이 UPDATE만 참조 정리.
  // ⛔ 3R 정정: 계약을 본 UPDATE 안에 넣는다. 종전엔 일반 필드를 먼저 커밋하고 계약을 별도 UPDATE했는데,
  //   계약 저장이 실패하면 이름·목표·스케줄만 바뀐 채 대상 계약은 옛것으로 남아(부분 커밋) 다음 회차가
  //   바뀐 목표와 어긋난 대상에 나갈 수 있었다. createOperator와 같은 형태 — 원자성은 DB 한 문장이 보장한다.
  const segTouched = patch.segmentKey !== undefined;
  const segRaw = typeof patch.segmentKey === 'string' ? patch.segmentKey.trim() : '';
  const segSetKey = segRaw ? normalizeSegmentKey(segRaw) : null;
  if (segRaw && !segSetKey) throw new Error(`알 수 없는 발송 대상 축입니다: ${segRaw.slice(0, 40)}`);
  const segSetParams = segSetKey ? normalizeSegmentParams(segSetKey, patch.segmentParams) : null;

  // ⛔ 4R 정정: 대상 모드는 하나여야 한다. 종전엔 target_hint가 본 UPDATE 밖 별도 문이라 부분 커밋됐고,
  //   계약을 골라도 옛 힌트가 남아 공존했다(화면엔 계약만 보이는데 다음 회차는 힌트대로 해석). 계약을 해제하면
  //   프런트가 그 힌트를 다시 보내 되살아나기까지 했다. 한 문장에서 상호배타로 확정한다 —
  //   계약을 설정하면 힌트는 무조건 해제, 계약을 안 건드리면 힌트 패치만 반영.
  const hintTouched = patch.targetHint !== undefined;
  const hintValue = hintTouched ? normalizeTargetHint(patch.targetHint) : null;
  // ⛔ 5R 정정: target_hint 대입은 정확히 한 번이어야 한다. 4R에서 계약 절의 CASE와 힌트 SET이 함께 나가
  //   같은 컬럼 이중 대입으로 저장이 전부 실패했다(현 UI는 계약과 힌트를 늘 함께 보낸다).
  //   최종 대상 모드를 먼저 정하고, 그 결정에서 대입을 하나만 만든다.
  //   계약 설정 = 힌트 강제 해제 / 힌트 설정 = 계약 해제 / 계약 해제만 = 힌트 불변.
  // ⛔ 7R 정정: 두 값이 함께 오면 4R 로직이 서로를 지워 **둘 다 사라졌다**(구버전 클라이언트가 보내면 조용히
  //   자유 해석으로 되돌아간다). 계약 우선으로 원자 적용한다 — 계약이 있으면 계약이 이기고 힌트는 해제.
  const segFinalKey = segSetKey;
  const segFinalParams = segFinalKey ? segSetParams : null;
  const hintAssign: 'none' | 'null' | 'param' =
    segFinalKey ? 'null'          // 계약이 이긴다 — 힌트는 해제
    : hintTouched ? 'param'       // 계약이 없을 때만 힌트 패치를 반영(해제 요청 포함)
    : 'none';
  const withHintParam = hintAssign === 'param';
  // 힌트를 세우는 요청이면 계약도 같은 문장에서 해제한다 — 두 축이 공존할 수 없게.
  const withSegmentSet = segTouched || !!hintValue;
  // ⛔ 5R 정정: 수정으로 계약을 세울 때도 근거 판정을 거친다(등록과 같은 우회를 막는다).
  // ⛔ 2026-08-04(R1): 등록과 같은 이유로 컴파일이 아니라 근거 판정만.
  if (segFinalKey) {
    await assertSegmentUsable(companyId, segFinalKey);
  }

  const runUpdate = (withSegment: boolean) => query(
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
      admin_phone_numbers = COALESCE($12, admin_phone_numbers),
      backup_admin_phone = $13,
      admin_alert_channel = COALESCE($14, admin_alert_channel),
      auto_send_lead_minutes = COALESCE($15, auto_send_lead_minutes),
      schedule_day_of_week = COALESCE($16, schedule_day_of_week),
      schedule_day_of_month = COALESCE($17, schedule_day_of_month),
      channel = COALESCE($18, channel),
      benefit_content = COALESCE($19, benefit_content),
      sequence_enabled = COALESCE($20, sequence_enabled),
      sequence_delay_days = COALESCE($21, sequence_delay_days),
      sequence_reminder_content = COALESCE($22, sequence_reminder_content),
      send_time_mode = COALESCE($23, send_time_mode),
      copy_style = CASE WHEN $24::text = '__keep__' THEN copy_style ELSE NULLIF($24::text, '') END,
      schedule_month = COALESCE($25, schedule_month),
      mms_image_paths = CASE WHEN $26::boolean THEN $27::text[] ELSE mms_image_paths END,
      ${withSegment ? 'segment_key = $28, segment_params = $29::jsonb,' : ''}
      ${hintAssign === 'null' ? 'target_hint = NULL,' : ''}
      ${withHintParam ? `target_hint = $${withSegment ? 30 : 28},` : ''}
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
      patch.budgetMonthly === undefined ? cur.budget_monthly : patch.budgetMonthly,
      patch.budgetDaily === undefined ? cur.budget_daily : patch.budgetDaily,
      patch.budgetAlertThreshold ?? null,
      patch.adminPhoneNumbers ?? null,
      patch.backupAdminPhone === undefined ? cur.backup_admin_phone : patch.backupAdminPhone,
      patch.adminAlertChannel ?? null,
      patch.autoSendLeadMinutes ?? null,
      nextDow,
      nextDom,
      patch.channel ?? null,
      (typeof patch.benefitContent === 'string' && patch.benefitContent.trim()) ? patch.benefitContent.trim() : null,
      // ★ 2026-08-04 되살림 — 코호트 확보(발송결과)로 보류 해제. 켜기·끄기 모두 받는다.
      patch.sequenceEnabled ?? null,
      typeof patch.sequenceDelayDays === 'number' && patch.sequenceDelayDays > 0 ? Math.min(30, Math.floor(patch.sequenceDelayDays)) : null,
      // 2R(#13): 수정 경로도 저장 시 EUC-KR 안전화(등록과 같은 문).
      (typeof patch.sequenceReminderContent === 'string' && patch.sequenceReminderContent.trim())
        ? stripIncompatibleEmojis(patch.sequenceReminderContent).trim().slice(0, 2000) || null : null,
      patch.sendTimeMode !== undefined ? normalizeSendTimeMode(patch.sendTimeMode) : null,
      // copy_style: undefined = 유지('__keep__'), 그 외 = 정규화 값 or ''(해제 → SQL NULLIF로 null)
      patch.copyStyle === undefined ? '__keep__' : (normalizeCopyStyle(patch.copyStyle) ?? ''),
      nextMonth,
      mmsImagesProvided,
      nextMmsImages,
      ...(withSegment ? [segFinalKey, segFinalParams ? JSON.stringify(segFinalParams) : null] : []),
      ...(withHintParam ? [hintValue] : []),
    ]
  );

  // ⛔ 8R 정정 + 재검토: 42703 눈감기 폴백은 없앴다(부분 스키마에서 계약이 남은 채 힌트만 기록됐다).
  //   대신 스키마를 실제로 보고 가른다 — 준비됐으면 쓰고, 아직이면 계약을 **세우는** 요청만 막는다.
  //   폴백을 통째로 지우면 배포~DDL 구간에 일반 수정까지 전부 막혀 기능이 멈춘다(그건 처방이 아니라 사고다).
  const segColumnsReady = withSegmentSet ? await hasSegmentColumns() : false;
  if (segFinalKey && !segColumnsReady) {
    throw new Error('DB 마이그레이션 필요 — continuous_operators segment column does not exist');
  }
  const result = await runUpdate(withSegmentSet && segColumnsReady);
  if (result.rows.length === 0) return null;
  const updated = mapRowToOperator(result.rows[0]);

  // ★ 2026-08-04(Codex M7): 리마인드를 끄면 아직 안 나간 예약분도 함께 멈춘다 — 설정 OFF가 미래 발송에
  //   즉시 반영돼야 한다("껐는데 나갔다"는 과다 발송 클레임이다). 이미 나간 것·발송 진행 중(sending)은 그대로.
  //   2R(#10): 실패를 삼키지 않는다 — 1회 재시도 후에도 실패면 담당자 통지(예약이 살아 있을 수 있다는 사실).
  if (patch.sequenceEnabled === false) {
    const cancelSql = `UPDATE operator_proposals SET status = 'admin_stopped', scheduled_send_at = NULL, reviewed_at = NOW(),
          auto_execute_reason = '리마인드 사용 해제 — 예약 취소'
        WHERE operator_id = $1::uuid AND company_id = $2::uuid
          AND status IN ('scheduled', 'admin_review', 'pending')
          AND COALESCE((proposal_json -> 'meta' ->> 'is_reminder')::boolean, false) = true`;
    let cancelOk = false;
    for (let attempt = 0; attempt < 2 && !cancelOk; attempt++) {
      try { await query(cancelSql, [operatorId, companyId]); cancelOk = true; }
      catch (e: any) { console.warn(`[ContinuousOperator] 리마인드 예약 취소 ${attempt + 1}차 실패:`, e?.message); }
    }
    if (!cancelOk) {
      await notifyOperatorAdmins(
        {
          adminPhoneNumbers: updated.adminPhoneNumbers || [], backupAdminPhone: updated.backupAdminPhone || null,
          companyId, createdBy: updated.createdBy || null,
        },
        '[AI 자동마케팅] 확인 필요',
        `'${updated.name || ''}' 리마인드를 껐지만 기존 예약 취소가 실패했습니다. 자동마케팅 화면에서 예약 발송을 확인해 주세요.`,
      ).catch((e: any) => console.warn('[ContinuousOperator] 취소 실패 통지 경고:', e?.message));
    }
  }

  // ★ 2026-07-12 C-1: 일시 중지·보관 전환 시 예약된 자율 발송(scheduled) 동반 취소 — "중지했는데 발송" 차단.
  if (patch.status === 'paused' || patch.status === 'archived') {
    await cancelScheduledProposalsForOperator(operatorId, '자동마케팅 중지 — 예약 발송 취소')
      .catch((e: any) => console.warn('[ContinuousOperator] 예약 발송 취소 경고:', e?.message));
  }
  return updated;
}

/** ★ 2026-07-12 C-1: 오퍼레이터 중지·보관 시 예약된 자율 발송(scheduled) 일괄 취소 — 리마인드 포함. */
async function cancelScheduledProposalsForOperator(operatorId: string, reason: string): Promise<number> {
  const r = await query(
    `UPDATE operator_proposals SET status = 'admin_stopped', scheduled_send_at = NULL, auto_execute_reason = $2, reviewed_at = NOW()
      WHERE operator_id = $1::uuid AND status = 'scheduled' RETURNING id`,
    [operatorId, reason],
  );
  return r.rows.length;
}

export async function archiveOperator(companyId: string, operatorId: string): Promise<boolean> {
  const result = await query(
    `UPDATE continuous_operators SET status = 'archived', updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid RETURNING id`,
    [operatorId, companyId]
  );
  if (result.rows.length === 0) return false;
  // ★ 2026-07-12 C-1: 보관(중지) 시 예약된 자율 발송 동반 취소 — "중지했는데 발송" 차단.
  await cancelScheduledProposalsForOperator(operatorId, '자동마케팅 중지(보관) — 예약 발송 취소')
    .catch((e: any) => console.warn('[ContinuousOperator] 보관 시 예약 발송 취소 경고:', e?.message));
  return true;
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
  // ★ 2026-07-28: 상위 등급 전용 자격(자율 발송). plans.advanced_access_enabled가 진실의 원천이고,
  //   컬럼 신설 전에는 옛 하드코딩 규칙(ENTERPRISE|BUSINESS)으로 폴백한다.
  advanced_access_enabled: boolean;
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

  // ★ 2026-08-04 변화 축 — 첫 회차는 기준을 잡는 회차다.
  //   "지난 회차와 지금 사이에 무엇이 달라졌나"는 비교할 과거가 있어야 성립한다. 과거가 없는데
  //   조건을 만들면 아무도 못 맞히는 술어가 되어 조용한 0건이 된다 — 우리가 고치려는 병 그 자체다.
  //   그래서 이 회차는 제안을 만들지 않고 기준선만 심고, 무슨 일이 일어났는지 담당자에게 알린다.
  //   ⛔ 기준선 기록이 실패하면 제안도 만들지 않는다(다음 회차 재시도). 과거 없이 발송하는 쪽이 훨씬 나쁘다.
  if (segmentNeedsCycleBaseline(operator.segmentKey)) {
    if (!(await hasCycleBaseline(operator.id, operator.companyId))) {
      try {
        const snap = await ensureCycleBaselineRows(operator.id, operator.companyId);
        console.log(`[ContinuousOperator] ${operator.name} 변화 축 기준선 ${snap.inserted}건 기록 → 이번 회차 제안 없음`);
        // 통지 0건(연락처 없음·큐 적재 실패)은 false로 돌아온다 — 조용히 성공으로 두지 않는다(Codex 조용한0건3).
        const notified = await notifyOperatorAdmins(
          operator,
          '[AI 자동마케팅] 기준을 잡았습니다',
          `'${operator.name}'은(는) 지난번과 달라진 점을 찾아 보내는 조건입니다. 이번 회차는 비교 기준을 잡았고, 다음 회차부터 대상이 잡힙니다.`,
        ).catch(() => false);
        if (!notified) console.warn(`[ContinuousOperator] ${operator.name} 기준선 통지 미발송(담당자 연락처·큐 확인 필요)`);
      } catch (e: any) {
        console.warn(`[ContinuousOperator] ${operator.name} 기준선 기록 실패 → 이번 회차 생성 없음:`, e?.message);
        // 실패를 정상 "제안 없음"과 섞지 않는다 — 담당자에게 사유를 알린다(다음 회차 자동 재시도).
        // 2R(F8): 통지 함수는 연락처 없음·큐 0건이면 false를 돌려준다 — reject만 잡으면 그 침묵이 조용하다.
        const failNotified = await notifyOperatorAdmins(
          operator,
          '[AI 자동마케팅] 기준 잡기 실패',
          `'${operator.name}' 발송 대상의 비교 기준을 잡지 못했습니다. 다음 회차에 다시 시도합니다. 반복되면 담당자 확인이 필요합니다.`,
        ).catch((e2: any) => { console.warn('[ContinuousOperator] 기준선 실패 통지 경고:', e2?.message); return false; });
        if (!failNotified) console.warn(`[ContinuousOperator] ${operator.name} 기준선 실패 통지 미발송(담당자 연락처·큐 확인 필요)`);
      }
      await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
      return null;
    }
    // 기준선 있음 — 그 뒤 들어온 신규 고객만 지금 모습으로 보충한다(DO NOTHING — 기존 행 무접촉, Codex R3 문①).
    //   이게 없으면 기준선 이후 등록된 고객은 스냅샷 행이 없어 변화 축에서 영구 제외된다.
    //   실패해도 회차는 진행한다 — 새 고객이 이번 회차에 안 잡힐 뿐이고(fail-closed), 다음 회차가 다시 보충한다.
    await ensureCycleBaselineRows(operator.id, operator.companyId)
      .then((s) => { if (s.inserted > 0) console.log(`[ContinuousOperator] ${operator.name} 신규 고객 기준선 보충 ${s.inserted}건`); })
      .catch((e: any) => console.warn(`[ContinuousOperator] ${operator.name} 기준선 보충 경고:`, e?.message));
  }

  // 2. 회사 컨텍스트 + 자동 실행 옵션 조회
  const ctxRes = await query(
    `SELECT c.company_name, c.business_type, c.brand_name, c.brand_slogan,
            c.brand_description, c.brand_tone, c.customer_schema,
            COALESCE(c.reject_number, c.opt_out_080_number) AS reject_number,
            c.cost_per_sms, c.cost_per_lms, c.cost_per_mms, c.cost_per_kakao, c.unit_price_basis,
            COALESCE(c.cdp_auto_execute_enabled, false) AS cdp_auto_execute_enabled,
            COALESCE(c.cdp_auto_execute_max_recipients, 1000) AS cdp_auto_execute_max_recipients,
            COALESCE(c.cdp_auto_execute_max_cost_krw, 50000) AS cdp_auto_execute_max_cost_krw,
            COALESCE(c.cdp_auto_execute_max_risk, 'low') AS cdp_auto_execute_max_risk,
            COALESCE(p.plan_code, 'FREE') AS plan_code,
            -- ★ 2026-07-28 자율 발송 자격을 plans 플래그로. ALTER 전에는 옛 규칙으로 폴백(to_jsonb는 없는 키를 NULL로 준다).
            COALESCE(
              (to_jsonb(p) ->> 'advanced_access_enabled')::boolean,
              p.plan_code IN ('ENTERPRISE', 'BUSINESS'),
              false
            ) AS advanced_access_enabled
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
      // ★ 2026-07-07: 타겟 축 고정(마케팅 캘린더 완비) — 발송 당일 타겟 해석이 등록 때 고른 축에 앵커.
      targetHint: operator.targetHint,
      // ★ 2026-08-03 A-7: 계약이 있으면 대상 조건은 계약이 만든다 — 타겟 AI 해석 결과를 쓰지 않는다(결정성).
      segmentKey: operator.segmentKey,
      segmentParams: operator.segmentParams,
      // ★ 2026-08-04: 변화 축이 비교할 지난 회차 스냅샷의 주인. 상태 축은 이 값을 쓰지 않는다.
      operatorId: operator.id,
      // ⛔ 1R 정정: 자동마케팅 회차임을 명시. 이 플래그가 있어야 발송 게이트가 붙은 대상 수를 쓴다.
      audienceScope: 'operator',
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
    // ★ 2026-08-03 A-5: 조용한 0건 제거. 오발송은 종전에도 막았지만 사유가 담당자에게 가지 않아
    //   "왜 이번 달은 아무것도 안 왔지"를 알 길이 없었다. 반복 0건은 7일 쿨다운으로 수렴시킨다.
    await notifyZeroTargetOnce(operator, orchestratorResult.meta?.countError || null);
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }
  // 대상이 다시 잡히면 0건 통지 쿨다운 해제 — 다음 0건에 즉시 알린다(수렴 형태).
  await clearZeroTargetNotice(operator.id);

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
    // ★ 2026-07-28 요금제 코드 직접 비교 → plans 플래그. 회사별 옵션(cdp_auto_execute_enabled)이
    //   여전히 앞단에 있으므로, 요금제만으로 자율 발송이 켜지지는 않는다.
    ctx.advanced_access_enabled &&
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
        !ctx.advanced_access_enabled && '요금제',
        recipientCount > ctx.cdp_auto_execute_max_recipients && `${recipientCount}건 > ${ctx.cdp_auto_execute_max_recipients}`,
        costEstimate > ctx.cdp_auto_execute_max_cost_krw && `${costEstimate}원 > ${ctx.cdp_auto_execute_max_cost_krw}원`,
        !riskWithinThreshold && `compliance ${compliance.riskLevel} > 회사 max ${ctx.cdp_auto_execute_max_risk}`,
        !compliance.passed && 'compliance fail',
        !canAutoSend && '발신번호·문안·채널(SMS/LMS) 미충족',
        !adRejectOk && '광고 무료거부 번호(080) 미설정',
      ].filter(Boolean).join(', ')}`;

  // 7. 제안서 INSERT — auto-eligible은 'scheduled'(T에 자율 발송), 아니면 'pending'(수동 검토).
  //    ★ 2026-07-07: scheduled_send_at은 pending에도 저장(발송 희망 시각 표시 + 예정일 경과 승인 경고).
  //      자율 발송 트리거(runAutoSendPass)는 status='scheduled' 게이트라 pending 값 저장은 발송에 영향 0 — 소비처 17곳 전수 확인.
  const leadMinutes = resolveAutoSendLeadMinutes(operator.autoSendLeadMinutes);
  // ★ 2026-07-02 1단계 B (Harold 스펙): schedule_time = 발송 희망 시각.
  //   fixed(기본) = 희망 시각 정각 발송 — 생성 워커가 희망 − lead에 돌므로 다음 occurrence가 이번 주기 희망 시각.
  //   ai_optimal(명시 선택) = Phase3 B 클릭 피크 개인화(준비 창 보존·데이터 부족 시 now+lead 폴백) 유지.
  // ★ 2026-07-12 C-1: fixed 모드도 발송 가능 창 클램프 — 신규 저장은 시각 가드로 차단되지만 기존 야간 설정 행 방어.
  //   (ai_optimal은 computeOptimalSendAt이 자체 클램프, 리마인드는 shiftToSendableHour 기적용 — 3경로 전부 봉합)
  const scheduledSendAt = operator.sendTimeMode === 'ai_optimal'
    ? await resolveOptimalScheduledSendAt(operator.companyId, leadMinutes)
    : shiftToSendableHour(computeNextOccurrence(operator.schedule, operator.scheduleTime, operator.scheduleDayOfWeek, operator.scheduleDayOfMonth, operator.scheduleMonth));
  const proposalRes = await query(
    `INSERT INTO operator_proposals (
      id, operator_id, company_id, proposal_json, recipient_count, cost_estimate,
      status, auto_executed, auto_execute_reason, scheduled_send_at, expires_at, created_at
    )
    -- ★ 2026-08-05: "리마인드가 아닌 scheduled는 오퍼레이터당 1건" 계약을 **문장 안에서** 지킨다.
    --   종전엔 위 openProps 확인(잠금 없음)과 이 INSERT 사이에 수십 초짜리 AI 호출이 있어, 동시 run-now
    --   두 건이 둘 다 "예약 없음"을 읽고 둘 다 INSERT → 같은 회차 2회 발송·2회 과금이 가능했다.
    --   VALUES를 SELECT ... WHERE NOT EXISTS로 바꿔 확인과 삽입을 한 문장으로 묶는다(창이 수십 초 → 문장 내부).
    --   ⛔ 부분 UNIQUE 인덱스는 최종 방어로 남는다 — 완전 동시 실행은 스냅샷이 갈려 이 WHERE를 둘 다 통과할 수 있다.
    --   Codex 1R high 반영: 인덱스가 아직 없는 창(배포~DDL)에서도 이 WHERE가 실질 방어를 한다.
    --   캐스팅은 information_schema 실측 타입(2026-08-05 확인)으로만 — 짐작 캐스팅 금지.
    SELECT gen_random_uuid(), $1::uuid, $2::uuid, $3::jsonb, $4::integer, $5::integer,
           $6::varchar, $7::boolean, $8::text, $9::timestamptz, NOW() + INTERVAL '7 days', NOW()
     WHERE $6::varchar <> 'scheduled'
        OR NOT EXISTS (
             SELECT 1 FROM operator_proposals
              WHERE operator_id = $1::uuid AND status = 'scheduled'
                AND COALESCE(proposal_json->'meta'->>'is_reminder', 'false') <> 'true'
           )
    ON CONFLICT DO NOTHING
    RETURNING *`,
    [
      operator.id,
      operator.companyId,
      JSON.stringify(orchestratorResult),
      recipientCount,
      costEstimate,
      autoExecuteEligible ? 'scheduled' : 'pending',
      autoExecuteEligible,
      autoExecuteReason,
      scheduledSendAt,
    ]
  );

  // 0행 = 위 WHERE(또는 부분 UNIQUE 인덱스)가 막았다 = 이 오퍼레이터에 이미 예약된 회차가 있다(동시 실행).
  //   발송·과금 중복보다 이번 회차 제안 하나를 포기하는 쪽이 싸다(AI 비용 1회 손실 < 2회 발송·2회 과금).
  //   run-now는 라우트가 "0건 매칭"과 구분해 안내한다(routes/ai.ts — 기준선 안내보다 먼저 판정).
  if (proposalRes.rows.length === 0) {
    console.log(`[ContinuousOperator] ${operator.name} 동시 생성 감지 — 이미 예약된 회차가 있어 신규 제안 미생성`);
    await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);
    return null;
  }

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

// (adminConfirmProposal 제거 — 2026-07-12 C-2: 프론트 호출 0건의 죽은 라우트 전용 함수였고,
//  검증 7일 게이팅 폐기로 verification_passed_days 누적도 죽은 카운터였다. 컬럼은 보존.)

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
  let mon: number | null = null;
  let lead: number | null = null;
  try {
    const dayRes = await query(
      `SELECT schedule_day_of_week, schedule_day_of_month, schedule_month, auto_send_lead_minutes FROM continuous_operators WHERE id = $1::uuid`,
      [operatorId]
    );
    dow = dayRes.rows[0]?.schedule_day_of_week ?? null;
    dom = dayRes.rows[0]?.schedule_day_of_month ?? null;
    mon = dayRes.rows[0]?.schedule_month ?? null;
    lead = dayRes.rows[0]?.auto_send_lead_minutes ?? null;
  } catch { /* 컬럼 미존재 시 기존 동작 유지 */ }
  // ★ 2026-07-02 1단계 B: 다음 생성 = 다음 발송 희망 시각 − 준비시간 (같은 주기 재선정 없음 — computeNextGenerationRun이 보장)
  const nextRunAt = computeNextGenerationRun(schedule, scheduleTime, dow, dom, mon, resolveAutoSendLeadMinutes(lead)).nextRunAt;
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
  limit: number = 50,
  scopeUserId?: string | null,
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
  // ★ 2026-07-09 노출 범위: scopeUserId 지정(비관리자)=본인이 만든 operator의 제안만 / null(관리자)=회사 전체.
  let ownerFilter = '';
  if (scopeUserId) { params.push(scopeUserId); ownerFilter = `AND o.created_by = $${params.length}::uuid`; }
  params.push(Math.min(limit, 200));
  const result = await query(
    `SELECT p.*, o.name AS operator_name, o.objective AS operator_objective
     FROM operator_proposals p
     LEFT JOIN continuous_operators o ON p.operator_id = o.id
     WHERE p.company_id = $1::uuid ${statusFilter} ${ownerFilter}
     ORDER BY p.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(mapRowToProposal);
}

export async function approveProposal(
  companyId: string,
  proposalId: string,
  userId: string,
  // ★ 2026-07-09 문안 3안: 사용자가 고른 변형 index + (편집 시) 본문/제목. null이면 Bandit 추천(자동 발송 경로와 동일).
  selection?: { variantIndex: number; body?: string; subject?: string } | null,
): Promise<{ ok: boolean; reason?: string; action?: 'sent' | 'skipped'; campaignId?: string; sentCount?: number }> {
  // 사용자 선택을 proposal_json.userSelection에 병합 — dispatchProposalSend가 이 값을 우선 사용(없으면 Bandit).
  const selJson = selection && Number.isInteger(selection.variantIndex) && selection.variantIndex >= 0
    ? JSON.stringify({
        variantIndex: selection.variantIndex,
        ...(typeof selection.body === 'string' && selection.body.trim() ? { body: selection.body } : {}),
        ...(typeof selection.subject === 'string' ? { subject: selection.subject } : {}),
      })
    : null;
  // claim: pending/admin_review → sending. 백엔드에서 바로 발송(자동 경로와 동일)해 크레딧↔발송 원자성 확보.
  const claim = await query(
    `UPDATE operator_proposals SET
       status = 'sending',
       reviewed_by = $3::uuid,
       reviewed_at = NOW(),
       proposal_json = CASE WHEN $4::jsonb IS NOT NULL
         THEN jsonb_set(proposal_json, '{userSelection}', $4::jsonb, true)
         ELSE proposal_json END
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('pending', 'admin_review')
     RETURNING *`,
    [proposalId, companyId, userId, selJson]
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

  // ★ 2026-07-12 C-1: 야간 승인 = 즉시 발송 대신 다음 발송 가능 시각(오전 9시) 자율 발송 예약(광고 야간 전송 제한).
  //   userSelection은 이미 proposal_json에 병합돼 있어 예약 발송에도 그대로 반영된다.
  const nowApprove = new Date();
  if (!isSendableHourKst(nowApprove, SEND_HOURS.start, SEND_HOURS.end)) {
    const sendAt = shiftToSendableHour(nowApprove);
    try {
      await query(
        `UPDATE operator_proposals SET status = 'scheduled', scheduled_send_at = $2
         WHERE id = $1::uuid AND status = 'sending'`,
        [proposalId, sendAt],
      );
    } catch (e: any) {
      // ★ 2026-08-05: "리마인드 아닌 scheduled는 오퍼레이터당 1건" 부분 UNIQUE 인덱스 위반(23505).
      //   INSERT만 막으면 이 경로가 남는다 — 야간 승인은 sending을 scheduled로 되돌리므로 같은 계약에 걸린다.
      //   이미 예약된 회차가 있는데 두 번째를 만들면 같은 회차에 두 번 나간다 → 승인을 거절한다.
      //   claim으로 이미 'sending'이 됐으므로 담당자 검토로 되돌린다(발송은 아직 없었다).
      const dup = e?.code === '23505' || String(e?.message || '').includes('ux_operator_proposals_one_scheduled');
      if (!dup) throw e;
      await query(
        `UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL,
           auto_execute_reason = '이미 예약된 발송이 있어 승인하지 않았습니다 — 기존 예약 처리 후 다시 승인해 주세요'
         WHERE id = $1::uuid AND status = 'sending'`,
        [proposalId],
      ).catch((err: any) => console.warn('[ContinuousOperator] 승인 되돌리기 경고:', err?.message));
      // 위에서 올린 승인 카운트를 되돌린다 — 승인되지 않았으므로 통계가 그대로면 거짓이다.
      await query(
        `UPDATE continuous_operators SET total_approved = GREATEST(total_approved - 1, 0) WHERE id = $1::uuid`,
        [claim.rows[0].operator_id],
      ).catch(() => {});
      return { ok: false, reason: '이미 이번 회차 발송이 예약되어 있습니다. 기존 예약이 끝나거나 취소된 뒤 승인해 주세요.' };
    }
    const label = sendAt.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return { ok: true, action: 'skipped', reason: `야간에는 광고 발송이 제한되어 지금은 발송하지 않습니다. ${label}에 자동 발송되도록 예약했습니다. 발송 전까지 [정지] 버튼으로 취소할 수 있습니다.` };
  }

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
  // ★ 2026-08-04 리마인드 되살림 — 보류기의 격리 장치 3종(매 패스 admin_stopped 수렴 · due 제외 ·
  //   sendScheduledProposal 차단)을 전부 제거했다. 보류 사유(1차 수신자 원장 없음)가 해소됐는데 장치가
  //   하나라도 남으면 "예약은 되는데 다음 패스가 전부 정지시키는" 반쪽 되살림이 된다(Codex 1R-b).
  //   옛 형식(코호트 정보 없는 배포 전 예약분)은 dispatch 코호트 분기가 primary_campaign_id 부재로
  //   취소+통지하므로 1차 미수신자에게 나갈 길은 그대로 닫혀 있다 — fail-closed는 그 한 곳이 소유한다.
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
  // ★ 2026-08-04(R4): 변화 축 회차 마감 대조 — 캠페인 종결을 확인한 뒤에만 스냅샷을 전진시킨다.
  //   크래시로 마커만 남아도 이 패스가 매번 다시 본다(마커가 durable이라 수렴).
  await settlePendingCycleSnapshots().catch((e: any) => console.error('[ContinuousOperator Settle] 마감 대조 예외:', e?.message || e));
  // ★ 2026-08-05: 정산 대조 — 발송은 나갔는데 차감이 확정되지 않은 제안을 상태와 무관하게 다시 본다.
  //   마커가 durable이라 크래시로도 잃지 않는다(회차 스냅샷 대조와 같은 형태).
  await settlePendingCharges().catch((e: any) => console.error('[ContinuousOperator Charge] 정산 대조 예외:', e?.message || e));
  // ★ 2026-08-04 2R(#3·c): 크래시로 '스팸 검증 중'에 잔존한 리마인드 대조 — 자동 발송으로는 못 넘어가지만
  //   (admin_review = due 밖) 사유가 영원히 "검증 중"이면 화면이 거짓말이다. 10분 넘은 행을 확인 요청으로 전환+통지.
  await sweepStaleSpamPendingReminders().catch((e: any) => console.error('[ContinuousOperator Sequence] 검증 잔존 대조 예외:', e?.message || e));

  if (due.rows.length > 0) {
    console.log(`[ContinuousOperator AutoSend] ${sent} 발송 / ${skipped} 스킵`);
  }
  return { sent, skipped };
}

/**
 * ★ 2026-08-04 — 캠페인 실수신 번호 단일 문. settle(변화 축 회차 마감)과 리마인드 코호트가 같은 문을 쓴다.
 *
 * 원천 = 발송 큐(MySQL) `dest_no`, `app_etc1` = campaigns.id(직접발송 경로 실측 — direct-send-worker).
 * LOG 월 경계: 발송월과 지금월 두 기준으로 테이블을 합쳐 본다 — 리마인드 창(최대 30일)이 월을 넘으면
 * 행이 발송월 LOG에 있는데 지금월만 보면 통째로 놓친다(리마인드 확인 5의 함정).
 * `dest_no` 하이픈 정규화 후 PG 쪽(regexp_replace 숫자만)과 같은 기준으로 다시 숫자만 남긴다.
 * ⛔ 보호 영역 파일은 읽기만 — 테이블 해석은 sms-queue CT(getCampaignSmsTables) 재사용.
 */
export async function readCampaignQueuedPhones(
  companyId: string,
  campaignId: string,
  camp: { send_config?: any; created_by?: string | null; ref_date?: any },
  // ★ 리마인드 전용 — 성공 코드(SUCCESS_CODES)만. "1차를 받은 분"이 계약이라 실패·대기 번호에 리마인드가
  //   가면 받은 적 없는 리마인드다(이 기능의 금기 — Codex 1R). settle은 미지정(큐 적재 = 발송 경계 유지).
  //   export 소비처 = routes/ai.ts 리마인드 명단 화면(발송과 같은 코호트 — 보여준 수 = 나가는 수).
  opts?: { successOnly?: boolean },
): Promise<string[]> {
  const refDates = [camp.ref_date ? new Date(camp.ref_date) : new Date(), new Date()];
  const tableSet = new Set<string>();
  for (const rd of refDates) {
    for (const t of await getCampaignSmsTables(companyId, rd, camp.created_by || undefined, camp.send_config)) {
      tableSet.add(t);
    }
  }
  // ⛔ selectFields에 DISTINCT 금지 — smsSelectAll이 앞에 `_sms_table` 리터럴 컬럼을 붙여
  //   `SELECT 'T' AS _sms_table, DISTINCT ...`가 되면 MySQL 문법 오류다(Codex 1R 적발). 중복은 아래 Set이 제거.
  const where = opts?.successOnly
    ? `app_etc1 = ? AND status_code IN (${SUCCESS_CODES.join(', ')})`
    : 'app_etc1 = ?';
  const rows = await smsSelectAll(
    Array.from(tableSet), `REPLACE(dest_no, '-', '') AS phone`, where, [campaignId],
  );
  return Array.from(new Set(
    rows.map((x: any) => String(x.phone || '').replace(/\D/g, '')).filter((p: string) => p.length > 0),
  ));
}

/**
 * ★ 2026-08-04(R4) — 변화 축 회차 마감 대조 패스.
 *
 * "발송이 실제로 나갔는가"를 캠페인 종결로 확인한 뒤에만 스냅샷을 전진시킨다. 큐 수락 시점에
 * 전진시키면 발송 큐 장애로 전량 실패해도 변화가 소진돼 다음 회차에 조용히 사라진다(Codex).
 * 스냅샷 상태 ↔ 캠페인 결과는 두 진실이라 대조 워커가 잇는다(6원칙 ③).
 *
 * 마커 = proposal_json.meta.cycleSnapshotPending (발송 커밋 마커 campaign_id와 같은 UPDATE에서 심는다).
 * 판정:
 *  - 'completed' → 발송 큐 실수신 번호(dest_no, app_etc1 = 캠페인 id)로 **그 사람들만** 갱신 → 마커 해제.
 *    부분 실패는 자동으로 정확하다 — 큐에 실린 번호만 갱신되고 못 받은 사람의 변화는 남는다.
 *  - 'failed' · 'cancelled' → 갱신 없이 마커 해제 — 안 알린 변화는 다음 회차에 그대로 남는다.
 *  - 그 외(진행 중) → 대기(다음 패스 재확인).
 * 처리 실패는 마커가 남아 다음 패스가 재시도한다(수렴) — 조용히 잃지 않는다.
 * 보호 영역 파일(direct-send-*)은 **읽기만** 한다 — 쓰기는 스냅샷 표와 제안 마커뿐.
 */
async function settlePendingCycleSnapshots(): Promise<void> {
  let rows: any[] = [];
  try {
    // ⛔ 2026-08-04 2R(F4): 종결 상태만 집는다. 상태 무관 LIMIT이면 진행 중 20건이 자리를 차지해
    //   뒤의 종결 캠페인이 영구 미처리된다(기아) — 종결 전 행은 아예 안 뽑으면 기아 자체가 불가능하다.
    const r = await query(
      `SELECT p.id, p.company_id, p.operator_id, p.campaign_id,
              c.status AS campaign_status, c.send_config, c.created_by,
              COALESCE(c.sent_at, c.scheduled_at, c.created_at) AS ref_date
         FROM operator_proposals p
         JOIN campaigns c ON c.id = p.campaign_id
        WHERE p.campaign_id IS NOT NULL
          AND COALESCE(p.proposal_json->'meta'->>'cycleSnapshotPending', 'false') = 'true'
          AND c.status IN ('completed', 'failed', 'cancelled')
        LIMIT 20`,
    );
    rows = r.rows;
  } catch (e: any) {
    console.warn('[ContinuousOperator Settle] 대기 제안 조회 경고:', e?.message);
    return;
  }
  for (const row of rows) {
    try {
      const st = String(row.campaign_status || '');
      if (st === 'completed') {
        // 실수신 번호 — 리마인드 코호트와 같은 단일 문(readCampaignQueuedPhones).
        const phones = await readCampaignQueuedPhones(row.company_id, row.campaign_id, row);
        if (phones.length === 0) {
          // ⛔ 2R(F5): completed인데 큐에 행이 없다 = 실패가 증명된 게 아니라 조회 축이 어긋난 불확정 상태다.
          //   마커를 지우면 재시도 근거가 사라진다 — 유지하고 매 패스 경고한다(잔존이 남는 한 재경보 = 수렴,
          //   LESSONS 감시 원칙). LOG 이동 지연이면 다음 패스에 잡히고, 축 결함이면 경고가 사람을 부른다.
          console.warn(`[ContinuousOperator Settle] ${row.id} completed인데 큐 수신번호 0건 — 마커 유지·재시도(조회 축 확인 필요)`);
          continue;
        }
        const adv = await advanceCycleSnapshotForPhones(row.operator_id, row.company_id, phones);
        console.log(`[ContinuousOperator Settle] ${row.id} 회차 마감 — 수신 ${phones.length}명 · 스냅샷 갱신 ${adv.updated}건`);
      } else if (st === 'failed' || st === 'cancelled') {
        console.log(`[ContinuousOperator Settle] ${row.id} 캠페인 ${st} — 스냅샷 미전진(변화가 다음 회차에 남는다)`);
      } else {
        continue;   // queued·sending·scheduled — 아직 종결 전
      }
      await query(
        `UPDATE operator_proposals SET proposal_json = proposal_json #- '{meta,cycleSnapshotPending}'
          WHERE id = $1::uuid`,
        [row.id],
      );
    } catch (e: any) {
      console.warn(`[ContinuousOperator Settle] ${row.id} 마감 경고(다음 패스 재시도):`, e?.message);
    }
  }
}

/**
 * ★ 2026-08-05 — 정산 대기 마커 해제. **차감이 확정된 순간에만** 부른다(해제 지점은 이 함수 하나뿐).
 * 회차 스냅샷 마커 해제와 같은 idiom(#- 경로 삭제).
 */
async function clearChargePendingMarker(proposalId: string): Promise<void> {
  await query(
    `UPDATE operator_proposals
        SET proposal_json = (proposal_json #- '{meta,chargePending}') #- '{meta,chargeAttemptAt}'
      WHERE id = $1::uuid`,
    [proposalId],
  );
}

/**
 * ★ 2026-08-05(Codex 2R high) — 정산 시도 시각 기록. **시도 직전에** 남긴다.
 * 대조 패스가 정렬 없이 LIMIT만 걸면, 영구 실패한 행 20건이 앞자리를 계속 차지해 뒤에 쌓인
 * 미정산 발송은 한 번도 시도되지 않는다(기아). 시도한 행을 뒤로 밀어 차례가 돌게 한다.
 * 실패·크래시로 갱신이 끊겨도 마커 자체는 남아 의무가 사라지지 않는다.
 * ⛔ UTC로 고정해 저장한다 — 세션 시간대에 따라 오프셋이 달라지면 문자열 정렬이 시간순과 어긋난다.
 */
async function stampChargeAttempt(proposalId: string): Promise<void> {
  await query(
    `UPDATE operator_proposals
        SET proposal_json = jsonb_set(
              jsonb_set(COALESCE(proposal_json, '{}'::jsonb), '{meta}', COALESCE(proposal_json->'meta', '{}'::jsonb)),
              '{meta,chargeAttemptAt}', to_jsonb(NOW() AT TIME ZONE 'UTC'))
      WHERE id = $1::uuid`,
    [proposalId],
  );
}

/**
 * ★ 2026-08-05 — 정산 대조 패스(Codex 1R high). 발송은 나갔는데 차감이 확정되지 않은 제안을
 * **상태와 무관하게** 다시 본다. 종전 구조는 정산을 발송 상태에 얹어, 복구 패스가 상태를 먼저
 * 바꾸는 순간(sending → sent) 회수 근거가 사라졌다 — 그 사이 실패·중단이면 무과금이 영구 확정됐다.
 *
 * 마커 = proposal_json.meta.chargePending (발송 커밋 마커 campaign_id와 같은 UPDATE에서 심는다).
 * 같은 멱등키로 재시도하므로 이미 빠진 건은 duplicate로 즉시 확정되고 **중복 차감은 0**이다.
 * 확정되면 마커를 지우고, 확정되지 않으면 마커가 남아 다음 패스가 또 본다(수렴 — 조용히 잃지 않는다).
 */
async function settlePendingCharges(): Promise<void> {
  let rows: any[] = [];
  try {
    const r = await query(
      `SELECT p.id, p.company_id, o.created_by
         FROM operator_proposals p
         LEFT JOIN continuous_operators o ON o.id = p.operator_id
        WHERE p.campaign_id IS NOT NULL
          AND COALESCE(p.proposal_json->'meta'->>'chargePending', 'false') = 'true'
        -- ⛔ 정렬 없이 LIMIT만 걸면 영구 실패 20건이 앞자리를 계속 차지해 뒤에 쌓인 미정산 발송이
        --   한 번도 시도되지 않는다(Codex 2R high · 기아). 미시도 우선 → 오래 안 해본 순.
        --   UTC ISO 고정 문자열이라 사전순 = 시간순이고, 캐스팅이 없어 형식 오류로 패스가 죽지 않는다.
        ORDER BY p.proposal_json->'meta'->>'chargeAttemptAt' ASC NULLS FIRST
        LIMIT 20`,
    );
    rows = r.rows;
  } catch (e: any) {
    console.warn('[ContinuousOperator Charge] 정산 대기 조회 경고:', e?.message);
    return;
  }
  for (const row of rows) {
    // 시도 시각을 **먼저** 남긴다 — 실패하든 이 자리에서 프로세스가 죽든 그 행은 뒤로 밀리고
    //   다음 행이 차례를 얻는다. 마커 자체는 그대로라 의무는 사라지지 않는다.
    await stampChargeAttempt(row.id).catch((e: any) =>
      console.warn(`[ContinuousOperator Charge] ${row.id} 시도 시각 기록 경고:`, e?.message));
    try {
      const settled = await deductCreditSafe({
        companyId: row.company_id,
        cost: getCreditCost('continuous-operator-send'),
        source: 'continuous-operator-send',
        createdBy: row.created_by || row.company_id,
        idempotencyKey: `continuous-operator-send:${row.id}`,
      });
      if (settled) {
        await clearChargePendingMarker(row.id);
        console.log(`[ContinuousOperator Charge] ${row.id} 정산 확정 — 마커 해제`);
      } else {
        console.warn(`[ContinuousOperator Charge] ${row.id} 정산 미확정 — 마커 유지·다음 패스 재시도([CREDIT] 로그 확인)`);
      }
    } catch (e: any) {
      console.warn(`[ContinuousOperator Charge] ${row.id} 정산 경고(다음 패스 재시도):`, e?.message);
    }
  }
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
      // ★ 2026-08-05: 여기서 크레딧을 보강하지 않는다. 상태를 먼저 바꾼 뒤 차감을 시도하는 구조가
      //   바로 회수 근거를 지우는 원인이었다(Codex 1R high). 정산은 chargePending 마커와
      //   settlePendingCharges가 상태와 무관하게 소유한다 — 이 함수는 상태 마감만 한다.
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
  // ★ 2026-07-12 C-1: 발송 직전 오퍼레이터 상태 게이트 — 중지·보관 오퍼레이터의 잔여 예약 발송 최종 차단
  //   (중지 시점 일괄 취소와 2중 안전망). paused_no_credit은 생성 크레딧 문제라 기예약 발송은 기존대로 진행.
  const gateRes = await query(
    `SELECT o.status AS operator_status
       FROM operator_proposals p JOIN continuous_operators o ON o.id = p.operator_id
      WHERE p.id = $1::uuid`,
    [proposalId],
  );
  // ★ 2026-08-04: 리마인드 차단 게이트 제거(되살림 — runAutoSendPass 주석 참조). 코호트 판정은 dispatch가 소유.
  const opStatus = String(gateRes.rows[0]?.operator_status || '');
  if (opStatus !== 'active' && opStatus !== 'paused_no_credit') {
    await query(
      `UPDATE operator_proposals SET status = 'admin_stopped', scheduled_send_at = NULL,
         auto_execute_reason = '오퍼레이터 중지 상태 — 자동 발송 취소', reviewed_at = NOW()
       WHERE id = $1::uuid AND status = 'scheduled'`,
      [proposalId],
    );
    return 'skipped';
  }
  // ★ 2026-07-12 C-1: 야간 게이트 — 발송 가능 창 밖이면 다음 발송 가능 시각(오전 9시)으로 밀고 이번 패스는 skip.
  //   신규 저장은 시각 가드로 차단되지만 기존 야간 예약 행·경계 드리프트 방어.
  const nowGate = new Date();
  if (!isSendableHourKst(nowGate, SEND_HOURS.start, SEND_HOURS.end)) {
    await query(
      `UPDATE operator_proposals SET scheduled_send_at = $2 WHERE id = $1::uuid AND status = 'scheduled'`,
      [proposalId, shiftToSendableHour(nowGate)],
    );
    return 'skipped';
  }

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

  // 자율 발송 경로 — 발송 직전 실측 건수로 상한·예산을 한 번 더 본다(7R).
  const r = await dispatchProposalSend(p, true);
  return r.action;
}

/**
 * claim된('sending') 제안을 직접발송 파이프라인으로 발송 — 자동(scheduled)·수동(승인) 공유.
 * 크레딧은 발송 성공 시점 1회(멱등). 0건/잔액/발신번호 미설정은 skip + 통지.
 */
async function dispatchProposalSend(
  p: any,
  // ⛔ 7R: 자율 발송 경로에서만 발송 직전 상한·예산 재검사를 한다(수동 승인은 사람이 검토했다는 기존 계약 유지).
  autoPath = false,
): Promise<{ action: 'sent' | 'skipped'; campaignId?: string; sentCount?: number; reason?: string }> {
  const proposalId: string = p.id;
  const companyId: string = p.company_id;
  const pj: any = p.proposal_json || {};

  // ★ 2026-08-04 리마인드 되살림 — 하드 차단(2026-08-03 6R) 제거. 보류 사유였던 "1차 수신자를 모른다"가
  //   발송 큐 원장(readCampaignQueuedPhones)으로 해소됐다. 대상 추출은 아래 코호트 분기가 소유하고,
  //   이 함수를 자동·수동이 공유하므로 두 경로 모두 같은 코호트를 쓴다.

  // 통지/발신자 컨텍스트 — 커밋 전 예외는 아래 try가 'sending'을 admin_review로 내려 정지 방지.
  let op: any = {};
  let userId: string = companyId;
  const notify = (title: string, body: string) =>
    notifyOperatorAdmins(
      { adminPhoneNumbers: Array.isArray(op.admin_phone_numbers) ? op.admin_phone_numbers : [], backupAdminPhone: op.backup_admin_phone || null, companyId, createdBy: op.created_by || null },
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

  // ★ 2026-07-09 사용자 수동 선택/편집 우선 (수동 승인 경로) — proposal_json.userSelection이 있으면 그 변형/본문으로 발송.
  //   없으면(자동 스케줄 발송) 위 Bandit 추천을 그대로 유지 = 자동 경로 무변경.
  const userSel = (pj.userSelection && typeof pj.userSelection === 'object') ? pj.userSelection : null;
  let userBodyOverride: string | null = null;
  let userSubjectOverride: string | null = null;
  if (userSel) {
    if (Number.isInteger(userSel.variantIndex) && userSel.variantIndex >= 0 && pj.messages?.[userSel.variantIndex]) {
      chosenIndex = userSel.variantIndex;
      // 선택된 변형 id를 index로 재조회(클릭 보상 추적 정합). 실패 시 null(추적만 생략, 발송 정상).
      chosenVariantId = null;
      try {
        const vrow = await query(
          `SELECT id FROM operator_proposal_variants WHERE proposal_id = $1::uuid AND variant_index = $2 LIMIT 1`,
          [proposalId, chosenIndex],
        );
        chosenVariantId = vrow.rows[0]?.id || null;
      } catch (e: any) {
        console.warn('[ContinuousOperator AutoSend] 선택 변형 id 조회 실패:', e?.message);
      }
    }
    if (typeof userSel.body === 'string' && userSel.body.trim()) userBodyOverride = userSel.body;
    if (typeof userSel.subject === 'string') userSubjectOverride = userSel.subject;
  }

  // 메시지/채널 (스팸 통과 본문) — 광고 가드에 isAd 필요해 먼저 계산.
  const msg = pj.messages?.[chosenIndex] || pj.messages?.[0] || {};
  const body = userBodyOverride != null ? userBodyOverride : String(msg.body || msg.message || '');
  const subject = userSubjectOverride != null ? userSubjectOverride : String(msg.subject || '');
  // ★ 2026-07-07: 발송 시점 혜택 재치환 대상 — 제안 생성 후 관리자가 혜택을 입력(D-2 안내 흐름)해도 반영되게
  //   op(benefit_content) 로드 후 값이 확정된다. 이후 발송 경로는 전부 resolvedBody/resolvedSubject 사용.
  let resolvedBody = body;
  let resolvedSubject = subject;
  const channel = String(pj.channel?.recommended || 'SMS').toUpperCase();
  // ★ 2026-07-09 편집 본문이 SMS 한도(90byte EUC-KR) 초과면 LMS로 자동 승격(잘림 방지). 편집 없으면 원 채널 유지.
  let msgType = (channel === 'LMS' || channel === 'MMS') ? channel : 'SMS';
  if (msgType === 'SMS' && userBodyOverride != null && eucKrByteLength(body) > 90) {
    msgType = 'LMS';
  }
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
  // ★ 2026-08-03 A-1: 게이트도 발송 후 예측 분모 적재가 같은 것을 쓰도록 함수 스코프로 올린다
  //   (종전엔 try 안 지역 변수라 분모 적재만 피로도를 못 보고 실제 발송보다 많은 고객을 세었다).
  let sendGates: AudienceGates = {};
  let sendFatigueCap: FatigueCap | null = null;
  // ⛔ 5R: 매장 범위도 발송 후 분모 적재가 같은 것을 쓰도록 함수 스코프.
  let sendBaseParams: any[] = [companyId];
  let sendStoreFilter = '';
  // ★ 2026-07-30 (임은지 접수): MMS 첨부 이미지 — try 안 게이트에서 확정, 아래 createDirectSendCampaign에 전달.
  let mmsImagePaths: string[] | null = null;
  try {
    // operator(통지 대상 · created_by · Phase3 C 시퀀스 설정 · 2026-07-07 혜택 재치환용 benefit_content)
    const opRes = await query(
      `SELECT created_by, name, admin_phone_numbers, backup_admin_phone,
              sequence_enabled, sequence_delay_days, sequence_reminder_content, benefit_content,
              budget_monthly, budget_daily, budget_alert_threshold
       FROM continuous_operators WHERE id = $1::uuid`,
      [p.operator_id],
    );
    op = opRes.rows[0] || {};
    userId = op.created_by || companyId;

    // ★ 2026-07-07 혜택 발송 시점 재치환 + 미편집 placeholder 출구 가드 (마케팅 캘린더 완비).
    //   제안 생성 후 관리자가 혜택을 입력했으면(D-2 준비 문자 흐름) 여기서 반영된다.
    //   그래도 placeholder가 남으면 실고객 노출 차단 — 이메일·인앱·여정과 같은 클래스의 코드 가드.
    //   자동(scheduled)·수동 승인(approveProposal)·시퀀스 리마인드 3경로가 이 함수를 공유하므로 1곳 = 전 경로.
    resolvedBody = applyBenefitToBody(body, op.benefit_content);
    resolvedSubject = applyBenefitToBody(subject, op.benefit_content);
    if (hasUneditedBenefitPlaceholder(resolvedBody) || hasUneditedBenefitPlaceholder(resolvedSubject)) {
      await query(
        `UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL,
           auto_execute_reason = '혜택 미입력(문안에 입력 안내 문구 잔존) — 발송 보류' WHERE id = $1::uuid`,
        [proposalId],
      );
      await notify('[AI 자동마케팅] 발송 보류', `'${op.name || ''}' 문안에 혜택이 입력되지 않아 발송을 보류했습니다. 한줄로 > 자동마케팅에서 혜택 입력 후 승인해 주세요.`);
      return { action: 'skipped', reason: '혜택 미입력 — 발송 보류' };
    }

    // 광고 가드 — 광고면 무료거부 번호(080) 해석 결과 필수(정보통신망법). 없으면 발송 보류(담당자 검토).
    if (isAd) {
      const opt080 = await getOpt080Number(op.created_by || null, companyId);
      if (!opt080) {
        await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '광고 무료거부 번호(080) 미설정 — 발송 보류' WHERE id = $1::uuid`, [proposalId]);
        await notify('[AI 자동마케팅] 발송 보류', `'${op.name || ''}' 광고 무료거부 번호(080)가 없어 발송을 보류했습니다. 080 등록 후 다시 진행해주세요.`);
        return { action: 'skipped', reason: '광고 무료거부 번호(080) 미설정' };
      }
    }

    // ★ 2026-07-30 (임은지 접수·Codex 2R 정정) MMS 이미지 게이트 — 발송 라우트 공통 CT(validateMmsPayload·D131)를
    //   자율발송에도 배선(종전엔 이 경로만 우회 → 무이미지 MMS = 통신사 9007 실패 부류가 차감까지 하고 죽는 구조).
    //   staging 적재·캠페인 생성·차감 전에 보류(혜택 미입력 게이트와 동일 패턴). 조회 = company_id 동스코프(테넌트 경계) — 행 없음도 보류.
    if (msgType === 'MMS') {
      const imgRes = await query(
        `SELECT mms_image_paths FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid`,
        [p.operator_id, companyId],
      );
      const arr = imgRes.rows[0]?.mms_image_paths;
      const cleaned = Array.isArray(arr) ? arr.filter((x: any) => typeof x === 'string' && x.trim()).slice(0, 3) : [];
      if (imgRes.rows.length === 0 || !validateMmsPayload(msgType, cleaned).ok) {
        await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = 'MMS 이미지 미첨부 — 발송 보류' WHERE id = $1::uuid`, [proposalId]);
        await notify('[AI 자동마케팅] 발송 보류', `'${op.name || ''}' MMS 이미지가 없어 발송을 보류했습니다. 자동마케팅 수정에서 이미지를 첨부한 뒤 승인해 주세요.`);
        return { action: 'skipped', reason: 'MMS 이미지 미첨부 — 발송 보류' };
      }
      mmsImagePaths = cleaned;
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
    // ⛔ 5R 정정: 매장 제한 계정이 만든 오퍼레이터는 그 범위 안에서만 보낸다. 종전엔 미리보기만 범위를 적용하고
    //   실발송은 회사 전체였다(화면 1명 · 실발송 2명 · 차감 2건). 미할당 계정은 아예 보내지 않는다.
    const scope = await resolveOperatorStoreScope(companyId, op.created_by || null);
    if (scope.blocked) {
      await query(
        `UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL,
           auto_execute_reason = '담당 매장이 지정되지 않아 발송 대상을 정할 수 없습니다 — 발송 보류'
         WHERE id = $1::uuid`,
        [proposalId],
      );
      await notify('[AI 자동마케팅] 발송 보류', `'${op.name || ''}' 담당 매장이 지정되지 않아 발송을 보류했습니다. 매장 권한 확인 후 다시 진행해주세요.`);
      return { action: 'skipped', reason: '담당 매장 미지정 — 발송 보류' };
    }
    sendBaseParams = scope.baseParams;
    sendStoreFilter = scope.storeFilter;

    if (pj.meta?.is_reminder === true) {
      // ★ 2026-08-04 리마인드 코호트 — 조건을 다시 컴파일하지 않는다(1차 이후 조건 안으로 들어온 사람에게
      //   1차 없이 리마인드가 나가는 것이 보류의 원인이었다). 대상 = **1차 실수신 번호** 그 자체이고,
      //   안전필터·미클릭(1차 발송 시각 이후)·피로도·매장 범위는 아래 공통 게이트가 그대로 얹힌다(교집합 = 좁게).
      const primaryCampaignId = String(pj.meta?.primary_campaign_id || '').trim();
      const halt = async (reason: string, notice: string) => {
        await query(
          `UPDATE operator_proposals SET status = 'admin_stopped', scheduled_send_at = NULL, reviewed_at = NOW(),
             auto_execute_reason = $2 WHERE id = $1::uuid`,
          [proposalId, reason],
        ).catch((e: any) => console.warn('[ContinuousOperator] 리마인드 종결 경고:', e?.message));
        await notify('[AI 자동마케팅] 리마인드 취소', notice);
        return { action: 'skipped' as const, reason };
      };
      if (!primaryCampaignId) {
        return await halt('리마인드 취소 — 1차 캠페인 정보 없음(옛 형식 예약)',
          `'${op.name || ''}' 리마인드에 1차 발송 정보가 없어 취소했습니다.`);
      }
      const camp = await query(
        `SELECT status, send_config, created_by, COALESCE(sent_at, scheduled_at, created_at) AS ref_date
           FROM campaigns WHERE id = $1::uuid AND company_id = $2::uuid`,
        [primaryCampaignId, companyId],
      );
      const crow = camp.rows[0];
      // 1차가 정상 종결(completed)하지 않았으면 리마인드도 없다 — 받은 적 없는 리마인드가 이 기능의 금기다.
      if (!crow || String(crow.status) !== 'completed') {
        return await halt('리마인드 취소 — 1차 발송이 정상 종결되지 않음',
          `'${op.name || ''}' 1차 발송이 정상 완료되지 않아 리마인드를 취소했습니다.`);
      }
      // 성공 코드만 — "1차를 받은 분"이 계약이다. 실패(결번·꺼짐)·대기 번호에 또 보내면 받은 적 없는 리마인드.
      const cohort = await readCampaignQueuedPhones(companyId, primaryCampaignId, crow, { successOnly: true });
      if (cohort.length === 0) {
        return await halt('리마인드 취소 — 1차 수신 성공 명단이 없음',
          `'${op.name || ''}' 1차를 실제로 받은 고객이 확인되지 않아 리마인드를 취소했습니다.`);
      }
      filterWhere = `AND regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g') = ANY($${sendBaseParams.length + 1}::text[])`;
      filterParams = [cohort];
    } else {
      // ★ 2026-08-03 A-7: 계약이 있으면 축으로 컴파일한다(저장된 filters 재해석 없음). 없으면 종전대로 filters.
      //   잠긴 축이면 throw → 아래 catch가 admin_review로 내리고 사유를 담당자에게 알린다(조용한 발송 금지).
      const compiled = await compileOperatorAudience({
        companyId,
        segmentKey: pj.target?.segmentKey || null,
        segmentParams: pj.target?.segmentParams || null,
        legacyFilters: filters,
        baseParams: sendBaseParams,
        // ★ 2026-08-04: 발송 직전 재추출도 제안 생성 때와 **같은 지난 회차**와 비교한다.
        //   스냅샷 갱신을 발송 뒤로 미루는 이유가 여기 있다 — 제안 시점에 갈아 끼우면 이 재추출이
        //   방금 심은 자기 스냅샷과 비교해 변화 0이 되고, "보여준 수 = 나가는 수"가 깨진다.
        operatorId: p.operator_id || null,
      });
      filterWhere = compiled.filterWhere;
      filterParams = compiled.filterParams;
    }
    stagingId = randomUUID();
    // ★ 2026-07-05 발송 피로도 보호 — 자동마케팅은 광고 강제(0705 라벨 정정)라 cap 설정 회사면 추출 단계에서 제외(차감 전).
    // ⛔ 2026-08-03 1R 정정: 게이트를 손으로 조립하지 않는다 — 리마인드 코호트 경계가 여기 안 오면
    //   1차를 안 받은 신규 유입에게 리마인드가 나간다. 게이트 해석은 단일 문(resolveOperatorAudienceGates)뿐.
    sendGates = await resolveOperatorAudienceGates(companyId, pj);
    sendFatigueCap = sendGates.fatigueCap ?? null;
    // ⛔ 4R: 추출 시각 경계(CTE)는 폐기했다 — 리마인드를 보류하기로 하면서 그 값을 쓸 곳이 없어졌다.
    //   구조를 고치면 덧댔던 장치도 함께 사라지는 게 정상이다.
    const { sql: insSql, params: insParams } = buildSendableStagingInsertSql(stagingId, sendBaseParams, filterWhere, filterParams, sendStoreFilter, sendGates);
    recipientTotal = (await query(insSql, insParams)).rowCount || 0;

    // ⛔ 7R 정정: 재추출된 **실제 건수**로 상한·예산을 다시 본다. 종전엔 제안 시점 수로 통과한 뒤
    //   발송 직전 추출에서 대상이 늘어도 검사가 없어, 설정한 자율 발송 상한과 예산을 넘겨 실발송·실차감했다.
    //   (자율 경로 전용 — 수동 승인은 사람이 이미 검토했다는 기존 계약을 유지한다.)
    if (autoPath && recipientTotal > 0) {
      // ⛔ 8R 정정: 제안서에 적힌 옛 단가로 검사하면 그 사이 단가가 바뀐 회사에서 검사와 실차감이 갈린다
      //   (9.9원으로 통과시키고 20원으로 차감). 확정된 채널과 **지금 회사 단가**로 계산한다.
      // ⛔ 8R 정정(원자성): 검사와 예약을 한 트랜잭션에서 한다. 종전엔 SUM 조회와 발송 사이에 잠금이 없고
      //   claim된 'sending' 금액이 합계에서 빠져, 잔여 100원에 60원짜리 두 제안이 동시에 통과할 수 있었다.
      //   오퍼레이터 행을 FOR UPDATE로 잡고, 'sending'(자기 자신 제외)까지 합산한 뒤 실측 수치를 같은 트랜잭션에 남긴다.
      const budgetClient = await pool.connect();
      let L: any = null;
      let overReason = '';
      let actualCost = 0;
      try {
        await budgetClient.query('BEGIN');
        await budgetClient.query(`SELECT id FROM continuous_operators WHERE id = $1::uuid FOR UPDATE`, [p.operator_id]);
        const lim = await budgetClient.query(
          `SELECT COALESCE(c.cdp_auto_execute_max_recipients, 1000) AS max_recipients,
                  COALESCE(c.cdp_auto_execute_max_cost_krw, 50000) AS max_cost,
                  c.cost_per_sms, c.cost_per_lms, c.cost_per_mms, c.cost_per_kakao, c.unit_price_basis,
                  o.budget_monthly, o.budget_daily,
                  COALESCE((SELECT SUM(cost_estimate) FROM operator_proposals
                     WHERE operator_id = o.id AND created_at >= date_trunc('month', NOW())
                       AND status IN ('approved','auto_executed','sent','sending') AND id <> $2::uuid), 0) AS spent_month,
                  COALESCE((SELECT SUM(cost_estimate) FROM operator_proposals
                     WHERE operator_id = o.id AND created_at >= CURRENT_DATE
                       AND status IN ('approved','auto_executed','sent','sending') AND id <> $2::uuid), 0) AS spent_today
             FROM continuous_operators o JOIN companies c ON c.id = o.company_id
            WHERE o.id = $1::uuid`,
          [p.operator_id, proposalId],
        );
        L = lim.rows[0] || null;

        if (!L) {
          // 회사·오퍼레이터 행을 못 읽었다 = 검사 불가. 검사 없이 보내지 않는다(돈 보호 fail-closed).
          overReason = '발송 직전 한도·단가를 확인하지 못했습니다';
        } else {
          const costs = getCompanyCosts(L as any);
          const unit = msgType === 'MMS' ? Number(costs.mms) : msgType === 'LMS' ? Number(costs.lms) : Number(costs.sms);
          if (!Number.isFinite(unit)) {
            overReason = '발송 단가를 확인하지 못했습니다';
          } else {
            actualCost = Math.round(unit * recipientTotal);
            if (recipientTotal > Number(L.max_recipients)) {
              overReason = `발송 직전 대상이 ${recipientTotal.toLocaleString()}명으로 자동 발송 상한(${Number(L.max_recipients).toLocaleString()}명)을 넘었습니다`;
            } else if (actualCost > Number(L.max_cost)) {
              overReason = `발송 직전 예상 비용이 ${actualCost.toLocaleString()}원으로 자동 발송 한도(${Number(L.max_cost).toLocaleString()}원)를 넘었습니다`;
            } else {
              const g = decideBudgetGuard({
                budgetMonthly: L.budget_monthly != null ? Number(L.budget_monthly) : null,
                budgetDaily: L.budget_daily != null ? Number(L.budget_daily) : null,
                spentMonth: Number(L.spent_month) || 0,
                spentToday: Number(L.spent_today) || 0,
                pendingCost: actualCost,
              });
              if (g.over) overReason = g.reason;
            }
          }
        }

        // 통과든 보류든 실측 수량·비용을 **같은 트랜잭션에서** 남긴다 — 이 값이 다음 제안의 예산 합계가 된다.
        //   종전엔 보류 분기에서만 갱신해, 실제로 나간 금액이 제안에 남지 않아 예산이 계속 과소 집계됐다.
        if (overReason) {
          await budgetClient.query(
            `UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL,
               recipient_count = $2, cost_estimate = $3, auto_execute_reason = $4
             WHERE id = $1::uuid`,
            [proposalId, recipientTotal, actualCost, `${overReason} — 발송 보류`],
          );
        } else {
          await budgetClient.query(
            `UPDATE operator_proposals SET recipient_count = $2, cost_estimate = $3 WHERE id = $1::uuid`,
            [proposalId, recipientTotal, actualCost],
          );
        }
        await budgetClient.query('COMMIT');
      } catch (budErr: any) {
        await budgetClient.query('ROLLBACK').catch(() => {});
        throw budErr;   // 바깥 catch가 admin_review로 내리고 통지한다(검사 실패 = 발송 금지)
      } finally {
        budgetClient.release();
      }

      if (overReason) {
        // 커밋 후 정리 — 적재분을 치우고 담당자에게 사유를 알린다.
        await cleanupOrphanStaging(stagingId);
        await notify('[AI 자동마케팅] 발송 보류', `'${op.name || ''}' ${overReason}. 담당자 검토가 필요합니다.`);
        return { action: 'skipped', reason: overReason };
      }
    }

    // 0건 → 스킵 + 통지 (operator는 다음 주기 정상). staging 0행이라 잔여 없음.
    const outcome = decideSendOutcome({ recipientCount: recipientTotal, balanceOk: true });
    if (outcome.action === 'skip') {
      await query(`UPDATE operator_proposals SET status = 'skipped', auto_execute_reason = $2 WHERE id = $1::uuid`, [proposalId, outcome.reason]);
      if (outcome.notify) await notify('[AI 자동마케팅] 발송 생략', `'${op.name || ''}' 이번 사이클은 ${outcome.reason}.`);
      return { action: 'skipped', reason: outcome.reason };
    }
  } catch (preErr: any) {
    // 발송 커밋 전 예외 → 'sending' 정지 방지: 담당자 검토로 내리고(자동 재발송 X) 통지 후 재던짐.
    // ⛔ 8R 정정: 적재해 둔 수신자 행도 함께 치운다. 캠페인이 소유권을 가져가기 전에 빠져나가면
    //   전화번호·이름이 담긴 staging이 주인 없이 남고 정리 워커도 없다.
    await cleanupOrphanStaging(stagingId);
    await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '발송 준비 오류 — 담당자 검토' WHERE id = $1::uuid AND status = 'sending'`, [proposalId]).catch(() => {});
    await notify('[AI 자동마케팅] 발송 보류', `'${op.name || ''}' 발송 준비 중 오류로 보류했습니다. 담당자 검토가 필요합니다.`);
    throw preErr;
  }

  // ★ Phase2 A — 발송 변이 추적: 본문 URL을 변이 id로 단축 → 클릭 시 operator 변이에 보상 자동 누적.
  //   journey-executor와 동일하게 검증(스팸테스트) 이후 발송 시점 단축. 단축 실패 시 원본 보존(안전).
  //   ★ 2026-07-07: 혜택 재치환 완료본(resolvedBody) 기준 — placeholder 출구 가드 통과분만 여기 도달.
  const trackedBody = chosenVariantId
    ? await shortenUrlsInText(resolvedBody, { companyId, variantId: chosenVariantId }).catch(() => resolvedBody)
    : resolvedBody;

  // 발송 (직접발송 파이프라인 공유) — 잔액 부족이면 skip+통지
  //   MMS면 위 게이트에서 확정한 mmsImagePaths가 spec → campaigns.mms_image_paths/send_config → file_name 1~3로 흐른다(기존 계약).
  let campaignId: string;
  // ★ 2026-08-04 2R(#4): 리마인드 미클릭 기준 시각 — 캠페인 **커밋 직후**에 캡처한다.
  //   리마인드 예약 호출 시점(마커·크레딧·통지 뒤, 수 초 후)에 캡처하면 그 사이 클릭이 "미반응"으로 남는다.
  let primarySentAt: Date | null = null;
  try {
    const res = await createDirectSendCampaign(
      {
        stagingId,
        campaignName: `AI 자동마케팅 ${op.name || ''} ${new Date().toLocaleDateString('ko-KR')}`,
        msgType, message: trackedBody, subject: resolvedSubject || null, callback, sendChannel: 'sms',
        adEnabled: isAd, total: recipientTotal, dedupEnabled: true, unsubFilterEnabled: true,
        mmsImagePaths,
      },
      { companyId, userId },
      { finalSource: 'selected_as_is', aiMessages: [trackedBody] },
    );
    campaignId = res.campaignId;
    primarySentAt = new Date();
  } catch (e: any) {
    // ⛔ 8R 정정: 캠페인이 만들어지지 못했으면 staging의 주인이 없다 — 잔액 부족·발송 오류 모두에서 치운다.
    await cleanupOrphanStaging(stagingId);
    if (e instanceof DirectSendError && e.code === 'INSUFFICIENT_BALANCE') {
      await query(`UPDATE operator_proposals SET status = 'skipped', auto_execute_reason = '잔액 부족 — 발송 생략' WHERE id = $1::uuid`, [proposalId]);
      await notify('[AI 자동마케팅] 발송 생략', `'${op.name || ''}' 잔액 부족으로 이번 사이클 발송을 생략했습니다.`);
      return { action: 'skipped', reason: '잔액 부족' };
    }
    await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '발송 오류 — 담당자 검토' WHERE id = $1::uuid`, [proposalId]).catch(() => {});
    throw e;
  }

  // 발송 커밋 마커 — campaign_id 즉시 기록. 이후 최종 UPDATE가 실패해도 정리 패스가 'sent'로 마감(정지 방지·재발송 X).
  // ★ 2026-08-04(R4): 변화 축이면 스냅샷 마감 대기 마커를 **같은 UPDATE**에서 심는다. 스냅샷 전진은
  //   여기서 하지 않는다 — 큐 수락은 발송 성공이 아니다(전량 실패 시 변화가 소진된다). 캠페인 종결을
  //   확인한 settlePendingCycleSnapshots 패스가 전진·해제를 소유한다. jsonb_set은 중간 키를 안 만들어
  //   meta가 없으면 조용히 무시되므로 meta부터 세운다(read-modify-write 아님 — 단문 원자).
  // ⛔ 리마인드는 마커를 심지 않는다 — 리마인드는 같은 코호트 재접촉이지 새 회차가 아니다.
  //   전진시키면 1차와 리마인드 사이에 생긴 새 변화가 안 알려진 채 소진된다(다음 회차에서 사라진다).
  // ★ 2026-08-05: **정산 대기 마커도 같은 UPDATE에서** 심는다. 발송은 나갔는데 차감이 확정되지 않는 경우가
  //   있고(잔액 부족·DB 장애), 그것을 발송 상태(sent/sending)로 표현하면 상태와 정산이 한 축에 묶여
  //   "복구 패스가 상태를 먼저 바꾸는 순간 회수 근거가 사라지는" 구조가 된다(Codex 1R high).
  //   회차 스냅샷과 같은 형태로 정산 축을 분리한다 — 상태는 정상 마감하고, 정산은 이 마커가 들고 있다가
  //   settlePendingCharges가 같은 멱등키로 확정될 때 푼다(중복 차감은 멱등키가 막는다).
  const needsSnapshotSettle = segmentNeedsCycleBaseline(pj.target?.segmentKey || null) && pj.meta?.is_reminder !== true;
  // ⛔ 2026-08-04 2R(F2): 이 UPDATE 실패를 조용히 넘기면 변화 축은 settle 근거가 없어져 다음 회차에
  //   같은 사람들에게 다시 나간다. 발송은 이미 커밋됐으니 되돌릴 수 없다 — 1회 재시도하고, 그래도
  //   실패면 담당자에게 중복 가능성을 알린다(두 시스템 사이라 완전 원자화는 불가, 최소한 조용하지 않게).
  const metaBase = `jsonb_set(COALESCE(proposal_json, '{}'::jsonb), '{meta}', COALESCE(proposal_json->'meta', '{}'::jsonb))`;
  const withCharge = `jsonb_set(${metaBase}, '{meta,chargePending}', 'true'::jsonb)`;
  const markerSql = needsSnapshotSettle
    ? `UPDATE operator_proposals SET campaign_id = $2::uuid,
         proposal_json = jsonb_set(${withCharge}, '{meta,cycleSnapshotPending}', 'true'::jsonb)
       WHERE id = $1::uuid`
    : `UPDATE operator_proposals SET campaign_id = $2::uuid, proposal_json = ${withCharge}
       WHERE id = $1::uuid`;
  let markerOk = false;
  for (let attempt = 0; attempt < 2 && !markerOk; attempt++) {
    try {
      await query(markerSql, [proposalId, campaignId]);
      markerOk = true;
    } catch (e: any) {
      console.warn(`[ContinuousOperator AutoSend] campaign_id 기록 ${attempt + 1}차 실패:`, e?.message);
    }
  }
  if (!markerOk) {
    // 마커가 못 심겼다 = 회차 마감·정산 대조의 근거가 없다. 발송은 이미 커밋돼 되돌릴 수 없으니 알린다.
    await notify(
      '[AI 자동마케팅] 확인 필요',
      `'${op.name || ''}' 발송은 나갔지만 마감 기록이 실패했습니다. ${needsSnapshotSettle ? '다음 회차에 같은 분들이 다시 잡힐 수 있고, ' : ''}크레딧 정산이 자동으로 확인되지 않을 수 있어 담당자 확인이 필요합니다.`,
    );
  }

  // ★ 2026-07-03 Gap5 Layer2: 고객별 발송 카운터 (예측 분모 전용, fire-and-forget — 발송·돈 무영향, campaignRef 멱등)
  //   서버사이드 필터 적재라 id를 Node로 안 들고온다(대량 상한 제거와 정합). 발송 추출과 동일 where.
  void recordCustomerSendsByFilter({
    companyId,
    campaignRef: `op:${campaignId}`,
    filterWhere, filterParams, storeFilter: sendStoreFilter, baseParams: sendBaseParams,
    // ⛔ 2R 정정: 발송 뒤 재조회에 피로도를 다시 걸지 않는다. 같은 발송 경로의 recordFatigueSends가 먼저 끝나면
    //   방금 보낸 고객이 cap에 걸려 분모에서 빠진다(cap=1이면 전원 누락). 실행 순서에 따라 결과가 달라지는 축을 뺀다.
    //   ⚠ 이 경로는 재설계 이전부터 피로도를 안 봤다(회귀 아님). 실제 수신자 원장 연결은 별건.
    gates: { excludeClickedSince: sendGates.excludeClickedSince },
  });

  // 기능 크레딧 1회 차감 (멱등키 proposalId) — 발송 성공 시점에만.
  //   ⛔ 2026-08-05: 종전엔 이 자리에 try/catch가 있었는데 **발화할 수 없는 분기**였다.
  //     deductCreditSafe는 잔액 부족(SKIP)·영구 실패(MISS)에도 throw하지 않고 정상 반환하므로
  //     결과 판정은 반환값으로만 한다 — true = 차감됨·이미 차감됨·차감 대상 아님 / false = 돈이 안 빠졌다.
  //   ★ 미확정이어도 **상태는 정상 마감한다.** 정산은 위 chargePending 마커가 들고 있고
  //     settlePendingCharges가 확정될 때까지 같은 멱등키로 재시도한다(상태 축과 정산 축 분리).
  const creditSettled = await deductCreditSafe({
    companyId, cost: getCreditCost('continuous-operator-send'), source: 'continuous-operator-send',
    createdBy: userId, idempotencyKey: `continuous-operator-send:${proposalId}`,
  });
  if (creditSettled) {
    await clearChargePendingMarker(proposalId);
  } else {
    console.warn(`[ContinuousOperator AutoSend] ${proposalId} 크레딧 차감 미확정 — chargePending 유지(정산 대조 패스가 재시도 · [CREDIT] 로그 확인)`);
  }

  // 완료 표시 + 통지 — 발송은 커밋됐으므로 상태는 마감한다(정산 여부는 마커가 소유).
  await query(
    `UPDATE operator_proposals SET status = 'sent', auto_sent_at = NOW() WHERE id = $1::uuid AND status = 'sending'`,
    [proposalId],
  );
  await notify('[AI 자동마케팅] 발송 완료', `'${op.name || ''}' ${recipientTotal}명에게 발송을 완료했습니다.`);

  // ★ 2026-07-12 C-2: 예산 사용 임계 알림 — 이번 발송으로 임계 비율 선을 처음 넘는 순간 1회(교차 판정 = 멱등).
  //   소진 집계는 예산 가드와 동일 기준(cost_estimate·동일 status 집합), 이번 제안은 id 제외로 "이전 소진"을 만든다.
  try {
    const spentRes = await query(
      `SELECT
         COALESCE(SUM(cost_estimate) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0) AS spent_month,
         COALESCE(SUM(cost_estimate) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS spent_today
       FROM operator_proposals
       WHERE operator_id = $1::uuid AND status IN ('approved', 'auto_executed', 'sent') AND id <> $2::uuid`,
      [p.operator_id, proposalId],
    );
    const budgetAlert = decideBudgetAlert({
      budgetMonthly: op.budget_monthly != null ? Number(op.budget_monthly) : null,
      budgetDaily: op.budget_daily != null ? Number(op.budget_daily) : null,
      thresholdPct: Number(op.budget_alert_threshold),
      spentMonthBefore: Number(spentRes.rows[0]?.spent_month) || 0,
      spentTodayBefore: Number(spentRes.rows[0]?.spent_today) || 0,
      addedCost: Number(p.cost_estimate) || 0,
    });
    if (budgetAlert.alert) {
      await notify('[AI 자동마케팅] 예산 사용 알림', `'${op.name || ''}' ${budgetAlert.message}`);
    }
  } catch (alertErr: any) {
    console.warn('[ContinuousOperator AutoSend] 예산 알림 경고:', alertErr?.message);
  }

  // ★ Phase2 A — 발송된 변이에 실측 trial(sent_count) 누적 → 다음 제안 Bandit 추천 정교화(클릭/전환은 추적 경로에서 별도 누적).
  if (chosenVariantId) {
    await recordVariantReward({ variantId: chosenVariantId, sent: recipientTotal, clicked: 0, converted: 0 })
      .catch((e: any) => console.warn('[ContinuousOperator AutoSend] Bandit trial 기록 경고:', e?.message));
  }

  // ★ Phase3 C — 다단계 시퀀스: 1차 발송 성공 시 설정돼 있으면 N일 후 미반응자 리마인드 예약(리마인드의 리마인드는 막음).
  //   2026-08-04 되살림 — 코호트(1차 캠페인 id)·발신번호·채널·1차 발송 시각을 넘겨 예약이 자체 완결되게 한다.
  //   미클릭 기준은 **1차 발송 커밋 직후 시각** — 여기까지 오는 사이(크레딧·마커 처리)의 클릭도 반응이다.
  //   예약 실패는 통지한다 — 켜 놨는데 조용히 안 나가는 상태가 이 기능의 원죄였다.
  if (op.sequence_enabled === true && pj.meta?.is_reminder !== true) {
    // 2R(#4·#6): 기준 시각은 캠페인 커밋 직후 캡처값, 수신 수는 claim 시점 값이 아니라 **실발송 실측**.
    await scheduleSequenceReminder(
      op, p, pj, companyId, campaignId, callback, msgType,
      primarySentAt || new Date(), recipientTotal,
    ).catch(async (e: any) => {
      console.warn('[ContinuousOperator Sequence] 리마인드 예약 경고:', e?.message);
      await notify('[AI 자동마케팅] 리마인드 예약 실패',
        `'${op.name || ''}' 리마인드 예약 중 오류가 발생했습니다. 자동마케팅 화면에서 확인해 주세요.`);
    });
  }

  // ★ 2026-08-04(R4): 스냅샷 전진은 여기서 하지 않는다 — 위 발송 커밋 마커가 심은
  //   cycleSnapshotPending을 settlePendingCycleSnapshots 패스가 캠페인 종결 확인 후 처리한다.
  return { action: 'sent', campaignId, sentCount: recipientTotal };
}

/**
 * ⛔ 2026-08-03 — 세그먼트 계약 컬럼이 운영에 있는지 판정.
 *
 * 왜 이렇게까지 하나: 8R에서 "부분 마이그레이션(한 컬럼만 존재)에 폴백이 계약을 남긴다"는 지적을 받고
 * 폴백을 통째로 지웠는데, 그러면 **배포와 DDL 사이 구간에서 자동마케팅 수정 저장이 전부 503**이 된다.
 * 화면은 계약 필드를 항상 함께 보내기 때문이다. 지적은 맞았지만 그 처방은 기능을 멈춘다.
 * 스키마를 실제로 보고 셋으로 가른다 — 둘 다 있으면 쓰고, 둘 다 없으면 옛 방식으로 저장되고,
 * 하나만 있으면(진짜 위험한 상태) 그때만 막는다.
 *
 * 캐시는 "준비됨"만 기억한다. 아직이면 매번 다시 본다 — DDL은 배포 뒤에 돌고, 그때 재기동 없이 자동 활성돼야 한다.
 */
let segmentColumnsReadyCache = false;
async function hasSegmentColumns(): Promise<boolean> {
  if (segmentColumnsReadyCache) return true;
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'continuous_operators' AND column_name IN ('segment_key', 'segment_params')`,
  );
  const n = Number(r.rows[0]?.n) || 0;
  if (n === 1) {
    throw new Error('DB 마이그레이션 필요 — continuous_operators segment column 하나만 존재합니다(두 컬럼 동시 추가 필요)');
  }
  segmentColumnsReadyCache = n === 2;
  return segmentColumnsReadyCache;
}

/**
 * ⛔ 2026-08-03 8R — 주인 없는 staging 정리. 캠페인이 소유권을 가져가기 전에 빠져나가는 모든 경로에서 부른다.
 *   전화번호·이름이 담긴 행이라 남겨 두면 안 되고, 이 테이블을 청소하는 워커도 따로 없다.
 *   삭제 실패는 삼키지 않고 남긴다(정리 대상이 남았다는 사실이 로그에 보여야 사람이 치울 수 있다).
 */
async function cleanupOrphanStaging(stagingId: string): Promise<void> {
  if (!stagingId) return;
  try {
    await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1::uuid`, [stagingId]);
  } catch (e: any) {
    console.error(`[ContinuousOperator AutoSend] staging 정리 실패 — 수동 삭제 필요 staging_id=${stagingId}:`, e?.message || e);
  }
}

/**
 * ★ Phase3 C — 다단계 시퀀스 리마인드. 1차 발송 성공 직후 호출.
 *
 * ⛔ 2026-08-03 4R — 지금은 만들지 않는다. 대상을 보장할 수 없기 때문이다.
 *   리마인드의 정의는 "1차를 받고 반응하지 않은 사람"인데 우리는 1차 수신자 집합을 갖고 있지 않다.
 *   조건을 발송 시점에 다시 컴파일하므로 1차 때 조건 밖이었다가 나중에 들어온 고객(등급 승급 등)이 대상에 들어온다.
 *   등록 시각 경계를 덧대 봤지만 신규 유입만 막고 조건 변동 진입은 못 막는 부분 방어였다.
 *   campaign_send_staging은 워커가 수신거부·중복을 지우고 처리 후 삭제하므로 사후 조인으로도 복원할 수 없다
 *   (스키마 실측: customer_id 없음 / direct-send-worker.ts 삭제 3곳).
 *   → 수신자 원장을 세우기 전까지 보류하고 사유를 담당자에게 알린다. 잘못된 대상에 보내느니 안 보낸다.
 */
/** 스팸 검증 대기 중 리마인드의 사유 문구 — 승격 CAS가 이 값으로만 올린다(사람 조작과 경합 금지). */
const REMINDER_SPAM_PENDING_REASON = '리마인드 문안 스팸 검증 중 — 통과하면 자동 예약됩니다';

/**
 * ★ 2026-08-04 2R(#3·c) — '검증 중' 좀비 대조. 분리 실행이 크래시하면 승격도 실패 표기도 없이
 * admin_review('검증 중')로 남는다. 자동 발송은 안 되지만(fail-closed) 화면 사유가 영원히 거짓이 된다.
 * 10분(검증 상한 5분의 2배) 넘은 행을 "확인 필요"로 전환하고 담당자에게 1회 통지한다 —
 * 사유 전환이 곧 재통지 차단(CAS)이라 별도 마커가 필요 없다(수렴).
 */
async function sweepStaleSpamPendingReminders(): Promise<void> {
  const stale = await query(
    `UPDATE operator_proposals p SET auto_execute_reason = '리마인드 문안 검증이 완료되지 않았습니다 — 문안 확인 후 승인해 주세요'
      WHERE p.status = 'admin_review' AND p.auto_execute_reason = $1
        AND p.created_at < NOW() - INTERVAL '10 minutes'
      RETURNING p.id, p.company_id, p.operator_id`,
    [REMINDER_SPAM_PENDING_REASON],
  );
  for (const row of stale.rows as any[]) {
    const opRes = await query(
      `SELECT name, admin_phone_numbers, backup_admin_phone, created_by FROM continuous_operators WHERE id = $1::uuid`,
      [row.operator_id],
    ).catch(() => ({ rows: [] as any[] }));
    const op = opRes.rows[0] || {};
    await notifyOperatorAdmins(
      {
        adminPhoneNumbers: Array.isArray(op.admin_phone_numbers) ? op.admin_phone_numbers : [],
        backupAdminPhone: op.backup_admin_phone || null,
        companyId: row.company_id,
        createdBy: op.created_by || null,
      },
      '[AI 자동마케팅] 리마인드 확인 필요',
      `'${op.name || ''}' 리마인드 문안 검증이 완료되지 않았습니다. 자동마케팅 화면에서 문안 확인 후 승인해 주세요.`,
    ).catch((e: any) => console.warn('[ContinuousOperator Sequence] 검증 잔존 통지 경고:', e?.message));
  }
}

/**
 * ★ 2026-08-04 리마인드 되살림 — 1차 발송 성공 직후 미반응자 리마인드를 예약한다.
 *
 * 2026-08-03에 보류한 이유는 "1차 수신자 집합을 모른다"였다. 이제 안다 — 발송 큐가 그 원장이다
 * (`app_etc1` = 1차 캠페인 id, readCampaignQueuedPhones successOnly — 성공 코드만). 새 표는 만들지 않았다.
 * 발송 대상 = 1차 실수신 ∩ 지금 안전필터 ∩ 미클릭(1차 발송 시각 이후) ∩ 피로도 — dispatch의 코호트 분기가 소유.
 *
 * ⛔ 스팸 검증을 이 함수 안에서 기다리지 않는다(Codex 1R-c) — 검증 큐는 전역 직렬 FIFO에 건당 25~90초라
 *   동기로 기다리면 발송 워커·수동 승인 HTTP가 그만큼 멈추고, 완료 조회가 계속 실패하면 영구 대기다.
 *   대신 **admin_review('검증 중')로 먼저 durable하게 넣고**, 검증을 분리 실행으로 돌려 통과 시 CAS로
 *   scheduled 승격, 실패·시간초과 시 그대로 두고 통지한다. 크래시 = admin_review 잔존(사람 눈에 보이는
 *   fail-closed — 검증 없이 자동 발송되는 방향으로는 절대 안 넘어간다).
 * ⛔ 문안은 관리자 작성이라 AI 재생성 없이 1회만 검사한다(maxRetries 0 · regenerateCallback 없음).
 * 예약 실패류는 전부 통지한다 — 켜 놨는데 조용히 안 나가는 상태가 이 기능의 원죄였다.
 */
async function scheduleSequenceReminder(
  op: any, p: any, pj: any, companyId: string,
  primaryCampaignId: string, callback: string | null, primaryMsgType: string,
  /** 미클릭 판정 기준 = 1차 발송 커밋 직후 시각(호출부가 캡처) — 이 함수 진입 시각이 아니다. */
  primarySentAt: Date,
  /** 1차 실발송 실측 수(staging 적재 rowCount) — claim 시점 recipient_count가 아니다(2R #6). */
  actualRecipients: number,
): Promise<void> {
  const notifyCtx = {
    adminPhoneNumbers: Array.isArray(op.admin_phone_numbers) ? op.admin_phone_numbers : [],
    backupAdminPhone: op.backup_admin_phone || null,
    companyId,
    createdBy: op.created_by || null,
  };
  const tell = (title: string, body: string) =>
    notifyOperatorAdmins(notifyCtx, title, body)
      .catch((e: any) => { console.warn('[ContinuousOperator Sequence] 통지 경고:', e?.message); return false; });

  // EUC-KR 안전화(Codex 1R) — 관리자 문안도 AI 생성물과 같은 픽토그램 제거를 지난다. 내용어는 그대로,
  //   발송이 깨뜨릴 문자만 걷어낸다(SMS/LMS는 EUC-KR — 이모지는 게이트웨이에서 ?로 변형·전문 손상).
  const content = stripIncompatibleEmojis(
    typeof op.sequence_reminder_content === 'string' ? op.sequence_reminder_content : '',
  ).trim();
  const delayDays = typeof op.sequence_delay_days === 'number' && op.sequence_delay_days > 0
    ? Math.min(30, Math.floor(op.sequence_delay_days)) : null;
  if (!content || !delayDays) {
    await tell('[AI 자동마케팅] 리마인드 예약 안 함',
      `'${op.name || ''}' 리마인드 ${!content ? '문안이 입력되지 않아' : '대기 일수가 설정되지 않아'} 예약하지 않았습니다. 자동마케팅 수정에서 입력해 주세요.`);
    return;
  }

  // 채널 — 1차와 같게, 단 관리자 문안이 SMS 한도를 넘으면 LMS 승격(잘림 방지 — 수동 편집 경로와 같은 규칙).
  let reminderType = (primaryMsgType === 'LMS' || primaryMsgType === 'MMS') ? primaryMsgType : 'SMS';
  if (reminderType === 'SMS' && eucKrByteLength(content) > 90) reminderType = 'LMS';
  const reminderSubject = reminderType === 'SMS' ? '' : String(pj.messages?.[0]?.subject || op.name || '');

  // 예상 비용 — 1차 값 복사 금지(Codex 1R-e): SMS→LMS 승격이면 단가가 달라 표시 ≠ 실차감이 된다.
  //   리마인드 채널 단가 × 1차 수신 수(상한)로 다시 센다. 조회 실패 = 0(표시 전용 — 실차감은 발송 시 실측).
  let costEstimate = 0;
  try {
    const cRes = await query(
      `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, unit_price_basis FROM companies WHERE id = $1::uuid`,
      [companyId],
    );
    const costs = getCompanyCosts(cRes.rows[0] || {});
    const unit = reminderType === 'MMS' ? costs.mms : reminderType === 'LMS' ? costs.lms : costs.sms;
    costEstimate = Math.round((Number(actualRecipients) || 0) * (Number(unit) || 0));
  } catch (e: any) {
    console.warn('[ContinuousOperator Sequence] 리마인드 비용 추정 경고:', e?.message);
  }

  const scheduledAt = shiftToSendableHour(new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000));
  const reminderPj = {
    // 표시용 — 실제 대상은 코호트(dispatch is_reminder 분기)라 target 조건은 발송에 안 쓰인다.
    target: pj.target || {},
    channel: { recommended: reminderType, isAd: true },
    messages: [{ variantId: 'reminder', variantName: '미반응자 리마인드', body: content, subject: reminderSubject }],
    meta: {
      is_reminder: true,
      primary_campaign_id: primaryCampaignId,
      // 미클릭 판정 기준 시각 = 1차 발송 커밋 직후 — 이 함수까지 오는 사이의 클릭도 반응으로 인정된다.
      excludeClickedSince: primarySentAt.toISOString(),
    },
  };
  const ins = await query(
    `INSERT INTO operator_proposals (
      id, operator_id, company_id, proposal_json, recipient_count, cost_estimate,
      status, auto_executed, auto_execute_reason, scheduled_send_at, expires_at, created_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3::jsonb, $4, $5,
      'admin_review', false, $6, $7, $7::timestamptz + INTERVAL '7 days', NOW()
    ) RETURNING id`,
    [
      p.operator_id, companyId, JSON.stringify(reminderPj),
      // 상한 표시 — 1차 **실발송** 수(2R #6). 리마인드는 미반응자만 재추출이라 이보다 적다(사유에 명시).
      Number(actualRecipients) || 0,
      costEstimate,
      REMINDER_SPAM_PENDING_REASON,
      scheduledAt,
    ],
  );
  const reminderId = ins.rows[0]?.id;
  console.log(`[ContinuousOperator Sequence] ${op.name || ''} 리마인드 등록 ${reminderId} (D+${delayDays} · 스팸 검증 대기)`);

  // 분리 실행 — 발송 경로를 막지 않는다. 5분 상한(검증 큐 행 대비 — 초과 = 통과 아님, 안 보내는 방향).
  void (async () => {
    let spamPassed = false;
    let spamNote = 'error';
    try {
      const opt080 = await getOpt080Number(op.created_by || null, companyId);
      const spam = await Promise.race([
        autoSpamTestWithRegenerate({
          companyId,
          userId: op.created_by || companyId,
          callbackNumber: callback || '',
          messageType: reminderType as 'SMS' | 'LMS' | 'MMS',
          subject: reminderSubject || undefined,
          variants: [{ variantId: 'reminder', messageText: content, subject: reminderSubject || undefined }],
          isAd: true,
          rejectNumber: opt080 || undefined,
          maxRetries: 0,
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('spam-verify-timeout')), 5 * 60 * 1000)),
      ]);
      const vr = (spam as any)?.variants?.[0];
      spamPassed = vr?.spamResult === 'pass';
      spamNote = String(vr?.spamResult || 'failed');
    } catch (e: any) {
      console.warn('[ContinuousOperator Sequence] 리마인드 스팸 검증 예외:', e?.message);
    }
    if (spamPassed) {
      // CAS — '검증 중' 그대로일 때만 승격. 그 사이 사람이 승인·중지했으면 그 판단을 덮지 않는다.
      const up = await query(
        `UPDATE operator_proposals SET status = 'scheduled', auto_executed = true,
            auto_execute_reason = $2
          WHERE id = $1::uuid AND status = 'admin_review' AND auto_execute_reason = $3
          RETURNING id`,
        [reminderId, `미반응자 리마인드 — 1차 수신자 중 미클릭만 발송 시점 재추출 (D+${delayDays})`, REMINDER_SPAM_PENDING_REASON],
      ).catch((e: any) => { console.warn('[ContinuousOperator Sequence] 리마인드 승격 경고:', e?.message); return { rows: [] as any[] }; });
      if (up.rows.length > 0) console.log(`[ContinuousOperator Sequence] 리마인드 ${reminderId} 스팸 통과 — 예약 확정`);
    } else {
      // 2R(#3·b): 사유 갱신도 CAS — 0행이면 사람이 이미 승인·정지한 것이라 "미통과·승인 필요" 통지가 모순이 된다.
      const marked = await query(
        `UPDATE operator_proposals SET auto_execute_reason = $2
          WHERE id = $1::uuid AND status = 'admin_review' AND auto_execute_reason = $3
          RETURNING id`,
        [reminderId, `리마인드 문안 스팸 검증 미통과(${spamNote}) — 문안 수정 후 승인 필요`, REMINDER_SPAM_PENDING_REASON],
      ).catch((e: any) => { console.warn('[ContinuousOperator Sequence] 리마인드 사유 갱신 경고:', e?.message); return { rows: [] as any[] }; });
      if (marked.rows.length > 0) {
        await tell('[AI 자동마케팅] 리마인드 검토 필요',
          `'${op.name || ''}' 리마인드 문안이 스팸 검증을 통과하지 못해 자동 예약을 보류했습니다. 문안 수정 후 승인해 주세요.`);
      }
    }
  })();
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
  // ★ 2026-07-07: createdBy 옵셔널 — ContinuousOperator 전체를 넘기는 호출부는 자동 포함(구조 서브셋), 인라인 조립 호출부는 미지정 가능.
  operator: { adminPhoneNumbers: string[]; backupAdminPhone: string | null; companyId: string; createdBy?: string | null },
  title: string,
  body: string,
  // ⛔ 2026-08-03 1R 정정: 실제로 적재했는지 돌려준다. 호출부가 "보냈다"를 기록하려면 그 사실을 알아야 한다
  //   (수신 번호 0건도 실패다 — 종전엔 조용히 아무것도 안 보내고 성공처럼 끝났다). 기존 호출부는 반환값을 안 봐도 무해하다.
): Promise<boolean> {
  const phones = [...(operator.adminPhoneNumbers || []), operator.backupAdminPhone || '']
    .map((p) => String(p || '').replace(/\D/g, ''))
    .filter((p) => /^01\d{8,9}$/.test(p));
  let unique = Array.from(new Set(phones));
  // ★ 2026-07-07 폴백 (마케팅 캘린더 완비): 담당자 번호가 비면 통지가 조용히 전멸하던 구멍 차단.
  //   ① 오퍼레이터 등록 계정(users.phone) ② 회사 대표 관리자.
  // ⛔ 2026-08-03 7R 정정: 종전 조건은 user_type='company_admin'이었는데 그 값은 **DB에 없다**(JWT 변환값).
  //   실측 = admin 126 / user 101 / system 75. 그래서 담당자 번호가 비면 폴백이 늘 0건이었고,
  //   0건 통지·발송 보류 안내가 한 통도 안 나간 채 조용히 끝났다. DB 원시값으로 고친다.
  //   기존 등록분(담당자 미입력)과 인라인 조립 호출부까지 CT 1곳에서 일괄 수혜. 조회 실패 = 기존 동작(무통지) 유지.
  if (unique.length === 0) {
    try {
      const fb = await query(
        `SELECT phone FROM users
          WHERE (($1::uuid IS NOT NULL AND id = $1::uuid)
             OR (company_id = $2::uuid AND user_type = 'admin'))
            AND is_active = true AND COALESCE(is_system, false) = false
          ORDER BY (id = $1::uuid) DESC, id ASC`,
        [operator.createdBy || null, operator.companyId],
      );
      const fallback = fb.rows
        .map((r: any) => String(r.phone || '').replace(/\D/g, ''))
        .filter((p: string) => /^01\d{8,9}$/.test(p));
      if (fallback.length > 0) unique = [fallback[0]];
    } catch (e: any) {
      console.log('[ContinuousOperator] 담당자 폴백 연락처 조회 실패(통지 생략):', e?.message || e);
    }
  }
  if (unique.length === 0) return false;

  // TODO(알림톡 템플릿 등록 후): 1순위 알림톡(insertAlimtalkQueue) → 실패 시 아래 문자(2순위)로 fallback.
  // ★ Harold 2026-07-02: 모든 담당자 안내 문자 첫 줄 = [한줄로 AI 자동마케팅 안내문자] (중앙 1곳 부착)
  const wrappedBody = wrapOperatorNoticeBody(body);
  const authTable = await getAuthSmsTable();
  // ★ 2026-07-09 발신번호 = 한줄로 대표번호. 옛: call_back에 수신자 본인 번호 → 발신=수신 → 번호도용차단 가입 담당자 미수신.
  const noticeCallback = getPlatformNoticeCallback();
  const rows = unique.map((phone) => [
    phone,                  // dest_no
    noticeCallback,         // call_back (한줄로 대표번호)
    wrappedBody,            // msg_contents
    'L',                    // msg_type (LMS)
    title.slice(0, 40),     // title_str
    null,                   // sendreq_time (useNow)
    '',                     // app_etc1
    operator.companyId,     // app_etc2
    '', '', '',             // file_name 1/2/3
  ]);
  // ⛔ 2R 정정: bulkInsertSmsQueue는 적재 건수를 돌려주고 내부 오류를 삼켜 0을 낼 수 있다.
  //   반환값을 버리고 true를 주면 "한 통도 안 나갔는데 보냈다"가 된다. 실제 적재 건수로만 판정한다.
  const inserted = await bulkInsertSmsQueue([authTable], rows as any, true);
  return Number(inserted) > 0;
}

/**
 * ★ 2026-08-03 A-5 — 조용한 0건 제거. 대상 0으로 이번 회차 제안을 만들지 않았다는 사실과 사유를 담당자에게 알린다.
 *
 * 쿨다운 7일: 매일 도는 오퍼레이터가 계속 0건이면 매일 문자가 가서 그 자체가 사고다.
 *   기록 컬럼(zero_target_notified_at) CAS로 창당 1회만 보내고, 대상이 다시 잡히면 clearZeroTargetNotice가 창을 연다.
 * 컬럼 미생성(마이그레이션 전) = 통지 생략(종전 동작) — ALTER 후 다음 회차부터 자동 활성.
 *   catch는 42703(undefined_column)만 삼킨다. 다른 오류를 삼키면 통지 실패가 조용해진다.
 */
async function notifyZeroTargetOnce(
  operator: { id: string; name: string; adminPhoneNumbers: string[]; backupAdminPhone: string | null; companyId: string; createdBy?: string | null },
  countError: string | null,
): Promise<void> {
  // 창을 먼저 잡아 같은 주기의 중복 발송을 막되, 직전 값을 들고 있다가 실패하면 그대로 되돌린다.
  //   ⛔ 1R 정정: 종전엔 잡기만 하고 적재 실패를 삼켜, 큐 장애나 담당자 번호 부재로 한 통도 못 보낸 채
  //   7일 동안 "통지함"으로 남았다. 기록은 효과가 끝난 뒤에만 확정한다.
  let prev: Date | null = null;
  let claimed: Date | null = null;
  try {
    const claim = await query(
      `UPDATE continuous_operators c
          SET zero_target_notified_at = NOW()
         FROM continuous_operators old
        WHERE c.id = old.id AND c.id = $1::uuid
          AND (c.zero_target_notified_at IS NULL OR c.zero_target_notified_at < NOW() - INTERVAL '7 days')
        RETURNING old.zero_target_notified_at AS prev, c.zero_target_notified_at AS claimed`,
      [operator.id],
    );
    if (claim.rows.length === 0) return;
    prev = claim.rows[0].prev ? new Date(claim.rows[0].prev) : null;
    claimed = claim.rows[0].claimed ? new Date(claim.rows[0].claimed) : null;
  } catch (e: any) {
    if (e?.code === '42703') return;   // 컬럼 미생성 = 통지 생략(안전)
    throw e;
  }
  const body = countError
    ? `'${operator.name}' 이번 회차 발송 대상을 확인하지 못해 문자를 만들지 않았습니다. 사유: ${countError}. 조건을 확인해 주세요.`
    : `'${operator.name}' 이번 회차 발송 대상이 0명이라 문자를 만들지 않았습니다. 조건에 해당하는 고객이 없습니다.`;
  let sent = false;
  try {
    sent = await notifyOperatorAdmins(operator, '[AI 자동마케팅] 발송 대상 없음', body);
  } catch (e: any) {
    console.warn('[ContinuousOperator] 0건 통지 실패:', e?.message);
  }
  if (!sent) {
    // 한 통도 못 보냈다 — 창을 되돌려 다음 주기에 다시 시도한다(번호를 채우거나 큐가 살아나면 즉시 나간다).
    // ⛔ 2R 정정: 내 claim이 그대로 남아 있을 때만 되돌린다(CAS). 조건이 없으면 느리게 실패한 실행이
    //   그 사이 성공한 다른 실행의 최신 창을 지워 같은 통지가 두 번 나간다.
    await query(
      `UPDATE continuous_operators SET zero_target_notified_at = $2
        WHERE id = $1::uuid AND zero_target_notified_at IS NOT DISTINCT FROM $3`,
      [operator.id, prev, claimed],
    ).catch((e: any) => console.warn('[ContinuousOperator] 0건 통지 창 복원 경고:', e?.message));
  }
}

/** 대상이 다시 잡히면 0건 통지 창을 연다(수렴). 컬럼 미생성·오류는 흐름에 영향 주지 않는다. */
async function clearZeroTargetNotice(operatorId: string): Promise<void> {
  await query(
    `UPDATE continuous_operators SET zero_target_notified_at = NULL
      WHERE id = $1::uuid AND zero_target_notified_at IS NOT NULL`,
    [operatorId],
  ).catch((e: any) => {
    if (e?.code !== '42703') console.warn('[ContinuousOperator] 0건 통지 창 해제 경고:', e?.message);
  });
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
    scheduleMonth: row.schedule_month ?? null,  // ★ 2026-07-05 yearly (컬럼 미존재/ALTER 전 = null 안전)
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
    // ★ 2026-07-07: 타겟 축 (컬럼 미생성/NULL = null → 기존 자유 해석)
    targetHint: normalizeTargetHint(row.target_hint),
    // ★ 2026-08-03 A-7: 세그먼트 계약 (컬럼 미생성/NULL = null → 옛 방식 유지)
    // ⛔ 2R 정정: 저장값을 여기서 화이트리스트로 깎지 않는다. 깎으면 우리가 모르는 축이 null이 되어
    //   "계약 없음"으로 둔갑하고, 컴파일 단계의 fail-closed 검사에 도달하지 못한 채 옛 경로로 흐른다.
    //   원문을 그대로 들고 가서 판정은 compileOperatorAudience 한 곳에서만 한다.
    segmentKey: typeof row.segment_key === 'string' && row.segment_key.trim() ? row.segment_key.trim() : null,
    segmentParams: row.segment_params && typeof row.segment_params === 'object' && !Array.isArray(row.segment_params)
      ? (row.segment_params as Record<string, number>)
      : null,
    // ★ 2026-07-30 (임은지 접수): MMS 이미지 (컬럼 미생성/NULL = [])
    mmsImagePaths: Array.isArray(row.mms_image_paths) ? row.mms_image_paths.filter((p: any) => typeof p === 'string' && p.trim()) : [],
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
    // ★ 2026-07-07: pending에도 발송 예정 시각 저장 — 승인 화면 "예정일 경과" 경고용(발송 패스는 status='scheduled' 게이트라 무영향)
    scheduledSendAt: row.scheduled_send_at ? new Date(row.scheduled_send_at) : null,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
    operatorName: row.operator_name,
    operatorObjective: row.operator_objective,
  };
}
