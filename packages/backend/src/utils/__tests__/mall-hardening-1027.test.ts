/**
 * 자사몰 대비 묶음 A — 판정 함수 · 쓰기 문장 짝 시험(★ 2026-10-27 · 설계서 docs/2026-10-27-mall-integration-hardening-design.md §6)
 *
 * K1 구매 사건(결제 전 = order_placed · 결제 순간 승격 · 옛 스냅숏 · 종결 규칙 · 결제 시각 하나) · K1-2 여정 중복 진입 두 겹 ·
 * K9 분류코드 모드 · ENV-3 · K3 회원 재대조 창 · K7 문제 분류 · K10 감시 표 순서.
 * SQL 실행 판정은 pg-mem 이 jsonb 연산 · '-infinity' 를 못 읽어 문장 · 인자 단정으로 본다(웹훅 선점은 cdp-webhook-claim-1027 이 pg-mem 실행).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
let rolledBack = false;
vi.mock('../../config/database', () => ({
  query: (...a: any[]) => queryMock(...a),
  withTransaction: async (work: any) => {
    try { return await work((q: string, p: any[]) => queryMock(q, p)); } catch (e) { rolledBack = true; throw e; }
  },
}));
vi.mock('../cdp-identity', () => ({ identifyCustomer: vi.fn(async () => ({ customerId: 'c1', linkId: 'l1', wasCreated: false, wasMerged: false })) }));
const trackOrder = vi.fn(async (..._a: any[]) => ({ eventId: 'e-new' }));
vi.mock('../cdp-events', async (orig) => ({ ...(await orig<any>()), trackOrderEvent: (...a: any[]) => (trackOrder as any)(...a) }));

import { syncOrder, orderSnapshotVerdict, orderPaidAt, orderSrcKind } from '../cdp-orders';
import { identifyCustomer } from '../cdp-identity';
import { assertStoreCodeMode, guardIntegrationMode, lockCompanyIntegrationMode, STORE_CODE_MODE_SENTENCE } from '../integration-scope';
import { isMallConsentEnforced } from '../mall-consent';
import { wooMemberRereadWindowOpen, wooMemberRereadWindowEnd, wooMemberRereadDue } from '../woocommerce-client';
import { integrationProblemOf, INTEGRATION_CAUSES } from '../integration-problem';
import { monitorRank } from '../mall-integration-monitor';
import { cafe24OrderStatusOf } from '../cafe24-client';
import { godoOrderStatusOf } from '../godo-parse';
import { isKnownOrderStatus } from '../cdp-order-revenue';

const CO = '11111111-1111-4111-8111-111111111111';
const T0 = '2026-10-27T01:00:00.000Z';
const T1 = '2026-10-27T02:00:00.000Z';
const T2 = '2026-10-27T03:00:00.000Z';
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

beforeEach(() => { queryMock.mockReset(); trackOrder.mockClear(); rolledBack = false; vi.mocked(identifyCustomer).mockClear(); });

describe('K1-6 orderSnapshotVerdict — 옛 스냅숏 · 같은 시각 · 종결 규칙', () => {
  const rec = (status: string, kind: 'source' | 'received' = 'received', srcAt = T1) => ({ srcAt, status, kind });
  it('처음 본 주문 = 쓴다', () => { expect(orderSnapshotVerdict(null, rec('pending'))).toBe('apply'); });
  it('늦게 온 옛 스냅숏 = 쓰지 않음(상태 갱신 · 승격 · 매출 0)', () => {
    expect(orderSnapshotVerdict({ srcAt: T2, cancelSeenAt: null }, rec('paid', 'received', T1))).toBe('stale');
  });
  it('같은 시각 = 취소 · 환불만 쓴다(동률에서 취소가 이김)', () => {
    expect(orderSnapshotVerdict({ srcAt: T1, cancelSeenAt: null }, rec('cancelled', 'source', T1))).toBe('apply');
    expect(orderSnapshotVerdict({ srcAt: T1, cancelSeenAt: null }, rec('paid', 'source', T1))).toBe('stale');
  });
  it('src_at 없는 옛 행 = 무엇이든 그 뒤', () => {
    expect(orderSnapshotVerdict({ srcAt: null, cancelSeenAt: null }, rec('paid'))).toBe('apply');
  });
  it('종결 규칙 — 취소를 본 주문의 결제 본문: received 종류 = 0 · source 종류 = 취소보다 늦을 때만', () => {
    expect(orderSnapshotVerdict({ srcAt: T0, cancelSeenAt: T0 }, rec('paid', 'received', T2))).toBe('stale');
    expect(orderSnapshotVerdict({ srcAt: T0, cancelSeenAt: T1 }, rec('paid', 'source', T1))).toBe('stale');
    expect(orderSnapshotVerdict({ srcAt: T0, cancelSeenAt: T0 }, rec('paid', 'source', T2))).toBe('apply');
    // 결제가 아닌 본문(배송 등)은 종결 규칙 대상 아님
    expect(orderSnapshotVerdict({ srcAt: T0, cancelSeenAt: T0 }, rec('shipping', 'received', T2))).toBe('apply');
  });
  it('원천 시각 종류 = 우커머스만 source', () => {
    expect(orderSrcKind('woocommerce')).toBe('source');
    for (const s of ['cafe24', 'imweb', 'godo', 'custom', 'naver_smart_store']) expect(orderSrcKind(s)).toBe('received');
  });
  it('결제 시각 = paidAt ?? orderedAt(두 유입 순서의 occurred_at 이 같다)', () => {
    expect(orderPaidAt({ paidAt: T2, orderedAt: T0 })).toBe(T2);
    expect(orderPaidAt({ orderedAt: T0 })).toBe(T0);
  });
});

describe('K1-1 · K1-2 syncOrder — 결제 전 = order_placed · 결제 순간 승격(한 문장) · 옛 스냅숏 = stale', () => {
  const base = { source: 'cafe24', orderId: 'O1', externalId: 'm1', phone: '01000000000', totalAmount: 1000, orderedAt: T0 };
  const SELECT = (sql: string) => sql.startsWith('SELECT') && sql.includes("event_name IN ('purchase', 'order_placed')");

  it('처음 본 결제 전 주문 = order_placed · src_at · 매출 0', async () => {
    queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const r = await syncOrder(CO, { ...base, status: 'pending', srcAt: T1 } as any);
    expect(trackOrder.mock.calls[0][2]).toMatchObject({ name: 'order_placed', occurredAt: T0 });
    expect(trackOrder.mock.calls[0][2].properties).toMatchObject({ src_at: T1 });
    expect(r).toMatchObject({ rfmUpdated: false, stale: false });
  });
  it('처음 본 취소 먼저 = order_placed + cancel_seen_at', async () => {
    queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    await syncOrder(CO, { ...base, status: 'cancelled', srcAt: T1 } as any);
    expect(trackOrder.mock.calls[0][2]).toMatchObject({ name: 'order_placed', properties: expect.objectContaining({ cancel_seen_at: T1 }) });
  });
  it('처음 본 결제 = purchase · occurred_at = 결제 시각 · RFM 날짜 = 결제 시각 KST 날짜(글자)', async () => {
    queryMock.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
    await syncOrder(CO, { ...base, status: 'paid', paidAt: '2026-10-26T16:30:00.000Z', srcAt: T1 } as any);
    expect(trackOrder.mock.calls[0][2]).toMatchObject({ name: 'purchase', occurredAt: '2026-10-26T16:30:00.000Z' });
    const rfm = queryMock.mock.calls.find((c) => /UPDATE customers SET\s+total_purchase_amount = COALESCE/.test(String(c[0])))!;
    expect(rfm[1][2]).toBe('2026-10-27');   // KST 01:30 = 10-27
  });
  it('결제 전 행이 결제되면 같은 행을 승격(이름 · 결제 시각 · 도착 시각 · 처음 도착 기록) · 판정 때 값이 그대로일 때만(CAS)', async () => {
    const placed = { id: 'e1', event_name: 'order_placed', properties: { order_id: 'O1', status: 'pending', src_at: T0 } };
    queryMock.mockImplementation(async (sql: string) => {
      if (SELECT(sql)) return { rows: [placed] };
      if (sql.includes("jsonb_build_object('revenue_applied', true")) return { rows: [{ id: 'e1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await syncOrder(CO, { ...base, status: 'paid', paidAt: T1, srcAt: T2 } as any);
    const claim = queryMock.mock.calls.find((c) => String(c[0]).includes("jsonb_build_object('revenue_applied', true"))!;
    const s = String(claim[0]).replace(/\s+/g, ' ');
    expect(s).toContain("event_name = 'purchase'");
    expect(s).toContain("occurred_at = CASE WHEN event_name = 'order_placed' THEN $5::timestamptz ELSE occurred_at END");
    expect(s).toContain("created_at = CASE WHEN event_name = 'order_placed' THEN NOW() ELSE created_at END");
    expect(s).toContain("CASE WHEN event_name = 'order_placed' THEN jsonb_build_object('first_arrived_at', created_at)");
    expect(s).toContain("COALESCE(properties->>'src_at', '') = $6 AND COALESCE(properties->>'cancel_seen_at', '') = $7");
    expect(claim[1].slice(3, 7)).toEqual([T2, T1, T0, '']);
    expect(trackOrder).not.toHaveBeenCalled();
  });
  it('판정 뒤 다른 쪽이 src_at 을 바꿨으면(UPDATE 0행) = stale · 매출 0', async () => {
    const placed = { id: 'e1', event_name: 'order_placed', properties: { order_id: 'O1', status: 'pending', src_at: T0 } };
    queryMock.mockImplementation(async (sql: string) => {
      if (SELECT(sql)) return { rows: [placed] };
      return { rows: [], rowCount: 0 };
    });
    const r = await syncOrder(CO, { ...base, status: 'paid', srcAt: T2 } as any);
    expect(r.stale).toBe(true);
    expect(queryMock.mock.calls.some((c) => /UPDATE customers SET\s+total_purchase_amount = COALESCE/.test(String(c[0])))).toBe(false);
  });
  it('옛 스냅숏 = 아무 문장도 쓰지 않는다(stale)', async () => {
    const paid = { id: 'e1', event_name: 'purchase', properties: { order_id: 'O1', status: 'paid', revenue_applied: true, src_at: T2 } };
    queryMock.mockImplementation(async (sql: string) => (SELECT(sql) ? { rows: [paid] } : { rows: [], rowCount: 1 }));
    const r = await syncOrder(CO, { ...base, status: 'pending', srcAt: T1 } as any);
    expect(r.stale).toBe(true);
    expect(queryMock.mock.calls.filter((c) => /^\s*UPDATE/.test(String(c[0])))).toEqual([]);
  });
  it('중간 종료(표식 선점 뒤 고객 요약에서 던짐) = 롤백 · 오류를 올린다(재처리가 한 번 더함)', async () => {
    const placed = { id: 'e1', event_name: 'order_placed', properties: { order_id: 'O1', status: 'pending', src_at: T0 } };
    queryMock.mockImplementation(async (sql: string) => {
      if (SELECT(sql)) return { rows: [placed] };
      if (sql.includes("jsonb_build_object('revenue_applied', true")) return { rows: [{ id: 'e1' }], rowCount: 1 };
      if (/UPDATE customers SET/.test(sql)) throw new Error('process died');
      return { rows: [], rowCount: 1 };
    });
    await expect(syncOrder(CO, { ...base, status: 'paid', srcAt: T2 } as any)).rejects.toThrow('process died');
    expect(rolledBack).toBe(true);
  });
  it('모르는 상태 글자 = status_known false · 원문 글자 · 본 시각을 남긴다(판정 불변 · 결제 아님)', async () => {
    queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    await syncOrder(CO, { ...base, status: 'pending', statusKnown: false, statusRaw: 'zz', srcAt: T1 } as any);
    expect(trackOrder.mock.calls[0][2]).toMatchObject({ name: 'order_placed', properties: expect.objectContaining({ status_known: false, status_raw: 'zz', status_unknown_at: T1 }) });
  });
  it('★Codex 1R — 모르는 상태로 적재된 주문이 알려진 상태로 바뀌면 표식을 지운다(받아들인 쓰기마다 다시 씀)', async () => {
    const odd = { id: 'e1', event_name: 'order_placed', properties: { order_id: 'O1', status: 'z99', status_known: false, status_raw: 'z99', src_at: T0 } };
    queryMock.mockImplementation(async (sql: string) => {
      if (SELECT(sql)) return { rows: [odd] };
      return { rows: [{ id: 'e1' }], rowCount: 1 };
    });
    await syncOrder(CO, { ...base, status: 'shipping', statusKnown: true, srcAt: T2 } as any);
    const upd = queryMock.mock.calls.find((c) => /^\s*UPDATE cdp_events/.test(String(c[0])))!;
    expect(String(upd[0])).toContain("- 'status_known' - 'status_raw' - 'status_unknown_at'");
    expect(JSON.parse(upd[1][upd[1].length - 1])).toEqual({});
  });
  it('★K2-1 주문 본문의 동의 = 식별 한 호출에 실린다(주문 표시 · 원천 시각 = min(주문 시각, 받은 시각))', async () => {
    queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    await syncOrder(CO, { ...base, status: 'pending', srcAt: T2, smsOptIn: true } as any);
    expect(vi.mocked(identifyCustomer).mock.calls[0][1]).toMatchObject({ smsOptIn: true, consentFromOrder: true, consentAt: T0 });
  });
});

describe('★Codex 1R — 가져오기 · 주기 수집 · 재대조의 동의 시각 = 그 쪽을 요청한 시각(처리 시각 아님)', () => {
  it('쪽 읽기가 요청 전에 시각을 찍고 · 쪽을 처리하는 부르기마다 그 시각을 넘긴다', () => {
    const w = src('woocommerce-client.ts');
    const retry = w.slice(w.indexOf('async function fetchWooPageWithRetry('), w.indexOf('\n}\n', w.indexOf('async function fetchWooPageWithRetry(')));
    expect(retry.indexOf('const readAt = new Date().toISOString();')).toBeGreaterThan(-1);
    expect(retry.indexOf('const readAt = new Date().toISOString();')).toBeLessThan(retry.indexOf('await fetchWooPage('));
    const calls = Array.from(w.matchAll(/await processWooItems\(([^;]*?)\)/g)).map((m) => m[1]);
    expect(calls.length).toBe(3);
    for (const c of calls) expect(c, c).toMatch(/res\.readAt$/);
    expect(w).toContain('processWooResource(integ.companyId, integ.mallId, kind, raw, integ.consentMetaKey, integ.storeCode, readAt)');
  });
});

describe('K10 SC2 상태 변환 = { 상태, 아는 글자인가 }', () => {
  it('카페24 코드표 · 고도몰 표 · CT 어휘', () => {
    expect(cafe24OrderStatusOf('N10')).toEqual({ status: 'paid', known: true });
    expect(cafe24OrderStatusOf('N00')).toEqual({ status: 'N00', known: true });
    expect(cafe24OrderStatusOf('Z99')).toEqual({ status: 'Z99', known: false });
    expect(godoOrderStatusOf('p1')).toEqual({ status: 'paid', known: true });
    expect(godoOrderStatusOf('zz')).toEqual({ status: 'pending', known: false });
    expect(isKnownOrderStatus('PAID')).toBe(true);
    expect(isKnownOrderStatus('PAY_WAIT')).toBe(false);
  });
});

describe('K1-2 여정 중복 진입 두 겹(실제 진입 기록 = __entry.src trigger · key)', () => {
  it('① 사건 행 단계 — 커서가 읽는 사건 행에서 이 계보에 이미 진입에 쓰인 사건을 뺀다', () => {
    const ex = src('journey-target-extractor.ts');
    expect(ex).toMatch(/usedClause = `AND NOT \$\{triggerEntryUsedSql\(`\$\$\{params\.length\}`, 'e\.customer_id', 'e\.id::text'\)\}`/);
    expect(ex).toContain("tu.entry_event_properties->'__entry'->>'src' = 'trigger'");
    expect(src('journey-trigger-watcher.ts')).toContain('j.lineageIds || [j.id],   // ★ 1027 K1-2 ①');
  });
  it('② 잠금 안 — 교체 닫기 · 쿨다운보다 먼저 같은 조각으로 건너뛴다', () => {
    const w = src('journey-trigger-watcher.ts');
    const loop = w.slice(w.indexOf('for (const customerId of ids) {'), w.indexOf('await client.query(INSERT_EXECUTION_SQL'));
    const iUsed = loop.indexOf('triggerEntryUsedSql(');
    expect(iUsed).toBeGreaterThan(-1);
    expect(iUsed).toBeLessThan(loop.indexOf('CLOSE_ACTIVE_FOR_REPLACEMENT_SQL'));
    expect(iUsed).toBeLessThan(loop.indexOf('checkCooldown('));
  });
});

describe('K9 SC1 분류코드 모드 — 한 회사 몰은 모두 분류코드 · 또는 모두 없음(만드는 순간 · 해제 행 포함)', () => {
  const runWith = (coded: number, plain: number, status?: string | null) => vi.fn(async (sql: string) => {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.startsWith('SELECT status FROM company_integrations')) return { rows: status === undefined ? [] : [{ status }] };
    return { rows: [{ coded, plain }] };
  });
  it('분류코드 몰이 있는 회사에 분류코드 없는 새 몰 = 거절(관리자도) · 반대도 거절 · 같은 모드 = 통과', async () => {
    await expect(assertStoreCodeMode(runWith(1, 0) as any, CO, 'cafe24', 'mall', null)).rejects.toMatchObject({ status: 409, code: 'STORE_CODE_REQUIRED', message: STORE_CODE_MODE_SENTENCE });
    await expect(assertStoreCodeMode(runWith(0, 1) as any, CO, 'woocommerce', 'a.com', 'S1')).rejects.toMatchObject({ status: 409, code: 'STORE_CODE_MODE_MIXED' });
    await expect(assertStoreCodeMode(runWith(2, 0) as any, CO, 'woocommerce', 'a.com', 'S1')).resolves.toBeUndefined();
    await expect(assertStoreCodeMode(runWith(0, 3) as any, CO, 'cafe24', 'mall', null)).resolves.toBeUndefined();
    await expect(assertStoreCodeMode(runWith(0, 0) as any, CO, 'cafe24', 'mall', null)).resolves.toBeUndefined();
  });
  it('세는 대상 = 자기 행을 뺀 회사 전체 행(해제 행 포함 · status 조건 0)', async () => {
    const run = runWith(0, 0);
    await assertStoreCodeMode(run as any, CO, 'cafe24', 'mall', null);
    const sql = String(run.mock.calls[0][0]);
    expect(sql).toContain('NOT (provider = $2 AND mall_id = $3)');
    expect(sql).not.toMatch(/revoked|status/);
  });
  it('모드 문 = 잠금 먼저 · 새 행 · 해제 행만 판정(있는 행 재저장 = 판정 0)', async () => {
    const fresh = runWith(1, 0, undefined);
    await expect(guardIntegrationMode(fresh as any, CO, 'cafe24', 'mall', null)).rejects.toMatchObject({ code: 'STORE_CODE_REQUIRED' });
    expect(String(fresh.mock.calls[0][0])).toContain('pg_advisory_xact_lock');
    const revived = runWith(1, 0, 'revoked');
    await expect(guardIntegrationMode(revived as any, CO, 'cafe24', 'mall', null)).rejects.toMatchObject({ code: 'STORE_CODE_REQUIRED' });
    const existing = runWith(1, 0, 'active');
    await expect(guardIntegrationMode(existing as any, CO, 'cafe24', 'mall', null)).resolves.toBeUndefined();
    expect(existing.mock.calls.length).toBe(2);   // 잠금 + 행 조회 · 판정 문장 0
  });
  it('잠금 키 = uuid 정규화 표기 · 다른 축 이름(정산 잠금과 갈림)', async () => {
    const run = vi.fn(async () => ({ rows: [] }));
    await lockCompanyIntegrationMode(run as any, CO);
    expect((run.mock.calls[0] as any[])[0]).toBe(`SELECT pg_advisory_xact_lock(hashtext($1::uuid::text), hashtext('integration_mode'))`);
  });
});

describe('ENV-3 몰 동의 읽기 — 미설정 = 분류코드 회사 전부 · off = 아무도 아님', () => {
  const ENV = 'MALL_CONSENT_ENFORCE_COMPANY_IDS';
  it('미설정 · 빈 값 = * · off = 꺼짐 · 목록 = 그 회사만', async () => {
    const saved = process.env[ENV];
    queryMock.mockImplementation(async () => ({ rows: [{ store_code: 'S1' }] }));
    try {
      delete process.env[ENV];
      expect(await isMallConsentEnforced(CO)).toBe(true);
      process.env[ENV] = '';
      expect(await isMallConsentEnforced(CO)).toBe(true);
      process.env[ENV] = 'off';
      expect(await isMallConsentEnforced(CO)).toBe(false);
      process.env[ENV] = '22222222-2222-4222-8222-222222222222';
      expect(await isMallConsentEnforced(CO)).toBe(false);
    } finally {
      if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved;
    }
  });
});

describe('K3 회원 재대조 — KST 02~06시 · 7일 한 바퀴 · 못 끝내면 이어 감', () => {
  const kst = (h: number, m = 0) => Date.UTC(2026, 9, 27, h - 9, m);   // 2026-10-27 KST h:m
  it('창 = 02:00 이상 06:00 미만 · 창 끝 = 그날(또는 다음날) 06:00', () => {
    expect(wooMemberRereadWindowOpen(kst(1, 59))).toBe(false);
    expect(wooMemberRereadWindowOpen(kst(2))).toBe(true);
    expect(wooMemberRereadWindowOpen(kst(5, 59))).toBe(true);
    expect(wooMemberRereadWindowOpen(kst(6))).toBe(false);
    expect(wooMemberRereadWindowEnd(kst(3))).toBe(kst(6));
    expect(wooMemberRereadWindowEnd(kst(7))).toBe(kst(6) + 24 * 3600_000);
  });
  it('상태 없음 = 새 바퀴 · 도는 중 = 이어 감 · 끝난 지 7일 = 새 바퀴 · 그 안 = 없음', () => {
    const now = kst(3);
    expect(wooMemberRereadDue(null, now)).toBe('start');
    const st = { page: 4, cycle_started_at: new Date(now - 2 * 24 * 3600_000).toISOString(), updated_at: '', done_at: null, last_done_at: null, customers_read: 0 };
    expect(wooMemberRereadDue(st, now)).toBe('continue');
    expect(wooMemberRereadDue({ ...st, done_at: new Date(now).toISOString() }, now)).toBe('none');
    expect(wooMemberRereadDue({ ...st, done_at: new Date(now).toISOString(), cycle_started_at: new Date(now - 7 * 24 * 3600_000).toISOString() }, now)).toBe('start');
  });
});

describe('K7 문제 분류 · K10 감시 표 순서', () => {
  it('원인은 닫힌 목록 · 토큰 거절 = 상태가 먼저 · 표에 없는 코드 = 분류 안 함(null)', () => {
    expect(integrationProblemOf('woocommerce', 'active', 'unauthorized')).toEqual({ kind: 'action', cause: 'key_rejected' });
    expect(integrationProblemOf('woocommerce', 'active', 'rate_limited')).toEqual({ kind: 'transient', cause: 'rate_limited' });
    expect(integrationProblemOf('godo', 'active', '996')).toEqual({ kind: 'action', cause: 'ip_not_allowed' });
    expect(integrationProblemOf('cafe24', 'token_expired', null)).toEqual({ kind: 'action', cause: 'token_rejected' });
    expect(integrationProblemOf('woocommerce', 'active', 'weird')).toBeNull();
    expect(integrationProblemOf('woocommerce', 'active', null)).toBeNull();
    for (const p of ['woocommerce', 'godo']) {
      for (const code of ['unauthorized', 'no_keys', 'forbidden', 'not_found', 'redirect', 'header_overflow', 'network', 'http', 'truncated', '999', '996', '429']) {
        const r = integrationProblemOf(p, 'active', code);
        if (r) expect(INTEGRATION_CAUSES).toContain(r.cause);
      }
    }
  });
  it('조치 필요 · 분류 못 한 실패 → 기다리면 풀림 → 문제 없음', () => {
    expect(monitorRank({ problem: { kind: 'action', cause: 'key_rejected' }, errorCode: 'unauthorized' })).toBe(0);
    expect(monitorRank({ problem: null, errorCode: 'weird' })).toBe(0);
    expect(monitorRank({ problem: { kind: 'transient', cause: 'network' }, errorCode: 'network' })).toBe(1);
    expect(monitorRank({ problem: null, errorCode: null })).toBe(2);
  });
});
