// ★ 2026-11-10 합성 데이터 v3 — 인비토(허용 목록 · 시연 아님)를 실제 회사처럼(설계서 docs/2026-11-10-synthetic-company-realism-design.md §6)
//   ① 시연 회사 v2 출력 변화 0(바꾸기 전 코드로 뽑은 지문) ② 매장 줄 · 분포 ③ 등급 · 포인트(손 계산 · 재실행 단조)
//   ④ 수신거부 ⑤ 온라인 일정 · 사건 이름(소비자 기계 추출) · 가상 번호 ⑥ 멱등 · 실패 멈춤 · 상한 ⑦ 허용 판정
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const S = vi.hoisted(() => ({
  DEMO: '11111111-1111-1111-1111-111111111111',
  TEST: 'c7c97996-19b3-4e4f-9c45-ce10deab257f',
  REAL: '33333333-3333-3333-3333-333333333333',
  syncKeyOwner: new Map<string, string>(),
  cdpKeyOwner: new Map<string, string>(),
  customers: new Map<string, any>(),          // phone → 마지막으로 받은 고객 행
  ledger: new Map<string, any>(),             // source_row_key → 구매 행
  cdpSentKeys: new Set<string>(),             // properties.event_key
  cdpSentOrders: new Set<string>(),           // properties.order_id
  eventInserts: new Map<string, number>(),    // event_key → 적힌 횟수(성공한 호출만)
  links: new Set<string>(),                   // external_id
  failNextSync: null as null | 'customers' | 'purchases',
  failCdpAt: -1,
  calls: [] as Array<{ path: string; body: any }>,
}));

vi.mock('../../config/database', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    if (/SELECT id FROM companies WHERE api_key = \$1/.test(sql)) {
      const id = S.syncKeyOwner.get(String(params[0]));
      return { rows: id ? [{ id }] : [] };
    }
    if (/SELECT id FROM companies WHERE cdp_api_key = \$1/.test(sql)) {
      const id = S.cdpKeyOwner.get(String(params[0]));
      return { rows: id ? [{ id }] : [] };
    }
    if (/SELECT is_demo FROM companies/.test(sql)) return { rows: [{ is_demo: params[0] === S.DEMO }] };
    if (/source_row_key LIKE 'demo-seed-%'/.test(sql)) return { rows: [] };
    if (/SELECT phone FROM customers/.test(sql)) {
      return { rows: (params[1] as string[]).filter((p) => S.customers.has(p)).map((phone) => ({ phone })) };
    }
    if (/FROM purchases/.test(sql) && /customer_phone = ANY/.test(sql)) {
      const want = new Set(params[1] as string[]);
      return {
        rows: [...S.ledger.values()].filter((r) => want.has(r.customer_phone)).map((r) => ({
          customer_phone: r.customer_phone, d: r.purchase_date.slice(0, 10), at: r.purchase_date, total_amount: r.total_amount, store_name: r.store_name,
        })),
      };
    }
    if (/FROM cdp_events/.test(sql)) {
      return { rows: [...[...S.cdpSentKeys].map((k) => ({ k, o: null })), ...[...S.cdpSentOrders].map((o) => ({ k: null, o }))] };
    }
    if (/FROM cdp_identity_links/.test(sql)) {
      return { rows: (params[1] as string[]).filter((e) => S.links.has(e)).map((external_id) => ({ external_id })) };
    }
    return { rows: [] };
  });
  return { query, pool: { query }, default: { query } };
});

const fetchMock = vi.fn(async (url: string, init: any) => {
  const path = String(url).replace(/^http:\/\/127\.0\.0\.1:\d+/, '');
  const body = JSON.parse(init.body);
  S.calls.push({ path, body });
  const ok = (data: any) => ({ ok: true, status: 200, json: async () => ({ success: true, data }), text: async () => '' });
  if (path === '/api/sync/customers') {
    if (S.failNextSync === 'customers') { S.failNextSync = null; return ok({ upsertedCount: 0, failedCount: 1 }); }
    for (const c of body.customers) S.customers.set(c.phone, c);
    return ok({ upsertedCount: body.customers.length, failedCount: 0 });
  }
  if (path === '/api/sync/purchases') {
    if (S.failNextSync === 'purchases') { S.failNextSync = null; return ok({ insertedCount: 0, failedCount: 1 }); }
    for (const p of body.purchases) S.ledger.set(p.source_row_key, p);
    return ok({ insertedCount: body.purchases.length, failedCount: 0 });
  }
  if (path.startsWith('/api/cdp/')) {
    const n = S.calls.filter((c) => c.path.startsWith('/api/cdp/')).length - 1;
    if (n === S.failCdpAt) return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
    if (path === '/api/cdp/identify') S.links.add(body.external_id);
    if (path === '/api/cdp/event') { S.cdpSentKeys.add(body.properties.event_key); S.eventInserts.set(body.properties.event_key, (S.eventInserts.get(body.properties.event_key) || 0) + 1); }
    if (path === '/api/cdp/order') S.cdpSentOrders.add(body.order_id);
    return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => '' };
  }
  throw new Error(`unexpected ${path}`);
});
vi.stubGlobal('fetch', fetchMock);

import {
  buildDailyBatch, buildSeedData, demoPhone, demoTimeline, dayNumber, SYNTHETIC_PHONE_PATTERN,
  realismPurchasesOn, promoDiscountOn, loyaltyAt, optOutDay, pushDemoDaily, isRealismCompany,
  onlineScheduleOn, dueOnlineSends, pushRealismOnline, parseSyntheticCdpKeys, mallExternalId, isMallMember,
  realismCatalogOn, resetRealismOnlineState,
} from '../demo-data';
import { __resetDemoCompanyCache } from '../demo-company';
import { STANDARD_EVENT_NAMES } from '../cdp-events';

const h = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ROOT = join(__dirname, '../../..');

beforeEach(() => {
  __resetDemoCompanyCache?.();
  resetRealismOnlineState();
  S.syncKeyOwner.clear(); S.cdpKeyOwner.clear(); S.customers.clear(); S.ledger.clear();
  S.cdpSentKeys.clear(); S.cdpSentOrders.clear(); S.eventInserts.clear(); S.links.clear(); S.calls.length = 0;
  S.failNextSync = null; S.failCdpAt = -1;
  process.env.SYNTHETIC_DATA_COMPANY_IDS = S.TEST;
  fetchMock.mockClear();
});

describe('① 시연 회사 v2 변화 0', () => {
  // 지문 = 2026-11-10 바꾸기 전 코드(HEAD da47c9f7 의 demo-data.ts)로 뽑은 값 — 독립 기대값(지금 코드로 다시 계산하지 않는다)
  it('buildDailyBatch 세 날 · buildSeedData 지문이 그대로', () => {
    expect(h(buildDailyBatch('2026-10-21'))).toBe('5480f2b4d4101ebd5df7f06adf4fc082e16f3295d1f1afa5b8379e59a771dd9a');
    expect(h(buildDailyBatch('2026-11-10'))).toBe('006a9c4829c78d8422e41434aa2f368891790592d070aa5e096699be24d835f4');
    expect(h(buildDailyBatch('2026-12-31'))).toBe('e9e1c82e88760c642cd8f4f38a06ea62d3ce2ebc564c197828e69bec0e31d0f8');
    const s = buildSeedData('2026-10-20');
    expect([s.customers.length, s.purchases.length]).toEqual([3000, 11287]);
    expect(h(s)).toBe('a00eb89bd1f88a74f034bad9d53564343122cee7fcc7b3ac9de59f5af1d033b2');
  });

  it('시연 회사 키 = v2 갈래(덧붙인 줄 · 포인트 0)', async () => {
    S.syncKeyOwner.set('tk_demo', S.DEMO);
    await pushDemoDaily({ apiKey: 'tk_demo', apiSecret: 's' }, new Date('2026-11-10T00:00:00Z'));
    const rows = S.calls.filter((c) => c.path === '/api/sync/purchases').flatMap((c) => c.body.purchases);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => r.source_row_key.startsWith('demo-v2-'))).toBe(true);
    const cust = S.calls.filter((c) => c.path === '/api/sync/customers').flatMap((c) => c.body.customers);
    expect(cust.every((c: any) => !('points' in c))).toBe(true);
  });
});

describe('② 매장 줄 (v3)', () => {
  it('한 방문 = v2 줄(같은 키 · 수량 1) + 덧붙인 줄(v3x 키) · 시각 · 매장 하나 · 결정적', () => {
    let checked = 0;
    for (let idx = 0; idx < 3000 && checked < 50; idx++) {
      for (const b of demoTimeline(idx).buys.filter((x) => x.seq === 0).slice(0, 2)) {
        const a = realismPurchasesOn(idx, b.day);
        expect(a).toEqual(realismPurchasesOn(idx, b.day));
        expect(a.every((r) => r.quantity === 1)).toBe(true);
        expect(new Set(a.map((r) => r.purchase_date)).size).toBe(1);
        expect(new Set(a.map((r) => r.store_code)).size).toBe(1);
        expect(new Set(a.map((r) => r.source_row_key)).size).toBe(a.length);
        for (const r of a) expect(r.source_row_key).toMatch(new RegExp(`^demo-(v2|v3x)-${idx}-${b.day}-\\d+$`));
        checked++;
      }
    }
    expect(checked).toBe(50);
  });

  it('한 방문 줄 수 평균 2.89 ± 0.15 · 1 ~ 6줄(실측 평균 2.88 · 중간 2 · 90% 5)', () => {
    const sizes: number[] = [];
    for (let idx = 0; idx < 3000; idx++) {
      const days = [...new Set(demoTimeline(idx).buys.map((b) => b.day))].slice(0, 3);
      for (const d of days) sizes.push(realismPurchasesOn(idx, d).length);
    }
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    expect(sizes.length).toBeGreaterThan(3000);
    expect(Math.abs(mean - 2.89)).toBeLessThanOrEqual(0.15);
    expect(Math.min(...sizes)).toBe(1);
    expect(sizes.filter((n) => n > 6).length / sizes.length).toBeLessThan(0.01);   // v2 줄이 목표보다 많은 방문만 6 초과
  });

  it('행사 할인 = 달마다 5일 · 10 ~ 30% · 금액 100원 단위 · 정가 칸은 정가', () => {
    for (const ym of ['2026-11', '2026-12', '2027-01', '2027-02']) {
      const days = Array.from({ length: 28 }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`).map(promoDiscountOn);
      const on = days.filter((d) => d > 0);
      expect(on.length).toBe(5);
      expect(new Set(on).size).toBe(1);
      expect(on[0]).toBeGreaterThanOrEqual(0.1);
      expect(on[0]).toBeLessThanOrEqual(0.3);
    }
    for (let idx = 0; idx < 300; idx++) {
      for (const b of demoTimeline(idx).buys) {
        for (const r of realismPurchasesOn(idx, b.day)) {
          expect(r.total_amount % 100).toBe(0);
          expect(r.total_amount).toBeLessThanOrEqual(r.unit_price);
        }
      }
    }
  });

  it('신상품 = 2026-11 부터 달마다 2종 · 출시 달 전에는 목록에 없다', () => {
    const oct = realismCatalogOn('2026-10-31').map((p) => p.code);
    const nov = realismCatalogOn('2026-11-15').map((p) => p.code);
    const jan = realismCatalogOn('2027-01-02').map((p) => p.code);
    expect(oct.length).toBe(60);
    expect(nov.filter((c) => c.startsWith('NW-'))).toEqual(['NW-2611-1', 'NW-2611-2']);
    expect(jan.filter((c) => c.startsWith('NW-')).length).toBe(6);
    expect(new Set(jan).size).toBe(jan.length);
  });
});

describe('③ 등급 · 포인트', () => {
  it('손 계산 예: 방문 3번(10만 · 30만 · 50만) · 사용 판정 없음 = 2.7만 포인트 · 누적 90만 = 골드', () => {
    // 사용 판정 = rng(v3-pts-번호-날) < 0.25 — 이 번호 · 날들이 전부 사용 아님인 것을 먼저 고정해 둔다
    const r = loyaltyAt(7, '일반', [{ day: 300, amount: 100_000 }, { day: 330, amount: 300_000 }, { day: 360, amount: 500_000 }], () => false);
    expect(r).toEqual({ grade: '골드', points: 27_000 });
  });

  it('손 계산 예: 두 번째 방문이 사용 = 그 전 3,000 을 쓰고 9,000 적립 → 세 번째 15,000 더해 24,000', () => {
    const r = loyaltyAt(7, '일반', [{ day: 300, amount: 100_000 }, { day: 330, amount: 300_000 }, { day: 360, amount: 500_000 }], (_i, d) => d === 330);
    expect(r).toEqual({ grade: '골드', points: 24_000 });
  });

  it('등급 = max(번호 고정 등급 · 누적 기준) · 내려가지 않는다', () => {
    expect(loyaltyAt(1, 'VIP', [{ day: 1, amount: 10_000 }], () => false).grade).toBe('VIP');
    expect(loyaltyAt(1, '일반', [{ day: 1, amount: 299_999 }], () => false).grade).toBe('일반');
    expect(loyaltyAt(1, '일반', [{ day: 1, amount: 300_000 }], () => false).grade).toBe('실버');
    expect(loyaltyAt(1, '실버', [{ day: 1, amount: 2_000_000 }], () => false).grade).toBe('VIP');
  });

  const RANK: Record<string, number> = { 일반: 0, 실버: 1, 골드: 2, VIP: 3 };
  const runDay = async (iso: string) => pushDemoDaily({ apiKey: 'tk_test', apiSecret: 's' }, new Date(iso));

  it('같은 날 두 번(끝난 뒤 · 구매 뒤 묶음 실패 뒤) 돌려도 한 고객에게 보낸 등급 서열이 내려가지 않는다 · 구매 전 단계 = 없는 번호만', async () => {
    S.syncKeyOwner.set('tk_test', S.TEST);
    // 끝난 뒤 재실행
    await runDay('2026-11-11T00:00:00Z');
    const mark = S.calls.length;
    await runDay('2026-11-11T01:00:00Z');
    const rerun = S.calls.slice(mark).map((c) => c.path);
    expect(rerun.indexOf('/api/sync/purchases')).toBeGreaterThanOrEqual(0);
    expect(rerun.indexOf('/api/sync/customers')).toBeGreaterThan(rerun.indexOf('/api/sync/purchases'));   // 구매 전 단계 0건
    // 구매 뒤 묶음 실패 뒤 재실행 — 구매를 넣은 뒤의 고객 묶음 하나가 failedCount 1
    const origin = fetchMock.getMockImplementation()!;
    let afterPurchases = false;
    let failed = false;
    fetchMock.mockImplementation(async (url: string, init: any) => {
      const path = String(url).replace(/^http:\/\/127\.0\.0\.1:\d+/, '');
      if (path === '/api/sync/purchases') afterPurchases = true;
      if (path === '/api/sync/customers' && afterPurchases && !failed) {
        failed = true;
        S.calls.push({ path, body: JSON.parse(init.body) });
        return { ok: true, status: 200, json: async () => ({ success: true, data: { failedCount: 1 } }), text: async () => '' };
      }
      return origin(url, init);
    });
    await expect(runDay('2026-11-12T00:00:00Z')).rejects.toThrow(/failedCount/);
    fetchMock.mockImplementation(origin);
    await runDay('2026-11-12T01:00:00Z');
    await runDay('2026-11-13T00:00:00Z');
    // 보낸 고객 행 순서대로(실패한 묶음 포함) — 한 번호의 등급 서열이 내려가지 않는다
    const seen = new Map<string, number>();
    let rows = 0;
    for (const c of S.calls.filter((x) => x.path === '/api/sync/customers')) {
      for (const row of c.body.customers) {
        const prev = seen.get(row.phone);
        if (prev != null) expect(RANK[row.grade]).toBeGreaterThanOrEqual(prev);
        seen.set(row.phone, RANK[row.grade]);
        rows++;
      }
    }
    expect(rows).toBeGreaterThan(100);
  });

  it('가입 당일 구매 고객은 구매 뒤 묶음에 들어 포인트가 실린다', async () => {
    S.syncKeyOwner.set('tk_test', S.TEST);
    await runDay('2026-11-11T00:00:00Z');
    const custCalls = S.calls.filter((c) => c.path === '/api/sync/customers');
    const purchases = S.calls.filter((c) => c.path === '/api/sync/purchases').flatMap((c) => c.body.purchases);
    const newBuyerPhone = purchases.map((p: any) => p.customer_phone).find((ph: string) => Number(ph.slice(4)) >= 3000 + dayNumber('2026-11-11') * 100);
    expect(newBuyerPhone).toBeTruthy();
    const last = custCalls[custCalls.length - 1].body.customers.find((c: any) => c.phone === newBuyerPhone);
    expect(last).toBeTruthy();
    expect(last.points).toBeGreaterThan(0);
  });

  it('싱크 200 + failedCount 1 = 던진다(회차 미완)', async () => {
    S.syncKeyOwner.set('tk_test', S.TEST);
    S.failNextSync = 'purchases';
    await expect(runDay('2026-11-11T00:00:00Z')).rejects.toThrow(/failedCount/);
  });
});

describe('④ 수신거부', () => {
  it('거부 날 이후 보내는 행 = false · 최근 7일 안 거부 고객은 그날 다시 보낸다', async () => {
    S.syncKeyOwner.set('tk_test', S.TEST);
    const today = '2026-11-20';
    const sd = dayNumber(today) - 1;
    const recent: number[] = [];
    for (let idx = 0; idx < 3000; idx++) { const o = optOutDay(idx); if (o >= sd - 6 && o <= sd) recent.push(idx); }
    expect(recent.length).toBeGreaterThan(0);
    for (const idx of recent) S.customers.set(demoPhone(idx), { sms_opt_in: true });   // 이미 있는 고객이 거부 = 구매 전 단계는 안 보낸다 → 구매 뒤 묶음이 보내야 한다
    await pushDemoDaily({ apiKey: 'tk_test', apiSecret: 's' }, new Date(`${today}T00:00:00Z`));
    const rows = new Map<string, any>();
    for (const c of S.calls.filter((x) => x.path === '/api/sync/customers')) for (const r of c.body.customers) rows.set(r.phone, r);
    for (const idx of recent) expect(rows.get(demoPhone(idx))?.sms_opt_in).toBe(false);
    for (const [phone, r] of rows) expect(r.sms_opt_in).toBe(optOutDay(Number(phone.slice(4))) > sd);
  });
});

describe('⑤ 온라인 일정', () => {
  it('결정적 · 몰 회원만 · 그날 매장 구매가 있으면 몰 방문 0 · 시각 09 ~ 23시', () => {
    const ymd = '2026-11-15';
    const a = onlineScheduleOn(ymd);
    expect(a).toEqual(onlineScheduleOn(ymd));
    expect(a.length).toBeGreaterThan(50);
    const d = dayNumber(ymd);
    for (const s of a) {
      expect(isMallMember(s.index)).toBe(true);
      expect(demoTimeline(s.index).buys.some((b) => b.day === d)).toBe(false);
      const hh = Number(s.at.slice(11, 13));
      expect(hh).toBeGreaterThanOrEqual(9);
      expect(hh).toBeLessThanOrEqual(23);
    }
    const share = Array.from({ length: 3000 }, (_, i) => i).filter(isMallMember).length / 3000;
    expect(Math.abs(share - 0.4)).toBeLessThan(0.03);
  });

  it('사건 이름 = 소비자(journey-target-extractor 의 장바구니 · 조회 조건)가 읽는 이름을 덮는다', () => {
    const src = readFileSync(join(ROOT, 'src/utils/journey-target-extractor.ts'), 'utf-8');
    const consumer = new Set([...src.matchAll(/event_name = '([a-z_]+)'/g)].map((m) => m[1]));
    expect(consumer.size).toBeGreaterThanOrEqual(3);
    const produced = new Set<string>();
    for (let k = 0; k < 7; k++) for (const s of onlineScheduleOn(`2026-11-${String(10 + k).padStart(2, '0')}`)) if (s.kind === 'event') produced.add(s.body.event_name);
    for (const name of consumer) expect(produced.has(name)).toBe(true);
    // 수집 API 가 받는 이름(표준 목록 · validateEventName)만 보낸다 — 목록은 cdp-events 에서 그대로 읽는다
    for (const name of produced) expect((STANDARD_EVENT_NAMES as readonly string[]).includes(name)).toBe(true);
  });

  it('가상 번호 계약 = 모든 번호가 도달 불가 패턴 · 이메일 칸 0 · 주문 상품 키 = 매장 상품 코드', () => {
    const re = new RegExp(SYNTHETIC_PHONE_PATTERN);
    const all = [...onlineScheduleOn('2026-11-15'), ...onlineScheduleOn('2026-11-16')];
    for (const s of all) {
      expect(re.test(demoPhone(s.index))).toBe(true);
      expect(JSON.stringify(s.body)).not.toMatch(/email/i);
      expect(s.body.external_id).toBe(mallExternalId(s.index));
      if (s.kind === 'order') {
        expect(s.body.status).toBe('paid');
        expect(s.body.total_amount).toBe(s.body.items.reduce((t: number, x: any) => t + x.price, 0));
        for (const it of s.body.items) expect(realismCatalogOn('2026-11-16').some((p) => p.code === it.productId)).toBe(true);
      }
    }
    expect(all.some((s) => s.kind === 'order')).toBe(true);
  });

  it('보낼 것 = 최근 7일 · 지금까지 생긴 것만 · 오래된 것부터', () => {
    const now = new Date('2026-11-16T03:00:00Z');   // KST 12:00
    const due = dueOnlineSends(now);
    expect(due.every((s) => Date.parse(s.at) <= now.getTime())).toBe(true);
    expect(due.every((s) => s.at >= '2026-11-10T00:00:00+09:00')).toBe(true);
    for (let k = 1; k < due.length; k++) expect(due[k].at >= due[k - 1].at).toBe(true);
    expect(due.some((s) => s.at.startsWith('2026-11-16'))).toBe(true);
    expect(due.some((s) => s.at.startsWith('2026-11-09'))).toBe(false);
  });
});

describe('⑥ 온라인 보내기 — 멱등 · 실패 멈춤 · 상한 · 미룸', () => {
  const key = { apiKey: 'hjl_test', apiSecret: 'sk_test' };
  const now = new Date('2026-11-16T03:00:00Z');
  const seedCustomers = () => { for (const s of dueOnlineSends(now)) S.customers.set(demoPhone(s.index), {}); };

  it('보낸 뒤 다시 돌리면 0건 · 회원 잇기는 첫 사건 전에 한 번', async () => {
    S.cdpKeyOwner.set('hjl_test', S.TEST);
    seedCustomers();
    const r1 = await pushRealismOnline(key, now, 0);
    expect(r1.sent).toBeGreaterThan(0);
    const cdp = S.calls.filter((c) => c.path.startsWith('/api/cdp/'));
    const firstUse = new Map<string, string>();
    for (const c of cdp) { const ext = c.body.external_id; if (!firstUse.has(ext)) firstUse.set(ext, c.path); }
    for (const p of firstUse.values()) expect(p).toBe('/api/cdp/identify');
    expect(cdp.filter((c) => c.path === '/api/cdp/identify').length).toBe(firstUse.size);
    // 한 tick 상한 600 이라 7일치는 여러 tick — 다 보낸 뒤 한 번 더 돌리면 0건
    let ticks = 1;
    while (ticks < 30 && (await pushRealismOnline(key, now, 0)).sent > 0) ticks++;   // 상한 = 멱등이 깨지면 끝없이 돌지 않고 실패
    expect(ticks).toBeGreaterThan(1);
    expect(ticks).toBeLessThan(30);
    S.calls.length = 0;
    const r2 = await pushRealismOnline(key, now, 0);
    expect(r2.sent).toBe(0);
    expect(S.calls.length).toBe(0);
    expect([...S.eventInserts.values()].every((n) => n === 1)).toBe(true);
    expect(S.cdpSentKeys.size + S.cdpSentOrders.size).toBe(dueOnlineSends(now).length);
  });

  it('전송 오류 = 그 tick 남은 것 0건 · 실제 실패 시각부터 10분은 쉼(늦게 적힌 원 요청과 겹치지 않음) · 그 뒤 이어서', async () => {
    S.cdpKeyOwner.set('hjl_test', S.TEST);
    seedCustomers();
    // tick 은 07:00(now) 시작인데 앞 키 처리로 늦어져 이 키는 실제 시계 11분에 시작해 실패한다
    let t = 11 * 60_000;
    const clock = () => t;
    S.failCdpAt = 5;
    await expect(pushRealismOnline(key, now, 0, clock)).rejects.toThrow();
    const cdp = S.calls.filter((c) => c.path.startsWith('/api/cdp/'));
    expect(cdp.length).toBe(6);
    S.failCdpAt = -1;
    // 다음 tick(실제 시계 20분 = 실패 9분 뒤) = 아무것도 안 한다
    S.calls.length = 0;
    t = 20 * 60_000;
    expect(await pushRealismOnline(key, new Date(now.getTime() + 20 * 60_000), 0, clock)).toEqual({ sent: 0, deferred: 0 });
    expect(S.calls.length).toBe(0);
    // 그 사이 서버가 실패로 끝난 원 요청을 늦게 적는다
    const late = cdp[5];
    if (late.path === '/api/cdp/event') { S.cdpSentKeys.add(late.body.properties.event_key); S.eventInserts.set(late.body.properties.event_key, 1); }
    else if (late.path === '/api/cdp/order') S.cdpSentOrders.add(late.body.order_id);
    else S.links.add(late.body.external_id);
    // 실패 10분 1초 뒤 = 적힌 키를 다시 읽고 이어서 · 한 사건 = 한 행
    t = 21 * 60_000 + 1_000;
    const after = new Date(now.getTime() + 21 * 60_000 + 1_000);
    for (const s of dueOnlineSends(after)) S.customers.set(demoPhone(s.index), {});   // 그 사이 새로 생긴 사건의 회원도 고객 행 있음(미룸 0)
    let ticks = 0;
    while (ticks < 30 && (await pushRealismOnline(key, after, 0, clock)).sent > 0) ticks++;   // 다 보낼 때까지 · 상한 30
    expect(ticks).toBeLessThan(30);
    expect([...S.eventInserts.values()].every((n) => n === 1)).toBe(true);
    expect(S.cdpSentKeys.size + S.cdpSentOrders.size).toBe(dueOnlineSends(after).length);
  });

  it('한 tick 상한 600 · 오래된 것부터', async () => {
    S.cdpKeyOwner.set('hjl_test', S.TEST);
    seedCustomers();
    const r = await pushRealismOnline(key, now, 0);
    expect(r.sent).toBeLessThanOrEqual(600);
    const sentAt = S.calls.filter((c) => c.path === '/api/cdp/event').map((c) => c.body.occurred_at);
    for (let k = 1; k < sentAt.length; k++) expect(sentAt[k] >= sentAt[k - 1]).toBe(true);
  });

  it('고객 행이 아직 없는 회원 = 보내지 않고 미룸', async () => {
    S.cdpKeyOwner.set('hjl_test', S.TEST);
    const r = await pushRealismOnline(key, now, 0);
    expect(r.sent).toBe(0);
    expect(r.deferred).toBeGreaterThan(0);
    expect(S.calls.length).toBe(0);
  });
});

describe('⑦ 허용 판정', () => {
  it('v3 = 허용 목록 ∧ 시연 아님', async () => {
    expect(await isRealismCompany(S.TEST)).toBe(true);
    expect(await isRealismCompany(S.REAL)).toBe(false);
    process.env.SYNTHETIC_DATA_COMPANY_IDS = `${S.TEST},${S.DEMO}`;
    expect(await isRealismCompany(S.DEMO)).toBe(false);
  });

  it('자사몰 키가 허용 밖 회사 · 시연 회사 것이면 0건', async () => {
    S.cdpKeyOwner.set('hjl_real', S.REAL);
    S.cdpKeyOwner.set('hjl_demo', S.DEMO);
    const now = new Date('2026-11-16T03:00:00Z');
    for (const s of dueOnlineSends(now)) S.customers.set(demoPhone(s.index), {});
    expect((await pushRealismOnline({ apiKey: 'hjl_real', apiSecret: 'x' }, now, 0)).sent).toBe(0);
    expect((await pushRealismOnline({ apiKey: 'hjl_demo', apiSecret: 'x' }, now, 0)).sent).toBe(0);
    expect((await pushRealismOnline({ apiKey: 'hjl_none', apiSecret: 'x' }, now, 0)).sent).toBe(0);
    expect(S.calls.length).toBe(0);
  });

  it('SYNTHETIC_CDP_KEYS = 「hjl_키:sk_비밀」 쉼표 · 같은 키는 처음 것 · 모양이 틀린 것은 버린다', () => {
    expect(parseSyntheticCdpKeys({ SYNTHETIC_CDP_KEYS: 'hjl_a:sk_1, hjl_b:sk_2 ,broken,:x,y:,hjl_a:sk_dup' }))
      .toEqual([{ apiKey: 'hjl_a', apiSecret: 'sk_1' }, { apiKey: 'hjl_b', apiSecret: 'sk_2' }]);
    expect(parseSyntheticCdpKeys({})).toEqual([]);
  });
});
