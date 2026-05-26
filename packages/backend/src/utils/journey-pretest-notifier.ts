// packages/backend/src/utils/journey-pretest-notifier.ts
// CT-93: 여정 발송 2시간 전 담당자 자동 알림 (D218+ 신설)
//   - 활성화 시점 = 다음 7일 트리거 예측 + 알림 스케줄 INSERT
//   - 5분 cron worker = notify_at 도달 schedule 발송 (journey-pretest-notifier-worker.ts)
//   - LMS 본문 = 치환된 본문 + 발송 예정시각 + 타겟 수 + 즉시 정지 단축 URL
//
// 옛 활용 영역:
//   - kakao_alarm_users 첫 활성 phone (D218+ Fix A 정합)
//   - getAuthSmsTable + bulkInsertSmsQueue (CT-04)
//   - generatePauseToken (CT-94)
//   - journey_step_snapshots (활성화 시점 본문)

import { query } from '../config/database';
import { generatePauseToken } from './journey-pause-handler';
import { getAuthSmsTable, bulkInsertSmsQueue } from './sms-queue';

/**
 * 여정 활성화 시점 = 다음 7일 트리거 예측 + 알림 스케줄 INSERT.
 * step별 default (첫/마지막 ON / 중간 OFF) — 회사 admin 명시 변경 가능.
 */
export async function scheduleNotificationsForActivation(
  companyId: string,
  journeyId: string,
): Promise<{ scheduledCount: number }> {
  // step 조회 + step별 default 적용
  const stepsRes = await query(
    `SELECT s.id, s.notify_manager_on_pretest, s.step_order,
            (SELECT COUNT(*) FROM journey_steps WHERE journey_id = s.journey_id) AS total_steps
       FROM journey_steps s
      WHERE s.journey_id = $1
        AND COALESCE(s.step_type, 'message') = 'message'
      ORDER BY s.step_order ASC`,
    [journeyId],
  );
  const steps = stepsRes.rows;

  const stepsToNotify = steps.filter((s: any) => {
    if (s.notify_manager_on_pretest === true) return true;
    if (s.notify_manager_on_pretest === false) return false;
    // NULL = default 정합 (첫/마지막 ON / 중간 OFF)
    return s.step_order === 1 || Number(s.step_order) === Number(s.total_steps);
  });

  let scheduledCount = 0;
  for (const step of stepsToNotify) {
    const nextSendTimes = await predictNextSendTimes(step.id, 7);
    for (const sendAt of nextSendTimes) {
      const notifyAt = new Date(sendAt.getTime() - 2 * 60 * 60 * 1000);
      // 옛 notify_at 시점이 과거 시점 시 = skip (예약 무의미)
      if (notifyAt.getTime() < Date.now()) continue;

      await query(
        `INSERT INTO journey_pretest_schedules
           (company_id, journey_id, step_id, scheduled_send_at, notify_at, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [companyId, journeyId, step.id, sendAt, notifyAt],
      );
      scheduledCount += 1;
    }
  }

  return { scheduledCount };
}

/**
 * 옛 7일 트리거 발화 패턴 분석 + 다음 N일 동일 시각대 추정.
 */
async function predictNextSendTimes(stepId: string, days: number): Promise<Date[]> {
  const patternRes = await query(
    `SELECT scheduled_at FROM journey_executions
      WHERE step_id = $1
        AND scheduled_at >= NOW() - INTERVAL '7 days'
        AND status IN ('completed', 'sent', 'pending')
      ORDER BY scheduled_at DESC
      LIMIT 50`,
    [stepId],
  );
  if (patternRes.rows.length === 0) {
    // 옛 발화 패턴 0건 = 다음 N일 default 10시 KST 추정 (보수 추정)
    const out: Date[] = [];
    for (let i = 1; i <= days; i++) {
      const next = new Date();
      next.setDate(next.getDate() + i);
      next.setHours(10, 0, 0, 0);
      out.push(next);
    }
    return out;
  }

  // 평균 시각대 추출
  const avgHour = Math.round(
    patternRes.rows.reduce((sum: number, r: any) => sum + new Date(r.scheduled_at).getHours(), 0) /
      patternRes.rows.length,
  );

  const out: Date[] = [];
  for (let i = 1; i <= days; i++) {
    const next = new Date();
    next.setDate(next.getDate() + i);
    next.setHours(avgHour, 0, 0, 0);
    out.push(next);
  }
  return out;
}

/**
 * 실제 LMS 발송 — snapshot + 실시간 타겟 수 + 단축 URL.
 * worker 5분 cron 안 호출.
 */
export async function sendPretestNotification(scheduleId: string): Promise<void> {
  const schedRes = await query(
    `SELECT * FROM journey_pretest_schedules WHERE id = $1 AND status = 'pending'`,
    [scheduleId],
  );
  if (schedRes.rows.length === 0) return;
  const sched = schedRes.rows[0];

  // snapshot 조회 (활성화 시점 본문)
  const snapRes = await query(
    `SELECT * FROM journey_step_snapshots
      WHERE step_id = $1 AND journey_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [sched.step_id, sched.journey_id],
  );
  if (snapRes.rows.length === 0) {
    await query(`UPDATE journey_pretest_schedules SET status = 'cancelled' WHERE id = $1`, [scheduleId]);
    return;
  }
  const snapshot = snapRes.rows[0];

  // 실시간 타겟 수 재조회 (단순 COUNT — customer-filter 활용 영역 X)
  const targetRes = await query(
    `SELECT COUNT(*)::int AS cnt FROM customers WHERE company_id = $1 AND sms_opt_in = true`,
    [sched.company_id],
  );
  const targetCount = Number(targetRes.rows[0]?.cnt || 0);

  // 담당자 phone 조회 (옛 D218+ Fix A 정합)
  const managerRes = await query(
    `SELECT phone_number FROM kakao_alarm_users
      WHERE company_id = $1 AND COALESCE(active_yn, 'Y') = 'Y'
      ORDER BY created_at ASC LIMIT 1`,
    [sched.company_id],
  );
  if (managerRes.rows.length === 0) {
    // 담당자 등록 X = 알림 skip + cancelled 처리
    await query(`UPDATE journey_pretest_schedules SET status = 'cancelled' WHERE id = $1`, [scheduleId]);
    return;
  }
  const managerPhone = String(managerRes.rows[0].phone_number).replace(/\D/g, '');
  if (!/^01\d{8,9}$/.test(managerPhone)) {
    await query(`UPDATE journey_pretest_schedules SET status = 'cancelled' WHERE id = $1`, [scheduleId]);
    return;
  }

  // 정지 token 발급 (24h TTL)
  const pauseToken = await generatePauseToken({
    stepId: sched.step_id,
    executionId: sched.execution_id || null,
    companyId: sched.company_id,
    journeyId: sched.journey_id,
  });
  const baseUrl = process.env.SHORT_URL_BASE || 'https://hanjul.ai';
  const pauseUrl = `${baseUrl}/journey-pause/${pauseToken}`;

  // 여정 명 + step 명 조회
  const journeyRes = await query(
    `SELECT j.name AS journey_name, s.step_order, s.channel
       FROM journeys j
       JOIN journey_steps s ON s.journey_id = j.id
      WHERE j.id = $1 AND s.id = $2`,
    [sched.journey_id, sched.step_id],
  );
  const journeyName = journeyRes.rows[0]?.journey_name || '여정 자동 발송';
  const stepOrder = journeyRes.rows[0]?.step_order || 0;

  // LMS 본문 빌드
  const lmsBody = buildPretestLmsBody({
    journeyName,
    stepOrder: Number(stepOrder),
    scheduledSendAt: sched.scheduled_send_at,
    targetCount,
    messagePreview: String(snapshot.message_body || '').slice(0, 100),
    pauseUrl,
  });

  // 옛 인증 라인 LMS 큐 INSERT
  const authTable = await getAuthSmsTable();
  await bulkInsertSmsQueue(
    [authTable],
    [
      [
        managerPhone,        // dest_no
        managerPhone,        // call_back (담당자 본인 phone)
        lmsBody,             // msg_contents
        'L',                 // msg_type (LMS)
        `[발송 2시간 전 안내]`.slice(0, 40), // title_str
        null,                // sendreq_time (useNow=true)
        '',                  // app_etc1
        sched.company_id,    // app_etc2
        '',                  // file_name1
        '',                  // file_name2
        '',                  // file_name3
      ],
    ],
    true,
  );

  await query(
    `UPDATE journey_pretest_schedules SET status = 'notified', notified_at = NOW() WHERE id = $1`,
    [scheduleId],
  );
}

function buildPretestLmsBody(params: {
  journeyName: string;
  stepOrder: number;
  scheduledSendAt: Date;
  targetCount: number;
  messagePreview: string;
  pauseUrl: string;
}): string {
  const dateStr = new Date(params.scheduledSendAt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return [
    `[발송 2시간 전 안내]`,
    ``,
    `여정: ${params.journeyName}`,
    `step ${params.stepOrder}`,
    `발송 예정: ${dateStr}`,
    `타겟: ${params.targetCount.toLocaleString()}명`,
    ``,
    `본문 미리보기:`,
    params.messagePreview,
    ``,
    `즉시 정지: ${params.pauseUrl}`,
  ].join('\n');
}
