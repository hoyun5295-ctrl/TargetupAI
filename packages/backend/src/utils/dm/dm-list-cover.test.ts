/**
 * DM 목록 대표 이미지(section_summary.cover) 계약 테스트 (2026-09-16 Harold · 목록 리스트형 A안).
 *
 * 목록 카드의 폰목업 도식 대신 DM 안 첫 이미지를 작은 썸네일로 보여준다.
 *  - 보이는 섹션을 order 순으로 훑어 첫 이미지를 고른다(헤더 로고는 대표 이미지가 아니다).
 *  - 저장 경로(/api/dm/images)는 공개 서빙 경로(/api/dm/v/images)로 정규화한다(<img>는 인증 헤더를 못 싣는다).
 *  - data: URL·과도하게 긴 값은 목록 응답에 싣지 않는다(목록 payload 경량 계약).
 *  - 섹션이 없는 옛 슬라이드 DM은 첫 장(pages->0)에서 고른다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
import { query } from '../../config/database';
import { buildSectionSummary, getDmList } from './dm-builder';

const qmock = query as unknown as ReturnType<typeof vi.fn>;
const V = (f: string) => `/api/dm/v/images/c1/${f}`;

describe('DM 목록 대표 이미지 cover', () => {
  it('보이는 섹션을 order 순으로 훑어 첫 이미지를 고른다', () => {
    const s = buildSectionSummary({
      sections: [
        { type: 'gallery', order: 2, visible: true, props: { images: [{ url: V('g.jpg') }] } },
        { type: 'hero', order: 1, visible: true, props: { headline: 'h', image_url: V('h.jpg') } },
      ],
    });
    expect(s.cover).toBe(V('h.jpg'));
  });

  it('숨긴 섹션·이미지 없는 섹션은 건너뛴다', () => {
    const s = buildSectionSummary({
      sections: [
        { type: 'hero', order: 1, visible: false, props: { image_url: V('hidden.jpg') } },
        { type: 'coupon', order: 2, visible: true, props: {} },
        { type: 'gallery', order: 3, visible: true, props: { images: [{ url: '' }, { url: V('g2.jpg') }] } },
      ],
    });
    expect(s.cover).toBe(V('g2.jpg'));
  });

  it.each([
    ['slideshow', { slides: [{ image_url: V('s.jpg') }] }, V('s.jpg')],
    ['product_carousel', { products: [{ image_url: V('p.jpg'), name: 'a', price: 1 }] }, V('p.jpg')],
    ['text_card', { headline: 'a', body: 'b', image_url: V('t.jpg') }, V('t.jpg')],
    ['header', { variant: 'banner', banner_image_url: V('b.jpg') }, V('b.jpg')],
    ['video', { video_url: 'x', thumbnail_url: V('v.jpg') }, V('v.jpg')],
  ])('%s 섹션의 이미지를 읽는다', (type, props, expected) => {
    const s = buildSectionSummary({ sections: [{ type, order: 1, visible: true, props }] });
    expect(s.cover).toBe(expected);
  });

  it('헤더 로고는 대표 이미지로 쓰지 않는다', () => {
    const s = buildSectionSummary({ sections: [{ type: 'header', order: 1, visible: true, props: { variant: 'logo', logo_url: V('logo.png') } }] });
    expect(s.cover).toBeNull();
  });

  it('저장 경로는 공개 서빙 경로로 정규화하고 외부 https는 그대로 둔다', () => {
    const a = buildSectionSummary({ sections: [{ type: 'hero', order: 1, visible: true, props: { image_url: '/api/dm/images/c1/a.png' } }] });
    expect(a.cover).toBe('/api/dm/v/images/c1/a.png');
    const b = buildSectionSummary({ sections: [{ type: 'hero', order: 1, visible: true, props: { image_url: 'https://cdn.example.invalid/x.jpg' } }] });
    expect(b.cover).toBe('https://cdn.example.invalid/x.jpg');
  });

  it('data: URL·너무 긴 값·경로가 아닌 값은 싣지 않고 다음 후보로 넘어간다', () => {
    const s = buildSectionSummary({
      sections: [
        { type: 'hero', order: 1, visible: true, props: { image_url: 'data:image/png;base64,AAAA' } },
        { type: 'text_card', order: 2, visible: true, props: { image_url: `/api/dm/v/images/c1/${'a'.repeat(1200)}.jpg` } },
        { type: 'video', order: 3, visible: true, props: { thumbnail_url: 'javascript:alert(1)' } },
        { type: 'gallery', order: 4, visible: true, props: { images: [{ url: V('ok.jpg') }] } },
      ],
    });
    expect(s.cover).toBe(V('ok.jpg'));
  });

  it('이미지가 하나도 없으면 null', () => {
    expect(buildSectionSummary({ sections: [{ type: 'coupon', order: 1, visible: true, props: {} }] }).cover).toBeNull();
    expect(buildSectionSummary({}).cover).toBeNull();
  });

  it('섹션이 없는 옛 슬라이드 DM은 첫 장에서 고른다 (legacy imageUrl · 장 안 sections)', () => {
    expect(buildSectionSummary({ first_page: { imageUrl: V('legacy.jpg') } }).cover).toBe(V('legacy.jpg'));
    expect(buildSectionSummary({
      first_page: { id: 'p1', sections: [{ type: 'gallery', order: 0, visible: true, props: { images: [{ url: V('page.jpg') }] } }] },
    }).cover).toBe(V('page.jpg'));
  });

  describe('getDmList', () => {
    beforeEach(() => { qmock.mockReset(); });

    it('첫 장만 SELECT 하고(pages 원본 미전송) 응답 요약에 cover 를 싣는다', async () => {
      qmock.mockResolvedValueOnce({
        rows: [{ id: 'd1', title: 't', status: 'draft', layout_mode: 'slides', sections: [], brand_kit: null, settings: null, page_count: 2, first_page: { imageUrl: V('first.jpg') } }],
      });
      const list = await getDmList('c1');
      const [sql] = qmock.mock.calls[0] as [string, any[]];
      expect(sql).toContain('pages->0 AS first_page');
      expect(list[0].section_summary.cover).toBe(V('first.jpg'));
      expect((list[0] as any).first_page).toBeUndefined();
    });
  });
});
