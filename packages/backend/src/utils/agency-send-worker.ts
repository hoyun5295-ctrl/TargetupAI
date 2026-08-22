/**
 * agency-send-worker.ts — 대행발송 워커 (★ 2026-08-22 신설)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §4-4. 상태·시각 판정은 `agency-send-state.ts`가 소유한다.
 *
 * 다섯 단계를 5분마다 돈다:
 *   A 1차 검사   received          → 스팸 검사(최대 3회, 걸리면 다듬어 재검사) → 담당자 테스트 발송 → 승인 대기
 *   B 당일 재검사 approved(2h 전)   → 통과: 캠페인 + 큐 적재 / 차단: 안내 후 다듬기 → 재승인 대기
 *   C 만료       승인 대기(2h 경과) → 발송하지 않고 안내
 *   D 대조       queued            ↔ campaigns.status (이중 진실 안전망)
 *   E 복구       lock 30분 초과     → 잡기 전 상태로 되돌린다
 *
 * ⛔ 큐 적재는 B에서 **한 번뿐**이다(불변 3). 승인은 상태만 바꾼다. 그래서 승인 뒤 취소에 지울 큐가 없다.
 * ⛔ 승인 없는 발송 0(불변 1) · 당일 검사 없는 발송 0(불변 2).
 *
 * ★ 2026-08-23 적재를 **직접발송 배관에 얹었다**(설계서 §12-1 정정). 전에는 이 파일이 캠페인 행을 만들고
 *   큐에 직접 넣었는데, 그 자리에서 배관의 계약이 통째로 빠져 있었다:
 *   선불 차감 0 · 후불 청구 축 0 · 수신거부 제외 0 · 부분 적재 롤백 0 · 재시도 멱등 0.
 *   지금은 `campaign_send_staging`에 넣고 `createDirectSendCampaign`을 부른다. 차감·정제·적재·
 *   미적재분 환불·`sentTables` 기록·적재 중 취소 감지는 전부 그쪽 CT가 소유한다.
 */
import { query } from '../config/database';
import { autoSpamTestWithRegenerate } from './spam-test-queue';
import { refineForSpam } from './agency-send-refine';
import {
  buildApprovedExpiredNotify, buildExpiredNotify, buildFinalBlockedNotify, buildPassedNotify,
  buildQueueFailedNotify, buildReapprovalNotify, buildTestFailedNotify, formatWhen, shortLabel,
} from './agency-send-notify';
import {
  isApprovalCurrent, isApprovalExpired, isFinalTestDue, isLockStale, isQueueDue, lockRecoveryStatus,
  MAX_TEST_ROUNDS, QUEUE_MARGIN_MINUTES, type AgencySendStatus,
} from './agency-send-state';
import { buildSlotPlan, toSlotValues } from './agency-send-vars';
import { bulkInsertSmsQueue, getAuthSmsTable, toKoreaTimeStr } from './sms-queue';
import { countStagingFiltered, createDirectSendCampaign } from './direct-send-core';
import { DirectSendError } from './direct-send-spec';
import { getOpt080Number, prepareFieldMappings, prepareSendMessage } from './messageUtils';
import { normalizePhone } from './normalize-phone';

const LOG = '[agency-send][worker]';
const TICK_MS = 5 * 60 * 1000;

/** 한 번에 처리할 건수. 검사 1건이 몇 분 걸려 넉넉히 잡을 이유가 없다 */
const BATCH = 5;

// ────────────── 공통 ──────────────

async function logEvent(requestId: string, kind: string, payload: Record<string, any> = {}): Promise<void> {
  try {
    await query(`INSERT INTO agency_send_events (request_id, kind, payload) VALUES ($1::uuid, $2, $3::jsonb)`,
      [requestId, kind, JSON.stringify(payload)]);
  } catch (err: any) {
    console.warn(`${LOG} 이력 기록 실패:`, err?.message);
  }
}

/**
 * 선점 표시(=lease) 값을 만든다.
 *
 * ⛔ `NOW()`를 쓰지 않는다(★2026-08-23 Codex 2R critical). PostgreSQL `timestamptz`는 마이크로초를 담는데
 *   드라이버는 그것을 밀리초짜리 `Date`로 파싱한다. `RETURNING`으로 받은 값을 다시 조건으로 보내면
 *   `.123456`과 `.123000`이 되어 **정상 소유자의 UPDATE도 0행**이 되고, 그 건은 lock 상태에 영구 고착된다.
 *   애플리케이션이 만든 밀리초 값을 쓰면 왕복이 정확히 보존된다.
 */
function newLease(): Date {
  return new Date();
}

/**
 * 상태를 바꾼다. **lease를 주면 그 lease를 쥐고 있을 때만 바뀐다**(★2026-08-23 Codex 적대 검토 critical).
 *
 * 워커가 잡은 뒤 lock 복구가 되돌리거나 담당자 요청이 끼어들면, 이 핸들러는 이미 남의 건을 들고 있는 것이다.
 * 조건 없이 쓰면 남이 바꿔 놓은 상태를 덮어 **취소한 건을 다시 예약하거나 두 벌로 만드는** 경로가 생긴다.
 * lease = 선점할 때 DB가 돌려준 `lock_at` 값 그대로다(내가 만든 시각이 아니라 기록된 값이라 정밀도가 어긋나지 않는다).
 *
 * @returns 실제로 바뀌었는가. false면 이 핸들러는 더 손대면 안 된다.
 */
async function setStatus(
  requestId: string, status: AgencySendStatus, extra: Record<string, any> = {}, lease?: any,
): Promise<boolean> {
  const sets = ['status = $2', 'updated_at = NOW()'];
  const params: any[] = [requestId, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i}`);
    params.push(val);
    i += 1;
  }
  let where = 'id = $1::uuid';
  if (lease !== undefined && lease !== null) {
    where += ` AND lock_at = $${i}`;
    params.push(lease);
  }
  const r = await query(`UPDATE agency_send_requests SET ${sets.join(', ')} WHERE ${where}`, params);
  const changed = (r.rowCount || 0) > 0;
  if (!changed && lease) {
    console.warn(`${LOG} lease를 잃어 상태 변경을 건너뛴다 request=${requestId} → ${status}`);
  }
  return changed;
}

/**
 * 담당자에게 문자를 보낸다. 안내와 테스트 문자 모두 이 함수를 지난다.
 * 인증 라인으로 보내는 이유 = 담당자 1명에게 가는 건이라 대량 라인을 점유하지 않는다(옛 워커와 같은 규칙).
 */
async function notifyManager(opts: {
  companyId: string;
  requestId: string;
  managerPhone: string;
  callback: string;
  text: string;
  title: string;
  msgType?: 'S' | 'L' | 'M';
  mmsImages?: string[];
}): Promise<void> {
  const phone = normalizePhone(opts.managerPhone);
  if (!phone) return;
  try {
    const table = await getAuthSmsTable();
    const images = opts.mmsImages || [];
    await bulkInsertSmsQueue(
      [table],
      [[
        phone, opts.callback, opts.text, opts.msgType || 'L', opts.title,
        toKoreaTimeStr(new Date()), null, opts.companyId,
        images[0] || '', images[1] || '', images[2] || '',
      ]],
      true,
      { companyId: opts.companyId, source: 'agency-send' } as any,
    );
  } catch (err: any) {
    // 안내를 못 보내도 본 흐름(상태 전이)은 멈추지 않는다. 화면에는 상태가 남는다
    console.error(`${LOG} 담당자 안내 실패 request=${opts.requestId}:`, err?.message);
    await logEvent(opts.requestId, 'notify_failed', { error: String(err?.message || '') });
  }
}

/**
 * 검사·테스트 문자에 쓸 문안 한 벌을 만든다(첫 수신자 기준 변수 치환 + 광고 부착).
 *
 * ⛔ 조립은 `prepareSendMessage` 하나를 지난다 — 실제 발송(`direct-send-processor`)이 부르는 함수와
 *   같아야 **검사한 문장 = 담당자가 본 문장 = 나가는 문장**이 된다(불변 4).
 * ⛔ 수신자 값은 문안 변수명이 아니라 **주소록 슬롯**으로 넘긴다. 치환 함수는 값을 DB 컬럼 이름으로
 *   찾기 때문에, 변수명을 키로 넘기면 하나도 못 찾고 전부 빈 문자열이 된다(2026-08-23 정정).
 */
async function buildSample(row: any): Promise<{ text: string; subject: string }> {
  const first = await query(
    `SELECT phone, vars FROM agency_send_recipients WHERE request_id = $1::uuid ORDER BY row_no LIMIT 1`,
    [row.id],
  );
  const plan = buildSlotPlan(String(row.current_content || ''));
  const slotValues = toSlotValues(first.rows[0]?.vars, plan.order);
  const mappings = await prepareFieldMappings(row.company_id);
  const opt080 = row.is_ad ? await getOpt080Number(row.created_by || null, row.company_id) : '';

  const { message, subject } = prepareSendMessage(plan.slotContent, {}, mappings, {
    msgType: row.message_type,
    isAd: !!row.is_ad,
    opt080Number: opt080,
    addressBookFields: slotValues,
    subject: String(row.subject || ''),
    skipNumberFormatting: true,
  });
  return { text: message, subject };
}

/**
 * 스팸 검사 한 판. 걸리면 다듬어 다시 본다.
 * ⛔ 다듬은 문안은 `refineForSpam`의 검사를 통과한 것만 쓴다 — 날짜·번호·링크가 바뀐 문안은 버린다.
 */
async function runSpamRound(row: any, startRound: number): Promise<{
  passed: boolean;
  finalContent: string;   // 치환 전 원문 기준(원장에 저장할 값)
  rounds: number;
  detail: any;
}> {
  let content = String(row.current_content || '');
  let rounds = startRound;
  let detail: any = null;

  while (rounds < MAX_TEST_ROUNDS) {
    rounds += 1;
    const sample = await buildSample({ ...row, current_content: content });
    const rejectNumber = row.is_ad ? await getOpt080Number(row.created_by || null, row.company_id) : '';

    // 재생성은 우리가 직접 돌린다(다듬기 규칙이 캠페인 문안과 다르다) → maxRetries 0
    const result = await autoSpamTestWithRegenerate({
      companyId: row.company_id,
      userId: row.created_by || row.company_id,
      callbackNumber: row.callback_number,
      messageType: (row.message_type === 'MMS' ? 'MMS' : row.message_type === 'LMS' ? 'LMS' : 'SMS'),
      subject: sample.subject,
      variants: [{ variantId: 'agency', messageText: sample.text, subject: sample.subject }],
      isAd: !!row.is_ad,
      rejectNumber,
      maxRetries: 0,
    });
    detail = { batchId: result.batchId, round: rounds, variants: result.variants };

    const v = result.variants[0];
    if (v?.spamResult !== 'blocked') {
      return { passed: true, finalContent: content, rounds, detail };
    }

    await logEvent(row.id, 'spam_blocked', { round: rounds, carriers: v.carrierResults });
    if (rounds >= MAX_TEST_ROUNDS) break;

    const refined = await refineForSpam({ companyId: row.company_id, original: content, round: rounds });
    if (!refined.ok || !refined.content) {
      await logEvent(row.id, 'refine_failed', { round: rounds, reason: refined.reason });
      break; // 다듬지 못하면 더 돌려도 같은 문안이다
    }
    content = refined.content;
    await logEvent(row.id, 'refined', { round: rounds });
  }

  return { passed: false, finalContent: content, rounds, detail };
}

/** 검사 결과를 원장에 반영한다. 문안이 다듬어졌으면 버전을 올려 옛 승인을 무효로 만든다 */
async function saveTestResult(row: any, content: string, rounds: number, detail: any): Promise<number> {
  const changed = content !== String(row.current_content || '');
  const r = await query(
    `UPDATE agency_send_requests
        SET current_content = $1,
            content_version = content_version + $2,
            test_round = $3, last_test_result = $4::jsonb, last_test_at = NOW(), updated_at = NOW()
      WHERE id = $5::uuid
      RETURNING content_version`,
    [content, changed ? 1 : 0, rounds, JSON.stringify(detail || {}), row.id],
  );
  return Number(r.rows[0]?.content_version || row.content_version);
}

// ────────────── A. 1차 검사 ──────────────

async function runFirstTest(): Promise<void> {
  const picked = await query(
    `UPDATE agency_send_requests
        SET status = 'testing', lock_at = $1, updated_at = NOW()
      WHERE id IN (
        SELECT id FROM agency_send_requests
         WHERE status = 'received'
         ORDER BY created_at
         LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [newLease()],
  );

  for (const row of picked.rows) {
    // 선점할 때 DB가 적은 값이 이 핸들러의 lease다. 이 값이 바뀌면 남이 이 건을 가져간 것이다.
    const lease = row.lock_at;
    try {
      const { passed, finalContent, rounds, detail } = await runSpamRound(row, 0);
      await saveTestResult(row, finalContent, rounds, detail);
      const label = shortLabel(row.file_name || row.original_content);
      const whenText = formatWhen(new Date(row.requested_at));

      if (!passed) {
        if (!await setStatus(row.id, 'test_failed', { lock_at: null }, lease)) continue;
        await logEvent(row.id, 'test_failed', { rounds });
        await notifyManager({
          companyId: row.company_id, requestId: row.id, managerPhone: row.manager_phone,
          callback: row.callback_number, title: '[대행발송] 문안 확인 요청',
          text: buildTestFailedNotify({ label }),
        });
        continue;
      }

      // 통과한 문안을 담당자에게 **실물 그대로** 보낸다(MMS면 이미지까지).
      //   승인은 이 문자를 본 뒤에 하는 것이라, 여기서 실제와 다른 것을 보내면 승인의 의미가 없다.
      const sample = await buildSample({ ...row, current_content: finalContent });
      const images = Array.isArray(row.mms_image_paths) ? row.mms_image_paths : [];
      const msgType = row.message_type === 'MMS' ? 'M' : row.message_type === 'LMS' ? 'L' : 'S';
      await notifyManager({
        companyId: row.company_id, requestId: row.id, managerPhone: row.manager_phone,
        callback: row.callback_number, title: sample.subject || '[대행발송] 테스트',
        text: sample.text, msgType: msgType as any, mmsImages: images,
      });
      await notifyManager({
        companyId: row.company_id, requestId: row.id, managerPhone: row.manager_phone,
        callback: row.callback_number, title: '[대행발송] 승인 요청',
        text: buildPassedNotify({ label, whenText }),
      });

      if (!await setStatus(row.id, 'awaiting_approval', { lock_at: null }, lease)) continue;
      await logEvent(row.id, 'awaiting_approval', { rounds });
      console.log(`${LOG} 1차 검사 통과 request=${row.id} rounds=${rounds}`);
    } catch (err: any) {
      console.error(`${LOG} 1차 검사 실패 request=${row.id}:`, err);
      await setStatus(row.id, 'received', { lock_at: null }, lease).catch(() => {});
      await logEvent(row.id, 'first_test_error', { error: String(err?.message || '') });
    }
  }
}

// ────────────── B. 당일 재검사 + 큐 적재 ──────────────

async function runFinalTest(onlyRequestId?: string): Promise<void> {
  // ⛔ 하한을 SQL에 넣는다(★2026-08-23 Codex high). 만료 대상(남은 시간 <= 여유)까지 후보에 담고
  //   LIMIT을 먼저 적용하면, 그런 행 다섯 개가 방금 재승인된 건을 가려 그 tick을 통째로 건너뛴다.
  const params: any[] = [QUEUE_MARGIN_MINUTES];
  let idFilter = '';
  if (onlyRequestId) {
    params.push(onlyRequestId);
    idFilter = ` AND id = $${params.length}::uuid`;
  }
  const candidates = await query(
    `SELECT * FROM agency_send_requests
      WHERE status = 'approved'
        AND requested_at > NOW() + ($1::int * INTERVAL '1 minute')
        AND requested_at <= NOW() + INTERVAL '2 hours'${idFilter}
      ORDER BY requested_at
      LIMIT ${BATCH}`,
    params,
  );

  const now = new Date();
  for (const row of candidates.rows) {
    const requestedAt = new Date(row.requested_at);
    const finalTestedAt = row.final_test_at ? new Date(row.final_test_at) : null;

    // ① 재승인 건 = 당일 검사를 이미 통과한 문안이다. 다시 검사하지 않고 예약만 만든다.
    //   ⛔ 여기서 또 검사하면 승인받은 문안이 통신사 결과에 따라 다시 뒤집히고, 남은 시간도 사라진다.
    if (isQueueDue('approved', requestedAt, now, finalTestedAt)) {
      const locked = await query(
        `UPDATE agency_send_requests SET status = 'final_testing', lock_at = $2, updated_at = NOW()
          WHERE id = $1::uuid AND status = 'approved' RETURNING *`,
        [row.id, newLease()],
      );
      if (locked.rows.length === 0) continue;
      const ready = locked.rows[0];
      try {
        await dispatchToPipeline(ready, String(ready.current_content || ''), ready.lock_at);
      } catch (err: any) {
        console.error(`${LOG} 재승인 건 예약 실패 request=${ready.id}:`, err);
        await setStatus(ready.id, 'approved', { lock_at: null }, ready.lock_at).catch(() => {});
        await logEvent(ready.id, 'dispatch_error', { error: String(err?.message || '') });
      }
      continue;
    }

    if (!isFinalTestDue('approved', requestedAt, now, finalTestedAt)) continue;

    const locked = await query(
      `UPDATE agency_send_requests SET status = 'final_testing', lock_at = $2, updated_at = NOW()
        WHERE id = $1::uuid AND status = 'approved' RETURNING *`,
      [row.id, newLease()],
    );
    if (locked.rows.length === 0) continue; // 다른 tick이 먼저 잡았다
    const target = locked.rows[0];
    const lease = target.lock_at;
    const label = shortLabel(target.file_name || target.original_content);

    try {
      const { passed, finalContent, rounds, detail } = await runSpamRound(target, 0);
      const version = await saveTestResult(target, finalContent, rounds, detail);
      // 통과한 문안에는 "오늘 검사를 지났다"는 표시를 남긴다. 재승인 뒤 재검사를 건너뛰는 근거이자,
      // 문안·시각이 바뀌면 라우트가 이 값을 지워 다시 검사하게 만드는 스위치다.
      if (passed) {
        await query(
          `UPDATE agency_send_requests SET final_test_at = NOW() WHERE id = $1::uuid AND lock_at = $2`,
          [target.id, lease],
        );
      }

      if (passed && finalContent === String(target.current_content || '')) {
        // 문안이 그대로 통과 = 담당자가 승인한 그 문안이다. 바로 예약으로 간다
        await dispatchToPipeline(target, finalContent, lease);
        continue;
      }

      if (passed) {
        // 다듬어서 통과했다 = 담당자가 못 본 문장이다. 재승인을 받는다(불변 7)
        if (!await setStatus(target.id, 'reapproval', {
          lock_at: null,
          approved_at: null,
          approved_by: null,
          approval_version: null,
          reapproval_count: Number(target.reapproval_count || 0) + 1,
        }, lease)) continue;
        await logEvent(target.id, 'reapproval', { rounds, version });

        await notifyManager({
          companyId: target.company_id, requestId: target.id, managerPhone: target.manager_phone,
          callback: target.callback_number, title: '[대행발송] 예약 취소 안내',
          text: buildFinalBlockedNotify({ label }),
        });
        const sample = await buildSample({ ...target, current_content: finalContent });
        const images = Array.isArray(target.mms_image_paths) ? target.mms_image_paths : [];
        const msgType = target.message_type === 'MMS' ? 'M' : target.message_type === 'LMS' ? 'L' : 'S';
        await notifyManager({
          companyId: target.company_id, requestId: target.id, managerPhone: target.manager_phone,
          callback: target.callback_number, title: sample.subject || '[대행발송] 수정 문안',
          text: sample.text, msgType: msgType as any, mmsImages: images,
        });
        await notifyManager({
          companyId: target.company_id, requestId: target.id, managerPhone: target.manager_phone,
          callback: target.callback_number, title: '[대행발송] 재승인 요청',
          text: buildReapprovalNotify({ label, whenText: formatWhen(new Date(target.requested_at)) }),
        });
        continue;
      }

      // 세 번 다 걸렸다. 나가지 않는다
      if (!await setStatus(target.id, 'test_failed', { lock_at: null }, lease)) continue;
      await logEvent(target.id, 'final_test_failed', { rounds });
      await notifyManager({
        companyId: target.company_id, requestId: target.id, managerPhone: target.manager_phone,
        callback: target.callback_number, title: '[대행발송] 예약 취소 안내',
        text: buildFinalBlockedNotify({ label }),
      });
      await notifyManager({
        companyId: target.company_id, requestId: target.id, managerPhone: target.manager_phone,
        callback: target.callback_number, title: '[대행발송] 문안 확인 요청',
        text: buildTestFailedNotify({ label }),
      });
    } catch (err: any) {
      console.error(`${LOG} 당일 재검사 실패 request=${target.id}:`, err);
      // 되돌려 둔다. 다음 tick이 다시 잡거나, 시각이 지나면 만료 단계가 맡는다
      await setStatus(target.id, 'approved', { lock_at: null }, lease).catch(() => {});
      await logEvent(target.id, 'final_test_error', { error: String(err?.message || '') });
    }
  }
}

/**
 * 예약을 만든다. **이 축에서 발송을 만드는 유일한 자리다.**
 *
 * 직접 큐에 넣지 않고 직접발송 배관에 넘긴다: `campaign_send_staging` 적재 → `createDirectSendCampaign`.
 * 그 뒤의 수신거부 제외·중복 제거·선불 차감·큐 적재·미적재분 환불·적재 중 취소 감지는 그쪽이 소유한다.
 *
 * ⛔ `send_type='agency'` — 이 값이 빠지면 컬럼 기본값으로 적재되어 결과 동기화·실패 환불·후불 청구
 *   세 축 어디에도 안 걸리는 유령 발송이 된다(2026-08-23 정정 · CT = `send-type-axis.ts`).
 * ⛔ `campaign_id`가 이미 있으면 다시 만들지 않는다. 재시도가 캠페인과 큐를 한 벌 더 만들던 자리다(§12-1).
 */
async function dispatchToPipeline(row: any, content: string, lease: any): Promise<void> {
  const label = shortLabel(row.file_name || row.original_content, 40);
  const notifyFailed = async (kind: string, payload: Record<string, any>) => {
    await logEvent(row.id, kind, payload);
    await notifyManager({
      companyId: row.company_id, requestId: row.id, managerPhone: row.manager_phone,
      callback: row.callback_number, title: '[대행발송] 확인 요청',
      text: buildQueueFailedNotify({ label }),
    });
  };

  // **이번 시도의 식별자.** 캠페인이 이 값을 `staging_id`로 들고 있어, 크래시 뒤 재시도가 같은 시도를
  //   두 번 만들지 않는다. 접수 id를 그대로 쓰면 실패한 시도와 새 시도를 가를 수 없어, 한 번 실패한 건이
  //   재예약해도 옛 캠페인에 영원히 막힌다. 문안·시각을 고치면 라우트가 이 값을 지운다.
  // ⛔ lease를 조건에 넣는다 — 이 사이 lock 복구가 되돌렸으면 여기서 멈춘다.
  const keyed = await query(
    `UPDATE agency_send_requests
        SET dispatch_key = COALESCE(dispatch_key, gen_random_uuid()), updated_at = NOW()
      WHERE id = $1::uuid AND lock_at = $2
      RETURNING dispatch_key`,
    [row.id, lease],
  );
  if (keyed.rows.length === 0) {
    console.warn(`${LOG} lease를 잃어 예약을 중단한다 request=${row.id}`);
    return;
  }
  const stagingId = keyed.rows[0].dispatch_key;

  // ⛔ 멱등 — 앞선 시도가 예약을 만들어 두고 원장에 적기 전에 죽었을 수 있다.
  //   그때 그냥 다시 만들면 같은 발송이 두 벌 나간다. **캠페인을 만들기 전에** 이번 시도 키로 먼저 찾는다
  //   (원장의 `campaign_id`는 나중에 적히므로 근거가 못 된다).
  const prior = row.campaign_id
    ? await query(`SELECT id, send_phase FROM campaigns WHERE id = $1::uuid`, [row.campaign_id])
    : await query(
        `SELECT id, send_phase FROM campaigns
          WHERE staging_id = $1::uuid AND company_id = $2::uuid
          ORDER BY created_at DESC LIMIT 1`,
        [stagingId, row.company_id],
      );
  if (prior.rows.length > 0) {
    const { id: priorId, send_phase: phase } = prior.rows[0];
    // 차감 도중 멈춰 중화된 캠페인은 발송되지 않는다(배관이 'queued'만 집는다). 다시 만들지도 않는다.
    // 이 시도는 여기서 끝이고, 담당자가 시각을 다시 정하면 새 시도 키로 처음부터 간다.
    if (phase === 'failed' || phase === 'preparing') {
      await setStatus(row.id, 'expired', { lock_at: null, campaign_id: priorId, expired_at: new Date() }, lease);
      await notifyFailed('dispatch_incomplete', { campaignId: priorId, phase });
      return;
    }
    await setStatus(row.id, 'queued', { lock_at: null, campaign_id: priorId, queued_at: new Date() }, lease);
    await logEvent(row.id, 'queued_already', { campaignId: priorId, phase });
    return;
  }
  // ⛔ 승인은 문안 버전에 묶인다(불변 7). 게이트를 라우트에만 두면 워커가 문안을 다듬은 뒤
  //   상태 전이가 실패한 경로로 **담당자가 못 본 문장**이 여기까지 올 수 있다. 효과가 만들어지는 자리에서 다시 본다.
  if (!isApprovalCurrent(row.approval_version, row.content_version)) {
    await setStatus(row.id, 'reapproval', {
      lock_at: null, approved_at: null, approved_by: null, approval_version: null,
    }, lease);
    await logEvent(row.id, 'dispatch_unapproved_version', {
      approvalVersion: row.approval_version, contentVersion: row.content_version,
    });
    await notifyManager({
      companyId: row.company_id, requestId: row.id, managerPhone: row.manager_phone,
      callback: row.callback_number, title: '[대행발송] 재승인 요청',
      text: buildReapprovalNotify({ label, whenText: formatWhen(new Date(row.requested_at)) }),
    });
    return;
  }
  if (!row.created_by) {
    await setStatus(row.id, 'expired', { lock_at: null, expired_at: new Date() }, lease);
    await notifyFailed('dispatch_no_owner', {});
    return;
  }

  const plan = buildSlotPlan(content);
  if (!plan.ok) {
    await setStatus(row.id, 'test_failed', { lock_at: null }, lease);
    await notifyFailed('dispatch_var_overflow', { vars: plan.order.length });
    return;
  }

  const recipients = await query(
    `SELECT phone, vars FROM agency_send_recipients WHERE request_id = $1::uuid ORDER BY row_no`,
    [row.id],
  );
  const phones: string[] = [];
  const names: string[] = [];
  const extra1s: string[] = [];
  const extra2s: string[] = [];
  const extra3s: string[] = [];
  for (const r of recipients.rows) {
    const phone = normalizePhone(r.phone);
    if (!phone) continue;
    const v = toSlotValues(r.vars, plan.order);
    phones.push(phone); names.push(v.name); extra1s.push(v.extra1); extra2s.push(v.extra2); extra3s.push(v.extra3);
  }
  // 문안 문제가 아니라 보낼 대상이 없는 것이다. "문안 확인 필요"로 적으면 담당자가 엉뚱한 곳을 본다.
  if (phones.length === 0) {
    await setStatus(row.id, 'expired', { lock_at: null, expired_at: new Date() }, lease);
    await notifyFailed('dispatch_no_recipient', {});
    return;
  }

  await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1::uuid`, [stagingId]);
  // 컬럼·UNNEST 형태는 `/direct-send/stage`(routes/campaigns.ts) 원본과 같다. 개별 회신번호는 쓰지 않는다.
  await query(
    `INSERT INTO campaign_send_staging (staging_id, company_id, phone, name, extra1, extra2, extra3)
     SELECT $1::uuid, $2::uuid, u.phone, u.name, u.extra1, u.extra2, u.extra3
     FROM UNNEST($3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
       AS u(phone, name, extra1, extra2, extra3)`,
    [stagingId, row.company_id, phones, names, extra1s, extra2s, extra3s],
  );

  // 정제 후 실제 발송 수(수신거부·중복 제외). 차감·청구가 이 수를 쓴다.
  const { sendCount } = await countStagingFiltered(stagingId, row.company_id, row.created_by, true, true);
  if (sendCount === 0) {
    await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1::uuid`, [stagingId]);
    await setStatus(row.id, 'expired', { lock_at: null, expired_at: new Date() }, lease);
    await notifyFailed('dispatch_zero_after_filter', { staged: phones.length });
    return;
  }

  const images = Array.isArray(row.mms_image_paths) ? row.mms_image_paths : [];
  try {
    const { campaignId } = await createDirectSendCampaign(
      {
        stagingId,
        campaignName: `대행발송 ${label}`,
        msgType: row.message_type,
        total: sendCount,
        message: plan.slotContent,
        subject: row.subject || null,
        callback: row.callback_number,
        sendChannel: 'sms',
        adEnabled: !!row.is_ad,
        scheduled: true,
        scheduledAt: new Date(row.requested_at).toISOString(),
        mmsImagePaths: images.length > 0 ? images : null,
        dedupEnabled: true,
        unsubFilterEnabled: true,
        sendType: 'agency',
      },
      { companyId: row.company_id, userId: row.created_by },
    );

    await setStatus(row.id, 'queued', { lock_at: null, campaign_id: campaignId, queued_at: new Date() }, lease);
    await logEvent(row.id, 'queued', { campaignId, count: sendCount, staged: phones.length });
    console.log(`${LOG} 예약 생성 완료 request=${row.id} campaign=${campaignId} ${sendCount}건`);
  } catch (err: any) {
    // 배관이 거절했다(잔액 부족·야간 광고 제한·미완성 링크 등). 캠페인 정리는 그쪽이 소유한다.
    // ⛔ 여기서 staging을 지우지 않는다 — 거절 이유가 "결과 미확정"일 때 캠페인이 실제로는 살아 있을 수 있고,
    //   그 순간 적재 워커가 읽는 행을 지우면 **일부만 나가는 발송**이 된다. 다음 시도가 같은 자리에 다시 쓴다.
    const code = err instanceof DirectSendError ? err.code : 'DISPATCH_ERROR';
    console.error(`${LOG} 예약 생성 거절 request=${row.id} code=${code}:`, err?.message || err);
    await setStatus(row.id, 'expired', { lock_at: null, expired_at: new Date() }, lease);
    await notifyFailed('dispatch_rejected', { code, message: String(err?.message || '') });
  }
}

// ────────────── C. 만료 ──────────────

async function runExpire(): Promise<void> {
  // ★ 2026-08-23 `approved` 합류(§12-3). 승인은 받았는데 재검사·예약을 넣을 시간이 지난 건이
  //   전에는 어느 워커의 대상도 아니어서 발송도 만료도 안내도 없이 그대로 남았다.
  const rows = await query(
    `SELECT * FROM agency_send_requests
      WHERE status IN ('awaiting_approval','reapproval','approved')
        AND requested_at < NOW() + INTERVAL '2 hours'
      ORDER BY requested_at
      LIMIT 20`,
  );

  const now = new Date();
  for (const row of rows.rows) {
    if (!isApprovalExpired(row.status, new Date(row.requested_at), now)) continue;
    const wasApproved = row.status === 'approved';
    await setStatus(row.id, 'expired', { expired_at: new Date() });
    await logEvent(row.id, 'expired', { from: row.status });
    const label = shortLabel(row.file_name || row.original_content);
    await notifyManager({
      companyId: row.company_id, requestId: row.id, managerPhone: row.manager_phone,
      callback: row.callback_number, title: '[대행발송] 미발송 안내',
      // 승인한 담당자에게 "승인이 없어서"라고 보내면 사실과 다르다. 사유대로 나눈다.
      text: wasApproved ? buildApprovedExpiredNotify({ label }) : buildExpiredNotify({ label }),
    });
    console.log(`${LOG} 발송하지 않고 만료 request=${row.id} from=${row.status}`);
  }
}

// ────────────── D. 대조(이중 진실 안전망) ──────────────

async function runReconcile(): Promise<void> {
  const rows = await query(
    `SELECT a.id, a.campaign_id, c.status AS campaign_status
       FROM agency_send_requests a
       JOIN campaigns c ON c.id = a.campaign_id
      WHERE a.status = 'queued' AND c.status = 'cancelled'
      LIMIT 50`,
  );
  for (const row of rows.rows) {
    await setStatus(row.id, 'cancelled', { cancelled_at: new Date(), cancel_reason: '예약이 취소되었습니다' });
    await logEvent(row.id, 'reconciled_cancelled', { campaignId: row.campaign_id });
    console.log(`${LOG} 캠페인 취소를 원장에 반영 request=${row.id}`);
  }

  // 적재가 예외로 끝난 건(배관이 `send_phase='failed'`로 종결). 일부가 이미 나갔을 수 있어
  // 상태는 내리지 않고(그러면 "미발송"이라는 거짓이 된다) 담당자에게 한 번만 알린다.
  const broken = await query(
    `SELECT a.id, a.company_id, a.campaign_id, a.manager_phone, a.callback_number, a.file_name, a.original_content
       FROM agency_send_requests a
       JOIN campaigns c ON c.id = a.campaign_id
      WHERE a.status = 'queued' AND c.send_phase = 'failed'
        AND NOT EXISTS (
          SELECT 1 FROM agency_send_events e WHERE e.request_id = a.id AND e.kind = 'queue_failed'
        )
      LIMIT 50`,
  );
  for (const row of broken.rows) {
    await logEvent(row.id, 'queue_failed', { campaignId: row.campaign_id });
    await notifyManager({
      companyId: row.company_id, requestId: row.id, managerPhone: row.manager_phone,
      callback: row.callback_number, title: '[대행발송] 확인 요청',
      text: buildQueueFailedNotify({ label: shortLabel(row.file_name || row.original_content) }),
    });
    console.warn(`${LOG} 적재가 예외로 끝난 건 request=${row.id} campaign=${row.campaign_id}`);
  }
}

// ────────────── E. lock 복구 ──────────────

async function runLockRecovery(): Promise<void> {
  const rows = await query(
    `SELECT id, company_id, status, lock_at, campaign_id, dispatch_key FROM agency_send_requests
      WHERE status IN ('testing','final_testing') LIMIT 50`,
  );
  const now = new Date();
  for (const row of rows.rows) {
    if (!isLockStale(row.status, row.lock_at ? new Date(row.lock_at) : null, now)) continue;

    // ⛔ 예약을 이미 만든 건은 잡기 전 상태로 되돌리지 않는다 — 되돌리면 다음 tick이 한 벌 더 만든다.
    //   원장의 `campaign_id`가 비어 있어도 캠페인은 있을 수 있다(적은 직후 죽는 창). 시도 키로 한 번 더 본다.
    let campaignId: string | null = row.campaign_id || null;
    if (!campaignId && row.dispatch_key) {
      const found = await query(
        `SELECT id FROM campaigns WHERE staging_id = $1::uuid AND company_id = $2::uuid ORDER BY created_at DESC LIMIT 1`,
        [row.dispatch_key, row.company_id],
      );
      campaignId = found.rows[0]?.id || null;
    }
    if (campaignId) {
      await setStatus(row.id, 'queued', { lock_at: null, campaign_id: campaignId, queued_at: new Date() }, row.lock_at);
      await logEvent(row.id, 'lock_recovered', { from: row.status, to: 'queued', campaignId });
      console.warn(`${LOG} 멈춘 건 복구 request=${row.id} ${row.status} → queued(예약 있음)`);
      continue;
    }

    const back = lockRecoveryStatus(row.status);
    if (!back) continue;
    // ⛔ 관찰한 lock_at을 조건에 넣는다 — 그 사이 원래 핸들러가 끝냈으면 되돌리지 않는다.
    if (!await setStatus(row.id, back, { lock_at: null }, row.lock_at)) continue;
    await logEvent(row.id, 'lock_recovered', { from: row.status, to: back });
    console.warn(`${LOG} 멈춘 건 복구 request=${row.id} ${row.status} → ${back}`);
  }
}

// ────────────── 진입 ──────────────

export async function runAgencySendWorker(): Promise<void> {
  try {
    await runLockRecovery();
    await runFirstTest();
    await runFinalTest();
    await runExpire();
    await runReconcile();
  } catch (err: any) {
    // 테이블·컬럼이 아직 없으면(마이그레이션 전) 조용히 넘어간다.
    // ⛔ 컬럼도 함께 본다 — 테이블만 보면 신규 컬럼(`dispatch_key`) 배포 직후 tick이 5분마다 에러를 쌓는다.
    const msg = String(err?.message || '');
    if ((msg.includes('relation') || msg.includes('column')) && msg.includes('does not exist')) {
      console.warn(`${LOG} 원장이 아직 준비되지 않았다(마이그레이션 대기):`, msg);
      return;
    }
    console.error(`${LOG} tick 실패:`, err);
  }
}

/**
 * 승인 직후 예약을 만드는 즉시 진입점(★ 2026-08-23 신설).
 *
 * 재승인은 남은 시간이 짧다. 다음 tick(최대 5분)을 기다리면 그 사이에 만료 기준을 지나
 * "승인했는데 나가지 않은 건"이 생긴다. 1차 검사는 여기서 돌리지 않는다(몇 분씩 걸린다).
 * fire and forget — 실패해도 정기 tick이 다시 맡는다.
 */
export function triggerAgencySendDispatch(requestId: string): void {
  // ⛔ 전역 배치가 아니라 **그 건만** 집는다. 배치로 돌리면 앞자리 다섯 건에 가려 방금 승인한 건이 밀린다.
  runFinalTest(requestId).catch((err: any) => {
    console.error(`${LOG} 승인 직후 예약 시도 실패(정기 tick이 다시 맡는다) request=${requestId}:`, err?.message || err);
  });
}

export function startAgencySendWorker(): void {
  setInterval(() => { runAgencySendWorker(); }, TICK_MS);
  console.log(`${LOG} 시작 (${TICK_MS / 60000}분 주기)`);
}
