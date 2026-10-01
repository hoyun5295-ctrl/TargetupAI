/**
 * ★ 2026-10-01 우커머스 주기 워커 한 회차의 실제 실행 계약(소스 글자 대조가 아니라 runWooSyncPass 를 돌린다)
 *   - 한 회차 상한에 닿았는데 주문 다시 읽기로 못 넘기면 커서(last_synced_at)를 전진시키지 않고 사유를 남긴다(Codex 1001 R1)
 *   - 넘겼으면 전진 · 안 닿았으면 종전 그대로 · 규칙 판이 낮은 몰은 그 회차 주기 수집을 건너뛴다
 *   - 웹훅 점검은 수집이 성공으로 끝난 쓰기 권한 키 몰에만
 * 경위 = status/BUGS.md B-1001-9 · 설계서 docs/2026-09-14-woocommerce-integration-design.md §8 불변 16·18
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock('../cdp-auth', () => ({ isCdpEnabledForPlan: vi.fn(async () => true) }));
vi.mock('../woocommerce-client', async (orig) => ({
  ...(await orig<any>()),
  syncWooOrdersSince: vi.fn(),
  startWooOrderReread: vi.fn(),
  ensureWooWebhooks: vi.fn(),
  enqueueWooBackfill: vi.fn(() => true),
}));

import { query } from '../../config/database';
import { syncWooOrdersSince, startWooOrderReread, ensureWooWebhooks, enqueueWooBackfill } from '../woocommerce-client';
import { runWooSyncPass } from '../woocommerce-sync-worker';

const q = query as unknown as ReturnType<typeof vi.fn>;
const sync = syncWooOrdersSince as unknown as ReturnType<typeof vi.fn>;
const reread = startWooOrderReread as unknown as ReturnType<typeof vi.fn>;
const ensure = ensureWooWebhooks as unknown as ReturnType<typeof vi.fn>;
const enqueue = enqueueWooBackfill as unknown as ReturnType<typeof vi.fn>;

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MALL = 'iroirotokyo.net';
const target = (meta: Record<string, any> = {}) => ({
  company_id: COMPANY, mall_id: MALL, last_synced_at: new Date('2026-10-01T00:00:00Z'), connected_at: new Date('2026-09-21T00:00:00Z'),
  meta: { woo_consumer_key: 'ck_x', woo_consumer_secret: 'cs_y', woo_key_permissions: 'read_write', woo_backfill: { stage: 'done', requested: true, order_rule: 2 }, ...meta },
});
const withTarget = (meta?: Record<string, any>) =>
  q.mockImplementation(async (sql: string) => (String(sql).includes('FROM company_integrations') && String(sql).includes('ORDER BY COALESCE(last_synced_at, connected_at)') ? { rows: [target(meta)] } : { rows: [] }));
const cursorMoved = () => q.mock.calls.some((c: any[]) => String(c[0]).includes('SET last_synced_at = NOW()'));
const failureCode = () => q.mock.calls.find((c: any[]) => String(c[0]).includes("'woo_sync_error_code', $4::text"))?.[1]?.[3];

beforeEach(() => {
  q.mockReset(); sync.mockReset(); reread.mockReset(); ensure.mockReset(); enqueue.mockClear();
  ensure.mockResolvedValue({ created: 0, existing: 4, reactivated: 0, ids: [1, 2, 3, 4] });
});

describe('주기 워커 한 회차 — 상한 닿음과 커서', () => {
  it('상한에 닿았는데 주문 다시 읽기로 못 넘기면: 커서 유지 · 사유 truncated · 실패로 셈 · 웹훅 점검 안 함', async () => {
    withTarget();
    reread.mockResolvedValue(false);
    sync.mockResolvedValue({ imported: 5000, pages: 250, truncated: true });
    const r = await runWooSyncPass();
    expect(r).toMatchObject({ malls: 1, synced: 0, failed: 1, imported: 5000 });
    expect(cursorMoved()).toBe(false);
    expect(failureCode()).toBe('truncated');
    expect(reread.mock.calls.map((c: any[]) => c[2])).toEqual(['rule', 'truncated']);
    expect(ensure).not.toHaveBeenCalled();
  });
  it('상한에 닿았고 주문 다시 읽기로 넘겼으면: 커서 전진 · 성공으로 셈', async () => {
    withTarget();
    reread.mockImplementation(async (_c: string, _m: string, reason: string) => reason === 'truncated');
    sync.mockResolvedValue({ imported: 5000, pages: 250, truncated: true });
    const r = await runWooSyncPass();
    expect(r).toMatchObject({ malls: 1, synced: 1, failed: 0, imported: 5000 });
    expect(cursorMoved()).toBe(true);
    expect(failureCode()).toBeUndefined();
  });
  it('안 닿았으면 종전 그대로: 커서 전진 · 상한 사유로 다시 읽기를 부르지 않는다 · 쓰기 권한 키 몰은 웹훅 점검', async () => {
    withTarget();
    reread.mockResolvedValue(false);
    sync.mockResolvedValue({ imported: 12, pages: 1, truncated: false });
    const r = await runWooSyncPass();
    expect(r).toMatchObject({ malls: 1, synced: 1, failed: 0, imported: 12 });
    expect(cursorMoved()).toBe(true);
    expect(reread.mock.calls.map((c: any[]) => c[2])).toEqual(['rule']);
    expect(ensure).toHaveBeenCalledWith(COMPANY, MALL);
  });
  it('읽기 전용 키 몰은 웹훅 점검을 하지 않는다 · 웹훅 점검이 실패해도 수집 성공은 그대로', async () => {
    withTarget({ woo_key_permissions: 'read' });
    reread.mockResolvedValue(false);
    sync.mockResolvedValue({ imported: 1, pages: 1, truncated: false });
    expect(await runWooSyncPass()).toMatchObject({ synced: 1, failed: 0 });
    expect(ensure).not.toHaveBeenCalled();

    q.mockClear(); withTarget();
    ensure.mockRejectedValue(new Error('목록 응답 이상'));
    expect(await runWooSyncPass()).toMatchObject({ synced: 1, failed: 0 });
    expect(cursorMoved()).toBe(true);
    expect(failureCode()).toBeUndefined();
  });
  it('주문 상태 규칙 판이 낮은 몰(주문 다시 읽기를 줄 세운 회차): 주기 수집을 돌리지 않는다 · 커서 그대로', async () => {
    withTarget();
    reread.mockImplementation(async (_c: string, _m: string, reason: string) => reason === 'rule');
    const r = await runWooSyncPass();
    expect(r).toMatchObject({ malls: 1, synced: 0, failed: 0, skipped: 1 });
    expect(sync).not.toHaveBeenCalled();
    expect(cursorMoved()).toBe(false);
  });
  it('안 끝난 요청 가져오기가 있는 몰: 이어 가기만 줄 세우고 다시 읽기 판정·주기 수집을 하지 않는다(종전)', async () => {
    withTarget({ woo_backfill: { stage: 'orders', requested: true } });
    const r = await runWooSyncPass();
    expect(r).toMatchObject({ skipped: 1, synced: 0 });
    expect(enqueue).toHaveBeenCalledWith(COMPANY, MALL);
    expect(reread).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });
});
