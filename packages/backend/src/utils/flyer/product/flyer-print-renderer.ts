/**
 * ★ CT-F21 — 인쇄용 전단 HTML 렌더러
 *
 * Phase 2: CSV/POS 상품 데이터 → 인쇄용 전단 HTML → puppeteer → 300dpi PDF
 *
 * 레이아웃 계층:
 *   헤더(매장정보) → 메인배너 → 메인행사(2열, 4~6개) → 중간배너
 *   → 서브행사(3열, 8~12개) → 카테고리별(4열) → 푸터
 *
 * 기존 flyer-pdf.ts (CT-F11) 재활용: generatePdfFromHtml()
 */

// ============================================================
// 타입
// ============================================================
export interface PrintProduct {
  productName: string;
  originalPrice?: number;
  salePrice: number;
  unit?: string;
  category?: string;
  imageUrl?: string;
  promoType: 'main' | 'sub' | 'general'; // 메인행사 / 서브행사 / 일반
  aiCopy?: string;
  origin?: string;
}

export interface PrintStoreInfo {
  storeName: string;
  address?: string;
  phone?: string;
  hours?: string;
  logoUrl?: string;
}

export interface PrintTheme {
  name: string;
  primary: string;    // 메인 색상
  secondary: string;  // 서브 색상
  accent: string;     // 강조 색상
  bg: string;         // 배경 색상
  textDark: string;
  textLight: string;
}

export interface PrintFlyerData {
  store: PrintStoreInfo;
  title: string;
  period: string;
  products: PrintProduct[];
  theme?: PrintTheme;
  mainBannerUrl?: string;
  midBannerUrl?: string;
  paperSize?: 'A4' | 'B4' | 'tabloid';
}

// ============================================================
// 기본 테마
// ============================================================
const DEFAULT_THEMES: Record<string, PrintTheme> = {
  fresh_green: {
    name: '신선 그린',
    primary: '#2d8b4e', secondary: '#4caf50', accent: '#ff5722',
    bg: '#ffffff', textDark: '#1a1a1a', textLight: '#666666',
  },
  warm_orange: {
    name: '따뜻한 오렌지',
    primary: '#e65100', secondary: '#ff9800', accent: '#d32f2f',
    bg: '#fffbf5', textDark: '#1a1a1a', textLight: '#666666',
  },
  cool_blue: {
    name: '시원한 블루',
    primary: '#1565c0', secondary: '#42a5f5', accent: '#ff5722',
    bg: '#f5f9ff', textDark: '#1a1a1a', textLight: '#666666',
  },
  premium_dark: {
    name: '프리미엄 다크',
    primary: '#1a1a2e', secondary: '#e94560', accent: '#ffd93d',
    bg: '#0f0f1a', textDark: '#ffffff', textLight: '#cccccc',
  },
};

// ============================================================
// 용지 사이즈 (mm → px @ 300dpi)
// ============================================================
const PAPER_SIZES: Record<string, { widthMm: number; heightMm: number; widthPx: number; heightPx: number }> = {
  A4:      { widthMm: 210, heightMm: 297, widthPx: 2480, heightPx: 3508 },
  B4:      { widthMm: 250, heightMm: 353, widthPx: 2953, heightPx: 4169 },
  tabloid: { widthMm: 279, heightMm: 432, widthPx: 3300, heightPx: 5100 },
};

// ============================================================
// 가격 포맷
// ============================================================
function fmtPrice(n: number): string {
  return n.toLocaleString();
}

function calcDiscount(orig: number, sale: number): number {
  return orig > 0 && orig !== sale ? Math.round((1 - sale / orig) * 100) : 0;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// ★ 메인 렌더러
// ============================================================
export function renderPrintFlyer(data: PrintFlyerData): string {
  const t = data.theme || DEFAULT_THEMES.fresh_green;
  const paper = PAPER_SIZES[data.paperSize || 'A4'];
  const { store, title, period, products } = data;

  // 상품 분류
  const mainItems = products.filter(p => p.promoType === 'main').slice(0, 6);
  const subItems = products.filter(p => p.promoType === 'sub').slice(0, 12);
  const generalItems = products.filter(p => p.promoType === 'general');

  // 카테고리별 그룹핑 (일반 상품)
  const categories: Record<string, PrintProduct[]> = {};
  for (const item of generalItems) {
    const cat = item.category || '기타';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(item);
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans KR',sans-serif;width:${paper.widthPx}px;min-height:${paper.heightPx}px;background:${t.bg};color:${t.textDark};overflow:hidden}

/* 헤더 */
.print-header{background:${t.primary};color:#fff;padding:40px 60px;display:flex;justify-content:space-between;align-items:center}
.print-header h1{font-size:72px;font-weight:900;letter-spacing:-1px}
.print-store-info{text-align:right;font-size:28px;line-height:1.6;opacity:.9}
.print-period{background:${t.accent};color:#fff;text-align:center;padding:20px;font-size:36px;font-weight:700;letter-spacing:2px}

/* 메인 배너 */
.print-banner{width:100%;overflow:hidden}
.print-banner img{width:100%;display:block}

/* 메인행사 — 2열 대형 카드 */
.print-section-title{font-size:48px;font-weight:900;color:${t.primary};text-align:center;padding:40px 0 20px;border-bottom:4px solid ${t.primary};margin:0 60px}
.main-grid{display:grid;grid-template-columns:1fr 1fr;gap:30px;padding:30px 60px}
.main-card{background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);border:2px solid #f0f0f0;position:relative}
.main-card-img{height:400px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center}
.main-card-img img{max-width:100%;max-height:100%;object-fit:contain}
.main-card-body{padding:24px 28px}
.main-card-name{font-size:36px;font-weight:700;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.main-card-unit{font-size:22px;color:${t.textLight}}
.main-card-prices{display:flex;align-items:baseline;gap:16px;margin-top:12px}
.main-card-sale{font-size:52px;font-weight:900;color:${t.accent}}
.main-card-orig{font-size:28px;color:#999;text-decoration:line-through}
.main-card-disc{position:absolute;top:16px;right:16px;background:${t.accent};color:#fff;padding:10px 18px;border-radius:30px;font-size:28px;font-weight:900}
.main-card-copy{font-size:22px;color:${t.textLight};margin-top:10px;line-height:1.4}

/* 서브행사 — 3열 중형 카드 */
.sub-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;padding:20px 60px}
.sub-card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06);border:1px solid #eee;position:relative}
.sub-card-img{height:260px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center}
.sub-card-img img{max-width:100%;max-height:100%;object-fit:contain}
.sub-card-body{padding:16px 20px}
.sub-card-name{font-size:28px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sub-card-prices{display:flex;align-items:baseline;gap:10px;margin-top:8px}
.sub-card-sale{font-size:38px;font-weight:900;color:${t.accent}}
.sub-card-orig{font-size:22px;color:#999;text-decoration:line-through}
.sub-card-disc{position:absolute;top:12px;right:12px;background:${t.accent};color:#fff;padding:6px 14px;border-radius:20px;font-size:22px;font-weight:800}

/* 카테고리별 — 4열 소형 카드 */
.cat-section{padding:10px 60px}
.cat-title{font-size:32px;font-weight:800;color:${t.secondary};padding:16px 0 12px;border-bottom:2px solid ${t.secondary}}
.cat-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:14px;padding:14px 0}
.cat-card{background:#fff;border-radius:12px;overflow:hidden;border:1px solid #eee;text-align:center;padding:12px}
.cat-card-img{height:160px;overflow:hidden;background:#f5f5f5;border-radius:8px;margin-bottom:8px;display:flex;align-items:center;justify-content:center}
.cat-card-img img{max-width:100%;max-height:100%;object-fit:contain}
.cat-card-name{font-size:22px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cat-card-price{font-size:30px;font-weight:900;color:${t.accent};margin-top:4px}

/* 푸터 */
.print-footer{background:${t.primary};color:#fff;padding:40px 60px;text-align:center;margin-top:40px}
.print-footer-info{font-size:28px;line-height:1.8;opacity:.9}

@media print{body{width:${paper.widthMm}mm;min-height:${paper.heightMm}mm}}
</style>
</head>
<body>

<!-- 헤더 -->
<div class="print-header">
  <h1>${escHtml(title)}</h1>
  <div class="print-store-info">
    <div style="font-size:36px;font-weight:700">${escHtml(store.storeName)}</div>
    ${store.phone ? `<div>${escHtml(store.phone)}</div>` : ''}
    ${store.address ? `<div>${escHtml(store.address)}</div>` : ''}
  </div>
</div>
${period ? `<div class="print-period">${escHtml(period)}</div>` : ''}

<!-- 메인 배너 -->
${data.mainBannerUrl ? `<div class="print-banner"><img src="${data.mainBannerUrl}" alt=""></div>` : ''}

<!-- 메인행사 -->
${mainItems.length > 0 ? `
<div class="print-section-title">BEST SALE</div>
<div class="main-grid">
${mainItems.map(item => {
  const disc = calcDiscount(item.originalPrice || 0, item.salePrice);
  return `<div class="main-card">
    ${disc > 0 ? `<div class="main-card-disc">${disc}%</div>` : ''}
    <div class="main-card-img">${item.imageUrl ? `<img src="${item.imageUrl}" alt="">` : ''}</div>
    <div class="main-card-body">
      <div class="main-card-name">${escHtml(item.productName)}</div>
      ${item.unit ? `<div class="main-card-unit">${escHtml(item.unit)}</div>` : ''}
      <div class="main-card-prices">
        <span class="main-card-sale">${fmtPrice(item.salePrice)}\uC6D0</span>
        ${item.originalPrice && item.originalPrice !== item.salePrice ? `<span class="main-card-orig">${fmtPrice(item.originalPrice)}\uC6D0</span>` : ''}
      </div>
      ${item.aiCopy ? `<div class="main-card-copy">${escHtml(item.aiCopy)}</div>` : ''}
    </div>
  </div>`;
}).join('')}
</div>` : ''}

<!-- 중간 배너 -->
${data.midBannerUrl ? `<div class="print-banner"><img src="${data.midBannerUrl}" alt=""></div>` : ''}

<!-- 서브행사 -->
${subItems.length > 0 ? `
<div class="print-section-title">HOT DEAL</div>
<div class="sub-grid">
${subItems.map(item => {
  const disc = calcDiscount(item.originalPrice || 0, item.salePrice);
  return `<div class="sub-card">
    ${disc > 0 ? `<div class="sub-card-disc">${disc}%</div>` : ''}
    <div class="sub-card-img">${item.imageUrl ? `<img src="${item.imageUrl}" alt="">` : ''}</div>
    <div class="sub-card-body">
      <div class="sub-card-name">${escHtml(item.productName)}</div>
      <div class="sub-card-prices">
        <span class="sub-card-sale">${fmtPrice(item.salePrice)}\uC6D0</span>
        ${item.originalPrice && item.originalPrice !== item.salePrice ? `<span class="sub-card-orig">${fmtPrice(item.originalPrice)}\uC6D0</span>` : ''}
      </div>
    </div>
  </div>`;
}).join('')}
</div>` : ''}

<!-- 카테고리별 일반 상품 -->
${Object.keys(categories).length > 0 ? Object.entries(categories).map(([catName, items]) => `
<div class="cat-section">
  <div class="cat-title">${escHtml(catName)}</div>
  <div class="cat-grid">
    ${items.map(item => `
    <div class="cat-card">
      <div class="cat-card-img">${item.imageUrl ? `<img src="${item.imageUrl}" alt="">` : ''}</div>
      <div class="cat-card-name">${escHtml(item.productName)}</div>
      <div class="cat-card-price">${fmtPrice(item.salePrice)}\uC6D0</div>
    </div>`).join('')}
  </div>
</div>`).join('') : ''}

<!-- 푸터 -->
<div class="print-footer">
  <div class="print-footer-info">
    <div style="font-size:36px;font-weight:700;margin-bottom:12px">${escHtml(store.storeName)}</div>
    ${store.address ? `<div>${escHtml(store.address)}</div>` : ''}
    ${store.phone ? `<div>${escHtml(store.phone)}</div>` : ''}
    ${store.hours ? `<div>\uC601\uC5C5\uC2DC\uAC04: ${escHtml(store.hours)}</div>` : ''}
  </div>
</div>

</body>
</html>`;
}

/** 사용 가능한 테마 목록 */
export function getAvailableThemes(): PrintTheme[] {
  return Object.values(DEFAULT_THEMES);
}

/** 테마 이름으로 조회 */
export function getThemeByName(name: string): PrintTheme | undefined {
  return DEFAULT_THEMES[name];
}
