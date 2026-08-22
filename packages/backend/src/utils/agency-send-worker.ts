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
 * ⛔ 적재 뒤 **실제 큐 건수를 세어** 기대와 같을 때만 성공으로 적는다(6원칙 ②).
 */
import { query } from '../config/database';
import { autoSpamTestWithRegenerate } from './spam-test-queue';
import { refineForSpam } from './agency-send-refine';
import {
  buildExpiredNotify, buildFinalBlockedNotify, buildPassedNotify, buildReapprovalNotify,
  buildTestFailedNotify, formatWhen, shortLabel,
} from './agency-send-notify';
import {
  isApprovalExpired, isFinalTestDue, isLockStale, lockRecoveryStatus,
  MAX_TEST_ROUNDS, type AgencySendStatus,
} from './agency-send-state';
import {
  bulkInsertSmsQueue, getAuthSmsTable, getCompanySmsTables, getCampaignQueueTables,
  smsCountAll, toKoreaTimeStr,
} from './sms-queue';
import { buildAdMessage, buildAdSubject, getOpt080Number, prepareFieldMappings, replaceVariables } from './messageUtils';
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

async function setStatus(requestId: string, status: AgencySendStatus, extra: Record<string, any> = {}): Promise<void> {
  const sets = ['status = $2', 'updated_at = NOW()'];
  const params: any[] = [requestId, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i}`);
    params.push(val);
    i += 1;
  }
  await query(`UPDATE agency_send_requests SET ${sets.join(', ')} WHERE id = $1::uuid`, params);
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

/** 검사·발송에 쓸 문안 한 벌을 만든다(첫 수신자 기준 변수 치환 + 광고 부착) */
async function buildSample(row: any): Promise<{ text: string; subject: string }> {
  const first = await query(
    `SELECT phone, vars FROM agency_send_recipients WHERE request_id = $1::uuid ORDER BY row_no LIMIT 1`,
    [row.id],
  );
  const vars = first.rows[0]?.vars || {};
  const mappings = await prepareFieldMappings(row.company_id);
  const replaced = replaceVariables(String(row.current_content || ''), vars, mappings);

  const opt080 = row.is_ad ? await getOpt080Number(row.created_by || null, row.company_id) : '';
  const typeForAd = row.message_type === 'SMS' ? 'SMS' : 'LMS';
  return {
    text: buildAdMessage(replaced, typeForAd, !!row.is_ad, opt080),
    subject: buildAdSubject(String(row.subject || ''), typeForAd, !!row.is_ad),
  };
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
        SET status = 'testing', lock_at = NOW(), updated_at = NOW()
      WHERE id IN (
        SELECT id FROM agency_send_requests
         WHERE status = 'received'
         ORDER BY created_at
         LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
  );

  for (const row of picked.rows) {
    try {
      const { passed, finalContent, rounds, detail } = await runSpamRound(row, 0);
      await saveTestResult(row, finalContent, rounds, detail);
      const label = shortLabel(row.file_name || row.original_content);
      const whenText = formatWhen(new Date(row.requested_at));

      if (!passed) {
        await setStatus(row.id, 'test_failed');
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

      await setStatus(row.id, 'awaiting_approval', { lock_at: null });
      await logEvent(row.id, 'awaiting_approval', { rounds });
      console.log(`${LOG} 1차 검사 통과 request=${row.id} rounds=${rounds}`);
    } catch (err: any) {
      console.error(`${LOG} 1차 검사 실패 request=${row.id}:`, err);
      await setStatus(row.id, 'received', { lock_at: null }).catch(() => {});
      await logEvent(row.id, 'first_test_error', { error: String(err?.message || '') });
    }
  }
}

// ────────────── B. 당일 재검사 + 큐 적재 ──────────────

async function runFinalTest(): Promise<void> {
  const candidates = await query(
    `SELECT * FROM agency_send_requests
      WHERE status = 'approved'
        AND requested_at > NOW()
        AND requested_at <= NOW() + INTERVAL '2 hours'
      ORDER BY requested_at
      LIMIT ${BATCH}`,
  );

  const now = new Date();
  for (const row of candidates.rows) {
    if (!isFinalTestDue('approved', new Date(row.requested_at), now)) continue;

    const locked = await query(
      `UPDATE agency_send_requests SET status = 'final_testing', lock_at = NOW(), updated_at = NOW()
        WHERE id = $1::uuid AND status = 'approved' RETURNING *`,
      [row.id],
    );
    if (locked.rows.length === 0) continue; // 다른 tick이 먼저 잡았다
    const target = locked.rows[0];
    const label = shortLabel(target.file_name || target.original_content);

    try {
      const { passed, finalContent, rounds, detail } = await runSpamRound(target, 0);
      const version = await saveTestResult(target, finalContent, rounds, detail);

      if (passed && finalContent === String(target.current_content || '')) {
        // 문안이 그대로 통과 = 담당자가 승인한 그 문안이다. 바로 큐로 간다
        await queueForSend(target, finalContent);
        continue;
      }

      if (passed) {
        // 다듬어서 통과했다 = 담당자가 못 본 문장이다. 재승인을 받는다(불변 7)
        await setStatus(target.id, 'reapproval', {
          lock_at: null,
          approved_at: null,
          approved_by: null,
          approval_version: null,
          reapproval_count: Number(target.reapproval_count || 0) + 1,
        });
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
      await setStatus(target.id, 'test_failed', { lock_at: null });
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
      await setStatus(target.id, 'approved', { lock_at: null }).catch(() => {});
      await logEvent(target.id, 'final_test_error', { error: String(err?.message || '') });
    }
  }
}

/**
 * 캠페인 행 + MySQL 큐 적재. **이 축에서 큐를 만드는 유일한 자리다.**
 * ⛔ 적재 뒤 실제 건수를 세어 기대와 같을 때만 `queued`로 적는다. 다르면 실패로 남기고 사람이 본다.
 */
async function queueForSend(row: any, content: string): Promise<void> {
  const label = shortLabel(row.file_name || row.original_content, 40);
  const recipients = await query(
    `SELECT phone, vars FROM agency_send_recipients WHERE request_id = $1::uuid ORDER BY row_no`,
    [row.id],
  );
  if (recipients.rows.length === 0) {
    await setStatus(row.id, 'test_failed', { lock_at: null });
    await logEvent(row.id, 'queue_no_recipient', {});
    return;
  }

  const campaign = await query(
    `INSERT INTO campaigns (
       company_id, campaign_name, message_type, message_content, message_template,
       subject, message_subject, scheduled_at, is_ad, target_count, created_by,
       mms_image_paths, send_channel, callback_number, status
     ) VALUES ($1::uuid, $2, $3, $4, $4, $5, $5, $6, $7, $8, $9::uuid, $10::jsonb, 'sms', $11, 'scheduled')
     RETURNING id`,
    [
      row.company_id, `대행발송 ${label}`, row.message_type, content,
      row.subject || null, row.requested_at, !!row.is_ad, recipients.rows.length,
      row.created_by, Array.isArray(row.mms_image_paths) && row.mms_image_paths.length > 0 ? JSON.stringify(row.mms_image_paths) : null,
      row.callback_number,
    ],
  );
  const campaignId = campaign.rows[0].id;

  const mappings = await prepareFieldMappings(row.company_id);
  const opt080 = row.is_ad ? await getOpt080Number(row.created_by || null, row.company_id) : '';
  const typeForAd = row.message_type === 'SMS' ? 'SMS' : 'LMS';
  const msgType = row.message_type === 'MMS' ? 'M' : row.message_type === 'LMS' ? 'L' : 'S';
  const images = Array.isArray(row.mms_image_paths) ? row.mms_image_paths : [];
  const sendTime = toKoreaTimeStr(new Date(row.requested_at));
  const subject = buildAdSubject(String(row.subject || ''), typeForAd, !!row.is_ad);

  const rows: any[][] = [];
  for (const r of recipients.rows) {
    const phone = normalizePhone(r.phone);
    if (!phone) continue;
    const personalized = buildAdMessage(replaceVariables(content, r.vars || {}, mappings), typeForAd, !!row.is_ad, opt080);
    rows.push([
      phone, row.callback_number, personalized, msgType, subject,
      sendTime, campaignId, row.company_id,
      images[0] || '', images[1] || '', images[2] || '',
    ]);
  }

  const tables = await getCompanySmsTables(row.company_id, row.created_by || undefined);
  const inserted = await bulkInsertSmsQueue(tables, rows, false, { companyId: row.company_id, userId: row.created_by, source: 'agency-send' } as any);

  // 효과 검증 — 넣었다고 믿지 않고 큐에서 다시 센다
  const queueTables = await getCampaignQueueTables(row.company_id, row.created_by || undefined);
  const counted = await smsCountAll(queueTables, `app_etc1 = ? AND status_code = 100`, [campaignId]);

  if (inserted !== rows.length || counted !== rows.length) {
    console.error(`${LOG} 적재 불일치 request=${row.id} 기대=${rows.length} 적재=${inserted} 큐=${counted}`);
    await logEvent(row.id, 'queue_mismatch', { expected: rows.length, inserted, counted, campaignId });
    await setStatus(row.id, 'test_failed', { lock_at: null, campaign_id: campaignId });
    await notifyManager({
      companyId: row.company_id, requestId: row.id, managerPhone: row.manager_phone,
      callback: row.callback_number, title: '[대행발송] 확인 요청',
      text: buildTestFailedNotify({ label }),
    });
    return;
  }

  await setStatus(row.id, 'queued', { lock_at: null, campaign_id: campaignId, queued_at: new Date() });
  await logEvent(row.id, 'queued', { campaignId, count: counted });
  console.log(`${LOG} 큐 적재 완료 request=${row.id} campaign=${campaignId} ${counted}건`);
}

// ────────────── C. 만료 ──────────────

async function runExpire(): Promise<void> {
  const rows = await query(
    `SELECT * FROM agency_send_requests
      WHERE status IN ('awaiting_approval','reapproval')
        AND requested_at < NOW() + INTERVAL '2 hours'
      ORDER BY requested_at
      LIMIT 20`,
  );

  const now = new Date();
  for (const row of rows.rows) {
    if (!isApprovalExpired(row.status, new Date(row.requested_at), now)) continue;
    await setStatus(row.id, 'expired', { expired_at: new Date() });
    await logEvent(row.id, 'expired', {});
    await notifyManager({
      companyId: row.company_id, requestId: row.id, managerPhone: row.manager_phone,
      callback: row.callback_number, title: '[대행발송] 미발송 안내',
      text: buildExpiredNotify({ label: shortLabel(row.file_name || row.original_content) }),
    });
    console.log(`${LOG} 승인 없이 만료 request=${row.id}`);
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
}

// ────────────── E. lock 복구 ──────────────

async function runLockRecovery(): Promise<void> {
  const rows = await query(
    `SELECT id, status, lock_at FROM agency_send_requests
      WHERE status IN ('testing','final_testing') LIMIT 50`,
  );
  const now = new Date();
  for (const row of rows.rows) {
    if (!isLockStale(row.status, row.lock_at ? new Date(row.lock_at) : null, now)) continue;
    const back = lockRecoveryStatus(row.status);
    if (!back) continue;
    await setStatus(row.id, back, { lock_at: null });
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
    // 테이블이 아직 없으면(마이그레이션 전) 조용히 넘어간다
    const msg = String(err?.message || '');
    if (msg.includes('relation') && msg.includes('does not exist')) return;
    console.error(`${LOG} tick 실패:`, err);
  }
}

export function startAgencySendWorker(): void {
  setInterval(() => { runAgencySendWorker(); }, TICK_MS);
  console.log(`${LOG} 시작 (${TICK_MS / 60000}분 주기)`);
}
