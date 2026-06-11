import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HanjulloInAppModule } from '../inapp';

/**
 * T1/T2/T3/T4 — 인앱 모듈 자동 기동 보강 테스트 (2026-06-11 설계서)
 * - lastInput: init 재호출 후 input 없는 trigger가 최신 identity 사용
 * - cart_value_min: 누적 추정치가 조건 미달이면 미렌더
 * - 응답 customer 동봉: input.customer 부재 시 서버 동봉 customer로 치환
 * - dwell_seconds: 표시→닫기 경과 초 트래킹 전송
 */

const ENDPOINT = 'https://app.hanjul.ai/api/cdp';

function makeMessage(over: Record<string, any> = {}) {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    title: '안내',
    body: '본문',
    template: 'top_banner',
    backgroundColor: '#4f46e5',
    textColor: '#ffffff',
    triggerEvent: 'page_load',
    displayFrequency: 'always',
    buttons: [],
    ...over,
  };
}

describe('HanjulloInAppModule 자동 기동 보강', () => {
  let fetchSpy: any;
  let messagesPayload: any;

  const activeCalls = () =>
    fetchSpy.mock.calls.filter((c: any[]) => String(c[0]).includes('/inapp/active'));
  const trackCalls = () =>
    fetchSpy.mock.calls.filter((c: any[]) => String(c[0]).includes('/inapp/track'));

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '';
    messagesPayload = { success: true, messages: [] };
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes('/inapp/active') ? messagesPayload : { success: true }),
    }) as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('init 재호출 후 input 없는 trigger는 최신 externalId를 사용한다', async () => {
    const m = new HanjulloInAppModule('hjl_test', '', ENDPOINT);
    await m.init({ externalId: 'A', anonymousId: 'anon_x', enableAutoTriggers: false });
    await m.init({ externalId: 'B', anonymousId: 'anon_x', enableAutoTriggers: false });
    fetchSpy.mockClear();

    await m.trigger('cart_add');

    const call = activeCalls().find((c: any[]) => String(c[0]).includes('trigger=cart_add'));
    expect(call).toBeDefined();
    expect(String(call[0])).toContain('external_id=B');
  });

  it('cart_value 트리거 — cartValue가 cart_value_min 미달이면 렌더하지 않는다', async () => {
    messagesPayload = {
      success: true,
      messages: [makeMessage({
        triggerEvent: 'cart_value',
        triggerConditions: { event: 'cart_value', cart_value_min: 100000 },
      })],
    };
    const m = new HanjulloInAppModule('hjl_test', '', ENDPOINT);

    await m.trigger('cart_value', { anonymousId: 'anon_x', cartValue: 50000 });

    expect(document.querySelector('[data-hanjullo-msg]')).toBeNull();
  });

  it('cart_value 트리거 — cartValue가 cart_value_min 이상이면 렌더한다', async () => {
    messagesPayload = {
      success: true,
      messages: [makeMessage({
        triggerEvent: 'cart_value',
        triggerConditions: { event: 'cart_value', cart_value_min: 100000 },
      })],
    };
    const m = new HanjulloInAppModule('hjl_test', '', ENDPOINT);

    await m.trigger('cart_value', { anonymousId: 'anon_x', cartValue: 150000 });

    expect(document.querySelector('[data-hanjullo-msg]')).not.toBeNull();
  });

  it('서버 동봉 customer로 %고객명% 치환 (input.customer 부재 시)', async () => {
    messagesPayload = {
      success: true,
      messages: [makeMessage({ title: '%고객명%님 환영', body: '{{ customer.grade }} 혜택 안내' })],
      customer: { name: '철수', grade: 'VIP' },
    };
    const m = new HanjulloInAppModule('hjl_test', '', ENDPOINT);

    await m.init({ externalId: 'A', anonymousId: 'anon_x', enableAutoTriggers: false });

    const el = document.querySelector('[data-hanjullo-msg]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('철수님 환영');
    expect(el!.textContent).toContain('VIP 혜택 안내');
  });

  it('input.customer가 있으면 서버 동봉 customer보다 우선한다', async () => {
    messagesPayload = {
      success: true,
      messages: [makeMessage({ title: '%고객명%님 환영' })],
      customer: { name: '철수' },
    };
    const m = new HanjulloInAppModule('hjl_test', '', ENDPOINT);

    await m.init({ externalId: 'A', anonymousId: 'anon_x', customer: { name: '영희' }, enableAutoTriggers: false });

    const el = document.querySelector('[data-hanjullo-msg]');
    expect(el!.textContent).toContain('영희님 환영');
  });

  it('캐시 hit 경로에서도 서버 동봉 customer 치환이 유지된다', async () => {
    messagesPayload = {
      success: true,
      messages: [makeMessage({ title: '%고객명%님 다시 환영' })],
      customer: { name: '철수' },
    };
    const m = new HanjulloInAppModule('hjl_test', '', ENDPOINT);
    await m.init({ externalId: 'A', anonymousId: 'anon_x', enableAutoTriggers: false });
    document.body.innerHTML = '';

    await m.init({ externalId: 'A', anonymousId: 'anon_x', enableAutoTriggers: false });

    expect(activeCalls().length).toBe(1); // 두 번째는 5분 캐시 hit
    const el = document.querySelector('[data-hanjullo-msg]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('철수님 다시 환영');
  });

  it('닫기 시 dwell_seconds(표시→닫기 경과 초)를 트래킹으로 전송한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    messagesPayload = { success: true, messages: [makeMessage()] };
    const m = new HanjulloInAppModule('hjl_test', '', ENDPOINT);

    await m.init({ anonymousId: 'anon_x', enableAutoTriggers: false });
    const closeBtn = document.querySelector('[data-hanjullo-msg] button[aria-label="닫기"]') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();

    vi.setSystemTime(1_000_000 + 2500);
    closeBtn.click();

    await vi.waitFor(() => {
      const dismissCall = trackCalls().find((c: any[]) => String(c[1]?.body || '').includes('"dismiss"'));
      expect(dismissCall).toBeDefined();
      const body = JSON.parse(dismissCall[1].body);
      expect(body.dwell_seconds).toBe(2);
    });
  });
});
