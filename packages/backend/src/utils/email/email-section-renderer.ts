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
// ★ 2026-07-02 스킴 없는 URL(www.x.y) https:// 정규화 + 쿠폰 마감 한국어 표시 (normalize CT)
import { normalizeWebUrl, formatKoreanDateTimeDisplay } from '../normalize';

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

// 이메일용 히어로 높이(전체화면 vh는 이메일 불가 → 큰 고정 px). td height 속성 + style로 클라이언트 호환.
const HERO_HEIGHT_PX: Record<string, number> = { sm: 200, md: 320, lg: 480, full: 600 };

function renderHero(p: HeroProps, b: EmailBrand, ctx: EmailRenderCtx): string {
  const img = emailImg(p.image_url, ctx.publicBase);
  const align = p.align || 'center';
  const minH = HERO_HEIGHT_PX[(p.height as string) || 'md'] || 320;

  if (img) {
    // 배경 이미지 + (옵션) 하단 그라데이션 오버레이 + 하단 정렬 텍스트. 아웃룩은 배경이미지 미지원 → bg색 폴백.
    // ★ 2026-07-07(5) 디자인 2.0 — 스크림 강화(0.62) + 헤드라인 텍스트 섀도(이미지 위 가독)
    const overlay = p.overlay_gradient !== false
      ? 'linear-gradient(180deg,rgba(0,0,0,0) 30%,rgba(0,0,0,0.62) 100%)'
      : 'rgba(0,0,0,0)';
    // ★ 2026-07-02 줄바꿈(\n→<br>) + 색상 직접 지정(미지정 = 기존 기본색)
    const headline = `<div style="font-size:${b.type.hero.size};line-height:${b.type.hero.lineHeight};font-weight:${b.type.hero.weight};letter-spacing:${b.type.hero.letterSpacing};color:${esc(p.headline_color || '#ffffff')};text-shadow:0 2px 14px rgba(0,0,0,0.35);margin:0">${esc(p.headline).replace(/\n/g, '<br>')}</div>`;
    const sub = p.sub_copy
      ? `<div style="font-size:${b.type.body.size};line-height:${b.type.body.lineHeight};color:${esc(p.sub_copy_color || 'rgba(255,255,255,0.92)')};margin-top:${b.sp[3]}">${esc(p.sub_copy).replace(/\n/g, '<br>')}</div>`
      : '';
    return `<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${b.text};background-image:url('${esc(img)}');background-position:center center;background-size:cover;background-repeat:no-repeat"><tr><td height="${minH}" valign="bottom" style="height:${minH}px;background:${overlay};padding:${b.sp[8]} ${b.sp[6]};text-align:${align}">${headline}${sub}</td></tr></table></td></tr>`;
  }

  // 이미지 없음 — 높이만 적용(텍스트 세로 가운데). 단색/투명 배경. ★ 2026-07-02 줄바꿈+색상 지정 동일 적용
  const headlineD = `<div style="font-size:${b.type.hero.size};line-height:${b.type.hero.lineHeight};font-weight:${b.type.hero.weight};letter-spacing:${b.type.hero.letterSpacing};color:${esc(p.headline_color || b.text)};margin:0">${esc(p.headline).replace(/\n/g, '<br>')}</div>`;
  const subD = p.sub_copy
    ? `<div style="font-size:${b.type.body.size};line-height:${b.type.body.lineHeight};color:${esc(p.sub_copy_color || b.textMuted)};margin-top:${b.sp[3]}">${esc(p.sub_copy).replace(/\n/g, '<br>')}</div>`
    : '';
  return `<tr><td height="${minH}" valign="middle" style="height:${minH}px;padding:${b.sp[8]} ${b.sp[6]};text-align:${align}">${headlineD}${subD}</td></tr>`;
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
  // ★ 2026-07-07(5) 디자인 2.0 — 태그 = 자간 넓은 오버라인 (쿠폰 COUPON 인장과 동일 언어)
  const tag = p.tag ? `<div style="font-size:${b.type.tiny.size};font-weight:800;letter-spacing:0.18em;color:${b.primary};margin-bottom:${b.sp[2]}">${esc(p.tag)}</div>` : '';
  // ★ 2026-07-02 헤드라인 줄바꿈 + 색상 직접 지정 (미지정 = 기존 기본색)
  const head = p.headline ? `<div style="font-size:${b.type.h2.size};line-height:${b.type.h2.lineHeight};font-weight:${b.type.h2.weight};color:${esc(p.headline_color || b.text)};margin:0 0 ${b.sp[3]} 0">${esc(p.headline).replace(/\n/g, '<br>')}</div>` : '';
  const bodyHtml = p.body ? `<div style="font-size:${b.type.body.size};line-height:${b.type.body.lineHeight};color:${esc(p.body_color || b.text)}">${esc(p.body).replace(/\n/g, '<br>')}</div>` : '';
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
// ★ 2026-07-07(5) 이메일 디자인 2.0 — primary=그라데이션(미지원 클라이언트 solid 폴백)+그림자, 대형 터치 타깃.
function renderButton(btn: CtaButton, b: EmailBrand): string {
  const normalized = normalizeWebUrl(btn.url || '');
  const url = /^https?:\/\//i.test(normalized) ? normalized : '#';
  let bg = b.primary, bgImage = b.btnGrad, color = '#ffffff', border = b.primary, shadow = `0 2px 5px rgba(15,23,42,0.12),0 10px 24px ${b.primaryDashed}`;
  if (btn.style === 'secondary') { bg = b.accent; bgImage = 'none'; border = b.accent; shadow = '0 2px 8px rgba(15,23,42,0.12)'; }
  else if (btn.style === 'outline') { bg = b.cardBg; bgImage = 'none'; color = b.primary; shadow = 'none'; }
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td style="border-radius:14px;background:${bg};background-image:${bgImage};border:1px solid ${border};box-shadow:${shadow}"><a href="${esc(url)}" style="display:inline-block;padding:14px 34px;font-size:${b.type.body.size};font-weight:800;letter-spacing:-0.01em;color:${color};text-decoration:none">${esc(btn.label)}</a></td></tr></table>`;
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
  // ★ 2026-07-07(5) 디자인 2.0 — 여유 행간·여백 (본문과 호흡 분리)
  const body = parts.map((t) => `<div style="margin:${b.sp[2]} 0">${t}</div>`).join('');
  return `<tr><td style="padding:${b.sp[8]} ${b.sp[6]};border-top:1px solid ${b.border};text-align:center;font-size:${b.type.tiny.size};line-height:1.7;color:${b.textMuted}">${body}</td></tr>`;
}

function formatWon(n: number | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return v.toLocaleString('ko-KR') + '원';
}

// ★ 2026-07-07(5) 이메일 디자인 2.0 — 쿠폰 = 티켓 2톤 골격 (인앱 쿠폰 티켓 톤 미러).
//   본권(강조색 워시 + 대형 혜택 타이포) / 절취 점선 / 스터브(흰 면 + 코드). 코드 없으면 본권 단독.
function renderCoupon(p: CouponProps, b: EmailBrand): string {
  const label = esc(p.discount_label || '');
  if (!label && !p.coupon_code) return '';
  const cond: string[] = [];
  if (p.min_purchase) cond.push(formatWon(p.min_purchase) + ' 이상');
  // ★ 2026-07-02 ISO 원문("2026-07-30T03:00:00.000Z") 노출 → KST 한국어 표시
  if (p.expire_date) cond.push(esc(formatKoreanDateTimeDisplay(p.expire_date)) + '까지');
  if (p.usage_condition) cond.push(esc(p.usage_condition));
  const condLine = cond.length ? `<div style="font-size:${b.type.tiny.size};color:${b.textMuted};margin-top:${b.sp[3]}">${cond.join(' · ')}</div>` : '';
  const overline = `<div style="font-size:${b.type.tiny.size};font-weight:800;letter-spacing:0.18em;color:${b.primary};margin-bottom:${b.sp[2]}">COUPON</div>`;
  const labelTag = label ? `<div style="font-size:30px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${b.primary}">${label}</div>` : '';
  const topRadius = p.coupon_code ? `${b.radius.lg} ${b.radius.lg} 0 0` : b.radius.lg;
  const mainRow = `<tr><td style="padding:${b.sp[8]} ${b.sp[6]} ${b.sp[6]};background:${b.primarySoft};border:2px dashed ${b.primaryDashed};border-bottom:${p.coupon_code ? 'none' : `2px dashed ${b.primaryDashed}`};border-radius:${topRadius};text-align:center">${overline}${labelTag}${condLine}</td></tr>`;
  const stubRow = p.coupon_code
    ? `<tr><td style="padding:${b.sp[5]} ${b.sp[6]};background:${b.cardBg};border:2px dashed ${b.primaryDashed};border-top:2px dashed ${b.primaryDashed};border-radius:0 0 ${b.radius.lg} ${b.radius.lg};text-align:center"><div style="display:inline-block;padding:${b.sp[3]} ${b.sp[6]};background:${b.primarySoft};border:1px dashed ${b.primary};border-radius:${b.radius.sm};font-family:${b.mono};font-size:${b.type.h3.size};font-weight:800;letter-spacing:3px;color:${b.primary}">${esc(p.coupon_code)}</div></td></tr>`
    : '';
  const card = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${mainRow}${stubRow}</table>`;
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]}">${card}</td></tr>`;
}

function renderProductCarousel(p: ProductCarouselProps, b: EmailBrand, ctx: EmailRenderCtx): string {
  const items = (p.products || []).filter((x) => x && x.name).slice(0, 6);
  if (items.length === 0) return '';
  const title = p.title ? `<div style="font-size:${b.type.h3.size};font-weight:700;color:${b.text};padding:0 0 ${b.sp[4]};text-align:center">${esc(p.title)}</div>` : '';
  // ★ 2026-07-07(5) 디자인 2.0 — 상품 = 보더 카드(면+테두리+라운드), 가격 강조색 800
  const cellFor = (it: ProductCarouselItem): string => {
    const img = emailImg(it.image_url, ctx.publicBase);
    const normalizedLink = normalizeWebUrl(it.link_url || '');
    const url = /^https?:\/\//i.test(normalizedLink) ? normalizedLink : '';
    const price = it.discount_price != null
      ? `<span style="color:${b.primary};font-weight:800">${formatWon(it.discount_price)}</span> <span style="color:${b.textMuted};text-decoration:line-through;font-size:${b.type.small.size}">${formatWon(it.price)}</span>`
      : `<span style="color:${b.text};font-weight:800">${formatWon(it.price)}</span>`;
    const imgTag = img ? `<img src="${esc(img)}" alt="${esc(it.name)}" style="width:100%;display:block;border:0;border-radius:${b.radius.sm}">` : '';
    const meta = `<div style="font-size:${b.type.small.size};color:${b.text};font-weight:600;margin-top:${b.sp[2]};line-height:1.4">${esc(it.name)}</div><div style="font-size:${b.type.body.size};margin-top:${b.sp[1]}">${price}</div>`;
    const inner = url ? `<a href="${esc(url)}" style="text-decoration:none;color:inherit">${imgTag}${meta}</a>` : `${imgTag}${meta}`;
    const cardTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:${b.sp[3]};background:${b.cardBg};border:1px solid ${b.border};border-radius:14px">${inner}</td></tr></table>`;
    return `<td width="50%" valign="top" style="padding:${b.sp[2]}">${cardTable}</td>`;
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
    const galleryLink = normalizeWebUrl(im.link_url || '');
    const wrapped = /^https?:\/\//i.test(galleryLink) ? `<a href="${esc(galleryLink)}">${tag}</a>` : tag;
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
  const codeBox = `<div style="display:inline-block;padding:${b.sp[3]} ${b.sp[6]};background:${b.primarySoft};border:1px dashed ${b.primary};border-radius:${b.radius.sm};font-family:${b.mono};font-size:${b.type.h3.size};font-weight:800;letter-spacing:3px;color:${b.primary}">${esc(p.code)}</div>`;
  const instr = p.instructions ? `<div style="font-size:${b.type.tiny.size};color:${b.textMuted};margin-top:${b.sp[3]}">${esc(p.instructions)}</div>` : '';
  const promoCtaUrl = normalizeWebUrl(p.cta_url || '');
  const cta = /^https?:\/\//i.test(promoCtaUrl)
    ? `<div style="margin-top:${b.sp[4]}">${renderButton({ label: p.cta_label || '사용하기', url: promoCtaUrl, style: 'primary' }, b)}</div>`
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
    const wurl = normalizeWebUrl(p.website);
    rows.push(`<div style="font-size:${b.type.small.size};margin:${b.sp[1]} 0"><a href="${esc(wurl)}" style="color:${b.primary};text-decoration:none">${esc(p.website)}</a></div>`);
  }
  if (rows.length === 0) return '';
  // ★ 2026-07-07(5) 디자인 2.0 — 평면 전폭 블록 → 헤어라인 보더 카드
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:${b.sp[5]} ${b.sp[6]};background:${b.bg};border:1px solid ${b.border};border-radius:14px;text-align:center">${rows.join('')}</td></tr></table></td></tr>`;
}

function renderSns(p: SnsProps, b: EmailBrand): string {
  const ch = (p.channels || [])
    .map((c) => (c && c.url ? { ...c, url: normalizeWebUrl(c.url) } : c))
    .filter((c) => c && c.url && /^https?:\/\//i.test(c.url));
  if (ch.length === 0) return '';
  const labels: Record<string, string> = { instagram: 'Instagram', youtube: 'YouTube', kakao: '카카오', naver: '네이버', facebook: 'Facebook', twitter: 'X' };
  // ★ 2026-07-07(5) 디자인 2.0 — SNS 링크 = 워시 알약 칩
  const links = ch.map((c) => `<a href="${esc(c.url)}" style="display:inline-block;margin:${b.sp[1]};padding:${b.sp[2]} ${b.sp[4]};background:${b.primarySoft};border-radius:999px;font-size:${b.type.small.size};color:${b.primary};text-decoration:none;font-weight:700">${esc(labels[c.type] || c.type)}</a>`).join('');
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]};text-align:center">${links}</td></tr>`;
}

function renderReviews(p: ReviewsProps, b: EmailBrand): string {
  const items = (p.reviews || []).filter((r) => r && r.body).slice(0, 5);
  if (items.length === 0) return '';
  const title = p.title ? `<div style="font-size:${b.type.h3.size};font-weight:700;color:${b.text};padding:0 0 ${b.sp[4]};text-align:center">${esc(p.title)}</div>` : '';
  const stars = (n: number) => { const r = Math.max(0, Math.min(5, Math.round(Number(n) || 0))); return '★★★★★'.slice(0, r) + '☆☆☆☆☆'.slice(0, 5 - r); };
  // ★ 2026-07-07(5) 디자인 2.0 — 리뷰 = 흰 카드 + 헤어라인 보더 (면 위 면 대비)
  const cards = items.map((r) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:${b.sp[3]}"><tr><td style="padding:${b.sp[4]} ${b.sp[5]};background:${b.cardBg};border:1px solid ${b.border};border-radius:14px"><div style="color:${b.accent};font-size:${b.type.body.size};letter-spacing:2px">${stars(r.rating)}</div><div style="font-size:${b.type.body.size};color:${b.text};margin:${b.sp[2]} 0;line-height:1.6">${esc(r.body)}</div><div style="font-size:${b.type.tiny.size};font-weight:600;color:${b.textMuted}">${esc(r.author)}${r.date ? ' · ' + esc(r.date) : ''}</div></td></tr></table>`).join('');
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
  // ★ 2026-07-07(5) 디자인 2.0 — 그라데이션 밴드 카드 (미지원 클라이언트 solid primary 폴백)
  const ddayTag = dday ? `<div style="font-size:${b.type.hero.size};font-weight:800;color:#ffffff;letter-spacing:1px">${dday}</div>` : '';
  const urgency = p.urgency_text ? `<div style="font-size:${b.type.body.size};color:#ffffff;opacity:0.9;margin-top:${b.sp[2]}">${esc(p.urgency_text)}</div>` : '';
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:${b.sp[6]};background:${b.primary};background-image:${b.heroGrad};border-radius:${b.radius.lg};text-align:center">${ddayTag}${urgency}</td></tr></table></td></tr>`;
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
  // ★ 2026-07-07(5) 디자인 2.0 — 매장별 헤어라인 보더 카드
  const rows = stores.map((s) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:${b.sp[2]}"><tr><td style="padding:${b.sp[3]} ${b.sp[4]};background:${b.bg};border:1px solid ${b.border};border-radius:12px"><div style="font-size:${b.type.body.size};font-weight:700;color:${b.text}">${esc(s.name)}</div><div style="font-size:${b.type.small.size};color:${b.textMuted};margin-top:2px">${esc(s.address)}${s.phone ? ' · ' + esc(s.phone) : ''}</div></td></tr></table>`).join('');
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]}">${rows}</td></tr>`;
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

/** Section[] → 이메일 안전 HTML(600px 중앙 카드). visible=false 제외 + order 정렬.
 *  ★ 2026-07-07(5) 디자인 2.0 — 상단 브랜드 밴드(그라데이션 6px) + 프리헤더(받은편지함 미리보기 텍스트)
 *    + 슬레이트 틴트 바깥 배경 + 카드 보더/그림자 (미지원 클라이언트는 각 요소 우아한 폴백). */
export function renderEmailSections(sections: Section[], ctx: EmailRenderCtx): string {
  const b = resolveEmailBrand(ctx.brandKit);
  const ordered = (sections || [])
    .filter((s) => s.visible !== false)
    .sort((a, c) => (a.order || 0) - (c.order || 0));
  const inner = ordered.map((s) => renderBlock(s, b, ctx)).join('\n');
  // 프리헤더 — 받은편지함 제목 아래 미리보기 한 줄 (본문 첫 텍스트 90자). &zwnj; 패딩 = 뒤 본문 노출 차단.
  const preText = extractEmailText(ordered).replace(/\s+/g, ' ').trim().slice(0, 90);
  const preheader = preText
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${esc(preText)}${'&nbsp;&zwnj;'.repeat(24)}</div>`
    : '';
  const bandRow = `<tr><td style="height:6px;font-size:0;line-height:0;background:${b.primary};background-image:${b.bandGrad};border-radius:${b.radius.xl} ${b.radius.xl} 0 0">&nbsp;</td></tr>`;
  const shellStyle = `max-width:600px;width:100%;background:${b.cardBg};border:1px solid ${b.border};border-radius:${b.radius.xl};overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.08),0 2px 6px rgba(15,23,42,0.05);font-family:${b.fontFamily}`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${b.shellBg};margin:0;padding:0">${preheader ? `<tr><td>${preheader}</td></tr>` : ''}<tr><td align="center" style="padding:${b.sp[6]} ${b.sp[3]} ${b.sp[8]}"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="${shellStyle}">${bandRow}${inner}</table></td></tr></table>`;
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
