/**
 * 여정 V.3 묶음 1 — 돈 (2026-10-20 · 설계서 docs/2026-10-20-journey-v3-design.md §5)
 *
 * 못 박는 것:
 *   - 처음 켜기 200 = 계보당 1번(원 여정 초안만 · 새 판 초안은 0 · one_shot 첫 발송은 판마다 그대로)
 *   - 계보 컬럼이 없으면 옛 동작(초안 = 200)
 *   - 묶음 합계도 같은 판정(새 판 초안은 0)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../ai-credit', () => {
  class InsufficientCreditError extends Error {}
  return { checkCredit: vi.fn(), deductCreditOutcome: vi.fn(), InsufficientCreditError };
});
vi.mock('../journey-builder', () => ({ activateJourney: vi.fn() }));
vi.mock('../journey-anchor-scheduler', () => ({ dispatchOneShotJourney: vi.fn() }));
vi.mock('../journey-target-extractor', () => ({ selectJourneyTargetCustomerIds: vi.fn(), JOURNEY_COUNT_CAP: 100000 }));
vi.mock('../store-scope', () => ({ getJourneyOwnerScopeSql: vi.fn() }));
vi.mock('../callback-filter', () => ({ filterByIndividualCallback: vi.fn() }));
vi.mock('../journey-lifecycle-map', () => ({ buildLifecycleMap: vi.fn(async () => ({ overlaps: [] })) }));
vi.mock('../journey-lineage', () => ({ lineageColumnsReady: vi.fn(async () => true) }));

import { query } from '../../config/database';
import { checkCredit, deductCreditOutcome } from '../ai-credit';
import { activateJourney } from '../journey-builder';
import { dispatchOneShotJourney } from '../journey-anchor-scheduler';
import { lineageColumnsReady } from '../journey-lineage';
import { activateJourneyGuarded, activateJourneysInOrder } from '../journey-activation';

const q = query as unknown as ReturnType<typeof vi.fn>;
const credit = checkCredit as unknown as ReturnType<typeof vi.fn>;
const deduct = deductCreditOutcome as unknown as ReturnType<typeof vi.fn>;
const act = activateJourney as unknown as ReturnType<typeof vi.fn>;
const oneShot = dispatchOneShotJourney as unknown as ReturnType<typeof vi.fn>;
const ready = lineageColumnsReady as unknown as ReturnType<typeof vi.fn>;

const ROOT = '00000000-0000-4000-8000-000000000001';
const V2 = '00000000-0000-4000-8000-000000000002';
const V3 = '00000000-0000-4000-8000-000000000003';
type Row = { id: string; status: string; lineage_id: string | null; start_kind?: string };

function mockJourneys(rows: Row[], opts: { lineageCols?: boolean } = {}) {
  const cols = opts.lineageCols !== false;
  q.mockImplementation(async (sql: string, params: any[]) => {
    if (!cols && /lineage_id/.test(sql)) {
      const e: any = new Error('column "lineage_id" does not exist');
      e.code = '42703';
      throw e;
    }
    if (/FROM journeys\s+WHERE company_id = \$1::uuid AND id = ANY/.test(sql)) {
      return { rows: rows.filter((r) => (params[1] as string[]).includes(r.id)).map((r) => ({ ...r, name: r.id, trigger_event: 'customer.created' })) };
    }
    if (/SELECT status, last_pretest_passed_at/.test(sql)) {
      const r = rows.find((x) => x.id === params[0]);
      return { rows: r ? [{ status: r.status, lineage_id: r.lineage_id, last_pretest_passed_at: '2026-10-20', start_kind: r.start_kind || 'event', callback_mode: 'fixed', trigger_event: 'customer.created', trigger_filters: {} }] : [] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  q.mockReset(); credit.mockReset(); deduct.mockReset(); act.mockReset(); oneShot.mockReset(); ready.mockReset();
  ready.mockResolvedValue(true);
  credit.mockResolvedValue(undefined);
  deduct.mockResolvedValue('deducted');   // ★1020 V.3(Codex 적대 A8) — 차감 결말(실제로 받은 크레딧)
  act.mockResolvedValue({ ok: true });
  oneShot.mockResolvedValue({ enqueued: 0 });
});

describe('처음 켜기 200 = 계보당 1번', () => {
  it('원 여정 초안(계보 없음) = 200 확인 · 차감 · charged 200', async () => {
    mockJourneys([{ id: ROOT, status: 'draft', lineage_id: null }]);
    const r = await activateJourneyGuarded('c', ROOT, 'u');
    expect(r).toEqual({ ok: true, firstActivation: true, charged: 200 });
    expect(credit).toHaveBeenCalledWith('c', 200);
    expect(deduct).toHaveBeenCalledWith(expect.objectContaining({ cost: 200, idempotencyKey: `journey-activate:${ROOT}` }));
  });
  it('새 판 초안(계보 뿌리 = 다른 여정) = 확인 0 · 차감 0 · charged 0', async () => {
    mockJourneys([{ id: V2, status: 'draft', lineage_id: ROOT }]);
    const r = await activateJourneyGuarded('c', V2, 'u');
    expect(r).toEqual({ ok: true, firstActivation: true, charged: 0 });
    expect(act).toHaveBeenCalledTimes(1);
    expect(credit).not.toHaveBeenCalled();
    expect(deduct).not.toHaveBeenCalled();
  });
  it('새 판의 새 판도 0', async () => {
    mockJourneys([{ id: V3, status: 'draft', lineage_id: ROOT }]);
    const r = await activateJourneyGuarded('c', V3, 'u');
    expect(r).toMatchObject({ ok: true, charged: 0 });
    expect(deduct).not.toHaveBeenCalled();
  });
  it('계보 뿌리가 자기 자신인 초안 = 200', async () => {
    mockJourneys([{ id: ROOT, status: 'draft', lineage_id: ROOT }]);
    const r = await activateJourneyGuarded('c', ROOT, 'u');
    expect(r).toMatchObject({ ok: true, charged: 200 });
  });
  it('멈춤 → 다시 켜기 = 0 · firstActivation false', async () => {
    mockJourneys([{ id: ROOT, status: 'paused', lineage_id: null }]);
    const r = await activateJourneyGuarded('c', ROOT, 'u');
    expect(r).toEqual({ ok: true, firstActivation: false, charged: 0 });
    expect(credit).not.toHaveBeenCalled();
  });
  it('one_shot 첫 발송은 판마다(새 판 초안도 적재 · 과금은 0)', async () => {
    mockJourneys([{ id: V2, status: 'draft', lineage_id: ROOT, start_kind: 'one_shot' }]);
    const r = await activateJourneyGuarded('c', V2, 'u');
    expect(oneShot).toHaveBeenCalledWith('c', V2);
    expect(r).toMatchObject({ ok: true, charged: 0 });
  });
  it('계보 컬럼이 없으면 옛 동작(초안 = 200)', async () => {
    ready.mockResolvedValue(false);
    mockJourneys([{ id: V2, status: 'draft', lineage_id: null }], { lineageCols: false });
    const r = await activateJourneyGuarded('c', V2, 'u');
    expect(r).toEqual({ ok: true, firstActivation: true, charged: 200 });
  });
});

describe('묶음 켜기 합계 = 같은 판정', () => {
  it('원 여정 초안 + 새 판 초안 = 200 하나만 확인', async () => {
    mockJourneys([{ id: ROOT, status: 'draft', lineage_id: null }, { id: V2, status: 'draft', lineage_id: '00000000-0000-4000-8000-000000000009' }]);
    const r = await activateJourneysInOrder('c', 'u', [ROOT, V2]);
    expect(r.ok).toBe(true);
    expect(credit.mock.calls[0]).toEqual(['c', 200]);
    const charged = (r as any).items.map((it: any) => it.result.charged).sort();
    expect(charged).toEqual([0, 200]);
  });
});

describe('운영 10 = 계보당 하루 1번(실행기 키 = 계보 뿌리)', () => {
  it('운영 크레딧 키의 여정 자리 = 계보 뿌리(없으면 여정 id)', async () => {
    const { operationCreditRoot } = await import('../journey-executor');
    expect(operationCreditRoot({ journey_id: V2, lineage_root: ROOT } as any)).toBe(ROOT);
    expect(operationCreditRoot({ journey_id: ROOT, lineage_root: ROOT } as any)).toBe(ROOT);
    expect(operationCreditRoot({ journey_id: V2, lineage_root: null } as any)).toBe(V2);
    expect(operationCreditRoot({ journey_id: V2 } as any)).toBe(V2);
  });
  it('본 조회 · 고아 표식 조회가 계보 뿌리를 싣는다(컬럼 가드 · 없으면 여정 id)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'journey-executor.ts'), 'utf-8');
    const fn = src.slice(src.indexOf('async function chargeJourneyOperationCredit('), src.indexOf('async function chargeJourneyOperationCredit(') + 900);
    expect(fn).toContain('idempotencyKey: `journey-operation:${operationCreditRoot(exec)}:${kstDateTag(sentAt)}`');
    // 두 조회 모두 같은 조각(lineageRootSql)을 쓴다
    expect(src.split('${lineageRootSql} AS lineage_root').length - 1).toBe(2);
    expect(src).toContain("const lineageRootSql = (await lineageColumnsReady()) ? 'COALESCE(j.lineage_id, j.id)' : 'j.id';");
  });
});

describe('겹침 확인 — 하나씩 켜기 · 고른 쌍 저장(V.3 §6-4)', () => {
  it('지도 겹침 중 켤 여정이 낀 쌍 · 저장된 쌍 · 요청이 고른 쌍을 빼고 남은 것', async () => {
    const { buildLifecycleMap } = await import('../journey-lifecycle-map');
    (buildLifecycleMap as any).mockResolvedValueOnce({ overlaps: [{ a: ROOT, b: V2 }, { a: ROOT, b: V3 }, { a: V2, b: V3 }] });
    q.mockImplementation(async (sql: string) => {
      if (/trigger_filters->'overlap_ack'/.test(sql)) return { rows: [{ id: ROOT, ack: [[ROOT, V3].sort().join('|')] }] };
      return { rows: [] };
    });
    const { unresolvedOverlapPairs } = await import('../journey-activation');
    const left = await unresolvedOverlapPairs('c', [ROOT], []);
    expect(left).toEqual([[ROOT, V2].sort().join('|')]);
    (buildLifecycleMap as any).mockResolvedValueOnce({ overlaps: [{ a: ROOT, b: V2 }] });
    expect(await unresolvedOverlapPairs('c', [ROOT], [[ROOT, V2].sort().join('|')])).toEqual([]);
  });
  it('고른 쌍 저장 = 그 여정이 낀 쌍만 · 기존과 합침 · 판(updated_at)은 올리지 않음(사전검사 판 유지)', async () => {
    const writes: any[] = [];
    q.mockImplementation(async (sql: string, params: any[]) => {
      if (/SELECT trigger_filters->'overlap_ack'/.test(sql)) return { rows: [{ ack: ['a|z'] }] };
      if (/UPDATE journeys SET trigger_filters/.test(sql)) { writes.push({ sql, params }); return { rows: [] }; }
      return { rows: [] };
    });
    const { persistOverlapAcks } = await import('../journey-activation');
    await persistOverlapAcks('c', ['a'], ['a|b', 'x|y']);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0].params[2])).toEqual(['a|b', 'a|z']);
    expect(writes[0].sql).not.toContain('updated_at');
  });
  it('단건 켜기 주소 = 겹침 확인(409) → 켜기 → 고른 쌍 저장 → 같은 계보 멈춘 옛 판도 다시 켜기', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const a = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'ai.ts'), 'utf-8');
    const r = a.slice(a.indexOf("router.post('/operator/journeys/:id/activate'"), a.indexOf("router.post('/operator/journeys-activate-batch'"));
    const check = r.indexOf('await unresolvedOverlapPairs(companyId, [journeyId]');
    const act = r.indexOf('await activateJourneyGuarded(companyId, journeyId');
    const persist = r.indexOf('await persistOverlapAcks(companyId, [journeyId]');
    const sib = r.indexOf('await resumeLineageSiblings(companyId, journeyId, userId)');
    expect(check).toBeGreaterThan(0);
    expect(act).toBeGreaterThan(check);
    expect(persist).toBeGreaterThan(act);
    expect(sib).toBeGreaterThan(act);
    expect(r).toContain("code: 'OVERLAP_UNRESOLVED'");
  });
});
