/**
 * ★ CT-F08 — 전단AI 발송 오케스트레이터 (발송 경로의 유일한 진입점)
 *
 * 한줄로 campaigns.ts 5경로 → CT-F08 1경로로 단순화.
 * 모든 전단AI 발송(AI/직접/자동/테스트)은 이 함수를 통해야 한다.
 *
 * 흐름:
 *   1. 발송 가능 여부 확인 (CT-F03 canFlyerCompanySend)
 *   2. 회신번호 결정 (CT-F06 resolveFlyerCallback)
 *   3. 수신자 중복제거 (CT-F07 deduplicateFlyerRecipients)
 *   4. 수신거부 제외 (CT-F02 filterOutFlyerUnsubscribed)
 *   5. 변수 치환 + (광고)+080 부착 (CT-F05 prepareFlyerSendMessage)
 *   6. MySQL 큐 bulk INSERT (CT-F01 bulkInsertSmsQueue)
 *   7. flyer_campaigns 레코드 생성/업데이트
 */

import { query } from '../../../config/database';
import {
  getFlyerCompanySmsTables,
  bulkInsertSmsQueue,
  toQtmsgType,
} from './flyer-sms-queue';
import { canFlyerStoreSend, deductFlyerPrepaid } from '../billing/flyer-billing';
import { resolveFlyerCallback } from './flyer-callback-filter';
import { deduplicateWithStats, FlyerRecipient } from './flyer-deduplicate';
import { filterOutFlyerUnsubscribed } from './flyer-unsubscribe-helper';
import { prepareFlyerSendMessage, FlyerCustomerVars } from './flyer-message';

export type FlyerMessageType = 'SMS' | 'LMS' | 'MMS';

export type FlyerSendRecipient = FlyerRecipient & Omit<FlyerCustomerVars, 'phone'> & {
  customer_id?: string | null;
};

export interface FlyerSendParams {
  companyId: string;
  userId: string;
  messageType: FlyerMessageType;
  messageTemplate: string;
  isAd: boolean;
  requestedCallback?: string | null;
  mmsImagePaths?: string[]; // 최대 3개
  subject?: string; // LMS/MMS 제목
  recipients: FlyerSendRecipient[];
  flyerId?: string | null;
  shortUrlId?: string | null;
  scheduleAt?: Date | null;
  skipUnsubscribeFilter?: boolean;
  skipDeduplicate?: boolean;
}

export interface FlyerSendResult {
  ok: boolean;
  campaignId?: string;
  totalRequested: number;
  deduplicated: number;
  unsubscribedRemoved: number;
  enqueued: number;
  callbackUsed: string | null;
  error?: string;
}

export async function sendFlyerCampaign(params: FlyerSendParams): Promise<FlyerSendResult> {
  const {
    companyId, userId, messageType, messageTemplate, isAd,
    requestedCallback, mmsImagePaths, subject, recipients,
    flyerId, shortUrlId, scheduleAt,
    skipUnsubscribeFilter = false,
    skipDeduplicate = false,
  } = params;

  // 1. 발송 가능 여부 (매장 + 총판 레벨)
  const canSend = await canFlyerStoreSend(userId);
  if (!canSend.ok) {
    return {
      ok: false,
      totalRequested: recipients.length,
      deduplicated: 0,
      unsubscribedRemoved: 0,
      enqueued: 0,
      callbackUsed: null,
      error: canSend.reason,
    };
  }

  // 2. 회신번호 결정
  const cb = await resolveFlyerCallback(companyId, requestedCallback);
  if (!cb.callback) {
    return {
      ok: false,
      totalRequested: recipients.length,
      deduplicated: 0,
      unsubscribedRemoved: 0,
      enqueued: 0,
      callbackUsed: null,
      error: cb.error || '회신번호를 결정할 수 없습니다',
    };
  }

  // 3. 중복제거
  let working: FlyerSendRecipient[] = recipients;
  let dedupRemoved = 0;
  if (!skipDeduplicate) {
    const r = deduplicateWithStats(recipients);
    working = r.deduplicated as FlyerSendRecipient[];
    dedupRemoved = r.removedCount;
  }

  // 4. 수신거부 제외
  let unsubRemoved = 0;
  if (!skipUnsubscribeFilter && working.length > 0) {
    const phones = working.map(r => r.phone);
    const allowed = await filterOutFlyerUnsubscribed(userId, phones);
    const allowedSet = new Set(allowed);
    const filtered = working.filter(r => allowedSet.has(r.phone));
    unsubRemoved = working.length - filtered.length;
    working = filtered;
  }

  if (working.length === 0) {
    return {
      ok: false,
      totalRequested: recipients.length,
      deduplicated: dedupRemoved,
      unsubscribedRemoved: unsubRemoved,
      enqueued: 0,
      callbackUsed: cb.callback,
      error: '발송 가능한 수신자가 없습니다',
    };
  }

  // 5. 080 번호 조회 (광고 부착용)
  const opt080Result = await query(
    `SELECT opt_out_080_number FROM flyer_companies WHERE id = $1`,
    [companyId]
  );
  const opt080: string | null = opt080Result.rows[0]?.opt_out_080_number || null;

  // 6. 변수 치환 + (광고) 부착 → 메시지 최종본 생성
  // bulkInsertSmsQueue rows 형식: [dest_no, call_back, msg_contents, msg_type, title_str, sendTime, app_etc1(campaignId), app_etc2(companyId), file_name1, file_name2, file_name3]
  const mmsImages = mmsImagePaths || [];
  const rowsForQueue: any[][] = working.map(r => [
    r.phone,                                                                  // dest_no
    cb.callback!,                                                             // call_back
    prepareFlyerSendMessage(messageTemplate, r as FlyerCustomerVars, isAd, opt080), // msg_contents
    toQtmsgType(messageType),                                                 // msg_type
    subject || '',                                                            // title_str
    '',                                                                       // sendTime (useNow=true이면 무시)
    '',                                                                       // app_etc1 (campaignId — 아래에서 설정)
    companyId,                                                                // app_etc2
    mmsImages[0] || '',                                                       // file_name1
    mmsImages[1] || '',                                                       // file_name2
    mmsImages[2] || '',                                                       // file_name3
  ]);

  // 7. flyer_campaigns 레코드 생성
  const campaignResult = await query(
    `INSERT INTO flyer_campaigns
       (id, company_id, created_by, flyer_id, short_url_id,
        message_type, message_content, is_ad, callback_number, mms_image_path,
        total_recipients, sent_count, success_count, fail_count,
        status, scheduled_at, sent_at, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0, 0,
             $11, $12, $13, NOW())
     RETURNING id`,
    [
      companyId, userId, flyerId || null, shortUrlId || null,
      messageType, messageTemplate, isAd, cb.callback,
      mmsImagePaths?.[0] || null,
      working.length,
      scheduleAt ? 'queued' : 'sending',
      scheduleAt || null,
      scheduleAt ? null : new Date(),
    ]
  );
  const campaignId = campaignResult.rows[0].id;

  // 8. 선불 잔액 차감 (100% 선불 — 후불 없음)
  const deductResult = await deductFlyerPrepaid(userId, working.length, messageType);
  if (!deductResult.ok) {
    // 잔액 부족 → 캠페인 취소 처리
    await query(`UPDATE flyer_campaigns SET status = 'cancelled' WHERE id = $1`, [campaignId]);
    return {
      ok: false,
      campaignId,
      totalRequested: recipients.length,
      deduplicated: dedupRemoved,
      unsubscribedRemoved: unsubRemoved,
      enqueued: 0,
      callbackUsed: cb.callback,
      error: deductResult.reason,
    };
  }

  // 9. 예약이면 지금 INSERT 안 하고 완료 (자동발송 워커가 처리 — 향후)
  if (scheduleAt) {
    return {
      ok: true,
      campaignId,
      totalRequested: recipients.length,
      deduplicated: dedupRemoved,
      unsubscribedRemoved: unsubRemoved,
      enqueued: 0,
      callbackUsed: cb.callback,
    };
  }

  // 10. MySQL 큐 bulk INSERT
  const tables = await getFlyerCompanySmsTables(companyId);
  await bulkInsertSmsQueue(tables, rowsForQueue, true); // useNow=true 즉시발송

  // 11. 발송 상태 업데이트
  await query(
    `UPDATE flyer_campaigns SET sent_count = $1, status = 'sending', sent_at = NOW() WHERE id = $2`,
    [working.length, campaignId]
  );

  return {
    ok: true,
    campaignId,
    totalRequested: recipients.length,
    deduplicated: dedupRemoved,
    unsubscribedRemoved: unsubRemoved,
    enqueued: working.length,
    callbackUsed: cb.callback,
  };
}
