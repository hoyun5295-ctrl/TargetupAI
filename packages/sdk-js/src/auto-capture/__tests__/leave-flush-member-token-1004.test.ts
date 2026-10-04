/**
 * 2026-10-04 싱크·자사몰 전수점검 SDK1 · C1
 *
 * - 페이지를 떠날 때(pagehide) · 화면이 숨겨질 때(visibilitychange → hidden) 남은 이벤트를 5초 기다리지 않고 바로 보낸다.
 * - 식별 이벤트는 회원 토큰(data-hjl-member-token)을 함께 싣는다 — 서버는 토큰이 있어야 고객에 잇는다.
 * - 토큰이 아이디보다 늦게 붙어도 식별을 다시 보낸다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Transport } from '../transport';
import { detectIdentify, watchIdentifyChanges } from '../identify';

describe('페이지 이탈 flush (SDK1)', () => {
  let fetchSpy: any;
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
  });

  it('pagehide 에 타이머를 기다리지 않고 keepalive 로 보낸다', () => {
    const t = new Transport({ apiKey: 'hjl_test', endpoint: 'https://app.hanjul.ai/api/cdp', batchSize: 20, flushIntervalMs: 60_000 });
    t.queue({ type: 'click', tag: 'a' });
    expect(fetchSpy).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchSpy).toHaveBeenCalledTimes(1); // 동기로 시작된다(페이지가 사라지기 전에)
    expect(fetchSpy.mock.calls[0][1].keepalive).toBe(true);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).events).toHaveLength(1);
  });

  it('화면이 숨겨지면(visibilitychange → hidden) 보낸다 · 보이게 될 때는 보내지 않는다', () => {
    const t = new Transport({ apiKey: 'hjl_test', endpoint: 'https://app.hanjul.ai/api/cdp', batchSize: 20, flushIntervalMs: 60_000 });
    t.queue({ type: 'pageview', url: '/' });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchSpy).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('식별 + 회원 토큰 (C1)', () => {
  beforeEach(() => {
    for (const a of ['data-hjl-user-id', 'data-hjl-member-token', 'data-hjl-email']) document.body.removeAttribute(a);
  });

  it('body 의 회원 토큰을 읽는다', () => {
    document.body.setAttribute('data-hjl-user-id', 'm1');
    document.body.setAttribute('data-hjl-member-token', 'v1.p.s');
    expect(detectIdentify()).toMatchObject({ externalId: 'm1', memberToken: 'v1.p.s' });
  });

  it('토큰이 아이디보다 늦게 붙어도 다시 식별한다', async () => {
    document.body.setAttribute('data-hjl-user-id', 'm1');
    const seen: Array<string | undefined> = [];
    const stop = watchIdentifyChanges((r) => seen.push(r?.memberToken));
    document.body.setAttribute('data-hjl-member-token', 'v1.p.s');
    await vi.waitFor(() => expect(seen).toEqual(['v1.p.s']));
    stop();
  });
});

describe('매 전송에 이 페이지의 회원 증명을 싣는다 (Codex 1004 R1 high)', () => {
  let fetchSpy: any;
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
  });
  const sent = (i: number) => JSON.parse(fetchSpy.mock.calls[i][1].body);
  const mk = () => new Transport({ apiKey: 'hjl_test', endpoint: 'https://app.hanjul.ai/api/cdp', batchSize: 20, flushIntervalMs: 60_000 });

  it('토큰 있는 identify 뒤의 전송은 identify 가 없어도 member 를 싣는다', async () => {
    const t = mk();
    t.queue({ type: 'identify', external_id: 'm1', member_token: 'v1.p.s' });
    await t.flush();
    t.queue({ type: 'track', event: 'cart_add' });
    await t.flush();
    expect(sent(1).member).toEqual({ external_id: 'm1', member_token: 'v1.p.s' });
  });

  it('회원이 바뀌면(토큰 없는 다른 회원) 앞 회원 것을 먼저 따로 보내고, 뒤 배치에는 member 가 없다(R2 high)', async () => {
    const t = mk();
    t.queue({ type: 'identify', external_id: 'm1', member_token: 'v1.p.s' });
    t.queue({ type: 'track', event: 'cart_add' });
    t.queue({ type: 'identify', external_id: 'm2' });
    t.queue({ type: 'track', event: 'wishlist_add' });
    await t.flush();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sent(0).member).toEqual({ external_id: 'm1', member_token: 'v1.p.s' });
    expect(sent(0).events.map((e: any) => e.event ?? e.type)).toEqual(['identify', 'cart_add']);
    expect('member' in sent(1)).toBe(false);
    expect(sent(1).events.map((e: any) => e.event ?? e.type)).toEqual(['identify', 'wishlist_add']);
  });

  it('로그아웃(clearMember) = 그때까지 모은 것은 앞 회원 배치로 먼저 · 뒤 행동은 member 없는 배치(R2 high)', async () => {
    const t = mk();
    t.queue({ type: 'identify', external_id: 'm1', member_token: 'v1.p.s' });
    t.queue({ type: 'track', event: 'cart_add' });
    t.clearMember();
    t.queue({ type: 'track', event: 'cart_add' });
    await t.flush();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sent(0).member).toEqual({ external_id: 'm1', member_token: 'v1.p.s' });
    expect('member' in sent(1)).toBe(false);
    expect(sent(1).events.some((e: any) => e.type === 'identify')).toBe(false);
  });

  it('로그아웃 뒤 익명 행동은 다음 회원 배치에 섞이지 않는다(R3 high)', async () => {
    const t = mk();
    t.queue({ type: 'identify', external_id: 'm1', member_token: 'v1.a' });
    t.clearMember();
    t.queue({ type: 'track', event: 'cart_add', properties: { tag: 'X' } });
    t.queue({ type: 'identify', external_id: 'm2', member_token: 'v1.b' });
    t.queue({ type: 'track', event: 'cart_add', properties: { tag: 'Y' } });
    await t.flush();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const tags = (i: number) => sent(i).events.filter((e: any) => e.type === 'track').map((e: any) => e.properties.tag);
    expect(sent(1).member).toBeUndefined();
    expect(sent(1).events.some((e: any) => e.type === 'identify')).toBe(false);
    expect(tags(1)).toEqual(['X']);
    expect(sent(2).member).toEqual({ external_id: 'm2', member_token: 'v1.b' });
    expect(tags(2)).toEqual(['Y']);
  });

  it('페이지 첫 식별 앞의 이벤트는 그 식별과 한 배치로 간다(같은 사람 · 요청을 늘리지 않는다)', async () => {
    const t = mk();
    t.queue({ type: 'pageview', url: '/' });
    t.queue({ type: 'identify', external_id: 'm1', member_token: 'v1.a' });
    await t.flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sent(0).events).toHaveLength(2);
  });

  it('같은 회원의 토큰 갱신은 배치를 쪼개지 않는다', async () => {
    const t = mk();
    t.queue({ type: 'identify', external_id: 'm1', member_token: 'v1.a' });
    t.queue({ type: 'identify', external_id: 'm1', member_token: 'v1.b' });
    await t.flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sent(0).member).toEqual({ external_id: 'm1', member_token: 'v1.b' });
  });

  it('식별이 없던 페이지(비회원)는 싣지 않는다', async () => {
    const t = mk();
    t.queue({ type: 'pageview', url: '/' });
    await t.flush();
    expect('member' in sent(0)).toBe(false);
  });
});
