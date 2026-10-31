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

import { isDemoCompany } from './demo-company';
import { query, withTransaction, withBoundedMysql } from '../config/database';
import { buildJourneyPauseShortUrl, generatePauseToken, pauseJourney } from './journey-pause-handler';
import { pickOwnerContact } from './owner-contact';
import { getAuthSmsTable, bulkInsertSmsQueue, getPlatformNoticeCallback } from './sms-queue';
import { runStepSpamTest } from './journey-pretest-validator';
import { regenerateStepAvoidingSpam } from './journey-ai-generator';
import { groupPretestBundles, kstDateOf, PretestScanRow, PretestBundle } from './journey-pretest-scan';
import { stepSendVersions, loadStepVariantRows } from './journey-step-versions';
import { sendSystemAlert } from './system-alert';
import { messageStepBoundsSql } from './journey-step-notify';
import { NOTICE_ENQUEUE_TIMEOUT_MS, NOTICE_MAX_ATTEMPTS, sendNoticeOnce } from './journey-notice-once';

type PretestMode = 'pretest_pass' | 'pretest_autofixed' | 'pretest_paused';

/** ★ 2026-10-25 #14 — 검사 장애를 같은 묶음(여정 · 칸 · 발송일)에서 몇 번까지 다시 보는가(5분 회차 · 그 뒤 = 멈춤 또는 그날 재검사 접기 + 운영 경보). */
export const PRETEST_CHECK_ERROR_MAX = 3;
/** 묶음 키 → 그날 검사 장애 수(프로세스 메모리 · 재시작하면 0부터 = 몇 번 더 볼 뿐 · DB 상태값을 새로 만들지 않는다). */
const _checkErrors = new Map<string, number>();
/** ★ 2026-10-31 §2-8 — 묶음 처리 예외(기록 쓰기 실패 등)를 같은 묶음에서 몇 번까지 다시 보는가(그 뒤 = 그날 그 묶음을 더 처리하지 않음 + 운영 경보 · 유료 재검사 반복 0). */
export const PRETEST_BUNDLE_EXCEPTION_MAX = 3;
const _bundleExceptions = new Map<string, number>();

/** ★ 2026-10-25 #2 — 한 회차에 보는 묶음 수(묶음 = 여정 · 칸 · 발송일 · 이른 발송부터 · 회차가 길어지면 다음 회차는 건너뛴다(워커 달리는 중 가드) · 남은 묶음은 다음 회차가 이른 순으로). */
export const PRETEST_SCAN_BUNDLE_LIMIT = 300;
/** ★ 2026-10-31 앞보기 창(시간) — 스캔 후보 창 · 날짜 기준 여정이 실행 행을 앞서 만드는 시간(journey-anchor-scheduler)이 같은 값. */
export const PRETEST_LEAD_HOURS = 2;
/** ★ 2026-10-31 「그날 검사를 마쳤다」로 치는 기록 상태(pending = 통과 · 안내 전 · paused = 멈춤 = 다시 켜면 다시 검사). */
export const PRETEST_DONE_STATUSES = ['notified', 'cancelled'] as const;

/**
 * ★ 2026-10-31 그 여정 · 그 칸 · 그 날(KST) 검사를 마쳤는가 — SQL 조각 하나(스캔 후보 · 실행기 관문이 이것만 쓴다 · 뿌리 R30 · R1).
 *   journeyExpr · stepExpr · dayExpr = 부르는 쪽 SQL 식(바인드 자리표 또는 칸 식 · 날 = date 식).
 */
export function pretestDoneSql(journeyExpr: string, stepExpr: string, dayExpr: string): string {
  const statuses = PRETEST_DONE_STATUSES.map((s) => `'${s}'`).join(', ');
  return `EXISTS (SELECT 1 FROM journey_pretest_schedules ps_done
      WHERE ps_done.journey_id = ${journeyExpr} AND ps_done.step_id = ${stepExpr}
        AND ps_done.status IN (${statuses})
        AND (ps_done.scheduled_send_at AT TIME ZONE 'Asia/Seoul')::date = ${dayExpr})`;
}

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
export function resetPretestScanMemory(attemptsReady?: boolean): void {
  _checkErrors.clear();
  _bundleExceptions.clear();
  _attemptsReady = attemptsReady === true;
  _attemptsAbsentUntil = attemptsReady === false ? Date.now() + ATTEMPTS_RECHECK_MS : 0;
}

/**
 * 발송 2시간 전 스캔 + 스팸테스트. 5분 cron worker가 호출.
 */
export async function scanAndPretest(): Promise<{
  scanned: number; bundles: number; tested: number; passed: number; regenerated: number; paused: number; notified: number;
}> {
  const startedAt = Date.now();
  const summary = { scanned: 0, bundles: 0, tested: 0, passed: 0, regenerated: 0, paused: 0, notified: 0 };

  // 지난 날 묶음의 셈은 버린다(키 끝 = 발송일 KST)
  const today = kstDateOf(new Date());
  for (const m of [_checkErrors, _bundleExceptions]) for (const k of [...m.keys()]) if (k.slice(-10) < today) m.delete(k);
  // ★ 1031 그날 처리를 멈춘 묶음(예외 상한) = SQL 안(LIMIT 앞)에서 뺀다(R12 · 앞자리를 차지하지 않게)
  const halted = [..._bundleExceptions.entries()].filter(([, n]) => n >= PRETEST_BUNDLE_EXCEPTION_MAX).map(([k]) => k);

  // 임박 발송(2시간 안) + 다음 step이 message(sms/lms/mms)인 active execution.
  //   다음 step = current_step_order보다 큰 최소 step_order (LATERAL). kakao는 스팸필터 무관이라 제외.
  // ★ 2026-10-25 여정 구조체크 2차 #2(뿌리 대장 R12) — 거름 · 묶기 · 순서를 전부 SQL 안(LIMIT 앞)에서.
  //   (여정 · 칸 · 발송일)당 한 행(가장 이른 실행) · 그날 마친 묶음은 빼되 재검사 전 판은 남김 · 가장 이른 발송부터.
  // ★ 2026-10-31 「그날 마침」 = pretestDoneSql(pending · paused 는 마침이 아니다) · 실행기가 미룬 실행(지금 + 10분)도 여기서 잡힌다.
  const day = `(je.next_run_at AT TIME ZONE 'Asia/Seoul')::date`;
  const bounds = messageStepBoundsSql('je.journey_id');
  const rowsRes = await query(
    `SELECT b.* FROM (
       SELECT DISTINCT ON (je.journey_id, s.id, ${day})
              je.id AS execution_id, je.journey_id, je.next_run_at,
              j.company_id, j.created_by, j.start_kind,
              s.id AS step_id, s.step_order, s.channel, s.is_ad, s.subject, s.notify_manager_on_pretest,
              s.delay_mode, s.delay_hours,
              ${bounds.first} AS first_message_order, ${bounds.last} AS last_message_order
         FROM journey_executions je
         JOIN journeys j ON j.id = je.journey_id AND j.status = 'active'
         JOIN LATERAL (
           SELECT id, step_order, step_type, channel, is_ad, subject, notify_manager_on_pretest, delay_mode, delay_hours
             FROM journey_steps
            WHERE journey_id = je.journey_id AND step_order > je.current_step_order
            ORDER BY step_order ASC LIMIT 1
         ) s ON TRUE
        WHERE je.status = 'active'
          AND je.next_run_at > NOW()
          AND je.next_run_at <= NOW() + INTERVAL '${PRETEST_LEAD_HOURS} hours'
          AND COALESCE(s.step_type, 'message') = 'message'
          AND s.channel IN ('sms', 'lms', 'mms')
          AND (
            COALESCE((SELECT ss.confidence_score FROM journey_step_snapshots ss
                       WHERE ss.step_id = s.id AND ss.journey_id = je.journey_id
                       ORDER BY ss.created_at DESC LIMIT 1), 100) < 100
            OR NOT ${pretestDoneSql('je.journey_id', 's.id', day)}
          )
          AND NOT ((je.journey_id::text || ':' || s.id::text || ':' || ${day}::text) = ANY($1::text[]))
        ORDER BY je.journey_id, s.id, ${day}, je.next_run_at ASC
     ) b
     ORDER BY b.next_run_at ASC
     LIMIT ${PRETEST_SCAN_BUNDLE_LIMIT}`,
    [halted],
  );
  summary.scanned = rowsRes.rows.length;
  if (rowsRes.rows.length === 0) return summary;

  const bundles = groupPretestBundles(rowsRes.rows as PretestScanRow[]);
  summary.bundles = bundles.length;

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
        void sendSystemAlert({
          companyId: b.companyId,
          dedupKey: `journey-pretest-bundle-error:${b.journeyId}`,
          message: `여정 발송 전 검사 묶음 처리가 ${PRETEST_BUNDLE_EXCEPTION_MAX}번 실패해 오늘 그 칸 검사를 멈췄습니다(그 칸 문자는 검사 기록이 생길 때까지 나가지 않습니다). journey=${b.journeyId} step=${b.stepId} — ${String(bundleErr?.message || bundleErr).slice(0, 200)}`,
        }).catch(() => undefined);
      }
    }
  }

  console.log(`[journey-pretest-scan] 완료 — scanned=${summary.scanned} bundles=${summary.bundles} tested=${summary.tested} passed=${summary.passed} regen=${summary.regenerated} paused=${summary.paused} notified=${summary.notified} ms=${Date.now() - startedAt}`);
  return summary;
}

/** 묶음 하나 = 상태표(§2-8). 그날 그 묶음의 가장 최근 기록 + 스냅숏 검사 표식에서 할 일 하나를 정한다. */
async function processBundle(b: PretestBundle, summary: { tested: number; passed: number; regenerated: number; paused: number; notified: number }): Promise<void> {
  // 최신 snapshot 본문 (executor가 실제 발송하는 본문).
  //   ★ 2026-10-19 B-1009-6 — 재검사 전 판(confidence_score < 100 · 켜진 여정 수정본)은 그날 처리 기록과 상관없이 검사한다.
  const snapRes = await query(
    `SELECT id, message_body, message_subject, confidence_score FROM journey_step_snapshots
      WHERE step_id = $1::uuid AND journey_id = $2::uuid
      ORDER BY created_at DESC LIMIT 1`,
    [b.stepId, b.journeyId]
  );
  const snap = snapRes.rows[0];
  const snapId: string | null = snap?.id ? String(snap.id) : null;
  const unchecked = !!snap && snap.confidence_score != null && Number(snap.confidence_score) < 100;

  // ★ 2026-10-25 #1(R5) — 이 칸이 보낼 수 있는 판(변이가 있으면 변이마다) = 실행기 · 켜기 검사와 같은 목록(journey-step-versions).
  const stepRow = await query(`SELECT message_template, subject FROM journey_steps WHERE id = $1::uuid`, [b.stepId]);
  const variantRows = await loadStepVariantRows(b.stepId);
  const versions = stepSendVersions(
    { message_template: stepRow.rows[0]?.message_template ?? null, subject: stepRow.rows[0]?.subject ?? b.subject },
    snap ?? null,
    variantRows,
  );
  const body = String(versions[0]?.body || '').trim();

  // ★ 1031 상태 = pending(통과 · 안내 전) · 스냅숏 검사 통과 → 검사하지 않고 안내만(이미 통과 · 차감 0)
  const rec = await latestRecord(b);
  if (rec?.status === 'pending' && !unchecked) {
    if (await finishPending(b, rec.id, body)) summary.notified++;
    return;
  }

  if (variantRows.length === 0 && (!snap || !body)) {
    await recordIfCurrent(b, snapId, { status: 'cancelled' });
    return;
  }

  // ★ 2026-06-06: 2시간전 재검도 활성화 검증과 같은 회신번호로 테스트 — 빈 callback이면 테스트 발송이 실패해 오탐 정지 위험.
  const cbRes = await query(`SELECT regexp_replace(callback_number, '[^0-9]', '', 'g') AS cb FROM journeys WHERE id = $1::uuid`, [b.journeyId]);   // ★ 1019 B-1005-5② 같은 뿌리(숫자만)
  const stepCallback = String(cbRes.rows[0]?.cb || '');
  summary.tested++;
  const tests = [];
  for (const v of versions) {
    tests.push(await runStepSpamTest({
      companyId: b.companyId, userId: b.createdBy || '',
      body: v.body, subject: v.subject,
      channel: b.channel, isAd: b.isAd, callbackNumber: stepCallback, journeyId: b.journeyId,
      variantId: v.variantId || undefined,
    }));
  }
  const r1 = tests[0];
  // 판 전부의 판정(하나라도 차단 = 차단 · 차단 없이 하나라도 장애 = 장애 · 전부 통과 = 통과 · 켜기 검사와 같은 규칙)
  const verdict = tests.some((t) => t.verdict === 'blocked') ? 'blocked' : tests.every((t) => t.verdict === 'pass') ? 'pass' : 'error';

  // 통과 → 그 판 = 검사 통과(confidence_score 100) + pending 기록(판 확인 쓰기 한 트랜잭션) → 같은 회차에 안내(§2-8 상태표)
  if (verdict === 'pass') {
    summary.passed++;
    _checkErrors.delete(b.bundleKey);
    const w = await recordIfCurrent(b, snapId, { status: 'pending', markChecked: true });
    if (w.recordId && (await finishPending(b, w.recordId, body))) summary.notified++;
    return;
  }

  // ★ 2026-10-25 #14(R7 · R8) — 검사 장애(접수 실패 · 시간 초과 · 통신사 결과 실패)는 차단이 아니다 → 문안을 고치지 않고 다음 회차에 다시 본다.
  //   상한 = 같은 묶음(여정 · 칸 · 발송일) 하루 PRETEST_CHECK_ERROR_MAX 번. 넘으면 재검사 전 판은 보낼 수 없어 멈추고 알린다 ·
  //   이미 검사를 통과한 판은 그날 재검사를 접는다(켤 때 검사를 통과한 글 그대로 나간다 · 운영 경보로 사람이 본다).
  if (verdict === 'error') {
    const n = (_checkErrors.get(b.bundleKey) || 0) + 1;
    _checkErrors.set(b.bundleKey, n);
    console.log(`[journey-pretest-scan] 스팸 검사 장애 ${n}/${PRETEST_CHECK_ERROR_MAX}(문안은 그대로 · 다음 회차 다시) journey=${b.journeyId} step=${b.stepId} — ${tests.map((t) => t.error).filter(Boolean).join(' · ') || 'timeout'}`);
    if (n < PRETEST_CHECK_ERROR_MAX) return;
    _checkErrors.delete(b.bundleKey);
    if (unchecked) {
      summary.paused++;
      await pauseJourney(b.journeyId, '발송 전 스팸필터 검사를 마치지 못해(검사 장애) 고친 문안을 보내지 않고 여정을 멈췄습니다. 잠시 뒤 다시 켜 주세요.');
      await safeNotify(b, body, 'pretest_paused');
      await recordIfCurrent(b, snapId, { status: 'paused' });
    } else {
      await recordIfCurrent(b, snapId, { status: 'cancelled' });
    }
    void sendSystemAlert({
      companyId: b.companyId,
      dedupKey: `journey-pretest-check-error:${b.journeyId}`,
      message: `여정 발송 전 스팸 검사를 ${PRETEST_CHECK_ERROR_MAX}번 연속 마치지 못했습니다(검사 장애 · ${unchecked ? '고친 문안 = 여정 멈춤' : '켤 때 통과한 문안 그대로 발송'}). journey=${b.journeyId} step=${b.stepId}`,
    }).catch(() => undefined);
    return;
  }

  // ★ 2026-10-25 #1 — 변이 칸은 자동으로 고치지 않는다(켜진 여정의 변이는 사람이 고칠 수 없는 칸이라 모르는 문안으로 바꾸지 않는다 · 덜 보내는 방향).
  if (variantRows.length > 0) {
    summary.paused++;
    await pauseJourney(b.journeyId, '발송 전 스팸필터 통과 실패 (A/B 문안 중 차단). 문안 직접 확인 필요');
    await safeNotify(b, body, 'pretest_paused');
    await recordIfCurrent(b, snapId, { status: 'paused' });
    return;
  }

  // ★ 2026-10-25 Codex 1R(R5) — 원 문안 차단 확인 = 그 판을 바로 「검사 전」(0)으로 내린다. 실행기는 검사 전 판을 보내지 않고 기다린다.
  //   고친 문안이 통과할 때만 100(아래) · 고친 문안 검사 장애로 다시 볼 때도 보류 유지.
  await recordIfCurrent(b, snapId, { markUnchecked: true });

  // 진짜 스팸 걸림 → 1회 재생성(1크레딧 자동) + 재테스트.
  let regenBody: string | null = null;
  try {
    regenBody = await regenerateStepAvoidingSpam({
      companyId: b.companyId, currentMessage: body,
      channel: b.channel, isAd: b.isAd, matchedStopWords: r1.matchedStopWords || [],
    });
  } catch (regenErr: any) {
    console.log(`[journey-pretest-scan] 재생성 실패 journey=${b.journeyId} step=${b.stepId} — ${regenErr?.message || regenErr}`);
  }

  if (regenBody && regenBody.trim() && regenBody.trim() !== body) {
    summary.regenerated++;
    const r2 = await runStepSpamTest({
      companyId: b.companyId, userId: b.createdBy || '',
      body: regenBody, subject: versions[0]?.subject ?? null,
      channel: b.channel, isAd: b.isAd, callbackNumber: stepCallback, journeyId: b.journeyId,
    });
    if (r2.verdict === 'error') {
      // 고친 문안의 검사가 장애 = 고친 문안을 쓰지 않는다(검사 못 한 글) · 원 문안은 차단이라 보낼 수 없다 → 같은 장애 상한으로 다시 본다
      const n = (_checkErrors.get(b.bundleKey) || 0) + 1;
      _checkErrors.set(b.bundleKey, n);
      if (n < PRETEST_CHECK_ERROR_MAX) return;
      _checkErrors.delete(b.bundleKey);
      summary.paused++;
      // 원 문안은 차단이었다 → 멈춘 이유 = 문안(「스팸필터」 사유 · 문안 고치기)
      await pauseJourney(b.journeyId, '발송 전 스팸필터 통과 실패 (고친 문안을 검사하지 못함). 문안 직접 확인 필요');
      await safeNotify(b, body, 'pretest_paused');
      await recordIfCurrent(b, snapId, { status: 'paused' });
      return;
    }
    if (r2.verdict === 'pass') {
      // ★ 2026-10-18 J2 — 사람이 본 적 없는 문안으로 바뀐다 · 단계 알림 설정과 상관없이 늘 알린다(설계서 2026-10-18 §0).
      // ★ Codex C 1R — **먼저 알리고, 알린 뒤에만** 발송 본문을 바꾼다. 못 알리면(문자 큐 장애) 바꾸지 않고 여정을 멈춘다.
      if (!(await safeNotify(b, regenBody, 'pretest_autofixed'))) {
        summary.paused++;
        await pauseJourney(b.journeyId, '발송 전 스팸필터를 통과하도록 고친 문안을 담당자에게 알리지 못해 여정을 멈췄습니다. 문안을 확인한 뒤 재개해 주세요.');
        await safeNotify(b, body, 'pretest_paused');
        await recordIfCurrent(b, snapId, { status: 'paused' });
        return;
      }
      // ★ 1019 B-1009-6 고친 문안 = 검사 통과 · ★ 1031 본문 · 표식 · 기록 = 판 확인 쓰기 한 트랜잭션(그사이 사람이 고쳤으면 아무것도 안 씀)
      await recordIfCurrent(b, snapId, { status: 'notified', newBody: regenBody });
      summary.passed++;
      return;
    }
  }

  // 재생성으로도 통과 못 함 → 여정 정지 + 담당자 수동확인 안내.
  summary.paused++;
  await pauseJourney(b.journeyId, '발송 전 스팸필터 통과 실패 (자동 재생성 후에도 차단). 문안 직접 확인 필요');
  await safeNotify(b, body, 'pretest_paused');
  await recordIfCurrent(b, snapId, { status: 'paused' });
}

/** 그날 그 묶음의 가장 최근 기록(운영 INSERT 가 notify_at = NOW() 를 넣는다 · §2-8). */
async function latestRecord(b: PretestBundle): Promise<{ id: string; status: string } | null> {
  const r = await query(
    `SELECT id, status FROM journey_pretest_schedules
      WHERE journey_id = $1::uuid AND step_id = $2::uuid
        AND (scheduled_send_at AT TIME ZONE 'Asia/Seoul')::date = $3::date
      ORDER BY notify_at DESC, id DESC LIMIT 1`,
    [b.journeyId, b.stepId, b.sendDateKst],
  );
  const row = r.rows[0];
  return row ? { id: String(row.id), status: String(row.status) } : null;
}

export interface RecordWrite {
  /** 남길 기록 상태(없으면 표식 · 본문만) */
  status?: 'pending' | 'notified' | 'cancelled' | 'paused';
  /** 검사한 스냅숏 = 통과(100) */
  markChecked?: boolean;
  /** 검사한 스냅숏 = 검사 전(0 · 원 문안 차단) */
  markUnchecked?: boolean;
  /** 자동 보정 본문(통과 표식 100 을 함께) */
  newBody?: string;
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
    const latest = await run(
      `SELECT id FROM journey_step_snapshots WHERE step_id = $1::uuid AND journey_id = $2::uuid ORDER BY created_at DESC LIMIT 1`,
      [b.stepId, b.journeyId],
    );
    const latestId: string | null = latest.rows[0]?.id ? String(latest.rows[0].id) : null;
    if (latestId !== testedSnapshotId) {
      console.log(`[journey-pretest-scan] 검사한 판이 최신이 아님(그사이 문안 수정) · 결과 버림 journey=${b.journeyId} step=${b.stepId}`);
      return { current: false, recordId: null };
    }
    if (testedSnapshotId) {
      if (w.newBody != null) {
        await run(`UPDATE journey_step_snapshots SET message_body = $2, confidence_score = 100 WHERE id = $1::uuid`, [testedSnapshotId, w.newBody]);
      } else if (w.markChecked) {
        await run(`UPDATE journey_step_snapshots SET confidence_score = 100 WHERE id = $1::uuid AND confidence_score < 100`, [testedSnapshotId]);
      } else if (w.markUnchecked) {
        await run(`UPDATE journey_step_snapshots SET confidence_score = 0 WHERE id = $1::uuid`, [testedSnapshotId]);
      }
    }
    let recordId: string | null = null;
    if (w.status) {
      const ins = await run(
        `INSERT INTO journey_pretest_schedules
           (company_id, journey_id, step_id, execution_id, scheduled_send_at, notify_at, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, NOW(), $6)
         RETURNING id`,
        [b.companyId, b.journeyId, b.stepId, b.executionId, b.scheduledSendAt, w.status],
      );
      recordId = ins.rows[0]?.id ? String(ins.rows[0].id) : null;
    }
    return { current: true, recordId };
  });
}

/** pending → notified(그 행 · 상태가 그대로일 때만). */
async function markPendingNotified(recordId: string): Promise<boolean> {
  const r = await query(`UPDATE journey_pretest_schedules SET status = 'notified' WHERE id = $1::uuid AND status = 'pending' RETURNING id`, [recordId]);
  return r.rows.length > 0;
}

/**
 * ★ 2026-10-31 상태표 pending 줄 — 안내 필요를 매번 다시 판단하고(알림 설정 · 시연 회사 · 받을 담당자 · 번호) 안내 쓰기 한 꼴로 보낸다.
 *   반환 = 이번에 안내를 적재하고 기록까지 끝냈는가.
 */
async function finishPending(b: PretestBundle, recordId: string, preview: string): Promise<boolean> {
  const notice = b.notifyManager ? await buildManagerNotice(b, preview, 'pretest_pass') : null;
  if (!notice) { await markPendingNotified(recordId); return false; }
  if (!(await noticeAttemptsReady())) {
    // DDL C84-DDL-2 를 빠뜨림 = 시도 상한을 지킬 수 없다 → 안내 없이 올린다(발송을 막지 않고 중복도 없다)
    await markPendingNotified(recordId);
    void sendSystemAlert({
      companyId: b.companyId,
      dedupKey: 'journey-pretest-notice-attempts-ddl',
      cooldownMs: 6 * 60 * 60 * 1000,
      message: '여정 발송 전 안내 시도 칸(journey_pretest_schedules.notice_attempts)이 없어 담당자 안내를 보내지 못했습니다. 원장 C84-DDL-2 실행이 필요합니다(발송은 진행).',
    }).catch(() => undefined);
    return false;
  }
  const result = await sendNoticeOnce({
    claim: async () => (await query(
      `UPDATE journey_pretest_schedules SET notice_attempts = notice_attempts + 1
        WHERE id = $1::uuid AND status = 'pending' AND notice_attempts < $2 RETURNING id`,
      [recordId, NOTICE_MAX_ATTEMPTS],
    )).rows.length > 0,
    enqueue: () => enqueueManagerNotice(notice, b.companyId),
    finalize: () => markPendingNotified(recordId),
  });
  if (result === 'not_claimed') {
    // 시도를 다 쓴 pending(상태가 바뀐 것과 가른다) = 안내 없이 올리고 경보(K7 · 발송을 무기한 막지 않는다)
    const r = await query(`SELECT status, notice_attempts FROM journey_pretest_schedules WHERE id = $1::uuid`, [recordId]);
    const row = r.rows[0];
    if (row && String(row.status) === 'pending' && Number(row.notice_attempts) >= NOTICE_MAX_ATTEMPTS && (await markPendingNotified(recordId))) {
      void sendSystemAlert({
        companyId: b.companyId,
        dedupKey: `journey-pretest-notice-giveup:${b.journeyId}`,
        message: `여정 발송 전 검사는 통과했지만 담당자 안내를 ${NOTICE_MAX_ATTEMPTS}번 보내지 못해 안내 없이 발송을 진행합니다. journey=${b.journeyId} step=${b.stepId}`,
      }).catch(() => undefined);
    }
  }
  return result === 'sent';
}

/** 반환 = 알림이 실패하지 않았는가(받을 담당자가 없거나 시연 회사 = 보낼 것이 없음 = true · 큐 적재 0건 · 오류 = false) */
async function safeNotify(b: PretestBundle, preview: string, mode: PretestMode): Promise<boolean> {
  try {
    const notice = await buildManagerNotice(b, preview, mode);
    if (!notice) return true;
    const ok = await enqueueManagerNotice(notice, b.companyId);
    if (!ok) console.log(`[journey-pretest-scan] 담당자 알림 큐 적재 0건 journey=${b.journeyId} mode=${mode}`);
    return ok;
  } catch (e: any) {
    console.log(`[journey-pretest-scan] 담당자 알림 실패(skip) journey=${b.journeyId} — ${e?.message || e}`);
    return false;
  }
}

interface ManagerNotice { phone: string; body: string; title: string }

// ── 담당자 LMS 알림 (발송 전 안내 / 자동보정 / 정지) — 인증 라인 큐 ──
/** 보낼 안내 한 통(받는 사람 · 본문 · 제목) · null = 보낼 것이 없음(시연 회사 · 받을 담당자 없음 · 번호 형식 아님). 정지 링크는 여기서 만든다(적재 전에 다 만든다). */
async function buildManagerNotice(b: PretestBundle, messagePreview: string, mode: PretestMode): Promise<ManagerNotice | null> {
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
      messagePreview: String(messagePreview).slice(0, 100), pauseUrl, mode, immediate: b.immediate,
    }),
  };
}

/** 안내 한 통 적재 = 상한 있는 연결(★ 1031 §2-8 · 스캐너가 MySQL 에 묶여 멈추지 않게). 반환 = 큐에 한 건 들어갔는가. */
async function enqueueManagerNotice(notice: ManagerNotice, companyId: string): Promise<boolean> {
  const authTable = await getAuthSmsTable();
  const inserted = await withBoundedMysql(NOTICE_ENQUEUE_TIMEOUT_MS, (run) => bulkInsertSmsQueue(
    [authTable],
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
    { run },
  ));
  return inserted === 1;
}

function titleForMode(mode: PretestMode): string {
  if (mode === 'pretest_autofixed') return '[발송 전 자동 보정 안내]';
  if (mode === 'pretest_paused') return '[발송 정지 안내]';
  return '[발송 전 안내]';
}

/** ★ 1031 바로 보내는 칸 안내 줄(§2-4) */
export const IMMEDIATE_STEP_NOTICE_LINE = '바로 보내는 칸이라 오늘 이 칸에 닿는 고객에게 이어서 나갑니다. 오늘 남은 발송까지 멈추려면 링크에서 여정 전체 일시정지를 눌러 주세요.';

export function buildPretestLmsBody(params: {
  journeyName: string; stepOrder: number; scheduledSendAt: Date;
  messagePreview: string; pauseUrl: string | null; mode: PretestMode;
  /** ★ 1031 바로 보내는 칸(통과 · 자동 보정 안내에 한 줄) */
  immediate?: boolean;
}): string {
  const dateStr = new Date(params.scheduledSendAt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const head =
    params.mode === 'pretest_autofixed'
      ? '[발송 전 자동 보정 안내]\n스팸필터에 걸려 문안을 자동으로 보정했습니다. 아래 내용으로 발송됩니다.'
      : params.mode === 'pretest_paused'
        ? '[발송 정지 안내]\n스팸필터를 통과하지 못해 발송을 정지했습니다. 문안을 직접 확인해 주세요.'
        : '[발송 전 안내]';
  return [
    head, '',
    `여정: ${params.journeyName}`,
    `step ${params.stepOrder}`,
    `발송 예정: ${dateStr}`,
    ...(params.immediate && params.mode !== 'pretest_paused' ? [IMMEDIATE_STEP_NOTICE_LINE] : []),
    '', '본문 미리보기:', params.messagePreview,
    ...(params.pauseUrl
      ? ['', `${params.mode === 'pretest_paused' ? '확인·여정 일시정지' : '즉시 정지'}: ${params.pauseUrl}`]
      : ['', '정지가 필요하면 한줄로 여정 화면에서 일시정지해 주세요.']),
  ].join('\n');
}
