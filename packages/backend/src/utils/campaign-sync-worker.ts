// ===========================================================================
// utils/campaign-sync-worker.ts — 캠페인 결과 자동 sync 백그라운드 워커
// ---------------------------------------------------------------------------
// ★ D151 (2026-05-11) 신설 — 1년 반복 환불 누락 사고 근본 해결
//
// 사고 패턴:
//   발송 직후 fire-and-forget 1차 sync (Dashboard.tsx:1139 / ResultsModal.tsx:110)
//   → MySQL 결과 일부 박힘 → 일부 환불됨
//   → 그 후 누구도 Dashboard 안 들어가면 sync 0회 → 대기→실패 전환 못 잡음
//   → 추가 환불 트리거 0건 (스킨큐어 5/11: 547건 중 251건만 환불, 293건 누락 영구화)
//
// 해결:
//   매 5분마다 자동 sync — 사용자 화면 진입 무관.
//   syncCampaignResults는 idempotent(target > success+fail 캠페인만 처리)라 중복 호출 안전.
//   prepaidRefund도 D145 P0+ idempotent 패턴 박혀 차액만 환불.
//
// 패턴 기준: utils/auto-campaign-worker.ts / trial-downgrade-worker.ts 의 setInterval 패턴 미러
// ===========================================================================

import { query } from '../config/database';
import { syncCampaignResults } from './campaign-lifecycle';
import { getAuthSmsTable, bulkInsertSmsQueue, getCompanySmsTablesWithLogs, smsCountAll } from './sms-queue';
import { SUCCESS_CODES, PENDING_CODES } from './sms-result-map';

const INTERVAL_MS = 5 * 60 * 1000; // 5분
const BOOT_DELAY_MS = 60 * 1000;   // 서버 startup 안정화 후 첫 실행

let _timer: NodeJS.Timeout | null = null;
let _boot: NodeJS.Timeout | null = null;
let _running = false;

function log(...args: any[]) {
  console.log('[campaign-sync-worker]', ...args);
}

/**
 * 1회 sync 사이클:
 *   1) 최근 24h 내 pending > 0 (target > success+fail) 캠페인이 있는 회사 ID 추출 (campaigns + campaign_runs)
 *   2) 각 companyId 로 syncCampaignResults 호출 (함수 내부에서 회사별 일괄 처리)
 *   3) syncCount 합계 로깅
 */
async function runOnce(): Promise<void> {
  if (_running) {
    log('이전 실행 진행 중 → skip');
    return;
  }
  _running = true;
  const startedAt = Date.now();
  try {
    // ★ D228+ (2026-05-30) 발송결과 속도 — 완료 6h 경과 캠페인 result_final 마킹.
    //   sync 대상 회사 유무와 독립이므로 사이클 진입 직후 항상 실행 (조기 return 전에 수행).
    try {
      await markFinalizedCampaigns();
    } catch (markErr: any) {
      log('result_final 마킹 오류 (skip):', markErr?.message || markErr);
    }

    // ★ 2026-06-10: 확정 후 재대조 — 굳은 카운트·failed 오판을 시스템이 스스로 MySQL 진실과 재정렬.
    try {
      await reconcileFinalizedCampaigns();
    } catch (reconErr: any) {
      log('재대조 오류 (skip):', reconErr?.message || reconErr);
    }

    const r = await query(`
      SELECT DISTINCT company_id FROM (
        SELECT c.company_id
        FROM campaigns c
        WHERE COALESCE(c.scheduled_at, c.sent_at, c.created_at) >= NOW() - INTERVAL '24 hours'
          AND c.status IN ('sending', 'scheduled', 'completed')
          AND c.target_count IS NOT NULL
          AND c.target_count > COALESCE(c.success_count, 0) + COALESCE(c.fail_count, 0)
        UNION
        SELECT c.company_id
        FROM campaign_runs cr
        JOIN campaigns c ON c.id = cr.campaign_id
        WHERE COALESCE(c.scheduled_at, c.sent_at, cr.created_at) >= NOW() - INTERVAL '24 hours'
          AND cr.status IN ('sending', 'scheduled', 'completed')
          AND cr.target_count IS NOT NULL
          AND cr.target_count > COALESCE(cr.success_count, 0) + COALESCE(cr.fail_count, 0)
      ) AS u
    `);

    if (r.rows.length === 0) {
      log('대상 회사 0개 → 종료');
      return;
    }

    log(`대상 회사 ${r.rows.length}개 sync 시작`);
    let okCount = 0;
    let failCount = 0;
    let totalSynced = 0;
    for (const row of r.rows) {
      const companyId = row.company_id;
      try {
        const res = await syncCampaignResults(companyId);
        okCount++;
        totalSynced += res.syncCount || 0;
        if (res.syncCount > 0) {
          log(`✓ companyId=${companyId} synced ${res.syncCount}건`);
        }
      } catch (err: any) {
        failCount++;
        log(`✗ companyId=${companyId} 실패:`, err?.message || err);
      }
    }
    const elapsedMs = Date.now() - startedAt;
    log(`사이클 완료 — 회사 ok ${okCount} / fail ${failCount}, 총 sync ${totalSynced}건, ${elapsedMs}ms`);

    // ★ D218+ (2026-05-26) 여정 발송 결과 알림 LMS 통합 — 첫/마지막 step default ON.
    //   본 영역 = sync 종결 직후 = 통신사 reply 수집 완료 영역.
    //   step별 default (첫/마지막 ON / 중간 OFF) 적용 + kakao_alarm_users 첫 활성 phone fallback.
    try {
      await notifyJourneyResultsToManagers();
    } catch (notifyErr: any) {
      log('여정 결과 알림 사고 (skip):', notifyErr?.message || notifyErr);
    }
  } catch (err: any) {
    log('전체 오류:', err?.message || err);
  } finally {
    _running = false;
  }
}

/**
 * ★ D218+ (2026-05-26) 여정 발송 결과 알림 LMS — 첫/마지막 step default ON.
 *   - journey_executions.status='completed' + result_notified_at IS NULL + 최근 2h 완료 대상.
 *   - notify_manager_on_pretest TRUE = 무조건 발송 / NULL = 첫/마지막 step default ON / FALSE = skip.
 *   - 담당자 phone = kakao_alarm_users 첫 활성 (옛 D218+ Fix A 정합).
 *   - LMS 본문 = 여정명 + step + 성공/실패 카운트 + 다음 step 예정 영역.
 *   - 발송 종결 후 result_notified_at = NOW() UPDATE (재발송 차단 의무).
 */
async function notifyJourneyResultsToManagers(): Promise<void> {
  const completedRes = await query(
    `SELECT e.id AS execution_id, j.company_id, e.journey_id, e.current_step_order,
            j.name AS journey_name,
            s.id AS step_id, s.step_order, s.notify_manager_on_pretest, s.channel,
            (SELECT COUNT(*) FROM journey_steps WHERE journey_id = e.journey_id AND COALESCE(step_type,'message')='message') AS total_steps,
            (SELECT COUNT(*) FROM journey_step_logs jsl WHERE jsl.execution_id = e.id AND jsl.status = 'sent') AS success_count,
            (SELECT COUNT(*) FROM journey_step_logs jsl WHERE jsl.execution_id = e.id AND jsl.status = 'failed') AS failed_count
       FROM journey_executions e
       JOIN journeys j ON j.id = e.journey_id
       JOIN journey_steps s ON s.journey_id = e.journey_id AND s.step_order = e.current_step_order
      WHERE e.status = 'completed'
        AND e.result_notified_at IS NULL
        AND e.completed_at IS NOT NULL
        AND e.completed_at >= NOW() - INTERVAL '2 hours'
        AND COALESCE(s.step_type, 'message') = 'message'
      ORDER BY e.completed_at DESC
      LIMIT 50`
  );

  if (completedRes.rows.length === 0) return;

  for (const exec of completedRes.rows) {
    try {
      // step별 default 적용 — 첫/마지막 ON / 중간 OFF / 명시 TRUE/FALSE 우선.
      const totalSteps = Number(exec.total_steps || 0);
      const stepOrder = Number(exec.step_order || 0);
      const shouldNotify =
        exec.notify_manager_on_pretest === true ||
        (exec.notify_manager_on_pretest === null &&
          (stepOrder === 1 || stepOrder === totalSteps));

      if (!shouldNotify) {
        // 알림 skip — result_notified_at UPDATE 의무 (중복 조회 차단)
        await query(`UPDATE journey_executions SET result_notified_at = NOW() WHERE id = $1::uuid`, [exec.execution_id]);
        continue;
      }

      // 담당자 phone 조회 (kakao_alarm_users 첫 활성 — D218+ Fix A fallback)
      const mgrRes = await query(
        `SELECT phone_number FROM kakao_alarm_users
          WHERE company_id = $1::uuid AND COALESCE(active_yn,'Y')='Y'
          ORDER BY created_at ASC LIMIT 1`,
        [exec.company_id],
      );
      if (mgrRes.rows.length === 0) {
        // 담당자 등록 X = 발송 skip + 재조회 차단 UPDATE
        await query(`UPDATE journey_executions SET result_notified_at = NOW() WHERE id = $1::uuid`, [exec.execution_id]);
        continue;
      }
      const managerPhone = String(mgrRes.rows[0].phone_number).replace(/\D/g, '');
      if (!/^01\d{8,9}$/.test(managerPhone)) {
        await query(`UPDATE journey_executions SET result_notified_at = NOW() WHERE id = $1::uuid`, [exec.execution_id]);
        continue;
      }

      // LMS 본문 빌드
      const successCount = Number(exec.success_count || 0);
      const failedCount = Number(exec.failed_count || 0);
      const isLastStep = stepOrder === totalSteps;
      const lmsBody = [
        `[여정 발송 결과]`,
        ``,
        `여정: ${exec.journey_name || '여정 자동 발송'}`,
        `step ${stepOrder} / ${totalSteps} ${isLastStep ? '(최종)' : ''}`,
        `성공: ${successCount}건 / 실패: ${failedCount}건`,
        ``,
        isLastStep ? '여정 완료 — 다음 step 없음' : '다음 step 자동 진행 예정',
      ].join('\n');

      const authTable = await getAuthSmsTable();
      await bulkInsertSmsQueue(
        [authTable],
        [[
          managerPhone,
          managerPhone,
          lmsBody,
          'L',
          `[여정 발송 결과]`.slice(0, 40),
          null,
          '',
          exec.company_id,
          '',
          '',
          '',
        ]],
        true,
      );

      await query(`UPDATE journey_executions SET result_notified_at = NOW() WHERE id = $1::uuid`, [exec.execution_id]);
      log(`✓ 여정 결과 LMS 발송 execution=${exec.execution_id} journey=${exec.journey_name} step=${stepOrder}`);
    } catch (oneErr: any) {
      log(`✗ 여정 결과 알림 1건 사고 execution=${exec.execution_id}:`, oneErr?.message || oneErr);
    }
  }
}

/**
 * ★ D228+ (2026-05-30) 발송결과 속도 — 완료 캠페인 result_final 확정.
 *   발송 6시간 경과 + status terminal(completed/failed) = 통신사 응답 완료
 *   (D182 통신사 응답 99%ile 120분 내 + 안전 마진 3배).
 *   이 시점 PG success/fail/sent_count는 두 워커가 MySQL과 일치시켜 둔 불변 확정값:
 *     - 선불: mysql-refund-sweeper(30초 cron)가 PG=MySQL 갱신 (14일 윈도우, result_final 무관 지속)
 *     - 후불: syncCampaignResults(5분 cron)가 갱신
 *   result_final=true 후 results.ts가 PG만 읽어 MySQL 집계 3종(카운트/카카오/발송시각)을 제거.
 *
 *   ★ 부작용 없음 — 플래그/타임스탬프만 UPDATE. 집계·환불 호출 X. 돈 경로(syncCampaignResults/sweeper) 무수정.
 *   ★ D144 교훈대로 — "완료 판정된 것만 캐시 신뢰". 진행 중(<6h)은 result_final=false라 MySQL 실시간 유지.
 *   ★ 2026-06-05: 확정 조건에 success+fail >= sent_count 추가 — 완전 집계분만 캐시 확정.
 *     미완성(LIVE→LOG 이동 중 등)이 과소 확정돼 발송결과가 실제보다 적게 굳던 문제 차단.
 */
async function markFinalizedCampaigns(): Promise<void> {
  const r = await query(`
    UPDATE campaigns
       SET result_final = true,
           result_synced_at = NOW()
     WHERE result_final = false
       AND status IN ('completed', 'failed')
       AND sent_at IS NOT NULL
       AND COALESCE(scheduled_at, sent_at) < NOW() - INTERVAL '6 hours'
       AND sent_count > 0
       AND (COALESCE(success_count, 0) + COALESCE(fail_count, 0)) >= sent_count
  `);
  if (r.rowCount && r.rowCount > 0) {
    log(`result_final 확정 ${r.rowCount}건 (발송 6h 경과 완료 캠페인 → PG 캐시 전환)`);
  }
}

/**
 * ★ 2026-06-10 확정 후 재대조 — "한 번 굳으면 다시 안 본다"는 빈틈의 근본 차단.
 *   배경 두 가지(같은 뿌리):
 *   (1) failed 오판 복원 — 시세이도·에이치피오 예약발송이 라인 라우팅 0건 조회로 status='failed'
 *       (counts 0/0)가 됐는데 실제 발송은 정상. 복원 경로가 없어 사용자 화면에 실패로 남음.
 *   (2) 확정 후 늦은 결과 흡수 — 후불 회사는 result_final 확정 후 PG를 다시 맞추는 워커가 없어
 *       (선불은 mysql-refund-sweeper가 지속 보정) 통신사 결과가 늦으면 캐시가 과소로 영구 굳음
 *       (리스킨 33건 — 상세 17,192 vs 목록 17,159).
 *
 *   동작: 발송시각 기준 21일 안 대상 캠페인을 MySQL 실집계(전 라인 합집합)로 재대조.
 *   - failed 무리: 발송 +10분 후부터 — MySQL에 발송 기록이 있으면 status='completed' 복원 + counts 교정
 *   - 확정(completed+result_final) 무리: 발송 +24시간에 1회 재검증 — 늦은 결과 반영
 *   멱등 마커 = result_synced_at (재대조 시 NOW()로 갱신 → 발송+24h를 넘기면 자연 종료, 신규 컬럼 0).
 *   돈 경로 무수정 — 환불은 sweeper(선불), 청구는 MySQL 직접 집계(후불)가 기존대로 담당.
 */
const RECONCILE_BATCH = 50;

async function reconcileFinalizedCampaigns(): Promise<void> {
  const targets = await query(`
    SELECT id, company_id, status, success_count, fail_count, sent_count,
           COALESCE(scheduled_at, sent_at) AS send_base
      FROM campaigns
     WHERE (
             (status = 'failed'
               AND COALESCE(scheduled_at, sent_at) < NOW() - INTERVAL '10 minutes')
          OR (status = 'completed' AND result_final = true
               AND COALESCE(scheduled_at, sent_at) < NOW() - INTERVAL '24 hours')
           )
       AND COALESCE(scheduled_at, sent_at) >= NOW() - INTERVAL '21 days'
       AND (result_synced_at IS NULL
            OR result_synced_at < COALESCE(scheduled_at, sent_at) + INTERVAL '24 hours')
       -- 같은 캠페인 반복 집계 차단 — 마지막 재대조 후 1시간 지나야 재확인 (MySQL 부하 상한)
       AND (result_synced_at IS NULL OR result_synced_at < NOW() - INTERVAL '1 hour')
     ORDER BY COALESCE(scheduled_at, sent_at) ASC
     LIMIT ${RECONCILE_BATCH}
  `);
  if (targets.rows.length === 0) return;

  let fixed = 0;
  for (const camp of targets.rows) {
    try {
      const tables = await getCompanySmsTablesWithLogs(camp.company_id);
      const sentCount = await smsCountAll(tables, 'app_etc1 = ?', [camp.id]);
      const successCount = await smsCountAll(tables, `app_etc1 = ? AND status_code IN (${SUCCESS_CODES.join(',')})`, [camp.id]);
      const failCount = await smsCountAll(tables, `app_etc1 = ? AND status_code NOT IN (${[...SUCCESS_CODES, ...PENDING_CODES].join(',')})`, [camp.id]);

      // 발송 기록이 있는 failed = 오판 → completed 복원. 진짜 0건 실패는 failed 유지.
      const newStatus = (camp.status === 'failed' && sentCount > 0) ? 'completed' : camp.status;
      const changed =
        newStatus !== camp.status ||
        sentCount !== Number(camp.sent_count || 0) ||
        successCount !== Number(camp.success_count || 0) ||
        failCount !== Number(camp.fail_count || 0);

      await query(
        `UPDATE campaigns
            SET status = $2, sent_count = $3, success_count = $4, fail_count = $5,
                result_synced_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [camp.id, newStatus, sentCount, successCount, failCount]
      );
      if (changed) {
        fixed++;
        log(`재대조 교정 campaign=${camp.id} status ${camp.status}→${newStatus}, ` +
            `succ ${camp.success_count}→${successCount}, fail ${camp.fail_count}→${failCount}, sent ${camp.sent_count}→${sentCount}`);
      }
    } catch (oneErr: any) {
      log(`재대조 1건 오류 campaign=${camp.id} (skip):`, oneErr?.message || oneErr);
    }
  }
  if (fixed > 0) log(`재대조 사이클 — 대상 ${targets.rows.length}건 중 ${fixed}건 교정`);
}

export function startCampaignSyncWorker(): void {
  if (_timer || _boot) return;
  log(`started — boot ${BOOT_DELAY_MS / 1000}초 후 첫 실행, 이후 ${INTERVAL_MS / 1000}초 주기`);
  _boot = setTimeout(() => {
    _boot = null;
    runOnce();
    _timer = setInterval(runOnce, INTERVAL_MS);
  }, BOOT_DELAY_MS);
}

export function stopCampaignSyncWorker(): void {
  if (_boot) {
    clearTimeout(_boot);
    _boot = null;
  }
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    log('stopped');
  }
}
