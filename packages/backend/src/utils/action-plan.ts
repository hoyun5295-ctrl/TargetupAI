// 우선순위 액션 플랜 — 순수 코어(DB-free). 임의 상수 0: 예상 효과 숫자는 실측 없으면 null(생략).
// AI 자율 진단 권장(최상위) + RFM 세그먼트 규모순(이탈위험/휴면) + 저성과 채널을 순위화한 권고.
// 저성과 채널 판정 임계·explanation/세그먼트 결과 추출은 호출부 담당. 여기는 정렬·근거 매핑만.

export interface ActionPlanInput {
  aiRecommendation: string | null; // explanation.recommendation
  atRiskCount: number; // RFM 이탈위험 규모
  dormantCount: number; // RFM 휴면 규모
  lowPerformingChannels: { label: string; successRate: number }[]; // 호출부가 평균 미만 채널만 추려 전달
  newCustomerPct: number | null; // 신규 고객 비중(참고용)
}

export interface ActionItem {
  priority: number;
  title: string;
  basis: string; // 권고 근거(어느 데이터)
  linkHint: string | null; // 실행 연결 안내(여정/캠페인) — 텍스트
  expectedEffect: string | null; // 예상 효과 — 실측 없으면 null(임의 추정 금지)
}

const AI_WEIGHT = Number.MAX_SAFE_INTEGER; // AI 권장을 항상 최상위로 두는 정렬 sentinel
const CHANNEL_WEIGHT = -1; // 저성과 채널을 항상 세그먼트 뒤로 두는 정렬 sentinel

/** AI 권장·세그먼트 규모·저성과 채널을 우선순위화한 권고 리스트. */
export function buildActionPlan(input: ActionPlanInput): ActionItem[] {
  const draft: Array<{ weight: number; title: string; basis: string; linkHint: string | null; expectedEffect: string | null }> = [];

  if (input.aiRecommendation && input.aiRecommendation.trim()) {
    draft.push({
      weight: AI_WEIGHT,
      title: '성과 진단 1순위 권장 실행',
      basis: `AI 자율 진단 권장 — ${input.aiRecommendation.trim()}`,
      linkHint: '캠페인 만들기 또는 여정으로 실행',
      expectedEffect: null,
    });
  }
  if (input.atRiskCount > 0) {
    draft.push({
      weight: input.atRiskCount,
      title: '이탈위험 고객 재참여',
      basis: `RFM 이탈위험 ${input.atRiskCount.toLocaleString()}명`,
      linkHint: '여정 — 이탈 방지 시나리오',
      expectedEffect: null,
    });
  }
  if (input.dormantCount > 0) {
    draft.push({
      weight: input.dormantCount,
      title: '휴면 고객 리마인드',
      basis: `RFM 휴면 ${input.dormantCount.toLocaleString()}명`,
      linkHint: '여정 — 휴면 리마인드',
      expectedEffect: null,
    });
  }
  for (const ch of input.lowPerformingChannels) {
    draft.push({
      weight: CHANNEL_WEIGHT,
      title: `${ch.label} 채널 점검`,
      basis: `성공률 ${(ch.successRate * 100).toFixed(1)}%`,
      linkHint: null,
      expectedEffect: null,
    });
  }

  return draft
    .sort((a, b) => b.weight - a.weight)
    .map((d, i) => ({ priority: i + 1, title: d.title, basis: d.basis, linkHint: d.linkHint, expectedEffect: d.expectedEffect }));
}
