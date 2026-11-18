// replaces: none
/**
 * C143 L8 — 예약 캠페인 문안 수정(PUT /api/campaigns/:id/message · 큐를 그 자리에서 고치는 유일한 길) · 실 PostgreSQL 판
 *   (★ 2026-11-18 · 설계서 docs/2026-11-18-c143-sms-length-admin-lists-design.md §2 L8 · 변이 11 · 12 를 동작으로 잡는다)
 *   큐 갈래 = 받는 분마다 새 글을 먼저 다 만들고 SMS 가 하나라도 90바이트를 넘으면 UPDATE 0 · 400 · 넘지 않으면 옛 UPDATE 그대로
 *   적재 전(queued) 갈래 = 증명되는 하한이 넘으면 400 · 캠페인 행 그대로
 * 라우터 손잡이를 직접 부른다(C142 c142-agency-search.pg 와 같은 꼴) · MySQL 큐 = 시험 손(줄 · UPDATE 기록) · 고객 번호 = 010-0000-xxxx.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const ctl = vi.hoisted(() => ({ recipients: [] as any[], mysql: [] as Array<{ sql: string; params: any[] }> }));
vi.mock('../../middlewares/auth', () => ({ authenticate: (_req: any, _res: any, next: any) => next() }));
vi.mock('../../config/database', async (orig) => ({
  ...(await orig<any>()),
  mysqlQuery: vi.fn(async (sql: string, params: any[] = []) => { ctl.mysql.push({ sql, params }); return []; }),
}));
vi.mock('../../config/defaults', async (orig) => {
  const real: any = await orig();
  return { ...real, redis: { set: vi.fn(async () => 'OK'), get: vi.fn(async () => null), del: vi.fn(async () => 1) } };
});
vi.mock('../sms-queue', async (orig) => ({
  ...(await orig<any>()),
  getCampaignQueueTables: async () => ['SMSQ_SEND_1'],
  smsSelectAll: async () => ctl.recipients.map((r) => ({ ...r })),
}));

import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import campaignsRouter from '../../routes/campaigns';

const CO = randomUUID();
const OWNER = randomUUID();

function handle() {
  const layer: any = (campaignsRouter as any).stack.find((l: any) => l.route?.path === '/:id/message' && l.route.methods?.put);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
async function call(id: string, body: { message: string; subject?: string }) {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: any) { out.body = b; return res; } };
  await handle()({ params: { id }, body, user: { companyId: CO, userId: OWNER, userType: 'admin' } }, res);
  return out;
}
async function scheduled(o: { message: string; phase?: string | null; isAd?: boolean }): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'campaigns', {
    id, company_id: CO, user_id: OWNER, created_by: OWNER, campaign_name: 'C143 예약', status: 'scheduled', send_type: 'direct',
    message_type: 'SMS', message_content: o.message, message_template: o.message, is_ad: o.isAd === true,
    scheduled_at: new Date(Date.now() + 3 * 3600_000), send_phase: o.phase ?? null,
  });
  return id;
}
const stored = async (id: string) => (await pool.query(`SELECT message_content, message_template FROM campaigns WHERE id = $1`, [id])).rows[0];

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C98-DDL-2'));   // 운영엔 있음 · 시험 그릇 덤프엔 없음(customers.joined_at = 표준 칸 매핑이 고르는 칸)
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'C143 예약 수정 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1118', login_id: 't-1118-c143-edit' });
  await insertMinimalRow(pool, 'customers', { id: randomUUID(), company_id: CO, phone: '01000001181', name: '김가', is_active: true, sms_opt_in: true });
  await insertMinimalRow(pool, 'customers', { id: randomUUID(), company_id: CO, phone: '01000001182', name: '김가나다라마', is_active: true, sms_opt_in: true });
});
beforeEach(() => { ctl.mysql.length = 0; ctl.recipients = []; });

const updates = () => ctl.mysql.filter((q) => /^\s*UPDATE /.test(q.sql));

describe('L8 큐 갈래 — 받는 분마다 먼저 다 만들고 판정(UPDATE 앞)', () => {
  it('한 명이라도 90바이트를 넘으면 400 SMS_TOO_LONG · 큐 UPDATE 0 · 캠페인 행 그대로', async () => {
    const id = await scheduled({ message: '옛 문안' });
    ctl.recipients = [
      { seqno: 1, dest_no: '01000001181', msg_type: 'S', _sms_table: 'SMSQ_SEND_1' },
      { seqno: 2, dest_no: '01000001182', msg_type: 'S', _sms_table: 'SMSQ_SEND_1' },
    ];
    const out = await call(id, { message: `%이름%님 ${'A'.repeat(80)}` });   // 김가 = 87 · 김가나다라마 = 95
    expect(out.status).toBe(400);
    expect(out.body?.code).toBe('SMS_TOO_LONG');
    expect(out.body?.error).toContain('95바이트');
    expect(updates()).toHaveLength(0);
    expect((await stored(id)).message_content).toBe('옛 문안');
  });
  it('모두 90 안 = 옛 UPDATE 그대로(받는 분마다 만든 글 · 캠페인 행 갱신)', async () => {
    const id = await scheduled({ message: '옛 문안' });
    ctl.recipients = [
      { seqno: 1, dest_no: '01000001181', msg_type: 'S', _sms_table: 'SMSQ_SEND_1' },
      { seqno: 2, dest_no: '01000001182', msg_type: 'S', _sms_table: 'SMSQ_SEND_1' },
    ];
    const msg = `%이름%님 ${'A'.repeat(70)}`;
    const out = await call(id, { message: msg });
    expect(out.status).toBe(200);
    expect(out.body?.success).toBe(true);
    const up = updates();
    expect(up).toHaveLength(1);
    expect(up[0].params).toEqual(expect.arrayContaining([`김가님 ${'A'.repeat(70)}`, `김가나다라마님 ${'A'.repeat(70)}`]));
    expect((await stored(id)).message_content).toBe(msg);
  });
});

describe('L8 적재 전(queued) 갈래 — 증명되는 하한', () => {
  // ★ 이 갈래의 저장 문장(옛 F24 UPDATE)은 실 PG 15.15 에서 42P08(parameter $2 형 불일치 · varchar 칸 = $2 와 $2::text)로 실패한다 = 이 카드 밖의 기존 결함(1118 기록 · 보고) ·
  //   그래서 여기서는 길이 하한이 그 문장보다 앞에서 막는 것만 본다(90 이하 저장 갈래는 이 시험 밖).
  it('변수 없는 91바이트 = 400 SMS_TOO_LONG · 캠페인 행 그대로 · 변수 있는 글은 고정 글자만으로 넘을 때만', async () => {
    const id = await scheduled({ message: '옛 문안', phase: 'queued' });
    const over = await call(id, { message: 'A'.repeat(91) });
    expect(over.status).toBe(400);
    expect(over.body?.code).toBe('SMS_TOO_LONG');
    expect(over.body?.error).toContain('91바이트예요');
    expect((await stored(id)).message_content).toBe('옛 문안');
    const fixedOver = await call(id, { message: `%이름%님 ${'A'.repeat(90)}` });
    expect(fixedOver.status).toBe(400);
    expect(fixedOver.body?.error).toContain('고객 정보를 넣기 전에도 93바이트예요');
    expect((await stored(id)).message_content).toBe('옛 문안');
  });
});
