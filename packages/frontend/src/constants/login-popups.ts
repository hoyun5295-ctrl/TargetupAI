/**
 * login-popups.ts — 로그인 뒤에 뜨는 안내 창 · 대시보드 배너의 등록부 (★ 2026-11-15 C135 · Harold 「앞으로 올리는 로그인 이후 팝업들이 얼마나 눌렸는지 트래킹」)
 *
 * 슈퍼관리자 「기능 관심 업체」 탭이 이 목록으로 창의 이름 · 거르기 목록을 그린다(탭에 손으로 적지 않는다).
 * 새 안내 창을 올릴 때 = 여기 한 줄 + 그 창에서 reportPlanFeature(id, 'open')(뜸) · reportPlanFeature(id, 'go')(주 버튼 누름) 두 번.
 *   기록은 audit_logs 로 간다(backend utils/feature-interest.ts · id 형식 = 소문자와 줄표 2 ~ 40자).
 * ★ 2026-11-17 C140 — 대시보드 한 줄 배너(7일 무료체험)도 여기 한 줄이다(뜸 = 제안 모양이 그려짐 · 누름 = 한 줄을 적고 버튼을 누름 ·
 *   창이 아니라 노출 횟수 · 숨김 기록이 없다 = introKeys 빈 목록).
 */
/** introKeys = 그 창의 노출 · 「다시 보지 않기」가 적히는 판 열쇠(backend utils/v3-intro.ts · ★ 2026-11-16 C138 숨김 기록을 창 이름으로 보여 주려고) */
export interface LoginPopup { id: string; name: string; goLabel: string; introKeys: readonly string[] }

export const STUDIO_TRIAL_POPUP_ID = 'studio-trial';
/** ★ 2026-11-17 C140 대시보드 한 줄 배너(components/dashboard/LineTrialBanner.tsx) */
export const LINE_TRIAL_BANNER_ID = 'line-trial';

export const LOGIN_POPUPS: readonly LoginPopup[] = [
  { id: 'login-promo', name: '로그인 안내 창', goLabel: '바로가기', introKeys: ['v3-scenes', 'v3-intro'] },
  { id: STUDIO_TRIAL_POPUP_ID, name: '무료체험 안내 창', goLabel: '체험 신청', introKeys: ['studio-trial'] },
  { id: LINE_TRIAL_BANNER_ID, name: '대시보드 한 줄 배너', goLabel: '7일 무료로 써 보기', introKeys: [] },
];

export const loginPopupOf = (id: string): LoginPopup | undefined => LOGIN_POPUPS.find((p) => p.id === id);
/** 판 열쇠 → 그 창(숨김 기록의 이름) */
export const loginPopupOfIntroKey = (introKey: string): LoginPopup | undefined => LOGIN_POPUPS.find((p) => p.introKeys.includes(introKey));
