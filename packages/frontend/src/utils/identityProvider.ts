/**
 * identityProvider.ts — 본인확인기관 인증 창 연결 (★2026-10-02 전송자격인증 2.1 ①-1)
 *
 * 서버가 돌려준 인증기관 이름과 시작 값으로 인증 창을 열고, 그 창이 돌려준 결과를 그대로 넘긴다.
 * 결과가 진짜인지는 여기서 판단하지 않는다 — 서버가 인증기관에 확인한다(`utils/identity-verify.ts`).
 *
 * ⛔ 인증기관 자리 — 한국모바일인증 모듈과 규격을 받으면 이 함수에 그 기관 분기를 넣는다.
 *   지금은 열 수 있는 인증기관이 없다. 서버도 인증기관이 준비되지 않은 동안에는 본인인증을 요구하지 않으므로
 *   운영에서 이 함수가 불리는 일은 없다. 시험 환경의 입력 화면은 창 컴포넌트가 직접 그린다.
 */
export async function launchIdentityProvider(provider: string, _start: Record<string, any>): Promise<any> {
  throw new Error(`UNSUPPORTED_IDENTITY_PROVIDER:${provider}`);
}
