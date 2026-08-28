/**
 * agency-send-cancel.ts — 대행발송 취소 효과 CT (★2026-08-26(3) routes/agency-send.ts에서 원본 복사로 승격)
 *
 * 입구 둘(고객 화면 · 슈퍼관리자 운영 취소)이 **같은 함수**를 지난다 — 승인 CT(agency-send-approve)와
 * 같은 패턴이다. 경위 = Harold "급하게 전화로 취소 요청이 오는데 우리가 고객 비밀번호를 모른다".
 *
 * ⛔ **취소는 두 저장소를 건드리는 다단계 작업이다**(★2026-08-23 Codex 3R critical).
 *   원장을 먼저 `cancelled`로 확정하면, 그 뒤 큐 삭제가 실패하거나 프로세스가 죽는 순간
 *   **화면은 취소인데 큐는 살아 요청 시각에 나간다**(0611 에이치피오 87,014건과 같은 형태).
 *   그래서 ①`cancelling`으로 먼저 잡고 ②큐를 지운 뒤 ③`cancelled`로 확정한다.
 *   죽어서 남은 `cancelling`은 워커 F가 마무리한다(발송을 막는 쪽으로 민다).
 * ⛔ 근거는 **시도 키(dispatch_key) 하나다.** 원장의 `campaign_id`는 나중에 적히는 캐시다.
 * ⛔ 큐 삭제는 자체 DELETE가 아니라 기존 캠페인 취소 CT(`campaign-lifecycle.cancelCampaign`)가 소유한다.
 */
import { query } from '../config/database';
import { canCancel, NOT_CANCELABLE_SQL } from './agency-send-state';
import { findAttemptCampaignId } from './agency-send-campaign';
import { logEvent } from './agency-send-intake';

export type CancelTxResult =
  /** pending=true = 취소 중(큐 정리가 안 끝났다 · 워커가 마무리한다). row = 현재 행 원본 */
  | { ok: true; pending: boolean; row: any }
  | { ok: false; status: number; error: string; code?: string; tooLate?: boolean };

export async function cancelAgencyRequestTx(opts: {
  requestId: string;
  companyId: string;
  /** cancel_reason에 그대로 남는다(입구가 만든다 · 200자 상한은 여기서 자른다) */
  reason: string;
  /** 소유자 술어 — 회사 일반 사용자 경로는 본인 id, 관리자·슈퍼관리자 경로는 null(회사 전체) */
  ownerUserId: string | null;
  cancelledBy: string;
  cancelledByType?: string;
}): Promise<CancelTxResult> {
  // ⛔ 잡을 때 **옛 상태를 함께 받아 둔다**(`RETURNING`은 갱신 뒤 값이라 그것만으로는 되돌릴 수 없다).
  //   워커가 잡고 있는 행(`lock_token`)은 건드리지 않는다.
  const claimed = await query(
    `WITH prev AS (
       SELECT id, status, revision FROM agency_send_requests
        WHERE id = $1::uuid AND company_id = $2::uuid AND ($4::uuid IS NULL OR created_by = $4::uuid)
        FOR UPDATE
     )
     UPDATE agency_send_requests a
        SET status = 'cancelling', cancel_reason = $3, lock_at = NOW(),
            revision = a.revision + 1, updated_at = NOW()
       FROM prev
      WHERE a.id = prev.id
        AND prev.status NOT IN (${NOT_CANCELABLE_SQL})
        AND a.lock_token IS NULL
     RETURNING prev.status AS prev_status, prev.revision AS prev_revision, a.*`,
    [opts.requestId, opts.companyId, String(opts.reason || '담당자 취소').slice(0, 200), opts.ownerUserId],
  );

  if (claimed.rows.length === 0) {
    // 소유자 술어를 여기도 건다 — 남의 접수는 상태("이미 취소됨" 등)조차 보이면 안 된다(404로 답한다)
    const nowRow = await query(
      `SELECT status FROM agency_send_requests
        WHERE id = $1::uuid AND company_id = $2::uuid AND ($3::uuid IS NULL OR created_by = $3::uuid)`,
      [opts.requestId, opts.companyId, opts.ownerUserId],
    );
    if (nowRow.rows.length === 0) return { ok: false, status: 404, error: '접수를 찾을 수 없습니다.' };
    if (nowRow.rows[0].status === 'cancelled') {
      return { ok: false, status: 409, error: '이미 취소된 접수입니다.', code: 'ALREADY_CANCELLED' };
    }
    if (nowRow.rows[0].status === 'cancelling') {
      return { ok: false, status: 409, error: '취소를 처리하고 있습니다. 잠시 후 화면을 새로 고쳐 주세요.', code: 'CANCEL_IN_PROGRESS' };
    }
    if (!canCancel(nowRow.rows[0].status)) {
      return { ok: false, status: 400, error: '검사가 진행 중이라 지금은 취소할 수 없습니다. 잠시 후 다시 시도해 주세요.' };
    }
    return { ok: false, status: 409, code: 'STATE_CHANGED', error: '처리 중이라 취소하지 못했습니다. 화면을 새로 고치고 다시 시도해 주세요.' };
  }

  const claimedRow = claimed.rows[0];
  const campaignId = await findAttemptCampaignId(opts.companyId, claimedRow.dispatch_key);

  // 예약이 만들어진 뒤의 취소는 **큐 삭제까지 끝나야** 취소다.
  if (campaignId) {
    let result: { success: boolean; error?: string; tooLate?: boolean; alreadySent?: boolean };
    try {
      const { cancelCampaign } = await import('./campaign-lifecycle');
      // ⛔ `queueOnly` — 대행발송 캠페인은 적재를 끝내면 `completed`가 된다(예약 시각은 큐 행이 든다).
      //   이 옵션이 없으면 상태 게이트에 막혀 **예약이 잡힌 접수를 아무도 취소할 수 없다**(0828 확정).
      //   15분 게이트(`skipTimeCheck`)는 켜지 않는다 — 그건 사용자 정책이고 여기는 사용자 입구다.
      result = await cancelCampaign(campaignId, opts.companyId, {
        cancelledBy: opts.cancelledBy,
        cancelledByType: opts.cancelledByType,
        queueOnly: true,
      });
    } catch (cancelErr: any) {
      result = { success: false, error: String(cancelErr?.message || '취소 처리 중 오류가 발생했습니다.') };
    }

    // ⛔ **막을 것이 없었다 = 이미 나갔다.** 여기서 `cancelled`로 확정하면 화면이 거짓말을 한다
    //   (고객은 메시지를 받았는데 접수는 취소됨). 원래 상태로 되돌리고 사실을 알린다.
    //   되돌리기가 안전한 이유 = 큐를 건드린 것이 0건이라 상태를 유지해도 어긋나지 않는다(`tooLate`와 같다).
    if (result.success && result.alreadySent) {
      const reverted = await query(
        `UPDATE agency_send_requests
            SET status = $1, cancel_reason = NULL, revision = revision + 1, updated_at = NOW()
          WHERE id = $2::uuid AND company_id = $3::uuid AND status = 'cancelling' AND revision = $4`,
        [claimedRow.prev_status, opts.requestId, opts.companyId, claimedRow.revision],
      );
      await logEvent(opts.requestId, 'cancel_already_sent', {
        campaignId, reverted: reverted.rowCount || 0,
      });
      return {
        ok: false, status: 409, code: 'ALREADY_SENT',
        error: '이미 발송이 끝나 취소할 수 없습니다.',
      };
    }
    if (!result.success) {
      // ⛔ **되돌리는 것은 "큐를 건드리기 전에 거절당한 것이 확실할 때"뿐이다**(★2026-08-23 Codex 4R high).
      //   발송 15분 전 거절(`tooLate`)이 그 경우다. 그 밖의 실패·예외는 큐를 이미 지웠는지 알 수 없으므로
      //   `cancelling`으로 남긴다 — 워커가 이어받아 끝까지 민다(화면은 "취소 중").
      //   여기서 되돌리면 취소 의도가 사라져 **예약이 그대로 나간다.**
      if (result.tooLate) {
        const reverted = await query(
          `UPDATE agency_send_requests
              SET status = $1, cancel_reason = NULL, revision = revision + 1, updated_at = NOW()
            WHERE id = $2::uuid AND company_id = $3::uuid AND status = 'cancelling' AND revision = $4`,
          [claimedRow.prev_status, opts.requestId, opts.companyId, claimedRow.revision],
        );
        await logEvent(opts.requestId, 'cancel_rejected', {
          campaignId, error: result.error, reverted: reverted.rowCount || 0,
        });
        return { ok: false, status: 400, error: result.error || '취소하지 못했습니다.', tooLate: true };
      }
      await logEvent(opts.requestId, 'cancel_queue_failed', { campaignId, error: result.error });
      const pendingRow = await query(
        `SELECT * FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
        [opts.requestId, opts.companyId],
      );
      return { ok: true, pending: true, row: pendingRow.rows[0] };
    }
  }

  // ⛔ 캠페인이 없고 **시도 키가 남아 있으면** 즉시 확정하지 않는다(★2026-08-23 Codex 5R critical).
  //   예약을 만들던 핸들러가 뒤늦게 캠페인을 완성할 수 있다. 그 창은 워커가 시간으로 닫는다.
  if (!campaignId && claimedRow.dispatch_key) {
    await logEvent(opts.requestId, 'cancel_pending_dispatch', { dispatchKey: claimedRow.dispatch_key });
    const pendingRow = await query(
      `SELECT * FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
      [opts.requestId, opts.companyId],
    );
    return { ok: true, pending: true, row: pendingRow.rows[0] };
  }

  // 큐가 없어졌음을 확인한 뒤에만 취소를 확정한다.
  const done = await query(
    `UPDATE agency_send_requests
        SET status = 'cancelled', cancelled_at = NOW(), lock_at = NULL,
            revision = revision + 1, updated_at = NOW()
      WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'cancelling' AND revision = $3
      RETURNING *`,
    [opts.requestId, opts.companyId, claimedRow.revision],
  );
  if (done.rows.length === 0) {
    // 워커가 먼저 마무리했거나 그 사이 상태가 또 바뀌었다. 큐는 이미 지웠으므로 발송 위험은 없다.
    await logEvent(opts.requestId, 'cancel_finalized_elsewhere', { campaignId });
    const cur = await query(
      `SELECT * FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
      [opts.requestId, opts.companyId],
    );
    return { ok: true, pending: false, row: cur.rows[0] };
  }

  await logEvent(opts.requestId, 'cancelled', {
    queueCancelled: !!campaignId, campaignId, from: claimedRow.prev_status,
    by: opts.cancelledBy, byType: opts.cancelledByType || null,
  });
  return { ok: true, pending: false, row: done.rows[0] };
}
