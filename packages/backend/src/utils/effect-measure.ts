/**
 * CT: effect-measure.ts — 효과 측정 한 산식(★ 2026-11-06 C110 · 설계서 docs/2026-11-06-c110-effect-proof-priority-design.md §2 · §5)
 *
 * 「기준 시각 뒤 N일 구매」 = 자동 마케팅 ROI 수신자 귀속(campaignRecipientOrders)의 규칙을 사람마다 기준 시각이 다른 꼴로 일반화한 것 하나.
 *   몰 = 결제 확정(netPurchaseSql) · 환불 표식 주문 통째로 뺌 · 같은 주문 한 번 · 매장 원장(환불 행 제외 · 몰과 같은 구매 뺌) · 번호로 고객 찾기.
 * 이 파일의 SQL 을 ROI · 담당자 성과 문자 · 하루 요약 · 밴딧(automarketing-roi) · 발송별 · 전체 대조군 · 여정 대조군 비교가 함께 쓴다(R1).
 * 판정 · 문장 = effect-measure-core(순수).
 */
import { query } from '../config/database';
import { netPurchaseSql } from './cdp-order-revenue';
import { ledgerDupOfMallSql, LEDGER_PURCHASES_SQL } from './two-door-purchase';
import { liftVerdict, LiftResult, GroupStats } from './effect-measure-core';
import { adGateSchemaReady, holdoutBucketSql } from './ad-send-gate';
import { normalizeHoldoutPct } from './ad-send-gate-core';

/**
 * 기준 시각마다 창 안 주문 — $1 회사 · $2 번호[] · $3 기준 시각[](같은 순서) · $4 창 일수 · $5 끝(선택 · 밴딧).
 * 결과 = (phone, order_key, amount) · 한 번호의 같은 주문은 한 줄.
 */
export const ANCHORED_ORDERS_SQL =
  `WITH a AS (
     SELECT DISTINCT u.phone, u.at FROM unnest($2::text[], $3::timestamptz[]) AS u(phone, at) WHERE u.at IS NOT NULL
   ), mall AS (
     SELECT x.phone, x.order_key, MAX(x.amount) FILTER (WHERE x.paid) AS amount
       FROM (
         SELECT a.phone,
                e.source || ':' || COALESCE(NULLIF(e.properties->>'order_id', ''), e.id::text) AS order_key,
                COALESCE((e.properties->>'total_amount')::numeric, 0)::float AS amount,
                COALESCE(e.properties->>'revenue_reversed', '') = 'true' AS reversed,
                COALESCE(${netPurchaseSql('e')}, false) AS paid
           FROM a
           JOIN customers cu ON cu.company_id = $1::uuid AND regexp_replace(COALESCE(cu.phone, ''), '\\D', '', 'g') = a.phone
           JOIN cdp_events e ON e.company_id = $1::uuid AND e.customer_id = cu.id
            AND e.event_name IN ('purchase', 'order')
            AND e.occurred_at >= a.at
            AND e.occurred_at <= a.at + make_interval(days => $4::int)
            AND ($5::timestamptz IS NULL OR e.occurred_at < $5::timestamptz)
       ) x
      GROUP BY x.phone, x.order_key
     HAVING NOT bool_or(x.reversed) AND bool_or(x.paid)
   ), ledger AS (
     SELECT a.phone, 'ledger:' || p.id::text AS order_key, COALESCE(p.total_amount, 0)::float AS amount
       FROM a
       JOIN customers cu ON cu.company_id = $1::uuid AND regexp_replace(COALESCE(cu.phone, ''), '\\D', '', 'g') = a.phone
       JOIN ${LEDGER_PURCHASES_SQL} p ON p.company_id = $1::uuid AND p.customer_id = cu.id   -- 환불 행 = 주문 아님(CT-D6)
        AND p.purchase_date >= (a.at AT TIME ZONE 'Asia/Seoul')::date
        AND p.purchase_date < ((a.at + make_interval(days => $4::int)) AT TIME ZONE 'Asia/Seoul')::date + 1
        AND ($5::timestamptz IS NULL OR p.purchase_date < ($5::timestamptz AT TIME ZONE 'Asia/Seoul')::date)
      WHERE NOT ${ledgerDupOfMallSql('p')}
   )
   SELECT phone, order_key, amount FROM mall UNION ALL SELECT phone, order_key, amount FROM ledger`;

export interface AnchoredOrder { phone: string; orderKey: string; amount: number }

/** 측정 창(일) — 자동 마케팅 ROI 와 같은 7일(D6) */
export const EFFECT_WINDOW_DAYS = 7;

export async function ordersAfterAnchors(
  companyId: string, anchors: Array<{ phone: string; at: Date | string }>, windowDays: number, until: Date | string | null = null,
): Promise<AnchoredOrder[]> {
  if (anchors.length === 0) return [];
  const out: AnchoredOrder[] = [];
  const CHUNK = 20000;
  for (let i = 0; i < anchors.length; i += CHUNK) {
    const part = anchors.slice(i, i + CHUNK);
    const r = await query(ANCHORED_ORDERS_SQL, [
      companyId, part.map((x) => x.phone), part.map((x) => new Date(x.at).toISOString()),
      Math.max(1, Math.floor(windowDays)), until ? new Date(until).toISOString() : null,
    ]);
    for (const x of r.rows as any[]) out.push({ phone: String(x.phone), orderKey: String(x.order_key), amount: Number(x.amount) || 0 });
  }
  return out;
}

/** 무리 집계 — n = 번호 수(중복 = 한 명) · buyers = 창 안 주문 1건 이상 번호 · revenue = 주문 금액 합 */
export async function measureGroups(
  companyId: string, anchors: Array<{ phone: string; at: Date | string; group: 't' | 'c' }>, windowDays: number,
): Promise<{ t: GroupStats; c: GroupStats }> {
  const groupOf = new Map<string, 't' | 'c'>();
  const first = new Map<string, Date | string>();
  for (const a of anchors) {
    if (!a.phone || groupOf.has(a.phone)) continue;
    groupOf.set(a.phone, a.group);
    first.set(a.phone, a.at);
  }
  const orders = await ordersAfterAnchors(companyId, [...first].map(([phone, at]) => ({ phone, at })), windowDays);
  const stats = { t: { n: 0, buyers: 0, revenue: 0 }, c: { n: 0, buyers: 0, revenue: 0 } };
  for (const g of groupOf.values()) stats[g].n++;
  const bought = new Set<string>();
  for (const o of orders) {
    const g = groupOf.get(o.phone);
    if (!g) continue;
    stats[g].revenue += o.amount;
    if (!bought.has(o.phone)) { bought.add(o.phone); stats[g].buyers++; }
  }
  return stats;
}

/** 그 회사 · 기간에 관문 장애 줄이 있나(§3-6 · limited) */
async function gateFailedBetween(companyId: string, from: Date, to: Date): Promise<boolean> {
  try {
    const r = await query(
      `SELECT 1 FROM ad_gate_failures WHERE company_id = $1::uuid AND created_at >= $2 AND created_at <= $3 LIMIT 1`,
      [companyId, from.toISOString(), to.toISOString()],
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

// ── 발송별 · 전체 · 여정 ────────────────────────────────────────────────

export interface CampaignEffect {
  campaignId: string;
  campaignName: string;
  sentAt: string;
  lift: LiftResult;
  excluded: { priority: number; global_holdout: number };   // ★ C113 D23 관문은 피로도를 보지 않는다(원장 fatigue 줄 0)
}

/** 발송별 — 원장 treated vs holdout(ITT) · 기준 = 캠페인 sent_at · 창 닫힌 캠페인만(sent_at ≤ 지금 − 7일)이 「판정」 · 그 전은 측정 중 */
export async function campaignEffects(companyId: string, days: number): Promise<{ items: CampaignEffect[]; measuring: number }> {
  if (!(await adGateSchemaReady())) return { items: [], measuring: 0 };
  const r = await query(
    `SELECT c.id, c.campaign_name, c.sent_at
       FROM campaigns c
      WHERE c.company_id = $1::uuid AND c.sent_at IS NOT NULL AND c.sent_at > NOW() - make_interval(days => $2::int)
        AND EXISTS (SELECT 1 FROM ad_send_marks m WHERE m.campaign_id = c.id AND m.company_id = c.company_id AND m.kind = 'campaign_holdout')
      ORDER BY c.sent_at DESC LIMIT 30`,
    [companyId, Math.max(1, Math.min(90, Math.floor(days)))],
  );
  const items: CampaignEffect[] = [];
  let measuring = 0;
  for (const c of r.rows as any[]) {
    const sentAt = new Date(c.sent_at);
    if (sentAt.getTime() > Date.now() - EFFECT_WINDOW_DAYS * 86400000) { measuring++; continue; }
    const m = await query(
      `SELECT phone, kind FROM ad_send_marks WHERE campaign_id = $1::uuid AND company_id = $2::uuid`,
      [c.id, companyId],
    );
    const anchors: Array<{ phone: string; at: Date; group: 't' | 'c' }> = [];
    const excluded = { priority: 0, global_holdout: 0 };
    for (const x of m.rows as any[]) {
      if (x.kind === 'campaign_treated') anchors.push({ phone: String(x.phone), at: sentAt, group: 't' });
      else if (x.kind === 'campaign_holdout') anchors.push({ phone: String(x.phone), at: sentAt, group: 'c' });
      else if (x.kind in excluded) (excluded as any)[x.kind]++;
    }
    const g = await measureGroups(companyId, anchors, EFFECT_WINDOW_DAYS);
    const dayStart = new Date(sentAt.getTime() - 24 * 3600 * 1000);
    const limited = await gateFailedBetween(companyId, dayStart, sentAt);
    items.push({ campaignId: String(c.id), campaignName: String(c.campaign_name || ''), sentAt: sentAt.toISOString(), lift: liftVerdict(g.t, g.c, { limited }), excluded });
  }
  return { items, measuring };
}

export interface GlobalEffect { pct: number; since: string; lift: LiftResult }

/** 전체 대조군 — 회사 고객 번호(활성 · 중복 뺌) 전체를 같은 해시로 가른다 · 창 = 시작부터 지금(기간 누적) */
export async function globalHoldoutEffect(companyId: string): Promise<GlobalEffect | null> {
  if (!(await adGateSchemaReady())) return null;
  const co = await query(`SELECT global_holdout_pct, global_holdout_since FROM companies WHERE id = $1::uuid`, [companyId]);
  const pct = normalizeHoldoutPct(co.rows[0]?.global_holdout_pct, 10);
  const since = co.rows[0]?.global_holdout_since ? new Date(co.rows[0].global_holdout_since) : null;
  if (!pct || !since) return null;
  const r = await query(
    `WITH co AS (SELECT id::text || ':' || to_char(global_holdout_since AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') AS salt FROM companies WHERE id = $1::uuid),
          ph AS (SELECT DISTINCT regexp_replace(phone, '[^0-9]', '', 'g') AS phone FROM customers
                  WHERE company_id = $1::uuid AND is_active = true AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') <> '')
     SELECT ph.phone, ${holdoutBucketSql('co.salt', 'ph.phone')} < $2::int * 100 AS ctl FROM ph, co`,
    [companyId, pct],
  );
  const anchors = (r.rows as any[]).map((x) => ({ phone: String(x.phone), at: since, group: (x.ctl ? 'c' : 't') as 't' | 'c' }));
  const windowDays = Math.max(1, Math.ceil((Date.now() - since.getTime()) / 86400000));
  const g = await measureGroups(companyId, anchors, windowDays);
  const limited = await gateFailedBetween(companyId, since, new Date());
  return { pct, since: since.toISOString(), lift: liftVerdict(g.t, g.c, { limited }) };
}

export interface JourneyHoldoutEffect { lift: LiftResult; measuring: number }

/**
 * 여정 대조군 비교(결함 A ~ C · F) — 고객 단위(처음 실행이 무리를 정함) · 첫 진입 뒤 7일 · 창 닫힌 고객만 · 측정 중은 따로.
 * 대조군 0명 = null(카드 없음).
 */
export async function journeyHoldoutEffect(journeyId: string): Promise<JourneyHoldoutEffect | null> {
  const r = await query(
    `WITH first AS (
       SELECT DISTINCT ON (e.customer_id) e.customer_id, e.status = 'holdout' AS ctl, e.entered_at
         FROM journey_executions e
        WHERE e.journey_id = $1::uuid AND e.entered_at IS NOT NULL
        ORDER BY e.customer_id, e.entered_at ASC, e.id ASC
     )
     SELECT j.company_id, regexp_replace(COALESCE(cu.phone, ''), '[^0-9]', '', 'g') AS phone, f.ctl, f.entered_at,
            f.entered_at <= NOW() - make_interval(days => $2::int) AS closed
       FROM first f
       JOIN journeys j ON j.id = $1::uuid
       JOIN customers cu ON cu.id = f.customer_id`,
    [journeyId, EFFECT_WINDOW_DAYS],
  );
  const rows = r.rows as any[];
  if (!rows.some((x) => x.ctl)) return null;
  const companyId = String(rows[0].company_id);
  let measuring = 0;
  const anchors: Array<{ phone: string; at: Date; group: 't' | 'c' }> = [];
  for (const x of rows) {
    if (!x.closed) { measuring++; continue; }
    if (!x.phone) continue;
    anchors.push({ phone: String(x.phone), at: new Date(x.entered_at), group: x.ctl ? 'c' : 't' });
  }
  const g = await measureGroups(companyId, anchors, EFFECT_WINDOW_DAYS);
  return { lift: liftVerdict(g.t, g.c), measuring };
}
