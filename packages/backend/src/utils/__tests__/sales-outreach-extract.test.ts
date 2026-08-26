/**
 * AI 영업 아웃리치 — 행사 텍스트 추출기 (2026-08-26 신설 · 설계서 §17)
 *
 * 소스 스캔이 아니라 **행동 테스트**다(LESSONS_BACKEND 2026-08-01 · 조건 반전을 못 잡는 검사 금지).
 * 픽스처 HTML을 실제로 함수에 넣고 반환 문자열을 단정한다.
 */
import { describe, it, expect } from 'vitest';
import { buildOutreachEventText } from '../sales-outreach-extract';

describe('buildOutreachEventText — 1단계 이벤트 카드 요소', () => {
  it('행사 카드 블록의 텍스트를 결과 맨 앞에 싣는다', () => {
    const html = `
      <html><head><title>테스트몰</title></head><body>
        <div class="intro">회사 소개 문단입니다. 연혁과 인사말이 길게 이어집니다.</div>
        <ul class="event-list"><li>가을 감사제 전 품목 20% 할인</li></ul>
        <div class="footer">이용약관 개인정보처리방침</div>
      </body></html>`;

    const out = buildOutreachEventText(html);

    expect(out).not.toBeNull();
    expect(out!.indexOf('가을 감사제 전 품목 20% 할인'))
      .toBeLessThan(out!.indexOf('회사 소개 문단입니다'));
  });
});

describe('buildOutreachEventText — 2단계 딜 키워드 링크', () => {
  it('행사성 class가 없어도 혜택 키워드가 든 링크 텍스트를 앞으로 올린다', () => {
    const html = `
      <html><body>
        <p>브랜드 스토리와 소재 설명이 먼저 길게 나옵니다.</p>
        <a href="/notice/1">회사소개</a>
        <a href="/notice/2">겨울 시즌오프 최대 50% 할인</a>
        <a href="/notice/3">채용공고</a>
      </body></html>`;

    const out = buildOutreachEventText(html);

    expect(out).not.toBeNull();
    expect(out!.indexOf('겨울 시즌오프 최대 50% 할인'))
      .toBeLessThan(out!.indexOf('브랜드 스토리와 소재 설명'));
  });

  it('혜택 키워드가 없는 링크는 앞으로 올리지 않는다', () => {
    const html = `
      <html><body>
        <p>브랜드 스토리와 소재 설명이 먼저 길게 나옵니다.</p>
        <a href="/notice/1">회사소개</a>
      </body></html>`;

    const out = buildOutreachEventText(html);

    expect(out).not.toBeNull();
    expect(out!.indexOf('회사소개'))
      .toBeGreaterThan(out!.indexOf('브랜드 스토리와 소재 설명'));
  });
});

describe('buildOutreachEventText — 무후퇴·예산 계약', () => {
  it('구조화 0건이면 기존 전체 텍스트 방식과 문자 단위로 같다', async () => {
    const { extractEventTextFromHtml } = await import('../dm/dm-brand-extractor');
    const html = `
      <html><head><meta property="og:title" content="테스트 브랜드"></head><body>
        <p>소개 문단입니다.</p><p>연혁 문단입니다.</p>
      </body></html>`;

    expect(buildOutreachEventText(html)).toBe(extractEventTextFromHtml(html));
  });

  it('구조화 블록이 있어도 전체 길이가 6000자를 넘지 않는다', () => {
    const filler = '<p>브랜드 소개와 소재 이야기가 이어집니다.</p>'.repeat(400);
    const html = `<html><body><ul class="event-list"><li>가을 감사제 20% 할인</li></ul>${filler}</body></html>`;

    const out = buildOutreachEventText(html);

    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(6000);
  });

  it('본문이 길어도 구조화 블록은 잘리지 않고 살아남는다', () => {
    const filler = '<p>브랜드 소개와 소재 이야기가 이어집니다.</p>'.repeat(400);
    const html = `<html><body><ul class="event-list"><li>가을 감사제 20% 할인</li></ul>${filler}</body></html>`;

    const out = buildOutreachEventText(html);

    expect(out!.startsWith('가을 감사제 20% 할인')).toBe(true);
  });
});

describe('buildOutreachEventText — 절단 경계 무후퇴', () => {
  it('구조화 0건이고 본문이 상한을 넘어도 기존 방식과 문자 단위로 같다', async () => {
    const { extractEventTextFromHtml } = await import('../dm/dm-brand-extractor');
    const filler = '<p>브랜드 소개 문단입니다.</p>'.repeat(600);
    const html = `<html><body>${filler}</body></html>`;

    const out = buildOutreachEventText(html);

    expect(out!.length).toBe(6000);
    expect(out).toBe(extractEventTextFromHtml(html));
  });
});
