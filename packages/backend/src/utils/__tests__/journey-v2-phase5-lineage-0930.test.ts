/**
 * 여정 V2 5차 — 새 판 · 계보 · 진입 닫기 (2026-09-30 · 설계서 §8)
 *
 * 못 박는 것:
 *   - DDL(lineage_id · entry_closed_at) 전 = 옛 동작 그대로(조각 없음 · 계보 = 자기 · 안티조인 문장 동일)
 *   - 새 판을 켜면 같은 트랜잭션에서 옛 판 진입을 닫는다(DDL 전이면 닫기 문장 없음)
 *   - 재진입 판정은 계보 단위(옛 판 진행 중 고객 이중 진입 0 · 상시 여정은 옛 판이 보낸 고객 재발송 0)
 *   - 진입 워커 · 재진입 워커 · 날짜 예약은 진입 열린 여정만 · 옛 판은 다 끝나면 ended
 *   - 새 판 = 상태 · 통계 · 커서 · 승인 비운 복제 초안 · 같은 계보 초안이 있으면 그것 · 링크 조건 칸 id 재연결
 *   - 지도: 진입 닫힌 옛 판은 현재 판 카드에 접힌다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../company-data-profile', () => ({ getCompanyJourneyFacts: vi.fn() }));

import { query, pool } from '../../config/database';
import { getCompanyJourneyFacts } from '../company-data-profile';
import { lineageColumnsReady, entryOpenClause, lineageJourneyIds, resetLineageCache, createNewVersion, CLOSE_OTHER_VERSIONS_ENTRY_SQL } from '../journey-lineage';
import { buildReentryAntiJoin } from '../journey-safety-filter';
import { buildLifecycleMap } from '../journey-lifecycle-map';

const q = query as unknown as ReturnType<typeof vi.fn>;
const connect = (pool as any).connect as ReturnType<typeof vi.fn>;
const facts = getCompanyJourneyFacts as unknown as ReturnType<typeof vi.fn>;
const SRC = (f: string) => readFileSync(resolve(process.cwd(), 'src/utils', f), 'utf8');

beforeEach(() => { q.mockReset(); connect.mockReset(); facts.mockReset(); resetLineageCache(); });

describe('DDL 전 = 옛 동작', () => {
  it('컬럼이 없으면 조각 없음 · 계보 = 자기', async () => {
    q.mockResolvedValue({ rows: [{ n: 0 }] });
    expect(await lineageColumnsReady()).toBe(false);
    expect(await entryOpenClause()).toBe('');
    expect(await lineageJourneyIds('J')).toEqual(['J']);
  });
  it('컬럼이 생기면 진입 열림 조각 · 계보 목록', async () => {
    q.mockImplementation(async (sql: string) => {
      if (/information_schema/.test(sql)) return { rows: [{ n: 2 }] };
      if (/j2\.lineage_id = j1\.lineage_id/.test(sql)) return { rows: [{ id: 'J' }, { id: 'OLD' }] };
      return { rows: [] };
    });
    expect(await entryOpenClause('j')).toBe(' AND j.entry_closed_at IS NULL');
    expect(await lineageJourneyIds('J')).toEqual(['J', 'OLD']);
  });
  it('안티조인: 계보가 자기뿐이면 문장이 옛것과 같다 · 계보면 ANY + 쿨다운 0 도 다른 판 진행 중 제외', () => {
    const p1: any[] = []; const p2: any[] = [];
    expect(buildReentryAntiJoin('c', p1, 'J', false, 0)).toBe(buildReentryAntiJoin('c', p2, 'J', false, 0, ['J']));
    expect(buildReentryAntiJoin('c', [], 'J', true, 0, ['J'])).toBe('');
    const p3: any[] = [];
    const s3 = buildReentryAntiJoin('c', p3, 'J', true, 0, ['J', 'OLD']);
    expect(s3).toContain('ANY(');
    expect(s3).toContain("je.status = 'active'");
    expect(p3).toEqual([['OLD']]);
    const p4: any[] = [];
    expect(buildReentryAntiJoin('c', p4, 'J', false, 0, ['J', 'OLD'])).toContain('ANY(');
    expect(p4).toEqual([['J', 'OLD']]);
  });
});

describe('워커 배선(원문)', () => {
  it('진입 워커 · 재진입 워커 · 날짜 예약은 진입 열린 여정만 · 진입 워커는 옛 판 마무리를 확인한다', () => {
    const w = SRC('journey-trigger-watcher.ts');
    expect(w).toMatch(/COALESCE\(start_kind, 'event'\) IN \('event', 'standing'\)\$\{await entryOpenClause\(\)\}/);
    expect(w).toContain('endDrainedVersions()');
    expect(SRC('journey-reentry-worker.ts')).toMatch(/status = 'active'\$\{await entryOpenClause\(\)\}/);
    expect(SRC('journey-anchor-scheduler.ts')).toMatch(/start_kind = 'date_anchor'\$\{await entryOpenClause\(\)\}/);
  });
  it('재진입 판정 · 상시 중복 제거 · 일괄 진입 가드가 계보를 본다', () => {
    const w = SRC('journey-trigger-watcher.ts');
    const cd = w.slice(w.indexOf('async function checkCooldown'));
    expect(cd).toContain('journey_id = ANY($1::uuid[])');
    expect(cd).toContain("status = 'active' LIMIT 1");
    expect(w).toContain('je.journey_id = ANY($6::uuid[])');
    const ex = SRC('journey-target-extractor.ts');
    expect((ex.match(/reentry\.lineageIds\)/g) || []).length).toBe(7);
    expect(ex).toContain("reentry?.lineageIds && reentry.lineageIds.length > 1");
  });
});

describe('새 판을 켜면 옛 판 진입 닫기(한 트랜잭션)', () => {
  it('활성화 UPDATE 와 닫기가 같은 트랜잭션 · 컬럼 없으면 닫기 없음', () => {
    const b = SRC('journey-builder.ts');
    const fn = b.slice(b.indexOf('export async function activateJourney'), b.indexOf('async function createJourneyStepSnapshots') > 0 ? b.indexOf('async function createJourneyStepSnapshots') : undefined);
    const begin = fn.indexOf("actClient.query('BEGIN')");
    const upd = fn.indexOf("status = 'active',");
    const close = fn.indexOf('CLOSE_OTHER_VERSIONS_ENTRY_SQL');
    // ★ 0930 Codex 4R — 커밋 문장은 이어받기 충돌이면 되돌림으로 바뀐다(같은 줄).
    const commit = fn.indexOf("inheritConflict ? 'ROLLBACK' : 'COMMIT'");
    expect(begin).toBeGreaterThan(-1);
    expect(upd).toBeGreaterThan(begin);
    expect(close).toBeGreaterThan(upd);
    expect(commit).toBeGreaterThan(close);
    expect(fn).toContain('if (r.rows.length > 0 && closeOthers)');
  });
  it('닫기 문장 = 같은 계보 · 같은 회사 · 다른 판 · 켜짐/멈춤 · 아직 열린 것만', () => {
    expect(CLOSE_OTHER_VERSIONS_ENTRY_SQL).toContain('o.lineage_id = n.lineage_id');
    expect(CLOSE_OTHER_VERSIONS_ENTRY_SQL).toContain('o.company_id = n.company_id');
    expect(CLOSE_OTHER_VERSIONS_ENTRY_SQL).toContain('o.id <> n.id');
    expect(CLOSE_OTHER_VERSIONS_ENTRY_SQL).toContain("o.status IN ('active', 'paused')");
    expect(CLOSE_OTHER_VERSIONS_ENTRY_SQL).toContain('o.entry_closed_at IS NULL');
  });
});

describe('새 판 만들기', () => {
  function client(rules: Array<{ match: RegExp; rows: any[] }>) {
    const calls: Array<{ text: string; params?: any[] }> = [];
    const c = { query: vi.fn(async (text: string, params?: any[]) => { calls.push({ text, params }); const hit = rules.find((r) => r.match.test(text)); return { rows: hit?.rows ?? [] }; }), release: vi.fn() };
    connect.mockResolvedValue(c);
    return calls;
  }
  beforeEach(() => { resetLineageCache(true); q.mockResolvedValue({ rows: [{ n: 0 }] }); });
  it('켜짐 여정 → 상태 · 통계 · 커서 · 승인을 비운 복제 초안 · 계보 = 원 여정', async () => {
    const calls = client([
      { match: /SELECT id, name, status, archived_at, lineage_id, entry_closed_at FROM journeys/, rows: [{ id: 'J', name: '환영', status: 'active', archived_at: null, lineage_id: null }] },
      { match: /status = 'draft' AND archived_at IS NULL/, rows: [] },
      { match: /information_schema\.columns/, rows: ['id', 'status', 'name', 'stats_total_entered', 'last_event_cursor', 'last_purchase_cursor_id', 'approved_at', 'entry_baseline_at', 'lineage_id'].map((c) => ({ column_name: c, data_type: 'x' })) },
      { match: /INSERT INTO journey_steps/, rows: [{ id: 'N1', step_order: 1 }, { id: 'N2', step_order: 2 }] },
      { match: /SELECT id, step_order FROM journey_steps WHERE journey_id/, rows: [{ id: 'O1', step_order: 1 }, { id: 'O2', step_order: 2 }] },
      { match: /condition_jsonb->>'type' = 'step_link_clicked'/, rows: [{ id: 'N2', condition_jsonb: { type: 'step_link_clicked', step_id: 'O1', clicked: true } }] },
    ]);
    const r = await createNewVersion('C', 'J');
    expect(r.existing).toBe(false);
    expect(r.stepsCopied).toBe(2);
    const ins = calls.find((c) => /INSERT INTO journeys SELECT/.test(c.text))!;
    const ov = JSON.parse(ins.params![1]);
    expect(ov).toMatchObject({ status: 'draft', lineage_id: 'J', stats_total_entered: 0, last_event_cursor: null, last_purchase_cursor_id: null, approved_at: null, entry_baseline_at: null, name: '환영 (새 판)' });
    expect(calls.some((c) => /UPDATE journeys SET lineage_id = id/.test(c.text))).toBe(true);
    const remap = calls.find((c) => /UPDATE journey_steps SET condition_jsonb/.test(c.text))!;
    expect(JSON.parse(remap.params![1]).step_id).toBe('N1');
    expect(calls.some((c) => c.text === 'COMMIT')).toBe(true);
  });
  it('같은 계보 초안 새 판이 있으면 그것 · 초안에는 새 판을 만들지 않는다', async () => {
    client([
      { match: /SELECT id, name, status, archived_at, lineage_id, entry_closed_at FROM journeys/, rows: [{ id: 'J', name: '환영', status: 'paused', archived_at: null, lineage_id: 'L' }] },
      { match: /status = 'draft' AND archived_at IS NULL/, rows: [{ id: 'D' }] },
    ]);
    expect(await createNewVersion('C', 'J')).toMatchObject({ journeyId: 'D', existing: true });
    client([{ match: /SELECT id, name, status, archived_at, lineage_id, entry_closed_at FROM journeys/, rows: [{ id: 'J', name: 'x', status: 'draft', archived_at: null, lineage_id: null }] }]);
    await expect(createNewVersion('C', 'J')).rejects.toThrow('초안은 그대로');
  });
});

describe('지도: 옛 판은 현재 판 카드에 접힌다', () => {
  it('진입 닫힌 켜진 옛 판 = 레인에서 빠지고 새 판 카드의 olderVersions', async () => {
    resetLineageCache(true);
    facts.mockResolvedValue({ canJudgeNewCustomer: true, hasRecentPurchaseDate: true, hasBirthday: true, hasPoints: true, hasGrade: true, hasGradeOrder: true, hasPurchaseEvents: true, hasCartEvents: true, hasBrowseEvents: true, hasShippedEvents: true });
    const J = (id: string, over: Record<string, any>) => ({ id, name: id, status: 'active', trigger_event: 'customer.created', trigger_filters: {}, start_kind: 'event', goal_exit_enabled: true, goal_kind: 'purchase', allow_reentry: false, auto_reentry_enabled: false, updated_at: null, lineage_id: 'L', entry_closed_at: null, ...over });
    q.mockImplementation(async (sql: string) => {
      if (/FROM journeys\s+WHERE company_id/.test(sql)) return { rows: [J('OLD', { entry_closed_at: '2026-09-30' }), J('NEW', {})] };
      if (/FROM journey_steps\s+WHERE journey_id = ANY/.test(sql)) return { rows: [{ id: 'o1', journey_id: 'OLD', step_order: 1, step_type: 'message', delay_hours: 0, channel: 'lms', is_ad: true }, { id: 'n1', journey_id: 'NEW', step_order: 1, step_type: 'message', delay_hours: 0, channel: 'lms', is_ad: true }] };
      if (/COUNT\(\*\) FILTER \(WHERE status = 'active'\)::int AS active_now/.test(sql)) return { rows: [{ journey_id: 'OLD', active_now: 7, entered_30d: 0, goal_met_30d: 0, completed_30d: 0 }] };
      return { rows: [] };
    });
    const m = await buildLifecycleMap('C');
    expect(m.journeys.map((j) => j.id)).toEqual(['NEW']);
    expect(m.journeys[0].olderVersions).toEqual([{ id: 'OLD', name: 'OLD', status: 'active', activeNow: 7 }]);
    expect(m.journeys[0].canNewVersion).toBe(true);
  });
});
