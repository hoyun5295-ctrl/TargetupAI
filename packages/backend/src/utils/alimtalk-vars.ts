/**
 * 알림톡 변수 미지정 발송 차단 (2026-06-01 #3-2 백엔드 이중 안전망)
 *
 * variableMap의 값이 빈 문자열/공백이면 미해결 변수 → 발송 차단 대상.
 * 프론트 validateAlimtalkVariables(utils/alimtalkVars)가 1차 게이트(수신자 데이터까지 검증),
 * 본 함수는 API 직접 호출 대비 백엔드 net — 미지정 변수만 확인(수신자 데이터 검증은 프론트 담당).
 */
import { applyVarFallback } from './var-fallback';

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

/**
 * 알림톡 #{변수} 치환 컨트롤타워.
 *   variableMap = { '#{name}': '@@필드키@@' | '직접 입력값' }
 *   - '@@필드키@@' → primary → primary.custom_fields → secondary → secondary.custom_fields 순으로
 *     값이 있는(공백 아닌) 첫 소스를 사용하고, 없으면 빈 문자(변수 노출 방지).
 *   - 그 외 문자열 → 직접 입력값 그대로.
 * journey-executor의 replaceAlimtalkVars(고객 1-소스)와 같은 규칙 + 직접발송용 2-소스(고객+주소록) fallback.
 * 알림톡 실패 시 대체문구(k_next_contents)가 raw로 나가 #{변수}가 노출되던 문제의 4경로 통합 fix에 사용.
 */
export function fillAlimtalkVarMap(
  content: string,
  variableMap: Record<string, string> | null | undefined,
  primary: Record<string, any> | null,
  secondary?: Record<string, any> | null,
  fallbacks?: Record<string, string> | null,
): string {
  if (!content) return '';
  const resolveField = (fieldKey: string): string => {
    const sources: Array<Record<string, any> | null | undefined> = [
      primary,
      primary?.custom_fields,
      secondary,
      secondary?.custom_fields,
    ];
    for (const src of sources) {
      if (src && typeof src === 'object' && fieldKey in src) {
        const cv = src[fieldKey];
        if (cv != null && String(cv).trim() !== '') return String(cv);
      }
    }
    return '';
  };
  let out = content;
  for (const [rawKey, rawVal] of Object.entries(variableMap || {})) {
    const escapedKey = rawKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const v = typeof rawVal === 'string' ? rawVal : String(rawVal ?? '');
    const base = (v.startsWith('@@') && v.endsWith('@@')) ? resolveField(v.slice(2, -2)) : (v || '');
    const replacement = applyVarFallback(base, rawKey, fallbacks);
    out = out.replace(new RegExp(escapedKey, 'g'), replacement);
  }
  return out;
}
