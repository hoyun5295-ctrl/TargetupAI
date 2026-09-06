/**
 * sales-outreach-s7.test.ts — 2026-09-06(2) 육안 정정(Harold "이미지만 나열 · 설명 없음") + 제안 메일 기능 소개 3칸
 *  갤러리 캡션(홈페이지 배너 alt · 면허 밖 혜택 차단) · 갤러리 앞 설명 카드 · 포스터 자기 블록 · 포스터 문구 정정 · 증거 카드 문장 · 기능 3칸.
 * DB·AI·네트워크 0.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import {
  cleanBannerCaption, bannerAltMapOf, fillOutreachDmMedia, buildOutreachPosterTexts, trimDanglingTail, buildPosterTypography, insertProofCard,
  buildProposalEmailSections, buildOutreachPlainText, buildOutreachMaterialBlock,
} from '../sales-outreach-produce';
import { getActiveStyleGuide } from '../sales-outreach-style';
import { OUTREACH_DM_SECTION_CONTRACT } from '../sales-outreach-exemplars';
import type { Section } from '../dm/dm-section-registry';

const sec = (type: string, props: Record<string, unknown>, order = 0): Section => ({ id: `s-${type}-${order}`, type, order, visible: true, props } as unknown as Section);

describe('배너 문구(alt) 정리', () => {
  it('파일명 · "배너1"류 · 4자 미만 · 업체명 단독은 버리고 문장은 남긴다(60자)', () => {
    expect(cleanBannerCaption('main_banner_01.jpg')).toBeNull();
    expect(cleanBannerCaption('배너1')).toBeNull();
    expect(cleanBannerCaption('메인 비주얼 2')).toBeNull();
    expect(cleanBannerCaption('NEW')).toBeNull();
    expect(cleanBannerCaption('아이소이', '아이소이')).toBeNull();
    expect(cleanBannerCaption('  NMN 나이아신 기미 토닝 앰플   NEW  ')).toBe('NMN 나이아신 기미 토닝 앰플 NEW');
    expect(cleanBannerCaption('추석선물세트 특별 기획전 최대 30%.')).toBe('추석선물세트 특별 기획전 최대 30%');
  });
  it('재료 v2 banners → url→alt 사전(빈 alt 제외 · 첫 값 우선)', () => {
    const m = bannerAltMapOf({ banners: [{ url: 'https://a/1.jpg', alt: 'A' }, { url: 'https://a/2.jpg', alt: '' }, { url: 'https://a/1.jpg', alt: 'B' }] });
    expect(m).toEqual({ 'https://a/1.jpg': 'A' });
    expect(bannerAltMapOf(null)).toEqual({});
  });
});

describe('갤러리 캡션 · 설명 카드 · 포스터 블록 (fillOutreachDmMedia)', () => {
  const media = {
    posterUrl: 'https://hanjul.ai/poster.jpg', posterSize: { width: 1792, height: 2400 }, posterCaption: '추석선물세트 특별 기획전',
    gallery: [
      { url: 'https://hanjul.ai/b1.jpg', width: 1920, height: 600, alt: '풍성한 한가위 보름달 혜택' },
      { url: 'https://hanjul.ai/b2.jpg', width: 1920, height: 600, alt: 'NMN 나이아신 기미 토닝 앰플 NEW' },
      { url: 'https://hanjul.ai/b3.jpg', width: 1920, height: 600, alt: '전 상품 최대 30% 할인' },
    ],
    products: [] as any[], ctaLinks: { 기획전: 'https://b.com/plan' }, homepageUrl: 'https://b.com/', legal: null, companyName: '아이소이', licensedQuote: '',
  };
  it('이미지별 caption = 배너 문구 · 면허 없는 혜택 수치가 든 문구는 캡션 없음 · 갤러리 앞에 설명 카드가 코드로 선다(tag 카테고리 · headline 첫 문구)', () => {
    const r = fillOutreachDmMedia([sec('header', {}, 0), sec('hero', {}, 1), sec('gallery', {}, 2), sec('footer', {}, 3)], media as any, 'DM');
    const types = r.sections.map((s) => s.type);
    // header · hero(b1) · 포스터 블록 · 설명 카드 · 갤러리(b2·b3) · 삽입 CTA · footer
    expect(types).toEqual(['header', 'hero', 'gallery', 'text_card', 'gallery', 'cta', 'footer']);
    const poster: any = r.sections[2];
    expect(poster.id).toMatch(/^so-poster-/);
    expect(poster.props.images).toHaveLength(1);
    expect(poster.props.images[0].caption).toBe('추석선물세트 특별 기획전');
    const lead: any = r.sections[3];
    expect(lead.id).toMatch(/^so-lead-/);
    expect(lead.props.headline).toBe('NMN 나이아신 기미 토닝 앰플 NEW');
    expect(lead.props.body).toBe(''); // 30% 문구는 차단되어 body 후보에 없다
    const gal: any = r.sections[4];
    expect(gal.props.images[0].caption).toBe('NMN 나이아신 기미 토닝 앰플 NEW');
    expect(gal.props.images[1].caption).toBeUndefined(); // 최대 30% = 면허 밖 → 캡션 없음
    expect(gal.props.images[1].alt).toBe('아이소이 이미지');
  });
  it('면허 인용에 그 수치가 있으면 캡션이 남는다 · 모델이 갤러리 앞에 text_card 를 뒀으면 코드가 덧붙이지 않는다', () => {
    const licensed = { ...media, licensedQuote: '전 상품 최대 30% 할인 · 2026.09.01 ~ 2026.12.31' };
    const r = fillOutreachDmMedia([sec('hero', {}, 0), sec('text_card', { headline: '모델 카드' }, 1), sec('gallery', {}, 2)], licensed as any, 'DM');
    const gal: any = r.sections.find((s) => s.type === 'gallery' && !String((s as any).id).startsWith('so-poster-'));
    expect(gal.props.images[1].caption).toBe('전 상품 최대 30% 할인');
    expect(r.sections.filter((s) => String((s as any).id).startsWith('so-lead-')).length).toBe(0);
  });
  it('캡션이 하나도 없으면 설명 카드도 없다 · hero 가 없는 조각에서는 포스터가 옛 자리(첫 갤러리 첫 장)', () => {
    const plain = { ...media, gallery: media.gallery.map((g) => ({ url: g.url, width: g.width, height: g.height })) };
    const r = fillOutreachDmMedia([sec('hero', {}, 0), sec('gallery', {}, 1)], plain as any, 'DM');
    expect(r.sections.filter((s) => String((s as any).id).startsWith('so-lead-')).length).toBe(0);
    const frag = fillOutreachDmMedia([sec('gallery', {}, 0)], plain as any, 'DM');
    expect((frag.sections[0].props as any).images.map((x: any) => x.url)).toEqual(['https://hanjul.ai/poster.jpg', 'https://hanjul.ai/b2.jpg']);
  });
});

describe('포스터 3칸 정정', () => {
  it('숫자 앞 절단 뒤 매달린 수식어·조사를 걷는다(실측 "혜택 최대") · 마지막 낱말이 2자면 조사를 보존한다', () => {
    expect(trimDanglingTail('풍성한 한가위 보름달 혜택 최대')).toBe('풍성한 한가위 보름달 혜택');
    expect(trimDanglingTail('가을 신상 전 품목을')).toBe('가을 신상 전 품목');
    expect(trimDanglingTail('제주 사과')).toBe('제주 사과');
    expect(trimDanglingTail('멤버십 데이 단돈')).toBe('멤버십 데이');
    const t = buildOutreachPosterTexts({ companyName: '아이소이', industry: 'beauty', eventQuote: '풍성한 한가위 보름달 혜택 최대 30% 할인 · 2026.09.01 ~ 2026.09.18', products: [], siteTitle: null });
    expect(t.title).toBe('풍성한 한가위 보름달 혜택');
  });
  it('subtitle 은 옵션·선택·택1·단품·더블 낱말이 든 상품명을 거르고 14자 이하 짧은 이름을 앞세운다', () => {
    const t = buildOutreachPosterTexts({ companyName: '아이소이', industry: 'beauty', eventQuote: null, products: [{ name: '올세라 탄력 옵션 선택(크림 70ml/세럼 50ml/세트 택1)' }, { name: '모이스춰 닥터 크림 튜브형(단품/더블 선택)' }, { name: '스킨케어 비건 쿠션 리필' }, { name: '블랙티 앰플' }], siteTitle: '아이소이 공식몰' });
    expect(t.subtitle).toBe('블랙티 앰플');
  });
  it('타이포 폭 맞춤 — 17자 제목은 포스터 폭(0.9×W)을 넘지 않는다 · 짧은 제목은 기본 크기', () => {
    const long = buildPosterTypography({ label: null, title: '풍성한 한가위 보름달 혜택 최대 특별', subtitle: null, dropped: [] }, { brandColor: null, zone: 'top', fontPath: null }) as any[];
    const len = '풍성한 한가위 보름달 혜택 최대 특별'.length;
    expect(long[0].size * len).toBeLessThanOrEqual(0.9 * (1792 / 2400) + 1e-9);
    const short = buildPosterTypography({ label: null, title: '가을 세일', subtitle: null, dropped: [] }, { brandColor: null, zone: 'top', fontPath: null }) as any[];
    expect(short[0].size).toBe(0.072);
  });
});

describe('증거 카드 문장 · DM 계약', () => {
  it('숫자 나열이 아니라 한 문장 · 1위 표기 없으면 tag 고객 후기', () => {
    const r = insertProofCard([sec('hero', {}, 0), sec('product_carousel', { products: [{ name: 'a' }] }, 1)], { reviewTotal: 455089, rating: 4.9, rankLabel: null, collectedAt: '2026-09-06T05:00:00Z' }, '아이소이');
    const card: any = r.sections[2];
    expect(card.props.tag).toBe('고객 후기');
    expect(card.props.headline).toBe('리뷰 455,089건 · 평점 4.9');
    expect(card.props.body).toBe('고객이 남긴 리뷰와 평점입니다 · 2026-09-06 아이소이 홈페이지 기준');
  });
  it('DM 계약 = 각 gallery 앞 text_card 1개 · 프롬프트 재료 블록에 [배너 문구] 목록', () => {
    expect(OUTREACH_DM_SECTION_CONTRACT).toContain('각 gallery 바로 앞에 1개씩');
    const block = buildOutreachMaterialBlock({ companyName: 'X', industry: null, homepageUrl: 'https://x.com', siteTitle: null, material: 'm', products: [], galleryCount: 3, bannerCaptions: ['가을 신상', '멤버십 위크'] }, 'want', 'DM');
    expect(block).toContain('[배너 문구');
    expect(block).toContain('1. 가을 신상');
    expect(block).toContain('2. 멤버십 위크');
    expect(buildOutreachMaterialBlock({ companyName: 'X', industry: null, homepageUrl: 'https://x.com', siteTitle: null, material: 'm', products: [], galleryCount: 0 }, 'want', 'DM')).not.toContain('[배너 문구');
  });
});

describe('제안 메일 기능 소개 3칸(여정 · 자동마케팅 · 이미지 스튜디오)', () => {
  const guide = getActiveStyleGuide();
  const base = {
    companyName: '아이소이', industry: 'beauty', selectedEvent: null, copyBody: '문안 {{DM_LINK}}', posterUrl: 'https://hanjul.ai/p.jpg',
    dmUrl: 'https://hlj.kr/x', previewUrl: 'https://hanjul.ai/api/outreach/v/abc', unsubscribeNotice: '수신거부 안내', brandSections: [] as Section[],
    subject: '제목', intro: '서두', now: new Date('2026-09-06T03:00:00Z'),
  };
  it('CTA 앞에 소개 카드 1 + 기능 카드 3 · 포스터가 있으면 이미지 스튜디오 headline 이 이 메일의 이미지를 가리킨다 · 평문에도 실린다', () => {
    const s = buildProposalEmailSections(guide, base);
    const types = s.map((x) => x.type);
    const ctaIdx = types.indexOf('cta');
    const features = s.slice(ctaIdx - 4, ctaIdx) as any[];
    expect(features.map((x) => x.type)).toEqual(['text_card', 'text_card', 'text_card', 'text_card']);
    expect(features[0].props.tag).toBe(guide.emailCopy.features.tag);
    expect(features.slice(1).map((x) => x.props.tag)).toEqual(['이미지 스튜디오', '문안과 여정', '자동마케팅']);
    expect(features[1].props.headline).toBe('이 메일 맨 위 이미지도 그렇게 만들었습니다');
    expect(features[1].props.body).toContain('아이소이 상품 사진');
    for (const f of features) { expect(String(f.props.body)).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|—/); }
    const noPoster = buildProposalEmailSections(guide, { ...base, posterUrl: null }) as any[];
    const studio = noPoster.find((x) => x.props?.tag === '이미지 스튜디오');
    expect(studio.props.headline).toBe('상품 사진 한 장으로 포스터가 나옵니다');
    const text = buildOutreachPlainText(guide, base);
    expect(text).toContain('- 문안과 여정:');
    expect(text).toContain('- 자동마케팅:');
    expect(text).toContain('- 이미지 스튜디오:');
    expect(types[types.length - 1]).toBe('footer');
  });
  it('기능 문구는 업체명 직후에 조사를 붙이지 않는다', () => {
    for (const item of guide.emailCopy.features.items) {
      for (const name of ['한줄로', '인비토']) {
        const body = item.body(name);
        const after = body.slice(body.indexOf(name) + name.length, body.indexOf(name) + name.length + 1);
        expect(['을', '를', '이', '가', '은', '는', '과', '와'], body).not.toContain(after);
      }
    }
    const h = guide.emailCopy.features.headline('인비토');
    expect(h.startsWith('인비토 ')).toBe(true);
  });
});
