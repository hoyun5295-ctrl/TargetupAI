"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendFlyerCampaign = sendFlyerCampaign;
const database_1 = require("../../../config/database");
const flyer_sms_queue_1 = require("./flyer-sms-queue");
const flyer_billing_1 = require("../billing/flyer-billing");
const flyer_callback_filter_1 = require("./flyer-callback-filter");
const flyer_deduplicate_1 = require("./flyer-deduplicate");
const flyer_unsubscribe_helper_1 = require("./flyer-unsubscribe-helper");
const flyer_message_1 = require("./flyer-message");
const flyer_short_code_1 = require("./flyer-short-code");
async function sendFlyerCampaign(params) {
    const { companyId, userId, messageType, messageTemplate, isAd, requestedCallback, mmsImagePaths, subject, recipients, flyerId, shortUrlId, scheduleAt, skipUnsubscribeFilter = false, skipDeduplicate = false, } = params;
    // 1. 발송 가능 여부 (매장 + 총판 레벨)
    const canSend = await (0, flyer_billing_1.canFlyerStoreSend)(userId);
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
    const cb = await (0, flyer_callback_filter_1.resolveFlyerCallback)(companyId, requestedCallback);
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
    let working = recipients;
    let dedupRemoved = 0;
    if (!skipDeduplicate) {
        const r = (0, flyer_deduplicate_1.deduplicateWithStats)(recipients);
        working = r.deduplicated;
        dedupRemoved = r.removedCount;
    }
    // 4. 수신거부 제외
    let unsubRemoved = 0;
    if (!skipUnsubscribeFilter && working.length > 0) {
        const phones = working.map(r => r.phone);
        const allowed = await (0, flyer_unsubscribe_helper_1.filterOutFlyerUnsubscribed)(userId, phones);
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
    const opt080Result = await (0, database_1.query)(`SELECT opt_out_080_number FROM flyer_companies WHERE id = $1`, [companyId]);
    const opt080 = opt080Result.rows[0]?.opt_out_080_number || null;
    // 6. 변수 치환 + (광고) 부착 → 메시지 최종본 생성
    // bulkInsertSmsQueue rows 형식: [dest_no, call_back, msg_contents, msg_type, title_str, sendTime, app_etc1(campaignId), app_etc2(companyId), file_name1, file_name2, file_name3]
    const mmsImages = mmsImagePaths || [];
    // ★ Phase 1: 수신자별 메시지 생성 (추적 URL 치환은 campaignId 확보 후 진행)
    // 먼저 공통 메시지 생성 → 추적 URL 삽입은 9.5단계에서 처리
    const baseMessages = working.map(r => (0, flyer_message_1.prepareFlyerSendMessage)(messageTemplate, r, isAd, opt080));
    // 7. flyer_campaigns 레코드 생성
    const campaignResult = await (0, database_1.query)(`INSERT INTO flyer_campaigns
       (id, company_id, created_by, flyer_id, short_url_id,
        message_type, message_content, is_ad, callback_number, mms_image_path,
        total_recipients, sent_count, success_count, fail_count,
        status, scheduled_at, sent_at, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0, 0,
             $11, $12, $13, NOW())
     RETURNING id`, [
        companyId, userId, flyerId || null, shortUrlId || null,
        messageType, messageTemplate, isAd, cb.callback,
        mmsImagePaths?.[0] || null,
        working.length,
        scheduleAt ? 'queued' : 'sending',
        scheduleAt || null,
        scheduleAt ? null : new Date(),
    ]);
    const campaignId = campaignResult.rows[0].id;
    // 8. 선불 잔액 차감 (100% 선불 — 후불 없음)
    const deductResult = await (0, flyer_billing_1.deductFlyerPrepaid)(userId, working.length, messageType);
    if (!deductResult.ok) {
        // 잔액 부족 → 캠페인 취소 처리
        await (0, database_1.query)(`UPDATE flyer_campaigns SET status = 'cancelled' WHERE id = $1`, [campaignId]);
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
    // 9.5 ★ Phase 1: 수신자별 추적 URL 생성 + 메시지에 삽입
    //   flyerId가 있으면 개인별 추적 URL 생성, 없으면 공통 메시지 그대로 사용
    let finalMessages = baseMessages;
    if (flyerId) {
        try {
            const phones = working.map(r => r.phone);
            const urlMap = await (0, flyer_short_code_1.generateTrackingUrls)(flyerId, companyId, campaignId, phones);
            // 메시지 내 {url} 플레이스홀더를 개인별 URL로 치환
            // {url} 없으면 메시지 끝에 URL 추가
            finalMessages = baseMessages.map((msg, idx) => {
                const phone = working[idx].phone;
                const personalUrl = urlMap.get(phone);
                if (!personalUrl)
                    return msg;
                if (msg.includes('{url}')) {
                    return msg.replace('{url}', personalUrl);
                }
                // {url} 플레이스홀더가 없으면 그대로 유지 (URL 미삽입)
                return msg;
            });
        }
        catch (err) {
            // ★ 추적 URL 생성 실패해도 발송 자체는 진행 (기간계 안정성)
            console.error('[CT-F18] 추적 URL 생성 실패 (발송은 계속):', err.message);
        }
    }
    // 10. MySQL 큐 bulk INSERT (수신자별 메시지로 생성)
    const rowsForQueue = working.map((r, idx) => [
        r.phone, // dest_no
        cb.callback, // call_back
        finalMessages[idx], // msg_contents (개인별 URL 포함 가능)
        (0, flyer_sms_queue_1.toQtmsgType)(messageType), // msg_type
        subject || '', // title_str
        '', // sendTime
        campaignId, // app_etc1
        companyId, // app_etc2
        mmsImages[0] || '', // file_name1
        mmsImages[1] || '', // file_name2
        mmsImages[2] || '', // file_name3
    ]);
    const tables = await (0, flyer_sms_queue_1.getFlyerCompanySmsTables)(companyId);
    await (0, flyer_sms_queue_1.bulkInsertSmsQueue)(tables, rowsForQueue, true); // useNow=true 즉시발송
    // 11. 발송 상태 업데이트
    await (0, database_1.query)(`UPDATE flyer_campaigns SET sent_count = $1, status = 'sending', sent_at = NOW() WHERE id = $2`, [working.length, campaignId]);
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
//# sourceMappingURL=flyer-send.js.map