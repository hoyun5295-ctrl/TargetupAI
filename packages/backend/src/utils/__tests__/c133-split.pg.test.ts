// replaces: none
/**
 * C133 F4 나눠 보내기 — 실 PostgreSQL 판(★ 2026-11-14 · 설계서 docs/2026-11-13-hanjul-v3-design.md §6 · §18 「배포 C-3」 · 대기 DDL C133-DDL-6 을 시험 안에서 얹는다)
 *   운영 문장(대상 추출 · 받는 사람 고정 · 적재 · 판정 조회 · 쥐기 · 끝내기)을 글자 그대로 돌린다. 직접발송 코어만 대역(캠페인 행을 만든다).
 *   1. 대상 = 활성 + 동의 + 수신거부 제외 · 번호 하나에 고객 하나(가장 작은 id) · 다른 회사 0
 *   2. 받는 사람 고정 = 한 문장 · 문안별 인원이 판정 함수(splitSizes)와 같다 · 같은 id 두 번 = 한 번
 *   3. 실행 = 시험 묶음(문안 순서) → 기다림 → 판정(누른 기기 수) → 나머지(고른 문안) → 끝(고정 표 삭제)
 *   4. 보내는 순간의 자격 재확인 = 빠지기만 한다 · 피로도
 *   5. 실패 = 막힘(남은 묶음 0) → 이어 보내기 · 접수 결과 불명 = 대조(다시 보내지 않는다) · 쥔 행 = 건너뜀
 *   6. 그만 · 취소된 시험 묶음 · 담당자는 자기 것만
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const stage = vi.hoisted(() => ({ live: true, unknown: false }));
const core = vi.hoisted(() => ({ create: vi.fn() }));
const notice = vi.hoisted(() => ({ send: vi.fn() }));
const consent = vi.hoisted(() => ({ admin: null as null | { isTrue: string; mallCodes: string[] } }));
const fatigue = vi.hoisted(() => ({ cap: null as any, blocked: [] as string[] }));
vi.mock('../v3-stage', () => ({
  v3Live: vi.fn(async () => stage.live && !stage.unknown),
  v3LiveState: vi.fn(async () => (stage.unknown ? 'unknown' : stage.live ? 'open' : 'closed')),
}));
vi.mock('../direct-send-core', () => ({ createDirectSendCampaign: core.create }));
vi.mock('../continuous-operator', () => ({ notifyOperatorAdmins: notice.send }));
vi.mock('../planner-executor', () => ({ DEFINITE_NO_COMMIT: new Set(['INSUFFICIENT_BALANCE', 'NIGHT_AD_RESTRICTED']) }));
vi.mock('../campaign-lifecycle', () => ({ syncCampaignResults: vi.fn(async () => ({ syncCount: 0 })) }));
vi.mock('../sms-queue', async (orig) => ({ ...(await orig<any>()), hasCompanyLineGroup: vi.fn(async () => true) }));
vi.mock('../callback-filter', async (orig) => ({ ...(await orig<any>()), isCallbackRegistered: vi.fn(async () => true) }));
vi.mock('../messageUtils', async (orig) => ({ ...(await orig<any>()), getOpt080Number: vi.fn(async () => '0801234567') }));
vi.mock('../mall-consent', async (orig) => ({ ...(await orig<any>()), resolveAdminSendConsent: vi.fn(async () => consent.admin) }));
vi.mock('../fatigue-guard', async (orig) => ({
  ...(await orig<any>()),
  getFatigueCap: vi.fn(async () => fatigue.cap),
  getFatigueBlockedSet: vi.fn(async () => new Set(fatigue.blocked)),
}));

import { pool } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { insertMinimalRow } from './pg/fixtures';
import {
  planSplit, createSplit, discardSplitStart, advanceSplit, stopSplit, resumeSplit, readSplit, listSplits, SPLIT_DEVICES_SQL, SPLIT_DUE_SQL,
  type SplitCtx, type SplitStartInput,
} from '../campaign-split';
import { splitSizes } from '../campaign-split-rules';
import { DirectSendError } from '../direct-send-spec';
import { SHORT_URL_BASE } from '../short-url';

const CO = '00000000-0000-0000-0000-00000c133601';
const OTHER = '00000000-0000-0000-0000-00000c133602';
const PLAN = '00000000-0000-0000-0000-00000c133611';
const USER = '00000000-0000-0000-0000-00000c133621';
const STAFF = '00000000-0000-0000-0000-00000c133622';
const CTX: SplitCtx = { companyId: CO, userId: USER, userType: 'company_admin' };
const cust = (n: number) => `00000000-0000-0000-0000-0000c1336${String(n).padStart(3, '0')}`;
const phone = (n: number) => `0100001${String(n).padStart(4, '0')}`;
const ELIGIBLE = 47;                      // 고객 1 ~ 47
const LINK = 'https://shop.example.com/sale';
const DAY_NOON = () => new Date(`${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)}T12:00:00+09:00`);
/** 발송 창 안의 시각 — 시험을 돌리는 시각과 무관하게(지금이 낮이면 지금 · 아니면 내일 정오 = 늘 지금 이후) */
const SEND_TIME = () => { const n = new Date(); const h = (n.getUTCHours() + 9) % 24; return h >= 9 && h < 20 ? n : new Date(DAY_NOON().getTime() + 24 * 3600 * 1000); };
/** 밤(발송 창 밖) — 내일 23:30(KST) = 늘 지금 이후 */
const NIGHT_TIME = () => new Date(DAY_NOON().getTime() + 35.5 * 3600 * 1000);

const calls: Array<{ spec: any; guardOk: boolean; staged: Array<{ phone: string; name: string | null }> }> = [];
const input = (id: string, over: Partial<SplitStartInput> = {}): SplitStartInput => ({
  id, name: '가을 세일', msgType: 'SMS', callback: '02-1234-5678', isAd: false, targetFilter: {},
  variants: [{ text: `A 문안 %이름%님 ${LINK}/a` }, { text: `B 문안 ${LINK}/b` }], pct: 20, wait: '1h', ...over,
});
async function start(over: Partial<SplitStartInput> = {}, ctx: SplitCtx = CTX) {
  const id = randomUUID();
  // ★1117 시작 시각 = 광고만 발송 창 안 시각(SEND_TIME · 그 시험은 실행에도 같은 시각을 넘긴다) · 광고가 아니면 실제 지금
  //   (옛: 광고가 아닌 시험도 SEND_TIME 이라 09 ~ 20시 밖에 돌리면 시작 시각이 내일로 저장되고 · 실행 · 누름 기록은 실제 지금이라 판정이 어긋났다)
  const plan = await planSplit(ctx, input(id, over), over.isAd ? SEND_TIME() : new Date());
  expect(await createSplit(ctx, id, plan)).toEqual({ created: true });
  return { id, plan };
}
const rowOf = async (id: string) => (await pool.query('SELECT * FROM campaign_split_tests WHERE id = $1::uuid', [id])).rows[0];
const members = async (id: string) => (await pool.query('SELECT phone, customer_id, grp FROM campaign_split_members WHERE split_id = $1::uuid ORDER BY phone', [id])).rows;
/** 판정 시각이 된 것처럼 = 시간이 흐른 것(나간 묶음의 「나가는 시각」도 옛날로 — 판정 시각은 그 값에서 다시 센다) */
const due = async (id: string) => pool.query(
  `UPDATE campaign_split_tests SET decide_at = NOW() - interval '1 minute',
          groups = (SELECT jsonb_agg(CASE WHEN x.g->>'goesAt' IS NULL THEN x.g ELSE jsonb_set(x.g, '{goesAt}', '"2020-01-01T03:00:00.000Z"'::jsonb) END ORDER BY x.o)
                      FROM jsonb_array_elements(groups) WITH ORDINALITY AS x(g, o))
    WHERE id = $1::uuid`, [id]);
const click = (hash: string, ip: string, ua: string, company = CO, at = 'NOW()') => pool.query(
  `INSERT INTO cdp_events (id, company_id, event_name, source, properties, occurred_at)
   VALUES ($1::uuid, $2::uuid, 'message_click', 'short_url_click', $3::jsonb, ${at})`,
  [randomUUID(), company, JSON.stringify({ short_url_hash: hash, ip, user_agent: ua })]);

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C133-DDL-6'));
  await insertMinimalRow(pool, 'plans', { id: PLAN, plan_code: 'C133SPLIT', plan_name: '유료', is_active: true });
  for (const id of [CO, OTHER]) await insertMinimalRow(pool, 'companies', { id, plan_id: PLAN, cost_per_sms: 10, cost_per_lms: 30 });
  await insertMinimalRow(pool, 'users', { id: USER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1361', login_id: 't-c133-split-admin' });
  await insertMinimalRow(pool, 'users', { id: STAFF, company_id: CO, user_type: 'user', is_active: true, phone: '010-0000-1362', login_id: 't-c133-split-staff' });
  for (let n = 1; n <= ELIGIBLE; n += 1) {
    await insertMinimalRow(pool, 'customers', { id: cust(n), company_id: CO, phone: phone(n), name: `고객${n}`, is_active: true, sms_opt_in: true });
  }
  // 못 받는 사람들 · 같은 번호의 두 번째 고객 · 다른 회사
  await insertMinimalRow(pool, 'customers', { id: cust(901), company_id: CO, phone: `010-0001-${String(1).padStart(4, '0')}`, name: '같은 번호', is_active: true, sms_opt_in: true });
  await insertMinimalRow(pool, 'customers', { id: cust(902), company_id: CO, phone: phone(902), name: '비활성', is_active: false, sms_opt_in: true });
  await insertMinimalRow(pool, 'customers', { id: cust(903), company_id: CO, phone: phone(903), name: '동의 안 함', is_active: true, sms_opt_in: false });
  await insertMinimalRow(pool, 'customers', { id: cust(904), company_id: CO, phone: phone(904), name: '수신거부', is_active: true, sms_opt_in: true });
  await insertMinimalRow(pool, 'customers', { id: cust(905), company_id: CO, phone: '', name: '번호 없음', is_active: true, sms_opt_in: true });
  await insertMinimalRow(pool, 'unsubscribes', { company_id: CO, user_id: USER, phone: phone(904) });
  await insertMinimalRow(pool, 'customers', { id: cust(990), company_id: OTHER, phone: phone(990), name: '남의 고객', is_active: true, sms_opt_in: true });
});

beforeEach(async () => {
  stage.live = true; stage.unknown = false; consent.admin = null; fatigue.cap = null; fatigue.blocked = [];
  calls.length = 0;
  notice.send.mockReset(); notice.send.mockResolvedValue(true);
  core.create.mockReset();
  core.create.mockImplementation(async (spec: any, ctx: any) => {
    const id = randomUUID();
    const g = ctx.activationGuard;
    const guardOk = (await pool.query(`SELECT ${String(g.sql).replace(/\$2/g, '$1').replace(/\$3/g, '$2')} AS ok`, g.params)).rows[0].ok === true;
    const staged = (await pool.query('SELECT phone, name FROM campaign_send_staging WHERE staging_id = $1::uuid ORDER BY phone', [spec.stagingId])).rows;
    calls.push({ spec, guardOk, staged });
    await insertMinimalRow(pool, 'campaigns', { id, company_id: ctx.companyId, staging_id: spec.stagingId, send_phase: 'queued', status: 'sending', campaign_name: spec.campaignName });
    return { campaignId: id, accepted: spec.total };
  });
  // 시험마다 받는 사람 상태를 처음으로
  await pool.query(`UPDATE customers SET sms_opt_in = true, is_active = true WHERE company_id = $1::uuid AND id <> ALL($2::uuid[])`, [CO, [cust(902), cust(903)]]);
  await pool.query(`DELETE FROM unsubscribes WHERE user_id = $1::uuid AND phone <> $2`, [USER, phone(904)]);
});

describe('대상 · 받는 사람 고정(실 PG)', () => {
  it('대상 = 활성 + 동의 + 수신거부 제외 · 번호 하나에 고객 하나 · 다른 회사 0 → 인원 · 시각 · 비용', async () => {
    const plan = await planSplit(CTX, input(randomUUID()));
    expect(plan.total).toBe(ELIGIBLE);
    expect(plan.sizes).toEqual(splitSizes(ELIGIBLE, 20, 2));
    expect(plan.sizes).toEqual({ perVariant: 4, testTotal: 8, rest: 39 });
    expect(plan.unitPrice).toBeGreaterThan(0);                       // 차감 단가(회사 단가 기준 · 차감 함수와 같은 함수가 낸 값)
    expect(plan.estimate).toBe(Math.round(plan.unitPrice * ELIGIBLE));
    expect(plan).toMatchObject({ prepaid: false, balance: null });
    expect(plan.decideAt.getTime() - plan.startAt.getTime()).toBe(3600 * 1000);
  });
  it('고정 = 문안별 인원이 판정 함수와 같다 · 번호 중복 0 · 같은 번호는 가장 작은 id 의 고객 · 못 받는 사람 0', async () => {
    const { id, plan } = await start();
    const m = await members(id);
    expect(m).toHaveLength(ELIGIBLE);
    expect(new Set(m.map((r: any) => r.phone)).size).toBe(ELIGIBLE);
    const by = (g: number) => m.filter((r: any) => Number(r.grp) === g).length;
    expect([by(1), by(2), by(0)]).toEqual([plan.sizes.perVariant, plan.sizes.perVariant, plan.sizes.rest]);
    expect(m.find((r: any) => r.phone === phone(1)).customer_id).toBe(cust(1));
    for (const n of [902, 903, 904, 990]) expect(m.some((r: any) => r.phone === phone(n))).toBe(false);
    expect(m.some((r: any) => r.phone === '')).toBe(false);
    const row = await rowOf(id);
    expect(row.status).toBe('testing');
    expect(row.spec).toMatchObject({ name: '가을 세일', msgType: 'SMS', isAd: false, total: ELIGIBLE, perVariant: 4, rest: 39 });
    expect(row.groups.map((g: any) => [g.grp, g.state])).toEqual([[1, 'pending'], [2, 'pending'], [0, 'pending']]);
  });
  it.each([[10, 2], [10, 3], [20, 3], [30, 2], [30, 3]] as const)('몫 %i · 문안 %i개 = SQL 의 나눗셈과 판정 함수가 같은 값', async (pct, k) => {
    const variants = [{ text: `A ${LINK}/a` }, { text: `B ${LINK}/b` }, { text: `C ${LINK}/c` }].slice(0, k);
    const want = splitSizes(ELIGIBLE, pct, k);
    const id = randomUUID();
    if (!want) {
      await expect(planSplit(CTX, input(id, { pct, variants }))).rejects.toMatchObject({ code: 'SPLIT_TOO_FEW' });
      return;
    }
    const plan = await planSplit(CTX, input(id, { pct, variants }));
    await createSplit(CTX, id, plan);
    const m = await members(id);
    const by = (g: number) => m.filter((r: any) => Number(r.grp) === g).length;
    expect(Array.from({ length: k }, (_, i) => by(i + 1))).toEqual(Array(k).fill(want.perVariant));
    expect(by(0)).toBe(want.rest);
  });
  it('문안의 주소는 시작할 때 전부 새로 줄인다 · 원문은 그대로 둔다 · 같은 id 의 두 번째 요청은 만들지 않는다', async () => {
    const { id, plan } = await start();
    const row = await rowOf(id);
    for (const [i, v] of row.variants.entries()) {
      expect(v.text).toBe(plan.variants[i].text);
      expect(v.tracked).not.toContain(LINK);
      expect(v.hashes).toHaveLength(1);
      expect(v.tracked).toContain(`${SHORT_URL_BASE}/${v.hashes[0]}`);
    }
    expect(row.variants[0].hashes[0]).not.toBe(row.variants[1].hashes[0]);
    const urls = await pool.query('SELECT hash, full_url FROM message_short_urls WHERE hash = ANY($1::text[])', [row.variants.map((v: any) => v.hashes[0])]);
    expect(urls.rows.map((r: any) => r.full_url).sort()).toEqual([`${LINK}/a`, `${LINK}/b`]);
    const before = (await pool.query('SELECT COUNT(*)::int AS n FROM message_short_urls WHERE company_id = $1::uuid', [CO])).rows[0].n;
    expect(await createSplit(CTX, id, plan)).toEqual({ created: false });
    expect((await members(id))).toHaveLength(ELIGIBLE);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM message_short_urls WHERE company_id = $1::uuid', [CO])).rows[0].n).toBe(before);
    await expect(createSplit({ ...CTX, companyId: OTHER }, id, plan)).rejects.toMatchObject({ code: 'SPLIT_ID' });
  });
  it('바이트 한도 = 광고 표기 · 무료거부 꼬리 · 줄인 주소를 넣은 글로 잰다(단문 90) · LMS 는 제목이 있어야 한다', async () => {
    const body = (n: number) => `${'가'.repeat(n)} ${LINK}/a`;
    const two = (n: number) => [{ text: body(n) }, { text: `B ${LINK}/b` }];
    // 줄인 주소 = 짧은 주소 머리 + 8글자 · 광고가 아니면 본문 + 공백 + 주소가 90 바이트 안이어야 한다
    const room = Math.floor((90 - 1 - (SHORT_URL_BASE.length + 9)) / 2);
    expect((await planSplit(CTX, input(randomUUID(), { variants: two(room) }))).total).toBe(ELIGIBLE);
    await expect(planSplit(CTX, input(randomUUID(), { variants: two(room + 1) }))).rejects.toMatchObject({ code: 'SPLIT_BYTES', extra: { variantIndex: 0 } });
    // 광고 = (광고) + 무료거부 꼬리만큼 더 든다 → 같은 글이 넘는다
    await expect(planSplit(CTX, input(randomUUID(), { variants: two(room), isAd: true }), SEND_TIME())).rejects.toMatchObject({ code: 'SPLIT_BYTES' });
    await expect(planSplit(CTX, input(randomUUID(), { msgType: 'LMS', variants: two(room + 1) }))).rejects.toMatchObject({ code: 'SPLIT_SUBJECT_REQUIRED' });
    const lms = two(room + 1).map((v) => ({ ...v, subject: '가을 세일' }));
    expect((await planSplit(CTX, input(randomUUID(), { msgType: 'LMS', variants: lms }))).variants.map((v) => v.subject)).toEqual(['가을 세일', '가을 세일']);
    const sms = two(room).map((v) => ({ ...v, subject: '가을 세일' }));
    expect((await planSplit(CTX, input(randomUUID(), { variants: sms }))).variants.map((v) => v.subject)).toEqual([null, null]);   // 단문은 제목을 싣지 않는다
  });
  it('관문 = 닫힌 회사 · 몰별 수신동의 발송 · 잔액 부족(선불)은 시작하지 않는다', async () => {
    stage.live = false;
    await expect(planSplit(CTX, input(randomUUID()))).rejects.toMatchObject({ code: 'SPLIT_CLOSED' });
    stage.live = true;
    consent.admin = { isTrue: 'TRUE', mallCodes: ['M1'] };
    await expect(planSplit(CTX, input(randomUUID()))).rejects.toMatchObject({ code: 'SPLIT_MALL_CONSENT' });
    consent.admin = null;
    const need = (await planSplit(CTX, input(randomUUID()))).estimate;
    await pool.query(`UPDATE companies SET billing_type = 'prepaid', balance = $2 WHERE id = $1::uuid`, [CO, need - 1]);
    try {
      await expect(planSplit(CTX, input(randomUUID()))).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', status: 402 });
      await pool.query(`UPDATE companies SET balance = $2 WHERE id = $1::uuid`, [CO, need]);
      expect(await planSplit(CTX, input(randomUUID()))).toMatchObject({ prepaid: true, balance: need, estimate: need });
    } finally {
      await pool.query(`UPDATE companies SET billing_type = 'postpaid', balance = 0 WHERE id = $1::uuid`, [CO]);
    }
  });
});

describe('실행 — 시험 묶음 → 판정 → 나머지(실 PG · 코어만 대역)', () => {
  it('시험 묶음을 문안 순서대로 접수한다 = 줄인 글 · 문안별 인원 · 고정한 그 고객의 이름 · 내 표식이 활성화 조건 · 끝나면 표식을 놓는다', async () => {
    const { id } = await start();
    expect(await advanceSplit(id)).toBe('waiting');
    const row = await rowOf(id);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.spec.message)).toEqual(row.variants.map((v: any) => v.tracked));
    expect(calls.map((c) => c.spec.campaignName)).toEqual(['가을 세일 · 문안 A 먼저', '가을 세일 · 문안 B 먼저']);
    for (const c of calls) {
      expect(c.spec).toMatchObject({ msgType: 'SMS', sendChannel: 'sms', sendType: 'operator', adEnabled: false, total: 4, dedupEnabled: true, unsubFilterEnabled: true, adGateBatchId: null, callback: '02-1234-5678' });
      expect(c.spec.scheduled).toBeUndefined();
      expect(c.guardOk).toBe(true);
      expect(c.staged).toHaveLength(4);
    }
    const m = await members(id);
    for (const [i, c] of calls.entries()) {
      const want = m.filter((r: any) => Number(r.grp) === i + 1).map((r: any) => r.phone).sort();
      expect(c.staged.map((s) => s.phone)).toEqual(want);
      for (const s of c.staged) expect(s.name).toBe(`고객${Number(s.phone.slice(-4))}`);
    }
    expect(row.groups.map((g: any) => [g.grp, g.state, g.total])).toEqual([[1, 'sent', 4], [2, 'sent', 4], [0, 'pending', null]]);
    expect(row.groups.slice(0, 2).every((g: any) => g.campaignId && g.stagingId)).toBe(true);
    expect(row.claim_token).toBeNull();
    // 판정 시각 전에는 다시 불러도 아무것도 보내지 않는다
    expect(await advanceSplit(id)).toBe('waiting');
    expect(calls).toHaveLength(2);
  });
  it('판정 = 누른 기기 수가 뚜렷이 많은 문안 → 나머지 전원에게 그 문안 · 끝나면 고정 표를 지운다', async () => {
    const { id } = await start({ pct: 30 });      // 문안별 7명
    await advanceSplit(id);
    const row = await rowOf(id);
    const [ha, hb] = row.variants.map((v: any) => v.hashes[0]);
    await pool.query(`UPDATE campaigns SET success_count = 7, status = 'completed' WHERE id = ANY($1::uuid[])`, [row.groups.filter((g: any) => g.grp > 0).map((g: any) => g.campaignId)]);
    for (let i = 0; i < 7; i += 1) await click(hb, `10.0.0.${i}`, 'UA-1');
    await click(hb, '10.0.0.0', 'UA-1');             // 같은 기기 한 번 더 = 한 번
    await due(id);
    calls.length = 0;
    expect(await advanceSplit(id)).toBe('done');
    const after = await rowOf(id);
    expect(after).toMatchObject({ status: 'done', winner_index: 1, verdict: 'winner', claim_token: null });
    expect(after.result.arms).toEqual([{ sent: 7, devices: 0 }, { sent: 7, devices: 7 }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].spec.message).toBe(row.variants[1].tracked);
    expect(calls[0].spec.campaignName).toBe('가을 세일 · 나머지');
    expect(calls[0].spec.total).toBe(ELIGIBLE - 14);
    expect(after.groups.find((g: any) => g.grp === 0)).toMatchObject({ state: 'sent', total: ELIGIBLE - 14 });
    expect(await members(id)).toHaveLength(0);
    expect(ha).not.toBe(hb);
    // 끝난 것은 다시 불러도 아무 일도 없다
    expect(await advanceSplit(id)).toBe('none');
    expect(calls).toHaveLength(1);
  });
  it('차이가 뚜렷하지 않으면 · 발송 성공 수를 모르면 = 첫 문안', async () => {
    const a = await start();
    await advanceSplit(a.id);
    const ra = await rowOf(a.id);
    await pool.query(`UPDATE campaigns SET success_count = 4 WHERE id = ANY($1::uuid[])`, [ra.groups.filter((g: any) => g.grp > 0).map((g: any) => g.campaignId)]);
    await click(ra.variants[1].hashes[0], '10.1.0.1', 'UA');
    await due(a.id);
    calls.length = 0;
    expect(await advanceSplit(a.id)).toBe('done');
    expect(await rowOf(a.id)).toMatchObject({ winner_index: 0, verdict: 'no_difference' });
    expect(calls[0].spec.message).toBe(ra.variants[0].tracked);

    const b = await start();
    await advanceSplit(b.id);
    await due(b.id);
    calls.length = 0;
    expect(await advanceSplit(b.id)).toBe('done');
    expect(await rowOf(b.id)).toMatchObject({ winner_index: 0, verdict: 'not_ready' });
  });
  it('보내는 순간의 자격을 다시 본다 = 그 사이 수신거부 · 동의 철회 · 비활성은 빠지기만 한다(늘지 않는다)', async () => {
    const { id } = await start();
    const m = await members(id);
    const g2 = m.filter((r: any) => Number(r.grp) === 2);
    const rest = m.filter((r: any) => Number(r.grp) === 0);
    await insertMinimalRow(pool, 'unsubscribes', { company_id: CO, user_id: USER, phone: g2[0].phone });
    await pool.query('UPDATE customers SET sms_opt_in = false WHERE id = $1::uuid', [rest[0].customer_id]);
    await pool.query('UPDATE customers SET is_active = false WHERE id = $1::uuid', [rest[1].customer_id]);
    await advanceSplit(id);
    expect(calls.map((c) => c.spec.total)).toEqual([4, 3]);
    expect(calls[1].staged.map((s) => s.phone)).not.toContain(g2[0].phone);
    await due(id);
    calls.length = 0;
    await advanceSplit(id);
    expect(calls[0].spec.total).toBe(rest.length - 2);
    expect(calls[0].staged.map((s) => s.phone)).not.toContain(rest[0].phone);
    expect(calls[0].staged.map((s) => s.phone)).not.toContain(rest[1].phone);
  });
  it('광고 = 피로도에 걸린 번호를 적재에서 뺀다(차감 앞) · 예약이면 시험 묶음을 예약으로 접수하고 나머지는 판정 때 바로', async () => {
    const future = new Date(DAY_NOON().getTime() + 48 * 3600 * 1000).toISOString();
    const { id } = await start({ isAd: true, scheduledAt: future });
    const g1 = (await members(id)).filter((r: any) => Number(r.grp) === 1);
    fatigue.cap = { days: 7, max: 1 };
    fatigue.blocked = [g1[0].phone];
    expect(await advanceSplit(id, SEND_TIME)).toBe('waiting');
    expect(calls.map((c) => c.spec.total)).toEqual([3, 4]);
    expect(calls[0].staged.map((s) => s.phone)).not.toContain(g1[0].phone);
    for (const c of calls) expect(c.spec).toMatchObject({ adEnabled: true, scheduled: true, scheduledAt: future });
    fatigue.cap = null; fatigue.blocked = [];
    await due(id);
    calls.length = 0;
    expect(await advanceSplit(id, SEND_TIME)).toBe('done');
    expect(calls[0].spec.scheduled).toBeUndefined();
  });
  it('먼저 보낼 받는 사람이 전부 빠진 문안이 있으면 비교하지 않는다 = 막힘(나머지를 보내지 않는다)', async () => {
    const { id } = await start();
    const g1 = (await members(id)).filter((r: any) => Number(r.grp) === 1);
    await pool.query('UPDATE customers SET sms_opt_in = false WHERE id = ANY($1::uuid[])', [g1.map((r: any) => r.customer_id)]);
    expect(await advanceSplit(id)).toBe('blocked');
    const row = await rowOf(id);
    expect(row.groups.map((g: any) => [g.grp, g.state])).toEqual([[1, 'empty'], [2, 'sent'], [0, 'pending']]);
    expect(row.block_reason).toContain('비교할 수 없어요');
    expect(calls.map((c) => c.spec.campaignName)).toEqual(['가을 세일 · 문안 B 먼저']);
    await due(id);
    calls.length = 0;
    expect(await advanceSplit(id)).toBe('none');             // 막힌 것은 판정 시각이 지나도 나머지를 보내지 않는다
    expect(calls).toHaveLength(0);
  });
  it('기다리는 사이 회사에 닫히면(단계 개방 · 요금제) 남은 묶음을 보내지 않고 끝낸다 = 그만 + 알림 + 고정 표 삭제', async () => {
    const { id } = await start();
    await advanceSplit(id);
    await due(id);
    stage.live = false;
    calls.length = 0;
    expect(await advanceSplit(id)).toBe('cancelled');
    expect(calls).toHaveLength(0);
    const row = await rowOf(id);
    expect(row).toMatchObject({ status: 'cancelled', claim_token: null });
    expect(row.block_reason).toContain('남은 묶음을 보내지 않았어요');
    expect(await members(id)).toHaveLength(0);
    expect(notice.send).toHaveBeenCalledTimes(1);
    expect(String(notice.send.mock.calls[0][1])).toBe('[나눠 보내기] 중단');
  });
  it('광고의 판정이 발송 창 밖이면 다음 창으로 미룬다(나머지를 밤에 보내지 않는다)', async () => {
    const { id } = await start({ isAd: true });
    await advanceSplit(id, SEND_TIME);
    await due(id);
    calls.length = 0;
    const night = NIGHT_TIME;
    expect(await advanceSplit(id, night)).toBe('postponed');
    expect(calls).toHaveLength(0);
    const row = await rowOf(id);
    expect(row.status).toBe('testing');
    expect(new Date(row.decide_at).getTime()).toBeGreaterThan(night().getTime());
    expect(row.claim_token).toBeNull();
  });
});

describe('실패 · 대조 · 쥐기(실 PG)', () => {
  it('묶음이 접수되지 않으면(잔액) 막힌다 = 남은 묶음을 보내지 않고 알린다 → 이어 보내기는 못 나간 묶음부터 · 판정 시각을 다시 센다', async () => {
    const { id } = await start();
    const ok = core.create.getMockImplementation()!;
    core.create.mockImplementationOnce(ok).mockImplementationOnce(async () => { throw new DirectSendError('INSUFFICIENT_BALANCE', '잔액이 부족합니다.', 402); });
    expect(await advanceSplit(id)).toBe('blocked');
    let row = await rowOf(id);
    expect(row.status).toBe('blocked');
    expect(row.block_reason).toContain('잔액');
    expect(row.groups.map((g: any) => [g.grp, g.state])).toEqual([[1, 'sent'], [2, 'pending'], [0, 'pending']]);
    expect(row.claim_token).toBeNull();
    expect(notice.send).toHaveBeenCalledTimes(1);
    expect(String(notice.send.mock.calls[0][2])).toContain('문안 2개 중 1개가 먼저 나갔어요');
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM campaign_send_staging s JOIN campaign_split_tests t ON t.id = $1::uuid WHERE s.company_id = t.company_id AND s.staging_id NOT IN (SELECT staging_id FROM campaigns WHERE staging_id IS NOT NULL)', [id])).rows[0].n).toBe(0);
    expect(await members(id)).toHaveLength(ELIGIBLE);       // 이어 보내기가 쓴다
    // 워커는 막힌 것을 집지 않는다
    expect((await pool.query(SPLIT_DUE_SQL)).rows.map((r: any) => r.id)).not.toContain(id);
    await due(id);
    expect(await resumeSplit(CTX, id)).toBe(true);
    row = await rowOf(id);
    expect(row.status).toBe('testing');
    calls.length = 0;
    // 판정 시각은 이미 지났지만, 늦게 나간 문안 B 가 나가는 시각에서 다시 센다 = 바로 판정하지 않는다
    expect(await advanceSplit(id)).toBe('waiting');
    expect(calls.map((c) => c.spec.campaignName)).toEqual(['가을 세일 · 문안 B 먼저']);
    expect(new Date((await rowOf(id)).decide_at).getTime()).toBeGreaterThan(Date.now() + 3000 * 1000);
  });
  it('예약 전에 이어 보내도 나머지가 시험 묶음보다 먼저 나가지 않는다 = 판정 시각은 예약 시각 + 기다림보다 이르지 않다', async () => {
    const future = new Date(DAY_NOON().getTime() + 48 * 3600 * 1000);
    const { id } = await start({ scheduledAt: future.toISOString() });
    const ok = core.create.getMockImplementation()!;
    core.create.mockImplementationOnce(ok).mockImplementationOnce(async () => { throw new DirectSendError('INSUFFICIENT_BALANCE', '잔액이 부족합니다.', 402); });
    expect(await advanceSplit(id)).toBe('blocked');
    await due(id);                                         // 판정 시각이 지난 것처럼(옛 결함: 이어 보낸 시각 + 기다림으로 당겨졌다)
    await resumeSplit(CTX, id);
    calls.length = 0;
    expect(await advanceSplit(id)).toBe('waiting');
    expect(calls.map((c) => [c.spec.campaignName, c.spec.scheduledAt])).toEqual([['가을 세일 · 문안 B 먼저', future.toISOString()]]);
    const row = await rowOf(id);
    expect(new Date(row.decide_at).getTime()).toBe(future.getTime() + 3600 * 1000);
    expect(row.groups.find((g: any) => g.grp === 0).state).toBe('pending');
    // 그 시각 전에는 다시 불러도 나머지를 보내지 않는다
    expect(await advanceSplit(id)).toBe('waiting');
    expect(calls).toHaveLength(1);
  });
  it('판정 시각은 저장된 값(묶음이 나가는 시각)에서 매번 센다 = 판정 시각 쓰기가 빠졌어도 · 대조로 나간 것이 확인된 묶음도 기다린 뒤에 판정한다', async () => {
    const { id } = await start();
    expect(await advanceSplit(id)).toBe('waiting');
    let row = await rowOf(id);
    const went: number[] = row.groups.filter((g: any) => g.grp > 0).map((g: any) => new Date(g.goesAt).getTime());
    expect(went.every((t) => Math.abs(t - Date.now()) < 60_000)).toBe(true);
    expect(row.groups.find((g: any) => g.grp === 0).goesAt).toBeNull();
    const floor = Math.max(...went) + 3600 * 1000;
    expect(new Date(row.decide_at).getTime()).toBe(floor);
    // ① 판정 시각 쓰기가 빠진 것처럼(적힌 값이 이미 지났다) — 다음 실행이 저장된 나가는 시각에서 다시 세어 기다린다
    await pool.query(`UPDATE campaign_split_tests SET decide_at = NOW() - interval '1 minute' WHERE id = $1::uuid`, [id]);
    calls.length = 0;
    expect(await advanceSplit(id)).toBe('waiting');
    row = await rowOf(id);
    expect(new Date(row.decide_at).getTime()).toBe(floor);
    expect(row.status).toBe('testing');
    // ② 마지막 묶음이 sending 으로 남았다가(접수 뒤 저장 실패) 대조로 sent 가 되는 실행 — 그 실행도 바로 판정하지 않는다
    const groups = row.groups.map((g: any) => (g.grp === 2 ? { ...g, state: 'sending', campaignId: null } : g));
    await pool.query(`UPDATE campaign_split_tests SET groups = $2::jsonb, decide_at = NOW() - interval '1 minute' WHERE id = $1::uuid`, [id, JSON.stringify(groups)]);
    await pool.query(`UPDATE campaigns SET send_phase = 'queued' WHERE staging_id = $1::uuid`, [row.groups[1].stagingId]);
    expect(await advanceSplit(id)).toBe('waiting');
    row = await rowOf(id);
    expect(row.groups.map((g: any) => g.state)).toEqual(['sent', 'sent', 'pending']);
    expect(new Date(row.decide_at).getTime()).toBe(floor);
    expect(row.status).toBe('testing');
    expect(calls).toHaveLength(0);                          // 다시 보내지 않았다 · 나머지도 안 나갔다
    // 기다림이 지나면 판정한다(같은 값이라 더 미뤄지지 않는다)
    expect(await advanceSplit(id, () => new Date(floor - 1000))).toBe('waiting');
    expect(await advanceSplit(id, () => new Date(floor + 1000))).toBe('done');
  });
  it('접수되지 않아 되돌린 묶음은 나가는 시각도 지운다(다음에 나갈 때 다시 적힌다)', async () => {
    const { id } = await start();
    core.create.mockImplementationOnce(async () => { throw new DirectSendError('INSUFFICIENT_BALANCE', '잔액이 부족합니다.', 402); });
    expect(await advanceSplit(id)).toBe('blocked');
    expect((await rowOf(id)).groups.map((g: any) => [g.state, g.goesAt])).toEqual([['pending', null], ['pending', null], ['pending', null]]);
  });
  it('요금제를 읽지 못한 것은 닫힘이 아니다 = 아무것도 바꾸지 않고 다음에 다시(받는 사람 고정 표를 지우지 않는다)', async () => {
    const { id } = await start();
    stage.unknown = true;
    expect(await advanceSplit(id)).toBe('postponed');
    expect(calls).toHaveLength(0);
    let row = await rowOf(id);
    expect(row).toMatchObject({ status: 'testing', claim_token: null, block_reason: null });
    expect(row.groups.map((g: any) => g.state)).toEqual(['pending', 'pending', 'pending']);
    expect(await members(id)).toHaveLength(ELIGIBLE);
    expect(notice.send).not.toHaveBeenCalled();
    expect((await pool.query(SPLIT_DUE_SQL.replace('LIMIT 20', 'LIMIT 1000'))).rows.map((r: any) => r.id)).toContain(id);   // 워커가 다시 집는다
    stage.unknown = false;
    expect(await advanceSplit(id)).toBe('waiting');
    expect(calls).toHaveLength(2);
    // 나머지를 보낼 차례에 읽지 못해도 같다(판정은 남고 · 나머지는 다음에)
    await due(id);
    stage.unknown = true;
    calls.length = 0;
    expect(await advanceSplit(id)).toBe('postponed');
    row = await rowOf(id);
    expect(row).toMatchObject({ status: 'deciding', claim_token: null });
    expect(await members(id)).toHaveLength(ELIGIBLE);
    stage.unknown = false;
    expect(await advanceSplit(id)).toBe('done');
    expect(calls.map((c) => c.spec.campaignName)).toEqual(['가을 세일 · 나머지']);
  });
  it('접수 결과를 모르면 다시 보내지 않는다 = 그 적재 묶음 id 의 캠페인으로 대조한다', async () => {
    const { id } = await start();
    const ok = core.create.getMockImplementation()!;
    // 문안 A = 캠페인 행은 만들어졌는데(preparing) 응답이 끊겼다
    core.create.mockImplementationOnce(async (spec: any, ctx: any) => {
      await insertMinimalRow(pool, 'campaigns', { id: randomUUID(), company_id: ctx.companyId, staging_id: spec.stagingId, send_phase: 'preparing', status: 'draft', campaign_name: spec.campaignName });
      throw new Error('연결 끊김');
    });
    expect(await advanceSplit(id)).toBe('blocked');
    let row = await rowOf(id);
    expect(row.groups[0]).toMatchObject({ grp: 1, state: 'sending' });
    expect(row.block_reason).toContain('확인하지 못했어요');
    // 이어 보내기를 눌러도 아직 preparing 이면 다시 막힌다(코어를 다시 부르지 않는다)
    core.create.mockReset(); core.create.mockImplementation(ok);
    await resumeSplit(CTX, id);
    expect(await advanceSplit(id)).toBe('blocked');
    expect(core.create).not.toHaveBeenCalled();
    // 사람이 확인해 그 캠페인이 발송 단계로 넘어갔다 → 그 캠페인을 받아 적고 다음 묶음으로
    await pool.query(`UPDATE campaigns SET send_phase = 'queued' WHERE staging_id = $1::uuid`, [row.groups[0].stagingId]);
    await resumeSplit(CTX, id);
    expect(await advanceSplit(id)).toBe('waiting');
    row = await rowOf(id);
    expect(row.groups.map((g: any) => g.state)).toEqual(['sent', 'sent', 'pending']);
    expect(core.create).toHaveBeenCalledTimes(1);           // 문안 B 한 번뿐
  });
  it('캠페인이 만들어지기 전에 실패했으면 그 묶음은 접수 안 됨 = 막힘 → 이어 보내기가 다시 보낸다 · 코어가 중화한 캠페인(failed)도 같다', async () => {
    const { id } = await start();
    core.create.mockImplementationOnce(async () => { throw new Error('DB 끊김'); });
    expect(await advanceSplit(id)).toBe('blocked');
    let row = await rowOf(id);
    expect(row.groups[0]).toMatchObject({ grp: 1, state: 'failed' });
    await resumeSplit(CTX, id);
    core.create.mockImplementationOnce(async (spec: any, ctx: any) => {
      await insertMinimalRow(pool, 'campaigns', { id: randomUUID(), company_id: ctx.companyId, staging_id: spec.stagingId, send_phase: 'failed', status: 'failed', campaign_name: spec.campaignName });
      throw new DirectSendError('COMMIT_FAILED', '발송 접수에 실패했습니다.', 500);
    });
    expect(await advanceSplit(id)).toBe('blocked');
    row = await rowOf(id);
    expect(row.groups[0]).toMatchObject({ grp: 1, state: 'failed' });
    await resumeSplit(CTX, id);
    expect(await advanceSplit(id)).toBe('waiting');
    expect((await rowOf(id)).groups.map((g: any) => g.state)).toEqual(['sent', 'sent', 'pending']);
  });
  it('프로세스가 죽어 남은 표식 = 임대가 지나야 다시 쥔다 · 다시 쥐면 sending 묶음을 대조부터(이미 나간 묶음을 다시 보내지 않는다)', async () => {
    const { id } = await start();
    const staging = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { id: randomUUID(), company_id: CO, staging_id: staging, send_phase: 'sent', status: 'completed', campaign_name: '죽기 전에 나간 묶음' });
    const row = await rowOf(id);
    const groups = row.groups.map((g: any) => (g.grp === 1 ? { ...g, state: 'sending', stagingId: staging } : g));
    await pool.query(`UPDATE campaign_split_tests SET groups = $2::jsonb, claim_token = $3::uuid, claimed_at = NOW() WHERE id = $1::uuid`, [id, JSON.stringify(groups), randomUUID()]);
    expect(await advanceSplit(id)).toBe('held');            // 살아 있는 표식
    expect(calls).toHaveLength(0);
    await pool.query(`UPDATE campaign_split_tests SET claimed_at = NOW() - interval '31 minutes' WHERE id = $1::uuid`, [id]);
    expect(await advanceSplit(id)).toBe('waiting');
    expect(calls.map((c) => c.spec.campaignName)).toEqual(['가을 세일 · 문안 B 먼저']);
    expect((await rowOf(id)).groups.map((g: any) => g.state)).toEqual(['sent', 'sent', 'pending']);
  });
  it('워커가 부를 행 = 시험 묶음이 남은 것 · 판정 시각이 된 것 · 판정 중인 것', async () => {
    const a = await start();                                 // 시험 묶음이 남았다
    const b = await start();
    await advanceSplit(b.id);                                // 기다리는 중
    let ids = (await pool.query(SPLIT_DUE_SQL.replace('LIMIT 20', 'LIMIT 1000'))).rows.map((r: any) => r.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
    await due(b.id);
    await pool.query(`UPDATE campaign_split_tests SET status = 'deciding' WHERE id = $1::uuid`, [a.id]);
    ids = (await pool.query(SPLIT_DUE_SQL.replace('LIMIT 20', 'LIMIT 1000'))).rows.map((r: any) => r.id);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
  });
});

describe('그만 · 취소 · 조회 범위(실 PG)', () => {
  it('판정 때 시험 묶음이 취소돼 있으면 나머지를 보내지 않는다', async () => {
    const { id } = await start();
    await advanceSplit(id);
    const row = await rowOf(id);
    await pool.query(`UPDATE campaigns SET status = 'cancelled' WHERE id = $1::uuid`, [row.groups[0].campaignId]);
    await due(id);
    calls.length = 0;
    expect(await advanceSplit(id)).toBe('cancelled');
    expect(calls).toHaveLength(0);
    expect(await rowOf(id)).toMatchObject({ status: 'cancelled', claim_token: null });
    expect(await members(id)).toHaveLength(0);
  });
  it('그만 = 남은 묶음을 보내지 않는다 · 고정 표를 지운다 · 끝났거나 판정 중인 것은 멈추지 못한다 · 남의 회사 것 0', async () => {
    const { id } = await start();
    await advanceSplit(id);
    expect(await stopSplit({ ...CTX, companyId: OTHER }, id)).toBe(false);
    expect(await stopSplit(CTX, id)).toBe(true);
    expect((await rowOf(id)).status).toBe('cancelled');
    expect(await members(id)).toHaveLength(0);
    expect(await stopSplit(CTX, id)).toBe(false);
    await due(id);
    calls.length = 0;
    expect(await advanceSplit(id)).toBe('none');
    expect(calls).toHaveLength(0);
    const b = await start();
    await pool.query(`UPDATE campaign_split_tests SET status = 'deciding' WHERE id = $1::uuid`, [b.id]);
    expect(await stopSplit(CTX, b.id)).toBe(false);
  });
  it('요약 = 문안 · 묶음 상태 · 판정 순간의 값 · 담당자는 자기 것만(관리자는 회사 전체)', async () => {
    const { id } = await start();
    await advanceSplit(id);
    const v = (await readSplit(CTX, id))!;
    expect(v).toMatchObject({ status: 'testing', name: '가을 세일', pct: 20, wait: '1h', total: ELIGIBLE, perVariant: 4, rest: 39, winnerIndex: null });
    expect(v.variants.map((x) => [x.label, x.state, x.total, x.devices])).toEqual([['문안 A', 'sent', 4, null], ['문안 B', 'sent', 4, null]]);
    expect(v.variants[0].text).toContain(LINK);              // 요약은 담당자가 쓴 글(줄이기 전)
    const staff: SplitCtx = { companyId: CO, userId: STAFF, userType: 'company_user' };
    expect(await readSplit(staff, id)).toBeNull();
    expect((await listSplits(staff)).some((x) => x.id === id)).toBe(false);
    expect((await listSplits(CTX)).some((x) => x.id === id)).toBe(true);
    expect(await stopSplit(staff, id)).toBe(false);
    expect(await resumeSplit(staff, id)).toBe(false);
    expect(await readSplit({ ...CTX, companyId: OTHER }, id)).toBeNull();
  });
});

describe('누른 기기 수(실 PG · 운영 문장 그대로)', () => {
  it('그 문안의 해시들 · ip + user_agent 가 같으면 한 번 · 시작 전 · 다른 회사 · 다른 해시는 세지 않는다', async () => {
    const [h1, h2, other] = [`sp${randomUUID().slice(0, 6)}`, `sp${randomUUID().slice(0, 6)}`, `sp${randomUUID().slice(0, 6)}`];
    const since = new Date(Date.now() - 60 * 1000);
    await click(h1, '10.9.0.1', 'UA-A');
    await click(h1, '10.9.0.1', 'UA-A');
    await click(h2, '10.9.0.1', 'UA-A');                    // 같은 문안의 다른 링크 · 같은 기기 = 한 번
    await click(h1, '10.9.0.1', 'UA-B');
    await click(h2, '10.9.0.2', 'UA-A');
    await click(other, '10.9.0.9', 'UA-Z');
    await click(h1, '10.9.0.8', 'UA-A', OTHER);
    await click(h1, '10.9.0.7', 'UA-A', CO, `NOW() - interval '2 hours'`);
    const n = async (hashes: string[]) => (await pool.query(SPLIT_DEVICES_SQL, [CO, since, hashes])).rows[0].devices;
    expect(await n([h1, h2])).toBe(3);
    expect(await n([h1])).toBe(2);
    expect(await n([`none${randomUUID().slice(0, 6)}`])).toBe(0);
  });
});

describe('시작 요청 버리기 — 화면이 짐작하지 않고 서버가 정한다(실 PG)', () => {
  it('없는 id 를 버리면 닫힌다 = 그 뒤에 닿은 같은 id 의 시작은 만들지 않는다 · 이미 만들어진 id 는 그것을 돌려준다(시작된 것)', async () => {
    const id = randomUUID();
    const plan = await planSplit(CTX, input(id), SEND_TIME());
    expect(await discardSplitStart(CTX, id)).toBeNull();
    await expect(createSplit(CTX, id, plan)).rejects.toMatchObject({ code: 'SPLIT_START_CLOSED' });
    expect(await rowOf(id)).toBeUndefined();
    expect(await members(id)).toHaveLength(0);
    // 표기가 달라도 같은 id(대문자)
    await expect(createSplit(CTX, id.toUpperCase(), plan)).rejects.toMatchObject({ code: 'SPLIT_START_CLOSED' });
    // 만들어진 것은 닫지 않는다 = 그대로 돌려준다
    const made = await start();
    expect(await discardSplitStart(CTX, made.id)).toMatchObject({ id: made.id, status: 'testing' });
    expect(await createSplit(CTX, made.id, made.plan)).toEqual({ created: false });
    expect((await rowOf(made.id)).status).toBe('testing');
    expect(await members(made.id)).toHaveLength(ELIGIBLE);
  });
  it('같은 id 의 만들기와 버리기는 닿은 순서대로 = 만드는 중에 닿은 버리기는 만들기가 끝난 뒤에 보고 「시작됨」을 돌려준다', async () => {
    const id = randomUUID();
    const plan = await planSplit(CTX, input(id), SEND_TIME());
    // 만들기를 가운데서 붙잡아 둔다(받는 사람 고정 표를 잠근다 = 행은 넣었지만 아직 확정 전 · 다른 연결에는 안 보인다)
    const holder = await pool.connect();
    await holder.query('BEGIN');
    await holder.query('LOCK TABLE campaign_split_members IN ACCESS EXCLUSIVE MODE');
    let seen: any = 'waiting';
    try {
      const making = createSplit(CTX, id, plan);
      const dropping = discardSplitStart(CTX, id).then((v) => { seen = v; return v; });
      await new Promise((r) => setTimeout(r, 400));
      expect(seen).toBe('waiting');                          // 버리기는 줄을 서 있다(「없다」고 먼저 답하지 않는다)
      await holder.query('COMMIT');
      expect(await making).toEqual({ created: true });
      expect(await dropping).toMatchObject({ id, status: 'testing' });
      expect(await members(id)).toHaveLength(ELIGIBLE);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });
  it('닫은 id 의 기억은 한 시간(쌓이지 않는다)', async () => {
    const old = randomUUID();
    const t0 = Date.now();
    expect(await discardSplitStart(CTX, old, t0)).toBeNull();
    expect(await discardSplitStart(CTX, randomUUID(), t0 + 59 * 60 * 1000)).toBeNull();
    await expect(createSplit(CTX, old, await planSplit(CTX, input(old), SEND_TIME()))).rejects.toMatchObject({ code: 'SPLIT_START_CLOSED' });
    expect(await discardSplitStart(CTX, randomUUID(), t0 + 61 * 60 * 1000)).toBeNull();
    expect(await createSplit(CTX, old, await planSplit(CTX, input(old), SEND_TIME()))).toEqual({ created: true });
  });
});
