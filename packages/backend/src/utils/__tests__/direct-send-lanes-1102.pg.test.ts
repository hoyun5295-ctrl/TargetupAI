// replaces: none
/**
 * 대량 직접발송 워커 = 회사별 줄 · 회사 단위 순환 · 시간 몫 양보 · 정확한 재개 — 실 PostgreSQL(★ 2026-11-02 설계서 docs/2026-11-01-journey-automarketing-engine-design.md §16 G6 · 16-9)
 *
 * 운영 문장(선점 · 고르기 · 진행 기록 · 내려놓기 · 끊김 복구 · 종결)을 글자 그대로 돌린다. 바깥만 시험이 쥔다:
 *   MySQL 적재(processSendChunk = 받은 번호를 센다) · MySQL 실측(countCampaignRows = 시험 장부) · 환불 · 취소 정산 · 경보 · 필드 매핑.
 * 청크 크기 · 몫 길이는 시험 손잡이로 줄인다(__directSendTest.tune · 운영 값 = 1만 · 2분).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({
  /** 캠페인 → 적재한 번호(정확히 1번 판정) */
  loaded: new Map<string, string[]>(),
  /** 적재 순서(회사 · 캠페인) */
  order: [] as Array<{ campaignId: string; at: number }>,
  delayMs: 0,
  /** 이 캠페인 적재 때 끼울 일(종료 신호 흉내 등) */
  onLoad: null as null | ((campaignId: string) => void),
  refunds: [] as Array<{ campaignId: string; count: number }>,
  alerts: [] as string[],
  /** MySQL 실측을 바꿔 치는 값(청크 중 멈춤 판정 시험) */
  measuredOverride: new Map<string, number>(),
  /** 고정 회신번호 재판정 결과(null = 통과) */
  callbackReject: null as string | null,
}));

vi.mock('../direct-send-processor', () => ({
  processSendChunk: async (p: any) => {
    if (ctl.delayMs) await new Promise((r) => setTimeout(r, ctl.delayMs));
    const list = ctl.loaded.get(p.campaignId) || [];
    for (const r of p.recipients) list.push(String(r.phone));
    ctl.loaded.set(p.campaignId, list);
    ctl.order.push({ campaignId: p.campaignId, at: Date.now() });
    ctl.onLoad?.(p.campaignId);
    return { sentCount: p.recipients.length, brandSentCount: 0 };
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
  countCampaignRows: async (_co: string, _u: string, campaignId: string) =>
    ctl.measuredOverride.get(campaignId) ?? (ctl.loaded.get(campaignId) || []).length,
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
import { runDirectSendOnce, __directSendTest, DIRECT_SEND_LANES } from '../direct-send-worker';

const OWNER: Record<string, string> = {};
async function company(tag: string): Promise<string> {
  const id = randomUUID();
  const u = randomUUID();
  await insertMinimalRow(pool, 'companies', { id, company_name: `줄 시험 ${tag}` });
  await insertMinimalRow(pool, 'users', { id: u, company_id: id, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: `t-1102-lane-${tag}-${id.slice(0, 6)}` });
  OWNER[id] = u;
  return id;
}

/** 캠페인 하나 = staging n 행 + queued(또는 주어진 상태) */
async function campaign(companyId: string, n: number, o: { phase?: string; processed?: number; config?: Record<string, unknown>; createdAgo?: string } = {}): Promise<string> {
  const id = randomUUID();
  const sid = randomUUID();
  await pool.query(
    `INSERT INTO campaign_send_staging (staging_id, company_id, phone, name)
     SELECT $1::uuid, $2::uuid, '0108' || lpad(g::text, 7, '0') || '', NULL FROM generate_series(1, $3::int) g`,
    [sid, companyId, n],
  );
  await insertMinimalRow(pool, 'campaigns', {
    id, company_id: companyId, created_by: OWNER[companyId], target_count: n, processed_count: o.processed ?? 0, staging_id: sid,
    send_phase: o.phase ?? 'queued', status: 'sending', message_type: 'SMS', campaign_name: '줄 시험',
    send_config: { sendChannel: 'sms', msgType: 'SMS', message: '줄 시험 안내', callback: '0212345678', sentTables: ['SMSQ_TEST'], ...(o.config || {}) },
  });
  if (o.createdAgo) await pool.query(`UPDATE campaigns SET created_at = NOW() - $2::interval WHERE id = $1`, [id, o.createdAgo]);
  return id;
}
const phase = async (id: string) => String((await pool.query(`SELECT send_phase FROM campaigns WHERE id = $1`, [id])).rows[0]?.send_phase);
const cfgOf = async (id: string) => (await pool.query(`SELECT send_config FROM campaigns WHERE id = $1`, [id])).rows[0]?.send_config || {};
const stagingPhones = async (id: string) => (await pool.query(
  `SELECT s.phone FROM campaign_send_staging s JOIN campaigns c ON c.staging_id = s.staging_id WHERE c.id = $1 ORDER BY s.id`, [id])).rows.map((r) => String(r.phone));
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
beforeAll(async () => {
  await pool.query(`DELETE FROM campaigns WHERE campaign_name = '줄 시험'`);
});

beforeEach(async () => {
  // 다른 시험이 남긴 후보가 줄을 차지하지 않게 = 이 파일의 캠페인만 후보로 둔다
  await pool.query(`UPDATE campaigns SET send_phase = 'sent' WHERE send_phase IN ('queued', 'processing')`);
  __directSendTest.reset();
  __directSendTest.tune({ chunk: 100, sliceMs: 60_000, smallMax: 60 });   // 작은 캠페인 = 남은 60 이하(시험 규모)
  Object.assign(ctl, { delayMs: 0, onLoad: null, order: [], refunds: [], alerts: [], callbackReject: null });
  ctl.loaded.clear();
  ctl.measuredOverride.clear();
});

describe('§16 G6 ① 줄 · 고르기(실 PG)', () => {
  it('작은 회사 캠페인은 큰 캠페인 적재 중에도 바로 줄을 받는다 · 둘 다 정확히 한 번', async () => {
    const A = await company('a'); const B = await company('b');
    const big = await campaign(A, 1000, { createdAgo: '5 minutes' });
    const small = await campaign(B, 50, { createdAgo: '1 minute' });
    ctl.delayMs = 15;
    await runDirectSendOnce();
    expect(__directSendTest.laneSnapshot().map(([id]) => id).sort()).toEqual([big, small].sort());
    await untilSent([big, small]);
    const firstBig = ctl.order.findIndex((o) => o.campaignId === big);
    const smallAt = ctl.order.findIndex((o) => o.campaignId === small);
    const lastBig = ctl.order.map((o) => o.campaignId).lastIndexOf(big);
    expect(firstBig).toBeGreaterThanOrEqual(0);
    expect(smallAt).toBeLessThan(lastBig);   // 큰 캠페인이 끝나기 전에 작은 캠페인이 나갔다
    expect((ctl.loaded.get(big) || []).length).toBe(1000);
    expect(new Set(ctl.loaded.get(big)).size).toBe(1000);
    expect((ctl.loaded.get(small) || []).length).toBe(50);
  });

  it('같은 회사 캠페인 둘은 동시에 넣지 않는다(한 회사 = 한 줄)', async () => {
    const A = await company('same');
    const c1 = await campaign(A, 300, { createdAgo: '3 minutes' });
    const c2 = await campaign(A, 300, { createdAgo: '2 minutes' });
    let both = false;
    ctl.delayMs = 5;
    ctl.onLoad = () => { const ids = __directSendTest.laneSnapshot().map(([id]) => id); if (ids.includes(c1) && ids.includes(c2)) both = true; };
    await untilSent([c1, c2]);
    expect(both).toBe(false);
    expect((ctl.loaded.get(c1) || []).length).toBe(300);
    expect((ctl.loaded.get(c2) || []).length).toBe(300);
  });
});

describe('§16 G6 ② 몫 양보 · 회사 단위 순환(실 PG)', () => {
  it('A · B 가 급한 시각이 앞이어도 C 가 A · B 의 두 번째 몫보다 먼저 몫을 받는다 · 정상 양보 여러 번 = 종결 0 · 정확히 한 번', async () => {
    const A = await company('ra'); const B = await company('rb'); const C = await company('rc');
    const a = await campaign(A, 500, { createdAgo: '30 minutes' });
    const b = await campaign(B, 500, { createdAgo: '20 minutes' });
    const c = await campaign(C, 500, { createdAgo: '1 minute' });
    __directSendTest.tune({ chunk: 100, sliceMs: 1, smallMax: 60 });   // 청크마다 몫 끝 = 다른 회사가 기다리면 내려놓는다
    ctl.delayMs = 5;
    await untilSent([a, b, c]);
    const seq = ctl.order.map((o) => o.campaignId);
    const nth = (id: string, k: number) => seq.reduce((acc, x, i) => (x === id && acc.n++ === k ? { n: acc.n, at: i } : acc), { n: 0, at: -1 }).at;
    expect(nth(c, 0)).toBeGreaterThanOrEqual(0);
    expect(nth(c, 0)).toBeLessThan(Math.max(nth(a, 1), nth(b, 1)));   // 2R · 1R #3 반례
    for (const id of [a, b, c]) {
      expect((ctl.loaded.get(id) || []).length).toBe(500);
      expect(new Set(ctl.loaded.get(id)).size).toBe(500);
      const cfg = await cfgOf(id);
      expect(cfg.loadResumeAttempts ?? 0).toBe(0);   // 정상 양보는 멈춤 복구 횟수를 세지 않는다(1R #2)
    }
    const sent = await pool.query(`SELECT id, sent_count FROM campaigns WHERE id = ANY($1::uuid[])`, [[a, b, c]]);
    for (const r of sent.rows) expect(Number(r.sent_count)).toBe(500);
  });

  it('A 가 내려놓은 뒤 다른 회사가 몫 안에 끝나는 큰 캠페인을 잇달아 넣어도 A 가 상한 안에 다시 몫을 받는다(2R #1 · 회사 열쇠)', async () => {
    const A = await company('sa'); const others = [await company('sb'), await company('sc'), await company('sd')];
    const a = await campaign(A, 600, { createdAgo: '40 minutes' });
    const coOf = new Map<string, string>();
    for (const co of others) coOf.set(await campaign(co, 100, { createdAgo: '30 minutes' }), co);
    __directSendTest.tune({ chunk: 100, sliceMs: 1, smallMax: 0 });   // 작은 줄 0 = 일반 줄 둘만(반례 그대로)
    ctl.delayMs = 3;
    let fed = 0;
    // 다른 회사 캠페인(청크 하나 = 몫 안에 끝남)이 적재되는 순간 그 회사 새 캠페인을 넣는다 = A 를 앞지를 새 후보가 늘 있다(2R 반례)
    ctl.onLoad = (cid) => {
      const co = coOf.get(cid);
      if (co && fed < 30) { fed++; void campaign(co, 100).then((id) => coOf.set(id, co)); }
    };
    const until = Date.now() + 40000;
    while (Date.now() < until && (await phase(a)) !== 'sent') {
      await runDirectSendOnce();
      await new Promise((r) => setTimeout(r, 5));
    }
    ctl.onLoad = null;
    expect(await phase(a)).toBe('sent');
    expect((ctl.loaded.get(a) || []).length).toBe(600);
    // A 가 몫을 놓은 뒤 다시 받기까지 다른 회사 청크 = 상한 안(캠페인 단위 순서면 새 캠페인이 잇달아 앞서 사이가 계속 벌어진다)
    const seq = ctl.order.map((o) => o.campaignId);
    const aAt = seq.map((x, i) => (x === a ? i : -1)).filter((i) => i >= 0);
    expect(aAt.length).toBe(6);
    const gaps = aAt.slice(1).map((v, k) => v - aAt[k] - 1);
    console.log(`[굶김 시험] A 사이 다른 청크 = ${gaps.join(',')} · 새 캠페인 ${fed}`);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(4);
    await __directSendTest.idle();
  });
});

describe('§16 G6 ③ 끊김 복구 다섯 갈래(실 PG)', () => {
  // campaigns 는 UPDATE 마다 updated_at = 지금(tr_campaigns_updated) → 「10분 전 멈춤」은 그 트리거를 이 문장 동안만 끄고 만든다(시험 그릇 DB)
  const stale = async (id: string, cfg: Record<string, unknown>, processed: number) => {
    await pool.query(`UPDATE campaigns SET send_phase = 'processing', processed_count = $2, send_config = send_config || $3::jsonb WHERE id = $1`, [id, processed, JSON.stringify(cfg)]);
    await pool.query(`ALTER TABLE campaigns DISABLE TRIGGER tr_campaigns_updated`);
    try { await pool.query(`UPDATE campaigns SET updated_at = NOW() - INTERVAL '11 minutes' WHERE id = $1`, [id]); }
    finally { await pool.query(`ALTER TABLE campaigns ENABLE TRIGGER tr_campaigns_updated`); }
  };

  it('경계에서 멈춤(진행 기록 있음 · 청크 중 표식 없음) = 이어 넣기 · 앞 행은 다시 넣지 않는다', async () => {
    const A = await company('b1');
    const id = await campaign(A, 300);
    const phones = await stagingPhones(id);
    ctl.loaded.set(id, phones.slice(0, 100));   // 죽기 전에 넣은 100
    await stale(id, { loadProgress: { sent: 100, brandSent: 0, chunkSkipped: 0, callbackExcluded: 0, unsubRemoved: 0, dupRemoved: 0 } }, 100);
    await untilSent([id]);
    expect((ctl.loaded.get(id) || []).length).toBe(300);
    expect(new Set(ctl.loaded.get(id)).size).toBe(300);
    expect(ctl.refunds.filter((r) => r.campaignId === id)).toEqual([]);   // 전부 나감 = 미적재 환불 0
  });

  it('청크 중에 멈춤 · 실측 = 진행 기록 = 이어 넣기 / 실측 ≠ 진행 기록 = 지금처럼 종결(재적재 0)', async () => {
    const A = await company('c1'); const B = await company('c2');
    const ok = await campaign(A, 200);
    const bad = await campaign(B, 200);
    const okPhones = await stagingPhones(ok);
    ctl.loaded.set(ok, okPhones.slice(0, 100));
    ctl.loaded.set(bad, (await stagingPhones(bad)).slice(0, 130));   // 청크 중 일부가 들어감
    const lp = { sent: 100, brandSent: 0, chunkSkipped: 0, callbackExcluded: 0, unsubRemoved: 0, dupRemoved: 0 };
    await stale(ok, { loadProgress: lp, loadChunk: { firstId: '0', rows: 100 } }, 100);
    await stale(bad, { loadProgress: lp, loadChunk: { firstId: '0', rows: 100 } }, 100);
    await untilSent([ok, bad]);
    expect((ctl.loaded.get(ok) || []).length).toBe(200);
    expect(new Set(ctl.loaded.get(ok)).size).toBe(200);
    expect((ctl.loaded.get(bad) || []).length).toBe(130);   // 다시 넣지 않았다
    expect(ctl.refunds.find((r) => r.campaignId === bad)?.count).toBe(70);   // 실측 130 → 70 환불
  });

  it('종결 진입 표식 = 정산만(1R #1) · 진행 기록 없음(옛 코드) = 지금처럼 종결 · 연속 복구 상한 = 종결', async () => {
    const A = await company('d1'); const B = await company('d2'); const C = await company('d3');
    const fin = await campaign(A, 300);
    const old = await campaign(B, 300);
    const cap = await campaign(C, 300);
    for (const id of [fin, old, cap]) ctl.loaded.set(id, (await stagingPhones(id)).slice(0, 100));
    const lp = { sent: 100, brandSent: 0, chunkSkipped: 0, callbackExcluded: 0, unsubRemoved: 0, dupRemoved: 0 };
    await stale(fin, { loadProgress: lp, loadFinalizing: new Date().toISOString() }, 100);
    await stale(old, {}, 100);
    await stale(cap, { loadProgress: lp, loadResumeAttempts: 3 }, 100);
    await untilSent([fin, old, cap]);
    for (const id of [fin, old, cap]) {
      expect((ctl.loaded.get(id) || []).length).toBe(100);
      expect(ctl.refunds.find((r) => r.campaignId === id)?.count).toBe(200);
    }
  });

  it('멈춤 복구로 이어 넣을 때만 횟수를 센다 · 청크 진행 기록이 성공하면 0', async () => {
    const A = await company('e1');
    const id = await campaign(A, 300);
    ctl.loaded.set(id, (await stagingPhones(id)).slice(0, 100));
    await stale(id, { loadProgress: { sent: 100, brandSent: 0, chunkSkipped: 0, callbackExcluded: 0, unsubRemoved: 0, dupRemoved: 0 } }, 100);
    await runDirectSendOnce();   // 줄 채우기(후보 0) → 정리 = 이어 넣기 대기(횟수 1)
    expect((await cfgOf(id)).loadResumeAttempts).toBe(1);
    expect((await cfgOf(id)).loadParkedAt).toBeTruthy();
    await untilSent([id]);
    expect((await cfgOf(id)).loadResumeAttempts ?? 0).toBe(0);
  });
});

describe('§16 G3 직접발송 대기 밀림 경보(실 PG)', () => {
  it('줄을 30분 넘게 못 받은 캠페인 = 한 통(회사 없음) · 줄을 받은 캠페인 · 먼 예약은 세지 않는다', async () => {
    const cos = [await company('l1'), await company('l2'), await company('l3'), await company('l4')];
    const ids: string[] = [];
    for (const co of cos) ids.push(await campaign(co, 300, { createdAgo: '40 minutes' }));
    const far = await campaign(await company('l5'), 300, { createdAgo: '40 minutes' });
    await pool.query(`UPDATE campaigns SET scheduled_at = NOW() + INTERVAL '3 days' WHERE id = $1`, [far]);
    ctl.delayMs = 40;
    await runDirectSendOnce();   // 일반 줄 둘만 받는다(큰 캠페인 = 작은 줄 못 씀) · 남은 둘 = 밀림
    expect(ctl.alerts.filter((k) => k === 'direct-send-queue-lag')).toHaveLength(1);
    await untilSent([...ids, far]);
  });
});

describe('§16 G6 ⑤ 취소 · 재시작 · 종료 신호(실 PG)', () => {
  it('내려놓은 캠페인을 취소하면 맨 먼저 집혀 적재 없이 종결된다(SC-28)', async () => {
    const A = await company('x1'); const B = await company('x2'); const C = await company('x3');
    const cancelled = await campaign(A, 300, { phase: 'processing', processed: 100, config: { loadParkedAt: new Date(Date.now() - 60_000).toISOString(), loadCancelled: true, loadProgress: { sent: 100, brandSent: 0 } } });
    const b = await campaign(B, 300, { createdAgo: '50 minutes' });
    const c = await campaign(C, 300, { createdAgo: '49 minutes' });
    ctl.delayMs = 20;
    await runDirectSendOnce();
    // 첫 회차에 집혀(취소 대표 = 맨 앞) 적재 없이 바로 종결 · 큰 캠페인 둘은 아직 적재 중
    const until = Date.now() + 3000;
    while ((await phase(cancelled)) !== 'sent' && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    expect(await phase(cancelled)).toBe('sent');
    expect([await phase(b), await phase(c)]).toContain('processing');
    await untilSent([cancelled, b, c]);
    expect(ctl.loaded.get(cancelled)).toBeUndefined();
  });

  it('재시작 = 회사 열쇠를 DB 에서 되살린다 · 방금 줄을 놓은 회사(종결 · 오류)의 새 캠페인보다 내려놓은 A 가 먼저(3R #1 · 4R #1)', async () => {
    const A = await company('k1'); const B = await company('k2'); const C = await company('k3'); const D = await company('k4');
    const a = await campaign(A, 300, { phase: 'processing', processed: 100, config: { loadParkedAt: new Date(Date.now() - 120_000).toISOString(), loadProgress: { sent: 100, brandSent: 0 } } });
    ctl.loaded.set(a, (await stagingPhones(a)).slice(0, 100));
    const bDone = await campaign(B, 10);
    await pool.query(`UPDATE campaigns SET send_phase = 'sent', sent_at = NOW() - INTERVAL '10 seconds' WHERE id = $1`, [bDone]);
    const cErr = await campaign(C, 300, { phase: 'processing', processed: 100, config: { loadProgress: { sent: 100, brandSent: 0 } } });
    await pool.query(`UPDATE campaigns SET updated_at = NOW() - INTERVAL '10 seconds' WHERE id = $1`, [cErr]);   // 오류로 줄을 놓음(10분 안 = 끊김 아님)
    const b2 = await campaign(B, 300, { createdAgo: '1 hour' });
    const c2 = await campaign(C, 300, { createdAgo: '1 hour' });
    const d2 = await campaign(D, 300, { createdAgo: '1 hour' });   // 후보 넷 > 줄 셋(일반 2 + 작은 1 · 300 = 큰 캠페인)
    __directSendTest.simulateRestart();
    ctl.delayMs = 30;
    await runDirectSendOnce();
    const picked = __directSendTest.laneSnapshot().map(([id]) => id);
    expect(picked).toContain(a);   // 열쇠 없으면 B2 · C2 · D2(빈 열쇠 = 맨 앞)가 일반 줄 둘을 먼저 차지했다
    expect(picked).toContain(d2);   // 한 번도 받지 않은 회사 = 맨 앞
    expect(picked.length).toBe(DIRECT_SEND_LANES);   // 큰 캠페인은 작은 줄을 못 쓴다
    await __directSendTest.idle();
    void b2; void c2;
  });

  it('이어 넣을 때 고정 회신번호가 거절되면 남은 몫만 멈춘다 · 앞 몫이 있으면 예약 = scheduled · 즉시 = completed · 적재 0 = failed(Codex 구현 1R #1)', async () => {
    const A = await company('cb1'); const B = await company('cb2'); const C = await company('cb3');
    const lp = { sent: 100, brandSent: 0, chunkSkipped: 0, callbackExcluded: 0, unsubRemoved: 0, dupRemoved: 0 };
    const parked = { loadParkedAt: new Date(Date.now() - 60_000).toISOString(), loadProgress: lp };
    const sched = await campaign(A, 300, { phase: 'processing', processed: 100, config: { ...parked, scheduled: true, scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString() } });
    const now = await campaign(B, 300, { phase: 'processing', processed: 100, config: parked });
    const fresh = await campaign(C, 300, { config: { scheduled: true, scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString() } });
    for (const id of [sched, now]) ctl.loaded.set(id, (await stagingPhones(id)).slice(0, 100));
    ctl.callbackReject = '회신번호 등록이 지워졌습니다';
    await untilSent([sched, now, fresh]);
    const st = async (id: string) => (await pool.query(`SELECT status, sent_count FROM campaigns WHERE id = $1`, [id])).rows[0];
    expect(await st(sched)).toEqual({ status: 'scheduled', sent_count: 100 });   // 앞 몫 100 = 큐에 있다 · 예약 취소로 지울 수 있다
    expect(await st(now)).toEqual({ status: 'completed', sent_count: 100 });
    expect(await st(fresh)).toEqual({ status: 'failed', sent_count: 0 });   // 적재 전 거절 = 종전 그대로(Codex E1)
    for (const id of [sched, now]) {
      expect((ctl.loaded.get(id) || []).length).toBe(100);   // 남은 몫은 넣지 않았다
      expect(ctl.refunds.find((r) => r.campaignId === id)?.count).toBe(200);
      expect(String((await cfgOf(id)).failure?.reason)).toContain('남은 200건은 적재하지 않고 환불');
    }
    expect(ctl.refunds.find((r) => r.campaignId === fresh)?.count).toBe(300);
  });

  it('종료 신호 = 다음 청크 경계에서 내려놓는다(남은 행 · 진행 기록 그대로)', async () => {
    const A = await company('z1');
    const id = await campaign(A, 500);
    ctl.delayMs = 5;
    ctl.onLoad = (cid) => { if (cid === id && (ctl.loaded.get(id) || []).length === 200) __directSendTest.stop(); };
    await runDirectSendOnce();
    await __directSendTest.idle();
    expect(await phase(id)).toBe('processing');
    const cfg = await cfgOf(id);
    expect(cfg.loadParkedAt).toBeTruthy();
    expect(cfg.loadChunk).toBeUndefined();
    expect(Number(cfg.loadProgress?.sent)).toBe(200);
    expect((ctl.loaded.get(id) || []).length).toBe(200);
  });
});
