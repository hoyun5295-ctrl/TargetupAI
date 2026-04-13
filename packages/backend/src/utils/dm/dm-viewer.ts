/**
 * dm-viewer.ts — 모바일 DM 공개 뷰어 HTML 렌더러
 *
 * 인라인 HTML/CSS/JS로 서버사이드 렌더링.
 * 외부 CDN 의존 없음. 터치 스와이프 + 열람 추적.
 */
import fs from 'fs';
import path from 'path';

const DM_IMAGE_DIR = path.join(process.cwd(), 'uploads', 'dm-images');

// ────────────────── YouTube URL → embed 변환 ──────────────────

function youtubeEmbedUrl(url: string): string | null {
  if (!url) return null;
  // youtube.com/watch?v=XXX
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}?rel=0&playsinline=1`;
  // 이미 embed URL
  if (url.includes('youtube.com/embed/')) return url;
  return null;
}

// ────────────────── 이미지 base64 인라인 ──────────────────

function inlineImage(src: string): string {
  if (!src || src.startsWith('data:') || src.startsWith('http')) return src;
  // /api/dm/images/{companyId}/{filename}
  const m = src.match(/\/api\/dm\/images\/([^/]+)\/([^/]+)$/);
  if (!m) return src;
  const filePath = path.join(DM_IMAGE_DIR, m[1], m[2]);
  if (!fs.existsSync(filePath)) return src;
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ────────────────── 헤더 템플릿 3종 ──────────────────

function renderHeader(template: string, data: any, storeName: string): string {
  const d = data || {};
  switch (template) {
    case 'brand':
      return `<div style="background:${d.bgColor || '#1a1a1a'};color:#fff;padding:32px 20px;text-align:center">
        ${d.logoUrl ? `<img src="${d.logoUrl}" style="max-height:48px;margin-bottom:12px" alt="">` : ''}
        <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px">${storeName || ''}</div>
        ${d.slogan ? `<div style="font-size:13px;opacity:0.7;margin-top:6px">${d.slogan}</div>` : ''}
      </div>`;
    case 'minimal':
      return `<div style="padding:16px 20px;border-bottom:1px solid #eee">
        <div style="font-size:15px;font-weight:700;color:#333">${storeName || ''}</div>
      </div>`;
    default: // 'default'
      return `<div style="background:#fff;padding:16px 20px;border-bottom:2px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:10px">
          ${d.logoUrl ? `<img src="${d.logoUrl}" style="height:32px;border-radius:6px" alt="">` : ''}
          <div style="font-size:16px;font-weight:700;color:#222">${storeName || ''}</div>
        </div>
        ${d.phone ? `<a href="tel:${d.phone}" style="font-size:13px;color:#666;text-decoration:none">${d.phone}</a>` : ''}
      </div>`;
  }
}

// ────────────────── 푸터 템플릿 3종 ──────────────────

function renderFooter(template: string, data: any, storeName: string): string {
  const d = data || {};
  switch (template) {
    case 'contact':
      return `<div style="background:#f8f8f8;padding:20px;text-align:center;border-top:1px solid #eee">
        ${d.hours ? `<div style="font-size:13px;color:#666;margin-bottom:6px">영업시간: ${d.hours}</div>` : ''}
        ${d.phone ? `<div style="font-size:13px;color:#666;margin-bottom:6px">${d.phone}</div>` : ''}
        ${d.mapUrl ? `<a href="${d.mapUrl}" style="font-size:13px;color:#2563eb;text-decoration:underline" target="_blank">매장 위치 보기</a>` : ''}
      </div>`;
    case 'social':
      return `<div style="background:#f8f8f8;padding:20px;text-align:center;border-top:1px solid #eee">
        <div style="font-size:12px;color:#999;margin-bottom:8px">${storeName || ''}</div>
        <div style="display:flex;justify-content:center;gap:16px">
          ${d.instagram ? `<a href="${d.instagram}" style="font-size:13px;color:#e1306c" target="_blank">Instagram</a>` : ''}
          ${d.kakao ? `<a href="${d.kakao}" style="font-size:13px;color:#fae100" target="_blank">카카오</a>` : ''}
          ${d.blog ? `<a href="${d.blog}" style="font-size:13px;color:#03c75a" target="_blank">블로그</a>` : ''}
        </div>
      </div>`;
    default: // 'default'
      return `<div style="background:#f8f8f8;padding:16px 20px;text-align:center;border-top:1px solid #eee">
        ${d.address ? `<div style="font-size:12px;color:#888">${d.address}</div>` : ''}
        ${d.phone ? `<div style="font-size:12px;color:#888;margin-top:4px">${d.phone}</div>` : ''}
        <div style="font-size:11px;color:#bbb;margin-top:8px">&copy; ${storeName || ''}</div>
      </div>`;
  }
}

// ────────────────── 메인 뷰어 HTML ──────────────────

export function renderDmViewerHtml(dm: any, trackApiBase: string): string {
  const pages: any[] = Array.isArray(dm.pages) ? dm.pages : (typeof dm.pages === 'string' ? JSON.parse(dm.pages) : []);
  const headerData = typeof dm.header_data === 'string' ? JSON.parse(dm.header_data) : (dm.header_data || {});
  const footerData = typeof dm.footer_data === 'string' ? JSON.parse(dm.footer_data) : (dm.footer_data || {});
  const storeName = dm.store_name || '';
  const title = dm.title || '모바일 DM';
  const totalPages = pages.length;

  const slidesHtml = pages.sort((a: any, b: any) => (a.order || 0) - (b.order || 0)).map((p: any, i: number) => {
    const imgSrc = p.imageUrl ? inlineImage(p.imageUrl) : '';
    const embedUrl = p.videoUrl ? youtubeEmbedUrl(p.videoUrl) : null;

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
  var CODE = '${dm.short_code || ''}';
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

// ────────────────── 만료/404 에러 페이지 ──────────────────

export function renderDmErrorHtml(message: string): string {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>모바일 DM</title>
<style>body{font-family:'Noto Sans KR',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f5;margin:0}
.msg{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.08)}
.msg h2{font-size:18px;color:#333;margin-bottom:8px}.msg p{font-size:14px;color:#888}</style></head>
<body><div class="msg"><h2>😔</h2><p>${message}</p></div></body></html>`;
}
