/**
 * ★ CT: CDP 회원 토큰 (★2026-09-26 한줄로 V2 R1-49 · Harold 결정 「서명 없으면 비개인화」)
 *
 * 인앱 개인화 값(이름·등급·포인트·구매액)은 **확인된 회원**에게만 준다. 브라우저·앱은 공개키만 들고 있어
 * external_id를 마음대로 바꿔 보낼 수 있으므로, 몰 서버가 비밀키로 우리에게서 회원 토큰을 받아 페이지에 싣는다.
 *   발급 = POST /api/cdp/member-token (requireCdpApiKey · 서버 간 호출)
 *   전달 = SDK `inapp.init({ externalId, memberToken })` · 자동 수집은 body `data-hjl-member-token` 속성
 *   검증 = /cdp/inapp/active 의 member_token 쿼리
 *
 * 형식 = `v1.<payload base64url>.<서명 base64url>` · payload = { c: 회사 id, e: 회원 id, x: 만료(초) }.
 * 서명 키 = 서버 비밀값(JWT_SECRET)에서 **용도를 분리해 파생**한 키(HMAC(JWT_SECRET, 'cdp-member-token-v1')).
 *   CDP 비밀키는 bcrypt로만 저장돼 서명 검증 키로 쓸 수 없다. 비밀값이 없으면 발급 불가 · 검증 거짓(= 비개인화).
 */
import { createHmac, timingSafeEqual } from 'crypto';

const MAX_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_TTL_SECONDS = 60 * 60;

function signingKey(): Buffer | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update('cdp-member-token-v1').digest();
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function issueCdpMemberToken(
  companyId: string,
  externalId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): { token: string; expiresAt: number } {
  const key = signingKey();
  if (!key) throw new Error('회원 토큰 서명 키가 없습니다(서버 설정).');
  const ttl = Math.max(60, Math.min(MAX_TTL_SECONDS, Math.floor(Number(ttlSeconds) || DEFAULT_TTL_SECONDS)));
  const expiresAt = nowSeconds + ttl;
  const payload = b64url(Buffer.from(JSON.stringify({ c: companyId, e: externalId, x: expiresAt })));
  const sig = b64url(createHmac('sha256', key).update(`v1.${payload}`).digest());
  return { token: `v1.${payload}.${sig}`, expiresAt };
}

export function verifyCdpMemberToken(
  token: unknown,
  companyId: string,
  externalId: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof token !== 'string' || !token) return false;
  const key = signingKey();
  if (!key) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const expected = createHmac('sha256', key).update(`v1.${parts[1]}`).digest();
  const given = fromB64url(parts[2]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const p = JSON.parse(fromB64url(parts[1]).toString('utf8'));
    return p?.c === companyId && p?.e === externalId && typeof p?.x === 'number' && p.x > nowSeconds;
  } catch {
    return false;
  }
}
