/**
 * ★ CT: 스팸 테스트폰 앱 인증 판정 (★2026-09-26 한줄로 V2 S1-H09)
 *
 * 옛 라우트는 `process.env.SPAM_APP_TOKEN || '<소스에 적힌 기본 토큰>'`이라, 서버 설정이 비면
 * 누구나 소스의 기본 토큰으로 테스트폰을 등록하고 수신 결과를 위조할 수 있었다.
 *
 * 이제 서버 설정 토큰만 받는다.
 *   - SPAM_APP_TOKEN      = 지금 토큰(필수)
 *   - SPAM_APP_TOKEN_PREV = 전환 중인 옛 토큰(선택 · 폰을 모두 새 토큰으로 바꾸면 지운다)
 * 둘 다 없으면 'unconfigured'(받지 않는다 · 호출부 503). 비교는 상수 시간.
 * 폰 쪽 교체 = 테스트폰 앱 첫 화면 "API 토큰" 칸에 새 토큰을 넣고 [등록](앱이 저장하고 기기를 다시 등록한다 · C:\spam 앱 소스 MainActivity).
 * 값은 요청마다 환경에서 읽는다(설정을 바꾸고 재시작하면 바로 반영).
 */
import { timingSafeEqual } from 'crypto';

export type SpamAppTokenVerdict = 'ok' | 'unconfigured' | 'invalid';

export function spamAppTokenVerdict(provided: unknown): SpamAppTokenVerdict {
  const accepted = [process.env.SPAM_APP_TOKEN, process.env.SPAM_APP_TOKEN_PREV]
    .map((t) => String(t || '').trim())
    .filter((t) => t.length > 0);
  if (accepted.length === 0) return 'unconfigured';
  const given = Buffer.from(typeof provided === 'string' ? provided : '');
  for (const token of accepted) {
    const expected = Buffer.from(token);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return 'ok';
  }
  return 'invalid';
}
