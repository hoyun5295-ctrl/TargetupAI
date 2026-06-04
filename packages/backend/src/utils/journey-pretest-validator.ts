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
import { enqueueSpamTest, getSpamTestBatchResults } from './spam-test-queue';
import { buildAdMessage, buildAdSubject, getOpt080Number } from './messageUtils';
import { randomUUID } from 'crypto';

export type FailedReason =
  | 'placeholder_unedited'
  | 'variable_mapping_invalid'
  | 'spam_filter_failed'
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
): Promise<ValidationResult> {
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
  // 실제 발송과 동일한 본문으로 검증 — 무료수신거부 080 조회 (buildAdMessage 합성용)
  const opt080 = await getOpt080Number(userId, companyId);

  for (const step of steps) {
    // variant 조회 (옛 D188 Phase 2-B-3 정합)
    const variantsRes = await query(
      `SELECT id, message_template
         FROM journey_step_variants
        WHERE step_id = $1`,
      [step.step_id],
    );
    const variants = variantsRes.rows;
    const messagesToValidate = variants.length > 0
      ? variants.map((v: any) => ({ variantId: v.id as string, body: v.message_template as string }))
      : [{ variantId: null, body: step.message_template as string }];

    for (const msg of messagesToValidate) {
      // a. placeholder 잔존 검증 (옛 D187-fix2 영구 룰 정합)
      if (hasUneditedPlaceholder(msg.body)) {
        failedSteps.push({
          stepId: step.step_id,
          variantId: msg.variantId,
          reason: 'placeholder_unedited',
          details: '[직접 작성해주세요] 또는 [URL 입력] placeholder 잔존',
        });
        continue;
      }

      // b. LMS/MMS subject 필수 검증 (옛 D91 정합)
      if ((step.channel === 'lms' || step.channel === 'mms') && !step.subject?.trim()) {
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
        const r = await runStepSpamTest({
          companyId,
          userId,
          body: msg.body,
          subject: step.subject,
          channel: step.channel as 'sms' | 'lms' | 'mms',
          isAd: stIsAd,
          callbackNumber: step.callback_number || '',
          opt080,
          variantId: msg.variantId || undefined,
        });
        if (!r.enqueueOk) {
          failedSteps.push({
            stepId: step.step_id,
            variantId: msg.variantId,
            reason: 'spam_filter_failed',
            details: `스팸필터 enqueue 실패 — ${r.error || 'unknown'}`,
          });
          continue;
        }
        if (!r.ok) {
          failedSteps.push({
            stepId: step.step_id,
            variantId: msg.variantId,
            reason: 'spam_filter_failed',
            details: `통신사 차단: ${r.failedCarriers.join(', ')}`,
            matchedStopWords: r.matchedStopWords,
          });
          continue;
        }
        confidenceSum += r.score;
        scoredCount += 1;
      }
    }
  }

  // 2. 비용 합산 + 7일 누적 예상
  const { totalCost, estimatedWeeklyTriggerCount } = await estimateCost(journeyId, steps);

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

function hasUneditedPlaceholder(body: string): boolean {
  if (/\[직접 작성해주세요\]/.test(body)) return true;
  if (/\[URL[^\]]*\]/.test(body)) return true;
  return false;
}

function validateAlimtalkVariableMap(body: string, varMap: Record<string, string>): boolean {
  const vars = body.match(/#\{([^}]+)\}/g) || [];
  for (const v of vars) {
    const key = v.slice(2, -1);
    if (!(key in varMap)) return false;
  }
  return true;
}

async function pollSpamResult(
  batchId: string,
  timeoutMs: number,
): Promise<{
  allPassed: boolean;
  failedCarriers: string[];
  matchedStopWords: string[];
  score: number;
}> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await getSpamTestBatchResults(batchId);
    const allFinished = result.variants.every((v) =>
      v.overallResult !== 'pending',
    );
    if (allFinished) {
      const failedCarriers: string[] = [];
      const matchedStopWords: string[] = [];
      for (const v of result.variants) {
        for (const c of v.carrierResults) {
          if (c.result === 'blocked' || c.result === 'failed') {
            failedCarriers.push(`${c.carrier}(${c.messageType})`);
          }
        }
        if (v.overallResult === 'timeout' || v.overallResult === 'failed') {
          failedCarriers.push(`overall_${v.overallResult}`);
        }
      }
      const allPassed = failedCarriers.length === 0;
      return {
        allPassed,
        failedCarriers,
        matchedStopWords,
        score: allPassed ? 95 : 50,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { allPassed: false, failedCarriers: ['timeout'], matchedStopWords: [], score: 0 };
}

// ════════════════════════════════════════════════════════════════════
// runStepSpamTest — 공용 스팸테스트 (활성화 검증 + Phase 6B 발송 2시간 전 스캐너 공유)
//   (광고)+무료거부+제목 합성 후 enqueue + 결과 폴링. 실발송과 동일 본문 가공.
// ════════════════════════════════════════════════════════════════════
export interface StepSpamTestResult {
  ok: boolean;            // 모든 통신사 통과
  enqueueOk: boolean;     // enqueue 자체 성공 여부 (실패/예외면 false)
  failedCarriers: string[];
  matchedStopWords: string[];
  score: number;
  error?: string;
}

export async function runStepSpamTest(params: {
  companyId: string;
  userId: string;
  body: string;
  subject: string | null;
  channel: 'sms' | 'lms' | 'mms';
  isAd: boolean;
  callbackNumber: string;
  opt080: string;
  variantId?: string;
}): Promise<StepSpamTestResult> {
  try {
    const batchId = randomUUID();
    const stMsgType = params.channel.toUpperCase() as 'SMS' | 'LMS' | 'MMS';
    // 실제 발송(journey-executor prepareSendMessage)과 동일하게 (광고)+무료거부+제목 합성 후 검증.
    const adBody = buildAdMessage(params.body, stMsgType, params.isAd, params.opt080);
    const adSubject = buildAdSubject(params.subject || '', stMsgType, params.isAd);
    const enqueueResult = await enqueueSpamTest({
      companyId: params.companyId,
      userId: params.userId,
      callbackNumber: params.callbackNumber || '',
      messageContentSms: params.channel === 'sms' ? adBody : '',
      messageContentLms: params.channel !== 'sms' ? adBody : '',
      messageType: stMsgType,
      subject: adSubject || undefined,
      source: 'auto_ai',
      variantId: params.variantId || undefined,
      batchId,
      skipPrepaid: false,
    });
    if (!enqueueResult.ok) {
      return { ok: false, enqueueOk: false, failedCarriers: [], matchedStopWords: [], score: 0, error: enqueueResult.error || enqueueResult.errorCode || 'enqueue_failed' };
    }
    const spamScore = await pollSpamResult(batchId, 30000);
    return {
      ok: spamScore.allPassed,
      enqueueOk: true,
      failedCarriers: spamScore.failedCarriers,
      matchedStopWords: spamScore.matchedStopWords,
      score: spamScore.score,
    };
  } catch (err: any) {
    return { ok: false, enqueueOk: false, failedCarriers: [], matchedStopWords: [], score: 0, error: err?.message || 'spam_test_exception' };
  }
}

async function estimateCost(
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

  let totalCost = 0;
  for (const step of steps) {
    const byteCount = (step.message_template || '').length * 2;
    const unitCost = getUnitCost(step.channel, byteCount);
    totalCost += unitCost * weeklyTriggerCount;
  }

  return { totalCost, estimatedWeeklyTriggerCount: weeklyTriggerCount };
}

function getUnitCost(channel: string, byteCount: number): number {
  if (channel === 'sms') return 9.9;
  if (channel === 'lms') return byteCount > 90 ? 27 : 9.9;
  if (channel === 'mms') return 81;
  if (channel === 'kakao') return 8;
  return 0;
}
