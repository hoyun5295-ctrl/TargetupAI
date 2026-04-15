/**
 * ★ 전단AI: 단축URL 리다이렉트 + 전단지 공개 페이지 렌더링
 *
 * 마운트: /api/flyer/p (공개 — 인증 불필요)
 * - GET /api/flyer/p/:code — 전단지 공개 페이지 렌더링 (hanjul-flyer.kr/:code 에서 프록시)
 *
 * ⚠️ 이 라우트는 인증 없이 공개 접근 가능 (고객이 SMS 링크로 접근)
 */

import { Request, Response, Router } from 'express';
import { query } from '../../config/database';
import { renderTemplate } from '../../utils/flyer/product/flyer-templates';
import { getDmByCode, trackDmView } from '../../utils/dm/dm-builder';
import { renderDmViewerHtml, renderDmErrorHtml } from '../../utils/dm/dm-viewer';

const router = Router();

// ============================================================
// GET /dm-:code — 모바일 DM 공개 뷰어 (hanjul-flyer.kr/dm-코드)
// ★ 전단 /:code 보다 먼저 등록하여 dm- prefix 우선 매칭
// ============================================================
router.get('/dm-:code', async (req: Request, res: Response) => {
  try {
    const dm = await getDmByCode(req.params.code);
    if (!dm) return res.status(404).send(renderDmErrorHtml('존재하지 않는 DM입니다.'));

    const phone = (req.query.p as string) || null;
    const pages = Array.isArray(dm.pages) ? dm.pages : JSON.parse(dm.pages || '[]');
    const ip = req.ip || req.socket?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;
    trackDmView(dm.id, dm.company_id, phone, 1, pages.length, 0, ip, ua).catch(() => {});

    const html = renderDmViewerHtml(dm, '/api/flyer/p');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    console.error('[DM뷰어] 오류:', err.message);
    res.status(500).send(renderDmErrorHtml('일시적 오류가 발생했습니다.'));
  }
});

// DM 열람 추적 (공개)
router.post('/dm-:code/track', async (req: Request, res: Response) => {
  try {
    const dm = await getDmByCode(req.params.code);
    if (!dm) return res.status(404).json({ error: 'Not found' });
    const { phone, page_reached, total_pages, duration } = req.body;
    const ip = req.ip || req.socket?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;
    await trackDmView(dm.id, dm.company_id, phone || null, page_reached || 1, total_pages || 0, duration || 0, ip, ua);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[DM추적] 오류:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// DM 이미지 서빙 (공개)
router.get('/dm-images/:companyId/:filename', (req: Request, res: Response) => {
  const path_ = require('path');
  const fs_ = require('fs');
  const filePath = path_.join(process.cwd(), 'uploads', 'dm-images', req.params.companyId, req.params.filename);
  if (!fs_.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// ============================================================
// GET /:code — 전단지 공개 페이지 렌더링 + 클릭 로그
// ============================================================
router.get('/:code', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;

    // 단축URL + 전단지 조인 조회
    const result = await query(
      `SELECT f.*,
              TO_CHAR(f.period_start, 'YYYY-MM-DD') as period_start,
              TO_CHAR(f.period_end, 'YYYY-MM-DD') as period_end,
              su.id as short_url_id, su.expires_at,
              su.phone as tracking_phone, su.url_type, su.campaign_id as tracking_campaign_id
       FROM short_urls su
       JOIN flyers f ON f.id = su.flyer_id
       WHERE su.code = $1`,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(renderErrorPage('전단지를 찾을 수 없습니다.'));
    }

    const flyer = result.rows[0];

    // 만료 체크 — 단축URL 90일 만료
    if (flyer.expires_at && new Date(flyer.expires_at) < new Date()) {
      return res.status(410).send(renderErrorPage('이 전단지는 기간이 만료되었습니다.'));
    }

    // ★ 행사 기간 종료 체크 — period_end가 지나면 "행사 종료" 안내
    // TO_CHAR로 YYYY-MM-DD 문자열 반환이므로 단순 문자열 비교
    if (flyer.period_end) {
      const endDate = String(flyer.period_end).trim().slice(0, 10);
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (endDate < todayStr) {
        return res.status(410).send(renderExpiredPage(flyer.store_name || '', flyer.title || '', endDate));
      }
    }

    // ★ Phase 1: 클릭 로그에 phone 포함 (tracking URL이면 수신자 식별 가능)
    const ip = req.ip || req.socket.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;
    const trackingPhone = flyer.tracking_phone || null;
    query(
      'INSERT INTO url_clicks (short_url_id, ip, user_agent, phone) VALUES ($1, $2, $3, $4)',
      [flyer.short_url_id, ip, userAgent, trackingPhone]
    ).catch(err => console.error('[전단AI] 클릭 로그 실패:', err.message));

    // ★ Phase 3: tracking URL이면 phone을 뷰어 컨텍스트에 전달 (장바구니 식별용)
    const html = await renderFlyerPage(flyer, trackingPhone);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    console.error('[전단AI] 공개 페이지 렌더링 실패:', err.message);
    res.status(500).send(renderErrorPage('페이지를 불러올 수 없습니다.'));
  }
});

// ============================================================
// 에러 페이지
// ============================================================
function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>전단AI</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Noto Sans KR', sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .msg { text-align: center; padding: 40px; }
  .msg h1 { font-size: 20px; color: #666; margin-bottom: 8px; }
  .msg p { font-size: 14px; color: #999; }
</style>
</head>
<body><div class="msg"><h1>${message}</h1><p>hanjul-flyer.kr</p></div></body>
</html>`;
}

// ============================================================
// 행사 종료 안내 페이지
// ============================================================
function renderExpiredPage(storeName: string, title: string, endDate: string): string {
  const [, m, d] = endDate.split('-').map(Number);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>행사 종료 — ${escapeHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Noto Sans KR',sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{text-align:center;padding:48px 32px;background:#fff;border-radius:20px;box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:360px;width:90%}
  .icon{font-size:48px;margin-bottom:16px}
  .store{font-size:12px;color:#999;letter-spacing:2px;margin-bottom:8px}
  .title{font-size:18px;font-weight:700;color:#333;margin-bottom:8px}
  .msg{font-size:14px;color:#888;line-height:1.6;margin-bottom:4px}
  .date{font-size:13px;color:#aaa;margin-top:12px}
  .footer{margin-top:24px;font-size:11px;color:#ccc}
</style>
</head>
<body>
<div class="card">
  <div class="icon">📋</div>
  ${storeName ? `<div class="store">${escapeHtml(storeName)}</div>` : ''}
  <div class="title">${escapeHtml(title)}</div>
  <p class="msg">이 행사는 종료되었습니다.</p>
  <p class="msg">다음 행사를 기대해주세요!</p>
  <p class="date">행사 기간: ~ ${m}/${d}</p>
  <div class="footer">hanjul-flyer.kr</div>
</div>
</body>
</html>`;
}

// ============================================================
// 전단지 렌더링 — CT-F14 컨트롤타워 위임
// ============================================================
export async function renderFlyerPage(flyer: any, trackingPhone?: string | null): Promise<string> {
  const categories = typeof flyer.categories === 'string' ? JSON.parse(flyer.categories) : (flyer.categories || []);
  const storeName = flyer.store_name || '';
  const title = flyer.title || '';
  const periodStart = flyer.period_start ? formatDate(flyer.period_start) : '';
  const periodEnd = flyer.period_end ? formatDate(flyer.period_end) : '';
  const period = periodStart && periodEnd ? `${periodStart} ~ ${periodEnd}` : (periodStart || periodEnd || '');

  // QR 쿠폰 연결 확인
  let qrCodeDataUrl: string | undefined;
  let qrCouponText: string | undefined;
  try {
    const couponResult = await query(
      `SELECT qr_data_url, coupon_name, discount_value, coupon_type, discount_description
       FROM flyer_coupon_campaigns
       WHERE flyer_id = $1 AND status = 'active'
       LIMIT 1`,
      [flyer.id]
    );
    if (couponResult.rows.length > 0) {
      const c = couponResult.rows[0];
      qrCodeDataUrl = c.qr_data_url;
      qrCouponText = c.discount_description
        || (c.coupon_type === 'percent' ? `스캔하고 ${c.discount_value}% 할인!` : `스캔하고 ${Number(c.discount_value).toLocaleString()}원 할인!`);
    }
  } catch {}

  // extra_data 파싱 (외부링크/공지/GIF)
  const extraData = typeof flyer.extra_data === 'string'
    ? JSON.parse(flyer.extra_data || '{}')
    : (flyer.extra_data || {});

  return renderTemplate(flyer.template || 'grid', {
    storeName, title, period, categories, qrCodeDataUrl, qrCouponText,
    externalLinks: extraData.externalLinks,
    announcements: extraData.announcements,
    bannerGifUrl: extraData.bannerGifUrl,
    trackingPhone: trackingPhone || undefined,
    flyerId: flyer.id,
    companyId: flyer.company_id,
  });
}

function formatDate(d: string | Date): string {
  // ★ D100: 순수 YYYY-MM-DD는 직접 파싱 (new Date() UTC 변환 → 하루 밀림 방지)
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
    const [, m, day] = d.trim().split('-').map(Number);
    return `${m}/${day}`;
  }
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default router;
