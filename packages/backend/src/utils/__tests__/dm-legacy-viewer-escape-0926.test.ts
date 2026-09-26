/**
 * DM 공개 뷰어 옛 렌더러 — 저장 값이 HTML로 실행되지 않는다 (★2026-09-26 한줄로 V2 R1-41)
 *
 * DM 저장(PUT)은 `pages`를 구조 검증 없이 저장하고, 섹션 구조가 없는 `pages`는 공개 뷰어가 옛 슬라이드 렌더러로 그린다.
 * 옛 렌더러(+머리말·꼬리말)는 제목·문구·버튼·링크·색·연락처·매장명을 **이스케이프 없이** 넣어, 고객사 사용자가
 * 저장형 스크립트를 게시할 수 있었다(공개 URL을 연 모든 수신자에게 실행).
 * 처방: 새 섹션 렌더러와 같은 CT(escapeHtml · safeUrl)로 모든 삽입값을 감싸고, 색은 색 형식만 통과시킨다.
 */
import { describe, it, expect } from 'vitest';
import { renderDmViewerHtml } from '../dm/dm-viewer';

const XSS = '<script>alert(1)</script>';
const IMG = '<img src=x onerror=alert(1)>';
const JS = 'javascript:alert(1)';

const dm = {
  short_code: 'abc123',
  store_name: `매장${XSS}`,
  title: `</title>${XSS}`,
  header_template: 'coupon',
  header_data: { discount: IMG, couponCode: XSS },
  footer_template: 'cta',
  footer_data: { ctaUrl: JS, ctaText: IMG, ctaColor: 'red;background:url(javascript:alert(1))' },
  pages: [
    { order: 1, layout: 'text-card', heading: XSS, caption: IMG, bgColor: '#000;}</style><script>alert(1)</script>', textColor: '#fff' },
    { order: 2, layout: 'cta-card', ctaUrl: JS, ctaText: XSS, caption: IMG },
    { order: 3, layout: 'full-image', videoUrl: JS, caption: XSS },
  ],
};

describe('옛 슬라이드 렌더러 이스케이프', () => {
  const html = renderDmViewerHtml(dm, 'https://hanjul.ai/api/dm');

  it('저장 문구의 태그가 실행되는 형태로 남지 않는다', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('javascript: 링크가 href·src로 실리지 않는다', () => {
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/src="javascript:/i);
  });

  it('색 값은 색 형식만 통과한다(스타일 탈출 불가)', () => {
    expect(html).not.toContain('</style><script>');
    expect(html).not.toContain('url(javascript:alert(1))');
  });

  it('머리말·꼬리말·제목도 같은 규칙', () => {
    expect(html).not.toContain(`</title>${XSS}`);
  });
});

describe('평범한 값은 그대로 보인다(표시 불변)', () => {
  const html = renderDmViewerHtml({
    ...dm,
    store_name: '인비토', title: '가을 할인',
    header_data: { discount: '30% 할인', couponCode: 'FALL30' },
    footer_data: { ctaUrl: 'https://invito.kr/sale', ctaText: '보러 가기', ctaColor: '#4f46e5' },
    pages: [{ order: 1, layout: 'text-card', heading: '가을 세일', caption: '10월까지', bgColor: '#1a1a2e', textColor: '#fff' }],
  }, 'https://hanjul.ai/api/dm');

  it('문구·링크·색이 보인다', () => {
    expect(html).toContain('가을 세일');
    expect(html).toContain('30% 할인');
    expect(html).toContain('href="https://invito.kr/sale"');
    expect(html).toContain('background:#1a1a2e');
    expect(html).toContain('background:#4f46e5');
  });
});
