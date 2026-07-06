/**
 * 네이버 커머스 API 전자서명 (순수 — DB/side-effect 0) — ★ 2026-07-06 서버 실측으로 확정한 스펙.
 *   signature = Base64(bcrypt(client_id + "_" + timestamp_ms, client_secret))
 *   client_secret 자체가 bcrypt salt 형식($2a$04$...)이라 salt 인자로 그대로 사용한다.
 * 소비처: naver-commerce-client.ts(토큰 발급) / naver-commerce-signature.test.ts(기계 검증).
 */
import bcrypt from 'bcryptjs';

export function buildNaverCommerceSignature(clientId: string, clientSecret: string, timestampMs: number): string {
  const hashed = bcrypt.hashSync(`${clientId}_${timestampMs}`, clientSecret);
  return Buffer.from(hashed).toString('base64');
}
