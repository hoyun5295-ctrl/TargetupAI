/**
 * 다중 인증(MFA) — 전송자격인증 3.4 (★2026-08-18)
 *
 * 못 박는 것:
 *   1. **시행일 전에는 아무것도 걸리지 않는다** — 미설정이 기본이고, 배포만으로는 고객이 막히지 않는다.
 *   2. 코드 **평문을 저장하지 않는다**(해시만).
 *   3. 쿨다운 안 재요청은 새로 보내지 않고 **살아있는 코드를 재사용**한다 — 사용자를 막지 않으면서 문자 폭탄도 막는다.
 *   4. 시도 한도를 넘기면 locked — 호출부가 계정을 잠근다.
 *   5. 인증 대기 티켓은 로그인 토큰이 아니다(purpose 클레임 · 위조·타 용도 토큰 거부).
 *   6. 신뢰 기기 판정은 기기 토큰 + IP 대역 + UA가 **모두** 맞아야 한다(3.5 접속환경 변경 시 재인증).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-for-mfa';
  process.env.SYSTEM_SMS_CALLBACK = '18008125';
});

vi.mock('../config/database', () => ({ query: vi.fn(), mysqlQuery: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('./sms-queue', () => ({ getAuthSmsTable: vi.fn(async () => 'SMSQ_SEND_11') }));

import jwt from 'jsonwebtoken';
import { query, mysqlQuery } from '../config/database';
import {
  isMfaEnforced, maskPhone, ipPrefix, generateMfaCode,
  issueMfaTicket, verifyMfaTicket, issueMfaChallenge, verifyMfaChallenge,
  isTrustedDevice, MFA_MAX_ATTEMPTS,
} from './mfa';

const q = query as unknown as ReturnType<typeof vi.fn>;
const mq = mysqlQuery as unknown as ReturnType<typeof vi.fn>;

const USER = '11111111-1111-1111-1111-111111111111';
const REQ: any = { ip: '211.234.56.78', headers: { 'user-agent': 'vitest-agent' } };

describe('시행일 게이트 — 고지 기간에는 아무도 막히지 않는다', () => {
  const saved = process.env.MFA_ENFORCE_FROM;
  afterEach(() => {
    if (saved === undefined) delete process.env.MFA_ENFORCE_FROM;
    else process.env.MFA_ENFORCE_FROM = saved;
  });

  it('미설정이면 미시행 — 배포만으로는 바뀌지 않는다', () => {
    delete process.env.MFA_ENFORCE_FROM;
    expect(isMfaEnforced(new Date('2026-12-31T00:00:00+09:00'))).toBe(false);
  });

  it('시행일 전이면 미시행', () => {
    process.env.MFA_ENFORCE_FROM = '2026-09-01T00:00:00+09:00';
    expect(isMfaEnforced(new Date('2026-08-31T23:59:59+09:00'))).toBe(false);
  });

  it('시행일 이후면 시행', () => {
    process.env.MFA_ENFORCE_FROM = '2026-09-01T00:00:00+09:00';
    expect(isMfaEnforced(new Date('2026-09-01T00:00:01+09:00'))).toBe(true);
  });

  it('값이 날짜가 아니면 미시행 — 오타로 전 고객을 막지 않는다', () => {
    process.env.MFA_ENFORCE_FROM = '구월일일';
    expect(isMfaEnforced(new Date('2026-12-31T00:00:00+09:00'))).toBe(false);
  });
});

describe('표시·판정 보조', () => {
  it('번호는 가운데를 가린다', () => {
    expect(maskPhone('01052958517')).toBe('010-****-8517');
    expect(maskPhone('010-5295-8517')).toBe('010-****-8517');
    expect(maskPhone('')).toBe('***');
  });

  it('IP 대역은 앞 2옥텟', () => {
    expect(ipPrefix('211.234.56.78')).toBe('211.234');
    expect(ipPrefix('::ffff:211.234.56.78')).toBe('211.234');
  });

  it('코드는 6자리 숫자', () => {
    for (let i = 0; i < 50; i++) expect(generateMfaCode()).toMatch(/^\d{6}$/);
  });
});

describe('인증 대기 티켓은 로그인 토큰이 아니다', () => {
  it('발급한 티켓은 사용자·챌린지를 되돌려준다', () => {
    const parsed = verifyMfaTicket(issueMfaTicket(USER, 'ch-1'));
    expect(parsed).toEqual({ userId: USER, challengeId: 'ch-1' });
  });

  it('purpose가 다른 토큰은 거부한다', () => {
    const other = jwt.sign({ purpose: 'session_takeover', tuid: USER, chid: 'ch-1' }, process.env.JWT_SECRET as string, { expiresIn: 60 });
    expect(verifyMfaTicket(other)).toBeNull();
  });

  it('일반 로그인 토큰을 티켓으로 쓸 수 없다', () => {
    const loginToken = jwt.sign({ userId: USER, userType: 'company_admin' }, process.env.JWT_SECRET as string, { expiresIn: 60 });
    expect(verifyMfaTicket(loginToken)).toBeNull();
  });

  it('빈 값·쓰레기는 거부한다', () => {
    expect(verifyMfaTicket('')).toBeNull();
    expect(verifyMfaTicket('not-a-jwt')).toBeNull();
    expect(verifyMfaTicket(null)).toBeNull();
  });
});

describe('인증번호 발급', () => {
  beforeEach(() => {
    q.mockReset();
    mq.mockReset();
    mq.mockResolvedValue(undefined);
  });

  it('★ 코드 평문을 저장하지 않는다 — 해시만 남는다', async () => {
    q.mockImplementation(async (sql: string) => {
      if (/^\s*SELECT/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO mfa_challenges/i.test(sql)) return { rows: [{ id: 'ch-new' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    const issued = await issueMfaChallenge(USER, '01052958517', REQ);
    expect(issued.status).toBe('sent');

    // 문자로 나간 코드
    const sentBody = String(mq.mock.calls[0][1][2]);
    const code = sentBody.match(/(\d{6})/)![1];

    const insertCall = q.mock.calls.find(([sql]: any[]) => /INSERT INTO mfa_challenges/i.test(String(sql)))!;
    const paramsJson = JSON.stringify(insertCall[1]);
    expect(paramsJson).not.toContain(code);
    expect(String(insertCall[1][1])).toMatch(/^\$2[aby]\$/); // bcrypt 해시
  });

  it('쿨다운 안이면 새로 보내지 않고 살아있는 코드를 재사용한다', async () => {
    q.mockImplementation(async (sql: string) => {
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: [{ id: 'ch-live', created_at: new Date() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const issued = await issueMfaChallenge(USER, '01052958517', REQ);

    expect(issued.status).toBe('reused');
    if (issued.status !== 'reused') throw new Error('reused가 아니다');
    expect(issued.challengeId).toBe('ch-live');
    expect(mq).not.toHaveBeenCalled(); // 문자 재발송 없음
  });

  it('발송 문구에 인증번호와 유효시간이 들어간다', async () => {
    q.mockImplementation(async (sql: string) => {
      if (/^\s*SELECT/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO mfa_challenges/i.test(sql)) return { rows: [{ id: 'ch-new' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    await issueMfaChallenge(USER, '010-5295-8517', REQ);

    const [sql, params] = mq.mock.calls[0];
    expect(String(sql)).toContain('SMSQ_SEND_11');
    expect(String(params[0])).toBe('01052958517'); // 하이픈 제거
    expect(String(params[2])).toMatch(/\d{6}/);
  });
});

describe('인증번호 검증', () => {
  beforeEach(() => {
    q.mockReset();
  });

  function challengeRow(overrides: any = {}) {
    return {
      id: 'ch-1',
      // '000000'의 bcrypt 해시를 쓰지 않고, 검증 통과 케이스는 실제 발급 흐름으로 만든다
      code_hash: '$2a$08$invalidhashinvalidhashinvalidhashinvalidhashinvalidha',
      attempts: 0,
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
      ...overrides,
    };
  }

  it('없는 챌린지는 만료로 본다', async () => {
    q.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await verifyMfaChallenge('ch-x', USER, '123456')).toEqual({ status: 'expired' });
  });

  it('만료된 챌린지는 expired', async () => {
    q.mockResolvedValue({ rows: [challengeRow({ expires_at: new Date(Date.now() - 1000) })], rowCount: 1 });
    expect(await verifyMfaChallenge('ch-1', USER, '123456')).toEqual({ status: 'expired' });
  });

  it('이미 쓴 챌린지는 expired — 재사용 불가', async () => {
    q.mockResolvedValue({ rows: [challengeRow({ consumed_at: new Date() })], rowCount: 1 });
    expect(await verifyMfaChallenge('ch-1', USER, '123456')).toEqual({ status: 'expired' });
  });

  it('시도 한도에 도달한 챌린지는 locked', async () => {
    q.mockResolvedValue({ rows: [challengeRow({ attempts: MFA_MAX_ATTEMPTS })], rowCount: 1 });
    expect(await verifyMfaChallenge('ch-1', USER, '123456')).toEqual({ status: 'locked' });
  });

  it('틀리면 남은 횟수를 알려주고, 한도를 넘기면 locked', async () => {
    q.mockImplementation(async (sql: string) => {
      if (/^\s*SELECT/i.test(sql)) return { rows: [challengeRow({ attempts: 1 })], rowCount: 1 };
      if (/attempts = attempts \+ 1/i.test(sql)) return { rows: [{ attempts: 2 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    expect(await verifyMfaChallenge('ch-1', USER, '999999')).toEqual({
      status: 'wrong',
      remainingAttempts: MFA_MAX_ATTEMPTS - 2,
    });

    q.mockImplementation(async (sql: string) => {
      if (/^\s*SELECT/i.test(sql)) return { rows: [challengeRow({ attempts: MFA_MAX_ATTEMPTS - 1 })], rowCount: 1 };
      if (/attempts = attempts \+ 1/i.test(sql)) return { rows: [{ attempts: MFA_MAX_ATTEMPTS }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    expect(await verifyMfaChallenge('ch-1', USER, '999999')).toEqual({ status: 'locked' });
  });

  it('발급한 코드를 그대로 넣으면 통과한다 (발급→검증 관통)', async () => {
    let stored = '';
    q.mockImplementation(async (sql: string, params: any[]) => {
      if (/INSERT INTO mfa_challenges/i.test(sql)) {
        stored = params[1];
        return { rows: [{ id: 'ch-new' }], rowCount: 1 };
      }
      if (/^\s*SELECT id, code_hash/i.test(sql)) {
        return { rows: [challengeRow({ code_hash: stored })], rowCount: 1 };
      }
      if (/^\s*SELECT/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });

    await issueMfaChallenge(USER, '01052958517', REQ);
    const code = String(mq.mock.calls[mq.mock.calls.length - 1][1][2]).match(/(\d{6})/)![1];

    expect(await verifyMfaChallenge('ch-new', USER, code)).toEqual({ status: 'ok' });
  });
});

describe('신뢰 기기 — 기기·IP·UA가 모두 맞아야 한다', () => {
  beforeEach(() => {
    q.mockReset();
  });

  it('토큰이 없으면 조회조차 하지 않는다', async () => {
    expect(await isTrustedDevice(USER, '', REQ)).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });

  it('조회 조건에 IP 대역·UA·만료가 모두 들어간다', async () => {
    q.mockResolvedValue({ rows: [], rowCount: 0 });

    await isTrustedDevice(USER, 'device-token', REQ);

    const [sql, params] = q.mock.calls[0];
    expect(String(sql)).toMatch(/device_token_hash\s*=\s*\$2/i);
    expect(String(sql)).toMatch(/ip_prefix\s*=\s*\$3/i);
    expect(String(sql)).toMatch(/user_agent_hash\s*=\s*\$4/i);
    expect(String(sql)).toMatch(/expires_at\s*>\s*NOW\(\)/i);
    // 원본 토큰을 그대로 조회 조건에 넣지 않는다(해시로만)
    expect(JSON.stringify(params)).not.toContain('device-token');
    expect(params[2]).toBe('211.234');
  });
});
