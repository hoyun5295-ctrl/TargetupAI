/**
 * 인앱 개인화 = 확인된 회원만 (★2026-09-26 한줄로 V2 R1-49 · Harold 결정 「서명 없으면 비개인화」)
 *
 * 옛: /cdp/inapp/active가 external_id를 쿼리에서 그대로 받고 서명 확인이 없었다 → 몰 페이지의 공개키만 있으면
 *     임의 회원 아이디로 그 회원의 이름·등급·포인트·구매액을 받아 볼 수 있었다.
 * 처방: 개인화 값은 ①서버 간 호출(비밀키 검증 통과) 또는 ②우리 서버가 서명한 회원 토큰(member_token)이 그 회사·그 회원과 맞을 때만.
 *   그 밖(브라우저·앱의 서명 없는 요청)은 비개인화(서버 사전 치환 = "고객"). 노출 대상 판정(external_id 축)은 그대로.
 *   회원 토큰 = 몰 서버가 비밀키로 POST /api/cdp/member-token 을 불러 받는다(짧은 유효기간 · HMAC · 회사·회원 묶음).
 *   CDP 비밀키는 bcrypt로만 저장돼 서명 검증 키로 못 쓴다 → 서버 비밀값에서 용도 분리한 키로 서명.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { issueCdpMemberToken, verifyCdpMemberToken } from '../cdp-member-token';

const OLD = process.env.JWT_SECRET;
afterEach(() => { if (OLD === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = OLD; });
const CO = '00000000-0000-4000-8000-000000000001';
const CO2 = '00000000-0000-4000-8000-000000000002';

describe('회원 토큰', () => {
  it('발급한 토큰은 같은 회사·회원에만 통과', () => {
    process.env.JWT_SECRET = 'test-secret-not-real';
    const { token } = issueCdpMemberToken(CO, 'member-1', 600, 1_000_000);
    expect(verifyCdpMemberToken(token, CO, 'member-1', 1_000_100)).toBe(true);
    expect(verifyCdpMemberToken(token, CO, 'member-2', 1_000_100)).toBe(false);
    expect(verifyCdpMemberToken(token, CO2, 'member-1', 1_000_100)).toBe(false);
  });
  it('만료·변조·빈 값은 통과하지 않는다', () => {
    process.env.JWT_SECRET = 'test-secret-not-real';
    const { token } = issueCdpMemberToken(CO, 'member-1', 600, 1_000_000);
    expect(verifyCdpMemberToken(token, CO, 'member-1', 1_000_601)).toBe(false);
    expect(verifyCdpMemberToken(token.slice(0, -2) + 'aa', CO, 'member-1', 1_000_100)).toBe(false);
    expect(verifyCdpMemberToken('', CO, 'member-1', 1_000_100)).toBe(false);
    expect(verifyCdpMemberToken(undefined, CO, 'member-1', 1_000_100)).toBe(false);
  });
  it('서버 비밀값이 없으면 발급 불가 · 검증 거짓', () => {
    delete process.env.JWT_SECRET;
    expect(() => issueCdpMemberToken(CO, 'member-1', 600)).toThrow();
    expect(verifyCdpMemberToken('v1.x.y', CO, 'member-1')).toBe(false);
  });
});

describe('배선', () => {
  const cdp = readFileSync(join(__dirname, '..', '..', 'routes', 'cdp.ts'), 'utf8');
  const active = cdp.slice(cdp.indexOf("router.get('/inapp/active'"), cdp.indexOf("router.get('/inapp/active'") + 6000);
  it('개인화 값은 비밀키 호출 또는 회원 토큰 확인 때만', () => {
    expect(active).toContain('const personalizationAllowed = !!externalId && (viaSecret || verifyCdpMemberToken(');
    expect(active).toContain('if (personalizationAllowed && messages.length > 0) {');
  });
  it('회원 토큰 발급 = 비밀키 인증 서버 간 호출 · 관리자 로그인 인증 앞', () => {
    const iRoute = cdp.indexOf("router.post('/member-token', requireCdpApiKey,");
    expect(iRoute).toBeGreaterThan(-1);
    expect(iRoute).toBeLessThan(cdp.indexOf('router.use(authenticate);'));
  });
  it('SDK가 회원 토큰을 싣는다', () => {
    const sdk = readFileSync(join(__dirname, '..', '..', '..', '..', 'sdk-js', 'src', 'inapp.ts'), 'utf8');
    expect(sdk).toContain("if (input.memberToken) params.set('member_token', input.memberToken);");
  });
});
