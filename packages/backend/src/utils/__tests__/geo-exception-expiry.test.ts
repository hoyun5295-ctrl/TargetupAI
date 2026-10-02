/**
 * 예외 허용 만료일 검증 계약 (★2026-10-02 전송자격인증 2.2 ③)
 *
 * 왜 있나
 *   예외 승인 대장에 허용 기간이 기록되어야 하는데, 서버는 받은 만료일을 검사 없이 DB에 넘기고 있었다.
 *   형식이 틀리면 500이 나고, 지난 날짜가 들어가면 **등록되는 순간 이미 만료된 예외**가 대장에 생긴다.
 *
 * 못 박는 것
 *   1. 비우면 기한 없음(null) — 기존 예외와 같은 뜻이다.
 *   2. 날짜는 그날 끝(한국 시각 23:59:59)까지 유효로 저장한다. 오늘 날짜도 받는다.
 *   3. 지난 날짜 · 날짜가 아닌 값 · 달력에 없는 날짜는 거절한다.
 */
import { describe, it, expect } from 'vitest';
import { parseExceptionExpiry } from '../geo-access';

/** 2026-10-02 15:00 한국 시각 */
const NOW = new Date('2026-10-02T15:00:00+09:00');

describe('통과', () => {
  it.each([undefined, null, '', '   '])('비운 값(%s)은 기한 없음이다', (v) => {
    expect(parseExceptionExpiry(v, NOW)).toEqual({ ok: true, value: null });
  });

  it('날짜는 그날 끝(한국 시각)으로 저장한다', () => {
    expect(parseExceptionExpiry('2026-12-31', NOW)).toEqual({ ok: true, value: '2026-12-31T23:59:59+09:00' });
  });

  it('오늘 날짜도 받는다(오늘 끝까지 유효)', () => {
    expect(parseExceptionExpiry('2026-10-02', NOW)).toEqual({ ok: true, value: '2026-10-02T23:59:59+09:00' });
  });
});

describe('거절', () => {
  it('지난 날짜', () => {
    const r = parseExceptionExpiry('2026-10-01', NOW);
    expect(r.ok).toBe(false);
  });

  it.each([
    '2026/12/31', '20261231', '2026-12-31T00:00:00Z', 'tomorrow', '2026-1-5', "2026-12-31'; DROP TABLE x;--",
  ])('날짜 형식이 아닌 값(%s)', (v) => {
    const r = parseExceptionExpiry(v, NOW);
    expect(r.ok).toBe(false);
  });

  it.each(['2026-02-31', '2026-13-01', '2026-11-31', '2027-00-10'])('달력에 없는 날짜(%s)', (v) => {
    const r = parseExceptionExpiry(v, NOW);
    expect(r.ok).toBe(false);
  });

  it('거절 문구에 줄표가 없다', () => {
    for (const v of ['2026-10-01', 'x']) {
      const r = parseExceptionExpiry(v, NOW);
      expect(r.ok === false && r.reason.includes('—')).toBe(false);
    }
  });
});
