/**
 * ★ 2026-11-08 C114 화면 할인 칸(frontend lib/studio-discount.ts) = 서버 CT(utils/studio-discount.ts) 대조
 *   같은 표본 → 같은 할인율 · 원 글 · 확인 줄 · 검사 칸(화면이 막는 것 = 서버가 막는 것).
 */
import { describe, it, expect } from 'vitest';
import * as be from '../studio-discount';
import * as fe from '../../../../frontend/src/lib/studio-discount';

const F = (over: Partial<fe.DiscountFields>): fe.DiscountFields => ({ ...fe.EMPTY_DISCOUNT_FIELDS, items: ['', '', ''], prices: ['', '', ''], ...over });

describe('화면 = 서버(할인율 · 원 글)', () => {
  it('같은 값', () => {
    for (const [b, s] of [[562000, 494000], [1000, 800], [250000, 217510], [10000, 9950], [38000, 29900], [1000, 1000]]) {
      expect(fe.discountRate(b, s)).toBe(be.discountRate(b, s));
    }
    for (const n of [0, 5, 999, 1000, 1249000, 100000000]) expect(fe.wonText(n)).toBe(be.wonText(n));
  });
  it('숫자 칸 해석 = 숫자 · 쉼표 · 원만', () => {
    expect(fe.parseWon('38,000')).toBe(38000);
    expect(fe.parseWon('38000원')).toBe(38000);
    expect(fe.parseWon(' 1,000 원 ')).toBe(1000);
    for (const bad of ['3.8만', '3만', '천원', '', '-1000', '0', '100000001']) expect(fe.parseWon(bad), bad).toBeNull();
  });
});

describe('확인 줄 · 검사 칸 = 서버와 같다', () => {
  const cases: Array<[fe.DiscountOfferKind, Partial<fe.DiscountFields>]> = [
    ['price', { before: '38,000', sale: '29,900' }],
    ['price', { before: '10000', sale: '9950', period: '오늘만' }],
    ['price', { before: '1000', sale: '1000' }],
    ['price', { before: '2', sale: '1', gift: '1+1 쿠폰' }],
    ['nplus', { n: 1, m: 1, unit: '6,500' }],
    ['nplus', { n: 9, m: 9, unit: '10,000,000' }],
    ['set', { items: ['앰버 세럼', '케이블 니트', ''], prices: ['38000', '129000', ''], setSale: '139000', period: '11.10 ~ 11.16', gift: '울 머플러' }],
    ['set', { items: ['a', '', ''], prices: ['1000', '', ''], setSale: '1' }],
    ['set', { items: ['a', 'b', ''], prices: ['1', '1', ''], setSale: '2' }],
  ];
  for (const [kind, over] of cases) {
    it(`${kind} ${JSON.stringify(over)}`, () => {
      const f = fe.buildDiscountOffer(kind, F(over));
      const s = be.readDiscountOffer(f.ok ? f.offer : (() => {
        // 화면이 막은 값 = 서버에 같은 값을 그대로 넣어도 막힌다(필드 이름 같음)
        const raw: any = {};
        const ff = F(over);
        if (kind === 'price') { raw.before = fe.parseWon(ff.before) ?? ff.before; raw.sale = fe.parseWon(ff.sale) ?? ff.sale; }
        if (kind === 'nplus') { raw.n = ff.n; raw.m = ff.m; raw.unit = fe.parseWon(ff.unit) ?? ff.unit; }
        if (kind === 'set') {
          const rows = ff.items.map((n, i) => ({ n: n.trim(), p: ff.prices[i].trim() })).filter((r) => r.n || r.p);
          raw.items = rows.map((r) => r.n); raw.prices = rows.map((r) => fe.parseWon(r.p) ?? r.p); raw.sale = fe.parseWon(ff.setSale) ?? ff.setSale;
        }
        if (ff.period.trim()) raw.period = ff.period.trim();
        if (ff.gift.trim()) raw.gift = ff.gift.trim();
        return raw;
      })(), kind);
      expect(s.ok).toBe(f.ok);
      if (f.ok && s.ok) expect(f.line).toBe(be.discountCheckLine(s.offer));
      if (!f.ok && !s.ok) expect(f.field).toBe(s.field);
    });
  }
});

describe('몰 상품 자동 채움', () => {
  it('할인 중이면 정가 · 판매가 · 아니면 판매가 칸 비움 · 사람 값 보존', () => {
    expect(fe.autoFillDiscount('price', F({}), [{ name: 'a', price: 38000, salePrice: 29900 }])).toMatchObject({ before: '38000', sale: '29900' });
    expect(fe.autoFillDiscount('price', F({}), [{ name: 'a', price: 38000, salePrice: 38000 }])).toMatchObject({ before: '38000', sale: '' });
    expect(fe.autoFillDiscount('price', F({ before: '50000' }), [{ name: 'a', price: 38000, salePrice: 29900 }])).toMatchObject({ before: '50000', sale: '29900' });
    const s = fe.autoFillDiscount('set', F({}), [{ name: '세럼', price: 40000, salePrice: 38000 }, { name: '크림', price: 24000, salePrice: 0 }]);
    expect(s.items.slice(0, 2)).toEqual(['세럼', '크림']);
    expect(s.prices.slice(0, 2)).toEqual(['38000', '24000']);
  });
});
