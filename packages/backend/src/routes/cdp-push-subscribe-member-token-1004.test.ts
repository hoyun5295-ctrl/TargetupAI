/**
 * /api/cdp/push/subscribe — 브라우저 구독을 회원에 잇는 근거 = 회원 토큰 (2026-10-04 전수점검 C1 같은 뿌리)
 *
 * 옛: 공개키 + Origin 만으로 남의 회원 id 에 내 브라우저 구독을 붙여 그 고객에게 가는 푸시를 받아 볼 수 있었다.
 * 지금: 비밀키 서버 호출이거나 회원 토큰이 이 회사·이 회원과 맞을 때만 고객에 잇는다. 아니면 익명 구독(구독 자체는 받는다).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../config/database', () => ({ query: vi.fn(), mysqlQuery: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../middlewares/auth', () => ({ authenticate: (_req: any, _res: any, next: any) => next() }));
vi.mock('../utils/cdp-auth', () => ({
  requireCdpApiKey: (req: any, _res: any, next: any) => { req.cdpAuth = { companyId: COMPANY, companyName: 'x', source: 'sdk' }; next(); },
  requireCdpBrowserOrigin: (req: any, _res: any, next: any) => { req.cdpAuth = { companyId: COMPANY, companyName: 'x', source: 'sdk' }; next(); },
  requireCdpKeyOrBrowserOrigin: (req: any, _res: any, next: any) => { req.cdpAuth = { companyId: COMPANY, companyName: 'x', source: 'sdk' }; next(); },
  recordCdpApiCall: vi.fn(async () => undefined),
  issueCdpKeyPair: vi.fn(),
  isCdpEnabledForPlan: vi.fn(async () => true),
}));
vi.mock('../utils/web-push', () => ({
  getVapidPublicKey: () => 'k',
  saveSubscription: vi.fn(async () => ({ id: 'sub-1', isNew: true })),
  revokeSubscription: vi.fn(),
  sendPushCampaign: vi.fn(),
  PushDuplicateError: class extends Error {},
  countActiveSubscriptions: vi.fn(),
  listPushCampaigns: vi.fn(),
}));

const COMPANY = '11111111-1111-4111-8111-111111111111';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-1004';

import express from 'express';
import { query } from '../config/database';
import { saveSubscription } from '../utils/web-push';
import { issueCdpMemberToken } from '../utils/cdp-member-token';
import cdpRouter from './cdp';

const q = query as unknown as ReturnType<typeof vi.fn>;
const save = saveSubscription as unknown as ReturnType<typeof vi.fn>;

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

beforeEach(() => {
  q.mockReset();
  save.mockClear();
  q.mockImplementation(async (sql: string) => {
    if (/FROM cdp_identity_links/.test(sql)) return { rows: [{ id: 'link-v', customer_id: 'cust-victim' }] };
    return { rows: [] };
  });
});

const sub = { endpoint: 'https://push.example.invalid/1', keys: { p256dh: 'p', auth: 'a' } };
const post = async (body: any, headers: Record<string, string> = {}) => {
  const r = await fetch(`${base}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hanjullo-Key': 'hjl_x', ...headers },
    body: JSON.stringify(body),
  });
  return r.status;
};

describe('push/subscribe 회원 연결', () => {
  it('브라우저 호출 + 토큰 없음 = 익명 구독(남의 회원에 잇지 않는다)', async () => {
    expect(await post({ subscription: sub, external_id: 'victim-id' })).toBe(200);
    expect(save.mock.calls[0][0]).toMatchObject({ customerId: null, identityLinkId: null });
  });

  it('다른 회원 토큰 = 익명', async () => {
    const member_token = issueCdpMemberToken(COMPANY, 'someone-else').token;
    await post({ subscription: sub, external_id: 'victim-id', member_token });
    expect(save.mock.calls[0][0]).toMatchObject({ customerId: null });
  });

  it('이 회원 토큰 = 고객에 잇는다', async () => {
    const member_token = issueCdpMemberToken(COMPANY, 'victim-id').token;
    await post({ subscription: sub, external_id: 'victim-id', member_token });
    expect(save.mock.calls[0][0]).toMatchObject({ customerId: 'cust-victim', identityLinkId: 'link-v' });
  });

  it('비밀키 서버 호출 = 종전처럼 잇는다', async () => {
    await post({ subscription: sub, external_id: 'victim-id' }, { 'X-Hanjullo-Secret': 'sk_x' });
    expect(save.mock.calls[0][0]).toMatchObject({ customerId: 'cust-victim' });
  });
});
