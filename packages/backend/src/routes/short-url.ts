/**
 * 단축 URL redirect 라우트 — D183 (2026-05-20) + D190 #1 강화 (2026-05-22)
 *
 * 🎯 목적
 *   SMS/카톡/알림톡 수신자가 단축 URL 클릭 시:
 *   1) cdp_events 'message_click' 기록 (fire-and-forget — redirect 지연 0)
 *   2) message_short_urls.click_count / last_clicked_at 갱신 (fire-and-forget)
 *   3) ★ D190 #1: variant_id 존재 시 Bandit reward 자동 누적 (recordJourneyStepVariantReward)
 *   4) ★ D190 #1: 한국 자사몰 도메인 인지 + external_id 추출 → cdp_identity_links 자동 매칭
 *   5) 원본 URL로 302 redirect (사용자 영향 0 — 모든 트래킹 비동기)
 *
 * ⛔ 영구 원칙
 *   - 공개 endpoint (인증 X) — 수신자가 한줄로 로그인 X 영역
 *   - hash 유효성 검증 후 fallback URL (hanjul.ai)로 redirect (방어 영역)
 *   - 모든 트래킹 실패 시 사용자 영향 0 (silent fail)
 *   - 한국 네이티브 최적화 — 한국 자사몰 5종 자동 인지 + CDP 매칭
 */

import { Request, Response, Router } from 'express';
import { resolveShortUrl } from '../utils/short-url';
import { trackEvent } from '../utils/cdp-events';
import { recordJourneyStepVariantReward } from '../utils/bandit-optimizer';
import { detectKoreanEcommerce, isMobileUserAgent } from '../utils/korean-ecommerce-domains';
import { identifyCustomer } from '../utils/cdp-identity';
import { query } from '../config/database';

const router = Router();

const FALLBACK_URL = process.env.SHORT_URL_FALLBACK || 'https://hanjul.ai';

router.get('/c/:hash', async (req: Request, res: Response) => {
  try {
    const { hash } = req.params;

    // hash 형식 검증 (base62, 1~12자)
    if (!hash || !/^[a-zA-Z0-9]{1,12}$/.test(hash)) {
      return res.redirect(302, FALLBACK_URL);
    }

    const resolved = await resolveShortUrl(hash);
    if (!resolved) {
      return res.redirect(302, FALLBACK_URL);
    }

    // ───────────────────────────────────────────────────────────
    // 즉시 302 redirect (사용자 경험 우선 — 트래킹은 모두 비동기)
    // ───────────────────────────────────────────────────────────
    res.redirect(302, resolved.fullUrl);

    // ───────────────────────────────────────────────────────────
    // 비동기 트래킹 (redirect 후 진입 — 사용자 영향 0)
    // ───────────────────────────────────────────────────────────

    const userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']) : '';
    const uaHash = userAgent
      ? Buffer.from(userAgent).toString('base64').substring(0, 32)
      : `anon_${Date.now()}`;
    const isMobile = isMobileUserAgent(userAgent);

    // ★ D190 #1: 한국 자사몰 도메인 인지 + external_id 추출
    const ecommerceDetection = detectKoreanEcommerce(resolved.fullUrl);
    const detectedExternalId = ecommerceDetection.externalId || resolved.externalId;

    // 1. cdp_events 'message_click' 기록 — 강화 properties
    void trackEvent(resolved.companyId, {
      source: 'short_url_click',
      eventName: 'message_click',
      externalId: detectedExternalId || undefined,
      anonymousId: detectedExternalId ? undefined : uaHash,
      properties: {
        campaign_id: resolved.campaignId,
        journey_id: resolved.journeyId,
        step_id: resolved.stepId,
        variant_id: resolved.variantId,
        customer_id: resolved.customerId,
        short_url_hash: hash,
        full_url: resolved.fullUrl,
        ecommerce_provider: ecommerceDetection.provider,
        is_korean_ecommerce: ecommerceDetection.isKoreanEcommerce,
        is_mobile: isMobile,
        referer: req.headers['referer'] || null,
        ip: req.ip || req.headers['x-forwarded-for'] || null,
        user_agent: userAgent || null,
      },
    }).catch((err) => {
      console.warn('[short-url] cdp_events 기록 실패:', err?.message);
    });

    // 2. message_short_urls.click_count + last_clicked_at 갱신
    void query(
      `UPDATE message_short_urls
       SET click_count = click_count + 1,
           last_clicked_at = NOW()
       WHERE hash = $1`,
      [hash],
    ).catch((err) => {
      console.warn('[short-url] click_count 갱신 실패:', err?.message);
    });

    // 3. ★ D190 #1: Bandit reward 자동 누적 (variant_id 존재 시)
    if (resolved.variantId) {
      void recordJourneyStepVariantReward(resolved.variantId, 0, 1, 0).catch((err) => {
        console.warn('[short-url] Bandit reward 누적 실패:', err?.message);
      });
    }

    // 4. ★ D190 #1: 한국 자사몰 자동 customer 매칭 (CDP identity link)
    if (ecommerceDetection.isKoreanEcommerce && detectedExternalId && !resolved.customerId) {
      void identifyCustomer(resolved.companyId, {
        source: ecommerceDetection.provider,
        externalId: detectedExternalId,
      }).catch((err) => {
        console.warn('[short-url] CDP 자동 매칭 실패:', err?.message);
      });
    }
  } catch (err: any) {
    console.error('[short-url] redirect 오류:', err);
    // 사용자 응답이 이미 진입된 경우 fallback redirect 시도
    if (!res.headersSent) {
      return res.redirect(302, FALLBACK_URL);
    }
  }
});

export default router;
