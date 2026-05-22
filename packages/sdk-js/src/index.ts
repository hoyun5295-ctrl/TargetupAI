/**
 * @hanjullo/sdk — 한줄로 CDP (Customer Data Platform) SDK
 *
 * 자사몰 → 한줄로AI 회원/이벤트/주문 sync 표준 SDK.
 * 브라우저 + Node.js 양쪽 호환 (fetch 표준 사용).
 *
 * 사용 예:
 *   import { HanjulloSDK } from '@hanjullo/sdk';
 *   const hanjullo = new HanjulloSDK({ apiKey: 'hjl_...', secret: 'sk_...' });
 *   await hanjullo.identify({ externalId: 'user_123', email: 'user@example.com', phone: '01012345678' });
 *   await hanjullo.track({ eventName: 'cart_add', externalId: 'user_123', properties: { product_id: 'P001', price: 19000 } });
 *   await hanjullo.order({ orderId: 'O100', externalId: 'user_123', status: 'completed', totalAmount: 49000, orderedAt: new Date().toISOString() });
 *
 * 매뉴얼: https://hanjul.ai/docs/cdp
 */

import type {
  HanjulloSDKConfig,
  IdentifyParams,
  IdentifyResponse,
  TrackParams,
  TrackResponse,
  OrderParams,
  OrderResponse,
  BulkImportParams,
  BulkImportResponse,
  SDKError,
} from './types';
import { HanjulloPushModule } from './push';
import { HanjulloInAppModule } from './inapp';
import { HanjulloJourneyVariantsModule } from './journey-variants';

export * from './types';
export { HanjulloPushModule } from './push';
export { HanjulloInAppModule } from './inapp';
export { HanjulloJourneyVariantsModule } from './journey-variants';

const DEFAULT_ENDPOINT = 'https://app.hanjul.ai/api/cdp';
const DEFAULT_SOURCE = 'custom_sdk';
const DEFAULT_RETRIES = 2;

export class HanjulloSDK {
  private apiKey: string;
  private secret: string;
  private endpoint: string;
  private source: string;
  private retries: number;
  private debug: boolean;

  /** ★ D175-A: Web Push 채널 (브라우저 환경) */
  public readonly push: HanjulloPushModule;
  /** ★ D175-A: In-app Message 채널 (브라우저 환경) */
  public readonly inapp: HanjulloInAppModule;
  /** ★ D189 #4: Journey Step A/B/Bandit 트래킹 (click + conversion) */
  public readonly journeyVariants: HanjulloJourneyVariantsModule;

  constructor(config: HanjulloSDKConfig) {
    if (!config.apiKey || !config.apiKey.startsWith('hjl_')) {
      throw this.makeError(
        'apiKey는 필수이며 hjl_ 접두사로 시작해야 합니다. CdpSettingsPage에서 발급받으세요.',
        'INVALID_API_KEY',
      );
    }
    if (!config.secret || !config.secret.startsWith('sk_')) {
      throw this.makeError(
        'secret은 필수이며 sk_ 접두사로 시작해야 합니다. CdpSettingsPage에서 발급받으세요. (재발급 시 1회만 노출됨)',
        'INVALID_SECRET',
      );
    }
    this.apiKey = config.apiKey;
    this.secret = config.secret;
    this.endpoint = (config.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.source = config.source || DEFAULT_SOURCE;
    this.retries = typeof config.retries === 'number' ? Math.max(0, config.retries) : DEFAULT_RETRIES;
    this.debug = !!config.debug;

    // ★ D175-A: 브라우저 채널 모듈 (push/inapp)
    this.push = new HanjulloPushModule(this.apiKey, this.secret, this.endpoint);
    this.inapp = new HanjulloInAppModule(this.apiKey, this.secret, this.endpoint);
    // ★ D189 #4: Journey Step A/B/Bandit 트래킹
    this.journeyVariants = new HanjulloJourneyVariantsModule(this.apiKey, this.secret, this.endpoint);
  }

  // ════════════════════════════════════════════════════════════════
  // 공개 API
  // ════════════════════════════════════════════════════════════════

  /**
   * 회원 식별/upsert.
   * - 매칭 우선순위: source+externalId → email → phone → 신규 INSERT
   * - phone은 한줄로 백엔드에서 자동 정규화 (D162 영구 fix 정합)
   */
  async identify(params: IdentifyParams): Promise<IdentifyResponse> {
    if (!params.externalId) {
      throw this.makeError('externalId는 필수입니다.', 'MISSING_EXTERNAL_ID');
    }
    return this.post<IdentifyResponse>('/identify', {
      external_id: params.externalId,
      email: params.email,
      phone: params.phone,
      name: params.name,
      birth_date: params.birthDate,
      gender: params.gender,
      grade: params.grade,
      address: params.address,
      custom_fields: params.customFields,
    });
  }

  /**
   * 행동 이벤트 전송.
   * - 회원 이벤트: externalId 전송
   * - 비회원 이벤트: anonymousId 전송 (브라우저 cookie 등)
   * - 표준 이벤트(page_view/cart_add/...) 또는 'custom_*' 접두사
   */
  async track(params: TrackParams): Promise<TrackResponse> {
    if (!params.eventName) {
      throw this.makeError('eventName은 필수입니다.', 'MISSING_EVENT_NAME');
    }
    if (!params.externalId && !params.anonymousId) {
      throw this.makeError('externalId 또는 anonymousId 중 하나는 필수입니다.', 'MISSING_IDENTITY');
    }
    return this.post<TrackResponse>('/event', {
      event_name: params.eventName,
      external_id: params.externalId,
      anonymous_id: params.anonymousId,
      properties: params.properties || {},
      occurred_at: params.occurredAt,
    });
  }

  /**
   * 주문 sync + RFM 자동 갱신.
   * - status가 'completed' / 'paid'일 때만 customers.total_purchase_amount/purchase_count 갱신
   * - 같은 orderId 두 번 호출되어도 RFM 한 번만 갱신 (idempotency)
   * - cdp_events 'purchase' 이벤트 자동 생성 (Journey/Decisioning trigger용)
   */
  async order(params: OrderParams): Promise<OrderResponse> {
    if (!params.orderId || !params.externalId) {
      throw this.makeError('orderId와 externalId는 필수입니다.', 'MISSING_REQUIRED');
    }
    if (!params.status || params.totalAmount === undefined || !params.orderedAt) {
      throw this.makeError('status, totalAmount, orderedAt은 필수입니다.', 'MISSING_REQUIRED');
    }
    return this.post<OrderResponse>('/order', {
      order_id: params.orderId,
      external_id: params.externalId,
      email: params.email,
      phone: params.phone,
      name: params.name,
      status: params.status,
      total_amount: params.totalAmount,
      item_count: params.itemCount,
      items: params.items,
      ordered_at: params.orderedAt,
      currency: params.currency || 'KRW',
    });
  }

  /**
   * 초기 마이그레이션 (customers + orders 일괄 전송).
   * - 최대 1,000건/요청. 더 큰 import는 페이지네이션 호출.
   */
  async bulkImport(params: BulkImportParams): Promise<BulkImportResponse> {
    if (!params.customers && !params.orders) {
      throw this.makeError('customers 또는 orders 중 하나는 필수입니다.', 'MISSING_REQUIRED');
    }
    return this.post<BulkImportResponse>('/bulk-import', {
      customers: params.customers?.map((c) => ({
        external_id: c.externalId,
        email: c.email,
        phone: c.phone,
        name: c.name,
        birth_date: c.birthDate,
        gender: c.gender,
        grade: c.grade,
        address: c.address,
        custom_fields: c.customFields,
      })),
      orders: params.orders?.map((o) => ({
        order_id: o.orderId,
        external_id: o.externalId,
        email: o.email,
        phone: o.phone,
        name: o.name,
        status: o.status,
        total_amount: o.totalAmount,
        item_count: o.itemCount,
        items: o.items,
        ordered_at: o.orderedAt,
        currency: o.currency || 'KRW',
      })),
    });
  }

  // ════════════════════════════════════════════════════════════════
  // 내부 — HTTP + retry
  // ════════════════════════════════════════════════════════════════

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.endpoint}${path}`;
    // X-Source 헤더는 한줄로 백엔드의 cdpAuth.source 설정 용도이나 현재 미사용 — backend에서 자체 설정
    // (Phase 2에서 source per-call override 가능)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hanjullo-Key': this.apiKey,
      'X-Hanjullo-Secret': this.secret,
      'X-Hanjullo-SDK-Version': '0.1.0',
      'X-Hanjullo-Source': this.source,
    };

    // null/undefined 값 제거 (자사몰이 미입력 옵셔널 필드 깔끔하게 처리)
    const cleanBody: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== null && v !== undefined) cleanBody[k] = v;
    }

    let lastError: SDKError | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        if (this.debug) {
          console.log(`[HanjulloSDK] POST ${path} (attempt ${attempt + 1})`, cleanBody);
        }
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(cleanBody),
        });
        const responseBody = await this.safeParseJson(res);
        if (this.debug) {
          console.log(`[HanjulloSDK] ← ${res.status} ${path}`, responseBody);
        }
        if (res.ok) {
          return responseBody as T;
        }
        // 4xx는 retry 무의미 (인증/검증 실패), 5xx + 네트워크만 retry
        const isClientError = res.status >= 400 && res.status < 500 && res.status !== 429;
        if (isClientError) {
          throw this.makeError(
            (responseBody as { error?: string })?.error || `CDP API 호출 실패 (${res.status})`,
            (responseBody as { code?: string })?.code || `HTTP_${res.status}`,
            res.status,
            responseBody,
          );
        }
        lastError = this.makeError(
          (responseBody as { error?: string })?.error || `CDP API 일시 오류 (${res.status})`,
          (responseBody as { code?: string })?.code || `HTTP_${res.status}`,
          res.status,
          responseBody,
        );
      } catch (err: any) {
        // fetch 네트워크 실패 또는 위에서 throw한 client-error
        if (err?.code && err.code.startsWith('HTTP_4')) {
          throw err;
        }
        lastError = err?.code
          ? err
          : this.makeError(err?.message || '네트워크 오류', 'NETWORK_ERROR');
      }
      // exponential backoff (마지막 시도가 아니면 sleep)
      if (attempt < this.retries) {
        const delay = Math.min(2000, 200 * Math.pow(2, attempt));
        await this.sleep(delay);
      }
    }
    throw lastError || this.makeError('CDP API 호출 실패', 'UNKNOWN_ERROR');
  }

  private async safeParseJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return { error: '응답 본문이 JSON이 아닙니다.', code: 'INVALID_RESPONSE' };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private makeError(message: string, code: string, status?: number, responseBody?: unknown): SDKError {
    const err = new Error(message) as SDKError;
    err.name = 'HanjulloSDKError';
    err.code = code;
    if (status !== undefined) err.status = status;
    if (responseBody !== undefined) err.responseBody = responseBody;
    return err;
  }
}

// 기본 export — `import HanjulloSDK from '@hanjullo/sdk'`도 지원
export default HanjulloSDK;
