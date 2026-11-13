// replaces: none
/**
 * C133 — 켜는 문장이 최대 인원을 함께 쓴다 · 실 PostgreSQL 판(★ 2026-11-13 · Codex 구현 1R ~ 3R 같은 계열 = 화면과 다른 최대 인원으로 켜짐)
 *   켜기 창은 최대 인원을 따로 저장하지 않는다. 켜기 요청이 화면의 값을 싣고, 서버가 status 를 active 로 바꾸는 그 UPDATE 에서 값을 함께 쓴다.
 *   1. 저장돼 있던 값이 무엇이든(낡은 값 · 늦게 닿은 저장이 남긴 값) 켜진 뒤의 최대 인원 = 화면의 값(숫자 · 비움)
 *   2. 켜지 못하면(검증 표식 없음 · 이미 켜짐 · 다른 회사) 최대 인원도 바뀌지 않는다(같은 문장 · 같은 조건)
 *   3. 값을 안 실으면 최대 인원을 건드리지 않는다(하나씩 켜기 · 새 모양 켜기 = 종전 그대로)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { activateJourney } from '../journey-builder';

const CO = randomUUID();
const OWNER = randomUUID();
const CB = '0212341133';
const mk = async (cap: number | null, extra: Record<string, unknown> = {}): Promise<string> => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'journeys', {
    id, company_id: CO, created_by: OWNER, name: `최대 인원 ${cap ?? '비움'}`, status: 'draft', start_kind: 'event', trigger_event: 'custom',
    trigger_filters: { all_customers: true }, callback_number: CB, threshold_recipients_per_step: cap, last_pretest_passed_at: new Date().toISOString(), ...extra,
  });
  await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: id, step_order: 1, step_type: 'message', channel: 'sms', message_template: '반가워요. 오늘 매장에 들러 주시면 작은 선물을 드려요.', delay_mode: 'relative', delay_hours: 0 });
  return id;
};
const rowOf = async (id: string) => {
  const r = (await query('SELECT status, threshold_recipients_per_step AS cap FROM journeys WHERE id = $1::uuid', [id])).rows[0];
  return { status: String(r.status), cap: r.cap === null ? null : Number(r.cap) };
};

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'C133 켜는 문장이 최대 인원을 쓴다' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, login_id: 't-c133-cap' });
  await insertMinimalRow(pool, 'sender_numbers', { id: randomUUID(), company_id: CO, phone_number: CB, is_active: true });
});

describe('켜진 뒤의 최대 인원 = 화면의 값(실 PG)', () => {
  it('저장돼 있던 1,000 · 화면 100 = 100 으로 켜진다(화면이 100 을 보인 채 1,000 으로 돌지 않는다)', async () => {
    const id = await mk(1000);
    expect((await activateJourney(CO, id, OWNER, { setCap: 100 })).ok).toBe(true);
    expect(await rowOf(id)).toEqual({ status: 'active', cap: 100 });
  });

  it('화면 비움 = 제한 없음으로 · 저장돼 있던 비움 · 화면 50 = 50 으로', async () => {
    const a = await mk(1000);
    expect((await activateJourney(CO, a, OWNER, { setCap: null })).ok).toBe(true);
    expect(await rowOf(a)).toEqual({ status: 'active', cap: null });
    const b = await mk(null);
    expect((await activateJourney(CO, b, OWNER, { setCap: 50 })).ok).toBe(true);
    expect(await rowOf(b)).toEqual({ status: 'active', cap: 50 });
  });

  it('멈춘 여정을 다시 켤 때도 같은 문장이 쓴다', async () => {
    const id = await mk(1000, { status: 'paused', paused_at: new Date().toISOString() });
    expect((await activateJourney(CO, id, OWNER, { setCap: 7 })).ok).toBe(true);
    expect(await rowOf(id)).toEqual({ status: 'active', cap: 7 });
  });
});

describe('켜지 못하면 최대 인원도 바뀌지 않는다(실 PG)', () => {
  it('검증 표식이 없는 여정 = 켜지지 않고 값 그대로', async () => {
    const id = await mk(1000, { last_pretest_passed_at: null });
    expect((await activateJourney(CO, id, OWNER, { setCap: 100 })).ok).toBe(false);
    expect(await rowOf(id)).toEqual({ status: 'draft', cap: 1000 });
  });

  it('이미 켜진 여정 = 값 그대로(켜진 여정의 최대 인원을 이 길로 바꿀 수 없다)', async () => {
    const id = await mk(1000);
    expect((await activateJourney(CO, id, OWNER)).ok).toBe(true);
    await activateJourney(CO, id, OWNER, { setCap: 5 });
    expect(await rowOf(id)).toEqual({ status: 'active', cap: 1000 });
  });

  it('다른 회사의 여정 = 켜지지 않고 값 그대로', async () => {
    const id = await mk(1000);
    expect((await activateJourney(randomUUID(), id, OWNER, { setCap: 100 })).ok).toBe(false);
    expect(await rowOf(id)).toEqual({ status: 'draft', cap: 1000 });
  });
});

describe('값을 안 실으면 건드리지 않는다(실 PG)', () => {
  it('종전 호출 그대로 켜지고 최대 인원은 저장된 값', async () => {
    const id = await mk(1000);
    expect((await activateJourney(CO, id, OWNER)).ok).toBe(true);
    expect(await rowOf(id)).toEqual({ status: 'active', cap: 1000 });
    const b = await mk(null);
    expect((await activateJourney(CO, b, OWNER, {})).ok).toBe(true);
    expect(await rowOf(b)).toEqual({ status: 'active', cap: null });
  });
});
