/**
 * v3-login-intro.ts — 로그인 화면의 「한줄로 V3」 안내 창을 켜는 스위치 한 곳 (★ 2026-11-15 C135 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §2-1)
 *
 * 로그인 전에는 회사를 모른다 → 회사마다 가릴 수 없다. 그 창의 장면(상품 반응 · 기본 여정 한 번에 · 업종 평균)은
 * 단계 개방 ENV(V3_STAGE_*)가 닫힌 동안 고객이 못 쓰는 기능이라, 열지 않은 기능을 약속하지 않도록 스위치로 닫아 둔다.
 *   ENV V3_LOGIN_INTRO = on 일 때만 켜짐 · 비었거나 다른 값 = 꺼짐(로그인 화면은 종전 인증 안내 창 그대로).
 */
export const V3_LOGIN_INTRO_ENV = 'V3_LOGIN_INTRO';

export function v3LoginIntroOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[V3_LOGIN_INTRO_ENV] || '').trim().toLowerCase() === 'on';
}
