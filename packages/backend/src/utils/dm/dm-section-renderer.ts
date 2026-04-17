/**
 * dm-section-renderer.ts — DM 섹션 11종 HTML 렌더러 (Backend)
 *
 * 설계서: status/DM-PRO-DESIGN.md §7 (섹션 시스템) + §8 (디자인 시스템)
 *
 * 소비처:
 *  - dm-viewer.ts (renderSectionsHtml — 세로 스크롤 DM HTML)
 *
 * 재사용 유틸:
 *  - inlineImage / youtubeEmbedUrl → dm-viewer.ts에서 export
 *  - renderDmTokensCss / renderDmBaseCss → dm-tokens.ts
 *
 * 원칙:
 *  - 외부 CDN 의존 최소화 (이미지 base64 인라인, 폰트는 CDN fallback 체인)
 *  - 모든 사용자 입력은 escapeHtml로 이스케이프
 *  - 디자인 토큰은 CSS 변수(var(--dm-*))로 참조
 *  - style_variant는 data 속성으로 전달 (CSS 측에서 상세 매핑)
 */
import type { Section, SectionType, HeaderProps, HeroProps, CouponProps, CountdownProps, TextCardProps, CtaProps, VideoProps, StoreInfoProps, SnsProps, PromoCodeProps, FooterProps } from './dm-section-registry';
import type { DmBrandKit } from './dm-tokens';
import { inlineImage, youtubeEmbedUrl } from './dm-viewer-utils';

// ────────────── 렌더 컨텍스트 ──────────────

export type SectionRenderContext = {
  brandKit?: DmBrandKit;
  storeName?: string;
  trackApiBase?: string;
  shortCode?: string;
  isPreview?: boolean;
};

// ────────────── 보안: HTML 이스케이프 ──────────────

export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return '';
  const s = String(input);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** URL이 안전한 스킴(http/https/tel/mailto)인지 검증. 그 외는 # 로 대체 */
export function safeUrl(url: unknown): string {
  if (!url) return '#';
  const s = String(url).trim();
  if (/^(https?:|tel:|mailto:|#|\/)/i.test(s)) return escapeHtml(s);
  return '#';
}

// ────────────── 섹션 렌더러 (11종) ──────────────

function renderHeader(props: HeaderProps, ctx: SectionRenderContext): string {
  const variant = props.variant || 'logo';
  const brand = escapeHtml(props.brand_name || ctx.storeName || '');

  switch (variant) {
    case 'banner': {
      const img = props.banner_image_url ? inlineImage(props.banner_image_url) : '';
      return `<div class="dm-header dm-header-banner" data-variant="${escapeHtml(variant)}">
        ${img ? `<img src="${escapeHtml(img)}" alt="${brand}" style="width:100%;display:block">` : ''}
      </div>`;
    }
    case 'countdown': {
      const eventDate = props.event_date ? new Date(props.event_date) : null;
      const dday = eventDate ? Math.ceil((eventDate.getTime() - Date.now()) / 86400000) : 0;
      const ddayText = dday > 0 ? `D-${dday}` : dday === 0 ? 'D-Day' : `D+${Math.abs(dday)}`;
      return `<div class="dm-header dm-header-countdown" data-variant="${escapeHtml(variant)}" style="background:linear-gradient(135deg,var(--dm-primary) 0%,var(--dm-primary-hover) 100%);color:#fff;padding:var(--dm-sp-6) var(--dm-sp-5);text-align:center">
        <div style="font-size:36px;font-weight:900;letter-spacing:2px">${escapeHtml(ddayText)}</div>
        ${props.event_title ? `<div style="font-size:var(--dm-fs-small);opacity:0.9;margin-top:var(--dm-sp-2);font-weight:500">${escapeHtml(props.event_title)}</div>` : ''}
        ${brand ? `<div style="font-size:var(--dm-fs-tiny);opacity:0.6;margin-top:var(--dm-sp-1)">${brand}</div>` : ''}
      </div>`;
    }
    case 'coupon': {
      return `<div class="dm-header dm-header-coupon" data-variant="${escapeHtml(variant)}" style="background:linear-gradient(135deg,var(--dm-accent) 0%,var(--dm-primary) 100%);color:#fff;padding:var(--dm-sp-6) var(--dm-sp-5);text-align:center">
        ${props.discount_label ? `<div style="font-size:var(--dm-fs-h3);font-weight:700;margin-bottom:var(--dm-sp-2)">${escapeHtml(props.discount_label)}</div>` : ''}
        ${props.coupon_code ? `<div style="background:rgba(255,255,255,0.25);display:inline-block;padding:var(--dm-sp-2) var(--dm-sp-6);border-radius:var(--dm-radius-md);font-size:var(--dm-fs-h2);font-weight:900;letter-spacing:3px;font-family:var(--dm-font-mono)">${escapeHtml(props.coupon_code)}</div>` : ''}
        ${brand ? `<div style="font-size:var(--dm-fs-tiny);opacity:0.7;margin-top:var(--dm-sp-2)">${brand}</div>` : ''}
      </div>`;
    }
    default: {
      const logo = props.logo_url ? inlineImage(props.logo_url) : '';
      return `<div class="dm-header dm-header-logo" data-variant="${escapeHtml(variant)}" style="background:var(--dm-bg);padding:var(--dm-sp-4) var(--dm-sp-5);border-bottom:1px solid var(--dm-neutral-200);display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:var(--dm-sp-2)">
          ${logo ? `<img src="${escapeHtml(logo)}" alt="${brand}" style="height:32px;border-radius:var(--dm-radius-sm)">` : ''}
          ${brand ? `<div style="font-size:var(--dm-fs-h3);font-weight:700;color:var(--dm-neutral-900)">${brand}</div>` : ''}
        </div>
        ${props.phone ? `<a href="tel:${escapeHtml(props.phone)}" style="font-size:var(--dm-fs-small);color:var(--dm-neutral-500)">${escapeHtml(props.phone)}</a>` : ''}
      </div>`;
    }
  }
}

function renderHero(props: HeroProps): string {
  const img = props.image_url ? inlineImage(props.image_url) : '';
  const heightPx = { sm: '200px', md: '320px', lg: '480px', full: '100vh' }[props.height || 'md'];
  const align = props.align || 'center';
  const textAlign = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  const gradient = props.overlay_gradient !== false ? 'linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,0.5) 100%)' : 'transparent';

  return `<div class="dm-section dm-hero" data-section-type="hero" style="position:relative;min-height:${heightPx};overflow:hidden;background:var(--dm-neutral-900)">
    ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(props.headline || '')}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : ''}
    <div style="position:absolute;inset:0;background:${gradient}"></div>
    <div style="position:relative;min-height:${heightPx};display:flex;flex-direction:column;justify-content:flex-end;align-items:${textAlign};padding:var(--dm-sp-8) var(--dm-sp-5);color:#fff;text-align:${align}">
      ${props.headline ? `<div class="dm-text-hero" style="font-weight:800">${escapeHtml(props.headline)}</div>` : ''}
      ${props.sub_copy ? `<div class="dm-text-body" style="margin-top:var(--dm-sp-3);opacity:0.9">${escapeHtml(props.sub_copy)}</div>` : ''}
    </div>
  </div>`;
}

function renderCoupon(props: CouponProps): string {
  const discountLabel = escapeHtml(props.discount_label || '');
  const code = props.coupon_code ? escapeHtml(props.coupon_code) : '';
  const expire = props.expire_date ? formatKoreanDate(props.expire_date) : '';

  return `<div class="dm-section dm-coupon" data-section-type="coupon" style="padding:var(--dm-sp-6) var(--dm-sp-5);background:var(--dm-primary-light)">
    <div style="background:var(--dm-bg);border:2px dashed var(--dm-primary);border-radius:var(--dm-radius-lg);padding:var(--dm-sp-6);text-align:center">
      <div class="dm-text-hero" style="color:var(--dm-primary);font-weight:900">${discountLabel}</div>
      ${code ? `<div style="margin-top:var(--dm-sp-3);background:var(--dm-primary);color:#fff;display:inline-block;padding:var(--dm-sp-2) var(--dm-sp-5);border-radius:var(--dm-radius-md);font-family:var(--dm-font-mono);font-size:var(--dm-fs-h3);font-weight:700;letter-spacing:2px">${code}</div>` : ''}
      ${expire ? `<div class="dm-text-small" style="margin-top:var(--dm-sp-3);color:var(--dm-neutral-500)">유효기간: ~ ${escapeHtml(expire)}</div>` : ''}
      ${props.min_purchase ? `<div class="dm-text-small" style="margin-top:var(--dm-sp-1);color:var(--dm-neutral-500)">${Number(props.min_purchase).toLocaleString('ko-KR')}원 이상 구매 시</div>` : ''}
      ${props.usage_condition ? `<div class="dm-text-tiny" style="margin-top:var(--dm-sp-2);color:var(--dm-neutral-500)">${escapeHtml(props.usage_condition)}</div>` : ''}
      ${props.cta_url ? `<div style="margin-top:var(--dm-sp-4)"><a href="${safeUrl(props.cta_url)}" class="dm-cta dm-cta-primary" target="_blank">쿠폰 사용하기</a></div>` : ''}
    </div>
  </div>`;
}

function renderCountdown(props: CountdownProps): string {
  const end = props.end_datetime || '';
  const urgency = escapeHtml(props.urgency_text || '마감까지');

  return `<div class="dm-section dm-countdown" data-section-type="countdown" data-end="${escapeHtml(end)}" style="padding:var(--dm-sp-6) var(--dm-sp-5);background:var(--dm-neutral-900);color:#fff;text-align:center">
    <div class="dm-text-h3" style="color:var(--dm-accent);font-weight:700;margin-bottom:var(--dm-sp-3)">${urgency}</div>
    <div class="dm-countdown-display" style="display:flex;gap:var(--dm-sp-3);justify-content:center;flex-wrap:wrap">
      ${props.show_days    ? `<div class="cd-unit"><div class="cd-num" data-unit="d">00</div><div class="cd-lbl">일</div></div>` : ''}
      ${props.show_hours   ? `<div class="cd-unit"><div class="cd-num" data-unit="h">00</div><div class="cd-lbl">시간</div></div>` : ''}
      ${props.show_minutes ? `<div class="cd-unit"><div class="cd-num" data-unit="m">00</div><div class="cd-lbl">분</div></div>` : ''}
      ${props.show_seconds ? `<div class="cd-unit"><div class="cd-num" data-unit="s">00</div><div class="cd-lbl">초</div></div>` : ''}
    </div>
  </div>`;
}

function renderTextCard(props: TextCardProps): string {
  const img = props.image_url ? inlineImage(props.image_url) : '';
  const pos = props.image_position || 'top';
  const align = props.align || 'left';
  const isHoriz = pos === 'left' || pos === 'right';
  const flexDir = pos === 'bottom' ? 'column-reverse' : pos === 'left' ? 'row' : pos === 'right' ? 'row-reverse' : 'column';

  const imgBlock = img
    ? `<div style="flex:${isHoriz ? '0 0 40%' : '0 0 auto'};${isHoriz ? '' : 'width:100%'}"><img src="${escapeHtml(img)}" alt="${escapeHtml(props.headline || '')}" style="width:100%;display:block;${pos === 'top' ? 'border-radius:0' : 'border-radius:var(--dm-radius-md)'}"></div>`
    : '';

  const textBlock = `<div style="flex:1;padding:var(--dm-sp-4) var(--dm-sp-5);text-align:${align}">
    ${props.tag ? `<div style="display:inline-block;background:var(--dm-primary-light);color:var(--dm-primary);padding:var(--dm-sp-1) var(--dm-sp-2);border-radius:var(--dm-radius-sm);font-size:var(--dm-fs-tiny);font-weight:700;margin-bottom:var(--dm-sp-2)">${escapeHtml(props.tag)}</div>` : ''}
    ${props.headline ? `<div class="dm-text-h2" style="color:var(--dm-neutral-900);margin-bottom:var(--dm-sp-2)">${escapeHtml(props.headline)}</div>` : ''}
    ${props.body ? `<div class="dm-text-body" style="color:var(--dm-neutral-700);white-space:pre-wrap">${escapeHtml(props.body)}</div>` : ''}
  </div>`;

  return `<div class="dm-section dm-text-card" data-section-type="text_card" style="padding:0;background:var(--dm-bg)">
    <div style="display:flex;flex-direction:${flexDir};gap:${isHoriz ? 'var(--dm-sp-3)' : '0'};padding:${pos === 'top' || pos === 'bottom' ? '0' : 'var(--dm-sp-4) var(--dm-sp-5)'}">
      ${imgBlock}
      ${textBlock}
    </div>
  </div>`;
}

function renderCta(props: CtaProps): string {
  const layout = props.layout || 'stack';
  const buttons = Array.isArray(props.buttons) ? props.buttons : [];
  if (buttons.length === 0) return '';

  const btnHtml = buttons.map((b) => {
    const styleClass = b.style === 'secondary' ? 'dm-cta-secondary' : b.style === 'outline' ? 'dm-cta-outline' : 'dm-cta-primary';
    const icon = b.icon ? `<span style="margin-right:var(--dm-sp-1)">${escapeHtml(b.icon)}</span>` : '';
    return `<a href="${safeUrl(b.url)}" class="dm-cta ${styleClass}" target="_blank">${icon}${escapeHtml(b.label || '자세히 보기')}</a>`;
  }).join('');

  const flex = layout === 'row' ? 'flex-direction:row;flex-wrap:wrap' : 'flex-direction:column';
  return `<div class="dm-section dm-cta-section" data-section-type="cta" style="padding:var(--dm-sp-5);text-align:center">
    <div style="display:flex;${flex};gap:var(--dm-sp-3);justify-content:center">${btnHtml}</div>
  </div>`;
}

function renderVideo(props: VideoProps): string {
  const embedUrl = props.video_type === 'youtube' ? youtubeEmbedUrl(props.video_url) : null;
  const thumb = props.thumbnail_url ? inlineImage(props.thumbnail_url) : '';

  const media = embedUrl
    ? `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden">
        <iframe src="${escapeHtml(embedUrl)}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" allowfullscreen loading="lazy"></iframe>
       </div>`
    : (props.video_url
        ? `<video src="${escapeHtml(props.video_url)}" ${props.autoplay ? 'autoplay muted playsinline' : 'controls playsinline'} ${thumb ? `poster="${escapeHtml(thumb)}"` : ''} style="width:100%;display:block"></video>`
        : '');

  return `<div class="dm-section dm-video" data-section-type="video" style="padding:0;background:var(--dm-neutral-900)">
    ${media}
    ${props.caption ? `<div class="dm-text-small" style="padding:var(--dm-sp-3) var(--dm-sp-5);color:var(--dm-neutral-600);background:var(--dm-bg)">${escapeHtml(props.caption)}</div>` : ''}
  </div>`;
}

function renderStoreInfo(props: StoreInfoProps): string {
  const items: string[] = [];
  if (props.phone) items.push(`<a href="tel:${escapeHtml(props.phone)}" style="color:var(--dm-primary)"><strong>전화</strong> ${escapeHtml(props.phone)}</a>`);
  if (props.website) items.push(`<a href="${safeUrl(props.website)}" target="_blank" style="color:var(--dm-primary)"><strong>홈페이지</strong> ${escapeHtml(props.website.replace(/^https?:\/\//, ''))}</a>`);
  if (props.email) items.push(`<a href="mailto:${escapeHtml(props.email)}" style="color:var(--dm-primary)"><strong>이메일</strong> ${escapeHtml(props.email)}</a>`);
  if (props.address) items.push(`<span><strong>주소</strong> ${escapeHtml(props.address)}</span>`);
  if (props.business_hours) items.push(`<span><strong>영업시간</strong> ${escapeHtml(props.business_hours)}</span>`);

  if (items.length === 0) return '';

  return `<div class="dm-section dm-store-info" data-section-type="store_info" style="padding:var(--dm-sp-5);background:var(--dm-neutral-50);border-top:1px solid var(--dm-neutral-200)">
    <div style="display:flex;flex-direction:column;gap:var(--dm-sp-2);font-size:var(--dm-fs-small);color:var(--dm-neutral-700)">
      ${items.join('')}
    </div>
    ${props.map_url ? `<div style="margin-top:var(--dm-sp-3);text-align:center"><a href="${safeUrl(props.map_url)}" target="_blank" class="dm-cta dm-cta-outline">매장 위치 보기</a></div>` : ''}
  </div>`;
}

function renderSns(props: SnsProps): string {
  const channels = Array.isArray(props.channels) ? props.channels : [];
  if (channels.length === 0) return '';

  const layout = props.layout || 'icons';
  const isIconMode = layout === 'icons';

  const snsLabels: Record<string, string> = {
    instagram: 'Instagram', youtube: 'YouTube', kakao: '카카오',
    naver: 'Naver', facebook: 'Facebook', twitter: 'Twitter',
  };
  const snsEmojis: Record<string, string> = {
    instagram: '📷', youtube: '▶️', kakao: '💬',
    naver: 'N', facebook: 'f', twitter: '🐦',
  };
  const snsColors: Record<string, string> = {
    instagram: '#e1306c', youtube: '#ff0000', kakao: '#fee500',
    naver: '#03c75a', facebook: '#1877f2', twitter: '#1da1f2',
  };

  const items = channels.map((ch) => {
    const color = snsColors[ch.type] || 'var(--dm-neutral-700)';
    const label = snsLabels[ch.type] || ch.type;
    const emoji = snsEmojis[ch.type] || '🔗';
    if (isIconMode) {
      return `<a href="${safeUrl(ch.url)}" target="_blank" title="${escapeHtml(label)}" style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:var(--dm-radius-full);background:var(--dm-bg);color:${color};font-size:18px;text-decoration:none;box-shadow:var(--dm-shadow-sm)">${emoji}</a>`;
    }
    return `<a href="${safeUrl(ch.url)}" target="_blank" style="display:flex;align-items:center;gap:var(--dm-sp-2);padding:var(--dm-sp-3) var(--dm-sp-4);border-radius:var(--dm-radius-md);background:${color};color:#fff;text-decoration:none;font-weight:600"><span>${emoji}</span><span>${escapeHtml(label)}</span>${ch.handle ? `<span style="opacity:0.8;font-weight:400">@${escapeHtml(ch.handle)}</span>` : ''}</a>`;
  }).join('');

  return `<div class="dm-section dm-sns" data-section-type="sns" style="padding:var(--dm-sp-5);background:var(--dm-bg)">
    <div style="display:flex;flex-wrap:wrap;gap:var(--dm-sp-3);justify-content:center;${isIconMode ? '' : 'flex-direction:column'}">${items}</div>
  </div>`;
}

function renderPromoCode(props: PromoCodeProps): string {
  if (!props.code) return '';

  return `<div class="dm-section dm-promo-code" data-section-type="promo_code" style="padding:var(--dm-sp-6) var(--dm-sp-5);background:linear-gradient(135deg,var(--dm-accent) 0%,var(--dm-primary) 100%);color:#fff;text-align:center">
    ${props.description ? `<div class="dm-text-h3" style="font-weight:600;margin-bottom:var(--dm-sp-3)">${escapeHtml(props.description)}</div>` : ''}
    <div style="background:rgba(255,255,255,0.95);color:var(--dm-primary);display:inline-block;padding:var(--dm-sp-3) var(--dm-sp-6);border-radius:var(--dm-radius-md);font-family:var(--dm-font-mono);font-size:var(--dm-fs-h2);font-weight:900;letter-spacing:3px;border:2px dashed rgba(255,255,255,0.5)">${escapeHtml(props.code)}</div>
    ${props.instructions ? `<div class="dm-text-small" style="margin-top:var(--dm-sp-3);opacity:0.9">${escapeHtml(props.instructions)}</div>` : ''}
    ${props.cta_url ? `<div style="margin-top:var(--dm-sp-4)"><a href="${safeUrl(props.cta_url)}" class="dm-cta" style="background:#fff;color:var(--dm-primary)" target="_blank">${escapeHtml(props.cta_label || '지금 사용하기')}</a></div>` : ''}
  </div>`;
}

function renderFooter(props: FooterProps, ctx: SectionRenderContext): string {
  const unsubLink = props.show_unsubscribe_link !== false
    ? `<a href="/api/unsubscribes/form" target="_blank" style="color:var(--dm-neutral-500);text-decoration:underline">수신거부</a>`
    : '';

  return `<div class="dm-section dm-footer" data-section-type="footer" style="padding:var(--dm-sp-6) var(--dm-sp-5);background:var(--dm-neutral-100);border-top:1px solid var(--dm-neutral-200);text-align:center">
    ${props.notes ? `<div class="dm-text-small" style="color:var(--dm-neutral-600);margin-bottom:var(--dm-sp-3);white-space:pre-wrap">${escapeHtml(props.notes)}</div>` : ''}
    ${props.cs_phone ? `<div class="dm-text-small" style="color:var(--dm-neutral-700);margin-bottom:var(--dm-sp-1)"><strong>고객센터</strong> <a href="tel:${escapeHtml(props.cs_phone)}" style="color:var(--dm-primary)">${escapeHtml(props.cs_phone)}</a></div>` : ''}
    ${props.cs_hours ? `<div class="dm-text-tiny" style="color:var(--dm-neutral-500);margin-bottom:var(--dm-sp-2)">${escapeHtml(props.cs_hours)}</div>` : ''}
    ${props.legal_text ? `<div class="dm-text-tiny" style="color:var(--dm-neutral-500);margin-top:var(--dm-sp-3);white-space:pre-wrap">${escapeHtml(props.legal_text)}</div>` : ''}
    <div class="dm-text-tiny" style="color:var(--dm-neutral-400);margin-top:var(--dm-sp-4)">
      ${unsubLink}
    </div>
  </div>`;
}

// ────────────── 디스패처 ──────────────

const RENDERERS: { [K in SectionType]: (props: any, ctx: SectionRenderContext) => string } = {
  header:     renderHeader,
  hero:       (p) => renderHero(p),
  coupon:     (p) => renderCoupon(p),
  countdown:  (p) => renderCountdown(p),
  text_card:  (p) => renderTextCard(p),
  cta:        (p) => renderCta(p),
  video:      (p) => renderVideo(p),
  store_info: (p) => renderStoreInfo(p),
  sns:        (p) => renderSns(p),
  promo_code: (p) => renderPromoCode(p),
  footer:     (p, c) => renderFooter(p, c),
};

/** 단일 섹션 렌더링 */
export function renderSection(section: Section, ctx: SectionRenderContext): string {
  if (!section.visible) return '';
  const fn = RENDERERS[section.type];
  if (!fn) return '';
  const variant = section.style_variant || 'default';
  const inner = fn(section.props, ctx);
  if (!inner) return '';
  return `<div class="dm-section-wrap" data-section-id="${escapeHtml(section.id)}" data-variant="${escapeHtml(variant)}">${inner}</div>`;
}

/** 섹션 배열 전체를 세로 스크롤로 렌더링 */
export function renderSections(sections: Section[], ctx: SectionRenderContext): string {
  const sorted = sections.slice().sort((a, b) => a.order - b.order);
  return sorted.map((s) => renderSection(s, ctx)).join('\n');
}

// ────────────── 유틸 ──────────────

function formatKoreanDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

/** 카운트다운 섹션용 클라이언트 스크립트 (뷰어에서 섹션 존재 시에만 삽입) */
export const COUNTDOWN_SCRIPT = `
(function(){
  function tick() {
    var nodes = document.querySelectorAll('.dm-countdown[data-end]');
    nodes.forEach(function(node){
      var end = node.getAttribute('data-end');
      if (!end) return;
      var diff = new Date(end).getTime() - Date.now();
      if (diff < 0) diff = 0;
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      var map = { d: d, h: h, m: m, s: s };
      Object.keys(map).forEach(function(k){
        var el = node.querySelector('[data-unit="' + k + '"]');
        if (el) el.textContent = String(map[k]).padStart(2, '0');
      });
    });
  }
  tick();
  setInterval(tick, 1000);
})();
`;
