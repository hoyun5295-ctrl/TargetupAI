// replaces: none
/**
 * C143 W4(Codex 구현 1R #1) — 자동마케팅 승인 금액 = 나가는 유형 · 실 PostgreSQL 판
 *   (★ 2026-11-18 · 설계서 docs/2026-11-18-c143-sms-length-admin-lists-design.md §2 W4)
 *   본문은 90 안이어도 (광고) · 무료거부 줄을 붙여 90 을 넘으면 확정 함수가 LMS 로 올린다 → 저장 예상 비용 · 목록의 안마다 발송비 = LMS 단가.
 *   옛: 승인 화면 = SMS 단가 · 발송 차감 = LMS 단가.
 * 회차 = 직접 쓴 문안(AI 호출 0) · 시연 회사 · 바깥(담당자 문자 · 운영 경보 · 문자 큐)만 시험이 쥔다(operator-round-approve-1102.pg 와 같은 꼴).
 */
import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('../../config/defaults', async (orig) => ({ ...(await orig() as any), SEND_HOURS: { start: 0, end: 24 } }));
vi.mock('../sms-queue', async (orig) => ({ ...(await orig() as any), getAuthSmsTable: async () => 'SMSQ_TEST', bulkInsertSmsQueue: async (_t: string[], rows: any[][]) => rows.length }));
vi.mock('../../config/database', async (orig) => {
  const real: any = await orig();
  return { ...real, withBoundedMysql: async (_ms: number, work: any) => work(async () => []) };
});
vi.mock('../system-alert', () => ({ sendSystemAlert: async () => 1, alertPassFailures: async () => undefined }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { generateProposalForOperator, listProposals } from '../continuous-operator';
import { normalizeSegmentParams } from '../automarketing-segment';

const N = 5;
const SMS = 20;
const LMS = 50;
const kstHour = () => new Date(Date.now() + 9 * 3600_000).getUTCHours();
const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;

async function setup(body: string): Promise<{ co: string; op: string }> {
  const co = randomUUID(); const owner = randomUUID(); const op = randomUUID();
  await insertMinimalRow(pool, 'companies', { id: co, company_name: 'C143 승인 금액 시험', is_demo: true, cost_per_sms: SMS, cost_per_lms: LMS, opt_out_080_number: '0801234567' });
  await insertMinimalRow(pool, 'users', { id: owner, company_id: co, user_type: 'admin', is_active: true, phone: '010-0000-1143', login_id: `t-1118-c143-cost-${co.slice(0, 8)}` });
  for (let i = 0; i < N; i++) {
    await insertMinimalRow(pool, 'customers', { id: randomUUID(), company_id: co, phone: `010000011${String(i).padStart(2, '0')}`, is_active: true, sms_opt_in: true });
  }
  await insertMinimalRow(pool, 'continuous_operators', {
    id: op, company_id: co, name: 'C143 안내', status: 'active', created_by: owner, schedule: 'daily', schedule_time: hh(kstHour() + 5),
    segment_key: 'all', callback_number: '0212345678', channel: 'sms', copy_mode: 'fixed', fixed_copy: { subject: '', body },
  });
  return { co, op };
}
const lastProposal = async (op: string) => (await pool.query(
  `SELECT recipient_count, cost_estimate, proposal_json->'channel'->>'recommended' AS rec, (proposal_json->'cost'->>'estimated')::int AS est
     FROM operator_proposals WHERE operator_id = $1::uuid ORDER BY created_at DESC LIMIT 1`, [op])).rows[0];

describe('W4 회차 = 저장 예상 비용이 나가는 유형의 단가', () => {
  it('본문 70바이트(머리 · 꼬리를 붙이면 90 넘음) = LMS 단가 × 대상 · 추천 유형은 SMS 그대로', async () => {
    const s = await setup('A'.repeat(70));
    await generateProposalForOperator(s.op);
    const p = await lastProposal(s.op);
    expect(Number(p.recipient_count)).toBe(N);
    expect(Number(p.cost_estimate)).toBe(N * LMS);
    expect(p.est).toBe(N * LMS);
    expect(p.rec).toBe('SMS');
  });
  it('본문 20바이트(붙여도 90 안) = 옛 그대로 SMS 단가', async () => {
    const s = await setup('A'.repeat(20));
    await generateProposalForOperator(s.op);
    const p = await lastProposal(s.op);
    expect(Number(p.cost_estimate)).toBe(N * SMS);
    expect(p.est).toBe(N * SMS);
  });
});

describe('W4 목록 = 안마다 그 안이 나가는 유형의 단가 × 대상 수(finalCosts)', () => {
  it('짧은 안 = SMS 단가 · 머리 · 꼬리를 붙이면 넘는 안 = LMS 단가 · 유형도 안마다', async () => {
    const s = await setup('A'.repeat(20));
    await insertMinimalRow(pool, 'operator_proposals', {
      id: randomUUID(), operator_id: s.op, company_id: s.co, status: 'pending', recipient_count: N, cost_estimate: N * SMS,
      proposal_json: {
        messages: [{ variantId: 'a', body: 'A'.repeat(20), subject: '' }, { variantId: 'b', body: 'A'.repeat(70), subject: '안내' }],
        channel: { recommended: 'SMS', isAd: true },
        target: { segmentKey: 'all', segmentParams: normalizeSegmentParams('all', null), filters: {} },
      },
      expires_at: new Date(Date.now() + 86400_000),
    });
    const list = await listProposals(s.co, 'pending');
    const mine = list.find((x: any) => x.operatorId === s.op) as any;
    expect(mine.finalCopies.map((f: any) => f.msgType)).toEqual(['SMS', 'LMS']);
    expect(mine.finalCosts).toEqual([N * SMS, N * LMS]);
  });
});
