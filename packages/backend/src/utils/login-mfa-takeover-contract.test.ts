/**
 * 인증번호 통과 뒤 "접속 중" — 인증번호 창에서 막히지 않고 접속 인계 창으로 넘어간다 (2026-09-15 Harold 접수)
 *
 * 경위: `/auth/mfa/verify`는 인증번호를 소비하고 신뢰 기기를 등록한 뒤 세션 발급에서 409(SESSION_IN_USE)를 돌려줬다.
 *   인증번호 창은 409를 처리하지 않고 문구만 빨간 글씨로 띄워 인계 동의를 보낼 방법이 없었고,
 *   인증번호는 이미 소비돼 다시 눌러도 만료 · 재발송해 넣으면 또 409였다. 신뢰 기기 토큰도 409 응답에 없어 저장되지 않았다
 *   (0915 운영 PG: hoyun mfa_success → login_session_conflict 3회 반복).
 *
 * 못 박는 것:
 *   1. `/auth/mfa/verify` 409 응답은 방금 등록한 신뢰 기기 토큰을 함께 싣는다(인증 통과가 끝난 경로라서).
 *   2. `/auth/login` 409는 토큰을 싣지 않는다(인증번호를 거치지 않은 경로).
 *   3. 인증번호 창은 409 SESSION_IN_USE를 받으면 토큰을 보관하고, 창을 닫고, 일반 로그인 재시도용 인계 창을 연다.
 *   4. 인계 재시도(doLogin)는 보관한 토큰을 실어 인증번호 없이 통과한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');
}

const FRONT = join(__dirname, '../../../frontend/src');
const auth = stripComments(readFileSync(join(__dirname, '../routes/auth.ts'), 'utf8'));
const loginPage = stripComments(readFileSync(join(FRONT, 'pages/LoginPage.tsx'), 'utf8'));

const between = (src: string, start: string, end: string) => {
  const s = src.indexOf(start);
  expect(s, `${start} 없음`).toBeGreaterThan(-1);
  const e = src.indexOf(end, s + start.length);
  expect(e, `${end} 없음`).toBeGreaterThan(-1);
  return src.slice(s, e);
};

describe('서버 — 인증 통과 뒤 접속 중이면 신뢰 기기 토큰을 함께 준다', () => {
  it('/auth/mfa/verify 409 응답에 mfaDeviceToken을 싣는다', () => {
    const verify = between(auth, "router.post('/mfa/verify'", "router.post('/mfa/resend'");
    expect(verify).toMatch(
      /issue\.status === 'conflict'\)\s*return res\.status\(409\)\.json\(\{\s*\.\.\.issue\.conflict,\s*mfaDeviceToken\s*\}\)/
    );
  });

  it('/auth/login 409 응답은 토큰을 싣지 않는다', () => {
    const login = between(auth, "router.post('/login'", "router.post('/logout'");
    expect(login).toMatch(/return res\.status\(409\)\.json\(issue\.conflict\);/);
    expect(login).not.toMatch(/status\(409\)\.json\(\{[^}]*mfaDeviceToken/);
  });
});

describe('로그인 화면 — 인증번호 창이 접속 중 응답을 인계 창으로 넘긴다', () => {
  const verify = between(loginPage, 'const handleMfaVerify', 'const handleMfaResend');

  it('409 SESSION_IN_USE를 처리한다', () => {
    expect(verify).toMatch(/res\.status === 409 && data\?\.code === 'SESSION_IN_USE'/);
  });

  it('409 처리가 일반 오류 문구 표시보다 앞선다', () => {
    const conflictAt = verify.indexOf("'SESSION_IN_USE'");
    const genericAt = verify.indexOf("setMfaError(data?.error || '인증에 실패했습니다.')");
    expect(genericAt).toBeGreaterThan(-1);
    expect(conflictAt).toBeGreaterThan(-1);
    expect(conflictAt).toBeLessThan(genericAt);
  });

  it('신뢰 기기 토큰을 보관하고, 인증번호 창을 닫고, 일반 로그인 재시도용 인계 창을 연다', () => {
    const branch = between(verify, "'SESSION_IN_USE'", 'return;');
    expect(branch).toMatch(/rememberMfaDevice\(data\.mfaDeviceToken\)/);
    expect(branch).toMatch(/setMfa\(null\)/);
    expect(branch).toMatch(/setTakeover\(\{\s*ticket: data\.takeoverTicket,\s*session: data\.activeSession,\s*retry: 'login'\s*\}\)/);
  });

  it('로그인 성공과 인계 분기가 같은 보관 함수를 쓴다', () => {
    const success = between(loginPage, 'const applyLoginSuccess', 'if (user.mustChangePassword)');
    expect(success).toMatch(/rememberMfaDevice\(mfaDeviceToken\)/);
    expect(loginPage.match(/localStorage\.setItem\('mfaDeviceToken'/g) ?? []).toHaveLength(1);
  });

  it('인계 재시도(doLogin)는 보관한 신뢰 기기 토큰을 싣는다', () => {
    const doLogin = between(loginPage, 'const doLogin', 'const handleSubmit');
    expect(doLogin).toMatch(/mfaDeviceToken: localStorage\.getItem\('mfaDeviceToken'\)/);
  });
});
