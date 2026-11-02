// replaces: none
/**
 * 상태 트리거 진입 속도 — 실 PostgreSQL(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-7 · D4 · §7)
 *
 * 회차 상한(JOURNEY_COUNT_CAP)을 3 으로 줄여 휴면 고객 5명 = 첫 회차 3명(잘림) → 바로 다음 회차 2명(1시간 쉬지 않음) → 그다음 = 0 · 그 뒤 1시간 쉼.
 * 진입 감시(runJourneyTriggerWatcher)를 운영 문장 그대로 돌린다.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('../journey-target-extractor', async (orig) => ({ ...(await orig() as any), JOURNEY_COUNT_CAP: 3 }));
vi.mock('../system-alert', () => ({ sendSystemAlert: async () => 1, alertPassFailures: async () => undefined }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { runJourneyTriggerWatcher } from '../journey-trigger-watcher';

const CO = randomUUID();
const OWNER = randomUUID();
const J = randomUUID();
const entered = async () => Number((await pool.query(`SELECT COUNT(*)::int AS n FROM journey_executions WHERE journey_id = $1`, [J])).rows[0].n);

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '진입 속도 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: 't-1102-speed' });
  for (let i = 0; i < 5; i++) {
    const id = randomUUID();
    await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `0100000${String(7300 + i)}`, is_active: true, sms_opt_in: true });
    await pool.query(`UPDATE customers SET created_at = NOW() - INTERVAL '90 days', recent_purchase_date = (NOW() AT TIME ZONE 'Asia/Seoul')::date - 60 WHERE id = $1`, [id]);
  }
  await insertMinimalRow(pool, 'journeys', {
    id: J, company_id: CO, created_by: OWNER, name: '휴면 깨우기', status: 'active', start_kind: 'event',
    trigger_event: 'customer.dormant', trigger_filters: { dormant_days: 30, include_existing: true }, callback_number: '0212345678',
  });
  await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: J, step_order: 1, step_type: 'message', channel: 'sms', message_template: '오랜만이에요', delay_mode: 'relative', delay_hours: 0 });
});

describe('3-7 상태 트리거 = 잘린 회차는 다음 회차에 바로 이어서', () => {
  it('5명 · 회차 상한 3 = 3 → 2(바로 다음 회차) → 0', async () => {
    await runJourneyTriggerWatcher();
    expect(await entered()).toBe(3);
    await runJourneyTriggerWatcher();   // 옛: 1시간 쉬어 0
    expect(await entered()).toBe(5);
    await runJourneyTriggerWatcher();
    expect(await entered()).toBe(5);
  });
});
