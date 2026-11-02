/**
 * 여정 실행기 = 한 주기에 밀린 것을 비우고, 한 회사가 다른 회사를 막지 않는다 (★2026-09-26 한줄로 V2 F39)
 *
 * 옛: 5분마다 전 회사 합쳐 next_run_at 순 100건만 처리 → 하루 최대 2.9만 건 · 한 회사의 대량 진입이 다른 회사 여정을 몇 시간씩 밀었다.
 * 처방: 한 주기 안에서 시간 예산(4분 · 주기 5분보다 짧게 = 겹침 없음) 동안 100건 묶음을 반복해 비운다.
 *   묶음마다 회사당 상한(25) — 큰 회사가 묶음을 독차지하지 않는다(다음 묶음에서 이어 받는다).
 *   이번 주기에 이미 집은 실행은 다시 집지 않는다 — 실패해 next_run_at이 그대로인 행이 같은 주기에 되풀이되지 않게(옛과 같이 다음 주기 재시도).
 *   ★ 2026-11-02 묶음 발송(설계서 3-3 ①) — 고르기 = 묶음 먼저: (여정 · 칸) 집계 · 회사 대표 하나 · 회사 순환 열쇠 · 차례마다 회사 줄 수만큼.
 *     「회사당 상한」= 한 차례에 회사 하나는 묶음 하나 · 「다시 안 집기」= 이번 회차에 다 본 묶음(doneGroups) 키.
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
  it('차례마다 회사당 묶음 하나 · 회사 순환(오래 못 받은 회사 먼저)', () => {
    expect(fn).toContain('SELECT DISTINCT ON (company_id) * FROM due ORDER BY company_id, oldest ASC, journey_id, current_step_order');
    expect(fn).toContain('ORDER BY k.served_at ASC NULLS FIRST, rep.oldest ASC');
    expect(fn).toContain('companyServedAt.set(String(grp.company_id), Date.now());');
    expect(src).toContain('export const JOURNEY_STEP_BATCH_MAX = 10_000;');
    // 한 차례 = 회사 대표 묶음 여럿(줄 수보다 많이) · 회사 줄이 돌려 쓴다 = 큰 회사 묶음 하나가 다른 회사를 기다리게 하지 않는다 · 예산 넘으면 새 묶음 0
    expect(src).toContain('export const JOURNEY_GROUP_FETCH = 200;');
    expect(fn).toContain('[[...doneGroups], keyCos, keyAts, JOURNEY_GROUP_FETCH],');
    expect(fn).toContain('if (Date.now() - tickStartedAt >= JOURNEY_TICK_BUDGET_MS) return;');
  });
  it('이번 주기에 다 본 묶음은 다시 집지 않는다(더 나아갈 수 없음 · 남은 실행 없음 · 처리 예외)', () => {
    expect(fn).toContain("AND NOT ((e.journey_id::text || ':' || e.current_step_order::text) = ANY($1::text[]))");
    expect(fn).toContain('if (!out.progressed || rows.length < JOURNEY_STEP_BATCH_MAX) doneGroups.add(key);');
    expect(fn).toMatch(/\} catch \(err: any\) \{\s+doneGroups\.add\(key\);/);
  });
  it('주기(5분)는 예산(4분)보다 길다 = 겹치지 않는다', () => {
    expect(src).toContain('const intervalMs = 5 * 60 * 1000;');
  });
});
