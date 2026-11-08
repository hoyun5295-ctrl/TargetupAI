/**
 * studio-discount.ts — 할인 포스터(이미지 스튜디오 트랙 'discount') 컨트롤타워(★ 2026-11-08 C114 B · 설계서 docs/2026-11-08-c114-roadmap-v2-design.md §3 B)
 *
 * 틀 = 맨 위 제품명 → 그 밑 혜택(빗금 원래 가격 › 할인율 › 판매가 · N+M 표지 · 세트 구성 줄) → 정해진 제품 자리 · 글자 크게(Harold 1107 · 1108).
 * 숫자는 생성 모델이 그린다(Harold 1108 「오픈 AI 로 가자」 · 샘플 12/12) · 이 CT 는 ① 입력 검사(생성 · 차감 전 400) ② 그릴 글자(숫자에서 만든다)
 *   ③ 프롬프트 줄 ④ 결과 카드 확인 줄을 한 곳에서 만든다. 할인율은 받지 않는다(두 가격에서 정수 내림 · 회의 합의 §B).
 * 순수(DB · 네트워크 0).
 */

export const DISCOUNT_OFFER_KINDS = ['price', 'nplus', 'set'] as const;
export type DiscountOfferKind = typeof DISCOUNT_OFFER_KINDS[number];
/** 금액 상한(원) — 개별 · 합 · 묶음 합계 모두 */
export const DISCOUNT_MAX_WON = 100_000_000;
/** 자유 글 칸(세트 구성 이름 · 기간 · 증정) 길이 상한 */
export const DISCOUNT_TEXT_MAX = 20;
/** 자유 글 칸에 쓰면 안 되는 꼴 = 금액 · % · N+M(숫자는 서버가 정해진 자리에 그린다 · 날짜 · 시각 · 용량 숫자는 허용) */
const MONEYISH_RE = /(\d[\d,]*\s*원|%|\d\s*\+\s*\d)/;
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

export interface DiscountOffer {
  kind: DiscountOfferKind;
  /** price = 할인 전 · 판매가 */
  before?: number;
  sale?: number;
  /** nplus = N + M · 1개 값 */
  n?: number;
  m?: number;
  unit?: number;
  /** set = 구성 이름 · 구성 판매가(같은 수) · sale = 세트가 */
  items?: string[];
  prices?: number[];
  period?: string | null;
  gift?: string | null;
}

export type DiscountOfferRead = { ok: true; offer: DiscountOffer } | { ok: false; field: string; error: string };

const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= DISCOUNT_MAX_WON ? v : null);
const smallInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 9 ? v : null);
const freeText = (v: unknown, field: string, label: string): { ok: true; text: string | null } | { ok: false; field: string; error: string } => {
  if (v === undefined || v === null || v === '') return { ok: true, text: null };
  if (typeof v !== 'string') return { ok: false, field, error: `${label}을 다시 적어 주세요.` };
  const t = v.trim();
  if (!t) return { ok: true, text: null };
  if (t.length > DISCOUNT_TEXT_MAX) return { ok: false, field, error: `${label}은 ${DISCOUNT_TEXT_MAX}자까지 적을 수 있어요.` };
  if (MONEYISH_RE.test(t)) return { ok: false, field, error: `${label}에는 금액, %, 2+1 같은 혜택 숫자를 적지 않아요. 숫자는 위 칸에 넣어 주세요.` };
  return { ok: true, text: t };
};

/** 할인율 = (할인 전 − 판매가) × 100 을 할인 전으로 나눈 몫(정수 내림) · 1 미만 = null */
export function discountRate(before: number, sale: number): number | null {
  if (!(Number.isSafeInteger(before) && Number.isSafeInteger(sale) && sale > 0 && sale < before)) return null;
  const r = Math.floor(((before - sale) * 100) / before);
  return r >= 1 ? r : null;
}

/** 원 단위 정수 → 「38,000원」(쉼표 고정 · 만원 줄임 없음 · 실행 환경 ICU 무관) */
export function wonText(n: number): string {
  return `${String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
}

/** 템플릿 혜택 꼴(kind)에 맞춰 화면이 보낸 값을 읽는다 — 틀리면 칸 이름 + 이유(생성 · 차감 전 400) */
export function readDiscountOffer(raw: unknown, kind: DiscountOfferKind | undefined): DiscountOfferRead {
  if (!kind || !(DISCOUNT_OFFER_KINDS as readonly string[]).includes(kind)) return { ok: false, field: 'offer', error: '할인 템플릿을 다시 골라 주세요.' };
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, field: 'offer', error: '혜택 숫자를 넣어 주세요.' };
  const period = freeText(o.period, 'period', '기간');
  if (!period.ok) return period;
  const gift = freeText(o.gift, 'gift', '증정');
  if (!gift.ok) return gift;
  const common = { period: period.text, gift: gift.text };
  if (kind === 'price') {
    const before = posInt(o.before);
    const sale = posInt(o.sale);
    if (before === null) return { ok: false, field: 'before', error: '할인 전 가격을 숫자로 넣어 주세요(1억 원까지).' };
    if (sale === null) return { ok: false, field: 'sale', error: '판매가를 숫자로 넣어 주세요(1억 원까지).' };
    if (sale >= before) return { ok: false, field: 'sale', error: '판매가는 할인 전 가격보다 낮아야 해요.' };
    return { ok: true, offer: { kind, before, sale, ...common } };
  }
  if (kind === 'nplus') {
    const n = smallInt(o.n);
    const m = smallInt(o.m);
    const unit = posInt(o.unit);
    if (n === null) return { ok: false, field: 'n', error: '사는 개수는 1 ~ 9 로 넣어 주세요.' };
    if (m === null) return { ok: false, field: 'm', error: '더 주는 개수는 1 ~ 9 로 넣어 주세요.' };
    if (unit === null) return { ok: false, field: 'unit', error: '1개 가격을 숫자로 넣어 주세요(1억 원까지).' };
    if (unit * (n + m) > DISCOUNT_MAX_WON) return { ok: false, field: 'unit', error: '묶음 합계가 1억 원을 넘어요.' };
    return { ok: true, offer: { kind, n, m, unit, ...common } };
  }
  // set
  const itemsRaw = Array.isArray(o.items) ? o.items : null;
  const pricesRaw = Array.isArray(o.prices) ? o.prices : null;
  if (!itemsRaw || itemsRaw.length < 2 || itemsRaw.length > 3) return { ok: false, field: 'items', error: '세트 구성을 2 ~ 3개 넣어 주세요.' };
  if (!pricesRaw || pricesRaw.length !== itemsRaw.length) return { ok: false, field: 'prices', error: '구성마다 판매가를 넣어 주세요.' };
  const items: string[] = [];
  for (const it of itemsRaw) {
    const r = freeText(it, 'items', '구성 이름');
    if (!r.ok) return r;
    if (!r.text) return { ok: false, field: 'items', error: '구성 이름을 넣어 주세요.' };
    items.push(r.text);
  }
  const prices: number[] = [];
  for (const p of pricesRaw) {
    const v = posInt(p);
    if (v === null) return { ok: false, field: 'prices', error: '구성 판매가를 숫자로 넣어 주세요(1억 원까지).' };
    prices.push(v);
  }
  const sum = prices.reduce((a, b) => a + b, 0);
  if (sum > DISCOUNT_MAX_WON) return { ok: false, field: 'prices', error: '따로 사면 합계가 1억 원을 넘어요.' };
  const sale = posInt(o.sale);
  if (sale === null) return { ok: false, field: 'sale', error: '세트가를 숫자로 넣어 주세요.' };
  if (sale >= sum) return { ok: false, field: 'sale', error: '세트가는 따로 사면 합계보다 낮아야 해요.' };
  return { ok: true, offer: { kind, items, prices, sale, ...common } };
}

/** 포스터에 그려질 혜택 글자(사람이 보는 순서) — 프롬프트 줄 · 결과 카드 확인 줄 · 샘플 대조가 같은 값을 쓴다 */
export function discountDrawnTexts(offer: DiscountOffer): string[] {
  const out: string[] = [];
  if (offer.period) out.push(offer.period);
  if (offer.kind === 'price') {
    const r = discountRate(offer.before!, offer.sale!);
    out.push(wonText(offer.before!), ...(r ? [`${r}%`] : []), wonText(offer.sale!));
  } else if (offer.kind === 'nplus') {
    const { n, m, unit } = offer as Required<Pick<DiscountOffer, 'n' | 'm' | 'unit'>>;
    out.push(`${n}+${m}`, `${n + m}개`, wonText(unit * (n + m)), wonText(unit * n));
  } else {
    const sum = offer.prices!.reduce((a, b) => a + b, 0);
    const r = discountRate(sum, offer.sale!);
    out.push(offer.items!.join(' + '), '따로 사면', wonText(sum), ...(r ? [`${r}%`] : []), '세트가', wonText(offer.sale!));
  }
  if (offer.gift) out.push('증정', offer.gift);
  return out;
}

/** 결과 카드 「포스터에 들어간 숫자」 한 줄(고객 노출 · 가운뎃점 0) */
export function discountCheckLine(offer: DiscountOffer): string {
  let main = '';
  if (offer.kind === 'price') {
    const r = discountRate(offer.before!, offer.sale!);
    main = `${wonText(offer.before!)} → ${r ? `${r}% ` : ''}${wonText(offer.sale!)}`;
  } else if (offer.kind === 'nplus') {
    main = `${offer.n}+${offer.m}, ${offer.n! + offer.m!}개 ${wonText(offer.unit! * (offer.n! + offer.m!))} → ${wonText(offer.unit! * offer.n!)}`;
  } else {
    const sum = offer.prices!.reduce((a, b) => a + b, 0);
    const r = discountRate(sum, offer.sale!);
    main = `따로 사면 ${wonText(sum)} → ${r ? `${r}% ` : ''}세트가 ${wonText(offer.sale!)}`;
  }
  const extra = [offer.period ? `기간 ${offer.period}` : '', offer.gift ? `증정 ${offer.gift}` : ''].filter(Boolean).join(', ');
  return extra ? `${main} (${extra})` : main;
}

/**
 * ★ 2026-11-08 C118 E6 인앱용(안전 칸 = 가운데 비율 · 앱이 가장자리를 잘라도 내용 0 잘림) = 「맨 위 · 맨 아래 가장자리」 대신 「바깥 띠 안쪽」 ·
 *   safe 없음(인앱 아닌 용도) = 지금 문장 글자 그대로.
 */
function edgeBandOf(safe: number | null | undefined): number | null {
  return typeof safe === 'number' && safe > 0 && safe < 1 ? Math.round((1 - safe) * 50) : null;
}

/** ★ C119 배치(템플릿 속성) — stack = 위 글 · 아래 가운데 제품(지금 문장 글자 그대로) / side = 왼쪽 한 기둥 글 · 오른쪽 아래 제품 */
export type DiscountLayout = 'stack' | 'side';

/** 프롬프트 혜택 줄 — 지정 문구(제목 = 제품명) 바로 뒤 · 마지막 금지 줄 앞에 들어간다(샘플 스크립트로 확인한 문장 꼴 · 1108) */
export function discountPromptLines(offer: DiscountOffer, brandColor?: string | null, safe?: number | null, layout: DiscountLayout = 'stack'): string[] {
  const lines: string[] = [];
  const edge = edgeBandOf(safe);
  const side = layout === 'side';
  const align = side ? 'left-aligned' : 'centered';
  const inBand = edge === null ? '' : `, just inside the outer ${edge}% band (never in it)`;
  if (offer.period) {
    lines.push(side
      ? `- Date pill at the top of the left text column, above the headline${inBand}: "${offer.period}" in a bright rounded pill.`
      : edge === null
        ? `- Date pill at the very top of the poster, above the headline: "${offer.period}" in a bright rounded pill.`
        : `- Date pill at the top of the poster, above the headline, just inside the outer ${edge}% band (never in it): "${offer.period}" in a bright rounded pill.`);
  }
  if (offer.kind === 'price') {
    const r = discountRate(offer.before!, offer.sale!);
    lines.push(`- Price row directly below the headline, ${align}, ONE single row, the most prominent element of the poster: the original price "${wonText(offer.before!)}" in smaller muted gray with one diagonal strike line through it, then a right-pointing chevron "›", then ${r ? `the discount rate "${r}%" in bold accent color, then ` : ''}the sale price "${wonText(offer.sale!)}" as the largest and boldest text on the whole poster.`);
  } else if (offer.kind === 'nplus') {
    const { n, m, unit } = offer as Required<Pick<DiscountOffer, 'n' | 'm' | 'unit'>>;
    lines.push(`- Offer badge between the headline and the price row, ${align}: a large bold rounded badge reading exactly "${n}+${m}".`);
    lines.push(`- Price row below the badge, ${align}, ONE single row: the small label "${n + m}개", the original total "${wonText(unit * (n + m))}" in muted gray with one diagonal strike line through it, a right-pointing chevron "›", then "${wonText(unit * n)}" large and bold.`);
  } else {
    const sum = offer.prices!.reduce((a, b) => a + b, 0);
    const r = discountRate(sum, offer.sale!);
    lines.push(`- Set composition line directly below the headline, ${align}, medium weight: "${offer.items!.join(' + ')}".`);
    lines.push(`- Price row below it, ${align}, ONE single row, the most prominent element of the poster: the small label "따로 사면", the total "${wonText(sum)}" in muted gray with one diagonal strike line through it, a right-pointing chevron "›", ${r ? `the discount rate "${r}%" in bold accent color, ` : ''}the small label "세트가", then the set price "${wonText(offer.sale!)}" as the largest and boldest text on the whole poster.`);
  }
  if (offer.gift) {
    lines.push(side
      ? `- Gift tag small at the bottom left, below the text column${inBand}: a small red tag reading "증정" followed by "${offer.gift}" inside one white rounded pill.`
      : edge === null
        ? `- Gift tag at the very bottom of the poster, below the product: a small red tag reading "증정" followed by "${offer.gift}" inside one white rounded pill.`
        : `- Gift tag at the bottom of the poster, below the product, just inside the outer ${edge}% band (never in it): a small red tag reading "증정" followed by "${offer.gift}" inside one white rounded pill.`);
  }
  if (brandColor && HEX6_RE.test(brandColor)) lines.push(`- Use the brand color ${brandColor} as the accent color for the badge, the discount rate and the sale price.`);
  return lines;
}

/** 프롬프트 맨 끝 고정 틀 줄(모든 자리 지시보다 뒤 · 모델이 마지막 지시에 가장 강하게 반응한다) */
export function discountFixedLayoutLine(offer: DiscountOffer, safe?: number | null, layout: DiscountLayout = 'stack'): string {
  const edge = edgeBandOf(safe);
  if (layout === 'side') {
    // ★ C119 왼쪽 글형 = 왼쪽 정렬 한 기둥 · 제품 = 오른쪽 아래 크게(인앱 = 가운데 안전 칸 안 · 가장자리 걸치기 0)
    const band = edge === null ? '' : ` This poster is shown in an app popup that may crop the outer ${edge}% on every side: that outer ${edge}% band on every side is background only, and the date pill, the headline, every offer element, the gift tag and the product all stay inside the central ${100 - edge * 2}% of the width and of the height.`;
    const product = edge === null
      ? 'The product sits large in the lower right of the poster on its styled surface, may extend toward the right and bottom edges, and must never overlap, touch, or sit behind any text.'
      : 'The product sits large in the lower right of the poster on its styled surface and must never overlap, touch, or sit behind any text.';
    return `FIXED TEMPLATE LAYOUT (this rule overrides every placement direction above): one left-aligned text column inside the left 55% of the poster, starting near the top: ${offer.period ? 'the date pill at the top of the column, then ' : ''}the headline, then the offer elements in the order listed, every element on the same left margin, over a calm, plain area of the backdrop.${offer.gift ? ' The gift tag alone sits small at the bottom left, below the text column.' : ''} ${product}${band} Typography must be LARGE and bold for phone screens: the headline about 5% of the poster height, the sale price about 8% of the poster height, no tiny fine print anywhere. Render every number exactly as given, digit by digit, including the commas and the "원" unit.`;
  }
  const top = edge === null ? 'the date pill at the very top, then ' : 'the date pill at the top, then ';
  const gift = edge === null ? ' The gift tag alone sits at the very bottom edge, below the product.' : ' The gift tag alone sits at the bottom, below the product.';
  // (C118 E6) 인앱용 = 고정 틀이 안전 칸까지 품는다(이 줄이 다른 지시를 모두 이기므로 안전 칸도 이 줄 안에)
  const band = edge === null ? '' : ` This poster is shown in an app popup that may crop the outer ${edge}% on every side: that outer ${edge}% band on every side is background only, and the date pill, the headline, every offer element, the gift tag and the product all stay inside the central ${100 - edge * 2}% of the width and of the height.`;
  return `FIXED TEMPLATE LAYOUT (this rule overrides every placement direction above): ${offer.period ? top : ''}the headline, then the offer elements in the order listed, all inside the upper 40% of the poster on a calm, plain area of the backdrop.${offer.gift ? gift : ''} The product occupies only the lower 55% of the poster, centered, and must never overlap, touch, or sit behind any text.${band} Typography must be LARGE and bold for phone screens: the headline about 5% of the poster height, the sale price about 8% of the poster height, no tiny fine print anywhere. Render every number exactly as given, digit by digit, including the commas and the "원" unit.`;
}

/** 브랜드 키트 강조색 고르기 — primary_color → accent_color · 6자리 hex 만 */
export function discountBrandColor(kit: { primary_color?: unknown; accent_color?: unknown } | null | undefined): string | null {
  for (const v of [kit?.primary_color, kit?.accent_color]) {
    if (typeof v === 'string' && HEX6_RE.test(v.trim())) return v.trim();
  }
  return null;
}
