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
import { pool } from '../config/database';

export interface RefundPendingRecord {
  count: number;
  messageType: string;
  /**
   * ★ 2026-08-18 **원인 키**. 없으면 워커가 무조건 NOT_LOADED 항아리로 갚아,
   * 취소 보상(CANCEL)으로 생긴 채무가 엉뚱한 항아리에서 멱등 처리돼 사라진다.
   */
  refundKey?: string;
  at: string;
  attempts?: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastError?: string;
}

export function buildRefundPending(count: number, messageType: string, refundKey?: string): RefundPendingRecord {
  return { count, messageType, ...(refundKey ? { refundKey } : {}), at: new Date().toISOString() };
}

/**
 * 미적재 환불 실패를 캠페인에 남긴다. 기록 자체가 실패해도 발송 흐름을 막지 않는다
 * (막아봐야 이미 큐는 적재된 뒤다) — 로그로 남겨 사람이 찾을 수 있게 한다.
 */
export interface RefundAxis { count: number; messageType: string; refundKey?: string; }

/**
 * 실패한 환불 채무를 **축 단위로, 한 번에** 남긴다.
 *
 * ★ 2026-08-18 두 가지를 동시에 막는다.
 *  ① **보조 축 삭제** — 주 슬롯을 같은 축으로 갱신할 때 루트를 통째로 교체하면 `brand` 슬롯이 사라진다.
 *     (SMS 기록 → BRAND 기록 → SMS 재기록 순서에서 BRAND 채무가 증발한다)
 *  ② **워커와의 경합** — 축을 두 번에 나눠 쓰면, 그 사이에 워커가 첫 축만 담긴 스냅샷을 읽고
 *     소진 후 슬롯을 지워 두 번째 축이 사라진다. 그래서 행을 잠그고 **한 번의 UPDATE**로 쓴다.
 *
 * 축이 겹치면 건수는 **줄이지 않는다**(GREATEST) — 나중 호출이 더 작은 수를 들고 와도 채무는 최대치가 진실이다.
 * 지원 축은 2개(주 슬롯 + `brand` 보조). 읽는 쪽 `direct-send-worker`가 그 두 부분을 함께 소진한다.
 */
export async function markRefundPendingAxes(campaignId: string, axes: RefundAxis[]): Promise<void> {
  const wanted = (axes || []).filter((a) => a && a.count > 0 && a.messageType);
  if (!campaignId || wanted.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT COALESCE(send_config, '{}'::jsonb) AS sc FROM campaigns WHERE id = $1 FOR UPDATE`,
      [campaignId],
    );
    if (cur.rows.length === 0) { await client.query('ROLLBACK'); return; }
    const sc = cur.rows[0].sc || {};
    const rp = sc.refundPending || null;

    // 기존 슬롯을 축 목록으로 편다 — 주 슬롯의 재시도 상태(attempts·nextAttemptAt)는 보존한다.
    const slots: RefundAxis[] = [];
    if (rp?.messageType && Number(rp.count) > 0) slots.push({ count: Number(rp.count), messageType: String(rp.messageType), refundKey: rp.refundKey });
    if (rp?.brand?.messageType && Number(rp.brand.count) > 0) slots.push({ count: Number(rp.brand.count), messageType: String(rp.brand.messageType), refundKey: rp.brand.refundKey });

    for (const w of wanted) {
      const hit = slots.find((s) => s.messageType === w.messageType && (s.refundKey || '') === (w.refundKey || ''));
      if (hit) hit.count = Math.max(hit.count, w.count);
      else if (slots.length < 2) slots.push({ ...w });
      else console.error(`[환불의무][슬롯초과] campaign=${campaignId} 축 3개 이상 — ${w.messageType} ${w.count}건을 기록하지 못했다`);
    }
    if (slots.length === 0) { await client.query('ROLLBACK'); return; }

    const next: RefundPendingRecord = {
      ...(rp && rp.messageType === slots[0].messageType ? rp : {}),   // 같은 축이면 backoff 상태 유지
      ...buildRefundPending(slots[0].count, slots[0].messageType, slots[0].refundKey),
      ...(rp?.attempts !== undefined && rp?.messageType === slots[0].messageType ? { attempts: rp.attempts, lastAttemptAt: rp.lastAttemptAt, nextAttemptAt: rp.nextAttemptAt } : {}),
    };
    const payload: Record<string, any> = { ...next };
    if (slots[1]) payload.brand = { count: slots[1].count, messageType: slots[1].messageType, ...(slots[1].refundKey ? { refundKey: slots[1].refundKey } : {}) };

    await client.query(
      `UPDATE campaigns
          SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{refundPending}', $2::jsonb),
              updated_at = NOW()
        WHERE id = $1`,
      [campaignId, JSON.stringify(payload)],
    );
    await client.query('COMMIT');
    console.warn(`[환불의무] campaign=${campaignId} ${slots.map((s) => `${s.messageType} ${s.count}건`).join(' + ')} 미완료 — 워커 재시도 대기 등록`);
  } catch (e: any) {
    try { await client.query('ROLLBACK'); } catch { /* 무시 */ }
    console.error(`[환불의무] campaign=${campaignId} 기록 실패:`, e?.message || e);
  } finally {
    client.release();
  }
}

export async function markRefundPending(campaignId: string, count: number, messageType: string, refundKey?: string): Promise<void> {
  return markRefundPendingAxes(campaignId, [{ count, messageType, refundKey }]);
}

