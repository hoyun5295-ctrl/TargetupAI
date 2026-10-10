/**
 * ★ 2026-10-10 대시보드 B안(의미 있는 움직임만) — 「지금 돌고 있는 자동화」 띠의 판정. 순수 함수(화면 · 테스트 공용).
 *   근거 = 서버가 준 상태뿐이다(목업 지표 금지). 켜진 여정 · 켜진 자동 마케팅만 「자동으로 도는 것」으로 센다.
 *   발송 중 · 예약 대기는 캠페인 상태라 띠에 함께 보이지만 개수에는 넣지 않는다.
 *   잠금 = backend `__tests__/dashboard-live-1010.test.ts`.
 */

/** GET /api/ai/operator/continuous 의 operators[] 중 쓰는 칸 */
export interface LiveOperatorRow { name?: string | null; status?: string | null; nextRunAt?: string | null }
/** GET /api/ai/operator/journeys?status=active 의 journeys[] 중 쓰는 칸 */
export interface LiveJourneyRow { name?: string | null; status?: string | null; stats_total_entered?: number | string | null }
/** 대시보드 예약 대기 목록(scheduled + 예약 시각 있는 draft) 중 쓰는 칸 */
export interface LiveScheduledRow { campaign_name?: string | null; scheduled_at?: string | null }
/** GET /api/campaigns/:id/send-progress 를 붙인 발송 중 캠페인 */
export interface LiveSending { id: string; name: string; processed: number; total: number; percent: number }

export interface LiveSummary {
  /** 켜진 여정 + 켜진 자동 마케팅 */
  running: number;
  journeys: { count: number; firstName: string; entered: number } | null;
  /** nextRunAt = 다음 회차 준비 시각(ms). null = 서버가 다음 분에 바로 집는 상태 */
  auto: { count: number; nextName: string; nextRunAt: number | null } | null;
  scheduled: { count: number; nextName: string; nextAt: number } | null;
  sending: LiveSending | null;
  /** 크레딧이 부족해 멈춘 자동 마케팅(paused_no_credit) — 정지 칩 · running 에는 넣지 않는다 */
  stalled: { count: number } | null;
}

export function summarizeLive(input: {
  operators: LiveOperatorRow[];
  journeys: LiveJourneyRow[];
  scheduled: LiveScheduledRow[];
  sending: LiveSending | null;
  now: number;
}): LiveSummary {
  const ops = input.operators.filter((o) => o?.status === 'active');
  // 다음 회차가 비었거나 지난 운영자 = 워커가 다음 분에 집는다 → 가장 먼저 돈다
  const runAt = (o: LiveOperatorRow) => { const t = o.nextRunAt ? Date.parse(o.nextRunAt) : NaN; return Number.isFinite(t) ? t : null; };
  const nextOp = ops.reduce<LiveOperatorRow | null>((best, o) => {
    if (!best) return o;
    return (runAt(o) ?? -Infinity) < (runAt(best) ?? -Infinity) ? o : best;
  }, null);

  const js = input.journeys.filter((j) => j?.status === 'active');
  const stalled = input.operators.filter((o) => o?.status === 'paused_no_credit').length;

  const upcoming = input.scheduled
    .map((c) => ({ name: c.campaign_name || '예약 발송', at: c.scheduled_at ? Date.parse(c.scheduled_at) : NaN }))
    .filter((c) => Number.isFinite(c.at) && c.at > input.now)
    .sort((a, b) => a.at - b.at);

  return {
    running: ops.length + js.length,
    journeys: js.length
      ? { count: js.length, firstName: js[0].name || '여정', entered: js.reduce((s, j) => s + (Number(j.stats_total_entered) || 0), 0) }
      : null,
    auto: nextOp ? { count: ops.length, nextName: nextOp.name || '자동 마케팅', nextRunAt: runAt(nextOp) } : null,
    scheduled: upcoming.length ? { count: upcoming.length, nextName: upcoming[0].name, nextAt: upcoming[0].at } : null,
    sending: input.sending,
    stalled: stalled ? { count: stalled } : null,
  };
}

/**
 * 다음 회차까지 남은 시간. 하루 이상 = 「N일 N시간」 · 1시간 이상 = 「N시간 M분」(1분마다 갱신) ·
 * 1시간 안 = 시:분:초(1초마다) · 지났거나 비었으면 null(= 곧). 초가 도는 것은 마지막 1시간뿐이다.
 */
export function countdownText(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  if (h >= 24) return `${Math.floor(h / 24)}일 ${h % 24}시간`;
  if (h >= 1) return `${h}시간 ${Math.floor((s % 3600) / 60)}분`;
  const two = (n: number) => String(n).padStart(2, '0');
  return `00:${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

/** 카운트다운을 다시 그릴 간격(ms) — 1시간 안이면 1초, 그 밖은 다음 분 경계(「N시간 M분」의 분이 제때 바뀌게) */
export function countdownTickMs(ms: number | null): number {
  if (ms !== null && ms > 0 && ms < 3_600_000) return 1000;
  return ms !== null && ms > 0 ? (ms % 60_000 || 60_000) : 60_000;
}

/**
 * ★ 2026-10-10 들어오기 1회 — 카드가 아래에서 한 번 올라온다(0.3초). backwards = 끝난 뒤 호버 들림을 막지 않는다.
 *   대시보드 · 띠가 같은 상수를 쓴다(한 곳).
 */
export const ENTER_ONCE = 'animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards motion-reduce:animate-none';

/**
 * ★ 2026-10-10 들어오기 · 숫자 채우기는 페이지를 새로 열 때 1회(B안 승인 「접속·새로고침 때 1회」).
 *   다른 화면에 갔다가 대시보드로 돌아오면 다시 하지 않는다. 새로고침하면 모듈이 새로 올라와 다시 한다.
 *   읽기 = 처음 그릴 때(useState 초깃값) · 표시 = 화면에 붙은 뒤(useEffect) — 개발 모드 이중 호출에도 같은 값.
 */
let dashboardIntroDone = false;
export const dashboardIntroPending = (): boolean => !dashboardIntroDone;
export const markDashboardIntroDone = (): void => { dashboardIntroDone = true; };

/**
 * ★ 2026-10-10 Codex 1~4R — 대시보드 · 띠의 서버 읽기 규칙 한 곳.
 *   ① 모든 요청에 시간 제한(본문 읽기까지) — 응답이 멈추면 실패로 본다(그 뒤 늦게 와도 반영되지 않는다).
 *   ② 같은 값을 읽는 요청은 하나씩만 — 도는 동안 들어온 요청은 끝난 뒤 한 번으로 합쳐 다시 보낸다.
 *      서버를 읽는 순서 = 화면에 반영하는 순서가 되어, 늦게 온 옛 응답이 새 값을 덮는 경로가 없다.
 */
export type Fetched = { ok: boolean; status: number; body: any };

export async function fetchJson(url: string, timeoutMs = 10_000): Promise<Fetched> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, signal: ctl.signal });
    return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : null };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export function serialRunner(run: () => Promise<void>): () => Promise<void> {
  let inFlight = false;
  let again = false;
  return async () => {
    if (inFlight) { again = true; return; }
    inFlight = true;
    try {
      do { again = false; await run(); } while (again);
    } finally {
      inFlight = false;
    }
  };
}

/** 브라우저 「움직임 줄이기」 설정 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
