// replaces: none
/**
 * C160 S2 — 예약 캠페인 문안 수정(PUT /api/campaigns/:id/message)의 없는 변수 판정 · 실 PostgreSQL 판
 *   (★ 2026-11-22 · 설계서 docs/2026-11-22-c160-unknown-variable-design.md §2 S2 예약 문안 수정 두 줄)
 *   아는 이름 = 처음 읽은 send_phase 로 갈래를 정한다: 적재 전(queued) = 매핑 + 주소록 칸 · 그 밖(큐 0 · 큐) = 매핑만(주소록 인자 없이 다시 만든다).
 *   매핑 읽기 = 판정 앞에서 한 번 · 큐 갈래 치환이 같은 값을 쓴다(커스텀 칼럼 값이 채워지는지로 본다).
 *   적재 전 갈래의 저장 문장은 C143 때부터 실 PG 에서 42P08 로 실패한다(C143 설계서 200줄 · 이 카드 밖 기존 결함) → 그 갈래는 문장 앞의 400 만 본다.
 * 라우터 손잡이를 직접 부른다(C143 c143-campaign-message-edit.pg 와 같은 꼴) · MySQL 큐 = 시험 손 · 고객 번호 = 010-0000-xxxx.
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
const MSG_UNKNOWN = (n: string) => `고객 정보에 없는 변수(%${n}%)는 보낼 때 빈칸이 돼요. 있는 항목으로 바꾸거나 지워 주세요.`;

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
async function scheduled(o: { message: string; phase?: string | null }): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'campaigns', {
    id, company_id: CO, user_id: OWNER, created_by: OWNER, campaign_name: 'C160 예약', status: 'scheduled', send_type: 'direct',
    message_type: 'LMS', message_subject: '안내', message_content: o.message, message_template: o.message, is_ad: false,
    scheduled_at: new Date(Date.now() + 3 * 3600_000), send_phase: o.phase ?? null,
  });
  return id;
}
const stored = async (id: string) => (await pool.query(`SELECT message_content FROM campaigns WHERE id = $1`, [id])).rows[0];
const updates = () => ctl.mysql.filter((q) => /^\s*UPDATE /.test(q.sql));
const RECIPIENT = { seqno: 1, dest_no: '01000001221', msg_type: 'L', _sms_table: 'SMSQ_SEND_1' };

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C98-DDL-2'));   // 운영엔 있음 · 시험 그릇 덤프엔 없음(C143 시험과 같은 사유)
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'C160 예약 수정 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1122', login_id: 't-1122-c160-edit' });
  await insertMinimalRow(pool, 'customer_field_definitions', { id: randomUUID(), company_id: CO, field_key: 'custom_3', field_label: '시험칸', field_type: 'VARCHAR' });
  await insertMinimalRow(pool, 'customers', {
    id: randomUUID(), company_id: CO, phone: '01000001221', name: '김가', is_active: true, sms_opt_in: true, custom_fields: { custom_3: 'VIP' },
  });
});
beforeEach(() => { ctl.mysql.length = 0; ctl.recipients = []; });

describe('적재 전(queued) 갈래 — 매핑 + 주소록 칸', () => {
  it('없는 이름 = 400 UNKNOWN_VARIABLE · 캠페인 행 그대로(저장 문장 앞)', async () => {
    const id = await scheduled({ message: '옛 문안', phase: 'queued' });
    const out = await call(id, { message: '%없는항목% 안내', subject: '안내' });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ success: false, code: 'UNKNOWN_VARIABLE', error: MSG_UNKNOWN('없는항목') });
    expect((await stored(id)).message_content).toBe('옛 문안');
  });
});

describe('큐 갈래 — 매핑만(주소록 인자 없이 다시 만든다)', () => {
  it('주소록 칸 %기타1% = 400 UNKNOWN_VARIABLE(이 길에서 실제로 빈칸) · 큐 UPDATE 0 · 캠페인 행 그대로', async () => {
    const id = await scheduled({ message: '옛 문안' });
    ctl.recipients = [RECIPIENT];
    const out = await call(id, { message: '%기타1%님 안내', subject: '안내' });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ code: 'UNKNOWN_VARIABLE', error: MSG_UNKNOWN('기타1') });
    expect(updates()).toHaveLength(0);
    expect((await stored(id)).message_content).toBe('옛 문안');
  });
  it('커스텀 칼럼 이름 = 통과 · 판정 앞에서 읽은 매핑으로 큐 글을 채운다', async () => {
    const id = await scheduled({ message: '옛 문안' });
    ctl.recipients = [RECIPIENT];
    const out = await call(id, { message: '%시험칸% 고객님 안내', subject: '안내' });
    expect(out.status).toBe(200);
    const up = updates();
    expect(up).toHaveLength(1);
    expect(up[0].params).toEqual(expect.arrayContaining(['VIP 고객님 안내']));
    expect((await stored(id)).message_content).toBe('%시험칸% 고객님 안내');
  });
});
