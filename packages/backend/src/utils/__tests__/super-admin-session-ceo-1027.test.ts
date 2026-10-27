/**
 * 슈퍼관리자 세션 시간 = 계정별 판정 한 곳 (★ 2026-10-27 Harold 「ceo 만 30분 없이 · 1440분」)
 *
 * 못 박는 것
 *   1. 허용 목록(`SUPER_ADMIN_LONG_SESSION_LOGIN_IDS` · 기본 ceo) 계정 = 1440분, 그 밖(직원 계정 · 빈 값) = 종전 30분.
 *   2. 1440분은 로그인 토큰 수명(24h)과 같고 0(무제한)이 아니다.
 *   3. 세션 시간을 정하는 네 곳(로그인 · OTP 등록 · 연장 · 활동 갱신)이 판정 함수만 부른다.
 *      한 곳이라도 30분 값을 직접 읽으면 「로그인은 24시간인데 활동 갱신이 30분으로 되돌린다」가 된다(0915 · 0927 S2-04 와 같은 뿌리).
 *   4. 슈퍼관리자 세션을 만드는 입구는 둘(로그인 · OTP 등록)뿐이다. 입구가 늘면 이 시험이 먼저 깨진다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TIMEOUTS, LIMITS, superAdminSessionMinutesFor } from '../../config/defaults';
import { scanSources, SCAN_TIMEOUT_MS } from './source-scan';

const SRC = join(__dirname, '..', '..');
const ENV = 'SUPER_ADMIN_LONG_SESSION_LOGIN_IDS';
const saved = process.env[ENV];
afterEach(() => {
  if (saved === undefined) delete process.env[ENV];
  else process.env[ENV] = saved;
});

describe('슈퍼관리자 세션 시간 — ceo 만 1440분', () => {
  it('기본 허용 목록 = ceo 하나 · 직원 계정과 빈 값은 30분', () => {
    delete process.env[ENV];
    expect(superAdminSessionMinutesFor('ceo')).toBe(1440);
    for (const id of ['suran', 'eunji_admin', 'jihyun_admin', 'admin', 'psypsy', 'CEO', 'ceo ', '', undefined, null]) {
      expect(superAdminSessionMinutesFor(id)).toBe(TIMEOUTS.superAdminSessionMinutes);
    }
  });

  it('목록은 설정으로 바꾼다 — 쉼표 · 공백 허용 · 목록에서 빠지면 30분', () => {
    process.env[ENV] = 'suran, ceo';
    expect(superAdminSessionMinutesFor('suran')).toBe(1440);
    expect(superAdminSessionMinutesFor('ceo')).toBe(1440);
    expect(superAdminSessionMinutesFor('eunji_admin')).toBe(TIMEOUTS.superAdminSessionMinutes);
    process.env[ENV] = '-';
    expect(superAdminSessionMinutesFor('ceo')).toBe(TIMEOUTS.superAdminSessionMinutes);
  });

  it('1440분 = 토큰 수명(24h) · 0(무제한)이 아니다', () => {
    expect(TIMEOUTS.superAdminLongSessionMinutes).toBe(1440);
    expect(LIMITS.jwtExpiry).toBe('24h');
    expect(TIMEOUTS.superAdminSessionMinutes).toBeGreaterThan(0);
  });

  it('네 곳이 판정 함수만 부른다 · 슈퍼관리자 세션 입구는 둘뿐 · 30분 값을 직접 읽는 곳은 판정 함수 하나', () => {
    const route = readFileSync(join(SRC, 'routes', 'auth.ts'), 'utf8');
    const mw = readFileSync(join(SRC, 'middlewares', 'auth.ts'), 'utf8');

    // 로그인 · OTP 등록 = 세션을 만드는 입구 2곳 = 판정 함수 2곳(만들 때부터 같은 시간 · 응답의 화면 타이머도 이 값)
    expect(route.match(/appSource: 'super'/g)?.length).toBe(2);
    expect(route.match(/const sessionTimeoutMinutes = superAdminSessionMinutesFor\(admin\.login_id\);/g)?.length).toBe(2);
    expect(route.match(/expiresInMinutes: sessionTimeoutMinutes,/g)?.length).toBe(2);

    // 연장
    const extend = route.slice(route.indexOf("router.post('/extend-session'"), route.indexOf("router.get('/session-check'"));
    expect(extend).toContain('minutes = superAdminSessionMinutesFor(req.user.loginId);');

    // 활동 갱신(5분마다)
    expect(mw).toContain('[decoded.sessionId, superAdminSessionMinutesFor(decoded.loginId)]');

    // 소스 전수 — 세션 시간 값을 직접 읽는 곳은 판정 함수(config/defaults.ts) 하나 · 슈퍼관리자 세션 입구는 routes/auth.ts 하나
    const files = scanSources(SRC);
    const direct = files.filter((f) => /\.superAdmin(Long)?SessionMinutes\b/.test(f.src)).map((f) => f.rel.replace(/\\/g, '/'));
    expect(direct).toEqual(['config/defaults.ts']);
    const defaults = readFileSync(join(SRC, 'config', 'defaults.ts'), 'utf8');
    expect(defaults.match(/\.superAdmin(Long)?SessionMinutes\b/g)?.length).toBe(2);
    const entries = files.filter((f) => /appSource:\s*'super'/.test(f.src)).map((f) => f.rel.replace(/\\/g, '/'));
    expect(entries).toEqual(['routes/auth.ts']);
  }, SCAN_TIMEOUT_MS);
});
