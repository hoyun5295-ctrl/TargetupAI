/**
 * login-popups.ts — 로그인 뒤에 뜨는 안내 창의 등록부 (★ 2026-11-15 C135 · Harold 「앞으로 올리는 로그인 이후 팝업들이 얼마나 눌렸는지 트래킹」)
 *
 * 슈퍼관리자 「기능 관심 업체」 탭이 이 목록으로 창의 이름 · 거르기 목록을 그린다(탭에 손으로 적지 않는다).
 * 새 안내 창을 올릴 때 = 여기 한 줄 + 그 창에서 reportPlanFeature(id, 'open')(뜸) · reportPlanFeature(id, 'go')(주 버튼 누름) 두 번.
 *   기록은 audit_logs 로 간다(backend utils/feature-interest.ts · id 형식 = 소문자와 줄표 2 ~ 40자).
 */
export interface LoginPopup { id: string; name: string; goLabel: string }

export const STUDIO_TRIAL_POPUP_ID = 'studio-trial';

export const LOGIN_POPUPS: readonly LoginPopup[] = [
  { id: 'login-promo', name: '로그인 안내 창', goLabel: '바로가기' },
  { id: STUDIO_TRIAL_POPUP_ID, name: '무료체험 안내 창', goLabel: '체험 신청' },
];

export const loginPopupOf = (id: string): LoginPopup | undefined => LOGIN_POPUPS.find((p) => p.id === id);
