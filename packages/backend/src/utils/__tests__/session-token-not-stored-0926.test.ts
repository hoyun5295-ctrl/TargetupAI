/**
 * 로그인 토큰 원문을 DB에 남기지 않는다 (★2026-09-26 한줄로 전수점검 S2-05)
 *
 * `user_sessions.session_token`에 JWT 원문을 저장했지만 읽는 코드가 0곳이다(인증은 세션 id로 대조).
 * DB가 새면 유효한 로그인 토큰이 그대로 나간다.
 * ⛔ 이 컬럼은 NOT NULL이고 **UNIQUE**(`user_sessions_session_token_key` · 0926 운영 실측)다 —
 *   빈 문자열처럼 모든 세션에 같은 값을 넣으면 두 번째 로그인부터 23505로 로그인이 전부 막힌다(배포 전 M-19에서 발견).
 *   그래서 세션마다 유일하고 그 자체로는 인증에 쓸 수 없는 세션 id를 넣는다(서명된 JWT 없이는 무의미).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn(async () => ({ rows: [], rowCount: 1 }));
vi.mock('../../config/database', () => ({ query: (...a: any[]) => (queryMock as any)(...a) }));

import { createUserSession } from '../session-manager';

const baseParams = {
  userId: '00000000-0000-0000-0000-000000000002',
  token: 'eyJhbGciOiJIUzI1NiJ9.secret.payload',
  appSource: 'web',
  req: { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as any,
  expiresInMinutes: 30,
};

describe('createUserSession', () => {
  beforeEach(() => { queryMock.mockClear(); });

  it('session_token 자리에 토큰 원문 대신 세션 id를 넣는다', async () => {
    await createUserSession({ ...baseParams, sessionId: '00000000-0000-0000-0000-000000000001' });
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as any[];
    expect(sql).toContain('session_token');
    expect(params[2]).toBe('00000000-0000-0000-0000-000000000001');
    expect(JSON.stringify(params)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('세션이 다르면 session_token 값도 다르다(UNIQUE 제약)', async () => {
    await createUserSession({ ...baseParams, sessionId: 'aaaaaaaa-0000-0000-0000-000000000001' });
    await createUserSession({ ...baseParams, sessionId: 'bbbbbbbb-0000-0000-0000-000000000002' });
    const a = (queryMock.mock.calls[0] as any[])[1][2];
    const b = (queryMock.mock.calls[1] as any[])[1][2];
    expect(a).not.toBe(b);
    expect(a).not.toBe('');
  });
});
