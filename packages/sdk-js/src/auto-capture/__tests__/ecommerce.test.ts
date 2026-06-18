import { describe, it, expect, beforeEach } from 'vitest';
import { mapGa4EcommerceEvent, setupEcommerceTracking } from '../ecommerce';

describe('mapGa4EcommerceEvent — GA4 dataLayer → 표준 이벤트 (순수)', () => {
  it('add_to_cart → cart_add + items 정규화', () => {
    const r = mapGa4EcommerceEvent({
      event: 'add_to_cart',
      ecommerce: {
        currency: 'KRW',
        value: 19000,
        items: [{ item_id: 'P1', item_name: '티셔츠', price: 19000, quantity: 1, item_category: '의류' }],
      },
    });
    expect(r).toEqual({
      event: 'cart_add',
      properties: {
        currency: 'KRW',
        value: 19000,
        items: [{ product_id: 'P1', product_name: '티셔츠', price: 19000, quantity: 1, category: '의류' }],
      },
    });
  });

  it('purchase → order_id=transaction_id + value + items', () => {
    const r = mapGa4EcommerceEvent({
      event: 'purchase',
      ecommerce: { currency: 'KRW', value: 50000, transaction_id: 'O100', items: [{ item_id: 'P1', price: 50000, quantity: 1 }] },
    });
    expect(r?.event).toBe('purchase');
    expect(r?.properties.order_id).toBe('O100');
    expect(r?.properties.value).toBe(50000);
    expect((r?.properties.items as any[])?.length).toBe(1);
  });

  it('view_item → product_view, begin_checkout → checkout_start', () => {
    expect(mapGa4EcommerceEvent({ event: 'view_item', ecommerce: { items: [{ item_id: 'P1' }] } })?.event).toBe('product_view');
    expect(mapGa4EcommerceEvent({ event: 'begin_checkout', ecommerce: {} })?.event).toBe('checkout_start');
  });

  it('search → search_term', () => {
    expect(mapGa4EcommerceEvent({ event: 'search', search_term: '원피스' })).toEqual({
      event: 'search',
      properties: { search_term: '원피스' },
    });
  });

  it('미지원 GA4 event → null', () => {
    expect(mapGa4EcommerceEvent({ event: 'view_item_list' })).toBeNull();
    expect(mapGa4EcommerceEvent({ event: 'gtm.js' })).toBeNull();
    expect(mapGa4EcommerceEvent({})).toBeNull();
    expect(mapGa4EcommerceEvent(undefined)).toBeNull();
  });

  it('콤마/문자 price·quantity·value 정규화', () => {
    const r = mapGa4EcommerceEvent({
      event: 'add_to_cart',
      ecommerce: { value: '1,250,000', items: [{ item_id: 'P1', price: '1,250,000', quantity: '2' }] },
    });
    expect(r?.properties.value).toBe(1250000);
    expect((r?.properties.items as any[])[0].price).toBe(1250000);
    expect((r?.properties.items as any[])[0].quantity).toBe(2);
  });
});

describe('setupEcommerceTracking — dataLayer 후킹 + 헬퍼', () => {
  beforeEach(() => {
    (window as any).dataLayer = [];
  });

  it('dataLayer.push(add_to_cart) → track(cart_add) 호출', () => {
    const calls: Array<{ e: string; p: any }> = [];
    const { restore } = setupEcommerceTracking((e, p) => calls.push({ e, p }));
    (window as any).dataLayer.push({ event: 'add_to_cart', ecommerce: { items: [{ item_id: 'P1', price: 100 }] } });
    expect(calls.length).toBe(1);
    expect(calls[0].e).toBe('cart_add');
    restore();
  });

  it('미지원 push는 track 미호출 + 원본 push 보존', () => {
    const calls: any[] = [];
    const { restore } = setupEcommerceTracking((e, p) => calls.push({ e, p }));
    (window as any).dataLayer.push({ event: 'gtm.js' });
    expect(calls.length).toBe(0);
    expect((window as any).dataLayer.length).toBe(1);
    restore();
  });

  it('init 전 기존 dataLayer 엔트리 replay', () => {
    (window as any).dataLayer = [{ event: 'purchase', ecommerce: { transaction_id: 'O9', value: 1000 } }];
    const calls: any[] = [];
    const { restore } = setupEcommerceTracking((e, p) => calls.push({ e, p }));
    expect(calls.length).toBe(1);
    expect(calls[0].e).toBe('purchase');
    restore();
  });

  it('헬퍼 ecommerce.purchase() → track(purchase)', () => {
    const calls: any[] = [];
    const { ecommerce } = setupEcommerceTracking((e, p) => calls.push({ e, p }));
    ecommerce.purchase({ order_id: 'O1', value: 30000 });
    expect(calls[0].e).toBe('purchase');
    expect(calls[0].p.order_id).toBe('O1');
  });

  it('헬퍼 ecommerce.search(term) → search_term', () => {
    const calls: any[] = [];
    const { ecommerce } = setupEcommerceTracking((e, p) => calls.push({ e, p }));
    ecommerce.search('원피스');
    expect(calls[0].e).toBe('search');
    expect(calls[0].p.search_term).toBe('원피스');
  });
});
