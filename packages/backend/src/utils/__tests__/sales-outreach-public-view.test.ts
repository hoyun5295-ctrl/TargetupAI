import { describe, it, expect } from 'vitest';
import { assembleProposalEmail, stripSelfLinkButtons, type ProposalEmailInput } from '../sales-outreach-produce';
import { getActiveStyleGuide } from '../sales-outreach-style';

/**
 * ★ 2026-09-15 B-0915-5 공개 웹 보기(getPublicOutreachHtml)는 저장된 메일 HTML 을 그대로 내므로
 *   메일용 1순위 버튼("산출물 보기" → previewUrl)이 웹 보기 안에서는 자기 자신을 가리킨다(시세이도 137c25fd33 실측).
 *   계약: 응답 직전 순수 CT 가 그 href 를 가진 버튼 행만 뺀다 · 나머지 바이트 동일 · 저장본 무수정(기존 발송 건에도 즉시).
 */
const guide = getActiveStyleGuide();
const base: ProposalEmailInput = {
  companyName: '브랜드', industry: 'beauty', selectedEvent: null,
  copyBody: '(광고) 브랜드 소식\n{{DM_LINK}}', posterUrl: 'https://hanjul.ai/p.jpg',
  dmUrl: 'https://hlj.kr/abc', previewUrl: 'https://hanjul.ai/api/outreach/v/0123456789',
  unsubscribeNotice: '수신거부는 회신으로 알려주세요',
  brandSections: [],
  subject: '제목', intro: '서두',
  now: new Date('2026-09-15T03:00:00Z'),
};
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('stripSelfLinkButtons (웹 보기 자기 링크 제거)', () => {
  it('previewUrl 버튼 행만 빠지고 DM 버튼·라벨은 남는다 · VML(아웃룩) 짝도 함께 빠진다', () => {
    const { html } = assembleProposalEmail(base);
    expect(count(html, `href="${base.previewUrl}"`)).toBeGreaterThanOrEqual(2); // VML + <a>
    const out = stripSelfLinkButtons(html, base.previewUrl);
    expect(out).not.toContain(base.previewUrl);
    expect(out).not.toContain(guide.emailCopy.cta.primary);
    expect(out).toContain(`href="${base.dmUrl}"`);
    expect(out).toContain(guide.emailCopy.cta.secondary);
    expect(count(out, '<v:roundrect')).toBe(count(html, '<v:roundrect') - 1);
    expect(out.length).toBeLessThan(html.length);
  });
  it('표 구조가 깨지지 않는다(tr 짝 유지 · 바깥 버튼 행 + 안쪽 버튼 표 행 = 2행 감소)', () => {
    const { html } = assembleProposalEmail(base);
    const out = stripSelfLinkButtons(html, base.previewUrl);
    expect(count(out, '<tr>')).toBe(count(html, '<tr>') - 2);
    expect(count(out, '</tr>')).toBe(count(html, '</tr>') - 2);
    expect(count(out, '<table')).toBe(count(html, '<table') - 1);
    expect(count(out, '</table>')).toBe(count(html, '</table>') - 1);
  });
  it('자기 링크가 없으면 원문 바이트 동일 · 빈 입력은 그대로', () => {
    const { html } = assembleProposalEmail(base);
    expect(stripSelfLinkButtons(html, 'https://hanjul.ai/api/outreach/v/nope000000')).toBe(html);
    expect(stripSelfLinkButtons(html, '')).toBe(html);
    expect(stripSelfLinkButtons('', base.previewUrl)).toBe('');
  });
  it('href 에 HTML 이스케이프(&amp;)가 있어도 같은 주소로 본다', () => {
    const url = 'https://hanjul.ai/api/outreach/v/0123456789?a=1&b=2';
    const { html } = assembleProposalEmail({ ...base, previewUrl: url });
    expect(html).toContain('href="https://hanjul.ai/api/outreach/v/0123456789?a=1&amp;b=2"');
    const out = stripSelfLinkButtons(html, url);
    expect(out).not.toContain('0123456789?a=1');
    expect(out).toContain(`href="${base.dmUrl}"`);
  });
});
