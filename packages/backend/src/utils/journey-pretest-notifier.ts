// packages/backend/src/utils/journey-pretest-notifier.ts
// CT-93: 발송 2시간 전 스팸테스트 + 담당자 알림 (Phase 6B 재설계 — 2026-06-04)
//   - 5분 cron 스캐너 scanAndPretest: next_run_at 2시간 안 + 다음 step이 message인 active execution을
//     (journey, step, KST 발송날짜)당 1회 처리.
//   - snapshot 본문 스팸테스트 → 통과면 담당자 LMS 안내 / 걸리면 1회 재생성(source journey-ai-refine = 1크레딧 자동)
//     + 재테스트 → 통과면 snapshot 갱신(실발송 반영)+안내, 또 걸리면 여정 정지+수동확인 안내.
//   - 종전 미래 예측 스케줄링(predictNextSendTimes)은 journey_executions에 없는 컬럼(scheduled_at·step_id)을 조회해
//     활성화 try/catch에 삼켜져 조용히 깨져 있었음 → 폐기하고 실제 next_run_at 스캔으로 교체.
//   - dedup = journey_pretest_schedules에 (journey, step, KST날짜) 처리 기록.

import { isDemoCompany } from './demo-company';
import { query } from '../config/database';
import { buildJourneyPauseUrl, generatePauseToken, pauseJourney } from './journey-pause-handler';
import { getAuthSmsTable, bulkInsertSmsQueue, getPlatformNoticeCallback } from './sms-queue';
import { runStepSpamTest } from './journey-pretest-validator';
import { regenerateStepAvoidingSpam } from './journey-ai-generator';
import { groupPretestBundles, kstDateOf, PretestScanRow, PretestBundle } from './journey-pretest-scan';
import { stepSendVersions, loadStepVariantRows } from './journey-step-versions';
import { sendSystemAlert } from './system-alert';

type PretestMode = 'pretest_pass' | 'pretest_autofixed' | 'pretest_paused';

/** ★ 2026-10-25 #14 — 검사 장애를 같은 묶음(여정 · 칸 · 발송일)에서 몇 번까지 다시 보는가(5분 회차 · 그 뒤 = 멈춤 또는 그날 재검사 접기 + 운영 경보). */
export const PRETEST_CHECK_ERROR_MAX = 3;
/** 묶음 키 → 그날 검사 장애 수(프로세스 메모리 · 재시작하면 0부터 = 몇 번 더 볼 뿐 · DB 상태값을 새로 만들지 않는다). */
const _checkErrors = new Map<string, number>();

/** ★ 2026-10-25 #2 — 한 회차에 보는 묶음 수(묶음 = 여정 · 칸 · 발송일 · 이른 발송부터 · 회차가 길어지면 다음 회차는 건너뛴다(워커 달리는 중 가드) · 남은 묶음은 다음 회차가 이른 순으로). */
export const PRETEST_SCAN_BUNDLE_LIMIT = 300;

/**
 * 발송 2시간 전 스캔 + 스팸테스트. 5분 cron worker가 호출.
 */
export async function scanAndPretest(): Promise<{
  scanned: number; bundles: number; tested: number; passed: number; regenerated: number; paused: number;
}> {
  const summary = { scanned: 0, bundles: 0, tested: 0, passed: 0, regenerated: 0, paused: 0 };

  // 임박 발송(2시간 안) + 다음 step이 message(sms/lms/mms)인 active execution.
  //   다음 step = current_step_order보다 큰 최소 step_order (LATERAL). kakao는 스팸필터 무관이라 제외.
  // ★ 2026-10-25 여정 구조체크 2차 #2(뿌리 대장 R12) — 거름 · 묶기 · 순서를 전부 SQL 안(LIMIT 앞)에서.
  //   옛: 실행 2,000행을 순서 없이 자른 뒤 JS 에서 「그날 처리함」을 걸렀다. 같은 칸에 2,000명 넘는 여정 하나가 행을 다 차지하면
  //   다른 여정(다른 회사 포함)은 2시간 내내 검사 · 안내를 못 받았고, 고친 문안(재검사 전 판)은 검사를 못 받아 발송이 계속 미뤄졌다.
  //   이제 (여정 · 칸 · 발송일)당 한 행(가장 이른 실행) · 그날 처리한 묶음은 빼되 재검사 전 판은 남김 · 가장 이른 발송부터.
  const rowsRes = await query(
    `SELECT b.* FROM (
       SELECT DISTINCT ON (je.journey_id, s.id, (je.next_run_at AT TIME ZONE 'Asia/Seoul')::date)
              je.id AS execution_id, je.journey_id, je.next_run_at,
              j.company_id, j.created_by,
              s.id AS step_id, s.step_order, s.channel, s.is_ad, s.subject, s.notify_manager_on_pretest,
              (SELECT COUNT(*) FROM journey_steps ts WHERE ts.journey_id = je.journey_id) AS total_steps
         FROM journey_executions je
         JOIN journeys j ON j.id = je.journey_id AND j.status = 'active'
         JOIN LATERAL (
           SELECT id, step_order, step_type, channel, is_ad, subject, notify_manager_on_pretest
             FROM journey_steps
            WHERE journey_id = je.journey_id AND step_order > je.current_step_order
            ORDER BY step_order ASC LIMIT 1
         ) s ON TRUE
        WHERE je.status = 'active'
          AND je.next_run_at > NOW()
          AND je.next_run_at <= NOW() + INTERVAL '2 hours'
          AND COALESCE(s.step_type, 'message') = 'message'
          AND s.channel IN ('sms', 'lms', 'mms')
          AND (
            COALESCE((SELECT ss.confidence_score FROM journey_step_snapshots ss
                       WHERE ss.step_id = s.id AND ss.journey_id = je.journey_id
                       ORDER BY ss.created_at DESC LIMIT 1), 100) < 100
            OR NOT EXISTS (SELECT 1 FROM journey_pretest_schedules ps
                            WHERE ps.journey_id = je.journey_id AND ps.step_id = s.id
                              AND (ps.scheduled_send_at AT TIME ZONE 'Asia/Seoul')::date = (je.next_run_at AT TIME ZONE 'Asia/Seoul')::date)
          )
        ORDER BY je.journey_id, s.id, (je.next_run_at AT TIME ZONE 'Asia/Seoul')::date, je.next_run_at ASC
     ) b
     ORDER BY b.next_run_at ASC
     LIMIT ${PRETEST_SCAN_BUNDLE_LIMIT}`
  );
  summary.scanned = rowsRes.rows.length;
  if (rowsRes.rows.length === 0) return summary;

  const bundles = groupPretestBundles(rowsRes.rows as PretestScanRow[]);
  summary.bundles = bundles.length;
  // 지난 날 묶음의 장애 수는 버린다(키 끝 = 발송일 KST)
  const today = kstDateOf(new Date());
  for (const k of [..._checkErrors.keys()]) if (k.slice(-10) < today) _checkErrors.delete(k);

  for (const b of bundles) {
    try {
      // 최신 snapshot 본문 (executor가 실제 발송하는 본문).
      //   ★ 2026-10-19 B-1009-6 — 재검사 전 판(confidence_score < 100 · 켜진 여정 수정본)은 그날 처리 기록과 상관없이 검사한다.
      //   ★ 2026-10-25 #2 — 그날 처리한 묶음 거름은 위 후보 SQL 안(LIMIT 앞)으로 옮겼다(여기서 다시 거르지 않는다 · 판정 한 곳).
      const snapRes = await query(
        `SELECT id, message_body, message_subject, confidence_score FROM journey_step_snapshots
          WHERE step_id = $1::uuid AND journey_id = $2::uuid
          ORDER BY created_at DESC LIMIT 1`,
        [b.stepId, b.journeyId]
      );
      const snap = snapRes.rows[0];
      const unchecked = !!snap && snap.confidence_score != null && Number(snap.confidence_score) < 100;

      // ★ 2026-10-25 #1(R5) — 이 칸이 보낼 수 있는 판(변이가 있으면 변이마다) = 실행기 · 켜기 검사와 같은 목록(journey-step-versions).
      //   옛: 변이를 안 보고 스냅샷만 검사했고, 고친 문안은 실행기가 변이로 덮어 나가지 않았다.
      const stepRow = await query(`SELECT message_template, subject FROM journey_steps WHERE id = $1::uuid`, [b.stepId]);
      const variantRows = await loadStepVariantRows(b.stepId);
      const versions = stepSendVersions(
        { message_template: stepRow.rows[0]?.message_template ?? null, subject: stepRow.rows[0]?.subject ?? b.subject },
        snap ?? null,
        variantRows,
      );
      const body = String(versions[0]?.body || '').trim();
      if (variantRows.length === 0 && (!snap || !body)) {
        await recordSchedule(b, 'cancelled');
        continue;
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

      // 통과 → 담당자 안내(opt-in) + 기록 + ★ 1019 B-1009-6 그 판 = 검사 통과(confidence_score 100 · 실행기 재검사 전 관문이 연다).
      if (verdict === 'pass') {
        summary.passed++;
        if (snap) await markSnapshotChecked(snap.id);
        if (b.notifyManager) await safeNotify(b, body, 'pretest_pass');
        await recordSchedule(b, 'notified');
        _checkErrors.delete(b.bundleKey);
        continue;
      }

      // ★ 2026-10-25 #14(R7 · R8) — 검사 장애(접수 실패 · 시간 초과 · 통신사 결과 실패)는 차단이 아니다 → 문안을 고치지 않고 다음 회차에 다시 본다.
      //   옛: 접수 실패만 다시 봤고, 시간 초과 · 결과 실패는 「차단」으로 읽어 AI 재생성(1크레딧)으로 고객 문안을 바꾸거나 여정을 멈췄다.
      //   상한 = 같은 묶음(여정 · 칸 · 발송일) 하루 PRETEST_CHECK_ERROR_MAX 번. 넘으면 재검사 전 판은 보낼 수 없어 멈추고 알린다 ·
      //   이미 검사를 통과한 판은 그날 재검사를 접는다(켤 때 검사를 통과한 글 그대로 나간다 · 운영 경보로 사람이 본다).
      if (verdict === 'error') {
        const n = (_checkErrors.get(b.bundleKey) || 0) + 1;
        _checkErrors.set(b.bundleKey, n);
        console.log(`[journey-pretest-scan] 스팸 검사 장애 ${n}/${PRETEST_CHECK_ERROR_MAX}(문안은 그대로 · 다음 회차 다시) journey=${b.journeyId} step=${b.stepId} — ${tests.map((t) => t.error).filter(Boolean).join(' · ') || 'timeout'}`);
        if (n < PRETEST_CHECK_ERROR_MAX) continue;
        _checkErrors.delete(b.bundleKey);
        if (unchecked) {
          summary.paused++;
          await pauseJourney(b.journeyId, '발송 2시간 전 스팸필터 검사를 마치지 못해(검사 장애) 고친 문안을 보내지 않고 여정을 멈췄습니다. 잠시 뒤 다시 켜 주세요.');
          await safeNotify(b, body, 'pretest_paused');
          await recordSchedule(b, 'paused');
        } else {
          await recordSchedule(b, 'cancelled');
        }
        void sendSystemAlert({
          dedupKey: `journey-pretest-check-error:${b.journeyId}`,
          message: `여정 발송 2시간 전 스팸 검사를 ${PRETEST_CHECK_ERROR_MAX}번 연속 마치지 못했습니다(검사 장애 · ${unchecked ? '고친 문안 = 여정 멈춤' : '켤 때 통과한 문안 그대로 발송'}). journey=${b.journeyId} step=${b.stepId}`,
        }).catch(() => undefined);
        continue;
      }

      // ★ 2026-10-25 #1 — 변이 칸은 자동으로 고치지 않는다(켜진 여정의 변이는 사람이 고칠 수 없는 칸이라 모르는 문안으로 바꾸지 않는다 · 덜 보내는 방향).
      if (variantRows.length > 0) {
        summary.paused++;
        await pauseJourney(b.journeyId, '발송 2시간 전 스팸필터 통과 실패 (A/B 문안 중 차단). 문안 직접 확인 필요');
        await safeNotify(b, body, 'pretest_paused');
        await recordSchedule(b, 'paused');
        continue;
      }

      // ★ 2026-10-25 Codex 1R(R5) — 원 문안 차단 확인 = 그 판을 바로 「검사 전」(0)으로 내린다. 실행기는 검사 전 판을 보내지 않고 기다린다.
      //   고친 문안이 통과할 때만 100(아래) · 고친 문안 검사 장애로 다시 볼 때도 보류 유지(옛: 장애 재시도 동안 100 그대로라 차단된 원 문안이 나갈 수 있었다).
      if (snap) await query(`UPDATE journey_step_snapshots SET confidence_score = 0 WHERE id = $1::uuid`, [snap.id]);

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
          if (n < PRETEST_CHECK_ERROR_MAX) continue;
          _checkErrors.delete(b.bundleKey);
          summary.paused++;
          // 원 문안은 차단이었다 → 멈춘 이유 = 문안(「스팸필터」 사유 · 문안 고치기)
          await pauseJourney(b.journeyId, '발송 2시간 전 스팸필터 통과 실패 (고친 문안을 검사하지 못함). 문안 직접 확인 필요');
          await safeNotify(b, body, 'pretest_paused');
          await recordSchedule(b, 'paused');
          continue;
        }
        if (r2.verdict === 'pass') {
          // ★ 2026-10-18 J2 — 사람이 본 적 없는 문안으로 바뀐다 · 단계 알림 설정과 상관없이 늘 알린다(설계서 2026-10-18 §0).
          // ★ Codex C 1R — **먼저 알리고, 알린 뒤에만** 발송 본문을 바꾼다. 못 알리면(문자 큐 장애) 바꾸지 않고 여정을 멈춘다
          //   (옛: 본문을 먼저 바꾸고 통지 실패를 삼킨 채 기록 → 담당자가 모르는 문안이 2시간 뒤 나간다).
          if (!(await safeNotify(b, regenBody, 'pretest_autofixed'))) {
            summary.paused++;
            await pauseJourney(b.journeyId, '발송 2시간 전 스팸필터를 통과하도록 고친 문안을 담당자에게 알리지 못해 여정을 멈췄습니다. 문안을 확인한 뒤 재개해 주세요.');
            await safeNotify(b, body, 'pretest_paused');
            await recordSchedule(b, 'paused');
            continue;
          }
          await query(`UPDATE journey_step_snapshots SET message_body = $2, confidence_score = 100 WHERE id = $1::uuid`, [snap.id, regenBody]);   // ★ 1019 B-1009-6 고친 문안 = 검사 통과
          summary.passed++;
          await recordSchedule(b, 'notified');
          continue;
        }
      }

      // 재생성으로도 통과 못 함 → 여정 정지 + 담당자 수동확인 안내.
      summary.paused++;
      await pauseJourney(b.journeyId, '발송 2시간 전 스팸필터 통과 실패 (자동 재생성 후에도 차단). 문안 직접 확인 필요');
      await safeNotify(b, body, 'pretest_paused');
      await recordSchedule(b, 'paused');
    } catch (bundleErr: any) {
      console.log(`[journey-pretest-scan] bundle 처리 실패 journey=${b.journeyId} step=${b.stepId} — ${bundleErr?.message || bundleErr}`);
    }
  }

  console.log(`[journey-pretest-scan] 완료 — scanned=${summary.scanned} bundles=${summary.bundles} tested=${summary.tested} passed=${summary.passed} regen=${summary.regenerated} paused=${summary.paused}`);
  return summary;
}

/** ★ 2026-10-19 B-1009-6 — 검사한 그 스냅샷(판) = 통과(실행기 재검사 전 관문 · journey-builder 수정 스냅샷 = 0). 판 id 로 올려 검사 중 새 수정본은 0 으로 남는다. */
async function markSnapshotChecked(snapshotId: string): Promise<void> {
  await query(`UPDATE journey_step_snapshots SET confidence_score = 100 WHERE id = $1::uuid AND confidence_score < 100`, [snapshotId]);
}

async function recordSchedule(b: PretestBundle, status: string): Promise<void> {
  await query(
    `INSERT INTO journey_pretest_schedules
       (company_id, journey_id, step_id, execution_id, scheduled_send_at, notify_at, status)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, NOW(), $6)`,
    [b.companyId, b.journeyId, b.stepId, b.executionId, b.scheduledSendAt, status]
  );
}

/** 반환 = 알림이 실패하지 않았는가(받을 담당자가 없거나 시연 회사 = 보낼 것이 없음 = true · 큐 적재 0건 · 오류 = false) */
async function safeNotify(b: PretestBundle, preview: string, mode: PretestMode): Promise<boolean> {
  try {
    const ok = await notifyManagerForStep(b, preview, mode);
    if (!ok) console.log(`[journey-pretest-scan] 담당자 알림 큐 적재 0건 journey=${b.journeyId} mode=${mode}`);
    return ok;
  } catch (e: any) {
    console.log(`[journey-pretest-scan] 담당자 알림 실패(skip) journey=${b.journeyId} — ${e?.message || e}`);
    return false;
  }
}

// ── 담당자 LMS 알림 (2시간 전 안내 / 자동보정 / 정지) — 인증 라인 큐 ──
/** 반환 = 보낼 것이 없었거나(시연 회사 · 담당자 없음 · 번호 형식 아님) 큐에 실제로 한 건 들어갔다(★ Codex C 2R · 적재 0건 = false) */
async function notifyManagerForStep(b: PretestBundle, messagePreview: string, mode: PretestMode): Promise<boolean> {
  if (await isDemoCompany(b.companyId)) return true;   // ★ 2026-10-09 시연 회사 = 담당자 문자 0(설계서 docs/2026-10-09-demo-company-design.md §2)
  const managerRes = await query(
    `SELECT phone_number FROM kakao_alarm_users
      WHERE company_id = $1 AND COALESCE(active_yn, 'Y') = 'Y'
      ORDER BY created_at ASC LIMIT 1`,
    [b.companyId]
  );
  if (managerRes.rows.length === 0) return true;
  const managerPhone = String(managerRes.rows[0].phone_number).replace(/\D/g, '');
  if (!/^01\d{8,9}$/.test(managerPhone)) return true;

  // ★ 2026-10-18 정지 링크 — 받는 번호 · 발송 날짜를 토큰에 싣고 주소는 # 뒤(설계서 2026-10-18 §3-1).
  //   서명 키가 없으면 발급이 던진다 → 링크 줄만 빼고 안내는 보낸다(B10 · pretest_paused 는 여정이 이미 멈췄다).
  let pauseUrl: string | null = null;
  try {
    const pauseToken = await generatePauseToken({
      stepId: b.stepId, executionId: b.executionId, companyId: b.companyId, journeyId: b.journeyId,
      phone: managerPhone, sendDate: b.sendDateKst,
    });
    pauseUrl = buildJourneyPauseUrl(pauseToken);
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

  const lmsBody = buildPretestLmsBody({
    journeyName, stepOrder, scheduledSendAt: b.scheduledSendAt,
    messagePreview: String(messagePreview).slice(0, 100), pauseUrl, mode,
  });

  const authTable = await getAuthSmsTable();
  const inserted = await bulkInsertSmsQueue(
    [authTable],
    [[
      managerPhone,                // dest_no
      getPlatformNoticeCallback(), // call_back — ★ 2026-07-09 한줄로 대표번호(옛: 수신자 본인 번호=번호도용차단 미수신)
      lmsBody,                 // msg_contents
      'L',                     // msg_type (LMS)
      titleForMode(mode).slice(0, 40), // title_str
      null,                    // sendreq_time (useNow)
      '',                      // app_etc1
      b.companyId,             // app_etc2
      '', '', '',              // file_name1~3
    ]],
    true
  );
  return inserted === 1;
}

function titleForMode(mode: PretestMode): string {
  if (mode === 'pretest_autofixed') return '[발송 전 자동 보정 안내]';
  if (mode === 'pretest_paused') return '[발송 정지 안내]';
  return '[발송 2시간 전 안내]';
}

export function buildPretestLmsBody(params: {
  journeyName: string; stepOrder: number; scheduledSendAt: Date;
  messagePreview: string; pauseUrl: string | null; mode: PretestMode;
}): string {
  const dateStr = new Date(params.scheduledSendAt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const head =
    params.mode === 'pretest_autofixed'
      ? '[발송 전 자동 보정 안내]\n스팸필터에 걸려 문안을 자동으로 보정했습니다. 아래 내용으로 발송됩니다.'
      : params.mode === 'pretest_paused'
        ? '[발송 정지 안내]\n스팸필터를 통과하지 못해 발송을 정지했습니다. 문안을 직접 확인해 주세요.'
        : '[발송 2시간 전 안내]';
  return [
    head, '',
    `여정: ${params.journeyName}`,
    `step ${params.stepOrder}`,
    `발송 예정: ${dateStr}`,
    '', '본문 미리보기:', params.messagePreview,
    ...(params.pauseUrl
      ? ['', `${params.mode === 'pretest_paused' ? '확인·여정 일시정지' : '즉시 정지'}: ${params.pauseUrl}`]
      : ['', '정지가 필요하면 한줄로 여정 화면에서 일시정지해 주세요.']),
  ].join('\n');
}
