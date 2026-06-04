/**
 * ★ 대량 발송 worker (2026-05-30) — staging 청크 발송 + 진행률
 *
 * commit이 정제(수신거부/중복제거)를 끝낸 campaign_send_staging을 청크(1만)씩 처리.
 * 기존 worker 패턴(setInterval 5초) + commit 직후 즉시 트리거.
 * Node 블로킹 0(청크마다 이벤트루프 양보), idempotent(processed_count OFFSET).
 */
import { query } from '../config/database';
import { prepareFieldMappings, getOpt080Number } from './messageUtils';
import { prepaidRefund } from './prepaid';
import { getCompanySmsTables, toKoreaTimeStr } from './sms-queue';
import { calcSplitSendTime } from './send-time-util';
import { processSendChunk, type ChunkRecipient } from './direct-send-processor';

const CHUNK = 10000;
let running = false;

/** queued 캠페인을 순차 처리 (동시 진입 방지 플래그) */
export async function runDirectSendOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await query(
      `SELECT id FROM campaigns WHERE send_phase = 'queued' ORDER BY created_at ASC LIMIT 5`
    );
    for (const row of due.rows) {
      try {
        await processCampaign(row.id);
      } catch (e) {
        console.error(`[direct-send-worker] 캠페인 ${row.id} 처리 실패:`, e);
        await query(`UPDATE campaigns SET send_phase = 'failed', updated_at = NOW() WHERE id = $1`, [row.id]).catch(() => {});
      }
    }
  } finally {
    running = false;
  }
}

async function processCampaign(campaignId: string): Promise<void> {
  // queued → processing claim (동시 처리/중복 발송 방지)
  const claim = await query(
    `UPDATE campaigns SET send_phase = 'processing', updated_at = NOW()
     WHERE id = $1 AND send_phase = 'queued'
     RETURNING company_id, created_by, target_count, processed_count, staging_id, send_config`,
    [campaignId]
  );
  if (claim.rows.length === 0) return; // 다른 사이클이 선점
  const c = claim.rows[0];
  const companyId: string = c.company_id;
  const userId: string = c.created_by;
  const stagingId: string = c.staging_id;
  const cfg: any = c.send_config || {};
  const total: number = c.target_count || 0;

  const companyTables = await getCompanySmsTables(companyId, userId);
  const directFieldMappings = await prepareFieldMappings(companyId);
  const finalIsAd = cfg.adEnabled === true;
  const opt080 = finalIsAd ? await getOpt080Number(userId || null, companyId) : '';
  const useNow = !cfg.scheduled && !(cfg.splitEnabled && cfg.splitCount > 0);

  let processed: number = c.processed_count || 0;
  let sent = 0;

  // ★ 2026-06-04 정정: commit에서 옮긴 정제 — 발송 직전 1회. count/commit과 같은 기준이라 모달=차감=발송 일치.
  //   첫 처리(processed===0)에만 수행(재시작 시 중복 정제 방지). dedup/unsub은 send_config 기준.
  if (processed === 0) {
    if (cfg.unsubFilterEnabled !== false) {
      await query(
        `DELETE FROM campaign_send_staging s USING unsubscribes u WHERE s.staging_id = $1 AND u.user_id = $2 AND u.phone = s.phone`,
        [stagingId, userId]
      );
    }
    if (cfg.dedupEnabled !== false) {
      await query(
        `DELETE FROM campaign_send_staging
         WHERE ctid IN (
           SELECT ctid FROM (
             SELECT ctid, ROW_NUMBER() OVER (PARTITION BY phone ORDER BY id) AS rn
             FROM campaign_send_staging WHERE staging_id = $1
           ) t WHERE rn > 1
         )`,
        [stagingId]
      );
    }
  }

  while (processed < total) {
    const chunkRes = await query(
      `SELECT id, phone, name, extra1, extra2, extra3, callback
       FROM campaign_send_staging WHERE staging_id = $1 ORDER BY id ASC LIMIT $2 OFFSET $3`,
      [stagingId, CHUNK, processed]
    );
    if (chunkRes.rows.length === 0) break;

    const recipients: ChunkRecipient[] = chunkRes.rows.map((r: any, i: number) => {
      const globalIndex = processed + i;
      let sendTime = '';
      if (cfg.scheduled && cfg.scheduledAt) {
        sendTime = (cfg.splitEnabled && cfg.splitCount > 0)
          ? toKoreaTimeStr(calcSplitSendTime(new Date(cfg.scheduledAt), Math.floor(globalIndex / cfg.splitCount)))
          : toKoreaTimeStr(new Date(cfg.scheduledAt));
      } else if (cfg.splitEnabled && cfg.splitCount > 0) {
        sendTime = toKoreaTimeStr(calcSplitSendTime(new Date(), Math.floor(globalIndex / cfg.splitCount)));
      }
      return {
        phone: r.phone, name: r.name, extra1: r.extra1, extra2: r.extra2, extra3: r.extra3,
        callback: r.callback, sendTime,
      };
    });

    const result = await processSendChunk({
      companyId, campaignId, companyTables, recipients, directFieldMappings,
      sendChannel: cfg.sendChannel || 'sms', msgType: cfg.msgType, message: cfg.message || '',
      subject: cfg.subject || '', callback: cfg.callback || '',
      useIndividualCallback: cfg.useIndividualCallback || false,
      finalIsAd, opt080, mmsImagePaths: cfg.mmsImagePaths || [], useNow,
      kakaoBubbleType: cfg.kakaoBubbleType, kakaoSenderKey: cfg.kakaoSenderKey, kakaoTargeting: cfg.kakaoTargeting,
      kakaoAttachmentJson: cfg.kakaoAttachmentJson, kakaoCarouselJson: cfg.kakaoCarouselJson, kakaoResendType: cfg.kakaoResendType,
      alimtalkTemplateCode: cfg.alimtalkTemplateCode, alimtalkVariableMap: cfg.alimtalkVariableMap,
      alimtalkButtonJson: cfg.alimtalkButtonJson, alimtalkNextType: cfg.alimtalkNextType,
      alimtalkNextContents: cfg.alimtalkNextContents, alimtalkNextSubject: cfg.alimtalkNextSubject,
      alimtalkEtcJson: cfg.alimtalkEtcJson,
    });
    sent += result.sentCount;
    processed += chunkRes.rows.length;

    await query(`UPDATE campaigns SET processed_count = $1, updated_at = NOW() WHERE id = $2`, [processed, campaignId]);
    await new Promise((res) => setImmediate(res)); // 이벤트루프 양보 — 다른 요청 블로킹 방지
  }

  // 실패분(큐 INSERT 실패) 환불
  const failed = Math.max(0, total - sent);
  if (failed > 0) {
    try {
      const deductType = (cfg.sendChannel === 'kakao') ? 'KAKAO' : cfg.msgType;
      await prepaidRefund(companyId, failed, deductType, campaignId, `대량 발송 실패 ${failed}건 자동 환불`);
    } catch (refundErr) {
      console.error('[direct-send-worker] 실패분 환불 오류:', refundErr);
    }
  }

  // 완료 처리 + staging 정리
  const finalStatus = cfg.scheduled ? 'scheduled' : (sent === 0 ? 'failed' : 'completed');
  await query(
    `UPDATE campaigns SET send_phase = 'sent', status = $1, sent_count = $2, fail_count = $3, sent_at = NOW(), updated_at = NOW() WHERE id = $4`,
    [finalStatus, sent, failed, campaignId]
  );
  await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1`, [stagingId]);
  console.log(`[direct-send-worker] 캠페인 ${campaignId} 완료 — 발송 ${sent}/${total}, 실패 ${failed}`);
}

/** app.ts 등록 — 5초 주기 queued 캠페인 처리 */
export function startDirectSendWorker(): void {
  setInterval(() => { void runDirectSendOnce(); }, 5000);
  console.log('[direct-send-worker] 시작 — 5초 주기 + commit 즉시 트리거');
}

/** commit 직후 즉시 트리거 (5초 대기 없이) */
export function triggerDirectSendWorker(_campaignId: string): void {
  void runDirectSendOnce();
}
