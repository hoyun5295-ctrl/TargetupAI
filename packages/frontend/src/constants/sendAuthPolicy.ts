/**
 * 로그인·발송 인증 의무화 시행일 (★2026-10-03)
 *
 * 10월 1일 회의 결정 = 고지 10/12 · 운영 10/26. 이 날짜는 **화면 안내 문구의 기준일**이다.
 * 서버의 시행 스위치(`MFA_ENFORCE_FROM` · `IDENTITY_VERIFY_ENFORCE_FROM` 등)와는 별개다 — 여기 날짜를 바꿔도
 * 인증이 켜지거나 꺼지지 않는다.
 *
 * 쓰는 곳 = 로그인 화면 고지 창(`LoginPolicyNoticeModal`) · 설정 화면 「계정 담당자」 카드.
 * 날짜를 화면마다 따로 적으면 한쪽만 바뀌는 날이 온다.
 */
export const POLICY_ENFORCE_AT_MS = new Date('2026-10-26T00:00:00+09:00').getTime();
export const POLICY_ENFORCE_DATE_TEXT = '10월 26일';

/** 시행일이 지났는가 */
export function isPolicyEnforced(now: number = Date.now()): boolean {
  return now >= POLICY_ENFORCE_AT_MS;
}
