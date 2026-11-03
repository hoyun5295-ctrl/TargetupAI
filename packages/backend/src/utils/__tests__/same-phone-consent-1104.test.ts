/**
 * 같은 번호 여러 원본 행 · 수신동의 거부 우선(설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md §2 P1 · §6 C4)
 * 기대값 = 설계서 §2 P1 문장(손으로 적은 표) · 코드가 계산하는 방식으로 다시 계산하지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { consentVote, foldVotes, decideForExisting, decideForNew, foldByPhone, keptRowConsent, foldMappedRowsByPhone } from '../same-phone-consent';

describe('C4 업로드 파일 전체 미리 묶기(헤더 매핑 · 업로드 행 만들기와 같은 규칙)', () => {
  const headers = ['휴대폰', '이름', '수신동의'];
  const mapping = { 휴대폰: 'phone', 이름: 'name', 수신동의: 'sms_opt_in' } as Record<string, string>;
  it('번호 꼴이 달라도 같은 번호 · 2,000행 경계 양쪽 = 한 묶음 · 수신 + 거부 = 거부', () => {
    const rows: any[][] = [['010-0000-5501', '가', 'Y']];
    for (let i = 0; i < 2498; i++) rows.push([`0100001${String(i).padStart(4, '0')}`, '나', 'Y']);
    rows.push(['01000005501', '다', 'N']);   // 2,500번째 행
    const m = foldMappedRowsByPhone(rows, headers, mapping);
    const f = m.get('01000005501')!;
    expect(f.rows).toBe(2);
    expect(keptRowConsent(f)).toEqual({ value: false, unknown: false });
  });
  it('빈칸 + 알아볼 수 없는 표기 = 신규 미동의 표시 · 빈 셀은 표 없음', () => {
    const m = foldMappedRowsByPhone([['01000005502', 'a', ''], ['01000005502', 'b', '??모름??']], headers, mapping);
    expect(keptRowConsent(m.get('01000005502')!)).toEqual({ value: null, unknown: true });
  });
  it('수신동의 칸을 매핑하지 않은 파일 = 전부 없음 · 한 행뿐 = null', () => {
    const m = foldMappedRowsByPhone([['01000005503', 'a', 'N']], headers, { 휴대폰: 'phone', 이름: 'name' });
    expect(keptRowConsent(m.get('01000005503')!)).toBeNull();
    expect(decideForExisting(m.get('01000005503')!)).toBeNull();
  });
});

describe('C4 층 1 — 같은 번호를 한 행으로 접을 때 남긴 행의 동의', () => {
  it('한 행뿐인 번호 = null(지금 동작 그대로 · 행 값 · 모름 표시를 손대지 않는다)', () => {
    expect(keptRowConsent(foldVotes(['yes']))).toBeNull();
    expect(keptRowConsent(foldVotes(['unknown']))).toBeNull();
    expect(keptRowConsent(undefined)).toBeNull();
  });
  it('여러 행 = 거부 우선 값 · 값이 정해지지 않고 모름이 있으면 모름 표시(신규 = 미동의)', () => {
    expect(keptRowConsent(foldVotes(['yes', 'no']))).toEqual({ value: false, unknown: false });
    expect(keptRowConsent(foldVotes(['no', 'yes']))).toEqual({ value: false, unknown: false });
    expect(keptRowConsent(foldVotes(['yes', 'none']))).toEqual({ value: true, unknown: false });
    expect(keptRowConsent(foldVotes(['none', 'unknown']))).toEqual({ value: null, unknown: true });
    expect(keptRowConsent(foldVotes(['none', 'none']))).toEqual({ value: null, unknown: false });
    expect(keptRowConsent(foldVotes(['yes', 'unknown']))).toEqual({ value: true, unknown: false });
  });
});

describe('C4 행 하나의 표', () => {
  it('수신 · 거부 · 모름 · 없음', () => {
    expect(consentVote(true, false)).toBe('yes');
    expect(consentVote(false, false)).toBe('no');
    expect(consentVote(null, true)).toBe('unknown');
    expect(consentVote(undefined, true)).toBe('unknown');
    expect(consentVote(null, false)).toBe('none');
    expect(consentVote(undefined, false)).toBe('none');
    // 거부 · 수신 값이 있으면 모름 표시는 보지 않는다(에이전트가 탈퇴를 거부로 접으며 모름 표시를 지운다)
    expect(consentVote(false, true)).toBe('no');
  });
});

describe('C4 P1 판정 표 — 흔한 꼴 먼저', () => {
  // [표들, 이미 있는 고객 판정, 신규 고객 판정] · null = 이미 있는 고객은 바꾸지 않음 / 신규는 기본값(동의)
  const table: Array<[string, Array<'yes' | 'no' | 'unknown' | 'none'>, boolean | null, boolean | null]> = [
    ['한 행 수신', ['yes'], true, true],
    ['한 행 거부', ['no'], false, false],
    ['한 행 빈칸', ['none'], null, null],
    ['한 행 모름', ['unknown'], null, false],
    ['수신 + 거부(엠티 같은 번호 두 코드)', ['yes', 'no'], false, false],
    ['거부 + 수신(순서 반대)', ['no', 'yes'], false, false],
    ['수신 + 수신', ['yes', 'yes'], true, true],
    ['수신 + 빈칸', ['yes', 'none'], true, true],
    ['수신 + 모름', ['yes', 'unknown'], true, true],
    ['거부 + 모름', ['no', 'unknown'], false, false],
    ['빈칸 + 모름', ['none', 'unknown'], null, false],
    ['빈칸 + 빈칸', ['none', 'none'], null, null],
    ['수신 + 수신 + 거부(셋)', ['yes', 'yes', 'no'], false, false],
  ];
  for (const [name, votes, existing, fresh] of table) {
    it(name, () => {
      const f = foldVotes(votes);
      expect(decideForExisting(f)).toBe(existing);
      expect(decideForNew(f)).toBe(fresh);
    });
  }
  it('표가 없으면(빈 목록) = 이미 있는 고객 그대로 · 신규 기본값', () => {
    const f = foldVotes([]);
    expect(decideForExisting(f)).toBeNull();
    expect(decideForNew(f)).toBeNull();
  });
});

describe('C4 한 입력 안 번호별 묶기', () => {
  it('같은 번호의 표를 순서와 무관하게 묶는다', () => {
    const rows = [
      { phone: '01000005501', v: true, u: false },
      { phone: '01000005502', v: null, u: false },
      { phone: '01000005501', v: false, u: false },
      { phone: '01000005502', v: null, u: true },
    ];
    const m = foldByPhone(rows, (r) => r.phone, (r) => consentVote(r.v, r.u));
    expect(decideForExisting(m.get('01000005501')!)).toBe(false);
    expect(decideForNew(m.get('01000005502')!)).toBe(false);
    expect(decideForExisting(m.get('01000005502')!)).toBeNull();
    const reversed = foldByPhone([...rows].reverse(), (r) => r.phone, (r) => consentVote(r.v, r.u));
    expect(decideForExisting(reversed.get('01000005501')!)).toBe(false);
    expect(decideForNew(reversed.get('01000005502')!)).toBe(false);
  });
  it('번호마다 행 수를 센다(한 행뿐인 번호 = 지금 동작 그대로 두는 기준)', () => {
    const m = foldByPhone(
      [{ phone: 'A', v: true }, { phone: 'B', v: false }, { phone: 'A', v: null }, { phone: 'A', v: false }],
      (r) => r.phone, (r) => consentVote(r.v, false),
    );
    expect(m.get('A')!.rows).toBe(3);
    expect(m.get('B')!.rows).toBe(1);
  });
  it('번호가 비면 지도에 넣지 않는다', () => {
    const m = foldByPhone([{ phone: '', v: true }], (r) => r.phone, (r) => consentVote(r.v, false));
    expect(m.size).toBe(0);
  });
});
