// replaces: none
/**
 * 재진입 = 진입 감시와 같은 진입 정보 — 실 PostgreSQL(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-8 · D5)
 *
 * 포인트 소멸 여정을 끝낸 고객이 쿨다운 뒤 다시 들어오면 진입 때 포인트(points_at_entry)를 싣는다(종료 신호 points_used 의 기준).
 * 그 밖 트리거 = 진입 정보 없음(NULL) · 진입 표식(__entry) 없음(생애 지도 규칙).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { runReentryBatch } from '../journey-reentry-worker';

const CO = randomUUID();
const OWNER = randomUUID();
const J_POINTS = randomUUID();
const J_DORMANT = randomUUID();
const C1 = randomUUID();
const C2 = randomUUID();

async function journeyWithDoneRun(id: string, trigger: string, customerId: string): Promise<void> {
  await insertMinimalRow(pool, 'journeys', {
    id, company_id: CO, created_by: OWNER, name: `재진입 ${trigger}`, status: 'active', start_kind: 'event', trigger_event: trigger,
    auto_reentry_enabled: true, reentry_cooldown_days: 0,
  });
  await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: id, step_order: 1, step_type: 'message', channel: 'sms', message_template: '안내', delay_hours: 0 });
  await insertMinimalRow(pool, 'journey_executions', {
    id: randomUUID(), journey_id: id, customer_id: customerId, current_step_order: 1, status: 'completed', completed_at: new Date(Date.now() - 3_600_000),
  });
}

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '재진입 진입 정보 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: 't-1102-reentry' });
  await insertMinimalRow(pool, 'customers', { id: C1, company_id: CO, phone: '01000001201', is_active: true, sms_opt_in: true, points: 500 });
  await insertMinimalRow(pool, 'customers', { id: C2, company_id: CO, phone: '01000001202', is_active: true, sms_opt_in: true, points: 70 });
  await journeyWithDoneRun(J_POINTS, 'customer.points_expiring', C1);
  await journeyWithDoneRun(J_DORMANT, 'customer.dormant', C2);
});

describe('3-8 재진입 진입 정보', () => {
  it('포인트 소멸 = 진입 때 포인트 · 휴면 = 진입 정보 없음 · 둘 다 진입 표식 없음', async () => {
    await runReentryBatch();
    const r = await pool.query(
      `SELECT journey_id, entry_event_properties FROM journey_executions WHERE journey_id = ANY($1::uuid[]) AND status = 'active'`,
      [[J_POINTS, J_DORMANT]],
    );
    const by = new Map(r.rows.map((x) => [String(x.journey_id), x.entry_event_properties]));
    expect(by.get(J_POINTS)).toEqual({ points_at_entry: 500 });
    expect(by.has(J_DORMANT)).toBe(true);
    expect(by.get(J_DORMANT)).toBeNull();
  });
});
