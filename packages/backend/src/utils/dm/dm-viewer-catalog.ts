/**
 * dm-viewer-catalog.ts : 슬라이드 DM "카탈로그 보기"(PC 책 펼침) 조각 (순수, DB import 0)
 *
 * ★ 2026-09-15 (Harold 접수 · 참고 = 메이크뷰 DM) 완성 이미지 슬라이드 DM을 PC에서 열면 430px 한 열이라 카탈로그 느낌이 없었다.
 *   게이트 = layout_mode slides · 펼친 뒤 전 장이 이미지 무대(isSwipeImagePage) · 2장 이상. 조건 밖 DM 출력은 바이트 동일.
 *   PC(폭 768 이상 · 터치형은 1024 이상) = 표지 단독 → 2쪽 펼침 · 낱장 넘김 · 전체보기 썸네일 · 처음/마지막 · 확대(폭 맞춤) · 한쪽/두쪽 · 전체화면 · 안내.
 *   모바일 = 현행 무대 그대로 + 띠 왼쪽 전체보기 버튼 + 핀치 확대 허용(viewport).
 *   추적 = 뷰어 스크립트의 updateCurrent·bumpSection 을 그대로 호출(비콘 본문·주기 무변경).
 *   소비처 = dm-viewer.ts renderPagesHtml 한 곳. 검증 = dm-viewer-catalog.test.ts.
 *   ⚠ 아래 문자열은 dm-viewer.ts 의 template literal 안에 들어간다 : 백틱·"$"+"{" 를 쓰지 않는다(정규식도 쓰지 않는다).
 */
import { isSwipeImagePage, type SlidePage } from './dm-slides-expand';
import { publicImageUrl } from './dm-viewer-utils';
import { escapeHtml } from './dm-section-renderer';

/** 게이트 : 2장 이상이고 전 장이 이미지 1장 무대일 때만 책이 된다 */
export function isCatalogDm(pages: SlidePage[]): boolean {
  if (!Array.isArray(pages) || pages.length < 2) return false;
  return pages.every((p) => isSwipeImagePage(p));
}

/** 첫 장 이미지의 절대 URL(og:image). 상대 경로는 서비스 주소(HANJUL_BASE_URL · 폴백 hanjul.ai)를 붙인다. */
export function catalogFirstImageUrl(pages: SlidePage[]): string {
  const first = pages[0]?.sections?.[0]?.props?.images?.[0]?.url;
  if (!first) return '';
  const pub = publicImageUrl(String(first));
  if (/^https?:\/\//i.test(pub) || pub.startsWith('data:')) return pub;
  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  return `${base}${pub.startsWith('/') ? '' : '/'}${pub}`;
}

/** 핀치 확대 허용 viewport(카탈로그 DM만) : 현행 잠금(maximum-scale=1.0,user-scalable=no)의 대체 */
export const CATALOG_VIEWPORT_META = '<meta name="viewport" content="width=device-width,initial-scale=1.0,minimum-scale=1.0,maximum-scale=3.0,user-scalable=yes">';

/** 공유 미리보기 메타 : 문자·카카오톡에 붙였을 때 첫 장이 뜨게 */
export function renderCatalogOgMeta(pageTitle: string, imageUrl: string): string {
  const t = escapeHtml(pageTitle);
  const img = imageUrl ? `\n<meta property="og:image" content="${escapeHtml(imageUrl)}">` : '';
  return `<meta property="og:type" content="article">\n<meta property="og:title" content="${t}">${img}\n<meta name="twitter:card" content="summary_large_image">`;
}

const ICON = {
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="14" width="6.5" height="6.5" rx="1.2"/></svg>',
  first: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 5v14"/><path d="M18 6l-7 6 7 6"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  last: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 5v14"/><path d="M6 6l7 6-7 6"/></svg>',
  zoom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/><path d="M8.5 11h5M11 8.5v5"/></svg>',
  dual: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="8.5" height="14" rx="1"/><rect x="12.5" y="5" width="8.5" height="14" rx="1"/></svg>',
  single: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="7" y="4.5" width="10" height="15" rx="1"/></svg>',
  fullOn: '<svg data-dm-cat="icFullOn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  fullOff: '<svg data-dm-cat="icFullOff" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:none"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.9.5-1.2 1-1.2 1.9"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  arrowL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  arrowR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
};

/** 모바일 띠(.dm-page-dots) 왼쪽 전체보기 버튼 : 띠는 PC에서 숨겨지므로 모바일 전용 */
export function renderCatalogMobileGridButton(): string {
  return `<button type="button" class="dm-cat-mgrid" data-dm-cat="mgrid" aria-label="전체보기">${ICON.grid}</button>`;
}

/** 카탈로그 CSS : 접두 dm-cat- · PC 판정은 body.dm-cat-pc(스크립트가 붙인다) */
export function renderCatalogCss(): string {
  return `
/* dm-cat:start */
/* ★ 2026-09-15 카탈로그 보기 : PC 에서 기존 열·띠·화살표를 숨기고 책 크롬을 그린다. 모바일은 현행 그대로(띠에 전체보기 버튼만). */
body.dm-cat-pc{background:#15161a;overflow:hidden}
body.dm-cat-pc .dm-viewer,body.dm-cat-pc .dm-page-dots,body.dm-cat-pc .dm-page-nav,body.dm-cat-pc .dm-grain{display:none}
.dm-cat,.dm-cat-ov,.dm-cat-help{font-family:Pretendard,-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#f4f4f6;-webkit-font-smoothing:antialiased}
.dm-cat,.dm-cat-ov,.dm-cat-help{--dm-cat-muted:rgba(255,255,255,0.58);--dm-cat-pw:320px;--dm-cat-ph:460px}
.dm-cat{display:none}
body.dm-cat-pc .dm-cat{display:block;position:fixed;inset:0;z-index:100;background:#15161a radial-gradient(1200px 640px at 50% 38%,rgba(255,255,255,0.07),transparent 62%);overflow:hidden}
.dm-cat *{box-sizing:border-box}
.dm-cat button{font:inherit}
.dm-cat img,.dm-cat-ov img{-webkit-user-drag:none;user-select:none}
.dm-cat-stage{position:absolute;left:0;right:0;top:0;bottom:60px;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:28px 0;cursor:grab;user-select:none}
.dm-cat-stage:active{cursor:grabbing}
.dm-cat.dm-cat-fitw .dm-cat-stage{align-items:flex-start;overflow-y:auto;cursor:default}
.dm-cat-book{position:relative;width:calc(var(--dm-cat-pw) * 2);height:var(--dm-cat-ph);flex:0 0 auto;perspective:2600px;transition:transform .6s cubic-bezier(.4,.05,.2,1)}
.dm-cat-page{position:absolute;top:0;width:var(--dm-cat-pw);height:var(--dm-cat-ph);background:#fff;overflow:hidden;box-shadow:0 28px 64px rgba(0,0,0,0.6),0 2px 6px rgba(0,0,0,0.45)}
.dm-cat-page--l{left:0;border-radius:3px 0 0 3px}
.dm-cat-page--r{left:50%;border-radius:0 3px 3px 0}
.dm-cat-page.dm-cat-empty{visibility:hidden}
.dm-cat-page img,.dm-cat-face img{width:100%;height:100%;object-fit:contain;display:block;background:#fff}
.dm-cat-page img{transition:opacity .18s}
.dm-cat-book.dm-cat-fade .dm-cat-page img{opacity:0}
.dm-cat-spine{position:absolute;top:0;bottom:0;left:50%;width:140px;transform:translateX(-50%);pointer-events:none;z-index:3;opacity:0;transition:opacity .3s;background:linear-gradient(to right,rgba(0,0,0,0) 0%,rgba(0,0,0,0.08) 40%,rgba(0,0,0,0.30) 50%,rgba(0,0,0,0.08) 60%,rgba(0,0,0,0) 100%)}
.dm-cat-book.dm-cat-has-l.dm-cat-has-r .dm-cat-spine{opacity:1}
.dm-cat-book::before,.dm-cat-book::after{content:"";position:absolute;top:5px;bottom:5px;width:7px;z-index:0;opacity:0;transition:opacity .3s;background:repeating-linear-gradient(to right,#ececee 0 1px,#c9c9ce 1px 2px)}
.dm-cat-book::before{left:-7px;border-radius:2px 0 0 2px}
.dm-cat-book::after{right:-7px;border-radius:0 2px 2px 0}
.dm-cat-book.dm-cat-has-l::before{opacity:1}
.dm-cat-book.dm-cat-has-r::after{opacity:1}
.dm-cat-sheet{position:absolute;top:0;width:var(--dm-cat-pw);height:var(--dm-cat-ph);transform-style:preserve-3d;transition:transform .62s cubic-bezier(.42,.06,.2,1);z-index:6;pointer-events:none}
.dm-cat-sheet[hidden]{display:none}
.dm-cat-sheet.dm-cat-next{left:50%;transform-origin:left center;transform:rotateY(0)}
.dm-cat-sheet.dm-cat-next.dm-cat-go{transform:rotateY(-180deg)}
.dm-cat-sheet.dm-cat-prev{left:0;transform-origin:right center;transform:rotateY(0)}
.dm-cat-sheet.dm-cat-prev.dm-cat-go{transform:rotateY(180deg)}
.dm-cat-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;background:#fff;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,0.5)}
.dm-cat-face--back{transform:rotateY(180deg)}
.dm-cat-face.dm-cat-empty{background:transparent;box-shadow:none}
.dm-cat-face.dm-cat-empty img{display:none}
.dm-cat-face::after{content:"";position:absolute;inset:0;opacity:0;transition:opacity .3s;pointer-events:none}
.dm-cat-next .dm-cat-face--front::after{background:linear-gradient(to right,rgba(0,0,0,0.30),rgba(0,0,0,0) 45%)}
.dm-cat-next .dm-cat-face--back::after{background:linear-gradient(to left,rgba(0,0,0,0.30),rgba(0,0,0,0) 45%)}
.dm-cat-prev .dm-cat-face--front::after{background:linear-gradient(to left,rgba(0,0,0,0.30),rgba(0,0,0,0) 45%)}
.dm-cat-prev .dm-cat-face--back::after{background:linear-gradient(to right,rgba(0,0,0,0.30),rgba(0,0,0,0) 45%)}
.dm-cat-sheet.dm-cat-go .dm-cat-face::after{opacity:1}
.dm-cat-arrow{position:absolute;top:50%;transform:translateY(-50%);width:54px;height:54px;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .2s,opacity .25s;z-index:8;padding:0}
.dm-cat-arrow:hover{background:rgba(255,255,255,0.16)}
.dm-cat-arrow[disabled]{opacity:.18;cursor:default}
.dm-cat-arrow--prev{left:26px}
.dm-cat-arrow--next{right:26px}
.dm-cat-arrow svg{width:22px;height:22px}
.dm-cat-bar{position:absolute;left:0;right:0;bottom:0;height:60px;background:rgba(22,23,28,0.86);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid rgba(255,255,255,0.08);display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 18px;transition:opacity .4s;z-index:10}
.dm-cat.dm-cat-dim .dm-cat-bar,.dm-cat.dm-cat-dim .dm-cat-arrow{opacity:.28}
.dm-cat.dm-cat-dim .dm-cat-arrow[disabled]{opacity:.08}
.dm-cat-progress{position:absolute;left:0;top:-1px;height:2px;width:100%;background:rgba(255,255,255,0.08)}
.dm-cat-progress i{display:block;height:100%;width:0;background:var(--dm-primary);transition:width .45s cubic-bezier(.4,.05,.2,1);box-shadow:0 0 12px var(--dm-primary)}
.dm-cat-left,.dm-cat-center,.dm-cat-right{display:flex;align-items:center;gap:4px;min-width:0}
.dm-cat-center{justify-content:center}
.dm-cat-right{justify-content:flex-end}
.dm-cat-btn{height:36px;min-width:36px;padding:0 10px;border:0;background:transparent;color:var(--dm-cat-muted);border-radius:9px;display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:500;cursor:pointer;transition:background .15s,color .15s;white-space:nowrap}
.dm-cat-btn:hover{color:#fff;background:rgba(255,255,255,0.09)}
.dm-cat-btn.dm-cat-on{color:#fff;background:rgba(255,255,255,0.14);box-shadow:inset 0 0 0 1px var(--dm-primary)}
.dm-cat-btn[disabled]{opacity:.25;cursor:default;background:transparent}
.dm-cat-btn svg{width:18px;height:18px;flex:0 0 auto}
.dm-cat-ind{margin-left:10px;font-size:13px;color:#fff;font-variant-numeric:tabular-nums;letter-spacing:.2px;display:inline-flex;align-items:baseline;gap:6px;white-space:nowrap}
.dm-cat-ind small{font-size:12px;color:var(--dm-cat-muted)}
.dm-cat-sep{width:1px;height:20px;background:rgba(255,255,255,0.12);margin:0 6px}
.dm-cat-hint{position:absolute;left:50%;bottom:84px;transform:translateX(-50%) translateY(6px);background:rgba(255,255,255,0.96);color:#111;font-size:12.5px;font-weight:500;padding:9px 14px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,0.35);opacity:0;transition:opacity .35s,transform .35s;pointer-events:none;z-index:12;display:flex;align-items:center;gap:8px;white-space:nowrap}
.dm-cat-hint.dm-cat-show{opacity:1;transform:translateX(-50%) translateY(0)}
.dm-cat-hint kbd{font:inherit;font-size:11px;background:#eef;color:#3730a3;border-radius:5px;padding:1px 6px}
.dm-cat-mgrid{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:50%;border:0;background:rgba(0,0,0,0.06);color:#333;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.dm-cat-mgrid svg{width:17px;height:17px}
.dm-cat-ov{position:fixed;inset:0;background:rgba(14,15,19,0.94);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);z-index:99000;overflow:auto;opacity:0;pointer-events:none;transition:opacity .25s}
.dm-cat-ov.dm-cat-open{opacity:1;pointer-events:auto}
.dm-cat-ovhead{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;padding:18px 28px;background:linear-gradient(to bottom,rgba(14,15,19,0.98),rgba(14,15,19,0.6));z-index:2}
.dm-cat-ovtitle{font-size:15px;font-weight:600;color:#fff;display:flex;align-items:baseline;gap:10px}
.dm-cat-ovtitle small{font-size:12px;color:var(--dm-cat-muted);font-weight:400}
.dm-cat-x{width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.dm-cat-x:hover{background:rgba(255,255,255,0.16)}
.dm-cat-x svg{width:18px;height:18px}
.dm-cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:22px 18px;padding:8px 28px 60px}
.dm-cat-thumb{background:transparent;border:0;padding:0;cursor:pointer;text-align:center;color:var(--dm-cat-muted);font-size:12px;border-radius:6px;outline:none;font:inherit}
.dm-cat-thumb .dm-cat-ph{aspect-ratio:var(--dm-cat-ratio,640/920);background:#fff;border-radius:3px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.45);transition:transform .18s,box-shadow .18s}
.dm-cat-thumb .dm-cat-ph img{width:100%;height:100%;object-fit:contain;display:block;background:#fff}
.dm-cat-thumb:hover .dm-cat-ph{transform:translateY(-3px);box-shadow:0 14px 30px rgba(0,0,0,0.55)}
.dm-cat-thumb.dm-cat-cur .dm-cat-ph{outline:2px solid var(--dm-primary);outline-offset:3px}
.dm-cat-thumb.dm-cat-cur .dm-cat-num{color:#fff;font-weight:600}
.dm-cat-thumb .dm-cat-num{display:block;margin-top:8px}
@media (max-width:640px){.dm-cat-grid{grid-template-columns:repeat(3,1fr);gap:16px 12px;padding:6px 16px 40px}.dm-cat-ovhead{padding:14px 16px}}
.dm-cat-help{position:fixed;inset:0;background:rgba(10,11,14,0.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:99001;display:flex;align-items:center;justify-content:center;padding:24px;opacity:0;pointer-events:none;transition:opacity .25s}
.dm-cat-help.dm-cat-open{opacity:1;pointer-events:auto}
.dm-cat-card{width:min(720px,100%);background:#1c1d23;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:28px 28px 24px;box-shadow:0 30px 80px rgba(0,0,0,0.6);transform:translateY(8px);transition:transform .25s}
.dm-cat-help.dm-cat-open .dm-cat-card{transform:none}
.dm-cat-cardhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.dm-cat-cardhead h2{margin:0;font-size:17px;font-weight:700;color:#fff}
.dm-cat-lead{margin:0 0 20px;color:var(--dm-cat-muted);font-size:13px;line-height:1.6}
.dm-cat-items{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
@media (max-width:640px){.dm-cat-items{grid-template-columns:1fr}}
.dm-cat-item{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px 16px 14px}
.dm-cat-item .dm-cat-ic{width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.08);color:#fff;display:flex;align-items:center;justify-content:center;margin-bottom:12px}
.dm-cat-item .dm-cat-ic svg{width:20px;height:20px}
.dm-cat-item h3{margin:0 0 6px;font-size:13.5px;font-weight:600;color:#fff}
.dm-cat-item p{margin:0;font-size:12.5px;line-height:1.65;color:var(--dm-cat-muted)}
.dm-cat-foot{margin-top:18px;font-size:11.5px;color:rgba(255,255,255,0.35)}
@media (prefers-reduced-motion: reduce){.dm-cat-book,.dm-cat-sheet,.dm-cat-progress i,.dm-cat-arrow,.dm-cat-btn{transition:none}}
/* dm-cat:end */
`;
}

/** 카탈로그 마크업 : PC 책 크롬(.dm-cat) + 공용 오버레이(전체보기·안내). 스크립트가 data-dm-cat 로 찾는다. */
export function renderCatalogHtml(totalPages: number): string {
  const n = Math.max(0, Math.floor(totalPages));
  return `<!-- dm-cat -->
<div class="dm-cat" data-dm-cat="root">
  <div class="dm-cat-stage" data-dm-cat="stage">
    <div class="dm-cat-book" data-dm-cat="book">
      <div class="dm-cat-page dm-cat-page--l" data-dm-cat="pageL"><img alt="" data-dm-cat="imgL"></div>
      <div class="dm-cat-page dm-cat-page--r" data-dm-cat="pageR"><img alt="" data-dm-cat="imgR"></div>
      <div class="dm-cat-spine"></div>
      <div class="dm-cat-sheet" data-dm-cat="sheet" hidden>
        <div class="dm-cat-face dm-cat-face--front" data-dm-cat="faceF"><img alt="" data-dm-cat="imgF"></div>
        <div class="dm-cat-face dm-cat-face--back" data-dm-cat="faceB"><img alt="" data-dm-cat="imgB"></div>
      </div>
    </div>
  </div>
  <button type="button" class="dm-cat-arrow dm-cat-arrow--prev" data-dm-cat="prev" aria-label="이전 쪽">${ICON.arrowL}</button>
  <button type="button" class="dm-cat-arrow dm-cat-arrow--next" data-dm-cat="next" aria-label="다음 쪽">${ICON.arrowR}</button>
  <div class="dm-cat-hint" data-dm-cat="hint"><kbd>&larr;</kbd><kbd>&rarr;</kbd> 방향키나 드래그로 넘겨 보세요</div>
  <div class="dm-cat-bar">
    <div class="dm-cat-progress"><i data-dm-cat="prog"></i></div>
    <div class="dm-cat-left">
      <button type="button" class="dm-cat-btn" data-dm-cat="grid" title="전체보기">${ICON.grid}<span>전체보기</span></button>
      <span class="dm-cat-ind"><span data-dm-cat="ind">1</span><small>/ ${n}</small></span>
    </div>
    <div class="dm-cat-center">
      <button type="button" class="dm-cat-btn" data-dm-cat="first" title="처음" aria-label="처음">${ICON.first}</button>
      <button type="button" class="dm-cat-btn" data-dm-cat="bprev" title="이전" aria-label="이전">${ICON.prev}</button>
      <button type="button" class="dm-cat-btn" data-dm-cat="bnext" title="다음" aria-label="다음">${ICON.next}</button>
      <button type="button" class="dm-cat-btn" data-dm-cat="last" title="마지막" aria-label="마지막">${ICON.last}</button>
    </div>
    <div class="dm-cat-right">
      <button type="button" class="dm-cat-btn" data-dm-cat="fit" title="폭 맞춤(확대)">${ICON.zoom}<span data-dm-cat="fitLabel">확대</span></button>
      <span class="dm-cat-sep"></span>
      <button type="button" class="dm-cat-btn dm-cat-on" data-dm-cat="dual" title="두 쪽 보기" aria-label="두 쪽 보기">${ICON.dual}</button>
      <button type="button" class="dm-cat-btn" data-dm-cat="single" title="한 쪽 보기" aria-label="한 쪽 보기">${ICON.single}</button>
      <span class="dm-cat-sep"></span>
      <button type="button" class="dm-cat-btn" data-dm-cat="full" title="전체화면" aria-label="전체화면">${ICON.fullOn}${ICON.fullOff}</button>
      <button type="button" class="dm-cat-btn" data-dm-cat="help" title="안내" aria-label="안내">${ICON.help}</button>
    </div>
  </div>
</div>
<div class="dm-cat-ov" data-dm-cat="ov" aria-hidden="true">
  <div class="dm-cat-ovhead">
    <div class="dm-cat-ovtitle">전체보기 <small>${n}쪽</small></div>
    <button type="button" class="dm-cat-x" data-dm-cat="ovClose" aria-label="닫기">${ICON.close}</button>
  </div>
  <div class="dm-cat-grid" data-dm-cat="gridBody"></div>
</div>
<div class="dm-cat-help" data-dm-cat="helpBox" aria-hidden="true">
  <div class="dm-cat-card">
    <div class="dm-cat-cardhead">
      <h2>이렇게 보세요</h2>
      <button type="button" class="dm-cat-x" data-dm-cat="helpClose" aria-label="닫기">${ICON.close}</button>
    </div>
    <p class="dm-cat-lead">책처럼 넘기며 보는 카탈로그입니다. 원하는 쪽으로 바로 가거나 크게 볼 수 있어요.</p>
    <div class="dm-cat-items">
      <div class="dm-cat-item"><div class="dm-cat-ic">${ICON.flip}</div><h3>쪽 넘기기</h3><p>양옆 화살표 · 키보드 &larr; &rarr; · 마우스 휠 · 드래그(터치는 스와이프)</p></div>
      <div class="dm-cat-item"><div class="dm-cat-ic">${ICON.zoom}</div><h3>크게 보기</h3><p>쪽을 더블클릭하거나 아래 [확대]를 누르면 화면 폭에 맞춰 커지고 위아래로 살펴볼 수 있어요. 휴대폰은 두 손가락으로 확대.</p></div>
      <div class="dm-cat-item"><div class="dm-cat-ic">${ICON.grid}</div><h3>한눈에 보기</h3><p>[전체보기]에서 쪽을 골라 바로 이동 · 두 쪽/한 쪽 전환 · 전체화면</p></div>
    </div>
    <div class="dm-cat-foot">아래 물음표 버튼으로 다시 볼 수 있어요</div>
  </div>
</div>
<!-- /dm-cat -->`;
}

/**
 * 카탈로그 스크립트 : dm-viewer.ts 뷰어 IIFE 안, 키보드 블록 뒤에 들어간다.
 * 그 IIFE 의 pageEls · currentIdx · updateCurrent · bumpSection · goToPage · setViewportHeight 를 그대로 쓴다.
 * dmCatalogOn 은 기존 ←/→ 핸들러가 읽는 가드(var 호이스팅 · PC 모드에서만 true).
 */
export function renderCatalogScript(): string {
  return `
  /* dm-cat:start */
  // ★ 2026-09-15 카탈로그 보기 : 전 장 이미지 무대 슬라이드 DM. PC(폭 768 이상 · 터치형 1024 이상) = 책 크롬, 모바일 = 현행 무대 + 전체보기.
  //   추적은 기존 updateCurrent(도달 장·진행률)·bumpSection(장별 조회)을 호출한다 : 비콘 본문·주기 무변경(sendTrack 한 곳).
  var dmCatalogOn = false;
  (function(){
    var root = document.querySelector('[data-dm-cat="root"]');
    if (!root || !pageEls || pageEls.length < 2) return;
    var q = function(name, from){ return (from || document).querySelector('[data-dm-cat="' + name + '"]'); };
    var N = pageEls.length;
    var srcs = [], sids = [];
    for (var i = 0; i < N; i++) {
      var im = pageEls[i].querySelector('img');
      var wrap = pageEls[i].querySelector('.dm-section-wrap');
      srcs.push(im ? (im.getAttribute('src') || '') : '');
      sids.push(wrap ? (wrap.getAttribute('data-section-id') || '') : '');
    }
    if (srcs.indexOf('') >= 0) return; // 이미지 없는 장이 있으면 책을 만들지 않는다(현행 유지)

    var stage = q('stage'), book = q('book'), imgL = q('imgL'), imgR = q('imgR'), sheet = q('sheet'), imgF = q('imgF'), imgB = q('imgB');
    var arrowPrev = q('prev'), arrowNext = q('next'), prog = q('prog'), ind = q('ind'), hint = q('hint');
    var btnGrid = q('grid'), btnFirst = q('first'), btnPrev = q('bprev'), btnNext = q('bnext'), btnLast = q('last');
    var btnFit = q('fit'), fitLabel = q('fitLabel'), btnDual = q('dual'), btnSingle = q('single'), btnFull = q('full'), btnHelp = q('help');
    var ov = q('ov'), gridBody = q('gridBody'), ovClose = q('ovClose'), helpBox = q('helpBox'), helpClose = q('helpClose'), mgrid = q('mgrid');
    if (!stage || !book || !imgL || !imgR || !sheet) return;
    var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    var ratio = 920 / 640;
    var pcOn = null, dual = true, fitW = false, cur = 0, spreads = [], animating = false, gridBuilt = false;

    function isPc(){
      var coarse = !!(window.matchMedia && matchMedia('(hover:none) and (pointer:coarse)').matches);
      return innerWidth >= 768 && !(coarse && innerWidth < 1024);
    }
    function buildSpreads(){
      spreads = [];
      if (!dual) { for (var i = 0; i < N; i++) spreads.push({ l: null, r: i }); return; }
      spreads.push({ l: null, r: 0 });
      for (var j = 1; j < N; j += 2) spreads.push({ l: j, r: (j + 1 < N) ? j + 1 : null });
    }
    function spreadOfPage(p){ for (var s = 0; s < spreads.length; s++){ if (spreads[s].l === p || spreads[s].r === p) return s; } return 0; }
    function setImg(img, idx){
      var box = img.parentNode;
      if (idx === null || idx === undefined) { img.removeAttribute('src'); box.classList.add('dm-cat-empty'); }
      else { if (img.getAttribute('src') !== srcs[idx]) img.src = srcs[idx]; box.classList.remove('dm-cat-empty'); }
    }
    function shiftFor(sp){ if (sp.l === null && sp.r !== null) return -0.5; if (sp.r === null && sp.l !== null) return 0.5; return 0; }
    function applyShift(sp){ book.style.transform = 'translateX(calc(var(--dm-cat-pw) * ' + shiftFor(sp) + '))'; }
    function layout(){
      var r = stage.getBoundingClientRect();
      var availH = Math.max(200, r.height - 56), availW = Math.max(200, r.width - 170);
      var cols = dual ? 2 : 1, pw, ph;
      if (fitW) { pw = Math.floor(Math.min(availW, 1400) / cols); ph = Math.round(pw * ratio); }
      else { ph = Math.floor(availH); pw = Math.round(ph / ratio); if (pw * cols > availW) { pw = Math.floor(availW / cols); ph = Math.round(pw * ratio); } }
      root.style.setProperty('--dm-cat-pw', pw + 'px');
      root.style.setProperty('--dm-cat-ph', ph + 'px');
    }
    function adoptRatio(img){
      if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
        var rr = img.naturalHeight / img.naturalWidth;
        if (Math.abs(rr - ratio) > 0.01) { ratio = rr; root.style.setProperty('--dm-cat-ratio', img.naturalWidth + '/' + img.naturalHeight); if (ov) ov.style.setProperty('--dm-cat-ratio', img.naturalWidth + '/' + img.naturalHeight); layout(); }
      }
    }
    imgR.addEventListener('load', function(){ adoptRatio(imgR); });
    imgL.addEventListener('load', function(){ if (imgR.getAttribute('src') === null) adoptRatio(imgL); });

    function pagesOf(sp){ var out = []; if (sp.l !== null) out.push(sp.l); if (sp.r !== null) out.push(sp.r); return out; }
    function trackSpread(sp){
      // 도달 장·진행률 = 기존 함수 · 장별 조회 = 기존 섹션 카운터(비콘이 합산 전송)
      var ps = pagesOf(sp), maxIdx = -1;
      for (var i = 0; i < ps.length; i++) { if (ps[i] > maxIdx) maxIdx = ps[i]; bumpSection(sids[ps[i]], 'views'); }
      if (maxIdx >= 0) updateCurrent(maxIdx);
    }
    function updateBar(){
      var sp = spreads[cur], ps = pagesOf(sp), labels = [];
      for (var i = 0; i < ps.length; i++) labels.push(ps[i] + 1);
      if (ind) ind.textContent = labels.join(' \\u00b7 ');
      var maxP = ps.length ? ps[ps.length - 1] : 0;
      if (prog) prog.style.width = Math.round(((maxP + 1) / N) * 100) + '%';
      var first = cur === 0, last = cur >= spreads.length - 1;
      if (arrowPrev) arrowPrev.disabled = first; if (btnPrev) btnPrev.disabled = first; if (btnFirst) btnFirst.disabled = first;
      if (arrowNext) arrowNext.disabled = last; if (btnNext) btnNext.disabled = last; if (btnLast) btnLast.disabled = last;
    }
    function preload(){
      for (var s = cur - 1; s <= cur + 2; s++){
        if (s < 0 || s >= spreads.length) continue;
        var ps = pagesOf(spreads[s]);
        for (var i = 0; i < ps.length; i++) { var pi = new Image(); pi.src = srcs[ps[i]]; }
      }
    }
    function render(){
      var sp = spreads[cur];
      setImg(imgL, sp.l); setImg(imgR, sp.r);
      book.classList.toggle('dm-cat-has-l', sp.l !== null);
      book.classList.toggle('dm-cat-has-r', sp.r !== null);
      applyShift(sp);
      updateBar(); preload(); trackSpread(sp);
    }
    function crossfade(target){
      animating = true;
      book.classList.add('dm-cat-fade');
      setTimeout(function(){ cur = target; render(); book.classList.remove('dm-cat-fade'); animating = false; }, 180);
    }
    function go(target){
      if (animating || target < 0 || target >= spreads.length || target === cur) return;
      var from = spreads[cur], to = spreads[target], dir = target > cur ? 1 : -1;
      if (!dual || reduce || Math.abs(target - cur) > 1) { crossfade(target); return; }
      animating = true;
      if (dir > 0) {
        // 다음: 오른쪽 낱장이 책등을 축으로 넘어간다. 앞면 = 지금 오른쪽 · 뒷면 = 다음 왼쪽 · 아래에는 다음 오른쪽이 미리 깔린다.
        setImg(imgF, from.r); setImg(imgB, to.l); setImg(imgR, to.r);
        book.classList.toggle('dm-cat-has-r', to.r !== null);
        sheet.className = 'dm-cat-sheet dm-cat-next';
      } else {
        setImg(imgF, from.l); setImg(imgB, to.r); setImg(imgL, to.l);
        book.classList.toggle('dm-cat-has-l', to.l !== null);
        sheet.className = 'dm-cat-sheet dm-cat-prev';
      }
      sheet.hidden = false;
      applyShift(to);
      requestAnimationFrame(function(){ requestAnimationFrame(function(){ sheet.classList.add('dm-cat-go'); }); });
      setTimeout(function(){ cur = target; sheet.hidden = true; sheet.className = 'dm-cat-sheet'; render(); animating = false; }, 640);
    }
    function catGo(p){
      if (pcOn) { go(spreadOfPage(p)); return; }
      goToPage(p);
    }
    function setDual(v){
      if (dual === v) return;
      var keep = spreads[cur].r !== null ? spreads[cur].r : spreads[cur].l;
      dual = v; buildSpreads(); cur = spreadOfPage(keep);
      if (btnDual) btnDual.classList.toggle('dm-cat-on', dual);
      if (btnSingle) btnSingle.classList.toggle('dm-cat-on', !dual);
      layout(); render();
    }
    function setFit(v){
      fitW = v;
      root.classList.toggle('dm-cat-fitw', fitW);
      if (btnFit) { btnFit.classList.toggle('dm-cat-on', fitW); btnFit.title = fitW ? '화면에 맞춤' : '폭 맞춤(확대)'; }
      if (fitLabel) fitLabel.textContent = fitW ? '맞춤' : '확대';
      layout();
      if (!fitW) stage.scrollTop = 0;
    }
    function buildGrid(){
      if (gridBuilt || !gridBody) return; gridBuilt = true;
      var html = '';
      for (var i = 0; i < N; i++) {
        html += '<button type="button" class="dm-cat-thumb" data-p="' + i + '"><div class="dm-cat-ph"><img loading="lazy" alt="" src="' + srcs[i].split('"').join('&quot;') + '"></div><span class="dm-cat-num">' + (i + 1) + '</span></button>';
      }
      gridBody.innerHTML = html;
      gridBody.addEventListener('click', function(e){
        var b = e.target.closest ? e.target.closest('.dm-cat-thumb') : null; if (!b) return;
        closeGrid(); catGo(parseInt(b.getAttribute('data-p'), 10));
      });
    }
    function openGrid(){
      if (!ov) return;
      buildGrid();
      var curPages = pcOn ? pagesOf(spreads[cur]) : [currentIdx];
      var kids = gridBody ? gridBody.children : [];
      for (var i = 0; i < kids.length; i++) { var p = parseInt(kids[i].getAttribute('data-p'), 10); kids[i].classList.toggle('dm-cat-cur', curPages.indexOf(p) >= 0); }
      ov.classList.add('dm-cat-open'); ov.setAttribute('aria-hidden', 'false');
      var c = gridBody ? gridBody.querySelector('.dm-cat-cur') : null;
      if (c && c.scrollIntoView) setTimeout(function(){ try { c.scrollIntoView({ block: 'center' }); } catch (e) {} }, 60);
    }
    function closeGrid(){ if (!ov) return; ov.classList.remove('dm-cat-open'); ov.setAttribute('aria-hidden', 'true'); }
    function openHelp(){ if (!helpBox) return; helpBox.classList.add('dm-cat-open'); helpBox.setAttribute('aria-hidden', 'false'); }
    function closeHelp(){ if (!helpBox) return; helpBox.classList.remove('dm-cat-open'); helpBox.setAttribute('aria-hidden', 'true'); }
    function isOpen(el){ return !!(el && el.classList.contains('dm-cat-open')); }
    function toggleFull(){
      var d = document, el = d.documentElement;
      var on = d.fullscreenElement || d.webkitFullscreenElement;
      try {
        if (on) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); }
        else { (el.requestFullscreen || el.webkitRequestFullscreen).call(el); }
      } catch (e) {}
    }
    function onFullChange(){
      var on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      var icOn = q('icFullOn'), icOff = q('icFullOff');
      if (icOn) icOn.style.display = on ? 'none' : '';
      if (icOff) icOff.style.display = on ? '' : 'none';
      if (btnFull) btnFull.title = on ? '전체화면 끄기' : '전체화면';
      setTimeout(layout, 50);
    }
    document.addEventListener('fullscreenchange', onFullChange);
    document.addEventListener('webkitfullscreenchange', onFullChange);

    if (arrowPrev) arrowPrev.addEventListener('click', function(){ go(cur - 1); });
    if (arrowNext) arrowNext.addEventListener('click', function(){ go(cur + 1); });
    if (btnPrev) btnPrev.addEventListener('click', function(){ go(cur - 1); });
    if (btnNext) btnNext.addEventListener('click', function(){ go(cur + 1); });
    if (btnFirst) btnFirst.addEventListener('click', function(){ go(0); });
    if (btnLast) btnLast.addEventListener('click', function(){ go(spreads.length - 1); });
    if (btnGrid) btnGrid.addEventListener('click', openGrid);
    if (mgrid) mgrid.addEventListener('click', openGrid);
    if (ovClose) ovClose.addEventListener('click', closeGrid);
    if (ov) ov.addEventListener('click', function(e){ if (e.target === ov) closeGrid(); });
    if (btnHelp) btnHelp.addEventListener('click', openHelp);
    if (helpClose) helpClose.addEventListener('click', closeHelp);
    if (helpBox) helpBox.addEventListener('click', function(e){ if (e.target === helpBox) closeHelp(); });
    if (btnDual) btnDual.addEventListener('click', function(){ setDual(true); });
    if (btnSingle) btnSingle.addEventListener('click', function(){ setDual(false); });
    if (btnFit) btnFit.addEventListener('click', function(){ setFit(!fitW); });
    if (btnFull) btnFull.addEventListener('click', toggleFull);

    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape') { if (isOpen(ov)) closeGrid(); else if (isOpen(helpBox)) closeHelp(); else if (pcOn && fitW) setFit(false); return; }
      if (!pcOn) return;
      var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (isOpen(ov) || isOpen(helpBox)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(cur + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(cur - 1); }
      else if (e.key === 'Home') { e.preventDefault(); go(0); }
      else if (e.key === 'End') { e.preventDefault(); go(spreads.length - 1); }
    });
    var lastWheel = 0;
    stage.addEventListener('wheel', function(e){
      if (!pcOn || fitW) return;
      e.preventDefault();
      var now = Date.now(); if (now - lastWheel < 480) return; lastWheel = now;
      if (e.deltaY > 0 || e.deltaX > 0) go(cur + 1); else go(cur - 1);
    }, { passive: false });
    var px = null, py = null;
    stage.addEventListener('pointerdown', function(e){ if (e.button !== 0) return; px = e.clientX; py = e.clientY; });
    stage.addEventListener('pointerup', function(e){
      if (px === null) return;
      var dx = e.clientX - px, dy = e.clientY - py; px = null;
      if (!pcOn || fitW) return;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) go(cur + 1); else go(cur - 1); }
    });
    stage.addEventListener('dblclick', function(e){
      if (!pcOn) return;
      var wasFit = !fitW;
      var rr = stage.getBoundingClientRect();
      var rel = (e.clientY - rr.top) / Math.max(1, rr.height);
      setFit(wasFit);
      if (wasFit) requestAnimationFrame(function(){ stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) * rel); });
    });
    // 가만히 두면 컨트롤이 흐려진다
    var idleT = null;
    function wake(){ root.classList.remove('dm-cat-dim'); clearTimeout(idleT); idleT = setTimeout(function(){ if (!isOpen(ov) && !isOpen(helpBox)) root.classList.add('dm-cat-dim'); }, 3200); }
    var wakeEvents = ['mousemove', 'pointerdown', 'keydown', 'wheel'];
    for (var w = 0; w < wakeEvents.length; w++) root.addEventListener(wakeEvents[w], wake, { passive: true });

    function applyMode(){
      var pc = isPc();
      if (pc === pcOn) return;
      pcOn = pc; dmCatalogOn = pc;
      document.body.classList.toggle('dm-cat-pc', pc);
      if (pc) { buildSpreads(); cur = spreadOfPage(currentIdx); layout(); render(); wake(); }
      else if (typeof setViewportHeight === 'function') { setViewportHeight(); }
    }
    var rT = null;
    window.addEventListener('resize', function(){ clearTimeout(rT); rT = setTimeout(function(){ applyMode(); if (pcOn) layout(); }, 80); });
    window.addEventListener('orientationchange', function(){ setTimeout(function(){ applyMode(); if (pcOn) layout(); }, 120); });

    buildSpreads();
    applyMode();
    if (pcOn && hint) {
      setTimeout(function(){ hint.classList.add('dm-cat-show'); }, 700);
      setTimeout(function(){ hint.classList.remove('dm-cat-show'); }, 5200);
    }
  })();
  /* dm-cat:end */
`;
}
