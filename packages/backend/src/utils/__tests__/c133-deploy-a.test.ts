// replaces: none
/**
 * C133 배포 A — 화면 계산 · 라우트 관문 · 「켜기 전 점검」 창 갇힘 수정(★ 2026-11-13 · 설계서 docs/2026-11-13-hanjul-v3-design.md §3-1 8번 · §4 · §5)
 *   실 PG 판 = c133-product-signal.pg · c133-benchmark.pg · c133-v3-intro.pg
 *   1. 상품 표 계산(정렬 · 비율 · 지난 30일 대비 · 문 표시) · 직접발송 넘기기 글(분석 화면 수와 지금 수)
 *   2. 업종 평균 글자(높음 · 낮음 · 같은 수준 · 업종 없음 · 회사 부족 = 평균을 싣지 않는다)
 *   3. 라우트 = 로그인 + 단계 개방 관문을 전부 지난다 · 닫힌 회사에는 값이 나가지 않는다 · 분류코드로 나뉜 담당자에게 닫힌다
 *   4. 「켜기 전 점검」 창 = 검증 구간은 닫기 = 취소 · 켜기 접수 뒤는 끊지 않는다 · 요청마다 시간 제한
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const planCtx: { value: any } = { value: null };
const hub: { value: { storeFilter: string; baseParams: any[]; blocked: boolean } } = { value: { storeFilter: '', baseParams: [], blocked: false } };
vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { query: vi.fn(), connect: vi.fn() }, withTransaction: vi.fn() }));
vi.mock('../../middlewares/auth', () => ({ authenticate: (_req: any, _res: any, next: any) => next() }));   // 라우트 파일을 불러올 때 토큰 비밀값 검사(기동 전용)를 건너뛴다
vi.mock('../plan-guard', async (orig) => ({ ...(await orig() as any), loadPlanContext: vi.fn(async () => planCtx.value) }));
vi.mock('../store-scope', async (orig) => ({ ...(await orig() as any), resolveHubStoreScope: vi.fn(async () => hub.value) }));

import {
  sortProducts, buyRate, viewDiff, hasBothDoors, audienceLoadedText, stashAudience, takeAudience,
  type ProductSignal,
} from '../../../../frontend/src/utils/product-insight';
import { successBenchLine, spamBenchCells, pointDiffText, type BenchmarkView } from '../../../../frontend/src/utils/benchmark';
import { parseActivationCaps, ACTIVATION_CAP_MAX } from '../journey-activation';
import { productInsightOpenFor, attachProductNumbers, signalRunDue, SIGNAL_RUN_HOUR_KST, SIGNAL_FEATURES } from '../product-signal';
import { v3StageScope, v3LiveState, v3FeaturesFor, V3_FEATURES } from '../v3-stage';
import { loadPlanContext } from '../plan-guard';
import { query } from '../../config/database';

const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8').replace(/\r\n/g, '\n');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

const PAID = { planCode: 'STARTER', subscriptionStatus: 'paid', autoCampaignOverride: null, features: {} } as any;
const FREE = { planCode: 'FREE', subscriptionStatus: null, autoCampaignOverride: null, features: {} } as any;
const ENVS = ['V3_STAGE_PRODUCT_INSIGHT', 'V3_STAGE_BENCHMARK', 'V3_STAGE_RECO'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const n of ENVS) { saved[n] = process.env[n]; delete process.env[n]; }
  planCtx.value = PAID;
  hub.value = { storeFilter: '', baseParams: [], blocked: false };
});
afterEach(() => { for (const n of ENVS) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; } });

const P = (over: Partial<ProductSignal>): ProductSignal => ({ door: 'mall', key: 'k', name: 'n', views: 0, carts: 0, orders: 0, prevViews: 0, prevOrders: 0, ...over });

describe('상품 표 계산(화면 순수 함수)', () => {
  const list = [
    P({ key: 'a', views: 100, orders: 5, prevViews: 150 }),
    P({ key: 'b', views: 50, orders: 10, prevViews: 10 }),
    P({ key: 'c', views: 0, orders: 3, door: 'ledger' }),
    P({ key: 'd', views: 50, orders: 1, prevViews: 50 }),
  ];
  it('조회 대비 구매 = 조회가 없으면 값 없음(0으로 나누지 않는다) · 지난 30일 대비 = 조회 차이', () => {
    expect(buyRate(list[0])).toBeCloseTo(0.05, 10);
    expect(buyRate(list[2])).toBeNull();
    expect(viewDiff(list[0])).toBe(-50);
    expect(viewDiff(list[1])).toBe(40);
  });
  it('정렬 = 고른 칸 · 내림 / 오름 · 같은 값은 서버 순서 그대로 · 원본을 바꾸지 않는다', () => {
    const before = list.map((p) => p.key).join('');
    expect(sortProducts(list, 'views', true).map((p) => p.key)).toEqual(['a', 'b', 'd', 'c']);
    expect(sortProducts(list, 'views', false).map((p) => p.key)).toEqual(['c', 'b', 'd', 'a']);
    expect(sortProducts(list, 'orders', true).map((p) => p.key)).toEqual(['b', 'a', 'c', 'd']);
    expect(sortProducts(list, 'rate', true).map((p) => p.key)).toEqual(['b', 'a', 'd', 'c']);   // 비율 없는 줄은 맨 뒤
    expect(sortProducts(list, 'diff', true).map((p) => p.key)).toEqual(['b', 'c', 'd', 'a']);
    expect(list.map((p) => p.key).join('')).toBe(before);
  });
  it('문 표시는 두 문이 다 있을 때만', () => {
    expect(hasBothDoors(list)).toBe(true);
    expect(hasBothDoors(list.filter((p) => p.door === 'mall'))).toBe(false);
  });
});

describe('직접발송으로 넘기기', () => {
  it('맡긴 대상은 한 번만 꺼낸다(다음에 직접발송을 그냥 열면 아무것도 불러오지 않는다)', () => {
    expect(takeAudience()).toBeNull();
    stashAudience({ kind: 'product', value: 'P1', label: '수분 크림', seen: 312 });
    expect(takeAudience()).toEqual({ kind: 'product', value: 'P1', label: '수분 크림', seen: 312 });
    expect(takeAudience()).toBeNull();
  });
  it('안내 글 = 분석 화면에서 본 수와 지금 수가 다르면 둘 다 적는다 · 잘렸으면 그렇다고 적는다', () => {
    const r = (n: number) => Array.from({ length: n }, (_, i) => ({ phone: `0100000${1000 + i}`, name: '' }));
    const a = { kind: 'product' as const, value: 'P1', label: '수분 크림', seen: 312 };
    expect(audienceLoadedText(a, { recipients: r(305), total: 305, truncated: false })).toBe('「수분 크림」을 보고 안 산 고객 305명을 불러왔어요 (분석 화면 312명 → 지금 305명)');
    expect(audienceLoadedText({ ...a, seen: 305 }, { recipients: r(305), total: 305, truncated: false })).toBe('「수분 크림」을 보고 안 산 고객 305명을 불러왔어요');
    expect(audienceLoadedText({ kind: 'search', value: '크림', label: '크림', seen: 3 }, { recipients: r(2), total: 3, truncated: true }))
      .toBe('「크림」을 찾은 고객 2명을 불러왔어요 · 앞에서부터 2명만 담았어요');
  });
  it('대시보드: 명단을 **더한다**(교체 아님 · R31) · 빈 명단 · 실패는 덮지 않는다 · 주소에 대상을 싣지 않는다', () => {
    const dash = front('pages/Dashboard.tsx');
    const fn = dash.slice(dash.indexOf('const loadPendingAudience = async () => {'), dash.indexOf('// v1.5.0', dash.indexOf('const loadPendingAudience = async () => {')));
    expect(fn).toContain('const asked = takeAudience();');
    expect(fn).toContain('if (!asked) return;');
    expect(fn).toContain('setDirectRecipients(appendUpdater<any>(rows, true, (r) => r.phone, () => undefined));');
    expect(fn.match(/setDirectRecipients\(/g)).toHaveLength(1);
    expect(fn.indexOf('if (got.recipients.length === 0)')).toBeLessThan(fn.indexOf('setDirectRecipients('));
    expect(dash).toContain("if (openParam === 'direct-send') { setShowDirectSend(true); setDirectSendChannel('sms'); void loadPendingAudience(); }");
    const sec = front('components/performance/ProductSignalSection.tsx');
    expect(sec).toContain("navigate('/dashboard?open=direct-send');");
    expect(sec).not.toMatch(/navigate\(`[^`]*\$\{/);   // 상품 키 · 검색어를 주소에 싣지 않는다
  });
});

describe('업종 평균 글자(화면 순수 함수)', () => {
  const base: BenchmarkView = { hasIndustry: true, ready: true, minPeers: 5, windowDays: 30, successRate: { available: false, reason: 'no_own' }, spamBlock: [] };
  it('높음 · 낮음 · 같은 수준 · 창을 글자에 적는다', () => {
    expect(successBenchLine({ ...base, successRate: { available: true, mine: 0.983, avg: 0.971, diff: 0.012 } }))
      .toEqual({ text: '최근 30일 기준 업종 평균 97.1% · 1.2%p 높음', tone: 'good' });
    expect(successBenchLine({ ...base, successRate: { available: true, mine: 0.9, avg: 0.95, diff: -0.05 } }))
      .toEqual({ text: '최근 30일 기준 업종 평균 95.0% · 5.0%p 낮음', tone: 'bad' });
    expect(successBenchLine({ ...base, successRate: { available: true, mine: 0.9502, avg: 0.95, diff: 0.0002 } }))
      .toEqual({ text: '최근 30일 기준 업종 평균 95.0% · 같은 수준', tone: 'same' });
    expect(pointDiffText(-0.0349)).toBe('3.5%p 낮음');
  });
  it('업종 없음 = 고르는 길 안내 · 회사 부족 = 평균을 싣지 않는다(회사 수 0) · 내 값 없음 · 닫힘 = 줄 없음', () => {
    expect(successBenchLine({ ...base, hasIndustry: false })!.text).toBe('브랜드 학습 창에서 업종을 고르면 같은 업종과 견줘 드려요');
    const few = successBenchLine({ ...base, successRate: { available: false, reason: 'few_peers' } })!;
    expect(few).toEqual({ text: '같은 업종 회사가 아직 적어 평균을 보여 드리지 않아요', tone: 'hint' });
    expect(few.text).not.toMatch(/\d/);
    expect(successBenchLine(base)).toBeNull();
    expect(successBenchLine(null)).toBeNull();
  });
  it('통신사 칸 = 평균이 있는 통신사만 · 차단율은 낮을수록 좋다', () => {
    const cells = spamBenchCells({ ...base, spamBlock: [
      { carrier: 'SKT', available: true, mine: 0.25, avg: 0.5, diff: -0.25 },
      { carrier: 'KT', available: false, reason: 'few_peers' },
      { carrier: 'LGU', available: true, mine: 0.4, avg: 0.1, diff: 0.3 },
    ] });
    expect(cells).toEqual([
      { label: 'SKT 차단율', value: '25.0% · 업종 평균 50.0%', tone: 'emerald' },
      { label: 'LG U+ 차단율', value: '40.0% · 업종 평균 10.0%', tone: 'rose' },
    ]);
    expect(spamBenchCells(null)).toEqual([]);
  });
});

describe('라우트 관문', () => {
  const U = { companyId: 'c-1', userId: 'u-1', userType: 'company_admin' };
  it('상품 구역: 단계 개방 + 요금제 + 분류코드로 나뉘지 않은 사람에게만 열린다', async () => {
    expect(await productInsightOpenFor(U)).toBe(false);                       // ENV 비어 있음
    process.env.V3_STAGE_PRODUCT_INSIGHT = '*';
    expect(await productInsightOpenFor(U)).toBe(true);
    planCtx.value = FREE;
    expect(await productInsightOpenFor(U)).toBe(false);                       // ⛔ 미가입 = 명단에 있어도 닫힘
    planCtx.value = PAID;
    hub.value = { storeFilter: ' AND id IN (…)', baseParams: [], blocked: false };
    expect(await productInsightOpenFor({ ...U, userType: 'company_user' })).toBe(false);   // 분류코드 담당자
    hub.value = { storeFilter: '', baseParams: [], blocked: true };
    expect(await productInsightOpenFor({ ...U, userType: 'company_user' })).toBe(false);   // 미배정 담당자
    hub.value = { storeFilter: '', baseParams: [], blocked: false };
    expect(await productInsightOpenFor({ ...U, userType: 'super_admin' })).toBe(false);
    expect(await productInsightOpenFor({ userId: 'u-1', userType: 'company_admin' })).toBe(false);
    expect(await productInsightOpenFor(undefined)).toBe(false);
  });

  it('★ Codex 구현 1R — 몰 상품 고르는 창의 숫자도 같은 관문: 분류코드 담당자 · 닫힌 회사 = 목록 그대로(숫자 없음 · 표 조회 0)', async () => {
    const mq = query as unknown as ReturnType<typeof vi.fn>;
    mq.mockReset();
    const list = [{ no: '11', code: 'c', name: '상품' }];
    process.env.V3_STAGE_PRODUCT_INSIGHT = '*';
    hub.value = { storeFilter: ' AND id IN (…)', baseParams: [], blocked: false };
    expect(await attachProductNumbers({ ...U, userType: 'company_user' }, list)).toBe(list);
    hub.value = { storeFilter: '', baseParams: [], blocked: false };
    delete process.env.V3_STAGE_PRODUCT_INSIGHT;
    expect(await attachProductNumbers(U, list)).toBe(list);
    expect(await attachProductNumbers(null, list)).toBe(list);
    expect(mq).not.toHaveBeenCalled();
    // 볼 수 있는 요청자 = 그 회사 · 자사몰 문 · 상품번호 → 코드 → 이름 순으로 맞춘 숫자
    process.env.V3_STAGE_PRODUCT_INSIGHT = '*';
    mq.mockResolvedValueOnce({ rows: [{ key: '11', views: 7, carts: 1, orders: 2 }] });
    expect(await attachProductNumbers(U, list)).toEqual([{ no: '11', code: 'c', name: '상품', signal: { views: 7, orders: 2 } }]);
    expect(mq.mock.calls[0][1]).toEqual(['c-1', 30, 'mall', ['11', 'c', '상품']]);
    // 조회가 실패해도 목록은 그대로
    mq.mockRejectedValueOnce(new Error('relation "product_signal_daily" does not exist'));
    expect(await attachProductNumbers(U, list)).toBe(list);
  });

  it('★ Codex 구현 1R — 업종 평균(회사 전체 값)은 회사 관리자에게만: 담당자 · 슈퍼관리자 = live:false', () => {
    const r = code(back('routes/benchmark.ts'));
    expect(r).toContain("req.user?.userType !== 'company_admin'");
    expect(r.indexOf("req.user?.userType !== 'company_admin'")).toBeLessThan(r.indexOf('readBenchmark(companyId)'));
  });

  it('상품 길: 값이 나가는 주소는 전부 guarded(관문 + 503 분기)를 지난다 · summary 는 열림 여부만', () => {
    const r = code(back('routes/product-insight.ts'));
    expect(r).toContain('router.use(authenticate);');
    const routes = [...r.matchAll(/router\.(get|post)\('([^']+)',\s*(\w+)/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
    expect(routes).toEqual(['get /summary async', 'get /products guarded', 'get /search-terms guarded', 'post /audience-counts guarded', 'post /audience guarded']);
    const summary = r.slice(r.indexOf("router.get('/summary'"), r.indexOf("router.get('/products'"));
    expect(summary).not.toMatch(/listProductSignals|listSearchTerms|countViewedNotBought|listViewedNotBought/);
    const g = r.slice(r.indexOf('const guarded ='), r.indexOf("router.get('/summary'"));
    expect(g.indexOf('productInsightOpenFor(req.user as any)')).toBeLessThan(g.indexOf('await work('));
    expect(g).toContain("handleDbMigrationError(err, res, 'product_signal_daily')");
    expect(r).not.toMatch(/\bquery\(|SELECT |INSERT /);   // SQL 은 CT 에만
  });

  it('업종 평균 길: 닫힌 회사 · 슈퍼관리자 = live:false 한 줄 · 표 없음 = 503 · 다른 회사 값을 싣지 않는다', () => {
    const r = code(back('routes/benchmark.ts'));
    expect(r).toContain('router.use(authenticate);');
    expect(r.indexOf("!(await v3Live('benchmark', companyId))")).toBeLessThan(r.indexOf('readBenchmark(companyId)'));
    expect(r).toContain("handleDbMigrationError(err, res, 'benchmark_company_daily')");
    const ct = back('utils/performance-benchmark.ts');
    const view = ct.slice(ct.indexOf('export async function readBenchmark('), ct.indexOf('// ── 야간 워커 ──'));
    expect(view).not.toMatch(/\bk:|peer|rows:/);   // 회사 수 · 다른 회사 행을 응답에 싣지 않는다
  });

  it('등록: 두 길과 두 워커가 app 에 붙어 있다 · 몰 상품 목록에는 숫자를 덧붙이기만 한다', () => {
    const app = back('app.ts');
    expect(app).toContain("app.use('/api/product-insight', productInsightRoutes);");
    expect(app).toContain("app.use('/api/benchmark', benchmarkRoutes);");
    expect(app).toMatch(/^\s*startProductSignalWorker\(\);/m);
    expect(app).toMatch(/^\s*startBenchmarkWorker\(\);/m);
    const mall = back('routes/mall-products.ts');
    expect(mall.match(/await attachProductNumbers\(req\.user, withLineFields\(products, q\)\)/g)).toHaveLength(3);
    const ct = back('utils/product-signal.ts');
    const attach = ct.slice(ct.indexOf('export async function attachProductNumbers'), ct.indexOf('/** 이 회사에 최근 30일 관측'));
    expect(attach).toContain('!(await productInsightOpenFor(viewer))) return products;');
    // 라우트는 관문을 따로 적지 않는다(CT 의 한 판정)
    expect(code(back('routes/product-insight.ts'))).not.toMatch(/resolveHubStoreScope|v3Live\(/);
    expect(attach).toMatch(/catch \(err: any\) \{[\s\S]*return products;/);   // 실패해도 목록은 그대로
  });
});

describe('야간 계산 판정(순수)', () => {
  it('상품 신호 = KST 3시대 하루 한 번 · 상품 반응 · 추천 중 하나라도 열린 회사', () => {
    const at = (iso: string) => new Date(iso);
    expect(SIGNAL_RUN_HOUR_KST).toBe(3);
    expect(signalRunDue(at('2026-11-13T18:05:00Z'), '')).toBe(true);              // KST 11-14 03:05
    expect(signalRunDue(at('2026-11-13T18:35:00Z'), '2026-11-14')).toBe(false);
    expect(signalRunDue(at('2026-11-13T17:59:00Z'), '')).toBe(false);
    expect([...SIGNAL_FEATURES]).toEqual(['product-insight', 'reco']);
  });
  it('★ Codex 구현 1R — 판정 세 갈래: 요금제를 못 읽으면 unknown(입구는 닫힘 · 지우는 쪽은 지우지 않는다) · 명단 밖 = 요금제를 읽지 않는다', async () => {
    const lp = loadPlanContext as unknown as ReturnType<typeof vi.fn>;
    lp.mockClear();
    expect(await v3LiveState('reco', 'c-1')).toBe('closed');          // ENV 비어 있음
    expect(lp).not.toHaveBeenCalled();                                  // 닫힌 회사 = 쿼리 0
    process.env.V3_STAGE_RECO = 'c-1';
    expect(await v3LiveState('reco', 'c-1')).toBe('open');
    planCtx.value = FREE;
    expect(await v3LiveState('reco', 'c-1')).toBe('closed');          // 요금제가 막음 = 확인된 닫힘
    lp.mockRejectedValueOnce(new Error('db down'));
    expect(await v3LiveState('reco', 'c-1')).toBe('unknown');
    expect(await v3LiveState('reco', null)).toBe('closed');
    const ct = back('utils/product-signal.ts');
    const pass = ct.slice(ct.indexOf('export async function runProductSignalPass'), ct.indexOf('const WORKER_INTERVAL_MS'));
    expect(pass).toContain('const keep = new Set([...open, ...unknown]);');
    expect(pass).toContain('if (keep.has(id)) continue;');
  });

  it('화면이 묻는 열린 기능 목록 = 기능마다 같은 판정 · 어느 명단에도 없으면 요금제를 읽지 않는다', async () => {
    const lp = loadPlanContext as unknown as ReturnType<typeof vi.fn>;
    lp.mockClear();
    const none = (await v3FeaturesFor('c-1'))!;
    expect(Object.keys(none).sort()).toEqual([...V3_FEATURES].sort());
    expect(Object.values(none).every((v) => v === false)).toBe(true);
    expect(lp).not.toHaveBeenCalled();
    process.env.V3_STAGE_BENCHMARK = '*';
    process.env.V3_STAGE_RECO = 'c-9';
    expect(await v3FeaturesFor('c-1')).toMatchObject({ benchmark: true, reco: false, 'product-insight': false });
    planCtx.value = FREE;
    expect((await v3FeaturesFor('c-1'))!.benchmark).toBe(false);      // ⛔ 미가입 = 명단에 있어도 닫힘
    expect((await v3FeaturesFor(null))!.benchmark).toBe(false);
    // ★ Codex 배포 B 1R — 요금제를 읽지 못하면 「모름」(null) · 전부 닫힘으로 답하지 않는다(화면이 그 답을 기억하지 않게)
    planCtx.value = PAID;
    lp.mockRejectedValueOnce(new Error('db down'));
    expect(await v3FeaturesFor('c-1')).toBeNull();
    expect((await v3FeaturesFor('c-1'))!.benchmark).toBe(true);        // 다음 요청은 정상
    const route = code(back('routes/plans.ts'));
    expect(route).toContain("router.get('/v3-features', authenticate, async");
    expect(route).toContain("user?.userType === 'super_admin' ? null : user?.companyId");
    expect(route).toContain("if (!features) return res.json({ success: false, code: 'UNKNOWN' });");
    // 화면: 성공이 아닌 답은 빈 값 = 기억하지 않는다(다음 화면에서 다시 묻는다)
    const fe = front('utils/v3-features.ts');
    expect(fe).toContain("r.ok && r.body?.success === true && r.body.features && typeof r.body.features === 'object'");
    expect(fe).toContain('if (Object.keys(f).length === 0 && cache?.promise === promise) cache = null;');
  });

  it('단계 ENV 명단 읽기 = 전 회사(*) · 회사 목록 · 비어 있음', () => {
    expect(v3StageScope('reco', {})).toEqual({ all: false, ids: [] });
    expect(v3StageScope('reco', { V3_STAGE_RECO: ' a , b ' })).toEqual({ all: false, ids: ['a', 'b'] });
    expect(v3StageScope('reco', { V3_STAGE_RECO: '*, a' })).toEqual({ all: true, ids: ['a'] });
  });
});

describe('「켜기 전 점검」 창 — 갇히지 않는다(설계서 §3-1 8번)', () => {
  const m = front('components/journey/map/BatchActivateModal.tsx');
  const c = code(m);
  const run = c.slice(c.indexOf('const run = async () => {'), c.indexOf('const handleClose = () => {'));
  const close = c.slice(c.indexOf('const handleClose = () => {'), c.indexOf('const excludeFirstPurchase'));

  it('닫기를 잠그지 않는다 · 닫기는 한 함수(handleClose)로만', () => {
    expect(c).not.toContain('disableDismiss');
    expect(c).toContain('<JourneyModalShell open={open} onClose={handleClose} labelledBy="jmap-batch-title"');
    expect(c.match(/onClick=\{onClose\}/g)).toBeNull();
    expect(c.match(/onClick=\{handleClose\}/g)).toHaveLength(2);
    expect(c).not.toMatch(/onClick=\{handleClose\} disabled/);
  });

  it('검증 구간의 요청은 시간 제한 + 끊을 수 있다 · 켜기 요청은 끊는 신호를 싣지 않는다', () => {
    expect(c).toContain("sendJson(`/api/ai/operator/journeys/${id}/pretest-validate`, { method: 'POST', signal: abortRef.current?.signal }, VALIDATE_TIMEOUT_MS)");
    const act = run.slice(run.indexOf("sendJson('/api/ai/operator/journeys-activate-batch'"), run.indexOf('const d = res.body || {};', run.indexOf("sendJson('/api/ai/operator/journeys-activate-batch'")));
    expect(act).toContain('ACTIVATE_TIMEOUT_MS');
    expect(act).not.toContain('signal');
    expect(run).not.toMatch(/\bfetch\(/);   // 시간 제한 없는 요청 0(검증 · 켜기)
  });

  it('닫아서 취소한 뒤에는 켜기 요청을 보내지 않는다 · 켜기 접수 표시는 요청 직전에', () => {
    expect(run).toMatch(/if \(rid !== runId\.current\) return;\s*setPhase\('activating'\);/);   // 켜기 접수 바로 앞에서 세대를 다시 본다
    expect(run.indexOf("setPhase('activating');")).toBeLessThan(run.indexOf("sendJson('/api/ai/operator/journeys-activate-batch'"));
    expect(run).toContain("if (v === 'stale') return;");
    expect(run).toContain("if (rid === runId.current) { setPhase('idle'); setProgress(null); }");
  });

  it('닫기: 검증 구간 = 세대 올림 + 요청 끊기 + 「검증 중」 되돌림 · 켜기 접수 뒤 = 아무것도 끊지 않고 숨김', () => {
    expect(close).toContain("if (phase !== 'activating') {");
    const body = close.slice(close.indexOf("if (phase !== 'activating') {"), close.indexOf('onClose();'));
    expect(body).toContain('runId.current++;');
    expect(body).toContain('abortRef.current?.abort();');
    expect(body).toContain("filter(([, c]) => c.state !== 'checking')");
    expect(close.trim().endsWith('onClose();\n  };')).toBe(true);
  });

  it('★ Codex 구현 1R ~ 3R(같은 계열) — 켜기 창은 최대 인원을 따로 저장하지 않는다: 켜기 요청 하나가 화면의 값을 싣는다', () => {
    // 기억 장치 · 저장 요청이 없다(검증 구간에서 서버 값을 바꾸는 요청 0 = 끊은 저장 · 잃은 응답 · 늦게 닿은 저장이 있을 수 없다)
    expect(c).not.toMatch(/savedCaps|lastSavedCap|knownServerCap|shownCap|recheck/);
    expect(front('utils/journey-map.ts')).not.toContain('knownServerCap');
    expect(run).not.toContain('/options');
    expect(run).not.toContain("method: 'PATCH'");
    expect(run).not.toContain('thresholdRecipients');
    expect(run.match(/sendJson\(/g)).toHaveLength(1);                       // run 안의 요청 = 켜기 하나(검증은 validateOne)
    // 켜기 요청 = 누른 순간 잡아 둔 화면 값을 여정마다 싣는다
    expect(run).toContain('list: selectedList.map((c) => ({ id: c.id, name: c.name, cap: capOf(c.id) })),');
    expect(run).toContain('caps: Object.fromEntries(at.list.map((c) => [c.id, c.cap]))');
    // 창의 다른 저장(첫 구매 고객 빼기)은 최대 인원을 싣지 않는다
    const others = c.slice(c.indexOf('const excludeFirstPurchase'));
    expect(others).not.toContain('thresholdRecipients');
  });

  it('★ Codex 구현 3R — 서버: 켜기 요청의 최대 인원을 읽는 꼴(틀린 값을 「건드리지 않음」으로 흘려 보내지 않는다)', () => {
    expect(parseActivationCaps(undefined)).toEqual(new Map());                  // 안 보냄 = 최대 인원을 건드리지 않는다(종전)
    expect(parseActivationCaps(null)).toEqual(new Map());
    expect(parseActivationCaps({ a: 10, b: null, c: ACTIVATION_CAP_MAX })).toEqual(new Map<string, number | null>([['a', 10], ['b', null], ['c', ACTIVATION_CAP_MAX]]));
    for (const bad of [{ a: 0 }, { a: -1 }, { a: 1.5 }, { a: '10' }, { a: true }, { a: ACTIVATION_CAP_MAX + 1 }, { a: NaN }, [10], 'x', 5]) {
      expect([JSON.stringify(bad), parseActivationCaps(bad)]).toEqual([JSON.stringify(bad), null]);
    }
  });

  it('★ Codex 구현 3R — 서버: 최대 인원은 켜는 그 UPDATE 문장이 함께 쓴다(같은 행 · 같은 조건 · 같은 커밋) · 값을 안 실으면 문장이 종전과 같다', () => {
    const jb = back('utils/journey-builder.ts');
    const fn = code(jb.slice(jb.indexOf('export async function activateJourney('), jb.indexOf('// 활성화 종결 직후 = step snapshot 보존')));
    expect(fn).toContain('const withCap = opts.setCap !== undefined;');
    const upd = fn.slice(fn.indexOf('UPDATE journeys SET\n      status = \'active\','), fn.indexOf('RETURNING id, approved_at'));
    expect(upd).toContain("updated_at = NOW()${withCap ? `,\n      threshold_recipients_per_step = $4::int` : ''}");
    expect(upd).toContain("WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('draft', 'paused')");
    expect(upd).toContain('AND last_pretest_passed_at IS NOT NULL');
    expect(fn).toContain('[journeyId, companyId, userId].concat(withCap ? [opts.setCap as any] : [])');
    // 2R 의 대조 장치는 걷었다(덧댄 장치가 구조 수정과 함께 사라진다)
    expect(jb).not.toMatch(/expectedCap|sameJourneyCap|JOURNEY_CAP_CHANGED_REASON/);
    const ja = code(back('utils/journey-activation.ts'));
    expect(ja).toContain('activateJourney(companyId, journeyId, userId, { requireActiveSource: opts.requireActiveSource, setCap: opts.setCap })');
    expect(ja).toContain('...(opts.caps?.has(j.id) ? { setCap: opts.caps.get(j.id) as number | null } : {}),');
    expect(ja).not.toContain('expectedCap');
    const r = back('routes/ai.ts');
    const route = code(r.slice(r.indexOf("router.post('/operator/journeys-activate-batch'"), r.indexOf("router.post('/operator/journeys-activate-batch'") + 2600));
    expect(route).toContain('const caps = parseActivationCaps(rawCaps);');
    expect(route).toContain('if (!caps) return res.status(400)');
    expect(route).toMatch(/activateJourneysInOrder\(companyId, userId, ids, \{[\s\S]*?\n\s*caps,\n\s*\}\);/);   // 읽은 값을 켜기로 넘긴다
    expect(route.indexOf('accessibleJourneyIds(gate)')).toBeLessThan(route.indexOf('activateJourneysInOrder('));   // 주인 확인이 켜기(값 쓰기)보다 앞
    // 하나씩 켜기 · 새 모양 켜기 호출은 값을 싣지 않는다 = 종전 그대로
    expect(code(back('utils/journey-reshape.ts'))).not.toContain('setCap');
    const single = code(r.slice(r.indexOf('const r = await activateJourneyGuarded(companyId, journeyId, userId, {'), r.indexOf('const r = await activateJourneyGuarded(companyId, journeyId, userId, {') + 400));
    expect(single).not.toContain('setCap');
  });

  it('★ Codex 구현 1R — 본문을 받다 끊긴 응답 = 결과 모름(status 0) · 켜기 창은 지도를 다시 읽게 한다', () => {
    const live = front('utils/dashboard-live.ts');
    const fn = live.slice(live.indexOf('export async function sendJson('), live.indexOf('export function serialRunner'));
    expect(fn).not.toContain('r.json().catch(() => null)');
    expect(fn).toContain('if (!(e instanceof SyntaxError) || ctl.signal.aborted) return { ok: false, status: 0, body: null };');
    expect(run).toContain('if (res.status === 0 || (res.ok && !res.body)) {');
  });

  it('응답을 못 받으면 지도를 다시 읽게 하고 되돌리지 않는다 · 진행 글', () => {
    expect(run.indexOf('onDone();', run.indexOf('if (res.status === 0 ||'))).toBeLessThan(run.indexOf("setError('켜기 응답을 받지 못했어요."));
    expect(m).toContain('닫으면 검증을 멈춰요');
    expect(m).toContain('켜는 중이에요. 닫아도 계속 켜져요.');
    expect(m).toContain('검증 중');
  });
});

describe('화면 문구 · 금지', () => {
  it('새 화면 파일에 native dialog · AI 모델 이름 · 출처 줄이 없다', () => {
    for (const rel of ['components/performance/ProductSignalSection.tsx', 'utils/product-insight.ts', 'utils/benchmark.ts', 'utils/v3-intro.ts']) {
      const s = front(rel);
      expect([rel, /\b(alert|confirm|prompt)\(/.test(s)]).toEqual([rel, false]);
      expect([rel, /opus|sonnet|haiku|gpt|claude|anthropic/i.test(s)]).toEqual([rel, false]);
      expect([rel, /출처:|Data source/.test(s)]).toEqual([rel, false]);
    }
  });
  it('상품 구역: 순위 · 재고를 약속하는 문구가 없다 · 인원이 0이거나 모르면 보내기 단추를 그리지 않는다', () => {
    const s = front('components/performance/ProductSignalSection.tsx');
    expect(code(s)).not.toMatch(/인기 ?1위|품절 임박|재고/);   // 주석 밖(화면에 나가는 글)
    expect(s.match(/if \(n <= 0\) return null;/g)).toHaveLength(2);
    expect(s).toContain("const n = p.door === 'mall' ? counts?.products[p.key] ?? 0 : 0;");
  });
});
