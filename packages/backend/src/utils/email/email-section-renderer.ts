/**
 * email-section-renderer.ts — DM Section[] → 이메일 안전 HTML (단일 진입점)
 *
 * DM 웹 렌더러(dm-section-renderer.ts)와 별개. 웹 렌더러는 CSS 변수·flex라 이메일에서 깨진다.
 * 본 렌더러는 <table> 인라인 스타일 + 절대 이미지 URL + CSS 변수/JS 0으로 이메일 클라이언트(아웃룩 포함) 호환.
 *
 * 원칙(LESSONS_BACKEND D152-4-4): template literal 안 raw 백틱 금지. 작성 후 tsc 검증.
 * verify 스크립트 DB-free 격리: escape를 로컬 정의(dm-section-renderer transitive import 회피).
 */
import type {
  Section, HeroProps, HeaderProps, TextCardProps, CtaProps, CtaButton, FooterProps,
  CouponProps, ProductCarouselProps, ProductCarouselItem, GalleryProps, GalleryImage,
  PromoCodeProps, StoreInfoProps, SnsProps, ReviewsProps,
  CountdownProps, VideoProps, YoutubeEmbedProps, InstagramEmbedProps, MapStoreLocatorProps,
} from '../dm/dm-section-registry';
import type { DmBrandKit } from '../dm/dm-tokens';
import { resolveEmailBrand, type EmailBrand } from './email-tokens';
import { EMAIL_BLOCK_WHITELIST, EMAIL_INCOMPATIBLE } from './email-blocks';

export interface EmailRenderCtx {
  brandKit?: DmBrandKit | null;
  storeName?: string;
  publicBase?: string; // 절대 이미지 URL 접두(미설정 시 https://hanjul.ai)
}

/** HTML 이스케이프(로컬 — DB-free 격리). */
function esc(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 이메일 절대 이미지 URL — 상대경로면 publicBase 접두. */
function emailImg(src: string | undefined, publicBase?: string): string {
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  const base = (publicBase || 'https://hanjul.ai').replace(/\/$/, '');
  return base + '/' + String(src).replace(/^\//, '');
}

// ────────────── 블록 렌더러 (대표 패턴 — 나머지는 동일 방식으로 확장) ──────────────

function renderHero(p: HeroProps, b: EmailBrand, ctx: EmailRenderCtx): string {
  const img = emailImg(p.image_url, ctx.publicBase);
  const align = p.align || 'center';
  const imgTag = img
    ? `<img src="${esc(img)}" alt="${esc(p.headline)}" width="600" style="width:100%;max-width:600px;display:block;border:0">`
    : '';
  const sub = p.sub_copy
    ? `<div style="font-size:${b.type.body.size};line-height:${b.type.body.lineHeight};color:${b.textMuted};margin-top:${b.sp[3]}">${esc(p.sub_copy)}</div>`
    : '';
  return `<tr><td style="padding:0">${imgTag}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:${b.sp[8]} ${b.sp[6]};text-align:${align}"><div style="font-size:${b.type.hero.size};line-height:${b.type.hero.lineHeight};font-weight:${b.type.hero.weight};letter-spacing:${b.type.hero.letterSpacing};color:${b.text};margin:0">${esc(p.headline)}</div>${sub}</td></tr></table></td></tr>`;
}

function renderHeader(p: HeaderProps, b: EmailBrand, ctx: EmailRenderCtx): string {
  // banner = 전폭 이미지
  if (p.variant === 'banner' && p.banner_image_url) {
    const img = emailImg(p.banner_image_url, ctx.publicBase);
    return `<tr><td style="padding:0"><img src="${esc(img)}" alt="${esc(p.brand_name || ctx.storeName || '')}" width="600" style="width:100%;max-width:600px;display:block;border:0"></td></tr>`;
  }
  // logo(기본) = 로고 + 브랜드명
  const brand = esc(p.brand_name || ctx.storeName || '');
  const align = p.align || 'center';
  const logo = p.logo_url ? emailImg(p.logo_url, ctx.publicBase) : '';
  const logoH = p.logo_size === 'sm' ? '24' : p.logo_size === 'lg' ? '48' : '32';
  const brandFs = p.brand_size === 'sm' ? b.type.small.size : p.brand_size === 'lg' ? b.type.h1.size : b.type.h3.size;
  const logoTag = logo ? `<img src="${esc(logo)}" alt="${brand}" height="${logoH}" style="height:${logoH}px;display:inline-block;vertical-align:middle;border:0">` : '';
  const brandTag = brand ? `<span style="font-size:${brandFs};font-weight:700;color:${b.text};vertical-align:middle;margin-left:${logo ? b.sp[2] : '0'}">${brand}</span>` : '';
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]};text-align:${align};border-bottom:1px solid ${b.border}">${logoTag}${brandTag}</td></tr>`;
}

function renderTextCard(p: TextCardProps, b: EmailBrand, ctx: EmailRenderCtx): string {
  const align = p.align || 'left';
  const img = p.image_url ? emailImg(p.image_url, ctx.publicBase) : '';
  const imgTag = img ? `<img src="${esc(img)}" alt="${esc(p.headline || '')}" style="width:100%;max-width:552px;display:block;border:0;border-radius:${b.radius.md}">` : '';
  const tag = p.tag ? `<div style="font-size:${b.type.tiny.size};font-weight:700;letter-spacing:0.05em;color:${b.primary};margin-bottom:${b.sp[2]}">${esc(p.tag)}</div>` : '';
  const head = p.headline ? `<div style="font-size:${b.type.h2.size};line-height:${b.type.h2.lineHeight};font-weight:${b.type.h2.weight};color:${b.text};margin:0 0 ${b.sp[3]} 0">${esc(p.headline)}</div>` : '';
  const bodyHtml = p.body ? `<div style="font-size:${b.type.body.size};line-height:${b.type.body.lineHeight};color:${b.text}">${esc(p.body).replace(/\n/g, '<br>')}</div>` : '';
  const textHtml = `<div style="text-align:${align}">${tag}${head}${bodyHtml}</div>`;
  const pos = p.image_position || 'top';
  let inner: string;
  if (img && (pos === 'left' || pos === 'right')) {
    const imgCell = `<td width="220" valign="top" style="padding-right:${b.sp[4]}">${imgTag}</td>`;
    const txtCell = `<td valign="top">${textHtml}</td>`;
    inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${pos === 'left' ? imgCell + txtCell : txtCell + imgCell}</tr></table>`;
  } else if (img && pos === 'bottom') {
    inner = `${textHtml}<div style="padding-top:${b.sp[4]}">${imgTag}</div>`;
  } else if (img) {
    inner = `<div style="padding-bottom:${b.sp[4]}">${imgTag}</div>${textHtml}`;
  } else {
    inner = textHtml;
  }
  return `<tr><td style="padding:${b.sp[6]}">${inner}</td></tr>`;
}

// 이메일 호환 버튼 — 이미지 버튼 금지, table 셀 배경 + padding (아웃룩 호환).
function renderButton(btn: CtaButton, b: EmailBrand): string {
  const url = /^https?:\/\//i.test(btn.url || '') ? btn.url : '#';
  let bg = b.primary, color = '#ffffff', border = b.primary;
  if (btn.style === 'secondary') { bg = b.accent; border = b.accent; }
  else if (btn.style === 'outline') { bg = b.cardBg; color = b.primary; }
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td style="border-radius:${b.radius.md};background:${bg};border:1px solid ${border}"><a href="${esc(url)}" style="display:inline-block;padding:${b.sp[3]} ${b.sp[6]};font-size:${b.type.body.size};font-weight:700;color:${color};text-decoration:none">${esc(btn.label)}</a></td></tr></table>`;
}

function renderCta(p: CtaProps, b: EmailBrand): string {
  const buttons = (p.buttons || []).filter((x) => x && x.label);
  if (buttons.length === 0) return '';
  const btns = buttons.map((btn) => `<tr><td align="center" style="padding:${b.sp[2]} 0">${renderButton(btn, b)}</td></tr>`).join('');
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${btns}</table></td></tr>`;
}

function renderFooter(p: FooterProps, b: EmailBrand): string {
  const parts: string[] = [];
  if (p.notes) parts.push(esc(p.notes).replace(/\n/g, '<br>'));
  const cs: string[] = [];
  if (p.cs_phone) cs.push('고객센터 ' + esc(p.cs_phone));
  if (p.cs_hours) cs.push(esc(p.cs_hours));
  if (cs.length) parts.push(cs.join(' · '));
  if (p.legal_text) parts.push(esc(p.legal_text).replace(/\n/g, '<br>'));
  // 수신거부 링크는 발송 시 시스템 자동 부착 — 여기서 렌더 X.
  const body = parts.map((t) => `<div style="margin:${b.sp[1]} 0">${t}</div>`).join('');
  return `<tr><td style="padding:${b.sp[6]};border-top:1px solid ${b.border};text-align:center;font-size:${b.type.tiny.size};line-height:${b.type.tiny.lineHeight};color:${b.textMuted}">${body}</td></tr>`;
}

function formatWon(n: number | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return v.toLocaleString('ko-KR') + '원';
}

function renderCoupon(p: CouponProps, b: EmailBrand): string {
  const label = esc(p.discount_label || '');
  if (!label && !p.coupon_code) return '';
  const cond: string[] = [];
  if (p.min_purchase) cond.push(formatWon(p.min_purchase) + ' 이상');
  if (p.expire_date) cond.push(esc(p.expire_date) + '까지');
  if (p.usage_condition) cond.push(esc(p.usage_condition));
  const codeBox = p.coupon_code
    ? `<div style="display:inline-block;margin-top:${b.sp[3]};padding:${b.sp[2]} ${b.sp[5]};background:#ffffff;border:1px dashed ${b.primary};border-radius:${b.radius.sm};font-family:${b.mono};font-size:${b.type.h3.size};font-weight:700;letter-spacing:2px;color:${b.primary}">${esc(p.coupon_code)}</div>`
    : '';
  const condLine = cond.length ? `<div style="font-size:${b.type.tiny.size};color:#ffffff;opacity:0.85;margin-top:${b.sp[3]}">${cond.join(' · ')}</div>` : '';
  const card = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:${b.sp[8]} ${b.sp[6]};background:${b.primary};border-radius:${b.radius.lg};text-align:center"><div style="font-size:${b.type.h2.size};line-height:${b.type.h2.lineHeight};font-weight:800;color:#ffffff">${label}</div>${codeBox}${condLine}</td></tr></table>`;
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]}">${card}</td></tr>`;
}

function renderProductCarousel(p: ProductCarouselProps, b: EmailBrand, ctx: EmailRenderCtx): string {
  const items = (p.products || []).filter((x) => x && x.name).slice(0, 6);
  if (items.length === 0) return '';
  const title = p.title ? `<div style="font-size:${b.type.h3.size};font-weight:700;color:${b.text};padding:0 0 ${b.sp[4]};text-align:center">${esc(p.title)}</div>` : '';
  const cellFor = (it: ProductCarouselItem): string => {
    const img = emailImg(it.image_url, ctx.publicBase);
    const url = it.link_url && /^https?:\/\//i.test(it.link_url) ? it.link_url : '';
    const price = it.discount_price != null
      ? `<span style="color:${b.primary};font-weight:700">${formatWon(it.discount_price)}</span> <span style="color:${b.textMuted};text-decoration:line-through;font-size:${b.type.small.size}">${formatWon(it.price)}</span>`
      : `<span style="color:${b.text};font-weight:700">${formatWon(it.price)}</span>`;
    const imgTag = img ? `<img src="${esc(img)}" alt="${esc(it.name)}" style="width:100%;display:block;border:0;border-radius:${b.radius.md}">` : '';
    const meta = `<div style="font-size:${b.type.small.size};color:${b.text};margin-top:${b.sp[2]};line-height:1.4">${esc(it.name)}</div><div style="font-size:${b.type.body.size};margin-top:${b.sp[1]}">${price}</div>`;
    const body = url ? `<a href="${esc(url)}" style="text-decoration:none;color:inherit">${imgTag}${meta}</a>` : `${imgTag}${meta}`;
    return `<td width="50%" valign="top" style="padding:${b.sp[2]}">${body}</td>`;
  };
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 2) {
    const right = items[i + 1] ? cellFor(items[i + 1]) : '<td width="50%"></td>';
    rows.push(`<tr>${cellFor(items[i])}${right}</tr>`);
  }
  return `<tr><td style="padding:${b.sp[6]} ${b.sp[4]}">${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table></td></tr>`;
}

function renderGallery(p: GalleryProps, b: EmailBrand, ctx: EmailRenderCtx): string {
  const imgs = (p.images || []).filter((x) => x && x.url).slice(0, 9);
  if (imgs.length === 0) return '';
  const perRow = p.layout === 'grid_3x3' ? 3 : p.layout === 'list_1xN' ? 1 : 2;
  const w = Math.floor(100 / perRow);
  const title = p.title ? `<div style="font-size:${b.type.h3.size};font-weight:700;color:${b.text};padding:0 0 ${b.sp[4]};text-align:center">${esc(p.title)}</div>` : '';
  const cellFor = (im: GalleryImage): string => {
    const img = emailImg(im.url, ctx.publicBase);
    const tag = `<img src="${esc(img)}" alt="${esc(im.caption || '')}" style="width:100%;display:block;border:0;border-radius:${b.radius.sm}">`;
    const wrapped = im.link_url && /^https?:\/\//i.test(im.link_url) ? `<a href="${esc(im.link_url)}">${tag}</a>` : tag;
    return `<td width="${w}%" valign="top" style="padding:${b.sp[1]}">${wrapped}</td>`;
  };
  const rows: string[] = [];
  for (let i = 0; i < imgs.length; i += perRow) {
    rows.push(`<tr>${imgs.slice(i, i + perRow).map(cellFor).join('')}</tr>`);
  }
  return `<tr><td style="padding:${b.sp[6]} ${b.sp[4]}">${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table></td></tr>`;
}

function renderPromoCode(p: PromoCodeProps, b: EmailBrand): string {
  if (!p.code) return '';
  const desc = p.description ? `<div style="font-size:${b.type.body.size};color:${b.text};margin-bottom:${b.sp[3]}">${esc(p.description)}</div>` : '';
  const codeBox = `<div style="display:inline-block;padding:${b.sp[3]} ${b.sp[6]};background:${b.bg};border:1px dashed ${b.primary};border-radius:${b.radius.sm};font-family:${b.mono};font-size:${b.type.h3.size};font-weight:700;letter-spacing:2px;color:${b.primary}">${esc(p.code)}</div>`;
  const instr = p.instructions ? `<div style="font-size:${b.type.tiny.size};color:${b.textMuted};margin-top:${b.sp[3]}">${esc(p.instructions)}</div>` : '';
  const cta = p.cta_url && /^https?:\/\//i.test(p.cta_url)
    ? `<div style="margin-top:${b.sp[4]}">${renderButton({ label: p.cta_label || '사용하기', url: p.cta_url, style: 'primary' }, b)}</div>`
    : '';
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]};text-align:center">${desc}${codeBox}${instr}${cta}</td></tr>`;
}

function renderStoreInfo(p: StoreInfoProps, b: EmailBrand): string {
  const rows: string[] = [];
  const line = (label: string, val?: string) => {
    if (val) rows.push(`<div style="font-size:${b.type.small.size};color:${b.text};margin:${b.sp[1]} 0"><span style="color:${b.textMuted}">${label}</span> ${esc(val)}</div>`);
  };
  line('주소', p.address);
  line('전화', p.phone);
  line('운영시간', p.business_hours);
  if (p.website) {
    const wurl = /^https?:\/\//i.test(p.website) ? p.website : 'https://' + p.website;
    rows.push(`<div style="font-size:${b.type.small.size};margin:${b.sp[1]} 0"><a href="${esc(wurl)}" style="color:${b.primary};text-decoration:none">${esc(p.website)}</a></div>`);
  }
  if (rows.length === 0) return '';
  return `<tr><td style="padding:${b.sp[6]};background:${b.bg};text-align:center">${rows.join('')}</td></tr>`;
}

function renderSns(p: SnsProps, b: EmailBrand): string {
  const ch = (p.channels || []).filter((c) => c && c.url && /^https?:\/\//i.test(c.url));
  if (ch.length === 0) return '';
  const labels: Record<string, string> = { instagram: 'Instagram', youtube: 'YouTube', kakao: '카카오', naver: '네이버', facebook: 'Facebook', twitter: 'X' };
  const links = ch.map((c) => `<a href="${esc(c.url)}" style="display:inline-block;margin:0 ${b.sp[2]};font-size:${b.type.small.size};color:${b.primary};text-decoration:none;font-weight:600">${esc(labels[c.type] || c.type)}</a>`).join('');
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]};text-align:center">${links}</td></tr>`;
}

function renderReviews(p: ReviewsProps, b: EmailBrand): string {
  const items = (p.reviews || []).filter((r) => r && r.body).slice(0, 5);
  if (items.length === 0) return '';
  const title = p.title ? `<div style="font-size:${b.type.h3.size};font-weight:700;color:${b.text};padding:0 0 ${b.sp[4]};text-align:center">${esc(p.title)}</div>` : '';
  const stars = (n: number) => { const r = Math.max(0, Math.min(5, Math.round(Number(n) || 0))); return '★★★★★'.slice(0, r) + '☆☆☆☆☆'.slice(0, 5 - r); };
  const cards = items.map((r) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:${b.sp[3]}"><tr><td style="padding:${b.sp[4]};background:${b.bg};border-radius:${b.radius.md}"><div style="color:${b.accent};font-size:${b.type.body.size}">${stars(r.rating)}</div><div style="font-size:${b.type.body.size};color:${b.text};margin:${b.sp[2]} 0;line-height:1.5">${esc(r.body)}</div><div style="font-size:${b.type.tiny.size};color:${b.textMuted}">${esc(r.author)}${r.date ? ' · ' + esc(r.date) : ''}</div></td></tr></table>`).join('');
  return `<tr><td style="padding:${b.sp[6]}">${title}${cards}</td></tr>`;
}

// ── 정적 대체(이메일 비호환 블록 → 깨지지 않는 요약 렌더) ──

function renderCountdownStatic(p: CountdownProps, b: EmailBrand): string {
  let dday = '';
  if (p.end_datetime) {
    const end = new Date(p.end_datetime).getTime();
    if (Number.isFinite(end)) {
      const days = Math.ceil((end - Date.now()) / 86400000);
      dday = days > 0 ? 'D-' + days : days === 0 ? 'D-Day' : '';
    }
  }
  if (!dday && !p.urgency_text) return '';
  const ddayTag = dday ? `<div style="font-size:${b.type.hero.size};font-weight:800;color:#ffffff;letter-spacing:1px">${dday}</div>` : '';
  const urgency = p.urgency_text ? `<div style="font-size:${b.type.body.size};color:#ffffff;opacity:0.9;margin-top:${b.sp[2]}">${esc(p.urgency_text)}</div>` : '';
  return `<tr><td style="padding:${b.sp[6]};background:${b.primary};text-align:center">${ddayTag}${urgency}</td></tr>`;
}

function renderVideoStatic(p: VideoProps, b: EmailBrand, ctx: EmailRenderCtx): string {
  const url = /^https?:\/\//i.test(p.video_url || '') ? p.video_url : '';
  if (!url) return '';
  const thumb = p.thumbnail_url ? emailImg(p.thumbnail_url, ctx.publicBase) : '';
  const img = thumb ? `<img src="${esc(thumb)}" alt="${esc(p.caption || '영상')}" width="600" style="width:100%;max-width:600px;display:block;border:0;border-radius:${b.radius.md}">` : '';
  const cap = p.caption ? `<div style="font-size:${b.type.small.size};color:${b.textMuted};margin-top:${b.sp[2]};text-align:center">${esc(p.caption)}</div>` : '';
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]}">${img}${cap}<div style="margin-top:${b.sp[3]};text-align:center">${renderButton({ label: '영상 보기', url, style: 'outline' }, b)}</div></td></tr>`;
}

function renderYoutubeStatic(p: YoutubeEmbedProps, b: EmailBrand, ctx: EmailRenderCtx): string {
  const url = /^https?:\/\//i.test(p.video_url || '') ? p.video_url : '';
  if (!url) return '';
  const thumb = p.thumbnail_url ? emailImg(p.thumbnail_url, ctx.publicBase) : '';
  const img = thumb ? `<img src="${esc(thumb)}" alt="YouTube" width="600" style="width:100%;max-width:600px;display:block;border:0;border-radius:${b.radius.md}">` : '';
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]};text-align:center">${img}<div style="margin-top:${b.sp[3]}">${renderButton({ label: 'YouTube에서 보기', url, style: 'outline' }, b)}</div></td></tr>`;
}

function renderInstagramStatic(p: InstagramEmbedProps, b: EmailBrand): string {
  const url = /^https?:\/\//i.test(p.post_url || '') ? p.post_url : '';
  if (!url) return '';
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]};text-align:center">${renderButton({ label: 'Instagram에서 보기', url, style: 'outline' }, b)}</td></tr>`;
}

function renderMapStatic(p: MapStoreLocatorProps, b: EmailBrand): string {
  const stores = (p.stores || []).filter((s) => s && s.name).slice(0, 5);
  if (stores.length === 0) return '';
  const rows = stores.map((s) => `<div style="margin:${b.sp[2]} 0"><div style="font-size:${b.type.body.size};font-weight:700;color:${b.text}">${esc(s.name)}</div><div style="font-size:${b.type.small.size};color:${b.textMuted}">${esc(s.address)}${s.phone ? ' · ' + esc(s.phone) : ''}</div></div>`).join('');
  return `<tr><td style="padding:${b.sp[6]};background:${b.bg}">${rows}</td></tr>`;
}

function renderBlock(s: Section, b: EmailBrand, ctx: EmailRenderCtx): string {
  const renderable = (EMAIL_BLOCK_WHITELIST as readonly string[]).includes(s.type);
  // 화이트리스트 밖 + 정적 대체 대상도 아님 → 렌더 0(깨진 HTML 차단)
  if (!renderable && EMAIL_INCOMPATIBLE[s.type] !== 'static') return '';
  switch (s.type) {
    case 'header':
      return renderHeader(s.props as HeaderProps, b, ctx);
    case 'hero':
      return renderHero(s.props as HeroProps, b, ctx);
    case 'text_card':
      return renderTextCard(s.props as TextCardProps, b, ctx);
    case 'cta':
      return renderCta(s.props as CtaProps, b);
    case 'footer':
      return renderFooter(s.props as FooterProps, b);
    case 'coupon':
      return renderCoupon(s.props as CouponProps, b);
    case 'product_carousel':
      return renderProductCarousel(s.props as ProductCarouselProps, b, ctx);
    case 'gallery':
      return renderGallery(s.props as GalleryProps, b, ctx);
    case 'promo_code':
      return renderPromoCode(s.props as PromoCodeProps, b);
    case 'store_info':
      return renderStoreInfo(s.props as StoreInfoProps, b);
    case 'sns':
      return renderSns(s.props as SnsProps, b);
    case 'reviews':
      return renderReviews(s.props as ReviewsProps, b);
    // 정적 대체(이메일 비호환 → 요약)
    case 'countdown':
      return renderCountdownStatic(s.props as CountdownProps, b);
    case 'video':
      return renderVideoStatic(s.props as VideoProps, b, ctx);
    case 'youtube_embed':
      return renderYoutubeStatic(s.props as YoutubeEmbedProps, b, ctx);
    case 'instagram_embed':
      return renderInstagramStatic(s.props as InstagramEmbedProps, b);
    case 'map_store_locator':
      return renderMapStatic(s.props as MapStoreLocatorProps, b);
    default:
      return '';
  }
}

/** Section[] → 이메일 안전 HTML(600px 중앙 카드). visible=false 제외 + order 정렬. */
export function renderEmailSections(sections: Section[], ctx: EmailRenderCtx): string {
  const b = resolveEmailBrand(ctx.brandKit);
  const ordered = (sections || [])
    .filter((s) => s.visible !== false)
    .sort((a, c) => (a.order || 0) - (c.order || 0));
  const inner = ordered.map((s) => renderBlock(s, b, ctx)).join('\n');
  const shellStyle = `max-width:600px;width:100%;background:${b.cardBg};border-radius:${b.radius.lg};overflow:hidden;font-family:${b.fontFamily}`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${b.bg};margin:0;padding:0"><tr><td align="center" style="padding:${b.sp[5]} ${b.sp[3]}"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="${shellStyle}">${inner}</table></td></tr></table>`;
}

/** Section[]에서 순수 텍스트 본문 추출(이미지 차단 환경 대비). */
export function extractEmailText(sections: Section[]): string {
  const lines: string[] = [];
  for (const s of sections || []) {
    if (s.visible === false) continue;
    const p = s.props as Record<string, unknown>;
    for (const key of ['headline', 'sub_copy', 'body', 'discount_label', 'brand_name']) {
      const v = p?.[key];
      if (typeof v === 'string' && v.trim()) lines.push(v.trim());
    }
  }
  return lines.join('\n');
}
