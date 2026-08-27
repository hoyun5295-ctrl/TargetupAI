/**
 * 초기 비밀번호 변경 토큰 계약 (★2026-08-27 전송자격인증 3.2·3.3)
 *
 * 왜 있나
 *   초기 비밀번호 상태에서는 **세션(JWT)을 만들지 않는다.** 대신 변경 전용 단명 토큰만 준다.
 *   이 토큰이 일반 인증 토큰처럼 동작하면 통제가 통째로 무너진다 —
 *   비밀번호를 안 바꾼 계정이 그 토큰으로 다른 API를 부르게 된다.
 *
 * 못 박는 것
 *   1. 발급한 토큰은 그 계정 id로 되돌아온다.
 *   2. **`userId` 클레임을 담지 않는다** — 미들웨어 가드가 뚫려도 `req.user`가 채워지지 않게(인계 티켓과 같은 규율).
 *   3. purpose가 다른 토큰(인계 티켓 등)은 통과하지 않는다.
 *   4. 위조·만료·빈 값은 전부 null(닫힘).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-password-change-contract';
});

import { signPasswordChangeToken, verifyPasswordChangeToken } from '../session-manager';

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';

describe('발급과 검증', () => {
  it('발급한 토큰은 그 계정 id로 돌아온다', () => {
    expect(verifyPasswordChangeToken(signPasswordChangeToken(ADMIN_ID))).toBe(ADMIN_ID);
  });

  it('userId 클레임을 담지 않는다 — 인증 미들웨어가 이 토큰으로 req.user를 채우면 안 된다', () => {
    const decoded = jwt.decode(signPasswordChangeToken(ADMIN_ID)) as any;
    expect(decoded.userId).toBeUndefined();
    expect(decoded.userType).toBeUndefined();
    expect(decoded.puid).toBe(ADMIN_ID);
    expect(decoded.purpose).toBe('super_password_change');
  });

  it('수명이 붙어 있다 — 무기한 토큰은 그 자체가 우회 창이다', () => {
    const decoded = jwt.decode(signPasswordChangeToken(ADMIN_ID)) as any;
    expect(typeof decoded.exp).toBe('number');
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(600);
  });
});

describe('통과하면 안 되는 것', () => {
  it('purpose가 다른 토큰은 거부한다(용도 혼용 금지)', () => {
    const other = jwt.sign({ purpose: 'session_takeover', puid: ADMIN_ID }, process.env.JWT_SECRET!, { expiresIn: 600 });
    expect(verifyPasswordChangeToken(other)).toBeNull();
  });

  it('purpose가 없는 일반 토큰은 거부한다', () => {
    const plain = jwt.sign({ userId: ADMIN_ID, userType: 'super_admin' }, process.env.JWT_SECRET!, { expiresIn: 600 });
    expect(verifyPasswordChangeToken(plain)).toBeNull();
  });

  it('다른 키로 서명한 토큰은 거부한다', () => {
    const forged = jwt.sign({ purpose: 'super_password_change', puid: ADMIN_ID }, 'wrong-secret', { expiresIn: 600 });
    expect(verifyPasswordChangeToken(forged)).toBeNull();
  });

  it('만료된 토큰은 거부한다', () => {
    const expired = jwt.sign({ purpose: 'super_password_change', puid: ADMIN_ID }, process.env.JWT_SECRET!, { expiresIn: -10 });
    expect(verifyPasswordChangeToken(expired)).toBeNull();
  });

  it('puid가 비어 있으면 거부한다', () => {
    const empty = jwt.sign({ purpose: 'super_password_change', puid: '' }, process.env.JWT_SECRET!, { expiresIn: 600 });
    expect(verifyPasswordChangeToken(empty)).toBeNull();
  });

  it.each([null, undefined, '', 'not-a-jwt', 123])('토큰이 아닌 값(%s)은 거부한다', (v) => {
    expect(verifyPasswordChangeToken(v as any)).toBeNull();
  });
});
