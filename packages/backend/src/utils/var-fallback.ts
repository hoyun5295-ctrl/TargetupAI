/**
 * var-fallback.ts — 변수 치환 대체값 컨트롤타워 (DB import 없는 순수 함수)
 *
 * 전 채널 공통(문자/LMS/알림톡). 빈 값일 때만 대체값을 적용한다.
 * 대체값 미지정 시 빈 문자 유지 = 기존 동작(직접발송 불변).
 *
 * 임의 혜택/숫자 가짜값 금지(feedback_ai_no_arbitrary_benefit) — 금액·포인트 등은 기본 대체값에서 제외.
 */

// 표준 필드 기본 대체값 — 안전한 항목만. 값이 비어도 의미가 왜곡되지 않는 것에 한함.
export const STANDARD_FIELD_FALLBACKS: Record<string, string> = {
  name: '고객님',
};

/** 치환값이 비면 대체값으로 채운다. 값이 있거나 대체값이 없으면 원래 값 유지. */
export function applyVarFallback(
  value: string,
  varKey: string,
  fallbacks?: Record<string, string> | null,
): string {
  if (value !== '') return value;
  const fb = fallbacks?.[varKey];
  return typeof fb === 'string' && fb !== '' ? fb : '';
}

/**
 * 변수 매핑(`#{변수}` → `@@필드@@`)에서 표준 필드 기본 대체값을 자동 부여.
 * 사용자 지정 대체값은 이 결과 위에 merge하여 우선 적용한다.
 */
export function buildDefaultFallbacks(
  variableMap: Record<string, string> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [varKey, mapped] of Object.entries(variableMap || {})) {
    if (typeof mapped === 'string' && mapped.startsWith('@@') && mapped.endsWith('@@')) {
      const fieldKey = mapped.slice(2, -2);
      const fb = STANDARD_FIELD_FALLBACKS[fieldKey];
      if (fb) out[varKey] = fb;
    }
  }
  return out;
}
