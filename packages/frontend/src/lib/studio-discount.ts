/**
 * studio-discount.ts(화면) — 할인 포스터 숫자 칸 → 보낼 혜택 · 만들기 전 「포스터에 들어갈 숫자」 한 줄(★ 2026-11-08 C114 B · React 0 · 순수)
 *   판정 권한 = 서버 utils/studio-discount.ts(readDiscountOffer · 생성 · 차감 전 400). 이 파일은 같은 규칙으로 미리 보여 주고 막을 뿐이다.
 *   백엔드 계약 시험(c114-discount-parity-1108)이 같은 표본으로 두 파일을 대조한다(할인율 · 원 글 · 확인 줄 · 검사 칸).
 */
export type DiscountOfferKind = 'price' | 'nplus' | 'set';
export const DISCOUNT_MAX_WON = 100_000_000;
export const DISCOUNT_TEXT_MAX = 20;
const MONEYISH_RE = /(\d[\d,]*\s*원|%|\d\s*\+\s*\d)/;

/** 숫자 칸 글 → 원(정수) · 허용 = 숫자 · 쉼표 · 「원」 · 공백 · 그 밖(., 만, 천 · 빈 칸) = null */
export function parseWon(raw: string): number | null {
  const t = String(raw ?? '').replace(/\s+/g, '');
  if (!t || !/^[\d,]+원?$/.test(t)) return null;
  const n = Number(t.replace(/[,원]/g, ''));
  return Number.isSafeInteger(n) && n >= 1 && n <= DISCOUNT_MAX_WON ? n : null;
}

export function discountRate(before: number, sale: number): number | null {
  if (!(Number.isSafeInteger(before) && Number.isSafeInteger(sale) && sale > 0 && sale < before)) return null;
  const r = Math.floor(((before - sale) * 100) / before);
  return r >= 1 ? r : null;
}

export function wonText(n: number): string {
  return `${String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
}

/** 화면 칸 값(글 그대로) */
export interface DiscountFields {
  before: string; sale: string;
  n: number; m: number; unit: string;
  items: string[]; prices: string[]; setSale: string;
  period: string; gift: string;
}
export const EMPTY_DISCOUNT_FIELDS: DiscountFields = {
  before: '', sale: '', n: 1, m: 1, unit: '', items: ['', '', ''], prices: ['', '', ''], setSale: '', period: '', gift: '',
};

export interface DiscountOfferBody {
  before?: number; sale?: number; n?: number; m?: number; unit?: number; items?: string[]; prices?: number[]; period?: string; gift?: string;
}
export type DiscountBuild = { ok: true; offer: DiscountOfferBody; line: string } | { ok: false; field: string; error: string };

const free = (v: string, field: string, label: string): { ok: true; text: string | null } | { ok: false; field: string; error: string } => {
  const t = String(v ?? '').trim();
  if (!t) return { ok: true, text: null };
  if (t.length > DISCOUNT_TEXT_MAX) return { ok: false, field, error: `${label}은 ${DISCOUNT_TEXT_MAX}자까지 적을 수 있어요.` };
  if (MONEYISH_RE.test(t)) return { ok: false, field, error: `${label}에는 금액, %, 2+1 같은 혜택 숫자를 적지 않아요. 숫자는 위 칸에 넣어 주세요.` };
  return { ok: true, text: t };
};

/**
 * 칸 → 보낼 혜택 + 확인 줄. 세트 구성 수 = 이름이나 가격이 든 줄 수(2 ~ 3).
 * 확인 줄 = 서버 discountCheckLine 과 같은 글(계약 시험) · 가운뎃점 0.
 */
export function buildDiscountOffer(kind: DiscountOfferKind, f: DiscountFields): DiscountBuild {
  const period = free(f.period, 'period', '기간');
  if (!period.ok) return period;
  const gift = free(f.gift, 'gift', '증정');
  if (!gift.ok) return gift;
  const extras: DiscountOfferBody = { ...(period.text ? { period: period.text } : {}), ...(gift.text ? { gift: gift.text } : {}) };
  const tail = [period.text ? `기간 ${period.text}` : '', gift.text ? `증정 ${gift.text}` : ''].filter(Boolean).join(', ');
  const withTail = (main: string) => (tail ? `${main} (${tail})` : main);
  if (kind === 'price') {
    const before = parseWon(f.before);
    const sale = parseWon(f.sale);
    if (before === null) return { ok: false, field: 'before', error: '할인 전 가격을 숫자로 넣어 주세요(1억 원까지).' };
    if (sale === null) return { ok: false, field: 'sale', error: '판매가를 숫자로 넣어 주세요(1억 원까지).' };
    if (sale >= before) return { ok: false, field: 'sale', error: '판매가는 할인 전 가격보다 낮아야 해요.' };
    const r = discountRate(before, sale);
    return { ok: true, offer: { before, sale, ...extras }, line: withTail(`${wonText(before)} → ${r ? `${r}% ` : ''}${wonText(sale)}`) };
  }
  if (kind === 'nplus') {
    const { n, m } = f;
    const unit = parseWon(f.unit);
    if (!(Number.isInteger(n) && n >= 1 && n <= 9)) return { ok: false, field: 'n', error: '사는 개수는 1 ~ 9 로 넣어 주세요.' };
    if (!(Number.isInteger(m) && m >= 1 && m <= 9)) return { ok: false, field: 'm', error: '더 주는 개수는 1 ~ 9 로 넣어 주세요.' };
    if (unit === null) return { ok: false, field: 'unit', error: '1개 가격을 숫자로 넣어 주세요(1억 원까지).' };
    if (unit * (n + m) > DISCOUNT_MAX_WON) return { ok: false, field: 'unit', error: '묶음 합계가 1억 원을 넘어요.' };
    return { ok: true, offer: { n, m, unit, ...extras }, line: withTail(`${n}+${m}, ${n + m}개 ${wonText(unit * (n + m))} → ${wonText(unit * n)}`) };
  }
  const rows = f.items.map((name, i) => ({ name: String(name ?? '').trim(), price: String(f.prices[i] ?? '').trim() })).filter((r) => r.name || r.price);
  if (rows.length < 2 || rows.length > 3) return { ok: false, field: 'items', error: '세트 구성을 2 ~ 3개 넣어 주세요.' };
  const items: string[] = [];
  const prices: number[] = [];
  for (const r of rows) {
    const nm = free(r.name, 'items', '구성 이름');
    if (!nm.ok) return nm;
    if (!nm.text) return { ok: false, field: 'items', error: '구성 이름을 넣어 주세요.' };
    const p = parseWon(r.price);
    if (p === null) return { ok: false, field: 'prices', error: '구성 판매가를 숫자로 넣어 주세요(1억 원까지).' };
    items.push(nm.text);
    prices.push(p);
  }
  const sum = prices.reduce((a, b) => a + b, 0);
  if (sum > DISCOUNT_MAX_WON) return { ok: false, field: 'prices', error: '따로 사면 합계가 1억 원을 넘어요.' };
  const sale = parseWon(f.setSale);
  if (sale === null) return { ok: false, field: 'sale', error: '세트가를 숫자로 넣어 주세요.' };
  if (sale >= sum) return { ok: false, field: 'sale', error: '세트가는 따로 사면 합계보다 낮아야 해요.' };
  const r = discountRate(sum, sale);
  return { ok: true, offer: { items, prices, sale, ...extras }, line: withTail(`따로 사면 ${wonText(sum)} → ${r ? `${r}% ` : ''}세트가 ${wonText(sale)}`) };
}

/**
 * 몰 상품 자동 채움(비어 있는 칸만 · 사람 값 보존). 할인 중이 아니면(판매가 = 정가) 판매가 칸을 비워 둔다(회의 합의 §B 7).
 *   세트 = 상품 순서대로 이름 · 판매가.
 */
export function autoFillDiscount(kind: DiscountOfferKind, f: DiscountFields, products: Array<{ name: string; price: number; salePrice: number } | null>): DiscountFields {
  const first = products.find(Boolean) || null;
  const next: DiscountFields = { ...f, items: [...f.items], prices: [...f.prices] };
  const num = (v: number) => (Number.isSafeInteger(v) && v > 0 ? String(v) : '');
  if (kind === 'price' && first) {
    const discounted = first.salePrice > 0 && first.salePrice < first.price;
    if (!next.before.trim()) next.before = num(first.price || first.salePrice);
    if (!next.sale.trim() && discounted) next.sale = num(first.salePrice);
  } else if (kind === 'nplus' && first) {
    if (!next.unit.trim()) next.unit = num(first.salePrice || first.price);
  } else if (kind === 'set') {
    products.forEach((p, i) => {
      if (!p || i > 2) return;
      if (!next.items[i].trim()) next.items[i] = p.name.slice(0, DISCOUNT_TEXT_MAX);
      if (!next.prices[i].trim()) next.prices[i] = num(p.salePrice || p.price);
    });
  }
  return next;
}
