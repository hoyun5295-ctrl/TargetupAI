/**
 * 담당자 본인인증 계약 (★2026-10-02 전송자격인증 2.1 ①-1 · 3.4 ② · ③ · 3.5 ②)
 *
 * 왜 있나
 *   이 게이트는 고객사 전 계정의 로그인 길목에 있다. 판정이 한 칸만 틀어져도 전 고객이 못 들어오거나(막힘),
 *   본인인증 없이 담당자 번호가 바뀐다(뚫림). 그리고 인증기관 모듈은 아직 받지 못했다 — 그 사이에
 *   시험용 인증이 운영에서 켜지면 손으로 넣은 번호가 "본인인증된 번호"가 된다.
 *
 * 못 박는 것
 *   1. 스위치 · 명단 · 인증기관 셋이 모두 성립해야 요구한다. 빈 명단은 "아무도 아님"이다.
 *   2. 시험용 인증은 운영(`NODE_ENV=production`)에서 어떤 설정으로도 켜지지 않는다.
 *   3. 모르는 것은 통과시킨다(표 없음 · 조회 오류) — 전 고객 로그인이 걸린 게이트다.
 *   4. 본인인증 대기 티켓은 로그인 토큰이 아니다(`userId` 클레임 없음 · 다른 용도 토큰 거부).
 *   5. 완료는 한 트랜잭션이고, 대기 행 확정은 조건이 붙은 한 문장이다. 갱신 0행이면 실패.
 *   6. 인증된 번호가 그 계정의 로그인 인증번호가 된다(계정당 하나). 옛 통과권은 해제한다.
 *   7. 이름 · 휴대폰이 형식에 맞지 않으면 DB를 건드리지 않고 거절한다.
 *   8. 세션을 만드는 경로는 전부 관문을 지난다(`issueUserLogin` 호출부에 `identity` 인자).
 *
 * ⚠ mock은 실제 SQL보다 관대하면 안 된다 — 아래 fake는 SQL 문자열을 보고 그 문장에만 답한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import jwt from 'jsonwebtoken';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-for-identity';
});

const client = { query: vi.fn(), release: vi.fn() };
vi.mock('../../config/database', () => {
  const pool = { connect: vi.fn() };
  return { query: vi.fn(), mysqlQuery: vi.fn(), pool, default: pool };
});
vi.mock('../sms-queue', () => ({
  getAuthSmsTable: vi.fn(async () => 'SMSQ_SEND_11'),
  getTestSmsTables: vi.fn(async () => ['SMSQ_SEND_10']),
}));

import pool, { query } from '../../config/database';
import {
  isIdentityVerifyTarget, isIdentityVerifyActiveFor, resolveIdentityProvider, registerIdentityProvider,
  evaluateIdentityGate, issueIdentityTicket, verifyIdentityTicket, normalizeVerifiedPhone, normalizeVerifiedName,
  startIdentityVerification, completeIdentityVerification, identityFailureResponse, loadIdentitySummary,
  IdentityProvider,
} from '../identity-verify';

const q = query as unknown as ReturnType<typeof vi.fn>;
const connect = (pool as any).connect as ReturnType<typeof vi.fn>;

const USER = { id: '11111111-1111-1111-1111-111111111111', login_id: 'hoyun' };
const REQ: any = { ip: '211.234.56.78', headers: { 'user-agent': 'vitest-agent' } };
const ENV_KEYS = ['IDENTITY_VERIFY_ENFORCE_FROM', 'IDENTITY_VERIFY_PILOT_LOGIN_IDS', 'IDENTITY_VERIFY_PROVIDER', 'NODE_ENV'];
const savedEnv: Record<string, string | undefined> = {};

const fakeProvider = (over: Partial<IdentityProvider> = {}): IdentityProvider => ({
  name: 'kmc',
  buildStart: async () => ({ url: 'https://example.invalid/start' }),
  verify: async () => ({ name: '홍길동', phone: '010-0000-0000', dupKey: 'DI-VALUE', providerTxId: 'TX-1' }),
  ...over,
});

function turnOn() {
  process.env.IDENTITY_VERIFY_ENFORCE_FROM = '2026-01-01';
  process.env.IDENTITY_VERIFY_PILOT_LOGIN_IDS = 'hoyun,suran';
  registerIdentityProvider(fakeProvider());
}

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  registerIdentityProvider(null);
  q.mockReset();
  connect.mockReset();
  client.query.mockReset();
  client.release.mockReset();
  connect.mockResolvedValue(client);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  registerIdentityProvider(null);
});

describe('명단 — 빈 명단은 아무도 아니다', () => {
  it.each([undefined, '', '  ', ',', ' , '])('명단이 비면(%s) 대상이 없다', (v) => {
    if (v === undefined) delete process.env.IDENTITY_VERIFY_PILOT_LOGIN_IDS;
    else process.env.IDENTITY_VERIFY_PILOT_LOGIN_IDS = v;
    expect(isIdentityVerifyTarget('hoyun')).toBe(false);
  });

  it('명단에 있는 계정만 대상이다(대소문자 · 공백 무시)', () => {
    process.env.IDENTITY_VERIFY_PILOT_LOGIN_IDS = ' Hoyun , suran ';
    expect(isIdentityVerifyTarget('hoyun')).toBe(true);
    expect(isIdentityVerifyTarget('SURAN')).toBe(true);
    expect(isIdentityVerifyTarget('psy5868')).toBe(false);
    expect(isIdentityVerifyTarget('')).toBe(false);
  });

  it('전 계정은 `*`를 명시해야 한다', () => {
    process.env.IDENTITY_VERIFY_PILOT_LOGIN_IDS = '*';
    expect(isIdentityVerifyTarget('아무계정')).toBe(true);
  });
});

describe('인증기관 — 시험용은 운영에서 켜지지 않는다', () => {
  it('설정이 없으면 인증기관이 없다', () => {
    expect(resolveIdentityProvider()).toBeNull();
  });

  it('시험용은 운영이 아닐 때만 쓰인다', () => {
    process.env.IDENTITY_VERIFY_PROVIDER = 'stub';
    process.env.NODE_ENV = 'test';
    expect(resolveIdentityProvider()?.name).toBe('stub');
  });

  it('★운영에서는 시험용 설정이 있어도 인증기관이 없다', () => {
    process.env.IDENTITY_VERIFY_PROVIDER = 'stub';
    process.env.NODE_ENV = 'production';
    expect(resolveIdentityProvider()).toBeNull();
  });

  it('아직 연결되지 않은 인증기관 이름은 없는 것으로 본다', () => {
    process.env.IDENTITY_VERIFY_PROVIDER = 'kmc';
    expect(resolveIdentityProvider()).toBeNull();
  });
});

describe('요구 조건 — 스위치 · 명단 · 인증기관이 모두 성립해야 한다', () => {
  it('셋이 모두 성립하면 켜진다', () => {
    turnOn();
    expect(isIdentityVerifyActiveFor(USER)).toBe(true);
  });

  it('시행일이 없으면 꺼져 있다(배포만으로는 아무도 요구받지 않는다)', () => {
    turnOn();
    delete process.env.IDENTITY_VERIFY_ENFORCE_FROM;
    expect(isIdentityVerifyActiveFor(USER)).toBe(false);
  });

  it('시행일이 날짜가 아니면 꺼져 있다(오타 방어)', () => {
    turnOn();
    process.env.IDENTITY_VERIFY_ENFORCE_FROM = '10월 26일';
    expect(isIdentityVerifyActiveFor(USER)).toBe(false);
  });

  it('시행일이 아직 오지 않았으면 꺼져 있다', () => {
    turnOn();
    process.env.IDENTITY_VERIFY_ENFORCE_FROM = '2999-01-01';
    expect(isIdentityVerifyActiveFor(USER)).toBe(false);
  });

  it('★시행일만 넣고 명단을 빠뜨리면 꺼져 있다', () => {
    turnOn();
    delete process.env.IDENTITY_VERIFY_PILOT_LOGIN_IDS;
    expect(isIdentityVerifyActiveFor(USER)).toBe(false);
  });

  it('명단 밖 계정은 꺼져 있다', () => {
    turnOn();
    expect(isIdentityVerifyActiveFor({ login_id: 'lululemon44117' })).toBe(false);
  });

  it('★인증기관이 없으면 스위치와 명단이 켜져 있어도 요구하지 않는다', () => {
    turnOn();
    registerIdentityProvider(null);
    expect(isIdentityVerifyActiveFor(USER)).toBe(false);
  });
});

describe('로그인 관문', () => {
  it('꺼져 있으면 DB를 보지 않고 통과한다', async () => {
    const gate = await evaluateIdentityGate(USER);
    expect(gate.status).toBe('cleared');
    expect(q).not.toHaveBeenCalled();
  });

  it('본인인증 이력이 있으면 통과한다', async () => {
    turnOn();
    q.mockImplementation(async (sql: string) => {
      if (/FROM identity_verifications WHERE user_id = \$1 AND status = 'verified'/.test(sql)) return { rows: [{ ok: 1 }] };
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    });
    expect((await evaluateIdentityGate(USER)).status).toBe('cleared');
  });

  it('이력이 없으면 요구한다 — 티켓만 나간다', async () => {
    turnOn();
    q.mockResolvedValue({ rows: [] });
    const gate = await evaluateIdentityGate(USER);
    expect(gate.status).toBe('required');
    if (gate.status === 'required') {
      expect(verifyIdentityTicket(gate.ticket)).toEqual({ userId: USER.id });
    }
  });

  it('★표가 아직 없으면(42P01) 통과한다 — 기능만 쉰다', async () => {
    turnOn();
    q.mockRejectedValue(Object.assign(new Error('relation "identity_verifications" does not exist'), { code: '42P01' }));
    expect((await evaluateIdentityGate(USER)).status).toBe('cleared');
  });

  it('★조회 오류에도 통과한다 — 전 고객 로그인을 막지 않는다', async () => {
    turnOn();
    q.mockRejectedValue(new Error('connection terminated'));
    expect((await evaluateIdentityGate(USER)).status).toBe('cleared');
  });
});

describe('본인인증 대기 티켓 — 로그인 토큰이 아니다', () => {
  it('userId 클레임을 싣지 않는다(인증 미들웨어가 통과시키지 못한다)', () => {
    const decoded = jwt.decode(issueIdentityTicket(USER.id)) as any;
    expect(decoded.userId).toBeUndefined();
    expect(decoded.userType).toBeUndefined();
    expect(decoded.purpose).toBe('identity_pending');
  });

  it('다른 용도의 토큰을 받지 않는다', () => {
    const mfaLike = jwt.sign({ purpose: 'mfa_pending', tuid: USER.id, chid: 'c' }, process.env.JWT_SECRET!);
    const loginLike = jwt.sign({ userId: USER.id, userType: 'company_admin' }, process.env.JWT_SECRET!);
    const forged = jwt.sign({ purpose: 'identity_pending', iuid: USER.id }, 'another-secret');
    for (const t of [mfaLike, loginLike, forged, '', null, 123]) {
      expect(verifyIdentityTicket(t)).toBeNull();
    }
  });
});

describe('인증된 이름 · 번호 형식', () => {
  it('휴대폰은 숫자만 남겨 판정한다', () => {
    expect(normalizeVerifiedPhone('010-0000-0000')).toBe('01000000000');
    expect(normalizeVerifiedPhone('0100000000')).toBe('0100000000');
  });

  it.each(['', '02-0000-0000', '1800-8125', '010-000', '070-0000-0000', null, undefined])('휴대폰이 아닌 값(%s)은 받지 않는다', (v) => {
    expect(normalizeVerifiedPhone(v)).toBeNull();
  });

  it('이름은 앞뒤 공백을 걷고, 비었거나 너무 길면 받지 않는다', () => {
    expect(normalizeVerifiedName('  홍 길동 ')).toBe('홍 길동');
    expect(normalizeVerifiedName('   ')).toBeNull();
    expect(normalizeVerifiedName('가'.repeat(51))).toBeNull();
  });
});

describe('시작', () => {
  it('인증기관이 없으면 시작하지 않는다(DB를 건드리지 않는다)', async () => {
    const r = await startIdentityVerification({ userId: USER.id, purpose: 'first_login', req: REQ });
    expect(r).toEqual({ status: 'unavailable' });
    expect(q).not.toHaveBeenCalled();
  });

  it('살아 있는 대기 행을 접고 새 대기 행을 만든다', async () => {
    turnOn();
    q.mockImplementation(async (sql: string) => {
      if (/^\s*UPDATE identity_verifications SET status = 'superseded'/.test(sql)) return { rows: [], rowCount: 1 };
      if (/^\s*INSERT INTO identity_verifications/.test(sql)) return { rows: [{ id: 'v-1' }] };
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    });
    const r = await startIdentityVerification({ userId: USER.id, purpose: 'change', req: REQ });
    expect(r).toEqual({ status: 'started', verificationId: 'v-1', provider: 'kmc', start: { url: 'https://example.invalid/start' } });
    const insert = q.mock.calls.find((c) => /INSERT INTO identity_verifications/.test(String(c[0])))!;
    expect(insert[1].slice(0, 3)).toEqual([USER.id, 'change', 'kmc']);
  });
});

describe('완료', () => {
  const wireClient = (opts: { confirmed?: boolean; userRow?: any } = {}) => {
    const { confirmed = true, userRow = { name: '인비토01', phone: '070-0000-0000', mfa_phone: '01099999999' } } = opts;
    client.query.mockImplementation(async (sql: string) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      if (/^\s*UPDATE identity_verifications/.test(sql)) return { rows: confirmed ? [{ id: 'v-1' }] : [] };
      if (/^\s*SELECT name, phone, mfa_phone FROM users WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: userRow ? [userRow] : [] };
      if (/^\s*UPDATE users SET name = \$2, phone = \$3, mfa_phone = \$3/.test(sql)) return { rows: [], rowCount: 1 };
      if (/^\s*DELETE FROM mfa_trusted_devices WHERE user_id = \$1/.test(sql)) return { rows: [], rowCount: 0 };
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    });
  };
  const sqls = () => client.query.mock.calls.map((c) => String(c[0]).trim());

  it('인증기관이 없으면 아무것도 하지 않는다', async () => {
    const r = await completeIdentityVerification({ userId: USER.id, verificationId: 'v-1', payload: {}, req: REQ });
    expect(r).toEqual({ status: 'unavailable' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('인증기관이 결과를 인정하지 않으면 거절하고 DB를 건드리지 않는다', async () => {
    turnOn();
    registerIdentityProvider(fakeProvider({ verify: async () => { throw new Error('signature mismatch'); } }));
    const r = await completeIdentityVerification({ userId: USER.id, verificationId: 'v-1', payload: {}, req: REQ });
    expect(r).toEqual({ status: 'rejected', reason: 'provider' });
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    { name: '', phone: '010-0000-0000' },
    { name: '홍길동', phone: '02-000-0000' },
    { name: '홍길동', phone: '' },
  ])('이름 · 휴대폰이 형식에 맞지 않으면(%o) 거절하고 DB를 건드리지 않는다', async (bad) => {
    turnOn();
    registerIdentityProvider(fakeProvider({ verify: async () => bad as any }));
    const r = await completeIdentityVerification({ userId: USER.id, verificationId: 'v-1', payload: {}, req: REQ });
    expect(r).toEqual({ status: 'rejected', reason: 'invalid_identity' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('★대기 행 확정은 조건이 붙은 한 문장이다(대기 · 미만료 · 그 계정 · 그 인증기관)', async () => {
    turnOn();
    wireClient();
    await completeIdentityVerification({ userId: USER.id, verificationId: 'v-1', payload: {}, req: REQ });
    const [sql, params] = client.query.mock.calls.find((c) => /UPDATE identity_verifications/.test(String(c[0])))!;
    expect(String(sql)).toMatch(/WHERE id = \$1 AND user_id = \$2 AND status = 'pending' AND provider = \$7 AND expires_at > NOW\(\)/);
    expect(String(sql)).toMatch(/RETURNING id/);
    expect(params[0]).toBe('v-1');
    expect(params[1]).toBe(USER.id);
    expect(params[6]).toBe('kmc');
  });

  it('★갱신 0행이면 실패다 — 담당자 정보를 바꾸지 않고 되돌린다', async () => {
    turnOn();
    wireClient({ confirmed: false });
    const r = await completeIdentityVerification({ userId: USER.id, verificationId: 'v-1', payload: {}, req: REQ });
    expect(r).toEqual({ status: 'expired' });
    expect(sqls()).toContain('ROLLBACK');
    expect(sqls().some((s) => /^UPDATE users/.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('★인증된 번호가 로그인 인증번호가 되고, 옛 통과권을 해제하고, 한 트랜잭션으로 끝난다', async () => {
    turnOn();
    wireClient();
    const r = await completeIdentityVerification({ userId: USER.id, verificationId: 'v-1', payload: {}, req: REQ });

    expect(r.status).toBe('verified');
    if (r.status !== 'verified') return;
    expect(r.name).toBe('홍길동');
    expect(r.maskedPhone).toBe('010-****-0000');
    expect(r.before).toEqual({ name: '인비토01', maskedPhone: '070-****-0000', maskedMfaPhone: '010-****-9999' });

    const order = sqls();
    expect(order[0]).toBe('BEGIN');
    expect(order[order.length - 1]).toBe('COMMIT');
    const userUpdate = client.query.mock.calls.find((c) => /^\s*UPDATE users/.test(String(c[0])))!;
    expect(userUpdate[1]).toEqual([USER.id, '홍길동', '01000000000']);
    expect(order.some((s) => /^DELETE FROM mfa_trusted_devices/.test(s))).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('중복가입 확인값은 원문이 아니라 해시로만 저장한다', async () => {
    turnOn();
    wireClient();
    await completeIdentityVerification({ userId: USER.id, verificationId: 'v-1', payload: {}, req: REQ });
    const [, params] = client.query.mock.calls.find((c) => /UPDATE identity_verifications/.test(String(c[0])))!;
    expect(JSON.stringify(params)).not.toContain('DI-VALUE');
    expect(params[4]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('도중에 오류가 나면 되돌리고 연결을 반납한다', async () => {
    turnOn();
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      throw new Error('boom');
    });
    await expect(completeIdentityVerification({ userId: USER.id, verificationId: 'v-1', payload: {}, req: REQ })).rejects.toThrow('boom');
    expect(sqls()).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('실패 응답 — 인증기관이 왜 거절했는지는 내보내지 않는다', () => {
  it('종류마다 상태 코드와 안내가 정해져 있다', () => {
    expect(identityFailureResponse({ status: 'unavailable' }).http).toBe(503);
    expect(identityFailureResponse({ status: 'expired' })).toMatchObject({ http: 401, body: { code: 'IDENTITY_EXPIRED' } });
    expect(identityFailureResponse({ status: 'rejected', reason: 'provider' })).toMatchObject({ http: 400, body: { code: 'IDENTITY_REJECTED' } });
  });

  it('안내 문구에 줄표가 없다', () => {
    for (const d of [
      { status: 'unavailable' as const }, { status: 'expired' as const },
      { status: 'rejected' as const, reason: 'provider' as const },
      { status: 'rejected' as const, reason: 'invalid_identity' as const },
    ]) {
      expect(identityFailureResponse(d).body.error).not.toContain('—');
    }
  });
});

describe('설정 화면 카드 — 인증 전에는 이름 · 번호를 내보내지 않는다', () => {
  it('본인인증 이력이 없으면 비어 있다(기존 번호를 인증된 것으로 치지 않는다)', async () => {
    q.mockImplementation(async (sql: string) => {
      if (/FROM users WHERE id = \$1/.test(sql)) return { rows: [{ name: '인비토01', mfa_phone: '01099999999' }] };
      if (/FROM identity_verifications/.test(sql)) return { rows: [] };
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    });
    expect(await loadIdentitySummary(USER.id)).toEqual({ name: null, maskedPhone: null, verifiedAt: null });
  });

  it('이력이 있으면 이름과 가린 번호를 준다', async () => {
    q.mockImplementation(async (sql: string) => {
      if (/FROM users WHERE id = \$1/.test(sql)) return { rows: [{ name: '홍길동', mfa_phone: '01000000000' }] };
      if (/FROM identity_verifications/.test(sql)) return { rows: [{ verified_at: '2026-10-02T07:00:00.000Z' }] };
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    });
    expect(await loadIdentitySummary(USER.id)).toEqual({
      name: '홍길동', maskedPhone: '010-****-0000', verifiedAt: '2026-10-02T07:00:00.000Z',
    });
  });
});

describe('세션을 만드는 경로는 전부 관문을 지난다', () => {
  const SRC = resolve(__dirname, '../..');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => (l.trimStart().startsWith('//') ? '' : l)).join('\n');
  const auth = strip(readFileSync(join(SRC, 'routes/auth.ts'), 'utf8'));
  const loginIssue = strip(readFileSync(join(SRC, 'utils/login-issue.ts'), 'utf8'));

  it('`issueUserLogin`은 관문 증표를 필수로 받는다', () => {
    expect(loginIssue).toMatch(/identity: IdentityClearance;/);
    expect(loginIssue).not.toMatch(/identity\?: IdentityClearance/);
  });

  it('호출부마다 증표를 넘긴다', () => {
    const calls = auth.match(/await issueUserLogin\(\{[\s\S]*?\}\);/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) expect(call).toMatch(/identity: (identity|done)\.clearance/);
  });

  it('로그인 경로에서 본인인증 판정이 인증번호 발송보다 앞선다', () => {
    const start = auth.indexOf("router.post('/login'");
    const end = auth.indexOf("router.post('/logout'");
    const login = auth.slice(start, end);
    const gateAt = login.indexOf('await evaluateIdentityGate(user)');
    const mfaAt = login.indexOf('isMfaRequiredFor(user)');
    expect(gateAt).toBeGreaterThan(-1);
    expect(mfaAt).toBeGreaterThan(gateAt);
  });

  it('요구할 때는 세션도 인증번호도 주지 않고 티켓만 준다', () => {
    const start = auth.indexOf("router.post('/login'");
    const login = auth.slice(start, auth.indexOf("router.post('/logout'"));
    const branch = login.slice(login.indexOf("identity.status === 'required'"), login.indexOf('isMfaRequiredFor(user)'));
    expect(branch).toMatch(/status\(401\)/);
    expect(branch).toMatch(/identityTicket: identity\.ticket/);
    expect(branch).not.toMatch(/token|issueMfaChallenge/);
  });
});
