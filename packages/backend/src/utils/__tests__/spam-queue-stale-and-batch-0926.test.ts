/**
 * 스팸 검사 큐 — 멈춘 검사 정리 · 시간 초과 기준 · 배치 판정 (★2026-09-26 한줄로 V2 F45·F46·F47·F48)
 *
 * F45·F46 큐 워커가 "active가 있으면 반환"을 먼저 해 그 아래 멈춘 active 정리에 영영 닿지 못했다(재기동으로 폴러가 사라진 행 하나가 큐 전체를 멈춤).
 * F46② 수동 검사의 전역 정리가 등록 시각 기준 60초라, 오래 기다렸다 막 시작한 큐 검사를 timeout으로 닫았다.
 * F47 큐 검사의 시간 초과를 등록 시각으로 재서, 오래 기다린 검사가 첫 폴링에서 거짓 BLOCKED로 확정됐다.
 * F48 배치 판정이 판정 대기(NULL)를 버려, 한 통신사만 통과해도 전체 pass였다(차단 판정은 유예 뒤라 늘 늦다).
 * 처방: 정리 CT(cleanupStaleActiveTests) — 기준 = 실행 시작 시각(큐가 활성화할 때 프로세스 메모리에 기록 · 없으면 등록 시각:
 *       수동 검사는 등록 즉시 active라 같고, 재기동 전 행은 폴러가 이미 사라졌다) · 큐 워커는 정리 먼저 · 수동 라우트도 같은 CT ·
 *       폴러의 시간 초과도 실행 시작 시각 · 배치 판정은 NULL이 남으면 pending(차단이 이미 있으면 blocked) · 완료인데 NULL이면 timeout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const state: any = { active: [] as any[], tests: [] as any[], results: {} as Record<string, any[]>, updates: [] as any[] };
const queryMock = vi.fn(async (sql: string, params?: any[]) => {
  const s = String(sql);
  if (s.includes("FROM spam_filter_tests WHERE status = 'active'") && s.includes('created_at')) return { rows: state.active };
  if (s.includes('FROM spam_filter_tests') && s.includes('WHERE batch_id = $1')) return { rows: state.tests };
  if (s.includes('FROM spam_filter_test_results') && s.includes('WHERE test_id = $1')) return { rows: state.results[params![0]] || [] };
  if (s.startsWith('UPDATE')) { state.updates.push({ sql: s, params }); return { rows: [], rowCount: 1 }; }
  return { rows: [] };
});
vi.mock('../../config/database', () => ({ default: { query: vi.fn() }, query: (...a: any[]) => (queryMock as any)(...a), mysqlQuery: vi.fn(async () => []) }));

import { cleanupStaleActiveTests, getSpamTestBatchResults } from '../spam-test-queue';

beforeEach(() => { state.active = []; state.tests = []; state.results = {}; state.updates = []; queryMock.mockClear(); });

describe('cleanupStaleActiveTests', () => {
  it('실행 시작 기록이 없는 active는 등록 시각으로 재서 기준을 넘으면 timeout·completed로 닫는다', async () => {
    state.active = [
      { id: 'old', created_at: new Date(Date.now() - 120_000) },
      { id: 'fresh', created_at: new Date(Date.now() - 10_000) },
    ];
    expect(await cleanupStaleActiveTests(60_000)).toBe(1);
    const closed = state.updates.filter((u: any) => u.sql.includes("SET status = 'completed'"));
    expect(closed).toHaveLength(1);
    expect(closed[0].params[0]).toEqual(['old']);
  });

  it('닫을 것이 없으면 쓰지 않는다', async () => {
    state.active = [{ id: 'fresh', created_at: new Date() }];
    expect(await cleanupStaleActiveTests(60_000)).toBe(0);
    expect(state.updates).toHaveLength(0);
  });
});

describe('getSpamTestBatchResults — 판정 대기를 버리지 않는다', () => {
  const run = async (status: string, results: (string | null)[]) => {
    state.tests = [{ id: 't1', variant_id: 'A', status }];
    state.results = { t1: results.map((r, i) => ({ carrier: `c${i}`, message_type: 'SMS', result: r })) };
    return (await getSpamTestBatchResults('b1')).variants[0].overallResult;
  };

  it('진행 중 + 한 곳 통과 + 한 곳 대기 = pending(통과 아님)', async () => {
    expect(await run('active', ['pass', null])).toBe('pending');
  });

  it('진행 중이라도 차단이 이미 있으면 blocked', async () => {
    expect(await run('active', ['blocked', null])).toBe('blocked');
  });

  it('완료인데 대기가 남았으면 timeout(통과 아님)', async () => {
    expect(await run('completed', ['pass', null])).toBe('timeout');
  });

  it('모두 통과면 pass', async () => {
    expect(await run('completed', ['pass', 'pass'])).toBe('pass');
  });
});

describe('순서 · 기준 시각(소스 계약)', () => {
  const src = readFileSync(join(__dirname, '..', 'spam-test-queue.ts'), 'utf8');
  const manual = readFileSync(join(__dirname, '..', '..', 'routes', 'spam-filter.ts'), 'utf8');
  const worker = src.slice(src.indexOf('export async function processSpamTestQueue('), src.indexOf('async function executeSpamTest('));

  it('큐 워커는 정리를 먼저 하고 active 확인을 뒤에 한다', () => {
    expect(worker.indexOf('await cleanupStaleActiveTests(TIMEOUTS.spamFilterSafety);')).toBeGreaterThan(0);
    expect(worker.indexOf('await cleanupStaleActiveTests(TIMEOUTS.spamFilterSafety);')).toBeLessThan(worker.indexOf("SELECT id FROM spam_filter_tests WHERE status = 'active' LIMIT 1"));
  });

  it('큐가 활성화할 때 실행 시작 시각을 기록하고, 폴러의 시간 초과는 그 시각으로 잰다', () => {
    expect(worker).toContain('_activatedAt.set(test.id, Date.now());');
    expect(src).toContain('const elapsed = Date.now() - activatedAt;');
    expect(src).not.toContain('const elapsed = Date.now() - new Date(activeCheck.rows[0].created_at).getTime();');
  });

  it('수동 검사 라우트도 같은 정리 CT를 쓴다(등록 시각 기준 전역 정리 제거)', () => {
    expect(manual).toContain('await cleanupStaleActiveTests(TEST_TIMEOUT_MS);');
    expect(manual).not.toMatch(/WHERE status = 'active' AND created_at < NOW\(\) - INTERVAL/);
  });
});
