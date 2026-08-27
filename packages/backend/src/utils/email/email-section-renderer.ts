/**
 * email-section-renderer.ts — DM Section[] → 이메일 안전 HTML (단일 진입점)
 *
 * DM 웹 렌더러(dm-section-renderer.ts)와 별개. 웹 렌더러는 CSS 변수·flex라 이메일에서 깨진다.
 * 본 렌더러는 <table> 인라인 스타일 + 절대 이미지 URL + CSS 변수/JS 0으로 이메일 클라이언트(아웃룩 포함) 호환.
 *
 * ★ 2026-07-13 이메일 디자인 3.0
 *   - 완전한 HTML 문서 출력(doctype+head) — 다크모드 meta(color-scheme)·모바일 @media·웹폰트 @import 자리.
 *     applyTracking 픽셀은 </body> 인지라 호환. 광고 footer는 EMAIL_FOOTER_SLOT 마커 치환(email-channel).
 *   - 불릿프루프 버튼(MSO VML roundrect) / 구도(treatment — EMAIL_TREATMENTS 단일 진실) /
 *     배경면 리듬(section.background) / 아트디렉션 모티프·디바이더 / 헤드라인 마커·밑줄 / 프리헤더 명시 우선.
 *   - design(ctx.design) 미설정 = 기존 디자인 2.0 산출과 동일 골격(회귀 0 — 테스트 고정).
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
import { resolveEmailBrand, emailSelfHostFontImport, type EmailBrand, type EmailDesign } from './email-tokens';
import { EMAIL_BLOCK_WHITELIST, EMAIL_INCOMPATIBLE, selectEmailTreatment } from './email-blocks';
import { EMAIL_PRODUCT_IMG_HEIGHT, EMAIL_PRODUCT_LIST_THUMB, EMAIL_PRODUCT_TITLE_SIZE_KEY } from './email-property-contract';
// ★ 2026-07-02 스킴 없는 URL(www.x.y) https:// 정규화 + 쿠폰 마감 한국어 표시 (normalize CT)
import { normalizeWebUrl, formatKoreanDateTimeDisplay } from '../normalize';

export interface EmailRenderCtx {
  brandKit?: DmBrandKit | null;
  /** ★ 2026-07-13 캠페인 단위 디자인(테마·아트디렉션·서체·프리헤더) — 미설정 = 기존 렌더 */
  design?: EmailDesign | null;
  storeName?: string;
  publicBase?: string; // 절대 이미지 URL 접두(미설정 시 https://hanjul.ai)
}

/** 광고 footer 삽입 자리 — email-channel이 발송 시 치환(</body> 앞·수신거부 링크 법 준수 위치 보장). */
export const EMAIL_FOOTER_SLOT = '<!--EMAIL_FOOTER_SLOT-->';

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

/** ★ 2026-07-12 편집기 폰트 크기(headline_size/body_size 등) 소비 — DM 렌더러 fsDecl 미러.
 *  유효 숫자(10~64px clamp)면 인라인 px, 아니면 기본 토큰 크기(기존 산출 무변화 = 회귀 0). */
function fsPx(n: number | undefined, fallback: string): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return `${Math.round(Math.min(Math.max(v, 10), 64))}px`;
}

// ────────────── ★ 2026-07-13 디자인 3.0 헬퍼 ──────────────

/** 헤드라인 강조 — 마커펜(그라데이션 워시)/밑줄. DM emphasizeHead의 인라인 스타일판(클래스 불가). */
function emphasizeHead(headEscaped: string, emphasis: string | undefined, b: EmailBrand): string {
  if (emphasis === 'marker') return `<span style="background:linear-gradient(transparent 58%,${b.markerWash} 58%)">${headEscaped}</span>`;
  if (emphasis === 'underline') return `<span style="border-bottom:3px solid ${b.primary}">${headEscaped}</span>`;
  return headEscaped;
}

/** 아트디렉션 모티프 — 헤드라인 위 포인트(rule/dot/index). bracket은 bracketWrap이 담당. */
function motifHtml(b: EmailBrand, ordinal: number): string {
  if (b.motif === 'rule') return `<div style="margin-bottom:${b.sp[3]};font-size:0;line-height:0"><span style="display:inline-block;width:28px;height:3px;background:${b.primary}"></span></div>`;
  if (b.motif === 'dot') return `<div style="margin-bottom:${b.sp[3]};font-size:0;line-height:0"><span style="display:inline-block;width:7px;height:7px;border-radius:999px;background:${b.primary}"></span></div>`;
  if (b.motif === 'index') return `<div style="font-size:12px;font-weight:800;letter-spacing:0.18em;color:${b.primary};margin-bottom:${b.sp[2]}">${String(Math.max(1, ordinal)).padStart(2, '0')}</div>`;
  return '';
}

/** bracket 모티프 — 헤드라인 블록을 왼쪽 룰 프레임으로 감쌈. */
function bracketWrap(inner: string, b: EmailBrand): string {
  if (b.motif !== 'bracket') return inner;
  return `<div style="border-left:3px solid ${b.primary};padding-left:${b.sp[4]}">${inner}</div>`;
}

/** 섹션 사이 디바이더 행 (hairline/gap/rule — DM sectionDivider의 테이블판). */
function dividerRow(b: EmailBrand): string {
  if (b.divider === 'hairline') return `<tr><td style="padding:0 ${b.sp[6]}"><hr style="border:none;border-top:1px solid ${b.border};margin:0"></td></tr>`;
  if (b.divider === 'gap') return `<tr><td style="height:${b.sp[5]};font-size:0;line-height:0">&nbsp;</td></tr>`;
  if (b.divider === 'rule') return `<tr><td align="center" style="padding:${b.sp[3]} 0"><hr style="border:none;border-top:3px solid ${b.primary};width:36px;margin:0 auto"></td></tr>`;
  return '';
}

/** 배경면 리듬(section.background) — 블록 행들을 배경 밴드 td로 감쌈. dark는 renderBlock이 브랜드 재해석. */
function wrapBand(rowsHtml: string, bgStyle: string): string {
  return `<tr><td style="padding:0;${bgStyle}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table></td></tr>`;
}

// ────────────── 블록 렌더러 ──────────────

// 이메일용 히어로 높이(전체화면 vh는 이메일 불가 → 큰 고정 px). td height 속성 + style로 클라이언트 호환.
const HERO_HEIGHT_PX: Record<string, number> = { sm: 200, md: 320, lg: 480, full: 600 };

function renderHero(p: HeroProps, b: EmailBrand, ctx: EmailRenderCtx, treatment: string, ordinal: number): string {
  const img = emailImg(p.image_url, ctx.publicBase);
  const align = p.align || 'center';
  const minH = HERO_HEIGHT_PX[(p.height as string) || 'md'] || 320;
  const headEsc = esc(p.headline).replace(/\n/g, '<br>');

  // ★ 3.0 구도 typographic — 이미지 미사용 대형 타이포(에디토리얼). 모티프+디스플레이 서체.
  if (treatment === 'typographic') {
    const inner = bracketWrap(
      motifHtml(b, ordinal)
      + `<div style="font-family:${b.displayFont};font-size:${fsPx(p.headline_size, b.type.hero.size)};line-height:1.12;font-weight:${b.type.hero.weight};letter-spacing:${b.type.hero.letterSpacing};color:${esc(p.headline_color || b.text)};margin:0">${emphasizeHead(headEsc, p.headline_emphasis as string | undefined, b)}</div>`
      + (p.sub_copy ? `<div style="font-size:${fsPx(p.sub_copy_size, b.type.body.size)};line-height:${b.type.body.lineHeight};color:${esc(p.sub_copy_color || b.textMuted)};margin-top:${b.sp[4]}">${esc(p.sub_copy).replace(/\n/g, '<br>')}</div>` : ''),
      b,
    );
    return `<tr><td class="em-hero" style="padding:${b.sp[12]} ${b.sp[6]};text-align:${align}">${inner}</td></tr>`;
  }

  // ★ 3.0 구도 split — 이미지 절반 + 텍스트 절반(모바일 = em-stack 세로 스택). 이미지 없으면 classic 폴백.
  if (treatment === 'split' && img) {
    const imgCell = `<td width="50%" valign="middle" class="em-stack" style="padding:0"><img src="${esc(img)}" alt="${esc(p.headline || '')}" style="width:100%;display:block;border:0"></td>`;
    const txtCell = `<td width="50%" valign="middle" class="em-stack" style="padding:${b.sp[6]};text-align:${align}">`
      + motifHtml(b, ordinal)
      + `<div style="font-family:${b.displayFont};font-size:${fsPx(p.headline_size, b.type.h1.size)};line-height:1.2;font-weight:${b.type.hero.weight};letter-spacing:${b.type.hero.letterSpacing};color:${esc(p.headline_color || b.text)};margin:0">${emphasizeHead(headEsc, p.headline_emphasis as string | undefined, b)}</div>`
      + (p.sub_copy ? `<div style="font-size:${fsPx(p.sub_copy_size, b.type.body.size)};line-height:${b.type.body.lineHeight};color:${esc(p.sub_copy_color || b.textMuted)};margin-top:${b.sp[3]}">${esc(p.sub_copy).replace(/\n/g, '<br>')}</div>` : '')
      + '</td>';
    return `<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${imgCell}${txtCell}</tr></table></td></tr>`;
  }

  if (img) {
    // 배경 이미지 + (옵션) 하단 그라데이션 오버레이 + 하단 정렬 텍스트. 아웃룩은 배경이미지 미지원 → bg색 폴백.
    // ★ 2026-07-07(5) 디자인 2.0 — 스크림 강화(0.62) + 헤드라인 텍스트 섀도(이미지 위 가독)
    const overlay = p.overlay_gradient !== false
      ? 'linear-gradient(180deg,rgba(0,0,0,0) 30%,rgba(0,0,0,0.62) 100%)'
      : 'rgba(0,0,0,0)';
    // ★ 2026-07-02 줄바꿈(\n→<br>) + 색상 직접 지정(미지정 = 기존 기본색) + ★ 2026-07-12 크기 직접 지정(fsPx)
    const headline = `<div style="font-family:${b.displayFont};font-size:${fsPx(p.headline_size, b.type.hero.size)};line-height:${b.type.hero.lineHeight};font-weight:${b.type.hero.weight};letter-spacing:${b.type.hero.letterSpacing};color:${esc(p.headline_color || '#ffffff')};text-shadow:0 2px 14px rgba(0,0,0,0.35);margin:0">${emphasizeHead(headEsc, p.headline_emphasis as string | undefined, b)}</div>`;
    const sub = p.sub_copy
      ? `<div style="font-size:${fsPx(p.sub_copy_size, b.type.body.size)};line-height:${b.type.body.lineHeight};color:${esc(p.sub_copy_color || 'rgba(255,255,255,0.92)')};margin-top:${b.sp[3]}">${esc(p.sub_copy).replace(/\n/g, '<br>')}</div>`
      : '';
    return `<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${b.text};background-image:url('${esc(img)}');background-position:center center;background-size:${p.image_fit === 'contain' ? 'contain' : 'cover'};background-repeat:no-repeat"><tr><td height="${minH}" valign="bottom" class="em-hero" style="height:${minH}px;background:${overlay};padding:${b.sp[8]} ${b.sp[6]};text-align:${align}">${headline}${sub}</td></tr></table></td></tr>`;
  }

  // 이미지 없음 — 높이만 적용(텍스트 세로 가운데). 단색/투명 배경. ★ 2026-07-02 줄바꿈+색상 지정 동일 적용 + 크기(fsPx)
  const headlineD = `<div style="font-family:${b.displayFont};font-size:${fsPx(p.headline_size, b.type.hero.size)};line-height:${b.type.hero.lineHeight};font-weight:${b.type.hero.weight};letter-spacing:${b.type.hero.letterSpacing};color:${esc(p.headline_color || b.text)};margin:0">${emphasizeHead(headEsc, p.headline_emphasis as string | undefined, b)}</div>`;
  const subD = p.sub_copy
    ? `<div style="font-size:${fsPx(p.sub_copy_size, b.type.body.size)};line-height:${b.type.body.lineHeight};color:${esc(p.sub_copy_color || b.textMuted)};margin-top:${b.sp[3]}">${esc(p.sub_copy).replace(/\n/g, '<br>')}</div>`
    : '';
  return `<tr><td height="${minH}" valign="middle" class="em-hero" style="height:${minH}px;padding:${b.sp[8]} ${b.sp[6]};text-align:${align}">${motifHtml(b, ordinal)}${headlineD}${subD}</td></tr>`;
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
  const brandTag = brand ? `<span style="font-family:${b.displayFont};font-size:${brandFs};font-weight:700;color:${b.text};vertical-align:middle;margin-left:${logo ? b.sp[2] : '0'}">${brand}</span>` : '';
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]};text-align:${align};border-bottom:1px solid ${b.border}">${logoTag}${brandTag}</td></tr>`;
}

function renderTextCard(p: TextCardProps, b: EmailBrand, ctx: EmailRenderCtx, treatment: string, ordinal: number): string {
  const align = p.align || 'left';
  const img = p.image_url ? emailImg(p.image_url, ctx.publicBase) : '';
  const imgTag = img ? `<img src="${esc(img)}" alt="${esc(p.headline || '')}" style="width:100%;max-width:552px;display:block;border:0;border-radius:${b.radius.md}">` : '';
  // ★ 2026-07-07(5) 디자인 2.0 — 태그 = 자간 넓은 오버라인 (쿠폰 COUPON 인장과 동일 언어)
  const tag = p.tag ? `<div style="font-size:${b.type.tiny.size};font-weight:800;letter-spacing:0.18em;color:${b.primary};margin-bottom:${b.sp[2]}">${esc(p.tag)}</div>` : '';
  const headEsc = p.headline ? esc(p.headline).replace(/\n/g, '<br>') : '';
  // ★ 3.0 구도 — lead(큰 리드문)/framed(프레임)/quote(인용). classic = 기존 산출.
  const headFs = treatment === 'lead' ? fsPx(p.headline_size, b.type.h1.size) : fsPx(p.headline_size, b.type.h2.size);
  const bodyFs = (treatment === 'lead' || treatment === 'quote') ? fsPx(p.body_size, b.type.h3.size) : fsPx(p.body_size, b.type.body.size);
  const bodyLh = (treatment === 'lead' || treatment === 'quote') ? '1.7' : b.type.body.lineHeight;
  // ★ 2026-07-02 헤드라인 줄바꿈 + 색상 직접 지정 (미지정 = 기존 기본색) + ★ 2026-07-12 크기 직접 지정(fsPx)
  const head = headEsc ? `<div style="font-family:${b.displayFont};font-size:${headFs};line-height:${b.type.h2.lineHeight};font-weight:${b.type.h2.weight};color:${esc(p.headline_color || b.text)};margin:0 0 ${b.sp[3]} 0">${emphasizeHead(headEsc, p.headline_emphasis as string | undefined, b)}</div>` : '';
  const quoteMark = treatment === 'quote' ? `<div style="font-family:Georgia,serif;font-size:44px;line-height:1;color:${b.primary};margin-bottom:${b.sp[2]}">&ldquo;</div>` : '';
  const bodyHtml = p.body ? `<div style="font-size:${bodyFs};line-height:${bodyLh};color:${esc(p.body_color || b.text)}">${esc(p.body).replace(/\n/g, '<br>')}</div>` : '';
  const textHtml = `<div style="text-align:${align}">${motifHtml(b, ordinal)}${tag}${quoteMark}${bracketWrap(head + bodyHtml, b)}</div>`;
  const pos = p.image_position || 'top';
  let inner: string;
  if (img && (pos === 'left' || pos === 'right')) {
    const imgCell = `<td width="220" valign="top" class="em-stack" style="padding-right:${b.sp[4]}">${imgTag}</td>`;
    const txtCell = `<td valign="top" class="em-stack">${textHtml}</td>`;
    inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${pos === 'left' ? imgCell + txtCell : txtCell + imgCell}</tr></table>`;
  } else if (img && pos === 'bottom') {
    inner = `${textHtml}<div style="padding-top:${b.sp[4]}">${imgTag}</div>`;
  } else if (img) {
    inner = `<div style="padding-bottom:${b.sp[4]}">${imgTag}</div>${textHtml}`;
  } else {
    inner = textHtml;
  }
  if (treatment === 'framed') {
    inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border:2px solid ${b.border};border-radius:${b.radius.md};padding:${b.sp[6]}">${inner}</td></tr></table>`;
  }
  const pad = treatment === 'lead' ? `${b.sp[8]} ${b.sp[6]}` : b.sp[6];
  return `<tr><td style="padding:${pad}">${inner}</td></tr>`;
}

// 이메일 호환 버튼 — 이미지 버튼 금지, table 셀 배경 + padding (아웃룩 호환).
// ★ 2026-07-07(5) 이메일 디자인 2.0 — primary=그라데이션(미지원 클라이언트 solid 폴백)+그림자, 대형 터치 타깃.
// ★ 2026-07-13 디자인 3.0 — MSO VML roundrect 동봉(아웃룩 데스크탑 불릿프루프) + invert(bar 구도 흰 버튼).
function renderButton(btn: CtaButton, b: EmailBrand, invert = false): string {
  const normalized = normalizeWebUrl(btn.url || '');
  const url = /^https?:\/\//i.test(normalized) ? normalized : '#';
  let bg = b.primary, bgImage = b.btnGrad, color = '#ffffff', border = b.primary, shadow = `0 2px 5px rgba(15,23,42,0.12),0 10px 24px ${b.primaryDashed}`;
  let vmlFill = b.primary, vmlStroke = '';
  if (btn.style === 'secondary') { bg = b.accent; bgImage = 'none'; border = b.accent; shadow = '0 2px 8px rgba(15,23,42,0.12)'; vmlFill = b.accent; }
  else if (btn.style === 'outline') { bg = b.cardBg; bgImage = 'none'; color = b.primary; shadow = 'none'; vmlFill = b.cardBg; vmlStroke = b.primary; }
  if (invert) { bg = '#ffffff'; bgImage = 'none'; color = b.primary; border = '#ffffff'; shadow = 'none'; vmlFill = '#ffffff'; vmlStroke = ''; }
  const vml = `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(url)}" style="height:46px;v-text-anchor:middle;width:230px" arcsize="30%" fillcolor="${vmlFill}" ${vmlStroke ? `strokecolor="${vmlStroke}"` : 'stroke="f"'}><w:anchorlock/><center style="color:${color};font-family:sans-serif;font-size:15px;font-weight:800">${esc(btn.label)}</center></v:roundrect><![endif]-->`;
  const htmlBtn = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td style="border-radius:14px;background:${bg};background-image:${bgImage};border:1px solid ${border};box-shadow:${shadow}"><a href="${esc(url)}" style="display:inline-block;padding:14px 34px;font-size:${b.type.body.size};font-weight:800;letter-spacing:-0.01em;color:${color};text-decoration:none">${esc(btn.label)}</a></td></tr></table>`;
  return `${vml}<!--[if !mso]><!-->${htmlBtn}<!--<![endif]-->`;
}

function renderCta(p: CtaProps, b: EmailBrand, treatment: string): string {
  let buttons = (p.buttons || []).filter((x) => x && x.label);
  if (buttons.length === 0) return '';
  // ★ 3.0 구도 ghost — 전 버튼 아웃라인
  if (treatment === 'ghost') buttons = buttons.map((x) => ({ ...x, style: 'outline' as CtaButton['style'] }));
  // ★ 3.0 구도 bar — 전폭 강조 밴드 + 반전(흰) 버튼
  if (treatment === 'bar') {
    const btns = buttons.map((btn) => `<tr><td align="center" style="padding:${b.sp[2]} 0">${renderButton(btn, b, true)}</td></tr>`).join('');
    return `<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${b.primary};background-image:${b.btnGrad};padding:${b.sp[6]}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${btns}</table></td></tr></table></td></tr>`;
  }
  const btns = buttons.map((btn) => `<tr><td align="center" style="padding:${b.sp[2]} 0">${renderButton(btn, b)}</td></tr>`).join('');
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${btns}</table></td></tr>`;
}

function renderFooter(p: FooterProps, b: EmailBrand): string {
  const parts: string[] = [];
  if (p.notes) parts.push(esc(p.notes).replace(/\n/g, '<br>'));
  const cs: string[] = [];
  if (p.cs_phone) cs.push('고객센터 ' + esc(p.cs_phone));
  // ★ 2026-07-16 상담시간 줄바꿈(엔터) 반영 — notes·legal_text와 동일하게 \n→<br>. DM 수정 이메일 미러.
  if (p.cs_hours) cs.push(esc(p.cs_hours).replace(/\n/g, '<br>'));
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
// ★ 2026-07-13 3.0 구도 spotlight — 다크 패널(리터럴 #171717 — DM 다크 패널 원칙) 위 대형 혜택.
function renderCoupon(p: CouponProps, b: EmailBrand, treatment: string): string {
  const label = esc(p.discount_label || '');
  if (!label && !p.coupon_code) return '';
  const cond: string[] = [];
  if (p.min_purchase) cond.push(formatWon(p.min_purchase) + ' 이상');
  // ★ 2026-07-02 ISO 원문("2026-07-30T03:00:00.000Z") 노출 → KST 한국어 표시
  if (p.expire_date) cond.push(esc(formatKoreanDateTimeDisplay(p.expire_date)) + '까지');
  if (p.usage_condition) cond.push(esc(p.usage_condition));

  if (treatment === 'spotlight') {
    const condLineS = cond.length ? `<div style="font-size:${b.type.tiny.size};color:rgba(255,255,255,0.66);margin-top:${b.sp[3]}">${cond.join(' · ')}</div>` : '';
    const overlineS = `<div style="font-size:${b.type.tiny.size};font-weight:800;letter-spacing:0.18em;color:${b.accent};margin-bottom:${b.sp[2]}">COUPON</div>`;
    const labelS = label ? `<div style="font-family:${b.displayFont};font-size:34px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:#ffffff">${label}</div>` : '';
    const codeS = p.coupon_code
      ? `<div style="margin-top:${b.sp[4]}"><span style="display:inline-block;padding:${b.sp[3]} ${b.sp[6]};background:rgba(255,255,255,0.06);border:1px dashed ${b.accent};border-radius:${b.radius.sm};font-family:${b.mono};font-size:${b.type.h3.size};font-weight:800;letter-spacing:3px;color:${b.accent}">${esc(p.coupon_code)}</span></div>`
      : '';
    return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:${b.sp[8]} ${b.sp[6]};background:#171717;border-radius:${b.radius.lg};text-align:center">${overlineS}${labelS}${condLineS}${codeS}</td></tr></table></td></tr>`;
  }

  const condLine = cond.length ? `<div style="font-size:${b.type.tiny.size};color:${b.textMuted};margin-top:${b.sp[3]}">${cond.join(' · ')}</div>` : '';
  const overline = `<div style="font-size:${b.type.tiny.size};font-weight:800;letter-spacing:0.18em;color:${b.primary};margin-bottom:${b.sp[2]}">COUPON</div>`;
  const labelTag = label ? `<div style="font-family:${b.displayFont};font-size:30px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${b.primary}">${label}</div>` : '';
  const topRadius = p.coupon_code ? `${b.radius.lg} ${b.radius.lg} 0 0` : b.radius.lg;
  const mainRow = `<tr><td style="padding:${b.sp[8]} ${b.sp[6]} ${b.sp[6]};background:${b.primarySoft};border:2px dashed ${b.primaryDashed};border-bottom:${p.coupon_code ? 'none' : `2px dashed ${b.primaryDashed}`};border-radius:${topRadius};text-align:center">${overline}${labelTag}${condLine}</td></tr>`;
  const stubRow = p.coupon_code
    ? `<tr><td style="padding:${b.sp[5]} ${b.sp[6]};background:${b.cardBg};border:2px dashed ${b.primaryDashed};border-top:2px dashed ${b.primaryDashed};border-radius:0 0 ${b.radius.lg} ${b.radius.lg};text-align:center"><div style="display:inline-block;padding:${b.sp[3]} ${b.sp[6]};background:${b.primarySoft};border:1px dashed ${b.primary};border-radius:${b.radius.sm};font-family:${b.mono};font-size:${b.type.h3.size};font-weight:800;letter-spacing:3px;color:${b.primary}">${esc(p.coupon_code)}</div></td></tr>`
    : '';
  const card = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${mainRow}${stubRow}</table>`;
  return `<tr><td style="padding:${b.sp[5]} ${b.sp[6]}">${card}</td></tr>`;
}

function renderProductCarousel(p: ProductCarouselProps, b: EmailBrand, ctx: EmailRenderCtx, treatment: string): string {
  const items = (p.products || []).filter((x) => x && x.name).slice(0, 6);
  if (items.length === 0) return '';

  // ★ 2026-08-26 편집기 속성 소비(임은지 접수 cmt9gn8of01vujnotzl63acsl) — 배경색·글씨공간 색·
  //   이미지 맞춤·정렬·높이가 편집기에만 있고 이메일 렌더러가 한 번도 안 읽던 것. DM 렌더러 미러.
  //   ⛔ 미지정이면 전부 옛 값이라 기존 캠페인 출력은 한 글자도 안 바뀐다(무회귀).
  //   근거표 = email-property-contract.ts · 검증 = __tests__/email-editor-parity.test.ts
  const sectionBg = p.background_color ? `;background:${esc(p.background_color)}` : '';
  const cardBg = p.caption_bg_color ? esc(p.caption_bg_color) : b.cardBg;
  const hKey: 'sm' | 'md' | 'lg' = p.image_height === 'sm' || p.image_height === 'lg' ? p.image_height : 'md';
  const imgH = EMAIL_PRODUCT_IMG_HEIGHT[hKey];
  const thumbH = EMAIL_PRODUCT_LIST_THUMB[hKey];
  // 맞추기(contain)는 여백이 생기므로 그 여백을 배경색으로 채운다(미지정이면 테마 배경).
  // 채우기(cover)에서 정렬이 가운데면 아무것도 덧붙이지 않는다 — 옛 출력과 문자 단위로 같게.
  const imgFitCss = p.image_fit === 'contain'
    ? `object-fit:contain;background:${p.background_color ? esc(p.background_color) : b.bg}`
    : `object-fit:cover${p.image_focus === 'top' || p.image_focus === 'bottom' ? `;object-position:center ${p.image_focus}` : ''}`;

  // 제목 크기·색 — md = h3 = 현행이라 미지정이면 옛 출력 그대로.
  const titleSizeKey = EMAIL_PRODUCT_TITLE_SIZE_KEY[p.title_size === 'sm' || p.title_size === 'lg' ? p.title_size : 'md'];
  const titleColor = p.title_color ? esc(p.title_color) : b.text;
  const title = p.title ? `<div style="font-family:${b.displayFont};font-size:${b.type[titleSizeKey].size};font-weight:700;color:${titleColor};padding:0 0 ${b.sp[4]};text-align:center">${esc(p.title)}</div>` : '';

  const priceOf = (it: ProductCarouselItem, big = false): string => {
    const fs = big ? b.type.h3.size : b.type.body.size;
    return it.discount_price != null
      ? `<span style="font-size:${fs};color:${b.primary};font-weight:800">${formatWon(it.discount_price)}</span> <span style="color:${b.textMuted};text-decoration:line-through;font-size:${b.type.small.size}">${formatWon(it.price)}</span>`
      : `<span style="font-size:${fs};color:${b.text};font-weight:800">${formatWon(it.price)}</span>`;
  };
  const linkOf = (it: ProductCarouselItem): string => {
    const normalizedLink = normalizeWebUrl(it.link_url || '');
    return /^https?:\/\//i.test(normalizedLink) ? normalizedLink : '';
  };

  // ★ 2026-07-07(5) 디자인 2.0 — 상품 = 보더 카드(면+테두리+라운드), 가격 강조색 800
  // ★ 2026-07-14 카드 등고(Harold 신고) — 이미지 박스 고정 200px cover + 무이미지 placeholder +
  //   상품명 2줄 확보(min-height 37px) → 옆 카드와 가격 줄·하단 정렬(DM SSR 고정 박스 방식 미러).
  //   object-fit 미지원 구형 클라이언트는 이미지가 늘어질 뿐 칸 정렬은 유지된다.
  const cellFor = (it: ProductCarouselItem): string => {
    const img = emailImg(it.image_url, ctx.publicBase);
    const url = linkOf(it);
    const imgTag = img
      ? `<img src="${esc(img)}" alt="${esc(it.name)}" width="100%" height="${imgH}" style="width:100%;height:${imgH}px;${imgFitCss};display:block;border:0;border-radius:${b.radius.sm}">`
      : `<div style="width:100%;height:${imgH}px;background:${b.bg};border-radius:${b.radius.sm};font-size:0;line-height:0">&nbsp;</div>`;
    const meta = `<div style="font-size:${b.type.small.size};color:${b.text};font-weight:600;margin-top:${b.sp[2]};line-height:1.4;min-height:37px">${esc(it.name).replace(/\n/g, '<br>')}</div><div style="margin-top:${b.sp[1]}">${priceOf(it)}</div>`;
    const inner = url ? `<a href="${esc(url)}" style="text-decoration:none;color:inherit">${imgTag}${meta}</a>` : `${imgTag}${meta}`;
    const cardTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:${b.sp[3]};background:${cardBg};border:1px solid ${b.border};border-radius:14px">${inner}</td></tr></table>`;
    return `<td width="50%" valign="top" class="em-stack" style="padding:${b.sp[2]}">${cardTable}</td>`;
  };

  // ★ 3.0 구도 list — 1열 가로 행(썸네일 96px + 메타)
  if (treatment === 'list') {
    const rowFor = (it: ProductCarouselItem): string => {
      const img = emailImg(it.image_url, ctx.publicBase);
      const url = linkOf(it);
      const imgTag = img ? `<img src="${esc(img)}" alt="${esc(it.name)}" width="${thumbH}" style="width:${thumbH}px;height:${thumbH}px;${imgFitCss};display:block;border:0;border-radius:${b.radius.sm}">` : '';
      const meta = `<div style="font-size:${b.type.body.size};color:${b.text};font-weight:700;line-height:1.4">${esc(it.name).replace(/\n/g, '<br>')}</div><div style="margin-top:${b.sp[1]}">${priceOf(it)}</div>`;
      const rowInner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${imgTag ? `<td width="${thumbH}" valign="top" style="padding-right:${b.sp[4]}">${imgTag}</td>` : ''}<td valign="middle">${url ? `<a href="${esc(url)}" style="text-decoration:none;color:inherit">${meta}</a>` : meta}</td></tr></table>`;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:${b.sp[2]}"><tr><td style="padding:${b.sp[3]} ${b.sp[4]};background:${cardBg};border:1px solid ${b.border};border-radius:14px">${rowInner}</td></tr></table>`;
    };
    return `<tr><td style="padding:${b.sp[6]}${sectionBg}">${title}${items.map(rowFor).join('')}</td></tr>`;
  }

  // ★ 3.0 구도 focus — 대표 1개 전폭 카드 + 나머지 2열
  let focusHtml = '';
  let gridItems = items;
  if (treatment === 'focus') {
    const it = items[0];
    gridItems = items.slice(1);
    const img = emailImg(it.image_url, ctx.publicBase);
    const url = linkOf(it);
    // 대표 이미지는 원래 자연 높이(고정 박스 없음)라 object-fit이 걸리지 않는다.
    // 맞춤·정렬·높이 중 하나라도 지정됐을 때만 고정 박스를 주고, 아니면 옛 출력 그대로 둔다(무회귀).
    const focusTouched = p.image_fit === 'contain' || p.image_focus === 'top' || p.image_focus === 'bottom'
      || p.image_height === 'sm' || p.image_height === 'lg';
    const bigH = p.image_height === 'sm' ? 220 : p.image_height === 'lg' ? 360 : 280;
    const bigStyle = focusTouched
      ? `width:100%;height:${bigH}px;${imgFitCss};display:block;border:0;border-radius:${b.radius.sm}`
      : `width:100%;display:block;border:0;border-radius:${b.radius.sm}`;
    const imgTag = img ? `<img src="${esc(img)}" alt="${esc(it.name)}" style="${bigStyle}">` : '';
    const meta = `<div style="font-family:${b.displayFont};font-size:${b.type.h3.size};color:${b.text};font-weight:700;margin-top:${b.sp[3]};line-height:1.4">${esc(it.name).replace(/\n/g, '<br>')}</div><div style="margin-top:${b.sp[1]}">${priceOf(it, true)}</div>`;
    const inner = url ? `<a href="${esc(url)}" style="text-decoration:none;color:inherit">${imgTag}${meta}</a>` : `${imgTag}${meta}`;
    focusHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:${b.sp[2]}"><tr><td style="padding:${b.sp[4]};background:${cardBg};border:1px solid ${b.border};border-radius:14px">${inner}</td></tr></table>`;
  }

  const rows: string[] = [];
  for (let i = 0; i < gridItems.length; i += 2) {
    const right = gridItems[i + 1] ? cellFor(gridItems[i + 1]) : '<td width="50%" class="em-stack"></td>';
    rows.push(`<tr>${cellFor(gridItems[i])}${right}</tr>`);
  }
  return `<tr><td style="padding:${b.sp[6]} ${b.sp[4]}${sectionBg}">${title}${focusHtml}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table></td></tr>`;
}

function renderGallery(p: GalleryProps, b: EmailBrand, ctx: EmailRenderCtx): string {
  const imgs = (p.images || []).filter((x) => x && x.url).slice(0, 9);
  if (imgs.length === 0) return '';
  const perRow = p.layout === 'grid_3x3' ? 3 : p.layout === 'list_1xN' ? 1 : 2;
  const w = Math.floor(100 / perRow);
  const title = p.title ? `<div style="font-family:${b.displayFont};font-size:${b.type.h3.size};font-weight:700;color:${b.text};padding:0 0 ${b.sp[4]};text-align:center">${esc(p.title)}</div>` : '';
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
  const title = p.title ? `<div style="font-family:${b.displayFont};font-size:${b.type.h3.size};font-weight:700;color:${b.text};padding:0 0 ${b.sp[4]};text-align:center">${esc(p.title)}</div>` : '';
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
  const ddayTag = dday ? `<div style="font-family:${b.displayFont};font-size:${b.type.hero.size};font-weight:800;color:#ffffff;letter-spacing:1px">${dday}</div>` : '';
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

// 섹션 공통 정렬(section.align)을 props.align으로 주입하는 대상 — 이메일 렌더러가 props.align을 소비하는 타입만
//   (DM 렌더러 withAlign 패턴 미러. 미설정 시 각 타입 기본 유지 = 하위호환)
const EMAIL_ALIGN_AWARE = new Set<string>(['hero', 'header', 'text_card']);

function renderBlock(s: Section, baseBrand: EmailBrand, ctx: EmailRenderCtx, ordinal: number): string {
  const renderable = (EMAIL_BLOCK_WHITELIST as readonly string[]).includes(s.type);
  // 화이트리스트 밖 + 정적 대체 대상도 아님 → 렌더 0(깨진 HTML 차단)
  if (!renderable && EMAIL_INCOMPATIBLE[s.type] !== 'static') return '';
  // ★ 2026-07-12 섹션 공통 스타일 소비 — ①정렬(align 소비 타입만 주입) ②강조색(accent_color → 이 섹션만 primary 파생 재해석)
  if (s.align && EMAIL_ALIGN_AWARE.has(s.type)) {
    s = { ...s, props: { ...(s.props as any), align: s.align } } as Section;
  }
  const accent = (s.accent_color && /^#[0-9a-fA-F]{6}$/.test(s.accent_color.trim())) ? s.accent_color.trim() : '';
  // 강조색 재해석 시 design.palette.primary가 섹션 지정색을 덮지 않게 팔레트 primary만 제거(나머지 아트디렉션 유지).
  const designSansPrimary = ctx.design
    ? { ...ctx.design, palette: { ...(ctx.design.palette || {}), primary: undefined } }
    : ctx.design;
  // ★ 3.0 배경면 dark — 그 섹션만 다크 브랜드 재해석(리터럴 #171717 — DM 다크 패널 원칙).
  //   design.palette.background(라이트 테마의 #ffffff 등)가 다크 재해석을 덮으면 다크 밴드 위
  //   다크 텍스트가 되므로(Codex 3R) 팔레트 background는 제거하고 해석한다.
  const bgKind = (s as { background?: string }).background;
  let b = baseBrand;
  if (bgKind === 'dark') {
    const baseDesign = accent ? designSansPrimary : ctx.design;
    const designForDark = baseDesign
      ? { ...baseDesign, palette: { ...(baseDesign.palette || {}), background: undefined } }
      : baseDesign;
    b = resolveEmailBrand(
      { ...(ctx.brandKit || {}), ...(accent ? { primary_color: accent } : {}), background_color: '#171717' } as NonNullable<EmailRenderCtx['brandKit']>,
      designForDark,
    );
  } else if (accent) {
    b = resolveEmailBrand(
      { ...(ctx.brandKit || {}), primary_color: accent } as NonNullable<EmailRenderCtx['brandKit']>,
      designSansPrimary,
    );
  }
  const treatment = selectEmailTreatment(s.type, (s as { treatment?: string }).treatment);

  let html = '';
  switch (s.type) {
    case 'header':
      html = renderHeader(s.props as HeaderProps, b, ctx); break;
    case 'hero':
      html = renderHero(s.props as HeroProps, b, ctx, treatment, ordinal); break;
    case 'text_card':
      html = renderTextCard(s.props as TextCardProps, b, ctx, treatment, ordinal); break;
    case 'cta':
      html = renderCta(s.props as CtaProps, b, treatment); break;
    case 'footer':
      html = renderFooter(s.props as FooterProps, b); break;
    case 'coupon':
      html = renderCoupon(s.props as CouponProps, b, treatment); break;
    case 'product_carousel':
      html = renderProductCarousel(s.props as ProductCarouselProps, b, ctx, treatment); break;
    case 'gallery':
      html = renderGallery(s.props as GalleryProps, b, ctx); break;
    case 'promo_code':
      html = renderPromoCode(s.props as PromoCodeProps, b); break;
    case 'store_info':
      html = renderStoreInfo(s.props as StoreInfoProps, b); break;
    case 'sns':
      html = renderSns(s.props as SnsProps, b); break;
    case 'reviews':
      html = renderReviews(s.props as ReviewsProps, b); break;
    // 정적 대체(이메일 비호환 → 요약)
    case 'countdown':
      html = renderCountdownStatic(s.props as CountdownProps, b); break;
    case 'video':
      html = renderVideoStatic(s.props as VideoProps, b, ctx); break;
    case 'youtube_embed':
      html = renderYoutubeStatic(s.props as YoutubeEmbedProps, b, ctx); break;
    case 'instagram_embed':
      html = renderInstagramStatic(s.props as InstagramEmbedProps, b); break;
    case 'map_store_locator':
      html = renderMapStatic(s.props as MapStoreLocatorProps, b); break;
    default:
      return '';
  }
  if (!html) return '';

  // ★ 3.0 배경면 리듬 — dark(위에서 브랜드 재해석)/soft/tint/gradient. 미설정 = 기존 그대로.
  if (bgKind === 'dark') return wrapBand(html, 'background:#171717');
  if (bgKind === 'soft') return wrapBand(html, `background:${baseBrand.dark ? '#1f1f23' : baseBrand.bg}`);
  if (bgKind === 'tint') return wrapBand(html, `background:${baseBrand.cardBg};background-image:linear-gradient(0deg,${b.primarySoft},${b.primarySoft})`);
  if (bgKind === 'gradient') return wrapBand(html, `background:${baseBrand.cardBg};background-image:linear-gradient(180deg,${b.primarySoft} 0%,rgba(255,255,255,0) 100%)`);
  return html;
}

/** Section[] → 이메일 HTML 문서(600px 중앙 카드). visible=false 제외 + order 정렬.
 *  ★ 2026-07-07(5) 디자인 2.0 — 상단 브랜드 밴드(그라데이션 6px) + 프리헤더(받은편지함 미리보기 텍스트)
 *    + 슬레이트 틴트 바깥 배경 + 카드 보더/그림자 (미지원 클라이언트는 각 요소 우아한 폴백).
 *  ★ 2026-07-13 디자인 3.0 — 완전한 문서 출력(다크모드 meta·모바일 @media·웹폰트 @import) +
 *    섹션 디바이더 + 명시 프리헤더 우선 + EMAIL_FOOTER_SLOT(광고 footer 자리). */
export function renderEmailSections(sections: Section[], ctx: EmailRenderCtx): string {
  const b = resolveEmailBrand(ctx.brandKit, ctx.design);
  const ordered = (sections || [])
    .filter((s) => s.visible !== false)
    .sort((a, c) => (a.order || 0) - (c.order || 0));
  const rendered: Array<{ type: string; html: string }> = [];
  for (const s of ordered) {
    const html = renderBlock(s, b, ctx, rendered.length + 1);
    if (html) rendered.push({ type: s.type, html });
  }
  // ★ 3.0 섹션 디바이더 — 헤더 뒤/푸터 앞은 자기 보더가 있어 제외
  const div = dividerRow(b);
  let inner = '';
  for (let i = 0; i < rendered.length; i++) {
    if (i > 0 && div && rendered[i - 1].type !== 'header' && rendered[i].type !== 'footer') inner += '\n' + div;
    inner += '\n' + rendered[i].html;
  }
  // 프리헤더 — 명시(design.preheader) 우선, 없으면 본문 첫 텍스트 90자(기존 동작). &zwnj; 패딩 = 뒤 본문 노출 차단.
  const explicitPre = String(ctx.design?.preheader || '').replace(/\s+/g, ' ').trim();
  const preText = (explicitPre || extractEmailText(ordered).replace(/\s+/g, ' ').trim()).slice(0, 90);
  const preheader = preText
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${esc(preText)}${'&nbsp;&zwnj;'.repeat(24)}</div>`
    : '';
  const bandRow = `<tr><td style="height:6px;font-size:0;line-height:0;background:${b.primary};background-image:${b.bandGrad};border-radius:${b.radius.xl} ${b.radius.xl} 0 0">&nbsp;</td></tr>`;
  const shellStyle = `max-width:600px;width:100%;background:${b.cardBg};border:1px solid ${b.border};border-radius:${b.radius.xl};overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.08),0 2px 6px rgba(15,23,42,0.05);font-family:${b.fontFamily}`;
  const outer = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${b.shellBg};margin:0;padding:0"><tr><td align="center" class="em-outer" style="padding:${b.sp[6]} ${b.sp[3]} ${b.sp[8]}"><table role="presentation" width="600" cellpadding="0" cellspacing="0" class="em-shell" style="${shellStyle}">${bandRow}${inner}</table></td></tr></table>`;
  // 다크모드: 셸이 이미 다크면 그대로, 라이트면 다크 선호 클라이언트에서 바깥 배경만 짙게(카드는 설계 색 유지).
  const darkPrefBg = b.dark ? b.shellBg : '#18181b';
  return `<!DOCTYPE html>
<html lang="ko" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
${emailSelfHostFontImport(ctx.publicBase || 'https://hanjul.ai', ctx.design?.font_display, ctx.design?.font_family, ctx.brandKit?.font_display, ctx.brandKit?.font_family)}
html,body{margin:0 !important;padding:0 !important}
table{border-collapse:collapse}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
@media (max-width:600px){
  .em-outer{padding:0 !important}
  .em-shell{width:100% !important;border-radius:0 !important}
  .em-stack{display:block !important;width:100% !important;box-sizing:border-box !important}
  .em-hero{height:auto !important;padding:36px 20px !important}
}
@media (prefers-color-scheme:dark){
  body,.em-body{background:${darkPrefBg} !important}
}
</style>
</head>
<body class="em-body" style="margin:0;padding:0;background:${b.shellBg};-webkit-text-size-adjust:100%">
${preheader}
${outer}
${EMAIL_FOOTER_SLOT}
</body>
</html>`;
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
