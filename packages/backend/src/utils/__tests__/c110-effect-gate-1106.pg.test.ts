// replaces: none
/**
 * C110 광고 관문 · 효과 측정 실 PG 시험(★ 2026-11-06 설계서 docs/2026-11-06-c110-effect-proof-priority-design.md §8 실 PG 줄)
 *   앞 묶음 = C110-DDL-1 전(새 칸 없음 = 옛 길 · 피로도 = HEAD 판정 그대로) · 뒤 묶음 = C110-DDL-1 을 사본에 얹고(원장 SQL 도 함께 검증) 관문 · 측정.
 *   ★ 2026-11-07 C113 D1 · D23 — 관문 = 요금제를 쓰는 회사만(시험 회사 = 유료 요금제) · 관문은 피로도를 보지 않는다(장애 = 새 기능 없이 통과).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';

vi.mock('../unified-customer-profile', () => ({ recomputeProfile: vi.fn(async () => undefined) }));

import { syncOrder } from '../cdp-orders';
import {
  loadAdGatePolicy, gatePhones, gateStaging, linkAdMarks, linkAdMarksSafe, resetAdGateSchemaCache, holdoutBucketSql, AdGateUnavailableError, directSendSpanOf,
  resolveAdGateMode,
} from '../ad-send-gate';
import { getFatigueBlockedSet } from '../fatigue-guard';
import { campaignEffects, journeyHoldoutEffect, measureGroups } from '../effect-measure';
import { AD_BRANCHES } from '../ad-send-gate-core';

let seq = 0;
const phoneOf = () => `0109${String(1106000 + seq++).padStart(7, '0')}`;
// ★ C113 D1 — 관문 = 요금제를 쓰는 회사만 · 시험 회사 = 유료 요금제(FREE 아님 · 구독 정상)
let paidPlanId: string | null = null;
const paidPlan = async (): Promise<string> => {
  if (paidPlanId) return paidPlanId;
  const id = randomUUID();
  await insertMinimalRow(pool, 'plans', { id, plan_code: `C110-${id.slice(0, 8)}`, plan_name: 'C110 시험', is_active: true });
  paidPlanId = id;
  return id;
};
const newCompany = async (paid = true): Promise<string> => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'companies', paid ? { id, plan_id: await paidPlan() } : { id });
  return id;
};
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addCustomer = async (co: string, phone: string): Promise<string> => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'customers', { id, company_id: co, phone, is_active: true });
  return id;
};
const paidOrder = (co: string, phone: string, orderId: string, amount: number, at: Date) =>
  syncOrder(co, { source: 'woocommerce', orderId, externalId: `w:${phone}`, phone, name: '시험', status: 'paid', totalAmount: amount, orderedAt: at.toISOString(), paidAt: at.toISOString(), srcAt: at.toISOString() } as any);
const stage = async (co: string, stagingId: string, phones: string[]) => {
  for (const p of phones) await insertMinimalRow(pool, 'campaign_send_staging', { staging_id: stagingId, company_id: co, phone: p });
};
const stagedPhones = async (stagingId: string): Promise<string[]> =>
  (await query(`SELECT DISTINCT phone FROM campaign_send_staging WHERE staging_id = $1::uuid ORDER BY phone`, [stagingId])).rows.map((r: any) => r.phone);
const marks = async (batch: string) =>
  (await query(`SELECT phone, kind, campaign_id FROM ad_send_marks WHERE batch_id = $1::uuid ORDER BY phone, kind`, [batch])).rows;

describe('C110-DDL-1 전 = 옛 길(관문 0 · 피로도 = HEAD 판정 그대로)', () => {
  it('새 칸 없음 → ready 거짓 · 두 길 판정 = 옛 길 · 피로도 = 옛 GROUP BY · HAVING 문장과 같은 집합', async () => {
    resetAdGateSchemaCache();
    const co = await newCompany();
    await query(`UPDATE companies SET fatigue_cap_days = 7, fatigue_cap_max = 2 WHERE id = $1::uuid`, [co]);
    const [a, b, c] = [phoneOf(), phoneOf(), phoneOf()];
    await query(`INSERT INTO send_fatigue_daily (company_id, phone, day, sent_count) VALUES ($1, $2, $4::date, 2), ($1, $3, $4::date, 1)`, [co, a, b, kstToday()]);
    expect((await loadAdGatePolicy(co)).ready).toBe(false);
    expect(await resolveAdGateMode(co, { batchId: randomUUID(), priorArmsPossible: true })).toEqual({ mode: 'legacy' });
    const old = await getFatigueBlockedSet(co, { days: 7, max: 2 }, [a, b, c]);
    expect([...old]).toEqual([a]);
    const legacy = await query(
      `SELECT phone FROM send_fatigue_daily WHERE company_id = $1::uuid AND phone = ANY($2::text[])
          AND day >= ((NOW() AT TIME ZONE 'Asia/Seoul')::date - (7 - 1)) AND day <= (NOW() AT TIME ZONE 'Asia/Seoul')::date
        GROUP BY phone HAVING SUM(sent_count) >= 2`, [co, [a, b, c]]);
    expect(legacy.rows.map((r: any) => r.phone)).toEqual([a]);
  });
});

describe('C110-DDL-1 뒤 · 관문 · 측정', () => {
  beforeAll(async () => {
    await pool.query(ledgerBlockSql('C98-DDL-2'));
    await pool.query(ledgerBlockSql('C99-DDL-1'));
    await pool.query(ledgerBlockSql('C99-DDL-2'));
    await pool.query(ledgerBlockSql('C110-DDL-1'));
    resetAdGateSchemaCache();
  }, 120_000);

  it('칸 · 표가 있다 · 해시 칸 = 0 ~ 9999 정수 · 같은 입력 같은 값', async () => {
    const r = await query(`SELECT ${holdoutBucketSql("'k'", "'01011112222'")} AS a, ${holdoutBucketSql("'k'", "'01011112222'")} AS b,
                                  ${holdoutBucketSql("'zz'", "'01099998888'")} AS c`);
    for (const v of [r.rows[0].a, r.rows[0].c]) { expect(Number(v)).toBeGreaterThanOrEqual(0); expect(Number(v)).toBeLessThan(10000); }
    expect(r.rows[0].a).toBe(r.rows[0].b);
    const co = await newCompany();
    expect((await loadAdGatePolicy(co)).ready).toBe(true);
  });

  it('발송별 대조군 = 적격 뒤 · 마지막 · 받는 쪽도 원장 · 수신거부 번호는 원장 0 · 적재 표에서 지움 · 미리보기는 안 지움', async () => {
    const co = await newCompany();
    const user = randomUUID();
    await insertMinimalRow(pool, 'users', { id: user, company_id: co, user_type: 'admin', login_id: `t-c110-${user.slice(0, 8)}` });
    await query(`UPDATE companies SET campaign_holdout_pct = 20 WHERE id = $1::uuid`, [co]);
    const phones = Array.from({ length: 200 }, phoneOf);
    const staging = randomUUID();
    await stage(co, staging, [...phones, phones[0]]);   // 중복 한 줄
    await insertMinimalRow(pool, 'unsubscribes', { user_id: user, phone: phones[1], company_id: co });
    const policy = await loadAdGatePolicy(co);
    const dry = await gateStaging(policy, { branch: 'direct', stagingId: staging, unsubUserId: user, mode: 'dry' });
    expect((await stagedPhones(staging)).length).toBe(200);
    expect(await marks(staging)).toEqual([]);
    const out = await gateStaging(policy, { branch: 'direct', stagingId: staging, unsubUserId: user, mode: 'commit' });
    expect(out.counts.campaign_holdout).toBe(dry.counts.campaign_holdout);
    expect(out.counts.campaign_holdout).toBeGreaterThanOrEqual(20);
    expect(out.counts.campaign_holdout).toBeLessThanOrEqual(60);
    const m = await marks(staging);
    const held = m.filter((x: any) => x.kind === 'campaign_holdout').map((x: any) => x.phone);
    const treated = m.filter((x: any) => x.kind === 'campaign_treated').map((x: any) => x.phone);
    expect(held.length + treated.length).toBe(199);   // 수신거부 1 빼고 전부
    expect(m.some((x: any) => x.phone === phones[1])).toBe(false);
    const left = await stagedPhones(staging);
    expect(left.some((p) => held.includes(p))).toBe(false);
    expect(left).toContain(phones[1]);   // 수신거부는 관문이 안 지운다(워커가 지운다)

    // 묶음당 한 번 — 비율을 바꾸고 · 대조군 번호가 다시 들어와도 같은 무리
    await query(`UPDATE companies SET campaign_holdout_pct = 30 WHERE id = $1::uuid`, [co]);
    await stage(co, staging, [held[0]]);
    const again = await gateStaging(await loadAdGatePolicy(co), { branch: 'direct', stagingId: staging, unsubUserId: user, mode: 'commit' });
    expect(again.counts.campaign_holdout).toBe(1);
    expect(await stagedPhones(staging)).not.toContain(held[0]);
    const m2 = await marks(staging);
    expect(m2.filter((x: any) => x.kind === 'campaign_holdout').length).toBe(held.length);

    // 연결 = 묶음 전부 · 이어진 캠페인 행이 지워지면(차감 실패 롤백) 같은 묶음의 다음 시도가 다시 잇는다(구현 1R #3)
    const camp = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { id: camp, company_id: co, status: 'sending' });
    await linkAdMarks(co, staging, camp);
    expect((await marks(staging)).every((x: any) => x.campaign_id === camp)).toBe(true);
    await query(`DELETE FROM campaigns WHERE id = $1::uuid`, [camp]);
    const camp2 = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { id: camp2, company_id: co, status: 'sending' });
    await linkAdMarks(co, staging, camp2);
    expect((await marks(staging)).every((x: any) => x.campaign_id === camp2)).toBe(true);

    // 비율을 꺼도(새 판정 전부 꺼짐) 첫 배정은 지킨다 — 대조군 번호가 다시 들어오면 또 뺀다(구현 1R #6)
    await query(`UPDATE companies SET campaign_holdout_pct = NULL WHERE id = $1::uuid`, [co]);
    await stage(co, staging, [held[1], held[1]]);
    const off = await gateStaging(await loadAdGatePolicy(co), { branch: 'direct', stagingId: staging, unsubUserId: user, mode: 'dry' });
    expect(off.counts.campaign_holdout).toBe(1);
    expect(off.excludedRows).toBe(2);   // 같은 번호 두 행 = 미리보기(중복 제거 끔)가 빼는 행 수(구현 1R #7)
    const offCommit = await gateStaging(await loadAdGatePolicy(co), { branch: 'direct', stagingId: staging, unsubUserId: user, mode: 'commit' });
    expect(offCommit.counts.campaign_holdout).toBe(1);
    expect(await stagedPhones(staging)).not.toContain(held[1]);
  });

  it('기능을 안 켠 회사 = 옛 길(관문 · 원장 0) · 미가입 = 설정이 있어도 옛 길 · 켠 회사 = 관문 길 · marked 참(★ C113 D1 · D23)', async () => {
    const off = await newCompany();
    expect(await resolveAdGateMode(off)).toEqual({ mode: 'legacy' });
    const offOut = await gatePhones(await loadAdGatePolicy(off), { branch: 'ai', batchId: randomUUID(), holdoutKey: 'k-off', reserve: true }, [phoneOf(), phoneOf()]);
    expect(offOut.marked).toBe(false);   // 관문을 불러도(입구는 안 부른다) 꺼진 정책 = 원장 0
    const st = randomUUID();
    await stage(off, st, [phoneOf()]);
    expect((await gateStaging(await loadAdGatePolicy(off), { branch: 'dm', stagingId: st, unsubUserId: randomUUID(), mode: 'commit' })).marked).toBe(false);
    const free = await newCompany(false);
    await query(`UPDATE companies SET global_holdout_pct = 10, global_holdout_since = NOW(), send_priority_order = $2::text[] WHERE id = $1::uuid`, [free, [...AD_BRANCHES]]);
    expect(await resolveAdGateMode(free)).toEqual({ mode: 'legacy' });
    expect((await loadAdGatePolicy(free)).ready).toBe(false);
    const on = await newCompany();
    await query(`UPDATE companies SET send_priority_order = $2::text[] WHERE id = $1::uuid`, [on, [...AD_BRANCHES]]);
    const mode = await resolveAdGateMode(on);
    expect(mode.mode).toBe('gate');
    expect((await gatePhones(await loadAdGatePolicy(on), { branch: 'ai', batchId: randomUUID(), reserve: true }, [phoneOf()])).marked).toBe(true);
  });

  it('load 로 원장을 남긴 뒤 commit 판정이 장애 = 새 기능 없이 통과여도 marked 참(앞 시도 원장을 잇는다 · 구현 7R)', async () => {
    const co = await newCompany();
    await query(`UPDATE companies SET campaign_holdout_pct = 20 WHERE id = $1::uuid`, [co]);
    const staging = randomUUID();
    await stage(co, staging, Array.from({ length: 200 }, phoneOf));
    const policy = await loadAdGatePolicy(co);
    await gateStaging(policy, { branch: 'ai', stagingId: staging, unsubUserId: randomUUID(), mode: 'load' });
    expect((await marks(staging)).length).toBeGreaterThan(0);
    // 판정 문장을 깨뜨린다(우선순위 켬 = 통과 번호 예약 INSERT · 예약 줄만 막는 임시 제약) → 롤백 → 장애 줄(다른 표) → 새 기능 없이 통과
    await query(`ALTER TABLE ad_send_marks ADD CONSTRAINT c110_t_no_reserved CHECK (kind <> 'reserved') NOT VALID`);
    try {
      const broken = await gateStaging({ ...policy, priority: [...AD_BRANCHES] }, { branch: 'ai', stagingId: staging, unsubUserId: randomUUID(), mode: 'commit' });
      expect(broken.degraded).toBe(true);
      expect(broken.marked).toBe(true);
    } finally {
      await query(`ALTER TABLE ad_send_marks DROP CONSTRAINT c110_t_no_reserved`);
    }
  });

  it('잇기 실패 = 던지지 않음(발송 계속) · 장애 줄(link) 한 줄(★ 1107 Harold)', async () => {
    const co = await newCompany();
    await query(`ALTER TABLE ad_send_marks RENAME TO ad_send_marks_off2`);
    try {
      await expect(linkAdMarksSafe(co, randomUUID(), randomUUID())).resolves.toBeUndefined();
    } finally {
      await query(`ALTER TABLE ad_send_marks_off2 RENAME TO ad_send_marks`);
    }
    const r = await query(`SELECT branch FROM ad_gate_failures WHERE company_id = $1::uuid`, [co]);
    expect(r.rows.map((x: any) => x.branch)).toEqual(['link']);
  });

  it('D11 — 기대 대조군 30명 미만이면 뽑지 않는다(원장 0 · 전원 남음)', async () => {
    const co = await newCompany();
    await query(`UPDATE companies SET campaign_holdout_pct = 20 WHERE id = $1::uuid`, [co]);
    const staging = randomUUID();
    await stage(co, staging, Array.from({ length: 100 }, phoneOf));
    const out = await gateStaging(await loadAdGatePolicy(co), { branch: 'dm', stagingId: staging, unsubUserId: randomUUID(), mode: 'commit' });
    expect(out.counts.campaign_holdout).toBe(0);
    expect(await marks(staging)).toEqual([]);
    expect((await stagedPhones(staging)).length).toBe(100);
  });

  it('우선순위 — 높은 갈래가 먼저 = 낮은 갈래 빠짐 · 낮은 것이 먼저 = 둘 다 · 2시간 넘은 미확정 = 안 막음 · 확정 = 오래돼도 막음', async () => {
    const co = await newCompany();
    await query(`UPDATE companies SET send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);
    const policy = await loadAdGatePolicy(co);
    expect(policy.priority).toEqual([...AD_BRANCHES]);
    const [x, y, z, w] = [phoneOf(), phoneOf(), phoneOf(), phoneOf()];
    const j1 = randomUUID();
    expect((await gatePhones(policy, { branch: 'journey', batchId: j1, reserve: true }, [x, z, w])).counts.priority).toBe(0);
    expect((await gatePhones(policy, { branch: 'ai', batchId: randomUUID(), reserve: true }, [x])).excluded.get(x)).toBe('priority');
    // 낮은 것이 먼저
    expect((await gatePhones(policy, { branch: 'direct', batchId: randomUUID(), reserve: true }, [y])).counts.priority).toBe(0);
    expect((await gatePhones(policy, { branch: 'journey', batchId: randomUUID(), reserve: true }, [y])).counts.priority).toBe(0);
    // 미확정 2시간 1분 = 죽음 · 확정(이어진 캠페인 행 있음)은 오래돼도 산다 · 이어진 캠페인 행이 없으면(롤백) 확정 아님
    await query(`UPDATE ad_send_marks SET created_at = NOW() - INTERVAL '2 hours 1 minute' WHERE batch_id = $1::uuid AND phone = $2`, [j1, z]);
    expect((await gatePhones(policy, { branch: 'dm', batchId: randomUUID(), reserve: false }, [z])).counts.priority).toBe(0);
    const liveCamp = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { id: liveCamp, company_id: co, status: 'completed' });
    await query(`UPDATE ad_send_marks SET created_at = NOW() - INTERVAL '5 hours', campaign_id = $3::uuid WHERE batch_id = $1::uuid AND phone = $2`, [j1, w, liveCamp]);
    expect((await gatePhones(policy, { branch: 'dm', batchId: randomUUID(), reserve: false }, [w])).excluded.get(w)).toBe('priority');
    await query(`UPDATE ad_send_marks SET campaign_id = $3::uuid WHERE batch_id = $1::uuid AND phone = $2`, [j1, w, randomUUID()]);
    expect((await gatePhones(policy, { branch: 'dm', batchId: randomUUID(), reserve: false }, [w])).counts.priority).toBe(0);
    // 1시간 59분 미확정 = 아직 산다
    await query(`UPDATE ad_send_marks SET created_at = NOW() - INTERVAL '1 hour 59 minutes', campaign_id = NULL WHERE batch_id = $1::uuid AND phone = $2`, [j1, w]);
    expect((await gatePhones(policy, { branch: 'dm', batchId: randomUUID(), reserve: false }, [w])).excluded.get(w)).toBe('priority');
  });

  it('직접 발송 배관 span = 분할 첫 차수 ~ 마지막 차수의 날 · 분할 없음 = 예약일 하루(구현 1R #5)', () => {
    const at = new Date(Date.now() + 3 * 86400000);
    at.setUTCHours(1, 0, 0, 0);   // KST 10:00
    const one = directSendSpanOf({ scheduled: true, scheduledAt: at.toISOString() }, 5000);
    expect(one.from).toBe(one.to);
    const split = directSendSpanOf({ scheduled: true, scheduledAt: at.toISOString(), splitEnabled: true, splitCount: 1, splitIntervalMinutes: 60 }, 30);
    expect(split.to > split.from).toBe(true);   // 한 시간에 1건 · 30건 = 다음 날로 넘어간다
  });

  it('우선순위 — 여러 날 span = 날마다 예약 · 둘째 날 단일 발송도 막힘', async () => {
    const co = await newCompany();
    await query(`UPDATE companies SET send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);
    const policy = await loadAdGatePolicy(co);
    const p = phoneOf();
    const d0 = kstToday();
    const d1 = new Date(Date.parse(`${d0}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    await gatePhones(policy, { branch: 'planner', batchId: randomUUID(), reserve: true, span: { from: d0, to: d1 } }, [p]);
    expect((await gatePhones(policy, { branch: 'ai', batchId: randomUUID(), reserve: false, span: { from: d1, to: d1 } }, [p])).excluded.get(p)).toBe('priority');
  });

  it('예약 날 = 통과 인원으로 다시 계산한 span(판정은 넓은 span · 구현 2R #5)', async () => {
    const co = await newCompany();
    await query(`UPDATE companies SET send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);
    const policy = await loadAdGatePolicy(co);
    const p = phoneOf();
    const d0 = kstToday();
    const d1 = new Date(Date.parse(`${d0}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const batch = randomUUID();
    await gatePhones(policy, { branch: 'planner', batchId: batch, reserve: true, span: { from: d0, to: d1 }, spanForCount: () => ({ from: d0, to: d0 }) }, [p]);
    const r = await query(`SELECT send_day::text AS d FROM ad_send_marks WHERE batch_id = $1::uuid AND kind = 'reserved'`, [batch]);
    expect(r.rows.map((x: any) => x.d)).toEqual([d0]);
  });

  it('예약 날 계산 수 = 실제 적재 수(중복 제거 끔 = 같은 번호 여러 행 · 구현 3R)', async () => {
    const co = await newCompany();
    await query(`UPDATE companies SET send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);
    const policy = await loadAdGatePolicy(co);
    const p = phoneOf();
    const staging = randomUUID();
    await stage(co, staging, Array.from({ length: 30 }, () => p));
    const seen: number[] = [];
    await gateStaging(policy, {
      branch: 'direct', stagingId: staging, unsubUserId: randomUUID(), mode: 'commit', countRows: true,
      spanForCount: (n) => { seen.push(n); return { from: kstToday(), to: kstToday() }; },
    });
    expect(seen).toEqual([30]);
    const seen2: number[] = [];
    const staging2 = randomUUID();
    await stage(co, staging2, Array.from({ length: 30 }, () => phoneOf()).concat([p, p]));
    await gateStaging(policy, {
      branch: 'direct', stagingId: staging2, unsubUserId: randomUUID(), mode: 'commit',
      spanForCount: (n) => { seen2.push(n); return { from: kstToday(), to: kstToday() }; },
    });
    expect(seen2).toEqual([31]);   // 중복 제거 켬 = 번호 수
  });

  it('중화(failed) 캠페인에 이어진 줄은 재시도 캠페인으로 다시 잇는다(측정 · ★ C113 D11 ④ 예약 줄도 · 구현 2R #3)', async () => {
    const co = await newCompany();
    await query(`UPDATE companies SET campaign_holdout_pct = 20, send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);
    const staging = randomUUID();
    await stage(co, staging, Array.from({ length: 200 }, phoneOf));
    await gateStaging(await loadAdGatePolicy(co), { branch: 'direct', stagingId: staging, unsubUserId: randomUUID(), mode: 'commit' });
    const failed = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { id: failed, company_id: co, status: 'failed', send_phase: 'failed' });
    await linkAdMarks(co, staging, failed);
    const retry = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { id: retry, company_id: co, status: 'sending' });
    await linkAdMarks(co, staging, retry);
    const m = await marks(staging);
    expect(m.filter((x: any) => x.kind !== 'reserved').every((x: any) => x.campaign_id === retry)).toBe(true);
    expect(m.filter((x: any) => x.kind === 'reserved').length).toBeGreaterThan(0);
    expect(m.filter((x: any) => x.kind === 'reserved').every((x: any) => x.campaign_id === retry)).toBe(true);   // ★ C113 D11 ④ — 재시도가 넘겨받음
  });

  it('첫 배정 조회 실패 = 관문 길(모름 · 배정 없음으로 넘기지 않는다) → 판정도 실패 = 장애 줄 + 새 기능 없이 통과(★ C113 D23 · 구현 2R #6)', async () => {
    const co = await newCompany();
    const policy = await loadAdGatePolicy(co);   // 새 판정 전부 꺼짐
    const batch = randomUUID();
    await query(`ALTER TABLE ad_send_marks RENAME TO ad_send_marks_off`);
    try {
      const mode = await resolveAdGateMode(co, { batchId: batch, priorArmsPossible: true });
      expect(mode.mode).toBe('gate');
      const out = await gatePhones(policy, { branch: 'ai', batchId: batch, holdoutKey: 'k', reserve: true }, [phoneOf()]);
      expect(out.degraded).toBe(true);
      expect(out.excluded.size).toBe(0);
    } finally {
      await query(`ALTER TABLE ad_send_marks_off RENAME TO ad_send_marks`);
    }
    expect((await query(`SELECT COUNT(*)::int AS n FROM ad_gate_failures WHERE company_id = $1::uuid`, [co])).rows[0].n).toBe(1);
  });

  it('동시 두 판정 — 높은 갈래는 어떤 순서에서도 빠지지 않는다 · 낮은 것이 빠지면 높은 예약이 먼저 있다', async () => {
    const co = await newCompany();
    await query(`UPDATE companies SET send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);
    const policy = await loadAdGatePolicy(co);
    for (let i = 0; i < 5; i++) {
      const p = phoneOf();
      const [hi, lo] = await Promise.all([
        gatePhones(policy, { branch: 'journey', batchId: randomUUID(), reserve: true }, [p]),
        gatePhones(policy, { branch: 'direct', batchId: randomUUID(), reserve: true }, [p]),
      ]);
      expect(hi.excluded.size).toBe(0);
      if (lo.excluded.size === 1) {
        const r = await query(`SELECT branch FROM ad_send_marks WHERE company_id = $1::uuid AND phone = $2 AND kind = 'reserved' ORDER BY id`, [co, p]);
        expect(r.rows.map((x: any) => x.branch)).toEqual(['journey']);
      }
    }
  });

  it('전체 대조군 · 면제 번호도 대조군은 건다 · 우선순위는 면제', async () => {
    const co = await newCompany();
    await query(`UPDATE companies SET global_holdout_pct = 10, global_holdout_since = NOW(), send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);
    const policy = await loadAdGatePolicy(co);
    const phones = Array.from({ length: 300 }, phoneOf);
    await gatePhones(policy, { branch: 'journey', batchId: randomUUID(), reserve: true }, phones);
    const out = await gatePhones(policy, { branch: 'direct', batchId: randomUUID(), reserve: false }, phones, phones);
    const reasons = new Set(out.excluded.values());
    expect(reasons.has('priority')).toBe(false);   // 전원 면제
    expect(out.counts.global_holdout).toBeGreaterThan(10);
    expect(out.counts.global_holdout).toBeLessThan(60);
  });

  it('판정 실패 = 장애 줄 + 새 기능 없이 통과 · 장애 줄도 못 쓰면 던진다', async () => {
    const co = await newCompany();
    await query(`UPDATE companies SET global_holdout_pct = 5, global_holdout_since = NOW(), send_priority_order = $2::text[] WHERE id = $1::uuid`, [co, [...AD_BRANCHES]]);   // 예약 줄을 쓰게 해 잘못된 묶음 id 에서 실패
    const policy = await loadAdGatePolicy(co);
    const out = await gatePhones(policy, { branch: 'ai', batchId: 'not-a-uuid', reserve: true }, [phoneOf()]);
    expect(out.degraded).toBe(true);
    expect((await query(`SELECT COUNT(*)::int AS n FROM ad_gate_failures WHERE company_id = $1::uuid`, [co])).rows[0].n).toBe(1);
    await query(`ALTER TABLE ad_gate_failures RENAME TO ad_gate_failures_off`);
    try {
      await expect(gatePhones(policy, { branch: 'ai', batchId: 'not-a-uuid', reserve: true }, [phoneOf()])).rejects.toBeInstanceOf(AdGateUnavailableError);
    } finally {
      await query(`ALTER TABLE ad_gate_failures_off RENAME TO ad_gate_failures`);
    }
  });

  it('측정 — 발송별 ITT(원장 treated vs holdout) · 7일 창 · 같은 번호 한 명', async () => {
    const co = await newCompany();
    const camp = randomUUID();
    const sentAt = new Date(Date.now() - 9 * 86400000);
    await insertMinimalRow(pool, 'campaigns', { id: camp, company_id: co, status: 'completed', sent_at: sentAt, campaign_name: 'C110 시험' });
    const t = Array.from({ length: 40 }, phoneOf);
    const c = Array.from({ length: 40 }, phoneOf);
    for (const p of [...t, ...c]) await addCustomer(co, p);
    const batch = randomUUID();
    await query(
      `INSERT INTO ad_send_marks (company_id, batch_id, campaign_id, branch, kind, phone, send_day)
       SELECT $1::uuid, $2::uuid, $3::uuid, 'direct', k, p, CURRENT_DATE FROM unnest($4::text[], $5::text[]) AS u(p, k)`,
      [co, batch, camp, [...t, ...c], [...t.map(() => 'campaign_treated'), ...c.map(() => 'campaign_holdout')]],
    );
    await paidOrder(co, t[0], 'E-1', 10000, new Date(sentAt.getTime() + 86400000));
    await paidOrder(co, t[0], 'E-2', 5000, new Date(sentAt.getTime() + 2 * 86400000));
    await paidOrder(co, t[1], 'E-3', 7000, new Date(sentAt.getTime() + 8 * 86400000));   // 창 밖
    await paidOrder(co, c[0], 'E-4', 3000, new Date(sentAt.getTime() + 3600000));
    const res = await campaignEffects(co, 30);
    expect(res.items).toHaveLength(1);
    const L = res.items[0].lift;
    expect(L.treated).toMatchObject({ n: 40, buyers: 1, revenue: 15000 });
    expect(L.control).toMatchObject({ n: 40, buyers: 1, revenue: 3000 });
    expect(L.sentence.length).toBeGreaterThan(5);
  });

  it('measureGroups = campaignRecipientOrders 와 같은 주문(몰 결제 · 같은 주문 한 번)', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await addCustomer(co, p);
    const at = new Date(Date.now() - 3 * 86400000);
    await paidOrder(co, p, 'M-1', 20000, new Date(at.getTime() + 3600000));
    const g = await measureGroups(co, [{ phone: p, at, group: 't' }, { phone: p, at, group: 'c' }], 7);
    expect(g.t).toMatchObject({ n: 1, buyers: 1, revenue: 20000 });
    expect(g.c.n).toBe(0);
  });

  it('여정 대조군 비교 — 고객 단위(재진입 = 한 명) · 첫 진입 7일 · 창 안 닫힌 고객 = 측정 중', async () => {
    const co = await newCompany();
    const jr = randomUUID();
    await insertMinimalRow(pool, 'journeys', { id: jr, company_id: co, name: 'C110 시험 여정', trigger_event: 'customer.created' });
    const old = new Date(Date.now() - 10 * 86400000);
    const ex = async (cust: string, status: string, at: Date) =>
      insertMinimalRow(pool, 'journey_executions', { id: randomUUID(), journey_id: jr, customer_id: cust, status, entered_at: at });
    const pa = phoneOf(); const pb = phoneOf(); const pc = phoneOf();
    const a = await addCustomer(co, pa); const b = await addCustomer(co, pb); const c = await addCustomer(co, pc);
    await ex(a, 'completed', old);
    await ex(a, 'active', new Date(Date.now() - 9 * 86400000));   // 재진입
    await ex(b, 'holdout', old);
    await ex(c, 'active', new Date(Date.now() - 2 * 86400000));   // 측정 중
    await paidOrder(co, pa, 'J-1', 9000, new Date(old.getTime() + 86400000));
    await paidOrder(co, pb, 'J-2', 4000, new Date(old.getTime() + 8 * 86400000));   // 8일째 = 창 밖
    const r = await journeyHoldoutEffect(jr);
    expect(r).not.toBeNull();
    expect(r!.lift.treated).toMatchObject({ n: 1, buyers: 1, revenue: 9000 });
    expect(r!.lift.control).toMatchObject({ n: 1, buyers: 0 });
    expect(r!.measuring).toBe(1);
  });
});
