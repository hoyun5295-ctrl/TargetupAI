/**
 * 재시작 공백 판정 · 비어 있는 표시 값 다시 채우기 — CT(★ 2026-11-26 · 뿌리 R109 · 설계서 docs/2026-11-26-restart-gap-reread-design.md)
 *
 * 백엔드를 다시 켜는 1 ~ 3초 동안 nginx 는 백엔드에 못 닿아 502(가끔 503 · 504)를 HTML 로 돌려준다.
 * 한 번만 읽는 화면은 그 실패를 그대로 굳혀 숫자를 0 으로 남긴다(대시보드 · 로컬 재현 = 서버가 돌아온 뒤 25초에도 0).
 *
 * 규칙(설계서 §3):
 *   - 판정 = 상태 502 · 503 · 504 이고 content-type 에 application/json 이 없음(서버가 스스로 낸 실패는 JSON = 손대지 않음).
 *   - 원래 요청은 늦추지 않는다(다시 보내기 · 기다리기 0). 비어 있는 **표시 값**만 그 주소로 다시 읽어, 부르는 쪽이 「비어 있을 때만」 채운다.
 *   - 쓰기(발송 · 저장)는 다시 보내지 않는다. 확정 요청은 RestartGapError 로 오늘과 같은 catch 로 보내고 문장만 바꾼다.
 * ⛔ 모듈 최상위 실행 0 · 전역 설치 0 · 모듈 상태 0(고리 둘이 서로를 막지 않는다 · 중복 막기는 부르는 화면이 한다).
 */

/** nginx 가 백엔드에 못 닿아 낸 응답인가 — 502 · 503 · 504 이고 JSON 이 아님 */
export function isRestartGap(status: number | undefined, contentType: string | null | undefined): boolean {
  if (status !== 502 && status !== 503 && status !== 504) return false;
  return !/application\/json/i.test(String(contentType || ''));
}

/** axios 오류가 그 응답인가(response.status · response.headers['content-type']) */
export function isRestartGapAxiosError(err: unknown): boolean {
  const r = (err as { response?: { status?: number; headers?: any } } | null)?.response;
  if (!r) return false;
  const h = r.headers || {};
  const ct = typeof h.get === 'function' ? h.get('content-type') : (h['content-type'] ?? h['Content-Type']);
  return isRestartGap(r.status, ct == null ? null : String(ct));
}

/** 확정 요청이 그 응답을 받았을 때 — 오늘 res.json() 이 던지던 자리에서 같은 catch 로 보낸다(흐름 · 횟수 무변경 · 문장만) */
export class RestartGapError extends Error {
  constructor() {
    super('restart-gap');
    this.name = 'RestartGapError';
  }
}

/** 확정 요청이 그 응답을 받았을 때의 고객 문장(접수됐을 수도 있다 = 다시 올리기 전에 확인) */
export const RESTART_GAP_SEND_ERROR = '접수 여부를 확인하지 못했어요. 명단을 다시 올리기 전에 발송 결과에서 이 발송이 접수됐는지 먼저 확인해 주세요.';

export type RefillOutcome<T> = { gap: true } | { gap: false; value?: T };
export type RefillRead<T> = (token: string | null, signal: AbortSignal) => Promise<RefillOutcome<T>>;

/** 주소 하나를 실패한 요청의 토큰으로 읽어 판정 — 공백 = gap · 성공 = 고른 값 · 그 밖(401 · 500 · JSON 실패) = 값 없음 */
export function jsonRefillRead<T>(path: string, pick: (body: any) => T | undefined, fetchImpl: typeof fetch = fetch): RefillRead<T> {
  return async (token, signal) => {
    const r = await fetchImpl(path, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (isRestartGap(r.status, r.headers.get('content-type'))) return { gap: true };
    if (!r.ok) return { gap: false };
    let body: unknown;
    try { body = await r.json(); } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') throw e;   // 시도 제한으로 본문 읽기가 끊김 = 그 시도만 실패(다음 시도)
      return { gap: false };                                                  // 깨진 JSON = 값 없음(끝 · ★ Codex 구현 1R)
    }
    return { gap: false, value: pick(body) };
  };
}

/**
 * 비어 있는 표시 값 하나를 다시 읽어 채우는 고리.
 *   마감 = 시작 + deadlineMs(20초 · 절대 · 옛 프로세스 종료 대기 최대 12초 + 기동 1 ~ 3초) · 1초 기다림 → 마감 지났거나 ok() 거짓이면 끝 →
 *   시도 마감 시각 = min(전체 마감, 시도 시작 + attemptMs) 을 시작 때 고정(그 시각에 끊는 signal · 본문까지) →
 *   끝난 시각이 시도 마감을 넘었으면 그 응답은 버린다(타이머가 늦게 돌아도 시각으로 다시 본다) → 공백 · 시도 실패면 다시 →
 *   값이 있고 ok() 참이면 fill 한 번 · 값이 없으면 끝(오늘과 같은 화면).
 */
export async function refillWhenServerBack<T>(o: {
  token: string | null;
  read: RefillRead<T>;
  fill: (value: T) => void;
  ok: () => boolean;
  intervalMs?: number;
  deadlineMs?: number;
  attemptMs?: number;
}): Promise<void> {
  const intervalMs = o.intervalMs ?? 1_000;
  const attemptMs = o.attemptMs ?? 5_000;
  const deadline = Date.now() + (o.deadlineMs ?? 20_000);
  for (;;) {
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    if (Date.now() >= deadline || !o.ok()) return;
    const attemptEnd = Math.min(deadline, Date.now() + attemptMs);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(0, attemptEnd - Date.now()));
    let out: RefillOutcome<T>;
    try {
      out = await o.read(o.token, ctl.signal);
    } catch {
      out = { gap: true };   // 끊김 · 연결 실패 = 그 시도만 실패 → 마감 안에서 다음 시도
    } finally {
      clearTimeout(timer);
    }
    if (Date.now() > attemptEnd) continue;   // 시도 마감을 넘겨 끝난 응답은 버린다(전체 마감이면 다음 바퀴에서 끝)
    if (out.gap) continue;
    if (out.value !== undefined && o.ok()) o.fill(out.value);
    return;
  }
}
