/**
 * rollout-gate.ts — 단계 적용 게이트 CT (★2026-09-12 전송자격인증 3.4·3.5 공용)
 *
 * 무엇을 하나
 *   "지금 시행 중인가"와 "이 계정이 시범 대상인가"를 판정한다. 통제를 전면 시행하기 전에
 *   **날짜 하나 + 계정 명단**으로 범위를 가두는 것이 이 CT의 전부다.
 *
 * ⛔ 판정 함수는 ENV 이름을 모른다
 *   축마다 자기 ENV를 갖는다(다중인증 = `MFA_*` · 발신 인증 = `SENDER_AUTH_*`).
 *   여기서 ENV를 읽으면 두 축이 한 스위치에 묶여, 한쪽을 켤 때 다른 쪽이 함께 켜진다.
 *
 * ⛔ 성립하지 않는 값은 전부 "미시행 · 대상 아님"으로 접는다
 *   시행일에 오타가 들어가면 그 순간 전 고객이 막힌다. 값이 날짜가 아니면 시행하지 않는다.
 */

/**
 * 시행일 게이트 — 값이 없거나 날짜가 아니면 미시행.
 * @param raw 시행 시작 시각 문자열(ENV 값). 빈 값·공백·비날짜는 전부 미시행.
 */
export function isEnforcedFrom(raw: string | null | undefined, now: Date = new Date()): boolean {
  const value = String(raw || '').trim();
  if (!value) return false;
  const from = new Date(value);
  if (Number.isNaN(from.getTime())) return false;
  return now.getTime() >= from.getTime();
}

/**
 * 시범 명단 게이트 — 명단이 비어 있으면 제한 없음(전면 시행), 있으면 그 계정만.
 * @param raw 쉼표로 나눈 login_id 명단(ENV 값)
 */
export function isPilotTarget(raw: string | null | undefined, loginId: string | null | undefined): boolean {
  const list = String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return true;
  const id = String(loginId || '').trim().toLowerCase();
  if (!id) return false;
  return list.includes(id);
}
