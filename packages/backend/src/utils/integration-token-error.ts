/**
 * ★ 2026-09-26 한줄로 V2 R1-31 — 쇼핑몰 연동 토큰 요청 실패의 판정 CT(순수 · DB import 0).
 *
 * 카페24·아임웹·메이크샵·네이버 커머스 어댑터가 토큰 갱신 중 **어떤 오류든** 연동을 `token_expired`로 바꿨다.
 * 일시 장애(네트워크 · 제공자 5xx · 429 · 우리 DB 저장 실패) 한 번에도 연동이 끊겨, `status='active'`만 찾는 웹훅이
 * 그 몰의 이벤트를 무시했다(제공자는 재전송하지 않는다 → 재연결 전까지 유실).
 * 확정 실패 = 제공자가 토큰 요청을 400·401·403으로 거절(갱신 토큰·자격 무효) · 저장된 자격이 없음(다시 연결 필요).
 * 그 밖은 상태를 두고 오류만 던진다 — 다음 호출이 다시 갱신한다.
 */

/** 토큰 요청이 HTTP 오류로 거절됐다 — 문구는 그대로 두고 상태코드를 싣는다(화면·로그 불변). */
export function tokenHttpError(message: string, httpStatus: number): Error {
  return Object.assign(new Error(message), { httpStatus });
}

/** 저장된 자격이 없어 다시 연결해야만 풀린다. */
export function reconnectRequiredError(message: string): Error {
  return Object.assign(new Error(message), { reconnectRequired: true });
}

/** 연동을 만료(재연결 필요)로 표시해도 되는 실패인가. */
export function isDefinitiveTokenRejection(err: unknown): boolean {
  const e = err as { httpStatus?: unknown; reconnectRequired?: unknown } | null | undefined;
  if (!e || typeof e !== 'object') return false;
  if (e.reconnectRequired === true) return true;
  const s = Number(e.httpStatus);
  return s === 400 || s === 401 || s === 403;
}
