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
// ★ 2026-09-11 인증번호 발송 = 담당자 테스트 라인(Harold 확정). 인증 라인 mock은 account-action(계정 잠금 안내)이 쓰므로 함께 둔다.
vi.mock('./sms-queue', () => ({
  getAuthSmsTable: vi.fn(async () => 'SMSQ_SEND_11'),
  getTestSmsTables: vi.fn(async () => ['SMSQ_SEND_10']),
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jwt from 'jsonwebtoken';
import { query, mysqlQuery, pool } from '../config/database';
import {
  isMfaEnforced, isMfaPilotTarget, isMfaRequiredFor, maskPhone, ipPrefix, generateMfaCode,
  issueMfaTicket, verifyMfaTicket, issueMfaChallenge, verifyMfaChallenge,
  consumeTakeoverPass, issueTakeoverPass, markVerifiedPhone, MFA_TAKEOVER_PASS_MINUTES, MFA_MAX_ATTEMPTS,
} from './mfa';

const q = query as unknown as ReturnType<typeof vi.fn>;
const mq = mysqlQuery as unknown as ReturnType<typeof vi.fn>;
// ★ 2026-10-02 (Codex 2R) 인증번호 소비 · 통과권 발급은 계정 행을 잠근 트랜잭션에서 한다
const connect = (pool as any).connect as ReturnType<typeof vi.fn>;
const client = { query: vi.fn(), release: vi.fn() };
/** 잠금 트랜잭션 fake — 실제 문장에만 답한다. currentPhone = 잠금 아래에서 읽히는 계정의 현재 인증번호 */
function wireLockedClient(opts: { userExists?: boolean; currentPhone?: string | null; consumed?: boolean } = {}) {
  const { userExists = true, currentPhone = '01000000000', consumed = true } = opts;
  client.query.mockReset();
  client.release.mockReset();
  connect.mockReset();
  connect.mockResolvedValue(client);
  client.query.mockImplementation(async (sql: string, params: any[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (/^SELECT mfa_phone FROM users WHERE id = \$1 FOR UPDATE$/.test(sql)) return { rows: userExists ? [{ mfa_phone: currentPhone }] : [] };
    if (/^\s*UPDATE mfa_challenges SET consumed_at = NOW\(\)/.test(sql)) {
      // 조건의 마지막 인자가 잠금 아래에서 읽은 현재 번호다 — 그 번호의 인증번호만 소비된다
      return { rows: consumed && params[3] === currentPhone ? [{ phone: currentPhone }] : [] };
    }
    if (/^\s*INSERT INTO mfa_trusted_devices/.test(sql)) return { rows: [], rowCount: 1 };
    throw new Error(`예상하지 못한 SQL: ${sql}`);
  });
}
const lockedSqls = () => client.query.mock.calls.map((c) => String(c[0]).trim());

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

/**
 * ★ 2026-09-11 시범 명단 (Harold 확정) — 담당자 번호가 전 계정에 기입되지 않아 전면 시행하면 혼란이 온다.
 * 전송자격인증 4.1 다중인증 로그 증적을 위해 명단 계정(hoyun·psy5868·suran)에만 인증을 건다.
 * 못 박는 것: 명단 밖 계정은 번호가 등록돼 있고 스위치가 켜져 있어도 인증을 요구받지 않는다.
 */
describe('시범 명단 — 명단 계정에만 인증을 요구한다', () => {
  const savedFrom = process.env.MFA_ENFORCE_FROM;
  const savedPilot = process.env.MFA_PILOT_LOGIN_IDS;
  const NOW = new Date('2026-09-12T01:00:00+09:00');
  afterEach(() => {
    if (savedFrom === undefined) delete process.env.MFA_ENFORCE_FROM;
    else process.env.MFA_ENFORCE_FROM = savedFrom;
    if (savedPilot === undefined) delete process.env.MFA_PILOT_LOGIN_IDS;
    else process.env.MFA_PILOT_LOGIN_IDS = savedPilot;
  });

  it('명단이 비어 있으면 명단 제한이 없다 (종전 동작 · 전면 시행 때는 명단을 지운다)', () => {
    delete process.env.MFA_PILOT_LOGIN_IDS;
    expect(isMfaPilotTarget('anyone')).toBe(true);
    process.env.MFA_PILOT_LOGIN_IDS = '  ';
    expect(isMfaPilotTarget('anyone')).toBe(true);
  });

  it('명단이 있으면 명단 계정만 대상 · 대소문자와 공백은 무시한다', () => {
    process.env.MFA_PILOT_LOGIN_IDS = 'hoyun, psy5868 ,suran';
    expect(isMfaPilotTarget('psy5868')).toBe(true);
    expect(isMfaPilotTarget(' HOYUN ')).toBe(true);
    expect(isMfaPilotTarget('suran')).toBe(true);
    expect(isMfaPilotTarget('kumkang4')).toBe(false);
    expect(isMfaPilotTarget('')).toBe(false);
    expect(isMfaPilotTarget(null)).toBe(false);
  });

  it('스위치 + 명단 + 번호가 다 맞아야 인증을 요구한다', () => {
    process.env.MFA_ENFORCE_FROM = '2026-09-11T00:00:00+09:00';
    process.env.MFA_PILOT_LOGIN_IDS = 'hoyun,psy5868,suran';
    expect(isMfaRequiredFor({ login_id: 'hoyun', mfa_phone: '01052958517' }, NOW)).toBe(true);
  });

  it('★명단 밖 고객은 번호가 있고 스위치가 켜져 있어도 인증을 요구받지 않는다', () => {
    process.env.MFA_ENFORCE_FROM = '2026-09-11T00:00:00+09:00';
    process.env.MFA_PILOT_LOGIN_IDS = 'hoyun,psy5868,suran';
    expect(isMfaRequiredFor({ login_id: 'kumkang4', mfa_phone: '01012345678' }, NOW)).toBe(false);
  });

  it('번호가 없으면 명단 계정이어도 인증을 요구하지 않는다 (보낼 곳이 없다)', () => {
    process.env.MFA_ENFORCE_FROM = '2026-09-11T00:00:00+09:00';
    process.env.MFA_PILOT_LOGIN_IDS = 'hoyun';
    expect(isMfaRequiredFor({ login_id: 'hoyun', mfa_phone: null }, NOW)).toBe(false);
  });

  it('스위치가 없으면 명단이 있어도 아무도 인증을 요구받지 않는다', () => {
    delete process.env.MFA_ENFORCE_FROM;
    process.env.MFA_PILOT_LOGIN_IDS = 'hoyun';
    expect(isMfaRequiredFor({ login_id: 'hoyun', mfa_phone: '01052958517' }, NOW)).toBe(false);
  });

  it('[소스 스캔] 로그인 게이트는 판정 CT 하나(isMfaRequiredFor)만 부른다 — 라우트가 조건을 다시 조립하지 않는다', () => {
    const authSrc = readFileSync(resolve(__dirname, '../routes/auth.ts'), 'utf8');
    expect(authSrc).toMatch(/if \(isMfaRequiredFor\(user\)\)/);
    expect(authSrc).not.toMatch(/isMfaEnforced\(/);
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
    // ★ 2026-09-11 발송 라인 = 담당자 테스트 라인(Harold 확정 · 비밀번호 초기화 문자와 같은 라인)
    expect(String(sql)).toContain('INSERT INTO SMSQ_SEND_10 ');
    expect(String(sql)).not.toContain('SMSQ_SEND_11');
    // 테스트발송 청구 조건(app_etc1='test' AND app_etc2=회사)에 걸리지 않게 식별 컬럼을 싣지 않는다 — 고객사 청구 0
    expect(String(sql)).not.toMatch(/app_etc1|app_etc2|bill_id/);
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
      // 실제 조회는 발급된 번호가 계정의 현재 인증번호인지를 함께 돌려준다(★2026-10-02 Codex 1R)
      phone_current: true,
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
      if (/^\s*SELECT c\.id, c\.code_hash/i.test(sql)) {
        return { rows: [challengeRow({ code_hash: stored })], rowCount: 1 };
      }
      if (/^\s*SELECT/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });

    await issueMfaChallenge(USER, '01052958517', REQ);
    const code = String(mq.mock.calls[mq.mock.calls.length - 1][1][2]).match(/(\d{6})/)![1];

    wireLockedClient({ currentPhone: '01052958517' });
    expect(await verifyMfaChallenge('ch-new', USER, code)).toEqual({ status: 'ok', phone: { digits: '01052958517' } });
  });
});

describe('인증번호는 발급된 번호가 계정의 현재 인증번호일 때만 유효하다(★2026-10-02 Codex 1R)', () => {
  beforeEach(() => {
    q.mockReset();
  });

  it('★담당자 번호가 바뀌었으면 옛 번호로 받은 인증번호는 만료다 — 코드 대조조차 하지 않는다', async () => {
    q.mockResolvedValue({
      rows: [{ id: 'ch-1', code_hash: 'x', attempts: 0, expires_at: new Date(Date.now() + 60_000), consumed_at: null, phone_current: false }],
      rowCount: 1,
    });
    expect(await verifyMfaChallenge('ch-1', USER, '123456')).toEqual({ status: 'expired' });
    // 시도 횟수도 올리지 않는다(죽은 인증번호다)
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('★대조 값을 못 읽으면 통과시키지 않는다', async () => {
    q.mockResolvedValue({
      rows: [{ id: 'ch-1', code_hash: 'x', attempts: 0, expires_at: new Date(Date.now() + 60_000), consumed_at: null }],
      rowCount: 1,
    });
    expect(await verifyMfaChallenge('ch-1', USER, '123456')).toEqual({ status: 'expired' });
  });

  it('★(Codex 2R) 통과는 계정 행 잠금 아래 조건이 붙은 한 문장으로 소비에 성공한 것이다', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const hash = await bcrypt.hash('123456', 4);
    q.mockResolvedValue({
      rows: [{ id: 'ch-1', code_hash: hash, attempts: 0, expires_at: new Date(Date.now() + 60_000), consumed_at: null, phone_current: true }],
      rowCount: 1,
    });
    wireLockedClient({ currentPhone: '01000000000' });

    expect(await verifyMfaChallenge('ch-1', USER, '123456')).toEqual({ status: 'ok', phone: { digits: '01000000000' } });

    const order = lockedSqls();
    expect(order[0]).toBe('BEGIN');
    expect(order[1]).toBe('SELECT mfa_phone FROM users WHERE id = $1 FOR UPDATE');
    const [sql, params] = client.query.mock.calls.find((c) => /UPDATE mfa_challenges/.test(String(c[0])))!;
    expect(String(sql)).toMatch(/WHERE id = \$1 AND user_id = \$2 AND consumed_at IS NULL AND expires_at > NOW\(\)\s+AND attempts < \$3 AND phone IS NOT DISTINCT FROM \$4/);
    expect(String(sql)).toMatch(/RETURNING phone/);
    expect(params).toEqual(['ch-1', USER, MFA_MAX_ATTEMPTS, '01000000000']);
    // 잠금 밖에서 무조건 소비하는 문장이 남아 있으면 안 된다
    expect(q.mock.calls.some((c) => /UPDATE mfa_challenges SET consumed_at/.test(String(c[0])))).toBe(false);
  });

  it('★(Codex 2R) 코드가 맞아도, 대조하는 사이 담당자 번호가 바뀌었으면 통과하지 못한다', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const hash = await bcrypt.hash('123456', 4);
    // 조회 시점에는 번호가 맞았다(phone_current: true)
    q.mockResolvedValue({
      rows: [{ id: 'ch-1', code_hash: hash, attempts: 0, expires_at: new Date(Date.now() + 60_000), consumed_at: null, phone_current: true }],
      rowCount: 1,
    });
    // 잠금을 얻고 보니 번호가 바뀌어 있어 소비 문장이 0행을 돌려준다
    wireLockedClient({ currentPhone: '01011112222', consumed: false });

    expect(await verifyMfaChallenge('ch-1', USER, '123456')).toEqual({ status: 'expired' });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('조회가 계정의 현재 인증번호와 대조한다', async () => {
    q.mockResolvedValue({ rows: [], rowCount: 0 });
    await verifyMfaChallenge('ch-1', USER, '123456');
    const [sql] = q.mock.calls[0];
    expect(String(sql)).toMatch(/c\.phone IS NOT DISTINCT FROM u\.mfa_phone/i);
    expect(String(sql)).toMatch(/JOIN users u ON u\.id = c\.user_id/i);
  });
});

describe('접속 인계용 1회 통과권 — 매 로그인 인증(★2026-10-02 기기 신뢰 24시간 폐지)', () => {
  beforeEach(() => {
    q.mockReset();
  });

  it('토큰이 없으면 조회조차 하지 않는다', async () => {
    expect(await consumeTakeoverPass(USER, '', REQ)).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });

  it('쓰는 순간 없앤다 — 조회와 삭제가 한 문장이다', async () => {
    q.mockResolvedValue({ rows: [{ id: 'pass-1' }], rowCount: 1 });

    expect(await consumeTakeoverPass(USER, 'device-token', REQ)).toBe(true);

    expect(q).toHaveBeenCalledTimes(1);
    const [sql] = q.mock.calls[0];
    expect(String(sql)).toMatch(/^\s*DELETE FROM mfa_trusted_devices/i);
    expect(String(sql)).toMatch(/RETURNING id/i);
  });

  it('조건에 기기·IP 대역·UA·만료·발급 뒤 유효시간이 모두 들어간다', async () => {
    q.mockResolvedValue({ rows: [], rowCount: 0 });

    expect(await consumeTakeoverPass(USER, 'device-token', REQ)).toBe(false);

    const [sql, params] = q.mock.calls[0];
    expect(String(sql)).toMatch(/device_token_hash\s*=\s*\$2/i);
    expect(String(sql)).toMatch(/ip_prefix\s*=\s*\$3/i);
    expect(String(sql)).toMatch(/user_agent_hash\s*=\s*\$4/i);
    expect(String(sql)).toMatch(/expires_at\s*>\s*NOW\(\)/i);
    // 배포 전에 만들어진 옛 24시간 신뢰 행은 만료 전이어도 통과권으로 쓰이지 않는다
    expect(String(sql)).toMatch(/created_at\s*>\s*NOW\(\)\s*-\s*INTERVAL '1 minute'\s*\*\s*\$5/i);
    // (Codex 1R) 배포 직전 10분 안에 만들어진 옛 행은 위 조건을 통과한다 — 저장된 유효기간이 통과권 길이 이내인지도 본다
    expect(String(sql)).toMatch(/expires_at\s*<=\s*created_at\s*\+\s*INTERVAL '1 minute'\s*\*\s*\$5/i);
    expect(params[4]).toBe(MFA_TAKEOVER_PASS_MINUTES);
    // 원본 토큰을 그대로 조회 조건에 넣지 않는다(해시로만)
    expect(JSON.stringify(params)).not.toContain('device-token');
    expect(params[2]).toBe('211.234');
  });

  it('유효시간은 분 단위로 짧다 — 유지 시간이 아니라 같은 로그인을 끝내는 시간이다', async () => {
    expect(MFA_TAKEOVER_PASS_MINUTES).toBeLessThanOrEqual(10);
    wireLockedClient({ currentPhone: '01000000000' });

    const token = await issueTakeoverPass(USER, REQ, markVerifiedPhone('01000000000'));

    const [sql, params] = client.query.mock.calls.find((c) => /INSERT INTO mfa_trusted_devices/.test(String(c[0])))!;
    expect(String(sql)).toMatch(/NOW\(\) \+ INTERVAL '1 minute' \* \$5/i);
    expect(params[4]).toBe(MFA_TAKEOVER_PASS_MINUTES);
    // 평문 토큰은 돌려주기만 하고 저장하지 않는다
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(params)).not.toContain(token);
  });

  it('★(Codex 2R) 계정 행을 먼저 잠그고, 방금 통과한 번호가 지금도 계정의 인증번호일 때만 발급한다', async () => {
    wireLockedClient({ currentPhone: '01000000000' });
    expect(await issueTakeoverPass(USER, REQ, markVerifiedPhone('01000000000'))).toMatch(/^[0-9a-f]{64}$/);
    const order = lockedSqls();
    expect(order[0]).toBe('BEGIN');
    expect(order[1]).toBe('SELECT mfa_phone FROM users WHERE id = $1 FOR UPDATE');
    expect(order[order.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('★(Codex 2R) 인증 통과 뒤 담당자 번호가 바뀌었으면 통과권을 만들지 않는다', async () => {
    wireLockedClient({ currentPhone: '01011112222' });
    expect(await issueTakeoverPass(USER, REQ, markVerifiedPhone('01000000000'))).toBeNull();
    expect(lockedSqls().some((s) => /INSERT INTO mfa_trusted_devices/.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('★(Codex 3R) 표식 없는 번호는 증거가 아니다 — 계정에서 다시 읽은 번호(문자열)로는 통과권이 나가지 않는다', async () => {
    wireLockedClient({ currentPhone: '01000000000' });
    // 형을 속여 넘겨도(계정 행은 any로 읽힌다) 실행 시점에 거절한다. 현재 번호와 같은 값이어도 마찬가지다
    expect(await issueTakeoverPass(USER, REQ, '01000000000' as any)).toBeNull();
    expect(await issueTakeoverPass(USER, REQ, { digits: '01000000000' } as any)).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });

  it('통과한 번호를 모르면 DB를 건드리지 않고 만들지 않는다', async () => {
    wireLockedClient();
    for (const v of [null, undefined, '']) {
      expect(await issueTakeoverPass(USER, REQ, v as any)).toBeNull();
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it('계정이 없으면 만들지 않는다', async () => {
    wireLockedClient({ userExists: false });
    expect(await issueTakeoverPass(USER, REQ, markVerifiedPhone('01000000000'))).toBeNull();
    expect(lockedSqls()).toContain('ROLLBACK');
  });
});
