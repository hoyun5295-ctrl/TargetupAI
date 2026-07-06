// ★ 2026-07-06 네이버 커머스 전자서명 검증 — 서버 실측(토큰 발급 성공)과 동일 로직임을 기계 보장.
//   스펙: signature = Base64(bcrypt(client_id + "_" + timestamp_ms, client_secret))
//   client_secret 자체가 bcrypt salt 형식($2a$04$...)이라 salt 인자로 그대로 사용한다.
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { buildNaverCommerceSignature } from './naver-commerce-signature-core';

describe('buildNaverCommerceSignature — client_credentials 전자서명', () => {
  const clientId = 'testClientId123';
  const salt = bcrypt.genSaltSync(4); // 네이버 시크릿과 동일한 $2a$04$ cost-4 salt 형식

  it('Base64 디코드 결과가 bcrypt 해시이며, client_id_timestamp 원문과 역검증 일치', () => {
    const ts = 1706671059230; // 고정 timestamp (문서 예시값)
    const sign = buildNaverCommerceSignature(clientId, salt, ts);
    const decoded = Buffer.from(sign, 'base64').toString('utf8');
    expect(decoded.startsWith('$2a$04$')).toBe(true);
    expect(bcrypt.compareSync(`${clientId}_${ts}`, decoded)).toBe(true);
  });

  it('timestamp가 다르면 서명도 달라진다 (재사용 차단 성질)', () => {
    const s1 = buildNaverCommerceSignature(clientId, salt, 1706671059230);
    const s2 = buildNaverCommerceSignature(clientId, salt, 1706671059231);
    expect(s1).not.toBe(s2);
  });
});
