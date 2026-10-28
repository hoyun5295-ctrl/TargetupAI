// replaces: none
/**
 * 요금제 판정 한 벌 · 사실 경로 90일 — 실 PostgreSQL 판(★ 2026-10-28 자사몰 대비 K7 · 검증 수정 13 · M8)
 *
 * 주장이 SQL 에 기댄다: ACTIVE_PAID_PLAN_WHERE(구독 상태) · 요금제 변경 원장의 마지막 행(LATERAL · ORDER BY changed_at) · make_interval 90일.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { isCdpEnabledForPlan, cdpFactCollectGate } from '../cdp-auth';

const PAID = '00000000-0000-0000-0000-00000000a0d1';
const FREE = '00000000-0000-0000-0000-00000000a0d2';
const co = (n: number) => `00000000-0000-0000-0000-0000000000d${n}`;
const change = async (companyId: string, toCode: string, daysAgo: number) => {
  await insertMinimalRow(pool, 'company_plan_changes', {
    company_id: companyId, to_plan_id: toCode === 'FREE' ? FREE : PAID, to_plan_code: toCode,
    change_type: 'test', changed_at: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
  });
};

beforeAll(async () => {
  await insertMinimalRow(pool, 'plans', { id: PAID, plan_code: 'PRO' });
  await insertMinimalRow(pool, 'plans', { id: FREE, plan_code: 'FREE' });
  await insertMinimalRow(pool, 'companies', { id: co(1), plan_id: PAID });
  await insertMinimalRow(pool, 'companies', { id: co(2), plan_id: PAID, subscription_status: 'suspended' });
  await insertMinimalRow(pool, 'companies', { id: co(3), plan_id: FREE });
  await insertMinimalRow(pool, 'companies', { id: co(4), plan_id: FREE });
  await insertMinimalRow(pool, 'companies', { id: co(5), plan_id: FREE });
  await change(co(3), 'FREE', 10);
  await change(co(4), 'PRO', 200);
  await change(co(4), 'FREE', 120);
});

describe('K7 요금제 판정 = ACTIVE_PAID_PLAN_WHERE 한 벌', () => {
  it('유료 + 정상 = 열림 · 유료라도 구독 정지 = 닫힘 · 미가입 = 닫힘', async () => {
    expect([await isCdpEnabledForPlan(co(1)), await isCdpEnabledForPlan(co(2)), await isCdpEnabledForPlan(co(3))]).toEqual([true, false, false]);
  });
});

describe('K7 사실 경로 = 활성에서 빠진 뒤 90일까지', () => {
  it('활성 = 받음(마감 없음) · FREE 로 10일 전 = 받음 + 마감 · 120일 전 = 멈춤 · 원장 없음 · 구독 상태로 빠짐 = 받음 + 시각 모름', async () => {
    expect(await cdpFactCollectGate(co(1))).toEqual({ allowed: true, collectUntil: null, inactiveSinceUnknown: false });
    const g3 = await cdpFactCollectGate(co(3));
    expect(g3.allowed).toBe(true);
    expect(g3.inactiveSinceUnknown).toBe(false);
    expect(g3.collectUntil).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);   // ISO(화면이 그대로 날짜로 읽는다)
    const until = new Date(String(g3.collectUntil)).getTime();
    expect(Math.abs(until - (Date.now() + 80 * 86400_000))).toBeLessThan(3600_000);
    expect((await cdpFactCollectGate(co(4))).allowed).toBe(false);
    expect(await cdpFactCollectGate(co(5))).toEqual({ allowed: true, collectUntil: null, inactiveSinceUnknown: true });
    expect(await cdpFactCollectGate(co(2))).toEqual({ allowed: true, collectUntil: null, inactiveSinceUnknown: true });
    expect((await cdpFactCollectGate('00000000-0000-0000-0000-0000000000ff')).allowed).toBe(false);
  });
});
