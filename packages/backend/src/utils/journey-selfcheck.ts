/**
 * 여정 자동 판정 — 합성 회사에서 매일 재는 「여정 결함 0」(★ 2026-11-14 C134 · 설계서 docs/2026-11-14-journey-step-campaign-owner-design.md §5 S1 · S2)
 *
 * 왜 있나
 *   B-1114-1 을 찾은 것은 점검이 아니라 운영이었다(합성 회사의 여정이 실제로 돌았고 · 누가 목록을 열었고 · 경보가 울렸다).
 *   「닫힘」을 검토 · 리뷰 통과가 아니라 측정값으로 정한다 = 합성 회사에서 아래 판정이 며칠 연속 0 인가.
 *
 * 하는 일(합성 회사만 · 부르는 곳 = 합성 데이터 워커 tick)
 *   S2 목록 여는 동작 흉내 = 그 회사의 최근 캠페인 한 쪽을 목록 라우트와 같은 함수(getCampaignResultCounts → 목록 자동 완료 CT)로 처리.
 *      B-1114-1 의 방아쇠(누가 캠페인 목록을 연다)를 사람 없이 매 tick 당긴다.
 *   S1 밤 판정 = 하루 한 번. 두 가지를 가른다(Codex 구현 1R — 섞으면 못 본 날이 「정상」으로 채워진다).
 *      · 관측 = **어제 하루**를 판정해 기록 표(journey_selfcheck_daily · C134-DDL-1)에 행을 만든다. 행은 이것만 만든다.
 *      · 재계산 = 그보다 앞선 6일은 **이미 행이 있는 날만** 다시 판정해 나빠지는 쪽으로 고친다(늦게 드러난 위반을 더한다 · 행을 만들지 않는다).
 *      과거의 위반을 지금 상태로 덮지 않는다(표식은 뒤에 풀리면 흔적이 사라진다) · 판정을 못 한 날(워커가 멈춘 날 · 처음 켜기 전)은
 *      행이 없다 = 연속 일수에 들지 않는다 → 연속 7 은 실제로 일곱 밤을 본 뒤에만 나온다.
 *      위반이 있으면 시스템 경보(회사 없이 = 자동 판정 자체의 신호 · 사내 회사 거름을 타지 않게).
 */
import { query } from '../config/database';
import { getCampaignResultCounts } from './stats-aggregation';
import { autoCompleteTargetIds, applyListAutoComplete } from './campaign-list-autocomplete';
import { CLAIM_PROOF_LIMIT_SEC } from './journey-send-claim';
import { JOURNEY_STEP_SEND_TYPE, stepCampaignCloseBefore } from './journey-step-campaign';
import { sendSystemAlert } from './system-alert';

/** 목록 한 쪽(흉내가 처리하는 캠페인 수) */
export const MIMIC_PAGE_SIZE = 20;
/** 판정이 되돌아보는 날 수(연속 0 일수의 위쪽 끝) */
export const SELFCHECK_WINDOW_DAYS = 7;
/** 「안 풀린 표식」으로 세는 나이 = 증명 대기 상한(1시간) + 정리 주기 여유 10분 */
export const STUCK_CLAIM_AGE_SEC = CLAIM_PROOF_LIMIT_SEC + 10 * 60;

/**
 * 시스템 탓으로 못 보낸 칸 기록의 사유(실행기가 journey_step_logs.error_reason 에 쓰는 값 가운데).
 *   고객 · 설정 탓(잔액 부족 · 조건 불충족 · 주문 취소 · 기다림)은 위반이 아니다. 증명 못 해 닫은 것(load_unprovable)은 「안 풀린 표식」 쪽에서 센다.
 */
export const FAULT_REASON_SQL =
  `(l.error_reason LIKE 'queue_insert_failed%' OR l.error_reason LIKE 'condition_eval_db_error%'
    OR l.error_reason IN ('unknown_step_type', 'condition_branch_target_missing'))`;

export interface JourneyDayVerdict {
  day: string;
  /** 그날 실패로 끝난 실행 */
  failedExecutions: number;
  /** 그날 처리 오류가 난 실행(오류 기록 error_log 의 그날 항목 · 기록이 없는 옛 행은 마지막 오류 시각) */
  erroredExecutions: number;
  /** 그날 표식 가운데 아직 미확정(상한을 넘김)이거나 증명 못 해 닫은 것(= 보냈는지 모른 채 포기) */
  stuckClaims: number;
  /** 그날 시스템 탓으로 못 보낸 칸 기록(적재 실패 · 조건 판정 DB 오류 · 모르는 칸 종류) */
  faultLogs: number;
  /** 그날(닫힌 날)의 단계 캠페인인데 아직 보내는 중 */
  unclosedCampaigns: number;
  /** 그날 단계 캠페인 가운데 대상 수 ≠ 발송 수(둘은 확정 문장이 같이 올린다 = 다르면 여정 밖이 썼다) */
  countMismatch: number;
  violations: number;
}

const KST = `AT TIME ZONE 'Asia/Seoul'`;
/** 단계 캠페인의 날짜 기준 칸(닫기 문장 · 정산 스위퍼와 같다) */
const CAMP_BASE = `COALESCE(c.scheduled_at, c.sent_at, c.created_at)`;
/**
 * 실행 e 의 오류 기록에 그날($2)의 **오류** 항목이 있는가. 항목 = 실행기가 쓰는 { at: ISO 시각, reason, … }.
 *   error_log 에는 오류가 아닌 항목이 하나 있다 = 적재 시도 기록(reason 'load_attempt' · 정상 발송 앞에도 남고 마지막 칸에서는 지워지지 않는다
 *   · 실행기 loadAttemptsSql 이 같은 값으로 가른다) → 뺀다(안 빼면 정상 발송일이 오류일로 굳는다 · Codex 구현 2R).
 *   그 밖의 항목(처리 예외 · 적재 실패 · 적재 응답 모름 · 조건 판정 DB 오류)은 전부 시스템 탓이다. 새 항목 종류가 생기면 오류로 센다(놓치는 쪽이 아니라 울리는 쪽).
 *   배열이 아닌 값 · at 이 시각 꼴이 아닌 항목은 세지 않는다(형 변환 오류로 판정 전체가 죽지 않게 — CASE 가 변환을 가린다).
 */
export const ERRORED_ON_DAY_SQL =
  `EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.error_log) = 'array' THEN e.error_log ELSE '[]'::jsonb END) x
            WHERE x->>'reason' IS DISTINCT FROM 'load_attempt'
              AND CASE WHEN x->>'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}'
                       THEN ((x->>'at')::timestamptz ${KST})::date END = $2::date)`;

/** (순수) KST 날짜 글자에 일수를 더한다. */
export function addKstDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** (순수) 지금의 KST 날짜 글자. */
export function kstYmd(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
/** (순수) 위반 합. */
export function sumViolations(v: Omit<JourneyDayVerdict, 'day' | 'violations'>): number {
  return v.failedExecutions + v.erroredExecutions + v.stuckClaims + v.faultLogs + v.unclosedCampaigns + v.countMismatch;
}
/**
 * (순수) 어제부터 거슬러 이어진 「기록이 있고 위반 0」 일수.
 *   stored = 날짜 → 위반 수(기록 표에 있는 날만). 기록이 없는 날(판정을 못 한 날)에서 끊는다 = 못 본 날을 정상으로 세지 않는다.
 */
export function zeroStreak(today: string, stored: ReadonlyMap<string, number>, windowDays: number = SELFCHECK_WINDOW_DAYS): number {
  let n = 0;
  for (let i = 1; i <= windowDays; i++) {
    const v = stored.get(addKstDays(today, -i));
    if (v === undefined || v !== 0) break;
    n++;
  }
  return n;
}

/** S2 — 목록 여는 동작 흉내(목록 라우트와 같은 판정 · 같은 닫는 문장). 돌려주는 것 = 이번에 완료로 맞춘 대상 수. */
export async function runListOpenMimic(companyId: string): Promise<number> {
  const r = await query(
    `SELECT c.id, c.company_id, c.created_by, c.status, c.send_type, c.send_config, c.result_final,
            c.sent_count, c.success_count, c.fail_count
       FROM campaigns c
      WHERE c.company_id = $1::uuid
      ORDER BY c.created_at DESC
      LIMIT ${MIMIC_PAGE_SIZE}`,
    [companyId],
  );
  if (r.rows.length === 0) return 0;
  const counts = await getCampaignResultCounts(r.rows);
  const ids = autoCompleteTargetIds(r.rows, (id) => counts.get(id) || { success: 0, fail: 0, pending: 0 });
  applyListAutoComplete(ids, '[journey-selfcheck][list]');
  return ids.length;
}

/** S1 — 한 회사 · 한 날(KST)의 판정. now = 판정하는 시각(안 풀린 표식 · 안 닫힌 캠페인은 이 시각 기준). */
export async function judgeJourneyDay(companyId: string, day: string, now: Date = new Date()): Promise<JourneyDayVerdict> {
  // 오류가 난 날 = 오류 기록(error_log 의 항목마다 at)으로 센다. 마지막 오류 시각(last_error_at)은 다음 오류가 덮는다 →
  //   같은 실행이 23:58 과 다음 날 00:03 에 오류를 내면 앞 날이 0 으로 읽혔다(Codex 구현 1R). 기록은 실행기가 마지막 20건을 남긴다
  //   (EXECUTION_ERROR_LOG_KEEP · 한 실행의 처리 오류 상한 12). 기록이 없는 옛 행 = 마지막 오류 시각으로.
  const ex = await query(
    `SELECT COUNT(*) FILTER (WHERE e.status = 'failed'
                               AND (COALESCE(e.completed_at, e.last_error_at, e.entered_at) ${KST})::date = $2::date)::int AS failed,
            COUNT(*) FILTER (WHERE (e.last_error_at ${KST})::date = $2::date OR ${ERRORED_ON_DAY_SQL})::int AS errored
       FROM journey_executions e JOIN journeys j ON j.id = e.journey_id
      WHERE j.company_id = $1::uuid
        AND (e.last_error_at IS NOT NULL OR e.status = 'failed')`,
    [companyId, day],
  );
  const logs = await query(
    `SELECT COUNT(*) FILTER (WHERE (l.status = 'sending' AND l.sent_at < $3::timestamptz - ($4::int * INTERVAL '1 second'))
                                OR (l.status = 'failed' AND l.error_reason = 'load_unprovable'))::int AS stuck,
            COUNT(*) FILTER (WHERE ${FAULT_REASON_SQL})::int AS fault
       FROM journey_step_logs l
       JOIN journey_executions e ON e.id = l.execution_id
       JOIN journeys j ON j.id = e.journey_id
      WHERE j.company_id = $1::uuid AND (l.sent_at ${KST})::date = $2::date`,
    [companyId, day, now.toISOString(), STUCK_CLAIM_AGE_SEC],
  );
  // 닫을 수 있는 날(= (지금 − 유예)의 KST 날짜보다 앞)이고 닫는 주기(5분)가 두 바퀴 돌 시간이 지났을 때만 「안 닫힘」을 센다.
  const closable = day < stepCampaignCloseBefore(new Date(now.getTime() - 10 * 60 * 1000));
  const camp = await query(
    `SELECT COUNT(*) FILTER (WHERE $3::boolean AND c.status = 'sending')::int AS unclosed,
            COUNT(*) FILTER (WHERE COALESCE(c.target_count, 0) <> COALESCE(c.sent_count, 0))::int AS mismatch
       FROM campaigns c
      WHERE c.company_id = $1::uuid AND c.send_type = '${JOURNEY_STEP_SEND_TYPE}'
        AND (${CAMP_BASE} ${KST})::date = $2::date`,
    [companyId, day, closable],
  );
  const parts = {
    failedExecutions: Number(ex.rows[0]?.failed || 0),
    erroredExecutions: Number(ex.rows[0]?.errored || 0),
    stuckClaims: Number(logs.rows[0]?.stuck || 0),
    faultLogs: Number(logs.rows[0]?.fault || 0),
    unclosedCampaigns: Number(camp.rows[0]?.unclosed || 0),
    countMismatch: Number(camp.rows[0]?.mismatch || 0),
  };
  return { day, ...parts, violations: sumViolations(parts) };
}

export type PersistResult =
  | { state: 'kept'; verdict: JourneyDayVerdict }
  /** 관측 기록이 없는 지난 날 — 재계산으로는 행을 만들지 않는다(못 본 날을 정상으로 채우지 않는다) */
  | { state: 'unobserved' }
  /** 기록 표 없음(C134-DDL-1 전) — 판정은 하되 연속 일수는 못 센다 */
  | { state: 'no_table' };

/**
 * 판정을 기록 표에 남긴다 — 항목마다 큰 값만 남긴다(뒤에 풀려 0 으로 읽혀도 처음 본 위반이 지워지지 않는다 · 늦게 드러난 위반은 더해진다).
 *   observe = true(관측 = 어제) 일 때만 새 행을 만든다. false(재계산 = 그보다 앞선 날)는 이미 있는 행만 고친다 — 한 문장 안의 조건.
 *   돌려주는 것 = 남은 뒤의 값(kept) · 행이 없어 안 남김(unobserved) · 기록 표 없음(no_table).
 */
export async function persistVerdict(companyId: string, v: JourneyDayVerdict, observe: boolean): Promise<PersistResult> {
  try {
    const r = await query(
      `INSERT INTO journey_selfcheck_daily AS t
              (company_id, day, failed_executions, errored_executions, stuck_claims, fault_logs, unclosed_campaigns, count_mismatch, violations)
       SELECT $1::uuid, $2::date, $3::int, $4::int, $5::int, $6::int, $7::int, $8::int, $3::int + $4::int + $5::int + $6::int + $7::int + $8::int
        WHERE $9::boolean OR EXISTS (SELECT 1 FROM journey_selfcheck_daily o WHERE o.company_id = $1::uuid AND o.day = $2::date)
       ON CONFLICT (company_id, day) DO UPDATE SET
              failed_executions = GREATEST(t.failed_executions, EXCLUDED.failed_executions),
              errored_executions = GREATEST(t.errored_executions, EXCLUDED.errored_executions),
              stuck_claims = GREATEST(t.stuck_claims, EXCLUDED.stuck_claims),
              fault_logs = GREATEST(t.fault_logs, EXCLUDED.fault_logs),
              unclosed_campaigns = GREATEST(t.unclosed_campaigns, EXCLUDED.unclosed_campaigns),
              count_mismatch = GREATEST(t.count_mismatch, EXCLUDED.count_mismatch),
              violations = GREATEST(t.failed_executions, EXCLUDED.failed_executions) + GREATEST(t.errored_executions, EXCLUDED.errored_executions)
                         + GREATEST(t.stuck_claims, EXCLUDED.stuck_claims) + GREATEST(t.fault_logs, EXCLUDED.fault_logs)
                         + GREATEST(t.unclosed_campaigns, EXCLUDED.unclosed_campaigns) + GREATEST(t.count_mismatch, EXCLUDED.count_mismatch),
              last_judged_at = NOW()
       RETURNING failed_executions, errored_executions, stuck_claims, fault_logs, unclosed_campaigns, count_mismatch, violations`,
      [companyId, v.day, v.failedExecutions, v.erroredExecutions, v.stuckClaims, v.faultLogs, v.unclosedCampaigns, v.countMismatch, observe],
    );
    const x = r.rows[0];
    if (!x) return { state: 'unobserved' };
    return {
      state: 'kept',
      verdict: {
        day: v.day, failedExecutions: Number(x.failed_executions), erroredExecutions: Number(x.errored_executions), stuckClaims: Number(x.stuck_claims),
        faultLogs: Number(x.fault_logs), unclosedCampaigns: Number(x.unclosed_campaigns), countMismatch: Number(x.count_mismatch), violations: Number(x.violations),
      },
    };
  } catch (e: any) {
    if (e?.code === '42P01') return { state: 'no_table' };
    throw e;
  }
}

/** 기록 표에 남은 지난 날들의 위반 수(날짜 → 위반). 표가 없으면 null. */
export async function storedViolations(companyId: string, today: string): Promise<Map<string, number> | null> {
  try {
    const r = await query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, violations FROM journey_selfcheck_daily
        WHERE company_id = $1::uuid AND day >= $2::date - ${SELFCHECK_WINDOW_DAYS} AND day < $2::date`,
      [companyId, today],
    );
    return new Map(r.rows.map((x: any) => [String(x.day), Number(x.violations)]));
  } catch (e: any) {
    if (e?.code === '42P01') return null;
    throw e;
  }
}

/** 켜진 여정의 (시작 종류 · 채널) 가운데 지난 7일 동안 한 번도 안 나간 것 — 판정이 못 본 길(위반은 아니다 · 매일 보이게만). */
export async function neverFiredCombos(companyId: string): Promise<string[]> {
  const r = await query(
    `SELECT j.trigger_event, COALESCE(s.channel, 'lms') AS channel, COUNT(l.id)::int AS sent7
       FROM journeys j
       JOIN journey_steps s ON s.journey_id = j.id AND s.step_type = 'message'
       LEFT JOIN journey_step_logs l ON l.step_id = s.id AND l.status = 'sent' AND l.sent_at >= NOW() - INTERVAL '${SELFCHECK_WINDOW_DAYS} days'
      WHERE j.company_id = $1::uuid AND j.status = 'active'
      GROUP BY 1, 2
      ORDER BY 1, 2`,
    [companyId],
  );
  return r.rows.filter((x: any) => Number(x.sent7) === 0).map((x: any) => `${x.trigger_event}/${x.channel}`);
}

export interface JourneySelfcheckResult {
  companyId: string;
  /** 어제의 판정(기록 표에 남은 값 · 표가 없으면 이번에 잰 값) */
  yesterday: JourneyDayVerdict;
  /** 어제부터 거슬러 이어진 「기록 있음 · 위반 0」 일수 · 기록 표가 없으면 null */
  streak: number | null;
  neverFired: string[];
}

/**
 * S1 — 어제를 관측해 행을 만들고 · 그보다 앞선 날은 이미 있는 행만 다시 판정해 나빠지는 쪽으로 고친 뒤 ·
 *   어제의 판정 · 연속 0 일수 · 못 본 길을 찍는다. 어제 위반이 있으면 경보(회사 · 날마다 한 번).
 */
export async function runJourneySelfcheck(companyId: string, now: Date = new Date()): Promise<JourneySelfcheckResult> {
  const today = kstYmd(now);
  let yesterday: JourneyDayVerdict | null = null;
  let recorded = true;
  for (let i = SELFCHECK_WINDOW_DAYS; i >= 1; i--) {
    const judged = await judgeJourneyDay(companyId, addKstDays(today, -i), now);
    const res = await persistVerdict(companyId, judged, i === 1);
    if (res.state === 'no_table') recorded = false;
    if (i === 1) yesterday = res.state === 'kept' ? res.verdict : judged;
  }
  const stored = recorded ? await storedViolations(companyId, today) : null;
  const streak = stored ? zeroStreak(today, stored) : null;
  const neverFired = await neverFiredCombos(companyId);
  const y = yesterday!;
  const tag = companyId.slice(0, 8);
  console.log(
    `[journey-selfcheck] ${y.day} company=${tag} 위반 ${y.violations}` +
    `(실패 실행 ${y.failedExecutions} · 오류 실행 ${y.erroredExecutions} · 안 풀린 표식 ${y.stuckClaims} · 시스템 탓 못 보냄 ${y.faultLogs}` +
    ` · 안 닫힌 단계 캠페인 ${y.unclosedCampaigns} · 대상 수 ≠ 발송 수 ${y.countMismatch})` +
    ` · 연속 0 일수 ${streak === null ? '기록 표 없음(C134-DDL-1)' : `${streak}/${SELFCHECK_WINDOW_DAYS}`}` +
    ` · 7일 동안 안 나간 (시작 종류/채널) ${neverFired.length}${neverFired.length ? ': ' + neverFired.slice(0, 12).join(', ') : ''}`,
  );
  if (y.violations > 0) {
    void sendSystemAlert({
      companyId: null, dedupKey: `journey-selfcheck:${companyId}:${y.day}`, cooldownMs: 20 * 60 * 60 * 1000,
      message:
        `여정 자동 판정 ${y.day}(합성 회사 ${tag}) 위반 ${y.violations}건 — 실패 실행 ${y.failedExecutions} · 오류 실행 ${y.erroredExecutions}` +
        ` · 안 풀린 표식 ${y.stuckClaims} · 시스템 탓 못 보냄 ${y.faultLogs} · 안 닫힌 단계 캠페인 ${y.unclosedCampaigns} · 대상 수 ≠ 발송 수 ${y.countMismatch}.`,
    }).catch(() => undefined);
  }
  return { companyId, yesterday: y, streak, neverFired };
}

// ───── 합성 데이터 워커가 부르는 tick ─────

/** 회사마다 마지막으로 판정을 끝낸 날(재기동하면 같은 날 한 번 더 = 기록은 큰 값만 남기므로 해 없음 · 경보는 dedup) */
const lastJudgedDay = new Map<string, string>();
/** 시험 전용. */
export function resetJourneySelfcheckState(): void { lastJudgedDay.clear(); }

/**
 * 합성 회사마다: 흉내는 tick 마다 · 판정은 하루 한 번(00:40 KST 뒤 = 닫는 유예 10분 + 닫는 주기가 여러 바퀴 돈 뒤).
 *   한 회사의 오류는 그 회사의 이번 tick 만 멈춘다(다음 tick 에 다시).
 */
export async function journeySelfcheckTick(companyIds: readonly string[], now: Date = new Date()): Promise<void> {
  const today = kstYmd(now);
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const afterGate = kst.getUTCHours() * 60 + kst.getUTCMinutes() >= 40;
  for (const companyId of companyIds) {
    try {
      await runListOpenMimic(companyId);
      if (afterGate && lastJudgedDay.get(companyId) !== today) {
        await runJourneySelfcheck(companyId, now);
        lastJudgedDay.set(companyId, today);
      }
    } catch (err: any) {
      console.error(`[journey-selfcheck] company=${companyId.slice(0, 8)} 실패(다음 tick 에 다시):`, err?.message || err);
    }
  }
}
