/**
 * ★ CT-21: 한줄로 CDP 이벤트 ingestion 컨트롤타워 — D172 (2026-05-19)
 *
 * 🎯 목적
 *   자사몰 → 한줄로AI 사용자 행동 이벤트 (view/cart/checkout/purchase/wishlist) 수집.
 *   - cdp_events 테이블에 박힘
 *   - identity_link 박힌 이벤트는 customer_id 자동 연결
 *   - 비회원 이벤트도 anonymous link로 박혀서 추후 회원 가입 시 자동 연결
 *
 * 📋 표준 event_name (Braze/Segment 정합)
 *   - page_view: 사용자가 페이지 방문
 *   - cart_add: 장바구니에 상품 담음
 *   - cart_remove: 장바구니에서 상품 제거
 *   - cart_view: 장바구니 페이지 진입
 *   - checkout_start: 결제 페이지 진입
 *   - checkout_complete: 결제 완료 (purchase 이벤트와 분리, Cafe24는 둘 다 박음)
 *   - purchase: 구매 완료 (cdp-orders.ts에서도 박음, 이벤트는 trigger용)
 *   - wishlist_add: 위시리스트 담음
 *   - wishlist_remove: 위시리스트 제거
 *   - product_view: 상품 페이지 진입
 *   - search: 검색 (query string 포함)
 *   - custom_*: 자사몰 자체 정의 (custom_ 접두사 필수)
 *
 * ⛔ 영구 원칙
 *   - properties JSONB는 최대 10KB (대용량 박지 X)
 *   - event_name은 표준 또는 'custom_' 접두사만 허용
 *   - source는 cdp_identity_links.source와 일치 필수
 */

import { query } from '../config/database';
import { ensureAnonymousLink } from './cdp-identity';
// ★ D214+ (2026-05-24) Unified Customer Profile 정합
import { fuseEventToCustomer } from './customer-cdp-fusion';
import { recomputeProfile } from './unified-customer-profile';

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
  // 회원 식별 (둘 중 하나 필수, 둘 다 박으면 externalId 우선)
  externalId?: string;                     // 자사몰 회원 ID (회원 이벤트)
  anonymousId?: string;                    // 비회원 추적 ID (브라우저 cookie 등)
  // 이벤트 데이터
  properties?: Record<string, any>;        // 최대 10KB
  occurredAt?: string;                     // ISO datetime (미박힘 시 NOW)
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
 * - externalId 박힘: 기존 link 매칭 → customer_id 박힘
 * - anonymousId 박힘 + externalId 미박힘: anonymous link 박음 (customer_id NULL)
 * - 둘 다 미박힘: 오류
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
      // 비식별된 externalId — anonymous link 박음 (회원가입 트래킹 흐름 정합)
      identityLinkId = await ensureAnonymousLink(companyId, input.source, input.externalId);
    }
  } else if (input.anonymousId) {
    // 비회원 추적 — anonymous_<id> 형식으로 link 박음
    const anonExtId = `anon_${input.anonymousId}`;
    identityLinkId = await ensureAnonymousLink(companyId, input.source, anonExtId);
  } else {
    throw new Error('externalId 또는 anonymousId 중 하나는 필수입니다.');
  }

  // 이벤트 INSERT
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (isNaN(occurredAt.getTime())) {
    throw new Error('occurredAt 형식이 올바르지 않습니다 (ISO datetime 사용).');
  }

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

  // ★ D214+ (2026-05-24) customer-level union 매트릭스 (CT-72 + CT-71)
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
