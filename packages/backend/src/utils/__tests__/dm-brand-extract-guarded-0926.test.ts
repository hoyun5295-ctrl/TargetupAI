/**
 * DM 브랜드 추출 — 보호된 요청으로만 외부 페이지를 가져온다 (★2026-09-26 한줄로 V2 R1-28 · B-0824-2 같은 부류)
 *
 * extractBrandFromUrl만 같은 파일의 fetchHtmlGuarded(사설·내부 주소 차단 · 리다이렉트 홉마다 DNS 해석·공인 검증·연결 고정 · 크기 상한)를
 * 쓰지 않고 일반 fetch로 리다이렉트를 따라가, 사용자가 넣은 주소로 서버가 내부 주소를 두드릴 수 있었다(SSRF).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'dm', 'dm-brand-extractor.ts'), 'utf8');
const fn = src.slice(src.indexOf('export async function extractBrandFromUrl('), src.indexOf('// ────────────── 상품 URL → og:image'));

describe('브랜드 추출 외부 요청', () => {
  it('보호된 요청 함수를 쓴다', () => {
    expect(fn).toContain('await fetchHtmlGuarded(normalizedUrl)');
  });
  it('일반 fetch·리다이렉트 추종이 남아 있지 않다', () => {
    expect(fn).not.toMatch(/await fetch\(/);
    expect(fn).not.toContain("redirect: 'follow'");
  });
  it('상대 주소는 최종 도착 페이지 기준으로 푼다', () => {
    expect(fn).toContain('baseUrl = page.baseUrl;');
  });
});
