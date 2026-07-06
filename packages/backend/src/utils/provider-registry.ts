/**
 * ★ CT-24: 자사몰 Provider Adapter 일반화 컨트롤타워 — D173 (2026-05-19)
 *
 * 🎯 목적
 *   자사몰별 OAuth + Webhook + REST API를 표준 인터페이스로 통합.
 *   - 카페24, 메이크샵, Shopify, imweb, 식스샵 등을 같은 패턴으로 박음
 *   - routes/provider.ts가 본 인터페이스만 의존 → 새 자사몰 추가 시 routes 변경 0건
 *   - cafe24-client.ts (CT-23) 등 자사몰별 client는 IProviderAdapter 구현체
 *
 * 📋 등록된 Provider (등록 출처 = app.ts registerAllProviders() / utils/register-providers.ts 단일 출처. 2026-06-25 갱신)
 *   - 'cafe24'(oauth) / 'naver_smart_store'(oauth) / 'custom'(webhook) / 'godo'(polling) / 'gabia'(webhook) = 사용 가능(available)
 *   - 'makeshop' = skeleton(available:false → coming_soon). 'imweb'(oauth)는 imweb-client.ts에서 실 어댑터로 등록. shopify/sixshop/woocommerce는 자체 호스팅 webhook으로 흡수(2026-07-04 제거)
 *   - 어댑터가 connectMethod/available을 직접 선언 → listProvidersForUI가 추론 없이 그대로 노출(D189 추론 폐기)
 *
 * ⛔ 영구 원칙
 *   - 자체구축 자사몰은 본 Adapter 불요 — SDK + CDP API 직접 호출 (이미 박힘)
 *   - Provider별 access_token은 company_integrations 테이블에 박힘 (provider + mall_id UNIQUE)
 *   - Webhook idempotency는 cdp_webhook_deliveries 표준 박힘
 */

// ════════════════════════════════════════════════════════════════════
// 표준 타입
// ════════════════════════════════════════════════════════════════════

export interface ProviderTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  metadata: Record<string, unknown>;
}

export interface ProviderIntegration {
  id: string;
  companyId: string;
  mallId: string;
  provider: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scope: string;
  webhookSecret: string | null;
  status: string;
}

export interface ProviderCapabilities {
  /** OAuth 흐름 박힘 (false면 mall_id + raw API token 박는 패턴) */
  oauth: boolean;
  /** Webhook receiver 박힘 (false면 한줄로가 자체 polling) */
  webhook: boolean;
  /** Webhook 서명 검증 박힘 (HMAC-SHA256 등) */
  webhookSignatureVerification: boolean;
  /** Admin REST API 박힘 (회원/주문 fetch 가능) */
  adminApi: boolean;
}

// ════════════════════════════════════════════════════════════════════
// Provider Adapter Interface
// ════════════════════════════════════════════════════════════════════

export interface IProviderAdapter {
  /** Provider 식별자 (cafe24, makeshop, shopify, imweb, sixshop 등) */
  readonly provider: string;
  /** 사용자에게 표시되는 한글 라벨 */
  readonly displayName: string;
  /** Provider 능력 매트릭스 */
  readonly capabilities: ProviderCapabilities;
  /** UI 연결 방식 — 카드 클릭 모달 분기에 사용 (oauth=카페24/네이버, polling=고도몰, webhook=가비아/자체호스팅) */
  readonly connectMethod: 'oauth' | 'webhook' | 'polling' | 'none';
  /** 실제 연동 가능 여부(추론 폐기 — 어댑터가 직접 선언). false면 'coming_soon' */
  readonly available: boolean;

  /**
   * OAuth authorize URL 생성 (사용자가 새 창에서 동의).
   * @throws OAuth 미지원 시 에러
   */
  buildAuthorizeUrl(mallId: string, state: string, scope?: string): string;

  /**
   * authorize code → access_token + refresh_token 교환.
   * @throws OAuth 미지원 시 에러
   */
  exchangeCode(mallId: string, code: string): Promise<ProviderTokenResponse>;

  /**
   * refresh_token으로 access_token 갱신.
   */
  refreshToken(integration: ProviderIntegration): Promise<ProviderTokenResponse>;

  /**
   * Webhook 서명 검증 (HMAC-SHA256 등).
   * @returns false 시 한줄로가 401 반환
   */
  verifyWebhookSignature(rawBody: Buffer | string, signature: string, secret: string | null): boolean;

  /**
   * Webhook 이벤트를 한줄로 CDP에 박음 (identifyCustomer/syncOrder/trackEvent).
   * - 이벤트 종류는 provider별 표준 (cafe24: order.created / makeshop: order/save 등)
   * - 본 함수 내부에서 cdp-* CT 호출
   */
  processWebhookEvent(companyId: string, event: string, resource: Record<string, any>): Promise<void>;

  /**
   * Webhook payload에서 mall_id 추출 (자사몰별 다름).
   * - cafe24: headers['x-cafe24-mall-id'] 또는 body.resource.mall_id
   * - shopify: headers['x-shopify-shop-domain']
   */
  extractMallIdFromWebhook(headers: Record<string, string | string[] | undefined>, body: Record<string, any>): string | null;

  /**
   * Webhook event_name 추출 (provider별 헤더 또는 본문).
   */
  extractEventFromWebhook(headers: Record<string, string | string[] | undefined>, body: Record<string, any>): string | null;

  /**
   * idempotency_key 생성 (provider별 표준 박음).
   */
  buildIdempotencyKey(event: string, resource: Record<string, any>, body: Record<string, any>): string;
}

// ════════════════════════════════════════════════════════════════════
// Registry — Provider 등록 시스템
// ════════════════════════════════════════════════════════════════════

const registry = new Map<string, IProviderAdapter>();

export function registerProvider(adapter: IProviderAdapter): void {
  registry.set(adapter.provider, adapter);
}

export function getProvider(provider: string): IProviderAdapter | null {
  return registry.get(provider) || null;
}

export function listProviders(): IProviderAdapter[] {
  return Array.from(registry.values());
}

export type ProviderUIEntry = {
  provider: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  connectMethod: 'oauth' | 'webhook' | 'polling' | 'none';
  available: boolean;
  status: 'available' | 'coming_soon';
};

/**
 * 순수 — 어댑터 배열 → UI 엔트리. available 직접 사용(D189 capabilities 추론 폐기 — 폴링형 고도몰을 표현 못 하던 한계 해소).
 * 테스트 가능(DB import 0).
 */
export function buildProvidersForUI(
  adapters: Array<Pick<IProviderAdapter, 'provider' | 'displayName' | 'capabilities' | 'connectMethod' | 'available'>>,
): ProviderUIEntry[] {
  return adapters.map((p) => ({
    provider: p.provider,
    displayName: p.displayName,
    capabilities: p.capabilities,
    connectMethod: p.connectMethod,
    available: p.available,
    status: p.available ? 'available' : 'coming_soon',
  }));
}

export function listProvidersForUI(): ProviderUIEntry[] {
  return buildProvidersForUI(listProviders());
}

// ════════════════════════════════════════════════════════════════════
// Skeleton Adapter — Phase 2에서 박을 영역의 placeholder
// (UI에 'coming_soon' 카드 박는 용도. 동작 호출 시 에러)
// ════════════════════════════════════════════════════════════════════

export class SkeletonProviderAdapter implements IProviderAdapter {
  constructor(
    public readonly provider: string,
    public readonly displayName: string,
  ) {}

  readonly capabilities: ProviderCapabilities = {
    oauth: false,
    webhook: false,
    webhookSignatureVerification: false,
    adminApi: false,
  };
  readonly connectMethod = 'none' as const;
  readonly available = false;

  buildAuthorizeUrl(): string {
    throw new Error(`${this.displayName} 연동은 Phase 2에서 지원 예정입니다. 현재는 CDP API + SDK로 직접 호출 가능합니다.`);
  }
  async exchangeCode(): Promise<ProviderTokenResponse> {
    throw new Error(`${this.displayName} 연동은 Phase 2에서 지원 예정입니다.`);
  }
  async refreshToken(): Promise<ProviderTokenResponse> {
    throw new Error(`${this.displayName} 연동은 Phase 2에서 지원 예정입니다.`);
  }
  verifyWebhookSignature(): boolean {
    return false;
  }
  async processWebhookEvent(): Promise<void> {
    throw new Error(`${this.displayName} 연동은 Phase 2에서 지원 예정입니다.`);
  }
  extractMallIdFromWebhook(): string | null {
    return null;
  }
  extractEventFromWebhook(): string | null {
    return null;
  }
  buildIdempotencyKey(event: string): string {
    return `${event}:skeleton:${Date.now()}`;
  }
}

// ════════════════════════════════════════════════════════════════════
// Phase 2 박을 자사몰 — skeleton 박음 (UI에 'coming_soon' 표시)
// ════════════════════════════════════════════════════════════════════

// 2026-07-04 — imweb은 imweb-client.ts에서 실 어댑터로 등록(승격). shopify/sixshop/woocommerce 스켈레톤 제거(국내 사용 미미 + 개방 API 불확실).
// 2026-07-06 — makeshop은 makeshop-client.ts에서 실 어댑터(polling)로 등록(승격, skeleton 제거).
//   그 외 모든 몰은 custom(자체 호스팅) webhook으로 흡수. 특수 케이스는 개별 커스텀.

// 카페24는 cafe24-client.ts에서 별도 등록 (D173 리팩토링 시)
