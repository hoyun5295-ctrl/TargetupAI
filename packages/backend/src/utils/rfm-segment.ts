// RFM 세그먼트 도출 — 순수 함수(DB-free). 임의 상수 0: R/F/M 점수는 그 회사 고객 분포의 분위수로 매긴다.
// 구매 데이터가 있는 고객이 없으면 sufficient=false('데이터 부족'). customers SELECT는 호출부 담당.

export interface RfmCustomer {
  recencyDays: number | null;  // 최근 구매일로부터 경과 일수 (null = 구매 이력 없음)
  frequency: number | null;    // 구매 횟수(purchase_count)
  monetary: number | null;     // 총 구매액(total_purchase_amount)
}

export interface RfmSegment {
  label: string;
  count: number;
  pct: number;
  avgMonetary: number;
}

export interface RfmResult {
  sufficient: boolean;
  totalCustomers: number;
  withPurchaseData: number;
  segments: RfmSegment[];
}

/** 정렬된 분포에서 v의 분위 점수(1~5). invert=true면 작을수록 높은 점수(recency용). */
function quintileScore(sortedAsc: number[], v: number, invert = false): number {
  const n = sortedAsc.length;
  if (n === 0) return 1;
  // v 이하 비율(percentile rank, 0~1)
  let le = 0;
  for (const x of sortedAsc) { if (x <= v) le++; }
  const rank = le / n;
  let score = Math.ceil(rank * 5);
  if (score < 1) score = 1;
  if (score > 5) score = 5;
  return invert ? 6 - score : score;
}

/** RFM 표준 분류 규칙 (점수 1~5 기준). */
function classifySegment(r: number, f: number): string {
  if (r >= 4 && f >= 4) return '충성 우수';
  if (r >= 4 && f >= 2) return '충성 고객';
  if (r >= 3 && f <= 2) return '신규·성장';
  if (r <= 2 && f >= 3) return '이탈 위험';
  if (r <= 2 && f <= 2) return '휴면';
  return '일반';
}

export function computeRfmSegments(customers: RfmCustomer[]): RfmResult {
  const total = customers.length;
  const valid = customers.filter(
    (c) => c.recencyDays != null && c.frequency != null && c.monetary != null && ((c.frequency ?? 0) > 0 || (c.monetary ?? 0) > 0),
  );
  if (valid.length === 0) {
    return { sufficient: false, totalCustomers: total, withPurchaseData: 0, segments: [] };
  }

  const rSorted = valid.map((c) => c.recencyDays as number).sort((a, b) => a - b);
  const fSorted = valid.map((c) => c.frequency as number).sort((a, b) => a - b);
  const counts = new Map<string, { count: number; mSum: number }>();

  for (const c of valid) {
    const r = quintileScore(rSorted, c.recencyDays as number, true); // recency: 작을수록 우량
    const f = quintileScore(fSorted, c.frequency as number);
    const label = classifySegment(r, f);
    const e = counts.get(label) || { count: 0, mSum: 0 };
    e.count += 1;
    e.mSum += c.monetary as number;
    counts.set(label, e);
  }

  const segments: RfmSegment[] = Array.from(counts.entries())
    .map(([label, e]) => ({ label, count: e.count, pct: (e.count / valid.length) * 100, avgMonetary: e.mSum / e.count }))
    .sort((a, b) => b.count - a.count);

  return { sufficient: true, totalCustomers: total, withPurchaseData: valid.length, segments };
}
