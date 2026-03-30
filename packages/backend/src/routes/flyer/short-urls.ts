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
import { renderProductImage, resolveProductImageUrl } from '../../utils/product-images';

const router = Router();

/**
 * 공개 페이지용 — 상대경로 이미지 URL을 절대 URL로 변환
 * hanjul-flyer.kr에서 렌더링되는 HTML이므로, /api/flyer/... 상대경로는
 * 해당 도메인에서 해석 불가 → 절대 URL 변환 필요
 *
 * 해결 방법 (택 1):
 *   1. 환경변수 FLYER_API_BASE_URL 설정 (예: https://hanjul-flyer.com)
 *   2. Nginx에서 hanjul-flyer.kr의 /api/flyer/ → 백엔드 프록시 추가
 */
function toAbsoluteImageUrl(url: string | null): string | null {
  if (!url || url.startsWith('http')) return url;
  const base = process.env.FLYER_API_BASE_URL || '';
  return base ? base + url : url;
}

// ============================================================
// GET /:code — 전단지 공개 페이지 렌더링 + 클릭 로그
// ============================================================
router.get('/:code', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;

    // 단축URL + 전단지 조인 조회
    const result = await query(
      `SELECT f.*, su.id as short_url_id, su.expires_at
       FROM short_urls su
       JOIN flyers f ON f.id = su.flyer_id
       WHERE su.code = $1`,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(renderErrorPage('전단지를 찾을 수 없습니다.'));
    }

    const flyer = result.rows[0];

    // 만료 체크
    if (flyer.expires_at && new Date(flyer.expires_at) < new Date()) {
      return res.status(410).send(renderErrorPage('이 전단지는 기간이 만료되었습니다.'));
    }

    // 클릭 로그 기록 (비동기 — 페이지 렌더링 차단하지 않음)
    const ip = req.ip || req.socket.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;
    query(
      'INSERT INTO url_clicks (short_url_id, ip, user_agent) VALUES ($1, $2, $3)',
      [flyer.short_url_id, ip, userAgent]
    ).catch(err => console.error('[전단AI] 클릭 로그 실패:', err.message));

    // 전단지 페이지 렌더링
    const html = renderFlyerPage(flyer);
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
// 전단지 렌더링 — 템플릿별 분기
// ============================================================
function renderFlyerPage(flyer: any): string {
  const categories = typeof flyer.categories === 'string' ? JSON.parse(flyer.categories) : (flyer.categories || []);
  const storeName = flyer.store_name || '';
  const title = flyer.title || '';
  const periodStart = flyer.period_start ? formatDate(flyer.period_start) : '';
  const periodEnd = flyer.period_end ? formatDate(flyer.period_end) : '';
  const period = periodStart && periodEnd ? `${periodStart} ~ ${periodEnd}` : (periodStart || periodEnd || '');

  switch (flyer.template) {
    case 'list':
      return renderListTemplate(storeName, title, period, categories);
    case 'highlight':
      return renderHighlightTemplate(storeName, title, period, categories);
    case 'grid':
    default:
      return renderGridTemplate(storeName, title, period, categories);
  }
}

function formatDate(d: string | Date): string {
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatPrice(price: number): string {
  return price.toLocaleString();
}

// 상품 이미지/이모지 매핑: utils/product-images.ts 컨트롤타워 사용
// (기존 EMOJI_MAP 인라인 삭제 → 컨트롤타워로 통합)

// ============================================================
// 템플릿 1: 그리드형 (빨간 테마)
// ============================================================
function renderGridTemplate(storeName: string, title: string, period: string, categories: any[]): string {
  let itemsHtml = '';
  for (const cat of categories) {
    itemsHtml += `<div class="cat-title">${escapeHtml(cat.name || '')}</div><div class="grid">`;
    for (const item of (cat.items || [])) {
      const generatedUrl = toAbsoluteImageUrl(resolveProductImageUrl(item.name || ''));
      const productImg = renderProductImage(item.name || '', 48, generatedUrl || undefined);
      const discount = item.originalPrice && item.originalPrice > 0
        ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
      itemsHtml += `<div class="card">
        <div class="product-visual">${productImg}</div>
        <div class="name">${escapeHtml(item.name || '')}</div>
        ${item.originalPrice ? `<div class="orig">₩${formatPrice(item.originalPrice)}</div>` : ''}
        <div class="price">₩${formatPrice(item.salePrice || 0)}</div>
        ${discount > 0 ? `<div class="badge">${discount}%</div>` : ''}
        ${item.badge ? `<div class="tag">${escapeHtml(item.badge)}</div>` : ''}
      </div>`;
    }
    itemsHtml += '</div>';
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>${escapeHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Noto Sans KR', sans-serif; background: #f5f5f5; color: #222; -webkit-font-smoothing: antialiased; }
  .hero { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: #fff; text-align: center; padding: 28px 16px 22px; }
  .hero .store-name { font-size: 13px; font-weight: 500; letter-spacing: 2px; opacity: 0.9; margin-bottom: 6px; }
  .hero h1 { font-size: 24px; font-weight: 900; line-height: 1.3; }
  .hero .period { margin-top: 10px; font-size: 13px; font-weight: 500; background: rgba(255,255,255,0.2); display: inline-block; padding: 4px 14px; border-radius: 20px; }
  .content { padding: 16px; max-width: 480px; margin: 0 auto; }
  .cat-title { font-size: 16px; font-weight: 800; color: #c0392b; margin: 20px 0 10px; padding-left: 4px; border-left: 4px solid #e74c3c; padding-left: 10px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .card { background: #fff; border-radius: 12px; padding: 14px; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,0.06); position: relative; }
  .card .product-visual { margin-bottom: 6px; display: flex; justify-content: center; align-items: center; min-height: 48px; }
  .card .product-visual img { width: 48px; height: 48px; object-fit: cover; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .card .name { font-size: 13px; font-weight: 600; margin-bottom: 4px; line-height: 1.3; }
  .card .orig { font-size: 11px; color: #999; text-decoration: line-through; }
  .card .price { font-size: 18px; font-weight: 900; color: #e74c3c; }
  .card .badge { position: absolute; top: 8px; right: 8px; background: #e74c3c; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 8px; }
  .card .tag { margin-top: 4px; font-size: 10px; color: #e74c3c; font-weight: 600; background: #fff5f5; padding: 2px 6px; border-radius: 4px; display: inline-block; }
  .footer { text-align: center; padding: 20px 16px 30px; color: #999; font-size: 11px; }
</style>
</head>
<body>
<div class="hero">
  <div class="store-name">${escapeHtml(storeName)}</div>
  <h1>${escapeHtml(title)}</h1>
  ${period ? `<div class="period">${escapeHtml(period)}</div>` : ''}
</div>
<div class="content">${itemsHtml}</div>
<div class="footer">hanjul-flyer.kr</div>
</body>
</html>`;
}

// ============================================================
// 템플릿 2: 리스트형 (블랙+골드 프리미엄)
// ============================================================
function renderListTemplate(storeName: string, title: string, period: string, categories: any[]): string {
  let itemsHtml = '';
  for (const cat of categories) {
    itemsHtml += `<div class="cat-section"><div class="cat-title">${escapeHtml(cat.name || '')}</div>`;
    for (const item of (cat.items || [])) {
      const listGenUrl = toAbsoluteImageUrl(resolveProductImageUrl(item.name || ''));
      const productImg = renderProductImage(item.name || '', 40, listGenUrl || undefined);
      itemsHtml += `<div class="item">
        <div class="item-visual">${productImg}</div>
        <div class="info">
          <div class="name">${escapeHtml(item.name || '')} ${item.badge ? `<span class="tag">${escapeHtml(item.badge)}</span>` : ''}</div>
          ${item.originalPrice ? `<span class="orig">₩${formatPrice(item.originalPrice)}</span>` : ''}
        </div>
        <div class="price">₩${formatPrice(item.salePrice || 0)}</div>
      </div>`;
    }
    itemsHtml += '</div>';
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>${escapeHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Noto Sans KR', sans-serif; background: #111; color: #fff; -webkit-font-smoothing: antialiased; }
  .hero { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); text-align: center; padding: 28px 16px 22px; border-bottom: 2px solid #d4a844; }
  .hero .store-name { font-size: 13px; font-weight: 500; letter-spacing: 3px; color: #d4a844; margin-bottom: 6px; }
  .hero h1 { font-size: 24px; font-weight: 900; color: #fff; }
  .hero .period { margin-top: 10px; font-size: 12px; color: #aaa; }
  .content { padding: 0 16px 20px; max-width: 480px; margin: 0 auto; }
  .cat-section { margin-top: 16px; }
  .cat-title { font-size: 14px; font-weight: 700; color: #d4a844; padding: 10px 0; border-bottom: 1px solid #333; }
  .item { display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid #222; }
  .item .item-visual { margin-right: 12px; flex-shrink: 0; display: flex; align-items: center; }
  .item .item-visual img { width: 40px; height: 40px; object-fit: cover; border-radius: 8px; }
  .item .info { flex: 1; }
  .item .name { font-size: 14px; font-weight: 600; }
  .item .orig { font-size: 11px; color: #666; text-decoration: line-through; }
  .item .price { font-size: 17px; font-weight: 900; color: #d4a844; flex-shrink: 0; }
  .item .tag { font-size: 10px; color: #e74c3c; background: rgba(231,76,60,0.15); padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
  .footer { text-align: center; padding: 20px 16px 30px; color: #555; font-size: 11px; }
</style>
</head>
<body>
<div class="hero">
  <div class="store-name">${escapeHtml(storeName)}</div>
  <h1>${escapeHtml(title)}</h1>
  ${period ? `<div class="period">${escapeHtml(period)}</div>` : ''}
</div>
<div class="content">${itemsHtml}</div>
<div class="footer">hanjul-flyer.kr</div>
</body>
</html>`;
}

// ============================================================
// 템플릿 3: 특가 하이라이트형 (다크 모드, TODAY'S PICK)
// ============================================================
function renderHighlightTemplate(storeName: string, title: string, period: string, categories: any[]): string {
  // 할인율 높은 4개 자동 선정 (TODAY'S PICK)
  const allItems: any[] = [];
  for (const cat of categories) {
    for (const item of (cat.items || [])) {
      if (item.originalPrice && item.originalPrice > 0) {
        const discount = Math.round((1 - item.salePrice / item.originalPrice) * 100);
        allItems.push({ ...item, discount });
      }
    }
  }
  allItems.sort((a, b) => b.discount - a.discount);
  const picks = allItems.slice(0, 4);

  let picksHtml = '';
  if (picks.length > 0) {
    picksHtml = `<div class="picks-title">TODAY'S PICK</div><div class="picks-grid">`;
    for (const p of picks) {
      const pickGenUrl = toAbsoluteImageUrl(resolveProductImageUrl(p.name || ''));
      const pickImg = renderProductImage(p.name || '', 56, pickGenUrl || undefined);
      picksHtml += `<div class="pick-card">
        <div class="discount-badge">${p.discount}% OFF</div>
        <div class="pick-visual">${pickImg}</div>
        <div class="name">${escapeHtml(p.name || '')}</div>
        <div class="orig">₩${formatPrice(p.originalPrice)}</div>
        <div class="price">₩${formatPrice(p.salePrice || 0)}</div>
      </div>`;
    }
    picksHtml += '</div>';
  }

  let itemsHtml = '';
  for (const cat of categories) {
    itemsHtml += `<div class="cat-title">${escapeHtml(cat.name || '')}</div>`;
    for (const item of (cat.items || [])) {
      const rowGenUrl = toAbsoluteImageUrl(resolveProductImageUrl(item.name || ''));
      const rowImg = renderProductImage(item.name || '', 32, rowGenUrl || undefined);
      itemsHtml += `<div class="item-row">
        <div class="row-visual">${rowImg}</div>
        <span class="name">${escapeHtml(item.name || '')}</span>
        <span class="price">₩${formatPrice(item.salePrice || 0)}</span>
      </div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>${escapeHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Noto Sans KR', sans-serif; background: #0d1117; color: #e6edf3; -webkit-font-smoothing: antialiased; }
  .hero { background: linear-gradient(135deg, #ff6b35 0%, #e74c3c 100%); text-align: center; padding: 28px 16px 22px; }
  .hero .store-name { font-size: 13px; letter-spacing: 2px; opacity: 0.9; margin-bottom: 6px; }
  .hero h1 { font-size: 24px; font-weight: 900; }
  .hero .period { margin-top: 10px; font-size: 12px; opacity: 0.85; }
  .content { padding: 16px; max-width: 480px; margin: 0 auto; }
  .picks-title { font-size: 18px; font-weight: 900; color: #ff6b35; text-align: center; margin: 16px 0 12px; letter-spacing: 2px; }
  .picks-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
  .pick-card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 14px; text-align: center; position: relative; }
  .pick-card .discount-badge { position: absolute; top: 8px; left: 8px; background: #ff6b35; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 8px; }
  .pick-card .pick-visual { margin: 8px 0 6px; display: flex; justify-content: center; }
  .pick-card .pick-visual img { width: 56px; height: 56px; object-fit: cover; border-radius: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); }
  .pick-card .name { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
  .pick-card .orig { font-size: 11px; color: #666; text-decoration: line-through; }
  .pick-card .price { font-size: 18px; font-weight: 900; color: #ff6b35; }
  .cat-title { font-size: 14px; font-weight: 700; color: #ff6b35; padding: 12px 0 8px; border-bottom: 1px solid #21262d; margin-top: 8px; }
  .item-row { display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid #161b22; }
  .item-row .row-visual { margin-right: 10px; flex-shrink: 0; display: flex; align-items: center; }
  .item-row .row-visual img { width: 32px; height: 32px; object-fit: cover; border-radius: 6px; }
  .item-row .name { flex: 1; font-size: 14px; }
  .item-row .price { font-size: 15px; font-weight: 700; color: #ff6b35; }
  .footer { text-align: center; padding: 20px 16px 30px; color: #484f58; font-size: 11px; }
</style>
</head>
<body>
<div class="hero">
  <div class="store-name">${escapeHtml(storeName)}</div>
  <h1>${escapeHtml(title)}</h1>
  ${period ? `<div class="period">${escapeHtml(period)}</div>` : ''}
</div>
<div class="content">
  ${picksHtml}
  ${itemsHtml}
</div>
<div class="footer">hanjul-flyer.kr</div>
</body>
</html>`;
}

export default router;
