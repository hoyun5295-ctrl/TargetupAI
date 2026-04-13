/**
 * ★ 전단AI: 상품별 가격POP 렌더링
 *
 * 상품 1개 = A4 1장 가격표 HTML.
 * puppeteer(flyer-pdf.ts)로 PDF 변환하여 인쇄용으로 제공.
 *
 * 디자인: 마트 가격표 스타일
 * - 상단: 할인율 배지 (빨간 원형) + 상품명 (대형)
 * - 중앙: 가격 (초대형, 72pt+)
 * - 하단: 원가 취소선 + 원산지/규격 + 카드할인 + 뱃지
 */

// ============================================================
// 타입
// ============================================================

export interface PopItem {
  name: string;
  originalPrice: number;
  salePrice: number;
  badge?: string;
  unit?: string;
  origin?: string;
  cardDiscount?: string;
  aiCopy?: string;
  imageUrl?: string;
}

export interface PopOptions {
  storeName?: string;
  /** 매장 주소 */
  storeAddress?: string;
  /** 배경 색상 테마 */
  colorTheme?: 'red' | 'yellow' | 'green' | 'blue' | 'black';
}

// ============================================================
// 색상 테마
// ============================================================

const COLOR_THEMES: Record<string, { bg: string; accent: string; priceColor: string; badgeBg: string; badgeColor: string; textColor: string; subColor: string }> = {
  red: {
    bg: 'linear-gradient(135deg, #fef2f2, #fff)',
    accent: '#dc2626',
    priceColor: '#dc2626',
    badgeBg: '#dc2626',
    badgeColor: '#fff',
    textColor: '#1a1a1a',
    subColor: '#666',
  },
  yellow: {
    bg: 'linear-gradient(135deg, #fefce8, #fff)',
    accent: '#ca8a04',
    priceColor: '#b91c1c',
    badgeBg: '#facc15',
    badgeColor: '#1a1a1a',
    textColor: '#1a1a1a',
    subColor: '#666',
  },
  green: {
    bg: 'linear-gradient(135deg, #f0fdf4, #fff)',
    accent: '#16a34a',
    priceColor: '#dc2626',
    badgeBg: '#16a34a',
    badgeColor: '#fff',
    textColor: '#1a1a1a',
    subColor: '#666',
  },
  blue: {
    bg: 'linear-gradient(135deg, #eff6ff, #fff)',
    accent: '#2563eb',
    priceColor: '#dc2626',
    badgeBg: '#2563eb',
    badgeColor: '#fff',
    textColor: '#1a1a1a',
    subColor: '#666',
  },
  black: {
    bg: 'linear-gradient(135deg, #1a1a1a, #2d2d2d)',
    accent: '#facc15',
    priceColor: '#facc15',
    badgeBg: '#dc2626',
    badgeColor: '#fff',
    textColor: '#fff',
    subColor: '#ccc',
  },
};

// ============================================================
// 가격POP HTML 렌더링
// ============================================================

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtPrice(price: number): string {
  return price.toLocaleString();
}

/**
 * 상품 1개 → A4 1장 가격POP HTML
 */
/**
 * 다분할 POP — A4 한 장에 2/4/8개 상품
 */
export function renderMultiPop(items: PopItem[], splits: 2 | 4 | 8, options: PopOptions = {}): string {
  const t = COLOR_THEMES[options.colorTheme || 'red'];
  const cols = splits <= 2 ? 1 : 2;
  const rows = Math.ceil(splits / cols);
  const cellW = cols === 1 ? '100%' : '50%';
  const cellH = `${100 / rows}%`;
  const priceFontSize = splits <= 2 ? '48pt' : splits <= 4 ? '36pt' : '24pt';
  const nameFontSize = splits <= 2 ? '20pt' : splits <= 4 ? '16pt' : '12pt';

  const cells = items.slice(0, splits).map(item => {
    const disc = item.originalPrice > 0 && item.salePrice > 0 && item.originalPrice > item.salePrice
      ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
    const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
    return `<div class="cell">
      ${disc > 0 ? `<div class="disc-badge">${disc}%</div>` : ''}
      ${item.imageUrl ? `<img src="${esc(item.imageUrl)}" class="cell-img" onerror="this.style.display='none'" />` : ''}
      <div class="cell-name">${esc(item.name)}</div>
      ${item.unit || item.origin ? `<div class="cell-meta">${esc([item.origin, item.unit].filter(Boolean).join(' · '))}</div>` : ''}
      ${hasOrig ? `<div class="cell-orig">${fmtPrice(item.originalPrice)}원</div>` : ''}
      <div class="cell-price">${fmtPrice(item.salePrice)}<span class="won">원</span></div>
      ${item.badge ? `<div class="cell-badge">${esc(item.badge)}</div>` : ''}
      ${item.cardDiscount ? `<div class="cell-card">${esc(item.cardDiscount)}</div>` : ''}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>다분할 POP</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;800;900&display=swap" rel="stylesheet">
<style>
@page{size:A4 portrait;margin:0}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans KR',sans-serif;width:210mm;height:297mm;background:#fff;overflow:hidden}
.header{width:100%;padding:4mm 8mm;background:${t.badgeBg};color:${t.badgeColor};display:flex;justify-content:space-between;align-items:center}
.header-store{font-size:14pt;font-weight:800}
.grid{display:flex;flex-wrap:wrap;width:100%;height:calc(297mm - 16mm)}
.cell{width:${cellW};height:${cellH};border:0.5px solid #eee;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3mm;position:relative;background:${t.bg}}
.disc-badge{position:absolute;top:2mm;right:2mm;background:${t.badgeBg};color:${t.badgeColor};padding:1.5mm 4mm;border-radius:3mm;font-size:${splits <= 4 ? '14pt' : '10pt'};font-weight:900}
.cell-img{max-width:${splits <= 2 ? '40mm' : splits <= 4 ? '28mm' : '18mm'};max-height:${splits <= 2 ? '40mm' : splits <= 4 ? '28mm' : '18mm'};object-fit:contain;margin-bottom:2mm;border-radius:2mm}
.cell-name{font-size:${nameFontSize};font-weight:800;text-align:center;color:${t.textColor};margin-bottom:1mm;line-height:1.3}
.cell-meta{font-size:${splits <= 4 ? '9pt' : '7pt'};color:${t.subColor};margin-bottom:1mm}
.cell-orig{font-size:${splits <= 4 ? '12pt' : '9pt'};color:${t.subColor};text-decoration:line-through}
.cell-price{font-size:${priceFontSize};font-weight:900;color:${t.priceColor};line-height:1.1}.won{font-size:${splits <= 4 ? '16pt' : '12pt'};font-weight:700}
.cell-badge{background:${t.accent};color:#fff;padding:1mm 3mm;border-radius:2mm;font-size:${splits <= 4 ? '9pt' : '7pt'};font-weight:700;margin-top:1mm}
.cell-card{font-size:${splits <= 4 ? '8pt' : '6pt'};color:#16a34a;font-weight:700;margin-top:1mm}
</style></head><body>
<div class="header"><span class="header-store">${esc(options.storeName || '')}</span></div>
<div class="grid">${cells}</div>
</body></html>`;
}

/**
 * 홍보POP (코너 안내판) — 카테고리 헤더 + 상품 리스트형
 */
export function renderPromoPop(category: string, items: PopItem[], options: PopOptions = {}): string {
  const t = COLOR_THEMES[options.colorTheme || 'red'];
  const rows = items.slice(0, 12).map((item, i) => {
    const disc = item.originalPrice > 0 && item.salePrice > 0 && item.originalPrice > item.salePrice
      ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
    return `<tr class="${i % 2 === 0 ? 'even' : ''}">
      <td class="rank">${i + 1}</td>
      <td class="pname">${esc(item.name)}${item.badge ? ` <span class="badge">${esc(item.badge)}</span>` : ''}</td>
      ${item.origin ? `<td class="origin">${esc(item.origin)}</td>` : '<td class="origin"></td>'}
      <td class="price">${fmtPrice(item.salePrice)}원${disc > 0 ? ` <span class="disc">${disc}%↓</span>` : ''}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${esc(category)} 코너 안내</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;800;900&display=swap" rel="stylesheet">
<style>
@page{size:A4 portrait;margin:0}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans KR',sans-serif;width:210mm;height:297mm;background:#fff;overflow:hidden;display:flex;flex-direction:column}
.header{background:${t.badgeBg};color:${t.badgeColor};padding:10mm 12mm;text-align:center}
.header h1{font-size:36pt;font-weight:900;letter-spacing:2px}
.header p{font-size:14pt;font-weight:600;margin-top:2mm;opacity:0.85}
.store{font-size:11pt;font-weight:700;padding:3mm 12mm;background:${t.accent}10;color:${t.textColor};text-align:right}
table{width:100%;border-collapse:collapse;flex:1}
th{background:${t.accent}15;color:${t.textColor};font-size:12pt;font-weight:700;padding:3mm 4mm;text-align:left;border-bottom:2px solid ${t.accent}}
td{padding:3mm 4mm;font-size:12pt;border-bottom:1px solid #eee;color:${t.textColor}}
tr.even{background:#fafafa}
.rank{width:8mm;text-align:center;font-weight:800;color:${t.accent}}
.pname{font-weight:700}
.badge{display:inline-block;background:${t.badgeBg};color:${t.badgeColor};font-size:8pt;font-weight:700;padding:0.5mm 2mm;border-radius:2mm;vertical-align:middle}
.origin{font-size:10pt;color:${t.subColor};width:20mm}
.price{text-align:right;font-weight:800;color:${t.priceColor};font-size:14pt;white-space:nowrap}
.disc{font-size:9pt;color:${t.accent};font-weight:700}
.footer{padding:4mm 12mm;text-align:center;font-size:9pt;color:${t.subColor};border-top:1px solid #eee}
</style></head><body>
<div class="header"><h1>${esc(category)}</h1><p>오늘의 추천 상품</p></div>
<div class="store">${esc(options.storeName || '')}</div>
<table><tr><th></th><th>상품명</th><th>원산지</th><th style="text-align:right">가격</th></tr>${rows}</table>
<div class="footer">hanjul-flyer.kr${options.storeAddress ? ' | ' + esc(options.storeAddress) : ''}</div>
</body></html>`;
}

/**
 * 상품 1개 → A4 1장 가격POP HTML
 */
export function renderPricePop(item: PopItem, options: PopOptions = {}): string {
  const t = COLOR_THEMES[options.colorTheme || 'red'];
  const disc = item.originalPrice > 0 && item.salePrice > 0 && item.originalPrice > item.salePrice
    ? Math.round((1 - item.salePrice / item.originalPrice) * 100)
    : 0;
  const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
  const saved = hasOrig ? item.originalPrice - item.salePrice : 0;

  // 메타 칩 (원산지/규격)
  const chips: string[] = [];
  if (item.origin) chips.push(esc(item.origin));
  if (item.unit) chips.push(esc(item.unit));

  // 이미지 처리 — 이미지 없으면 상품 이니셜 원형 표시
  const hasImage = !!item.imageUrl;
  const initial = (item.name || '').charAt(0);
  const imageHtml = hasImage
    ? `<div class="img-wrap"><img src="${esc(item.imageUrl!)}" alt="${esc(item.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="img-fallback" style="display:none">${esc(initial)}</div></div>`
    : `<div class="img-wrap"><div class="img-fallback">${esc(initial)}</div></div>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${esc(item.name)} 가격표</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;800;900&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 0; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Noto Sans KR', sans-serif;
    width: 210mm; height: 297mm;
    background: ${t.bg};
    display: flex; flex-direction: column;
    align-items: center;
    padding: 0;
    color: ${t.textColor};
    position: relative;
    overflow: hidden;
  }
  /* ── 상단 매장명 바 ── */
  .header {
    width: 100%; padding: 6mm 10mm;
    background: ${t.badgeBg}; color: ${t.badgeColor};
    display: flex; justify-content: space-between; align-items: center;
  }
  .header-store { font-size: 16pt; font-weight: 800; letter-spacing: 1px; }
  .header-badge { font-size: 18pt; font-weight: 900; background: rgba(255,255,255,0.2); padding: 2mm 8mm; border-radius: 4mm; }
  /* ── 상품 이미지 ── */
  .img-wrap { width: 100%; display: flex; justify-content: center; padding: 8mm 20mm 4mm; }
  .img-wrap img { max-width: 60mm; max-height: 60mm; object-fit: contain; border-radius: 4mm; }
  .img-fallback { width: 50mm; height: 50mm; border-radius: 50%; background: ${t.accent}15; color: ${t.accent}; display: flex; align-items: center; justify-content: center; font-size: 48pt; font-weight: 900; }
  /* ── 본문 ── */
  .content { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4mm 15mm; }
  .disc-badge {
    width: 32mm; height: 32mm; border-radius: 50%;
    background: ${t.badgeBg}; color: ${t.badgeColor};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    margin-bottom: 6mm; box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  }
  .disc-num { font-size: 38pt; font-weight: 900; line-height: 1; }
  .disc-pct { font-size: 14pt; font-weight: 700; margin-top: -1mm; }
  .name { font-size: 30pt; font-weight: 800; text-align: center; line-height: 1.3; margin-bottom: 4mm; letter-spacing: -0.5px; }
  .chips { display: flex; gap: 3mm; margin-bottom: 4mm; flex-wrap: wrap; justify-content: center; }
  .chip { font-size: 11pt; font-weight: 600; padding: 2mm 5mm; border-radius: 4mm; border: 1.5px solid ${t.accent}; color: ${t.accent}; }
  .orig-price { font-size: 18pt; color: ${t.subColor}; text-decoration: line-through; margin-bottom: 2mm; }
  .sale-row { display: flex; align-items: baseline; gap: 3mm; margin-bottom: 3mm; }
  .sale-price { font-size: 72pt; font-weight: 900; color: ${t.priceColor}; line-height: 1; letter-spacing: -2px; }
  .sale-won { font-size: 28pt; font-weight: 700; color: ${t.priceColor}; }
  .saved { font-size: 14pt; font-weight: 700; color: ${t.accent}; background: ${t.accent}15; padding: 2mm 6mm; border-radius: 3mm; margin-bottom: 3mm; }
  .card-disc { font-size: 13pt; font-weight: 700; color: #16a34a; margin-bottom: 2mm; }
  .ai-copy { font-size: 12pt; color: ${t.subColor}; margin-top: 3mm; text-align: center; line-height: 1.5; }
  /* ── 하단 푸터 ── */
  .footer {
    width: 100%; padding: 5mm 10mm;
    border-top: 1px solid ${t.accent}20;
    display: flex; justify-content: space-between; align-items: center;
  }
  .footer-store { font-size: 10pt; font-weight: 700; color: ${t.textColor}; }
  .footer-addr { font-size: 8pt; color: ${t.subColor}; }
  .footer-brand { font-size: 8pt; color: ${t.subColor}; opacity: 0.5; }
</style>
</head>
<body>
  <div class="header">
    <span class="header-store">${esc(options.storeName || '')}</span>
    ${item.badge ? `<span class="header-badge">${esc(item.badge)}</span>` : ''}
  </div>
  ${imageHtml}
  <div class="content">
    ${disc > 0 ? `<div class="disc-badge"><span class="disc-num">${disc}</span><span class="disc-pct">%</span></div>` : ''}
    <div class="name">${esc(item.name)}</div>
    ${chips.length > 0 ? `<div class="chips">${chips.map(c => `<span class="chip">${c}</span>`).join('')}</div>` : ''}
    ${hasOrig ? `<div class="orig-price">${fmtPrice(item.originalPrice)}원</div>` : ''}
    <div class="sale-row">
      <span class="sale-price">${fmtPrice(item.salePrice)}</span>
      <span class="sale-won">원</span>
    </div>
    ${saved > 0 ? `<div class="saved">${fmtPrice(saved)}원 절약!</div>` : ''}
    ${item.cardDiscount ? `<div class="card-disc">💳 ${esc(item.cardDiscount)}</div>` : ''}
    ${item.aiCopy ? `<div class="ai-copy">${esc(item.aiCopy)}</div>` : ''}
  </div>
  <div class="footer">
    <div>
      <div class="footer-store">${esc(options.storeName || '')}</div>
      ${options.storeAddress ? `<div class="footer-addr">${esc(options.storeAddress)}</div>` : ''}
    </div>
    <div class="footer-brand">hanjul-flyer.kr</div>
  </div>
</body>
</html>`;
}
