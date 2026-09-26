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
import { isWithinBrandSendWindow, calcSplitSendTime } from './send-time-util';

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

/**
 * ★ 2026-09-26 한줄로 전수점검 부분 ① F43·F44 — 분할발송 회차가 자정을 넘겨 01~07시에 떨어지면 광고 문자가 새벽에 나갔다.
 *   발송 가능 시간(08~21시 KST) 안에서만 시간을 흘려 창 끝이면 다음 날 08시부터 잇는다.
 */
describe('calcSplitSendTime — 발송 가능 시간 안에서만 흐른다', () => {
  const at = (s: string) => new Date(s + '+09:00');
  const kstStr = (d: Date) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');

  it('창 안·21시 전 기준의 이월은 옛 결과와 같다(수정 전 캡처값)', () => {
    expect(kstStr(calcSplitSendTime(at('2026-09-25T10:00:00'), 30))).toBe('2026-09-25 10:30:00');
    expect(kstStr(calcSplitSendTime(at('2026-09-25T20:00:00'), 60))).toBe('2026-09-26 08:00:00');
    expect(kstStr(calcSplitSendTime(at('2026-09-25T20:00:00'), 90))).toBe('2026-09-26 08:30:00');
    expect(kstStr(calcSplitSendTime(at('2026-09-25T20:00:00'), 239))).toBe('2026-09-26 10:59:00');
    expect(kstStr(calcSplitSendTime(at('2026-09-25T20:59:30'), 1))).toBe('2026-09-26 08:00:30');
  });

  it('자정을 넘겨 새벽에 떨어지던 회차가 이어서 이월된다(옛 식은 +300 → 01:00)', () => {
    expect(kstStr(calcSplitSendTime(at('2026-09-25T20:00:00'), 300))).toBe('2026-09-26 12:00:00');
    // 어떤 회차도 21시~08시에 떨어지지 않는다
    for (let i = 0; i < 3000; i += 7) {
      const h = Number(kstStr(calcSplitSendTime(at('2026-09-25T17:00:00'), i)).slice(11, 13));
      expect(h >= 8 && h < 21).toBe(true);
    }
  });

  it('여러 날에 걸쳐도 단조 증가(겹침 없음)', () => {
    let prev = 0;
    for (let i = 0; i < 2000; i++) {
      const t = calcSplitSendTime(at('2026-09-25T20:30:00'), i).getTime();
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
    // 20:30 기준: 오늘 30분 + 다음 날 780분 → 810번째 회차는 이틀 뒤 08:00
    expect(kstStr(calcSplitSendTime(at('2026-09-25T20:30:00'), 810))).toBe('2026-09-27 08:00:00');
  });

  it('기준 시각이 창 밖이면 첫 회차가 다음 창 시작(08:00)으로 간다', () => {
    expect(kstStr(calcSplitSendTime(at('2026-09-25T22:00:00'), 0))).toBe('2026-09-26 08:00:00');
    expect(kstStr(calcSplitSendTime(at('2026-09-25T06:00:00'), 0))).toBe('2026-09-25 08:00:00');
    expect(kstStr(calcSplitSendTime(at('2026-09-25T21:00:00'), 0))).toBe('2026-09-26 08:00:00');
  });
});
