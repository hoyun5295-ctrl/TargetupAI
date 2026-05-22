/**
 * @hanjullo/sdk — Journey Step A/B/Bandit 트래킹 모듈 (D189 #4, 2026-05-22)
 *
 * Journey의 step별 variant (A/B/C) 클릭/전환 트래킹 endpoint 호출.
 * 백엔드 Bandit Thompson Sampling이 누적 결과로 다음 발송 시 최선 variant 자동 선택.
 *
 * 사용:
 *   import { HanjulloSDK } from '@hanjullo/sdk';
 *   const hanjullo = new HanjulloSDK({ apiKey: 'hjl_...', secret: 'sk_...' });
 *
 *   // 클릭 트래킹 — Journey 메시지의 단축 URL 클릭 시
 *   await hanjullo.journeyVariants.trackClick('variant-uuid-123');
 *
 *   // 전환 트래킹 — 자사몰 구매 확정 시
 *   await hanjullo.journeyVariants.trackConversion('variant-uuid-123', {
 *     externalId: 'user_123',
 *   });
 *
 * 백엔드 endpoint:
 *   POST /api/cdp/journey-variants/:variantId/track
 *   - 인증: X-Hanjullo-Key + X-Hanjullo-Secret (CDP secret)
 *   - body: { clicked: 0|1, converted: 0|1, externalId?, anonymousId? }
 *   - 회사 격리 (variant → step → journey → company_id 검증)
 */

import type { VariantTrackParams, VariantTrackResponse, HanjulloSDKConfig } from './types';

export class HanjulloJourneyVariantsModule {
  constructor(
    private readonly apiKey: string,
    private readonly secret: string,
    private readonly endpoint: string,
  ) {}

  /**
   * 클릭 트래킹 — Bandit click_count + arm_alpha 누적.
   * Journey 메시지 본문의 단축 URL 클릭 시 자사몰 SDK 호출.
   */
  async trackClick(variantId: string, params: VariantTrackParams = {}): Promise<VariantTrackResponse> {
    return this.post(variantId, { clicked: 1, converted: 0, ...this.cleanParams(params) });
  }

  /**
   * 전환 트래킹 — Bandit conversion_count + reward 누적.
   * 자사몰 구매 확정 시 SDK 호출 (reward_total += 3 가중 적용).
   */
  async trackConversion(variantId: string, params: VariantTrackParams = {}): Promise<VariantTrackResponse> {
    return this.post(variantId, { clicked: 0, converted: 1, ...this.cleanParams(params) });
  }

  private cleanParams(params: VariantTrackParams): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (params.externalId) out.external_id = params.externalId;
    if (params.anonymousId) out.anonymous_id = params.anonymousId;
    return out;
  }

  private async post(variantId: string, body: Record<string, unknown>): Promise<VariantTrackResponse> {
    if (!variantId) {
      return { success: false, error: 'variantId는 필수입니다.' };
    }
    try {
      const res = await fetch(`${this.endpoint}/journey-variants/${encodeURIComponent(variantId)}/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hanjullo-Key': this.apiKey,
          'X-Hanjullo-Secret': this.secret,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        return { success: false, error: data?.error || `track 처리 실패 (HTTP ${res.status})` };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || '네트워크 오류' };
    }
  }
}

// HanjulloSDKConfig 타입 참조 보존 (push.ts 패턴 정합)
void undefined as unknown as HanjulloSDKConfig;
