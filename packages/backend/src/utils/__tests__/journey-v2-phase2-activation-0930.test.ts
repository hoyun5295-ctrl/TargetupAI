/**
 * 여정 V2 2차 — 켜기 게이트 CT(activateJourneyGuarded · activateJourneysInOrder) (2026-09-30 · 설계서 §5 · §13-1)
 *
 * 못 박는 것(돈 경로):
 *   - 단건과 묶음이 같은 게이트를 지난다: 검증 마커 없음 = 거부 · 최초 활성화만 잔액 확인 + 차감(멱등키 journey-activate:${id}) · 재개는 0
 *   - 잔액 부족이면 activateJourney 를 부르지 않는다(켜지고 차감 실패 = 무료 켜짐 금지)
 *   - 묶음은 시작 전에 (초안 수 × 단가)를 확인한다 — 모자라면 하나도 켜지 않는다
 *   - 받는 여정 먼저 켠다 · 켜짐 · 끝남은 NOT_ALLOWED · 회사 밖 id = NOT_FOUND
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../ai-credit', () => {
  class InsufficientCreditError extends Error {}
  return { checkCredit: vi.fn(), deductCreditOutcome: vi.fn(), InsufficientCreditError };
});
vi.mock('../journey-builder', () => ({ activateJourney: vi.fn() }));
vi.mock('../journey-anchor-scheduler', () => ({ dispatchOneShotJourney: vi.fn(), settleAndDispatchOneShot: vi.fn() }));
vi.mock('../journey-target-extractor', () => ({ selectJourneyTargetCustomerIds: vi.fn(), JOURNEY_COUNT_CAP: 100000 }));
vi.mock('../store-scope', () => ({ getJourneyOwnerScopeSql: vi.fn() }));
vi.mock('../callback-filter', () => ({ filterByIndividualCallback: vi.fn() }));
// ★ 2026-10-19 B-1009-5 — 모두 켜기의 겹침 판정 = 지도(buildLifecycleMap) · 이 시험은 겹침 0 으로 둔다(겹침 거절은 아래 한 건)
vi.mock('../journey-lifecycle-map', () => ({ buildLifecycleMap: vi.fn(async () => ({ overlaps: [] })) }));

import { query } from '../../config/database';
import { checkCredit, deductCreditOutcome, InsufficientCreditError } from '../ai-credit';
import { activateJourney } from '../journey-builder';
import { dispatchOneShotJourney, settleAndDispatchOneShot } from '../journey-anchor-scheduler';
import { selectJourneyTargetCustomerIds } from '../journey-target-extractor';
import { filterByIndividualCallback } from '../callback-filter';
import { getCreditCost } from '../ai-credit-calc';
import { activateJourneyGuarded, activateJourneysInOrder, orderReceiversFirst } from '../journey-activation';
import { buildLifecycleMap } from '../journey-lifecycle-map';

const q = query as unknown as ReturnType<typeof vi.fn>;
const credit = checkCredit as unknown as ReturnType<typeof vi.fn>;
const deduct = deductCreditOutcome as unknown as ReturnType<typeof vi.fn>;
const act = activateJourney as unknown as ReturnType<typeof vi.fn>;
const oneShot = dispatchOneShotJourney as unknown as ReturnType<typeof vi.fn>;
const settle = settleAndDispatchOneShot as unknown as ReturnType<typeof vi.fn>;
const ACT = getCreditCost('journey-activate');

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
type Row = { id: string; name?: string; status: string; trigger_event: string; last_pretest_passed_at?: string | null; start_kind?: string; callback_mode?: string };

function mockJourneys(rows: Row[]) {
  q.mockImplementation(async (sql: string, params: any[]) => {
    if (/FROM journeys\s+WHERE company_id = \$1::uuid AND id = ANY/.test(sql)) {
      return { rows: rows.filter((r) => (params[1] as string[]).includes(r.id)).map((r) => ({ ...r, name: r.name || r.id })) };
    }
    if (/SELECT status, last_pretest_passed_at/.test(sql)) {
      const r = rows.find((x) => x.id === params[0]);
      return { rows: r ? [{ status: r.status, last_pretest_passed_at: r.last_pretest_passed_at === undefined ? '2026-09-30' : r.last_pretest_passed_at, start_kind: r.start_kind || 'event', callback_mode: r.callback_mode || 'fixed', trigger_event: r.trigger_event, trigger_filters: {} }] : [] };
    }
    if (/FROM customers/.test(sql)) return { rows: [{ store_phone: '0200000000' }] };
    return { rows: [] };
  });
}

beforeEach(() => {
  q.mockReset(); credit.mockReset(); deduct.mockReset(); act.mockReset(); oneShot.mockReset(); settle.mockReset();
  credit.mockResolvedValue(undefined);
  deduct.mockResolvedValue('deducted');   // ★1020 V.3(Codex 적대 A8) — 차감 결말(실제로 받은 크레딧)
  act.mockResolvedValue({ ok: true });
  oneShot.mockResolvedValue({ enqueued: 0 });
});

describe('단건 켜기 게이트', () => {
  it('검증 마커가 없으면 거부 · 켜지도 차감하지도 않는다', async () => {
    mockJourneys([{ id: ID(1), status: 'draft', trigger_event: 'customer.created', last_pretest_passed_at: null }]);
    const r = await activateJourneyGuarded('c', ID(1), 'u');
    expect(r).toMatchObject({ ok: false, code: 'PRETEST_REQUIRED' });
    expect(act).not.toHaveBeenCalled();
    expect(deduct).not.toHaveBeenCalled();
  });
  it('최초 활성화 = 잔액 확인 → 켜기 → 차감(멱등키 고정) 순서', async () => {
    mockJourneys([{ id: ID(1), status: 'draft', trigger_event: 'customer.created' }]);
    const order: string[] = [];
    credit.mockImplementation(async () => { order.push('check'); });
    act.mockImplementation(async () => { order.push('activate'); return { ok: true }; });
    deduct.mockImplementation(async () => { order.push('deduct'); return 'deducted'; });
    const r = await activateJourneyGuarded('c', ID(1), 'u');
    expect(r).toEqual({ ok: true, firstActivation: true, charged: ACT });
    expect(order).toEqual(['check', 'activate', 'deduct']);
    expect(credit).toHaveBeenCalledWith('c', ACT);
    expect(deduct).toHaveBeenCalledWith(expect.objectContaining({ cost: ACT, source: 'journey-activate', idempotencyKey: `journey-activate:${ID(1)}` }));
  });
  it('잔액 부족이면 activateJourney 를 부르지 않는다', async () => {
    mockJourneys([{ id: ID(1), status: 'draft', trigger_event: 'customer.created' }]);
    credit.mockRejectedValue(new (InsufficientCreditError as any)('부족'));
    const r = await activateJourneyGuarded('c', ID(1), 'u');
    expect(r).toMatchObject({ ok: false, code: 'INSUFFICIENT_CREDIT' });
    expect(act).not.toHaveBeenCalled();
    expect(deduct).not.toHaveBeenCalled();
  });
  it('멈춤 → 켜기(재개)는 잔액 확인 · 차감 0', async () => {
    mockJourneys([{ id: ID(1), status: 'paused', trigger_event: 'customer.created' }]);
    const r = await activateJourneyGuarded('c', ID(1), 'u');
    expect(r).toEqual({ ok: true, firstActivation: false, charged: 0 });
    expect(credit).not.toHaveBeenCalled();
    expect(deduct).not.toHaveBeenCalled();
  });
  it('activateJourney 가 거부하면 차감하지 않는다', async () => {
    mockJourneys([{ id: ID(1), status: 'draft', trigger_event: 'customer.created' }]);
    act.mockResolvedValue({ ok: false, reason: '회신번호가 없습니다' });
    const r = await activateJourneyGuarded('c', ID(1), 'u');
    expect(r).toMatchObject({ ok: false, code: 'ACTIVATE_FAILED', message: '회신번호가 없습니다' });
    expect(deduct).not.toHaveBeenCalled();
  });
  // ★ 2026-11-01 Codex C92 3R — 옛 「최초 활성화 때만 적재」를 뒤집는다: 적재가 잠금 안에서 「이미 넣음」을 보고 0 으로 끝내므로(실 PG 시험
  //   journey-anchor-paging-1101 동시 두 번 = 한 번) 켤 때마다 불러도 두 번 넣지 않는다 · 첫 적재가 실패한 여정은 다시 켜야 넣을 길이 생긴다.
  // ★ 2026-11-02 E1-2 — 이 길은 넣기 칸이 없을 때(DDL 전 · oneShot = untracked)만 남는다.
  it('칸 없음(DDL 전) = 1회 발송 적재 = 켤 때마다 부른다(최초 · 다시 켜기 둘 다 · 다시 켜기는 크레딧 0)', async () => {
    mockJourneys([{ id: ID(1), status: 'draft', trigger_event: 'custom', start_kind: 'one_shot' }, { id: ID(2), status: 'paused', trigger_event: 'custom', start_kind: 'one_shot' }]);
    act.mockResolvedValue({ ok: true, oneShot: 'untracked' });
    await activateJourneyGuarded('c', ID(1), 'u');
    await activateJourneyGuarded('c', ID(2), 'u');
    expect(oneShot.mock.calls).toEqual([['c', ID(1)], ['c', ID(2)]]);
    expect(deduct).toHaveBeenCalledTimes(1);
  });
  it('칸 없음(DDL 전) · 1회 발송 적재가 실패하면 켜기 성공이 아니다 — 이 여정만 멈추고(사유) DISPATCH_FAILED', async () => {
    mockJourneys([{ id: ID(1), status: 'draft', trigger_event: 'custom', start_kind: 'one_shot' }]);
    act.mockResolvedValue({ ok: true, oneShot: 'untracked' });
    oneShot.mockRejectedValue(new Error('canceling statement due to statement timeout'));
    const r = await activateJourneyGuarded('c', ID(1), 'u');
    expect(r).toMatchObject({ ok: false, code: 'DISPATCH_FAILED' });
    const pause = q.mock.calls.find(([sql]) => /UPDATE journeys SET status = 'paused'/.test(sql));
    expect(pause?.[1]).toEqual([ID(1), 'c', expect.stringMatching(/다시 켜 주세요/)]);
    expect(pause?.[0]).toMatch(/WHERE id = \$1::uuid AND company_id = \$2::uuid AND status = 'active'/);
  });
  // ★ 2026-11-02 엔진 재설계 E1-2 — 넣기 대기를 찍은 한 번 보내기 = 정산 · 되돌리기 · 적재를 여정 잠금 안 한 함수(settleAndDispatchOneShot)가 맡는다.
  it('넣기 대기(pending) = 바깥 차감 0 · 토큰 · 첫 켜기 여부를 넘겨 잠금 안에서 정산 · 적재 · 받는 분 넣기 대기를 그대로 돌려준다', async () => {
    mockJourneys([{ id: ID(1), status: 'draft', trigger_event: 'custom', start_kind: 'one_shot' }, { id: ID(2), status: 'paused', trigger_event: 'custom', start_kind: 'one_shot' }]);
    act.mockResolvedValue({ ok: true, oneShot: 'pending', attemptToken: '2026-11-02 01:02:03.456789+00' });
    settle.mockResolvedValueOnce({ ok: true, charged: true, dispatchPending: true }).mockResolvedValueOnce({ ok: true, charged: false, dispatchPending: false });
    expect(await activateJourneyGuarded('c', ID(1), 'u')).toEqual({ ok: true, firstActivation: true, charged: ACT, dispatchPending: true });
    expect(await activateJourneyGuarded('c', ID(2), 'u')).toEqual({ ok: true, firstActivation: false, charged: 0, dispatchPending: false });
    expect(settle.mock.calls).toEqual([
      ['c', ID(1), 'u', { token: '2026-11-02 01:02:03.456789+00', firstActivation: true }],
      ['c', ID(2), 'u', { token: '2026-11-02 01:02:03.456789+00', firstActivation: false }],
    ]);
    expect(deduct).not.toHaveBeenCalled();
    expect(oneShot).not.toHaveBeenCalled();
  });
  it('넣기 대기 · 정산 실패 = 그 결과 코드 그대로(되돌리기는 잠금 안 함수가 이번 시도만)', async () => {
    mockJourneys([{ id: ID(1), status: 'draft', trigger_event: 'custom', start_kind: 'one_shot' }]);
    act.mockResolvedValue({ ok: true, oneShot: 'pending', attemptToken: 't' });
    settle.mockResolvedValue({ ok: false, code: 'INSUFFICIENT_CREDIT', message: '부족' });
    expect(await activateJourneyGuarded('c', ID(1), 'u')).toEqual({ ok: false, code: 'INSUFFICIENT_CREDIT', message: '부족' });
  });
  it('이미 넣은 한 번 보내기(dispatched) = 다시 넣지 않는다 · 잠금 정산 0 · 적재 0', async () => {
    mockJourneys([{ id: ID(1), status: 'paused', trigger_event: 'custom', start_kind: 'one_shot' }]);
    act.mockResolvedValue({ ok: true, oneShot: 'dispatched', attemptToken: 't' });
    expect(await activateJourneyGuarded('c', ID(1), 'u')).toEqual({ ok: true, firstActivation: false, charged: 0 });
    expect(settle).not.toHaveBeenCalled();
    expect(oneShot).not.toHaveBeenCalled();
  });
  it('매장번호 모드 미등록 회신 = 확인 요청(확인 전 켜지 않음) · 확인하면 켠다', async () => {
    mockJourneys([{ id: ID(1), status: 'draft', trigger_event: 'customer.created', callback_mode: 'store' }]);
    (selectJourneyTargetCustomerIds as any).mockResolvedValue(['x']);
    (filterByIndividualCallback as any).mockResolvedValue({ callbackUnregisteredCount: 2, unregisteredDetails: [] });
    const r1 = await activateJourneyGuarded('c', ID(1), 'u');
    expect(r1).toMatchObject({ ok: false, code: 'CALLBACK_CONFIRM_REQUIRED', callbackUnregisteredCount: 2 });
    expect(act).not.toHaveBeenCalled();
    const r2 = await activateJourneyGuarded('c', ID(1), 'u', { confirmCallbackExclusion: true });
    expect(r2.ok).toBe(true);
  });
});

describe('모두 켜기', () => {
  it('받는 여정 먼저(가입 → 첫 구매 → 주문 완료 = 역순으로 켠다)', () => {
    const items = [
      { id: 'a', triggerEvent: 'customer.created' },
      { id: 'b', triggerEvent: 'purchase.first' },
      { id: 'c', triggerEvent: 'cdp.purchase' },
      { id: 'x', triggerEvent: 'customer.birthday_approaching' },
    ];
    const ids = orderReceiversFirst(items).map((i) => i.id);
    expect(ids.indexOf('c')).toBeLessThan(ids.indexOf('b'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('a'));
  });
  it('시작 전 (초안 수 × 단가) 확인 — 모자라면 하나도 켜지 않는다', async () => {
    mockJourneys([
      { id: ID(1), status: 'draft', trigger_event: 'customer.created' },
      { id: ID(2), status: 'draft', trigger_event: 'purchase.first' },
      { id: ID(3), status: 'paused', trigger_event: 'cdp.purchase' },
    ]);
    credit.mockImplementation(async (_c: string, n: number) => { if (n > ACT) throw new (InsufficientCreditError as any)('부족'); });
    const r = await activateJourneysInOrder('c', 'u', [ID(1), ID(2), ID(3)]);
    expect(r).toMatchObject({ ok: false, code: 'INSUFFICIENT_CREDIT', needed: 2 * ACT });
    expect(act).not.toHaveBeenCalled();
  });
  it('여정마다 같은 게이트 · 켜짐은 NOT_ALLOWED · 모르는 id 는 NOT_FOUND · 받는 여정 먼저', async () => {
    mockJourneys([
      { id: ID(1), status: 'draft', trigger_event: 'customer.created' },
      { id: ID(2), status: 'draft', trigger_event: 'purchase.first' },
      { id: ID(3), status: 'active', trigger_event: 'cdp.purchase' },
    ]);
    const r = await activateJourneysInOrder('c', 'u', [ID(1), ID(2), ID(3), ID(9)]);
    if (!r.ok) throw new Error('묶음 실패');
    const by = Object.fromEntries(r.items.map((i) => [i.journeyId, i.result]));
    expect(by[ID(9)]).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(by[ID(3)]).toMatchObject({ ok: false, code: 'NOT_ALLOWED' });
    expect(by[ID(1)]).toEqual({ ok: true, firstActivation: true, charged: ACT });
    expect(act.mock.calls.map((c) => c[1])).toEqual([ID(2), ID(1)]);
    expect(deduct).toHaveBeenCalledTimes(2);
  });
  it('중간 실패는 나머지를 막지 않고 카드별로 알린다', async () => {
    mockJourneys([
      { id: ID(1), status: 'draft', trigger_event: 'customer.created' },
      { id: ID(2), status: 'draft', trigger_event: 'customer.birthday_approaching', last_pretest_passed_at: null },
    ]);
    const r = await activateJourneysInOrder('c', 'u', [ID(1), ID(2)]);
    if (!r.ok) throw new Error('묶음 실패');
    expect(r.items.find((i) => i.journeyId === ID(2))!.result).toMatchObject({ code: 'PRETEST_REQUIRED' });
    expect(r.items.find((i) => i.journeyId === ID(1))!.result.ok).toBe(true);
  });
});

// ★ 2026-10-19 B-1009-5 — 겹침 쌍 해소를 서버가 본다(고른 쌍 키 없으면 하나도 켜지 않는다 · 있으면 그대로 진행)
describe('모두 켜기 — 겹침 해소 서버 확인', () => {
  it('켤 여정이 낀 겹침 쌍을 고르지 않았으면 OVERLAP_UNRESOLVED · 고른 쌍이면 진행', async () => {
    mockJourneys([
      { id: ID(1), status: 'draft', trigger_event: 'purchase.first' },
      { id: ID(2), status: 'draft', trigger_event: 'cdp.purchase' },
    ]);
    (buildLifecycleMap as any).mockResolvedValue({ overlaps: [{ a: ID(2), b: ID(1), concurrentActive: 0 }] });
    const r = await activateJourneysInOrder('c', 'u', [ID(1), ID(2)]);
    expect(r).toMatchObject({ ok: false, code: 'OVERLAP_UNRESOLVED', pairs: [[ID(1), ID(2)].sort().join('|')] });
    expect(act).not.toHaveBeenCalled();
    const ok = await activateJourneysInOrder('c', 'u', [ID(1), ID(2)], { acknowledgedOverlaps: [[ID(1), ID(2)].sort().join('|')] });
    expect(ok.ok).toBe(true);
    (buildLifecycleMap as any).mockResolvedValue({ overlaps: [] });
  });
});
