/**
 * 여정 V.3 §18 — 기존 여정 뒤에 붙이기 · 붙기 전 점검 · 떼기(2026-10-20 · Harold 「기존 여정 뒤에 붙일 방법 · 붙을 수 있는지 점검」)
 *
 * seam(설계서 §18-6)
 *   1. 점검(judgeAttach · 순수) — 막음 · 알림 · 고리
 *   2. 후보 추출(selectAfterJourneyCandidates) — 결과 상태 · 기준 시각 · 7일 창 · 표식 안티조인 · 재진입 · 동의 · 범위 · 조건 · 회사
 *   3. 붙이기 · 떼기(attachJourney · detachJourney) — 잠금 순서 · 잠금 안 다시 점검 · 바꾸는 값 · 되돌림 · 기준선 · DDL 전 503
 *   4. 지도(placeAttached · orderAttached · attachLineState · journeyHealth) — 자리 · 순서 · 선 상태
 *   5. 만들기 길 차단 · 켜기 검사 · 감시 배선
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
// 계보 잠금 = 같은 연결로 잠금 문장 하나(순서 단정용 · 원 모듈 안 컬럼 확인은 흉내 DB 에 닿지 않게)
vi.mock('../journey-lineage', async (orig) => ({
  ...(await orig<any>()),
  lineageColumnsReady: vi.fn(async () => true),
  lockLineage: vi.fn(async (run: any, id: string) => { await run.query(`SELECT pg_advisory_xact_lock(hashtext('journey-entry'), 1) FROM journeys WHERE id = $1::uuid`, [id]); }),
}));
vi.mock('../journey-trigger-db', async (orig) => ({ ...(await orig<any>()), dbAcceptsTriggerEvent: vi.fn(async () => true) }));
vi.mock('../journey-entry-ledger', async (orig) => ({ ...(await orig<any>()), seedBaselineForJourney: vi.fn(async () => ({ seeded: 0 })), seedGradeStateForJourney: vi.fn(async () => ({ seeded: 0 })) }));

import { query, pool } from '../../config/database';
import { judgeAttach, representativeOf, attachJourney, detachJourney, AttachBlockedError, type AttachJourneyRow } from '../journey-attach';
import { readAfterConfig, outcomeStatuses } from '../journey-after-config';
import { selectAfterJourneyCandidates } from '../journey-target-extractor';
import { placeAttached, orderAttached, attachLineState, journeyHealth } from '../journey-lifecycle-map';
import { isCreatableTriggerEvent, isImplementedTriggerEvent, aiSelectableTriggerEvents, formatTriggerMenuForAi } from '../journey-trigger-capability';
import { validateJourneyEntryConfig } from '../journey-builder';
import { dbAcceptsTriggerEvent, JourneyMigrationPendingError } from '../journey-trigger-db';
import { seedBaselineForJourney } from '../journey-entry-ledger';

const q = query as unknown as ReturnType<typeof vi.fn>;
const connect = (pool as any).connect as ReturnType<typeof vi.fn>;
const SRC = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf-8');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const CO = '99999999-9999-4999-8999-999999999999';

const row = (id: string, over: Partial<AttachJourneyRow> = {}): AttachJourneyRow => ({
  id, name: `여정${id.slice(0, 1)}`, status: 'active', triggerEvent: 'customer.created', startKind: 'event', filters: {},
  root: id, entryClosed: false, archived: false, goalExitEnabled: true, ...over,
});
const after = (root: string, outcome = 'any') => ({ triggerEvent: 'journey.after', filters: { after_root: root, after_outcome: outcome, attach_prev: { trigger_event: 'custom', start_kind: 'standing', trigger_filters: {} } } });

describe('1. 붙기 전 점검(judgeAttach)', () => {
  it('막음 — 같은 계보 · 끝남/보관 · 마무리 중 · 날짜 기준 · 목표 끔인데 목표 이룸 · 이미 같은 결과로 붙음', () => {
    const a = row(A);
    expect(judgeAttach(a, row(B, { root: A }), 'any', []).blocks).toContain('같은 여정끼리는 붙일 수 없어요.');
    expect(judgeAttach(row(A, { status: 'ended' }), row(B), 'any', []).blocks[0]).toContain('앞 여정이 끝났거나 보관');
    expect(judgeAttach(a, row(B, { archived: true }), 'any', []).blocks[0]).toContain('끝났거나 보관된 여정');
    expect(judgeAttach(a, row(B, { entryClosed: true }), 'any', []).blocks[0]).toContain('옛 모양으로 마무리 중');
    expect(judgeAttach(a, row(B, { startKind: 'date_anchor' }), 'any', []).blocks[0]).toContain('날짜에 맞춰 보내는 여정');
    expect(judgeAttach(a, row(B, { startKind: 'one_shot' }), 'any', []).blocks[0]).toContain('날짜에 맞춰 보내는 여정');
    expect(judgeAttach(row(A, { goalExitEnabled: false }), row(B), 'goal_met', []).blocks[0]).toContain('목표 달성하면 끝내기');
    expect(judgeAttach(row(A, { goalExitEnabled: false }), row(B), 'completed', []).blocks).toEqual([]);
    expect(judgeAttach(a, row(B, after(A, 'any')), 'any', [a]).blocks).toContain('이미 이 여정 뒤에 같은 고객으로 붙어 있어요.');
    expect(judgeAttach(a, row(B, after(A, 'any')), 'goal_met', [a]).blocks).toEqual([]);
  });
  it('막음 — 뒤 여정 알림톡이 사건 값(주문번호 · 상품명 등)을 쓰면 빈 값으로 나가므로 붙이지 않는다', () => {
    expect(judgeAttach(row(A), row(B, { usesEventFields: true }), 'any', []).blocks[0]).toContain('사건 값을 써서');
  });
  it('고리 — B → C → A 가 있으면 A 뒤에 B 를 못 붙인다(사슬 셋)', () => {
    const b = row(B);
    const c = row(C, after(B));
    const a = row(A, after(C));
    const rows = [a, b, c];
    expect(judgeAttach(a, b, 'any', rows).blocks).toContain('뒤 여정을 따라가면 앞 여정이 다시 나와 고리가 생겨요.');
    // 고리가 아니면 통과(A 뒤에 C 는 C 가 B 뒤에 붙어 있을 뿐)
    expect(judgeAttach(row(A), c, 'any', [row(A), b, c]).blocks).toEqual([]);
  });
  it('고리 — 같은 계보의 다른 판(복제 초안)에 걸린 연결도 센다(대표 판만 보면 그 판이 켜지며 고리 · Codex 적대 A 2R)', () => {
    const B2 = '66666666-6666-4666-8666-666666666666';
    const b1 = row(B);                                                  // 켜진 판(보통 시작)
    const b2 = row(B2, { root: B, status: 'draft', ...after(A) });       // 같은 계보 초안이 A 뒤에 붙음
    const a = row(A);
    // A 를 B 뒤에 붙이면 B 계보 → A 계보 연결(b2)이 이미 있어 고리
    expect(judgeAttach(b1, a, 'any', [a, b1, b2]).blocks).toContain('뒤 여정을 따라가면 앞 여정이 다시 나와 고리가 생겨요.');
    // 진입이 닫힌 옛 판의 연결은 세지 않는다
    expect(judgeAttach(b1, a, 'any', [a, b1, { ...b2, entryClosed: true }]).blocks).toEqual([]);
  });
  it('알림 — 원래 시작 끊김 · 다른 여정에서 옮김 · 앞 여정 꺼짐 · 뒤 여정 상태', () => {
    const w1 = judgeAttach(row(A, { status: 'paused' }), row(B, { status: 'draft', triggerEvent: 'customer.birthday_approaching' }), 'any', []).warns;
    expect(w1[0]).toContain('원래 시작(생일 D-7) 대신 앞 여정을 마친 고객만 받아요');
    expect(w1).toContain('앞 여정이 꺼져 있어 켜기 전까지는 넘어오는 고객이 없어요.');
    expect(w1).toContain('이 여정은 초안이라 켠 뒤부터 받아요.');
    const other = row(C, { name: '옛 앞 여정' });
    const w2 = judgeAttach(row(A), row(B, after(C)), 'any', [row(A), other]).warns;
    expect(w2[0]).toBe('지금 「옛 앞 여정」 뒤에 붙어 있어요. 이 여정 뒤로 옮겨요.');
    expect(w2).toContain('켜진 여정이라 붙이는 즉시 이 길로 받아요.');
  });
  it('계보 대표 = 진입이 열린 판 중 켜짐 > 멈춤 > 초안 · 보관 제외', () => {
    const old = row(A, { status: 'active', entryClosed: true });
    const cur = row(C, { root: A, status: 'paused' });
    expect(representativeOf([old, cur], A)?.id).toBe(C);
    expect(representativeOf([row(A, { archived: true })], A)).toBeNull();
  });
  it('설정 읽기 · 결과 → 끝난 상태', () => {
    expect(readAfterConfig({ after_root: A.toUpperCase(), after_outcome: 'goal_met' })).toEqual({ root: A, outcome: 'goal_met' });
    expect(readAfterConfig({ after_root: 'x', after_outcome: 'goal_met' })).toBeNull();
    expect(readAfterConfig({ after_root: A, after_outcome: 'all' })).toBeNull();
    expect(outcomeStatuses('goal_met')).toEqual(['goal_met']);
    expect(outcomeStatuses('completed')).toEqual(['completed']);
    expect(outcomeStatuses('any')).toEqual(['goal_met', 'completed']);
  });
});

describe('2. 후보 추출(selectAfterJourneyCandidates)', () => {
  beforeEach(() => { q.mockReset(); });
  it('감시(뒤 여정 id 있음) — 결과 상태 · 7일 창 · 기준 시각 = 뒤 여정 last_event_cursor · 표식 안티조인 · 재진입 · 동의 · 회사', async () => {
    q.mockResolvedValue({ rows: [{ customer_id: 'c1', after_exec_id: 'e1' }] });
    const out = await selectAfterJourneyCandidates(CO, { after_root: A, after_outcome: 'completed', customer_conditions: [{ field: 'grade', op: '==', value: 'VIP' }] }, 50, B,
      { allowReentry: false, cooldownDays: 0, lineageIds: [B, C] }, ' AND c.store_code = \'X\'', undefined, '2026-10-20 09:00:00.123456+09');
    expect(out).toEqual([{ customerId: 'c1', afterExecId: 'e1' }]);
    const [sql, params] = q.mock.calls[0];
    expect(params.slice(0, 4)).toEqual([CO, A, ['completed'], '7']);
    expect(sql).toContain('(aj.id = $2::uuid OR aj.lineage_id = $2::uuid)');
    expect(sql).toContain('aj.company_id = $1::uuid');
    expect(sql).toContain('AND c.company_id = $1::uuid');
    expect(sql).toContain('ae.status = ANY($3::text[])');
    expect(sql).toContain(`ae.completed_at > NOW() - ($4 || ' days')::interval`);
    expect(sql).toContain('ae.completed_at >= $5::timestamptz');
    expect(params[4]).toBe('2026-10-20 09:00:00.123456+09');   // 기준 시각 원문(µs) — 넣기가 같은 값으로 다시 본다
    expect(sql).toContain("ba.customer_id = c.id AND ba.status = 'active'");   // 진행 중 고객은 상한 판정 전에 뺀다(Codex 적대 A 1R)
    expect(sql).toContain("be.entry_event_properties->'__entry'->>'src' = 'after'");
    expect(sql).toContain("be.entry_event_properties->'__entry'->>'key' = ae.id::text");
    expect(params[5]).toEqual([B, C]);   // 표식은 뒤 여정 계보 전체에서 본다
    expect(sql).toContain("AND c.store_code = 'X'");   // 작성자 범위
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM journey_executions je WHERE je\.journey_id = ANY\(\$\d+::uuid\[\]\) AND je\.customer_id = c\.id\)/);   // 재진입 불가
    expect(sql).toContain('ORDER BY c.id, ae.completed_at ASC');
    expect(params[params.length - 1]).toBe('50');
  });
  it('감시인데 기준 시각이 비어 있으면 조회 없이 0건(소급 0)', async () => {
    expect(await selectAfterJourneyCandidates(CO, { after_root: A, after_outcome: 'any' }, 10, B, undefined, '', undefined, null)).toEqual([]);
    expect(q).not.toHaveBeenCalled();
  });
  it('미리보기(뒤 여정 id 없음) — 기준 시각 · 표식 없이 최근 7일 · 설정이 틀리면 조회 없이 0건', async () => {
    q.mockResolvedValue({ rows: [] });
    await selectAfterJourneyCandidates(CO, { after_root: A, after_outcome: 'any' }, 10);
    const [sql, params] = q.mock.calls[0];
    expect(sql).not.toContain('last_event_cursor');
    expect(sql).not.toContain("'__entry'");
    expect(params[2]).toEqual(['goal_met', 'completed']);
    q.mockReset();
    expect(await selectAfterJourneyCandidates(CO, { after_outcome: 'any' }, 10)).toEqual([]);
    expect(q).not.toHaveBeenCalled();
  });
});

function mockClient(rules: Array<{ match: RegExp; rows?: any[] }>) {
  const calls: Array<{ text: string; params?: any[] }> = [];
  const client = {
    query: vi.fn(async (text: string, params?: any[]) => {
      calls.push({ text, params });
      const hit = rules.find((r) => r.match.test(text));
      return { rows: hit?.rows ?? [], rowCount: hit?.rows?.length ?? 0 };
    }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(client);
  return calls;
}
const at = (calls: Array<{ text: string }>, re: RegExp) => calls.findIndex((c) => re.test(c.text));
const dbRow = (id: string, over: Record<string, any> = {}) => ({
  id, name: `여정${id.slice(0, 1)}`, status: 'active', trigger_event: 'customer.created', start_kind: 'event', trigger_filters: {},
  goal_exit_enabled: true, archived_at: null, lineage_id: null, entry_closed_at: null, ...over,
});

describe('3. 붙이기 · 떼기', () => {
  beforeEach(() => { q.mockReset(); connect.mockReset(); (dbAcceptsTriggerEvent as any).mockResolvedValue(true); (seedBaselineForJourney as any).mockClear(); });

  it('붙이기 — 계보 잠금 → 행 잠금 → 잠금 안 다시 점검 → 바꿈(시작 사건 · 결과 · 원래 시작 · 켜진 여정 기준 시각 = 지금)', async () => {
    const calls = mockClient([
      { match: /FOR UPDATE/, rows: [{ id: B }] },
      { match: /FROM journeys WHERE company_id = \$1::uuid$/, rows: [dbRow(A), dbRow(B, { trigger_event: 'customer.birthday_approaching', trigger_filters: { days_before: 7, customer_conditions: [{ field: 'grade', op: '==', value: 'VIP' }], logic: 'AND' } })] },
    ]);
    const out = await attachJourney(CO, B, A, 'any');
    expect(out.ok).toBe(true);
    expect(at(calls, /hashtext\('journey-attach'\)/)).toBe(0 + at(calls, /^BEGIN$/) + 1);   // 회사 붙이기 잠금이 맨 먼저(Codex 적대 A 1R)
    expect(at(calls, /hashtext\('journey-attach'\)/)).toBeLessThan(at(calls, /hashtext\('journey-entry'\)/));
    expect(at(calls, /hashtext\('journey-entry'\)/)).toBeLessThan(at(calls, /FOR UPDATE/));
    expect(at(calls, /FOR UPDATE/)).toBeLessThan(at(calls, /UPDATE journeys SET trigger_event/));
    const upd = calls.find((c) => /UPDATE journeys SET trigger_event/.test(c.text))!;
    expect(upd.text).toContain("last_event_cursor = CASE WHEN status = 'active' THEN NOW() ELSE NULL END");
    expect(upd.text).toContain("start_kind = 'event'");
    expect(upd.params?.[2]).toBe('journey.after');
    expect(JSON.parse(upd.params?.[3])).toEqual({
      after_root: A, after_outcome: 'any',
      attach_prev: { trigger_event: 'customer.birthday_approaching', start_kind: 'event', trigger_filters: { days_before: 7, customer_conditions: [{ field: 'grade', op: '==', value: 'VIP' }], logic: 'AND' } },
      start_gen: 1,
      customer_conditions: [{ field: 'grade', op: '==', value: 'VIP' }], logic: 'AND',
    });
    expect(at(calls, /^COMMIT$/)).toBeGreaterThan(-1);
  });
  it('붙이기 — 앞 여정 옛 판 id 를 줘도 계보 대표 판으로 고리를 본다(옛 판으로 고리 검사를 피하지 못한다 · Codex 적대 A 1R)', async () => {
    const A2 = '55555555-5555-4555-8555-555555555555';
    const calls = mockClient([
      { match: /FOR UPDATE/, rows: [{ id: B }] },
      { match: /FROM journeys WHERE company_id = \$1::uuid$/, rows: [
        dbRow(A, { entry_closed_at: '2026-10-19', lineage_id: A }),
        dbRow(A2, { lineage_id: A, trigger_event: 'journey.after', trigger_filters: { after_root: B, after_outcome: 'any' } }),
        dbRow(B),
      ] },
    ]);
    await expect(attachJourney(CO, B, A, 'any')).rejects.toThrow('고리가 생겨요');
    expect(at(calls, /UPDATE journeys SET trigger_event/)).toBe(-1);
  });
  it('붙이기 — 다른 여정에서 옮기면 맨 처음 시작을 그대로 둔다(떼기 = 처음으로)', async () => {
    const calls = mockClient([
      { match: /FOR UPDATE/, rows: [{ id: B }] },
      { match: /FROM journeys WHERE company_id = \$1::uuid$/, rows: [dbRow(A), dbRow(C), dbRow(B, { trigger_event: 'journey.after', trigger_filters: { after_root: C, after_outcome: 'any', start_gen: 3, attach_prev: { trigger_event: 'custom', start_kind: 'standing', trigger_filters: { all_customers: true } } } })] },
    ]);
    await attachJourney(CO, B, A, 'goal_met');
    const upd = calls.find((c) => /UPDATE journeys SET trigger_event/.test(c.text))!;
    expect(JSON.parse(upd.params?.[3]).attach_prev).toEqual({ trigger_event: 'custom', start_kind: 'standing', trigger_filters: { all_customers: true } });
    expect(JSON.parse(upd.params?.[3]).start_gen).toBe(4);   // 붙일 때마다 세대 +1(Codex 적대 A 3R)
  });
  it('붙이기 — 잠금 안 점검에 막히면 되돌리고 409 근거(막음 목록) · 바꾸지 않는다', async () => {
    const calls = mockClient([
      { match: /FOR UPDATE/, rows: [{ id: B }] },
      { match: /FROM journeys WHERE company_id = \$1::uuid$/, rows: [dbRow(A, { goal_exit_enabled: false }), dbRow(B)] },
    ]);
    await expect(attachJourney(CO, B, A, 'goal_met')).rejects.toBeInstanceOf(AttachBlockedError);
    expect(at(calls, /UPDATE journeys SET trigger_event/)).toBe(-1);
    expect(at(calls, /^ROLLBACK$/)).toBeGreaterThan(-1);
  });
  it('점검 행 = 사건 값 연결(칸 · 변형의 @@키@@)을 한 번에 읽어 뒤 여정에 싣는다', async () => {
    const calls = mockClient([
      { match: /FOR UPDATE/, rows: [{ id: B }] },
      { match: /FROM journeys WHERE company_id = \$1::uuid$/, rows: [dbRow(A), dbRow(B)] },
      { match: /alimtalk_variable_map::text/, rows: [{ journey_id: B }] },
    ]);
    await expect(attachJourney(CO, B, A, 'any')).rejects.toThrow('사건 값을 써서');
    const ev = calls.find((c) => /alimtalk_variable_map::text/.test(c.text))!;
    expect(ev.text).toContain('LEFT JOIN journey_step_variants v ON v.step_id = s.id');
    expect(ev.params?.[1]).toBe('@@(order_no|product_name|total_amount|tracking_no|carrier|reservation_no|reservation_date)@@');
    expect(at(calls, /UPDATE journeys SET trigger_event/)).toBe(-1);
  });
  it('붙이기 — DB 가 아직 시작 사건을 받지 않으면(CHECK 교체 전) 연결 전에 503 오류', async () => {
    (dbAcceptsTriggerEvent as any).mockResolvedValue(false);
    await expect(attachJourney(CO, B, A, 'any')).rejects.toBeInstanceOf(JourneyMigrationPendingError);
    expect(connect).not.toHaveBeenCalled();
  });
  it('떼기 — 원래 시작 · 방식 · 필터로(지금 대상 조건 유지) · 켜진 여정 커서 지금 · 가입 여정은 바꾸기 전에 기준선', async () => {
    q.mockResolvedValue({ rows: [{ prev: 'customer.created' }] });
    const calls = mockClient([
      { match: /FOR UPDATE/, rows: [{ status: 'active', trigger_event: 'journey.after', trigger_filters: { after_root: A, after_outcome: 'any', start_gen: 2, customer_conditions: [{ field: 'region', op: '==', value: '서울' }], attach_prev: { trigger_event: 'customer.created', start_kind: 'event', trigger_filters: { recent_hours: 24, customer_conditions: [{ field: 'grade', op: '==', value: 'VIP' }] } } } }] },
    ]);
    const out = await detachJourney(CO, B);
    expect(out.triggerEvent).toBe('customer.created');
    expect(seedBaselineForJourney).toHaveBeenCalledWith(B, CO);
    expect((seedBaselineForJourney as any).mock.invocationCallOrder[0]).toBeLessThan(connect.mock.invocationCallOrder[0]);
    const upd = calls.find((c) => /UPDATE journeys SET trigger_event/.test(c.text))!;
    expect(upd.params?.slice(2, 4)).toEqual(['customer.created', 'event']);
    expect(JSON.parse(upd.params?.[4])).toEqual({ recent_hours: 24, customer_conditions: [{ field: 'region', op: '==', value: '서울' }], start_gen: 3 });   // 떼기도 세대 +1
    expect(upd.text).toContain("last_purchase_cursor = CASE WHEN status = 'active' AND last_purchase_cursor IS NOT NULL THEN NOW() ELSE last_purchase_cursor END");
  });
  it('떼기 — 붙어 있지 않거나 원래 시작이 없으면 막음', async () => {
    q.mockResolvedValue({ rows: [{ prev: null }] });
    mockClient([{ match: /FOR UPDATE/, rows: [{ status: 'draft', trigger_event: 'custom', trigger_filters: {} }] }]);
    await expect(detachJourney(CO, B)).rejects.toThrow('다른 여정 뒤에 붙어 있지 않아요.');
    mockClient([{ match: /FOR UPDATE/, rows: [{ status: 'draft', trigger_event: 'journey.after', trigger_filters: { after_root: A, after_outcome: 'any' } }] }]);
    await expect(detachJourney(CO, B)).rejects.toThrow('되돌릴 원래 시작이 없어요.');
  });
});

describe('4. 지도 — 자리 · 순서 · 선 상태', () => {
  const mj = (id: string, over: Record<string, any> = {}): any => ({
    id, name: `여정${id.slice(0, 1)}`, status: 'active', lane: 'signup', band: 'flow', triggerEvent: 'customer.created', triggerLabel: '신규 가입',
    lineageId: null, attachedAfter: null, goalExitEnabled: true, counts: { activeNow: 0, inProgress: 0, entered: 0, goalMet: 0, completed: 0 }, ...over,
  });
  it('붙인 여정 = 앞 여정 띠 · 열 · 「「앞」 마친 뒤」 · 정보 알림은 정보 띠 그대로 · 앞 여정 없으면 상시 띠', () => {
    const a = mj(A, { lane: 'winback', band: 'flow' });
    const b = mj(B, { triggerEvent: 'journey.after', band: 'standing', lane: 'standing' });
    const info = mj(C, { triggerEvent: 'journey.after', band: 'info', lane: null });
    const lost = mj('44444444-4444-4444-8444-444444444444', { triggerEvent: 'journey.after', band: 'moment', lane: 'moment' });
    const filters = new Map<string, any>([[B, { after_root: A, after_outcome: 'goal_met' }], [C, { after_root: A, after_outcome: 'any' }], [lost.id, { after_root: '55555555-5555-4555-8555-555555555555', after_outcome: 'any' }]]);
    placeAttached([a, b, info, lost], filters, (j: any) => String(j.lineageId || j.id).toLowerCase());
    expect(b.band).toBe('flow');
    expect(b.lane).toBe('winback');
    expect(b.triggerLabel).toBe(`「${a.name}」 마친 뒤`);
    expect(b.attachedAfter).toEqual({ journeyId: A, name: a.name, outcome: 'goal_met', outcomeLabel: '목표를 이뤄 마친 고객' });
    expect(info.band).toBe('info');
    expect(lost.band).toBe('standing');
    expect(lost.attachedAfter.journeyId).toBeNull();
    expect(journeyHealth({ ...lost, windowDays: 30, goalLabel: '구매 확인', graph: { edges: [], exitSlots: [], issues: [] }, broadAudience: false, activationCost: 0, pause: null }, [], []).text).toContain('앞 여정이 없어져');
  });
  it('사슬 A → B → C 는 목록 순서와 무관하게 부모부터 자리를 정한다(Codex 적대 A 1R)', () => {
    const a = mj(A, { lane: 'winback', band: 'flow' });
    const b = mj(B, { triggerEvent: 'journey.after', band: 'standing', lane: 'standing' });
    const c = mj(C, { triggerEvent: 'journey.after', band: 'standing', lane: 'standing' });
    const filters = new Map<string, any>([[B, { after_root: A, after_outcome: 'any' }], [C, { after_root: B, after_outcome: 'any' }]]);
    placeAttached([c, b, a], filters, (j: any) => String(j.lineageId || j.id).toLowerCase());
    expect([b.band, b.lane, c.band, c.lane]).toEqual(['flow', 'winback', 'flow', 'winback']);
    expect(c.triggerLabel).toBe(`「${b.name}」 마친 뒤`);
  });
  it('순서 = 앞 여정 바로 뒤(사슬 깊이 순) · 고리도 빠짐없이', () => {
    const a = mj(A);
    const x = mj('66666666-6666-4666-8666-666666666666');
    const b = mj(B, { attachedAfter: { journeyId: A } });
    const c = mj(C, { attachedAfter: { journeyId: B } });
    expect(orderAttached([c, x, b, a]).map((j) => j.id)).toEqual([x.id, a.id, b.id, c.id]);
    const p = mj('77777777-7777-4777-8777-777777777777', { attachedAfter: { journeyId: '88888888-8888-4888-8888-888888888888' } });
    const r = mj('88888888-8888-4888-8888-888888888888', { attachedAfter: { journeyId: p.id } });
    expect(orderAttached([p, r]).map((j) => j.id).sort()).toEqual([p.id, r.id].sort());
  });
  it('선 상태 = 받는 쪽(초안 · 멈춤) → 보내는 쪽(꺼짐) → 결과(목표 끔 = 새는 선) → 이어짐', () => {
    expect(attachLineState({ status: 'active', goalExitEnabled: true }, { status: 'draft' }, 'any')).toBe('receiver_draft');
    expect(attachLineState({ status: 'active', goalExitEnabled: true }, { status: 'paused' }, 'any')).toBe('receiver_off');
    expect(attachLineState({ status: 'paused', goalExitEnabled: true }, { status: 'active' }, 'any')).toBe('sender_off');
    expect(attachLineState({ status: 'active', goalExitEnabled: false }, { status: 'active' }, 'goal_met')).toBe('leak');
    expect(attachLineState({ status: 'active', goalExitEnabled: false }, { status: 'active' }, 'completed')).toBe('connected');
  });
  it('지도 응답 배선 — 옛 판 접고 정렬한 뒤 자리 · 순서 · 붙인 선(kind attach) · 숫자 = 표식 src after', () => {
    const m = SRC('journey-lifecycle-map.ts');
    expect(m.indexOf('placeAttached(journeys,')).toBeGreaterThan(m.indexOf('journeys.sort((a, b) =>'));
    expect(m).toContain("kind: 'attach',");
    expect(m).toContain("kind: 'contract' as const,");
    expect(m).toContain("if (!ln.toJourneyId || ln.kind === 'attach') continue;");
    expect(m).toContain("COUNT(*) FILTER (WHERE b.entry_event_properties->'__entry'->>'src' = 'after')::int AS handed");
  });
});

describe('5. 만들기 길 차단 · 켜기 검사 · 감시 배선', () => {
  it('붙이기 전용 사건 = 켜기 · 감시는 받고 만들기 · AI 목록 · 프롬프트 표는 받지 않는다', () => {
    expect(isImplementedTriggerEvent('journey.after')).toBe(true);
    expect(isCreatableTriggerEvent('journey.after')).toBe(false);
    expect(isCreatableTriggerEvent('customer.created')).toBe(true);
    expect(aiSelectableTriggerEvents()).not.toContain('journey.after');
    expect(formatTriggerMenuForAi()).not.toContain('journey.after');
    for (const f of ['journey-builder.ts', 'journey-ai-generator.ts']) expect(SRC(f)).toContain('isCreatableTriggerEvent(');
    expect(SRC('journey-ai-editor.ts')).toContain('if (!isCreatableTriggerEvent(triggerEvent)) {');
    expect(fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'ai.ts'), 'utf-8')).toContain('if (preferTriggerEvent && !isCreatableTriggerEvent(String(preferTriggerEvent))) {');
  });
  it('켜기 검사 — 설정이 없으면 켜지 않는다 · 앞 여정 존재 확인 · 첫 켜기 기준 시각', () => {
    expect(validateJourneyEntryConfig({ trigger_event: 'journey.after', allow_reentry: false, reentry_cooldown_days: null, trigger_filters: {}, threshold_recipients_per_step: 100 }))
      .toBe('앞 여정 설정이 없어 켤 수 없어요. 지도에서 다시 붙여 주세요.');
    expect(validateJourneyEntryConfig({ trigger_event: 'journey.after', allow_reentry: false, reentry_cooldown_days: null, trigger_filters: { after_root: A, after_outcome: 'any' }, threshold_recipients_per_step: 100 })).toBeNull();
    const b = SRC('journey-builder.ts');
    expect(b).toContain("return { ok: false, reason: '앞 여정이 없거나 끝나서 켤 수 없어요. 떼거나 다른 여정 뒤에 붙여 주세요.' };");
    // 첫 켜기 기준 시각 = 켜기 트랜잭션 안 · 커서 이어받기 뒤 · COMMIT 앞(Codex 적대 A 1R) · 커밋 뒤 늦은 커서 목록에는 없다
    const at1 = b.indexOf("WHERE id = $1::uuid AND trigger_event = 'journey.after' AND last_event_cursor IS NULL");
    expect(at1).toBeGreaterThan(b.indexOf('INHERIT_ENTRY_CURSORS_SQL, [journeyId]'));
    expect(at1).toBeLessThan(b.indexOf("await actClient.query(inheritConflict ? 'ROLLBACK' : 'COMMIT');"));
    expect(b).not.toContain("'cdp.reservation_created', 'journey.after')");
  });
  it('새 판 커서 이어받기 = 앞 여정을 마치면이면 같은 앞 여정 · 결과일 때만(다른 앞 여정 기준 시각으로 소급 0 · Codex 적대 A 2R)', () => {
    const l = SRC('journey-lineage.ts');
    const inh = l.slice(l.indexOf('export const INHERIT_ENTRY_CURSORS_SQL'), l.indexOf('export const CLOSE_OTHER_VERSIONS_ENTRY_SQL'));
    expect(inh).toContain("AND (n.trigger_event <> 'journey.after'");
    expect(inh).toContain("o.trigger_filters->>'after_root' IS NOT DISTINCT FROM n.trigger_filters->>'after_root'");
    expect(inh).toContain("o.trigger_filters->>'after_outcome' IS NOT DISTINCT FROM n.trigger_filters->>'after_outcome'");
    const ws = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'journey', 'workspace', 'JourneyWorkspace.tsx'), 'utf-8');
    expect(ws).toContain("void load(journeyId, !map, detail ? 'sync' : 'open')");   // 다시 읽기 = 고친 값 유지(Codex 적대 B 2R)
  });
  it('인원 미리 세기 · 미리보기 = 기준 시각 없이 최근 7일(초안이 늘 0명으로 보이지 않게) · 화면 「때」 문구는 붙인 여정에 붙이지 않는다', () => {
    expect(SRC('journey-target-extractor.ts')).toContain('return (await selectAfterJourneyCandidates(companyId, filters, limit, undefined, undefined, scopeSql, consent)).map((x) => x.customerId);');
    const fe = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'utils', 'journey-map.ts'), 'utf-8');
    expect(fe).toContain("export const triggerWhen = (label: string, triggerEvent: string | null | undefined): string => (triggerEvent === 'journey.after' ? label : `${label} 때`);");
  });
  it('감시 — after 갈래가 앞 실행 id 를 표식으로 싣고 상한 판정 뒤 같은 넣기 함수로', () => {
    const w = SRC('journey-trigger-watcher.ts');
    expect(w).toContain("afterProps = Object.fromEntries(rows.map((x) => [x.customerId, { __entry: { src: 'after', key: x.afterExecId } }]));");
    expect(w.indexOf('if (afterProps) return enqueueCandidates(j, ids, afterProps, expect);')).toBeGreaterThan(w.indexOf('대량 진입 감지'));
    // 넣기 · 커서 넣기 · 멈춤 = 같은 시작 설정 조각(시작 사건 · after 면 앞 여정 · 결과 · 기준 시각 원문)으로 쓰기 직전에 다시 본다(Codex 적대 A 1R · 2R)
    expect(w).toContain("sql += ` AND ${a}trigger_filters->>'after_root' = $${n - 2} AND ${a}trigger_filters->>'after_outcome' = $${n - 1} AND ${a}last_event_cursor = $${n}::timestamptz`;");
    // 세대(start_gen) 비교 — 붙였다 떼는 왕복도 가른다(Codex 적대 A 3R)
    expect(w).toContain("let sql = ` AND ${a}trigger_event = $${params.length - 1} AND COALESCE((${a}trigger_filters->>'start_gen')::int, 0) = $${params.length}::int`;");
    expect((w.match(/if \(!fresh\.open \|\| !\(await startStillSame\(client, j, expect\)\)\) \{/g) || []).length).toBe(2);
    // 커서 전진(후보 0건 · 넣은 뒤) = 같은 조각을 붙인 문장만
    expect(w).toContain('const guardedCursorSql = cursorSql + startSameSql(guardedParams, expect);');
    expect(w).toContain('await query(guardedCursorSql, guardedParams);');
    expect(w).toContain('await client.query(guardedCursorSql, guardedParams);');
    expect(w).not.toContain('await query(cursorSql, cursorParams);');
    expect(w).not.toContain('await client.query(cursorSql, cursorParams);');
    expect((w.match(/WHERE id = \$1::uuid AND company_id = \$2::uuid AND status = 'active'\$\{startSameSql\(params, expect\)\}/g) || []).length).toBe(2);   // 멈춤 UPDATE · 잠금 안 확인 SELECT 가 같은 조각
    expect((w.match(/await pauseJourneyForCompany\(/g) || []).length).toBe(5);
    expect((w.match(/pauseJourneyForCompany\([\s\S]{0,260}?(startExpectOf\(j\)|\n\s+expect,\n)/g) || []).length).toBe(5);   // 멈춤 다섯 자리 모두 같은 시작 설정(세대 포함)
    expect(w).toContain('if (!paused) return { matched: ids.length, enqueued: 0, skipped: ids.length };');
    expect(w).toContain("AND jm.entry_event_properties->'__entry'->>'key' = t.props->'__entry'->>'key')");
    expect(w).toContain(')${afterGuard}');
    expect(w.indexOf('const fresh = await lockLineageEntry(client, j.id);')).toBeLessThan(w.indexOf(')${afterGuard}'));
    expect(w).toContain('last_event_cursor::text AS cursor FROM journeys');
  });
});
