// replaces: none
/**
 * 직접발송 워커 묶음 = MySQL 트랜잭션 하나 + 커밋 기록 — 실 PostgreSQL(★ 2026-11-10 설계서 docs/2026-11-10-load-resume-design.md · Codex 설계 4R)
 *
 * 운영 문장(선점 · 고르기 · 진행 기록 · 보류 · 끊김 복구 · 다시 시작 확정 · 종결)을 글자 그대로 돌린다. 바깥만 시험이 쥔다:
 *   MySQL 트랜잭션 · 커밋 기록(queue-load-tx = 메모리 표 · 커밋 때만 기록과 번호가 보인다) · 적재(processSendChunk = 받은 번호를 트랜잭션에 쌓음) ·
 *   실측(countCampaignRows = 커밋된 번호 수) · 환불 · 경보 · 필드 매핑.
 * 판정 기준 = 번호마다 정확히 한 번(중복 0 · 빠짐 0) · 미적재 처리 수 = 접수 − 실제 적재.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({
  loaded: new Map<string, string[]>(),
  refunds: [] as Array<{ campaignId: string; count: number }>,
  alerts: [] as string[],
  callbackReject: null as string | null,
}));
const fx = vi.hoisted(() => ({
  ready: true,
  records: new Map<string, { rowsRead: number; smsLoaded: number; brandLoaded: number }>(),
  /** 커밋마다 하나씩 꺼낸다 · 비면 ok */
  commitMode: [] as Array<'ok' | 'appliedUnknown' | 'unappliedUnknown'>,
  /** 남은 수만큼 claim 이 잠금 대기 만료 */
  lockTimeout: 0,
  commits: 0,
}));

vi.mock('../queue-load-tx', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    queueTxReady: async () => fx.ready,
    openQueueTransaction: async () => {
      const t: any = { key: null, rec: null, phones: [] as Array<{ campaignId: string; phone: string }>, hooks: [] as Array<() => any>, done: false };
      t.run = async () => [];
      t.afterCommit = (fn: () => any) => { t.hooks.push(fn); };
      t.commit = async () => {
        t.done = true;
        fx.commits++;
        const mode = fx.commitMode.shift() || 'ok';
        if (mode !== 'unappliedUnknown') {
          if (t.key) fx.records.set(t.key, t.rec);
          for (const x of t.phones) { const l = ctl.loaded.get(x.campaignId) || []; l.push(x.phone); ctl.loaded.set(x.campaignId, l); }
        }
        if (mode !== 'ok') return 'unknown';
        for (const h of t.hooks) await h();
        return 'committed';
      };
      t.rollback = async () => { t.done = true; };
      return t;
    },
    claimLoadChunk: async (t: any, campaignId: string, firstId: string, rows: number) => {
      if (fx.lockTimeout > 0) { fx.lockTimeout--; throw new real.LoadChunkLockTimeout(); }
      const key = `${campaignId}|${firstId}`;
      const rec = fx.records.get(key);
      if (rec) throw new real.LoadChunkAlreadyCommitted({ ...rec });
      t.key = key;
      t.rec = { rowsRead: rows, smsLoaded: 0, brandLoaded: 0 };
    },
    sealLoadChunk: async (t: any, _c: string, _f: string, sms: number, brand: number) => { t.rec.smsLoaded = sms; t.rec.brandLoaded = brand; },
    deleteLoadChunks: async (campaignId: string) => { for (const k of [...fx.records.keys()]) if (k.startsWith(`${campaignId}|`)) fx.records.delete(k); },
  };
});
vi.mock('../direct-send-processor', () => ({
  processSendChunk: async (p: any) => {
    const phones = p.recipients.map((r: any) => String(r.phone));
    if (p.tx) for (const phone of phones) p.tx.phones.push({ campaignId: p.campaignId, phone });
    else { const l = ctl.loaded.get(p.campaignId) || []; l.push(...phones); ctl.loaded.set(p.campaignId, l); }
    return { sentCount: phones.length, brandSentCount: 0, failedCount: 0 };
  },
}));
vi.mock('../sms-queue', async (orig) => ({
  ...(await orig() as any),
  getCompanySmsTables: async () => ['SMSQ_TEST'],
  getCampaignQueueTables: async () => ['SMSQ_TEST'],
  recordCampaignSentTables: async () => undefined,
  smsExecAll: async () => 0,
  smsCountAll: async () => 0,
}));
vi.mock('../cancel-settle', async (orig) => ({
  ...(await orig() as any),
  countCampaignRows: async (_co: string, _u: string, campaignId: string) => (ctl.loaded.get(campaignId) || []).length,
  settleCancelledLoadRefund: async () => ({ ok: true }),
  settleCancelOutcome: async () => ({ ok: true }),
}));
vi.mock('../prepaid', async (orig) => ({
  ...(await orig() as any),
  prepaidRefund: async (_co: string, count: number, _t: string, campaignId: string) => { ctl.refunds.push({ campaignId, count }); return { ok: true, refunded: count }; },
}));
vi.mock('../system-alert', () => ({
  sendSystemAlert: async (p: any) => { ctl.alerts.push(String(p?.dedupKey)); return 1; },
  alertPassFailures: async () => undefined,
}));
vi.mock('../callback-filter', async (orig) => ({ ...(await orig() as any), fixedCallbackRejectReason: async () => ctl.callbackReject }));
vi.mock('../messageUtils', async (orig) => ({ ...(await orig() as any), prepareFieldMappings: async () => ({}), getOpt080Number: async () => '' }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { runDirectSendOnce, __directSendTest, LOAD_RESUME_MAX } from '../direct-send-worker';

const OWNER: Record<string, string> = {};
async function company(tag: string): Promise<string> {
  const id = randomUUID();
  const u = randomUUID();
  await insertMinimalRow(pool, 'companies', { id, company_name: `묶음 트랜잭션 시험 ${tag}` });
  await insertMinimalRow(pool, 'users', { id: u, company_id: id, user_type: 'admin', is_active: true, phone: '010-0000-1110', login_id: `t-1110-tx-${tag}-${id.slice(0, 6)}` });
  OWNER[id] = u;
  return id;
}
async function campaign(companyId: string, n: number): Promise<string> {
  const id = randomUUID();
  const sid = randomUUID();
  await pool.query(
    `INSERT INTO campaign_send_staging (staging_id, company_id, phone, name)
     SELECT $1::uuid, $2::uuid, '0109' || lpad(g::text, 7, '0'), NULL FROM generate_series(1, $3::int) g`,
    [sid, companyId, n],
  );
  await insertMinimalRow(pool, 'campaigns', {
    id, company_id: companyId, created_by: OWNER[companyId], target_count: n, processed_count: 0, staging_id: sid,
    send_phase: 'queued', status: 'sending', message_type: 'SMS', campaign_name: '묶음 트랜잭션 시험',
    send_config: { sendChannel: 'sms', msgType: 'SMS', message: '묶음 시험 안내', callback: '0212345678', sentTables: ['SMSQ_TEST'] },
  });
  return id;
}
const row = async (id: string) => (await pool.query(`SELECT send_phase, processed_count, send_config FROM campaigns WHERE id = $1`, [id])).rows[0];
/** 이 캠페인이 보류(processing · tx 묶음 표식 · 내려놓음 없음 · 줄 없음)가 될 때까지 회차를 돌린다 */
async function untilHeld(id: string, timeoutMs = 20000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    await runDirectSendOnce();
    await new Promise((r) => setTimeout(r, 20));
    const r = await row(id);
    const lanes = __directSendTest.laneSnapshot().map(([cid]) => cid);
    if (r.send_phase === 'processing' && r.send_config?.loadChunk?.tx === true && !r.send_config?.loadParkedAt && !lanes.includes(id)) return;
    if (Date.now() > until) throw new Error(`보류가 안 됨 · ${JSON.stringify(r)}`);
  }
}
/** 10분 넘게 멈춘 꼴(tr_campaigns_updated 를 이 문장 동안만 끈다 · 시험 그릇 DB) */
async function age(id: string): Promise<void> {
  await pool.query(`ALTER TABLE campaigns DISABLE TRIGGER tr_campaigns_updated`);
  try { await pool.query(`UPDATE campaigns SET updated_at = NOW() - INTERVAL '11 minutes' WHERE id = $1`, [id]); }
  finally { await pool.query(`ALTER TABLE campaigns ENABLE TRIGGER tr_campaigns_updated`); }
}
async function untilSent(ids: string[], timeoutMs = 30000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM campaigns WHERE id = ANY($1::uuid[]) AND send_phase = 'sent'`, [ids]);
    if (Number(r.rows[0].n) === ids.length) return;
    if (Date.now() > until) throw new Error(`시간 넘김 · 끝난 수 ${r.rows[0].n}/${ids.length}`);
    await runDirectSendOnce();
    await new Promise((res) => setTimeout(res, 20));
  }
}
const exactlyOnce = (id: string, n: number) => {
  const l = ctl.loaded.get(id) || [];
  expect(l.length).toBe(n);
  expect(new Set(l).size).toBe(n);
};

beforeAll(async () => {
  await pool.query(`DELETE FROM campaigns WHERE campaign_name = '묶음 트랜잭션 시험'`);
});
beforeEach(async () => {
  await pool.query(`UPDATE campaigns SET send_phase = 'sent' WHERE send_phase IN ('queued', 'processing')`);
  __directSendTest.reset();
  __directSendTest.tune({ chunk: 100, sliceMs: 60_000, smallMax: 60 });
  Object.assign(ctl, { refunds: [], alerts: [], callbackReject: null });
  ctl.loaded.clear();
  Object.assign(fx, { ready: true, commitMode: [], lockTimeout: 0, commits: 0 });
  fx.records.clear();
});

describe('묶음 = 트랜잭션 하나(실 PG)', () => {
  it('보통 흐름 = 묶음마다 커밋 1 · 번호마다 한 번 · 미적재 0 · 끝나면 그 캠페인 커밋 기록 지움', async () => {
    const id = await campaign(await company('ok'), 250);
    await untilSent([id]);
    exactlyOnce(id, 250);
    expect(fx.commits).toBe(3);
    expect(ctl.refunds.filter((r) => r.campaignId === id)).toEqual([]);
    expect([...fx.records.keys()].filter((k) => k.startsWith(id))).toEqual([]);
  });

  it('관문이 닫히면(커밋 기록 표 없음 = DDL 전) 옛 방식 그대로 · 트랜잭션 0', async () => {
    fx.ready = false;
    const id = await campaign(await company('old'), 250);
    await untilSent([id]);
    exactlyOnce(id, 250);
    expect(fx.commits).toBe(0);
    const r = await row(id);
    expect(r.send_config?.loadChunk).toBeUndefined();
  });
});

describe('커밋 결과 불명 = 보류 → 끊김 복구 → 다시 시작 맨 먼저 확정(실 PG)', () => {
  it('COMMIT 은 됐는데 응답이 끊김 = 보류(종결 · 정산 0) → 다시 시작 = 이미 커밋됨 → 기록 수로 이동 · 중복 0', async () => {
    const id = await campaign(await company('applied'), 250);
    fx.commitMode = ['ok', 'appliedUnknown'];
    await untilHeld(id);
    const held = await row(id);
    expect(held.processed_count).toBe(100);   // 진행 기록은 첫 묶음까지
    expect((ctl.loaded.get(id) || []).length).toBe(200);   // 큐에는 두 묶음이 커밋됨
    expect(ctl.refunds.filter((r) => r.campaignId === id)).toEqual([]);
    await age(id);
    await untilSent([id]);
    exactlyOnce(id, 250);
    expect(ctl.refunds.filter((r) => r.campaignId === id)).toEqual([]);
  });

  it('COMMIT 이 서버에 닿기 전에 끊김 = 보류 → 다시 시작 = 커밋 기록 INSERT 성공(되돌림 확정) → 같은 묶음을 다시 싣는다 · 빠짐 0', async () => {
    const id = await campaign(await company('unapplied'), 250);
    fx.commitMode = ['ok', 'unappliedUnknown'];
    await untilHeld(id);
    expect((ctl.loaded.get(id) || []).length).toBe(100);
    await age(id);
    await untilSent([id]);
    exactlyOnce(id, 250);
    expect(ctl.refunds.filter((r) => r.campaignId === id)).toEqual([]);
  });

  it('보류 뒤 다시 시작할 때 멈춤 조건(고정 회신번호 막힘)이어도 확정이 먼저 = 커밋된 묶음이 셈에 들어간다 · 미적재 처리 = 접수 − 실제(Codex 설계 3R)', async () => {
    const id = await campaign(await company('stop'), 250);
    fx.commitMode = ['ok', 'appliedUnknown'];
    await untilHeld(id);
    ctl.callbackReject = '회신번호 등록이 지워짐';
    await age(id);
    await untilSent([id]);
    exactlyOnce(id, 200);
    expect(ctl.refunds.filter((r) => r.campaignId === id).reduce((a, r) => a + r.count, 0)).toBe(50);   // 옛(확정 없이 멈춤) = 150
  });
});

describe('복구 횟수 상한 = 사람 확인 표식 · 고아 조회에서 빠짐(실 PG)', () => {
  it('앞 트랜잭션 대기가 계속 만료 = 종결 0 · 상한에서 사람 확인 표식 + 경보 · 남은 분량은 그대로 · 정산 0', async () => {
    const id = await campaign(await company('cap'), 250);
    fx.commitMode = ['ok', 'unappliedUnknown'];
    await untilHeld(id);
    fx.lockTimeout = 1000;
    for (let i = 0; i < LOAD_RESUME_MAX + 2; i++) {
      await age(id);
      for (let k = 0; k < 4; k++) { await runDirectSendOnce(); await new Promise((r) => setTimeout(r, 20)); }
      if ((await row(id)).send_config?.loadHoldManual) break;
    }
    const r = await row(id);
    expect(r.send_config?.loadHoldManual).toBeTruthy();
    expect(r.send_phase).toBe('processing');
    expect(ctl.alerts).toContain(`direct-load-hold-manual:${id}`);
    expect(ctl.refunds.filter((x) => x.campaignId === id)).toEqual([]);
    expect((ctl.loaded.get(id) || []).length).toBe(100);
  });

  it('사람 확인 표식 5건이 오래돼도 여섯째 끊긴 캠페인은 복구된다(고아 조회 5자리 독점 0)', async () => {
    const A = await company('mark');
    const marked: string[] = [];
    for (let i = 0; i < 5; i++) {
      const m = await campaign(A, 50);
      await pool.query(
        `UPDATE campaigns SET send_phase = 'processing', send_config = send_config || $2::jsonb WHERE id = $1`,
        [m, JSON.stringify({ loadHoldManual: { at: 'x', reason: '시험' }, loadProgress: { sent: 0, brandSent: 0, chunkSkipped: 0, callbackExcluded: 0, unsubRemoved: 0, dupRemoved: 0 } })],
      );
      await pool.query(`ALTER TABLE campaigns DISABLE TRIGGER tr_campaigns_updated`);
      try { await pool.query(`UPDATE campaigns SET updated_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [m]); }
      finally { await pool.query(`ALTER TABLE campaigns ENABLE TRIGGER tr_campaigns_updated`); }
      marked.push(m);
    }
    const B = await company('sixth');
    const sixth = await campaign(B, 300);
    const phones = (await pool.query(`SELECT s.phone FROM campaign_send_staging s JOIN campaigns c ON c.staging_id = s.staging_id WHERE c.id = $1 ORDER BY s.id`, [sixth])).rows.map((x: any) => String(x.phone));
    ctl.loaded.set(sixth, phones.slice(0, 100));
    await pool.query(
      `UPDATE campaigns SET send_phase = 'processing', processed_count = 100, send_config = send_config || $2::jsonb WHERE id = $1`,
      [sixth, JSON.stringify({ loadProgress: { sent: 100, brandSent: 0, chunkSkipped: 0, callbackExcluded: 0, unsubRemoved: 0, dupRemoved: 0 } })],
    );
    await age(sixth);
    await untilSent([sixth]);
    exactlyOnce(sixth, 300);
    for (const m of marked) expect((await row(m)).send_phase).toBe('processing');
  });
});
