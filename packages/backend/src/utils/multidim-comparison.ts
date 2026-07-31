// 다차원 비교 분석 — 순수 코어(DB-free). 임의 상수 0: 유형별 집계는 실측 발송/성공 카운트만.
// send_type별 매출은 산출하지 않는다 — estimatedRevenue는 채널 단위 snapshot 계산값이라 유형별 실측이 없다.
// customers SELECT·snapshot 재활용(채널별/기간별)은 호출부(buildMultiDimComparison) 담당.

import { sendTypeLabel } from './send-type-axis';

export interface CampaignTypeRow {
  sendType: string | null;
  sent: number;
  success: number;
}

export interface TypeComparison {
  rawType: string;
  label: string;
  campaigns: number;
  sent: number;
  success: number;
  successRate: number; // 0~1, sent=0이면 0
}

export interface CustomerCreatedRow {
  createdAtMs: number | null;
}

export interface NewVsExistingResult {
  newCount: number;
  existingCount: number;
  total: number;
  newPct: number; // 0~100
  reactionAvailable: boolean; // 발송 반응(구매) 비교 = cdp 필요 → 미연동이면 false
}

/**
 * 저장되지 않는 옛 값만 여기서 흡수한다 — 현행 값(direct·ai·auto·journey)의 라벨은
 * `send-type-axis` CT가 소유한다.
 *
 * ★ 2026-07-31 정정. 이 맵에 실제 저장값 `direct`가 없어서 **모든 직접발송이 '기타'로 집계**됐다
 *   (`manual`은 어느 INSERT도 쓰지 않는 값이다). 축 라벨을 파일마다 복제하면 이렇게 조용히 어긋난다.
 */
const LEGACY_TYPE_LABELS: Record<string, string> = {
  manual: '직접발송',
  auto_executed: '자동발송',
};

/** send_type 유형별 발송/성공률 집계. 매출은 제외(유형별 실측 매출 없음). 발송량 내림차순 정렬. */
export function computeTypeComparison(rows: CampaignTypeRow[]): TypeComparison[] {
  const agg = new Map<string, { campaigns: number; sent: number; success: number }>();
  for (const r of rows) {
    const key = (r.sendType && String(r.sendType).trim()) || '기타';
    const e = agg.get(key) || { campaigns: 0, sent: 0, success: 0 };
    e.campaigns += 1;
    e.sent += Number(r.sent) || 0;
    e.success += Number(r.success) || 0;
    agg.set(key, e);
  }
  return Array.from(agg.entries())
    .map(([rawType, e]) => ({
      rawType,
      label: LEGACY_TYPE_LABELS[rawType] || sendTypeLabel(rawType),
      campaigns: e.campaigns,
      sent: e.sent,
      success: e.success,
      successRate: e.sent > 0 ? e.success / e.sent : 0,
    }))
    .sort((a, b) => b.sent - a.sent);
}

/** 기간 내 신규 가입 vs 기존 고객 구성. 발송 반응(구매) 비교는 cdp 필요 → reactionAvailable=false. */
export function computeNewVsExisting(customers: CustomerCreatedRow[], periodStartMs: number): NewVsExistingResult {
  const total = customers.length;
  let newCount = 0;
  for (const c of customers) {
    if (c.createdAtMs != null && c.createdAtMs >= periodStartMs) newCount += 1;
  }
  const existingCount = total - newCount;
  return {
    newCount,
    existingCount,
    total,
    newPct: total > 0 ? (newCount / total) * 100 : 0,
    reactionAvailable: false,
  };
}
