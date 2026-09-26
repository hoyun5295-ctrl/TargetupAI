/**
 * 스팸 테스트폰 앱 인증 = 서버 설정 토큰만 (★2026-09-26 한줄로 V2 S1-H09)
 *
 * 옛: SPAM_APP_TOKEN이 없으면 소스에 박힌 기본 토큰이 열쇠였다 → 누구나 테스트폰 등록·수신 결과 위조 가능.
 * 처방(판정 CT spamAppTokenVerdict): 설정 토큰(SPAM_APP_TOKEN)과 전환용 옛 토큰(SPAM_APP_TOKEN_PREV)만 받는다(상수 시간 비교).
 *   둘 다 없으면 'unconfigured' → 503(받지 않는다). 기본 토큰 하드코딩 제거.
 *   전환 = 서버에 새 토큰 + 옛 토큰(PREV) → 폰마다 앱 첫 화면 "API 토큰"에 새 토큰 입력 후 등록 → PREV 제거.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spamAppTokenVerdict } from '../spam-app-auth';

const OLD = { a: process.env.SPAM_APP_TOKEN, b: process.env.SPAM_APP_TOKEN_PREV };
afterEach(() => {
  if (OLD.a === undefined) delete process.env.SPAM_APP_TOKEN; else process.env.SPAM_APP_TOKEN = OLD.a;
  if (OLD.b === undefined) delete process.env.SPAM_APP_TOKEN_PREV; else process.env.SPAM_APP_TOKEN_PREV = OLD.b;
});

describe('spamAppTokenVerdict', () => {
  it('설정이 없으면 unconfigured(기본 토큰도 받지 않는다)', () => {
    delete process.env.SPAM_APP_TOKEN; delete process.env.SPAM_APP_TOKEN_PREV;
    expect(spamAppTokenVerdict('spam-hanjul-secret-2026')).toBe('unconfigured');
  });
  it('설정 토큰이면 ok · 다르면 invalid', () => {
    process.env.SPAM_APP_TOKEN = 'test-token-new'; delete process.env.SPAM_APP_TOKEN_PREV;
    expect(spamAppTokenVerdict('test-token-new')).toBe('ok');
    expect(spamAppTokenVerdict('test-token-old')).toBe('invalid');
    expect(spamAppTokenVerdict(undefined)).toBe('invalid');
  });
  it('전환 중에는 옛 토큰(PREV)도 받는다', () => {
    process.env.SPAM_APP_TOKEN = 'test-token-new'; process.env.SPAM_APP_TOKEN_PREV = 'test-token-old';
    expect(spamAppTokenVerdict('test-token-old')).toBe('ok');
  });
});

describe('라우트 배선', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'routes', 'spam-filter.ts'), 'utf8');
  it('소스 기본 토큰이 없고 두 앱 엔드포인트가 판정 CT를 쓴다', () => {
    expect(src).not.toContain('spam-hanjul-secret-2026');
    expect(src).toContain("const verdict = spamAppTokenVerdict(req.headers['x-spam-token']);");
    expect((src.match(/const rejected = rejectSpamAppRequest\(req, res\);/g) || []).length).toBe(2);
    expect(src).toContain("code: 'SPAM_APP_TOKEN_UNCONFIGURED'");
  });
});
