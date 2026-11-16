// replaces: none
/**
 * C133 F5 답장 상담 — 실 PostgreSQL 판(★ 2026-11-14 · 설계서 docs/2026-11-13-hanjul-v3-design.md §7 · §18 「배포 D」 · 대기 DDL C133-DDL-7 을 시험 안에서 얹는다)
 *   운영 문장(받기 · 번호 묶기 · 배정 · 설정 · 판정 · 예산 · 답장 행 · 대조 · 조회)을 글자 그대로 돌린다. 직접발송 코어 · AI 고르기만 대역.
 *   1. 받기 = 같은 id 한 번 · 가림 · 받은 번호로 회사(없는 번호 · 안 묶인 번호 · 잘못된 꼴 = 미배정)
 *   2. 번호 = 한 번호 한 회사 · 다른 회사에 다시 못 묶음 · 수동 배정한 번호는 묶을 수 없음 · 지우는 길 없음
 *   3. 설정 = 결과가 자동이면 그 번호로 발신 인증 · 인증된 번호 고정
 *   4. 판정 순서 = 수신거부(상담 설정과 무관) → 단계 · 상담 → 방식 → 야간 → 예산 → AI
 *   5. 보내기 = 보내는 순간 다시 본다 · 적재 묶음 id 먼저 · 대조 · 실패하면 받은 글이 사람 함으로
 *   6. 사람 답장 = 같은 id 한 번 · 그 요청에서 인증 · 자동 판정 중인 글은 잠시 뒤
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const stage = vi.hoisted(() => ({ state: 'open' as 'open' | 'closed' | 'unknown' }));
const core = vi.hoisted(() => ({ create: vi.fn() }));
const notice = vi.hoisted(() => ({ send: vi.fn() }));
const alert = vi.hoisted(() => ({ send: vi.fn() }));
const reg = vi.hoisted(() => ({ numbers: new Set<string>(), line: true }));
vi.mock('../v3-stage', () => ({ v3LiveState: vi.fn(async () => stage.state), v3Live: vi.fn(async () => stage.state === 'open') }));
vi.mock('../direct-send-core', () => ({ createDirectSendCampaign: core.create }));
vi.mock('../continuous-operator', () => ({ notifyOperatorAdmins: notice.send }));
vi.mock('../system-alert', () => ({ sendSystemAlert: alert.send }));
vi.mock('../planner-executor', () => ({ DEFINITE_NO_COMMIT: new Set(['INSUFFICIENT_BALANCE', 'SPAM_BLOCKED']) }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => { throw new Error('시험은 AI 를 부르지 않는다'); }) }));
vi.mock('../sms-queue', async (orig) => ({ ...(await orig<any>()), hasCompanyLineGroup: vi.fn(async () => reg.line) }));
vi.mock('../callback-filter', async (orig) => ({ ...(await orig<any>()), isCallbackRegistered: vi.fn(async (_c: string, phone: string) => reg.numbers.has(String(phone).replace(/\D/g, ''))) }));

import { pool } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { insertMinimalRow } from './pg/fixtures';
import {
  receiveInbound, registerInboundNumber, bindInboundNumber, unbindInboundNumber, listInboundNumbers, listUnassigned, assignInboundMessage, companyInboundNumbers,
  readInboundSettings, saveInboundSettings, listKbItems, saveKbItem, deleteKbItem,
  decideInbound, sendReply, humanReply, readHumanReply, discardHumanReply, closeInbound, inboxStatus, listThreads, readThread, runInboundPass,
  INBOUND_ACTIVATION_GUARD_SQL, INBOUND_DUE_DECIDE_SQL, INBOUND_PER_COMPANY, INBOUND_THREAD_LIMIT,
  type InboundCtx, type SenderGate,
} from '../inbound-sms';
import { INBOUND_MASK, INBOUND_DEFAULT_HANDOFF, INBOUND_KB_MAX_ITEMS, kstDay } from '../inbound-sms-rules';
import { DirectSendError } from '../direct-send-spec';

const CO = '00000000-0000-0000-0000-00000c133701';
const OTHER = '00000000-0000-0000-0000-00000c133702';
const ISO = '00000000-0000-0000-0000-00000c133703';
const PLAN = '00000000-0000-0000-0000-00000c133711';
const ADMIN = '00000000-0000-0000-0000-00000c133721';
const STAFF = '00000000-0000-0000-0000-00000c133722';
const OADMIN = '00000000-0000-0000-0000-00000c133723';
const IADMIN = '00000000-0000-0000-0000-00000c133724';
const SUPER = '00000000-0000-0000-0000-00000c133729';
const CTX: InboundCtx = { companyId: CO, userId: ADMIN };
const OCTX: InboundCtx = { companyId: OTHER, userId: OADMIN };
const N1 = '050377770001';          // CO 에 묶인 상담 번호
const N2 = '050377770002';          // OTHER
const N3 = '050377770003';          // ISO
const CB = '0277770000';            // 등록된 답장 발신번호
const CB2 = '0277770009';
const CUST = '01077770001';

const day = () => kstDay(new Date());
const NOON = () => new Date(`${day()}T12:00:00+09:00`);
const NIGHT = () => new Date(`${day()}T22:30:00+09:00`);
const TOMORROW = () => new Date(NOON().getTime() + 24 * 3600 * 1000);

const calls: Array<{ spec: any; ctx: any; guardOk: boolean; staged: string[]; marker: string | null }> = [];
const gateCalls: string[] = [];
const okGate: SenderGate = async (cb) => { gateCalls.push(cb); return { ok: true }; };
const noGate: SenderGate = async (cb) => { gateCalls.push(cb); return { ok: false, rejection: { code: 'SENDER_AUTH_REQUIRED' } }; };
/** 활성화 조건은 코어의 문장($1 = 캠페인 id) 뒤에 붙는다 → 따로 돌릴 때는 자리 번호를 하나씩 당긴다 */
const guardSql = (sql: string) => sql.replace(/\$2/g, '$1').replace(/\$3/g, '$2').replace(/\$4/g, '$3');
/** 시계 차(초) — 활성화 조건이 「DB 의 지금 + 이 값」을 그 순간의 시각으로 본다 */
const skewOf = (at: Date) => (at.getTime() - Date.now()) / 1000;
const pickOf = (answer: string | Error) => {
  const fn = vi.fn(async () => { if (answer instanceof Error) throw answer; return answer; });
  return { fn, deps: { pick: fn } };
};

let seq = 0;
async function inbound(text: string, over: { from?: string; to?: string } = {}): Promise<string> {
  seq += 1;
  const providerMsgId = `t-${Date.now()}-${seq}`;
  await receiveInbound({ from: over.from || CUST, to: over.to || N1, text, providerMsgId });
  return String((await pool.query('SELECT id FROM inbound_messages WHERE provider_msg_id = $1', [providerMsgId])).rows[0].id);
}
const row = async (id: string) => (await pool.query('SELECT * FROM inbound_messages WHERE id = $1::uuid', [id])).rows[0];
const repliesOf = async (id: string) => (await pool.query(`SELECT * FROM inbound_messages WHERE reply_to = $1::uuid AND direction = 'out' ORDER BY created_at`, [id])).rows;
const settings = (over: Record<string, unknown> = {}) => ({ enabled: true, mode: 'auto', replyCallback: CB, dailyCap: null, notifyPhone: null, handoffText: '', ...over });
async function setup(over: Record<string, unknown> = {}, ctx: InboundCtx = CTX) {
  const r = await saveInboundSettings(ctx, settings(over), okGate);
  expect(r.saved).toBe(true);
}
const kb = (title: string, body: string, ctx: InboundCtx = CTX) => saveKbItem(ctx, { title, body });

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C133-DDL-7'));
  await insertMinimalRow(pool, 'plans', { id: PLAN, plan_code: 'C133INBOX', plan_name: '유료', is_active: true });
  for (const id of [CO, OTHER]) await insertMinimalRow(pool, 'companies', { id, plan_id: PLAN, company_name: id === CO ? '상담 회사' : '다른 회사', cost_per_sms: 10, cost_per_lms: 30 });
  await insertMinimalRow(pool, 'companies', { id: ISO, plan_id: PLAN, company_name: '격리 회사', user_isolation_enabled: true });
  await insertMinimalRow(pool, 'users', { id: ADMIN, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1371', login_id: 't-c133-inbox-admin' });
  await insertMinimalRow(pool, 'users', { id: STAFF, company_id: CO, user_type: 'user', is_active: true, phone: '010-0000-1372', login_id: 't-c133-inbox-staff' });
  await insertMinimalRow(pool, 'users', { id: OADMIN, company_id: OTHER, user_type: 'admin', is_active: true, phone: '010-0000-1373', login_id: 't-c133-inbox-other' });
  await insertMinimalRow(pool, 'users', { id: IADMIN, company_id: ISO, user_type: 'admin', is_active: true, phone: '010-0000-1374', login_id: 't-c133-inbox-iso' });
  await insertMinimalRow(pool, 'customers', { company_id: CO, phone: CUST, name: '문의 고객', is_active: true, sms_opt_in: true });
  for (const [n, co] of [[N1, CO], [N2, OTHER], [N3, ISO]] as const) {
    await registerInboundNumber(n, '시험', SUPER);
    await bindInboundNumber(n, co);
  }
});

beforeEach(async () => {
  stage.state = 'open'; reg.line = true; reg.numbers = new Set([CB, CB2]);
  calls.length = 0; gateCalls.length = 0;
  notice.send.mockReset(); notice.send.mockResolvedValue(true);
  alert.send.mockReset(); alert.send.mockResolvedValue(1);
  core.create.mockReset();
  core.create.mockImplementation(async (spec: any, ctx: any) => {
    const id = randomUUID();
    const g = ctx.activationGuard;
    const guardOk = (await pool.query(`SELECT ${guardSql(String(g.sql))} AS ok`, g.params)).rows[0].ok === true;
    const staged = (await pool.query('SELECT phone FROM campaign_send_staging WHERE staging_id = $1::uuid', [spec.stagingId])).rows.map((r: any) => String(r.phone));
    // 코어를 부르는 순간 답장 행에 이 적재 묶음 id 가 sending 으로 이미 적혀 있어야 한다(그 뒤에 죽어도 대조가 찾는다)
    const marker = (await pool.query(`SELECT status FROM inbound_messages WHERE reply_staging_id = $1::uuid`, [spec.stagingId])).rows[0]?.status || null;
    calls.push({ spec, ctx, guardOk, staged, marker });
    await insertMinimalRow(pool, 'campaigns', { id, company_id: ctx.companyId, staging_id: spec.stagingId, send_phase: guardOk ? 'queued' : 'failed', status: guardOk ? 'sending' : 'failed', campaign_name: spec.campaignName });
    if (!guardOk) throw new DirectSendError('COMMIT_FAILED', '발송 접수에 실패했습니다.', 500);   // 실제 코어 = 활성화 문장 0행 → 중화 + 환불 의무 기록 뒤 이 오류
    return { campaignId: id, accepted: spec.total };
  });
  await pool.query(`DELETE FROM inbound_messages`);
  await pool.query(`DELETE FROM campaign_send_staging WHERE company_id = ANY($1::uuid[])`, [[CO, OTHER, ISO]]);
  await pool.query(`DELETE FROM inbound_kb_items`);
  await pool.query(`DELETE FROM inbound_settings`);
  await pool.query(`DELETE FROM unsubscribes WHERE company_id = ANY($1::uuid[])`, [[CO, OTHER, ISO]]);
  await pool.query(`UPDATE customers SET sms_opt_in = true WHERE company_id = $1::uuid`, [CO]);
});

describe('받기(실 PG)', () => {
  it('같은 providerMsgId 는 한 번 · 주민등록번호 꼴을 가린다 · 받은 번호로 회사를 정한다(표기가 달라도)', async () => {
    const input = { from: '010-7777-0001', to: '+82 503-7777-0001', text: '주민번호 900101-1234567 로 조회해 주세요', providerMsgId: 'dup-1' };
    expect(await receiveInbound(input)).toEqual({ stored: true, assigned: true });
    expect(await receiveInbound(input)).toEqual({ stored: false, assigned: true });
    const rows = (await pool.query(`SELECT * FROM inbound_messages WHERE provider_msg_id = 'dup-1'`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'in', from_phone: CUST, to_number: N1, company_id: CO, status: 'new', body: `주민번호 ${INBOUND_MASK} 로 조회해 주세요` });
  });
  it('없는 번호 · 안 묶인 번호 · 잘못된 꼴 = 미배정(어느 회사로도 붙이지 않는다) · 잘못된 꼴은 원문 그대로', async () => {
    await registerInboundNumber('0503-7777-0090', '안 묶음', SUPER);
    const a = await inbound('안녕하세요', { to: '050377779999' });        // 표에 없는 번호
    const b = await inbound('안녕하세요', { to: '050377770090' });        // 안 묶인 번호
    const c = await inbound('안녕하세요', { to: '1588-1234' });           // 잘못된 꼴
    for (const id of [a, b, c]) expect(await row(id)).toMatchObject({ status: 'unassigned', company_id: null });
    expect((await row(c)).to_number).toBe('1588-1234');
    // 미배정 글은 판정하지 않는다
    expect(await decideInbound(a, NOON(), pickOf('1').deps)).toBe('skip');
  });
  it('빠진 값은 저장하지 않는다', async () => {
    for (const bad of [{ from: '', to: N1, text: 'a', providerMsgId: 'x1' }, { from: CUST, to: '', text: 'a', providerMsgId: 'x2' }, { from: CUST, to: N1, text: '  ', providerMsgId: 'x3' }, { from: CUST, to: N1, text: 'a', providerMsgId: '' }, { from: CUST, to: N1, text: 'a', providerMsgId: 'x'.repeat(101) }]) {
      await expect(receiveInbound(bad)).rejects.toMatchObject({ code: 'INBOUND_INPUT' });
    }
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM inbound_messages')).rows[0].n).toBe(0);
  });
});

describe('번호 · 미배정함(실 PG)', () => {
  it('한 번호 = 한 회사 · 전에 묶였던 번호는 다른 회사에 못 묶는다 · 풀었다가 같은 회사에는 다시 묶는다 · 표기가 달라도 같은 번호', async () => {
    const n = `05037777${String(1000 + Math.floor(Math.random() * 8000))}`;
    expect(await registerInboundNumber(`${n.slice(0, 4)}-${n.slice(4, 8)}-${n.slice(8)}`, null, SUPER)).toEqual({ number: n, created: true });
    expect(await registerInboundNumber(`+82 ${n.slice(1)}`, null, SUPER)).toEqual({ number: n, created: false });
    await expect(registerInboundNumber('1588-1234', null, SUPER)).rejects.toMatchObject({ code: 'INBOUND_NUMBER' });
    await bindInboundNumber(n, CO);
    await expect(bindInboundNumber(n, OTHER)).rejects.toMatchObject({ code: 'INBOUND_NUMBER_OTHER' });
    expect(await unbindInboundNumber(n)).toBe(true);
    await expect(bindInboundNumber(n, OTHER)).rejects.toMatchObject({ code: 'INBOUND_NUMBER_OTHER' });   // 풀어도 다른 회사에는 못 묶는다
    const loose = await inbound('풀린 뒤 문의', { to: n });
    expect(await row(loose)).toMatchObject({ status: 'unassigned', company_id: null });
    await bindInboundNumber(n, CO);                                                                       // 같은 회사에는 다시
    expect((await listInboundNumbers()).find((x) => x.number === n)).toMatchObject({ companyId: CO, firstCompanyId: CO, shared: false });
    await expect(bindInboundNumber('050377779998', CO)).rejects.toMatchObject({ code: 'INBOUND_NUMBER_UNKNOWN' });
    // 표가 직접 거절한다(처음 묶인 회사 없이 회사만 · 처음 묶인 회사와 다른 회사)
    await expect(pool.query(`INSERT INTO inbound_numbers (number, company_id) VALUES ('050377778881', $1::uuid)`, [CO])).rejects.toThrow(/inbound_numbers_company_history/);
    await expect(pool.query(`UPDATE inbound_numbers SET company_id = $2::uuid WHERE number = $1`, [n, OTHER])).rejects.toThrow(/inbound_numbers_company_history/);
    // 번호가 풀리거나 바뀌어도 이미 받은 글의 회사는 그대로
    const before = await inbound('묶인 동안 온 글', { to: n });
    await unbindInboundNumber(n);
    expect((await row(before)).company_id).toBe(CO);
  });
  it('수동 배정한 번호는 그때부터 수동 배정 전용 = 어느 회사에도 묶을 수 없다(공용 번호를 뒤에 한 회사에 묶는 유출 길)', async () => {
    const pub = `05037776${String(1000 + Math.floor(Math.random() * 8000))}`;
    const a = await inbound('A사 고객의 문의', { to: pub });                       // 표에 없는 번호로 온 글
    expect((await listUnassigned()).find((x) => x.id === a)).toMatchObject({ toNumber: pub, onlyCompanyId: null });
    await assignInboundMessage(a, CO, SUPER);
    expect(await row(a)).toMatchObject({ company_id: CO, status: 'human', assigned_by: SUPER });
    expect((await listInboundNumbers()).find((x) => x.number === pub)).toMatchObject({ shared: true, companyId: null, firstCompanyId: null });
    await expect(bindInboundNumber(pub, OTHER)).rejects.toMatchObject({ code: 'INBOUND_NUMBER_SHARED' });
    await expect(bindInboundNumber(pub, CO)).rejects.toMatchObject({ code: 'INBOUND_NUMBER_SHARED' });
    // 같은 번호의 다른 글은 다른 회사에도 배정할 수 있다(공용) · 표의 CHECK 도 같은 불변식
    const b = await inbound('B사 고객의 문의', { to: pub, from: '01077770002' });
    await assignInboundMessage(b, OTHER, SUPER);
    expect((await row(b)).company_id).toBe(OTHER);
    await expect(pool.query(`UPDATE inbound_numbers SET company_id = $2::uuid, first_company_id = $2::uuid WHERE number = $1`, [pub, CO])).rejects.toThrow(/inbound_numbers_shared_alone/);
    // 배정된 글에는 자동 답장이 없다 · 두 번 배정하지 못한다
    expect(await decideInbound(a, NOON(), pickOf('1').deps)).toBe('skip');
    await expect(assignInboundMessage(a, OTHER, SUPER)).rejects.toMatchObject({ code: 'INBOUND_NOT_UNASSIGNED' });
  });
  it('전에 묶였던 번호로 온 미배정 글은 그 회사로만 배정 · 잘못된 꼴의 번호는 번호 행을 만들지 않는다', async () => {
    const n = `05037775${String(1000 + Math.floor(Math.random() * 8000))}`;
    await registerInboundNumber(n, null, SUPER);
    await bindInboundNumber(n, CO);
    await unbindInboundNumber(n);
    const m = await inbound('풀린 번호로 온 후속 문의', { to: n });
    expect((await listUnassigned()).find((x) => x.id === m)).toMatchObject({ onlyCompanyId: CO, onlyCompanyName: '상담 회사' });
    await expect(assignInboundMessage(m, OTHER, SUPER)).rejects.toMatchObject({ code: 'INBOUND_NUMBER_OTHER' });
    expect((await row(m)).status).toBe('unassigned');
    await assignInboundMessage(m, CO, SUPER);
    expect((await listInboundNumbers()).find((x) => x.number === n)).toMatchObject({ shared: false, firstCompanyId: CO });   // 묶였던 번호는 수동 배정 전용이 되지 않는다
    const odd = await inbound('이상한 번호로 온 글', { to: '1588-1234' });
    await assignInboundMessage(odd, OTHER, SUPER);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM inbound_numbers WHERE number LIKE '1588%'`)).rows[0].n).toBe(0);
  });
});

describe('설정 · 답변 항목(실 PG)', () => {
  it('결과가 「켬 ∧ 바로 답장」이면 그 번호로 발신 인증 · 인증된 번호를 적는다 · 켠 채로 번호만 바꿔도 다시 인증', async () => {
    expect((await saveInboundSettings(CTX, settings(), noGate)).saved).toBe(false);
    expect(await readInboundSettings(CO)).toMatchObject({ enabled: false, autoReady: false });      // 인증을 못 지나면 저장하지 않는다
    expect((await saveInboundSettings(CTX, settings(), okGate)).saved).toBe(true);
    expect(gateCalls).toEqual([CB, CB]);
    const s1 = (await pool.query('SELECT * FROM inbound_settings WHERE company_id = $1::uuid', [CO])).rows[0];
    expect(s1).toMatchObject({ enabled: true, mode: 'auto', reply_callback: CB, auth_callback: CB, updated_by: ADMIN });
    // 번호만 바꾸는 저장 = 새 번호로 인증 · 못 지나면 옛 값 그대로
    expect((await saveInboundSettings(CTX, settings({ replyCallback: '02-7777-0009' }), noGate)).saved).toBe(false);
    expect((await pool.query('SELECT reply_callback, auth_callback FROM inbound_settings WHERE company_id = $1::uuid', [CO])).rows[0]).toEqual({ reply_callback: CB, auth_callback: CB });
    expect((await saveInboundSettings(CTX, settings({ replyCallback: '02-7777-0009' }), okGate)).saved).toBe(true);
    expect(gateCalls.slice(2)).toEqual([CB2, CB2]);
    expect((await pool.query('SELECT reply_callback, auth_callback FROM inbound_settings WHERE company_id = $1::uuid', [CO])).rows[0]).toEqual({ reply_callback: CB2, auth_callback: CB2 });
    // 초안만 · 끔 = 인증을 부르지 않고 인증된 번호를 비운다
    gateCalls.length = 0;
    expect((await saveInboundSettings(CTX, settings({ mode: 'draft' }), noGate)).saved).toBe(true);
    expect(gateCalls).toEqual([]);
    expect(await readInboundSettings(CO)).toMatchObject({ enabled: true, mode: 'draft', autoReady: false });
    expect((await pool.query('SELECT auth_callback FROM inbound_settings WHERE company_id = $1::uuid', [CO])).rows[0].auth_callback).toBeNull();
  });
  it('켜려면 상담 번호 · 등록된 답장 발신번호가 있어야 한다 · 값 검사', async () => {
    await expect(saveInboundSettings({ companyId: '00000000-0000-0000-0000-00000c1337ff', userId: ADMIN }, settings(), okGate)).rejects.toMatchObject({ code: 'INBOUND_NO_NUMBER' });
    await expect(saveInboundSettings(CTX, settings({ replyCallback: '' }), okGate)).rejects.toMatchObject({ code: 'INBOUND_CALLBACK' });
    await expect(saveInboundSettings(CTX, settings({ replyCallback: '02-9999-9999' }), okGate)).rejects.toMatchObject({ code: 'INBOUND_CALLBACK' });   // 등록 안 된 번호
    await expect(saveInboundSettings(CTX, settings({ mode: 'x' }), okGate)).rejects.toMatchObject({ code: 'INBOUND_MODE' });
    await expect(saveInboundSettings(CTX, settings({ dailyCap: 0 }), okGate)).rejects.toMatchObject({ code: 'INBOUND_CAP' });
    await expect(saveInboundSettings(CTX, settings({ notifyPhone: '02-123-4567' }), okGate)).rejects.toMatchObject({ code: 'INBOUND_NOTIFY' });
    await expect(saveInboundSettings(CTX, settings({ handoffText: '가'.repeat(201) }), okGate)).rejects.toMatchObject({ code: 'INBOUND_HANDOFF' });
    await expect(saveInboundSettings(CTX, settings({ handoffText: '확인 후 연락드려요 😀' }), okGate)).rejects.toMatchObject({ code: 'INBOUND_HANDOFF' });
    expect(gateCalls).toEqual([]);
    expect(await readInboundSettings(CO)).toMatchObject({ enabled: false, handoffText: INBOUND_DEFAULT_HANDOFF });
  });
  it('답변 항목 = 회사 것만 · 글자 · 길이 검사 · 30개까지', async () => {
    const a = await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    await saveKbItem(CTX, { id: a.id, title: '영업시간', body: '평일 10시부터 20시까지 엽니다.', enabled: false });
    expect(await listKbItems(CO)).toEqual([{ id: a.id, title: '영업시간', body: '평일 10시부터 20시까지 엽니다.', enabled: false, sort: 0 }]);
    await expect(saveKbItem(OCTX, { id: a.id, title: '남의 것', body: '고친다' })).rejects.toMatchObject({ code: 'INBOUND_KB' });
    await expect(kb('', '글')).rejects.toMatchObject({ code: 'INBOUND_KB' });
    await expect(kb('제목', '가'.repeat(601))).rejects.toMatchObject({ code: 'INBOUND_KB' });
    await expect(kb('제목', '감사합니다 😀')).rejects.toMatchObject({ code: 'INBOUND_KB' });
    expect(await deleteKbItem(OCTX, a.id)).toBe(false);
    expect(await deleteKbItem(CTX, a.id)).toBe(true);
    for (let i = 0; i < INBOUND_KB_MAX_ITEMS; i += 1) await kb(`항목 ${i}`, `답변 ${i}`);
    await expect(kb('하나 더', '넘친다')).rejects.toMatchObject({ code: 'INBOUND_KB' });
    expect(await listKbItems(OTHER)).toEqual([]);
  });
});

describe('판정 순서(실 PG · AI 고르기만 대역)', () => {
  it('수신거부 명령 = 상담이 꺼져 있어도 · 단계가 닫혀 있어도 등록한다(회사의 활성 사용자 전부 + 동의 값) · AI 를 부르지 않는다', async () => {
    stage.state = 'closed';                                   // 설정도 없다
    const p = pickOf('1');
    const id = await inbound('수신 거부!');
    expect(await decideInbound(id, NOON(), p.deps)).toBe('optout');
    expect(await row(id)).toMatchObject({ status: 'optout', claim_token: null });
    const un = (await pool.query(`SELECT user_id, source FROM unsubscribes WHERE company_id = $1::uuid AND phone = $2 ORDER BY user_id`, [CO, CUST])).rows;
    expect(un.map((u: any) => [u.user_id, u.source])).toEqual([[ADMIN, 'inbound_sms'], [STAFF, 'inbound_sms']]);
    expect((await pool.query(`SELECT sms_opt_in FROM customers WHERE company_id = $1::uuid AND phone = $2`, [CO, CUST])).rows[0].sms_opt_in).toBe(false);
    expect(p.fn).not.toHaveBeenCalled();
    expect(await repliesOf(id)).toHaveLength(0);
  });
  it('격리가 켜진 회사의 수신거부 명령 = 자동 등록하지 않고 회사 담당자에게 알린다(고객 번호를 싣는다) · 사람 함', async () => {
    const id = await inbound('그만 보내세요', { to: N3 });
    expect(await decideInbound(id, NOON(), pickOf('1').deps)).toBe('human');
    expect((await row(id)).note).toContain('수신거부 요청');
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM unsubscribes WHERE company_id = $1::uuid`, [ISO])).rows[0].n).toBe(0);
    expect(notice.send).toHaveBeenCalledTimes(1);
    expect(notice.send.mock.calls[0][0]).toMatchObject({ companyId: ISO });
    expect(String(notice.send.mock.calls[0][2])).toContain(CUST);
  });
  it('명령은 아니지만 거부 낱말이 든 글 = 사람 함 · 등록 0 · AI 0 · 답장 0(「수신거부 취소」 · 「보내지 말아 달라니까요」)', async () => {
    await setup(); await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    for (const text of ['수신거부 취소해주세요', '이제 문자 좀 보내지 마시라고요']) {
      const p = pickOf('1');
      const id = await inbound(text, { from: `0107777${String(1000 + seq)}` });
      expect(await decideInbound(id, NOON(), p.deps)).toBe('human');
      expect((await row(id)).note).toContain('수신거부와 관련');
      expect(p.fn).not.toHaveBeenCalled();
      expect(await repliesOf(id)).toHaveLength(0);
    }
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM unsubscribes WHERE company_id = $1::uuid`, [CO])).rows[0].n).toBe(0);
  });
  it('단계를 읽지 못하면 아무것도 바꾸지 않는다(다음에 다시) · 닫힌 회사 · 상담 꺼 둠 = 사람 함', async () => {
    await setup(); await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    const id = await inbound('몇 시에 열어요?');
    stage.state = 'unknown';
    expect(await decideInbound(id, NOON(), pickOf('1').deps)).toBe('later');
    expect(await row(id)).toMatchObject({ status: 'new', claim_token: null });
    stage.state = 'closed';
    expect(await decideInbound(id, NOON(), pickOf('1').deps)).toBe('human');
    stage.state = 'open';
    await saveInboundSettings(CTX, settings({ enabled: false }), okGate);
    const off = await inbound('몇 시에 열어요?', { from: '01077770003' });
    expect(await decideInbound(off, NOON(), pickOf('1').deps)).toBe('human');
    expect((await row(off)).note).toContain('꺼져');
  });
  it('답장할 수 없는 번호 · 방식 = 끔 → 사람 함', async () => {
    await setup(); await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    const land = await inbound('몇 시에 열어요?', { from: '02-123-4567' });
    expect(await decideInbound(land, NOON(), pickOf('1').deps)).toBe('human');
    expect((await row(land)).note).toContain('답장할 수 없는');
    await setup({ mode: 'off' });
    const p = pickOf('1');
    const id = await inbound('몇 시에 열어요?');
    expect(await decideInbound(id, NOON(), p.deps)).toBe('human');
    expect(p.fn).not.toHaveBeenCalled();
  });
  it('바로 답장: 고른 항목의 글을 답장 행으로(꼬리 줄 · 발신번호 고정) · 받은 글 answered · 같은 문장이라 답장 행은 하나', async () => {
    await setup();
    await kb('주차', '지하 2층에 2시간 무료로 주차할 수 있어요.');
    const hours = await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    const p = pickOf('2');
    const id = await inbound('몇 시에 열어요?');
    expect(await decideInbound(id, NOON(), p.deps)).toBe('answered');
    expect(p.fn).toHaveBeenCalledTimes(1);
    expect(String(p.fn.mock.calls[0][0])).toContain('2. [영업시간]');
    expect(String(p.fn.mock.calls[0][1])).toBe('<문의>\n몇 시에 열어요?\n</문의>');
    expect(await row(id)).toMatchObject({ status: 'answered', handled_by: 'ai', kb_item_id: hours.id, claim_token: null });
    const out = await repliesOf(id);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'ready', handled_by: 'ai', from_phone: CUST, to_number: N1, company_id: CO, reply_callback: CB, kb_item_id: hours.id });
    expect(out[0].body).toBe(`평일 10시부터 19시까지 엽니다.\n이어서 문의하실 때는 ${N1}로 보내 주세요.`);
    // 다시 불러도 한 번(이미 new 가 아니다) · 표도 자동 답장 행 둘을 거절한다
    expect(await decideInbound(id, NOON(), p.deps)).toBe('skip');
    await expect(pool.query(
      `INSERT INTO inbound_messages (id, provider_msg_id, direction, from_phone, to_number, body, company_id, status, handled_by, reply_to, received_at)
       VALUES ($1::uuid, $2, 'out', $3, $4, '둘째', $5::uuid, 'ready', 'ai', $6::uuid, NOW())`, [randomUUID(), `out:dup-${id}`, CUST, N1, CO, id])).rejects.toThrow(/uq_inbound_messages_ai_reply/);
  });
  it('바로 답장: 「없음」 = 넘김 문장을 보내고 받은 글은 사람 함 · 「그만 받고 싶다는 뜻」(-1) · 잘못된 출력 · AI 오류 = 답장 없이 사람 함', async () => {
    await setup({ handoffText: '확인하고 연락드릴게요.', notifyPhone: '010-7777-9000' });
    await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    const none = await inbound('환불 규정이 어떻게 되나요?', { from: '01077770011' });
    expect(await decideInbound(none, NOON(), pickOf('0').deps)).toBe('handoff');
    expect(await row(none)).toMatchObject({ status: 'human', handled_by: 'ai' });
    expect((await repliesOf(none))[0].body.startsWith('확인하고 연락드릴게요.')).toBe(true);
    expect(notice.send).toHaveBeenCalledTimes(1);                                 // 알릴 번호로 한 통
    expect(notice.send.mock.calls[0][0]).toMatchObject({ adminPhoneNumbers: ['01077779000'], companyId: CO });
    for (const [answer, from] of [['-1', '01077770012'], ['영업시간이요', '01077770013'], [new Error('AI 끊김'), '01077770014']] as const) {
      const id = await inbound('문자 이제 됐어요', { from });
      expect(await decideInbound(id, NOON(), pickOf(answer as any).deps)).toBe('human');
      expect(await repliesOf(id)).toHaveLength(0);
    }
    expect(notice.send).toHaveBeenCalledTimes(1);                                 // 30분에 한 번
  });
  it('초안만: 고른 항목의 글 그대로가 초안(자유 작문 없음) · 답장 행 0 · 인증된 번호가 없어도 된다 · 「없음」 = 초안 없이 사람 함', async () => {
    await setup({ mode: 'draft' });
    const item = await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    const id = await inbound('몇 시에 열어요?');
    expect(await decideInbound(id, NIGHT(), pickOf('1').deps)).toBe('draft');     // 밤에도 초안은 만든다(보내지 않는다)
    expect(await row(id)).toMatchObject({ status: 'human', draft: '평일 10시부터 19시까지 엽니다.', kb_item_id: item.id });
    expect(await repliesOf(id)).toHaveLength(0);
    const none = await inbound('환불 되나요?', { from: '01077770021' });
    expect(await decideInbound(none, NOON(), pickOf('0').deps)).toBe('human');
    expect((await row(none)).draft).toBeNull();
  });
  it('바로 답장 · 야간 = waiting(AI 0) → 창이 열리면 워커가 new 로 되돌려 처음부터 판정', async () => {
    await setup(); await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    const p = pickOf('1');
    const id = await inbound('몇 시에 열어요?');
    expect(await decideInbound(id, NIGHT(), p.deps)).toBe('waiting');
    expect(p.fn).not.toHaveBeenCalled();
    expect((await runInboundPass(NIGHT, p.deps))).toMatchObject({ reopened: 0, decided: 0 });
    expect((await row(id)).status).toBe('waiting');
    const pass = await runInboundPass(NOON, p.deps);
    expect(pass).toMatchObject({ reopened: 1, decided: 1, sent: 1 });
    expect((await row(id)).status).toBe('answered');
    expect(calls).toHaveLength(1);
  });
  it('워커 한 바퀴 = 시각을 글마다 다시 읽는다 — 바퀴 도중에 자동 답장 시간이 끝나면 그 뒤의 글은 판정을 미루고 · 만들어 둔 답장은 나가지 않는다', async () => {
    await setup(); await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    const a = await inbound('몇 시에 열어요?', { from: '01077770045' });
    const b = await inbound('몇 시에 닫아요?', { from: '01077770046' });
    await pool.query(`UPDATE inbound_messages SET received_at = NOW() - interval '1 minute' WHERE id = $1::uuid`, [a]);   // a 가 먼저 판정된다
    // 읽는 차례 = 야간 대기 되돌리기 → a 판정 → b 판정 → a 의 답장 보내기 · 둘째 판정부터 21시가 지났다
    const times = [NOON(), NOON(), NIGHT(), NIGHT()];
    const clock = vi.fn(() => times.shift() || NIGHT());
    expect(await runInboundPass(clock, pickOf('1').deps)).toEqual({ reopened: 0, decided: 2, sent: 0 });
    expect(clock).toHaveBeenCalledTimes(4);
    expect((await row(b)).status).toBe('waiting');
    expect((await repliesOf(a))[0]).toMatchObject({ status: 'failed' });
    expect((await repliesOf(a))[0].note).toContain('자동 답장 시간');
    expect((await row(a)).status).toBe('human');
    expect(calls).toHaveLength(0);
  });
  it('워커가 보내는 답장도 활성화 순간의 시각으로 막힌다 — 바퀴가 읽어 둔 시각을 보내기에 넘기지 않는다(보내기가 쓰는 자리마다 읽는다)', async () => {
    await setup(); await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    const id = await inbound('몇 시에 열어요?', { from: '01077770047' });
    const times = [NOON(), NOON(), NOON(), NIGHT()];                              // 되돌리기 · 판정 · 보내기의 일찍 거르는 자리 · 활성화 문장이 도는 순간
    const clock = vi.fn(() => times.shift() || NIGHT());
    expect(await runInboundPass(clock, pickOf('1').deps)).toEqual({ reopened: 0, decided: 1, sent: 0 });
    expect(clock).toHaveBeenCalledTimes(4);
    expect(calls).toHaveLength(1);
    expect(calls[0].guardOk).toBe(false);
    expect((await repliesOf(id))[0].status).toBe('failed');
    expect((await row(id)).status).toBe('human');
  });
  it('답변 항목 0 · 답장 발신번호가 인증된 번호와 다름 = 사람 함(AI 0)', async () => {
    await setup();
    const p = pickOf('1');
    const a = await inbound('몇 시에 열어요?');
    expect(await decideInbound(a, NOON(), p.deps)).toBe('human');
    expect((await row(a)).note).toContain('답변 항목');
    await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    await pool.query(`UPDATE inbound_settings SET reply_callback = $2 WHERE company_id = $1::uuid`, [CO, CB2]);   // 인증 없이 바뀐 값(쓰는 함수 밖)
    const b = await inbound('몇 시에 열어요?', { from: '01077770031' });
    expect(await decideInbound(b, NOON(), p.deps)).toBe('human');
    expect((await row(b)).note).toContain('발신번호');
    expect(p.fn).not.toHaveBeenCalled();
  });
  it('AI 예산 = 같은 번호 하루 3번 · 회사 하루 상한 — 넘으면 AI 를 부르지 않고 사람 함(초안만 방식도 같은 예산)', async () => {
    await setup({ mode: 'draft', dailyCap: 5 });
    await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    const p = pickOf('1');
    for (let i = 0; i < 3; i += 1) expect(await decideInbound(await inbound(`문의 ${i}`), NOON(), p.deps)).toBe('draft');
    const fourth = await inbound('문의 4');
    expect(await decideInbound(fourth, NOON(), p.deps)).toBe('human');
    expect((await row(fourth)).note).toContain('넘었어요');
    expect(p.fn).toHaveBeenCalledTimes(3);
    // 회사 상한 5 = 다른 번호 둘까지
    for (const from of ['01077770041', '01077770042']) expect(await decideInbound(await inbound('문의', { from }), NOON(), p.deps)).toBe('draft');
    expect(await decideInbound(await inbound('문의', { from: '01077770043' }), NOON(), p.deps)).toBe('human');
    expect(p.fn).toHaveBeenCalledTimes(5);
    // 예산을 잡는 문장은 그 회사의 설정 행 잠금 뒤에 선다(다른 글의 예약과 겹쳐 상한을 넘지 않는다)
    await pool.query(`UPDATE inbound_settings SET daily_cap = 50 WHERE company_id = $1::uuid`, [CO]);
    const held = await inbound('잠금 대기', { from: '01077770044' });
    const holder = await pool.connect();
    await holder.query('BEGIN');
    await holder.query(`SELECT 1 FROM inbound_settings WHERE company_id = $1::uuid FOR UPDATE`, [CO]);
    let outcome: string = 'waiting';
    try {
      const deciding = decideInbound(held, NOON(), p.deps).then((o) => { outcome = o; return o; });
      await new Promise((r) => setTimeout(r, 400));
      expect(outcome).toBe('waiting');
      expect((await row(held)).ai_called_at).toBeNull();
      await holder.query('COMMIT');
      expect(await deciding).toBe('draft');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
    // 다른 회사의 예산은 따로
    await setup({ mode: 'draft' }, OCTX);
    await kb('영업시간', '10시에 엽니다.', OCTX);
    expect(await decideInbound(await inbound('문의', { to: N2 }), NOON(), p.deps)).toBe('draft');
  });
});

describe('보내기 — 보내는 순간 다시 본다(실 PG · 코어만 대역)', () => {
  async function answered(over: Record<string, unknown> = {}, from = CUST) {
    await setup(over);
    if ((await listKbItems(CO)).length === 0) await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    const id = await inbound('몇 시에 열어요?', { from });
    expect(await decideInbound(id, NOON(), pickOf('1').deps)).toBe('answered');
    return { id, reply: (await repliesOf(id))[0] };
  }
  it('보낸다 = 적재 한 행 · 광고 아님 · 받는 사람 1 · 발신번호는 답장 행에 고정한 값 · 출처 값을 싣지 않는다 · 활성화 조건이 참', async () => {
    const { id, reply } = await answered();
    expect(await sendReply(reply.id, NOON)).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0].staged).toEqual([CUST]);
    expect(calls[0].guardOk).toBe(true);
    expect(calls[0].marker).toBe('sending');
    expect(calls[0].spec).toMatchObject({ msgType: 'SMS', subject: null, callback: CB, adEnabled: false, total: 1, sendChannel: 'sms', unsubFilterEnabled: false, message: reply.body });
    expect(calls[0].spec.sendType).toBeUndefined();
    expect(calls[0].spec.campaignName).toBe('상담 답장 · ···0001');
    expect(calls[0].ctx).toMatchObject({ companyId: CO, userId: ADMIN });
    const out = (await repliesOf(id))[0];
    expect(out).toMatchObject({ status: 'sent', claim_token: null });
    expect(out.reply_campaign_id).toBeTruthy();
    expect(await sendReply(reply.id, NOON)).toBe('skip');                       // 다시 보내지 않는다
    expect(calls).toHaveLength(1);
  });
  it('상담을 끔 · 방식을 바꿈 · 발신번호를 바꿈 · 시간이 지남 · 날이 바뀜 = 보내지 않고 failed + 받은 글이 사람 함으로', async () => {
    const cases: Array<[string, () => Promise<unknown>, () => Date, string]> = [
      ['끔', () => saveInboundSettings(CTX, settings({ enabled: false }), okGate), NOON, '꺼져'],
      ['방식', () => saveInboundSettings(CTX, settings({ mode: 'draft' }), okGate), NOON, '설정이 바뀌어'],
      ['번호', () => saveInboundSettings(CTX, settings({ replyCallback: CB2 }), okGate), NOON, '발신번호가 바뀌어'],
      ['인증', () => pool.query(`UPDATE inbound_settings SET auth_callback = NULL WHERE company_id = $1::uuid`, [CO]), NOON, '발신번호가 바뀌어'],
      ['밤', async () => undefined, NIGHT, '자동 답장 시간'],
      ['다음 날', async () => undefined, TOMORROW, '자동 답장 시간'],
      ['닫힘', async () => { stage.state = 'closed'; }, NOON, '꺼져'],
      ['등록 풀림', async () => { reg.numbers = new Set(); }, NOON, '다시 골라'],
      ['라인그룹', async () => { reg.line = false; }, NOON, '다시 골라'],
    ];
    let n = 50;
    for (const [name, change, at, word] of cases) {
      stage.state = 'open'; reg.line = true; reg.numbers = new Set([CB, CB2]);
      n += 1;
      const { id, reply } = await answered({}, `010777700${n}`);
      await change();
      expect(await sendReply(reply.id, at), name).toBe('failed');
      expect((await repliesOf(id))[0], name).toMatchObject({ status: 'failed', claim_token: null });
      expect((await repliesOf(id))[0].note, name).toContain(word);
      expect(await row(id), name).toMatchObject({ status: 'human' });
      expect((await row(id)).note, name).toContain('답장이 나가지 않았어요');
    }
    expect(calls).toHaveLength(0);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM campaign_send_staging WHERE company_id = $1::uuid`, [CO])).rows[0].n).toBe(0);
  });
  it('단계를 읽지 못하면 그대로 둔다(다음에 다시) · 활성화 조건은 설정이 바뀌면 거짓', async () => {
    const { reply } = await answered();
    stage.state = 'unknown';
    expect(await sendReply(reply.id, NOON)).toBe('later');
    expect((await pool.query('SELECT status, claim_token FROM inbound_messages WHERE id = $1::uuid', [reply.id])).rows[0]).toEqual({ status: 'ready', claim_token: null });
    // 활성화 조건(코어가 차감 뒤 활성화 문장에 거는 것) — 표식이 내 것이고 설정이 그대로일 때만 참
    const token = randomUUID();
    await pool.query(`UPDATE inbound_messages SET claim_token = $2::uuid WHERE id = $1::uuid`, [reply.id, token]);
    const guard = async (id: string, t: string, at: Date = NOON()) => (await pool.query(`SELECT ${guardSql(INBOUND_ACTIVATION_GUARD_SQL)} AS ok`, [id, t, skewOf(at)])).rows[0].ok;
    expect(await guard(reply.id, token)).toBe(true);
    expect(await guard(reply.id, randomUUID())).toBe(false);
    // 자동 답장의 마지막 문 = 활성화 문장이 도는 그 순간의 시각(DB 의 지금 + 시계 차) — 만든 날의 08 ~ 21시 안일 때만 참
    const kst = (hm: string, plusDays = 0) => new Date(new Date(`${day()}T${hm}:00+09:00`).getTime() + plusDays * 24 * 3600 * 1000);
    for (const [hm, ok] of [['07:55', false], ['08:05', true], ['20:55', true], ['21:05', false], ['23:30', false], ['00:30', false]] as const) expect(await guard(reply.id, token, kst(hm)), hm).toBe(ok);
    expect(await guard(reply.id, token, kst('12:00', 1))).toBe(false);           // 다음 날 같은 시각 = 만든 날이 아니다
    expect(await guard(reply.id, token, kst('12:00', -1))).toBe(false);
    await pool.query(`UPDATE inbound_settings SET mode = 'draft' WHERE company_id = $1::uuid`, [CO]);
    expect(await guard(reply.id, token)).toBe(false);
    await pool.query(`UPDATE inbound_settings SET mode = 'auto', enabled = false WHERE company_id = $1::uuid`, [CO]);
    expect(await guard(reply.id, token)).toBe(false);
    await pool.query(`UPDATE inbound_settings SET enabled = true, auth_callback = $2 WHERE company_id = $1::uuid`, [CO, CB2]);
    expect(await guard(reply.id, token)).toBe(false);
    await pool.query(`UPDATE inbound_settings SET auth_callback = $2, reply_callback = $2 WHERE company_id = $1::uuid`, [CO, CB2]);
    expect(await guard(reply.id, token)).toBe(false);
    // 설정의 발신번호만 다른 번호(인증된 번호는 답장 행과 같다) = 거짓 — 설정이 가리키는 번호로만 나간다
    await pool.query(`UPDATE inbound_settings SET auth_callback = $2, reply_callback = $3 WHERE company_id = $1::uuid`, [CO, CB, CB2]);
    expect(await guard(reply.id, token)).toBe(false);
    // 사람 답장 행 = 인증된 번호 · 방식은 보지 않지만 설정의 발신번호와는 같아야 한다
    await pool.query(`UPDATE inbound_messages SET handled_by = 'human' WHERE id = $1::uuid`, [reply.id]);
    expect(await guard(reply.id, token)).toBe(false);
    await pool.query(`UPDATE inbound_settings SET mode = 'off', auth_callback = NULL, reply_callback = $2 WHERE company_id = $1::uuid`, [CO, CB]);
    expect(await guard(reply.id, token)).toBe(true);
    expect(await guard(reply.id, token, NIGHT())).toBe(true);                    // 사람이 누른 답장은 시간을 보지 않는다
    expect(await guard(reply.id, token, TOMORROW())).toBe(true);
    await pool.query(`UPDATE inbound_settings SET enabled = false WHERE company_id = $1::uuid`, [CO]);
    expect(await guard(reply.id, token)).toBe(false);
  });
  it('보내는 도중에 21시를 넘기면 나가지 않는다 — 앞에서 읽은 시각으로 통과해도 마지막 문(활성화 문장의 조건)이 그 순간의 시각으로 막는다', async () => {
    const { id, reply } = await answered({}, '01077770078');
    const times = [NOON(), NIGHT()];                                             // 일찍 거르는 자리 = 낮 · 활성화 문장이 도는 순간 = 밤
    const clock = vi.fn(() => times.shift() || NIGHT());
    expect(await sendReply(reply.id, clock)).toBe('failed');
    expect(clock).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].guardOk).toBe(false);                                        // 코어까지 갔지만 활성화 조건이 거짓 = 큐에 오르지 않는다(코어가 중화 · 환불 의무 기록)
    expect((await repliesOf(id))[0]).toMatchObject({ status: 'failed', claim_token: null, reply_campaign_id: null });
    expect((await row(id)).status).toBe('human');
    expect((await pool.query(`SELECT send_phase FROM campaigns WHERE staging_id = $1::uuid`, [calls[0].spec.stagingId])).rows.map((r: any) => r.send_phase)).toEqual(['failed']);
    // 사람이 누른 답장은 같은 순서에서도 나간다(시간을 보지 않는다)
    const rid = randomUUID();
    const later = [NOON(), NIGHT()];
    await pool.query(`UPDATE inbound_messages SET status = 'human' WHERE id = $1::uuid`, [id]);
    await pool.query(
      `INSERT INTO inbound_messages (id, provider_msg_id, direction, from_phone, to_number, body, company_id, status, handled_by, reply_to, reply_callback, received_at)
       VALUES ($1::uuid, $2, 'out', '01077770078', $3, '직접 쓴 답장', $4::uuid, 'ready', 'human', $5::uuid, $6, NOW())`, [rid, `out:${rid}`, N1, CO, id, CB]);
    expect(await sendReply(rid, () => later.shift() || NIGHT())).toBe('sent');
    expect(calls[1].guardOk).toBe(true);
  });
  it('활성화 문장이 답장 행의 잠금을 기다리는 사이 21시를 넘기면 거짓 — 시각은 잠금을 얻은 뒤의 실제 지금으로 본다(문장을 시작한 시각이 아니다)', async () => {
    const { reply } = await answered({}, '01077770079');
    const token = randomUUID();
    await pool.query(`UPDATE inbound_messages SET claim_token = $2::uuid WHERE id = $1::uuid`, [reply.id, token]);
    // 코어의 활성화 문장 글자 그대로(direct-send-core · 계약 시험이 그 글자를 고정한다) — 조건은 그 뒤에 붙고 값은 캠페인 id 뒤에 온다
    const campaignId = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { id: campaignId, company_id: CO, send_phase: 'preparing', status: 'sending', campaign_name: '활성화 문장 시험' });
    const activate = (skew: number) => pool.query(
      `UPDATE campaigns SET send_phase = 'queued', updated_at = NOW() WHERE id = $1 AND send_phase = 'preparing' AND ${INBOUND_ACTIVATION_GUARD_SQL}`, [campaignId, reply.id, token, skew]);
    const dbNowMs = async () => Number((await pool.query(`SELECT EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS ms`)).rows[0].ms);
    const nine = new Date(`${day()}T21:00:00+09:00`).getTime();
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM inbound_messages WHERE id = $1::uuid FOR UPDATE`, [reply.id]);   // 다른 쓰기가 그 답장 행을 쥐고 있다
      const skew = (nine - 1000 - await dbNowMs()) / 1000;                       // DB 의 시계로 지금 = 20:59:59 → 문장을 시작할 때는 자동 답장 시간 안
      let settled = false;
      const waiting = activate(skew).then((r) => { settled = true; return r; });
      await new Promise((r) => setTimeout(r, 2000));                             // 잠금을 기다리는 사이 21:00:01 이 된다
      expect(settled).toBe(false);
      await holder.query('COMMIT');
      expect((await waiting).rowCount).toBe(0);                                   // 큐에 오르지 않는다
      expect((await pool.query(`SELECT send_phase FROM campaigns WHERE id = $1::uuid`, [campaignId])).rows[0].send_phase).toBe('preparing');
      expect((await activate(skew - 3600)).rowCount).toBe(1);                     // 시각 말고는 조건이 다 맞는 행이다(한 시간 앞이면 오른다)
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });
  it('다시 만난 sending = 발송 단계로 대조한다(코어를 다시 부르지 않는다) · 캠페인이 없으면 다시 보낸다 · 모르면 failed + 운영 경보', async () => {
    const stale = async (replyId: string, staging: string) => pool.query(
      `UPDATE inbound_messages SET status = 'sending', reply_staging_id = $2::uuid, claim_token = $3::uuid, claimed_at = NOW() - interval '6 minutes' WHERE id = $1::uuid`, [replyId, staging, randomUUID()]);
    // queued = 나갔다
    const a = await answered({}, '01077770061');
    const sa = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { id: randomUUID(), company_id: CO, staging_id: sa, send_phase: 'queued', status: 'sending', campaign_name: '죽기 전에 나간 답장' });
    await stale(a.reply.id, sa);
    expect(await sendReply(a.reply.id, NOON)).toBe('sent');
    expect(calls).toHaveLength(0);
    // 쥔 지 얼마 안 된 표식은 건너뛴다
    const b = await answered({}, '01077770062');
    await pool.query(`UPDATE inbound_messages SET status = 'sending', reply_staging_id = $2::uuid, claim_token = $3::uuid, claimed_at = NOW() WHERE id = $1::uuid`, [b.reply.id, randomUUID(), randomUUID()]);
    expect(await sendReply(b.reply.id, NOON)).toBe('skip');
    // 캠페인이 없다 = 안 나갔다 → 다시 보낸다(한 번)
    await pool.query(`UPDATE inbound_messages SET claimed_at = NOW() - interval '6 minutes' WHERE id = $1::uuid`, [b.reply.id]);
    expect(await sendReply(b.reply.id, NOON)).toBe('sent');
    expect(calls).toHaveLength(1);
    // 중화된 캠페인(failed) = failed · preparing = 모름 → failed + 운영 경보(다시 보내지 않는다)
    const c = await answered({}, '01077770063');
    const sc = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { id: randomUUID(), company_id: CO, staging_id: sc, send_phase: 'failed', status: 'failed', campaign_name: '중화' });
    await stale(c.reply.id, sc);
    expect(await sendReply(c.reply.id, NOON)).toBe('failed');
    const d = await answered({}, '01077770064');
    const sd = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { id: randomUUID(), company_id: CO, staging_id: sd, send_phase: 'preparing', status: 'sending', campaign_name: '모름' });
    await stale(d.reply.id, sd);
    expect(await sendReply(d.reply.id, NOON)).toBe('failed');
    expect(alert.send).toHaveBeenCalledTimes(1);
    expect((await row(d.id)).status).toBe('human');
    expect(calls).toHaveLength(1);
  });
  it('표식을 잃은 실행은 아무것도 쓰지 않는다 = 판정은 답장 행을 만들지 않고 · 보내기는 상태를 덮지 않는다(다음 실행이 대조로 맞춘다)', async () => {
    await setup(); await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    // 판정: AI 를 기다리는 사이 다른 실행이 표식을 가져갔다
    const id = await inbound('몇 시에 열어요?', { from: '01077770075' });
    const taken = vi.fn(async () => { await pool.query(`UPDATE inbound_messages SET claim_token = $2::uuid WHERE id = $1::uuid`, [id, randomUUID()]); return '1'; });
    expect(await decideInbound(id, NOON(), { pick: taken })).toBe('lost');
    expect(await repliesOf(id)).toHaveLength(0);
    expect((await row(id)).status).toBe('new');
    // 보내기: 코어를 부르는 사이 표식을 잃었다 → sent 로 덮지 않는다 · 임대가 지난 뒤 대조가 그 캠페인을 찾아 sent(코어는 한 번만)
    const a = await answered({}, '01077770076');
    const ok = core.create.getMockImplementation()!;
    core.create.mockImplementationOnce(async (spec: any, ctx: any) => {
      const out = await ok(spec, ctx);
      await pool.query(`UPDATE inbound_messages SET claim_token = $2::uuid, claimed_at = NOW() - interval '6 minutes' WHERE id = $1::uuid`, [a.reply.id, randomUUID()]);
      return out;
    });
    expect(await sendReply(a.reply.id, NOON)).toBe('lost');
    expect((await repliesOf(a.id))[0]).toMatchObject({ status: 'sending', reply_campaign_id: null });
    expect(await sendReply(a.reply.id, NOON)).toBe('sent');
    expect(calls).toHaveLength(1);
    expect((await repliesOf(a.id))[0].reply_campaign_id).toBeTruthy();
    // 답장 행 없이 받은 글만 바꾸는 길(초안만 · 사람 함)도 같다 — 표식을 잃었으면 상태를 덮지 않는다
    await setup({ mode: 'draft' });
    const d = await inbound('환불 되나요?', { from: '01077770077' });
    const other = randomUUID();
    const gone = vi.fn(async () => { await pool.query(`UPDATE inbound_messages SET claim_token = $2::uuid WHERE id = $1::uuid`, [d, other]); return '0'; });
    expect(await decideInbound(d, NOON(), { pick: gone })).toBe('lost');
    expect(await row(d)).toMatchObject({ status: 'new', claim_token: other, note: null });
  });
  it('코어가 확실히 안 받음(잔액) = failed + 적재 정리 · 결과를 모르는 오류는 대조로 맞춘다', async () => {
    const a = await answered({}, '01077770071');
    core.create.mockImplementationOnce(async () => { throw new DirectSendError('INSUFFICIENT_BALANCE', '잔액이 부족합니다.', 402); });
    expect(await sendReply(a.reply.id, NOON)).toBe('failed');
    expect((await repliesOf(a.id))[0].note).toContain('잔액');
    expect((await row(a.id)).status).toBe('human');
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM campaign_send_staging WHERE company_id = $1::uuid`, [CO])).rows[0].n).toBe(0);
    // 코어가 캠페인을 만들고 응답만 끊김 = 나간 것
    const b = await answered({}, '01077770072');
    const ok = core.create.getMockImplementation()!;
    core.create.mockImplementationOnce(async (spec: any, ctx: any) => { await ok(spec, ctx); throw new Error('연결 끊김'); });
    expect(await sendReply(b.reply.id, NOON)).toBe('sent');
    // 캠페인도 없이 끊김 = 안 나간 것 → failed
    const c = await answered({}, '01077770073');
    core.create.mockImplementationOnce(async () => { throw new Error('연결 끊김'); });
    expect(await sendReply(c.reply.id, NOON)).toBe('failed');
    expect((await row(c.id)).status).toBe('human');
  });
});

describe('사람 답장 · 닫기 · 조회(실 PG)', () => {
  it('사람 답장 = 설정의 답장 발신번호로 인증 → 그 번호를 고정한 답장 행 → 보낸다 · 같은 id 두 번 = 한 번 · 「초안만」 방식(인증된 번호 없음)에서도 나간다', async () => {
    await setup({ mode: 'draft' });
    const id = await inbound('환불 되나요?');
    await decideInbound(id, NOON(), pickOf('0').deps);
    const replyId = randomUUID();
    await expect(humanReply(CTX, id, replyId, '   ', okGate, NIGHT())).rejects.toMatchObject({ code: 'INBOUND_TEXT' });
    expect(await humanReply(CTX, id, replyId, '네, 7일 안에 가능합니다.', noGate, NIGHT())).toMatchObject({ done: false });
    expect(await repliesOf(id)).toHaveLength(0);
    expect(await readHumanReply(CTX, replyId)).toBeNull();
    expect(await humanReply(CTX, id, replyId, '네, 7일 안에 가능합니다.', okGate, NIGHT())).toEqual({ done: true, outcome: 'sent', reply: { id: replyId, status: 'sent', note: null } });   // 밤에도 사람이 누른 발송은 나간다
    expect(await readHumanReply(CTX, replyId)).toEqual({ id: replyId, status: 'sent', note: null });
    expect(await readHumanReply(OCTX, replyId)).toBeNull();                       // 남의 회사 답장은 읽지 못한다
    expect(gateCalls.slice(-2)).toEqual([CB, CB]);
    const out = await repliesOf(id);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: replyId, status: 'sent', handled_by: 'human', reply_callback: CB });
    expect(await row(id)).toMatchObject({ status: 'answered', handled_by: 'human', draft: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].guardOk).toBe(true);
    // 같은 id 로 다시 = 새로 만들지도 다시 보내지도 않는다
    expect(await humanReply(CTX, id, replyId, '다른 글', okGate, NOON())).toEqual({ done: true, outcome: 'skip', reply: { id: replyId, status: 'sent', note: null } });
    expect(calls).toHaveLength(1);
    expect((await repliesOf(id))[0].body.startsWith('네, 7일 안에 가능합니다.')).toBe(true);
  });
  it('사람 답장 행 = 누른 뒤에 설정의 발신번호가 바뀌면 나가지 않는다 · 방식 · 시간 · 인증된 번호는 보지 않는다', async () => {
    await setup({ mode: 'off' });
    const id = await inbound('문의');
    await decideInbound(id, NOON());
    const mk = async () => {
      const rid = randomUUID();
      await pool.query(
        `INSERT INTO inbound_messages (id, provider_msg_id, direction, from_phone, to_number, body, company_id, status, handled_by, reply_to, reply_callback, received_at)
         VALUES ($1::uuid, $2, 'out', $3, $4, '직접 쓴 답장', $5::uuid, 'ready', 'human', $6::uuid, $7, NOW())`, [rid, `out:${rid}`, CUST, N1, CO, id, CB]);
      return rid;
    };
    const a = await mk();
    expect(await sendReply(a, NIGHT)).toBe('sent');                          // 방식 = 끔 · 밤 · 인증된 번호 없음이어도 사람이 누른 답장은 나간다
    expect(calls).toHaveLength(1);
    expect(calls[0].guardOk).toBe(true);
    const b = await mk();
    await saveInboundSettings(CTX, settings({ mode: 'off', replyCallback: CB2 }), okGate);
    expect(await sendReply(b, NOON)).toBe('failed');
    expect((await pool.query('SELECT note FROM inbound_messages WHERE id = $1::uuid', [b])).rows[0].note).toContain('발신번호가 바뀌어');
    expect(calls).toHaveLength(1);
  });
  it('남의 회사 글 · 수신거부한 고객 · 상담 꺼 둠 · 아직 판정하지 않은 글에는 답하지 못한다', async () => {
    await setup();
    const id = await inbound('문의');
    await expect(humanReply(OCTX, id, randomUUID(), '답', okGate)).rejects.toMatchObject({ code: 'INBOUND_NOT_FOUND' });
    // 판정 전(new) — 워커가 쥐었든 아니든 답하지 않는다(수신거부 요청인지부터 본다)
    await expect(humanReply(CTX, id, randomUUID(), '답', okGate)).rejects.toMatchObject({ code: 'INBOUND_NOT_DECIDED' });
    expect(await repliesOf(id)).toHaveLength(0);
    expect(gateCalls).toHaveLength(1);                                            // 설정 저장의 한 번뿐 — 판정 전 글은 발신 인증까지도 가지 않는다
    // 방금 온 「수신거부」에 사람이 먼저 답해 그 등록이 빠지는 일이 없다: 판정 전 = 거절 → 판정 = 수신거부 등록 → 그 뒤에도 거절
    const stop = await inbound('수신거부', { from: '01077770083' });
    await expect(humanReply(CTX, stop, randomUUID(), '네, 처리했습니다.', okGate)).rejects.toMatchObject({ code: 'INBOUND_NOT_DECIDED' });
    expect(await decideInbound(stop, NOON())).toBe('optout');
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM unsubscribes WHERE company_id = $1::uuid AND phone = '01077770083'`, [CO])).rows[0].n).toBeGreaterThan(0);
    await expect(humanReply(CTX, stop, randomUUID(), '네, 처리했습니다.', okGate)).rejects.toMatchObject({ code: 'INBOUND_OPTOUT' });
    expect(await repliesOf(stop)).toHaveLength(0);
    // 발신 인증을 지나는 사이에 야간 대기가 풀려 다시 판정 전이 된 글 = 답장 행을 만들지 않는다(넣는 문장이 그 순간의 상태로 가른다)
    const night = await inbound('밤에 온 문의', { from: '01077770086' });
    await pool.query(`UPDATE inbound_messages SET status = 'waiting' WHERE id = $1::uuid`, [night]);
    const reopening: SenderGate = async () => { await pool.query(`UPDATE inbound_messages SET status = 'new' WHERE id = $1::uuid`, [night]); return { ok: true }; };
    await expect(humanReply(CTX, night, randomUUID(), '답', reopening)).rejects.toMatchObject({ code: 'INBOUND_STATE' });
    expect(await repliesOf(night)).toHaveLength(0);
    expect((await row(night)).status).toBe('new');
    // 남의 답장 행 id 를 내 글의 답장 id 로 쓸 수 없다
    const mine = randomUUID();
    await pool.query(`UPDATE inbound_messages SET status = 'human' WHERE id = $1::uuid`, [id]);
    expect((await humanReply(CTX, id, mine, '답', okGate, NOON())).done).toBe(true);
    const other = await inbound('다른 문의', { from: '01077770081' });
    await pool.query(`UPDATE inbound_messages SET status = 'human' WHERE id = $1::uuid`, [other]);
    await expect(humanReply(CTX, other, mine, '답', okGate)).rejects.toMatchObject({ code: 'INBOUND_ID' });
    const out = await inbound('수신거부', { from: '01077770082' });
    await decideInbound(out, NOON());
    await expect(humanReply(CTX, out, randomUUID(), '답', okGate)).rejects.toMatchObject({ code: 'INBOUND_OPTOUT' });
    await saveInboundSettings(CTX, settings({ enabled: false }), okGate);
    await expect(humanReply(CTX, other, randomUUID(), '답', okGate)).rejects.toMatchObject({ code: 'INBOUND_OFF' });
  });
  it('답 없이 닫기 = 사람 필요인 글만 · 상담함 조회 = 회사 것만 · 열쇠는 받은 글 id(번호를 주소에 싣지 않는다)', async () => {
    await setup({ mode: 'off' });
    const a = await inbound('첫 문의');
    const b = await inbound('둘째 문의');
    const o = await inbound('다른 회사 문의', { to: N2, from: '01077770091' });
    const same = await inbound('같은 고객이 다른 회사에 보낸 글', { to: N2 });   // 고객 번호가 같아도 회사가 다르면 다른 대화
    for (const id of [a, b]) await decideInbound(id, NOON());
    await pool.query(`UPDATE inbound_messages SET received_at = NOW() - interval '5 minutes' WHERE id = $1::uuid`, [a]);   // a 가 b 보다 먼저 온 글
    expect(await inboxStatus(CO)).toEqual({ enabled: true, numbers: [N1], human: 2 });
    expect(await inboxStatus(OTHER)).toMatchObject({ enabled: false, numbers: [N2], human: 0 });
    const list = await listThreads(CO, 'human');
    expect(list.counts).toMatchObject({ human: 2, today: 2, waiting: 0 });
    expect(list.threads).toHaveLength(1);
    expect(list.threads[0]).toMatchObject({ key: b, phoneMasked: '···0001', human: 2, lastBody: '둘째 문의' });
    const thread = await readThread(CO, list.threads[0].key);
    expect(thread).toMatchObject({ phone: CUST, toNumber: N1, canReply: true });
    expect(thread!.messages.map((m) => [m.direction, m.body, m.status])).toEqual([['in', '첫 문의', 'human'], ['in', '둘째 문의', 'human']]);
    expect(await readThread(CO, o)).toBeNull();                                   // 남의 회사 글의 id 로는 못 연다
    expect(await readThread(CO, same)).toBeNull();
    expect((await readThread(OTHER, same))!.messages.map((m) => m.body)).toEqual(['같은 고객이 다른 회사에 보낸 글']);
    expect(await readThread(OTHER, a)).toBeNull();
    expect(await closeInbound(OCTX, a)).toBe(false);
    expect(await closeInbound(CTX, a)).toBe(true);                               // a 만 닫힌다(그 뒤에 온 b 는 그대로)
    expect(await closeInbound(CTX, a)).toBe(false);
    expect([(await row(a)).status, (await row(b)).status]).toEqual(['done', 'human']);
    expect((await listThreads(CO, 'human')).counts.human).toBe(1);
    expect((await listThreads(OTHER, 'all')).threads).toHaveLength(2);
    expect(await companyInboundNumbers(CO)).toEqual([N1]);
  });
  it('같은 id 의 요청이 겹쳐도 뒤에 온 요청은 받은 글을 덮지 않는다 — 먼저 온 요청의 답장이 안 나가 「사람 필요」로 돌아온 글이 「답함」으로 바뀌지 않는다', async () => {
    await setup({ mode: 'off' });
    const id = await inbound('환불 되나요?');
    await decideInbound(id, NOON());
    const replyId = randomUUID();
    core.create.mockImplementationOnce(async () => { throw new DirectSendError('INSUFFICIENT_BALANCE', '잔액이 부족합니다.', 402); });
    // 바깥 요청이 「이미 있는 id 인가」를 본 뒤 · 답장 행을 넣기 전(발신 인증 자리)에 같은 id 의 다른 요청이 끝까지 간다(잔액 부족으로 안 나감)
    let inner: unknown = null;
    const racingGate: SenderGate = async () => { inner = await humanReply(CTX, id, replyId, '네, 가능합니다.', okGate, NOON()); return { ok: true }; };
    const outer = await humanReply(CTX, id, replyId, '네, 가능합니다.', racingGate, NOON());
    expect(inner).toMatchObject({ done: true, outcome: 'failed', reply: { id: replyId, status: 'failed' } });
    expect(outer).toMatchObject({ done: true, outcome: 'skip', reply: { id: replyId, status: 'failed' } });
    expect((outer as any).reply.note).toContain('잔액');
    expect(await row(id)).toMatchObject({ status: 'human' });
    expect((await row(id)).note).toContain('답장이 나가지 않았어요');
    expect(await repliesOf(id)).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
  it('답장 · 닫기 = 대화 단위 — 그 글과 그 앞의 「사람 필요」 글이 함께 바뀐다(그 뒤에 온 글 · 다른 고객의 글은 그대로)', async () => {
    await setup({ mode: 'off' });
    const at = (id: string, minutesAgo: number) => pool.query(`UPDATE inbound_messages SET received_at = NOW() - make_interval(mins => $2::int) WHERE id = $1::uuid`, [id, minutesAgo]);
    const a = await inbound('첫 문의'); const b = await inbound('둘째 문의'); const c = await inbound('셋째 문의');
    const other = await inbound('다른 고객 문의', { from: '01077770084' });
    const abroad = await inbound('같은 고객이 다른 회사에 보낸 문의', { to: N2 });   // 고객 번호가 같아도 남의 회사 글은 건드리지 않는다
    const old = await inbound('오래전에 닫은 문의');                                 // 사람 필요가 아닌 앞 글(닫음)은 답장이 건드리지 않는다
    for (const id of [a, b, c, other, abroad, old]) await decideInbound(id, NOON());
    await at(a, 30); await at(b, 20); await at(c, 10); await at(other, 25); await at(abroad, 40); await at(old, 50);
    await pool.query(`UPDATE inbound_messages SET status = 'done' WHERE id = $1::uuid`, [old]);
    expect((await row(abroad)).status).toBe('human');
    expect((await humanReply(CTX, b, randomUUID(), '두 문의에 함께 답합니다.', okGate, NOON())).done).toBe(true);
    expect([(await row(a)).status, (await row(b)).status, (await row(c)).status, (await row(other)).status, (await row(abroad)).status, (await row(old)).status]).toEqual(['answered', 'answered', 'human', 'human', 'human', 'done']);
    expect([(await repliesOf(b)).length, (await repliesOf(a)).length, (await repliesOf(old)).length]).toEqual([1, 0, 0]);   // 답장 행은 가리킨 글에 달린다
    // 닫기 — 가리킨 글이 「사람 필요」일 때만 · 그 앞의 사람 필요 글도 함께
    expect(await closeInbound(CTX, b)).toBe(false);                               // 이미 답한 글은 닫을 것이 없다
    const fresh = await inbound('방금 온 글');                                     // 판정 전 글을 가리키면 그 앞의 사람 필요 글(c)도 닫지 않는다
    expect(await closeInbound(CTX, fresh)).toBe(false);
    expect((await row(c)).status).toBe('human');
    const d = await inbound('넷째 문의'); await decideInbound(d, NOON());
    expect(await closeInbound(CTX, d)).toBe(true);
    expect([(await row(c)).status, (await row(d)).status, (await row(fresh)).status, (await row(other)).status, (await row(abroad)).status]).toEqual(['done', 'done', 'new', 'human', 'human']);
    expect((await row(a)).status).toBe('answered');
    expect((await listThreads(CO, 'human')).counts.human).toBe(1);
  });
  it('사람 답장 · 닫기는 가리킨 글을 잠그고 그 순간의 상태로 가른다 — 다른 쓰기와 겹치면 기다렸다가 다시 본다(읽어 둔 옛 상태로 쓰지 않는다)', async () => {
    await setup();
    const held = async (sql: string, params: unknown[], act: () => Promise<unknown>) => {
      const holder = await pool.connect();
      let end = 'waiting';
      try {
        await holder.query('BEGIN');
        await holder.query(sql, params);                                           // 다른 쓰기(아직 커밋 전)
        const acting = act().then((v) => { end = `ok:${String(v)}`; }, (e) => { end = String(e?.code); });
        await new Promise((r) => setTimeout(r, 400));
        expect(end).toBe('waiting');                                              // 잠금 뒤에 서 있다
        await holder.query('COMMIT');
        await acting;
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }
      return end;
    };
    // 답장: 야간 대기(waiting)를 워커가 판정 전(new)으로 되돌리는 순간과 겹침 → 판정 전 글이 됐으므로 답장 행을 만들지 않는다(자동 답장과 둘이 나가지 않는다)
    const night = await inbound('밤에 온 문의', { from: '01077770089' });
    await pool.query(`UPDATE inbound_messages SET status = 'waiting' WHERE id = $1::uuid`, [night]);
    expect(await held(`UPDATE inbound_messages SET status = 'new' WHERE id = $1::uuid`, [night], () => humanReply(CTX, night, randomUUID(), '답', okGate, NOON()))).toBe('INBOUND_STATE');
    expect(await repliesOf(night)).toHaveLength(0);
    expect((await row(night)).status).toBe('new');
    expect(calls).toHaveLength(0);
    // 닫기: 가리킨 글이 그 사이 답함이 됐다 → 그 앞의 사람 필요 글도 닫지 않는다
    const a = await inbound('앞 문의', { from: '01077770090' });
    const b = await inbound('뒤 문의', { from: '01077770090' });
    await pool.query(`UPDATE inbound_messages SET status = 'human', received_at = NOW() - interval '5 minutes' WHERE id = $1::uuid`, [a]);
    await pool.query(`UPDATE inbound_messages SET status = 'human' WHERE id = $1::uuid`, [b]);
    expect(await held(`UPDATE inbound_messages SET status = 'answered' WHERE id = $1::uuid`, [b], () => closeInbound(CTX, b))).toBe('ok:false');
    expect([(await row(a)).status, (await row(b)).status]).toEqual(['human', 'answered']);
  });
  it('답장 · 닫기는 그 대화의 글을 대화의 차례대로 잠근다 — 앞 글의 잠금을 기다리는 동안 뒤 글을 쥐고 있지 않다(둘이 엇갈려 멈추지 않는다)', async () => {
    await setup({ mode: 'off' });
    const trio = async (from: string) => {
      const ids = [await inbound('첫 글', { from }), await inbound('둘째 글', { from }), await inbound('셋째 글', { from })];
      for (const id of ids) await decideInbound(id, NOON());
      for (const [i, id] of ids.entries()) await pool.query(`UPDATE inbound_messages SET received_at = NOW() - make_interval(mins => $2::int) WHERE id = $1::uuid`, [id, 30 - i * 10]);
      return ids;
    };
    /** 가장 앞 글(a)을 다른 쓰기가 쥔 동안 act 를 돌린다 → 그동안 뒤 글(b · c)이 잠겨 있지 않아야 한다 */
    const whileFirstHeld = async (ids: string[], act: () => Promise<unknown>) => {
      const holder = await pool.connect();
      const probe = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT 1 FROM inbound_messages WHERE id = $1::uuid FOR UPDATE`, [ids[0]]);
        let settled = false;
        const acting = act().then((v) => { settled = true; return v; });
        await new Promise((r) => setTimeout(r, 400));
        expect(settled).toBe(false);                                             // 앞 글의 잠금 뒤에 서 있다
        await probe.query('BEGIN');
        const free = (await probe.query(`SELECT id FROM inbound_messages WHERE id = ANY($1::uuid[]) ORDER BY received_at FOR UPDATE SKIP LOCKED`, [ids.slice(1)])).rows.map((r: any) => String(r.id));
        await probe.query('ROLLBACK');
        expect(free).toEqual(ids.slice(1));                                      // 뒤 글 둘은 아무도 쥐고 있지 않다
        await holder.query('COMMIT');
        return await acting;
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await probe.query('ROLLBACK').catch(() => undefined);
        holder.release(); probe.release();
      }
    };
    const x = await trio('01077770093');
    expect(await whileFirstHeld(x, () => humanReply(CTX, x[2], randomUUID(), '세 문의에 함께 답합니다.', okGate, NOON()))).toMatchObject({ done: true, outcome: 'sent' });
    for (const id of x) expect((await row(id)).status).toBe('answered');
    const y = await trio('01077770094');
    expect(await whileFirstHeld(y, () => closeInbound(CTX, y[2]))).toBe(true);
    for (const id of y) expect((await row(id)).status).toBe('done');
  });
  it('답장이 안 나간 것으로 끝날 때도 받은 글부터 잠근다 — 받은 글의 잠금을 기다리는 동안 답장 행을 쥐고 있지 않다(받은 글을 쥔 같은 답장 id 의 겹친 요청과 엇갈려 멈추지 않는다)', async () => {
    await setup(); await kb('영업시간', '평일 10시부터 19시까지 엽니다.');
    const id = await inbound('몇 시에 열어요?', { from: '01077770096' });
    expect(await decideInbound(id, NOON(), pickOf('1').deps)).toBe('answered');
    const reply = (await repliesOf(id))[0];
    await saveInboundSettings(CTX, settings({ enabled: false }), okGate);          // 보내는 순간 「꺼짐」 → 안 나간 것으로 끝난다
    const holder = await pool.connect();
    const probe = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM inbound_messages WHERE id = $1::uuid FOR UPDATE`, [id]);   // 다른 쓰기(사람 답장)가 받은 글을 쥐고 있다
      let settled = false;
      const sending = sendReply(reply.id, NOON).then((v) => { settled = true; return v; });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false);                                               // 받은 글의 잠금 뒤에 서 있다
      await probe.query('BEGIN');
      const free = (await probe.query(`SELECT id FROM inbound_messages WHERE id = $1::uuid FOR UPDATE SKIP LOCKED`, [reply.id])).rows.length;
      await probe.query('ROLLBACK');
      expect(free).toBe(1);                                                      // 그동안 답장 행은 아무도 쥐고 있지 않다
      await holder.query('COMMIT');
      expect(await sending).toBe('failed');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await probe.query('ROLLBACK').catch(() => undefined);
      holder.release(); probe.release();
    }
    expect((await repliesOf(id))[0]).toMatchObject({ status: 'failed', claim_token: null });
    expect((await row(id)).status).toBe('human');
  });
  it('받은 시각이 같은 두 글 = 저장한 차례로 가른다(대화를 그리는 차례와 같은 기준) — 앞 글에 답하거나 앞 글을 닫아도 뒤에 저장된 글은 그대로', async () => {
    await setup({ mode: 'off' });
    const same = new Date(Date.now() - 60_000);
    const pair = async (from: string) => {
      const a = await inbound('앞 글', { from });
      const b = await inbound('뒤 글', { from });
      for (const id of [a, b]) await decideInbound(id, NOON());
      await pool.query(`UPDATE inbound_messages SET received_at = $2 WHERE id = ANY($1::uuid[])`, [[a, b], same]);
      return { a, b };
    };
    const x = await pair('01077770087');
    expect((await readThread(CO, x.a))!.messages.map((m) => m.body)).toEqual(['앞 글', '뒤 글']);
    expect((await humanReply(CTX, x.a, randomUUID(), '앞 글에 답합니다.', okGate, NOON())).done).toBe(true);
    expect([(await row(x.a)).status, (await row(x.b)).status]).toEqual(['answered', 'human']);
    const y = await pair('01077770088');
    expect(await closeInbound(CTX, y.a)).toBe(true);
    expect([(await row(y.a)).status, (await row(y.b)).status]).toEqual(['done', 'human']);
    // 뒤 글을 가리키면 앞 글도 함께
    const z = await pair('01077770092');
    expect(await closeInbound(CTX, z.b)).toBe(true);
    expect([(await row(z.a)).status, (await row(z.b)).status]).toEqual(['done', 'done']);
  });
  it('보내지 않기 = 서버가 그 id 를 닫는다 — 뒤늦게 닿은 같은 id 의 요청은 아무것도 보내지 않는다 · 이미 있는 답장이면 그 행을 돌려준다 · 닫은 id 는 화면에 없다', async () => {
    await setup({ mode: 'off' });
    const id = await inbound('환불 되나요?');
    await decideInbound(id, NOON());
    const gone = randomUUID();
    expect(await discardHumanReply(CTX, id, gone)).toBeNull();
    expect(await discardHumanReply(CTX, id, gone)).toBeNull();                    // 두 번 눌러도 같다
    await expect(humanReply(CTX, id, gone, '뒤늦게 닿은 요청', okGate, NOON())).rejects.toMatchObject({ code: 'INBOUND_DISCARDED', status: 409 });
    expect(gateCalls).toHaveLength(0);                                            // 닫은 id 는 발신 인증까지도 가지 않는다(설정 저장은 방식 = 끔이라 인증을 부르지 않았다)
    expect(calls).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: 'human' });                     // 받은 글은 그대로 「사람 필요」
    expect(await readHumanReply(CTX, gone)).toBeNull();
    expect((await readThread(CO, id))!.messages.map((m) => m.body)).toEqual(['환불 되나요?']);
    expect((await listThreads(CO, 'all')).threads[0]).toMatchObject({ lastBody: '환불 되나요?', lastDirection: 'in' });
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM inbound_messages WHERE id = $1::uuid AND status = 'cancelled' AND direction = 'out'`, [gone])).rows[0].n).toBe(1);
    // 이미 나간 답장을 버리려 하면 = 그 행(나갔다)을 돌려주고 바꾸지 않는다
    const sent = randomUUID();
    expect((await humanReply(CTX, id, sent, '네, 가능합니다.', okGate, NOON())).done).toBe(true);
    expect(await discardHumanReply(CTX, id, sent)).toEqual({ id: sent, status: 'sent', note: null });
    expect((await row(sent)).status).toBe('sent');
    expect(calls).toHaveLength(1);
    // 남의 회사 · 다른 글의 답장 id 로는 닫지도 읽지도 못한다
    await expect(discardHumanReply(OCTX, id, randomUUID())).rejects.toMatchObject({ code: 'INBOUND_NOT_FOUND' });
    const other = await inbound('다른 문의', { from: '01077770085' });
    await expect(discardHumanReply(CTX, other, sent)).rejects.toMatchObject({ code: 'INBOUND_ID' });
    await expect(discardHumanReply(OCTX, id, sent)).rejects.toMatchObject({ code: 'INBOUND_NOT_FOUND' });
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM inbound_messages WHERE company_id = $1::uuid AND direction = 'out'`, [OTHER])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM inbound_messages WHERE status = 'cancelled'`)).rows[0].n).toBe(1);   // 남의 회사 요청은 닫은 행도 남기지 않는다
  });
  it('대화 조회 = 가장 최근 것부터 상한까지(오래된 순으로 돌려준다) · 그 앞에 더 있으면 more', async () => {
    const id = await inbound('가장 최근 문의');
    await pool.query(
      `INSERT INTO inbound_messages (id, provider_msg_id, direction, from_phone, to_number, body, company_id, status, received_at)
       SELECT md5('c133-old-' || g)::uuid, 'old-' || g, 'in', $1, $2, '옛 문의 ' || g, $3::uuid, 'done', NOW() - make_interval(mins => g)
         FROM generate_series(1, $4::int) g`, [CUST, N1, CO, INBOUND_THREAD_LIMIT + 1]);
    const t = (await readThread(CO, id))!;
    expect(t.more).toBe(true);
    expect(t.messages).toHaveLength(INBOUND_THREAD_LIMIT);
    expect(t.messages[t.messages.length - 1].body).toBe('가장 최근 문의');
    expect(t.messages[0].body).toBe(`옛 문의 ${INBOUND_THREAD_LIMIT - 1}`);         // 가장 오래된 둘(상한 + 1 · 상한)은 빠진다
    await pool.query(`DELETE FROM inbound_messages WHERE provider_msg_id IN ('old-1', 'old-2')`);
    const exact = (await readThread(CO, id))!;
    expect(exact.more).toBe(false);
    expect(exact.messages).toHaveLength(INBOUND_THREAD_LIMIT);
  });
  it('워커가 부를 행 = 회사마다 5건까지(회사 하나의 글이 몰려도 다른 회사가 밀리지 않는다)', async () => {
    for (let i = 0; i < INBOUND_PER_COMPANY + 3; i += 1) await inbound(`몰린 문의 ${i}`, { from: `01077771${String(100 + i)}` });
    const o = await inbound('다른 회사 문의', { to: N2, from: '01077770095' });
    const due = (await pool.query(INBOUND_DUE_DECIDE_SQL)).rows.map((r: any) => String(r.id));
    expect(due).toHaveLength(INBOUND_PER_COMPANY + 1);
    expect(due).toContain(o);
  });
});
