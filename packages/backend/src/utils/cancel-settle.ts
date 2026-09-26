/**
 * ★ 2026-09-26 한줄로 V2 F35 (Codex 4차 1R high A) — 취소 정산 공용 CT.
 *
 * 취소 CT(cancelCampaign) · 취소 환불 재시도 워커 · 직접발송 워커(적재 중 취소)가 **같은 산식**으로 취소를 정산한다.
 * 옛 취소는 삭제 전에 센 대기 수로 환불하고 결과와 무관하게 'cancelled'로 확정했다. 예약 시각이 지난 뒤엔 세고 지우는
 * 사이에 Agent가 행을 집어 가 나간 행까지 환불되고(과환불) 상태가 cancelled라 청구·정산 스위퍼에서 빠졌다.
 * 대기 행을 지운 뒤에는 새로 집힐 행이 없다 — 그때의 사실(settleCancelOutcome)로 결말을 가른다.
 */
import { query } from '../config/database';
import { prepaidRefund, REFUND_KEYS } from './prepaid';
import { getCampaignSmsTables, smsCampaignCountsSafe, smsCountAll } from './sms-queue';
import { resolveRefundAxes } from './billing-types';
import { sendSystemAlert } from './system-alert';

/** 취소 환불 의무(send_config.refundPendingCancel)의 새 형식 표식 — 건수 대신 "사실로 다시 정산하라". */
export const CANCEL_SETTLE_MODE = 'settle';

/** 큐·이력 행을 셀 기준월 — 생성일과 예약일(있으면). 둘 다 없으면 지금. */
export function campaignRefDates(c: { created_at?: any; scheduled_at?: any }): Date[] {
  const refDates: Date[] = [c.created_at, c.scheduled_at]
    .filter((d: any) => d)
    .map((d: any) => new Date(d))
    .filter((d: Date) => !Number.isNaN(d.getTime()));
  if (refDates.length === 0) refDates.push(new Date());
  return refDates;
}

/** 캠페인 행이 있을 수 있는 테이블 — 발송 당시 라이브(기록) + 기준월 전후 이력. */
async function campaignRowTables(companyId: string, userId: string, liveTables: string[], refDates: Date[]): Promise<string[]> {
  const tableSets = await Promise.all(refDates.map((d) => getCampaignSmsTables(companyId, d, userId || undefined, { sentTables: liveTables })));
  return Array.from(new Set(tableSets.flat()));
}

/**
 * 캠페인이 큐에 남긴 행 수 — 선불 sweeper와 같은 산식(smsCampaignCountsSafe · 결과 이력 + 라이브 대기).
 * 테이블 = 발송 당시 기록(sentTables) + **캠페인 날짜(생성·예약)** 기준월 전후 로그(getCampaignSmsTables).
 * ⛔ 기준월을 오늘로 잡으면 몇 달 전에 멈춘 적재의 이력 테이블을 못 봐 이미 나간 행을 0으로 세고 그만큼을 환불한다.
 * kind = 'loaded'(성공+실패+대기 = 적재 수) | 'kept'(성공+대기 = 과금이 유지될 행 · 실패는 FAIL 원인 환불 대상이라 뺀다)
 */
export async function countCampaignRows(
  companyId: string, userId: string, campaignId: string, companyTables: string[], scope: 'all' | 'brand' | 'nonBrand',
  refDates: Date[], kind: 'loaded' | 'kept',
): Promise<number> {
  const tables = await campaignRowTables(companyId, userId, companyTables, refDates);
  const agg = (await smsCampaignCountsSafe(tables, [campaignId], 'app_etc1', scope)).get(campaignId);
  const success = Number(agg?.success || 0);
  const pending = Number(agg?.pending || 0);
  return kind === 'kept' ? success + pending : success + Number(agg?.fail || 0) + pending;
}

/**
 * 대기(100)를 떠난 행 수 — 라이브의 비대기(픽업·발송 중·결과) + 이력. "이 캠페인 발송이 시작됐다"의 판정.
 * 결과 집계(smsCampaignCountsSafe)는 라이브에서 발송 중인 행(통신사 전달 뒤 결과 대기)을 세지 않으므로 여기서는 쓰지 않는다 —
 * 그 행을 놓치면 나간 발송을 "아무것도 안 나감"으로 보고 전액 환불한다. 이동 중(복사 뒤 삭제) 이중 계상은 0/양수 판정엔 무해하다.
 */
export async function countCampaignStartedRows(
  companyId: string, userId: string, campaignId: string, liveTables: string[], refDates: Date[],
): Promise<number> {
  const tables = await campaignRowTables(companyId, userId, liveTables, refDates);
  return smsCountAll(tables, 'app_etc1 = ? AND status_code != 100', [campaignId]);
}

/**
 * ★ 2026-09-25 C-10 (Codex 1R 구조 정정): 취소된 캠페인 정산 — 큐 대기 행을 지운 **뒤에** 부른다.
 *   축마다 **캠페인 전체 기준 목표**(prepaidRefund keepCount) = 차감 − 남아서 과금이 유지될 행(성공+대기)으로 돌려준다.
 *   모든 원인(NOT_LOADED·CANCEL·FAIL)의 누적 환불과 비교해 차이만 나가므로, 취소 경로(cancelCampaign)가 먼저 준 대기분·
 *   앞선 시도가 준 미적재분·중단 후 재시도와 겹쳐도 합이 "차감 − 남는 행"으로 수렴한다(원인별 목표는 서로를 못 봐 이중 지급됐다).
 *   실측·환불이 하나라도 실패하면 ok=false — 호출측이 재정산 경로(워커 recover · 취소 환불 재시도)에 남긴다.
 *   ★ 2026-09-26 직접발송 워커에서 이 CT로 옮김(취소 CT·재시도 워커가 같이 쓴다) · 돌려준 금액을 함께 낸다.
 */
export async function settleCancelledLoadRefund(p: {
  companyId: string; userId: string; campaignId: string; sendChannel: string; msgType: any; companyTables: string[];
  refDates: Date[];
}): Promise<{ ok: boolean; refunded: number }> {
  let refunded = 0;
  for (const axis of resolveRefundAxes(p.sendChannel, p.msgType)) {
    try {
      const kept = await countCampaignRows(p.companyId, p.userId, p.campaignId, p.companyTables, axis.scope, p.refDates, 'kept');
      const r = await prepaidRefund(
        p.companyId, 0, axis.type, p.campaignId, `예약 취소 환불(취소 정산 · 남은 ${kept}건 제외)`, 'campaign',
        { refundKey: REFUND_KEYS.CANCEL, keepCount: kept },
      );
      refunded += r.refunded;
      if (!r.ok) {
        console.error(`[취소 정산] 환불 미완료 campaign=${p.campaignId} ${axis.type} — 재정산 대기`);
        return { ok: false, refunded };
      }
    } catch (e: any) {
      console.error(`[취소 정산] 실패 campaign=${p.campaignId} ${axis.type}:`, e?.message || e);
      return { ok: false, refunded };
    }
  }
  return { ok: true, refunded };
}

export interface CancelSettleCampaign {
  id: string;
  company_id: string;
  created_by?: string | null;
  status?: string | null;
  send_channel?: string | null;
  message_type?: string | null;
  created_at?: any;
  scheduled_at?: any;
}

/**
 * 취소 결말을 **사실로** 가른다 — 대기 행 삭제·잔존 0 검증 **뒤에** 부른다(그 뒤엔 새로 집힐 행이 없다).
 *
 *  sent      = 이 캠페인 행이 하나라도 대기를 떠났다(발송 시작 · 세고 지우는 사이 픽업). 취소로 표시하지 않는다 —
 *              'cancelled'면 나간 몫이 청구(status='completed')와 정산 스위퍼에서 빠진다. 발송 캠페인으로 넘긴다:
 *              completed + 적재 수 = 남은 행 실측(예약 정리 워커와 같은 모양). 그러면 스위퍼가 막은 몫(차감 − 적재 = 미적재) ·
 *              실패 · 초과 회수를 한 원장으로 맞춘다. **여기서 환불하지 않는다** — 두 곳이 주면 이중 지급이다.
 *  cancelled = 아무것도 나가지 않았다. 상태를 취소로 확정(이미 취소가 아니면)하고 축마다 캠페인 전체 기준(차감 − 남는 행)으로 환불한다.
 *              상태를 먼저 확정한다 — 환불이 실패해도 재시도 워커가 같은 결말로 다시 정산한다.
 *
 * ⛔ 정산 모드 취소 의무는 **누가 실행하든 이 CT 하나로만** 정산한다(취소 CT · 워커 취소 분기 · 재시도 워커). 한 의무를 두 방식
 *   (취소 항아리 전체 기준 · 스위퍼 원인별)이 나눠 가지면 같은 삭제분이 두 번 나간다(Codex 4차 3R).
 */
export async function settleCancelOutcome(p: {
  camp: CancelSettleCampaign;
  liveTables: string[];
  refDates: Date[];
  cancel?: { cancelledBy?: string | null; cancelledByType?: string | null; reason?: string | null };
}): Promise<{ outcome: 'cancelled' | 'sent'; ok: boolean; refunded: number }> {
  const c = p.camp;
  const userId = c.created_by || '';
  const started = await countCampaignStartedRows(c.company_id, userId, c.id, p.liveTables, p.refDates);

  if (started > 0) {
    const tables = await campaignRowTables(c.company_id, userId, p.liveTables, p.refDates);
    const agg = (await smsCampaignCountsSafe(tables, [c.id])).get(c.id);
    // ★ Codex 4차 2R high — 적재 수 낮추기는 상태 전환과 무관하게 반영한다. 결과 동기화·예약 정리가 먼저 completed로 바꿨어도
    //   sent_count가 삭제 전 적재 수로 남으면 스위퍼 미적재(부담 − max(sent_count, 결과 합))가 막은 몫을 빼먹는다
    //   (동기화 COALESCE(NULLIF)·스위퍼 GREATEST는 이 값을 낮추지 않는다). 상태는 예약·초안일 때만 completed로 바꾼다.
    //   취소로 굳은 캠페인은 건드리지 않는다 — 반영 0행이면 모순이라 의무를 남기고 경보(ok=false).
    const upd = await query(
      `UPDATE campaigns SET status = CASE WHEN status IN ('scheduled', 'draft') THEN 'completed' ELSE status END,
              sent_count = $1, success_count = $2, fail_count = $3,
              sent_at = COALESCE(sent_at, scheduled_at, NOW()), updated_at = NOW()
        WHERE id = $4 AND status <> 'cancelled'`,
      [Number(agg?.total || 0), Number(agg?.success || 0), Number(agg?.fail || 0), c.id],
    );
    if (!upd.rowCount) {
      await sendSystemAlert({
        dedupKey: `cancel-settle-sent-unapplied:${c.id}`,
        message: `취소 정산 보류 — 대기를 떠난 행 ${started}건이 있는데 캠페인이 취소로 굳어 있어 발송 캠페인으로 넘기지 못했습니다(청구·환불 수동 확인). campaign=${c.id}`,
      }).catch(() => { /* 경보 실패가 흐름을 막지 않는다 */ });
      return { outcome: 'sent', ok: false, refunded: 0 };
    }
    console.warn(`[취소 정산] campaign=${c.id} 대기를 떠난 행 ${started}건 — 취소로 확정하지 않고 발송 캠페인으로 넘김(정산 스위퍼가 막은 몫 환불)`);
    return { outcome: 'sent', ok: true, refunded: 0 };
  }

  // ★ Codex 4차 3R — 상태가 이미 completed·sending·failed로 바뀌었어도 취소로 확정한다. 이 CT는 취소 의무(정산 모드)가 있을 때만
  //   불리고, 대기를 떠난 행이 0이면 나간 것이 없다 — 동기화·예약 정리는 적재된 대기 행만 보고 completed로 바꿨을 수 있다.
  //   취소가 되면 정산 스위퍼는 이 캠페인을 보지 않고, 앞서 스위퍼가 준 환불이 있어도 전체 기준 환불은 모든 원인 누적과 비교 ·
  //   차감 상한이라 이중 지급이 없다.
  await query(
    `UPDATE campaigns SET status = 'cancelled', cancelled_by = $1, cancelled_by_type = $2, cancel_reason = $3,
            cancelled_at = NOW(), updated_at = NOW()
      WHERE id = $4 AND status <> 'cancelled'`,
    [p.cancel?.cancelledBy || null, p.cancel?.cancelledByType || null, p.cancel?.reason || null, c.id],
  );
  // 실행 행도 취소(sync-results 재처리 방지)
  await query(
    `UPDATE campaign_runs SET status = 'cancelled' WHERE campaign_id = $1 AND status IN ('scheduled', 'sending')`,
    [c.id],
  );
  const r = await settleCancelledLoadRefund({
    companyId: c.company_id, userId, campaignId: c.id, sendChannel: String(c.send_channel || ''), msgType: c.message_type,
    companyTables: p.liveTables, refDates: p.refDates,
  });
  return { outcome: 'cancelled', ok: r.ok, refunded: r.refunded };
}
