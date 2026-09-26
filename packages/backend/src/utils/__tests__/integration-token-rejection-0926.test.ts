/**
 * 쇼핑몰 연동 토큰 갱신 실패 — 제공자가 거절했을 때만 만료로 표시한다 (★2026-09-26 한줄로 V2 R1-31 · 같은 모양 4곳)
 *
 * 카페24·아임웹·메이크샵·네이버 커머스 어댑터가 토큰 갱신 중 **어떤 오류든** 연동을 `token_expired`로 바꿨다.
 * 네트워크 끊김·제공자 5xx·우리 DB 저장 실패 같은 일시 장애 한 번에도 연동이 끊기고, 웹훅은 `status='active'` 연동만 찾아
 * 그 몰의 주문·회원 이벤트를 200으로 무시했다(재전송 없음 → 재연결 전까지 유실).
 *
 * 못 박는 것
 *   1. 판정 CT 하나: 토큰 요청이 400·401·403(갱신 토큰·자격 무효)으로 거절됐거나 "자격 없음 — 다시 연결"일 때만 확정 실패.
 *   2. 네 어댑터의 토큰 요청은 거절 상태코드를 오류에 싣고, 갱신 catch는 확정 실패일 때만 만료로 표시한다(그 밖은 그대로 던져 다음 시도).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tokenHttpError, reconnectRequiredError, isDefinitiveTokenRejection } from '../integration-token-error';

describe('판정 CT', () => {
  it('400·401·403 = 확정 실패', () => {
    for (const s of [400, 401, 403]) expect(isDefinitiveTokenRejection(tokenHttpError('x', s))).toBe(true);
  });
  it('429·5xx·네트워크·일반 오류 = 일시 장애', () => {
    for (const s of [429, 500, 502, 503]) expect(isDefinitiveTokenRejection(tokenHttpError('x', s))).toBe(false);
    expect(isDefinitiveTokenRejection(new TypeError('fetch failed'))).toBe(false);
    expect(isDefinitiveTokenRejection(new Error('db down'))).toBe(false);
    expect(isDefinitiveTokenRejection(undefined)).toBe(false);
  });
  it('자격 없음(다시 연결 필요) = 확정 실패', () => {
    expect(isDefinitiveTokenRejection(reconnectRequiredError('자격이 없습니다'))).toBe(true);
  });
  it('오류 문구는 그대로 둔다(화면·로그 불변)', () => {
    expect(tokenHttpError('카페24 토큰 갱신 실패 (400): x', 400).message).toBe('카페24 토큰 갱신 실패 (400): x');
  });
});

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('네 어댑터 배선', () => {
  const cases: Array<[string, string, string]> = [
    ['cafe24-client.ts', 'export async function ensureFreshCafe24Token(', '카페24 토큰 갱신 실패'],
    ['imweb-client.ts', 'export async function ensureFreshImwebToken(', '아임웹 토큰 갱신 실패'],
    ['makeshop-client.ts', 'export async function ensureFreshMakeshopToken(', '메이크샵 토큰 발급 실패'],
    ['naver-commerce-client.ts', 'export async function ensureFreshNaverCommerceToken(', '네이버 커머스 토큰 발급 실패'],
  ];
  for (const [file, fnHead, msg] of cases) {
    it(`${file} — 거절 상태코드를 싣고, 확정 실패일 때만 만료 표시`, () => {
      const src = read(file);
      expect(src).toContain(`throw tokenHttpError(\`${msg} (\${res.status}): \${errBody}\`, res.status);`);
      const fn = src.slice(src.indexOf(fnHead));
      const c = fn.slice(fn.indexOf('} catch (err) {'), fn.indexOf('throw err;') + 10);
      expect(c).toMatch(/if \(isDefinitiveTokenRejection\(err\)\) \{\s*await query\(/);
      expect(c).toContain("status = 'token_expired'");
    });
  }

  it('메이크샵·네이버의 자격 없음은 다시 연결 필요로 던진다', () => {
    expect(read('makeshop-client.ts')).toContain("throw reconnectRequiredError('메이크샵 자격(client_id/secret)이 없습니다. 연동 화면에서 다시 연결해주세요.');");
    expect(read('naver-commerce-client.ts')).toContain("throw reconnectRequiredError('네이버 커머스 자격(client_id/secret)이 없습니다. 연동 화면에서 다시 연결해주세요.');");
  });
});
