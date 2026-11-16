// replaces: none
/**
 * C133 F2 ① ② — 상품 묶음(DM · 이메일)의 「받는 분마다 관심 상품을 앞에」 · 받는 사람용 반응 숫자
 *   (★ 2026-11-14 · 설계서 docs/2026-11-13-hanjul-v3-design.md §5-3 · §5-4 · §18)
 *   1. 반응 숫자 글자 = 서버가 만드는 한 꼴 · 그리는 조건 셋(켜짐 · 그 꼴 · 그 숫자를 센 이름 = 지금 이름) · 화면 판정과 같은 답
 *   2. 발행 렌더 · 이메일 렌더 = 구도 셋 모두에서 그 줄을 그린다 · 끄면 옛 출력과 글자 그대로 같다
 *   3. 앞세우기 = 켜져 있고 앞세울 자리가 실렸을 때만 순서가 바뀐다(상품 수 그대로) · 구도 셋 · 두 렌더러
 *   4. 열람 · 발송 길 = 켠 묶음 + 열린 회사 + 아는 고객일 때만 고르고 · 앞세울 자리만 싣는다(남의 자리는 지운다)
 *   5. 계약(소스) = 뷰어 · 발송 길의 배선 · 편집기 · 주소 관문
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const reco = vi.hoisted(() => ({ pickRecoIndex: vi.fn() }));
const stage = vi.hoisted(() => ({ v3Live: vi.fn() }));
vi.mock('../product-reco', () => ({ pickRecoIndex: reco.pickRecoIndex }));
vi.mock('../v3-stage', () => ({ v3Live: stage.v3Live }));

import { signalTextOf, signalLineOf, SIGNAL_TEXT_RE, normProductName, moveToFront, recoOrderedProducts } from '../product-signal-text';
import * as front from '../../../../frontend/src/utils/product-signal-text';
import { renderSection } from '../dm/dm-section-renderer';
import { renderEmailSections } from '../email/email-section-renderer';
import { recoOrderOn, markRecoFront, applyRecoOrder } from '../dm/dm-reco-order';
import type { Section } from '../dm/dm-section-registry';

const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const fe = (rel: string) => readFileSync(resolve(__dirname, '../../../../frontend/src', rel), 'utf8').replace(/\r\n/g, '\n');
const TREATMENTS = ['classic', 'focus', 'list'] as const;
const mk = (props: Record<string, unknown>, treatment: string): Section =>
  ({ id: 's1', type: 'product_carousel', order: 0, visible: true, props, treatment } as unknown as Section);
const dm = (props: Record<string, unknown>, treatment: string) => renderSection(mk(props, treatment), {} as any);
const email = (props: Record<string, unknown>, treatment: string) => renderEmailSections([mk(props, treatment)], {});
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
const prod = (name: string, extra: Record<string, unknown> = {}) => ({ image_url: `https://img.example/${encodeURIComponent(name)}.jpg`, name, price: 10000, link_url: 'https://shop.example/p', ...extra });
const TEXT = '최근 30일 조회 1,240번';

describe('반응 숫자 글자(순수)', () => {
  it('서버가 만드는 한 꼴 — 조회가 없으면 글자 없음', () => {
    expect(signalTextOf(1240, 30)).toBe('최근 30일 조회 1,240번');
    expect(signalTextOf(1, 30)).toBe('최근 30일 조회 1번');
    expect(signalTextOf(1234567, 30)).toBe('최근 30일 조회 1,234,567번');
    expect(signalTextOf(12.9, 30)).toBe('최근 30일 조회 12번');
    for (const v of [0, -3, NaN, Infinity]) expect(signalTextOf(v as number, 30)).toBeNull();
    expect(signalTextOf(10, 0)).toBeNull();
    for (const n of [1, 12, 999, 1000, 1240, 999999, 1234567]) expect(SIGNAL_TEXT_RE.test(signalTextOf(n, 30)!)).toBe(true);
  });
  it.each([
    '인기 1위', '최근 30일 조회 1,240번!', '최근 30일 조회 0번', '최근 30일 조회 01번', '최근 30일 조회 1240번 품절 임박', ' 최근 30일 조회 12번',
    '최근 30일 조회 1,24번', '최근 30일 구매 12번', '최근 0일 조회 12번', '<b>최근 30일 조회 12번</b>', '',
  ])('그 꼴이 아닌 글자는 그리지 않는다 — %j', (text) => {
    expect(signalLineOf({ show_signal: true }, { name: '수분 크림', signal_name: '수분 크림', signal_text: text })).toBeNull();
  });
  it('그리는 조건 셋 = 켜짐 · 그 꼴 · 그 숫자를 센 이름이 지금 이름과 같다(공백 차이는 같은 이름)', () => {
    const item = { name: '수분 크림', signal_name: ' 수분  크림\n', signal_text: TEXT };
    expect(signalLineOf({ show_signal: true }, item)).toBe(TEXT);
    expect(signalLineOf({ show_signal: false }, item)).toBeNull();
    expect(signalLineOf({}, item)).toBeNull();
    expect(signalLineOf({ show_signal: 'true' }, item)).toBeNull();
    expect(signalLineOf({ show_signal: true }, { ...item, name: '수분 크림 리뉴얼' })).toBeNull();   // 이름을 바꾼 상품 = 옛 상품의 숫자가 붙지 않는다
    expect(signalLineOf({ show_signal: true }, { ...item, signal_name: '' })).toBeNull();
    expect(signalLineOf({ show_signal: true }, { name: '', signal_name: '', signal_text: TEXT })).toBeNull();
    expect(signalLineOf(null, null)).toBeNull();
  });
  it('화면 판정 = 서버 판정(같은 꼴 · 같은 이름 정리 · 같은 답)', () => {
    expect(front.SIGNAL_TEXT_RE.source).toBe(SIGNAL_TEXT_RE.source);
    const items = [
      { name: '수분 크림', signal_name: '수분 크림', signal_text: TEXT }, { name: '수분 크림', signal_name: '수분\t크림 ', signal_text: TEXT },
      { name: '수분 크림', signal_name: '선크림', signal_text: TEXT }, { name: '수분 크림', signal_name: '수분 크림', signal_text: '인기 1위' },
      { name: '수분 크림', signal_name: '수분 크림' }, { name: '', signal_name: '', signal_text: TEXT }, {},
    ];
    for (const p of [{ show_signal: true }, { show_signal: false }, {}]) for (const it of items) expect(front.signalLineOf(p, it)).toBe(signalLineOf(p, it));
    for (const v of ['수분 크림', '  A  B\tC\n', ' x', '', null, undefined, 3, {}]) expect(front.normProductName(v)).toBe(normProductName(v));
  });
});

describe('발행 렌더 · 이메일 렌더 — 반응 숫자 줄', () => {
  const withSignal = (on: boolean) => ({
    ...(on ? { show_signal: true } : {}),
    products: [prod('수분 크림', { signal_text: TEXT, signal_name: '수분 크림' }), prod('선크림', { signal_text: '최근 30일 조회 77번', signal_name: '선크림' }), prod('세럼')],
  });
  const plain = { products: [prod('수분 크림'), prod('선크림'), prod('세럼')] };

  it.each(TREATMENTS)('구도 %s — 켜면 상품마다 그 글자가 보이고 · 숫자가 없는 상품에는 줄이 없다(두 렌더러)', (t) => {
    for (const render of [dm, email]) {
      const out = visible(render(withSignal(true), t));
      expect(out).toContain(TEXT);
      expect(out).toContain('최근 30일 조회 77번');
      expect(out.split('최근 30일 조회').length - 1).toBe(2);   // 세럼에는 없음
    }
  });
  it.each(TREATMENTS)('구도 %s — 끄면 글자가 실려 있어도 옛 출력과 글자 그대로 같다(두 렌더러)', (t) => {
    for (const render of [dm, email]) {
      expect(render(withSignal(false), t)).toBe(render(plain, t));
      expect(render({ ...withSignal(false), show_signal: false }, t)).toBe(render(plain, t));
    }
  });
  it.each(TREATMENTS)('구도 %s — 이름을 바꾼 상품 · 그 꼴이 아닌 글자는 켜져 있어도 그리지 않는다(두 렌더러)', (t) => {
    const props = { show_signal: true, products: [prod('수분 크림 리뉴얼', { signal_text: TEXT, signal_name: '수분 크림' }), prod('선크림', { signal_text: '인기 1위 · 품절 임박', signal_name: '선크림' })] };
    const base = { products: [prod('수분 크림 리뉴얼'), prod('선크림')] };
    for (const render of [dm, email]) {
      const out = render(props, t);
      expect(visible(out)).not.toContain('최근 30일 조회');
      expect(visible(out)).not.toContain('인기 1위');
      expect(out).toBe(render(base, t));
    }
  });
  it('글자는 이스케이프해 싣는다(그 꼴만 지나므로 태그가 실릴 길은 없다 · 그래도 렌더는 그대로 싣지 않는다)', () => {
    expect(src('dm/dm-section-renderer.ts')).toContain('${escapeHtml(text)}</div>` : \'\';');
    expect(src('email/email-section-renderer.ts')).toContain('${esc(text)}</div>` : \'\';');
  });
});

describe('앞세우기(순수 · 두 렌더러)', () => {
  it('moveToFront = 그 하나만 맨 앞으로 · 나머지 순서 그대로 · 범위 밖 · 0 · 정수 아님 = 그대로', () => {
    expect(moveToFront(['a', 'b', 'c', 'd'], 2)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveToFront(['a', 'b', 'c'], 1)).toEqual(['b', 'a', 'c']);
    for (const i of [0, -1, 3, 9, 1.5, NaN, null, undefined, '1']) expect(moveToFront(['a', 'b', 'c'], i)).toEqual(['a', 'b', 'c']);
    const input = ['a', 'b'];
    expect(moveToFront(input, 1)).not.toBe(input);
    expect(input).toEqual(['a', 'b']);   // 입력을 바꾸지 않는다
  });
  it('recoOrderedProducts = 켜져 있고 앞세울 자리가 있을 때만 · 상품 수 그대로', () => {
    const products = ['a', 'b', 'c'];
    expect(recoOrderedProducts({ reco_order: true, reco_front: 2, products })).toEqual(['c', 'a', 'b']);
    expect(recoOrderedProducts({ reco_order: false, reco_front: 2, products })).toEqual(products);
    expect(recoOrderedProducts({ reco_front: 2, products })).toEqual(products);             // 꺼짐(미지정) = 실린 자리를 쓰지 않는다
    expect(recoOrderedProducts({ reco_order: 'true', reco_front: 2, products })).toEqual(products);
    expect(recoOrderedProducts({ reco_order: true, products })).toEqual(products);          // 자리 없음 = 저장 순서
    expect(recoOrderedProducts({ reco_order: true, reco_front: 2, products: null })).toEqual([]);
    expect(recoOrderedProducts(null)).toEqual([]);
  });
  const three = [prod('첫째 상품'), prod('둘째 상품'), prod('셋째 상품')];
  const order = (html: string) => ['첫째 상품', '둘째 상품', '셋째 상품'].map((n) => ({ n, at: visible(html).indexOf(n) })).sort((a, b) => a.at - b.at).map((x) => x.n);

  it.each(TREATMENTS)('구도 %s — 켜져 있고 자리가 실리면 그 상품이 맨 앞 · 꺼져 있거나 자리가 없으면 저장 순서(두 렌더러)', (t) => {
    for (const render of [dm, email]) {
      expect(order(render({ products: three }, t))).toEqual(['첫째 상품', '둘째 상품', '셋째 상품']);
      expect(order(render({ products: three, reco_order: true, reco_front: 2 }, t))).toEqual(['셋째 상품', '첫째 상품', '둘째 상품']);
      expect(render({ products: three, reco_order: true }, t)).toBe(render({ products: three }, t));
      expect(render({ products: three, reco_front: 2 }, t)).toBe(render({ products: three }, t));
      expect(render({ products: three, reco_order: false, reco_front: 2 }, t)).toBe(render({ products: three }, t));
      // 앞세운 글과 손으로 그 순서로 저장한 글은 같다(순서만 바뀐다 · 새 내용 0)
      expect(render({ products: three, reco_order: true, reco_front: 2 }, t)).toBe(render({ products: [three[2], three[0], three[1]] }, t));
    }
  });
  it('이메일 = 앞세운 상품이 6개 자르기에 잘리지 않는다(순서를 먼저 정한다)', () => {
    const many = Array.from({ length: 8 }, (_, i) => prod(`상품 ${i + 1}`));
    const out = visible(email({ products: many, reco_order: true, reco_front: 7 }, 'classic'));
    expect(out).toContain('상품 8');
    expect(out).not.toContain('상품 7');   // 여덟 가운데 여섯 = 8 · 1 ~ 5
    expect(out).toContain('상품 5');
  });
});

describe('열람 · 발송 길 — 앞세울 자리 싣기', () => {
  const carousel = (products: any[], extra: Record<string, unknown> = {}) => ({ id: 'c1', type: 'product_carousel', props: { products, ...extra } });
  const text = { id: 't1', type: 'text_card', props: { body: '안녕하세요' } };
  const three = [prod('A'), prod('B'), prod('C')];

  beforeEach(() => { reco.pickRecoIndex.mockReset(); stage.v3Live.mockReset(); stage.v3Live.mockResolvedValue(true); });

  it('켠 묶음(상품 둘 이상)이 없으면 요금제도 읽지 않고 끔', async () => {
    for (const sections of [[text], [carousel(three)], [carousel(three, { reco_order: false })], [carousel([prod('A')], { reco_order: true })], [carousel(null as any, { reco_order: true })]]) {
      expect(await recoOrderOn(sections, 'co')).toBe(false);
    }
    expect(stage.v3Live).not.toHaveBeenCalled();
    expect(await recoOrderOn([carousel(three, { reco_order: true })], '')).toBe(false);
  });
  it('켠 묶음이 있으면 그 회사의 추천 상품 개방을 따른다', async () => {
    expect(await recoOrderOn([text, carousel(three, { reco_order: true })], 'co')).toBe(true);
    expect(stage.v3Live).toHaveBeenCalledWith('reco', 'co');
    stage.v3Live.mockResolvedValue(false);
    expect(await recoOrderOn([carousel(three, { reco_order: true })], 'co')).toBe(false);
  });
  it('고른 자리를 싣는다 — 상품 배열은 그대로 · 켜지 않은 묶음 · 다른 섹션은 건드리지 않는다 · 입력을 바꾸지 않는다', async () => {
    reco.pickRecoIndex.mockResolvedValue(2);
    const on = carousel(three, { reco_order: true });
    const off = carousel(three);
    const out = await markRecoFront([text, on, off], 'cust', 'co', true);
    expect(out[0]).toBe(text);
    expect(out[2]).toBe(off);
    expect(out[1].props).toEqual({ products: three, reco_order: true, reco_front: 2 });
    expect(on.props).toEqual({ products: three, reco_order: true });
    expect(reco.pickRecoIndex).toHaveBeenCalledTimes(1);
    expect(reco.pickRecoIndex).toHaveBeenCalledWith('co', 'cust', ['A', 'B', 'C']);
  });
  it('못 고르면(없음 · 이미 맨 앞) 자리를 싣지 않고 · 문서에 들어 있던 남의 자리는 지운다', async () => {
    const stale = carousel(three, { reco_order: true, reco_front: 2 });
    for (const picked of [null, 0]) {
      reco.pickRecoIndex.mockResolvedValue(picked);
      const [out] = await markRecoFront([stale], 'cust', 'co', true);
      expect(out.props).toEqual({ products: three, reco_order: true });
      expect('reco_front' in out.props).toBe(false);
    }
  });
  it('고객을 모르면 고르지 않는다 · 닫힌 회사면 고르지 않는다 · 켠 묶음이 없으면 요금제도 읽지 않는다', async () => {
    const sections = [carousel(three, { reco_order: true })];
    expect(await applyRecoOrder(sections, null, 'co')).toEqual(sections);
    expect(await markRecoFront(sections, undefined, 'co', true)).toEqual(sections);
    stage.v3Live.mockResolvedValue(false);
    expect(await applyRecoOrder(sections, 'cust', 'co')).toEqual(sections);
    expect(reco.pickRecoIndex).not.toHaveBeenCalled();
    stage.v3Live.mockClear();
    expect(await applyRecoOrder([text], 'cust', 'co')).toEqual([text]);
    expect(stage.v3Live).not.toHaveBeenCalled();
  });
  it('문서에 들어 있던 앞세울 자리 = 고르지 않는 길(닫힌 회사 · 모르는 고객 · 꺼진 판정)에서도 지운다 = 저장된 자리가 그려지는 길 0', async () => {
    const stale = [carousel(three, { reco_order: true, reco_front: 2 })];
    const gone = (out: any[]) => { expect(out[0].props).toEqual({ products: three, reco_order: true }); expect('reco_front' in out[0].props).toBe(false); };
    gone(await applyRecoOrder(stale, null, 'co'));               // 고객을 모르는 열람(미리보기 · 익명)
    expect(stage.v3Live).not.toHaveBeenCalled();                  // 고객을 모르면 요금제도 읽지 않는다
    stage.v3Live.mockResolvedValue(false);
    gone(await applyRecoOrder(stale, 'cust', 'co'));             // 닫힌 회사
    gone(await markRecoFront(stale, 'cust', 'co', false));       // 이메일 발송 길 = 판정이 거짓
    gone(await markRecoFront(stale, null, 'co', true));          // 받는 사람의 고객 행이 없다
    expect(reco.pickRecoIndex).not.toHaveBeenCalled();
    // 그 결과를 그리면 저장한 순서다
    const [out] = await markRecoFront([carousel([prod('첫째 상품'), prod('둘째 상품')], { reco_order: true, reco_front: 1 })], null, 'co', true);
    const html = visible(dm(out.props, 'classic'));
    expect(html.indexOf('첫째 상품')).toBeLessThan(html.indexOf('둘째 상품'));
    expect(stale[0].props.reco_front).toBe(2);   // 입력은 바꾸지 않는다
  });
  it('열린 회사 + 아는 고객 = 자리를 싣고 · 그 묶음을 그리면 그 상품이 맨 앞이다(길 전체)', async () => {
    reco.pickRecoIndex.mockResolvedValue(1);
    const [out] = await applyRecoOrder([carousel([prod('첫째 상품'), prod('둘째 상품')], { reco_order: true })], 'cust', 'co');
    const html = visible(dm(out.props, 'classic'));
    expect(html.indexOf('둘째 상품')).toBeLessThan(html.indexOf('첫째 상품'));
  });
});

describe('반응 숫자 불러오기 = 한 차례(편집기가 부르는 함수 그대로 · Codex 구현 C-2 1R)', () => {
  type Turn = ReturnType<typeof front.oneTurn>;
  const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
  const ok = (texts: unknown) => ({ ok: true, status: 200, texts });
  // 판은 그릴 때마다 새 객체다(편집기의 now.current 와 같은 꼴) — 요청 때 받은 판을 쥐고 있으면 옛 목록 · 옛 함수다
  const board = (products: any[]) => {
    const state: { products: any[]; onUpdate: ReturnType<typeof vi.fn> } = { products, onUpdate: vi.fn() };
    return { state, now: () => ({ products: state.products, onUpdate: state.onUpdate }) };
  };
  const two = () => [prod('수분 크림'), prod('선크림')];

  it('돌아온 응답을 상품 목록에 싣고 표시를 켠다 · 글자가 오지 않은 이름은 옛 숫자까지 비운다', async () => {
    const b = board([prod('수분 크림', { signal_text: '최근 30일 조회 9번', signal_name: '수분 크림' }), prod('선크림', { signal_text: '최근 30일 조회 7번', signal_name: '선크림' })]);
    const fetchTexts = vi.fn(async (_names: string[]) => ok({ '수분 크림': TEXT }));
    expect(await front.loadSignalTurn({ turn: front.oneTurn(), fetchTexts, now: b.now })).toEqual({ kind: 'done', count: 1 });
    expect(fetchTexts).toHaveBeenCalledWith(['수분 크림', '선크림']);
    expect(b.state.onUpdate).toHaveBeenCalledTimes(1);
    const patch = b.state.onUpdate.mock.calls[0][0];
    expect(patch.show_signal).toBe(true);
    expect(patch.products.map((p: any) => [p.name, p.signal_text, p.signal_name])).toEqual([['수분 크림', TEXT, '수분 크림'], ['선크림', '', '']]);
  });
  it.each<[string, (turn: Turn) => void]>([
    ['표시를 끄거나 · 상품을 빼거나 · 편집기가 내려가면(차례를 끝낸다)', (turn) => turn.end()],
    ['다시 불러오면(새 차례)', (turn) => { turn.take(); }],
  ])('기다리는 동안 %s 그 응답은 아무것도 쓰지 않는다', async (_label, act) => {
    const b = board(two());
    const turn = front.oneTurn();
    const d = deferred<ReturnType<typeof ok>>();
    const pending = front.loadSignalTurn({ turn, fetchTexts: () => d.promise, now: b.now });
    act(turn);
    d.resolve(ok({ '수분 크림': TEXT, '선크림': TEXT }));
    expect(await pending).toEqual({ kind: 'stale' });
    expect(b.state.onUpdate).not.toHaveBeenCalled();
  });
  it('기다리는 동안 고친 상품 · 바뀐 쓰는 함수 = 돌아온 순간의 판에 싣는다(요청 때의 목록 · 함수로 덮지 않는다)', async () => {
    const b = board(two());
    const first = b.state.onUpdate;
    const d = deferred<ReturnType<typeof ok>>();
    const pending = front.loadSignalTurn({ turn: front.oneTurn(), fetchTexts: () => d.promise, now: b.now });
    // 불러오는 동안: 선크림을 지우고 · 수분 크림 가격을 고치고 · 세럼을 더했다(편집기가 다시 그려져 쓰는 함수도 새것이다)
    const later = vi.fn();
    b.state.products = [prod('수분 크림', { price: 9900 }), prod('세럼')];
    b.state.onUpdate = later;
    d.resolve(ok({ '수분 크림': TEXT, '선크림': TEXT }));
    expect(await pending).toEqual({ kind: 'done', count: 1 });
    expect(first).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledTimes(1);
    expect(later.mock.calls[0][0].products.map((x: any) => [x.name, x.price, x.signal_text])).toEqual([['수분 크림', 9900, TEXT], ['세럼', 10000, '']]);
  });
  it('실패 · 끊김 = 쓰지 않고 상태를 그대로 알린다', async () => {
    const b = board(two());
    expect(await front.loadSignalTurn({ turn: front.oneTurn(), fetchTexts: async () => ({ ok: false, status: 403, texts: null }), now: b.now })).toEqual({ kind: 'failed', status: 403 });
    expect(await front.loadSignalTurn({ turn: front.oneTurn(), fetchTexts: async () => { throw new Error('끊김'); }, now: b.now })).toEqual({ kind: 'failed', status: 0 });
    expect(b.state.onUpdate).not.toHaveBeenCalled();
  });
  it('차례표 = 새 차례가 앞 차례를 끝낸다 · 끝낸 뒤 받은 차례는 살아 있다', () => {
    const turn = front.oneTurn();
    const a = turn.take();
    expect(a()).toBe(true);
    const b = turn.take();
    expect([a(), b()]).toEqual([false, true]);
    turn.end();
    expect(b()).toBe(false);
    expect(turn.take()()).toBe(true);
  });
  it('싣기 = 응답에 든 글자인 값만 · 입력은 바꾸지 않는다', () => {
    const input = [prod('constructor'), prod('toString'), prod('수분 크림'), prod('선크림', { signal_text: TEXT, signal_name: '선크림' })];
    const before = JSON.parse(JSON.stringify(input));
    const out = front.withSignalTexts(input, { '수분 크림': TEXT, '선크림': 12 });
    expect(out.map((p) => [p.signal_text, p.signal_name])).toEqual([['', ''], ['', ''], [TEXT, '수분 크림'], ['', '']]);
    expect(input).toEqual(before);
    for (const bad of [null, undefined, 'x', 3, []]) expect(front.withSignalTexts([prod('수분 크림')], bad)[0].signal_text).toBe('');
  });
});

describe('계약(소스)', () => {
  it('DM 열람 = 변수 치환 뒤 그 고객으로 자리를 싣는다 · 이메일 발송 = 판정은 발송 한 번에 한 번 · 자리는 받는 사람마다', () => {
    const viewer = src('dm/dm-viewer.ts');
    expect(viewer).toContain('sections: await applyRecoOrder(resolvedSecs, customer?.id ?? null, companyId) });');
    const ch = src('email-channel.ts');
    const gate = ch.indexOf('const recoOrder = hasSections && await recoOrderOn(campaignSections, campaign.companyId);');
    const loop = ch.indexOf('for (const recipient of batch) {');
    const per = ch.indexOf('const ordered = await markRecoFront(resolved, recipient.customerId ?? null, campaign.companyId, recoOrder);');
    expect(gate).toBeGreaterThan(0);
    expect(loop).toBeGreaterThan(gate);
    expect(per).toBeGreaterThan(loop);
    expect(ch).toContain('let body = renderEmailSections(ordered, {');
    expect(ch.split('recoOrderOn(').length - 1).toBe(1);
    // 받는 사람의 고객 번호 = 받는 사람 조회가 싣는 내부 칸(개인화 값과 따로) · 고객 DB 에서 고르는 네 조회가 같은 열 조각을 쓴다
    //   (Codex 구현 C-2 1R: 개인화 값에서 번호를 읽었는데 거기엔 번호가 없어 이메일은 한 번도 고르지 않았다 · 값이 실리는지는 실 PG 시험 c133-reco.pg 가 본다)
    expect(ch).not.toContain('(cust as any).id');
    expect(ch).toContain('customerId: r.customer_id ? String(r.customer_id) : undefined,');
    expect(ch.split('${recipientColsSql(').length - 1).toBe(4);
    expect(ch.split('rows.map(mapEmailRecipientRow)').length - 1).toBe(4);
    expect(ch).not.toContain('RECIPIENT_SELECT_COLS');
  });
  it('렌더러 둘이 켬 값을 직접 읽는다(면제 행 없음 · 속성 계약의 탐침이 소비를 확인한다)', () => {
    expect(src('dm/dm-section-renderer.ts')).toContain('recoOrderedProducts({ reco_order: p?.reco_order, reco_front: p?.reco_front,');
    expect(src('dm/dm-section-renderer.ts')).toContain('signalLineOf({ show_signal: p?.show_signal }, it)');
    expect(src('email/email-section-renderer.ts')).toContain('recoOrderedProducts({ reco_order: p.reco_order, reco_front: p.reco_front, products: p.products })');
    expect(src('email/email-section-renderer.ts')).toContain('signalLineOf({ show_signal: p.show_signal }, it)');
    for (const f of ['dm/dm-property-contract.ts', 'email/email-property-contract.ts']) {
      expect(src(f)).not.toMatch(/prop: '(reco_order|show_signal|signal_text|signal_name)'/);
    }
    // 순수 파일(렌더러가 읽는다) = DB 를 끌어오지 않는다
    expect(src('product-signal-text.ts')).not.toMatch(/^import /m);
  });
  it('고르기 = 추천과 같은 함수(예측 없음) · 자리는 저장하지 않는다(문서를 쓰는 문장 0)', () => {
    const f = src('dm/dm-reco-order.ts');
    expect(f).toContain("import { pickRecoIndex } from '../product-reco';");
    expect(f).not.toMatch(/\bquery\(|UPDATE |INSERT /);
  });
  it('편집기 = 열린 회사에만 두 칸 · 글자는 서버에서 받아 싣는다(손으로 적는 칸 없음) · 주소는 숫자 관문을 지난다', () => {
    const ed = fe('components/dm/panels/editors/ProductCarouselEditor.tsx');
    expect(ed).toContain("const insightLive = useV3Feature('product-insight');");
    expect(ed).toContain("const recoLive = useV3Feature('reco');");
    expect(ed).toContain('{insightLive && (\n        <Field label="반응 숫자 표시"');
    expect(ed).toContain('{recoLive && (\n        <Field label="관심 상품을 앞에"');
    expect(ed).toContain("sendJson('/api/product-insight/signal-texts', { method: 'POST', body: { names } })");
    // signal_text 를 쓰는 자리 = 편집기에서는 빼기(빈 값) 하나 · 서버 응답을 싣는 것은 한 차례 함수(loadSignalTurn)뿐 — 입력 칸에 묶이지 않는다
    expect(ed.split('signal_text:').length - 1).toBe(1);
    expect(ed).not.toContain('show_signal: true');
    // 한 차례의 배선(행동 = 위 「한 차례」 시험): 판 = 그린 뒤의 값(now) · 차례표는 편집기 하나에 하나 · 내려가면 끝난다 ·
    //   끄기 · 빼기가 쓰기 전에 끝낸다 · 끝난 차례는 잠금 · 안내를 건드리지 않는다
    expect(ed).toContain('useLayoutEffect(() => { now.current = { products, onUpdate }; });');
    expect(ed).toContain('const signalTurn = useRef(oneTurn()).current;');
    expect(ed).toContain('useLayoutEffect(() => () => signalTurn.end(), [signalTurn]);');
    expect(ed).toContain('const endSignalTurn = () => { signalTurn.end(); setSignalBusy(false); setSignalNote(null); };');
    expect(ed).toContain('      turn: signalTurn,\n');
    expect(ed).toContain('      now: () => now.current,\n');
    const call = ed.indexOf('const res = await loadSignalTurn({');
    const stale = ed.indexOf("if (res.kind === 'stale') return;");
    expect(call).toBeGreaterThan(0);
    expect(stale).toBeGreaterThan(call);
    expect(ed.slice(call, stale)).not.toMatch(/setSignal(Busy|Note)\(/);
    expect(ed.indexOf('setSignalBusy(false);', stale)).toBeGreaterThan(stale);
    expect(ed).toContain('else { endSignalTurn(); onUpdate({ show_signal: false }); }');
    expect(ed).toContain("onClick={() => { endSignalTurn(); setItem(i, { signal_text: '', signal_name: '' }); }}");
    // 묶음이 바뀌면 편집기를 다시 만든다(호출부가 key 를 걸지 않은 화면 포함 = 앞 묶음의 차례가 내려가며 끝난다)
    expect(fe('components/dm/panels/SectionPropsEditor.tsx')).toContain('<ProductCarouselEditor key={section.id} {...common} />');
    const route = readFileSync(resolve(__dirname, '../../routes/product-insight.ts'), 'utf8');
    expect(route).toContain("router.post('/signal-texts', guarded('signal-texts', async (req, res, companyId) => {");
    // 캔버스 = 발행 렌더와 같은 판정 함수
    expect(fe('components/dm/canvas/NewSections.tsx')).toContain('signalLineOf({ show_signal: props?.show_signal }, { name: p.name, signal_text: p.signal_text, signal_name: p.signal_name })');
    for (const f of [ed, fe('utils/product-signal-text.ts')]) expect(f).not.toMatch(/Claude|Anthropic|GPT|Opus|Sonnet|Haiku|Fable/i);
  });
});
