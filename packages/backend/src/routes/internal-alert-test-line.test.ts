/**
 * 시스템 알림(dist-alert)의 발송 라인 (2026-09-23 게이트웨이 세션 인계 · 테스트 라인그룹 {16,10})
 *
 * 테스트 라인그룹이 여러 테이블이 된 뒤로, 알림이 배열째 bulkInsertSmsQueue 로 넘어가
 * 전역 라운드로빈 때문에 16(시스템 발송 전용)과 10 을 번갈아 갔다.
 *
 * 못 박는 것:
 *   1. getTestSendTable = 테스트 라인그룹의 첫 테이블(insertTestSmsQueue · MFA 문자와 같은 자리).
 *   2. dist-alert 는 그 테이블 하나에만 적재한다(두 번 보내도 같은 테이블).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../config/database', () => ({
  query: vi.fn(async () => ({ rows: [{ sms_tables: ['SMSQ_SEND_16', 'SMSQ_SEND_10'] }] })),
  mysqlQuery: vi.fn(async () => []),
  pool: { connect: vi.fn() },
}));
vi.mock('../utils/sms-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/sms-queue')>();
  return { ...actual, bulkInsertSmsQueue: vi.fn(async (_tables: string[], rows: any[][]) => rows.length) };
});

import express from 'express';
import { bulkInsertSmsQueue, getTestSendTable } from '../utils/sms-queue';
import internalAlertRouter from './internal-alert';

const ins = bulkInsertSmsQueue as unknown as ReturnType<typeof vi.fn>;

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/internal', internalAlertRouter);
  server = await new Promise<Server>((resolveServer) => {
    const s = app.listen(0, '127.0.0.1', () => resolveServer(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/internal`;
});

afterAll(() => new Promise<void>((done) => { server.close(() => done()); }));

beforeEach(() => { ins.mockClear(); });

describe('테스트 라인그룹 적재 테이블', () => {
  it('getTestSendTable 은 첫 테이블이다', async () => {
    expect(await getTestSendTable()).toBe('SMSQ_SEND_16');
  });

  it('dist-alert 는 적재 테이블 하나에만 넣는다(번갈아 가지 않는다)', async () => {
    for (let i = 0; i < 2; i += 1) {
      const res = await fetch(`${base}/dist-alert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: `빌드 점검 ${i}` }),
      });
      expect(res.status).toBe(200);
    }
    expect(ins).toHaveBeenCalledTimes(2);
    expect(ins.mock.calls.map((c: any[]) => c[0])).toEqual([['SMSQ_SEND_16'], ['SMSQ_SEND_16']]);
  });
});
