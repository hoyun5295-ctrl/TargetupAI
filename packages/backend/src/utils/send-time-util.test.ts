/**
 * ★ 2026-08-18 브랜드 발송 가능 시간(KST 08:00~20:50) 판정 계약.
 *
 * 창 밖으로 나간 건은 카카오가 3022(광고 발송 가능 시간 아님)로 폐기하는데 그때는 이미 차감이
 * 끝나 있다 — 그래서 적재 전에 막는다. 경계 판정이 한 칸만 어긋나도 돈이 샌다.
 *
 * ⛔ 마감 여유(margin)는 **종료만 앞당긴다.** 시각 자체에 더하면 07:58이 08:00으로 앞당겨져
 *    오전 금지 창이 그만큼 열린다(0818 Codex 5R 실측 — 내가 만든 결함).
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import { isWithinBrandSendWindow } from './send-time-util';

/** KST 벽시계 h:m → UTC Date */
const kst = (h: number, m: number) => new Date(Date.UTC(2027, 7, 18, h - 9, m, 0));

describe('isWithinBrandSendWindow — KST 08:00~20:50, 종료 exclusive', () => {
  it('경계 — 08:00 통과 · 20:49 통과 · 20:50 차단 · 07:59 차단', () => {
    expect(isWithinBrandSendWindow(kst(8, 0))).toBe(true);
    expect(isWithinBrandSendWindow(kst(20, 49))).toBe(true);
    expect(isWithinBrandSendWindow(kst(20, 50))).toBe(false);
    expect(isWithinBrandSendWindow(kst(7, 59))).toBe(false);
    expect(isWithinBrandSendWindow(kst(3, 0))).toBe(false);
  });

  it('여유는 마감만 앞당긴다 — 오전 경계를 열어서는 안 된다', () => {
    expect(isWithinBrandSendWindow(kst(7, 58), 2)).toBe(false);   // 여유를 더해 08:00으로 만들면 안 된다
    expect(isWithinBrandSendWindow(kst(8, 0), 2)).toBe(true);
    expect(isWithinBrandSendWindow(kst(20, 47), 2)).toBe(true);
    expect(isWithinBrandSendWindow(kst(20, 48), 2)).toBe(false);  // 마감 20:50 − 여유 2분
  });

  it('여유 값이 이상해도 창을 넓히지 않는다', () => {
    expect(isWithinBrandSendWindow(kst(20, 49), -5)).toBe(true);   // 음수는 0으로 본다
    expect(isWithinBrandSendWindow(kst(20, 50), -5)).toBe(false);
    expect(isWithinBrandSendWindow(kst(12, 0), NaN)).toBe(true);
  });

  it('서버 표준시와 무관하게 KST로 판정한다', () => {
    // 2027-08-18T23:00:00Z = KST 익일 08:00 → 창 안
    expect(isWithinBrandSendWindow(new Date('2027-08-18T23:00:00Z'))).toBe(true);
    // 2027-08-18T12:00:00Z = KST 21:00 → 창 밖
    expect(isWithinBrandSendWindow(new Date('2027-08-18T12:00:00Z'))).toBe(false);
  });

  it('읽을 수 없는 시각은 창 밖으로 본다', () => {
    expect(isWithinBrandSendWindow(new Date('nope'))).toBe(false);
  });
});

// ★ 2026-08-18 7R — 마진 값 정규화는 **설정에서 한 번만** 한다.
//   소비처가 각자 정리하면 0.5 같은 값이 한쪽에선 30초, 다른 쪽에선 0분이 되어 마감 보호가 사라진다.
describe('마진 설정 정규화 — 소수·음수·Infinity가 창을 넓히지 않는다', () => {
  const load = async (raw?: string) => {
    vi.resetModules();
    if (raw === undefined) delete process.env.BRAND_SEND_MARGIN_MIN;
    else process.env.BRAND_SEND_MARGIN_MIN = raw;
    const mod = await import('../config/defaults');
    return mod.BRAND_SEND_WINDOW.immediateMarginMinutes;
  };
  const original = process.env.BRAND_SEND_MARGIN_MIN;
  afterAll(() => {
    if (original === undefined) delete process.env.BRAND_SEND_MARGIN_MIN;
    else process.env.BRAND_SEND_MARGIN_MIN = original;
  });

  it('미설정·빈값·잘못된 값은 기본 2분', async () => {
    expect(await load(undefined)).toBe(2);
    expect(await load('')).toBe(2);
    expect(await load('abc')).toBe(2);
    expect(await load('-3')).toBe(2);
    expect(await load('Infinity')).toBe(2);
  });

  // ⛔ 양수를 내림하면 0.5가 0이 되어 **보호가 조용히 꺼진다**(0818 8R). 해제는 정확히 0만.
  it('양수 소수는 올림하고, 해제는 정확히 0일 때만', async () => {
    expect(await load('0.5')).toBe(1);
    expect(await load('3.1')).toBe(4);
    expect(await load('0')).toBe(0);
    expect(await load('5')).toBe(5);
  });

  // ⛔ 숫자로 바꾼 뒤 0을 해제로 보면 양수 표기가 보호를 끈다(0818 9R) — 해제는 문자열 '0'만.
  it('-0·underflow·0.0 표기는 해제가 아니다 — 기본값으로 강등한다', async () => {
    expect(await load('-0')).toBe(2);
    expect(await load('1e-999')).toBe(2);
    expect(await load('0.0')).toBe(2);
    expect(await load(' 0 ')).toBe(0);      // 공백만 다른 명시 해제는 해제로 본다
  });

  // ⛔ 창 길이(770분) 이상이면 즉시 발송이 전부 거절되는데 화면에는 시각 안내만 나가 원인을 못 찾는다.
  it('창을 통째로 닫는 값은 기본값으로 강등하고 로그로 드러낸다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await load('770')).toBe(2);
    expect(await load('800')).toBe(2);
    expect(err.mock.calls.flat().join(' ')).toContain('BRAND_SEND_MARGIN_MIN');
    err.mockRestore();
    expect(await load('769')).toBe(769);   // 경계 바로 아래는 그대로 받는다
  });

  it('정규화된 마진이 창 판정에 그대로 먹는다 — 0.5 설정에서도 마감 직전은 막힌다', () => {
    // 0.5 → 1분. 20:49는 end(20:50) − 1 = 20:49 미만이 아니라 거절된다.
    expect(isWithinBrandSendWindow(kst(20, 49), 1)).toBe(false);
    expect(isWithinBrandSendWindow(kst(20, 48), 1)).toBe(true);
  });
});
