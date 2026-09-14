/**
 * ★ 우커머스(WooCommerce · 워드프레스) Provider 어댑터 — 2026-09-14 W2
 * 설계서 = docs/2026-09-14-woocommerce-integration-design.md
 *
 * 연동 방식 = REST 키 주기 수집(polling) + 우커머스 기본 웹훅 수신(가속). OAuth 없음.
 *   - 웹훅 서명: X-WC-Webhook-Signature = HMAC-SHA256(secret, 원본 바이트) — 인코딩은 base64 추정(미검증) → hex 도 함께 받는다(게이트 ② 뒤 조인다)
 *   - 몰 식별: 수신 URL 경로(/api/woocommerce/webhook/{mallId}) 우선 · X-WC-Webhook-Source 헤더 보조(둘 다 normalizeWooMallId)
 *   - 이벤트 문자열 = "{mallId}:{topic}" (예 ilbonimo.com:order.created) — 재처리 워커가 (companyId, event, resource) 만 넘기므로
 *     몰 식별자를 event 에 싣는다. 멱등키도 같은 접두를 얻어 몰 간 delivery id 충돌이 없다.
 *   - 처리: 행(company + mall)의 수신동의 메타키 → woocommerce-client.processWooResource(한 함수) → identify/syncOrder
 *
 * ⛔ 회사에 그 몰 행이 없으면 던진다 — 조용히 성공 처리하면 재처리 워커가 "처리됨"으로 닫아 데이터가 사라진다.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { IProviderAdapter, ProviderCapabilities, ProviderTokenResponse } from './provider-registry';
import { buildWebhookIdempotencyKey } from './cdp-idempotency';
import { normalizeWooMallId, wooTopicKind, type WooTopicResource, type WooTopicEvent } from './woocommerce-core';
import { WOO_PROVIDER, getWooIntegration, processWooResource } from './woocommerce-client';

const capabilities: ProviderCapabilities = {
  oauth: false,
  webhook: true,
  webhookSignatureVerification: true,
  adminApi: true,
};

const NO_OAUTH = '우커머스는 OAuth 흐름이 없습니다. 한줄로 관리자 → 자사몰 연동에서 몰 주소와 REST API 키를 입력해주세요. (/api/woocommerce)';

export interface ParsedWooEvent {
  mallId: string;
  topic: string;
  kind: { resource: WooTopicResource; event: WooTopicEvent };
}

/** "{mallId}:{topic}" → 몰·주제. 몰이 없거나 주제가 order/customer 밖이면 null. */
export function parseWooEvent(event: unknown): ParsedWooEvent | null {
  const s = String(event ?? '').trim();
  const idx = s.indexOf(':');
  if (idx <= 0) return null;
  const mallId = normalizeWooMallId(s.slice(0, idx));
  const topic = s.slice(idx + 1).trim().toLowerCase();
  const kind = wooTopicKind(topic);
  if (!mallId || !kind) return null;
  return { mallId, topic, kind };
}

/** 몰 식별자 + 주제 → 저장·멱등에 쓰는 event 문자열. */
export function buildWooEvent(mallId: string, topic: string): string {
  return `${mallId}:${topic}`;
}

/** 헤더 1개 값(배열이면 첫 값 · 없으면 null). 라우트·어댑터가 같은 함수를 쓴다. */
export function wooHeader(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()];
  const s = Array.isArray(v) ? v[0] : v;
  return s ? String(s) : null;
}
const headerValue = wooHeader;

export const woocommerceAdapter: IProviderAdapter = {
  provider: WOO_PROVIDER,
  displayName: '우커머스(워드프레스)',
  capabilities,
  connectMethod: 'polling',
  available: true,

  buildAuthorizeUrl(): string {
    throw new Error(NO_OAUTH);
  },
  async exchangeCode(): Promise<ProviderTokenResponse> {
    throw new Error(NO_OAUTH);
  },
  async refreshToken(): Promise<ProviderTokenResponse> {
    throw new Error('우커머스는 token refresh 가 없습니다. REST API 키 방식입니다.');
  },

  verifyWebhookSignature(rawBody, signature, secret): boolean {
    if (!secret || !signature) return false;
    try {
      const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
      const sig = Buffer.from(signature.trim());
      const b64 = Buffer.from(createHmac('sha256', secret).update(body).digest('base64'));
      const hex = Buffer.from(createHmac('sha256', secret).update(body).digest('hex'));
      if (sig.length === b64.length && timingSafeEqual(sig, b64)) return true;
      if (sig.length === hex.length && timingSafeEqual(sig, hex)) return true;
      return false;
    } catch {
      return false;
    }
  },

  async processWebhookEvent(companyId, event, resource): Promise<void> {
    const parsed = parseWooEvent(event);
    if (!parsed) {
      console.log(`[WooCommerce Adapter] 처리하지 않는 event: ${event}`);
      return;
    }
    const integ = await getWooIntegration(companyId, parsed.mallId);
    if (!integ) throw new Error(`우커머스 연동이 없는 몰입니다: ${parsed.mallId}`);
    if (parsed.kind.event === 'deleted') {
      // 삭제 페이로드는 {id} 만 온다 — 적재할 값이 없다(매출 되돌림은 refunded/cancelled 상태 갱신이 맡는다)
      console.log(`[WooCommerce Adapter] 삭제 이벤트는 적재하지 않는다: ${event} id=${resource?.id}`);
      return;
    }
    const r = await processWooResource(companyId, parsed.mallId, parsed.kind.resource, resource, integ.consentMetaKey);
    if (r === 'skipped') console.log(`[WooCommerce Adapter] 적재 불가(식별 수단·주문시각 없음): ${event} id=${resource?.id}`);
  },

  extractMallIdFromWebhook(headers): string | null {
    const src = headerValue(headers, 'x-wc-webhook-source');
    return src ? normalizeWooMallId(src) : null;
  },

  extractEventFromWebhook(headers): string | null {
    const topic = headerValue(headers, 'x-wc-webhook-topic');
    return topic ? topic.trim().toLowerCase() : null;
  },

  buildIdempotencyKey(event, resource, body): string {
    // CT-85 — 전송 고유값(delivery_id · 라우트가 X-WC-Webhook-Delivery-ID 를 body 에 실어 준다) 우선 + 자원 id 엔티티 + 본문 해시.
    const parsed = parseWooEvent(event);
    const id = resource?.id;
    const entity = id === undefined || id === null
      ? {}
      : parsed?.kind.resource === 'customer' ? { customer_id: id } : { order_id: id };
    return buildWebhookIdempotencyKey(event, { ...(resource || {}), ...entity }, body);
  },
};
