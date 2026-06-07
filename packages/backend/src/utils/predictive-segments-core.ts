/**
 * predictive-segments-core.ts — AI 발견 세그먼트 근거 요약 순수 코어
 *
 * 자율예측 메인 "발견 세그먼트"(이탈 / 구매 / VIP)의 근거 한 줄 생성.
 *   - 입력 = 세그먼트별 실측 count + 보조 실측 숫자(평균 미활동일 · 평균 다음 구매일 · 합산 LTV)
 *   - 출력 = { key, label, count, reasonSummary, accent }
 *   - DB import 0 (순수 함수 — getCompanyPredictionSummary가 SQL 집계 후 주입)
 *   - 근거 문장은 전부 실데이터 기반 (임의 상수 X) — count 0 세그먼트는 제외
 *
 * 사용처: predictive-suite.ts getCompanyPredictionSummary → discoveredSegments
 */

export type DiscoveredSegmentKey = 'churn_recovery' | 'purchase_push' | 'vip_engagement';

export interface DiscoveredSegmentInput {
  churn: { count: number; avgInactiveDays: number | null };
  purchase: { count: number; avgNextPurchaseDays: number | null };
  vip: { count: number; sumLtv365d: number };
}

export interface DiscoveredSegment {
  key: DiscoveredSegmentKey;
  label: string;
  count: number;
  reasonSummary: string;       // 왜 이 묶음인지 — 실데이터 근거 한 줄
  accent: 'rose' | 'emerald' | 'fuchsia';
}

/** 천단위 콤마 — 결정적(로케일 비의존). 소수는 반올림, 음수/NaN은 '0'. */
export function formatKoreanNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n);
  if (rounded <= 0) return '0';
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 세그먼트별 실측 숫자 → 발견 세그먼트 배열.
 * count 0인 세그먼트는 제외(발견된 것만 노출). 순서 = 이탈 → 구매 → VIP.
 */
export function buildDiscoveredSegments(input: DiscoveredSegmentInput): DiscoveredSegment[] {
  const out: DiscoveredSegment[] = [];

  // 1. 이탈 위험 — 최근 활동이 끊긴 고객
  if (input.churn.count > 0) {
    const n = formatKoreanNumber(input.churn.count);
    const days = input.churn.avgInactiveDays;
    const reasonSummary = days !== null && days > 0
      ? `평균 ${days}일째 잠잠한 고객 ${n}명을 찾았습니다. 더 두면 이탈로 굳어집니다 — 지금 회복 메시지가 가장 효과적입니다.`
      : `한동안 반응이 없어 이탈 위험이 높은 고객 ${n}명입니다. 지금 회복 메시지를 보낼 시점입니다.`;
    out.push({ key: 'churn_recovery', label: '이탈 위험 고객', count: input.churn.count, reasonSummary, accent: 'rose' });
  }

  // 2. 구매 기회 — 곧 다시 살 신호를 보이는 고객
  if (input.purchase.count > 0) {
    const n = formatKoreanNumber(input.purchase.count);
    const days = input.purchase.avgNextPurchaseDays;
    const reasonSummary = days !== null && days > 0
      ? `평균 ${days}일 안에 다시 구매할 신호를 보이는 고객 ${n}명입니다. 그 전에 추천 상품을 보내면 전환을 앞당길 수 있습니다.`
      : `구매 가능성이 무르익은 고객 ${n}명입니다. 추천 상품을 보내 구매를 이끌 시점입니다.`;
    out.push({ key: 'purchase_push', label: '구매 기회 고객', count: input.purchase.count, reasonSummary, accent: 'emerald' });
  }

  // 3. VIP 보존 — 예상 매출이 큰 핵심 고객
  if (input.vip.count > 0) {
    const n = formatKoreanNumber(input.vip.count);
    const sumLtv = formatKoreanNumber(input.vip.sumLtv365d);
    const reasonSummary = `앞으로 1년간 예상 매출 ${sumLtv}원을 책임지는 핵심 고객 ${n}명입니다. 이탈하면 그만큼 매출이 빠집니다 — 지금 관리가 필요합니다.`;
    out.push({ key: 'vip_engagement', label: 'VIP 보존 대상', count: input.vip.count, reasonSummary, accent: 'fuchsia' });
  }

  return out;
}
