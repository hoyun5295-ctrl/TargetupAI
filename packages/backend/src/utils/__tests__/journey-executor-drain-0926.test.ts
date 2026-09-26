/**
 * 여정 실행기 = 한 주기에 밀린 것을 비우고, 한 회사가 다른 회사를 막지 않는다 (★2026-09-26 한줄로 V2 F39)
 *
 * 옛: 5분마다 전 회사 합쳐 next_run_at 순 100건만 처리 → 하루 최대 2.9만 건 · 한 회사의 대량 진입이 다른 회사 여정을 몇 시간씩 밀었다.
 * 처방: 한 주기 안에서 시간 예산(4분 · 주기 5분보다 짧게 = 겹침 없음) 동안 100건 묶음을 반복해 비운다.
 *   묶음마다 회사당 상한(25) — 큰 회사가 묶음을 독차지하지 않는다(다음 묶음에서 이어 받는다).
 *   이번 주기에 이미 집은 실행은 다시 집지 않는다 — 실패해 next_run_at이 그대로인 행이 같은 주기에 되풀이되지 않게(옛과 같이 다음 주기 재시도).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'journey-executor.ts'), 'utf8');
const fn = src.slice(src.indexOf('export async function runJourneyExecutor('), src.indexOf('export function startJourneyExecutor('));

describe('여정 실행기 비우기', () => {
  it('시간 예산 안에서 묶음을 반복한다', () => {
    expect(src).toContain('const JOURNEY_TICK_BUDGET_MS = 4 * 60 * 1000;');
    expect(fn).toContain('while (Date.now() - tickStartedAt < JOURNEY_TICK_BUDGET_MS) {');
  });
  it('묶음마다 회사당 상한', () => {
    expect(fn).toContain('ROW_NUMBER() OVER (PARTITION BY j.company_id ORDER BY e.next_run_at ASC)');
    expect(fn).toContain('WHERE due.company_rank <= $2');
  });
  it('이번 주기에 이미 집은 실행은 다시 집지 않는다', () => {
    expect(fn).toContain('AND NOT (e.id = ANY($1::uuid[]))');
    expect(fn).toContain('pickedThisTick.push(row.execution_id);');
  });
  it('주기(5분)는 예산(4분)보다 길다 = 겹치지 않는다', () => {
    expect(src).toContain('const intervalMs = 5 * 60 * 1000;');
  });
});
