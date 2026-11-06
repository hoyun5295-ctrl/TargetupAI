// packages/backend/src/utils/journey-pretest-notifier.ts
// CT-93: 발송 전 스팸테스트 + 담당자 알림 (Phase 6B 재설계 — 2026-06-04)
//   - 5분 cron 스캐너 scanAndPretest: next_run_at 2시간 안 + 다음 step이 message인 active execution을
//     (journey, step, KST 발송날짜)당 1회 처리.
//   - snapshot 본문 스팸테스트 → 통과면 담당자 LMS 안내 / 걸리면 1회 재생성(source journey-ai-refine = 1크레딧 자동)
//     + 재테스트 → 통과면 snapshot 갱신(실발송 반영)+안내, 또 걸리면 여정 정지+수동확인 안내.
//   - 종전 미래 예측 스케줄링(predictNextSendTimes)은 journey_executions에 없는 컬럼(scheduled_at·step_id)을 조회해
//     활성화 try/catch에 삼켜져 조용히 깨져 있었음 → 폐기하고 실제 next_run_at 스캔으로 교체.
//   - dedup = journey_pretest_schedules에 (journey, step, KST날짜) 처리 기록.
// ★ 2026-10-31 칸 관문(설계서 docs/2026-10-31-journey-step-gate-notice-design.md · 뿌리 R30)
//   - 「그날 검사를 마쳤다」 = pretestDoneSql 한 조각(notified · cancelled) · 스캔 후보와 실행기 관문이 같이 쓴다.
//     실행기는 그날 기록이 없는 문자 칸 발송을 미루고(바로 보내는 칸 · 날짜 기준 · 스캔이 놓친 발송) 이 스캐너가 검사 · 안내 · 기록한다.
//   - 묶음 상태표: 기록 없음 = 검사 → pending(통과 · 안내 전) / pending = 안내만(시도 수 = DB · 3회) → notified.
//   - 기록 · 스냅숏 표식 · 자동 보정 본문 쓰기 = recordIfCurrent 하나(검사한 판이 최신일 때만 · 문안 수정과 같은 journeys 행 잠금).
//   - 담당자 안내 적재 = 상한 있는 MySQL 연결(withBoundedMysql) · 이 스캐너가 멈추면 여정 문자 발송이 묶인다.
// ★ 2026-11-02 엔진 재설계 E3(docs/2026-11-01-journey-automarketing-engine-design.md · Harold 「매일 검사 오탐으로 여정이 정지되면 책임은」)
//   - 「그날 검사」 → 정기 재검사 7일 굴림 · 발송을 막지 않는다(검사 큐 용량 = 한 줄 · 건당 45~90초 · SC-16) · 새 글 · 고친 글만 검사를 기다린다.
//   - 결과표 = 통과 문자 0 · 막힘 = 그 판 보류(held · 여정 멈춤 0 · 안내는 보류로 바뀔 때 한 번) · 장애 = 시도 기록(error · 판 · KST 하루 6번 = DB 셈) ·
//     통과한 글 재검사 장애 3번 = 「확인 못 함」 결정(unverified · 발송 계속) · 새 글 2시간 = 담당자 안내 한 번(late).
//   - 실행기 관문 = stepHeldSql(지금 판의 가장 최근 결정이 보류인가) 한 조각.

import { isDemoCompany } from './demo-company';
import { readJourneyCopyFacts } from './journey-copy-facts';
import { query, withTransaction } from '../config/database';
import { buildJourneyPauseShortUrl, generatePauseToken } from './journey-pause-handler';
import { KST_TODAY_START_SQL } from './stats-aggregation';
import { pickOwnerContact } from './owner-contact';
import { getPlatformNoticeCallback } from './sms-queue';
import { insertNoticeSms } from './sms-notice';   // ★ 2026-11-06 C109 D6 안내 적재 CT
import { runStepSpamTest, mergeSpamVerdicts } from './journey-pretest-validator';
import { isSpamHold } from './spam-test-queue';
import { candidatesReady, readCandidate, claimCandidate, candidateStillMine, saveCandidate, moveCandidate, regenChargeKey, sweepPretestCandidates, CANDIDATE_GENERATING_TTL_MINUTES } from './journey-pretest-candidate';
import { regenerateStepAvoidingSpam } from './journey-ai-generator';
import { groupPretestBundles, kstDateOf, PretestScanRow, PretestBundle } from './journey-pretest-scan';
import { stepSendVersions, loadStepVariantRows, latestSnapshotSql } from './journey-step-versions';
import { resolveJourneyAdFlag } from './journey-ad-policy';   // ★ 2026-11-02 광고 판정 CT(설계서 3-0 CT-J8)
import { journeyCopyIssue } from './send-placeholder-gate';   // ★ 2026-11-02 보낼 글 판정 CT(설계서 3-0 CT-J10)
import { journeyCopyContext, journeyStepCopyIssueNow } from './journey-message-render';
import { sendSystemAlert, alertPassFailures, type PassFailure } from './system-alert';
import { messageStepBoundsSql } from './journey-step-notify';
import { NOTICE_ENQUEUE_TIMEOUT_MS, NOTICE_MAX_ATTEMPTS, sendNoticeOnce } from './journey-notice-once';

type PretestMode = 'pretest_autofixed' | 'pretest_held' | 'pretest_late';
interface ScanSummary { tested: number; passed: number; regenerated: number; held: number; notified: number }

/**
 * ★ 2026-11-02 E3 — 결정 기록(관문 · 스캔이 「가장 최근」으로 보는 상태) · 시도 기록(error · late)은 결정이 아니다.
 *   옛 pending(통과 · 안내 전) · paused(옛 여정 멈춤)도 결정으로 읽는다(SC-21).
 */
export const PRETEST_DECISION_STATUSES = ['notified', 'unverified', 'cancelled', 'held', 'paused', 'pending'] as const;
// 결정이 아닌 기록 = error(검사 시도) · late(지연 안내) · seen(스캔이 보낼 때가 가까운 미검사 판을 처음 본 시각 · Codex 구현 1R)
const DECISION_SQL_LIST = PRETEST_DECISION_STATUSES.map((x) => `'${x}'`).join(', ');
/** 보류 재검사 간격(일) · 같은 글 이어 보기 기간 — 보류 결정이 이보다 오래되면 다시 검사(★ 2026-11-02 통과한 글 정기 재검사 = 주간 묶음 검사 몫 · 설계서 3-9) */
export const PRETEST_RECHECK_DAYS = 7;
/** 그 판 KST 하루 검사 시도(error) 상한 — DB 셈(재시작 · 동시 무관 · 설계 1R D1-9 · R8) · 넘으면 스캔이 LIMIT 앞에서 뺀다 */
export const PRETEST_ERROR_DAILY_MAX = 6;
/** 같은 판 보류 재검사 상한(주 1회 × 4 · 그 뒤는 문안을 고칠 때까지 보류 · 설계 3R) */
export const PRETEST_HELD_RECHECK_MAX = 4;
/** 새 글 · 고친 글 검사가 이 시간 넘게 못 끝나면 담당자 안내 한 번(판마다 · E3-3) */
export const PRETEST_LATE_NOTICE_HOURS = 2;

/**
 * ★ 2026-11-02 E3-1 — 그 칸 **지금 판**의 가장 최근 결정 기록이 보류인가(SQL 조각 하나 · 실행기 관문 · 상황판이 같이 쓴다).
 *   판이 바뀌면(고친 글 · 새로 켠 판) 옛 판 보류는 관문을 막지 않는다(새 판은 표식 < 100 이면 검사를 기다린다).
 */
export function stepHeldSql(journeyExpr: string, stepExpr: string): string {
  return `EXISTS (SELECT 1 FROM (
      SELECT ps_h.status, ps_h.snapshot_id FROM journey_pretest_schedules ps_h
       WHERE ps_h.journey_id = ${journeyExpr} AND ps_h.step_id = ${stepExpr} AND ps_h.status IN (${DECISION_SQL_LIST})
       ORDER BY ps_h.notify_at DESC, ps_h.id DESC LIMIT 1) last_dec
     WHERE last_dec.status = 'held'
       AND last_dec.snapshot_id IS NOT DISTINCT FROM (SELECT ls_h.id FROM ${latestSnapshotSql(journeyExpr, stepExpr)} ls_h))`;
}

/**
 * ★ 2026-11-02 「이 판을 지금 보낼 수 있는가」 판정 조각 하나(설계서 3-18 · 3-0 CT-J1 · Codex 설계 2R #1 = 판정을 세 번 다른 시각에 읽어 틈).
 *   = 그 칸 최신 판 id = 넘긴 판 id(읽은 뒤 새 판이 커밋되면 거짓) · 그 판 신뢰도 100(검사 통과 · 칸 NULL = 옛 판 = 통과) · 그 판 보류 아님.
 *   결정 = 실행기 발송 선점 문장 WHERE 한 곳(확인과 선점 사이 틈 0) · 관문 · 단위 확인은 이 결정을 미리 보는 빠른 길.
 *   판 id 가 NULL(판이 없는 옛 여정) = 그동안 판이 생기지 않았을 때만 참.
 */
export function stepSendableSql(journeyExpr: string, stepExpr: string, snapshotIdExpr: string): string {
  return `((SELECT ls_s.id FROM ${latestSnapshotSql(journeyExpr, stepExpr)} ls_s) IS NOT DISTINCT FROM ${snapshotIdExpr}
     AND COALESCE((SELECT ss_c.confidence_score FROM journey_step_snapshots ss_c WHERE ss_c.id = ${snapshotIdExpr}), 100) >= 100
     AND NOT ${stepHeldSql(journeyExpr, stepExpr)})`;
}

/**
 * ★ 2026-11-02 E5 — 칸의 가장 최근 결정 기록(LATERAL 조각 · 상황판이 부른다 · 기록 읽기 = 이 파일 한 곳 · R30).
 *   열 = status · notify_at · snapshot_id(DDL-3 전이면 NULL).
 */
export function latestDecisionLateralSql(journeyExpr: string, stepExpr: string, snapshotReady: boolean): string {
  return `(SELECT ps_l.status, ps_l.notify_at, ${snapshotReady ? 'ps_l.snapshot_id' : 'NULL::uuid AS snapshot_id'} FROM journey_pretest_schedules ps_l
            WHERE ps_l.journey_id = ${journeyExpr} AND ps_l.step_id = ${stepExpr} AND ps_l.status IN (${DECISION_SQL_LIST})
            ORDER BY ps_l.notify_at DESC, ps_l.id DESC LIMIT 1)`;
}

/**
 * ★ 2026-11-02 E3 — 검사 기록 칸(DDL-3 판 칸 snapshot_id · 안내 원장 칸 notice_sent_at · C84-DDL-2 시도 칸 notice_attempts) 확인 ·
 *   참은 기억 · 거짓은 매 회차 다시(가벼운 조회).
 */
let _snapshotColReady = false;
export async function pretestSnapshotColumnReady(): Promise<boolean> {
  if (_snapshotColReady) return true;
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'journey_pretest_schedules' AND column_name IN ('snapshot_id', 'notice_sent_at', 'notice_attempts')`,
  );
  _snapshotColReady = Number(r.rows[0]?.n || 0) === 3;
  return _snapshotColReady;
}

/** 사람에게 가야 할 안내(보류 · 지연)의 시도 상한(안내 한 통 꼴 · journey-notice-once 와 같은 값) */
export const PRETEST_NOTICE_MAX_ATTEMPTS = NOTICE_MAX_ATTEMPTS;
/** 안내 원장 한 회차 처리 수(실패 행은 시도 3번 뒤 빠지므로 앞자리를 영구히 막지 않는다) */
export const PRETEST_NOTICE_BATCH = 50;
/** ★ 2026-10-31 §2-8 — 묶음 처리 예외(기록 쓰기 실패 등)를 같은 묶음에서 몇 번까지 다시 보는가(그 뒤 = 그날 그 묶음을 더 처리하지 않음 + 운영 경보 · 유료 재검사 반복 0). */
export const PRETEST_BUNDLE_EXCEPTION_MAX = 3;
const _bundleExceptions = new Map<string, number>();

/** ★ 2026-10-25 #2 — 한 회차에 보는 묶음 수(묶음 = 여정 · 칸 · 발송일 · 이른 발송부터 · 회차가 길어지면 다음 회차는 건너뛴다(워커 달리는 중 가드) · 남은 묶음은 다음 회차가 이른 순으로). */
export const PRETEST_SCAN_BUNDLE_LIMIT = 300;
/** ★ 2026-10-31 앞보기 창(시간) — 스캔 후보 창 · 날짜 기준 여정이 실행 행을 앞서 만드는 시간(journey-anchor-scheduler)이 같은 값. */
export const PRETEST_LEAD_HOURS = 2;
// ── 안내 시도 칸(journey_pretest_schedules.notice_attempts · DDL C84-DDL-2) 확인 — 참은 기억 · 거짓은 5분 뒤 다시(journey-lineage 와 같은 규약) ──
let _attemptsReady = false;
let _attemptsAbsentUntil = 0;
const ATTEMPTS_RECHECK_MS = 5 * 60 * 1000;
export async function noticeAttemptsReady(): Promise<boolean> {
  if (_attemptsReady) return true;
  if (Date.now() < _attemptsAbsentUntil) return false;
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'journey_pretest_schedules' AND column_name = 'notice_attempts'`,
  );
  const ok = Number(r.rows[0]?.n || 0) === 1;
  if (ok) _attemptsReady = true;
  else _attemptsAbsentUntil = Date.now() + ATTEMPTS_RECHECK_MS;
  return ok;
}
/** 시험 전용. */
export function resetPretestScanMemory(attemptsReady?: boolean, snapshotColumnReady?: boolean): void {
  _snapshotColReady = snapshotColumnReady !== false;
  _bundleExceptions.clear();
  _attemptsReady = attemptsReady === true;
  _attemptsAbsentUntil = attemptsReady === false ? Date.now() + ATTEMPTS_RECHECK_MS : 0;
}

/**
 * 발송 2시간 전 스캔 + 스팸테스트. 5분 cron worker가 호출.
 */
export async function scanAndPretest(): Promise<{
  scanned: number; bundles: number; tested: number; passed: number; regenerated: number; held: number; notified: number;
}> {
  const startedAt = Date.now();
  const summary = { scanned: 0, bundles: 0, tested: 0, passed: 0, regenerated: 0, held: 0, notified: 0 };

  // ★ 2026-11-01 B1-4 — 재작성 후보 정리(10분 넘은 만드는 중 = 실패 · 실패 후보의 실제 차감 = 크레딧 환불) · 실패해도 스캔은 간다
  await sweepPretestCandidates().catch((e: any) => console.warn('[journey-pretest-scan] 후보 정리 실패:', e?.message || e));

  // 지난 날 묶음의 셈은 버린다(키 끝 = 발송일 KST)
  const today = kstDateOf(new Date());
  for (const k of [..._bundleExceptions.keys()]) if (k.slice(-10) < today) _bundleExceptions.delete(k);
  // ★ 1031 그날 처리를 멈춘 묶음(예외 상한) = SQL 안(LIMIT 앞)에서 뺀다(R12 · 앞자리를 차지하지 않게)
  const halted = [..._bundleExceptions.entries()].filter(([, n]) => n >= PRETEST_BUNDLE_EXCEPTION_MAX).map(([k]) => k);

  // ★ 2026-11-02 E3 — 검사 기록 판 칸(DDL-3)이 없으면 스캔을 열지 않는다(판 보류 · 오늘 시도 수를 판으로 못 센다 = 유료 반복 위험).
  //   그동안 새 글 · 고친 글은 실행기가 기다리고(검사 없이 안 보냄) 통과한 글은 그대로 나간다 · 운영 경보로 DDL 을 알린다.
  if (!(await pretestSnapshotColumnReady())) {
    void sendSystemAlert({
      companyId: null,
      dedupKey: 'journey-pretest-snapshot-ddl',
      cooldownMs: 6 * 60 * 60 * 1000,
      message: '여정 발송 전 검사 기록에 판 칸 · 안내 칸(journey_pretest_schedules.snapshot_id · notice_sent_at)이 없어 검사 스캔을 멈췄습니다. 엔진 재설계 C93-DDL-3 실행이 필요합니다(고친 문안 발송은 검사 전까지 기다립니다).',
    }).catch(() => undefined);
    return summary;
  }
  // ★ E3-3 — 옛 「통과 · 안내 전」 기록은 문자 없이 마침으로(검사 통과 문자 폐지 · SC-21)
  await query(`UPDATE journey_pretest_schedules SET status = 'notified' WHERE status = 'pending'`)
    .catch((e: any) => console.warn('[journey-pretest-scan] 옛 안내 전 기록 정리 실패(다음 회차 다시):', e?.message || e));
  // ★ Codex 구현 1R(R14) — 사람에게 가야 할 안내는 검사 · 결정과 따로: 지연 감지(검사 시도 상한 · 확인 중과 무관) → 안내 원장 보내기(실패 = 다음 회차 · 3번)
  await detectLateNewCopy().catch((e: any) => console.warn('[journey-pretest-scan] 지연 감지 실패(다음 회차 다시):', e?.message || e));
  await deliverPendingNotices().catch((e: any) => console.warn('[journey-pretest-scan] 안내 보내기 실패(다음 회차 다시):', e?.message || e));
  // ★ 2026-11-02 설계서 3-9 — 통과한 글의 7일 정기 재검사 갈래를 지웠다(주간 회사 묶음 검사 journey-weekly-check 가 켜진 문자 칸 판 전부를 본다 · 검사 두 벌 0)

  // 임박 발송(2시간 안) + 다음 step이 message(sms/lms/mms)인 active execution — 칸마다 한 줄(가장 이른 실행).
  //   다음 step = current_step_order보다 큰 최소 step_order (LATERAL). kakao는 스팸필터 무관이라 제외.
  // ★ 2026-10-25 #2(R12) — 거름 · 묶기 · 순서를 전부 SQL 안(LIMIT 앞)에서.
  // ★ 2026-11-02 E3-2 — 고를 칸 = ① 새 글 · 고친 글(표식 < 100 · 지금 판 보류 아님) ③ 지금 판 보류 재검사(보류 7일 지남 · 4번까지) · 지금 판 오늘 시도 6번 찬 칸 = 뺌.
  const bounds = messageStepBoundsSql('je.journey_id');
  const heldNow = `(b.last_status = 'held' AND b.last_snapshot_id IS NOT DISTINCT FROM b.snapshot_id)`;
  const rowsRes = await query(
    `SELECT b.* FROM (
       SELECT DISTINCT ON (je.journey_id, s.id)
              je.id AS execution_id, je.journey_id, je.next_run_at,
              j.company_id, j.created_by, j.start_kind,
              s.id AS step_id, s.step_order, s.channel, s.is_ad, s.subject, s.notify_manager_on_pretest,
              s.delay_mode, s.delay_hours,
              ${bounds.first} AS first_message_order, ${bounds.last} AS last_message_order,
              snap.id AS snapshot_id, snap.created_at AS snapshot_created_at, COALESCE(snap.confidence, 100) AS confidence,
              dec.status AS last_status, dec.snapshot_id AS last_snapshot_id, dec.notify_at AS last_at,
              (SELECT COUNT(*)::int FROM journey_pretest_schedules pe
                WHERE pe.journey_id = je.journey_id AND pe.step_id = s.id AND pe.status = 'error'
                  AND pe.snapshot_id IS NOT DISTINCT FROM snap.id AND pe.notify_at >= ${KST_TODAY_START_SQL}) AS errors_today,
              (SELECT COUNT(*)::int FROM journey_pretest_schedules ph
                WHERE ph.journey_id = je.journey_id AND ph.step_id = s.id AND ph.status = 'held'
                  AND ph.snapshot_id IS NOT DISTINCT FROM snap.id) AS held_count
         FROM journey_executions je
         JOIN journeys j ON j.id = je.journey_id AND j.status = 'active'
         JOIN LATERAL (
           SELECT id, step_order, step_type, channel, is_ad, subject, notify_manager_on_pretest, delay_mode, delay_hours
             FROM journey_steps
            WHERE journey_id = je.journey_id AND step_order > je.current_step_order
            ORDER BY step_order ASC LIMIT 1
         ) s ON TRUE
         LEFT JOIN LATERAL ${latestSnapshotSql('je.journey_id', 's.id')} snap ON TRUE
         LEFT JOIN LATERAL (
           SELECT ps.status, ps.snapshot_id, ps.notify_at FROM journey_pretest_schedules ps
            WHERE ps.journey_id = je.journey_id AND ps.step_id = s.id AND ps.status IN (${DECISION_SQL_LIST})
            ORDER BY ps.notify_at DESC, ps.id DESC LIMIT 1
         ) dec ON TRUE
        WHERE je.status = 'active'
          AND je.next_run_at > NOW()
          AND je.next_run_at <= NOW() + INTERVAL '${PRETEST_LEAD_HOURS} hours'
          AND COALESCE(s.step_type, 'message') = 'message'
          AND s.channel IN ('sms', 'lms', 'mms')
        ORDER BY je.journey_id, s.id, je.next_run_at ASC
     ) b
     WHERE b.errors_today < ${PRETEST_ERROR_DAILY_MAX}
       AND NOT ((b.journey_id::text || ':' || b.step_id::text || ':' || ((b.next_run_at AT TIME ZONE 'Asia/Seoul')::date)::text) = ANY($1::text[]))
       AND (
         (b.confidence < 100 AND NOT ${heldNow})
         OR (${heldNow} AND b.last_at < NOW() - INTERVAL '${PRETEST_RECHECK_DAYS} days' AND b.held_count < ${PRETEST_HELD_RECHECK_MAX})
       )
     ORDER BY b.next_run_at ASC
     LIMIT ${PRETEST_SCAN_BUNDLE_LIMIT}`,
    [halted],
  );
  summary.scanned = rowsRes.rows.length;
  if (rowsRes.rows.length === 0) return summary;

  const bundles = groupPretestBundles(rowsRes.rows as PretestScanRow[]);
  summary.bundles = bundles.length;

  const bundleFailures: PassFailure[] = [];
  for (const b of bundles) {
    const testedBefore = summary.tested;
    try {
      await processBundle(b, summary);
    } catch (bundleErr: any) {
      // ★ 1031 §2-8 — 이 호출에서 유료 검사를 한 뒤의 예외만 센다(기록 쓰기 실패가 같은 묶음의 유료 재검사를 무한히 부르지 않게 · R8).
      //   ★ Codex 구현 1R ② — 검사 전 예외(읽기 실패) · pending 안내 갈래(검사 0 · 안내 시도 상한 = DB notice_attempts)는 세지 않는다.
      //   옛: 그것까지 세어 멈춘 묶음이 SQL 에서 빠지면 DB 가 돌아와도 pending 이 그날 내내 남아 발송이 막혔다(포기 갈래에 닿지 못함).
      if (summary.tested === testedBefore) {
        console.log(`[journey-pretest-scan] bundle 처리 실패(검사 전 · 안내 갈래 · 다음 회차 다시) journey=${b.journeyId} step=${b.stepId} — ${bundleErr?.message || bundleErr}`);
        continue;
      }
      const n = (_bundleExceptions.get(b.bundleKey) || 0) + 1;
      _bundleExceptions.set(b.bundleKey, n);
      console.log(`[journey-pretest-scan] bundle 처리 실패 ${n}/${PRETEST_BUNDLE_EXCEPTION_MAX} journey=${b.journeyId} step=${b.stepId} — ${bundleErr?.message || bundleErr}`);
      if (n >= PRETEST_BUNDLE_EXCEPTION_MAX) {
        bundleFailures.push({ companyId: b.companyId, key: b.bundleKey, error: String(bundleErr?.message || bundleErr).slice(0, 200) });
      }
    }
  }
  // ★ 2026-11-02 설계 §17-4 C1 — 한 주기 1통(옛: 반복문 catch 에서 여정마다 1통 · 여정 키라 같은 여정의 다른 칸은 6시간 묻혔다 · 계약 ⑥ 이 타이머 없는 파일이라 못 봤다)
  if (bundleFailures.length > 0) {
    await alertPassFailures({
      pass: 'journey-pretest-bundle-error',
      title: `여정 발송 전 검사 묶음 처리가 ${PRETEST_BUNDLE_EXCEPTION_MAX}번 실패해 오늘 그 칸 검사를 멈췄습니다(그 칸 문자는 검사 기록이 생길 때까지 나가지 않습니다).`,
      action: '서버 로그 [journey-pretest-scan] bundle 처리 실패 줄의 여정 · 칸으로 확인해 주세요.',
      failures: bundleFailures, total: bundles.length,
    }).catch(() => undefined);
  }

  // 이번 회차에 생긴 보류 안내도 같은 회차에(같은 원장 · 같은 상한)
  await deliverPendingNotices().catch((e: any) => console.warn('[journey-pretest-scan] 안내 보내기 실패(다음 회차 다시):', e?.message || e));
  console.log(`[journey-pretest-scan] 완료 — scanned=${summary.scanned} bundles=${summary.bundles} tested=${summary.tested} passed=${summary.passed} regen=${summary.regenerated} held=${summary.held} notified=${summary.notified} ms=${Date.now() - startedAt}`);
  return summary;
}

/** 묶음 하나 = 상태표(§2-8 · ★ 2026-11-02 E3-3 결과표). 지금 판 · 가장 최근 결정 · 오늘 시도 수는 스캔이 묶음에 실어 준다. */
async function processBundle(b: PretestBundle, summary: ScanSummary): Promise<void> {
  // 최신 snapshot 본문 (executor가 실제 발송하는 본문).
  //   ★ 2026-10-19 B-1009-6 — 재검사 전 판(confidence_score < 100 · 켜진 여정 수정본)은 검사를 기다린다(새 글은 검사 없이 안 보냄).
  const snapRes = await query(
    `SELECT snap.id, snap.message_body, snap.message_subject, snap.confidence FROM ${latestSnapshotSql('$2::uuid', '$1::uuid')} snap`,
    [b.stepId, b.journeyId]
  );
  const snap = snapRes.rows[0];
  const snapId: string | null = snap?.id ? String(snap.id) : null;
  const unchecked = !!snap && snap.confidence != null && Number(snap.confidence) < 100;

  // ★ 2026-10-25 #1(R5) — 이 칸이 보낼 수 있는 판(변이가 있으면 변이마다) = 실행기 · 켜기 검사와 같은 목록(journey-step-versions).
  const stepRow = await query(`SELECT message_template, subject FROM journey_steps WHERE id = $1::uuid`, [b.stepId]);
  const variantRows = await loadStepVariantRows(b.stepId);
  const versions = stepSendVersions(
    { message_template: stepRow.rows[0]?.message_template ?? null, subject: stepRow.rows[0]?.subject ?? b.subject },
    snap ?? null,
    variantRows,
  );
  const body = String(versions[0]?.body || '').trim();

  if (variantRows.length === 0 && (!snap || !body)) {
    await recordIfCurrent(b, snapId, { status: 'cancelled' });
    return;
  }

  // ★ 2026-11-02 설계서 3-3 ② · 3-13 — 보낼 글 판정(CT-J10 · 실행기 · 켜기와 같은 함수)이 걸리면 유료 스팸 검사 전에 그 판 보류(검사 0원 · 안내 = 고칠 곳 문구)
  const trig = (await query(`SELECT trigger_event FROM journeys WHERE id = $1::uuid`, [b.journeyId])).rows[0]?.trigger_event ?? null;
  if (journeyCopyIssue({ bodies: versions.map((v) => v.body), subjects: versions.map((v) => v.subject) }, await journeyCopyContext(b.companyId, trig, versions.map((v) => v.body)))) {
    await holdCurrent(b, summary, snapId, body);
    return;
  }

  // ★ 2026-11-01 B1-4 — 이 판의 재작성 후보(DDL-D)가 있으면 원문을 다시 보지 않는다:
  //   만드는 중 = 기다림 · 검사 중(testing) = 후보 검사를 이어 봄 · 끝난 실패 = 그 판 보류(★ 1102 E3-3 · 여정 멈춤 0) · 통과 = 그 판에 반영됐다.
  // ★ 2026-11-02 E3-2 ③ — 보류 재검사(7일 지난 지금 판 보류)는 실패 후보로 일찍 끝내지 않고 원문을 다시 검사한다(설계 2R D2-3).
  const candOn = !b.recheckHeld && !!snapId && variantRows.length === 0 && (await candidatesReady().catch(() => false));
  const cand = candOn ? await readCandidate(snapId!) : null;
  if (cand && cand.status === 'generating' && !cand.stale) return;
  if (cand && (cand.status === 'failed' || cand.status === 'blocked' || cand.status === 'generating')) {
    if (cand.status === 'generating') await moveCandidate(snapId!, ['generating'], 'failed');
    await holdCurrent(b, summary, snapId, body);
    return;
  }

  // ★ 2026-06-06: 2시간전 재검도 활성화 검증과 같은 회신번호로 테스트 — 빈 callback이면 테스트 발송이 실패해 오탐 정지 위험.
  const cbRes = await query(`SELECT regexp_replace(callback_number, '[^0-9]', '', 'g') AS cb FROM journeys WHERE id = $1::uuid`, [b.journeyId]);   // ★ 1019 B-1005-5② 같은 뿌리(숫자만)
  const stepCallback = String(cbRes.rows[0]?.cb || '');
  if (cand && cand.status === 'testing' && cand.body) {
    await testCandidate(b, summary, snapId!, cand.body, cand.subject, body, stepCallback, unchecked);
    return;
  }
  summary.tested++;
  const tests = [];
  for (const v of versions) {
    tests.push(await runStepSpamTest({
      companyId: b.companyId, userId: b.createdBy || '',
      body: v.body, subject: v.subject,
      channel: b.channel, isAd: b.isAd, callbackNumber: stepCallback, journeyId: b.journeyId,
      variantId: v.variantId || undefined,
      // ★ 2026-11-02 E3-2 — 같은 글의 진행 중 · 7일 안 결과를 다시 쓴다(정기 재검사가 하루를 넘겨도 새 검사 · 새 차감 0 · SC-18)
      reuseDays: PRETEST_RECHECK_DAYS,
    }));
  }
  const r1 = tests[0];
  // 판 전부의 판정(켜기 검사와 같은 함수 · 전부 통과일 때만 통과 · ★ 1101 B1-4 차단 > 장애 > 확인 중 > 검사 중)
  const verdict = mergeSpamVerdicts(tests.map((t) => t.verdict));

  // 통과 → 그 판 = 검사 통과(confidence_score 100) + 결정 기록 notified(★ 1102 E3-3 · 담당자 문자 0 · 주간 요약 · 상황판이 보인다)
  if (verdict === 'pass') {
    summary.passed++;
    await recordIfCurrent(b, snapId, { status: 'notified', markChecked: true });
    return;
  }

  // ★ 2026-11-01 B1-4 — 확인 중 · 검사 중 = 자동 행동 0(재작성 · 보류 · 기록 · 장애 셈 없음) · 다음 회차에 같은 글 = 같은 검사를 이어 본다(차감 0).
  if (isSpamHold(verdict)) {
    console.log(`[journey-pretest-scan] 스팸 검사 ${verdict === 'pending' ? '진행 중' : '확인 중'}(다음 회차에 이어 봄) journey=${b.journeyId} step=${b.stepId}`);
    return;
  }

  if (verdict === 'error' || verdict === 'rejected') {
    const why = tests.map((t) => t.error).filter(Boolean).join(' · ');
    if (verdict === 'rejected') alertPretestRejected(b, why);   // ★ 2026-11-06 C109 E11 — 도달 불가 갈래 · 장애 기록 + 경보 · held 0
    await onCheckError(b, snapId, unchecked, body, why);
    return;
  }
  void (verdict satisfies 'blocked');

  // ★ 2026-11-02 E3-2 ③ — 보류 재검사가 또 막힘 = 새 보류 기록(이미 보류라 안내 0)
  if (b.recheckHeld) {
    const w = await recordIfCurrent(b, snapId, { status: 'held', noticeDone: true });
    if (w.current) summary.held++;
    return;
  }

  // ★ 2026-10-25 #1 — 변이 칸은 자동으로 고치지 않는다(모르는 문안으로 바꾸지 않는다 · 덜 보내는 방향) · ★ 1102 = 그 판 보류(여정 멈춤 0)
  if (variantRows.length > 0) {
    await holdCurrent(b, summary, snapId, body);
    return;
  }

  // ★ 2026-10-25 Codex 1R(R5) — 원 문안 차단 확인 = 그 판을 바로 「검사 전」(0)으로 내린다. 실행기는 검사 전 판을 보내지 않고 기다린다.
  //   고친 문안이 통과할 때만 100(아래) · 고친 문안 검사 장애로 다시 볼 때도 보류 유지.
  await recordIfCurrent(b, snapId, { markUnchecked: true });

  // ★ 2026-11-01 B1-4 — 확정 차단의 재작성 = 판마다 한 번(후보 표 · claim · 차감 키 고정). 표가 없으면(DDL 전) 재작성 없이 보류(차감 0).
  if (!candOn) {
    await holdCurrent(b, summary, snapId, body);
    return;
  }
  const claim = await claimCandidate(b.journeyId, b.stepId, snapId!);
  if (claim === 'stale') return;   // 그사이 사람이 새 판을 커밋 — AI 호출 전에 끝(차감 0) · 다음 회차가 새 판을 본다
  if (claim === 'taken') {
    // ★ Codex 구현 1R #4 — 「이미 있음」은 실패가 아니다. 다시 읽어 상태대로: 만드는 중(다른 손) = 기다림 · 검사 중 = 이어 봄 ·
    //   통과(고친 문안이 반영된 판이 다시 막힘 · 재작성 상한 1) · 차단 · 실패 = 보류
    const again = await readCandidate(snapId!);
    if (!again || (again.status === 'generating' && !again.stale)) return;
    if (again.status === 'testing' && again.body) {
      await testCandidate(b, summary, snapId!, again.body, again.subject, body, stepCallback, true);
      return;
    }
    if (again.status === 'generating') await moveCandidate(snapId!, ['generating'], 'failed');
    await holdCurrent(b, summary, snapId, body);
    return;
  }

  // 진짜 스팸 걸림 → 1회 재생성(1크레딧 · 차감 키 = 판) — 정산 직전에 이 후보가 아직 내 것인지 다시 읽는다(만료 · 다른 손이면 0원)
  let regenBody: string | null = null;
  try {
    regenBody = await regenerateStepAvoidingSpam({
      // ★ 1101 B1-3 — 그 여정의 사람 값 원장(혜택 · 링크)을 근거로(없으면 원문만 · DDL 전 = 옛 동작)
      companyId: b.companyId, currentMessage: body, copyFacts: await readJourneyCopyFacts(b.companyId, b.journeyId).catch(() => null),
      channel: b.channel, isAd: b.isAd, matchedStopWords: r1.matchedStopWords || [],
    }, { idempotencyKey: regenChargeKey(b.companyId, snapId!), stillMine: () => candidateStillMine(snapId!, claim.token) });
  } catch (regenErr: any) {
    console.log(`[journey-pretest-scan] 재생성 실패 journey=${b.journeyId} step=${b.stepId} — ${regenErr?.message || regenErr}`);
  }
  // ★ 2026-11-01 배포 2 C2(Codex 구현 1R #1) — 출구는 재작성 생산자의 정산 안(regenerateStepAvoidingSpam)에서 지난다(못 지나면 null = 0원)
  if (!regenBody || !regenBody.trim() || regenBody.trim() === body) {
    // ★ Codex 구현 3R — 이 후보가 더는 내 것이 아니면(만료 · 다른 손 · 사람이 새 판) 생성 실패가 아니다 = 아무것도 안 하고 끝(차감 0 · 보류 · 안내 0)
    if (!(await candidateStillMine(snapId!, claim.token).catch(() => false))) {
      console.log(`[journey-pretest-scan] 재작성 후보를 잃음(만료 · 다른 손) · 결과 버림 journey=${b.journeyId} step=${b.stepId}`);
      return;
    }
    // 재생성으로 고친 글이 없다 → 후보 실패 · 그 판 보류 + 담당자 안내(그 판이 아직 최신일 때만)
    await moveCandidate(snapId!, ['generating'], 'failed');
    await holdCurrent(b, summary, snapId, body);
    return;
  }
  summary.regenerated++;
  const candSubject = versions[0]?.subject ?? null;
  // 저장 = 아직 내 claim 일 때만(만료로 넘어갔으면 0행 — 그 판은 다음 회차가 실패로 보류한다)
  if (!(await saveCandidate(snapId!, claim.token, regenBody, candSubject))) return;
  await testCandidate(b, summary, snapId!, regenBody, candSubject, body, stepCallback, true);
}

/**
 * ★ 2026-11-02 E3-3 — 검사 장애 = 시도 기록(error · 판 · DB 셈 · 하루 6번이면 스캔이 뺀다) · 여정 멈춤 0.
 *   이 스캔이 고르는 판 = 새 글 · 고친 글 · 보류 재검사뿐(★ 2026-11-02 통과한 글 정기 재검사 · 그 「확인 못 함」 갈래 지움 = 주간 묶음 검사 몫 · 설계서 3-9)
 *   = 기다림(검사 없이 안 보냄) · 2시간 넘게 못 끝난 새 글 안내 = detectLateNewCopy(검사 상한과 무관 · Codex 구현 1R).
 */
/**
 * ★ 2026-11-06 C109 E11(Codex 설계 3R #1) — 사전 검사의 글자 반려 = 구조로 도달 불가(검사 입력 = 렌더 뒤 정리 · 렌더 표식 · 계약 시험 K8).
 *   그래도 오면 코드 회귀다 → 장애 기록(onCheckError · 하루 상한) + 운영 경보 한 통 · 결정 기록 held 는 쓰지 않는다
 *   (held = 주간 묶음이 원문 검사를 건너뛰고 유료 재작성을 돌리는 결정 · 같은 글은 고쳐도 같은 반려라 비용만 나간다).
 */
function alertPretestRejected(b: PretestBundle, rejection: string | undefined): void {
  void sendSystemAlert({
    companyId: b.companyId,
    dedupKey: `journey-pretest-rejected:${b.journeyId}:${b.stepId}`,
    title: '여정 발송 전 검사가 보낼 수 없는 글자로 반려되었습니다(정리된 검사 글이라 오면 안 되는 갈래 · 코드 확인 필요).',
    details: [`사유: ${rejection || '보낼 수 없는 글자'}`, `journey=${b.journeyId} step=${b.stepId}`],
    action: '검사 입력 정리(stepSpamInput) · 렌더 표식을 확인해 주세요. 그 판은 검사 장애로 세어 하루 상한 뒤 멈춥니다.',
  }).catch(() => undefined);
}

async function onCheckError(b: PretestBundle, snapId: string | null, _unchecked: boolean, _preview: string, why: string): Promise<void> {
  const w = await recordIfCurrent(b, snapId, { status: 'error' });
  if (!w.current) return;
  const n = b.errorsToday + 1;
  console.log(`[journey-pretest-scan] 스팸 검사 장애 ${n}/${PRETEST_ERROR_DAILY_MAX}(오늘 이 판) journey=${b.journeyId} step=${b.stepId} — ${why}`);
}

/**
 * ★ Codex 구현 1R(R14) — 새 글 · 고친 글이 2시간 넘게 검사를 못 끝냈다 = 판마다 지연 기록 한 줄(late · 안내 원장 = 보낼 것).
 *   기다림의 시작 = 스캔이 보낼 때가 가까운 그 판을 처음 본 시각(seen · 판마다 한 줄 · 결정 아님) — 판 생성 시각으로 재면 하루 전에 고쳤지만
 *   지금 처음 검사하는 판이 곧바로 지연이 된다(1102 실 PG 시험이 잡음).
 *   검사 시도 상한(하루 6번) · 확인 중 · 검사 중과 무관하게 본다(옛: 검사 장애 갈래에서만 봐 상한에 걸리면 안내가 영영 안 갔다).
 *   지금 판이 보류면 보류 안내가 맡는다.
 */
async function detectLateNewCopy(): Promise<void> {
  const waiting = `
       FROM journey_executions je
       JOIN journeys j ON j.id = je.journey_id AND j.status = 'active'
       JOIN LATERAL (SELECT id, channel FROM journey_steps
                      WHERE journey_id = je.journey_id AND step_order > je.current_step_order ORDER BY step_order ASC LIMIT 1) s ON TRUE
       JOIN LATERAL ${latestSnapshotSql('je.journey_id', 's.id')} snap ON TRUE
      WHERE je.status = 'active'
        AND je.next_run_at <= NOW() + INTERVAL '${PRETEST_LEAD_HOURS} hours'
        AND s.channel IN ('sms', 'lms', 'mms')
        AND snap.confidence < 100
        AND NOT ${stepHeldSql('je.journey_id', 's.id')}`;
  const mark = (status: 'seen' | 'late', extra: string) => `
     INSERT INTO journey_pretest_schedules (company_id, journey_id, step_id, execution_id, scheduled_send_at, notify_at, status, snapshot_id)
     SELECT DISTINCT ON (je.journey_id, s.id) j.company_id, je.journey_id, s.id, je.id, je.next_run_at, NOW(), '${status}', snap.id
     ${waiting}
        AND NOT EXISTS (SELECT 1 FROM journey_pretest_schedules px
                         WHERE px.journey_id = je.journey_id AND px.step_id = s.id AND px.status = '${status}' AND px.snapshot_id = snap.id)
        ${extra}
      ORDER BY je.journey_id, s.id, je.next_run_at ASC
     RETURNING company_id`;
  await query(mark('seen', ''));
  const r = await query(mark('late', `AND EXISTS (SELECT 1 FROM journey_pretest_schedules pw
                         WHERE pw.journey_id = je.journey_id AND pw.step_id = s.id AND pw.status = 'seen' AND pw.snapshot_id = snap.id
                           AND pw.notify_at < NOW() - INTERVAL '${PRETEST_LATE_NOTICE_HOURS} hours')`));
  if (r.rows.length > 0) {
    void sendSystemAlert({
      companyId: r.rows[0].company_id,
      dedupKey: 'journey-pretest-new-copy-late',
      cooldownMs: 60 * 60 * 1000,
      message: `고친 여정 문안의 스팸 검사가 ${PRETEST_LATE_NOTICE_HOURS}시간 넘게 끝나지 못한 칸이 ${r.rows.length}개 있습니다(그 칸만 기다림 · 담당자 안내 · 검사 큐 · 시험 폰 상태 확인).`,
    }).catch(() => undefined);
  }
}

/**
 * ★ Codex 구현 1R(R14) — 안내 원장 보내기: 보류(보류로 바뀐 판) · 지연 기록 중 아직 안 보낸 것(notice_sent_at NULL · 시도 < 3).
 *   쓰기 = 안내 한 통 꼴(시도 잡기 → 적재 → 성공 기록) · 3번 다 실패 = 운영 경보(그 여정 · 원인 하나).
 *   ★ Codex 구현 2R(R12) — 아직 유효한가(지금 판 · 보류는 지금 보류 · 지연은 보류 아님 + 미검사)는 시도 잡기 한 문장 안에서 보고, 본문도 그 문장이
 *   잡은 판에서 읽는다(묶음을 먼저 읽고 차례로 보내는 사이 판이 바뀌면 옛 글로 안내했다). 유효하지 않아 못 잡은 행 = 보내지 않고 마감.
 */
const NOTICE_STILL_VALID_SQL = `(ps.snapshot_id IS NOT DISTINCT FROM (SELECT ls_n.id FROM ${latestSnapshotSql('ps.journey_id', 'ps.step_id')} ls_n)
  AND CASE WHEN ps.status = 'held' THEN ${stepHeldSql('ps.journey_id', 'ps.step_id')}
           ELSE NOT ${stepHeldSql('ps.journey_id', 'ps.step_id')}
                AND COALESCE((SELECT ss.confidence_score FROM journey_step_snapshots ss WHERE ss.id = ps.snapshot_id), 100) < 100 END)`;

async function deliverPendingNotices(): Promise<void> {
  const rows = await query(
    `SELECT ps.id, ps.company_id, ps.journey_id, ps.step_id, ps.execution_id, ps.scheduled_send_at, ps.status, ps.snapshot_id,
            j.created_by, j.trigger_event, s.channel, s.is_ad, s.subject
       FROM journey_pretest_schedules ps
       JOIN journeys j ON j.id = ps.journey_id
       JOIN journey_steps s ON s.id = ps.step_id
      WHERE ps.status IN ('held', 'late') AND ps.notice_sent_at IS NULL AND ps.notice_attempts < ${PRETEST_NOTICE_MAX_ATTEMPTS}
      ORDER BY ps.notify_at ASC, ps.id ASC
      LIMIT ${PRETEST_NOTICE_BATCH}`,
  );
  for (const r of rows.rows as any[]) {
    const sendAt = new Date(r.scheduled_send_at);
    const b = {
      bundleKey: '', journeyId: String(r.journey_id), companyId: String(r.company_id), createdBy: r.created_by ? String(r.created_by) : null,
      stepId: String(r.step_id), channel: r.channel, isAd: resolveJourneyAdFlag(r.channel, r.is_ad), subject: r.subject ?? null, notifyManager: true, immediate: false,
      scheduledSendAt: sendAt, executionId: String(r.execution_id), sendDateKst: kstDateOf(sendAt),
      recheckHeld: false, errorsToday: 0, snapshotCreatedAt: null,
    } as PretestBundle;
    const mode: PretestMode = r.status === 'held' ? 'pretest_held' : 'pretest_late';
    let body = '';
    const result = await sendNoticeOnce({
      claim: async () => {
        const c = await query(
          `UPDATE journey_pretest_schedules ps SET notice_attempts = ps.notice_attempts + 1
            WHERE ps.id = $1::uuid AND ps.notice_sent_at IS NULL AND ps.notice_attempts < $2 AND ${NOTICE_STILL_VALID_SQL}
            RETURNING (SELECT ss.message_body FROM journey_step_snapshots ss WHERE ss.id = ps.snapshot_id) AS body`,
          [r.id, PRETEST_NOTICE_MAX_ATTEMPTS],
        );
        body = String(c.rows[0]?.body || '');
        return c.rows.length > 0;
      },
      enqueue: async () => {
        // ★ 2026-11-02 보류 까닭 = 보낼 글 판정(CT-J10)이 걸리면 그 문구(스팸필터 문구 0) · 아니면 스팸필터
        const copy = mode === 'pretest_held' ? await journeyStepCopyIssueNow(b.companyId, b.journeyId, b.stepId, r.trigger_event) : null;
        // ★ 2026-11-02 설계서 3-9 — 그 판 수정안이 통과해 있으면 「수정안 준비 · [이 글로 보내기]」 문구
        const ready = mode === 'pretest_held' && !copy && r.snapshot_id ? (await readCandidate(String(r.snapshot_id)).catch(() => null))?.status === 'passed' : false;
        const notice = await buildManagerNotice(b, body, mode, copy?.message ?? null, ready);
        return notice ? enqueueManagerNotice(notice, b.companyId) : true;   // 받을 담당자 없음 · 시연 회사 = 보낼 것 없음(마감)
      },
      finalize: async () => (await query(
        `UPDATE journey_pretest_schedules SET notice_sent_at = NOW() WHERE id = $1::uuid AND notice_sent_at IS NULL RETURNING id`, [r.id],
      )).rows.length > 0,
    });
    if (result === 'sent') { console.log(`[journey-pretest-scan] 담당자 안내(${mode}) journey=${r.journey_id} step=${r.step_id}`); continue; }
    if (result === 'not_claimed') {
      // 보류가 풀렸거나 · 판이 바뀌었거나 · 검사가 끝났다 = 보낼 것 없음(마감 · 시도를 다 쓴 유효한 행은 그대로 둬 경보가 맡는다)
      await query(`UPDATE journey_pretest_schedules ps SET notice_sent_at = NOW() WHERE ps.id = $1::uuid AND ps.notice_sent_at IS NULL AND NOT ${NOTICE_STILL_VALID_SQL}`, [r.id]);
      continue;
    }
    if (result === 'enqueue_failed') {
      const left = await query(`SELECT notice_attempts FROM journey_pretest_schedules WHERE id = $1::uuid`, [r.id]);
      if (Number(left.rows[0]?.notice_attempts || 0) >= PRETEST_NOTICE_MAX_ATTEMPTS) {
        void sendSystemAlert({
          companyId: b.companyId,
          dedupKey: `journey-pretest-notice-giveup:${b.journeyId}`,
          message: `여정 담당자 안내(${mode === 'pretest_held' ? '발송 보류' : '검사 지연'})를 ${PRETEST_NOTICE_MAX_ATTEMPTS}번 보내지 못했습니다(문자 큐 · 담당자 번호 확인 · 상황판에는 보입니다). journey=${b.journeyId} step=${b.stepId}`,
        }).catch(() => undefined);
      }
    }
  }
}

/**
 * ★ 2026-11-01 B1-4 — 재작성 후보 검사(만든 회차 · 다음 회차 이어 보기 공용) — 확인 중 · 검사 중 = 다음 회차 · 장애 = 시도 기록(하루 6번) ·
 *   통과 = 먼저 알리고 알린 뒤에만 그 판 본문을 바꾼다(그사이 사람이 고쳤으면 안 바꿈) · 차단 = 그 판 보류(재작성 상한 1 · ★ 1102 여정 멈춤 0).
 */
async function testCandidate(
  b: PretestBundle, summary: ScanSummary,
  snapId: string, candBody: string, candSubject: string | null, origBody: string, stepCallback: string, unchecked: boolean,
): Promise<void> {
  summary.tested++;
  const r2 = await runStepSpamTest({
    companyId: b.companyId, userId: b.createdBy || '',
    body: candBody, subject: candSubject,
    channel: b.channel, isAd: b.isAd, callbackNumber: stepCallback, journeyId: b.journeyId,
  });
  if (isSpamHold(r2.verdict)) {
    console.log(`[journey-pretest-scan] 고친 문안 스팸 검사 ${r2.verdict === 'pending' ? '진행 중' : '확인 중'}(다음 회차에 이어 봄) journey=${b.journeyId} step=${b.stepId}`);
    return;
  }
  if (r2.verdict === 'error' || r2.verdict === 'rejected') {
    // 고친 문안의 검사가 장애 = 고친 문안을 쓰지 않는다(검사 못 한 글) · 원 문안은 차단이라 보낼 수 없다 → 시도 기록 · 하루 상한 뒤 그 판 보류
    if (r2.verdict === 'rejected') alertPretestRejected(b, r2.error);   // ★ 2026-11-06 C109 E11 — 도달 불가 갈래(장애와 같은 길 + 경보)
    await onCheckError(b, snapId, unchecked, origBody, r2.error || 'error');
    if (b.errorsToday + 1 >= PRETEST_ERROR_DAILY_MAX) await holdCurrent(b, summary, snapId, origBody);
    return;
  }
  if (r2.verdict === 'pass') {
    // ★ 2026-11-02 설계서 3-9 — 수정안 통과 = 원문은 바꾸지 않는다(사람이 상황판 · 화면에서 [이 글로 보내기]를 눌러야 반영 · CT-J12 applyPassedCandidate).
    //   그 판은 보류 유지 + 담당자 안내(수정안 준비) · 옛 「안내 뒤 자동 반영」 갈래(판 확인 쓰기의 본문 덮어쓰기 칸) 지움 · 메모리 「고객 문안 불변」.
    if (await moveCandidate(snapId, ['testing'], 'passed')) summary.passed++;
    await holdCurrent(b, summary, snapId, origBody);
    return;
  }
  void (r2.verdict satisfies 'blocked');
  // 고친 문안도 막힘 → 그 판 보류 + 담당자 안내(재작성 상한 1)
  await moveCandidate(snapId, ['testing'], 'blocked');
  await holdCurrent(b, summary, snapId, origBody);
}

/**
 * ★ 2026-11-02 E3-3 — 그 판 보류(옛 pauseCurrent = 여정 멈춤 → 칸 · 판만 보류 · 여정의 다른 칸은 그대로 나간다).
 *   판 확인 · 직전 결정 읽기 · 보류 기록 = 한 트랜잭션(문안 수정 경로와 같은 journeys 행 잠금 · 사람이 새 판을 커밋했으면 옛 판 결과로 보류하지 않는다).
 *   안내 = 「보류가 아니던 칸이 보류로 바뀔 때」 한 번(같은 판 보류가 이어지면 문자 0 · 설계 1R D1-6).
 */
async function holdCurrent(b: PretestBundle, summary: { held: number }, snapId: string | null, preview: string): Promise<void> {
  const prev = await withTransaction(async (run) => {
    const lock = await run(`SELECT id FROM journeys WHERE id = $1::uuid FOR UPDATE`, [b.journeyId]);
    if (lock.rows.length === 0) return null;
    if ((await latestSnapshotIdTx(run, b)) !== snapId) return null;
    const last = await run(
      `SELECT status, snapshot_id FROM journey_pretest_schedules
        WHERE journey_id = $1::uuid AND step_id = $2::uuid AND status IN (${DECISION_SQL_LIST})
        ORDER BY notify_at DESC, id DESC LIMIT 1`,
      [b.journeyId, b.stepId],
    );
    const row = last.rows[0];
    const wasHeld = !!row && String(row.status) === 'held' && String(row.snapshot_id ?? '') === String(snapId ?? '');
    // ★ Codex 구현 1R(R14) — 안내 원장: 보류로 바뀐 판 = 보낼 것(notice_sent_at NULL) · 같은 판 보류가 이어짐 = 보낼 것 없음(NOW())
    await run(
      `INSERT INTO journey_pretest_schedules (company_id, journey_id, step_id, execution_id, scheduled_send_at, notify_at, status, snapshot_id, notice_sent_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, NOW(), 'held', $6::uuid, CASE WHEN $7::boolean THEN NOW() ELSE NULL END)`,
      [b.companyId, b.journeyId, b.stepId, b.executionId, b.scheduledSendAt, snapId, wasHeld],
    );
    return { wasHeld };
  });
  if (!prev) {
    console.log(`[journey-pretest-scan] 그사이 문안이 바뀌어 옛 판 결과로 보류하지 않음 journey=${b.journeyId} step=${b.stepId}`);
    return;
  }
  summary.held++;
  void preview;   // 안내 본문 = 보낼 때 그 판 본문(안내 원장 패스)
}

/**
 * ★ 2026-11-02 설계서 3-3 ① · 3-13 — 실행기가 보낼 글 판정(CT-J10)에 걸린 칸을 보류(보내기 전 검사의 보류와 같은 기록 · 안내 원장 · 여정 멈춤 0).
 *   반환 = 그 판이 최신이라 보류를 남겼는가(그사이 새 판이 커밋됐으면 false · 다음 회차가 새 판을 본다).
 */
export async function holdStepForCopyIssue(at: { companyId: string; journeyId: string; stepId: string; executionId: string; scheduledSendAt: Date }, snapId: string | null): Promise<boolean> {
  const summary = { held: 0 };
  await holdCurrent(at as PretestBundle, summary, snapId, '');
  return summary.held > 0;
}

/** 그 칸의 최신 판 id(트랜잭션 안 · 판 확인 쓰기 · 판 확인 정지 공용) */
async function latestSnapshotIdTx(run: (sql: string, params?: any[]) => Promise<{ rows: any[] }>, b: PretestBundle): Promise<string | null> {
  const latest = await run(
    `SELECT snap.id FROM ${latestSnapshotSql('$2::uuid', '$1::uuid')} snap`,
    [b.stepId, b.journeyId],
  );
  return latest.rows[0]?.id ? String(latest.rows[0].id) : null;
}

export interface RecordWrite {
  /** 남길 기록 상태(없으면 표식 · 본문만) */
  status?: 'notified' | 'cancelled' | 'held' | 'unverified' | 'error';
  /** 검사한 스냅숏 = 통과(100) */
  markChecked?: boolean;
  /** 검사한 스냅숏 = 검사 전(0 · 원 문안 차단) */
  markUnchecked?: boolean;
  /** ★ Codex 구현 1R(R14) — 이 기록은 보낼 안내가 없다(안내 원장 마감 · 이미 보류인 판의 재검사 보류) */
  noticeDone?: boolean;
}

/**
 * ★ 2026-10-31 판 확인 쓰기(설계서 §2-8 · Codex 설계 8R) — 스캔이 남기는 기록 · 스냅숏 표식 · 자동 보정 본문 쓰기는 전부 이 함수 하나.
 *   한 트랜잭션: ① 문안 수정 경로(withJourneyValidationReset)와 같은 journeys 행 FOR UPDATE(잠그는 순서 같음)
 *   ② 그 칸의 최신 스냅숏 id = 검사한 스냅숏 id(스냅숏 없이 검사한 묶음 = 둘 다 없음)일 때만 ③ 쓰기.
 *   다르면 아무것도 안 쓴다(그사이 사람이 문안을 고쳤다 · 옛 판 결과 버림 · 다음 회차가 최신 판을 본다).
 *   → 수정 커밋 뒤에 생기는 기록은 늘 최신 판을 검사한 것(옛 판 기록이 새 판 관문을 여는 갈래 0). 스팸 검사 · AI · MySQL 은 이 잠금 밖.
 */
export async function recordIfCurrent(b: PretestBundle, testedSnapshotId: string | null, w: RecordWrite): Promise<{ current: boolean; recordId: string | null }> {
  return withTransaction(async (run) => {
    const lock = await run(`SELECT id FROM journeys WHERE id = $1::uuid FOR UPDATE`, [b.journeyId]);
    if (lock.rows.length === 0) return { current: false, recordId: null };
    const latestId = await latestSnapshotIdTx(run, b);
    if (latestId !== testedSnapshotId) {
      console.log(`[journey-pretest-scan] 검사한 판이 최신이 아님(그사이 문안 수정) · 결과 버림 journey=${b.journeyId} step=${b.stepId}`);
      return { current: false, recordId: null };
    }
    if (testedSnapshotId) {
      if (w.markChecked) {
        await run(`UPDATE journey_step_snapshots SET confidence_score = 100 WHERE id = $1::uuid AND confidence_score < 100`, [testedSnapshotId]);
      } else if (w.markUnchecked) {
        await run(`UPDATE journey_step_snapshots SET confidence_score = 0 WHERE id = $1::uuid`, [testedSnapshotId]);
      }
    }
    let recordId: string | null = null;
    if (w.status) {
      // ★ 2026-11-02 E3 — 기록마다 검사한 판 id(DDL-3 · 판 보류 · 오늘 시도 수를 판으로 센다)
      const ins = await run(
        `INSERT INTO journey_pretest_schedules
           (company_id, journey_id, step_id, execution_id, scheduled_send_at, notify_at, status, snapshot_id, notice_sent_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, NOW(), $6, $7::uuid, CASE WHEN $8::boolean THEN NOW() ELSE NULL END)
         RETURNING id`,
        [b.companyId, b.journeyId, b.stepId, b.executionId, b.scheduledSendAt, w.status, testedSnapshotId, w.noticeDone === true],
      );
      recordId = ins.rows[0]?.id ? String(ins.rows[0].id) : null;
    }
    return { current: true, recordId };
  });
}

export interface ManagerNotice { phone: string; body: string; title: string }

async function buildManagerNotice(b: PretestBundle, messagePreview: string, mode: PretestMode, copyIssue: string | null = null, candidateReady = false): Promise<ManagerNotice | null> {
  if (await isDemoCompany(b.companyId)) return null;   // ★ 2026-10-09 시연 회사 = 담당자 문자 0(설계서 docs/2026-10-09-demo-company-design.md §2)
  // ★ 2026-10-28 B-1028-1 — 받는 사람 = 여정을 만든 계정 → 회사 관리자(자동마케팅 · 플래너와 같은 함수 · 뿌리 R1 · R3).
  const contact = await pickOwnerContact(b.companyId, b.createdBy || null);
  if (!contact) return null;

  // ★ 2026-10-18 정지 링크 — 받는 번호 · 발송 날짜를 토큰에 싣고 주소는 # 뒤(설계서 2026-10-18 §3-1).
  //   서명 키가 없으면 발급이 던진다 → 링크 줄만 빼고 안내는 보낸다(B10 · pretest_paused 는 여정이 이미 멈췄다).
  // ★ 2026-10-28 B-1028-1 — 다른 담당자 링크(자동마케팅 멈춤 · 대행 승인 · 충전 승인)와 같이 단축 주소(실패 = 원래 주소).
  let pauseUrl: string | null = null;
  try {
    const pauseToken = await generatePauseToken({
      stepId: b.stepId, executionId: b.executionId, companyId: b.companyId, journeyId: b.journeyId,
      phone: contact.phone, sendDate: b.sendDateKst,
    });
    pauseUrl = await buildJourneyPauseShortUrl(b.companyId, pauseToken);
  } catch (e: any) {
    console.warn(`[journey-pretest-scan] 정지 링크 발급 실패(링크 없이 안내) journey=${b.journeyId}:`, e?.message || e);
  }

  const journeyRes = await query(
    `SELECT j.name AS journey_name, s.step_order
       FROM journeys j JOIN journey_steps s ON s.journey_id = j.id
      WHERE j.id = $1 AND s.id = $2`,
    [b.journeyId, b.stepId]
  );
  const journeyName = journeyRes.rows[0]?.journey_name || '여정 자동 발송';
  const stepOrder = Number(journeyRes.rows[0]?.step_order || 0);

  return {
    phone: contact.phone,
    title: titleForMode(mode).slice(0, 40),
    body: buildPretestLmsBody({
      journeyName, stepOrder, scheduledSendAt: b.scheduledSendAt,
      messagePreview: String(messagePreview).slice(0, 100), pauseUrl, mode, immediate: b.immediate, copyIssue, candidateReady,
    }),
  };
}

/** 안내 한 통 적재 = 상한 있는 연결(★ 1031 §2-8 · 스캐너가 MySQL 에 묶여 멈추지 않게). 반환 = 큐에 한 건 들어갔는가. */
export async function enqueueManagerNotice(notice: ManagerNotice, companyId: string): Promise<boolean> {
  const inserted = await insertNoticeSms(   // ★ 2026-11-06 C109 D6 — 안내 적재 CT(본문 · 제목 글자 정리 · 인증 라인 · 상한 연결 = CT 안 · 표 조회 뒤)
    [[
      notice.phone,                // dest_no
      getPlatformNoticeCallback(), // call_back — ★ 2026-07-09 한줄로 대표번호(옛: 수신자 본인 번호=번호도용차단 미수신)
      notice.body,                 // msg_contents
      'L',                         // msg_type (LMS)
      notice.title,                // title_str
      null,                        // sendreq_time (useNow)
      '',                          // app_etc1
      companyId,                   // app_etc2
      '', '', '',                  // file_name1~3
    ]],
    true,
    undefined,
    { boundedMs: NOTICE_ENQUEUE_TIMEOUT_MS },
  );
  return inserted === 1;
}

function titleForMode(mode: PretestMode): string {
  if (mode === 'pretest_autofixed') return '[발송 전 자동 보정 안내]';
  if (mode === 'pretest_held') return '[발송 보류 안내]';
  return '[검사 지연 안내]';
}

/** ★ 1031 바로 보내는 칸 안내 줄(§2-4) */
export const IMMEDIATE_STEP_NOTICE_LINE = '바로 보내는 칸이라 오늘 이 칸에 닿는 고객에게 이어서 나갑니다. 오늘 남은 발송까지 멈추려면 링크에서 여정 전체 일시정지를 눌러 주세요.';

export function buildPretestLmsBody(params: {
  journeyName: string; stepOrder: number; scheduledSendAt: Date;
  messagePreview: string; pauseUrl: string | null; mode: PretestMode;
  /** ★ 1031 바로 보내는 칸(통과 · 자동 보정 안내에 한 줄) */
  immediate?: boolean;
  /** ★ 2026-11-02 보류 까닭이 보낼 글 판정(CT-J10)이면 그 문장(스팸필터 문구 대신) */
  copyIssue?: string | null;
  /** ★ 2026-11-02 그 판 수정안이 검사를 통과해 있다(설계서 3-9 · 반영 = 상황판 · 화면 [이 글로 보내기]) */
  candidateReady?: boolean;
}): string {
  const dateStr = new Date(params.scheduledSendAt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  // ★ 2026-11-02 E3-3 — 통과 안내 없음 · 보류 = 그 칸만(여정의 다른 칸은 그대로) · 지연 = 고친 문안 검사 2시간
  const head =
    params.mode === 'pretest_autofixed'
      ? '[발송 전 자동 보정 안내]\n스팸필터에 걸려 문안을 자동으로 보정했습니다. 아래 내용으로 발송됩니다.'
      : params.mode === 'pretest_held'
        ? (params.copyIssue
          ? `[발송 보류 안내]\n보낼 글에 고칠 곳이 있어 이 칸 발송을 잠시 멈췄어요. ${params.copyIssue} 여정의 다른 칸은 그대로 나가요. 고치면 이어서 보내요.`
          : params.candidateReady
          ? '[발송 보류 안내]\n스팸필터에 걸려 이 칸 발송을 잠시 멈췄어요. 검사를 통과한 수정안을 준비했어요. 상황판에서 [이 글로 보내기]를 누르면 바로 이어서 보내요. 여정의 다른 칸은 그대로 나가요.'
          : '[발송 보류 안내]\n스팸필터에 걸려 이 칸 발송을 잠시 멈췄어요. 여정의 다른 칸은 그대로 나가요. 문안을 고치면 다시 검사해 통과하는 즉시 이어서 보내요.')
        : `[검사 지연 안내]\n고친 문안의 스팸필터 검사가 ${PRETEST_LATE_NOTICE_HOURS}시간 넘게 끝나지 않아 이 칸 발송을 기다리고 있어요. 검사가 끝나는 즉시 보내요(여정의 다른 칸은 그대로 나가요).`;
  return [
    head, '',
    `여정: ${params.journeyName}`,
    `step ${params.stepOrder}`,
    `발송 예정: ${dateStr}`,
    ...(params.immediate && params.mode === 'pretest_autofixed' ? [IMMEDIATE_STEP_NOTICE_LINE] : []),
    '', '본문 미리보기:', params.messagePreview,
    ...(params.pauseUrl
      ? ['', `${params.mode === 'pretest_autofixed' ? '즉시 정지' : '확인·여정 일시정지'}: ${params.pauseUrl}`]
      : ['', '정지가 필요하면 한줄로 여정 화면에서 일시정지해 주세요.']),
  ].join('\n');
}

/** ★ 2026-11-02 주간 검사 고를 칸(설계서 3-9) — 켜진 여정 문자 칸 · 지금 판 · 이번 주 결정(없음 · 보류만) · 오늘 시도 상한 · 다음 발송 이른 순(판 읽기 · 결정 기록 읽기 = 이 파일) */
/** ★ 2026-11-02 주간 검사 「그 판 이번 주 일 마침」 기록(결정 아님 · 수정안을 만들 수 없는 보류 = 보낼 글 판정 보류) — 고르기가 LIMIT 앞에서 뺀다(설계서 3-9 · R12) */
export const WEEKLY_DONE_STATUS = 'week_done';

/**
 * ★ 2026-11-02 설계서 3-9 · CT-J12 — 주간 검사 고르기 = 이번 주 그 칸 지금 판의 일이 남은 칸만(판정 = 이 SQL 한 곳 · LIMIT 앞 · R12).
 *   남음 = 이번 주 결정 없음 · 또는 보류인데 수정안 일이 남음(변이 칸 · 마침 기록 · 후보 passed · blocked · failed · 만드는 중 10분 안 = 남지 않음 · 후보 표 없음 = 남지 않음).
 */
export async function weeklyCheckRows(weekStartIso: string, candOn: boolean, limit: number): Promise<any[]> {
  const heldPending = candOn
    ? `(snap.id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM journey_step_variants v WHERE v.step_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM journey_pretest_schedules wd WHERE wd.journey_id = s.journey_id AND wd.step_id = s.id
                         AND wd.status = '${WEEKLY_DONE_STATUS}' AND wd.snapshot_id IS NOT DISTINCT FROM snap.id AND wd.notify_at >= $1::timestamptz)
        AND NOT EXISTS (SELECT 1 FROM journey_pretest_candidates c WHERE c.snapshot_id = snap.id
                         AND (c.status IN ('passed', 'blocked', 'failed')
                              OR (c.status = 'generating' AND c.claimed_at >= NOW() - INTERVAL '${CANDIDATE_GENERATING_TTL_MINUTES} minutes')
                              OR (c.status = 'testing' AND c.body IS NULL))))`
    : 'false';
  return (await query(
    `SELECT s.id AS step_id, s.journey_id, s.channel, s.is_ad, s.subject, s.step_order, j.company_id, j.created_by,
            snap.id AS snapshot_id, dec.status AS decision,
            (SELECT MIN(e.next_run_at) FROM journey_executions e WHERE e.journey_id = j.id AND e.status = 'active') AS next_run_at,
            (SELECT e.id FROM journey_executions e WHERE e.journey_id = j.id AND e.status = 'active' ORDER BY e.next_run_at ASC NULLS LAST LIMIT 1) AS execution_id
       FROM journey_steps s
       JOIN journeys j ON j.id = s.journey_id AND j.status = 'active'
       LEFT JOIN LATERAL ${latestSnapshotSql('s.journey_id', 's.id')} snap ON TRUE
       LEFT JOIN LATERAL (
         SELECT ps.status FROM journey_pretest_schedules ps
          WHERE ps.journey_id = s.journey_id AND ps.step_id = s.id AND ps.snapshot_id IS NOT DISTINCT FROM snap.id
            AND ps.notify_at >= $1::timestamptz AND ps.status IN (${DECISION_SQL_LIST})
          ORDER BY ps.notify_at DESC, ps.id DESC LIMIT 1) dec ON TRUE
      WHERE COALESCE(s.step_type, 'message') = 'message' AND s.channel IN ('sms', 'lms', 'mms')
        AND (dec.status IS NULL OR (dec.status = 'held' AND ${heldPending}))
        AND (SELECT COUNT(*) FROM journey_pretest_schedules pe
              WHERE pe.journey_id = s.journey_id AND pe.step_id = s.id AND pe.status = 'error'
                AND pe.snapshot_id IS NOT DISTINCT FROM snap.id AND pe.notify_at >= ${KST_TODAY_START_SQL}) < ${PRETEST_ERROR_DAILY_MAX}
      ORDER BY next_run_at ASC NULLS LAST, s.journey_id, s.step_order
      LIMIT ${Number(limit)}`,
    [weekStartIso],
  )).rows;
}

/**
 * ★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-9 — 주간 회사 묶음 검사 한 칸(journey-weekly-check 가 1분마다 부른다).
 *   보내기 전 검사와 같은 길: 보낼 글 판정(유료 앞 · CT-J10) → 판마다 스팸 검사(지난주 결과를 다시 쓰지 않는다 = reuseDays 없음 · 같은 날 검사만 이어 봄)
 *   → 통과 = 결정 기록 notified · 막힘 = 그 칸 · 그 판 보류(holdCurrent · 여정 멈춤 0) → 수정안(후보 · 1회 · 차감 키 = 판) → 수정안 검사 → 결과는 후보에 · 원문은 그대로.
 *   held = 이번 주에 이미 보류된 칸(수정안 일만 이어 한다) · 변이 칸 · 보낼 글 판정 보류 = 수정안을 만들지 않는다.
 */
export async function weeklyCheckStep(b: PretestBundle, held: boolean): Promise<void> {
  const summary: ScanSummary = { tested: 0, passed: 0, regenerated: 0, held: 0, notified: 0 };
  const snapRes = await query(
    `SELECT snap.id, snap.message_body, snap.message_subject, snap.confidence FROM ${latestSnapshotSql('$2::uuid', '$1::uuid')} snap`,
    [b.stepId, b.journeyId],
  );
  const snap = snapRes.rows[0];
  const snapId: string | null = snap?.id ? String(snap.id) : null;
  const stepRow = await query(`SELECT message_template, subject FROM journey_steps WHERE id = $1::uuid`, [b.stepId]);
  const variantRows = await loadStepVariantRows(b.stepId);
  const versions = stepSendVersions(
    { message_template: stepRow.rows[0]?.message_template ?? null, subject: stepRow.rows[0]?.subject ?? b.subject },
    snap ?? null,
    variantRows,
  );
  const body = String(versions[0]?.body || '').trim();
  if (variantRows.length === 0 && !body) { await recordIfCurrent(b, snapId, { status: 'cancelled' }); return; }
  const trig = (await query(`SELECT trigger_event FROM journeys WHERE id = $1::uuid`, [b.journeyId])).rows[0]?.trigger_event ?? null;
  const copyIssue = journeyCopyIssue({ bodies: versions.map((v) => v.body), subjects: versions.map((v) => v.subject) }, await journeyCopyContext(b.companyId, trig, versions.map((v) => v.body)));
  if (copyIssue) {   // 보낼 글 판정 보류 = 수정안 0(사람이 고칠 자리) · 이번 주 이 판 일 마침(고르기에서 빠진다 · 매분 같은 칸을 다시 고르지 않게)
    if (!held) await holdCurrent(b, summary, snapId, body);
    await query(
      `INSERT INTO journey_pretest_schedules (company_id, journey_id, step_id, execution_id, scheduled_send_at, notify_at, status, snapshot_id, notice_sent_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, NOW(), NOW(), '${WEEKLY_DONE_STATUS}', $4::uuid, NOW())`,
      [b.companyId, b.journeyId, b.stepId, snapId],
    );
    return;
  }
  const cbRes = await query(`SELECT regexp_replace(callback_number, '[^0-9]', '', 'g') AS cb FROM journeys WHERE id = $1::uuid`, [b.journeyId]);
  const stepCallback = String(cbRes.rows[0]?.cb || '');
  let stopWords: string[] = [];
  if (!held) {
    const tests = [];
    for (const v of versions) {
      tests.push(await runStepSpamTest({
        companyId: b.companyId, userId: b.createdBy || '', body: v.body, subject: v.subject,
        channel: b.channel, isAd: b.isAd, callbackNumber: stepCallback, journeyId: b.journeyId, variantId: v.variantId || undefined,
      }));
    }
    const verdict = mergeSpamVerdicts(tests.map((t) => t.verdict));
    if (verdict === 'pass') { await recordIfCurrent(b, snapId, { status: 'notified', markChecked: true }); return; }
    if (isSpamHold(verdict)) return;   // 확인 중 · 검사 중 = 다음 분에 같은 검사를 이어 본다(차감 0)
    // ★ 2026-11-06 C109 E11 — 글자 반려 = 도달 불가 갈래 · 장애와 같은 기록 + 경보 · 보류(held) · 수정안 0(같은 글은 같은 반려)
    if (verdict === 'rejected') alertPretestRejected(b, tests.map((t) => t.error).filter(Boolean).join(' · '));
    if (verdict === 'error' || verdict === 'rejected') { await recordIfCurrent(b, snapId, { status: 'error', noticeDone: true }); return; }   // 시도 기록 · 하루 상한 = 고르는 쪽
    await holdCurrent(b, summary, snapId, body);
    stopWords = tests[0]?.matchedStopWords || [];
  }
  // 수정안 일(변이 칸 · 후보 표 없음 = 만들지 않는다 · 원문 불변)
  if (variantRows.length > 0 || !snapId || !(await candidatesReady().catch(() => false))) return;
  const cand = await readCandidate(snapId);
  if (cand && cand.status === 'generating' && !cand.stale) return;
  if (cand && cand.status === 'generating') { await moveCandidate(snapId, ['generating'], 'failed'); return; }
  if (cand && cand.status === 'testing' && cand.body) { await testCandidate(b, summary, snapId, cand.body, cand.subject, body, stepCallback, true); return; }
  if (cand) return;   // passed · blocked · failed = 끝
  const claim = await claimCandidate(b.journeyId, b.stepId, snapId);
  if (claim === 'stale' || claim === 'taken') return;
  let regenBody: string | null = null;
  try {
    regenBody = await regenerateStepAvoidingSpam({
      companyId: b.companyId, currentMessage: body, copyFacts: await readJourneyCopyFacts(b.companyId, b.journeyId).catch(() => null),
      channel: b.channel, isAd: b.isAd, matchedStopWords: stopWords,
    }, { idempotencyKey: regenChargeKey(b.companyId, snapId), stillMine: () => candidateStillMine(snapId, claim.token) });
  } catch (e: any) {
    console.log(`[journey-weekly-check] 수정안 만들기 실패 journey=${b.journeyId} step=${b.stepId} — ${e?.message || e}`);
  }
  if (!regenBody || !regenBody.trim() || regenBody.trim() === body) {
    if (await candidateStillMine(snapId, claim.token).catch(() => false)) await moveCandidate(snapId, ['generating'], 'failed');
    return;
  }
  if (!(await saveCandidate(snapId, claim.token, regenBody, versions[0]?.subject ?? null))) return;
  await testCandidate(b, summary, snapId, regenBody, versions[0]?.subject ?? null, body, stepCallback, true);
}
