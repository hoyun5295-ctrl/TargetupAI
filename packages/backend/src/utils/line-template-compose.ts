/**
 * line-template-compose.ts — 템플릿 + 재료 + 문구 → DM(슬라이드 · 한 페이지) · 이메일 · 인앱 (★ 2026-10-17 · 설계서 docs/2026-10-17-line-template-campaign-design.md §2 · §3)
 *
 * ⛔ 불변(1017 결과물 빈 장 · 자리표시 · 버튼 중복 · 사진 반복의 뿌리를 구조로 막는다)
 *   - 구조(장 · 섹션 · 순서)는 이 파일이 정한다. AI 는 문구 칸만(`line-template-copy.ts`). 범용 장 나누기 · 비주얼 디렉터 · 룩 · 생성 뒤 끼우기 0.
 *   - 재료가 비면 자리표시 대신 **변형**(장 · 블록 자체를 바꾼다): 사진 0 = 글자 표지 · 상품 1 = 상품이 곧 표지 · 상품 0 = 상품 장 없음 · 혜택 0 = 혜택 블록 없음 · 기간 0 = 마감 블록 없음.
 *   - 같은 사진은 한 결과물에 한 번(원래 주소 기준) · 버튼은 결과물 전체에 하나 · 버튼 글은 문구 칸.
 *   - DM 슬라이드 = 섹션 최상위 `fit:'grow'`(장 채움 · 뷰어가 장 클래스를 계산) + `tpl_slot`(장 키 `p{n}.{부분}` · 배치 전환 = 이 키로 다시 묶기).
 *   - 순수(DB · AI · 시각 0) · 섹션 id 는 주입(newId).
 */
import type { Section } from './dm/dm-section-registry';
import type { LineTemplate, LineLayout, LineCopyKey, LineChannel } from './design-core/line-templates';

export interface LineCard {
  name: string;
  /** 정가(없으면 판매가) · 가격 모름 = null(가격 줄 0) */
  price: number | null;
  discount_price?: number | null;
  image_url: string;
  link_url?: string;
  /** 같은 사진 판정용 원래 주소(사본이면 원본) */
  src?: string;
}

export interface LineMaterials {
  brandName: string;
  logoUrl?: string | null;
  csPhone?: string | null;
  /** 표지 사진(올린 사진 · 이벤트 페이지 배너) — 없으면 글자 표지 · 상품 1개면 상품 표지 */
  hero: { url: string; src?: string } | null;
  /** 사진 있는 상품(카드) */
  products: LineCard[];
  /** 사진 없는 상품(글로 소개) */
  textProducts: Array<{ name: string; price?: number | null }>;
  /** 혜택 원문(사람이 적은 글 그대로 · AI 를 지나지 않는다) */
  benefit: string | null;
  /** 'YYYY-MM-DD' · 마감 블록 */
  periodEnd: string | null;
  /** 표시용 기간 글('10월 20일(화)까지') */
  periodLabel: string | null;
  link: string | null;
}

export type LineCopy = Record<LineCopyKey, string>;
export type NewId = () => string;

export interface LineDmPage { id: string; name: string; sections: Section[] }
export interface LineDmResult {
  sections: Section[];
  pages: LineDmPage[];
  layoutMode: 'slides' | 'scroll';
  /** 실제로 낸 배치(슬라이드가 3장 미만이면 한 페이지) */
  layout: LineLayout;
  brandKitPatch: { primary_color: string; accent_color: string };
}

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const imgKey = (u: { src?: string; image_url?: string; url?: string }) => String(u.src || u.image_url || u.url || '');

/** 같은 사진은 한 번 — 표지가 쓴 사진과 같은 상품 카드는 사진 없는 글 상품으로 내린다(원래 주소 기준) */
export function dedupeLinePhotos(m: LineMaterials): LineMaterials {
  const seen = new Set<string>();
  if (m.hero) seen.add(imgKey(m.hero));
  const products: LineCard[] = [];
  const textProducts = [...m.textProducts];
  for (const p of m.products) {
    const k = imgKey(p);
    if (!k || seen.has(k)) { textProducts.push({ name: p.name, price: p.discount_price ?? p.price }); continue; }
    seen.add(k);
    products.push(p);
  }
  return { ...m, products, textProducts };
}

/** 상품 수 → 장별 섹션 묶음(한 섹션 2개 이하 · 3 = focus · 4 = 2 + 2 · 5~8 = 장 둘) */
export function planProductPages(n: number, channel: LineChannel = 'dm'): number[][] {
  if (n <= 0) return [];
  // DM 장에 상품 2개만 = 큰 카드 두 장 위아래(좁은 두 칸이 장 높이를 채우면 사진보다 빈칸이 커진다) · 이메일은 두 칸
  const chunk = (k: number): number[] => (k === 2 && channel !== 'email' ? [1, 1] : k <= 2 ? [k] : k === 3 ? [3] : [2, 2]);
  if (n <= 4) return [chunk(n)];
  const first = 4;
  return [chunk(first), chunk(Math.min(4, n - first))];
}

interface Part { type: Section['type']; props: Record<string, unknown>; treatment?: string; fit?: boolean; part: string; background?: Section['background'] }

function cardItem(p: LineCard): Record<string, unknown> {
  return {
    name: p.name,
    price: p.price ?? 0,
    ...(p.discount_price && p.price && p.discount_price < p.price ? { discount_price: p.discount_price } : {}),
    image_url: p.image_url,
    ...(p.link_url ? { link_url: p.link_url } : {}),
  };
}

const textProductLine = (p: LineMaterials['textProducts'][number]) => `${p.name}${p.price ? ` ${won(Number(p.price))}` : ''}`;
function textProductsBody(list: LineMaterials['textProducts']): string {
  return list.map((p) => `· ${textProductLine(p)}`).join('\n');
}

/** 채널 상한 = 카드 + 글 상품 합계(Codex 1R · 받은 상품이 조용히 잘리거나 빠지지 않게 · 화면도 같은 합계로 막는다) */
function capLineProducts(m: LineMaterials, max: number): LineMaterials {
  const products = m.products.slice(0, max);
  return { ...m, products, textProducts: m.textProducts.slice(0, Math.max(0, max - products.length)) };
}

/** 표지 — 사진 · 상품 1개 · 글자 중 하나(재료로 고른다) */
function coverParts(t: LineTemplate, m: LineMaterials, c: LineCopy): { parts: Part[]; productOnCover: boolean } {
  if (t.id === 'big-sale') {
    const headline = m.benefit || c.cover_headline;
    const sub = [m.benefit ? c.cover_headline : c.cover_sub, m.periodLabel].filter(Boolean).join('\n');
    if (m.hero) return { parts: [{ type: 'hero', props: { image_url: m.hero.url, headline, sub_copy: sub, align: 'center', height: 'lg', overlay: 'strong' }, treatment: 'full_bleed', fit: true, part: 'cover' }], productOnCover: false };
    return { parts: [colorCover(t, headline, sub)], productOnCover: false };
  }
  if (m.hero) {
    return { parts: [{ type: 'hero', props: { image_url: m.hero.url, headline: c.cover_headline, sub_copy: [c.cover_sub, t.id === 'special-event' ? m.periodLabel : null].filter(Boolean).join('\n'), align: 'center', height: 'lg', overlay: 'strong' }, treatment: 'full_bleed', fit: true, part: 'cover' }], productOnCover: false };
  }
  if (t.id === 'new-launch' && m.products.length === 1) {
    const p = m.products[0];
    const price = p.discount_price ?? p.price;
    return {
      parts: [{ type: 'hero', props: { image_url: p.image_url, image_fit: 'contain', headline: c.cover_headline, sub_copy: [p.name, price ? won(Number(price)) : null].filter(Boolean).join('\n'), align: 'left', height: 'lg' }, treatment: 'split', fit: true, part: 'cover' }],
      productOnCover: true,
    };
  }
  const sub = [c.cover_sub, t.id === 'special-event' ? m.periodLabel : null].filter(Boolean).join('\n');
  return { parts: [colorCover(t, c.cover_headline, sub)], productOnCover: false };
}

/** 사진이 없을 때의 표지 = 템플릿 색면(주색 → 강조색) 위 흰 글자(빈 사진 자리 0 · 렌더러의 무드 배경) */
function colorCover(t: LineTemplate, headline: string, sub: string): Part {
  return {
    type: 'hero',
    props: { headline, sub_copy: sub, align: 'center', height: 'lg', mood_background: `linear-gradient(160deg, ${t.design.primary} 0%, ${t.design.accent} 100%)`, mood_text: '#ffffff' },
    treatment: 'classic',
    fit: true,
    part: 'cover',
  };
}

function productParts(products: LineCard[], title: string, channel: LineChannel, lead: Part | null = null): Part[][] {
  const out: Part[][] = [];
  let i = 0;
  for (const page of planProductPages(products.length, channel)) {
    const parts: Part[] = out.length === 0 && lead ? [lead] : [];
    for (const k of page) {
      const items = products.slice(i, i + k).map(cardItem);
      i += k;
      parts.push({
        type: 'product_carousel',
        props: { ...(out.length === 0 && i === k && title ? { title } : {}), products: items, image_fit: 'contain', background_color: '#ffffff' },
        treatment: channel === 'email' ? (k === 3 ? 'focus' : 'classic') : (k === 1 || k === 3 ? 'focus' : 'classic'),
        fit: true,
        part: 'products',
      });
    }
    out.push(parts);
  }
  return out;
}

function storyPart(c: LineCopy, treatment = 'lead', withHeadline = true): Part {
  return { type: 'text_card', props: { ...(withHeadline ? { headline: c.story_headline } : {}), body: c.story_body, align: 'center', image_position: 'top' }, treatment, part: 'story' };
}

// 혜택·마감 띠 = 템플릿 주색 바탕 흰 글자(렌더러 기본 검정 띠 + 강조색 글자는 강조색이 어두운 템플릿에서 글자가 사라진다)
function benefitPart(t: LineTemplate, m: LineMaterials, treatment = 'spotlight'): Part | null {
  return m.benefit ? { type: 'coupon', props: { discount_label: m.benefit, card_bg_color: t.design.primary, label_color: '#ffffff' }, treatment, part: 'benefit' } : null;
}

function countdownPart(t: LineTemplate, m: LineMaterials): Part | null {
  return m.periodEnd ? { type: 'countdown', props: { end_datetime: `${m.periodEnd}T23:59:59+09:00`, urgency_text: '마감까지', show_days: true, show_hours: true, show_minutes: true, show_seconds: false, background_color: t.design.primary, urgency_color: '#ffffff' }, treatment: 'banner', part: 'deadline' } : null;
}

function closingParts(m: LineMaterials, c: LineCopy, extra: Array<Part | null>): Part[] {
  const parts: Array<Part | null> = [
    ...extra,
    m.textProducts.length > 0 ? { type: 'text_card', props: { headline: '함께 만나 보세요', body: textProductsBody(m.textProducts), align: 'left', image_position: 'top' }, treatment: 'classic', part: 'more' } : null,
    { type: 'text_card', props: { headline: c.closing_headline, body: c.closing_body, align: 'center', image_position: 'top' }, treatment: 'classic', part: 'closing' },
    { type: 'cta', props: { buttons: [{ label: c.cta_label, url: m.link || '', style: 'primary' }], layout: 'stack' }, treatment: 'bar', part: 'cta' },
  ];
  return parts.filter((p): p is Part => !!p);
}

/** 템플릿별 장 구성(기 · 승 · 전 · 결) — 채널 공통 순서 · 이메일은 같은 순서를 한 장으로 */
export function lineTemplatePageParts(t: LineTemplate, m0: LineMaterials, c: LineCopy, channel: LineChannel): Part[][] {
  const m = dedupeLinePhotos(capLineProducts(m0, t.needs.products.max[channel]));
  const cover = coverParts(t, m, c);
  const products = cover.productOnCover ? m.products.slice(1) : m.products;
  const pages: Part[][] = [cover.parts];
  if (t.id === 'big-sale') {
    pages.push(...productParts(products, c.story_headline, channel));
    pages.push(closingParts(m, c, [countdownPart(t, m), products.length === 0 ? storyPart(c) : null]));
  } else if (t.id === 'new-launch') {
    // 상품 장 첫 장이 큰 카드(2개 이하)면 소개 글을 그 장 위에 · 많으면 제목만 두고 소개 글은 마지막 장 인용으로(같은 제목 두 번 0)
    const roomy = (planProductPages(products.length, channel)[0] || []).reduce((a, b) => a + b, 0) <= 2;
    if (products.length > 0 && roomy) {
      pages.push(...productParts(products, '', channel, storyPart(c, 'lead')));
      pages.push(closingParts(m, c, [benefitPart(t, m)]));
    } else {
      pages.push(...productParts(products, c.story_headline, channel));
      pages.push(closingParts(m, c, [storyPart(c, 'quote', products.length === 0), benefitPart(t, m)]));
    }
  } else if (t.id === 'season') {
    pages.push(...productParts(products, '', channel));
    pages.push(closingParts(m, c, [storyPart(c, 'quote'), benefitPart(t, m)]));
  } else {
    const what = [storyPart(c, 'lead'), benefitPart(t, m)].filter((p): p is Part => !!p);
    pages.push(what);
    pages.push(...productParts(products, '', channel));
    pages.push(closingParts(m, c, [countdownPart(t, m)]));
  }
  return pages.filter((p) => p.length > 0);
}

function toSection(p: Part, pageIdx: number, newId: NewId, opts: { fit: boolean }): Section {
  return {
    id: newId(),
    type: p.type,
    order: 0,
    visible: true,
    ...(p.treatment ? { treatment: p.treatment } : {}),
    ...(p.background ? { background: p.background } : {}),
    props: p.props as Section['props'],
    ...(opts.fit && p.fit ? { fit: 'grow' as const } : {}),
    tpl_slot: `p${pageIdx}.${p.part}`,
  } as Section;
}

function headerSection(m: LineMaterials, newId: NewId): Section {
  return {
    id: newId(), type: 'header', order: 0, visible: true,
    props: { variant: 'logo', brand_name: m.brandName, ...(m.logoUrl ? { logo_url: m.logoUrl } : {}), align: 'center', brand_size: 'sm' } as Section['props'],
    tpl_slot: 'p0.header',
  } as Section;
}

function footerSection(m: LineMaterials, pageIdx: number, newId: NewId): Section {
  return {
    id: newId(), type: 'footer', order: 0, visible: true,
    props: { ...(m.csPhone ? { cs_phone: m.csPhone } : {}), show_unsubscribe_link: true } as Section['props'],
    tpl_slot: `p${pageIdx}.footer`,
  } as Section;
}

/** DM — 슬라이드(장마다 화면 꽉) · 한 페이지(같은 섹션 · 장 경계 없음). 슬라이드가 3장 미만이면 한 페이지. */
export function composeLineDm(t: LineTemplate, layout: LineLayout, m: LineMaterials, c: LineCopy, newId: NewId): LineDmResult {
  const partPages = lineTemplatePageParts(t, m, c, 'dm');
  const effective: LineLayout = layout === 'slides' && partPages.length < 3 ? 'page' : layout;
  const pages: LineDmPage[] = partPages.map((parts, i) => ({
    id: newId(),
    name: `${i + 1}장`,
    // 장 채움 표식은 배치와 무관하게 둔다(한 페이지형에서는 뷰어 CSS 가 작동하지 않아 출력 0 · 편집에서 옆으로 넘기기로 바꾸면 그대로 채운다)
    sections: parts.map((p) => toSection(p, i, newId, { fit: true })),
  }));
  // 머리 = 브랜드 이름 · 로고가 있을 때만(빈 머리 띠 0)
  if (m.brandName || m.logoUrl) pages[0].sections.unshift(headerSection(m, newId));
  pages[pages.length - 1].sections.push(footerSection(m, pages.length - 1, newId));
  let order = 0;
  for (const pg of pages) for (const s of pg.sections) s.order = order++;
  const sections = pages.flatMap((p) => p.sections);
  return {
    sections,
    pages: effective === 'slides' ? pages : [{ id: pages[0].id, name: '1장', sections }],
    layoutMode: effective === 'slides' ? 'slides' : 'scroll',
    layout: effective,
    brandKitPatch: { primary_color: t.design.primary, accent_color: t.design.accent },
  };
}

/** 이메일 — 한 페이지 · 이메일 렌더러가 아는 섹션 · 구도만(히어로 classic/typographic/split · 쿠폰 classic · 마감 = 정적 D-day) */
export function composeLineEmail(t: LineTemplate, m: LineMaterials, c: LineCopy, newId: NewId): { sections: Section[]; subject: string; preheader: string } {
  const pages = lineTemplatePageParts(t, m, c, 'email');
  const parts = pages.flat().map((p) => {
    if (p.type === 'hero' && (p.treatment === 'full_bleed' || p.treatment === 'editorial_overlap')) return { ...p, treatment: 'classic' };
    // 사진 없는 표지 = 이메일 렌더러에 색면이 없어 흰 바탕 큰 제목 · 높이는 낮게(빈 여백 0)
    if (p.type === 'hero' && !p.props.image_url) { const { mood_background: _bg, mood_text: _tx, ...rest } = p.props; return { ...p, props: { ...rest, height: 'sm' } }; }
    if (p.type === 'coupon') return { ...p, treatment: 'classic' };
    if (p.type === 'text_card' && p.treatment === 'quote') return { ...p, treatment: 'lead' };
    return p;
  });
  const sections = [...(m.brandName || m.logoUrl ? [headerSection(m, newId)] : []), ...parts.map((p) => toSection(p, 0, newId, { fit: false })), footerSection(m, 0, newId)];
  sections.forEach((s, i) => { s.order = i; s.tpl_slot = undefined; });
  return { sections, subject: c.email_subject, preheader: c.email_preheader };
}

export interface LineInAppMessage {
  template: 'center_modal';
  title: string;
  body: string;
  badge_text: string | null;
  image_url: string | null;
  buttons: Array<{ id: string; label: string; action_url: string | null; style: 'primary'; background_color: string; text_color: string }>;
  content_blocks: Array<Record<string, unknown>>;
  theme: string;
  card_style: 'classic';
  accent_color: string;
}

/** 인앱 — center_modal 한 장 · v0.3.8 SDK 가 아는 블록만(media · eyebrow · headline · body · benefit · product · cta_group) + 평면 칸 채움 */
export function composeLineInapp(t: LineTemplate, m0: LineMaterials, c: LineCopy): LineInAppMessage {
  const m = dedupeLinePhotos(capLineProducts(m0, 1));
  const product = m.products[0] ?? null;
  const image = m.hero?.url ?? null;
  const blocks: Array<Record<string, unknown>> = [];
  if (image) blocks.push({ type: 'media', variant: 'image', url: image });
  if (c.cover_tag) blocks.push({ type: 'eyebrow', text: c.cover_tag });
  blocks.push({ type: 'headline', text: c.inapp_title });
  blocks.push({ type: 'body', text: [c.inapp_body, m.periodLabel].filter(Boolean).join(' · ') });
  if (m.benefit) blocks.push({ type: 'benefit', text: m.benefit });
  // 사진 없는 상품 = 목록 블록(이름 · 가격 그대로 · SDK 가 아는 블록)
  if (!product && m.textProducts.length > 0) blocks.push({ type: 'bullets', items: m.textProducts.map((p) => ({ text: textProductLine(p) })) });
  if (product) {
    blocks.push({
      type: 'product', name: product.name, image: product.image_url,
      ...(product.price ? { price: product.price } : {}),
      ...(product.discount_price && product.price && product.discount_price < product.price ? { discount_price: product.discount_price } : {}),
      ...(product.link_url ? { link_url: product.link_url } : {}),
    });
  }
  const url = m.link || product?.link_url || null;
  blocks.push({ type: 'cta_group', buttons: [{ label: c.cta_label, action_url: url, style: 'primary' }] });
  return {
    template: 'center_modal',
    title: c.inapp_title,
    body: c.inapp_body,
    badge_text: c.cover_tag || null,
    image_url: image,
    buttons: [{ id: 'b0', label: c.cta_label, action_url: url, style: 'primary', background_color: t.design.primary, text_color: '#ffffff' }],
    content_blocks: blocks,
    theme: t.design.inappTheme,
    card_style: 'classic',
    accent_color: t.design.primary,
  };
}

/**
 * 품질 관문(섹션 · 메시지 단계) — 위반 목록(빈 배열 = 통과). 렌더된 HTML 검사는 테스트가 따로 한다.
 *   빈 상품 · 사진 없는 split · 자리표시 글자 · 같은 사진 반복 · 버튼 둘 이상 · 같은 버튼 글.
 */
export function lineTemplateGate(sections: readonly Section[]): string[] {
  const out: string[] = [];
  const imgs: string[] = [];
  let ctas = 0;
  const PH = /추가해주세요|직접 작성|직접 입력|입력해주세요|\[URL/;
  for (const s of sections) {
    const p = (s.props || {}) as Record<string, any>;
    if (s.type === 'product_carousel') {
      if (!Array.isArray(p.products) || p.products.length === 0) out.push('빈 상품 섹션');
      for (const it of p.products || []) if (it?.image_url) imgs.push(String(it.image_url));
      if ((p.products || []).length > 3) out.push('한 섹션 상품 3개 초과');
    }
    if (s.type === 'hero') {
      if ((s.treatment === 'split' || s.treatment === 'editorial_overlap') && !p.image_url) out.push('사진 없는 사진 구도 표지');
      if (p.image_url) imgs.push(String(p.image_url));
    }
    if (s.type === 'cta') ctas += Array.isArray(p.buttons) ? p.buttons.length : 0;
    if (s.type === 'cta' && s.treatment === 'sticky') out.push('슬라이드 sticky 버튼');
    const text = JSON.stringify(p);
    if (PH.test(text)) out.push(`자리표시 글자(${s.type})`);
  }
  const dup = imgs.filter((u, i) => imgs.indexOf(u) !== i);
  if (dup.length > 0) out.push('같은 사진 반복');
  if (ctas > 1) out.push('버튼 둘 이상');
  return out;
}
