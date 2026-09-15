/**
 * 고객사 로그인 세션 만료 시각 — 처음부터 회사 세션 시간으로 잡는다 (2026-09-15 Harold 접수)
 *
 * 경위: 세션을 만들 때 만료를 24시간으로 잡고, 30분으로 줄이는 것은 "로그인 5분 뒤 첫 요청"(미들웨어 갱신)뿐이었다.
 *   로그인 직후 창을 닫으면 서버 세션이 24시간 살아 있었고, 다음 날 아침 같은 브라우저가 옛 토큰으로 요청 1건을
 *   보내자 세션이 되살아나 본인 로그인이 "이 아이디로 지금 다른 곳에서 사용 중입니다"로 막혔다
 *   (0915 운영 PG: hoyun 09-14 21:54 로그인 → 09-15 09:30:11 옛 토큰 page_view → 4초 뒤 login_session_conflict 3회).
 *
 * 못 박는 것:
 *   1. 세션 생성 만료(expiresInMinutes) = 회사 session_timeout_minutes (없으면 30). 24시간 아님.
 *   2. 응답의 sessionTimeoutMinutes(화면 타이머)와 서버 세션 만료가 같은 값이다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// import보다 먼저 실행돼야 한다 — middlewares/auth.ts는 로드 시점에 JWT_SECRET이 없으면 프로세스를 죽인다
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-for-login-issue';
});

vi.mock('../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('./session-manager', () => ({
  rotateUserSession: vi.fn(),
  newSessionId: () => '33333333-3333-3333-3333-333333333333',
}));
vi.mock('./login-block', () => ({ clearBlocksOnSuccess: vi.fn(async () => {}) }));

import { query } from '../config/database';
import { rotateUserSession } from './session-manager';
import { issueUserLogin } from './login-issue';

const q = query as unknown as ReturnType<typeof vi.fn>;
const rotate = rotateUserSession as unknown as ReturnType<typeof vi.fn>;

const USER = {
  id: '11111111-1111-1111-1111-111111111111',
  company_id: '22222222-2222-2222-2222-222222222222',
  login_id: 'tester',
  user_type: 'admin',
  company_name: '테스트',
};
const REQ: any = { ip: '1.2.3.4', headers: { 'user-agent': 'vitest' } };

function mockCompanyTimeout(minutes: number | null) {
  q.mockImplementation(async (sql: string) => {
    if (/session_timeout_minutes/.test(sql)) {
      return { rows: [{ session_timeout_minutes: minutes, kakao_enabled: false }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
}

const call = () =>
  issueUserLogin({ user: USER, loginId: 'tester', appSource: 'hanjul', req: REQ, ipForBlock: '1.2.3.4' });

describe('고객사 로그인 — 서버 세션 만료는 처음부터 회사 세션 시간이다', () => {
  beforeEach(() => {
    q.mockReset();
    rotate.mockReset();
    rotate.mockResolvedValue({ status: 'rotated', takeover: false });
  });

  it('회사 세션 시간(45분)으로 세션을 만든다 — 24시간이 아니다', async () => {
    mockCompanyTimeout(45);

    const result = await call();

    expect(rotate).toHaveBeenCalledTimes(1);
    expect(rotate.mock.calls[0][0].expiresInMinutes).toBe(45);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.body.sessionTimeoutMinutes).toBe(45);
  });

  it('회사 값이 없으면 30분으로 만든다', async () => {
    mockCompanyTimeout(null);

    const result = await call();

    expect(rotate.mock.calls[0][0].expiresInMinutes).toBe(30);
    if (result.status === 'ok') expect(result.body.sessionTimeoutMinutes).toBe(30);
  });

  it('접속 중(conflict)이어도 세션 시간을 먼저 정해 넘긴다 — 동의 뒤 재시도가 같은 값으로 세션을 만든다', async () => {
    mockCompanyTimeout(60);
    rotate.mockResolvedValue({ status: 'conflict', conflict: { code: 'SESSION_IN_USE' } });

    const result = await call();

    expect(rotate.mock.calls[0][0].expiresInMinutes).toBe(60);
    expect(result.status).toBe('conflict');
  });
});
