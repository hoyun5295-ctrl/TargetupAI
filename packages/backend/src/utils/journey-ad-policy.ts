/**
 * journey-ad-policy.ts — 여정 광고 표기 정책 (순수, DB import 0)
 *
 * ★ 2026-06-23: 여정 자동화에서 AI가 "신규 가입 감사인사" 등을 정보 안내성으로 판단해
 *   isAd=false로 내리면 발송 시 (광고)+무료수신거부가 통째로 누락 → 정보통신망법 광고 표기 의무 위반 위험.
 *   원칙(Harold 명시): 알림톡(카카오)이 아니면 여정은 무조건 광고성 → 광고 표기 강제.
 *   - 비카카오(SMS/LMS/MMS) = 항상 true (AI/저장값과 무관하게 강제)
 *   - 카카오(알림톡)        = 요청값 따름 (정보성 허용; 기본 true)
 *
 *   적용처: journey-ai-generator(생성 시 step.isAd) + journey-executor(발송 직전 최종 강제).
 *   생성·발송 양쪽에 동일 적용 = 과거 is_ad=false로 저장된 여정도 발송 때 자동 교정.
 */
export function resolveJourneyAdFlag(channel: string | null | undefined, requestedIsAd?: boolean | null): boolean {
  const ch = String(channel || '').trim().toLowerCase();
  if (ch === 'kakao') return requestedIsAd !== false;
  return true;
}
