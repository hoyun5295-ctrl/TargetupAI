/**
 * ★ CT: 수량 수정 발행 (2026-08-04 신설)
 *
 * 기원 = 서수란 0804 접수 "정산서 발송 후 업체와 수량이 다를 경우 수정 발행이 불가"
 * (제주한라병원 7월 LMS 우리 9,438건 vs 업체 9,435건). **수량은 사람이 조정한다**(Harold 확정).
 *
 * 원칙:
 *  - **발송 실적(`billing_items`)은 사실이라 건드리지 않는다.** 조정은 별개 사실이고 자기 행으로 남는다.
 *  - 조정 축은 **발행이 아니라 회사×기간×유형(×계정×발송ID)**이다. 발행에 붙이면 재발행할 때 조정이
 *    함께 사라져 "고쳐서 다시 내보낸다"가 성립하지 않는다.
 *  - 적용은 발행 기간과 **정확히 일치**할 때만. 겹침으로 잡으면 분할 발행(7/1~15 + 7/16~31)에서
 *    어느 쪽에 붙는지 모호해지고, 두 발행이 같은 조정을 각각 실어 이중 정정이 된다.
 *  - 단가는 **그 기간에 실제로 청구되는 줄에서 빌려온다.** 조정이 원 줄과 같은 단가여야
 *    `buildInvoiceLines`가 한 줄로 합쳐 `LMS 9,435건 × ₩22.8`로 인쇄한다. 조정 줄이 따로 서면
 *    업체는 "왜 9,438이냐"고 다시 묻는다.
 *  - 조정 대상 줄이 그 기간에 없으면 **단가를 알 수 없으므로 발행을 막는다**(fail-closed).
 *  - 조정 후 수량이 음수가 되는 유형이 있으면 발행을 막는다.
 */

import type { PricedBillingItem } from './send-usage-aggregation';

export interface QtyAdjustmentRow {
  id: string;
  channel: string;
  type_key: string;
  user_id?: string | null;
  agent_id?: string | null;
  qty_delta: any;
  reason?: string | null;
}

/**
 * 그 회사·그 기간의 수량 조정을 읽는다. **기간이 정확히 같은 행만.**
 * 호출측 트랜잭션의 client를 받는다 — 발행과 같은 스냅샷을 봐야 조정이 반쯤 반영되지 않는다.
 */
export async function loadQtyAdjustments(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  companyId: string,
  billingStart: string,
  billingEnd: string,
): Promise<QtyAdjustmentRow[]> {
  const r = await client.query(
    `SELECT id, channel, type_key, user_id, agent_id, qty_delta, reason
       FROM billing_qty_adjustments
      WHERE company_id = $1::uuid AND period_start = $2::date AND period_end = $3::date
      ORDER BY channel, type_key`,
    [companyId, billingStart, billingEnd],
  );
  return r.rows as QtyAdjustmentRow[];
}

/** 조정이 빌려 쓸 단가를 찾지 못했다 — 그 유형의 청구 줄이 그 기간에 없다는 뜻이다. */
export class QtyAdjustmentError extends Error {
  constructor(public readonly rows: QtyAdjustmentRow[], message: string) {
    super(message);
    this.name = 'QtyAdjustmentError';
  }
}

/**
 * (순수) 조정 행 → 청구 상세 행.
 *
 * 단가는 `priced`(그 기간의 실제 청구 줄)에서 같은 채널·유형(에이전트면 발송ID까지)의 줄을 찾아 빌린다.
 * 못 찾으면 throw — 0원으로 만들어 조용히 넘기면 "조정했는데 금액이 그대로"가 된다.
 *
 * `total`·`success`에 델타를 함께 싣는다. 청구 수량은 성공 건수이고, 조정은 그 성공 건수를 고치는 것이다.
 */
export function buildAdjustmentBillingItems(
  rows: QtyAdjustmentRow[],
  priced: PricedBillingItem[],
  itemDate: string,
): PricedBillingItem[] {
  if (!rows || rows.length === 0) return [];
  const out: PricedBillingItem[] = [];
  const missing: QtyAdjustmentRow[] = [];
  for (const r of rows) {
    const channel = String(r.channel || '');
    const typeKey = String(r.type_key || '');
    const agentId = r.agent_id ? String(r.agent_id) : null;
    const delta = Math.round(Number(r.qty_delta) || 0);
    if (delta === 0) continue;
    const src = (priced || []).find((p) =>
      String(p.channel) === channel
      && String(p.typeKey) === typeKey
      && (agentId ? String(p.agentId || '') === agentId : true));
    if (!src) { missing.push(r); continue; }
    const unitPrice = Number(src.unitPrice) || 0;
    const amount = delta * unitPrice;
    out.push({
      channel: channel as any,
      itemDate,
      typeKey,
      userId: r.user_id ? String(r.user_id) : null,
      agentSendId: null,
      agentId,
      total: delta, success: delta, fail: 0, pending: 0,
      planDays: null,
      planMonthDays: null,
      unitPrice,
      amount,
      amountExact: amount,
    });
  }
  if (missing.length > 0) {
    const shown = missing.slice(0, 3).map((m) => `${m.channel}/${m.type_key}`).join(', ');
    throw new QtyAdjustmentError(
      missing,
      `수량 조정을 적용할 청구 항목이 이 기간에 없습니다 (${shown}). 조정을 삭제하거나 기간을 확인해주세요.`,
    );
  }
  return out;
}

/**
 * (순수) 조정 후 수량이 음수가 되는 **항목줄**을 찾는다.
 *
 * ★ 2026-08-04 판정 축을 청구서에 인쇄되는 줄과 같게 잡는다(Codex 적대검증 high).
 *   채널·유형만 합산하면, 계정 A가 2건·B가 100건일 때 A에 -3을 넣어도 전체 99라 통과한다.
 *   장을 나누면 A는 -1이 되고, 음수 금액은 절사에서 0으로 뭉개지면서 B의 100건은 그대로 청구된다
 *   — 의도한 99건보다 과청구다.
 *
 *   ⚠ 그래서 **호출은 반드시 `splitBillingSheets` 이후 장별로** 한다. 계정 축은 장이 이미 가르므로
 *   키에 넣지 않는다(넣으면 합산 발행의 정상 조정이 거부된다 — Codex 재검증 high).
 */
export function findNegativeAdjustedTypes(
  items: PricedBillingItem[],
): Array<{ channel: string; typeKey: string; total: number }> {
  const acc = new Map<string, { channel: string; typeKey: string; total: number }>();
  for (const it of items || []) {
    const channel = String(it.channel);
    // 요금제·추가 항목은 수량 축이 없다(전부 0) — 조정 대상이 아니므로 판정에서 뺀다.
    if (channel === 'plan' || channel === 'extra') continue;
    // ★ 계정은 키에 넣지 않는다 — **장이 이미 계정으로 나뉜 뒤** 장별로 부르기 때문이다.
    //   여기 계정을 넣으면 합산 발행에서 조정(user_id NULL)이 원본 행(userId 있음)과 다른 버킷이 되어
    //   9,438 → 9,435 같은 **정상 하향 조정이 -3으로 거부된다**(Codex 재검증 high — 직전 수정의 회귀).
    const key = `${channel} ${it.typeKey} ${it.agentId || ''} ${it.unitPrice}`;
    if (!acc.has(key)) acc.set(key, { channel, typeKey: String(it.typeKey), total: 0 });
    acc.get(key)!.total += Number(it.success) || 0;
  }
  return Array.from(acc.values()).filter((v) => v.total < 0);
}
