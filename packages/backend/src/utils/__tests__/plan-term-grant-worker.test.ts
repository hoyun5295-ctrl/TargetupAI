/**
 * 무료 메시징 지급 × 선불 이용 기간 정산 순서 계약 (★2026-10-04 · Codex 1R·2R medium)
 *
 * 못 박는 것
 *   1. 지급 전에 이용 기간 정산·정렬 패스를 기다린다.
 *   2. 정산에 실패한 회사는 이번 지급에서 뺀다 · 패스 자체가 실패하면 관리 회사 전부를 뺀다(다른 회사 지급은 계속).
 *   3. 지급 SQL 은 두 제외 조건을 실제로 싣는다(인자 없음 = 기존 동작 = 빈 목록·false).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
const grantArgs: any[] = [];
let passImpl: () => Promise<any> = async () => ({ processed: 0, failed: [] });

vi.mock('../plan-term', () => ({ runPlanTermPass: vi.fn(() => { calls.push('pass'); return passImpl(); }) }));
vi.mock('../free-messaging', () => ({
  revokeFreeMessagingForTrials: vi.fn(async () => 0),
  grantFreeMessagingForCurrentMonth: vi.fn(async (opts: any) => { calls.push('grant'); grantArgs.push(opts); return { granted: 0, skipped: false }; }),
}));

import { runFreeMessagingGrantPass } from '../free-messaging-grant-worker';

beforeEach(() => { calls.length = 0; grantArgs.length = 0; });

describe('지급 워커 × 이용 기간 정산', () => {
  it('정산 패스 → 지급 순서 · 실패 회사 제외', async () => {
    passImpl = async () => ({ processed: 2, failed: ['c-fail'], today: '2026-10-10' });
    await runFreeMessagingGrantPass();
    expect(calls).toEqual(['pass', 'grant']);
    expect(grantArgs[0]).toEqual({ planTermSettledOn: '2026-10-10', excludeCompanyIds: ['c-fail'] });
  });
  it('실패 없음 = 기준일만 넘긴다(지급 SQL이 DB의 오늘과 대조 · Codex 3R)', async () => {
    passImpl = async () => ({ processed: 1, failed: [], today: '2026-10-10' });
    await runFreeMessagingGrantPass();
    expect(grantArgs[0]).toEqual({ planTermSettledOn: '2026-10-10' });
  });
  it('패스 자체 실패 = 관리 회사 전부 제외하고 나머지는 지급', async () => {
    passImpl = async () => { throw new Error('후보 조회 실패'); };
    await runFreeMessagingGrantPass();
    expect(calls).toEqual(['pass', 'grant']);
    expect(grantArgs[0]).toEqual({ excludePlanTermCompanies: true });
  });
});
