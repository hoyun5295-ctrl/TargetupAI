/**
 * 한줄 프롬프트 CT(두뇌) 계약 시험 (★ 2026-10-22 · 설계서 docs/2026-10-22-oneline-ct-design.md §11)
 *   단가(판단 2 · 합계 15 · 다시 3) · 구성 5종 조립 · 칸 세 종류 · 재료 판 · 판단(AI 실패 = 규칙 0원) · 미리보기 점선 · 입구 배선.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn() }));
vi.mock('../brand-basic-info', () => ({ getBrandBasicInfo: vi.fn(async () => ({ brand_name: '한줄 뷰티', company_name: '한줄', industry_code: 'beauty' })) }));
vi.mock('../ai-credit', () => ({
  checkCredit: vi.fn(async () => undefined),
  deductCreditOutcome: vi.fn(async () => 'deducted'),
  InsufficientCreditError: class InsufficientCreditError extends Error {},
  hasChargeWithKeyPrefix: vi.fn(async () => false),
  chargedKeysAmong: vi.fn(async () => new Set<string>()),
}));

import { callAIWithFallback } from '../../services/ai';
import { deductCreditOutcome, chargedKeysAmong, checkCredit } from '../ai-credit';
import { lineStepsCharge, lineStepsKeyPrefix, lineStepsLegacyKeyPrefix, sanitizeLineRichBody, sanitizeLineStepsBody, LINE_PRICE } from '../one-line-steps';
import {
  LINE_COMPOSITIONS, getLineComposition, composeRichDm, composeRichEmail, composeRichInapp, compositionGate, compositionFallbackCopy,
  compositionMissing, compositionBlocking, compositionBlockingFor, rankCompositions, type LineRichMaterials,
} from '../line-compositions';
import { buildCompositionPlan, runLineJudge, _resetLineJudgeMemory, lineCookMaterials, lineCookManual, draftLineCook, LineJudgeBusyError } from '../one-line-ct';
import { resolveLineStepsCharge } from '../line-steps-context';
import { hasChargeWithKeyPrefix } from '../ai-credit';
import { lineFpLockKey } from '../one-line-steps';
import { tryAcquireInflight, releaseInflight } from '../inflight-lock';
import { plannerTemplateMissing, plannerTemplateDef } from '../planner-build';
import { sanitizeLineJudge, cleanLineCtText } from '../one-line-ct/ai';
import { renderCompositionPreview, previewMaterials } from '../one-line-ct/preview';
import { aiLineBaseKeyOfFp, aiLineBaseKey } from '../ai-line';
import { lineFingerprint } from '../one-line-steps';

const C = '1be15adb-84b8-4025-9957-5c2d39076c1d';
const img = (n: string) => `/api/dm/v/images/${C}/${n}.jpg`;
let idn = 0;
const newId = () => `s${++idn}`;

const rich = (over: Partial<LineRichMaterials> = {}): LineRichMaterials => ({
  brandName: '한줄 뷰티', poster: { url: img('poster'), asIs: true },
  products: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `상품 ${i}`, price: 30000, discount_price: 21000, image_url: img(`p${i}`), category: i <= 2 ? '아우터' : i <= 4 ? '원피스' : i === 5 ? '잡화' : '신발' })),
  points: [{ title: '자극 없이 진정', body: '순한 성분', image_url: img('f1') }, { title: '빠른 흡수', body: '끈적임 없이', image_url: img('f2') }, { title: '오래 촉촉', body: '하루 종일' }],
  steps: [{ title: '토너', body: '결 정돈' }, { title: '앰플', body: '두 방울' }],
  mood: [img('m1'), img('m2'), img('m3')],
  proof: [{ body: '수분이 꽉 차요', author: '김**', rating: 5 }, { body: '재구매했어요', author: '이**', rating: 5 }],
  benefit: '출시 기념 20% 할인', benefitNote: '3만원 이상', couponCode: 'WELCOME10', periodEnd: '2026-12-31', periodLabel: '12월 31일까지', link: 'https://example.com',
  store: { address: '서울 마포구', business_hours: '11:00 ~ 22:00', phone: '02-000-0000' },
  ...over,
});

describe('단가 (Harold 확정 · 입구 무관)', () => {
  it('판단 2 · 판단 뒤 첫 결과물 13 · 판단 없이 15 · 다시 3', () => {
    expect(LINE_PRICE).toEqual({ judge: 2, total: 15, again: 3 });
    expect(lineStepsCharge(false, true).cost + LINE_PRICE.judge).toBe(15);
    expect(lineStepsCharge(false, false).cost).toBe(15);
    expect(lineStepsCharge(true, false)).toEqual({ cost: 3, source: 'oneline-recook', completionDue: false });
  });
  it('완성 원장 접두에 채널이 없다(같은 한 줄 = 입구가 달라도 완성 한 번) · 옛 접두는 읽기 전용', () => {
    expect(lineStepsKeyPrefix(C, 'dm', '20261022', 'abc')).toBe(lineStepsKeyPrefix(C, 'email', '20261022', 'abc'));
    expect(lineStepsKeyPrefix(C, 'dm', '20261022', 'abc')).toBe(`olc:${C}:20261022:abc:`);
    expect(lineStepsLegacyKeyPrefix(C, 'dm', '20261022', 'abc')).toBe(`olc:${C}:dm:20261022:abc:`);
  });
  it('판단 키 = 문자 입구(AI 한줄로) 대상 찾기 키와 같다', () => {
    const now = new Date('2026-10-22T03:00:00Z');
    expect(aiLineBaseKeyOfFp(C, lineFingerprint('겨울 세일'), now)).toBe(aiLineBaseKey(C, '겨울 세일', now));
  });
});

describe('구성 5종 조립', () => {
  it.each(LINE_COMPOSITIONS.map((c) => c.id))('%s = 풍성한 재료로 관문 통과 · 구역 6개 이상 · 버튼 하나', (id) => {
    const comp = getLineComposition(id)!;
    const r = composeRichDm(comp, rich(), compositionFallbackCopy(comp), newId);
    expect(compositionGate(r.sections)).toEqual([]);
    expect(r.sections.filter((s) => s.type !== 'header' && s.type !== 'footer').length).toBeGreaterThanOrEqual(6);
    expect(r.sections.filter((s) => s.type === 'cta').length).toBe(1);
    // 같은 사진 한 번
    const imgs = JSON.stringify(r.sections).match(/\/api\/dm\/v\/images\/[^"]+/g) || [];
    expect(new Set(imgs).size).toBe(imgs.length);
  });
  it('글자 박힌 포스터 = 아래 문구 카드에 큰 제목을 다시 쓰지 않는다 · 올린 사진 = 제목', () => {
    const comp = getLineComposition('spotlight')!;
    const copy = compositionFallbackCopy(comp);
    const asIs = composeRichDm(comp, rich(), copy, newId).sections.find((s) => (s as any).tpl_slot?.endsWith('.cover-copy'))!;
    expect((asIs.props as any).headline).toBeUndefined();
    const photo = composeRichDm(comp, rich({ poster: { url: img('x') } }), copy, newId).sections.find((s) => (s as any).tpl_slot?.endsWith('.cover-copy'))!;
    expect((photo.props as any).headline).toBe(copy.headline);
  });
  it('후기 별 색 = 구성 주색(옅은 강조색으로 안 보이던 결함)', () => {
    const comp = getLineComposition('spotlight')!;
    const rv = composeRichDm(comp, rich(), compositionFallbackCopy(comp), newId).sections.find((s) => s.type === 'reviews')!;
    expect((rv.props as any).star_color).toBe(comp.primary);
  });
  it('하나뿐인 종류는 「그 밖에 추천」으로 합친다(외톨이 진열 0)', () => {
    const comp = getLineComposition('lookbook')!;
    const r = composeRichDm(comp, rich(), compositionFallbackCopy(comp), newId);
    const titles = r.sections.filter((s) => s.type === 'text_card' && String((s as any).tpl_slot).includes('cat-')).map((s) => (s.props as any).headline);
    expect(titles).toContain('그 밖에 추천');
    for (const g of r.sections.filter((s) => s.type === 'product_carousel' && String((s as any).tpl_slot).includes('cat-'))) expect(((g.props as any).products as unknown[]).length).toBeGreaterThanOrEqual(2);
  });
  it('재료가 비면 그 구역이 없다(자리표시 0) · 사진 없는 참여 방법 = 번호 목록 한 구역', () => {
    const comp = getLineComposition('event')!;
    const r = composeRichDm(comp, rich({ poster: null, products: [], points: [{ title: '가입', body: '' }, { title: '쿠폰 받기', body: '' }, { title: '쓰기', body: '' }], proof: [] }), compositionFallbackCopy(comp), newId);
    expect(compositionGate(r.sections)).toEqual([]);
    expect(r.sections.some((s) => s.type === 'product_carousel')).toBe(false);
    expect(r.sections.filter((s) => s.type === 'text_card' && (s as any).treatment === 'framed').length).toBe(1);
  });
  it('슬라이드로 바꿀 장 키 = 받침은 앞 장 · 구역 제목은 다음 구역과 같은 장', () => {
    const comp = getLineComposition('spotlight')!;
    const r = composeRichDm(comp, rich(), compositionFallbackCopy(comp), newId);
    expect(r.pages.length).toBeGreaterThanOrEqual(3);
    const page = (part: string) => Number(/^p(\d+)\./.exec(String((r.sections.find((s) => String((s as any).tpl_slot).endsWith(`.${part}`)) as any)?.tpl_slot))?.[1]);
    expect(page('cover-copy')).toBe(page('cover'));
    expect(page('steps-title')).toBe(page('steps'));
    expect(page('cta')).toBe(page('closing'));
  });
  it('이메일 = 탭 없음(번호 목록) · 번갈이 바탕 없음 · 인앱 = 한 장(그림 · 혜택 · 버튼)', () => {
    const comp = getLineComposition('spotlight')!;
    const e = composeRichEmail(comp, rich(), compositionFallbackCopy(comp), newId);
    expect(e.sections.some((s) => s.type === 'tab_cards')).toBe(false);
    expect(e.sections.some((s) => (s as any).background)).toBe(false);
    const m = composeRichInapp(comp, rich(), compositionFallbackCopy(comp));
    expect(m.template).toBe('center_modal');
    expect(m.content_blocks.map((b) => b.type)).toEqual(expect.arrayContaining(['media', 'headline', 'benefit', 'cta_group']));
  });
});

describe('칸 세 종류 · 진단', () => {
  it('막는 칸만 만들기를 막는다(세일 = 혜택 · 마감 · 상품 4) · 후기는 빠지는 칸', () => {
    const comp = getLineComposition('showcase')!;
    const empty = rich({ benefit: null, periodEnd: null, products: [], proof: [] });
    expect(compositionBlocking(comp, empty).map((s) => s.key).sort()).toEqual(['benefit', 'periodEnd', 'products']);
    expect(compositionMissing(comp, empty).find((s) => s.key === 'proof')?.level).toBe('drop');
    expect(compositionBlocking(comp, rich())).toEqual([]);
  });
  it('재료 판 = 첫 화면 → (비연동) 페이지 주소 → 구성 칸 → 버튼 주소 · 인앱 = 표지 · 상품 · 혜택만', () => {
    const input = { judged: '겨울 세일 30%', line: '겨울 세일 30%', typed: '겨울 세일 30%', channel: 'dm' as const, mall: false, inappBlocked: false, upload: true, website: null, mallHome: null, cost: null, lineFp: 'x' };
    const dm = buildCompositionPlan(getLineComposition('showcase')!, input);
    expect(dm.steps.map((s) => s.key)).toEqual(['hero_photo', 'event_page', 'benefit', 'period', 'products', 'coupon_code', 'proof', 'link']);
    expect(dm.steps.find((s) => s.key === 'products')).toMatchObject({ required: true, level: 'block', min: 4 });
    expect(dm.steps.find((s) => s.key === 'benefit')).toMatchObject({ required: true, level: 'block' });
    const inapp = buildCompositionPlan(getLineComposition('spotlight')!, { ...input, channel: 'inapp', mall: true, website: 'https://a.co' });
    expect(inapp.steps.map((s) => s.key)).toEqual(['hero_photo', 'products', 'benefit']);
    expect(inapp.steps.find((s) => s.key === 'products')?.max).toBe(1);
  });
  it('규칙 추천 = 낱말 2 + 업종 1', () => {
    expect(rankCompositions('겨울 시즌오프 최대 30%', 'fashion')[0].id).toBe('showcase');
    expect(rankCompositions('겨울 신메뉴 출시', 'food')[0].id).toBe('menu');
    expect(rankCompositions('회원의 날 이벤트', null)[0].id).toBe('event');
  });
});

describe('요청 칸 검증', () => {
  it('구성 재료 칸 = 닫힌 모양 · 틀리면 invalid · 구성 id 는 template 칸', () => {
    expect(sanitizeLineRichBody({ points: [{ title: '진정', body: '순함' }], coupon_code: 'WELCOME10', store: { address: '서울' } }, [])).toMatchObject({ couponCode: 'WELCOME10', store: { address: '서울' } });
    expect(sanitizeLineRichBody({ coupon_code: '할인 코드' }, [])).toBe('invalid');
    expect(sanitizeLineRichBody({ points: [{ title: '', body: '' }] }, [])).toBe('invalid');
    expect(sanitizeLineRichBody({ mood: [1] }, [])).toBe('invalid');
    const b = sanitizeLineStepsBody({ steps: { v: 1 }, template: { id: 'menu', layout: 'page' }, rich: { mood: [img('m')] }, manual_products: [{ name: '굴국밥', price: 12000, category: '식사' }] }, Date.now());
    expect(b && b !== 'invalid' && b.template?.id).toBe('menu');
    expect(b && b !== 'invalid' && b.rich.categories).toEqual(['식사']);
    expect(sanitizeLineStepsBody({ steps: { v: 1 }, rich: { mood: [] } }, Date.now())).toBe('invalid');   // 구성 없이 재료 칸 = 거절
  });
  it('직접 상품 = 사진 있는 것만 카드 · 종류는 같은 순서', () => {
    expect(lineCookManual([{ name: 'a', image: img('a') }, { name: 'b' }, { name: 'c', image: img('c') }], ['x', 'y', null])).toEqual({
      cards: [{ name: 'a', price: 0, image_url: img('a') }, { name: 'c', price: 0, image_url: img('c') }], categories: ['x', null],
    });
  });
  it('요리 재료 = 포스터 asIs 는 올린 그림일 때만 · 혜택 원문 그대로', () => {
    const { materials } = lineCookMaterials({
      composition: getLineComposition('spotlight')!, channel: 'dm', companyId: C, line: '앰플 출시', brandName: 'b', logoUrl: null, csPhone: null, pinnedPrimary: null,
      cards: [], heroUpload: img('h'), heroAsIs: true, proof: [], page: null, benefitAnswer: ' 20% 할인 ', periodEnd: null, link: null,
      rich: { points: [], usage: [], mood: [], couponCode: null, store: null, benefitNote: null, categories: [] },
    });
    expect(materials.poster).toEqual({ url: img('h'), asIs: true });
    expect(materials.benefit).toBe('20% 할인');
  });
});

describe('② 판단(AI 1회 · 2크레딧 · 실패 = 규칙 0원)', () => {
  beforeEach(() => {
    _resetLineJudgeMemory();
    vi.mocked(callAIWithFallback).mockReset();
    vi.mocked(deductCreditOutcome).mockClear();
    vi.mocked(deductCreditOutcome).mockResolvedValue('deducted');
    vi.mocked(chargedKeysAmong).mockResolvedValue(new Set());
    vi.mocked(checkCredit).mockResolvedValue(undefined);
  });
  it('AI 성공 = 고른 구성 · 초안 · 판단 키로 2 정산(성공 뒤)', async () => {
    vi.mocked(callAIWithFallback).mockResolvedValue(JSON.stringify({ pick: 'spotlight', reason: '신제품 출시라 상품을 크게 보여 줘요', drafts: { spotlight: { points: [{ title: '자극 없이', body: '순한 성분' }], steps: [{ title: '토너', body: '결 정돈' }] } } }));
    const r = await runLineJudge({ companyId: C, line: '진정 앰플 출시', lineFp: 'fp1', productNames: [] , nowMs: Date.parse('2026-10-22T03:00:00Z') });
    expect(r).toMatchObject({ pick: 'spotlight', source: 'ai', charged: true });
    expect(r.drafts.spotlight?.points?.[0].title).toBe('자극 없이');
    expect(vi.mocked(deductCreditOutcome).mock.calls[0][0]).toMatchObject({ cost: 2, source: 'oneline-judge', throwOnInsufficient: true, idempotencyKey: aiLineBaseKeyOfFp(C, 'fp1', new Date('2026-10-22T03:00:00Z')) });
  });
  it('AI 실패 = 규칙 판단 · 0원', async () => {
    vi.mocked(callAIWithFallback).mockRejectedValue(new Error('down'));
    const r = await runLineJudge({ companyId: C, line: '겨울 시즌오프 30%', lineFp: 'fp2', productNames: [] });
    expect(r).toMatchObject({ source: 'rule', charged: false, note: 'AI_FAILED' });
    expect(deductCreditOutcome).not.toHaveBeenCalled();
  });
  it('오늘 · 어제 이미 판단을 냈으면 다시 걷지 않는다', async () => {
    vi.mocked(chargedKeysAmong).mockResolvedValue(new Set(['k']));
    vi.mocked(callAIWithFallback).mockResolvedValue(JSON.stringify({ pick: 'menu', reason: '새 메뉴', drafts: {} }));
    const r = await runLineJudge({ companyId: C, line: '겨울 신메뉴', lineFp: 'fp3', productNames: [] });
    expect(r).toMatchObject({ pick: 'menu', charged: false, paid: true });
    expect(deductCreditOutcome).not.toHaveBeenCalled();
  });
  it('크레딧제 미적용 = 걷지 않음(charged false) · 원장 쓰기 실패 = AI 결과를 건네지 않는다(규칙 0원)', async () => {
    vi.mocked(callAIWithFallback).mockResolvedValue(JSON.stringify({ pick: 'event', reason: '참여 이벤트', drafts: {} }));
    vi.mocked(deductCreditOutcome).mockResolvedValueOnce('not_applicable');
    expect(await runLineJudge({ companyId: C, line: '회원의 날', lineFp: 'fp4', productNames: [] })).toMatchObject({ source: 'ai', charged: false });
    _resetLineJudgeMemory();
    vi.mocked(deductCreditOutcome).mockResolvedValueOnce('failed');
    expect(await runLineJudge({ companyId: C, line: '회원의 날', lineFp: 'fp5', productNames: [] })).toMatchObject({ source: 'rule', charged: false, note: 'AI_FAILED' });
  });
  it('목록 밖 구성 · 지어낸 숫자 · 혜택 = 버린다(규칙 · 빈 칸)', () => {
    const r = sanitizeLineJudge({ pick: 'magazine', reason: '50% 할인이 좋아요', drafts: { spotlight: { points: [{ title: '1위 상품', body: '무료 배송' }, { title: '촉촉함', body: '하루 종일' }] } } }, '앰플 출시');
    expect(r.pick).toBeNull();
    expect(r.reason).toBe('');
    expect(r.drafts.spotlight?.points?.map((p) => p.title)).toEqual(['촉촉함']);
    expect(cleanLineCtText('새 시즌 — 신상', 20, '')).toBe('새 시즌 신상');
  });
});

describe('미리보기(점선 자리 · AI 0)', () => {
  it('빈 칸 = 점선 자리(결과물 조립엔 없다) · 재료 칸 걸러 받기', () => {
    const comp = getLineComposition('showcase')!;
    const m = previewMaterials({ products: [{ name: '니트', price: 59000, image_url: 'javascript:alert(1)' }], benefit: '30%' }, Date.now());
    expect(m.products).toEqual([]);
    const v = renderCompositionPreview(comp, 'dm', m);
    expect(v.html).toContain('세일 마감일');
    expect(v.missing).toBeGreaterThan(0);
    const real = composeRichDm(comp, m, compositionFallbackCopy(comp), newId);
    expect(JSON.stringify(real.sections)).not.toContain('세일 마감일');
  });
});

describe('입구 배선(라우트 소스 계약)', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
  it('DM · 이메일 · 인앱 = 구성 id 면 한줄 CT 요리(같은 돈 순서 안)', () => {
    const dm = read('../../routes/dm.ts');
    expect(dm).toContain('const compDef = tplSel && !tplDef ? getLineComposition(tplSel.id) : null;');
    expect(dm.indexOf('const cook = await draftLineCook({')).toBeLessThan(dm.indexOf('outcome = await deductCreditOutcome({ companyId, cost: genCost, source: genSource'));
    expect(dm).toContain('...(compDef ? { rich: steps.body.rich } : {})');
    const em = read('../../routes/email.ts');
    expect(em.indexOf('const cook = await draftLineCook({')).toBeLessThan(em.indexOf('const tplOutcome = await deductCreditOutcome('));
    const cdp = read('../../routes/cdp.ts');
    expect(cdp.indexOf('const cook = await draftLineCook({')).toBeLessThan(cdp.indexOf('const outcome = await deductCreditOutcome({ companyId: auth.companyId, cost: price.cost'));
  });
  it('판정 = 구성 재료 판(AI 0) · 판단 = 별도 경로 · 미리보기 = 0원 경로', () => {
    const ai = read('../../routes/ai.ts');
    expect(ai).toContain("compositions = { infos: compositionInfos(), ranks: rankCompositions(typed, null), plans: buildCompositionPlans(planInput) };");
    expect(ai).toContain("router.post('/one-line/judge'");
    expect(read('../../routes/line-templates.ts')).toContain("lineTemplatesRouter.post('/composition-preview'");
  });
  it('새 CT 코드의 AI 호출 = ai.ts 한 곳', () => {
    for (const f of ['../one-line-ct/index.ts', '../one-line-ct/preview.ts', '../line-compositions.ts']) expect(read(f)).not.toContain('callAIWithFallback');
    expect(read('../one-line-ct/ai.ts')).toContain('callAIWithFallback');
  });
});

describe('Codex CT R1 정정', () => {
  beforeEach(() => {
    _resetLineJudgeMemory();
    vi.mocked(callAIWithFallback).mockReset();
    vi.mocked(deductCreditOutcome).mockClear();
    vi.mocked(deductCreditOutcome).mockResolvedValue('deducted');
    vi.mocked(chargedKeysAmong).mockResolvedValue(new Set());
    vi.mocked(hasChargeWithKeyPrefix).mockResolvedValue(false);
  });
  it('판단 · 결과물 생성 · 문자 입구 정산 = 같은 한 줄 잠금(날짜 · 채널 없음) · 잡혀 있으면 판단 = 바쁨', async () => {
    const key = lineFpLockKey(C, 'fpL');
    expect(key).toBe(`oneline-line:${C}:fpL`);
    expect(tryAcquireInflight(key)).toBe(true);
    try {
      await expect(runLineJudge({ companyId: C, line: '겨울 세일', lineFp: 'fpL', productNames: [] })).rejects.toBeInstanceOf(LineJudgeBusyError);
    } finally { releaseInflight(key); }
    const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
    expect(read('../line-steps-context.ts')).toContain('return lineFpLockKey(companyId, p.fp);');
    expect(read('../../services/ai-line.ts')).toContain('const lock = lineFpLockKey(v.companyId, aiLineLineFp(line));');
  });
  it('AI 가 목록 안 구성을 못 고르면(빈 답) = 규칙 판단 · 0원', async () => {
    vi.mocked(callAIWithFallback).mockResolvedValue('{}');
    const r = await runLineJudge({ companyId: C, line: '겨울 시즌오프', lineFp: 'fpE', productNames: [] });
    expect(r).toMatchObject({ source: 'rule', charged: false, note: 'AI_FAILED' });
    expect(deductCreditOutcome).not.toHaveBeenCalled();
  });
  it('전환일 = 옛 접두(다른 채널)로 낸 완성도 찾는다 → 다시 만들기 3', async () => {
    vi.mocked(hasChargeWithKeyPrefix).mockImplementation(async (_c, _s, prefix) => prefix.includes(':email:'));
    const r = await resolveLineStepsCharge(C, 'dm', 'fpX', Date.now());
    expect(r).toMatchObject({ cost: 3, source: 'oneline-recook', completionDue: false });
  });
  it('요리 = 실제로 조립되는 재료로 필수 칸 판정(사진 없는 상품만 있으면 400 · AI · 차감 전)', async () => {
    const input = {
      composition: getLineComposition('spotlight')!, channel: 'dm' as const, companyId: C, line: '앰플 출시', brandName: 'b', logoUrl: null, csPhone: null, pinnedPrimary: null,
      cards: [], heroUpload: null, heroAsIs: false, proof: [], page: null, benefitAnswer: null, periodEnd: null, link: null,
      rich: { points: [], usage: [], mood: [], couponCode: null, store: null, benefitNote: null, categories: [] },
    };
    await expect(draftLineCook(input, { source: 't' })).rejects.toMatchObject({ status: 400, code: 'LINE_COMPOSITION_MISSING' });
    expect(callAIWithFallback).not.toHaveBeenCalled();
  });
  it('구성 직접 상품 상한 = 12(화면과 같다) · 옛 템플릿 = 8', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `상품 ${i}` }));
    expect(sanitizeLineStepsBody({ steps: { v: 1 }, template: { id: 'showcase', layout: 'page' }, manual_products: rows(12) }, Date.now())).not.toBe('invalid');
    expect(sanitizeLineStepsBody({ steps: { v: 1 }, template: { id: 'showcase', layout: 'page' }, manual_products: rows(13) }, Date.now())).toBe('invalid');
    expect(sanitizeLineStepsBody({ steps: { v: 1 }, template: { id: 'big-sale', layout: 'page' }, manual_products: rows(9) }, Date.now())).toBe('invalid');
  });
  it('플래너 구성 = 사진 있는 몰 상품 · 첫 화면 말고 사진 장수로 견적과 생성이 같은 판정', () => {
    const base = { images: [], text: '', licensed: false, products: [], link: 'https://a.co' } as any;
    const ev = { benefitText: '30%' } as any;
    const lookbook = plannerTemplateDef('lookbook')!;
    expect(plannerTemplateMissing(lookbook, ev, { ...base, products: [{ source: 'manual', name: '니트' }] })).toEqual(expect.arrayContaining(['product_photos', 'photos']));
    const ok = { ...base, images: [{ url: '/a' }, { url: '/b' }, { url: '/c' }], products: [1, 2, 3, 4].map((i) => ({ source: 'mall', name: `n${i}`, imageUrl: `https://m/${i}.jpg` })) };
    expect(plannerTemplateMissing(lookbook, ev, ok)).toEqual([]);
    expect(plannerTemplateMissing(plannerTemplateDef('big-sale')!, ev, { ...base, products: [{ source: 'manual', name: '니트' }] })).toEqual([]);
  });
});

describe('Codex CT R2 정정', () => {
  beforeEach(() => {
    _resetLineJudgeMemory();
    vi.mocked(callAIWithFallback).mockReset();
    vi.mocked(deductCreditOutcome).mockClear();
    vi.mocked(deductCreditOutcome).mockResolvedValue('deducted');
    vi.mocked(chargedKeysAmong).mockResolvedValue(new Set());
  });
  it('판단 몫 = 판단 원장 또는 그 한 줄 완성(채널 무관) · 완성을 먼저 낸 한 줄은 판단 2 를 다시 걷지 않는다', async () => {
    vi.mocked(hasChargeWithKeyPrefix).mockImplementation(async (_c, src, prefix) => src === 'oneline-complete' && prefix.startsWith(`olc:${C}:`) && !prefix.includes(':dm:') && !prefix.includes(':email:') && !prefix.includes(':inapp:'));
    vi.mocked(callAIWithFallback).mockResolvedValue(JSON.stringify({ pick: 'showcase', reason: '세일', drafts: {} }));
    const r = await runLineJudge({ companyId: C, line: '겨울 세일 30%', lineFp: 'fpC', productNames: [] });
    expect(r).toMatchObject({ source: 'ai', charged: false, paid: true });
    expect(deductCreditOutcome).not.toHaveBeenCalled();
    vi.mocked(hasChargeWithKeyPrefix).mockResolvedValue(false);
    const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
    expect(read('../../services/ai-line.ts')).toContain('return await lineCompletionPaid(companyId, aiLineLineFp(line), now.getTime());');
  });
  it('채널별 칸 = 인앱은 상품 1개 · 혜택만 막는다 · 이메일 상품 상한 6', () => {
    const comp = getLineComposition('showcase')!;
    const one = rich({ products: rich().products.slice(0, 1), periodEnd: null, mood: [] });
    expect(compositionBlockingFor(comp, one, 'inapp')).toEqual([]);
    expect(compositionBlockingFor(comp, one, 'dm').map((s) => s.key).sort()).toEqual(['periodEnd', 'products']);
    const input = { judged: '세일', line: '세일', typed: '세일', channel: 'email' as const, mall: true, inappBlocked: false, upload: true, website: 'https://a.co', mallHome: null, cost: null, lineFp: 'x' };
    expect(buildCompositionPlan(comp, input).steps.find((s) => s.key === 'products')?.max).toBe(6);
  });
  it('화면 = 구성 상품 목록 하나(사진 있는 것 먼저 걸러 상한)로 판정과 요청 본문을 만든다', () => {
    const fe = readFileSync(resolve(__dirname, '../../../../frontend/src/utils/one-line.ts'), 'utf8');
    expect(fe).toContain('const goods = comp ? lineCompositionGoods(a, max) : null;');
    expect(fe).toContain('const picks = (a.picks || []).filter((p) => p.imageUrl).slice(0, max);');
    expect(readFileSync(resolve(__dirname, '../../../../frontend/src/components/zone/LineStepsModal.tsx'), 'utf8')).toContain('const g = lineCompositionGoods(answers, s.max ?? 12);');
  });
});
