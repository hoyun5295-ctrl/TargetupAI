import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHjlGlobal } from '../index';

/**
 * T1+T2 — IIFE 진입점 인앱 배선 테스트 (2026-06-11 설계서)
 * - hjl.init() 한 번으로 인앱 모듈이 자동 기동되는지
 * - identify 결과(externalId)와 anonymousId가 인앱 조회에 전달되는지
 * - hjl.track() 표준 이벤트가 인앱 트리거로 이어지는지 (브리지)
 */
describe('In-app 배선 (T1 진입점 통합 + T2 이벤트 브리지)', () => {
  let fetchSpy: any;

  const findInAppCall = (substr: string) =>
    fetchSpy.mock.calls.find((c: any[]) => String(c[0]).includes('/inapp/active') && String(c[0]).includes(substr));

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '';
    document.body.removeAttribute('data-hjl-user-id');
    document.body.removeAttribute('data-hjl-phone');
    (window as any).hjl = createHjlGlobal();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, messages: [] }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('init 후 window.hjl.inapp 모듈 노출 (수동 trigger 공개 API)', () => {
    const hjl = (window as any).hjl;
    hjl.init({ apiKey: 'hjl_test123' });
    expect(hjl.inapp).toBeDefined();
    expect(typeof hjl.inapp.trigger).toBe('function');
  });

  it('init 시 인앱 page_load 조회가 externalId + anonymousId와 함께 발생', async () => {
    document.body.setAttribute('data-hjl-user-id', 'user_77');
    const hjl = (window as any).hjl;
    hjl.init({ apiKey: 'hjl_test123' });

    await vi.waitFor(() => {
      const call = findInAppCall('trigger=page_load');
      expect(call).toBeDefined();
      const url = String(call[0]);
      expect(url).toContain('external_id=user_77');
      expect(url).toContain('anonymous_id=anon_');
    });
  });

  it('identify 미존재(비로그인) 시에도 anonymousId만으로 인앱 조회 발생', async () => {
    const hjl = (window as any).hjl;
    hjl.init({ apiKey: 'hjl_test123' });

    await vi.waitFor(() => {
      const call = findInAppCall('trigger=page_load');
      expect(call).toBeDefined();
      const url = String(call[0]);
      expect(url).toContain('anonymous_id=anon_');
      expect(url).not.toContain('external_id=');
    });
  });

  it('track(cart_add) 전송 시 인앱 cart_add 트리거 브리지 호출', async () => {
    const hjl = (window as any).hjl;
    hjl.init({ apiKey: 'hjl_test123' });
    await vi.waitFor(() => expect(findInAppCall('trigger=page_load')).toBeDefined());
    fetchSpy.mockClear();

    hjl.track('cart_add', { product_name: '원피스', price: 39000 });

    await vi.waitFor(() => {
      expect(findInAppCall('trigger=cart_add')).toBeDefined();
    });
  });

  it('브리지 대상 외 이벤트(purchase)는 인앱 트리거 미발생', async () => {
    const hjl = (window as any).hjl;
    hjl.init({ apiKey: 'hjl_test123' });
    await vi.waitFor(() => expect(findInAppCall('trigger=page_load')).toBeDefined());
    fetchSpy.mockClear();

    hjl.track('purchase', { order_id: 'o1' });

    await new Promise((r) => setTimeout(r, 50));
    expect(findInAppCall('trigger=purchase')).toBeUndefined();
  });

  it('cart_add price*quantity 누적 → cart_value 트리거 + 누적 추정치 저장', async () => {
    const hjl = (window as any).hjl;
    hjl.init({ apiKey: 'hjl_test123' });
    await vi.waitFor(() => expect(findInAppCall('trigger=page_load')).toBeDefined());
    fetchSpy.mockClear();

    hjl.track('cart_add', { price: 10000, quantity: 2 });
    hjl.track('cart_add', { price: 5000 });

    await vi.waitFor(() => {
      expect(findInAppCall('trigger=cart_value')).toBeDefined();
    });
    expect(Number(sessionStorage.getItem('hjl_cart_est'))).toBe(25000);
  });

  it('cart_remove 시 누적 추정치 차감 (0 하한)', async () => {
    const hjl = (window as any).hjl;
    hjl.init({ apiKey: 'hjl_test123' });
    await vi.waitFor(() => expect(findInAppCall('trigger=page_load')).toBeDefined());

    hjl.track('cart_add', { price: 10000 });
    hjl.track('cart_remove', { price: 30000 });

    await vi.waitFor(() => {
      expect(Number(sessionStorage.getItem('hjl_cart_est'))).toBe(0);
    });
  });

  it('identify 갱신(watchIdentifyChanges) 시 새 externalId로 인앱 재조회', async () => {
    const hjl = (window as any).hjl;
    hjl.init({ apiKey: 'hjl_test123' });
    await vi.waitFor(() => expect(findInAppCall('trigger=page_load')).toBeDefined());
    fetchSpy.mockClear();

    document.body.setAttribute('data-hjl-user-id', 'user_late_login');

    await vi.waitFor(() => {
      const call = findInAppCall('external_id=user_late_login');
      expect(call).toBeDefined();
    });
  });
});
