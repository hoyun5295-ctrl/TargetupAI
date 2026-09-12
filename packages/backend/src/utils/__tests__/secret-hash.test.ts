/**
 * 시크릿 해시·비교 계약 (★2026-09-12 신설)
 *
 *   싱크에이전트 인증이 원문 SQL 일치에서 해시 비교로 옮겨 갔다. 이미 설치된 에이전트가 멈추면 안 되므로
 *   **세 갈래가 모두 살아 있어야 한다**: 해시 있음 / 해시 없음(원문 폴백 + 승급 신호) / 불일치.
 *   ⛔ 승급 신호(`needsUpgrade`)가 죽으면 해시가 영영 안 채워져 평문이 남는다 — 그것도 여기서 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { hashSecret, timingSafeEqualHex, timingSafeEqualUtf8, verifySecret } from '../secret-hash';

const SECRET = 'a'.repeat(64);          // randomBytes(32).toString('hex') 와 같은 모양
const OTHER = 'b'.repeat(64);

describe('hashSecret', () => {
  it('sha256 hex 64자를 돌려주고 같은 입력은 같은 값이다', () => {
    const h = hashSecret(SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(SECRET)).toBe(h);
  });

  it('다른 입력은 다른 해시다', () => {
    expect(hashSecret(SECRET)).not.toBe(hashSecret(OTHER));
  });
});

describe('고정 시간 비교', () => {
  it('같은 값은 true, 다른 값·길이 다름·빈 값은 false', () => {
    expect(timingSafeEqualHex(hashSecret(SECRET), hashSecret(SECRET))).toBe(true);
    expect(timingSafeEqualHex(hashSecret(SECRET), hashSecret(OTHER))).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abcdef')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
    expect(timingSafeEqualUtf8(SECRET, SECRET)).toBe(true);
    expect(timingSafeEqualUtf8(SECRET, OTHER)).toBe(false);
    expect(timingSafeEqualUtf8('짧다', '더 길다')).toBe(false);
  });
});

describe('verifySecret — 전환기 세 갈래', () => {
  it('해시가 있으면 해시로 맞추고 승급은 요구하지 않는다', () => {
    const r = verifySecret(SECRET, { hash: hashSecret(SECRET), plain: null });
    expect(r).toEqual({ ok: true, needsUpgrade: false });
  });

  it('해시가 없으면 원문으로 맞추고 승급을 요구한다(그 자리에서 해시를 채우라는 신호)', () => {
    const r = verifySecret(SECRET, { hash: null, plain: SECRET });
    expect(r).toEqual({ ok: true, needsUpgrade: true });
  });

  it('해시가 있으면 원문이 맞아도 해시 불일치면 거절한다(해시가 진실)', () => {
    const r = verifySecret(SECRET, { hash: hashSecret(OTHER), plain: SECRET });
    expect(r.ok).toBe(false);
  });

  it('둘 다 없으면 거절한다(빈 계정으로 통과하지 않는다)', () => {
    expect(verifySecret(SECRET, { hash: null, plain: null })).toEqual({ ok: false, needsUpgrade: false });
    expect(verifySecret('', { hash: null, plain: '' })).toEqual({ ok: false, needsUpgrade: false });
  });

  it('틀린 시크릿은 어느 갈래에서도 통과하지 못한다', () => {
    expect(verifySecret(OTHER, { hash: hashSecret(SECRET), plain: null }).ok).toBe(false);
    expect(verifySecret(OTHER, { hash: null, plain: SECRET }).ok).toBe(false);
  });
});
