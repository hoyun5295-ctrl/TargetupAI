/**
 * ★ CT-21: 한줄로 CDP 이벤트 ingestion 컨트롤타워 — D172 (2026-05-19)
 *
 * 🎯 목적
 *   자사몰 → 한줄로AI 사용자 행동 이벤트 (view/cart/checkout/purchase/wishlist) 수집.
 *   - cdp_events 테이블에 저장됨
 *   - identity_link 매핑된 이벤트는 customer_id 자동 연결
 *   - 비회원 이벤트도 anonymous link로 저장되어 추후 회원 가입 시 자동 연결
 *
 * 📋 표준 event_name (Braze/Segment 정합)
 *   - page_view: 사용자가 페이지 방문
 *   - cart_add: 장바구니에 상품 담음
 *   - cart_remove: 장바구니에서 상품 제거
 *   - cart_view: 장바구니 페이지 진입
 *   - checkout_start: 결제 페이지 진입
 *   - checkout_complete: 결제 완료 (purchase 이벤트와 분리, Cafe24는 둘 다 기록)
 *   - purchase: 구매 완료 (cdp-orders.ts에서도 기록, 이벤트는 trigger용)
 *   - wishlist_add: 위시리스트 담음
 *   - wishlist_remove: 위시리스트 제거
 *   - product_view: 상품 페이지 진입
 *   - search: 검색 (query string 포함)
 *   - custom_*: 자사몰 자체 정의 (custom_ 접두사 필수)
 *
 * ⛔ 영구 원칙
 *   - properties JSONB는 최대 10KB (대용량 저장 X)
 *   - event_name은 표준 또는 'custom_' 접두사만 허용
 *   - source는 cdp_identity_links.source와 일치 필수
 */

import { query, pool } from '../config/database';
import { ensureAnonymousLink, identifyCustomer } from './cdp-identity';
// ★ 2026-06-25 (gap 5): 자사몰 전송 시각 미래 클램프(커서·통계 왜곡 차단)
import { clampOccurredAt } from './cdp-occurred-at';
import { maskPII } from './pii-masking';
import { isOverMonthlyCdpLimit, recordCdpApiCall } from './cdp-auth';
// ★ D214+ (2026-05-24) Unified Customer Profile 정합
import { fuseEventToCustomer } from './customer-cdp-fusion';
import { recomputeProfile } from './unified-customer-profile';
// ★ D215+ (2026-05-25) 인앱 메시지 트리거 매칭 fire-and-forget 로깅 (CT-82)
import { listInAppTriggerCandidates } from './inapp-trigger-engine';

// ═══════════════════════════════════════════════════════════
// 타입 + 표준 이벤트
// ═══════════════════════════════════════════════════════════

export const STANDARD_EVENT_NAMES = [
  'page_view',
  'cart_add',
  'cart_remove',
  'cart_view',
  'checkout_start',
  'checkout_complete',
  'purchase',
  'wishlist_add',
  'wishlist_remove',
  'product_view',
  'search',
  // D183 (2026-05-20): SMS/카톡 단축 URL 클릭 트래킹 — accumulateCampaignLearning 정확도 학습
  'message_click',
] as const;

export type StandardEventName = typeof STANDARD_EVENT_NAMES[number];

export interface TrackEventInput {
  source: string;                          // 'cafe24' / 'shopify' / 'custom_sdk' 등
  eventName: string;                       // 표준 또는 'custom_*'
  // 회원 식별 (둘 중 하나 필수, 둘 다 전달되면 externalId 우선)
  externalId?: string;                     // 자사몰 회원 ID (회원 이벤트)
  anonymousId?: string;                    // 비회원 추적 ID (브라우저 cookie 등)
  // 이벤트 데이터
  properties?: Record<string, any>;        // 최대 10KB
  occurredAt?: string;                     // ISO datetime (미설정 시 NOW)
}

export interface TrackEventResult {
  eventId: string;
  identityLinkId: string | null;
  customerId: string | null;
}

const MAX_PROPERTIES_BYTES = 10 * 1024; // 10KB

// ═══════════════════════════════════════════════════════════
// 검증 헬퍼
// ═══════════════════════════════════════════════════════════

export function validateEventName(eventName: string): { ok: boolean; error?: string } {
  if (!eventName || typeof eventName !== 'string') {
    return { ok: false, error: 'event_name은 필수 문자열입니다.' };
  }
  if (eventName.length > 50) {
    return { ok: false, error: 'event_name은 50자 이하만 허용됩니다.' };
  }
  if ((STANDARD_EVENT_NAMES as readonly string[]).includes(eventName)) {
    return { ok: true };
  }
  if (eventName.startsWith('custom_') && /^custom_[a-z0-9_]+$/.test(eventName)) {
    return { ok: true };
  }
  return {
    ok: false,
    error: `허용되지 않는 event_name: ${eventName}. 표준 이벤트 또는 'custom_' 접두사를 사용하세요.`,
  };
}

export function validateProperties(properties: any): { ok: boolean; error?: string } {
  if (properties === null || properties === undefined) return { ok: true };
  if (typeof properties !== 'object' || Array.isArray(properties)) {
    return { ok: false, error: 'properties는 객체여야 합니다.' };
  }
  try {
    const json = JSON.stringify(properties);
    if (Buffer.byteLength(json, 'utf8') > MAX_PROPERTIES_BYTES) {
      return { ok: false, error: `properties가 최대 ${MAX_PROPERTIES_BYTES} bytes를 초과했습니다.` };
    }
  } catch {
    return { ok: false, error: 'properties JSON 직렬화에 실패했습니다.' };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════
// 메인 — trackEvent
// ═══════════════════════════════════════════════════════════

/**
 * CDP 이벤트 1건 INSERT.
 * - externalId 전달: 기존 link 매칭 → customer_id 매핑
 * - anonymousId 전달 + externalId 미전달: anonymous link 생성 (customer_id NULL)
 * - 둘 다 미전달: 오류
 */
export async function trackEvent(
  companyId: string,
  input: TrackEventInput
): Promise<TrackEventResult> {
  const eventNameCheck = validateEventName(input.eventName);
  if (!eventNameCheck.ok) {
    throw new Error(eventNameCheck.error);
  }
  const propsCheck = validateProperties(input.properties);
  if (!propsCheck.ok) {
    throw new Error(propsCheck.error);
  }
  if (!input.source) {
    throw new Error('source는 필수입니다.');
  }

  let identityLinkId: string | null = null;
  let customerId: string | null = null;

  // externalId 우선 (회원 이벤트)
  if (input.externalId) {
    const linkRow = await query(
      `SELECT id, customer_id FROM cdp_identity_links
       WHERE company_id = $1::uuid AND source = $2 AND external_id = $3
       LIMIT 1`,
      [companyId, input.source, input.externalId]
    );
    if (linkRow.rows.length > 0) {
      identityLinkId = linkRow.rows[0].id;
      customerId = linkRow.rows[0].customer_id || null;
      // last_seen 갱신 (fire-and-forget)
      void query(
        `UPDATE cdp_identity_links SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`,
        [identityLinkId]
      );
    } else {
      // 비식별된 externalId — anonymous link 생성 (회원가입 트래킹 흐름 일치)
      identityLinkId = await ensureAnonymousLink(companyId, input.source, input.externalId);
    }
  } else if (input.anonymousId) {
    // 비회원 추적 — anonymous_<id> 형식으로 link 생성
    const anonExtId = `anon_${input.anonymousId}`;
    identityLinkId = await ensureAnonymousLink(companyId, input.source, anonExtId);
  } else {
    throw new Error('externalId 또는 anonymousId 중 하나는 필수입니다.');
  }

  // 이벤트 INSERT — occurred_at은 미래 클램프(파싱 실패/미전달 → now, 과거는 그대로)
  const occurredAt = clampOccurredAt(input.occurredAt, new Date());

  const result = await query(
    `INSERT INTO cdp_events (
      id, company_id, identity_link_id, customer_id,
      event_name, properties, source, occurred_at, created_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid,
      $4, $5::jsonb, $6, $7, NOW()
    )
    RETURNING id`,
    [
      companyId,
      identityLinkId,
      customerId,
      input.eventName,
      JSON.stringify(input.properties || {}),
      input.source,
      occurredAt,
    ]
  );

  // ★ D214+ (2026-05-24) customer-level union 통합 (CT-72 + CT-71)
  //   cart_add / wishlist_add / page_view 영역 → customers 컬럼 union (fuseEventToCustomer)
  //   unified profile 재계산 (recomputeProfile — fire-and-forget)
  if (customerId) {
    await fuseEventToCustomer(companyId, customerId, input.eventName, occurredAt).catch((err) => {
      console.warn('[CDP Events] fuseEventToCustomer 실패 (이벤트 INSERT 성공):', err);
    });
    void recomputeProfile(companyId, customerId).catch((err) => {
      console.warn('[CDP Events] recomputeProfile 실패:', err);
    });
  }

  // ★ D215+ (2026-05-25) 인앱 메시지 트리거 매칭 후보 fire-and-forget 로깅 (CT-82)
  //   실제 인앱 표시는 SDK가 GET /inapp/active 호출 시 수행. 본 영역은 매칭 후보 수 로깅만.
  //   대상 이벤트: cart_add / cart_view / page_view / checkout_start 4종 (인앱 트리거 표준).
  const INAPP_TRIGGER_EVENTS = new Set([
    'cart_add', 'cart.add',
    'cart_view', 'cart.view',
    'page_view', 'page.view',
    'checkout_start', 'checkout.start',
  ]);
  if (INAPP_TRIGGER_EVENTS.has(input.eventName)) {
    void listInAppTriggerCandidates(companyId, input.eventName).then((candidateIds) => {
      if (candidateIds.length > 0) {
        console.log(`[CDP Events] 인앱 트리거 매칭 후보 ${candidateIds.length}건 (event=${input.eventName}, companyId=${companyId})`);
      }
    }).catch((err) => {
      console.warn('[CDP Events] listInAppTriggerCandidates 실패:', err);
    });
  }

  return {
    eventId: result.rows[0].id,
    identityLinkId,
    customerId,
  };
}

// ═══════════════════════════════════════════════════════════
// 최근 이벤트 조회 (CdpSettingsPage 디버깅 + 운영 모니터링)
// ═══════════════════════════════════════════════════════════

export interface RecentEventsResult {
  events: Array<{
    id: string;
    eventName: string;
    properties: Record<string, any>;
    source: string;
    customerId: string | null;
    externalId: string | null;
    occurredAt: string;
  }>;
  total: number;
}

export async function getRecentEvents(
  companyId: string,
  limit: number = 50,
  offset: number = 0
): Promise<RecentEventsResult> {
  const events = await query(
    `SELECT e.id, e.event_name, e.properties, e.source, e.customer_id, e.occurred_at,
            l.external_id
     FROM cdp_events e
     LEFT JOIN cdp_identity_links l ON e.identity_link_id = l.id
     WHERE e.company_id = $1::uuid
     ORDER BY e.occurred_at DESC
     LIMIT $2 OFFSET $3`,
    [companyId, Math.min(limit, 200), offset]
  );
  const totalResult = await query(
    `SELECT COUNT(*)::int AS total FROM cdp_events WHERE company_id = $1::uuid`,
    [companyId]
  );

  return {
    events: events.rows.map((r: any) => ({
      id: r.id,
      eventName: r.event_name,
      properties: r.properties || {},
      source: r.source,
      customerId: r.customer_id,
      externalId: r.external_id,
      occurredAt: r.occurred_at?.toISOString?.() || String(r.occurred_at),
    })),
    total: totalResult.rows[0].total,
  };
}

// ═══════════════════════════════════════════════════════════
// 장바구니 리커버리 — 발송 메시지에 담은 상품 노출 (Liquid {{ cart.* }})
//   journey-executor가 cart 여정 발송 직전 호출. connected-content와 동일 패턴:
//   템플릿이 {{ cart.* }} 참조할 때만 조회(불요 쿼리 0) + 실패 시 빈 객체(발송 차단 X).
// ═══════════════════════════════════════════════════════════

/** 본문에 {{ cart.* }} Liquid 변수가 있는지 (게이팅) */
export function hasCartLiquidVars(template: string): boolean {
  return /\{\{\s*cart\./.test(template || '');
}

/**
 * 고객의 가장 최근 cart_add 이벤트 properties를 Liquid 컨텍스트 { cart: {...} }로 반환.
 * - 템플릿이 {{ cart.* }} 미참조 시 빈 객체 (쿼리 skip)
 * - 이벤트 없거나 오류 시 빈 객체 (발송 차단 X)
 * - 사용 예: {{ cart.product_name }} / {{ cart.price }} / {{ cart.product_url }}
 */
export async function enrichLiquidContextWithCart(
  template: string,
  companyId: string,
  customerId: string | null
): Promise<Record<string, any>> {
  if (!customerId || !hasCartLiquidVars(template)) return {};
  try {
    const r = await query(
      `SELECT properties FROM cdp_events
       WHERE company_id = $1::uuid AND customer_id = $2::uuid AND event_name = 'cart_add'
       ORDER BY occurred_at DESC LIMIT 1`,
      [companyId, customerId]
    );
    if (r.rows.length === 0) return {};
    const props = r.rows[0].properties;
    if (!props || typeof props !== 'object') return {};
    return { cart: props };
  } catch (err: any) {
    console.log('[CDP cart context] skip:', err?.message || err);
    return {};
  }
}

// ═══════════════════════════════════════════════════════════
// 브라우저 SDK 배치 ingestion (v0.3.5) — POST /api/cdp/ingest 전용
//   SDK type → 표준 event_name 정규화 + identify 식별 + 익명→회원 소급(stitching).
//   옛 inline INSERT는 없는 event_type/payload 컬럼 참조로 항상 503 → 본 함수로 교체.
//   장바구니 리커버리 엔진(matchCartAbandon)이 customer_id IS NOT NULL만 잡으므로,
//   로그인 전 담은 카트도 식별 시점에 소급 연결되어야 발송 대상이 된다.
// ═══════════════════════════════════════════════════════════

// SDK 이벤트 type → cdp_events.event_name 정규화 매핑 (track은 e.event 직접 사용)
const BROWSER_TYPE_TO_EVENT_NAME: Record<string, string> = {
  pageview: 'page_view',
  click: 'click',
  identify: 'identify',
  consent: 'consent',
};

// 정규화 시 properties에서 제외할 control 키 (식별 정보 + 구조 키)
const BROWSER_CONTROL_KEYS = new Set([
  'type', 'trust_level', 'external_id', 'email', 'phone', 'name', 'event', 'properties',
]);

export interface BrowserIngestBatch {
  anonymousId: string | null;
  sessionId: string | null;
  schemaVersion: string;
  sentAt: string | null;
  events: Array<Record<string, any>>;
}

export interface BrowserIngestResult {
  accepted: number;
  customerId: string | null;
  backfilled: number;
}

interface NormalizedBrowserEvent {
  eventName: string;
  properties: Record<string, any>;
  trustLevel: string;
}

/**
 * SDK 원본 이벤트 1건 → (event_name, properties, trust_level) 정규화.
 * - track: e.event = event_name (validateEventName 통과 시), e.properties = properties
 * - pageview/click/identify/consent: 매핑 테이블 + 잔여 필드 properties
 * 미지원 type 또는 미허용 track event = null (skip).
 */
function normalizeBrowserEvent(e: Record<string, any>): NormalizedBrowserEvent | null {
  const type = String(e?.type || '');
  const trustLevel = String(e?.trust_level || 'observed');

  if (type === 'track') {
    const eventName = String(e?.event || '');
    if (!validateEventName(eventName).ok) return null;
    const props = e?.properties && typeof e.properties === 'object' && !Array.isArray(e.properties)
      ? e.properties
      : {};
    return { eventName, properties: maskPII(props) as Record<string, any>, trustLevel };
  }

  const mapped = BROWSER_TYPE_TO_EVENT_NAME[type];
  if (!mapped) return null;

  const rest: Record<string, any> = {};
  for (const [k, v] of Object.entries(e)) {
    if (!BROWSER_CONTROL_KEYS.has(k)) rest[k] = v;
  }
  return { eventName: mapped, properties: maskPII(rest) as Record<string, any>, trustLevel };
}

/**
 * 브라우저 SDK 배치 1건을 cdp_events에 정규화 적재.
 * 1) 배치 식별 해소: identify 이벤트(external_id) → identifyCustomer / 없으면 anonymous_id 기존 known customer 재사용
 * 2) 트랜잭션 INSERT (정규화된 모든 이벤트)
 * 3) identify로 신규 식별 시 같은 anonymous_id의 옛 익명 이벤트에 customer_id 소급(stitching)
 */
export async function ingestBrowserEvents(
  companyId: string,
  batch: BrowserIngestBatch
): Promise<BrowserIngestResult> {
  const anonymousId = batch.anonymousId || null;
  // occurred_at은 미래 클램프(파싱 실패/미전달 → now, 과거는 그대로)
  const occurred = clampOccurredAt(batch.sentAt, new Date());

  // ── 0. 월간 호출 한도 게이팅 (요금제별) — 다른 endpoint와 동일 안전장치 ──
  if (await isOverMonthlyCdpLimit(companyId)) {
    void recordCdpApiCall(companyId, 'event', 429, 0);
    const err: any = new Error('이번 달 CDP 호출 한도를 초과했습니다.');
    err.code = 'MONTHLY_LIMIT_EXCEEDED';
    throw err;
  }

  // ── 1. 배치 식별 해소 ──
  let customerId: string | null = null;
  let identityLinkId: string | null = null;
  let didIdentify = false;

  const identifyEvt = batch.events.find((e) => e?.type === 'identify' && e?.external_id);
  if (identifyEvt) {
    try {
      const r = await identifyCustomer(companyId, {
        source: 'sdk',
        externalId: String(identifyEvt.external_id),
        email: identifyEvt.email ? String(identifyEvt.email) : undefined,
        phone: identifyEvt.phone ? String(identifyEvt.phone) : undefined,
        name: identifyEvt.name ? String(identifyEvt.name) : undefined,
      });
      customerId = r.customerId;
      identityLinkId = r.linkId;
      didIdentify = true;
    } catch (err: any) {
      // 식별 실패(예: 신규인데 phone 누락) — 이벤트 적재는 익명으로 계속
      console.log('[CDP ingestBrowser] identify skip:', err?.message || err);
    }
  }

  // identify 없으면 anonymous_id로 기존 known customer 재사용 (이전 배치에서 식별된 경우)
  if (!customerId && anonymousId) {
    const prior = await query(
      `SELECT customer_id FROM cdp_events
       WHERE company_id = $1::uuid AND anonymous_id = $2 AND customer_id IS NOT NULL
       ORDER BY received_at DESC LIMIT 1`,
      [companyId, anonymousId]
    );
    if (prior.rows.length > 0) customerId = prior.rows[0].customer_id;
  }

  // 익명 이벤트라도 anonymous link 1건 보장 (추후 회원 가입 시 추적 흐름 일치)
  if (!identityLinkId && anonymousId) {
    try {
      identityLinkId = await ensureAnonymousLink(companyId, 'sdk', `anon_${anonymousId}`);
    } catch (err: any) {
      console.log('[CDP ingestBrowser] anonymous link skip:', err?.message || err);
    }
  }

  // ── 2. 정규화 + 트랜잭션 INSERT ──
  const client = await pool.connect();
  let accepted = 0;
  try {
    await client.query('BEGIN');
    for (const e of batch.events) {
      const norm = normalizeBrowserEvent(e);
      if (!norm) continue;
      // properties 10KB 한도 — 초과 이벤트만 skip (다른 이벤트 적재는 계속, trackEvent와 동일 규칙)
      if (!validateProperties(norm.properties).ok) {
        console.log(`[CDP ingestBrowser] properties 한도 초과 skip — event=${norm.eventName}`);
        continue;
      }
      await client.query(
        `INSERT INTO cdp_events (
           id, company_id, identity_link_id, customer_id,
           event_name, properties, source,
           anonymous_id, session_id, trust_level, schema_version,
           occurred_at, sent_at, received_at, created_at
         ) VALUES (
           gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid,
           $4, $5::jsonb, 'sdk',
           $6, $7, $8, $9,
           $10, $11, NOW(), NOW()
         )`,
        [
          companyId,
          identityLinkId,
          customerId,
          norm.eventName,
          JSON.stringify(norm.properties || {}),
          anonymousId,
          batch.sessionId || null,
          norm.trustLevel,
          batch.schemaVersion,
          occurred,
          batch.sentAt || occurred.toISOString(),
        ]
      );
      accepted++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ── 3. 익명→회원 소급 (stitching) ──
  let backfilled = 0;
  if (customerId && anonymousId && didIdentify) {
    const upd = await query(
      `UPDATE cdp_events SET customer_id = $1::uuid
       WHERE company_id = $2::uuid AND anonymous_id = $3
         AND customer_id IS NULL
         AND received_at >= NOW() - INTERVAL '30 days'`,
      [customerId, companyId, anonymousId]
    );
    backfilled = upd.rowCount || 0;
  }

  // ── 4. 호출 한도 집계 (fire-and-forget) — accepted 건수만큼 누적 ──
  if (accepted > 0) {
    void recordCdpApiCall(companyId, 'event', 200, accepted);
  }

  return { accepted, customerId, backfilled };
}
