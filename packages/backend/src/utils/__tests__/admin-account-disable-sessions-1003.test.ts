/**
 * 직원(슈퍼관리자) 계정 사용 중지 = 접속 중인 세션까지 끊는다 (★2026-10-03 · 전송자격인증 3.3)
 *
 * 종전: `super_admins.is_active` 만 false 로 바꿨다. 로그인 게이트는 새 로그인만 막고, 인증 미들웨어는 세션 행만 보므로
 *   이미 접속해 있던 직원은 세션이 끝날 때까지 그대로 쓸 수 있었다.
 *
 * 못 박는 것
 *   1. 계정을 먼저 막고(UPDATE) 그 뒤에 끊는다 — 반대 순서면 그 사이 새 로그인이 생긴다.
 *   2. 끊는 것은 세션 CT(invalidateUserSessions)다 — 라우트에 세션 UPDATE 를 인라인으로 두지 않는다.
 *   3. 끊은 뒤 남은 세션을 다시 세고, 남아 있으면 성공이라 하지 않는다(효과 검증 후 성공).
 *   4. 끊은 건수가 감사 기록에 남는다.
 *   5. 인증 미들웨어는 세션 행이 비활성이면 401 + forceLogout 이다(끊은 효과가 바로 나는 근거).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('PATCH /admin-accounts/:id/active — 중지는 접속까지 끊는다', () => {
  const admin = read('routes/admin.ts');
  const start = admin.indexOf("router.patch('/admin-accounts/:id/active'");
  const body = admin.slice(start, admin.indexOf("router.get('/admin-accounts/history'", start));

  it('계정 UPDATE 뒤에 세션 CT 로 끊는다', () => {
    expect(start).toBeGreaterThan(0);
    const update = body.indexOf("UPDATE super_admins SET is_active = $1 WHERE id = $2");
    const kill = body.indexOf('invalidateUserSessions(id)');
    expect(update).toBeGreaterThan(0);
    expect(kill).toBeGreaterThan(update);
    expect(body).not.toMatch(/UPDATE user_sessions/);
  });

  it('끊은 뒤 남은 세션을 다시 세고 남으면 500(성공이라 하지 않는다)', () => {
    expect(body).toContain("SELECT COUNT(*)::int AS n FROM user_sessions WHERE user_id = $1 AND is_active = true");
    expect(body).toMatch(/if \(remaining > 0\) \{[\s\S]*return res\.status\(500\)/);
    // 감사 기록보다 확인이 먼저다 — 남았는데 「중지」 기록만 남기지 않는다
    expect(body.indexOf('const remaining = await countLive();')).toBeLessThan(body.indexOf('await recordAuditLog('));
  });

  it('끊은 건수를 감사 기록과 응답에 싣는다', () => {
    expect(body).toMatch(/details: \{[^}]*reason, \.\.\.\(nextActive \? \{\} : \{ sessionsEnded \}\)/);
    expect(body).toContain('return res.json({ success: true, ...(nextActive ? {} : { sessionsEnded }) });');
  });

  it('재개(isActive=true)는 세션을 건드리지 않는다', () => {
    expect(body).toMatch(/if \(!nextActive\) \{\s*const countLive/);
  });
});

describe('인증 미들웨어 — 세션 행이 비활성이면 그 토큰은 바로 끊긴다', () => {
  it('세션 대조는 is_active = true 행만 통과', () => {
    const auth = read('middlewares/auth.ts');
    expect(auth).toContain("'SELECT id, last_activity_at, expires_at FROM user_sessions WHERE id = $1 AND user_id = $2 AND is_active = true'");
    expect(auth).toMatch(/if \(sessionResult\.rows\.length === 0\) \{\s*return res\.status\(401\)\.json\(\{[\s\S]*?forceLogout: true/);
  });

  it('세션 CT 는 그 사용자의 활성 세션 전부를 앱 구분 없이 끊는다', () => {
    const sm = read('utils/session-manager.ts');
    expect(sm).toContain('UPDATE user_sessions SET is_active = false WHERE user_id = $1 AND is_active = true');
  });
});
