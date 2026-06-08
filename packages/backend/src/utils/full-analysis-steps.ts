// 풀분석 진행 단계 정의 (DB-free 순수 모듈 — verify 테스트 가능, config/database import 금지)
// spec §5-3: 진행도 모달 단계. '데이터 수집'은 step 진입 전(0)이며 step 1부터 라벨링.

export const ANALYSIS_STEPS = [
  '성과 진단',
  '원인 분석',
  '세그먼트',
  '다차원 비교',
  '채널·캠페인',
  '메시지 분석',
  '예측',
  '액션 플랜',
  'PDF 생성',
] as const;

/** step(1..N)에 해당하는 라벨. 0 이하는 첫 단계, 범위 초과는 마지막 단계. */
export function stepLabel(step: number): string {
  if (step < 1) return ANALYSIS_STEPS[0];
  return ANALYSIS_STEPS[Math.min(step, ANALYSIS_STEPS.length) - 1];
}

/** 진행률(0~100). step=0 → 0%, step=총단계 → 100%. */
export function stepProgress(step: number): number {
  const clamped = Math.max(0, Math.min(step, ANALYSIS_STEPS.length));
  return (clamped / ANALYSIS_STEPS.length) * 100;
}
