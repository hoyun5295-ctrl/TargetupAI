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
  return { checkCredit: vi.fn(), deductCreditSafe: vi.fn(), InsufficientCreditError };
});
vi.mock('../journey-builder', () => ({ activateJourney: vi.fn() }));
vi.mock('../journey-anchor-scheduler', () => ({ dispatchOneShotJourney: vi.fn() }));
vi.mock('../journey-target-extractor', () => ({ selectJourneyTargetCustomerIds: vi.fn(), JOURNEY_COUNT_CAP: 100000 }));
vi.mock('../store-scope', () => ({ getJourneyOwnerScopeSql: vi.fn() }));
vi.mock('../callback-filter', () => ({ filterByIndividualCallback: vi.fn() }));

import { query } from '../../config/database';
import { checkCredit, deductCreditSafe, InsufficientCreditError } from '../ai-credit';
import { activateJourney } from '../journey-builder';
import { dispatchOneShotJourney } from '../journey-anchor-scheduler';
import { selectJourneyTargetCustomerIds } from '../journey-target-extractor';
import { filterByIndividualCallback } from '../callback-filter';
import { getCreditCost } from '../ai-credit-calc';
import { activateJourneyGuarded, activateJourneysInOrder, orderReceiversFirst } from '../journey-activation';

const q = query as unknown as ReturnType<typeof vi.fn>;
const credit = checkCredit as unknown as ReturnType<typeof vi.fn>;
const deduct = deductCreditSafe as unknown as ReturnType<typeof vi.fn>;
const act = activateJourney as unknown as ReturnType<typeof vi.fn>;
const oneShot = dispatchOneShotJourney as unknown as ReturnType<typeof vi.fn>;
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
  q.mockReset(); credit.mockReset(); deduct.mockReset(); act.mockReset(); oneShot.mockReset();
  credit.mockResolvedValue(undefined);
  deduct.mockResolvedValue(true);
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
    deduct.mockImplementation(async () => { order.push('deduct'); return true; });
    const r = await activateJourneyGuarded('c', ID(1), 'u');
    expect(r).toEqual({ ok: true, firstActivation: true });
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
    expect(r).toEqual({ ok: true, firstActivation: false });
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
  it('1회 발송은 최초 활성화 때만 적재', async () => {
    mockJourneys([{ id: ID(1), status: 'draft', trigger_event: 'custom', start_kind: 'one_shot' }, { id: ID(2), status: 'paused', trigger_event: 'custom', start_kind: 'one_shot' }]);
    await activateJourneyGuarded('c', ID(1), 'u');
    await activateJourneyGuarded('c', ID(2), 'u');
    expect(oneShot).toHaveBeenCalledTimes(1);
    expect(oneShot).toHaveBeenCalledWith('c', ID(1));
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
    expect(by[ID(1)]).toEqual({ ok: true, firstActivation: true });
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
