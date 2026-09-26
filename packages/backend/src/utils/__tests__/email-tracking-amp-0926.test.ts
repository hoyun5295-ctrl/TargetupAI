/**
 * 이메일 클릭 추적 — 속성에 적힌 &amp;를 풀어 원본 주소로 서명한다 (★2026-09-26 한줄로 V2 R1-39)
 *
 * 렌더러는 링크를 속성 이스케이프로 넣어 `&`가 `&amp;`다(올바른 HTML). 추적 래퍼가 그 속성 글자를 그대로 원본 주소로 서명해
 * 클릭 뒤 이동 주소에 `&amp;`가 글자로 남았다 → 파라미터 2개 이상인 링크(쿠폰·UTM)가 깨졌다.
 * 브라우저가 속성을 읽을 때처럼 엔티티를 풀어서 서명한다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { wrapLinksForTracking, verifyTrackingToken } from '../email-tracking';

beforeAll(() => {
  process.env.EMAIL_TRACKING_SECRET = process.env.EMAIL_TRACKING_SECRET || 'test-secret-not-real';
});

const tokenOf = (html: string) => {
  const m = html.match(/\/api\/email\/t\/c\/([^"]+)"/);
  return m ? verifyTrackingToken(m[1]) : null;
};

describe('추적 링크 원본 주소', () => {
  it('&amp;는 &로 풀어 서명한다', () => {
    const out = wrapLinksForTracking('<a href="https://shop.example/p?a=1&amp;b=2&#38;c=3">x</a>', 'c1', 'u@example.invalid');
    expect(tokenOf(out)?.u).toBe('https://shop.example/p?a=1&b=2&c=3');
  });

  it('엔티티가 없는 링크는 그대로', () => {
    const out = wrapLinksForTracking('<a href="https://shop.example/p?a=1">x</a>', 'c1', 'u@example.invalid');
    expect(tokenOf(out)?.u).toBe('https://shop.example/p?a=1');
  });
});
