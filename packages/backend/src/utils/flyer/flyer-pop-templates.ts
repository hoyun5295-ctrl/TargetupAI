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
    align-items: center; justify-content: center;
    padding: 20mm 15mm;
    color: ${t.textColor};
    position: relative;
    overflow: hidden;
  }
  /* 장식 원형 */
  body::before {
    content: ''; position: absolute; top: -40mm; right: -40mm;
    width: 120mm; height: 120mm; border-radius: 50%;
    background: ${t.accent}; opacity: 0.06;
  }
  body::after {
    content: ''; position: absolute; bottom: -30mm; left: -30mm;
    width: 100mm; height: 100mm; border-radius: 50%;
    background: ${t.accent}; opacity: 0.04;
  }
  .store { font-size: 14pt; color: ${t.subColor}; letter-spacing: 3px; margin-bottom: 8mm; text-transform: uppercase; }
  .disc-badge {
    width: 36mm; height: 36mm; border-radius: 50%;
    background: ${t.badgeBg}; color: ${t.badgeColor};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    margin-bottom: 8mm; box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  }
  .disc-num { font-size: 42pt; font-weight: 900; line-height: 1; }
  .disc-pct { font-size: 16pt; font-weight: 700; margin-top: -2mm; }
  .name { font-size: 28pt; font-weight: 800; text-align: center; line-height: 1.3; margin-bottom: 6mm; letter-spacing: -0.5px; }
  .chips { display: flex; gap: 3mm; margin-bottom: 5mm; flex-wrap: wrap; justify-content: center; }
  .chip { font-size: 11pt; font-weight: 600; padding: 2mm 5mm; border-radius: 4mm; border: 1.5px solid ${t.accent}; color: ${t.accent}; }
  .orig-price { font-size: 18pt; color: ${t.subColor}; text-decoration: line-through; margin-bottom: 3mm; }
  .sale-row { display: flex; align-items: baseline; gap: 3mm; margin-bottom: 4mm; }
  .sale-price { font-size: 72pt; font-weight: 900; color: ${t.priceColor}; line-height: 1; letter-spacing: -2px; }
  .sale-won { font-size: 28pt; font-weight: 700; color: ${t.priceColor}; }
  .saved { font-size: 14pt; font-weight: 700; color: ${t.accent}; background: ${t.accent}15; padding: 2mm 6mm; border-radius: 3mm; margin-bottom: 4mm; }
  .card-disc { font-size: 13pt; font-weight: 700; color: #16a34a; margin-bottom: 3mm; }
  .badge { display: inline-block; font-size: 14pt; font-weight: 800; color: ${t.badgeColor}; background: ${t.badgeBg}; padding: 2mm 8mm; border-radius: 3mm; margin-bottom: 3mm; }
  .ai-copy { font-size: 12pt; color: ${t.subColor}; margin-top: 4mm; text-align: center; line-height: 1.5; }
  .footer { position: absolute; bottom: 8mm; font-size: 9pt; color: ${t.subColor}; opacity: 0.5; }
</style>
</head>
<body>
  ${options.storeName ? `<div class="store">${esc(options.storeName)}</div>` : ''}
  ${disc > 0 ? `<div class="disc-badge"><span class="disc-num">${disc}</span><span class="disc-pct">%</span></div>` : ''}
  <div class="name">${esc(item.name)}</div>
  ${chips.length > 0 ? `<div class="chips">${chips.map(c => `<span class="chip">${c}</span>`).join('')}</div>` : ''}
  ${item.badge ? `<span class="badge">${esc(item.badge)}</span>` : ''}
  ${hasOrig ? `<div class="orig-price">${fmtPrice(item.originalPrice)}원</div>` : ''}
  <div class="sale-row">
    <span class="sale-price">${fmtPrice(item.salePrice)}</span>
    <span class="sale-won">원</span>
  </div>
  ${saved > 0 ? `<div class="saved">${fmtPrice(saved)}원 절약!</div>` : ''}
  ${item.cardDiscount ? `<div class="card-disc">💳 ${esc(item.cardDiscount)}</div>` : ''}
  ${item.aiCopy ? `<div class="ai-copy">${esc(item.aiCopy)}</div>` : ''}
  <div class="footer">hanjul-flyer.kr</div>
</body>
</html>`;
}
