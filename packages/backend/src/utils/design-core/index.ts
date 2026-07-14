/**
 * ★ CT design-core — 3채널 디자인 코어 진입점 (디자인 4.0, 2026-07-14)
 *
 * 뿌리(채널 무관 정의) 단일 소유:
 *   palette          근원 팔레트 8종 + 인앱 재해석 값
 *   art-direction    타입스케일·밀도·톤 기본·채널 능력표·fail-closed 공용 해석기
 *   fonts            서체 카탈로그 6종(css/emailCss/google)
 *   recommend        결정적 디자인 추천(톤→테마·템플릿→테마·시나리오→형태/구도)
 *   brand-profile    브랜드 정의 단일 조회(brand_kit + Brand Voice — 저장소 신설 없음)
 *   template-registry 채널 중립 골든 템플릿 10종 + 품질 게이트
 *   template-compilers 채널 가지 번역(DM/이메일/인앱)
 *
 * 가지(채널 어댑터): 렌더러·모션·구도 허용표 값은 채널 소유 — 여기 두지 않는다.
 * FE·SDK 미러는 물리 격리로 값 복제 유지 — design-core-mirror.test.ts가 기계 고정.
 */
export * from './palette';
export * from './art-direction';
export * from './fonts';
export * from './recommend';
export * from './brand-profile';
export * from './template-registry';
export * from './template-compilers';
export * from './event-package';
