/**
 * 여정 V.3 묶음 2 — 새 모양 한 흐름(2026-10-20 · 설계서 §4-2)
 *
 * 켜진 여정의 칸 모양 · 목표 끄기 · 회신번호를 바꾸면 = 복제 → 바꾼 내용 적용 → 사전검사 → 켜기(0크레딧 · 계보당 200 한 번).
 * 못 박는 것:
 *   - 어디서든 실패하면 복제본을 지운다(숨은 초안 0)
 *   - 옛 초안(V.3 전 새 판)이 남아 있으면 덮지 않고 알린다
 *   - 한 번 보내기 여정은 새 모양을 만들지 않는다(첫 발송 멱등이 여정 id 단위라 다시 보낸다)
 *   - 칸 삭제는 뒤 순번부터(앞 칸 순번이 밀리지 않게) · 추가는 맨 뒤
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn() }));
vi.mock('../journey-lineage', () => ({ createNewVersion: vi.fn() }));
vi.mock('../journey-builder', () => ({
  updateJourneyStep: vi.fn(), addJourneyStep: vi.fn(), deleteJourneyStep: vi.fn(), deleteJourney: vi.fn(), updateJourneyCallback: vi.fn(),
}));
vi.mock('../journey-pretest-validator', () => ({ validateJourneyForActivation: vi.fn() }));
vi.mock('../journey-activation', () => ({ activateJourneyGuarded: vi.fn() }));

import { query } from '../../config/database';
import { createNewVersion } from '../journey-lineage';
import { updateJourneyStep, addJourneyStep, deleteJourneyStep, deleteJourney } from '../journey-builder';
import { validateJourneyForActivation } from '../journey-pretest-validator';
import { activateJourneyGuarded } from '../journey-activation';
import { reshapeJourney } from '../journey-reshape';

const q = query as unknown as ReturnType<typeof vi.fn>;
const clone = createNewVersion as unknown as ReturnType<typeof vi.fn>;
const upd = updateJourneyStep as unknown as ReturnType<typeof vi.fn>;
const add = addJourneyStep as unknown as ReturnType<typeof vi.fn>;
const del = deleteJourneyStep as unknown as ReturnType<typeof vi.fn>;
const drop = deleteJourney as unknown as ReturnType<typeof vi.fn>;
const pre = validateJourneyForActivation as unknown as ReturnType<typeof vi.fn>;
const act = activateJourneyGuarded as unknown as ReturnType<typeof vi.fn>;

const SRC = '00000000-0000-4000-8000-000000000001';
const NV = '00000000-0000-4000-8000-000000000002';
let order: string[] = [];

function mockDb(src: { status: string; start_kind?: string } | null, opts: { sentToday?: boolean; markOk?: boolean } = {}) {
  q.mockImplementation(async (sql: string, params: any[]) => {
    if (/FROM journeys WHERE id = \$1::uuid AND company_id = \$2::uuid/.test(sql) && /start_kind/.test(sql) && params[0] === SRC) {
      return { rows: src ? [{ id: SRC, status: src.status, start_kind: src.start_kind || 'event' }] : [] };
    }
    if (/FROM journey_step_logs/.test(sql)) return { rows: opts.sentToday ? [{ x: 1 }] : [] };
    if (/SELECT id, step_order FROM journey_steps/.test(sql)) return { rows: [{ id: 's1', step_order: 1 }, { id: 's2', step_order: 2 }, { id: 's3', step_order: 3 }] };
    if (/updated_at::text AS rev/.test(sql)) return { rows: [{ rev: 'r1' }] };
    if (/SET last_pretest_passed_at = NOW\(\)/.test(sql)) { order.push('mark'); return { rows: opts.markOk === false ? [] : [{ id: NV }] }; }
    return { rows: [] };
  });
}

beforeEach(() => {
  order = [];
  for (const f of [q, clone, upd, add, del, drop, pre, act]) f.mockReset();
  clone.mockImplementation(async () => { order.push('clone'); return { journeyId: NV, existing: false, stepsCopied: 3, variantsNotCopied: 0 }; });
  upd.mockImplementation(async (_c: string, _j: string, sid: string) => { order.push(`upd:${sid}`); return true; });
  del.mockImplementation(async (_c: string, _j: string, sid: string) => { order.push(`del:${sid}`); return { deletedOrder: 0, renumbered: 0 }; });
  add.mockImplementation(async () => { order.push('add'); return { stepId: 's9', stepOrder: 4 }; });
  drop.mockImplementation(async () => { order.push('drop'); return { ok: true }; });
  pre.mockImplementation(async () => { order.push('pretest'); return { ok: true, failedSteps: [], totalCost: 0, estimatedWeeklyTriggerCount: 0, confidenceScore: 100 }; });
  act.mockImplementation(async () => { order.push('activate'); return { ok: true, firstActivation: true, charged: 0 }; });
});

describe('reshapeJourney', () => {
  it('성공 = 복제 → 고치기 → 뒤 순번부터 삭제 → 추가 → 사전검사 → 표식 → 켜기 · 복제본 유지', async () => {
    mockDb({ status: 'active' });
    const r = await reshapeJourney('c', SRC, 'u', {
      stepPatches: [{ order: 1, patch: { channel: 'lms' } }],
      deleteOrders: [2, 3],
      addSteps: [{ stepType: 'message', delayHours: 24, channel: 'sms', messageTemplate: '고객님 다시 찾아 주셔서 고맙습니다.' } as any],
    });
    expect(r).toEqual({ ok: true, journeyId: NV });
    expect(order).toEqual(['clone', 'upd:s1', 'del:s3', 'del:s2', 'add', 'pretest', 'mark', 'activate']);
    expect(drop).not.toHaveBeenCalled();
    expect(upd).toHaveBeenCalledWith('c', NV, 's1', { channel: 'lms' });
  });
  it('사전검사 실패 = 복제본 삭제 · 켜지 않음', async () => {
    mockDb({ status: 'active' });
    pre.mockResolvedValue({ ok: false, failedSteps: [{ stepId: 's1', reason: 'spam_filter_failed' }], totalCost: 0, estimatedWeeklyTriggerCount: 0, confidenceScore: 0 });
    const r = await reshapeJourney('c', SRC, 'u', { stepPatches: [{ order: 1, patch: { channel: 'lms' } }] });
    expect(r).toMatchObject({ ok: false, code: 'PRETEST_FAILED' });
    expect(drop).toHaveBeenCalledWith('c', NV);
    expect(act).not.toHaveBeenCalled();
  });
  it('켜기 실패 = 복제본 삭제', async () => {
    mockDb({ status: 'active' });
    act.mockResolvedValue({ ok: false, code: 'ACTIVATE_FAILED', message: '회신번호가 비어있습니다.' });
    const r = await reshapeJourney('c', SRC, 'u', { stepPatches: [{ order: 1, patch: { channel: 'lms' } }] });
    expect(r).toMatchObject({ ok: false, code: 'ACTIVATE_FAILED', message: '회신번호가 비어있습니다.' });
    expect(drop).toHaveBeenCalledWith('c', NV);
  });
  it('검사하는 사이 바뀌면(표식 0행) 켜지 않고 삭제', async () => {
    mockDb({ status: 'active' }, { markOk: false });
    const r = await reshapeJourney('c', SRC, 'u', { stepPatches: [{ order: 1, patch: { channel: 'lms' } }] });
    expect(r).toMatchObject({ ok: false, code: 'ACTIVATE_FAILED' });
    expect(act).not.toHaveBeenCalled();
    expect(drop).toHaveBeenCalled();
  });
  it('고치다 던지면 삭제하고 다시 던진다', async () => {
    mockDb({ status: 'active' });
    upd.mockRejectedValue(new Error('boom'));
    await expect(reshapeJourney('c', SRC, 'u', { stepPatches: [{ order: 1, patch: { channel: 'lms' } }] })).rejects.toThrow('boom');
    expect(drop).toHaveBeenCalledWith('c', NV);
  });
  it('옛 초안이 있으면 덮지 않고 알린다(지우지 않음)', async () => {
    mockDb({ status: 'active' });
    clone.mockResolvedValue({ journeyId: 'old-draft', existing: true, stepsCopied: 0, variantsNotCopied: 0 });
    const r = await reshapeJourney('c', SRC, 'u', { stepPatches: [{ order: 1, patch: { channel: 'lms' } }] });
    expect(r).toMatchObject({ ok: false, code: 'DRAFT_EXISTS' });
    expect(drop).not.toHaveBeenCalled();
  });
  it('한 번 보내기 · 멈춘 여정 · 끝난 여정은 만들지 않는다', async () => {
    mockDb({ status: 'active', start_kind: 'one_shot' });
    expect(await reshapeJourney('c', SRC, 'u', { stepPatches: [{ order: 1, patch: { channel: 'lms' } }] })).toMatchObject({ ok: false, code: 'NOT_ALLOWED' });
    mockDb({ status: 'paused' });
    expect(await reshapeJourney('c', SRC, 'u', { stepPatches: [{ order: 1, patch: { channel: 'lms' } }] })).toMatchObject({ ok: false, code: 'NOT_ALLOWED' });
    mockDb({ status: 'ended' });
    expect(await reshapeJourney('c', SRC, 'u', { stepPatches: [{ order: 1, patch: { channel: 'lms' } }] })).toMatchObject({ ok: false, code: 'NOT_ALLOWED' });
    expect(clone).not.toHaveBeenCalled();
  });
  it('날짜 기준 여정은 오늘 보낸 회차가 있으면 내일로', async () => {
    mockDb({ status: 'active', start_kind: 'date_anchor' }, { sentToday: true });
    expect(await reshapeJourney('c', SRC, 'u', { stepPatches: [{ order: 1, patch: { channel: 'lms' } }] })).toMatchObject({ ok: false, code: 'SAME_DAY_ANCHOR' });
    expect(clone).not.toHaveBeenCalled();
  });
  it('바꿀 것이 없으면 만들지 않는다', async () => {
    mockDb({ status: 'active' });
    expect(await reshapeJourney('c', SRC, 'u', {})).toMatchObject({ ok: false, code: 'NO_CHANGE' });
    expect(clone).not.toHaveBeenCalled();
  });
});
