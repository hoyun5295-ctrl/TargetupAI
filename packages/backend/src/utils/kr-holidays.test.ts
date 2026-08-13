/**
 * kr-holidays.test.ts — 한국 공휴일 표·대체공휴일 계약 (★ 2026-08-13(2))
 *
 * 달력이 틀리면 담당자가 그 날짜로 행사를 잡는다. 그래서 **관보 확정값과 규칙을 계약으로 고정한다.**
 * 여기 적힌 날짜는 전부 공개 확정분이고, 표를 갱신할 때 이 테스트가 회귀를 잡는다.
 */
import { describe, it, expect } from 'vitest';
import { getKrHolidays, getMonthHolidays, isYearReady, readyYears } from './kr-holidays';

const dates = (year: number, name: string) => getKrHolidays(year).filter((h) => h.name === name).map((h) => h.date);
const nameOn = (year: number, date: string) => getKrHolidays(year).filter((h) => h.date === date).map((h) => h.name);

describe('표 준비 판정 — 없는 해를 추측해서 그리지 않는다', () => {
  it('등재된 해만 ready다', () => {
    expect(readyYears()).toEqual([2026, 2027]);
    expect(isYearReady(2026)).toBe(true);
    expect(isYearReady(2029)).toBe(false);
  });

  it('표 없는 해는 빈 목록이 아니라 ready=false로 알린다(빈 달력으로 속이지 않는다)', () => {
    const out = getMonthHolidays('2029-01');
    expect(out.ready).toBe(false);
    expect(out.holidays).toHaveLength(0);
  });

  it('그 달 것만 돌려준다', () => {
    const out = getMonthHolidays('2026-02');
    expect(out.ready).toBe(true);
    expect(out.holidays.every((h) => h.date.startsWith('2026-02'))).toBe(true);
  });
});

describe('2026년 — 관보 확정분', () => {
  it('설 연휴는 2/16~2/18이고 평일이라 대체공휴일이 없다', () => {
    expect(dates(2026, '설날')).toEqual(['2026-02-17']);
    expect(dates(2026, '설날 연휴')).toEqual(['2026-02-16', '2026-02-18']);
    expect(getKrHolidays(2026).filter((h) => h.substitute && h.date.startsWith('2026-02'))).toHaveLength(0);
  });

  it('부처님오신날(5/24 일) → 대체 5/25', () => {
    expect(dates(2026, '부처님오신날')).toEqual(['2026-05-24']);
    expect(nameOn(2026, '2026-05-25')).toContain('대체공휴일');
  });

  it('삼일절(3/1 일) → 대체 3/2 · 광복절(8/15 토) → 대체 8/17 · 개천절(10/3 토) → 대체 10/5', () => {
    expect(nameOn(2026, '2026-03-02')).toContain('대체공휴일');
    expect(nameOn(2026, '2026-08-17')).toContain('대체공휴일');
    expect(nameOn(2026, '2026-10-05')).toContain('대체공휴일');
  });

  it('추석 연휴는 9/24~9/26이고, 토요일이 껴도 설·추석은 대체하지 않는다', () => {
    expect(dates(2026, '추석')).toEqual(['2026-09-25']);
    expect(dates(2026, '추석 연휴')).toEqual(['2026-09-24', '2026-09-26']);
    expect(getKrHolidays(2026).filter((h) => h.substitute && h.date.startsWith('2026-09'))).toHaveLength(0);
  });

  it('제헌절은 2026년부터 공휴일이다(7/17 금 — 대체 없음)', () => {
    expect(dates(2026, '제헌절')).toEqual(['2026-07-17']);
    expect(getKrHolidays(2026).filter((h) => h.substitute && h.date.startsWith('2026-07'))).toHaveLength(0);
  });

  it('현충일(6/6 토)은 대체 대상이 아니다', () => {
    expect(dates(2026, '현충일')).toEqual(['2026-06-06']);
    expect(getKrHolidays(2026).filter((h) => h.substitute && h.date.startsWith('2026-06'))).toHaveLength(0);
  });

  it('신정은 대체 대상이 아니다', () => {
    expect(dates(2026, '신정')).toEqual(['2026-01-01']);
  });
});

describe('2027년 — 관보 확정분', () => {
  it('설날(2/7 일)이 일요일이라 대체 하나가 2/9에 붙는다(연휴 2/6~2/9)', () => {
    expect(dates(2027, '설날')).toEqual(['2027-02-07']);
    expect(dates(2027, '설날 연휴')).toEqual(['2027-02-06', '2027-02-08']);
    const subs = getKrHolidays(2027).filter((h) => h.substitute && h.date.startsWith('2027-02'));
    expect(subs.map((s) => s.date)).toEqual(['2027-02-09']);
  });

  it('토요일 설 연휴(2/6)에는 대체가 붙지 않는다 — 설·추석은 일요일만', () => {
    // 대체가 둘 이상이면 "이미 목록에 있으니 겹쳤다"로 판정하는 옛 결함이 되살아난 것이다.
    expect(getKrHolidays(2027).filter((h) => h.substitute && h.date.startsWith('2027-02'))).toHaveLength(1);
  });

  it('제헌절(7/17 토) → 대체 7/19 · 광복절(8/15 일) → 대체 8/16 · 성탄절(12/25 토) → 대체 12/27', () => {
    expect(nameOn(2027, '2027-07-19')).toContain('대체공휴일');
    expect(nameOn(2027, '2027-08-16')).toContain('대체공휴일');
    expect(nameOn(2027, '2027-12-27')).toContain('대체공휴일');
  });

  it('한글날(10/9 토) → 대체 10/11 · 개천절(10/3 일) → 대체 10/4', () => {
    expect(nameOn(2027, '2027-10-04')).toContain('대체공휴일');
    expect(nameOn(2027, '2027-10-11')).toContain('대체공휴일');
  });

  it('추석 연휴(9/14~9/16)는 평일이라 대체가 없다', () => {
    expect(dates(2027, '추석')).toEqual(['2027-09-15']);
    expect(getKrHolidays(2027).filter((h) => h.substitute && h.date.startsWith('2027-09'))).toHaveLength(0);
  });
});

describe('정렬·중복', () => {
  it('날짜 오름차순이고 대체공휴일이 기존 공휴일 위에 겹치지 않는다', () => {
    for (const y of readyYears()) {
      const list = getKrHolidays(y);
      const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
      expect(list.map((h) => h.date)).toEqual(sorted.map((h) => h.date));
      const subDates = list.filter((h) => h.substitute).map((h) => h.date);
      const baseDates = new Set(list.filter((h) => !h.substitute).map((h) => h.date));
      for (const d of subDates) expect(baseDates.has(d)).toBe(false);
    }
  });
});
