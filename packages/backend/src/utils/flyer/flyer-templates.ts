/**
 * ★ CT-F14 — 전단AI 템플릿 렌더링 엔진
 *
 * 전단지 공개 페이지 HTML 렌더링의 유일한 진입점.
 * short-urls.ts에서 호출: renderTemplate(templateCode, data)
 *
 * 기존 3종 (grid/list/highlight) + 마트 4종 + 정육 3종 = 10종.
 * 템플릿 추가: (1) RENDERERS에 함수 등록 (2) CT-F13 TEMPLATE_REGISTRY에 메타 추가
 */

import { renderProductImage, resolveProductImageUrl } from '../../utils/product-images';

// ============================================================
// 공통 타입 + 유틸
// ============================================================

export interface FlyerRenderData {
  storeName: string;
  title: string;
  period: string;
  categories: Array<{ name: string; items: FlyerRenderItem[] }>;
  qrCodeDataUrl?: string;  // QR 쿠폰 이미지 (Data URL)
  qrCouponText?: string;   // QR 쿠폰 안내 문구 (예: "스캔하고 5,000원 할인!")
}

export interface FlyerRenderItem {
  name: string;
  originalPrice: number;
  salePrice: number;
  badge?: string;
  imageUrl?: string;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatPrice(price: number): string {
  return price.toLocaleString();
}

function toAbsoluteImageUrl(url: string | null): string | null {
  if (!url || url.startsWith('http')) return url;
  const base = process.env.FLYER_API_BASE_URL || '';
  return base ? base + url : url;
}

function calcDiscount(original: number, sale: number): number {
  return original > 0 ? Math.round((1 - sale / original) * 100) : 0;
}

function resolveImg(itemName: string, size: number, imageUrl?: string | null): string {
  const absUrl = toAbsoluteImageUrl(imageUrl || resolveProductImageUrl(itemName));
  return renderProductImage(itemName, size, absUrl || undefined);
}

/** 공통 HTML 헤드 (Noto Sans KR) */
function htmlHead(title: string, css: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>${escapeHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  ${css}
</style>
</head>`;
}

function footer(): string {
  return `<div class="footer">hanjul-flyer.kr</div>`;
}

// ============================================================
// 렌더러 맵 — 단일 진입점
// ============================================================

const RENDERERS: Record<string, (d: FlyerRenderData) => string> = {
  grid: renderGridTemplate,
  list: renderListTemplate,
  highlight: renderHighlightTemplate,
  mart_fresh: renderMartFreshTemplate,
  mart_weekend: renderMartWeekendTemplate,
  mart_seasonal: renderMartSeasonalTemplate,
  mart_clearance: renderMartClearanceTemplate,
  butcher_premium: renderButcherPremiumTemplate,
  butcher_daily: renderButcherDailyTemplate,
  butcher_bulk: renderButcherBulkTemplate,
};

/** QR 쿠폰 하단 섹션 — 모든 템플릿 공통 */
function renderQrSection(d: FlyerRenderData): string {
  if (!d.qrCodeDataUrl) return '';
  return `
  <div style="margin:24px auto 0;padding:20px;text-align:center;border-top:2px dashed #e0e0e0;max-width:340px">
    <img src="${d.qrCodeDataUrl}" alt="QR 쿠폰" style="width:140px;height:140px;margin:0 auto 10px;display:block;border-radius:8px" />
    <p style="font-size:15px;font-weight:700;color:#333;margin:0">${escapeHtml(d.qrCouponText || '스캔하고 할인 받으세요!')}</p>
    <p style="font-size:11px;color:#999;margin-top:4px">QR 코드를 스마트폰 카메라로 스캔하세요</p>
  </div>`;
}

/**
 * 단일 진입점. templateCode로 렌더러 선택. 미존재 시 grid 폴백.
 */
export function renderTemplate(templateCode: string, data: FlyerRenderData): string {
  const renderer = RENDERERS[templateCode];
  let html = renderer ? renderer(data) : renderGridTemplate(data);

  // QR 쿠폰 섹션 자동 삽입 (</body> 앞)
  if (data.qrCodeDataUrl) {
    html = html.replace('</body>', renderQrSection(data) + '</body>');
  }

  return html;
}

// ============================================================
// ★ 템플릿 1: 그리드형 V2 (프리미엄 마트 전단 — 대형 가격, 카테고리 탭)
// ============================================================
function renderGridTemplate(d: FlyerRenderData): string {
  // 카테고리 탭 HTML
  const catTabs = d.categories.map((cat, i) =>
    `<a class="cat-tab${i === 0 ? ' active' : ''}" href="#cat-${i}">${escapeHtml(cat.name || '')}</a>`
  ).join('');

  // 카테고리별 상품 섹션 HTML
  let sectionsHtml = '';
  for (let ci = 0; ci < d.categories.length; ci++) {
    const cat = d.categories[ci];
    const items = cat.items || [];
    let cardsHtml = '';
    for (const item of items) {
      const productImg = resolveImg(item.name || '', 160, item.imageUrl);
      const discount = calcDiscount(item.originalPrice, item.salePrice);
      const tagColor = item.badge && /특가|할인|초특가/.test(item.badge) ? 'red' : item.badge && /인기|추천|프리미엄/.test(item.badge) ? 'blue' : 'gold';
      cardsHtml += `<div class="card">
        <div class="card-img">
          ${discount > 0 ? `<div class="badge-discount">${discount}%</div>` : ''}
          ${productImg}
        </div>
        <div class="card-body">
          <div class="card-name">${escapeHtml(item.name || '')}</div>
          ${item.originalPrice && item.originalPrice > item.salePrice ? `<div class="card-orig">${formatPrice(item.originalPrice)}원</div>` : ''}
          <div class="card-price"><span class="price-num">${formatPrice(item.salePrice || 0)}</span><span class="price-won">원</span></div>
          ${item.badge ? `<span class="card-tag ${tagColor}">${escapeHtml(item.badge)}</span>` : ''}
        </div>
      </div>`;
    }
    sectionsHtml += `<section class="cat-section" id="cat-${ci}">
      <div class="cat-header">
        <div class="cat-icon">${String(ci + 1).padStart(2, '0')}</div>
        <span class="cat-name">${escapeHtml(cat.name || '')}</span>
        <span class="cat-count">${items.length}개 상품</span>
      </div>
      <div class="grid">${cardsHtml}</div>
    </section>`;
  }

  return `${htmlHead(d.title, `
  :root{--red:#dc2626;--red-dark:#b91c1c;--orange:#ea580c;--bg:#f3f4f6;--card:#fff;--text:#1a1a1a;--text-sub:#6b7280;--text-muted:#9ca3af;--radius:16px}
  body{font-family:'Noto Sans KR',sans-serif;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;max-width:480px;margin:0 auto;overflow-x:hidden}

  .hero{position:relative;background:linear-gradient(145deg,var(--red) 0%,var(--red-dark) 40%,#991b1b 100%);padding:36px 20px 44px;text-align:center;overflow:hidden}
  .hero::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 20% 80%,rgba(249,115,22,.25) 0%,transparent 50%),radial-gradient(circle at 85% 20%,rgba(245,158,11,.2) 0%,transparent 40%);pointer-events:none}
  .hero::after{content:'';position:absolute;top:-30px;right:-30px;width:120px;height:120px;border:3px solid rgba(255,255,255,.1);border-radius:50%;pointer-events:none}
  .hero-store{font-size:13px;font-weight:700;color:rgba(255,255,255,.85);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px}
  .hero-title{font-size:28px;font-weight:900;color:#fff;line-height:1.3;text-shadow:0 2px 12px rgba(0,0,0,.2)}
  .hero-period{display:inline-flex;align-items:center;gap:6px;margin-top:14px;background:rgba(0,0,0,.2);border-radius:24px;padding:7px 18px;font-size:12px;font-weight:600;color:rgba(255,255,255,.95)}
  .hero-wave{position:absolute;bottom:0;left:0;right:0;height:24px;background:var(--bg);border-radius:24px 24px 0 0}

  .cat-nav{position:sticky;top:0;z-index:100;background:var(--card);border-bottom:1px solid #e5e7eb;box-shadow:0 2px 8px rgba(0,0,0,.04)}
  .cat-nav-inner{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:0 12px}
  .cat-nav-inner::-webkit-scrollbar{display:none}
  .cat-tab{flex-shrink:0;scroll-snap-align:start;padding:14px 16px;font-size:13px;font-weight:700;color:var(--text-sub);white-space:nowrap;text-decoration:none;border-bottom:2.5px solid transparent;transition:all .2s}
  .cat-tab.active{color:var(--red);border-bottom-color:var(--red)}

  .content{padding:4px 12px 24px}
  .cat-section{padding-top:16px}
  .cat-header{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:0 4px}
  .cat-icon{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--red),var(--orange));display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;font-weight:900;flex-shrink:0;box-shadow:0 2px 6px rgba(220,38,38,.25)}
  .cat-name{font-size:17px;font-weight:800;color:var(--text);letter-spacing:-.3px}
  .cat-count{font-size:11px;font-weight:600;color:var(--text-muted);margin-left:auto}

  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .card{background:var(--card);border-radius:var(--radius);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08),0 4px 12px rgba(0,0,0,.04);position:relative}
  .card-img{position:relative;width:100%;aspect-ratio:1/.85;overflow:hidden;background:#f8fafc}
  .card-img .product-img{width:100%;height:100%;object-fit:cover;display:block}
  .card-img .emoji-area{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:52px;background:linear-gradient(145deg,#fef7f0,#fff5f5)}
  .badge-discount{position:absolute;top:8px;left:8px;z-index:2;background:linear-gradient(135deg,var(--red),var(--orange));color:#fff;font-size:12px;font-weight:800;padding:4px 9px;border-radius:8px;box-shadow:0 2px 6px rgba(220,38,38,.35);line-height:1}
  .card-body{padding:10px 12px 14px}
  .card-name{font-size:14px;font-weight:700;color:var(--text);line-height:1.35;margin-bottom:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .card-orig{font-size:12px;font-weight:500;color:var(--text-muted);text-decoration:line-through;margin-bottom:2px}
  .card-price{display:flex;align-items:baseline;gap:1px;line-height:1}
  .price-num{font-size:24px;font-weight:900;color:var(--red);letter-spacing:-.5px}
  .price-won{font-size:13px;font-weight:700;color:var(--red);margin-left:1px}
  .card-tag{display:inline-flex;align-items:center;margin-top:6px;padding:3px 8px;font-size:10px;font-weight:700;border-radius:6px;line-height:1.3}
  .card-tag.red{background:#fef2f2;color:var(--red);border:1px solid #fecaca}
  .card-tag.gold{background:#fffbeb;color:#b45309;border:1px solid #fde68a}
  .card-tag.blue{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
  .footer{text-align:center;padding:28px 16px 36px;border-top:1px solid #e5e7eb;margin:8px 12px 0;color:#bbb;font-size:11px}
  @media(max-width:360px){.hero-title{font-size:24px}.price-num{font-size:20px}.card-name{font-size:13px}}
  @media(min-width:420px){.price-num{font-size:26px}}
  `)}
<body>
<div class="hero">
  <div class="hero-store">${escapeHtml(d.storeName)}</div>
  <h1 class="hero-title">${escapeHtml(d.title)}</h1>
  ${d.period ? `<div class="hero-period">${escapeHtml(d.period)}</div>` : ''}
  <div class="hero-wave"></div>
</div>
<nav class="cat-nav"><div class="cat-nav-inner">${catTabs}</div></nav>
<div class="content">${sectionsHtml}</div>
${footer()}
</body>
</html>`;
}

// ============================================================
// 기존 템플릿 2: 리스트형 (딥블루, 깔끔 모던)
// ============================================================
function renderListTemplate(d: FlyerRenderData): string {
  let itemsHtml = '';
  for (const cat of d.categories) {
    itemsHtml += `<div class="cat-section"><div class="cat-tag">${escapeHtml(cat.name || '')}</div>`;
    for (const item of (cat.items || [])) {
      const productImg = resolveImg(item.name || '', 72, item.imageUrl);
      const discount = calcDiscount(item.originalPrice, item.salePrice);
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

  return `${htmlHead(d.title, `
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
  `)}
<body>
<div class="hero">
  <div class="store">${escapeHtml(d.storeName)}</div>
  <h1>${escapeHtml(d.title)}</h1>
  ${d.period ? `<div class="period">${escapeHtml(d.period)}</div>` : ''}
</div>
<div class="content">${itemsHtml}</div>
${footer()}
</body>
</html>`;
}

// ============================================================
// 기존 템플릿 3: 하이라이트형 (프리미엄 다크, 골드 강조)
// ============================================================
function renderHighlightTemplate(d: FlyerRenderData): string {
  const allItems: (FlyerRenderItem & { discount: number })[] = [];
  for (const cat of d.categories) {
    for (const item of (cat.items || [])) {
      if (item.originalPrice && item.originalPrice > 0) {
        allItems.push({ ...item, discount: calcDiscount(item.originalPrice, item.salePrice) });
      }
    }
  }
  allItems.sort((a, b) => b.discount - a.discount);
  const picks = allItems.slice(0, 4);

  let picksHtml = '';
  if (picks.length > 0) {
    picksHtml = `<div class="section-label">TOP PICK</div><div class="picks">`;
    for (const p of picks) {
      const pickImg = resolveImg(p.name || '', 160, p.imageUrl);
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
  for (const cat of d.categories) {
    itemsHtml += `<div class="cat-title">${escapeHtml(cat.name || '')}</div><div class="compact-grid">`;
    for (const item of (cat.items || [])) {
      const rowImg = resolveImg(item.name || '', 80, item.imageUrl);
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

  return `${htmlHead(d.title, `
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
  `)}
<body>
<div class="hero">
  <div class="store">${escapeHtml(d.storeName)}</div>
  <h1>${escapeHtml(d.title)}</h1>
  ${d.period ? `<div class="period">${escapeHtml(d.period)}</div>` : ''}
</div>
<div class="content">
  ${picksHtml}
  ${itemsHtml}
</div>
${footer()}
</body>
</html>`;
}

// ============================================================
// 마트 템플릿 4: 신선식품 특화 (녹색 테마)
// ============================================================
function renderMartFreshTemplate(d: FlyerRenderData): string {
  let itemsHtml = '';
  for (const cat of d.categories) {
    itemsHtml += `<div class="cat-header">🌿 ${escapeHtml(cat.name || '')}</div><div class="grid">`;
    for (const item of (cat.items || [])) {
      const productImg = resolveImg(item.name || '', 120, item.imageUrl);
      const discount = calcDiscount(item.originalPrice, item.salePrice);
      itemsHtml += `<div class="card">
        ${discount > 0 ? `<div class="badge">-${discount}%</div>` : ''}
        <div class="card-img">${productImg}</div>
        <div class="card-body">
          <div class="name">${escapeHtml(item.name || '')}</div>
          <div class="price-row">
            ${item.originalPrice ? `<span class="orig">${formatPrice(item.originalPrice)}원</span>` : ''}
            <span class="price">${formatPrice(item.salePrice || 0)}원</span>
          </div>
          ${item.badge ? `<div class="tag">${escapeHtml(item.badge)}</div>` : ''}
        </div>
      </div>`;
    }
    itemsHtml += '</div>';
  }

  return `${htmlHead(d.title, `
  body{font-family:'Noto Sans KR',sans-serif;background:#f0fdf4;color:#1a2e1a;-webkit-font-smoothing:antialiased}
  .hero{background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);color:#fff;text-align:center;padding:32px 16px 28px;position:relative}
  .hero::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:24px;background:#f0fdf4;border-radius:50% 50% 0 0}
  .hero .store{font-size:12px;font-weight:500;letter-spacing:3px;opacity:.85;margin-bottom:6px}
  .hero h1{font-size:22px;font-weight:900;line-height:1.35}
  .hero .period{margin-top:10px;font-size:12px;background:rgba(255,255,255,.2);display:inline-block;padding:4px 14px;border-radius:16px}
  .content{padding:8px 14px 20px;max-width:480px;margin:0 auto}
  .cat-header{font-size:15px;font-weight:800;color:#15803d;margin:18px 0 10px;padding-bottom:6px;border-bottom:2px solid #bbf7d0}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.05);position:relative;border:1px solid #dcfce7}
  .card-img{width:100%;height:120px;overflow:hidden;background:#f0fdf4;display:flex;align-items:center;justify-content:center}
  .card-img .product-img{width:100%;height:120px;object-fit:cover}
  .card-img .emoji-area{width:100%;height:120px;display:flex;align-items:center;justify-content:center;font-size:48px;background:linear-gradient(135deg,#f0fdf4,#dcfce7)}
  .card-body{padding:10px 12px 12px}
  .card .name{font-size:13px;font-weight:700;line-height:1.35;margin-bottom:6px}
  .card .price-row{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
  .card .orig{font-size:11px;color:#aaa;text-decoration:line-through}
  .card .price{font-size:18px;font-weight:900;color:#16a34a}
  .card .badge{position:absolute;top:8px;left:8px;background:#16a34a;color:#fff;font-size:11px;font-weight:800;padding:3px 8px;border-radius:8px;z-index:1}
  .card .tag{margin-top:5px;font-size:10px;color:#16a34a;font-weight:700;background:#f0fdf4;padding:2px 8px;border-radius:6px;display:inline-block;border:1px solid #bbf7d0}
  .footer{text-align:center;padding:24px 16px 32px;color:#a3a3a3;font-size:11px}
  `)}
<body>
<div class="hero">
  <div class="store">${escapeHtml(d.storeName)}</div>
  <h1>${escapeHtml(d.title)}</h1>
  ${d.period ? `<div class="period">${escapeHtml(d.period)}</div>` : ''}
</div>
<div class="content">${itemsHtml}</div>
${footer()}
</body>
</html>`;
}

// ============================================================
// 마트 템플릿 5: 주말특가 (보라+핑크)
// ============================================================
function renderMartWeekendTemplate(d: FlyerRenderData): string {
  // 대표 상품 1개 (최고 할인율)
  let featuredItem: (FlyerRenderItem & { discount: number }) | null = null;
  for (const cat of d.categories) {
    for (const item of (cat.items || [])) {
      const disc = calcDiscount(item.originalPrice, item.salePrice);
      if (!featuredItem || disc > featuredItem.discount) {
        featuredItem = { ...item, discount: disc };
      }
    }
  }

  let featuredHtml = '';
  if (featuredItem && featuredItem.discount > 0) {
    const fImg = resolveImg(featuredItem.name, 180, featuredItem.imageUrl);
    featuredHtml = `<div class="featured">
      <div class="featured-badge">BEST DEAL -${featuredItem.discount}%</div>
      <div class="featured-img">${fImg}</div>
      <div class="featured-name">${escapeHtml(featuredItem.name)}</div>
      <div class="featured-prices">
        <span class="orig">₩${formatPrice(featuredItem.originalPrice)}</span>
        <span class="price">₩${formatPrice(featuredItem.salePrice)}</span>
      </div>
    </div>`;
  }

  let itemsHtml = '';
  for (const cat of d.categories) {
    itemsHtml += `<div class="cat-pill">${escapeHtml(cat.name || '')}</div><div class="grid">`;
    for (const item of (cat.items || [])) {
      const productImg = resolveImg(item.name || '', 100, item.imageUrl);
      const discount = calcDiscount(item.originalPrice, item.salePrice);
      itemsHtml += `<div class="card">
        ${discount > 0 ? `<div class="badge">${discount}%</div>` : ''}
        <div class="card-img">${productImg}</div>
        <div class="card-body">
          <div class="name">${escapeHtml(item.name || '')}</div>
          <div class="price">₩${formatPrice(item.salePrice || 0)}</div>
        </div>
      </div>`;
    }
    itemsHtml += '</div>';
  }

  return `${htmlHead(d.title, `
  body{font-family:'Noto Sans KR',sans-serif;background:#fdf4ff;color:#1a1a1a;-webkit-font-smoothing:antialiased}
  .hero{background:linear-gradient(135deg,#9333ea 0%,#c026d3 50%,#ec4899 100%);color:#fff;text-align:center;padding:32px 16px 28px;position:relative}
  .hero::after{content:'✨';position:absolute;bottom:-12px;left:50%;transform:translateX(-50%);font-size:24px}
  .hero .store{font-size:12px;letter-spacing:3px;opacity:.85;margin-bottom:6px}
  .hero h1{font-size:24px;font-weight:900;line-height:1.3}
  .hero .period{margin-top:10px;font-size:12px;background:rgba(255,255,255,.2);display:inline-block;padding:4px 14px;border-radius:16px}
  .content{padding:16px 14px 20px;max-width:480px;margin:0 auto}
  .featured{background:#fff;border-radius:20px;padding:20px;text-align:center;box-shadow:0 4px 16px rgba(147,51,234,.15);margin-bottom:16px;border:2px solid #e9d5ff}
  .featured-badge{display:inline-block;background:linear-gradient(135deg,#9333ea,#ec4899);color:#fff;font-size:13px;font-weight:800;padding:6px 16px;border-radius:20px;margin-bottom:12px}
  .featured-img{width:180px;height:180px;margin:0 auto 12px;border-radius:16px;overflow:hidden}
  .featured-img .product-img{width:180px;height:180px;object-fit:cover}
  .featured-img .emoji-area{width:180px;height:180px;display:flex;align-items:center;justify-content:center;font-size:64px;background:#fdf4ff}
  .featured-name{font-size:18px;font-weight:800;margin-bottom:6px}
  .featured-prices{display:flex;align-items:baseline;gap:8px;justify-content:center}
  .featured-prices .orig{font-size:14px;color:#aaa;text-decoration:line-through}
  .featured-prices .price{font-size:26px;font-weight:900;color:#9333ea}
  .cat-pill{display:inline-block;font-size:13px;font-weight:700;color:#fff;background:linear-gradient(135deg,#a855f7,#ec4899);padding:5px 14px;border-radius:20px;margin:14px 0 10px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.05);position:relative}
  .card-img{width:100%;height:100px;overflow:hidden;background:#fdf4ff;display:flex;align-items:center;justify-content:center}
  .card-img .product-img{width:100%;height:100px;object-fit:cover}
  .card-img .emoji-area{width:100%;height:100px;display:flex;align-items:center;justify-content:center;font-size:40px;background:#fdf4ff}
  .card-body{padding:8px 10px 10px}
  .card .name{font-size:12px;font-weight:700;margin-bottom:4px}
  .card .price{font-size:17px;font-weight:900;color:#9333ea}
  .card .badge{position:absolute;top:6px;left:6px;background:#ec4899;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px}
  .footer{text-align:center;padding:24px 16px 32px;color:#bbb;font-size:11px}
  `)}
<body>
<div class="hero">
  <div class="store">${escapeHtml(d.storeName)}</div>
  <h1>${escapeHtml(d.title)}</h1>
  ${d.period ? `<div class="period">${escapeHtml(d.period)}</div>` : ''}
</div>
<div class="content">
  ${featuredHtml}
  ${itemsHtml}
</div>
${footer()}
</body>
</html>`;
}

// ============================================================
// 마트 템플릿 6: 시즌 행사 (파랑+시안)
// ============================================================
function renderMartSeasonalTemplate(d: FlyerRenderData): string {
  let itemsHtml = '';
  for (const cat of d.categories) {
    itemsHtml += `<div class="cat-header"><span class="cat-icon">🎁</span> ${escapeHtml(cat.name || '')}</div><div class="grid">`;
    for (const item of (cat.items || [])) {
      const productImg = resolveImg(item.name || '', 110, item.imageUrl);
      const discount = calcDiscount(item.originalPrice, item.salePrice);
      itemsHtml += `<div class="card">
        <div class="card-img">${productImg}</div>
        <div class="card-body">
          <div class="name">${escapeHtml(item.name || '')}</div>
          <div class="price-row">
            ${item.originalPrice ? `<span class="orig">${formatPrice(item.originalPrice)}원</span>` : ''}
            <span class="price">${formatPrice(item.salePrice || 0)}원</span>
          </div>
          ${discount > 0 ? `<span class="disc-pill">↓${discount}%</span>` : ''}
        </div>
      </div>`;
    }
    itemsHtml += '</div>';
  }

  return `${htmlHead(d.title, `
  body{font-family:'Noto Sans KR',sans-serif;background:#f0f9ff;color:#0c4a6e;-webkit-font-smoothing:antialiased}
  .hero{background:linear-gradient(135deg,#2563eb 0%,#0891b2 100%);color:#fff;text-align:center;padding:36px 16px 30px;position:relative}
  .hero .store{font-size:12px;letter-spacing:3px;opacity:.8;margin-bottom:8px}
  .hero h1{font-size:24px;font-weight:900;line-height:1.3}
  .hero .period{margin-top:12px;font-size:13px;font-weight:600;background:rgba(255,255,255,.15);display:inline-block;padding:5px 18px;border-radius:20px;border:1px solid rgba(255,255,255,.3)}
  .content{padding:10px 14px 20px;max-width:480px;margin:0 auto}
  .cat-header{font-size:15px;font-weight:800;color:#1e40af;margin:18px 0 10px;display:flex;align-items:center;gap:6px}
  .cat-icon{font-size:16px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.05);border:1px solid #e0f2fe}
  .card-img{width:100%;height:110px;overflow:hidden;background:#f0f9ff;display:flex;align-items:center;justify-content:center}
  .card-img .product-img{width:100%;height:110px;object-fit:cover}
  .card-img .emoji-area{width:100%;height:110px;display:flex;align-items:center;justify-content:center;font-size:44px;background:linear-gradient(135deg,#f0f9ff,#e0f2fe)}
  .card-body{padding:10px 12px 12px}
  .card .name{font-size:13px;font-weight:700;line-height:1.35;margin-bottom:4px}
  .card .price-row{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
  .card .orig{font-size:11px;color:#aaa;text-decoration:line-through}
  .card .price{font-size:18px;font-weight:900;color:#2563eb}
  .disc-pill{display:inline-block;font-size:10px;font-weight:700;color:#fff;background:#0891b2;padding:2px 8px;border-radius:10px;margin-top:4px}
  .footer{text-align:center;padding:24px 16px 32px;color:#bbb;font-size:11px}
  `)}
<body>
<div class="hero">
  <div class="store">${escapeHtml(d.storeName)}</div>
  <h1>${escapeHtml(d.title)}</h1>
  ${d.period ? `<div class="period">${escapeHtml(d.period)}</div>` : ''}
</div>
<div class="content">${itemsHtml}</div>
${footer()}
</body>
</html>`;
}

// ============================================================
// 마트 템플릿 7: 창고대방출 (노랑+빨강, 긴박감)
// ============================================================
function renderMartClearanceTemplate(d: FlyerRenderData): string {
  // 최대 할인율 계산
  let maxDiscount = 0;
  for (const cat of d.categories) {
    for (const item of (cat.items || [])) {
      const disc = calcDiscount(item.originalPrice, item.salePrice);
      if (disc > maxDiscount) maxDiscount = disc;
    }
  }

  let itemsHtml = '';
  for (const cat of d.categories) {
    itemsHtml += `<div class="cat-stripe">${escapeHtml(cat.name || '')}</div><div class="grid">`;
    for (const item of (cat.items || [])) {
      const discount = calcDiscount(item.originalPrice, item.salePrice);
      itemsHtml += `<div class="card">
        <div class="card-price-area">
          ${discount > 0 ? `<div class="disc-big">${discount}%<span>OFF</span></div>` : ''}
          <div class="sale-price">₩${formatPrice(item.salePrice || 0)}</div>
          ${item.originalPrice ? `<div class="orig-price">₩${formatPrice(item.originalPrice)}</div>` : ''}
        </div>
        <div class="card-name">${escapeHtml(item.name || '')}</div>
        ${item.badge ? `<div class="tag">${escapeHtml(item.badge)}</div>` : ''}
      </div>`;
    }
    itemsHtml += '</div>';
  }

  return `${htmlHead(d.title, `
  body{font-family:'Noto Sans KR',sans-serif;background:#fffbeb;color:#1a1a1a;-webkit-font-smoothing:antialiased}
  .hero{background:linear-gradient(135deg,#eab308 0%,#f59e0b 40%,#dc2626 100%);color:#fff;text-align:center;padding:28px 16px 24px;position:relative}
  .hero .store{font-size:11px;letter-spacing:3px;margin-bottom:4px}
  .hero h1{font-size:26px;font-weight:900;line-height:1.25;text-shadow:0 2px 4px rgba(0,0,0,.2)}
  .hero .max-disc{margin-top:10px;font-size:14px;font-weight:900;background:#fff;color:#dc2626;display:inline-block;padding:6px 20px;border-radius:20px}
  .hero .period{margin-top:8px;font-size:12px;opacity:.9}
  .content{padding:8px 14px 20px;max-width:480px;margin:0 auto}
  .cat-stripe{font-size:14px;font-weight:900;color:#92400e;background:repeating-linear-gradient(45deg,#fef3c7,#fef3c7 10px,#fde68a 10px,#fde68a 20px);padding:8px 14px;margin:14px 0 10px;border-radius:8px;text-align:center}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .card{background:#fff;border-radius:12px;padding:14px 12px;box-shadow:0 2px 6px rgba(0,0,0,.06);border:2px solid #fde68a;text-align:center}
  .card-price-area{margin-bottom:8px}
  .disc-big{font-size:32px;font-weight:900;color:#dc2626;line-height:1}
  .disc-big span{font-size:14px;font-weight:700}
  .sale-price{font-size:20px;font-weight:900;color:#b91c1c;margin-top:2px}
  .orig-price{font-size:12px;color:#aaa;text-decoration:line-through}
  .card-name{font-size:13px;font-weight:700;color:#333}
  .card .tag{margin-top:6px;font-size:10px;font-weight:700;color:#b45309;background:#fef3c7;padding:2px 8px;border-radius:6px;display:inline-block}
  .footer{text-align:center;padding:24px 16px 32px;color:#bbb;font-size:11px}
  `)}
<body>
<div class="hero">
  <div class="store">${escapeHtml(d.storeName)}</div>
  <h1>${escapeHtml(d.title)}</h1>
  ${maxDiscount > 0 ? `<div class="max-disc">최대 ${maxDiscount}% 할인</div>` : ''}
  ${d.period ? `<div class="period">${escapeHtml(d.period)}</div>` : ''}
</div>
<div class="content">${itemsHtml}</div>
${footer()}
</body>
</html>`;
}

// ============================================================
// 정육 템플릿 8: 프리미엄 정육 (다크+골드, 한우 특화)
// ============================================================
function renderButcherPremiumTemplate(d: FlyerRenderData): string {
  let itemsHtml = '';
  for (const cat of d.categories) {
    itemsHtml += `<div class="cat-title"><span class="gold-line"></span>${escapeHtml(cat.name || '')}<span class="gold-line"></span></div>`;
    for (const item of (cat.items || [])) {
      const productImg = resolveImg(item.name || '', 140, item.imageUrl);
      const discount = calcDiscount(item.originalPrice, item.salePrice);
      itemsHtml += `<div class="meat-card">
        <div class="meat-img">${productImg}</div>
        <div class="meat-info">
          <div class="name">${escapeHtml(item.name || '')}</div>
          ${item.badge ? `<div class="grade">${escapeHtml(item.badge)}</div>` : ''}
          <div class="price-row">
            ${item.originalPrice ? `<span class="orig">₩${formatPrice(item.originalPrice)}</span>` : ''}
            <span class="price">₩${formatPrice(item.salePrice || 0)}</span>
          </div>
          ${discount > 0 ? `<span class="save">-${discount}%</span>` : ''}
        </div>
      </div>`;
    }
  }

  return `${htmlHead(d.title, `
  body{font-family:'Noto Sans KR',sans-serif;background:#0a0a0a;color:#e5e5e5;-webkit-font-smoothing:antialiased}
  .hero{background:linear-gradient(180deg,#1a1a1a 0%,#0a0a0a 100%);text-align:center;padding:40px 16px 32px;border-bottom:3px solid #c9a84c}
  .hero .store{font-size:11px;font-weight:600;letter-spacing:5px;color:#c9a84c;text-transform:uppercase;margin-bottom:12px}
  .hero h1{font-size:26px;font-weight:900;color:#fff;line-height:1.25}
  .hero .period{margin-top:12px;font-size:12px;color:#666}
  .content{padding:12px 16px 24px;max-width:480px;margin:0 auto}
  .cat-title{display:flex;align-items:center;gap:12px;justify-content:center;font-size:14px;font-weight:800;color:#c9a84c;letter-spacing:2px;margin:24px 0 14px}
  .gold-line{flex:1;height:1px;background:linear-gradient(90deg,transparent,#c9a84c,transparent);max-width:80px}
  .meat-card{background:#141414;border:1px solid #2a2a2a;border-radius:16px;overflow:hidden;margin-bottom:12px}
  .meat-img{width:100%;height:180px;overflow:hidden;background:#141414}
  .meat-img .product-img{width:100%;height:180px;object-fit:cover}
  .meat-img .emoji-area{width:100%;height:180px;display:flex;align-items:center;justify-content:center;font-size:64px;background:linear-gradient(135deg,#1a1a1a,#2a2a2a)}
  .meat-info{padding:16px 18px 18px}
  .meat-card .name{font-size:18px;font-weight:800;color:#fff;margin-bottom:6px}
  .grade{display:inline-block;font-size:11px;font-weight:700;color:#c9a84c;border:1px solid #c9a84c;padding:3px 10px;border-radius:4px;margin-bottom:8px;letter-spacing:1px}
  .meat-card .price-row{display:flex;align-items:baseline;gap:8px}
  .meat-card .orig{font-size:13px;color:#555;text-decoration:line-through}
  .meat-card .price{font-size:24px;font-weight:900;color:#c9a84c}
  .meat-card .save{display:inline-block;font-size:11px;font-weight:700;background:#c9a84c;color:#000;padding:3px 8px;border-radius:6px;margin-top:6px}
  .footer{text-align:center;padding:24px 16px 32px;color:#444;font-size:11px}
  `)}
<body>
<div class="hero">
  <div class="store">${escapeHtml(d.storeName)}</div>
  <h1>${escapeHtml(d.title)}</h1>
  ${d.period ? `<div class="period">${escapeHtml(d.period)}</div>` : ''}
</div>
<div class="content">${itemsHtml}</div>
${footer()}
</body>
</html>`;
}

// ============================================================
// 정육 템플릿 9: 오늘의 고기 (빨강, 일일특가)
// ============================================================
function renderButcherDailyTemplate(d: FlyerRenderData): string {
  // Top 3 선정
  const allItems: (FlyerRenderItem & { discount: number })[] = [];
  for (const cat of d.categories) {
    for (const item of (cat.items || [])) {
      allItems.push({ ...item, discount: calcDiscount(item.originalPrice, item.salePrice) });
    }
  }
  allItems.sort((a, b) => b.discount - a.discount);
  const top3 = allItems.slice(0, 3);

  let topHtml = '';
  if (top3.length > 0) {
    topHtml = `<div class="top-label">🥩 오늘의 추천</div>`;
    for (const item of top3) {
      const img = resolveImg(item.name, 80, item.imageUrl);
      topHtml += `<div class="top-item">
        <div class="top-img">${img}</div>
        <div class="top-info">
          <div class="name">${escapeHtml(item.name)}</div>
          ${item.badge ? `<span class="badge-tag">${escapeHtml(item.badge)}</span>` : ''}
          <div class="price-row">
            ${item.originalPrice ? `<span class="orig">₩${formatPrice(item.originalPrice)}</span>` : ''}
            <span class="price">₩${formatPrice(item.salePrice || 0)}</span>
          </div>
        </div>
        ${item.discount > 0 ? `<div class="ribbon">${item.discount}%</div>` : ''}
      </div>`;
    }
  }

  let itemsHtml = '';
  for (const cat of d.categories) {
    itemsHtml += `<div class="cat-bar">${escapeHtml(cat.name || '')}</div><div class="grid">`;
    for (const item of (cat.items || [])) {
      const discount = calcDiscount(item.originalPrice, item.salePrice);
      itemsHtml += `<div class="card">
        <div class="card-name">${escapeHtml(item.name || '')}</div>
        <div class="card-price">₩${formatPrice(item.salePrice || 0)}</div>
        ${discount > 0 ? `<span class="card-disc">-${discount}%</span>` : ''}
        ${item.badge ? `<div class="card-badge">${escapeHtml(item.badge)}</div>` : ''}
      </div>`;
    }
    itemsHtml += '</div>';
  }

  return `${htmlHead(d.title, `
  body{font-family:'Noto Sans KR',sans-serif;background:#fff1f2;color:#1a1a1a;-webkit-font-smoothing:antialiased}
  .hero{background:linear-gradient(135deg,#dc2626 0%,#e11d48 100%);color:#fff;text-align:center;padding:32px 16px 26px}
  .hero .store{font-size:12px;letter-spacing:3px;opacity:.85;margin-bottom:6px}
  .hero h1{font-size:24px;font-weight:900;line-height:1.3}
  .hero .today-tag{margin-top:10px;display:inline-block;background:#fff;color:#dc2626;font-size:13px;font-weight:800;padding:5px 16px;border-radius:20px}
  .hero .period{margin-top:6px;font-size:12px;opacity:.8}
  .content{padding:12px 14px 20px;max-width:480px;margin:0 auto}
  .top-label{font-size:16px;font-weight:900;color:#dc2626;margin:12px 0 10px;text-align:center}
  .top-item{display:flex;align-items:center;gap:12px;background:#fff;border-radius:14px;padding:12px;margin-bottom:8px;box-shadow:0 2px 8px rgba(220,38,38,.08);position:relative;border-left:4px solid #dc2626}
  .top-img{width:80px;height:80px;flex-shrink:0;border-radius:12px;overflow:hidden;background:#fff1f2}
  .top-img .product-img{width:80px;height:80px;object-fit:cover}
  .top-img .emoji-area{width:80px;height:80px;display:flex;align-items:center;justify-content:center;font-size:36px;background:#fff1f2}
  .top-info{flex:1}
  .top-item .name{font-size:15px;font-weight:800;margin-bottom:2px}
  .badge-tag{display:inline-block;font-size:10px;font-weight:600;color:#dc2626;background:#fef2f2;padding:2px 6px;border-radius:4px;margin-bottom:4px}
  .top-item .price-row{display:flex;align-items:baseline;gap:6px}
  .top-item .orig{font-size:11px;color:#aaa;text-decoration:line-through}
  .top-item .price{font-size:20px;font-weight:900;color:#dc2626}
  .ribbon{position:absolute;top:8px;right:8px;background:#dc2626;color:#fff;font-size:12px;font-weight:800;padding:3px 8px;border-radius:8px}
  .cat-bar{font-size:14px;font-weight:800;color:#fff;background:linear-gradient(90deg,#dc2626,#e11d48);padding:8px 14px;border-radius:10px;margin:16px 0 10px;text-align:center}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .card{background:#fff;border-radius:12px;padding:14px 12px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.04)}
  .card-name{font-size:13px;font-weight:700;margin-bottom:4px}
  .card-price{font-size:18px;font-weight:900;color:#dc2626}
  .card-disc{display:inline-block;font-size:10px;font-weight:700;color:#fff;background:#e11d48;padding:2px 6px;border-radius:6px;margin-top:2px}
  .card-badge{font-size:10px;color:#999;margin-top:2px}
  .footer{text-align:center;padding:24px 16px 32px;color:#bbb;font-size:11px}
  `)}
<body>
<div class="hero">
  <div class="store">${escapeHtml(d.storeName)}</div>
  <h1>${escapeHtml(d.title)}</h1>
  <div class="today-tag">오늘만 이 가격!</div>
  ${d.period ? `<div class="period">${escapeHtml(d.period)}</div>` : ''}
</div>
<div class="content">
  ${topHtml}
  ${itemsHtml}
</div>
${footer()}
</body>
</html>`;
}

// ============================================================
// 정육 템플릿 10: 대용량 팩 (네이비, 중량 강조)
// ============================================================
function renderButcherBulkTemplate(d: FlyerRenderData): string {
  let itemsHtml = '';
  for (const cat of d.categories) {
    itemsHtml += `<div class="cat-header">📦 ${escapeHtml(cat.name || '')}</div><div class="grid">`;
    for (const item of (cat.items || [])) {
      const productImg = resolveImg(item.name || '', 100, item.imageUrl);
      const discount = calcDiscount(item.originalPrice, item.salePrice);
      const saving = item.originalPrice > 0 ? item.originalPrice - item.salePrice : 0;
      itemsHtml += `<div class="card">
        <div class="card-img">${productImg}</div>
        <div class="card-body">
          <div class="name">${escapeHtml(item.name || '')}</div>
          ${item.badge ? `<div class="weight">${escapeHtml(item.badge)}</div>` : ''}
          <div class="price">₩${formatPrice(item.salePrice || 0)}</div>
          ${item.originalPrice ? `<div class="orig">₩${formatPrice(item.originalPrice)}</div>` : ''}
          ${saving > 0 ? `<div class="saving">₩${formatPrice(saving)} 절약</div>` : ''}
          ${discount > 0 ? `<div class="disc">${discount}% OFF</div>` : ''}
        </div>
      </div>`;
    }
    itemsHtml += '</div>';
  }

  return `${htmlHead(d.title, `
  body{font-family:'Noto Sans KR',sans-serif;background:#eef2ff;color:#1e1b4b;-webkit-font-smoothing:antialiased}
  .hero{background:linear-gradient(135deg,#1e3a8a 0%,#3730a3 100%);color:#fff;text-align:center;padding:32px 16px 28px;position:relative}
  .hero::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:20px;background:#eef2ff;border-radius:50% 50% 0 0}
  .hero .store{font-size:12px;letter-spacing:3px;opacity:.8;margin-bottom:6px}
  .hero h1{font-size:22px;font-weight:900;line-height:1.35}
  .hero .sub{margin-top:8px;font-size:14px;font-weight:700;color:#a5b4fc}
  .hero .period{margin-top:8px;font-size:12px;opacity:.7}
  .content{padding:10px 14px 20px;max-width:480px;margin:0 auto}
  .cat-header{font-size:15px;font-weight:800;color:#1e3a8a;margin:16px 0 10px;display:flex;align-items:center;gap:6px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.05);border:1px solid #c7d2fe}
  .card-img{width:100%;height:100px;overflow:hidden;background:#eef2ff;display:flex;align-items:center;justify-content:center}
  .card-img .product-img{width:100%;height:100px;object-fit:cover}
  .card-img .emoji-area{width:100%;height:100px;display:flex;align-items:center;justify-content:center;font-size:40px;background:linear-gradient(135deg,#eef2ff,#e0e7ff)}
  .card-body{padding:10px 12px 12px;text-align:center}
  .card .name{font-size:13px;font-weight:800;margin-bottom:2px}
  .card .weight{font-size:11px;font-weight:600;color:#6366f1;background:#eef2ff;padding:2px 8px;border-radius:6px;display:inline-block;margin-bottom:6px}
  .card .price{font-size:20px;font-weight:900;color:#1e3a8a}
  .card .orig{font-size:11px;color:#aaa;text-decoration:line-through}
  .card .saving{font-size:11px;font-weight:700;color:#16a34a;margin-top:2px}
  .card .disc{font-size:10px;font-weight:800;color:#fff;background:#4338ca;padding:2px 8px;border-radius:6px;display:inline-block;margin-top:4px}
  .footer{text-align:center;padding:24px 16px 32px;color:#bbb;font-size:11px}
  `)}
<body>
<div class="hero">
  <div class="store">${escapeHtml(d.storeName)}</div>
  <h1>${escapeHtml(d.title)}</h1>
  <div class="sub">대용량 특가 — 많이 살수록 이득!</div>
  ${d.period ? `<div class="period">${escapeHtml(d.period)}</div>` : ''}
</div>
<div class="content">${itemsHtml}</div>
${footer()}
</body>
</html>`;
}
