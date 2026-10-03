/**
 * 시스템 알림(dist-alert) 호출 출발지 — ★2026-10-03 게이트웨이 백업 경보(Harold A안)
 *
 * 못 박는 것:
 *   1. 설정이 없으면 종전과 같다 — 루프백(127.0.0.1 · ::1 · ::ffff:127.0.0.1)만 통과 · 그 밖은 403.
 *   2. INTERNAL_ALERT_ALLOWED_IPS 에 적은 주소만 더 통과한다(쉼표 · 공백 · 형식이 아닌 조각은 버림).
 *   3. nginx 뒤(trust proxy 'loopback')에서 호출자가 X-Forwarded-For 를 꾸며도 nginx 가 붙인 맨 오른쪽 주소로 판정한다.
 *   4. 막힌 요청은 문자를 적재하지 않는다.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../config/database', () => ({
  query: vi.fn(async () => ({ rows: [{ sms_tables: ['SMSQ_SEND_16'] }] })),
  mysqlQuery: vi.fn(async () => []),
  pool: { connect: vi.fn() },
}));
vi.mock('../utils/sms-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/sms-queue')>();
  return { ...actual, bulkInsertSmsQueue: vi.fn(async (_tables: string[], rows: any[][]) => rows.length) };
});

import express from 'express';
import { bulkInsertSmsQueue } from '../utils/sms-queue';
import { isInternalAlertCallerAllowed, parseInternalAlertAllowedIps } from '../utils/internal-alert-access';
import internalAlertRouter from './internal-alert';

const ins = bulkInsertSmsQueue as unknown as ReturnType<typeof vi.fn>;
const GW = '58.227.193.65';

let server: Server;
let base = '';
const savedEnv = process.env.INTERNAL_ALERT_ALLOWED_IPS;

beforeAll(async () => {
  const app = express();
  app.set('trust proxy', 'loopback'); // 운영 app.ts 와 같은 설정
  app.use(express.json());
  app.use('/api/internal', internalAlertRouter);
  server = await new Promise<Server>((resolveServer) => {
    const s = app.listen(0, '127.0.0.1', () => resolveServer(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/internal`;
});

afterAll(() => new Promise<void>((done) => { server.close(() => done()); }));

beforeEach(() => { ins.mockClear(); delete process.env.INTERNAL_ALERT_ALLOWED_IPS; });
afterEach(() => {
  if (savedEnv === undefined) delete process.env.INTERNAL_ALERT_ALLOWED_IPS;
  else process.env.INTERNAL_ALERT_ALLOWED_IPS = savedEnv;
});

/** nginx 가 $proxy_add_x_forwarded_for 로 넘기는 모양 그대로 보낸다(맨 오른쪽 = nginx 가 본 출발지) */
async function callVia(xff: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (xff) headers['x-forwarded-for'] = xff;
  return fetch(`${base}/dist-alert`, { method: 'POST', headers, body: JSON.stringify({ message: '게이트웨이 백업 실패: 시험' }) });
}

describe('판정 함수', () => {
  it('설정이 없으면 루프백만 통과한다(종전 동작)', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isInternalAlertCallerAllowed(ip, undefined)).toBe(true);
    for (const ip of [GW, '::ffff:58.227.193.65', '10.0.0.5', '', 'abc']) expect(isInternalAlertCallerAllowed(ip, undefined)).toBe(false);
    expect(isInternalAlertCallerAllowed(null, undefined)).toBe(false);
  });

  it('적은 주소만 더 통과한다', () => {
    expect(isInternalAlertCallerAllowed(GW, GW)).toBe(true);
    expect(isInternalAlertCallerAllowed('::ffff:58.227.193.65', GW)).toBe(true);
    expect(isInternalAlertCallerAllowed('58.227.193.66', GW)).toBe(false);
    expect(isInternalAlertCallerAllowed('127.0.0.1', GW)).toBe(true); // 설정해도 루프백은 그대로
  });

  it('쉼표 · 공백을 정리하고 형식이 아닌 조각(대역 표기 포함)은 버린다', () => {
    expect([...parseInternalAlertAllowedIps(` ${GW} , 58.227.193.66,, 58.227.193.0/24, 999.1.1.1, x`)]).toEqual([GW, '58.227.193.66']);
    expect(isInternalAlertCallerAllowed('58.227.193.70', '58.227.193.0/24')).toBe(false);
    expect(parseInternalAlertAllowedIps('').size).toBe(0);
  });
});

describe('nginx 뒤 실제 요청', () => {
  it('설정이 없으면 게이트웨이 출발지는 403 이고 문자를 적재하지 않는다', async () => {
    const res = await callVia(GW);
    expect(res.status).toBe(403);
    expect(ins).not.toHaveBeenCalled();
  });

  it('설정하면 게이트웨이 출발지는 200 · 문자 1건', async () => {
    process.env.INTERNAL_ALERT_ALLOWED_IPS = GW;
    const res = await callVia(GW);
    expect(res.status).toBe(200);
    expect(ins).toHaveBeenCalledTimes(1);
    expect(String(ins.mock.calls[0][1][0][2])).toContain('게이트웨이 백업 실패: 시험');
  });

  it('호출자가 X-Forwarded-For 에 허용 주소를 꾸며 넣어도 nginx 가 본 주소로 판정해 403', async () => {
    process.env.INTERNAL_ALERT_ALLOWED_IPS = GW;
    const res = await callVia(`${GW}, 203.0.113.9`); // 꾸민 값, nginx 가 붙인 실제 출발지
    expect(res.status).toBe(403);
    expect(ins).not.toHaveBeenCalled();
  });

  it('같은 서버의 직접 호출(헤더 없음)은 설정과 무관하게 통과한다', async () => {
    expect((await callVia(null)).status).toBe(200);
    process.env.INTERNAL_ALERT_ALLOWED_IPS = GW;
    expect((await callVia(null)).status).toBe(200);
    expect(ins).toHaveBeenCalledTimes(2);
  });
});
