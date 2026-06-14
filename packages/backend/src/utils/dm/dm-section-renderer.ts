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
import { publicImageUrl, youtubeEmbedUrl } from './dm-viewer-utils';

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
      const img = props.banner_image_url ? publicImageUrl(props.banner_image_url) : '';
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
      const logo = props.logo_url ? publicImageUrl(props.logo_url) : '';
      const align = props.align || 'center';
      const brandFs = props.brand_size === 'sm' ? 'var(--dm-fs-small)' : props.brand_size === 'lg' ? 'var(--dm-fs-h1)' : 'var(--dm-fs-h3)';
      const logoH = props.logo_size === 'sm' ? '24px' : props.logo_size === 'lg' ? '48px' : '32px';
      const logoBrand = `<div style="display:flex;align-items:center;gap:var(--dm-sp-2)">
          ${logo ? `<img src="${escapeHtml(logo)}" alt="${brand}" style="height:${logoH};border-radius:var(--dm-radius-sm)">` : ''}
          ${brand ? `<div style="font-size:${brandFs};font-weight:700;color:var(--dm-neutral-900)">${brand}</div>` : ''}
        </div>`;
      if (align === 'center') {
        return `<div class="dm-header dm-header-logo" data-variant="${escapeHtml(variant)}" style="background:var(--dm-bg);padding:var(--dm-sp-4) var(--dm-sp-5);border-bottom:1px solid var(--dm-neutral-200);display:flex;flex-direction:column;align-items:center;gap:var(--dm-sp-1);text-align:center">
        ${logoBrand}
        ${props.phone ? `<a href="tel:${escapeHtml(props.phone)}" style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500)">${escapeHtml(props.phone)}</a>` : ''}
      </div>`;
      }
      return `<div class="dm-header dm-header-logo" data-variant="${escapeHtml(variant)}" style="background:var(--dm-bg);padding:var(--dm-sp-4) var(--dm-sp-5);border-bottom:1px solid var(--dm-neutral-200);display:flex;align-items:center;justify-content:space-between">
        ${logoBrand}
        ${props.phone ? `<a href="tel:${escapeHtml(props.phone)}" style="font-size:var(--dm-fs-small);color:var(--dm-neutral-500)">${escapeHtml(props.phone)}</a>` : ''}
      </div>`;
    }
  }
}

function renderHero(props: HeroProps): string {
  const img = props.image_url ? publicImageUrl(props.image_url) : '';
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
    <div style="background:var(--dm-bg);border:2px dashed var(--dm-primary);border-radius:var(--dm-radius-lg);padding:var(--dm-sp-6)">
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

  return `<div class="dm-section dm-countdown" data-section-type="countdown" data-end="${escapeHtml(end)}" style="padding:var(--dm-sp-6) var(--dm-sp-5);background:var(--dm-neutral-900);color:#fff">
    <div class="dm-text-h3" style="color:var(--dm-accent);font-weight:700;margin-bottom:var(--dm-sp-3)">${urgency}</div>
    <div class="dm-countdown-display" style="display:flex;gap:var(--dm-sp-3);justify-content:var(--dm-section-justify,center);flex-wrap:wrap">
      ${props.show_days    ? `<div class="cd-unit"><div class="cd-num" data-unit="d">00</div><div class="cd-lbl">일</div></div>` : ''}
      ${props.show_hours   ? `<div class="cd-unit"><div class="cd-num" data-unit="h">00</div><div class="cd-lbl">시간</div></div>` : ''}
      ${props.show_minutes ? `<div class="cd-unit"><div class="cd-num" data-unit="m">00</div><div class="cd-lbl">분</div></div>` : ''}
      ${props.show_seconds ? `<div class="cd-unit"><div class="cd-num" data-unit="s">00</div><div class="cd-lbl">초</div></div>` : ''}
    </div>
  </div>`;
}

function renderTextCard(props: TextCardProps): string {
  const img = props.image_url ? publicImageUrl(props.image_url) : '';
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

  // 가로 정렬: row=주축(justify-content) / column(stack)=교차축(align-items).
  // column에서 justify-content는 세로축이라 무효 + align-items 기본 stretch가 버튼을 풀폭으로 늘려 정렬이 안 보였음.
  const flex = layout === 'row'
    ? 'flex-direction:row;flex-wrap:wrap;justify-content:var(--dm-section-justify,center)'
    : 'flex-direction:column;align-items:var(--dm-section-justify,center)';
  return `<div class="dm-section dm-cta-section" data-section-type="cta" style="padding:var(--dm-sp-5)">
    <div style="display:flex;${flex};gap:var(--dm-sp-3)">${btnHtml}</div>
  </div>`;
}

function renderVideo(props: VideoProps): string {
  const embedUrl = props.video_type === 'youtube' ? youtubeEmbedUrl(props.video_url) : null;
  const thumb = props.thumbnail_url ? publicImageUrl(props.thumbnail_url) : '';

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

  return `<div class="dm-section dm-promo-code" data-section-type="promo_code" style="padding:var(--dm-sp-6) var(--dm-sp-5);background:linear-gradient(135deg,var(--dm-accent) 0%,var(--dm-primary) 100%);color:#fff">
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

  return `<div class="dm-section dm-footer" data-section-type="footer" style="padding:var(--dm-sp-6) var(--dm-sp-5);background:var(--dm-neutral-100);border-top:1px solid var(--dm-neutral-200)">
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
  // 옛 11
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
  // ★ D216+ 신규 16 — SSR placeholder (2 세션 영역 = SSR rendering 영역 강화 의무)
  product_carousel:  (p) => renderProductCarousel(p),
  gallery:           (p) => renderGallery(p),
  slideshow:         (p) => renderSlideshow(p),
  tab_cards:         (p) => renderTabCards(p),
  poll:              (p) => renderPoll(p),
  survey:            (p) => renderSurvey(p),
  email_capture:     (p) => renderEmailCapture(p),
  click_rewards:     (p) => renderClickRewards(p),
  lucky_draw:        (p) => renderLuckyDraw(p),
  roulette:          (p) => renderRoulette(p),
  instant_coupon:    (p) => renderInstantCoupon(p),
  limited_quantity:  (p) => renderLimitedQuantity(p),
  youtube_embed:     (p) => renderYoutubeEmbed(p),
  instagram_embed:   (p) => renderInstagramEmbed(p),
  map_store_locator: (p) => renderMapStoreLocator(p),
  reviews:           (p) => renderReviews(p),
};

// ────────────── D216+ 신규 16 SSR 렌더링 함수 ──────────────

function renderProductCarousel(p: any): string {
  const products = Array.isArray(p?.products) ? p.products : [];
  if (products.length === 0) {
    return `<div class="dm-section dm-product-carousel" style="padding:var(--dm-sp-4);text-align:center;color:var(--dm-neutral-400);font-style:italic">[상품을 추가해주세요]</div>`;
  }
  const items = products.map((it: any) => `
    <div style="min-width:140px;max-width:160px">
      ${it.image_url ? `<img src="${escapeHtml(publicImageUrl(it.image_url))}" loading="lazy" alt="${escapeHtml(it.name || '')}" style="width:100%;height:140px;object-fit:cover;border-radius:8px"/>` : `<div style="width:100%;height:140px;background:var(--dm-neutral-100);border-radius:8px"></div>`}
      <div style="font-size:12px;font-weight:600;margin-top:6px">${escapeHtml(it.name || '')}</div>
      <div style="font-size:13px;font-weight:700;margin-top:2px">${Number(it.discount_price || it.price || 0).toLocaleString('ko-KR')}원</div>
    </div>`).join('');
  return `<div class="dm-section dm-product-carousel" style="padding:var(--dm-sp-4)">
    ${p.title ? `<div style="font-size:15px;font-weight:700;margin-bottom:8px">${escapeHtml(p.title)}</div>` : ''}
    <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px">${items}</div>
  </div>`;
}

function renderGallery(p: any): string {
  const images = Array.isArray(p?.images) ? p.images : [];
  if (images.length === 0) {
    return `<div class="dm-section dm-gallery" style="padding:var(--dm-sp-4);text-align:center;color:var(--dm-neutral-400);font-style:italic">[이미지를 추가해주세요]</div>`;
  }
  const cols = p?.layout === 'grid_3x3' ? 3 : p?.layout === 'list_1xN' ? 1 : 2;
  const items = images.map((img: any) => `<img src="${escapeHtml(publicImageUrl(img.url))}" loading="lazy" alt="${escapeHtml(img.caption || '')}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px"/>`).join('');
  return `<div class="dm-section dm-gallery" style="padding:var(--dm-sp-4)">
    ${p.title ? `<div style="font-size:15px;font-weight:700;margin-bottom:8px">${escapeHtml(p.title)}</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px">${items}</div>
  </div>`;
}

function renderSlideshow(p: any): string {
  const slides = Array.isArray(p?.slides) ? p.slides : [];
  if (slides.length === 0) {
    return `<div class="dm-section dm-slideshow" style="padding:var(--dm-sp-4);text-align:center;color:var(--dm-neutral-400);font-style:italic">[슬라이드를 추가해주세요]</div>`;
  }
  const first = slides[0];
  return `<div class="dm-section dm-slideshow" style="padding:var(--dm-sp-4)">
    <img src="${escapeHtml(publicImageUrl(first.image_url || ''))}" loading="lazy" alt="${escapeHtml(first.caption || '')}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px"/>
    ${first.caption ? `<div style="font-size:13px;margin-top:8px">${escapeHtml(first.caption)}</div>` : ''}
  </div>`;
}

function renderTabCards(p: any): string {
  const tabs = Array.isArray(p?.tabs) ? p.tabs : [];
  if (tabs.length === 0) return '';
  const first = tabs[0];
  return `<div class="dm-section dm-tab-cards" style="padding:var(--dm-sp-4)">
    <div style="display:flex;gap:4px;border-bottom:1px solid var(--dm-neutral-200);margin-bottom:12px">
      ${tabs.map((t: any, i: number) => `<span style="padding:8px 12px;border-bottom:2px solid ${i === 0 ? 'var(--dm-primary)' : 'transparent'};color:${i === 0 ? 'var(--dm-primary)' : 'var(--dm-neutral-600)'};font-size:13px;font-weight:600">${escapeHtml(t.label || '')}</span>`).join('')}
    </div>
    <div style="font-size:13px;line-height:1.6">${escapeHtml(first.content || '')}</div>
  </div>`;
}

function renderPoll(p: any): string {
  const options = Array.isArray(p?.options) ? p.options : [];
  const items = options.map((o: any, i: number) => `<div data-dm-poll-option data-option-id="${escapeHtml(o.id || String(i))}" style="padding:10px 14px;background:var(--dm-neutral-50);border:1px solid var(--dm-neutral-200);border-radius:8px;font-size:13px;margin-bottom:8px;cursor:pointer">${escapeHtml(o.label || '')}</div>`).join('');
  return `<div class="dm-section dm-poll" data-dm-poll style="padding:var(--dm-sp-4)">
    <div style="font-size:15px;font-weight:700;margin-bottom:8px">${escapeHtml(p.question || '[질문을 작성해주세요]')}</div>
    ${items}
    ${p.one_vote_per_user ? `<div style="font-size:11px;color:var(--dm-neutral-500);margin-top:8px">1인 1회 투표</div>` : ''}
    <div data-dm-result style="display:none"></div>
  </div>`;
}

function renderSurvey(p: any): string {
  const questions = Array.isArray(p?.questions) ? p.questions : [];
  if (questions.length === 0) {
    return `<div class="dm-section dm-survey" style="padding:var(--dm-sp-4);text-align:center;color:var(--dm-neutral-400);font-style:italic">[설문 질문을 추가해주세요]</div>`;
  }
  const items = questions.map((q: any) => `<div style="margin-bottom:12px"><div style="font-size:13px;font-weight:600;margin-bottom:6px">${escapeHtml(q.question || '')}${q.required ? ' <span style="color:#dc2626">*</span>' : ''}</div></div>`).join('');
  return `<div class="dm-section dm-survey" style="padding:var(--dm-sp-4)">
    ${p.title ? `<div style="font-size:15px;font-weight:700;margin-bottom:8px">${escapeHtml(p.title)}</div>` : ''}
    ${items}
    ${p.completion_reward_text ? `<div style="font-size:12px;color:var(--dm-primary);margin-top:12px;font-weight:600">${escapeHtml(p.completion_reward_text)}</div>` : ''}
  </div>`;
}

function renderEmailCapture(p: any): string {
  return `<div class="dm-section dm-email-capture" data-dm-form style="padding:var(--dm-sp-4)">
    <div style="font-size:15px;font-weight:700;margin-bottom:8px">${escapeHtml(p.headline || '[헤드라인을 작성해주세요]')}</div>
    ${p.description ? `<div style="font-size:13px;color:var(--dm-neutral-700);margin-bottom:12px;line-height:1.6">${escapeHtml(p.description)}</div>` : ''}
    <input type="email" data-field="email" placeholder="이메일 주소" style="width:100%;padding:10px;border:1px solid var(--dm-neutral-200);border-radius:6px;font-size:13px;margin-bottom:10px"/>
    <label style="display:flex;align-items:flex-start;gap:6px;font-size:12px;color:var(--dm-neutral-700);margin-bottom:10px"><input type="checkbox" ${p.consent_required ? 'data-consent' : ''} style="margin-top:2px"/><span>${escapeHtml(p.consent_text || '')}</span></label>
    <button data-dm-submit style="width:100%;height:40px;background:var(--dm-primary);color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer">${escapeHtml(p.reward_description ? `참여하고 ${p.reward_description}` : '참여하기')}</button>
    ${p.legal_notice ? `<div style="font-size:10px;color:var(--dm-neutral-500);margin-top:8px;line-height:1.5">${escapeHtml(p.legal_notice)}</div>` : ''}
    <div data-dm-result style="display:none"></div>
  </div>`;
}

function renderClickRewards(p: any): string {
  const iconMap: Record<string, string> = { like: '❤️', share: '🔁', scroll: '📜' };
  return `<div class="dm-section dm-click-rewards" style="padding:var(--dm-sp-4)">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div style="font-size:28px">${iconMap[p.reward_type] || '⭐'}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${escapeHtml(p.reward_description || '')}</div>
        ${p.show_progress ? `<div style="font-size:11px;color:var(--dm-neutral-500);margin-top:2px">목표 ${p.target_count || 0}회</div>` : ''}
      </div>
    </div>
  </div>`;
}

function renderLuckyDraw(p: any): string {
  const fields = Array.isArray(p?.form_fields) ? p.form_fields : [];
  const inputs = fields.map((f: any) => {
    const t = f.name === 'phone' ? 'tel' : f.name === 'email' ? 'email' : 'text';
    const ph = f.name === 'name' ? '이름' : f.name === 'phone' ? '전화번호' : '이메일';
    return `<input type="${t}" data-field="${escapeHtml(f.name)}" placeholder="${ph}" style="padding:10px;border:1px solid #f59e0b;border-radius:6px;font-size:13px;background:#fff;margin-bottom:8px;display:block;width:100%"/>`;
  }).join('');
  return `<div class="dm-section dm-lucky-draw" data-dm-form style="padding:var(--dm-sp-4);background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #f59e0b;border-radius:12px;margin:var(--dm-sp-3) 0">
    <div style="font-size:28px;margin-bottom:8px">🎁</div>
    <div style="font-size:15px;font-weight:700;margin-bottom:8px">${escapeHtml(p.title || '[추첨 이벤트 제목]')}</div>
    ${p.description ? `<div style="font-size:13px;color:var(--dm-neutral-700);margin-bottom:12px;line-height:1.6">${escapeHtml(p.description)}</div>` : ''}
    ${inputs}
    <label style="display:flex;align-items:flex-start;gap:6px;font-size:11px;color:var(--dm-neutral-700);margin-bottom:10px"><input type="checkbox" data-consent style="margin-top:2px"/><span>${escapeHtml(p.consent_text || '')}</span></label>
    <button data-dm-submit style="width:100%;height:44px;background:#d97706;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">응모하기</button>
    ${p.draw_at ? `<div style="font-size:11px;color:var(--dm-neutral-600);margin-top:8px;text-align:center">발표: ${escapeHtml(new Date(p.draw_at).toLocaleString('ko-KR'))}</div>` : ''}
    <div data-dm-result style="display:none"></div>
  </div>`;
}

function renderRoulette(p: any): string {
  const segs = Array.isArray(p?.segments) ? p.segments.map((s: any) => ({ id: String(s.id), label: String(s.label || '') })) : [];
  return `<div class="dm-section dm-roulette" data-dm-roulette data-segments="${escapeHtml(JSON.stringify(segs))}" style="padding:var(--dm-sp-4);background:linear-gradient(135deg,#ede9fe,#ddd6fe);border:1px solid #7c3aed;border-radius:12px;margin:var(--dm-sp-3) 0">
    <div style="font-size:28px;margin-bottom:8px">🎡</div>
    <div style="font-size:15px;font-weight:700;margin-bottom:8px">${escapeHtml(p.title || '룰렛 이벤트')}</div>
    <div data-dm-wheel style="width:200px;height:200px;border-radius:50%;background:conic-gradient(#a78bfa 0deg 45deg, #c4b5fd 45deg 90deg, #ddd6fe 90deg 135deg, #ede9fe 135deg 180deg, #a78bfa 180deg 225deg, #c4b5fd 225deg 270deg, #ddd6fe 270deg 315deg, #ede9fe 315deg 360deg);margin:12px auto;border:4px solid #fff"></div>
    <button data-dm-spin style="height:44px;padding:0 32px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">룰렛 돌리기</button>
    ${p.one_spin_per_user ? `<div style="font-size:11px;color:var(--dm-neutral-600);margin-top:8px">1인 1회 한정</div>` : ''}
    <div data-dm-result style="display:none"></div>
  </div>`;
}

function renderInstantCoupon(p: any): string {
  return `<div class="dm-section dm-instant-coupon" style="padding:var(--dm-sp-4);background:linear-gradient(135deg,#fee2e2,#fecaca);border:2px dashed #ef4444;border-radius:12px;margin:var(--dm-sp-3) 0">
    <div style="font-size:28px;margin-bottom:8px">🎟️</div>
    <div style="font-size:15px;font-weight:700;color:#991b1b;margin-bottom:8px">${escapeHtml(p.coupon_label || '')}</div>
    <div style="font-size:13px;color:#7f1d1d;margin-bottom:12px">${escapeHtml(p.discount_description || '')}</div>
    ${p.expires_at ? `<div style="font-size:11px;color:#991b1b;margin-bottom:10px;font-weight:600">만료: ${escapeHtml(new Date(p.expires_at).toLocaleString('ko-KR'))}</div>` : ''}
    <button style="height:44px;padding:0 32px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700">쿠폰 받기</button>
    ${p.conditions ? `<div style="font-size:10px;color:var(--dm-neutral-600);margin-top:8px;font-style:italic">${escapeHtml(p.conditions)}</div>` : ''}
    ${p.usage_instructions ? `<div style="font-size:10px;color:var(--dm-neutral-500);margin-top:6px">${escapeHtml(p.usage_instructions)}</div>` : ''}
  </div>`;
}

function renderLimitedQuantity(p: any): string {
  const remaining = p.current_remaining ?? p.total_quantity ?? 0;
  const total = p.total_quantity || 1;
  const percent = (remaining / total) * 100;
  return `<div class="dm-section dm-limited-quantity" style="padding:var(--dm-sp-4);background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #d97706;border-radius:12px;margin:var(--dm-sp-3) 0">
    <div style="font-size:28px;margin-bottom:8px">⏳</div>
    <div style="font-size:15px;font-weight:700;margin-bottom:8px">${escapeHtml(p.title || '[선착순 이벤트 제목]')}</div>
    ${p.description ? `<div style="font-size:13px;color:var(--dm-neutral-700);margin-bottom:12px;line-height:1.6">${escapeHtml(p.description)}</div>` : ''}
    <div style="margin-bottom:12px">
      <div style="font-size:12px;color:#92400e;margin-bottom:6px;display:flex;justify-content:space-between"><span>남은 수량</span><span style="font-weight:700">${remaining} / ${total}</span></div>
      <div style="width:100%;height:8px;background:#fff;border-radius:4px;overflow:hidden"><div style="width:${percent}%;height:100%;background:#d97706"></div></div>
    </div>
    <button style="width:100%;height:44px;background:#d97706;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700">선착순 참여하기</button>
  </div>`;
}

function renderYoutubeEmbed(p: any): string {
  if (!p.video_url) {
    return `<div class="dm-section dm-youtube-embed" style="padding:var(--dm-sp-4);text-align:center;color:var(--dm-neutral-400);font-style:italic">[YouTube URL을 입력해주세요]</div>`;
  }
  const match = String(p.video_url).match(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{11})/);
  const videoId = match ? match[1] : null;
  if (!videoId) return `<div class="dm-section dm-youtube-embed" style="padding:var(--dm-sp-4)">잘못된 YouTube URL</div>`;
  return `<div class="dm-section dm-youtube-embed" style="padding:var(--dm-sp-4)">
    <div style="position:relative;padding-bottom:56.25%;height:0">
      <iframe src="https://www.youtube.com/embed/${escapeHtml(videoId)}${p.auto_play ? '?autoplay=1&mute=1' : ''}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;border-radius:8px" allow="autoplay; encrypted-media" allowfullscreen></iframe>
    </div>
  </div>`;
}

function renderInstagramEmbed(p: any): string {
  if (!p.post_url) {
    return `<div class="dm-section dm-instagram-embed" style="padding:var(--dm-sp-4);text-align:center;color:var(--dm-neutral-400);font-style:italic">[Instagram URL을 입력해주세요]</div>`;
  }
  return `<div class="dm-section dm-instagram-embed" style="padding:var(--dm-sp-4)">
    <a href="${escapeHtml(p.post_url)}" target="_blank" rel="noopener noreferrer" style="display:block;padding:20px;background:linear-gradient(135deg,#fdf2f8,#fce7f3);border:1px solid #ec4899;border-radius:8px;text-align:center;text-decoration:none">
      <div style="font-size:28px;margin-bottom:6px">📷</div>
      <div style="font-size:13px;font-weight:600;color:#831843">Instagram 게시물 보기</div>
    </a>
  </div>`;
}

function renderMapStoreLocator(p: any): string {
  const stores = Array.isArray(p?.stores) ? p.stores : [];
  const items = stores.map((s: any) => `
    <div style="padding:10px;background:var(--dm-neutral-50);border-radius:6px;margin-bottom:8px">
      <div style="font-size:13px;font-weight:600">${escapeHtml(s.name || '')}</div>
      <div style="font-size:11px;color:var(--dm-neutral-600);margin-top:2px">${escapeHtml(s.address || '')}</div>
      ${s.phone ? `<div style="font-size:11px;color:var(--dm-primary);margin-top:4px">📞 ${escapeHtml(s.phone)}</div>` : ''}
      ${s.hours ? `<div style="font-size:11px;color:var(--dm-neutral-500);margin-top:2px">⏰ ${escapeHtml(s.hours)}</div>` : ''}
    </div>`).join('');
  return `<div class="dm-section dm-map-store-locator" style="padding:var(--dm-sp-4)">
    <div style="font-size:15px;font-weight:700;margin-bottom:8px">매장 찾기</div>
    <div style="width:100%;height:200px;background:var(--dm-neutral-100);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--dm-neutral-500);font-size:13px;margin-bottom:12px">🗺️ 지도 영역</div>
    ${items || `<div style="text-align:center;color:var(--dm-neutral-400);font-style:italic">[매장 정보를 추가해주세요]</div>`}
  </div>`;
}

function renderReviews(p: any): string {
  const reviews = Array.isArray(p?.reviews) ? p.reviews : [];
  const avg = reviews.length > 0 ? (reviews.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1) : '0.0';
  const items = reviews.slice(0, 3).map((r: any) => `
    <div style="padding:10px;background:var(--dm-neutral-50);border-radius:6px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="color:#f59e0b;font-size:13px">${'★'.repeat(r.rating || 0)}${'☆'.repeat(5 - (r.rating || 0))}</span>
        <span style="font-size:11px;color:var(--dm-neutral-500)">${escapeHtml(r.author || '')}</span>
      </div>
      <div style="font-size:12px;line-height:1.5">${escapeHtml(r.body || '')}</div>
      ${r.date ? `<div style="font-size:10px;color:var(--dm-neutral-400);margin-top:4px">${escapeHtml(r.date)}</div>` : ''}
    </div>`).join('');
  return `<div class="dm-section dm-reviews" style="padding:var(--dm-sp-4)">
    ${p.title ? `<div style="font-size:15px;font-weight:700;margin-bottom:8px">${escapeHtml(p.title)}</div>` : ''}
    ${reviews.length > 0 && p.show_average_rating !== false ? `<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:12px"><span style="font-size:24px;font-weight:700">${avg}</span><span style="color:#f59e0b">★★★★★</span><span style="font-size:11px;color:var(--dm-neutral-500)">(${reviews.length}건)</span></div>` : ''}
    ${items || `<div style="text-align:center;color:var(--dm-neutral-400);font-style:italic">[리뷰를 추가해주세요]</div>`}
  </div>`;
}

/** 단일 섹션 렌더링 */
export function renderSection(section: Section, ctx: SectionRenderContext): string {
  if (!section.visible) return '';
  const fn = RENDERERS[section.type];
  if (!fn) return '';
  const variant = section.style_variant || 'default';
  // 공통 정렬(section.align)을 단일 소스로 — header/hero/text_card가 자체 props.align을 읽으므로 우선 주입(미설정 시 각 섹션 기본 유지 = 하위호환)
  const alignAware = section.type === 'header' || section.type === 'hero' || section.type === 'text_card';
  const renderProps = (alignAware && section.align) ? { ...(section.props as any), align: section.align } : section.props;
  const inner = fn(renderProps, ctx);
  if (!inner) return '';
  const al = section.align || 'center';
  const just = al === 'left' ? 'flex-start' : al === 'right' ? 'flex-end' : 'center';
  const wrapStyle = `text-align:${al};--dm-section-justify:${just}${section.accent_color ? `;--dm-primary:${escapeHtml(section.accent_color)}` : ''}`;
  return `<div class="dm-section-wrap" data-section-id="${escapeHtml(section.id)}" data-section-type="${escapeHtml(section.type)}" data-variant="${escapeHtml(variant)}" style="${wrapStyle}">${inner}</div>`;
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
