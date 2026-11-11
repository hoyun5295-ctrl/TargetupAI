/**
 * CT-44: Journey Executor — D187 (2026-05-20)
 *
 * 목적
 *   활성 여정의 due execution을 5분 cron으로 처리하여 step별 메시지를 발송합니다.
 *
 * 핵심 흐름
 *   1. journey_executions.next_run_at <= NOW() AND status='active' 조회 (LIMIT 100)
 *   2. 각 execution: journey + step 로드, 정합성 검증
 *   3. 발송 시간 검증 (KST 08:00 ~ 21:00) — 광고 자동 검증 4건 중 1건 (Harold 명시 정합)
 *   4. 임계값 검증 (회사 자유 — NULL = 무제한 default)
 *      - budget_monthly: 월간 누적 비용 + 신규 비용 ≤ budget_monthly
 *      - threshold_cost_per_step: 단건 비용 ≤ threshold
 *   5. 잔액 검증 (prepaidDeduct atomic) — 부족 시 여정 paused
 *   6. prepareSendMessage(buildAdMessage + buildAdSubject) → 광고 자동 검증 4건 중 3건
 *   7. bulkInsertSmsQueue (1 row) — MySQL 발송 큐
 *   8. campaigns INSERT (source='journey') + journey_step_logs INSERT
 *   9. journey_executions advance: 다음 step 있으면 next_run_at = NOW() + delay_hours
 *      마지막 step이면 status='completed', completed_at=NOW(), 여정 stats 갱신
 *
 * 영구 원칙 정합
 *   - no_target_auto_relax: 0건 / 잔액 부족 / 임계값 초과 = 자동 완화 없음, 명시적 차단
 *   - ai_operator_model_isolation: executor는 AI 호출 영역 없음 (journey-builder만 Opus 4.7)
 *   - 회사 격리: 모든 SQL company_id 필수
 *   - no_humuson_keyword_exposure: 검수 단어 없음
 */

import { query } from '../config/database';
import { cdpEventNameMatchSql } from './cdp-order-revenue';   // ★ 2026-11-02 결제된 구매 CT(CT-J3)
import { pausedSetSql } from './journey-pause-reason';   // ★ 2026-11-02 여정 멈춤 CT(설계서 3-0 CT-J2)
import {
  getCompanySmsTables,
  hasCompanyLineGroup,
  recordCampaignSentTables,
  loadQueueUnit,
  QUEUE_UNIT_MAX,
} from './sms-queue';
import { sendSystemAlert, alertPassFailures, type PassFailure } from './system-alert';
import { toQtmsgType, subjectForMsgType } from './qtmsg-type';
import { normalizeMmsImagePaths } from './mms-image-util';
import { convertButtonsToQTmsg } from './alimtalk-button';
import { buildAlimtalkEtcJson } from './alimtalk-emphasize';
import { kakaoStepVerdict, type KakaoTemplateRow } from './journey-kakao-step';
import { journeyClickSql } from './journey-click';   // ★ 2026-11-02 여정 링크 클릭 판정 CT(설계서 3-0 CT-J9)   // ★ 2026-11-02 알림톡 칸 판정 CT(설계서 3-0 CT-J5)
import { fillAlimtalkVarMap } from './alimtalk-vars';
import { resolveAlimtalkFallback, alimtalkFallbackChargeType } from './alimtalk-fallback';
import { buildDefaultFallbacks } from './var-fallback';
import {
  listJourneyStepVariants,
  selectJourneyStepVariant,
} from './bandit-optimizer';
import { composeSpamCheckText } from './messageUtils';
import { findSpamBlockedTexts } from './spam-block';
import { resolveJourneyAdFlag } from './journey-ad-policy';
import { isCallbackRegistered, individualCallbackOf } from './callback-filter';   // ★ C105 H2 개별회신번호 = 직접발송과 같은 CT
// ★ 2026-07-05: 발송 피로도 보호 — 광고 step 단건 게이트(차감 전 skip) + 발송 카운터
import { getFatigueCap, getFatigueBlockedSet, recordFatigueSends } from './fatigue-guard';
import { randomUUID } from 'crypto';
import { resolveAdGateMode, AdGateMode, gatePhones, linkAdMarksSafe, AdHold } from './ad-send-gate';   // ★ 2026-11-06 C110 광고 관문 · ★ C113 두 길
import { prepaidDeduct, resolveKakaoCharge } from './prepaid';
import { deductCreditSafe, deductCreditOutcome, isChargedByKey, InsufficientCreditError } from './ai-credit';
import { getCreditCost, kstDateTag } from './ai-credit-calc';
import { logCampaignTraining } from './training-logger';
import { normalizePhone } from './normalize-phone';
import { getCompanyCosts, SEND_HOURS, NIGHT_AD_LOAD_LEAD_MS } from '../config/defaults';
import { shortenUrlsInTexts } from './short-url';
import { autoPauseExecution } from './journey-pause-handler';
import { KST_MONTH_START_SQL } from './stats-aggregation';   // ★ 2026-11-11 C129 D4 — 월 예산 달 = KST(조각 재사용)
import { calculateNextRunAt, clampPersonalSendHour, isWithinSendHours, sendWindowStateFor, isNightExemptStep, nextDaySendWindowStart } from './send-time-util';
import { pickStepCampaignForUnits } from './journey-step-campaign';
import { judgeLoadUnit, recordLoadUnit, clearLoadUnit, confirmLoadUnit } from './journey-send-claim';
import { evaluateCustomerFieldCondition, type ConditionOutcome } from './journey-condition';
import { isCustomerSendable } from './journey-safety-filter';
import { renderJourneySmsMessage, loadJourneyRenderShared, journeyCopyContext } from './journey-message-render';
import { flattenLiquidToPlainText } from './liquid-templating';
import { readOwnerConsentForCustomers } from './mall-consent';
// ★ §11-5(§5-1) — 종료 신호는 트리거 계약(단일 출처)에서 파생한다.
import { getTriggerContract, sendTimingForTrigger } from './journey-trigger-capability';
// ★ 2026-09-30 여정 V2 3차 — 상품 재구매 목표(같은 상품을 다시 샀는가) · 키 규칙은 journey-product 한 곳.
import { PRODUCT_REPURCHASE_SINCE_ENTRY_SQL } from './journey-product';
import { purchaseAfterSql, purchaseWithinDaysSql } from './two-door-purchase';   // ★ 2026-11-04 C99 CT-D4
import { isSingleStepKind } from './journey-start-kind';
import { isDemoCompany } from './demo-company';   // ★ 2026-10-09 시연 회사 = 발송 엔진 앞 절단(설계서 docs/2026-10-09-demo-company-design.md §2)
import { aiOperatorAllowedForWorker } from './plan-guard';
import { lineageColumnsReady } from './journey-lineage';
import { applyVariantToStep, latestSnapshotSql, stepSendVersions } from './journey-step-versions';   // ★ 2026-11-02 판 읽기 CT(설계서 3-0 CT-J1)
import { purchasedSinceEntrySql, isSignupTrigger, ENTRY_PURCHASE_VOIDED_SQL } from './journey-goal-purchase';
// ★ 2026-10-31 칸 관문 — 「그날 검사를 마쳤다」 판정 조각 한 곳(설계서 docs/2026-10-31-journey-step-gate-notice-design.md §2-1 · §2-2 · 뿌리 R30)
import { stepHeldSql, stepSendableSql, holdStepForCopyIssue } from './journey-pretest-notifier';
import { journeyCopyIssue } from './send-placeholder-gate';   // ★ 2026-11-02 보낼 글 판정 CT(설계서 3-0 CT-J10)   // ★ 2026-11-02 보낼 판 판정 CT(설계서 3-0 CT-J1 · 3-18)
import { runCompanyLanes } from './concurrency';
import { enrichCustomersWithPredictions } from './predictive-suite';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

interface ExecutionRow {
  execution_id: string;
  journey_id: string;
  company_id: string;
  customer_id: string;
  current_step_order: number;
  status: string;
  next_run_at: Date | null;
  entered_at: Date;
  total_cost: number;
  entry_event_properties: Record<string, any> | null;
  // journey 컬럼
  journey_status: string;
  budget_monthly: number | null;
  threshold_cost_per_step: number | null;
  threshold_recipients_per_step: number | null;
  stats_total_completed: number;
  stats_total_cost: number;
  created_by: string | null;
  journey_callback_number: string | null;
  callback_mode: string | null;
  // ★ 2026-11-02 발송 갈래(트리거 계약 sendTiming · 하루 묶음 = 같은 고객 한 통) · 구매로 시작한 여정인가(purchaseStream · 3-4 ②)
  trigger_event: string | null;
  // ★ 2026-06-30 여정 일반화 — date_anchor/one_shot은 단발(1 step 후 완료, 상대 advance 안 함).
  start_kind: string | null;
  // ★ 2026-07-10 목표 달성 자동 종료 — 진입 이후 구매 확인 시 잔여 step 중단(옵션, 기본 false).
  goal_exit_enabled: boolean;
  // ★ 2026-10-20 여정 V.3 §5-2 — 계보 뿌리(COALESCE(lineage_id, id) · 계보 컬럼이 없으면 여정 id). 운영 크레딧 키의 여정 자리.
  lineage_root?: string | null;
}

/** ★ V.3 §5-2 — 운영 크레딧(하루 1번) 키의 여정 자리 = 계보 뿌리. 옛 판 마무리 · 새 판이 같은 날 보내도 한 번만 받는다. */
export function operationCreditRoot(exec: { journey_id: string; lineage_root?: string | null }): string {
  return exec.lineage_root ? String(exec.lineage_root) : String(exec.journey_id);
}

/** ★ V.3 D1 — 크레딧이 모자라 멈춘 사유(사람 말 변환 · journey-pause-reason 이 이 문자열을 안다). */
export const JOURNEY_PAUSE_CREDIT_OUT = '이번 달 크레딧이 모자라 발송을 멈췄습니다';

/**
 * ★ V.3 D1(설계서 §5-6) — 이 계보의 오늘 운영 크레딧을 **보내기 전에 그 자리에서 잡아 둔다**(하루 1번 키 · 여정 운영 허용 0).
 *   잡아 둔 날 한 통도 안 나가면(피로도 · 회신번호 · 적재 실패) 하루가 끝난 뒤 되돌린다(journey-operation-release · Codex 적대 A 2R).
 *   옛(1R): 엄격 확인만 하고 차감은 적재 뒤에 했다 → 그 사이 다른 요청이 크레딧을 쓰면 확인은 통과 · 차감은 잔액 부족으로 삼켜져 무과금 발송이 확정됐다(Codex 적대 A1).
 *   차감 자체가 판정이다(회사 행 잠금 안 · 원자 · 멱등). 거짓 = 잔액 부족 → 보내지 않고 멈춘다.
 *   그날 이미 받았으면 차감 없이 참(조회만 · 발송마다 회사 행을 잠그지 않는다). 잔액 부족이 아닌 차감 실패(DB 오류 등)는 종전 원칙대로 발송을 막지 않고
 *   [CREDIT][MISS] 로그를 남긴다(뒤 확정 경로 chargeJourneyOperationCredit 가 같은 키로 다시 받는다).
 */
export async function reserveJourneyOperationCredit(exec: { company_id: string; journey_id: string; lineage_root?: string | null; created_by?: string | null }, at: Date): Promise<boolean> {
  const key = `journey-operation:${operationCreditRoot(exec)}:${kstDateTag(at)}`;
  if (await isChargedByKey(exec.company_id, key)) return true;
  try {
    await deductCreditOutcome({
      companyId: exec.company_id,
      cost: getCreditCost('journey-operation'),
      source: 'journey-operation',
      idempotencyKey: key,
      createdBy: exec.created_by || null,
      throwOnInsufficient: true,
    });
    return true;
  } catch (e) {
    if (e instanceof InsufficientCreditError) return false;
    throw e;
  }
}

interface StepRow {
  id: string;
  journey_id: string;
  step_order: number;
  step_type: string;
  delay_hours: number;
  channel: string | null;
  message_template: string | null;
  subject: string | null;
  is_ad: boolean;
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): wait step 정확도 — KST 시간대 영역
  delay_mode: string | null;       // 'relative' | 'specific_hour' | 'next_business_day' (default 'relative')
  target_hour_kst: number | null;  // 0~23 KST
  // ★ D188 Phase 2-B-1 (2026-05-21): condition step 평가용 conditionJsonb.
  condition_jsonb: Record<string, unknown> | null;
  // ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 + MMS 채널 확장 영역.
  alimtalk_profile_id: string | null;
  alimtalk_template_code: string | null;
  alimtalk_variable_map: Record<string, string> | null;
  alimtalk_next_type: string | null;
  alimtalk_next_contents: string | null;
  alimtalk_next_subject: string | null;
  mms_image_paths: string[] | null;
}

interface CustomerRow {
  id: string;
  phone: string;
  name: string | null;
  is_active: boolean;
  sms_opt_in: boolean;
  callback: string | null;
  store_phone: string | null;
  custom_fields: Record<string, any> | null;
  email: string | null;
  birth_date: Date | null;
  recent_purchase_date: Date | null;
  is_opt_out: boolean | null;
  is_invalid: boolean | null;
}

// ════════════════════════════════════════════════════════════════════
// Worker — 5분 cron
// ════════════════════════════════════════════════════════════════════

let workerRunning = false;

/**
 * ★ 2026-09-26 한줄로 V2 F39 — 한 주기에 밀린 실행을 비운다.
 * 옛: 5분마다 전 회사 합쳐 100건만(하루 최대 2.9만 건) · 한 회사의 대량 진입이 다른 회사 여정을 몇 시간씩 밀었다.
 * 예산은 주기(5분)보다 짧다 → 다음 주기와 겹치지 않는다(workerRunning 가드와 이중 안전).
 */
const JOURNEY_TICK_BUDGET_MS = 4 * 60 * 1000;
/** ★ 2026-11-02 엔진 재설계 E9 ① — 밀림 경보 문턱(분) */
export const EXECUTOR_LAG_ALERT_MINUTES = 30;
/** ★ 2026-11-02 엔진 재설계 E2-1 — 묶음 안 회사 줄 동시 수(회사 안 = 차례 · DB 연결 20 중 4) */
export const JOURNEY_EXECUTOR_CONCURRENCY = 4;

/**
 * ★ 2026-10-25 여정 구조체크 2차 #3(뿌리 대장 R8) — 처리 예외로 같은 실행을 다시 보는 상한.
 *   옛: 오류 수만 올리고 다음 실행 시각을 그대로 둬 5분마다 끝없이 다시 돌았고(실행 후보 맨 앞 · 오류 기록 하루 288줄),
 *   사람은 「이유 없이 안 나가는」 실행을 볼 길이 없었다. 12번(약 1시간) 넘게 실패하면 그 실행을 실패로 닫고 운영 경보를 한 번 보낸다
 *   (잠깐의 잠금 대기 · 연결 끊김은 그 안에 풀린다 · DB 전체 장애면 실행 후보 조회부터 실패해 여기까지 오지 않는다). 오류 기록은 최근 20줄만 남긴다.
 */
export const EXECUTION_ERROR_MAX = 12;
export const EXECUTION_ERROR_LOG_KEEP = 20;

/** ★ 2026-10-19 B-1009-6 — 재검사 전 수정 문안의 문자 발송을 다시 볼 간격(재검사 스캔 5분 주기 × 2) · 미루는 상한(스캐너 앞보기 창 2시간) */
export const PRETEST_PENDING_RECHECK_MINUTES = 10;
export const PRETEST_PENDING_MAX_HOURS = 2;

/** ★ 2026-11-02 엔진 재설계 E3-1 — 보류 칸(지금 판의 가장 최근 결정 = 보류)을 다시 볼 간격(분) · 장애가 아니라 경보 0 */
export const PRETEST_HELD_RECHECK_MINUTES = 60;

/** ★ 2026-11-02 묶음 하나 상한(설계서 docs/2026-11-02-journey-batch-send-design.md 3-3 ① · 직접발송 1만 청크와 같은 크기) */
export const JOURNEY_STEP_BATCH_MAX = 10_000;
/**
 * ★ 2026-11-02 한 차례 = 회사 대표 묶음 최대 이만큼(회사 줄 JOURNEY_EXECUTOR_CONCURRENCY 개가 차례로 돌려 쓴다).
 *   큰 회사 묶음 하나(1만 = 수십 초)가 한 줄을 쥐는 동안 나머지 줄이 작은 회사를 계속 받는다(옛 차례 = 줄 수만큼만 집어 큰 묶음 끝까지 다른 회사가 기다렸다 · 1102 처리 속도 실측).
 */
export const JOURNEY_GROUP_FETCH = 200;

/** ★ 2026-11-02 회사 순환 열쇠(회사가 마지막으로 묶음을 받은 시각 · C95 직접발송과 같은 꼴 · 메모리 · 재시작 = 빈 표 = 한 바퀴 느슨) */
const companyServedAt = new Map<string, number>();
function servedKeyArrays(): [string[], string[]] {
  const cutoff = Date.now() - 24 * 3600_000;
  for (const [co, at] of companyServedAt) if (at < cutoff) companyServedAt.delete(co);
  const entries = [...companyServedAt.entries()];
  return [entries.map(([co]) => co), entries.map(([, at]) => new Date(at).toISOString())];
}

type ExecutorSummary = { processed: number; sent: number; skipped: number; waited: number; conditionPassed: number; conditionFailed: number; paused: number; failed: number; goalExited: number };
const emptySummary = (): ExecutorSummary => ({ processed: 0, sent: 0, skipped: 0, waited: 0, conditionPassed: 0, conditionFailed: 0, paused: 0, failed: 0, goalExited: 0 });

export async function runJourneyExecutor(): Promise<ExecutorSummary> {
  if (workerRunning) return emptySummary();
  workerRunning = true;

  const summary = emptySummary();

  try {
    // ★ 2026-11-02 묶음 먼저 고르기(설계서 3-3 ① · SC-1) — 때가 된 실행을 (여정 · 칸)으로 센 집합(LIMIT 없는 집계) · 회사 대표 · 회사 단위 순환.
    //   옛: 묶음 100 · 회사당 25 를 실행마다 한 건씩(한 건 53ms = 한 회사 시간당 약 5.4만 · 엔진 설계서 §13).
    //   이번 회차에 다 본 묶음(더 나아갈 수 없음 · 남은 실행 없음)은 다시 집지 않는다(같은 회차 되풀이 0 · 재시도는 다음 회차).
    const tickStartedAt = Date.now();
    const doneGroups = new Set<string>();
    let rounds = 0;
    // ★ V.3 §5-2 — 계보 컬럼 확인 뒤에만 lineage_id 를 읽는다(없으면 여정 id · 42703 으로 발송 전체가 멈추지 않게).
    const lineageRootSql = (await lineageColumnsReady()) ? 'COALESCE(j.lineage_id, j.id)' : 'j.id';
    while (Date.now() - tickStartedAt < JOURNEY_TICK_BUDGET_MS) {
      const [keyCos, keyAts] = servedKeyArrays();
      const g = await query(
        `WITH due AS (
           SELECT e.journey_id, e.current_step_order, j.company_id, MIN(e.next_run_at) AS oldest
             FROM journey_executions e JOIN journeys j ON j.id = e.journey_id
            WHERE e.status = 'active' AND j.status = 'active'
              AND e.next_run_at IS NOT NULL AND e.next_run_at <= NOW()
              AND NOT ((e.journey_id::text || ':' || e.current_step_order::text) = ANY($1::text[]))
            GROUP BY e.journey_id, e.current_step_order, j.company_id
         ), rep AS (
           SELECT DISTINCT ON (company_id) * FROM due ORDER BY company_id, oldest ASC, journey_id, current_step_order
         )
         SELECT rep.journey_id, rep.current_step_order, rep.company_id
           FROM rep LEFT JOIN unnest($2::uuid[], $3::timestamptz[]) AS k(company_id, served_at) ON k.company_id = rep.company_id
          ORDER BY k.served_at ASC NULLS FIRST, rep.oldest ASC
          LIMIT $4`,
        [[...doneGroups], keyCos, keyAts, JOURNEY_GROUP_FETCH],
      );
      if (g.rows.length === 0) break;
      rounds++;
      const closedFailed: PassFailure[] = [];   // 이 차례에서 실패로 닫은 실행(차례 끝에 원장으로)

      // ★ 2026-11-02 엔진 재설계 E2-1 · 묶음 발송 — 회사끼리 동시 · 한 회사 = 한 줄(묶음 하나 · 한 (여정 · 칸)은 한 흐름 = 미확정 적재 단위 1 이하 · 3-8 I2)
      await runCompanyLanes(g.rows as Array<{ journey_id: string; current_step_order: number; company_id: string }>, (r) => String(r.company_id), JOURNEY_EXECUTOR_CONCURRENCY, async (grp) => {
        if (Date.now() - tickStartedAt >= JOURNEY_TICK_BUDGET_MS) return;   // 회차 예산을 넘겼다 = 새 묶음을 시작하지 않는다(다음 회차가 이어 받는다)
        const key = `${grp.journey_id}:${grp.current_step_order}`;
        let rows: ExecutionRow[] = [];
        try {
          const res = await query(
            `SELECT
               e.id AS execution_id,
               e.journey_id, e.customer_id,
               e.current_step_order, e.status, e.next_run_at, e.entered_at, e.total_cost,
               e.entry_event_properties,
               j.company_id, j.status AS journey_status,
               j.budget_monthly, j.threshold_cost_per_step, j.threshold_recipients_per_step,
               j.stats_total_completed, j.stats_total_cost, j.created_by,
               j.callback_number AS journey_callback_number,
               j.callback_mode, j.start_kind, j.trigger_event,
               COALESCE(j.goal_exit_enabled, false) AS goal_exit_enabled,
               ${lineageRootSql} AS lineage_root
             FROM journey_executions e
             JOIN journeys j ON e.journey_id = j.id
            WHERE e.journey_id = $1::uuid AND e.current_step_order = $2
              AND e.status = 'active' AND j.status = 'active'
              AND e.next_run_at IS NOT NULL AND e.next_run_at <= NOW()
            ORDER BY e.next_run_at ASC, e.id ASC
            LIMIT $3`,
            [grp.journey_id, grp.current_step_order, JOURNEY_STEP_BATCH_MAX],
          );
          rows = res.rows as ExecutionRow[];
          if (rows.length === 0) { doneGroups.add(key); return; }
          const out = await processStepBatch(rows);
          addSummary(summary, out);
          if (!out.progressed || rows.length < JOURNEY_STEP_BATCH_MAX) doneGroups.add(key);
        } catch (err: any) {
          doneGroups.add(key);
          summary.processed += rows.length;
          summary.failed += rows.length;
          const reason = err?.message || String(err);
          console.error(`[JourneyExecutor] journey=${grp.journey_id} 칸 ${Number(grp.current_step_order) + 1} 묶음 ${rows.length}건 처리 실패:`, reason);
          // ★ 2026-07-27 실패를 실행행에도 남긴다 · ★ 2026-10-25 #3 상한(EXECUTION_ERROR_MAX)에 닿으면 같은 문장에서 실패로 닫는다(R8)
          //   ★ 2026-11-02 묶음 = 그 문장의 실행 집합 전부에 같은 기록(설계서 ③ 처리 예외 · 이미 다음 칸으로 넘어간 실행은 빼고)
          try {
            for (const id of await recordExecutionErrors(rows.map((r) => r.execution_id), Number(grp.current_step_order), reason)) {
              console.error(`[JourneyExecutor] execution=${id} 처리 실패 ${EXECUTION_ERROR_MAX}회 → 실패로 닫음`);
              closedFailed.push({ companyId: grp.company_id, key: id, error: reason.slice(0, 200) });
            }
          } catch (logErr: any) {
            console.error(`[JourneyExecutor] journey=${grp.journey_id} 실패 기록 실패:`, logErr?.message || logErr);
          }
        } finally {
          companyServedAt.set(String(grp.company_id), Date.now());
        }
      });

      // ★ 2026-11-02 설계서 docs/2026-11-01-credit-control-tower-design.md §16-6 · §17-2 — 실패로 닫은 실행 = 차례마다 원장에 넣고 모아 보낸다(이름당 1시간 1통 · 항목 = 실행)
      if (closedFailed.length > 0) {
        await alertPassFailures({
          pass: 'journey-exec-failed',
          title: `여정 실행이 ${EXECUTION_ERROR_MAX}번 연속 처리 오류로 실패 처리됐습니다(더 보내지 않음).`,
          action: '서버 로그 [JourneyExecutor] 처리 실패 줄의 실행으로 원인을 확인해 주세요(실행 행 error_log 에도 남아 있습니다).',
          failures: closedFailed,
        }).catch(() => undefined);
      }
    }

    // ★ 2026-11-02 엔진 재설계 E9 ① — 발송 시간 안 가장 오래 밀린 실행이 30분을 넘으면 운영 경보(원인 하나 · 회사 없음 · 1시간)
    if (isWithinSendHours()) {
      await query(
        `SELECT COUNT(*)::int AS n, EXTRACT(EPOCH FROM (NOW() - MIN(e.next_run_at)))::int AS lag_s
           FROM journey_executions e JOIN journeys j ON j.id = e.journey_id
          WHERE e.status = 'active' AND j.status = 'active' AND e.next_run_at <= NOW() - INTERVAL '${EXECUTOR_LAG_ALERT_MINUTES} minutes'`,
      ).then((lag) => {
        const n = Number(lag.rows[0]?.n || 0);
        if (n > 0) {
          void sendSystemAlert({
            companyId: null, dedupKey: 'journey-executor-lag', cooldownMs: 60 * 60 * 1000,
            message: `여정 실행이 밀리고 있습니다. 보낼 시각이 ${EXECUTOR_LAG_ALERT_MINUTES}분 넘게 지난 실행 ${n}건 · 가장 오래된 것 ${Math.round(Number(lag.rows[0]?.lag_s || 0) / 60)}분.`,
          }).catch(() => undefined);
        }
      }).catch((e: any) => console.warn('[JourneyExecutor] 밀림 확인 실패:', e?.message || e));
    }

    if (summary.processed > 0) {
      console.log(`[JourneyExecutor] 처리 완료(차례 ${rounds}) — sent=${summary.sent} waited=${summary.waited} cond_pass=${summary.conditionPassed} cond_fail=${summary.conditionFailed} goal_exited=${summary.goalExited} skipped=${summary.skipped} paused=${summary.paused} failed=${summary.failed}`);
    }
    // ★ 2026-09-29 한줄로 V2 차수 5(m105 5R 범위 밖) — 실행 후보에서 빠진 실행에 남은 '적재 중' 표식 정리.
    await resolveOrphanJourneyClaims().catch((e: any) => console.error('[JourneyExecutor] 남은 적재 중 표식 정리 실패:', e?.message || e));
  } finally {
    workerRunning = false;
  }

  return summary;
}

function addSummary(sum: ExecutorSummary, b: BatchResult): void {
  sum.processed += b.processed; sum.sent += b.sent; sum.skipped += b.skipped; sum.waited += b.waited;
  sum.conditionPassed += b.conditionPassed; sum.conditionFailed += b.conditionFailed; sum.paused += b.paused;
  sum.failed += b.failed; sum.goalExited += b.goalExited;
}

/** 처리 예외 기록(실행 집합 중 아직 그 칸에 있는 실행 · 상한이면 같은 문장에서 실패로 닫음 · 닫은 실행 id) */
async function recordExecutionErrors(ids: string[], stepOrder: number, reason: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const up = await query(
    `UPDATE journey_executions
        SET error_count = COALESCE(error_count, 0) + 1,
            last_error_at = NOW(),
            error_log = (SELECT COALESCE(jsonb_agg(el.v ORDER BY el.n), '[]'::jsonb)
                           FROM jsonb_array_elements(COALESCE(error_log, '[]'::jsonb) || $2::jsonb) WITH ORDINALITY AS el(v, n)
                          WHERE el.n > jsonb_array_length(COALESCE(error_log, '[]'::jsonb) || $2::jsonb) - $4::int),
            status = CASE WHEN status = 'active' AND COALESCE(error_count, 0) + 1 >= $3::int THEN 'failed' ELSE status END,
            completed_at = CASE WHEN status = 'active' AND COALESCE(error_count, 0) + 1 >= $3::int THEN NOW() ELSE completed_at END
      WHERE id = ANY($1::uuid[]) AND current_step_order = $5::int
      RETURNING id, status`,
    [
      ids,
      JSON.stringify([{ at: new Date().toISOString(), stage: 'process_execution', reason: reason.slice(0, 500) }]),
      EXECUTION_ERROR_MAX,
      EXECUTION_ERROR_LOG_KEEP,
      stepOrder,
    ],
  );
  return up.rows.filter((r: any) => r.status === 'failed').map((r: any) => String(r.id));
}

/** 남은 표식으로 보는 나이 — 가드가 증명 안 됨을 다시 보는 간격(10분)과 같다. 그 안의 표식은 아직 발송 중일 수 있다. */
export const ORPHAN_CLAIM_MIN_AGE_MIN = 10;

/**
 * ★ 2026-09-29 한줄로 V2 차수 5(m105 5R 범위 밖) — 활성이 아닌 실행(정지·목표 달성·종료 · 또는 여정 정지)에 남은 '적재 중' 표식을
 * 가드와 **같은 판정 CT**로 정리한다(옛: 표식을 남긴 채 실행 후보에서 빠지면 다시 오지 않아 실제로 나간 1건이 통계에서 빠졌다).
 * ★ 2026-11-02 묶음 발송 — 판정 = 단위 판정 하나(judgeLoadUnit · 캠페인의 미확정 단위 = 한 번에 · 설계서 3-8) · 확정은 비용 통계까지 같은 문장(withStats).
 *   전진은 하지 않는다(활성 실행이 아니다 · 재개되면 묶음 가드가 'sent' · 닫힘을 보고 전진한다).
 */
async function resolveOrphanJourneyClaims(): Promise<void> {
  const lineageRootSql = (await lineageColumnsReady()) ? 'COALESCE(j.lineage_id, j.id)' : 'j.id';
  const r = await query(
    `SELECT DISTINCT ON (l.campaign_id) l.campaign_id, e.journey_id, j.company_id, j.created_by, ${lineageRootSql} AS lineage_root, e.customer_id
       FROM journey_step_logs l
       JOIN journey_executions e ON e.id = l.execution_id
       JOIN journeys j ON j.id = e.journey_id
      WHERE l.status = 'sending'
        AND l.campaign_id IS NOT NULL
        AND l.sent_at < NOW() - ($1 || ' minutes')::interval
        AND NOT (e.status = 'active' AND j.status = 'active')
      ORDER BY l.campaign_id, l.sent_at ASC
      LIMIT 50`,
    [String(ORPHAN_CLAIM_MIN_AGE_MIN)]
  );
  for (const row of r.rows) {
    try {
      const owner = { company_id: String(row.company_id), created_by: row.created_by || null, customer_id: String(row.customer_id) };
      const creditOwner = { company_id: owner.company_id, journey_id: String(row.journey_id), created_by: owner.created_by, lineage_root: row.lineage_root ? String(row.lineage_root) : null } as ExecutionRow;
      const judged = await judgeLoadUnit(owner, String(row.campaign_id), {
        beforeConfirm: (at) => chargeJourneyOperationCredit(creditOwner, at),
        withStats: true,
      });
      if (judged.result === 'sent') {
        console.warn(`[JourneyExecutor] 남은 적재 단위 → 장부 확인 → 발송 확정 campaign=${row.campaign_id} 표식 ${judged.claims.length}`);
      } else if (judged.result === 'cleared') {
        console.warn(`[JourneyExecutor] 남은 적재 단위 → 안 들어감 증명 → 표식 정리 campaign=${row.campaign_id} 표식 ${judged.claims.length}`);
      } else if (judged.result === 'closed') {
        alertUnprovableUnit(String(row.company_id), String(row.campaign_id), judged.claims.length);
      }
    } catch (e: any) {
      console.error(`[JourneyExecutor] 적재 중 표식 정리 실패 campaign=${row.campaign_id}:`, e?.message || e);
    }
  }
}

export function startJourneyExecutor(): void {
  const intervalMs = 5 * 60 * 1000;
  setInterval(() => {
    runJourneyExecutor().catch((err) => console.error('[JourneyExecutor] 예외:', err));
  }, intervalMs);
  setTimeout(() => {
    runJourneyExecutor().catch((err) => console.error('[JourneyExecutor] 초기 실행 예외:', err));
  }, 60 * 1000);
  console.log('[JourneyExecutor] 스케줄러 시작 (5분 주기)');
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-11-02 칸 처리 = 묶음 함수 하나(설계서 docs/2026-11-02-journey-batch-send-design.md 3-3 · Codex 설계 7R approve)
//   옛 한 건 판 processExecution 은 실행 한 건씩 약 30번 DB 를 오갔다(한 건 53ms). 그 갈래 전수를 같은 결말로 묶음 판에 옮겼다(③ 전이 표 · 30 갈래 · 코드 순서).
//   1건도 같은 함수(두 판 0 · 대장 R33). 판정 순서 = 고객별 「처음 걸리는 갈래 하나」 · 멈춤 경계 = 그 뒤 next_run_at 순으로 처음 멈춤인 고객.
// ════════════════════════════════════════════════════════════════════

export interface BatchResult extends ExecutorSummary { progressed: boolean }
const emptyBatch = (n: number): BatchResult => ({ ...emptySummary(), processed: n, progressed: false });

/** 고객 한 명의 최초 결말(전이 표) */
type RowOutcome =
  | { kind: 'skip'; reason: string }                       // skipped 로그 + 전진
  | { kind: 'fail'; reason: string }                       // failed 로그 + 전진
  | { kind: 'fail_end'; reason: string }                   // failed 로그 + 실행 ended
  | { kind: 'pause'; reason: string; pauseText: string; autoPause?: 'balance_insufficient' }  // failed 로그 + 여정 멈춤(경계)
  | { kind: 'demo' }                                       // sent · demo_simulated + 전진
  | { kind: 'send' };

interface SendRow {
  exec: ExecutionRow;
  customer: CustomerRow & Record<string, any>;
  message: string;
  subject: string;
  callback: string;
  phone: string;
  variantId: string | null;
}

/** 실행 · 여정이 지금도 진행 중인 실행만(진입 시점 정지 = 한 건 판 시점 1 의 묶음 판) */
async function stillActiveExecutions(execs: ExecutionRow[]): Promise<ExecutionRow[]> {
  const r = await query(
    `SELECT je.id FROM journey_executions je JOIN journeys j ON j.id = je.journey_id
      WHERE je.id = ANY($1::uuid[]) AND je.status = 'active' AND j.status = 'active'`,
    [execs.map((e) => e.execution_id)],
  );
  const ok = new Set(r.rows.map((x: any) => String(x.id)));
  return execs.filter((e) => ok.has(e.execution_id));
}

async function processStepBatch(input: ExecutionRow[]): Promise<BatchResult> {
  const res = emptyBatch(input.length);
  if (input.length === 0) return res;
  const head = input[0];
  // ★ D218+ 시점 1 — 진입 직전 실행 · 여정 상태 재확인(정지 경합 안전망)
  let execs = await stillActiveExecutions(input);
  res.paused += input.length - execs.length;
  if (execs.length === 0) return res;

  // ★ 2026-07-10 목표 달성 자동 종료 — 진입 이후 목표가 이뤄진 고객은 남은 칸 없이 goal_met(차감 · 발송 이전 · 판정 실패 = 계속)
  if (head.goal_exit_enabled) {
    const conv = await goalConvertedExecutionIds(execs);
    if (conv.size > 0) {
      await query(`UPDATE journey_executions SET status = 'goal_met', completed_at = NOW() WHERE id = ANY($1::uuid[]) AND status = 'active'`, [[...conv]]);
      console.log(`[JourneyExecutor] journey=${head.journey_id} 진입 이후 목표 달성 ${conv.size}명 → goal_met 종료(잔여 칸 중단)`);
      res.goalExited += conv.size;
      res.progressed = true;
      execs = execs.filter((e) => !conv.has(e.execution_id));
      if (execs.length === 0) return res;
    }
  }

  // 1. 다음 칸(현재 current_step_order + 1)
  const nextStepOrder = head.current_step_order + 1;
  const stepRes = await query(
    `SELECT id, journey_id, step_order, step_type, delay_hours, channel, message_template, subject, is_ad, condition_jsonb,
            alimtalk_profile_id, alimtalk_template_code, alimtalk_variable_map,
            alimtalk_next_type, alimtalk_next_contents, alimtalk_next_subject,
            mms_image_paths, delay_mode, target_hour_kst
     FROM journey_steps
     WHERE journey_id = $1::uuid AND step_order = $2`,
    [head.journey_id, nextStepOrder]
  );
  if (stepRes.rows.length === 0) {
    await finishExecutions(execs.map((e) => ({ id: e.execution_id, addedCost: 0 })), head.journey_id, { stepOrder: null });
    res.sent += execs.length;   // 옛 'completed' = 발송 수로 셌다(요약 숫자 그대로)
    res.progressed = true;
    return res;
  }
  const step = stepRes.rows[0] as StepRow;

  // ★ 2026-11-02 설계서 3-4 ② — 구매로 들어온 뒤 그 구매가 취소 · 환불되면 남은 칸 없이 끝(문자 · 대기 · 조건 칸 공통 · 발송 0).
  //   판정 = journey-goal-purchase 한 곳 · 조회 실패 = 던진다(묶음 실패 기록 · 다음 회차 · 취소된 주문에 보내지 않는 쪽).
  if (getTriggerContract(String(head.trigger_event || ''))?.purchaseStream) {
    const voided = await query(ENTRY_PURCHASE_VOIDED_SQL, [execs.map((e) => e.execution_id), head.company_id]);
    if (voided.rows.length > 0) {
      const ended = await query(
        `UPDATE journey_executions SET status = 'ended', completed_at = NOW() WHERE id = ANY($1::uuid[]) AND status = 'active' RETURNING id`,
        [voided.rows.map((x: any) => String(x.id))],
      );
      const endedIds = new Set<string>(ended.rows.map((x: any) => String(x.id)));
      await logStepMany([...endedIds], step.id, 'skipped', 'order_cancelled');
      console.log(`[JourneyExecutor] journey=${head.journey_id} 진입 구매 취소 · 환불 ${endedIds.size}명 → 발송 없이 끝`);
      res.progressed = true;
      execs = execs.filter((e) => !voided.rows.some((x: any) => String(x.id) === e.execution_id));
      if (execs.length === 0) return res;
    }
  }

  let pendingSnapshotAt: string | Date | null = null;   // ★ 1019 B-1009-6 최신 판이 재검사 전(신뢰도 < 100)이면 그 시각(아래 관문)
  let snapshotId: string | null = null;                 // ★ 2026-11-02 본문과 같이 읽은 판 id = 발송 선점 판 확인(설계서 3-18 · CT-J1)
  let snapshotReadFailed = false;                      // ★ 1019 B-1009-6 조회 실패 = 검사 여부를 모른다(문자 칸은 미룬다 · F4)
  // ★ D218+ (2026-05-26) snapshot 우선 조회 — 활성화 시점 본문 보존 안전망(칸마다 한 번 · 묶음 안 모든 고객이 같은 확정 문안).
  try {
    const snapRes = await query(`SELECT snap.* FROM ${latestSnapshotSql('$2::uuid', '$1::uuid')} snap`, [step.id, head.journey_id]);
    if (snapRes.rows.length > 0) {
      const snap = snapRes.rows[0];
      snapshotId = snap.id ? String(snap.id) : null;
      if (snap.confidence != null && Number(snap.confidence) < 100) pendingSnapshotAt = snap.created_at ?? null;
      if (snap.message_body) step.message_template = snap.message_body;
      if (snap.message_subject) step.subject = snap.message_subject;
    }
  } catch (snapErr: any) {
    snapshotReadFailed = true;
    console.warn(`[JourneyExecutor] snapshot 조회 실패 fallback:`, snapErr?.message);
  }

  // ★ 2026-09-30 여정 V2 4차 — 끝 칸: 발송 0 · 도착하면 그 자리에서 완료
  if (step.step_type === 'end') {
    await finishExecutions(execs.map((e) => ({ id: e.execution_id, addedCost: 0 })), head.journey_id, { stepOrder: step.step_order, endStepId: step.id });
    res.sent += execs.length;
    res.progressed = true;
    return res;
  }
  if (step.step_type === 'wait') return processWaitBatch(execs, step, res);
  if (step.step_type === 'condition') return processConditionBatch(execs, step, res);
  // ★ 2026-09-29 여정 V2 0차 ⑩ — 모르는 칸 종류는 **보내지 않는다**(fail-closed · 이 실행만 끝낸다)
  if (step.step_type !== 'message') {
    const ids = execs.map((e) => e.execution_id);
    await logStepMany(ids, step.id, 'skipped', 'unknown_step_type');
    await query(
      `UPDATE journey_executions SET status = 'ended', completed_at = NOW(), current_step_order = $2
       WHERE id = ANY($1::uuid[]) AND status = 'active'`,
      [ids, step.step_order]
    );
    console.error(`[JourneyExecutor] journey=${head.journey_id} step=${step.step_order} 모르는 칸 종류(${String(step.step_type)}) → ${ids.length}명 발송 없이 종료`);
    res.failed += execs.length;
    res.progressed = true;
    return res;
  }
  return processMessageBatch(execs, step, res, { pendingSnapshotAt, snapshotReadFailed, snapshotId });
}

/** 발송 창(I7 · 시작 = 실제 지금 · 끝 = 지금 + 여유 · 다음 창 = 판정과 같은 기준 시각) */
async function setNextRunAt(ids: string[], at: Date | string): Promise<void> {
  if (ids.length === 0) return;
  await query(`UPDATE journey_executions SET next_run_at = $2 WHERE id = ANY($1::uuid[]) AND status = 'active'`, [ids, at]);
}
async function delayExecutions(ids: string[], minutes: number): Promise<void> {
  if (ids.length === 0) return;
  await query(`UPDATE journey_executions SET next_run_at = NOW() + ($2 || ' minutes')::interval WHERE id = ANY($1::uuid[]) AND status = 'active'`, [ids, String(minutes)]);
}

/** ★ 2026-11-07 C113 D10 — 관문 길 회차의 예약 주인(싸개가 끝에서 해제) */
type AdGateRelease = { hold: AdHold | null; keep: Set<string> };   // ★ C113 D10 — 소유 CT(쥠 = 몸 · 끝정리 = 싸개 finally · keep = 큐에 실린 · 결과 불명 번호)

/**
 * ★ 2026-11-07 C113 D10 — 문자 칸 묶음(몸 = 아래 processMessageBatchBody 그대로) · 관문 길이 이 회차에 예약을 쓰면
 *   끝에서 이어지지 않은 예약을 지운다(큐에 실린 · 결과 불명 번호 = 남김 · 옛 길 = 쓴 예약이 없어 무동작).
 */
async function processMessageBatch(
  input: ExecutionRow[], step: StepRow, res: BatchResult,
  snap: { pendingSnapshotAt: string | Date | null; snapshotReadFailed: boolean; snapshotId: string | null },
): Promise<BatchResult> {
  const adRelease: AdGateRelease = { hold: null, keep: new Set<string>() };
  try {
    return await processMessageBatchBody(input, step, res, snap, adRelease);
  } finally {
    if (adRelease.hold?.holding) await adRelease.hold.settle([...adRelease.keep]);
  }
}

async function processMessageBatchBody(
  input: ExecutionRow[], step: StepRow, res: BatchResult,
  snap: { pendingSnapshotAt: string | Date | null; snapshotReadFailed: boolean; snapshotId: string | null },
  adRelease: AdGateRelease,
): Promise<BatchResult> {
  const head = input[0];
  let execs = input;
  const isTextChannel = ['sms', 'lms', 'mms'].includes(String(step.channel));

  // ── 5 · 6 이미 보냄 · 적재 중 표식(★ 0926 m105 · ★ 1102 단위 판정 · 3-8) ──
  const logRes = await query(
    `SELECT execution_id, status, error_reason, campaign_id FROM journey_step_logs
      WHERE execution_id = ANY($1::uuid[]) AND step_id = $2::uuid
        AND (status IN ('sent', 'sending') OR (status = 'failed' AND error_reason = 'load_unprovable'))`,
    [execs.map((e) => e.execution_id), step.id],
  );
  const doneIds = new Set<string>();
  const pendingCampaigns = new Set<string>();
  const pendingByExec = new Map<string, string>();
  for (const l of logRes.rows as any[]) {
    if (l.status === 'sent' || (l.status === 'failed' && l.error_reason === 'load_unprovable')) doneIds.add(String(l.execution_id));
  }
  for (const l of logRes.rows as any[]) {
    if (l.status === 'sending' && !doneIds.has(String(l.execution_id)) && l.campaign_id) {
      pendingCampaigns.add(String(l.campaign_id));
      pendingByExec.set(String(l.execution_id), String(l.campaign_id));
    }
  }
  if (doneIds.size > 0) {
    // ★ 0929 차수 5 — 모든 확정 경로가 운영 크레딧을 확정 **전에** 시도한다 → 'sent'면 이미 시도했다 · 전진만(비용 0)
    console.warn(`[JourneyExecutor] journey=${head.journey_id} step=${step.step_order} 이미 발송됨 ${doneIds.size}명(재처리 감지) → 중복 차감/발송 없이 전진`);
    await advanceExecutions(head, step, execs.filter((e) => doneIds.has(e.execution_id)).map((exec) => ({ exec, addedCost: 0 })));
    res.skipped += doneIds.size;
    res.progressed = true;
    execs = execs.filter((e) => !doneIds.has(e.execution_id));
  }
  const owner = { company_id: head.company_id, created_by: head.created_by, customer_id: head.customer_id };
  for (const campaignId of pendingCampaigns) {
    const judged = await judgeLoadUnit(owner, campaignId, { beforeConfirm: (at) => chargeJourneyOperationCredit(head, at), withStats: true });
    const inBatch = execs.filter((e) => pendingByExec.get(e.execution_id) === campaignId);
    if (judged.result === 'sent') {
      console.warn(`[JourneyExecutor] journey=${head.journey_id} step=${step.step_order} 적재 중 단위 → 장부 확인 → 발송 확정 ${judged.claims.length} · 다시 보내지 않음`);
      await advanceExecutions(head, step, inBatch.map((exec) => ({ exec, addedCost: 0 })));   // 비용 = 확정 문장이 이미 더했다(withStats)
      res.skipped += inBatch.length;
      res.progressed = true;
    } else if (judged.result === 'held') {
      await delayExecutions(inBatch.map((e) => e.execution_id), 10);
      console.warn(`[JourneyExecutor] journey=${head.journey_id} step=${step.step_order} 적재 중 단위 → 증명 안 됨 → 보내지 않고 10분 뒤 다시 판정(${inBatch.length}명)`);
      res.waited += inBatch.length;
      // 같은 캠페인에 미확정 단위가 남았다 = 이 (여정 · 칸)은 새 단위 0(I2) · 나머지 실행은 다음 회차
      return res;
    } else if (judged.result === 'closed') {
      alertUnprovableUnit(head.company_id, campaignId, judged.claims.length);
      await advanceExecutions(head, step, inBatch.map((exec) => ({ exec, addedCost: 0 })));
      res.failed += inBatch.length;
      res.progressed = true;
    } else if (judged.result === 'cleared') {
      // 다시 보내기의 적재 시도 상한 = 새 표식을 만드는 sendUnits 한 곳(표식이 어디서 지워졌든 · Codex 구현 3R)
      console.warn(`[JourneyExecutor] journey=${head.journey_id} step=${step.step_order} 적재 중 단위 → 안 들어감 증명 → 표식 정리 후 발송(${inBatch.length}명)`);
      continue;   // 이번 묶음에 남아 보낸다
    } else {
      continue;
    }
    const gone = new Set(inBatch.map((e) => e.execution_id));
    execs = execs.filter((e) => !gone.has(e.execution_id));
  }
  if (execs.length === 0) return res;

  // ── 8 · 9 관문(문자 칸 · 칸마다 한 번 · ★ 1019 B-1009-6 · ★ 1102 E3-1) ──
  const gate = await query(
    `SELECT ($1::timestamptz IS NOT NULL AND $1::timestamptz > NOW() - INTERVAL '${PRETEST_PENDING_MAX_HOURS} hours') AS pending,
            ${stepHeldSql('$2::uuid', '$3::uuid')} AS held`,
    [snap.pendingSnapshotAt, head.journey_id, step.id],
  );
  const ids0 = execs.map((e) => e.execution_id);
  if (gate.rows[0]?.held && isTextChannel) {
    await delayExecutions(ids0, PRETEST_HELD_RECHECK_MINUTES);
    res.waited += execs.length;
    return res;
  }
  if (snap.snapshotReadFailed && isTextChannel) {
    await delayExecutions(ids0, PRETEST_PENDING_RECHECK_MINUTES);
    console.warn(`[JourneyExecutor] journey=${head.journey_id} step=${step.step_order} 스냅샷 조회 실패 — 검사 여부를 몰라 문자 발송을 ${PRETEST_PENDING_RECHECK_MINUTES}분 미룬다`);
    res.waited += execs.length;
    return res;
  }
  if (snap.pendingSnapshotAt && isTextChannel) {
    await delayExecutions(ids0, PRETEST_PENDING_RECHECK_MINUTES);
    if (!gate.rows[0]?.pending) {
      console.warn(`[JourneyExecutor][PRETEST-LATE] journey=${head.journey_id} step=${step.step_order} 수정 문안이 ${PRETEST_PENDING_MAX_HOURS}시간 넘게 재검사 전 — 보내지 않고 기다린다(스캐너 · 검사 큐 확인)`);
      await sendSystemAlert({
        companyId: head.company_id,
        dedupKey: `journey-pretest-late:${head.journey_id}`,
        title: `여정의 고친 문안을 ${PRETEST_PENDING_MAX_HOURS}시간 넘게 검사하지 못해 발송을 기다리고 있습니다.`,
        details: ['확인할 곳: 발송 전 재검사 스캐너 로그 · 스팸 검사 대기열'],
        action: '검사가 끝나면 그 자리에서 바로 나갑니다. 슈퍼관리자 여정 화면에서 회사를 확인해 주세요.',
      }).catch((e: any) => console.warn('[JourneyExecutor] 재검사 지연 경보 실패:', e?.message));
    }
    res.waited += execs.length;
    return res;
  }
  // ── 10 발송 창(I7) ──
  const win = sendWindowStateFor(new Date(), isNightExemptStep(step));   // ★ 2026-11-02 발송 창 = CT 한 곳 · 정보성 알림톡 = 밤 예외(설계서 3-10)
  if (!win.open) {
    await setNextRunAt(ids0, win.next);
    res.skipped += execs.length;   // 옛 'skipped_hours'
    res.progressed = true;
    return res;
  }
  // ★ 2026-11-02 설계서 3-6 · §4 ① — 하루 묶음 이상치 관문 없앰(양으로 판정 오류를 뒤늦게 잡아 작은 여정을 통째로 멈췄다 · 신규 판정은 가입 근거로 들어오는 자리에서)
  const dailyLane = !isSingleStepKind(head.start_kind) && sendTimingForTrigger(String(head.trigger_event || '')) === 'daily';

  // ★ D188 Phase 2-B-3 — 변이(Bandit) · 조회 실패 = 처리 예외(★ 1025 R7 · 검사하지 않은 글이 나가지 않게)
  const variants = await listJourneyStepVariants(step.id);

  // ── 보낼 글 판정(★ 2026-11-02 설계서 3-3 ① · 3-13 · CT-J10 · 켜기 · 칸 저장 · 보내기 전 검사와 같은 함수 = 효과 자리) ──
  //   채울 자리 · 없는 변수 · 장바구니 변수 · 제목 변수가 남은 판 = 그 칸 보류(여정 멈춤 0 · 담당자 안내 원장 · 보류 관문이 60분마다 다시 본다)
  if (isTextChannel) {
    const versions = stepSendVersions(step, null, variants.map((v) => ({ id: v.id, message_template: v.messageTemplate, subject: v.subject })));
    const bodies = versions.map((v) => v.body);
    const copyIssue = journeyCopyIssue({ bodies, subjects: versions.map((v) => v.subject) }, await journeyCopyContext(head.company_id, head.trigger_event, bodies));
    if (copyIssue) {
      await holdStepForCopyIssue({ companyId: head.company_id, journeyId: head.journey_id, stepId: step.id, executionId: execs[0].execution_id, scheduledSendAt: new Date(execs[0].next_run_at ?? Date.now()) }, snap.snapshotId);
      await delayExecutions(execs.map((e) => e.execution_id), PRETEST_HELD_RECHECK_MINUTES);
      console.warn(`[JourneyExecutor] journey=${head.journey_id} step=${step.step_order} 보낼 글 판정(${copyIssue.code}) → 그 칸 보류 · ${execs.length}명 ${PRETEST_HELD_RECHECK_MINUTES}분 뒤 다시`);
      res.waited += execs.length;
      return res;
    }
  }

  // ── 11 고객 ──
  const custRes = await query(`SELECT * FROM customers WHERE id = ANY($1::uuid[]) AND company_id = $2::uuid`, [execs.map((e) => e.customer_id), head.company_id]);
  const custById = new Map<string, any>(custRes.rows.map((c: any) => [String(c.id), c]));
  const mallConsent = await readOwnerConsentForCustomers(head.company_id, head.created_by, [...custById.keys()]);
  const phones = [...custById.values()].map((c: any) => String(c.phone || '')).filter(Boolean);
  const unsubRes = phones.length > 0
    ? await query(`SELECT DISTINCT phone FROM unsubscribes WHERE company_id = $1::uuid AND phone = ANY($2::text[])`, [head.company_id, phones])
    : { rows: [] as any[] };
  const unsubPhones = new Set(unsubRes.rows.map((x: any) => String(x.phone)));
  const demoCompany = await isDemoCompany(head.company_id);
  const planOk = demoCompany || await aiOperatorAllowedForWorker(head.company_id, head.created_by);
  const lineOk = demoCompany || await hasCompanyLineGroup(head.company_id);
  let opCredit: boolean | null = null;   // 처음 그 자리에 닿는 고객이 있을 때 한 번(★ V.3 D1 · 그 자리 차감)
  // ★ 2026-11-05 C105 H2 — 「개별회신번호로 보내기」(DB 값 callback_mode='store' 그대로) = 직접발송 개별회신번호와 같은 CT(individualCallbackOf · 회신번호 → 비면 매장 전화번호).
  //   숫자 있는 값만 개별 번호(직접발송 2단계와 같은 normalizePhone 판정) · 없으면 여정 보내는 번호 · 등록 판정 = 여정 만든 계정(옛 그대로).
  //   옛: 매장 전화번호 → 여정 번호 → 고객 회신번호(직접발송과 순서가 달랐다 · 1105 접수 임은지 · 설계서 docs/2026-11-05-c105-out-of-scope-five-design.md §4 H2).
  const useStoreCallback = head.callback_mode === 'store';
  const individualOf = (c: any): string => { const v = String(individualCallbackOf(c) || '').trim(); return normalizePhone(v) ? v : ''; };
  const individualPhones = useStoreCallback ? [...new Set([...custById.values()].map(individualOf).filter(Boolean))] : [];
  const individualRegistered = new Map<string, boolean>();
  for (const sp of individualPhones) individualRegistered.set(sp, await isCallbackRegistered(head.company_id, sp, head.created_by || undefined));
  const isAd = resolveJourneyAdFlag(step.channel, step.is_ad);
  const fatigueCap = isAd ? await getFatigueCap(head.company_id) : null;
  const fatigueBlocked = fatigueCap ? await getFatigueBlockedSet(head.company_id, fatigueCap, phones) : new Set<string>();
  // ★ 2026-11-07 C113 D23 두 길 — 옛 길 = 위 HEAD 피로도 · 건너뜀 자리 그대로(관문 · 원장 0) ·
  //   관문 길(요금제 씀 + 새 기능)만 관문(전체 대조군 · 우선순위 · 원장 = 예약만 D13) · 묶음 = 이 칸 · 회차의 새 uuid ·
  //   확정(잇기) = 단위가 큐에 실린 뒤 그 단위 번호만(sendUnits) · 끝 = 이어지지 않은 예약 해제(D10) · 장애 줄도 못 쓰면 던짐(이 회차 멈춤 · 돈 0)
  const adGateMode: AdGateMode = isAd ? await resolveAdGateMode(head.company_id) : { mode: 'legacy' };
  const adGateBatch = adGateMode.mode === 'gate' ? randomUUID() : null;
  const adGate = adGateMode.mode === 'gate' && adGateBatch
    ? await gatePhones(adGateMode.policy, { branch: 'journey', batchId: adGateBatch, reserve: true, recordExclusions: false }, phones)
    : null;
  if (adGate?.marked && adGateBatch) { adRelease.hold = new AdHold(head.company_id); adRelease.hold.take(true, adGateBatch); }

  // 채널 · 문안 꼴(칸마다 한 번)
  const channelLower = (step.channel || 'lms').toLowerCase();
  const isKakao = channelLower === 'kakao';
  const channelType = (step.channel || 'lms').toUpperCase();
  const msgType = isKakao ? 'KAKAO' : (channelType === 'LMS' || channelType === 'MMS' ? channelType : 'SMS');
  // ★ 2026-11-02 알림톡 칸 판정 = CT-J5 한 곳(켜기 · 켜기 검증과 같은 함수 · 템플릿 코드 · 존재 · 승인 · 카카오 활성 · 템플릿 본문 변수 연결 · 설계서 3-14)
  const kakaoVerdict = isKakao ? await kakaoStepVerdict(head.company_id, step) : null;
  const kakaoTemplateRow: KakaoTemplateRow | null = kakaoVerdict?.row ?? null;
  const kakaoBlock = kakaoVerdict?.block ?? null;

  // ── 1단계(렌더 앞 갈래 11 ~ 21 · 코드 순서) ──
  const outcomes: Array<{ exec: ExecutionRow; out: RowOutcome | null }> = [];
  const seenCustomers = new Set<string>();
  const renderQueue: Array<{ idx: number; exec: ExecutionRow; customer: any; callback: string }> = [];
  let boundary = -1;
  // 고객별 최초 결말 = 전이 표 순서대로 처음 걸리는 갈래 하나(Codex 설계 2R #3) · render = 2단계로
  const firstOutcome = async (customer: any): Promise<RowOutcome | { kind: 'render'; callback: string }> => {
    if (!customer) return { kind: 'skip', reason: 'customer_not_found' };
    // ★ Fix #1 (2026-06-05) 발송 직전 안전필터 재적용 · ★ 2026-10-02 몰 동의 회사 = 여정 작성자 기준 소속 행 동의(묶음 한 문장)
    const consent = mallConsent === null ? null : (mallConsent.get(String(customer.id)) === true);
    // ★ 2026-11-02 설계서 3-11 · §4 ⑦ — 알림톡 칸(광고 판정 CT = false) = 활성 · 번호 유효만 · 080 거부는 광고 칸만
    if (!isCustomerSendable(consent === null ? customer : { ...customer, sms_opt_in: consent }, { informational: !isAd })) return { kind: 'skip', reason: 'opt_out_or_inactive' };
    if (isAd && unsubPhones.has(String(customer.phone))) return { kind: 'skip', reason: 'unsubscribed' };
    // ★ 2026-11-06 C110 — 광고 관문 건너뜀 = 수신거부 바로 뒤 · 요금제 · 라인 · 운영 크레딧 예약 앞(설계서 §4 · R47) · ★ C113 = 관문 길만(피로도 = 아래 HEAD 자리)
    {
      const adReason = adGate?.excluded.get(normalizePhone(String(customer.phone || '')));
      if (adReason) return { kind: 'skip', reason: adReason === 'priority' ? 'priority_lower' : 'global_holdout' };
    }
    if (dailyLane) {
      if (seenCustomers.has(String(customer.id))) return { kind: 'skip', reason: 'duplicate_in_batch' };
      seenCustomers.add(String(customer.id));   // 먼저 생긴 실행(next_run_at 순 첫째) = 이 고객의 한 통
    }
    // ★ 2026-10-19 B-1004-2① 요금제 잠김 · 라인그룹 · ★ V.3 D1 운영 크레딧(그 자리 차감 · 처음 닿는 고객에서 한 번) — 시연 회사는 앞 절단
    if (!planOk) return { kind: 'pause', reason: 'plan_locked', pauseText: '요금제가 잠겨 발송을 멈췄습니다' };
    if (!lineOk) return { kind: 'pause', reason: 'line_group_not_set', pauseText: '발송 라인그룹 미설정' };
    if (!demoCompany) {
      if (opCredit === null) opCredit = await reserveJourneyOperationCredit(head, new Date());
      if (!opCredit) return { kind: 'pause', reason: 'operation_credit_out', pauseText: JOURNEY_PAUSE_CREDIT_OUT };
    }
    // 개별회신번호 발송(store 모드) — 등록 안 된 개별 번호면 이 고객만 실패 · 회신번호 = 개별 번호 → 여정 번호(store 모드) · 여정 번호 → 고객 회신번호(고정 모드 · 옛 그대로)
    const individual = useStoreCallback ? individualOf(customer) : '';
    if (individual && individualRegistered.get(individual) === false) return { kind: 'fail', reason: 'callback_not_registered' };
    const callbackNumber = String(individual || head.journey_callback_number || (useStoreCallback ? '' : customer.callback) || '').trim();
    if (!callbackNumber) return { kind: 'pause', reason: 'callback_number_empty', pauseText: '회신번호가 비어있어 발송 차단됨' };
    // ★ 2026-07-05 발송 피로도 — 광고성 칸만 · 이 칸만 건너뜀(비용 0 · 여정 계속)
    if (fatigueCap && fatigueBlocked.has(normalizePhone(String(customer.phone || '')))) return { kind: 'skip', reason: 'fatigue_capped' };
    if (kakaoBlock) return { kind: 'pause', reason: kakaoBlock.reason, pauseText: kakaoBlock.pauseText };
    return { kind: 'render', callback: callbackNumber };
  };
  for (let i = 0; i < execs.length; i++) {
    const exec = execs[i];
    const customer = custById.get(exec.customer_id);
    const first = await firstOutcome(customer);
    if (first.kind === 'render') {
      renderQueue.push({ idx: i, exec, customer, callback: first.callback });
      outcomes.push({ exec, out: null });
      continue;
    }
    outcomes.push({ exec, out: first });
    if (first.kind === 'pause') { boundary = i; break; }
  }

  // ── 2단계(렌더 · 갈래 22 ~ 30) ──
  const sendRows: Array<SendRow & { idx: number }> = [];
  const variantByExec = new Map<string, string | null>();
  if (renderQueue.length > 0) {
    const shared = isKakao ? null : await loadJourneyRenderShared(head.company_id, head.created_by);
    const enriched = isKakao ? renderQueue.map((q) => q.customer) : await enrichCustomersWithPredictions(renderQueue.map((q) => q.customer), head.company_id);
    const rendered: Array<{ q: typeof renderQueue[number]; message: string; subject: string; variantId: string | null }> = [];
    for (let k = 0; k < renderQueue.length; k++) {
      const q = renderQueue[k];
      let rowStep = step;
      let variantId: string | null = null;
      if (variants.length > 0) {
        const rec = selectJourneyStepVariant(variants);
        if (rec) { variantId = rec.variant.id; rowStep = { ...step, ...applyVariantToStep(step, rec.variant) } as StepRow; }
      }
      variantByExec.set(q.exec.execution_id, variantId);
      const eventProps = (q.exec.entry_event_properties && typeof q.exec.entry_event_properties === 'object') ? q.exec.entry_event_properties : {};
      const customerWithEvent = { ...eventProps, ...(q.customer as Record<string, any>) };
      if (isKakao && kakaoTemplateRow) {
        const message = fillAlimtalkVarMap(String(kakaoTemplateRow.content || ''), rowStep.alimtalk_variable_map || {}, customerWithEvent, undefined, buildDefaultFallbacks(rowStep.alimtalk_variable_map || {}));
        rendered.push({ q, message, subject: rowStep.alimtalk_next_subject || '', variantId });
      } else {
        const r = await renderJourneySmsMessage({
          companyId: head.company_id, createdBy: head.created_by, template: rowStep.message_template || '', subject: rowStep.subject || '',
          channel: rowStep.channel || 'lms', isAd: rowStep.is_ad, customer: enriched[k] as Record<string, any>, shared: shared!, predictionsPreloaded: true,
        });
        rendered.push({ q, message: r.message, subject: r.subject, variantId });
      }
    }
    // 금칙어(★ 1003 전송자격인증 5.2 · 글자마다 · SC-24) — 렌더 갈래를 지난 문자 고객의 글자만
    const spamItems: Array<{ text: string; recipients: number }> = [];
    if (!isKakao) {
      for (const r of rendered) {
        if ((msgType === 'LMS' || msgType === 'MMS') && (!r.subject || r.subject.trim().length === 0)) continue;
        if (!r.message || r.message.trim().length < 2) continue;
        spamItems.push({ text: composeSpamCheckText({ message: r.message, subject: r.subject, msgType, isAd: false }), recipients: 1 });
      }
    }
    const spamBlocked = spamItems.length > 0
      ? await findSpamBlockedTexts({ items: spamItems, companyId: head.company_id, userId: head.created_by || null, source: 'journey' })
      : new Set<string>();

    // 비용(칸마다 한 번) · 임계 · 월 예산 · 잔액(차례대로 셈 · SC-5)
    const compRes = await query(`SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, unit_price_basis, billing_type, balance FROM companies WHERE id = $1::uuid`, [head.company_id]);
    const costs = getCompanyCosts(compRes.rows[0] || {});
    const unitCost = msgType === 'KAKAO' ? Number(costs.kakao) : msgType === 'LMS' ? Number(costs.lms) : msgType === 'MMS' ? Number(costs.mms) : Number(costs.sms);
    const sendCost = Math.round(unitCost);
    let monthCost = 0;
    if (head.budget_monthly != null) {
      // ★ 2026-06-06 J2 — 월 예산 = 이번 달 실제 발송 비용(journey_step_logs.cost · sent_at 당월) 합(묶음마다 한 번)
      const monthCostRes = await query(JOURNEY_MONTH_COST_SQL, [head.journey_id]);
      monthCost = Number(monthCostRes.rows[0]?.month_cost || 0);
    }
    const isPrepaid = compRes.rows[0]?.billing_type === 'prepaid';
    let balance = Number(compRes.rows[0]?.balance || 0);
    // ★ 2026-11-11 C129(D10) — 선불 알림톡 칸의 차감 꼴(차감과 같은 함수 · 여기는 잠금 없이 읽은 행 → 차감이 잠근 행으로 다시 확인한다).
    //   지출 관문(칸 임계 · 월 예산의 이번 몫 · 잔액 사전 확인 · 차례 차감) = 차감 단가(guardCost) · 칸 기록 비용 · 통계 = sendCost 그대로(발송 시점 추정).
    const kakaoFb = isKakao ? alimtalkFallbackChargeType(step.alimtalk_next_type) : null;
    const kakaoCharge = isPrepaid && isKakao ? resolveKakaoCharge(compRes.rows[0] || {}, kakaoFb) : null;
    const kakaoPay = kakaoCharge ? { fallback: kakaoFb, expectShape: kakaoCharge.unset === null ? kakaoCharge.shape : '' } : null;
    const ledgerShape = kakaoCharge ? (kakaoCharge.unset === null ? kakaoCharge.shape : `KAKAO|UNSET|${kakaoCharge.unset}`) : undefined;
    const guardCost = kakaoCharge && kakaoCharge.unset === null ? Math.round(kakaoCharge.unitPrice) : sendCost;
    const tables = demoCompany ? [] : await getCompanySmsTables(head.company_id, head.created_by || undefined);
    let sends = 0;
    // 렌더 갈래는 next_run_at 순 = 처음 걸리는 멈춤이 경계(1단계 경계보다 늘 앞이다 · 렌더 줄은 그 앞 고객만)
    for (const r of rendered) {
      const i = r.q.idx;
      let out: RowOutcome;
      if (!isKakao && (msgType === 'LMS' || msgType === 'MMS') && (!r.subject || r.subject.trim().length === 0)) out = { kind: 'pause', reason: 'subject_empty_for_lms_mms', pauseText: `step ${step.step_order} 제목이 비어있어 LMS/MMS 발송 차단` };
      else if (!isKakao && (!r.message || r.message.trim().length < 2)) out = { kind: 'fail', reason: 'empty_message_after_prepare' };
      else if (!isKakao && spamBlocked.has(composeSpamCheckText({ message: r.message, subject: r.subject, msgType, isAd: false }))) out = { kind: 'fail', reason: 'spam_blocked' };
      else if (head.threshold_cost_per_step != null && guardCost > Number(head.threshold_cost_per_step)) out = { kind: 'pause', reason: 'threshold_cost_exceeded', pauseText: `step 비용 ${guardCost.toLocaleString()}원 > 임계값 ${Number(head.threshold_cost_per_step).toLocaleString()}원` };
      else if (head.budget_monthly != null && monthCost + guardCost * (sends + 1) > Number(head.budget_monthly)) out = { kind: 'pause', reason: 'budget_monthly_exceeded', pauseText: `이번 달 누적 ${(monthCost + guardCost * (sends + 1)).toLocaleString()}원 > 월 예산 ${Number(head.budget_monthly).toLocaleString()}원` };
      else if (demoCompany) out = { kind: 'demo' };
      else if (isPrepaid && balance < guardCost) out = { kind: 'pause', reason: 'insufficient_balance', pauseText: `잔액 부족 (보유 ${balance.toLocaleString()}원 < 필요 ${guardCost.toLocaleString()}원)`, autoPause: 'balance_insufficient' };
      else if (!normalizePhone(r.q.customer.phone)) out = { kind: 'fail_end', reason: 'invalid_phone' };
      else if (tables.length === 0) out = { kind: 'pause', reason: 'no_sms_tables', pauseText: 'SMS 발송 테이블 미할당' };
      else {
        out = { kind: 'send' };
        sends++;
        if (isPrepaid) balance -= guardCost;
        sendRows.push({ idx: i, exec: r.q.exec, customer: r.q.customer, message: r.message, subject: r.subject, callback: r.q.callback, phone: normalizePhone(r.q.customer.phone), variantId: r.variantId });
      }
      outcomes[i].out = out;
      if (out.kind === 'pause') { boundary = i; break; }   // 경계 뒤 = 아무것도 안 함
    }

    // ── 31 적재(⑤ 적재 단위 계약) — 비발송 결말보다 먼저. 적재가 중간에 멈추면(돈 · 창 · 보류 · 바깥 멈춤 · 안 들어감 · 결과 불명) 그 자리 뒤 고객은
    //    이번 회차 결말 0(경계 계약 = 한 건 판의 「멈춘 뒤 진입 시점 정지」 · 다음 회차가 그 자리부터 다시 본다 · Codex 구현 1R) ──
    const stopIdx = sendRows.length > 0 ? await sendUnits(head, step, sendRows, { isKakao, msgType, isAd, sendCost, kakaoTemplateRow, tables, variantByExec, snapshotId: snap.snapshotId, adGateBatch: adGate?.marked ? adGateBatch : null, adKeep: adRelease.keep, kakaoPay, ledgerShape }, res) : null;
    const end = boundary < 0 ? outcomes.length : boundary;
    await applyRowOutcomes(head, step, outcomes, stopIdx == null ? end : Math.min(stopIdx, end), res);

    // ── 경계 고객 = 그 로그 + 여정 멈춤(앞 고객을 다 보낸 뒤에만 · 적재가 중간에 멈췄으면 다음 회차가 그 자리부터 다시 본다) ──
    if (boundary >= 0 && stopIdx == null) await applyBoundaryPause(head, step, outcomes[boundary], res);
    return res;
  }

  // 렌더 갈래에 닿은 고객이 없다 = 1단계 결말 · 경계만
  await applyRowOutcomes(head, step, outcomes, boundary < 0 ? outcomes.length : boundary, res);
  if (boundary >= 0) await applyBoundaryPause(head, step, outcomes[boundary], res);
  return res;
}

/** upto 앞 고객의 비발송 결말을 사유마다 한 문장씩(skip · fail · fail_end · demo · upto = 경계 또는 적재가 멈춘 자리) */
async function applyRowOutcomes(head: ExecutionRow, step: StepRow, outcomes: Array<{ exec: ExecutionRow; out: RowOutcome | null }>, upto: number, res: BatchResult): Promise<void> {
  const byReason = new Map<string, { status: 'skipped' | 'failed'; ids: ExecutionRow[]; advance: boolean; end: boolean }>();
  const demo: ExecutionRow[] = [];
  for (let i = 0; i < upto; i++) {
    const { exec, out } = outcomes[i];
    if (!out || out.kind === 'send' || out.kind === 'pause') continue;
    if (out.kind === 'demo') { demo.push(exec); continue; }
    const key = `${out.kind}:${out.reason}`;
    if (!byReason.has(key)) byReason.set(key, { status: out.kind === 'skip' ? 'skipped' : 'failed', ids: [], advance: out.kind !== 'fail_end', end: out.kind === 'fail_end' });
    byReason.get(key)!.ids.push(exec);
  }
  for (const [key, g] of byReason) {
    const reason = key.slice(key.indexOf(':') + 1);
    const ids = g.ids.map((e) => e.execution_id);
    await logStepMany(ids, step.id, g.status, reason);
    if (g.end) {
      // ★ 2026-10-25 #4(R6) — 번호가 무효면 이 고객의 실행을 끝낸다(ended · 발송 0 · 비용 0)
      await query(`UPDATE journey_executions SET status = 'ended', completed_at = NOW(), current_step_order = $2 WHERE id = ANY($1::uuid[]) AND status = 'active'`, [ids, step.step_order]);
      res.failed += ids.length;
    } else {
      await advanceExecutions(head, step, g.ids.map((exec) => ({ exec, addedCost: 0 })));
      if (g.status === 'skipped') res.skipped += ids.length; else res.failed += ids.length;
    }
    res.progressed = true;
  }
  if (demo.length > 0) {
    // ★ 2026-10-09 시연 회사 절단점 — 문안 · 판정까지는 진짜 · 캠페인 · 차감 · 큐 · 크레딧에는 닿지 않는다
    await query(
      `INSERT INTO journey_step_logs (id, execution_id, step_id, campaign_id, sent_at, status, cost, error_reason)
       SELECT gen_random_uuid(), x, $2::uuid, NULL, NOW(), 'sent', 0, 'demo_simulated' FROM unnest($1::uuid[]) AS x`,
      [demo.map((e) => e.execution_id), step.id]
    );
    await advanceExecutions(head, step, demo.map((exec) => ({ exec, addedCost: 0 })));
    res.sent += demo.length;
    res.progressed = true;
  }
}

/** 경계 고객 = failed 로그 + 여정 멈춤(+ 잔액이면 그 실행 자동 멈춤 기록 · 지금 글자 그대로) */
async function applyBoundaryPause(head: ExecutionRow, step: StepRow, row: { exec: ExecutionRow; out: RowOutcome | null }, res: BatchResult): Promise<void> {
  const out = row.out;
  if (!out || out.kind !== 'pause') return;
  await pauseJourney(head.journey_id, out.pauseText);
  await logStepMany([row.exec.execution_id], step.id, 'failed', out.reason);
  if (out.autoPause) {
    try {
      await autoPauseExecution({
        companyId: head.company_id, journeyId: head.journey_id, stepId: step.id, executionId: row.exec.execution_id,
        pauseReason: out.autoPause, pauseTriggerSource: 'auto_balance_check',
      });
    } catch (apErr: any) {
      console.warn(`[JourneyExecutor] autoPauseExecution(${out.autoPause}) 사고 (skip):`, apErr?.message);
    }
  }
  res.paused += 1;
  res.progressed = true;
}

/**
 * ⑤ 적재 단위 계약(설계서 3-8 I1 ~ I7) — 단위 = INSERT 한 문장(최대 QUEUE_UNIT_MAX) · 차례로 하나씩.
 *   단위마다 [창 다시(I7) → 표식 INSERT … SELECT(여정 · 실행 active 만) → 차감 n → 연결 번호 기록 → 같은 연결로 적재 → 결과 셋].
 *   돌려주는 값 = 멈춘 자리(그 단위 첫 고객의 묶음 차례 · 그 자리부터 뒤 고객은 이번 회차 결말 0) · null = 모든 단위를 끝까지 처리.
 */
async function sendUnits(
  head: ExecutionRow, step: StepRow, rows: Array<SendRow & { idx: number }>,
  c: { isKakao: boolean; msgType: string; isAd: boolean; sendCost: number; kakaoTemplateRow: any; tables: string[]; variantByExec: Map<string, string | null>; snapshotId: string | null; adGateBatch?: string | null; adKeep?: Set<string>;
       kakaoPay?: { fallback: 'SMS' | 'LMS' | null; expectShape: string } | null; ledgerShape?: string },
  res: BatchResult,
): Promise<number | null> {
  const prepaidMsgType = c.msgType === 'KAKAO' ? 'KAKAO' : c.msgType;
  const pick = await pickStepCampaignForUnits({
    companyId: head.company_id, journeyId: head.journey_id, stepId: step.id, stepOrder: step.step_order, msgType: c.msgType,
    representativeMessage: rows[0].message, subject: rows[0].subject || null, isAd: c.isAd, createdBy: head.created_by,
    sendChannel: c.isKakao ? 'alimtalk' : 'sms', callbackNumber: rows[0].callback,
    kakaoTemplateId: c.isKakao && c.kakaoTemplateRow ? c.kakaoTemplateRow.id : null,
    mmsImagePaths: (c.msgType === 'MMS' && step.mms_image_paths && step.mms_image_paths.length > 0) ? JSON.stringify(step.mms_image_paths) : null,
    ledgerShape: c.ledgerShape,   // ★ C129(D10) 선불 알림톡 칸 = 차감 꼴이 다르면 새 순번 캠페인
  });
  if ('blocked' in pick) {
    // I6 — 이어 붙임이 아직 닫혀 있다(DDL-2 전) = 그 (여정 · 칸)은 오늘 새 단위 0 → 다음날 발송 창 시작
    await setNextRunAt(rows.map((r) => r.exec.execution_id), nextDaySendWindowStart());
    res.waited += rows.length;
    return rows[0].idx;
  }
  const campaignId = pick.campaignId;
  // 그 캠페인에 미확정 단위(단위 기록 · 'sending' 표식)가 남아 있으면 판정부터(I2 · 이 묶음 밖 실행의 표식일 수 있다)
  const pend = await query(
    `SELECT (COALESCE(send_config, '{}'::jsonb) ? 'loadUnit')
            OR EXISTS (SELECT 1 FROM journey_step_logs l WHERE l.campaign_id = $1::uuid AND l.status = 'sending') AS has
       FROM campaigns WHERE id = $1::uuid`,
    [campaignId],
  );
  if (pend.rows[0]?.has) {
    const owner = { company_id: head.company_id, created_by: head.created_by, customer_id: head.customer_id };
    const judged = await judgeLoadUnit(owner, campaignId, { beforeConfirm: (at) => chargeJourneyOperationCredit(head, at), withStats: true });
    if (judged.result === 'held') { res.waited += rows.length; return rows[0].idx; }
    if (judged.result === 'closed') { alertUnprovableUnit(head.company_id, campaignId, judged.claims.length); return rows[0].idx; }   // 봉인됨 = 다음 회차 이어 붙임
  }

  // AI 학습 적재 — (여정 · 칸 · 날)당 멱등 1건 · 본문 = 칸 원문(★ 1028 K10-1)
  const trainingText = c.isKakao && c.kakaoTemplateRow ? String(c.kakaoTemplateRow.content || '') : flattenLiquidToPlainText(step.message_template || '');
  if (trainingText.trim()) void logCampaignTraining({
    campaignId, companyId: head.company_id,
    messageType: (c.msgType === 'KAKAO' ? 'KAKAO' : String(c.msgType || 'LMS').toUpperCase()) as 'SMS' | 'LMS' | 'MMS' | 'KAKAO',
    isAd: c.isAd, finalMessage: trainingText, finalSource: 'selected_as_is', authorship: 'path_ai', sendAt: new Date(),
  });
  // ★ 2026-07-27 실적재 테이블 기록(합친다 · 실패해도 발송은 계속)
  try { await recordCampaignSentTables(campaignId, c.tables); }
  catch (cfgErr: any) { console.error(`[JourneyExecutor] sentTables 기록 실패 campaign=${campaignId}:`, cfgErr?.message || cfgErr); }

  for (let off = 0; off < rows.length; off += QUEUE_UNIT_MAX) {
    const unit = rows.slice(off, off + QUEUE_UNIT_MAX);
    const rest = rows.slice(off);
    // I7 — 단위마다 발송 창
    const win = sendWindowStateFor(new Date(), isNightExemptStep(step));
    if (!win.open) {
      await setNextRunAt(rest.map((r) => r.exec.execution_id), win.next);
      res.skipped += rest.length;
      return unit[0].idx;
    }
    // R30 · ★ 2026-11-02 3-18 — 칸 관문(보낼 수 있는 판인가 = 최신 판 = 본문을 읽은 판 · 검사 통과 · 보류 아님)은 아래 선점 문장 WHERE 한 곳(발송 사건에 묶는다 ·
    //   묶음 중간에 보류 · 고치기가 커밋되면 그 단위부터 선점 0 = 보내지 않음 · 옛 단위마다 보류만 보던 확인은 판정을 다른 시각에 읽어 틈이 있었다 · Codex 설계 2R #1)
    const textStep = ['sms', 'lms', 'mms'].includes(String(step.channel));
    // ★ D190 #1 단축 URL(문자 · 이 단위 줄만 · 묶음 한 문장 · 변환 실패 = 원문 그대로)
    if (!c.isKakao) {
      const shortened = await shortenUrlsInTexts(unit.map((r) => ({
        text: r.message,
        ctx: { companyId: head.company_id, journeyId: head.journey_id, stepId: step.id, variantId: r.variantId || undefined, customerId: r.customer.id },
      })));
      shortened.forEach((m, k) => { unit[k].message = m; });
    }
    // 적재 시도 상한(그 실행 · 이 칸의 적재 실패 기록 >= LOAD_ATTEMPT_MAX) = 새 표식 앞 한 곳(가드 · 다른 묶음 · 고아 정리 어디서 표식이 지워졌든 · ★ Codex 구현 3R)
    //   닿은 실행 = 다시 보내지 않고 여정 멈춤 → 실패 기록 + 전진(비용 0) → 그 실행 멈춤 · 멈춤 결말 = 이 묶음 여기까지
    //   ★ 2026-11-11 C129(D2) — 여정 멈춤이 먼저 성공해야 전진한다(옛: 전진 → 실행 멈춤 → 여정 멈춤 = 여정 멈춤이 실패하면 실행 하나만 멈춘 채 여정은 켜져 있었다).
    //     던지면 전진 0 = 시도 기록이 그대로 → 다음 회차가 다시 이 갈래로 와 멈춤을 다시 시도한다(다시 보내기 = 아래 표식 문장의 상한 조건이 막는다).
    const spentRes = await query(
      `SELECT e.id FROM journey_executions e WHERE e.id = ANY($1::uuid[]) AND ${loadAttemptsSql('e', '$2')} >= ${LOAD_ATTEMPT_MAX}`,
      [unit.map((r) => r.exec.execution_id), step.id],
    );
    if (spentRes.rows.length > 0) {
      const spent = new Set(spentRes.rows.map((x: any) => String(x.id)));
      const gave = unit.filter((r) => spent.has(r.exec.execution_id)).map((r) => r.exec);
      console.error(`[JourneyExecutor] journey=${head.journey_id} step=${step.step_order} 적재 시도 상한(${LOAD_ATTEMPT_MAX}) 닿음 ${gave.length}명 — 다시 보내지 않고 실패로 넘김 · 여정 멈춤`);
      try {
        await pauseJourney(head.journey_id, '통신사 일시 발송 실패 (자동 재시도 1회 후에도 fail)');
      } catch (pauseErr: any) {
        console.error(`[JourneyExecutor] 적재 시도 상한 — 여정 멈춤 실패(전진하지 않고 다음 회차에 다시):`, pauseErr?.message);
        return unit[0].idx;
      }
      await logStepMany(gave.map((e) => e.execution_id), step.id, 'failed', 'queue_insert_failed');
      await advanceExecutions(head, step, gave.map((exec) => ({ exec, addedCost: 0 })));
      try {
        // 여정이 멈춘 상태일 때만 · 전진으로 끝난(마지막 칸) 실행은 완료 그대로(D1)
        await autoPauseExecution({ companyId: head.company_id, journeyId: head.journey_id, stepId: step.id, executionId: gave[0].execution_id, pauseReason: 'carrier_temp_fail', pauseTriggerSource: 'auto_retry_exhausted' });
      } catch (retryErr: any) {
        console.warn(`[JourneyExecutor] 적재 시도 상한 실행 멈춤 사고 (skip · 여정은 이미 멈췄다):`, retryErr?.message);
      }
      res.failed += gave.length;
      res.progressed = true;
      return unit[0].idx;
    }
    // 표식 + 시도 기록 = 한 문장(여정 · 실행 active 만 = 차감 직전 상태 재확인 · ★ D218+ 시점 2 · 시도 상한 = 위 확인과 이 문장 사이 경합에도 넘지 않는다).
    //   ★ Codex 구현 4R — 시도는 표식과 함께 미리 남긴다(사후 실패 기록은 그 쓰기가 실패하면 빈다 · 표식이 지워져도 시도는 남는다) · 같이 커밋되거나 같이 안 된다.
    const claimRes = await query(
      `WITH att AS (
         UPDATE journey_executions e
            SET error_log = COALESCE(e.error_log, '[]'::jsonb)
                            || jsonb_build_array(jsonb_build_object('reason', 'load_attempt', 'step_id', $2::text, 'campaign_id', $3::text, 'at', NOW()))
           FROM journeys j
          WHERE e.id = ANY($1::uuid[]) AND j.id = e.journey_id AND e.status = 'active' AND j.status = 'active'
            AND ${loadAttemptsSql('e', '$2')} < ${LOAD_ATTEMPT_MAX}${textStep ? `
            AND ${stepSendableSql('j.id', '$2::uuid', '$5::uuid')}` : ''}
         RETURNING e.id
       )
       INSERT INTO journey_step_logs (id, execution_id, step_id, campaign_id, sent_at, status, cost)
       SELECT gen_random_uuid(), att.id, $2::uuid, $3::uuid, NOW(), 'sending', $4 FROM att
       RETURNING id, execution_id, sent_at`,
      textStep ? [unit.map((r) => r.exec.execution_id), step.id, campaignId, c.sendCost, c.snapshotId] : [unit.map((r) => r.exec.execution_id), step.id, campaignId, c.sendCost],
    );
    const claimByExec = new Map<string, { id: string; sentAt: Date }>(claimRes.rows.map((x: any) => [String(x.execution_id), { id: String(x.id), sentAt: new Date(x.sent_at) }]));
    const claimed = unit.filter((r) => claimByExec.has(r.exec.execution_id));
    res.paused += unit.length - claimed.length;   // 옛 'paused_external'
    if (claimed.length === 0) return unit[0].idx;
    const claimIds = claimed.map((r) => claimByExec.get(r.exec.execution_id)!.id);
    const claimAt = claimByExec.get(claimed[0].exec.execution_id)!.sentAt;

    // 선불 차감 = 표식 수 한 번(참조 = 단계 캠페인 · 차감 → 적재 · ★ 0926 F05 · F06 · F11)
    // ★ 2026-11-11 C129(D10) — 알림톡 칸 = 원장 열쇠(차감 꼴 · 이 캠페인의 발송 날)를 넘긴다 → 차감이 잠근 회사 행으로 확인하고 대체까지 덮는 단가로 차감한다.
    const deduct = await prepaidDeduct(head.company_id, claimed.length, prepaidMsgType as any, campaignId, head.created_by || undefined, 'journey', null,
      c.kakaoPay ? { kakaoCharge: { ...c.kakaoPay, sendDay: pick.sendDate } } : undefined);
    if (!deduct.ok && deduct.chargeChanged) {
      // 과금 방식 · 단가 · 발송 날이 준비 때와 달라졌다 = 아무것도 싣지 않았다 → 표식 · 방금 시도 기록을 지우고 **멈추지 않고** 이 묶음을 여기서 끝낸다
      //   (다음 회차가 회사 행을 새로 읽어 꼴을 다시 내고 그 꼴의 단계 캠페인을 고른다)
      await query(CLEAR_UNPAID_CLAIMS_SQL, [claimIds, step.id, campaignId]);
      console.warn(`[JourneyExecutor] journey=${head.journey_id} step=${step.step_order} 차감 꼴이 준비 때와 다름 — 차감 · 발송 0 · 다음 회차에 새 단계 캠페인으로`);
      res.waited += claimed.length;
      return unit[0].idx;
    }
    if (!deduct.ok) {
      // ★ 2026-11-11 C129(D3 · R8) — 차감 실패 = 아무것도 싣지 않았다 → 표식을 지우면서 방금 남긴 시도 기록도 같이 지운다(한 문장 ·
      //   옛: 시도 기록이 남아 차감 실패 두 번이면 한 번도 싣지 않고 「상한 닿음 · 실패로 넘김」)
      await query(CLEAR_UNPAID_CLAIMS_SQL, [claimIds, step.id, campaignId]);
      console.warn(`[JourneyExecutor] journey=${head.journey_id} 차감 실패(잔액 동시 소진) — 발송하지 않고 여정 정지`);
      await pauseJourney(head.journey_id, deduct.error || '잔액 부족');
      await logStepMany([claimed[0].exec.execution_id], step.id, 'failed', 'insufficient_balance');
      try {
        await autoPauseExecution({ companyId: head.company_id, journeyId: head.journey_id, stepId: step.id, executionId: claimed[0].exec.execution_id, pauseReason: 'balance_insufficient', pauseTriggerSource: 'auto_balance_check' });
      } catch (apErr: any) {
        console.warn(`[JourneyExecutor] autoPauseExecution(balance_insufficient) 사고 (skip):`, apErr?.message);
      }
      res.paused += 1;
      return unit[0].idx;
    }

    let alimDowngraded = 0;   // ★ C129 D5 — 대체 문안이 빈 글이 된 고객 수(그 고객만 대체 없음 · 번호 원문은 로그에 쌓지 않는다)
    const outcome = c.isKakao && c.kakaoTemplateRow
      ? await loadQueueUnit({
          kind: 'alimtalk', tables: c.tables, appEtc1: campaignId,
          alimRows: claimed.map((r) => {
            const eventProps = (r.exec.entry_event_properties && typeof r.exec.entry_event_properties === 'object') ? r.exec.entry_event_properties : {};
            const customerWithEvent = { ...eventProps, ...(r.customer as Record<string, any>) };
            // ★ 2026-07-27 전환재발송 규칙 CT(alimtalk-fallback) · 대체 문구도 본문과 같은 변수 치환
            // ★ 2026-11-11 C129(D5 · R1) — 행 단위 정책 = 직접발송 두 길과 같다: 이 고객의 변수가 전부 빈 값이라 대체 문안이 빈 글이 되면
            //   그 고객만 대체 없음으로 내리고 알림톡은 그대로 보낸다(옛: 기본 정책 throw = 표식 · 차감 뒤 예외로 그 단위 전체가 미확정으로 남았다).
            const alimFallback = resolveAlimtalkFallback({
              nextType: step.alimtalk_next_type,
              nextContents: step.alimtalk_next_contents
                ? fillAlimtalkVarMap(step.alimtalk_next_contents, step.alimtalk_variable_map || {}, customerWithEvent, undefined, buildDefaultFallbacks(step.alimtalk_variable_map || {}))
                : step.alimtalk_next_contents,
              nextSubject: r.subject,
            }, { emptyContentsPolicy: 'disableFallback' });
            if (alimFallback.downgradedToNone) alimDowngraded++;
            return {
              phone: r.phone, callback: r.callback, message: r.message, titleStr: alimFallback.titleStr,
              templateCode: step.alimtalk_template_code || '', nextType: alimFallback.nextType, nextContents: alimFallback.nextContents,
              buttonJson: convertButtonsToQTmsg(c.kakaoTemplateRow.buttons || []) || undefined,
              etcJson: buildAlimtalkEtcJson({
                emphasizeTitle: c.kakaoTemplateRow.emphasize_title, representLink: c.kakaoTemplateRow.represent_link,
                substitute: (raw) => fillAlimtalkVarMap(raw, step.alimtalk_variable_map || {}, customerWithEvent, undefined, buildDefaultFallbacks(step.alimtalk_variable_map || {})),
              }),
              companyId: head.company_id,
            };
          }),
          record: (h) => recordLoadUnit(campaignId, h),
        })
      : await loadQueueUnit({
          kind: 'sms', tables: c.tables, useNow: true, ctx: { companyId: head.company_id, source: 'journey' },
          // ★ 2026-09-27 m093 — 유형 칸 = QTmsg 코드(S · L · M) · 단문 제목 비움 · MMS 첨부 = 절대경로 그대로
          smsRows: claimed.map((r) => [
            r.phone, r.callback, r.message, toQtmsgType(c.msgType), subjectForMsgType(c.msgType, r.subject), new Date(),
            campaignId, head.company_id,
            ...(c.msgType === 'MMS' ? [0, 1, 2].map((i) => normalizeMmsImagePaths(step.mms_image_paths)[i] || '') : ['', '', '']),
          ]),
          record: (h) => recordLoadUnit(campaignId, h),
        });

    if (alimDowngraded > 0) console.warn(`[JourneyExecutor] journey=${head.journey_id} step=${step.step_order} 알림톡 대체 문안이 빈 글이 된 ${alimDowngraded}명 = 대체 없음으로 발송`);
    if (outcome.state === 'loaded') {
      if (c.adKeep) for (const r of claimed) c.adKeep.add(normalizePhone(String(r.phone || '')));   // ★ C113 D10 — 실린 번호 = 끝 해제에서 남김
      // ★ 2026-11-06 C110 — 이 단위가 큐에 실렸다 = 그 번호들의 우선순위 예약 확정(캠페인 연결 · 실패해도 발송은 이미 나감 = 경고만 · 예약은 2시간 산다)
      if (c.adGateBatch) {
        await linkAdMarksSafe(head.company_id, c.adGateBatch, campaignId, claimed.map((r) => String(r.phone || '')));   // ★ 1107 — 실패 = 장애 줄 · 발송은 이미 나감
      }
      let confirmed: Array<{ id: string; executionId: string; cost: number }>;
      try {
        // ★ 0929 차수 5 — 운영 크레딧은 확정 **전에**(멱등 · 날짜 = 표식 시각)
        await chargeJourneyOperationCredit(head, claimAt);
        const counts = new Map<string, number>();
        for (const r of claimed) { const v = c.variantByExec.get(r.exec.execution_id); if (v) counts.set(v, (counts.get(v) || 0) + 1); }
        // 실행 · 여정 비용 통계도 확정과 같은 문장(확정 뒤 끊겨도 비용이 빠지지 않는다 · 전진은 비용 0 · Codex 구현 1R)
        confirmed = await confirmLoadUnit(campaignId, claimIds, { variantCounts: [...counts].map(([variantId, sent]) => ({ variantId, sent })), withStats: true });
        outcome.finish(true);
      } catch (e: any) {
        // I4 — PG 확정 실패 = 연결 파기 · 표식 · 단위 기록은 남는다 → 다음 회차 단위 판정이 종료 증명 뒤 장부로 확정(다시 보내지 않음 · ★ 0926 2R ⑤ 삼키지 않음 = 확정은 판정이 한다)
        outcome.finish(false);
        console.error(`[JourneyExecutor] journey=${head.journey_id} 적재 단위 들어감 · 확정 실패 campaign=${campaignId} — 다음 회차 단위 판정:`, e?.message || e);
        res.failed += claimed.length;
        return unit[0].idx;
      }
      if (confirmed.length !== claimed.length) console.error(`[JourneyExecutor][CRITICAL] 단위 확정 ${confirmed.length}/${claimed.length} campaign=${campaignId} — 표식이 sending 이 아니었다`);
      // ★ 2026-07-05 발송 피로도 카운터 — 광고성만 · 큐 커밋 후
      if (c.isAd) void recordFatigueSends(head.company_id, claimed.map((r) => String(r.customer.phone || '')));
      const confirmedSet = new Set(confirmed.map((x) => x.executionId));
      const done = claimed.filter((r) => confirmedSet.has(r.exec.execution_id));
      // ★ D218+ 시점 3 — 발송 직후 멈춤 감지(정지 효과 X · 추적 기록만)
      try {
        const st3 = await query(`SELECT id FROM journey_executions WHERE id = ANY($1::uuid[]) AND status = 'paused'`, [done.map((r) => r.exec.execution_id)]);
        if (st3.rows.length > 0) {
          console.warn(`[JourneyExecutor] journey=${head.journey_id} 발송 직후 paused ${st3.rows.length}명 감지 — 큐 적재 끝 = 발송 진행(정지 효과 X / 추적)`);
          await query(
            `INSERT INTO journey_step_pause_logs (company_id, journey_id, step_id, execution_id, pause_reason, pause_trigger_source, target_count_snapshot, execution_status_at_pause)
             SELECT $1, $2, $3, x, 'race_after_send', 'auto_status_check_3', 1, 'sent_after_pause' FROM unnest($4::uuid[]) AS x`,
            [head.company_id, head.journey_id, step.id, st3.rows.map((x: any) => x.id)],
          );
        }
      } catch (s3Err: any) {
        console.warn(`[JourneyExecutor] 시점 3 status 재확인 사고 (skip):`, s3Err?.message);
      }
      await advanceExecutions(head, step, done.map((r) => ({ exec: r.exec, addedCost: 0 })));   // 비용 = 확정 문장이 더했다(withStats)
      res.sent += done.length;
      res.progressed = true;
      continue;
    }
    if (outcome.state === 'rejected') {
      // 문장을 보내기 전 실패 = 안 들어감 확정 → 표식 지움 · 지금 재시도 규칙(첫 실패 = 5분 뒤 · 이미 한 번 실패 = 여정 멈춤)
      await clearLoadUnit(campaignId, claimIds);
      console.error(`[JourneyExecutor] journey=${head.journey_id} 적재 단위 안 들어감(${outcome.reason}) — ${claimed.length}명 재시도 판정`);
      await retryOrPauseAfterLoadFailure(head, step, claimed.map((r) => r.exec), outcome.reason, res);
      return unit[0].idx;
    }
    // unknown = 표식 보존 · 이 묶음 멈춤(뒤 단위 0) · 다음 회차 단위 판정(I2 · I4) · 시도 횟수는 지금 남긴다(R8 · 판정이 미적재를 증명해 다시 보내도 상한 안)
    if (c.adKeep) for (const r of claimed) c.adKeep.add(normalizePhone(String(r.phone || '')));   // ★ C113 D10 — 결과 불명 = 끝 해제에서 남김
    console.error(`[JourneyExecutor] journey=${head.journey_id} 적재 단위 결과 불명(${outcome.reason}) — ${claimed.length}명 표식 보존 · 다음 회차 판정`);
    await holdUnknownLoad(head, step, claimed.map((r) => r.exec), outcome.reason, res);
    return unit[0].idx;
  }
  return null;
}

/**
 * 안 들어감 확정 단위의 실행 = 재시도 규칙(첫 실패 = 5분 뒤 재시도 · 그 칸의 시도 기록이 상한에 닿았으면 소진 = 여정 멈춤 → 실패 기록 → 전진 → 그 실행 멈춤 · 차례대로 경계)
 * ★ 2026-11-11 C129(D2 · Codex 설계 2R) — 소진 판정 = **그 칸의 시도 기록 수 한 기준**(loadAttemptsSql · 표식 문장 · 상한 확인 · 결과 불명과 같은 조각).
 *   옛: 실행 전체의 error_count >= 1(전진해도 안 지워진다) → 앞 칸에서 한 번 실패했던 실행은 뒤 칸 첫 실패에 바로 소진됐고, 그때 여정 멈춤이 실패하면
 *   적재 관문(칸별 시도 < 상한)은 열려 있어 멈춤 재시도 앞에 다시 실렸다. 이제 소진(시도 2) 뒤에는 표식 앞 상한 확인이 먼저 잡는다.
 *   error_count · last_error_at 은 진단 칸으로 계속 쌓는다.
 *   순서 = 여정 멈춤이 먼저(던지면 전진 0) · 전진은 진행 중 상태에서(마지막 칸 = 완료 · 옛: 멈춤 → 전진 = 완료되지 않고 멈춘 채 되풀이).
 */
async function retryOrPauseAfterLoadFailure(head: ExecutionRow, step: StepRow, execs: ExecutionRow[], errMsg: string, res: BatchResult): Promise<void> {
  const tried = await query(
    `SELECT e.id, ${loadAttemptsSql('e', '$2')}::int AS n FROM journey_executions e WHERE e.id = ANY($1::uuid[])`,
    [execs.map((e) => e.execution_id), step.id],
  );
  const triedById = new Map<string, number>(tried.rows.map((x: any) => [String(x.id), Number(x.n) || 0]));
  const spent = (e: ExecutionRow): boolean => (triedById.get(e.execution_id) || 0) >= LOAD_ATTEMPT_MAX;
  const firstExhausted = execs.findIndex(spent);
  const retry = firstExhausted < 0 ? execs : execs.slice(0, firstExhausted);
  if (retry.length > 0) {
    const ids = retry.map((e) => e.execution_id);
    await query(
      `UPDATE journey_executions e SET
         next_run_at = NOW() + INTERVAL '5 minutes',
         error_count = COALESCE(error_count, 0) + 1,
         last_error_at = NOW(),
         error_log = COALESCE(e.error_log, '[]'::jsonb) || $2::jsonb
       WHERE e.id = ANY($1::uuid[]) AND ${loadAttemptsSql('e', '$3')} < ${LOAD_ATTEMPT_MAX}`,
      [ids, JSON.stringify([{ at: new Date().toISOString(), reason: 'queue_insert_failed', step_id: step.id, error: errMsg.slice(0, 300) }]), step.id]
    );
    await logStepMany(ids, step.id, 'failed', 'queue_insert_failed_retry_scheduled');
    res.failed += ids.length;
    res.progressed = true;
  }
  if (firstExhausted >= 0) {
    const e = execs[firstExhausted];
    try {
      await pauseJourney(head.journey_id, '통신사 일시 발송 실패 (자동 재시도 1회 후에도 fail)');
    } catch (pauseErr: any) {
      console.error(`[JourneyExecutor] 재시도 소진 — 여정 멈춤 실패(전진하지 않고 다음 회차에 다시):`, pauseErr?.message);
      return;
    }
    await logStepMany([e.execution_id], step.id, 'failed', 'queue_insert_failed');
    await advanceExecutions(head, step, [{ exec: e, addedCost: 0 }]);   // ★ J1: 발송 실패 → 비용 0
    try {
      await autoPauseExecution({ companyId: head.company_id, journeyId: head.journey_id, stepId: step.id, executionId: e.execution_id, pauseReason: 'carrier_temp_fail', pauseTriggerSource: 'auto_retry_exhausted' });
    } catch (retryErr: any) {
      console.warn(`[JourneyExecutor] 재시도 소진 실행 멈춤 사고 (skip · 여정은 이미 멈췄다):`, retryErr?.message);
    }
    res.failed += 1;
    res.progressed = true;
  }
}

/**
 * ★ 2026-11-02 적재 시도 상한(처음 + 다시 한 번 = 옛 한 건 판 「자동 재시도 1회」 · Codex 구현 1R ① · 2R · 3R · 4R 같은 뿌리의 구조 처방).
 *   근거 = 그 실행 · 그 칸의 **시도 기록** 수(loadAttemptsSql) = 표식 INSERT 와 같은 문장에서 미리 남긴다(사후 실패 기록 · 표식 삭제 · 멈춤 실패와 무관).
 *   판정 자리 = 새 표식을 만드는 sendUnits 한 곳(확인 + 표식 문장 조건 · 모든 발송이 지난다). 다음 칸으로 넘어가면 그 실행의 시도 기록은 지운다(칸은 되돌아오지 않는다 · 쌓임 0).
 */
export const LOAD_ATTEMPT_MAX = 2;

/** 그 실행(별칭 e) · 그 칸($n)의 적재 시도 기록 수 = 실행 error_log 의 load_attempt 항목 — 적재 시도 상한의 판정 조각 한 곳 */
export function loadAttemptsSql(e: string, stepParam: string): string {
  return `(SELECT COUNT(*) FROM jsonb_array_elements(COALESCE(${e}.error_log, '[]'::jsonb)) fl
            WHERE fl->>'reason' = 'load_attempt' AND fl->>'step_id' = ${stepParam}::text)`;
}

/**
 * ★ 2026-11-11 C129(D3 · R8) — 그 실행(별칭 e)의 error_log 에서 그 칸 · 그 캠페인의 적재 시도 기록 가운데 **맨 뒤 하나**를 뺀 배열(식).
 *   시각으로 고르지 않는다(시도 기록의 시각 = 마이크로초 · 노드가 읽은 표식 시각 = 밀리초). 맨 뒤 = 방금 표식 문장이 남긴 것
 *   (실행기는 (여정 · 칸) 묶음을 한 번에 하나만 처리하고 시도 기록을 쓰는 자리는 표식 문장 하나다).
 */
export function dropLastLoadAttemptSql(e: string, stepParam: string, campaignParam: string): string {
  return `(SELECT COALESCE(jsonb_agg(el.v ORDER BY el.n), '[]'::jsonb)
             FROM jsonb_array_elements(COALESCE(${e}.error_log, '[]'::jsonb)) WITH ORDINALITY AS el(v, n)
            WHERE el.n IS DISTINCT FROM (
                    SELECT MAX(el2.n) FROM jsonb_array_elements(COALESCE(${e}.error_log, '[]'::jsonb)) WITH ORDINALITY AS el2(v, n)
                     WHERE el2.v->>'reason' = 'load_attempt' AND el2.v->>'step_id' = ${stepParam}::text AND el2.v->>'campaign_id' = ${campaignParam}::text))`;
}

/** 차감 실패 갈래 — 아직 sending 인 표식을 지우고, 표식이 지워진 실행의 방금 시도 기록 하나를 같이 지운다. $1 = 표식 id 들 · $2 = 칸 · $3 = 캠페인 */
export const CLEAR_UNPAID_CLAIMS_SQL =
  `WITH del AS (
     DELETE FROM journey_step_logs WHERE id = ANY($1::uuid[]) AND status = 'sending' RETURNING execution_id
   )
   UPDATE journey_executions e
      SET error_log = ${dropLastLoadAttemptSql('e', '$2', '$3')}
    WHERE e.id IN (SELECT execution_id FROM del)`;

/** ★ 2026-11-11 C129(D4 · R18) — 월 예산 누적 = **KST 이번 달** 발송 로그 비용 합(옛: UTC 달 시작 → 매월 1일 아침 9시 전 발송분이 전달로 잡혔다). $1 = 여정 */
/**
 * ★ 2026-11-11 C129(D10) — 두 원천의 합:
 *   (가) 원장 꼴이 없는 단계 캠페인(문자 칸 · 후불 · 옛 캠페인) = 칸 기록 비용(종전 식 그대로)
 *   (나) 원장 꼴이 있는 단계 캠페인(선불 알림톡 칸) = 잔액 원장의 순지출(차감 − 환불 + 회수) · 달 = 캠페인 발송 날(그 캠페인의 모든 차감 날 · prepaidDeduct sendDay 확인)
 *        결과 전에는 선차감(대체까지 덮는 단가) = 위쪽 한도 · 결과 뒤에는 실제 값으로 줄어든다. 후불 · 문자만 있는 여정 = (나) 0 = 종전 값.
 */
export const JOURNEY_MONTH_COST_SQL =
  `SELECT COALESCE(SUM(l.cost), 0)
          + (SELECT COALESCE(SUM(CASE WHEN t.type = 'deduct' THEN t.amount
                                      WHEN t.type = 'refund' THEN -t.amount
                                      WHEN t.type = 'admin_deduct' AND t.description LIKE '%환불 reverse%' THEN -t.amount
                                      ELSE 0 END), 0)
               FROM journey_step_campaigns jsc
               JOIN campaigns sc ON sc.id = jsc.campaign_id AND (sc.send_config ? 'ledgerShape')
               JOIN balance_transactions t ON t.company_id = sc.company_id AND t.reference_type = 'journey' AND t.reference_id = sc.id
              WHERE jsc.journey_id = $1::uuid
                AND jsc.send_date::date >= (${KST_MONTH_START_SQL} AT TIME ZONE 'Asia/Seoul')::date) AS month_cost
     FROM journey_step_logs l
     JOIN journey_executions e ON e.id = l.execution_id
    WHERE e.journey_id = $1::uuid AND l.status = 'sent'
      AND l.sent_at >= ${KST_MONTH_START_SQL}
      AND NOT EXISTS (SELECT 1 FROM campaigns lc WHERE lc.id = l.campaign_id AND (lc.send_config ? 'ledgerShape'))`;

/**
 * 결과 불명 단위의 실행 = 표식은 그대로(다음 회차 단위 판정) · 5분 뒤 다시 본다(그 사이 원 INSERT 가 끝난다 · 판정이 미적재를 증명하면 상한 안에서 한 번 더) · 진단 기록 한 줄.
 *   시도가 상한에 닿았으면 그 실행 자동 멈춤 + 여정 멈춤(전진 0 · 표식은 판정이 닫는다) — 덤이다. 이 함수의 쓰기가 실패해도 다시 보내기는 새 표식 앞 상한(미리 남긴 시도 기록)이 막는다(★ Codex 구현 4R).
 */
async function holdUnknownLoad(head: ExecutionRow, step: StepRow, execs: ExecutionRow[], errMsg: string, res: BatchResult): Promise<void> {
  const ids = execs.map((e) => e.execution_id);
  await query(
    `UPDATE journey_executions SET
       next_run_at = NOW() + INTERVAL '5 minutes',
       last_error_at = NOW(),
       error_log = COALESCE(error_log, '[]'::jsonb) || $2::jsonb
     WHERE id = ANY($1::uuid[])`,
    [ids, JSON.stringify([{ at: new Date().toISOString(), reason: 'queue_insert_unknown', step_id: step.id, error: errMsg.slice(0, 300) }])],
  );
  const sp = await query(
    `SELECT e.id FROM journey_executions e WHERE e.id = ANY($1::uuid[]) AND ${loadAttemptsSql('e', '$2')} >= ${LOAD_ATTEMPT_MAX}`,
    [ids, step.id],
  );
  const exhausted = new Set(sp.rows.map((x: any) => String(x.id)));
  const first = execs.find((e) => exhausted.has(e.execution_id));
  if (first) {
    try {
      // ★ C129 D2 — 여정 멈춤이 먼저(던지면 실행 멈춤에 닿지 않는다 · 시도 기록이 상한이라 다음 회차는 표식 앞 확인이 잡는다)
      await pauseJourney(head.journey_id, '통신사 일시 발송 실패 (자동 재시도 1회 후에도 fail)');
      await autoPauseExecution({ companyId: head.company_id, journeyId: head.journey_id, stepId: step.id, executionId: first.execution_id, pauseReason: 'carrier_temp_fail', pauseTriggerSource: 'auto_retry_exhausted' });
    } catch (retryErr: any) {
      console.warn(`[JourneyExecutor] 결과 불명 재시도 분기 사고 (skip):`, retryErr?.message);
    }
  }
  res.failed += execs.length;
  res.progressed = true;
}

/** ★ 2026-11-02 증명 못 해 닫은 적재 단위 경보(★ 0926 Harold 결정 · 다시 보내지 않음 · 그 몫 요금 = 정산이 미적재로 돌려준다) */
function alertUnprovableUnit(companyId: string, campaignId: string, n: number): void {
  console.error(`[JourneyExecutor][적재미증명종료] campaign=${campaignId} 표식 ${n} — 다시 보내지 않고 닫음 · 캠페인 봉인`);
  void sendSystemAlert({
    companyId,
    dedupKey: `journey-unit-unprovable:${campaignId}`,
    message: `여정 발송 ${n}건(한 적재 단위)의 적재 여부를 1시간 동안 증명하지 못해 다시 보내지 않고 닫았습니다. campaign=${campaignId} (그 몫 요금은 정산이 환불 · 그날 다음 발송은 새 캠페인)`,
  }).catch(() => undefined);
}

// ════════════════════════════════════════════════════════════════════
// 대기 · 조건 칸(묶음 · 설계서 3-4)
// ════════════════════════════════════════════════════════════════════

async function processWaitBatch(execs: ExecutionRow[], step: StepRow, res: BatchResult): Promise<BatchResult> {
  const head = execs[0];
  const ids = execs.map((e) => e.execution_id);
  // ★ 2026-07-11 wait-until-event — 칸마다 한 번 지연 조회(42703 = 기존 시간 대기 그대로)
  let waitEventName: string | null = null;
  let waitTimeoutHours = 72;
  try {
    const w = await query(`SELECT wait_event_name, wait_timeout_hours FROM journey_steps WHERE id = $1::uuid`, [step.id]);
    const wn = w.rows[0]?.wait_event_name;
    if (wn != null && String(wn).trim()) waitEventName = String(wn).trim();
    const wt = Number(w.rows[0]?.wait_timeout_hours);
    if (Number.isFinite(wt) && wt > 0) waitTimeoutHours = Math.min(24 * 30, Math.floor(wt));
  } catch {
    /* wait 컬럼 미마이그레이션 → 기존 시간 대기 */
  }
  res.waited += execs.length;
  res.progressed = true;
  if (!waitEventName) {
    await logStepMany(ids, step.id, 'skipped', 'wait_step_passed');
    await advanceExecutions(head, step, execs.map((exec) => ({ exec, addedCost: 0 })));
    return res;
  }
  // 대기 앵커 = 이 칸에 처음 닿은 시각(waiting_event 로그) — 없으면 지금 표시
  const anc = await query(
    `SELECT execution_id, MIN(sent_at) AS at FROM journey_step_logs
      WHERE execution_id = ANY($1::uuid[]) AND step_id = $2::uuid AND error_reason = 'waiting_event'
      GROUP BY execution_id`,
    [ids, step.id],
  );
  const anchorAt = new Map<string, Date>(anc.rows.map((x: any) => [String(x.execution_id), new Date(x.at)]));
  const fresh = ids.filter((id) => !anchorAt.has(id));
  if (fresh.length > 0) {
    await logStepMany(fresh, step.id, 'skipped', 'waiting_event');
    const now = new Date();
    for (const id of fresh) anchorAt.set(id, now);
  }
  // 사건 발생(cdp_events · 회사 격리 · 고객마다 그 앵커 뒤)
  // ★ 2026-11-04 C99 T5 — 사건이 구매면 두 문(CT-D4 · 몰 결제 = 앵커 뒤 · 매장 원장 = 앵커 날 다음 날부터) · 그 밖 사건 = 지금 그대로
  const anchors = ids.map((id) => anchorAt.get(id)!.toISOString());
  const ev = waitEventName === 'purchase'
    ? await query(
      `SELECT e.id FROM journey_executions e
         JOIN unnest($1::uuid[], $2::timestamptz[]) AS a(id, at) ON a.id = e.id
        WHERE ${purchaseAfterSql('e.customer_id', '$3::uuid', 'a.at')}`,
      [ids, anchors, head.company_id],
    )
    : await query(
      `SELECT e.id FROM journey_executions e
         JOIN unnest($1::uuid[], $2::timestamptz[]) AS a(id, at) ON a.id = e.id
        WHERE EXISTS (SELECT 1 FROM cdp_events c
                       WHERE c.company_id = $3::uuid AND c.customer_id = e.customer_id
                         AND ${cdpEventNameMatchSql('c', '$4')} AND c.occurred_at >= a.at)`,   // ★ 2026-11-02 기다리기 사건이 구매면 결제된 구매(3-4 ④)
      [ids, anchors, head.company_id, waitEventName],
    );
  const arrived = new Set(ev.rows.map((x: any) => String(x.id)));
  const nowMs = Date.now();
  const timedOut = ids.filter((id) => !arrived.has(id) && nowMs >= anchorAt.get(id)!.getTime() + waitTimeoutHours * 3600 * 1000);
  const waiting = ids.filter((id) => !arrived.has(id) && !timedOut.includes(id));
  const byId = new Map(execs.map((e) => [e.execution_id, e]));
  if (arrived.size > 0) {
    await logStepMany([...arrived], step.id, 'skipped', 'wait_event_arrived');
    await advanceExecutions(head, step, [...arrived].map((id) => ({ exec: byId.get(id)!, addedCost: 0 })));
  }
  if (timedOut.length > 0) {
    await logStepMany(timedOut, step.id, 'skipped', 'wait_event_timeout');
    await advanceExecutions(head, step, timedOut.map((id) => ({ exec: byId.get(id)!, addedCost: 0 })));
  }
  // 기한 내 미발생 — 같은 칸 유지 + 15분 후 재폴링
  if (waiting.length > 0) await delayExecutions(waiting, 15);
  return res;
}

async function processConditionBatch(execs: ExecutionRow[], step: StepRow, res: BatchResult): Promise<BatchResult> {
  const head = execs[0];
  // 조건이 어떤 필드든 평가할 수 있게 SELECT *(칸마다 한 번)
  const condCustRes = await query(`SELECT * FROM customers WHERE id = ANY($1::uuid[]) AND company_id = $2::uuid`, [execs.map((e) => e.customer_id), head.company_id]);
  const custById = new Map<string, any>(condCustRes.rows.map((c: any) => [String(c.id), c]));
  const present = execs.filter((e) => custById.has(e.customer_id));
  // ★ D210+ Phase 3 + Phase 7 — met(다음 칸) / not_met(종료 · 분기) / error(보류 · 재시도) · 확인 못 함 = 보내도 됨이 아니다
  const outcome = present.length > 0 ? await evaluateConditionBatch(step.condition_jsonb, present, custById, head.company_id) : new Map<string, ConditionOutcome>();
  // 멈춤 경계 = next_run_at 순으로 처음 「재시도 소진(여정 멈춤)」인 오류 실행 · 그 뒤 실행 = 아무것도 안 함(한 건 판 = 멈춘 뒤 진입 시점 정지)
  const errIds = present.filter((e) => outcome.get(e.execution_id) === 'error').map((e) => e.execution_id);
  let boundary = execs.length;
  if (errIds.length > 0) {
    const ec = await query(`SELECT id FROM journey_executions WHERE id = ANY($1::uuid[]) AND COALESCE(error_count, 0) >= 1`, [errIds]);
    const exhausted = new Set(ec.rows.map((x: any) => String(x.id)));
    const b = execs.findIndex((e) => exhausted.has(e.execution_id));
    if (b >= 0) boundary = b;
  }
  const before = execs.slice(0, boundary);
  const missing = before.filter((e) => !custById.has(e.customer_id));
  const met = before.filter((e) => outcome.get(e.execution_id) === 'met');
  const err = execs.slice(0, Math.min(boundary + 1, execs.length)).filter((e) => outcome.get(e.execution_id) === 'error');
  const notMet = before.filter((e) => outcome.get(e.execution_id) === 'not_met');
  if (missing.length > 0) {
    await logStepMany(missing.map((e) => e.execution_id), step.id, 'skipped', 'condition_customer_not_found');
    await advanceExecutions(head, step, missing.map((exec) => ({ exec, addedCost: 0 })));
    res.skipped += missing.length;
    res.progressed = true;
  }
  if (met.length > 0) {
    await logStepMany(met.map((e) => e.execution_id), step.id, 'skipped', 'condition_passed');
    await advanceExecutions(head, step, met.map((exec) => ({ exec, addedCost: 0 })));
    res.conditionPassed += met.length;
    res.progressed = true;
  }
  // 조건 DB 평가 실패 → 발송 보류 + 재시도(error_count < 1 = 5분 뒤 · 그 밖 = 그 실행 자동 멈춤 + 여정 멈춤 · 경계 실행이 마지막)
  for (const e of err) await handleConditionEvalError(e, step);
  if (err.length > 0) { res.failed += err.length; res.progressed = true; }
  if (notMet.length > 0) {
    // ★ 2026-07-11 진짜 분기: not_met_goto(지연 조회 · 42703 = null = 현행 종료)
    let notMetGoto: number | null = null;
    try {
      const g = await query(`SELECT not_met_goto FROM journey_steps WHERE id = $1::uuid`, [step.id]);
      const raw = g.rows[0]?.not_met_goto;
      if (raw != null && Number.isFinite(Number(raw))) notMetGoto = Number(raw);
    } catch {
      /* not_met_goto 컬럼 미마이그레이션 → 현행(종료) */
    }
    const ids = notMet.map((e) => e.execution_id);
    if (notMetGoto != null && notMetGoto > step.step_order) {
      const jumped = await jumpExecutions(ids, head.journey_id, notMetGoto);
      await logStepMany(ids, step.id, 'skipped', jumped ? 'condition_branched' : 'condition_branch_target_missing');
      // 분기 대상 칸 없음(삭제 등) — 미충족 발송 없이 완주 처리
      if (!jumped) await finishExecutions(ids.map((id) => ({ id, addedCost: 0 })), head.journey_id, { stepOrder: null });
      console.log(`[JourneyExecutor] journey=${head.journey_id} step=${step.step_order} condition 미충족 ${ids.length}명 → ${jumped ? `step ${notMetGoto} 분기` : '분기 대상 없음(완료)'}`);
    } else {
      // 분기 미설정 = execution 종료(조건 확정 미충족 — 현 동작 보존)
      await query(`UPDATE journey_executions SET status = 'ended', completed_at = NOW(), current_step_order = $2 WHERE id = ANY($1::uuid[])`, [ids, step.step_order]);
      await logStepMany(ids, step.id, 'skipped', 'condition_failed_ended');
      console.log(`[JourneyExecutor] journey=${head.journey_id} step=${step.step_order} condition 미충족 ${ids.length}명 → ended`);
    }
    res.conditionFailed += ids.length;
    res.progressed = true;
  }
  return res;
}

// ════════════════════════════════════════════════════════════════════
// execution advance / complete / pause / log
// ════════════════════════════════════════════════════════════════════

/**
 * 여정 AI 운영 크레딧 — 발송비(prepaidDeduct)와 별개. 멱등키 = 여정:KST날짜 → 같은 여정 그날 첫 발송 1건만 차감(하루 1회 상한 · 고객수만큼 안 불어남).
 * journey-operation = 운영 source(P4) → 잔액 0이어도 −1개월 grant 상한까지 음수 허용. deductCreditSafe는 throw 0 = 발송 절대 안 막음.
 * ★ 2026-09-26 한줄로 V2 m105(Codex 3R ⑤) — 정상 발송 · 가드 복구 · 재시도 소진 복구 세 경로가 이 함수 하나로 받는다.
 *   날짜는 **원 발송일**(복구는 표식 시각) — 복구가 다음 날 돌아도 그 발송이 속한 날의 키로 한 번만 받는다.
 */
async function chargeJourneyOperationCredit(exec: ExecutionRow, sentAt: Date): Promise<void> {
  await deductCreditSafe({
    companyId: exec.company_id,
    cost: getCreditCost('journey-operation'),
    source: 'journey-operation',
    idempotencyKey: `journey-operation:${operationCreditRoot(exec)}:${kstDateTag(sentAt)}`,
    createdBy: exec.created_by || null,
  });
}

/** 실행 집합 로그 한 문장(skipped · failed · 비용 0 · 옛 logSkippedStep · logFailedStep 의 묶음 판) */
async function logStepMany(ids: string[], stepId: string, status: 'skipped' | 'failed', reason: string): Promise<void> {
  if (ids.length === 0) return;
  await query(
    `INSERT INTO journey_step_logs (id, execution_id, step_id, sent_at, status, cost, error_reason)
     SELECT gen_random_uuid(), x, $2::uuid, NOW(), $3, 0, $4 FROM unnest($1::uuid[]) AS x`,
    [ids, stepId, status, reason.slice(0, 500)],
  );
}

/**
 * 묶음 전진(옛 advanceOrComplete 의 묶음 판 · 다음 칸 조회 한 번 · 갱신 한 문장).
 *   단발(date_anchor · one_shot) = 완료 · 다음 칸이 끝 칸 = 그 자리 완료 · 다음 칸 없음 = 완료.
 *   그 밖 = 다음 칸 설정의 시각(개인 시각 켜진 여정 = 고객별 최근 90일 반응 최빈 시간 · 최소 3건 · 묶음 SQL 한 번).
 */
async function advanceExecutions(head: ExecutionRow, currentStep: StepRow, items: Array<{ exec: ExecutionRow; addedCost: number }>): Promise<void> {
  if (items.length === 0) return;
  const toFinish = items.map((i) => ({ id: i.exec.execution_id, addedCost: i.addedCost }));
  if (isSingleStepKind(head.start_kind)) {
    await finishExecutions(toFinish, head.journey_id, { stepOrder: currentStep.step_order });
    return;
  }
  const nextRes = await query(
    `SELECT id, step_type, step_order, delay_hours, delay_mode, target_hour_kst, channel, alimtalk_next_type FROM journey_steps
     WHERE journey_id = $1::uuid AND step_order > $2
     ORDER BY step_order ASC LIMIT 1`,
    [head.journey_id, currentStep.step_order]
  );
  if (nextRes.rows.length > 0 && String(nextRes.rows[0].step_type) === 'end') {
    await finishExecutions(toFinish, head.journey_id, { stepOrder: Number(nextRes.rows[0].step_order), endStepId: String(nextRes.rows[0].id) });
    return;
  }
  if (nextRes.rows.length === 0) {
    await finishExecutions(toFinish, head.journey_id, { stepOrder: currentStep.step_order });
    return;
  }
  const nextRow = nextRes.rows[0];
  const nextDelayHours = Number(nextRow.delay_hours || 0);
  const nextDelayMode = String(nextRow.delay_mode || 'relative');
  const nextTargetHourKst = nextRow.target_hour_kst != null ? Number(nextRow.target_hour_kst) : null;
  const nightExemptOpts = { nightExempt: isNightExemptStep(nextRow) };   // ★ 2026-11-02 다음 칸이 정보성 알림톡 · 보내지 않는 칸 = 밤에 밀지 않음(설계서 3-10)
  const baseRunAt = calculateNextRunAt(nextDelayMode, nextDelayHours, nextTargetHourKst, undefined, nightExemptOpts);
  const preferredHour = new Map<string, number>();
  // ★ 2026-07-11 send-time 개인화 — 켜진 여정 · 다음 칸이 시각 지정 모드일 때만(데이터 부족 · 오류 · 미마이그레이션 = 기본 시각)
  if (nextTargetHourKst != null && (nextDelayMode === 'specific_hour' || nextDelayMode === 'relative_at_hour')) {
    try {
      const ps = await query(`SELECT personal_send_time FROM journeys WHERE id = $1::uuid`, [head.journey_id]);
      if (ps.rows[0]?.personal_send_time === true) {
        const h = await query(
          `SELECT DISTINCT ON (customer_id) customer_id, h FROM (
             SELECT customer_id, EXTRACT(HOUR FROM (occurred_at AT TIME ZONE 'Asia/Seoul'))::int AS h, COUNT(*)::int AS c
               FROM cdp_events
              WHERE company_id = $1::uuid AND customer_id = ANY($2::uuid[])
                AND event_name IN ('message_click', 'page_view', 'purchase')   -- ct-observe: 개인화 발송 시각 = 고객 활동 시간대(구매 판정 아님 · 설계서 3-0 CT-J3 · CT-J9)
                AND occurred_at >= NOW() - INTERVAL '90 days'
              GROUP BY customer_id, 2 HAVING COUNT(*) >= 3
           ) t
           ORDER BY customer_id, c DESC, h ASC`,
          [head.company_id, [...new Set(items.map((i) => i.exec.customer_id))]]
        );
        for (const r of h.rows as any[]) preferredHour.set(String(r.customer_id), clampPersonalSendHour(Number(r.h)));
      }
    } catch {
      /* personal_send_time 컬럼 미마이그레이션/조회 실패 → step 기본 시각 */
    }
  }
  const runAtByHour = new Map<number, Date>();
  const runAt = (customerId: string): Date => {
    const ph = preferredHour.get(customerId);
    if (ph == null) return baseRunAt;
    if (!runAtByHour.has(ph)) runAtByHour.set(ph, calculateNextRunAt(nextDelayMode, nextDelayHours, ph, undefined, nightExemptOpts));
    return runAtByHour.get(ph)!;
  };
  await query(
    `UPDATE journey_executions e SET
       current_step_order = $2,
       next_run_at = x.at,
       total_cost = e.total_cost + x.cost,
       error_log = (SELECT COALESCE(jsonb_agg(el.v ORDER BY el.n), '[]'::jsonb)
                      FROM jsonb_array_elements(COALESCE(e.error_log, '[]'::jsonb)) WITH ORDINALITY AS el(v, n)
                     WHERE el.v->>'reason' IS DISTINCT FROM 'load_attempt')   -- 지난 칸의 적재 시도 기록(상한 근거) = 칸이 되돌아오지 않으므로 지움
      FROM unnest($1::uuid[], $3::timestamptz[], $4::numeric[]) AS x(id, at, cost)
     WHERE e.id = x.id`,
    [items.map((i) => i.exec.execution_id), currentStep.step_order, items.map((i) => runAt(i.exec.customer_id).toISOString()), items.map((i) => i.addedCost)]
  );
  const costSum = items.reduce((s, i) => s + i.addedCost, 0);
  if (costSum > 0) {
    await query(`UPDATE journeys SET stats_total_cost = stats_total_cost + $2, updated_at = NOW() WHERE id = $1::uuid`, [head.journey_id, costSum]);
  }
}

/**
 * 실행 완료 한 함수의 묶음 판(★ 2026-10-23 여정 결함 0 · 옛 finishExecution 문장을 실행 집합으로)
 *   완료 전환은 진행 중(active)일 때만 · 완료 수는 전환한 수만큼 · 직전 문자의 발송비는 상태와 무관하게 한 번.
 *   한 문장(자료 바꾸는 WITH) = 완료 · 끝 칸 기록 · 여정 통계가 함께 커밋되거나 함께 안 된다(Codex 1023 1R).
 */
async function finishExecutions(items: Array<{ id: string; addedCost: number }>, journeyId: string, opts: { stepOrder: number | null; endStepId?: string }): Promise<void> {
  if (items.length === 0) return;
  await query(
    `WITH x AS (SELECT * FROM unnest($1::uuid[], $2::numeric[]) AS x(id, cost)),
     prev AS (SELECT e.id, e.status, (SELECT x.cost FROM x WHERE x.id = e.id) AS cost
                FROM journey_executions e WHERE e.id IN (SELECT id FROM x) FOR UPDATE),
     done AS (
       UPDATE journey_executions e SET
          total_cost = e.total_cost + prev.cost,
          status = CASE WHEN prev.status = 'active' THEN 'completed' ELSE e.status END,
          completed_at = CASE WHEN prev.status = 'active' THEN NOW() ELSE e.completed_at END,
          current_step_order = CASE WHEN prev.status = 'active' AND $3::int IS NOT NULL THEN $3::int ELSE e.current_step_order END
         FROM prev
        WHERE e.id = prev.id
        RETURNING e.id, (prev.status = 'active') AS completed, prev.cost
     ),
     end_log AS (
       INSERT INTO journey_step_logs (id, execution_id, step_id, sent_at, status, cost, error_reason)
       SELECT gen_random_uuid(), done.id, $5::uuid, NOW(), 'skipped', 0, 'end_step' FROM done WHERE done.completed AND $5::uuid IS NOT NULL
     )
     UPDATE journeys j SET
        stats_total_completed = j.stats_total_completed + (SELECT COUNT(*) FROM done WHERE done.completed),
        stats_total_cost = j.stats_total_cost + (SELECT COALESCE(SUM(done.cost), 0) FROM done),
        updated_at = NOW()
      WHERE j.id = $4::uuid AND EXISTS (SELECT 1 FROM done WHERE done.completed OR done.cost > 0)`,
    [items.map((i) => i.id), items.map((i) => i.addedCost), opts.stepOrder, journeyId, opts.endStepId || null]
  );
}

/** ★ 2026-07-11 분기 — targetOrder 이상 첫 칸 직전으로 이동 + 그 칸의 지연으로 next_run_at(묶음 판 · 대상 칸 없으면 false = 호출부 완료) */
async function jumpExecutions(ids: string[], journeyId: string, targetOrder: number): Promise<boolean> {
  const t = await query(
    `SELECT step_order, delay_hours, delay_mode, target_hour_kst, step_type, channel, alimtalk_next_type FROM journey_steps
      WHERE journey_id = $1::uuid AND step_order >= $2
      ORDER BY step_order ASC LIMIT 1`,
    [journeyId, targetOrder]
  );
  if (t.rows.length === 0) return false;
  const row = t.rows[0];
  const nextRunAt = calculateNextRunAt(String(row.delay_mode || 'relative'), Number(row.delay_hours || 0), row.target_hour_kst != null ? Number(row.target_hour_kst) : null, undefined, { nightExempt: isNightExemptStep(row) });
  await query(`UPDATE journey_executions SET current_step_order = $2, next_run_at = $3 WHERE id = ANY($1::uuid[])`, [ids, Number(row.step_order) - 1, nextRunAt]);
  return true;
}

/**
 * 목표 달성 판정의 묶음 판(옛 isGoalConvertedSinceEntry · 목표 종류별 SQL 을 실행 집합으로 · 돌려주는 것 = 달성한 실행 id).
 *   purchase(기본) · click · visit · points_used · product. goal_kind 미마이그레이션(42703) = purchase. 판정 실패 = 빈 집합(여정 계속).
 */
async function goalConvertedExecutionIds(execs: ExecutionRow[]): Promise<Set<string>> {
  const head = execs[0];
  let goalKind = 'purchase';
  let productKeys: string[] = [];
  let productDoor: 'mall' | 'ledger' | null = null;
  let signupJourney = false;
  try {
    const gk = await query(`SELECT goal_kind, trigger_event, trigger_filters FROM journeys WHERE id = $1::uuid`, [head.journey_id]);
    const v = String(gk.rows[0]?.goal_kind || '');
    signupJourney = isSignupTrigger(gk.rows[0]?.trigger_event);
    // ★ 2026-09-30 V2 3차 — 상품 재구매 여정(새 여정만 'product' 로 저장된다 · 기존 행 동작 무변경).
    if (v === 'product') {
      const tf = gk.rows[0]?.trigger_filters || {};
      productKeys = Array.isArray(tf.product_keys) ? tf.product_keys.map((k: unknown) => String(k).trim()).filter(Boolean) : [];
      productDoor = tf.door === 'mall' || tf.door === 'ledger' ? tf.door : null;   // ★ 2026-11-04 C99 상품 식별 = (문, 키)
      goalKind = 'product';
    }
    // ★ 2026-09-29 여정 V2 0차 ⑫ — 저장된 'points_used'도 읽는다.
    if (v === 'click' || v === 'visit' || v === 'points_used') goalKind = v;
    else if (!v) {
      // ★ §11-5(§5-1) — goal_kind 미지정이면 트리거 계약의 종료 신호에서 파생한다(purchase 계열 = 기존 폴백).
      const exit = getTriggerContract(String(gk.rows[0]?.trigger_event || ''))?.exit;
      if (exit === 'points_used') goalKind = 'points_used';
    }
  } catch {
    /* goal_kind 컬럼 미마이그레이션 → purchase(현행) */
  }

  const ids = execs.map((e) => e.execution_id);
  const idSet = (rows: any[]): Set<string> => new Set(rows.map((x) => String(x.id)));
  try {
    if (goalKind === 'click') {
      const r = await query(
        `SELECT DISTINCT jsl.execution_id AS id FROM journey_step_logs jsl
           JOIN journey_executions je ON je.id = jsl.execution_id
           JOIN cdp_events ce ON ce.customer_id = je.customer_id
            AND ${journeyClickSql('ce', { companyExpr: '$2::uuid', journeyExpr: 'je.journey_id', stepExpr: 'jsl.step_id' })}   -- ★ 2026-11-02 목표 클릭 = 이 여정 · 그 칸 링크(CT-J9 · D13)
            AND ce.occurred_at >= jsl.sent_at
          WHERE jsl.execution_id = ANY($1::uuid[]) AND jsl.status = 'sent'`,
        [ids, head.company_id]
      );
      return idSet(r.rows);
    }
    if (goalKind === 'visit') {
      const r = await query(
        `SELECT e.id FROM journey_executions e
          WHERE e.id = ANY($1::uuid[])
            AND EXISTS (SELECT 1 FROM cdp_events c
                         WHERE c.company_id = $2::uuid AND c.customer_id = e.customer_id
                           AND c.event_name = 'page_view' AND c.occurred_at > e.entered_at)`,
        [ids, head.company_id]
      );
      return idSet(r.rows);
    }
    // ★ §11-5(§5-1) — 포인트 사용: 진입 스냅샷(points_at_entry)보다 현재 포인트가 줄었으면 종료(스냅샷 없음 = 계속).
    if (goalKind === 'points_used') {
      const cur = await query(`SELECT id, points FROM customers WHERE id = ANY($1::uuid[]) AND company_id = $2::uuid`, [execs.map((e) => e.customer_id), head.company_id]);
      const pts = new Map<string, number>(cur.rows.map((x: any) => [String(x.id), Number(x.points)]));
      const out = new Set<string>();
      for (const e of execs) {
        const snap = Number((e.entry_event_properties || ({} as Record<string, any>)).points_at_entry);
        const now = pts.get(e.customer_id);
        if (Number.isFinite(snap) && now != null && Number.isFinite(now) && now < snap) out.add(e.execution_id);
      }
      return out;
    }
    // ★ 2026-09-30 V2 3차 — 같은 상품 재구매(상품을 모르면 판정 불가 = 계속).
    if (goalKind === 'product') {
      const out = new Set<string>();
      if (productKeys.length === 0 || !productDoor) return out;   // 문 없는 상품 여정 = 진입 감시가 설정 오류로 멈춘다(normalizeProductFilters)
      // ponytail: 상품 목표는 실행마다 한 문장(드문 목표 · 판정 SQL = journey-product 한 곳 그대로) · 큰 상품 여정이 생기면 묶음 SQL 로
      for (const e of execs) {
        const r = await query(PRODUCT_REPURCHASE_SINCE_ENTRY_SQL, [head.company_id, e.customer_id, e.entered_at, productKeys, productDoor]);
        if (r.rows.length > 0) out.add(e.execution_id);
      }
      return out;
    }
    // purchase(기본 · 현행) — 판정 조각 = journey-goal-purchase 한 곳(가입 여정 = 가입 묶음 구매 포함 · B-1009-4)
    const r = await query(
      `SELECT e.id FROM journey_executions e WHERE e.id = ANY($1::uuid[]) AND ${purchasedSinceEntrySql('e', '$2::uuid', '$3::boolean')}`,
      [ids, head.company_id, signupJourney]
    );
    return idSet(r.rows);
  } catch (e: any) {
    console.log(`[JourneyExecutor] 목표 달성 판정 실패 — 통과(여정 계속):`, e?.message || e);
    return new Set<string>();
  }
}

/**
 * 조건 칸 판정의 묶음 판(옛 evaluateCondition · 종류 5 · 설계서 3-4 · SC-7) — 실행 id → met | not_met | error.
 *   확인 불가(빈 조건 · 미지원 종류 · 빈 사건 이름 · 빈 칸 id) = not_met · DB 평가 오류 = 그 묶음 전체 error(보류 · 재시도).
 */
async function evaluateConditionBatch(
  condJsonb: Record<string, unknown> | null,
  execs: ExecutionRow[],
  custById: Map<string, any>,
  companyId: string,
): Promise<Map<string, ConditionOutcome>> {
  const out = new Map<string, ConditionOutcome>();
  const all = (v: ConditionOutcome): Map<string, ConditionOutcome> => { for (const e of execs) out.set(e.execution_id, v); return out; };
  if (!condJsonb || typeof condJsonb !== 'object') return all('not_met');
  const type = String(condJsonb.type || '');
  const ids = execs.map((e) => e.execution_id);
  const byHit = (hit: Set<string>, keyOf: (e: ExecutionRow) => string, want: boolean): Map<string, ConditionOutcome> => {
    for (const e of execs) out.set(e.execution_id, hit.has(keyOf(e)) === want ? 'met' : 'not_met');
    return out;
  };

  if (type === 'customer_field') {
    for (const e of execs) out.set(e.execution_id, evaluateCustomerFieldCondition(condJsonb, custById.get(e.customer_id)) ? 'met' : 'not_met');
    return out;
  }
  if (type === 'cdp_event_exists') {
    const eventName = String(condJsonb.event_name || '').trim();
    if (!eventName) return all('not_met');   // Phase 7: 빈 event_name = 확인 불가 = 미충족
    const withinDays = Math.max(1, Math.min(365, Number(condJsonb.within_days) || 7));
    try {
      // ★ 2026-11-04 C99 T5 — 「지난 N일 구매」 = 두 문(CT-D4 · 몰 = 지금 − N일 · 매장 원장 = KST 오늘 − N일) · 그 밖 사건 = 지금 그대로
      const r = eventName === 'purchase'
        ? await query(
          `SELECT c.id AS customer_id FROM unnest($1::uuid[]) AS c(id)
            WHERE ${purchaseWithinDaysSql('c.id', '$2::uuid', '$3')}`,
          [execs.map((e) => e.customer_id), companyId, withinDays],
        )
        : await query(
          `SELECT DISTINCT customer_id FROM cdp_events
            WHERE customer_id = ANY($1::uuid[]) AND company_id = $2::uuid AND ${cdpEventNameMatchSql('cdp_events', '$3')}
              AND occurred_at >= NOW() - ($4 * INTERVAL '1 day')`,
          [execs.map((e) => e.customer_id), companyId, eventName, withinDays]
        );
      const exists = new Set<string>(r.rows.map((x: any) => String(x.customer_id)));
      return byHit(exists, (e) => e.customer_id, String(condJsonb.presence || 'exists') !== 'not_exists');
    } catch (err: any) {
      console.error('[Journey condition] cdp_event_exists 평가 DB 오류 → 발송 보류(재시도):', err?.message);
      return all('error');
    }
  }
  if (type === 'journey_step_clicked') {
    const stepOrder = Math.max(1, Number(condJsonb.step_order) || 1);
    const withinDays = Math.max(1, Math.min(365, Number(condJsonb.within_days) || 7));
    try {
      const r = await query(
        `SELECT DISTINCT jsl.execution_id FROM journey_step_logs jsl
           JOIN journey_steps js ON js.id = jsl.step_id
           JOIN journey_executions je ON je.id = jsl.execution_id
           JOIN cdp_events ce ON ce.customer_id = je.customer_id
             AND ${journeyClickSql('ce', { companyExpr: '$4::uuid', journeyExpr: 'je.journey_id', stepExpr: 'jsl.step_id' })}   -- ★ 2026-11-02 그 칸 링크만(CT-J9 · D12)
             AND ce.occurred_at >= jsl.sent_at
             AND ce.occurred_at <= jsl.sent_at + ($1 * INTERVAL '1 day')
          WHERE jsl.execution_id = ANY($2::uuid[]) AND js.step_order = $3 AND jsl.status = 'sent'`,
        [withinDays, ids, stepOrder, companyId]
      );
      return byHit(new Set(r.rows.map((x: any) => String(x.execution_id))), (e) => e.execution_id, condJsonb.clicked !== false);
    } catch (err: any) {
      console.error('[Journey condition] journey_step_clicked 평가 DB 오류 → 발송 보류(재시도):', err?.message);
      return all('error');
    }
  }
  // ★ 2026-09-30 V2 4차 — 이 여정에 들어온 뒤 구매했나(목표 판정과 같은 조각 · 가입 여정 = 가입 묶음 포함 · #13)
  if (type === 'purchase_since_entry') {
    try {
      const r = await query(
        `SELECT e.id FROM journey_executions e WHERE e.id = ANY($1::uuid[]) AND ${purchasedSinceEntrySql('e', '$2::uuid', '$3::boolean')}`,
        [ids, companyId, isSignupTrigger(execs[0].trigger_event)]
      );
      return byHit(new Set(r.rows.map((x: any) => String(x.id))), (e) => e.execution_id, condJsonb.purchased !== false);
    } catch (err: any) {
      console.error('[Journey condition] purchase_since_entry 평가 DB 오류 → 발송 보류(재시도):', err?.message);
      return all('error');
    }
  }
  // ★ 2026-09-30 V2 4차 — 이 칸 링크를 눌렀나(그 칸이 이 실행에 보내진 뒤 그 칸의 클릭 · 안 보내졌으면 안 눌렀음)
  if (type === 'step_link_clicked') {
    const targetStepId = String(condJsonb.step_id || '').trim();
    if (!targetStepId) return all('not_met');
    try {
      const r = await query(
        `SELECT DISTINCT jsl.execution_id FROM journey_step_logs jsl
           JOIN journey_executions je ON je.id = jsl.execution_id
           JOIN cdp_events ce ON ce.customer_id = je.customer_id
            AND ${journeyClickSql('ce', { companyExpr: '$3::uuid', journeyExpr: 'je.journey_id', stepExpr: '$2::uuid' })}   -- ★ 2026-11-02 CT-J9
            AND ce.occurred_at >= jsl.sent_at
          WHERE jsl.execution_id = ANY($1::uuid[]) AND jsl.step_id = $2::uuid AND jsl.status = 'sent'`,
        [ids, targetStepId, companyId]
      );
      return byHit(new Set(r.rows.map((x: any) => String(x.execution_id))), (e) => e.execution_id, condJsonb.clicked !== false);
    } catch (err: any) {
      console.error('[Journey condition] step_link_clicked 평가 DB 오류 → 발송 보류(재시도):', err?.message);
      return all('error');
    }
  }
  return all('not_met');   // 미지원 종류 — 발송 안 함
}

async function pauseJourney(journeyId: string, reason: string): Promise<void> {
  const pp: any[] = [journeyId];
  await query(
    `UPDATE journeys SET ${pausedSetSql(pp, reason)}, updated_at = NOW()
     WHERE id = $1::uuid AND status = 'active'`,
    pp,
  );
  console.warn(`[JourneyExecutor] 여정 일시정지 — journey=${journeyId} reason="${reason}"`);
}

async function logFailedStep(executionId: string, stepId: string, reason: string): Promise<void> {
  await query(
    `INSERT INTO journey_step_logs (
      id, execution_id, step_id, sent_at, status, cost, error_reason
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, NOW(), 'failed', 0, $3
    )`,
    [executionId, stepId, reason.slice(0, 500)]
  );
}

// ════════════════════════════════════════════════════════════════════
// ★ Phase 7 (2026-06-04): 조건 평가 DB 오류 → 발송 보류 + 재시도/정지.
//   발송 실패 재시도(적재 단위 안 들어감 · retryOrPauseAfterLoadFailure)와 동일 흐름 — error_count<1이면 5분 뒤 재평가,
//   넘으면 autoPauseExecution + pauseJourney. 조건을 확인 못 했으므로 종료(ended)도 전진(advance)도 하지 않는다.
//   사용 컬럼 전부 기존 운영 컬럼(error_count·last_error_at·error_log·next_run_at) — 신규 컬럼 0.
// ════════════════════════════════════════════════════════════════════
async function handleConditionEvalError(exec: ExecutionRow, step: StepRow): Promise<void> {
  try {
    const ecRes = await query(
      `SELECT COALESCE(error_count, 0) AS ec FROM journey_executions WHERE id = $1::uuid`,
      [exec.execution_id]
    );
    const errorCount = Number(ecRes.rows[0]?.ec || 0);
    if (errorCount < 1) {
      // 1회 자동 재평가 — 5분 후. 발송 안 함.
      const errorLogEntry = JSON.stringify([
        { at: new Date().toISOString(), reason: 'condition_eval_db_error', step_order: step.step_order },
      ]);
      await query(
        `UPDATE journey_executions SET
           next_run_at = NOW() + INTERVAL '5 minutes',
           error_count = COALESCE(error_count, 0) + 1,
           last_error_at = NOW(),
           error_log = COALESCE(error_log, '[]'::jsonb) || $2::jsonb
         WHERE id = $1::uuid`,
        [exec.execution_id, errorLogEntry]
      );
      await logFailedStep(exec.execution_id, step.id, 'condition_eval_db_error_retry_scheduled');
      console.log(`[JourneyExecutor] execution=${exec.execution_id} step=${step.step_order} 조건 DB 평가 실패 → 5분 후 재평가 (error_count=${errorCount + 1})`);
      return;
    }
    // 재평가 1회 후에도 실패 → 발송 안 하고 정지 + 담당자 안내 (pauseReason은 기존 값 재사용).
    // ★ C129 D2 — 여정 멈춤이 먼저(던지면 실행 멈춤에 닿지 않는다 · error_count 가 그대로라 다음 회차 다시 이 갈래)
    await pauseJourney(exec.journey_id, '조건 평가 DB 오류 (자동 재시도 후에도 실패)');
    await autoPauseExecution({
      companyId: exec.company_id,
      journeyId: exec.journey_id,
      stepId: step.id,
      executionId: exec.execution_id,
      pauseReason: 'auto_retry_exhausted',
      pauseTriggerSource: 'condition_eval_db_error',
    });
  } catch (retryErr: any) {
    console.warn('[JourneyExecutor] 조건 평가 재시도 분기 처리 실패 (skip):', retryErr?.message);
  }
  await logFailedStep(exec.execution_id, step.id, 'condition_eval_db_error');
}

// ════════════════════════════════════════════════════════════════════
// ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 변수 치환 + 버튼 JSON 변환 + MMS 파일명 추출 헬퍼 3종.
// ════════════════════════════════════════════════════════════════════

// 알림톡 본문 #{변수} 치환은 alimtalk-vars.fillAlimtalkVarMap으로 통일 (2026-06-22).
// 여정 경로는 buildDefaultFallbacks(표준 대체값)를 동반해 호출한다. (기존 replaceAlimtalkVars 정의 제거)

// (★ 2026-09-27 m093 — 옛 extractBasename 제거: MMS 첨부는 절대경로 그대로 넘긴다)
