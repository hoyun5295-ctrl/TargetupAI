/**
 * 엔진 재설계 E2 · E1-3 — 회사 격리 · 공정 처리 · 늦게 처리해도 버리지 않음(★ 2026-11-02 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md)
 *
 * 못 박는 것:
 *   - 회사 섞기 = 회사마다 원래 순서 · 한 회사에 하나씩 번갈아(한 회사 여정 40개가 회차 예산을 다 차지하지 않는다)
 *   - 회사 줄 = 같은 회사는 차례(예산 · 잔액 · 피로도 판정 그대로) · 회사끼리 동시 상한 · 한 줄 실패가 다른 줄을 막지 않는다
 *   - 스팸 검사 큐 = 사람 줄 먼저(3건 연달아면 자동 1건) · 줄 안 회사 돌아가며(A사 1,000건 뒤에 B사 1건이 줄 서지 않는다)
 *   - 실행기 · 진입 감시 · 날짜 기준 · 재진입 · 자동마케팅이 그 함수를 쓴다(배선 = 소스 계약)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { interleaveByCompany, runCompanyLanes } from '../concurrency';
import { pickNextSpamTest, SPAM_HUMAN_STREAK_MAX, type SpamQueueHead, type SpamQueueCursor } from '../spam-test-queue';
import { rotateFrom } from '../journey-trigger-watcher';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('E2-2 회사 섞기(interleaveByCompany)', () => {
  it('회사마다 원래 순서 · 한 회사에 하나씩 번갈아 · 회사 순서 = 첫 항목이 나온 순서', () => {
    const items = ['A1', 'A2', 'A3', 'B1', 'C1', 'C2'].map((id) => ({ id, co: id[0] }));
    expect(interleaveByCompany(items, (x) => x.co).map((x) => x.id)).toEqual(['A1', 'B1', 'C1', 'A2', 'C2', 'A3']);
    expect(interleaveByCompany([], (x: any) => x.co)).toEqual([]);
  });
  it('이어서(rotateFrom) = 멈춘 여정부터 한 바퀴 · 목록에 없으면 처음부터', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    expect(rotateFrom(list, 'c').map((x) => x.id)).toEqual(['c', 'd', 'a', 'b']);
    expect(rotateFrom(list, 'z').map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rotateFrom(list, null).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('E2-1 회사 줄(runCompanyLanes)', () => {
  it('같은 회사 = 차례(겹침 0) · 회사끼리 = 동시(상한까지) · 모두 처리', async () => {
    const running = new Map<string, number>();
    let maxSame = 0;
    let maxAll = 0;
    let all = 0;
    const done: string[] = [];
    const items = ['A', 'A', 'A', 'B', 'B', 'C', 'D', 'E'].map((co, i) => ({ co, i }));
    await runCompanyLanes(items, (x) => x.co, 3, async (x) => {
      running.set(x.co, (running.get(x.co) || 0) + 1);
      all++;
      maxSame = Math.max(maxSame, running.get(x.co)!);
      maxAll = Math.max(maxAll, all);
      await new Promise((r) => setTimeout(r, 5));
      running.set(x.co, running.get(x.co)! - 1);
      all--;
      done.push(`${x.co}${x.i}`);
    });
    expect(maxSame).toBe(1);
    expect(maxAll).toBe(3);
    expect(done.filter((d) => d.startsWith('A'))).toEqual(['A0', 'A1', 'A2']);
    expect(done).toHaveLength(items.length);
  });
  it('한 회사 줄이 던져도 다른 회사 줄은 끝까지 · 첫 오류를 끝에 던진다', async () => {
    const done: string[] = [];
    await expect(runCompanyLanes([{ co: 'A' }, { co: 'B' }, { co: 'B' }], (x) => x.co, 1, async (x) => {
      if (x.co === 'A') throw new Error('A 실패');
      done.push(x.co);
    })).rejects.toThrow('A 실패');
    expect(done).toEqual(['B', 'B']);
  });
});

describe('E2-4 스팸 검사 큐 = 줄 + 회사 돌아가며(pickNextSpamTest)', () => {
  const run = (queues: Record<string, Array<{ co: string; lane: 0 | 1 }>>, n: number) => {
    // queues = 회사 · 줄마다 남은 검사(머리만 heads 로 보인다)
    const q = Object.entries(queues).flatMap(([k, v]) => v.map((x, i) => ({ id: `${k}-${i}`, companyId: x.co, lane: x.lane })));
    let cursor: SpamQueueCursor = { lastCompany: [null, null], humanStreak: 0 };
    const order: string[] = [];
    for (let i = 0; i < n; i++) {
      const heads: SpamQueueHead[] = [];
      for (const t of q) if (!heads.some((h) => h.companyId === t.companyId && h.lane === t.lane)) heads.push(t);
      const r = pickNextSpamTest(heads, cursor);
      if (!r.pick) break;
      cursor = r.cursor;
      order.push(r.pick.companyId + (r.pick.lane === 0 ? 'h' : 'a'));
      q.splice(q.findIndex((t) => t.id === r.pick!.id), 1);
    }
    return order;
  };
  it('A사 1,000건 + B사 1건(같은 자동 줄) = B 가 두 번째', () => {
    const order = run({ a: Array.from({ length: 1000 }, () => ({ co: 'A', lane: 1 as const })), b: [{ co: 'B', lane: 1 }] }, 3);
    expect(order).toEqual(['Aa', 'Ba', 'Aa']);
  });
  it(`사람 줄이 계속 들어와도 ${SPAM_HUMAN_STREAK_MAX + 1}번째마다 자동 1건(자동 줄 굶김 0)`, () => {
    const order = run({ h: Array.from({ length: 20 }, () => ({ co: 'H', lane: 0 as const })), a: Array.from({ length: 5 }, () => ({ co: 'X', lane: 1 as const })) }, 8);
    expect(order).toEqual(['Hh', 'Hh', 'Hh', 'Xa', 'Hh', 'Hh', 'Hh', 'Xa']);
  });
  it('자동 줄이 비면 사람 줄을 계속 · 둘 다 비면 없음', () => {
    expect(run({ h: Array.from({ length: 5 }, () => ({ co: 'H', lane: 0 as const })) }, 5)).toEqual(['Hh', 'Hh', 'Hh', 'Hh', 'Hh']);
    expect(pickNextSpamTest([], { lastCompany: [null, null], humanStreak: 0 }).pick).toBeNull();
  });
  it('줄 안 = 회사 id 순 회전(끝이면 처음)', () => {
    const order = run({ c: [{ co: 'C', lane: 1 }, { co: 'C', lane: 1 }], a: [{ co: 'A', lane: 1 }, { co: 'A', lane: 1 }], b: [{ co: 'B', lane: 1 }] }, 5);
    expect(order).toEqual(['Aa', 'Ba', 'Ca', 'Aa', 'Ca']);
  });
});

describe('배선(소스 계약)', () => {
  it('실행기 = 묶음을 회사 줄로(JOURNEY_EXECUTOR_CONCURRENCY) · processExecution 그대로', () => {
    const ex = read('journey-executor.ts');
    expect(ex).toMatch(/export const JOURNEY_EXECUTOR_CONCURRENCY = 4;/);
    expect(ex).toContain('await runCompanyLanes(dueRes.rows as ExecutionRow[], (r) => String(r.company_id), JOURNEY_EXECUTOR_CONCURRENCY, async (row) => {');
    expect(ex).not.toMatch(/for \(const row of dueRes\.rows as ExecutionRow\[\]\) \{\n\s+pickedThisTick\.push/);
  });
  it('진입 감시 = 회사 섞기 · 이어서 · 4분 예산 · 사건 · 원장 문 = 여정 몫 20초 안 이어 읽기', () => {
    const w = read('journey-trigger-watcher.ts');
    expect(w).toContain('rotateFrom(interleaveByCompany(activeRes.rows as ActiveJourney[], (x) => String(x.company_id)), _watcherResumeAt)');
    expect(w).toMatch(/export const WATCHER_TICK_BUDGET_MS = 4 \* 60 \* 1000;/);
    expect(w).toMatch(/export const JOURNEY_DOOR_SLICE_MS = 20 \* 1000;/);
    expect(w).toContain('await drainCursorDoor(() => processCdpCursorJourney(j, cursorEvent))');
    expect(w).toContain('await drainCursorDoor(() => processPurchaseLedgerJourney(j))');
    expect(w).toContain('if (!r.truncated || !r.advanced || Date.now() - startedAt >= JOURNEY_DOOR_SLICE_MS) return sum;');
  });
  it('날짜 기준 · 재진입 = 회사 섞기', () => {
    expect(read('journey-anchor-scheduler.ts')).toContain('const ordered = interleaveByCompany(jres.rows as AnchorJourneyRow[], (x) => String(x.company_id));\n    for (const j of ordered) {');
    expect(read('journey-reentry-worker.ts')).toContain('const ordered = interleaveByCompany(journeyRes.rows as any[], (x) => String(x.company_id));\n    for (const j of ordered) {');
  });
  it('자동마케팅 = 발송 패스 자기 가드 · 생성 중 운영자 제외(LIMIT 앞) · 제안 생성 = 회사 줄', () => {
    const op = read('continuous-operator.ts');
    const worker = op.slice(op.indexOf('export async function runOperatorWorker('), op.indexOf('export async function dueScheduledProposals('));
    expect(worker).not.toContain('await runAutoSendPass()');
    expect(worker).toContain('await runCompanyLanes(dueRes.rows as Array<{ id: string; company_id: string }>, (r) => String(r.company_id), OPERATOR_GENERATE_CONCURRENCY,');
    expect(op).toContain('void runAutoSendPassTick();');
    expect(op).toContain('AND operator_id <> ALL($2::uuid[])');
    expect(op).toContain('const due = await dueScheduledProposals(limit, [...generatingOperators.keys()]);');
    const gen = op.slice(op.indexOf('export async function generateProposalForOperator('), op.indexOf('async function generateProposalForOperatorRound('));
    expect(gen).toMatch(/generatingOperators\.set\(operatorId[\s\S]*finally[\s\S]*generatingOperators\.delete\(operatorId\)/);
  });
  it('스팸 큐 = 머리(줄 · 회사) → pickNextSpamTest · 옛 created_at FIFO 한 줄 0', () => {
    const q = read('spam-test-queue.ts');
    const p = q.slice(q.indexOf('export async function processSpamTestQueue('), q.indexOf('async function executeSpamTest('));
    expect(p).toContain('const picked = pickNextSpamTest(await spamQueueHeads(), _spamQueueCursor);');
    expect(p).not.toMatch(/WHERE status = 'queued'\s+ORDER BY created_at ASC\s+LIMIT 1/);
  });
});
