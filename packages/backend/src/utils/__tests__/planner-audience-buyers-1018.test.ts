/**
 * ★ 2026-10-18 플래너 받는 사람 = 전체 · 상품 구매자(설계서 docs/2026-10-18-planner-v2-design.md §3-6)
 *
 * 고정하는 것
 *   ① 상품 구매자 술어 = 결제된 주문만(자사몰) · 들어오는 곳 하나 · 고른 키 · since(KST 날짜) · 회사 = $1 · c.id
 *   ② 대상은 행사 meta 에서 한 곳이 읽는다(실행 · 승인 · 확인 화면) · 없음 = 전체 · 깨짐 · 행사 없음 · 스위치 밖 · 문 바뀜 = 막음(전체로 넓히지 않는다)
 *   ③ 메일도 같은 범위 · 같은 술어 · 막힘 ≠ 0명
 *   ④ 전체 대상 행사의 행사 지문 = 바이트 그대로(이미 승인한 행사가 배포 순간 멈추지 않는다)
 *   ⑤ 저장 전 재검증 = 스위치 · 지금 문 · 관측 목록 키 · 이름은 서버 목록 이름
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { netPurchaseSql } from '../cdp-order-revenue';

const db = { meta: {} as any, found: true };
vi.mock('../../config/database', () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string) => (/FROM planner_events/.test(sql) ? { rows: db.found ? [{ meta: db.meta }] : [] } : { rows: [] })),
}));
vi.mock('../operator-audience', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    compileOperatorAudience: vi.fn(async () => ({ filterWhere: '', filterParams: [], segmentKey: 'all', basis: 'segment' })),
    resolveOperatorStoreScope: vi.fn(async (_c: string, createdBy: string | null) => (createdBy ? { blocked: false, baseParams: ['co-1'], storeFilter: '' } : { blocked: true, baseParams: ['co-1'], storeFilter: '' })),
    resolveOperatorAudienceGates: vi.fn(async () => ({})),
  };
});
const door = { now: 'mall' as 'mall' | 'ledger' };
vi.mock('../journey-product', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    currentPurchaseDoor: vi.fn(async () => door.now),
    listObservedProducts: vi.fn(async () => ({ products: [{ key: 'P1', name: '수분 크림', buyers: 3, orders: 4, lastAt: null }, { key: 'P2', name: '토너', buyers: 1, orders: 1, lastAt: null }], omittedOrders: 0, truncated: false })),
  };
});
const emailCount = vi.fn(async (_p: any[], _s: string, _w: string) => 7);
vi.mock('../email-channel', async (orig) => {
  const real: any = await orig();
  return { ...real, countCustomerRecipientsWhere: (p: any[], s: string, w: string) => emailCount(p, s, w) };
});

import { buildBuyerPredicate, countPlannerEmailRecipients, resolvePlannerAudience, verifyPlannerAudience } from '../planner-audience';
import { normalizePlannerAudience, plannerAudienceKey, readStoredAudience } from '../planner-event';
import { eventFingerprint } from '../planner-confirm';
import { PLANNER_REASON } from '../planner-reasons';

const BUYERS = { kind: 'product_buyers' as const, door: 'mall' as const, keys: ['P1'], names: ['수분 크림'], since: '2026-07-20' };

beforeEach(() => {
  db.meta = {};
  db.found = true;
  door.now = 'mall';
  emailCount.mockClear();
  process.env.PLANNER_LINE_COMPANY_IDS = 'co-1';
});

describe('① 상품 구매자 술어', () => {
  it('자사몰 = 결제된 주문만 · 키 · since · $1 · c.id', () => {
    const params: any[] = ['co-1'];
    const sql = buildBuyerPredicate(params, BUYERS);
    // ★ 2026-10-27 자사몰 대비 K1-8 — 결제된 구매 = 판정 조각 netPurchaseSql 한 곳(표식 · 차감 · 옛 행 호환 · 상태 글자 자리 0)
    expect(params).toEqual(['co-1', ['P1'], '2026-07-20']);
    expect(sql).toContain(netPurchaseSql('pb'));
    expect(sql).not.toContain("LOWER(TRIM(COALESCE(pb.properties->>'status', '')))");
    expect(sql).toContain("pb.occurred_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Seoul')");
    expect(sql).toContain('= ANY($2::text[])');
    expect(sql).toContain('pb.company_id = $1');
    expect(sql).toContain('pb.customer_id = c.id');
  });
  it('원장 = purchases 키 · 기록 전체면 날짜 조건 없음', () => {
    const params: any[] = ['co-1'];
    const sql = buildBuyerPredicate(params, { ...BUYERS, door: 'ledger', since: null });
    expect(params).toEqual(['co-1', ['P1']]);
    expect(sql).toContain('FROM purchases pb');
    expect(sql).not.toContain('purchase_date >=');
  });
});

describe('② 대상 = 행사 meta 한 곳', () => {
  it('없음 = 전체(술어 없음)', async () => {
    const a = await resolvePlannerAudience({ companyId: 'co-1', createdBy: 'u-1', mode: 'all', plannerEventId: 'ev-1' });
    expect(a.blocked).toBe(false);
    expect(a.filterWhere).not.toContain('EXISTS');
  });
  it('상품 구매자 = 술어가 filterWhere 안에 · 번호 = baseParams + filterParams 다음', async () => {
    db.meta = { audience: BUYERS };
    const a = await resolvePlannerAudience({ companyId: 'co-1', createdBy: 'u-1', mode: 'all', plannerEventId: 'ev-1' });
    expect(a.blocked).toBe(false);
    expect(a.filterWhere).toContain('FROM cdp_events pb');
    expect([...a.baseParams, ...a.filterParams]).toEqual(['co-1', ['P1'], '2026-07-20']);
  });
  it('깨진 값 · 행사 없음 · 스위치 밖 · 문 바뀜 = 막음', async () => {
    db.meta = { audience: { kind: 'product_buyers', door: 'mall', keys: [] } };
    expect((await resolvePlannerAudience({ companyId: 'co-1', createdBy: 'u-1', mode: 'all', plannerEventId: 'ev-1' })).blockedReason).toBe(PLANNER_REASON.audienceInvalid);
    db.meta = { audience: BUYERS };
    db.found = false;
    expect((await resolvePlannerAudience({ companyId: 'co-1', createdBy: 'u-1', mode: 'all', plannerEventId: 'ev-1' })).blocked).toBe(true);
    db.found = true;
    process.env.PLANNER_LINE_COMPANY_IDS = '';
    expect((await resolvePlannerAudience({ companyId: 'co-1', createdBy: 'u-1', mode: 'all', plannerEventId: 'ev-1' })).blockedReason).toBe(PLANNER_REASON.audienceInvalid);
    process.env.PLANNER_LINE_COMPANY_IDS = 'co-1';
    door.now = 'ledger';
    expect((await resolvePlannerAudience({ companyId: 'co-1', createdBy: 'u-1', mode: 'all', plannerEventId: 'ev-1' })).blockedReason).toBe(PLANNER_REASON.purchaseDoorChanged);
  });
  it('미리보기 값이 저장값보다 앞선다(담기 창)', async () => {
    const a = await resolvePlannerAudience({ companyId: 'co-1', createdBy: 'u-1', mode: 'all', plannerEventId: '', audience: BUYERS });
    expect(a.filterWhere).toContain('EXISTS');
  });
});

describe('③ 메일 = 같은 범위 · 같은 술어', () => {
  it('상품 구매자 술어가 메일 WHERE 에도', async () => {
    db.meta = { audience: BUYERS };
    const r = await countPlannerEmailRecipients({ companyId: 'co-1', createdBy: 'u-1', plannerEventId: 'ev-1' });
    expect(r).toEqual({ state: 'known', count: 7 });
    expect(emailCount.mock.calls[0][2]).toContain('FROM cdp_events pb');
  });
  it('만든 계정이 없으면 막힘(0명이 아니다)', async () => {
    const r = await countPlannerEmailRecipients({ companyId: 'co-1', createdBy: null, plannerEventId: 'ev-1' });
    expect(r.state).toBe('blocked');
    expect(emailCount).not.toHaveBeenCalled();
  });
});

describe('④ 지문 · 정규화', () => {
  const ev = { id: 'ev-1', title: '세일', startsOn: '2026-11-01', endsOn: '2026-11-03', benefitText: '1+1' };
  it('전체 = 받는 사람 칸이 지문에 없다(없음 · {kind:all} 같은 값)', () => {
    const fps = new Map([['t1', 'abc']]);
    const a = eventFingerprint({ ...ev, meta: { revision: 2 } } as any, fps);
    const b = eventFingerprint({ ...ev, meta: { revision: 2, audience: { kind: 'all' } } } as any, fps);
    const c = eventFingerprint({ ...ev, meta: { revision: 2, audience: BUYERS } } as any, fps);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(plannerAudienceKey({ kind: 'all' })).toBeNull();
  });
  it('정규화 = 키 1~30 · 문 · 날짜 형식', () => {
    expect(normalizePlannerAudience(undefined).ok).toBe(false);
    expect(normalizePlannerAudience({ kind: 'all' })).toEqual({ ok: true, value: { kind: 'all' } });
    expect(normalizePlannerAudience({ kind: 'product_buyers', door: 'mall', keys: [] }).ok).toBe(false);
    expect(normalizePlannerAudience({ kind: 'product_buyers', door: 'x', keys: ['P1'] }).ok).toBe(false);
    expect(normalizePlannerAudience({ kind: 'product_buyers', door: 'mall', keys: Array.from({ length: 31 }, (_, i) => `K${i}`) }).ok).toBe(false);
    expect(normalizePlannerAudience({ kind: 'product_buyers', door: 'mall', keys: ['P1'], since: '2026-02-30' }).ok).toBe(false);
    expect(readStoredAudience({})).toEqual({ kind: 'all' });
  });
});

describe('⑤ 저장 전 재검증', () => {
  it('목록 밖 키 = 400 · 이름은 서버 목록 이름', async () => {
    expect(await verifyPlannerAudience('co-1', { ...BUYERS, keys: ['ZZ'], names: ['가짜'] })).toMatchObject({ ok: false, code: 'AUDIENCE_KEYS_INVALID' });
    expect(await verifyPlannerAudience('co-1', { ...BUYERS, names: ['아무 이름'] })).toEqual({ ok: true, value: { ...BUYERS, names: ['수분 크림'] } });
  });
  it('스위치 밖 = 400 · 문 바뀜 = 409', async () => {
    process.env.PLANNER_LINE_COMPANY_IDS = '';
    expect(await verifyPlannerAudience('co-1', BUYERS)).toMatchObject({ ok: false, status: 400, code: 'AUDIENCE_DISABLED' });
    process.env.PLANNER_LINE_COMPANY_IDS = 'co-1';
    door.now = 'ledger';
    expect(await verifyPlannerAudience('co-1', BUYERS)).toMatchObject({ ok: false, status: 409, code: 'PURCHASE_DOOR_CHANGED' });
  });
});
