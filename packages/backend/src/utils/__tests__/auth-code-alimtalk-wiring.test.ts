/**
 * ★ 2026-09-19 인증번호 알림톡 — 호출부 배선.
 *   로그인 다중인증(mfa.ts)·발신번호 추가인증(sender-auth.ts)이 알림톡을 먼저 시도하고,
 *   알림톡을 실었으면 문자를 보내지 않으며(이중 발송 0), 못 실었으면 종전 문자를 그대로 보낸다(인증이 막히지 않는다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-for-wiring';
  process.env.SYSTEM_SMS_CALLBACK = '18008125';
});
vi.mock('../../config/database', () => ({ query: vi.fn(), mysqlQuery: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../sms-queue', () => ({
  getAuthSmsTable: vi.fn(async () => 'SMSQ_SEND_11'),
  getTestSmsTables: vi.fn(async () => ['SMSQ_SEND_10']),
}));
vi.mock('../system-alimtalk', () => ({ trySendAuthCodeAlimtalk: vi.fn() }));
vi.mock('../audit-log', () => ({ recordAuditLog: vi.fn(async () => undefined) }));

import { query, mysqlQuery } from '../../config/database';
import { trySendAuthCodeAlimtalk } from '../system-alimtalk';
import { issueMfaChallenge } from '../mfa';
import { issueSenderAuthChallenge } from '../sender-auth';

const q = query as unknown as ReturnType<typeof vi.fn>;
const mq = mysqlQuery as unknown as ReturnType<typeof vi.fn>;
const tryAlim = trySendAuthCodeAlimtalk as unknown as ReturnType<typeof vi.fn>;
const REQ: any = { ip: '211.234.56.78', headers: { 'user-agent': 'vitest' } };

beforeEach(() => {
  q.mockReset(); mq.mockReset(); tryAlim.mockReset();
  mq.mockResolvedValue(undefined);
  q.mockImplementation(async (sql: string) => {
    if (/^\s*SELECT/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO (mfa_challenges|sender_auth_challenges)/i.test(sql)) return { rows: [{ id: 'ch-new' }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
});

describe('로그인 다중인증', () => {
  it('알림톡을 실으면 문자를 보내지 않는다', async () => {
    tryAlim.mockResolvedValue(true);
    await issueMfaChallenge('u1', '010-0000-0000', REQ);
    expect(tryAlim).toHaveBeenCalledWith('mfa_login', '010-0000-0000', expect.stringMatching(/^\d{6}$/));
    expect(mq).not.toHaveBeenCalled();
  });

  it('못 실으면 종전 문자를 그대로 보낸다', async () => {
    tryAlim.mockResolvedValue(false);
    await issueMfaChallenge('u1', '010-0000-0000', REQ);
    expect(mq).toHaveBeenCalledTimes(1);
    expect(String(mq.mock.calls[0][0])).toContain('INSERT INTO SMSQ_SEND_10 ');
  });

  it('알림톡과 문자의 인증번호가 같은 값이다(발급된 코드 하나)', async () => {
    tryAlim.mockResolvedValue(false);
    await issueMfaChallenge('u1', '010-0000-0000', REQ);
    const alimCode = tryAlim.mock.calls[0][2];
    expect(String(mq.mock.calls[0][1][2])).toContain(alimCode);
  });
});

describe('발신번호 추가인증', () => {
  const P = { userId: 'u1', companyId: 'c1', callbackKey: '0212345678', phone: '010-0000-0000', req: REQ };

  it('알림톡을 실으면 문자를 보내지 않는다', async () => {
    tryAlim.mockResolvedValue(true);
    await issueSenderAuthChallenge(P);
    expect(tryAlim).toHaveBeenCalledWith('sender_auth', '010-0000-0000', expect.stringMatching(/^\d{6}$/));
    expect(mq).not.toHaveBeenCalled();
  });

  it('못 실으면 종전 문자를 그대로 보낸다', async () => {
    tryAlim.mockResolvedValue(false);
    await issueSenderAuthChallenge(P);
    expect(mq).toHaveBeenCalledTimes(1);
    expect(String(mq.mock.calls[0][1][2])).toContain('발신번호 인증번호');
  });
});
