/**
 * campaign-customer-fill.test.ts · AI 자동제작(고객 입구) 전용 채우기 (2026-09-15 품질 설계 · Harold "떠먹여 주는데 왜 퀄리티가 저 모양이냐")
 *  사용자가 올린 재료(행사 카드 제목·본문·사진·링크 · 몰 상품)가 모델 출력과 상관없이 전부 제자리에 선다.
 *  ★ 적대 검토 0915: 채우기가 차단기와 같은 판정으로 구조를 정한다(태그만 남은 카드 0 · 빈 부제 0 · 가격 없는 상품 0 · 쿠폰 칩 자리 확보).
 *  아웃리치 채우기(V3)는 바꾸지 않는다(골든 campaign-engine.test.ts · sales-outreach-v3.test.ts 그대로).
 * DB·AI·네트워크 0.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import { fillCustomerStandard, customerFillNotes, customerEngineDeps, keepLastCtaBar, licensedPreheaderOf, CUSTOMER_SECTION_MAX } from '../campaign-customer-fill';
import { assembleDmCampaign, type EngineMaterials, type EngineOptions } from '../campaign-engine';
import { headlineFromCard, applyDmFeatures, OUTREACH_SECTION_MAX } from '../sales-outreach-produce';
import type { Section } from '../dm/dm-section-registry';

const C = '/api/dm/v/images/c/';
const img = (name: string, width: number, height: number, group: string) => ({ url: C + name, width, height, group });
const sec = (type: string, props: Record<string, unknown>, i: number): Section => ({ id: `m-${i}-${type}`, type, order: i, visible: true, props } as unknown as Section);

/** 모델이 낸 것으로 치는 구성 · 빈 text_card 1 · 세 칸이 찬 마무리 카드 1 · 쿠폰 · 모델 날짜 카운트다운 · 모델 버튼 */
const MODEL: Section[] = [
  sec('header', {}, 0),
  sec('hero', { headline: '모델 헤드라인', sub_copy: '모델 부제' }, 1),
  sec('text_card', { tag: '', headline: '', body: '' }, 2),
  sec('text_card', { tag: '브랜드', headline: '모델 마무리', body: '모델이 쓴 마무리 문장' }, 3),
  sec('coupon', { discount_label: '모델 쿠폰' }, 4),
  sec('countdown', { end_datetime: '2099-01-01T00:00:00' }, 5),
  sec('cta', { buttons: [{ label: '모델 버튼' }] }, 6),
  sec('footer', {}, 7),
];
const model = () => MODEL.map((s) => ({ ...s, props: { ...(s.props as any) } }) as Section);
const OPTS: EngineOptions = { entry: 'customer', channel: 'DM', skeletonTypes: null, sectionOverride: null, presetSections: null, layoutMode: 'scroll' };
function engineDeps() {
  const deps = customerEngineDeps();
  deps.generate = async () => ({ sections: model(), exemplars: { picked: 0, total: 0 } });
  return deps;
}

function mats(over: Partial<EngineMaterials> = {}): EngineMaterials {
  return {
    companyName: '헤라', industry: 'beauty', homepageUrl: 'https://shop.example/e1', siteTitle: null, material: '', extraNotes: null,
    products: [],
    gallery: [img('c1a.jpg', 1080, 1080, 'c1'), img('c1b.jpg', 1080, 1350, 'c1'), img('c2a.jpg', 1080, 1350, 'c2')],
    logoUrl: null, posterUrl: null, posterSize: null, bannerUrl: null, bannerSize: null,
    ctaLinks: { c1: 'https://shop.example/e1' }, legal: null, licensedQuote: '', proof: null,
    eventCards: [
      { title: '헤라 립틴트', periodRaw: null, endDate: null, bannerUrl: C + 'c1a.jpg', bannerSize: { width: 1080, height: 1080 }, detailUrl: 'https://shop.example/e1', licensed: false, group: 'c1', text: '촉촉한 발색의 신상 립틴트\n전 제품 30% 할인\n9월 한정 컬러' },
      { title: '립틴트', periodRaw: null, endDate: null, bannerUrl: C + 'c2a.jpg', bannerSize: { width: 1080, height: 1350 }, detailUrl: null, licensed: false, group: 'c2', text: '가을 한정 컬러 출시' },
    ],
    ...over,
  };
}
const types = (s: readonly Section[]) => s.map((x) => String(x.type));
const P = (s: Section | undefined): any => (s ? (s.props as any) || {} : {});
const ctaUrls = (s: readonly Section[]) => s.filter((x) => x.type === 'cta').flatMap((x) => (P(x).buttons || []).map((b: any) => String(b.url)));
const imageUrls = (s: readonly Section[]) => s.flatMap((x) => [P(x).image_url, ...((P(x).images || []) as any[]).map((i) => i?.url)]).filter((u): u is string => typeof u === 'string' && !!u);
const product = (n: number) => ({ name: `상품 ${n}`, price: 30000, discount_price: 24000, image_url: `https://shop.example/p${n}.jpg`, link_url: `https://shop.example/p${n}` });
/** 태그만 남은(제목·본문·사진 없는) 글자 카드 */
const tagOnlyCards = (s: readonly Section[]) => s.filter((x) => x.type === 'text_card' && !String(P(x).headline || '').trim() && !String(P(x).body || '').trim() && !P(x).image_url);

describe('fillCustomerStandard · 사용자 재료가 먼저 자리를 잡는다', () => {
  it('DM 기본 순서: header → hero(카드1 사진·제목·첫 줄) → 카드1 본문 카드 → 카드1 갤러리 → 카드1 버튼 → 카드2 → 모델 마무리 → footer', () => {
    const r = fillCustomerStandard(model(), mats(), 'DM');
    expect(types(r.sections)).toEqual(['header', 'hero', 'text_card', 'gallery', 'cta', 'text_card', 'text_card', 'footer']);
    const hero = P(r.sections[1]);
    expect(hero.image_url).toBe(C + 'c1a.jpg');
    expect(hero.headline).toBe('헤라 립틴트');
    expect(hero.sub_copy).toBe('촉촉한 발색의 신상 립틴트');
    expect(P(r.sections[0]).brand_name).toBe('헤라');
  });
  it('카드1 본문은 줄을 살려 싣고 히어로 제목·부제를 반복하지 않는다', () => {
    const r = fillCustomerStandard(model(), mats(), 'DM');
    const body = P(r.sections[2]);
    expect(body.headline).toBe('');
    expect(body.body).toBe('전 제품 30% 할인\n9월 한정 컬러');
    expect(body.image_url).toBeUndefined();
    expect(String(body.tag || '').length).toBeGreaterThan(0);
  });
  it('엔진 차단기를 지나도 면허 없는 30% 줄만 빠지고 나머지 줄은 남는다 · 태그만 남은 카드 0', async () => {
    const r = await assembleDmCampaign(mats(), OPTS, engineDeps());
    const cardBodies = r.sections.filter((s) => s.type === 'text_card').map((s) => String(P(s).body || ''));
    expect(cardBodies.join('\n')).toContain('9월 한정 컬러');
    expect(cardBodies.join('\n')).not.toContain('30%');
    expect(r.benefitStripped).toBeGreaterThanOrEqual(1);
    expect(tagOnlyCards(r.sections)).toHaveLength(0);
  });
  it('빈 모델 text_card · 모델 쿠폰 · 모델 날짜 카운트다운은 싣지 않는다', () => {
    const r = fillCustomerStandard(model(), mats(), 'DM');
    expect(types(r.sections)).not.toContain('coupon');
    expect(types(r.sections)).not.toContain('countdown');
    expect(tagOnlyCards(r.sections).filter((s) => !P(s).tag)).toHaveLength(0);
  });
  it('짧은 제목(3자)도 카드가 남는다 · 링크 없는 카드에는 버튼이 없고 다른 카드 링크를 빌리지 않는다', () => {
    const r = fillCustomerStandard(model(), mats(), 'DM');
    const card2 = r.sections.find((s) => s.type === 'text_card' && P(s).headline === '립틴트');
    expect(card2).toBeTruthy();
    expect(P(card2).image_url).toBe(C + 'c2a.jpg');
    expect(P(card2).body).toBe('가을 한정 컬러 출시');
    expect(ctaUrls(r.sections)).toEqual(['https://shop.example/e1']);
  });
  it('같은 사진은 두 번 싣지 않는다', () => {
    const r = fillCustomerStandard(model(), mats(), 'DM');
    const urls = imageUrls(r.sections);
    expect(new Set(urls).size).toBe(urls.length);
  });
  it('카드1 사진이 모두 세로형이면 히어로는 글자형이고 카드1 사진은 본문 카드 위에 선다', () => {
    // 1080×1350(0.8)은 히어로 하한(0.8 이상)을 통과하므로 세로형 표본은 1080×1920(0.56)으로 둔다
    const m = mats({ gallery: [img('c1a.jpg', 1080, 1920, 'c1'), img('c1b.jpg', 1080, 1920, 'c1'), img('c2a.jpg', 1080, 1350, 'c2')] });
    m.eventCards![0] = { ...m.eventCards![0], bannerSize: { width: 1080, height: 1920 } };
    const r = fillCustomerStandard(model(), m, 'DM');
    const hero = P(r.sections.find((s) => s.type === 'hero'));
    expect(hero.image_url).toBeFalsy();
    expect(hero.headline).toBe('헤라 립틴트');
    const body = P(r.sections[2]);
    expect(body.image_url).toBe(C + 'c1a.jpg');
    expect(body.body).toBe('전 제품 30% 할인\n9월 한정 컬러');
  });
  it('로고 비율(3:1 이상) 사진은 히어로가 되지 않는다', () => {
    const m = mats({ gallery: [img('logo.png', 1500, 400, 'c1'), img('c1a.jpg', 1080, 1080, 'c1'), img('c2a.jpg', 1080, 1350, 'c2')] });
    m.eventCards![0] = { ...m.eventCards![0], bannerUrl: C + 'logo.png', bannerSize: { width: 1500, height: 400 } };
    const r = fillCustomerStandard(model(), m, 'DM');
    expect(P(r.sections.find((s) => s.type === 'hero')).image_url).toBe(C + 'c1a.jpg');
  });
  it('카드 3장: 카드3 제목·본문·사진·버튼이 실린다', () => {
    const m = mats({
      gallery: [...mats().gallery, img('c3a.jpg', 1200, 800, 'c3')],
      ctaLinks: { c1: 'https://shop.example/e1', c3: 'https://shop.example/e3' },
    });
    m.eventCards!.push({ title: '가을 세트', periodRaw: null, endDate: null, bannerUrl: C + 'c3a.jpg', bannerSize: { width: 1200, height: 800 }, detailUrl: 'https://shop.example/e3', licensed: false, group: 'c3', text: '세트 구성 안내' });
    const r = fillCustomerStandard(model(), m, 'DM');
    const card3 = r.sections.find((s) => s.type === 'text_card' && P(s).headline === '가을 세트');
    expect(P(card3).image_url).toBe(C + 'c3a.jpg');
    expect(P(card3).body).toBe('세트 구성 안내');
    expect(ctaUrls(r.sections)).toContain('https://shop.example/e3');
  });
  it('제목이 비어 기본값(행사 N)인 카드는 본문 첫 줄이 제목이 된다', () => {
    const m = mats();
    m.eventCards![1] = { ...m.eventCards![1], title: '행사 2', text: '가을 한정 컬러 출시\n두 가지 색상' };
    const r = fillCustomerStandard(model(), m, 'DM');
    const card2 = r.sections.find((s) => s.type === 'text_card' && P(s).image_url === C + 'c2a.jpg');
    expect(P(card2).headline).toBe('가을 한정 컬러 출시');
    expect(P(card2).body).toBe('두 가지 색상');
  });
});

describe('fillCustomerStandard · 차단기와 같은 판정으로 구조를 정한다(적대 검토 0915)', () => {
  it('본문 줄이 전부 면허 없는 수치면 태그만 남는 본문 카드를 만들지 않는다(엔진 통과 뒤에도 0)', async () => {
    const m = mats();
    m.eventCards![0] = { ...m.eventCards![0], text: '신상 립틴트 출시\n전 제품 30% 할인' };
    const r = fillCustomerStandard(model(), m, 'DM');
    expect(P(r.sections[1]).sub_copy).toBe('신상 립틴트 출시');
    expect(types(r.sections).slice(0, 4)).toEqual(['header', 'hero', 'gallery', 'cta']);
    const e = await assembleDmCampaign(m, OPTS, engineDeps());
    expect(tagOnlyCards(e.sections)).toHaveLength(0);
  });
  it('한 문단으로 쓴 긴 본문은 부제로 자르지 않고 본문 카드에 통째로 싣는다', () => {
    const long = '가을 한정 립틴트 컬렉션이 새로 나왔습니다 매장과 온라인에서 모두 만나실 수 있고 네 가지 색상으로 준비했습니다 지금 바로 확인해 보세요';
    const m = mats();
    m.eventCards![0] = { ...m.eventCards![0], text: long };
    const r = fillCustomerStandard(model(), m, 'DM');
    expect(P(r.sections[1]).sub_copy).toBe('모델 부제');
    expect(P(r.sections[2]).body).toBe(long);
  });
  it('수치가 든 첫 줄은 부제로 쓰지 않는다 · 그 줄은 본문 카드로 가서 차단기가 문장 단위로 걷는다', async () => {
    const m = mats();
    m.eventCards![0] = { ...m.eventCards![0], text: '전 제품 30% 할인\n촉촉한 발색' };
    const r = fillCustomerStandard(model(), m, 'DM');
    expect(P(r.sections[1]).sub_copy).toBe('모델 부제');
    expect(P(r.sections[2]).body).toBe('전 제품 30% 할인\n촉촉한 발색');
    const e = await assembleDmCampaign(m, OPTS, engineDeps());
    const bodies = e.sections.filter((s) => s.type === 'text_card').map((s) => String(P(s).body || '')).join('\n');
    expect(bodies).toContain('촉촉한 발색');
    expect(bodies).not.toContain('30%');
  });
  it('헤드라인이 18자로 잘린 첫 줄은 본문에서 빼지 않는다(사용자 글 유실 0)', () => {
    const line = '가을 한정 립틴트 컬렉션이 새로 나왔습니다';
    const m = mats();
    m.eventCards![1] = { ...m.eventCards![1], title: '행사 2', text: line };
    const r = fillCustomerStandard(model(), m, 'DM');
    const card2 = r.sections.find((s) => s.type === 'text_card' && P(s).image_url === C + 'c2a.jpg');
    expect(String(P(card2).headline).length).toBeLessThan(line.length);
    expect(P(card2).body).toBe(line);
  });
  it('상품 1개 = 상품 1개짜리 상품 슬라이드 + 버튼 · 엔진 차단기를 지나도 가격이 남는다', async () => {
    const m = mats({ products: [product(1)] as any });
    const r = fillCustomerStandard(model(), m, 'DM');
    const car = r.sections.filter((s) => s.type === 'product_carousel');
    expect(car).toHaveLength(1);
    expect(P(car[0]).products).toHaveLength(1);
    expect(ctaUrls(r.sections)).toContain('https://shop.example/p1');
    const e = await assembleDmCampaign(m, OPTS, engineDeps());
    const item = P(e.sections.find((s) => s.type === 'product_carousel')).products[0];
    expect(item).toMatchObject({ price: 30000, discount_price: 24000 });
  });
  it('상한은 쿠폰 칩 상한보다 1 작다 · 가득 찬 구성에서도 켠 쿠폰이 들어간다', async () => {
    expect(CUSTOMER_SECTION_MAX).toBe(OUTREACH_SECTION_MAX - 1);
    const g = (c: string, n: number) => Array.from({ length: n }, (_, i) => img(`${c}${i}.jpg`, 1200, 800, c));
    const m = mats({
      gallery: [...g('c1', 3), ...g('c2', 3), ...g('c3', 3)],
      ctaLinks: { c1: 'https://shop.example/e1', c2: 'https://shop.example/e2', c3: 'https://shop.example/e3' },
      products: Array.from({ length: 8 }, (_, i) => product(i + 1)) as any,
      licensedQuote: '전 제품 10% 할인 · 첫째 줄',
    });
    m.eventCards = [
      { title: '첫째 행사 안내', periodRaw: null, endDate: '2099-12-31', bannerUrl: C + 'c10.jpg', bannerSize: { width: 1200, height: 800 }, detailUrl: 'https://shop.example/e1', licensed: true, group: 'c1', text: '첫째 줄\n둘째 줄' },
      { title: '둘째 행사 안내', periodRaw: null, endDate: null, bannerUrl: C + 'c20.jpg', bannerSize: { width: 1200, height: 800 }, detailUrl: 'https://shop.example/e2', licensed: false, group: 'c2', text: '둘째 카드 본문' },
      { title: '셋째 행사 안내', periodRaw: null, endDate: null, bannerUrl: C + 'c30.jpg', bannerSize: { width: 1200, height: 800 }, detailUrl: 'https://shop.example/e3', licensed: false, group: 'c3', text: '셋째 카드 본문' },
    ];
    const r = fillCustomerStandard(model(), m, 'DM');
    expect(r.sections.length).toBeLessThanOrEqual(CUSTOMER_SECTION_MAX);
    expect(r.sections.some((s) => P(s).headline === '셋째 행사 안내')).toBe(true);
    expect(r.sections.some((s) => P(s).headline === '모델 마무리')).toBe(false);
    expect(types(r.sections)).toContain('countdown');
    expect(customerFillNotes(m, 'DM').some((n) => n.includes('사진') && n.includes('자리가 없어'))).toBe(true);
    // 상한 절단이 둘째 상품 묶음(6개)을 뺐으면 사유 문장도 실제 결과 기준으로 6개를 말한다(2라운드 검토)
    expect(customerFillNotes(m, 'DM')).toContain('상품 6개는 자리가 없어 넣지 않았어요');
    const e = await assembleDmCampaign(m, { ...OPTS, features: ['coupon', 'gallery', 'product_carousel', 'countdown'] }, engineDeps());
    expect(e.features.applied).toContain('coupon');
  });
  it('제목·본문이 차단기에 모두 지워지는 사진 없는 카드2는 싣지 않는다 · 링크 사유 문장도 붙이지 않는다(2라운드 검토)', async () => {
    for (const title of ['행사 2', '가을 할인전']) {
      const m = mats({ gallery: [img('c1a.jpg', 1080, 1080, 'c1'), img('c1b.jpg', 1080, 1350, 'c1')] });
      m.eventCards![1] = { ...m.eventCards![1], title, text: '가을 전 품목 40% 할인', bannerUrl: null, bannerSize: null };
      const r = fillCustomerStandard(model(), m, 'DM');
      expect(r.sections.filter((s) => s.type === 'text_card' && String(P(s).body || '').includes('40%'))).toHaveLength(0);
      expect(customerFillNotes(m, 'DM').join(' ')).not.toContain('할인');
      const e = await assembleDmCampaign(m, OPTS, engineDeps());
      expect(tagOnlyCards(e.sections)).toHaveLength(0);
    }
  });
  it('줄마다는 남아도 이어 붙인 본문 전체가 차단기에 지워지면 본문 카드를 만들지 않는다(빈 줄로 떨어진 면허 조각 · 2라운드 검토)', async () => {
    const text = '신상 출시\n회원 적립\n\n\n10% 할인';
    const m = mats({ licensedQuote: text });
    m.eventCards![0] = { ...m.eventCards![0], licensed: true, text };
    const r = fillCustomerStandard(model(), m, 'DM');
    expect(types(r.sections).slice(0, 4)).toEqual(['header', 'hero', 'gallery', 'cta']);
    const e = await assembleDmCampaign(m, OPTS, engineDeps());
    expect(tagOnlyCards(e.sections)).toHaveLength(0);
  });
  it('상품 칩 미반영 사유는 상품 1개부터 슬라이드를 만드는 채우기 규칙과 같다(2개 문구 0 · 2라운드 검토)', () => {
    const r = applyDmFeatures([], ['product_carousel'], { licensedQuote: '' });
    expect(r.skipped[0].reason).not.toContain('2개');
  });
  it('customerFillNotes: 링크 없는 카드는 사유 문장 · 실을 것이 없어 빠진 카드에는 붙이지 않는다', () => {
    expect(customerFillNotes(mats(), 'DM').some((n) => n.includes('립틴트') && n.includes('링크'))).toBe(true);
    const m = mats({ gallery: [img('c1a.jpg', 1080, 1080, 'c1')] });
    m.eventCards![1] = { title: '행사 2', periodRaw: null, endDate: null, bannerUrl: null, bannerSize: null, detailUrl: null, licensed: false, group: 'c2', text: '' };
    expect(customerFillNotes(m, 'DM').some((n) => n.includes('"행사"'))).toBe(false);
    expect(fillCustomerStandard(model(), m, 'DM').sections.filter((s) => s.type === 'text_card' && P(s).headline === '')).toHaveLength(1);
  });
});

describe('fillCustomerStandard · 상품 · 카운트다운 · 링크 · 이메일', () => {
  it('상품 8개: DM = 2 + 6 · 이메일 = 2 + 4 · 넘친 개수는 사유 문장', () => {
    const products = Array.from({ length: 8 }, (_, i) => product(i + 1)) as any;
    const dm = fillCustomerStandard(model(), mats({ products }), 'DM');
    expect(dm.sections.filter((s) => s.type === 'product_carousel').map((s) => P(s).products.length)).toEqual([2, 6]);
    expect(P(dm.sections.find((s) => s.type === 'product_carousel')).products[0]).toMatchObject({ price: 30000, discount_price: 24000 });
    const email = fillCustomerStandard(model(), mats({ products }), 'EMAIL');
    expect(email.sections.filter((s) => s.type === 'product_carousel').map((s) => P(s).products.length)).toEqual([2, 4]);
    expect(customerFillNotes(mats({ products }), 'EMAIL').join(' ')).toContain('상품 2개');
    expect(customerFillNotes(mats({ products }), 'DM').join(' ')).not.toContain('상품 ');
  });
  it('카운트다운은 면허 카드의 미래 종료일로만 · DM 만', () => {
    const m = mats();
    m.eventCards![0] = { ...m.eventCards![0], licensed: true, endDate: '2099-12-31' };
    const dm = fillCustomerStandard(model(), m, 'DM');
    const cd = dm.sections.find((s) => s.type === 'countdown');
    expect(P(cd).end_datetime).toBe('2099-12-31T23:59:59');
    expect(types(fillCustomerStandard(model(), m, 'EMAIL').sections)).not.toContain('countdown');
  });
  it('링크가 하나도 없으면 빈 주소 버튼 1개만(발행 전 입력 요구)', () => {
    const m = mats({ ctaLinks: {}, homepageUrl: '' });
    m.eventCards![0] = { ...m.eventCards![0], detailUrl: null };
    const r = fillCustomerStandard(model(), m, 'DM');
    expect(ctaUrls(r.sections)).toEqual(['']);
  });
  it('이메일: 헤더 왼쪽 정렬 · 버튼 라벨 8자 이하', () => {
    const r = fillCustomerStandard(model(), mats(), 'EMAIL');
    expect(P(r.sections[0]).align).toBe('left');
    const labels = r.sections.filter((s) => s.type === 'cta').flatMap((s) => (P(s).buttons || []).map((b: any) => String(b.label)));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => l.length <= 8)).toBe(true);
  });
});

describe('호출부 후처리 순수 함수 · 공용 함수 기본값', () => {
  it('keepLastCtaBar: 마지막 cta 만 bar 로 두고 앞 cta 의 bar·tint 를 뗀다', () => {
    const cta = (i: number) => ({ id: `c${i}`, type: 'cta', order: i, visible: true, treatment: 'bar', background: 'tint', props: { buttons: [{ label: '보기', url: `https://x/${i}` }] } }) as unknown as Section;
    const out = keepLastCtaBar([cta(0), sec('text_card', { body: 'x' }, 1), cta(2), cta(3)]);
    const ctas = out.filter((s) => s.type === 'cta') as any[];
    expect(ctas.map((s) => s.treatment)).toEqual([undefined, undefined, 'bar']);
    expect(ctas.slice(0, 2).map((s) => s.background)).toEqual([undefined, undefined]);
    expect(out).toHaveLength(4);
  });
  it('licensedPreheaderOf: 면허 밖 혜택 수치가 든 프리헤더는 비우고 · 면허 안이거나 수치가 없으면 그대로', () => {
    expect(licensedPreheaderOf('전 제품 30% 할인 중', '')).toBe('');
    expect(licensedPreheaderOf('전 제품 30% 할인 중', '전 제품 30% 할인')).toBe('전 제품 30% 할인 중');
    expect(licensedPreheaderOf('가을 한정 컬러를 만나 보세요', '')).toBe('가을 한정 컬러를 만나 보세요');
    expect(licensedPreheaderOf(null, '')).toBe('');
  });
  it('headlineFromCard 기본 하한(6자)은 그대로 · 세 번째 인자로 고객 입구만 낮춘다', () => {
    expect(headlineFromCard({ title: '립틴트' }, false).demoted).toBe(true);
    expect(headlineFromCard({ title: '립틴트' }, false, 2)).toEqual({ headline: '립틴트', demoted: false });
    expect(headlineFromCard({ title: '최대 50%' }, false, 2).demoted).toBe(true);
  });
});
