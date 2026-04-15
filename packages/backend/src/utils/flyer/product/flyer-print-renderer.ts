/**
 * ★ CT-F21 — 인쇄용 전단 HTML 렌더러 V2 (완전 재작성)
 *
 * 한국 마트 전단지 실제 규격 기반:
 *   A3 (420x297mm) — 대형마트
 *   B4 (364x257mm) — 동네마트
 *   A4 (297x210mm) — 소형전단
 *   8절 (370x260mm) — 한국 전통규격
 *   타블로이드 (432x279mm) — 신문형
 *
 * 레이아웃 패턴 (한국 마트 전단 표준):
 *   ┌─────────────────────────────────────┐
 *   │  매장 로고 │ 매장 정보 │ 전화/QR     │ ← 헤더 (매장별 고정)
 *   ├─────────────────────────────────────┤
 *   │  ★ 메인 타이틀 배너                   │ ← 행사명 (봄세일 특가전)
 *   ├─────────────────────────────────────┤
 *   │  [메인1] [메인2] [메인3] [메인4]     │ ← 메인행사 (대형 카드 4열)
 *   ├─────────────────────────────────────┤
 *   │  카테고리명                           │
 *   │  [상품] [상품] [상품] [상품]          │ ← 카테고리별 (4열 그리드)
 *   │  [상품] [상품] [상품] [상품]          │
 *   ├─────────────────────────────────────┤
 *   │  매장 주소 │ 영업시간 │ 전화번호      │ ← 푸터
 *   └─────────────────────────────────────┘
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
  promoType: 'main' | 'sub' | 'general';
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
  primary: string;
  secondary: string;
  accent: string;
  bg: string;
  headerBg: string;
  headerText: string;
  priceBg: string;
  priceText: string;
  badgeBg: string;
  badgeText: string;
  cardBg: string;
  catHeaderBg: string;
  catHeaderText: string;
}

export interface PrintFlyerData {
  store: PrintStoreInfo;
  title: string;
  period: string;
  products: PrintProduct[];
  theme?: PrintTheme;
  templateCode?: string; // spring, summer, autumn, winter, chuseok, seol, basic_green, basic_red, basic_blue
  mainBannerUrl?: string;
  paperSize?: 'A3' | 'B4' | 'A4' | '8cut' | 'tabloid';
}

// ============================================================
// 템플릿별 레이아웃 설정
// ============================================================
interface LayoutConfig {
  mainCols: number;       // 메인 상품 열 수
  mainCardSize: 'large' | 'medium';
  catCols: number;        // 카테고리 상품 열 수
  catCardSize: 'medium' | 'small';
  maxMainItems: number;   // 메인 섹션 최대 상품 수
  headerStyle: 'gradient' | 'solid' | 'banner';
  showSubTitle: boolean;  // 서브 타이틀 (행사 설명) 표시
}

const LAYOUT_CONFIGS: Record<string, LayoutConfig> = {
  // 시즌별 — 각기 다른 레이아웃
  spring:      { mainCols: 4, mainCardSize: 'large',  catCols: 4, catCardSize: 'medium', maxMainItems: 4, headerStyle: 'gradient', showSubTitle: true },
  summer:      { mainCols: 3, mainCardSize: 'large',  catCols: 4, catCardSize: 'medium', maxMainItems: 6, headerStyle: 'gradient', showSubTitle: true },
  autumn:      { mainCols: 2, mainCardSize: 'large',  catCols: 4, catCardSize: 'medium', maxMainItems: 4, headerStyle: 'gradient', showSubTitle: true },
  winter:      { mainCols: 4, mainCardSize: 'medium', catCols: 5, catCardSize: 'small',  maxMainItems: 8, headerStyle: 'gradient', showSubTitle: false },
  chuseok:     { mainCols: 3, mainCardSize: 'large',  catCols: 3, catCardSize: 'medium', maxMainItems: 6, headerStyle: 'banner',   showSubTitle: true },
  seol:        { mainCols: 2, mainCardSize: 'large',  catCols: 3, catCardSize: 'medium', maxMainItems: 4, headerStyle: 'banner',   showSubTitle: true },
  // 기본형 — 심플
  basic_green: { mainCols: 4, mainCardSize: 'large',  catCols: 4, catCardSize: 'medium', maxMainItems: 8, headerStyle: 'solid',    showSubTitle: false },
  basic_red:   { mainCols: 4, mainCardSize: 'medium', catCols: 4, catCardSize: 'small',  maxMainItems: 8, headerStyle: 'solid',    showSubTitle: false },
  basic_blue:  { mainCols: 3, mainCardSize: 'large',  catCols: 4, catCardSize: 'medium', maxMainItems: 6, headerStyle: 'solid',    showSubTitle: false },
};

// ============================================================
// 용지 사이즈 (mm → px @ 300dpi, 1mm = 11.811px)
// ============================================================
const PAPER_SIZES: Record<string, { widthMm: number; heightMm: number; widthPx: number; heightPx: number; label: string }> = {
  A3:       { widthMm: 420, heightMm: 297, widthPx: 4961, heightPx: 3508, label: 'A3 (420x297mm)' },
  B4:       { widthMm: 364, heightMm: 257, widthPx: 4299, heightPx: 3035, label: 'B4 (364x257mm)' },
  A4:       { widthMm: 297, heightMm: 210, widthPx: 3508, heightPx: 2480, label: 'A4 (297x210mm)' },
  '8cut':   { widthMm: 370, heightMm: 260, widthPx: 4370, heightPx: 3071, label: '8절 (370x260mm)' },
  tabloid:  { widthMm: 432, heightMm: 279, widthPx: 5104, heightPx: 3296, label: '타블로이드 (432x279mm)' },
};

// ============================================================
// 테마 (5종)
// ============================================================
const THEMES: Record<string, PrintTheme> = {
  // ===== 시즌별 테마 =====
  spring: {
    name: '봄 세일',
    primary: '#ec4899', secondary: '#f9a8d4', accent: '#dc2626',
    bg: '#fff1f2', headerBg: 'linear-gradient(135deg,#ec4899,#f472b6,#a855f7)',
    headerText: '#ffffff',
    priceBg: '#fdf2f8', priceText: '#be185d',
    badgeBg: '#dc2626', badgeText: '#ffffff',
    cardBg: '#fdf2f8', catHeaderBg: '#ec4899', catHeaderText: '#ffffff',
  },
  summer: {
    name: '여름 특가',
    primary: '#0891b2', secondary: '#22d3ee', accent: '#dc2626',
    bg: '#ecfeff', headerBg: 'linear-gradient(135deg,#0891b2,#06b6d4,#0ea5e9)',
    headerText: '#ffffff',
    priceBg: '#ecfeff', priceText: '#0e7490',
    badgeBg: '#dc2626', badgeText: '#ffffff',
    cardBg: '#ecfeff', catHeaderBg: '#0891b2', catHeaderText: '#ffffff',
  },
  autumn: {
    name: '가을 수확',
    primary: '#d97706', secondary: '#fbbf24', accent: '#dc2626',
    bg: '#fffbeb', headerBg: 'linear-gradient(135deg,#92400e,#d97706,#f59e0b)',
    headerText: '#ffffff',
    priceBg: '#fffbeb', priceText: '#b45309',
    badgeBg: '#dc2626', badgeText: '#ffffff',
    cardBg: '#fef3c7', catHeaderBg: '#d97706', catHeaderText: '#ffffff',
  },
  winter: {
    name: '겨울 행사',
    primary: '#1e40af', secondary: '#60a5fa', accent: '#dc2626',
    bg: '#eff6ff', headerBg: 'linear-gradient(135deg,#1e3a5f,#1e40af,#3b82f6)',
    headerText: '#ffffff',
    priceBg: '#eff6ff', priceText: '#1e40af',
    badgeBg: '#dc2626', badgeText: '#ffffff',
    cardBg: '#dbeafe', catHeaderBg: '#1e40af', catHeaderText: '#ffffff',
  },
  chuseok: {
    name: '추석 한가위',
    primary: '#b91c1c', secondary: '#f87171', accent: '#ca8a04',
    bg: '#fef2f2', headerBg: 'linear-gradient(135deg,#7f1d1d,#b91c1c,#dc2626)',
    headerText: '#fef08a',
    priceBg: '#fef2f2', priceText: '#b91c1c',
    badgeBg: '#ca8a04', badgeText: '#ffffff',
    cardBg: '#fef2f2', catHeaderBg: '#b91c1c', catHeaderText: '#fef08a',
  },
  seol: {
    name: '설 명절',
    primary: '#1d4ed8', secondary: '#93c5fd', accent: '#dc2626',
    bg: '#eff6ff', headerBg: 'linear-gradient(135deg,#1e3a8a,#1d4ed8,#2563eb)',
    headerText: '#fef08a',
    priceBg: '#eff6ff', priceText: '#1d4ed8',
    badgeBg: '#dc2626', badgeText: '#ffffff',
    cardBg: '#dbeafe', catHeaderBg: '#1d4ed8', catHeaderText: '#fef08a',
  },
  // ===== 기본형 =====
  basic_green: {
    name: '기본 (그린)',
    primary: '#059669', secondary: '#10b981', accent: '#dc2626',
    bg: '#ffffff', headerBg: '#059669',
    headerText: '#ffffff',
    priceBg: '#f0fdf4', priceText: '#dc2626',
    badgeBg: '#dc2626', badgeText: '#ffffff',
    cardBg: '#f0fdf4', catHeaderBg: '#059669', catHeaderText: '#ffffff',
  },
  basic_red: {
    name: '기본 (레드)',
    primary: '#dc2626', secondary: '#f87171', accent: '#fbbf24',
    bg: '#ffffff', headerBg: '#dc2626',
    headerText: '#ffffff',
    priceBg: '#fef2f2', priceText: '#dc2626',
    badgeBg: '#fbbf24', badgeText: '#1f2937',
    cardBg: '#fef2f2', catHeaderBg: '#dc2626', catHeaderText: '#ffffff',
  },
  basic_blue: {
    name: '기본 (블루)',
    primary: '#2563eb', secondary: '#3b82f6', accent: '#dc2626',
    bg: '#ffffff', headerBg: '#2563eb',
    headerText: '#ffffff',
    priceBg: '#eff6ff', priceText: '#2563eb',
    badgeBg: '#dc2626', badgeText: '#ffffff',
    cardBg: '#eff6ff', catHeaderBg: '#2563eb', catHeaderText: '#ffffff',
  },
};

// ============================================================
// 헬퍼
// ============================================================
function fmt(n: number): string { return n.toLocaleString(); }
function disc(orig: number, sale: number): number {
  return orig > 0 && orig !== sale ? Math.round((1 - sale / orig) * 100) : 0;
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// 상품 카드 렌더링
// ============================================================
function renderProductCard(item: PrintProduct, t: PrintTheme, size: 'large' | 'medium' | 'small'): string {
  const d = disc(item.originalPrice || 0, item.salePrice);
  const imgSize = size === 'large' ? 280 : size === 'medium' ? 200 : 150;
  const nameSize = size === 'large' ? 24 : size === 'medium' ? 18 : 14;
  const priceSize = size === 'large' ? 36 : size === 'medium' ? 28 : 22;
  const padding = size === 'large' ? 16 : size === 'medium' ? 12 : 8;

  return `<div style="background:${t.cardBg};border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;text-align:center;position:relative">
    ${d > 0 ? `<div style="position:absolute;top:8px;left:8px;background:${t.badgeBg};color:${t.badgeText};padding:4px 10px;border-radius:20px;font-size:${size === 'small' ? 12 : 16}px;font-weight:900;z-index:1">${d}%</div>` : ''}
    <div style="height:${imgSize}px;display:flex;align-items:center;justify-content:center;background:#f9fafb;overflow:hidden">
      ${item.imageUrl ? `<img src="${esc(item.imageUrl)}" style="max-width:100%;max-height:100%;object-fit:contain" alt="">` : `<div style="font-size:${imgSize * 0.3}px;opacity:0.15">&#128230;</div>`}
    </div>
    <div style="padding:${padding}px">
      <div style="font-size:${nameSize}px;font-weight:700;color:#1f2937;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.productName)}</div>
      ${item.unit ? `<div style="font-size:${nameSize - 4}px;color:#6b7280">${esc(item.unit)}</div>` : ''}
      ${item.originalPrice && item.originalPrice !== item.salePrice ? `<div style="font-size:${nameSize - 2}px;color:#9ca3af;text-decoration:line-through;margin-top:4px">${fmt(item.originalPrice)}\uC6D0</div>` : ''}
      <div style="font-size:${priceSize}px;font-weight:900;color:${t.priceText};margin-top:2px">${fmt(item.salePrice)}<span style="font-size:${priceSize - 8}px;font-weight:400">\uC6D0</span></div>
    </div>
  </div>`;
}

// ============================================================
// ★ 메인 렌더러
// ============================================================
export function renderPrintFlyer(data: PrintFlyerData): string {
  const tplCode = data.templateCode || 'basic_green';
  const t = data.theme || THEMES[tplCode] || THEMES.basic_green;
  const layout = LAYOUT_CONFIGS[tplCode] || LAYOUT_CONFIGS.basic_green;
  const paper = PAPER_SIZES[data.paperSize || 'A3'];
  const { store, title, period, products } = data;

  // 상품 분류
  const mainItems = products.filter(p => p.promoType === 'main').slice(0, layout.maxMainItems);
  const subItems = products.filter(p => p.promoType === 'sub');
  const generalItems = products.filter(p => p.promoType === 'general');

  // 카테고리별 그룹핑
  const allNonMain = [...subItems, ...generalItems];
  const categories: Record<string, PrintProduct[]> = {};
  for (const item of allNonMain) {
    const cat = item.category || '\uAE30\uD0C0';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(item);
  }

  // 가로 방향 (landscape) — 마트 전단은 가로가 표준
  const W = paper.widthPx;
  const H = paper.heightPx;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans KR',sans-serif;width:${W}px;height:${H}px;background:${t.bg};color:#1f2937;overflow:hidden}

.header{display:grid;grid-template-columns:1fr 2fr 1fr;background:${t.headerBg};color:${t.headerText};padding:30px 40px;align-items:center}
.header-banner{background:${t.headerBg};color:${t.headerText};padding:40px;text-align:center}
.header-logo{font-size:36px;font-weight:900;letter-spacing:-1px}
.header-title{text-align:center}
.header-title h1{font-size:48px;font-weight:900;letter-spacing:-1px;line-height:1.1}
.header-title .period{font-size:20px;opacity:0.8;margin-top:6px;font-weight:400}
.header-contact{text-align:right;font-size:18px;line-height:1.8;opacity:0.9}

.main-section{padding:20px 40px}
.main-section-title{font-size:28px;font-weight:900;color:${t.primary};text-align:center;padding:16px 0;border-bottom:4px solid ${t.primary};margin-bottom:16px}
.main-grid{display:grid;grid-template-columns:repeat(${layout.mainCols},1fr);gap:16px}

.cat-header{background:${t.catHeaderBg};color:${t.catHeaderText};padding:10px 20px;font-size:22px;font-weight:800;margin-top:20px;border-radius:8px 8px 0 0}
.cat-grid{display:grid;grid-template-columns:repeat(${layout.catCols},1fr);gap:12px;padding:16px 0}

.footer{background:${t.headerBg};color:${t.headerText};padding:20px 40px;display:grid;grid-template-columns:1fr 1fr 1fr;font-size:18px;text-align:center;margin-top:auto}
.footer div{opacity:0.9}

@media print{
  body{width:${paper.widthMm}mm;height:${paper.heightMm}mm}
  @page{size:${paper.widthMm}mm ${paper.heightMm}mm;margin:0}
}
</style>
</head>
<body style="display:flex;flex-direction:column">

<!-- 헤더 -->
<div class="header">
  <div class="header-logo">${esc(store.storeName || '\uB9C8\uD2B8\uBA85')}</div>
  <div class="header-title">
    <h1>${esc(title || '\uD589\uC0AC \uC804\uB2E8')}</h1>
    ${period ? `<div class="period">${esc(period)}</div>` : ''}
  </div>
  <div class="header-contact">
    ${store.phone ? `<div>${esc(store.phone)}</div>` : ''}
    ${store.hours ? `<div>${esc(store.hours)}</div>` : ''}
    ${store.address ? `<div style="font-size:14px">${esc(store.address)}</div>` : ''}
  </div>
</div>

<!-- 메인행사 -->
${mainItems.length > 0 ? `
<div class="main-section">
  <div class="main-section-title">BEST SALE</div>
  <div class="main-grid">
    ${mainItems.map(item => renderProductCard(item, t, layout.mainCardSize)).join('')}
  </div>
</div>` : ''}

<!-- 카테고리별 -->
<div style="padding:0 40px;flex:1">
${Object.entries(categories).map(([catName, items]) => `
  <div class="cat-header">${esc(catName)}</div>
  <div class="cat-grid">
    ${items.map(item => renderProductCard(item, t, layout.catCardSize)).join('')}
  </div>
`).join('')}
</div>

<!-- 푸터 -->
<div class="footer">
  <div>${esc(store.address || '')}</div>
  <div>${esc(store.hours ? '\uC601\uC5C5\uC2DC\uAC04: ' + store.hours : '')}</div>
  <div>${esc(store.phone || '')}</div>
</div>

</body>
</html>`;
}

/** 사용 가능한 테마 목록 */
export function getAvailableThemes(): PrintTheme[] {
  return Object.values(THEMES);
}

/** 테마 이름으로 조회 */
export function getThemeByName(name: string): PrintTheme | undefined {
  return THEMES[name];
}

/** 용지 사이즈 목록 */
export function getAvailablePaperSizes() {
  return Object.entries(PAPER_SIZES).map(([key, val]) => ({ value: key, label: val.label }));
}
