// packages/backend/src/utils/journey-pretest-validator.ts
// CT-92: 여정 활성화 시점 자동 검증 (D218+ 신설)
//   - 모든 step + variant 본문 일제 자동 검증
//   - 채널별 분기 (카카오 = placeholder + 변수 매핑 / SMS·LMS·MMS = + 스팸필터)
//   - 통과 X step = 활성화 차단 + AI 자동 재생성 1 클릭 진입
//   - 비용 합산 + 7일 누적 예상 + 신뢰도 점수
//
// 옛 활용 영역:
//   - enqueueSpamTest + getSpamTestBatchResults (CT-09)
//   - journey_steps + journey_step_variants (옛 D188 정합)
//   - journey_executions 7일 트리거 패턴 (예상 비용)

import { query } from '../config/database';
import { enqueueSpamTest, spamVerdictOf, readSpamTestOutcome, isSpamHold, peekSpamCheck, type SpamVerdict } from './spam-test-queue';
import { renderJourneySmsMessage, pickJourneySampleCustomer } from './journey-message-render';
import { getCompanyCosts } from '../config/defaults';
import { randomUUID } from 'crypto';
import { isDemoCompany } from './demo-company';   // ★ 2026-10-10 시연 회사 = 검사 발송 0(발송 2시간 전 스캐너 · 활성화 검증 공용)
import { stepSendVersions, loadStepVariantRows } from './journey-step-versions';
import { hasUneditedJourneyPlaceholder } from './send-placeholder-gate';   // ★ 2026-11-01 배포 2 C4 — 켜기 관문과 같은 자리 판정

export type FailedReason =
  | 'placeholder_unedited'
  | 'variable_mapping_invalid'
  | 'spam_filter_failed'
  // ★ 2026-10-25 #14(R7) — 검사 장애(시간 초과 · 통신사 결과 실패 · 접수 실패)는 차단이 아니다. 고칠 문안이 없고 잠시 뒤 다시 검증하면 된다.
  | 'spam_check_unavailable'
  // ★ 2026-11-01 B1-4 — 확인 중(통신사 전달 성공 + 앱 보고 없음) · 검사 중(같은 글 검사가 아직 진행 중) = 통과가 아니라 켜지 않는다(문안 문제 아님 · 잠시 뒤 다시)
  | 'spam_check_pending'
  | 'subject_missing';

export interface FailedStep {
  stepId: string;
  variantId: string | null;
  reason: FailedReason;
  details: string;
  matchedStopWords?: string[];
}

export interface CarrierScore {
  skt: number;
  kt: number;
  lguplus: number;
  mvno: number;
}

export interface ValidationResult {
  ok: boolean;
  failedSteps: FailedStep[];
  totalCost: number;
  estimatedWeeklyTriggerCount: number;
  confidenceScore: number; // 0~100 평균
  perCarrierScore?: CarrierScore;
}

/**
 * 여정 활성화 직전 = 모든 step + variant 본문 일제 검증.
 *
 * 채널별 분기:
 *   - 카카오 = placeholder + 변수 매핑 검증만 (옛 IMC 검수 통과 영역 = 스팸필터 무의미)
 *   - SMS/LMS/MMS = + 스팸필터테스트 + LMS/MMS subject 필수 검증
 *
 * 통과 X step 1건 이상 = ok=false → 활성화 차단 + AI 자동 재생성 진입.
 */
export async function validateJourneyForActivation(
  companyId: string,
  journeyId: string,
  userId: string,
  /**
   * ★ 2026-11-01 배포 2 C5 — 점검 응답이 같은 판정을 칸별로 펼친다(판정 두 벌 0).
   *   spam = 칸 판의 스팸 결과를 얻는 길(기본 = 검사를 걸고 기다림 · 점검 응답 = peekStepSpam 엿보기 · null = 검사 전)
   *   spamStates = 판마다 스팸 상태(통과 · 검사 중 · 확인 중 · 검사 전)를 받아 갈 그릇
   */
  opts: { spam?: (p: StepSpamParams) => Promise<StepSpamTestResult | null>; spamStates?: StepSpamState[] } = {},
): Promise<ValidationResult> {
  const spam = opts.spam ?? runStepSpamTest;
  // 1. step 조회 (step_type='message'만 — wait/condition 검증 제외)
  const stepsRes = await query(
    `SELECT s.id AS step_id, s.channel, s.message_template, s.subject,
            s.is_ad, j.callback_number, s.alimtalk_template_code,
            s.alimtalk_variable_map, s.step_order
       FROM journey_steps s
       JOIN journeys j ON j.id = s.journey_id
      WHERE s.journey_id = $1 AND j.company_id = $2
        AND COALESCE(s.step_type, 'message') = 'message'
      ORDER BY s.step_order ASC`,
    [journeyId, companyId],
  );
  const steps = stepsRes.rows;

  if (steps.length === 0) {
    return {
      ok: false,
      failedSteps: [],
      totalCost: 0,
      estimatedWeeklyTriggerCount: 0,
      confidenceScore: 0,
    };
  }

  const failedSteps: FailedStep[] = [];
  let confidenceSum = 0;
  let scoredCount = 0;

  for (const step of steps) {
    // ★ 2026-10-25 #1(R5) — 이 칸이 보낼 수 있는 판(변이마다 본문 · 제목 · 칸 채널) = 실행기 · 발송 2시간 전 재검사와 같은 목록(journey-step-versions).
    //   옛: 변이 본문을 칸 제목으로 검사해 변이 제목 · 채널로 나가는 글은 검사한 적이 없었다.
    //   켜기 직전이라 스냅샷은 보지 않는다(켜기가 지금 칸 · 변이로 새 스냅샷을 만든다).
    const messagesToValidate = stepSendVersions(
      { message_template: step.message_template ?? null, subject: step.subject ?? null },
      null,
      step.channel === 'kakao' ? [] : await loadStepVariantRows(step.step_id),
    );

    for (const msg of messagesToValidate) {
      // a. placeholder 잔존 검증 (옛 D187-fix2 영구 룰 정합)
      if (hasUneditedJourneyPlaceholder(msg.body)) {
        failedSteps.push({
          stepId: step.step_id,
          variantId: msg.variantId,
          reason: 'placeholder_unedited',
          details: '채울 자리 [...]가 남아 있음',
        });
        continue;
      }

      // b. LMS/MMS subject 필수 검증 (옛 D91 정합) · ★ 1025 #1 그 판의 제목(변이 제목 · 없으면 칸 제목)
      if ((step.channel === 'lms' || step.channel === 'mms') && !msg.subject?.trim()) {
        failedSteps.push({
          stepId: step.step_id,
          variantId: msg.variantId,
          reason: 'subject_missing',
          details: 'LMS/MMS 발송 시 제목 필수',
        });
        continue;
      }

      // c. 채널별 분기
      if (step.channel === 'kakao') {
        // 카카오 = 변수 매핑 검증만 (옛 IMC 검수 통과 영역)
        const varMap = (step.alimtalk_variable_map as Record<string, string>) || {};
        if (!validateAlimtalkVariableMap(msg.body, varMap)) {
          failedSteps.push({
            stepId: step.step_id,
            variantId: msg.variantId,
            reason: 'variable_mapping_invalid',
            details: '알림톡 본문 변수 (#{...}) 매핑 누락',
          });
          continue;
        }
        // 카카오 = 검수 통과 영역 default 신뢰도 100
        confidenceSum += 100;
        scoredCount += 1;
      } else if (step.channel === 'sms' || step.channel === 'lms' || step.channel === 'mms') {
        // SMS/LMS/MMS = 스팸필터테스트 (공용 runStepSpamTest — 스캐너와 동일 경로)
        const stIsAd = step.is_ad !== false;
        const r = await spam({
          companyId,
          userId,
          body: msg.body,
          subject: msg.subject,
          channel: step.channel as 'sms' | 'lms' | 'mms',
          isAd: stIsAd,
          callbackNumber: step.callback_number || '',
          journeyId,
          variantId: msg.variantId || undefined,
        });
        // ★ 2026-11-01 배포 2 C5 — 점검 응답(엿보기)에서 오늘 같은 글 검사가 없으면 = 검사 전(문안 문제 아님 · 켜기는 여기서 검사를 건다)
        if (r === null) {
          opts.spamStates?.push({ stepId: step.step_id, variantId: msg.variantId, state: 'before' });
          continue;
        }
        // ★ 2026-10-25 #14(R7) — 결과 = 공용 판정(통과 · 차단 · 검사 장애). 장애를 「통신사 차단」으로 적어 문안을 고치게 하지 않는다.
        if (r.verdict === 'error') {
          failedSteps.push({
            stepId: step.step_id,
            variantId: msg.variantId,
            reason: 'spam_check_unavailable',
            details: '스팸 검사를 마치지 못했어요(검사 장애). 문안 문제는 아니니 잠시 뒤 다시 검증해 주세요.',
          });
          continue;
        }
        if (isSpamHold(r.verdict)) {
          opts.spamStates?.push({ stepId: step.step_id, variantId: msg.variantId, state: r.verdict });
          failedSteps.push({
            stepId: step.step_id,
            variantId: msg.variantId,
            reason: 'spam_check_pending',
            details: r.verdict === 'pending'
              ? '스팸 검사가 아직 진행 중이에요. 잠시 뒤 다시 켜면 같은 검사 결과를 이어서 봐요(다시 차감하지 않아요).'
              : '통신사는 문자를 보냈는데 검사폰 확인이 늦어 결과를 확인하는 중이에요. 길어도 20분 안에 확정돼요. 그 뒤 다시 켜 주세요.',
          });
          continue;
        }
        if (r.verdict === 'blocked') {
          failedSteps.push({
            stepId: step.step_id,
            variantId: msg.variantId,
            reason: 'spam_filter_failed',
            details: `통신사 차단: ${r.failedCarriers.join(', ')}`,
            matchedStopWords: r.matchedStopWords,
          });
          continue;
        }
        void (r.verdict satisfies 'pass');
        opts.spamStates?.push({ stepId: step.step_id, variantId: msg.variantId, state: 'pass' });
        confidenceSum += r.score;
        scoredCount += 1;
      }
    }
  }

  // 2. 비용 합산 + 7일 누적 예상
  const { totalCost, estimatedWeeklyTriggerCount } = await estimateCost(companyId, journeyId, steps);

  return {
    ok: failedSteps.length === 0,
    failedSteps,
    totalCost,
    estimatedWeeklyTriggerCount,
    confidenceScore: scoredCount > 0 ? Math.round(confidenceSum / scoredCount) : 0,
  };
}

// ============================================================
// 헬퍼 함수
// ============================================================

function validateAlimtalkVariableMap(body: string, varMap: Record<string, string>): boolean {
  const vars = body.match(/#\{([^}]+)\}/g) || [];
  for (const v of vars) {
    const key = v.slice(2, -1);
    if (!(key in varMap)) return false;
  }
  return true;
}

/**
 * ★ 2026-10-25 여정 구조체크 2차 #14(뿌리 대장 R7) — 결과는 공용 판정 spamVerdictOf 로만 읽는다(통과 · 차단 · 검사 장애).
 *   옛: 통신사 결과 「실패」 · 전체 시간 초과 · 30초 안에 안 끝남을 전부 「차단」으로 셌다 → 켜기는 「통신사 차단: timeout」으로 막혔고,
 *   발송 2시간 전 재검사는 검사 장애에 AI 재생성(1크레딧)으로 고객 문안을 바꾸거나 여정을 멈췄다.
 *   여러 판을 한 묶음으로 넣으면 하나라도 차단 = 차단 · 차단 없이 하나라도 장애 = 장애 · 전부 통과 = 통과.
 */
export function batchVerdictOf(variants: Array<{ overallResult?: string | null; carrierResults?: Array<{ result?: string | null }> | null }>): SpamVerdict {
  if (variants.length === 0) return 'error';
  return mergeSpamVerdicts(variants.map((v) => spamVerdictOf({ spamResult: v.overallResult ?? null, carrierResults: v.carrierResults ?? [] }, 1)));
}

/**
 * ★ 2026-11-01 B1-4(Codex 설계 2R #2) — 판 여럿의 판정 하나(켜기 검증 · 보내기 전 검사 공용) · 전부 pass 일 때만 통과.
 *   차단 > 장애 > 확인 중 > 검사 중 > 통과 순으로 하나를 고른다(차단 = 고칠 문안 · 장애 = 재시도 상한 · 기다림 = 자동 행동 0).
 */
export function mergeSpamVerdicts(vs: readonly SpamVerdict[]): SpamVerdict {
  if (vs.length === 0) return 'error';
  for (const v of ['blocked', 'error', 'unconfirmed', 'pending'] as const) if (vs.includes(v)) return v;
  return 'pass';
}

/**
 * ★ 2026-11-01 B1-4 — 검사 번호로 읽는다(같은 검사 이어 보기 = 다른 묶음의 검사일 수 있다 · 옛: 묶음 번호).
 *   기다림 만료 = pending(검사가 아직 진행 중 · 장애 아님 · 다음에 같은 키로 이어 본다 · 옛: 30초 = 장애).
 */
async function pollSpamResult(
  testId: string,
  timeoutMs: number,
): Promise<{
  verdict: SpamVerdict;
  failedCarriers: string[];
  matchedStopWords: string[];
  score: number;
}> {
  const start = Date.now();
  for (;;) {
    const { outcome, carrierResults } = await readSpamTestOutcome(testId);
    if (outcome !== 'pending' || Date.now() - start >= timeoutMs) {
      // 화면에 적는 차단 통신사 = 실제 차단만(검사 장애 · 확인 중 통신사는 차단이 아니다)
      const failedCarriers = carrierResults.filter((c) => c.result === 'blocked').map((c) => `${c.carrier}(${c.messageType})`);
      return { verdict: outcome, failedCarriers, matchedStopWords: [], score: outcome === 'pass' ? 95 : outcome === 'blocked' ? 50 : 0 };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// ════════════════════════════════════════════════════════════════════
// runStepSpamTest — 공용 스팸테스트 (활성화 검증 + Phase 6B 발송 2시간 전 스캐너 공유)
//   ★ 2026-10-23 여정 결함 0 — 검사 글 = journey-message-render 한 곳(실발송 · 미리보기와 같은 함수 · 표본 = 이 여정 대상 1명).
//   옛: 저장된 광고 표시를 그대로 써서 실발송이 늘 붙이는 (광고) · 080 없이 검사할 수 있었고 Liquid 회사 · 예측 점수 갈래가 빠졌다.
// ════════════════════════════════════════════════════════════════════
export interface StepSpamTestResult {
  /** ★ 2026-10-25 #14 — 공용 판정(통과 · 차단 · 검사 장애). 호출부는 이 값으로만 가른다. */
  verdict: SpamVerdict;
  ok: boolean;            // = verdict === 'pass'
  enqueueOk: boolean;     // enqueue 자체 성공 여부 (실패/예외면 false · verdict = error)
  failedCarriers: string[];
  matchedStopWords: string[];
  score: number;
  error?: string;
}

export interface StepSpamParams {
  companyId: string;
  userId: string;
  body: string;
  subject: string | null;
  channel: 'sms' | 'lms' | 'mms';
  isAd: boolean;
  callbackNumber: string;
  /** 표본 고객을 고를 여정(없으면 변수 자리를 비운 글로 검사). */
  journeyId?: string;
  variantId?: string;
}

/** 판마다 스팸 상태(점검 응답 · ★ 2026-11-01 배포 2 C5) — 차단 · 장애는 failedSteps 가 들고 있다 */
export interface StepSpamState {
  stepId: string;
  variantId: string | null;
  state: 'before' | 'pending' | 'unconfirmed' | 'pass';
}

/** 검사에 넣는 글(실발송 · 미리보기와 같은 render · 표본 = 이 여정 대상 1명) — 등록 · 엿보기 공용 */
async function stepSpamInput(params: StepSpamParams) {
  const rendered = await renderJourneySmsMessage({
    companyId: params.companyId,
    createdBy: params.userId || null,
    template: params.body,
    subject: params.subject,
    channel: params.channel,
    isAd: params.isAd,
    customer: await pickJourneySampleCustomer(params.companyId, params.journeyId),
  });
  return {
    companyId: params.companyId,
    userId: params.userId,
    callbackNumber: params.callbackNumber || '',
    messageContentSms: params.channel === 'sms' ? rendered.message : '',
    messageContentLms: params.channel !== 'sms' ? rendered.message : '',
    messageType: rendered.msgType,
    subject: rendered.subject || undefined,
  };
}

/**
 * 칸 판의 오늘 검사를 엿본다(등록 · 차감 0 · 기다림 0 · ★ 2026-11-01 배포 2 C5 점검 응답).
 *   null = 검사 전(오늘 같은 글 검사 없음 · 지난 검사가 장애) · 그 밖 = runStepSpamTest 와 같은 꼴의 지금 결과.
 */
export async function peekStepSpam(params: StepSpamParams): Promise<StepSpamTestResult | null> {
  if (await isDemoCompany(params.companyId)) {
    return { verdict: 'pass', ok: true, enqueueOk: true, failedCarriers: [], matchedStopWords: [], score: 100 };
  }
  const seen = await peekSpamCheck(await stepSpamInput(params));
  if (!seen || seen.outcome === 'error') return null;   // 장애 = 켜기 · 자동 검사가 새로 건다(등록 함수의 재사용 규칙과 같다)
  if (seen.outcome !== 'blocked') return { verdict: seen.outcome, ok: seen.outcome === 'pass', enqueueOk: true, failedCarriers: [], matchedStopWords: [], score: seen.outcome === 'pass' ? 100 : 0 };
  const r = await readSpamTestOutcome(seen.testId);
  const failedCarriers = r.carrierResults.filter((x) => x.result === 'blocked').map((x) => x.carrier);
  return { verdict: 'blocked', ok: false, enqueueOk: true, failedCarriers, matchedStopWords: [], score: 0 };
}

/**
 * 칸 저장 뒤 통신사 검사를 건다(기다리지 않는다 · ★ 2026-11-01 배포 2 C5 · D1 · D2).
 *   같은 날 같은 글 = 이어 보기(차감 0) · 새 글 = 단가표대로 차감(켜기 · 보내기 전 검사와 같은 등록 길) · 실패는 로그만(저장을 막지 않는다).
 */
export async function startStepSpamCheck(params: StepSpamParams): Promise<void> {
  try {
    if (await isDemoCompany(params.companyId)) return;
    const r = await enqueueSpamTest({ ...(await stepSpamInput(params)), source: 'auto_ai', variantId: params.variantId || undefined, batchId: randomUUID(), skipPrepaid: false, reuseSameDay: true });
    if (!r.ok) console.warn(`[journey-auto-spam] 칸 저장 뒤 검사 못 걸음 journey=${params.journeyId} — ${r.errorCode || r.error}`);
  } catch (err: any) {
    console.warn(`[journey-auto-spam] 칸 저장 뒤 검사 오류 journey=${params.journeyId} — ${err?.message || err}`);
  }
}

export async function runStepSpamTest(params: StepSpamParams): Promise<StepSpamTestResult> {
  // ★ 2026-10-10 시연 회사 = 실제 검사 발송 0 — 검사하지 않고 통과로 본다(자동마케팅 autoSpamTestWithRegenerate 와 같은 규칙).
  //   옛: 발송 2시간 전 스캐너가 시연 회사도 검사 대기열에 넣어 선불 차감 최후 방어에서 [DEMO-LEAK] 로 막히고 주기마다 다시 시도했다(1010 운영 로그).
  //   판정 조회 실패는 아래 catch 가 받는다(enqueueOk false = 기존 실패 처리 · 스캐너는 다음 주기 재시도).
  try {
    if (await isDemoCompany(params.companyId)) {
      return { verdict: 'pass', ok: true, enqueueOk: true, failedCarriers: [], matchedStopWords: [], score: 100 };
    }
    const batchId = randomUUID();
    const enqueueResult = await enqueueSpamTest({
      ...(await stepSpamInput(params)),
      source: 'auto_ai',
      variantId: params.variantId || undefined,
      batchId,
      skipPrepaid: false,
      // ★ 2026-11-01 B1-4(J15) — 같은 날 같은 글 = 같은 검사 이어 보기(차감 0 · 옛: 회차마다 새 검사 · 새 차감)
      reuseSameDay: true,
    });
    if (!enqueueResult.ok) {
      return { verdict: 'error', ok: false, enqueueOk: false, failedCarriers: [], matchedStopWords: [], score: 0, error: enqueueResult.error || enqueueResult.errorCode || 'enqueue_failed' };
    }
    const spamScore = await pollSpamResult(enqueueResult.testId!, 30000);
    return {
      verdict: spamScore.verdict,
      ok: spamScore.verdict === 'pass',
      enqueueOk: true,
      failedCarriers: spamScore.failedCarriers,
      matchedStopWords: spamScore.matchedStopWords,
      score: spamScore.score,
    };
  } catch (err: any) {
    return { verdict: 'error', ok: false, enqueueOk: false, failedCarriers: [], matchedStopWords: [], score: 0, error: err?.message || 'spam_test_exception' };
  }
}

async function estimateCost(
  companyId: string,
  journeyId: string,
  steps: any[],
): Promise<{ totalCost: number; estimatedWeeklyTriggerCount: number }> {
  const triggerRes = await query(
    `SELECT COUNT(*)::int AS cnt FROM journey_executions
      WHERE journey_id = $1
        AND created_at >= NOW() - INTERVAL '7 days'`,
    [journeyId],
  );
  const weeklyTriggerCount = Number(triggerRes.rows[0]?.cnt || 0);

  // ★ Fix #7 (2026-06-05): 임의 단가(9.9/27/81/8) 제거 → 회사 실 단가(companies.cost_per_*).
  //   executor·simulator와 동일 CT(getCompanyCosts). 채널 기준 단가로 실제 차감과 일치.
  const costRes = await query(
    `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, unit_price_basis FROM companies WHERE id = $1::uuid`,
    [companyId],
  );
  const costs = getCompanyCosts(costRes.rows[0] || {});
  let totalCost = 0;
  for (const step of steps) {
    const ch = String(step.channel || 'lms').toLowerCase();
    const unitCost =
      ch === 'kakao' ? Number(costs.kakao) :
      ch === 'mms'   ? Number(costs.mms) :
      ch === 'lms'   ? Number(costs.lms) :
                       Number(costs.sms);
    totalCost += Math.round(unitCost) * weeklyTriggerCount;
  }

  return { totalCost, estimatedWeeklyTriggerCount: weeklyTriggerCount };
}
