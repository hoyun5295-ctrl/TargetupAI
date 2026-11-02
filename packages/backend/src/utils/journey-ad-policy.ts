/**
 * journey-ad-policy.ts — 여정 광고 표기 정책 (순수, DB import 0)
 *
 * ★ 2026-06-23: 여정 자동화에서 AI가 "신규 가입 감사인사" 등을 정보 안내성으로 판단해
 *   isAd=false로 내리면 발송 시 (광고)+무료수신거부가 통째로 누락 → 정보통신망법 광고 표기 의무 위반 위험.
 *   원칙(Harold 명시): 알림톡(카카오)이 아니면 여정은 무조건 광고성 → 광고 표기 강제.
 *   - 비카카오(SMS/LMS/MMS) = 항상 true (AI/저장값과 무관하게 강제)
 *   - 카카오(알림톡)        = 항상 false — ★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-11 · §4 ⑥ ⑦(D16):
 *     알림톡은 승인 템플릿 정보성 글만 실을 수 있다 → 피로도 상한 · 광고 시간 규칙 · 광고 동의 거름 밖(저장값과 무관 · 옛 행도 같은 판정).
 *   화면 사본 = frontend/src/utils/journey-ad-policy.ts(대조 시험 = backend journey-automarketing-core-1102.test.ts CT-J8).
 *
 *   적용처: journey-ai-generator(생성 시 step.isAd) + journey-executor(발송 직전 최종 강제).
 *   생성·발송 양쪽에 동일 적용 = 과거 is_ad=false로 저장된 여정도 발송 때 자동 교정.
 */
export function resolveJourneyAdFlag(channel: string | null | undefined, _requestedIsAd?: boolean | null): boolean {
  return String(channel || '').trim().toLowerCase() !== 'kakao';
}

/** 같은 판정의 SQL 조각(칸 별칭 · 저장값 is_ad 를 보지 않는다 · 여정 지도 「마케팅 여정」 가르기 등) */
export function journeyStepIsAdSql(stepAlias: string): string {
  return `(LOWER(TRIM(COALESCE(${stepAlias}.channel, ''))) <> 'kakao')`;
}
