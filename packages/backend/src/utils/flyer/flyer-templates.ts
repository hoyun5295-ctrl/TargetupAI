/**
 * ★ CT-F14 — 전단AI 템플릿 렌더링 엔진 V2
 *
 * 전단지 공개 페이지 HTML 렌더링의 유일한 진입점.
 * short-urls.ts에서 호출: renderTemplate(templateCode, data)
 *
 * V2 아키텍처: 공통 프리미엄 베이스 엔진 + 테마별 색상/스타일만 교체.
 * - 모든 템플릿: 대형 가격(24~28px + "원" 분리), 스티키 카테고리 탭, 프리미엄 카드
 * - 10종 테마: grid, list, highlight, mart_fresh/weekend/seasonal/clearance, butcher_premium/daily/bulk
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
  qrCodeDataUrl?: string;
  qrCouponText?: string;
}

export interface FlyerRenderItem {
  name: string;
  originalPrice: number;
  salePrice: number;
  badge?: string;
  imageUrl?: string;
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

// ============================================================
// 테마 정의
// ============================================================

interface Theme {
  name: string;
  bg: string;
  cardBg: string;
  textColor: string;
  textSub: string;
  textMuted: string;
  heroGradient: string;
  heroPattern?: string;         // 추가 배경 패턴
  priceColor: string;
  badgeGradient: string;
  badgeShadow: string;
  catIconGradient: string;
  tabActiveColor: string;
  tagColors: { red: string; gold: string; blue: string };
  emojiBg: string;
  isDark?: boolean;
  heroAccent?: string;          // 히어로 장식 색상
  borderColor: string;
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
  },
  list: {
    name: '리스트형', bg: '#f0f4f8', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#64748b', textMuted: '#94a3b8',
    heroGradient: 'linear-gradient(145deg,#1e40af 0%,#1d4ed8 40%,#1e3a8a 100%)',
    heroPattern: 'radial-gradient(circle at 80% 80%,rgba(59,130,246,.3) 0%,transparent 50%)',
    priceColor: '#1d4ed8', badgeGradient: 'linear-gradient(135deg,#2563eb,#1d4ed8)', badgeShadow: 'rgba(37,99,235,.35)',
    catIconGradient: 'linear-gradient(135deg,#2563eb,#1d4ed8)', tabActiveColor: '#1d4ed8',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#1d4ed8' }, emojiBg: 'linear-gradient(145deg,#eff6ff,#dbeafe)',
    heroAccent: 'rgba(96,165,250,.2)', borderColor: '#e2e8f0',
  },
  highlight: {
    name: '특가 하이라이트', bg: '#0a0a0a', cardBg: '#1a1a1a', textColor: '#f5f5f5', textSub: '#a3a3a3', textMuted: '#737373',
    heroGradient: 'linear-gradient(145deg,#1a1a2e 0%,#0f0f0f 50%,#1a1a1a 100%)',
    heroPattern: 'radial-gradient(circle at 50% 50%,rgba(212,168,68,.15) 0%,transparent 60%)',
    priceColor: '#d4a844', badgeGradient: 'linear-gradient(135deg,#d4a844,#b8860b)', badgeShadow: 'rgba(212,168,68,.35)',
    catIconGradient: 'linear-gradient(135deg,#d4a844,#b8860b)', tabActiveColor: '#d4a844',
    tagColors: { red: '#ef4444', gold: '#d4a844', blue: '#60a5fa' }, emojiBg: 'linear-gradient(145deg,#1a1a2e,#2a2a3e)',
    isDark: true, heroAccent: 'rgba(212,168,68,.1)', borderColor: '#2a2a2a',
  },
  mart_fresh: {
    name: '신선식품 특화', bg: '#f0fdf4', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#4b5563', textMuted: '#9ca3af',
    heroGradient: 'linear-gradient(145deg,#16a34a 0%,#15803d 40%,#166534 100%)',
    heroPattern: 'radial-gradient(circle at 20% 70%,rgba(34,197,94,.25) 0%,transparent 50%)',
    priceColor: '#16a34a', badgeGradient: 'linear-gradient(135deg,#16a34a,#15803d)', badgeShadow: 'rgba(22,163,74,.35)',
    catIconGradient: 'linear-gradient(135deg,#16a34a,#22c55e)', tabActiveColor: '#16a34a',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#16a34a' }, emojiBg: 'linear-gradient(145deg,#f0fdf4,#dcfce7)',
    heroAccent: 'rgba(255,255,255,.1)', borderColor: '#d1fae5',
  },
  mart_weekend: {
    name: '주말특가', bg: '#fdf4ff', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#6b7280', textMuted: '#a78bfa',
    heroGradient: 'linear-gradient(145deg,#9333ea 0%,#7c3aed 40%,#6d28d9 100%)',
    heroPattern: 'radial-gradient(circle at 80% 30%,rgba(236,72,153,.3) 0%,transparent 50%)',
    priceColor: '#9333ea', badgeGradient: 'linear-gradient(135deg,#9333ea,#ec4899)', badgeShadow: 'rgba(147,51,234,.35)',
    catIconGradient: 'linear-gradient(135deg,#9333ea,#ec4899)', tabActiveColor: '#9333ea',
    tagColors: { red: '#ec4899', gold: '#b45309', blue: '#7c3aed' }, emojiBg: 'linear-gradient(145deg,#fdf4ff,#f5f3ff)',
    heroAccent: 'rgba(236,72,153,.15)', borderColor: '#e9d5ff',
  },
  mart_seasonal: {
    name: '시즌 행사', bg: '#f0f9ff', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#64748b', textMuted: '#94a3b8',
    heroGradient: 'linear-gradient(145deg,#0284c7 0%,#0369a1 40%,#075985 100%)',
    heroPattern: 'radial-gradient(circle at 30% 80%,rgba(6,182,212,.25) 0%,transparent 50%)',
    priceColor: '#0284c7', badgeGradient: 'linear-gradient(135deg,#0284c7,#06b6d4)', badgeShadow: 'rgba(2,132,199,.35)',
    catIconGradient: 'linear-gradient(135deg,#0284c7,#06b6d4)', tabActiveColor: '#0284c7',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#0284c7' }, emojiBg: 'linear-gradient(145deg,#f0f9ff,#e0f2fe)',
    heroAccent: 'rgba(6,182,212,.15)', borderColor: '#bae6fd',
  },
  mart_clearance: {
    name: '창고대방출', bg: '#fefce8', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#6b7280', textMuted: '#a16207',
    heroGradient: 'linear-gradient(145deg,#eab308 0%,#ca8a04 40%,#a16207 100%)',
    heroPattern: 'radial-gradient(circle at 70% 30%,rgba(239,68,68,.25) 0%,transparent 50%)',
    priceColor: '#dc2626', badgeGradient: 'linear-gradient(135deg,#eab308,#dc2626)', badgeShadow: 'rgba(234,179,8,.35)',
    catIconGradient: 'linear-gradient(135deg,#eab308,#dc2626)', tabActiveColor: '#ca8a04',
    tagColors: { red: '#dc2626', gold: '#ca8a04', blue: '#1d4ed8' }, emojiBg: 'linear-gradient(145deg,#fefce8,#fef9c3)',
    heroAccent: 'rgba(239,68,68,.15)', borderColor: '#fde68a',
  },
  butcher_premium: {
    name: '프리미엄 정육', bg: '#0f0f0f', cardBg: '#1a1a1a', textColor: '#f5f5f5', textSub: '#a3a3a3', textMuted: '#737373',
    heroGradient: 'linear-gradient(145deg,#1c1917 0%,#0c0a09 40%,#1a1a1a 100%)',
    heroPattern: 'radial-gradient(circle at 50% 50%,rgba(201,168,76,.15) 0%,transparent 60%)',
    priceColor: '#c9a84c', badgeGradient: 'linear-gradient(135deg,#c9a84c,#92702b)', badgeShadow: 'rgba(201,168,76,.35)',
    catIconGradient: 'linear-gradient(135deg,#c9a84c,#92702b)', tabActiveColor: '#c9a84c',
    tagColors: { red: '#ef4444', gold: '#c9a84c', blue: '#60a5fa' }, emojiBg: 'linear-gradient(145deg,#1c1917,#292524)',
    isDark: true, heroAccent: 'rgba(201,168,76,.1)', borderColor: '#292524',
  },
  butcher_daily: {
    name: '오늘의 고기', bg: '#fef2f2', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#6b7280', textMuted: '#9ca3af',
    heroGradient: 'linear-gradient(145deg,#dc2626 0%,#b91c1c 40%,#991b1b 100%)',
    heroPattern: 'radial-gradient(circle at 80% 20%,rgba(251,146,60,.25) 0%,transparent 50%)',
    priceColor: '#dc2626', badgeGradient: 'linear-gradient(135deg,#dc2626,#b91c1c)', badgeShadow: 'rgba(220,38,38,.35)',
    catIconGradient: 'linear-gradient(135deg,#dc2626,#ef4444)', tabActiveColor: '#dc2626',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#1d4ed8' }, emojiBg: 'linear-gradient(145deg,#fef2f2,#fee2e2)',
    heroAccent: 'rgba(251,146,60,.15)', borderColor: '#fecaca',
  },
  butcher_bulk: {
    name: '대용량 팩', bg: '#f0f4f8', cardBg: '#fff', textColor: '#1a1a1a', textSub: '#64748b', textMuted: '#94a3b8',
    heroGradient: 'linear-gradient(145deg,#1e3a8a 0%,#1e40af 40%,#172554 100%)',
    heroPattern: 'radial-gradient(circle at 20% 80%,rgba(59,130,246,.2) 0%,transparent 50%)',
    priceColor: '#1e40af', badgeGradient: 'linear-gradient(135deg,#1e40af,#1e3a8a)', badgeShadow: 'rgba(30,64,175,.35)',
    catIconGradient: 'linear-gradient(135deg,#1e40af,#3b82f6)', tabActiveColor: '#1e40af',
    tagColors: { red: '#dc2626', gold: '#b45309', blue: '#1e40af' }, emojiBg: 'linear-gradient(145deg,#eff6ff,#dbeafe)',
    heroAccent: 'rgba(59,130,246,.15)', borderColor: '#bfdbfe',
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
// ★ 프리미엄 베이스 엔진 — 모든 템플릿 공통
// ============================================================

function renderPremiumTemplate(d: FlyerRenderData, t: Theme): string {
  // 카테고리 탭
  const catTabs = d.categories.map((cat, i) =>
    `<a class="ct${i === 0 ? ' on' : ''}" href="#s${i}">${esc(cat.name || '')}</a>`
  ).join('');

  // 상품 섹션
  let sections = '';
  for (let ci = 0; ci < d.categories.length; ci++) {
    const cat = d.categories[ci];
    const items = cat.items || [];
    let cards = '';
    for (const item of items) {
      const img = resolveImg(item.name || '', 160, item.imageUrl);
      const disc = calcDisc(item.originalPrice, item.salePrice);
      const hasOrig = item.originalPrice && item.originalPrice > item.salePrice;
      const tagType = item.badge && /특가|할인|초특가|한정/.test(item.badge) ? 'red' : item.badge && /인기|추천|프리미엄|신선/.test(item.badge) ? 'blue' : 'gold';
      cards += `<div class="c">
        <div class="ci">${disc > 0 ? `<span class="bd">${disc}%</span>` : ''}${img}</div>
        <div class="cb">
          <p class="cn">${esc(item.name || '')}</p>
          ${hasOrig ? `<p class="co">${fmtPrice(item.originalPrice)}원</p>` : ''}
          <p class="cp"><span class="pn">${fmtPrice(item.salePrice || 0)}</span><span class="pw">원</span></p>
          ${item.badge ? `<span class="tg ${tagType}">${esc(item.badge)}</span>` : ''}
        </div>
      </div>`;
    }
    sections += `<section class="sc" id="s${ci}">
      <div class="sh"><div class="si">${String(ci + 1).padStart(2, '0')}</div><span class="sn">${esc(cat.name || '')}</span><span class="sk">${items.length}개 상품</span></div>
      <div class="g">${cards}</div>
    </section>`;
  }

  const darkCard = t.isDark ? `.c{border:1px solid ${t.borderColor}}` : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${esc(d.title || d.storeName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{font-family:'Noto Sans KR',sans-serif;background:${t.bg};color:${t.textColor};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;max-width:480px;margin:0 auto;overflow-x:hidden;line-height:1.5}

/* ═══ HERO — Premium Event Poster ═══ */
.h{position:relative;background:${t.heroGradient};padding:52px 24px 60px;text-align:center;overflow:hidden}
.h::before{content:'';position:absolute;inset:0;background:${t.heroPattern || 'none'};pointer-events:none;z-index:1}
.h::after{content:'';position:absolute;top:-40px;right:-40px;width:160px;height:160px;border:2px solid ${t.heroAccent || 'transparent'};border-radius:50%;pointer-events:none;z-index:1}
.hs{font-size:16px;font-weight:800;color:rgba(255,255,255,.9);letter-spacing:5px;text-transform:uppercase;margin-bottom:14px;position:relative;z-index:2}
.hs::after{content:'';display:block;width:40px;height:2px;background:rgba(255,255,255,.4);margin:10px auto 0;border-radius:1px}
.ht{font-size:36px;font-weight:900;color:#fff;line-height:1.2;text-shadow:0 4px 24px rgba(0,0,0,.3),0 1px 0 rgba(255,255,255,.1);position:relative;z-index:2;letter-spacing:-1px}
.hp{display:inline-flex;align-items:center;gap:8px;margin-top:20px;background:rgba(255,255,255,.15);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.2);border-radius:28px;padding:10px 24px;font-size:13px;font-weight:600;color:#fff;position:relative;z-index:2}
.hw{position:absolute;bottom:0;left:0;right:0;height:32px;background:${t.bg};border-radius:32px 32px 0 0;z-index:3}

/* ═══ CATEGORY TABS — Pill Style ═══ */
.nav{position:sticky;top:0;z-index:100;background:${t.isDark ? t.cardBg : 'rgba(255,255,255,.95)'};backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 1px 0 ${t.borderColor},0 4px 20px rgba(0,0,0,.04)}
.ni{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:10px 10px;gap:6px}
.ni::-webkit-scrollbar{display:none}
.ct{flex-shrink:0;scroll-snap-align:start;padding:8px 18px;font-size:13px;font-weight:700;color:${t.textMuted};white-space:nowrap;text-decoration:none;border-radius:20px;transition:all .25s cubic-bezier(.4,0,.2,1);background:transparent}
.ct.on{color:#fff;background:${t.tabActiveColor};box-shadow:0 2px 8px ${t.badgeShadow}}

/* ═══ CONTENT ═══ */
.w{padding:6px 14px 32px}

/* ═══ SECTION HEADER ═══ */
.sc{padding-top:24px}
.sc:first-child{padding-top:16px}
.sh{display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:0 2px}
.si{width:40px;height:40px;border-radius:12px;background:${t.catIconGradient};display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:900;flex-shrink:0;box-shadow:0 4px 12px ${t.badgeShadow};letter-spacing:-.5px}
.sn{font-size:19px;font-weight:900;color:${t.textColor};letter-spacing:-.5px}
.sk{font-size:11px;font-weight:600;color:${t.textMuted};margin-left:auto;background:${t.isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.04)'};padding:4px 10px;border-radius:10px}

/* ═══ PRODUCT GRID ═══ */
.g{display:grid;grid-template-columns:1fr 1fr;gap:12px}

/* ═══ PRODUCT CARD — Elevated ═══ */
.c{background:${t.cardBg};border-radius:20px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.06),0 4px 12px rgba(0,0,0,.04),0 12px 32px rgba(0,0,0,.03);position:relative;transition:transform .2s cubic-bezier(.4,0,.2,1)}
${darkCard}

/* Card Image */
.ci{position:relative;width:100%;aspect-ratio:1/.82;overflow:hidden;background:${t.isDark ? t.cardBg : '#f8fafc'}}
.ci::after{content:'';position:absolute;bottom:0;left:0;right:0;height:40px;background:linear-gradient(to top,${t.isDark ? 'rgba(26,26,26,.4)' : 'rgba(255,255,255,.3)'},transparent);pointer-events:none;z-index:1}
.ci .product-img{width:100%;height:100%;object-fit:cover;display:block}
.ci .emoji-area{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:60px;background:${t.emojiBg}}

/* Discount Badge — Tilted for dynamism */
.bd{position:absolute;top:10px;left:10px;z-index:2;background:${t.badgeGradient};color:#fff;font-size:13px;font-weight:900;padding:6px 12px;border-radius:10px;box-shadow:0 4px 12px ${t.badgeShadow};line-height:1;transform:rotate(-2deg);letter-spacing:-.3px}

/* Card Body */
.cb{padding:14px 14px 18px}
.cn{font-size:15px;font-weight:800;color:${t.textColor};line-height:1.3;margin-bottom:4px;letter-spacing:-.2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.co{font-size:12px;font-weight:500;color:${t.textMuted};text-decoration:line-through;margin-bottom:3px;letter-spacing:-.2px}

/* ★ PRICE — The Hero of Each Card */
.cp{display:flex;align-items:baseline;gap:1px;line-height:1;margin-top:2px}
.pn{font-size:28px;font-weight:900;color:${t.priceColor};letter-spacing:-1px;text-shadow:0 1px 2px rgba(0,0,0,.08)}
.pw{font-size:13px;font-weight:700;color:${t.priceColor};margin-left:2px;opacity:.8}

/* Tags */
.tg{display:inline-flex;margin-top:8px;padding:4px 10px;font-size:10px;font-weight:800;border-radius:8px;line-height:1.2;letter-spacing:.3px;text-transform:uppercase}
.tg.red{background:${t.isDark ? 'rgba(239,68,68,.12)' : '#fef2f2'};color:${t.tagColors.red};border:1px solid ${t.isDark ? 'rgba(239,68,68,.25)' : '#fecaca'}}
.tg.gold{background:${t.isDark ? 'rgba(212,168,68,.12)' : '#fffbeb'};color:${t.tagColors.gold};border:1px solid ${t.isDark ? 'rgba(212,168,68,.25)' : '#fde68a'}}
.tg.blue{background:${t.isDark ? 'rgba(96,165,250,.12)' : '#eff6ff'};color:${t.tagColors.blue};border:1px solid ${t.isDark ? 'rgba(96,165,250,.25)' : '#bfdbfe'}}

/* ═══ FOOTER ═══ */
.ft{text-align:center;padding:32px 16px 40px;margin:12px 14px 0;color:${t.textMuted};font-size:10px;font-weight:500;letter-spacing:2px;text-transform:uppercase}

/* ═══ RESPONSIVE ═══ */
@media(max-width:360px){.ht{font-size:28px}.hs{font-size:14px}.pn{font-size:24px}.cn{font-size:13px}.cb{padding:12px 12px 14px}.h{padding:40px 20px 52px}}
@media(min-width:420px){.pn{font-size:32px}.ht{font-size:38px}.hs{font-size:17px}}
</style>
</head>
<body>
<div class="h">
  <p class="hs">${esc(d.storeName)}</p>
  <h1 class="ht">${esc(d.title)}</h1>
  ${d.period ? `<div class="hp">${esc(d.period)}</div>` : ''}
  <div class="hw"></div>
</div>
<nav class="nav"><div class="ni">${catTabs}</div></nav>
<div class="w">${sections}</div>
<div class="ft">hanjul-flyer.kr</div>
<script>
(function(){
  var ts=document.querySelectorAll('.ct'),ss=document.querySelectorAll('.sc');
  ts.forEach(function(t,i){t.addEventListener('click',function(e){e.preventDefault();ts.forEach(function(x){x.classList.remove('on')});t.classList.add('on');if(ss[i])ss[i].scrollIntoView({behavior:'smooth',block:'start'})})});
  if('IntersectionObserver' in window){var o=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){var id=e.target.id;ts.forEach(function(t){t.classList.toggle('on',t.getAttribute('href')==='#'+id)});var a=document.querySelector('.ct.on');if(a)a.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'})}})},{rootMargin:'-80px 0px -60% 0px',threshold:0});ss.forEach(function(s){o.observe(s)})}
})();
</script>
</body>
</html>`;
}

// ============================================================
// 렌더러 맵 — 단일 진입점
// ============================================================

const RENDERERS: Record<string, (d: FlyerRenderData) => string> = {
  grid:             d => renderPremiumTemplate(d, THEMES.grid),
  list:             d => renderPremiumTemplate(d, THEMES.list),
  highlight:        d => renderPremiumTemplate(d, THEMES.highlight),
  mart_fresh:       d => renderPremiumTemplate(d, THEMES.mart_fresh),
  mart_weekend:     d => renderPremiumTemplate(d, THEMES.mart_weekend),
  mart_seasonal:    d => renderPremiumTemplate(d, THEMES.mart_seasonal),
  mart_clearance:   d => renderPremiumTemplate(d, THEMES.mart_clearance),
  butcher_premium:  d => renderPremiumTemplate(d, THEMES.butcher_premium),
  butcher_daily:    d => renderPremiumTemplate(d, THEMES.butcher_daily),
  butcher_bulk:     d => renderPremiumTemplate(d, THEMES.butcher_bulk),
};

/**
 * ★ 단일 진입점. templateCode로 렌더러 선택. 미존재 시 grid 폴백.
 */
export function renderTemplate(templateCode: string, data: FlyerRenderData): string {
  const renderer = RENDERERS[templateCode];
  let html = renderer ? renderer(data) : renderPremiumTemplate(data, THEMES.grid);

  if (data.qrCodeDataUrl) {
    html = html.replace('</body>', renderQrSection(data) + '</body>');
  }

  return html;
}

// 하위호환 export
export { esc as escapeHtml, fmtPrice as formatPrice };
