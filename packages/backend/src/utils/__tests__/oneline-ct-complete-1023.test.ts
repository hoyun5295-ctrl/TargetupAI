/**
 * 한줄 CT 완성 계약 시험 (★ 2026-10-23 · 설계서 docs/2026-10-23-oneline-ct-complete-design.md)
 *   ① 듣기 한 곳(상대 마감 · 지나가는 날짜 말 · 업종 반영 순위) · ③ 진단 한 곳(재료 판 · 미리보기 · 관문이 같은 채널 칸표)
 *   · 사진 묶음(반 칸 0) · ⑤ 주문 한 곳(돈 결말 · 가짜 원장) · 반복 발송 점검 · 플래너 초안 · 미리보기 본문 = 만들기 본문 · 자동마케팅 혜택 근거.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn() }));
vi.mock('../brand-basic-info', () => ({ getBrandBasicInfo: vi.fn(async () => ({ brand_name: '한줄 뷰티', company_name: '한줄', industry_code: 'fashion' })) }));
vi.mock('../ai-credit', () => ({
  checkCredit: vi.fn(async () => undefined),
  deductCreditOutcome: vi.fn(async () => 'deducted'),
  InsufficientCreditError: class InsufficientCreditError extends Error {},
  hasChargeWithKeyPrefix: vi.fn(async () => false),
  chargedKeysAmong: vi.fn(async () => new Set<string>()),
}));
vi.mock('../line-template-run', async (importOriginal) => ({ ...(await importOriginal<any>()), lineCopyExemplars: vi.fn(async () => null) }));

import { callAIWithFallback } from '../../services/ai';
import { InsufficientCreditError } from '../ai-credit';
import { listenLine, buildCompositionPlan, runLineJudge, _resetLineJudgeMemory, draftLineCook, lineCookMaterials, getLineComposition } from '../one-line-ct';
import { runLineCookOrder, type LineOrderDeps } from '../one-line-ct/order';
import { checkRecurringLine } from '../one-line-ct/recurring';
import { previewMaterialsOf, renderCompositionPreview, previewCards } from '../one-line-ct/preview';
import { sanitizeLineJudge } from '../one-line-ct/ai';
import {
  LINE_COMPOSITIONS, diagnoseComposition, diagnosisMissing, diagnosisBlocking, composeRichDm, composeRichEmail, compositionFallbackCopy, compositionParts,
  type LineRichMaterials,
} from '../line-compositions';
import { lineEndDatePrefill, sanitizeLineStepsBody } from '../one-line-steps';
import { prepareLineStepsRequest, isLineStepsReqError, lineStepsKeyFor } from '../line-steps-context';

const C = '1be15adb-84b8-4025-9957-5c2d39076c1d';
const img = (n: string) => `/api/dm/v/images/${C}/${n}.jpg`;
// 2026-10-23(금) 12:00 KST
const NOW = Date.parse('2026-10-23T03:00:00Z');
let idn = 0;
const newId = () => `s${++idn}`;

const mat = (over: Partial<LineRichMaterials> = {}): LineRichMaterials => ({
  brandName: '한줄', poster: null, products: [], points: [], steps: [], mood: [], proof: [], benefit: null, periodEnd: null, periodLabel: null, link: 'https://example.com', ...over,
});
const planInput = (line: string, channel: 'dm' | 'email' | 'inapp' = 'dm') => ({
  judged: line, line, typed: line, channel, mall: true, inappBlocked: false, upload: true, website: 'https://a.co', mallHome: null, cost: null, lineFp: 'abcdefabcdef',
});

describe('① 듣기 한 곳 — 상대 마감 · 지나가는 날짜 말 · 같은 한 줄 = 같은 의도', () => {
  it('상대 마감 = 제안 칩(이번 달 말 · 월말 · 이번 주말 · 이번 주 일요일 · 오늘 · 내일) · N일간 · 두 종류 · 기한 낱말 = 비운다', () => {
    expect(lineEndDatePrefill('출시 기념 20% 할인 이번 달 말까지', NOW)).toBe('2026-10-31');
    expect(lineEndDatePrefill('가을 세일 월말까지', NOW)).toBe('2026-10-31');
    expect(lineEndDatePrefill('니트 30% 세일 이번 주말까지', NOW)).toBe('2026-10-25');
    expect(lineEndDatePrefill('이번 주 일요일까지 쿠폰', NOW)).toBe('2026-10-25');
    expect(lineEndDatePrefill('오늘까지 반값', NOW)).toBe('2026-10-23');
    expect(lineEndDatePrefill('오늘까지 무료배송', NOW)).toBeNull();   // 배송 낱말 줄 = 지금 규칙대로 비운다
    expect(lineEndDatePrefill('내일까지 반값', NOW)).toBe('2026-10-24');
    expect(lineEndDatePrefill('회원의 날 3일간 15% 쿠폰', NOW)).toBeNull();
    expect(lineEndDatePrefill('오늘까지 신청 · 이번 달 말까지 사용', NOW)).toBeNull();
    expect(lineEndDatePrefill('이번 주말까지 배송돼요', NOW)).toBeNull();
    // 이번이 아닌 때(다음 달 · 다음 주 · 내달) = 이번 달 · 이번 주로 잘못 읽지 않고 비운다
    expect(lineEndDatePrefill('다음 달 월말까지 할인', NOW)).toBeNull();
    expect(lineEndDatePrefill('내달 월말까지 세일', NOW)).toBeNull();
    expect(lineEndDatePrefill('다음 주 일요일까지 쿠폰', NOW)).toBeNull();
    expect(lineEndDatePrefill('다음달월말까지 세일', NOW)).toBeNull();
    expect(lineEndDatePrefill('행사를 다음달로 연장해 월말까지 진행', NOW)).toBeNull();   // Codex R3
    // ★ Codex R2 · R3 = 차단 목록 경계가 두 번 샜다 → 허용 목록: 상대 마감 꼴 하나 + 나머지에 다른 때 말 0 일 때만 · 그 밖 = 비운다(사람이 칩 한 번)
    expect(lineEndDatePrefill('이번 달 말까지 구매 시 다음 주문 10% 할인', NOW)).toBeNull();
    expect(lineEndDatePrefill('다음 주력 상품 공개 · 이번 주말까지 사전 알림', NOW)).toBeNull();
    expect(lineEndDatePrefill('이번 주말까지 선착순 100명', NOW)).toBeNull();
    expect(lineEndDatePrefill('이번 주말까지 니트 30% 세일', NOW)).toBe('2026-10-25');
    // 더 큰 때 말의 일부(「11월말」의 월말)는 꼴로 잡지 않는다(Codex R4) · 낱말 경계의 「월말까지」는 그대로
    expect(lineEndDatePrefill('11월말까지 할인', NOW)).toBeNull();
    expect(lineEndDatePrefill('11월 말까지 할인', NOW)).toBeNull();
    expect(lineEndDatePrefill('１１월말까지 할인', NOW)).toBeNull(); // 전각 숫자도 경계 안(Codex R5)
    expect(lineEndDatePrefill('(오늘까지) 반값', NOW)).toBe('2026-10-23');
    expect(lineEndDatePrefill('월말까지 할인', NOW)).toBe('2026-10-31');
    expect(lineEndDatePrefill('가을 세일, 오늘까지', NOW)).toBe('2026-10-23');
    // 날짜 꼴이 있으면 지금 규칙 그대로(상대 말은 보지 않는다)
    expect(lineEndDatePrefill('10월 31일까지 10% 할인', NOW)).toBe('2026-10-31');
  });
  it('의도 하나 = 재료 판 제안 · 지나가는 날짜 말 · 사진 조각의 혜택은 제안으로 올리지 않는다', () => {
    const i = listenLine('니트 20% 할인 이번 주말까지', { nowMs: NOW });
    expect(i).toMatchObject({ concreteBenefit: true, benefit: '20% 할인', periodEnd: '2026-10-25', gaps: { benefit: false } });
    expect(i.passingDates).toEqual(['이번 주말']);
    const plan = buildCompositionPlan(getLineComposition('showcase')!, planInput('니트 20% 할인 이번 주말까지'), i);
    expect(plan.steps.find((s) => s.key === 'benefit')?.suggest).toBe('20% 할인');
    expect(plan.steps.find((s) => s.key === 'period')?.suggest).toBe('2026-10-25');
    const withRead = listenLine('가을 세일 · 30% 할인', { reads: ['30% 할인'], nowMs: NOW });
    expect(withRead.benefit).toBeNull();
    expect(withRead.typed).toBe('가을 세일');
  });
  it('구성 순위 = 업종 반영 · 판정 화면(gaps)과 규칙 판단이 같은 순위', async () => {
    _resetLineJudgeMemory();
    vi.mocked(callAIWithFallback).mockReset();
    vi.mocked(callAIWithFallback).mockRejectedValue(new Error('down'));
    const line = '가을 신상 니트';
    const heard = listenLine(line, { industry: 'fashion' });
    const r = await runLineJudge({ companyId: C, line, lineFp: 'fpRank', productNames: [] });
    expect(r.source).toBe('rule');
    expect(r.pick).toBe(heard.rank[0].id);
    expect(read('../../routes/ai.ts')).toContain("const industry = compositionMenu ? (String((await getBrandBasicInfo(companyId!).catch(() => null))?.industry_code || '') || null) : null;");
  });
});

describe('③ 진단 한 곳 — 재료 판 · 미리보기 · 관문이 같은 채널 칸표', () => {
  const sets: Record<string, LineRichMaterials> = {
    empty: mat(),
    oneProductBenefit: mat({ products: [{ name: '상품', price: 1000, image_url: img('p1') }], benefit: '10% 할인' }),
    rich: mat({
      poster: { url: img('h') }, products: [1, 2, 3, 4, 5].map((n) => ({ name: `상품 ${n}`, price: 1000, image_url: img(`p${n}`) })),
      points: [{ title: '순한', body: '' }, { title: '가벼운', body: '' }, { title: '산뜻한', body: '' }], steps: [{ title: '1', body: '' }, { title: '2', body: '' }],
      mood: [img('m1'), img('m2'), img('m3')], proof: [{ body: '좋아요', author: '김**', rating: 5 }], benefit: '10% 할인', periodEnd: '2026-10-31', periodLabel: null, couponCode: 'A1', store: { address: '서울' },
    }),
  };
  it('구성 5 × 채널 3 × 재료 3벌 — 미리보기 빈 칸 수 = 진단 빈 칸 수 · 재료 판 칸 = 진단 칸(같은 채널 칸표)', () => {
    for (const comp of LINE_COMPOSITIONS) {
      for (const ch of ['dm', 'email', 'inapp'] as const) {
        const planSteps = buildCompositionPlan(comp, planInput('한 줄', ch), listenLine('한 줄')).steps.map((s) => s.key).filter((k) => !['hero_photo', 'event_page', 'link'].includes(k));
        for (const [name, m] of Object.entries(sets)) {
          const d = diagnoseComposition(comp, m, ch);
          expect(d.map((s) => s.step), `${comp.id} ${ch} ${name}`).toEqual(planSteps);
          expect(renderCompositionPreview(comp, ch, m).missing, `${comp.id} ${ch} ${name}`).toBe(diagnosisMissing(d).length);
        }
      }
    }
  });
  it('1023 실측 어긋남 정정 — 인앱 재료 판이 다 찬 재료는 미리보기 빈 칸도 0', () => {
    for (const comp of LINE_COMPOSITIONS) expect(renderCompositionPreview(comp, 'inapp', sets.oneProductBenefit).missing, comp.id).toBe(0);
    expect(renderCompositionPreview(getLineComposition('spotlight')!, 'email', sets.oneProductBenefit).slots.map((s) => s.step)).not.toContain('period');
  });
  it('관문 = 같은 진단 · 막은 칸은 재료 판 단계 키로 돌려준다(화면이 그 칸으로)', async () => {
    const comp = getLineComposition('showcase')!;
    expect(diagnosisBlocking(diagnoseComposition(comp, sets.empty, 'dm')).map((s) => s.step).sort()).toEqual(['benefit', 'period', 'products']);
    vi.mocked(callAIWithFallback).mockReset();
    const input = {
      composition: comp, channel: 'dm' as const, companyId: C, line: '세일', brandName: 'b', logoUrl: null, csPhone: null, pinnedPrimary: null,
      cards: [], heroUpload: null, heroAsIs: false, proof: [], page: null, benefitAnswer: null, periodEnd: null, link: null,
      rich: { points: [], usage: [], mood: [], couponCode: null, store: null, benefitNote: null, categories: [] },
    };
    await expect(draftLineCook(input, { source: 't' })).rejects.toMatchObject({ status: 400, code: 'LINE_COMPOSITION_MISSING', missing: expect.arrayContaining(['benefit', 'period', 'products']) });
    expect(callAIWithFallback).not.toHaveBeenCalled();
  });
});

describe('사진 묶음 — 반 칸 0(B1)', () => {
  const galleries = (id: 'lookbook' | 'menu', mood: string[]) => compositionParts(getLineComposition(id)!, mat({ mood, products: [1, 2, 3, 4].map((n) => ({ name: `메뉴 ${n}`, price: 1000, image_url: img(`p${n}`) })) }), compositionFallbackCopy(getLineComposition(id)!))
    .filter((p) => p.type === 'gallery' && (p.part === 'mood' || p.part === 'more-photos'));
  it('1장 = 한 줄 크게 · 2장 = 2열(첫 장 크게 아님) · 3장 = 첫 장 크게 + 2열', () => {
    expect(galleries('menu', [img('m1')])[0]).toMatchObject({ props: { layout: 'list_1xN' } });
    expect(galleries('menu', [img('m1')])[0].treatment).toBeUndefined();
    expect(galleries('lookbook', [img('m1'), img('m2')])[0]).toMatchObject({ props: { layout: 'grid_2x2' } });
    expect(galleries('lookbook', [img('m1'), img('m2')])[0].treatment).toBeUndefined();
    expect(galleries('lookbook', [img('m1'), img('m2'), img('m3')])[0]).toMatchObject({ treatment: 'mosaic' });
  });
  it('이메일(2열 표만 그린다) = 3장이면 첫 장 한 줄 크게 + 나머지 2열로 나눠 싣는다', () => {
    const comp = getLineComposition('lookbook')!;
    const m = mat({ mood: [img('m1'), img('m2'), img('m3')], products: [1, 2, 3, 4].map((n) => ({ name: `신상 ${n}`, price: 1000, image_url: img(`p${n}`) })) });
    const g = composeRichEmail(comp, m, compositionFallbackCopy(comp), newId).sections.filter((s) => s.type === 'gallery').map((s: any) => ({ layout: s.props.layout, n: s.props.images.length, mosaic: s.treatment === 'mosaic' }));
    expect(g).toEqual([{ layout: 'list_1xN', n: 1, mosaic: false }, { layout: 'grid_2x2', n: 2, mosaic: false }]);
  });
});

describe('⑤ 주문 한 곳 — 돈 결말(가짜 원장 · 세 채널 같은 함수)', () => {
  const prep = () => {
    const p = prepareLineStepsRequest({ steps: { v: 1 }, template: { id: 'showcase', layout: 'page' }, facts: { benefit: '30%' }, manual_products: [], expected_cost: 15, attempt_token: 'tok-12345678' }, C, '겨울 세일 30%', undefined, NOW, true);
    if (!p || isLineStepsReqError(p)) throw new Error('prep');
    return p;
  };
  const price = { cost: 15, source: 'oneline-complete', completionDue: true, breakdown: { generate: 3, complete: 12, total: 15 } };
  function fake(over: Partial<LineOrderDeps> = {}) {
    const locks = new Set<string>();
    const memo = new Map<string, { draftId: string; state: 'paid' | 'orphan' }>();
    const deduct = vi.fn(async () => 'deducted' as const);
    const deps: LineOrderDeps = {
      tryLock: (k) => { if (locks.has(k)) return false; locks.add(k); return true; },
      unlock: (k) => { locks.delete(k); },
      chargedAmong: async () => new Set<string>(),
      settlePrice: (async () => price) as any,
      resolveMall: async () => ({ cards: [], excluded: [] }),
      resolvePage: async () => ({ url: 'https://a.co', banner: null, licensedText: null }),
      checkCredit: async () => undefined,
      deduct: deduct as any,
      inBundle: (fn) => fn(),
      draftMemo: {
        recall: (k: string) => memo.get(k) ?? null,
        remember: (k: string, id: string, st: 'paid' | 'orphan') => { memo.set(k, { draftId: id, state: st }); },
        forget: (k: string) => { memo.delete(k); },
      } as any,
      deleteWithRetry: (async (del: () => Promise<unknown>) => { try { await del(); return true; } catch { return false; } }) as any,
      ...over,
    };
    return { deps, locks, memo, deduct };
  }
  const payload = { prompt: '', eventText: '겨울 세일 30%' };
  const run = (deps: LineOrderDeps, over: Record<string, unknown> = {}) => {
    let cooked = 0;
    const p = runLineCookOrder<{ x: number }>({
      companyId: C, channel: 'dm', steps: prep(), payload, attemptLockKey: 'attempt', products: undefined, actor: {} as any, pageCheck: true, nowMs: NOW,
      cook: async () => { cooked++; return { x: 1 }; }, adapter: { kind: 'return' }, ...over,
    } as any, deps);
    return p.then((r) => ({ r, cooked }));
  };

  it('첫 결과물 = 만들기 1번 · 차감 1번(금액 · 원천 · 멱등키 = 라우트 지문 그대로) · 잠금은 끝나면 푼다', async () => {
    const f = fake();
    const { r, cooked } = await run(f.deps);
    expect(r).toMatchObject({ kind: 'made', cost: 15, completionDue: true });
    expect(cooked).toBe(1);
    expect(f.deduct).toHaveBeenCalledTimes(1);
    expect((f.deduct.mock.calls[0] as any)[0]).toMatchObject({ companyId: C, cost: 15, source: 'oneline-complete', throwOnInsufficient: true, idempotencyKey: lineStepsKeyFor(prep(), C, 'dm', payload) });
    expect(f.locks.size).toBe(0);
  });
  it('같은 시도 재전송 = 409(만들기 · 차감 0) · 원장 모름 = 503 · 금액 바뀜 = 409(새 금액 동봉)', async () => {
    let f = fake({ chargedAmong: async (_c, keys) => new Set([keys[1]]) });
    let o = await run(f.deps);
    expect(o.r).toMatchObject({ kind: 'refused', status: 409, code: 'ALREADY_DONE' });
    expect(o.cooked).toBe(0);
    f = fake({ chargedAmong: async () => { throw new Error('db'); } });
    o = await run(f.deps);
    expect(o.r).toMatchObject({ kind: 'refused', status: 503, code: 'CREDIT_STATE_UNKNOWN' });
    f = fake({ settlePrice: (async () => ({ status: 409, code: 'PRICE_CHANGED', error: '금액이 3크레딧으로 바뀌었어요.', cost: 3, breakdown: { generate: 3, complete: 0, total: 3 } })) as any });
    o = await run(f.deps);
    expect(o.r).toMatchObject({ kind: 'refused', status: 409, code: 'PRICE_CHANGED', extra: { cost: 3 } });
    expect(o.cooked).toBe(0);
    expect(f.deduct).not.toHaveBeenCalled();
  });
  it('고른 몰 상품이 전부 빠짐 = 409(빠진 사유 동봉 · 0원) · 페이지 바뀜 = 409', async () => {
    let f = fake({ resolveMall: async () => ({ cards: [], excluded: [{ provider: 'cafe24', no: '1', name: '니트', reason: '품절' }] }) });
    let o = await run(f.deps, { products: [{ provider: 'cafe24', no: '1' }] });
    expect(o.r).toMatchObject({ kind: 'refused', status: 409, code: 'MALL_PRODUCTS_UNAVAILABLE', extra: { excluded: [{ reason: '품절' }] } });
    expect(o.cooked).toBe(0);
    const pageSteps = prepareLineStepsRequest({ steps: { v: 1 }, template: { id: 'showcase', layout: 'page' }, page: { url: 'https://a.co/e', licensed_hashes: [] }, manual_products: [], expected_cost: 15, attempt_token: 'tok-12345678' }, C, '세일', undefined, NOW, true) as any;
    f = fake({ resolvePage: async () => ({ status: 409, code: 'PAGE_CHANGED', error: '페이지가 바뀌었어요.' }) as any });
    o = await run(f.deps, { steps: pageSteps });
    expect(o.r).toMatchObject({ kind: 'refused', status: 409, code: 'PAGE_CHANGED' });
    expect(o.cooked).toBe(0);
  });
  it('잔액 부족(사전) = 던진다 · 만들기 · 차감 0 · 잠금 풀림 · 만들기 실패 = 차감 0', async () => {
    let f = fake({ checkCredit: async () => { throw new InsufficientCreditError('부족'); } });
    await expect(run(f.deps)).rejects.toBeInstanceOf(InsufficientCreditError);
    expect(f.deduct).not.toHaveBeenCalled();
    expect(f.locks.size).toBe(0);
    f = fake();
    await expect(run(f.deps, { cook: async () => { throw new Error('AI 실패'); } })).rejects.toThrow('AI 실패');
    expect(f.deduct).not.toHaveBeenCalled();
    expect(f.locks.size).toBe(0);
  });
  it('차감 결말 failed = 결과를 건네지 않는다(돌려주는 채널 503 · DM 초안 회수 503)', async () => {
    let f = fake({ deduct: vi.fn(async () => 'failed') as any });
    let o = await run(f.deps);
    expect(o.r).toMatchObject({ kind: 'refused', status: 503, code: 'CREDIT_STATE_UNKNOWN' });
    const persist = vi.fn(async () => 'draft-1');
    const discard = vi.fn(async () => undefined);
    f = fake({ deduct: vi.fn(async () => 'failed') as any });
    o = await run(f.deps, { adapter: { kind: 'draft', persist, discard, label: 'dm' } });
    expect(o.r).toMatchObject({ kind: 'refused', status: 503 });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledWith('draft-1');
    expect(f.memo.size).toBe(0);
  });
  it('DM 착지: 낸 초안 = 같은 시도 재요청에 그대로(새 만들기 0) · 회수 실패 = orphan → 다음 재요청이 먼저 거두고 못 거두면 503', async () => {
    const persist = vi.fn(async () => 'draft-1');
    const f = fake();
    const first = await run(f.deps, { adapter: { kind: 'draft', persist, discard: async () => undefined, label: 'dm' } });
    expect(first.r).toMatchObject({ kind: 'made', draftId: 'draft-1' });
    const again = await run(f.deps, { adapter: { kind: 'draft', persist, discard: async () => undefined, label: 'dm' } });
    expect(again.r).toEqual({ kind: 'reused', draftId: 'draft-1' });
    expect(again.cooked).toBe(0);
    const g = fake({ deduct: vi.fn(async () => { throw new InsufficientCreditError('동시 소진'); }) as any });
    const failingDiscard = vi.fn(async () => { throw new Error('db'); });
    await expect(run(g.deps, { adapter: { kind: 'draft', persist, discard: failingDiscard, label: 'dm' } })).rejects.toBeInstanceOf(InsufficientCreditError);
    expect([...g.memo.values()]).toEqual([{ draftId: 'draft-1', state: 'orphan' }]);
    const retry = await run(g.deps, { adapter: { kind: 'draft', persist, discard: failingDiscard, label: 'dm' } });
    expect(retry.r).toMatchObject({ kind: 'refused', status: 503, code: 'LINE_DRAFT_PENDING' });
    expect(retry.cooked).toBe(0);
  });
  it('같은 한 줄 · 같은 시도 동시 요청 = 409(하나씩)', async () => {
    const f = fake();
    f.locks.add('attempt');
    expect((await run(f.deps)).r).toMatchObject({ kind: 'refused', status: 409, code: 'IN_FLIGHT' });
    f.locks.clear();
    f.locks.add(`oneline-line:${C}:${prep().fp}`);
    expect((await run(f.deps)).r).toMatchObject({ kind: 'refused', status: 409, code: 'IN_FLIGHT' });
    expect(f.locks.has('attempt')).toBe(false);
  });
});

describe('반복 발송 점검(여정 · 자동발송 · C1)', () => {
  it('지나가는 날짜 말 · 혜택 없음(입구마다 문장) · 혜택 원문 고정 · 빈 줄 = 없음', () => {
    const auto = checkRecurringLine(listenLine('이번 주말까지 가을 세일 안내'), 'auto-send');
    expect(auto.map((n) => n.kind)).toEqual(['passing_date', 'benefit_missing']);
    expect(auto[0].text).toContain('「이번 주말」');
    expect(auto[1].text).toContain('채우지 않으면 그 회차는 나가지 않아요');
    expect(checkRecurringLine(listenLine('가을 세일 안내'), 'journeys')[0].text).toBe('혜택 문구가 없어요. 아래 「넣을 혜택」 칸에 적으면 그 혜택만 실어요');
    expect(checkRecurringLine(listenLine('전 상품 20% 할인 안내'), 'auto-send')).toEqual([{ kind: 'benefit_fixed', text: '적어 주신 혜택만 실어요: 「20% 할인」' }]);
    expect(checkRecurringLine(listenLine(''), 'journeys')).toEqual([]);
    for (const n of auto) expect(n.text).not.toMatch(/[—–]/);
  });
  it('자동발송 = 판정 응답 · 여정 = 한 줄 여정 한 길의 질문표(★1023 여정 결함 0 · 옛 검토 화면만 읽던 죽은 안내 0)', () => {
    expect(read('../../routes/ai.ts')).toContain("const recurring = enabled && menu === 'auto-send' ? checkRecurringLine(heard, menu) : [];");
    expect(read('../journey-interview-ai.ts')).toContain("notes: checkRecurringLine(intent, 'journeys').map((n) => n.text)");
    expect(fe('components/journey/map/InterviewModal.tsx')).toContain('(prepared.notes || []).map((n) => (');
    expect(fe('pages/JourneysPage.tsx')).not.toContain('lineAsk.recurring');
    expect(fe('components/AutoSendFormModal.tsx')).toContain("void fetchOneLineGaps(t, [], 'auto-send')");
  });
});

describe('자동마케팅 발송 때 혜택 근거 = 컨셉 글만(C2)', () => {
  it('워커의 문안 생성 세 곳이 같은 근거를 넘긴다(첫 생성 · 같은 문맥 재생성 · 2단계 재생성)', () => {
    const src = read('../auto-campaign-worker.ts');
    expect((src.match(/await generateMessages\(/g) || []).length).toBe(3);
    expect((src.match(/licenseText: ac\.ai_prompt \|\| ac\.campaign_name,/g) || []).length).toBe(2);
    expect(src).toContain('const aiResult = await generateMessages(ac.ai_prompt || ac.campaign_name, targetInfo, extraContext);');
    expect(src).toContain('targetInfo, extraContext\n');
  });
});

describe('AI 초안 — 근거 없는 상품 특징을 결과물에 바로 싣지 않는다(★ Codex 1023 R1 · B2 철회)', () => {
  it('플래너 요리 = 비어 있는 특징 · 사용 단계 칸을 AI 가 채우지 않는다(상품 설명 근거 없음 · 사람이 고칠 판 없음)', async () => {
    vi.mocked(callAIWithFallback).mockReset();
    vi.mocked(callAIWithFallback).mockResolvedValue(JSON.stringify({ headline: '새로 나왔어요', points: [{ title: '순한 사용감', body: '자극 없이' }] }));
    const comp = getLineComposition('spotlight')!;
    const r = await draftLineCook({
      composition: comp, channel: 'dm', companyId: C, line: '앰플 출시', brandName: 'b', logoUrl: null, csPhone: null, pinnedPrimary: null,
      cards: [{ name: '진정 앰플', price: 30000, image_url: img('p1') }], heroUpload: null, heroAsIs: false, proof: [], page: null, benefitAnswer: null, periodEnd: null, link: 'https://b.example',
      rich: { points: [], usage: [], mood: [], couponCode: null, store: null, benefitNote: null, categories: [] },
    }, { source: 't' });
    expect(r.materials.points).toEqual([]);
    expect(r.materials.steps).toEqual([]);
    expect(String((vi.mocked(callAIWithFallback).mock.calls[0][0] as any).userMessage)).not.toContain('points (배열');
    expect(read('../planner-build.ts')).not.toContain('fillSuggestDrafts');
  });
  it('재료 판 판단 초안(사람이 고치는 초안) = 효능 단정은 버린다(첫 화면 글과 같은 판정)', () => {
    const r = sanitizeLineJudge({ pick: 'spotlight', reason: '신제품', drafts: { spotlight: { points: [{ title: '피부가 좋아져요', body: '' }, { title: '순한 사용감', body: '' }, { title: '산뜻한 마무리', body: '' }], steps: [{ title: '바르기', body: '트러블 개선 효과' }] } } }, '앰플 출시', '앰플 출시');
    expect(r.drafts.spotlight?.points?.map((p) => p.title)).toEqual(['순한 사용감', '산뜻한 마무리']);
    expect(r.drafts.spotlight?.steps).toEqual([]);
  });
});

describe('미리보기 본문 = 만들기 본문(A1-b · 같은 검증 · 같은 재료 변환)', () => {
  it('화면 몸통 → 서버 검증 통과 → 미리보기 재료 = 요리 재료(같은 카드 · 같은 혜택 · 같은 표지)', async () => {
    const f = await import('../../../../frontend/src/utils/one-line');
    const comp = getLineComposition('showcase')!;
    const plan = buildCompositionPlan(comp, planInput('니트 세일'), listenLine('니트 세일'));
    const cand = { provider: 'cafe24', no: '12', name: '울 니트', price: 39000, salePrice: 29000, imageUrl: 'https://m.example/1.jpg', exact: false };
    const a = { ...f.emptyLineStepsAnswers(), benefit: '30% 할인', period: '2026-10-31', picks: [cand], manualList: [{ name: '코트', price: '99,000', image: img('c') }], hero: img('h') };
    const body = f.buildLineTemplateBody(plan as any, a, plan.steps as any, 15, { id: 'showcase', layout: 'page' });
    const req = f.lineCompositionPreviewRequest(body, a, plan.steps.find((s) => s.key === 'products')!.max!);
    expect(req.cards).toEqual([{ name: '울 니트', price: 39000, discount_price: 29000, image_url: 'https://m.example/1.jpg' }]);
    const b = sanitizeLineStepsBody(req.body as any, NOW);
    if (!b || b === 'invalid') throw new Error('body');
    const brand = { brandName: 'b', logoUrl: null, csPhone: null };
    const pv = previewMaterialsOf({ comp, channel: 'dm', body: b, mallCards: previewCards(req.cards), pageBanner: req.pageBanner, brand, pinnedPrimary: null, companyId: C });
    const cook = lineCookMaterials({
      composition: comp, channel: 'dm', companyId: C, line: '', ...brand, pinnedPrimary: null,
      cards: [{ name: '울 니트', price: 39000, discount_price: 29000, image_url: 'https://m.example/1.jpg' }, { name: '코트', price: 99000, image_url: img('c') }], cardCategories: [null, null],
      heroUpload: b.heroImage, heroAsIs: b.heroPoster, proof: b.proof, page: null, benefitAnswer: b.facts.benefit, periodEnd: b.facts.periodEnd ?? null, link: 'https://example.com', rich: b.rich,
    });
    expect(pv.materials.products.map((p) => p.name)).toEqual(cook.materials.products.map((p) => p.name));
    expect(pv.materials).toMatchObject({ benefit: cook.materials.benefit, periodEnd: cook.materials.periodEnd, poster: cook.materials.poster });
  });
});

function read(rel: string): string { return readFileSync(resolve(__dirname, rel), 'utf8'); }
function fe(rel: string): string { return readFileSync(resolve(__dirname, '../../../../frontend/src', rel), 'utf8'); }
