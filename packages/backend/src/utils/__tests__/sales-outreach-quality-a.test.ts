/**
 * sales-outreach-quality-a.test.ts — ★ 2026-09-24 AI 영업 산출물 품질 A (설계 = docs/2026-09-24-outreach-quality-a-design.md)
 * 톤28 실측(잡 ea70ffc6 · 산출물 3cbb05142a) 결함 6종의 계약. DB·AI 는 mock · 네트워크 0.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import { filterQuoteCandidates, eventCardsOf, quotePartsOf } from '../sales-outreach-jobs';
import {
  standardMaterialsOf, buildOutreachPosterTexts, posterTextOkFor, productNameForImage, posterStyleHint,
  buildProposalEmailSections, type ProposalEmailInput,
} from '../sales-outreach-produce';
import { composeOutreachStandard } from '../sales-outreach-slices';
import { catalogCaptionOf, planOutreachCatalog, renderCatalogCardBuffer } from '../sales-outreach-catalog';
import { getActiveStyleGuide } from '../sales-outreach-style';
import type { Section } from '../dm/dm-section-registry';

const src = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const HOME = 'https://www.toun28.com';
// 톤28 실측 인용문(Harold SQL 원문 그대로)
const Q_SIGNUP = '2주동안 첫 구매 혜택 가입 당일 1만원 할인 (3만원 이상 구매)';
const Q_CHUSEOK = '추석 맞이 톤28 윷놀이 행운의 혜택 던질수록 커지는 행운의 판 오직 추석 기간 한정 9/27까지';

describe('A2 행사 인용문 세 조각(제목·혜택·기간) — 원문 부분 문자열만', () => {
  it('quotePartsOf — 세 조각이 인용문 안에 있으면 싣고 · 없는 조각은 null · 제목이 틀리면 전체 null', () => {
    expect(quotePartsOf({ title: '추석 맞이 톤28 윷놀이 행운의 혜택', benefit: '던질수록 커지는 행운의 판', period: '9/27까지' }, Q_CHUSEOK))
      .toEqual({ title: '추석 맞이 톤28 윷놀이 행운의 혜택', benefit: '던질수록 커지는 행운의 판', period: '9/27까지' });
    // 지어낸 혜택(원문에 없음)은 그 조각만 버린다
    expect(quotePartsOf({ title: '추석 맞이 톤28 윷놀이 행운의 혜택', benefit: '최대 70% 할인', period: null }, Q_CHUSEOK))
      .toEqual({ title: '추석 맞이 톤28 윷놀이 행운의 혜택', benefit: null, period: null });
    // 제목이 원문에 없거나 너무 길면 조각 전체를 버린다(종전 동작)
    expect(quotePartsOf({ title: '추석 대축제', benefit: null, period: null }, Q_CHUSEOK)).toBeNull();
    expect(quotePartsOf({ title: Q_CHUSEOK, benefit: null, period: null }, Q_CHUSEOK)).toBeNull();
    expect(quotePartsOf(null, Q_CHUSEOK)).toBeNull();
  });
  it('filterQuoteCandidates 가 조각을 parts 로 싣는다(재대조 통과분만) · 조각 없는 AI 응답은 종전 그대로', () => {
    const now = new Date('2026-09-24T00:00:00Z');
    const home = `${Q_SIGNUP} 다른 글 ${Q_CHUSEOK}`;
    const r = filterQuoteCandidates([
      { quote: Q_CHUSEOK, title: '추석 맞이 톤28 윷놀이 행운의 혜택', benefit: '던질수록 커지는 행운의 판', period: '9/27까지', start_date: null, end_date: '2026-09-27' },
      { quote: Q_SIGNUP, start_date: null, end_date: null },
    ], { home }, { home: HOME }, now);
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0].parts).toEqual({ title: '추석 맞이 톤28 윷놀이 행운의 혜택', benefit: '던질수록 커지는 행운의 판', period: '9/27까지' });
    expect(r.candidates[0].benefitLicensed).toBe(true);
    expect(r.candidates[1].parts).toBeUndefined();
  });
  it('eventCardsOf(crawl) — 조각 제목·기간 · 본문(text)은 면허 있을 때만 혜택 · 조각 없으면 종전(인용문 제목)', () => {
    const licensed = { quote: Q_CHUSEOK, sourceUrl: HOME, startDate: null, endDate: '2026-09-27', benefitLicensed: true, origin: 'crawl' as const, parts: { title: '추석 맞이 톤28 윷놀이 행운의 혜택', benefit: '던질수록 커지는 행운의 판', period: '9/27까지' } };
    const unlicensed = { quote: Q_SIGNUP, sourceUrl: HOME, startDate: null, endDate: null, benefitLicensed: false, origin: 'crawl' as const, parts: { title: '2주동안 첫 구매 혜택', benefit: '가입 당일 1만원 할인', period: null } };
    const [a, b] = eventCardsOf([licensed, unlicensed], null);
    expect(a).toMatchObject({ title: '추석 맞이 톤28 윷놀이 행운의 혜택', periodRaw: '9/27까지', text: '던질수록 커지는 행운의 판', detailUrl: HOME, licensed: true });
    expect(b).toMatchObject({ title: '2주동안 첫 구매 혜택', periodRaw: null, licensed: false });
    expect(b.text).toBeUndefined();
    const legacy = eventCardsOf([{ ...unlicensed, parts: undefined }], null)[0];
    expect(legacy).toEqual({ title: Q_SIGNUP.slice(0, 60), periodRaw: null, endDate: null, bannerUrl: null, bannerSize: null, detailUrl: HOME, licensed: false });
  });
  it('표준 조립 행사 카드 — 제목은 괄호 설명을 빼고 30자 낱말 경계 · 본문 = 혜택 + 기간 줄 · 버튼 대체 문구는 행사형', () => {
    const base = {
      companyName: '톤28', industry: 'beauty', homepageUrl: HOME, siteTitle: null, material: '', extraNotes: null,
      benefitLicensed: false, licensedQuote: '', proof: null, posterUrl: null, posterSize: null, bannerUrl: null, bannerSize: null, posterCaption: null,
      media: null, mediaSelection: null, ctaLinks: {}, legal: null, brandColor: null, entry: 'outreach' as const, heroBanners: null, eventSlices: null,
    };
    const input = { ...base, eventCards: [
      { title: '추석 맞이 톤28 윷놀이 행운의 혜택', periodRaw: '9/27까지', endDate: '2026-09-27', bannerUrl: null, bannerSize: null, detailUrl: HOME, licensed: true, text: '던질수록 커지는 행운의 판' },
      { title: '오늘핫딜 지성두피 다시마 샴푸바 (탈모 완화 기능 인증)', periodRaw: null, endDate: null, bannerUrl: null, bannerSize: null, detailUrl: HOME, licensed: false },
    ] } as any;
    const media = { gallery: [], products: [], slices: [], imageKinds: null, logo: null, collectedAt: '', stats: {} } as any;
    const std = standardMaterialsOf(input, media)!;
    expect(std.events[0].title).toBe('추석 맞이 톤28 윷놀이 행운의 혜택');
    expect(std.events[0].text).toBe('던질수록 커지는 행운의 판');
    expect(std.events[0].periodLine).toBe('기간 9/27까지');
    // 슬라이스 없는 행사 카드 = 대체 문구가 행사형(종전 "상품 자세히 보기") · 이름형 라벨이 짧게 잘리는 것은 공용 cutAtWord 경계 문제(추가 과제)
    expect(std.events[0].ctaLabel).not.toBe('상품 자세히 보기');
    expect(['행사 자세히 보기', '추석 맞이 톤28 윷놀이 보기']).toContain(std.events[0].ctaLabel);
    expect(std.events[1].title).toBe('오늘핫딜 지성두피 다시마 샴푸바');
    const secs = composeOutreachStandard({ companyName: '톤28', logoUrl: null, channel: 'DM', hero: null, products: [], events: std.events, ctaLabel: std.ctaLabel, ctaUrl: std.ctaUrl, legal: null }) as any[];
    const card = secs.find((s) => s.id === 'so-std-event1');
    expect(card.props.headline).toBe('추석 맞이 톤28 윷놀이 행운의 혜택');
    expect(card.props.body).toBe('던질수록 커지는 행운의 판\n기간 9/27까지');
  });
  it('분석 프롬프트가 세 조각을 원문 그대로 요구하고 서버가 quotePartsOf 로 대조한다', () => {
    const jobs = src('sales-outreach-jobs.ts');
    expect(jobs).toContain('"title":"...","benefit":"...","period":"..."');
    expect(jobs).toContain('quotePartsOf(c,');
  });
});

describe('A1 포스터 헤드라인 — 업체명 숫자는 숫자 게이트 밖 · 선택 행사 전부를 순서대로', () => {
  it('posterTextOkFor — 업체명을 가린 뒤 판정(혜택어·다른 숫자는 여전히 거절)', () => {
    expect(posterTextOkFor('톤28 X 롯데월드몰 POP UP', '톤28')).toBe(true);
    expect(posterTextOkFor('추석 맞이 톤28 윷놀이 행운의 혜택', '톤28')).toBe(true);
    expect(posterTextOkFor('2주동안 첫 구매 혜택', '톤28')).toBe(false);
    expect(posterTextOkFor('톤28 최대 50% 할인', '톤28')).toBe(false);
    expect(posterTextOkFor('톤28', '톤28')).toBe(false);
  });
  it('첫 행사가 숫자로 시작하면 다음 행사 · 쪼갠 제목이 원문보다 먼저 · 모두 안 되면 업체명', () => {
    const t = buildOutreachPosterTexts({
      companyName: '톤28', industry: 'beauty', eventQuote: Q_SIGNUP,
      eventQuotes: ['2주동안 첫 구매 혜택', Q_SIGNUP, '추석 맞이 톤28 윷놀이 행운의 혜택', Q_CHUSEOK],
      products: [], siteTitle: null,
    });
    expect(t.title).toBe('추석 맞이 톤28 윷놀이 행운의 혜택');
    const none = buildOutreachPosterTexts({ companyName: '톤28', industry: 'beauty', eventQuote: Q_SIGNUP, eventQuotes: [Q_SIGNUP], products: [], siteTitle: null });
    expect(none.title).toBe('톤28');
  });
  it('부제 상품명 — 용량·판번호 낱말을 떼고 판정(펩타시카 새벽크림 2.0 50g → 펩타시카 새벽크림)', () => {
    expect(productNameForImage('펩타시카 새벽크림 2.0 50g', '톤28')).toBe('펩타시카 새벽크림');
    expect(productNameForImage('[누적 판매 200만개] 톤28 펩타이드 새벽 시카크림 병풀 광채 탄력 50g', '톤28')).toBe('톤28 펩타이드 새벽 시카크림 병풀 광채 탄력');
    expect(productNameForImage('해남404 시카크림', '톤28')).toBeNull();
    expect(productNameForImage('1+1 특가 세럼', '톤28')).toBeNull();
    const t = buildOutreachPosterTexts({ companyName: '톤28', industry: 'beauty', eventQuote: null, products: [{ name: '펩타시카 세럼 30ml' }], siteTitle: null });
    expect(t.subtitle).toBe('펩타시카 세럼');
  });
});

describe('A5 포스터 배경 — 소품 금지 · 화장품·미용 도구·다른 상품 명시 금지', () => {
  it('posterStyleHint 에 소품·화장품·미용 도구 금지가 들어 있다(상단 30% 비움은 그대로)', () => {
    const h = posterStyleHint('#2f7d5b', true, true);
    expect(h).toContain('no props');
    expect(h).toMatch(/makeup|cosmetics/);
    expect(h).toMatch(/brushes/);
    expect(h).toContain('top 30% calm');
    expect(h).not.toContain('minimal props');
  });
});

describe('A3 받는 사람에게 보이는 제목 — 업체명만 · 학습 제외는 원장 연결로', () => {
  it('DM·카탈로그 제목에 [영업] 접두가 없다', () => {
    expect(src('sales-outreach-produce.ts')).not.toContain('`[영업] ${input.companyName}`');
    expect(src('sales-outreach-catalog.ts')).not.toContain('`[영업 카탈로그] ${input.companyName}`');
    expect(src('sales-outreach-produce.ts')).toContain('title: String(input.companyName).slice(0, 200),');
    expect(src('sales-outreach-catalog.ts')).toContain('title: `${input.companyName} 카탈로그`.slice(0, 200),');
  });
  it('학습 후보 두 곳이 아웃리치 원장(dmId·catalogDmId)으로 제외한다(옛 접두 판정 유지)', () => {
    const ex = src('sales-outreach-examples.ts');
    const rs = src('reference-skeleton-promote.ts');
    for (const s of [ex, rs]) {
      expect(s).toContain("a.payload->>'catalogDmId' = d.id::text");
      expect(s).toContain("a.payload->>'dmId' = d.id::text");
      expect(s).toContain("PIPELINE_TITLE_PREFIXES = ['[플래너]', '[영업]']");
    }
  });
});

describe('A4 메일 — 시안에 행사 카드가 있으면 요약 카드를 빼고 · 없으면 종전', () => {
  const guide = getActiveStyleGuide();
  const sec = (type: string, id: string, props: any, order = 0): Section => ({ id, type, order, visible: true, props } as unknown as Section);
  const base: ProposalEmailInput = {
    companyName: '톤28', industry: 'beauty', selectedEvent: null,
    copyBody: '(광고) 톤28 소식\n{{DM_LINK}}', posterUrl: null,
    dmUrl: 'https://hlj.kr/abc', previewUrl: 'https://hanjul.ai/api/outreach/v/0123456789',
    unsubscribeNotice: '수신거부', brandSections: [sec('header', 'so-std-header', { brand_name: '톤28' }, 0)],
    subject: '제목', intro: '서두', now: new Date('2026-09-24T03:00:00Z'),
    confirmedEvents: [{ title: '추석 맞이 톤28 윷놀이 행운의 혜택', periodRaw: '9/27까지' }],
  };
  it('시안에 so-std-event 카드가 있으면 "이번 시안에 담은 소식" 0 · 없으면 1', () => {
    const withEvents = buildProposalEmailSections(guide, { ...base, brandSections: [...base.brandSections, sec('text_card', 'so-std-event1', { tag: '이벤트', headline: '추석 맞이 톤28 윷놀이 행운의 혜택' }, 1)] }) as any[];
    expect(withEvents.some((x) => x.props?.tag === guide.emailCopy.events.tag)).toBe(false);
    const without = buildProposalEmailSections(guide, base) as any[];
    expect(without.some((x) => x.props?.tag === guide.emailCopy.events.tag)).toBe(true);
  });
});

describe('A6 카탈로그 — 캡션 · 여백 · 글자 없는 사진 쪽', () => {
  it('catalogCaptionOf — 용량 낱말을 떼고 업체명은 숫자 게이트 밖 · 혜택어는 여전히 거절', () => {
    expect(catalogCaptionOf('펩타시카 새벽크림 2.0 50g', '톤28')).toBe('펩타시카 새벽크림');
    expect(catalogCaptionOf('세럼 50ml')).toBe('세럼');
    expect(catalogCaptionOf('1+1 특가 세럼')).toBeNull();
    expect(catalogCaptionOf('가'.repeat(31))).toBeNull();
  });
  it('planOutreachCatalog — 판정이 있으면 배너·상품 슬라이스만(분위기 사진 0) · 판정이 없으면 종전', () => {
    const s = (n: string) => ({ url: `https://hanjul.ai/copy/${n}.jpg`, width: 1400, height: 600, bytes: 1, srcUrl: `${HOME}/${n}.jpg` });
    const media = { gallery: [], products: [], slices: [s('sea'), s('banner')], collectedAt: '', stats: {},
      imageKinds: { 'https://hanjul.ai/copy/sea.jpg': { kind: 'photo', text: false }, 'https://hanjul.ai/copy/banner.jpg': { kind: 'banner', text: true } } } as any;
    const plan = planOutreachCatalog({ posterUrl: 'https://hanjul.ai/p.jpg', media, eventCards: [], eventSlices: null, ctaLinks: {}, homepageUrl: HOME, companyName: '톤28' });
    expect(plan.pages.map((p) => p.url)).toEqual(['https://hanjul.ai/p.jpg', 'https://hanjul.ai/copy/banner.jpg']);
    const noKinds = planOutreachCatalog({ posterUrl: 'https://hanjul.ai/p.jpg', media: { ...media, imageKinds: null }, eventCards: [], eventSlices: null, ctaLinks: {}, homepageUrl: HOME, companyName: '톤28' });
    expect(noKinds.pages).toHaveLength(3);
  });
  it('renderCatalogCardBuffer — 원본의 균일 바탕 여백을 잘라 상품을 크게(확대 상한 2배)', async () => {
    // 1000×1200 흰 바탕 가운데 100×200 초록 상품
    const product = await sharp({ create: { width: 1000, height: 1200, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite([{ input: await sharp({ create: { width: 100, height: 200, channels: 3, background: { r: 20, g: 140, b: 60 } } }).png().toBuffer(), left: 450, top: 500 }])
      .png().toBuffer();
    const out = await renderCatalogCardBuffer(product, { tint: { r: 255, g: 255, b: 255 } });
    const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
    let minX = info.width, maxX = -1;
    for (let y = 0; y < info.height; y += 4) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        if (data[i + 1] - data[i] > 60) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
      }
    }
    expect(maxX - minX).toBeGreaterThanOrEqual(190); // 여백째 contain 이면 약 85px
  });
});
