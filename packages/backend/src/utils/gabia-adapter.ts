/**
 * ★ 가비아 Provider 어댑터 — 2026-06-25 (gap 3)
 *   가비아 쇼핑몰은 전용 백엔드 없이 자체 호스팅 webhook 방식과 동일하게 동작.
 *   서명검증/이벤트처리를 customSelfHostedAdapter에 위임(중복 구현 금지 — no_inline_duplication).
 */
import { IProviderAdapter, ProviderCapabilities, ProviderTokenResponse } from './provider-registry';
import { customSelfHostedAdapter } from './custom-self-hosted-adapter';

const gabiaCapabilities: ProviderCapabilities = {
  oauth: false, webhook: true, webhookSignatureVerification: true, adminApi: false,
};

export const gabiaAdapter: IProviderAdapter = {
  provider: 'gabia',
  displayName: '가비아',
  capabilities: gabiaCapabilities,
  connectMethod: 'webhook',
  available: true,

  buildAuthorizeUrl(): string {
    throw new Error('가비아는 OAuth가 없습니다. 한줄로 관리자 → 자사몰 연동(CDP)에서 webhook_secret을 발급받아 설정해주세요.');
  },
  async exchangeCode(): Promise<ProviderTokenResponse> {
    throw new Error('가비아는 OAuth code 교환이 없습니다(webhook 방식).');
  },
  async refreshToken(): Promise<ProviderTokenResponse> {
    throw new Error('가비아는 token refresh가 없습니다(webhook 방식).');
  },
  verifyWebhookSignature(rawBody, signature, secret): boolean {
    return customSelfHostedAdapter.verifyWebhookSignature(rawBody, signature, secret);
  },
  async processWebhookEvent(companyId, event, resource): Promise<void> {
    return customSelfHostedAdapter.processWebhookEvent(companyId, event, resource);
  },
  extractMallIdFromWebhook(headers, body) {
    return customSelfHostedAdapter.extractMallIdFromWebhook(headers, body);
  },
  extractEventFromWebhook(headers, body) {
    return customSelfHostedAdapter.extractEventFromWebhook(headers, body);
  },
  buildIdempotencyKey(event, resource, body) {
    return customSelfHostedAdapter.buildIdempotencyKey(event, resource, body);
  },
};
