/**
 * 가져오기 표준 · 적재 오류 판정(★ 2026-10-28 자사몰 대비 K11 · M27) — 행동 시험
 * 넣을 수 없는 건 = 그 건만 건너뜀 · 연속 장애만 멈춤 · 23505 1회 재시도 · 웹훅 = 처리됨 + 사유 · 고도몰 action 원인 = 다시 부르지 않음
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const q = vi.fn(async (..._a: any[]) => ({ rows: [] as any[], rowCount: 0 }));
vi.mock('../../config/database', () => ({ query: (...a: any[]) => (q as any)(...a) }));

import { classifyIngestError, processImportItems, newImportGuard, IMPORT_MAX_CONSECUTIVE_FAILURES } from '../mall-import';
import { CdpPhoneRequiredError, UserFacingError } from '../http-error';

beforeEach(() => { q.mockReset(); q.mockImplementation(async () => ({ rows: [], rowCount: 0 })); });

describe('classifyIngestError', () => {
  it('휴대폰 없음 · 입력 오류(CDP_INPUT) = skip · 그 밖 = retry', () => {
    expect(classifyIngestError(new CdpPhoneRequiredError())).toBe('skip');
    expect(classifyIngestError(new UserFacingError(400, 'CDP_INPUT', 'orderedAt 형식'))).toBe('skip');
    expect(classifyIngestError(new UserFacingError(400, 'OTHER', 'x'))).toBe('retry');
    expect(classifyIngestError(Object.assign(new Error('db'), { code: '57P01' }))).toBe('retry');
    // ★ Codex R2 #3 — PostgreSQL 데이터 오류(22 · 23 계열) = 다시 해도 같은 건
    expect(classifyIngestError(Object.assign(new Error('too long'), { code: '22001' }))).toBe('skip');
    expect(classifyIngestError(Object.assign(new Error('not null'), { code: '23502' }))).toBe('skip');
    expect(classifyIngestError(Object.assign(new Error('conn'), { code: '08006' }))).toBe('retry');
  });
});

describe('processImportItems', () => {
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);
  it('넣을 수 없는 건은 그 건만 건너뛰고 연속 실패로 세지 않는다 · 나머지는 적재', async () => {
    quiet();
    const g = newImportGuard();
    const items = Array.from({ length: IMPORT_MAX_CONSECUTIVE_FAILURES + 5 }, (_, i) => i);
    const t = await processImportItems(items, async (i) => { if (i < IMPORT_MAX_CONSECUTIVE_FAILURES + 2) throw new CdpPhoneRequiredError(); return i; }, g, (i) => `#${i}`);
    expect(t).toEqual({ results: [12, 13, 14], skipped: 12, failed: 0 });
  });
  it('장애(retry 부류)가 연속 상한이면 던진다 · 사이에 성공이 끼면 다시 센다', async () => {
    quiet();
    const g = newImportGuard();
    const boom = new Error('db down');
    await expect(processImportItems(Array.from({ length: 20 }, (_, i) => i), async () => { throw boom; }, g, String)).rejects.toBe(boom);
    expect(g.streak).toBe(IMPORT_MAX_CONSECUTIVE_FAILURES);
    const g2 = newImportGuard();
    const t = await processImportItems([1, 2, 3], async (i) => { if (i === 2) throw boom; return i; }, g2, String);
    expect(t).toEqual({ results: [1, 3], skipped: 0, failed: 1 });
    expect(g2.streak).toBe(0);
  });
  it('23505(동시에 같은 고객을 만든 다른 건) = 한 번 더 넣는다', async () => {
    let n = 0;
    const t = await processImportItems(['a'], async () => { if (n++ === 0) throw Object.assign(new Error('dup'), { code: '23505' }); return 'ok'; }, newImportGuard(), String);
    expect(t.results).toEqual(['ok']);
    expect(n).toBe(2);
  });
});

describe('웹훅 수신 · 재처리 = 넣을 수 없는 건은 처리됨 + 사유(소진 경보로 가지 않음)', () => {
  it('processClaimedDelivery: 어댑터가 휴대폰 없음을 던지면 processed · error_message 「건너뜀: …」 · retry_count 그대로', async () => {
    vi.resetModules();
    const fresh = await import('../http-error');   // 다시 읽은 모듈의 오류 종류(instanceof 는 같은 모듈 판끼리)
    vi.doMock('../provider-registry', () => ({ getProvider: () => ({ processWebhookEvent: async () => { throw new fresh.CdpPhoneRequiredError(); } }) }));
    const { processClaimedDelivery } = await import('../cdp-webhook-delivery');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await processClaimedDelivery({ id: 'd1', company_id: 'c1', source: 'custom', webhook_event: 'customer.created', payload: {}, created_at: new Date().toISOString() } as any, true);
    expect(r).toBe('processed');
    const upd = q.mock.calls.find((c: any[]) => String(c[0]).includes('UPDATE cdp_webhook_deliveries'))!;
    expect(String(upd[0])).not.toContain('retry_count');
    expect(upd[1]).toEqual(['d1', 'processed', expect.stringMatching(/^건너뜀: 신규 회원 생성 시 phone/)]);
    vi.doUnmock('../provider-registry');
  });
});

describe('고도몰 주기 수집 = 마지막 원인이 사람 조치면 다시 부르지 않는다(K11 SC8)', () => {
  it('996(IP 미등록) · 999(키 거절) 회사는 건너뛰고 429 · 모르는 코드 · 없음은 부른다', async () => {
    vi.resetModules();
    const backfill = vi.fn(async (..._a: any[]) => ({ imported: 0, windows: 1, pages: 1, skipped: 0, failed: 0 }));
    vi.doMock('../godo-client', () => ({ backfillGodoOrders: backfill, GodoApiError: class extends Error {} }));
    vi.doMock('../cdp-auth', () => ({ cdpFactCollectGate: async () => ({ allowed: true, collectUntil: null, inactiveSinceUnknown: false }) }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ids = ['c-996', 'c-999', 'c-429', 'c-x', 'c-none'];
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT company_id')
      ? { rows: ids.map((id) => ({ company_id: id, last_synced_at: null, connected_at: new Date(), error_code: id === 'c-none' ? null : id.slice(2) })), rowCount: 5 }
      : { rows: [], rowCount: 1 }) as any);
    const { runGodoSyncPass } = await import('../godo-sync-worker');
    const p = runGodoSyncPass();
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1500);
    await p;
    vi.useRealTimers();
    expect(backfill.mock.calls.map((c: any[]) => c[0])).toEqual(['c-429', 'c-x', 'c-none']);
    vi.doUnmock('../godo-client'); vi.doUnmock('../cdp-auth');
  });
  it('다시 해야 할 실패가 남으면 성공 시각을 올리지 않고 같은 창을 다시 본다 · 첫 가져오기가 안 끝났으면 90일 + first(Codex R1 #3 · R2 #3)', async () => {
    vi.resetModules();
    const backfill = vi.fn(async (..._a: any[]) => ({ imported: 3, windows: 1, pages: 1, skipped: 0, failed: 1 }));
    vi.doMock('../godo-client', () => ({ backfillGodoOrders: backfill, GodoApiError: class extends Error {} }));
    vi.doMock('../cdp-auth', () => ({ cdpFactCollectGate: async () => ({ allowed: true, collectUntil: null, inactiveSinceUnknown: false }) }));
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT company_id')
      ? { rows: [{ company_id: 'c-1', last_synced_at: new Date(), connected_at: new Date(), error_code: null, first_pending: true }], rowCount: 1 }
      : { rows: [], rowCount: 1 }) as any);
    const { runGodoSyncPass } = await import('../godo-sync-worker');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const p = runGodoSyncPass();
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(1500);
    const r = await p;
    vi.useRealTimers();
    expect(backfill.mock.calls[0][1]).toEqual({ days: 90, first: true });
    expect(r).toMatchObject({ synced: 0, failed: 1 });
    const sqls = q.mock.calls.map((c: any[]) => String(c[0]));
    expect(sqls.some((x) => x.includes('last_synced_at = NOW()'))).toBe(false);
    expect(q.mock.calls.some((c: any[]) => String(c[0]).includes('godo_sync_error') && (c[1] || []).includes('partial_failed'))).toBe(true);
    vi.doUnmock('../godo-client'); vi.doUnmock('../cdp-auth');
  });
});
