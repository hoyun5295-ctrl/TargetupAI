import { describe, test, expect } from 'vitest';
import { applyVarFallback, buildDefaultFallbacks } from './var-fallback';

describe('applyVarFallback', () => {
  test('값이 비면 대체값을 반환', () => {
    expect(applyVarFallback('', '#{고객명}', { '#{고객명}': '고객님' })).toBe('고객님');
  });
  test('값이 있으면 원래 값 유지', () => {
    expect(applyVarFallback('홍길동', '#{고객명}', { '#{고객명}': '고객님' })).toBe('홍길동');
  });
  test('대체값 미지정이면 빈 문자 유지', () => {
    expect(applyVarFallback('', '#{고객명}', undefined)).toBe('');
  });
});

describe('buildDefaultFallbacks', () => {
  test('표준 필드(@@name@@) 매핑에 기본 대체값을 자동 부여', () => {
    expect(buildDefaultFallbacks({ '#{고객명}': '@@name@@', '#{주문번호}': '@@order_no@@' }))
      .toEqual({ '#{고객명}': '고객님' });
  });
});
