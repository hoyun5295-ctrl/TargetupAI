/**
 * 알림톡 변수 미지정 발송 차단 (2026-06-01 #3-2 백엔드 이중 안전망)
 *
 * variableMap의 값이 빈 문자열/공백이면 미해결 변수 → 발송 차단 대상.
 * 프론트 validateAlimtalkVariables(utils/alimtalkVars)가 1차 게이트(수신자 데이터까지 검증),
 * 본 함수는 API 직접 호출 대비 백엔드 net — 미지정 변수만 확인(수신자 데이터 검증은 프론트 담당).
 */
/** 템플릿 본문에서 #{...} 변수 추출 (중복 제거). */
export function extractAlimtalkVariables(content: string | null | undefined): string[] {
  if (!content) return [];
  const matches = content.match(/#\{[^}]+\}/g) || [];
  return Array.from(new Set(matches));
}

export function findUnfilledAlimtalkVars(
  templateContent: string | null | undefined,
  variableMap: Record<string, string> | null | undefined,
): string[] {
  const map = variableMap && typeof variableMap === 'object' ? variableMap : {};
  const unfilled: string[] = [];
  // ★ 검증 기준은 variableMap이 아니라 "템플릿 본문에 실제로 있는 변수" 전체.
  //   매핑이 비어({}) 변수가 통째로 누락돼도 미지정으로 잡는다 (프론트 우회 대비 net).
  for (const variable of extractAlimtalkVariables(templateContent)) {
    if (String(map[variable] ?? '').trim() === '') unfilled.push(variable);
  }
  return unfilled;
}
