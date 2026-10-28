/**
 * /api/cdp/plugin/member-token — 플러그인 키(몰 하나)로 그 몰 회원의 토큰만 (★ 2026-10-28 자사몰 대비 K8 · D9 · K4 검증 수정 10)
 *
 * 맞는 키 + 인정 호스트 + 숫자 회원 번호 = 고정 식별자 회원 번호의 토큰 · 그 밖(틀린 키 · 옛 판 · 밖 호스트 · 멈춘 회사) = 거절.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../config/database', () => ({ query: vi.fn(), mysqlQuery: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../middlewares/auth', () => ({ authenticate: (_req: any, _res: any, next: any) => next() }));
vi.mock('../utils/cdp-auth', () => ({
  requireCdpApiKey: (_req: any, _res: any, next: any) => next(),
  requireCdpBrowserOrigin: (_req: any, _res: any, next: any) => next(),
  requireCdpKeyOrBrowserOrigin: (_req: any, _res: any, next: any) => next(),
  recordCdpApiCall: vi.fn(async () => undefined),
  issueCdpKeyPair: vi.fn(),
  isCdpEnabledForPlan: vi.fn(async () => true),
  cdpFactCollectGate: vi.fn(async () => ({ allowed: true, collectUntil: null, inactiveSinceUnknown: false })),
}));

const COMPANY = '11111111-1111-4111-8111-111111111111';
const ROW = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-1028';
process.env.CDP_PLUGIN_KEY_SECRET = 'plugin-key-secret-for-route-tests-0123456789';

import express from 'express';
import { query } from '../config/database';
import { issuePluginKey } from '../utils/cdp-plugin-key';
import { verifyCdpMemberToken } from '../utils/cdp-member-token';
import cdpRouter from './cdp';

const q = query as unknown as ReturnType<typeof vi.fn>;
let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/cdp', cdpRouter);
  server = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cdp`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

let rowMeta: Record<string, any> = {};
let companyStatus = 'active';
beforeEach(() => {
  rowMeta = { woo_seen_hosts: ['lensgogo.com'] };
  companyStatus = 'active';
  q.mockReset();
  q.mockImplementation(async (sql: string, params: any[] = []) => {
    if (/FROM company_integrations WHERE id = \$1::uuid AND provider = 'woocommerce' AND status = 'active'/.test(sql)) {
      return params[0] === ROW
        ? { rows: [{ id: ROW, company_id: COMPANY, mall_id: 'lensgogo.co.kr', status: 'active', connected_at: null, last_synced_at: null, webhook_secret: null, meta: rowMeta }] }
        : { rows: [] };
    }
    if (/SELECT status FROM companies/.test(sql)) return { rows: [{ status: companyStatus }] };
    return { rows: [] };
  });
});

const post = async (body: any, key: string | null = issuePluginKey(ROW, 1)) => {
  const r = await fetch(`${base}/plugin/member-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Hanjullo-Plugin-Key': key } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};

describe('플러그인 회원 토큰', () => {
  it('맞는 키 · 증명 주소(도메인 이전) · 숫자 번호 = 고정 식별자 번호의 토큰', async () => {
    const r = await post({ host: 'lensgogo.com', user_id: '15' });
    expect(r.status).toBe(200);
    expect(r.body.external_id).toBe('lensgogo.co.kr:15');
    expect(verifyCdpMemberToken(r.body.member_token, COMPANY, 'lensgogo.co.kr:15')).toBe(true);
  });
  it('키 없음 · 틀린 키 · 새로 발급된 뒤의 옛 판 = 401', async () => {
    expect((await post({ host: 'lensgogo.co.kr', user_id: '15' }, null)).status).toBe(401);
    expect((await post({ host: 'lensgogo.co.kr', user_id: '15' }, `pk_v1.${ROW}.1.AAAA`)).status).toBe(401);
    rowMeta = { plugin_key_ver: 2 };
    expect((await post({ host: 'lensgogo.co.kr', user_id: '15' })).status).toBe(401);
  });
  it('인정 밖 호스트 · 숫자 아닌 번호 = 400(토큰 0)', async () => {
    const a = await post({ host: 'other-mall.example', user_id: '15' });
    const b = await post({ host: 'lensgogo.co.kr', user_id: 'admin' });
    expect([a.status, b.status]).toEqual([400, 400]);
    expect(a.body.member_token).toBeUndefined();
  });
  it('회사가 멈췄으면 403', async () => {
    companyStatus = 'suspended';
    expect((await post({ host: 'lensgogo.co.kr', user_id: '15' })).status).toBe(403);
  });
});
