/**
 * 구매 custom_fields 정리 = 고객과 같은 규칙 (2026-10-15)
 *
 * 서버가 구매 custom_fields 를 적재하게 되면서(전에는 받지 않고 버렸다), 에이전트가 보내는 값도 고객 custom 과
 * 같은 글자여야 한다. 정리 없이 보내면 드라이버가 준 Date 가 UTC ISO 글자(KST 자정 = 전날 15:00Z)로 직렬화된다.
 */
import { describe, it, expect } from 'vitest';
import { normalizePurchase, normalizeCustomer } from './index';

const base = { customer_phone: '01000000001', purchase_date: '2026-10-15 10:00:00', total_amount: 1000 };

describe('normalizePurchase — custom_fields', () => {
  it('Oracle 날짜 칸(로컬 Date)은 원본 벽시계 날짜 글자로', () => {
    const r = normalizePurchase({ ...base, custom_fields: { custom_1: new Date(2026, 9, 15, 0, 0, 0) } }, { dbType: 'oracle' });
    expect(r.custom_fields).toEqual({ custom_1: '2026-10-15' });
  });

  it('MSSQL 날짜 칸(UTC 성분 = 원본 벽시계)은 하루 밀리지 않는다', () => {
    const r = normalizePurchase({ ...base, custom_fields: { custom_1: new Date(Date.UTC(2026, 9, 15, 0, 0, 0)) } }, { dbType: 'mssql' });
    expect(r.custom_fields).toEqual({ custom_1: '2026-10-15' });
  });

  it('문자·숫자는 한 글자도 바꾸지 않고, Buffer 는 키를 뺀다', () => {
    const r = normalizePurchase(
      { ...base, custom_fields: { custom_1: ' S-0001 ', custom_2: 7, custom_3: Buffer.from('x') } },
      { dbType: 'mysql' },
    );
    expect(r.custom_fields).toEqual({ custom_1: ' S-0001 ', custom_2: 7 });
  });

  it('넘긴 행은 바꾸지 않는다(새 객체)', () => {
    const cf = { custom_1: new Date(2026, 9, 15) };
    normalizePurchase({ ...base, custom_fields: cf }, { dbType: 'oracle' });
    expect(cf.custom_1).toBeInstanceOf(Date);
  });

  it('custom_fields 가 없으면 키를 만들지 않는다', () => {
    expect('custom_fields' in normalizePurchase({ ...base }, { dbType: 'oracle' })).toBe(false);
  });
});

describe('normalizeCustomer — custom_fields 규칙은 그대로(공용 함수로 옮긴 뒤)', () => {
  it('Oracle 날짜 칸 · Buffer 제외 · 문자 원형', () => {
    const r = normalizeCustomer(
      { phone: '01000000001', custom_fields: { custom_1: new Date(2026, 9, 15), custom_2: Buffer.from('x'), custom_3: 'Y' } },
      { dbType: 'oracle' },
    );
    expect(r.custom_fields).toEqual({ custom_1: '2026-10-15', custom_3: 'Y' });
  });
});
