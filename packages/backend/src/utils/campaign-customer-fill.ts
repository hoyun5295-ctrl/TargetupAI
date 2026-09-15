/**
 * ★ 2026-09-15 AI 자동제작(고객 입구) 전용 채우기 · Harold "재료를 떠먹여 주는데 왜 퀄리티가 저 모양이냐" · 설계 이력 = docs/FEATURE-AI-AUTO-BUILD.md §6.
 *
 * 왜 따로 두나: 고객 입구는 아웃리치 채우기(fillOutreachDmMediaV3 · 크롤 재료 전제)를 groupGallery 분기로 빌려 썼고, 그 규칙이 사용자 재료를 버렸다.
 *  카드3 미적재 · 면허 없는 본문에 수치 한 줄만 있어도 본문 전체 삭제(공백으로 접힌 한 문장) · 6자 미만 제목 강등 · 링크 없는 카드가 다른 카드 링크를 빌림 ·
 *  히어로 사진 중복 · 빈 모델 text_card · 상품 1개(누락)·5개(1개 누락)·7개 이상(6개까지만).
 * 원칙: 사용자 재료(행사 카드 제목·본문·사진·링크 · 몰 상품)가 먼저 자리를 잡고, 모델 조각은 히어로 문구 폴백과 마무리 카드 1장만 쓴다.
 *  가격·링크는 AI 를 거치지 않는다(상품 = 상품 슬라이드 · 몰 재조회 값 · 버튼 = 카드 링크 원문).
 *  면허 판정·혜택 차단은 엔진 순서(채우기 → 칩 → 차단)가 맡는다. 채우기는 엔진 차단기(sanitizeDmCopyBenefits)를 같은 면허 문구로 후보 섹션 하나에 미리 돌려 본 결과로 구조(부제·본문 카드·카드 생략)를 정한다
 *  (★ 적대 검토 0915: 구조를 먼저 정하고 차단기가 뒤에서 지우면 태그만 남은 카드·빈 부제·가격 없는 상품 카드가 남았다 ·
 *   2라운드: 줄마다 따로 짐작한 판정은 필드 전체·짧은 필드 통째 비움·'할인' 같은 낱말을 놓쳤다 → 짐작 대신 차단기 자체를 부른다 · 결과에는 원문을 싣고 실제 제거·계측은 엔진 차단기가 한다).
 * 이 파일은 엔진의 deps.fill 구현 하나를 바꾼다(campaign-engine.ts 무변경). 아웃리치 채우기와 옛 재료 경로(generateDmFromMaterials)는 바꾸지 않는다.
 */
import { getDefaultProps, type Section, type SectionType } from './dm/dm-section-registry';
import type { EngineChannel, EngineEventCard, EngineMaterials } from './campaign-engine';
import { outreachEngineDeps, headlineFromCard, posterCategoryLabel, cutAtWord, toProductItems, productCtaLabel, sanitizeDmCopyBenefits, OUTREACH_SECTION_MAX } from './sales-outreach-produce';
import { heroEligible, LANDSCAPE_RATIO, type LookImageDims } from './sales-outreach-look';
import { AI_AUTO_BUILD_LOGO_MIN_RATIO } from './ai-auto-build-materials';
import { stripUnauthorizedBenefits, BENEFIT_PLACEHOLDER } from './copy-benefit-detector';
import type { OutreachProduct } from './sales-outreach-media';

/**
 * 고객 채우기 결과 상한 = 기능 칩 쿠폰 삽입 상한(OUTREACH_SECTION_MAX)보다 1 작다 · 사용자가 켠 쿠폰이 들어갈 자리를 남긴다(V3 와 같은 기준).
 * 넘치면 모델 마무리 카드 → 둘째 상품 묶음 → 뒤 카드의 추가 사진 → 카드1 추가 사진 순으로 뺀다(사용자 카드 글·첫 사진·버튼은 남긴다 · 뺀 사진은 사유 문장).
 */
export const CUSTOMER_SECTION_MAX = OUTREACH_SECTION_MAX - 1;
const BODY_MAX = 300;
const HERO_SUB_MAX = 60;
const PRODUCTS_FIRST = 2;
/** 둘째 상품 묶음 상한(이메일 렌더러는 묶음당 6 · 이메일은 2열 4개가 받은편지함 폭에 맞다) */
const PRODUCTS_SECOND_MAX: Record<EngineChannel, number> = { DM: 6, EMAIL: 4 };
/** 사용자가 제목을 비우면 materialsFromEventCards 가 넣는 기본값 */
const PLACEHOLDER_TITLE_RE = /^행사\s*\d+$/;

type FillInput = Pick<EngineMaterials, 'companyName' | 'industry' | 'gallery' | 'products' | 'logoUrl' | 'legal' | 'licensedQuote' | 'eventCards'>;

function mk(type: string, props: Record<string, unknown>, tag: string): Section {
  return {
    id: `so-cq-${tag}-${type}`, type, order: 0, visible: true,
    props: { ...((getDefaultProps(type as SectionType) as unknown as Record<string, unknown>) || {}), ...props },
  } as unknown as Section;
}

function linesOf(text: string | null | undefined): string[] {
  return String(text || '').split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
}

function nonEmpty(v: unknown): boolean {
  return String(v || '').trim().length > 0;
}

/** 후보 섹션 하나를 엔진 차단기(같은 면허 문구)에 미리 돌린 뒤의 props · 구조 판정 전용(카드가 통째로 빠지면 빈 객체) */
function sanitizedPropsOf(type: string, props: Record<string, unknown>, m: FillInput): any {
  const r = sanitizeDmCopyBenefits([mk(type, props, 'probe')], String(m.licensedQuote || ''), m.companyName);
  return (r.sections[0]?.props as any) || {};
}

function cardsOf(m: FillInput): EngineEventCard[] {
  return (m.eventCards || []).filter((c) => c && (String(c.title || '').trim() || String(c.text || '').trim() || c.bannerUrl)).slice(0, 3);
}

function dimsOf(m: FillInput, cards: readonly EngineEventCard[]): LookImageDims {
  const dims: LookImageDims = {};
  for (const g of m.gallery || []) if (g && g.url && g.width && g.height) dims[g.url] = { width: g.width, height: g.height };
  for (const c of cards) {
    if (c.bannerUrl && c.bannerSize && c.bannerSize.width > 0 && c.bannerSize.height > 0 && !dims[c.bannerUrl]) dims[c.bannerUrl] = { width: c.bannerSize.width, height: c.bannerSize.height };
  }
  return dims;
}

function ratioOf(url: string, dims: LookImageDims): number | null {
  const d = dims[url];
  return d && d.width > 0 && d.height > 0 ? d.width / d.height : null;
}

/** 히어로 자격 = 비율 0.8 이상(아웃리치와 같은 하한) · 로고 추정(3:1 이상)은 제외(AI 자동제작 이미지 역할 판정과 같은 경계) */
function heroOk(url: string, dims: LookImageDims): boolean {
  const r = ratioOf(url, dims);
  return heroEligible(url, dims) && r !== null && r < AI_AUTO_BUILD_LOGO_MIN_RATIO;
}

/** 카드에 묶인 업로드 이미지(카드 안 순서 그대로) · 묶음이 없으면 배너 한 장 */
function imagesOf(card: EngineEventCard, m: FillInput): string[] {
  const urls = card.group ? (m.gallery || []).filter((g) => g && g.group === card.group).map((g) => g.url) : [];
  if (urls.length === 0 && card.bannerUrl) urls.push(card.bannerUrl);
  return Array.from(new Set(urls.filter(Boolean)));
}

/**
 * 카드 헤드라인 · 제목이 비었거나 기본값(행사 N)이면 본문 첫 줄 · 면허 없으면 수치를 걷는다 · 사용자 제목이라 짧아도 강등하지 않는다(하한 2자).
 * 본문 첫 줄을 헤드라인으로 쓸 때 **줄 전체가 헤드라인이 된 경우만** 그 줄을 본문에서 뺀다(18자로 잘렸으면 본문에 줄 전체를 남긴다 · 사용자 글 유실 0).
 */
function cardHeadlineOf(card: EngineEventCard): { headline: string; fromLine: number | null } {
  const title = String(card.title || '').trim();
  if (title && !PLACEHOLDER_TITLE_RE.test(title)) {
    const h = headlineFromCard({ title }, card.licensed, 2);
    if (!h.demoted) return { headline: h.headline, fromLine: null };
  }
  const first = linesOf(card.text)[0];
  if (first) {
    const h = headlineFromCard({ title: first }, card.licensed, 2);
    if (!h.demoted) return { headline: h.headline, fromLine: h.headline === first ? 0 : null };
  }
  return { headline: '', fromLine: null };
}

/** 카드 본문 줄(헤드라인으로 쓴 줄 제외) */
function bodyLinesOf(card: EngineEventCard, fromLine: number | null): string[] {
  return linesOf(card.text).filter((_, i) => i !== fromLine);
}

/** 카드2·3 본문 카드 글(줄 보존 · 300자) */
function cardBodyOf(card: EngineEventCard, fromLine: number | null): string {
  return bodyLinesOf(card, fromLine).join('\n').slice(0, BODY_MAX);
}

/** 카드2·3 을 실을 것이 있는가 · 차단기를 지난 제목이나 본문 · 사진 중 하나(채우기와 사유 문장이 같은 판정을 쓴다) */
function cardHasContent(card: EngineEventCard, m: FillInput): boolean {
  const h = cardHeadlineOf(card);
  const p = sanitizedPropsOf('text_card', { tag: '', headline: h.headline, body: cardBodyOf(card, h.fromLine) }, m);
  return nonEmpty(p.headline) || nonEmpty(p.body) || imagesOf(card, m).length > 0;
}

function tagOf(card: EngineEventCard, industry: string | null): string {
  return posterCategoryLabel(`${card.title || ''} ${card.text || ''}`, industry) || '이벤트';
}

/** 버튼 라벨(목적지 이름형) · 수치가 든 라벨은 차단기가 바꾸므로 처음부터 수치를 뺀 헤드라인으로 만든다 */
function ctaLabelOf(headline: string, maxLabel: number): string {
  const base = headlineFromCard({ title: headline }, false, 2).headline;
  const head = base ? cutAtWord(base, Math.max(2, maxLabel - 3)) : '';
  return (head ? `${head} 보기` : '자세히 보기').slice(0, maxLabel);
}

function imageUrlsOf(sections: readonly Section[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    const p: any = (s && s.props) || {};
    if (typeof p.image_url === 'string' && p.image_url) out.push(p.image_url);
    if (Array.isArray(p.images)) for (const im of p.images) if (im && typeof im.url === 'string' && im.url) out.push(im.url);
  }
  return out;
}

interface ModelParts { header: Section | null; hero: Section | null; closing: Section | null; carousels: Section[]; countdown: Section | null; footer: Section | null }

/** 모델 조각 수거 · 마무리 카드는 태그·제목·본문이 모두 찬 이미지 없는 text_card 1장만(빈 칸 카드 0) · 모델 gallery·coupon·cta 는 쓰지 않는다 */
function modelPartsOf(sections: readonly Section[]): ModelParts {
  const parts: ModelParts = { header: null, hero: null, closing: null, carousels: [], countdown: null, footer: null };
  const has = (v: unknown) => String(v || '').trim().length > 0;
  for (const s of Array.isArray(sections) ? sections : []) {
    if (!s || typeof s !== 'object') continue;
    const p: any = s.props || {};
    const type = String(s.type);
    if (type === 'header' && !parts.header) parts.header = s;
    else if (type === 'hero' && !parts.hero) parts.hero = s;
    else if (type === 'text_card' && !parts.closing && !p.image_url && has(p.tag) && has(p.headline) && has(p.body)) parts.closing = s;
    else if (type === 'product_carousel') parts.carousels.push(s);
    else if (type === 'countdown' && !parts.countdown) parts.countdown = s;
    else if (type === 'footer' && !parts.footer) parts.footer = s;
  }
  return parts;
}

/**
 * 고객 입구 채우기(순수) · 순서: header → hero(카드1 사진·제목·짧은 첫 줄) → 카드1 본문 카드 → 카드1 사진 목록 → 카드1 버튼 → 상품 슬라이드(1~2 묶음 · 상품 1개면 + 버튼) →
 *  카드2·카드3(사진 카드 · 사진 목록 · 자기 링크 버튼) → 모델 마무리 카드 → 카운트다운(DM · 면허 카드 미래 종료일) → [버튼이 하나도 없을 때만 대표 버튼] → footer.
 */
export function fillCustomerStandard(sections: readonly Section[], m: FillInput, channel: EngineChannel): { sections: Section[]; filled: number } {
  const cards = cardsOf(m);
  const dims = dimsOf(m, cards);
  const maxLabel = channel === 'DM' ? 16 : 8;
  const model = modelPartsOf(sections);
  const out: Section[] = [];
  const usedImages = new Set<string>();
  const usedUrls = new Set<string>();
  let filled = 0;
  const ctaOf = (label: string, url: string, tag: string): Section => {
    usedUrls.add(url);
    return mk('cta', { buttons: [{ label: label.slice(0, maxLabel), url, style: 'primary' }] }, tag);
  };
  const galleryOf = (card: EngineEventCard, imgs: string[], caption: string, tag: string): Section | null => {
    if (imgs.length === 0) return null;
    imgs.forEach((u) => usedImages.add(u));
    return mk('gallery', { images: imgs.map((u) => ({ url: u, alt: caption, caption, ...(card.detailUrl ? { link_url: card.detailUrl } : {}) })), layout: 'list_1xN', title: '' }, tag);
  };

  // header · 업체명 · 로고(호출부가 이 회사 서빙 경로만 넘긴다)
  {
    const p: any = { ...((model.header?.props as any) || {}) };
    p.brand_name = m.companyName;
    p.variant = 'logo';
    if (channel === 'EMAIL') p.align = 'left'; else { p.align = 'center'; p.brand_size = 'lg'; }
    if (m.logoUrl) { p.logo_url = m.logoUrl; p.logo_size = 'md'; }
    out.push(model.header ? ({ ...model.header, props: p } as Section) : mk('header', p, 'header'));
  }

  // hero · 사진 = 카드1 사진 중 자격 첫 장(없으면 글자형) · 제목 = 카드1 제목 · 부제 = 카드1 본문 첫 줄이 짧고(60자) 차단기를 지나 남을 때만(아니면 모델 부제 · 줄은 본문 카드로)
  const card1 = cards[0] || null;
  const card1Images = card1 ? imagesOf(card1, m) : [];
  const heroImage = card1 ? (card1Images.find((u) => heroOk(u, dims)) || '') : ((m.gallery || []).map((g) => g.url).find((u) => heroOk(u, dims)) || '');
  const h1 = card1 ? cardHeadlineOf(card1) : { headline: '', fromLine: null };
  const card1Lines = card1 ? bodyLinesOf(card1, h1.fromLine) : [];
  const firstLine = card1Lines[0];
  const subLine = firstLine && firstLine.length <= HERO_SUB_MAX && nonEmpty(sanitizedPropsOf('hero', { headline: '', sub_copy: firstLine }, m).sub_copy) ? firstLine : null;
  const card1BodyLines = subLine !== null ? card1Lines.slice(1) : card1Lines;
  {
    const base: any = (model.hero?.props as any) || {};
    const p: any = { ...base };
    delete p.image_url;
    p.headline = h1.headline || String(base.headline || '').trim() || m.companyName;
    if (subLine !== null) p.sub_copy = subLine;
    if (heroImage) {
      usedImages.add(heroImage);
      p.image_url = heroImage;
      filled++;
      const r = ratioOf(heroImage, dims);
      if (channel === 'EMAIL') { p.image_fit = 'contain'; p.height = r !== null && r >= LANDSCAPE_RATIO ? 'md' : 'lg'; p.align = 'center'; }
      else if (r !== null && r < 1) p.image_fit = 'contain';
    }
    out.push(model.hero ? ({ ...model.hero, props: p } as Section) : mk('hero', p, 'hero'));
  }

  // 카드1 · 본문 카드(히어로 제목·부제를 반복하지 않는다 · 줄 보존 · 남는 줄이나 사진이 있을 때만) · 히어로가 사진이 아니면 카드1 첫 사진이 이 카드 위에 선다
  let card1Gallery: Section | null = null;
  if (card1) {
    const bodyText = card1BodyLines.join('\n').slice(0, BODY_MAX);
    const withImage = !heroImage ? (card1Images.find((u) => !usedImages.has(u)) || '') : '';
    const bodySurvives = nonEmpty(sanitizedPropsOf('text_card', { tag: '', headline: '', body: bodyText }, m).body);
    if (bodySurvives || withImage) {
      if (withImage) usedImages.add(withImage);
      out.push(mk('text_card', { tag: tagOf(card1, m.industry), headline: '', body: bodyText, align: 'left', ...(withImage ? { image_url: withImage, image_position: 'top' } : {}) }, 'event1'));
      filled++;
    }
    card1Gallery = galleryOf(card1, card1Images.filter((u) => !usedImages.has(u)).slice(0, 2), h1.headline || m.companyName, 'group1');
    if (card1Gallery) { out.push(card1Gallery); filled++; }
    if (card1.detailUrl) out.push(ctaOf(ctaLabelOf(h1.headline, maxLabel), card1.detailUrl, 'cta-event1'));
  }

  // 상품 · 늘 상품 슬라이드(가격은 슬라이드 항목이라 문안 차단기를 거치지 않는다 · 몰 재조회 값 그대로 · AI 0) · 1개면 버튼을 붙인다
  const products = (m.products || []) as unknown as OutreachProduct[];
  let carousel2: Section | null = null;
  const carouselOf = (ps: OutreachProduct[], n: number): Section => {
    const baseSec = model.carousels[n];
    const p: any = { ...((baseSec?.props as any) || {}) };
    p.products = toProductItems(ps);
    p.image_fit = 'contain';
    p.title = String(p.title || '').replace(/[\s.·!。:]+$/g, '').trim() || (n === 0 ? '추천 상품' : '더 많은 상품');
    filled++;
    return baseSec ? ({ ...baseSec, props: p } as Section) : mk('product_carousel', p, `carousel${n + 1}`);
  };
  if (products.length > 0) {
    const firstN = products.length === 3 ? 3 : Math.min(products.length, PRODUCTS_FIRST);
    out.push(carouselOf(products.slice(0, firstN), 0));
    const second = products.slice(firstN, firstN + PRODUCTS_SECOND_MAX[channel]);
    if (second.length > 0) { carousel2 = carouselOf(second, 1); out.push(carousel2); }
    const only = products.length === 1 ? products[0] : null;
    if (only && only.link_url && !usedUrls.has(only.link_url)) out.push(ctaOf(productCtaLabel(String(only.name || ''), maxLabel), only.link_url, 'cta-product'));
  }

  // 카드2·카드3 · 사진 카드(첫 사진) + 사진 목록(나머지 ≤2) + 자기 링크 버튼(없으면 버튼 없음 · 다른 카드 링크를 빌리지 않는다) · 실을 것이 없으면 카드째 뺀다
  const extraGalleries: Section[] = [];
  cards.slice(1).forEach((card, i) => {
    if (!cardHasContent(card, m)) return;
    const idx = i + 2;
    const h = cardHeadlineOf(card);
    const body = cardBodyOf(card, h.fromLine);
    const imgs = imagesOf(card, m).filter((u) => !usedImages.has(u));
    if (imgs[0]) usedImages.add(imgs[0]);
    out.push(mk('text_card', { tag: tagOf(card, m.industry), headline: h.headline, body, align: 'left', ...(imgs[0] ? { image_url: imgs[0], image_position: 'top' } : {}) }, `event${idx}`));
    filled++;
    const g = galleryOf(card, imgs.slice(1, 3), h.headline || m.companyName, `group${idx}`);
    if (g) { out.push(g); extraGalleries.push(g); filled++; }
    if (card.detailUrl && !usedUrls.has(card.detailUrl)) out.push(ctaOf(ctaLabelOf(h.headline, maxLabel), card.detailUrl, `cta-event${idx}`));
  });

  // 모델 마무리 카드 1장(세 칸이 모두 찬 경우만)
  if (model.closing) out.push(model.closing);

  // 카운트다운(DM) · 면허 카드의 미래 종료일만(모델이 낸 날짜는 쓰지 않는다)
  if (channel === 'DM') {
    const licensedEnd = cards.find((c) => c.licensed && c.endDate && /^\d{4}-\d{2}-\d{2}$/.test(c.endDate) && new Date(`${c.endDate}T23:59:59`).getTime() > Date.now());
    if (licensedEnd) {
      const p: any = { ...((model.countdown?.props as any) || {}) };
      p.end_datetime = `${licensedEnd.endDate}T23:59:59`;
      p.urgency_text = String(p.urgency_text || '').trim() || '행사 마감까지';
      out.push(model.countdown ? ({ ...model.countdown, props: p } as Section) : mk('countdown', p, 'countdown'));
    }
  }

  // 대표 버튼 · 버튼이 하나도 없을 때만 · 링크 원천이 없으면 빈 주소 1개(발행 전 검증이 입력을 요구한다)
  if (!out.some((s) => s.type === 'cta')) {
    const productLink = products.find((p) => p.link_url)?.link_url || '';
    out.push(mk('cta', { buttons: [{ label: (productLink ? '전체 상품 보기' : `${m.companyName} 바로가기`).slice(0, maxLabel), url: productLink, style: 'primary' }] }, 'cta-final'));
  }

  // footer
  {
    const p: any = { ...((model.footer?.props as any) || {}) };
    p.notes = String(p.notes || '');
    if (m.legal?.legal) p.legal_text = m.legal.legal;
    if (m.legal?.csPhone) p.cs_phone = m.legal.csPhone;
    p.show_unsubscribe_link = channel === 'DM';
    out.push(model.footer ? ({ ...model.footer, props: p } as Section) : mk('footer', p, 'footer'));
  }

  const drop = (s: Section | null) => { if (!s) return; const i = out.indexOf(s); if (i >= 0) out.splice(i, 1); };
  if (out.length > CUSTOMER_SECTION_MAX) drop(model.closing);
  if (out.length > CUSTOMER_SECTION_MAX) drop(carousel2);
  for (const g of extraGalleries.slice().reverse()) if (out.length > CUSTOMER_SECTION_MAX) drop(g);
  if (out.length > CUSTOMER_SECTION_MAX) drop(card1Gallery);
  return { sections: out.map((s, i) => ({ ...s, order: i }) as Section), filled };
}

/**
 * 결과 바 사유 문장(서버 사실 · 화면은 그대로 싣는다) · 링크가 없어 버튼을 뺀 카드(실린 카드만) · 자리가 없어 넣지 못한 상품 수 · 자리가 없어 넣지 못한 사진 수.
 * 상품·사진 수는 같은 채우기를 모델 조각 없이 돌린 실제 결과와 대조한다(모델 마무리 카드는 상품·사진보다 먼저 빠지므로 결과가 같다 · 상한 절단으로 빠진 둘째 상품 묶음도 센다).
 */
export function customerFillNotes(m: FillInput, channel: EngineChannel): string[] {
  const notes: string[] = [];
  const cards = cardsOf(m);
  cards.forEach((card, i) => {
    if (card.detailUrl) return;
    if (i > 0 && !cardHasContent(card, m)) return;
    const h = cardHeadlineOf(card).headline || '행사';
    notes.push(`행사 "${h}"에 링크가 없어 버튼을 넣지 않았어요`);
  });
  const shown = fillCustomerStandard([], m, channel).sections;
  const shownProducts = shown.filter((s) => s.type === 'product_carousel').reduce((acc, s) => acc + (((s.props as any)?.products as unknown[]) || []).length, 0);
  const droppedProducts = (m.products || []).length - shownProducts;
  if (droppedProducts > 0) notes.push(`상품 ${droppedProducts}개는 자리가 없어 넣지 않았어요`);
  const shownImages = new Set(imageUrlsOf(shown));
  const cardImages = new Set(cards.flatMap((c) => imagesOf(c, m)));
  const droppedImages = Array.from(cardImages).filter((u) => !shownImages.has(u)).length;
  if (droppedImages > 0) notes.push(`사진 ${droppedImages}장은 자리가 없어 넣지 않았어요`);
  return notes;
}

/** 이메일 CTA 풀폭 띠(bar)는 마지막 버튼 1개만 · 앞 버튼은 일반 버튼(룩이 모든 CTA 를 띠로 만들어 본문이 끊겼다 · 공용 룩 함수 무변경) */
export function keepLastCtaBar(sections: readonly Section[]): Section[] {
  const list = (Array.isArray(sections) ? sections : []).filter((s) => s && typeof s === 'object');
  const last = list.reduce((acc, s, i) => (s.type === 'cta' ? i : acc), -1);
  return list.map((s, i) => {
    if (s.type !== 'cta' || i === last) return s;
    const { treatment, background, ...rest } = s as Section & { treatment?: string; background?: string };
    return { ...rest, ...(treatment && treatment !== 'bar' ? { treatment } : {}), ...(background && background !== 'tint' ? { background } : {}) } as Section;
  });
}

/** 프리헤더(받은편지함 미리보기) · 면허 밖 혜택 수치가 들면 비운다(짧은 글이라 문장째) · 90자 */
export function licensedPreheaderOf(preheader: string | null | undefined, licensedQuote: string): string {
  const raw = String(preheader || '').trim();
  if (!raw) return '';
  const t = stripUnauthorizedBenefits(raw, licensedQuote);
  return t.includes(BENEFIT_PLACEHOLDER) ? '' : t.trim().slice(0, 90);
}

/** 고객 입구 엔진 의존 묶음 · 채우기만 고객 규칙 · 생성기·칩·차단·정리·룩·숨김·증거·페이지는 아웃리치 묶음 그대로(규칙이 갈라지지 않는다) */
export function customerEngineDeps(): ReturnType<typeof outreachEngineDeps> {
  const base = outreachEngineDeps();
  return { ...base, fill: (sections, materials, channel) => fillCustomerStandard(sections, materials, channel) };
}
