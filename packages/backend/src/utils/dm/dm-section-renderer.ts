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
import { dmIcon, dmEventCard } from './dm-render-primitives';
// ★ 2026-07-13 디자인 3.0 — 섹션 연결부(웨이브/사선/커브) SVG
import { renderDmDividerSvg } from './dm-tokens';
// ★ 2026-06-25 (P1) 아트디렉션 — 섹션 구도(treatment) 선택. 미설정/미허용=classic(현행 동일).
import { selectTreatment, type ArtDirection } from './dm-art-direction';
// ★ 2026-07-02 스킴 없는 URL(www.x.y) https:// 정규화 — 이메일 "링크 이동 안 됨" 신고와 동일 구멍 통합 수정
import { normalizeWebUrl } from '../normalize';

// ────────────── 렌더 컨텍스트 ──────────────

export type SectionRenderContext = {
  brandKit?: DmBrandKit;
  storeName?: string;
  trackApiBase?: string;
  shortCode?: string;
  isPreview?: boolean;
  // ★ 2026-06-25 (P1) DM 단위 아트디렉션(타입스케일 등). treatment 기본값 추론에 사용(미전달=현행).
  artDirection?: ArtDirection;
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

/** URL이 안전한 스킴(http/https/tel/mailto)인지 검증. 그 외는 # 로 대체.
 *  ★ 2026-07-02 스킴 없는 도메인형(www.x.y)은 https:// 부착 후 통과 — 죽은 '#' 링크 방지. */
export function safeUrl(url: unknown): string {
  if (!url) return '#';
  const s = normalizeWebUrl(String(url).trim());
  if (/^(https?:|tel:|mailto:|#|\/)/i.test(s)) return escapeHtml(s);
  return '#';
}

/** ★ 2026-07-02(2) 폰트 크기 직접 선택 — 유효(10~80px)하면 뒤에 붙는 font-size 선언, 아니면 빈 문자열(기존 토큰 크기 유지). */
export function fsDecl(size: unknown): string {
  const n = Math.round(Number(size));
  if (!Number.isFinite(n) || n < 10 || n > 80) return '';
  return `;font-size:${n}px`;
}

/** ★ 2026-07-02(2) 섹션 공통 텍스트 크기 검증 — 유효(10~80)하면 정수 px, 아니면 null. */
export function fsVarPx(size: unknown): number | null {
  const n = Math.round(Number(size));
  if (!Number.isFinite(n) || n < 10 || n > 80) return null;
  return n;
}

/** ★ 2026-07-13 디자인 3.0 — 헤드라인 강조(형광 마커/밑줄). 이미 escape된 문자열을 받아 span으로 감싼다. */
export function emphasizeHead(headEscaped: string, emphasis?: string): string {
  if (!headEscaped) return headEscaped;
  if (emphasis === 'marker') return `<span class="dm-em-marker">${headEscaped}</span>`;
  if (emphasis === 'underline') return `<span class="dm-em-underline">${headEscaped}</span>`;
  return headEscaped;
}

/** ★ 2026-07-13 디자인 3.0 이미지 스튜디오 — 오버레이 프리셋 CSS. overlay 미설정 = overlay_gradient 하위호환. */
function heroOverlayCss(props: HeroProps): string {
  if (!props.overlay) {
    return props.overlay_gradient !== false ? 'linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,0.5) 100%)' : 'transparent';
  }
  switch (props.overlay) {
    case 'none':   return 'transparent';
    case 'soft':   return 'linear-gradient(180deg,rgba(0,0,0,0) 55%,rgba(0,0,0,0.32) 100%)';
    case 'strong': return 'linear-gradient(180deg,rgba(0,0,0,0.06) 0%,rgba(0,0,0,0.62) 100%)';
    case 'brand':  return 'linear-gradient(200deg, color-mix(in srgb, var(--dm-primary) 55%, transparent) 0%, rgba(0,0,0,0.55) 100%)';
    case 'top':    return 'linear-gradient(0deg,rgba(0,0,0,0) 45%,rgba(0,0,0,0.5) 100%)';
    default:       return 'transparent';
  }
}

/** ★ 2026-07-13 디자인 3.0 이미지 스튜디오 — 초점(object-position) */
function heroFocusCss(props: HeroProps): string {
  const f = props.focus === 'top' ? 'top' : props.focus === 'bottom' ? 'bottom' : 'center';
  return `object-position:center ${f}`;
}

/** ★ 2026-07-02(2) 상품 할인율 계산 — 수동 discount_rate(1~99) 우선, 없으면 정가/할인가로 산출. 유효하지 않으면 null. */
export function computeDmDiscountRate(price: unknown, discountPrice: unknown, manualRate?: unknown): number | null {
  const manual = Math.round(Number(manualRate));
  if (Number.isFinite(manual) && manual > 0 && manual < 100) return manual;
  const p = Number(price);
  const d = Number(discountPrice);
  if (!Number.isFinite(p) || !Number.isFinite(d) || p <= 0 || d <= 0 || d >= p) return null;
  return Math.round((1 - d / p) * 100);
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
      return `<div class="dm-header dm-header-countdown" data-variant="${escapeHtml(variant)}" style="background:linear-gradient(135deg,var(--dm-primary) 0%,var(--dm-primary-hover) 100%);color:#fff;padding:var(--dm-sp-6) var(--dm-sp-5)">
        <div style="font-size:36px;font-weight:900;letter-spacing:2px">${escapeHtml(ddayText)}</div>
        ${props.event_title ? `<div style="font-size:var(--dm-fs-small);opacity:0.9;margin-top:var(--dm-sp-2);font-weight:500">${escapeHtml(props.event_title)}</div>` : ''}
        ${brand ? `<div style="font-size:var(--dm-fs-tiny);opacity:0.6;margin-top:var(--dm-sp-1)">${brand}</div>` : ''}
      </div>`;
    }
    case 'coupon': {
      return `<div class="dm-header dm-header-coupon" data-variant="${escapeHtml(variant)}" style="background:linear-gradient(135deg,var(--dm-accent) 0%,var(--dm-primary) 100%);color:#fff;padding:var(--dm-sp-6) var(--dm-sp-5)">
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
          ${brand ? `<div style="font-size:${brandFs};font-weight:800;letter-spacing:-0.01em;color:var(--dm-neutral-900)">${brand}</div>` : ''}
        </div>`;
      // ★ 2026-07-09: 좌/중/우 = column + align-items 통일 (편집 캔버스 HeaderSection과 미러).
      //   이전 좌/우 row + justify-content는 편집기 contentEditable(브랜드) 블록이 폭을 꽉 채워 flex-end가 안 먹던 근본 정정.
      const logoAlignItems = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
      return `<div class="dm-header dm-header-logo" data-variant="${escapeHtml(variant)}" style="background:var(--dm-bg);padding:var(--dm-sp-4) var(--dm-sp-5);border-bottom:1px solid var(--dm-neutral-200);display:flex;flex-direction:column;align-items:${logoAlignItems};gap:var(--dm-sp-1)">
        ${logoBrand}
        ${props.phone ? `<a href="tel:${escapeHtml(props.phone)}" style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500)">${escapeHtml(props.phone)}</a>` : ''}
      </div>`;
    }
  }
}

// ★ 2026-06-25 (P1) hero treatment 디스패처. 미설정/미허용=classic(현행 본문 그대로 — 골든 보존).
function renderHero(props: HeroProps, treatment?: string): string {
  switch (treatment) {
    case 'typographic': return renderHeroTypographic(props);
    case 'full_bleed': return renderHeroFullBleed(props);
    case 'split': return renderHeroSplit(props);
    case 'editorial_overlap': return renderHeroOverlap(props);
    default: return renderHeroClassic(props);
  }
}

function renderHeroClassic(props: HeroProps): string {
  const img = props.image_url ? publicImageUrl(props.image_url) : '';
  const heightPx = { sm: '200px', md: '320px', lg: '480px', full: '100vh' }[props.height || 'md'];
  const align = props.align || 'center';
  const textAlign = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  const gradient = props.overlay_gradient !== false ? 'linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,0.5) 100%)' : 'transparent';
  // ★ Phase 1: 이미지 없으면 AI 무드 배경(그라데이션)으로 — 휑한 검정 대신 완성형. mood_text로 가독 색.
  const moodBg = (props as any).mood_background as string | undefined;
  const baseBg = img ? 'var(--dm-neutral-900)' : (moodBg || 'var(--dm-neutral-900)');
  const textColor = (!img && moodBg) ? ((props as any).mood_text || '#fff') : '#fff';

  return `<div class="dm-section dm-hero" data-section-type="hero" style="position:relative;min-height:${heightPx};overflow:hidden;background:${baseBg}">
    ${img ? `<img class="dm-hero-media" src="${escapeHtml(img)}" alt="${escapeHtml(props.headline || '')}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;${heroFocusCss(props)}">` : ''}
    ${img ? `<div style="position:absolute;inset:0;background:${gradient}"></div>` : ''}
    <div style="position:relative;min-height:${heightPx};display:flex;flex-direction:column;justify-content:flex-end;align-items:${textAlign};padding:var(--dm-sp-8) var(--dm-sp-5);color:${textColor};text-align:${align}">
      ${props.headline ? `<div class="dm-text-hero" style="font-weight:800${fsDecl(props.headline_size)}${props.headline_color ? `;color:${escapeHtml(props.headline_color)}` : ''}">${emphasizeHead(escapeHtml(props.headline).replace(/\n/g, '<br>'), props.headline_emphasis)}</div>` : ''}
      ${props.sub_copy ? `<div class="dm-text-body" style="margin-top:var(--dm-sp-3);opacity:0.9${fsDecl(props.sub_copy_size)}${props.sub_copy_color ? `;color:${escapeHtml(props.sub_copy_color)}` : ''}">${escapeHtml(props.sub_copy).replace(/\n/g, '<br>')}</div>` : ''}
    </div>
  </div>`;
}

// 타이포: 이미지 없이 대형 헤드라인 + 규칙선 + 여백(아트디렉션 타입스케일/밀도 변수 인라인 참조).
function renderHeroTypographic(props: HeroProps): string {
  // ★ 2026-07-14 줄바꿈(임은지·남지현 신고) — 헤드라인/서브카피 입력 개행을 발행물에 반영(hero classic과 동일 규칙). alt는 위에서 순수 이스케이프 사용.
  const head = escapeHtml(props.headline || '').replace(/\n/g, '<br>');
  const sub = escapeHtml(props.sub_copy || '').replace(/\n/g, '<br>');
  return `<div class="dm-section dm-hero" data-section-type="hero" style="background:var(--dm-bg);padding:calc(var(--dm-sp-12) * var(--dm-section-pad-scale)) var(--dm-sp-5);display:flex;flex-direction:column;gap:var(--dm-sp-4)">
    ${head ? `<div style="font-size:var(--dm-fs-hero);font-weight:var(--dm-fw-hero);letter-spacing:var(--dm-ls-hero);line-height:1.12;font-family:var(--dm-font-display);color:var(--dm-neutral-900)${fsDecl(props.headline_size)}${props.headline_color ? `;color:${escapeHtml(props.headline_color)}` : ''}">${head}</div>` : ''}
    <div style="height:2px;width:48px;background:var(--dm-primary)"></div>
    ${sub ? `<div style="font-size:var(--dm-fs-body);color:var(--dm-neutral-600)${fsDecl(props.sub_copy_size)}${props.sub_copy_color ? `;color:${escapeHtml(props.sub_copy_color)}` : ''}">${sub}</div>` : ''}
  </div>`;
}

// 풀블리드: 이미지 꽉 차게 + 중앙 오버레이 대형 헤드라인.
function renderHeroFullBleed(props: HeroProps): string {
  const img = props.image_url ? publicImageUrl(props.image_url) : '';
  const heightPx = { sm: '240px', md: '380px', lg: '520px', full: '100vh' }[props.height || 'md'];
  const moodBg = (props as any).mood_background as string | undefined;
  const baseBg = img ? 'var(--dm-neutral-900)' : (moodBg || 'var(--dm-neutral-900)');
  // ★ 2026-07-14 줄바꿈(임은지·남지현 신고) — 헤드라인/서브카피 입력 개행을 발행물에 반영(hero classic과 동일 규칙). alt는 위에서 순수 이스케이프 사용.
  const head = escapeHtml(props.headline || '').replace(/\n/g, '<br>');
  const sub = escapeHtml(props.sub_copy || '').replace(/\n/g, '<br>');
  return `<div class="dm-section dm-hero" data-section-type="hero" style="position:relative;min-height:${heightPx};overflow:hidden;background:${baseBg}">
    ${img ? `<img class="dm-hero-media" src="${escapeHtml(img)}" alt="${escapeHtml(props.headline || '')}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;${heroFocusCss(props)}">` : ''}
    ${img ? `<div style="position:absolute;inset:0;background:${props.overlay ? heroOverlayCss(props) : 'rgba(0,0,0,0.32)'}"></div>` : ''}
    <div style="position:relative;min-height:${heightPx};display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:var(--dm-sp-6) var(--dm-sp-5);color:#fff">
      ${head ? `<div style="font-size:var(--dm-fs-hero);font-weight:var(--dm-fw-hero);letter-spacing:var(--dm-ls-hero);line-height:1.1;font-family:var(--dm-font-display)${fsDecl(props.headline_size)}${props.headline_color ? `;color:${escapeHtml(props.headline_color)}` : ''}">${emphasizeHead(head, props.headline_emphasis)}</div>` : ''}
      ${sub ? `<div style="margin-top:var(--dm-sp-3);font-size:var(--dm-fs-body);opacity:0.92${fsDecl(props.sub_copy_size)}${props.sub_copy_color ? `;color:${escapeHtml(props.sub_copy_color)}` : ''}">${sub}</div>` : ''}
    </div>
  </div>`;
}

// 분할: 상단 컬러 타입 블록 + 하단 이미지.
function renderHeroSplit(props: HeroProps): string {
  const img = props.image_url ? publicImageUrl(props.image_url) : '';
  // ★ 2026-07-14 줄바꿈(임은지·남지현 신고) — 헤드라인/서브카피 입력 개행을 발행물에 반영(hero classic과 동일 규칙). alt는 위에서 순수 이스케이프 사용.
  const head = escapeHtml(props.headline || '').replace(/\n/g, '<br>');
  const sub = escapeHtml(props.sub_copy || '').replace(/\n/g, '<br>');
  return `<div class="dm-section dm-hero" data-section-type="hero" style="background:var(--dm-bg)">
    <div style="background:var(--dm-primary);color:#fff;padding:calc(var(--dm-sp-8) * var(--dm-section-pad-scale)) var(--dm-sp-5)">
      ${head ? `<div style="font-size:var(--dm-fs-hero);font-weight:var(--dm-fw-hero);letter-spacing:var(--dm-ls-hero);line-height:1.12;font-family:var(--dm-font-display)${fsDecl(props.headline_size)}${props.headline_color ? `;color:${escapeHtml(props.headline_color)}` : ''}">${head}</div>` : ''}
      ${sub ? `<div style="margin-top:var(--dm-sp-2);font-size:var(--dm-fs-body);opacity:0.9${fsDecl(props.sub_copy_size)}${props.sub_copy_color ? `;color:${escapeHtml(props.sub_copy_color)}` : ''}">${sub}</div>` : ''}
    </div>
    ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(props.headline || '')}" style="width:100%;display:block;object-fit:cover">` : `<div class="dm-mood-slot" style="height:200px;display:flex;align-items:center;justify-content:center">이미지를 추가해주세요</div>`}
  </div>`;
}

// 에디토리얼 오버랩: 이미지 위에 헤드라인 카드가 겹침.
function renderHeroOverlap(props: HeroProps): string {
  const img = props.image_url ? publicImageUrl(props.image_url) : '';
  // ★ 2026-07-14 줄바꿈(임은지·남지현 신고) — 헤드라인/서브카피 입력 개행을 발행물에 반영(hero classic과 동일 규칙). alt는 위에서 순수 이스케이프 사용.
  const head = escapeHtml(props.headline || '').replace(/\n/g, '<br>');
  const sub = escapeHtml(props.sub_copy || '').replace(/\n/g, '<br>');
  // ★ 2026-07-10 임은지 신고: "버튼 색" 지정 시 오버랩 카드 면에 반영 — 강조 면 변수 폴백(미지정=기존 흰 카드, 캔버스 미러)
  return `<div class="dm-section dm-hero" data-section-type="hero" style="background:var(--dm-bg);padding-bottom:var(--dm-sp-5)">
    ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(props.headline || '')}" style="width:100%;display:block;height:280px;object-fit:cover">` : `<div class="dm-mood-slot" style="height:240px"></div>`}
    <div style="margin:-32px var(--dm-sp-5) 0;position:relative;background:var(--dm-accent-surface, var(--dm-bg));border:1px solid var(--dm-accent-surface, var(--dm-neutral-200));border-radius:var(--dm-radius-xl);box-shadow:var(--dm-shadow-lg);padding:var(--dm-sp-6)">
      ${head ? `<div style="font-size:var(--dm-fs-h1);font-weight:var(--dm-fw-hero);letter-spacing:var(--dm-ls-hero);line-height:1.2;font-family:var(--dm-font-display);color:var(--dm-accent-surface-fg, var(--dm-neutral-900))${fsDecl(props.headline_size)}${props.headline_color ? `;color:${escapeHtml(props.headline_color)}` : ''}">${head}</div>` : ''}
      ${sub ? `<div style="margin-top:var(--dm-sp-2);font-size:var(--dm-fs-body);color:var(--dm-accent-surface-sub, var(--dm-neutral-600))${fsDecl(props.sub_copy_size)}${props.sub_copy_color ? `;color:${escapeHtml(props.sub_copy_color)}` : ''}">${sub}</div>` : ''}
    </div>
  </div>`;
}

// ★ 2026-06-25 (P1) coupon treatment 디스패처. 미설정/미허용=classic(현행).
function renderCoupon(props: CouponProps, treatment?: string): string {
  switch (treatment) {
    case 'ticket': return renderCouponTicket(props);
    case 'spotlight': return renderCouponSpotlight(props);
    default: return renderCouponClassic(props);
  }
}

function couponMeta(props: CouponProps): string {
  const expire = props.expire_date ? formatKoreanDate(props.expire_date) : '';
  return `${expire ? `<div class="dm-text-small" style="margin-top:var(--dm-sp-3);color:var(--dm-neutral-500)">유효기간: ~ ${escapeHtml(expire)}</div>` : ''}
      ${props.min_purchase ? `<div class="dm-text-small" style="margin-top:var(--dm-sp-1);color:var(--dm-neutral-500)">${Number(props.min_purchase).toLocaleString('ko-KR')}원 이상 구매 시</div>` : ''}
      ${props.usage_condition ? `<div class="dm-text-tiny" style="margin-top:var(--dm-sp-2);color:var(--dm-neutral-500);white-space:pre-wrap">${escapeHtml(props.usage_condition)}</div>` : ''}`;
}

function renderCouponClassic(props: CouponProps): string {
  const discountLabel = escapeHtml(props.discount_label || '');
  const code = props.coupon_code ? escapeHtml(props.coupon_code) : '';

  // ★ 2026-07-02(5) 발행물 디자인 격상 — 이메일 톤: 점선 테두리 카드 → 정돈된 카드 + 코드 점선 분리
  // ★ 2026-07-13 디자인 3.0 — dm-coupon-card = 샤인 스윕 모션 훅
  return `<div class="dm-section dm-coupon" data-section-type="coupon" style="padding:var(--dm-sp-8) var(--dm-sp-5);background:var(--dm-primary-light)">
    <div class="dm-coupon-card" style="background:var(--dm-bg);border:1px solid var(--dm-neutral-200);border-radius:20px;box-shadow:var(--dm-shadow-md);padding:var(--dm-sp-8) var(--dm-sp-6)">
      <div style="font-size:var(--dm-fs-tiny);font-weight:700;letter-spacing:3px;color:var(--dm-neutral-500);margin-bottom:var(--dm-sp-3)">COUPON</div>
      <div class="dm-text-hero" style="color:var(--dm-primary);font-weight:900;font-family:var(--dm-font-display)">${discountLabel}</div>
      ${code ? `<div style="margin-top:var(--dm-sp-4);border-top:1px dashed var(--dm-neutral-300);padding-top:var(--dm-sp-4)"><span style="background:#171717;color:#fff;display:inline-block;padding:var(--dm-sp-2) var(--dm-sp-6);border-radius:999px;font-family:var(--dm-font-mono);font-size:var(--dm-fs-h3);font-weight:700;letter-spacing:3px">${code}</span></div>` : ''}
      ${couponMeta(props)}
      ${props.cta_url ? `<div style="margin-top:var(--dm-sp-5)"><a href="${safeUrl(props.cta_url)}" class="dm-cta dm-cta-primary" target="_blank" style="width:100%;max-width:280px">쿠폰 사용하기</a></div>` : ''}
    </div>
  </div>`;
}

// 티켓: 좌우 노치(원형 컷)로 입장권 느낌 + 점선 분리.
function renderCouponTicket(props: CouponProps): string {
  const discountLabel = escapeHtml(props.discount_label || '');
  const code = props.coupon_code ? escapeHtml(props.coupon_code) : '';
  const notch = 'radial-gradient(circle at 0 50%, transparent 10px, var(--dm-bg) 11px) left/51% 100% no-repeat, radial-gradient(circle at 100% 50%, transparent 10px, var(--dm-bg) 11px) right/51% 100% no-repeat';
  return `<div class="dm-section dm-coupon" data-section-type="coupon" style="padding:calc(var(--dm-sp-6) * var(--dm-section-pad-scale)) var(--dm-sp-5);background:var(--dm-primary-light)">
    <div class="dm-coupon-card" style="background:${notch};box-shadow:var(--dm-shadow-md);border-radius:var(--dm-radius-lg);padding:var(--dm-sp-6) var(--dm-sp-8)">
      <div style="font-size:var(--dm-fs-hero);font-weight:900;color:var(--dm-primary);font-family:var(--dm-font-display)">${discountLabel}</div>
      ${code ? `<div style="margin-top:var(--dm-sp-4);border-top:1px dashed var(--dm-neutral-300);padding-top:var(--dm-sp-4);font-family:var(--dm-font-mono);font-size:var(--dm-fs-h2);font-weight:700;letter-spacing:3px;color:var(--dm-neutral-900)">${code}</div>` : ''}
      ${couponMeta(props)}
      ${props.cta_url ? `<div style="margin-top:var(--dm-sp-4)"><a href="${safeUrl(props.cta_url)}" class="dm-cta dm-cta-primary" target="_blank">쿠폰 사용하기</a></div>` : ''}
    </div>
  </div>`;
}

// 스포트라이트: 코드 자체를 대형으로 강조(어두운 배경 + 모노 대문자).
function renderCouponSpotlight(props: CouponProps): string {
  const discountLabel = escapeHtml(props.discount_label || '');
  const code = props.coupon_code ? escapeHtml(props.coupon_code) : '';
  // ★ 2026-07-13 다크 패널 = 리터럴 고정(#171717 — 기존 var(--dm-neutral-900)와 동일값). 다크 테마 반전 시에도 어두운 패널 유지.
  return `<div class="dm-section dm-coupon dm-coupon-card" data-section-type="coupon" style="padding:calc(var(--dm-sp-8) * var(--dm-section-pad-scale)) var(--dm-sp-5);background:#171717;color:#fff">
    ${discountLabel ? `<div style="font-size:var(--dm-fs-h3);font-weight:700;color:var(--dm-accent);letter-spacing:1px">${discountLabel}</div>` : ''}
    ${code ? `<div style="margin-top:var(--dm-sp-3);font-family:var(--dm-font-mono);font-size:var(--dm-fs-hero);font-weight:900;letter-spacing:4px">${code}</div>` : ''}
    <div style="margin-top:var(--dm-sp-2);color:var(--dm-neutral-400)">${couponMeta(props)}</div>
    ${props.cta_url ? `<div style="margin-top:var(--dm-sp-5)"><a href="${safeUrl(props.cta_url)}" class="dm-cta dm-cta-primary" target="_blank">쿠폰 사용하기</a></div>` : ''}
  </div>`;
}

// ★ 2026-07-13 디자인 3.0 — countdown treatment 디스패처 (classic/banner)
function renderCountdown(props: CountdownProps, treatment?: string): string {
  if (treatment === 'banner') return renderCountdownBanner(props);
  return renderCountdownClassic(props);
}

function renderCountdownClassic(props: CountdownProps): string {
  const end = props.end_datetime || '';
  const urgency = escapeHtml(props.urgency_text || '마감까지');
  // 2026-07-09: 배경색·상단문구 글씨색 (미지정 = 기본 다크/accent). ★ 2026-07-13 다크 패널 리터럴 고정(#171717 = 기존 var 값 동일)
  const cdBg = props.background_color ? escapeHtml(props.background_color) : '#171717';
  const cdUrgencyColor = props.urgency_color ? escapeHtml(props.urgency_color) : 'var(--dm-accent)';

  // ★ 2026-07-02(5) 발행물 디자인 격상 — 이메일 톤: 중앙 정렬 + 자간 라벨 + 여백 리듬 + 절제된 타일
  return `<div class="dm-section dm-countdown" data-section-type="countdown" data-end="${escapeHtml(end)}" style="padding:var(--dm-sp-8) var(--dm-sp-5);background:${cdBg};color:#fff">
    <div style="font-size:var(--dm-fs-small);font-weight:700;letter-spacing:3px;color:${cdUrgencyColor};margin-bottom:var(--dm-sp-5)">${urgency}</div>
    <div class="dm-countdown-display" style="display:flex;gap:var(--dm-sp-2);justify-content:var(--dm-section-justify,center);flex-wrap:wrap;align-items:stretch">
      ${props.show_days    ? `<div class="cd-unit"><div class="cd-num" data-unit="d">00</div><div class="cd-lbl">일</div></div>` : ''}
      ${props.show_hours   ? `<div class="cd-unit"><div class="cd-num" data-unit="h">00</div><div class="cd-lbl">시간</div></div>` : ''}
      ${props.show_minutes ? `<div class="cd-unit"><div class="cd-num" data-unit="m">00</div><div class="cd-lbl">분</div></div>` : ''}
      ${props.show_seconds ? `<div class="cd-unit"><div class="cd-num" data-unit="s">00</div><div class="cd-lbl">초</div></div>` : ''}
    </div>
  </div>`;
}

// ★ 2026-07-13 디자인 3.0 — 배너 구도: 슬림 인라인 스트립(본문 흐름을 끊지 않는 긴박 배너)
function renderCountdownBanner(props: CountdownProps): string {
  const end = props.end_datetime || '';
  const urgency = escapeHtml(props.urgency_text || '마감까지');
  const cdBg = props.background_color ? escapeHtml(props.background_color) : '#171717';
  const cdUrgencyColor = props.urgency_color ? escapeHtml(props.urgency_color) : 'var(--dm-accent)';
  const unit = (u: string, lbl: string) =>
    `<span style="display:inline-flex;align-items:baseline;gap:2px"><span class="cd-num" data-unit="${u}" style="font-size:20px;letter-spacing:0">00</span><span style="font-size:10px;opacity:0.55">${lbl}</span></span>`;
  return `<div class="dm-section dm-countdown" data-section-type="countdown" data-end="${escapeHtml(end)}" style="padding:var(--dm-sp-4) var(--dm-sp-5);background:${cdBg};color:#fff;display:flex;align-items:center;justify-content:space-between;gap:var(--dm-sp-3);flex-wrap:wrap">
    <div style="font-size:var(--dm-fs-small);font-weight:700;letter-spacing:2px;color:${cdUrgencyColor}">${urgency}</div>
    <div class="dm-countdown-display" style="display:flex;gap:var(--dm-sp-3);align-items:baseline">
      ${props.show_days ? unit('d', '일') : ''}${props.show_hours ? unit('h', '시간') : ''}${props.show_minutes ? unit('m', '분') : ''}${props.show_seconds ? unit('s', '초') : ''}
    </div>
  </div>`;
}

// ★ 2026-06-25 (P1) text_card treatment 디스패처. 미설정/미허용=classic(현행). ★ 2026-07-13 quote 추가.
function renderTextCard(props: TextCardProps, treatment?: string): string {
  switch (treatment) {
    case 'lead': return renderTextCardLead(props);
    case 'framed': return renderTextCardFramed(props);
    case 'quote': return renderTextCardQuote(props);
    default: return renderTextCardClassic(props);
  }
}

// ★ 2026-07-13 디자인 3.0 — 인용 구도: 대형 따옴표 + 세리프 인용문 (브랜드 스토리·고객 후기 한 줄용)
function renderTextCardQuote(props: TextCardProps): string {
  const head = props.headline ? emphasizeHead(escapeHtml(props.headline).replace(/\n/g, '<br>'), props.headline_emphasis) : '';
  const body = props.body ? escapeHtml(props.body) : '';
  const tag = props.tag ? escapeHtml(props.tag) : '';
  return `<div class="dm-section dm-text-card" data-section-type="text_card" style="background:var(--dm-bg);padding:calc(var(--dm-sp-8) * var(--dm-section-pad-scale)) var(--dm-sp-6)">
    <div aria-hidden="true" style="font-family:var(--dm-font-display);font-size:52px;line-height:0.6;color:var(--dm-accent);opacity:0.85">&ldquo;</div>
    ${head ? `<div style="margin-top:var(--dm-sp-3);font-size:var(--dm-fs-h2);font-weight:700;line-height:1.5;font-family:var(--dm-font-display);color:var(--dm-neutral-900)${fsDecl(props.headline_size)}${props.headline_color ? `;color:${escapeHtml(props.headline_color)}` : ''}">${head}</div>` : ''}
    ${body ? `<div style="margin-top:var(--dm-sp-3);font-size:var(--dm-fs-small);color:var(--dm-neutral-500);white-space:pre-wrap${fsDecl(props.body_size)}${props.body_color ? `;color:${escapeHtml(props.body_color)}` : ''}">${body}</div>` : ''}
    ${tag ? `<div style="margin-top:var(--dm-sp-4);font-size:var(--dm-fs-tiny);font-weight:700;letter-spacing:2px;color:var(--dm-primary)">${tag}</div>` : ''}
  </div>`;
}

function renderTextCardClassic(props: TextCardProps): string {
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
    ${props.headline ? `<div class="dm-text-h2" style="color:var(--dm-neutral-900);margin-bottom:var(--dm-sp-2)${fsDecl(props.headline_size)}${props.headline_color ? `;color:${escapeHtml(props.headline_color)}` : ''}">${emphasizeHead(escapeHtml(props.headline).replace(/\n/g, '<br>'), props.headline_emphasis)}</div>` : ''}
    ${props.body ? `<div class="dm-text-body" style="color:var(--dm-neutral-700);white-space:pre-wrap${fsDecl(props.body_size)}${props.body_color ? `;color:${escapeHtml(props.body_color)}` : ''}">${escapeHtml(props.body)}</div>` : ''}
  </div>`;

  return `<div class="dm-section dm-text-card" data-section-type="text_card" style="padding:0;background:var(--dm-bg)">
    <div style="display:flex;flex-direction:${flexDir};gap:${isHoriz ? 'var(--dm-sp-3)' : '0'};padding:${pos === 'top' || pos === 'bottom' ? '0' : 'var(--dm-sp-4) var(--dm-sp-5)'}">
      ${imgBlock}
      ${textBlock}
    </div>
  </div>`;
}

// ★ 2026-06-25 (P1) cta treatment 디스패처. 미설정/미허용=classic(현행). ★ 2026-07-13 sticky 추가.
function renderCta(props: CtaProps, treatment?: string): string {
  switch (treatment) {
    case 'bar': return renderCtaBar(props);
    case 'ghost': return renderCtaGhost(props);
    case 'sticky': return renderCtaSticky(props);
    default: return renderCtaClassic(props);
  }
}

// ★ 2026-07-13 디자인 3.0 — 스티키 바: 스크롤 내내 하단 고정(래퍼 .dm-sticky-cta가 position:sticky 담당)
function renderCtaSticky(props: CtaProps): string {
  const buttons = Array.isArray(props.buttons) ? props.buttons : [];
  if (buttons.length === 0) return '';
  const b = buttons[0];
  return `<div class="dm-section dm-cta-section" data-section-type="cta" style="padding:var(--dm-sp-3) var(--dm-sp-4)">
    <a href="${safeUrl(b.url)}" target="_blank" class="dm-sticky-bar" style="display:flex;align-items:center;justify-content:center;gap:var(--dm-sp-2);background:color-mix(in srgb, var(--dm-primary) 92%, transparent);color:#fff;padding:var(--dm-sp-4) var(--dm-sp-6);font-size:var(--dm-fs-body);font-weight:800;letter-spacing:-0.01em;border-radius:999px;box-shadow:0 10px 30px -8px color-mix(in srgb, var(--dm-primary) 60%, transparent)">
      <span>${escapeHtml(b.label || '자세히 보기')}</span>
      <span aria-hidden="true">→</span>
    </a>
  </div>`;
}

function renderCtaClassic(props: CtaProps): string {
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

// 리드: 대형 헤드라인 + 규칙선 + 본문(에디토리얼, 이미지 비중 낮춤).
function renderTextCardLead(props: TextCardProps): string {
  const tag = props.tag ? escapeHtml(props.tag) : '';
  const head = props.headline ? escapeHtml(props.headline).replace(/\n/g, '<br>') : '';
  const body = props.body ? escapeHtml(props.body) : '';
  const align = props.align || 'left';
  return `<div class="dm-section dm-text-card" data-section-type="text_card" style="background:var(--dm-bg);padding:calc(var(--dm-sp-8) * var(--dm-section-pad-scale)) var(--dm-sp-5);text-align:${align}">
    ${tag ? `<div style="font-size:var(--dm-fs-tiny);font-weight:700;letter-spacing:2px;color:var(--dm-primary);margin-bottom:var(--dm-sp-3)">${tag}</div>` : ''}
    ${head ? `<div style="font-size:var(--dm-fs-h1);font-weight:var(--dm-fw-hero);letter-spacing:var(--dm-ls-hero);line-height:1.25;font-family:var(--dm-font-display);color:var(--dm-neutral-900)${fsDecl(props.headline_size)}${props.headline_color ? `;color:${escapeHtml(props.headline_color)}` : ''}">${emphasizeHead(head, props.headline_emphasis)}</div>` : ''}
    <div style="height:2px;width:40px;background:var(--dm-primary);margin:var(--dm-sp-4) ${align === 'center' ? 'auto' : '0'}"></div>
    ${body ? `<div style="font-size:var(--dm-fs-body);line-height:1.7;color:var(--dm-neutral-700);white-space:pre-wrap${fsDecl(props.body_size)}${props.body_color ? `;color:${escapeHtml(props.body_color)}` : ''}">${body}</div>` : ''}
  </div>`;
}

// 프레임: 좌측 악센트 + 테두리 카드.
function renderTextCardFramed(props: TextCardProps): string {
  const tag = props.tag ? escapeHtml(props.tag) : '';
  const head = props.headline ? escapeHtml(props.headline).replace(/\n/g, '<br>') : '';
  const body = props.body ? escapeHtml(props.body) : '';
  const img = props.image_url ? publicImageUrl(props.image_url) : '';
  const align = props.align || 'left';
  return `<div class="dm-section dm-text-card" data-section-type="text_card" style="background:var(--dm-bg);padding:var(--dm-sp-5)">
    <div style="border:1px solid var(--dm-neutral-200);border-left:4px solid var(--dm-primary);border-radius:var(--dm-radius-lg);overflow:hidden;text-align:${align}">
      ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(props.headline || '')}" style="width:100%;display:block">` : ''}
      <div style="padding:var(--dm-sp-5)">
        ${tag ? `<div style="display:inline-block;background:var(--dm-primary-light);color:var(--dm-primary);padding:var(--dm-sp-1) var(--dm-sp-2);border-radius:var(--dm-radius-sm);font-size:var(--dm-fs-tiny);font-weight:700;margin-bottom:var(--dm-sp-2)">${tag}</div>` : ''}
        ${head ? `<div style="font-size:var(--dm-fs-h2);font-weight:700;color:var(--dm-neutral-900);margin-bottom:var(--dm-sp-2);font-family:var(--dm-font-display)${fsDecl(props.headline_size)}${props.headline_color ? `;color:${escapeHtml(props.headline_color)}` : ''}">${emphasizeHead(head, props.headline_emphasis)}</div>` : ''}
        ${body ? `<div style="font-size:var(--dm-fs-body);line-height:1.65;color:var(--dm-neutral-700);white-space:pre-wrap${fsDecl(props.body_size)}${props.body_color ? `;color:${escapeHtml(props.body_color)}` : ''}">${body}</div>` : ''}
      </div>
    </div>
  </div>`;
}

// 바: 악센트 바 + 화살표(첫 버튼 강조).
// ★ 2026-07-02(5) 발행물 디자인 격상 — 화면 끝까지 붙던 원색 띠 → 여백 안 라운드 바 + 원형 화살표
function renderCtaBar(props: CtaProps): string {
  const buttons = Array.isArray(props.buttons) ? props.buttons : [];
  if (buttons.length === 0) return '';
  const b = buttons[0];
  const more = buttons.slice(1);
  const moreHtml = more.map((x) => `<a href="${safeUrl(x.url)}" class="dm-cta dm-cta-secondary" target="_blank">${escapeHtml(x.label || '자세히 보기')}</a>`).join('');
  return `<div class="dm-section dm-cta-section" data-section-type="cta" style="padding:var(--dm-sp-5)">
    <a href="${safeUrl(b.url)}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;gap:var(--dm-sp-3);background:var(--dm-primary);color:#fff;padding:var(--dm-sp-5) var(--dm-sp-6);font-size:var(--dm-fs-h3);font-weight:700;letter-spacing:-0.01em;border-radius:16px;box-shadow:var(--dm-shadow-md)">
      <span>${escapeHtml(b.label || '자세히 보기')}</span>
      <span aria-hidden="true" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.18);display:inline-flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">→</span>
    </a>
    ${moreHtml ? `<div style="display:flex;flex-direction:column;gap:var(--dm-sp-2);padding:var(--dm-sp-4) 0 0">${moreHtml}</div>` : ''}
  </div>`;
}

// 고스트: 아웃라인 대형 라벨.
function renderCtaGhost(props: CtaProps): string {
  const buttons = Array.isArray(props.buttons) ? props.buttons : [];
  if (buttons.length === 0) return '';
  const btnHtml = buttons.map((b) => `<a href="${safeUrl(b.url)}" target="_blank" style="display:block;text-align:center;border:2px solid var(--dm-primary);color:var(--dm-primary);border-radius:var(--dm-radius-lg);padding:var(--dm-sp-4);font-size:var(--dm-fs-body);font-weight:700;letter-spacing:0.5px">${escapeHtml(b.label || '자세히 보기')}</a>`).join('');
  return `<div class="dm-section dm-cta-section" data-section-type="cta" style="padding:calc(var(--dm-sp-6) * var(--dm-section-pad-scale)) var(--dm-sp-5)">
    <div style="display:flex;flex-direction:column;gap:var(--dm-sp-3)">${btnHtml}</div>
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

// ★ 2026-07-13 디자인 3.0 — store_info treatment 디스패처 (classic / card)
function renderStoreInfo(props: StoreInfoProps, treatment?: string): string {
  if (treatment === 'card') return renderStoreInfoCard(props);
  return renderStoreInfoClassic(props);
}

// 카드: 라운드 카드 안에 정보 행 — 풋터 직전 마감 카드용
function renderStoreInfoCard(props: StoreInfoProps): string {
  const row = (label: string, value: string) =>
    `<div style="display:flex;gap:var(--dm-sp-3);align-items:baseline"><span style="flex:0 0 56px;font-size:var(--dm-fs-tiny);font-weight:700;letter-spacing:1px;color:var(--dm-primary)">${label}</span><span style="font-size:var(--dm-fs-small);color:var(--dm-neutral-700)">${value}</span></div>`;
  const rows: string[] = [];
  if (props.phone) rows.push(row('전화', `<a href="tel:${escapeHtml(props.phone)}" style="color:var(--dm-neutral-800);font-weight:600">${escapeHtml(props.phone)}</a>`));
  if (props.website) rows.push(row('웹', `<a href="${safeUrl(props.website)}" target="_blank" style="color:var(--dm-neutral-800)">${escapeHtml(props.website.replace(/^https?:\/\//, ''))}</a>`));
  if (props.email) rows.push(row('메일', `<a href="mailto:${escapeHtml(props.email)}" style="color:var(--dm-neutral-800)">${escapeHtml(props.email)}</a>`));
  if (props.address) rows.push(row('주소', escapeHtml(props.address)));
  if (props.business_hours) rows.push(row('영업', escapeHtml(props.business_hours)));
  if (rows.length === 0) return '';
  return `<div class="dm-section dm-store-info" data-section-type="store_info" style="padding:var(--dm-sp-5)">
    <div style="background:var(--dm-neutral-50);border:1px solid var(--dm-neutral-200);border-radius:18px;padding:var(--dm-sp-5);display:flex;flex-direction:column;gap:var(--dm-sp-3);text-align:left;box-shadow:var(--dm-shadow-sm)">
      ${rows.join('')}
      ${props.map_url ? `<div style="margin-top:var(--dm-sp-2)"><a href="${safeUrl(props.map_url)}" target="_blank" class="dm-cta dm-cta-outline" style="width:100%;display:block;text-align:center">매장 위치 보기</a></div>` : ''}
    </div>
  </div>`;
}

function renderStoreInfoClassic(props: StoreInfoProps): string {
  const items: string[] = [];
  if (props.phone) items.push(`<a href="tel:${escapeHtml(props.phone)}" style="color:var(--dm-primary)"><strong>전화</strong> ${escapeHtml(props.phone)}</a>`);
  if (props.website) items.push(`<a href="${safeUrl(props.website)}" target="_blank" style="color:var(--dm-primary)"><strong>홈페이지</strong> ${escapeHtml(props.website.replace(/^https?:\/\//, ''))}</a>`);
  if (props.email) items.push(`<a href="mailto:${escapeHtml(props.email)}" style="color:var(--dm-primary)"><strong>이메일</strong> ${escapeHtml(props.email)}</a>`);
  if (props.address) items.push(`<span><strong>주소</strong> ${escapeHtml(props.address)}</span>`);
  if (props.business_hours) items.push(`<span><strong>영업시간</strong> ${escapeHtml(props.business_hours)}</span>`);

  if (items.length === 0) return '';

  return `<div class="dm-section dm-store-info" data-section-type="store_info" style="padding:var(--dm-sp-6) var(--dm-sp-5);background:var(--dm-neutral-50);border-top:1px solid var(--dm-neutral-200)">
    <div style="display:flex;flex-direction:column;gap:var(--dm-sp-3);font-size:var(--dm-fs-small);line-height:1.6;color:var(--dm-neutral-700)">
      ${items.join('')}
    </div>
    ${props.map_url ? `<div style="margin-top:var(--dm-sp-4);text-align:center"><a href="${safeUrl(props.map_url)}" target="_blank" class="dm-cta dm-cta-outline">매장 위치 보기</a></div>` : ''}
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
  const snsColors: Record<string, string> = {
    instagram: '#e1306c', youtube: '#ff0000', kakao: '#f5c400',
    naver: '#03c75a', facebook: '#1877f2', twitter: '#1da1f2',
  };

  // ★ 2026-07-07(5) 디자인 2.0 — 이모지 아이콘 폐기 → 브랜드색 점 + 라벨 알약 칩 (프론트 SnsSection 미러 동기)
  const items = channels.map((ch) => {
    const color = snsColors[ch.type] || 'var(--dm-neutral-700)';
    const label = snsLabels[ch.type] || ch.type;
    const dot = `<span style="width:7px;height:7px;border-radius:999px;background:${color};flex-shrink:0"></span>`;
    if (isIconMode) {
      return `<a href="${safeUrl(ch.url)}" target="_blank" title="${escapeHtml(label)}" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:999px;background:var(--dm-neutral-100);border:1px solid var(--dm-neutral-200);color:var(--dm-neutral-800);font-size:var(--dm-fs-small);font-weight:700;text-decoration:none">${dot}<span>${escapeHtml(label)}</span></a>`;
    }
    return `<a href="${safeUrl(ch.url)}" target="_blank" style="display:flex;align-items:center;gap:var(--dm-sp-2);padding:var(--dm-sp-3) var(--dm-sp-5);border-radius:999px;background:var(--dm-neutral-100);border:1px solid var(--dm-neutral-200);color:var(--dm-neutral-800);text-decoration:none;font-weight:700">${dot}<span>${escapeHtml(label)}</span>${ch.handle ? `<span style="color:var(--dm-neutral-500);font-weight:500">@${escapeHtml(ch.handle)}</span>` : ''}</a>`;
  }).join('');

  return `<div class="dm-section dm-sns" data-section-type="sns" style="padding:var(--dm-sp-5);background:var(--dm-bg)">
    <div style="display:flex;flex-wrap:wrap;gap:var(--dm-sp-3);${isIconMode ? 'justify-content:var(--dm-section-justify,center)' : 'flex-direction:column;align-items:var(--dm-section-justify,center)'}">${items}</div>
  </div>`;
}

// ★ 2026-07-13 디자인 3.0 — promo_code treatment 디스패처 (classic 다크 / light 라이트 카드)
function renderPromoCode(props: PromoCodeProps, treatment?: string): string {
  if (!props.code) return '';
  if (treatment === 'light') return renderPromoCodeLight(props);

  // ★ 2026-07-02 v2 — 원색 그라데이션 도배 → 다크 에디토리얼 패널 + 대형 모노 코드
  // ★ 2026-07-13 다크 패널 = 리터럴 고정(#171717 = 기존 var(--dm-neutral-900) 동일값 — 다크 테마 반전 안전)
  return `<div class="dm-section dm-promo-code" data-section-type="promo_code" style="padding:var(--dm-sp-8) var(--dm-sp-5);background:#171717;color:#fff">
    <div class="dm-overline" style="color:var(--dm-accent);margin-bottom:var(--dm-sp-3)">PROMO CODE</div>
    ${props.description ? `<div class="dm-text-h3" style="font-weight:600;margin-bottom:var(--dm-sp-4);opacity:0.92">${escapeHtml(props.description)}</div>` : ''}
    <div style="font-family:var(--dm-font-mono);font-size:var(--dm-fs-h1);font-weight:800;letter-spacing:5px;padding:var(--dm-sp-3) var(--dm-sp-5);border:1px dashed rgba(255,255,255,0.35);border-radius:14px;display:inline-block">${escapeHtml(props.code)}</div>
    ${props.instructions ? `<div class="dm-text-small" style="margin-top:var(--dm-sp-4);color:rgba(255,255,255,0.65)">${escapeHtml(props.instructions)}</div>` : ''}
    ${props.cta_url ? `<div style="margin-top:var(--dm-sp-5)"><a href="${safeUrl(props.cta_url)}" class="dm-cta" style="background:#fff;color:#171717" target="_blank">${escapeHtml(props.cta_label || '지금 사용하기')}</a></div>` : ''}
  </div>`;
}

// 라이트: 브랜드색 테두리 카드 + 프라이머리 코드 (밝은 톤 DM용)
function renderPromoCodeLight(props: PromoCodeProps): string {
  return `<div class="dm-section dm-promo-code" data-section-type="promo_code" style="padding:calc(var(--dm-sp-6) * var(--dm-section-pad-scale)) var(--dm-sp-5);background:var(--dm-bg)">
    <div style="border:2px solid color-mix(in srgb, var(--dm-primary) 35%, transparent);border-radius:20px;padding:var(--dm-sp-6);box-shadow:var(--dm-shadow-sm)">
      <div class="dm-overline" style="color:var(--dm-primary);margin-bottom:var(--dm-sp-3)">PROMO CODE</div>
      ${props.description ? `<div class="dm-text-h3" style="font-weight:600;margin-bottom:var(--dm-sp-4);color:var(--dm-neutral-800)">${escapeHtml(props.description)}</div>` : ''}
      <div style="font-family:var(--dm-font-mono);font-size:var(--dm-fs-h1);font-weight:800;letter-spacing:5px;padding:var(--dm-sp-3) var(--dm-sp-5);border:1px dashed color-mix(in srgb, var(--dm-primary) 45%, transparent);border-radius:14px;display:inline-block;color:var(--dm-primary)">${escapeHtml(props.code)}</div>
      ${props.instructions ? `<div class="dm-text-small" style="margin-top:var(--dm-sp-4);color:var(--dm-neutral-500)">${escapeHtml(props.instructions)}</div>` : ''}
      ${props.cta_url ? `<div style="margin-top:var(--dm-sp-5)"><a href="${safeUrl(props.cta_url)}" class="dm-cta dm-cta-primary" target="_blank">${escapeHtml(props.cta_label || '지금 사용하기')}</a></div>` : ''}
    </div>
  </div>`;
}

function renderFooter(props: FooterProps, ctx: SectionRenderContext): string {
  const unsubLink = props.show_unsubscribe_link !== false
    ? `<a href="/api/unsubscribes/form" target="_blank" style="color:var(--dm-neutral-500);text-decoration:underline">수신거부</a>`
    : '';

  // ★ 2026-07-02(5) 발행물 디자인 격상 — 이메일 톤: 중앙 정렬 + 여유 행간 + 넉넉한 여백
  return `<div class="dm-section dm-footer" data-section-type="footer" style="padding:var(--dm-sp-8) var(--dm-sp-6);background:var(--dm-neutral-100);border-top:1px solid var(--dm-neutral-200)">
    ${props.notes ? `<div class="dm-text-small" style="color:var(--dm-neutral-600);margin-bottom:var(--dm-sp-4);white-space:pre-wrap;line-height:1.8">${escapeHtml(props.notes)}</div>` : ''}
    ${props.cs_phone ? `<div class="dm-text-small" style="color:var(--dm-neutral-700);margin-bottom:var(--dm-sp-1)"><strong>고객센터</strong> <a href="tel:${escapeHtml(props.cs_phone)}" style="color:var(--dm-primary);font-weight:600">${escapeHtml(props.cs_phone)}</a></div>` : ''}
    ${props.cs_hours ? `<div class="dm-text-tiny" style="color:var(--dm-neutral-500);margin-bottom:var(--dm-sp-2)">${escapeHtml(props.cs_hours)}</div>` : ''}
    ${props.legal_text ? `<div class="dm-text-tiny" style="color:var(--dm-neutral-500);margin-top:var(--dm-sp-3);white-space:pre-wrap;line-height:1.7">${escapeHtml(props.legal_text)}</div>` : ''}
    <div class="dm-text-tiny" style="color:var(--dm-neutral-400);margin-top:var(--dm-sp-4)">
      ${unsubLink}
    </div>
  </div>`;
}

// ────────────── 디스패처 ──────────────

const RENDERERS: { [K in SectionType]: (props: any, ctx: SectionRenderContext, treatment?: string) => string } = {
  // 기존 11
  header:     renderHeader,
  hero:       (p, _c, t) => renderHero(p, t),
  coupon:     (p, _c, t) => renderCoupon(p, t),
  countdown:  (p, _c, t) => renderCountdown(p, t),
  text_card:  (p, _c, t) => renderTextCard(p, t),
  cta:        (p, _c, t) => renderCta(p, t),
  video:      (p) => renderVideo(p),
  store_info: (p, _c, t) => renderStoreInfo(p, t),
  sns:        (p) => renderSns(p),
  promo_code: (p, _c, t) => renderPromoCode(p, t),
  footer:     (p, c) => renderFooter(p, c),
  // ★ D216+ 신규 16 — SSR placeholder (2 세션 영역 = SSR rendering 영역 강화 의무)
  product_carousel:  (p, _c, t) => renderProductCarousel(p, t),
  gallery:           (p, _c, t) => renderGallery(p, t),
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
  reviews:           (p, _c, t) => renderReviews(p, t),
};

// ────────────── D216+ 신규 16 SSR 렌더링 함수 ──────────────

// ★ 2026-07-13 디자인 3.0 — product_carousel treatment (classic 2열 / focus 첫 상품 대형 / list 컴팩트 행)
function renderProductCarousel(p: any, treatment?: string): string {
  const products = Array.isArray(p?.products) ? p.products : [];
  if (products.length === 0) {
    return `<div class="dm-section dm-product-carousel dm-mood-slot" style="padding:var(--dm-sp-6);text-align:center;color:var(--dm-neutral-400)">[상품을 추가해주세요]</div>`;
  }
  if (treatment === 'list') return renderProductList(p, products);
  if (treatment === 'focus') return renderProductFocus(p, products);
  // ★ 2026-07-02(2) 할인 표시(할인율+할인가+정가 취소선) + 상품 링크(link_url) 카드 전체 연결
  const fitCss = productImgFitCss(p);
  const items = products.map((it: any) => {
    const price = Number(it.price || 0);
    const discount = Number(it.discount_price || 0);
    const rate = computeDmDiscountRate(price, discount, it.discount_rate);
    const finalPrice = discount > 0 ? discount : price;
    // ★ 2026-07-10 임은지 건의: 가격 줄 = 카드 하단 고정(margin-top:auto) — 제품명 길이가 달라도
    //   같은 행 카드들의 가격 위치가 일정(flex row 기본 stretch = 행 높이 동일). 캔버스 미러.
    const priceHtml = rate !== null
      ? `<div style="display:flex;gap:6px;align-items:baseline;margin-top:auto;padding-top:4px;flex-wrap:wrap;font-variant-numeric:tabular-nums">
          <span style="font-size:var(--dm-fs-h3);font-weight:800;color:var(--dm-error)">${rate}%</span>
          <span style="font-size:var(--dm-fs-body);font-weight:800;color:var(--dm-neutral-900)">${finalPrice.toLocaleString('ko-KR')}원</span>
          <span style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-400);text-decoration:line-through">${price.toLocaleString('ko-KR')}원</span>
        </div>`
      : `<div style="font-size:var(--dm-fs-body);font-weight:800;margin-top:auto;padding-top:4px;color:var(--dm-neutral-900);font-variant-numeric:tabular-nums">${finalPrice.toLocaleString('ko-KR')}원</div>`;
    // ★ 2026-07-02 v2 — 라운드 카드 + 가격 타이포 위계(할인율 강조·최종가 굵게) 격상
    const card = `
      ${it.image_url ? `<img src="${escapeHtml(publicImageUrl(it.image_url))}" loading="lazy" alt="${escapeHtml(it.name || '')}" style="width:100%;height:150px;${fitCss};display:block;flex-shrink:0"/>` : `<div style="width:100%;height:150px;background:var(--dm-neutral-100);flex-shrink:0"></div>`}
      <div style="padding:10px 12px 12px;flex:1;display:flex;flex-direction:column">
        <div style="font-size:var(--dm-fs-small);font-weight:600;color:var(--dm-neutral-900);line-height:1.4">${escapeHtml(it.name || '')}</div>
        ${priceHtml}
      </div>`;
    const cardWrapStyle = 'width:calc(50% - 8px);max-width:220px;box-sizing:border-box;display:flex;flex-direction:column;text-decoration:none;color:inherit;background:var(--dm-bg);border:1px solid var(--dm-neutral-200);border-radius:16px;overflow:hidden;box-shadow:var(--dm-shadow-sm)';
    const href = it.link_url ? safeUrl(it.link_url) : '#';
    return href !== '#'
      ? `<a href="${href}" target="_blank" rel="noopener" style="${cardWrapStyle}">${card}</a>`
      : `<div style="${cardWrapStyle}">${card}</div>`;
  }).join('');
  return `<div class="dm-section dm-product-carousel" style="padding:var(--dm-sp-6) var(--dm-sp-5)">
    ${p.title ? `<div class="dm-text-h2" style="color:var(--dm-neutral-900);margin-bottom:var(--dm-sp-4)">${escapeHtml(p.title)}</div>` : ''}
    <div class="dm-pc-items" style="display:flex;flex-wrap:wrap;justify-content:var(--dm-section-justify,center);gap:12px">${items}</div>
  </div>`;
}

// 상품 가격 줄 공통 (focus/list 구도용)
function productPriceHtml(it: any, big: boolean): string {
  const price = Number(it.price || 0);
  const discount = Number(it.discount_price || 0);
  const rate = computeDmDiscountRate(price, discount, it.discount_rate);
  const finalPrice = discount > 0 ? discount : price;
  const rateFs = big ? 'var(--dm-fs-h2)' : 'var(--dm-fs-small)';
  const priceFs = big ? 'var(--dm-fs-h3)' : 'var(--dm-fs-small)';
  return rate !== null
    ? `<div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;font-variant-numeric:tabular-nums">
        <span style="font-size:${rateFs};font-weight:800;color:var(--dm-error)">${rate}%</span>
        <span style="font-size:${priceFs};font-weight:800;color:var(--dm-neutral-900)">${finalPrice.toLocaleString('ko-KR')}원</span>
        <span style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-400);text-decoration:line-through">${price.toLocaleString('ko-KR')}원</span>
      </div>`
    : `<div style="font-size:${priceFs};font-weight:800;color:var(--dm-neutral-900);font-variant-numeric:tabular-nums">${finalPrice.toLocaleString('ko-KR')}원</div>`;
}

// ★ 2026-07-14 상품 이미지 맞춤(남지현 신고) — 채우기(cover 기본·잘릴 수 있음) / 맞추기(contain·전체 보임).
//   정렬(image_focus)은 cover일 때 초점(object-position). 미지정=cover/center = 기존 출력 동일(회귀 0). 캔버스(NewSections imgFit) 미러.
function productImgFitCss(p: any): string {
  if (p?.image_fit === 'contain') return 'object-fit:contain;background:var(--dm-neutral-50)';
  // 기본(cover/center)은 기존과 동일 바이트(object-position 생략 — center center는 CSS 기본). 위/아래만 object-position 부착.
  const focus = p?.image_focus === 'top' ? 'top' : p?.image_focus === 'bottom' ? 'bottom' : null;
  return focus ? `object-fit:cover;object-position:center ${focus}` : 'object-fit:cover';
}

// 포커스: 첫 상품 풀폭 대형 카드 + 나머지 2열 (히어로급 대표 상품 강조)
function renderProductFocus(p: any, products: any[]): string {
  const [first, ...rest] = products;
  const fitCss = productImgFitCss(p);
  const wrapLink = (it: any, inner: string, style: string) => {
    const href = it.link_url ? safeUrl(it.link_url) : '#';
    return href !== '#' ? `<a href="${href}" target="_blank" rel="noopener" style="${style}">${inner}</a>` : `<div style="${style}">${inner}</div>`;
  };
  const bigCard = wrapLink(first, `
    ${first.image_url ? `<img src="${escapeHtml(publicImageUrl(first.image_url))}" loading="lazy" alt="${escapeHtml(first.name || '')}" style="width:100%;height:210px;${fitCss};display:block"/>` : `<div style="width:100%;height:210px;background:var(--dm-neutral-100)"></div>`}
    <div style="padding:14px 16px 16px">
      <div style="font-size:var(--dm-fs-h3);font-weight:700;color:var(--dm-neutral-900);line-height:1.4">${escapeHtml(first.name || '')}</div>
      <div style="margin-top:6px">${productPriceHtml(first, true)}</div>
    </div>`, 'display:block;text-decoration:none;color:inherit;background:var(--dm-bg);border:1px solid var(--dm-neutral-200);border-radius:18px;overflow:hidden;box-shadow:var(--dm-shadow-md);width:100%');
  const restItems = rest.map((it: any) => wrapLink(it, `
      ${it.image_url ? `<img src="${escapeHtml(publicImageUrl(it.image_url))}" loading="lazy" alt="${escapeHtml(it.name || '')}" style="width:100%;height:120px;${fitCss};display:block;flex-shrink:0"/>` : `<div style="width:100%;height:120px;background:var(--dm-neutral-100);flex-shrink:0"></div>`}
      <div style="padding:8px 10px 10px;flex:1;display:flex;flex-direction:column">
        <div style="font-size:var(--dm-fs-small);font-weight:600;color:var(--dm-neutral-900);line-height:1.4">${escapeHtml(it.name || '')}</div>
        <div style="margin-top:auto;padding-top:4px">${productPriceHtml(it, false)}</div>
      </div>`, 'width:calc(50% - 6px);box-sizing:border-box;display:flex;flex-direction:column;text-decoration:none;color:inherit;background:var(--dm-bg);border:1px solid var(--dm-neutral-200);border-radius:14px;overflow:hidden;box-shadow:var(--dm-shadow-sm)')).join('');
  return `<div class="dm-section dm-product-carousel" style="padding:var(--dm-sp-6) var(--dm-sp-5)">
    ${p.title ? `<div class="dm-text-h2" style="color:var(--dm-neutral-900);margin-bottom:var(--dm-sp-4)">${escapeHtml(p.title)}</div>` : ''}
    <div class="dm-pc-items" style="display:flex;flex-wrap:wrap;gap:12px">${bigCard}${restItems}</div>
  </div>`;
}

// 리스트: 좌 썸네일 + 우 정보의 컴팩트 행 (상품 수 많은 DM용)
function renderProductList(p: any, products: any[]): string {
  const fitCss = productImgFitCss(p);
  const rows = products.map((it: any) => {
    const inner = `
      ${it.image_url ? `<img src="${escapeHtml(publicImageUrl(it.image_url))}" loading="lazy" alt="${escapeHtml(it.name || '')}" style="width:76px;height:76px;${fitCss};border-radius:12px;flex-shrink:0"/>` : `<div style="width:76px;height:76px;background:var(--dm-neutral-100);border-radius:12px;flex-shrink:0"></div>`}
      <div style="flex:1;min-width:0;text-align:left">
        <div style="font-size:var(--dm-fs-small);font-weight:600;color:var(--dm-neutral-900);line-height:1.4">${escapeHtml(it.name || '')}</div>
        <div style="margin-top:4px">${productPriceHtml(it, false)}</div>
      </div>
      ${it.link_url ? `<span aria-hidden="true" style="color:var(--dm-neutral-400);flex-shrink:0">→</span>` : ''}`;
    const style = 'display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--dm-bg);border:1px solid var(--dm-neutral-200);border-radius:14px;text-decoration:none;color:inherit';
    const href = it.link_url ? safeUrl(it.link_url) : '#';
    return href !== '#' ? `<a href="${href}" target="_blank" rel="noopener" style="${style}">${inner}</a>` : `<div style="${style}">${inner}</div>`;
  }).join('');
  return `<div class="dm-section dm-product-carousel" style="padding:var(--dm-sp-6) var(--dm-sp-5)">
    ${p.title ? `<div class="dm-text-h2" style="color:var(--dm-neutral-900);margin-bottom:var(--dm-sp-4)">${escapeHtml(p.title)}</div>` : ''}
    <div class="dm-pc-items" style="display:flex;flex-direction:column;gap:10px">${rows}</div>
  </div>`;
}

// ★ 2026-07-13 디자인 3.0 — gallery treatment (classic / mosaic 첫 장 대형 변칙 그리드)
function renderGallery(p: any, treatment?: string): string {
  const images = Array.isArray(p?.images) ? p.images : [];
  if (images.length === 0) {
    return `<div class="dm-section dm-gallery dm-mood-slot" style="padding:var(--dm-sp-6);text-align:center;color:var(--dm-neutral-400)">[이미지를 추가해주세요]</div>`;
  }
  const mosaic = treatment === 'mosaic';
  const isList = !mosaic && p?.layout === 'list_1xN';
  const cols = mosaic ? 2 : p?.layout === 'grid_3x3' ? 3 : isList ? 1 : 2;
  // ★ 2026-07-15 풀화면(full_bleed) = 완성 이미지/디자인 시안을 화면 꽉 채움(패딩·테두리·라운드·간격 0).
  //   미설정=현행 카드 프레임 유지(회귀 0). 완성 이미지 업로드·슬라이드 펼침이 자동 지정.
  const fullBleed = p?.full_bleed === true;
  const radius = fullBleed ? '0' : 'var(--dm-radius-md)';
  const mosaicRadius = fullBleed ? '0' : 'var(--dm-radius-lg)';
  // list_1xN(세로 1열) = 완성 이미지/디자인 시안: 원본 비율 풀폭(크롭 X). grid류는 1:1 cover 유지.
  const imgStyle = isList
    ? `width:100%;height:auto;display:block;border-radius:${radius}`
    : `width:100%;aspect-ratio:1;object-fit:cover;border-radius:${radius}`;
  // ★ 2026-07-02(3) link_url 있으면 이미지 링크 연결 (입력받고도 발행물에서 안 쓰이던 결함)
  const items = images.map((img: any, i: number) => {
    // 모자이크: 첫 장 = 전체 폭 + 16/10 대형 (에디토리얼 리듬)
    const style = mosaic && i === 0
      ? `width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:${mosaicRadius}`
      : imgStyle;
    const spanWrap = mosaic && i === 0 ? 'grid-column:1/-1' : '';
    const tag = `<img src="${escapeHtml(publicImageUrl(img.url))}" loading="lazy" alt="${escapeHtml(img.caption || '')}" style="${style}"/>`;
    const href = img.link_url ? safeUrl(img.link_url) : '#';
    const inner = href !== '#' ? `<a href="${href}" target="_blank" rel="noopener" style="display:block">${tag}</a>` : tag;
    return spanWrap ? `<div style="${spanWrap}">${inner}</div>` : inner;
  }).join('');
  const sectionPad = fullBleed ? '0' : 'var(--dm-sp-6) var(--dm-sp-5)';
  const gap = fullBleed ? 0 : (isList ? 12 : 8);
  const titlePad = fullBleed ? 'padding:var(--dm-sp-4) var(--dm-sp-5) 0' : '';
  return `<div class="dm-section dm-gallery" style="padding:${sectionPad}">
    ${p.title ? `<div class="dm-text-h2" style="color:var(--dm-neutral-900);margin-bottom:var(--dm-sp-4);${titlePad}">${escapeHtml(p.title)}</div>` : ''}
    <div class="dm-gal-grid" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:${gap}px">${items}</div>
  </div>`;
}

function renderSlideshow(p: any): string {
  const slides = Array.isArray(p?.slides) ? p.slides : [];
  if (slides.length === 0) {
    return `<div class="dm-section dm-slideshow dm-mood-slot" style="padding:var(--dm-sp-6);text-align:center;color:var(--dm-neutral-400)">[슬라이드를 추가해주세요]</div>`;
  }
  // ★ 2026-07-02(3) 첫 장만 고정 렌더되던 결함 수정 — 전 슬라이드 렌더 + 자동 전환 + 인디케이터 + 링크 (뷰어 스크립트 연동)
  const interval = Math.max(1500, Math.min(60000, Number(p.interval_ms) || 4000));
  const slidesHtml = slides.map((s: any, i: number) => {
    const img = `<img src="${escapeHtml(publicImageUrl(s.image_url || ''))}" loading="lazy" alt="${escapeHtml(s.caption || '')}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--dm-radius-md)"/>`;
    const href = s.link_url ? safeUrl(s.link_url) : '#';
    const inner = href !== '#' ? `<a href="${href}" target="_blank" rel="noopener" style="display:block">${img}</a>` : img;
    return `<div data-dm-slide style="display:${i === 0 ? 'block' : 'none'}">${inner}${s.caption ? `<div style="font-size:var(--dm-fs-small);margin-top:var(--dm-sp-2)">${escapeHtml(s.caption)}</div>` : ''}</div>`;
  }).join('');
  const dots = p.show_indicator !== false && slides.length > 1
    ? `<div style="display:flex;justify-content:center;gap:6px;margin-top:var(--dm-sp-2)">${slides.map((_: any, i: number) => `<span data-dm-slide-dot="${i}" style="width:8px;height:8px;border-radius:50%;background:${i === 0 ? 'var(--dm-primary)' : 'var(--dm-neutral-300)'};cursor:pointer"></span>`).join('')}</div>`
    : '';
  return `<div class="dm-section dm-slideshow" data-dm-slideshow data-interval="${interval}" style="padding:var(--dm-sp-4)">${slidesHtml}${dots}</div>`;
}

function renderTabCards(p: any): string {
  const tabs = Array.isArray(p?.tabs) ? p.tabs : [];
  if (tabs.length === 0) return '';
  // ★ 2026-07-02(3) 첫 탭만 고정 렌더되던 결함 수정 — 전 탭 렌더 + 클릭 전환 (뷰어 스크립트 연동)
  const di = Math.min(Math.max(0, Math.floor(Number(p.default_tab_index) || 0)), tabs.length - 1);
  // ★ 2026-07-02 v2 — 밑줄 탭 → 알약(pill) 세그먼트 탭
  // ★ 2026-07-13 활성 알약 = 리터럴 고정(#171717 = 기존 var 값 동일 — 다크 테마 반전 시에도 어두운 알약 + 흰 글자 유지)
  const btns = tabs.map((t: any, i: number) => `<span data-dm-tab="${i}" style="padding:9px 16px;cursor:pointer;border-radius:999px;background:${i === di ? '#171717' : 'var(--dm-neutral-100)'};color:${i === di ? '#fff' : 'var(--dm-neutral-600)'};font-size:var(--dm-fs-small);font-weight:600;transition:all 150ms">${escapeHtml(t.label || '')}</span>`).join('');
  const panels = tabs.map((t: any, i: number) => `<div data-dm-tab-panel="${i}" style="font-size:var(--dm-fs-small);line-height:1.7;white-space:pre-wrap;display:${i === di ? 'block' : 'none'};color:var(--dm-neutral-700)">${escapeHtml(t.content || '')}</div>`).join('');
  return `<div class="dm-section dm-tab-cards" data-dm-tabs style="padding:var(--dm-sp-6) var(--dm-sp-5)">
    <div style="display:flex;gap:8px;margin-bottom:var(--dm-sp-4);flex-wrap:wrap">${btns}</div>
    ${panels}
  </div>`;
}

function renderPoll(p: any): string {
  const options = Array.isArray(p?.options) ? p.options : [];
  const items = options.map((o: any, i: number) => `<div data-dm-poll-option data-option-id="${escapeHtml(o.id || String(i))}" style="padding:14px 16px;background:var(--dm-neutral-50);border:1px solid var(--dm-neutral-200);border-radius:12px;font-size:var(--dm-fs-body);font-weight:500;margin-bottom:var(--dm-sp-2);cursor:pointer;transition:all 150ms">${escapeHtml(o.label || '')}</div>`).join('');
  const body = `
    <div class="dm-text-h2" style="color:var(--dm-neutral-900);margin-bottom:var(--dm-sp-4)">${escapeHtml(p.question || '[질문을 작성해주세요]')}</div>
    ${items}
    ${p.one_vote_per_user ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);margin-top:var(--dm-sp-2)">1인 1회 투표</div>` : ''}
    <div data-dm-result style="display:none"></div>`;
  return `<div class="dm-section dm-poll" data-dm-poll>${dmEventCard({ accentVar: '--dm-primary', icon: 'poll', overline: 'POLL', body })}</div>`;
}

function renderSurvey(p: any): string {
  const questions = Array.isArray(p?.questions) ? p.questions : [];
  if (questions.length === 0) {
    return `<div class="dm-section dm-survey" style="padding:var(--dm-sp-4);text-align:center;color:var(--dm-neutral-400);font-style:italic">[설문 질문을 추가해주세요]</div>`;
  }
  // ★ 2026-07-02(3) 질문 라벨만 렌더되고 답변 입력·제출이 아예 없던 결함 수정 — 타입별 입력 + 제출 (뷰어 스크립트 연동)
  const items = questions.map((q: any, qi: number) => {
    const qid = escapeHtml(String(q.id || qi));
    let control = '';
    if (q.type === 'text') {
      control = `<input type="text" data-dm-q="${qid}" placeholder="답변을 입력해주세요" style="width:100%;padding:10px 12px;border:1px solid var(--dm-neutral-300);border-radius:var(--dm-radius-md);font-size:var(--dm-fs-small);background:var(--dm-bg)"/>`;
    } else if (q.type === 'rating') {
      control = `<div data-dm-rating data-dm-q="${qid}" style="display:flex;gap:6px">${[1, 2, 3, 4, 5].map((n) => `<span data-dm-rate="${n}" style="font-size:24px;color:var(--dm-neutral-300);cursor:pointer">★</span>`).join('')}</div>`;
    } else {
      const multi = q.type === 'multiple';
      control = (Array.isArray(q.options) ? q.options : []).map((opt: any) =>
        `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--dm-bg);border:1px solid var(--dm-neutral-200);border-radius:var(--dm-radius-md);font-size:var(--dm-fs-small);margin-bottom:6px;cursor:pointer"><input type="${multi ? 'checkbox' : 'radio'}" name="dmq-${qid}" value="${escapeHtml(String(opt))}" data-dm-q="${qid}"/>${escapeHtml(String(opt))}</label>`,
      ).join('');
    }
    return `<div data-dm-question data-required="${q.required ? '1' : '0'}" style="margin-bottom:var(--dm-sp-4);text-align:left"><div style="font-size:var(--dm-fs-small);font-weight:600;margin-bottom:6px">${escapeHtml(q.question || '')}${q.required ? ' <span style="color:var(--dm-error)">*</span>' : ''}</div>${control}</div>`;
  }).join('');
  const body = `
    ${p.title ? `<div style="font-size:var(--dm-fs-h3);font-weight:700;margin-bottom:var(--dm-sp-3)">${escapeHtml(p.title)}</div>` : ''}
    ${items}
    <button data-dm-submit class="dm-cta dm-cta-primary" style="width:100%">제출하기</button>
    ${p.completion_reward_text ? `<div style="font-size:var(--dm-fs-small);color:var(--dm-primary);margin-top:var(--dm-sp-3);font-weight:600">${escapeHtml(p.completion_reward_text)}</div>` : ''}
    <div data-dm-result style="display:none"></div>`;
  return `<div class="dm-section dm-survey" data-dm-survey>${dmEventCard({ accentVar: '--dm-primary', icon: 'survey', overline: 'SURVEY', body })}</div>`;
}

function renderEmailCapture(p: any): string {
  const body = `
    <div style="font-size:var(--dm-fs-h3);font-weight:700;margin-bottom:var(--dm-sp-2)">${escapeHtml(p.headline || '[헤드라인을 작성해주세요]')}</div>
    ${p.description ? `<div style="font-size:var(--dm-fs-small);color:var(--dm-neutral-700);margin-bottom:var(--dm-sp-3);line-height:1.6">${escapeHtml(p.description)}</div>` : ''}
    <input type="email" data-field="email" placeholder="이메일 주소" style="width:100%;padding:12px;border:1px solid var(--dm-neutral-300);border-radius:var(--dm-radius-md);font-size:var(--dm-fs-small);margin-bottom:var(--dm-sp-2)"/>
    <label style="display:flex;align-items:flex-start;gap:6px;font-size:var(--dm-fs-tiny);color:var(--dm-neutral-600);margin-bottom:var(--dm-sp-3)"><input type="checkbox" ${p.consent_required ? 'data-consent' : ''} style="margin-top:2px"/><span>${escapeHtml(p.consent_text || '')}</span></label>
    <button data-dm-submit class="dm-cta dm-cta-primary" style="width:100%">${escapeHtml(p.reward_description ? `참여하고 ${p.reward_description}` : '참여하기')}</button>
    ${p.legal_notice ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);margin-top:var(--dm-sp-2);line-height:1.5">${escapeHtml(p.legal_notice)}</div>` : ''}
    <div data-dm-result style="display:none"></div>`;
  return `<div class="dm-section dm-email-capture" data-dm-form>${dmEventCard({ accentVar: '--dm-primary', icon: 'mail', overline: 'JOIN US', body })}</div>`;
}

function renderClickRewards(p: any): string {
  const iconMap: Record<string, 'heart' | 'star'> = { like: 'heart', share: 'star', scroll: 'star' };
  const body = `
    <div style="display:flex;align-items:center;gap:var(--dm-sp-3)">
      <div style="color:var(--dm-accent)">${dmIcon(iconMap[p.reward_type] || 'star', 28)}</div>
      <div style="flex:1">
        <div style="font-size:var(--dm-fs-small);font-weight:600">${escapeHtml(p.reward_description || '')}</div>
        ${p.show_progress ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);margin-top:2px">목표 ${p.target_count || 0}회</div>` : ''}
      </div>
    </div>
    <button data-dm-claim data-claim-success="참여가 완료되었습니다. 감사합니다!" class="dm-cta dm-cta-primary" style="width:100%;margin-top:var(--dm-sp-3)">참여하기</button>
    <div data-dm-result style="display:none"></div>`;
  return `<div class="dm-section dm-click-rewards">${dmEventCard({ accentVar: '--dm-accent', body })}</div>`;
}

function renderLuckyDraw(p: any): string {
  const fields = Array.isArray(p?.form_fields) ? p.form_fields : [];
  const inputs = fields.map((f: any) => {
    const t = f.name === 'phone' ? 'tel' : f.name === 'email' ? 'email' : 'text';
    const ph = f.name === 'name' ? '이름' : f.name === 'phone' ? '전화번호' : '이메일';
    return `<input type="${t}" data-field="${escapeHtml(f.name)}" placeholder="${ph}" style="padding:12px;border:1px solid var(--dm-neutral-300);border-radius:var(--dm-radius-md);font-size:var(--dm-fs-small);background:var(--dm-bg);margin-bottom:var(--dm-sp-2);display:block;width:100%"/>`;
  }).join('');
  const body = `
    <div style="font-size:var(--dm-fs-h3);font-weight:700;margin-bottom:var(--dm-sp-2)">${escapeHtml(p.title || '[추첨 이벤트 제목]')}</div>
    ${p.description ? `<div style="font-size:var(--dm-fs-small);color:var(--dm-neutral-700);margin-bottom:var(--dm-sp-3);line-height:1.6">${escapeHtml(p.description)}</div>` : ''}
    ${inputs}
    <label style="display:flex;align-items:flex-start;gap:6px;font-size:var(--dm-fs-tiny);color:var(--dm-neutral-600);margin-bottom:var(--dm-sp-3)"><input type="checkbox" data-consent style="margin-top:2px"/><span>${escapeHtml(p.consent_text || '')}</span></label>
    <button data-dm-submit class="dm-cta dm-cta-primary" style="width:100%">응모하기</button>
    ${p.draw_at ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);margin-top:var(--dm-sp-2);text-align:center">발표: ${escapeHtml(new Date(p.draw_at).toLocaleString('ko-KR'))}</div>` : ''}
    <div data-dm-result style="display:none"></div>`;
  return `<div class="dm-section dm-lucky-draw" data-dm-form>${dmEventCard({ accentVar: '--dm-accent', icon: 'gift', overline: 'EVENT', body })}</div>`;
}

function renderRoulette(p: any): string {
  const segs = Array.isArray(p?.segments) ? p.segments.map((s: any) => ({ id: String(s.id), label: String(s.label || '') })) : [];
  const body = `
    <div style="font-size:var(--dm-fs-h3);font-weight:700;margin-bottom:var(--dm-sp-3)">${escapeHtml(p.title || '룰렛 이벤트')}</div>
    <div data-dm-wheel style="width:200px;height:200px;border-radius:var(--dm-radius-full);background:conic-gradient(var(--dm-primary) 0deg 45deg,var(--dm-primary-light) 45deg 90deg,var(--dm-accent) 90deg 135deg,var(--dm-neutral-100) 135deg 180deg,var(--dm-primary) 180deg 225deg,var(--dm-primary-light) 225deg 270deg,var(--dm-accent) 270deg 315deg,var(--dm-neutral-100) 315deg 360deg);margin:var(--dm-sp-3) auto;border:4px solid var(--dm-bg);box-shadow:var(--dm-shadow-md)"></div>
    <button data-dm-spin class="dm-cta dm-cta-primary">룰렛 돌리기</button>
    ${p.one_spin_per_user ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);margin-top:var(--dm-sp-2)">1인 1회 한정</div>` : ''}
    <div data-dm-result style="display:none"></div>`;
  return `<div class="dm-section dm-roulette" data-dm-roulette data-segments="${escapeHtml(JSON.stringify(segs))}">${dmEventCard({ accentVar: '--dm-primary', icon: 'wheel', overline: 'EVENT', body })}</div>`;
}

function renderInstantCoupon(p: any): string {
  const body = `
    <div style="font-size:var(--dm-fs-h3);font-weight:700;color:var(--dm-primary);margin-bottom:var(--dm-sp-2)">${escapeHtml(p.coupon_label || '')}</div>
    <div style="font-size:var(--dm-fs-small);color:var(--dm-neutral-700);margin-bottom:var(--dm-sp-3)">${escapeHtml(p.discount_description || '')}</div>
    ${p.expires_at ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-primary);margin-bottom:var(--dm-sp-3);font-weight:600">만료: ${escapeHtml(new Date(p.expires_at).toLocaleString('ko-KR'))}</div>` : ''}
    <button data-dm-claim data-claim-success="${escapeHtml(p.usage_instructions ? `쿠폰이 발급되었습니다. ${p.usage_instructions}` : '쿠폰이 발급되었습니다. 결제 시 적용해주세요.')}" class="dm-cta dm-cta-primary">쿠폰 받기</button>
    ${p.conditions ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);margin-top:var(--dm-sp-2);white-space:pre-wrap">${escapeHtml(p.conditions)}</div>` : ''}
    ${p.usage_instructions ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);margin-top:4px;white-space:pre-wrap">${escapeHtml(p.usage_instructions)}</div>` : ''}
    <div data-dm-result style="display:none"></div>`;
  // ★ 2026-07-02 v2 — 점선 상자 → 라운드 카드 + 아이콘 칩 + 오버라인
  return `<div class="dm-section dm-instant-coupon"><div style="padding:var(--dm-sp-8) var(--dm-sp-6);background:var(--dm-primary-light);border:1px solid var(--dm-neutral-200);border-radius:20px;box-shadow:var(--dm-shadow-md);margin:var(--dm-sp-2) 0"><div style="width:44px;height:44px;border-radius:12px;background:var(--dm-bg);color:var(--dm-primary);display:inline-flex;align-items:center;justify-content:center;margin-bottom:var(--dm-sp-4)">${dmIcon('ticket', 22)}</div><div class="dm-overline" style="color:var(--dm-primary);margin-bottom:var(--dm-sp-2)">COUPON</div>${body}</div></div>`;
}

function renderLimitedQuantity(p: any): string {
  const remaining = p.current_remaining ?? p.total_quantity ?? 0;
  const total = p.total_quantity || 1;
  const percent = Math.max(0, Math.min(100, (remaining / total) * 100));
  const body = `
    <div style="font-size:var(--dm-fs-h3);font-weight:700;margin-bottom:var(--dm-sp-2)">${escapeHtml(p.title || '[선착순 이벤트 제목]')}</div>
    ${p.description ? `<div style="font-size:var(--dm-fs-small);color:var(--dm-neutral-700);margin-bottom:var(--dm-sp-3);line-height:1.6">${escapeHtml(p.description)}</div>` : ''}
    <div style="margin-bottom:var(--dm-sp-4)">
      <div style="font-size:var(--dm-fs-small);color:var(--dm-neutral-600);margin-bottom:8px;display:flex;justify-content:space-between;font-variant-numeric:tabular-nums"><span>남은 수량</span><span style="font-weight:800;color:var(--dm-neutral-900)">${remaining} / ${total}</span></div>
      <div style="width:100%;height:10px;background:var(--dm-neutral-100);border-radius:var(--dm-radius-full);overflow:hidden"><div class="dm-lq-bar" style="width:${percent}%;height:100%;background:linear-gradient(90deg,var(--dm-accent),var(--dm-primary));border-radius:var(--dm-radius-full)"></div></div>
    </div>
    ${p.signup_url
      ? `<a href="${safeUrl(p.signup_url)}" target="_blank" rel="noopener" class="dm-cta dm-cta-primary" style="width:100%;display:block">선착순 참여하기</a>`
      : `<button data-dm-claim data-claim-success="참여가 완료되었습니다!" class="dm-cta dm-cta-primary" style="width:100%">선착순 참여하기</button>`}
    <div data-dm-result style="display:none"></div>`;
  return `<div class="dm-section dm-limited-quantity">${dmEventCard({ accentVar: '--dm-accent', icon: 'clock', overline: 'LIMITED', body })}</div>`;
}

function renderYoutubeEmbed(p: any): string {
  if (!p.video_url) {
    return `<div class="dm-section dm-youtube-embed dm-mood-slot" style="padding:var(--dm-sp-6);text-align:center;color:var(--dm-neutral-400)">[YouTube URL을 입력해주세요]</div>`;
  }
  const match = String(p.video_url).match(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{11})/);
  const videoId = match ? match[1] : null;
  if (!videoId) return `<div class="dm-section dm-youtube-embed" style="padding:var(--dm-sp-4);color:var(--dm-neutral-500)">잘못된 YouTube URL</div>`;
  return `<div class="dm-section dm-youtube-embed" style="padding:var(--dm-sp-4)">
    <div style="position:relative;padding-bottom:56.25%;height:0">
      <iframe src="https://www.youtube.com/embed/${escapeHtml(videoId)}${p.auto_play ? '?autoplay=1&mute=1' : ''}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;border-radius:var(--dm-radius-md)" allow="autoplay; encrypted-media" allowfullscreen></iframe>
    </div>
  </div>`;
}

function renderInstagramEmbed(p: any): string {
  if (!p.post_url) {
    return `<div class="dm-section dm-instagram-embed dm-mood-slot" style="padding:var(--dm-sp-6);text-align:center;color:var(--dm-neutral-400)">[Instagram URL을 입력해주세요]</div>`;
  }
  return `<div class="dm-section dm-instagram-embed" style="padding:var(--dm-sp-4)">
    <a href="${safeUrl(p.post_url)}" target="_blank" rel="noopener noreferrer" style="display:block;padding:var(--dm-sp-5);background:var(--dm-neutral-50);border:1px solid var(--dm-neutral-200);border-radius:var(--dm-radius-md);text-align:center;text-decoration:none;box-shadow:var(--dm-shadow-sm)">
      <div style="color:var(--dm-accent);display:flex;justify-content:center;margin-bottom:6px">${dmIcon('image', 26)}</div>
      <div style="font-size:var(--dm-fs-small);font-weight:600;color:var(--dm-neutral-800)">Instagram 게시물 보기</div>
    </a>
  </div>`;
}

function renderMapStoreLocator(p: any): string {
  const stores = Array.isArray(p?.stores) ? p.stores : [];
  const items = stores.map((s: any) => `
    <div style="padding:var(--dm-sp-3);background:var(--dm-neutral-50);border-radius:var(--dm-radius-md);margin-bottom:var(--dm-sp-2)">
      <div style="font-size:var(--dm-fs-small);font-weight:600">${escapeHtml(s.name || '')}</div>
      <div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-600);margin-top:2px">${escapeHtml(s.address || '')}</div>
      ${s.phone ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-primary);margin-top:4px">전화 ${escapeHtml(s.phone)}</div>` : ''}
      ${s.hours ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);margin-top:2px">영업 ${escapeHtml(s.hours)}</div>` : ''}
    </div>`).join('');
  // ★ 2026-07-07(5) 디자인 2.0 — 기능 없는 200px 회색 지도 자리(죽은 장식) 제거, 매장 카드만
  return `<div class="dm-section dm-map-store-locator" style="padding:var(--dm-sp-6) var(--dm-sp-5)">
    <div style="display:flex;align-items:center;gap:6px;font-size:var(--dm-fs-h3);font-weight:700;margin-bottom:var(--dm-sp-3)"><span style="color:var(--dm-primary)">${dmIcon('map', 18)}</span>매장 찾기</div>
    ${items || `<div class="dm-mood-slot" style="text-align:center;color:var(--dm-neutral-400);padding:var(--dm-sp-4)">[매장 정보를 추가해주세요]</div>`}
  </div>`;
}

// ★ 2026-07-13 디자인 3.0 — reviews treatment (classic / quote 대표 후기 인용 강조)
function renderReviews(p: any, treatment?: string): string {
  const reviews = Array.isArray(p?.reviews) ? p.reviews : [];
  if (treatment === 'quote' && reviews.length > 0) return renderReviewsQuote(p, reviews);
  const avg = reviews.length > 0 ? (reviews.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1) : '0.0';
  // ★ 2026-07-02 v2 — 리뷰 카드 라운드/여백/평점 타이포 격상
  const items = reviews.slice(0, 3).map((r: any) => `
    <div style="padding:var(--dm-sp-4) var(--dm-sp-5);background:var(--dm-bg);border:1px solid var(--dm-neutral-200);border-radius:14px;margin-bottom:var(--dm-sp-2);box-shadow:var(--dm-shadow-sm)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="color:var(--dm-accent);font-size:var(--dm-fs-small);letter-spacing:2px">${'★'.repeat(r.rating || 0)}${'☆'.repeat(5 - (r.rating || 0))}</span>
        <span style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500)">${escapeHtml(r.author || '')}</span>
      </div>
      <div style="font-size:var(--dm-fs-small);line-height:1.7;color:var(--dm-neutral-700)">${escapeHtml(r.body || '')}</div>
      ${r.date ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-400);margin-top:6px">${escapeHtml(r.date)}</div>` : ''}
    </div>`).join('');
  return `<div class="dm-section dm-reviews" style="padding:var(--dm-sp-6) var(--dm-sp-5)">
    ${p.title ? `<div class="dm-text-h2" style="display:flex;align-items:center;gap:8px;color:var(--dm-neutral-900);margin-bottom:var(--dm-sp-3)"><span style="color:var(--dm-accent)">${dmIcon('star', 20)}</span>${escapeHtml(p.title)}</div>` : ''}
    ${reviews.length > 0 && p.show_average_rating !== false ? `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:var(--dm-sp-4)"><span style="font-size:var(--dm-fs-hero);font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-0.02em">${avg}</span><span style="color:var(--dm-accent);letter-spacing:2px">★★★★★</span><span style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500)">(${reviews.length}건)</span></div>` : ''}
    ${items || `<div class="dm-mood-slot" style="text-align:center;color:var(--dm-neutral-400);padding:var(--dm-sp-6)">[리뷰를 추가해주세요]</div>`}
  </div>`;
}

// 인용: 대표 후기 1건을 대형 세리프 인용으로 + 나머지는 컴팩트 행
function renderReviewsQuote(p: any, reviews: any[]): string {
  const [first, ...rest] = reviews.slice(0, 3);
  const restRows = rest.map((r: any) => `
    <div style="display:flex;gap:10px;align-items:baseline;padding:10px 0;border-top:1px solid var(--dm-neutral-200);text-align:left">
      <span style="color:var(--dm-accent);font-size:var(--dm-fs-tiny);letter-spacing:1px;flex-shrink:0">${'★'.repeat(r.rating || 0)}</span>
      <span style="flex:1;font-size:var(--dm-fs-small);color:var(--dm-neutral-700);line-height:1.6">${escapeHtml(r.body || '')}</span>
      <span style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);flex-shrink:0">${escapeHtml(r.author || '')}</span>
    </div>`).join('');
  return `<div class="dm-section dm-reviews" data-section-type="reviews" style="padding:calc(var(--dm-sp-8) * var(--dm-section-pad-scale)) var(--dm-sp-6)">
    ${p.title ? `<div class="dm-text-h2" style="color:var(--dm-neutral-900);margin-bottom:var(--dm-sp-4)">${escapeHtml(p.title)}</div>` : ''}
    <div aria-hidden="true" style="font-family:var(--dm-font-display);font-size:52px;line-height:0.6;color:var(--dm-accent);opacity:0.85">&ldquo;</div>
    <div style="margin-top:var(--dm-sp-3);font-size:var(--dm-fs-h2);font-weight:700;line-height:1.55;font-family:var(--dm-font-display);color:var(--dm-neutral-900)">${escapeHtml(first.body || '')}</div>
    <div style="margin-top:var(--dm-sp-3);display:flex;gap:8px;align-items:baseline">
      <span style="color:var(--dm-accent);letter-spacing:2px;font-size:var(--dm-fs-small)">${'★'.repeat(first.rating || 0)}${'☆'.repeat(Math.max(0, 5 - (first.rating || 0)))}</span>
      <span style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500)">${escapeHtml(first.author || '')}</span>
    </div>
    ${restRows ? `<div style="margin-top:var(--dm-sp-5)">${restRows}</div>` : ''}
  </div>`;
}

/** 단일 섹션 렌더링 */
export function renderSection(section: Section, ctx: SectionRenderContext): string {
  if (!section.visible) return '';
  const fn = RENDERERS[section.type];
  if (!fn) return '';
  const variant = section.style_variant || 'default';
  // ★ 2026-06-25 (P1) 섹션 구도(treatment) 선택. 미설정/미허용=classic(현행). classic이면 data-treatment 미부착(byte 불변).
  const hasImage = !!(section.props as any)?.image_url;
  const treatment = selectTreatment(section.type, section.treatment, { typeScale: ctx.artDirection?.typeScale, hasImage });
  // 공통 정렬(section.align)을 단일 소스로 — header/hero/text_card가 자체 props.align을 읽으므로 우선 주입(미설정 시 각 섹션 기본 유지 = 하위호환)
  const alignAware = section.type === 'header' || section.type === 'hero' || section.type === 'text_card';
  const renderProps = (alignAware && section.align) ? { ...(section.props as any), align: section.align } : section.props;
  const inner = fn(renderProps, ctx, treatment);
  if (!inner) return '';
  const al = section.align || 'center';
  const just = al === 'left' ? 'flex-start' : al === 'right' ? 'flex-end' : 'center';
  const treatmentAttr = treatment && treatment !== 'classic' ? ` data-treatment="${escapeHtml(treatment)}"` : '';
  // ★ 2026-07-02(2) 섹션 공통 텍스트 크기 — 제목급/본문급 폰트 토큰을 섹션 wrap에서 override (전 27섹션 일괄 적용)
  const titleN = fsVarPx(section.title_size);
  const textN = fsVarPx(section.text_size);
  const sizeVars =
    `${titleN ? `;--dm-fs-hero:${titleN}px;--dm-fs-h1:${titleN}px;--dm-fs-h2:${titleN}px;--dm-fs-h3:${titleN}px` : ''}` +
    `${textN ? `;--dm-fs-body:${textN}px;--dm-fs-small:${textN}px` : ''}`;
  // ★ 2026-07-10 임은지 신고: 강조 면 변수 3종 동반 — 버튼 없는 구도(히어로 오버랩 카드 등)도 "버튼 색"을
  //   카드 면으로 소비. 미지정 = 변수 부재 → 각 구도 기존 기본색(발행물 무변화). 캔버스 SectionRenderer 미러.
  const accentVars = section.accent_color
    ? `;--dm-primary:${escapeHtml(section.accent_color)};--dm-accent-surface:${escapeHtml(section.accent_color)};--dm-accent-surface-fg:#fff;--dm-accent-surface-sub:rgba(255,255,255,0.85)`
    : '';
  // ★ 2026-07-14 배경면=그라데이션 두 번째 색(임은지). 미지정=변수 부재 → CSS 자동 도출 폴백(회귀 0). 캔버스 SectionRenderer 미러.
  const gradVars = section.accent_color_2 ? `;--dm-grad-to:${escapeHtml(section.accent_color_2)}` : '';
  const wrapStyle = `text-align:${al};--dm-section-justify:${just}${accentVars}${gradVars}${sizeVars}`;
  // ★ 2026-07-13 디자인 3.0 — 배경면(dm-bgx-*)/연결부 SVG/겹침(pull_up)/스티키 CTA. 미설정 = 기존 출력 그대로.
  //   화이트리스트 검증(클래스 주입 차단). 캔버스 SectionRenderer 동일 로직 미러.
  const BGX_KEYS = ['soft', 'tint', 'dark', 'gradient', 'glass'];
  const DIV_KEYS = ['wave', 'slant', 'curve'];
  const bgKey = section.background && BGX_KEYS.includes(section.background) ? section.background : undefined;
  const divKey = section.divider_shape && DIV_KEYS.includes(section.divider_shape) ? section.divider_shape : undefined;
  let wrapClasses = 'dm-section-wrap';
  if (section.type === 'cta' && treatment === 'sticky') wrapClasses += ' dm-sticky-cta';
  if (section.pull_up) wrapClasses += ' dm-pullup';
  let bodyHtml = inner;
  if (divKey) {
    // 연결부가 있으면 배경면은 내부 div가 담당(SVG 투명부에 래퍼 배경이 비치지 않도록)
    bodyHtml = `<div${bgKey ? ` class="dm-bgx-${bgKey}"` : ''}>${inner}</div>${renderDmDividerSvg(divKey as 'wave' | 'slant' | 'curve')}`;
  } else if (bgKey) {
    wrapClasses += ` dm-bgx-${bgKey}`;
  }
  return `<div class="${wrapClasses}" data-section-id="${escapeHtml(section.id)}" data-section-type="${escapeHtml(section.type)}" data-variant="${escapeHtml(variant)}"${treatmentAttr} style="${wrapStyle}">${bodyHtml}</div>`;
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
