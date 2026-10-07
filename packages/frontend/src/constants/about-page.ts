/**
 * about-page.ts — 소개 페이지(`/about` · hoyun 전용) 화면 쪽 상수
 *
 * ★ 2026-10-07 묶음 · 순서 · 첫 화면 · 「지키는 것」 구성은 서버(backend/src/content/about-page.ts)로 옮겼다.
 *   허용 계정에만 GET /api/plans/feature-intros 응답의 about 으로 온다(화면 코드에 두면 누구나 받아 간다).
 */

/** 요금제 화면의 도입 상담 창을 바로 여는 주소(PricingPage `openContactModal`) */
export const ABOUT_CONTACT_PATH = '/pricing?openContactModal=true';
