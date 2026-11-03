// replaces: none
/**
 * 싱크 주소 그대로(routes/sync.ts 라우터 · 인증 · 세대 주소) — 에이전트 1.7.6 한 차례를 HTTP 로 끝까지(실 PG)
 * 설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md §3-2 ② · ⑤ · ⑧ · ⑩ · 기대값 = 설계서 문장을 손으로 따라간 값.
 * 번호 = 도달 불가 합성(0100009…) · 경보 = 기록만(발송 0).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID, randomBytes } from 'crypto';
import express from 'express';

const alerts = vi.hoisted(() => [] as any[]);
vi.mock('../system-alert', async (orig) => ({ ...(await orig<any>()), sendSystemAlert: vi.fn(async (p: any) => { alerts.push(p); return 1; }) }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { hashSecret } from '../secret-hash';
import syncRouter from '../../routes/sync';

const P = (n: number) => `0100009${String(n).padStart(4, '0')}`;
let server: Server;
let base = '';

async function company(withAgent: boolean) {
  const id = randomUUID();
  const key = `t_${randomBytes(8).toString('hex')}`;
  const secret = randomBytes(16).toString('hex');
  await insertMinimalRow(pool, 'companies', { id, company_name: '세대 주소 시험', name: '세대 주소 시험', status: 'active', use_db_sync: true, api_key: key, api_secret_hash: hashSecret(secret) });
  await insertMinimalRow(pool, 'users', { id: randomUUID(), company_id: id, user_type: 'admin', login_id: `r_${randomBytes(4).toString('hex')}` });
  const agentId = randomUUID();
  if (withAgent) await insertMinimalRow(pool, 'sync_agents', { id: agentId, company_id: id });
  const call = async (method: 'GET' | 'POST', path: string, body?: any) => {
    const r = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Sync-ApiKey': key, 'X-Sync-Secret': secret },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() as any };
  };
  return { id, agentId, call };
}
const consentOf = async (co: string, phone: string) =>
  (await pool.query(`SELECT sms_opt_in FROM customers WHERE company_id = $1 AND phone = $2`, [co, phone])).rows[0]?.sms_opt_in;
const syncUnsubs = async (co: string, phone: string) =>
  Number((await pool.query(`SELECT count(*) FROM unsubscribes WHERE company_id = $1 AND phone = $2 AND source = 'sync'`, [co, phone])).rows[0].count);

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C98-DDL-2'));
  await pool.query(ledgerBlockSql('C99-DDL-1'));   // 고객 업서트(C99 두 문)가 읽는 칸 · 배포 원장 대기 블록
  await pool.query(ledgerBlockSql('C99-DDL-2'));
  await pool.query(ledgerBlockSql('C101-DDL-1'));
  await pool.query(ledgerBlockSql('C101-DDL-2'));
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/sync', syncRouter);
  server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sync`;
}, 120_000);
afterAll(() => new Promise<void>((done) => server.close(() => done())));

describe('1.7.6 한 차례(HTTP · 실 PG)', () => {
  it('원장 → 적재(거부만 바로 · 신규는 대기) → 공개(거부 우선 · 빈칸 신규 = 기본 동의)', async () => {
    const { id, agentId, call } = await company(true);
    const start = await call('POST', '/consent-pass/start', { agentId });
    expect(start.status).toBe(200);
    const passId = start.body.data.passId;
    const ledger = [
      { phone: P(1), sms_opt_in: true }, { phone: P(1), sms_opt_in: false },
      { phone: P(2), sms_opt_in: true }, { phone: P(3), sms_opt_in: null },
    ];
    expect((await call('POST', '/consent-pass/stage', { agentId, passId, rows: ledger })).status).toBe(200);
    expect((await call('POST', '/consent-pass/stage-done', { agentId, passId })).status).toBe(200);
    const load = await call('POST', '/customers', {
      mode: 'full', agentId, consentPassId: passId, consentBatch: 0,
      customers: [
        { phone: P(1), name: '가', sms_opt_in: true }, { phone: P(1), name: '가2', sms_opt_in: false },
        { phone: P(2), name: '나', sms_opt_in: true }, { phone: P(3), name: '다' },
      ],
    });
    expect(load.status).toBe(200);
    // 적재 직후 = 거부만 바로 · 나머지 신규 = 대기(NULL · 기본값 0)
    expect(await consentOf(id, P(1))).toBe(false);
    expect(await consentOf(id, P(2))).toBeNull();
    expect(await consentOf(id, P(3))).toBeNull();
    let state = '';
    for (let n = 0; n < 10 && state !== 'done'; n++) state = (await call('POST', '/consent-pass/complete', { agentId, passId, sentBatches: 1 })).body.data.state;
    expect(state).toBe('done');
    expect(await consentOf(id, P(1))).toBe(false);
    expect(await syncUnsubs(id, P(1))).toBe(2);   // 사용자마다 한 줄 = 시스템 사용자 + 관리자 1(reconcileSyncUnsubscribes 와 같은 대상)
    expect(await consentOf(id, P(2))).toBe(true);
    expect(await consentOf(id, P(3))).toBe(true);
  });

  it('Codex 구현 1R #2 · 원장 = 수신 · 적재 때 거부로 바뀐 행이 에이전트 검증에서 떨어짐 = 따로 실은 근거로 거부 · 근거만 실은 요청(고객 행 0)도 센다', async () => {
    const { id, agentId, call } = await company(true);
    const [p, q] = [P(41), P(42)];
    await pool.query(`INSERT INTO customers (id, company_id, phone, name, sms_opt_in, is_active, created_at, updated_at)
                      VALUES (gen_random_uuid(), $1, $2, '근거', true, true, NOW(), NOW())`, [id, q]);
    const passId = (await call('POST', '/consent-pass/start', { agentId })).body.data.passId;
    await call('POST', '/consent-pass/stage', { agentId, passId, rows: [{ phone: p, sms_opt_in: true }, { phone: q, sms_opt_in: true }] });
    await call('POST', '/consent-pass/stage-done', { agentId, passId });
    const withEvidence = await call('POST', '/customers', {
      mode: 'full', agentId, consentPassId: passId, consentBatch: 0,
      customers: [{ phone: p, name: '사', sms_opt_in: true }],
      consentEvidence: [{ phone: p, sms_opt_in: false, sms_opt_in_unknown: null }],
    });
    expect(withEvidence.status).toBe(200);
    expect(await consentOf(id, p)).toBe(false);
    const evidenceOnly = await call('POST', '/customers', {
      mode: 'full', agentId, consentPassId: passId, consentBatch: 1, customers: [],
      consentEvidence: [{ phone: q, sms_opt_in: false, sms_opt_in_unknown: null }],
    });
    expect(evidenceOnly.status).toBe(200);
    expect(evidenceOnly.body.data.upsertedCount).toBe(0);
    let state = '';
    for (let n = 0; n < 10 && state !== 'done'; n++) state = (await call('POST', '/consent-pass/complete', { agentId, passId, sentBatches: 2 })).body.data.state;
    expect(state).toBe('done');
    expect(await consentOf(id, p)).toBe(false);
    expect(await consentOf(id, q)).toBe(false);
    expect(await syncUnsubs(id, q)).toBe(2);
  });

  it('적재 근거가 없는 패스로 complete(보낸 수 1 · 받은 수 0) = abandoned · 고객 행 그대로', async () => {
    const { agentId, call } = await company(true);
    const passId = (await call('POST', '/consent-pass/start', { agentId })).body.data.passId;
    await call('POST', '/consent-pass/stage-done', { agentId, passId });
    expect((await call('POST', '/consent-pass/complete', { agentId, passId, sentBatches: 1 })).body.data.state).toBe('abandoned');
  });

  it('세대가 생긴 회사의 옛 적재(패스 번호 없음) = 409 MIXED_AGENT · 고객 행 0 · 경보 한 통', async () => {
    const { id, agentId, call } = await company(true);
    await call('POST', '/consent-pass/start', { agentId });
    const old = await call('POST', '/customers', { mode: 'incremental', customers: [{ phone: P(11), name: '옛', sms_opt_in: true }] });
    expect(old.status).toBe(409);
    expect(old.body.code).toBe('MIXED_AGENT');
    expect(await consentOf(id, P(11))).toBeUndefined();
    await new Promise((r) => setTimeout(r, 50));
    expect(alerts.some((a) => a.companyId === id && String(a.dedupKey).startsWith('sync-consent-mixed:'))).toBe(true);
  });

  it('세대가 없는 회사의 옛 적재 = 지금 그대로(같은 번호 거부 우선 · 빈칸 신규 = 기본 동의)', async () => {
    const { id, call } = await company(false);
    const r = await call('POST', '/customers', { mode: 'incremental', customers: [
      { phone: P(21), name: '라', sms_opt_in: true }, { phone: P(21), name: '라2', sms_opt_in: false }, { phone: P(22), name: '마' },
    ] });
    expect(r.status).toBe(200);
    expect(await consentOf(id, P(21))).toBe(false);
    expect(await consentOf(id, P(22))).toBe(true);
  });

  it('세대 표시가 있는데 꼴이 틀리면 400(옛 요청으로 받지 않는다)', async () => {
    const { call } = await company(true);
    const r = await call('POST', '/customers', { mode: 'full', consentPassId: 'x', consentBatch: 0, customers: [{ phone: P(31), name: '바' }] });
    expect(r.status).toBe(400);
  });

  it('버전 확인 = 그 회사 지정 릴리스가 티어 릴리스보다 앞 · 다른 회사는 티어 릴리스', async () => {
    const a = await company(true);
    const b = await company(true);
    await pool.query(`DELETE FROM sync_releases`);
    await pool.query(`INSERT INTO sync_releases (version, is_active, tier, force_update) VALUES ('1.7.5', true, NULL, true)`);
    await pool.query(`INSERT INTO sync_releases (version, is_active, tier, force_update, company_id) VALUES ('1.7.6', true, NULL, true, $1)`, [a.id]);
    const va = await a.call('GET', `/version?current_version=1.7.5&agent_id=${a.agentId}`);
    const vb = await b.call('GET', `/version?current_version=1.7.5&agent_id=${b.agentId}`);
    expect([va.body.data.latestVersion, va.body.data.updateAvailable]).toEqual(['1.7.6', true]);
    expect([vb.body.data.latestVersion, vb.body.data.updateAvailable]).toEqual(['1.7.5', false]);
  });
});
