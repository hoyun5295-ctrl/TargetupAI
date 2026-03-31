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

    // 만료 체크 — 단축URL 90일 만료
    if (flyer.expires_at && new Date(flyer.expires_at) < new Date()) {
      return res.status(410).send(renderErrorPage('이 전단지는 기간이 만료되었습니다.'));
    }

    // ★ 행사 기간 종료 체크 — period_end가 지나면 "행사 종료" 안내
    if (flyer.period_end) {
      const periodEndStr = typeof flyer.period_end === 'string' ? flyer.period_end : flyer.period_end.toISOString();
      // YYYY-MM-DD 형식에서 날짜만 비교 (시간 무시)
      const endDate = periodEndStr.slice(0, 10);
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (endDate < todayStr) {
        return res.status(410).send(renderExpiredPage(flyer.store_name || '', flyer.title || '', endDate));
      }
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

function formatPrice(price: number): string {
  return price.toLocaleString();
}

// 상품 이미지/이모지 매핑: utils/product-images.ts 컨트롤타워 사용
// (기존 EMOJI_MAP 인라인 삭제 → 컨트롤타워로 통합)

// ============================================================
// 템플릿 1: 그리드형 (마트 전단지 — 빨간 테마, 대형 이미지 카드)
// ============================================================
function renderGridTemplate(storeName: string, title: string, period: string, categories: any[]): string {
  let itemsHtml = '';
  for (const cat of categories) {
    itemsHtml += `<div class="cat-title"><span class="cat-bar"></span>${escapeHtml(cat.name || '')}</div><div class="grid">`;
    for (const item of (cat.items || [])) {
      const imgUrl = toAbsoluteImageUrl(item.imageUrl || resolveProductImageUrl(item.name || ''));
      const productImg = renderProductImage(item.name || '', 120, imgUrl || undefined);
      const discount = item.originalPrice && item.originalPrice > 0
        ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
      itemsHtml += `<div class="card">
        ${discount > 0 ? `<div class="badge">${discount}%</div>` : ''}
        <div class="card-img">${productImg}</div>
        <div class="card-body">
          <div class="name">${escapeHtml(item.name || '')}</div>
          <div class="price-row">
            ${item.originalPrice ? `<span class="orig">${formatPrice(item.originalPrice)}</span>` : ''}
            <span class="price">₩${formatPrice(item.salePrice || 0)}</span>
          </div>
          ${item.badge ? `<div class="tag">${escapeHtml(item.badge)}</div>` : ''}
        </div>
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
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Noto Sans KR',sans-serif;background:#f2f2f2;color:#222;-webkit-font-smoothing:antialiased}
  .hero{background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);color:#fff;text-align:center;padding:32px 16px 26px;position:relative;overflow:hidden}
  .hero::after{content:'';position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);width:140%;height:40px;background:#f2f2f2;border-radius:50% 50% 0 0}
  .hero .store{font-size:12px;font-weight:500;letter-spacing:3px;text-transform:uppercase;opacity:.85;margin-bottom:8px}
  .hero h1{font-size:22px;font-weight:900;line-height:1.35;text-shadow:0 2px 8px rgba(0,0,0,.15)}
  .hero .period{margin-top:12px;font-size:12px;font-weight:600;background:rgba(255,255,255,.2);backdrop-filter:blur(4px);display:inline-block;padding:5px 16px;border-radius:20px}
  .content{padding:12px 14px 20px;max-width:480px;margin:0 auto}
  .cat-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;color:#b91c1c;margin:18px 0 10px}
  .cat-bar{width:4px;height:18px;background:linear-gradient(180deg,#dc2626,#f97316);border-radius:2px;flex-shrink:0}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);position:relative;transition:transform .15s}
  .card-img{width:100%;height:120px;overflow:hidden;background:#f8f8f8;display:flex;align-items:center;justify-content:center}
  .card-img .product-img{width:100%;height:120px;object-fit:cover}
  .card-img .emoji-area{width:100%;height:120px;display:flex;align-items:center;justify-content:center;font-size:48px;background:linear-gradient(135deg,#fff5f5,#fef2f2)}
  .card-body{padding:10px 12px 12px}
  .card .name{font-size:13px;font-weight:700;line-height:1.35;margin-bottom:6px;color:#222}
  .card .price-row{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
  .card .orig{font-size:11px;color:#aaa;text-decoration:line-through}
  .card .price{font-size:19px;font-weight:900;color:#dc2626}
  .card .badge{position:absolute;top:8px;left:8px;background:linear-gradient(135deg,#dc2626,#ea580c);color:#fff;font-size:11px;font-weight:800;padding:3px 8px;border-radius:8px;z-index:1;box-shadow:0 2px 4px rgba(220,38,38,.3)}
  .card .tag{margin-top:6px;font-size:10px;color:#dc2626;font-weight:700;background:#fef2f2;padding:3px 8px;border-radius:6px;display:inline-block;border:1px solid #fecaca}
  .footer{text-align:center;padding:24px 16px 32px;color:#bbb;font-size:11px}
</style>
</head>
<body>
<div class="hero">
  <div class="store">${escapeHtml(storeName)}</div>
  <h1>${escapeHtml(title)}</h1>
  ${period ? `<div class="period">${escapeHtml(period)}</div>` : ''}
</div>
<div class="content">${itemsHtml}</div>
<div class="footer">hanjul-flyer.kr</div>
</body>
</html>`;
}

// ============================================================
// 템플릿 2: 리스트형 (깔끔 모던 — 밝은 톤, 딥블루 강조)
// ============================================================
function renderListTemplate(storeName: string, title: string, period: string, categories: any[]): string {
  let itemsHtml = '';
  for (const cat of categories) {
    itemsHtml += `<div class="cat-section"><div class="cat-tag">${escapeHtml(cat.name || '')}</div>`;
    for (const item of (cat.items || [])) {
      const imgUrl = toAbsoluteImageUrl(item.imageUrl || resolveProductImageUrl(item.name || ''));
      const productImg = renderProductImage(item.name || '', 72, imgUrl || undefined);
      const discount = item.originalPrice && item.originalPrice > 0
        ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
      itemsHtml += `<div class="item">
        <div class="item-img">${productImg}</div>
        <div class="item-info">
          <div class="name">${escapeHtml(item.name || '')}</div>
          ${item.badge ? `<span class="tag">${escapeHtml(item.badge)}</span>` : ''}
          <div class="price-row">
            ${item.originalPrice ? `<span class="orig">₩${formatPrice(item.originalPrice)}</span>` : ''}
            <span class="price">₩${formatPrice(item.salePrice || 0)}</span>
          </div>
        </div>
        ${discount > 0 ? `<div class="discount">${discount}%</div>` : ''}
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
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Noto Sans KR',sans-serif;background:#f8f9fa;color:#1a1a1a;-webkit-font-smoothing:antialiased}
  .hero{background:linear-gradient(135deg,#1e40af 0%,#1d4ed8 50%,#2563eb 100%);color:#fff;text-align:center;padding:32px 16px 26px;position:relative}
  .hero::after{content:'';position:absolute;bottom:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#60a5fa,#3b82f6,#2563eb)}
  .hero .store{font-size:12px;font-weight:500;letter-spacing:3px;opacity:.8;margin-bottom:8px}
  .hero h1{font-size:22px;font-weight:900;line-height:1.35}
  .hero .period{margin-top:10px;font-size:12px;opacity:.75}
  .content{padding:8px 14px 20px;max-width:480px;margin:0 auto}
  .cat-section{margin-top:14px}
  .cat-tag{display:inline-block;font-size:13px;font-weight:700;color:#fff;background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:6px 14px;border-radius:20px;margin-bottom:10px}
  .item{display:flex;align-items:center;gap:12px;background:#fff;border-radius:14px;padding:10px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,.04);position:relative}
  .item-img{width:72px;height:72px;flex-shrink:0;border-radius:12px;overflow:hidden;background:#f1f5f9}
  .item-img .product-img{width:72px;height:72px;object-fit:cover}
  .item-img .emoji-area{width:72px;height:72px;display:flex;align-items:center;justify-content:center;font-size:32px;background:linear-gradient(135deg,#eff6ff,#dbeafe)}
  .item-info{flex:1;min-width:0}
  .item .name{font-size:14px;font-weight:700;line-height:1.3;margin-bottom:2px}
  .item .tag{display:inline-block;font-size:10px;font-weight:600;color:#2563eb;background:#eff6ff;padding:2px 8px;border-radius:6px;margin-bottom:4px}
  .item .price-row{display:flex;align-items:baseline;gap:6px}
  .item .orig{font-size:11px;color:#aaa;text-decoration:line-through}
  .item .price{font-size:18px;font-weight:900;color:#1e40af}
  .item .discount{position:absolute;top:8px;right:8px;background:#ef4444;color:#fff;font-size:11px;font-weight:800;padding:3px 7px;border-radius:8px}
  .footer{text-align:center;padding:24px 16px 32px;color:#bbb;font-size:11px}
</style>
</head>
<body>
<div class="hero">
  <div class="store">${escapeHtml(storeName)}</div>
  <h1>${escapeHtml(title)}</h1>
  ${period ? `<div class="period">${escapeHtml(period)}</div>` : ''}
</div>
<div class="content">${itemsHtml}</div>
<div class="footer">hanjul-flyer.kr</div>
</body>
</html>`;
}

// ============================================================
// 템플릿 3: 하이라이트형 (프리미엄 다크 — 골드 강조, TOP PICK 대형)
// ============================================================
function renderHighlightTemplate(storeName: string, title: string, period: string, categories: any[]): string {
  // 할인율 높은 4개 자동 선정 (TOP PICK)
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
    picksHtml = `<div class="section-label">TOP PICK</div><div class="picks">`;
    for (const p of picks) {
      const pickUrl = toAbsoluteImageUrl(p.imageUrl || resolveProductImageUrl(p.name || ''));
      const pickImg = renderProductImage(p.name || '', 160, pickUrl || undefined);
      picksHtml += `<div class="pick">
        <div class="pick-img">${pickImg}</div>
        <div class="pick-badge">${p.discount}% OFF</div>
        <div class="pick-body">
          <div class="name">${escapeHtml(p.name || '')}</div>
          <div class="pick-prices">
            <span class="orig">₩${formatPrice(p.originalPrice)}</span>
            <span class="price">₩${formatPrice(p.salePrice || 0)}</span>
          </div>
        </div>
      </div>`;
    }
    picksHtml += '</div>';
  }

  let itemsHtml = '';
  for (const cat of categories) {
    itemsHtml += `<div class="cat-title">${escapeHtml(cat.name || '')}</div><div class="compact-grid">`;
    for (const item of (cat.items || [])) {
      const rowUrl = toAbsoluteImageUrl(item.imageUrl || resolveProductImageUrl(item.name || ''));
      const rowImg = renderProductImage(item.name || '', 80, rowUrl || undefined);
      itemsHtml += `<div class="compact-card">
        <div class="compact-img">${rowImg}</div>
        <div class="compact-body">
          <div class="name">${escapeHtml(item.name || '')}</div>
          <div class="price">₩${formatPrice(item.salePrice || 0)}</div>
          ${item.badge ? `<span class="tag">${escapeHtml(item.badge)}</span>` : ''}
        </div>
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
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Noto Sans KR',sans-serif;background:#0f0f0f;color:#e5e5e5;-webkit-font-smoothing:antialiased}
  .hero{background:linear-gradient(180deg,#1a1a2e 0%,#0f0f0f 100%);text-align:center;padding:36px 16px 28px;border-bottom:2px solid #d4a844}
  .hero .store{font-size:11px;font-weight:600;letter-spacing:4px;color:#d4a844;text-transform:uppercase;margin-bottom:10px}
  .hero h1{font-size:24px;font-weight:900;color:#fff;line-height:1.3}
  .hero .period{margin-top:12px;font-size:12px;color:#888}
  .content{padding:12px 14px 20px;max-width:480px;margin:0 auto}
  .section-label{text-align:center;font-size:12px;font-weight:800;letter-spacing:4px;color:#d4a844;margin:20px 0 12px;position:relative}
  .section-label::before,.section-label::after{content:'';position:absolute;top:50%;width:60px;height:1px;background:#333}
  .section-label::before{left:0}.section-label::after{right:0}
  .picks{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px}
  .pick{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;position:relative}
  .pick-img{width:100%;height:140px;overflow:hidden;background:#1a1a1a}
  .pick-img .product-img{width:100%;height:140px;object-fit:cover}
  .pick-img .emoji-area{width:100%;height:140px;display:flex;align-items:center;justify-content:center;font-size:48px;background:linear-gradient(135deg,#1a1a2e,#2a2a3e)}
  .pick-badge{position:absolute;top:10px;left:10px;background:linear-gradient(135deg,#d4a844,#b8860b);color:#000;font-size:11px;font-weight:800;padding:4px 10px;border-radius:8px}
  .pick-body{padding:10px 12px 14px}
  .pick .name{font-size:13px;font-weight:700;color:#fff;margin-bottom:4px}
  .pick-prices{display:flex;align-items:baseline;gap:6px}
  .pick .orig{font-size:11px;color:#666;text-decoration:line-through}
  .pick .price{font-size:20px;font-weight:900;color:#d4a844}
  .cat-title{font-size:13px;font-weight:700;color:#d4a844;padding:14px 0 8px;border-bottom:1px solid #222;margin-top:8px;letter-spacing:1px}
  .compact-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
  .compact-card{background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #222}
  .compact-img{width:100%;height:80px;overflow:hidden}
  .compact-img .product-img{width:100%;height:80px;object-fit:cover}
  .compact-img .emoji-area{width:100%;height:80px;display:flex;align-items:center;justify-content:center;font-size:32px;background:linear-gradient(135deg,#1a1a2e,#2a2a3e)}
  .compact-body{padding:8px 10px 10px}
  .compact-card .name{font-size:12px;font-weight:600;color:#ddd;margin-bottom:2px}
  .compact-card .price{font-size:16px;font-weight:900;color:#d4a844}
  .compact-card .tag{display:inline-block;font-size:9px;font-weight:600;color:#d4a844;background:rgba(212,168,68,.1);padding:2px 6px;border-radius:4px;margin-top:2px}
  .footer{text-align:center;padding:24px 16px 32px;color:#444;font-size:11px}
</style>
</head>
<body>
<div class="hero">
  <div class="store">${escapeHtml(storeName)}</div>
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
