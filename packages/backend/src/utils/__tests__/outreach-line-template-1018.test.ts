/**
 * ★ 2026-10-18 AI 영업 템플릿 이식 계약 테스트
 * 설계서 = docs/2026-10-18-outreach-line-template-design.md
 *
 * 1단계 = 재료가 고를 수 있는 템플릿을 거른다(면허 혜택 · 세일 말 · 상품 · 신상 말) · 혜택 = 면허 카드 제목 원문(30자 넘으면 없음) ·
 *         표지 그림은 덮지 않는다 · 행사 목록 장(버튼 0 · 같은 그림 0) · 법정 표기 푸터 · 실패 = 지금 표준 조립 · 스위치 끄면 지금 그대로.
 * 2단계 = AI 가 페이지 글 · 업종을 읽고 템플릿 하나와 칸마다 문구 번호를 고른다(문구를 쓰지 않는다 · 묶음 = 검증된 고정 문구) · AI 실패 = 규칙.
 * 섹션 id = 부분(학습 레시피 · 판정 카드 출처).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
const aiMock = vi.fn();
vi.mock('../../services/ai', () => ({ callAIWithFallback: (...args: any[]) => aiMock(...args) }));

import {
  outreachLineTemplatesEnabled, outreachBenefitOf, outreachLineMaterials, eligibleOutreachTemplates, outreachSignalOf,
  buildOutreachPickPrompt, parseOutreachPick, pickOutreachLineTemplate, outreachCopyOf, outreachFillsOf,
  composeOutreachTemplate, outreachLineTemplateRecordOf, outreachTemplateIds, outreachLostEvents, outreachLineTemplateRecipe, OUTREACH_BENEFIT_MAX,
  outreachBestOf, outreachBestHint, outreachRuleOf, OUTREACH_BEST_MIN,
  type OutreachLineInput, type OutreachStdLike, type OutreachLineTemplateRecord,
} from '../line-template-outreach';
import { OUTREACH_COPY_BANK, outreachToneOf, outreachBankText, outreachToneIndustries } from '../line-template-outreach-bank';
import { listOutreachRecipeTemplates, insertOutreachRecipe, invalidateOutreachRecipeTemplateCache } from '../best-copy-assets';
import pool from '../../config/database';
import { lineTemplateGate } from '../line-template-compose';
import { getLineTemplate, LINE_TEMPLATE_IDS, type LineCopyKey } from '../design-core/line-templates';
import { findBenefitSpans } from '../copy-benefit-detector';
import { assembleOutreachDm, produceOutreachBrandEmail } from '../sales-outreach-produce';
import { buildOutreachRecipe } from '../sales-outreach-jobs';
import { cardHeroOf } from '../sales-outreach-direct-jobs';
import { renderDmViewerHtml } from '../dm/dm-viewer';
import { renderEmailSections } from '../email/email-section-renderer';

const NOW = Date.parse('2026-10-18T03:00:00Z');   // KST 2026-10-18 12:00
const HOME = 'https://shop.example';
const content = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
const imgs = (html: string) => Array.from(content(html).matchAll(/<img[^>]+src="([^"]+)"/g)).map((m) => m[1].split('?')[0]);
const PH = /추가해주세요|직접 작성|직접 입력|입력해주세요|\[URL|자세히 보기|dm-mood-slot/;

const input = (over: Partial<OutreachLineInput> = {}): OutreachLineInput => ({
  companyName: '테스트몰', siteTitle: '테스트몰 공식몰 2026', industry: 'beauty',
  logoUrl: null, legal: { legal: '(주)테스트몰 · 사업자등록번호 000-00-00000', csPhone: '1588-0000' },
  eventCards: [], primary: '#1f2937', shopUrl: `${HOME}/shop`, ...over,
});
const std = (over: Partial<OutreachStdLike> = {}): OutreachStdLike => ({
  hero: { url: '/api/dm/v/images/c/poster.jpg', kind: 'poster', linkUrl: `${HOME}/event/1` },
  products: [
    { name: '글로우 크림', image_url: '/api/dm/v/images/c/p1.jpg', link_url: `${HOME}/p/1`, price: 32000, discount_price: 25600 },
    { name: '수분 세럼', image_url: '/api/dm/v/images/c/p2.jpg', link_url: `${HOME}/p/2`, price: 0, discount_price: null },
  ],
  events: [
    { title: '가을 세일', periodLine: '10.18 ~ 10.31', imageUrl: '/api/dm/v/images/c/e1.jpg', linkUrl: `${HOME}/event/1`, slices: [{ url: '/api/dm/v/images/c/s1.jpg' }, { url: '/api/dm/v/images/c/p1.jpg' }] },
    { title: '신규 가입 혜택', periodLine: '', imageUrl: '/api/dm/v/images/c/e2.jpg', linkUrl: `${HOME}/event/2` },
  ],
  ctaUrl: `${HOME}/event/2`,
  ...over,
});
const saleCard = { title: '가을 세일 최대 20% 할인', endDate: '2026-10-31', licensed: true };
const rule = (id: OutreachLineTemplateRecord['id'], copy: OutreachLineTemplateRecord['copy'] = {}): OutreachLineTemplateRecord => ({ id, reasons: [], by: 'rule', copy });
const textsOf = (sections: readonly any[]): string[] => sections.flatMap((s) => {
  const p: any = s.props || {};
  return [p.headline, p.body, p.sub_copy, p.title, p.tag, p.discount_label, ...(p.buttons || []).map((b: any) => b.label), ...(p.images || []).map((i: any) => i.caption)]
    .filter((x) => typeof x === 'string' && x).flatMap((x: string) => x.split('\n').filter(Boolean));
});

const filledBank = (id: OutreachLineTemplateRecord['id'], companyName = '테스트몰', product = '글로우 크림'): Set<string> => new Set(
  (Object.entries(OUTREACH_COPY_BANK[id]) as Array<[LineCopyKey, any[]]>).flatMap(([key, list]) => {
    const max = getLineTemplate(id)!.copy.find((f) => f.key === key)!.max;
    return list.map((l) => outreachBankText(l, { brand: companyName, product }, max)).filter((x): x is string => !!x);
  }),
);

describe('1단계 — 스위치 · 혜택 · 재료 · 자격', () => {
  it('스위치 = 1 · true · on 만(빈 값 · 0 = 꺼짐)', () => {
    expect(outreachLineTemplatesEnabled('1')).toBe(true);
    expect(outreachLineTemplatesEnabled('on')).toBe(true);
    expect(outreachLineTemplatesEnabled('')).toBe(false);
    expect(outreachLineTemplatesEnabled('0')).toBe(false);
    expect(outreachLineTemplatesEnabled(undefined)).toBe(false);
  });

  it('혜택 = 첫 면허 카드 제목 원문 · 30자 넘으면 없음(자르지 않는다) · 면허 없으면 0 · 마감 = 유효한 날짜만 · 조건 글 = 그 카드 본문 원문', () => {
    expect(outreachBenefitOf([saleCard], NOW)).toEqual({ benefit: '가을 세일 최대 20% 할인', periodEnd: '2026-10-31', note: null, index: 0 });
    expect(outreachBenefitOf([{ ...saleCard, licensed: false }], NOW)).toMatchObject({ benefit: null, periodEnd: null, index: -1 });
    expect(outreachBenefitOf([{ ...saleCard, title: 'ㄱ'.repeat(OUTREACH_BENEFIT_MAX + 1) }], NOW).benefit).toBeNull();
    expect(outreachBenefitOf([{ ...saleCard, title: 'ㄱ'.repeat(OUTREACH_BENEFIT_MAX) }], NOW).benefit).toHaveLength(OUTREACH_BENEFIT_MAX);
    expect(outreachBenefitOf([{ ...saleCard, endDate: '2025-01-01' }], NOW).periodEnd).toBeNull();
    expect(outreachBenefitOf([{ title: ' ', endDate: null, licensed: true }, { title: '무료배송 이벤트', endDate: null, licensed: true, text: '5만원 이상  구매 시' }], NOW))
      .toEqual({ benefit: '무료배송 이벤트', periodEnd: null, note: '5만원 이상 구매 시', index: 0 });
  });

  it('재료 변환 — 표지 = 그림 그대로(그 그림의 링크) · 0원 가격 = 없음 · 행사 · 법정 표기 · 혜택 카드 주소 · 쇼핑몰 주소', () => {
    const m = outreachLineMaterials(input({ eventCards: [{ title: '신규 가입', endDate: null, licensed: false }, saleCard] }), std(), NOW);
    expect(m.hero).toEqual({ url: '/api/dm/v/images/c/poster.jpg', asIs: true, linkUrl: `${HOME}/event/1` });
    expect(m.products[0]).toMatchObject({ price: 32000, discount_price: 25600 });
    expect(m.products[1].price).toBeNull();
    expect(m.events).toHaveLength(2);
    expect(m.legal).toContain('사업자등록번호');
    expect(m.csPhone).toBe('1588-0000');
    // 혜택 카드 = 두 번째 카드 → 표준 행사 목록의 두 번째 주소
    expect(m.benefitLink).toBe(`${HOME}/event/2`);
    expect(m.shopUrl).toBe(`${HOME}/shop`);
    expect(m.periodLabel).toBe('2026년 10월 31일(토)까지');
  });

  it('자격 — 혜택에 세일 · 할인 말 = 빅세일 + 특별 이벤트 · 혜택만 = 특별 이벤트 · 상품 + 신상 근거 = 신상품 + 계절 · 상품만 = 계절 · 둘 다 없음 = []', () => {
    const ids = (lin: OutreachLineInput, s: OutreachStdLike) => eligibleOutreachTemplates(outreachLineMaterials(lin, s, NOW), '').map((e) => e.id);
    expect(ids(input({ eventCards: [saleCard] }), std())).toEqual(['big-sale', 'special-event']);
    expect(ids(input({ eventCards: [{ title: '가을 감사 사은 이벤트', endDate: null, licensed: true }] }), std())).toEqual(['special-event']);
    expect(ids(input(), std({ events: [{ title: '신상 출시 기념', periodLine: '', imageUrl: null, linkUrl: `${HOME}/event/7` }] }))).toEqual(['new-launch', 'season']);
    expect(ids(input(), std())).toEqual(['season']);
    expect(ids(input(), std({ products: [] }))).toEqual([]);
  });

  it('R4 · R5 자격 — %·적립·감사제 = 빅세일 아님 · 재입고 · 컬렉션 · renew · New Balance(섞인 대소문자) · 사이트 이름 = 신상 근거 아님 · 대문자 NEW 낱말 = 근거', () => {
    // 신호 글 = 실제 흐름과 같이(행사 제목 · 사이트 이름 · 상품 이름)
    const ids = (lin: OutreachLineInput, s: OutreachStdLike) => eligibleOutreachTemplates(outreachLineMaterials(lin, s, NOW), outreachSignalOf(lin, s)).map((e) => e.id);
    expect(ids(input({ eventCards: [{ title: '상시 5% 적립', endDate: null, licensed: true }] }), std())).toEqual(['special-event']);
    expect(ids(input({ eventCards: [{ title: '고객 감사제', endDate: null, licensed: true }] }), std())).toEqual(['special-event']);
    const prods = (names: string[]) => std({ events: [], products: names.map((n, i) => ({ name: n, image_url: `/api/dm/v/images/c/q${i}.jpg`, link_url: `${HOME}/q/${i}`, price: null, discount_price: null })) });
    expect(ids(input({ siteTitle: 'New Balance 공식몰 NEW' }), prods(['재입고 러닝화', '베이직 컬렉션 티셔츠', 'Renewal 크림', 'New Balance 993']))).toEqual(['season']);
    expect(ids(input(), prods(['기본 티셔츠', 'NEW 립 세럼']))).toEqual(['new-launch', 'season']);
  });

  it('R5 버튼 목적지 = 그 템플릿이 말하는 대상 — 세일 · 이벤트 = 혜택 카드 주소 · 신상품 = 근거 행사 · 상품 주소 · 계절 = 쇼핑몰', () => {
    const lin = input({ eventCards: [saleCard, { title: '신규 가입', endDate: null, licensed: false }] });
    const s = std({ events: [{ title: '가을 세일', periodLine: '', imageUrl: '/api/dm/v/images/c/e1.jpg', linkUrl: `${HOME}/sale` }, { title: '신규 가입', periodLine: '', imageUrl: '/api/dm/v/images/c/e2.jpg', linkUrl: `${HOME}/signup` }], ctaUrl: `${HOME}/signup` });
    const el = eligibleOutreachTemplates(outreachLineMaterials(lin, s, NOW), '');
    expect(el.map((e) => [e.id, e.link])).toEqual([['big-sale', `${HOME}/sale`], ['special-event', `${HOME}/sale`]]);
    const fresh = eligibleOutreachTemplates(outreachLineMaterials(input(), std({ events: [], products: [{ name: 'NEW 립 세럼', image_url: '/api/dm/v/images/c/n.jpg', link_url: `${HOME}/p/new`, price: null, discount_price: null }] }), NOW), '');
    expect(fresh.map((e) => [e.id, e.link])).toEqual([['new-launch', `${HOME}/p/new`], ['season', `${HOME}/shop`]]);
    // 조립된 버튼 = 같은 대상
    const r = composeOutreachTemplate(rule('big-sale'), lin, outreachLineMaterials(lin, s, NOW), '', 'DM', 'poster');
    if (!r.ok) throw new Error(r.bad.join(','));
    const cta = r.sections.find((x) => x.type === 'cta')!;
    expect((cta.props as any).buttons[0]).toMatchObject({ label: OUTREACH_COPY_BANK['big-sale'].cta_label![0].text, url: `${HOME}/sale` });
  });

  it('고르기 신호 글 = 행사 제목 · 사이트 제목 · 상품 이름', () => {
    expect(outreachSignalOf({ siteTitle: '공식몰' }, std())).toBe('가을 세일 · 신규 가입 혜택 · 공식몰 · 글로우 크림 · 수분 세럼');
  });
});

describe('2단계 — 업종 문구 묶음(검증된 문구 · 채움)', () => {
  const all = LINE_TEMPLATE_IDS.flatMap((id) => (Object.entries(OUTREACH_COPY_BANK[id]) as Array<[LineCopyKey, any[]]>).flatMap(([key, list]) => list.map((l, i) => ({ id, key, i, ...l }))));
  const bare = (t: string) => t.replace(/\{(brand|product)\}/g, '');

  it('칸 상한 · 숫자 0 · 혜택 낱말 0 · 줄표 · 따옴표 0 · 효과 단정 0 · 모델명 0 · 채움 자리 = brand · product 만', () => {
    expect(all.length).toBeGreaterThan(120);
    for (const l of all) {
      const max = getLineTemplate(l.id)!.copy.find((f) => f.key === l.key)!.max;
      expect(bare(l.text).length, `${l.id}.${l.key}[${l.i}]`).toBeLessThanOrEqual(max);
      expect(l.text).not.toMatch(/[0-9０-９]/);
      expect(findBenefitSpans(bare(l.text)), l.text).toEqual([]);
      expect(l.text).not.toMatch(/[—–"'“”‘’]/);
      expect(l.text).not.toMatch(/최고|1위|완벽|효과|보장/);
      expect(l.text).not.toMatch(/claude|gpt|opus|sonnet|anthropic/i);
      expect(l.text.replace(/\{(brand|product)\}/g, '')).not.toMatch(/[{}]/);
      expect(l.text, '채움 자리 뒤 받침 조사 금지').not.toMatch(/\}(이|가|을|를|은|는|와|과|로)(?![가-힣])/);
    }
  });

  it('0번 = 모든 업종 · 마감 근거 · 채움 없이 쓰는 기본 · 세일 = 빅세일에만 · 새로 · 신상 = 신상품에만 · 끝 · 마감 · 곧 = 마감 근거 문구만 · {product} = 계절에만', () => {
    for (const id of LINE_TEMPLATE_IDS) for (const list of Object.values(OUTREACH_COPY_BANK[id])) {
      expect(list![0]).toEqual({ text: list![0].text });
      expect(list![0].text).not.toMatch(/[{}]/);
    }
    for (const l of all) {
      if (l.id !== 'big-sale') expect(l.text, l.text).not.toMatch(/세일/);
      if (l.id !== 'new-launch') expect(l.text, l.text).not.toMatch(/새로|신상|새 /);
      if (/끝|마감|곧/.test(l.text)) expect(l.needs, l.text).toBe('deadline');
      if (l.text.includes('{product}')) expect(l.id, l.text).toBe('season');
    }
  });

  it('업종마다 칸마다 고를 수 있는 문구가 둘 이상(기본 하나로 끝나지 않는다)', () => {
    for (const id of LINE_TEMPLATE_IDS) for (const [key, list] of Object.entries(OUTREACH_COPY_BANK[id]) as Array<[LineCopyKey, any[]]>) {
      for (const tone of ['beauty', 'fashion', 'food', 'commerce'] as const) {
        const n = list.filter((l) => (!l.tone || l.tone === tone) && !l.needs).length;
        expect(n, `${id}.${key}.${tone}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('채움 — 브랜드 · 상품 이름을 넣는다 · 값이 없거나 칸 상한을 넘으면 그 문구는 빠진다(null)', () => {
    expect(outreachBankText({ text: '{brand} 세일' }, { brand: '테스트몰', product: null }, 18)).toBe('테스트몰 세일');
    expect(outreachBankText({ text: '{product}부터 둘러보세요' }, { brand: 'x', product: null }, 30)).toBeNull();
    expect(outreachBankText({ text: '{brand} 세일' }, { brand: '아주아주아주아주긴브랜드이름입니다', product: null }, 18)).toBeNull();
    expect(outreachFillsOf('테스트몰', { products: [{ name: '글로우 크림' }] as any })).toEqual({ brand: '테스트몰', product: '글로우 크림' });
  });

  it('업종 → 결 = 뷰티 · 패션 · 식품 · 커머스(나머지)', () => {
    expect(outreachToneOf('beauty')).toBe('beauty');
    expect(outreachToneOf('health')).toBe('beauty');
    expect(outreachToneOf('fashion')).toBe('fashion');
    expect(outreachToneOf('food')).toBe('food');
    expect(outreachToneOf('pet')).toBe('commerce');
    expect(outreachToneOf(null)).toBe('commerce');
  });
});

describe('2단계 — AI 추천(고르기만) · 해석 · 규칙으로 물러남', () => {
  const lin = input({ eventCards: [{ ...saleCard, endDate: null }] });
  const m = outreachLineMaterials(lin, std(), NOW);
  const eligible = eligibleOutreachTemplates(m, '');
  const ctx = { companyName: '테스트몰', industry: 'beauty', pageText: '가을 세일 최대 20% 할인 진행 중', siteTitle: '테스트몰' };
  const fills = outreachFillsOf('테스트몰', m);

  it('프롬프트 = 자격 템플릿만 · 그 결 · 마감 근거 · 채운 글로(다른 결 · 마감 문구 · 채움 자리 0) · 쓰지 말고 고르라는 규칙', () => {
    const p = buildOutreachPickPrompt(ctx, m, eligible);
    expect(p.user).toContain('[템플릿 big-sale]');
    expect(p.user).toContain('[템플릿 special-event]');
    expect(p.user).not.toContain('[템플릿 season]');
    expect(p.user).toContain('뷰티 세일을 시작해요');
    expect(p.user).toContain('테스트몰 세일');
    expect(p.user).not.toContain('스타일 세일을 시작해요');
    expect(p.user).not.toContain('세일이 곧 끝나요');
    expect(p.user).not.toMatch(/\{(brand|product)\}/);
    expect(p.user).toContain('[페이지 글]');
    expect(p.system).toContain('문구를 새로 쓰지 않습니다');
  });

  it('해석 — 자격 밖 템플릿 = null · 칸 번호는 지금 쓸 수 있는 것만(다른 결 · 마감 문구 · 없는 번호 · 소수 · 채움 실패 = 버림)', () => {
    expect(parseOutreachPick('{"template":"season","copy":{}}', eligible, 'beauty', false, fills)).toBeNull();
    expect(parseOutreachPick('아무 말', eligible, 'beauty', false, fills)).toBeNull();
    const r = parseOutreachPick('{"template":"big-sale","copy":{"cover_headline":4,"cover_sub":5,"closing_headline":3,"story_body":99,"cta_label":1.5,"cover_tag":1}}', eligible, 'beauty', false, fills)!;
    expect(r).toEqual({ id: 'big-sale', reasons: eligible[0].reasons, by: 'ai', copy: { cover_headline: 4, cover_tag: 1 } });
    // 브랜드 이름이 길어 채운 글이 칸을 넘으면 그 번호는 버린다
    const long = parseOutreachPick('{"template":"big-sale","copy":{"cover_headline":3}}', eligible, 'beauty', false, { brand: '아주아주아주아주긴브랜드이름입니다', product: null })!;
    expect(long.copy).toEqual({});
  });

  it('추천 — 자격 0 = AI 부르지 않고 null · AI 1회(계측 source) · 실패 · 해석 실패 · 시간 초과 = 규칙(자격 1순위 + 기본 문구)', async () => {
    const call = vi.fn(async () => '{"template":"special-event","copy":{"cta_label":2}}');
    expect(await pickOutreachLineTemplate(ctx, outreachLineMaterials(input(), std({ products: [] }), NOW), '', call)).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(await pickOutreachLineTemplate(ctx, m, '', call)).toMatchObject({ id: 'special-event', by: 'ai', copy: { cta_label: 2 } });
    expect(call).toHaveBeenCalledTimes(1);
    expect((call.mock.calls[0] as any)[0].source).toBe('sales-outreach-line-template-pick');
    const down = vi.fn(async () => { throw new Error('down'); });
    expect(await pickOutreachLineTemplate(ctx, m, '', down)).toMatchObject({ id: 'big-sale', by: 'rule', copy: {} });
    const junk = vi.fn(async () => '{"template":"nope"}');
    expect(await pickOutreachLineTemplate(ctx, m, '', junk)).toMatchObject({ id: 'big-sale', by: 'rule' });
    const slow = vi.fn(() => new Promise<string>(() => { /* 응답 없음 */ }));
    const t0 = Date.now();
    expect(await pickOutreachLineTemplate(ctx, m, '', slow, 30)).toMatchObject({ id: 'big-sale', by: 'rule' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('문구 — 고른 번호를 지금 쓸 수 있으면 채운 글 · 아니면 0번 · 묶음에 없는 칸 = 템플릿 기본 문구', () => {
    const t = getLineTemplate('big-sale')!;
    const c = outreachCopyOf(t, { copy: { cover_headline: 4, closing_headline: 3, cta_label: 9 } }, 'beauty', false, fills);
    expect(c.cover_headline).toBe('뷰티 세일을 시작해요');
    expect(c.closing_headline).toBe(OUTREACH_COPY_BANK['big-sale'].closing_headline![0].text);
    expect(c.cta_label).toBe(OUTREACH_COPY_BANK['big-sale'].cta_label![0].text);
    expect(outreachCopyOf(t, { copy: { closing_headline: 3 } }, 'beauty', true, fills).closing_headline).toBe('세일이 곧 끝나요');
    expect(outreachCopyOf(t, { copy: { cover_headline: 3 } }, 'beauty', false, fills).cover_headline).toBe('테스트몰 세일');
    expect(outreachCopyOf(t, { copy: { cover_headline: 4 } }, 'fashion', false, fills).cover_headline).toBe(OUTREACH_COPY_BANK['big-sale'].cover_headline![0].text);
    expect(c.inapp_title).toBe(t.copy.find((f) => f.key === 'inapp_title')!.fallback);
  });

  it('기록 읽기 — 모르는 템플릿 · 모양 아님 = null · 이유 = 글자만 · 번호 = 0 이상 정수만 · 추천 주체 = ai 아니면 rule', () => {
    expect(outreachLineTemplateRecordOf(null)).toBeNull();
    expect(outreachLineTemplateRecordOf({ id: 'nope' })).toBeNull();
    expect(outreachLineTemplateRecordOf([1])).toBeNull();
    expect(outreachLineTemplateRecordOf({ id: 'season', reasons: ['가을', 3], by: 'x', copy: { cover_headline: 1, cover_sub: -1, cta_label: 'a', story_body: 1.2 } }))
      .toEqual({ id: 'season', reasons: ['가을'], by: 'rule', copy: { cover_headline: 1 } });
  });
});

describe('조립 — 그림 표지 · 행사 장 · 조건 글 · 푸터 · 고른 문구 · id', () => {
  const lin = input({ eventCards: [saleCard] });
  const m = outreachLineMaterials(lin, std(), NOW);
  const rec: OutreachLineTemplateRecord = { id: 'big-sale', reasons: ['세일'], by: 'ai', copy: { cover_headline: 4 } };

  it('DM — 표지 = 그림(원본 비율 · 그 그림의 링크) + 아래 제목(혜택 원문) · 덮어 쓰는 hero 0', () => {
    const r = composeOutreachTemplate(rec, lin, m, '', 'DM', 'poster');
    if (!r.ok) throw new Error(r.bad.join(','));
    const body = r.sections.filter((s) => s.type !== 'header');
    expect(body[0]).toMatchObject({ type: 'gallery' });
    expect(String(body[0].id)).toMatch(/^so-tpl-cover-poster-\d+$/);
    expect((body[0].props as any).images[0]).toMatchObject({ url: '/api/dm/v/images/c/poster.jpg', link_url: `${HOME}/event/1` });
    expect(body[1]).toMatchObject({ type: 'text_card' });
    expect((body[1].props as any).headline).toBe('가을 세일 최대 20% 할인');
    expect(r.sections.some((s) => s.type === 'hero' && (s.props as any).image_url === '/api/dm/v/images/c/poster.jpg')).toBe(false);
  });

  it('DM — 글 = 묶음 문구(채운 것) · 템플릿 기본 문구 · 재료뿐(AI 글 0) · 행사 장 버튼 0 · 같은 그림 0 · 법정 표기 · 모든 id = so-tpl', () => {
    const r = composeOutreachTemplate(rec, lin, m, '', 'DM', 'poster');
    if (!r.ok) throw new Error(r.bad.join(','));
    const bank = filledBank('big-sale');
    const material = ['가을 세일 최대 20% 할인', '2026년 10월 31일(토)까지', '가을 세일', '10.18 ~ 10.31', '신규 가입 혜택', '이벤트', '테스트몰', '마감까지'];
    for (const t of textsOf(r.sections)) expect(bank.has(t) || material.some((x) => t === x || t.startsWith(x)), t).toBe(true);
    expect(textsOf(r.sections)).toContain('뷰티 세일을 시작해요');
    expect(r.sections.filter((s) => String(s.id).startsWith('so-tpl-events-')).length).toBe(2);
    const slices = r.sections.filter((s) => String(s.id).startsWith('so-tpl-slices-'));
    expect(slices.flatMap((s) => (s.props as any).images.map((i: any) => i.url))).toEqual(['/api/dm/v/images/c/s1.jpg']);
    expect((r.sections.find((s) => s.type === 'footer')!.props as any).legal_text).toContain('사업자등록번호');
    expect(r.sections.every((s) => String(s.id).startsWith('so-tpl-'))).toBe(true);
    expect(r.sections.filter((s) => s.type === 'cta').length).toBe(1);
    expect(lineTemplateGate(r.sections)).toEqual([]);
  });

  it('R5 조건 글 — 「무료배송 이벤트 / 5만원 이상 구매 시」 = 혜택 띠 바로 아래 조건 글 · 행사 장에도 본문 · 빅세일 표지 아래에도', () => {
    const card = { title: '무료배송 이벤트', endDate: null, licensed: true, text: '5만원 이상 구매 시' };
    const l2 = input({ eventCards: [card] });
    const s2 = std({ hero: null, events: [{ title: '무료배송 이벤트', periodLine: '', imageUrl: null, linkUrl: `${HOME}/event/2`, text: '5만원 이상 구매 시' }] });
    const m2 = outreachLineMaterials(l2, s2, NOW);
    expect(m2.benefitNote).toBe('5만원 이상 구매 시');
    const r = composeOutreachTemplate(rule('special-event'), l2, m2, '', 'DM', null);
    if (!r.ok) throw new Error(r.bad.join(','));
    const i = r.sections.findIndex((s) => s.type === 'coupon');
    expect((r.sections[i].props as any).discount_label).toBe('무료배송 이벤트');
    expect(r.sections[i + 1]).toMatchObject({ type: 'text_card', props: { body: '5만원 이상 구매 시' } });
    const ev = r.sections.find((s) => String(s.id).startsWith('so-tpl-events-'))!;
    expect((ev.props as any).body).toContain('5만원 이상 구매 시');
    // 빅세일 그림 표지 = 혜택 원문 아래 조건 글
    const card3 = { title: '여름 세일 무료배송', endDate: null, licensed: true, text: '5만원 이상 구매 시' };
    const l3 = input({ eventCards: [card3] });
    const s3 = std({ events: [{ title: '여름 세일 무료배송', periodLine: '', imageUrl: '/api/dm/v/images/c/e1.jpg', linkUrl: `${HOME}/event/1`, text: '5만원 이상 구매 시' }] });
    const r3 = composeOutreachTemplate(rule('big-sale'), l3, outreachLineMaterials(l3, s3, NOW), '', 'DM', 'poster');
    if (!r3.ok) throw new Error(r3.bad.join(','));
    const copy = r3.sections.find((s) => String(s.id).startsWith('so-tpl-cover-copy-'))!;
    expect((copy.props as any).headline).toBe('여름 세일 무료배송');
    expect(String((copy.props as any).body).split('\n')[0]).toBe('5만원 이상 구매 시');
  });

  it('R6 이메일 — 배너 있는 행사의 제목 · 조건 · 기간이 보이는 글로(캡션 = 대체 글뿐이라 기대지 않는다) · DM 은 캡션으로 보인다', () => {
    const l2 = input({ eventCards: [saleCard, { title: '무료배송 행사', endDate: null, licensed: true, text: '5만원 이상 구매 시' }] });
    const s2 = std({ events: [
      { title: '가을 세일', periodLine: '10.18 ~ 10.31', imageUrl: '/api/dm/v/images/c/e1.jpg', linkUrl: `${HOME}/event/1` },
      { title: '무료배송 행사', periodLine: '', imageUrl: '/api/dm/v/images/c/e2.jpg', linkUrl: `${HOME}/event/2`, text: '5만원 이상 구매 시' },
    ] });
    const m2 = outreachLineMaterials(l2, s2, NOW);
    const em = composeOutreachTemplate(rule('big-sale'), l2, m2, '', 'EMAIL', 'poster');
    if (!em.ok) throw new Error(em.bad.join(','));
    const visible = renderEmailSections(em.sections, { brandKit: { primary_color: '#1f2937' } as any, storeName: '테스트몰' }).replace(/\salt="[^"]*"/g, '');
    expect(visible).toContain('5만원 이상 구매 시');
    expect(visible).toContain('무료배송 행사');
    expect(visible).toContain('10.18 ~ 10.31');
    const dm = composeOutreachTemplate(rule('big-sale'), l2, m2, '', 'DM', 'poster');
    if (!dm.ok) throw new Error(dm.bad.join(','));
    const cap = dm.sections.filter((s) => s.type === 'gallery').flatMap((s) => (s.props as any).images.map((i: any) => i.caption));
    expect(cap).toContain('무료배송 행사 · 5만원 이상 구매 시');
    // DM 은 같은 행사 글 카드를 더하지 않는다(캡션이 보인다)
    expect(dm.sections.filter((s) => s.type === 'text_card' && (s.props as any).headline === '무료배송 행사')).toHaveLength(0);
  });

  it('R4 — 「상시 5% 적립」(마감 없음) = 특별 이벤트 · 결과물에 세일 · 끝 · 마감 문구 0', () => {
    const l2 = input({ eventCards: [{ title: '상시 5% 적립', endDate: null, licensed: true }] });
    const s2 = std({ events: [{ title: '상시 5% 적립', periodLine: '', imageUrl: '/api/dm/v/images/c/e1.jpg', linkUrl: `${HOME}/event/2` }] });
    const m2 = outreachLineMaterials(l2, s2, NOW);
    const id = eligibleOutreachTemplates(m2, '')[0].id;
    expect(id).toBe('special-event');
    const r = composeOutreachTemplate(rule(id, { closing_headline: 3, closing_body: 2 }), l2, m2, '', 'DM', 'poster');
    if (!r.ok) throw new Error(r.bad.join(','));
    expect(textsOf(r.sections).join(' ')).not.toMatch(/세일|끝나|마감|곧/);
  });

  it('지금 재료로 고를 수 없는 기록(혜택이 사라진 빅세일) = ok:false(표준 조립)', () => {
    expect(composeOutreachTemplate(rule('big-sale'), input(), outreachLineMaterials(input(), std(), NOW), '', 'DM', 'poster').ok).toBe(false);
  });

  it('DM 렌더(세로 한 페이지) — 자리표시 0 · 같은 그림 0 · 표지 그림이 첫 그림', () => {
    const r = composeOutreachTemplate(rec, lin, m, '', 'DM', 'poster');
    if (!r.ok) throw new Error(r.bad.join(','));
    const html = renderDmViewerHtml({ title: 't', store_name: '테스트몰', layout_mode: 'scroll', pages: [{ id: 'p', name: '1장', sections: r.sections }], sections: r.sections, brand_kit: { primary_color: '#1f2937' }, short_code: '' } as any, '');
    expect(content(html)).not.toMatch(PH);
    const list = imgs(html);
    expect(list[0]).toBe('/api/dm/v/images/c/poster.jpg');
    expect(new Set(list).size).toBe(list.length);
  });

  it('이메일 — 같은 기록 · 같은 문구 번호(AI 0) · 렌더러가 그린다 · 프리헤더 = 묶음 문구(채움)', () => {
    const r = composeOutreachTemplate({ ...rec, copy: { email_preheader: 2 } }, lin, m, '', 'EMAIL', 'poster');
    if (!r.ok) throw new Error(r.bad.join(','));
    const html = renderEmailSections(r.sections, { brandKit: { primary_color: '#1f2937' } as any, storeName: '테스트몰' });
    expect(content(html)).not.toMatch(PH);
    expect(html).toContain('/api/dm/v/images/c/poster.jpg');
    expect(r.preheader).toBe('테스트몰 세일 소식을 전해 드려요');
  });

  it('관문 — 같은 그림이 두 번이면 실패(갤러리 그림도 센다)', () => {
    const sec = (id: string, url: string) => ({ id, type: 'gallery', order: 0, visible: true, props: { images: [{ url }] } }) as any;
    expect(lineTemplateGate([sec('a', '/x.jpg'), sec('b', '/x.jpg')]).length).toBeGreaterThan(0);
  });

  it('갈 길 없는 행사 판정 — 그림 · 상품 · 버튼 링크 어디에도 없는 행사만(앞 3개)', () => {
    const sec = (type: string, props: any) => ({ id: 'x', type, order: 0, visible: true, props }) as any;
    const ev = (u: string) => ({ title: 't', link_url: u });
    const secs = [sec('gallery', { images: [{ url: '/a.jpg', link_url: '/g' }] }), sec('product_carousel', { products: [{ link_url: '/p' }] }), sec('cta', { buttons: [{ url: '/c' }] })];
    expect(outreachLostEvents({ events: [ev('/g'), ev('/p'), ev('/c')] }, secs)).toEqual([]);
    expect(outreachLostEvents({ events: [ev('/g'), ev('/z')] }, secs)).toEqual(['갈 길 없는 행사 1']);
    expect(outreachLostEvents({ events: [ev('/g'), ev('/p'), ev('/c'), ev('/z')] }, secs)).toEqual([]);
  });

  it('R1-3 · R5 그림 없는 행사 — 그 주소가 다른 곳에 없으면 작은 테두리 링크 버튼(행사 버튼 글자) · 있으면 버튼 없음 · 주 버튼은 하나', () => {
    // 첫 행사 = 혜택 카드(주 버튼 목적지) · 둘째 행사 = 그림 없음 · 표지 그림은 첫 행사로
    const s0 = std({ events: [
      { title: '첫 행사', periodLine: '', imageUrl: null, linkUrl: `${HOME}/event/1` },
      { title: '둘째 행사', periodLine: '', imageUrl: null, linkUrl: `${HOME}/event/9`, ctaLabel: '가입 혜택 보기' },
    ] });
    const r = composeOutreachTemplate(rec, lin, outreachLineMaterials(lin, s0, NOW), '', 'DM', 'poster');
    if (!r.ok) throw new Error(r.bad.join(','));
    const links = r.sections.filter((s) => String(s.id).startsWith('so-tpl-events-link-'));
    expect(links.map((s) => (s.props as any).buttons[0])).toEqual([{ label: '가입 혜택 보기', url: `${HOME}/event/9`, style: 'outline' }]);
    const primary = r.sections.filter((s) => s.type === 'cta').flatMap((s) => (s.props as any).buttons).filter((b: any) => b.style !== 'outline');
    expect(primary).toHaveLength(1);
    expect(outreachLostEvents(outreachLineMaterials(lin, s0, NOW), r.sections)).toEqual([]);
    // 같은 주소가 표지 그림에 있으면 링크 버튼을 달지 않는다
    const s1 = std({ hero: { url: '/api/dm/v/images/c/poster.jpg', kind: 'poster', linkUrl: `${HOME}/event/9` }, events: s0.events });
    const r1 = composeOutreachTemplate(rec, lin, outreachLineMaterials(lin, s1, NOW), '', 'DM', 'poster');
    if (!r1.ok) throw new Error(r1.bad.join(','));
    expect(r1.sections.some((s) => String(s.id).startsWith('so-tpl-events-link-'))).toBe(false);
  });

  it('모르는 템플릿 기록 = ok:false', () => {
    expect(composeOutreachTemplate(rule('nope' as any), lin, m, '', 'DM', 'poster').ok).toBe(false);
  });

  it('id — 표지 = so-tpl-cover-<종류>-n(그림 없으면 none) · 나머지 = so-tpl-<부분>-n', () => {
    const ids = outreachTemplateIds(null);
    expect(ids('cover')).toBe('so-tpl-cover-none-1');
    expect(ids('events')).toBe('so-tpl-events-2');
    expect(ids('benefit-note')).toBe('so-tpl-benefit-note-3');
    expect(ids()).toBe('so-tpl-x-4');
  });
});

describe('출처 기록 · 판정 카드 · 학습 레시피', () => {
  const base = { cards: [], media: null, licensedQuote: '', look: null, colorSource: null, benefitStripped: 0, heroFallback: false, eventList: null, bannerRead: false, vision: null, aiCost: null };

  it('레시피 bindings — 템플릿 id 를 재료로 읽는다', () => {
    const s = (id: string, type: string, props: any = {}) => ({ id, type, props });
    const r: any = buildOutreachRecipe({
      ...base,
      sections: [
        s('so-tpl-cover-poster-2', 'gallery'), s('so-tpl-cover-banner-2', 'gallery'), s('so-tpl-cover-card-2', 'gallery'),
        s('so-tpl-cover-none-2', 'hero', { image_url: '/p.jpg' }), s('so-tpl-products-5', 'product_carousel', { products: [1, 2] }),
        s('so-tpl-slices-7', 'gallery', { images: [1, 2, 3] }), s('so-tpl-events-6', 'gallery'), s('so-tpl-benefit-4', 'coupon'),
        s('so-tpl-benefit-note-5', 'text_card'), s('so-tpl-deadline-8', 'countdown'), s('so-tpl-story-3', 'text_card'), s('so-tpl-footer-9', 'footer'),
      ],
    });
    const b = Object.fromEntries(r.bindings.map((x: any) => [x.sectionId, [x.src, x.reader, x.ref ?? null]]));
    expect(b['so-tpl-cover-poster-2']).toEqual(['poster', 'vision', null]);
    expect(b['so-tpl-cover-banner-2']).toEqual(['slice', 'html', 'hero=banner']);
    expect(b['so-tpl-cover-card-2']).toEqual(['card', 'html', 'hero=card']);
    expect(b['so-tpl-cover-none-2']).toEqual(['product', 'html', 'cover']);
    expect(b['so-tpl-products-5']).toEqual(['product', 'html', 'n=2']);
    expect(b['so-tpl-slices-7']).toEqual(['slice', 'html', 'n=3']);
    expect(b['so-tpl-events-6']).toEqual(['card', 'html', null]);
    expect(b['so-tpl-benefit-4']).toEqual(['card', 'html', null]);
    expect(b['so-tpl-benefit-note-5']).toEqual(['card', 'html', null]);
    expect(b['so-tpl-deadline-8']).toEqual(['card', 'html', 'endDate']);
    expect(b['so-tpl-story-3']).toEqual(['code', 'code', null]);
    expect(b['so-tpl-footer-9']).toEqual(['code', 'code', null]);
    expect(r.lineTemplate).toBeUndefined();
  });

  it('레시피 lineTemplate — 템플릿 · 추천 주체 · 칸 번호 · 결(원문 0 · 이유 낱말도 싣지 않는다)', () => {
    const rec: OutreachLineTemplateRecord = { id: 'season', reasons: ['가을'], by: 'ai', copy: { cover_headline: 4 } };
    const r: any = buildOutreachRecipe({ ...base, sections: [], lineTemplate: rec, industry: 'food' });
    expect(r.lineTemplate).toEqual({ id: 'season', by: 'ai', copy: { cover_headline: 4 }, tone: 'food' });
    expect(outreachLineTemplateRecipe(null, 'food')).toBeNull();
  });

  it('판정 카드 히어로 종류 = 템플릿 표지 id 에서', () => {
    const row = { brand_sections: [{ id: 'so-tpl-header-1', type: 'header', props: {} }, { id: 'so-tpl-cover-card-2', type: 'gallery', props: { images: [{ url: '/b.jpg' }] } }] };
    expect(cardHeroOf(row as any)).toMatchObject({ heroUrl: '/b.jpg', heroKind: 'card' });
  });
});

describe('AI 영업 조립 연결 — 스위치 · AI 추천 · 규칙 · 표준 조립', () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    process.env.OUTREACH_COMPANY_ID = 'oc'; process.env.OUTREACH_USER_ID = 'ou';
    aiMock.mockReset();
  });
  afterEach(() => { process.env = { ...ENV }; });

  const media = {
    gallery: [], slices: [], imageKinds: null, logo: null, collectedAt: '', stats: {},
    products: [
      { name: '글로우 크림', image_url: '/api/dm/v/images/c/p1.jpg', link_url: `${HOME}/p/1`, price: 32000, discount_price: null },
      { name: '수분 세럼', image_url: '/api/dm/v/images/c/p2.jpg', link_url: `${HOME}/p/2`, price: 28000, discount_price: null },
    ],
  } as any;
  const dmInput = (): any => ({
    companyId: 'oc', userId: 'ou', companyName: '테스트몰', industry: 'beauty', homepageUrl: HOME, siteTitle: '테스트몰', material: '가을 세일 최대 20% 할인 진행 중', extraNotes: null,
    benefitLicensed: true, licensedQuote: '가을 세일 최대 20% 할인', proof: null,
    posterUrl: '/api/dm/v/images/c/poster.jpg', posterSize: { width: 1080, height: 1350 }, bannerUrl: null, bannerSize: null, posterCaption: null,
    media, mediaSelection: null, ctaLinks: {}, legal: { legal: '(주)테스트몰', csPhone: '1588-0000' }, brandColor: null, entry: 'outreach',
    eventCards: [{ title: '가을 세일 최대 20% 할인', periodRaw: null, endDate: '2026-12-31', bannerUrl: null, bannerSize: null, detailUrl: `${HOME}/event/1`, licensed: true, text: '3만원 이상 구매 시' }],
    eventSlices: null, heroBanners: null, sectionOverride: null, presetSections: null,
  });
  const emailOf = (inp: any) => { const { companyId: _c, userId: _u, sectionOverride: _o, presetSections: _p, ...rest } = inp; return rest; };

  it('켜면 — AI 추천 1회(페이지 글 · 업종) → 템플릿 조립(so-tpl) · 조건 글 · 기록 · 슬라이스 모드 · 이메일 = 같은 기록(AI 0)', async () => {
    process.env.OUTREACH_LINE_TEMPLATES = '1';
    aiMock.mockResolvedValue('{"template":"big-sale","copy":{"cover_headline":4}}');
    const a = await assembleOutreachDm(dmInput());
    expect(aiMock).toHaveBeenCalledTimes(1);
    expect(aiMock.mock.calls[0][0].source).toBe('sales-outreach-line-template-pick');
    expect(aiMock.mock.calls[0][0].userMessage).toContain('가을 세일 최대 20% 할인 진행 중');
    expect(a.lineTemplate).toMatchObject({ id: 'big-sale', by: 'ai', copy: { cover_headline: 4 } });
    expect(a.sliceMode).toBe(true);
    expect(a.sections.every((s) => String(s.id).startsWith('so-tpl-'))).toBe(true);
    expect(textsOf(a.sections)).toContain('뷰티 세일을 시작해요');
    expect(textsOf(a.sections)).toContain('3만원 이상 구매 시');
    expect(Object.keys(a.brandKit).every((k) => ['primary_color', 'art_direction'].includes(k))).toBe(true);
    aiMock.mockClear();
    const e = await produceOutreachBrandEmail({ ...emailOf(dmInput()), lineTemplate: a.lineTemplate });
    expect(aiMock).not.toHaveBeenCalled();
    expect(e.sections.every((s) => String(s.id).startsWith('so-tpl-'))).toBe(true);
    expect(textsOf(e.sections)).toContain('뷰티 세일을 시작해요');
    expect(e.subject).toBe('가을 세일 최대 20% 할인');
    const e2 = await produceOutreachBrandEmail({ ...emailOf(dmInput()), lineTemplate: { id: 'special-event', reasons: [], by: 'ai', copy: {} } });
    expect(textsOf(e2.sections)).toContain(OUTREACH_COPY_BANK['special-event'].cover_headline![0].text);
  });

  it('AI 실패 = 규칙(자격 1순위 + 기본 문구)으로 템플릿 조립', async () => {
    process.env.OUTREACH_LINE_TEMPLATES = '1';
    aiMock.mockRejectedValue(new Error('down'));
    const a = await assembleOutreachDm(dmInput());
    expect(a.lineTemplate).toMatchObject({ id: 'big-sale', by: 'rule', copy: {} });
    expect(a.sections.every((s) => String(s.id).startsWith('so-tpl-'))).toBe(true);
  });

  it('고를 템플릿 없음(면허 혜택 0 · 상품 0) = AI 부르지 않고 표준 조립 · 지금 재료로 고를 수 없는 기록의 이메일 = 표준 조립', async () => {
    process.env.OUTREACH_LINE_TEMPLATES = '1';
    const inp = dmInput();
    inp.eventCards = [{ title: '가을 소식', periodRaw: null, endDate: null, bannerUrl: null, bannerSize: null, detailUrl: `${HOME}/event/9`, licensed: false }];
    inp.media = { ...media, products: [] };
    const a = await assembleOutreachDm(inp);
    expect(aiMock).not.toHaveBeenCalled();
    expect(a.lineTemplate).toBeNull();
    expect(a.sections.some((s) => String(s.id).startsWith('so-std-'))).toBe(true);
    expect(a.sections.some((s) => String(s.id).startsWith('so-tpl-'))).toBe(false);
    const e = await produceOutreachBrandEmail({ ...emailOf({ ...dmInput(), eventCards: inp.eventCards }), lineTemplate: rule('big-sale') });
    expect(e.sections.some((s) => String(s.id).startsWith('so-std-'))).toBe(true);
  });

  it('행사 그림 없는 건(뒤 행사만 다른 주소)도 템플릿 유지 — 그 행사 아래 테두리 링크 버튼', async () => {
    process.env.OUTREACH_LINE_TEMPLATES = '1';
    aiMock.mockResolvedValue('{"template":"big-sale","copy":{}}');
    const inp = dmInput();
    inp.eventCards = [
      ...inp.eventCards,
      { title: '마지막 소식', periodRaw: null, endDate: null, bannerUrl: null, bannerSize: null, detailUrl: `${HOME}/event/9`, licensed: false },
    ];
    inp.posterUrl = null;
    const a = await assembleOutreachDm(inp);
    expect(a.lineTemplate?.id).toBe('big-sale');
    const link = a.sections.find((s) => String(s.id).startsWith('so-tpl-events-link-'));
    expect((link?.props as any)?.buttons?.[0]).toMatchObject({ url: `${HOME}/event/9`, style: 'outline' });
  });

  it('끄면 — AI 0 · 표준 조립 그대로 · 기록이 넘어와도 이메일은 표준 조립', async () => {
    delete process.env.OUTREACH_LINE_TEMPLATES;
    const a = await assembleOutreachDm(dmInput());
    expect(aiMock).not.toHaveBeenCalled();
    expect(a.lineTemplate).toBeNull();
    expect(a.sections.some((s) => String(s.id).startsWith('so-std-'))).toBe(true);
    const e = await produceOutreachBrandEmail({ ...emailOf(dmInput()), lineTemplate: rule('big-sale') });
    expect(e.sections.some((s) => String(s.id).startsWith('so-std-'))).toBe(true);
  });
});

describe('3단계 — 승격 레시피 → 업종 결 학습 베스트(힌트 · 규칙)', () => {
  const lt = (id: string, copy: Record<string, number> = {}, by = 'ai') => ({ id, reasons: [], by, copy });
  const lin = input({ eventCards: [{ ...saleCard, endDate: null }] });
  const m = outreachLineMaterials(lin, std(), NOW);
  const eligible = eligibleOutreachTemplates(m, '');   // big-sale · special-event
  const fills = outreachFillsOf('테스트몰', m);
  const ctx = { companyName: '테스트몰', industry: 'beauty', pageText: '', siteTitle: null };
  const q = pool.query as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => { invalidateOutreachRecipeTemplateCache(); q.mockReset(); });

  it('업종 결 → 업종 코드 목록(집계 단위)', () => {
    expect(outreachToneIndustries('beauty')).toEqual(['beauty', 'health']);
    expect(outreachToneIndustries('fashion')).toEqual(['fashion', 'baby', 'sports']);
    expect(outreachToneIndustries('food')).toEqual(['food']);
    expect(outreachToneIndustries('commerce')).toEqual(expect.arrayContaining(['home', 'pet', 'etc']));
    expect(outreachToneIndustries('commerce')).not.toContain('beauty');
  });

  it('집계 — 모양 틀린 행 · 모르는 템플릿 버림 · 빠진 칸 = 0번으로 셈 · 묶음에 없는 번호는 그 칸만 버림 · 0건 = null', () => {
    const b = outreachBestOf([lt('big-sale', { cover_headline: 4 }), lt('big-sale'), lt('season'), 'x', { id: 'nope' }, lt('big-sale', { cover_headline: 99 })])!;
    expect(b.total).toBe(4);
    expect(b.templates).toEqual({ 'big-sale': 3, season: 1 });
    expect(b.copy['big-sale']!.cover_headline).toEqual({ 4: 1, 0: 1 });
    expect(b.copy['big-sale']!.cta_label).toEqual({ 0: 3 });
    expect(outreachBestOf([])).toBeNull();
    expect(outreachBestOf(['x'])).toBeNull();
  });

  it('힌트 — 자격 템플릿 · 지금 쓸 수 있는 번호만 · 횟수 그대로 · 학습 0 이면 없음', () => {
    const b = outreachBestOf([lt('big-sale', { cover_headline: 4, closing_headline: 3 }), lt('big-sale', { cover_headline: 4, closing_headline: 3 }), lt('season')])!;
    const h = outreachBestHint(b, eligible, 'beauty', false, fills);
    expect(h).toContain('학습에 올린 선택 · 3건');
    expect(h).toContain('big-sale 2');
    expect(h).not.toContain('season');
    expect(h).toContain('cover_headline [4]×2');
    // 마감 근거 없는 지금은 마감 문구 번호(3)를 보이지 않는다 → 그 칸 다음 순위(없음)
    expect(h).not.toContain('closing_headline [3]');
    expect(outreachBestHint(null, eligible, 'beauty', false, fills)).toBe('');
    expect(outreachBestHint(outreachBestOf([lt('season')]), eligible, 'beauty', false, fills)).toBe('');
    // 프롬프트에 실린다
    expect(buildOutreachPickPrompt(ctx, m, eligible, b).user).toContain('학습에 올린 선택');
    expect(buildOutreachPickPrompt(ctx, m, eligible, null).user).not.toContain('학습에 올린 선택');
  });

  it(`규칙 — 자격 안 같은 템플릿 ${OUTREACH_BEST_MIN}건 이상이면 그것(by best) + ${OUTREACH_BEST_MIN}회 이상 쓸 수 있는 번호 · 아니면 자격 1순위 + 기본(by rule)`, () => {
    const one = outreachBestOf([lt('special-event', { cover_headline: 1 })]);
    expect(outreachRuleOf(eligible, one, 'beauty', false, fills)).toMatchObject({ id: 'big-sale', by: 'rule', copy: {} });
    const two = outreachBestOf([lt('special-event', { cover_headline: 1, cta_label: 2 }), lt('special-event', { cover_headline: 1 }), lt('big-sale')]);
    expect(outreachRuleOf(eligible, two, 'beauty', false, fills)).toEqual({ id: 'special-event', reasons: eligible[1].reasons, by: 'best', copy: { cover_headline: 1 } });
    // 자격 밖 템플릿의 학습은 쓰지 않는다
    const outside = outreachBestOf([lt('season'), lt('season')]);
    expect(outreachRuleOf(eligible, outside, 'beauty', false, fills)).toMatchObject({ id: 'big-sale', by: 'rule' });
    expect(outreachRuleOf(eligible, null, 'beauty', false, fills)).toMatchObject({ id: 'big-sale', by: 'rule' });
    // 기록 읽기 = best 그대로
    expect(outreachLineTemplateRecordOf({ id: 'season', by: 'best', copy: {} })?.by).toBe('best');
  });

  it('추천 — 자격 0 이면 학습도 읽지 않음 · 학습 읽기 실패 = 힌트 없이 · AI 실패 = 학습 베스트 · AI 성공 = ai(힌트 실린 프롬프트)', async () => {
    const load = vi.fn(async () => outreachBestOf([lt('special-event'), lt('special-event')]));
    expect(await pickOutreachLineTemplate(ctx, outreachLineMaterials(input(), std({ products: [] }), NOW), '', vi.fn(), 50, load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
    const down = vi.fn(async () => { throw new Error('down'); });
    expect(await pickOutreachLineTemplate(ctx, m, '', down, 50, load)).toMatchObject({ id: 'special-event', by: 'best' });
    expect(load).toHaveBeenCalledTimes(1);
    const broken = vi.fn(async () => { throw new Error('db'); });
    expect(await pickOutreachLineTemplate(ctx, m, '', down, 50, broken)).toMatchObject({ id: 'big-sale', by: 'rule' });
    const ok = vi.fn(async () => '{"template":"big-sale","copy":{}}');
    expect(await pickOutreachLineTemplate(ctx, m, '', ok, 50, load)).toMatchObject({ id: 'big-sale', by: 'ai' });
    expect((ok.mock.calls[0] as any)[0].userMessage).toContain('special-event 2');
  });

  it('조회 — 업종 코드 정렬 · 중복 제거 · 템플릿 기록 든 승격 레시피만 · 5분 캐시 · 승격(insert)하면 캐시를 비운다 · 테이블 없음 = [] · 그 밖 오류 = null(캐시 안 함)', async () => {
    q.mockResolvedValueOnce({ rows: [{ lt: lt('season') }] });
    expect(await listOutreachRecipeTemplates(['health', 'beauty', 'beauty'])).toEqual([lt('season')]);
    expect(q).toHaveBeenCalledTimes(1);
    const [sql, params] = q.mock.calls[0] as any;
    expect(sql).toContain("kind = $1 AND industry_code = ANY($2::varchar[])");
    expect(sql).toContain("jsonb_typeof(meta->'recipe'->'lineTemplate') = 'object'");
    // R8 — 같은 출처 잡이 두 번 승격돼도 한 건(잡마다 최신 1행) · 그 뒤에 최신 200
    expect(sql).toContain("DISTINCT ON (COALESCE(meta->'source'->>'jobId', created_at::text))");
    expect(sql.indexOf('DISTINCT ON')).toBeLessThan(sql.lastIndexOf('LIMIT $3'));
    expect(params).toEqual(['recipe', ['beauty', 'health'], 200]);
    // 캐시
    expect(await listOutreachRecipeTemplates(['beauty', 'health'])).toEqual([lt('season')]);
    expect(q).toHaveBeenCalledTimes(1);
    // 승격 = 캐시 비움
    q.mockResolvedValueOnce({ rows: [] });
    const r = await insertOutreachRecipe({ industryCode: 'beauty', sectionTypes: ['hero'], meta: { v: 1, source: { jobId: 'j', dmId: null, companyName: 'x', industryCode: 'beauty' }, recipe: {}, edits: { total: 0, byKind: {}, byReason: {} }, promotedBy: null, promotedAt: '' } });
    expect(r.ok).toBe(true);
    q.mockResolvedValueOnce({ rows: [{ lt: lt('big-sale') }] });
    expect(await listOutreachRecipeTemplates(['beauty', 'health'])).toEqual([lt('big-sale')]);
    // 테이블 없음 · 오류
    invalidateOutreachRecipeTemplateCache();
    q.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));
    expect(await listOutreachRecipeTemplates(['food'])).toEqual([]);
    q.mockRejectedValueOnce(new Error('boom'));
    expect(await listOutreachRecipeTemplates(['pet'])).toBeNull();
    // 오류는 캐시하지 않는다 — 다음 조회는 DB 를 다시 읽는다
    q.mockResolvedValueOnce({ rows: [{ lt: lt('season') }] });
    expect(await listOutreachRecipeTemplates(['pet'])).toEqual([lt('season')]);
    expect(await listOutreachRecipeTemplates([])).toEqual([]);
  });

  it('제작 연결 — 스위치 켬 · AI 실패면 그 결(뷰티 · 헬스)의 승격 레시피 베스트로 · 기록 by best', async () => {
    const ENV = { ...process.env };
    try {
      process.env.OUTREACH_COMPANY_ID = 'oc'; process.env.OUTREACH_USER_ID = 'ou'; process.env.OUTREACH_LINE_TEMPLATES = '1';
      aiMock.mockReset();
      aiMock.mockRejectedValue(new Error('down'));
      q.mockResolvedValue({ rows: [{ lt: lt('special-event', { cta_label: 2 }) }, { lt: lt('special-event', { cta_label: 2 }) }] });
      const a = await assembleOutreachDm({
        companyId: 'oc', userId: 'ou', companyName: '테스트몰', industry: 'health', homepageUrl: HOME, siteTitle: '테스트몰', material: '', extraNotes: null,
        benefitLicensed: true, licensedQuote: '가을 세일 최대 20% 할인', proof: null,
        posterUrl: '/api/dm/v/images/c/poster.jpg', posterSize: { width: 1080, height: 1350 }, bannerUrl: null, bannerSize: null, posterCaption: null,
        media: { gallery: [], slices: [], imageKinds: null, logo: null, collectedAt: '', stats: {}, products: [] }, mediaSelection: null, ctaLinks: {}, legal: null, brandColor: null, entry: 'outreach',
        eventCards: [{ title: '가을 세일 최대 20% 할인', periodRaw: null, endDate: null, bannerUrl: null, bannerSize: null, detailUrl: `${HOME}/event/1`, licensed: true }],
        eventSlices: null, heroBanners: null, sectionOverride: null, presetSections: null,
      } as any);
      expect(a.lineTemplate).toMatchObject({ id: 'special-event', by: 'best', copy: { cta_label: 2 } });
      const call = q.mock.calls.find((c: any) => String(c[0]).includes("meta->'recipe'->'lineTemplate'")) as any;
      expect(call[1][1]).toEqual(['beauty', 'health']);
    } finally {
      process.env = { ...ENV };
      q.mockReset();
    }
  });
});
