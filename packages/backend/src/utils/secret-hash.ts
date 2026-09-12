/**
 * secret-hash.ts — 고엔트로피 비밀값 해시·비교 (CT)
 *
 * 🎯 목적
 *   API 시크릿처럼 **우리가 발급한 고엔트로피 랜덤 값**을 DB에 원문으로 두지 않기 위한 한 벌.
 *   저장은 sha256, 비교는 고정 시간으로 한다.
 *
 * ⛔ 왜 bcrypt가 아닌가
 *   bcrypt·scrypt의 느림은 **사람이 고른 저엔트로피 비밀번호**를 무차별 대입으로부터 지키는 장치다.
 *   여기 대상은 `crypto.randomBytes(32)`(256비트 · 64자 hex)라 무차별 대입도 레인보우 테이블도 성립하지 않는다.
 *   반대로 이 값은 **동기화 배치마다** 검증되므로(요청당 1회) 느린 해시는 그대로 처리량 손실이 된다.
 *   ⛔ 사람이 고른 비밀번호에는 이 모듈을 쓰지 마라 — 그쪽은 bcrypt가 맞다(로그인 경로가 이미 그렇다).
 *
 * ⛔ 비교는 반드시 `timingSafeEqual`로 한다. 길이가 다르면 그 자체가 정보라 먼저 길이를 보고 끝낸다
 *   (길이 노출은 해시 비교에서는 상수라 무의미하고, 원문 폴백 비교에서만 의미가 있는데 그쪽도 곧 사라진다).
 */

import { createHash, timingSafeEqual } from 'crypto';

/** 고엔트로피 비밀값의 저장형(sha256 hex · 64자) */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(String(secret ?? ''), 'utf8').digest('hex');
}

/** hex 문자열 두 개를 고정 시간으로 비교한다(길이가 다르면 false) */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** 원문 문자열 두 개를 고정 시간으로 비교한다(해시 전환 전 폴백 경로용) */
export function timingSafeEqualUtf8(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * 저장된 값(해시 또는 원문)과 제시된 비밀값이 일치하는가.
 * @returns `ok` 일치 여부 · `needsUpgrade` 원문으로 맞았으니 해시를 채워야 하는가
 */
export function verifySecret(
  presented: string,
  stored: { hash?: string | null; plain?: string | null },
): { ok: boolean; needsUpgrade: boolean } {
  if (stored.hash) {
    return { ok: timingSafeEqualHex(hashSecret(presented), stored.hash), needsUpgrade: false };
  }
  if (stored.plain) {
    const ok = timingSafeEqualUtf8(presented, stored.plain);
    return { ok, needsUpgrade: ok };
  }
  return { ok: false, needsUpgrade: false };
}
