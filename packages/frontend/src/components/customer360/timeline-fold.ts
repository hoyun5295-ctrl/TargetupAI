/**
 * timeline-fold.ts — 고객 360 타임라인 순수 함수 (★ 2026-08-22 v2 신설)
 *
 * React·lucide 의존 0. 백엔드 vitest가 이 파일을 그대로 import해 계약을 잠근다(`customer360-fold.test.ts`).
 *
 * 1) foldRuns — 같은 문자를 연달아 보낸 행을 한 줄로 접는다(v2 §4).
 *    ⛔ 접기는 **클라이언트**가 한다. 서버 커서(nextBefore)는 마지막 원행 기준이라 서버에서 접으면 커서가 깨진다.
 *    ⛔ 키에 status가 들어간다. 성공 5 + 실패 1을 "6건"으로 접으면 마케터가 찾아야 할 실패가 사라진다.
 *    ⛔ 꼬리 규칙: 묶음이 배열 끝에 닿아 있고 다음 페이지가 있으면 접지 않는다. 더 보기 뒤에 "4건"이 "6건"으로
 *       커지는 일을 막는다(누적 배열 전체에 다시 걸면 다음 로드에서 자연히 한 묶음이 된다).
 * 2) groupByDay — 날짜별 묶음 + 그날 종류별 건수(날짜 머리 우측 "발송 6 · 반응 1").
 * 3) splitHighlight — 검색어 일치 구간 분할. 서버 문구를 재해석하지 않고 부분 문자열만 감싼다.
 */

export interface FoldableEvent {
  id: string;
  kind: string;
  /** ISO */
  at: string;
  title: string;
  status?: string | null;
  ref?: { type: string; id: string };
}

export type FoldItem<E extends FoldableEvent> =
  | { type: 'single'; key: string; event: E }
  | { type: 'run'; key: string; first: E; items: E[]; count: number; fromAt: string; toAt: string };

export interface FoldOptions {
  /** 묶음 첫 사건과 마지막 사건의 간격 상한(ms). 기본 10분 */
  windowMs?: number;
  /** 이 건수 이상일 때만 접는다. 기본 3 */
  minRun?: number;
  /** 한 묶음 상한. 기본 50 */
  maxRun?: number;
  /** 다음 페이지가 있는가(꼬리 규칙) */
  hasMore?: boolean;
  /** 같은 날짜 묶음 안에서만 접는다 */
  dayOf: (iso: string) => string;
}

/** 행의 고유 키 — 행 key와 펼침 Set이 같은 값을 쓴다(id는 원천 안에서만 유일하다, v2 §1-9) */
export function eventKey(e: FoldableEvent): string {
  return `${e.kind}:${e.id}`;
}

/** 접기 키 — 같은 종류 + 같은 캠페인(없으면 제목) + 같은 상태 */
export function foldKey(e: FoldableEvent): string {
  return `${e.kind}|${e.ref?.id ?? e.title}|${e.status ?? ''}`;
}

const ms = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

export function foldRuns<E extends FoldableEvent>(events: E[], opts: FoldOptions): FoldItem<E>[] {
  const windowMs = opts.windowMs ?? 10 * 60 * 1000;
  const minRun = opts.minRun ?? 3;
  const maxRun = opts.maxRun ?? 50;
  const out: FoldItem<E>[] = [];
  let i = 0;
  while (i < events.length) {
    const head = events[i];
    const key = foldKey(head);
    const day = opts.dayOf(head.at);
    const headMs = ms(head.at);
    let j = i + 1;
    while (
      j < events.length
      && j - i < maxRun
      && foldKey(events[j]) === key
      && opts.dayOf(events[j].at) === day
      && Math.abs(headMs - ms(events[j].at)) <= windowMs
    ) j++;

    const run = events.slice(i, j);
    const touchesTail = j === events.length;
    if (run.length >= minRun && !(touchesTail && opts.hasMore)) {
      out.push({
        type: 'run',
        key: `run:${eventKey(head)}`,
        first: head,
        items: run,
        count: run.length,
        // 입력은 최신이 먼저다 — 범위는 (오래된 쪽, 최신 쪽)
        fromAt: run[run.length - 1].at,
        toAt: head.at,
      });
    } else {
      for (const e of run) out.push({ type: 'single', key: eventKey(e), event: e });
    }
    i = j;
  }
  return out;
}

export interface DayGroup<E extends FoldableEvent> {
  day: string;
  items: FoldItem<E>[];
  /** kind → 그날 원행 건수(묶음은 펼친 수로 센다) */
  counts: Record<string, number>;
}

export function groupByDay<E extends FoldableEvent>(items: FoldItem<E>[], dayOf: (iso: string) => string): DayGroup<E>[] {
  const out: DayGroup<E>[] = [];
  for (const it of items) {
    const at = it.type === 'run' ? it.first.at : it.event.at;
    const day = dayOf(at);
    let g = out[out.length - 1];
    if (!g || g.day !== day) {
      g = { day, items: [], counts: {} };
      out.push(g);
    }
    g.items.push(it);
    const kind = it.type === 'run' ? it.first.kind : it.event.kind;
    const n = it.type === 'run' ? it.count : 1;
    g.counts[kind] = (g.counts[kind] || 0) + n;
  }
  return out;
}

/** 텍스트를 검색어 일치 구간으로 자른다(대소문자 무시). 검색어가 비면 통째로 한 조각 */
export function splitHighlight(text: string, q: string): { text: string; hit: boolean }[] {
  const needle = q.trim().toLowerCase();
  if (!text || !needle) return [{ text, hit: false }];
  const hay = text.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (;;) {
    const idx = hay.indexOf(needle, pos);
    if (idx < 0) break;
    if (idx > pos) parts.push({ text: text.slice(pos, idx), hit: false });
    parts.push({ text: text.slice(idx, idx + needle.length), hit: true });
    pos = idx + needle.length;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), hit: false });
  return parts.length > 0 ? parts : [{ text, hit: false }];
}
