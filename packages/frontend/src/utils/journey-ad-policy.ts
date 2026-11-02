/**
 * 여정 칸 광고 판정(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-11 · 3-0 CT-J8).
 * 서버 packages/backend/src/utils/journey-ad-policy.ts 의 resolveJourneyAdFlag 와 같은 함수다(대조 시험 = backend journey-automarketing-core-1102.test.ts).
 * 문자 칸 = 늘 광고(정보통신망법) · 알림톡 칸 = 늘 정보성(승인 템플릿) · 저장값은 보지 않는다.
 */
export function resolveJourneyAdFlag(channel: string | null | undefined, _requestedIsAd?: boolean | null): boolean {
  return String(channel || '').trim().toLowerCase() !== 'kakao';
}
