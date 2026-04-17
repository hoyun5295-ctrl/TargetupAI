/**
 * dm-viewer.ts — 모바일 DM 공개 뷰어 HTML 렌더러
 *
 * D119: 슬라이드 기반 (pages[])
 * D125: 섹션 기반 세로 스크롤 (sections[]) 추가 — layout_mode로 분기
 *
 * 인라인 HTML/CSS/JS로 서버사이드 렌더링.
 * 이미지: base64 인라인 (외부 CDN 의존 최소화).
 * 폰트: Pretendard CDN + 시스템 폰트 fallback 체인.
 */
import { inlineImage, youtubeEmbedUrl } from './dm-viewer-utils';
import { renderSections, COUNTDOWN_SCRIPT, escapeHtml } from './dm-section-renderer';
import { renderDmTokensCss, renderDmBaseCss } from './dm-tokens';
import { resolveSections } from './dm-variable-resolver';
import type { Section } from './dm-section-registry';
import type { DmBrandKit } from './dm-tokens';

export { inlineImage, youtubeEmbedUrl };

// ────────────────── 헤더 템플릿 4종 ──────────────────

function renderHeader(template: string, data: any, storeName: string): string {
  const d = data || {};
  switch (template) {
    case 'banner':
      return ''; // 풀 배너는 첫 페이지 이미지가 대체하므로 헤더 없음
    case 'countdown':
      const eventDate = d.eventDate ? new Date(d.eventDate) : null;
      const dday = eventDate ? Math.ceil((eventDate.getTime() - Date.now()) / 86400000) : 0;
      const ddayText = dday > 0 ? `D-${dday}` : dday === 0 ? 'D-Day' : `D+${Math.abs(dday)}`;
      return `<div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:24px 20px;text-align:center">
        <div style="font-size:36px;font-weight:900;letter-spacing:2px">${ddayText}</div>
        ${d.eventTitle ? `<div style="font-size:14px;opacity:0.9;margin-top:8px;font-weight:500">${d.eventTitle}</div>` : ''}
        <div style="font-size:12px;opacity:0.6;margin-top:4px">${storeName || ''}</div>
      </div>`;
    case 'coupon':
      return `<div style="background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);color:#fff;padding:24px 20px;text-align:center">
        ${d.discount ? `<div style="font-size:16px;font-weight:700;margin-bottom:6px">${d.discount}</div>` : ''}
        ${d.couponCode ? `<div style="background:rgba(255,255,255,0.25);display:inline-block;padding:8px 24px;border-radius:8px;font-size:20px;font-weight:900;letter-spacing:3px;font-family:monospace">${d.couponCode}</div>` : ''}
        <div style="font-size:11px;opacity:0.7;margin-top:8px">${storeName || ''}</div>
      </div>`;
    default: // 'logo'
      return `<div style="background:#fff;padding:16px 20px;border-bottom:2px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:10px">
          ${d.logoUrl ? `<img src="${d.logoUrl}" style="height:32px;border-radius:6px" alt="">` : ''}
          <div style="font-size:16px;font-weight:700;color:#222">${storeName || ''}</div>
        </div>
        ${d.phone ? `<a href="tel:${d.phone}" style="font-size:13px;color:#666;text-decoration:none">${d.phone}</a>` : ''}
      </div>`;
  }
}

// ────────────────── 푸터 템플릿 4종 ──────────────────

function renderFooter(template: string, data: any, storeName: string): string {
  const d = data || {};
  switch (template) {
    case 'cta':
      const ctaColor = d.ctaColor || '#4f46e5';
      return `<div style="padding:20px;text-align:center;border-top:1px solid #eee">
        ${d.ctaUrl ? `<a href="${d.ctaUrl}" style="display:inline-block;background:${ctaColor};color:#fff;padding:14px 48px;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.5px" target="_blank">${d.ctaText || '자세히 보기'}</a>` :
        `<div style="background:${ctaColor};color:#fff;padding:14px 48px;border-radius:12px;font-size:16px;font-weight:700;display:inline-block">${d.ctaText || '자세히 보기'}</div>`}
      </div>`;
    case 'social':
      return `<div style="background:#f8f8f8;padding:20px;text-align:center;border-top:1px solid #eee">
        <div style="font-size:12px;color:#999;margin-bottom:10px">${storeName || ''}</div>
        <div style="display:flex;justify-content:center;gap:20px">
          ${d.instagram ? `<a href="${d.instagram}" style="font-size:13px;color:#e1306c;font-weight:500" target="_blank">Instagram</a>` : ''}
          ${d.youtube ? `<a href="${d.youtube}" style="font-size:13px;color:#ff0000;font-weight:500" target="_blank">YouTube</a>` : ''}
          ${d.kakao ? `<a href="${d.kakao}" style="font-size:13px;color:#371d1e;font-weight:500" target="_blank">카카오</a>` : ''}
        </div>
      </div>`;
    case 'promo':
      return `<div style="background:linear-gradient(135deg,#ffecd2 0%,#fcb69f 100%);padding:24px 20px;text-align:center;border-top:1px solid #eee">
        ${d.promoDesc ? `<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:8px">${d.promoDesc}</div>` : ''}
        ${d.promoCode ? `<div style="background:#fff;display:inline-block;padding:8px 24px;border-radius:8px;font-size:18px;font-weight:900;letter-spacing:2px;font-family:monospace;color:#e74c3c;border:2px dashed #e74c3c">${d.promoCode}</div>` : ''}
        ${d.promoUrl ? `<div style="margin-top:12px"><a href="${d.promoUrl}" style="font-size:13px;color:#e74c3c;font-weight:600;text-decoration:underline" target="_blank">지금 사용하기 →</a></div>` : ''}
      </div>`;
    default: // 'cs'
      return `<div style="background:#f8f8f8;padding:20px;text-align:center;border-top:1px solid #eee">
        ${d.website ? `<a href="${d.website}" style="font-size:12px;color:#2563eb;text-decoration:none" target="_blank">${d.website.replace(/^https?:\/\//, '')}</a>` : ''}
        ${d.phone ? `<div style="font-size:12px;color:#888;margin-top:4px">고객센터 ${d.phone}</div>` : ''}
        ${d.email ? `<div style="font-size:12px;color:#888;margin-top:2px">${d.email}</div>` : ''}
        <div style="font-size:11px;color:#bbb;margin-top:8px">&copy; ${storeName || ''}</div>
      </div>`;
  }
}

// ────────────────── 레거시 슬라이드 뷰어 (D119 기본형 하위호환) ──────────────────

function renderLegacySlidesHtml(dm: any, trackApiBase: string): string {
  const pages: any[] = Array.isArray(dm.pages) ? dm.pages : (typeof dm.pages === 'string' ? JSON.parse(dm.pages) : []);
  const headerData = typeof dm.header_data === 'string' ? JSON.parse(dm.header_data) : (dm.header_data || {});
  const footerData = typeof dm.footer_data === 'string' ? JSON.parse(dm.footer_data) : (dm.footer_data || {});
  const storeName = dm.store_name || '';
  const title = dm.title || '모바일 DM';
  const totalPages = pages.length;

  const slidesHtml = pages.sort((a: any, b: any) => (a.order || 0) - (b.order || 0)).map((p: any, i: number) => {
    const imgSrc = p.imageUrl ? inlineImage(p.imageUrl) : '';
    const embedUrl = p.videoUrl ? youtubeEmbedUrl(p.videoUrl) : null;
    const layout = p.layout || 'full-image';

    // text-card 레이아웃
    if (layout === 'text-card') {
      return `<div class="dm-slide" data-page="${i + 1}">
        <div style="min-height:400px;background:${p.bgColor || '#1a1a2e'};color:${p.textColor || '#fff'};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center">
          ${p.heading ? `<div style="font-size:24px;font-weight:800;line-height:1.4">${p.heading}</div>` : ''}
          ${p.caption ? `<div style="font-size:14px;opacity:0.8;margin-top:12px;line-height:1.6">${p.caption}</div>` : ''}
        </div>
      </div>`;
    }

    // cta-card 레이아웃
    if (layout === 'cta-card') {
      return `<div class="dm-slide" data-page="${i + 1}">
        ${imgSrc ? `<img src="${imgSrc}" alt="" style="width:100%;display:block;object-fit:cover">` : ''}
        ${p.caption ? `<div style="padding:12px 16px;font-size:14px;color:#333;line-height:1.6">${p.caption}</div>` : ''}
        ${p.ctaUrl ? `<div style="padding:8px 16px 16px;text-align:center">
          <a href="${p.ctaUrl}" target="_blank" style="display:inline-block;background:#4f46e5;color:#fff;padding:14px 48px;border-radius:12px;font-size:15px;font-weight:700;text-decoration:none">${p.ctaText || '자세히 보기'}</a>
        </div>` : (p.ctaText ? `<div style="padding:8px 16px 16px;text-align:center">
          <div style="display:inline-block;background:#4f46e5;color:#fff;padding:14px 48px;border-radius:12px;font-size:15px;font-weight:700">${p.ctaText}</div>
        </div>` : '')}
      </div>`;
    }

    // full-image / video (기본)
    return `<div class="dm-slide" data-page="${i + 1}">
      ${imgSrc ? `<img src="${imgSrc}" alt="" style="width:100%;display:block;object-fit:cover">` : ''}
      ${embedUrl ? `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:${imgSrc ? '12px 0 0' : '0'}">
        <iframe src="${embedUrl}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" allowfullscreen></iframe>
      </div>` : ''}
      ${(p.videoUrl && !embedUrl) ? `<video src="${p.videoUrl}" controls playsinline style="width:100%;display:block;margin-top:${imgSrc ? '12px' : '0'}"></video>` : ''}
      ${p.caption ? `<div style="padding:12px 16px;font-size:14px;color:#333;line-height:1.6">${p.caption}</div>` : ''}
    </div>`;
  }).join('');

  const dotsHtml = pages.map((_: any, i: number) =>
    `<span class="dot${i === 0 ? ' active' : ''}" data-idx="${i}"></span>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<title>${storeName} - ${title}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans KR',sans-serif;background:#fff;overflow-x:hidden;-webkit-text-size-adjust:100%}
#dm-wrap{max-width:480px;margin:0 auto;min-height:100vh;background:#fff;position:relative}
#dm-slider-wrap{overflow:hidden;position:relative;touch-action:pan-y}
#dm-slider{display:flex;transition:transform 0.3s ease-out;will-change:transform}
.dm-slide{min-width:100%;flex-shrink:0}
.dm-slide img{max-width:100%;height:auto}
#dm-dots{text-align:center;padding:12px 0}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ddd;margin:0 4px;transition:all 0.2s}
.dot.active{background:#333;width:20px;border-radius:4px}
#dm-nav{display:flex;justify-content:space-between;position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);pointer-events:none;padding:0 8px}
.nav-btn{pointer-events:auto;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,0.25);color:#fff;border:none;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s}
.nav-btn:hover{background:rgba(0,0,0,0.5)}
.nav-btn:disabled{opacity:0;pointer-events:none}
#page-counter{position:absolute;top:12px;right:12px;background:rgba(0,0,0,0.5);color:#fff;font-size:12px;padding:4px 10px;border-radius:12px;z-index:5}
</style>
</head>
<body>
<div id="dm-wrap">
  ${renderHeader(dm.header_template || 'default', headerData, storeName)}

  <div id="dm-slider-wrap">
    <div id="page-counter">1 / ${totalPages}</div>
    <div id="dm-slider">${slidesHtml}</div>
    ${totalPages > 1 ? `<div id="dm-nav">
      <button class="nav-btn" id="prev-btn" disabled>&lsaquo;</button>
      <button class="nav-btn" id="next-btn">&rsaquo;</button>
    </div>` : ''}
  </div>

  ${totalPages > 1 ? `<div id="dm-dots">${dotsHtml}</div>` : ''}

  ${renderFooter(dm.footer_template || 'default', footerData, storeName)}
</div>

<script>
(function(){
  var slider = document.getElementById('dm-slider');
  var wrap = document.getElementById('dm-slider-wrap');
  var dots = document.querySelectorAll('.dot');
  var counter = document.getElementById('page-counter');
  var prevBtn = document.getElementById('prev-btn');
  var nextBtn = document.getElementById('next-btn');
  var total = ${totalPages};
  var current = 0;
  var startX = 0, diffX = 0, dragging = false;
  var startTime = Date.now();
  var CODE = 'dm-${dm.short_code || ''}';
  var TRACK_URL = '${trackApiBase}';
  var PHONE = new URLSearchParams(location.search).get('p') || '';

  function goTo(idx) {
    if (idx < 0 || idx >= total) return;
    current = idx;
    slider.style.transform = 'translateX(-' + (current * 100) + '%)';
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('active', i === current);
    if (counter) counter.textContent = (current + 1) + ' / ' + total;
    if (prevBtn) prevBtn.disabled = current === 0;
    if (nextBtn) nextBtn.disabled = current === total - 1;
    track(current + 1);
  }

  function track(pageNum) {
    if (!CODE) return;
    var dur = Math.round((Date.now() - startTime) / 1000);
    var body = JSON.stringify({ phone: PHONE, page_reached: pageNum, total_pages: total, duration: dur });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(TRACK_URL + '/' + CODE + '/track', new Blob([body], {type:'application/json'}));
    } else {
      fetch(TRACK_URL + '/' + CODE + '/track', { method:'POST', headers:{'Content-Type':'application/json'}, body: body, keepalive: true }).catch(function(){});
    }
  }

  // 터치 스와이프
  if (wrap) {
    wrap.addEventListener('touchstart', function(e) {
      startX = e.touches[0].clientX; diffX = 0; dragging = true;
      slider.style.transition = 'none';
    }, {passive:true});
    wrap.addEventListener('touchmove', function(e) {
      if (!dragging) return;
      diffX = e.touches[0].clientX - startX;
      var offset = -(current * wrap.offsetWidth) + diffX;
      slider.style.transform = 'translateX(' + offset + 'px)';
    }, {passive:true});
    wrap.addEventListener('touchend', function() {
      dragging = false;
      slider.style.transition = 'transform 0.3s ease-out';
      if (Math.abs(diffX) > 50) {
        if (diffX < 0 && current < total - 1) goTo(current + 1);
        else if (diffX > 0 && current > 0) goTo(current - 1);
        else goTo(current);
      } else {
        goTo(current);
      }
    });
  }

  // 버튼 내비게이션
  if (prevBtn) prevBtn.addEventListener('click', function() { goTo(current - 1); });
  if (nextBtn) nextBtn.addEventListener('click', function() { goTo(current + 1); });

  // 페이지 이탈 시 최종 추적
  window.addEventListener('beforeunload', function() { track(current + 1); });

  // 초기 추적
  track(1);
})();
</script>
</body>
</html>`;
}

// ────────────────── 섹션 기반 세로 스크롤 뷰어 (D125 프로모델) ──────────────────

function parseSections(raw: any): Section[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Section[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Section[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseBrandKit(raw: any): DmBrandKit | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as DmBrandKit; } catch { return undefined; }
  }
  if (typeof raw === 'object') return raw as DmBrandKit;
  return undefined;
}

type SectionsLayoutMode = 'scroll' | 'scroll_snap' | 'slides';

function renderSectionsHtml(
  dm: any,
  trackApiBase: string,
  resolvedSections?: Section[],
  mode: SectionsLayoutMode = 'scroll',
): string {
  const sections: Section[] = resolvedSections || parseSections(dm.sections);
  const brandKit: DmBrandKit | undefined = parseBrandKit(dm.brand_kit);
  const storeName = dm.store_name || '';
  const title = dm.title || '모바일 DM';
  const shortCode = dm.short_code || '';

  const hasCountdown = sections.some(s => s.type === 'countdown');
  const totalSections = sections.length;

  const sectionsHtml = renderSections(sections, {
    brandKit,
    storeName,
    trackApiBase,
    shortCode,
    isPreview: !!resolvedSections,
  });

  const tokensCss = renderDmTokensCss(brandKit);
  const baseCss = renderDmBaseCss();

  // 모드별 뷰어 CSS (body / .dm-viewer / .dm-section-wrap)
  const modeCss = (() => {
    if (mode === 'scroll_snap') {
      return `
html,body{height:100%;margin:0;overflow:hidden}
.dm-viewer{height:100%;overflow-y:auto;overflow-x:hidden;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.dm-viewer::-webkit-scrollbar{display:none}
.dm-section-wrap{min-height:100vh;scroll-snap-align:start;scroll-snap-stop:always;display:flex;flex-direction:column;justify-content:center;position:relative}
.dm-page-dots{position:fixed;right:10px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:6px;z-index:50}
.dm-page-dots .dot{width:6px;height:6px;border-radius:50%;background:rgba(0,0,0,0.25);transition:all 200ms}
.dm-page-dots .dot.active{background:var(--dm-primary);height:20px;border-radius:3px}
`;
    }
    if (mode === 'slides') {
      return `
html,body{height:100%;margin:0;overflow:hidden;touch-action:pan-y}
.dm-viewer{height:100%;display:flex;flex-direction:row;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.dm-viewer::-webkit-scrollbar{display:none}
.dm-section-wrap{flex:0 0 100%;width:100vw;height:100vh;scroll-snap-align:start;scroll-snap-stop:always;overflow-y:auto;position:relative;-webkit-overflow-scrolling:touch}
.dm-section-wrap::-webkit-scrollbar{display:none}
.dm-page-dots{position:fixed;left:0;right:0;bottom:14px;display:flex;flex-direction:row;gap:6px;justify-content:center;z-index:50}
.dm-page-dots .dot{width:6px;height:6px;border-radius:50%;background:rgba(0,0,0,0.25);transition:all 200ms}
.dm-page-dots .dot.active{background:var(--dm-primary);width:20px;border-radius:3px}
.dm-page-counter{position:fixed;top:12px;right:12px;background:rgba(0,0,0,0.55);color:#fff;font-size:11px;padding:4px 10px;border-radius:12px;z-index:60}
`;
    }
    return `
.dm-section-wrap{position:relative}
`;
  })();

  const dotsHtml =
    mode !== 'scroll' && totalSections > 0
      ? `<div class="dm-page-dots">${sections.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}" data-idx="${i}"></span>`).join('')}</div>`
      : '';
  const counterHtml =
    mode === 'slides' && totalSections > 0
      ? `<div class="dm-page-counter"><span id="dm-cur">1</span> / ${totalSections}</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<meta name="format-detection" content="telephone=no">
<title>${escapeHtml(storeName ? `${storeName} - ${title}` : title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" onerror="this.remove()">
<style>
${tokensCss}
${baseCss}
.cd-unit{background:rgba(255,255,255,0.1);border-radius:var(--dm-radius-md);padding:var(--dm-sp-3) var(--dm-sp-4);min-width:64px}
.cd-num{font-size:var(--dm-fs-h1);font-weight:900;font-family:var(--dm-font-mono);color:#fff}
.cd-lbl{font-size:var(--dm-fs-tiny);opacity:0.8;margin-top:2px}
${modeCss}
</style>
</head>
<body data-layout-mode="${mode}">
<div class="dm-viewer">
${sectionsHtml}
</div>
${dotsHtml}
${counterHtml}

<script>
(function(){
  var CODE = 'dm-${escapeHtml(shortCode)}';
  var TRACK_URL = '${escapeHtml(trackApiBase)}';
  var PHONE = new URLSearchParams(location.search).get('p') || '';
  var MODE = document.body.getAttribute('data-layout-mode') || 'scroll';
  var TOTAL = ${totalSections};
  var startTime = Date.now();
  var sectionInteractions = {};
  var pageReached = 1;
  var currentIdx = 0;
  var wraps = Array.prototype.slice.call(document.querySelectorAll('.dm-section-wrap'));
  var dots = Array.prototype.slice.call(document.querySelectorAll('.dm-page-dots .dot'));
  var counter = document.getElementById('dm-cur');

  function sendTrack(extra) {
    if (!CODE) return;
    var dur = Math.round((Date.now() - startTime) / 1000);
    var body = JSON.stringify(Object.assign({
      phone: PHONE,
      page_reached: pageReached,
      total_pages: TOTAL || 1,
      duration: dur,
      section_interactions: sectionInteractions
    }, extra || {}));
    if (navigator.sendBeacon) {
      navigator.sendBeacon(TRACK_URL + '/' + CODE + '/track', new Blob([body], {type:'application/json'}));
    } else {
      fetch(TRACK_URL + '/' + CODE + '/track', { method:'POST', headers:{'Content-Type':'application/json'}, body: body, keepalive: true }).catch(function(){});
    }
  }

  function updateCurrent(idx) {
    if (idx < 0 || idx >= wraps.length) return;
    currentIdx = idx;
    if (idx + 1 > pageReached) pageReached = idx + 1;
    dots.forEach(function(d, i){ d.classList.toggle('active', i === idx); });
    if (counter) counter.textContent = String(idx + 1);
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function(entries){
      var best = null;
      entries.forEach(function(e){
        if (e.isIntersecting) {
          var sid = e.target.getAttribute('data-section-id');
          if (sid) {
            sectionInteractions[sid] = sectionInteractions[sid] || { views: 0, clicks: 0 };
            sectionInteractions[sid].views++;
          }
          if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
        }
      });
      if (best) {
        var idx = wraps.indexOf(best.target);
        if (idx >= 0) updateCurrent(idx);
      }
    }, { threshold: [0.3, 0.6, 0.9] });
    wraps.forEach(function(el){ io.observe(el); });
  }

  // dots 클릭 → 해당 섹션으로 이동
  dots.forEach(function(d, i){
    d.addEventListener('click', function(){
      if (!wraps[i]) return;
      if (MODE === 'slides') {
        var viewer = document.querySelector('.dm-viewer');
        if (viewer) viewer.scrollTo({ left: i * viewer.clientWidth, behavior: 'smooth' });
      } else {
        wraps[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  document.addEventListener('click', function(e){
    var wrap = e.target.closest && e.target.closest('.dm-section-wrap');
    if (wrap) {
      var sid = wrap.getAttribute('data-section-id');
      if (sid) {
        sectionInteractions[sid] = sectionInteractions[sid] || { views: 0, clicks: 0 };
        sectionInteractions[sid].clicks++;
      }
    }
  }, true);

  window.addEventListener('beforeunload', function(){ sendTrack(); });
  sendTrack();
})();
${hasCountdown ? COUNTDOWN_SCRIPT : ''}
</script>
</body>
</html>`;
}

// ────────────────── 메인 디스패처 (layout_mode 분기) ──────────────────

/**
 * DM layout_mode별 분기:
 *   - scroll      : 섹션 기반 긴 세로 스크롤
 *   - scroll_snap : 섹션 기반 세로 페이지 스냅 (1섹션=1페이지)
 *   - slides      : 섹션 기반 좌우 슬라이드 (1섹션=1페이지)
 *   - (legacy)    : pages[] 기반 D119 슬라이드 (sections 없을 때 폴백)
 */
function resolveSectionsMode(dm: any, sectionsArr: Section[]): SectionsLayoutMode | null {
  if (sectionsArr.length === 0) return null;
  const m = dm.layout_mode;
  if (m === 'scroll_snap') return 'scroll_snap';
  if (m === 'slides') return 'slides';
  if (m === 'scroll') return 'scroll';
  // 명시적 layout_mode 없지만 sections 존재 → scroll 기본
  return 'scroll';
}

export function renderDmViewerHtml(dm: any, trackApiBase: string): string {
  const sectionsArr = parseSections(dm.sections);
  const mode = resolveSectionsMode(dm, sectionsArr);
  if (mode === null) return renderLegacySlidesHtml(dm, trackApiBase);
  return renderSectionsHtml(dm, trackApiBase, undefined, mode);
}

/**
 * 샘플 고객 데이터로 변수 치환 후 뷰어 HTML 렌더 (에디터 미리보기/검수용).
 * 섹션 기반 3모드 모두 지원. legacy slides(pages[])는 기존 경로 그대로.
 */
export async function renderDmViewerHtmlWithCustomer(
  dm: any,
  trackApiBase: string,
  customer: Record<string, any> | null,
  companyId: string,
): Promise<string> {
  const sectionsArr = parseSections(dm.sections);
  const mode = resolveSectionsMode(dm, sectionsArr);
  if (mode === null) return renderLegacySlidesHtml(dm, trackApiBase);
  const resolved = await resolveSections(sectionsArr, customer, companyId);
  return renderSectionsHtml(dm, trackApiBase, resolved, mode);
}

// ────────────────── 만료/404 에러 페이지 ──────────────────

export function renderDmErrorHtml(message: string): string {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>모바일 DM</title>
<style>body{font-family:'Noto Sans KR',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f5;margin:0}
.msg{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.08)}
.msg h2{font-size:18px;color:#333;margin-bottom:8px}.msg p{font-size:14px;color:#888}</style></head>
<body><div class="msg"><h2>😔</h2><p>${message}</p></div></body></html>`;
}
