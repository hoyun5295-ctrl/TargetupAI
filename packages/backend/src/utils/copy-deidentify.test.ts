import { describe, it, expect } from 'vitest';
import { deBrand, hasIdentifierLeak } from './copy-deidentify';

describe('copy-deidentify', () => {
  it('대괄호 브랜드·전화·URL을 제거한다', () => {
    const out = deBrand('[스타벅스] 신메뉴 출시! 문의 1588-1234 www.starbucks.co.kr');
    expect(out).not.toContain('스타벅스');
    expect(out).not.toContain('1588');
    expect(out).not.toContain('starbucks');
    expect(out).toContain('신메뉴');
    expect(hasIdentifierLeak(out)).toBe(false);
  });
  it('구조·표현은 보존한다', () => {
    expect(deBrand('지금 신메뉴를 확인하세요')).toBe('지금 신메뉴를 확인하세요');
  });
  it('휴대폰/대표번호/이메일 잔존을 탐지한다', () => {
    expect(hasIdentifierLeak('전화 010-1234-5678')).toBe(true);
    expect(hasIdentifierLeak('대표 1600-0000')).toBe(true);
    expect(hasIdentifierLeak('메일 abc@shop.co.kr')).toBe(true);
    expect(hasIdentifierLeak('깨끗한 문안입니다')).toBe(false);
  });
  it('여러 번 호출해도 결과가 일관된다(정규식 lastIndex 버그 없음)', () => {
    const s = '전화 010-1234-5678';
    expect(hasIdentifierLeak(s)).toBe(true);
    expect(hasIdentifierLeak(s)).toBe(true);
    expect(hasIdentifierLeak(s)).toBe(true);
  });
  it('개인화 토큰(% {})·수신자 이름(PII)을 제거한다', () => {
    const out = deBrand('한경자 고객님 이번 주 세일 %포인트% 적립 {brand} 매장');
    expect(out).not.toContain('한경자');
    expect(out).not.toContain('%');
    expect(out).not.toContain('{');
    expect(out).toContain('고객님'); // 일반 호칭은 유지
  });
});
