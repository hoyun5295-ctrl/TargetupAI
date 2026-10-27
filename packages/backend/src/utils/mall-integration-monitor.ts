/**
 * mall-integration-monitor.ts — 슈퍼관리자 자사몰 연동 감시 표 1단(★ 2026-10-27 자사몰 대비 K10 · 설계서 docs/2026-10-27-mall-integration-hardening-design.md)
 *
 * 한 행 = 몰 하나(해제 행 제외). 고객사 · 몰 · 문제(K7 integrationProblemOf) · 마지막 수신 · 평소 간격 대비 · 토큰 만료 · 가져오기 진행 · 모르는 주문 상태 글자(최근 7일).
 * 읽기만(행 버튼 0) · 문제가 있는 몰 먼저. 첫 고객 동행 14일 동안 사람이 매일 이 표를 본다(2단 경보는 K6 워커 뒤).
 */
import { query } from '../config/database';
import { integrationProblemOf, type IntegrationProblem } from './integration-problem';

export interface MallMonitorRow {
  id: string;
  companyId: string;
  companyName: string;
  provider: string;
  mallId: string;
  storeCode: string | null;
  status: string;
  problem: IntegrationProblem | null;
  /** 마지막 실패 코드 · 문장 · 시각(원문 · 분류 못 한 코드도 그대로) */
  errorCode: string | null;
  errorMessage: string | null;
  errorAt: string | null;
  /** 웹훅 마지막 수신(최근 30일 · 없으면 null) · 30일 건수 */
  lastReceivedAt: string | null;
  received30d: number;
  /** 지금까지 수신 없는 시간 ÷ 평소 간격(30일 건수 5건 이상일 때만 · 1 = 평소대로) */
  gapRatio: number | null;
  lastSyncedAt: string | null;
  connectedAt: string | null;
  tokenExpiresAt: string | null;
  importProgress: { stage: string; customers: number; orders: number; doneAt: string | null } | null;
  memberReread: { page: number; doneAt: string | null; lastDoneAt: string | null } | null;
  /** 상태 변환 표에 없던 주문 상태 글자(최근 7일 · 많은 순) */
  unknownStatuses: Array<{ status: string; count: number }>;
}

const DAY_MS = 24 * 3600_000;
const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);
const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 표의 순서 — 사람이 볼 것(action · 분류 못 한 실패) → 기다리면 풀릴 것(transient) → 문제 없음 */
export function monitorRank(r: Pick<MallMonitorRow, 'problem' | 'errorCode'>): number {
  if (r.problem?.kind === 'action' || (!r.problem && r.errorCode)) return 0;
  if (r.problem?.kind === 'transient') return 1;
  return 2;
}

export async function loadMallIntegrationMonitor(nowMs: number = Date.now()): Promise<MallMonitorRow[]> {
  const rows = await query(
    `SELECT ci.id, ci.company_id, c.company_name, ci.provider, ci.mall_id, ci.status,
            ci.connected_at, ci.last_synced_at, ci.token_expires_at, ci.meta
       FROM company_integrations ci
       JOIN companies c ON c.id = ci.company_id
      WHERE ci.status <> 'revoked'`,
  );
  if (rows.rows.length === 0) return [];
  const companyIds = Array.from(new Set(rows.rows.map((r: any) => String(r.company_id))));
  // 우커머스 전달은 webhook_event = '{몰}:{주제}' 라 몰마다 · 그 밖은 provider 마다(회사당 한 몰)
  const deliveries = await query(
    `SELECT company_id, source,
            CASE WHEN source = 'woocommerce' THEN split_part(webhook_event, ':', 1) ELSE '' END AS mall,
            MAX(created_at) AS last_at, COUNT(*)::int AS n30
       FROM cdp_webhook_deliveries
      WHERE company_id = ANY($1::uuid[]) AND webhook_event <> 'oauth_state'
        AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY 1, 2, 3`,
    [companyIds],
  );
  // 지금도 모르는 상태인 주문(표식은 알려진 상태로 바뀌면 지워진다) · 본 시각(status_unknown_at) 7일 · 원문 글자(status_raw)
  //   occurred_at 90일 = 색인(company_id, event_name, occurred_at) 범위 · 그보다 옛 주문의 상태 변화는 1단 표 밖(§9-1)
  const unknown = await query(
    `SELECT company_id, source, COALESCE(properties->>'status_raw', properties->>'status', '') AS status, COUNT(*)::int AS n
       FROM cdp_events
      WHERE company_id = ANY($1::uuid[]) AND event_name IN ('purchase', 'order_placed')
        AND occurred_at > NOW() - INTERVAL '90 days'
        AND properties->>'status_known' = 'false'
        AND (CASE WHEN properties->>'status_unknown_at' ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (properties->>'status_unknown_at')::timestamptz END) > NOW() - INTERVAL '7 days'
      GROUP BY 1, 2, 3
      ORDER BY n DESC`,
    [companyIds],
  );
  const dKey = (c: string, s: string, m: string) => `${c}|${s}|${m}`;
  const dMap = new Map<string, { last: any; n: number }>();
  for (const d of deliveries.rows as any[]) dMap.set(dKey(String(d.company_id), String(d.source), String(d.mall || '')), { last: d.last_at, n: num(d.n30) });
  const uMap = new Map<string, Array<{ status: string; count: number }>>();
  for (const u of unknown.rows as any[]) {
    const k = `${u.company_id}|${u.source}`;
    if (!uMap.has(k)) uMap.set(k, []);
    uMap.get(k)!.push({ status: String(u.status), count: num(u.n) });
  }

  const out: MallMonitorRow[] = (rows.rows as any[]).map((r) => {
    const meta = r.meta || {};
    const provider = String(r.provider);
    const prefix = provider === 'woocommerce' ? 'woo' : provider === 'godo' ? 'godo' : '';
    const errorCode = prefix ? (meta[`${prefix}_sync_error_code`] ?? null) : null;
    const d = dMap.get(dKey(String(r.company_id), provider, provider === 'woocommerce' ? String(r.mall_id) : ''));
    const lastReceivedAt = d ? iso(d.last) : null;
    const gapRatio = d && d.n >= 5 && lastReceivedAt
      ? Math.round(((nowMs - Date.parse(lastReceivedAt)) / ((30 * DAY_MS) / d.n)) * 10) / 10
      : null;
    const bf = meta.woo_backfill && typeof meta.woo_backfill === 'object' ? meta.woo_backfill : null;
    const rr = meta.woo_member_reread && typeof meta.woo_member_reread === 'object' ? meta.woo_member_reread : null;
    return {
      id: String(r.id),
      companyId: String(r.company_id),
      companyName: String(r.company_name || ''),
      provider,
      mallId: String(r.mall_id || ''),
      storeCode: typeof meta.store_code === 'string' && meta.store_code.trim() ? meta.store_code.trim() : null,
      status: String(r.status || ''),
      problem: integrationProblemOf(provider, r.status, errorCode),
      errorCode: errorCode ? String(errorCode) : null,
      errorMessage: prefix ? (meta[`${prefix}_sync_error`] ?? null) : null,
      errorAt: prefix ? (meta[`${prefix}_sync_error_at`] ?? null) : null,
      lastReceivedAt,
      received30d: d?.n ?? 0,
      gapRatio,
      lastSyncedAt: iso(r.last_synced_at),
      connectedAt: iso(r.connected_at),
      tokenExpiresAt: iso(r.token_expires_at),
      importProgress: bf ? { stage: String(bf.stage || ''), customers: num(bf.customers_imported), orders: num(bf.orders_imported), doneAt: bf.done_at ?? null } : null,
      memberReread: rr ? { page: num(rr.page), doneAt: rr.done_at ?? null, lastDoneAt: rr.last_done_at ?? null } : null,
      unknownStatuses: uMap.get(`${r.company_id}|${provider}`) || [],
    };
  });
  out.sort((a, b) => monitorRank(a) - monitorRank(b) || a.companyName.localeCompare(b.companyName, 'ko') || a.mallId.localeCompare(b.mallId));
  return out;
}
