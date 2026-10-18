/**
 * ★ 2026-10-18 쌍 승인 · 건너뛰기 · 미루기 동작(설계서 docs/2026-10-18-planner-v2-design.md §3-2-2 · 회의론자 B2 · B3)
 * 같은 조건(행사 live + 쌍 planned + 같은 회차 + 마감 전 + 화면이 본 지문) · 잠금 아래 읽어 둔 상태 그대로일 때만 쓴다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const clientQuery = vi.fn();
const release = vi.fn();
vi.mock('../../config/database', () => ({
  pool: { connect: vi.fn(async () => ({ query: clientQuery, release })) },
  query: vi.fn(async () => ({ rows: [] })),
}));

const state: { carrier: any; dm: any; ev: any } = { carrier: null, dm: null, ev: null };
vi.mock('../planner-touchpoint', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    loadTouchpointById: vi.fn(async (_c: string, id: string) => (id === state.carrier.id ? state.carrier : id === state.dm?.id ? state.dm : null)),
    loadEventTouchpoints: vi.fn(async () => [state.carrier, ...(state.dm ? [state.dm] : [])]),
    loadAllLiveTouchpoints: vi.fn(async () => []),
    notifyPlanner: vi.fn(async () => true),
  };
});
vi.mock('../planner-event', async (orig) => {
  const real: any = await orig();
  return { ...real, loadPlannerEvent: vi.fn(async () => state.ev) };
});
vi.mock('../planner-confirm', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    // 쌍 지문 = 캐리어 문안을 함께 담는다(실제 함수와 같은 성질 · DM 지문도 캐리어 문안이 바뀌면 바뀐다)
    computeTouchpointFingerprints: vi.fn(async (_c: string, rows: any[]) => {
      const text = rows.find((r) => r.channel === 'sms')?.execMeta?.copy?.text || '';
      return new Map(rows.map((r) => [r.id, `fp-${r.id}-${text}`]));
    }),
  };
});
vi.mock('../planner-channel-gate', async (orig) => {
  const real: any = await orig();
  return { ...real, firstBlockedChannel: vi.fn(async () => null) };
});
vi.mock('../planner-audience', async (orig) => {
  const real: any = await orig();
  return { ...real, countPlannerAudience: vi.fn(async () => ({ count: 120, blocked: false })) };
});
vi.mock('../planner-review', async (orig) => {
  const real: any = await orig();
  return { ...real, settleEventIfFinished: vi.fn(async () => null) };
});

import { approvePlannerPairTx, skipPlannerPairTx, deferPlannerPairTx, PlannerRecheckError } from '../planner-recheck';
import { copyInputHash } from '../planner-copy';

const NOW = new Date('2026-10-20T03:00:00Z'); // KST 12시
const recheck = { round: 2, date: '2026-10-20', origin: 'send_day', at: '2026-10-20T01:00:00Z', proposal: { text: '새 문안', subject: '제목', checkedAt: '2026-10-20T01:10:00Z' } };

function setup(over: { evStatus?: string; carrierStatus?: string; round?: number; date?: string } = {}) {
  state.ev = { id: 'ev', companyId: 'co', planMonth: '2026-10', title: '가을 세일', startsOn: '2026-10-20', endsOn: '2026-10-25', benefitText: '20% 할인', products: [], status: over.evStatus || 'scheduled', createdBy: 'u-owner', meta: { revision: 3 } };
  const rc = { ...recheck, round: over.round ?? 2, date: over.date || '2026-10-20' };
  const base = (id: string, channel: string) => ({
    id, eventId: 'ev', companyId: 'co', channel, channelLabel: channel, timing: { anchor: 'start' }, status: over.carrierStatus || 'planned',
    assetRef: channel === 'dm' ? 'dm-1' : null, execRef: null, lockReason: null, scheduledOn: over.date || '2026-10-20',
    planMonth: '2026-10', title: '가을 세일', startsOn: '2026-10-20', endsOn: '2026-10-25', benefitText: '20% 할인', products: [], createdBy: 'u-owner', eventStatus: 'scheduled',
    execMeta: { recheck: rc, dm_url: 'https://hlj.kr/d/abc', ...(channel === 'sms' ? { copy: { text: '원래 문안 20% 할인', subject: '제목', inputHash: 'x', spam: 'pass', checkedAt: null, withDmLink: true } } : {}) },
  });
  state.carrier = base('c1', 'sms');
  state.dm = base('d1', 'dm');
  // 잠금 아래 다시 읽기 = 읽어 둔 그대로
  clientQuery.mockImplementation(async (sql: string, params?: any[]) => {
    if (/FROM planner_events WHERE id = \$1::uuid AND company_id = \$2::uuid FOR UPDATE/.test(sql)) return { rows: [{ status: state.ev.status }] };
    if (/exec_meta->'recheck' AS recheck/.test(sql)) {
      return { rows: [state.carrier, state.dm].map((t) => ({ id: t.id, status: t.status, recheck: t.execMeta.recheck, copy: t.execMeta.copy ?? null })) };
    }
    if (/UPDATE planner_touchpoints/.test(sql)) {
      const ids = Array.isArray(params?.[1]) ? params![1] : null;
      return { rows: ids ? ids.map((id: string) => ({ id })) : [{ id: 'x' }] };
    }
    return { rows: [] };
  });
}

const seenFor = (text: string) => `fp-c1-${text}:fp-d1-${text}:2`;
const actor = { userId: 'u-owner', via: 'pc' as const, ownerScope: null };

describe('쌍 승인', () => {
  beforeEach(() => { clientQuery.mockReset(); release.mockReset(); });

  it('새 문안으로 승인 = 쌍만 ready + 각인 · recheck 제거 · 행사 상태 무변경', async () => {
    setup();
    const r = await approvePlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, choice: 'proposal', seenHash: seenFor('새 문안'), actor, now: NOW });
    expect(r).toMatchObject({ date: '2026-10-20', sendsAt: 'now', recipients: 120 });
    const ups = clientQuery.mock.calls.filter((c) => /UPDATE planner_touchpoints/.test(String(c[0])));
    expect(ups).toHaveLength(2);
    for (const u of ups) {
      expect(String(u[0])).toMatch(/SET status = 'ready'/);
      expect(String(u[0])).toMatch(/- 'recheck' - 'post_approval_spam' - 'spam_error'/);
      expect(String(u[0])).toMatch(/AND status = 'planned'/);
    }
    const carrierPatch = JSON.parse(ups.find((u) => u[1][0] === 'c1')![1][2]);
    expect(carrierPatch.copy.text).toBe('새 문안');
    expect(carrierPatch.copy.inputHash).toBe(copyInputHash(state.ev, { timing: { anchor: 'start' }, scheduledOn: '2026-10-20', withDmLink: true }));
    expect(carrierPatch.approved).toMatchObject({ hash: 'fp-c1-새 문안', pair: true, via: 'pc' });
    const dmPatch = JSON.parse(ups.find((u) => u[1][0] === 'd1')![1][2]);
    expect(dmPatch.approved.hash).toBe('fp-d1-새 문안');
    expect(dmPatch.copy).toBeUndefined();
    expect(clientQuery.mock.calls.some((c) => /UPDATE planner_events/.test(String(c[0])))).toBe(false);
  });

  it('밤(시간대 밖)에 승인하면 08시(B1) · 다른 날이면 그날', async () => {
    setup();
    const night = new Date('2026-10-19T16:30:00Z'); // KST 10/20 01:30
    const r = await approvePlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, choice: 'proposal', seenHash: seenFor('새 문안'), actor, now: night });
    expect(r.sendsAt).toBe('morning');
    setup({ date: '2026-10-22' });
    const r2 = await approvePlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, choice: 'proposal', seenHash: seenFor('새 문안'), actor, now: NOW });
    expect(r2.sendsAt).toBe('date');
  });

  it('회차가 다르면 · 화면이 본 지문이 다르면 · 마감 뒤면 · 행사가 live 가 아니면 409', async () => {
    setup();
    await expect(approvePlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 1, choice: 'proposal', seenHash: seenFor('새 문안'), actor, now: NOW })).rejects.toMatchObject({ status: 409, code: 'CHANGED' });
    await expect(approvePlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, choice: 'proposal', seenHash: 'stale', actor, now: NOW })).rejects.toMatchObject({ status: 409, code: 'CHANGED' });
    await expect(approvePlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, choice: 'proposal', seenHash: seenFor('새 문안'), actor, now: new Date('2026-10-20T11:01:00Z') }))
      .rejects.toMatchObject({ status: 409, code: 'DEADLINE_PASSED' });
    setup({ evStatus: 'briefed' });
    await expect(approvePlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, choice: 'proposal', seenHash: seenFor('새 문안'), actor, now: NOW })).rejects.toMatchObject({ status: 409, code: 'NOT_OPEN' });
    expect(clientQuery.mock.calls.some((c) => /UPDATE planner_touchpoints/.test(String(c[0])))).toBe(false);
  });

  it('지금 글(current)은 이 회차에 실주소로 검사 통과했을 때만', async () => {
    setup();
    await expect(approvePlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, choice: 'current', seenHash: seenFor('원래 문안 20% 할인'), actor, now: NOW }))
      .rejects.toMatchObject({ status: 409, code: 'COPY_NOT_READY' });
  });

  it('담당자 범위 밖이면 404', async () => {
    setup();
    await expect(approvePlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, choice: 'proposal', seenHash: seenFor('새 문안'), actor: { ...actor, ownerScope: 'u-other' }, now: NOW }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('잠금 아래 다시 읽은 상태가 다르면 409(그 사이 고침 · 승인)', async () => {
    setup();
    const orig = clientQuery.getMockImplementation()!;
    clientQuery.mockImplementation(async (sql: string, params?: any[]) => {
      if (/exec_meta->'recheck' AS recheck/.test(sql)) return { rows: [{ id: 'c1', status: 'planned', recheck: { ...recheck, round: 3 }, copy: null }, { id: 'd1', status: 'planned', recheck, copy: null }] };
      return orig(sql, params);
    });
    await expect(approvePlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, choice: 'proposal', seenHash: seenFor('새 문안'), actor, now: NOW })).rejects.toBeInstanceOf(PlannerRecheckError);
    expect(clientQuery.mock.calls.some((c) => /SET status = 'ready'/.test(String(c[0])))).toBe(false);
    expect(clientQuery.mock.calls.map((c) => String(c[0]))).toContain('ROLLBACK');
  });
});

describe('건너뛰기 · 미루기 = 같은 조건(B2)', () => {
  beforeEach(() => { clientQuery.mockReset(); release.mockReset(); });

  it('멈춘 쌍만 건너뛴다 · 이미 승인된 쌍(ready)은 409', async () => {
    setup();
    const r = await skipPlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, actor, now: NOW });
    expect(r.date).toBe('2026-10-20');
    const up = clientQuery.mock.calls.find((c) => /UPDATE planner_touchpoints/.test(String(c[0])))!;
    expect(String(up[0])).toMatch(/SET status = 'skipped'/);
    setup({ carrierStatus: 'ready' });
    await expect(skipPlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, actor, now: NOW })).rejects.toMatchObject({ status: 409 });
  });

  it('미루기는 고를 수 있는 날만(행사 기간 · 다른 문자 없는 날)', async () => {
    setup();
    const r = await deferPlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, toDate: '2026-10-22', actor, now: NOW });
    expect(r).toEqual({ from: '2026-10-20', to: '2026-10-22' });
    const up = clientQuery.mock.calls.find((c) => /UPDATE planner_touchpoints/.test(String(c[0])))!;
    expect(String(up[0])).toMatch(/jsonb_build_object\('on', \$3::text\)/);
    expect(JSON.parse(up[1][4])).toMatchObject({ round: 3, date: '2026-10-22', origin: 'deferred', deferredFrom: '2026-10-20' });
    setup();
    await expect(deferPlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, toDate: '2026-10-30', actor, now: NOW })).rejects.toMatchObject({ status: 400, code: 'DATE_NOT_ALLOWED' });
    await expect(deferPlannerPairTx({ companyId: 'co', carrierId: 'c1', round: 2, toDate: '2026-10-20', actor, now: NOW })).rejects.toMatchObject({ status: 400 });
  });
});
