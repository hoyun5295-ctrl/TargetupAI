/**
 * journey-estimate.ts — 켜기 전 점검 창의 무료 추정(★ 2026-11-13 C133 F1 4 ~ 7번 · 설계서 docs/2026-11-13-hanjul-v3-design.md §3-1)
 *
 * 서버 = GET /api/ai/operator/journeys/:id/simulate(모델 호출 0 · 차감 0 · 실발송과 같은 뽑기 · backend utils/journey-simulator.ts).
 *   창이 「지금 칸에 적힌 최대 인원」으로 묻는다(?cap=숫자 · ?cap=none = 비움 · 저장하지 않는다). 답에는 판정에 쓴 값(capUsed)이 온다
 *   → 화면은 그 값이 지금 칸의 값과 같을 때만 그 답을 쓴다(칸을 고친 뒤 늦게 온 옛 답을 버린다).
 * 숫자는 서버가 준 값만 쓴다(지어내지 않는다). 못 읽으면 그리지 않는다.
 */
import { fetchJson, serialRunner } from './dashboard-live';

export interface JourneyEstimate {
  matchedCustomers: number;
  /** 사건형 · 이어받기 = 최근 사건 기준 근사 */
  approximate: boolean;
  totalEstimatedSends: number;
  totalEstimatedCost: number;
  /** 켜면 첫 회차에 바로 멈추는가(진입 감시와 같은 판정) */
  firstRoundCapExceeded: boolean;
  /** 이 판정에 쓴 최대 인원(null = 제한 없음) */
  capUsed: number | null;
  /** 선불 회사의 지금 잔액 · 후불 = null */
  prepaidBalance: number | null;
  fatigueCap: 'on' | 'off' | 'unknown';
}

/** (순수) 추정 주소 — 칸이 비었으면 cap=none · 숫자면 그 값 */
export function estimateUrl(journeyId: string, cap: number | null): string {
  return `/api/ai/operator/journeys/${journeyId}/simulate?cap=${cap === null ? 'none' : String(cap)}`;
}

/** (순수) 서버 응답 → 화면이 쓰는 칸만. 꼴이 다르면 null */
export function toEstimate(sim: any): JourneyEstimate | null {
  if (!sim || typeof sim !== 'object') return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const matched = num(sim.matchedCustomers);
  const sends = num(sim.totalEstimatedSends);
  const cost = num(sim.totalEstimatedCost);
  if (matched === null || sends === null || cost === null || typeof sim.firstRoundCapExceeded !== 'boolean') return null;
  if (!(sim.capUsed === null || num(sim.capUsed) !== null)) return null;
  return {
    matchedCustomers: matched,
    approximate: sim.approximate === true,
    totalEstimatedSends: sends,
    totalEstimatedCost: cost,
    firstRoundCapExceeded: sim.firstRoundCapExceeded,
    capUsed: sim.capUsed,
    prepaidBalance: num(sim.prepaidBalance),
    fatigueCap: sim.fatigueCap === 'on' || sim.fatigueCap === 'off' ? sim.fatigueCap : 'unknown',
  };
}

/** 한 여정의 추정(지금 칸의 최대 인원으로) — 실패 · 꼴 다름 · 다른 값으로 판정한 답 = null */
export async function fetchJourneyEstimate(journeyId: string, cap: number | null): Promise<JourneyEstimate | null> {
  const r = await fetchJson(estimateUrl(journeyId, cap), 20_000);
  if (!r.ok || r.body?.success !== true) return null;
  const e = toEstimate(r.body.simulation);
  return e && e.capUsed === cap ? e : null;
}

// ── 추정 요청 줄 ──

/** 지금 원하는 추정 — epoch = 창을 연 차례(다시 열면 올라간다) · items = 고른 여정과 지금 칸의 최대 인원 */
export interface EstimateWant { epoch: number; items: ReadonlyArray<{ id: string; cap: number | null }> }
/** 여정 하나의 추정 칸 — est: undefined = 묻는 중 · null = 못 읽음 */
export interface EstimateCell { epoch: number; cap: number | null; est: JourneyEstimate | null | undefined }

/**
 * 추정 요청 줄(★ C133 Codex 배포 B 1R — 옛: 화면 효과마다 따로 돌려 ① 다시 열기 전의 답이 새 창에 반영되고 ② 칸 · 고르기를 바꿀 때마다 무거운 조회가 겹쳤다).
 *   - **한 번에 하나만** 묻는다(대상 세기는 무거운 조회) · 도는 동안 바뀐 요청은 끝난 뒤 한 번으로 합쳐 다시 돈다(serialRunner = 대시보드 읽기와 같은 규칙).
 *   - 답은 「지금 원하는 것」과 맞을 때만 쓴다: 창을 다시 열었으면(epoch) 버리고 · 그 여정의 칸 값이 바뀌었거나 고르기에서 빠졌으면 버린다.
 *   - 같은 창 · 같은 값으로 이미 물은 여정은 다시 묻지 않는다(답 · 못 읽음 모두 · 줄이 스스로 기억한다 = 화면이 다시 그려지기를 기다리지 않는다).
 */
export function createEstimateQueue(deps: {
  fetch: (id: string, cap: number | null) => Promise<JourneyEstimate | null>;
  /** 칸 하나가 바뀔 때(묻는 중 · 답 · 못 읽음) 화면 상태에 쓴다 */
  onCell: (id: string, cell: EstimateCell) => void;
}): { request: (want: EstimateWant) => void } {
  let want: EstimateWant = { epoch: -1, items: [] };
  const cells = new Map<string, EstimateCell>();
  const put = (id: string, cell: EstimateCell) => { cells.set(id, cell); deps.onCell(id, cell); };
  const run = serialRunner(async () => {
    const mine = want;
    for (const w of mine.items) {
      if (want !== mine) return;   // 요청이 바뀌었다 → 이 바퀴는 그만(serialRunner 가 바뀐 요청으로 다시 돌린다)
      const cur = cells.get(w.id);
      if (cur && cur.epoch === mine.epoch && cur.cap === w.cap && cur.est !== undefined) continue;   // 이 창 · 이 값으로 이미 물었다
      put(w.id, { epoch: mine.epoch, cap: w.cap, est: undefined });
      const est = await deps.fetch(w.id, w.cap);
      if (want.epoch !== mine.epoch) return;   // 창을 다시 열었다 → 버린다
      const now = want.items.find((x) => x.id === w.id);
      if (!now || now.cap !== w.cap) {         // 그 여정의 칸이 바뀌었다 · 고르기에서 빠졌다 → 버린다(묻는 중 표시도 지운다 = 다음에 다시 묻게)
        if (cells.get(w.id)?.est === undefined) cells.delete(w.id);
        continue;
      }
      put(w.id, { epoch: mine.epoch, cap: w.cap, est });
    }
  });
  return {
    request: (next) => { want = next; void run(); },
  };
}

const n = (v: number) => Math.round(v).toLocaleString('ko-KR');

/** (순수) 줄 글 — 「지금 대상 n명 · 예상 발송 x건 · 발송비 약 y원」(사건형 = 「최근 사건 기준 약 n명」) */
export function estimateLine(e: JourneyEstimate): string {
  const who = e.approximate ? `최근 사건 기준 약 ${n(e.matchedCustomers)}명` : `지금 대상 ${n(e.matchedCustomers)}명`;
  return `${who} · 예상 발송 ${n(e.totalEstimatedSends)}건 · 발송비 약 ${n(e.totalEstimatedCost)}원`;
}

/** (순수) 켜면 바로 멈추는 여정의 안내(아니면 null) */
export function stopLine(e: JourneyEstimate): string | null {
  if (!e.firstRoundCapExceeded) return null;
  return `켜면 바로 멈춰요 · 최대 인원을 ${n(e.matchedCustomers)}명 이상으로 늘리거나 비워 주세요`;
}

/** (순수) 고른 여정의 합계 — 추정을 아는 여정만 더한다(known = 그 수 · 모르는 여정이 있으면 합계는 「알려진 만큼」) */
export function sumEstimates(list: ReadonlyArray<JourneyEstimate | null | undefined>): { sends: number; cost: number; known: number } {
  let sends = 0;
  let cost = 0;
  let known = 0;
  for (const e of list) {
    if (!e) continue;
    sends += e.totalEstimatedSends;
    cost += e.totalEstimatedCost;
    known += 1;
  }
  return { sends, cost, known };
}

/** (순수) 아래 줄 합계 글 — 아는 여정이 없으면 빈 글 · 일부만 알면 그렇다고 적는다 */
export function totalLine(sum: { sends: number; cost: number; known: number }, selected: number): string {
  if (sum.known === 0) return '';
  const part = sum.known < selected ? `(${sum.known}개 기준)` : '';
  return `예상 발송 ${n(sum.sends)}건 · 발송비 약 ${n(sum.cost)}원${part}`;
}

/** (순수) 선불 잔액이 예상 발송비보다 적은가(후불 · 잔액 모름 = false · 안내만 하고 켜기는 막지 않는다) */
export function balanceShort(balance: number | null | undefined, cost: number): boolean {
  return typeof balance === 'number' && Number.isFinite(balance) && cost > 0 && balance < cost;
}
