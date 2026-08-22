/**
 * customer-timeline.ts — 고객 360 타임라인 컨트롤타워 (★ 2026-08-22 신설)
 *
 * 고객 한 명의 사건을 원천 12곳에서 모아 시간순으로 돌려준다.
 * 소비처: `routes/customers.ts` GET /:id/timeline 하나. 설계·확정 사실 = docs/2026-08-22-customer-360-timeline-design.md
 *
 * ⛔ 불변 원칙 (설계서 §2 — 어기면 되돌아온다)
 *   1. 발송 사실은 **MySQL 큐에서만** 읽는다. PG `messages`는 INSERT/SELECT 0건인 죽은 테이블이다.
 *      캠페인 이름·출처는 PG `campaigns`가 꾸밈으로만 붙는다.
 *   2. 고객 식별 축은 `company_id + phone`이다. `customers`는 UNIQUE(company_id, store_code, phone)라
 *      같은 번호가 매장별로 여러 행일 수 있고, `customers_unified` 뷰는 그 행들을 **접는다**.
 *      뷰로 읽으면 접힌 행의 구매·동의가 통째로 빠진다.
 *   3. 원천마다 상한을 걸고 잘렸으면 `sources.<kind>.truncated`로 알린다. 조용히 자르지 않는다.
 *   4. 커서는 (시각, 종류, id) 세 짝이다. 같은 초에 여러 사건이 있으면 시각만으로 페이지 경계에서 행이 빠진다.
 *   5. 제목·상태 문구는 여기서 한국어로 완성한다. 화면이 status_code를 다시 해석하면 라벨 표가 두 벌이 된다.
 *   6. 원천 하나가 죽어도 타임라인은 뜬다(`Promise.allSettled`). 전체 500 금지.
 *
 * ⛔ MySQL 성능 전제: `SMSQ_SEND_*`에 `(dest_no, sendreq_time)` 인덱스가 있어야 한다.
 *   없으면 테이블당 전행 스캔이다(2026-08-22 실측: 84만 행 1테이블 20초, EXPLAIN type=ALL).
 *   그래서 `send` 원천만은 실패해도 나머지가 뜨도록 격리돼 있다.
 */

import { query, mysqlQuery } from '../config/database';
import { getCompanySmsTablesWithLogsRange } from './sms-queue';
import { getQueueRowStatus, getSendTypeLabel, getDisplayContents, getCarrierLabel } from './sms-result-map';
import { normalizePhone } from './normalize';

// ────────────── 타입 ──────────────

export const TIMELINE_KINDS = [
  'send', 'dm_view', 'dm_response', 'purchase', 'behavior', 'inapp',
  'consent', 'unsubscribe', 'journey', 'inbound', 'email', 'profile',
] as const;
export type TimelineKind = typeof TIMELINE_KINDS[number];

/** 사건 상태 — 발송 계열만 값을 갖는다. 나머지는 null */
export type TimelineStatus = 'success' | 'fail' | 'pending' | 'scheduled' | 'unknown' | null;

export interface TimelineEvent {
  /** 원천 안에서 유일한 식별자. 커서 tie-breaker로 쓴다 */
  id: string;
  kind: TimelineKind;
  /** ISO 문자열. 정렬·커서의 기준 */
  at: string;
  title: string;
  subtitle?: string;
  status?: TimelineStatus;
  /** 펼쳤을 때 보여줄 원문 */
  detail?: Record<string, any>;
  /** 다른 화면으로 이어지는 참조(발송 결과 등) */
  ref?: { type: string; id: string };
}

export interface TimelineSourceState {
  truncated?: boolean;
  error?: string;
  /** send 전용 — 몇 개 테이블을 봤나 */
  tables?: number;
}

export interface CustomerScope {
  /** 진입 행 */
  row: any;
  phone: string | null;
  /** 같은 회사·번호의 고객 행 id 전부(매장별 중복 포함) */
  ids: string[];
  /** 그 행들의 이메일(소문자) */
  emails: string[];
  /** 그 행들에 발급된 모바일 DM 수신자 토큰 */
  tokens: string[];
  /** 등록 매장 이름 */
  stores: string[];
}

export interface TimelineResult {
  customer: {
    id: string;
    name: string | null;
    phone: string | null;
    grade: string | null;
    stores: string[];
    smsOptIn: boolean;
    isUnsubscribed: boolean;
    registeredAt: string | null;
  };
  summary: {
    sends: number;
    engagements: number;
    purchases: number;
    lastActivityAt: string | null;
  };
  events: TimelineEvent[];
  nextBefore: string | null;
  sources: Partial<Record<TimelineKind, TimelineSourceState>>;
}

// ────────────── 커서 ──────────────
// 정렬은 (at DESC, kind ASC, id ASC). 커서는 그 세 값을 그대로 담는다.

interface Cursor { at: string; kind: string; id: string; }

export function encodeCursor(e: { at: string; kind: string; id: string }): string {
  return Buffer.from(`${e.at}|${e.kind}|${e.id}`, 'utf8').toString('base64');
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const s = Buffer.from(String(raw), 'base64').toString('utf8');
    const i = s.indexOf('|');
    const j = s.indexOf('|', i + 1);
    if (i < 0 || j < 0) return null;
    const at = s.slice(0, i);
    const kind = s.slice(i + 1, j);
    const id = s.slice(j + 1);
    if (!at || !kind) return null;
    // 시각이 해석 가능한지까지 본다 — 조작된 커서로 전 구간을 훑게 두지 않는다
    if (Number.isNaN(Date.parse(at))) return null;
    return { at, kind, id };
  } catch {
    return null;
  }
}

/** 정렬 비교자 — 최신이 앞. 같은 시각이면 kind·id로 고정 순서를 만든다(페이지 경계 안정) */
export function compareEvents(a: { at: string; kind: string; id: string }, b: { at: string; kind: string; id: string }): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** 커서보다 뒤(더 오래된 쪽)인가 */
function isAfterCursor(e: TimelineEvent, cur: Cursor | null): boolean {
  if (!cur) return true;
  return compareEvents(cur, e) < 0;
}

// ────────────── 도우미 ──────────────

const toIso = (v: any): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** 문자열을 화면 제목 길이로 자른다(원문은 detail이 갖는다) */
const clip = (s: any, n: number): string => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim();
  return v.length > n ? `${v.slice(0, n)}...` : v;
};

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * ⛔ MySQL 시각 축 — SMSQ의 `sendreq_time`·`mobsend_time`은 **KST naive DATETIME**이다.
 *
 * 그래서 두 방향 모두 변환이 필요하다:
 *   ①넣을 때: 커서의 UTC ISO를 그대로 `sendreq_time <= ?`에 넘기면 9시간 어긋난다.
 *     기존 경로도 전부 `'YYYY-MM-DD HH:mm:ss'`(KST naive)를 넘긴다(campaigns.ts·send-usage-aggregation.ts).
 *   ②꺼낼 때: 드라이버가 DATETIME을 어느 타임존으로 해석하는지에 기대지 않는다.
 *     `DATE_FORMAT`으로 문자열을 그대로 받아 `+09:00`을 붙여 UTC ISO로 만든다.
 *     그래야 프로세스 TZ가 무엇이든 PG 원천(timestamptz)과 같은 축에서 정렬된다.
 */
export function isoToKstSql(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

export function kstSqlToIso(s: any): string | null {
  if (!s) return null;
  const v = String(s).trim().replace(' ', 'T');
  const d = new Date(`${v}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 지정 시간 안에 안 끝나면 포기한다(요약 계산이 화면을 붙잡지 않게) */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); })
      .catch(() => { clearTimeout(timer); resolve(null); });
  });
}

/** 원천 하나를 격리 실행한다. 실패해도 나머지 종류는 뜬다(⛔6) */
async function runSource(
  kind: TimelineKind,
  sources: Partial<Record<TimelineKind, TimelineSourceState>>,
  limit: number,
  fn: () => Promise<TimelineEvent[]>,
): Promise<TimelineEvent[]> {
  try {
    const rows = await fn();
    const truncated = rows.length > limit;
    sources[kind] = { ...(sources[kind] || {}), truncated };
    return truncated ? rows.slice(0, limit) : rows;
  } catch (err: any) {
    sources[kind] = { ...(sources[kind] || {}), error: err?.message || '조회 실패' };
    return [];
  }
}

// ────────────── 식별 (⛔2) ──────────────

/**
 * 진입 id 하나에서 그 고객의 전 범위를 편다.
 * 뷰(`customers_unified`)가 아니라 원본 `customers`를 읽는다 — 뷰는 매장별 행을 접기 때문이다.
 */
export async function resolveCustomerScope(companyId: string, customerId: string): Promise<CustomerScope | null> {
  const base = await query(
    `SELECT id, company_id, phone, name, grade, email, store_name, store_code, sms_opt_in, created_at
       FROM customers
      WHERE id = $1::uuid AND company_id = $2::uuid`,
    [customerId, companyId],
  );
  if (base.rows.length === 0) return null;

  const row = base.rows[0];
  const phone = normalizePhone(row.phone) || (row.phone ? String(row.phone) : null);

  let siblings = [row];
  if (phone) {
    const all = await query(
      `SELECT id, phone, name, grade, email, store_name, store_code, sms_opt_in, created_at, source
         FROM customers
        WHERE company_id = $1::uuid AND phone = $2
        ORDER BY created_at ASC`,
      [companyId, phone],
    );
    if (all.rows.length > 0) siblings = all.rows;
  }

  const ids: string[] = Array.from(new Set(siblings.map((r: any) => String(r.id))));
  if (!ids.includes(String(row.id))) ids.push(String(row.id));

  const emails: string[] = Array.from(new Set(
    siblings.map((r: any) => String(r.email || '').trim().toLowerCase()).filter(Boolean),
  ));
  const stores: string[] = Array.from(new Set(
    siblings.map((r: any) => String(r.store_name || '').trim()).filter(Boolean),
  ));

  // 모바일 DM 열람은 수신자 토큰으로도 남는다(번호가 안 실린 열람 행이 있다)
  let tokens: string[] = [];
  try {
    const t = await query(
      `SELECT token FROM dm_recipient_tokens WHERE company_id = $1::uuid AND customer_id = ANY($2::uuid[]) LIMIT 500`,
      [companyId, ids],
    );
    tokens = t.rows.map((r: any) => String(r.token)).filter(Boolean);
  } catch {
    tokens = [];
  }

  return { row, phone, ids, emails, tokens, stores };
}

// ────────────── 원천 1: 발송 (MySQL) ──────────────

// 시각은 MySQL이 문자열로 만들어 준다(드라이버 타임존 해석에 기대지 않는다 — kstSqlToIso 주석)
const SEND_FIELDS = `seqno, dest_no, call_back, msg_type, msg_contents, title_str, status_code,
  mob_company, k_oriseq, app_etc1,
  DATE_FORMAT(sendreq_time, '%Y-%m-%d %H:%i:%s') AS sendreq_s,
  DATE_FORMAT(mobsend_time, '%Y-%m-%d %H:%i:%s') AS mobsend_s`;

async function fetchSends(
  companyId: string,
  scope: CustomerScope,
  months: number,
  before: string | null,
  limit: number,
  sources: Partial<Record<TimelineKind, TimelineSourceState>>,
): Promise<TimelineEvent[]> {
  if (!scope.phone) return [];

  const tables = await getCompanySmsTablesWithLogsRange(companyId, months);
  sources.send = { tables: tables.length };
  if (tables.length === 0) return [];

  // 테이블마다 자기 몫만 먼저 자른다(전행을 메모리로 올리지 않는다 — results.ts와 같은 축)
  const per = limit + 1;
  // 커서는 UTC ISO, SMSQ는 KST naive — 여기서 축을 맞춘다(안 맞추면 9시간 어긋난 페이지가 나온다)
  const beforeKst = before ? isoToKstSql(before) : '';
  const subs: string[] = [];
  const params: any[] = [];
  for (const t of tables) {
    let where = 'WHERE dest_no = ?';
    params.push(scope.phone);
    if (beforeKst) {
      where += ' AND sendreq_time <= ?';
      params.push(beforeKst);
    }
    subs.push(
      `(SELECT ${SEND_FIELDS}, '${t}' AS _t, (sendreq_time > NOW()) AS _future
          FROM ${t} ${where} ORDER BY sendreq_time DESC LIMIT ${per})`,
    );
  }

  const sql = `SELECT * FROM (${subs.join(' UNION ALL ')}) u ORDER BY sendreq_s DESC, seqno DESC LIMIT ${per}`;
  const rows = (await mysqlQuery(sql, params)) as any[];
  if (rows.length === 0) return [];

  // 꾸밈 — app_etc1은 현재 전 경로가 campaigns.id를 넣는다(설계서 1-5)
  const campaignIds = Array.from(new Set(
    rows.map((r) => String(r.app_etc1 || '')).filter((v) => /^[0-9a-f-]{36}$/i.test(v)),
  ));
  const campaignMap = new Map<string, { name: string; sendType: string }>();
  if (campaignIds.length > 0) {
    try {
      const c = await query(
        `SELECT id, campaign_name, send_type FROM campaigns WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`,
        [companyId, campaignIds],
      );
      for (const row of c.rows) {
        campaignMap.set(String(row.id), {
          name: String(row.campaign_name || ''),
          sendType: String(row.send_type || ''),
        });
      }
    } catch {
      // 꾸밈 실패는 사건 자체를 막지 않는다 — 제목만 본문 앞부분으로 떨어진다
    }
  }

  return rows.map((r) => {
    const msgType = String(r.msg_type || '');
    const body = getDisplayContents(msgType, r.msg_contents);
    // 드라이버가 boolean으로 줄 수도, 1/0으로 줄 수도 있다. 둘 다 참으로 본다.
    const isFuture = r._future === true || num(r._future) === 1;
    const st = getQueueRowStatus(num(r.status_code), isFuture);
    const camp = campaignMap.get(String(r.app_etc1 || ''));
    const typeLabel = getSendTypeLabel(msgType, r.k_oriseq);
    const carrier = getCarrierLabel(String(r.mob_company || ''));
    const sentAt = kstSqlToIso(r.mobsend_s);

    const subtitleParts = [st.label];
    if (carrier) subtitleParts.push(carrier);
    if (sentAt && st.type === 'success') subtitleParts.push('도달');

    return {
      id: `${r._t}:${r.seqno}`,
      kind: 'send' as const,
      at: kstSqlToIso(r.sendreq_s) || new Date(0).toISOString(),
      title: `${typeLabel} 발송${camp?.name ? ` · ${camp.name}` : body ? ` · ${clip(body, 24)}` : ''}`,
      subtitle: subtitleParts.join(' · '),
      status: st.type as TimelineStatus,
      detail: {
        content: body,
        subject: r.title_str || null,
        callback: r.call_back || null,
        statusCode: num(r.status_code),
        statusLabel: st.label,
        carrier: carrier || null,
        requestedAt: kstSqlToIso(r.sendreq_s),
        sentAt,
        messageType: typeLabel,
      },
      ref: camp ? { type: 'campaign', id: String(r.app_etc1) } : undefined,
    };
  });
}

// ────────────── 원천 2~12 (PG) ──────────────

async function fetchPurchases(companyId: string, scope: CustomerScope, before: string | null, limit: number) {
  const r = await query(
    `SELECT id, purchase_date, product_name, quantity, total_amount, store_name, product_code
       FROM purchases
      WHERE company_id = $1::uuid
        AND (customer_id = ANY($2::uuid[]) OR ($3::text IS NOT NULL AND customer_phone = $3::text))
        AND ($4::timestamptz IS NULL OR purchase_date <= $4::timestamptz)
      ORDER BY purchase_date DESC
      LIMIT $5`,
    [companyId, scope.ids, scope.phone, before, limit + 1],
  );
  return r.rows.map((row: any): TimelineEvent => {
    const amount = num(row.total_amount);
    const parts: string[] = [];
    if (row.store_name) parts.push(String(row.store_name));
    if (amount > 0) parts.push(`${amount.toLocaleString()}원`);
    if (num(row.quantity) > 1) parts.push(`${num(row.quantity)}개`);
    return {
      id: String(row.id),
      kind: 'purchase',
      at: toIso(row.purchase_date) || new Date(0).toISOString(),
      title: `구매${row.product_name ? ` · ${clip(row.product_name, 28)}` : ''}`,
      subtitle: parts.join(' · ') || undefined,
      status: null,
      detail: {
        productName: row.product_name || null,
        productCode: row.product_code || null,
        quantity: num(row.quantity),
        amount,
        storeName: row.store_name || null,
      },
    };
  });
}

/** 행동 이벤트 이름 라벨 — 값의 원천은 `cdp-events.ts` STANDARD_EVENT_NAMES */
const BEHAVIOR_LABELS: Record<string, string> = {
  page_view: '페이지 방문',
  cart_add: '장바구니 담기',
  cart_remove: '장바구니 빼기',
  cart_view: '장바구니 열람',
  checkout_start: '결제 시작',
  checkout_complete: '결제 완료',
  purchase: '구매',
  wishlist_add: '찜하기',
  wishlist_remove: '찜 해제',
  product_view: '상품 조회',
  search: '검색',
  message_click: '메시지 링크 클릭',
};

async function fetchBehaviors(companyId: string, scope: CustomerScope, before: string | null, limit: number) {
  const r = await query(
    `SELECT id, event_name, properties, source, occurred_at
       FROM cdp_events
      WHERE company_id = $1::uuid AND customer_id = ANY($2::uuid[])
        AND ($3::timestamptz IS NULL OR occurred_at <= $3::timestamptz)
      ORDER BY occurred_at DESC
      LIMIT $4`,
    [companyId, scope.ids, before, limit + 1],
  );
  return r.rows.map((row: any): TimelineEvent => {
    const name = String(row.event_name || '');
    const props = row.properties || {};
    const label = BEHAVIOR_LABELS[name] || name;
    const item = props.product_name || props.productName || props.name || props.keyword || props.query;
    return {
      id: String(row.id),
      kind: 'behavior',
      at: toIso(row.occurred_at) || new Date(0).toISOString(),
      title: `${label}${item ? ` · ${clip(item, 28)}` : ''}`,
      subtitle: row.source ? `자사몰 · ${row.source}` : '자사몰',
      status: null,
      detail: { eventName: name, properties: props, source: row.source || null },
    };
  });
}

async function fetchInapp(companyId: string, scope: CustomerScope, before: string | null, limit: number) {
  const r = await query(
    `SELECT i.id, i.event_type, i.occurred_at, i.dwell_seconds, i.button_id, m.title
       FROM cdp_inapp_impressions i
       LEFT JOIN cdp_inapp_messages m ON m.id = i.message_id
      WHERE i.company_id = $1::uuid AND i.customer_id = ANY($2::uuid[])
        AND ($3::timestamptz IS NULL OR i.occurred_at <= $3::timestamptz)
      ORDER BY i.occurred_at DESC
      LIMIT $4`,
    [companyId, scope.ids, before, limit + 1],
  );
  const TYPE: Record<string, string> = { impression: '인앱 노출', click: '인앱 클릭', close: '인앱 닫음', dismiss: '인앱 닫음' };
  return r.rows.map((row: any): TimelineEvent => ({
    id: String(row.id),
    kind: 'inapp',
    at: toIso(row.occurred_at) || new Date(0).toISOString(),
    title: `${TYPE[String(row.event_type)] || '인앱 반응'}${row.title ? ` · ${clip(row.title, 28)}` : ''}`,
    subtitle: num(row.dwell_seconds) > 0 ? `${num(row.dwell_seconds)}초 머무름` : undefined,
    status: null,
    detail: { eventType: row.event_type, dwellSeconds: num(row.dwell_seconds), buttonId: row.button_id || null },
  }));
}

async function fetchDmViews(companyId: string, scope: CustomerScope, before: string | null, limit: number) {
  const r = await query(
    `SELECT v.id, v.viewed_at, v.page_reached, v.total_pages, v.duration_seconds, v.max_scroll_pct,
            v.open_count, p.title
       FROM dm_views v
       LEFT JOIN dm_pages p ON p.id = v.dm_id
      WHERE v.company_id = $1::uuid
        AND (($2::text IS NOT NULL AND v.phone = $2::text) OR v.recipient_token = ANY($3::text[]))
        AND ($4::timestamptz IS NULL OR v.viewed_at <= $4::timestamptz)
      ORDER BY v.viewed_at DESC
      LIMIT $5`,
    [companyId, scope.phone, scope.tokens, before, limit + 1],
  );
  return r.rows.map((row: any): TimelineEvent => {
    const parts: string[] = [];
    if (num(row.total_pages) > 0) parts.push(`${num(row.page_reached)}/${num(row.total_pages)} 페이지`);
    if (num(row.duration_seconds) > 0) parts.push(`${num(row.duration_seconds)}초`);
    if (num(row.max_scroll_pct) > 0) parts.push(`스크롤 ${num(row.max_scroll_pct)}%`);
    return {
      id: String(row.id),
      kind: 'dm_view',
      at: toIso(row.viewed_at) || new Date(0).toISOString(),
      title: `모바일 DM 열람${row.title ? ` · ${clip(row.title, 26)}` : ''}`,
      subtitle: parts.join(' · ') || undefined,
      status: null,
      detail: {
        pageReached: num(row.page_reached),
        totalPages: num(row.total_pages),
        durationSeconds: num(row.duration_seconds),
        maxScrollPct: num(row.max_scroll_pct),
        openCount: num(row.open_count),
      },
    };
  });
}

async function fetchDmResponses(companyId: string, scope: CustomerScope, before: string | null, limit: number) {
  const r = await query(
    `SELECT id, section_type, response_data, occurred_at
       FROM dm_event_responses
      WHERE company_id = $1::uuid AND customer_id = ANY($2::uuid[])
        AND ($3::timestamptz IS NULL OR occurred_at <= $3::timestamptz)
      ORDER BY occurred_at DESC
      LIMIT $4`,
    [companyId, scope.ids, before, limit + 1],
  );
  return r.rows.map((row: any): TimelineEvent => ({
    id: String(row.id),
    kind: 'dm_response',
    at: toIso(row.occurred_at) || new Date(0).toISOString(),
    title: `모바일 DM 응답${row.section_type ? ` · ${row.section_type}` : ''}`,
    status: null,
    detail: { sectionType: row.section_type || null, response: row.response_data || null },
  }));
}

const CONSENT_CHANNEL: Record<string, string> = { sms: '문자', email: '이메일', kakao: '카카오', push: '앱 알림' };

async function fetchConsents(companyId: string, scope: CustomerScope, before: string | null, limit: number) {
  const r = await query(
    `SELECT c.id, c.channel, c.consent_type, c.status, c.consented_at, c.revoked_at, c.source, c.source_detail
       FROM consents c
      WHERE c.customer_id = ANY($1::uuid[])
      ORDER BY COALESCE(c.revoked_at, c.consented_at) DESC
      LIMIT $2`,
    [scope.ids, limit + 1],
  );
  const out: TimelineEvent[] = [];
  for (const row of r.rows) {
    const ch = CONSENT_CHANNEL[String(row.channel || '').toLowerCase()] || String(row.channel || '');
    const src = row.source ? `${row.source}${row.source_detail ? ` · ${clip(row.source_detail, 20)}` : ''}` : undefined;
    // 한 행이 동의와 철회 둘 다를 담을 수 있다 — 사건은 시각마다 하나씩 만든다
    const consentedAt = toIso(row.consented_at);
    if (consentedAt) {
      out.push({
        id: `${row.id}:c`,
        kind: 'consent',
        at: consentedAt,
        title: `${ch} 수신 동의`,
        subtitle: src,
        status: null,
        detail: { channel: row.channel, consentType: row.consent_type, source: row.source || null },
      });
    }
    const revokedAt = toIso(row.revoked_at);
    if (revokedAt) {
      out.push({
        id: `${row.id}:r`,
        kind: 'consent',
        at: revokedAt,
        title: `${ch} 수신 동의 철회`,
        subtitle: src,
        status: null,
        detail: { channel: row.channel, consentType: row.consent_type, source: row.source || null },
      });
    }
  }
  // 이 원천만 두 배로 불어날 수 있어 여기서 한 번 더 자른다
  const filtered = before ? out.filter((e) => e.at <= before) : out;
  filtered.sort(compareEvents);
  return filtered.slice(0, limit + 1);
}

const OPTOUT_SOURCE: Record<string, string> = {
  manual: '직접 등록', upload: '파일 등록', '080_ars': '080 자동응답',
  '080_ars_sync': '080 자동응답', db_upload: '고객 등록',
};

async function fetchUnsubscribes(companyId: string, scope: CustomerScope, before: string | null, limit: number) {
  if (!scope.phone) return [];
  const r = await query(
    `SELECT id, source, created_at, 'unsubscribe' AS _from FROM unsubscribes
      WHERE company_id = $1::uuid AND phone = $2
        AND ($3::timestamptz IS NULL OR created_at <= $3::timestamptz)
     UNION ALL
     SELECT id, source, created_at, 'opt_out' AS _from FROM opt_outs
      WHERE company_id = $1::uuid AND phone = $2
        AND ($3::timestamptz IS NULL OR created_at <= $3::timestamptz)
     ORDER BY created_at DESC
     LIMIT $4`,
    [companyId, scope.phone, before, limit + 1],
  );
  return r.rows.map((row: any): TimelineEvent => ({
    id: `${row._from}:${row.id}`,
    kind: 'unsubscribe',
    at: toIso(row.created_at) || new Date(0).toISOString(),
    title: row._from === 'opt_out' ? '080 수신거부 등록' : '수신거부 등록',
    subtitle: OPTOUT_SOURCE[String(row.source || '')] || (row.source ? String(row.source) : undefined),
    status: null,
    detail: { source: row.source || null },
  }));
}

async function fetchJourneys(companyId: string, scope: CustomerScope, before: string | null, limit: number) {
  const entered = await query(
    `SELECT e.id, e.entered_at, e.status, j.name
       FROM journey_executions e
       JOIN journeys j ON j.id = e.journey_id
      WHERE j.company_id = $1::uuid AND e.customer_id = ANY($2::uuid[])
        AND ($3::timestamptz IS NULL OR e.entered_at <= $3::timestamptz)
      ORDER BY e.entered_at DESC
      LIMIT $4`,
    [companyId, scope.ids, before, limit + 1],
  );

  const STATUS_LABEL: Record<string, string> = {
    active: '진행 중', completed: '완료', exited: '중단', holdout: '비교군', failed: '실패',
  };
  const out: TimelineEvent[] = entered.rows.map((row: any): TimelineEvent => ({
    id: `exec:${row.id}`,
    kind: 'journey',
    at: toIso(row.entered_at) || new Date(0).toISOString(),
    title: `여정 진입${row.name ? ` · ${clip(row.name, 26)}` : ''}`,
    subtitle: STATUS_LABEL[String(row.status || '')] || undefined,
    status: null,
    detail: { journeyName: row.name || null, executionStatus: row.status || null },
  }));

  // 스텝 로그 — 진입한 실행 건에 달린 것만(전 회사 스캔을 만들지 않는다)
  const execIds = entered.rows.map((r: any) => String(r.id));
  if (execIds.length > 0) {
    const CHANNEL_LABEL: Record<string, string> = { sms: '문자', lms: '문자', mms: '문자', kakao: '알림톡', kakao_alimtalk: '알림톡', email: '이메일', dm: '모바일 DM' };
    const steps = await query(
      `SELECT l.id, l.sent_at, l.status, l.error_reason, s.step_order, s.channel, j.name
         FROM journey_step_logs l
         LEFT JOIN journey_steps s ON s.id = l.step_id
         LEFT JOIN journey_executions e ON e.id = l.execution_id
         LEFT JOIN journeys j ON j.id = e.journey_id
        WHERE l.execution_id = ANY($1::uuid[])
          AND ($2::timestamptz IS NULL OR l.sent_at <= $2::timestamptz)
        ORDER BY l.sent_at DESC
        LIMIT $3`,
      [execIds, before, limit + 1],
    );
    for (const row of steps.rows) {
      const order = row.step_order != null ? `${num(row.step_order) + 1}단계` : '단계';
      const ch = CHANNEL_LABEL[String(row.channel || '').toLowerCase()];
      const isSkip = String(row.status) === 'skipped';
      out.push({
        id: `step:${row.id}`,
        kind: 'journey',
        at: toIso(row.sent_at) || new Date(0).toISOString(),
        title: `여정 ${order} ${isSkip ? '건너뜀' : '실행'}${row.name ? ` · ${clip(row.name, 22)}` : ''}`,
        subtitle: isSkip ? (row.error_reason ? clip(row.error_reason, 40) : '조건 미충족') : (ch || undefined),
        status: isSkip ? null : (String(row.status) === 'sent' ? 'success' : null),
        detail: { stepOrder: row.step_order, channel: row.channel || null, logStatus: row.status, reason: row.error_reason || null },
      });
    }
  }

  out.sort(compareEvents);
  return out.slice(0, limit + 1);
}

async function fetchInbound(companyId: string, scope: CustomerScope, before: string | null, limit: number) {
  const r = await query(
    `SELECT id, caller_phone, transcript, ai_response, duration_ms, status, created_at
       FROM voice_inbound_calls
      WHERE company_id = $1::uuid
        AND (customer_id = ANY($2::uuid[]) OR ($3::text IS NOT NULL AND caller_phone = $3::text))
        AND ($4::timestamptz IS NULL OR created_at <= $4::timestamptz)
      ORDER BY created_at DESC
      LIMIT $5`,
    [companyId, scope.ids, scope.phone, before, limit + 1],
  );
  return r.rows.map((row: any): TimelineEvent => {
    const sec = Math.round(num(row.duration_ms) / 1000);
    const dur = sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
    return {
      id: String(row.id),
      kind: 'inbound',
      at: toIso(row.created_at) || new Date(0).toISOString(),
      title: `전화 문의${row.transcript ? ` · ${clip(row.transcript, 28)}` : ''}`,
      subtitle: sec > 0 ? dur : undefined,
      status: null,
      detail: { transcript: row.transcript || null, response: row.ai_response || null, durationSeconds: sec, callStatus: row.status || null },
    };
  });
}

const EMAIL_EVENT_LABEL: Record<string, string> = {
  open: '이메일 열람', click: '이메일 링크 클릭', bounce: '이메일 반송',
  delivered: '이메일 도착', complaint: '이메일 스팸 신고', unsubscribe: '이메일 수신거부',
};

async function fetchEmails(scope: CustomerScope, before: string | null, limit: number) {
  if (scope.emails.length === 0) return [];
  const r = await query(
    `SELECT e.id, e.event_type, e.url, e.reason, e.occurred_at, c.name
       FROM email_events e
       LEFT JOIN email_campaigns c ON c.id = e.campaign_id
      WHERE lower(e.email) = ANY($1::text[])
        AND ($2::timestamptz IS NULL OR e.occurred_at <= $2::timestamptz)
      ORDER BY e.occurred_at DESC
      LIMIT $3`,
    [scope.emails, before, limit + 1],
  );
  return r.rows.map((row: any): TimelineEvent => {
    const type = String(row.event_type || '');
    return {
      id: String(row.id),
      kind: 'email',
      at: toIso(row.occurred_at) || new Date(0).toISOString(),
      title: `${EMAIL_EVENT_LABEL[type] || '이메일 반응'}${row.name ? ` · ${clip(row.name, 24)}` : ''}`,
      subtitle: row.reason ? clip(row.reason, 40) : (row.url ? clip(row.url, 40) : undefined),
      status: type === 'bounce' ? 'fail' : null,
      detail: { eventType: type, url: row.url || null, reason: row.reason || null },
    };
  });
}

const SOURCE_LABEL: Record<string, string> = {
  upload: '파일 등록', sync: '자동 연동', manual: '직접 등록', api: 'API 등록', cdp: '자사몰 연동',
};

function buildProfileEvents(scope: CustomerScope, before: string | null, limit: number): TimelineEvent[] {
  // 등록 시점 = 진입 행의 created_at. 매장별 형제 행까지 사건으로 만들면 같은 등록이 여러 줄이 된다.
  const at = toIso(scope.row.created_at);
  if (!at) return [];
  if (before && at > before) return [];
  const src = SOURCE_LABEL[String(scope.row.source || '')] || undefined;
  const store = scope.row.store_name ? String(scope.row.store_name) : undefined;
  const event: TimelineEvent = {
    id: `profile:${scope.row.id}`,
    kind: 'profile',
    at,
    title: '고객 등록',
    subtitle: [src, store].filter(Boolean).join(' · ') || undefined,
    status: null,
    detail: { source: scope.row.source || null, storeName: store || null },
  };
  return [event].slice(0, limit + 1);
}

// ────────────── 요약 ──────────────

async function buildSummary(companyId: string, scope: CustomerScope, sendCount: number | null) {
  const [purchaseRes, engageRes] = await Promise.allSettled([
    query(
      `SELECT COUNT(*)::int AS n FROM purchases
        WHERE company_id = $1::uuid AND (customer_id = ANY($2::uuid[]) OR ($3::text IS NOT NULL AND customer_phone = $3::text))`,
      [companyId, scope.ids, scope.phone],
    ),
    query(
      `SELECT
         (SELECT COUNT(*) FROM dm_views v WHERE v.company_id = $1::uuid
            AND (($2::text IS NOT NULL AND v.phone = $2::text) OR v.recipient_token = ANY($3::text[])))
       + (SELECT COUNT(*) FROM dm_event_responses r WHERE r.company_id = $1::uuid AND r.customer_id = ANY($4::uuid[]))
       + (SELECT COUNT(*) FROM cdp_inapp_impressions i WHERE i.company_id = $1::uuid AND i.customer_id = ANY($4::uuid[]))
         AS n`,
      [companyId, scope.phone, scope.tokens, scope.ids],
    ),
  ]);

  const purchases = purchaseRes.status === 'fulfilled' ? num(purchaseRes.value.rows[0]?.n) : 0;
  const engagements = engageRes.status === 'fulfilled' ? num(engageRes.value.rows[0]?.n) : 0;
  // sendCount가 null이면 못 센 것이다(제한 시간 초과·인덱스 부재). 0으로 접으면 "안 보냈다"로 읽힌다.
  return { sends: sendCount ?? 0, engagements, purchases, lastActivityAt: null as string | null };
}

/**
 * 발송 총건수 — 테이블별 COUNT 합산.
 * ⛔ `(dest_no, sendreq_time)` 인덱스가 없으면 테이블마다 전행 스캔이라 수십 초가 걸린다(2026-08-22 실측 20초/84만행).
 *   요약 하나 때문에 화면이 붙잡히면 안 되므로 제한 시간을 두고, 못 세면 null을 돌려 요약만 비운다.
 */
const SEND_COUNT_TIMEOUT_MS = 4000;

async function countSends(companyId: string, phone: string | null, months: number): Promise<number | null> {
  if (!phone) return 0;
  const run = (async () => {
    const tables = await getCompanySmsTablesWithLogsRange(companyId, months);
    if (tables.length === 0) return 0;
    const subs = tables.map((t) => `(SELECT COUNT(*) AS n FROM ${t} WHERE dest_no = ?)`);
    const rows = (await mysqlQuery(
      `SELECT SUM(n) AS total FROM (${subs.join(' UNION ALL ')}) x`,
      tables.map(() => phone),
    )) as any[];
    return num(rows[0]?.total);
  })();
  return withTimeout(run, SEND_COUNT_TIMEOUT_MS);
}

// ────────────── 조립 ──────────────

export interface TimelineOptions {
  companyId: string;
  customerId: string;
  before?: string | null;
  kinds?: TimelineKind[] | null;
  limit?: number;
  months?: number;
  /** 요약(전체 건수) 계산 여부. 첫 페이지에서만 true */
  withSummary?: boolean;
}

export async function buildCustomerTimeline(opts: TimelineOptions): Promise<TimelineResult | null> {
  const limit = Math.min(Math.max(num(opts.limit) || 50, 1), 100);
  const months = Math.min(Math.max(num(opts.months) || 12, 1), 24);
  const cursor = decodeCursor(opts.before);
  const beforeAt = cursor ? cursor.at : null;
  const want = new Set<TimelineKind>(
    opts.kinds && opts.kinds.length > 0 ? opts.kinds : TIMELINE_KINDS,
  );

  const scope = await resolveCustomerScope(opts.companyId, opts.customerId);
  if (!scope) return null;

  const sources: Partial<Record<TimelineKind, TimelineSourceState>> = {};
  const on = (k: TimelineKind) => want.has(k);

  const batches = await Promise.all([
    on('send') ? runSource('send', sources, limit, () => fetchSends(opts.companyId, scope, months, beforeAt, limit, sources)) : [],
    on('purchase') ? runSource('purchase', sources, limit, () => fetchPurchases(opts.companyId, scope, beforeAt, limit)) : [],
    on('behavior') ? runSource('behavior', sources, limit, () => fetchBehaviors(opts.companyId, scope, beforeAt, limit)) : [],
    on('inapp') ? runSource('inapp', sources, limit, () => fetchInapp(opts.companyId, scope, beforeAt, limit)) : [],
    on('dm_view') ? runSource('dm_view', sources, limit, () => fetchDmViews(opts.companyId, scope, beforeAt, limit)) : [],
    on('dm_response') ? runSource('dm_response', sources, limit, () => fetchDmResponses(opts.companyId, scope, beforeAt, limit)) : [],
    on('consent') ? runSource('consent', sources, limit, () => fetchConsents(opts.companyId, scope, beforeAt, limit)) : [],
    on('unsubscribe') ? runSource('unsubscribe', sources, limit, () => fetchUnsubscribes(opts.companyId, scope, beforeAt, limit)) : [],
    on('journey') ? runSource('journey', sources, limit, () => fetchJourneys(opts.companyId, scope, beforeAt, limit)) : [],
    on('inbound') ? runSource('inbound', sources, limit, () => fetchInbound(opts.companyId, scope, beforeAt, limit)) : [],
    on('email') ? runSource('email', sources, limit, () => fetchEmails(scope, beforeAt, limit)) : [],
    on('profile') ? runSource('profile', sources, limit, async () => buildProfileEvents(scope, beforeAt, limit)) : [],
  ]);

  // 병합 → 커서보다 뒤만 → 정렬 → 한 페이지
  const merged = batches.flat().filter((e) => isAfterCursor(e, cursor));
  merged.sort(compareEvents);
  const page = merged.slice(0, limit);
  const nextBefore = merged.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]) : null;

  let summary = { sends: 0, engagements: 0, purchases: 0, lastActivityAt: null as string | null };
  if (opts.withSummary !== false && !cursor) {
    const sendCount = await countSends(opts.companyId, scope.phone, months);
    summary = await buildSummary(opts.companyId, scope, sendCount);
    summary.lastActivityAt = page.length > 0 ? page[0].at : null;
  }

  // 수신거부 여부 — 상세 API와 같은 기준(user 축이 아니라 회사 축으로 본다)
  let isUnsubscribed = false;
  if (scope.phone) {
    try {
      const u = await query(
        `SELECT EXISTS (SELECT 1 FROM unsubscribes WHERE company_id = $1::uuid AND phone = $2) AS x`,
        [opts.companyId, scope.phone],
      );
      isUnsubscribed = !!u.rows[0]?.x;
    } catch {
      isUnsubscribed = false;
    }
  }

  return {
    customer: {
      id: String(scope.row.id),
      name: scope.row.name || null,
      phone: scope.phone,
      grade: scope.row.grade || null,
      stores: scope.stores,
      smsOptIn: scope.row.sms_opt_in === true,
      isUnsubscribed,
      registeredAt: toIso(scope.row.created_at),
    },
    summary,
    events: page,
    nextBefore,
    sources,
  };
}
