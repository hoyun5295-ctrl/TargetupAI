// replaces: none
/**
 * C113 실 PG 시험(★ 2026-11-07 설계서 docs/2026-11-07-c113-structure-fix-design.md §5 실 PG 줄)
 *   D1 · D2 요금제 = 두 길 · 요금제 끝 = 네 칸 비움 / D10 주인 해제 · D11 살아 있음 · 다시 잇기 · 수신자 해제 · 예약 변경(적재 전 · 넓히기 · 좁히기) /
 *   D13 여정 = 예약만 / D10 보관 칸 / 8R 미리 만든 id 로 INSERT.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import {
  resolveAdGateMode, loadAdGatePolicy, gatePhones, gateStaging, linkAdMarks, resetAdGateSchemaCache, endAdGateIfUnpaid,
  releaseUnlinkedReservations, releaseCampaignPhoneReservation, campaignHasReservations,
  rescheduleQueuedReservations, expandCampaignReservations, contractCampaignReservations,
  campaignAdGateLinked, saveAdGateSettings,
} from '../ad-send-gate';
import { AD_BRANCHES } from '../ad-send-gate-core';
import { parkedStagingId } from '../staging-sweeper';
import { CAMPAIGN_INSERT_SQL, buildDirectSendCampaignParams, withCampaignId } from '../direct-send-spec';

// 보관 칸 id = 서버 비밀키 HMAC(staging-sweeper · 운영은 기동 때 비밀키를 강제) — 시험은 임의 값
process.env.JWT_SECRET = process.env.JWT_SECRET || 'c113-pg-test-secret';

let seq = 0;
const phoneOf = () => `0109${String(1107000 + seq++).padStart(7, '0')}`;
const kstDay = (offset = 0) => new Date(Date.now() + 9 * 3600 * 1000 + offset * 86400000).toISOString().slice(0, 10);
const plans: Record<string, string> = {};
const planOf = async (kind: 'paid' | 'free'): Promise<string> => {
  if (plans[kind]) return plans[kind];
  const id = randomUUID();
  await insertMinimalRow(pool, 'plans', { id, plan_code: kind === 'free' ? 'FREE' : `C113-${id.slice(0, 8)}`, plan_name: kind, is_active: true })
    .catch(async () => {   // FREE 가 이미 있으면 그 줄을 쓴다
      const r = await query(`SELECT id FROM plans WHERE plan_code = 'FREE' LIMIT 1`);
      plans[kind] = String(r.rows[0].id);
    });
  if (!plans[kind]) plans[kind] = id;
  return plans[kind];
};
const newCompany = async (kind: 'paid' | 'free' = 'paid', status: string | null = null): Promise<string> => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'companies', { id, plan_id: await planOf(kind), ...(status ? { subscription_status: status } : {}) });
  return id;
};
const newCampaign = async (co: string, status = 'scheduled', sendPhase: string | null = null): Promise<string> => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'campaigns', { id, company_id: co, status, ...(sendPhase ? { send_phase: sendPhase } : {}) });
  return id;
};
const marks = async (where: string, params: unknown[]) =>
  (await query(`SELECT phone, kind, to_char(send_day, 'YYYY-MM-DD') AS day, campaign_id FROM ad_send_marks WHERE ${where} ORDER BY phone, kind, send_day`, params)).rows;
const gateCols = async (co: string) =>
  (await query(`SELECT global_holdout_pct, global_holdout_since, campaign_holdout_pct, send_priority_order FROM companies WHERE id = $1::uuid`, [co])).rows[0];

describe('C113 실 PG', () => {
  beforeAll(async () => {
    for (const id of ['C98-DDL-2', 'C99-DDL-1', 'C99-DDL-2', 'C110-DDL-1']) await pool.query(ledgerBlockSql(id)).catch(() => undefined);
    resetAdGateSchemaCache();
  }, 120_000);

  it('D1 · D23 두 길 — 미가입 · 만료 = 설정이 있어도 옛 길 · 유료 + 켬 = 관문 길 · 유료 + 끔 = 옛 길 · 끔 + 앞 배정 = 관문 길', async () => {
    const free = await newCompany('free');
    const expired = await newCompany('paid', 'expired');
    const paid = await newCompany('paid');
    for (const co of [free, expired, paid]) {
      await query(`UPDATE companies SET global_holdout_pct = 10, global_holdout_since = NOW() WHERE id = $1::uuid`, [co]);
    }
    expect(await resolveAdGateMode(free)).toEqual({ mode: 'legacy' });
    expect(await resolveAdGateMode(expired)).toEqual({ mode: 'legacy' });
    expect((await resolveAdGateMode(paid)).mode).toBe('gate');
    const off = await newCompany('paid');
    expect(await resolveAdGateMode(off)).toEqual({ mode: 'legacy' });
    // 끔 + 그 묶음 앞 배정 = 관문 길(첫 배정을 지킨다)
    const batch = randomUUID();
    await query(`INSERT INTO ad_send_marks (company_id, batch_id, branch, kind, phone, send_day) VALUES ($1, $2, 'direct', 'campaign_holdout', $3, $4::date)`, [off, batch, phoneOf(), kstDay()]);
    expect((await resolveAdGateMode(off, { batchId: batch, priorArmsPossible: true })).mode).toBe('gate');
    expect(await resolveAdGateMode(off, { batchId: randomUUID(), priorArmsPossible: true })).toEqual({ mode: 'legacy' });
    expect(await resolveAdGateMode(off, { batchId: batch, priorArmsPossible: false })).toEqual({ mode: 'legacy' });
  });

  it('D2 요금제 끝 = 네 칸 비움(미가입 · 만료) · 유료는 그대로 · 트랜잭션 안 저장점(바깥 트랜잭션 계속)', async () => {
    const free = await newCompany('free');
    const paid = await newCompany('paid');
    for (const co of [free, paid]) {
      await query(`UPDATE companies SET global_holdout_pct = 5, global_holdout_since = NOW(), campaign_holdout_pct = 10, send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await endAdGateIfUnpaid(client, free);
      await endAdGateIfUnpaid(client, paid);
      await client.query('SELECT 1');   // 바깥 트랜잭션이 깨지지 않았다
      await client.query('COMMIT');
    } finally { client.release(); }
    expect(await gateCols(free)).toEqual({ global_holdout_pct: null, global_holdout_since: null, campaign_holdout_pct: null, send_priority_order: null });
    const p = await gateCols(paid);
    expect([p.global_holdout_pct, p.campaign_holdout_pct]).toEqual([5, 10]);
    // 트랜잭션 밖 = 저장점 없이 한 문장
    await query(`UPDATE companies SET subscription_status = 'suspended' WHERE id = $1::uuid`, [paid]);
    const c2 = await pool.connect();
    try { await endAdGateIfUnpaid(c2, paid); } finally { c2.release(); }
    expect((await gateCols(paid)).global_holdout_pct).toBeNull();
  });

  it('D11 ① 살아 있음 — 취소된 캠페인에 이어진 예약 = 안 막음 · failed 캠페인 = 막음 · 이어진 캠페인이 없는 줄 = 2시간만', async () => {
    const co = await newCompany('paid');
    await query(`UPDATE companies SET send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);
    const policy = await loadAdGatePolicy(co);
    const [a, b, c] = [phoneOf(), phoneOf(), phoneOf()];
    const hi = randomUUID();
    await gatePhones(policy, { branch: 'journey', batchId: hi, reserve: true }, [a, b, c]);
    const cancelled = await newCampaign(co, 'cancelled');
    const failed = await newCampaign(co, 'failed', 'failed');
    await linkAdMarks(co, hi, cancelled, [a]);
    await linkAdMarks(co, hi, failed, [b]);
    await query(`UPDATE ad_send_marks SET campaign_id = $3::uuid, created_at = NOW() - INTERVAL '3 hours' WHERE batch_id = $1::uuid AND phone = $2`, [hi, c, randomUUID()]);   // 이어진 캠페인 행이 없음 + 2시간 넘음
    const out = await gatePhones(policy, { branch: 'dm', batchId: randomUUID(), reserve: false }, [a, b, c]);
    expect(out.excluded.get(a)).toBeUndefined();
    expect(out.excluded.get(b)).toBe('priority');
    expect(out.excluded.get(c)).toBeUndefined();
  });

  it('D11 ④ 다시 잇기 — 이어진 캠페인이 없거나 failed 면 새 캠페인이 넘겨받음 · 살아 있는 캠페인에 이어진 줄은 그대로', async () => {
    const co = await newCompany('paid');
    const batch = randomUUID();
    const p = phoneOf();
    await query(`INSERT INTO ad_send_marks (company_id, batch_id, branch, kind, phone, send_day) VALUES ($1, $2, 'direct', 'reserved', $3, $4::date)`, [co, batch, p, kstDay()]);
    const live = await newCampaign(co, 'scheduled');
    await linkAdMarks(co, batch, live);
    const other = await newCampaign(co, 'scheduled');
    await linkAdMarks(co, batch, other);
    expect((await marks('batch_id = $1::uuid', [batch]))[0].campaign_id).toBe(live);
    await query(`UPDATE campaigns SET status = 'failed', send_phase = 'failed' WHERE id = $1::uuid`, [live]);
    await linkAdMarks(co, batch, other);
    expect((await marks('batch_id = $1::uuid', [batch]))[0].campaign_id).toBe(other);
  });

  it('D10 주인 해제 — 이어지지 않은 예약만 · keep 번호 · 다른 묶음 · 이어진 줄 · 빠짐 줄은 그대로', async () => {
    const co = await newCompany('paid');
    const batch = randomUUID();
    const other = randomUUID();
    const [a, b, c] = [phoneOf(), phoneOf(), phoneOf()];
    const camp = await newCampaign(co);
    await query(
      `INSERT INTO ad_send_marks (company_id, batch_id, branch, kind, phone, send_day, campaign_id) VALUES
         ($1, $2, 'direct', 'reserved', $4, $6::date, NULL), ($1, $2, 'direct', 'reserved', $5, $6::date, NULL),
         ($1, $2, 'direct', 'reserved', $7, $6::date, $8::uuid), ($1, $2, 'direct', 'global_holdout', $4, $6::date, NULL),
         ($1, $3, 'direct', 'reserved', $4, $6::date, NULL)`,
      [co, batch, other, a, b, kstDay(), c, camp]);
    await releaseUnlinkedReservations(co, batch, [b]);
    const left = await marks('company_id = $1::uuid', [co]);
    expect(left.filter((m: any) => m.kind === 'reserved' && !m.campaign_id).map((m: any) => m.phone).sort()).toEqual([a, b].sort().filter((x) => x === b).concat([a]).sort());
    // a 는 other 묶음 예약만 남음 · b = keep · c = 이어진 줄 · 빠짐 줄 = 그대로
    expect(left.some((m: any) => m.phone === a && m.kind === 'global_holdout')).toBe(true);
    expect(left.some((m: any) => m.phone === c && m.campaign_id === camp)).toBe(true);
    expect((await marks('batch_id = $1::uuid AND kind = $2', [batch, 'reserved'])).map((m: any) => m.phone).sort()).toEqual([b, c].sort());
  });

  it('D11 ③ 수신자 해제 — 그 캠페인에 이어진 그 번호 예약만 지움', async () => {
    const co = await newCompany('paid');
    const camp = await newCampaign(co);
    const batch = randomUUID();
    const [a, b] = [phoneOf(), phoneOf()];
    await query(`INSERT INTO ad_send_marks (company_id, batch_id, branch, kind, phone, send_day, campaign_id) VALUES ($1, $2, 'direct', 'reserved', $3, $5::date, $6::uuid), ($1, $2, 'direct', 'reserved', $4, $5::date, $6::uuid)`, [co, batch, a, b, kstDay(), camp]);
    await releaseCampaignPhoneReservation(co, camp, a);
    expect((await marks('campaign_id = $1::uuid', [camp])).map((m: any) => m.phone)).toEqual([b]);
  });

  it('D11 ② 예약 확인 = 이어진 줄 + 아직 안 이어진 그 캠페인 묶음 줄(캠페인 id · staging_id) · 다른 묶음 = 없음', async () => {
    const co = await newCompany('paid');
    const camp = await newCampaign(co);
    const staging = randomUUID();
    expect(await campaignHasReservations(co, camp, [camp, staging])).toBe(false);
    await query(`INSERT INTO ad_send_marks (company_id, batch_id, branch, kind, phone, send_day) VALUES ($1, $2, 'direct', 'reserved', $3, $4::date)`, [co, staging, phoneOf(), kstDay()]);
    expect(await campaignHasReservations(co, camp, [camp, staging])).toBe(true);
    expect(await campaignHasReservations(co, camp, [camp])).toBe(false);
  });

  it('D11 ② 적재 전 예약 변경 = 한 트랜잭션(새 날 줄 · 캠페인 · 옛 날 줄 지움) · 캠페인 UPDATE 0행 = 되돌림(바뀐 것 0)', async () => {
    const co = await newCompany('paid');
    const camp = await newCampaign(co, 'scheduled', 'queued');
    const batch = randomUUID();
    const [a, b] = [phoneOf(), phoneOf()];
    const d1 = kstDay(1), d3 = kstDay(3), d4 = kstDay(4);
    await query(`INSERT INTO ad_send_marks (company_id, batch_id, branch, kind, phone, send_day, campaign_id) VALUES ($1, $2, 'direct', 'reserved', $3, $5::date, $6::uuid), ($1, $2, 'direct', 'reserved', $4, $5::date, $6::uuid)`, [co, batch, a, b, d1, camp]);
    const ok = await rescheduleQueuedReservations(co, camp, [camp], [d3, d4], async (run) => (await run(`UPDATE campaigns SET updated_at = NOW() WHERE id = $1::uuid AND send_phase = 'queued'`, [camp])).rowCount || 0);
    expect(ok).toBe(true);
    const m = await marks('campaign_id = $1::uuid', [camp]);
    expect(m.map((x: any) => `${x.phone}:${x.day}`).sort()).toEqual([`${a}:${d3}`, `${a}:${d4}`, `${b}:${d3}`, `${b}:${d4}`].sort());
    const no = await rescheduleQueuedReservations(co, camp, [camp], [kstDay(6)], async () => 0);
    expect(no).toBe(false);
    expect((await marks('campaign_id = $1::uuid', [camp])).map((x: any) => x.day).sort()).toEqual([d3, d3, d4, d4]);
  });

  it('D11 ② 적재 뒤 = 넓히기(옛 · 새 날 다 지킴) → 좁히기(캠페인 시각 + 새 기간 밖 줄 지움) · 넓힌 채 = 덜 보내는 쪽', async () => {
    const co = await newCompany('paid');
    await query(`UPDATE companies SET send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);
    const camp = await newCampaign(co, 'scheduled');
    const batch = randomUUID();
    const p = phoneOf();
    const d1 = kstDay(1), d2 = kstDay(2);
    await query(`INSERT INTO ad_send_marks (company_id, batch_id, branch, kind, phone, send_day, campaign_id) VALUES ($1, $2, 'journey', 'reserved', $3, $4::date, $5::uuid)`, [co, batch, p, d1, camp]);
    await expandCampaignReservations(co, camp, [camp], [d2]);
    expect((await marks('campaign_id = $1::uuid', [camp])).map((x: any) => x.day).sort()).toEqual([d1, d2]);
    // 넓힌 채(밀기 실패) = 옛 날 · 새 날 모두 낮은 갈래를 막는다
    const policy = await loadAdGatePolicy(co);
    for (const d of [d1, d2]) {
      expect((await gatePhones(policy, { branch: 'direct', batchId: randomUUID(), reserve: false, span: { from: d, to: d } }, [p])).excluded.get(p)).toBe('priority');
    }
    await contractCampaignReservations(co, camp, [camp], [d2], (run) => run(`UPDATE campaigns SET updated_at = NOW() WHERE id = $1::uuid`, [camp]));
    expect((await marks('campaign_id = $1::uuid', [camp])).map((x: any) => x.day)).toEqual([d2]);
  });

  it('D13 여정 = 원장에 예약만(빠짐 줄 0) · D10 보관 칸 = 뺀 행을 지우지 않고 칸으로', async () => {
    const co = await newCompany('paid');
    await query(`UPDATE companies SET global_holdout_pct = 10, global_holdout_since = NOW(), send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);
    const policy = await loadAdGatePolicy(co);
    const phones = Array.from({ length: 300 }, phoneOf);
    const batch = randomUUID();
    const out = await gatePhones(policy, { branch: 'journey', batchId: batch, reserve: true, recordExclusions: false }, phones);
    expect(out.counts.global_holdout, JSON.stringify({ out: out.counts, ready: policy.ready, pct: policy.globalPct, deg: out.degraded })).toBeGreaterThan(0);
    const kinds = new Set((await marks('batch_id = $1::uuid', [batch])).map((m: any) => m.kind));
    expect([...kinds]).toEqual(['reserved']);

    const user = randomUUID();
    await insertMinimalRow(pool, 'users', { id: user, company_id: co, user_type: 'admin', login_id: `t-c113-${user.slice(0, 8)}` });
    const staging = randomUUID();
    const sp = Array.from({ length: 300 }, phoneOf);
    for (const ph of sp) await insertMinimalRow(pool, 'campaign_send_staging', { staging_id: staging, company_id: co, phone: ph });
    const g = await gateStaging(policy, { branch: 'direct', stagingId: staging, unsubUserId: user, mode: 'commit', parkExcluded: true });
    expect(g.counts.global_holdout, JSON.stringify({ g: g.counts, deg: g.degraded })).toBeGreaterThan(0);
    const parked = (await query(`SELECT COUNT(*)::int AS n FROM campaign_send_staging WHERE staging_id = $1::uuid`, [parkedStagingId(staging)])).rows[0].n;
    const left = (await query(`SELECT COUNT(*)::int AS n FROM campaign_send_staging WHERE staging_id = $1::uuid`, [staging])).rows[0].n;
    expect(parked).toBe(g.excludedRows);
    expect(left + parked).toBe(300);
  });

  it('8R 미리 만든 id 로 INSERT = 그 id 로 캠페인이 생긴다(공용 입구 문장 · 자리표시자 그대로)', async () => {
    const co = await newCompany('paid');
    const id = randomUUID();
    const params = buildDirectSendCampaignParams({
      stagingId: randomUUID(), campaignName: 'C113 시험', msgType: 'SMS', total: 1, message: '시험', subject: null, callback: '0212345678', sendChannel: 'sms',
      adEnabled: false, scheduled: false, scheduledAt: null,
    } as any, { companyId: co, userId: randomUUID() });
    const ins = withCampaignId(CAMPAIGN_INSERT_SQL, params, id);
    const r = await query(ins.sql, ins.params);
    expect(String(r.rows[0].id)).toBe(id);
    expect((await query(`SELECT send_phase, campaign_name FROM campaigns WHERE id = $1::uuid`, [id])).rows[0]).toEqual({ send_phase: 'preparing', campaign_name: 'C113 시험' });
  });
  it('구현 1R #1 잇기 = 캠페인 표시(send_config.adGateLinked · 원장 줄과 한 트랜잭션) · 다른 send_config 칸은 그대로', async () => {
    const co = await newCompany('paid');
    const camp = await newCampaign(co, 'scheduled', 'queued');
    await query(`UPDATE campaigns SET send_config = '{"scheduledAt":"2026-11-08T01:00:00.000Z"}'::jsonb WHERE id = $1::uuid`, [camp]);
    const batch = randomUUID();
    const ph = phoneOf();
    await query(`INSERT INTO ad_send_marks (company_id, batch_id, branch, kind, phone, send_day) VALUES ($1, $2, 'direct', 'reserved', $3, $4::date)`, [co, batch, ph, kstDay()]);
    const before = (await query(`SELECT * FROM campaigns WHERE id = $1::uuid`, [camp])).rows[0];
    expect(campaignAdGateLinked(before)).toBe(false);
    await linkAdMarks(co, batch, camp);
    const after = (await query(`SELECT * FROM campaigns WHERE id = $1::uuid`, [camp])).rows[0];
    expect(campaignAdGateLinked(after)).toBe(true);
    expect(after.send_config.scheduledAt).toBe('2026-11-08T01:00:00.000Z');
    expect((await marks('batch_id = $1::uuid', [batch]))[0].campaign_id).toBe(camp);
    // 다른 회사의 캠페인 id 로 부르면 표시 0(회사 조건)
    const other = await newCompany('paid');
    const otherCamp = await newCampaign(other);
    await linkAdMarks(co, randomUUID(), otherCamp);
    expect(campaignAdGateLinked((await query(`SELECT * FROM campaigns WHERE id = $1::uuid`, [otherCamp])).rows[0])).toBe(false);
  });

  it('구현 1R #6 보관 칸 판정 = 전원 빠지면 옮기지 않음(원본 행 그대로 · allExcluded) · 일부면 옮김', async () => {
    const co = await newCompany('paid');
    await query(`UPDATE companies SET send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);
    const policy = await loadAdGatePolicy(co);
    const user = randomUUID();
    await insertMinimalRow(pool, 'users', { id: user, company_id: co, user_type: 'admin', login_id: `t-c113h-${user.slice(0, 8)}` });
    const sp = Array.from({ length: 4 }, phoneOf);
    await gatePhones(policy, { branch: 'journey', batchId: randomUUID(), reserve: true }, sp);   // 더 높은 갈래가 오늘 네 번호를 예약
    const all = randomUUID();
    for (const ph of sp) await insertMinimalRow(pool, 'campaign_send_staging', { staging_id: all, company_id: co, phone: ph });
    const g = await gateStaging(policy, { branch: 'direct', stagingId: all, unsubUserId: user, mode: 'commit', parkExcluded: true });
    expect(g.allExcluded).toBe(true);
    expect(g.counts.priority).toBe(4);
    expect((await query(`SELECT COUNT(*)::int AS n FROM campaign_send_staging WHERE staging_id = $1::uuid`, [all])).rows[0].n).toBe(4);
    expect((await query(`SELECT COUNT(*)::int AS n FROM campaign_send_staging WHERE staging_id = $1::uuid`, [parkedStagingId(all)])).rows[0].n).toBe(0);
    const part = randomUUID();
    const fresh = phoneOf();
    for (const ph of [...sp, fresh]) await insertMinimalRow(pool, 'campaign_send_staging', { staging_id: part, company_id: co, phone: ph });
    const g2 = await gateStaging(policy, { branch: 'direct', stagingId: part, unsubUserId: user, mode: 'commit', parkExcluded: true });
    expect(g2.allExcluded).toBe(false);
    expect((await query(`SELECT phone FROM campaign_send_staging WHERE staging_id = $1::uuid`, [part])).rows.map((r: any) => r.phone)).toEqual([fresh]);
    expect((await query(`SELECT COUNT(*)::int AS n FROM campaign_send_staging WHERE staging_id = $1::uuid`, [parkedStagingId(part)])).rows[0].n).toBe(4);
  });

  it('구현 1R #7 설정 저장 = 요금제 조건 문장(미가입 = 0 행 · 칸 그대로) · 강등과 겹치면 늦은 저장이 비운 칸을 되살리지 않음', async () => {
    const free = await newCompany('free');
    expect(await saveAdGateSettings(free, { campaign_holdout_pct: 10 })).toBe('unpaid');
    expect((await gateCols(free)).campaign_holdout_pct).toBeNull();
    const paid = await newCompany('paid');
    expect(await saveAdGateSettings(paid, { campaign_holdout_pct: 10 })).toBe('saved');
    expect(Number((await gateCols(paid)).campaign_holdout_pct)).toBe(10);
    expect(await saveAdGateSettings(paid, {})).toBe('none');

    // 강등 트랜잭션(요금제 → FREE + 네 칸 비움)이 행 잠금을 쥔 동안 늦은 저장이 들어옴 → 커밋 뒤 다시 판정 = 0 행
    const co = await newCompany('paid');
    await query(`UPDATE companies SET campaign_holdout_pct = 5 WHERE id = $1::uuid`, [co]);
    const t1 = await pool.connect();
    try {
      await t1.query('BEGIN');
      await t1.query(`UPDATE companies SET plan_id = $2::uuid WHERE id = $1::uuid`, [co, await planOf('free')]);
      await endAdGateIfUnpaid(t1, co);
      const late = saveAdGateSettings(co, { campaign_holdout_pct: 20 });
      await new Promise((r) => setTimeout(r, 300));
      await t1.query('COMMIT');
      expect(await late).toBe('unpaid');
    } finally {
      t1.release();
    }
    expect((await gateCols(co)).campaign_holdout_pct).toBeNull();
  });
});
