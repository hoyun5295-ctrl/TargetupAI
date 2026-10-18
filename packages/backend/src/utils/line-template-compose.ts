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
  /**
   * 표지 사진(올린 사진 · 이벤트 페이지 배너) — 없으면 글자 표지 · 상품 1개면 상품 표지.
   * asIs = 글자가 이미 박힌 그림(AI 영업 포스터 · 홈 배너 · 행사 배너 · ★ 2026-10-18) → 덮어 쓰지 않고 원본 비율 그대로 + 아래 제목.
   */
  hero: { url: string; src?: string; asIs?: boolean; linkUrl?: string } | null;
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
  /** ★ 2026-10-18 AI 영업 — 행사 목록(≤3 · 제목 · 기간 · 배너 · 상세 주소 · 그 행사 상세 그림) · 고객 경로 = 없음 */
  events?: LineEvent[];
  /** ★ 2026-10-18 AI 영업 — 법정 표기(푸터) */
  legal?: string | null;
  /** ★ 2026-10-18 AI 영업 — 혜택 조건 글(면허 행사 카드 본문 원문 · 예: 5만원 이상 구매 시) · 혜택 바로 아래에 싣는다(R5) */
  benefitNote?: string | null;
  /**
   * ★ 2026-10-18 플래너 v2-1 — 표지 제목을 코드가 놓는다(행사명 원문 · AI 문구 대신).
   * 빅세일은 혜택이 짧을 때(≤ 30자)만 혜택이 제목이고, 길면 제목 = 이 값 · 혜택 = 마무리 장 띠(회의론자 6 · 긴 혜택이 표지에서 넘치지 않게).
   * 없으면 지금 그대로(1017 고객 경로 · AI 영업).
   */
  coverHeadline?: string | null;
}

/** 빅세일 표지 제목으로 쓸 수 있는 혜택 길이(플래너 표지 규칙 · coverHeadline 이 있을 때만) */
export const LINE_COVER_BENEFIT_MAX = 30;
/** (순수) 혜택이 표지 제목이 되는가 — 플래너(coverHeadline 있음) = 짧은 혜택만 · 그 밖 = 혜택이 있으면 */
const benefitOnCover = (m: LineMaterials) => !!m.benefit && (!m.coverHeadline || m.benefit.length <= LINE_COVER_BENEFIT_MAX);

/** 행사 하나(원문 제목 · 표시용 기간 · 우리 사본 그림 · 상세 주소) */
export interface LineEvent {
  title: string;
  periodLabel?: string | null;
  image_url?: string | null;
  link_url: string;
  /** 행사 본문(면허 카드만 · 구매 조건 같은 원문 · R5) */
  text?: string | null;
  /** 그림 없는 행사의 작은 링크 버튼 글자(표준 재료의 행사 버튼 글자) */
  cta_label?: string | null;
  /** 그 행사 상세 페이지 그림(우리 사본 · 원본 비율 그대로 이어 붙인다) */
  slices?: Array<{ url: string }>;
}

export type LineCopy = Record<LineCopyKey, string>;
/** 섹션 id 만들기 — part = 그 섹션의 부분 이름(표지 · 상품 · 행사 …) · AI 영업은 부분을 id 에 실어 출처 기록이 읽는다 */
export type NewId = (part?: string) => string;

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
  // ★ 2026-10-18 표지 제목 = 코드가 놓은 값(플래너 행사명)이 있으면 그것 · 없으면 AI 문구(1017 · AI 영업 그대로)
  const title = m.coverHeadline || c.cover_headline;
  const onCover = benefitOnCover(m);
  // ★ 2026-10-18 글자 박힌 그림 = 덮지 않는다 — 그림 원본 비율(링크) + 그 아래 제목 · 부제(혜택 · 기간)
  if (m.hero?.asIs) {
    const big = t.id === 'big-sale' && onCover;
    const headline = big ? m.benefit! : title;
    const sub = [big ? m.benefitNote : null, big ? title : c.cover_sub, t.id === 'big-sale' || t.id === 'special-event' ? m.periodLabel : null].filter(Boolean).join('\n');
    return {
      parts: [
        { type: 'gallery', props: { title: '', images: [{ url: m.hero.url, link_url: m.hero.linkUrl || m.link || '', caption: '' }], layout: 'list_1xN', full_bleed: true, enable_zoom: false, enable_fullscreen: false }, part: 'cover' },
        { type: 'text_card', props: { headline, body: sub, align: 'center', image_position: 'top' }, treatment: 'classic', part: 'cover-copy' },
      ],
      productOnCover: false,
    };
  }
  if (t.id === 'big-sale') {
    const headline = onCover ? m.benefit! : title;
    const sub = [onCover ? m.benefitNote : null, onCover ? title : c.cover_sub, m.periodLabel].filter(Boolean).join('\n');
    if (m.hero) return { parts: [{ type: 'hero', props: { image_url: m.hero.url, headline, sub_copy: sub, align: 'center', height: 'lg', overlay: 'strong' }, treatment: 'full_bleed', fit: true, part: 'cover' }], productOnCover: false };
    return { parts: [colorCover(t, headline, sub)], productOnCover: false };
  }
  if (m.hero) {
    return { parts: [{ type: 'hero', props: { image_url: m.hero.url, headline: title, sub_copy: [c.cover_sub, t.id === 'special-event' ? m.periodLabel : null].filter(Boolean).join('\n'), align: 'center', height: 'lg', overlay: 'strong' }, treatment: 'full_bleed', fit: true, part: 'cover' }], productOnCover: false };
  }
  if (t.id === 'new-launch' && m.products.length === 1) {
    const p = m.products[0];
    const price = p.discount_price ?? p.price;
    return {
      parts: [{ type: 'hero', props: { image_url: p.image_url, image_fit: 'contain', headline: title, sub_copy: [p.name, price ? won(Number(price)) : null].filter(Boolean).join('\n'), align: 'left', height: 'lg' }, treatment: 'split', fit: true, part: 'cover' }],
      productOnCover: true,
    };
  }
  const sub = [c.cover_sub, t.id === 'special-event' ? m.periodLabel : null].filter(Boolean).join('\n');
  return { parts: [colorCover(t, title, sub)], productOnCover: false };
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

/**
 * ★ 2026-10-18 행사 목록(AI 영업) — 배너가 있는 행사 = 그림(링크 · 아래 제목 · 본문 · 기간) · 없는 행사 = 글 카드 · 상세 그림은 그 행사 뒤에 원본 비율로.
 *   주 버튼은 결과물 하나(마무리). 그림도 상세 그림도 없는 행사는 그 주소가 다른 곳(표지 · 상품 · 주 버튼)에 없을 때만 작은 테두리 링크 버튼을 단다(갈 길 0 방지).
 *   표지 · 상품과 같은 그림은 다시 싣지 않는다.
 *   이메일 = 그림 캡션이 대체 글(alt)로만 나가 안 보인다 → 배너 행사도 그림 아래 제목 · 본문(조건) · 기간 글 카드를 보이게 싣는다(Codex R6).
 */
function eventParts(m: LineMaterials, used: ReadonlySet<string>, reach: ReadonlySet<string>, channel: LineChannel): Part[] {
  const out: Part[] = [];
  const seen = new Set(used);
  for (const e of (m.events || []).slice(0, 3)) {
    const caption = [e.title, e.text, e.periodLabel].filter(Boolean).join(' · ');
    if (e.image_url && !seen.has(e.image_url)) {
      seen.add(e.image_url);
      out.push({ type: 'gallery', props: { title: '', images: [{ url: e.image_url, link_url: e.link_url, caption }], layout: 'list_1xN', full_bleed: false, enable_zoom: false, enable_fullscreen: false }, part: 'events' });
      if (channel === 'email') out.push({ type: 'text_card', props: { headline: e.title, body: [e.text, e.periodLabel].filter(Boolean).join('\n'), align: 'left', image_position: 'top' }, treatment: 'classic', part: 'events' });
    } else {
      out.push({ type: 'text_card', props: { tag: '이벤트', headline: e.title, body: [e.text, e.periodLabel].filter(Boolean).join('\n'), align: 'left', image_position: 'top' }, treatment: 'classic', part: 'events' });
    }
    const linked = out.some((p) => p.type === 'gallery' && (p.props.images as Array<{ link_url?: string }> | undefined)?.some((im) => im.link_url === e.link_url));
    const slices = (e.slices || []).filter((s) => s && s.url && !seen.has(s.url)).slice(0, 3);
    for (const s of slices) seen.add(s.url);
    if (slices.length > 0) {
      out.push({ type: 'gallery', props: { title: '', images: slices.map((s) => ({ url: s.url, link_url: e.link_url, caption: '' })), layout: 'list_1xN', full_bleed: true, enable_zoom: false, enable_fullscreen: false }, part: 'slices' });
    } else if (!linked && e.link_url && !reach.has(e.link_url)) {
      out.push({ type: 'cta', props: { buttons: [{ label: e.cta_label || '행사 보러 가기', url: e.link_url, style: 'outline' }], layout: 'stack' }, part: 'events-link' });
    }
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

/** 혜택 띠 + 조건 글(있을 때 · 띠 바로 아래 또렷한 글 카드 — 띠 안 조건 칸은 진한 바탕 위 회색 작은 글씨라 안 읽힌다) */
function benefitParts(t: LineTemplate, m: LineMaterials, treatment = 'spotlight'): Part[] {
  const band = benefitPart(t, m, treatment);
  if (!band) return [];
  return m.benefitNote ? [band, { type: 'text_card', props: { body: m.benefitNote, align: 'center', image_position: 'top' }, treatment: 'classic', part: 'benefit-note' }] : [band];
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
  // ★ 2026-10-18 행사 목록(AI 영업)은 마무리 장 바로 앞 한 장 — 표지 · 상품 그림은 다시 싣지 않는다
  const used = new Set<string>([...(m.hero ? [m.hero.url] : []), ...products.map((p) => p.image_url)]);
  // 이미 갈 길이 있는 주소(표지 그림 · 상품 · 주 버튼) — 행사 링크 버튼은 이 밖의 주소에만
  const reach = new Set<string>([m.link, m.hero?.linkUrl, ...products.map((p) => p.link_url)].filter((u): u is string => !!u));
  const events = eventParts(m, used, reach, channel);
  if (t.id === 'big-sale') {
    pages.push(...productParts(products, c.story_headline, channel));
    // ★ 2026-10-18 표지에 못 올린 긴 혜택(플래너) = 마무리 장 띠 · 그 밖은 지금 그대로(혜택이 있으면 늘 표지)
    pages.push(closingParts(m, c, [...(m.benefit && !benefitOnCover(m) ? benefitParts(t, m) : []), countdownPart(t, m), products.length === 0 ? storyPart(c) : null]));
  } else if (t.id === 'new-launch') {
    // 상품 장 첫 장이 큰 카드(2개 이하)면 소개 글을 그 장 위에 · 많으면 제목만 두고 소개 글은 마지막 장 인용으로(같은 제목 두 번 0)
    const roomy = (planProductPages(products.length, channel)[0] || []).reduce((a, b) => a + b, 0) <= 2;
    if (products.length > 0 && roomy) {
      pages.push(...productParts(products, '', channel, storyPart(c, 'lead')));
      pages.push(closingParts(m, c, benefitParts(t, m)));
    } else {
      pages.push(...productParts(products, c.story_headline, channel));
      pages.push(closingParts(m, c, [storyPart(c, 'quote', products.length === 0), ...benefitParts(t, m)]));
    }
  } else if (t.id === 'season') {
    pages.push(...productParts(products, '', channel));
    pages.push(closingParts(m, c, [storyPart(c, 'quote'), ...benefitParts(t, m)]));
  } else {
    const what = [storyPart(c, 'lead'), ...benefitParts(t, m)];
    pages.push(what);
    pages.push(...productParts(products, '', channel));
    pages.push(closingParts(m, c, [countdownPart(t, m)]));
  }
  if (events.length > 0) pages.splice(pages.length - 1, 0, events);
  return pages.filter((p) => p.length > 0);
}

function toSection(p: Part, pageIdx: number, newId: NewId, opts: { fit: boolean }): Section {
  return {
    id: newId(p.part),
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
    id: newId('header'), type: 'header', order: 0, visible: true,
    props: { variant: 'logo', brand_name: m.brandName, ...(m.logoUrl ? { logo_url: m.logoUrl } : {}), align: 'center', brand_size: 'sm' } as Section['props'],
    tpl_slot: 'p0.header',
  } as Section;
}

function footerSection(m: LineMaterials, pageIdx: number, newId: NewId): Section {
  return {
    id: newId('footer'), type: 'footer', order: 0, visible: true,
    props: { ...(m.legal ? { legal_text: m.legal } : {}), ...(m.csPhone ? { cs_phone: m.csPhone } : {}), show_unsubscribe_link: true } as Section['props'],
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
    if (s.type === 'gallery') for (const im of p.images || []) if (im?.url) imgs.push(String(im.url));
    // 주 버튼만 센다 — AI 영업 행사 링크(테두리 버튼)는 결과물 버튼 하나 규칙 밖(고객 경로 버튼은 전부 주 버튼 · ★ 2026-10-18)
    if (s.type === 'cta') ctas += Array.isArray(p.buttons) ? p.buttons.filter((b: any) => b?.style !== 'outline').length : 0;
    if (s.type === 'cta' && s.treatment === 'sticky') out.push('슬라이드 sticky 버튼');
    const text = JSON.stringify(p);
    if (PH.test(text)) out.push(`자리표시 글자(${s.type})`);
  }
  const dup = imgs.filter((u, i) => imgs.indexOf(u) !== i);
  if (dup.length > 0) out.push('같은 사진 반복');
  if (ctas > 1) out.push('버튼 둘 이상');
  return out;
}
