/**
 * 접속 인계(takeover) — 이미 접속 중인 아이디로 로그인할 때 (2026-08-18)
 *
 * 못 박는 것:
 *   1. 살아 있는 세션이 있는데 동의가 없으면 → 세션 테이블에 쓰기가 **0회**여야 한다.
 *      (취소했을 때 기존 접속이 멀쩡한가 = 이 기능의 전부)
 *   2. 동의 티켓이 있으면 기존 세션을 끊고 새 세션을 만든다.
 *   3. 티켓은 그 순간의 세션 id에 묶인다 — 재사용해도 그 뒤에 생긴 다른 세션은 못 밀어낸다.
 *   4. 만료된 세션 행(is_active=true인데 expires_at 지남)은 접속 중으로 세지 않는다.
 *      (브라우저를 그냥 닫으면 남는 행 — 이걸 세면 본인이 자기 죽은 세션에 막힌다)
 *   5. 응답에 원본 IP·user_agent를 그대로 내보내지 않는다.
 *   6. 인계 티켓은 API 인증 토큰이 아니다 — Bearer로 쓰면 통과되지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// import보다 먼저 실행돼야 한다 — middlewares/auth.ts는 로드 시점에 JWT_SECRET이 없으면 프로세스를 죽인다
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-for-session-takeover';
});

vi.mock('../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { rotateUserSession, invalidateCompanySessions } from './session-manager';
import { authenticate } from '../middlewares/auth';

const q = query as unknown as ReturnType<typeof vi.fn>;

const USER = '11111111-1111-1111-1111-111111111111';
const LIVE_SESSION = '22222222-2222-2222-2222-222222222222';
const NEW_SESSION = '33333333-3333-3333-3333-333333333333';

const LIVE_ROW = {
  id: LIVE_SESSION,
  ip_address: '211.234.56.78',
  user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  created_at: new Date('2026-08-18T14:32:00'),
  last_activity_at: new Date(),
};

const REQ: any = { ip: '1.2.3.4', headers: { 'user-agent': 'vitest' } };

function params(takeoverTicket?: string) {
  return {
    sessionId: NEW_SESSION,
    userId: USER,
    token: 'new-token',
    appSource: 'hanjul',
    req: REQ,
    expiresInMinutes: 60,
    takeoverTicket,
  };
}

/** SELECT는 주어진 행을, 그 외(UPDATE/INSERT)는 빈 결과를 돌려주는 mock */
function mockDb(liveRows: any[]) {
  q.mockImplementation(async (sql: string) => {
    if (/^\s*SELECT/i.test(sql)) return { rows: liveRows, rowCount: liveRows.length };
    return { rows: [], rowCount: 1 };
  });
}

const writeCalls = () =>
  q.mock.calls.filter(([sql]: any[]) => /INSERT INTO user_sessions|UPDATE user_sessions/i.test(String(sql)));

describe('접속 인계 — 동의 없이는 기존 세션을 끊지 않는다', () => {
  beforeEach(() => {
    q.mockReset();
  });

  it('살아 있는 세션이 있고 동의가 없으면 conflict — 세션 쓰기 0회', async () => {
    mockDb([LIVE_ROW]);

    const outcome = await rotateUserSession(params());

    expect(outcome.status).toBe('conflict');
    expect(writeCalls()).toHaveLength(0);
  });

  it('활성 세션이 없으면 그대로 로그인된다 (기존 동작)', async () => {
    mockDb([]);

    const outcome = await rotateUserSession(params());

    expect(outcome).toEqual({ status: 'rotated', takeover: false });
    expect(writeCalls()).toHaveLength(2); // 무효화 + 생성
  });

  it('conflict가 준 티켓으로 재요청하면 기존 세션을 끊고 로그인된다', async () => {
    mockDb([LIVE_ROW]);
    const first = await rotateUserSession(params());
    if (first.status !== 'conflict') throw new Error('conflict가 아니다');

    q.mockClear();
    mockDb([LIVE_ROW]);
    const second = await rotateUserSession(params(first.conflict.takeoverTicket));

    expect(second).toEqual({ status: 'rotated', takeover: true });
    expect(writeCalls()).toHaveLength(2);
  });

  it('그 사이 다른 세션이 생겼으면 옛 티켓으로는 못 밀어낸다', async () => {
    mockDb([LIVE_ROW]);
    const first = await rotateUserSession(params());
    if (first.status !== 'conflict') throw new Error('conflict가 아니다');

    q.mockClear();
    mockDb([{ ...LIVE_ROW, id: '44444444-4444-4444-4444-444444444444' }]);
    const second = await rotateUserSession(params(first.conflict.takeoverTicket));

    expect(second.status).toBe('conflict');
    expect(writeCalls()).toHaveLength(0);
  });

  it('다른 계정에 발급된 티켓은 통하지 않는다', async () => {
    mockDb([LIVE_ROW]);
    const other = jwt.sign(
      { purpose: 'session_takeover', tuid: 'someone-else', app: 'hanjul', tsid: LIVE_SESSION },
      process.env.JWT_SECRET as string,
      { expiresIn: 120 }
    );

    const outcome = await rotateUserSession(params(other));

    expect(outcome.status).toBe('conflict');
    expect(writeCalls()).toHaveLength(0);
  });

  it('활성 세션 조회는 만료 행을 제외한다', async () => {
    mockDb([]);
    await rotateUserSession(params());

    const select = q.mock.calls.map(([sql]: any[]) => String(sql)).find((s) => /^\s*SELECT/i.test(s));
    expect(select).toBeDefined();
    expect(select).toMatch(/expires_at\s*>\s*NOW\(\)/i);
    expect(select).toMatch(/is_active\s*=\s*true/i);
  });

  it('원본 IP·user_agent를 그대로 내보내지 않는다', async () => {
    mockDb([LIVE_ROW]);
    const outcome = await rotateUserSession(params());
    if (outcome.status !== 'conflict') throw new Error('conflict가 아니다');

    const serialized = JSON.stringify(outcome.conflict.activeSession);
    expect(serialized).not.toContain('211.234.56.78');
    expect(serialized).not.toContain('Mozilla/5.0');
    expect(outcome.conflict.activeSession.ipMasked).toBe('211.234.***.**');
    expect(outcome.conflict.activeSession.deviceLabel).toBe('Chrome · Windows');
    expect(outcome.conflict.activeSession.loginAtText).toBe('2026-08-18 14:32');
  });
});

describe('계약 종료 — 접속 중인 세션까지 끊는다', () => {
  beforeEach(() => {
    q.mockReset();
  });

  it('회사 단위로 활성 세션을 무효화하고 끊은 수를 돌려준다', async () => {
    q.mockImplementation(async () => ({ rows: [], rowCount: 4 }));

    const killed = await invalidateCompanySessions('company-1');

    expect(killed).toBe(4);
    const [sql, params] = q.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE user_sessions/i);
    expect(String(sql)).toMatch(/is_active\s*=\s*false/i);
    // 대상은 그 회사 소속 전원 — app_source를 가리지 않는다(계약이 끝나면 어느 앱이든 끊는다)
    expect(String(sql)).toMatch(/company_id\s*=\s*\$1/i);
    expect(String(sql)).not.toMatch(/app_source/i);
    expect(params).toEqual(['company-1']);
  });
});

describe('인계 티켓은 API 인증 토큰이 아니다', () => {
  beforeEach(() => {
    q.mockReset();
    mockDb([]);
  });

  function fakeRes() {
    const res: any = { statusCode: 0, body: null };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: any) => {
      res.body = body;
      return res;
    };
    return res;
  }

  it('인계 티켓을 Bearer로 쓰면 401', async () => {
    mockDb([LIVE_ROW]);
    const outcome = await rotateUserSession(params());
    if (outcome.status !== 'conflict') throw new Error('conflict가 아니다');

    const req: any = { headers: { authorization: `Bearer ${outcome.conflict.takeoverTicket}` } };
    const res = fakeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(req.user).toBeUndefined();
  });

  it('슈퍼관리자 2FA 등록 토큰도 Bearer로 통하지 않는다', async () => {
    const enrollToken = jwt.sign({ adminId: USER, scope: 'totp_enroll' }, process.env.JWT_SECRET as string, {
      expiresIn: '5m',
    });
    const req: any = { headers: { authorization: `Bearer ${enrollToken}` } };
    const res = fakeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('정상 로그인 토큰(sessionId 없는 옛 토큰 포함)은 통과한다', async () => {
    const legacy = jwt.sign(
      { userId: USER, userType: 'company_admin', loginId: 'hoyun' },
      process.env.JWT_SECRET as string,
      { expiresIn: '1h' }
    );
    const req: any = { headers: { authorization: `Bearer ${legacy}` } };
    const res = fakeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe(USER);
  });
});
