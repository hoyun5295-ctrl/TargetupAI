/**
 * 등급 서열 — 저장·판정 계약 (2026-08-02)
 *
 * 왜 행동을 단정하는가
 *   서열이 어긋나면 **등급이 떨어진 고객에게 축하가 나간다.** 그 판정의 근거는 이 표 하나뿐이라
 *   "순서가 없거나 모르는 값은 제외"가 코드에서 실제로 지켜지는지를 못 박는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

import { query, pool } from '../config/database';
import { hasUsableGradeOrder, saveGradeRanks, listCompanyGradeValues } from './customer-grade-rank';

const q = query as unknown as ReturnType<typeof vi.fn>;
const connect = (pool as any).connect as ReturnType<typeof vi.fn>;
const COMPANY = '11111111-1111-1111-1111-111111111111';

function mockClient() {
  const calls: Array<{ text: string; params?: any[] }> = [];
  const client = {
    query: vi.fn(async (text: string, params?: any[]) => { calls.push({ text, params }); return { rows: [] }; }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(client);
  return { calls };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('hasUsableGradeOrder', () => {
  it('순위가 매겨진 값이 둘 이상일 때만 판정 가능하다 — 하나면 위로 갈 자리가 없다', async () => {
    q.mockResolvedValueOnce({ rows: [{ n: 1 }] });
    expect(await hasUsableGradeOrder(COMPANY)).toBe(false);
    q.mockResolvedValueOnce({ rows: [{ n: 2 }] });
    expect(await hasUsableGradeOrder(COMPANY)).toBe(true);
  });

  it('서열표가 아직 없으면 잠근 채로 둔다 — 못 여는 쪽이 안전하다', async () => {
    q.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    expect(await hasUsableGradeOrder(COMPANY)).toBe(false);
  });

  it('그 밖의 오류는 삼키지 않는다 — 조용한 잠금은 원인을 숨긴다', async () => {
    q.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '08006' }));
    await expect(hasUsableGradeOrder(COMPANY)).rejects.toThrow('boom');
  });
});

describe('saveGradeRanks', () => {
  it('지우고 넣는 것을 한 트랜잭션에서 한다 — 그 사이 판정이 끼면 빈 표를 본다', async () => {
    const { calls } = mockClient();
    await saveGradeRanks(COMPANY, null, [
      { gradeValue: '일반', rankOrder: 1 },
      { gradeValue: 'VIP', rankOrder: 2 },
    ]);
    const texts = calls.map((c) => c.text);
    expect(texts[0]).toBe('BEGIN');
    expect(texts.some((t) => /DELETE FROM customer_grade_ranks/.test(t))).toBe(true);
    expect(texts.filter((t) => /INSERT INTO customer_grade_ranks/.test(t)).length).toBe(2);
    expect(texts[texts.length - 1]).toBe('COMMIT');
  });

  it('같은 값이 두 번 오면 하나만 남긴다', async () => {
    const { calls } = mockClient();
    const r = await saveGradeRanks(COMPANY, null, [
      { gradeValue: 'VIP', rankOrder: 1 },
      { gradeValue: 'VIP', rankOrder: 3 },
    ]);
    expect(r.saved).toBe(1);
    const ins = calls.filter((c) => /INSERT INTO customer_grade_ranks/.test(c.text));
    expect(ins[0].params?.[2]).toBe(3);
  });

  it('순서 없음(null)도 저장한다 — 등급이 아닌 값이라는 사실 자체가 판정 근거다', async () => {
    const { calls } = mockClient();
    await saveGradeRanks(COMPANY, null, [{ gradeValue: '직장인', rankOrder: null }]);
    const ins = calls.find((c) => /INSERT INTO customer_grade_ranks/.test(c.text));
    expect(ins?.params?.[2]).toBeNull();
  });

  it('빈 값은 버린다', async () => {
    mockClient();
    const r = await saveGradeRanks(COMPANY, null, [{ gradeValue: '   ', rankOrder: 1 }]);
    expect(r.saved).toBe(0);
  });
});

describe('listCompanyGradeValues', () => {
  it('회사 데이터에 실제로 있는 값만 센다 — 목록을 우리가 만들지 않는다', async () => {
    q.mockResolvedValueOnce({ rows: [{ grade_value: 'VIP', cnt: 3, rank_order: 2 }] });
    const r = await listCompanyGradeValues(COMPANY);
    expect(r).toEqual([{ gradeValue: 'VIP', customerCount: 3, ranked: true, rankOrder: 2 }]);
    expect(String(q.mock.calls[0][0])).toMatch(/FROM customers c/);
  });
});

/** ★ 2026-08-02 Codex — 게이트는 행 수가 아니라 서로 다른 급 수를 본다. */
describe('hasUsableGradeOrder — 같은 급·사라진 등급', () => {
  it('서로 다른 순위를 세고, 지금 고객에게 있는 등급만 근거로 삼는다', async () => {
    q.mockResolvedValueOnce({ rows: [{ n: 1 }] });
    expect(await hasUsableGradeOrder(COMPANY)).toBe(false);   // 같은 급만 둘 = 올라갈 자리 없음
    const sql = String(q.mock.calls[0][0]);
    expect(sql).toMatch(/COUNT\(DISTINCT r\.rank_order\)/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM customers c/);
  });
});

describe('saveGradeRanks — 동시 저장', () => {
  it('지우기 전에 회사 단위 잠금을 먼저 잡는다 — 안 잡으면 합집합 표가 남는다', async () => {
    const { calls } = mockClient();
    await saveGradeRanks(COMPANY, null, [{ gradeValue: 'VIP', rankOrder: 2 }]);
    const texts = calls.map((c) => c.text);
    const lock = texts.findIndex((t) => /pg_advisory_xact_lock/.test(t));
    const del = texts.findIndex((t) => /DELETE FROM customer_grade_ranks/.test(t));
    expect(lock).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(lock);
  });
});
