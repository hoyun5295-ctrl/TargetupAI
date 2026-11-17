// replaces: none
/**
 * C142 — 반복 짝(매일 · 매주 + 상태 조건) 명시 선택 · 실 PostgreSQL 판(★ 2026-11-17 · 설계서 docs/2026-11-17-c142-staff-tickets-design.md §1 B · §4)
 *   운영 함수 updateOperator → lockAndCheckPairing(행 잠금 · 지문 판정) → writeRepeatAck(approval_meta.repeatAck) 를 그대로 돌린다 · DDL 0.
 *   1. 지문 없이 매일 = 400 + 지문 · 그 지문으로 다시 = 저장 + 승인 기록(다른 키 보존)
 *   2. 기준 숫자만 바꿔도 지문이 달라 400(저장된 동의로 통과하지 않는다)
 *   3. Codex 설계 2R 반례 — 다른 저장이 대상을 바꾸고 그 대상에 동의까지 저장한 뒤 옛 지문 재요청 = 400
 *   4. 매월로 바꾸면 승인 기록의 동의를 지운다 · 이름만 고치는 저장 = 판정 밖
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { updateOperator, OperatorPairingError } from '../continuous-operator';
import { repeatAckKey } from '../automarketing-segment';

const CO = randomUUID();
const USER = randomUUID();
const OP = randomUUID();

const meta = async () => (await query(`SELECT schedule, segment_key, segment_params, approval_meta FROM continuous_operators WHERE id = $1::uuid`, [OP])).rows[0];
async function pairingError(p: Promise<unknown>): Promise<OperatorPairingError> {
  try { await p; } catch (e) { if (e instanceof OperatorPairingError) return e; throw e; }
  throw new Error('막히지 않았다');
}

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'C142 반복' });
  await insertMinimalRow(pool, 'users', { id: USER, company_id: CO, user_type: 'admin', is_active: true, login_id: `t-c142-${CO.slice(0, 8)}`, name: '시험' });
  // 휴면 축 근거(최근 구매일이 있는 고객) — assertSegmentUsable 이 이 회사 데이터로 판정한다
  await insertMinimalRow(pool, 'customers', { id: randomUUID(), company_id: CO, phone: '01000001142', is_active: true, recent_purchase_date: '2026-01-01' });
  await insertMinimalRow(pool, 'continuous_operators', {
    id: OP, company_id: CO, created_by: USER, name: 'C142', objective: '매일 행사 안내', status: 'active',
    schedule: 'monthly', schedule_time: '09:00', schedule_day_of_month: 1, segment_key: 'all',
    approval_meta: JSON.stringify({ approvedAt: '2026-11-17T00:00:00Z', windowStart: '2026-11-17T00:00:00Z', renewalNoticeFor: 'keep-me' }),
  });
});

describe('C142 반복 짝 명시 선택(실 PG)', () => {
  it('1. 지문 없이 매일 = 400 + 지문 · 그 지문으로 다시 = 저장 + 승인 기록(다른 키 보존)', async () => {
    const e = await pairingError(updateOperator(CO, OP, { schedule: 'daily' }));
    const k = repeatAckKey('daily', { segmentKey: 'all' });
    expect(e.ackKey).toBe(k);
    expect(e.message).toContain('지금 대상에게 매일 보내기');
    expect((await meta()).schedule).toBe('monthly');
    const saved = await updateOperator(CO, OP, { schedule: 'daily', repeatAck: k });
    expect(saved?.schedule).toBe('daily');
    const m = await meta();
    expect(m.approval_meta.repeatAck).toBe(k);
    expect(m.approval_meta.renewalNoticeFor).toBe('keep-me');
    // 이름만 고치는 저장 = 판정 밖 · 승인 기록 그대로
    await updateOperator(CO, OP, { name: 'C142 이름' });
    expect((await meta()).approval_meta.repeatAck).toBe(k);
  });

  it('2. 대상 · 기준 숫자를 바꾸면 저장된 동의로 통과하지 않는다', async () => {
    const e = await pairingError(updateOperator(CO, OP, { segmentKey: 'dormant', segmentParams: { days: 90 } }));
    expect(e.ackKey).toBe(repeatAckKey('daily', { segmentKey: 'dormant', segmentParams: { days: 90 } }));
    await updateOperator(CO, OP, { segmentKey: 'dormant', segmentParams: { days: 90 }, repeatAck: e.ackKey });
    const e2 = await pairingError(updateOperator(CO, OP, { segmentKey: 'dormant', segmentParams: { days: 30 } }));
    expect(e2.ackKey).not.toBe(e.ackKey);
    expect((await meta()).segment_params).toEqual({ days: 90 });
  });

  it('3. Codex 설계 2R 반례 — 다른 저장이 대상을 바꾸고 동의까지 저장한 뒤 옛 지문 재요청 = 400', async () => {
    // 출발 = 매월 · 휴면 30일
    await updateOperator(CO, OP, { schedule: 'monthly', scheduleDayOfMonth: 1, segmentKey: 'dormant', segmentParams: { days: 30 } });
    // A: 주기만 매일로 → 400 + (매일 · 휴면 30) 지문
    const a = await pairingError(updateOperator(CO, OP, { schedule: 'daily' }));
    // B: 대상을 휴면 90 으로(매월이라 통과) → 매일로 + 그 짝에 동의
    await updateOperator(CO, OP, { segmentKey: 'dormant', segmentParams: { days: 90 } });
    const kb = repeatAckKey('daily', { segmentKey: 'dormant', segmentParams: { days: 90 } })!;
    await updateOperator(CO, OP, { schedule: 'daily', repeatAck: kb });
    expect((await meta()).approval_meta.repeatAck).toBe(kb);
    // A: 옛 지문(휴면 30)으로 주기만 다시 → 최종 짝 = 휴면 90 · 저장된 동의가 같아도 요청 지문이 다르면 막힌다(주기까지 같아 바뀜 판정이 건너뛰는 모양)
    const again = await pairingError(updateOperator(CO, OP, { schedule: 'daily', repeatAck: a.ackKey }));
    expect(again.ackKey).toBe(kb);
  });

  it('4. 매월로 바꾸면 승인 기록의 동의를 지운다', async () => {
    await updateOperator(CO, OP, { schedule: 'monthly', scheduleDayOfMonth: 1 });
    const m = await meta();
    expect(m.schedule).toBe('monthly');
    expect(m.approval_meta.repeatAck).toBeUndefined();
    expect(m.approval_meta.renewalNoticeFor).toBe('keep-me');
  });
});
