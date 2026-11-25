// replaces: none
/**
 * 발신번호 → 비토엔진 허용 발신번호 거울(★ 2026-11-24 · B-1124-3 · 설계서 docs/2026-11-24-callback-bito-sync-design.md §4) — 판정(순수) · 입구 · 배선.
 *   저장 · 목록 SQL = bito-sender-sync-1124.pg.test.ts(실 PG).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  default: { connect: vi.fn() },
  pool: { connect: vi.fn() },
}));

import express from 'express';
import { isBitoAgentSendId, checkBitoSyncCaller, parseBitoSyncResults, bitoSyncStatusOf, BITO_SYNC_STALE_MS } from '../bito-sender-sync';
import bitoSyncRouter from '../../routes/bito-sync';
import { stripComments } from './helpers/producer-scan';

const BE = join(__dirname, '..', '..');
const src = (rel: string) => stripComments(readFileSync(join(BE, rel), 'utf8').replace(/\r\n/g, '\n'));
const GW = '58.227.193.65';
const TOKEN = 't'.repeat(40);
const CO = '11111111-2222-3333-4444-555555555555';

describe('판정', () => {
  it('V 판정 = /^V[0-9]+$/ 하나', () => {
    for (const v of ['V0001', 'V12', 'V0014']) expect(isBitoAgentSendId(v)).toBe(true);
    for (const v of ['B0015', 'C0006', 'D0002', '', 'v0001', 'V', 'V00a1', ' V0001', null, undefined, 1]) expect(isBitoAgentSendId(v)).toBe(false);
  });

  it('입구 = 토큰 ENV 없음 503 · 출발지 밖 403 · 토큰 없음 · 틀림 · 길이 다름 401 · 맞음 통과', () => {
    const env = { BITO_SENDER_SYNC_TOKEN: TOKEN, BITO_SENDER_SYNC_IPS: GW } as any;
    expect(checkBitoSyncCaller(TOKEN, GW, {} as any)).toEqual({ ok: false, status: 503 });
    expect(checkBitoSyncCaller(TOKEN, '58.227.193.66', env)).toEqual({ ok: false, status: 403 });
    expect(checkBitoSyncCaller(TOKEN, GW, { BITO_SENDER_SYNC_TOKEN: TOKEN } as any)).toEqual({ ok: false, status: 403 });   // 출발지 ENV 없음 = 아무도 못 들어옴
    for (const t of [undefined, '', 'x', TOKEN + 'x', TOKEN.slice(1) + 'u', ['a']]) expect(checkBitoSyncCaller(t, GW, env)).toEqual({ ok: false, status: 401 });
    expect(checkBitoSyncCaller(TOKEN, GW, env)).toEqual({ ok: true });
    expect(checkBitoSyncCaller(TOKEN, `::ffff:${GW}`, env)).toEqual({ ok: true });
  });

  it('결과 몸통 검사 = 꼴이 하나라도 틀리면 통째로 거절 · 앞날 회차 거절', () => {
    const one = { companyId: CO, phone: '0212345678', agentSendId: 'V0001', customerId: 16, outcome: 'registered', reason: null };
    const ok = parseBitoSyncResults({ roundAt: new Date().toISOString(), results: [one] });
    expect(ok?.results).toEqual([one]);
    expect(parseBitoSyncResults({ roundAt: new Date().toISOString(), results: [] })?.results).toEqual([]);   // 빈 회차도 받는다(회차 시각을 올린다)
    for (const bad of [
      { results: [one] },
      { roundAt: 'x', results: [one] },
      { roundAt: new Date(Date.now() + 10 * 60_000).toISOString(), results: [one] },
      { roundAt: new Date().toISOString() },
      { roundAt: new Date().toISOString(), results: [{ ...one, companyId: 'x' }] },
      { roundAt: new Date().toISOString(), results: [{ ...one, phone: '02-1234-5678' }] },
      { roundAt: new Date().toISOString(), results: [{ ...one, agentSendId: 'B0015' }] },
      { roundAt: new Date().toISOString(), results: [{ ...one, outcome: 'ok' }] },
      { roundAt: new Date().toISOString(), results: [{ ...one, customerId: 1.5 }] },
    ]) expect(parseBitoSyncResults(bad)).toBeNull();
  });

  it('번호 칸 = 이어진 V 결과만 · 빠짐 checking · 5분 지남 delayed · 가장 나쁜 결과 · 끊긴 V 의 옛 행은 쓰지 않음', () => {
    const now = new Date('2026-11-25T01:00:00Z');
    const fresh = new Date(now.getTime() - 60_000);
    const old = new Date(now.getTime() - BITO_SYNC_STALE_MS - 1000);
    const row = (v: string, outcome: string, at = fresh) => ({ agent_send_id: v, outcome, reason: null, round_at: at });
    expect(bitoSyncStatusOf([], ['V0001'], now).status).toBe('checking');
    expect(bitoSyncStatusOf([row('V0001', 'registered')], ['V0001', 'V0002'], now).status).toBe('checking');
    expect(bitoSyncStatusOf([row('V0001', 'registered', old)], ['V0001'], now).status).toBe('delayed');
    expect(bitoSyncStatusOf([row('V0001', 'registered')], ['V0001'], now).status).toBe('registered');
    expect(bitoSyncStatusOf([row('V0001', 'registered'), row('V0002', 'mapping_conflict')], ['V0001', 'V0002'], now).status).toBe('mapping_conflict');
    expect(bitoSyncStatusOf([row('V0001', 'manual_ok'), row('V0002', 'blocked_in_bito')], ['V0001', 'V0002'], now).status).toBe('blocked_in_bito');
    // 끊긴 V(V0009)의 옛 충돌 · 오래된 행 = 무시
    const v = bitoSyncStatusOf([row('V0001', 'registered'), row('V0009', 'mapping_conflict', old)], ['V0001'], now);
    expect(v.status).toBe('registered');
    expect(v.perV.map((p) => p.agentSendId)).toEqual(['V0001']);
    expect(v.checkedAt).toBe(fresh.toISOString());
  });
});

describe('입구(nginx 뒤 · 운영과 같은 trust proxy)', () => {
  let server: Server;
  let base = '';
  const saved = { t: process.env.BITO_SENDER_SYNC_TOKEN, i: process.env.BITO_SENDER_SYNC_IPS };
  beforeAll(async () => {
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(express.json());
    app.use('/api/bito-sync', bitoSyncRouter);
    server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bito-sync`;
    process.env.BITO_SENDER_SYNC_TOKEN = TOKEN;
    process.env.BITO_SENDER_SYNC_IPS = GW;
  });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));
  afterEach(() => {
    process.env.BITO_SENDER_SYNC_TOKEN = TOKEN;
    process.env.BITO_SENDER_SYNC_IPS = GW;
  });
  afterAll(() => {
    if (saved.t === undefined) delete process.env.BITO_SENDER_SYNC_TOKEN; else process.env.BITO_SENDER_SYNC_TOKEN = saved.t;
    if (saved.i === undefined) delete process.env.BITO_SENDER_SYNC_IPS; else process.env.BITO_SENDER_SYNC_IPS = saved.i;
  });
  const get = (xff: string, token = TOKEN) => fetch(`${base}/sender-numbers`, { headers: { 'x-forwarded-for': xff, 'x-bito-sync-token': token } });

  it('비토 출발지 + 토큰 = 200 · 꾸민 X-Forwarded-For(맨 오른쪽 = nginx 가 본 주소) = 403 · 토큰 틀림 = 401 · ENV 없음 = 503', async () => {
    expect((await get(GW)).status).toBe(200);
    expect((await get(`${GW}, 1.2.3.4`)).status).toBe(403);
    expect((await get(GW, 'x'.repeat(40))).status).toBe(401);
    delete process.env.BITO_SENDER_SYNC_TOKEN;
    expect((await get(GW)).status).toBe(503);
  });

  it('결과 POST = 몸통 틀림 400(저장 0)', async () => {
    const r = await fetch(`${base}/sender-numbers/results`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': GW, 'x-bito-sync-token': TOKEN },
      body: JSON.stringify({ roundAt: 'x', results: [] }),
    });
    expect(r.status).toBe(400);
  });
});

describe('배선(소스 계약)', () => {
  it('목록 번호 = 한줄로 회사 단위 판정 그대로(다시 만들지 않는다) · V 판정 한 곳', () => {
    const ct = src('utils/bito-sender-sync.ts');
    expect(ct).toContain('numbers: [...(await getRegisteredCallbackSet(companyId))].sort()');
    expect(ct).toContain('if (!isBitoAgentSendId(row.agent_send_id)) continue;');
    expect(ct).not.toMatch(/agent_send_id\s*(~|LIKE|ILIKE)/i);   // SQL 쪽 V 판정 사본 0
  });
  it('결과 저장 = 회차 한 행 UPDATE 조건(옛 회차 0행 = stale) · 지우기 0', () => {
    const ct = src('utils/bito-sender-sync.ts');
    expect(ct).toContain('UPDATE bito_sender_sync_round SET round_at = $1 WHERE id = 1 AND round_at < $1');
    expect(ct).not.toMatch(/DELETE FROM bito_sender_sync/);
  });
  it('관리 목록 = 비토 칸 조회 실패가 목록을 막지 않는다 · 앱 장착', () => {
    const admin = src('routes/admin.ts');
    expect(admin).toMatch(/loadBitoSyncViews\([\s\S]{0,200}\.catch\(/);
    expect(admin).toContain('...(bito.has(r.id) ? { bitoSync: bito.get(r.id) } : {})');
    expect(src('app.ts')).toContain("app.use('/api/bito-sync', bitoSyncRoutes);");
    const reg = src('routes/sender-registration.ts');
    expect(reg).toContain('bitoEngine: await isBitoCompany(result.registration?.company_id).catch(() => false)');
    expect(reg).toContain('registration: { ...registration, bitoEngine }');
  });
});
