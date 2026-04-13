/**
 * ★ CT-F14 — 전단AI 템플릿 렌더링 엔진 V3
 *
 * 전단지 공개 페이지 HTML 렌더링의 유일한 진입점.
 * short-urls.ts에서 호출: renderTemplate(templateCode, data)
 *
 * V3 아키텍처: 4개 완전히 다른 레이아웃 엔진 + 테마별 색상 교체.
 *  ① renderGridEngine    — 2열 그리드 카드 (grid, mart_fresh, mart_weekend, mart_clearance, butcher_daily)
 *  ② renderMagazineEngine — 1열 매거진형 (magazine, butcher_premium)
 *  ③ renderEditorialEngine — 에디토리얼 풀블리드 (editorial, mart_seasonal)
 *  ④ renderShowcaseEngine  — 대형 쇼케이스 (showcase, highlight, butcher_bulk)
 *
 * 신규 필드: unit(규격), origin(원산지), cardDiscount(카드할인)
 */

import { renderProductImage, resolveProductImageUrl } from '../../../utils/product-images';

// ============================================================
// 공통 타입 + 유틸
// ============================================================

export interface FlyerRenderData {
  storeName: string;
  title: string;
  period: string;
  categories: Array<{ name: string; items: FlyerRenderItem[] }>;
  qrCodeDataUrl?: string;
  qrCouponText?: string;
  /** 외부 링크 (밴드/쇼핑몰/전화/지도/인스타/블로그) */
  externalLinks?: Array<{ label: string; url: string; icon: string }>;
  /** 공지사항/게시판 */
  announcements?: Array<{ title: string; content: string }>;
  /** GIF 배너 URL */
  bannerGifUrl?: string;
}

export interface FlyerRenderItem {
  name: string;
  originalPrice: number;
  salePrice: number;
  badge?: string;
  imageUrl?: string;
  /** 규격 (e.g. "6kg/통", "500ml", "1박스 20kg") */
  unit?: string;
  /** 원산지 (e.g. "국내산", "미국산", "노르웨이") */
  origin?: string;
  /** 카드할인 (e.g. "농협카드 5% 추가", "삼성카드 10%") */
  cardDiscount?: string;
  /** AI 마케팅 문구 (e.g. "🍖 겉바속촉! 에어프라이어 180도 15분이면 완성") */
  aiCopy?: string;
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtPrice(price: number): string {
  return price.toLocaleString();
}

function toAbsUrl(url: string | null): string | null {
  if (!url || url.startsWith('http')) return url;
  const base = process.env.FLYER_API_BASE_URL || '';
  return base ? base + url : url;
}

function calcDisc(orig: number, sale: number): number {
  return orig > 0 ? Math.round((1 - sale / orig) * 100) : 0;
}

function resolveImg(name: string, size: number, imageUrl?: string | null): string {
  const absUrl = toAbsUrl(imageUrl || resolveProductImageUrl(name));
  return renderProductImage(name, size, absUrl || undefined);
}

/** 상품 메타 칩(규격/원산지) HTML */
function renderMetaChips(item: FlyerRenderItem, chipBg: string, chipColor: string): string {
  const chips: string[] = [];
  if (item.unit) chips.push(`<span class="mc">${esc(item.unit)}</span>`);
  if (item.origin) chips.push(`<span class="mc og">${esc(item.origin)}</span>`);
  if (chips.length === 0) return '';
  return `<div class="mw" style="--chip-bg:${chipBg};--chip-color:${chipColor}">${chips.join('')}</div>`;
}

/** 카드할인 라인 HTML */
function renderCardDiscount(item: FlyerRenderItem, iconColor: string): string {
  if (!item.cardDiscount) return '';
  return `<div class="cd"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5"><rect x="1" y="4" width="22" height="16" rx="3"/><path d="M1 10h22"/></svg><span>${esc(item.cardDiscount)}</span></div>`;
}

function renderAiCopy(item: FlyerRenderItem, color: string): string {
  if (!item.aiCopy) return '';
  return `<p class="ac">${esc(item.aiCopy)}</p>`;
}

// ============================================================
// 다이나믹 섹션 (외부링크 + 공지 + GIF 배너)
// ============================================================

const LINK_ICONS: Record<string, string> = {
  band: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>',
  shop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 01-8 0"/></svg>',
  phone: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>',
  map: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  instagram: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><circle cx="17.5" cy="6.5" r="1.5"/></svg>',
  blog: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>',
  link: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
};

function renderDynamicSection(d: FlyerRenderData): string {
  const parts: string[] = [];

  // GIF 배너
  if (d.bannerGifUrl) {
    parts.push(`<div class="dyn-gif"><img src="${esc(d.bannerGifUrl)}" alt="배너" style="width:100%;border-radius:12px"/></div>`);
  }

  // 외부 링크
  if (d.externalLinks && d.externalLinks.length > 0) {
    const links = d.externalLinks.map(l => {
      const icon = LINK_ICONS[l.icon] || LINK_ICONS.link;
      return `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" class="dyn-link">${icon}<span>${esc(l.label)}</span></a>`;
    }).join('');
    parts.push(`<div class="dyn-links">${links}</div>`);
  }

  // 공지사항
  if (d.announcements && d.announcements.length > 0) {
    const items = d.announcements.map(a =>
      `<details class="dyn-ann"><summary>${esc(a.title)}</summary><p>${esc(a.content)}</p></details>`
    ).join('');
    parts.push(`<div class="dyn-anns"><div class="dyn-anns-title">공지사항</div>${items}</div>`);
  }

  if (parts.length === 0) return '';
  return `<div class="dyn-section">${parts.join('')}</div>`;
}

// ============================================================
// 공통 HTML 베이스 (head + body 감싸기)
// ============================================================

function htmlWrap(title: string, css: string, body: string, script?: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{max-width:480px;margin:0 auto;overflow-x:clip}
/* 카테고리 섹션 — sticky nav 가림 방지 */
.sc{scroll-margin-top:56px}
/* 공통 메타 칩 */
.mw{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.mc{font-size:10px;font-weight:600;padding:2px 8px;border-radius:6px;background:var(--chip-bg);color:var(--chip-color);line-height:1.4}
.mc.og{border:1px solid var(--chip-color);background:transparent}
/* 카드할인 */
.cd{display:flex;align-items:center;gap:4px;margin-top:6px;font-size:10px;font-weight:700;color:#16a34a}
.cd svg{flex-shrink:0}
/* AI 마케팅 문구 */
.ac{font-size:11px;color:#666;margin-top:4px;line-height:1.4;letter-spacing:-0.2px}
/* 다이나믹 섹션 */
.dyn-section{padding:16px 12px}
.dyn-gif{margin-bottom:12px}
.dyn-links{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px}
.dyn-link{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 14px;border-radius:12px;background:#f5f5f5;text-decoration:none;color:#333;font-size:11px;font-weight:600;min-width:72px;transition:background .2s}
.dyn-link:active{background:#e5e5e5}
.dyn-anns{margin-bottom:8px}.dyn-anns-title{font-size:13px;font-weight:700;margin-bottom:8px;color:#333}
.dyn-ann{background:#f9fafb;border-radius:10px;margin-bottom:6px;border:1px solid #e5e7eb}
.dyn-ann summary{padding:10px 14px;font-size:12px;font-weight:600;color:#374151;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center}
.dyn-ann summary::after{content:'▸';font-size:10px;color:#9ca3af;transition:transform .2s}
.dyn-ann[open] summary::after{transform:rotate(90deg)}
.dyn-ann p{padding:0 14px 10px;font-size:11px;color:#6b7280;line-height:1.6}
/* 인쇄/PDF 최적화 */
@media print{body{max-width:none;margin:0}img{-webkit-print-color-adjust:exact;print-color-adjust:exact}.nav{position:static!important}}
@page{margin:8mm}
${css}
</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

/** 카테고리 탭 JS — 외부 파일이 아닌 인라인 (CSP는 helmet 전 마운트로 우회) */
const STICKY_TAB_SCRIPT = `(function(){
var ts=document.querySelectorAll('.ct');
var ss=document.querySelectorAll('section.sc');
var ni=document.querySelector('.ni');
var nv=document.querySelector('.nav');
if(!ts.length||!ss.length)return;
var last=-1;
setInterval(function(){
  var h=nv?nv.offsetHeight:50;
  var idx=0;
  for(var k=0;k<ss.length;k++){
    if(ss[k].getBoundingClientRect().top<=h+20)idx=k;
  }
  var atBottom=(window.innerHeight+window.pageYOffset)>=document.body.scrollHeight-50;
  if(atBottom)idx=ss.length-1;
  if(idx===last)return;
  last=idx;
  for(var j=0;j<ts.length;j++) ts[j].className=(j===idx)?'ct on':'ct';
  if(ni&&ts[idx]) ni.scrollLeft=ts[idx].offsetLeft-ni.offsetWidth/2+ts[idx].offsetWidth/2;
},100);
})();`;

// ============================================================
// 테마 정의 (확장)
// ============================================================

interface Theme {
  name: string;
  bg: string;
  cardBg: string;
  textColor: string;
  textSub: string;
  textMuted: string;
  heroGradient: string;
  heroPattern?: string;
  priceColor: string;
  badgeGradient: string;
  badgeShadow: string;
  catIconGradient: string;
  tabActiveColor: string;
  tagColors: { red: string; gold: string; blue: string };
  emojiBg: string;
  isDark?: boolean;
  heroAccent?: string;
  borderColor: string;
  chipBg: string;
  chipColor: string;
  cardDiscountColor: string;
}

const THEMES: Record<string, Theme> = {
  grid: {
    name: '가격 강조형', bg: '#f3f4f6', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#6b7280', textMuted: '#9ca3af',
    heroGradient: 'linear-gradient(145deg,#dc2626 0%,#b91c1c 40%,#991b1b 100%)',
    heroPattern: 'radial-gradient(circle at 20% 80%,rgba(249,115,22,.25) 0%,transparent 50%),radial-gradient(circle at 85% 20%,rgba(245,158,11,.2) 0%,transparent 40%)',
    priceColor: '#dc2626', badgeGradient: 'linear-gradient(135deg,#dc2626,#ea580c)', badgeShadow: 'rgba(220,38,38,.35)',
    catIconGradient: 'linear-gradient(135deg,#dc2626,#ea580c)', tabActiveColor: '#dc2626',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#1d4ed8' }, emojiBg: 'linear-gradient(145deg,#fef7f0,#fff5f5)',
    heroAccent: 'rgba(255,255,255,.1)', borderColor: '#e5e7eb',
    chipBg: '#fef2f2', chipColor: '#b91c1c', cardDiscountColor: '#16a34a',
  },
  magazine: {
    name: '매거진형', bg: '#fafaf9', cardBg: '#fff', textColor: '#1c1917', textSub: '#57534e', textMuted: '#a8a29e',
    heroGradient: 'linear-gradient(160deg,#292524 0%,#1c1917 60%,#0c0a09 100%)',
    heroPattern: 'radial-gradient(ellipse at 70% 20%,rgba(245,158,11,.12) 0%,transparent 60%)',
    priceColor: '#c2410c', badgeGradient: 'linear-gradient(135deg,#ea580c,#c2410c)', badgeShadow: 'rgba(194,65,12,.3)',
    catIconGradient: 'linear-gradient(135deg,#c2410c,#ea580c)', tabActiveColor: '#c2410c',
    tagColors: { red: '#dc2626', gold: '#92400e', blue: '#1d4ed8' }, emojiBg: 'linear-gradient(145deg,#fafaf9,#f5f5f4)',
    heroAccent: 'rgba(245,158,11,.08)', borderColor: '#e7e5e4',
    chipBg: '#fff7ed', chipColor: '#9a3412', cardDiscountColor: '#15803d',
  },
  editorial: {
    name: '에디토리얼', bg: '#fff', cardBg: '#fff', textColor: '#111827', textSub: '#4b5563', textMuted: '#9ca3af',
    heroGradient: 'linear-gradient(180deg,#0f172a 0%,#1e293b 100%)',
    heroPattern: 'none',
    priceColor: '#0f172a', badgeGradient: 'linear-gradient(135deg,#ef4444,#dc2626)', badgeShadow: 'rgba(239,68,68,.3)',
    catIconGradient: 'linear-gradient(135deg,#0f172a,#334155)', tabActiveColor: '#0f172a',
    tagColors: { red: '#dc2626', gold: '#92400e', blue: '#1e40af' }, emojiBg: 'linear-gradient(145deg,#f8fafc,#f1f5f9)',
    heroAccent: 'rgba(255,255,255,.06)', borderColor: '#e5e7eb',
    chipBg: '#f1f5f9', chipColor: '#334155', cardDiscountColor: '#059669',
  },
  showcase: {
    name: '쇼케이스', bg: '#fafafa', cardBg: '#fff', textColor: '#18181b', textSub: '#52525b', textMuted: '#a1a1aa',
    heroGradient: 'linear-gradient(135deg,#7c3aed 0%,#6d28d9 50%,#4c1d95 100%)',
    heroPattern: 'radial-gradient(circle at 80% 80%,rgba(236,72,153,.2) 0%,transparent 50%),radial-gradient(circle at 10% 20%,rgba(139,92,246,.25) 0%,transparent 40%)',
    priceColor: '#7c3aed', badgeGradient: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', badgeShadow: 'rgba(124,58,237,.35)',
    catIconGradient: 'linear-gradient(135deg,#8b5cf6,#6d28d9)', tabActiveColor: '#7c3aed',
    tagColors: { red: '#e11d48', gold: '#b45309', blue: '#7c3aed' }, emojiBg: 'linear-gradient(145deg,#faf5ff,#ede9fe)',
    heroAccent: 'rgba(139,92,246,.15)', borderColor: '#e4e4e7',
    chipBg: '#f5f3ff', chipColor: '#6d28d9', cardDiscountColor: '#059669',
  },
  highlight: {
    name: '특가 하이라이트', bg: '#0a0a0a', cardBg: '#141414', textColor: '#fafafa', textSub: '#a3a3a3', textMuted: '#737373',
    heroGradient: 'linear-gradient(145deg,#18181b 0%,#09090b 50%,#0a0a0a 100%)',
    heroPattern: 'radial-gradient(circle at 50% 50%,rgba(250,204,21,.08) 0%,transparent 60%)',
    priceColor: '#facc15', badgeGradient: 'linear-gradient(135deg,#facc15,#eab308)', badgeShadow: 'rgba(250,204,21,.25)',
    catIconGradient: 'linear-gradient(135deg,#facc15,#eab308)', tabActiveColor: '#facc15',
    tagColors: { red: '#ef4444', gold: '#facc15', blue: '#60a5fa' }, emojiBg: 'linear-gradient(145deg,#18181b,#27272a)',
    isDark: true, heroAccent: 'rgba(250,204,21,.06)', borderColor: '#27272a',
    chipBg: 'rgba(250,204,21,.1)', chipColor: '#facc15', cardDiscountColor: '#4ade80',
  },
  mart_fresh: {
    name: '신선식품 특화', bg: '#f0fdf4', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#4b5563', textMuted: '#9ca3af',
    heroGradient: 'linear-gradient(145deg,#15803d 0%,#166534 40%,#14532d 100%)',
    heroPattern: 'radial-gradient(circle at 20% 70%,rgba(34,197,94,.2) 0%,transparent 50%)',
    priceColor: '#15803d', badgeGradient: 'linear-gradient(135deg,#16a34a,#15803d)', badgeShadow: 'rgba(22,163,74,.3)',
    catIconGradient: 'linear-gradient(135deg,#16a34a,#22c55e)', tabActiveColor: '#15803d',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#16a34a' }, emojiBg: 'linear-gradient(145deg,#f0fdf4,#dcfce7)',
    heroAccent: 'rgba(255,255,255,.08)', borderColor: '#d1fae5',
    chipBg: '#dcfce7', chipColor: '#166534', cardDiscountColor: '#b45309',
  },
  mart_weekend: {
    name: '주말특가', bg: '#fdf2f8', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#6b7280', textMuted: '#a78bfa',
    heroGradient: 'linear-gradient(145deg,#be185d 0%,#9d174d 40%,#831843 100%)',
    heroPattern: 'radial-gradient(circle at 80% 30%,rgba(244,114,182,.25) 0%,transparent 50%)',
    priceColor: '#be185d', badgeGradient: 'linear-gradient(135deg,#ec4899,#be185d)', badgeShadow: 'rgba(190,24,93,.3)',
    catIconGradient: 'linear-gradient(135deg,#ec4899,#be185d)', tabActiveColor: '#be185d',
    tagColors: { red: '#e11d48', gold: '#b45309', blue: '#7c3aed' }, emojiBg: 'linear-gradient(145deg,#fdf2f8,#fce7f3)',
    heroAccent: 'rgba(244,114,182,.12)', borderColor: '#fce7f3',
    chipBg: '#fce7f3', chipColor: '#9d174d', cardDiscountColor: '#059669',
  },
  mart_seasonal: {
    name: '시즌 행사', bg: '#f0f9ff', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#64748b', textMuted: '#94a3b8',
    heroGradient: 'linear-gradient(145deg,#0c4a6e 0%,#075985 40%,#0369a1 100%)',
    heroPattern: 'radial-gradient(circle at 30% 80%,rgba(14,165,233,.2) 0%,transparent 50%)',
    priceColor: '#0369a1', badgeGradient: 'linear-gradient(135deg,#0284c7,#0369a1)', badgeShadow: 'rgba(3,105,161,.3)',
    catIconGradient: 'linear-gradient(135deg,#0284c7,#0ea5e9)', tabActiveColor: '#0369a1',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#0369a1' }, emojiBg: 'linear-gradient(145deg,#f0f9ff,#e0f2fe)',
    heroAccent: 'rgba(14,165,233,.1)', borderColor: '#bae6fd',
    chipBg: '#e0f2fe', chipColor: '#075985', cardDiscountColor: '#15803d',
  },
  mart_clearance: {
    name: '창고대방출', bg: '#fefce8', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#6b7280', textMuted: '#a16207',
    heroGradient: 'linear-gradient(145deg,#b91c1c 0%,#dc2626 40%,#ef4444 100%)',
    heroPattern: 'radial-gradient(circle at 70% 30%,rgba(234,179,8,.3) 0%,transparent 50%)',
    priceColor: '#b91c1c', badgeGradient: 'linear-gradient(135deg,#dc2626,#b91c1c)', badgeShadow: 'rgba(185,28,28,.35)',
    catIconGradient: 'linear-gradient(135deg,#dc2626,#ef4444)', tabActiveColor: '#b91c1c',
    tagColors: { red: '#dc2626', gold: '#ca8a04', blue: '#1d4ed8' }, emojiBg: 'linear-gradient(145deg,#fefce8,#fef9c3)',
    heroAccent: 'rgba(234,179,8,.15)', borderColor: '#fde68a',
    chipBg: '#fef9c3', chipColor: '#92400e', cardDiscountColor: '#15803d',
  },
  butcher_premium: {
    name: '프리미엄 정육', bg: '#0c0a09', cardBg: '#1c1917', textColor: '#fafaf9', textSub: '#a8a29e', textMuted: '#78716c',
    heroGradient: 'linear-gradient(160deg,#1c1917 0%,#0c0a09 50%,#000 100%)',
    heroPattern: 'radial-gradient(ellipse at 50% 50%,rgba(217,170,81,.08) 0%,transparent 60%)',
    priceColor: '#d9aa51', badgeGradient: 'linear-gradient(135deg,#d9aa51,#b8860b)', badgeShadow: 'rgba(217,170,81,.3)',
    catIconGradient: 'linear-gradient(135deg,#d9aa51,#b8860b)', tabActiveColor: '#d9aa51',
    tagColors: { red: '#ef4444', gold: '#d9aa51', blue: '#60a5fa' }, emojiBg: 'linear-gradient(145deg,#1c1917,#292524)',
    isDark: true, heroAccent: 'rgba(217,170,81,.06)', borderColor: '#292524',
    chipBg: 'rgba(217,170,81,.12)', chipColor: '#d9aa51', cardDiscountColor: '#4ade80',
  },
  butcher_daily: {
    name: '오늘의 고기', bg: '#fef2f2', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#6b7280', textMuted: '#9ca3af',
    heroGradient: 'linear-gradient(145deg,#991b1b 0%,#b91c1c 40%,#dc2626 100%)',
    heroPattern: 'radial-gradient(circle at 80% 20%,rgba(251,146,60,.2) 0%,transparent 50%)',
    priceColor: '#b91c1c', badgeGradient: 'linear-gradient(135deg,#dc2626,#b91c1c)', badgeShadow: 'rgba(185,28,28,.3)',
    catIconGradient: 'linear-gradient(135deg,#dc2626,#ef4444)', tabActiveColor: '#b91c1c',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#1d4ed8' }, emojiBg: 'linear-gradient(145deg,#fef2f2,#fee2e2)',
    heroAccent: 'rgba(251,146,60,.12)', borderColor: '#fecaca',
    chipBg: '#fee2e2', chipColor: '#991b1b', cardDiscountColor: '#15803d',
  },
  butcher_bulk: {
    name: '대용량 팩', bg: '#f5f3ff', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#64748b', textMuted: '#94a3b8',
    heroGradient: 'linear-gradient(145deg,#312e81 0%,#3730a3 40%,#4338ca 100%)',
    heroPattern: 'radial-gradient(circle at 20% 80%,rgba(99,102,241,.2) 0%,transparent 50%)',
    priceColor: '#3730a3', badgeGradient: 'linear-gradient(135deg,#4f46e5,#3730a3)', badgeShadow: 'rgba(55,48,163,.3)',
    catIconGradient: 'linear-gradient(135deg,#4f46e5,#6366f1)', tabActiveColor: '#3730a3',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#3730a3' }, emojiBg: 'linear-gradient(145deg,#f5f3ff,#ede9fe)',
    heroAccent: 'rgba(99,102,241,.12)', borderColor: '#c4b5fd',
    chipBg: '#ede9fe', chipColor: '#4338ca', cardDiscountColor: '#059669',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 시즌 테마 (6개) — 모든 업종 공통
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  season_newyear: {
    name: '설날 특선', bg: '#fef2f2', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#78350f', textMuted: '#a16207',
    heroGradient: 'linear-gradient(145deg,#991b1b 0%,#b91c1c 30%,#dc2626 100%)',
    heroPattern: 'radial-gradient(circle at 80% 30%,rgba(234,179,8,.35) 0%,transparent 50%),radial-gradient(circle at 20% 80%,rgba(234,179,8,.2) 0%,transparent 40%)',
    priceColor: '#b91c1c', badgeGradient: 'linear-gradient(135deg,#dc2626,#ca8a04)', badgeShadow: 'rgba(185,28,28,.35)',
    catIconGradient: 'linear-gradient(135deg,#dc2626,#ca8a04)', tabActiveColor: '#b91c1c',
    tagColors: { red: '#dc2626', gold: '#ca8a04', blue: '#b91c1c' }, emojiBg: 'linear-gradient(145deg,#fef2f2,#fef9c3)',
    heroAccent: 'rgba(234,179,8,.2)', borderColor: '#fde68a',
    chipBg: '#fef9c3', chipColor: '#92400e', cardDiscountColor: '#b91c1c',
  },
  season_chuseok: {
    name: '추석 한가위', bg: '#fffbeb', cardBg: '#fff', textColor: '#1c1917', textSub: '#57534e', textMuted: '#a8a29e',
    heroGradient: 'linear-gradient(160deg,#1e3a5f 0%,#1e40af 40%,#3b82f6 100%)',
    heroPattern: 'radial-gradient(circle at 50% 30%,rgba(251,191,36,.3) 0%,transparent 50%)',
    priceColor: '#1e40af', badgeGradient: 'linear-gradient(135deg,#f59e0b,#d97706)', badgeShadow: 'rgba(245,158,11,.35)',
    catIconGradient: 'linear-gradient(135deg,#2563eb,#1e40af)', tabActiveColor: '#1e40af',
    tagColors: { red: '#dc2626', gold: '#d97706', blue: '#1e40af' }, emojiBg: 'linear-gradient(145deg,#fffbeb,#fef3c7)',
    heroAccent: 'rgba(251,191,36,.15)', borderColor: '#fde68a',
    chipBg: '#fef3c7', chipColor: '#92400e', cardDiscountColor: '#059669',
  },
  season_summer: {
    name: '여름 시원특가', bg: '#ecfeff', cardBg: '#fff', textColor: '#164e63', textSub: '#155e75', textMuted: '#67e8f9',
    heroGradient: 'linear-gradient(145deg,#0891b2 0%,#06b6d4 40%,#22d3ee 100%)',
    heroPattern: 'radial-gradient(circle at 70% 20%,rgba(56,189,248,.3) 0%,transparent 50%),radial-gradient(circle at 20% 80%,rgba(34,211,238,.2) 0%,transparent 40%)',
    priceColor: '#0e7490', badgeGradient: 'linear-gradient(135deg,#06b6d4,#0891b2)', badgeShadow: 'rgba(8,145,178,.35)',
    catIconGradient: 'linear-gradient(135deg,#06b6d4,#22d3ee)', tabActiveColor: '#0891b2',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#0891b2' }, emojiBg: 'linear-gradient(145deg,#ecfeff,#cffafe)',
    heroAccent: 'rgba(34,211,238,.15)', borderColor: '#a5f3fc',
    chipBg: '#cffafe', chipColor: '#155e75', cardDiscountColor: '#dc2626',
  },
  season_winter: {
    name: '겨울 따뜻특가', bg: '#fff1f2', cardBg: '#fff', textColor: '#1c1917', textSub: '#57534e', textMuted: '#a8a29e',
    heroGradient: 'linear-gradient(160deg,#881337 0%,#be123c 40%,#e11d48 100%)',
    heroPattern: 'radial-gradient(circle at 30% 70%,rgba(251,113,133,.2) 0%,transparent 50%)',
    priceColor: '#be123c', badgeGradient: 'linear-gradient(135deg,#e11d48,#be123c)', badgeShadow: 'rgba(190,18,60,.3)',
    catIconGradient: 'linear-gradient(135deg,#e11d48,#fb7185)', tabActiveColor: '#be123c',
    tagColors: { red: '#e11d48', gold: '#b45309', blue: '#7c3aed' }, emojiBg: 'linear-gradient(145deg,#fff1f2,#ffe4e6)',
    heroAccent: 'rgba(251,113,133,.1)', borderColor: '#fecdd3',
    chipBg: '#ffe4e6', chipColor: '#9f1239', cardDiscountColor: '#059669',
  },
  season_christmas: {
    name: '크리스마스', bg: '#052e16', cardBg: '#14532d', textColor: '#f0fdf4', textSub: '#86efac', textMuted: '#4ade80',
    heroGradient: 'linear-gradient(145deg,#14532d 0%,#166534 40%,#15803d 100%)',
    heroPattern: 'radial-gradient(circle at 80% 20%,rgba(220,38,38,.25) 0%,transparent 50%),radial-gradient(circle at 20% 80%,rgba(234,179,8,.15) 0%,transparent 40%)',
    priceColor: '#fbbf24', badgeGradient: 'linear-gradient(135deg,#dc2626,#b91c1c)', badgeShadow: 'rgba(220,38,38,.3)',
    catIconGradient: 'linear-gradient(135deg,#dc2626,#fbbf24)', tabActiveColor: '#fbbf24',
    tagColors: { red: '#ef4444', gold: '#fbbf24', blue: '#86efac' }, emojiBg: 'linear-gradient(145deg,#14532d,#166534)',
    isDark: true, heroAccent: 'rgba(220,38,38,.1)', borderColor: '#166534',
    chipBg: 'rgba(220,38,38,.15)', chipColor: '#fca5a5', cardDiscountColor: '#fbbf24',
  },
  season_spring: {
    name: '봄맞이 행사', bg: '#fdf2f8', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#6b7280', textMuted: '#d946ef',
    heroGradient: 'linear-gradient(145deg,#ec4899 0%,#d946ef 40%,#a855f7 100%)',
    heroPattern: 'radial-gradient(circle at 30% 70%,rgba(244,114,182,.25) 0%,transparent 50%),radial-gradient(circle at 80% 20%,rgba(192,132,252,.2) 0%,transparent 40%)',
    priceColor: '#c026d3', badgeGradient: 'linear-gradient(135deg,#ec4899,#d946ef)', badgeShadow: 'rgba(217,70,239,.3)',
    catIconGradient: 'linear-gradient(135deg,#ec4899,#a855f7)', tabActiveColor: '#c026d3',
    tagColors: { red: '#e11d48', gold: '#d97706', blue: '#9333ea' }, emojiBg: 'linear-gradient(145deg,#fdf2f8,#fae8ff)',
    heroAccent: 'rgba(192,132,252,.12)', borderColor: '#f0abfc',
    chipBg: '#fae8ff', chipColor: '#86198f', cardDiscountColor: '#059669',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 행사 유형 테마 (5개) — 모든 업종 공통
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  event_bogo: {
    name: '1+1 / 2+1', bg: '#fff7ed', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#92400e', textMuted: '#b45309',
    heroGradient: 'linear-gradient(145deg,#c2410c 0%,#ea580c 40%,#f97316 100%)',
    heroPattern: 'radial-gradient(circle at 20% 80%,rgba(251,146,60,.3) 0%,transparent 50%)',
    priceColor: '#c2410c', badgeGradient: 'linear-gradient(135deg,#f97316,#ea580c)', badgeShadow: 'rgba(234,88,12,.35)',
    catIconGradient: 'linear-gradient(135deg,#f97316,#ea580c)', tabActiveColor: '#ea580c',
    tagColors: { red: '#dc2626', gold: '#ea580c', blue: '#1d4ed8' }, emojiBg: 'linear-gradient(145deg,#fff7ed,#ffedd5)',
    heroAccent: 'rgba(251,146,60,.15)', borderColor: '#fed7aa',
    chipBg: '#ffedd5', chipColor: '#9a3412', cardDiscountColor: '#15803d',
  },
  event_timesale: {
    name: '타임세일', bg: '#0f0f0f', cardBg: '#1a1a1a', textColor: '#fafafa', textSub: '#a3a3a3', textMuted: '#737373',
    heroGradient: 'linear-gradient(145deg,#0a0a0a 0%,#171717 40%,#1f1f1f 100%)',
    heroPattern: 'radial-gradient(circle at 50% 50%,rgba(239,68,68,.12) 0%,transparent 60%)',
    priceColor: '#ef4444', badgeGradient: 'linear-gradient(135deg,#ef4444,#dc2626)', badgeShadow: 'rgba(239,68,68,.3)',
    catIconGradient: 'linear-gradient(135deg,#ef4444,#f87171)', tabActiveColor: '#ef4444',
    tagColors: { red: '#ef4444', gold: '#fbbf24', blue: '#60a5fa' }, emojiBg: 'linear-gradient(145deg,#171717,#262626)',
    isDark: true, heroAccent: 'rgba(239,68,68,.08)', borderColor: '#262626',
    chipBg: 'rgba(239,68,68,.12)', chipColor: '#f87171', cardDiscountColor: '#4ade80',
  },
  event_membership: {
    name: '멤버십 데이', bg: '#faf5ff', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#6b21a8', textMuted: '#a78bfa',
    heroGradient: 'linear-gradient(145deg,#581c87 0%,#7e22ce 40%,#9333ea 100%)',
    heroPattern: 'radial-gradient(circle at 80% 30%,rgba(192,132,252,.25) 0%,transparent 50%),radial-gradient(circle at 20% 70%,rgba(168,85,247,.15) 0%,transparent 40%)',
    priceColor: '#7e22ce', badgeGradient: 'linear-gradient(135deg,#9333ea,#7e22ce)', badgeShadow: 'rgba(126,34,206,.3)',
    catIconGradient: 'linear-gradient(135deg,#9333ea,#a855f7)', tabActiveColor: '#7e22ce',
    tagColors: { red: '#dc2626', gold: '#d97706', blue: '#7e22ce' }, emojiBg: 'linear-gradient(145deg,#faf5ff,#f3e8ff)',
    heroAccent: 'rgba(168,85,247,.1)', borderColor: '#e9d5ff',
    chipBg: '#f3e8ff', chipColor: '#6b21a8', cardDiscountColor: '#059669',
  },
  event_coupon: {
    name: '할인쿠폰 특가', bg: '#f0fdf4', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#166534', textMuted: '#4ade80',
    heroGradient: 'linear-gradient(145deg,#166534 0%,#15803d 40%,#16a34a 100%)',
    heroPattern: 'radial-gradient(circle at 70% 30%,rgba(250,204,21,.25) 0%,transparent 50%)',
    priceColor: '#15803d', badgeGradient: 'linear-gradient(135deg,#16a34a,#ca8a04)', badgeShadow: 'rgba(22,163,74,.3)',
    catIconGradient: 'linear-gradient(135deg,#16a34a,#ca8a04)', tabActiveColor: '#15803d',
    tagColors: { red: '#dc2626', gold: '#ca8a04', blue: '#16a34a' }, emojiBg: 'linear-gradient(145deg,#f0fdf4,#dcfce7)',
    heroAccent: 'rgba(250,204,21,.12)', borderColor: '#bbf7d0',
    chipBg: '#dcfce7', chipColor: '#14532d', cardDiscountColor: '#ca8a04',
  },
  event_grand_open: {
    name: '그랜드 오픈', bg: '#0c0a09', cardBg: '#1c1917', textColor: '#fafaf9', textSub: '#d6d3d1', textMuted: '#a8a29e',
    heroGradient: 'linear-gradient(160deg,#0c0a09 0%,#1c1917 40%,#292524 100%)',
    heroPattern: 'radial-gradient(circle at 50% 50%,rgba(234,179,8,.12) 0%,transparent 50%),radial-gradient(circle at 80% 20%,rgba(217,119,6,.08) 0%,transparent 40%)',
    priceColor: '#fbbf24', badgeGradient: 'linear-gradient(135deg,#fbbf24,#d97706)', badgeShadow: 'rgba(251,191,36,.3)',
    catIconGradient: 'linear-gradient(135deg,#fbbf24,#f59e0b)', tabActiveColor: '#fbbf24',
    tagColors: { red: '#ef4444', gold: '#fbbf24', blue: '#93c5fd' }, emojiBg: 'linear-gradient(145deg,#1c1917,#292524)',
    isDark: true, heroAccent: 'rgba(234,179,8,.08)', borderColor: '#44403c',
    chipBg: 'rgba(251,191,36,.12)', chipColor: '#fbbf24', cardDiscountColor: '#4ade80',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 업종 확장 테마 (6개)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  mart_seafood: {
    name: '수산 코너', bg: '#eff6ff', cardBg: '#fff', textColor: '#1e3a5f', textSub: '#1e40af', textMuted: '#93c5fd',
    heroGradient: 'linear-gradient(145deg,#1e3a8a 0%,#1d4ed8 40%,#2563eb 100%)',
    heroPattern: 'radial-gradient(circle at 80% 80%,rgba(59,130,246,.2) 0%,transparent 50%)',
    priceColor: '#1d4ed8', badgeGradient: 'linear-gradient(135deg,#2563eb,#1d4ed8)', badgeShadow: 'rgba(29,78,216,.35)',
    catIconGradient: 'linear-gradient(135deg,#3b82f6,#2563eb)', tabActiveColor: '#1d4ed8',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#1d4ed8' }, emojiBg: 'linear-gradient(145deg,#eff6ff,#dbeafe)',
    heroAccent: 'rgba(59,130,246,.1)', borderColor: '#bfdbfe',
    chipBg: '#dbeafe', chipColor: '#1e40af', cardDiscountColor: '#dc2626',
  },
  mart_produce: {
    name: '청과 코너', bg: '#fefce8', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#4d7c0f', textMuted: '#84cc16',
    heroGradient: 'linear-gradient(145deg,#3f6212 0%,#4d7c0f 40%,#65a30d 100%)',
    heroPattern: 'radial-gradient(circle at 30% 70%,rgba(163,230,53,.2) 0%,transparent 50%),radial-gradient(circle at 70% 20%,rgba(250,204,21,.15) 0%,transparent 40%)',
    priceColor: '#4d7c0f', badgeGradient: 'linear-gradient(135deg,#84cc16,#65a30d)', badgeShadow: 'rgba(77,124,15,.3)',
    catIconGradient: 'linear-gradient(135deg,#84cc16,#65a30d)', tabActiveColor: '#4d7c0f',
    tagColors: { red: '#dc2626', gold: '#ca8a04', blue: '#4d7c0f' }, emojiBg: 'linear-gradient(145deg,#fefce8,#ecfccb)',
    heroAccent: 'rgba(163,230,53,.12)', borderColor: '#d9f99d',
    chipBg: '#ecfccb', chipColor: '#3f6212', cardDiscountColor: '#dc2626',
  },
  mart_general: {
    name: '공산품 특가', bg: '#f8fafc', cardBg: '#fff', textColor: '#1e293b', textSub: '#475569', textMuted: '#94a3b8',
    heroGradient: 'linear-gradient(145deg,#334155 0%,#475569 40%,#64748b 100%)',
    heroPattern: 'radial-gradient(circle at 20% 80%,rgba(99,102,241,.12) 0%,transparent 50%)',
    priceColor: '#dc2626', badgeGradient: 'linear-gradient(135deg,#475569,#334155)', badgeShadow: 'rgba(51,65,85,.3)',
    catIconGradient: 'linear-gradient(135deg,#6366f1,#4f46e5)', tabActiveColor: '#4f46e5',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#4f46e5' }, emojiBg: 'linear-gradient(145deg,#f8fafc,#f1f5f9)',
    heroAccent: 'rgba(99,102,241,.06)', borderColor: '#e2e8f0',
    chipBg: '#f1f5f9', chipColor: '#334155', cardDiscountColor: '#16a34a',
  },
  butcher_hanwoo: {
    name: '한우 전문', bg: '#1c1917', cardBg: '#292524', textColor: '#fafaf9', textSub: '#e7e5e4', textMuted: '#a8a29e',
    heroGradient: 'linear-gradient(160deg,#0c0a09 0%,#1c1917 50%,#292524 100%)',
    heroPattern: 'radial-gradient(ellipse at 50% 50%,rgba(180,83,9,.1) 0%,transparent 60%),radial-gradient(circle at 80% 20%,rgba(217,119,6,.08) 0%,transparent 40%)',
    priceColor: '#f59e0b', badgeGradient: 'linear-gradient(135deg,#f59e0b,#d97706)', badgeShadow: 'rgba(245,158,11,.3)',
    catIconGradient: 'linear-gradient(135deg,#f59e0b,#d97706)', tabActiveColor: '#f59e0b',
    tagColors: { red: '#ef4444', gold: '#f59e0b', blue: '#93c5fd' }, emojiBg: 'linear-gradient(145deg,#292524,#44403c)',
    isDark: true, heroAccent: 'rgba(180,83,9,.08)', borderColor: '#44403c',
    chipBg: 'rgba(245,158,11,.12)', chipColor: '#fbbf24', cardDiscountColor: '#4ade80',
  },
  butcher_import: {
    name: '수입육 특가', bg: '#f8fafc', cardBg: '#fff', textColor: '#0f172a', textSub: '#334155', textMuted: '#64748b',
    heroGradient: 'linear-gradient(145deg,#0f172a 0%,#1e293b 40%,#334155 100%)',
    heroPattern: 'radial-gradient(circle at 80% 30%,rgba(239,68,68,.15) 0%,transparent 50%)',
    priceColor: '#dc2626', badgeGradient: 'linear-gradient(135deg,#dc2626,#0f172a)', badgeShadow: 'rgba(15,23,42,.3)',
    catIconGradient: 'linear-gradient(135deg,#dc2626,#ef4444)', tabActiveColor: '#dc2626',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#1e40af' }, emojiBg: 'linear-gradient(145deg,#f8fafc,#f1f5f9)',
    heroAccent: 'rgba(239,68,68,.06)', borderColor: '#e2e8f0',
    chipBg: '#fee2e2', chipColor: '#991b1b', cardDiscountColor: '#059669',
  },
  butcher_giftset: {
    name: '선물세트', bg: '#fdf2f8', cardBg: '#fff', textColor: '#1c1917', textSub: '#78350f', textMuted: '#b45309',
    heroGradient: 'linear-gradient(160deg,#78350f 0%,#92400e 30%,#b45309 100%)',
    heroPattern: 'radial-gradient(circle at 70% 30%,rgba(234,179,8,.25) 0%,transparent 50%),radial-gradient(circle at 20% 80%,rgba(180,83,9,.15) 0%,transparent 40%)',
    priceColor: '#92400e', badgeGradient: 'linear-gradient(135deg,#d97706,#b45309)', badgeShadow: 'rgba(146,64,14,.35)',
    catIconGradient: 'linear-gradient(135deg,#d97706,#f59e0b)', tabActiveColor: '#b45309',
    tagColors: { red: '#dc2626', gold: '#d97706', blue: '#7c3aed' }, emojiBg: 'linear-gradient(145deg,#fffbeb,#fef3c7)',
    heroAccent: 'rgba(234,179,8,.12)', borderColor: '#fde68a',
    chipBg: '#fef3c7', chipColor: '#78350f', cardDiscountColor: '#059669',
  },
};

// ============================================================
// ★ QR 쿠폰 하단 섹션
// ============================================================

function renderQrSection(d: FlyerRenderData): string {
  if (!d.qrCodeDataUrl) return '';
  return `<div style="margin:24px auto 0;padding:20px;text-align:center;border-top:2px dashed #e0e0e0;max-width:340px">
    <img src="${d.qrCodeDataUrl}" alt="QR" style="width:140px;height:140px;margin:0 auto 10px;display:block;border-radius:8px"/>
    <p style="font-size:15px;font-weight:700;color:#333;margin:0">${esc(d.qrCouponText || '스캔하고 할인 받으세요!')}</p>
    <p style="font-size:11px;color:#999;margin-top:4px">QR 코드를 스마트폰 카메라로 스캔하세요</p>
  </div>`;
}

// ============================================================
// 카테고리 탭 HTML (여러 엔진에서 공용)
// ============================================================

function renderCatTabs(d: FlyerRenderData): string {
  return d.categories.map((cat, i) =>
    `<a class="ct${i === 0 ? ' on' : ''}" href="#s${i}">${esc(cat.name || '')}</a>`
  ).join('');
}

// ============================================================
// ★ 엔진 1: GRID — 2열 카드 그리드 (가격 최우선 + 장식 히어로)
// ============================================================

function renderGridEngine(d: FlyerRenderData, t: Theme): string {
  const catTabs = renderCatTabs(d);
  let sections = '';
  for (let ci = 0; ci < d.categories.length; ci++) {
    const cat = d.categories[ci];
    const items = cat.items || [];
    let cards = '';
    for (const item of items) {
      const img = resolveImg(item.name || '', 200, item.imageUrl);
      const disc = calcDisc(item.originalPrice, item.salePrice);
      const hasOrig = item.originalPrice && item.originalPrice > item.salePrice;
      const tagType = item.badge && /특가|할인|초특가|한정/.test(item.badge) ? 'red' : item.badge && /인기|추천|프리미엄|신선/.test(item.badge) ? 'blue' : 'gold';
      cards += `<div class="c">
        <div class="ci">${disc > 0 ? `<span class="bd">${disc}<small>%</small></span>` : ''}${img}</div>
        <div class="cb">
          <p class="cn">${esc(item.name || '')}</p>
          ${renderMetaChips(item, t.chipBg, t.chipColor)}
          ${hasOrig ? `<p class="co">${fmtPrice(item.originalPrice)}원</p>` : ''}
          <p class="cp"><span class="pn">${fmtPrice(item.salePrice || 0)}</span><span class="pw">원</span></p>
          ${renderCardDiscount(item, t.cardDiscountColor)}
          ${renderAiCopy(item, t.textSub)}
          ${item.badge ? `<span class="tg ${tagType}">${esc(item.badge)}</span>` : ''}
        </div>
      </div>`;
    }
    sections += `<section class="sc" id="s${ci}">
      <div class="sh"><div class="si">${String(ci + 1).padStart(2, '0')}</div><span class="sn">${esc(cat.name || '')}</span><span class="sk">${items.length}개 상품</span></div>
      <div class="g">${cards}</div>
    </section>`;
  }

  const darkMod = t.isDark ? `.c{border:1px solid ${t.borderColor}}` : '';

  const css = `
body{font-family:'Noto Sans KR',sans-serif;background:${t.bg};color:${t.textColor};-webkit-font-smoothing:antialiased;line-height:1.5}

/* ═══ HERO — Poster with Decorative Shapes ═══ */
.h{position:relative;background:${t.heroGradient};padding:56px 24px 68px;text-align:center;overflow:hidden}
.h::before{content:'';position:absolute;inset:0;background:${t.heroPattern || 'none'};pointer-events:none;z-index:1}
/* 장식 원형들 */
.h .dc1{position:absolute;top:-30px;right:-30px;width:140px;height:140px;border:2.5px solid ${t.heroAccent || 'transparent'};border-radius:50%;z-index:1}
.h .dc2{position:absolute;bottom:50px;left:-20px;width:80px;height:80px;border:2px solid ${t.heroAccent || 'transparent'};border-radius:50%;z-index:1}
.h .dc3{position:absolute;top:30px;left:15%;width:6px;height:6px;background:rgba(255,255,255,.25);border-radius:50%;z-index:1}
.h .dc4{position:absolute;top:60%;right:20%;width:4px;height:4px;background:rgba(255,255,255,.2);border-radius:50%;z-index:1}
.h .dc5{position:absolute;bottom:60px;right:12%;width:40px;height:40px;border:1.5px solid ${t.heroAccent || 'transparent'};border-radius:8px;transform:rotate(15deg);z-index:1}
.hs{font-size:14px;font-weight:700;color:rgba(255,255,255,.85);letter-spacing:6px;text-transform:uppercase;margin-bottom:16px;position:relative;z-index:2}
.hs::after{content:'';display:block;width:48px;height:2px;background:rgba(255,255,255,.35);margin:12px auto 0;border-radius:1px}
.ht{font-family:'Noto Sans KR',sans-serif;font-size:34px;font-weight:900;color:#fff;line-height:1.15;text-shadow:0 4px 20px rgba(0,0,0,.35);position:relative;z-index:2;letter-spacing:-1px}
.hp{display:inline-flex;align-items:center;gap:8px;margin-top:22px;background:rgba(255,255,255,.12);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.18);border-radius:28px;padding:10px 24px;font-size:13px;font-weight:600;color:#fff;position:relative;z-index:2}
.hw{position:absolute;bottom:0;left:0;right:0;height:36px;background:${t.bg};border-radius:36px 36px 0 0;z-index:3}

/* ═══ CATEGORY TABS ═══ */
.nav{position:-webkit-sticky;position:sticky;top:0;z-index:100;background:${t.isDark ? t.cardBg : 'rgba(255,255,255,.96)'};backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 1px 0 ${t.borderColor}}
.ni{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:10px 10px;gap:6px}
.ni::-webkit-scrollbar{display:none}
.ct{flex-shrink:0;scroll-snap-align:start;padding:8px 18px;font-size:13px;font-weight:700;color:${t.textMuted};white-space:nowrap;text-decoration:none;border-radius:20px;transition:all .2s ease}
.ct.on{color:#fff;background:${t.tabActiveColor};box-shadow:0 2px 8px ${t.badgeShadow}}

.w{padding:6px 14px 32px}
.sc{padding-top:28px}.sc:first-child{padding-top:16px}
.sh{display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:0 2px}
.si{width:42px;height:42px;border-radius:13px;background:${t.catIconGradient};display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:900;flex-shrink:0;box-shadow:0 4px 14px ${t.badgeShadow}}
.sn{font-size:20px;font-weight:900;color:${t.textColor};letter-spacing:-.5px}
.sk{font-size:11px;font-weight:600;color:${t.textMuted};margin-left:auto;background:${t.isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.04)'};padding:4px 10px;border-radius:10px}

/* ═══ PRODUCT GRID ═══ */
.g{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.c{background:${t.cardBg};border-radius:20px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.04);position:relative}
${darkMod}
.ci{position:relative;width:100%;aspect-ratio:1/.85;overflow:hidden;background:${t.isDark ? t.cardBg : '#f9fafb'}}
.ci .product-img{width:100%;height:100%;object-fit:cover;display:block}
.ci .emoji-area{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:64px;background:${t.emojiBg}}
.bd{position:absolute;top:10px;left:10px;z-index:2;background:${t.badgeGradient};color:#fff;font-size:16px;font-weight:900;padding:5px 11px;border-radius:10px;box-shadow:0 4px 12px ${t.badgeShadow};line-height:1;transform:rotate(-3deg)}
.bd small{font-size:11px;font-weight:800}
.cb{padding:14px 14px 18px}
.cn{font-size:15px;font-weight:800;color:${t.textColor};line-height:1.35;margin-bottom:2px;letter-spacing:-.3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.co{font-size:12px;font-weight:500;color:${t.textMuted};text-decoration:line-through;margin-top:6px;letter-spacing:-.2px}

/* ★ PRICE — Hero of the Card */
.cp{display:flex;align-items:baseline;gap:2px;line-height:1;margin-top:4px}
.pn{font-size:32px;font-weight:900;color:${t.priceColor};letter-spacing:-1.5px}
.pw{font-size:14px;font-weight:700;color:${t.priceColor};margin-left:2px;opacity:.75}

.tg{display:inline-flex;margin-top:8px;padding:4px 10px;font-size:10px;font-weight:800;border-radius:8px;line-height:1.2}
.tg.red{background:${t.isDark ? 'rgba(239,68,68,.12)' : '#fef2f2'};color:${t.tagColors.red};border:1px solid ${t.isDark ? 'rgba(239,68,68,.2)' : '#fecaca'}}
.tg.gold{background:${t.isDark ? 'rgba(212,168,68,.1)' : '#fffbeb'};color:${t.tagColors.gold};border:1px solid ${t.isDark ? 'rgba(212,168,68,.2)' : '#fde68a'}}
.tg.blue{background:${t.isDark ? 'rgba(96,165,250,.1)' : '#eff6ff'};color:${t.tagColors.blue};border:1px solid ${t.isDark ? 'rgba(96,165,250,.2)' : '#bfdbfe'}}

.ft{text-align:center;padding:32px 16px 40px;color:${t.textMuted};font-size:10px;font-weight:500;letter-spacing:2px}
@media(max-width:360px){.ht{font-size:26px}.pn{font-size:26px}.cn{font-size:13px}.h{padding:40px 20px 56px}}
@media(min-width:420px){.pn{font-size:36px}.ht{font-size:36px}}`;

  const body = `
<div class="h">
  <span class="dc1"></span><span class="dc2"></span><span class="dc3"></span><span class="dc4"></span><span class="dc5"></span>
  <p class="hs">${esc(d.storeName)}</p>
  <h1 class="ht">${esc(d.title)}</h1>
  ${d.period ? `<div class="hp"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>${esc(d.period)}</div>` : ''}
  <div class="hw"></div>
</div>
<nav class="nav"><div class="ni">${catTabs}</div></nav>
<div class="w">${sections}</div>
<div class="ft">hanjul-flyer.kr</div>`;

  return htmlWrap(d.title || d.storeName, css, body, STICKY_TAB_SCRIPT);
}

// ============================================================
// ★ 엔진 2: MAGAZINE — 1열 매거진형 (좌: 텍스트+가격, 우: 대형이미지)
// ============================================================

function renderMagazineEngine(d: FlyerRenderData, t: Theme): string {
  const catTabs = renderCatTabs(d);
  let sections = '';
  for (let ci = 0; ci < d.categories.length; ci++) {
    const cat = d.categories[ci];
    const items = cat.items || [];
    let cards = '';
    for (let ii = 0; ii < items.length; ii++) {
      const item = items[ii];
      const img = resolveImg(item.name || '', 240, item.imageUrl);
      const disc = calcDisc(item.originalPrice, item.salePrice);
      const hasOrig = item.originalPrice && item.originalPrice > item.salePrice;
      // 짝수/홀수 번갈아 이미지 좌우 배치
      const imgRight = ii % 2 === 0;
      const tagType = item.badge && /특가|할인|초특가|한정/.test(item.badge) ? 'red' : item.badge && /인기|추천|프리미엄|신선/.test(item.badge) ? 'blue' : 'gold';

      cards += `<div class="mc ${imgRight ? '' : 'flip'}">
        <div class="mt">
          ${disc > 0 ? `<div class="md"><span class="md-n">${disc}</span><span class="md-p">%<br>OFF</span></div>` : ''}
          <p class="mn">${esc(item.name || '')}</p>
          ${renderMetaChips(item, t.chipBg, t.chipColor)}
          ${hasOrig ? `<p class="mo">${fmtPrice(item.originalPrice)}원</p>` : ''}
          <div class="mp"><span class="mp-n">${fmtPrice(item.salePrice || 0)}</span><span class="mp-w">원</span></div>
          ${renderCardDiscount(item, t.cardDiscountColor)}
          ${renderAiCopy(item, t.textSub)}
          ${item.badge ? `<span class="tg ${tagType}">${esc(item.badge)}</span>` : ''}
        </div>
        <div class="mi">${img}</div>
      </div>`;
    }
    sections += `<section class="sc" id="s${ci}">
      <div class="sh">
        <div class="sl"></div>
        <span class="sn">${esc(cat.name || '')}</span>
        <span class="sk">${items.length}</span>
      </div>
      ${cards}
    </section>`;
  }

  const darkMod = t.isDark ? `.mc{border:1px solid ${t.borderColor}}` : '';

  const css = `
body{font-family:'Noto Sans KR',sans-serif;background:${t.bg};color:${t.textColor};-webkit-font-smoothing:antialiased;line-height:1.5}

/* ═══ HERO — Editorial Masthead ═══ */
.h{position:relative;background:${t.heroGradient};padding:44px 28px 56px;overflow:hidden}
.h::before{content:'';position:absolute;inset:0;background:${t.heroPattern || 'none'};pointer-events:none}
.h .deco{position:absolute;bottom:0;left:0;right:0;height:80px;background:linear-gradient(to top,${t.bg},transparent);z-index:2}
.hs{font-size:11px;font-weight:600;color:rgba(255,255,255,.6);letter-spacing:8px;text-transform:uppercase;margin-bottom:20px;position:relative;z-index:3}
.ht{font-family:'Noto Sans KR',sans-serif;font-size:32px;font-weight:900;color:#fff;line-height:1.2;position:relative;z-index:3;letter-spacing:-1px}
.ht::after{content:'';display:block;width:56px;height:3px;background:${t.priceColor};margin-top:18px;border-radius:2px}
.hp{margin-top:18px;font-size:13px;font-weight:500;color:rgba(255,255,255,.7);position:relative;z-index:3;display:flex;align-items:center;gap:6px}

/* ═══ CATEGORY TABS — Underline Style ═══ */
.nav{position:-webkit-sticky;position:sticky;top:0;z-index:100;background:${t.isDark ? t.cardBg : 'rgba(255,255,255,.97)'};backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid ${t.borderColor}}
.ni{display:flex;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:0 16px;gap:0}
.ni::-webkit-scrollbar{display:none}
.ct{flex-shrink:0;padding:14px 16px;font-size:13px;font-weight:700;color:${t.textMuted};white-space:nowrap;text-decoration:none;border-bottom:2.5px solid transparent;transition:all .2s ease}
.ct.on{color:${t.tabActiveColor};border-bottom-color:${t.tabActiveColor}}

.w{padding:0 16px 32px}

/* ═══ SECTION HEADER — Typographic ═══ */
.sc{padding-top:32px}
.sh{display:flex;align-items:center;gap:10px;margin-bottom:20px}
.sl{width:4px;height:28px;border-radius:2px;background:${t.catIconGradient};flex-shrink:0}
.sn{font-size:22px;font-weight:900;color:${t.textColor};letter-spacing:-.5px}
.sk{width:24px;height:24px;border-radius:50%;background:${t.isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.05)'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${t.textMuted};margin-left:auto}

/* ═══ MAGAZINE CARD — Hero Layout ═══ */
.mc{display:flex;background:${t.cardBg};border-radius:20px;overflow:hidden;margin-bottom:14px;box-shadow:0 2px 4px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);min-height:170px}
${darkMod}
.mc.flip{flex-direction:row-reverse}
.mt{flex:1;padding:18px 18px 20px;display:flex;flex-direction:column;justify-content:center;min-width:0}
.mi{width:45%;flex-shrink:0;position:relative;overflow:hidden;min-height:170px;align-self:stretch}
.mi .product-img{width:100%;height:100%;object-fit:cover;display:block}
.mi .emoji-area{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:56px;background:${t.emojiBg}}

/* 할인율 배지 — 매거진 스타일 */
.md{display:flex;align-items:baseline;gap:2px;margin-bottom:6px}
.md-n{font-size:36px;font-weight:900;color:${t.priceColor};line-height:1;letter-spacing:-2px}
.md-p{font-size:10px;font-weight:800;color:${t.priceColor};line-height:1.1;opacity:.8}

.mn{font-size:17px;font-weight:800;color:${t.textColor};line-height:1.35;margin-bottom:2px;letter-spacing:-.3px}
.mo{font-size:13px;color:${t.textMuted};text-decoration:line-through;margin-top:8px}

/* ★ PRICE — Massive, Dominant */
.mp{display:flex;align-items:baseline;gap:2px;margin-top:4px;line-height:1}
.mp-n{font-size:36px;font-weight:900;color:${t.priceColor};letter-spacing:-2px}
.mp-w{font-size:15px;font-weight:700;color:${t.priceColor};opacity:.7;margin-left:2px}

.tg{display:inline-flex;margin-top:8px;padding:4px 10px;font-size:10px;font-weight:800;border-radius:8px;line-height:1.2}
.tg.red{background:${t.isDark ? 'rgba(239,68,68,.1)' : '#fef2f2'};color:${t.tagColors.red};border:1px solid ${t.isDark ? 'rgba(239,68,68,.2)' : '#fecaca'}}
.tg.gold{background:${t.isDark ? 'rgba(212,168,68,.1)' : '#fffbeb'};color:${t.tagColors.gold};border:1px solid ${t.isDark ? 'rgba(212,168,68,.2)' : '#fde68a'}}
.tg.blue{background:${t.isDark ? 'rgba(96,165,250,.1)' : '#eff6ff'};color:${t.tagColors.blue};border:1px solid ${t.isDark ? 'rgba(96,165,250,.2)' : '#bfdbfe'}}

.ft{text-align:center;padding:32px 16px 40px;color:${t.textMuted};font-size:10px;font-weight:500;letter-spacing:2px}
@media(max-width:360px){.ht{font-size:26px}.mp-n{font-size:30px}.md-n{font-size:28px}.mn{font-size:14px}.mc{min-height:140px}.mt{padding:14px}}
@media(min-width:420px){.mp-n{font-size:40px}.md-n{font-size:40px}.ht{font-size:34px}}`;

  const body = `
<div class="h">
  <div class="deco"></div>
  <p class="hs">${esc(d.storeName)}</p>
  <h1 class="ht">${esc(d.title)}</h1>
  ${d.period ? `<p class="hp"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>${esc(d.period)}</p>` : ''}
</div>
<nav class="nav"><div class="ni">${catTabs}</div></nav>
<div class="w">${sections}</div>
<div class="ft">hanjul-flyer.kr</div>`;

  return htmlWrap(d.title || d.storeName, css, body, STICKY_TAB_SCRIPT);
}

// ============================================================
// ★ 엔진 3: EDITORIAL — 풀블리드 이미지 + 오버레이 가격
// ============================================================

function renderEditorialEngine(d: FlyerRenderData, t: Theme): string {
  const catTabs = renderCatTabs(d);
  let sections = '';
  for (let ci = 0; ci < d.categories.length; ci++) {
    const cat = d.categories[ci];
    const items = cat.items || [];
    let cards = '';
    for (let ii = 0; ii < items.length; ii++) {
      const item = items[ii];
      const img = resolveImg(item.name || '', 480, item.imageUrl);
      const disc = calcDisc(item.originalPrice, item.salePrice);
      const hasOrig = item.originalPrice && item.originalPrice > item.salePrice;
      // 첫 상품 = 풀블리드 대형, 나머지 = 2열
      const isFeatured = ii === 0;

      if (isFeatured) {
        cards += `<div class="ef">
          <div class="ef-img">${img}</div>
          <div class="ef-ov">
            ${disc > 0 ? `<span class="ef-dc">${disc}% OFF</span>` : ''}
            <p class="ef-nm">${esc(item.name || '')}</p>
            ${renderMetaChips(item, 'rgba(255,255,255,.15)', '#fff')}
            ${hasOrig ? `<p class="ef-og">정가 ${fmtPrice(item.originalPrice)}원</p>` : ''}
            <div class="ef-pr"><span class="ef-pn">${fmtPrice(item.salePrice || 0)}</span><span class="ef-pw">원</span></div>
            ${renderCardDiscount(item, '#4ade80')}
            ${renderAiCopy(item, 'rgba(255,255,255,.7)')}
          </div>
        </div>`;
      } else {
        const tagType = item.badge && /특가|할인|초특가|한정/.test(item.badge) ? 'red' : item.badge && /인기|추천|프리미엄|신선/.test(item.badge) ? 'blue' : 'gold';
        cards += `<div class="ec">
          <div class="ec-img">${disc > 0 ? `<span class="ec-bd">${disc}%</span>` : ''}${img}</div>
          <div class="ec-bd2">
            <p class="ec-nm">${esc(item.name || '')}</p>
            ${renderMetaChips(item, t.chipBg, t.chipColor)}
            ${hasOrig ? `<p class="ec-og">${fmtPrice(item.originalPrice)}원</p>` : ''}
            <div class="ec-pr"><span class="ec-pn">${fmtPrice(item.salePrice || 0)}</span><span class="ec-pw">원</span></div>
            ${renderCardDiscount(item, t.cardDiscountColor)}
            ${renderAiCopy(item, t.textSub)}
            ${item.badge ? `<span class="tg ${tagType}">${esc(item.badge)}</span>` : ''}
          </div>
        </div>`;
      }
    }
    sections += `<section class="sc" id="s${ci}">
      <div class="sh">
        <span class="sl">${String(ci + 1).padStart(2, '0')}</span>
        <span class="sn">${esc(cat.name || '')}</span>
        <span class="sd"></span>
      </div>
      ${cards}
    </section>`;
  }

  const css = `
body{font-family:'Noto Sans KR',sans-serif;background:${t.bg};color:${t.textColor};-webkit-font-smoothing:antialiased;line-height:1.5}

/* ═══ HERO — Minimal Masthead ═══ */
.h{background:${t.heroGradient};padding:48px 28px 44px;position:relative;overflow:hidden}
.h::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:rgba(255,255,255,.1)}
.hs{font-size:11px;font-weight:600;color:rgba(255,255,255,.5);letter-spacing:6px;text-transform:uppercase;margin-bottom:12px}
.ht{font-family:'Noto Sans KR',sans-serif;font-size:34px;font-weight:900;color:#fff;line-height:1.15;letter-spacing:-1px}
.hp{margin-top:16px;font-size:12px;font-weight:500;color:rgba(255,255,255,.55);display:flex;align-items:center;gap:6px}

/* ═══ CATEGORY TABS — Minimal ═══ */
.nav{position:-webkit-sticky;position:sticky;top:0;z-index:100;background:rgba(255,255,255,.98);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid ${t.borderColor}}
.ni{display:flex;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:0 20px;gap:0}
.ni::-webkit-scrollbar{display:none}
.ct{flex-shrink:0;padding:14px 14px;font-size:12px;font-weight:600;color:${t.textMuted};white-space:nowrap;text-decoration:none;border-bottom:2px solid transparent;transition:all .2s ease;letter-spacing:.5px}
.ct.on{color:${t.textColor};border-bottom-color:${t.textColor}}

.w{padding:0 0 32px}

/* ═══ SECTION HEADER — Editorial Line ═══ */
.sc{padding-top:0}
.sh{display:flex;align-items:center;gap:12px;padding:24px 20px 16px}
.sl{font-size:12px;font-weight:800;color:${t.priceColor};letter-spacing:1px}
.sn{font-size:20px;font-weight:900;color:${t.textColor};letter-spacing:-.5px}
.sd{flex:1;height:1px;background:${t.borderColor};margin-left:8px}

/* ═══ FEATURED CARD — Full Bleed ═══ */
.ef{position:relative;margin:0 0 14px;overflow:hidden}
.ef-img{height:280px;overflow:hidden}
.ef-img .product-img{width:100%;height:100%;object-fit:cover;display:block}
.ef-img .emoji-area{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:80px;background:${t.emojiBg}}
.ef-ov{position:absolute;bottom:0;left:0;right:0;padding:24px 20px;background:linear-gradient(to top,rgba(0,0,0,.85) 0%,rgba(0,0,0,.4) 60%,transparent 100%);z-index:2}
.ef-dc{display:inline-block;background:${t.badgeGradient};color:#fff;font-size:12px;font-weight:800;padding:4px 12px;border-radius:8px;margin-bottom:8px;box-shadow:0 2px 8px ${t.badgeShadow}}
.ef-nm{font-size:20px;font-weight:800;color:#fff;line-height:1.3;margin-bottom:2px}
.ef-og{font-size:12px;color:rgba(255,255,255,.5);text-decoration:line-through;margin-top:6px}
.ef-pr{display:flex;align-items:baseline;gap:2px;margin-top:4px}
.ef-pn{font-size:38px;font-weight:900;color:#fff;letter-spacing:-2px;text-shadow:0 2px 12px rgba(0,0,0,.3)}
.ef-pw{font-size:16px;font-weight:700;color:rgba(255,255,255,.8);margin-left:2px}

/* ═══ REGULAR CARDS — 2 Column ═══ */
.ec-wrap{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 16px}
.ec{background:${t.cardBg};border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06),0 4px 12px rgba(0,0,0,.03);margin:0 16px 10px}
.ec-img{position:relative;width:100%;aspect-ratio:16/10;overflow:hidden;background:${t.isDark ? t.cardBg : '#f9fafb'}}
.ec-img .product-img{width:100%;height:100%;object-fit:cover;display:block}
.ec-img .emoji-area{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px;background:${t.emojiBg}}
.ec-bd{position:absolute;top:8px;left:8px;z-index:2;background:${t.badgeGradient};color:#fff;font-size:12px;font-weight:900;padding:4px 10px;border-radius:8px;box-shadow:0 2px 8px ${t.badgeShadow}}
.ec-bd2{padding:14px 16px 16px}
.ec-nm{font-size:16px;font-weight:800;color:${t.textColor};line-height:1.35;margin-bottom:2px}
.ec-og{font-size:12px;color:${t.textMuted};text-decoration:line-through;margin-top:6px}
.ec-pr{display:flex;align-items:baseline;gap:2px;margin-top:4px}
.ec-pn{font-size:30px;font-weight:900;color:${t.priceColor};letter-spacing:-1.5px}
.ec-pw{font-size:13px;font-weight:700;color:${t.priceColor};opacity:.7;margin-left:2px}

.tg{display:inline-flex;margin-top:8px;padding:4px 10px;font-size:10px;font-weight:800;border-radius:8px;line-height:1.2}
.tg.red{background:#fef2f2;color:${t.tagColors.red};border:1px solid #fecaca}
.tg.gold{background:#fffbeb;color:${t.tagColors.gold};border:1px solid #fde68a}
.tg.blue{background:#eff6ff;color:${t.tagColors.blue};border:1px solid #bfdbfe}

.ft{text-align:center;padding:32px 16px 40px;color:${t.textMuted};font-size:10px;font-weight:500;letter-spacing:2px}
@media(max-width:360px){.ht{font-size:26px}.ef-pn{font-size:30px}.ef-img{height:220px}.ec-pn{font-size:24px}}
@media(min-width:420px){.ht{font-size:36px}.ef-pn{font-size:42px}.ec-pn{font-size:34px}}`;

  const body = `
<div class="h">
  <p class="hs">${esc(d.storeName)}</p>
  <h1 class="ht">${esc(d.title)}</h1>
  ${d.period ? `<p class="hp"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>${esc(d.period)}</p>` : ''}
</div>
<nav class="nav"><div class="ni">${catTabs}</div></nav>
<div class="w">${sections}</div>
<div class="ft">hanjul-flyer.kr</div>`;

  return htmlWrap(d.title || d.storeName, css, body, STICKY_TAB_SCRIPT);
}

// ============================================================
// ★ 엔진 4: SHOWCASE — 대형 싱글 카드 쇼케이스
// ============================================================

function renderShowcaseEngine(d: FlyerRenderData, t: Theme): string {
  const catTabs = renderCatTabs(d);
  let sections = '';
  for (let ci = 0; ci < d.categories.length; ci++) {
    const cat = d.categories[ci];
    const items = cat.items || [];
    let cards = '';
    for (const item of items) {
      const img = resolveImg(item.name || '', 400, item.imageUrl);
      const disc = calcDisc(item.originalPrice, item.salePrice);
      const hasOrig = item.originalPrice && item.originalPrice > item.salePrice;
      const tagType = item.badge && /특가|할인|초특가|한정/.test(item.badge) ? 'red' : item.badge && /인기|추천|프리미엄|신선/.test(item.badge) ? 'blue' : 'gold';

      cards += `<div class="sc-card">
        <div class="sc-top">
          <div class="sc-img">${img}</div>
          ${disc > 0 ? `<div class="sc-disc"><span class="sc-dn">${disc}</span><span class="sc-dp">%<br>할인</span></div>` : ''}
        </div>
        <div class="sc-info">
          <div class="sc-row1">
            <p class="sc-nm">${esc(item.name || '')}</p>
            ${item.badge ? `<span class="tg ${tagType}">${esc(item.badge)}</span>` : ''}
          </div>
          ${renderMetaChips(item, t.chipBg, t.chipColor)}
          <div class="sc-row2">
            <div class="sc-prices">
              ${hasOrig ? `<p class="sc-og">${fmtPrice(item.originalPrice)}원</p>` : ''}
              <div class="sc-pr"><span class="sc-pn">${fmtPrice(item.salePrice || 0)}</span><span class="sc-pw">원</span></div>
            </div>
            ${hasOrig ? `<div class="sc-save">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
              <span>${fmtPrice(item.originalPrice - item.salePrice)}원 절약</span>
            </div>` : ''}
          </div>
          ${renderCardDiscount(item, t.cardDiscountColor)}
          ${renderAiCopy(item, t.textSub)}
        </div>
      </div>`;
    }
    sections += `<section class="sc" id="s${ci}">
      <div class="sh">
        <div class="si">${esc(cat.name || '').charAt(0)}</div>
        <div class="st"><span class="sn">${esc(cat.name || '')}</span><span class="sk">${items.length}개 상품</span></div>
      </div>
      ${cards}
    </section>`;
  }

  const darkMod = t.isDark ? `.sc-card{border:1px solid ${t.borderColor}}` : '';

  const css = `
body{font-family:'Noto Sans KR',sans-serif;background:${t.bg};color:${t.textColor};-webkit-font-smoothing:antialiased;line-height:1.5}

/* ═══ HERO — Bold Centered ═══ */
.h{position:relative;background:${t.heroGradient};padding:60px 28px 70px;text-align:center;overflow:hidden}
.h::before{content:'';position:absolute;inset:0;background:${t.heroPattern || 'none'};pointer-events:none;z-index:1}
.h .ring1{position:absolute;top:50%;left:50%;width:300px;height:300px;border:1.5px solid ${t.heroAccent || 'transparent'};border-radius:50%;transform:translate(-50%,-50%);z-index:1}
.h .ring2{position:absolute;top:50%;left:50%;width:200px;height:200px;border:1px solid ${t.heroAccent || 'transparent'};border-radius:50%;transform:translate(-50%,-50%);z-index:1}
.hs{font-size:13px;font-weight:700;color:rgba(255,255,255,.7);letter-spacing:5px;text-transform:uppercase;position:relative;z-index:2;margin-bottom:14px}
.ht{font-family:'Noto Sans KR',sans-serif;font-size:34px;font-weight:900;color:#fff;line-height:1.15;text-shadow:0 4px 20px rgba(0,0,0,.3);position:relative;z-index:2}
.hp{margin-top:20px;display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.12);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.15);border-radius:24px;padding:8px 20px;font-size:12px;font-weight:600;color:rgba(255,255,255,.9);position:relative;z-index:2}
.hw{position:absolute;bottom:0;left:0;right:0;height:32px;background:${t.bg};border-radius:32px 32px 0 0;z-index:3}

/* ═══ CATEGORY TABS — Pill ═══ */
.nav{position:-webkit-sticky;position:sticky;top:0;z-index:100;background:${t.isDark ? 'rgba(10,10,10,.96)' : 'rgba(255,255,255,.96)'};backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 1px 0 ${t.borderColor}}
.ni{display:flex;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:10px 12px;gap:6px}
.ni::-webkit-scrollbar{display:none}
.ct{flex-shrink:0;padding:8px 16px;font-size:13px;font-weight:700;color:${t.textMuted};white-space:nowrap;text-decoration:none;border-radius:20px;transition:all .2s ease}
.ct.on{color:#fff;background:${t.tabActiveColor};box-shadow:0 2px 8px ${t.badgeShadow}}

.w{padding:8px 16px 32px}

/* ═══ SECTION HEADER ═══ */
.sc{padding-top:28px}.sc:first-child{padding-top:16px}
.sh{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.si{width:44px;height:44px;border-radius:14px;background:${t.catIconGradient};display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:900;flex-shrink:0;box-shadow:0 4px 14px ${t.badgeShadow}}
.st{display:flex;flex-direction:column;gap:2px}
.sn{font-size:20px;font-weight:900;color:${t.textColor};letter-spacing:-.5px}
.sk{font-size:11px;font-weight:600;color:${t.textMuted}}

/* ═══ SHOWCASE CARD — Single Column Hero ═══ */
.sc-card{background:${t.cardBg};border-radius:24px;overflow:hidden;margin-bottom:16px;box-shadow:0 2px 4px rgba(0,0,0,.04),0 8px 28px rgba(0,0,0,.06)}
${darkMod}
.sc-top{position:relative;width:100%;aspect-ratio:4/3;overflow:hidden;background:${t.isDark ? t.cardBg : '#f9fafb'}}
.sc-top .product-img{width:100%;height:100%;object-fit:cover;display:block}
.sc-top .emoji-area{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:80px;background:${t.emojiBg}}
.sc-disc{position:absolute;top:16px;right:16px;width:64px;height:64px;border-radius:50%;background:${t.badgeGradient};box-shadow:0 4px 16px ${t.badgeShadow};display:flex;align-items:center;justify-content:center;gap:1px}
.sc-dn{font-size:26px;font-weight:900;color:#fff;letter-spacing:-1px;line-height:1}
.sc-dp{font-size:9px;font-weight:800;color:rgba(255,255,255,.85);line-height:1.15;text-align:center}

.sc-info{padding:20px 20px 24px}
.sc-row1{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.sc-nm{font-size:20px;font-weight:800;color:${t.textColor};line-height:1.35;letter-spacing:-.3px;flex:1}
.sc-row2{display:flex;align-items:flex-end;justify-content:space-between;margin-top:10px}
.sc-prices{display:flex;flex-direction:column;gap:2px}
.sc-og{font-size:13px;color:${t.textMuted};text-decoration:line-through}
.sc-pr{display:flex;align-items:baseline;gap:2px;line-height:1}
.sc-pn{font-size:38px;font-weight:900;color:${t.priceColor};letter-spacing:-2px}
.sc-pw{font-size:15px;font-weight:700;color:${t.priceColor};opacity:.7;margin-left:2px}
.sc-save{display:flex;align-items:center;gap:3px;background:${t.isDark ? 'rgba(74,222,128,.1)' : '#f0fdf4'};color:#16a34a;font-size:12px;font-weight:700;padding:6px 12px;border-radius:10px;border:1px solid ${t.isDark ? 'rgba(74,222,128,.2)' : '#bbf7d0'};white-space:nowrap}

.tg{display:inline-flex;padding:5px 12px;font-size:11px;font-weight:800;border-radius:8px;line-height:1.2;flex-shrink:0}
.tg.red{background:${t.isDark ? 'rgba(239,68,68,.1)' : '#fef2f2'};color:${t.tagColors.red};border:1px solid ${t.isDark ? 'rgba(239,68,68,.2)' : '#fecaca'}}
.tg.gold{background:${t.isDark ? 'rgba(212,168,68,.1)' : '#fffbeb'};color:${t.tagColors.gold};border:1px solid ${t.isDark ? 'rgba(212,168,68,.2)' : '#fde68a'}}
.tg.blue{background:${t.isDark ? 'rgba(96,165,250,.1)' : '#eff6ff'};color:${t.tagColors.blue};border:1px solid ${t.isDark ? 'rgba(96,165,250,.2)' : '#bfdbfe'}}

.ft{text-align:center;padding:32px 16px 40px;color:${t.textMuted};font-size:10px;font-weight:500;letter-spacing:2px}
@media(max-width:360px){.ht{font-size:26px}.sc-pn{font-size:30px}.sc-nm{font-size:17px}.sc-disc{width:52px;height:52px}.sc-dn{font-size:20px}}
@media(min-width:420px){.ht{font-size:36px}.sc-pn{font-size:42px}}`;

  const body = `
<div class="h">
  <span class="ring1"></span><span class="ring2"></span>
  <p class="hs">${esc(d.storeName)}</p>
  <h1 class="ht">${esc(d.title)}</h1>
  ${d.period ? `<div class="hp"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>${esc(d.period)}</div>` : ''}
  <div class="hw"></div>
</div>
<nav class="nav"><div class="ni">${catTabs}</div></nav>
<div class="w">${sections}</div>
<div class="ft">hanjul-flyer.kr</div>`;

  return htmlWrap(d.title || d.storeName, css, body, STICKY_TAB_SCRIPT);
}

// ============================================================
// 엔진 5: COMPACT — 3열 소형 카드 (촘촘한 가격 나열)
// ============================================================

function renderCompactEngine(d: FlyerRenderData, t: Theme): string {
  const catTabs = renderCatTabs(d);
  let sections = '';
  for (let ci = 0; ci < d.categories.length; ci++) {
    const cat = d.categories[ci];
    let cards = '';
    for (const item of (cat.items || [])) {
      const img = resolveImg(item.name || '', 120, item.imageUrl);
      const disc = calcDisc(item.originalPrice, item.salePrice);
      const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
      cards += `<div class="cc">
        <div class="cc-img">${disc > 0 ? `<span class="cc-bd">${disc}%</span>` : ''}${img}</div>
        <p class="cc-nm">${esc(item.name || '')}</p>
        ${hasOrig ? `<p class="cc-og">${fmtPrice(item.originalPrice)}원</p>` : ''}
        <p class="cc-pr"><span class="cc-pn">${fmtPrice(item.salePrice || 0)}</span><span class="cc-pw">원</span></p>
        ${renderAiCopy(item, t.textSub)}
      </div>`;
    }
    sections += `<section class="sc" id="s${ci}">
      <div class="sh"><span class="si" style="background:${t.catIconGradient}"></span><span class="sn" style="color:${t.textColor}">${esc(cat.name)}</span></div>
      <div class="cg">${cards}</div>
    </section>`;
  }
  const css = `
.h{background:${t.heroGradient};${t.heroPattern ? `background-image:${t.heroPattern},${t.heroGradient};` : ''}color:#fff;padding:28px 20px 20px;text-align:center;position:relative;overflow:hidden}
.hs{font-size:11px;opacity:.7;letter-spacing:2px;margin-bottom:6px}.ht{font-size:22px;font-weight:800;line-height:1.3}.hp{font-size:12px;opacity:.8;margin-top:8px;display:inline-flex;align-items:center;gap:4px}
.nav{background:${t.cardBg};position:sticky;top:0;z-index:10;border-bottom:1px solid ${t.borderColor};box-shadow:0 1px 4px rgba(0,0,0,.05)}
.ni{display:flex;overflow-x:auto;gap:0;scrollbar-width:none;-webkit-overflow-scrolling:touch}.ni::-webkit-scrollbar{display:none}
.ct{flex-shrink:0;padding:10px 16px;font-size:12px;font-weight:600;color:${t.textMuted};border-bottom:2px solid transparent;white-space:nowrap;text-decoration:none}
.ct.on{color:${t.tabActiveColor};border-bottom-color:${t.tabActiveColor}}
.w{padding:12px 10px;background:${t.bg}}
.sh{display:flex;align-items:center;gap:8px;padding:12px 4px 8px}.si{width:4px;height:18px;border-radius:2px;flex-shrink:0}.sn{font-size:14px;font-weight:700}
.cg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.cc{background:${t.cardBg};border-radius:10px;padding:8px;border:1px solid ${t.borderColor};text-align:center}
.cc-img{position:relative;aspect-ratio:1/1;overflow:hidden;border-radius:8px;margin-bottom:6px;background:${t.emojiBg}}
.cc-img img,.cc-img span{width:100%;height:100%;object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:32px}
.cc-bd{position:absolute;top:4px;left:4px;font-size:10px;font-weight:800;color:#fff;background:${t.badgeGradient};padding:2px 6px;border-radius:6px;z-index:1}
.cc-nm{font-size:11px;font-weight:600;color:${t.textColor};line-height:1.3;margin-bottom:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.cc-og{font-size:10px;color:${t.textMuted};text-decoration:line-through}
.cc-pr{margin-top:2px}.cc-pn{font-size:16px;font-weight:900;color:${t.priceColor}}.cc-pw{font-size:10px;font-weight:600;color:${t.priceColor};margin-left:1px}
.ft{text-align:center;padding:20px;font-size:11px;color:${t.textMuted}}
`;
  const body = `<div class="h"><p class="hs">${esc(d.storeName)}</p><h1 class="ht">${esc(d.title)}</h1>
  ${d.period ? `<div class="hp"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>${esc(d.period)}</div>` : ''}</div>
<nav class="nav"><div class="ni">${catTabs}</div></nav>
<div class="w">${sections}</div>
<div class="ft">hanjul-flyer.kr</div>`;
  return htmlWrap(d.title || d.storeName, css, body, STICKY_TAB_SCRIPT);
}

// ============================================================
// 엔진 6: HERO BANNER — 상위 3개 대형 배너 + 나머지 컴팩트 리스트
// ============================================================

function renderHeroBannerEngine(d: FlyerRenderData, t: Theme): string {
  const catTabs = renderCatTabs(d);
  let sections = '';
  for (let ci = 0; ci < d.categories.length; ci++) {
    const cat = d.categories[ci];
    const items = cat.items || [];
    let cards = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const img = resolveImg(item.name || '', i < 3 ? 320 : 100, item.imageUrl);
      const disc = calcDisc(item.originalPrice, item.salePrice);
      const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
      if (i < 3) {
        // 상위 3개: 대형 배너
        cards += `<div class="hb-hero">
          <div class="hb-img">${disc > 0 ? `<span class="hb-disc">${disc}%</span>` : ''}${img}</div>
          <div class="hb-info">
            <p class="hb-nm">${esc(item.name || '')}</p>
            ${renderMetaChips(item, t.chipBg, t.chipColor)}
            ${hasOrig ? `<p class="hb-og">${fmtPrice(item.originalPrice)}원</p>` : ''}
            <div class="hb-pr"><span class="hb-pn">${fmtPrice(item.salePrice || 0)}</span><span class="hb-pw">원</span></div>
            ${renderCardDiscount(item, t.cardDiscountColor)}
            ${renderAiCopy(item, t.textSub)}
          </div>
        </div>`;
      } else {
        // 나머지: 가로 리스트 (이미지 좌 + 정보 우)
        cards += `<div class="hb-row">
          <div class="hb-thumb">${img}</div>
          <div class="hb-detail">
            <p class="hb-rnm">${esc(item.name || '')}</p>
            ${hasOrig ? `<span class="hb-rog">${fmtPrice(item.originalPrice)}원</span>` : ''}
            <span class="hb-rpn">${fmtPrice(item.salePrice || 0)}원</span>
            ${disc > 0 ? `<span class="hb-rtag">${disc}%</span>` : ''}
          </div>
        </div>`;
      }
    }
    sections += `<section class="sc" id="s${ci}">
      <div class="sh"><span class="si" style="background:${t.catIconGradient}"></span><span class="sn" style="color:${t.textColor}">${esc(cat.name)}</span></div>
      ${cards}
    </section>`;
  }
  const css = `
.h{background:${t.heroGradient};${t.heroPattern ? `background-image:${t.heroPattern},${t.heroGradient};` : ''}color:#fff;padding:28px 20px 20px;text-align:center;position:relative;overflow:hidden}
.hs{font-size:11px;opacity:.7;letter-spacing:2px;margin-bottom:6px}.ht{font-size:22px;font-weight:800;line-height:1.3}.hp{font-size:12px;opacity:.8;margin-top:8px;display:inline-flex;align-items:center;gap:4px}
.nav{background:${t.cardBg};position:sticky;top:0;z-index:10;border-bottom:1px solid ${t.borderColor}}
.ni{display:flex;overflow-x:auto;gap:0;scrollbar-width:none}.ni::-webkit-scrollbar{display:none}
.ct{flex-shrink:0;padding:10px 16px;font-size:12px;font-weight:600;color:${t.textMuted};border-bottom:2px solid transparent;white-space:nowrap;text-decoration:none}
.ct.on{color:${t.tabActiveColor};border-bottom-color:${t.tabActiveColor}}
.w{padding:12px;background:${t.bg}}
.sh{display:flex;align-items:center;gap:8px;padding:12px 4px 8px}.si{width:4px;height:18px;border-radius:2px;flex-shrink:0}.sn{font-size:14px;font-weight:700}
.hb-hero{background:${t.cardBg};border-radius:14px;overflow:hidden;margin-bottom:10px;border:1px solid ${t.borderColor}}
.hb-img{position:relative;aspect-ratio:16/9;overflow:hidden;background:${t.emojiBg}}
.hb-img img,.hb-img span{width:100%;height:100%;object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:48px}
.hb-disc{position:absolute;top:10px;right:10px;font-size:18px;font-weight:900;color:#fff;background:${t.badgeGradient};padding:6px 14px;border-radius:20px;box-shadow:0 2px 8px ${t.badgeShadow};z-index:1}
.hb-info{padding:12px 14px}
.hb-nm{font-size:16px;font-weight:700;color:${t.textColor};margin-bottom:4px}
.hb-og{font-size:12px;color:${t.textMuted};text-decoration:line-through;margin-top:4px}
.hb-pr{margin-top:2px}.hb-pn{font-size:28px;font-weight:900;color:${t.priceColor}}.hb-pw{font-size:14px;font-weight:700;color:${t.priceColor};margin-left:2px}
.hb-row{display:flex;gap:12px;align-items:center;padding:10px;background:${t.cardBg};border-radius:10px;margin-bottom:6px;border:1px solid ${t.borderColor}}
.hb-thumb{width:64px;height:64px;border-radius:8px;overflow:hidden;flex-shrink:0;background:${t.emojiBg}}
.hb-thumb img,.hb-thumb span{width:100%;height:100%;object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:28px}
.hb-detail{flex:1;min-width:0}
.hb-rnm{font-size:13px;font-weight:600;color:${t.textColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hb-rog{font-size:11px;color:${t.textMuted};text-decoration:line-through;margin-right:6px}
.hb-rpn{font-size:16px;font-weight:800;color:${t.priceColor}}
.hb-rtag{font-size:11px;font-weight:700;color:#fff;background:${t.badgeGradient};padding:2px 6px;border-radius:4px;margin-left:6px}
.ft{text-align:center;padding:20px;font-size:11px;color:${t.textMuted}}
`;
  const body = `<div class="h"><p class="hs">${esc(d.storeName)}</p><h1 class="ht">${esc(d.title)}</h1>
  ${d.period ? `<div class="hp"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>${esc(d.period)}</div>` : ''}</div>
<nav class="nav"><div class="ni">${catTabs}</div></nav>
<div class="w">${sections}</div>
<div class="ft">hanjul-flyer.kr</div>`;
  return htmlWrap(d.title || d.storeName, css, body, STICKY_TAB_SCRIPT);
}

// ============================================================
// 엔진 7: SWIPE — 카테고리별 가로 스크롤 카드
// ============================================================

function renderSwipeEngine(d: FlyerRenderData, t: Theme): string {
  const catTabs = renderCatTabs(d);
  let sections = '';
  for (let ci = 0; ci < d.categories.length; ci++) {
    const cat = d.categories[ci];
    let cards = '';
    for (const item of (cat.items || [])) {
      const img = resolveImg(item.name || '', 200, item.imageUrl);
      const disc = calcDisc(item.originalPrice, item.salePrice);
      const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
      cards += `<div class="sw-card">
        <div class="sw-img">${disc > 0 ? `<span class="sw-bd">${disc}%</span>` : ''}${img}</div>
        <div class="sw-body">
          <p class="sw-nm">${esc(item.name || '')}</p>
          ${hasOrig ? `<p class="sw-og">${fmtPrice(item.originalPrice)}원</p>` : ''}
          <p class="sw-pr"><span class="sw-pn">${fmtPrice(item.salePrice || 0)}</span><span class="sw-pw">원</span></p>
          ${renderAiCopy(item, t.textSub)}
        </div>
      </div>`;
    }
    sections += `<section class="sc" id="s${ci}">
      <div class="sh"><span class="si" style="background:${t.catIconGradient}"></span><span class="sn" style="color:${t.textColor}">${esc(cat.name)}</span></div>
      <div class="sw-track">${cards}</div>
    </section>`;
  }
  const css = `
.h{background:${t.heroGradient};${t.heroPattern ? `background-image:${t.heroPattern},${t.heroGradient};` : ''}color:#fff;padding:28px 20px 20px;text-align:center;position:relative;overflow:hidden}
.hs{font-size:11px;opacity:.7;letter-spacing:2px;margin-bottom:6px}.ht{font-size:22px;font-weight:800;line-height:1.3}.hp{font-size:12px;opacity:.8;margin-top:8px;display:inline-flex;align-items:center;gap:4px}
.nav{background:${t.cardBg};position:sticky;top:0;z-index:10;border-bottom:1px solid ${t.borderColor}}
.ni{display:flex;overflow-x:auto;gap:0;scrollbar-width:none}.ni::-webkit-scrollbar{display:none}
.ct{flex-shrink:0;padding:10px 16px;font-size:12px;font-weight:600;color:${t.textMuted};border-bottom:2px solid transparent;white-space:nowrap;text-decoration:none}
.ct.on{color:${t.tabActiveColor};border-bottom-color:${t.tabActiveColor}}
.w{padding:12px 0;background:${t.bg}}
.sh{display:flex;align-items:center;gap:8px;padding:12px 16px 8px}.si{width:4px;height:18px;border-radius:2px;flex-shrink:0}.sn{font-size:14px;font-weight:700}
.sw-track{display:flex;overflow-x:auto;gap:10px;padding:0 16px 12px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.sw-track::-webkit-scrollbar{display:none}
.sw-card{flex:0 0 160px;scroll-snap-align:start;background:${t.cardBg};border-radius:12px;overflow:hidden;border:1px solid ${t.borderColor}}
.sw-img{position:relative;aspect-ratio:1/1;overflow:hidden;background:${t.emojiBg}}
.sw-img img,.sw-img span{width:100%;height:100%;object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:40px}
.sw-bd{position:absolute;top:6px;left:6px;font-size:11px;font-weight:800;color:#fff;background:${t.badgeGradient};padding:3px 8px;border-radius:8px;z-index:1}
.sw-body{padding:10px}
.sw-nm{font-size:12px;font-weight:600;color:${t.textColor};line-height:1.3;margin-bottom:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.sw-og{font-size:10px;color:${t.textMuted};text-decoration:line-through}
.sw-pr{margin-top:2px}.sw-pn{font-size:20px;font-weight:900;color:${t.priceColor}}.sw-pw{font-size:11px;font-weight:600;color:${t.priceColor};margin-left:1px}
.ft{text-align:center;padding:20px;font-size:11px;color:${t.textMuted}}
`;
  const body = `<div class="h"><p class="hs">${esc(d.storeName)}</p><h1 class="ht">${esc(d.title)}</h1>
  ${d.period ? `<div class="hp"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>${esc(d.period)}</div>` : ''}</div>
<nav class="nav"><div class="ni">${catTabs}</div></nav>
<div class="w">${sections}</div>
<div class="ft">hanjul-flyer.kr</div>`;
  return htmlWrap(d.title || d.storeName, css, body, STICKY_TAB_SCRIPT);
}

// ============================================================
// 엔진 8: MOSAIC — 대형+소형 타일 교차 배치
// ============================================================

function renderMosaicEngine(d: FlyerRenderData, t: Theme): string {
  const catTabs = renderCatTabs(d);
  let sections = '';
  for (let ci = 0; ci < d.categories.length; ci++) {
    const cat = d.categories[ci];
    const items = cat.items || [];
    let cards = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const disc = calcDisc(item.originalPrice, item.salePrice);
      const hasOrig = item.originalPrice > 0 && item.originalPrice !== item.salePrice;
      // 패턴: 0=대형(2열), 1,2=소형(1열씩), 3=대형, 4,5=소형, ...
      const isLarge = i % 3 === 0;
      const img = resolveImg(item.name || '', isLarge ? 320 : 180, item.imageUrl);
      if (isLarge) {
        cards += `<div class="ms-lg">
          <div class="ms-limg">${disc > 0 ? `<span class="ms-bd">${disc}%</span>` : ''}${img}</div>
          <div class="ms-lbody">
            <p class="ms-lnm">${esc(item.name || '')}</p>
            ${renderMetaChips(item, t.chipBg, t.chipColor)}
            ${hasOrig ? `<p class="ms-log">${fmtPrice(item.originalPrice)}원</p>` : ''}
            <div class="ms-lpr"><span class="ms-lpn">${fmtPrice(item.salePrice || 0)}</span><span class="ms-lpw">원</span></div>
            ${renderCardDiscount(item, t.cardDiscountColor)}
            ${renderAiCopy(item, t.textSub)}
            ${item.badge ? `<span class="ms-tag" style="background:${t.badgeGradient};color:#fff">${esc(item.badge)}</span>` : ''}
          </div>
        </div>`;
      } else {
        cards += `<div class="ms-sm">
          <div class="ms-simg">${disc > 0 ? `<span class="ms-sbd">${disc}%</span>` : ''}${img}</div>
          <p class="ms-snm">${esc(item.name || '')}</p>
          ${hasOrig ? `<p class="ms-sog">${fmtPrice(item.originalPrice)}원</p>` : ''}
          <p class="ms-spr"><span class="ms-spn">${fmtPrice(item.salePrice || 0)}</span><span class="ms-spw">원</span></p>
          ${renderAiCopy(item, t.textSub)}
        </div>`;
      }
    }
    sections += `<section class="sc" id="s${ci}">
      <div class="sh"><span class="si" style="background:${t.catIconGradient}"></span><span class="sn" style="color:${t.textColor}">${esc(cat.name)}</span></div>
      <div class="ms-grid">${cards}</div>
    </section>`;
  }
  const css = `
.h{background:${t.heroGradient};${t.heroPattern ? `background-image:${t.heroPattern},${t.heroGradient};` : ''}color:#fff;padding:28px 20px 20px;text-align:center;position:relative;overflow:hidden}
.hs{font-size:11px;opacity:.7;letter-spacing:2px;margin-bottom:6px}.ht{font-size:22px;font-weight:800;line-height:1.3}.hp{font-size:12px;opacity:.8;margin-top:8px;display:inline-flex;align-items:center;gap:4px}
.nav{background:${t.cardBg};position:sticky;top:0;z-index:10;border-bottom:1px solid ${t.borderColor}}
.ni{display:flex;overflow-x:auto;gap:0;scrollbar-width:none}.ni::-webkit-scrollbar{display:none}
.ct{flex-shrink:0;padding:10px 16px;font-size:12px;font-weight:600;color:${t.textMuted};border-bottom:2px solid transparent;white-space:nowrap;text-decoration:none}
.ct.on{color:${t.tabActiveColor};border-bottom-color:${t.tabActiveColor}}
.w{padding:12px;background:${t.bg}}
.sh{display:flex;align-items:center;gap:8px;padding:12px 4px 8px}.si{width:4px;height:18px;border-radius:2px;flex-shrink:0}.sn{font-size:14px;font-weight:700}
.ms-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ms-lg{grid-column:1/-1;background:${t.cardBg};border-radius:14px;overflow:hidden;border:1px solid ${t.borderColor};display:flex;gap:0}
.ms-limg{position:relative;width:45%;flex-shrink:0;aspect-ratio:1/1;overflow:hidden;background:${t.emojiBg}}
.ms-limg img,.ms-limg span{width:100%;height:100%;object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:48px}
.ms-bd{position:absolute;top:8px;left:8px;font-size:14px;font-weight:900;color:#fff;background:${t.badgeGradient};padding:4px 10px;border-radius:10px;z-index:1}
.ms-lbody{padding:14px;flex:1;display:flex;flex-direction:column;justify-content:center}
.ms-lnm{font-size:16px;font-weight:700;color:${t.textColor};line-height:1.3;margin-bottom:4px}
.ms-log{font-size:12px;color:${t.textMuted};text-decoration:line-through;margin-top:4px}
.ms-lpr{margin-top:4px}.ms-lpn{font-size:30px;font-weight:900;color:${t.priceColor}}.ms-lpw{font-size:14px;font-weight:700;color:${t.priceColor};margin-left:2px}
.ms-tag{display:inline-block;font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;margin-top:6px}
.ms-sm{background:${t.cardBg};border-radius:12px;padding:10px;border:1px solid ${t.borderColor};text-align:center}
.ms-simg{position:relative;aspect-ratio:1/0.85;overflow:hidden;border-radius:8px;margin-bottom:6px;background:${t.emojiBg}}
.ms-simg img,.ms-simg span{width:100%;height:100%;object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:36px}
.ms-sbd{position:absolute;top:4px;left:4px;font-size:10px;font-weight:800;color:#fff;background:${t.badgeGradient};padding:2px 6px;border-radius:6px;z-index:1}
.ms-snm{font-size:12px;font-weight:600;color:${t.textColor};line-height:1.3;margin-bottom:2px}
.ms-sog{font-size:10px;color:${t.textMuted};text-decoration:line-through}
.ms-spr{margin-top:2px}.ms-spn{font-size:20px;font-weight:900;color:${t.priceColor}}.ms-spw{font-size:10px;font-weight:600;color:${t.priceColor};margin-left:1px}
.ft{text-align:center;padding:20px;font-size:11px;color:${t.textMuted}}
`;
  const body = `<div class="h"><p class="hs">${esc(d.storeName)}</p><h1 class="ht">${esc(d.title)}</h1>
  ${d.period ? `<div class="hp"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>${esc(d.period)}</div>` : ''}</div>
<nav class="nav"><div class="ni">${catTabs}</div></nav>
<div class="w">${sections}</div>
<div class="ft">hanjul-flyer.kr</div>`;
  return htmlWrap(d.title || d.storeName, css, body, STICKY_TAB_SCRIPT);
}

// ============================================================
// 렌더러 맵 — 8개 엔진 × 다양한 테마 조합
// ============================================================

const RENDERERS: Record<string, (d: FlyerRenderData) => string> = {
  // ━━ 엔진 1: GRID — 2열 카드 그리드 ━━
  grid:             d => renderGridEngine(d, THEMES.grid),
  mart_fresh:       d => renderGridEngine(d, THEMES.mart_fresh),
  event_bogo:       d => renderGridEngine(d, THEMES.event_bogo),

  // ━━ 엔진 2: MAGAZINE — 1열 매거진형 ━━
  magazine:         d => renderMagazineEngine(d, THEMES.magazine),
  butcher_premium:  d => renderMagazineEngine(d, THEMES.butcher_premium),
  season_winter:    d => renderMagazineEngine(d, THEMES.season_winter),

  // ━━ 엔진 3: EDITORIAL — 풀블리드 에디토리얼 ━━
  editorial:        d => renderEditorialEngine(d, THEMES.editorial),
  season_chuseok:   d => renderEditorialEngine(d, THEMES.season_chuseok),
  event_grand_open: d => renderEditorialEngine(d, THEMES.event_grand_open),

  // ━━ 엔진 4: SHOWCASE — 대형 싱글 카드 ━━
  showcase:         d => renderShowcaseEngine(d, THEMES.showcase),
  highlight:        d => renderShowcaseEngine(d, THEMES.highlight),
  season_newyear:   d => renderShowcaseEngine(d, THEMES.season_newyear),

  // ━━ 엔진 5: COMPACT — 3열 소형 카드 ━━
  mart_clearance:   d => renderCompactEngine(d, THEMES.mart_clearance),
  mart_general:     d => renderCompactEngine(d, THEMES.mart_general),
  season_summer:    d => renderCompactEngine(d, THEMES.season_summer),

  // ━━ 엔진 6: HERO BANNER — 대형배너 + 리스트 ━━
  butcher_hanwoo:   d => renderHeroBannerEngine(d, THEMES.butcher_hanwoo),
  mart_seafood:     d => renderHeroBannerEngine(d, THEMES.mart_seafood),

  // ━━ 엔진 7: SWIPE — 가로 스크롤 ━━
  event_timesale:   d => renderSwipeEngine(d, THEMES.event_timesale),
  season_christmas: d => renderSwipeEngine(d, THEMES.season_christmas),

  // ━━ 엔진 8: MOSAIC — 대+소 타일 교차 ━━
  butcher_giftset:  d => renderMosaicEngine(d, THEMES.butcher_giftset),
  event_membership: d => renderMosaicEngine(d, THEMES.event_membership),
};

/**
 * ★ 단일 진입점. templateCode로 렌더러 선택. 미존재 시 grid 폴백.
 */
export function renderTemplate(templateCode: string, data: FlyerRenderData): string {
  const renderer = RENDERERS[templateCode];
  let html = renderer ? renderer(data) : renderGridEngine(data, THEMES.grid);

  // 다이나믹 섹션 (외부링크/공지/GIF) — 상품 뒤, QR 앞에 삽입
  const dynHtml = renderDynamicSection(data);
  if (dynHtml) {
    html = html.replace('</body>', dynHtml + '</body>');
  }

  if (data.qrCodeDataUrl) {
    html = html.replace('</body>', renderQrSection(data) + '</body>');
  }

  return html;
}

// 하위호환 export
export { esc as escapeHtml, fmtPrice as formatPrice };
