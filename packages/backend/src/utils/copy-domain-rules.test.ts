import { describe, it, expect } from 'vitest';
import { checkDomainRules } from './copy-domain-rules';

describe('copy-domain-rules', () => {
  it('SMS 90바이트 초과면 위반', () => {
    const long = '가'.repeat(50); // 100바이트
    const r = checkDomainRules(long, 'SMS');
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.includes('바이트'))).toBe(true);
  });
  it('SMS 90바이트 이내 + CTA면 통과', () => {
    const r = checkDomainRules('지금 매장에서 신메뉴 확인하세요', 'SMS');
    expect(r.pass).toBe(true);
  });
  it('CTA 없으면 위반(구조 루브릭)', () => {
    const r = checkDomainRules('오늘 날씨가 좋네요', 'SMS');
    expect(r.violations.some((v) => v.includes('행동 유도'))).toBe(true);
  });
  it('LMS는 2000바이트까지 허용', () => {
    const r = checkDomainRules('지금 확인 ' + '가'.repeat(100), 'LMS');
    expect(r.violations.some((v) => v.includes('바이트'))).toBe(false);
  });
});
