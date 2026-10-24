/**
 * 발송 직전 계약 동일성 (★ 2026-10-05 · 신뢰 설계 Q12 · Codex 1R · 2R)
 *   예약된 회차는 그 대상 칸이 운영자의 **지금 계약**과 같을 때만 나간다.
 *   계약이 없거나(옛 자유 해석) 조건 확인 · 다음 승인으로 계약이 바뀌었으면 그 예약은 승인된 대상이 아니다 → 보류.
 */
import { describe, it, expect, vi } from 'vitest';

const connectMock = vi.fn();
vi.mock('../../config/database', () => {
  const query = vi.fn(async () => ({ rows: [] }));
  // 트랜잭션 = 같은 query 로 흘린다(문장 순서 · 매개변수만 본다)
  return { query, pool: { connect: (...a: any[]) => connectMock(...a) }, withTransaction: async (work: any) => work((t: string, p?: any[]) => (query as any)(t, p)) };
});

import { proposalMatchesContract, stageIfContractMatches, approveOperatorWindow, OperatorPairingError, OperatorScheduleChangedError } from '../continuous-operator';
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
        return { rows: [{ id: 'op', company_id: 'c', created_at: '2026-10-01T00:00:00Z', schedule: 'monthly', schedule_day_of_month: 6, schedule_time: '09:00', segment_key: 'all' }] };
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

describe('approveOperatorWindow — 짝(같은 고객 반복) 마지막 문 = 행 잠금 · 같은 트랜잭션 · 승인 창의 「매월로」 = 주기 저장(★ 1024 Codex 2R)', () => {
  const run = (row: Record<string, any>) => {
    const sqls: Array<{ sql: string; params: any[] }> = [];
    (dbQuery as any).mockImplementation(async (sql: string, params: any[] = []) => {
      sqls.push({ sql, params });
      if (sql.includes('information_schema.columns')) return { rows: [{ n: 6 }] };
      if (/^\s*SELECT \* FROM continuous_operators/.test(sql)) return { rows: [{ id: 'op', company_id: 'c', created_at: '2026-10-01T00:00:00Z', schedule_time: '09:00', ...row }] };
      if (/^\s*UPDATE continuous_operators/.test(sql)) return { rows: [{ id: 'op' }] };
      return { rows: [] };
    });
    return sqls;
  };
  const startAt = new Date('2026-10-06T00:00:00.000Z');
  const window = { startAt, until: new Date('2026-10-12T14:59:59.999Z'), rounds: [startAt] };
  it('매일 + 전체 고객 = 저장하지 않는다(400 · UPDATE 0) · 판정 조회는 잠금(FOR UPDATE)', async () => {
    const sqls = run({ schedule: 'daily', segment_key: 'all' });
    await expect(approveOperatorWindow({ companyId: 'c', operatorId: 'op', userId: 'u', window })).rejects.toBeInstanceOf(OperatorPairingError);
    expect(sqls.find((s) => /^\s*SELECT \* FROM continuous_operators/.test(s.sql))!.sql).toContain('FOR UPDATE');
    expect(sqls.some((s) => /^\s*UPDATE continuous_operators/.test(s.sql))).toBe(false);
  });
  it('매주 + 상위 등급 → 창에서 「매월로」 = 주기 · 날짜 · 다음 생성 시각을 같은 문장에 저장', async () => {
    const sqls = run({ schedule: 'weekly', schedule_day_of_week: 1, segment_key: 'vip' });
    const win = await approveOperatorWindow({
      companyId: 'c', operatorId: 'op', userId: 'u', window,
      schedule: { schedule: 'monthly', scheduleDayOfWeek: null, scheduleDayOfMonth: 7 },
    });
    expect(win?.until).toEqual(window.until);
    const upd = sqls.find((s) => /^\s*UPDATE continuous_operators/.test(s.sql))!;
    expect(upd.sql).toContain('schedule = $');
    expect(upd.sql).toContain('schedule_day_of_month = $');
    expect(upd.sql).toContain('next_run_at = $');
    expect(upd.params).toContain('monthly');
    expect(upd.params).toContain(7);
    expect(upd.params.some((p) => p instanceof Date && p !== window.until)).toBe(true);
  });
  it('답한 주기가 없으면 주기 칸을 쓰지 않는다 · 주기가 같아도 답한 날짜는 저장한다(Codex 3R)', async () => {
    let sqls = run({ schedule: 'monthly', schedule_day_of_month: 6, segment_key: 'vip' });
    await approveOperatorWindow({ companyId: 'c', operatorId: 'op', userId: 'u', window });
    expect(sqls.find((s) => /^\s*UPDATE continuous_operators/.test(s.sql))!.sql).not.toContain('next_run_at');
    sqls = run({ schedule: 'monthly', schedule_day_of_month: 1, segment_key: 'vip' });
    await approveOperatorWindow({ companyId: 'c', operatorId: 'op', userId: 'u', window, schedule: { schedule: 'monthly', scheduleDayOfWeek: null, scheduleDayOfMonth: 25 } });
    const upd = sqls.find((s) => /^\s*UPDATE continuous_operators/.test(s.sql))!;
    expect(upd.sql).toContain('next_run_at = $');
    expect(upd.params).toContain(25);
  });
  it('창을 연 뒤 일정이 바뀌었으면(본 일정 ≠ 잠근 행) 저장하지 않는다(409 · UPDATE 0 · 「매주 → 매월 25일 답 → 다른 편집이 매월 1일 저장 → 승인」)', async () => {
    const sqls = run({ schedule: 'monthly', schedule_day_of_month: 1, schedule_day_of_week: null, segment_key: 'vip' });
    await expect(approveOperatorWindow({
      companyId: 'c', operatorId: 'op', userId: 'u', window,
      schedule: { schedule: 'monthly', scheduleDayOfWeek: null, scheduleDayOfMonth: 25 },
      seenSchedule: { schedule: 'weekly', scheduleTime: '09:00', scheduleDayOfWeek: 1, scheduleDayOfMonth: null, scheduleMonth: null },
    })).rejects.toBeInstanceOf(OperatorScheduleChangedError);
    expect(sqls.some((s) => /^\s*UPDATE continuous_operators/.test(s.sql))).toBe(false);
    // 본 일정 = 잠근 행이면 저장한다
    const ok = run({ schedule: 'weekly', schedule_day_of_week: 1, segment_key: 'vip' });
    await approveOperatorWindow({
      companyId: 'c', operatorId: 'op', userId: 'u', window,
      schedule: { schedule: 'monthly', scheduleDayOfWeek: null, scheduleDayOfMonth: 25 },
      seenSchedule: { schedule: 'weekly', scheduleTime: '09:00', scheduleDayOfWeek: 1, scheduleDayOfMonth: null, scheduleMonth: null },
    });
    expect(ok.some((s) => /^\s*UPDATE continuous_operators/.test(s.sql))).toBe(true);
  });
  it('일정 비교가 짝 판정보다 먼저(「매월 · 전체」 창을 연 뒤 다른 편집이 「매일 · 생일」 저장 → 옛 창 승인 = 409 · UPDATE 0 · Codex 4R)', async () => {
    const sqls = run({ schedule: 'daily', segment_key: 'birthday' });
    await expect(approveOperatorWindow({
      companyId: 'c', operatorId: 'op', userId: 'u', window,
      contract: { segmentKey: 'all', segmentParams: null, conditions: null },
      seenSchedule: { schedule: 'monthly', scheduleTime: '09:00', scheduleDayOfWeek: null, scheduleDayOfMonth: 6, scheduleMonth: null },
    })).rejects.toBeInstanceOf(OperatorScheduleChangedError);
    expect(sqls.some((s) => /^\s*UPDATE continuous_operators/.test(s.sql))).toBe(false);
  });
});
