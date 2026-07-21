/**
 * brand-basic-info — 화이트리스트 필터(임의 컬럼 UPDATE 차단) 순수 검증.
 */
import { describe, it, expect } from 'vitest';
import { pickBasicInfoFields, BRAND_BASIC_FIELDS } from './brand-basic-info';
import { INDUSTRY_CODES } from './industry-codes';

describe('pickBasicInfoFields — 화이트리스트', () => {
  it('화이트리스트 컬럼만 통과 (업태=business_type·종목=business_category)', () => {
    const out = pickBasicInfoFields({
      brand_name: 'ACME',
      business_number: '123-45-67890',
      business_type: '도소매',
      business_category: '화장품',
    });
    expect(out).toEqual({ brand_name: 'ACME', business_number: '123-45-67890', business_type: '도소매', business_category: '화장품' });
  });
  it('화이트리스트 밖 키(balance·id·brand_kit·business_item)는 무시 — 임의 컬럼 UPDATE 차단', () => {
    const out = pickBasicInfoFields({ brand_name: 'A', balance: 999999, id: 'x', brand_kit: {}, business_item: 'x' });
    expect(out).toEqual({ brand_name: 'A' });
    expect('balance' in out).toBe(false);
    expect('business_item' in out).toBe(false);
  });
  it('빈 문자열은 보존, null/undefined는 null로', () => {
    const out = pickBasicInfoFields({ brand_name: '', company_name: null });
    expect(out.brand_name).toBe('');
    expect(out.company_name).toBeNull();
  });
  it('industry_code — 유효 코드만 통과, 임의 문자열 차단(빈 값=선택 해제 허용)', () => {
    const valid = pickBasicInfoFields({ industry_code: INDUSTRY_CODES[0] });
    expect(valid.industry_code).toBe(INDUSTRY_CODES[0]);
    const bad = pickBasicInfoFields({ industry_code: '__invalid_code__' });
    expect('industry_code' in bad).toBe(false);
    const cleared = pickBasicInfoFields({ industry_code: '' });
    expect(cleared.industry_code).toBe('');
  });
  it('비객체 입력 안전', () => {
    expect(pickBasicInfoFields(null)).toEqual({});
    expect(pickBasicInfoFields('x')).toEqual({});
  });
  it('화이트리스트 6종 고정(회귀 감지)', () => {
    expect([...BRAND_BASIC_FIELDS]).toEqual([
      'brand_name', 'company_name', 'business_number', 'business_type', 'business_category', 'industry_code',
    ]);
  });
});
