// replaces: none
/**
 * 자동마케팅 밀림 경보 — 실 PostgreSQL(★ 2026-11-02 설계서 docs/2026-11-01-journey-automarketing-engine-design.md §16 G3)
 * 판정 = 경계값(29분 · 31분) · 원인 하나 = 공용 키 한 통 · 회사 없음 · 생성 고르기와 같은 운영자 조건.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({ alerts: [] as Array<{ key: string; companyId: unknown }> }));
vi.mock('../system-alert', () => ({ sendSystemAlert: async (p: any) => { ctl.alerts.push({ key: String(p?.dedupKey), companyId: p?.companyId }); return 1; } }));
vi.mock('../../config/defaults', async (orig) => ({ ...(await orig() as any), SEND_HOURS: { start: 0, end: 24 } }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { checkOperatorLag, OPERATOR_LAG_MINUTES } from '../operator-lag';

const CO = randomUUID();

beforeEach(async () => {
  ctl.alerts = [];
  await pool.query(`UPDATE operator_proposals SET status = 'sent' WHERE status = 'scheduled'`);
  await pool.query(`UPDATE continuous_operators SET status = 'stopped' WHERE status IN ('active', 'paused_no_credit')`);
  const has = await pool.query(`SELECT 1 FROM companies WHERE id = $1`, [CO]);
  if (has.rows.length === 0) await insertMinimalRow(pool, 'companies', { id: CO, company_name: '밀림 시험' });
});

async function operator(status: string, nextRunAgoMin: number | null): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'continuous_operators', { id, company_id: CO, status });
  if (nextRunAgoMin != null) await pool.query(`UPDATE continuous_operators SET next_run_at = NOW() - ($2 || ' minutes')::interval WHERE id = $1`, [id, String(nextRunAgoMin)]);
  return id;
}
async function proposal(_op: string, agoMin: number): Promise<void> {
  const op = await operator('active', null);   // 운영자당 예약 회차 1건(ux_operator_proposals_one_scheduled)
  const id = randomUUID();
  await insertMinimalRow(pool, 'operator_proposals', { id, operator_id: op, company_id: CO, status: 'scheduled', proposal_json: {} });
  await pool.query(`UPDATE operator_proposals SET scheduled_send_at = NOW() - ($2 || ' minutes')::interval WHERE id = $1`, [id, String(agoMin)]);
}

describe('§16 G3 자동마케팅 밀림 경보', () => {
  it(`발송 밀림 = 예약 시각이 ${OPERATOR_LAG_MINUTES}분 넘게 지난 회차 · 29분 = 0 · 31분 = 한 통(회사 없음)`, async () => {
    const op = await operator('active', null);
    await proposal(op, OPERATOR_LAG_MINUTES - 1);
    expect((await checkOperatorLag()).sendLag).toBe(0);
    expect(ctl.alerts.filter((a) => a.key === 'operator-send-lag')).toHaveLength(0);
    await proposal(op, OPERATOR_LAG_MINUTES + 1);
    await proposal(op, OPERATOR_LAG_MINUTES + 5);
    expect((await checkOperatorLag()).sendLag).toBe(2);
    expect(ctl.alerts.filter((a) => a.key === 'operator-send-lag')).toEqual([{ key: 'operator-send-lag', companyId: null }]);
  });

  it('생성 밀림 = 생성 고르기와 같은 조건(active · paused_no_credit) · 멈춘 운영자 · next_run_at 없음 = 0', async () => {
    await operator('stopped', OPERATOR_LAG_MINUTES + 10);
    await operator('active', null);
    await operator('active', OPERATOR_LAG_MINUTES - 1);
    expect((await checkOperatorLag()).generateLag).toBe(0);
    await operator('paused_no_credit', OPERATOR_LAG_MINUTES + 1);
    expect((await checkOperatorLag()).generateLag).toBe(1);
    expect(ctl.alerts.filter((a) => a.key === 'operator-generate-lag')).toEqual([{ key: 'operator-generate-lag', companyId: null }]);
  });
});
