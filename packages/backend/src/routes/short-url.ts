/**
 * 단축 URL redirect 라우트 — D183 (2026-05-20)
 *
 * 🎯 목적
 *   SMS/카톡 수신자가 단축 URL 클릭 시:
 *   1) cdp_events 'message_click' 기록 (fire-and-forget — redirect 지연 0)
 *   2) short_urls.click_count 증가 (fire-and-forget)
 *   3) 원본 URL로 302 redirect
 *
 * ⛔ 영구 원칙
 *   - 공개 endpoint (인증 X) — 수신자가 한줄로 로그인 X 영역
 *   - hash 유효성 검증 후 fallback URL (hanjul.ai)로 redirect (방어 영역)
 */

import { Request, Response, Router } from 'express';
import { resolveShortUrl } from '../utils/short-url';
import { trackEvent } from '../utils/cdp-events';
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

    // cdp_events 'message_click' 기록 (fire-and-forget — 사용자 redirect 지연 0)
    const uaHash = req.headers['user-agent']
      ? Buffer.from(String(req.headers['user-agent'])).toString('base64').substring(0, 32)
      : `anon_${Date.now()}`;

    void trackEvent(resolved.companyId, {
      source: 'short_url_click',
      eventName: 'message_click',
      anonymousId: uaHash,
      properties: {
        campaign_id: resolved.campaignId,
        short_url_hash: hash,
        full_url: resolved.fullUrl,
        referer: req.headers['referer'] || null,
        ip: req.ip || req.headers['x-forwarded-for'] || null,
        user_agent: req.headers['user-agent'] || null,
      },
    }).catch((err) => {
      console.warn('[short-url] cdp_events 기록 실패:', err?.message);
    });

    // message_short_urls.click_count 증가 (fire-and-forget)
    // D183 정정: 한줄로 캠페인 전용 테이블 (한줄전단 short_urls와 분리)
    void query(`UPDATE message_short_urls SET click_count = click_count + 1 WHERE hash = $1`, [
      hash,
    ]).catch((err) => {
      console.warn('[short-url] click_count 증가 실패:', err?.message);
    });

    return res.redirect(302, resolved.fullUrl);
  } catch (err: any) {
    console.error('[short-url] redirect 오류:', err);
    return res.redirect(302, FALLBACK_URL);
  }
});

export default router;
