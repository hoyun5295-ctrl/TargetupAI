/**
 * ★ 2026-10-17 한 줄 → 단계별 모달(질문 · 재료) → 완성본 계약 테스트
 * 설계서 = docs/2026-10-17-oneline-steps-modal-design.md §9
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  oneLineStepsEnabled, linePeriodMentioned, lineTermFacts, lineUrls, buildLineStepsPlan, sanitizeLineStepsBody,
  buildLineStepsEventText, formatLinePeriodEnd, buildLineStepsIdempotencyKey, lineStepsKeyPrefix, lineStepsCharge,
  kstDayOf, lineStepsFp, isValidLinePeriodEnd, sanitizeLineUrl, LINE_STEP_KEYS, LINE_STEPS_MAX,
  type LineStepsPlanInput,
} from '../one-line-steps';
import { splitLineManualProducts, placeLineHero, placeLineLink, placeInAppLineMaterials, resolveLineLink, type LineInAppMessage } from '../line-materials';
import { findLineMallCandidates, mallProductNoFromLineUrl, type LineMallSearchDeps } from '../line-mall-candidates';
import { lineProductTerms } from '../one-line-facts';
import type { Section } from '../dm/dm-section-registry';

const C = '11111111-2222-3333-4444-555555555555';
const NOW = Date.parse('2026-10-17T03:00:00Z');   // KST 2026-10-17 12:00 (토)

const plan = (over: Partial<LineStepsPlanInput>) => buildLineStepsPlan({
  judged: '', line: '', typed: '', channel: 'dm', mall: false, inappBlocked: false, upload: true,
  website: null, mallHome: null, cost: { generate: 5, complete: 10, total: 15 }, lineFp: 'abcdefabcdef',
  ...over,
});
const forLine = (line: string, over: Partial<LineStepsPlanInput> = {}) => plan({ judged: line, line, typed: line, ...over });
const keys = (p: ReturnType<typeof buildLineStepsPlan>) => p.steps.map((s) => (s.item ? `${s.key}:${s.item}` : s.key));

describe('스위치 — 한 줄 보강 스위치 안에서만(좁히기만)', () => {
  it('두 명단 모두에 있어야 켜진다', () => {
    expect(oneLineStepsEnabled(C, '*', '*')).toBe(true);
    expect(oneLineStepsEnabled(C, '*', '')).toBe(false);
    expect(oneLineStepsEnabled(C, '', '*')).toBe(false);
    expect(oneLineStepsEnabled(C, C, `x,${C}`)).toBe(true);
    expect(oneLineStepsEnabled(null, '*', '*')).toBe(false);
  });
});

describe('기간 감지 — 「있음」 쪽으로 넓게(하나라도 있으면 묻지 않는다)', () => {
  it.each([
    '이번 주말까지 니트 20% 할인', '10월 20일 세일', '10/20 세일', '금요일 오픈 이벤트', '선착순 100명 쿠폰', '재고 소진 시 종료 특가',
    '추석 연휴 특가', '블프 세일', '오늘만 할인', 'D-3 세일', '월말 정산 세일', '3일간 할인', '~10.31 이벤트', '2026년 감사제',
  ])('묻지 않는다: %s', (line) => { expect(linePeriodMentioned(line)).toBe(true); });
  it.each(['니트 20% 할인 이벤트', '신상 코트 세일', '전 상품 할인 행사'])('묻는다: %s', (line) => { expect(linePeriodMentioned(line)).toBe(false); });
});

describe('상품 낱말의 가격 · 주소', () => {
  it('낱말 하나 = 한 줄 금액 · 주소', () => {
    expect(lineTermFacts('니트 39,000원 신상 출시', '니트', 1)).toEqual({ price: 39000 });
    expect(lineTermFacts('니트 신상 https://a.co/p/12?x=1', '니트', 1)).toEqual({ url: 'https://a.co/p/12?x=1' });
  });
  it('낱말 여럿 = 그 낱말 구획에서만(금액 자릿점 「,」는 나누지 않는다)', () => {
    const line = '니트 39,000원, 코트 129,000원';
    expect(lineTermFacts(line, '니트', 2)).toEqual({ price: 39000 });
    expect(lineTermFacts(line, '코트', 2)).toEqual({ price: 129000 });
    expect(lineTermFacts('니트랑 코트 20% 할인', '코트', 2)).toEqual({});
  });
  it('주소 속 「/」는 지킨다 · 끝 문장부호는 뗀다', () => {
    expect(lineUrls('링크 https://shop.co/product/a/12/. 확인')).toEqual(['https://shop.co/product/a/12/']);
  });
  it('잡음 낱말 보강 — 「고객님께」 「선착순」 「소진」은 검색어가 아니다', () => {
    expect(lineProductTerms('VIP 고객님께 감사 쿠폰 드려요')).not.toContain('고객님께');
    expect(lineProductTerms('VIP 고객님께 감사 쿠폰 드려요')).not.toContain('고객님');
    expect(lineProductTerms('선착순 소진 특가 니트')).toEqual(['니트']);
  });
});

describe('단계 목록 걸음표 — 채널 × 몰 × 표본 한 줄', () => {
  it('DM · 몰 없음 · 행사 의도만 = 혜택 · 사진 · 주소(기간 낱말 있음 = 기간 안 묻는다)', () => {
    expect(keys(forLine('11월 블프 전 상품 세일'))).toEqual(['benefit', 'hero_photo', 'link']);
  });
  it('DM · 몰 없음 · 가격 붙은 상품 = 직접 넣기 단계(가격 미리 채움)', () => {
    const p = forLine('니트 39,000원 신상 출시');
    expect(keys(p)).toEqual(['product:니트', 'hero_photo', 'link']);
    expect(p.steps[0]).toMatchObject({ manual_ok: true, price: 39000 });
  });
  it('DM · 몰 없음 · 가격 없는 상품 = 단계 대신 「넣을까요」 줄 · 기간 묻기', () => {
    const p = forLine('니트랑 코트 20% 할인');
    expect(keys(p)).toEqual(['hero_photo', 'link', 'period']);
    expect(p.offers.map((o) => o.item)).toEqual(['니트', '코트']);
  });
  it('DM · 몰 있음 = 낱말마다 고르기 · 상한 4(기간부터 미룬다)', () => {
    const p = forLine('니트랑 코트 20% 할인', { mall: true });
    expect(keys(p)).toEqual(['product:니트', 'product:코트', 'hero_photo', 'link']);
    expect(p.later).toEqual([{ key: 'period' }]);
    expect(p.steps.length).toBeLessThanOrEqual(LINE_STEPS_MAX);
  });
  it('상한을 넘으면 기간 → 3번째 → 2번째 상품 순으로 미룬다(혜택 · 첫 상품 · 사진 · 주소는 남는다)', () => {
    const p = forLine('니트랑 코트랑 셔츠 세일', { mall: true });
    expect(keys(p)).toEqual(['benefit', 'product:니트', 'hero_photo', 'link']);
    expect(p.later.map((l) => (l.item ? `${l.key}:${l.item}` : l.key))).toEqual(['period', 'product:셔츠', 'product:코트']);
  });
  it('이메일 · 사진을 올릴 수 없으면 사진 단계 대신 later · 건너뜀 조건 = 직접 올린 상품 사진', () => {
    expect(forLine('신상 코트 세일', { channel: 'email', upload: false }).later).toContainEqual({ key: 'hero_photo' });
    expect(forLine('신상 코트 세일', { channel: 'email' }).steps.find((s) => s.key === 'hero_photo')?.skip_if).toBe('manual_photo');
    expect(forLine('신상 코트 세일', { channel: 'dm' }).steps.find((s) => s.key === 'hero_photo')?.skip_if).toBe('product_photo');
  });
  it('인앱 = 상품 1개 · 기간 묻지 않음 · 표시 불가면 막힘만', () => {
    expect(keys(forLine('니트랑 코트 20% 할인', { channel: 'inapp', mall: true }))).toEqual(['product:니트', 'hero_photo', 'link']);
    const blocked = forLine('니트 세일', { channel: 'inapp', inappBlocked: true });
    expect(blocked.block).toBe('INAPP_DISPLAY_UNAVAILABLE');
    expect(blocked.steps).toEqual([]);
  });
  it('버튼 주소 — 한 줄 주소 · 홈페이지 · 몰 첫 화면이 있으면 단계 없음', () => {
    expect(forLine('세일 https://a.co/e').filled.link).toBe('https://a.co/e');
    expect(keys(forLine('세일 https://a.co/e'))).not.toContain('link');
    const w = forLine('신상 코트 세일', { website: 'https://brand.co' });
    expect(w.link_default).toEqual({ kind: 'website', url: 'https://brand.co' });
    expect(keys(w)).not.toContain('link');
    expect(forLine('신상 코트 세일', { mallHome: 'https://m.cafe24.com/' }).link_default?.kind).toBe('mall_home');
    expect(forLine('신상 코트 세일').steps.find((s) => s.key === 'link')?.skip_if).toBe('product_link');
  });
  it('행사가 아닌 한 줄(입고 소식) = 혜택 · 기간 안 묻는다', () => {
    expect(keys(forLine('신상 코트 입고 소식'))).toEqual(['hero_photo', 'link']);
  });
  it('단계 키는 닫힌 목록 안에서만', () => {
    for (const line of ['니트랑 코트랑 셔츠 세일', '니트 39,000원 https://a.co/1', '블프']) {
      for (const channel of ['dm', 'email', 'inapp'] as const) {
        for (const mall of [true, false]) {
          for (const s of forLine(line, { channel, mall }).steps) expect(LINE_STEP_KEYS).toContain(s.key);
        }
      }
    }
  });
});

describe('생성 요청 검증', () => {
  const ok = { steps: { v: 1 }, facts: { benefit: '전 상품 20%', period_end: '2026-10-20', link: 'https://a.co/e' }, manual_products: [{ name: '울 머플러', price: 29000, image: '/api/dm/v/images/x/a.jpg' }], hero_image: '/api/dm/v/images/x/h.jpg', expected_cost: 15, steps_meta: { shown: ['benefit'], answered: ['benefit'], skipped: [] } };
  it('정상', () => {
    const r = sanitizeLineStepsBody(ok, NOW);
    expect(r).toMatchObject({ facts: { benefit: '전 상품 20%', periodEnd: '2026-10-20', link: 'https://a.co/e' }, expectedCost: 15, heroImage: '/api/dm/v/images/x/h.jpg' });
  });
  it('steps 칸이 없으면 undefined(지금 그대로)', () => { expect(sanitizeLineStepsBody({ prompt: 'x' }, NOW)).toBeUndefined(); });
  it.each([
    ['버전', { ...ok, steps: { v: 2 } }],
    ['주소 스킴', { ...ok, facts: { link: 'javascript:alert(1)' } }],
    ['기간 형식', { ...ok, facts: { period_end: '2026-13-01' } }],
    ['기간 지난 날', { ...ok, facts: { period_end: '2026-10-10' } }],
    ['상품 4개', { ...ok, manual_products: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] }],
    ['가격 소수', { ...ok, manual_products: [{ name: 'a', price: 1.5 }] }],
    ['이름 없음', { ...ok, manual_products: [{ name: ' ' }] }],
    ['금액 음수', { ...ok, expected_cost: -1 }],
  ])('틀리면 invalid: %s', (_n, body) => { expect(sanitizeLineStepsBody(body as any, NOW)).toBe('invalid'); });
  it('주소 · 기간 판정', () => {
    expect(sanitizeLineUrl('https://user:pw@a.co')).toBeNull();
    expect(sanitizeLineUrl('ftp://a.co')).toBeNull();
    expect(isValidLinePeriodEnd('2026-02-30', NOW)).toBe(false);
    expect(isValidLinePeriodEnd('2026-10-16', NOW)).toBe(true);
  });
});

describe('원문 조립', () => {
  it('라벨 · 요일(UTC 계산) · 글로만 소개할 상품', () => {
    expect(formatLinePeriodEnd('2026-10-20')).toBe('2026년 10월 20일(화)');
    expect(buildLineStepsEventText('니트 세일', { benefit: '전 상품 20%', periodEnd: '2026-10-20', textProducts: [{ name: '울 머플러', price: 29000 }, { name: '코트' }] }))
      .toBe('니트 세일\n[혜택] 전 상품 20%\n[기간] 2026년 10월 20일(화)까지\n[상품] 울 머플러 29,000원, 코트');
    expect(buildLineStepsEventText('니트 세일', { benefit: null })).toBe('니트 세일');
  });
});

describe('돈 — 한 줄 완성 원장 키 · 금액', () => {
  it('키 길이 150 안 · 같은 접두 · 답 하나만 바꿔도 새 키 · steps_meta 는 키에 안 들어간다', () => {
    const day = kstDayOf(NOW);
    expect(day).toBe('20261017');
    const fp = lineStepsFp('니트 세일', undefined);
    const token = 'a'.repeat(64);
    const k1 = buildLineStepsIdempotencyKey(C, 'inapp', day, fp, token, { hero: 'x' });
    const k2 = buildLineStepsIdempotencyKey(C, 'inapp', day, fp, token, { hero: 'y' });
    expect(k1.length).toBeLessThanOrEqual(150);
    expect(k1.startsWith(lineStepsKeyPrefix(C, 'inapp', day, fp))).toBe(true);
    expect(k1).not.toBe(k2);
    expect(buildLineStepsIdempotencyKey(C, 'inapp', day, fp, token, { hero: 'x' })).toBe(k1);
    expect(lineStepsKeyPrefix(C, 'dm', day, fp)).toMatch(/^[A-Za-z0-9:-]+$/);
  });
  it('한 줄 지문 = 사용자가 친 부분(사진 조각 제외) · 공백 정리', () => {
    expect(lineStepsFp('니트  세일', undefined)).toBe(lineStepsFp('니트 세일', undefined));
    expect(lineStepsFp('니트 세일 · 30% 할인 행사', ['30% 할인 행사'])).toBe(lineStepsFp('니트 세일', undefined));
  });
  it('금액 = 생성비 + 10 · 오늘 낸 한 줄이면 생성비만', () => {
    expect(lineStepsCharge(5, 10, false, 'dm-ai-generate')).toEqual({ cost: 15, source: 'oneline-complete', completionDue: true });
    expect(lineStepsCharge(5, 10, true, 'dm-ai-generate')).toEqual({ cost: 5, source: 'dm-ai-generate', completionDue: false });
  });
});

describe('재료 놓기 (AI 를 지나지 않는다)', () => {
  const isCo = (u: string) => u.startsWith(`/api/dm/v/images/${C}/`);
  it('직접 상품 = 이 회사 사진 + 가격만 카드 · 그 밖 글줄 · 다른 주소 사진 = invalid', () => {
    const r = splitLineManualProducts([
      { name: '울 머플러', price: 29000, image: `/api/dm/v/images/${C}/a.jpg`, url: 'https://a.co/1' },
      { name: '코트', price: 129000 },
      { name: '셔츠' },
    ], isCo);
    expect(r).toEqual({
      cards: [{ name: '울 머플러', price: 29000, image_url: `/api/dm/v/images/${C}/a.jpg`, link_url: 'https://a.co/1' }],
      textProducts: [{ name: '코트', price: 129000 }, { name: '셔츠' }],
      images: [`/api/dm/v/images/${C}/a.jpg`],
      urls: ['https://a.co/1'],
    });
    expect(splitLineManualProducts([{ name: 'x', price: 1, image: 'https://evil.co/a.jpg' }], isCo)).toBe('invalid');
  });
  it('가격 없이 사진 · 주소만 넣은 상품 = 카드는 아니지만 사진 · 주소는 대표 사진 · 버튼 주소 재료로 남는다(Codex 1R)', () => {
    const r = splitLineManualProducts([{ name: '텀블러', image: `/api/dm/v/images/${C}/t.jpg`, url: 'https://a.co/t' }], isCo);
    expect(r).toEqual({ cards: [], textProducts: [{ name: '텀블러' }], images: [`/api/dm/v/images/${C}/t.jpg`], urls: ['https://a.co/t'] });
    expect(resolveLineLink({ cards: [], manualUrls: ['https://a.co/t'], website: 'https://w.co' })).toBe('https://a.co/t');
  });
  const sec = (type: string, props: Record<string, unknown> = {}, order = 0) => ({ id: `${type}-${order}`, type, order, props }) as unknown as Section;
  it('히어로 = 첫 히어로에 사진 · 없으면 머리 뒤에 하나 넣고 순서를 다시 매긴다', () => {
    const a = placeLineHero([sec('header', {}, 0), sec('hero', { headline: 'h' }, 1)], '/img.jpg', () => sec('hero'));
    expect((a[1].props as any).image_url).toBe('/img.jpg');
    const b = placeLineHero([sec('header', {}, 0), sec('cta', {}, 1)], '/img.jpg', (o) => sec('hero', { headline: '' }, o));
    expect(b.map((s) => s.type)).toEqual(['header', 'hero', 'cta']);
    expect(b.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(placeLineHero([sec('hero')], null, () => sec('hero'))).toHaveLength(1);
  });
  it('버튼 주소 = 첫 CTA 첫 버튼이 비어 있을 때만', () => {
    const filled = placeLineLink([sec('cta', { buttons: [{ label: 'a', url: '' }, { label: 'b', url: '' }] })], 'https://a.co');
    expect((filled[0].props as any).buttons.map((b: any) => b.url)).toEqual(['https://a.co', '']);
    const kept = placeLineLink([sec('cta', { buttons: [{ label: 'a', url: 'https://line.co' }] })], 'https://a.co');
    expect((kept[0].props as any).buttons[0].url).toBe('https://line.co');
  });
  it('주소 순서 = 답 → 한 줄 → 상품 링크 → 홈페이지 → 몰 첫 화면', () => {
    const card = { name: 'n', price: 1, image_url: '/i', link_url: 'https://p.co' };
    expect(resolveLineLink({ answer: 'https://ans.co', lineUrl: 'https://line.co', cards: [card], website: 'https://w.co' })).toBe('https://ans.co');
    expect(resolveLineLink({ lineUrl: 'https://line.co', cards: [card] })).toBe('https://line.co');
    expect(resolveLineLink({ cards: [card], website: 'https://w.co' })).toBe('https://p.co');
    expect(resolveLineLink({ cards: [], website: 'https://w.co', mallHome: 'https://m.co' })).toBe('https://w.co');
    expect(resolveLineLink({ cards: [], mallHome: 'https://m.co' })).toBe('https://m.co');
    expect(resolveLineLink({ cards: [] })).toBeNull();
  });
  const allowAll = () => true;
  const msg = (over: Partial<LineInAppMessage> = {}): LineInAppMessage => ({ template: 'center_modal', image_url: null, title: '제목', body: '본문', buttons: [{ id: 'b0', label: '보기', action_url: null }], content_blocks: [{ type: 'headline', text: '제목' }, { type: 'cta_group', buttons: [{ label: '보기', action_url: null }] }], ...over });
  it('인앱 = 사진(image_url + media 맨 앞) · 상품 블록 · 버튼 주소(빈 곳만)', () => {
    const card = { name: '니트', price: 39000, discount_price: 29000, image_url: '/p.jpg', link_url: 'https://p.co' };
    const out = placeInAppLineMaterials(msg(), { imageUrl: '/h.jpg', linkUrl: 'https://a.co', card }, allowAll);
    expect(out.image_url).toBe('/h.jpg');
    expect(out.content_blocks[0]).toMatchObject({ type: 'media', variant: 'image', url: '/h.jpg' });
    expect(out.content_blocks.find((b) => b.type === 'product')).toMatchObject({ name: '니트', price: 39000, discount_price: 29000, image: '/p.jpg', link_url: 'https://p.co' });
    expect(out.buttons[0].action_url).toBe('https://a.co');
    expect((out.content_blocks.find((b) => b.type === 'cta_group') as any).buttons[0].action_url).toBe('https://a.co');
  });
  it('인앱 · 사진이 없으면 포스터(full_image)를 쓰지 않는다(게시 관문이 사진을 요구)', () => {
    const out = placeInAppLineMaterials(msg({ template: 'full_image', content_blocks: [] }), {}, allowAll);
    expect(out.template).toBe('center_modal');
    expect(out.content_blocks.map((b) => b.type)).toEqual(['headline', 'body', 'cta_group']);
  });
  it('인앱 · 템플릿이 허용하지 않는 블록은 넣지 않는다', () => {
    const out = placeInAppLineMaterials(msg(), { imageUrl: '/h.jpg' }, (_t, b) => b !== 'media');
    expect(out.image_url).toBe('/h.jpg');
    expect(out.content_blocks.some((b) => b.type === 'media')).toBe(false);
  });
});

describe('몰 후보 — 낱말별 있음 · 없음 · 확인하지 못함', () => {
  const entry = { provider: 'cafe24', label: '카페24', relookup: true, home: 'https://mymall.cafe24.com/' };
  const product = (name: string, no: number) => ({ provider: 'cafe24', code: `P${no}`, name, price: 39000, salePrice: 29000, discountRate: 0, imageUrl: '/i.jpg', productUrl: `https://mymall.cafe24.com/product/detail.html?product_no=${no}` });
  const deps = (search: LineMallSearchDeps['search'], clock: { t: number } = { t: 0 }): LineMallSearchDeps => ({ search, lookup: async (_e, no) => ({ provider: 'cafe24', no, name: '주소 상품', price: 1, salePrice: 1, imageUrl: null, exact: true }), now: () => clock.t });
  it('있음 · 없음 · 장애 = 확인하지 못함', async () => {
    const r = await findLineMallCandidates(C, {} as any, '니트랑 코트랑 셔츠 세일', {
      maxTerms: 3, providers: { list: [entry], failed: false },
      deps: deps(async (_e, term) => { if (term === '니트') return [product('니트', 1)]; if (term === '코트') return []; throw new Error('down'); }),
    });
    expect(r.by_term.map((t) => `${t.term}:${t.status}`)).toEqual(['니트:ok', '코트:none', '셔츠:unknown']);
    expect(r.by_term[0].candidates[0]).toMatchObject({ provider: 'cafe24', no: '1', exact: true });
  });
  it('시간을 넘기면 그 뒤로는 부르지 않는다(늦은 요청과 겹침 0)', async () => {
    const clock = { t: 0 };
    const search = vi.fn(async () => { clock.t += 6000; return [product('니트', 1)]; });
    const r = await findLineMallCandidates(C, {} as any, '니트랑 코트 세일', { maxTerms: 3, timeoutMs: 5000, providers: { list: [entry], failed: false }, deps: deps(search, clock) });
    expect(search).toHaveBeenCalledTimes(1);
    expect(r.by_term[1].status).toBe('unknown');
  });
  it('몰 없음 = none · 몰 목록 모름 = unknown', async () => {
    const none = await findLineMallCandidates(C, {} as any, '니트 세일', { maxTerms: 3, providers: { list: [], failed: false }, deps: deps(async () => []) });
    expect(none.by_term[0].status).toBe('none');
    const unknown = await findLineMallCandidates(C, {} as any, '니트 세일', { maxTerms: 3, providers: { list: [], failed: true }, deps: deps(async () => []) });
    expect(unknown.by_term[0].status).toBe('unknown');
  });
  it('한 줄 속 주소 = 그 몰 기본 주소일 때만 상품번호(남의 몰 같은 번호 오인 0)', () => {
    expect(mallProductNoFromLineUrl('https://mymall.cafe24.com/product/detail.html?product_no=12', entry)).toBe('12');
    expect(mallProductNoFromLineUrl('https://other.cafe24.com/product/detail.html?product_no=12', entry)).toBeNull();
    expect(mallProductNoFromLineUrl('https://shop.co/?p=3', { provider: 'woocommerce:shop.co', label: '', relookup: true, home: 'https://www.shop.co' })).toBe('3');
  });
});

describe('라우트 소스 계약 — 돈 순서', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
  const at = (src: string, needle: string) => { const i = src.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
  it('DM — 한 줄 잠금 → 재요청 판정(오늘 · 어제 키) → 금액 확정 → 몰 재조회 → 생성 → 차감(낸 것만 건넴) · 단계 요청은 착지 경로만', () => {
    const src = read('../../routes/dm.ts');
    const lock = at(src, 'if (!tryAcquireInflight(stepsLock))');
    const charged = at(src, "charged = steps ? await lineStepsAttemptCharged(steps, companyId, 'dm', stepsPayload) : await isChargedByKey(companyId, idemKey)");
    expect(lock).toBeLessThan(charged);
    expect(src).toContain('if (lineStepsCollected(outcome)) {');
    expect(src).toContain('if (stepsLockHeld) releaseInflight(stepsLock);');
    const settle = at(src, "await settleLineStepsPrice(steps, companyId, 'dm', stepsNow)");
    const mall = at(src, 'await resolveLineMallCards(companyId, lineActor, lineProducts)');
    const gen = at(src, 'const r = await oneShotGenerate({');
    const deduct = at(src, 'outcome = await deductCreditOutcome({ companyId, cost: genCost, source: genSource');
    expect(charged).toBeLessThan(settle);
    expect(settle).toBeLessThan(mall);
    expect(mall).toBeLessThan(gen);
    expect(gen).toBeLessThan(deduct);
    expect(src).toContain("if (steps && req.body?.land !== 'result')");
  });
  it('이메일 — 한 줄 잠금 → 재요청 판정(오늘 · 어제 키) → 금액 확정 → 생성 → 재료 놓기 → 차감 → 낸 것만 건넴(실패 = 503)', () => {
    const src = read('../../routes/email.ts');
    const lock = at(src, 'if (!tryAcquireInflight(stepsLock))');
    const charged = at(src, "charged = steps ? await lineStepsAttemptCharged(steps, auth.companyId, 'email', stepsPayload) : await isChargedByKey(auth.companyId, idemKey)");
    const settle = at(src, "await settleLineStepsPrice(steps, auth.companyId, 'email', stepsNow)");
    const gen = at(src, 'const result = await generateEmailSections({');
    const place = at(src, '(result as any).sections = placeLineLink(placeLineHero(');
    const deduct = at(src, 'const outcome = await deductCreditOutcome({ companyId: auth.companyId, cost, source: stepsCharge.source, createdBy: auth.userId, ...(idemKey ? { idempotencyKey: idemKey } : {}), throwOnInsufficient: true });');
    const collected = at(src, 'if (!lineStepsCollected(outcome)) {');
    for (const [a, b] of [[lock, charged], [charged, settle], [settle, gen], [gen, place], [place, deduct], [deduct, collected]]) expect(a).toBeLessThan(b);
    expect(src).toContain('if (stepsLockHeld) releaseInflight(stepsLock);');
  });
  it('인앱 — 생성기를 묶음 안에서 부르고(안쪽 차감 0) 재료를 놓은 뒤 1회 차감', () => {
    const src = read('../../routes/cdp.ts');
    const settle = at(src, "await settleLineStepsPrice(steps, auth.companyId, 'inapp', stepsNow)");
    const gen = at(src, 'await runInCreditBundle(() => generateInAppMessagePackage(');
    const place = at(src, 'pkg.message = placeInAppLineMaterials(');
    const deduct = at(src, 'const outcome = await deductCreditOutcome({ companyId: auth.companyId, cost: price.cost, source: price.source, createdBy: auth.userId, idempotencyKey: idemKey, throwOnInsufficient: true })');
    const lock = at(src, 'if (!tryAcquireInflight(lineLock))');
    const charged = at(src, "charged = await lineStepsAttemptCharged(steps, auth.companyId, 'inapp', stepsPayload)");
    expect(lock).toBeLessThan(charged);
    expect(charged).toBeLessThan(settle);
    expect(settle).toBeLessThan(gen);
    expect(gen).toBeLessThan(place);
    expect(place).toBeLessThan(deduct);
    expect(deduct).toBeLessThan(at(src, 'if (!lineStepsCollected(outcome)) {'));
    expect(src).toContain('if (lineLockHeld) releaseInflight(lineLock);');
  });
  it('몰 목록 = 카페24 상태 active 만(휴면 · 해제 제외)', () => {
    expect(read('../mall-providers.ts')).toContain("cafe && cafe.status === 'active'");
  });
});

describe('화면 몸통 ↔ 서버 검증 짝(화면이 만든 몸통을 서버가 그대로 받는다)', () => {
  const p = forLine('니트 39,000원 신상 출시 세일', { mall: true });
  const term = '니트';
  const cand = { provider: 'cafe24', no: '12', name: '울 니트', price: 39000, salePrice: 29000, imageUrl: '/i.jpg', exact: false };
  it('직접 넣은 상품 · 사진 · 혜택 없음 · 기간 = 서버 검증 통과 · 금액 · 몸통 칸', async () => {
    const fe = await import('../../../../frontend/src/utils/one-line');
    const a = { ...fe.emptyLineStepsAnswers(), benefit: null, products: { [term]: { mode: 'manual' as const, manual: { name: ' 울 니트 ', price: '39,000', image: `/api/dm/v/images/${C}/a.jpg` } } }, hero: `/api/dm/v/images/${C}/h.jpg`, period: '2026-10-20' };
    const shown = p.steps.filter((s) => !fe.lineStepSkipped(s as any, a, 'dm', fe.lineStepTerms(p as any, a)));
    // 직접 상품 사진이 있으면 대표 사진 단계는 건너뜀(DM = product_photo) → 대표 사진은 보내지 않는다
    expect(shown.map((s) => s.key)).not.toContain('hero_photo');
    const body = fe.buildLineStepsBody(p as any, a, shown as any, 15);
    expect(body).toMatchObject({ steps: { v: 1 }, manual_products: [{ name: '울 니트', price: 39000, image: `/api/dm/v/images/${C}/a.jpg` }], products: [], expected_cost: 15 });
    expect(body).not.toHaveProperty('hero_image');
    const server = sanitizeLineStepsBody(body, NOW);
    expect(server).not.toBe('invalid');
    expect(server).toMatchObject({ expectedCost: 15, manual: [{ name: '울 니트', price: 39000 }] });
  });
  it('몰 후보를 고르면 상품번호만 · 인앱은 1개 · 주소로 찾은 상품 뒤', async () => {
    const fe = await import('../../../../frontend/src/utils/one-line');
    const a = { ...fe.emptyLineStepsAnswers(), products: { [term]: { mode: 'pick' as const, picked: cand } }, urlPicks: [{ ...cand, no: '99' }] };
    expect(fe.lineStepsProducts(a, 'dm', [term]).map((c) => c.no)).toEqual(['12', '99']);
    expect(fe.lineStepsProducts(a, 'inapp', [term]).map((c) => c.no)).toEqual(['12']);
    const body = fe.buildLineStepsBody(p as any, a, p.steps as any, 15);
    expect(body.products).toEqual([{ provider: 'cafe24', no: '12' }, { provider: 'cafe24', no: '99' }]);
    expect(sanitizeLineStepsBody(body, NOW)).not.toBe('invalid');
  });
  it('주소 정리 = 스킴 없으면 https · 사용자 정보 · 점 없는 호스트 거절(서버와 같은 쪽으로)', async () => {
    const fe = await import('../../../../frontend/src/utils/one-line');
    expect(fe.normalizeLineLink('myshop.co.kr/event')).toBe('https://myshop.co.kr/event');
    expect(fe.normalizeLineLink('https://u:p@a.co')).toBeNull();
    expect(fe.normalizeLineLink('localhost')).toBeNull();
    expect(sanitizeLineUrl(fe.normalizeLineLink('myshop.co.kr/event'))).not.toBeNull();
    expect(fe.lineManualPrice('100,000,001')).toBeNull();
    expect(fe.lineManualPrice('39,000')).toBe(39000);
  });
});

describe('같은 시도 판정 · 한 줄 잠금 · 결말 (Codex 1R)', () => {
  beforeEach(() => { vi.resetModules(); });
  const body = { steps: { v: 1 }, facts: {}, manual_products: [{ name: '텀블러', image: `/api/dm/v/images/${C}/t.jpg`, url: 'https://a.co/t' }], expected_cost: 13, attempt_token: 'a'.repeat(32) };
  it('오늘 키와 어제(KST) 키를 함께 묻는다 · 잠금 키 = 회사 · 채널 · 날짜 · 한 줄 지문', async () => {
    const asked: string[][] = [];
    vi.doMock('../ai-credit', async (orig) => ({ ...(await orig<typeof import('../ai-credit')>()), chargedKeysAmong: async (_c: string, keys: string[]) => { asked.push(keys); return new Set([keys[1]]); } }));
    const ctx = await import('../line-steps-context');
    const prep = ctx.prepareLineStepsRequest(body, C, '텀블러 소개', undefined, NOW, true);
    if (!prep || ctx.isLineStepsReqError(prep)) throw new Error('prep');
    expect([prep.day, prep.prevDay]).toEqual(['20261017', '20261016']);
    expect(prep.manualImages).toEqual([`/api/dm/v/images/${C}/t.jpg`]);
    expect(prep.manualUrls).toEqual(['https://a.co/t']);
    // 어제 키로 이미 낸 같은 시도(자정 뒤 재전송) = 이미 처리됨
    expect(await ctx.lineStepsAttemptCharged(prep, C, 'email', { x: 1 })).toBe(true);
    expect(asked[0]).toEqual([ctx.lineStepsKeyFor(prep, C, 'email', { x: 1 }), buildLineStepsIdempotencyKey(C, 'email', '20261016', prep.fp, prep.token, { x: 1 })]);
    expect(ctx.lineStepsAttemptKeys(prep, C, 'email', { x: 1 })).toEqual(asked[0]);
    expect(ctx.lineStepsLineLockKey(prep, C, 'email')).toBe(`oneline-steps-line:${lineStepsKeyPrefix(C, 'email', '20261017', prep.fp)}`);
    expect(['deducted', 'duplicate', 'not_applicable'].every((o) => ctx.lineStepsCollected(o as any))).toBe(true);
    expect(ctx.lineStepsCollected('failed')).toBe(false);
    expect(ctx.lineStepsCollected('')).toBe(false);
    vi.doUnmock('../ai-credit');
  });
});

describe('원장 접두 조회 — 고정 형식만(LIKE 와일드카드 주입 차단)', () => {
  beforeEach(() => { vi.resetModules(); });
  it('형식 밖 접두는 던진다', async () => {
    const { hasChargeWithKeyPrefix } = await import('../ai-credit');
    await expect(hasChargeWithKeyPrefix(C, 'oneline-complete', 'olc:%')).rejects.toThrow();
  });
});
