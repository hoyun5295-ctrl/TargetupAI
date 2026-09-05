/**
 * sales-outreach-extract-dedupe.test.ts — A-12 구조화 블록 중복 제거 + 계측 (2026-09-05)
 * 행동 테스트: 블록이 본문에 다시 나오지 않는다 · 0건이면 옛 방식과 문자 단위로 같다(기존 7건과 함께 무후퇴 계약).
 */
import { describe, it, expect } from 'vitest';
import { buildOutreachEventMaterial, buildOutreachEventText } from '../sales-outreach-extract';

describe('buildOutreachEventMaterial', () => {
  it('앞에 실린 행사 블록이 본문에 다시 나오지 않는다 · structuredBlocks 계측', () => {
    const html = `
      <html><body>
        <p>브랜드 소개 문단입니다. 소재 이야기가 이어집니다.</p>
        <ul class="event-list"><li>가을 감사제 전 품목 20% 할인</li></ul>
        <p>연혁 문단입니다.</p>
      </body></html>`;
    const r = buildOutreachEventMaterial(html);
    expect(r.structuredBlocks).toBe(1);
    expect(r.text).not.toBeNull();
    expect(r.text!.startsWith('가을 감사제 전 품목 20% 할인')).toBe(true);
    expect(r.text!.split('가을 감사제 전 품목 20% 할인').length - 1).toBe(1);
    expect(r.text).toContain('브랜드 소개 문단입니다');
  });
  it('0건이면 text가 래퍼와 같고 계측은 0', async () => {
    const { extractEventTextFromHtml } = await import('../dm/dm-brand-extractor');
    const html = `<html><body><p>소개 문단입니다.</p><p>연혁 문단입니다.</p></body></html>`;
    const r = buildOutreachEventMaterial(html);
    expect(r.structuredBlocks).toBe(0);
    expect(r.text).toBe(extractEventTextFromHtml(html));
    expect(buildOutreachEventText(html)).toBe(r.text);
  });
});
