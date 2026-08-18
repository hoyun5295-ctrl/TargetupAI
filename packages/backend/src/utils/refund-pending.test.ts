/**
 * ★ 2026-08-18 미완 환불 채무 기록 — **쓰는 쪽과 읽는 쪽의 계약 고정.**
 *
 * `direct-send-worker`는 예전부터 보조 슬롯 `refundPending.brand`까지 읽어 두 축을 함께 소진하는데,
 * 쓰는 쪽은 슬롯을 통째로 덮어쓰고 있었다. 그래서 `both`처럼 차감 축이 둘인 발송에서 두 축이 함께
 * 환불 실패하면 **먼저 기록한 채무가 사라졌다**(영구 미환불 = 고객 돈이 그대로 남는다).
 *
 * ⛔ SQL 문자열만 검사하면 이 결함을 못 잡는다(1차 시도의 실패) — `A → B → A` 상태 전이를
 *    실제로 돌려서 보조 축이 살아남는지 본다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 트랜잭션 클라이언트를 흉내 낸다 — campaigns 행 하나의 send_config를 메모리로 들고 있는다.
const state: { sc: any } = { sc: {} };
const clientQuery = vi.fn(async (sql: string, params?: any[]) => {
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
  if (/FOR UPDATE/i.test(sql)) return { rows: [{ sc: state.sc }] };
  if (/UPDATE campaigns/i.test(sql)) {
    state.sc = { ...state.sc, refundPending: JSON.parse(params![1]) };
    return { rows: [] };
  }
  return { rows: [] };
});
const release = vi.fn();

vi.mock('../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  pool: { connect: vi.fn(async () => ({ query: clientQuery, release })) },
}));

import { markRefundPending, markRefundPendingAxes, buildRefundPending } from './refund-pending';

const rp = () => state.sc.refundPending;

describe('markRefundPendingAxes — 축이 둘이어도 채무가 유실되지 않는다', () => {
  beforeEach(() => {
    state.sc = {};
    clientQuery.mockClear();
  });

  it('A → B → A 전이에서 보조 축이 살아남는다 (이 결함으로 BRAND 채무가 증발했다)', async () => {
    await markRefundPending('c1', 10, 'SMS');
    expect(rp()).toMatchObject({ count: 10, messageType: 'SMS' });
    expect(rp().brand).toBeUndefined();

    await markRefundPending('c1', 7, 'BRAND');
    expect(rp().brand).toEqual({ count: 7, messageType: 'BRAND' });

    // 같은 주축을 다시 기록해도 BRAND가 사라지면 안 된다.
    await markRefundPending('c1', 10, 'SMS');
    expect(rp()).toMatchObject({ count: 10, messageType: 'SMS' });
    expect(rp().brand).toEqual({ count: 7, messageType: 'BRAND' });
  });

  it('같은 축 재기록은 건수를 줄이지 않는다 — 채무는 최대치가 진실이다', async () => {
    await markRefundPending('c1', 10, 'SMS');
    await markRefundPending('c1', 3, 'SMS');
    expect(rp().count).toBe(10);
    await markRefundPending('c1', 12, 'SMS');
    expect(rp().count).toBe(12);
  });

  it('두 축을 한 번에 기록한다 — 나눠 쓰면 그 사이에 워커가 첫 축만 보고 슬롯을 지운다', async () => {
    await markRefundPendingAxes('c1', [{ count: 5, messageType: 'LMS' }, { count: 5, messageType: 'BRAND' }]);
    const updates = clientQuery.mock.calls.filter(([sql]) => /UPDATE campaigns/i.test(sql));
    expect(updates).toHaveLength(1);
    expect(rp()).toMatchObject({ count: 5, messageType: 'LMS' });
    expect(rp().brand).toEqual({ count: 5, messageType: 'BRAND' });
  });

  it('행을 잠그고 쓴다 — 두 축 기록 사이에 워커가 끼어들지 못한다', async () => {
    await markRefundPendingAxes('c1', [{ count: 1, messageType: 'SMS' }]);
    const sqls = clientQuery.mock.calls.map(([s]) => String(s));
    expect(sqls.some((s) => /BEGIN/i.test(s))).toBe(true);
    expect(sqls.some((s) => /FOR UPDATE/i.test(s))).toBe(true);
    expect(sqls.some((s) => /COMMIT/i.test(s))).toBe(true);
    expect(release).toHaveBeenCalled();
  });

  it('축이 3개면 넘치는 축을 조용히 버리지 않고 드러낸다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await markRefundPendingAxes('c1', [
      { count: 1, messageType: 'SMS' }, { count: 2, messageType: 'BRAND' }, { count: 3, messageType: 'LMS' },
    ]);
    expect(err.mock.calls.flat().join(' ')).toContain('슬롯초과');
    err.mockRestore();
  });

  it('기록 대상이 아니면 커넥션을 잡지도 않는다', async () => {
    await markRefundPending('', 10, 'BRAND');
    await markRefundPending('c1', 0, 'BRAND');
    await markRefundPending('c1', 10, '');
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('기록 실패가 발송 흐름을 막지 않는다 — throw하지 않는다', async () => {
    clientQuery.mockImplementationOnce(async () => { throw new Error('db down'); });
    await expect(markRefundPending('c1', 5, 'SMS')).resolves.toBeUndefined();
  });

  it('buildRefundPending은 워커가 읽는 키를 그대로 만든다', () => {
    const r = buildRefundPending(3, 'LMS');
    expect(r).toMatchObject({ count: 3, messageType: 'LMS' });
    expect(typeof r.at).toBe('string');
  });
});

// ★ 2026-08-18 원인 키(refundKey) 관통 — 워커가 같은 항아리로 갚아야 채무가 소거되지 않는다.
describe('원인 키가 기록에 남는다', () => {
  beforeEach(() => { state.sc = {}; clientQuery.mockClear(); });

  it('refundKey를 그대로 싣는다 — 없으면 워커가 무조건 NOT_LOADED로 갚는다', async () => {
    await markRefundPending('c1', 4, 'SMS', 'cancel:run-1');
    expect(rp().refundKey).toBe('cancel:run-1');
  });

  it('유형이 같아도 원인이 다르면 별도 채무다 — 서로 덮지 않는다', async () => {
    await markRefundPending('c1', 4, 'SMS', 'notloaded:run-1');
    await markRefundPending('c1', 6, 'SMS', 'cancel:run-1');
    expect(rp()).toMatchObject({ count: 4, messageType: 'SMS', refundKey: 'notloaded:run-1' });
    expect(rp().brand).toEqual({ count: 6, messageType: 'SMS', refundKey: 'cancel:run-1' });
  });

  it('같은 유형·같은 원인이면 하나로 합치고 건수는 최대치를 남긴다', async () => {
    await markRefundPending('c1', 4, 'SMS', 'notloaded:run-1');
    await markRefundPending('c1', 9, 'SMS', 'notloaded:run-1');
    expect(rp().count).toBe(9);
    expect(rp().brand).toBeUndefined();
  });
});
