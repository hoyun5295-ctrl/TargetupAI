/**
 * 발송 직전 계약 동일성 (★ 2026-10-05 · 신뢰 설계 Q12 · Codex 1R · 2R)
 *   예약된 회차는 그 대상 칸이 운영자의 **지금 계약**과 같을 때만 나간다.
 *   계약이 없거나(옛 자유 해석) 조건 확인 · 다음 승인으로 계약이 바뀌었으면 그 예약은 승인된 대상이 아니다 → 보류.
 */
import { describe, it, expect, vi } from 'vitest';

const connectMock = vi.fn();
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: (...a: any[]) => connectMock(...a) } }));

import { proposalMatchesContract, stageIfContractMatches, approveOperatorWindow } from '../continuous-operator';
import { query as dbQuery } from '../../config/database';

const op = (over: Record<string, any>) => ({ segmentKey: null, targetHint: null, audienceConditions: null, segmentParams: null, ...over }) as any;
const VIP = { term: '등급', field: 'grade', label: '등급', operator: 'eq', value: 'VIP', source: 'user' };
const GOLD = { ...VIP, value: 'GOLD' };

describe('proposalMatchesContract — 예약의 대상 = 지금 계약', () => {
  it('칸 조건 계약 · 같은 조건이면 통과(jsonb 키 순서와 무관)', () => {
    const o = op({ audienceConditions: [VIP] });
    expect(proposalMatchesContract({ filters: { grade: { value: 'VIP', operator: 'eq' } } }, o)).toBe(true);
  });
  it('조건 확인으로 계약이 바뀌었으면 옛 예약(VIP · GOLD)은 보류', () => {
    const o = op({ audienceConditions: [VIP] });
    expect(proposalMatchesContract({ filters: { grade: { operator: 'in', value: ['VIP', 'GOLD'] } } }, o)).toBe(false);
    expect(proposalMatchesContract({ filters: { grade: { operator: 'eq', value: 'GOLD' } } }, o)).toBe(false);
    expect(proposalMatchesContract({ filters: { grade: { operator: 'eq', value: 'VIP' } } }, op({ audienceConditions: [GOLD] }))).toBe(false);
  });
  it('계약 없음(옛 자유 해석) = 보류 · 대상 칸 없음 = 보류', () => {
    expect(proposalMatchesContract({ filters: { grade: { operator: 'eq', value: 'VIP' } } }, op({}))).toBe(false);
    expect(proposalMatchesContract(null, op({ audienceConditions: [VIP] }))).toBe(false);
  });
  it('축 계약 · 같은 축 · 같은 기준이면 통과 · 축이나 기준이 다르면 보류 · 축 예약에 칸 조건이 붙어 있으면 보류', () => {
    const o = op({ segmentKey: 'dormant', segmentParams: { days: 90 } });
    expect(proposalMatchesContract({ segmentKey: 'dormant', segmentParams: { days: 90 }, filters: {} }, o)).toBe(true);
    expect(proposalMatchesContract({ segmentKey: 'dormant', segmentParams: { days: 60 }, filters: {} }, o)).toBe(false);
    expect(proposalMatchesContract({ segmentKey: 'vip', filters: {} }, o)).toBe(false);
    expect(proposalMatchesContract({ segmentKey: 'dormant', segmentParams: { days: 90 }, filters: { grade: { operator: 'eq', value: 'VIP' } } }, o)).toBe(false);
  });
  it('칸 조건 계약인데 예약이 축이면(전체 고객 등) 보류', () => {
    expect(proposalMatchesContract({ segmentKey: 'all', filters: {} }, op({ audienceConditions: [VIP] }))).toBe(false);
  });
});

describe('stageIfContractMatches — 비교와 적재를 한 트랜잭션에서(계약 저장과 직렬화 · Codex 3R)', () => {
  const client = (opRow: any) => {
    const calls: string[] = [];
    const c = {
      calls,
      release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        calls.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
        if (/^SELECT to_jsonb\(o\)/.test(sql.trim())) return { rows: opRow ? [{ op_row: opRow }] : [] };
        if (/^INSERT/.test(sql.trim())) return { rowCount: 3 };
        return {};
      }),
    };
    connectMock.mockResolvedValueOnce(c);
    return c;
  };
  const ROW = { id: 'op', created_at: '2026-10-05T00:00:00Z', segment_key: null, audience_filters: { conditions: [VIP] } };

  it('같은 계약 = 운영자 행 공유 잠금 → 비교 → 적재 → 커밋', async () => {
    const c = client(ROW);
    const n = await stageIfContractMatches('op', { filters: { grade: { operator: 'eq', value: 'VIP' } } }, 'INSERT INTO staging SELECT 1', []);
    expect(n).toBe(3);
    expect(c.calls).toEqual(['BEGIN', 'SELECT to_jsonb(o)', 'INSERT INTO', 'COMMIT']);
    expect(String(c.query.mock.calls[1][0])).toContain('FOR SHARE');
    expect(c.release).toHaveBeenCalled();
  });
  it('계약이 바뀌었으면 = 적재 0 · 되돌림 · null(보류)', async () => {
    const c = client({ ...ROW, audience_filters: { conditions: [GOLD] } });
    const n = await stageIfContractMatches('op', { filters: { grade: { operator: 'eq', value: 'VIP' } } }, 'INSERT INTO staging SELECT 1', []);
    expect(n).toBeNull();
    expect(c.calls).toEqual(['BEGIN', 'SELECT to_jsonb(o)', 'ROLLBACK']);
  });
});

describe('approveOperatorWindow — 화면이 확인한 기간을 그대로 저장(지금 시각으로 다시 계산하지 않는다 · Codex 3R)', () => {
  it('받은 기간이 있으면 그 끝 · 시작을 저장한다', async () => {
    const sqls: Array<{ sql: string; params: any[] }> = [];
    (dbQuery as any).mockImplementation(async (sql: string, params: any[] = []) => {
      sqls.push({ sql, params });
      if (sql.includes('information_schema.columns')) return { rows: [{ n: 6 }] };
      if (/^\s*SELECT \* FROM continuous_operators/.test(sql)) {
        return { rows: [{ id: 'op', company_id: 'c', created_at: '2026-10-01T00:00:00Z', schedule: 'daily', schedule_time: '09:00', segment_key: 'all' }] };
      }
      if (/^\s*UPDATE continuous_operators/.test(sql)) return { rows: [{ id: 'op' }] };
      return { rows: [] };
    });
    const startAt = new Date('2026-10-06T00:00:00.000Z');
    const until = new Date('2026-10-12T14:59:59.999Z');
    const win = await approveOperatorWindow({
      companyId: 'c', operatorId: 'op', userId: 'u',
      window: { startAt, until, rounds: [startAt] },
      now: new Date('2026-10-06T01:00:00.000Z'),   // 지금 다시 계산하면 내일부터가 된다
    });
    expect(win?.until).toEqual(until);
    const upd = sqls.find((s) => /^\s*UPDATE continuous_operators/.test(s.sql))!;
    expect(upd.params[2]).toEqual(until);
    expect(JSON.parse(upd.params[3]).windowStart).toBe(startAt.toISOString());
  });
});
