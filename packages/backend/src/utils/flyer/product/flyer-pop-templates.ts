/**
 * ★ 전단AI: POP 가격표 템플릿 시스템 (V3 — 5종 템플릿)
 *
 * 5종 POP 디자인:
 *   1. hot     — HOT 프라이스 (이미지 크게 + 하단 가격)
 *   2. classic — 클래식 마트 (빨강 헤더 + 이미지 + 빨강 가격바)
 *   3. simple  — 심플 화이트 (깔끔한 흰 배경 + 이미지 + 가격)
 *   4. dark    — 다크 프리미엄 (검정 배경 + 골드 가격)
 *   5. jumbo   — 대형 가격 (가격이 메인, 이미지 보조)
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
  popTemplate?: PopTemplate;
}

export type PopTemplate = 'hot' | 'classic' | 'simple' | 'dark' | 'jumbo';

export const POP_TEMPLATES: { value: PopTemplate; label: string; desc: string }[] = [
  { value: 'hot', label: 'HOT 프라이스', desc: '이미지 크게 + 하단 가격' },
  { value: 'classic', label: '클래식 마트', desc: '빨강 헤더 + 강렬한 가격바' },
  { value: 'simple', label: '심플 화이트', desc: '깔끔한 화이트 배경' },
  { value: 'dark', label: '다크 프리미엄', desc: '고급 블랙+골드' },
  { value: 'jumbo', label: '대형 가격', desc: '가격이 메인, 멀리서도 보임' },
];

// ============================================================
// 공통 유틸
// ============================================================

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtPrice(price: number): string {
  return price.toLocaleString();
}
function calcDisc(orig: number, sale: number): number {
  return orig > 0 && sale > 0 && orig > sale ? Math.round((1 - sale / orig) * 100) : 0;
}
function metaText(item: PopItem): string {
  const parts: string[] = [];
  if (item.unit) parts.push(esc(item.unit));
  if (item.origin) parts.push(esc(item.origin));
  return parts.join(' / ');
}

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;800;900&display=swap" rel="stylesheet">`;
const PAGE_CSS = `@page{size:A4 portrait;margin:0}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}*{margin:0;padding:0;box-sizing:border-box}`;
const BODY_BASE = `font-family:'Noto Sans KR',sans-serif;width:210mm;height:297mm;overflow:hidden;display:flex;flex-direction:column`;

// ============================================================
// ① HOT 프라이스 — 이미지 크게 + 하단에 상품명/가격
// ============================================================

function renderHotPop(item: PopItem, opts: PopOptions): string {
  const disc = calcDisc(item.originalPrice, item.salePrice);
  const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
  const saved = hasOrig ? item.originalPrice - item.salePrice : 0;
  const meta = metaText(item);
  const hasImage = !!item.imageUrl;

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">${FONTS}<style>
${PAGE_CSS}
body{${BODY_BASE};background:#fff}
.banner{background:linear-gradient(135deg,#1a1a1a,#333);padding:5mm 10mm;text-align:center}
.banner h1{font-size:22pt;font-weight:900;color:#fff;letter-spacing:2px}
.banner span{color:#dc2626;font-style:italic}
.img-zone{flex:0 0 auto;height:155mm;background:#f5f5f5;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center}
.img-zone img{width:100%;height:100%;object-fit:cover}
.disc{position:absolute;top:6mm;right:6mm;background:#dc2626;color:#fff;width:36mm;height:36mm;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 3px 12px rgba(0,0,0,.3)}
.disc b{font-size:42pt;font-weight:900;line-height:1}.disc small{font-size:12pt;font-weight:800}
.info{background:#fff;padding:5mm 12mm 3mm;display:flex;justify-content:space-between;align-items:flex-end}
.info-left .name{font-size:28pt;font-weight:900;color:#1a1a1a;line-height:1.1}
.info-left .meta{font-size:10pt;color:#999;font-weight:600;margin-top:1mm}
.info-right{text-align:right}
.info-right .orig{font-size:14pt;color:#bbb;text-decoration:line-through}
.price-bar{background:#dc2626;padding:6mm 12mm;display:flex;align-items:baseline;justify-content:flex-end;gap:2mm;flex:1}
.price{font-size:84pt;font-weight:900;color:#fff;line-height:1;letter-spacing:-2px}
.won{font-size:28pt;font-weight:800;color:#fff}
.saved-tag{position:absolute;bottom:3mm;left:12mm;font-size:12pt;font-weight:700;color:#facc15}
</style></head><body>
<div class="banner"><h1><span>HOT</span> 프라이스</h1></div>
${hasImage ? `<div class="img-zone"><img src="${esc(item.imageUrl!)}" alt="" />${disc > 0 ? `<div class="disc"><b>${disc}</b><small>%</small></div>` : ''}</div>` : `<div class="img-zone" style="height:100mm;background:#eee"></div>`}
<div class="info">
  <div class="info-left">
    <div class="name">${esc(item.name)}</div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
  </div>
  <div class="info-right">
    ${hasOrig ? `<div class="orig">${fmtPrice(item.originalPrice)}원</div>` : ''}
  </div>
</div>
<div class="price-bar" style="position:relative">
  <span class="price">${fmtPrice(item.salePrice)}</span><span class="won">원</span>
  ${saved > 0 ? `<span class="saved-tag">${fmtPrice(saved)}원 절약</span>` : ''}
</div>
</body></html>`;
}

// ============================================================
// ② 클래식 마트 — 빨강 헤더 + 이미지 + 가격바
// ============================================================

function renderClassicPop(item: PopItem, opts: PopOptions): string {
  const disc = calcDisc(item.originalPrice, item.salePrice);
  const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
  const saved = hasOrig ? item.originalPrice - item.salePrice : 0;
  const meta = metaText(item);
  const hasImage = !!item.imageUrl;

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">${FONTS}<style>
${PAGE_CSS}
body{${BODY_BASE};background:#fff}
.hdr{background:#dc2626;color:#fff;padding:4mm 10mm;display:flex;justify-content:space-between;align-items:center}
.hdr b{font-size:16pt;font-weight:900}
.hdr span{font-size:13pt;font-weight:900;background:rgba(255,255,255,.2);padding:2mm 6mm;border-radius:4mm}
.img-zone{flex:0 0 auto;height:160mm;background:#f5f5f5;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center}
.img-zone img{width:100%;height:100%;object-fit:cover}
.disc{position:absolute;top:6mm;right:6mm;background:#facc15;color:#1a1a1a;width:38mm;height:38mm;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 3px 12px rgba(0,0,0,.2)}
.disc b{font-size:44pt;font-weight:900;line-height:1}.disc small{font-size:13pt;font-weight:800}
.name-bar{padding:4mm 12mm 2mm;background:#fff}
.name{font-size:34pt;font-weight:900;color:#1a1a1a}
.meta{font-size:10pt;color:#999;font-weight:600;margin-top:1mm}
.price-bar{background:#dc2626;flex:1;padding:4mm 12mm;display:flex;flex-direction:column;justify-content:center}
.orig-line{display:flex;align-items:center;gap:3mm}
.orig{font-size:15pt;color:rgba(255,255,255,.55);text-decoration:line-through}
.saved{font-size:12pt;font-weight:700;color:#facc15;background:rgba(255,255,255,.12);padding:1mm 4mm;border-radius:3mm}
.price-row{display:flex;align-items:baseline;justify-content:flex-end;gap:2mm}
.price{font-size:86pt;font-weight:900;color:#fff;line-height:1;letter-spacing:-3px}
.won{font-size:28pt;font-weight:800;color:#fff}
.ftr{background:#dc2626;border-top:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.7);padding:2.5mm 10mm;display:flex;justify-content:space-between;font-size:8pt;font-weight:600}
</style></head><body>
<div class="hdr"><b>${esc(opts.storeName || '')}</b>${item.badge ? `<span>${esc(item.badge)}</span>` : ''}</div>
${hasImage ? `<div class="img-zone"><img src="${esc(item.imageUrl!)}" alt="" />${disc > 0 ? `<div class="disc"><b>${disc}</b><small>%</small></div>` : ''}</div>` : `<div class="img-zone" style="height:80mm"></div>`}
<div class="name-bar"><div class="name">${esc(item.name)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
<div class="price-bar">
  ${hasOrig ? `<div class="orig-line"><span class="orig">${fmtPrice(item.originalPrice)}원</span>${saved > 0 ? `<span class="saved">${fmtPrice(saved)}원 절약</span>` : ''}</div>` : ''}
  <div class="price-row"><span class="price">${fmtPrice(item.salePrice)}</span><span class="won">원</span></div>
</div>
<div class="ftr"><span>${esc(opts.storeName || '')}</span><span>hanjul-flyer.kr</span></div>
</body></html>`;
}

// ============================================================
// ③ 심플 화이트 — 깔끔한 흰 배경
// ============================================================

function renderSimplePop(item: PopItem, opts: PopOptions): string {
  const disc = calcDisc(item.originalPrice, item.salePrice);
  const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
  const saved = hasOrig ? item.originalPrice - item.salePrice : 0;
  const meta = metaText(item);
  const hasImage = !!item.imageUrl;

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">${FONTS}<style>
${PAGE_CSS}
body{${BODY_BASE};background:#fff;padding:10mm}
.card{flex:1;border:1px solid #e5e7eb;border-radius:6mm;overflow:hidden;display:flex;flex-direction:column}
.img-zone{flex:0 0 auto;height:155mm;background:#fafafa;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center}
.img-zone img{max-width:90%;max-height:90%;object-fit:contain}
.disc{position:absolute;top:5mm;right:5mm;background:#ef4444;color:#fff;padding:3mm 5mm;border-radius:4mm;font-size:18pt;font-weight:900}
.content{flex:1;padding:8mm 10mm;display:flex;flex-direction:column;justify-content:space-between}
.top .name{font-size:28pt;font-weight:900;color:#111;line-height:1.2}
.top .meta{font-size:10pt;color:#aaa;margin-top:1mm}
.bottom{display:flex;align-items:baseline;justify-content:space-between}
.bottom-left .orig{font-size:14pt;color:#ccc;text-decoration:line-through}
.bottom-left .saved{font-size:11pt;color:#ef4444;font-weight:700;margin-top:1mm}
.bottom-right{text-align:right}
.bottom-right .price{font-size:64pt;font-weight:900;color:#111;line-height:1;letter-spacing:-2px}
.bottom-right .won{font-size:22pt;font-weight:800;color:#111}
.store{text-align:center;font-size:9pt;color:#ccc;padding:2mm 0}
</style></head><body>
<div class="card">
  ${hasImage ? `<div class="img-zone"><img src="${esc(item.imageUrl!)}" alt="" />${disc > 0 ? `<div class="disc">${disc}%</div>` : ''}</div>` : `<div class="img-zone" style="height:80mm"></div>`}
  <div class="content">
    <div class="top">
      <div class="name">${esc(item.name)}</div>
      ${meta ? `<div class="meta">${meta}</div>` : ''}
      ${item.badge ? `<span style="display:inline-block;margin-top:2mm;background:#fef3c7;color:#92400e;font-size:10pt;font-weight:700;padding:1mm 4mm;border-radius:3mm">${esc(item.badge)}</span>` : ''}
    </div>
    <div class="bottom">
      <div class="bottom-left">
        ${hasOrig ? `<div class="orig">${fmtPrice(item.originalPrice)}원</div>` : ''}
        ${saved > 0 ? `<div class="saved">${fmtPrice(saved)}원 절약</div>` : ''}
      </div>
      <div class="bottom-right">
        <span class="price">${fmtPrice(item.salePrice)}</span><span class="won">원</span>
      </div>
    </div>
  </div>
</div>
<div class="store">${esc(opts.storeName || '')}${opts.storeName ? ' · ' : ''}hanjul-flyer.kr</div>
</body></html>`;
}

// ============================================================
// ④ 다크 프리미엄 — 검정+골드 (한우/프리미엄)
// ============================================================

function renderDarkPop(item: PopItem, opts: PopOptions): string {
  const disc = calcDisc(item.originalPrice, item.salePrice);
  const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
  const saved = hasOrig ? item.originalPrice - item.salePrice : 0;
  const meta = metaText(item);
  const hasImage = !!item.imageUrl;

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">${FONTS}<style>
${PAGE_CSS}
body{${BODY_BASE};background:#0a0a0a}
.hdr{background:linear-gradient(135deg,#1a1a1a,#111);padding:5mm 12mm;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333}
.hdr b{font-size:14pt;font-weight:900;color:#d4a853;letter-spacing:1px}
.hdr span{font-size:11pt;font-weight:800;color:#d4a853;border:1px solid #d4a85350;padding:1.5mm 5mm;border-radius:3mm}
.img-zone{flex:0 0 auto;height:148mm;background:#111;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center}
.img-zone img{width:100%;height:100%;object-fit:cover}
.disc{position:absolute;top:6mm;right:6mm;background:linear-gradient(135deg,#d4a853,#b8860b);color:#fff;width:36mm;height:36mm;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 3px 12px rgba(212,168,83,.4)}
.disc b{font-size:40pt;font-weight:900;line-height:1}.disc small{font-size:12pt;font-weight:800}
.info{padding:5mm 12mm;background:#0a0a0a}
.name{font-size:30pt;font-weight:900;color:#fff;line-height:1.1}
.meta{font-size:10pt;color:#666;font-weight:600;margin-top:1mm}
.price-area{flex:1;background:linear-gradient(180deg,#0a0a0a,#111);padding:3mm 12mm;display:flex;flex-direction:column;justify-content:center;border-top:1px solid #d4a85330}
.orig-line{display:flex;align-items:center;gap:3mm}
.orig{font-size:14pt;color:#555;text-decoration:line-through}
.saved{font-size:11pt;font-weight:700;color:#d4a853}
.price-row{display:flex;align-items:baseline;justify-content:flex-end;gap:2mm;margin-top:1mm}
.price{font-size:82pt;font-weight:900;color:#d4a853;line-height:1;letter-spacing:-2px}
.won{font-size:26pt;font-weight:800;color:#d4a853}
.ftr{border-top:1px solid #222;color:#444;padding:2.5mm 12mm;display:flex;justify-content:space-between;font-size:8pt;font-weight:600}
</style></head><body>
<div class="hdr"><b>${esc(opts.storeName || 'PREMIUM')}</b>${item.badge ? `<span>${esc(item.badge)}</span>` : ''}</div>
${hasImage ? `<div class="img-zone"><img src="${esc(item.imageUrl!)}" alt="" />${disc > 0 ? `<div class="disc"><b>${disc}</b><small>%</small></div>` : ''}</div>` : `<div class="img-zone" style="height:80mm"></div>`}
<div class="info"><div class="name">${esc(item.name)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
<div class="price-area">
  ${hasOrig ? `<div class="orig-line"><span class="orig">${fmtPrice(item.originalPrice)}원</span>${saved > 0 ? `<span class="saved">${fmtPrice(saved)}원 절약</span>` : ''}</div>` : ''}
  <div class="price-row"><span class="price">${fmtPrice(item.salePrice)}</span><span class="won">원</span></div>
</div>
<div class="ftr"><span>${esc(opts.storeName || '')}</span><span>hanjul-flyer.kr</span></div>
</body></html>`;
}

// ============================================================
// ⑤ 대형 가격 — 가격이 메인 (멀리서도 보임)
// ============================================================

function renderJumboPop(item: PopItem, opts: PopOptions): string {
  const disc = calcDisc(item.originalPrice, item.salePrice);
  const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
  const meta = metaText(item);
  const hasImage = !!item.imageUrl;

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">${FONTS}<style>
${PAGE_CSS}
body{${BODY_BASE};background:#dc2626}
.top{padding:6mm 12mm;display:flex;justify-content:space-between;align-items:flex-start}
.top-left .name{font-size:28pt;font-weight:900;color:#fff;line-height:1.1}
.top-left .meta{font-size:10pt;color:rgba(255,255,255,.6);margin-top:1mm}
.top-right{display:flex;align-items:center;gap:3mm}
${disc > 0 ? `.disc{background:#facc15;color:#1a1a1a;width:28mm;height:28mm;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center}.disc b{font-size:30pt;font-weight:900;line-height:1}.disc small{font-size:10pt;font-weight:800}` : ''}
.badge{background:rgba(255,255,255,.2);color:#fff;padding:2mm 5mm;border-radius:3mm;font-size:11pt;font-weight:800}
.img-strip{height:${hasImage ? '70mm' : '20mm'};background:rgba(0,0,0,.1);overflow:hidden;display:flex;align-items:center;justify-content:center}
.img-strip img{height:100%;object-fit:contain}
.price-zone{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5mm}
${hasOrig ? `.orig{font-size:22pt;color:rgba(255,255,255,.45);text-decoration:line-through;margin-bottom:2mm}` : ''}
.price{font-size:130pt;font-weight:900;color:#fff;line-height:1;letter-spacing:-4px;text-shadow:0 4px 20px rgba(0,0,0,.2)}
.won{font-size:42pt;font-weight:800;color:#fff}
.store{color:rgba(255,255,255,.5);padding:3mm 12mm;font-size:9pt;font-weight:600;text-align:center}
</style></head><body>
<div class="top">
  <div class="top-left"><div class="name">${esc(item.name)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
  <div class="top-right">${disc > 0 ? `<div class="disc"><b>${disc}</b><small>%</small></div>` : ''}${item.badge ? `<span class="badge">${esc(item.badge)}</span>` : ''}</div>
</div>
${hasImage ? `<div class="img-strip"><img src="${esc(item.imageUrl!)}" alt="" /></div>` : '<div class="img-strip"></div>'}
<div class="price-zone">
  ${hasOrig ? `<div class="orig">${fmtPrice(item.originalPrice)}원</div>` : ''}
  <div><span class="price">${fmtPrice(item.salePrice)}</span><span class="won">원</span></div>
</div>
<div class="store">${esc(opts.storeName || '')} · hanjul-flyer.kr</div>
</body></html>`;
}

// ============================================================
// ★ 통합 진입점 — popTemplate으로 분기
// ============================================================

export function renderPricePop(item: PopItem, options: PopOptions = {}): string {
  const tmpl = options.popTemplate || 'classic';
  switch (tmpl) {
    case 'hot': return renderHotPop(item, options);
    case 'simple': return renderSimplePop(item, options);
    case 'dark': return renderDarkPop(item, options);
    case 'jumbo': return renderJumboPop(item, options);
    case 'classic':
    default: return renderClassicPop(item, options);
  }
}

// ============================================================
// ★ 다분할 POP — A4 한 장에 2/4/8개
// ============================================================

/** 분할 레이아웃 설정 */
const SPLIT_LAYOUTS: Record<number, { cols: number; rows: number }> = {
  2: { cols: 1, rows: 2 }, 4: { cols: 2, rows: 2 }, 8: { cols: 2, rows: 4 },
  16: { cols: 4, rows: 4 }, 21: { cols: 7, rows: 3 }, 35: { cols: 7, rows: 5 },
};

export function renderMultiPop(items: PopItem[], splits: number, options: PopOptions = {}): string {
  const layout = SPLIT_LAYOUTS[splits] || { cols: Math.ceil(Math.sqrt(splits)), rows: Math.ceil(splits / Math.ceil(Math.sqrt(splits))) };
  const { cols, rows } = layout;
  const cellW = `${100 / cols}%`;
  const cellH = `${100 / rows}%`;
  const isSmall = splits >= 16;
  const isTiny = splits >= 21;
  const pSize = isTiny ? '14pt' : isSmall ? '18pt' : splits <= 2 ? '48pt' : splits <= 4 ? '36pt' : '24pt';
  const nSize = isTiny ? '7pt' : isSmall ? '8pt' : splits <= 2 ? '16pt' : splits <= 4 ? '13pt' : '10pt';
  const imgH = isTiny ? '30%' : isSmall ? '32%' : splits <= 2 ? '45%' : splits <= 4 ? '40%' : '35%';
  const dSize = isTiny ? '6pt' : isSmall ? '8pt' : splits <= 4 ? '16pt' : '12pt';

  const cells = items.slice(0, splits).map(item => {
    const disc = calcDisc(item.originalPrice, item.salePrice);
    const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
    return `<div class="cell">
      ${item.imageUrl ? `<div class="cimg"><img src="${esc(item.imageUrl)}" onerror="this.parentElement.style.display='none'" /></div>` : ''}
      ${disc > 0 ? `<div class="disc">${disc}%</div>` : ''}
      <div class="cname">${esc(item.name)}</div>
      ${hasOrig ? `<div class="corig">${fmtPrice(item.originalPrice)}원</div>` : ''}
      <div class="cprice">${fmtPrice(item.salePrice)}<span>원</span></div>
      ${item.badge ? `<div class="cbadge">${esc(item.badge)}</div>` : ''}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">${FONTS}<style>
${PAGE_CSS}
body{font-family:'Noto Sans KR',sans-serif;width:210mm;height:297mm;overflow:hidden;display:flex;flex-direction:column}
.hdr{background:#dc2626;color:#fff;padding:3mm 8mm;font-size:13pt;font-weight:900}
.grid{display:flex;flex-wrap:wrap;flex:1}
.cell{width:${cellW};height:${cellH};border:1px solid #eee;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2mm;position:relative;background:#fff}
.cimg{width:80%;height:${imgH};overflow:hidden;display:flex;align-items:center;justify-content:center;margin-bottom:1mm}
.cimg img{max-width:100%;max-height:100%;object-fit:contain}
.disc{position:absolute;top:2mm;right:2mm;background:#dc2626;color:#fff;padding:1mm 3mm;border-radius:3mm;font-size:${dSize};font-weight:900}
.cname{font-size:${nSize};font-weight:800;color:#1a1a1a;text-align:center;line-height:1.2;margin-bottom:1mm}
.corig{font-size:${splits <= 4 ? '9pt' : '7pt'};color:#bbb;text-decoration:line-through}
.cprice{font-size:${pSize};font-weight:900;color:#dc2626;line-height:1}
.cprice span{font-size:${splits <= 4 ? '14pt' : '10pt'};font-weight:700}
.cbadge{background:#fef3c7;color:#92400e;padding:0.5mm 3mm;border-radius:2mm;font-size:${splits <= 4 ? '8pt' : '6pt'};font-weight:700;margin-top:1mm}
</style></head><body>
<div class="hdr">${esc(options.storeName || '')}</div>
<div class="grid">${cells}</div>
</body></html>`;
}

// ============================================================
// ★ 홍보POP (코너 안내판)
// ============================================================

export function renderPromoPop(category: string, items: PopItem[], options: PopOptions = {}): string {
  const rows = items.slice(0, 12).map((item, i) => {
    const disc = calcDisc(item.originalPrice, item.salePrice);
    return `<tr style="background:${i % 2 === 0 ? '#fafafa' : '#fff'}">
      <td class="rank">${i + 1}</td>
      <td class="pname">${esc(item.name)}${item.badge ? ` <span class="badge">${esc(item.badge)}</span>` : ''}</td>
      ${item.origin ? `<td class="origin">${esc(item.origin)}</td>` : '<td class="origin"></td>'}
      <td class="price">${fmtPrice(item.salePrice)}원${disc > 0 ? ` <span class="disc">${disc}%</span>` : ''}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">${FONTS}<style>
${PAGE_CSS}
body{font-family:'Noto Sans KR',sans-serif;width:210mm;height:297mm;overflow:hidden;display:flex;flex-direction:column}
.hdr{background:#dc2626;color:#fff;padding:10mm 12mm;text-align:center}
.hdr h1{font-size:40pt;font-weight:900;letter-spacing:2px}
.hdr p{font-size:13pt;font-weight:600;margin-top:2mm;opacity:.8}
.store{font-size:11pt;font-weight:700;padding:3mm 12mm;background:#dc262610;color:#1a1a1a;text-align:right;border-bottom:2px solid #dc2626}
table{width:100%;border-collapse:collapse;flex:1}
th{background:#dc262612;color:#1a1a1a;font-size:12pt;font-weight:700;padding:3mm 5mm;text-align:left;border-bottom:2px solid #dc2626}
td{padding:3.5mm 5mm;font-size:13pt;border-bottom:1px solid #eee;color:#1a1a1a}
.rank{width:10mm;text-align:center;font-weight:900;font-size:15pt;color:#dc2626}
.pname{font-weight:700;font-size:13pt}
.badge{display:inline-block;background:#dc2626;color:#fff;font-size:8pt;font-weight:700;padding:0.5mm 3mm;border-radius:2mm}
.origin{font-size:10pt;color:#888;width:22mm}
.price{text-align:right;font-weight:900;color:#dc2626;font-size:15pt;white-space:nowrap}
.disc{font-size:9pt;color:#dc2626;font-weight:800;background:#fef3c7;padding:0.5mm 2mm;border-radius:2mm}
.foot{background:#dc2626;color:#fff;padding:3mm 12mm;display:flex;justify-content:space-between;font-size:9pt;font-weight:600}
</style></head><body>
<div class="hdr"><h1>${esc(category)}</h1><p>오늘의 추천 상품</p></div>
<div class="store">${esc(options.storeName || '')}</div>
<table><tr><th></th><th>상품명</th><th>원산지</th><th style="text-align:right">가격</th></tr>${rows}</table>
<div class="foot"><span>${esc(options.storeName || '')}</span><span>hanjul-flyer.kr</span></div>
</body></html>`;
}
