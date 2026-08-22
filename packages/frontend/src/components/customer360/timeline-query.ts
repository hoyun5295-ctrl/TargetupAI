/**
 * timeline-query.ts — 고객 360 조회 조건 (★ 2026-08-22 v2 신설, 순수)
 *
 * 기간 세그먼트 4칸과 그것이 서버로 보내는 `from` 값을 여기가 소유한다.
 * ⛔ 화면은 `months`를 보내지 않는다 — 서버가 `from`에서 MySQL log 개월 수를 역산한다(v2 §3-2).
 *    "전체"는 `from` 없음 = 서버 상한 24개월이고, 서버가 `rangeCapped`로 그 사실을 알린다.
 */

export type RangeKey = '30d' | '90d' | '12m' | 'all';

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: '30d', label: '30일' },
  { key: '90d', label: '3개월' },
  { key: '12m', label: '12개월' },
  { key: 'all', label: '전체' },
];

/** 여는 순간의 결과가 Phase 0과 같게 — 서버 기본(12개월)과 같은 값 */
export const DEFAULT_RANGE: RangeKey = '12m';

const pad = (n: number) => String(n).padStart(2, '0');

/** 로컬(KST) 날짜 'YYYY-MM-DD' */
export function localDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 세그먼트 → `from` 날짜. 전체는 null */
export function rangeFromDate(key: RangeKey, now: Date = new Date()): string | null {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (key) {
    case '30d': d.setDate(d.getDate() - 30); break;
    case '90d': d.setMonth(d.getMonth() - 3); break;
    case '12m': d.setMonth(d.getMonth() - 12); break;
    case 'all': return null;
  }
  return localDateString(d);
}

export interface TimelineQuery {
  kinds: string;
  q: string;
  range: RangeKey;
}

/** 조건이 기본값에서 벗어났는가(툴바 "조건 지우기"·결과 문구 분기) */
export function hasConditions(qr: TimelineQuery): boolean {
  return !!qr.kinds || !!qr.q.trim() || qr.range !== DEFAULT_RANGE;
}

/**
 * URLSearchParams 조립. `summary=0`은 요약을 이미 가진 뒤의 재조회에만 붙인다 —
 * 칩 클릭마다 MySQL COUNT가 돌지 않게 하고, 요약(마지막 활동 포함)이 조건에 따라 흔들리지 않게 한다(v2 §2-5).
 */
export function buildTimelineParams(
  qr: TimelineQuery,
  opts: { before?: string | null; limit?: number; withSummary: boolean; now?: Date },
): URLSearchParams {
  const p = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.before) p.set('before', opts.before);
  if (qr.kinds) p.set('kinds', qr.kinds);
  const q = qr.q.trim().slice(0, 40);
  if (q) p.set('q', q);
  const from = rangeFromDate(qr.range, opts.now);
  if (from) p.set('from', from);
  if (!opts.withSummary) p.set('summary', '0');
  return p;
}
