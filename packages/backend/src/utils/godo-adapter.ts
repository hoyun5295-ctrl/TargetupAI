/**
 * ★ 고도몰(NHN커머스) Provider 어댑터 — 2026-06-25 (gap 3)
 *   고도몰은 쇼핑몰 인증키 기반 폴링 연동(/api/godo). 본 어댑터는 UI 노출·메타·registry 등록용.
 *   OAuth/webhook 경로는 없으므로 안내 throw. 실제 연동은 routes/godo.ts + godo-client.ts.
 */
import {
  IProviderAdapter, ProviderCapabilities, ProviderTokenResponse, ProviderIntegration,
} from './provider-registry';

const godoCapabilities: ProviderCapabilities = {
  oauth: false, webhook: false, webhookSignatureVerification: false, adminApi: true,
};

export const godoAdapter: IProviderAdapter = {
  provider: 'godo',
  displayName: '고도몰',
  capabilities: godoCapabilities,
  connectMethod: 'polling',
  available: true,

  buildAuthorizeUrl(): string {
    throw new Error('고도몰은 폴링 연동입니다. 한줄로 관리자 → 자사몰 연동(CDP)에서 쇼핑몰 인증키를 입력해주세요. (/api/godo)');
  },
  async exchangeCode(): Promise<ProviderTokenResponse> {
    throw new Error('고도몰은 OAuth code 교환이 없습니다. 쇼핑몰 인증키 폴링 방식입니다.');
  },
  async refreshToken(_i: ProviderIntegration): Promise<ProviderTokenResponse> {
    throw new Error('고도몰은 token refresh가 없습니다. 쇼핑몰 인증키 폴링 방식입니다.');
  },
  verifyWebhookSignature(): boolean { return false; },
  async processWebhookEvent(): Promise<void> {
    throw new Error('고도몰은 webhook을 사용하지 않습니다(폴링). /api/godo 사용.');
  },
  extractMallIdFromWebhook(): string | null { return null; },
  extractEventFromWebhook(): string | null { return null; },
  buildIdempotencyKey(event: string): string { return `${event}:godo:polling`; },
};
