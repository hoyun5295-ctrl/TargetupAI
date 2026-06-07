/**
 * predictive-segments-core.ts — AI 발견 세그먼트 근거 요약 순수 코어
 *
 * 자율예측 메인 "발견 세그먼트"(6종)의 근거 한 줄 생성.
 *   - 입력 = 세그먼트별 실측 count + 보조 실측 숫자
 *   - 출력 = { key, label, count, reasonSummary, accent } × 6 (항상)
 *   - DB import 0 (순수 함수 — getCompanyPredictionSummary가 SQL 집계 후 주입)
 *   - 근거 문장은 전부 실데이터 기반 (임의 상수·혜택 수치 X)
 *
 * 2026-06-07: count 0이어도 6종 카드를 항상 반환(빈 칸은 "발송 데이터 부족 — 활성화 안 됨" 안내,
 *   프론트에서 캠페인/근거 버튼 비활성). 솔루션 시작 단계에 화면이 비지 않게.
 *
 * 사용처: predictive-suite.ts getCompanyPredictionSummary → discoveredSegments
 */

export type DiscoveredSegmentKey =
  | 'churn_recovery' | 'purchase_push' | 'vip_engagement'
  | 'first_purchase' | 'high_engagement' | 'repurchase_imminent';

export type SegmentAccent = 'rose' | 'emerald' | 'fuchsia' | 'indigo' | 'cyan' | 'amber';

export interface DiscoveredSegmentInput {
  churn: { count: number; avgInactiveDays: number | null };
  purchase: { count: number; avgNextPurchaseDays: number | null };
  vip: { count: number; sumLtv365d: number };
  firstPurchase: { count: number };
  engagement: { count: number; avgClickPct: number | null };  // 0~100 (%)
  repurchase: { count: number; avgNextPurchaseDays: number | null };
}

export interface DiscoveredSegment {
  key: DiscoveredSegmentKey;
  label: string;
  count: number;
  reasonSummary: string;       // 왜 이 묶음인지 — 실데이터 근거 한 줄 (대상 0이면 비활성 안내)
  accent: SegmentAccent;
}

// 대상 0명 — 발송 데이터 부족으로 아직 활성화 안 됨 (프론트에서 카드 흐림 + 버튼 비활성)
const INACTIVE_REASON = '발송 데이터가 부족해 아직 활성화되지 않았습니다. 발송·구매가 쌓이면 이 그룹이 자동으로 채워집니다.';

/** 천단위 콤마 — 결정적(로케일 비의존). 소수는 반올림, 음수/NaN은 '0'. */
export function formatKoreanNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n);
  if (rounded <= 0) return '0';
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const fmt = formatKoreanNumber;

/**
 * 세그먼트별 실측 숫자 → 발견 세그먼트 6종(항상). 순서 고정.
 * count 0이어도 카드를 반환하되 reasonSummary는 비활성 안내(프론트에서 버튼 비활성).
 */
export function buildDiscoveredSegments(input: DiscoveredSegmentInput): DiscoveredSegment[] {
  const out: DiscoveredSegment[] = [];

  // 1. 이탈 위험 — 최근 활동이 끊긴 고객
  {
    const c = input.churn.count;
    const days = input.churn.avgInactiveDays;
    const reason = c <= 0 ? INACTIVE_REASON
      : days !== null && days > 0
        ? `평균 ${days}일째 잠잠한 고객 ${fmt(c)}명을 찾았습니다. 더 두면 이탈로 굳어집니다 — 지금 회복 메시지가 가장 효과적입니다.`
        : `한동안 반응이 없어 이탈 위험이 높은 고객 ${fmt(c)}명입니다. 지금 회복 메시지를 보낼 시점입니다.`;
    out.push({ key: 'churn_recovery', label: '이탈 위험 고객', count: c, reasonSummary: reason, accent: 'rose' });
  }

  // 2. 구매 기회 — 곧 다시 살 신호를 보이는 고객
  {
    const c = input.purchase.count;
    const days = input.purchase.avgNextPurchaseDays;
    const reason = c <= 0 ? INACTIVE_REASON
      : days !== null && days > 0
        ? `평균 ${days}일 안에 다시 구매할 신호를 보이는 고객 ${fmt(c)}명입니다. 그 전에 추천 상품을 보내면 전환을 앞당길 수 있습니다.`
        : `구매 가능성이 무르익은 고객 ${fmt(c)}명입니다. 추천 상품을 보내 구매를 이끌 시점입니다.`;
    out.push({ key: 'purchase_push', label: '구매 기회 고객', count: c, reasonSummary: reason, accent: 'emerald' });
  }

  // 3. VIP 보존 — 예상 매출이 큰 핵심 고객
  {
    const c = input.vip.count;
    const reason = c <= 0 ? INACTIVE_REASON
      : `앞으로 1년간 예상 매출 ${fmt(input.vip.sumLtv365d)}원을 책임지는 핵심 고객 ${fmt(c)}명입니다. 이탈하면 그만큼 매출이 빠집니다 — 지금 관리가 필요합니다.`;
    out.push({ key: 'vip_engagement', label: 'VIP 보존 대상', count: c, reasonSummary: reason, accent: 'fuchsia' });
  }

  // 4. 첫 구매 유도 — 아직 구매 이력이 없는 고객 (cold start에서도 잡힘)
  {
    const c = input.firstPurchase.count;
    const reason = c <= 0 ? INACTIVE_REASON
      : `아직 첫 구매를 하지 않은 고객 ${fmt(c)}명입니다. 환영 메시지로 첫 거래를 트면 단골로 이어집니다.`;
    out.push({ key: 'first_purchase', label: '첫 구매 유도', count: c, reasonSummary: reason, accent: 'indigo' });
  }

  // 5. 관심·반응 — 메시지에 잘 반응하는 고객
  {
    const c = input.engagement.count;
    const pct = input.engagement.avgClickPct;
    const reason = c <= 0 ? INACTIVE_REASON
      : pct !== null && pct > 0
        ? `메시지에 잘 반응하는 고객 ${fmt(c)}명입니다(평균 클릭 가능성 ${Math.round(pct)}%). 신상품·이벤트를 가장 먼저 알리면 효과가 큽니다.`
        : `메시지에 잘 반응하는 고객 ${fmt(c)}명입니다. 신상품·이벤트를 먼저 알리면 효과가 큽니다.`;
    out.push({ key: 'high_engagement', label: '관심·반응 고객', count: c, reasonSummary: reason, accent: 'cyan' });
  }

  // 6. 재구매 임박 — 2주 안에 다시 살 것으로 예측되는 고객
  {
    const c = input.repurchase.count;
    const days = input.repurchase.avgNextPurchaseDays;
    const reason = c <= 0 ? INACTIVE_REASON
      : days !== null && days > 0
        ? `2주 안에 다시 살 신호를 보이는 고객 ${fmt(c)}명입니다(평균 ${days}일 뒤 예상). 지금 추천을 보내면 타이밍이 맞습니다.`
        : `곧 재구매가 예상되는 고객 ${fmt(c)}명입니다. 지금 추천을 보내면 타이밍이 맞습니다.`;
    out.push({ key: 'repurchase_imminent', label: '재구매 임박', count: c, reasonSummary: reason, accent: 'amber' });
  }

  return out;
}
