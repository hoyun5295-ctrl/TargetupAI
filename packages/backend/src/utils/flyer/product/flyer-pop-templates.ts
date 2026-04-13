/**
 * ★ 전단AI: 상품별 가격POP 렌더링 (V2 — 마트 현장 POP 스타일)
 *
 * 실제 마트 가격POP 스타일:
 * - 강렬한 배경 (빨강/노랑 꽉 채움)
 * - 할인율 초대형 (A4 상단 1/3)
 * - 가격 초초대형 (눈에 꽂히게)
 * - 별/폭발 장식으로 시선 집중
 * - 여백 최소화, 정보 밀도 최대화
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
  storeAddress?: string;
  colorTheme?: 'red' | 'yellow' | 'green' | 'blue' | 'black';
}

// ============================================================
// 색상 테마 (V2 — 강렬한 마트 스타일)
// ============================================================

const COLOR_THEMES: Record<string, {
  headerBg: string; headerColor: string;
  bodyBg: string; bodyColor: string;
  priceBg: string; priceColor: string;
  discBg: string; discColor: string;
  badgeBg: string; badgeColor: string;
  origColor: string; savedBg: string; savedColor: string;
  borderColor: string;
}> = {
  red: {
    headerBg: '#dc2626', headerColor: '#fff',
    bodyBg: '#fff', bodyColor: '#1a1a1a',
    priceBg: '#dc2626', priceColor: '#fff',
    discBg: '#facc15', discColor: '#1a1a1a',
    badgeBg: '#dc2626', badgeColor: '#fff',
    origColor: '#999', savedBg: '#fef9c3', savedColor: '#92400e',
    borderColor: '#dc2626',
  },
  yellow: {
    headerBg: '#f59e0b', headerColor: '#1a1a1a',
    bodyBg: '#fffbeb', bodyColor: '#1a1a1a',
    priceBg: '#dc2626', priceColor: '#fff',
    discBg: '#dc2626', discColor: '#fff',
    badgeBg: '#f59e0b', badgeColor: '#1a1a1a',
    origColor: '#999', savedBg: '#fef2f2', savedColor: '#dc2626',
    borderColor: '#f59e0b',
  },
  green: {
    headerBg: '#16a34a', headerColor: '#fff',
    bodyBg: '#f0fdf4', bodyColor: '#1a1a1a',
    priceBg: '#dc2626', priceColor: '#fff',
    discBg: '#facc15', discColor: '#1a1a1a',
    badgeBg: '#16a34a', badgeColor: '#fff',
    origColor: '#999', savedBg: '#dcfce7', savedColor: '#166534',
    borderColor: '#16a34a',
  },
  blue: {
    headerBg: '#1d4ed8', headerColor: '#fff',
    bodyBg: '#eff6ff', bodyColor: '#1a1a1a',
    priceBg: '#dc2626', priceColor: '#fff',
    discBg: '#facc15', discColor: '#1a1a1a',
    badgeBg: '#1d4ed8', badgeColor: '#fff',
    origColor: '#999', savedBg: '#dbeafe', savedColor: '#1d4ed8',
    borderColor: '#1d4ed8',
  },
  black: {
    headerBg: '#1a1a1a', headerColor: '#facc15',
    bodyBg: '#1a1a1a', bodyColor: '#fff',
    priceBg: '#facc15', priceColor: '#1a1a1a',
    discBg: '#dc2626', discColor: '#fff',
    badgeBg: '#facc15', badgeColor: '#1a1a1a',
    origColor: '#888', savedBg: '#333', savedColor: '#facc15',
    borderColor: '#facc15',
  },
};

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtPrice(price: number): string {
  return price.toLocaleString();
}

// ============================================================
// ★ 단일 POP — A4 1장 (마트 현장 스타일)
// ============================================================

export function renderPricePop(item: PopItem, options: PopOptions = {}): string {
  const t = COLOR_THEMES[options.colorTheme || 'red'];
  const disc = item.originalPrice > 0 && item.salePrice > 0 && item.originalPrice > item.salePrice
    ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
  const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
  const saved = hasOrig ? item.originalPrice - item.salePrice : 0;
  const meta: string[] = [];
  if (item.unit) meta.push(esc(item.unit));
  if (item.origin) meta.push(esc(item.origin));

  const hasImage = !!item.imageUrl;

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>${esc(item.name)} POP</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;800;900&display=swap" rel="stylesheet">
<style>
@page{size:A4 portrait;margin:0}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans KR',sans-serif;width:210mm;height:297mm;overflow:hidden;display:flex;flex-direction:column;background:#fff}

/* ── 헤더 (컴팩트) ── */
.hdr{background:${t.headerBg};color:${t.headerColor};padding:5mm 10mm;display:flex;justify-content:space-between;align-items:center}
.hdr-title{font-size:16pt;font-weight:900;letter-spacing:.5px}
.hdr-badge{font-size:14pt;font-weight:900;background:rgba(255,255,255,.2);padding:2mm 6mm;border-radius:4mm}

/* ── 이미지 영역 (A4의 45%) ── */
.img-zone{flex:0 0 auto;height:120mm;display:flex;align-items:center;justify-content:center;background:#f9fafb;position:relative;overflow:hidden}
.img-zone img{max-width:140mm;max-height:110mm;object-fit:contain}
.disc-tag{position:absolute;top:6mm;right:8mm;background:${t.discBg};color:${t.discColor};width:22mm;height:22mm;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.2)}
.disc-tag .dn{font-size:28pt;font-weight:900;line-height:1}
.disc-tag .dp{font-size:10pt;font-weight:700}
.badge-tag{position:absolute;top:6mm;left:8mm;background:${t.badgeBg};color:${t.badgeColor};padding:2mm 5mm;border-radius:3mm;font-size:12pt;font-weight:800}

/* ── 상품 정보 ── */
.info{flex:1;display:flex;flex-direction:column;justify-content:center;padding:6mm 15mm;gap:2mm}
.name{font-size:30pt;font-weight:900;color:#1a1a1a;line-height:1.2}
.meta{font-size:12pt;color:#888;font-weight:600}
.orig-row{display:flex;align-items:center;gap:4mm;margin-top:2mm}
.orig{font-size:16pt;color:#bbb;text-decoration:line-through;font-weight:600}
.saved{font-size:12pt;font-weight:700;color:${t.savedColor};background:${t.savedBg};padding:1.5mm 5mm;border-radius:3mm}
.card{font-size:11pt;font-weight:700;color:#16a34a}

/* ── 가격 바 (하단, 초대형) ── */
.price-bar{background:${t.priceBg};padding:8mm 15mm;display:flex;align-items:baseline;justify-content:flex-end;gap:3mm}
.price{font-size:88pt;font-weight:900;color:${t.priceColor};line-height:1;letter-spacing:-3px}
.won{font-size:30pt;font-weight:800;color:${t.priceColor}}

/* ── 푸터 ── */
.ftr{background:${t.headerBg};color:${t.headerColor};padding:3mm 10mm;display:flex;justify-content:space-between;font-size:9pt;font-weight:600}
</style></head><body>
<div class="hdr">
  <span class="hdr-title">${esc(options.storeName || 'HOT 프라이스')}</span>
  ${item.badge ? `<span class="hdr-badge">${esc(item.badge)}</span>` : ''}
</div>
${hasImage ? `<div class="img-zone">
  <img src="${esc(item.imageUrl!)}" alt="" onerror="this.parentElement.style.background='#f3f4f6'" />
  ${disc > 0 ? `<div class="disc-tag"><span class="dn">${disc}</span><span class="dp">%</span></div>` : ''}
</div>` : (disc > 0 ? `<div class="img-zone" style="height:60mm;background:${t.discBg}">
  <div style="text-align:center"><span style="font-size:72pt;font-weight:900;color:${t.discColor}">${disc}</span><span style="font-size:24pt;font-weight:800;color:${t.discColor}">%</span><div style="font-size:16pt;font-weight:800;color:${t.discColor}">할인</div></div>
</div>` : '')}
<div class="info">
  <div class="name">${esc(item.name)}</div>
  ${meta.length > 0 ? `<div class="meta">${meta.join(' / ')}</div>` : ''}
  ${hasOrig ? `<div class="orig-row"><span class="orig">정상가 ${fmtPrice(item.originalPrice)}원</span>${saved > 0 ? `<span class="saved">${fmtPrice(saved)}원 절약</span>` : ''}</div>` : ''}
  ${item.cardDiscount ? `<div class="card">${esc(item.cardDiscount)}</div>` : ''}
</div>
<div class="price-bar">
  <span class="price">${fmtPrice(item.salePrice)}</span>
  <span class="won">원</span>
</div>
<div class="ftr">
  <span>${esc(options.storeName || '')}</span>
  <span>hanjul-flyer.kr</span>
</div>
</body></html>`;
}

// ============================================================
// ★ 다분할 POP — A4 한 장에 2/4/8개 (강렬한 마트 스타일)
// ============================================================

export function renderMultiPop(items: PopItem[], splits: 2 | 4 | 8, options: PopOptions = {}): string {
  const t = COLOR_THEMES[options.colorTheme || 'red'];
  const cols = splits <= 2 ? 1 : 2;
  const rows = Math.ceil(splits / cols);
  const cellW = cols === 1 ? '100%' : '50%';
  const cellH = `${100 / rows}%`;
  const pSize = splits <= 2 ? '52pt' : splits <= 4 ? '40pt' : '28pt';
  const nSize = splits <= 2 ? '18pt' : splits <= 4 ? '14pt' : '11pt';
  const dSize = splits <= 2 ? '28pt' : splits <= 4 ? '22pt' : '16pt';

  const cells = items.slice(0, splits).map(item => {
    const disc = item.originalPrice > 0 && item.salePrice > 0 && item.originalPrice > item.salePrice
      ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
    const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
    return `<div class="cell">
      ${disc > 0 ? `<div class="disc">${disc}<span>%</span></div>` : ''}
      ${item.imageUrl ? `<img src="${esc(item.imageUrl)}" class="cimg" onerror="this.style.display='none'" />` : ''}
      <div class="cname">${esc(item.name)}</div>
      ${hasOrig ? `<div class="corig">${fmtPrice(item.originalPrice)}원</div>` : ''}
      <div class="cprice-row"><div class="cprice">${fmtPrice(item.salePrice)}</div><span class="cwon">원</span></div>
      ${item.badge ? `<div class="cbadge">${esc(item.badge)}</div>` : ''}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>POP</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;800;900&display=swap" rel="stylesheet">
<style>
@page{size:A4 portrait;margin:0}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans KR',sans-serif;width:210mm;height:297mm;overflow:hidden;display:flex;flex-direction:column}
.hdr{background:${t.headerBg};color:${t.headerColor};padding:3mm 8mm;font-size:14pt;font-weight:900}
.grid{display:flex;flex-wrap:wrap;flex:1}
.cell{width:${cellW};height:${cellH};border:1.5px solid ${t.borderColor}30;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2mm;position:relative;background:${t.bodyBg}}
.disc{position:absolute;top:2mm;right:2mm;background:${t.discBg};color:${t.discColor};width:${splits<=4?'14mm':'10mm'};height:${splits<=4?'14mm':'10mm'};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${dSize};font-weight:900;box-shadow:0 2px 8px rgba(0,0,0,.15)}
.disc span{font-size:${splits<=4?'10pt':'8pt'}}
.cimg{max-width:${splits<=2?'35mm':splits<=4?'25mm':'16mm'};max-height:${splits<=2?'35mm':splits<=4?'25mm':'16mm'};object-fit:contain;border-radius:2mm;margin-bottom:1mm}
.cname{font-size:${nSize};font-weight:800;color:${t.bodyColor};text-align:center;line-height:1.2;margin-bottom:1mm}
.corig{font-size:${splits<=4?'10pt':'8pt'};color:${t.origColor};text-decoration:line-through}
.cprice-row{display:flex;align-items:baseline;gap:1mm}
.cprice{font-size:${pSize};font-weight:900;color:${t.priceBg};line-height:1;letter-spacing:-1px}
.cwon{font-size:${splits<=4?'14pt':'10pt'};font-weight:800;color:${t.priceBg}}
.cbadge{background:${t.badgeBg};color:${t.badgeColor};padding:0.5mm 3mm;border-radius:2mm;font-size:${splits<=4?'8pt':'6pt'};font-weight:700;margin-top:1mm}
</style></head><body>
<div class="hdr">${esc(options.storeName || '')}</div>
<div class="grid">${cells}</div>
</body></html>`;
}

// ============================================================
// ★ 홍보POP (코너 안내판) — 카테고리 헤더 + 상품 리스트
// ============================================================

export function renderPromoPop(category: string, items: PopItem[], options: PopOptions = {}): string {
  const t = COLOR_THEMES[options.colorTheme || 'red'];
  const rows = items.slice(0, 12).map((item, i) => {
    const disc = item.originalPrice > 0 && item.salePrice > 0 && item.originalPrice > item.salePrice
      ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
    return `<tr style="background:${i % 2 === 0 ? t.bodyBg : '#fff'}">
      <td class="rank">${i + 1}</td>
      <td class="pname">${esc(item.name)}${item.badge ? ` <span class="badge">${esc(item.badge)}</span>` : ''}</td>
      ${item.origin ? `<td class="origin">${esc(item.origin)}</td>` : '<td class="origin"></td>'}
      <td class="price">${fmtPrice(item.salePrice)}원${disc > 0 ? ` <span class="disc">${disc}%</span>` : ''}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${esc(category)}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;800;900&display=swap" rel="stylesheet">
<style>
@page{size:A4 portrait;margin:0}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans KR',sans-serif;width:210mm;height:297mm;overflow:hidden;display:flex;flex-direction:column}
.hdr{background:${t.headerBg};color:${t.headerColor};padding:12mm;text-align:center}
.hdr h1{font-size:42pt;font-weight:900;letter-spacing:3px}
.hdr p{font-size:14pt;font-weight:600;margin-top:2mm;opacity:.85}
.store{font-size:12pt;font-weight:700;padding:4mm 12mm;background:${t.borderColor}10;color:${t.bodyColor};text-align:right;border-bottom:3px solid ${t.borderColor}}
table{width:100%;border-collapse:collapse;flex:1}
th{background:${t.borderColor}15;color:${t.bodyColor};font-size:13pt;font-weight:800;padding:4mm 5mm;text-align:left;border-bottom:2px solid ${t.borderColor}}
td{padding:3.5mm 5mm;font-size:13pt;border-bottom:1px solid #e5e5e5;color:${t.bodyColor}}
.rank{width:10mm;text-align:center;font-weight:900;font-size:16pt;color:${t.borderColor}}
.pname{font-weight:700;font-size:14pt}
.badge{display:inline-block;background:${t.badgeBg};color:${t.badgeColor};font-size:8pt;font-weight:700;padding:1mm 3mm;border-radius:2mm;vertical-align:middle}
.origin{font-size:10pt;color:#888;width:22mm}
.price{text-align:right;font-weight:900;color:${t.priceBg};font-size:16pt;white-space:nowrap}
.disc{font-size:10pt;color:${t.headerBg};font-weight:800;background:${t.discBg};padding:0.5mm 2mm;border-radius:2mm}
.foot{background:${t.headerBg};color:${t.headerColor};padding:4mm 12mm;display:flex;justify-content:space-between;font-size:10pt;font-weight:600}
</style></head><body>
<div class="hdr"><h1>${esc(category)}</h1><p>오늘의 추천 상품</p></div>
<div class="store">${esc(options.storeName || '')}</div>
<table><tr><th></th><th>상품명</th><th>원산지</th><th style="text-align:right">가격</th></tr>${rows}</table>
<div class="foot"><span>${esc(options.storeName || '')}${options.storeAddress ? ' · ' + esc(options.storeAddress) : ''}</span><span>hanjul-flyer.kr</span></div>
</body></html>`;
}
