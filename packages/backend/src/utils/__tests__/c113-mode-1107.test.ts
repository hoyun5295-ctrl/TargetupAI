/**
 * C113 D23 · 5R #2 — 두 길 판정의 장애 갈래(DB 를 흉내 · 실 PG 시험은 c113-gate-1107.pg)
 *   정책 조회 실패 = 옛 길 + 장애 줄 최선 노력(못 써도 던지지 않음) · dry(미리보기) = 장애 줄 0 · 앞 배정 확인 실패 = 관문 길(모름).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ sql: string; params: any[] }> = [];
const flags = { policyFails: false, failureRowFails: false, paid: true };
vi.mock('../../config/database', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('information_schema')) return { rows: [{ cols: 4, tabs: 2 }] };
    if (sql.includes('AS paid')) {
      if (flags.policyFails) throw new Error('connection reset');
      return { rows: [{ paid: flags.paid }] };
    }
    if (sql.includes('SELECT global_holdout_pct, global_holdout_since')) {
      return { rows: [{ global_holdout_pct: null, global_holdout_since: null, campaign_holdout_pct: null, send_priority_order: null }] };
    }
    if (sql.includes("kind IN ('campaign_holdout', 'campaign_treated')")) throw new Error('relation missing');
    if (sql.includes('INSERT INTO ad_gate_failures')) {
      if (flags.failureRowFails) throw new Error('ad_gate_failures missing');
      return { rows: [], rowCount: 1 };
    }
    return { rows: [] };
  });
  return { query, pool: { connect: vi.fn() }, default: { query } };
});

import { resolveAdGateMode, resetAdGateSchemaCache } from '../ad-send-gate';

const CO = '11111111-2222-4333-8444-555555555555';
const failureRows = () => calls.filter((c) => c.sql.includes('INSERT INTO ad_gate_failures'));

describe('resolveAdGateMode 장애 갈래', () => {
  beforeEach(() => { calls.length = 0; flags.policyFails = false; flags.failureRowFails = false; flags.paid = true; resetAdGateSchemaCache(); });

  it('정책 조회 실패 = 옛 길 + 장애 줄(갈래 policy) 한 줄', async () => {
    flags.policyFails = true;
    expect(await resolveAdGateMode(CO, { batchId: CO, priorArmsPossible: true })).toEqual({ mode: 'legacy' });
    expect(failureRows()).toHaveLength(1);
    expect(failureRows()[0].sql).toContain("'policy'");
  });
  it('정책 조회 실패 + dry(미리보기) = 옛 길 · 장애 줄 0', async () => {
    flags.policyFails = true;
    expect(await resolveAdGateMode(CO, { dry: true })).toEqual({ mode: 'legacy' });
    expect(failureRows()).toHaveLength(0);
  });
  it('정책 조회 실패 + 장애 줄도 못 씀 = 던지지 않고 옛 길(미가입 발송을 멈추지 않음)', async () => {
    flags.policyFails = true;
    flags.failureRowFails = true;
    await expect(resolveAdGateMode(CO)).resolves.toEqual({ mode: 'legacy' });
    expect(failureRows()).toHaveLength(1);   // 써 보긴 했다
  });
  it('유료 · 새 기능 끔 + 앞 배정 확인 실패 = 관문 길(모름 · 첫 배정을 지키지 못하면 판정 · 장애 줄로) · 확인 실패 자체는 장애 줄 0', async () => {
    const m = await resolveAdGateMode(CO, { batchId: CO, priorArmsPossible: true });
    expect(m.mode).toBe('gate');
    expect(failureRows()).toHaveLength(0);
  });
  it('★ 구현 2R #1 미가입 = 요금제 조회 하나로 옛 길(스키마 · 새 칸 · 앞 배정 조회 0 · 기억이 비어 있어도)', async () => {
    flags.paid = false;
    expect(await resolveAdGateMode(CO, { batchId: CO, priorArmsPossible: true })).toEqual({ mode: 'legacy' });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('AS paid');
    expect(calls[0].sql).not.toMatch(/global_holdout|information_schema/);
  });
  it('유료 · 새 기능 끔 · 묶음 없음 = 옛 길(앞 배정 조회 0)', async () => {
    expect(await resolveAdGateMode(CO)).toEqual({ mode: 'legacy' });
    expect(calls.some((c) => c.sql.includes("kind IN ('campaign_holdout', 'campaign_treated')"))).toBe(false);
  });
});
