/**
 * 금칙어 차단 화면 표시명 (★2026-10-03 전송자격인증 — 대외 제출 화면에 내부 코드가 보이지 않게)
 *
 * 경로 = 탐지 · 차단 기록의 `send_source`(백엔드 `checkSpamBlockBeforeCharge` · 큐 적재 길목이 넘기는 값).
 *   campaign = AI 추천 캠페인 발송 · direct = 직접발송 라우트 · direct_core = 직접발송 배관(sendType 미지정)
 *   direct_scheduled = 직접발송 예약분 적재(direct-send-processor)
 *   operator = AI 오퍼레이터 · automarketing = 자동발송 워커 · journey = 여정 실행기.
 * 출처 = 규칙의 `source`(관리자 등록 기본값 internal).
 * 모르는 값은 지어내지 않고 그대로 보여 준다 — 새 경로가 생기면 여기 먼저 추가한다.
 */
export const SPAM_HIT_SOURCE_LABEL: Record<string, string> = {
  campaign: 'AI 추천 발송',
  direct: '직접발송',
  direct_core: '직접발송',
  direct_scheduled: '직접발송(예약)',
  operator: 'AI 오퍼레이터',
  automarketing: '자동발송',
  journey: '여정',
};

export const SPAM_RULE_SOURCE_LABEL: Record<string, string> = {
  internal: '자체 등록',
};

export function resolveSpamHitSourceLabel(v: string | null | undefined): string {
  const k = String(v ?? '').trim();
  return SPAM_HIT_SOURCE_LABEL[k] || k || '-';
}

export function resolveSpamRuleSourceLabel(v: string | null | undefined): string {
  const k = String(v ?? '').trim();
  return SPAM_RULE_SOURCE_LABEL[k] || k || '-';
}
