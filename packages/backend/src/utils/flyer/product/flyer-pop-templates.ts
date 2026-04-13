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
  const chips: string[] = [];
  if (item.origin) chips.push(esc(item.origin));
  if (item.unit) chips.push(esc(item.unit));

  const hasImage = !!item.imageUrl;
  const imageSection = hasImage
    ? `<div class="img-area"><img src="${esc(item.imageUrl!)}" alt="" onerror="this.parentElement.style.display='none'" /></div>`
    : '';

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>${esc(item.name)} POP</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;800;900&display=swap" rel="stylesheet">
<style>
@page{size:A4 portrait;margin:0}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans KR',sans-serif;width:210mm;height:297mm;overflow:hidden;display:flex;flex-direction:column}

/* ── 상단: 매장명 + 뱃지 ── */
.top{background:${t.headerBg};color:${t.headerColor};padding:8mm 10mm;display:flex;justify-content:space-between;align-items:center}
.top-store{font-size:20pt;font-weight:900;letter-spacing:1px}
.top-badge{font-size:16pt;font-weight:900;background:rgba(255,255,255,.2);padding:3mm 8mm;border-radius:5mm}

/* ── 할인율 구역 (강렬) ── */
.disc-zone{background:${t.discBg};display:flex;align-items:center;justify-content:center;padding:${disc > 0 ? '12mm 0' : '4mm 0'};position:relative}
.disc-burst{width:55mm;height:55mm;position:relative;display:flex;align-items:center;justify-content:center}
.disc-burst::before{content:'';position:absolute;inset:0;background:${t.discBg};border-radius:50%;box-shadow:0 0 0 4mm ${t.discBg},0 4px 20px rgba(0,0,0,.2)}
.disc-num{font-size:72pt;font-weight:900;color:${t.discColor};position:relative;z-index:1;line-height:1}
.disc-pct{font-size:24pt;font-weight:800;color:${t.discColor};position:relative;z-index:1}
.disc-label{position:absolute;bottom:-2mm;font-size:14pt;font-weight:800;color:${t.discColor};background:${t.headerBg};padding:1mm 6mm;border-radius:3mm;z-index:2}

/* ── 상품 이미지 ── */
.img-area{display:flex;justify-content:center;padding:6mm 15mm 2mm;background:${t.bodyBg}}
.img-area img{max-width:55mm;max-height:55mm;object-fit:contain;border-radius:3mm}

/* ── 메인 본문 ── */
.main{flex:1;background:${t.bodyBg};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4mm 12mm;gap:3mm}
.name{font-size:32pt;font-weight:900;color:${t.bodyColor};text-align:center;line-height:1.2;letter-spacing:-1px}
.chips{display:flex;gap:3mm;flex-wrap:wrap;justify-content:center}
.chip{font-size:11pt;font-weight:700;padding:2mm 5mm;border-radius:4mm;background:${t.borderColor}15;color:${t.borderColor};border:1.5px solid ${t.borderColor}40}
.orig{font-size:22pt;color:${t.origColor};text-decoration:line-through;font-weight:600}

/* ── 가격 구역 (초대형) ── */
.price-zone{background:${t.priceBg};width:100%;padding:8mm 10mm;display:flex;align-items:baseline;justify-content:center;gap:3mm;border-top:3px solid ${t.borderColor}}
.price{font-size:90pt;font-weight:900;color:${t.priceColor};line-height:1;letter-spacing:-3px}
.won{font-size:32pt;font-weight:800;color:${t.priceColor}}

/* ── 절약/카드/AI문구 ── */
.saved{font-size:16pt;font-weight:800;background:${t.savedBg};color:${t.savedColor};padding:2.5mm 8mm;border-radius:4mm;text-align:center}
.card{font-size:13pt;font-weight:700;color:#16a34a}
.ai-copy{font-size:11pt;color:${t.origColor};text-align:center;line-height:1.4}

/* ── 하단 ── */
.bottom{background:${t.headerBg};color:${t.headerColor};padding:4mm 10mm;display:flex;justify-content:space-between;align-items:center;font-size:10pt;font-weight:600}
</style></head><body>
<div class="top">
  <span class="top-store">${esc(options.storeName || '')}</span>
  ${item.badge ? `<span class="top-badge">${esc(item.badge)}</span>` : ''}
</div>
${disc > 0 ? `<div class="disc-zone">
  <div class="disc-burst">
    <span class="disc-num">${disc}</span><span class="disc-pct">%</span>
  </div>
  <span class="disc-label">할인</span>
</div>` : ''}
${imageSection}
<div class="main">
  <div class="name">${esc(item.name)}</div>
  ${chips.length > 0 ? `<div class="chips">${chips.map(c => `<span class="chip">${c}</span>`).join('')}</div>` : ''}
  ${hasOrig ? `<div class="orig">${fmtPrice(item.originalPrice)}원</div>` : ''}
  ${saved > 0 ? `<div class="saved">${fmtPrice(saved)}원 절약!</div>` : ''}
  ${item.cardDiscount ? `<div class="card">${esc(item.cardDiscount)}</div>` : ''}
  ${item.aiCopy ? `<div class="ai-copy">${esc(item.aiCopy)}</div>` : ''}
</div>
<div class="price-zone">
  <span class="price">${fmtPrice(item.salePrice)}</span>
  <span class="won">원</span>
</div>
<div class="bottom">
  <span>${esc(options.storeName || '')}${options.storeAddress ? ' · ' + esc(options.storeAddress) : ''}</span>
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
