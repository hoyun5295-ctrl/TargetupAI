// replaces: none
/**
 * 켜진 여정 A/B 칸 고치기 = 막음 — 실 PostgreSQL(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-16 · D14)
 *
 * 여정 행 잠금 안에서 그 칸의 변이 수를 보고 본문 · 제목 고치기를 409(AB_STEP_COPY_LOCKED)로 막는다 · 저장 0.
 * 간격만 고치기 = 막지 않는다 · 상세 = 칸마다 A/B 문안을 싣는다(화면이 본문 대신 보인다).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { updateJourneyStep, getJourneyDetail, JourneyStepGateError } from '../journey-builder';
import { createJourneyStepVariant } from '../bandit-optimizer';
import { stepHeldSql, stepSendableSql } from '../journey-pretest-notifier';
import { applyPassedCandidate } from '../journey-pretest-candidate';
import { ledgerBlockSql } from './pg/global-setup';

const CO = randomUUID();
const OWNER = randomUUID();
const J = randomUUID();
const STEP = randomUUID();
const STEP2 = randomUUID();   // 변이 없는 문자 칸(사람이 고친 글 = 보낼 글 판정 · 3-3 ③)
const SNAP = randomUUID();

beforeAll(async () => {
  for (const id of ['C93-DDL-3', 'C89-DDL-5']) await pool.query(ledgerBlockSql(id));   // 검사 기록 판 칸(보류 판정 = 판 id) · 수정안 표
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'A/B 칸 잠금 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: 't-1102-ab-lock' });
  await insertMinimalRow(pool, 'journeys', { id: J, company_id: CO, created_by: OWNER, name: 'A/B 칸', status: 'active', start_kind: 'event', trigger_event: 'customer.created' });
  await insertMinimalRow(pool, 'journey_steps', { id: STEP, journey_id: J, step_order: 1, step_type: 'message', channel: 'lms', message_template: '칸 글', subject: '칸 제목', delay_hours: 0 });
  await insertMinimalRow(pool, 'journey_step_variants', { step_id: STEP, variant_id: 'A', message_template: 'A 글', subject: null });
  await insertMinimalRow(pool, 'journey_step_variants', { step_id: STEP, variant_id: 'B', message_template: 'B 글', subject: 'B 제목' });
  await insertMinimalRow(pool, 'journey_step_snapshots', { id: SNAP, company_id: CO, journey_id: J, step_id: STEP, message_body: '칸 글', confidence_score: 100 });
  await pool.query(`UPDATE journey_step_snapshots SET created_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [SNAP]);
  await insertMinimalRow(pool, 'journey_steps', { id: STEP2, journey_id: J, step_order: 2, step_type: 'message', channel: 'lms', message_template: '둘째 칸 글', subject: '둘째', delay_hours: 24 });
});

describe('3-16 A/B 칸 고치기', () => {
  it('본문 고치기 = 409 · 저장 0', async () => {
    const err = await updateJourneyStep(CO, J, STEP, { messageTemplate: '새 칸 글', allowActiveMessageEdit: true }).catch((e) => e);
    expect(err).toBeInstanceOf(JourneyStepGateError);
    expect(err.code).toBe('AB_STEP_COPY_LOCKED');
    const row = (await pool.query(`SELECT message_template FROM journey_steps WHERE id = $1`, [STEP])).rows[0];
    expect(row.message_template).toBe('칸 글');
  });

  it('제목 고치기 = 409', async () => {
    const err = await updateJourneyStep(CO, J, STEP, { subject: '새 제목', allowActiveMessageEdit: true }).catch((e) => e);
    expect(err?.code).toBe('AB_STEP_COPY_LOCKED');
  });

  it('상세 = 칸마다 A/B 문안(변이 순)', async () => {
    const d = await getJourneyDetail(CO, J);
    const s = d!.steps.find((x: any) => x.id === STEP);
    expect(s.ab_variants).toEqual([
      { variant_id: 'A', message_template: 'A 글', subject: null },
      { variant_id: 'B', message_template: 'B 글', subject: 'B 제목' },
    ]);
  });
});

describe('3-9 켜진 여정 A/B 문안 = 보류 칸만 고친다 · 3-3 ③ 사람이 고친 글 = 보낼 글 판정', () => {
  const held = async () => (await pool.query(`SELECT ${stepHeldSql('$1::uuid', '$2::uuid')} AS h`, [J, STEP])).rows[0].h as boolean;
  const variantBody = async (v: string) => (await pool.query(`SELECT message_template FROM journey_step_variants WHERE step_id = $1 AND variant_id = $2`, [STEP, v])).rows[0]?.message_template;
  it('보류 아닌 A/B 칸 = 409(JOURNEY_ACTIVE) · 변이 그대로', async () => {
    const err = await createJourneyStepVariant({ companyId: CO, journeyId: J, stepId: STEP, variantId: 'A', messageTemplate: 'A 고친 글' }).catch((e) => e);
    expect(err).toBeInstanceOf(JourneyStepGateError);
    expect(err.code).toBe('JOURNEY_ACTIVE');
    expect(await variantBody('A')).toBe('A 글');
  });
  it('보류 칸 A/B 고치기 = 저장 · 새 판(검사 전) · 옛 판 보류는 관문에서 빠짐(새 판 = 검사 뒤 나감)', async () => {
    await pool.query(
      `INSERT INTO journey_pretest_schedules (company_id, journey_id, step_id, scheduled_send_at, notify_at, status, snapshot_id) VALUES ($1, $2, $3, NOW(), NOW(), 'held', $4)`,
      [CO, J, STEP, SNAP]);
    expect(await held()).toBe(true);
    await createJourneyStepVariant({ companyId: CO, journeyId: J, stepId: STEP, variantId: 'A', messageTemplate: 'A 고친 글' });
    expect(await variantBody('A')).toBe('A 고친 글');
    const latest = (await pool.query(`SELECT id, confidence_score FROM journey_step_snapshots WHERE step_id = $1 ORDER BY created_at DESC LIMIT 1`, [STEP])).rows[0];
    expect(String(latest.id)).not.toBe(SNAP);
    expect(Number(latest.confidence_score)).toBe(0);
    expect(await held()).toBe(false);
  });
  it('변이 없는 켜진 칸에 채울 자리를 남긴 고치기 = 409(COPY_ISSUE) · 저장 0', async () => {
    const err = await updateJourneyStep(CO, J, STEP2, { messageTemplate: '[혜택 안내: 직접 수정해주세요] 둘째 칸', allowActiveMessageEdit: true }).catch((e) => e);
    expect(err?.code).toBe('COPY_ISSUE');
    expect((await pool.query(`SELECT message_template FROM journey_steps WHERE id = $1`, [STEP2])).rows[0].message_template).toBe('둘째 칸 글');
  });
});

describe('3-9 [이 글로 보내기] = 검사 통과 수정안을 그 칸 글로 · 새 판(통과) · 옛 판 결과는 버림', () => {
  it('보류 칸 + 통과 수정안 → 적용 = 칸 글 · 새 판 통과 · 보류 풀림 · 보낼 수 있음 · 같은 옛 판으로 다시 = stale', async () => {
    const step = randomUUID(); const snap = randomUUID();
    await insertMinimalRow(pool, 'journey_steps', { id: step, journey_id: J, step_order: 3, step_type: 'message', channel: 'lms', message_template: '막힌 글', subject: '셋째', delay_hours: 48 });
    await insertMinimalRow(pool, 'journey_step_snapshots', { id: snap, company_id: CO, journey_id: J, step_id: step, message_body: '막힌 글', confidence_score: 100 });
    await pool.query(`UPDATE journey_step_snapshots SET created_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [snap]);
    await pool.query(
      `INSERT INTO journey_pretest_schedules (company_id, journey_id, step_id, scheduled_send_at, notify_at, status, snapshot_id) VALUES ($1, $2, $3, NOW(), NOW(), 'held', $4)`,
      [CO, J, step, snap]);
    await pool.query(`INSERT INTO journey_pretest_candidates (snapshot_id, step_id, body, subject, status) VALUES ($1, $2, '다시 쓴 글', '셋째', 'passed')`, [snap, step]);
    expect(await applyPassedCandidate(CO, J, step, snap)).toBe('applied');
    expect((await pool.query(`SELECT message_template FROM journey_steps WHERE id = $1`, [step])).rows[0].message_template).toBe('다시 쓴 글');
    const fresh = (await pool.query(`SELECT id, message_body, confidence_score FROM journey_step_snapshots WHERE step_id = $1 ORDER BY created_at DESC LIMIT 1`, [step])).rows[0];
    expect(fresh.message_body).toBe('다시 쓴 글');
    expect(Number(fresh.confidence_score)).toBe(100);
    expect((await pool.query(`SELECT ${stepHeldSql('$1::uuid', '$2::uuid')} AS h`, [J, step])).rows[0].h).toBe(false);
    expect((await pool.query(`SELECT ${stepSendableSql('$1::uuid', '$2::uuid', '$3::uuid')} AS ok`, [J, step, fresh.id])).rows[0].ok).toBe(true);
    expect(await applyPassedCandidate(CO, J, step, snap)).toBe('stale');
  });
});
