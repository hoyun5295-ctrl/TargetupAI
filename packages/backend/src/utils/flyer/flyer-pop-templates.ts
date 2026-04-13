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

  // 이미지 처리
  const hasImage = !!item.imageUrl;
  const imageHtml = hasImage
    ? `<div class="img-wrap"><img src="${esc(item.imageUrl!)}" alt="${esc(item.name)}" /></div>`
    : '';

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
