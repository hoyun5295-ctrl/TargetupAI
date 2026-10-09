// ★ 2026-10-09 AI 영업 개편(설계서 docs/2026-10-09-outreach-redesign-design.md) — R1 템플릿 판단 · R2 고정 · R3 누끼 하한 · R5 소품 문장 · R7 메일 첫 화면 · R8 상품 짝수 · R9 엑셀 두 칸
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import sharp from 'sharp';
import {
  parseTemplatePick, templateFromRank, stripScaffoldProps, focusQuoteOf, hashTemplateRank, templatePickCandidates, buildTemplateJudgePrompt,
  framePhoneCapture, OUTREACH_PHONE_FRAME, buildProposalEmailSections, OUTREACH_CUTOUT_MIN_SIDE, pickTemplate, type ProposalEmailInput,
} from '../sales-outreach-produce';
import { composeOutreachStandard } from '../sales-outreach-slices';
import { normalizeRepImageUrl, normalizeFocusHint, parseOutreachBulkRows, OUTREACH_BULK_HEADERS } from '../sales-outreach-bulk';
import { getActiveStyleGuide } from '../sales-outreach-style';
import { getTemplate, STUDIO_TEMPLATES } from '../image-studio-templates';

const OCT = new Date('2026-10-09T03:00:00Z');

describe('R1 템플릿 판단 — 후보 · 응답 해석 · 순위', () => {
  it('후보 = 업종 풀(제품·행사) 중 이번 달 맞는 것 · 뷰티 10월에 겨울·크리스마스 행사 템플릿 0', () => {
    const c = templatePickCandidates('beauty', OCT);
    expect(c.product.length).toBeGreaterThan(10);
    expect(c.product.every((t) => (t.kind ?? 'product') === 'product')).toBe(true);
    expect(c.event.every((t) => t.kind === 'event')).toBe(true);
    expect(c.event.map((t) => t.id)).not.toContain('event-season-xmaseve');
  });
  it('응답 해석 — 후보 밖 id 는 버린다 · 중복 제거 · 3개 상한 · 둘 다 비면 null', () => {
    const allowed = { product: ['p1', 'p2', 'p3', 'p4'], event: ['e1', 'e2'] };
    expect(parseTemplatePick('설명 {"product":["p2","x9","p2","p1","p3","p4"],"event":["e2"],"reason":"신제품 세럼과 맞음"}', allowed))
      .toEqual({ product: ['p2', 'p1', 'p3'], event: ['e2'], reason: '신제품 세럼과 맞음' });
    expect(parseTemplatePick('{"product":["zz"],"event":[]}', allowed)).toBeNull();
    expect(parseTemplatePick('형식 없음', allowed)).toBeNull();
  });
  it('판단 프롬프트 — 행사·상품의 숫자는 가린다(모델이 혜택형으로 오인하지 않게) · 후보 줄에 세부 카테고리·용도', () => {
    const cands = templatePickCandidates('beauty', OCT);
    const p = buildTemplateJudgePrompt({ jobId: 'j', companyName: '헤라', industry: 'beauty', eventTitles: ['가을 세일 최대 50% 할인'], productNames: ['블랙 쿠션 15g'], focusQuote: null }, cands);
    expect(p.user).toContain('가을 세일 최대 #% 할인');
    expect(p.user).toContain('블랙 쿠션 #g');
    expect(p.user).not.toMatch(/50%/);
    expect(p.user).toContain('beauty-cushion-glow | 메이크업 |');
  });
  it('해시 순위 = 서로 다른 3개 · 같은 잡은 같은 순위(결정적)', () => {
    const a = hashTemplateRank('beauty', 'job-1', 'product', OCT);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(hashTemplateRank('beauty', 'job-1', 'product', OCT)).toEqual(a);
  });
  it('R2 순위[regenSeq % 길이] — 처음 1위 · 다시 만들기 2위 · 3위 · 다시 1위 · 종류가 다르거나 사라진 id 는 건너뛰고 없으면 해시', () => {
    const products = STUDIO_TEMPLATES.filter((t) => (t.kind ?? 'product') === 'product').slice(0, 3).map((t) => t.id);
    const rank = { product: products, event: [] };
    const fb = () => pickTemplate('beauty', 'x', true, OCT);
    expect([0, 1, 2, 3].map((n) => templateFromRank(rank, 'product', n, fb).id)).toEqual([products[0], products[1], products[2], products[0]]);
    expect(templateFromRank({ product: ['없는-id', products[1]], event: [] }, 'product', 0, fb).id).toBe(products[1]);
    expect(templateFromRank(rank, 'event', 0, fb).id).toBe(fb().id);
    expect(templateFromRank(null, 'product', 0, fb).id).toBe(fb().id);
  });
});

describe('R3 · R5 이미지 원천', () => {
  it('누끼 하한 = 짧은 변 600(옛 300)', () => {
    expect(OUTREACH_CUTOUT_MIN_SIDE).toBe(600);
  });
  it('소품 문장만 지운다 — 나머지 장면 문장은 그대로 · 지울 게 전부면 원문', () => {
    const t = getTemplate('beauty-lux-dark')!;
    const out = stripScaffoldProps(t.scaffold);
    expect(out).not.toMatch(/props/i);
    expect(out).toContain('High-end department store campaign atmosphere');
    const chips = getTemplate('beauty-nail-chips')!;
    expect(stripScaffoldProps(chips.scaffold)).not.toContain('The product stands');
    expect(stripScaffoldProps('Only props here.')).toBe('Only props here.');
  });
});

describe('R9 강조 포인트 = 원문 검색어', () => {
  it('낱말이 든 원문 한 토막(줄·문장 경계 · ≤40자)만 · 못 찾으면 null · 대소문자 무시', () => {
    const text = '공식몰 단독\n신제품 블랙 쿠션 출시. 가을 한정 세트도 준비했습니다';
    expect(focusQuoteOf('블랙 쿠션', text)).toBe('신제품 블랙 쿠션 출시');
    expect(focusQuoteOf('없는 낱말', text)).toBeNull();
    expect(focusQuoteOf('a', text)).toBeNull();
    const long = `${'가'.repeat(60)}블랙쿠션${'나'.repeat(60)}`;
    const q = focusQuoteOf('블랙쿠션', long)!;
    expect(q.length).toBeLessThanOrEqual(40);
    expect(q).toContain('블랙쿠션');
    expect(long).toContain(q);
  });
  it('정규화 — 이미지 URL 은 http(s)만 · 괄호 안내문은 빈 값 · 강조 포인트 40자', () => {
    expect(normalizeRepImageUrl('www.a.co.kr/x.png')).toBe('https://www.a.co.kr/x.png');
    expect(normalizeRepImageUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeRepImageUrl('(비워도 됩니다)')).toBeNull();
    expect(normalizeFocusHint('  수분   세럼 ')).toBe('수분 세럼');
    expect(normalizeFocusHint('가'.repeat(50))).toHaveLength(40);
  });
  it('엑셀 새 두 칸 — 머리줄로 읽고 · 형식 틀린 이미지 주소는 그 칸만 비우고 경고', () => {
    const blank = ['', '', '', '', '', '', ''];
    const r = parseOutreachBulkRows([[...OUTREACH_BULK_HEADERS], ['a사', 'a.co.kr', ...blank.slice(0, 5), 'a.co.kr/p.png', '수분 세럼'], ['b사', 'b.co.kr', ...blank.slice(0, 5), 'ftp://x', '']]);
    expect(r.rows[0]).toMatchObject({ repImageUrl: 'https://a.co.kr/p.png', focusHint: '수분 세럼' });
    expect(r.rows[1]).toMatchObject({ repImageUrl: null, focusHint: null });
    expect(r.warnings.some((w) => w.line === 3 && w.reason.includes('대표 상품 이미지'))).toBe(true);
  });
});

describe('R8 상품 블록 — 1개 = 없음 · 2개 이상 = 짝수', () => {
  const p = (n: number) => ({ name: `상품${n}`, image_url: `https://hanjul.ai/p${n}.jpg`, link_url: `https://a.co.kr/${n}`, price: null, discount_price: null });
  const base = { companyName: '브랜드', logoUrl: null, channel: 'DM' as const, hero: null, events: [], ctaLabel: '바로가기', ctaUrl: 'https://a.co.kr', legal: null };
  const count = (n: number) => {
    const s = composeOutreachStandard({ ...base, products: Array.from({ length: n }, (_, i) => p(i)) });
    const pc = s.find((x) => x.type === 'product_carousel') as any;
    return pc ? pc.props.products.length : 0;
  };
  it('1 → 0 · 2 → 2 · 3 → 2 · 5 → 4 · 6 → 6 · 7 → 6', () => {
    expect([1, 2, 3, 5, 6, 7].map(count)).toEqual([0, 2, 2, 4, 6, 6]);
  });
});

describe('R7 메일 첫 화면 — 휴대폰 틀 · 브랜드 히어로 대체 글자', () => {
  const guide = getActiveStyleGuide();
  const sec = (type: string, props: any, order: number, id?: string) => ({ id: id || `b-${order}`, type, order, visible: true, props } as any);
  const base: ProposalEmailInput = {
    companyName: '헤라', industry: 'beauty', selectedEvent: null, copyBody: '(광고) 헤라 소식 {{DM_LINK}}', posterUrl: null,
    dmUrl: 'https://hlj.kr/abc', previewUrl: 'https://hanjul.ai/api/outreach/v/0123456789', unsubscribeNotice: '수신거부',
    brandSections: [sec('header', { brand_name: '헤라' }, 0), sec('gallery', { images: [{ url: 'https://hanjul.ai/hero.jpg', link_url: 'https://hera.com', caption: '' }, { url: 'https://hanjul.ai/2.jpg', caption: '' }] }, 1, 'so-std-hero-poster'), sec('product_carousel', { products: [] }, 2)],
    subject: 's', intro: '서두입니다.', now: new Date('2026-10-09T03:00:00Z'), dmFrameUrl: 'https://hanjul.ai/frame.jpg',
  };
  it('순서 = 발신 머리 · 헤드라인 · 브랜드 머리 · 히어로 1장(대체 글자) · 휴대폰 틀(DM 링크) · [DM 열어보기] · 서두 · 상품 블록 0', () => {
    const s = buildProposalEmailSections(guide, base) as any[];
    expect(s.slice(0, 7).map((x) => x.type)).toEqual(['header', 'text_card', 'header', 'gallery', 'gallery', 'cta', 'text_card']);
    expect(s[3].props.images).toEqual([{ url: 'https://hanjul.ai/hero.jpg', link_url: 'https://hera.com', caption: guide.emailCopy.alt.hero('헤라') }]);
    expect(s[4].props.images[0]).toEqual({ url: 'https://hanjul.ai/frame.jpg', link_url: base.dmUrl, caption: guide.emailCopy.alt.dmFrame('헤라') });
    expect(s.some((x) => x.type === 'product_carousel')).toBe(false);
    expect(s.every((x, i) => x.order === i)).toBe(true);
  });
  it('틀 사본이 없으면 그 칸만 생략', () => {
    const s = buildProposalEmailSections(guide, { ...base, dmFrameUrl: null }) as any[];
    expect(s.slice(0, 5).map((x) => x.type)).toEqual(['header', 'text_card', 'header', 'gallery', 'cta']);
  });
  it('framePhoneCapture — 600폭 JPEG · 높이 = 화면 + 테두리 + 위아래 여백', async () => {
    const cap = await sharp({ create: { width: 375, height: 900, channels: 3, background: '#ff0000' } }).jpeg().toBuffer();
    const out = await framePhoneCapture(cap);
    const meta = await sharp(out).metadata();
    const F = OUTREACH_PHONE_FRAME;
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(F.width);
    expect(meta.height).toBe(F.screenH + F.bezel * 2 + F.pad * 2);
  });
});
