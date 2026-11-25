/**
 * 칸 폭 판정 한 곳(★ 2026-11-25 C163 · 뿌리 R108 · 설계서 docs/2026-11-25-phone-width-root-design.md §4-1)
 *   기대값 = PG varchar(n) 대입 규칙(로컬 PG 15.15 실측: 'abc d   ' → varchar(5) 받음 · 'abcd x' 거절 · 끝 탭 거절 · 이모지 1자)과 운영 칸 폭(번호 20).
 *   PG 와 같은지 실제로 넣어 대조하는 시험 = phone-width-1125.pg.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  PHONE_COLUMN_WIDTH, ADDRESS_BOOK_WIDTH, fitsVarchar, fitsPhoneColumn, isAcceptablePhoneDigits, varcharFitsSql, pickPhonesWithinWidth,
} from '../column-width';

const digits = (n: number) => '0'.repeat(n);

describe('fitsVarchar = PG varchar(n) 대입 규칙', () => {
  it('폭까지 받고 한 글자 넘으면 뺀다', () => {
    expect(fitsVarchar(digits(20), 20)).toBe(true);
    expect(fitsVarchar(digits(21), 20)).toBe(false);
  });
  it('넘는 부분이 공백뿐이면 PG 가 잘라 받는다 = 받는 값', () => {
    expect(fitsVarchar(`${digits(20)}     `, 20)).toBe(true);
    expect(fitsVarchar(`${digits(18)} 1   `, 20)).toBe(true);    // 가운데 공백 포함 20자 + 끝 공백
    expect(fitsVarchar(`${digits(19)} 1   `, 20)).toBe(false);   // 21번째가 '1'
    expect(fitsVarchar(`${digits(20)}  1`, 20)).toBe(false);
    expect(fitsVarchar(`${digits(20)}\t`, 20)).toBe(false);      // 탭은 공백이 아니다
  });
  it('글자 수 = 코드 포인트(이모지 하나 = 한 글자)', () => {
    expect(fitsVarchar('😀'.repeat(20), 20)).toBe(true);           // UTF-16 길이 40
    expect(fitsVarchar('😀'.repeat(21), 20)).toBe(false);
    expect(fitsVarchar('가'.repeat(50), ADDRESS_BOOK_WIDTH.name)).toBe(true);
    expect(fitsVarchar('가'.repeat(51), ADDRESS_BOOK_WIDTH.name)).toBe(false);
  });
  it('null · undefined = 칸에 NULL 이 들어간다 = 받는다', () => {
    expect(fitsVarchar(null, 20)).toBe(true);
    expect(fitsVarchar(undefined, 20)).toBe(true);
  });
});

describe('번호 판정 = 하한(그 자리의 옛 하한 그대로) + 번호 칸 폭', () => {
  it('운영 칸 폭 = 20 · 주소록 폭 = 그룹 100 · 이름 50 · 기타 100', () => {
    expect(PHONE_COLUMN_WIDTH).toBe(20);
    expect(ADDRESS_BOOK_WIDTH).toEqual({ groupName: 100, name: 50, extra: 100 });
  });
  it('fitsPhoneColumn = 하한 없이 폭만(하한이 없던 입구용 · 빈 값도 지금처럼 받는다)', () => {
    expect(fitsPhoneColumn('')).toBe(true);
    expect(fitsPhoneColumn('123')).toBe(true);
    expect(fitsPhoneColumn(digits(20))).toBe(true);
    expect(fitsPhoneColumn(digits(21))).toBe(false);
    expect(fitsPhoneColumn(null)).toBe(true);
  });
  it('받는 사람 = 10 ~ 20자', () => {
    expect(isAcceptablePhoneDigits(digits(9))).toBe(false);
    expect(isAcceptablePhoneDigits(digits(10))).toBe(true);
    expect(isAcceptablePhoneDigits('01000001111')).toBe(true);
    expect(isAcceptablePhoneDigits(digits(20))).toBe(true);
    expect(isAcceptablePhoneDigits(digits(21))).toBe(false);
    expect(isAcceptablePhoneDigits('')).toBe(false);
    expect(isAcceptablePhoneDigits(null)).toBe(false);
  });
});

describe('varcharFitsSql = PG 가 보는 글자로 판정하는 식', () => {
  it('NULL 은 들어간다 · 끝 공백만 자른 글자 수로 본다', () => {
    expect(varcharFitsSql('u.phone', 20)).toBe(`(u.phone IS NULL OR char_length(rtrim(u.phone, ' ')) <= 20)`);
    expect(varcharFitsSql('$3::text', 100)).toBe(`($3::text IS NULL OR char_length(rtrim($3::text, ' ')) <= 100)`);
  });
  it('식 · 폭은 코드가 쓴 값만(사용자 값 · 괄호 · 따옴표 거절)', () => {
    expect(() => varcharFitsSql("u.phone'); DROP", 20)).toThrow();
    expect(() => varcharFitsSql('u.phone', 0)).toThrow();
    expect(() => varcharFitsSql('u.phone', 2.5)).toThrow();
  });
});

describe('pickPhonesWithinWidth = 순서 · 상한 그대로 · 폭 넘는 번호는 자리를 차지하고 빠진다(Codex 설계 2R #2)', () => {
  const ok = (n: number) => '010' + String(n).padStart(8, '0');
  const long = '0'.repeat(21);
  it('10자 미만 = 지금처럼 건너뜀(자리 차지 0) · 중복 지움', () => {
    expect(pickPhonesWithinWidth(['123', ok(1), ok(1), ok(2)], { max: 10, dedupe: true })).toEqual({ phones: [ok(1), ok(2)], tooLong: 0 });
  });
  it('반례 1 — 첫 10개 안에 폭 넘는 번호가 있어도 11번째는 올라오지 않는다', () => {
    const list = [ok(1), long, ...Array.from({ length: 8 }, (_, i) => ok(i + 2)), ok(99)];
    const r = pickPhonesWithinWidth(list, { max: 10, dedupe: true });
    expect(r.tooLong).toBe(1);
    expect(r.phones).toHaveLength(9);
    expect(r.phones).not.toContain(ok(99));
  });
  it('반례 2 — 적은 번호가 모두 폭을 넘으면 phones 0 · tooLong 1 이상(부르는 쪽이 반려 · 테스트 명단으로 넘어가지 않는다)', () => {
    expect(pickPhonesWithinWidth([long, long + '1'], { max: 10, dedupe: true })).toEqual({ phones: [], tooLong: 2 });
  });
  it('dedupe: false = 중복도 그대로 센다(원스텝 덮어쓰기의 옛 동작)', () => {
    expect(pickPhonesWithinWidth([ok(1), ok(1)], { max: 10, dedupe: false })).toEqual({ phones: [ok(1), ok(1)], tooLong: 0 });
  });
  it('max 없음(Infinity) = 승인 대조 읽기', () => {
    expect(pickPhonesWithinWidth([ok(1), long, ok(2)], { max: Infinity, dedupe: true })).toEqual({ phones: [ok(1), ok(2)], tooLong: 1 });
  });
});
