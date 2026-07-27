/**
 * CT: 미완료 환불 의무 기록 — ★ 2026-07-27 (B-0727-2)
 *
 * `prepaidRefund`는 단가 미상·DB 오류로 처리하지 못해도 throw하지 않고 `ok=false`로 돌아온다.
 * 그 상태로 캠페인을 종결하면 아무도 다시 보지 않는다 — 적재 0건이면 `status='failed'`라
 * 선불 sweeper 후보(`sending`/`completed`)에서도 빠지고, sweeper 산식은 처리수 0인 전량
 * 미적재를 구조적으로 손대지 않는다(refund-calc). 그래서 영구 미환불이 된다.
 *
 * 실패한 의무를 `campaigns.send_config.refundPending`에 남겨두면
 * `direct-send-worker`의 재시도 루프가 backoff를 두고 소진한다.
 * 기록 형식을 한 곳에 둔다 — 쓰는 쪽과 읽는 쪽의 키 이름이 어긋나면 의무가 조용히 사라진다.
 */
import { query } from '../config/database';

export interface RefundPendingRecord {
  count: number;
  messageType: string;
  at: string;
  attempts?: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastError?: string;
}

export function buildRefundPending(count: number, messageType: string): RefundPendingRecord {
  return { count, messageType, at: new Date().toISOString() };
}

/**
 * 미적재 환불 실패를 캠페인에 남긴다. 기록 자체가 실패해도 발송 흐름을 막지 않는다
 * (막아봐야 이미 큐는 적재된 뒤다) — 로그로 남겨 사람이 찾을 수 있게 한다.
 */
export async function markRefundPending(campaignId: string, count: number, messageType: string): Promise<void> {
  if (!campaignId || count <= 0 || !messageType) return;
  try {
    await query(
      `UPDATE campaigns
          SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{refundPending}', $2::jsonb),
              updated_at = NOW()
        WHERE id = $1`,
      [campaignId, JSON.stringify(buildRefundPending(count, messageType))],
    );
    console.warn(`[환불의무] campaign=${campaignId} ${messageType} ${count}건 미완료 — 워커 재시도 대기 등록`);
  } catch (e: any) {
    console.error(`[환불의무] campaign=${campaignId} 기록 실패:`, e?.message || e);
  }
}
