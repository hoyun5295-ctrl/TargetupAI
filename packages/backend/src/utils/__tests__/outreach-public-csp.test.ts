import { describe, it, expect } from 'vitest';
import { outreachPublicPageCsp, PUBLIC_BASE } from '../sales-outreach-produce';

/**
 * ★ 2026-09-09 아웃리치 공개 샘플 페이지 CSP 계약.
 * 경위: 페이지가 helmet 기본 CSP(img-src 'self' data:)를 물려받아, sys.hanjullo.com 등 PUBLIC_BASE 와
 *       다른 호스트에서 열면 hanjul.ai 이미지 9장이 전부 차단됐다(아이소이 샘플 실측 · curl 은 200).
 * 계약: img-src 에 PUBLIC_BASE 를 더하되, 크롤 문구를 담는 페이지라 script-src 'self' 등 기본 방어는 유지한다.
 */
function mockRes() {
  const res: any = {
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v; return this; },
    getHeader(k: string) { return this.headers[k]; },
    removeHeader(k: string) { delete this.headers[k]; },
  };
  return res;
}

describe('outreachPublicPageCsp', () => {
  it('img-src 에 PUBLIC_BASE 가 들어간다(호스트가 달라도 이미지 로드)', () => {
    const res = mockRes();
    let nexted = false;
    outreachPublicPageCsp()({} as any, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    const csp = String(res.headers['Content-Security-Policy']);
    expect(csp).toContain(`img-src 'self' data: ${PUBLIC_BASE}`);
  });

  it('helmet 기본 방어(default-src·script-src·object-src)는 그대로 남는다', () => {
    const res = mockRes();
    outreachPublicPageCsp()({} as any, res, () => {});
    const csp = String(res.headers['Content-Security-Policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
  });
});
