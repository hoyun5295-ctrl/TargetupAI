/**
 * 알림톡 변수 미지정 발송 차단 (2026-06-01 #3-2 백엔드 이중 안전망)
 *
 * variableMap의 값이 빈 문자열/공백이면 미해결 변수 → 발송 차단 대상.
 * 프론트 validateAlimtalkVariables(utils/alimtalkVars)가 1차 게이트(수신자 데이터까지 검증),
 * 본 함수는 API 직접 호출 대비 백엔드 net — 미지정 변수만 확인(수신자 데이터 검증은 프론트 담당).
 */
export function findUnfilledAlimtalkVars(
  variableMap: Record<string, string> | null | undefined,
): string[] {
  if (!variableMap || typeof variableMap !== 'object') return [];
  const unfilled: string[] = [];
  for (const [variable, rawVal] of Object.entries(variableMap)) {
    if (String(rawVal ?? '').trim() === '') unfilled.push(variable);
  }
  return unfilled;
}
